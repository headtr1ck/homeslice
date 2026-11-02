/**
 * Closed shapes drawn with lines: the smallest areas that walls (free-standing ones, room
 * edges, the house outline) close off, as polygons. Used to turn walls drawn freehand into
 * rooms by giving a closed shape an area.
 */
import { pointInPolygon, signedArea } from "../model/geometry";
import type { Vec2 } from "../model/types";

const KEY = 1000; // millimetres: points closer than this are one point
const key = (p: Vec2) => `${Math.round(p[0] * KEY)},${Math.round(p[1] * KEY)}`;

/** Where two segments cross (ends included), as a fraction along the first; null if they don't. */
function crossAt(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  const e = 1e-9;
  return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e ? Math.min(1, Math.max(0, t)) : null;
}

/** Fractions along a→b where point p lies on it (collinear overlaps: the other segment's ends). */
function onSegment(p: Vec2, a: Vec2, b: Vec2): number | null {
  const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  if (l2 < 1e-12) return null;
  const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  const q: Vec2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return Math.hypot(q[0] - p[0], q[1] - p[1]) < 1 / KEY ? t : null;
}

/** The bounded faces the segments close off (dangling ends ignored), largest first not guaranteed. */
export function closedFaces(segments: [Vec2, Vec2][], minArea = 0.25): Vec2[][] {
  // cut every segment where another touches or crosses it
  const pieces: [Vec2, Vec2][] = [];
  segments.forEach(([a, b], i) => {
    const ts = [0, 1];
    segments.forEach(([c, d], j) => {
      if (i === j) return;
      const t = crossAt(a, b, c, d);
      if (t !== null) ts.push(t);
      for (const p of [c, d]) {
        const u = onSegment(p, a, b);
        if (u !== null) ts.push(u);
      }
    });
    const sorted = [...new Set(ts.map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y);
    for (let k = 0; k + 1 < sorted.length; k++) {
      const p: Vec2 = [a[0] + sorted[k] * (b[0] - a[0]), a[1] + sorted[k] * (b[1] - a[1])];
      const q: Vec2 = [a[0] + sorted[k + 1] * (b[0] - a[0]), a[1] + sorted[k + 1] * (b[1] - a[1])];
      if (key(p) !== key(q)) pieces.push([p, q]);
    }
  });
  // the graph: points and their neighbours (each piece once)
  const at = new Map<string, Vec2>();
  const next = new Map<string, Set<string>>();
  for (const [p, q] of pieces) {
    const kp = key(p);
    const kq = key(q);
    at.set(kp, at.get(kp) ?? p);
    at.set(kq, at.get(kq) ?? q);
    (next.get(kp) ?? next.set(kp, new Set()).get(kp)!).add(kq);
    (next.get(kq) ?? next.set(kq, new Set()).get(kq)!).add(kp);
  }
  // loose ends close nothing: take them away until none is left
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [k, ns] of next) {
      if (ns.size < 2) {
        for (const n of ns) next.get(n)?.delete(k);
        next.delete(k);
        pruned = true;
      }
    }
  }
  const angle = (from: string, to: string) => {
    const a = at.get(from)!;
    const b = at.get(to)!;
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  // walk every directed edge once, always taking the sharpest turn one way: each walk is a face
  const used = new Set<string>();
  const faces: Vec2[][] = [];
  for (const [from, ns] of next) {
    for (const to of ns) {
      if (used.has(`${from}>${to}`)) continue;
      const loop: string[] = [];
      let u = from;
      let v = to;
      for (let guard = 0; guard < 10000 && !used.has(`${u}>${v}`); guard++) {
        used.add(`${u}>${v}`);
        loop.push(u);
        // at v, the neighbour just clockwise of the way back to u
        const back = angle(v, u);
        let best: string | null = null;
        let bestTurn = Infinity;
        for (const w of next.get(v) ?? []) {
          if (w === u && (next.get(v)?.size ?? 0) > 1) continue;
          let turn = back - angle(v, w);
          while (turn <= 0) turn += 2 * Math.PI;
          if (turn < bestTurn) {
            bestTurn = turn;
            best = w;
          }
        }
        if (!best) break;
        u = v;
        v = best;
      }
      const poly = loop.map((k) => at.get(k)!);
      // one orientation is the bounded faces, the other the outside of each connected part
      if (poly.length >= 3 && signedArea(poly) > minArea) faces.push(poly);
    }
  }
  return faces;
}

/** The smallest of the faces holding p. */
export function faceAt(faces: Vec2[][], p: Vec2): Vec2[] | null {
  let best: Vec2[] | null = null;
  for (const f of faces) if (pointInPolygon(p, f) && (!best || Math.abs(signedArea(f)) < Math.abs(signedArea(best)))) best = f;
  return best;
}
