import { describe, expect, it } from "vitest";
import { sunPath, sunPosition } from "./sunpath";

describe("the sun's path", () => {
  // Augsburg-ish, 21 June 2026, 11:20 UTC is about solar noon
  const lat = 48.37;
  const lon = 10.9;

  it("stands in the south at noon, as high as summer allows", () => {
    const p = sunPosition(new Date(Date.UTC(2026, 5, 21, 11, 17)), lat, lon);
    expect(p.azimuth).toBeGreaterThan(175);
    expect(p.azimuth).toBeLessThan(185);
    expect(p.elevation).toBeCloseTo(90 - lat + 23.44, 0);
  });

  it("rises in the north-east and sets in the north-west in summer", () => {
    const path = sunPath(new Date(2026, 5, 21, 12), lat, lon);
    const up = path.filter((p) => p.elevation > 0);
    expect(up[0].azimuth).toBeGreaterThan(40);
    expect(up[0].azimuth).toBeLessThan(65);
    expect(up.at(-1)!.azimuth).toBeGreaterThan(295);
    expect(up.at(-1)!.azimuth).toBeLessThan(320);
  });

  it("is empty in the polar night", () => {
    expect(sunPath(new Date(2026, 11, 21, 12), 80, 15)).toEqual([]);
  });
});
