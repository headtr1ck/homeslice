import { describe, expect, it } from "vitest";
import { expandHouse } from "./expand";
import { bbox, signedArea } from "./geometry";
import { misalignedWalls } from "./checks";
import { placeLights } from "./lights";
import { stairHole } from "./stairs";
import type { HouseInput, Room } from "./types";
import { deriveWalls, type Wall } from "./walls";

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
    expect(v[0].entry).toBe(0);
    input.vertical = [{ id: "e", rect: [1, 1, 3, 2], from: "ground", to: "first", up: "east", entry: 2.8 }];
    expect(expandHouse(input).issues[0].message).toBe("entry must be between 0 and 2.50 m (the stairwell is 3.00 m long), got 2.8.");
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

  it("fills inner corners of the outline and L-corners of inside walls", () => {
    // L-shaped outline: the corner at (5, 4) is an inner corner
    const input: HouseInput = {
      schema: 1,
      id: "l",
      outline: { polygon: [[0, 0], [5, 0], [5, 4], [10, 4], [10, 8], [0, 8]] },
      levels: [
        {
          id: "g",
          rooms: [
            { id: "a", polygon: [[0, 0], [5, 0], [5, 4], [3, 4], [3, 6], [0, 6]] },
            { id: "b", polygon: [[3, 4], [10, 4], [10, 8], [0, 8], [0, 6], [3, 6]] },
          ],
        },
      ],
    };
    const h = expand(input);
    const w = deriveWalls(h.levels[0], h.walls);
    const at = (p: [number, number]) => w.filter((x) => x.line.some((q) => q[0] === p[0] && q[1] === p[1]));
    // outer walls meeting at the inner corner (5, 4) reach the other wall's thickness past it
    for (const x of at([5, 4]).filter((x) => x.type === "exterior")) {
      const end = x.line[0][0] === 5 && x.line[0][1] === 4 ? x.extendStart : x.extendEnd;
      expect(end).toBeCloseTo(0.36);
    }
    // the inside walls' L-corner at (3, 6) is filled by half a wall thickness
    const inner = at([3, 6]).filter((x) => x.type === "interior");
    expect(inner).toHaveLength(2);
    for (const x of inner) expect(Math.max(x.extendStart, x.extendEnd)).toBeCloseTo(0.06);
    // outer corners need nothing
    expect(at([10, 8]).every((x) => x.extendStart === 0 && x.extendEnd === 0)).toBe(true);

    // a thin party wall meeting a thick outer wall: each reaches exactly the other's inside face
    input.levels[0].party_walls = ["east"];
    const h2 = expand(input);
    const w2 = deriveWalls(h2.levels[0], h2.walls);
    const ext = (x: Wall) => (x.line[0][0] === 5 && x.line[0][1] === 4 ? x.extendStart : x.extendEnd);
    const atCorner = w2.filter((x) => x.line.some((q) => q[0] === 5 && q[1] === 4) && x.type !== "interior");
    const party = atCorner.find((x) => x.type === "party")!; // the wall along x = 5 faces east
    const outer = atCorner.find((x) => x.type === "exterior")!;
    expect(ext(party)).toBeCloseTo(0.36);
    expect(ext(outer)).toBeCloseTo(0.24);
  });

  it("measures rooms to the inside of their walls", async () => {
    const { innerPolygon } = await import("./walls");
    const { signedArea } = await import("./geometry");
    const h = expand(twoRooms());
    const w = deriveWalls(h.levels[0], h.walls);
    const left = innerPolygon(h.levels[0].rooms[0].polygon, w);
    // west: party wall 0.24; north/south: exterior 0.36; east: half the 0.12 inside wall
    expect(left.map((p) => p.map((v) => Math.round(v * 100) / 100))).toEqual([[0.24, 0.36], [4.94, 0.36], [4.94, 7.64], [0.24, 7.64]]);
    expect(Math.abs(signedArea(left))).toBeCloseTo(4.7 * 7.28);
  });

  it("steps the inside face where a room edge runs along walls of different thickness", async () => {
    const { innerPolygon } = await import("./walls");
    // like the basement: the technical room's east edge is a party wall, then an inside
    // wall to the corridor
    const input: HouseInput = {
      schema: 1,
      id: "b",
      outline: { polygon: [[0, 0], [2.5, 0], [2.5, 5.35], [5.5, 5.35], [5.5, 7.5], [0, 7.5]] },
      party_walls: ["east"],
      levels: [
        {
          id: "b",
          rooms: [
            { id: "technical", rect: [0, 0, 2.5, 7.5] },
            { id: "corridor", rect: [2.5, 5.35, 3, 2.15] },
          ],
        },
      ],
    };
    const h = expand(input);
    const inner = innerPolygon(h.levels[0].rooms[0].polygon, deriveWalls(h.levels[0], h.walls));
    const r = inner.map((p) => p.map((v) => Math.round(v * 100) / 100));
    // the east side steps from the party wall (0.24) to half the inside wall (0.06)
    expect(r).toContainEqual([2.26, 5.35]);
    expect(r).toContainEqual([2.44, 5.35]);
    expect(r).toContainEqual([2.44, 7.14]);
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

describe("stairs", () => {
  it("keeps the floor in front of the first step when a stair starts further in", () => {
    const v = { id: "s", kind: "stairs", polygon: [[0, 0], [3, 0], [3, 2], [0, 2]], from: 0, to: 1, shape: "u_turn", up: "east", start: "south", entry: 1 } as const;
    const hole = stairHole({ ...v, polygon: v.polygon.map((p) => [...p] as [number, number]) });
    // the first flight runs along the south side (y 1–2) and starts at x 1
    expect(hole).toHaveLength(6);
    expect(hole).toContainEqual([1, 2]);
    expect(hole).toContainEqual([1, 1]);
    expect(hole).toContainEqual([0, 1]);
  });
});

describe("lights", () => {
  const room = (lights: Room["lights"] = []): Room => ({ id: "r", kind: "room", floor: "wood", polygon: [[0, 0], [4, 0], [4, 2], [0, 2]], lights, furniture: [] });
  it("spreads the area's lights and keeps placed ones", () => {
    const placed = placeLights("g", room([{ entity: "light.a", at: [1, 1], hidden: false }]), room().polygon, ["light.a", "light.b", "light.c"], new Set(["light.a"]));
    expect(placed).toEqual([
      { levelId: "g", roomId: "r", entity: "light.a", at: [1, 1], auto: false },
      { levelId: "g", roomId: "r", entity: "light.b", at: [1, 1], auto: true },
      { levelId: "g", roomId: "r", entity: "light.c", at: [3, 1], auto: true },
    ]);
  });
  it("leaves out hidden lights and lights placed in another room", () => {
    const placed = placeLights("g", room([{ entity: "light.a", hidden: true }]), room().polygon, ["light.a", "light.b"], new Set(["light.a", "light.b"]));
    expect(placed).toEqual([]);
  });
  it("expands at relative to the room's north-west corner", () => {
    const input = twoRooms();
    input.levels[0].rooms[1].lights = [{ entity: "light.x", at: [1, 2] }];
    const r = expand(input).levels[0].rooms[1];
    const { min } = bbox(r.polygon);
    expect(r.lights[0].at).toEqual([min[0] + 1, min[1] + 2]);
    input.levels[0].rooms[1].lights = [{ entity: "switch.x" }];
    expect(expandHouse(input).issues[0].message).toContain("A light needs entity: light.");
  });
});

describe("documentation", () => {
  it("the README's example house is valid", async () => {
    const { readFileSync } = await import("node:fs");
    const { parse } = await import("yaml");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const block = readme.split("## House format")[1].split("```yaml")[1].split("```")[0];
    const { house, issues } = expandHouse(parse(block));
    expect(issues).toEqual([]);
    expect(house?.levels.map((l) => l.id)).toEqual(["ground", "first"]);
  });
});

describe("checks", () => {
  it("flags walls almost on top of a wall below", () => {
    const input = twoRooms();
    input.levels.push({ id: "first", rooms: [{ id: "x", rect: [0, 0, 4.92, 8] }, { id: "y", rect: [4.92, 0, 5.08, 8] }] });
    const { house } = expandHouse(input);
    const walls = new Map(house!.levels.map((l) => [l.id, deriveWalls(l, house!.walls, [])]));
    const issues = misalignedWalls(house!, walls);
    const cm = issues.map((i) => i.message.match(/(\d+) cm/)?.[1]);
    expect(cm).toContain("8");
    // exactly on top: nothing to say
    input.levels[1].rooms = [{ id: "x", rect: [0, 0, 5, 8] }, { id: "y", rect: [5, 0, 5, 8] }];
    const h2 = expandHouse(input).house!;
    expect(misalignedWalls(h2, new Map(h2.levels.map((l) => [l.id, deriveWalls(l, h2.walls, [])])))).toEqual([]);
  });
});

describe("energy connections", () => {
  const base = (energy: unknown[]) => ({ schema: 1, id: "e", outline: { rect: [0, 0, 6, 6] }, levels: [{ id: "g", rooms: [{ id: "r", rect: [0, 0, 6, 6] }] }], energy });
  it("ids come from names or kinds; flows go to the hub unless connected elsewhere", () => {
    const { house, issues } = expandHouse(
      base([
        { kind: "solar" },
        { kind: "battery", level: "g", at: [1, 1] },
        { kind: "grid", level: "g", at: [2, 1] },
        { kind: "device", name: "Heat pump", power: "sensor.hp", level: "g", at: [3, 1] },
        { kind: "device", name: "Wallbox", power: "sensor.wb", level: "g", at: [4, 1], to: "grid" },
      ]),
    );
    expect(issues).toEqual([]);
    expect(house!.energy.map((e) => e.id)).toEqual(["solar", "battery", "grid", "heat_pump", "wallbox"]);
    // the battery is the hub (no inverter); the wallbox hangs off the grid
    expect(house!.energy.map((e) => e.to)).toEqual([1, null, 1, 1, 2]);
  });
  it("explains an unknown connection", () => {
    const { issues } = expandHouse(base([{ kind: "grid", level: "g", at: [1, 1], to: "inverter" }]));
    expect(issues[0].message).toContain("to must be the id of another energy item");
  });
});

describe("furniture", () => {
  it("can be mirrored", () => {
    const { house } = expandHouse({ schema: 1, id: "m", outline: { rect: [0, 0, 5, 5] }, levels: [{ id: "g", rooms: [{ id: "r", rect: [0, 0, 5, 5], furniture: [{ type: "sofa_corner", at: [2, 2], mirror: true }, { type: "sofa", at: [1, 1] }] }] }] });
    expect(house!.levels[0].rooms[0].furniture.map((f) => f.mirror)).toEqual([true, false]);
  });
});

describe("furniture linked to entities", () => {
  it("a floor lamp's light is where the lamp stands, and moves with it", () => {
    const input = (at: [number, number]) => ({ schema: 1, id: "f", outline: { rect: [0, 0, 5, 5] }, levels: [{ id: "g", rooms: [{ id: "r", rect: [0, 0, 5, 5], lights: [{ entity: "light.lamp", at: [1, 1] }], furniture: [{ type: "floor_lamp", at, entity: "light.lamp" }, { type: "tv", at: [2, 4], entity: "media_player.tv" }] }] }] });
    const room = expandHouse(input([4, 1])).house!.levels[0].rooms[0];
    expect(room.lights).toEqual([{ entity: "light.lamp", at: [4, 1], hidden: false, piece: true }]);
    expect(room.furniture.map((f) => f.entity)).toEqual(["light.lamp", "media_player.tv"]);
    expect(expandHouse(input([2, 3])).house!.levels[0].rooms[0].lights[0].at).toEqual([2, 3]);
  });
});
