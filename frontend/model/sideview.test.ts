import { describe, expect, it } from "vitest";
import { expandHouse } from "./expand";
import { sideDrawing, sideLayout } from "./sideview";
import type { HouseInput } from "./types";

const house: HouseInput = {
  schema: 2,
  id: "rows",
  outline: { rect: [0, 0, 8, 10] },
  levels: [
    {
      id: "ground",
      rooms: [
        // a front row (south, y 6–10) and a back row (north, y 0–6)
        { id: "hall", rect: [0, 0, 3, 6] },
        { id: "kitchen", rect: [3, 0, 5, 6] },
        { id: "living", rect: [0, 6, 8, 4] },
      ],
    },
    // one room, the whole floor: one row
    { id: "first", rooms: [{ id: "loft", rect: [0, 0, 8, 10] }] },
  ],
};

describe("side view", () => {
  it("looking north: each floor in rows of rooms, side by side, all moved to the front", () => {
    const layout = sideLayout(expandHouse(house).house!, "north");
    // looking north, screen-right is east
    expect(layout.r).toEqual([1, 0]);
    const ground = layout.bands.filter((b) => b.levelId === "ground");
    expect(ground.map((b) => [b.from, b.to])).toEqual([
      [-10, -6],
      [-6, 0],
    ]);
    // the first row stays; the next stands to its right, moved forward to the front
    expect(ground[0].offset).toEqual([0, 0]);
    expect(ground[1].offset[0]).toBeGreaterThan(8);
    expect(ground[1].offset[1]).toBeCloseTo(4);
    expect(layout.bands.filter((b) => b.levelId === "first")).toHaveLength(1);
  });

  it("looking east: rows across the other way", () => {
    const layout = sideLayout(expandHouse(house).house!, "east");
    // the living room spans the hall and the kitchen along x: one row
    expect(layout.bands.filter((b) => b.levelId === "ground").map((b) => [b.from, b.to])).toEqual([[0, 8]]);
    expect(layout.r).toEqual([0, 1]);
  });
});

describe("side view drawing", () => {
  it("rooms side by side in their rows, walls and slabs as bars, the back wall's windows", async () => {
    const { deriveWalls } = await import("./walls");
    const { stairTreads } = await import("./stairs");
    const input: HouseInput = structuredClone(house);
    input.levels[0].openings = [{ room: "kitchen", side: "north", at: 1, width: 1.2 }];
    const h = expandHouse(input).house!;
    const walls = new Map(h.levels.map((l) => [l.id, deriveWalls(l, h.walls)]));
    const dr = sideDrawing(h, walls, sideLayout(h, "north"), stairTreads);
    expect(dr.rooms.map((r) => r.roomId).sort()).toEqual(["hall", "kitchen", "living", "loft"]);
    // the kitchen beside the hall, in the second column; the living room in the first
    const at = (id: string) => dr.rooms.find((r) => r.roomId === id)!;
    expect(at("living").x1).toBeLessThan(at("hall").x0);
    expect(at("kitchen").x0).toBeCloseTo(at("hall").x1);
    // the loft upstairs, over the ground floor
    expect(at("loft").y0).toBeGreaterThan(at("living").y1);
    // the kitchen's north window (in the back wall, seen from the south)
    expect(dr.openings).toHaveLength(1);
    expect(dr.openings[0].kind).toBe("window");
    expect(dr.bars.length).toBeGreaterThan(4);
  });
});
