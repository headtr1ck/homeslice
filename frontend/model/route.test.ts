import { describe, expect, it } from "vitest";
import { nearestCorner, offsetPolygon, perimeterPath } from "./route";
import type { Vec2 } from "./types";

const square: Vec2[] = [[0, 0], [10, 0], [10, 8], [0, 8]];

describe("energy line routes", () => {
  it("offsets the outline outwards, whatever its orientation", () => {
    expect(offsetPolygon(square, 0.5)).toEqual([[-0.5, -0.5], [10.5, -0.5], [10.5, 8.5], [-0.5, 8.5]]);
    expect(offsetPolygon([...square].reverse(), 0.5)).toEqual([[-0.5, 8.5], [10.5, 8.5], [10.5, -0.5], [-0.5, -0.5]]);
  });
  it("walks the shorter way round the house", () => {
    // from the west side to the north-east corner: over the north-west corner
    expect(perimeterPath(square, [1, 3], [10, 0])).toEqual([[0, 3], [0, 0], [10, 0]]);
    // from near the south-east corner to the north-east corner: up the east side
    expect(perimeterPath(square, [9.5, 7], [10, 0])).toEqual([[10, 7], [10, 0]]);
    // from the south side to the north-east corner: round the south-east corner
    expect(perimeterPath(square, [6, 7.8], [10, 0])).toEqual([[6, 8], [10, 8], [10, 0]]);
    // same side: straight along it
    expect(perimeterPath(square, [2, 1], [7, 1])).toEqual([[2, 0], [7, 0]]);
  });
  it("finds the nearest corner", () => {
    expect(nearestCorner(square, [9, 1])).toEqual([10, 0]);
    // seen from the south-west: the north-east corner is at the back, take one in front
    expect(nearestCorner(square, [9, 1], [-0.7, 0.7])).toEqual([0, 0]);
  });
});
