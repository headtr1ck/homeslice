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
  edgeNormal,
  edges,
  labelPoint,
  outwardNormal,
  project,
  scale,
  pointInPolygon,
  sideOf,
  sub,
} from "./geometry";
import type { Building, Issue, Level, Opening, OpeningSource, OpeningStyle, OpeningType, Side, Vec2, WallThickness, WallType } from "./types";

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
  split: number;
  /** Metres from the wall's start (`line[0]`). */
  start: number;
  end: number;
  sill: number;
  height: number;
  cover?: string;
  contact?: string;
  lock?: string;
  blind?: string;
  blindStyle?: "roller" | "venetian";
}

export interface Wall {
  id: string;
  type: WallType;
  /** Reference line the wall was derived from (outline or shared room edge). */
  line: [Vec2, Vec2];
  /** Centre line (the outline's edge, for exterior and party walls). */
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
  /** On a building standing on its own (never a party wall): its roof and walls. */
  annex?: Building;
  /** Direction along the (positively oriented) outline, when the piece lies on it. */
  outline: [Vec2, Vec2] | null;
}

const fmt = (p: Vec2) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
const pieceKey = (p: Vec2, q: Vec2) => [fmt(p), fmt(q)].sort().join("|");
const roomsKey = (s: Set<string>) => [...s].sort().join(",");
// a party wall may lean this much off its side (sin of about 10°)
const PARTY_SLANT = 0.17;

export function deriveWalls(level: Level, thickness: WallThickness, issues: Issue[] = []): Wall[] {
  const path = `levels.${level.id}`;

  // 1. snapping: the outline first, so its corners win
  const points: Vec2[] = [];
  const snap = (p: Vec2): Vec2 => points.find((c) => dist(c, p) < SNAP) ?? (points.push(p), p);
  const sources: { poly: Vec2[]; room: string | null; annex?: Building }[] = [];
  if (level.outline.length) sources.push({ poly: level.outline.map(snap), room: null });
  level.annexes.forEach((a, i) => sources.push({ poly: a.map(snap), room: null, annex: level.annexBuildings?.[i] ?? { roof: "shed", pitch: 8, open: false } }));
  for (const r of level.rooms) if (r.kind === "room") sources.push({ poly: r.polygon.map(snap), room: r.id });

  // 2. split at T-junctions
  const pieces = new Map<string, Piece>();
  for (const { poly, room, annex } of sources) {
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
        if (room === null) {
          piece.outline = [p, q];
          if (annex) piece.annex = annex;
        }
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
  // `along`: only a piece lying on that line (its middle on it, a few centimetres off at most)
  const onLine = (piece: Piece, [p, q]: [Vec2, Vec2]) => {
    const mid: Vec2 = [(piece.a[0] + piece.b[0]) / 2, (piece.a[1] + piece.b[1]) / 2];
    const pr = project(mid, p, q);
    return pr.distance < 0.05 && pr.t > -0.05 && pr.t < pr.length + 0.05;
  };
  const matches = (piece: Piece, o: { between: [string, string]; side?: Side; along?: [Vec2, Vec2] }) =>
    piece.rooms.size === 2 && o.between.every((r) => piece.rooms.has(r)) && (!o.side || sideFrom(o.between[0], piece.a, piece.b) === o.side) && (!o.along || onLine(piece, o.along));
  const isOpen = (piece: Piece) => level.openBoundaries.some((o) => matches(piece, o));
  // the last entry wins, like in the file
  const ownThickness = (piece: Piece) => [...(level.thickBoundaries ?? [])].reverse().find((o) => matches(piece, o))?.thickness;
  // outdoor rooms inside the outline (a roof terrace, a loggia): no outer wall along them
  const outdoorInside = level.rooms.filter((r) => r.kind === "outdoor");
  const typeOf = (piece: Piece): WallType => {
    if (!piece.outline) return isOpen(piece) ? "open" : "interior";
    // a carport: a roof on posts
    if (piece.annex?.open) return "open";
    if (!piece.rooms.size && outdoorInside.length) {
      const [a, b] = piece.outline;
      const n = outwardNormal(a, b);
      const inside: Vec2 = [(a[0] + b[0]) / 2 - n[0] * 0.05, (a[1] + b[1]) / 2 - n[1] * 0.05];
      if (outdoorInside.some((r) => pointInPolygon(inside, r.polygon))) return "open";
    }
    // a side a little off square (a corner dragged a few centimetres) is still that side
    const side = sideOf(outwardNormal(...piece.outline), PARTY_SLANT);
    return side && !piece.annex && partyWalls.has(side) ? "party" : "exterior";
  };

  // 4. merge collinear neighbours with the same type and the same rooms on them
  type Seg = { a: Vec2; b: Vec2; type: WallType; rooms: Set<string>; directed: boolean; own?: number };
  const segs: Seg[] = [...pieces.values()].map((p) => {
    const [a, b] = p.outline ?? [p.a, p.b];
    const type = typeOf(p);
    return { a, b, type, rooms: p.rooms, directed: !!p.outline, own: type === "interior" ? ownThickness(p) : type === "exterior" ? p.annex?.thickness : undefined };
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
    return {
      id: `${level.id}_${s.type}_${i}`,
      type: s.type,
      line: [s.a, s.b],
      a: s.a,
      b: s.b,
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
  // corners filled once every wall is there, drawn ones too
  fillCorners(walls);

  // rooms reaching outside the outline are almost always a typo
  if (level.outline.length) {
    const ob = bbox(level.outline);
    for (const r of level.rooms) {
      if (r.kind !== "room") continue;
      // (a building of its own: inside that)
      if (level.annexes.some((a) => pointInPolygon(labelPoint(r.polygon), a))) continue;
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
 * Fills corners: walls meeting at an angle each reach on by half the other's thickness, so
 * the corner is closed on both sides (an outside corner, an inner corner of the outline,
 * two inside walls meeting).
 */
function fillCorners(walls: Wall[]) {
  const same = (p: Vec2, q: Vec2) => dist(p, q) < SNAP;
  const dir = (w: Wall): Vec2 => {
    const l = dist(w.line[0], w.line[1]) || 1;
    return [(w.line[1][0] - w.line[0][0]) / l, (w.line[1][1] - w.line[0][1]) / l];
  };
  const collinear = (u: Vec2, v: Vec2) => Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-3;
  const outside = (w: Wall) => w.type === "exterior" || w.type === "party";
  for (const w of walls) {
    if (w.type === "open") continue;
    w.line.forEach((end, i) => {
      let extend = 0;
      for (const o of walls) {
        if (o === w || o.type === "open" || collinear(dir(w), dir(o))) continue;
        // an inside wall runs into an outside one, never the other way round
        if (outside(w) && !outside(o)) continue;
        if (same(o.line[0], end) || same(o.line[1], end)) extend = Math.max(extend, o.thickness / 2);
      }
      if (i === 0) w.extendStart = extend;
      else w.extendEnd = extend;
    });
  }
}

/** How far each edge's wall reaches out from an outline: half of it; nothing where it is open (along a roof terrace). */
export function facadeHalves(poly: Vec2[], partyWalls: Side[], thickness: WallThickness, open: (inside: Vec2) => boolean = () => false): number[] {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const n = edgeNormal(poly, i);
    const inside: Vec2 = [(a[0] + b[0]) / 2 - n[0] * 0.05, (a[1] + b[1]) / 2 - n[1] * 0.05];
    if (open(inside)) return 0;
    const side = sideOf(n, PARTY_SLANT);
    return (side && partyWalls.includes(side) ? thickness.party : thickness.exterior) / 2;
  });
}

/**
 * A room's floor as it really is: each edge pulled inwards to the inside face of the wall
 * on it (half the wall, nothing where the room is open). An edge
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
      ranges.push({ t0, t1, inset: w.thickness / 2 });
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
  const onEdge = ([a, b]: [Vec2, Vec2], v: number): Vec2 => add(a, scale(sub(b, a), (v - a[along]) / (b[along] - a[along])));
  if (edge) return placeOnWall(o, o.id, onEdge(edge, from), onEdge(edge, to), onEdge(edge, mid), walls, warn);

  // a curved side (an arc of short pieces facing roughly that way): a part on each piece it spans
  const facing: Record<Side, Vec2> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const pieces = edges(room.polygon).filter(([a, b]) => {
    const n = outwardNormal(a, b);
    const f = facing[o.side];
    if (n[0] * f[0] + n[1] * f[1] < 0.35 || Math.abs(b[along] - a[along]) < 1e-6) return false;
    return Math.max(a[along], b[along]) > from + 1e-6 && Math.min(a[along], b[along]) < to - 1e-6;
  });
  if (!pieces.length) return warn(`Room "${o.room}" has no ${o.side} side at ${o.at} m.`);
  pieces.forEach((e, k) => {
    const lo = Math.max(from, Math.min(e[0][along], e[1][along]));
    const hi = Math.min(to, Math.max(e[0][along], e[1][along]));
    placeOnWall(o, k ? `${o.id}~${k}` : o.id, onEdge(e, lo), onEdge(e, hi), onEdge(e, (lo + hi) / 2), walls, warn);
  });
}

/** Puts (a part of) an opening from p to q on the wall under its middle m. */
function placeOnWall(o: Opening, id: string, p: Vec2, q: Vec2, m: Vec2, walls: Wall[], warn: (message: string) => void) {
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
  // (a hair past the end is rounding: the parts of an opening along an arc end on the corners)
  if (start < -SNAP || end > length + SNAP) warn(`Opening runs past the end of its wall; shortened to fit.`);
  start = Math.max(0, start);
  end = Math.min(length, end);
  let height = o.height;
  if (o.sill + height > wall.height - 0.05) {
    height = Math.max(0.1, wall.height - 0.05 - o.sill);
    warn(`Opening is taller than the level; height reduced to ${height.toFixed(2)} m.`);
  }
  const overlap = wall.openings.find((x) => start < x.end && end > x.start);
  if (overlap) warn(`Overlaps opening "${overlap.id}".`);
  wall.openings.push({ id, source: o.source, room: o.room, type: o.type, style: o.style, hinge: o.hinge, swing: o.swing, split: o.split, start, end, sill: o.sill, height, cover: o.cover, contact: o.contact, ...(o.lock ? { lock: o.lock } : {}), ...(o.blind ? { blind: o.blind, blindStyle: o.blindStyle } : {}) });
  wall.openings.sort((x, y) => x.start - y.start);
}
