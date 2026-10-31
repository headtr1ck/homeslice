import { describe, expect, it } from "vitest";
import { expandHouse } from "../model/expand";
import { OPENING_PRESETS, applyPreset, presetOf } from "./openings";

describe("door & window library", () => {
  it("recognises an opening's preset and applies one", () => {
    expect(presetOf({ type: "door", style: "double", width: 1.5 })?.id).toBe("door_double");
    expect(presetOf({ width: 1.0, sill: 0, style: "double" })?.id).toBe("window_floor");
    expect(presetOf({ width: 1.0 })?.id).toBe("window");
    const arch = OPENING_PRESETS.find((p) => p.id === "opening_arch")!;
    expect(applyPreset(arch)).toEqual({ type: "opening", style: "arch", width: 1.2, sill: undefined, height: undefined });
  });
  it("kinds and how they open have defaults", () => {
    const { house } = expandHouse({
      schema: 1,
      id: "o",
      outline: { rect: [0, 0, 5, 5] },
      levels: [{ id: "g", rooms: [{ id: "r", rect: [0, 0, 5, 5] }], openings: [{ room: "r", side: "south", at: 1, width: 1, type: "door", hinge: "right", swing: "out" }, { room: "r", side: "north", at: 1, width: 1, type: "opening" }] }],
    });
    expect(house!.levels[0].openings.map((o) => [o.style, o.hinge, o.swing])).toEqual([
      ["single", "right", "out"],
      ["square", "left", "in"],
    ]);
  });
});
