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

  it("applies house-wide opening defaults, overridable per opening", () => {
    const input = twoRooms();
    input.opening_defaults = { window: { sill: 0, height: 2.2 } };
    input.levels[0].openings!.push({ room: "left", side: "north", at: 1, width: 1, sill: 0.9 });
    const [floorLength, bath] = expand(input).levels[0].openings;
    expect(floorLength).toMatchObject({ sill: 0, height: 2.2 });
    expect(bath).toMatchObject({ sill: 0.9, height: 2.2 });
  });

  it("repeats façade openings on every level, in the room behind them", () => {
    const input = twoRooms();
    input.levels.push({ id: "first", rooms: [{ id: "a", rect: [0, 0, 3, 8] }, { id: "b", rect: [3, 0, 7, 8] }] });
    input.facade_openings = [
      { id: "s1", side: "south", at: 6, width: 1.5, levels: ["ground", "first"], covers: { first: "cover.b" } },
      { id: "x", side: "south", at: 9.5, width: 1, levels: ["nope"] },
    ];
    const { house, issues } = expandHouse(input);
    expect(issues.map((i) => i.message)).toEqual(['Unknown level "nope" (levels: ground, first).']);
    expect(house).toBeNull();
    input.facade_openings.pop();
    const h = expand(input);
    expect(h.levels[0].openings.at(-1)).toMatchObject({ id: "s1_ground", room: "right", at: 1, cover: undefined });
    expect(h.levels[1].openings.at(-1)).toMatchObject({ id: "s1_first", room: "b", at: 3, cover: "cover.b" });
    const walls = deriveWalls(h.levels[1], h.walls);
    const south = walls.find((w) => w.side === "south" && w.rooms[0] === "b")!;
    expect(south.openings[0].start).toBeCloseTo(2.5);
  });

  it("keeps façade openings aligned when a level sticks out", () => {
    const input = twoRooms();
    // the first floor overhangs 0.5 m to the north
    input.levels.push({ id: "first", outline: { rect: [0, -0.5, 10, 8.5] }, rooms: [{ id: "a", rect: [0, -0.5, 10, 8.5] }] });
    input.facade_openings = [{ id: "w", side: "west", at: 2, width: 1, levels: ["ground", "first"] }];
    const h = expand(input);
    const y = (level: number) => {
      const o = h.levels[level].openings.at(-1)!;
      const room = h.levels[level].rooms.find((r) => r.id === o.room)!;
      return Math.min(...room.polygon.map((p) => p[1])) + o.at;
    };
    expect(y(0)).toBeCloseTo(2);
    expect(y(1)).toBeCloseTo(2);
  });

  it("expands stair shapes with sensible defaults and checks directions", () => {
    const input = twoRooms();
    input.levels.push({ id: "first", rooms: [{ id: "a", rect: [0, 0, 10, 8] }] });
    input.vertical = [
      { id: "s", rect: [6, 3, 3, 2], from: "ground", to: "first" },
      { id: "u", rect: [1, 1, 3, 2], from: "ground", to: "first", shape: "u_turn", up: "west", start: "north" },
    ];
    const v = expand(input).vertical;
    expect(v[0]).toMatchObject({ shape: "straight", up: "east", start: "south" });
    expect(v[1]).toMatchObject({ shape: "u_turn", up: "west", start: "north" });
    input.vertical = [{ id: "bad", rect: [1, 1, 3, 2], from: "ground", to: "first", shape: "u_turn", up: "east", start: "west" }];
    expect(expandHouse(input).issues[0].message).toBe('start must be north or south for a stair climbing east, got "west".');
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

  it("opens a boundary between two rooms, all of it or one side", () => {
    // left (0–5) | right (5–10) over the full depth, plus a small room in the right's corner
    const input = twoRooms();
    input.levels[0].rooms = [
      { id: "living", polygon: [[0, 0], [10, 0], [10, 5], [6, 5], [6, 8], [0, 8]] },
      { id: "kitchen", rect: [6, 5, 4, 3] },
    ];
    input.levels[0].openings = [];
    const between = (walls: { rooms: string[]; type: string }[]) =>
      walls.filter((w) => w.rooms.join("|") === "kitchen|living").map((w) => w.type).sort();

    let h = expand(input);
    expect(between(deriveWalls(h.levels[0], h.walls))).toEqual(["interior", "interior"]);

    input.levels[0].walls = [{ between: ["kitchen", "living"], side: "west" }];
    h = expand(input);
    expect(between(deriveWalls(h.levels[0], h.walls))).toEqual(["interior", "open"]);
    const open = deriveWalls(h.levels[0], h.walls).find((w) => w.type === "open")!;
    expect(open.line.map((p) => p[0])).toEqual([6, 6]); // the west side of the kitchen

    input.levels[0].walls = [{ between: ["living", "kitchen"] }];
    h = expand(input);
    expect(between(deriveWalls(h.levels[0], h.walls))).toEqual(["open", "open"]);
  });

  it("adds free-standing walls and checks wall entries", () => {
    const input = twoRooms();
    input.levels[0].walls = [{ line: [[1, 2], [3, 2]], thickness: 0.1 }];
    const h = expand(input);
    const free = deriveWalls(h.levels[0], h.walls).find((w) => w.id.includes("free"))!;
    expect(free).toMatchObject({ a: [1, 2], b: [3, 2], thickness: 0.1, type: "interior" });
    input.levels[0].walls = [{ between: ["left", "nope"] }, {}];
    expect(expandHouse(input).issues.map((i) => i.message)).toEqual([
      "between needs two rooms of this level (unknown: nope; rooms: left, right).",
      "A wall entry needs between: [room, room] or line: [[x, y], [x, y]].",
    ]);
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

describe("labelPoint", () => {
  it("stays inside L-shaped rooms", async () => {
    const { labelPoint, pointInPolygon, edgeDistance } = await import("./geometry");
    const l: [number, number][] = [[0, 0], [6, 0], [6, 1], [1, 1], [1, 6], [0, 6]];
    const p = labelPoint(l);
    expect(pointInPolygon(p, l)).toBe(true);
    expect(edgeDistance(p, l)).toBeGreaterThan(0.4);
  });
});
