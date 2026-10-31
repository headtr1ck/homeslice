import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { areaEntities, areaPopup, areaTemperature, awningExtended, contactOpen, coverOpen, lightsLook, type Hass, type PopupSection } from "../ha/hass";
import { localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { labelPoint } from "../model/geometry";
import type { House, Issue, Room, Vec2 } from "../model/types";
import { listedLights, placeLights, type PlacedLight } from "../model/lights";
import { deriveWalls, innerPolygon, type Wall } from "../model/walls";
import { formatPower, readEnergy, type EnergyPrefs, type EnergyReading } from "../ha/energy";
import { ENERGY_COLORS, HouseRenderer, viewOptions, type ViewOptions } from "../render/scene";

export interface PopupOverride {
  /** `extend` (default) adds the cards after the generated ones, `replace` shows only them. */
  mode?: "extend" | "replace";
  cards: Record<string, unknown>[];
}

export interface HomesliceCardConfig {
  type: string;
  house?: string;
  /** Camera and look: azimuth, elevation, projection, explode, show_outdoor, roof, … */
  view?: Partial<ViewOptions> & { cut_height?: number; cut_below?: number; show_outdoor?: boolean };
  /** Fixed height in px; by default the card follows the house's shape. */
  height?: number;
  /** Popup overrides keyed by room id or area id. */
  popups?: Record<string, PopupOverride>;
  /** Drag to turn, scroll/pinch to zoom, double-click to reset (default false: the view is locked). */
  interactive?: boolean;
  /** Show the energy overlay: solar on the roof, battery, grid and devices with their power flows. */
  energy?: boolean;
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
  room: string;
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

/** The power label of an energy item. */
interface EnergyLabel {
  key: string;
  kind: string;
  /** Where the label sits, and the marker it belongs to. */
  x: number;
  y: number;
  mx: number;
  my: number;
  /** `above`: just above its marker; `left`/`right`: a callout beside the house with a leader line. */
  place: "above" | "left" | "right";
  icon: string;
  name: string;
  text: string;
}

/** Height of a label plus a gap, in CSS px. */
const LABEL_STEP = 48;

/**
 * Callouts for the whole-house view: labels in a column on either side of the house
 * (the side their marker is on), in the order of their markers from top to bottom, never
 * overlapping, each with a leader line to its marker.
 */
export function calloutLayout<T extends { mx: number; my: number }>(
  labels: T[],
  house: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
): (T & { x: number; y: number; place: "left" | "right" })[] {
  const centre = (house.left + house.right) / 2;
  const out: (T & { x: number; y: number; place: "left" | "right" })[] = [];
  for (const side of ["left", "right"] as const) {
    const column = labels.filter((l) => (l.mx < centre) === (side === "left")).sort((a, b) => a.my - b.my);
    // just outside the house, but on the card
    const x = side === "left" ? Math.max(150, house.left - 16) : Math.min(size.width - 150, house.right + 16);
    const ys: number[] = [];
    for (const l of column) ys.push(Math.max(l.my, (ys[ys.length - 1] ?? -Infinity) + LABEL_STEP));
    // pushed off the bottom: move the column up as far as needed
    const over = (ys[ys.length - 1] ?? 0) - (size.height - LABEL_STEP / 2);
    if (over > 0) for (let i = 0; i < ys.length; i++) ys[i] = Math.max(LABEL_STEP / 2 + i * LABEL_STEP, ys[i] - over);
    column.forEach((l, i) => out.push({ ...l, x, y: ys[i], place: side }));
  }
  return out;
}

const ENERGY_ICONS: Record<string, string> = {
  solar: "mdi:solar-power-variant",
  battery: "mdi:home-battery",
  grid: "mdi:transmission-tower",
  inverter: "mdi:lightning-bolt",
  device: "mdi:power-plug",
};

/** A toggle for one lamp, shown on the focused level in rooms with several lights. */
interface LampButton {
  entity: string;
  x: number;
  y: number;
  name: string;
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
    _lampButtons: { state: true },
    _energyLabels: { state: true },
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
  private _lampButtons: LampButton[] = [];
  private _energyLabels: EnergyLabel[] = [];
  /** HA's energy settings (for the overlay's default sensors), once loaded. */
  private energyPrefs: EnergyPrefs | null = null;
  private energyReadings: EnergyReading[] = [];
  private flowFrame = 0;
  private lastFlowFrame = 0;
  private visible = true;
  private intersection?: IntersectionObserver;
  /** Lamps of the whole house, placed for the current HA areas. */
  private lamps: PlacedLight[] = [];
  private lampSignature = "";
  private walls = new Map<string, Wall[]>();
  /** The view options in use (from config.view). */
  private view: Partial<ViewOptions> = {};
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
    this.view = viewOptions(config.view);
    // the overlay puts solar panels on the roof, so it shows the roof unless told not to
    if (config.energy && config.view?.roof === undefined) this.view.roof = true;
    this.loadedFor = undefined;
  }

  static getConfigElement() {
    return document.createElement("homeslice-card-editor");
  }

  static getStubConfig() {
    return { house: "home", view: { azimuth: 250, elevation: 38 } };
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
      // animate energy flows only while the card can be seen
      this.intersection = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        this.animateFlows();
      });
      if (wrap) this.intersection.observe(wrap);
    });
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.flowFrame);
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
        this.renderer.onChange = () => this.scheduleDraw();
      } catch {
        this._error = this.t("card.no_webgl");
        return;
      }
    }
    this.house = house;
    this.walls = walls;
    this.lampSignature = "";
    this.rooms = house.levels.flatMap((level) =>
      level.rooms
        .filter((room) => room.kind !== "void" && (room.kind !== "outdoor" || this.view.showOutdoor !== false))
        .map((room) => ({ key: `${level.id}/${room.id}`, levelId: level.id, levelIndex: level.index, room, point: labelPoint(room.polygon) })),
    );
    this.openings = [...walls.entries()].flatMap(([levelId, ws]) =>
      ws.flatMap((w) => w.openings.filter((o) => o.cover || o.contact).map((o) => ({ levelId, id: o.id, room: o.room, cover: o.cover, contact: o.contact }))),
    );
    this.renderer.setModel(house, walls, this.view);
    if (this.config.energy) {
      this.renderer.setEnergy(house.energy.map((e) => ({ key: `energy-${e.index}`, to: e.to === null ? null : `energy-${e.to}`, kind: e.kind, levelIndex: e.levelIndex, at: e.at, roof: e.roof })));
      if (!this.energyPrefs) void this.loadEnergyPrefs();
    }
    // keep the focused floor across model updates, if it still exists
    const focused = this._level ? house.levels.find((l) => l.id === this._level) : undefined;
    this._level = focused?.id ?? null;
    this._hover = null;
    if (focused) await this.renderer.setFocus(focused.index, false);
    this.stateSignature = "";
    this.syncStates();
    this.scheduleDraw();
  }

  // ----- energy overlay -----

  private onVisibility = () => this.animateFlows();

  private async loadEnergyPrefs() {
    try {
      this.energyPrefs = await this.hass!.callWS<EnergyPrefs>({ type: "energy/get_prefs" });
    } catch {
      this.energyPrefs = { energy_sources: [], device_consumption: [] };
    }
    this.stateSignature = "";
    this.syncStates();
  }

  /** Runs the flow animation (about 30 frames a second) while something flows and the card is seen. */
  private animateFlows() {
    cancelAnimationFrame(this.flowFrame);
    if (!this.config.energy || !this.renderer?.flowing || !this.visible || document.visibilityState === "hidden") return;
    const step = (now: number) => {
      if (!this.renderer || !this.renderer.flowing || !this.visible || document.visibilityState === "hidden") return;
      if (now - this.lastFlowFrame >= 33 && !this.transitioning) {
        this.lastFlowFrame = now;
        this.renderer.draw(now);
      }
      this.flowFrame = requestAnimationFrame(step);
    };
    this.flowFrame = requestAnimationFrame(step);
  }

  private energyLabels(): EnergyLabel[] {
    if (!this.config.energy || !this.house || !this.renderer || !this.hass) return [];
    const out: EnergyLabel[] = [];
    this.house.energy.forEach((e, i) => {
      if (e.kind === "inverter") return;
      const key = `energy-${e.index}`;
      if (this._level && e.levelIndex !== null && this.house!.levels[e.levelIndex]?.id !== this._level) return;
      const p = this.renderer!.projectEnergy(key);
      if (!p) return;
      const r = this.energyReadings[i] ?? { power: null, soc: null, flow: null };
      const name = e.name ?? (e.kind === "device" ? ((this.hass!.states[e.power ?? ""]?.attributes.friendly_name as string | undefined) ?? e.power ?? "") : this.t(`card.energy_${e.kind}` as StringKey));
      // which way it flows, in words
      const still = r.power === null || Math.abs(r.power) < 10;
      const state =
        still ? "" : e.kind === "battery" ? this.t(r.power! > 0 ? "card.energy_discharging" : "card.energy_charging") : e.kind === "grid" ? this.t(r.power! > 0 ? "card.energy_import" : "card.energy_export") : "";
      const text = `${e.kind === "battery" && r.soc !== null ? `${Math.round(r.soc)} % · ` : ""}${formatPower(r.power === null ? null : Math.abs(r.power))}`;
      out.push({ key, kind: e.kind, ...p, mx: p.x, my: p.y, place: "above", icon: ENERGY_ICONS[e.kind] ?? ENERGY_ICONS.device, name: state ? `${name} · ${state}` : name, text });
    });
    // the whole house: callouts beside it, so labels never cover other floors
    const wrap = this.renderRoot.querySelector<HTMLElement>(".wrap");
    if (!this._level && wrap) return calloutLayout(out, this.renderer.screenBounds(), { width: wrap.clientWidth, height: wrap.clientHeight });
    // one floor: next to their markers; labels close together are stacked upwards
    const placed: EnergyLabel[] = [];
    for (const l of [...out].sort((a, b) => b.y - a.y)) {
      while (placed.some((q) => Math.abs(q.x - l.x) < 150 && Math.abs(q.y - l.y) < LABEL_STEP)) l.y -= LABEL_STEP + 2;
      placed.push(l);
    }
    return out;
  }

  // ----- live state -----

  /** Applies lights, covers and contacts; redraws only when something actually changed. */
  private syncStates() {
    if (!this.hass || !this.renderer || !this.house) return;
    const hass = this.hass;
    this.syncLamps(hass);
    const lights = this.rooms.map((r) => lightsLook(hass, this.roomLights(r.key)));
    const lamps = this.lamps.map((l) => lightsLook(hass, [l.entity]));
    const covers = this.openings.map((o) => (o.cover ? coverOpen(hass, o.cover) : null));
    const contacts = this.openings.map((o) => (o.contact ? contactOpen(hass, o.contact) : false));
    const temperatures = this.rooms.map((r) => (r.room.areaId ? areaTemperature(hass, r.room.areaId) : null));
    const awnings = this.rooms.map((r) => (r.room.awning ? awningExtended(hass, r.room.awning, r.room.awningOpen) : null));
    this.energyReadings = this.config.energy ? this.house.energy.map((e) => readEnergy(hass, e, this.energyPrefs)) : [];
    const signature = JSON.stringify([lights, lamps, covers, contacts, temperatures, awnings, this.energyReadings]);
    if (signature === this.stateSignature) return;
    this.stateSignature = signature;
    this.lamps.forEach((l, i) => this.renderer!.setLamp(l.entity, lamps[i]));
    if (this.config.energy) {
      this.renderer.setFlows(Object.fromEntries(this.house.energy.map((e, i) => [`energy-${e.index}`, this.energyReadings[i]?.flow ?? null])));
      this.animateFlows();
    }
    this.rooms.forEach((r, i) => {
      this.renderer!.setRoomLight(r.levelId, r.room.id, lights[i]);
      if (r.room.awning) this.renderer!.setAwning(r.levelId, r.room.id, awnings[i]);
    });
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
    this._lampButtons = [];
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

  /** The room's lights: its placed lamps (its area's and any added in the editor). */
  private roomLights(key: string): string[] {
    return this.lamps.filter((l) => `${l.levelId}/${l.roomId}` === key).map((l) => l.entity);
  }

  private toggleLights(label: Label) {
    const entity_id = this.roomLights(label.key);
    if (!entity_id.length || !this.hass) return;
    void this.hass.callService("light", label.on ? "turn_off" : "turn_on", {}, { entity_id });
  }

  private toggleLamp(lamp: LampButton) {
    void this.hass?.callService("light", lamp.on ? "turn_off" : "turn_on", {}, { entity_id: lamp.entity });
  }

  /** Places the lamps; only redone when the house's lights or their areas change. */
  private syncLamps(hass: Hass) {
    if (!this.house) return;
    const listed = listedLights(this.house);
    const lamps = this.house.levels.flatMap((level) =>
      level.rooms
        .filter((room) => room.kind !== "void")
        .flatMap((room) => {
          const floor = room.kind === "room" ? innerPolygon(room.polygon, this.walls.get(level.id) ?? []) : room.polygon;
          return placeLights(level.id, room, floor, room.areaId ? areaEntities(hass, room.areaId, "light") : [], listed);
        }),
    );
    const signature = JSON.stringify(lamps);
    if (signature === this.lampSignature) return;
    this.lampSignature = signature;
    this.lamps = lamps;
    this.renderer?.setLamps(lamps);
    this.stateSignature = ""; // lamps were rebuilt: apply their states again
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
    // the room's own blinds, contacts and awning, even when HA has them in no area
    const placed = [
      ...this.openings.filter((o) => o.levelId === r.levelId && o.room === r.room.id).flatMap((o) => [o.cover, o.contact]),
      ...this.roomLights(key),
      r.room.awning,
    ].filter((e): e is string => !!e);
    const generated: { title: string; cards: Record<string, unknown>[] }[] =
      override?.mode === "replace"
        ? []
        : areaPopup(this.hass, areaId, placed).map((s: PopupSection) => ({ title: this.t(`popup.${s.title}` as StringKey), cards: s.cards }));
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
    return this.config.interactive === true;
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
    this._lampButtons = [];
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
    const roofed = this.renderer.roofVisible();
    const labels: Label[] = [];
    for (const r of this.rooms) {
      if (!this.renderer.isLevelVisible(r.levelId)) continue;
      // with a level focused, only that level gets labels
      if (this._level && r.levelId !== this._level) continue;
      // under the roof nothing can be seen
      if (roofed && r.levelIndex === this.house!.levels.length - 1) continue;
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
        hasLights: this.roomLights(r.key).length > 0,
        on: lightsLook(this.hass, this.roomLights(r.key)) !== null,
      });
    }
    this._labels = labels;
    // single lamps on the focused level, in rooms with more than one
    const buttons: LampButton[] = [];
    if (this._level && this.renderer.isLevelVisible(this._level)) {
      const perRoom = new Map<string, number>();
      for (const l of this.lamps) perRoom.set(`${l.levelId}/${l.roomId}`, (perRoom.get(`${l.levelId}/${l.roomId}`) ?? 0) + 1);
      for (const l of this.lamps) {
        if (l.levelId !== this._level || (perRoom.get(`${l.levelId}/${l.roomId}`) ?? 0) < 2) continue;
        const p = this.renderer.project(l.levelId, l.at, 0.05);
        if (!p) continue;
        // keep clear of the room's label (lamp button over the name, centred on its point)
        const label = labels.find((x) => x.key === `${l.levelId}/${l.roomId}`);
        if (label && Math.abs(p.x - label.x) < 62 && Math.abs(p.y - label.y) < 64) p.y = label.y + (p.y < label.y ? -64 : 54);
        const state = this.hass.states[l.entity];
        buttons.push({ entity: l.entity, ...p, name: (state?.attributes.friendly_name as string | undefined) ?? l.entity, on: state?.state === "on" });
      }
    }
    this._lampButtons = buttons;
    this._energyLabels = this.energyLabels();
  }

  protected override render() {
    const levels = [...(this.house?.levels ?? [])].reverse();
    return html`
      <ha-card>
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
          ${this._energyLabels.some((e) => e.place !== "above")
            ? html`<svg class="leaders">
                ${this._energyLabels.map(
                  (e) => svg`<line x1=${e.x} y1=${e.y} x2=${e.mx} y2=${e.my} style="stroke:${ENERGY_COLORS[e.kind] ?? ENERGY_COLORS.device}"></line>
                    <circle cx=${e.mx} cy=${e.my} r="3" style="fill:${ENERGY_COLORS[e.kind] ?? ENERGY_COLORS.device}"></circle>`,
                )}
              </svg>`
            : nothing}
          ${this._energyLabels.map(
            (e) => html`<div class="energy-label ${e.kind} ${e.place}" style="left:${e.x}px;top:${e.y}px;--energy:${ENERGY_COLORS[e.kind] ?? ENERGY_COLORS.device}">
              <ha-icon icon=${e.icon}></ha-icon>
              <span class="name">${e.name}</span>
              <span class="value">${e.text}</span>
            </div>`,
          )}
          ${this._lampButtons.map(
            (b) => html`<button
              class="lamp single ${b.on ? "on" : ""}"
              style="left:${b.x}px;top:${b.y}px"
              title=${b.name}
              aria-label=${this.t(b.on ? "card.light_off" : "card.light_on", { light: b.name })}
              @click=${() => this.toggleLamp(b)}
            >
              <ha-icon icon=${b.on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
            </button>`,
          )}
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

  // On phones the popup is a bottom sheet: swipe it down by its top to close it.
  private sheetStart: number | null = null;

  private get sheet() {
    return this.renderRoot.querySelector(".popup") as HTMLElement | null;
  }

  private onSheetDown(e: PointerEvent) {
    if (!window.matchMedia("(max-width: 600px)").matches || (e.target as Element).closest("button")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.sheetStart = e.clientY;
  }

  private onSheetMove(e: PointerEvent) {
    const sheet = this.sheet;
    if (this.sheetStart === null || !sheet) return;
    const dy = Math.max(0, e.clientY - this.sheetStart);
    sheet.style.transition = "none";
    sheet.style.transform = `translateY(${dy}px)`;
  }

  private onSheetUp(e: PointerEvent) {
    const sheet = this.sheet;
    if (this.sheetStart === null || !sheet) return;
    const dy = e.clientY - this.sheetStart;
    this.sheetStart = null;
    sheet.style.transition = "";
    if (dy > 90) this.closePopup();
    else sheet.style.transform = "";
  }

  private renderPopup(p: Popup) {
    const temperature = p.areaId && this.hass ? areaTemperature(this.hass, p.areaId) : null;
    return html`<div class="backdrop" @click=${() => this.closePopup()}>
      <div class="popup" role="dialog" aria-modal="true" aria-label=${p.name} @click=${(e: Event) => e.stopPropagation()}>
        <div
          class="grabber"
          @pointerdown=${this.onSheetDown}
          @pointermove=${this.onSheetMove}
          @pointerup=${this.onSheetUp}
          @pointercancel=${this.onSheetUp}
        ></div>
        <header @pointerdown=${this.onSheetDown} @pointermove=${this.onSheetMove} @pointerup=${this.onSheetUp} @pointercancel=${this.onSheetUp}>
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
    :host {
      container: homeslice / inline-size;
      display: block;
    }
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
    .energy-label {
      position: absolute;
      transform: translate(-50%, calc(-100% - 10px));
      display: grid;
      grid-template-columns: auto auto;
      align-items: center;
      column-gap: 6px;
      padding: 4px 10px 4px 8px;
      border-radius: 10px;
      border: 1px solid var(--energy);
      background: rgba(20, 24, 28, 0.85);
      color: #eef1f4;
      pointer-events: none;
      white-space: nowrap;
      --mdc-icon-size: 18px;
    }
    .energy-label.left {
      transform: translate(-100%, -50%);
    }
    .energy-label.right {
      transform: translate(0, -50%);
    }
    svg.leaders {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
    }
    svg.leaders line {
      stroke-width: 1;
      opacity: 0.7;
    }
    .energy-label ha-icon {
      grid-row: span 2;
      color: var(--energy);
    }
    .energy-label .name {
      font-size: 11px;
      opacity: 0.8;
    }
    .energy-label .value {
      font-size: 13px;
      font-weight: 600;
    }
    .lamp.single {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 30px;
      height: 30px;
      --mdc-icon-size: 17px;
    }
    .lamp.on {
      background: #ffcf6b;
      border-color: #ffe6ad;
      color: #3a2a05;
      box-shadow: 0 0 14px rgba(255, 207, 107, 0.6);
    }
    ha-card {
      position: relative;
    }
    .levels {
      position: absolute;
      left: 8px;
      top: 8px;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    /* narrow cards (phones): the floors become a row of chips above the house */
    @container homeslice (max-width: 600px) {
      .levels {
        position: static;
        flex-direction: row;
        overflow-x: auto;
        padding: 4px 4px 8px;
        scrollbar-width: none;
      }
      .levels button {
        min-width: auto;
        min-height: 40px;
        white-space: nowrap;
        flex: none;
      }
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
    .popup .grabber {
      display: none;
    }
    /* phones: a bottom sheet, swiped down to close */
    @media (max-width: 600px) {
      .backdrop {
        place-items: end stretch;
      }
      .popup {
        width: 100%;
        max-height: 88vh;
        padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px));
        border-radius: var(--ha-card-border-radius, 16px) var(--ha-card-border-radius, 16px) 0 0;
        animation: slide-up 0.24s ease-out;
        transition: transform 0.2s ease-out;
      }
      .popup .grabber {
        display: block;
        position: sticky;
        top: 0;
        height: 24px;
        margin: 0 -16px;
        background: inherit;
        touch-action: none;
        cursor: grab;
        z-index: 1;
      }
      .popup .grabber::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 9px;
        width: 40px;
        height: 5px;
        margin-left: -20px;
        border-radius: 3px;
        background: var(--divider-color, rgba(127, 127, 127, 0.5));
      }
      .popup header {
        touch-action: none;
      }
      .popup .cards {
        grid-template-columns: 1fr;
      }
    }
    @keyframes slide-up {
      from {
        transform: translateY(100%);
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
