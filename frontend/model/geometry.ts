import type { Side, Vec2 } from "./types";

export const EPS = 1e-6;

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => len(sub(a, b));

/** Shoelace area; positive for the orientation Homeslice stores. */
export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function normalizeOrientation(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function edges(poly: Vec2[]): [Vec2, Vec2][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
}

/** Outward normal of edge a→b of a positively oriented polygon: (dy, -dx) normalised. */
export function outwardNormal(a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const l = len(d) || 1;
  return [d[1] / l, -d[0] / l];
}

/** Compass side an outward normal points to; null for diagonal edges. */
export function sideOf(normal: Vec2): Side | null {
  const [x, y] = normal;
  if (Math.abs(x) < 1e-3) return y < 0 ? "north" : "south";
  if (Math.abs(y) < 1e-3) return x > 0 ? "east" : "west";
  return null;
}

/** Distance from p to segment ab and the position of its projection along ab in metres. */
export function project(p: Vec2, a: Vec2, b: Vec2): { distance: number; t: number; length: number } {
  const d = sub(b, a);
  const length = len(d);
  if (length < EPS) return { distance: dist(p, a), t: 0, length };
  const t = dot(sub(p, a), d) / length;
  const c = add(a, scale(d, t / length));
  return { distance: dist(p, c), t, length };
}

export function bbox(points: Vec2[]): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const [x, y] of points) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
  }
  return { min, max };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rectangle in the stored (positive) orientation. */
export const rectPolygon = (x: number, y: number, w: number, d: number): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
];
