import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { HEATMAP_STEPS, areaEntities, areaValues, type AreaValue, areaIlluminance, areaPopup, areaReading, areaTemperature, daylight, stepColor, stepBlend, contactOpen, coverOpen, lightsLook, type Hass, type PopupSection, alertIcon, areaSensors, type AreaSensors, alarmTriggered, climateHint, hardAlerts } from "../ha/hass";
import { formatNumber, loadLanguage, localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { labelPoint } from "../model/geometry";
import { walkStep } from "../model/walk";
import type { FurnitureMount, FurnitureType, House, Issue, Room, Vec2 } from "../model/types";
import { defaultKind, kindTags, type Tag } from "../model/modern";
import { listedLights, placeLights, type PlacedLight } from "../model/lights";
import { deriveWalls, innerPolygon, type Wall } from "../model/walls";
import { formatPower, readEnergy, type EnergyPrefs, type EnergyReading } from "../ha/energy";
import { pollPosition, polledPositions, readRobot, robotAlerts, robotStatus, type RobotReading, type RobotStatus } from "../ha/robots";
import { deviceLook } from "../ha/devices";
import { activation, whereIs } from "../ha/follow";
import { ruleMatches, ruleText, type StateRule } from "../ha/rules";
import { clockText, isNight } from "../ha/kiosk";
import { sunPath, sunPosition } from "../ha/sunpath";
import { HISTORY_DOMAINS, loadHistory, statesAt, type History } from "../ha/history";
import { pieceBadge } from "../ha/household";
import { weatherEffect } from "../render/weather";
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
  /**
   * Own Lovelace actions per entity, for the pieces and lamps linked to it, e.g.
   * `light.hall: { tap_action: { action: more-info }, hold_action: { action: perform-action, perform_action: script.night } }`.
   * Without one, lights and switches toggle on a tap and a long press shows their details.
   */
  actions?: Record<string, { tap_action?: Record<string, unknown>; hold_action?: Record<string, unknown> }>;
  /** Lamp buttons: a bare bulb with a soft shadow that glows when on (`icon`, default) or a bulb in a dark disc (`circle`). */
  lamp_style?: "icon" | "circle";
  /**
   * Looks by state for any entity, without code: a pulsing `ring`, the piece's `color`, an
   * `icon` and a `text` (`{state:1} {unit}`) where it is, while `state` / `above` / `below` match.
   */
  rules?: StateRule[];
  /** Desktop: hovering a linked piece shows its name, state and when that changed (default true). */
  tooltips?: boolean;
  /** A short note of what a tap or a drag just did ("Kitchen lights off"); false hides it (default true). */
  feedback?: boolean;
  /** Hours after which a door or window contact that sent nothing counts as silent (default: only when unavailable). */
  sensor_timeout?: number;
  /** A tap on a room opens its panel with everything in its area (default true; false: rooms do nothing). */
  room_panel?: boolean;
  /** Drag to turn, scroll/pinch to zoom, two fingers (or a trackpad scroll) to move, double-click to reset (default false: the view is locked). */
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
  heatmap?: "temperature" | "humidity" | "carbon_dioxide" | "pm25";
  /**
   * Readings on each room's label (default `["temperature"]`; `[]` for none): `temperature`,
   * `humidity`, `carbon_dioxide`, `pm25`, `volatile_organic_compounds`. A dot shows a
   * reading's colour when it is outside the comfortable range.
   */
  values?: string[];
  /** Own colour steps per reading (they replace the defaults, for the labels and the heatmap). */
  thresholds?: Record<string, { value: number; color: string | null }[]>;
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
  /** Wall tablets: seconds without a touch until the start view comes back (popup closed, camera reset). */
  idle_return?: number;
  /** Wall tablets: dim the card at night, `sun` (after sunset) or a time range like `22:00-06:00`. */
  night?: string;
  /** How bright the card is at night (0.1–1, default 0.4). */
  night_brightness?: number;
  /** Wall tablets: turn the house slowly while nobody uses the card (after `idle_return`, else a minute). */
  idle_orbit?: boolean;
  /** Show a clock in the top right corner. */
  clock?: boolean;
  /**
   * Buttons in the bottom right corner: scenes and scripts run, lights and switches
   * toggle, anything else shows its details; own `tap_action`/`hold_action` possible.
   * `level` shows a button only while that floor is picked.
   */
  buttons?: ShortcutButton[];
  /**
   * Warn about windows and doors open while it rains: a rain sensor (binary sensor) or a
   * weather entity (default: the first weather entity; `none` turns it off).
   */
  rain?: string;
  /** A binary sensor that is on during a power outage: the card shows a warning. */
  power_outage?: string;
  /** Notes above linked pieces: bins on pickup day, thirsty plants, post, time left (default true). */
  badges?: boolean;
  /** A weather entity: its condition and temperature in a corner, tap for the forecast. */
  weather?: string;
  /**
   * People in the room they are in: each `person` with a `room` sensor whose state is an
   * area's name or id (Bermuda, ESPresense…). Away people are not shown. `pet: true`: a pet
   * (its `person` may be any tracker; shown while home or on), drawn small, with a paw.
   */
  people?: { person: string; room: string; color?: string; pet?: boolean }[];
  /**
   * Other cards placed freely over the card's area: a Lovelace card config, where (CSS
   * lengths or percentages from the edges), how wide, in front of the house or behind it
   * (behind: decoration, taps go to the house), optionally only on some floors (`levels`,
   * `overview` for the whole house).
   */
  overlays?: CardOverlay[];
  /**
   * Layers the viewer can switch on the card (a layers button; the choice stays on that
   * device): `energy`, `heating`, `heatmap`, `values`, `presence`, `climate`. The card's options are
   * where they start.
   */
  layers?: Layer[];
  /** A button to walk through the house at eye level (keys, a touch stick, drag to look). */
  walk?: boolean;
  /** A button to replay the last day from Home Assistant's history (time travel). */
  time_travel?: boolean;
  /** Today's sun path as an arc around the house, with sunrise and sunset (needs HA's location). */
  sun_path?: boolean;
  /** Rain, snow and fog around the house from that weather (default true). */
  weather_effects?: boolean;
  /** Show underfloor heating loops glowing in the floor while they heat (default false). */
  heating?: boolean;
  /** `smooth`: the heatmap blends across the floors between the readings; `rooms` (default): one colour per room. */
  heatmap_style?: "rooms" | "smooth";
  /** A strip of what needs attention now (alarms, leaks, jammed locks, silent sensors, robots); a tap shows where (default false). */
  warnings?: boolean;
  /** Notes on humid rooms: air it (when the air outside, from `weather`, is drier) or a mould risk (default false). */
  climate_hints?: boolean;
}

/** Colours for people, in the order the card lists them. */
const PERSON_COLORS = ["#4f8cff", "#ff7a59", "#3fbf7f", "#c56cf0", "#f2b134", "#22b5c9"];

/** HA's weather conditions and their icons. */
const WEATHER_ICONS: Record<string, string> = {
  "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", exceptional: "mdi:alert-circle-outline", fog: "mdi:weather-fog", hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy", partlycloudy: "mdi:weather-partly-cloudy", pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy", snowy: "mdi:weather-snowy", "snowy-rainy": "mdi:weather-snowy-rainy", sunny: "mdi:weather-sunny", windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant",
};

/** Weather states that mean rain. */
const RAINY = ["rainy", "pouring", "lightning-rainy", "snowy-rainy", "hail"];

/** An icon for a button by the entity's domain. */
const shortcutIcon = (entity: string) =>
  ({ scene: "mdi:palette", script: "mdi:script-text-play", light: "mdi:lightbulb", switch: "mdi:toggle-switch", cover: "mdi:blinds", lock: "mdi:lock", button: "mdi:gesture-tap-button", media_player: "mdi:play-pause" })[entity.split(".")[0]] ?? "mdi:star";

/** What a viewer can switch on the card (see `layers`). */
export type Layer = "energy" | "heating" | "heatmap" | "values" | "presence" | "climate";

/** Another card placed on the house card (see `overlays`). */
export interface CardOverlay {
  card: Record<string, unknown>;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  width?: string;
  layer?: "front" | "behind";
  levels?: string[];
}

/** What the homeslice.show action names (one of them). */
interface ShowMessage {
  area_id?: string;
  floor_id?: string;
  entity_id?: string;
  seconds?: number;
  /** homeslice.announce: what to show instead of the place's name. */
  message?: string;
}

export interface ShortcutButton {
  entity: string;
  name?: string;
  icon?: string;
  level?: string;
  tap_action?: Record<string, unknown>;
  hold_action?: Record<string, unknown>;
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
  lock?: string;
  blind?: string;
  /** Its middle on the plan and its top (for notes on it). */
  at: Vec2;
  top: number;
}

interface Label {
  key: string;
  levelIndex: number;
  x: number;
  y: number;
  name: string;
  values: AreaValue[];
  lux: string | null;
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
  /** A media player's own panel instead of the area's cards. */
  media?: string;
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
    _note: { state: true },
    _tip: { state: true },
    _ruleMarks: { state: true },
    _event: { state: true },
    _energyLabels: { state: true },
    _robotLabels: { state: true },
    _dockAlerts: { state: true },
    _badges: { state: true },
    _openingBadges: { state: true },
    _sunTimes: { state: true },
    _replay: { state: true },
    _walking: { state: true },
    _layersOpen: { state: true },
    _people: { state: true },
    _level: { state: true },
    _popup: { state: true },
    _hover: { state: true },
    _readout: { state: true },
    _night: { state: true },
    _clock: { state: true },
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
  private _note: string | null = null;
  private _tip: { x: number; y: number; text: string; sub: string } | null = null;
  private _ruleMarks: { key: string; entity: string; x: number; y: number; ring: string | null; icon?: string; text: string }[] = [];
  private noteTimer = 0;
  private gesture: { id: number; y: number; start: number; pct: number; entities: string[]; dimming: boolean; done: boolean; at: { x: number; y: number } } | null = null;
  private holdTimer = 0;
  private swallowClick = false;
  private holdFrom: { x: number; y: number } | null = null;
  private swipeFrom: { x: number; y: number; at: number } | null = null;
  private _energyLabels: EnergyLabel[] = [];
  private _robotLabels: { key: string; entity: string; x: number; y: number; name: string; text: string; battery: number | null; color: string; icon: string }[] = [];
  /** Warnings at robots' docks: what each needs (water, bag, maintenance, errors). */
  private _dockAlerts: { key: string; entity: string; x: number; y: number; items: string[] }[] = [];
  private robotNeeds: string[][] = [];
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
    else if (e.key === "Escape" && this._walking) void this.stopWalk();
  };

  setConfig(config: HomesliceCardConfig) {
    const previous = this.config as HomesliceCardConfig | undefined;
    this.baseConfig = config;
    // the viewer's own layer choices (this device) over the card's
    this.config = { house: "home", ...config, ...this.layerChoices(config) };
    clearInterval(this.kioskTimer);
    this.kioskTimer = this.isConnected && this.kiosk ? window.setInterval(this.kioskTick, 1000) : 0;
    if (!this.kiosk) this._night = false;
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
    // a changed look or what the rooms show applies at once (a new house is drawn by load())
    const visual = ["look", "accent", "heatmap", "values", "thresholds", "lux", "presence", "heating", "badges", "climate_hints", "heatmap_style", "rules"] as const;
    if (this.renderer && this.house && this.hass && visual.some((k) => JSON.stringify(previous?.[k]) !== JSON.stringify(config[k]))) {
      this.stateSignature = "";
      this.syncStates();
      this.scheduleDraw();
    }
  }

  /** The quality to draw with: the card's, or for `auto` what the device can do. */
  private get quality(): "high" | "low" {
    const q = this.config.quality ?? "auto";
    if (q !== "auto") return q;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || (navigator.hardwareConcurrency || 8) <= 2 ? "low" : "high";
  }

  // ----- views: buttons to turn, and a start view saved on this device -----

  // ----- layers the viewer switches -----

  private baseConfig: HomesliceCardConfig = { type: "" };
  private _layersOpen = false;

  private layersKey(config: HomesliceCardConfig = this.config) {
    return `homeslice-layers:${config.house ?? "home"}`;
  }

  /** What this device chose for the layers the card offers (nothing else is overridden). */
  private layerChoices(config: HomesliceCardConfig): Partial<HomesliceCardConfig> {
    const offered = config.layers ?? [];
    if (!offered.length) return {};
    try {
      const saved = JSON.parse(localStorage.getItem(this.layersKey(config)) ?? "{}") as Partial<HomesliceCardConfig>;
      // (the climate layer is the climate_hints option)
      const keys: string[] = offered.map((l) => (l === "climate" ? "climate_hints" : l));
      return Object.fromEntries(Object.entries(saved).filter(([k]) => keys.includes(k))) as Partial<HomesliceCardConfig>;
    } catch {
      return {};
    }
  }

  private setLayer(patch: Partial<HomesliceCardConfig>) {
    let saved: Record<string, unknown> = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.layersKey()) ?? "{}");
    } catch {
      // private mode: the choice lasts until the page reloads
    }
    const next = { ...saved, ...patch };
    try {
      localStorage.setItem(this.layersKey(), JSON.stringify(next));
    } catch {
      // as above
    }
    const view = JSON.stringify(this.config.view);
    this.setConfig(this.baseConfig);
    // the energy overlay changes what is built: build again; the rest only redraws
    if ("energy" in patch || JSON.stringify(this.config.view) !== view) {
      this.loadedFor = undefined;
      this.hass = this.hass;
    } else {
      this.stateSignature = "";
      this.syncStates();
      this.placeLabels();
    }
    this.requestUpdate();
  }

  private renderLayers() {
    const offered = this.config.layers ?? [];
    if (!offered.length) return nothing;
    const c = this.config;
    const check = (layer: Layer, on: boolean, patch: (on: boolean) => Partial<HomesliceCardConfig>) =>
      offered.includes(layer)
        ? html`<label><input type="checkbox" .checked=${on} @change=${(e: Event) => this.setLayer(patch((e.target as HTMLInputElement).checked))} />${this.t(`card.layer_${layer}`)}</label>`
        : nothing;
    return html`<button class="layers-open" title=${this.t("card.layers")} aria-expanded=${this._layersOpen} @click=${() => (this._layersOpen = !this._layersOpen)}><ha-icon icon="mdi:layers-outline"></ha-icon></button>
      ${this._layersOpen
        ? html`<div class="layers" role="group" aria-label=${this.t("card.layers")}>
            ${check("energy", !!c.energy, (on) => ({ energy: on }))}
            ${check("heating", !!c.heating, (on) => ({ heating: on }))}
            ${check("values", (c.values ?? ["temperature"]).length > 1, (on) => ({ values: on ? ["temperature", "humidity", "carbon_dioxide"] : ["temperature"] }))}
            ${check("presence", c.presence !== false, (on) => ({ presence: on }))}
            ${check("climate", !!c.climate_hints, (on) => ({ climate_hints: on }))}
            ${offered.includes("heatmap")
              ? html`<label
                  >${this.t("card.layer_heatmap")}
                  <select @change=${(e: Event) => this.setLayer({ heatmap: ((e.target as HTMLSelectElement).value || undefined) as HomesliceCardConfig["heatmap"] })}>
                    ${(["", "temperature", "humidity", "carbon_dioxide", "pm25"] as const).map((h) => html`<option value=${h} ?selected=${(c.heatmap ?? "") === h}>${this.t(`cardeditor.heatmap_${h || "none"}`)}</option>`)}
                  </select>
                </label>`
              : nothing}
          </div>`
        : nothing}`;
  }

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
    void loadLanguage(hass?.locale?.language).then((loaded) => {
      if (!loaded) return;
      this.requestUpdate();
      this.scheduleDraw();
    });
    if (!hass || !this.config) return;
    for (const c of this.popupCards) c.hass = hass;
    if (this._popup?.media) this.requestUpdate();
    for (const c of this.overlayCards.values()) c.hass = hass;
    if (this.loadedFor !== this.config.house) {
      this.loadedFor = this.config.house;
      void this.load();
    } else {
      this.syncStates();
    }
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has("_popup")) void this.fillPopup();
    if (this.config.overlays?.length) void this.fillOverlays();
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
    // someone using the card: events don't move it for a while
    this.addEventListener("pointerdown", this.onTouch, { capture: true });
    if (this.config && this.kiosk) {
      this.kioskTick();
      this.kioskTimer = window.setInterval(this.kioskTick, 1000);
    }
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
    clearInterval(this.kioskTimer);
    this.kioskTimer = 0;
    clearInterval(this.replayTimer);
    void this.unsubscribeShow?.();
    this.unsubscribeShow = undefined;
    clearInterval(this.orbitTimer);
    this.orbitTimer = 0;
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
        // the homeslice.show action (Assist: "show the living room"): fly there
        void this.unsubscribeShow?.();
        this.unsubscribeShow = await this.hass!.connection.subscribeMessage<ShowMessage>((m) => void this.showAsked(m), { type: "homeslice/show/subscribe" }).catch(() => undefined);
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
      ws.flatMap((w) =>
        w.openings
          .filter((o) => o.cover || o.contact || o.lock || o.blind)
          .map((o) => {
            const len = Math.hypot(w.line[1][0] - w.line[0][0], w.line[1][1] - w.line[0][1]) || 1;
            const t = (o.start + o.end) / 2 / len;
            const at: Vec2 = [w.line[0][0] + (w.line[1][0] - w.line[0][0]) * t, w.line[0][1] + (w.line[1][1] - w.line[0][1]) * t];
            return { levelId, id: o.id, room: o.room, cover: o.cover, contact: o.contact, lock: o.lock, blind: o.blind, at, top: o.sill + o.height };
          }),
      ),
    );
    this.renderer.setModel(house, walls, this.view);
    this.sunPathKey = "";
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
    return !!this.renderer && ((!!this.config.energy && this.renderer.flowing) || this.renderer.spinning || this.renderer.leavesMoving || this.renderer.weatherFalling);
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
    if (this.ownAction(entity, "tap")) return;
    const domain = entity.split(".")[0];
    // (a blind or an awning opens or closes)
    if (domain === "media_player") this._popup = { key: entity, name: this.entityName(entity), media: entity, sections: [] };
    else if (["light", "switch", "fan", "input_boolean", "cover"].includes(domain)) {
      this.noteToggle(entity);
      void this.hass?.callService("homeassistant", "toggle", {}, { entity_id: entity });
    } else this.moreInfo(entity);
  }

  // ----- feedback: a short note of what a tap or a drag did -----

  /** Shows a note for two seconds, unless the card opts out with `feedback: false`. */
  private note(text: string) {
    if (this.config.feedback === false) return;
    this._note = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => (this._note = null), 2200);
  }

  private entityName(entity: string) {
    return (this.hass?.states[entity]?.attributes.friendly_name as string | undefined) ?? entity;
  }

  /** The note for toggling an entity, from the state it is in now. */
  private noteToggle(entity: string) {
    const state = this.hass?.states[entity]?.state;
    if (!state) return;
    const name = this.entityName(entity);
    if (entity.startsWith("cover.")) this.note(this.t(state === "closed" || state === "closing" ? "card.note_opening" : "card.note_closing", { name }));
    else if (entity.startsWith("lock.")) this.note(this.t(state === "locked" ? "card.note_unlocked" : "card.note_locked", { name }));
    else if (entity.startsWith("media_player.")) this.note(this.t(state === "off" ? "card.note_on" : "card.note_off", { name }));
    else this.note(this.t(state === "on" ? "card.note_off" : "card.note_on", { name }));
  }

  /** Runs the card's own action for an entity through HA's action handler; false if it has none. */
  private ownAction(entity: string, kind: "tap" | "hold"): boolean {
    const own = this.config.actions?.[entity];
    if (!own?.[`${kind}_action`]) return false;
    this.dispatchEvent(new CustomEvent("hass-action", { detail: { config: { entity, ...own }, action: kind }, bubbles: true, composed: true }));
    return true;
  }

  /** A long press: the card's own hold action, else HA's details. */
  private hold(entity: string) {
    if (!this.ownAction(entity, "hold")) this.moreInfo(entity);
  }

  // ----- other cards on the card -----

  /** Card elements by their place in `overlays` (made once, kept while the config is). */
  private overlayCards = new Map<string, HTMLElement & { hass?: Hass }>();

  private renderOverlays(layer: "front" | "behind") {
    const list = (this.config.overlays ?? []).map((o, i) => ({ o, i })).filter(({ o }) => (o.layer ?? "front") === layer && o.card);
    if (!list.length) return nothing;
    const shown = (o: CardOverlay) => !o.levels?.length || o.levels.includes(this._level ?? "overview");
    return list.map(({ o, i }) => {
      const style = [o.top !== undefined ? `top:${o.top}` : "", o.left !== undefined ? `left:${o.left}` : "", o.right !== undefined ? `right:${o.right}` : "", o.bottom !== undefined ? `bottom:${o.bottom}` : "", `width:${o.width ?? "260px"}`].filter(Boolean).join(";");
      return html`<div class="card-overlay ${layer} ${shown(o) ? "" : "hidden"}" data-overlay=${i} style=${style}></div>`;
    });
  }

  /** Puts HA's cards into their places (after a render; made once per config). */
  private async fillOverlays() {
    const overlays = this.config.overlays ?? [];
    if (!overlays.length || !this.hass) return;
    const helpers = await window.loadCardHelpers?.();
    if (!helpers) return;
    for (const [i, o] of overlays.entries()) {
      const box = this.renderRoot.querySelector<HTMLElement>(`.card-overlay[data-overlay="${i}"]`);
      if (!box) continue;
      const key = `${i}:${JSON.stringify(o.card)}`;
      let el = this.overlayCards.get(key);
      if (!el) {
        await preloadCard(helpers, String(o.card.type));
        el = helpers.createCardElement(o.card);
        this.overlayCards.set(key, el);
      }
      el.hass = this.hass;
      if (el.parentElement !== box) box.replaceChildren(el);
    }
  }

  // ----- people -----

  /** Where each person is: their room sensor's area, a spot of their own in it. */
  private placedPeople(hass: Hass) {
    const out: { key: string; levelId: string; at: Vec2; color: string; name: string; picture?: string; pet?: boolean }[] = [];
    const perRoom = new Map<string, number>();
    (this.config.people ?? []).forEach((p, i) => {
      const person = hass.states[p.person];
      if (!person || !(person.state === "home" || (p.pet && person.state === "on"))) return;
      const value = hass.states[p.room]?.state ?? "";
      const areaId = hass.areas?.[value] ? value : Object.values(hass.areas ?? {}).find((a) => a.name.toLowerCase() === value.toLowerCase())?.area_id;
      const r = areaId ? this.rooms.find((x) => x.room.areaId === areaId) : undefined;
      if (!r) return;
      // side by side when several are in one room, a little off its label
      const n = perRoom.get(r.key) ?? 0;
      perRoom.set(r.key, n + 1);
      const at: Vec2 = [r.point[0] + 0.7 + n * 0.5, r.point[1] + 0.4];
      out.push({ key: p.person, levelId: r.levelId, at, color: p.color ?? PERSON_COLORS[i % PERSON_COLORS.length], name: (person.attributes.friendly_name as string | undefined) ?? p.person, picture: person.attributes.entity_picture as string | undefined, ...(p.pet ? { pet: true } : {}) });
    });
    return out;
  }

  private personLabels() {
    if (!this.renderer || !this.hass) return [];
    return this.placedPeople(this.hass).flatMap((p) => {
      if ((this._level && p.levelId !== this._level) || !this.renderer!.isLevelVisible(p.levelId)) return [];
      const xy = this.renderer!.project(p.levelId, p.at, p.pet ? 0.75 : 1.75);
      return xy ? [{ ...p, ...xy }] : [];
    });
  }

  // ----- walking through the house -----

  private _walking = false;
  private lookFrom: { x: number; y: number } | null = null;
  private walkKeys = new Set<string>();
  private walkFrame = 0;
  /** The touch stick: -1…1 forward and sideways (turning). */
  private stick: { forward: number; turn: number } | null = null;

  private async startWalk() {
    if (!this.house || !this.renderer) return;
    const levelId = this._level ?? this.startLevel(this.house) ?? this.house.levels[0]?.id;
    const level = this.house.levels.find((l) => l.id === levelId);
    const room = level?.rooms.find((r) => r.kind === "room") ?? level?.rooms[0];
    if (!level || !room) return;
    this.closePopup();
    this.walkReturn = this._level;
    if (this._level !== level.id) await this.selectLevel(level.id);
    this._walking = true;
    this._labels = [];
    this._lampButtons = [];
    this.renderer.setWalk({ levelId: level.id, at: labelPoint(room.polygon), yaw: 180, pitch: -5 });
    window.addEventListener("keydown", this.walkKeyDown);
    window.addEventListener("keyup", this.walkKeyUp);
  }

  private async stopWalk() {
    this._walking = false;
    this.walkKeys.clear();
    this.stick = null;
    cancelAnimationFrame(this.walkFrame);
    this.walkFrame = 0;
    window.removeEventListener("keydown", this.walkKeyDown);
    window.removeEventListener("keyup", this.walkKeyUp);
    this.renderer?.setWalk(null);
    // back to what was shown before
    const back = this.walkReturn;
    if (back !== this._level) await this.selectLevel(back ?? this._level);
    else await this.renderer?.resetView();
    this.placeLabels();
  }

  private walkReturn: string | null = null;

  private walkKeyDown = (e: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)) return;
    e.preventDefault();
    this.walkKeys.add(e.key.toLowerCase());
    this.walkLoop();
  };

  private walkKeyUp = (e: KeyboardEvent) => {
    this.walkKeys.delete(e.key.toLowerCase());
  };

  /** Moves while keys are held or the stick is pushed: about 1.4 m and 90° a second. */
  private walkLoop() {
    if (this.walkFrame) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = this.walkKeys;
      const forward = (k.has("arrowup") || k.has("w") ? 1 : 0) - (k.has("arrowdown") || k.has("s") ? 1 : 0) + (this.stick?.forward ?? 0);
      const turn = (k.has("arrowright") || k.has("d") ? 1 : 0) - (k.has("arrowleft") || k.has("a") ? 1 : 0) + (this.stick?.turn ?? 0);
      if (!this._walking || (!forward && !turn) || !this.renderer?.walking || !this.house) {
        this.walkFrame = 0;
        return;
      }
      this.walkStep(forward * 1.4 * dt, turn * 90 * dt);
      this.walkFrame = requestAnimationFrame(step);
    };
    this.walkFrame = requestAnimationFrame(step);
  }

  /** One step: turn, then move forward as far as walls allow. */
  walkStep(metres: number, degrees: number) {
    const v = this.renderer?.walking;
    const level = this.house?.levels.find((l) => l.id === v?.levelId);
    if (!v || !level) return;
    const yaw = v.yaw + degrees;
    const a = (yaw * Math.PI) / 180;
    const to: Vec2 = [v.at[0] + Math.sin(a) * metres, v.at[1] - Math.cos(a) * metres];
    const at = walkStep(level, this.walls.get(level.id) ?? [], v.at, to);
    this.renderer!.setWalk({ ...v, yaw, at });
  }

  private onStick = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (e.type === "pointerdown") el.setPointerCapture(e.pointerId);
    if (e.type === "pointerup" || e.type === "pointercancel") {
      this.stick = null;
      el.style.setProperty("--sx", "0px");
      el.style.setProperty("--sy", "0px");
      return;
    }
    if (e.type === "pointermove" && !el.hasPointerCapture(e.pointerId)) return;
    const r = el.getBoundingClientRect();
    const half = r.width / 2;
    const dx = Math.max(-1, Math.min(1, (e.clientX - r.left - half) / half));
    const dy = Math.max(-1, Math.min(1, (e.clientY - r.top - half) / half));
    el.style.setProperty("--sx", `${dx * half * 0.6}px`);
    el.style.setProperty("--sy", `${dy * half * 0.6}px`);
    this.stick = { forward: -dy, turn: dx };
    this.walkLoop();
  };

  private renderWalk() {
    if (!this.config.walk || !this.house) return nothing;
    if (!this._walking) return html`<button class="walk-open" title=${this.t("card.walk")} @click=${() => this.startWalk()}><ha-icon icon="mdi:walk"></ha-icon></button>`;
    return html`<div class="stick" @pointerdown=${this.onStick} @pointermove=${this.onStick} @pointerup=${this.onStick} @pointercancel=${this.onStick} aria-hidden="true"><i></i></div>
      <button class="walk-close" title=${this.t("card.walk_stop")} @click=${() => this.stopWalk()}><ha-icon icon="mdi:close"></ha-icon></button>
      <div class="walk-hint">${this.t("card.walk_hint")}</div>`;
  }

  // ----- time travel -----

  private _replay: { history: History; t: number; playing: boolean; loading?: boolean } | null = null;
  private replayTimer = 0;

  private async openTimeTravel() {
    if (!this.hass) return;
    const ids = Object.keys(this.hass.states).filter((id) => HISTORY_DOMAINS.includes(id.split(".")[0]));
    const now = Date.now();
    this._replay = { history: { start: now - 864e5, end: now, series: new Map(), events: [] }, t: now - 864e5, playing: false, loading: true };
    try {
      const history = await loadHistory(this.hass, ids, 24, now);
      if (!this._replay) return;
      this._replay = { history, t: history.start, playing: true };
      this.playReplay();
    } catch {
      this.closeTimeTravel();
    }
  }

  private playReplay() {
    clearInterval(this.replayTimer);
    if (!this._replay?.playing) return;
    // a day in about fifty seconds
    this.replayTimer = window.setInterval(() => {
      const r = this._replay;
      if (!r) return clearInterval(this.replayTimer);
      const t = Math.min(r.history.end, r.t + 3 * 60000);
      this._replay = { ...r, t, playing: t < r.history.end };
      this.stateSignature = "";
      this.syncStates();
      if (t >= r.history.end) clearInterval(this.replayTimer);
    }, 100);
  }

  private seekReplay(t: number) {
    if (!this._replay) return;
    this._replay = { ...this._replay, t, playing: false };
    clearInterval(this.replayTimer);
    this.stateSignature = "";
    this.syncStates();
  }

  private closeTimeTravel() {
    clearInterval(this.replayTimer);
    this._replay = null;
    this.stateSignature = "";
    this.syncStates();
  }

  private renderTimeTravel() {
    if (!this.config.time_travel) return nothing;
    const r = this._replay;
    if (!r) return html`<button class="time-travel-open" title=${this.t("card.time_travel")} @click=${() => this.openTimeTravel()}><ha-icon icon="mdi:history"></ha-icon></button>`;
    const span = r.history.end - r.history.start || 1;
    const when = new Date(r.t);
    return html`<div class="time-travel" role="group" aria-label=${this.t("card.time_travel")}>
      <button title=${r.playing ? this.t("card.pause") : this.t("card.play")} ?disabled=${!!r.loading} @click=${() => {
        if (!this._replay) return;
        const restart = this._replay.t >= this._replay.history.end;
        this._replay = { ...this._replay, playing: !this._replay.playing, t: restart ? this._replay.history.start : this._replay.t };
        this.playReplay();
      }}><ha-icon icon=${r.playing ? "mdi:pause" : "mdi:play"}></ha-icon></button>
      <div class="track">
        ${r.history.events.map((e) => html`<i class="tick" style="left:${((e.t - r.history.start) / span) * 100}%"></i>`)}
        <input type="range" min=${r.history.start} max=${r.history.end} step="60000" .value=${String(r.t)} @input=${(e: Event) => this.seekReplay(Number((e.target as HTMLInputElement).value))} />
      </div>
      <span class="when">${r.loading ? "…" : `${when.toDateString() === new Date().toDateString() ? "" : `${this.t("card.yesterday")} `}${clockText(this.hass, when)}`}</span>
      <button title=${this.t("card.back_to_now")} @click=${() => this.closeTimeTravel()}><ha-icon icon="mdi:close"></ha-icon></button>
    </div>`;
  }

  // ----- the sun's path -----

  private sunPathKey = "";
  private _sunTimes: { x: number; y: number; text: string }[] = [];
  private sunTimes: Date[] = [];

  /** Draws today's sun path (again when the day or the sun's place on it changes). */
  private updateSunPath(hass: Hass) {
    const lat = hass.config?.latitude;
    const lon = hass.config?.longitude;
    if (!this.config.sun_path || lat === undefined || lon === undefined || !this.house || !this.renderer) {
      if (this.renderer?.sunPathShown) {
        this.renderer.setSunPath(null, null);
        this.sunTimes = [];
        this.scheduleDraw();
      }
      this.sunPathKey = "";
      return;
    }
    const now = new Date();
    // redraw every ten minutes: the sun moves along
    const key = `${now.toDateString()}/${Math.floor((now.getHours() * 60 + now.getMinutes()) / 10)}/${this.house.north}`;
    if (key === this.sunPathKey) return;
    this.sunPathKey = key;
    const path = sunPath(now, lat, lon);
    const turn = (p: { azimuth: number; elevation: number }) => ({ azimuth: p.azimuth - this.house!.north, elevation: p.elevation });
    const here = sunPosition(now, lat, lon);
    this.renderer.setSunPath(path.map(turn), turn(here));
    const up = path.filter((p) => p.elevation > 0);
    this.sunTimes = up.length ? [up[0].time, up.at(-1)!.time] : [];
    this.scheduleDraw();
  }

  private sunTimeLabels() {
    if (!this.renderer || !this.sunTimes.length || this._level) return [];
    const fmt = (d: Date) => clockText(this.hass, d);
    return this.renderer.projectSunPath().map((p, i) => ({ ...p, text: `${i ? "☾ " : "☀ "}${fmt(this.sunTimes[i])}` }));
  }

  // ----- weather -----

  private renderWeather() {
    const id = this.config.weather;
    const st = id ? this.hass?.states[id] : undefined;
    if (!id || !st) return nothing;
    const t = Number(st.attributes.temperature);
    const unit = (st.attributes.temperature_unit as string | undefined) ?? "°";
    const text = Number.isFinite(t) ? `${formatNumber(this.hass?.locale, t, Math.abs(t) < 10 && !Number.isInteger(t) ? 1 : 0)} ${unit}` : "";
    return html`<button class="weather ${this.config.clock ? "below-clock" : ""}" title=${st.state} @click=${() => this.moreInfo(id)}>
      <ha-icon icon=${WEATHER_ICONS[st.state] ?? "mdi:weather-partly-cloudy"}></ha-icon><span>${text}</span>
    </button>`;
  }

  // ----- shortcut buttons -----

  private shortcutHold = 0;
  private shortcutHeld = false;

  private renderShortcuts() {
    const buttons = (this.config.buttons ?? []).filter((b) => b.entity && (!b.level || b.level === this._level));
    if (!buttons.length || !this.hass) return nothing;
    return html`<div class="shortcuts">
      ${buttons.map((b) => {
        const state = this.hass!.states[b.entity];
        const name = b.name ?? (state?.attributes.friendly_name as string | undefined) ?? b.entity;
        const icon = b.icon ?? (state?.attributes.icon as string | undefined) ?? shortcutIcon(b.entity);
        return html`<button
          class=${state?.state === "on" ? "on" : ""}
          title=${name}
          @pointerdown=${() => {
            this.shortcutHeld = false;
            clearTimeout(this.shortcutHold);
            this.shortcutHold = window.setTimeout(() => {
              this.shortcutHeld = true;
              if (b.hold_action) this.dispatchEvent(new CustomEvent("hass-action", { detail: { config: b, action: "hold" }, bubbles: true, composed: true }));
              else this.moreInfo(b.entity);
            }, 550);
          }}
          @pointerup=${() => clearTimeout(this.shortcutHold)}
          @pointerleave=${() => clearTimeout(this.shortcutHold)}
          @click=${() => !this.shortcutHeld && this.useShortcut(b)}
        >
          <ha-icon icon=${icon}></ha-icon><span>${name}</span>
        </button>`;
      })}
    </div>`;
  }

  private useShortcut(b: ShortcutButton) {
    if (b.tap_action) {
      this.dispatchEvent(new CustomEvent("hass-action", { detail: { config: b, action: "tap" }, bubbles: true, composed: true }));
      return;
    }
    const domain = b.entity.split(".")[0];
    const name = b.name ?? this.entityName(b.entity);
    if (domain === "scene" || domain === "script") {
      this.note(this.t("card.note_ran", { name }));
      void this.hass?.callService(domain, "turn_on", {}, { entity_id: b.entity });
    } else if (["light", "switch", "fan", "input_boolean", "cover", "lock", "media_player"].includes(domain)) {
      this.noteToggle(b.entity);
      void this.hass?.callService("homeassistant", "toggle", {}, { entity_id: b.entity });
    } else if (domain === "button" || domain === "input_button") {
      this.note(this.t("card.note_pressed", { name }));
      void this.hass?.callService(domain, "press", {}, { entity_id: b.entity });
    } else this.moreInfo(b.entity);
  }

  /** HA's own details dialog for an entity. */
  private moreInfo(entityId: string) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  private _people: { key: string; x: number; y: number; color: string; name: string; picture?: string; pet?: boolean }[] = [];
  private _badges: { entity: string; x: number; y: number; icon: string; text: string; urgent: boolean }[] = [];
  private _openingBadges: { key: string; entity: string; x: number; y: number; icon: string; text: string; urgent: boolean; lock?: boolean }[] = [];

  /** A placed piece's tags, from its built-in model (or the type's default piece). */
  private pieceTags(f: { type: FurnitureType; model?: string; mount: FurnitureMount }): Tag[] {
    const kind = f.model?.startsWith("modern:") ? f.model.slice(7) : f.model ? undefined : defaultKind(f.type, f.mount);
    return kindTags(kind, f.type);
  }

  /** Notes above the linked pieces that need attention, on the floors shown. */
  private pieceBadges() {
    if (!this.house || !this.renderer || !this.hass || this.config.badges === false) return [];
    return this.house.levels.flatMap((level) => {
      if ((this._level && level.id !== this._level) || !this.renderer!.isLevelVisible(level.id)) return [];
      return level.rooms.flatMap((room) =>
        room.furniture.flatMap((f) => {
          const tags = this.pieceTags(f);
          // a car that is away: no piece, no note
          if (f.entity && deviceLook(this.hass!, f.entity)?.present === false) return [];
          const badge = f.entity ? pieceBadge(this.hass!, f.entity, tags) : null;
          // else its readings (a car's charge and range)
          const readings = (f.readings ?? []).map((r) => this.detailText({ entity: r, name: "" }, "")).filter(Boolean);
          if (!badge && !readings.length) return [];
          const p = this.renderer!.project(level.id, f.at, (f.elevation ?? 0) + f.height + 0.1);
          if (!p) return [];
          const text = [badge?.key ? this.t(`card.badge_${badge.key}`, badge.vars) : "", ...readings].filter(Boolean).join(" · ");
          return [{ entity: f.entity ?? f.readings![0], ...p, icon: badge?.icon ?? (tags.includes("vehicle") ? "mdi:car-info" : "mdi:information-outline"), text, urgent: !!badge?.urgent }];
        }),
      );
    });
  }

  /**
   * Notes on doors and windows: a smart lock (a tap locks or unlocks), a contact sensor that
   * stopped reporting, and, while an alarm goes off, the open ones that may have set it off.
   */
  private openingBadges() {
    if (!this.house || !this.renderer || !this.hass || this.config.badges === false) return [];
    const hass = this.hass;
    const alarm = alarmTriggered(hass);
    const stale = (this.config.sensor_timeout ?? 0) * 3600e3;
    return this.openings.flatMap((o) => {
      if ((this._level && o.levelId !== this._level) || !this.renderer!.isLevelVisible(o.levelId)) return [];
      const notes: { entity: string; icon: string; text: string; urgent: boolean; lock?: boolean }[] = [];
      const lock = o.lock ? hass.states[o.lock] : undefined;
      if (lock) {
        const s = lock.state;
        const icon = s === "locked" ? "mdi:lock" : s === "jammed" ? "mdi:lock-alert" : s === "locking" || s === "unlocking" ? "mdi:lock-clock" : s === "unavailable" ? "mdi:lock-question" : "mdi:lock-open-variant";
        notes.push({ entity: o.lock!, icon, text: this.t(`card.lock_${["locked", "jammed", "locking", "unlocking", "unavailable", "open"].includes(s) ? s : "unlocked"}` as StringKey), urgent: s === "jammed", lock: true });
      }
      const contact = o.contact ? hass.states[o.contact] : undefined;
      if (o.contact && (!contact || contact.state === "unavailable" || contact.state === "unknown" || (stale && Date.now() - Date.parse(String(contact.last_updated ?? "")) > stale))) {
        notes.push({ entity: o.contact, icon: "mdi:access-point-off", text: this.t("card.sensor_silent", { name: this.entityName(o.contact) }), urgent: false });
      } else if (alarm && o.contact && contactOpen(hass, o.contact)) {
        notes.push({ entity: o.contact, icon: "mdi:alarm-light", text: this.t("card.alarm_open", { name: this.entityName(o.contact) }), urgent: true });
      }
      if (!notes.length) return [];
      const p = this.renderer!.project(o.levelId, o.at, o.top + 0.15);
      if (!p) return [];
      return notes.map((n, i) => ({ key: `${o.levelId}:${o.id}:${i}`, ...n, x: p.x + i * 30, y: p.y }));
    });
  }

  /** Per level: where a reading is known, from the rooms' sensors (at their middles) and placed sensor pieces. */
  private heatSamples(hass: Hass, kind: string, roomValues: (number | null)[]) {
    const out: Record<string, { at: Vec2; value: number }[]> = {};
    this.rooms.forEach((r, i) => {
      const v = roomValues[i];
      if (v !== null) (out[r.levelId] ??= []).push({ at: r.point, value: v });
    });
    for (const l of this.house!.levels)
      for (const room of l.rooms)
        for (const f of room.furniture) {
          const s = f.entity?.startsWith("sensor.") ? hass.states[f.entity] : undefined;
          const v = Number(s?.state);
          if (s?.attributes.device_class === kind && Number.isFinite(v)) (out[l.id] ??= []).push({ at: f.at, value: v });
        }
    return out;
  }

  /** Where an entity is drawn: its piece, its door or window, its lamp, else its room's middle. */
  private entitySpot(entity: string): { levelId: string; at: Vec2; height: number } | null {
    if (!this.house || !this.hass) return null;
    for (const level of this.house.levels)
      for (const room of level.rooms) {
        const f = room.furniture.find((x) => x.entity === entity);
        if (f) return { levelId: level.id, at: f.at, height: (f.elevation ?? 0) + f.height + 0.05 };
      }
    const o = this.openings.find((x) => x.cover === entity || x.contact === entity || x.lock === entity);
    if (o) return { levelId: o.levelId, at: o.at, height: o.top };
    const lamp = this.lamps.find((l) => l.entity === entity);
    if (lamp) return { levelId: lamp.levelId, at: lamp.at, height: this.lampHeight(lamp) };
    const where = whereIs(this.house, this.hass, entity, this.openings);
    const room = where?.roomId ? this.rooms.find((r) => r.key === `${where.levelId}/${where.roomId}`) : undefined;
    return room ? { levelId: room.levelId, at: room.point, height: 0.4 } : null;
  }

  /** The card's rules that match now, placed where their entities are. */
  private ruleMarks() {
    if (!this.renderer || !this.hass || !this.config.rules?.length) return [];
    return this.config.rules.flatMap((r, i) => {
      if (!(r.ring || r.icon || r.text) || !ruleMatches(this.hass!, r)) return [];
      const spot = this.entitySpot(r.entity);
      if (!spot || (this._level && spot.levelId !== this._level) || !this.renderer!.isLevelVisible(spot.levelId)) return [];
      const p = this.renderer!.project(spot.levelId, spot.at, spot.height);
      if (!p) return [];
      const ring = r.ring ? (typeof r.ring === "string" ? r.ring : this.config.accent || "var(--primary-color, #03a9f4)") : null;
      return [{ key: `rule-${i}`, entity: r.entity, x: p.x, y: p.y, ring, icon: r.icon, text: ruleText(this.hass!, r) }];
    });
  }

  /** What needs attention now, most urgent first, each with where it is. */
  private warnings() {
    if (!this.house || !this.hass) return [];
    const hass = this.hass;
    const out: { icon: string; text: string; where: { levelId: string; roomId?: string }; urgent: boolean }[] = [];
    for (const r of this.rooms)
      for (const a of hardAlerts(this.roomSensors(r.room, r.levelId).alerts))
        out.push({ icon: alertIcon(a), text: `${this.t(`card.alert_${a}` as StringKey)} · ${this.roomName(r)}`, where: { levelId: r.levelId, roomId: r.room.id }, urgent: true });
    const alarm = alarmTriggered(hass);
    for (const o of this.openings) {
      const where = { levelId: o.levelId, roomId: o.room };
      if (o.lock && hass.states[o.lock]?.state === "jammed") out.push({ icon: "mdi:lock-alert", text: this.t("card.lock_jammed"), where, urgent: true });
      const c = o.contact ? hass.states[o.contact] : undefined;
      if (o.contact && (!c || c.state === "unavailable" || c.state === "unknown")) out.push({ icon: "mdi:access-point-off", text: this.t("card.sensor_silent", { name: this.entityName(o.contact) }), where, urgent: false });
      else if (alarm && o.contact && contactOpen(hass, o.contact)) out.push({ icon: "mdi:alarm-light", text: this.t("card.alarm_open", { name: this.entityName(o.contact) }), where, urgent: true });
    }
    this.house.robots.forEach((r, i) => {
      const items = this.robotNeeds[i] ?? [];
      const level = this.house!.levels[r.levelIndex];
      if (items.length && level) out.push({ icon: "mdi:robot-vacuum-alert", text: `${this.entityName(r.entity)}: ${items.join(", ")}`, where: { levelId: level.id }, urgent: false });
    });
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  }

  private renderWarnings() {
    const list = this.warnings();
    if (!list.length) return nothing;
    const shown = list.slice(0, 3);
    return html`<div class="warnings ${this.powerOut ? "below" : ""}" role="list" aria-label=${this.t("card.warnings")}>
      ${shown.map(
        (w) => html`<button role="listitem" class=${w.urgent ? "urgent" : ""} @click=${() => void this.showEvent(w.where, w.text)}>
          <ha-icon icon=${w.icon}></ha-icon><span>${w.text}</span>
        </button>`,
      )}
      ${list.length > shown.length ? html`<span class="more">+${list.length - shown.length}</span>` : nothing}
    </div>`;
  }

  /** The weather's temperature and humidity outside, if the card has a weather entity. */
  private outsideAir() {
    const a = this.config.weather ? this.hass?.states[this.config.weather]?.attributes : undefined;
    return typeof a?.temperature === "number" && typeof a?.humidity === "number" ? { temperature: a.temperature, humidity: a.humidity } : null;
  }

  /** A tap on a door's lock: locks it, or unlocks it (the card's own action first). */
  private useLock(entity: string) {
    if (this.ownAction(entity, "tap")) return;
    const s = this.hass?.states[entity]?.state;
    if (!s || s === "unavailable") return this.moreInfo(entity);
    this.noteToggle(entity);
    void this.hass!.callService("lock", s === "locked" ? "unlock" : "lock", {}, { entity_id: entity });
  }

  /** A warning sign at each robot's dock that needs something, listing what. */
  private dockAlerts() {
    if (!this.house || !this.renderer) return [];
    return this.house.robots.flatMap((r, i) => {
      const items = this.robotNeeds[i] ?? [];
      const level = this.house!.levels[r.levelIndex];
      if (!items.length || !level || (this._level && level.id !== this._level) || !this.renderer!.isLevelVisible(level.id)) return [];
      const p = this.renderer!.project(level.id, r.dock, 0.25);
      return p ? [{ key: `dock-${r.index}`, entity: r.entity, x: p.x + 16, y: p.y - 16, items }] : [];
    });
  }

  /** Robots: name, what they do and their battery, above them. */
  private robotLabels() {
    if (!this.house || !this.renderer || !this.hass || this._walking) return [];
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

  /** One more reading for a callout: a short name and the value with its unit ("COP 3.8"). */
  private detailText(d: { entity: string; name?: string }, owner: string): string {
    const st = this.hass?.states[d.entity];
    if (!st || st.state === "unavailable" || st.state === "unknown") return "";
    const n = Number(st.state);
    const unit = (st.attributes.unit_of_measurement as string | undefined) ?? "";
    const value = Number.isFinite(n) ? formatNumber(this.hass?.locale, n, Number.isInteger(n) ? 0 : 1) : st.state;
    // the sensor's name without the device's ("Heat pump COP" on the heat pump: "COP")
    let name = d.name ?? (st.attributes.friendly_name as string | undefined) ?? "";
    if (!d.name && owner && name.toLowerCase().startsWith(owner.toLowerCase())) name = name.slice(owner.length).trim();
    return `${name ? `${name} ` : ""}${value}${unit ? (unit === "%" ? unit : ` ${unit}`) : ""}`;
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
      const details = e.details.map((d) => this.detailText(d, name)).filter(Boolean);
      const text = [`${e.kind === "battery" && r.soc !== null ? `${Math.round(r.soc)} % · ` : ""}${formatPower(r.power === null ? null : Math.abs(r.power), this.hass?.locale)}`, ...details].join(" · ");
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
    // time travel: the house as it was then
    const hass: Hass = this._replay ? { ...this.hass, states: statesAt(this.hass, this._replay.history, this._replay.t) } : this.hass;
    if (!this._replay) this.followEvents(hass);
    // (it keeps its own key: redrawn when the day, the sun's place or the house changes)
    this.updateSunPath(hass);
    this.syncLamps(hass);
    const lights = this.rooms.map((r) => lightsLook(hass, this.roomLights(r.key)));
    const lamps = this.lamps.map((l) => lightsLook(hass, [l.entity]));
    const inverted = new Set(this.house.invertedCovers);
    const covers = this.openings.map((o) => (o.cover ? coverOpen(hass, o.cover, inverted.has(o.cover)) : null));
    // inside blinds: how far up, and their slats' tilt (HA: 100 level, 0 shut)
    const blinds = this.openings.map((o) => {
      if (!o.blind) return null;
      const tilt = hass.states[o.blind]?.attributes.current_tilt_position;
      return [coverOpen(hass, o.blind, inverted.has(o.blind)), typeof tilt === "number" ? tilt / 100 : null] as const;
    });
    const contacts = this.openings.map((o) => (o.contact ? contactOpen(hass, o.contact) : false));
    // the doors' locks, whether their contacts still report, and an alarm going off
    const doorNotes = [alarmTriggered(hass), ...this.openings.map((o) => [o.lock && hass.states[o.lock]?.state, o.contact && hass.states[o.contact]?.state, o.contact && this.config.sensor_timeout ? hass.states[o.contact]?.last_updated : null])];
    const values = this.rooms.map((r) => this.roomValues(r));
    // lux readings, rounded so small changes don't redraw (outside, the sun does it)
    const lux = this.rooms.map((r) => (this.config.lux && r.room.areaId && r.room.kind === "room" ? areaIlluminance(hass, r.room.areaId) : null)).map((v) => (v === null ? null : Math.round(daylight(v) * 20) / 20));
    // an alarm turns the room's floor red, over its lights
    const sensors = this.rooms.map((r) => this.roomSensors(r.room, r.levelId));
    sensors.forEach((s, i) => {
      // (an open window in the rain is a note, not an alarm: no red room)
      if (hardAlerts(s.alerts).length) lights[i] = { rgb: [255, 40, 30], brightness: 1 };
    });
    const awnings = this.rooms.map((r) => (r.room.awning ? coverOpen(hass, r.room.awning, inverted.has(r.room.awning)) : null));
    const devices = this.devices.map((entity) => deviceLook(hass, entity, inverted.has(entity)));
    // roof windows: how far their shutters are down, whether they are open
    // (keys: the house's roof 0…, a roof level's part n: n × 100 + index)
    const roofLevel = this.house.levels.find((l) => l.kind === "roof");
    const roofWindowList = roofLevel ? roofLevel.roofs.flatMap((p, n) => p.windows.map((w, i) => [(n + 1) * 100 + i, w] as const)) : this.house.roof.windows.map((w, i) => [i, w] as const);
    const roofWindows = roofWindowList.map(([key, w]) => [key, w.cover ? 1 - (coverOpen(hass, w.cover, inverted.has(w.cover)) ?? 1) : 0, w.contact ? contactOpen(hass, w.contact) : false] as const);
    const energyDetails = this.config.energy ? this.house.energy.flatMap((e) => e.details.map((d) => hass.states[d.entity]?.state)) : [];
    // rain, snow or fog around the house, from the card's weather entity
    const weather = this.config.weather && this.config.weather_effects !== false ? weatherEffect(hass.states[this.config.weather]?.state) : null;
    const badges = this.config.badges === false ? [] : this.house.levels.flatMap((l) => l.rooms.flatMap((r) => r.furniture.map((f) => [f.entity ? JSON.stringify(pieceBadge(hass, f.entity, this.pieceTags(f))) : null, ...(f.readings ?? []).map((e) => hass.states[e]?.state)])));
    // underfloor heating: a climate entity heating, or a valve/switch/sensor on
    const underfloor = [...new Set(this.rooms.map((r) => r.room.underfloor).filter((e): e is string => !!e))].map((entity) => {
      const look = deviceLook(hass, entity);
      return [entity, this.config.heating === true && !!look && look.on && (entity.startsWith("climate.") || entity.startsWith("water_heater.") ? look.active && look.tone === "heat" : look.active || look.on)] as const;
    });
    const cameras = this.house.levels.flatMap((l) => l.rooms.flatMap((r) => r.cameras.map((c) => [c.entity, !!c.motion && hass.states[c.motion]?.state === "on"] as const)));
    this.energyReadings = this.config.energy ? this.house.energy.map((e) => readEnergy(hass, e, this.energyPrefs)) : [];
    this.pollRobots(hass);
    this.robotReadings = this.house.robots.map((r) => readRobot(hass, r));
    this.robotNeeds = this.house.robots.map((r) => robotAlerts(hass, r.entity));
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
    const smooth = this.config.heatmap_style === "smooth";
    const heat = this.rooms.map((r) => {
      const kind = this.config.heatmap;
      const v = kind && r.room.areaId && r.room.kind === "room" ? areaReading(hass, r.room.areaId, kind) : null;
      return v === null || !kind ? null : smooth ? v : stepColor(v, this.steps[kind] ?? []);
    });
    // smooth: each level's readings where they are (room middles, placed sensors), spread across its floors
    const fields = smooth && this.config.heatmap ? this.heatSamples(hass, this.config.heatmap, heat as (number | null)[]) : null;
    // pieces there only while an entity is on (a guest bed, the Christmas tree)
    const shownWhen = [...new Set(this.house.levels.flatMap((l) => l.rooms.flatMap((r) => r.furniture.flatMap((f) => (f.visibleWhen ? [f.visibleWhen] : [])))))].map(
      (e) => [e, ["on", "home", "open", "playing", "active"].includes(hass.states[e]?.state ?? "")] as const,
    );
    const ruleHits = (this.config.rules ?? []).map((r) => ruleMatches(hass, r));
    const ruleTexts = (this.config.rules ?? []).map((r, i) => (ruleHits[i] ? ruleText(hass, r) : ""));
    const signature = JSON.stringify([look, this.config.accent, lux, heat, fields, ruleHits, ruleTexts, shownWhen, lights, lamps, covers, blinds, contacts, doorNotes, values, sensors, awnings, devices, roofWindows, underfloor, badges, energyDetails, weather, this.placedPeople(hass).map((p) => [p.key, p.levelId, p.at]), this.config.weather ? hass.states[this.config.weather]?.attributes.temperature : null, cameras, this.energyReadings, this.robotReadings, this.robotNeeds, sunAt]);
    if (signature === this.stateSignature) return;
    this.stateSignature = signature;
    this.lamps.forEach((l, i) => this.renderer!.setLamp(l.entity, lamps[i]));
    this.devices.forEach((entity, i) => this.renderer!.setDevice(entity, devices[i]));
    // rules: the last matching one with a colour tints the entity's pieces
    const tints = new Map<string, string | null>();
    (this.config.rules ?? []).forEach((r, i) => {
      if (!tints.has(r.entity)) tints.set(r.entity, null);
      if (r.color && ruleHits[i]) tints.set(r.entity, r.color);
    });
    for (const [entity, color] of tints) this.renderer.setEntityTint(entity, color);
    for (const [entity, on] of shownWhen) this.renderer.setShownWhen(entity, on);
    for (const [entity, heating] of underfloor) this.renderer.setUnderfloor(entity, heating);
    for (const [key, closed, open] of roofWindows) this.renderer.setRoofWindow(key, closed, open);
    for (const [entity, moving] of cameras) this.renderer.setCameraMotion(entity, moving);
    this.renderer.setLook(look, this.config.accent || undefined);
    this.renderer.setWeather(weather);
    this.renderer.setPeople(this.placedPeople(hass));
    this.renderer.setSun(sunAt?.[0] ?? null, sunAt?.[1] ?? null);
    this.house.robots.forEach((r, i) => this.renderer!.setRobotState(`robot-${r.index}`, this.robotReadings[i].at, ROBOT_COLORS[this.robotReadings[i].status], this.robotReadings[i].unsure));
    if (this.config.energy) this.renderer.setFlows(Object.fromEntries(this.house.energy.map((e, i) => [`energy-${e.index}`, this.energyReadings[i]?.flow ?? null])));
    this.rooms.forEach((r, i) => {
      this.renderer!.setRoomLight(r.levelId, r.room.id, lights[i]);
      this.renderer!.setRoomDaylight(r.levelId, r.room.id, lux[i]);
      this.renderer!.setRoomTint(r.levelId, r.room.id, smooth ? null : (heat[i] as string | null));
      if (r.room.awning) this.renderer!.setAwning(r.levelId, r.room.id, awnings[i]);
    });
    const kind = this.config.heatmap;
    for (const l of this.house.levels) this.renderer.setHeatField(l.id, fields?.[l.id] ?? null, (v) => (kind ? stepBlend(v, this.steps[kind] ?? []) : [0, 0, 0, 0]));
    this.openings.forEach((o, i) => {
      this.renderer!.setCover(o.id, covers[i]);
      if (blinds[i]) this.renderer!.setBlind(o.id, blinds[i]![0], blinds[i]![1]);
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
    this.idleSince = this.lastTouch;
    this.atHome = false;
    this.stopOrbit();
  };

  // ----- wall tablets: idle return, night, slow orbit, clock -----

  private idleSince = Date.now();
  /** The start view is showing (nothing to return to). */
  private atHome = true;
  private kioskTimer = 0;
  private orbitTimer = 0;
  private _night = false;
  private _clock = "";

  private get kiosk() {
    const c = this.config;
    return !!(c.idle_return || c.night || c.idle_orbit || c.clock);
  }

  private kioskTick = () => {
    const c = this.config;
    const idle = Date.now() - this.idleSince;
    if (c.idle_return && !this.atHome && idle > c.idle_return * 1000 && !this.transitioning) void this.returnHome();
    if (c.idle_orbit && !this.orbitTimer && idle > (c.idle_return ?? 60) * 1000 + 3000 && this.atHome && !this._event && !this._popup && this.quality !== "low") this.startOrbit();
    this._night = isNight(c.night, this.hass, new Date());
    if (c.clock) this._clock = clockText(this.hass, new Date());
  };

  /** Back to the start view: popup closed, the start floor, the card's camera. */
  private async returnHome() {
    this.atHome = true;
    if (!this.house || !this.renderer) return;
    this.closePopup();
    const start = this.plan || this.config.level ? this.startLevel(this.house) : null;
    if (this._level !== start) await this.selectLevel(start);
    else await this.renderer.resetView();
    this.placeLabels();
  }

  private startOrbit() {
    // a slow turn, about 3° a second, drawn 20 times a second (labels hide while it turns)
    this._labels = [];
    this._lampButtons = [];
    this.orbitTimer = window.setInterval(() => {
      if (this.transitioning || this._event) return;
      this.renderer?.orbit(0.15, 0);
    }, 50);
  }

  private stopOrbit() {
    if (!this.orbitTimer) return;
    clearInterval(this.orbitTimer);
    this.orbitTimer = 0;
    // it moved the camera: the start view is not showing anymore
    this.atHome = false;
    this.placeLabels();
  }

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
        const alerts = hardAlerts(this.roomSensors(r.room, r.levelId).alerts).join(",");
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

  private unsubscribeShow?: () => Promise<void> | void;

  /** Flies to the area, floor or entity the homeslice.show action names, for a while. */
  private async showAsked(m: ShowMessage) {
    if (!this.house || !this.hass) return;
    let where: { levelId: string; roomId?: string } | null = null;
    let text = "";
    if (m.area_id) {
      const r = this.rooms.find((x) => x.room.areaId === m.area_id);
      if (r) where = { levelId: r.levelId, roomId: r.room.id };
      text = this.hass.areas?.[m.area_id]?.name ?? "";
    } else if (m.floor_id) {
      const level = this.house.levels.find((l) => l.floorId === m.floor_id);
      if (level) where = { levelId: level.id };
      text = this.hass.floors?.[m.floor_id]?.name ?? level?.name ?? "";
    } else if (m.entity_id) {
      where = whereIs(this.house, this.hass, m.entity_id, this.openings);
      text = (this.hass.states[m.entity_id]?.attributes.friendly_name as string | undefined) ?? m.entity_id;
    }
    if (m.message) text = m.message;
    if (!where) {
      // a message for the whole house: shown where the card is
      if (!m.message) return;
      this._event = m.message;
      clearTimeout(this.eventTimer);
      this.eventTimer = window.setTimeout(() => void this.endEvent(), (m.seconds ?? this.config.follow_seconds ?? 30) * 1000);
      return;
    }
    this.closePopup();
    await this.showEvent(where, text, m.seconds);
  }

  private async showEvent(where: { levelId: string; roomId?: string }, text: string, seconds?: number) {
    const room = where.roomId ? this.rooms.find((r) => r.key === `${where.levelId}/${where.roomId}`) : undefined;
    this._event = room ? `${text} · ${this.roomName(room)}` : text;
    // where to go back to (an event already shown keeps the first)
    if (this.eventReturn === undefined) this.eventReturn = this._level;
    if (this._level !== where.levelId) await this.selectLevel(where.levelId);
    clearTimeout(this.eventTimer);
    this.eventTimer = window.setTimeout(() => void this.endEvent(), (seconds ?? this.config.follow_seconds ?? 30) * 1000);
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

  /** The colour steps per reading: the card's own, else the defaults. */
  private get steps() {
    return { ...HEATMAP_STEPS, ...this.config.thresholds };
  }

  /** The readings on a room's label. */
  private roomValues(r: PlacedRoom): AreaValue[] {
    if (!this.hass || !r.room.areaId) return [];
    return areaValues(this.hass, r.room.areaId, this.config.values ?? ["temperature"], this.steps);
  }

  /** How high a lamp is above its floor: its piece's top, a strip's height, else near the ceiling. */
  private lampHeight(l: PlacedLight): number {
    const level = this.house?.levels.find((x) => x.id === l.levelId);
    const ceiling = level?.height ?? 2.6;
    if (l.height !== undefined) return l.height;
    const piece = level?.rooms.find((r) => r.id === l.roomId)?.furniture.find((f) => f.entity === l.entity);
    if (piece) return piece.mount === "ceiling" ? Math.max(0.3, ceiling - piece.height) : (piece.elevation ?? 0) + piece.height * 0.9;
    return ceiling * 0.9;
  }

  /** A room's lux reading for its label, when the card shows them. */
  private luxText(r: PlacedRoom): string | null {
    if (!this.config.lux || !this.hass || !r.room.areaId || r.room.kind !== "room") return null;
    const v = areaIlluminance(this.hass, r.room.areaId);
    return v === null ? null : `${formatNumber(this.hass.locale, Math.round(v), 0)} lx`;
  }

  /** A room's motion/presence and alarm sensors, as the card shows them. */
  private roomSensors(room: Room, levelId: string): AreaSensors {
    if (!this.hass) return { presence: false, alerts: [] };
    const s = room.areaId ? areaSensors(this.hass, room.areaId) : { presence: false, alerts: [] };
    // outside, "moisture" is rain, not a leak
    const alerts = room.kind === "outdoor" ? [] : [...s.alerts];
    // a window or door of the room open while it rains
    if (room.kind === "room" && this.raining && this.openings.some((o) => o.levelId === levelId && o.room === room.id && o.contact && contactOpen(this.hass!, o.contact))) alerts.push("rain");
    // an alarm going off: the rooms where something moves
    if (room.kind === "room" && s.presence && alarmTriggered(this.hass)) alerts.unshift("alarm");
    // humid: air the room (when the air outside is drier), or a mould risk
    if (this.config.climate_hints && room.kind === "room" && room.areaId) {
      const hint = climateHint(this.hass, room.areaId, this.outsideAir());
      if (hint) alerts.push(hint);
    }
    return { presence: this.config.presence !== false && s.presence, alerts };
  }

  /** It rains, says the rain sensor or the weather. */
  private get raining(): boolean {
    const hass = this.hass;
    if (!hass || this.config.rain === "none") return false;
    const id = this.config.rain ?? Object.keys(hass.states).find((e) => e.startsWith("weather."));
    const state = id ? hass.states[id]?.state : undefined;
    if (!id || !state) return false;
    return id.startsWith("weather.") ? RAINY.includes(state) : state === "on";
  }

  /** The power is out, says the card's outage sensor. */
  private get powerOut(): boolean {
    const id = this.config.power_outage;
    return !!id && this.hass?.states[id]?.state === "on";
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
    this.note(this.t(label.on ? "card.note_lights_off" : "card.note_lights_on", { name: label.name }));
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
      const name = g.entities.length === 1 ? this.entityName(g.entities[0]) : (this._labels.find((l) => this.roomLights(l.key).join() === g.entities.join())?.name ?? this.t("card.note_lights"));
      this.note(g.pct > 0 ? this.t("card.note_dimmed", { name, pct: g.pct }) : this.t("card.note_off", { name }));
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
    this.note(this.t(lamp.on ? "card.note_off" : "card.note_on", { name: lamp.name }));
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
    if (this.config.room_panel === false) return;
    const r = this.rooms.find((x) => x.key === key);
    if (!r || !this.hass) return;
    const areaId = r.room.areaId;
    const override = this.config.popups?.[r.room.id] ?? (areaId ? this.config.popups?.[areaId] : undefined);
    // the room's own blinds, contacts and awning, even when HA has them in no area
    const placed = [
      ...r.room.cameras.map((c) => c.entity),
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
    if (this._walking) {
      // walking: drag to look around
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      this.lookFrom = { x: e.clientX, y: e.clientY };
      return;
    }
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
          this.hold(entity);
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
    if (this._walking) {
      if (!this.lookFrom || !this.renderer?.walking) return;
      const v = this.renderer.walking;
      this.renderer.setWalk({ ...v, yaw: v.yaw - (e.clientX - this.lookFrom.x) * 0.25, pitch: Math.max(-60, Math.min(60, v.pitch + (e.clientY - this.lookFrom.y) * 0.2)) });
      this.lookFrom = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.holdFrom && Math.hypot(e.clientX - this.holdFrom.x, e.clientY - this.holdFrom.y) > 8) {
      clearTimeout(this.holdTimer);
      this.holdFrom = null;
    }
    if (!this.renderer || this.transitioning) return;
    const last = this.pointers.get(e.pointerId);
    if (last) {
      // dragging: one pointer turns, two pointers zoom and move
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        const d = this.pinchDistance();
        if (this.pinch > 0) this.renderer.zoomBy(d / this.pinch);
        this.pinch = d;
        // both fingers moving together move the view: each finger's move counts half
        this.renderer.panBy(dx / this.pointers.size, dy / this.pointers.size);
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
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverLevel(this.renderer?.levelAt(x, y) ?? null);
      this.showTip(x, y);
    });
  }

  /** The tooltip for the linked piece under the mouse: its name, state and since when. */
  private showTip(x: number, y: number) {
    const entity = this.config.tooltips === false || this.transitioning ? null : (this.renderer?.pickEntity(x, y) ?? null);
    const st = entity ? this.hass?.states[entity] : undefined;
    if (!entity || !st) {
      if (this._tip) this._tip = null;
      return;
    }
    const format = (this.hass as unknown as { formatEntityState?: (s: unknown) => string }).formatEntityState;
    const text = `${this.entityName(entity)} · ${format ? format(st) : this.detailText({ entity, name: "" }, "") || st.state}`;
    const sub = st.last_changed ? this.since(st.last_changed) : "";
    this._tip = { x, y, text, sub };
  }

  /** "5 minutes ago", in the HA language. */
  private since(iso: string) {
    const s = (Date.parse(iso) - Date.now()) / 1000;
    if (!Number.isFinite(s)) return "";
    const rtf = new Intl.RelativeTimeFormat(this.hass?.locale?.language ?? "en", { numeric: "auto" });
    const a = Math.abs(s);
    const [v, unit]: [number, Intl.RelativeTimeFormatUnit] = a < 60 ? [s, "second"] : a < 3600 ? [s / 60, "minute"] : a < 86400 ? [s / 3600, "hour"] : [s / 86400, "day"];
    return this.t("card.tip_changed", { when: rtf.format(Math.round(v), unit) });
  }

  private onPointerUp(e: PointerEvent) {
    if (this._walking) {
      this.lookFrom = null;
      return;
    }
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
    // a trackpad: pinching sends ctrl + wheel (zoom), two fingers scroll in small or sideways steps (move);
    // a mouse wheel clicks in big whole steps (zoom)
    const wheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || wheel) this.renderer.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    else this.renderer.panBy(-e.deltaX, -e.deltaY);
    this.afterCameraMove();
  }

  /** A right click on a linked piece is a long press (its details), elsewhere nothing. */
  private onContextMenu(e: MouseEvent) {
    if (!this.renderer || this.transitioning) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const entity = this.renderer.pickEntity(e.clientX - rect.left, e.clientY - rect.top);
    if (!entity) return;
    e.preventDefault();
    clearTimeout(this.holdTimer);
    this.hold(entity);
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
    if (this._walking) {
      // at eye level the house speaks for itself
      this._labels = [];
      this._lampButtons = [];
      this._energyLabels = [];
      this._robotLabels = [];
      this._dockAlerts = [];
      this._badges = [];
      this._openingBadges = [];
      this._ruleMarks = [];
      this._sunTimes = [];
      return;
    }
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
        values: this.roomValues(r),
        lux: this.luxText(r),
        areaId,
        ...this.roomSensors(r.room, r.levelId),
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
        // at the lamp itself (a pendant near the ceiling, a floor lamp's shade), so it sits on
        // the lamp from any angle, not on the floor below it
        const p = this.renderer.project(l.levelId, l.at, this.lampHeight(l));
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
    this._dockAlerts = this.dockAlerts();
    this._badges = this.pieceBadges();
    this._openingBadges = this.openingBadges();
    this._ruleMarks = this.ruleMarks();
    this._sunTimes = this.sunTimeLabels();
    this._people = this.personLabels();
  }

  protected override render() {
    // a roof level is a floor button only while the card shows the roof
    const levels = [...(this.house?.levels ?? [])].reverse().filter((l) => l.kind !== "roof" || this.view.roof);
    return html`
      <ha-card class="${this.config.lamp_style === "circle" ? "" : "bare-lamps"} ${this._night ? "night-dim" : ""}" style=${this._night ? `--night-brightness:${Math.min(1, Math.max(0.1, this.config.night_brightness ?? 0.4))}` : ""}>
        ${this.config.clock && this._clock ? html`<div class="clock" role="timer">${this._clock}</div>` : nothing}
        ${this.renderWeather()}
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
          ${this.renderOverlays("behind")}
          <canvas
            class="${this.interactive ? "interactive" : ""} ${this.plan ? "swipe" : ""}"
            @click=${this.onCanvasClick}
            @dblclick=${this.onDoubleClick}
            @contextmenu=${this.onContextMenu}
            @pointerdown=${this.onPointerDown}
            @pointermove=${this.onPointerMove}
            @pointerup=${this.onPointerUp}
            @pointercancel=${this.onPointerUp}
            @pointerleave=${() => {
              if (this.pointers.size === 0) this.hoverLevel(null);
              this._tip = null;
            }}
            @wheel=${this.onWheel}
          ></canvas>
          ${this._readout ? html`<div class="readout">${this._readout}</div>` : nothing}
          ${this.powerOut ? html`<div class="outage" role="alert"><ha-icon icon="mdi:power-plug-off"></ha-icon>${this.t("card.power_outage")}</div>` : nothing}
          ${this.config.warnings && !this._event ? this.renderWarnings() : nothing}
          ${this._event ? html`<div class="event" role="status"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>${this._event}</div>` : nothing}
          ${this.renderOverlays("front")}
          ${this.renderShortcuts()}
          ${this.renderTimeTravel()}
          ${this.renderWalk()}
          ${this.renderLayers()}
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
            (l) => html`<div class="label ${this._hover !== null && l.levelIndex > this._hover ? "faded" : ""} ${hardAlerts(l.alerts).length ? "alert" : l.alerts.length ? "note" : ""}" style="left:${l.x}px;top:${l.y}px">
              ${l.hasLights
                ? html`<button
                    class="lamp ${l.on ? "on" : ""}"
                    aria-label=${this.t(l.on ? "card.lights_off" : "card.lights_on", { room: l.name })}
                    title=${this.t("card.lamp_hint")}
                    @pointerdown=${(e: PointerEvent) => this.lampDown(e, this.roomLights(l.key), () => this.openPopup(l.key))}
                    @contextmenu=${(e: Event) => {
                      // a right click is a long press
                      e.preventDefault();
                      this.openPopup(l.key);
                    }}
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
                ${l.values.length || l.lux || l.presence || l.alerts.length
                  ? html`<span class="temp"
                      >${l.alerts.map((a) => html`<ha-icon class="alert-icon" icon=${alertIcon(a)} title=${this.t(`card.alert_${a}` as StringKey)}></ha-icon>`)}${l.presence
                        ? html`<ha-icon class="presence" icon="mdi:motion-sensor" title=${this.t("card.presence")}></ha-icon>`
                        : nothing}${[...l.values.map((v) => html`<span class="value">${v.color ? html`<i class="dot" style="background:${v.color}"></i>` : nothing}${v.text}</span>`), ...(l.lux ? [html`<span class="value">${l.lux}</span>`] : [])].map((v, i) => (i ? html` · ${v}` : v))}</span
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
          ${this._people.map(
            (p) => html`<button class="person" style="left:${p.x}px;top:${p.y}px;--person:${p.color}" title=${p.name} @click=${() => this.moreInfo(p.key)}>
              ${p.picture ? html`<img src=${p.picture} alt="" />` : p.pet ? html`<ha-icon icon="mdi:paw"></ha-icon>` : html`<span>${p.name.slice(0, 1)}</span>`}
            </button>`,
          )}
          ${this._sunTimes.map((t) => html`<div class="sun-time" style="left:${t.x}px;top:${t.y}px">${t.text}</div>`)}
          ${this._badges.map(
            (b) => html`<button class="piece-badge ${b.urgent ? "urgent" : ""}" style="left:${b.x}px;top:${b.y}px" title=${b.text} @click=${() => this.moreInfo(b.entity)}>
              <ha-icon icon=${b.icon}></ha-icon><span>${b.text}</span>
            </button>`,
          )}
          ${this._ruleMarks.map(
            (m) => html`${m.ring ? html`<div class="rule-ring" style="left:${m.x}px;top:${m.y}px;--ring:${m.ring}"></div>` : nothing}
              ${m.icon || m.text
                ? html`<button class="piece-badge rule-mark" data-rule=${m.key} style="left:${m.x}px;top:${m.y}px" title=${m.text} @click=${() => this.moreInfo(m.entity)}>
                    ${m.icon ? html`<ha-icon icon=${m.icon}></ha-icon>` : nothing}${m.text ? html`<span>${m.text}</span>` : nothing}
                  </button>`
                : nothing}`,
          )}
          ${this._openingBadges.map(
            (b) => html`<button class="piece-badge opening-badge ${b.urgent ? "urgent" : ""} ${b.lock ? "lock" : ""}" data-badge=${b.key} style="left:${b.x}px;top:${b.y}px" title=${b.text} aria-label=${b.text}
              @click=${() => (b.lock ? this.useLock(b.entity) : this.moreInfo(b.entity))}
              @contextmenu=${(e: Event) => {
                e.preventDefault();
                this.moreInfo(b.entity);
              }}>
              <ha-icon icon=${b.icon}></ha-icon>${b.lock ? nothing : html`<span>${b.text}</span>`}
            </button>`,
          )}
          ${this._dockAlerts.map(
            (a) => html`<button class="dock-alert" style="left:${a.x}px;top:${a.y}px" title=${a.items.join("\n")} aria-label=${this.t("card.robot_needs", { items: a.items.join(", ") })} @click=${() => this.moreInfo(a.entity)}>
              <ha-icon icon="mdi:alert"></ha-icon>
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
              @pointerdown=${(e: PointerEvent) => this.lampDown(e, [b.entity], () => this.hold(b.entity))}
              @contextmenu=${(e: Event) => {
                e.preventDefault();
                this.hold(b.entity);
              }}
              @pointermove=${this.lampMove}
              @pointerup=${this.lampUp}
              @pointercancel=${this.lampUp}
              @click=${() => this.lampClick(() => this.ownAction(b.entity, "tap") || this.toggleLamp(b))}
            >
              <ha-icon icon=${b.on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
            </button>`,
          )}
          ${this._dim ? html`<div class="dim" style="left:${this._dim.x}px;top:${this._dim.y}px"><div class="bar" style="height:${this._dim.pct}%"></div><span>${this._dim.pct} %</span></div>` : nothing}
          ${this._note ? html`<div class="note" role="status">${this._note}</div>` : nothing}
          ${this._tip ? html`<div class="tip" style="left:${this._tip.x + 14}px;top:${this._tip.y + 18}px">${this._tip.text}${this._tip.sub ? html`<small>${this._tip.sub}</small>` : nothing}</div>` : nothing}
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

  /** A TV's or speaker's panel: what plays, play/pause, volume, its sources; the full details are one tap away. */
  private renderMedia(entity: string) {
    const st = this.hass?.states[entity];
    if (!st) return html`<p class="empty">${this.t("popup.empty")}</p>`;
    const a = st.attributes;
    const features = Number(a.supported_features ?? 0);
    const has = (bit: number) => (features & bit) !== 0;
    const call = (service: string, data: Record<string, unknown> = {}) => void this.hass!.callService("media_player", service, data, { entity_id: entity });
    const off = st.state === "off" || st.state === "standby" || st.state === "unavailable";
    const playing = st.state === "playing";
    const title = a.media_title as string | undefined;
    const artist = (a.media_artist ?? a.media_series_title ?? a.app_name) as string | undefined;
    const sources = (a.source_list as string[] | undefined) ?? [];
    const volume = typeof a.volume_level === "number" ? Math.round((a.volume_level as number) * 100) : null;
    const button = (icon: string, label: string, service: string, cls = "") =>
      html`<button class="media-button ${cls}" title=${label} aria-label=${label} @click=${() => call(service)}><ha-icon icon=${icon}></ha-icon></button>`;
    return html`<div class="media">
      <div class="now">
        ${a.entity_picture && !off ? html`<img class="art" src=${a.entity_picture as string} alt="" />` : html`<div class="art blank"><ha-icon icon=${entity.includes("speaker") ? "mdi:speaker" : "mdi:television"}></ha-icon></div>`}
        <div class="what">
          <strong>${off ? this.t("media.off") : (title ?? this.t(`media.${playing ? "playing" : st.state === "paused" ? "paused" : "idle"}` as StringKey))}</strong>
          ${!off && artist ? html`<span>${artist}</span>` : nothing}
        </div>
      </div>
      <div class="controls">
        ${has(256) || has(128) ? button("mdi:power", this.t(off ? "media.turn_on" : "media.turn_off"), off ? "turn_on" : "turn_off", off ? "" : "on") : nothing}
        ${!off && has(16) ? button("mdi:skip-previous", this.t("media.previous"), "media_previous_track") : nothing}
        ${!off && (has(1) || has(16384)) ? button(playing ? "mdi:pause" : "mdi:play", this.t(playing ? "media.pause" : "media.play"), "media_play_pause", "big") : nothing}
        ${!off && has(32) ? button("mdi:skip-next", this.t("media.next"), "media_next_track") : nothing}
      </div>
      ${!off && has(4) && volume !== null
        ? html`<label class="volume">
            ${has(8)
              ? html`<button class="media-button" aria-label=${this.t("media.mute")} @click=${() => call("volume_mute", { is_volume_muted: !a.is_volume_muted })}>
                  <ha-icon icon=${a.is_volume_muted ? "mdi:volume-off" : "mdi:volume-high"}></ha-icon>
                </button>`
              : html`<ha-icon icon="mdi:volume-high"></ha-icon>`}
            <input type="range" min="0" max="100" .value=${String(volume)} aria-label=${this.t("media.volume")}
              @change=${(e: Event) => call("volume_set", { volume_level: Number((e.target as HTMLInputElement).value) / 100 })} />
            <span>${volume} %</span>
          </label>`
        : nothing}
      ${!off && has(2048) && sources.length
        ? html`<div class="sources">
            ${sources.map((src) => html`<button class=${src === a.source ? "on" : ""} @click=${() => call("select_source", { source: src })}>${src}</button>`)}
          </div>`
        : nothing}
      <button class="details" @click=${() => {
        this.closePopup();
        this.moreInfo(entity);
      }}>${this.t(has(131072) ? "media.browse" : "media.details")}</button>
    </div>`;
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
        ${p.media
          ? this.renderMedia(p.media)
          : p.sections.length
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
      /* its own stacking context: cards behind the house stay inside the card */
      isolation: isolate;
    }
    .card-overlay {
      position: absolute;
      z-index: 2;
    }
    .card-overlay.behind {
      /* under the house: the canvas is see-through where nothing is drawn */
      z-index: -1;
      pointer-events: none;
    }
    .card-overlay.hidden {
      display: none;
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
    .warnings {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
      max-width: min(70%, 640px);
      z-index: 2;
    }
    .warnings.below {
      top: 56px;
    }
    .warnings button {
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      padding: 4px 10px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(20, 24, 28, 0.85);
      color: #fff;
      font-size: 12px;
      cursor: pointer;
      --mdc-icon-size: 16px;
    }
    .warnings button.urgent {
      background: rgba(200, 40, 30, 0.92);
    }
    .warnings button span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .warnings .more {
      align-self: center;
      font-size: 12px;
      color: var(--secondary-text-color, #aaa);
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
    .outage {
      position: absolute;
      left: 50%;
      top: 12px;
      transform: translateX(-50%);
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 18px;
      background: var(--error-color, #db4437);
      color: #fff;
      font-weight: 500;
      animation: homeslice-alert 1.2s ease-in-out infinite;
    }
    .layers-open {
      position: absolute;
      left: 100px;
      bottom: 56px;
      z-index: 2;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.2));
      background: var(--card-background-color, rgba(20, 24, 28, 0.85));
      color: var(--primary-text-color, #ddd);
      display: grid;
      place-items: center;
      padding: 0;
      cursor: pointer;
      --mdc-icon-size: 20px;
    }
    .layers {
      position: absolute;
      left: 100px;
      bottom: 98px;
      z-index: 3;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--card-background-color, rgba(20, 24, 28, 0.92));
      color: var(--primary-text-color, #ddd);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      font-size: 13px;
    }
    .layers label {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .walk-open {
      position: absolute;
      left: 56px;
      bottom: 56px;
      z-index: 2;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.2));
      background: var(--card-background-color, rgba(20, 24, 28, 0.85));
      color: var(--primary-text-color, #ddd);
      display: grid;
      place-items: center;
      padding: 0;
      cursor: pointer;
      --mdc-icon-size: 20px;
    }
    .walk-close {
      position: absolute;
      right: 12px;
      top: 12px;
      z-index: 4;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: rgba(20, 24, 28, 0.75);
      color: #fff;
      display: grid;
      place-items: center;
      cursor: pointer;
    }
    .walk-hint {
      position: absolute;
      left: 50%;
      top: 12px;
      transform: translateX(-50%);
      padding: 4px 12px;
      border-radius: 12px;
      background: rgba(20, 24, 28, 0.6);
      color: #fff;
      font-size: 12px;
      pointer-events: none;
    }
    .stick {
      position: absolute;
      left: 20px;
      bottom: 20px;
      z-index: 4;
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: rgba(20, 24, 28, 0.35);
      border: 2px solid rgba(255, 255, 255, 0.5);
      touch-action: none;
    }
    .stick i {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 44px;
      height: 44px;
      margin: -22px 0 0 -22px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.8);
      transform: translate(var(--sx, 0px), var(--sy, 0px));
    }
    .time-travel-open {
      position: absolute;
      left: 12px;
      bottom: 56px;
      z-index: 2;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.2));
      background: var(--card-background-color, rgba(20, 24, 28, 0.85));
      color: var(--primary-text-color, #ddd);
      display: grid;
      place-items: center;
      padding: 0;
      cursor: pointer;
      --mdc-icon-size: 20px;
    }
    .time-travel {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 12px;
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 14px;
      background: var(--card-background-color, rgba(20, 24, 28, 0.9));
      color: var(--primary-text-color, #ddd);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    .time-travel button {
      border: none;
      background: none;
      color: inherit;
      padding: 4px;
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .time-travel .track {
      position: relative;
      flex: 1;
      display: flex;
      align-items: center;
    }
    .time-travel input {
      width: 100%;
    }
    .time-travel .tick {
      position: absolute;
      top: -6px;
      width: 2px;
      height: 6px;
      background: var(--primary-color, #03a9f4);
      opacity: 0.6;
      pointer-events: none;
    }
    .time-travel .when {
      font-variant-numeric: tabular-nums;
      min-width: 4.5em;
      text-align: right;
    }
    .shortcuts {
      position: absolute;
      right: 12px;
      bottom: 12px;
      display: flex;
      flex-wrap: wrap-reverse;
      justify-content: flex-end;
      gap: 6px;
      max-width: 60%;
      z-index: 2;
    }
    .shortcuts button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 12px 0 10px;
      border-radius: 18px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.2));
      background: var(--card-background-color, rgba(20, 24, 28, 0.85));
      color: var(--primary-text-color, #ddd);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      touch-action: manipulation;
      --mdc-icon-size: 18px;
    }
    .shortcuts button.on {
      background: #ffcf6b;
      color: #3a2a05;
      border-color: #ffe6ad;
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
    .label span.value {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .label i.dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
    }
    .label span.temp ha-icon {
      --mdc-icon-size: 13px;
    }
    .label.alert button.name {
      background: var(--error-color, #db4437);
      color: #fff;
      animation: homeslice-alert 1.2s ease-in-out infinite;
    }
    .label.note button.name {
      background: #e8913a;
      color: #fff;
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
    .media {
      display: grid;
      gap: 12px;
      padding: 4px 4px 8px;
    }
    .media .now {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .media .art {
      width: 64px;
      height: 64px;
      border-radius: 8px;
      object-fit: cover;
      flex: none;
    }
    .media .art.blank {
      display: grid;
      place-items: center;
      background: var(--secondary-background-color, rgba(127, 127, 127, 0.2));
      color: var(--secondary-text-color);
    }
    .media .what {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .media .what strong,
    .media .what span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .media .what span {
      color: var(--secondary-text-color);
      font-size: 13px;
    }
    .media .controls {
      display: flex;
      justify-content: center;
      gap: 12px;
    }
    .media-button {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: var(--secondary-background-color, rgba(127, 127, 127, 0.2));
      color: var(--primary-text-color);
      display: grid;
      place-items: center;
      cursor: pointer;
    }
    .media-button.big {
      width: 56px;
      height: 56px;
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    .media-button.on {
      color: var(--primary-color, #03a9f4);
    }
    .media .volume {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .media .volume input {
      flex: 1;
    }
    .media .volume span {
      width: 44px;
      text-align: right;
      font-size: 13px;
    }
    .media .sources {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .media .sources button,
    .media .details {
      border: 1px solid var(--divider-color, #ccc);
      background: none;
      color: var(--primary-text-color);
      border-radius: 16px;
      padding: 6px 12px;
      cursor: pointer;
    }
    .media .sources button.on {
      background: var(--primary-color, #03a9f4);
      border-color: transparent;
      color: var(--text-primary-color, #fff);
    }
    .media .details {
      justify-self: start;
    }
    .rule-ring {
      position: absolute;
      width: 34px;
      height: 34px;
      margin: -17px 0 0 -17px;
      border-radius: 50%;
      border: 3px solid var(--ring);
      pointer-events: none;
      animation: rule-ring 1.4s ease-out infinite;
    }
    @keyframes rule-ring {
      from {
        transform: scale(0.6);
        opacity: 1;
      }
      to {
        transform: scale(1.8);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .rule-ring {
        animation: none;
      }
    }
    .tip {
      position: absolute;
      display: grid;
      gap: 2px;
      max-width: 260px;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(20, 24, 28, 0.92);
      color: #fff;
      font-size: 12px;
      pointer-events: none;
      z-index: 5;
    }
    .tip small {
      color: rgba(255, 255, 255, 0.7);
      font-size: 11px;
    }
    .note {
      position: absolute;
      left: 50%;
      bottom: 64px;
      transform: translateX(-50%);
      max-width: calc(100% - 32px);
      padding: 6px 14px;
      border-radius: 16px;
      background: rgba(20, 24, 28, 0.85);
      color: #fff;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      animation: note-in 0.18s ease-out;
    }
    @keyframes note-in {
      from {
        opacity: 0;
        transform: translate(-50%, 6px);
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
    .person {
      position: absolute;
      transform: translate(-50%, -100%);
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: 50%;
      border: 2px solid var(--person);
      background: var(--card-background-color, #fff);
      color: var(--person);
      font-weight: 600;
      overflow: hidden;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    }
    .person img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .sun-time {
      position: absolute;
      transform: translate(-50%, -130%);
      font-size: 11px;
      color: #ffb347;
      text-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
      white-space: nowrap;
      pointer-events: none;
    }
    .piece-badge {
      position: absolute;
      transform: translate(-50%, -100%);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px 2px 5px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.6);
      background: rgba(20, 24, 28, 0.85);
      color: #fff;
      font: inherit;
      font-size: 11px;
      white-space: nowrap;
      cursor: pointer;
      pointer-events: auto;
      --mdc-icon-size: 14px;
    }
    .piece-badge.urgent {
      background: #f0a020;
    }
    .dock-alert {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 2px solid #fff;
      background: #f0a020;
      color: #fff;
      display: grid;
      place-items: center;
      padding: 0;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      --mdc-icon-size: 18px;
    }
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
    /* lamp_style: icon — just the bulb, readable on any floor through its shadow; the
       button keeps its size so it stays easy to hit */
    ha-card.bare-lamps .lamp {
      background: none;
      border: none;
      color: #fff;
      --mdc-icon-size: 26px;
      filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.85)) drop-shadow(0 0 4px rgba(0, 0, 0, 0.45));
    }
    ha-card.bare-lamps .lamp.single {
      --mdc-icon-size: 20px;
    }
    ha-card.bare-lamps .lamp.on {
      background: none;
      box-shadow: none;
      color: #ffd27a;
      filter: drop-shadow(0 0 5px rgba(255, 200, 90, 0.95)) drop-shadow(0 0 12px rgba(255, 190, 70, 0.6)) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5));
    }
    ha-card {
      position: relative;
    }
    ha-card.night-dim {
      filter: brightness(var(--night-brightness, 0.4));
      transition: filter 2s;
    }
    .weather {
      position: absolute;
      right: 12px;
      top: 8px;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 16px;
      border: none;
      background: color-mix(in srgb, var(--card-background-color, #fff) 70%, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 16px;
      cursor: pointer;
      --mdc-icon-size: 22px;
    }
    .weather.below-clock {
      top: 48px;
    }
    .clock {
      position: absolute;
      right: 12px;
      top: 8px;
      z-index: 2;
      font-size: 28px;
      font-weight: 300;
      font-variant-numeric: tabular-nums;
      color: var(--primary-text-color);
      text-shadow: 0 0 6px var(--card-background-color, #fff);
      pointer-events: none;
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
      /* the floors are a row along the top: the weather and the clock go below it */
      .weather,
      .clock {
        top: 60px;
      }
      .weather.below-clock {
        top: 100px;
      }
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
