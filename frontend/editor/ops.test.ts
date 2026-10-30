import { describe, expect, it } from "vitest";
import type { HouseInput } from "../model/types";
import { History, addRoom, area, cornerAngle, deleteRoom, moveEdge, moveVertex, removeVertex, roomPolygon, snap, splitEdge, updateRoom } from "./ops";

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
    expect(snap([5.08, 0.05], ctx)).toEqual({ p: [5, 0], kind: "point" });
    expect(snap([2.1, 3.33], ctx)).toEqual({ p: [2, 3.3], kind: "align" });
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
