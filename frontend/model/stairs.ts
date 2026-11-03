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
  const local: Vec2[] = v.shape === "u_turn" ? [[E, 0], [L, 0], [L, W], [0, W], [0, W / 2], [E, W / 2]] : [[E, 0], [L, 0], [L, W], [E, W]];
  return normalizeOrientation(local.map(plan));
}

/** A step's tread in plan coordinates, and the height of its top above the floor. */
export interface Tread {
  poly: Vec2[];
  top: number;
}

/**
 * An L-shaped stair's flights: their width (the landing is a square of it), where the first
 * starts, and how many steps each has (the landing counting as one).
 */
function lFlights(v: Vertical, L: number, W: number, n: number) {
  const fw = Math.min(1, W / 2, L / 2);
  const E = Math.max(0, Math.min(v.entry, L - fw - 0.25));
  const run1 = L - fw - E;
  const run2 = W - fw;
  const a = Math.max(1, Math.min(n - 2, Math.round(((n - 1) * run1) / (run1 + run2))));
  return { fw, E, run1, run2, a, b: n - 1 - a };
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
 * flights joined by winders (u_turn), two at a right angle with a landing (l_turn), or
 * round a post (spiral). A turning stair's second flight goes away from its `start` side.
 */
export function stairTreads(v: Vertical, rise: number): Tread[] {
  const { L, W, plan } = stairFrame(v);
  const n = Math.max(3, Math.round(rise / 0.19));
  const step = rise / n;
  const out: { poly: Vec2[]; top: number }[] = [];
  const rect = (u0: number, u1: number, w0: number, w1: number): Vec2[] => [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];
  if (v.shape === "u_turn") {
    const fw = W / 2; // flight width
    const S = Math.max(0.5, L - fw); // straight part; the turn takes a square at the far end
    const k = Math.min(6, Math.max(3, Math.round(n / 3))); // winders over 180°
    // the first flight starts `entry` in; the straight steps are shared by length
    const E = Math.min(v.entry, S - 0.25);
    const a = Math.max(1, Math.round(((n - k) * (S - E)) / (2 * S - E)));
    const b = n - k - a;
    for (let i = 0; i < a; i++) out.push({ poly: rect(E + (i * (S - E)) / a, E + ((i + 1) * (S - E)) / a, 0, fw), top: (i + 1) * step });
    // winders: wedges around the turn's pivot, clipped to the stairwell's far end
    const pivot: Vec2 = [S, W / 2];
    const hit = (deg: number): Vec2 => {
      const r = (deg * Math.PI) / 180;
      const du = Math.cos(r);
      const dw = Math.sin(r);
      const t = Math.min(du > 1e-6 ? (L - S) / du : Infinity, dw > 1e-6 ? (W - pivot[1]) / dw : dw < -1e-6 ? -pivot[1] / dw : Infinity);
      return [pivot[0] + du * t, pivot[1] + dw * t];
    };
    const corners: [number, Vec2][] = [
      [-Math.atan2(W / 2, L - S) * (180 / Math.PI), [L, 0]],
      [Math.atan2(W / 2, L - S) * (180 / Math.PI), [L, W]],
    ];
    for (let j = 0; j < k; j++) {
      const a0 = -90 + (180 * j) / k;
      const a1 = -90 + (180 * (j + 1)) / k;
      const poly: Vec2[] = [pivot, hit(a0), ...corners.filter(([deg]) => deg > a0 && deg < a1).map(([, p]) => p), hit(a1)];
      out.push({ poly, top: (a + j + 1) * step });
    }
    for (let m = 0; m < b; m++) out.push({ poly: rect(S - ((m + 1) * S) / b, S - (m * S) / b, W - fw, W), top: (a + k + m + 1) * step });
  } else if (v.shape === "l_turn") {
    const { fw, E, run1, run2, a, b } = lFlights(v, L, W, n);
    for (let i = 0; i < a; i++) out.push({ poly: rect(E + (i * run1) / a, E + ((i + 1) * run1) / a, 0, fw), top: (i + 1) * step });
    out.push({ poly: rect(L - fw, L, 0, fw), top: (a + 1) * step });
    for (let m = 0; m < b; m++) out.push({ poly: rect(L - fw, L, fw + (m * run2) / b, fw + ((m + 1) * run2) / b), top: (a + 2 + m) * step });
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
    for (let i = 0; i < n; i++) out.push({ poly: rect(E + (i * (L - E)) / n, E + ((i + 1) * (L - E)) / n, (W - width) / 2, (W + width) / 2), top: (i + 1) * step });
  }
  return out.map((t) => ({ poly: t.poly.map(plan), top: t.top }));
}

/** The walking line of a stair, from its first step up (the arrow on the plan). */
export function stairPath(v: Vertical): Vec2[] {
  const { L, W, plan } = stairFrame(v);
  const E = Math.min(v.entry, L - 0.3);
  if (v.shape === "u_turn") {
    const q = W / 4;
    return ([[E + 0.1, q], [L - q, q], [L - q, W - q], [0.15, W - q]] as Vec2[]).map(plan);
  }
  if (v.shape === "l_turn") {
    const { fw, E: start } = lFlights(v, L, W, 3);
    return ([[start + 0.1, fw / 2], [L - fw / 2, fw / 2], [L - fw / 2, W - 0.1]] as Vec2[]).map(plan);
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
 * the floor (0.9 m over the steps). Null for a u_turn (its screen is between the flights).
 */
export function stairRail(v: Vertical, rise: number): { at: Vec2; z: number; foot: number }[] | null {
  if (v.shape === "u_turn") return null;
  const { L, W, plan } = stairFrame(v);
  const treads = stairTreads(v, rise);
  const H = 0.9;
  if (v.shape === "spiral") {
    const { R } = spiralRadii(v);
    const c: Vec2 = [L / 2, W / 2];
    const n = treads.length;
    const sweep = 2 * Math.PI * (1 - 1 / n);
    return treads.map((t, i) => ({ at: plan(spiralPoint(c, R - 0.03, ((i + 0.5) * sweep) / n)), z: t.top + H, foot: t.top }));
  }
  if (v.shape === "l_turn") {
    // the open edges: the first flight's (w = fw), then the second's (u = L − fw)
    const { fw, E, run1, run2, a, b } = lFlights(v, L, W, treads.length);
    const pts = [{ at: plan([E, fw - 0.03]), z: H, foot: 0 }];
    for (let i = 1; i <= a; i++) pts.push({ at: plan([E + (run1 * i) / a, fw - 0.03]), z: treads[i - 1].top + H, foot: treads[i - 1].top });
    for (let m = 1; m <= b; m++) pts.push({ at: plan([L - fw + 0.03, fw + (run2 * m) / b]), z: treads[a + m].top + H, foot: treads[a + m].top });
    return pts;
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
  const fw = Math.min(1, W / 2, L / 2);
  const local: Vec2[] = v.shape === "u_turn" ? [[E, 0], [L, 0], [L, W], [0, W], [0, W / 2], [E, W / 2]] : [[E, 0], [L, 0], [L, W], [E, W]];
  // where the top step is: no railing there
  const arrival: [Vec2, Vec2] =
    v.shape === "u_turn" ? [[0, W / 2], [0, W]] : v.shape === "l_turn" ? [[L - fw, W], [L, W]] : v.shape === "spiral" ? [[E, 0], [E, W / 2]] : [[L, 0], [L, W]];
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
