import { describe, expect, it } from "vitest";
import { bbox } from "../model/geometry";
import { ROOM_COLORS, roomsFromMap } from "./robotmap";

/** A map picture: rooms as rectangles in their palette colour, walls round them, a cleaning path and a sofa over the first. */
function map() {
  const width = 240;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: number[]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        data.set([r, g, b, 255], i);
      }
  };
  const wall = [93, 109, 126];
  paint(8, 8, 172, 132, wall);
  paint(12, 12, 120, 128, ROOM_COLORS[0]); // room 1: 108 × 116 px
  paint(124, 12, 168, 80, ROOM_COLORS[3]); // room 4: 44 × 68 px
  // the cleaning path over room 1, and a sofa it drove round
  for (let x = 20; x < 110; x += 9) paint(x, 14, x + 2, 126, [147, 194, 238]);
  paint(50, 60, 80, 75, [0, 0, 0]);
  return { width, height, data };
}

describe("rooms from a robot's map", () => {
  it("each room colour is a room: what is drawn over it filled in, its outline straight", () => {
    const rooms = roomsFromMap(map(), { minArea: 400 });
    expect(rooms.map((r) => r.number)).toEqual([1, 4]);
    const living = bbox(rooms[0].polygon);
    // reaches a little into the walls round it (2 cells of 4 px), not into the other room
    expect(living.min[0]).toBeLessThanOrEqual(12);
    expect(living.min[0]).toBeGreaterThanOrEqual(4);
    expect(living.max[0]).toBeLessThanOrEqual(128);
    expect(living.max[1]).toBeGreaterThanOrEqual(128);
    const kitchen = rooms[1].polygon;
    expect(kitchen).toHaveLength(4);
    // every wall straight along an axis
    for (const room of rooms)
      room.polygon.forEach((p, i) => {
        const q = room.polygon[(i + 1) % room.polygon.length];
        expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
      });
  });

  it("a speck of a room colour is no room", () => {
    const img = map();
    expect(roomsFromMap(img, { minArea: 20000 }).map((r) => r.number)).toEqual([]);
  });
});
