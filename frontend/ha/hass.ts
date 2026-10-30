// The parts of Home Assistant's frontend `hass` object Homeslice relies on, and helpers
// built on HA's own registries. Keep every dependency on HA internals in this file.

export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface Hass {
  locale?: { language: string };
  states: Record<string, HassEntityState>;
  areas?: Record<string, { area_id: string; name: string; icon?: string | null; floor_id?: string | null; temperature_entity_id?: string | null }>;
  floors?: Record<string, { floor_id: string; name: string; level?: number | null }>;
  devices?: Record<string, { id: string; area_id?: string | null }>;
  entities?: Record<string, { entity_id: string; area_id?: string | null; device_id?: string | null; hidden?: boolean; entity_category?: string | null }>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  connection?: {
    subscribeMessage<T>(callback: (msg: T) => void, msg: Record<string, unknown>): Promise<() => Promise<void> | void>;
  };
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: Record<string, unknown>): Promise<unknown>;
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
export function coverOpen(hass: Hass, entityId: string): number | null {
  const s = hass.states[entityId];
  if (!s || s.state === "unavailable" || s.state === "unknown") return null;
  const position = s.attributes.current_position;
  if (typeof position === "number") return Math.min(1, Math.max(0, position / 100));
  return s.state === "closed" ? 0 : 1;
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
  return `${Number(s.state).toFixed(1)} ${unit}`.trim();
}

export interface PopupSection {
  title: "lights" | "covers" | "climate" | "media" | "devices" | "sensors";
  cards: Record<string, unknown>[];
}

/**
 * Standard HA cards for everything in an area, grouped like HA's own area views.
 * `extra` adds entities placed in the room that may not belong to its area, such as the
 * blinds and contacts of its windows or an awning.
 */
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
    { title: "devices", cards: ["switch", "fan", "vacuum", "lawn_mower", "lock"].flatMap(ids).map((e) => tile(e)) },
    {
      title: "sensors",
      cards: [
        ...ids("sensor").filter((e) => ["temperature", "humidity", "carbon_dioxide", "power"].includes(deviceClass(e) ?? "")),
        ...ids("binary_sensor").filter((e) => ["door", "window", "motion", "occupancy", "moisture"].includes(deviceClass(e) ?? "")),
      ].map((e) => tile(e)),
    },
  ];
  return sections.filter((s) => s.cards.length);
}
