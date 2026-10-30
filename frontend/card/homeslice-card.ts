import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { areaEntities, areaLight, areaPopup, areaTemperature, contactOpen, coverOpen, type Hass, type PopupSection } from "../ha/hass";
import { localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { labelPoint } from "../model/geometry";
import type { House, Issue, Room, Vec2 } from "../model/types";
import { deriveWalls, type Wall } from "../model/walls";
import { HouseRenderer, type ViewOptions } from "../render/scene";

export interface PopupOverride {
  /** `extend` (default) adds the cards after the generated ones, `replace` shows only them. */
  mode?: "extend" | "replace";
  cards: Record<string, unknown>[];
}

export interface HomesliceCardConfig {
  type: string;
  house?: string;
  view?: Partial<ViewOptions>;
  /** Fixed height in px; by default the card follows the house's shape. */
  height?: number;
  /** Popup overrides keyed by room id or area id. */
  popups?: Record<string, PopupOverride>;
  /** Drag to turn, scroll/pinch to zoom, double-click to reset (default true). */
  interactive?: boolean;
}

interface PlacedRoom {
  key: string;
  levelId: string;
  levelIndex: number;
  room: Room;
  point: Vec2;
}

interface PlacedOpening {
  levelId: string;
  id: string;
  cover?: string;
  contact?: string;
}

interface Label {
  key: string;
  levelIndex: number;
  x: number;
  y: number;
  name: string;
  temperature: string | null;
  areaId?: string;
  hasLights: boolean;
  on: boolean;
}

interface Popup {
  key: string;
  name: string;
  areaId?: string;
  sections: { title: string; cards: Record<string, unknown>[] }[];
}

interface CardHelpers {
  createCardElement(config: Record<string, unknown>): HTMLElement & { hass?: Hass };
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

/** Card YAML uses HA's snake_case; the renderer uses camelCase. */
function viewOptions(
  view: (Partial<ViewOptions> & { cut_height?: number; cut_below?: number; show_outdoor?: boolean }) | undefined,
): Partial<ViewOptions> {
  if (!view) return {};
  const { cut_height, cut_below, show_outdoor, ...rest } = view;
  return {
    ...rest,
    ...(cut_height !== undefined ? { cutHeight: cut_height } : {}),
    ...(cut_below !== undefined ? { cutBelow: cut_below } : {}),
    ...(show_outdoor !== undefined ? { showOutdoor: show_outdoor } : {}),
  };
}

/** Makes sure a card type's element is defined before cards of that type are created. */
async function preloadCard(helpers: CardHelpers, type: string) {
  const tag = type.startsWith("custom:") ? type.slice("custom:".length) : `hui-${type}-card`;
  if (customElements.get(tag)) return;
  // creating a (never attached) card makes HA import the type
  if (!type.startsWith("custom:")) helpers.createCardElement({ type });
  await Promise.race([customElements.whenDefined(tag), new Promise((r) => setTimeout(r, 3000))]);
}

export class HomesliceCard extends LitElement {
  static override properties = {
    _issues: { state: true },
    _error: { state: true },
    _loading: { state: true },
    _labels: { state: true },
    _level: { state: true },
    _popup: { state: true },
    _hover: { state: true },
    _readout: { state: true },
  };

  private _hass?: Hass;
  private config!: HomesliceCardConfig;
  private _issues: Issue[] = [];
  private _error = "";
  private _loading = true;
  private _labels: Label[] = [];
  /** Focused level: the levels above it are lifted away. */
  private _level: string | null = null;
  private _popup: Popup | null = null;
  /** Level under the mouse (or under a hovered floor button). */
  private _hover: number | null = null;
  private hoverFrame = 0;
  /** Camera angle shown while turning, so good values can be copied into the config. */
  private _readout = "";
  private readoutTimer = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragDistance = 0;
  private pinch = 0;
  private dragged = false;
  private clickTimer = 0;
  private house?: House;
  private rooms: PlacedRoom[] = [];
  private openings: PlacedOpening[] = [];
  private stateSignature = "";
  private renderer?: HouseRenderer;
  private resizeObserver?: ResizeObserver;
  private loadedFor?: string;
  private frame = 0;
  private transitioning = false;
  private popupCards: (HTMLElement & { hass?: Hass })[] = [];
  private unsubscribe?: () => Promise<void> | void;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this._popup) this.closePopup();
  };

  setConfig(config: HomesliceCardConfig) {
    this.config = { house: "home", ...config };
    this.loadedFor = undefined;
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  private t(key: StringKey, vars?: Record<string, string | number>) {
    return localize(this.hass?.locale?.language, key, vars);
  }

  get hass(): Hass | undefined {
    return this._hass;
  }

  /**
   * HA sets `hass` several times a second. It is deliberately not a reactive property:
   * the card loads once, then only redraws when one of its own entities changes.
   */
  set hass(hass: Hass | undefined) {
    this._hass = hass;
    if (!hass || !this.config) return;
    for (const c of this.popupCards) c.hass = hass;
    if (this.loadedFor !== this.config.house) {
      this.loadedFor = this.config.house;
      void this.load();
    } else {
      this.syncStates();
    }
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has("_popup")) void this.fillPopup();
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
    this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
    this.updateComplete.then(() => {
      const wrap = this.renderRoot.querySelector(".wrap");
      if (wrap) this.resizeObserver?.observe(wrap);
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    this.renderer?.dispose();
    this.renderer = undefined;
    this.loadedFor = undefined;
    this.stateSignature = "";
    void this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  // ----- loading -----

  /** Subscribes to the house, so saved changes show up at once (falls back to one fetch). */
  private async load() {
    this._loading = true;
    this._error = "";
    void this.unsubscribe?.();
    this.unsubscribe = undefined;
    const house = this.config.house;
    try {
      if (this.hass!.connection?.subscribeMessage) {
        this.unsubscribe = await this.hass!.connection.subscribeMessage<{ model: unknown }>(
          (msg) => void this.applyModel(msg.model),
          { type: "homeslice/subscribe", house },
        );
      } else {
        await this.applyModel(await this.hass!.callWS<unknown>({ type: "homeslice/model", house }));
      }
    } catch (e) {
      this._error = this.t("card.load_failed", { message: (e as { message?: string }).message ?? String(e) });
      this._loading = false;
    }
  }

  private async applyModel(raw: unknown) {
    this._loading = false;
    if (raw === null || raw === undefined) {
      this._error = this.t("card.no_house", { house: this.config.house ?? "" });
      return;
    }
    this._error = "";
    const { house, issues } = expandHouse(raw);
    const walls = new Map<string, Wall[]>();
    if (house) for (const level of house.levels) walls.set(level.id, deriveWalls(level, house.walls, issues));
    this._issues = issues;
    if (house) await this.show(house, walls);
  }

  private async show(house: House, walls: Map<string, Wall[]>) {
    await this.updateComplete;
    const canvas = this.renderRoot.querySelector("canvas");
    if (!canvas) return;
    if (!this.renderer) {
      try {
        this.renderer = new HouseRenderer(canvas);
      } catch {
        this._error = this.t("card.no_webgl");
        return;
      }
    }
    this.house = house;
    this.rooms = house.levels.flatMap((level) =>
      level.rooms
        .filter((room) => room.kind !== "void" && (room.kind !== "outdoor" || viewOptions(this.config.view).showOutdoor !== false))
        .map((room) => ({ key: `${level.id}/${room.id}`, levelId: level.id, levelIndex: level.index, room, point: labelPoint(room.polygon) })),
    );
    this.openings = [...walls.entries()].flatMap(([levelId, ws]) =>
      ws.flatMap((w) => w.openings.filter((o) => o.cover || o.contact).map((o) => ({ levelId, id: o.id, cover: o.cover, contact: o.contact }))),
    );
    this.renderer.setModel(house, walls, viewOptions(this.config.view));
    // keep the focused floor across model updates, if it still exists
    const focused = this._level ? house.levels.find((l) => l.id === this._level) : undefined;
    this._level = focused?.id ?? null;
    this._hover = null;
    if (focused) await this.renderer.setFocus(focused.index, false);
    this.stateSignature = "";
    this.syncStates();
    this.scheduleDraw();
  }

  // ----- live state -----

  /** Applies lights, covers and contacts; redraws only when something actually changed. */
  private syncStates() {
    if (!this.hass || !this.renderer || !this.house) return;
    const hass = this.hass;
    const lights = this.rooms.map((r) => (r.room.areaId ? areaLight(hass, r.room.areaId) : null));
    const covers = this.openings.map((o) => (o.cover ? coverOpen(hass, o.cover) : null));
    const contacts = this.openings.map((o) => (o.contact ? contactOpen(hass, o.contact) : false));
    const temperatures = this.rooms.map((r) => (r.room.areaId ? areaTemperature(hass, r.room.areaId) : null));
    const signature = JSON.stringify([lights, covers, contacts, temperatures]);
    if (signature === this.stateSignature) return;
    this.stateSignature = signature;
    this.rooms.forEach((r, i) => this.renderer!.setRoomLight(r.levelId, r.room.id, lights[i]));
    this.openings.forEach((o, i) => {
      this.renderer!.setCover(o.id, covers[i]);
      this.renderer!.setContact(o.id, contacts[i]);
    });
    this.scheduleDraw();
  }

  // ----- floors -----

  private async selectLevel(id: string | null) {
    if (!this.renderer || !this.house) return;
    this._level = this._level === id ? null : id;
    const index = this._level ? this.house.levels.find((l) => l.id === this._level)?.index ?? null : null;
    this._hover = null;
    await this.renderer.setHover(null);
    this.transitioning = true;
    this._labels = [];
    await this.renderer.setFocus(index);
    this.transitioning = false;
    this.placeLabels();
    this.dispatchEvent(new CustomEvent("homeslice-rendered"));
  }

  private levelName(levelId: string) {
    const level = this.house?.levels.find((l) => l.id === levelId);
    if (!level) return levelId;
    return (level.floorId && this.hass?.floors?.[level.floorId]?.name) || level.name;
  }

  private toggleLights(label: Label) {
    if (!label.areaId || !this.hass) return;
    void this.hass.callService("light", label.on ? "turn_off" : "turn_on", {}, { area_id: label.areaId });
  }

  // ----- popup -----

  private roomName(r: PlacedRoom) {
    const areaId = r.room.areaId;
    return (areaId && this.hass?.areas?.[areaId]?.name) || r.room.name || r.room.id;
  }

  private openPopup(key: string) {
    const r = this.rooms.find((x) => x.key === key);
    if (!r || !this.hass) return;
    const areaId = r.room.areaId;
    const override = this.config.popups?.[r.room.id] ?? (areaId ? this.config.popups?.[areaId] : undefined);
    const generated: { title: string; cards: Record<string, unknown>[] }[] =
      override?.mode === "replace" || !areaId
        ? []
        : areaPopup(this.hass, areaId).map((s: PopupSection) => ({ title: this.t(`popup.${s.title}` as StringKey), cards: s.cards }));
    const sections = override?.cards.length ? [...generated, { title: generated.length ? this.t("popup.more") : "", cards: override.cards }] : generated;
    this._popup = { key, name: this.roomName(r), areaId, sections };
  }

  private closePopup() {
    this._popup = null;
    this.popupCards = [];
  }

  /**
   * Creates HA's own cards inside the popup. Card types HA loads lazily are loaded
   * first: some (media control) misbehave when they connect before their config arrives.
   */
  private async fillPopup() {
    if (!this._popup || !this.hass) return;
    const popup = this._popup;
    const helpers = await window.loadCardHelpers?.();
    if (!helpers || this._popup !== popup) return;
    const types = [...new Set(popup.sections.flatMap((s) => s.cards.map((c) => String(c.type))))];
    await Promise.all(types.map((type) => preloadCard(helpers, type)));
    if (this._popup !== popup) return;
    this.popupCards = [];
    const containers = this.renderRoot.querySelectorAll<HTMLElement>(".popup .cards");
    popup.sections.forEach((section, i) => {
      const container = containers[i];
      if (!container) return;
      container.replaceChildren(
        ...section.cards.map((config) => {
          const el = helpers.createCardElement(config);
          el.hass = this.hass;
          this.popupCards.push(el);
          return el;
        }),
      );
    });
  }

  private hoverLevel(index: number | null) {
    if (!this.renderer || this.transitioning || index === this._hover) return;
    this._hover = index;
    void this.renderer.setHover(index);
  }

  private get interactive() {
    return this.config.interactive !== false;
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.interactive || !this.renderer || this.transitioning) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragDistance = 0;
      this.dragged = false;
    }
    if (this.pointers.size === 2) this.pinch = this.pinchDistance();
  }

  private pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.renderer || this.transitioning) return;
    const last = this.pointers.get(e.pointerId);
    if (last) {
      // dragging: one pointer turns, two pointers zoom
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        const d = this.pinchDistance();
        if (this.pinch > 0) this.renderer.zoomBy(d / this.pinch);
        this.pinch = d;
        this.dragged = true;
      } else {
        this.dragDistance += Math.abs(dx) + Math.abs(dy);
        if (this.dragDistance < 6) return;
        this.dragged = true;
        this.hoverLevel(null);
        this.renderer.orbit(-dx * 0.35, dy * 0.25);
      }
      this.afterCameraMove();
      return;
    }
    // hover: mouse only, touch screens have none
    if (e.pointerType !== "mouse") return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = requestAnimationFrame(() => this.hoverLevel(this.renderer?.levelAt(x, y) ?? null));
  }

  private onPointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
  }

  private onWheel(e: WheelEvent) {
    if (!this.interactive || !this.renderer || this.transitioning) return;
    e.preventDefault();
    this.renderer.zoomBy(Math.exp(-e.deltaY * 0.0015));
    this.afterCameraMove();
  }

  private async onDoubleClick() {
    clearTimeout(this.clickTimer);
    if (!this.interactive || !this.renderer || this.transitioning) return;
    this.transitioning = true;
    this._labels = [];
    await this.renderer.resetView();
    this.transitioning = false;
    this.placeLabels();
    this.dispatchEvent(new CustomEvent("homeslice-rendered"));
  }

  /** Labels follow the camera; the readout shows the angle for a while. */
  private afterCameraMove() {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = requestAnimationFrame(() => {
      this.placeLabels();
      const o = this.renderer!.orientation;
      const zoom = this.renderer!.zoom;
      this._readout = this.t("card.camera", { azimuth: Math.round(o.azimuth), elevation: Math.round(o.elevation) }) + (Math.abs(zoom - 1) > 0.01 ? ` · ${zoom.toFixed(1)}×` : "");
      clearTimeout(this.readoutTimer);
      this.readoutTimer = window.setTimeout(() => (this._readout = ""), 2500);
    });
  }

  private onCanvasClick(e: MouseEvent) {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    if (!this.renderer || this.transitioning) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const key = this.renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
    if (!key) return;
    // wait a moment: a second click makes it a double-click (reset view), not a popup
    clearTimeout(this.clickTimer);
    if (!this.interactive) this.openPopup(key);
    else this.clickTimer = window.setTimeout(() => this.openPopup(key), 250);
  }

  // ----- drawing -----

  /** Renders at most once per animation frame, and only when asked to. */
  private scheduleDraw() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const wrap = this.renderRoot.querySelector<HTMLElement>(".wrap");
      if (!wrap || !this.renderer || this.transitioning) return;
      const width = wrap.clientWidth;
      if (!width) return;
      // follow the house's shape, but never taller than the space left below the card's top
      const available = window.innerHeight - Math.max(0, wrap.getBoundingClientRect().top) - 16;
      const height = this.config.height ?? Math.max(200, Math.min(Math.round(width / this.renderer.aspect), available));
      wrap.style.height = `${height}px`;
      this.renderer.render(width, height);
      this.placeLabels();
      this.dispatchEvent(new CustomEvent("homeslice-rendered"));
    });
  }

  private placeLabels() {
    if (!this.renderer || !this.hass) return;
    const labels: Label[] = [];
    for (const r of this.rooms) {
      if (!this.renderer.isLevelVisible(r.levelId)) continue;
      // with a level focused, only that level gets labels
      if (this._level && r.levelId !== this._level) continue;
      const p = this.renderer.project(r.levelId, r.point, 0.05);
      if (!p) continue;
      const areaId = r.room.areaId;
      labels.push({
        key: r.key,
        levelIndex: r.levelIndex,
        ...p,
        name: this.roomName(r),
        temperature: areaId ? areaTemperature(this.hass, areaId) : null,
        areaId,
        hasLights: !!areaId && areaEntities(this.hass, areaId, "light").length > 0,
        on: !!areaId && areaLight(this.hass, areaId) !== null,
      });
    }
    this._labels = labels;
  }

  protected override render() {
    const levels = [...(this.house?.levels ?? [])].reverse();
    return html`
      <ha-card>
        <div class="wrap">
          <canvas
            class=${this.interactive ? "interactive" : ""}
            @click=${this.onCanvasClick}
            @dblclick=${this.onDoubleClick}
            @pointerdown=${this.onPointerDown}
            @pointermove=${this.onPointerMove}
            @pointerup=${this.onPointerUp}
            @pointercancel=${this.onPointerUp}
            @pointerleave=${() => this.pointers.size === 0 && this.hoverLevel(null)}
            @wheel=${this.onWheel}
          ></canvas>
          ${this._readout ? html`<div class="readout">${this._readout}</div>` : nothing}
          ${this._labels.map(
            (l) => html`<div class="label ${this._hover !== null && l.levelIndex > this._hover ? "faded" : ""}" style="left:${l.x}px;top:${l.y}px">
              ${l.hasLights
                ? html`<button
                    class="lamp ${l.on ? "on" : ""}"
                    aria-label=${this.t(l.on ? "card.lights_off" : "card.lights_on", { room: l.name })}
                    @click=${() => this.toggleLights(l)}
                  >
                    <ha-icon icon=${l.on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
                  </button>`
                : nothing}
              <button class="name" @click=${() => this.openPopup(l.key)}>
                <span class="name">${l.name}</span>
                ${l.temperature ? html`<span class="temp">${l.temperature}</span>` : nothing}
              </button>
            </div>`,
          )}
          ${this.house
            ? html`<nav class="levels">
                ${levels.map(
                  (l) => html`<button
                    class="${this._level === l.id ? "active" : ""} ${this._hover === l.index ? "hover" : ""}"
                    @click=${() => this.selectLevel(l.id)}
                    @pointerenter=${(e: PointerEvent) => e.pointerType === "mouse" && this.hoverLevel(l.index)}
                    @pointerleave=${() => this.hoverLevel(null)}
                  >
                    ${this.levelName(l.id)}
                  </button>`,
                )}
                <button class=${this._level === null ? "active" : ""} @click=${() => this.selectLevel(null)}>
                  ${this.t("card.all_floors")}
                </button>
              </nav>`
            : nothing}
          ${this._loading ? html`<div class="overlay">${this.t("card.loading")}</div>` : nothing}
          ${this._error ? html`<div class="overlay error">${this._error}</div>` : nothing}
        </div>
        ${this._popup ? this.renderPopup(this._popup) : nothing}
        ${this._issues.length
          ? html`<details class="issues">
              <summary>${this.t("card.issues", { count: this._issues.length })}</summary>
              <ul>
                ${this._issues.map(
                  (i) =>
                    html`<li class=${i.severity}>
                      <b>${this.t(i.severity === "error" ? "card.issue_error" : "card.issue_warning")}</b>
                      <code>${i.path}</code> ${i.message}
                    </li>`,
                )}
              </ul>
            </details>`
          : nothing}
      </ha-card>
    `;
  }

  private renderPopup(p: Popup) {
    const temperature = p.areaId && this.hass ? areaTemperature(this.hass, p.areaId) : null;
    return html`<div class="backdrop" @click=${() => this.closePopup()}>
      <div class="popup" role="dialog" aria-modal="true" aria-label=${p.name} @click=${(e: Event) => e.stopPropagation()}>
        <header>
          <div>
            <h2>${p.name}</h2>
            ${temperature ? html`<span class="temp">${temperature}</span>` : nothing}
          </div>
          <button class="close" aria-label=${this.t("popup.close")} @click=${() => this.closePopup()}>
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </header>
        ${p.sections.length
          ? p.sections.map(
              (s) => html`<section>
                ${s.title ? html`<h3>${s.title}</h3>` : nothing}
                <div class="cards"></div>
              </section>`,
            )
          : html`<p class="empty">${this.t("popup.empty")}</p>`}
      </div>
    </div>`;
  }

  static override styles = css`
    ha-card {
      overflow: hidden;
      background: none;
      box-shadow: none;
      border: none;
    }
    .wrap {
      position: relative;
      width: 100%;
      min-height: 200px;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }
    canvas.interactive {
      /* drags turn the house instead of scrolling the page */
      touch-action: none;
    }
    .readout {
      position: absolute;
      right: 12px;
      bottom: 12px;
      padding: 4px 10px;
      border-radius: 10px;
      background: var(--card-background-color, rgba(20, 24, 28, 0.85));
      color: var(--secondary-text-color, #aaa);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
    .label {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      pointer-events: none;
    }
    .label button.name {
      pointer-events: auto;
      background: none;
      border: none;
      padding: 2px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      font: inherit;
      color: #fff;
      text-shadow: 0 0 3px #000, 0 0 6px #000;
    }
    .label {
      transition: opacity 0.16s;
    }
    .label.faded {
      opacity: 0.2;
    }
    .label.faded button {
      pointer-events: none;
    }
    .label span.name {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
    .label span.temp {
      font-size: 11px;
      opacity: 0.85;
    }
    .lamp {
      pointer-events: auto;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(20, 24, 28, 0.85);
      color: #c9d1d9;
      display: grid;
      place-items: center;
      cursor: pointer;
      padding: 0;
      --mdc-icon-size: 22px;
    }
    .lamp.on {
      background: #ffcf6b;
      border-color: #ffe6ad;
      color: #3a2a05;
      box-shadow: 0 0 14px rgba(255, 207, 107, 0.6);
    }
    .levels {
      position: absolute;
      left: 8px;
      top: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .levels button {
      min-height: 44px;
      min-width: 120px;
      padding: 0 14px;
      border-radius: 12px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.15));
      background: var(--card-background-color, rgba(20, 24, 28, 0.85));
      color: var(--primary-text-color, #eee);
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }
    .levels button.hover {
      border-color: var(--primary-color);
    }
    .levels button.active {
      border-color: var(--primary-color);
      box-shadow: inset 0 0 0 1px var(--primary-color);
      font-weight: 500;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
      background: rgba(0, 0, 0, 0.55);
      display: grid;
      place-items: center;
      animation: fade 0.18s ease-out;
    }
    .popup {
      width: min(1100px, calc(100vw - 48px));
      max-height: calc(100vh - 48px);
      overflow: auto;
      box-sizing: border-box;
      padding: 20px 24px 24px;
      border-radius: var(--ha-card-border-radius, 16px);
      background: var(--card-background-color, #1c1f24);
      color: var(--primary-text-color, #eee);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
      animation: rise 0.22s ease-out;
    }
    .popup header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 8px;
    }
    .popup h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 600;
    }
    .popup header .temp {
      color: var(--secondary-text-color);
    }
    .popup h3 {
      margin: 16px 0 8px;
      font-size: 14px;
      font-weight: 500;
      color: var(--secondary-text-color);
    }
    .popup .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 8px;
    }
    .popup .close {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: rgba(127, 127, 127, 0.15);
      color: inherit;
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .popup .empty {
      color: var(--secondary-text-color);
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    @keyframes rise {
      from {
        transform: translateY(16px);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .backdrop,
      .popup {
        animation: none;
      }
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--secondary-text-color);
    }
    .overlay.error {
      color: var(--error-color);
      padding: 16px;
      text-align: center;
    }
    .issues {
      padding: 8px 16px 12px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .issues li.error b {
      color: var(--error-color);
    }
    .issues li.warning b {
      color: var(--warning-color);
    }
  `;
}
