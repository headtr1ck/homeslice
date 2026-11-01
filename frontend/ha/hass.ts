// The parts of Home Assistant's frontend `hass` object Homeslice relies on, and helpers
// built on HA's own registries. Keep every dependency on HA internals in this file.
import { formatNumber } from "../i18n/localize";


export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated?: string;
}

export interface Hass {
  locale?: { language: string; number_format?: string };
  states: Record<string, HassEntityState>;
  areas?: Record<string, { area_id: string; name: string; icon?: string | null; floor_id?: string | null; temperature_entity_id?: string | null; humidity_entity_id?: string | null }>;
  floors?: Record<string, { floor_id: string; name: string; level?: number | null }>;
  devices?: Record<string, { id: string; area_id?: string | null; name?: string | null; name_by_user?: string | null }>;
  entities?: Record<string, { entity_id: string; area_id?: string | null; device_id?: string | null; hidden?: boolean; entity_category?: string | null }>;
  /** Where the home is (for the sun's path). */
  config?: { latitude?: number; longitude?: number; unit_system?: { temperature?: string } };
  /** The services Home Assistant offers, by domain. */
  services?: Record<string, Record<string, unknown>>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  connection?: {
    subscribeMessage<T>(callback: (msg: T) => void, msg: Record<string, unknown>): Promise<() => Promise<void> | void>;
  };
  /** With `returnResponse`, resolves to `{ response }` (services that answer). */
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: Record<string, unknown>, notifyOnError?: boolean, returnResponse?: boolean): Promise<unknown>;
}

const cache = new WeakMap<object, Map<string, string[]>>();

/**
 * Entities of a domain that HA assigns to an area (directly or through their device),
 * skipping hidden entities and config/diagnostic ones, like HA's own area views do.
 */
export function areaEntities(hass: Hass, areaId: string, domain: string): string[] {
  const registry = hass.entities;
  if (!registry) return [];
  let byKey = cache.get(registry);
  if (!byKey) cache.set(registry, (byKey = new Map()));
  const key = `${areaId}/${domain}`;
  let ids = byKey.get(key);
  if (!ids) {
    ids = Object.values(registry)
      .filter((e) => e.entity_id.startsWith(`${domain}.`) && !e.hidden && !e.entity_category)
      .filter((e) => (e.area_id ?? (e.device_id ? hass.devices?.[e.device_id]?.area_id : null)) === areaId)
      .map((e) => e.entity_id);
    byKey.set(key, ids);
  }
  return ids;
}

export interface RoomLight {
  rgb: [number, number, number];
  /** 0..1 */
  brightness: number;
}

/** Combined state of an area's lights: null when all are off. */
export function areaLight(hass: Hass, areaId: string): RoomLight | null {
  return lightsLook(hass, areaEntities(hass, areaId, "light"));
}

/** Combined state of some lights (one or more): null when all are off. */
export function lightsLook(hass: Hass, entities: string[]): RoomLight | null {
  const on = entities
    .map((id) => hass.states[id])
    .filter((s) => s?.state === "on");
  if (!on.length) return null;
  const rgb: [number, number, number] = [0, 0, 0];
  let brightness = 0;
  for (const s of on) {
    const c = (s.attributes.rgb_color as [number, number, number] | undefined) ?? [255, 196, 128];
    for (let i = 0; i < 3; i++) rgb[i] += c[i] / on.length;
    brightness = Math.max(brightness, ((s.attributes.brightness as number | undefined) ?? 255) / 255);
  }
  return { rgb, brightness };
}

/** How far a cover is open, 0..1; null when unknown or unavailable. */
export function coverOpen(hass: Hass, entityId: string, inverted = false): number | null {
  const s = hass.states[entityId];
  if (!s || s.state === "unavailable" || s.state === "unknown") return null;
  const position = s.attributes.current_position;
  const open = typeof position === "number" ? Math.min(1, Math.max(0, position / 100)) : s.state === "closed" ? 0 : 1;
  // a cover that reports the other way round
  return inverted ? 1 - open : open;
}

/** Whether a door/window contact reports open. */
export function contactOpen(hass: Hass, entityId: string): boolean {
  return hass.states[entityId]?.state === "on";
}

/**
 * The area's temperature: the sensor chosen in the area settings, otherwise the first
 * temperature sensor HA assigns to the area.
 */
export function areaTemperature(hass: Hass, areaId: string): string | null {
  const chosen = hass.areas?.[areaId]?.temperature_entity_id;
  const id = chosen ?? areaEntities(hass, areaId, "sensor").find((e) => hass.states[e]?.attributes.device_class === "temperature");
  const s = id ? hass.states[id] : undefined;
  if (!s || isNaN(Number(s.state))) return null;
  const unit = (s.attributes.unit_of_measurement as string | undefined) ?? "";
  return `${formatNumber(hass.locale, Number(s.state), 1)} ${unit}`.trim();
}

/** The area's sensor of a kind: the one chosen in HA's area settings, else the first. */
function areaSensor(hass: Hass, areaId: string, deviceClass: string): string | undefined {
  const area = hass.areas?.[areaId];
  const chosen = deviceClass === "temperature" ? area?.temperature_entity_id : deviceClass === "humidity" ? area?.humidity_entity_id : undefined;
  return chosen ?? areaEntities(hass, areaId, "sensor").find((e) => hass.states[e]?.attributes.device_class === deviceClass);
}

/** Without a sensor: what a thermostat or AC of the area measures (temperature, humidity). */
function climateMeasure(hass: Hass, areaId: string, deviceClass: string): number | null {
  const attribute = deviceClass === "temperature" ? "current_temperature" : deviceClass === "humidity" ? "current_humidity" : null;
  if (!attribute) return null;
  for (const id of areaEntities(hass, areaId, "climate")) {
    const v = hass.states[id]?.attributes[attribute];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** The area's first reading of a sensor kind (temperature, humidity, carbon_dioxide…), or null. */
export function areaReading(hass: Hass, areaId: string, deviceClass: string): number | null {
  const id = areaSensor(hass, areaId, deviceClass);
  const v = id ? Number(hass.states[id]?.state) : NaN;
  return Number.isFinite(v) ? v : climateMeasure(hass, areaId, deviceClass);
}

/** Grams of water in a cubic metre of air at this temperature (°C) and relative humidity (%). */
export function absoluteHumidity(t: number, rh: number) {
  return (6.112 * Math.exp((17.67 * t) / (t + 243.5)) * rh * 2.1674) / (273.15 + t);
}

/**
 * A room's climate hint: `mould` from 70 % humidity on, `air` from 60 % when airing helps
 * (the outside air holds less water; unknown outside: always), else null.
 */
export function climateHint(hass: Hass, areaId: string, outside: { temperature: number; humidity: number } | null): "mould" | "air" | null {
  const rh = areaReading(hass, areaId, "humidity");
  if (rh === null || rh < 60) return null;
  if (rh >= 70) return "mould";
  const t = areaReading(hass, areaId, "temperature") ?? 20;
  if (outside && absoluteHumidity(outside.temperature, outside.humidity) > absoluteHumidity(t, rh) * 0.9) return null;
  return "air";
}

/** Readings a room's label can show, with their decimals. */
export const VALUE_KINDS: Record<string, number> = { temperature: 1, humidity: 0, carbon_dioxide: 0, pm25: 0, volatile_organic_compounds: 0 };

export type Steps = { value: number; color: string | null }[];

export interface AreaValue {
  kind: string;
  text: string;
  /** Its step colour (null: comfortable). */
  color: string | null;
}

/** The area's readings of these kinds, written with their units and coloured by the steps. */
export function areaValues(hass: Hass, areaId: string, kinds: string[], steps: Record<string, Steps> = HEATMAP_STEPS): AreaValue[] {
  return kinds.flatMap((kind) => {
    const id = areaSensor(hass, areaId, kind);
    const s = id ? hass.states[id] : undefined;
    const sensed = Number(s?.state);
    const v = s && Number.isFinite(sensed) ? sensed : climateMeasure(hass, areaId, kind);
    if (v === null) return [];
    const unit = s && Number.isFinite(sensed) ? ((s.attributes.unit_of_measurement as string | undefined) ?? "") : kind === "humidity" ? "%" : (hass.config?.unit_system?.temperature ?? "°C");
    const text = `${formatNumber(hass.locale, v, VALUE_KINDS[kind] ?? 0)}${unit === "%" ? "" : " "}${unit}`.trim();
    return [{ kind, text, color: steps[kind] ? stepColor(v, steps[kind]) : null }];
  });
}

/** Colour steps per reading: below the first value its colour, from each value on the next. */
export const HEATMAP_STEPS: Record<string, Steps> = {
  temperature: [
    { value: -Infinity, color: "#3d7be0" },
    { value: 18, color: "#6fb7e8" },
    { value: 20, color: null },
    { value: 24, color: "#f0a33c" },
    { value: 27, color: "#e8483c" },
  ],
  humidity: [
    { value: -Infinity, color: "#e0b13d" },
    { value: 35, color: null },
    { value: 60, color: "#3d9be0" },
    { value: 70, color: "#3d5be0" },
  ],
  carbon_dioxide: [
    { value: -Infinity, color: null },
    { value: 1000, color: "#f0a33c" },
    { value: 1500, color: "#e8483c" },
  ],
  // µg/m³, around the WHO's daily guideline
  pm25: [
    { value: -Infinity, color: null },
    { value: 25, color: "#f0a33c" },
    { value: 50, color: "#e8483c" },
  ],
};

/** The colour of a reading in steps (null: comfortable, no tint). */
export function stepColor(value: number, steps: Steps): string | null {
  let color: string | null = null;
  for (const s of steps) if (value >= s.value) color = s.color;
  return color;
}

/** The area's light level in lux: its first illuminance sensor, or null. */
export function areaIlluminance(hass: Hass, areaId: string): number | null {
  const id = areaEntities(hass, areaId, "sensor").find((e) => hass.states[e]?.attributes.device_class === "illuminance");
  const v = id ? Number(hass.states[id]?.state) : NaN;
  return Number.isFinite(v) ? v : null;
}

/**
 * How bright a room looks from its lux reading, 0 (dark) … 1 (daylight, 300 lx and
 * more), on a log scale as eyes see it.
 */
export function daylight(lux: number): number {
  return Math.max(0, Math.min(1, Math.log10(Math.max(0, lux) + 1) / Math.log10(301)));
}

export interface PopupSection {
  title: "lights" | "covers" | "climate" | "media" | "cameras" | "scenes" | "devices" | "sensors";
  cards: Record<string, unknown>[];
}

/**
 * Standard HA cards for everything in an area, grouped like HA's own area views.
 * `extra` adds entities placed in the room that may not belong to its area, such as the
 * blinds and contacts of its windows or an awning.
 */
/** Sensors worth a tile in a room's popup. */
const SENSOR_CLASSES = ["temperature", "humidity", "carbon_dioxide", "pm25", "volatile_organic_compounds", "illuminance", "power"];
const BINARY_CLASSES = ["door", "window", "garage_door", "opening", "motion", "occupancy", "presence", "moisture", "smoke", "gas", "carbon_monoxide"];

export function areaPopup(hass: Hass, areaId: string | undefined, extra: string[] = []): PopupSection[] {
  const ids = (domain: string) => {
    const own = areaId ? areaEntities(hass, areaId, domain) : [];
    const more = extra.filter((e) => e.startsWith(`${domain}.`) && !own.includes(e) && hass.states[e]);
    return [...own, ...new Set(more)];
  };
  const deviceClass = (id: string) => hass.states[id]?.attributes.device_class as string | undefined;
  const tile = (entity: string, features?: Record<string, unknown>[]) => ({ type: "tile", entity, ...(features ? { features } : {}) });
  const sections: PopupSection[] = [
    { title: "lights", cards: ids("light").map((e) => tile(e, [{ type: "light-brightness" }])) },
    { title: "covers", cards: ids("cover").map((e) => tile(e, [{ type: "cover-open-close" }])) },
    { title: "climate", cards: ids("climate").map((entity) => ({ type: "thermostat", entity })) },
    { title: "media", cards: ids("media_player").map((entity) => ({ type: "media-control", entity })) },
    { title: "cameras", cards: ids("camera").map((entity) => ({ type: "picture-entity", entity, camera_view: "auto", show_name: false, show_state: false })) },
    { title: "scenes", cards: ["scene", "script"].flatMap(ids).map((e) => tile(e)) },
    { title: "devices", cards: ["switch", "fan", "humidifier", "water_heater", "valve", "vacuum", "lawn_mower", "lock"].flatMap(ids).map((e) => tile(e)) },
    {
      title: "sensors",
      cards: [
        ...ids("sensor").filter((e) => SENSOR_CLASSES.includes(deviceClass(e) ?? "")),
        ...ids("binary_sensor").filter((e) => BINARY_CLASSES.includes(deviceClass(e) ?? "")),
      ].map((e) => tile(e)),
    },
  ];
  return sections.filter((s) => s.cards.length);
}

/** Binary sensors that mean someone is in a room. */
const PRESENCE = ["motion", "occupancy", "presence"];
/** Binary sensors that call for attention, with their icons. */
const ALERTS: Record<string, string> = { alarm: "mdi:alarm-light", air: "mdi:window-open-variant", mould: "mdi:water-percent-alert", rain: "mdi:weather-pouring", moisture: "mdi:water-alert", smoke: "mdi:smoke-detector-alert", gas: "mdi:gas-cylinder", carbon_monoxide: "mdi:molecule-co" };

export interface AreaSensors {
  /** A motion, occupancy or presence sensor of the area is on. */
  presence: boolean;
  /** Leak, smoke, gas or CO sensors of the area that are on: their device classes. */
  alerts: string[];
}

/** What the area's motion, presence and alarm sensors say. */
export function areaSensors(hass: Hass, areaId: string): AreaSensors {
  let presence = false;
  const alerts: string[] = [];
  for (const id of areaEntities(hass, areaId, "binary_sensor")) {
    const s = hass.states[id];
    if (s?.state !== "on") continue;
    const dc = String(s.attributes.device_class ?? "");
    if (PRESENCE.includes(dc)) presence = true;
    else if (dc in ALERTS && !alerts.includes(dc)) alerts.push(dc);
  }
  return { presence, alerts };
}

/** Alerts that are notes (a hint, an open window in the rain): no red room, no flying to them. */
export const SOFT_ALERTS = ["rain", "air", "mould"];
export const hardAlerts = (alerts: string[]) => alerts.filter((a) => !SOFT_ALERTS.includes(a));

/** Some alarm panel is going off. */
export const alarmTriggered = (hass: Hass) => Object.values(hass.states).some((s) => s.entity_id.startsWith("alarm_control_panel.") && s.state === "triggered");

/** The icon for an alert's device class. */
export const alertIcon = (deviceClass: string) => ALERTS[deviceClass] ?? "mdi:alert";
