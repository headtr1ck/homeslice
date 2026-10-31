// Routes for the energy overlay's lines: along the outside of the walls and down a
// corner of the house, like cables, instead of straight through it.

import type { Vec2 } from "./types";

/** The outline pushed outwards by `by` metres (mitred corners). */
export function offsetPolygon(poly: Vec2[], by: number): Vec2[] {
  const n = poly.length;
  // the outline's orientation decides which side of an edge is outside
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
  const sign = area > 0 ? -1 : 1;
  const normal = (a: Vec2, b: Vec2): Vec2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(sign * -(b[1] - a[1])) / l, (sign * (b[0] - a[0])) / l];
  };
  return poly.map((p, i) => {
    const n1 = normal(poly[(i - 1 + n) % n], p);
    const n2 = normal(p, poly[(i + 1) % n]);
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const m: Vec2 = k > 1e-6 ? [(n1[0] + n2[0]) / k, (n1[1] + n2[1]) / k] : n1;
    return [p[0] + m[0] * by, p[1] + m[1] * by];
  });
}

/** Where `p` lands on the polygon's boundary: the edge, how far along it, and the point. */
function nearestOnBoundary(poly: Vec2[], p: Vec2): { edge: number; t: number; at: Vec2 } {
  let best = { edge: 0, t: 0, at: poly[0], d: Infinity };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const at: Vec2 = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (d < best.d) best = { edge: i, t, at, d };
  });
  return best;
}

/**
 * From `from` to `to` (both near the polygon) along its boundary, the shorter way
 * round: the two landing points and the corners in between.
 */
export function perimeterPath(poly: Vec2[], from: Vec2, to: Vec2): Vec2[] {
  const n = poly.length;
  const a = nearestOnBoundary(poly, from);
  const b = nearestOnBoundary(poly, to);
  const len = (p: Vec2, q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const walk = (dir: 1 | -1): Vec2[] => {
    const out: Vec2[] = [a.at];
    if (a.edge === b.edge && (dir === 1 ? b.t >= a.t : b.t <= a.t)) return [...out, b.at];
    // forwards: the corners at the ends of the edges passed; backwards: their starts
    let i = a.edge;
    for (let steps = 0; steps <= n; steps++) {
      const corner = dir === 1 ? (i + 1) % n : i;
      out.push(poly[corner]);
      i = (i + dir + n) % n;
      if (i === b.edge) break;
    }
    out.push(b.at);
    return out;
  };
  const length = (path: Vec2[]) => path.reduce((s, p, i) => (i ? s + len(path[i - 1], p) : 0), 0);
  const dedupe = (path: Vec2[]) => path.filter((p, i) => i === 0 || len(path[i - 1], p) > 1e-6);
  const forward = dedupe(walk(1));
  const backward = dedupe(walk(-1));
  return length(forward) <= length(backward) ? forward : backward;
}

/** The polygon corner nearest a point. */
export function nearestCorner(poly: Vec2[], p: Vec2): Vec2 {
  return poly.reduce((best, c) => (Math.hypot(c[0] - p[0], c[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1]) ? c : best), poly[0]);
}
