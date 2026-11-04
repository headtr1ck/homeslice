import { describe, expect, it } from "vitest";
import type { HouseInput, ShapeInput, Vec2 } from "../model/types";
import { bbox } from "../model/geometry";
import {
  assignArea,
  bendEdge,
  transformLevel,
  uncoveredPieces,
  drawRoomOver,
  houseOutlinePolygon,
  setOutlineAuto,
  divideRoom,
  mergePieces,
  setPiece,
  duplicateLevel,
  moveRoomToLevel,
  movePieceToLevel,
  addRoofLevel,
  addRoofPart,
  addSolarPanels,
  removeRoofPart,
  updateRoofPart,
  History,
  addOpening,
  addRoom,
  deleteOpening,
  readOpening,
  updateOpening,
  area,
  cornerAngle,
  deleteRoom,
  besideOutline,
  moveEdge,
  moveLevel,
  moveVertex,
  moveWallPiece,
  removeVertex,
  openSides,
  roomPolygon,
  setBoundaryOpen,
  setBoundaryOpenAll,
  boundaryOpenAll,
  setOpenSegments,
  setSegmentThickness,
  setOwnOutline,
  snap,
  splitEdge,
  updateRoom,
  addLevel,
  deleteLevel,
  newHouse,
  addFurniture,
  updateFurniture,
  deleteFurniture,
  moveFurniture,
  copyRooms,
  addEnergy,
  updateEnergy,
  deleteEnergy,
  setRoof,
  placeLight,
  addCamera,
  updateCamera,
  removeCamera,
  setLightShape,
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
  boundaryThickness,
  setBoundaryThickness,
  setWallThickness,
  setPartyWalls,
  setOpeningDefaults,
  addFreeWall,
  updateFreeWall,
  deleteFreeWall,
  freeWallIndexes,
  resizeSide,
  wallSnap,
  suggestMerges,
  connectEnergy,
  snapFurniture,
  footprintHalf,
  flipFurniture,
  addRobot,
  setRobotPosition,
  addRobotPoint,
  clearRobotPoints,
  deleteRobot,
  setOpeningLevels,
} from "./ops";
import { expandHouse } from "../model/expand";
import { deriveWalls } from "../model/walls";

// left | right, sharing the wall at x = 5
const house = (): HouseInput => ({
  schema: 2,
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

  it("a level with its own outline changes alone when unlinked (Shift)", () => {
    const m = setOwnOutline(house(), "g", true);
    m.levels.push({ id: "f", rooms: [{ id: "up", rect: [0, 0, 10, 8] }] });
    const out = moveVertex(m, "g", [10, 0], [10, -1], false);
    expect(out.levels[0].outline).toEqual({ polygon: [[0, 0], [10, -1], [10, 8], [0, 8]] });
    expect(out.outline).toEqual({ rect: [0, 0, 10, 8] });
    expect(out.levels[1].rooms[0].rect).toEqual([0, 0, 10, 8]);
    expect(setOwnOutline(out, "g", false).levels[0].outline).toBeUndefined();
  });

  it("the floors above and below follow a façade or corner they share, even with their own outline", () => {
    const m = house();
    // a basement of its own shape, its east wall in line with the house's (only part of it)
    m.levels.unshift({ id: "b", outline: { polygon: [[0, 0], [4, 0], [4, 3], [10, 3], [10, 8], [0, 8]] }, rooms: [{ id: "cellar", polygon: [[0, 0], [4, 0], [4, 3], [10, 3], [10, 8], [0, 8]] }] });
    const out = moveEdge(m, "g", [10, 0], [10, 8], [0.5, 0]);
    expect(out.outline).toEqual({ rect: [0, 0, 10.5, 8] });
    expect(out.levels[0].outline).toEqual({ polygon: [[0, 0], [4, 0], [4, 3], [10.5, 3], [10.5, 8], [0, 8]] });
    expect(out.levels[0].rooms[0].polygon).toContainEqual([10.5, 3]);
    // the north façade: the basement's part in line moves, the notch's wall behind it stays
    expect(moveEdge(m, "g", [0, 0], [10, 0], [0, -1]).levels[0].outline).toEqual({ polygon: [[0, -1], [4, -1], [4, 3], [10, 3], [10, 8], [0, 8]] });
    // a shared corner
    const corner = moveVertex(m, "b", [0, 8], [0, 8.5]);
    expect(corner.outline).toEqual({ polygon: [[0, 0], [10, 0], [10, 8], [0, 8.5]] });
    // Shift: this floor only
    expect(moveEdge(m, "g", [10, 0], [10, 8], [0.5, 0], false).levels[0].outline).toEqual(m.levels[0].outline);
  });

  it("finds room sides just inside an outside wall and puts them on it", () => {
    const m = house();
    // the right room's east side leans 10 cm in at its south end: an inside wall beside the outside one
    m.levels[0].rooms[1] = { id: "right", polygon: [[5, 0], [10, 0], [9.9, 8], [5, 8]] };
    const found = besideOutline(m, "g")!;
    expect(found.rooms).toEqual(["right"]);
    expect(found.off).toBeCloseTo(0.1);
    expect(rooms(found.fixed).right.rect).toEqual([5, 0, 5, 8]);
    expect(besideOutline(found.fixed, "g")).toBeNull();
    // a narrow room between is no slip
    const strip = house();
    strip.levels[0].rooms = [
      { id: "left", rect: [0, 0, 9.8, 8] },
      { id: "shaft", rect: [9.8, 0, 0.2, 8] },
    ];
    expect(besideOutline(strip, "g")).toBeNull();
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

  it("keeps walls straight or at 45° to the corners they join", () => {
    const ctx = { grid: 0.1, points: [], align: { x: [], y: [] }, tolerance: 0.15, anchors: [[0, 0]] as [number, number][] };
    // 45°, along the grid
    expect(snap([3.02, 2.92], ctx)).toEqual({ p: [3, 3], kind: "angle", rays: [[[0, 0], [3, 3]]] });
    // straight
    expect(snap([3.04, 0.1], ctx)).toEqual({ p: [3, 0], kind: "align", alignY: 0 });
    // two walls: where a 45° one crosses a straight one
    expect(snap([2.06, 1.94], { ...ctx, anchors: [[0, 0], [5, 2]] })).toMatchObject({ p: [2, 2], kind: "angle", alignY: 2 });
    // too far from either
    expect(snap([3.04, 1.33], ctx)).toEqual({ p: [3, 1.3], kind: "grid" });
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
    // the outside walls follow the rooms, which fill the size given
    expect(m.outline).toBe("auto");
    expect(houseOutlinePolygon(m)).toHaveLength(4);
    expect(bbox(houseOutlinePolygon(m))).toEqual({ min: [0, 0], max: [10, 8] });
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

  it("duplicates a floor above it, without its links to Home Assistant", () => {
    let m = house();
    Object.assign(m.levels[0], { floor_id: "ground" });
    Object.assign(m.levels[0].rooms[0], { area_id: "kitchen", lights: [{ entity: "light.k" }], furniture: [{ type: "sofa", at: [1, 1], entity: "media_player.tv" }] });
    m.levels[0].openings![0].cover = "cover.x";
    const r = duplicateLevel(m, "g");
    m = r.model;
    expect(m.levels.map((l) => l.id)).toEqual(["g", "g_copy"]);
    const copy = m.levels[1];
    expect(copy.floor_id).toBeUndefined();
    expect(copy.rooms[0]).toEqual({ id: "left", rect: [0, 0, 5, 8], furniture: [{ type: "sofa", at: [1, 1] }] });
    expect(copy.openings![0].cover).toBeUndefined();
    // the original keeps its links
    expect(m.levels[0].rooms[0].area_id).toBe("kitchen");
  });

  it("moves a room with its doors to another floor, and a piece into the room under it", () => {
    let m = house();
    m = addLevel(m, 1, { name: "Up", areas: [] }).model;
    m.levels[1].rooms = [{ id: "west", rect: [0, 0, 5, 8] }, { id: "right", rect: [5, 0, 5, 8] }];
    // in the right room, 2 m from its corner: 7 m from the house's
    m.levels[0].rooms[1].furniture = [{ type: "sofa", at: [2, 2] }];
    m.levels[0].walls = [{ between: ["left", "right"] }];
    const moved = moveRoomToLevel(m, "g", "right", "up");
    expect(moved.roomId).toBe("right_2");
    expect(moved.model.levels[0].rooms.map((r) => r.id)).toEqual(["left"]);
    expect(moved.model.levels[0].openings).toBeUndefined();
    expect(moved.model.levels[0].walls).toBeUndefined();
    expect(moved.model.levels[1].openings).toEqual([{ room: "right_2", side: "south", at: 1, width: 1 }]);
    const piece = movePieceToLevel(m, "g", "right", 0, "up");
    expect(piece.roomId).toBe("right");
    expect(piece.model.levels[0].rooms[1].furniture).toBeUndefined();
    expect(piece.model.levels[1].rooms[1].furniture).toEqual([{ type: "sofa", at: [2, 2] }]);
    // into a room that starts elsewhere: the same spot on the plan
    m.levels[1].rooms = [{ id: "all", rect: [1, 0, 9, 8] }];
    expect(movePieceToLevel(m, "g", "right", 0, "up").model.levels[1].rooms[0].furniture).toEqual([{ type: "sofa", at: [6, 2] }]);
  });

  it("adds a pack's pieces: the same one once, another with a taken id renamed", () => {
    const unit = { id: "unit", size: [1, 0.4, 0.5] as [number, number, number], parts: [{ shape: "box" as const, size: [1, 0.4, 0.5] as [number, number, number] }] };
    let m = mergePieces(house(), [unit]).model;
    const again = mergePieces(m, [unit, { ...unit, size: [2, 0.4, 0.5] }]);
    expect(again.added).toEqual(["unit_2"]);
    m = again.model;
    expect(m.pieces!.map((p) => p.id)).toEqual(["unit", "unit_2"]);
  });

  it("removing a piece in use leaves its places as their own type", () => {
    let m = mergePieces(house(), [{ id: "unit", size: [1, 0.4, 0.5], parts: [{ shape: "box", size: [1, 0.4, 0.5] }] }]).model;
    m.levels[0].rooms[0].furniture = [{ type: "shelf", at: [1, 1], model: "piece:unit" }];
    m = setPiece(m, "unit", null);
    expect(m.pieces).toBeUndefined();
    expect(m.levels[0].rooms[0].furniture).toEqual([{ type: "shelf", at: [1, 1] }]);
  });

  it("bending an outside wall bends the rooms that run its whole length", () => {
    let m = house();
    m.levels[0].rooms = [{ id: "front", rect: [0, 4, 10, 4] }, { id: "back", rect: [0, 0, 10, 4] }, { id: "garden", kind: "outdoor", rect: [0, 8, 10, 4] }];
    m.levels[0].openings = [];
    m = bendEdge(m, "g", "outline", 2, 1.2);
    expect((m.outline as ShapeInput).curves).toEqual([{ edge: 2, bulge: 1.2 }]);
    // the garden outside the wall bends the other way, along the same arc
    expect(m.levels[0].rooms.map((r) => r.curves)).toEqual([[{ edge: 2, bulge: 1.2 }], undefined, [{ edge: 0, bulge: -1.2 }]]);
    m = bendEdge(m, "g", { room: "front" }, 2, 0);
    expect(m.levels[0].rooms[0].curves).toBeUndefined();
  });

  it("makes ids from names", () => {
    expect(slug("Wohnzimmer Süd")).toBe("wohnzimmer_sud");
    expect(uniqueId(["a", "a_2"], "a")).toBe("a_3");
  });
});

describe("stairs", () => {
  it("adds stairs climbing along the longer side, a U (two quarter turns, winders) when nearly square", () => {
    let { model, id } = addStairs(house(), [1, 1, 4, 1], "g", "f");
    expect(model.vertical![0]).toEqual({ id, kind: "stairs", rect: [1, 1, 4, 1], from: "g", to: "f", up: "east" });
    ({ model } = addStairs(model, [6, 1, 2.5, 2], "g", "f"));
    expect(model.vertical![1]).toMatchObject({ id: "stairs_2", turns: 2, turn: "winders", up: "east", start: "south" });
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
  it("adds, turns, moves and removes cameras", () => {
    let m = addCamera(house(), "g", "left", "camera.door", [1, 1]);
    m = updateCamera(m, "g", "left", 0, { direction: 90, at: [0.5, 0.25] });
    expect(rooms(m).left.cameras).toEqual([{ entity: "camera.door", at: [0.5, 0.25], direction: 90 }]);
    m = updateCamera(m, "g", "left", 0, { direction: undefined });
    expect(rooms(m).left.cameras![0].direction).toBeUndefined();
    expect(rooms(m).left.cameras).toHaveLength(1);
    m = removeCamera(m, "g", "left", 0);
    expect(rooms(m).left.cameras).toBeUndefined();
  });
  it("turns a light into spots or a strip and back", () => {
    // an automatic light gets pinned where it is
    let m = setLightShape(house(), "g", "left", "light.a", { type: "spot" }, [1, 1]);
    expect(rooms(m).left.lights).toEqual([{ entity: "light.a", at: [1, 1], type: "spot" }]);
    m = setLightShape(m, "g", "left", "light.a", { spots: [[1.8, 1]] });
    expect(rooms(m).left.lights![0].spots).toEqual([[1.8, 1]]);
    m = setLightShape(m, "g", "left", "light.a", { type: "strip" });
    expect(rooms(m).left.lights).toEqual([{ entity: "light.a", at: [1, 1], type: "strip", to: [2.5, 1] }]);
    m = setLightShape(m, "g", "left", "light.a", { height: 0.9 });
    m = setLightShape(m, "g", "left", "light.a", { type: "lamp" });
    expect(rooms(m).left.lights).toEqual([{ entity: "light.a", at: [1, 1] }]);
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

describe("copying a level", () => {
  it("copies room shapes without their links", () => {
    let m = house();
    m.levels[0].rooms[0].area_id = "living";
    m.levels[0].rooms.push({ id: "garden", kind: "outdoor", rect: [0, 8, 10, 3] });
    m.levels[0].walls = [{ between: ["left", "right"] }];
    m.levels.push({ id: "f", rooms: [] });
    m = copyRooms(m, "g", "f");
    expect(m.levels[1].rooms).toEqual([{ id: "left", rect: [0, 0, 5, 8] }, { id: "right", rect: [5, 0, 5, 8] }]);
    expect(m.levels[1].walls).toEqual([{ between: ["left", "right"] }]);
  });
});

describe("furniture", () => {
  it("adds, turns, moves into another room and deletes furniture", () => {
    let { model, index } = addFurniture(house(), "g", "left", { type: "sofa", at: [2, 3] });
    model = updateFurniture(model, "g", "left", index, { rotation: 450 });
    expect(rooms(model).left.furniture).toEqual([{ type: "sofa", at: [2, 3], rotation: 90 }]);
    model = updateFurniture(model, "g", "left", index, { rotation: 360 });
    expect(rooms(model).left.furniture).toEqual([{ type: "sofa", at: [2, 3] }]);
    const moved = moveFurniture(model, "g", "left", index, [7, 4], "right");
    expect(moved.room).toBe("right");
    expect(rooms(moved.model).left.furniture).toBeUndefined();
    expect(rooms(moved.model).right.furniture).toEqual([{ type: "sofa", at: [2, 4] }]);
    expect(rooms(deleteFurniture(moved.model, "g", "right", 0)).right.furniture).toBeUndefined();
  });

  it("puts small pieces on the surface they are placed on, and back on the floor", () => {
    // a worktop turned to run north–south, and a chair pushed under a table
    let { model } = addFurniture(house(), "g", "left", { type: "kitchen", at: [1, 2], size: [2.4, 0.6], height: 0.91, rotation: 90 });
    ({ model } = addFurniture(model, "g", "left", { type: "table", at: [3.5, 2] }));
    const toaster = addFurniture(model, "g", "left", { type: "item", model: "modern:toaster", at: [1.1, 2.8], size: [0.3, 0.18], height: 0.2 });
    expect(rooms(toaster.model).left.furniture![toaster.index].elevation).toBe(0.91);
    const chair = addFurniture(toaster.model, "g", "left", { type: "chair", at: [3.5, 2] });
    expect(rooms(chair.model).left.furniture![chair.index].elevation).toBeUndefined();
    const lamp = addFurniture(chair.model, "g", "left", { type: "table_lamp", at: [3.6, 2.1] });
    expect(rooms(lamp.model).left.furniture![lamp.index].elevation).toBe(0.75);
    // off the worktop: on the floor again
    const off = moveFurniture(lamp.model, "g", "left", toaster.index, [2.2, 2.8], "left");
    expect(rooms(off.model).left.furniture![toaster.index].elevation).toBeUndefined();
    expect(expandHouse(off.model).house!.levels[0].rooms.find((r) => r.id === "left")!.furniture.find((f) => f.type === "table_lamp")!.elevation).toBe(0.75);
  });
});

describe("walls and building settings", () => {
  const wallsOf = (m: HouseInput) => {
    const { house: h } = expandHouse(m);
    return deriveWalls(h!.levels[0], h!.walls);
  };
  const shared = (m: HouseInput) => wallsOf(m).find((w) => w.type === "interior" && w.rooms.length === 2)!;

  it("gives one wall between two rooms its own thickness, and back", () => {
    let m = setBoundaryThickness(house(), "g", "left", "right", "east", 0.24);
    expect(boundaryThickness(m, "g", "left", "right", "east")).toBe(0.24);
    // seen from the other room it is that room's west side
    expect(boundaryThickness(m, "g", "right", "left", "west")).toBe(0.24);
    expect(shared(m).thickness).toBe(0.24);
    // opening and closing the wall keeps its thickness
    m = setBoundaryOpen(m, "g", "left", "right", "east", true, ["east"]);
    m = setBoundaryOpen(m, "g", "left", "right", "east", false, ["east"]);
    expect(boundaryThickness(m, "g", "left", "right", "east")).toBe(0.24);
    m = setBoundaryThickness(m, "g", "left", "right", "east", undefined);
    expect(m.levels[0].walls).toBeUndefined();
    expect(shared(m).thickness).toBe(0.12);
  });

  it("house-wide thicknesses and neighbour walls", () => {
    let m = setWallThickness(house(), { exterior: 0.42, interior: 0.1 });
    expect(m.walls).toEqual({ exterior: 0.42, interior: 0.1 });
    m = setPartyWalls(m, ["east"]);
    const walls = wallsOf(m);
    expect(walls.find((w) => w.side === "east")!.type).toBe("party");
    expect(walls.find((w) => w.side === "west")!.thickness).toBe(0.42);
    expect(shared(m).thickness).toBe(0.1);
    m = setWallThickness(setPartyWalls(m, []), { exterior: undefined, interior: undefined });
    expect(m.walls).toBeUndefined();
    expect(m.party_walls).toBeUndefined();
  });

  it("defaults for windows apply to windows without their own sill or height", () => {
    const m = setOpeningDefaults(house(), "window", { sill: 0, height: 2.4 });
    const { house: h } = expandHouse(m);
    expect(h!.levels[0].openings[0]).toMatchObject({ sill: 0, height: 2.4 });
    expect(setOpeningDefaults(m, "window", { sill: undefined, height: undefined }).opening_defaults).toBeUndefined();
  });

  it("free-standing walls: add, change, delete", () => {
    let { model, index } = addFreeWall(house(), "g", [1, 2], [3.0004, 2]);
    expect(freeWallIndexes(model, "g")).toEqual([index]);
    model = updateFreeWall(model, "g", index, { thickness: 0.08, line: [[1, 2], [4, 2]] });
    expect(model.levels[0].walls![index]).toEqual({ line: [[1, 2], [4, 2]], thickness: 0.08 });
    expect(wallsOf(model).some((w) => w.rooms.length === 0 && w.thickness === 0.08)).toBe(true);
    expect(deleteFreeWall(model, "g", index).levels[0].walls).toBeUndefined();
  });

  it("typing a side's length moves the wall at its east or south end", () => {
    const m = house();
    const left = roomPolygon(m, rooms(m).left);
    // the north side runs west → east: the shared wall moves east, the right room shrinks
    const i = left.findIndex((p, k) => p[1] === 0 && left[(k + 1) % left.length][1] === 0);
    const out = resizeSide(m, "g", left, i, 0.5);
    expect(rooms(out).left.rect).toEqual([0, 0, 5.5, 8]);
    expect(rooms(out).right.rect).toEqual([5.5, 0, 4.5, 8]);
  });
});

describe("wall-mounted furniture", () => {
  // a 4 × 3 m room inside its walls
  const inner: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];
  it("goes against the nearest wall, facing into the room", () => {
    expect(wallSnap(inner, [2, 0.4], 0.35)).toEqual({ at: [2, 0.175], rotation: 0 }); // north wall
    expect(wallSnap(inner, [3.8, 1.5], 0.04)).toEqual({ at: [3.98, 1.5], rotation: 90 }); // east wall
    expect(wallSnap(inner, [2, 2.9], 0.3)).toEqual({ at: [2, 2.85], rotation: 180 }); // south wall
    expect(wallSnap(inner, [0.1, 1], 0.3)).toEqual({ at: [0.15, 1], rotation: 270 }); // west wall
  });
});

describe("merging Home Assistant floors", () => {
  const floor = (floor_id: string, name: string, level: number | null, areas: string[] = []) => ({ floor_id, name, level, areas: areas.map((a) => ({ area_id: a, name: a })) });
  it("puts an outside floor on the ground floor", () => {
    expect(suggestMerges([floor("basement", "Basement", -1), floor("ground", "Ground floor", 0), floor("outside", "Outside", null), floor("first", "First floor", 1)])).toEqual({ outside: "ground" });
    // recognised by its areas too
    expect(suggestMerges([floor("eg", "EG", 0, ["kitchen"]), floor("x", "Grounds", 0, ["Garten", "Terrasse"])])).toEqual({ x: "eg" });
    expect(suggestMerges([floor("eg", "EG", 0), floor("og", "OG", 1)])).toEqual({});
  });
  it("a new house keeps the merged floors on their level", () => {
    const m = newHouse("h", "H", [10, 8], [{ floor_id: "ground", include_floors: ["outside"], areas: [{ area_id: "kitchen", name: "Kitchen" }, { area_id: "garden", name: "Garden" }] }]);
    expect(m.levels[0].include_floors).toEqual(["outside"]);
    expect(m.levels[0].rooms.find((r) => r.area_id === "garden")?.kind).toBe("outdoor");
  });
});

describe("energy connections in the editor", () => {
  it("connects by index, writes the target's id, and reconnects to the hub when the target goes", () => {
    let m: HouseInput = {
      ...house(),
      energy: [
        { kind: "battery", level: "g", at: [1, 1] },
        { kind: "grid", level: "g", at: [2, 1] },
        { kind: "device", name: "Wallbox", power: "sensor.wb", level: "g", at: [3, 1] },
      ],
    };
    m = connectEnergy(m, 2, 1);
    expect(m.energy![1].id).toBe("grid");
    expect(m.energy![2].to).toBe("grid");
    expect(connectEnergy(m, 2, null).energy![2].to).toBeUndefined();
    const gone = deleteEnergy(m, 1);
    expect(gone.energy!.map((e) => e.to)).toEqual([undefined, undefined]);
  });
});

describe("snapping furniture", () => {
  // a 4 × 3 m room inside its walls
  const walls: [[number, number], [number, number]][] = [
    [[0, 0], [4, 0]],
    [[4, 0], [4, 3]],
    [[4, 3], [0, 3]],
    [[0, 3], [0, 0]],
  ];
  it("snaps a piece against a wall from the room's side only, never into the wall", () => {
    const inner: Vec2[] = [[0.36, 0.36], [5, 0.36], [5, 4], [0.36, 4]];
    const faces = inner.map((q, i) => [q, inner[(i + 1) % inner.length]] as [Vec2, Vec2]);
    const inRoom = (p: Vec2) => p[0] > 0.36 && p[0] < 5 && p[1] > 0.36 && p[1] < 4;
    // a bed dragged half into the north wall: its back goes to the wall's face, not its front
    const r = snapFurniture({ c: [2, 0.4], half: [0.5, 0.45] }, faces, [], [], 0.6, inRoom);
    expect(r.c[1]).toBeCloseTo(0.81);
  });

  it("snaps against a wall drawn a few millimetres off straight, without going into it", () => {
    // the east face runs from x 5.6 at the top to 5.595 at the bottom (5 mm over 4 m)
    const inner: Vec2[] = [[3.7, 9.1], [5.6, 9.1], [5.595, 12.87], [3.7, 12.87]];
    const faces = inner.map((q, i) => [q, inner[(i + 1) % inner.length]] as [Vec2, Vec2]);
    const inRoom = (p: Vec2) => p[0] > 3.7 && p[0] < 5.6 && p[1] > 9.1 && p[1] < 12.87;
    const r = snapFurniture({ c: [5.2, 11], half: [0.31, 0.4] }, faces, [], [], 0.2, inRoom);
    // its east side on the face where the face is nearest (the lower end of the piece)
    const faceAt = (y: number) => 5.6 - (0.005 * (y - 9.1)) / 3.77;
    expect(r.c[0] + 0.31).toBeCloseTo(faceAt(11.4), 6);
  });
  it("pushes a piece against a nearby wall", () => {
    const r = snapFurniture({ c: [2, 0.55], half: [1, 0.45] }, walls, [], [], 0.15);
    expect(r.c[1]).toBeCloseTo(0.45);
    expect(r.guide.y).toBe(0);
    expect(r.guide.x).toBeUndefined();
  });
  it("lines pieces up: a cabinet next to another touches it", () => {
    const cabinet = { c: [1, 2.7] as [number, number], half: [0.3, 0.3] as [number, number] };
    const r = snapFurniture({ c: [1.68, 2.66], half: [0.3, 0.3] }, walls, [cabinet], [], 0.15);
    expect(r.c[0]).toBeCloseTo(1.6); // touching
    expect(r.c[1]).toBeCloseTo(2.7); // against the south wall, lined up with it
  });
  it("centres a ceiling lamp in the room", () => {
    const r = snapFurniture({ c: [2.08, 1.45], half: [0.15, 0.15] }, [], [], [[2, 1.5]], 0.15);
    expect(r.c).toEqual([2, 1.5]);
  });
  it("only pieces turned by a right angle have a footprint", () => {
    expect(footprintHalf([2, 1], 90)).toEqual([0.5, 1]);
    expect(footprintHalf([2, 1], 45)).toBeNull();
  });
});

describe("robots in the editor", () => {
  it("places a robot, sets where its position comes from and calibrates it", () => {
    let { model, index } = addRobot(house(), { entity: "vacuum.r", level: "g", dock: [1.0004, 2] });
    expect(model.robots![0]).toEqual({ entity: "vacuum.r", level: "g", dock: [1, 2] });
    model = setRobotPosition(model, index, { attribute: "vacuum_position" });
    model = addRobotPoint(model, index, [25000, 25000], [1, 2]);
    model = addRobotPoint(model, index, [26000, 25000], [2, 2]);
    expect(model.robots![0].position).toEqual({ attribute: "vacuum_position", points: [[[25000, 25000], [1, 2]], [[26000, 25000], [2, 2]]] });
    // the same source keeps the points; another one drops them
    expect(setRobotPosition(model, index, { attribute: "vacuum_position" }).robots![0].position?.points).toHaveLength(2);
    expect(setRobotPosition(model, index, { entity: "camera.map", attribute: "vacuum_position" }).robots![0].position).toEqual({ entity: "camera.map", attribute: "vacuum_position" });
    expect(clearRobotPoints(model, index).robots![0].position).toEqual({ attribute: "vacuum_position" });
    expect(deleteRobot(model, index).robots).toBeUndefined();
  });
});

describe("stacked windows", () => {
  it("repeats a level's window on the floor above, at the same place on the façade", () => {
    const two: HouseInput = {
      schema: 2,
      id: "t",
      outline: { rect: [0, 0, 10, 8] },
      levels: [
        { id: "g", rooms: [{ id: "left", rect: [0, 0, 5, 8] }, { id: "right", rect: [5, 0, 5, 8] }], openings: [{ room: "right", side: "south", at: 1, width: 1.2, cover: "cover.r" }] },
        { id: "f", rooms: [{ id: "all", rect: [0, 0, 10, 8] }] },
      ],
    };
    const { model, source } = setOpeningLevels(two, "g", { kind: "level", index: 0 }, ["f"]);
    expect(source).toEqual({ kind: "facade", index: 0 });
    expect(model.levels[0].openings).toBeUndefined();
    expect(model.facade_openings).toEqual([{ side: "south", at: 6, width: 1.2, levels: ["g", "f"], covers: { g: "cover.r" } }]);
    const { house } = expandHouse(model);
    const ground = house!.levels[0].openings[0];
    const first = house!.levels[1].openings[0];
    expect([ground.room, ground.at, first.room, first.at]).toEqual(["right", 1, "all", 6]);
    // and off again: only this level keeps it, without the other level's blind
    const back = setOpeningLevels(model, "g", source, []).model;
    expect(back.facade_openings![0].levels).toEqual(["g"]);
  });
});

describe("mirroring furniture", () => {
  it("left–right and top–bottom on the plan, whichever way the piece is turned", () => {
    expect(flipFurniture({ type: "sofa_corner", at: [0, 0] }, "x")).toEqual({ mirror: true });
    expect(flipFurniture({ type: "sofa_corner", at: [0, 0] }, "y")).toEqual({ mirror: true, rotation: 180 });
    // turned a quarter: the plan's left–right is the piece's front–back
    expect(flipFurniture({ type: "sofa_corner", at: [0, 0], rotation: 90 }, "x")).toEqual({ mirror: true, rotation: 270 });
    expect(flipFurniture({ type: "sofa_corner", at: [0, 0], rotation: 90, mirror: true }, "y")).toEqual({ mirror: undefined });
  });
});

describe("roof levels", () => {
  const base = (): HouseInput => ({ schema: 2, id: "h", outline: { rect: [0, 0, 10, 8] }, roof: { pitch: 30, ridge: "north_south", finish: "roof_slate" }, levels: [{ id: "g", rooms: [{ id: "a", rect: [0, 0, 10, 8] }] }] });

  it("adds a roof level from the house's roof, which it replaces", () => {
    const { model, id } = addRoofLevel(base(), [0, 0, 10, 8]);
    expect(model.roof).toBeUndefined();
    const roof = model.levels.find((l) => l.id === id)!;
    expect(roof.kind).toBe("roof");
    expect(roof.roofs![0]).toMatchObject({ rect: [0, 0, 10, 8], ridge: "up_down", pitch: 30, finish: "roof_slate" });
    expect(expandHouse(model).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("presets set the shape; parts are added and removed", () => {
    let { model, id } = addRoofLevel(base(), [0, 0, 10, 8]);
    model = updateRoofPart(model, id, 0, {}, "tuscan");
    expect(model.levels.at(-1)!.roofs![0]).toMatchObject({ shape: "hip", pitch: 22, finish: "roof_clay" });
    const added = addRoofPart(model, id, [10, 0, 3, 4]);
    expect(added.model.levels.at(-1)!.roofs!.length).toBe(2);
    expect(removeRoofPart(added.model, id, 1).levels.at(-1)!.roofs!.length).toBe(1);
  });

  it("lays out solar panels on a slope", () => {
    const { model, id } = addRoofLevel(base(), [0, 0, 10, 8], "gable_left_right");
    const m = addSolarPanels(updateRoofPart(model, id, 0, { ridge: "left_right" }), id, 0, 2, 3, "far");
    const pieces = m.levels.at(-1)!.roofs![0].furniture!;
    expect(pieces).toHaveLength(6);
    expect(pieces.every((p) => p.model === "modern:solar_panel")).toBe(true);
    expect(expandHouse(m).issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("divideRoom", () => {
  const house = (): HouseInput => ({
    schema: 2,
    id: "h",
    outline: { rect: [0, 0, 8, 6] },
    levels: [
      {
        id: "g",
        rooms: [
          {
            id: "kitchen",
            area_id: "kitchen",
            floor: "tile",
            rect: [0, 0, 8, 4],
            furniture: [
              { type: "sofa", at: [6, 2] },
              { type: "table", at: [1, 1] },
            ],
            lights: [{ entity: "light.dining", at: [7, 1], spots: [[6.5, 1]] }, { entity: "light.kitchen" }],
          },
          { id: "hall", rect: [0, 4, 8, 2] },
        ],
        openings: [
          { room: "kitchen", side: "north", at: 5.5, width: 1 },
          { room: "kitchen", side: "east", at: 1, width: 1 },
          { room: "kitchen", side: "west", at: 1, width: 1 },
        ],
        walls: [{ between: ["kitchen", "hall"], side: "south" }],
      },
    ],
  });

  it("splits along the line, with no wall between the parts; everything keeps its place", () => {
    const out = divideRoom(house(), "g", "kitchen", [5, -1], [5, 5]);
    expect(out?.ids).toEqual(["kitchen", "kitchen_2"]);
    const l = out!.model.levels[0];
    const k = l.rooms.find((r) => r.id === "kitchen")!;
    const d = l.rooms.find((r) => r.id === "kitchen_2")!;
    expect(k.rect).toEqual([0, 0, 5, 4]);
    expect(d.rect).toEqual([5, 0, 3, 4]);
    // the bigger part keeps the area; the new one has the finishes but no area yet
    expect(k.area_id).toBe("kitchen");
    expect(d.area_id).toBeUndefined();
    expect(d.floor).toBe("tile");
    expect(k.furniture).toEqual([{ type: "table", at: [1, 1] }]);
    expect(d.furniture).toEqual([{ type: "sofa", at: [1, 2] }]);
    expect(d.lights).toEqual([{ entity: "light.dining", at: [2, 1], spots: [[1.5, 1]] }]);
    expect(k.lights).toEqual([{ entity: "light.kitchen" }]);
    expect(l.openings).toEqual([
      { room: "kitchen_2", side: "north", at: 0.5, width: 1 },
      { room: "kitchen_2", side: "east", at: 1, width: 1 },
      { room: "kitchen", side: "west", at: 1, width: 1 },
    ]);
    expect(l.walls).toEqual([
      { between: ["kitchen", "hall"], side: "south" },
      { between: ["kitchen_2", "hall"], side: "south" },
      { between: ["kitchen", "kitchen_2"] },
    ]);
    // nothing moved in the house as built
    const { house: built, issues } = expandHouse(out!.model);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(built!.levels[0].rooms.map((r) => r.id)).toEqual(["kitchen", "kitchen_2", "hall"]);
  });

  it("a slanted line makes polygons; a line that misses the room does nothing", () => {
    const out = divideRoom(house(), "g", "kitchen", [4, 0], [6, 4]);
    const l = out!.model.levels[0];
    expect(l.rooms.find((r) => r.id === "kitchen")!.polygon).toBeDefined();
    expect(l.rooms.find((r) => r.id === "kitchen_2")!.polygon).toBeDefined();
    expect(divideRoom(house(), "g", "kitchen", [10, 0], [10, 4])).toBeNull();
  });
});

describe("assignArea", () => {
  const house = (): HouseInput => ({
    schema: 2,
    id: "h",
    outline: { rect: [0, 0, 10, 6] },
    levels: [
      {
        id: "g",
        rooms: [
          { id: "room_1", name: "Room 1", rect: [0, 0, 4, 6] },
          { id: "living", area_id: "living_room", rect: [4, 0, 6, 3] },
        ],
        walls: [
          { line: [[4, 3], [10, 3]] },
          { line: [[10, 3], [10, 6]] },
          { line: [[10, 6], [4, 6]] },
          { line: [[4, 6], [4, 3]] },
          { line: [[5, 4], [6, 5]] },
          { line: [[4, 4.5], [10, 4.5]], type: "railing" },
        ],
      },
    ],
  });

  it("onto a room: the area moves there from the level's other room; a placeholder name goes", () => {
    const { model, room } = assignArea(house(), "g", "living_room", { room: "room_1" });
    const rooms = model.levels[0].rooms;
    expect(room).toBe("room_1");
    expect(rooms[0]).toEqual({ id: "room_1", area_id: "living_room", rect: [0, 0, 4, 6] });
    expect(rooms[1].area_id).toBeUndefined();
  });

  it("onto a closed shape: a new room; the walls along its edges go, others stay", () => {
    const { model, room } = assignArea(house(), "g", "kitchen", { polygon: [[4, 3], [10, 3], [10, 6], [4, 6]] });
    const l = model.levels[0];
    expect(room).toBe("kitchen");
    expect(l.rooms.at(-1)).toEqual({ id: "kitchen", area_id: "kitchen", rect: [4, 3, 6, 3] });
    expect(l.walls).toEqual([
      { line: [[5, 4], [6, 5]] },
      { line: [[4, 4.5], [10, 4.5]], type: "railing" },
    ]);
  });

  it("carved out of a room the walls cut up: the room keeps the rest, with what stands there", () => {
    const h = house();
    h.levels[0].rooms[0].furniture = [{ type: "bed", at: [1, 4] }, { type: "desk", at: [3, 1] }];
    h.levels[0].openings = [{ room: "room_1", side: "north", at: 2.5, width: 1 }, { room: "room_1", side: "south", at: 1, width: 1 }];
    // walls cut the north-east corner (x 2–4, y 0–2) out of room_1 (x 0–4, y 0–6)
    h.levels[0].walls = [{ line: [[2, 0], [2, 2]] }, { line: [[2, 2], [4, 2]] }];
    const keep: Vec2[] = [[0, 0], [2, 0], [2, 2], [4, 2], [4, 6], [0, 6]];
    const { model, room } = assignArea(h, "g", "office", { polygon: [[2, 0], [4, 0], [4, 2], [2, 2]], host: { room: "room_1", keep } });
    const l = model.levels[0];
    const host = l.rooms.find((r) => r.id === "room_1")!;
    const office = l.rooms.find((r) => r.id === room)!;
    expect(office).toMatchObject({ id: "office", area_id: "office", rect: [2, 0, 2, 2], furniture: [{ type: "desk", at: [1, 1] }] });
    expect(host.polygon).toBeDefined();
    expect(host.furniture).toEqual([{ type: "bed", at: [1, 4] }]);
    expect(l.openings).toEqual([
      { room: "office", side: "north", at: 0.5, width: 1 },
      { room: "room_1", side: "south", at: 1, width: 1 },
    ]);
    // the drawn walls are the rooms' walls now
    expect(l.walls?.filter((w) => w.line) ?? []).toEqual([]);
  });
});

describe("outline: auto", () => {
  const h = (): HouseInput => ({
    schema: 2,
    id: "a",
    outline: "auto",
    levels: [
      { id: "g", rooms: [{ id: "a", rect: [0, 0, 6, 5] }, { id: "b", rect: [6, 0, 4, 5] }, { id: "garden", kind: "outdoor", rect: [0, 5, 10, 4] }] },
      // the first floor reaches 0.5 m further north
      { id: "f", rooms: [{ id: "c", rect: [0, -0.5, 10, 5.5] }] },
    ],
  });

  it("each level's outline is the outer edge of its rooms; the house's the lowest level's", () => {
    const { house, issues } = expandHouse(h());
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(bbox(house!.levels[0].outline)).toEqual({ min: [0, 0], max: [10, 5] });
    expect(bbox(house!.levels[1].outline)).toEqual({ min: [0, -0.5], max: [10, 5] });
  });

  it("moving a room's outer wall moves the outline with it; nothing is fixed", () => {
    const m = moveEdge(h(), "g", [10, 0], [10, 5], [0.5, 0]);
    expect(m.outline).toBe("auto");
    expect(bbox(houseOutlinePolygon(m)).max[0]).toBe(10.5);
  });

  it("made fixed: the house's is the lowest level's, a level reaching further gets its own; and back", () => {
    const fixed = setOutlineAuto(h(), false);
    expect(fixed.outline).toEqual({ rect: [0, 0, 10, 5] });
    expect(fixed.levels[0].outline).toBeUndefined();
    expect(fixed.levels[1].outline).toEqual({ rect: [0, -0.5, 10, 5.5] });
    const back = setOutlineAuto(fixed, true);
    expect(back.outline).toBe("auto");
    expect(back.levels.every((l) => !l.outline)).toBe(true);
  });
});

describe("snapping onto walls", () => {
  const ctx = (extra = {}) => ({ grid: 0.05, points: [] as Vec2[], align: { x: [] as number[], y: [] as number[] }, tolerance: 0.2, segments: [[[0, 0], [0, 6]], [[2, 3], [6, 7]]] as [Vec2, Vec2][], ...extra });
  it("a point near a wall lands on it, on the grid along it", () => {
    expect(snap([0.12, 2.33], ctx())).toMatchObject({ p: [0, 2.35], kind: "wall" });
  });
  it("a wall drawn straight from its start meets the other where the straight line crosses it", () => {
    // drawn west from (3, 2.02): straight, so it lands on the vertical wall at y 2.02
    expect(snap([0.1, 2.05], ctx({ anchors: [[3, 2.02]] }))).toMatchObject({ p: [0, 2.02], kind: "wall" });
  });
  it("onto a slanted wall: its nearest point; far from every wall: as before", () => {
    const s = snap([4.1, 4.9], ctx());
    expect(s.kind).toBe("wall");
    expect(Math.abs(s.p[1] - s.p[0] - 1)).toBeLessThan(0.002);
    expect(snap([3, 1], ctx()).kind).toBe("grid");
  });
});

describe("a room drawn over others takes its space from them", () => {
  const h = (): HouseInput => ({
    schema: 2,
    id: "o",
    outline: "auto",
    levels: [
      {
        id: "g",
        rooms: [
          { id: "a", area_id: "living", floor: "wood", rect: [0, 0, 6, 5], furniture: [{ type: "sofa", at: [5, 1] }, { type: "table", at: [1, 4] }] },
          { id: "b", area_id: "kitchen", rect: [6, 0, 4, 5] },
        ],
        openings: [{ room: "a", side: "north", at: 4.5, width: 1 }, { room: "a", side: "south", at: 1, width: 1 }],
      },
    ],
  });
  const room = (m: HouseInput, id: string) => m.levels[0].rooms.find((r) => r.id === id)!;

  it("over the corner of two rooms: both shrink, the walls on its sides are the old ones, what was there moves in", () => {
    const { model, id } = drawRoomOver(h(), "g", [[4, 0], [8, 0], [8, 3], [4, 3]]);
    const n = room(model, id);
    expect(n.rect).toEqual([4, 0, 4, 3]);
    expect(n.furniture).toEqual([{ type: "sofa", at: [1, 1] }]);
    expect(room(model, "a").polygon).toBeDefined();
    expect(room(model, "a").furniture).toEqual([{ type: "table", at: [1, 4] }]);
    expect(room(model, "b").polygon).toBeDefined();
    expect(model.levels[0].openings).toEqual([
      { room: id, side: "north", at: 0.5, width: 1 },
      { room: "a", side: "south", at: 1, width: 1 },
    ]);
    // the outline still follows the rooms: nothing outside changed
    const { house, issues } = expandHouse(model);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(bbox(house!.levels[0].outline)).toEqual({ min: [0, 0], max: [10, 5] });
  });

  it("covering a room wholly: it goes; cutting one in two: the piece with its middle stays, the other is a room without an area", () => {
    const covered = drawRoomOver(h(), "g", [[5, 0], [10, 0], [10, 5], [5, 5]]).model;
    expect(covered.levels[0].rooms.map((r) => r.id)).toEqual(["a", "room"]);
    expect(room(covered, "a").rect).toEqual([0, 0, 5, 5]);
    const cut = drawRoomOver(h(), "g", [[1, 0], [2, 0], [2, 5], [1, 5]]).model;
    expect(room(cut, "a").rect).toEqual([2, 0, 4, 5]);
    expect(room(cut, "a_2")).toMatchObject({ rect: [0, 0, 1, 5], floor: "wood" });
    expect(room(cut, "a_2").area_id).toBeUndefined();
  });

  it("wholly inside a room: a hole in it, the room keeps its shape", () => {
    const { model, id } = drawRoomOver(h(), "g", [[0.5, 3.5], [1.5, 3.5], [1.5, 4.5], [0.5, 4.5]]);
    expect(room(model, "a").rect).toEqual([0, 0, 6, 5]);
    expect(room(model, id).furniture).toEqual([{ type: "table", at: [0.5, 0.5] }]);
  });
});

describe("uncoveredPieces", () => {
  it("only the parts of a new wall where there is no wall yet", () => {
    const walls: [Vec2, Vec2][] = [[[0, 0], [4, 0]], [[6, 0], [7, 0]], [[0, 2], [9, 2]]];
    expect(uncoveredPieces([2, 0], [9, 0], walls)).toEqual([[[4, 0], [6, 0]], [[7, 0], [9, 0]]]);
    expect(uncoveredPieces([1, 2], [5, 2], walls)).toEqual([]);
    expect(uncoveredPieces([1, 1], [5, 1], walls)).toEqual([[[1, 1], [5, 1]]]);
  });
});

describe("turning and moving a floor", () => {
  const h = (): HouseInput => ({
    schema: 2,
    id: "t",
    outline: "auto",
    levels: [
      {
        id: "b",
        rooms: [{ id: "a", area_id: "x", rect: [0, 0, 4, 2], furniture: [{ type: "sofa", at: [1, 1] }], wall_sides: { north: "brick_red" } }],
        openings: [{ room: "a", side: "north", at: 1, width: 1, type: "door" }],
        walls: [{ line: [[0, 3], [4, 3]] }],
      },
    ],
    robots: [{ entity: "vacuum.r", level: "b", dock: [3, 1] }],
  });

  it("a quarter turn: the room on its side, the door on the wall it faces now, in the same place; furniture turned with it", () => {
    const m = transformLevel(h(), "b", { turn: 90, about: [2, 1], by: [0, 0] });
    const l = m.levels[0];
    expect(l.rooms[0].rect).toEqual([1, -1, 2, 4]);
    expect(l.rooms[0].furniture).toEqual([{ type: "sofa", at: [1, 1], rotation: 90 }]);
    expect(l.rooms[0].wall_sides).toEqual({ east: "brick_red" });
    expect(l.openings).toEqual([{ room: "a", side: "east", at: 1, width: 1, type: "door" }]);
    expect(l.walls?.[0].line).toEqual([[0, -1], [0, 3]]);
    expect(m.robots?.[0].dock).toEqual([2, 2]);
    // the house as built: no complaints
    expect(expandHouse(m).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("four quarter turns: as it was; a move moves everything", () => {
    let m = h();
    for (let i = 0; i < 4; i++) m = transformLevel(m, "b", { turn: 90, about: [2, 1], by: [0, 0] });
    const back = m.levels[0];
    expect(back.rooms[0].rect).toEqual([0, 0, 4, 2]);
    expect(back.openings).toEqual(h().levels[0].openings);
    expect(back.rooms[0].furniture?.[0].at).toEqual([1, 1]);
    const moved = transformLevel(h(), "b", { turn: 0, about: [0, 0], by: [1.5, -2] });
    expect(moved.levels[0].rooms[0].rect).toEqual([1.5, -2, 4, 2]);
    expect(moved.levels[0].openings).toEqual(h().levels[0].openings);
    expect(moved.levels[0].rooms[0].furniture).toEqual([{ type: "sofa", at: [1, 1] }]);
  });
});

describe("façade windows", () => {
  it("read with their style (a window over a fixed pane shows as one), changed for every floor sharing them", () => {
    const h: HouseInput = {
      schema: 2,
      id: "f",
      outline: { rect: [0, 0, 6, 8] },
      levels: [{ id: "first", rooms: [{ id: "nora", rect: [0, 0, 6, 8] }] }],
      facade_openings: [{ id: "sw", side: "south", at: 1, width: 1, style: "split_single", split: 1.1, levels: ["first"], covers: { first: "cover.nora" } }],
    };
    expect(readOpening(h, "first", { kind: "facade", index: 0 })).toMatchObject({ style: "split_single", split: 1.1, cover: "cover.nora" });
    const m = updateOpening(h, "first", { kind: "facade", index: 0 }, { style: "split" });
    expect(readOpening(m, "first", { kind: "facade", index: 0 })?.style).toBe("split");
  });
});

describe("a slanted wall between two rooms", () => {
  // two rooms meeting along a slanted line: no compass side to name the wall by
  const slanted = (): HouseInput => ({
    schema: 2,
    id: "s",
    outline: { rect: [0, 0, 8, 4] },
    levels: [
      {
        id: "g",
        rooms: [
          { id: "living", polygon: [[0, 0], [5, 0], [3, 4], [0, 4]] },
          { id: "kitchen", polygon: [[5, 0], [8, 0], [8, 4], [3, 4]] },
        ],
      },
    ],
  });
  const between = (m: HouseInput) => {
    const h = expandHouse(m).house!;
    return deriveWalls(h.levels[0], h.walls).filter((w) => w.rooms.includes("living") && w.rooms.includes("kitchen"));
  };

  it("opens and closes all along", () => {
    expect(between(slanted())[0].type).toBe("interior");
    let m = setBoundaryOpenAll(slanted(), "g", "living", "kitchen", true);
    expect(boundaryOpenAll(m, "g", "kitchen", "living")).toBe(true);
    expect(between(m).every((w) => w.type === "open")).toBe(true);
    m = setBoundaryOpenAll(m, "g", "kitchen", "living", false);
    expect(boundaryOpenAll(m, "g", "living", "kitchen")).toBe(false);
    expect(m.levels[0].walls).toBeUndefined();
  });

  it("takes a thickness all along", () => {
    let m = setBoundaryThickness(slanted(), "g", "living", "kitchen", null, 0.2);
    expect(boundaryThickness(m, "g", "kitchen", "living", null)).toBe(0.2);
    expect(between(m)[0].thickness).toBeCloseTo(0.2);
    m = setBoundaryThickness(m, "g", "living", "kitchen", null, undefined);
    expect(m.levels[0].walls).toBeUndefined();
  });
});

describe("one wall of several between two rooms", () => {
  // an L-shaped boundary: two walls on the living room's east side, one on its south
  const ell = (): HouseInput => ({
    schema: 2,
    id: "l",
    outline: { rect: [0, 0, 8, 4] },
    levels: [
      {
        id: "g",
        rooms: [
          { id: "living", polygon: [[0, 0], [5, 0], [5, 2], [3, 2], [3, 4], [0, 4]] },
          { id: "kitchen", polygon: [[5, 0], [8, 0], [8, 4], [3, 4], [3, 2], [5, 2]] },
        ],
      },
    ],
  });
  const walls = (m: HouseInput) => {
    const h = expandHouse(m).house!;
    return deriveWalls(h.levels[0], h.walls).filter((w) => w.rooms.includes("living") && w.rooms.includes("kitchen"));
  };
  const at = (m: HouseInput, x: number, y: number) => walls(m).find((w) => Math.abs((w.a[0] + w.b[0]) / 2 - x) < 0.01 && Math.abs((w.a[1] + w.b[1]) / 2 - y) < 0.01)!;

  it("opens just the one clicked; the others keep how they are", () => {
    expect(walls(ell())).toHaveLength(3);
    let m = setOpenSegments(ell(), "g", "living", "kitchen", [[[5, 0], [5, 2]]], 3);
    expect(at(m, 5, 1).type).toBe("open");
    expect(at(m, 3, 3).type).toBe("interior");
    expect(at(m, 4, 2).type).toBe("interior");
    // a second one too; then all three: one entry for the pair
    m = setOpenSegments(m, "g", "living", "kitchen", [[[5, 0], [5, 2]], [[3, 2], [3, 4]]], 3);
    expect(walls(m).filter((w) => w.type === "open")).toHaveLength(2);
    m = setOpenSegments(m, "g", "living", "kitchen", walls(ell()).map((w) => w.line), 3);
    expect(m.levels[0].walls).toEqual([{ between: ["living", "kitchen"] }]);
    // and closed again
    m = setOpenSegments(m, "g", "living", "kitchen", [], 3);
    expect(m.levels[0].walls).toBeUndefined();
  });

  it("gives one its own thickness", () => {
    const m = setSegmentThickness(ell(), "g", "living", "kitchen", [[3, 2], [3, 4]], 0.24);
    expect(at(m, 3, 3).thickness).toBeCloseTo(0.24);
    expect(at(m, 5, 1).thickness).toBeCloseTo(expandHouse(ell()).house!.walls.interior);
  });
});

