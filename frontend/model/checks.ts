// Editor checks that aren't errors: things that are probably drawing slips.

import type { House, Issue, Vec2 } from "./types";
import type { Wall } from "./walls";

/** Walls closer than this to a parallel wall on the level below, but not on it, are flagged. */
const NEAR = 0.15;
const SAME = 0.005;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/**
 * Walls that almost line up with a wall on the level below (within 15 cm, overlapping
 * along their length): stacked walls should sit exactly on top of each other.
 */
export function misalignedWalls(house: House, walls: Map<string, Wall[]>, roomName: (levelId: string, roomId: string) => string = (_, r) => r): Issue[] {
  const issues: Issue[] = [];
  house.levels.forEach((level, i) => {
    if (i === 0) return;
    const below = house.levels[i - 1];
    const lower = (walls.get(below.id) ?? []).filter((w) => w.type !== "open");
    for (const w of walls.get(level.id) ?? []) {
      if (w.type === "open") continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (len < 0.3) continue;
      const dir: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const normal: Vec2 = [-dir[1], dir[0]];
      let best: number | null = null;
      for (const o of lower) {
        const olen = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
        if (olen < 0.3) continue;
        const odir: Vec2 = [(o.b[0] - o.a[0]) / olen, (o.b[1] - o.a[1]) / olen];
        if (Math.abs(Math.abs(dot(dir, odir)) - 1) > 1e-3) continue;
        // overlapping along the wall?
        const t0 = dot(sub(o.a, w.a), dir);
        const t1 = dot(sub(o.b, w.a), dir);
        if (Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) < 0.3) continue;
        const off = Math.abs(dot(sub(o.a, w.a), normal));
        if (off < SAME) {
          best = null;
          break; // it does sit on a wall below
        }
        if (off < NEAR && (best === null || off < best)) best = off;
      }
      if (best === null) continue;
      const where = w.rooms.length ? w.rooms.map((r) => roomName(level.id, r)).join(" / ") : (w.side ?? "outside");
      issues.push({
        severity: "warning",
        path: `levels.${level.id}`,
        message: `The wall ${where} is ${Math.round(best * 100)} cm off the wall below. Drag it onto the wall below (it snaps to it) if they should line up.`,
      });
    }
  });
  return issues;
}
