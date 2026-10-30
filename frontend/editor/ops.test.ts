import { describe, expect, it } from "vitest";
import type { HouseInput } from "../model/types";
import {
  History,
  addOpening,
  addRoom,
  deleteOpening,
  readOpening,
  updateOpening,
  area,
  cornerAngle,
  deleteRoom,
  moveEdge,
  moveLevel,
  moveVertex,
  moveWallPiece,
  removeVertex,
  openSides,
  roomPolygon,
  setBoundaryOpen,
  setOwnOutline,
  snap,
  splitEdge,
  updateRoom,
  addLevel,
  deleteLevel,
  newHouse,
  addEnergy,
  updateEnergy,
  deleteEnergy,
  setRoof,
  placeLight,
  setLightHidden,
  removeLight,
  addStairs,
  updateStairs,
  deleteStairs,
  stairsRect,
  setStairsRect,
  layoutRooms,
  slug,
  uniqueId,
  updateLevel,
} from "./ops";

// left | right, sharing the wall at x = 5
const house = (): HouseInput => ({
  schema: 1,
  id: "t",
  outline: { rect: [0, 0, 10, 8] },
  levels: [
    {
      id: "g",
      rooms: [
        { id: "left", rect: [0, 0, 5, 8] },
        { id: "right", rect: [5, 0, 5, 8] },
      ],
      openings: [{ room: "right", side: "south", at: 1, width: 1 }],
    },
  ],
});

const rooms = (m: HouseInput) => Object.fromEntries(m.levels[0].rooms.map((r) => [r.id, r]));

describe("editing operations", () => {
  it("moving a shared wall moves both rooms and keeps rects", () => {
    const m = house();
    const out = moveEdge(m, "g", [5, 0], [5, 8], [0.5, 0]);
    expect(rooms(out).left.rect).toEqual([0, 0, 5.5, 8]);
    expect(rooms(out).right.rect).toEqual([5.5, 0, 4.5, 8]);
    expect(rooms(m).left.rect).toEqual([0, 0, 5, 8]); // input untouched
  });

  it("moving a shared corner turns rects into polygons for every room at that corner", () => {
    const out = moveVertex(house(), "g", [5, 8], [6, 8]);
    expect(rooms(out).left.polygon).toContainEqual([6, 8]);
    expect(rooms(out).right.polygon).toContainEqual([6, 8]);
  });

  it("moves T-junction corners lying on the moved wall", () => {
    const m = house();
    m.levels[0].rooms = [
      { id: "big", rect: [0, 0, 5, 8] },
      { id: "top", rect: [5, 0, 5, 4] },
      { id: "bottom", rect: [5, 4, 5, 4] },
    ];
    const out = moveEdge(m, "g", [5, 0], [5, 8], [1, 0]);
    expect(rooms(out).top.rect).toEqual([6, 0, 4, 4]);
    expect(rooms(out).bottom.rect).toEqual([6, 4, 4, 4]);
  });

  it("moving part of an outside wall moves the whole façade on every level sharing the outline", () => {
    const m = house();
    m.levels.push({ id: "f", rooms: [{ id: "up", rect: [0, 0, 10, 8] }] });
    // drag only the right room's south edge (a part of the south façade)
    const out = moveEdge(m, "g", [10, 8], [5, 8], [0, 1]);
    expect(out.outline).toEqual({ rect: [0, 0, 10, 9] });
    expect(rooms(out).left.rect).toEqual([0, 0, 5, 9]);
    expect(rooms(out).right.rect).toEqual([5, 0, 5, 9]);
    expect(out.levels[1].rooms[0].rect).toEqual([0, 0, 10, 9]);
  });

  it("a level with its own outline changes alone", () => {
    const m = setOwnOutline(house(), "g", true);
    m.levels.push({ id: "f", rooms: [{ id: "up", rect: [0, 0, 10, 8] }] });
    const out = moveVertex(m, "g", [10, 0], [10, -1]);
    expect(out.levels[0].outline).toEqual({ polygon: [[0, 0], [10, -1], [10, 8], [0, 8]] });
    expect(out.outline).toEqual({ rect: [0, 0, 10, 8] });
    expect(out.levels[1].rooms[0].rect).toEqual([0, 0, 10, 8]);
    expect(setOwnOutline(out, "g", false).levels[0].outline).toBeUndefined();
  });

  it("opens and closes single sides of a boundary between two rooms", () => {
    const sides = ["west", "north"] as const;
    let m = setBoundaryOpen(house(), "g", "kitchen", "living", "west", true, [...sides]);
    expect(m.levels[0].walls).toEqual([{ between: ["kitchen", "living"], side: "west" }]);
    m = setBoundaryOpen(m, "g", "kitchen", "living", "north", true, [...sides]);
    expect(m.levels[0].walls).toEqual([{ between: ["kitchen", "living"] }]);
    // seen from the living room, the kitchen's west side is its east side
    expect(openSides(m, "g", "living", "kitchen", ["east", "south"])).toEqual(["east", "south"]);
    m = setBoundaryOpen(m, "g", "kitchen", "living", "west", false, [...sides]);
    expect(m.levels[0].walls).toEqual([{ between: ["kitchen", "living"], side: "north" }]);
    m = setBoundaryOpen(m, "g", "kitchen", "living", "north", false, [...sides]);
    expect(m.levels[0].walls).toBeUndefined();
  });

  it("adds, edits and deletes openings; façade openings keep covers per level", () => {
    let m = house();
    const added = addOpening(m, "g", { room: "left", side: "north", at: 1, width: 1 });
    expect(added.source).toEqual({ kind: "level", index: 1 });
    m = updateOpening(added.model, "g", added.source, { width: 1.5, cover: "cover.x" });
    expect(readOpening(m, "g", added.source)).toMatchObject({ width: 1.5, cover: "cover.x" });
    m = updateOpening(m, "g", added.source, { cover: "" });
    expect(readOpening(m, "g", added.source)?.cover).toBeUndefined();
    m = deleteOpening(m, "g", added.source);
    expect(m.levels[0].openings).toHaveLength(1);

    m.levels.push({ id: "f", rooms: [{ id: "up", rect: [0, 0, 10, 8] }] });
    m.facade_openings = [{ side: "south", at: 1, width: 1, levels: ["g", "f"], covers: { g: "cover.g" } }];
    const src = { kind: "facade" as const, index: 0 };
    m = updateOpening(m, "f", src, { at: 2, cover: "cover.f" });
    expect(m.facade_openings![0]).toMatchObject({ at: 2, covers: { g: "cover.g", f: "cover.f" } });
    expect(readOpening(m, "g", src)).toMatchObject({ at: 2, cover: "cover.g" });
    m = deleteOpening(m, "g", src);
    expect(m.facade_openings![0].levels).toEqual(["f"]);
    m = deleteOpening(m, "f", src);
    expect(m.facade_openings).toBeUndefined();
  });

  it("reorders levels", () => {
    const m = house();
    m.levels.push({ id: "f", rooms: [] }, { id: "s", rooms: [] });
    expect(moveLevel(m, "s", 0).levels.map((l) => l.id)).toEqual(["s", "g", "f"]);
    expect(moveLevel(m, "g", 2).levels.map((l) => l.id)).toEqual(["f", "s", "g"]);
  });

  it("moves one wall piece without dragging the whole room side", () => {
    const m = house();
    // left (0–5) spans the full depth; on the right, a small room in the top corner
    m.levels[0].rooms = [
      { id: "technical", rect: [0, 0, 5, 8] },
      { id: "corridor", rect: [5, 5, 5, 3] },
    ];
    const out = moveWallPiece(m, "g", [5, 5], [5, 8], [-0.5, 0]);
    expect(rooms(out).corridor.rect).toEqual([4.5, 5, 5.5, 3]);
    expect(rooms(out).technical.polygon).toEqual([[0, 0], [5, 0], [5, 5], [4.5, 5], [4.5, 8], [0, 8]]);
  });

  it("a room meeting the moved piece at a T-junction gets a step instead of a slanted wall", () => {
    const m = house();
    m.levels[0].rooms = [
      { id: "technical", rect: [0, 0, 5, 8] },
      { id: "store", rect: [5, 0, 5, 5] },
      { id: "corridor", rect: [5, 5, 5, 3] },
    ];
    const out = moveWallPiece(m, "g", [5, 5], [5, 8], [-0.5, 0]);
    expect(rooms(out).store.rect).toEqual([5, 0, 5, 5]);
    expect(rooms(out).corridor.rect).toEqual([4.5, 5, 5.5, 3]);
  });

  it("splits and removes corners in all rooms sharing the edge", () => {
    const split = splitEdge(house(), "g", [5, 0], [5, 8], [5, 3]);
    expect(rooms(split).left.polygon).toHaveLength(5);
    expect(rooms(split).right.polygon).toHaveLength(5);
    const back = removeVertex(split, "g", [5, 3]);
    expect(rooms(back).left.rect).toEqual([0, 0, 5, 8]);
  });

  it("adds, renames and deletes rooms (openings follow)", () => {
    const { model, id } = addRoom(house(), "g", [[0, 8], [10, 8], [10, 12], [0, 12]], { kind: "outdoor" });
    expect(id).toBe("room");
    expect(rooms(model).room).toMatchObject({ rect: [0, 8, 10, 4], kind: "outdoor" });
    const renamed = updateRoom(model, "g", "right", { id: "kitchen", area_id: "kitchen" });
    expect(renamed.levels[0].openings![0].room).toBe("kitchen");
    const cleared = updateRoom(renamed, "g", "kitchen", { area_id: "" });
    expect(rooms(cleared).kitchen.area_id).toBeUndefined();
    const deleted = deleteRoom(renamed, "g", "kitchen");
    expect(deleted.levels[0].openings).toEqual([]);
  });

  it("snaps to corners first, then to aligned coordinates, then to the grid", () => {
    const ctx = { grid: 0.1, points: [[5, 0]] as [number, number][], align: { x: [2], y: [] }, tolerance: 0.15 };
    expect(snap([5.08, 0.05], ctx)).toEqual({ p: [5, 0], kind: "point", target: [5, 0] });
    expect(snap([2.1, 3.33], ctx)).toEqual({ p: [2, 3.3], kind: "align", alignX: 2 });
    expect(snap([7.04, 3.33], ctx)).toEqual({ p: [7, 3.3], kind: "grid" });
  });

  it("reads areas and corner angles", () => {
    const poly = roomPolygon(house(), house().levels[0].rooms[0]);
    expect(area(poly)).toBe(40);
    expect(poly.map((_, i) => Math.round(cornerAngle(poly, i)))).toEqual([90, 90, 90, 90]);
  });

  it("undo and redo", () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo).toBe(true);
    h.push(5);
    expect(h.canRedo).toBe(false);
  });
});

describe("houses and levels", () => {
  it("a new house gets one level per floor with placeholder rooms sharing walls", () => {
    const m = newHouse("home", "Home", [10, 8], [
      { floor_id: "ground_floor", areas: [{ area_id: "kitchen", name: "Kitchen" }, { area_id: "living_room", name: "Living" }, { area_id: "hall", name: "Hall" }] },
      { floor_id: "first_floor", areas: [] },
    ]);
    expect(m.outline).toEqual({ rect: [0, 0, 10, 8] });
    expect(m.levels.map((l) => l.id)).toEqual(["ground_floor", "first_floor"]);
    const rects = m.levels[0].rooms.map((r) => r.rect);
    // two columns: two rooms in the first row, the last fills the second
    expect(rects).toEqual([[0, 0, 5, 4], [5, 0, 5, 4], [0, 4, 10, 4]]);
    expect(m.levels[0].rooms.map((r) => r.area_id)).toEqual(["kitchen", "living_room", "hall"]);
    expect(m.levels[1].rooms).toEqual([]);
  });

  it("areas that sound like outside become outdoor areas south of the house", () => {
    const rooms = layoutRooms([0, 0, 10, 8], [
      { area_id: "kitchen", name: "Kitchen" },
      { area_id: "garten", name: "Garten" },
      { area_id: "terrace", name: "Terrace" },
    ]);
    expect(rooms).toEqual([
      { id: "kitchen", area_id: "kitchen", rect: [0, 0, 10, 8] },
      { id: "garten", area_id: "garten", kind: "outdoor", rect: [0, 8, 5, 3] },
      { id: "terrace", area_id: "terrace", kind: "outdoor", rect: [5, 8, 5, 3] },
    ]);
  });

  it("adds, renames and deletes levels with their references", () => {
    let m = house();
    m = addLevel(m, 1, { name: "First", areas: [{ area_id: "bed", name: "Bed" }] }).model;
    expect(m.levels.map((l) => l.id)).toEqual(["g", "first"]);
    expect(m.levels[1].rooms[0]).toMatchObject({ area_id: "bed", rect: [0, 0, 10, 8] });
    m.facade_openings = [{ side: "south", at: 1, width: 1, levels: ["g", "first"], covers: { first: "cover.f" } }];
    m.vertical = [{ id: "stairs", rect: [0, 0, 1, 2], from: "g", to: "first" }];
    m = updateLevel(m, "first", { id: "upper", height: 2.5 });
    expect(m.facade_openings![0]).toMatchObject({ levels: ["g", "upper"], covers: { upper: "cover.f" } });
    expect(m.vertical![0].to).toBe("upper");
    expect(m.levels[1].height).toBe(2.5);
    m = deleteLevel(m, "upper");
    expect(m.levels.map((l) => l.id)).toEqual(["g"]);
    expect(m.facade_openings![0]).toEqual({ side: "south", at: 1, width: 1, levels: ["g"] });
    expect(m.vertical).toBeUndefined();
    expect(deleteLevel(m, "g").levels).toHaveLength(1); // the last level stays
  });

  it("makes ids from names", () => {
    expect(slug("Wohnzimmer Süd")).toBe("wohnzimmer_sud");
    expect(uniqueId(["a", "a_2"], "a")).toBe("a_3");
  });
});

describe("stairs", () => {
  it("adds stairs climbing along the longer side, u_turn when nearly square", () => {
    let { model, id } = addStairs(house(), [1, 1, 4, 1], "g", "f");
    expect(model.vertical![0]).toEqual({ id, kind: "stairs", rect: [1, 1, 4, 1], from: "g", to: "f", up: "east" });
    ({ model } = addStairs(model, [6, 1, 2.5, 2], "g", "f"));
    expect(model.vertical![1]).toMatchObject({ id: "stairs_2", shape: "u_turn", up: "east", start: "south" });
  });

  it("keeps the start side valid when the direction changes", () => {
    let { model, id } = addStairs(house(), [6, 1, 2.5, 2], "g", "f");
    model = updateStairs(model, id, { up: "north" });
    expect(model.vertical![0].start).toBe("west");
    model = updateStairs(model, id, { entry: 0.8 });
    expect(model.vertical![0].entry).toBe(0.8);
    model = updateStairs(model, id, { entry: 0 });
    expect(model.vertical![0].entry).toBeUndefined();
    model = setStairsRect(model, id, [5, 1, 3, 2]);
    expect(stairsRect(model, model.vertical![0])).toEqual([5, 1, 3, 2]);
    expect(deleteStairs(model, id).vertical).toBeUndefined();
  });
});

describe("lights", () => {
  it("places, moves between rooms, hides and removes lights", () => {
    let m = placeLight(house(), "g", "left", "light.a", [1, 2]);
    expect(rooms(m).left.lights).toEqual([{ entity: "light.a", at: [1, 2] }]);
    m = placeLight(m, "g", "right", "light.a", [0.5, 0.5]);
    expect(rooms(m).left.lights).toBeUndefined();
    expect(rooms(m).right.lights).toEqual([{ entity: "light.a", at: [0.5, 0.5] }]);
    m = placeLight(m, "g", "right", "light.a");
    expect(rooms(m).right.lights).toEqual([{ entity: "light.a" }]);
    m = setLightHidden(m, "g", "right", "light.a", true);
    expect(rooms(m).right.lights).toEqual([{ entity: "light.a", hidden: true }]);
    m = removeLight(m, "g", "right", "light.a");
    expect(rooms(m).right.lights).toBeUndefined();
  });
});

describe("roof", () => {
  it("sets roof properties", () => {
    expect(setRoof(house(), { pitch: 40 }).roof).toEqual({ pitch: 40 });
  });
});

describe("energy", () => {
  it("adds, moves and removes energy items", () => {
    let { model, index } = addEnergy(house(), { kind: "battery", level: "g", at: [1.2345, 2] });
    model = updateEnergy(model, index, { at: [3.14159, 1], name: "" });
    expect(model.energy).toEqual([{ kind: "battery", level: "g", at: [3.142, 1] }]);
    expect(deleteEnergy(model, index).energy).toBeUndefined();
  });
});
