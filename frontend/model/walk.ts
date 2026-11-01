// Walking through a floor at eye level: where a step may go. Inside rooms (and gardens),
// not through walls; through doors, openings and open walls.

import { pointInPolygon } from "./geometry";
import type { Level, Vec2 } from "./types";
import type { Wall } from "./walls";

/** How close one may come to a wall's centre line, on top of half its thickness. */
const KEEP = 0.18;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];

/** Where along the wall (metres from its line's start) a point is, and how far from it. */
function along(w: Wall, p: Vec2): { t: number; d: number; len: number } {
  const [a, b] = w.line;
  const ab = sub(b, a);
  const len = Math.hypot(ab[0], ab[1]) || 1;
  const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / len;
  const c: Vec2 = [a[0] + (ab[0] / len) * Math.max(0, Math.min(len, t)), a[1] + (ab[1] / len) * Math.max(0, Math.min(len, t))];
  return { t, d: Math.hypot(p[0] - c[0], p[1] - c[1]), len };
}

/** Whether one can pass the wall at `t` metres along it: a door, an opening, an open wall. */
function passable(w: Wall, t: number): boolean {
  if (w.type === "open") return true;
  return w.openings.some((o) => (o.type !== "window" || o.sill < 0.1) && t > o.start + 0.12 && t < o.end - 0.12);
}

/** Where a step from `from` towards `to` ends: `to`, or `from` when a wall or the outside is in the way. */
export function walkStep(level: Level, walls: Wall[], from: Vec2, to: Vec2): Vec2 {
  if (!level.rooms.some((r) => r.kind !== "void" && pointInPolygon(to, r.polygon))) return from;
  for (const w of walls) {
    const { t, d, len } = along(w, to);
    // crossing the wall's line on this step
    const [a, b] = w.line;
    const r = sub(b, a);
    const s = sub(to, from);
    const den = cross(r, s);
    if (Math.abs(den) > 1e-9) {
      const u = cross(sub(from, a), s) / den;
      const v = cross(sub(from, a), r) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && !passable(w, u * len)) return from;
    }
    // too close to it (but fine in a doorway)
    if (t > -0.05 && t < len + 0.05 && d < w.thickness / 2 + KEEP && !passable(w, t)) return from;
  }
  return to;
}
