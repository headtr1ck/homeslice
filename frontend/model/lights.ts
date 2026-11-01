// Where each light of a room sits: placed ones where the model says, the rest of the
// area's lights spread evenly over the room.

import { bbox, labelPoint, pointInPolygon } from "./geometry";
import type { House, LightType, Room, Vec2 } from "./types";

export interface PlacedLight {
  levelId: string;
  roomId: string;
  entity: string;
  at: Vec2;
  /** Placed automatically (not in the model). */
  auto: boolean;
  /** The light of a piece of furniture. */
  piece?: boolean;
  /** How it looks (see LightInput.type); spots' further downlights, a strip's other end. */
  type: LightType;
  spots: Vec2[];
  to?: Vec2;
  height?: number;
}

/** Lights listed in any room of the house: those are never auto-placed elsewhere. */
export function listedLights(house: House): Set<string> {
  return new Set(house.levels.flatMap((l) => l.rooms.flatMap((r) => r.lights.map((x) => x.entity))));
}

/** `n` points spread over a polygon: cell centres of a grid over its bounds that lie inside. */
export function spread(polygon: Vec2[], n: number): Vec2[] {
  if (n <= 0) return [];
  const centre = labelPoint(polygon);
  if (n === 1) return [centre];
  const { min, max } = bbox(polygon);
  const w = max[0] - min[0];
  const d = max[1] - min[1];
  for (let extra = 0; extra < 4; extra++) {
    const cols = Math.max(1, Math.round(Math.sqrt((n * w) / Math.max(d, 0.01)))) + extra;
    const rows = Math.ceil(n / cols) + extra;
    const pts: Vec2[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const p: Vec2 = [min[0] + (w * (c + 0.5)) / cols, min[1] + (d * (r + 0.5)) / rows];
        if (pointInPolygon(p, polygon)) pts.push(p);
      }
    if (pts.length >= n) return pts.slice(0, n).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  }
  return Array.from({ length: n }, () => centre);
}

/**
 * A room's lights: its listed ones (unless hidden), then the area's other lights not
 * listed anywhere in the house. Without `at`, lights are spread over `polygon` (the
 * room's floor inside the walls).
 */
export function placeLights(levelId: string, room: Room, polygon: Vec2[], areaLights: string[], listed: Set<string>): PlacedLight[] {
  const own = new Set(room.lights.map((l) => l.entity));
  const entries = [
    ...room.lights.filter((l) => !l.hidden),
    ...areaLights.filter((e) => !own.has(e) && !listed.has(e)).map((entity) => ({ entity, at: undefined, type: "lamp" as LightType, spots: [] as Vec2[] })),
  ];
  const free = spread(polygon, entries.filter((e) => !e.at).length);
  let i = 0;
  return entries.map((e) => ({
    levelId,
    roomId: room.id,
    entity: e.entity,
    at: e.at ?? free[i++],
    auto: !e.at,
    ...("piece" in e && e.piece ? { piece: true } : {}),
    type: e.type,
    spots: e.spots,
    ...("to" in e && e.to ? { to: e.to } : {}),
    ...("height" in e && e.height !== undefined ? { height: e.height } : {}),
  }));
}
