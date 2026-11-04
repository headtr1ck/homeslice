import { describe, expect, it } from "vitest";
import { expandHouse } from "../model/expand";
import { planOnOuterFaces, planToHouse } from "./planjson";

/** A two-floor plan in the other cards' export format: rooms on the walls' centre lines inside. */
const plan = {
  format: "export",
  version: 1,
  building: {
    version: 1,
    settings: { wall_exterior: 0.24, wall_interior: 0.12, roof: { type: "gable", pitch: 35 } },
    floors: [
      {
        id: "f0",
        name: "Ground floor",
        elevation: 0,
        height: 2.5,
        ha_floor: "ground_floor",
        rooms: [
          // north, east (open to the kitchen), south, west
          { id: "r1", name: "Living room", area_id: "living_room", points: [[0, 0], [5, 0], [5, 4], [0, 4]], floor_material: "oak", wall_heights: [null, 0, null, null] },
          { id: "r2", name: "Kitchen", area_id: "kitchen", points: [[5, 0], [8, 0], [8, 4], [5, 4]], floor_material: "tiles" },
        ],
        openings: [
          { id: "o1", room_id: "r1", edge: 2, offset: 2.5, type: "door", width: 0.9, height: 2.05, sill: 0, hinge: "left", leaves: 1, swing: "in", style: "front", lock: "lock.front", cover: null },
          { id: "o2", room_id: "r2", edge: 0, offset: 1.5, type: "window", width: 1.2, height: 1.3, sill: 0.9, leaves: 2, cover: "cover.kitchen", contact: "none" },
        ],
        furniture: [
          { id: "f1", type: "sofa", x: 2.5, z: 3, rotation: 180, w: 2.2, d: 0.9, h: 0.8, entity: null },
          { id: "f2", type: "lamp_pendant", x: 6.5, z: 2, rotation: 0, w: 0.4, d: 0.4, h: 0.4, entity: "light.kitchen" },
          { id: "f3", type: "stairs", x: 7, z: 3, rotation: 0, w: 1, d: 2, h: 2.75 },
        ],
        placements: [{ entity_id: "camera.living", x: 0.5, z: 0.5, rotation: 315, fov: 90, reach: 6, mount: "wall" }],
        outdoor: [],
      },
      { id: "f1", name: "First floor", elevation: 2.75, height: 2.5, rooms: [{ id: "r3", name: "Bedroom", points: [[0, 0], [8, 0], [8, 4], [0, 4]], floor_material: "carpet" }], openings: [], furniture: [], placements: [], outdoor: [] },
    ],
  },
};

describe("plans from other 3D floor-plan cards", () => {
  it("rooms grow to the outer face, open walls, doors on their edge, lamps, cameras, stairs", () => {
    const { house, skipped } = planOnOuterFaces(JSON.stringify(plan));
    expect(skipped).toEqual([]);
    const [ground, first] = house.levels;
    expect(ground).toMatchObject({ id: "ground_floor", floor_id: "ground_floor", height: 2.5 });
    const [living, kitchen] = ground.rooms;
    // outside edges out by 24 cm, the shared one stays: 0…5.24 wide
    const xs = living.polygon!.map((p) => Number(p[0]));
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 5.24]);
    expect(living).toMatchObject({ area_id: "living_room", floor: "oak_herringbone" });
    expect(ground.walls).toEqual([{ between: [living.id, kitchen.id] }]);
    // the door's middle at 2.5 + 0.24: it starts 0.45 earlier, on the south side
    expect(ground.openings![0]).toMatchObject({ room: living.id, side: "south", at: 2.29, width: 0.9, type: "door", style: "entrance_strip", lock: "lock.front" });
    expect(ground.openings![1]).toMatchObject({ room: kitchen.id, side: "north", type: "window", style: "double", cover: "cover.kitchen" });
    expect(ground.openings![1].contact).toBeUndefined();
    expect(living.furniture![0]).toMatchObject({ type: "sofa", rotation: 180, size: [2.2, 0.9] });
    expect(kitchen.lights).toEqual([{ entity: "light.kitchen", at: [1.5, 2.24] }]);
    expect(living.cameras![0]).toMatchObject({ entity: "camera.living", direction: 135, fov: 90, range: 6 });
    expect(house.vertical).toEqual([{ id: "stairs_1", rect: [6.74, 2.24, 1, 2], from: "ground_floor", to: "first_floor", shape: "straight", up: "north" }]);
    expect(first.rooms[0].floor).toBe("carpet");
    expect(house.roof).toEqual({ shape: "gable", pitch: 35 });
    // put on the walls' centre lines, a house Homeslice takes as it is
    const imported = planToHouse(JSON.stringify(plan)).house;
    expect(imported.schema).toBe(2);
    expect(expandHouse(imported).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reads the simple format, in centimetres", () => {
    const simple = {
      format: "simple",
      units: "cm",
      floors: [{ name: "Flat", elevation: 0, height: 250, rooms: [{ name: "Room", points: [[0, 0], [400, 0], [400, 300], [0, 300]] }], doors: [{ at: [200, 300], width: 90 }], windows: [{ at: [0, 150], width: 100, sill: 90 }], furniture: [{ type: "bed", at: [200, 150], width: 160, depth: 200 }] }],
    };
    const { house } = planToHouse(JSON.stringify(simple));
    const room = house.levels[0].rooms[0];
    expect(room.furniture![0]).toMatchObject({ type: "bed", size: [1.6, 2] });
    expect(house.levels[0].openings!.map((o) => `${o.type}:${o.side}`)).toEqual(["door:south", "window:west"]);
    expect(expandHouse(house).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("explains a file that is no plan", () => {
    expect(() => planToHouse("{}")).toThrow(/No floors/);
    expect(() => planToHouse("nope")).toThrow(/Not a JSON/);
  });
});
