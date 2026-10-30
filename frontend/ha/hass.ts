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
  areas?: Record<string, { area_id: string; name: string; icon?: string | null; floor_id?: string | null }>;
  floors?: Record<string, { floor_id: string; name: string; level?: number | null }>;
  devices?: Record<string, { id: string; area_id?: string | null }>;
  entities?: Record<string, { entity_id: string; area_id?: string | null; device_id?: string | null; hidden?: boolean; entity_category?: string | null }>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
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
  const on = areaEntities(hass, areaId, "light")
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
