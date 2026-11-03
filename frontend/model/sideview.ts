// The side view: every room at once, seen from the side. Each floor is split into rows of
// rooms along the way one looks; the rows stand side by side, all at the front's depth, the
// floors at their true heights.

import { pointInPolygon } from "./geometry";
import type { House, RoofPart, Side, Vec2 } from "./types";

/** One row of rooms of a floor: where it is along the view, and where it is moved to. */
export interface SideBand {
  levelId: string;
  levelIndex: number;
  /** Its rooms (no two of them one behind the other). */
  rooms: string[];
  /** Its depth along the view (metres along `look`): from the front to the back. */
  from: number;
  to: number;
  /** How far it moves (plan metres): sideways into its own place, forwards to the front. */
  offset: Vec2;
}

export interface SideLayout {
  look: Side;
  /** The way one looks, and screen-right, as plan unit vectors. */
  d: Vec2;
  r: Vec2;
  /** The house's extent across the view (along r). */
  across: [number, number];
  bands: SideBand[];
}

const LOOK: Record<Side, Vec2> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
/** Rooms overlapping less than this across the view may share a row. */
const OVERLAP = 0.5;
/** Space between rows standing side by side. */
const GAP = 1.5;

export function sideLayout(house: House, look: Side): SideLayout {
  const d = LOOK[look];
  const r: Vec2 = [-d[1] || 0, d[0] || 0];
  const dot = (p: Vec2, v: Vec2) => p[0] * v[0] + p[1] * v[1];
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const l of house.levels)
    for (const p of [...l.outer, ...l.rooms.filter((x) => x.kind === "room").flatMap((x) => x.polygon)]) {
      u0 = Math.min(u0, dot(p, r));
      u1 = Math.max(u1, dot(p, r));
    }
  const raw: Omit<SideBand, "offset">[] = [];
  for (const l of house.levels) {
    if (l.kind === "roof") continue;
    // front to back, each room into the first row where it hides none of the others there
    const rooms = l.rooms
      .filter((x) => x.kind === "room")
      .map((x) => {
        const t = x.polygon.map((p) => dot(p, d));
        const u = x.polygon.map((p) => dot(p, r));
        return { id: x.id, t: [Math.min(...t), Math.max(...t)], u: [Math.min(...u), Math.max(...u)] };
      })
      .sort((a, b) => a.t[0] - b.t[0] || a.t[1] - b.t[1]);
    const rows: (typeof rooms)[] = [];
    for (const room of rooms) {
      const free = (row: typeof rooms) => row.every((o) => Math.min(o.u[1], room.u[1]) - Math.max(o.u[0], room.u[0]) < OVERLAP);
      const row = rows.find(free);
      if (row) row.push(room);
      else rows.push([room]);
    }
    for (const row of rows)
      raw.push({ levelId: l.id, levelIndex: l.index, from: Math.min(...row.map((x) => x.t[0])), to: Math.max(...row.map((x) => x.t[1])), rooms: row.map((x) => x.id) });
  }
  const front = Math.min(...raw.map((b) => b.from));
  const width = u1 - u0 + GAP;
  const seen = new Map<string, number>();
  const bands = raw.map((b) => {
    const j = seen.get(b.levelId) ?? 0;
    seen.set(b.levelId, j + 1);
    const forward = front - b.from;
    return { ...b, offset: [r[0] * j * width + d[0] * forward, r[1] * j * width + d[1] * forward] as Vec2 };
  });
  return { look, d, r, across: [u0, u1], bands };
}

/** The side view as a plain drawing: metres, x to the right, y upwards from the ground. */
export interface SideDrawing {
  rooms: { key: string; levelId: string; roomId: string; x0: number; x1: number; y0: number; y1: number }[];
  /** Walls and slabs: dark bars. */
  bars: { x0: number; x1: number; y0: number; y1: number }[];
  /** Windows and doors in the back walls. */
  openings: { kind: "window" | "door"; x0: number; x1: number; y0: number; y1: number }[];
  /** Stair steps, outlined from the floor. */
  steps: { x0: number; x1: number; y0: number; y1: number }[];
  /** The roof's profile over each top row: closed outlines. */
  roofs: [number, number][][];
  /** Balconies and roof terraces: their railings (the slab is a bar). */
  railings: { x0: number; x1: number; y0: number; y1: number }[];
  bounds: { x0: number; x1: number; y0: number; y1: number };
}

/** Where a wall's opening is, as a span of the wall (start, end along it). */
type WallLike = { a: Vec2; b: Vec2; line: [Vec2, Vec2]; thickness: number; type: string; rooms: string[]; openings: { type: string; start: number; end: number; sill: number; height: number }[] };

export function sideDrawing(house: House, walls: Map<string, WallLike[]>, layout: SideLayout, treads: (v: House["vertical"][number], rise: number) => { poly: Vec2[]; top: number }[]): SideDrawing {
  const { d, r } = layout;
  const dot = (p: Vec2, v: Vec2) => p[0] * v[0] + p[1] * v[1];
  const width = layout.across[1] - layout.across[0] + GAP;
  const out: SideDrawing = { rooms: [], bars: [], openings: [], steps: [], roofs: [], railings: [], bounds: { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity } };
  const column = new Map<string, number>();
  for (const band of layout.bands) {
    const level = house.levels[band.levelIndex];
    const j = column.get(band.levelId) ?? 0;
    column.set(band.levelId, j + 1);
    const X = j * width - layout.across[0];
    const y0 = level.elevation;
    const y1 = level.elevation + level.height;
    let lo = Infinity;
    let hi = -Infinity;
    const [u0, u1] = layout.across;
    for (const room of level.rooms) {
      if (room.kind !== "room" || !band.rooms.includes(room.id)) continue;
      const us = room.polygon.map((p) => dot(p, r));
      const a = Math.min(...us);
      const b = Math.max(...us);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
      out.rooms.push({ key: `${level.id}/${room.id}`, levelId: level.id, roomId: room.id, x0: X + a, x1: X + b, y0, y1 });
    }
    if (lo > hi) continue;
    for (const w of walls.get(level.id) ?? []) {
      // only the walls of this row's rooms (one behind them belongs to another row)
      if (w.type === "open" || !w.rooms.some((id) => band.rooms.includes(id))) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (len < 1e-6) continue;
      const dir: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const half = w.thickness / 2;
      if (Math.abs(dot(dir, r)) < 0.2) {
        // running away from the viewer: a bar where it stands, where it is in this row
        const ta = dot(w.a, d);
        const tb = dot(w.b, d);
        if (Math.min(Math.max(ta, tb), band.to) - Math.max(Math.min(ta, tb), band.from) < 0.1) continue;
        const u = dot(w.a, r);
        if (u < lo - 0.3 || u > hi + 0.3) continue;
        // a door through it, in this row: a gap
        const [s0] = w.line;
        const lineLen = Math.hypot(w.line[1][0] - s0[0], w.line[1][1] - s0[1]) || 1;
        const tAt = (m: number) => dot([s0[0] + ((w.line[1][0] - s0[0]) * m) / lineLen, s0[1] + ((w.line[1][1] - s0[1]) * m) / lineLen], d);
        const doors = w.openings.filter((o) => o.type === "door" && tAt((o.start + o.end) / 2) >= band.from - 0.05 && tAt((o.start + o.end) / 2) <= band.to + 0.05);
        out.bars.push({ x0: X + u - half, x1: X + u + half, y0, y1 });
        // a door through it in this row: drawn on the wall (the wall stays: the door is only part of it)
        for (const o of doors) out.openings.push({ kind: "door", x0: X + u - half, x1: X + u + half, y0: y0 + o.sill, y1: y0 + Math.min(level.height, o.sill + o.height) });
      } else if (Math.abs(dot(dir, d)) < 0.2) {
        // across the view: the back wall's windows and doors (the front ones are cut away)
        const t = dot(w.a, d);
        if (t < band.from + 0.2 || t > band.to + 0.35) continue;
        const [s] = w.line;
        const ld: Vec2 = [w.line[1][0] - s[0], w.line[1][1] - s[1]];
        const ll = Math.hypot(ld[0], ld[1]) || 1;
        for (const o of w.openings) {
          const ua = dot([s[0] + (ld[0] * o.start) / ll, s[1] + (ld[1] * o.start) / ll], r);
          const ub = dot([s[0] + (ld[0] * o.end) / ll, s[1] + (ld[1] * o.end) / ll], r);
          out.openings.push({ kind: o.type === "door" || o.type === "garage_door" ? "door" : "window", x0: X + Math.min(ua, ub), x1: X + Math.max(ua, ub), y0: y0 + o.sill, y1: y0 + Math.min(level.height, o.sill + o.height) });
        }
      }
    }
    // the slab under the row, to the outside walls' outer faces
    const half = house.walls.exterior / 2;
    out.bars.push({ x0: X + lo - half, x1: X + hi + half, y0: y0 - level.slab, y1: y0 });
    // stairs starting on this floor, in this row
    for (const v of house.vertical) {
      if (v.kind !== "stairs" || v.from !== band.levelIndex) continue;
      const c = v.polygon.reduce((acc, p) => [acc[0] + p[0] / v.polygon.length, acc[1] + p[1] / v.polygon.length], [0, 0]) as Vec2;
      // in the row of the room it stands in (else the row it is in)
      const room = level.rooms.find((x) => x.kind === "room" && pointInPolygon(c, x.polygon));
      const first = layout.bands.find((x) => x.levelId === band.levelId && x.from - 0.02 <= dot(c, d) && dot(c, d) <= x.to + 0.02);
      if (room ? !band.rooms.includes(room.id) : first !== band) continue;
      const rise = house.levels[v.to].elevation - level.elevation;
      for (const t of treads(v, rise)) {
        const us = t.poly.map((p) => dot(p, r));
        out.steps.push({ x0: X + Math.min(...us), x1: X + Math.max(...us), y0, y1: y0 + Math.min(t.top, rise) });
      }
    }
    // balconies of this floor nearest this row (in front of it, behind it, or beside it)
    if (level.index > 0)
      for (const room of level.rooms) {
        if (room.kind !== "outdoor") continue;
        const ts = room.polygon.map((p) => dot(p, d));
        const t = (Math.min(...ts) + Math.max(...ts)) / 2;
        const rows = layout.bands.filter((x) => x.levelId === band.levelId);
        const near = rows.reduce((best, x) => (Math.abs((x.from + x.to) / 2 - t) < Math.abs((best.from + best.to) / 2 - t) ? x : best), rows[0]);
        if (near !== band) continue;
        const us = room.polygon.map((p) => dot(p, r));
        const a = Math.min(...us);
        const z = Math.max(...us);
        out.bars.push({ x0: X + a, x1: X + z, y0: y0 - level.slab, y1: y0 });
        if (room.railing) out.railings.push({ x0: X + a, x1: X + z, y0, y1: y0 + 1 });
        lo = Math.min(lo, a);
        hi = Math.max(hi, z);
      }
    // the roof over the top floor's rows
    const top = topFloor(house);
    if (top && level.id === top.id)
      for (const { part, base } of roofParts(house)) {
        const pts: [number, number][] = [];
        const span = part.overhang + 0.05;
        for (let k = 0; k <= 60; k++) {
          const u = u0 - span + ((u1 - u0 + 2 * span) * k) / 60;
          let zmax = -Infinity;
          for (let m = 0; m <= 12; m++) {
            const t = band.from - 0.3 + ((band.to - band.from + 0.6) * m) / 12;
            const h = roofHeight(part, [r[0] * u + d[0] * t, r[1] * u + d[1] * t]);
            if (h !== null) zmax = Math.max(zmax, h);
          }
          if (zmax > -Infinity) pts.push([X + u, base + zmax]);
        }
        if (pts.length < 2) continue;
        out.roofs.push([[pts[0][0], base], ...pts, [pts[pts.length - 1][0], base]]);
        for (const [, y] of pts) out.bounds.y1 = Math.max(out.bounds.y1, y + 0.3);
        lo = Math.min(lo, pts[0][0] - X);
        hi = Math.max(hi, pts[pts.length - 1][0] - X);
      }
    const b = out.bounds;
    b.x0 = Math.min(b.x0, X + lo - 0.5);
    b.x1 = Math.max(b.x1, X + hi + 0.5);
    b.y0 = Math.min(b.y0, y0 - level.slab - 0.3);
    b.y1 = Math.max(b.y1, y1 + 0.5);
  }
  return out;
}

/** The highest floor (not a roof level): the house's roof sits on it. */
function topFloor(house: House) {
  return [...house.levels].reverse().find((l) => l.kind !== "roof" && l.rooms.length);
}

/** The roofs: a roof level's parts, else the house's roof over its top floor; and the height they start at. */
function roofParts(house: House): { part: RoofPart; base: number }[] {
  const roofLevel = house.levels.find((l) => l.kind === "roof");
  if (roofLevel) return roofLevel.roofs.map((part) => ({ part, base: roofLevel.elevation + part.offset }));
  const top = topFloor(house);
  if (!top || !top.outer.length) return [];
  const roof = house.roof;
  const part: RoofPart = {
    id: "roof",
    polygon: top.outer,
    shape: roof.shape,
    angle: roof.ridge === "east_west" ? 0 : 90,
    pitch: roof.pitch,
    overhang: roof.overhang,
    offset: 0,
    high: roof.high,
    finish: roof.finish,
    dormers: [],
    windows: [],
    furniture: [],
  };
  return [{ part, base: top.elevation + top.height }];
}

/** How high a roof part is over a plan point (over where it starts), or null outside it. */
function roofHeight(part: RoofPart, p: Vec2): number | null {
  const th = (part.angle * Math.PI) / 180;
  const dd: Vec2 = [Math.cos(th), Math.sin(th)];
  const n: Vec2 = [-Math.sin(th), Math.cos(th)];
  const as = part.polygon.map((q) => q[0] * dd[0] + q[1] * dd[1]);
  const cs = part.polygon.map((q) => q[0] * n[0] + q[1] * n[1]);
  const [r0, r1, c0, c1] = [Math.min(...as), Math.max(...as), Math.min(...cs), Math.max(...cs)];
  const a = p[0] * dd[0] + p[1] * dd[1];
  const c = p[0] * n[0] + p[1] * n[1];
  const o = part.overhang;
  if (a < r0 - o || a > r1 + o || c < c0 - o || c > c1 + o) return null;
  const t = Math.tan((part.pitch * Math.PI) / 180);
  if (part.shape === "flat") return 0.25;
  if (part.shape === "shed") {
    const SIDE: Record<Side, Vec2> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    const highFar = SIDE[part.high][0] * n[0] + SIDE[part.high][1] * n[1] >= 0;
    return Math.max(0, (highFar ? c - c0 : c1 - c) * t);
  }
  let z = Math.max(0, Math.min(c - c0, c1 - c) * t);
  if (part.shape === "hip") z = Math.min(z, Math.max(0, Math.min(a - r0, r1 - a) * t));
  return z;
}
