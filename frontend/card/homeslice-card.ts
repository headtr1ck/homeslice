import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { areaEntities, areaLight, type Hass } from "../ha/hass";
import { localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { labelPoint } from "../model/geometry";
import type { House, Issue, Room, Vec2 } from "../model/types";
import { deriveWalls, type Wall } from "../model/walls";
import { HouseRenderer, type ViewOptions } from "../render/scene";

export interface HomesliceCardConfig {
  type: string;
  house?: string;
  view?: Partial<ViewOptions>;
  /** Fixed height in px; by default the card follows the house's shape. */
  height?: number;
}

interface PlacedRoom {
  key: string;
  levelId: string;
  levelIndex: number;
  room: Room;
  point: Vec2;
}

interface Label {
  key: string;
  x: number;
  y: number;
  name: string;
  areaId?: string;
  hasLights: boolean;
  on: boolean;
}

export class HomesliceCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _issues: { state: true },
    _error: { state: true },
    _loading: { state: true },
    _labels: { state: true },
    _level: { state: true },
  };

  hass?: Hass;
  private config!: HomesliceCardConfig;
  private _issues: Issue[] = [];
  private _error = "";
  private _loading = true;
  private _labels: Label[] = [];
  /** Selected level: the levels above it are hidden. */
  private _level: string | null = null;
  private house?: House;
  private rooms: PlacedRoom[] = [];
  private lightSignature = "";
  private renderer?: HouseRenderer;
  private resizeObserver?: ResizeObserver;
  private loadedFor?: string;
  private frame = 0;

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

  protected override updated(changed: PropertyValues) {
    if (!changed.has("hass") || !this.hass) return;
    // `hass` changes several times a second: load once, then only react to our own lights
    if (this.loadedFor !== this.config.house) {
      this.loadedFor = this.config.house;
      void this.load();
    } else {
      this.syncStates();
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
    this.updateComplete.then(() => {
      const wrap = this.renderRoot.querySelector(".wrap");
      if (wrap) this.resizeObserver?.observe(wrap);
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    this.renderer?.dispose();
    this.renderer = undefined;
    this.loadedFor = undefined;
    this.lightSignature = "";
  }

  private async load() {
    this._loading = true;
    this._error = "";
    try {
      const raw = await this.hass!.callWS<unknown>({ type: "homeslice/model", house: this.config.house });
      const { house, issues } = expandHouse(raw);
      const walls = new Map<string, Wall[]>();
      if (house) for (const level of house.levels) walls.set(level.id, deriveWalls(level, house.walls, issues));
      this._issues = issues;
      if (house) await this.show(house, walls);
    } catch (e) {
      this._error = this.t("card.load_failed", { message: (e as { message?: string }).message ?? String(e) });
    } finally {
      this._loading = false;
    }
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
        .filter((room) => room.kind !== "void")
        .map((room) => ({ key: `${level.id}/${room.id}`, levelId: level.id, levelIndex: level.index, room, point: labelPoint(room.polygon) })),
    );
    this.renderer.setModel(house, walls, this.config.view);
    this.applyLevel();
    this.lightSignature = "";
    this.syncStates();
    this.scheduleDraw();
  }

  /** Applies light states to the rooms; redraws only when something actually changed. */
  private syncStates() {
    if (!this.hass || !this.renderer || !this.house) return;
    const lights = this.rooms.map((r) => (r.room.areaId ? areaLight(this.hass!, r.room.areaId) : null));
    const signature = JSON.stringify(lights);
    if (signature === this.lightSignature) return;
    this.lightSignature = signature;
    this.rooms.forEach((r, i) => this.renderer!.setRoomLight(r.levelId, r.room.id, lights[i]));
    this.scheduleDraw();
  }

  private applyLevel() {
    const index = this._level ? this.house?.levels.find((l) => l.id === this._level)?.index ?? null : null;
    this.renderer?.showLevelsUpTo(index);
  }

  private selectLevel(id: string | null) {
    this._level = this._level === id ? null : id;
    this.applyLevel();
    this.scheduleDraw();
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

  /** Renders at most once per animation frame, and only when asked to. */
  private scheduleDraw() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const wrap = this.renderRoot.querySelector<HTMLElement>(".wrap");
      if (!wrap || !this.renderer) return;
      const width = wrap.clientWidth;
      if (!width) return;
      // follow the house's shape, but never taller than the space left below the card's top
      const available = window.innerHeight - Math.max(0, wrap.getBoundingClientRect().top) - 16;
      const height = this.config.height ?? Math.max(200, Math.min(Math.round(width / this.renderer.aspect), available));
      wrap.style.height = `${height}px`;
      this.renderer.render(width, height);
      this.placeLabels();
    });
  }

  private placeLabels() {
    if (!this.renderer || !this.hass) return;
    const maxIndex = this._level ? this.house?.levels.find((l) => l.id === this._level)?.index ?? Infinity : Infinity;
    const labels: Label[] = [];
    for (const r of this.rooms) {
      if (r.levelIndex > maxIndex) continue;
      const p = this.renderer.project(r.levelId, r.point, 0.05);
      if (!p) continue;
      const areaId = r.room.areaId;
      labels.push({
        key: r.key,
        ...p,
        name: (areaId && this.hass.areas?.[areaId]?.name) || r.room.name || r.room.id,
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
          <canvas></canvas>
          ${this._labels.map(
            (l) => html`<div class="label" style="left:${l.x}px;top:${l.y}px">
              ${l.hasLights
                ? html`<button
                    class="lamp ${l.on ? "on" : ""}"
                    aria-label=${this.t(l.on ? "card.lights_off" : "card.lights_on", { room: l.name })}
                    @click=${() => this.toggleLights(l)}
                  >
                    <ha-icon icon=${l.on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
                  </button>`
                : nothing}
              <span>${l.name}</span>
            </div>`,
          )}
          ${this.house
            ? html`<nav class="levels">
                ${levels.map(
                  (l) => html`<button class=${this._level === l.id ? "active" : ""} @click=${() => this.selectLevel(l.id)}>
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
    .label span {
      font-size: 12px;
      font-weight: 500;
      color: #fff;
      text-shadow: 0 0 3px #000, 0 0 6px #000;
      white-space: nowrap;
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
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(20, 24, 28, 0.85);
      color: var(--primary-text-color, #eee);
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }
    .levels button.active {
      border-color: var(--primary-color);
      background: rgba(40, 60, 90, 0.9);
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
