import { describe, expect, it } from "vitest";
import { extractYaml, mapFloor, mapNotes, mapScale } from "./start";

describe("the start screen's helpers", () => {
  const floors = [
    { floor_id: "ground_floor", name: "Ground Floor" },
    { floor_id: "basement", name: "Basement" },
    { floor_id: "upper_ground_floor", name: "Upper ground floor" },
  ];
  it("finds the floor a robot's map shows by its name", () => {
    expect(mapFloor("Saros 10 Ground floor", floors)).toBe("ground_floor");
    expect(mapFloor("saros_10_basement", floors)).toBe("basement");
    expect(mapFloor("Saros 10 Upper ground floor", floors)).toBe("upper_ground_floor");
    expect(mapFloor("Roborock Q10 Series Map", floors)).toBeUndefined();
  });
  it("knows Roborock's map scale, not others'", () => {
    expect(mapScale("roborock")).toBe(0.0125);
    expect(mapScale("xiaomi_miio")).toBeNull();
  });
  it("takes the YAML out of an assistant's answer", () => {
    expect(extractYaml("Here you go:\n```yaml\nschema: 1\nid: home\n```\nEnjoy")).toBe("schema: 1\nid: home");
    expect(extractYaml("schema: 1\nid: home\n")).toBe("schema: 1\nid: home");
  });
  it("tells an assistant what the maps are: scale, floor, room colours and names", () => {
    const notes = mapNotes([{ name: "Saros 10 Ground floor", floor: "ground_floor", scale: 0.0125, rooms: { 1: "Living room", 4: "Kitchen" } }]);
    expect(notes).toContain("12.5 mm per pixel");
    expect(notes).toContain('room 1, "Living room": sand');
    expect(notes).toContain('room 4, "Kitchen": blue');
    expect(mapNotes([])).toBe("");
  });
});
