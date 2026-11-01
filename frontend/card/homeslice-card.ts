import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { HEATMAP_STEPS, areaEntities, areaIlluminance, areaPopup, areaReading, areaTemperature, daylight, stepColor, contactOpen, coverOpen, lightsLook, type Hass, type PopupSection, alertIcon, areaSensors, type AreaSensors } from "../ha/hass";
import { formatNumber, localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { labelPoint } from "../model/geometry";
import type { House, Issue, Room, Vec2 } from "../model/types";
import { listedLights, placeLights, type PlacedLight } from "../model/lights";
import { deriveWalls, innerPolygon, type Wall } from "../model/walls";
import { formatPower, readEnergy, type EnergyPrefs, type EnergyReading } from "../ha/energy";
import { pollPosition, polledPositions, readRobot, robotStatus, type RobotReading, type RobotStatus } from "../ha/robots";
import { deviceLook } from "../ha/devices";
import { activation, whereIs } from "../ha/follow";
import { ENERGY_COLORS, HouseRenderer, viewOptions, type Look, type ViewOptions } from "../render/scene";

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
  /** Light the house from the real sun (HA's sun.sun) and dim it at night (default true). */
  sun?: boolean;
  /**
   * `day` (lit by the sun), `night` (dark, glowing outlines; for wall tablets at night),
   * `auto` (night after sunset), `white` (a white model, only light and shade) or
   * `blueprint` (dark blue, glowing edges). Default `day`.
   */
  look?: "day" | "night" | "auto" | "white" | "blueprint";
  /** The night look's outline colour (CSS colour, default light blue). */
  accent?: string;
  /**
   * Turn to where something happens: these entities (a doorbell's event or binary sensor,
   * a washer's state, a door contact…) going active show their floor with a note, then
   * the card goes back. Nothing moves while someone uses the card.
   */
  follow?: string[];
  /** Also turn to leak, smoke and gas alarms (default false). */
  follow_alarms?: boolean;
  /** How long to stay there, in seconds (default 30). */
  follow_seconds?: number;
  /**
   * `low` for weak wall tablets (no shadows, plain colours, simple furniture, fewer frames),
   * `high`, or `auto` (default): low on devices with little memory or few cores. Applies when
   * the page loads.
   */
  quality?: "auto" | "high" | "low";
  /**
   * Tint room floors by a reading: `temperature` (blue cold … red hot), `humidity` (dry
   * yellow … damp blue) or `carbon_dioxide` (orange, red when stale). Comfortable rooms
   * keep their look.
   */
  heatmap?: "temperature" | "humidity" | "carbon_dioxide";
  /** Rooms with a lux sensor look as bright as it reads, and show it on their label (default false). */
  lux?: boolean;
  /** Mark rooms with someone in them (motion, occupancy, presence sensors; default true). Leak, smoke and gas alarms always show. */
  presence?: boolean;
  /**
   * `plan`: a drawn floor plan from straight above (dark walls, door swings); `tilted`: a
   * plan seen at an angle with low walls, looking into the rooms. Both show one floor at a
   * time. Default `3d`.
   */
  mode?: "3d" | "plan" | "tilted";
  /** Plans: `all` shows every floor at once, side by side (default: one at a time). */
  floors?: "one" | "all";
  /** The floor shown first (level id); default: the whole house, or in plan mode the entrance floor. */
  level?: string;
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
  presence: boolean;
  alerts: string[];
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

/** Robot status colours (the ring under the robot and its label). */
const ROBOT_COLORS: Record<RobotStatus, string> = {
  active: "#4caf50",
  returning: "#2196f3",
  paused: "#ffb300",
  error: "#e53935",
  docked: "#9e9e9e",
  idle: "#9e9e9e",
  unknown: "#9e9e9e",
};

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
    _dim: { state: true },
    _event: { state: true },
    _energyLabels: { state: true },
    _robotLabels: { state: true },
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
  /** What just happened, shown while the card turned to it. */
  private _event: string | null = null;
  private followed = new Map<string, string>();
  private pollTimer = 0;
  private polledOnce = false;
  private lastTouch = 0;
  private eventTimer = 0;
  /** The floor to go back to after an event (null: all floors). */
  private eventReturn: string | null | undefined = undefined;
  /** The brightness shown while dimming a lamp by dragging. */
  private _dim: { x: number; y: number; pct: number } | null = null;
  private gesture: { id: number; y: number; start: number; pct: number; entities: string[]; dimming: boolean; done: boolean; at: { x: number; y: number } } | null = null;
  private holdTimer = 0;
  private swallowClick = false;
  private holdFrom: { x: number; y: number } | null = null;
  private swipeFrom: { x: number; y: number; at: number } | null = null;
  private _energyLabels: EnergyLabel[] = [];
  private _robotLabels: { key: string; entity: string; x: number; y: number; name: string; text: string; battery: number | null; color: string; icon: string }[] = [];
  private robotReadings: RobotReading[] = [];
  /** HA's energy settings (for the overlay's default sensors), once loaded. */
  private energyPrefs: EnergyPrefs | null = null;
  private energyReadings: EnergyReading[] = [];
  private flowFrame = 0;
  private lastFlowFrame = 0;
  private visible = true;
  private intersection?: IntersectionObserver;
  /** Lamps of the whole house, placed for the current HA areas. */
  private lamps: PlacedLight[] = [];
  /** Entities of linked pieces that are not lights (TVs, fans, fires, curtains…). */
  private devices: string[] = [];
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
    // weak devices: simple furniture unless the card asks for detailed
    if (this.quality === "low" && config.view?.furniture === undefined) this.view.furniture = "simple";
    if (config.mode === "plan") {
      // a floor plan: straight from above, north up, no perspective; no roof over it
      this.view.focus = { azimuth: 180, elevation: 90, projection: "isometric" };
      this.view.levels = {};
      this.view.roof = false;
      this.view.plan = true;
      if (config.floors === "all") {
        // every floor at once, next to each other, from straight above
        this.view.sideBySide = true;
        Object.assign(this.view, { azimuth: 180, elevation: 90, projection: "isometric" });
      }
    } else if (config.mode === "tilted") {
      // a plan at an angle: walls cut low so every room is seen into
      this.view.focus = { azimuth: 180, elevation: 52, projection: "isometric", ...config.view?.focus };
      this.view.levels = {};
      this.view.roof = false;
      this.view.lowWalls = 1.1;
      this.applySavedViews();
    } else this.applySavedViews();
    this.loadedFor = undefined;
  }

  /** The quality to draw with: the card's, or for `auto` what the device can do. */
  private get quality(): "high" | "low" {
    const q = this.config.quality ?? "auto";
    if (q !== "auto") return q;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || (navigator.hardwareConcurrency || 8) <= 2 ? "low" : "high";
  }

  // ----- views: buttons to turn, and a start view saved on this device -----

  private get viewKey() {
    return `homeslice-view:${this.config.house ?? "home"}`;
  }

  private savedViews(): { all?: { azimuth: number; elevation: number }; levels?: Record<string, { azimuth: number; elevation: number }> } {
    try {
      return JSON.parse(localStorage.getItem(this.viewKey) ?? "{}") ?? {};
    } catch {
      return {};
    }
  }

  /** A start view saved on this device wins over the card's (a wall tablet keeps its own). */
  private applySavedViews() {
    const saved = this.savedViews();
    if (saved.all) Object.assign(this.view, saved.all);
    if (saved.levels) this.view.levels = { ...this.view.levels, ...saved.levels };
  }

  private async turnView(dAzimuth: number | null, elevation?: number) {
    if (!this.renderer || this.transitioning) return;
    const o = this.renderer.orientation;
    // a quarter turn keeps the angle to the walls (an overview from a corner stays one)
    this._labels = [];
    this._lampButtons = [];
    await this.renderer.turnTo(o.azimuth + (dAzimuth ?? 0), elevation ?? o.elevation);
    this.placeLabels();
    this.afterCameraMove();
  }

  private saveView() {
    if (!this.renderer) return;
    const o = this.renderer.keepView();
    const saved = this.savedViews();
    if (this._level) saved.levels = { ...saved.levels, [this._level]: o };
    else saved.all = o;
    try {
      localStorage.setItem(this.viewKey, JSON.stringify(saved));
    } catch {
      // no storage (private window): kept until the page reloads
    }
    this._readout = this.t("card.view_saved");
    clearTimeout(this.readoutTimer);
    this.readoutTimer = window.setTimeout(() => (this._readout = ""), 2500);
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
    // someone using the card: events don't move it for a while
    this.addEventListener("pointerdown", this.onTouch, { capture: true });
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
    this.removeEventListener("pointerdown", this.onTouch, { capture: true });
    clearTimeout(this.eventTimer);
    clearInterval(this.pollTimer);
    this.pollTimer = 0;
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
        this.renderer = new HouseRenderer(canvas, { quality: this.quality });
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
    this.renderer.setRobots(house.robots.map((r) => ({ key: `robot-${r.index}`, kind: r.kind, levelIndex: r.levelIndex, dock: r.dock })));
    // pieces linked to something other than a light (lights glow with the lamps)
    this.devices = [...new Set(house.levels.flatMap((l) => l.rooms.flatMap((r) => r.furniture.map((f) => f.entity ?? "")))).values()].filter((e) => e && !e.startsWith("light."));
    // keep the focused floor across model updates, if it still exists; a plan always shows one
    if (!this._level && (this.plan || this.config.level)) this._level = this.startLevel(house);
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

  /** Whether something moves: energy flowing, a linked fan or drum turning, a door opening. */
  private get moving() {
    return !!this.renderer && ((!!this.config.energy && this.renderer.flowing) || this.renderer.spinning || this.renderer.leavesMoving);
  }

  /**
   * Runs the animation while something moves and the card is seen: about 30 frames a
   * second for flows, 15 when only fans turn (a wall tablet runs all day).
   */
  private animateFlows() {
    cancelAnimationFrame(this.flowFrame);
    if (!this.moving || !this.visible || document.visibilityState === "hidden") return;
    const step = (now: number) => {
      if (!this.renderer || !this.moving || !this.visible || document.visibilityState === "hidden") return;
      const frame = this.quality === "low" ? 66 : (this.config.energy && this.renderer.flowing) || this.renderer.leavesMoving ? 33 : 66;
      if (now - this.lastFlowFrame >= frame && !this.transitioning) {
        this.lastFlowFrame = now;
        this.renderer.draw(now);
      }
      this.flowFrame = requestAnimationFrame(step);
    };
    this.flowFrame = requestAnimationFrame(step);
  }

  /** What a tap on a linked piece does: toggle what can be toggled, else HA's details. */
  private useEntity(entity: string) {
    const domain = entity.split(".")[0];
    if (["light", "switch", "fan", "input_boolean"].includes(domain)) void this.hass?.callService("homeassistant", "toggle", {}, { entity_id: entity });
    else this.moreInfo(entity);
  }

  /** HA's own details dialog for an entity. */
  private moreInfo(entityId: string) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  /** Robots: name, what they do and their battery, above them. */
  private robotLabels() {
    if (!this.house || !this.renderer || !this.hass) return [];
    return this.house.robots.flatMap((r, i) => {
      if (this._level && this.house!.levels[r.levelIndex]?.id !== this._level) return [];
      const p = this.renderer!.projectRobot(`robot-${r.index}`);
      const reading = this.robotReadings[i];
      if (!p || !reading) return [];
      const s = this.hass!.states[r.entity];
      const name = r.name ?? (s?.attributes.friendly_name as string | undefined) ?? r.entity;
      const format = (this.hass as unknown as { formatEntityState?: (s: unknown) => string }).formatEntityState;
      const state = s ? (format ? format(s) : s.state) : "";
      return [{ key: `robot-${r.index}`, entity: r.entity, ...p, name, battery: reading.battery, text: `${state}${reading.battery !== null ? ` · ${Math.round(reading.battery)} %` : ""}${reading.unsure ? ` · ${this.t("card.robot_unsure")}` : ""}`, color: ROBOT_COLORS[reading.status], icon: r.kind === "lawn_mower" ? "mdi:robot-mower" : "mdi:robot-vacuum" }];
    });
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
      const text = `${e.kind === "battery" && r.soc !== null ? `${Math.round(r.soc)} % · ` : ""}${formatPower(r.power === null ? null : Math.abs(r.power), this.hass?.locale)}`;
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
    this.followEvents(hass);
    this.syncLamps(hass);
    const lights = this.rooms.map((r) => lightsLook(hass, this.roomLights(r.key)));
    const lamps = this.lamps.map((l) => lightsLook(hass, [l.entity]));
    const inverted = new Set(this.house.invertedCovers);
    const covers = this.openings.map((o) => (o.cover ? coverOpen(hass, o.cover, inverted.has(o.cover)) : null));
    const contacts = this.openings.map((o) => (o.contact ? contactOpen(hass, o.contact) : false));
    const temperatures = this.rooms.map((r) => (r.room.areaId ? areaTemperature(hass, r.room.areaId) : null));
    // lux readings, rounded so small changes don't redraw (outside, the sun does it)
    const lux = this.rooms.map((r) => (this.config.lux && r.room.areaId && r.room.kind === "room" ? areaIlluminance(hass, r.room.areaId) : null)).map((v) => (v === null ? null : Math.round(daylight(v) * 20) / 20));
    // an alarm turns the room's floor red, over its lights
    const sensors = this.rooms.map((r) => this.roomSensors(r.room));
    sensors.forEach((s, i) => {
      if (s.alerts.length) lights[i] = { rgb: [255, 40, 30], brightness: 1 };
    });
    const awnings = this.rooms.map((r) => (r.room.awning ? coverOpen(hass, r.room.awning, inverted.has(r.room.awning)) : null));
    const devices = this.devices.map((entity) => deviceLook(hass, entity, inverted.has(entity)));
    const cameras = this.house.levels.flatMap((l) => l.rooms.flatMap((r) => r.cameras.map((c) => [c.entity, !!c.motion && hass.states[c.motion]?.state === "on"] as const)));
    this.energyReadings = this.config.energy ? this.house.energy.map((e) => readEnergy(hass, e, this.energyPrefs)) : [];
    this.pollRobots(hass);
    this.robotReadings = this.house.robots.map((r) => readRobot(hass, r));
    // the real sun, turned into the plan's directions; rounded so it redraws now and then, not always
    const sun = this.config.sun !== false ? hass.states["sun.sun"]?.attributes : undefined;
    const sunAt = typeof sun?.azimuth === "number" && typeof sun?.elevation === "number" ? [Math.round(sun.azimuth - this.house.north), Math.round(sun.elevation)] : null;
    // the look: auto follows the sun (night while it is below the horizon)
    const look: Look =
      this.config.look === "white" || this.config.look === "blueprint" || this.config.look === "night"
        ? this.config.look
        : this.config.look === "auto" && hass.states["sun.sun"]?.state === "below_horizon"
          ? "night"
          : "day";
    const heat = this.rooms.map((r) => {
      const kind = this.config.heatmap;
      const v = kind && r.room.areaId && r.room.kind === "room" ? areaReading(hass, r.room.areaId, kind) : null;
      return v === null || !kind ? null : stepColor(v, HEATMAP_STEPS[kind] ?? []);
    });
    const signature = JSON.stringify([look, this.config.accent, lux, heat, lights, lamps, covers, contacts, temperatures, sensors, awnings, devices, cameras, this.energyReadings, this.robotReadings, sunAt]);
    if (signature === this.stateSignature) return;
    this.stateSignature = signature;
    this.lamps.forEach((l, i) => this.renderer!.setLamp(l.entity, lamps[i]));
    this.devices.forEach((entity, i) => this.renderer!.setDevice(entity, devices[i]));
    for (const [entity, moving] of cameras) this.renderer.setCameraMotion(entity, moving);
    this.renderer.setLook(look, this.config.accent || undefined);
    this.renderer.setSun(sunAt?.[0] ?? null, sunAt?.[1] ?? null);
    this.house.robots.forEach((r, i) => this.renderer!.setRobotState(`robot-${r.index}`, this.robotReadings[i].at, ROBOT_COLORS[this.robotReadings[i].status], this.robotReadings[i].unsure));
    if (this.config.energy) this.renderer.setFlows(Object.fromEntries(this.house.energy.map((e, i) => [`energy-${e.index}`, this.energyReadings[i]?.flow ?? null])));
    this.rooms.forEach((r, i) => {
      this.renderer!.setRoomLight(r.levelId, r.room.id, lights[i]);
      this.renderer!.setRoomDaylight(r.levelId, r.room.id, lux[i]);
      this.renderer!.setRoomTint(r.levelId, r.room.id, heat[i]);
      if (r.room.awning) this.renderer!.setAwning(r.levelId, r.room.id, awnings[i]);
    });
    this.openings.forEach((o, i) => {
      this.renderer!.setCover(o.id, covers[i]);
      this.renderer!.setContact(o.id, contacts[i]);
    });
    this.animateFlows();
    this.scheduleDraw();
  }

  // ----- robots whose position a service answers -----

  /**
   * Robots with a position service: asked every 2 s while out (cleaning, returning), once
   * otherwise; each answer redraws.
   */
  private pollRobots(hass: Hass) {
    const robots = (this.house?.robots ?? []).filter((r) => r.position?.service);
    const out = robots.some((r) => ["active", "returning", "paused"].includes(robotStatus(hass.states[r.entity]?.state)));
    const ask = () => {
      if (!this.hass) return;
      for (const r of robots)
        void pollPosition(this.hass, r.position!.entity, r.position!.service!).then((at) => {
          if (at) {
            this.stateSignature = "";
            this.syncStates();
          }
        });
    };
    // the first answer for each robot, even docked
    if (robots.some((r) => !polledPositions.has(r.position!.entity)) && !this.polledOnce) {
      this.polledOnce = true;
      ask();
    }
    if (out && !this.pollTimer) this.pollTimer = window.setInterval(ask, 2000);
    else if (!out && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = 0;
      ask(); // where it ended up
    }
  }

  // ----- following events -----

  private onTouch = () => {
    this.lastTouch = Date.now();
  };

  /** Turns to the first followed entity (or alarm) that just went active. */
  private followEvents(hass: Hass) {
    const house = this.house!;
    let hit: { entity: string; text: string } | null = null;
    for (const id of this.config.follow ?? []) {
      const now = hass.states[id]?.state;
      if (activation(id, this.followed.get(id), now) && !hit) hit = { entity: id, text: (hass.states[id]?.attributes.friendly_name as string | undefined) ?? id };
      if (now !== undefined) this.followed.set(id, now);
    }
    if (this.config.follow_alarms)
      for (const r of this.rooms) {
        const alerts = this.roomSensors(r.room).alerts.join(",");
        const before = this.followed.get(`alarm:${r.key}`);
        if (before !== undefined && alerts && alerts !== before && !hit) hit = { entity: `alarm:${r.key}`, text: this.t(`card.alert_${alerts.split(",")[0]}` as StringKey) };
        this.followed.set(`alarm:${r.key}`, alerts);
      }
    if (!hit) return;
    const where = hit.entity.startsWith("alarm:") ? { levelId: hit.entity.slice(6).split("/")[0], roomId: hit.entity.slice(6).split("/")[1] } : whereIs(house, hass, hit.entity, this.openings);
    // someone is using the card, or a popup is open: leave it be
    if (!where || Date.now() - this.lastTouch < 20000 || this._popup) return;
    void this.showEvent(where, hit.text);
  }

  private async showEvent(where: { levelId: string; roomId?: string }, text: string) {
    const room = where.roomId ? this.rooms.find((r) => r.key === `${where.levelId}/${where.roomId}`) : undefined;
    this._event = room ? `${text} · ${this.roomName(room)}` : text;
    // where to go back to (an event already shown keeps the first)
    if (this.eventReturn === undefined) this.eventReturn = this._level;
    if (this._level !== where.levelId) await this.selectLevel(where.levelId);
    clearTimeout(this.eventTimer);
    this.eventTimer = window.setTimeout(() => void this.endEvent(), (this.config.follow_seconds ?? 30) * 1000);
  }

  private async endEvent() {
    const back = this.eventReturn;
    this.eventReturn = undefined;
    this._event = null;
    // not if someone took over in the meantime
    if (back === undefined || Date.now() - this.lastTouch < 20000 || this._level === back) return;
    if (back === null) {
      if (this._level) await this.selectLevel(this._level);
    } else await this.selectLevel(back);
  }

  /** A room's lux reading for its label, when the card shows them. */
  private luxText(r: PlacedRoom): string | null {
    if (!this.config.lux || !this.hass || !r.room.areaId || r.room.kind !== "room") return null;
    const v = areaIlluminance(this.hass, r.room.areaId);
    return v === null ? null : `${formatNumber(this.hass.locale, Math.round(v), 0)} lx`;
  }

  /** A room's motion/presence and alarm sensors, as the card shows them. */
  private roomSensors(room: Room): AreaSensors {
    if (!room.areaId || !this.hass) return { presence: false, alerts: [] };
    const s = areaSensors(this.hass, room.areaId);
    // outside, "moisture" is rain, not a leak
    return { presence: this.config.presence !== false && s.presence, alerts: room.kind === "outdoor" ? [] : s.alerts };
  }

  // ----- floors -----

  private get plan() {
    // one floor at a time: the plan and the tilted plan (unless a plan shows all floors)
    return (this.config?.mode === "plan" && this.config.floors !== "all") || this.config?.mode === "tilted";
  }

  /** The floor shown first: the configured one, else the entrance floor (HA floor level 0), else the lowest. */
  private startLevel(house: House): string | null {
    if (this.config.level && house.levels.some((l) => l.id === this.config.level)) return this.config.level;
    const entrance = house.levels.find((l) => l.floorId && this.hass?.floors?.[l.floorId]?.level === 0);
    return (entrance ?? house.levels.find((l) => l.rooms.some((r) => r.kind === "outdoor")) ?? house.levels[0])?.id ?? null;
  }

  private async selectLevel(id: string | null) {
    if (!this.renderer || !this.house) return;
    // a plan shows one floor all the time
    if (this.plan && (id === null || id === this._level)) return;
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

  // ----- lamp gestures: tap toggles, drag up or down dims, a long press opens the details -----

  private lampDown(e: PointerEvent, entities: string[], long: () => void) {
    if (!entities.length || !this.hass) return;
    e.stopPropagation();
    const button = e.currentTarget as HTMLElement;
    button.setPointerCapture(e.pointerId);
    // where the brightest of them is now (0 when off)
    const start = Math.max(0, ...entities.map((id) => (this.hass!.states[id]?.state === "on" ? Math.round((((this.hass!.states[id].attributes.brightness as number | undefined) ?? 255) / 255) * 100) : 0)));
    const rect = button.getBoundingClientRect();
    const wrap = this.renderRoot.querySelector<HTMLElement>(".wrap")!.getBoundingClientRect();
    this.gesture = { id: e.pointerId, y: e.clientY, start, pct: start, entities, dimming: false, done: false, at: { x: rect.left + rect.width / 2 - wrap.left, y: rect.top - wrap.top } };
    clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      if (!this.gesture || this.gesture.dimming) return;
      this.gesture.done = true;
      long();
    }, 550);
  }

  private lampMove = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId || g.done) return;
    const dy = g.y - e.clientY;
    if (!g.dimming && Math.abs(dy) < 8) return;
    // a drag: no long press any more; 1 % per 1.5 px, up is brighter
    g.dimming = true;
    clearTimeout(this.holdTimer);
    g.pct = Math.max(0, Math.min(100, Math.round(g.start + dy / 1.5)));
    this._dim = { x: g.at.x, y: g.at.y, pct: g.pct };
  };

  private lampUp = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    clearTimeout(this.holdTimer);
    if (g.dimming) {
      g.done = true;
      this._dim = null;
      void this.hass?.callService("light", g.pct > 0 ? "turn_on" : "turn_off", g.pct > 0 ? { brightness_pct: g.pct } : {}, { entity_id: g.entities });
    }
    // the click that follows belongs to the gesture when it dimmed or held
    this.swallowClick = g.done;
    this.gesture = null;
  };

  private lampClick(tap: () => void) {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    tap();
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
          // indirect light washes the walls of the room's floor
          return placeLights(level.id, room, floor, room.areaId ? areaEntities(hass, room.areaId, "light") : [], listed).map((l) => (l.type === "indirect" ? { ...l, outline: floor } : l));
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
      // what its furniture is linked to (a TV, a washing machine, …)
      ...r.room.furniture.map((f) => f.entity),
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
    // plans don't lift floors (side by side, nothing is above anything)
    if (!this.renderer || this.transitioning || index === this._hover || this.plan || this.config.floors === "all") return;
    this._hover = index;
    void this.renderer.setHover(index);
  }

  private get interactive() {
    return this.config.interactive === true;
  }

  private onPointerDown(e: PointerEvent) {
    // a plan: a sideways swipe goes to the next floor (phones have little room for buttons)
    if (this.plan && e.isPrimary) this.swipeFrom = { x: e.clientX, y: e.clientY, at: Date.now() };
    // a long press on a linked piece opens its details (colours for a lamp), turning or not
    clearTimeout(this.holdTimer);
    if (this.renderer && !this.transitioning) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const entity = this.renderer.pickEntity(e.clientX - rect.left, e.clientY - rect.top);
      if (entity) {
        const from = { x: e.clientX, y: e.clientY };
        this.holdFrom = from;
        this.holdTimer = window.setTimeout(() => {
          if (this.holdFrom !== from) return;
          this.swallowClick = true;
          this.moreInfo(entity);
        }, 550);
      }
    }
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
    if (this.holdFrom && Math.hypot(e.clientX - this.holdFrom.x, e.clientY - this.holdFrom.y) > 8) {
      clearTimeout(this.holdTimer);
      this.holdFrom = null;
    }
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
    const sw = this.swipeFrom;
    this.swipeFrom = null;
    if (sw && this.plan && this.house && e.type === "pointerup") {
      const dx = e.clientX - sw.x;
      const dy = e.clientY - sw.y;
      if (Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) / 2 && Date.now() - sw.at < 800) {
        // left: the floor above, right: the floor below
        const levels = this.house.levels;
        const i = levels.findIndex((l) => l.id === this._level);
        const next = levels[i + (dx < 0 ? 1 : -1)];
        if (next) {
          this.swallowClick = true;
          void this.selectLevel(next.id);
        }
      }
    }
    clearTimeout(this.holdTimer);
    this.holdFrom = null;
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
      this._readout = this.t("card.camera", { azimuth: Math.round(o.azimuth), elevation: Math.round(o.elevation) }) + (Math.abs(zoom - 1) > 0.01 ? ` · ${formatNumber(this.hass?.locale, zoom, 1)}×` : "");
      clearTimeout(this.readoutTimer);
      this.readoutTimer = window.setTimeout(() => (this._readout = ""), 2500);
    });
  }

  private onCanvasClick(e: MouseEvent) {
    if (this.swallowClick) {
      // the end of a long press
      this.swallowClick = false;
      return;
    }
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    if (!this.renderer || this.transitioning) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // a piece linked to an entity: lamps and switches toggle, the rest show their details
    const entity = this.renderer.pickEntity(e.clientX - rect.left, e.clientY - rect.top);
    if (entity) {
      clearTimeout(this.clickTimer);
      // (with a free camera, wait: a second click makes it a double-click)
      if (!this.interactive) this.useEntity(entity);
      else this.clickTimer = window.setTimeout(() => this.useEntity(entity), 250);
      return;
    }
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
        temperature: [areaId ? areaTemperature(this.hass, areaId) : null, this.luxText(r)].filter(Boolean).join(" · ") || null,
        areaId,
        ...this.roomSensors(r.room),
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
    this._robotLabels = this.robotLabels();
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
              ${this.plan
                ? nothing
                : html`<button class=${this._level === null ? "active" : ""} @click=${() => this.selectLevel(null)}>
                    ${this.t("card.all_floors")}
                  </button>`}
            </nav>`
          : nothing}
        <div class="wrap">
          <canvas
            class="${this.interactive ? "interactive" : ""} ${this.plan ? "swipe" : ""}"
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
          ${this._event ? html`<div class="event" role="status"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>${this._event}</div>` : nothing}
          ${this.interactive && !this.plan
            ? html`<div class="views">
                <button title=${this.t("card.view_left")} @click=${() => this.turnView(-90)}><ha-icon icon="mdi:rotate-left"></ha-icon></button>
                <button title=${this.t("card.view_top")} @click=${() => this.turnView(null, 89)}><ha-icon icon="mdi:arrow-collapse-down"></ha-icon></button>
                <button title=${this.t("card.view_tilt")} @click=${() => this.turnView(null, 35)}><ha-icon icon="mdi:angle-acute"></ha-icon></button>
                <button title=${this.t("card.view_right")} @click=${() => this.turnView(90)}><ha-icon icon="mdi:rotate-right"></ha-icon></button>
                <button title=${this.t("card.view_save")} @click=${() => this.saveView()}><ha-icon icon="mdi:pin-outline"></ha-icon></button>
              </div>`
            : nothing}
          ${this._labels.map(
            (l) => html`<div class="label ${this._hover !== null && l.levelIndex > this._hover ? "faded" : ""} ${l.alerts.length ? "alert" : ""}" style="left:${l.x}px;top:${l.y}px">
              ${l.hasLights
                ? html`<button
                    class="lamp ${l.on ? "on" : ""}"
                    aria-label=${this.t(l.on ? "card.lights_off" : "card.lights_on", { room: l.name })}
                    title=${this.t("card.lamp_hint")}
                    @pointerdown=${(e: PointerEvent) => this.lampDown(e, this.roomLights(l.key), () => this.openPopup(l.key))}
                    @pointermove=${this.lampMove}
                    @pointerup=${this.lampUp}
                    @pointercancel=${this.lampUp}
                    @click=${() => this.lampClick(() => this.toggleLights(l))}
                  >
                    <ha-icon icon=${l.on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
                  </button>`
                : nothing}
              <button class="name" @click=${() => this.openPopup(l.key)}>
                <span class="name">${l.name}</span>
                ${l.temperature || l.presence || l.alerts.length
                  ? html`<span class="temp"
                      >${l.alerts.map((a) => html`<ha-icon class="alert-icon" icon=${alertIcon(a)} title=${this.t(`card.alert_${a}` as StringKey)}></ha-icon>`)}${l.presence
                        ? html`<ha-icon class="presence" icon="mdi:motion-sensor" title=${this.t("card.presence")}></ha-icon>`
                        : nothing}${l.temperature ?? ""}</span
                    >`
                  : nothing}
              </button>
            </div>`,
          )}
          ${this._robotLabels.map(
            (r) => html`<button class="robot-label" style="left:${r.x}px;top:${r.y}px;--robot:${r.color}" title=${`${r.name}: ${r.text}`} aria-label=${`${r.name}: ${r.text}`}
              @click=${() => this.moreInfo(r.entity)}>
              <ha-icon icon=${r.icon}></ha-icon>${r.battery !== null ? html`<span class="value">${Math.round(r.battery)} %</span>` : nothing}
            </button>`,
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
              aria-description=${this.t("card.lamp_hint")}
              aria-label=${this.t(b.on ? "card.light_off" : "card.light_on", { light: b.name })}
              @pointerdown=${(e: PointerEvent) => this.lampDown(e, [b.entity], () => this.moreInfo(b.entity))}
              @pointermove=${this.lampMove}
              @pointerup=${this.lampUp}
              @pointercancel=${this.lampUp}
              @click=${() => this.lampClick(() => this.toggleLamp(b))}
            >
              <ha-icon icon=${b.on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
            </button>`,
          )}
          ${this._dim ? html`<div class="dim" style="left:${this._dim.x}px;top:${this._dim.y}px"><div class="bar" style="height:${this._dim.pct}%"></div><span>${this._dim.pct} %</span></div>` : nothing}
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
    canvas.swipe:not(.interactive) {
      /* sideways swipes change floors; the page still scrolls up and down */
      touch-action: pan-y;
    }
    .event {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 14px;
      border-radius: 14px;
      background: var(--card-background-color, rgba(20, 24, 28, 0.9));
      border: 1px solid var(--primary-color, #03a9f4);
      color: var(--primary-text-color, #fff);
      font-weight: 600;
      pointer-events: none;
      --mdc-icon-size: 20px;
    }
    .views {
      position: absolute;
      left: 12px;
      bottom: 12px;
      display: flex;
      gap: 4px;
    }
    .views button {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: var(--card-background-color, rgba(20, 24, 28, 0.85));
      color: var(--primary-text-color, #ddd);
      display: grid;
      place-items: center;
      padding: 0;
      cursor: pointer;
      --mdc-icon-size: 20px;
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
      z-index: 1;
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
    /* labels of the floors that slid away while one below is hovered */
    .label.faded {
      opacity: 0;
    }
    .label.faded button {
      pointer-events: none;
    }
    .label span.name {
      font-size: 12px;
      font-weight: 500;
      /* long names break between words instead of running over the next room */
      max-width: 9em;
      text-align: center;
      line-height: 1.15;
    }
    .label span.temp {
      font-size: 11px;
      opacity: 0.85;
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .label span.temp ha-icon {
      --mdc-icon-size: 13px;
    }
    .label.alert button.name {
      background: var(--error-color, #db4437);
      color: #fff;
      animation: homeslice-alert 1.2s ease-in-out infinite;
    }
    .label.alert span.temp {
      opacity: 1;
    }
    @keyframes homeslice-alert {
      50% {
        box-shadow: 0 0 0 8px rgba(219, 68, 55, 0.35);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .label.alert button.name {
        animation: none;
      }
    }
    .dim {
      position: absolute;
      transform: translate(-50%, calc(-100% - 8px));
      width: 44px;
      height: 120px;
      border-radius: 14px;
      background: rgba(20, 24, 28, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.25);
      overflow: hidden;
      pointer-events: none;
      display: grid;
      align-items: end;
    }
    .dim .bar {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(#ffe7a8, #ffc451);
    }
    .dim span {
      position: relative;
      text-align: center;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      text-shadow: 0 0 3px #000;
      padding-bottom: 6px;
    }
    .lamp {
      pointer-events: auto;
      touch-action: none;
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
    /* compact (icon and battery) so it doesn't cover room names; the rest is in its title */
    .robot-label {
      position: absolute;
      /* under the room names, which stay tappable */
      z-index: 0;
      transform: translate(-50%, calc(-100% - 6px));
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 2px 7px 2px 4px;
      border-radius: 12px;
      border: 1px solid var(--robot);
      background: rgba(20, 24, 28, 0.85);
      color: #eef1f4;
      white-space: nowrap;
      cursor: pointer;
      font: inherit;
      --mdc-icon-size: 18px;
    }
    .robot-label ha-icon {
      color: var(--robot);
    }
    .robot-label .value {
      font-size: 11px;
      font-weight: 600;
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
