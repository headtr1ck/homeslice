import { describe, expect, it } from "vitest";
import { expandHouse } from "./expand";
import { signedArea } from "./geometry";
import type { HouseInput } from "./types";
import { deriveWalls } from "./walls";

// A 10 × 8 m house with two rooms side by side and a shared wall on the west.
const twoRooms = (): HouseInput => ({
  schema: 1,
  id: "test",
  outline: { rect: [0, 0, 10, 8] },
  party_walls: ["west"],
  levels: [
    {
      id: "ground",
      rooms: [
        { id: "left", rect: [0, 0, 5, 8] },
        { id: "right", rect: [5, 0, 5, 8] },
      ],
      openings: [{ room: "right", side: "south", at: 1, width: 2 }],
    },
  ],
});

const expand = (input: HouseInput) => {
  const { house, issues } = expandHouse(input);
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return house!;
};

describe("expandHouse", () => {
  it("stacks levels and fills defaults", () => {
    const input = twoRooms();
    input.levels.push({ id: "first", height: 2.5, rooms: [{ id: "a", rect: [0, 0, 10, 8] }] });
    const house = expand(input);
    expect(house.levels.map((l) => l.elevation)).toEqual([0, 2.85]);
    expect(house.levels[1].outline).toEqual(house.levels[0].outline);
    expect(house.levels[0].openings[0]).toMatchObject({ type: "window", sill: 0.9, height: 1.3 });
  });

  it("resolves grid names and stores polygons positively oriented", () => {
    const input = twoRooms();
    input.grid = { x: { A: 0, B: 5 }, y: { "1": 0, "2": 8 } };
    input.levels[0].rooms[0] = { id: "left", polygon: [["A", "1"], ["A", "2"], ["B", "2"], ["B", "1"]] };
    const room = expand(input).levels[0].rooms[0];
    expect(signedArea(room.polygon)).toBeGreaterThan(0);
    expect(room.polygon).toContainEqual([5, 8]);
  });

  it("reports useful errors", () => {
    const input = twoRooms();
    input.levels[0].rooms.push({ id: "x", rect: ["C", 0, 1, 1] });
    input.levels[0].openings!.push({ room: "nope", side: "north", at: 0, width: 1 });
    const { house, issues } = expandHouse(input);
    expect(house).toBeNull();
    expect(issues.map((i) => i.message)).toEqual([
      'Unknown grid x axis "C"; no grid defined.',
      'Unknown room "nope" (rooms on this level: left, right, x).',
    ]);
  });
});

describe("deriveWalls", () => {
  const walls = () => {
    const house = expand(twoRooms());
    return deriveWalls(house.levels[0], house.walls);
  };

  it("classifies exterior, party and interior walls", () => {
    const w = walls();
    const count = (type: string) => w.filter((x) => x.type === type).length;
    // north and south are split where the rooms meet
    expect(count("exterior")).toBe(5);
    expect(count("party")).toBe(1);
    expect(count("interior")).toBe(1);
    const shared = w.find((x) => x.type === "interior")!;
    expect(shared.rooms).toEqual(["left", "right"]);
    expect(shared.thickness).toBe(0.12);
  });

  it("grows exterior walls inwards from the outline", () => {
    const north = walls().find((x) => x.side === "north" && x.rooms[0] === "left")!;
    expect(north.a[1]).toBeCloseTo(0.18);
    expect(north.line[0][1]).toBe(0);
  });

  it("places openings on the right wall by position", () => {
    const south = walls().find((x) => x.side === "south" && x.rooms[0] === "right")!;
    // the outline runs east → west along the south side, so x = 6..8 is 2..4 m from its start
    expect(south.openings).toHaveLength(1);
    expect(south.openings[0].start).toBeCloseTo(2);
    expect(south.openings[0].end).toBeCloseTo(4);
  });

  it("splits walls at T-junctions and snaps near-miss corners", () => {
    const input = twoRooms();
    // right side split into two rooms; one corner is 3 cm off the shared wall
    input.levels[0].rooms = [
      { id: "left", rect: [0, 0, 5, 8] },
      { id: "top", rect: [5.03, 0, 4.97, 4] },
      { id: "bottom", rect: [5, 4, 5, 4] },
    ];
    input.levels[0].openings = [];
    const house = expand(input);
    const w = deriveWalls(house.levels[0], house.walls);
    const interior = w.filter((x) => x.type === "interior");
    // left|top, left|bottom (split at y = 4), top|bottom
    expect(interior.map((x) => x.rooms.join("|")).sort()).toEqual(["bottom|left", "bottom|top", "left|top"]);
  });

  it("warns about openings without a wall", () => {
    const input = twoRooms();
    input.levels[0].openings = [{ room: "left", side: "east", at: 9, width: 1 }];
    const house = expand(input);
    const issues: { message: string }[] = [];
    deriveWalls(house.levels[0], house.walls, issues as never);
    expect(issues[0].message).toBe('Room "left" has no east side at 9 m.');
  });
});
