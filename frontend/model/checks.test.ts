import { describe, expect, it } from "vitest";
import { piecesInWalls, unreachableRooms } from "./checks";
import { expandHouse } from "./expand";
import type { HouseInput } from "./types";
import { deriveWalls } from "./walls";

const issues = (input: HouseInput) => {
  const { house } = expandHouse(input);
  const walls = new Map(house!.levels.map((l) => [l.id, deriveWalls(l, house!.walls, [])]));
  return unreachableRooms(house!, walls).map((i) => i.message);
};
const two = (openings: HouseInput["levels"][number]["openings"]): HouseInput => ({
  schema: 1,
  id: "t",
  outline: { rect: [0, 0, 8, 4] },
  levels: [{ id: "g", rooms: [{ id: "a", rect: [0, 0, 4, 4] }, { id: "b", rect: [4, 0, 4, 4] }], openings }],
});

describe("can every room be reached", () => {
  it("needs an entrance", () => {
    expect(issues(two([{ room: "a", side: "east", at: 1.5, width: 0.9, type: "door" }]))).toEqual(["The house has no entrance: put a door on an outside wall (or onto a garden or terrace)."]);
  });
  it("finds a room without a way in", () => {
    expect(issues(two([{ room: "a", side: "north", at: 1, width: 1, type: "door" }]))).toEqual(["b can't be reached from an entrance: add a door (or open the wall) to a room next to it."]);
  });
  it("walks through doors (a window doesn't count)", () => {
    expect(issues(two([{ room: "a", side: "north", at: 1, width: 1, type: "door" }, { room: "a", side: "east", at: 1.5, width: 0.9, type: "door" }]))).toEqual([]);
    expect(issues(two([{ room: "a", side: "north", at: 1, width: 1, type: "door" }, { room: "a", side: "east", at: 1.5, width: 0.9, type: "window" }]))).toHaveLength(1);
  });
  it("goes up the stairs", () => {
    const house: HouseInput = {
      schema: 1,
      id: "t",
      outline: { rect: [0, 0, 6, 4] },
      vertical: [{ id: "s", rect: [4, 0, 2, 3], from: "g", to: "f" }],
      levels: [
        { id: "g", rooms: [{ id: "a", rect: [0, 0, 6, 4] }], openings: [{ room: "a", side: "north", at: 1, width: 1, type: "door" }] },
        { id: "f", rooms: [{ id: "up", rect: [0, 0, 6, 4] }] },
      ],
    };
    expect(issues(house)).toEqual([]);
  });
});

describe("pieces in walls", () => {
  const house = (y: number): HouseInput => ({
    schema: 1,
    id: "t",
    outline: { rect: [0, 0, 6, 4] },
    levels: [{ id: "g", rooms: [{ id: "a", rect: [0, 0, 6, 4], furniture: [{ type: "nightstand", at: [2, y] }] }] }],
  });
  const check = (input: HouseInput) => {
    const { house: h } = expandHouse(input);
    return piecesInWalls(h!, new Map(h!.levels.map((l) => [l.id, deriveWalls(l, h!.walls, [])])));
  };
  it("flags a piece placed from the outline, not from the wall's inside face", () => {
    expect(check(house(0.22))).toHaveLength(1);
    expect(check(house(0.6))).toEqual([]);
  });
});
