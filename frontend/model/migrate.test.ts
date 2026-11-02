import { describe, expect, it } from "vitest";
import { expandHouse } from "./expand";
import { migrateHouse } from "./migrate";
import type { HouseInput, Vec2 } from "./types";
import { deriveWalls, innerPolygon } from "./walls";

const r2 = (pts: Vec2[]) => pts.map((p) => p.map((v) => Math.round(v * 100) / 100));

// a schema 1 file: the outline on the walls' outer face, rooms along the outside reaching it
const old = (): HouseInput => ({
  schema: 1,
  id: "old",
  outline: { rect: [0, 0, 10, 8] },
  party_walls: ["west"],
  facade_openings: [{ side: "south", at: 6, width: 1.2, levels: ["g"] }],
  levels: [
    {
      id: "g",
      rooms: [
        { id: "left", rect: [0, 0, 5, 8], furniture: [{ type: "sofa", at: [1, 1] }] },
        { id: "right", rect: [5, 0, 5, 8] },
        { id: "garden", kind: "outdoor", rect: [0, 8, 10, 5] },
      ],
      openings: [{ room: "left", side: "north", at: 1, width: 1 }],
    },
  ],
});

const inside = (h: HouseInput, room: string) => {
  const { house } = expandHouse(h);
  const level = house!.levels[0];
  return r2(innerPolygon(level.rooms.find((r) => r.id === room)!.polygon, deriveWalls(level, house!.walls)));
};

describe("schema 1 → 2", () => {
  it("moves the outline and the rooms on it in by half their walls; the house stays where it stood", () => {
    const m = migrateHouse(old());
    expect(m.schema).toBe(2);
    // party wall west (0.24), exterior elsewhere (0.36)
    expect(m.outline).toEqual({ rect: [0.12, 0.18, 9.7, 7.64] });
    const rooms = Object.fromEntries(m.levels[0].rooms.map((r) => [r.id, r]));
    expect(rooms.left.rect).toEqual([0.12, 0.18, 4.88, 7.64]);
    expect(rooms.right.rect).toEqual([5, 0.18, 4.82, 7.64]);
    // the garden outside stays
    expect(rooms.garden.rect).toEqual([0, 8, 10, 5]);
    // measured from the room's or the outline's corner: kept in place
    expect(rooms.left.furniture![0].at).toEqual([0.88, 0.82]);
    expect(m.levels[0].openings![0].at).toBe(0.88);
    expect(m.facade_openings![0].at).toBe(5.88);
    // the floors inside the walls are what they were (the old rule gave these)
    expect(inside(m, "left")).toEqual([[0.24, 0.36], [4.94, 0.36], [4.94, 7.64], [0.24, 7.64]]);
    // read as it is, an old file gives the same
    expect(inside(old(), "left")).toEqual(inside(m, "left"));
  });

  it("steps a room side where the outside wall turns into an inside one (an inner corner of the outline)", () => {
    const h: HouseInput = {
      schema: 1,
      id: "l",
      outline: { polygon: [[0, 0], [14, 0], [14, 6], [11, 6], [11, 8], [0, 8]] },
      levels: [
        {
          id: "g",
          rooms: [
            { id: "north", rect: [0, 0, 14, 4] },
            { id: "living", rect: [0, 4, 11, 4] },
            { id: "study", rect: [11, 4, 3, 2] },
          ],
        },
      ],
    };
    const m = migrateHouse(h);
    const rooms = Object.fromEntries(m.levels[0].rooms.map((r) => [r.id, r]));
    // the living room's east side: the inside wall to the study, then the outside wall
    expect(rooms.living.polygon).toEqual([[0.18, 4], [11, 4], [11, 5.82], [10.82, 5.82], [10.82, 7.82], [0.18, 7.82]]);
    expect(rooms.study.rect).toEqual([11, 4, 2.82, 1.82]);
    expect(m.outline).toEqual({ polygon: [[0.18, 0.18], [13.82, 0.18], [13.82, 5.82], [10.82, 5.82], [10.82, 7.82], [0.18, 7.82]] });
  });

  it("moves a side that starts on the outside wall and leans off it a little (a slip) with it", () => {
    const h: HouseInput = {
      schema: 1,
      id: "s",
      outline: { rect: [0, 0, 5, 10] },
      levels: [{ id: "g", rooms: [{ id: "a", polygon: [[0, 0], [5, 0], [4.9, 5], [0, 5]] }, { id: "b", polygon: [[0, 5], [4.9, 5], [5, 10], [0, 10]] }] }],
    };
    const rooms = migrateHouse(h).levels[0].rooms;
    // in by half the wall like the outline, the lean kept; both rooms alike
    expect(rooms[0].polygon).toEqual([[0.18, 0.18], [4.816, 0.18], [4.72, 5], [0.18, 5]]);
    expect(rooms[1].polygon).toEqual([[0.18, 5], [4.72, 5], [4.816, 9.82], [0.18, 9.82]]);
  });

  it("follows the rooms of an auto outline; leaves a current or broken file as it is", () => {
    const h: HouseInput = { schema: 1, id: "a", outline: "auto", levels: [{ id: "g", rooms: [{ id: "r", rect: [0, 0, 4, 3] }] }] };
    expect(migrateHouse(h).levels[0].rooms[0].rect).toEqual([0.18, 0.18, 3.64, 2.64]);
    const now = { ...old(), schema: 2 } as HouseInput;
    expect(migrateHouse(now)).toBe(now);
    const broken = { schema: 1, id: "x", levels: [{ id: "g", outline: { rect: ["nope", 0, 1, 1] }, rooms: [] }] } as unknown as HouseInput;
    expect(migrateHouse(broken)).toBe(broken);
  });
});
