import { describe, expect, it } from "vitest";
import { extractYaml, mapFloor, mapNotes, mapOwnName, mapScale } from "./start";

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
    // written together, with a dash, or with an ordinal
    expect(mapFloor("Saros 10 Groundfloor", floors)).toBe("ground_floor");
    expect(mapFloor("saros_10_ground-floor", floors)).toBe("ground_floor");
    expect(mapFloor("Q10 1st floor", [...floors, { floor_id: "first_floor", name: "First floor" }])).toBe("first_floor");
    expect(mapFloor("Robo Erdgeschoß", [{ floor_id: "eg", name: "Erdgeschoss" }, { floor_id: "og", name: "Obergeschoß" }])).toBe("eg");
    expect(mapFloor("Robo Obergeschoss", [{ floor_id: "og", name: "Obergeschoss" }])).toBe("og");
  });
  it("compares only the map's own name, not its robot's", () => {
    const keller = [{ floor_id: "keller", name: "Keller" }, { floor_id: "eg", name: "Erdgeschoss" }];
    // a robot named after a floor: its ground floor map is not the cellar's
    expect(mapFloor(mapOwnName("Kellerbot Erdgeschoss", "image.kellerbot_erdgeschoss", "Kellerbot"), keller)).toBe("eg");
    expect(mapOwnName("Saros 10 Ground Floor", "image.saros_10_ground_floor", "Saros 10")).toBe("ground floor ground floor");
    expect(mapOwnName("Q10 Map", "image.q10_map", undefined)).toBe("Q10 Map q10 map");
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
