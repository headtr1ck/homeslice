/**
 * Rooms from a robot vacuum's map picture: the rooms are painted in a fixed palette by room
 * number (Roborock's maps in Home Assistant, and other maps drawn by the same map parser),
 * with the cleaning path, the robot, the dock and furniture drawn over them. Each room's
 * colour is cut out, what is drawn over it filled in, its outline traced and straightened.
 */
import { signedArea } from "../model/geometry";
import type { Vec2 } from "../model/types";

/** Room colours by room number (1, 2, …): the map parser's defaults (from 12 on they repeat). */
export const ROOM_COLORS: [number, number, number][] = [
  [240, 178, 122],
  [133, 193, 233],
  [217, 136, 128],
  [52, 152, 219],
  [205, 97, 85],
  [243, 156, 18],
  [88, 214, 141],
  [245, 176, 65],
  [252, 212, 81],
  [72, 201, 176],
  [84, 153, 199],
];

export interface MapImage {
  width: number;
  height: number;
  /** RGBA, row by row (like ImageData). */
  data: Uint8ClampedArray | Uint8Array;
}

export interface MapRoom {
  /** The room number its colour stands for (1-based). */
  number: number;
  /** Its outline in picture pixels, positively oriented, straightened. */
  polygon: Vec2[];
  /** Floor area in square pixels. */
  area: number;
}

const CELL = 4; // pixels per cell (5 cm on a Roborock map)

/**
 * The rooms on the map. `minArea` in square pixels (default: 0.5 m² at 12.5 mm a pixel),
 * `grow` cells a room reaches into the wall around it (rooms are measured to wall centre lines).
 */
export function roomsFromMap(img: MapImage, { minArea = 3200, grow = 2 }: { minArea?: number; grow?: number } = {}): MapRoom[] {
  const cw = Math.ceil(img.width / CELL);
  const ch = Math.ceil(img.height / CELL);
  // each cell: the room colour most of its pixels have (0: none), and whether anything is painted there
  const label = new Int16Array(cw * ch);
  const painted = new Uint8Array(cw * ch);
  const counts = new Int32Array(ROOM_COLORS.length + 1);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      counts.fill(0);
      let any = 0;
      for (let y = cy * CELL; y < Math.min(img.height, (cy + 1) * CELL); y++)
        for (let x = cx * CELL; x < Math.min(img.width, (cx + 1) * CELL); x++) {
          const i = (y * img.width + x) * 4;
          if (img.data[i + 3] < 128) continue;
          any++;
          const n = ROOM_COLORS.findIndex((c) => c[0] === img.data[i] && c[1] === img.data[i + 1] && c[2] === img.data[i + 2]);
          if (n >= 0) counts[n + 1]++;
        }
      let best = 0;
      for (let n = 1; n < counts.length; n++) if (counts[n] > counts[best] && counts[n] * 3 >= CELL * CELL) best = n;
      label[cy * cw + cx] = best;
      painted[cy * cw + cx] = any ? 1 : 0;
    }
  // what is drawn over a room (its cleaning path, furniture, the robot): the room around it
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    const next = label.slice();
    for (let cy = 0; cy < ch; cy++)
      for (let cx = 0; cx < cw; cx++) {
        const i = cy * cw + cx;
        if (label[i] || !painted[i]) continue;
        const votes = new Map<number, number>();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
          const l = label[y * cw + x];
          if (l) votes.set(l, (votes.get(l) ?? 0) + 1);
        }
        let best = 0;
        let most = 1;
        for (const [l, v] of votes) if (v > most || (v === most && best === 0 && v >= 2)) [best, most] = [l, v];
        if (best) {
          next[i] = best;
          changed = true;
        }
      }
    label.set(next);
    if (!changed) break;
  }
  const rooms: MapRoom[] = [];
  for (let n = 1; n <= ROOM_COLORS.length; n++) {
    let mask: Uint8Array = Uint8Array.from(label, (l) => (l === n ? 1 : 0));
    if (!mask.some(Boolean)) continue;
    mask = largestPart(mask, cw, ch);
    mask = fillHoles(mask, cw, ch);
    // out into the walls around it (not into other rooms)
    for (let k = 0; k < grow; k++) {
      const next = mask.slice();
      for (let cy = 0; cy < ch; cy++)
        for (let cx = 0; cx < cw; cx++) {
          const i = cy * cw + cx;
          if (mask[i] || label[i]) continue;
          if ((cx > 0 && mask[i - 1]) || (cx < cw - 1 && mask[i + 1]) || (cy > 0 && mask[i - cw]) || (cy < ch - 1 && mask[i + cw])) next[i] = 1;
        }
      mask = next;
    }
    const outline = traceOutline(mask, cw, ch);
    if (!outline) continue;
    const area = Math.abs(signedArea(outline)) * CELL * CELL;
    if (area < minArea) continue;
    const straight = straighten(simplify(outline, 1.6));
    if (straight.length < 3) continue;
    const polygon = straight.map(([x, y]) => [x * CELL, y * CELL] as Vec2);
    rooms.push({ number: n, polygon: signedArea(polygon) < 0 ? polygon.reverse() : polygon, area });
  }
  return rooms;
}

/** Only the largest 4-connected part of a mask. */
function largestPart(mask: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Int32Array(w * h);
  let best: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const part: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      part.push(i);
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= mask.length || !mask[j] || seen[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (part.length > best.length) best = part;
  }
  const out = new Uint8Array(w * h);
  for (const i of best) out[i] = 1;
  return out;
}

/** Fills what the mask encloses (furniture the robot drove round). */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!mask[y * w + x]) stack.push(y * w + x);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!mask[y * w + x]) stack.push(y * w + x);
  for (const i of stack) outside[i] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= mask.length || mask[j] || outside[j]) continue;
      outside[j] = 1;
      stack.push(j);
    }
  }
  return Uint8Array.from(outside, (o) => (o ? 0 : 1));
}

/** The outer outline of a mask, along cell edges (corners in cell units). */
function traceOutline(mask: Uint8Array, w: number, h: number): Vec2[] | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // boundary edges with the inside on their left (y down: clockwise on screen), from corner to corner
  const next = new Map<string, Vec2[]>();
  const add = (a: Vec2, b: Vec2) => {
    const k = `${a[0]},${a[1]}`;
    (next.get(k) ?? next.set(k, []).get(k)!).push(b);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add([x + 1, y], [x, y]);
      if (!inside(x + 1, y)) add([x + 1, y + 1], [x + 1, y]);
      if (!inside(x, y + 1)) add([x, y + 1], [x + 1, y + 1]);
      if (!inside(x - 1, y)) add([x, y], [x, y + 1]);
    }
  let best: Vec2[] | null = null;
  let bestArea = 0;
  const used = new Set<string>();
  for (const [start, outs] of next) {
    for (const first of outs) {
      const ek = `${start}>${first[0]},${first[1]}`;
      if (used.has(ek)) continue;
      const loop: Vec2[] = [];
      let a = start.split(",").map(Number) as Vec2;
      let b = first;
      for (let guard = 0; guard < 1e6; guard++) {
        const k = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
        if (used.has(k)) break;
        used.add(k);
        loop.push(a);
        const choices = next.get(`${b[0]},${b[1]}`) ?? [];
        if (!choices.length) break;
        // at a pinch, keep turning the same way round
        const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
        const pick = choices.length === 1 ? choices[0] : (choices.find((c) => d[0] * (c[1] - b[1]) - d[1] * (c[0] - b[0]) < 0) ?? choices[0]);
        a = b;
        b = pick;
      }
      const area = Math.abs(signedArea(loop));
      if (loop.length >= 4 && area > bestArea) [best, bestArea] = [loop, area];
    }
  }
  return best;
}

/** Douglas–Peucker on a closed outline. */
function simplify(poly: Vec2[], tolerance: number): Vec2[] {
  if (poly.length < 4) return poly;
  // split at the two points farthest apart, simplify both halves
  let far = 0;
  for (let i = 1; i < poly.length; i++) if (Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]) > Math.hypot(poly[far][0] - poly[0][0], poly[far][1] - poly[0][1])) far = i;
  const dp = (pts: Vec2[]): Vec2[] => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let worst = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / len;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst <= tolerance) return [a, b];
    const left = dp(pts.slice(0, at + 1));
    return [...left.slice(0, -1), ...dp(pts.slice(at))];
  };
  const first = dp(poly.slice(0, far + 1));
  const second = dp([...poly.slice(far), poly[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * Walls nearly along an axis made exactly so (rooms are mostly right-angled); the corners
 * moved to where the straightened walls meet. Others stay as drawn.
 */
function straighten(poly: Vec2[], degrees = 22): Vec2[] {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const angle = Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
    if (angle < degrees || angle > 180 - degrees) {
      const y = (a[1] + b[1]) / 2;
      return { p: [a[0], y] as Vec2, d: [1, 0] as Vec2 };
    }
    if (Math.abs(angle - 90) < degrees) {
      const x = (a[0] + b[0]) / 2;
      return { p: [x, a[1]] as Vec2, d: [0, 1] as Vec2 };
    }
    return { p: a, d: [b[0] - a[0], b[1] - a[1]] as Vec2 };
  });
  // a short slanted edge between two straight walls is a corner rounded off by the tracing: a corner
  const axis = (l: { d: Vec2 }) => l.d[0] === 0 || l.d[1] === 0;
  const kept = lines.filter((l, i) => {
    if (axis(l)) return true;
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const next = lines[(i + 1) % lines.length];
    return !(axis(prev) && axis(next) && Math.hypot(l.d[0], l.d[1]) < 16 && Math.abs(prev.d[0] * next.d[1] - prev.d[1] * next.d[0]) > 1e-9);
  });
  // consecutive parallel walls (a tiny step smoothed away): one wall
  const merged = kept.filter((l, i, lines) => {
    const m = lines[(i + 1) % lines.length];
    return Math.abs(l.d[0] * m.d[1] - l.d[1] * m.d[0]) > 1e-9 || Math.hypot(l.p[0] - m.p[0], l.p[1] - m.p[1]) > 1e-9 ? true : false;
  });
  const out: Vec2[] = [];
  for (let i = 0; i < merged.length; i++) {
    const l1 = merged[(i - 1 + merged.length) % merged.length];
    const l2 = merged[i];
    const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den;
    out.push([l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t]);
  }
  // drop corners on a straight line, and tiny edges
  return out.filter((p, i) => {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[(i + 1) % out.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6;
  });
}
