import { describe, expect, it } from "vitest";
import { expandHouse } from "./expand";
import { deriveWalls } from "./walls";
import { walkStep } from "./walk";

// two rooms side by side, a door between them in the middle of the shared wall
const { house } = expandHouse({
  schema: 1,
  id: "t",
  outline: { rect: [0, 0, 8, 4] },
  levels: [
    {
      id: "g",
      rooms: [
        { id: "a", rect: [0, 0, 4, 4] },
        { id: "b", rect: [4, 0, 4, 4] },
      ],
      openings: [{ room: "a", side: "east", at: 1.5, width: 1, type: "door" }],
    },
  ],
} as never);
const level = house!.levels[0];
const walls = deriveWalls(level, house!.walls, []);

describe("walking", () => {
  it("moves inside a room", () => {
    expect(walkStep(level, walls, [2, 2], [2.2, 2])).toEqual([2.2, 2]);
  });
  it("stops at walls", () => {
    expect(walkStep(level, walls, [3.6, 0.8], [3.8, 0.8])).toEqual([3.6, 0.8]);
    expect(walkStep(level, walls, [3.5, 0.8], [4.5, 0.8])).toEqual([3.5, 0.8]);
  });
  it("goes through the door", () => {
    expect(walkStep(level, walls, [3.6, 2], [3.9, 2])).toEqual([3.9, 2]);
    expect(walkStep(level, walls, [3.9, 2], [4.2, 2])).toEqual([4.2, 2]);
  });
  it("doesn't leave the house", () => {
    expect(walkStep(level, walls, [2, 0.3], [2, -0.3])).toEqual([2, 0.3]);
  });
});
