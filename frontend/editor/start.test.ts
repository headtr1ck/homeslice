import { describe, expect, it } from "vitest";
import { assignMaps, bestMatch, extractYaml, mapNotes, mapScale, ownNames, similarity } from "./start";

const floor = (floor_id: string, name: string, areas: string[] = []) => ({ floor_id, name, areas });
const map = (id: string, name: string, rooms: string[] = []) => ({ id, name, rooms });

describe("which robot map shows which floor", () => {
  const floors = [floor("second_floor", "Second Floor"), floor("first_floor", "First Floor"), floor("ground_floor", "Ground Floor"), floor("basement", "Basement")];

  it("by name, however it is written", () => {
    expect(assignMaps([map("a", "ground floor"), map("b", "basement")], floors)).toEqual({ ground_floor: "a", basement: "b" });
    for (const written of ["groundfloor", "ground-floor", "Ground  Floor", "grond floor"]) expect(assignMaps([map("a", written)], floors)).toEqual({ ground_floor: "a" });
    expect(assignMaps([map("a", "1st floor")], floors)).toEqual({ first_floor: "a" });
    expect(assignMaps([map("a", "Erdgeschoß")], [floor("eg", "Erdgeschoss"), floor("og", "Obergeschoss")])).toEqual({ eg: "a" });
  });

  it("the closer name wins, each floor and each map used once", () => {
    const two = [floor("ug", "Upper ground floor"), floor("g", "Ground floor")];
    expect(assignMaps([map("a", "ground floor"), map("b", "upper ground floor")], two)).toEqual({ g: "a", ug: "b" });
  });

  it("by the rooms on it when the names don't help (another language, a map called Map 1)", () => {
    const de = [floor("eg", "Erdgeschoss", ["Küche", "Wohnzimmer", "Flur"]), floor("keller", "Keller", ["Technikraum", "Gästezimmer"])];
    const maps = [map("a", "ground floor", ["Wohnzimmer", "Küche", "Bad"]), map("b", "map 2", ["Technikraum", "Gaestezimmer", "Lager"])];
    expect(assignMaps(maps, de)).toEqual({ eg: "a", keller: "b" });
  });

  it("a map that looks like no floor is none's", () => {
    expect(assignMaps([map("a", "map"), map("b", "q10 series map")], floors)).toEqual({});
  });

  it("a map's own name: what a robot's maps share in front taken off (or the device's name)", () => {
    expect(
      ownNames([
        { id: "a", name: "Saros 10 Ground Floor", robot: "saros" },
        { id: "b", name: "Saros 10 Basement", robot: "saros" },
        { id: "c", name: "Kellerbot Erdgeschoss", robot: "k", device: "Kellerbot" },
      ]),
    ).toEqual({ a: "ground floor", b: "basement", c: "erdgeschoss" });
    // a robot named after a floor: its map is not that floor's
    const kf = [floor("keller", "Keller"), floor("eg", "Erdgeschoss")];
    expect(assignMaps([map("c", "erdgeschoss")], kf)).toEqual({ eg: "c" });
  });

  it("names alike: spelling, spaces and small typos barely matter", () => {
    expect(similarity("Living room", "Livingroom")).toBeGreaterThan(0.9);
    expect(similarity("Kitchen", "Bathroom")).toBeLessThan(0.3);
    expect(bestMatch("Living room", [{ n: "Living Room" }, { n: "Kitchen" }], (o) => o.n)?.n).toBe("Living Room");
    expect(bestMatch("Guest bedroom", [{ n: "Kitchen" }], (o) => o.n)).toBeUndefined();
    // among a floor's few areas, less alike will do; house-wide only close names
    expect(bestMatch("Guest bedroom", [{ n: "Guest Room" }, { n: "Corridor" }], (o) => o.n, 0.6)?.n).toBe("Guest Room");
    expect(bestMatch("Bedroom", [{ n: "Bathroom" }], (o) => o.n, 0.6)).toBeUndefined();
    expect(bestMatch("Hall", [{ n: "Hallway" }], (o) => o.n)).toBeUndefined();
  });
});

describe("the start screen's other helpers", () => {
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
