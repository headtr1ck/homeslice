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

/** Compass side an outward normal points to (within `slant`); null for diagonal edges. */
export function sideOf(normal: Vec2, slant = 1e-3): Side | null {
  const [x, y] = normal;
  if (Math.abs(x) < slant) return y < 0 ? "north" : "south";
  if (Math.abs(y) < slant) return x > 0 ? "east" : "west";
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

/** Distance from p to the nearest polygon edge. */
export function edgeDistance(p: Vec2, poly: Vec2[]): number {
  return Math.min(...edges(poly).map(([a, b]) => {
    const pr = project(p, a, b);
    return pr.t < 0 ? dist(p, a) : pr.t > pr.length ? dist(p, b) : pr.distance;
  }));
}

/** A point well inside the polygon (roughly the farthest from its edges), for labels. */
export function labelPoint(poly: Vec2[]): Vec2 {
  const { min, max } = bbox(poly);
  const steps = 24;
  let best: Vec2 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  let bestDistance = pointInPolygon(best, poly) ? edgeDistance(best, poly) : -1;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const p: Vec2 = [min[0] + ((max[0] - min[0]) * i) / steps, min[1] + ((max[1] - min[1]) * j) / steps];
      if (!pointInPolygon(p, poly)) continue;
      const d = edgeDistance(p, poly);
      if (d > bestDistance + 1e-3) [best, bestDistance] = [p, d];
    }
  }
  return best;
}

/** Whether a polygon is convex (either orientation). */
export function isConvex(poly: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [a, b, c] = [poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** `subject` clipped to the convex polygon `clip` (Sutherland–Hodgman): their intersection. */
export function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  const c = signedArea(clip) < 0 ? [...clip].reverse() : clip;
  const inside = (p: Vec2, a: Vec2, b: Vec2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
  const cut = (p: Vec2, q: Vec2, a: Vec2, b: Vec2): Vec2 => {
    const [x1, y1, x2, y2, x3, y3, x4, y4] = [p[0], p[1], q[0], q[1], a[0], a[1], b[0], b[1]];
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4) || 1e-12;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  let out = subject;
  for (let i = 0; i < c.length && out.length; i++) {
    const [a, b] = [c[i], c[(i + 1) % c.length]];
    const input = out;
    out = [];
    input.forEach((p, j) => {
      const q = input[(j + 1) % input.length];
      const pin = inside(p, a, b);
      const qin = inside(q, a, b);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cut(p, q, a, b));
    });
  }
  return out;
}

/**
 * The part of `hole` that lies inside `poly` (for cutting a stairwell out of a room's
 * floor, also where it only reaches into the room). One of the two must be convex;
 * otherwise the hole counts only when its middle is inside.
 */
export function overlap(hole: Vec2[], poly: Vec2[]): Vec2[] | null {
  let part: Vec2[];
  if (isConvex(poly)) part = clipConvex(hole, poly);
  else if (isConvex(hole)) part = clipConvex(poly, hole);
  else {
    const [cx, cy] = hole.reduce((s, p) => [s[0] + p[0] / hole.length, s[1] + p[1] / hole.length], [0, 0]);
    return pointInPolygon([cx, cy], poly) ? hole : null;
  }
  return part.length >= 3 && Math.abs(signedArea(part)) > 1e-4 ? part : null;
}

/**
 * A polygon with some of its edges bent into arcs: `bulge` is how far the arc's middle
 * stands off the straight edge, in metres (positive outwards, negative inwards, at most
 * half the edge: a half circle). Edges count from the polygon's (or rect's) first corner;
 * a rect's are north, east, south, west. The arcs become short straight pieces.
 */
export function bendEdges(pts: Vec2[], curves: { edge: number; bulge: number }[]): Vec2[] {
  if (!curves.length) return pts;
  const out: Vec2[] = [];
  pts.forEach((a, i) => {
    out.push(a);
    const c = curves.find((x) => x.edge === i);
    if (!c || Math.abs(c.bulge) < 1e-4) return;
    const b = pts[(i + 1) % pts.length];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (chord < 1e-6) return;
    const u: Vec2 = [(b[0] - a[0]) / chord, (b[1] - a[1]) / chord];
    // outwards: the side of the edge away from the shape
    let n: Vec2 = [u[1], -u[0]];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pointInPolygon([mid[0] + n[0] * 1e-3, mid[1] + n[1] * 1e-3], pts)) n = [-n[0], -n[1]];
    const s = Math.min(Math.abs(c.bulge), chord / 2);
    const dir: Vec2 = c.bulge > 0 ? n : [-n[0], -n[1]];
    const r = (chord * chord) / 4 / (2 * s) + s / 2;
    const centre: Vec2 = [mid[0] + dir[0] * (s - r), mid[1] + dir[1] * (s - r)];
    const theta = Math.asin(Math.min(1, chord / 2 / r));
    const steps = Math.max(4, Math.min(32, Math.ceil((2 * theta * r) / 0.3)));
    for (let k = 1; k < steps; k++) {
      const phi = -theta + (2 * theta * k) / steps;
      const p: Vec2 = [centre[0] + r * (u[0] * Math.sin(phi) + dir[0] * Math.cos(phi)), centre[1] + r * (u[1] * Math.sin(phi) + dir[1] * Math.cos(phi))];
      out.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
    }
  });
  return out;
}

/** Whether `inner` lies wholly within `outer` (its corners inside or on the edges) and is smaller. */
export function within(inner: Vec2[], outer: Vec2[]): boolean {
  if (Math.abs(signedArea(inner)) >= Math.abs(signedArea(outer)) - 1e-6) return false;
  return inner.every((p) => pointInPolygon(p, outer) || edgeDistance(p, outer) < 1e-3);
}

/** The rooms (polygons) lying inside this one: holes in its floor. */
export function nestedIn<R extends { polygon: Vec2[] }>(room: R, rooms: R[]): R[] {
  return rooms.filter((r) => r !== room && within(r.polygon, room.polygon));
}

/** The innermost of the polygons holding p. */
export function innermost<R extends { polygon: Vec2[] }>(rooms: R[], p: Vec2): R | undefined {
  let best: R | undefined;
  for (const r of rooms) if (pointInPolygon(p, r.polygon) && (!best || Math.abs(signedArea(r.polygon)) < Math.abs(signedArea(best.polygon)))) best = r;
  return best;
}
