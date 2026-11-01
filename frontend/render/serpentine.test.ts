import { describe, expect, it } from "vitest";
import { serpentine } from "./scene";

describe("underfloor pipes", () => {
  it("fill a room in runs joined at alternating ends", () => {
    const runs = serpentine([[0, 0], [2, 0], [2, 1], [0, 1]], 0.2, 0.1);
    const straight = runs.filter(([a, b]) => a[1] === b[1]);
    expect(straight).toHaveLength(5);
    expect(straight[0]).toEqual([[0.1, 0.1], [1.9, 0.1]]);
    // bends: right, then left
    const bends = runs.filter(([a, b]) => a[1] !== b[1]);
    expect(bends).toHaveLength(4);
    expect(bends[0][0][0]).toBeCloseTo(1.9);
    expect(bends[1][0][0]).toBeCloseTo(0.1);
  });

  it("splits runs around a notch and leaves rooms too small alone", () => {
    const l = serpentine([[0, 0], [3, 0], [3, 1], [2, 1], [2, 2], [0, 2]], 0.25, 0.1);
    expect(l.length).toBeGreaterThan(0);
    expect(serpentine([[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]], 0.2, 0.1)).toEqual([]);
  });
});
