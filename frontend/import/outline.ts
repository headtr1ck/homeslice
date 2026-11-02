// The outer boundary of a floor's rooms (their union), for houses that come without an
// outline (imports): every room edge is cut where other rooms' corners and edges meet it;
// the pieces with a room on one side and none on the other are the boundary, chained into
// loops; the biggest loop is the outline.
import { normalizeOrientation, pointInPolygon } from "../model/geometry";
import type { Vec2 } from "../model/types";

const EPS = 0.01;
const key = ([x, y]: Vec2) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
const area = (p: Vec2[]) => p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2;

/** Where segment a–b crosses or touches segment c–d, as a fraction along a–b (strictly inside). */
function cuts(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number[] {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const len2 = r[0] * r[0] + r[1] * r[1];
  const out: number[] = [];
  // the other segment's ends lying on this one (T-junctions, overlaps)
  for (const p of [c, d]) {
    const t = ((p[0] - a[0]) * r[0] + (p[1] - a[1]) * r[1]) / len2;
    const off = Math.abs((p[0] - a[0]) * r[1] - (p[1] - a[1]) * r[0]) / Math.sqrt(len2);
    if (t > 1e-6 && t < 1 - 1e-6 && off < EPS) out.push(t);
  }
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) > 1e-9) {
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && u > -1e-6 && u < 1 + 1e-6) out.push(t);
  }
  return out;
}

/**
 * A house's outline from its levels' rooms: the ground floor's on the house, a level whose
 * rooms reach elsewhere gets its own.
 */
export function withOutlines<H extends { outline?: unknown; levels: { rooms: unknown[]; outline?: unknown }[] }>(house: H, roomsOf: (level: H["levels"][number]) => Vec2[][]): H {
  const outlines = house.levels.map((l) => outlineOf(roomsOf(l)));
  const first = outlines.find(Boolean);
  if (!first) return house;
  const same = (a: Vec2[], b: Vec2[]) => JSON.stringify([...a].map((p) => p.join()).sort()) === JSON.stringify([...b].map((p) => p.join()).sort());
  return {
    ...house,
    outline: { polygon: first },
    levels: house.levels.map((l, i) => (outlines[i] && !same(outlines[i]!, first) ? { ...l, outline: { polygon: outlines[i] } } : l)),
  };
}

/** The outline around these room polygons (counter-clockwise like the rest of the model), or null. */
export function outlineOf(rooms: Vec2[][]): Vec2[] | null {
  const polys = rooms.filter((p) => p.length >= 3).map(normalizeOrientation);
  if (!polys.length) return null;
  const inAny = (p: Vec2) => polys.some((q) => pointInPolygon(p, q));
  const pieces: [Vec2, Vec2][] = [];
  for (const poly of polys)
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const ts = [0, 1];
      for (const other of polys) other.forEach((c, j) => ts.push(...cuts(a, b, c, other[(j + 1) % other.length])));
      ts.sort((x, y) => x - y);
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < 1e-6) continue;
        const p: Vec2 = [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]];
        const q: Vec2 = [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 1e-4) continue;
        // a little to either side of the piece's middle
        const m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const n: Vec2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
        const left = inAny([m[0] + n[0] * EPS, m[1] + n[1] * EPS]);
        const right = inAny([m[0] - n[0] * EPS, m[1] - n[1] * EPS]);
        if (left === right) continue;
        // keep the inside on the same hand everywhere: chained pieces run one way round
        pieces.push(left ? [p, q] : [q, p]);
      }
    });
  // chain the pieces end to start (duplicates from rooms sharing an outer edge collapse)
  const next = new Map<string, Vec2[]>();
  const seen = new Set<string>();
  for (const [p, q] of pieces) {
    const id = `${key(p)}>${key(q)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    next.set(key(p), [...(next.get(key(p)) ?? []), q]);
  }
  const used = new Set<string>();
  const loops: Vec2[][] = [];
  for (const [p, q] of pieces) {
    if (used.has(`${key(p)}>${key(q)}`)) continue;
    const loop: Vec2[] = [p];
    let at = p;
    let to = q;
    for (let guard = 0; guard < 10000; guard++) {
      used.add(`${key(at)}>${key(to)}`);
      if (key(to) === key(loop[0])) break;
      loop.push(to);
      at = to;
      const options = (next.get(key(at)) ?? []).filter((x) => !used.has(`${key(at)}>${key(x)}`));
      if (!options.length) break;
      to = options[0];
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return null;
  const best = loops.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  // drop corners on straight runs
  const clean = best.filter((p, i) => {
    const a = best[(i - 1 + best.length) % best.length];
    const b = best[(i + 1) % best.length];
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-6;
  });
  return normalizeOrientation(clean.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as Vec2));
}
