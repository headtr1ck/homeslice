// Pure editing operations on the input (short-form) model. They never mutate their input:
// each returns a new model, which keeps undo/redo trivial and makes them easy to test.

import { bbox, dist, normalizeOrientation, project, signedArea } from "../model/geometry";
import type { Coord, HouseInput, LevelInput, RoomInput, ShapeInput, Side, Vec2 } from "../model/types";

/** Points closer than this count as the same corner (shared by neighbouring rooms). */
export const SAME_POINT = 0.01;

const round = (v: number) => Math.round(v * 1000) / 1000;

export function clone<T>(v: T): T {
  return structuredClone(v);
}

function coord(model: HouseInput, c: Coord, axis: "x" | "y"): number {
  return typeof c === "number" ? c : model.grid?.[axis]?.[c] ?? 0;
}

/** A room's polygon in metres (positive orientation), whether it is stored as rect or polygon. */
export function roomPolygon(model: HouseInput, room: RoomInput): Vec2[] {
  if (room.polygon) return normalizeOrientation(room.polygon.map(([x, y]) => [coord(model, x, "x"), coord(model, y, "y")] as Vec2));
  if (room.rect) {
    const [x, y, w, d] = room.rect;
    const x0 = coord(model, x, "x");
    const y0 = coord(model, y, "y");
    return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]];
  }
  return [];
}

/** Stores a polygon back; axis-aligned rectangles stay `rect` (shorter, easier to read and write). */
export function setRoomPolygon(room: RoomInput, poly: Vec2[]): RoomInput {
  const p = poly.map(([x, y]) => [round(x), round(y)] as Vec2);
  const { min, max } = bbox(p);
  const isRect =
    p.length === 4 &&
    p.every(([x, y]) => (Math.abs(x - min[0]) < 1e-6 || Math.abs(x - max[0]) < 1e-6) && (Math.abs(y - min[1]) < 1e-6 || Math.abs(y - max[1]) < 1e-6));
  const out: RoomInput = { ...room };
  delete out.rect;
  delete out.polygon;
  if (isRect) out.rect = [min[0], min[1], round(max[0] - min[0]), round(max[1] - min[1])];
  else out.polygon = p;
  return out;
}

export function level(model: HouseInput, levelId: string): LevelInput {
  const l = model.levels.find((x) => x.id === levelId);
  if (!l) throw new Error(`no level ${levelId}`);
  return l;
}

/** Polygon of an outline (or any rect/polygon shape). */
export function shapePolygon(model: HouseInput, shape: ShapeInput | undefined): Vec2[] {
  return shape ? roomPolygon(model, { id: "", ...shape }) : [];
}

/**
 * The outline a level uses: its own, or the house outline shared by every level without
 * one. Editing it affects all `levels` listed.
 */
export function outlineScope(model: HouseInput, levelId: string): { owner: "house" | "level"; levels: string[]; poly: Vec2[] } {
  const l = level(model, levelId);
  if (l.outline) return { owner: "level", levels: [levelId], poly: shapePolygon(model, l.outline) };
  return { owner: "house", levels: model.levels.filter((x) => !x.outline).map((x) => x.id), poly: shapePolygon(model, model.outline) };
}

function writeOutline(m: HouseInput, levelId: string, owner: "house" | "level", poly: Vec2[]) {
  const { id: _id, ...shape } = setRoomPolygon({ id: "" }, poly);
  if (owner === "house") m.outline = shape;
  else level(m, levelId).outline = shape;
}

const onSegmentOf = (a: Vec2, b: Vec2) => (p: Vec2) => {
  const pr = project(p, a, b);
  return pr.distance < SAME_POINT && pr.t > -SAME_POINT && pr.t < pr.length + SAME_POINT;
};

function mapRooms(m: HouseInput, levelId: string, fn: (p: Vec2) => Vec2 | null) {
  const l = level(m, levelId);
  l.rooms = l.rooms.map((room) => {
    const poly = roomPolygon(m, room);
    const moved = poly.map((p) => fn(p) ?? p);
    return moved.some((p, i) => p !== poly[i]) ? setRoomPolygon(room, moved) : room;
  });
}

/**
 * Moves every room corner at `from` (shared corners move together) to `to`. A corner of
 * the outline moves the outline too, on every level sharing it.
 */
export function moveVertex(model: HouseInput, levelId: string, from: Vec2, to: Vec2): HouseInput {
  const m = clone(model);
  const scope = outlineScope(m, levelId);
  const outlineCorner = scope.poly.some((p) => dist(p, from) < SAME_POINT);
  const levels = outlineCorner ? scope.levels : [levelId];
  for (const id of levels) mapRooms(m, id, (p) => (dist(p, from) < SAME_POINT ? to : null));
  if (outlineCorner) writeOutline(m, levelId, scope.owner, scope.poly.map((p) => (dist(p, from) < SAME_POINT ? to : p)));
  return m;
}

/**
 * Moves a wall: every corner on the segment a–b (including T-junctions of neighbouring
 * rooms) moves by `delta`, so the rooms on both sides follow. A segment on the outline
 * moves the whole façade: the full outline edge, with every room along it, on every level
 * sharing the outline.
 */
export function moveEdge(model: HouseInput, levelId: string, a: Vec2, b: Vec2, delta: Vec2): HouseInput {
  const m = clone(model);
  const scope = outlineScope(m, levelId);
  const facade = scope.poly
    .map((p, i) => [p, scope.poly[(i + 1) % scope.poly.length]] as [Vec2, Vec2])
    .find(([p, q]) => onSegmentOf(p, q)(a) && onSegmentOf(p, q)(b));
  if (!facade) {
    const on = onSegmentOf(a, b);
    mapRooms(m, levelId, (p) => (on(p) ? [p[0] + delta[0], p[1] + delta[1]] : null));
    return m;
  }
  const on = onSegmentOf(facade[0], facade[1]);
  const shift = (p: Vec2): Vec2 => [p[0] + delta[0], p[1] + delta[1]];
  for (const id of scope.levels) mapRooms(m, id, (p) => (on(p) ? shift(p) : null));
  writeOutline(m, levelId, scope.owner, scope.poly.map((p) => (on(p) ? shift(p) : p)));
  return m;
}

/** Gives a level its own copy of the house outline (e.g. for an overhang), or drops it again. */
export function setOwnOutline(model: HouseInput, levelId: string, own: boolean): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  if (own && !l.outline && m.outline) l.outline = clone(m.outline);
  if (!own) delete l.outline;
  return m;
}

/** Moves a level to a new position in the bottom-to-top list. */
export function moveLevel(model: HouseInput, levelId: string, toIndex: number): HouseInput {
  const m = clone(model);
  const from = m.levels.findIndex((l) => l.id === levelId);
  if (from < 0) return m;
  const [l] = m.levels.splice(from, 1);
  m.levels.splice(Math.max(0, Math.min(m.levels.length, toIndex)), 0, l);
  return m;
}

/** Inserts a corner on an edge of every room that has that edge (keeps neighbours connected). */
export function splitEdge(model: HouseInput, levelId: string, a: Vec2, b: Vec2, at: Vec2): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  l.rooms = l.rooms.map((room) => {
    const poly = roomPolygon(m, room);
    const out: Vec2[] = [];
    let changed = false;
    poly.forEach((p, i) => {
      out.push(p);
      const q = poly[(i + 1) % poly.length];
      const same = (dist(p, a) < SAME_POINT && dist(q, b) < SAME_POINT) || (dist(p, b) < SAME_POINT && dist(q, a) < SAME_POINT);
      if (same) {
        out.push(at);
        changed = true;
      }
    });
    return changed ? setRoomPolygon(room, out) : room;
  });
  return m;
}

/** Removes a corner from every room that has it (a room keeps at least 3 corners). */
export function removeVertex(model: HouseInput, levelId: string, at: Vec2): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  l.rooms = l.rooms.map((room) => {
    const poly = roomPolygon(m, room);
    const out = poly.filter((p) => dist(p, at) >= SAME_POINT);
    return out.length !== poly.length && out.length >= 3 ? setRoomPolygon(room, out) : room;
  });
  return m;
}

export function uniqueRoomId(l: LevelInput, base = "room"): string {
  const ids = new Set(l.rooms.map((r) => r.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function addRoom(model: HouseInput, levelId: string, poly: Vec2[], props: Partial<RoomInput> = {}): { model: HouseInput; id: string } {
  const m = clone(model);
  const l = level(m, levelId);
  const id = props.id ?? uniqueRoomId(l);
  l.rooms.push(setRoomPolygon({ ...props, id }, normalizeOrientation(poly)));
  return { model: m, id };
}

export function deleteRoom(model: HouseInput, levelId: string, roomId: string): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  l.rooms = l.rooms.filter((r) => r.id !== roomId);
  l.openings = (l.openings ?? []).filter((o) => o.room !== roomId);
  return m;
}

/** Changes room properties; renaming the id also updates the openings that refer to it. */
export function updateRoom(model: HouseInput, levelId: string, roomId: string, patch: Partial<RoomInput>): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  l.rooms = l.rooms.map((r) => {
    if (r.id !== roomId) return r;
    const next = { ...r, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined || v === "") delete (next as Record<string, unknown>)[k];
    return next;
  });
  if (patch.id && patch.id !== roomId) for (const o of l.openings ?? []) if (o.room === roomId) o.room = patch.id;
  return m;
}

const OPPOSITE: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };

/**
 * Which sides (as seen from room `a`) of the boundary between rooms a and b are open,
 * according to the level's wall entries.
 */
export function openSides(model: HouseInput, levelId: string, a: string, b: string, allSides: Side[]): Side[] {
  const open = new Set<Side>();
  for (const w of level(model, levelId).walls ?? []) {
    if (!w.between || (w.type ?? "open") !== "open") continue;
    const [x, y] = w.between;
    if (!((x === a && y === b) || (x === b && y === a))) continue;
    if (!w.side) allSides.forEach((s) => open.add(s));
    else open.add(x === a ? w.side : OPPOSITE[w.side]);
  }
  return allSides.filter((s) => open.has(s));
}

/**
 * Opens or closes one side (seen from room `a`) of the boundary between rooms a and b.
 * Rewrites that pair's entries: one entry without side when everything is open.
 */
export function setBoundaryOpen(model: HouseInput, levelId: string, a: string, b: string, side: Side, open: boolean, allSides: Side[]): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  const sides = new Set(openSides(m, levelId, a, b, allSides));
  if (open) sides.add(side);
  else sides.delete(side);
  const others = (l.walls ?? []).filter((w) => !(w.between && w.between.includes(a) && w.between.includes(b)));
  const mine = sides.size === allSides.length ? [{ between: [a, b] as [string, string] }] : [...sides].map((s) => ({ between: [a, b] as [string, string], side: s }));
  l.walls = [...others, ...mine];
  if (!l.walls.length) delete l.walls;
  return m;
}

// ----- snapping -----

export interface SnapContext {
  /** Grid step in metres (0 = off). */
  grid: number;
  /** Corners to snap to (this level and the level below). */
  points: Vec2[];
  /** x and y values to align with (auto 90°: neighbouring corners' coordinates). */
  align: { x: number[]; y: number[] };
  /** Snap distance in metres (depends on zoom). */
  tolerance: number;
}

export interface Snapped {
  p: Vec2;
  /** What it snapped to, for the hint next to the cursor. */
  kind: "point" | "align" | "grid" | "free";
}

export function snap(p: Vec2, ctx: SnapContext): Snapped {
  let best: Vec2 | null = null;
  let bestD = ctx.tolerance;
  for (const q of ctx.points) {
    const d = dist(p, q);
    if (d < bestD) [best, bestD] = [q, d];
  }
  if (best) return { p: [best[0], best[1]], kind: "point" };
  const near = (v: number, list: number[]) => list.reduce<number | null>((acc, c) => (Math.abs(c - v) < ctx.tolerance && (acc === null || Math.abs(c - v) < Math.abs(acc - v)) ? c : acc), null);
  const ax = near(p[0], ctx.align.x);
  const ay = near(p[1], ctx.align.y);
  const g = (v: number) => (ctx.grid > 0 ? Math.round(v / ctx.grid) * ctx.grid : v);
  if (ax !== null || ay !== null) return { p: [round(ax ?? g(p[0])), round(ay ?? g(p[1]))], kind: "align" };
  if (ctx.grid > 0) return { p: [round(g(p[0])), round(g(p[1]))], kind: "grid" };
  return { p, kind: "free" };
}

// ----- readouts -----

export const area = (poly: Vec2[]) => Math.abs(signedArea(poly));

/** Interior angle at corner i in degrees (positively oriented polygon). */
export function cornerAngle(poly: Vec2[], i: number): number {
  const p = poly[(i - 1 + poly.length) % poly.length];
  const q = poly[i];
  const r = poly[(i + 1) % poly.length];
  const a1 = Math.atan2(p[1] - q[1], p[0] - q[0]);
  const a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
  let deg = ((a1 - a2) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

// ----- history -----

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private limit = 200) {}

  push(previous: T) {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
