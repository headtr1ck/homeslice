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
  edges,
  outwardNormal,
  project,
  scale,
  sideOf,
  sub,
} from "./geometry";
import type { Issue, Level, Opening, OpeningSource, OpeningType, Side, Vec2, WallThickness, WallType } from "./types";

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
  const isOpen = (piece: Piece) =>
    piece.rooms.size === 2 &&
    level.openBoundaries.some(
      (o) => o.between.every((r) => piece.rooms.has(r)) && (!o.side || sideFrom(o.between[0], piece.a, piece.b) === o.side),
    );
  const typeOf = (piece: Piece): WallType => {
    if (!piece.outline) return isOpen(piece) ? "open" : "interior";
    const side = sideOf(outwardNormal(...piece.outline));
    return side && partyWalls.has(side) ? "party" : "exterior";
  };

  // 4. merge collinear neighbours with the same type and the same rooms on them
  type Seg = { a: Vec2; b: Vec2; type: WallType; rooms: Set<string>; directed: boolean };
  const segs: Seg[] = [...pieces.values()].map((p) => {
    const [a, b] = p.outline ?? [p.a, p.b];
    return { a, b, type: typeOf(p), rooms: p.rooms, directed: !!p.outline };
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
        if (s.type !== t.type || roomsKey(s.rooms) !== roomsKey(t.rooms) || !collinear(s, t)) continue;
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
    const t = s.type === "open" ? 0 : thickness[s.type];
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
  wall.openings.push({ id: o.id, source: o.source, room: o.room, type: o.type, start, end, sill: o.sill, height, cover: o.cover, contact: o.contact });
  wall.openings.sort((x, y) => x.start - y.start);
}
