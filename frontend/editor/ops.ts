// Pure editing operations on the input (short-form) model. They never mutate their input:
// each returns a new model, which keeps undo/redo trivial and makes them easy to test.

import { bbox, dist, normalizeOrientation, project, signedArea } from "../model/geometry";
import { expandHouse } from "../model/expand";
import type {
  RoofPartInput, CameraInput, Coord, EnergyInput, FacadeOpeningInput, FurnitureInput, HouseInput, LevelInput, LightType, OpeningInput, OpeningSource, OpeningType, RoomInput, ShapeInput, RobotInput, RoofInput, Side, Vec2, VerticalInput, WallInput, WallThickness } from "../model/types";

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
 * Makes side `i` of a polygon (wall centre lines) `delta` metres longer by moving the
 * wall at its east or south end, like dragging it: neighbouring rooms follow.
 */
export function resizeSide(model: HouseInput, levelId: string, poly: Vec2[], i: number, delta: number): HouseInput {
  const n = poly.length;
  const p = poly[i];
  const q = poly[(i + 1) % n];
  const length = dist(p, q) || 1;
  const u: Vec2 = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
  if (u[0] + u[1] >= 0) return moveEdge(model, levelId, q, poly[(i + 2) % n], [u[0] * delta, u[1] * delta]);
  return moveEdge(model, levelId, poly[(i - 1 + n) % n], p, [-u[0] * delta, -u[1] * delta]);
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
  // entries that open this pair are rewritten; walls with their own thickness stay
  const others = (l.walls ?? []).filter((w) => !(w.between && w.between.includes(a) && w.between.includes(b) && (w.type ?? "open") === "open"));
  const mine = sides.size === allSides.length ? [{ between: [a, b] as [string, string] }] : [...sides].map((s) => ({ between: [a, b] as [string, string], side: s }));
  l.walls = [...others, ...mine];
  if (!l.walls.length) delete l.walls;
  return m;
}

/** The own thickness of one side (seen from `a`) of the wall between two rooms, if set. */
export function boundaryThickness(model: HouseInput, levelId: string, a: string, b: string, side: Side): number | undefined {
  let found: number | undefined;
  for (const w of level(model, levelId).walls ?? []) {
    if (!w.between || w.type !== "wall" || w.thickness === undefined) continue;
    const [x, y] = w.between;
    if (!((x === a && y === b) || (x === b && y === a))) continue;
    if (!w.side || (x === a ? w.side : OPPOSITE[w.side]) === side) found = w.thickness;
  }
  return found;
}

/** Gives one side (seen from `a`) of the wall between two rooms its own thickness; undefined: the house's. */
export function setBoundaryThickness(model: HouseInput, levelId: string, a: string, b: string, side: Side, thickness: number | undefined): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  const mine = (w: WallInput) => !!w.between && w.type === "wall" && w.between.includes(a) && w.between.includes(b) && (!w.side || (w.between[0] === a ? w.side : OPPOSITE[w.side]) === side);
  // an entry for all sides keeps applying to the others
  const whole = (l.walls ?? []).find((w) => mine(w) && !w.side);
  const rest = (l.walls ?? []).filter((w) => !mine(w));
  if (whole) for (const s of ["north", "south", "east", "west"] as Side[]) if (s !== side) rest.push({ ...whole, between: [a, b], side: s });
  if (thickness !== undefined) rest.push({ between: [a, b], side, type: "wall", thickness: round(thickness) });
  l.walls = rest;
  if (!l.walls.length) delete l.walls;
  return m;
}

/** Simple house-wide settings (undefined removes one). */
export function updateHouse(model: HouseInput, patch: Partial<Pick<HouseInput, "north" | "name">>): HouseInput {
  const m = clone(model);
  Object.assign(m, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (m as unknown as Record<string, unknown>)[k];
  return m;
}

/** Marks a cover as reporting its position the other way round (or not). */
export function setCoverInverted(model: HouseInput, cover: string, inverted: boolean): HouseInput {
  const m = clone(model);
  const list = (m.inverted_covers ?? []).filter((c) => c !== cover);
  if (inverted) list.push(cover);
  if (list.length) m.inverted_covers = list;
  else delete m.inverted_covers;
  return m;
}

/** House-wide wall thicknesses (metres); undefined: the default. */
export function setWallThickness(model: HouseInput, patch: Partial<WallThickness>): HouseInput {
  const m = clone(model);
  const next = { ...(m.walls ?? {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as Record<string, unknown>)[k];
  if (Object.keys(next).length) m.walls = next;
  else delete m.walls;
  return m;
}

/** Sides of the house shared with a neighbour (for the whole house, or one level). */
export function setPartyWalls(model: HouseInput, sides: Side[], levelId?: string): HouseInput {
  const m = clone(model);
  const target: { party_walls?: Side[] } = levelId ? level(m, levelId) : m;
  if (sides.length) target.party_walls = [...sides];
  else delete target.party_walls;
  return m;
}

/** Default sill and height for a type of opening; undefined fields go back to the built-in default. */
export function setOpeningDefaults(model: HouseInput, type: OpeningType, patch: { sill?: number; height?: number }): HouseInput {
  const m = clone(model);
  const all = { ...(m.opening_defaults ?? {}) };
  const next = { ...(all[type] ?? {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as Record<string, unknown>)[k];
  if (Object.keys(next).length) all[type] = next;
  else delete all[type];
  if (Object.keys(all).length) m.opening_defaults = all;
  else delete m.opening_defaults;
  return m;
}

/**
 * A wall piece's spot against the nearest wall of its room: its back on the wall's inside
 * face, turned to face into the room. `inner` is the room inside its walls.
 */
export function wallSnap(inner: Vec2[], p: Vec2, depth: number): { at: Vec2; rotation: number } | null {
  let best: { d: number; foot: Vec2; n: Vec2 } | null = null;
  inner.forEach((a, i) => {
    const b = inner[(i + 1) % inner.length];
    const len = dist(a, b);
    if (len < 0.2) return;
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const t = Math.max(0, Math.min(len, (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]));
    const foot: Vec2 = [a[0] + u[0] * t, a[1] + u[1] * t];
    const d = dist(foot, p);
    // the normal that points into the room
    let n: Vec2 = [-u[1], u[0]];
    const mid: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 0.01, (a[1] + b[1]) / 2 + n[1] * 0.01];
    if (!insidePolygon(mid, inner)) n = [u[1], -u[0]];
    if (!best || d < best.d) best = { d, foot, n };
  });
  if (!best) return null;
  const { foot, n } = best as { d: number; foot: Vec2; n: Vec2 };
  // rotation 0 has the back to the north; the back goes against the wall (-n)
  const rotation = ((Math.round((Math.atan2(-n[0], n[1]) * 180) / Math.PI) % 360) + 360) % 360;
  return { at: [round(foot[0] + (n[0] * depth) / 2), round(foot[1] + (n[1] * depth) / 2)], rotation };
}

/**
 * Mirrors a piece along the plan's x (left–right) or y (top–bottom) axis. Pieces only
 * know one mirror (left–right in their own frame): front–back is that plus a half turn.
 */
export function flipFurniture(f: FurnitureInput, axis: "x" | "y"): Partial<FurnitureInput> {
  const turned = (((f.rotation ?? 0) % 180) + 180) % 180 === 90;
  const own = (axis === "x") !== turned; // the flip is the piece's own left–right one
  return { mirror: f.mirror ? undefined : true, ...(own ? {} : { rotation: ((f.rotation ?? 0) + 180) % 360 }) };
}

/** A piece's footprint for snapping: its centre and half size along x and y. */
export interface Footprint {
  c: Vec2;
  half: Vec2;
}

/** Half sizes along x and y of a piece turned by a multiple of 90° (null otherwise). */
export function footprintHalf(size: [number, number], rotation: number): Vec2 | null {
  const r = ((rotation % 360) + 360) % 360;
  if (r % 90 !== 0) return null;
  return r % 180 === 0 ? [size[0] / 2, size[1] / 2] : [size[1] / 2, size[0] / 2];
}

/**
 * Snaps a dragged piece: its sides to wall faces (`walls`, axis-aligned segments) and
 * to other pieces (touching them or lined up with them), its centre to theirs and to
 * `centres` (e.g. the room's middle). Each axis snaps on its own, within `tol` metres.
 */
export function snapFurniture(
  piece: Footprint,
  walls: [Vec2, Vec2][],
  others: Footprint[],
  centres: Vec2[],
  tol: number,
): { c: Vec2; guide: { x?: number; y?: number } } {
  // the smallest move per axis wins
  const best: [{ d: number; at?: number }, { d: number; at?: number }] = [{ d: Infinity }, { d: Infinity }];
  const offer = (axis: 0 | 1, d: number, at: number) => {
    if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(best[axis].d)) best[axis] = { d, at };
  };
  const lo = (f: Footprint, axis: 0 | 1) => f.c[axis] - f.half[axis];
  const hi = (f: Footprint, axis: 0 | 1) => f.c[axis] + f.half[axis];
  const overlaps = (f: Footprint, a0: number, a1: number, axis: 0 | 1, margin = 0) => Math.min(hi(f, axis), a1) - Math.max(lo(f, axis), a0) > -margin;
  for (const [a, b] of walls) {
    // a wall along y (constant x) snaps x, if it runs beside the piece
    for (const axis of [0, 1] as const) {
      const other = (1 - axis) as 0 | 1;
      if (Math.abs(a[axis] - b[axis]) > 1e-6) continue;
      if (!overlaps(piece, Math.min(a[other], b[other]), Math.max(a[other], b[other]), other)) continue;
      const face = a[axis];
      offer(axis, face - lo(piece, axis), face);
      offer(axis, face - hi(piece, axis), face);
    }
  }
  for (const o of others) {
    for (const axis of [0, 1] as const) {
      const other = (1 - axis) as 0 | 1;
      // only pieces nearby in the other direction (a row of cabinets, a chair at a table)
      if (!overlaps(piece, lo(o, other), hi(o, other), other, 1)) continue;
      for (const [mine, edge] of [
        [lo(piece, axis), hi(o, axis)], // touching on one side
        [hi(piece, axis), lo(o, axis)], // …or the other
        [lo(piece, axis), lo(o, axis)], // lined up
        [hi(piece, axis), hi(o, axis)],
        [piece.c[axis], o.c[axis]], // centred
      ])
        offer(axis, edge - mine, edge);
    }
  }
  for (const c of centres) for (const axis of [0, 1] as const) offer(axis, c[axis] - piece.c[axis], c[axis]);
  const guide: { x?: number; y?: number } = {};
  if (best[0].at !== undefined) guide.x = best[0].at;
  if (best[1].at !== undefined) guide.y = best[1].at;
  return { c: [piece.c[0] + (best[0].at !== undefined ? best[0].d : 0), piece.c[1] + (best[1].at !== undefined ? best[1].d : 0)], guide };
}

function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ----- free-standing walls -----

/** Indexes of a level's free-standing walls in its `walls` list. */
export function freeWallIndexes(model: HouseInput, levelId: string): number[] {
  return (level(model, levelId).walls ?? []).flatMap((w, i) => (w.line && (w.type ?? "wall") === "wall" ? [i] : []));
}

export function addFreeWall(model: HouseInput, levelId: string, a: Vec2, b: Vec2): { model: HouseInput; index: number } {
  const m = clone(model);
  const l = level(m, levelId);
  l.walls = [...(l.walls ?? []), { line: [[round(a[0]), round(a[1])], [round(b[0]), round(b[1])]] }];
  return { model: m, index: l.walls.length - 1 };
}

export function updateFreeWall(model: HouseInput, levelId: string, index: number, patch: { line?: [Vec2, Vec2]; thickness?: number }): HouseInput {
  const m = clone(model);
  const w = level(m, levelId).walls?.[index];
  if (!w?.line) return m;
  if (patch.line) w.line = patch.line.map((p) => [round(p[0]), round(p[1])]) as [Vec2, Vec2];
  if ("thickness" in patch) {
    if (patch.thickness === undefined) delete w.thickness;
    else w.thickness = round(patch.thickness);
  }
  return m;
}

export function deleteFreeWall(model: HouseInput, levelId: string, index: number): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  l.walls = (l.walls ?? []).filter((_, i) => i !== index);
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

/**
 * Puts an outside door or window on these levels: a level's own opening becomes a
 * stacked façade opening (its position then counts from the house outline's corner);
 * a façade opening just changes its levels. Blinds and contacts stay per level.
 */
export function setOpeningLevels(model: HouseInput, levelId: string, src: OpeningSource, levels: string[]): { model: HouseInput; source: OpeningSource } {
  const m = clone(model);
  const order = (ids: string[]) => m.levels.map((l) => l.id).filter((id) => ids.includes(id) || id === levelId);
  if (src.kind === "facade") {
    const f = m.facade_openings?.[src.index];
    if (!f) return { model: m, source: src };
    f.levels = order(levels);
    for (const key of ["covers", "contacts"] as const) {
      const map = f[key];
      if (!map) continue;
      for (const id of Object.keys(map)) if (!f.levels.includes(id)) delete map[id];
      if (!Object.keys(map).length) delete f[key];
    }
    return { model: m, source: src };
  }
  const l = level(m, levelId);
  const o = l.openings?.[src.index];
  const room = o && l.rooms.find((r) => r.id === o.room);
  if (!o || !room) return { model: m, source: src };
  const along = o.side === "north" || o.side === "south" ? 0 : 1;
  const house = shapePolygon(m, m.outline);
  const base = bbox(house.length ? house : outlineScope(m, levelId).poly).min[along];
  const f: FacadeOpeningInput = {
    side: o.side,
    at: round(bbox(roomPolygon(m, room)).min[along] + o.at - base),
    width: o.width,
    levels: order(levels),
    ...(o.type ? { type: o.type } : {}),
    ...(o.sill !== undefined ? { sill: o.sill } : {}),
    ...(o.height !== undefined ? { height: o.height } : {}),
    ...(o.cover ? { covers: { [levelId]: o.cover } } : {}),
    ...(o.contact ? { contacts: { [levelId]: o.contact } } : {}),
  };
  l.openings = l.openings!.filter((_, i) => i !== src.index);
  if (!l.openings.length) delete l.openings;
  m.facade_openings = [...(m.facade_openings ?? []), f];
  return { model: m, source: { kind: "facade", index: m.facade_openings.length - 1 } };
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
  /** Corners the snapped point is joined to by a wall: it keeps that wall at 0°, 45°, 90°… */
  anchors?: Vec2[];
}

export interface Snapped {
  p: Vec2;
  /** What it snapped to, for the hint next to the cursor. */
  kind: "point" | "angle" | "align" | "grid" | "free";
  /** The corner snapped to (kind "point"). */
  target?: Vec2;
  /** Coordinates it lined up with (kind "align"), for guide lines. */
  alignX?: number;
  alignY?: number;
  /** Diagonal walls it snapped to (kind "angle"), from their corner to the point. */
  rays?: [Vec2, Vec2][];
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
  const angled = snapAngle(p, ctx, ax, ay, g);
  if (angled) return angled;
  if (ax !== null || ay !== null)
    return { p: [round(ax ?? g(p[0])), round(ay ?? g(p[1]))], kind: "align", ...(ax !== null ? { alignX: ax } : {}), ...(ay !== null ? { alignY: ay } : {}) };
  if (ctx.grid > 0) return { p: [round(g(p[0])), round(g(p[1]))], kind: "grid" };
  return { p, kind: "free" };
}

/**
 * Keeps the walls to `ctx.anchors` straight or at 45°: the point moves onto the nearest
 * such line through an anchor when it is close (onto the crossing of two of them, or of
 * one with an aligned coordinate; else along it on the grid).
 */
function snapAngle(p: Vec2, ctx: SnapContext, ax: number | null, ay: number | null, g: (v: number) => number): Snapped | null {
  const step = Math.PI / 4;
  const rays: { a: Vec2; u: Vec2 }[] = [];
  for (const a of ctx.anchors ?? []) {
    if (dist(p, a) < ctx.tolerance * 2) continue;
    const angle = Math.round(Math.atan2(p[1] - a[1], p[0] - a[0]) / step) * step;
    const u: Vec2 = [Math.round(Math.cos(angle) * 1e9) / 1e9, Math.round(Math.sin(angle) * 1e9) / 1e9];
    const t = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
    if (dist(p, [a[0] + u[0] * t, a[1] + u[1] * t]) < ctx.tolerance) rays.push({ a, u });
  }
  if (!rays.length) return null;
  const result = (q: Vec2, used: typeof rays): Snapped => {
    const r: Snapped = { p: [round(q[0]), round(q[1])], kind: "align" };
    for (const { a, u } of used) {
      if (u[0] === 0) r.alignX = a[0];
      else if (u[1] === 0) r.alignY = a[1];
      else (r.rays ??= []).push([a, r.p]), (r.kind = "angle");
    }
    if (ax !== null && r.p[0] === round(ax)) r.alignX ??= ax;
    if (ay !== null && r.p[1] === round(ay)) r.alignY ??= ay;
    return r;
  };
  // two walls: where they cross
  for (let i = 0; i < rays.length; i++)
    for (let j = i + 1; j < rays.length; j++) {
      const [r1, r2] = [rays[i], rays[j]];
      const den = r1.u[0] * r2.u[1] - r1.u[1] * r2.u[0];
      if (Math.abs(den) < 1e-9) continue;
      const t = ((r2.a[0] - r1.a[0]) * r2.u[1] - (r2.a[1] - r1.a[1]) * r2.u[0]) / den;
      const q: Vec2 = [r1.a[0] + r1.u[0] * t, r1.a[1] + r1.u[1] * t];
      if (dist(p, q) < ctx.tolerance * 1.5) return result(q, [r1, r2]);
    }
  const { a, u } = rays[0];
  // on the line: at an aligned coordinate, or else on the grid
  if (u[0] === 0) return result([a[0], ay ?? g(p[1])], [rays[0]]);
  if (u[1] === 0) return result([ax ?? g(p[0]), a[1]], [rays[0]]);
  const slope = u[1] / u[0];
  if (ax !== null) return result([ax, a[1] + (ax - a[0]) * slope], [rays[0]]);
  if (ay !== null) return result([a[0] + (ay - a[1]) / slope, ay], [rays[0]]);
  const x = a[0] + g(p[0] - a[0]);
  return result([x, a[1] + (x - a[0]) * slope], [rays[0]]);
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
  /** More HA floors on this level (their areas are in `areas` too). */
  include_floors?: string[];
  name?: string;
  areas: AreaSeed[];
}

/**
 * Which HA floors get their own level and which join another: floors that look like
 * outside (by name, or all their areas) join the ground floor (level 0, else the lowest
 * level at or above 0, else the lowest). `floors` are listed bottom to top.
 */
export function suggestMerges(floors: { floor_id: string; name: string; level?: number | null; areas: AreaSeed[] }[]): Record<string, string> {
  const outside = (f: (typeof floors)[number]) =>
    looksOutdoor({ area_id: f.floor_id, name: f.name }) || (f.areas.length > 0 && f.areas.every(looksOutdoor));
  const indoor = floors.filter((f) => !outside(f));
  const ground = indoor.find((f) => f.level === 0) ?? indoor.find((f) => (f.level ?? 0) >= 0) ?? indoor[0];
  const merges: Record<string, string> = {};
  if (!ground) return merges;
  for (const f of floors) if (f !== ground && outside(f)) merges[f.floor_id] = ground.floor_id;
  return merges;
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
      if (seed.include_floors?.length) l.include_floors = [...seed.include_floors];
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

/**
 * Changes how a light looks: its type (spots, strip, indirect…), and for spots and strips
 * their extra points. `at` (room-relative) pins a light that was placed automatically, as
 * spots and strips need one. Switching back to a lamp drops what only the others use.
 */
export function setLightShape(model: HouseInput, levelId: string, roomId: string, entity: string, shape: { type?: LightType; spots?: [number, number][]; to?: [number, number] | null; height?: number | null }, at?: [number, number]): HouseInput {
  const m = clone(model);
  const room = level(m, levelId).rooms.find((r) => r.id === roomId);
  if (!room) return m;
  const entry = room.lights?.find((x) => x.entity === entity) ?? { entity };
  if (!entry.at && at) entry.at = [round(at[0]), round(at[1])];
  if (shape.type !== undefined) {
    if (shape.type === "lamp") delete entry.type;
    else entry.type = shape.type;
    if (shape.type !== "spot") delete entry.spots;
    if (shape.type !== "strip") {
      delete entry.to;
      delete entry.height;
    }
    // a new strip runs 1.5 m east from where the light is
    if (shape.type === "strip" && !entry.to && entry.at) entry.to = [round(entry.at[0] + 1.5), entry.at[1]];
  }
  if (shape.spots !== undefined) {
    if (shape.spots.length) entry.spots = shape.spots.map(([x, y]) => [round(x), round(y)] as [number, number]);
    else delete entry.spots;
  }
  if (shape.to === null) delete entry.to;
  else if (shape.to) entry.to = [round(shape.to[0]), round(shape.to[1])];
  if (shape.height === null) delete entry.height;
  else if (shape.height !== undefined) entry.height = shape.height;
  room.lights = [...(room.lights ?? []).filter((x) => x.entity !== entity), entry];
  return m;
}

/** Adds a camera to a room at a room-relative point. */
export function addCamera(model: HouseInput, levelId: string, roomId: string, entity: string, at: [number, number]): HouseInput {
  const m = clone(model);
  const room = level(m, levelId).rooms.find((r) => r.id === roomId);
  if (!room) return m;
  room.cameras = [...(room.cameras ?? []), { entity, at: [round(at[0]), round(at[1])] }];
  return m;
}

/** Changes a camera (undefined drops a field back to its default). */
export function updateCamera(model: HouseInput, levelId: string, roomId: string, index: number, patch: Partial<CameraInput>): HouseInput {
  const m = clone(model);
  const c = level(m, levelId).rooms.find((r) => r.id === roomId)?.cameras?.[index];
  if (!c) return m;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (c as unknown as Record<string, unknown>)[k];
    else (c as unknown as Record<string, unknown>)[k] = k === "at" ? [round((v as number[])[0]), round((v as number[])[1])] : v;
  }
  return m;
}

export function removeCamera(model: HouseInput, levelId: string, roomId: string, index: number): HouseInput {
  const m = clone(model);
  const room = level(m, levelId).rooms.find((r) => r.id === roomId);
  if (!room?.cameras) return m;
  room.cameras = room.cameras.filter((_, i) => i !== index);
  if (!room.cameras.length) delete room.cameras;
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

/** Ready-made roofs: a preset fills a roof part's shape, ridge, pitch and covering. */
export const ROOF_PRESETS: Record<string, Partial<RoofPartInput>> = {
  gable_left_right: { shape: "gable", ridge: "left_right", pitch: 38 },
  gable_up_down: { shape: "gable", ridge: "up_down", pitch: 38 },
  tuscan: { shape: "hip", pitch: 22, finish: "roof_clay" },
  hip: { shape: "hip", pitch: 30 },
  shed: { shape: "shed", pitch: 10, finish: "roof_metal" },
  flat: { shape: "flat", finish: "roof_green" },
};

/**
 * Adds a roof level on top: one part over the top floor (from the house's roof, if it has
 * one, which it replaces).
 */
export function addRoofLevel(model: HouseInput, cover: [number, number, number, number], preset = "gable_left_right"): { model: HouseInput; id: string } {
  const m = clone(model);
  const old = m.roof;
  const part: RoofPartInput = {
    id: "main",
    rect: cover,
    ...ROOF_PRESETS[preset],
    ...(old?.shape ? { shape: old.shape } : {}),
    ...(old?.ridge ? { ridge: old.ridge === "north_south" ? "up_down" : "left_right" } : {}),
    ...(old?.pitch ? { pitch: old.pitch } : {}),
    ...(old?.overhang !== undefined ? { overhang: old.overhang } : {}),
    ...(old?.finish ? { finish: old.finish } : {}),
    ...(old?.high ? { high: old.high } : {}),
    ...(old?.dormers?.length ? { dormers: old.dormers } : {}),
    ...(old?.windows?.length ? { windows: old.windows } : {}),
  };
  delete m.roof;
  const ids = new Set(m.levels.map((l) => l.id));
  let id = "roof";
  for (let n = 2; ids.has(id); n++) id = `roof_${n}`;
  m.levels.push({ id, kind: "roof", name: "Roof", rooms: [], roofs: [part] });
  return { model: m, id };
}

/** Changes a roof part (`undefined` removes a field); a preset first, then the patch. */
export function updateRoofPart(model: HouseInput, levelId: string, index: number, patch: Partial<RoofPartInput>, preset?: string): HouseInput {
  const m = clone(model);
  const parts = level(m, levelId).roofs ?? [];
  const part = parts[index];
  if (!part) return m;
  const next: RoofPartInput = { ...part, ...(preset ? ROOF_PRESETS[preset] : {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
  // a preset sets its shape fresh: no high side or covering left from another
  if (preset) for (const k of ["high"] as const) if (!(k in ROOF_PRESETS[preset])) delete next[k];
  parts[index] = next;
  return m;
}

export function addRoofPart(model: HouseInput, levelId: string, rect: [number, number, number, number]): { model: HouseInput; index: number } {
  const m = clone(model);
  const l = level(m, levelId);
  const parts = (l.roofs ??= []);
  const ids = new Set(parts.map((p) => p.id));
  let id = `part_${parts.length + 1}`;
  for (let n = parts.length + 2; ids.has(id); n++) id = `part_${n}`;
  parts.push({ id, rect, shape: "gable", ridge: "left_right" });
  return { model: m, index: parts.length - 1 };
}

export function removeRoofPart(model: HouseInput, levelId: string, index: number): HouseInput {
  const m = clone(model);
  const l = level(m, levelId);
  l.roofs = (l.roofs ?? []).filter((_, i) => i !== index);
  return m;
}

/**
 * Solar panels on a roof part: `rows` × `columns` of `modern:solar_panel`, upright, in a
 * block centred on the slope facing `side` (pieces at part-relative positions).
 */
export function addSolarPanels(model: HouseInput, levelId: string, index: number, rows: number, columns: number, side: "near" | "far"): HouseInput {
  const m = clone(model);
  const part = level(m, levelId).roofs?.[index];
  if (!part?.rect) return m;
  const [, , w, d] = part.rect;
  const upDown = part.ridge === "up_down";
  // panels: 1.13 along the eave, 1.72 up the slope; their block centred on its slope
  const along = upDown ? d : w;
  const across = upDown ? w : d;
  const slopeMid = side === "far" ? across * 0.72 : across * 0.28;
  const pieces: FurnitureInput[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const a = along / 2 + (c - (columns - 1) / 2) * 1.15;
      const u = slopeMid + (r - (rows - 1) / 2) * 1.75 * (side === "far" ? -1 : 1);
      pieces.push({ type: "item", model: "modern:solar_panel", at: upDown ? [u, a] : [a, u], rotation: upDown ? 90 : 0 });
    }
  part.furniture = [...(part.furniture ?? []), ...pieces];
  return m;
}

// ----- energy -----

// ----- robots -----

export function addRobot(model: HouseInput, robot: RobotInput): { model: HouseInput; index: number } {
  const m = clone(model);
  m.robots = [...(m.robots ?? []), { ...robot, dock: [round(robot.dock[0]), round(robot.dock[1])] }];
  return { model: m, index: m.robots.length - 1 };
}

export function updateRobot(model: HouseInput, index: number, patch: Partial<RobotInput>): HouseInput {
  const m = clone(model);
  const r = m.robots?.[index];
  if (!r) return m;
  Object.assign(r, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined || v === "") delete (r as unknown as Record<string, unknown>)[k];
  r.dock = [round(r.dock[0]), round(r.dock[1])];
  return m;
}

export function deleteRobot(model: HouseInput, index: number): HouseInput {
  const m = clone(model);
  m.robots = (m.robots ?? []).filter((_, i) => i !== index);
  if (!m.robots.length) delete m.robots;
  return m;
}

/** Where the robot's live position comes from; null switches it off. */
export function setRobotPosition(model: HouseInput, index: number, position: { entity?: string; attribute?: string; service?: string } | null): HouseInput {
  const m = clone(model);
  const r = m.robots?.[index];
  if (!r) return m;
  if (!position) {
    delete r.position;
    return m;
  }
  // a different source makes the old calibration meaningless
  const same = (r.position?.entity ?? r.entity) === (position.entity ?? r.entity) && r.position?.attribute === position.attribute && r.position?.service === position.service;
  r.position = {
    ...(position.entity && position.entity !== r.entity ? { entity: position.entity } : {}),
    ...(position.service ? { service: position.service } : position.attribute ? { attribute: position.attribute } : {}),
    ...(same && r.position?.points ? { points: r.position.points } : {}),
  };
  return m;
}

/** Adds a calibration point: the robot's own reading there, and the spot on the plan. */
export function addRobotPoint(model: HouseInput, index: number, reading: Vec2, plan: Vec2): HouseInput {
  const m = clone(model);
  const r = m.robots?.[index];
  if (!r) return m;
  r.position ??= {};
  r.position.points = [...(r.position.points ?? []), [[reading[0], reading[1]], [round(plan[0]), round(plan[1])]]];
  return m;
}

export function clearRobotPoints(model: HouseInput, index: number): HouseInput {
  const m = clone(model);
  const p = m.robots?.[index]?.position;
  if (p) delete p.points;
  return m;
}

/** Every energy item's id (given, or the one the model derives from its name or kind). */
export function energyIds(model: HouseInput): string[] {
  const { house } = expandHouse(model);
  const ids = (model.energy ?? []).map((e) => e.id ?? "");
  for (const e of house?.energy ?? []) ids[e.index] = e.id;
  return ids;
}

/**
 * Connects an item's flow line to another item (by index), or back to the hub (null).
 * The target's id is written down, so renaming it later keeps the line.
 */
export function connectEnergy(model: HouseInput, from: number, to: number | null): HouseInput {
  const m = clone(model);
  const e = m.energy?.[from];
  if (!e || to === from) return m;
  if (to === null) {
    delete e.to;
    return m;
  }
  const target = m.energy?.[to];
  if (!target) return m;
  const ids = energyIds(model);
  target.id ??= ids[to];
  e.to = target.id;
  return m;
}

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
  const id = energyIds(model)[index];
  m.energy = (m.energy ?? []).filter((_, i) => i !== index);
  // lines to it go back to the hub
  for (const e of m.energy) if (e.to === id) delete e.to;
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

// ----- furniture -----

export function addFurniture(model: HouseInput, levelId: string, roomId: string, item: FurnitureInput): { model: HouseInput; index: number } {
  const m = clone(model);
  const room = level(m, levelId).rooms.find((r) => r.id === roomId);
  if (!room) return { model: m, index: -1 };
  room.furniture = [...(room.furniture ?? []), { ...item, at: [round(item.at[0]), round(item.at[1])] }];
  return { model: m, index: room.furniture.length - 1 };
}

export function updateFurniture(model: HouseInput, levelId: string, roomId: string, index: number, patch: Partial<FurnitureInput>): HouseInput {
  const m = clone(model);
  const f = level(m, levelId).rooms.find((r) => r.id === roomId)?.furniture?.[index];
  if (!f) return m;
  Object.assign(f, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined || (k === "rotation" && v === 0)) delete (f as unknown as Record<string, unknown>)[k];
  f.at = [round(f.at[0]), round(f.at[1])];
  if (f.rotation !== undefined) f.rotation = ((f.rotation % 360) + 360) % 360 || undefined;
  if (f.rotation === undefined) delete f.rotation;
  return m;
}

export function deleteFurniture(model: HouseInput, levelId: string, roomId: string, index: number): HouseInput {
  const m = clone(model);
  const room = level(m, levelId).rooms.find((r) => r.id === roomId);
  if (!room?.furniture) return m;
  room.furniture = room.furniture.filter((_, i) => i !== index);
  if (!room.furniture.length) delete room.furniture;
  return m;
}

/** Moves a piece to a plan position, into whichever room it now stands in. Returns its new place. */
export function moveFurniture(model: HouseInput, levelId: string, roomId: string, index: number, to: Vec2, toRoom: string): { model: HouseInput; room: string; index: number } {
  const src = level(model, levelId).rooms.find((r) => r.id === roomId);
  const piece = src?.furniture?.[index];
  const target = level(model, levelId).rooms.find((r) => r.id === toRoom);
  if (!piece || !target) return { model, room: roomId, index };
  const { min } = bbox(roomPolygon(model, target));
  const at: [number, number] = [to[0] - min[0], to[1] - min[1]];
  if (toRoom === roomId) return { model: updateFurniture(model, levelId, roomId, index, { at }), room: roomId, index };
  const removed = deleteFurniture(model, levelId, roomId, index);
  const added = addFurniture(removed, levelId, toRoom, { ...piece, at });
  return { model: added.model, room: toRoom, index: added.index };
}
