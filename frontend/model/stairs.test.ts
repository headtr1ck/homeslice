import { describe, expect, it } from "vitest";
import { bbox } from "./geometry";
import { galleryRails, stairPath, stairRail, stairTreads } from "./stairs";
import type { Vertical } from "./types";

const stair = (shape: Vertical["shape"], rect: [number, number, number, number], extra: Partial<Vertical> = {}): Vertical => {
  const [x, y, w, d] = rect;
  return { id: "s", kind: "stairs", polygon: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], from: 0, to: 1, shape, up: "east", start: "north", entry: 0, ...extra };
};
const inside = (p: [number, number], [x, y, w, d]: number[]) => p[0] >= x - 1e-9 && p[0] <= x + w + 1e-9 && p[1] >= y - 1e-9 && p[1] <= y + d + 1e-9;

describe("stairs", () => {
  it("an L-shaped stair: a flight along the start side, a landing in the corner, a flight away from it", () => {
    const rect = [0, 0, 4, 3];
    const treads = stairTreads(stair("l_turn", rect as never), 2.66);
    expect(treads).toHaveLength(14);
    expect(treads.every((t) => t.poly.every((p) => inside(p, rect)))).toBe(true);
    // climbing all the way, a step at a time
    expect(treads.at(-1)!.top).toBeCloseTo(2.66);
    treads.forEach((t, i) => i && expect(t.top).toBeGreaterThan(treads[i - 1].top));
    // the first flight along the north (start) side, the last step at the south end
    expect(bbox(treads[0].poly).min[1]).toBeCloseTo(0);
    expect(bbox(treads.at(-1)!.poly).max[1]).toBeCloseTo(3);
    // the landing: a 1 m square in the north-east corner
    const landing = treads.find((t) => bbox(t.poly).min[0] === 3 && bbox(t.poly).min[1] === 0 && bbox(t.poly).max[1] === 1);
    expect(landing).toBeTruthy();
    expect(stairPath(stair("l_turn", rect as never)).at(-1)![1]).toBeGreaterThan(2.5);
  });

  it("a spiral: steps round a post within the stairwell, away from the start side first", () => {
    const rect = [0, 0, 2, 2];
    const v = stair("spiral", rect as never);
    const treads = stairTreads(v, 2.66);
    expect(treads.every((t) => t.poly.every((p) => inside(p, rect)))).toBe(true);
    // the first step leaves the west (start) end and turns south, away from the north side
    const first = bbox(treads[0].poly);
    expect(first.min[0]).toBeLessThan(0.2);
    expect(bbox(treads[1].poly).max[1]).toBeGreaterThan(1);
    const rail = stairRail({ ...v, railing: "metal" }, 2.66)!;
    expect(rail).toHaveLength(treads.length);
    expect(rail.every((r, i) => !i || r.z > rail[i - 1].z)).toBe(true);
  });

  it("a straight stair's rail runs along its open side, from the floor up", () => {
    const rail = stairRail(stair("straight", [0, 0, 4, 1]), 2.66)!;
    expect(rail[0]).toMatchObject({ foot: 0, z: 0.9 });
    expect(rail.at(-1)!.z).toBeCloseTo(2.66 + 0.9);
    expect(stairRail(stair("u_turn", [0, 0, 3, 2]), 2.66)).toBeNull();
  });

  it("upstairs, a railing runs round the well: not where one steps off, nor along a wall", () => {
    // 4 × 1 m, climbing east: one steps off at the east end
    const v = stair("straight", [0, 0, 4, 1]);
    const free = galleryRails(v, []);
    const len = (s: [number, number][]) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
    expect(free.reduce((t, s) => t + len(s), 0)).toBeCloseTo(4 + 4 + 1);
    expect(free.some(([a, b]) => a[0] === 4 && b[0] === 4)).toBe(false);
    // a wall along the south side (centre 0.1 m out, 0.2 thick) closes it there
    const walled = galleryRails(v, [{ a: [-1, 1.1], b: [6, 1.1], thickness: 0.2 }]);
    expect(walled.reduce((t, s) => t + len(s), 0)).toBeCloseTo(4 + 1);
    // a wall across the middle of the north side leaves two pieces either side of it
    const split = galleryRails(v, [{ a: [2, 0], b: [2, -3], thickness: 0.2 }]);
    expect(split.filter(([a, b]) => a[1] === 0 && b[1] === 0)).toHaveLength(1);
    // a perpendicular wall doesn't close anything
    expect(split.reduce((t, s) => t + len(s), 0)).toBeCloseTo(9);
    // an L: one steps off at the far end of the second flight
    const l = galleryRails(stair("l_turn", [0, 0, 4, 3]), []);
    expect(l.reduce((t, s) => t + len(s), 0)).toBeCloseTo(4 + 3 + 4 + 3 - 1);
  });
});
