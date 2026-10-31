// Pure editing operations on the input (short-form) model. They never mutate their input:
// each returns a new model, which keeps undo/redo trivial and makes them easy to test.

import { bbox, dist, normalizeOrientation, project, signedArea } from "../model/geometry";
import type { Coord, EnergyInput, HouseInput, LevelInput, OpeningInput, OpeningSource, RoomInput, ShapeInput, RoofInput, Side, Vec2, VerticalInput } from "../model/types";

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

/**
 * Moves one piece of wall (e.g. the wall between two rooms) without dragging the rest of
 * the room sides it lies on: room sides containing the piece get corners at its ends
 * first, then only the piece moves.
 */
export function moveWallPiece(model: HouseInput, levelId: string, a: Vec2, b: Vec2, delta: Vec2): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  const onPiece = onSegmentOf(a, b);
  const moved = (p: Vec2): Vec2 => [round(p[0] + delta[0]), round(p[1] + delta[1])];
  l.rooms = l.rooms.map((room) => {
    const poly = roomPolygon(m, room);
    const out: Vec2[] = [];
    let changed = false;
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      if (onPiece(p)) {
        const prev = poly[(i - 1 + poly.length) % poly.length];
        const tp = project(p, a, b).t;
        const len = dist(a, b);
        const inner = tp > SAME_POINT && tp < len - SAME_POINT;
        // where a neighbouring side runs along the piece, or past its end
        const runs = (x: Vec2) => {
          const pr = project(x, a, b);
          if (pr.distance > SAME_POINT) return "off";
          return (tp < SAME_POINT && pr.t < -SAME_POINT) || (tp > len - SAME_POINT && pr.t > len + SAME_POINT) ? "beyond" : "along";
        };
        const rp = runs(prev);
        const rq = runs(q);
        if (!inner && rp !== "along" && rq !== "along") {
          // only touches the piece at its end: stays put
          out.push(p);
        } else {
          // a T-junction keeps a corner that stays put on the side running past the end
          if (rp === "beyond") out.push(p);
          out.push(moved(p));
          if (rq === "beyond") out.push(p);
          changed = true;
        }
      } else out.push(p);
      // where the piece ends in the middle of this side, the side gets a step:
      // a corner that stays and one that moves with the wall
      const pa = project(a, p, q);
      const pb = project(b, p, q);
      if (pa.distance > SAME_POINT || pb.distance > SAME_POINT) return;
      const s0 = Math.max(0, Math.min(pa.t, pb.t));
      const s1 = Math.min(pa.length, Math.max(pa.t, pb.t));
      if (s1 - s0 < SAME_POINT) return;
      const at = (t: number): Vec2 => [p[0] + ((q[0] - p[0]) * t) / pa.length, p[1] + ((q[1] - p[1]) * t) / pa.length];
      if (s0 > SAME_POINT) out.push(at(s0), moved(at(s0)));
      if (s1 < pa.length - SAME_POINT) out.push(moved(at(s1)), at(s1));
      changed = true;
    });
    return changed ? setRoomPolygon(room, out) : room;
  });
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

// ----- openings -----

export function addOpening(model: HouseInput, levelId: string, opening: OpeningInput): { model: HouseInput; source: OpeningSource } {
  const m = clone(model);
  const l = level(m, levelId);
  l.openings = [...(l.openings ?? []), opening];
  return { model: m, source: { kind: "level", index: l.openings.length - 1 } };
}

/** The editable fields of an opening, as the level sees it (covers are per level for façades). */
export function readOpening(model: HouseInput, levelId: string, src: OpeningSource): OpeningInput | null {
  if (src.kind === "level") return level(model, levelId).openings?.[src.index] ?? null;
  const f = model.facade_openings?.[src.index];
  if (!f) return null;
  return { room: "", side: f.side, at: f.at, width: f.width, type: f.type, sill: f.sill, height: f.height, cover: f.covers?.[levelId], contact: f.contacts?.[levelId] };
}

/**
 * Changes an opening. For a façade opening, geometry changes apply to every level
 * sharing it, while cover and contact are set for this level only.
 */
export function updateOpening(model: HouseInput, levelId: string, src: OpeningSource, patch: Partial<OpeningInput>): HouseInput {
  const m = clone(model);
  const clean = <T extends object>(o: T) => {
    for (const [k, v] of Object.entries(o)) if (v === undefined || v === "") delete (o as Record<string, unknown>)[k];
    return o;
  };
  if (src.kind === "level") {
    const list = level(m, levelId).openings ?? [];
    list[src.index] = clean({ ...list[src.index], ...patch });
    return m;
  }
  const f = m.facade_openings![src.index];
  const { cover, contact, room: _room, side: _side, ...geometry } = patch;
  Object.assign(f, geometry);
  if ("cover" in patch) f.covers = clean({ ...f.covers, [levelId]: cover }) as Record<string, string>;
  if ("contact" in patch) f.contacts = clean({ ...f.contacts, [levelId]: contact }) as Record<string, string>;
  clean(f);
  return m;
}

/** Removes an opening from this level (a façade opening stays on the other levels). */
export function deleteOpening(model: HouseInput, levelId: string, src: OpeningSource): HouseInput {
  const m = clone(model);
  if (src.kind === "level") {
    const l = level(m, levelId);
    l.openings = (l.openings ?? []).filter((_, i) => i !== src.index);
    if (!l.openings.length) delete l.openings;
    return m;
  }
  const f = m.facade_openings![src.index];
  f.levels = f.levels.filter((x) => x !== levelId);
  if (!f.levels.length) m.facade_openings!.splice(src.index, 1);
  if (!m.facade_openings!.length) delete m.facade_openings;
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
  /** The corner snapped to (kind "point"). */
  target?: Vec2;
  /** Coordinates it lined up with (kind "align"), for guide lines. */
  alignX?: number;
  alignY?: number;
}

/** Snaps a value to the nearest target within tolerance; null if none. */
export function snapValue(v: number, targets: number[], tolerance: number): number | null {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - v) < tolerance && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return best;
}

export function snap(p: Vec2, ctx: SnapContext): Snapped {
  let best: Vec2 | null = null;
  let bestD = ctx.tolerance;
  for (const q of ctx.points) {
    const d = dist(p, q);
    if (d < bestD) [best, bestD] = [q, d];
  }
  if (best) return { p: [best[0], best[1]], kind: "point", target: [best[0], best[1]] };
  const ax = snapValue(p[0], ctx.align.x, ctx.tolerance);
  const ay = snapValue(p[1], ctx.align.y, ctx.tolerance);
  const g = (v: number) => (ctx.grid > 0 ? Math.round(v / ctx.grid) * ctx.grid : v);
  if (ax !== null || ay !== null)
    return { p: [round(ax ?? g(p[0])), round(ay ?? g(p[1]))], kind: "align", ...(ax !== null ? { alignX: ax } : {}), ...(ay !== null ? { alignY: ay } : {}) };
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

// ----- houses and levels -----

/** "Living Room" → "living_room": ids are lower-case letters, digits and _. */
export function slug(text: string, fallback = "item"): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || fallback;
}

export function uniqueId(taken: Iterable<string>, base: string): string {
  const ids = new Set(taken);
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}_${i}`)) return `${base}_${i}`;
}

export interface AreaSeed {
  area_id: string;
  name: string;
}

/** Area names that are most likely outside (English and German). */
const OUTDOOR = /garden|garten|terrace|terrasse|patio|balcon|balkon|yard|deck|porch|veranda|pool|driveway|einfahrt|outdoor|outside|au(ss|ß)en|hof\b|wintergarden|wintergarten/i;

export const looksOutdoor = (a: AreaSeed) => OUTDOOR.test(a.name) || OUTDOOR.test(a.area_id);

/**
 * Placeholder rooms for areas: a grid of rectangles filling `rect` (x, y, width, depth),
 * sharing walls, so a new level starts as a valid plan the user only has to reshape.
 * Areas that sound like outside (garden, terrace, …) become outdoor areas in a 3 m strip
 * south of the house.
 */
export function layoutRooms(rect: [number, number, number, number], areas: AreaSeed[], taken: string[] = []): RoomInput[] {
  const [x0, y0, w, d] = rect;
  const ids = [...taken];
  const make = (a: AreaSeed, r: [number, number, number, number], props: Partial<RoomInput> = {}): RoomInput => {
    const id = uniqueId(ids, slug(a.area_id, "room"));
    ids.push(id);
    return { id, area_id: a.area_id, ...props, rect: r };
  };
  const indoor = areas.filter((a) => !looksOutdoor(a));
  const outdoor = areas.filter(looksOutdoor);
  const snap = (v: number) => Math.round(v * 20) / 20;
  const rooms: RoomInput[] = [];
  if (indoor.length) {
    const cols = Math.max(1, Math.round(Math.sqrt((indoor.length * w) / d)));
    const rows = Math.ceil(indoor.length / cols);
    indoor.forEach((a, i) => {
      const row = Math.floor(i / cols);
      // the last row shares the full width between what is left
      const inRow = row === rows - 1 ? indoor.length - row * cols : cols;
      const col = i - row * cols;
      const xa = snap(x0 + (w * col) / inRow);
      const xb = snap(x0 + (w * (col + 1)) / inRow);
      const ya = snap(y0 + (d * row) / rows);
      const yb = snap(y0 + (d * (row + 1)) / rows);
      rooms.push(make(a, [xa, ya, round(xb - xa), round(yb - ya)]));
    });
  }
  outdoor.forEach((a, i) => {
    const xa = snap(x0 + (w * i) / outdoor.length);
    const xb = snap(x0 + (w * (i + 1)) / outdoor.length);
    rooms.push(make(a, [xa, round(y0 + d), round(xb - xa), 3], { kind: "outdoor" }));
  });
  return rooms;
}

export interface LevelSeed {
  floor_id?: string;
  name?: string;
  areas: AreaSeed[];
}

/** A new house: one level per seed (bottom to top), each with placeholder rooms for its areas. */
export function newHouse(id: string, name: string, size: [number, number], levels: LevelSeed[]): HouseInput {
  const [w, d] = size.map(round);
  const ids: string[] = [];
  return {
    schema: 1,
    id,
    name,
    outline: { rect: [0, 0, w, d] },
    levels: (levels.length ? levels : [{ name: "Ground floor", areas: [] }]).map((seed) => {
      const lid = uniqueId(ids, slug(seed.floor_id ?? seed.name ?? "level", "level"));
      ids.push(lid);
      const l: LevelInput = { id: lid, rooms: layoutRooms([0, 0, w, d], seed.areas) };
      if (seed.floor_id) l.floor_id = seed.floor_id;
      else if (seed.name) l.name = seed.name;
      return l;
    }),
  };
}

/**
 * Adds a level at `index` (0 = bottom). It uses the house outline; placeholder rooms are
 * laid out for `seed.areas` inside the outline's bounding box.
 */
export function addLevel(model: HouseInput, index: number, seed: LevelSeed): { model: HouseInput; id: string } {
  const m = clone(model);
  const id = uniqueId(
    m.levels.map((l) => l.id),
    slug(seed.floor_id ?? seed.name ?? "level", "level"),
  );
  const poly = shapePolygon(m, m.outline);
  const { min, max } = poly.length ? bbox(poly) : { min: [0, 0] as Vec2, max: [10, 8] as Vec2 };
  const l: LevelInput = { id, rooms: layoutRooms([min[0], min[1], round(max[0] - min[0]), round(max[1] - min[1])], seed.areas) };
  if (seed.floor_id) l.floor_id = seed.floor_id;
  else if (seed.name) l.name = seed.name;
  m.levels.splice(Math.max(0, Math.min(m.levels.length, index)), 0, l);
  return { model: m, id };
}

/**
 * Removes a level and everything that refers to it: its rows in stacked façade openings
 * and stairs or shafts that start or end there.
 */
export function deleteLevel(model: HouseInput, levelId: string): HouseInput {
  const m = clone(model);
  if (m.levels.length <= 1) return m;
  m.levels = m.levels.filter((l) => l.id !== levelId);
  if (m.facade_openings) {
    m.facade_openings = m.facade_openings
      .map((o) => {
        const next = { ...o, levels: o.levels.filter((l) => l !== levelId) };
        for (const key of ["covers", "contacts"] as const) {
          if (!next[key]) continue;
          const map = { ...next[key] };
          delete map[levelId];
          if (Object.keys(map).length) next[key] = map;
          else delete next[key];
        }
        return next;
      })
      .filter((o) => o.levels.length);
    if (!m.facade_openings.length) delete m.facade_openings;
  }
  if (m.vertical) {
    m.vertical = m.vertical.filter((v) => v.from !== levelId && v.to !== levelId);
    if (!m.vertical.length) delete m.vertical;
  }
  return m;
}

/** Changes level properties; empty values are dropped (defaults apply). Renaming the id updates references. */
export function updateLevel(model: HouseInput, levelId: string, patch: Partial<Omit<LevelInput, "rooms">>): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  Object.assign(l, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined || v === "") delete (l as unknown as Record<string, unknown>)[k];
  const id = patch.id;
  if (id && id !== levelId) {
    for (const o of m.facade_openings ?? []) {
      o.levels = o.levels.map((x) => (x === levelId ? id : x));
      for (const key of ["covers", "contacts"] as const) {
        const map = o[key];
        if (map && levelId in map) {
          map[id] = map[levelId];
          delete map[levelId];
        }
      }
    }
    for (const v of m.vertical ?? []) {
      if (v.from === levelId) v.from = id;
      if (v.to === levelId) v.to = id;
    }
  }
  return m;
}

// ----- stairs and shafts -----

/**
 * A new stair from `from` to `to` in `rect`: it climbs along the longer side; a nearly
 * square stairwell gets a u_turn stair.
 */
export function addStairs(model: HouseInput, rect: [number, number, number, number], from: string, to: string): { model: HouseInput; id: string } {
  const m = clone(model);
  const [x, y, w, d] = rect.map(round) as [number, number, number, number];
  const id = uniqueId((m.vertical ?? []).map((v) => v.id), "stairs");
  const long = Math.max(w, d) / Math.max(0.01, Math.min(w, d));
  const v: VerticalInput = { id, kind: "stairs", rect: [x, y, w, d], from, to, up: w >= d ? "east" : "south" };
  if (long < 1.8) {
    v.shape = "u_turn";
    v.start = w >= d ? "south" : "west";
  }
  m.vertical = [...(m.vertical ?? []), v];
  return { model: m, id };
}

export function updateStairs(model: HouseInput, id: string, patch: Partial<VerticalInput>): HouseInput {
  const m = clone(model);
  m.vertical = (m.vertical ?? []).map((v) => {
    if (v.id !== id) return v;
    const next = { ...v, ...patch };
    for (const [k, val] of Object.entries(patch)) if (val === undefined || val === "" || (k === "entry" && val === 0)) delete (next as Record<string, unknown>)[k];
    // a turn needs a start side across the climb
    const across: Side[] = next.up === "north" || next.up === "south" ? ["east", "west"] : ["north", "south"];
    if (next.shape === "u_turn" && (!next.start || !across.includes(next.start))) next.start = across[1];
    if (next.shape !== "u_turn" && next.start && !across.includes(next.start)) delete next.start;
    return next;
  });
  return m;
}

export function deleteStairs(model: HouseInput, id: string): HouseInput {
  const m = clone(model);
  m.vertical = (m.vertical ?? []).filter((v) => v.id !== id);
  if (!m.vertical.length) delete m.vertical;
  return m;
}

/** The stairwell's rectangle (x, y, width, depth); polygons are reduced to their bounds. */
export function stairsRect(model: HouseInput, v: VerticalInput): [number, number, number, number] {
  const poly = shapePolygon(model, v);
  const { min, max } = bbox(poly);
  return [round(min[0]), round(min[1]), round(max[0] - min[0]), round(max[1] - min[1])];
}

export function setStairsRect(model: HouseInput, id: string, rect: [number, number, number, number]): HouseInput {
  const m = clone(model);
  m.vertical = (m.vertical ?? []).map((v) => {
    if (v.id !== id) return v;
    const next = { ...v, rect: rect.map(round) as [number, number, number, number] };
    delete next.polygon;
    return next;
  });
  return m;
}

// ----- lights -----

/**
 * Puts a light into a room (taking it out of any other room on the level) at `at`,
 * metres from the room's north-west corner; `at` undefined places it automatically.
 */
export function placeLight(model: HouseInput, levelId: string, roomId: string, entity: string, at?: [number, number]): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  for (const r of l.rooms) {
    if (r.id === roomId || !r.lights) continue;
    r.lights = r.lights.filter((x) => x.entity !== entity);
    if (!r.lights.length) delete r.lights;
  }
  const room = l.rooms.find((r) => r.id === roomId);
  if (!room) return m;
  const entry = room.lights?.find((x) => x.entity === entity) ?? { entity };
  if (at) entry.at = [round(at[0]), round(at[1])];
  else delete entry.at;
  room.lights = [...(room.lights ?? []).filter((x) => x.entity !== entity), entry];
  return m;
}

/** Shows or hides a light in a room's list (hiding an area light needs an entry). */
export function setLightHidden(model: HouseInput, levelId: string, roomId: string, entity: string, hidden: boolean): HouseInput {
  const m = clone(model);
  const room = level(m, levelId).rooms.find((r) => r.id === roomId);
  if (!room) return m;
  const entry = room.lights?.find((x) => x.entity === entity) ?? { entity };
  if (hidden) entry.hidden = true;
  else delete entry.hidden;
  room.lights = [...(room.lights ?? []).filter((x) => x.entity !== entity), entry];
  return m;
}

/**
 * Drops a light's entry from a room. Lights of the room's area then go back to
 * automatic placement; lights from elsewhere leave the room.
 */
export function removeLight(model: HouseInput, levelId: string, roomId: string, entity: string): HouseInput {
  const m = clone(model);
  const room = level(m, levelId).rooms.find((r) => r.id === roomId);
  if (!room?.lights) return m;
  room.lights = room.lights.filter((x) => x.entity !== entity);
  if (!room.lights.length) delete room.lights;
  return m;
}

// ----- roof -----

/** Sets roof properties (creating the roof); `null` removes it. */
export function setRoof(model: HouseInput, roof: Partial<RoofInput> | null): HouseInput {
  const m = clone(model);
  if (roof === null) delete m.roof;
  else {
    const next = { ...(m.roof ?? {}), ...roof };
    for (const [k, v] of Object.entries(roof)) if (v === undefined) delete (next as Record<string, unknown>)[k];
    m.roof = next;
  }
  return m;
}

// ----- energy -----

export function addEnergy(model: HouseInput, item: EnergyInput): { model: HouseInput; index: number } {
  const m = clone(model);
  m.energy = [...(m.energy ?? []), item];
  return { model: m, index: m.energy.length - 1 };
}

export function updateEnergy(model: HouseInput, index: number, patch: Partial<EnergyInput>): HouseInput {
  const m = clone(model);
  const e = m.energy?.[index];
  if (!e) return m;
  Object.assign(e, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined || v === "") delete (e as unknown as Record<string, unknown>)[k];
  if (e.at) e.at = [round(e.at[0]), round(e.at[1])];
  return m;
}

export function deleteEnergy(model: HouseInput, index: number): HouseInput {
  const m = clone(model);
  m.energy = (m.energy ?? []).filter((_, i) => i !== index);
  if (!m.energy.length) delete m.energy;
  return m;
}

/**
 * Replaces a level's rooms with copies of another level's (shapes, kinds and wall
 * entries; no area links, lights or openings): a quick start for a floor whose walls
 * mostly stack on the one below.
 */
export function copyRooms(model: HouseInput, fromLevel: string, toLevel: string): HouseInput {
  const m = clone(model);
  const src = level(m, fromLevel);
  const dst = level(m, toLevel);
  dst.rooms = src.rooms
    .filter((r) => (r.kind ?? "room") !== "outdoor")
    .map((r) => {
      const copy: RoomInput = { ...clone(r) };
      delete copy.area_id;
      delete copy.lights;
      delete copy.awning;
      delete copy.name;
      return copy;
    });
  const ids = new Set(dst.rooms.map((r) => r.id));
  dst.walls = (src.walls ?? []).filter((w) => !w.between || w.between.every((id) => ids.has(id))).map((w) => clone(w));
  if (!dst.walls.length) delete dst.walls;
  dst.openings = (dst.openings ?? []).filter((o) => ids.has(o.room));
  if (!dst.openings.length) delete dst.openings;
  return m;
}
