import { describe, expect, it } from "vitest";
import type { Vec2 } from "../model/types";
import { outlineOf } from "./outline";

const rect = (x: number, y: number, w: number, d: number): Vec2[] => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const corners = (p: Vec2[] | null) => (p ?? []).map((v) => v.join(",")).sort();

describe("outline of rooms", () => {
  it("one room: its own corners", () => {
    expect(corners(outlineOf([rect(0, 0, 4, 3)]))).toEqual(corners(rect(0, 0, 4, 3)));
  });

  it("an L of two rooms sharing part of an edge", () => {
    const out = outlineOf([rect(0, 0, 6, 4), rect(0, 4, 3, 3)]);
    expect(corners(out)).toEqual(corners([[0, 0], [6, 0], [6, 4], [3, 4], [3, 7], [0, 7]]));
  });

  it("rooms in a row with a room inside another: the outer boundary only", () => {
    const out = outlineOf([rect(0, 0, 4, 4), rect(4, 0, 4, 4), rect(8, 0, 2, 4), rect(1, 1, 1, 1)]);
    expect(corners(out)).toEqual(corners(rect(0, 0, 10, 4)));
  });

  it("nothing to outline", () => {
    expect(outlineOf([])).toBeNull();
  });
});
