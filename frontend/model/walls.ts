// Walls are derived from room polygons and the level outline, never drawn:
// 1. snap vertices that are closer than SNAP to one point,
// 2. split every edge at vertices lying on it (T-junctions),
// 3. classify the resulting pieces (on the outline → exterior/party, otherwise interior),
// 4. merge collinear neighbours with the same classification,
// 5. place openings on the walls by position, not by index.

import {
  add,
  bbox,
  dist,
  len,
  edges,
  outwardNormal,
  project,
  scale,
  sideOf,
  sub,
} from "./geometry";
import type { Issue, Level, Opening, OpeningSource, OpeningStyle, OpeningType, Side, Vec2, WallThickness, WallType } from "./types";

export const SNAP = 0.05;

/** The side of a (positively oriented) room polygon that the segment p–q lies on. */
export function sideOfRoom(polygon: Vec2[], p: Vec2, q: Vec2): Side | null {
  const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const edge = edges(polygon).find(([a, b]) => {
    const pr = project(mid, a, b);
    return pr.distance < SNAP && pr.t > 0 && pr.t < pr.length;
  });
  return edge ? sideOf(outwardNormal(...edge)) : null;
}

export interface WallOpening {
  id: string;
  source: OpeningSource;
  room: string;
  type: OpeningType;
  style: OpeningStyle;
  hinge: "left" | "right";
  swing: "in" | "out";
  /** Metres from the wall's start (`line[0]`). */
  start: number;
  end: number;
  sill: number;
  height: number;
  cover?: string;
  contact?: string;
}

export interface Wall {
  id: string;
  type: WallType;
  /** Reference line the wall was derived from (outline or shared room edge). */
  line: [Vec2, Vec2];
  /** Centre line; exterior and party walls grow inwards from the outline. */
  a: Vec2;
  b: Vec2;
  /** Unit normal; for exterior/party walls it points outside. */
  normal: Vec2;
  /** Compass side for exterior/party walls. */
  side: Side | null;
  thickness: number;
  height: number;
  rooms: string[];
  openings: WallOpening[];
  /**
   * How far the wall body reaches past its start/end, so corners are filled: inner
   * corners of the outline and L-corners between inside walls.
   */
  extendStart: number;
  extendEnd: number;
}

interface Piece {
  a: Vec2;
  b: Vec2;
  rooms: Set<string>;
  /** Direction along the (positively oriented) outline, when the piece lies on it. */
  outline: [Vec2, Vec2] | null;
}

const fmt = (p: Vec2) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
const pieceKey = (p: Vec2, q: Vec2) => [fmt(p), fmt(q)].sort().join("|");
const roomsKey = (s: Set<string>) => [...s].sort().join(",");

export function deriveWalls(level: Level, thickness: WallThickness, issues: Issue[] = []): Wall[] {
  const path = `levels.${level.id}`;

  // 1. snapping: the outline first, so its corners win
  const points: Vec2[] = [];
  const snap = (p: Vec2): Vec2 => points.find((c) => dist(c, p) < SNAP) ?? (points.push(p), p);
  const sources: { poly: Vec2[]; room: string | null }[] = [];
  if (level.outline.length) sources.push({ poly: level.outline.map(snap), room: null });
  for (const r of level.rooms) if (r.kind === "room") sources.push({ poly: r.polygon.map(snap), room: r.id });

  // 2. split at T-junctions
  const pieces = new Map<string, Piece>();
  for (const { poly, room } of sources) {
    for (const [a, b] of edges(poly)) {
      const length = dist(a, b);
      if (length < SNAP) continue;
      const cuts: { t: number; p: Vec2 }[] = [
        { t: 0, p: a },
        { t: length, p: b },
      ];
      for (const p of points) {
        if (p === a || p === b) continue;
        const pr = project(p, a, b);
        if (pr.distance < SNAP && pr.t > SNAP && pr.t < length - SNAP) cuts.push({ t: pr.t, p });
      }
      cuts.sort((x, y) => x.t - y.t);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const p = cuts[i].p;
        const q = cuts[i + 1].p;
        const key = pieceKey(p, q);
        let piece = pieces.get(key);
        if (!piece) pieces.set(key, (piece = { a: p, b: q, rooms: new Set(), outline: null }));
        if (room === null) piece.outline = [p, q];
        else piece.rooms.add(room);
      }
    }
  }

  // 3. classify
  const partyWalls = new Set(level.partyWalls);
  // the side of `room` a piece lies on (from the room's edge containing it)
  const sideFrom = (roomId: string, p: Vec2, q: Vec2): Side | null => {
    const room = level.rooms.find((r) => r.id === roomId);
    return room ? sideOfRoom(room.polygon, p, q) : null;
  };
  const matches = (piece: Piece, o: { between: [string, string]; side?: Side }) =>
    piece.rooms.size === 2 && o.between.every((r) => piece.rooms.has(r)) && (!o.side || sideFrom(o.between[0], piece.a, piece.b) === o.side);
  const isOpen = (piece: Piece) => level.openBoundaries.some((o) => matches(piece, o));
  // the last entry wins, like in the file
  const ownThickness = (piece: Piece) => [...(level.thickBoundaries ?? [])].reverse().find((o) => matches(piece, o))?.thickness;
  const typeOf = (piece: Piece): WallType => {
    if (!piece.outline) return isOpen(piece) ? "open" : "interior";
    const side = sideOf(outwardNormal(...piece.outline));
    return side && partyWalls.has(side) ? "party" : "exterior";
  };

  // 4. merge collinear neighbours with the same type and the same rooms on them
  type Seg = { a: Vec2; b: Vec2; type: WallType; rooms: Set<string>; directed: boolean; own?: number };
  const segs: Seg[] = [...pieces.values()].map((p) => {
    const [a, b] = p.outline ?? [p.a, p.b];
    const type = typeOf(p);
    return { a, b, type, rooms: p.rooms, directed: !!p.outline, own: type === "interior" ? ownThickness(p) : undefined };
  });
  const collinear = (s: Seg, t: Seg) => project(t.a, s.a, s.b).distance < 1e-4 && project(t.b, s.a, s.b).distance < 1e-4;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < segs.length; i++) {
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const s = segs[i];
        const t = segs[j];
        if (s.type !== t.type || s.own !== t.own || roomsKey(s.rooms) !== roomsKey(t.rooms) || !collinear(s, t)) continue;
        // s.b → t.a continues s; undirected interior pieces may need flipping
        let next: Seg | null = null;
        if (s.b === t.a) next = t;
        else if (!s.directed && !t.directed && s.b === t.b) next = { ...t, a: t.b, b: t.a };
        if (!next) continue;
        segs[i] = { ...s, b: next.b };
        segs.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }

  // build walls
  const walls: Wall[] = segs.map((s, i) => {
    const t = s.type === "open" ? 0 : (s.own ?? thickness[s.type]);
    const normal = outwardNormal(s.a, s.b);
    const shift = s.type === "interior" || s.type === "open" ? [0, 0] as Vec2 : scale(normal, -t / 2);
    return {
      id: `${level.id}_${s.type}_${i}`,
      type: s.type,
      line: [s.a, s.b],
      a: add(s.a, shift),
      b: add(s.b, shift),
      normal,
      side: s.type === "interior" || s.type === "open" ? null : sideOf(normal),
      thickness: t,
      height: level.height,
      rooms: [...s.rooms].sort(),
      openings: [],
      extendStart: 0,
      extendEnd: 0,
    };
  });
  fillCorners(walls, level.outline);

  // free-standing walls (not on a room boundary)
  level.freeWalls.forEach((f, i) => {
    walls.push({
      id: `${level.id}_free_${i}`,
      type: "interior",
      line: [f.a, f.b],
      a: f.a,
      b: f.b,
      normal: outwardNormal(f.a, f.b),
      side: null,
      thickness: f.thickness ?? thickness.interior,
      height: level.height,
      rooms: [],
      openings: [],
      extendStart: 0,
      extendEnd: 0,
    });
  });

  // rooms reaching outside the outline are almost always a typo
  if (level.outline.length) {
    const ob = bbox(level.outline);
    for (const r of level.rooms) {
      if (r.kind !== "room") continue;
      const rb = bbox(r.polygon);
      if (rb.min[0] < ob.min[0] - SNAP || rb.min[1] < ob.min[1] - SNAP || rb.max[0] > ob.max[0] + SNAP || rb.max[1] > ob.max[1] + SNAP) {
        issues.push({ severity: "warning", path: `${path}.rooms.${r.id}`, message: "Room reaches outside the level outline." });
      }
    }
  }

  // 5. openings
  for (const o of level.openings) placeOpening(o, level, walls, issues, `${path}.openings.${o.id}`);
  return walls;
}

/**
 * Fills corners: at an inner (reflex) corner of the outline the two outer walls stop
 * short of each other, and two inside walls meeting at an angle leave the outer quarter
 * of the corner empty. Extend those wall ends by the thickness of the wall they meet.
 */
function fillCorners(walls: Wall[], outline: Vec2[]) {
  const same = (p: Vec2, q: Vec2) => dist(p, q) < SNAP;
  const dir = (w: Wall): Vec2 => {
    const l = dist(w.line[0], w.line[1]) || 1;
    return [(w.line[1][0] - w.line[0][0]) / l, (w.line[1][1] - w.line[0][1]) / l];
  };
  const collinear = (u: Vec2, v: Vec2) => Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-3;
  // reflex corners of the (positively oriented) outline
  const reflex = outline.filter((p, i) => {
    const prev = outline[(i - 1 + outline.length) % outline.length];
    const next = outline[(i + 1) % outline.length];
    return (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]) < -1e-9;
  });
  for (const w of walls) {
    if (w.type === "open") continue;
    w.line.forEach((end, i) => {
      let extend = 0;
      if (w.type === "exterior" || w.type === "party") {
        // reach the inside face of the outer wall met at the inner corner
        if (reflex.some((p) => same(p, end)))
          for (const o of walls) {
            if (o === w || (o.type !== "exterior" && o.type !== "party") || collinear(dir(w), dir(o))) continue;
            if (same(o.line[0], end) || same(o.line[1], end)) extend = Math.max(extend, o.thickness);
          }
      } else {
        for (const o of walls) {
          if (o === w || o.type !== "interior" || collinear(dir(w), dir(o))) continue;
          if (same(o.line[0], end) || same(o.line[1], end)) extend = Math.max(extend, o.thickness / 2);
        }
      }
      if (i === 0) w.extendStart = extend;
      else w.extendEnd = extend;
    });
  }
}

/**
 * A room's floor as it really is: each edge pulled inwards to the inside face of the wall
 * on it (a full outer wall, half an inside wall, nothing where the room is open). An edge
 * running along walls of different thickness is split, giving the outline a small step.
 */
export function innerPolygon(polygon: Vec2[], walls: Wall[]): Vec2[] {
  // offset pieces of every edge, in order around the room
  const pieces: [Vec2, Vec2][] = [];
  for (const [a, b] of edges(polygon)) {
    const length = dist(a, b);
    if (length < 1e-9) continue;
    const u = scale(sub(b, a), 1 / length);
    const inward = scale(outwardNormal(a, b), -1);
    // the walls lying along this edge, as ranges along it
    const ranges: { t0: number; t1: number; inset: number }[] = [];
    for (const w of walls) {
      if (w.type === "open") continue;
      const p0 = project(w.line[0], a, b);
      const p1 = project(w.line[1], a, b);
      if (p0.distance > SNAP || p1.distance > SNAP) continue;
      const t0 = Math.max(0, Math.min(p0.t, p1.t));
      const t1 = Math.min(length, Math.max(p0.t, p1.t));
      if (t1 - t0 < 1e-6) continue;
      ranges.push({ t0, t1, inset: w.type === "interior" ? w.thickness / 2 : w.thickness });
    }
    ranges.sort((x, y) => x.t0 - y.t0);
    // fill the stretches without a wall (open) with no inset, merge equal neighbours
    const parts: { t0: number; t1: number; inset: number }[] = [];
    let t = 0;
    for (const r of ranges) {
      if (r.t0 > t + 1e-6) parts.push({ t0: t, t1: r.t0, inset: 0 });
      const start = Math.max(t, r.t0);
      if (r.t1 > start + 1e-6) parts.push({ t0: start, t1: r.t1, inset: r.inset });
      t = Math.max(t, r.t1);
    }
    if (t < length - 1e-6) parts.push({ t0: t, t1: length, inset: 0 });
    const merged = parts.reduce<typeof parts>((acc, p) => {
      const last = acc[acc.length - 1];
      if (last && Math.abs(last.inset - p.inset) < 1e-9) last.t1 = p.t1;
      else acc.push({ ...p });
      return acc;
    }, []);
    for (const p of merged) {
      const off = scale(inward, p.inset);
      pieces.push([add(add(a, scale(u, p.t0)), off), add(add(a, scale(u, p.t1)), off)]);
    }
  }
  // corners: neighbouring pieces meet where their lines cross; parallel pieces (a step
  // within one edge) are joined by a short connecting edge
  const out: Vec2[] = [];
  pieces.forEach((cur, i) => {
    const prev = pieces[(i - 1 + pieces.length) % pieces.length];
    const d1 = sub(prev[1], prev[0]);
    const d2 = sub(cur[1], cur[0]);
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9 * (len(d1) * len(d2) || 1)) {
      if (dist(prev[1], cur[0]) > 1e-6) out.push(prev[1]);
      out.push(cur[0]);
      return;
    }
    const t = ((cur[0][0] - prev[0][0]) * d2[1] - (cur[0][1] - prev[0][1]) * d2[0]) / den;
    out.push(add(prev[0], scale(d1, t)));
  });
  return out;
}

function placeOpening(o: Opening, level: Level, walls: Wall[], issues: Issue[], path: string) {
  const warn = (message: string) => issues.push({ severity: "warning", path, message });
  const room = level.rooms.find((r) => r.id === o.room);
  if (!room) return;
  const along = o.side === "north" || o.side === "south" ? 0 : 1;
  const origin = bbox(room.polygon).min[along];
  const from = origin + o.at;
  const to = from + o.width;
  const mid = (from + to) / 2;

  const edge = edges(room.polygon).find(([a, b]) => {
    if (sideOf(outwardNormal(a, b)) !== o.side) return false;
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    return mid > lo - SNAP && mid < hi + SNAP;
  });
  if (!edge) return warn(`Room "${o.room}" has no ${o.side} side at ${o.at} m.`);

  const onEdge = (v: number): Vec2 => {
    const [a, b] = edge;
    const k = (v - a[along]) / (b[along] - a[along]);
    return add(a, scale(sub(b, a), k));
  };
  const p = onEdge(from);
  const q = onEdge(to);
  const m = onEdge(mid);

  const wall = walls.find((w) => {
    if (w.type === "open") return false;
    const pr = project(m, w.line[0], w.line[1]);
    return pr.distance < SNAP && pr.t > 0 && pr.t < pr.length;
  });
  if (!wall) return warn(`No wall found for opening on the ${o.side} side of "${o.room}".`);

  const length = dist(wall.line[0], wall.line[1]);
  let start = project(p, wall.line[0], wall.line[1]).t;
  let end = project(q, wall.line[0], wall.line[1]).t;
  if (start > end) [start, end] = [end, start];
  if (start < 0 || end > length) {
    warn(`Opening runs past the end of its wall; shortened to fit.`);
    start = Math.max(0, start);
    end = Math.min(length, end);
  }
  let height = o.height;
  if (o.sill + height > wall.height - 0.05) {
    height = Math.max(0.1, wall.height - 0.05 - o.sill);
    warn(`Opening is taller than the level; height reduced to ${height.toFixed(2)} m.`);
  }
  const overlap = wall.openings.find((x) => start < x.end && end > x.start);
  if (overlap) warn(`Overlaps opening "${overlap.id}".`);
  wall.openings.push({ id: o.id, source: o.source, room: o.room, type: o.type, style: o.style, hinge: o.hinge, swing: o.swing, start, end, sill: o.sill, height, cover: o.cover, contact: o.contact });
  wall.openings.sort((x, y) => x.start - y.start);
}
