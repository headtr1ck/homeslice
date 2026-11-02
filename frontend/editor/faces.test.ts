import { describe, expect, it } from "vitest";
import { signedArea } from "../model/geometry";
import type { Vec2 } from "../model/types";
import { closedFaces, faceAt } from "./faces";

const area = (p: Vec2[]) => Math.round(Math.abs(signedArea(p)) * 100) / 100;

describe("closedFaces", () => {
  it("four walls drawn one after the other close a room; a loose wall closes nothing", () => {
    const walls: [Vec2, Vec2][] = [
      [[0, 0], [4, 0]],
      [[4, 0], [4, 3]],
      [[4, 3], [0, 3]],
      [[0, 3], [0, 0]],
      [[5, 0], [7, 0]],
    ];
    const faces = closedFaces(walls);
    expect(faces.map(area)).toEqual([12]);
  });

  it("a wall across a closed shape makes two; walls overshooting their corners still close", () => {
    const walls: [Vec2, Vec2][] = [
      [[-0.2, 0], [6.3, 0]],
      [[6, -0.1], [6, 4.2]],
      [[6.2, 4], [0, 4]],
      [[0, 4.1], [0, -0.3]],
      [[2, 0], [2, 4]],
    ];
    const faces = closedFaces(walls);
    expect(faces.map(area).sort()).toEqual([16, 8]);
    expect(area(faceAt(faces, [1, 1])!)).toBe(8);
    expect(area(faceAt(faces, [3, 1])!)).toBe(16);
    expect(faceAt(faces, [7, 1])).toBeNull();
  });

  it("an L-shape, and a T-junction on a wall's middle", () => {
    const walls: [Vec2, Vec2][] = [
      [[0, 0], [4, 0]],
      [[4, 0], [4, 2]],
      [[4, 2], [2, 2]],
      [[2, 2], [2, 4]],
      [[2, 4], [0, 4]],
      [[0, 4], [0, 0]],
      // a stub into the L: it closes nothing more
      [[1, 0], [1, 1]],
    ];
    expect(closedFaces(walls).map(area)).toEqual([12]);
  });

  it("walls stopping a little short of another, or ending on its middle, still close the shape", () => {
    const walls: [Vec2, Vec2][] = [
      [[0, 0], [4, 0]],
      [[4, 0], [4, 3]],
      [[4, 3], [0, 3]],
      [[0, 3], [0, 0]],
      // across the middle, 3 cm short at the top and 2 cm past the bottom
      [[2, 0.03], [2, 3.02]],
    ];
    expect(closedFaces(walls).map(area).sort()).toEqual([6, 6]);
    // 10 cm short is a gap, not a wall meeting another
    expect(closedFaces([...walls.slice(0, 4), [[2, 0.1], [2, 3]]]).map(area)).toEqual([12]);
  });
});
