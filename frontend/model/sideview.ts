// The side view: every room at once, seen from the side. Each floor is split into rows of
// rooms along the way one looks; the rows stand side by side, all at the front's depth, the
// floors at their true heights.

import type { House, Side, Vec2 } from "./types";

/** One row of rooms of a floor: where it is along the view, and where it is moved to. */
export interface SideBand {
  levelId: string;
  levelIndex: number;
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
/** Rows overlapping less than this are rows of their own. */
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
    // each room's depth range, front first
    const spans = l.rooms
      .filter((x) => x.kind === "room")
      .map((x) => {
        const t = x.polygon.map((p) => dot(p, d));
        return [Math.min(...t), Math.max(...t)] as [number, number];
      })
      .sort((a, b) => a[0] - b[0]);
    let band: [number, number] | null = null;
    const close = () => band && raw.push({ levelId: l.id, levelIndex: l.index, from: band[0], to: band[1] });
    for (const [a, b] of spans) {
      // a room reaching well into the row: part of it
      if (band && a < band[1] - OVERLAP) band[1] = Math.max(band[1], b);
      else {
        close();
        band = [a, b];
      }
    }
    close();
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
  bounds: { x0: number; x1: number; y0: number; y1: number };
}

/** Where a wall's opening is, as a span of the wall (start, end along it). */
type WallLike = { a: Vec2; b: Vec2; line: [Vec2, Vec2]; thickness: number; type: string; openings: { type: string; start: number; end: number; sill: number; height: number }[] };

export function sideDrawing(house: House, walls: Map<string, WallLike[]>, layout: SideLayout, treads: (v: House["vertical"][number], rise: number) => { poly: Vec2[]; top: number }[]): SideDrawing {
  const { d, r } = layout;
  const dot = (p: Vec2, v: Vec2) => p[0] * v[0] + p[1] * v[1];
  const [u0, u1] = layout.across;
  const width = u1 - u0 + GAP;
  const out: SideDrawing = { rooms: [], bars: [], openings: [], steps: [], bounds: { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity } };
  const column = new Map<string, number>();
  for (const band of layout.bands) {
    const level = house.levels[band.levelIndex];
    const j = column.get(band.levelId) ?? 0;
    column.set(band.levelId, j + 1);
    const X = j * width - u0;
    const y0 = level.elevation;
    const y1 = level.elevation + level.height;
    const inBand = (t: number) => t >= band.from - 0.02 && t <= band.to + 0.02;
    let lo = Infinity;
    let hi = -Infinity;
    for (const room of level.rooms) {
      if (room.kind !== "room") continue;
      const ts = room.polygon.map((p) => dot(p, d));
      if (!inBand((Math.min(...ts) + Math.max(...ts)) / 2)) continue;
      const us = room.polygon.map((p) => dot(p, r));
      const a = Math.min(...us);
      const b = Math.max(...us);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
      out.rooms.push({ key: `${level.id}/${room.id}`, levelId: level.id, roomId: room.id, x0: X + a, x1: X + b, y0, y1 });
    }
    if (lo > hi) continue;
    for (const w of walls.get(level.id) ?? []) {
      if (w.type === "open") continue;
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
        // a door through it: a gap
        const doors = w.openings.filter((o) => o.type === "door").sort((p, q) => p.sill - q.sill);
        const top = doors.length ? Math.max(...doors.map((o) => o.sill + o.height)) : 0;
        out.bars.push({ x0: X + u - half, x1: X + u + half, y0: y0 + Math.min(top, level.height), y1 });
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
    // the slab under the row (its end walls are the outside walls, above)
    out.bars.push({ x0: X + lo - 0.15, x1: X + hi + 0.15, y0: y0 - level.slab, y1: y0 });
    // stairs starting on this floor, in this row
    for (const v of house.vertical) {
      if (v.kind !== "stairs" || v.from !== band.levelIndex) continue;
      const c = v.polygon.reduce((acc, p) => [acc[0] + p[0] / v.polygon.length, acc[1] + p[1] / v.polygon.length], [0, 0]);
      if (!inBand(dot(c as Vec2, d))) continue;
      const rise = house.levels[v.to].elevation - level.elevation;
      for (const t of treads(v, rise)) {
        const us = t.poly.map((p) => dot(p, r));
        out.steps.push({ x0: X + Math.min(...us), x1: X + Math.max(...us), y0, y1: y0 + Math.min(t.top, rise) });
      }
    }
    const b = out.bounds;
    b.x0 = Math.min(b.x0, X + lo - 0.5);
    b.x1 = Math.max(b.x1, X + hi + 0.5);
    b.y0 = Math.min(b.y0, y0 - level.slab - 0.3);
    b.y1 = Math.max(b.y1, y1 + 0.5);
  }
  return out;
}
