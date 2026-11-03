// Stairwell geometry shared by the renderer and the editor.

import { bbox, normalizeOrientation } from "./geometry";
import type { Vec2, Vertical } from "./types";

/**
 * A stairwell's local frame: u along the climb from its start end, w across it from the
 * start side. `plan` maps (u, w) to plan coordinates.
 */
export function stairFrame(v: Vertical) {
  const { min, max } = bbox(v.polygon);
  const dirs: Record<string, Vec2> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const d = dirs[v.up];
  const e: Vec2 = [-dirs[v.start][0], -dirs[v.start][1]];
  const ox = d[0] !== 0 ? (d[0] > 0 ? min[0] : max[0]) : e[0] > 0 ? min[0] : max[0];
  const oy = d[1] !== 0 ? (d[1] > 0 ? min[1] : max[1]) : e[1] > 0 ? min[1] : max[1];
  const L = d[0] !== 0 ? max[0] - min[0] : max[1] - min[1];
  const W = d[0] !== 0 ? max[1] - min[1] : max[0] - min[0];
  const plan = ([u, w]: Vec2): Vec2 => [ox + d[0] * u + e[0] * w, oy + d[1] * u + e[1] * w];
  return { L, W, plan };
}

/**
 * The hole a stairwell cuts into the floors above its start: the floor in front of a
 * stair's first step (its `entry`) stays, as the stair below starts there as well.
 */
export function stairHole(v: Vertical): Vec2[] {
  if (v.kind !== "stairs" || !v.entry) return v.polygon;
  const { L, W, plan } = stairFrame(v);
  const E = v.entry;
  return normalizeOrientation(holeLocal(v, L, W, E).map(plan));
}

/** The stairwell's hole in its own frame: past the entry, and over the last flights coming back. */
function holeLocal(v: Vertical, L: number, W: number, E: number): Vec2[] {
  if (v.shape !== "straight" || v.turns < 2) return [[E, 0], [L, 0], [L, W], [E, W]];
  // a U (or more): the flight coming back is over the floor before the first step
  const { fw } = flightLayout(v, L, W);
  const cut = v.turns === 2 ? W - fw : fw;
  return [[E, 0], [L, 0], [L, W], [0, W], [0, cut], [E, cut]];
}

type Box = [number, number, number, number];

/**
 * A stair in flights turning `turns` quarter turns round its stairwell (0: straight, 1: an L,
 * 2: a U, 3: round a well): the flights' width, where the first starts, each flight (along u
 * or w, from, to, its band across), the corners (a landing or winders round their pivot), and
 * the open edge inside them (the handrail's line).
 */
export function flightLayout(v: Vertical, L: number, W: number) {
  const t = Math.max(0, Math.min(3, v.turns));
  const fw = t === 2 ? W / 2 : t === 3 ? Math.min(1, W / 3, L / 3) : Math.min(1, W / 2, L / 2);
  const E = Math.max(0, Math.min(v.entry, L - fw - 0.25));
  const flights: { axis: "u" | "w"; from: number; to: number; band: [number, number] }[] = [{ axis: "u", from: E, to: L - fw, band: [0, fw] }];
  if (t >= 1) flights.push({ axis: "w", from: fw, to: t === 1 ? W : W - fw, band: [L - fw, L] });
  if (t >= 2) flights.push({ axis: "u", from: L - fw, to: t === 2 ? 0 : fw, band: [W - fw, W] });
  if (t >= 3) flights.push({ axis: "w", from: W - fw, to: fw, band: [0, fw] });
  const all: { box: Box; pivot: Vec2; from: number; to: number }[] = [
    { box: [L - fw, L, 0, fw], pivot: [L - fw, fw], from: -90, to: 0 },
    { box: [L - fw, L, W - fw, W], pivot: [L - fw, W - fw], from: 0, to: 90 },
    { box: [0, fw, W - fw, W], pivot: [fw, W - fw], from: 90, to: 180 },
  ];
  const corners = all.slice(0, t);
  const well: Vec2[] = [[E, fw], [L - fw, fw]];
  if (t === 1) well.push([L - fw, W]);
  if (t >= 2) well.push([L - fw, W - fw], [t === 2 ? 0 : fw, W - fw]);
  if (t === 3) well.push([fw, fw]);
  return { t, fw, E, flights, corners, well };
}

/** A tread of a flight: its rectangle in the (u, w) frame. */
function flightTread(f: { axis: "u" | "w"; from: number; to: number; band: [number, number] }, i: number, k: number): Vec2[] {
  const a = f.from + ((f.to - f.from) * i) / k;
  const b = f.from + ((f.to - f.from) * (i + 1)) / k;
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  return f.axis === "u"
    ? [[lo, f.band[0]], [hi, f.band[0]], [hi, f.band[1]], [lo, f.band[1]]]
    : [[f.band[0], lo], [f.band[1], lo], [f.band[1], hi], [f.band[0], hi]];
}

/** A step's tread in plan coordinates, and the height of its top above the floor. */
export interface Tread {
  poly: Vec2[];
  top: number;
  /** The flight it belongs to (stairs in flights; turns and round steps have none). */
  flight?: number;
}

/**
 * Where a stair's stringers run (the boards carrying its steps): per flight, along both its
 * sides or under its middle; from the floor (or the step before) up to its last step. Plan
 * points with their heights (the stringer's top edge). Round stairs have none.
 */
export function stairStringers(v: Vertical, rise: number): { a: Vec2; za: number; b: Vec2; zb: number }[] {
  if (v.shape !== "straight" || !v.stringers || v.stringers === "none") return [];
  const { L, W, plan } = stairFrame(v);
  const treads = stairTreadsLocal(v, rise);
  const step = treads[0]?.top ?? 0;
  const flights =
    v.turns > 0
      ? flightLayout(v, L, W).flights
      : [{ axis: "u" as const, from: Math.min(v.entry, L - 0.5), to: L, band: [W * 0.05, W * 0.95] as [number, number] }];
  const out: { a: Vec2; za: number; b: Vec2; zb: number }[] = [];
  flights.forEach((f, j) => {
    const own = treads.filter((t) => t.flight === j);
    if (!own.length || Math.abs(f.to - f.from) < 0.05) return;
    const za = own[0].top - step;
    const zb = own[own.length - 1].top;
    const lines = v.stringers === "centre" ? [(f.band[0] + f.band[1]) / 2] : [f.band[0] + 0.03, f.band[1] - 0.03];
    for (const w of lines) {
      const at = (x: number): Vec2 => (f.axis === "u" ? [x, w] : [w, x]);
      out.push({ a: plan(at(f.from)), za, b: plan(at(f.to)), zb });
    }
  });
  return out;
}

/** Winders in a quarter turn. */
const QUARTER_WINDERS = 3;

/** A curved stair: a half ring round the middle of its far side, bulging to its start side. */
export function curvedRadii(v: Vertical): { ri: number; R: number } {
  const { L, W } = stairFrame(v);
  const R = Math.min(L / 2, W) - 0.02;
  return { ri: Math.max(0.25, R - 1.1), R };
}

/** A point of a curved stair: `r` from its centre, `t` radians round from its start end. */
function curvedPoint(L: number, W: number, r: number, t: number): Vec2 {
  return [L / 2 - r * Math.cos(t), W - r * Math.sin(t)];
}

/**
 * Wedges round `pivot` between two directions (degrees in the (u, w) frame), each reaching
 * the box [u0, u1] × [w0, w1] it turns in: winders.
 */
function winders(pivot: Vec2, from: number, to: number, k: number, box: [number, number, number, number]): Vec2[][] {
  const [u0, u1, w0, w1] = box;
  const hit = (deg: number): Vec2 => {
    const r = (deg * Math.PI) / 180;
    const du = Math.cos(r);
    const dw = Math.sin(r);
    const t = Math.min(du > 1e-6 ? (u1 - pivot[0]) / du : du < -1e-6 ? (u0 - pivot[0]) / du : Infinity, dw > 1e-6 ? (w1 - pivot[1]) / dw : dw < -1e-6 ? (w0 - pivot[1]) / dw : Infinity);
    return [pivot[0] + du * t, pivot[1] + dw * t];
  };
  const corners: [number, Vec2][] = (
    [
      [u0, w0],
      [u1, w0],
      [u1, w1],
      [u0, w1],
    ] as Vec2[]
  ).map((p) => [Math.atan2(p[1] - pivot[1], p[0] - pivot[0]) * (180 / Math.PI), p]);
  const norm = (deg: number) => {
    let d = deg;
    while (d < from - 1e-6) d += 360;
    while (d > from + 360) d -= 360;
    return d;
  };
  const out: Vec2[][] = [];
  for (let j = 0; j < k; j++) {
    const a0 = from + ((to - from) * j) / k;
    const a1 = from + ((to - from) * (j + 1)) / k;
    const inner = corners
      .map(([deg, p]) => [norm(deg), p] as [number, Vec2])
      .filter(([deg]) => deg > a0 + 1e-6 && deg < a1 - 1e-6)
      .sort((x, y) => x[0] - y[0])
      .map(([, p]) => p);
    out.push([pivot, hit(a0), ...inner, hit(a1)]);
  }
  return out;
}

/** A point of a spiral stair: `r` from its centre, `t` radians round from its start end, away from the start side. */
function spiralPoint(c: Vec2, r: number, t: number): Vec2 {
  return [c[0] - r * Math.cos(t), c[1] + r * Math.sin(t)];
}

/** The radii of a spiral stair: its post and its steps' outer end. */
export function spiralRadii(v: Vertical): { r0: number; R: number } {
  const { L, W } = stairFrame(v);
  return { r0: 0.07, R: Math.min(L, W) / 2 - 0.02 };
}

/**
 * The steps of a stair climbing `rise` metres, in plan coordinates: a straight flight, two
 * flights turning (`turns` quarter turns, each a landing or winders), a half ring (curved), or
 * round a post (spiral). A turning stair's second flight goes away from its `start` side.
 */
export function stairTreads(v: Vertical, rise: number): Tread[] {
  const { plan } = stairFrame(v);
  return stairTreadsLocal(v, rise).map((t) => ({ ...t, poly: t.poly.map(plan) }));
}

/** The steps in the stair's own (u, w) frame. */
function stairTreadsLocal(v: Vertical, rise: number): Tread[] {
  const { L, W } = stairFrame(v);
  const n = Math.max(3, Math.round(rise / 0.19));
  const step = rise / n;
  const out: Tread[] = [];
  const rect = (u0: number, u1: number, w0: number, w1: number): Vec2[] => [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];
  if (v.shape === "straight" && v.turns > 0) {
    const { flights, corners } = flightLayout(v, L, W);
    // each turn a landing (one step) or winders; the rest shared by the flights' lengths
    let c = v.turn === "winders" ? QUARTER_WINDERS : 1;
    if (n - c * corners.length < flights.length) c = 1;
    const len = flights.map((f) => Math.abs(f.to - f.from));
    // a U's two landings with nothing between them are one: a step more for the flights
    const merged = c === 1 && corners.length >= 2 && len[1] < 0.05;
    const rest = n - c * corners.length + (merged ? 1 : 0);
    const total = len.reduce((x, y) => x + y, 0) || 1;
    const counts = len.map((l) => Math.floor((rest * l) / total));
    // the steps left over go to the longest flights
    [...len.keys()].sort((x, y) => (rest * len[y]) / total - counts[y] - ((rest * len[x]) / total - counts[x])).slice(0, rest - counts.reduce((x, y) => x + y, 0)).forEach((j) => counts[j]++);
    let top = 0;
    flights.forEach((f, j) => {
      for (let i = 0; i < counts[j]; i++) out.push({ poly: flightTread(f, i, counts[j]), top: (top += step), flight: j });
      const corner = corners[j];
      if (!corner) return;
      if (c === 1) {
        // two turns with no steps between them: one landing across both (a U's half landing)
        if (merged && j === 1) {
          const prev = out[out.length - 1];
          const [u0, u1, w0, w1] = corner.box;
          const b = bbox([...prev.poly, [u0, w0], [u1, w1]]);
          prev.poly = rect(b.min[0], b.max[0], b.min[1], b.max[1]);
          return;
        }
        const [u0, u1, w0, w1] = corner.box;
        out.push({ poly: rect(u0, u1, w0, w1), top: (top += step) });
      } else winders(corner.pivot, corner.from, corner.to, c, corner.box).forEach((poly) => out.push({ poly, top: (top += step) }));
    });
  } else if (v.shape === "curved") {
    // a half ring: from the start end round the start side to the far end
    const { ri, R } = curvedRadii(v);
    for (let i = 0; i < n; i++) {
      const t0 = (i * Math.PI) / n;
      const t1 = ((i + 1) * Math.PI) / n;
      const arc = [0, 1, 2, 3].map((k) => curvedPoint(L, W, R, t0 + ((t1 - t0) * k) / 3));
      out.push({ poly: [curvedPoint(L, W, ri, t0), ...arc, curvedPoint(L, W, ri, t1)], top: (i + 1) * step });
    }
  } else if (v.shape === "spiral") {
    const { r0, R } = spiralRadii(v);
    const c: Vec2 = [L / 2, W / 2];
    // from the start end round, away from the start side; the last step ends over the first
    const sweep = 2 * Math.PI * (1 - 1 / n);
    const at = (r: number, t: number): Vec2 => spiralPoint(c, r, t);
    for (let i = 0; i < n; i++) {
      const t0 = (i * sweep) / n;
      const t1 = ((i + 1) * sweep) / n;
      const arc = [0, 1, 2, 3, 4].map((k) => at(R, t0 + ((t1 - t0) * k) / 4));
      out.push({ poly: [at(r0, t0), ...arc, at(r0, t1)], top: (i + 1) * step });
    }
  } else {
    const width = W * 0.9;
    const E = Math.min(v.entry, L - 0.5);
    for (let i = 0; i < n; i++) out.push({ poly: rect(E + (i * (L - E)) / n, E + ((i + 1) * (L - E)) / n, (W - width) / 2, (W + width) / 2), top: (i + 1) * step, flight: 0 });
  }
  return out;
}

/** The walking line of a stair, from its first step up (the arrow on the plan). */
export function stairPath(v: Vertical): Vec2[] {
  const { L, W, plan } = stairFrame(v);
  const E = Math.min(v.entry, L - 0.3);
  if (v.shape === "straight" && v.turns > 0) {
    // down the middle of each flight, round the corners
    const { flights } = flightLayout(v, L, W);
    const mid = (f: (typeof flights)[number], x: number): Vec2 => (f.axis === "u" ? [x, (f.band[0] + f.band[1]) / 2] : [(f.band[0] + f.band[1]) / 2, x]);
    const last = flights[flights.length - 1];
    const pts: Vec2[] = [mid(flights[0], flights[0].from + 0.1)];
    for (let j = 1; j < flights.length; j++) {
      const f = flights[j];
      const p = flights[j - 1];
      // the corner's middle: this flight's band across the previous one's
      pts.push(p.axis === "u" ? [(f.band[0] + f.band[1]) / 2, (p.band[0] + p.band[1]) / 2] : [(p.band[0] + p.band[1]) / 2, (f.band[0] + f.band[1]) / 2]);
    }
    pts.push(mid(last, last.to + (last.to > last.from ? -0.1 : 0.1)));
    return pts.map(plan);
  }
  if (v.shape === "curved") {
    const { ri, R } = curvedRadii(v);
    return Array.from({ length: 13 }, (_, k) => curvedPoint(L, W, (ri + R) / 2, 0.08 + (k / 12) * (Math.PI - 0.16))).map(plan);
  }
  if (v.shape === "spiral") {
    const { r0, R } = spiralRadii(v);
    const r = (r0 + R) / 2 + (R - r0) * 0.1;
    const c: Vec2 = [L / 2, W / 2];
    return Array.from({ length: 17 }, (_, k) => spiralPoint(c, r, 0.2 + (k / 16) * 2 * Math.PI * 0.85)).map(plan);
  }
  return ([[E + 0.1, W / 2], [L - 0.1, W / 2]] as Vec2[]).map(plan);
}

/**
 * Where a stair's handrail runs, on its open side: plan points with the rail's height over
 * the floor (0.9 m over the steps): the inside edge of turning flights, a spiral's or curved
 * stair's outer edge, a straight one's open side.
 */
export function stairRail(v: Vertical, rise: number): { at: Vec2; z: number; foot: number }[] | null {
  const { L, W, plan } = stairFrame(v);
  const treads = stairTreads(v, rise);
  const H = 0.9;
  if (v.shape === "curved") {
    // along the outer edge, the open one
    const { R } = curvedRadii(v);
    const n = treads.length;
    return [{ at: plan(curvedPoint(L, W, R - 0.03, 0)), z: H, foot: 0 }, ...treads.map((t, i) => ({ at: plan(curvedPoint(L, W, R - 0.03, ((i + 1) * Math.PI) / n)), z: t.top + H, foot: t.top }))];
  }
  if (v.shape === "spiral") {
    const { R } = spiralRadii(v);
    const c: Vec2 = [L / 2, W / 2];
    const n = treads.length;
    const sweep = 2 * Math.PI * (1 - 1 / n);
    return treads.map((t, i) => ({ at: plan(spiralPoint(c, R - 0.03, ((i + 0.5) * sweep) / n)), z: t.top + H, foot: t.top }));
  }
  if (v.shape === "straight" && v.turns > 0) {
    // along the open edge inside the turns: each step's middle, onto that line
    const { well } = flightLayout(v, L, W);
    const onWell = (p: Vec2): Vec2 => {
      let best: Vec2 = well[0];
      let dist = Infinity;
      for (let j = 0; j + 1 < well.length; j++) {
        const [a, b] = [well[j], well[j + 1]];
        const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
        const l2 = d[0] * d[0] + d[1] * d[1] || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
        const q: Vec2 = [a[0] + d[0] * t, a[1] + d[1] * t];
        const h = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (h < dist) [best, dist] = [q, h];
      }
      // a little in, over the step
      const n = Math.hypot(p[0] - best[0], p[1] - best[1]) || 1;
      return [best[0] + ((p[0] - best[0]) / n) * 0.03, best[1] + ((p[1] - best[1]) / n) * 0.03];
    };
    const local = stairTreadsLocal(v, rise);
    const mid = (poly: Vec2[]): Vec2 => [poly.reduce((x, p) => x + p[0], 0) / poly.length, poly.reduce((x, p) => x + p[1], 0) / poly.length];
    return [{ at: plan(onWell([well[0][0] + 0.01, well[0][1] - 0.5])), z: H, foot: 0 }, ...local.map((t) => ({ at: plan(onWell(mid(t.poly))), z: t.top + H, foot: t.top }))];
  }
  const E = Math.min(v.entry, L - 0.5);
  const w = W * 0.95 - 0.02;
  return [{ at: plan([E, w]), z: H, foot: 0 }, ...treads.map((t, i) => ({ at: plan([E + ((L - E) * (i + 1)) / treads.length, w]), z: t.top + H, foot: t.top }))];
}

/**
 * The railing round a stairwell on the floor it leads up to: along the hole's edges, less
 * the edge one steps off at and where a wall stands. Plan segments.
 */
export function galleryRails(v: Vertical, walls: { a: Vec2; b: Vec2; thickness: number }[]): [Vec2, Vec2][] {
  if (v.kind !== "stairs") return [];
  const { L, W, plan } = stairFrame(v);
  const E = Math.min(v.entry, L - 0.3);
  const local = holeLocal(v, L, W, E);
  // where the top step is: no railing there (a flight's end, across its band)
  const last = v.shape === "straight" && v.turns > 0 ? flightLayout(v, L, W).flights.at(-1)! : null;
  const arrival: [Vec2, Vec2] = last
    ? last.axis === "u"
      ? [[last.to, last.band[0]], [last.to, last.band[1]]]
      : [[last.band[0], last.to], [last.band[1], last.to]]
    : v.shape === "spiral"
      ? [[E, 0], [E, W / 2]]
      : v.shape === "curved"
        ? [[L / 2 + curvedRadii(v).ri, W], [L, W]]
        : [[L, 0], [L, W]];
  const blockers = [{ a: plan(arrival[0]), b: plan(arrival[1]), half: 0 }, ...walls.map((w) => ({ a: w.a, b: w.b, half: w.thickness / 2 }))];
  const out: [Vec2, Vec2][] = [];
  const pts = local.map(plan);
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-6) return;
    const d: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    // the parts of the edge something already closes, as [from, to] along it
    const cut: [number, number][] = [];
    for (const b of blockers) {
      const ta = (b.a[0] - p[0]) * d[0] + (b.a[1] - p[1]) * d[1];
      const tb = (b.b[0] - p[0]) * d[0] + (b.b[1] - p[1]) * d[1];
      const off = (s: Vec2) => Math.abs((s[0] - p[0]) * d[1] - (s[1] - p[1]) * d[0]);
      const bl = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
      // parallel and on (or within) it
      if (bl < 1e-6 || Math.abs(Math.abs(tb - ta) - bl) > 0.02 * bl || Math.max(off(b.a), off(b.b)) > b.half + 0.05) continue;
      cut.push([Math.min(ta, tb) - b.half, Math.max(ta, tb) + b.half]);
    }
    cut.sort((x, y) => x[0] - y[0]);
    let t = 0;
    const keep = (t0: number, t1: number) => {
      if (t1 - t0 > 0.15) out.push([[p[0] + d[0] * t0, p[1] + d[1] * t0], [p[0] + d[0] * t1, p[1] + d[1] * t1]]);
    };
    for (const [c0, c1] of cut) {
      if (c0 > t) keep(t, Math.min(c0, len));
      t = Math.max(t, c1);
      if (t >= len) break;
    }
    if (t < len) keep(t, len);
  });
  return out;
}
