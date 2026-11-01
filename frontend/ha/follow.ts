// The card can turn to where something happens (a doorbell, a washer that is done, an
// alarm): which listed entity just became active, and where in the house it is.
import type { House } from "../model/types";
import type { Hass } from "./hass";

/** An entity's area: its own, or its device's. */
export function entityArea(hass: Hass, entityId: string): string | null {
  const e = hass.entities?.[entityId];
  if (!e) return null;
  return e.area_id ?? (e.device_id ? hass.devices?.[e.device_id]?.area_id ?? null : null);
}

/**
 * Where an entity is in the house: the floor (and room) of a door or window it belongs
 * to, of a piece or light linked to it, else of the room of its area.
 */
export function whereIs(house: House, hass: Hass, entityId: string, openings: { levelId: string; room: string; cover?: string; contact?: string }[]): { levelId: string; roomId?: string } | null {
  const o = openings.find((x) => x.cover === entityId || x.contact === entityId);
  if (o) return { levelId: o.levelId, roomId: o.room };
  for (const level of house.levels)
    for (const room of level.rooms)
      if (room.furniture.some((f) => f.entity === entityId) || room.lights.some((l) => l.entity === entityId) || room.awning === entityId) return { levelId: level.id, roomId: room.id };
  const area = entityArea(hass, entityId);
  if (area)
    for (const level of house.levels) {
      const room = level.rooms.find((r) => r.areaId === area);
      if (room) return { levelId: level.id, roomId: room.id };
    }
  return null;
}

const ACTIVE = new Set(["on", "open", "opening", "playing", "ringing", "detected", "triggered", "unlocked", "problem", "home"]);

/**
 * A state that means "something happens": on, open, ringing… For event entities (a
 * doorbell press), every new timestamp is one.
 */
export function activation(entityId: string, before: string | undefined, now: string | undefined): boolean {
  if (now === undefined || now === "unavailable" || now === "unknown" || before === undefined) return false;
  if (entityId.startsWith("event.")) return now !== before;
  return ACTIVE.has(now) && !ACTIVE.has(before);
}
