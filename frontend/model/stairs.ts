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
