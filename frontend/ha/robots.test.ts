import { describe, expect, it } from "vitest";
import { gpsToMetres, readRobot, readingToPlan, robotStatus } from "./robots";
import type { Hass } from "./hass";
import type { Robot } from "../model/types";

describe("robots", () => {
  it("groups HA's states", () => {
    expect(["cleaning", "mowing", "docked", "charging", "returning", "error", "weird"].map(robotStatus)).toEqual(["active", "active", "docked", "docked", "returning", "error", "unknown"]);
  });
  it("maps map units to the plan from two points (turned and scaled)", () => {
    // map: mm, y up, turned 90°: map (25000, 25000) is plan (2, 3), map (26000, 25000) is plan (2, 2)
    const pts: [[number, number], [number, number]][] = [
      [[25000, 25000], [2, 3]],
      [[26000, 25000], [2, 2]],
    ];
    const p = readingToPlan([25500, 25500], pts, false)!;
    expect(p[0]).toBeCloseTo(2.5);
    expect(p[1]).toBeCloseTo(2.5);
  });
  it("handles a mirrored map with three points", () => {
    const pts: [[number, number], [number, number]][] = [
      [[0, 0], [1, 1]],
      [[1000, 0], [2, 1]],
      [[0, 1000], [1, 0]], // y up on the map, down on the plan
    ];
    expect(readingToPlan([500, 500], pts, false)).toEqual([1.5, 0.5]);
  });
  it("converts GPS to metres and onto the plan", () => {
    const [e, s] = gpsToMetres([48.0001, 10.0001], [48, 10]);
    expect(e).toBeCloseTo(7.45, 1);
    expect(s).toBeCloseTo(-11.06, 1);
    const pts: [[number, number], [number, number]][] = [
      [[48, 10], [0, 20]],
      [[48, 10.0001], [7.45, 20]],
    ];
    const p = readingToPlan([48, 10.00005], pts, true)!;
    expect(p[0]).toBeCloseTo(3.72, 1);
    expect(p[1]).toBeCloseTo(20, 1);
  });
  it("is at the dock while docked; live when calibrated", () => {
    const robot: Robot = { index: 0, entity: "vacuum.r", kind: "vacuum", levelIndex: 0, dock: [1, 1] };
    const hass = (state: string, attrs = {}) => ({ states: { "vacuum.r": { entity_id: "vacuum.r", state, attributes: { battery_level: 80, ...attrs } } } }) as unknown as Hass;
    expect(readRobot(hass("docked"), robot)).toMatchObject({ status: "docked", at: [1, 1], battery: 80, live: false });
    expect(readRobot(hass("cleaning"), robot).at).toBeNull();
    const calibrated: Robot = { ...robot, position: { entity: "vacuum.r", attribute: "pos", points: [[[0, 0], [0, 0]], [[1000, 0], [1, 0]]] } };
    expect(readRobot(hass("cleaning", { pos: { x: 500, y: 0 } }), calibrated)).toMatchObject({ at: [0.5, 0], live: true });
  });
});
