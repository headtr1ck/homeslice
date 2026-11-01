// The house rules exist twice: here (expand.ts, for the editor and cards) and in the
// integration (validate.py, for the API and AI assistants). This test writes what
// expand.ts says about many broken houses to tests/validation_cases.json; the Python
// tests check validate.py gives the same errors. Regenerate after changing a rule:
//   UPDATE_CASES=1 npx vitest run frontend/model/validation.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { catalog } from "./catalog";
import { expandHouse } from "./expand";

const demo = parse(readFileSync("examples/demo.yaml", "utf8"));

/** A house with a bit of everything: grid, façade windows, stairs, walls, energy, robots. */
const full = {
  schema: 1,
  id: "full",
  grid: { x: { a: 0, b: 4, c: 8 }, y: { top: 0, mid: 5, bottom: 10 } },
  outline: { rect: ["a", "top", 8, 10] },
  facade_openings: [{ id: "col", side: "west", at: 1, width: 1.2, levels: ["g", "f"] }],
  vertical: [{ id: "st", rect: [5, 1, 3, 1.2], from: "g", to: "f", shape: "u_turn" }],
  levels: [
    {
      id: "g",
      rooms: [
        { id: "a", rect: ["a", "top", 4, 5], lights: [{ entity: "light.a", at: [1, 1] }], furniture: [{ type: "sofa", at: [2, 2], model: "modern:sofa", finish: "grey", accent: "oak" }] },
        { id: "b", polygon: [["b", "top"], ["c", "top"], ["c", "mid"], ["b", "mid"]] },
        { id: "c", rect: [0, 5, 8, 5], floor: "oak_herringbone", wall: "paint_sage", wall_sides: { north: "acoustic_oak" } },
      ],
      openings: [{ room: "a", side: "north", at: 1, width: 1, type: "door", style: "glass" }],
      walls: [{ between: ["a", "b"] }, { between: ["a", "c"], type: "wall", thickness: 0.2 }, { line: [[1, 7], [3, 7]] }],
    },
    { id: "f", rooms: [{ id: "x", rect: [0, 0, 8, 10] }] },
  ],
  roof: { ridge: "east_west", pitch: 30 },
  energy: [
    { kind: "solar", roof: "south" },
    { kind: "battery", level: "g", at: [1, 1] },
    { kind: "device", name: "Washer", level: "g", at: [2, 2], power: "sensor.washer_power", to: "battery" },
  ],
  robots: [{ entity: "vacuum.robo", level: "g", dock: [1, 1] }],
  inverted_covers: ["cover.awning"],
  north: 20,
  facade: "brick_red",
};

type House = Record<string, any>;
const clone = (h: House): House => JSON.parse(JSON.stringify(h));
const L = (h: House, i = 0) => h.levels[i];

/** Each case breaks one rule (or a few). */
const MUTATIONS: [string, (h: House) => unknown][] = [
  ["not a mapping", () => "just text"],
  ["empty", () => null],
  ["wrong schema", (h) => ((h.schema = 2), h)],
  ["schema as text", (h) => ((h.schema = "1"), h)],
  ["no levels", (h) => ((h.levels = []), h)],
  ["levels not a list", (h) => ((h.levels = { g: {} }), h)],
  ["level without id", (h) => (delete L(h).id, h)],
  ["duplicate level", (h) => ((L(h, 1).id = "g"), h)],
  ["room without id", (h) => (delete L(h).rooms[0].id, h)],
  ["duplicate room", (h) => ((L(h).rooms[1].id = "a"), h)],
  ["room without shape", (h) => (delete L(h).rooms[2].rect, h)],
  ["rect with zero width", (h) => ((L(h).rooms[2].rect = [0, 5, 0, 5]), h)],
  ["rect with text size", (h) => ((L(h).rooms[2].rect = [0, 5, "wide", 5]), h)],
  ["unknown grid name", (h) => ((L(h).rooms[0].rect = ["z", "top", 4, 5]), h)],
  ["grid name without grid", (h) => (delete h.grid, h)],
  ["polygon too short", (h) => ((L(h).rooms[1].polygon = [[0, 0], [1, 1]]), h)],
  ["polygon on a line", (h) => ((L(h).rooms[1].polygon = [[0, 0], [1, 1], [2, 2]]), h)],
  ["rect and polygon (only a warning)", (h) => ((L(h).rooms[1].rect = [4, 0, 4, 5]), h)],
  ["unknown floor", (h) => ((L(h).rooms[2].floor = "lava"), h)],
  ["floor a number", (h) => ((L(h).rooms[2].floor = 3), h)],
  ["valid: floor texture", (h) => ((L(h).rooms[2].floor = "polyhaven:wood_floor"), h)],
  ["wall finish on a floor", (h) => ((L(h).rooms[2].floor = "paint_sage"), h)],
  ["unknown wall", (h) => ((L(h).rooms[2].wall = "glitter"), h)],
  ["wall_sides a list", (h) => ((L(h).rooms[2].wall_sides = ["north"]), h)],
  ["wall_sides bad side", (h) => ((L(h).rooms[2].wall_sides = { up: "paint_white" }), h)],
  ["wall_sides bad finish", (h) => ((L(h).rooms[2].wall_sides = { north: "oak_herringbone" }), h)],
  ["bad facade", (h) => ((h.facade = "gold"), h)],
  ["light not a light", (h) => ((L(h).rooms[0].lights = [{ entity: "switch.a" }]), h)],
  ["light without entity", (h) => ((L(h).rooms[0].lights = [{}]), h)],
  ["light at wrong", (h) => ((L(h).rooms[0].lights = [{ entity: "light.a", at: [1] }]), h)],
  ["camera not a camera", (h) => ((L(h).rooms[0].cameras = [{ entity: "light.a", at: [1, 1] }]), h)],
  ["camera without at", (h) => ((L(h).rooms[0].cameras = [{ entity: "camera.a" }]), h)],
  ["camera fov wrong", (h) => ((L(h).rooms[0].cameras = [{ entity: "camera.a", at: [1, 1], fov: 2 }]), h)],
  ["camera motion wrong", (h) => ((L(h).rooms[0].cameras = [{ entity: "camera.a", at: [1, 1], motion: 3 }]), h)],
  ["valid: a camera", (h) => ((L(h).rooms[0].cameras = [{ entity: "camera.a", at: [0.2, 0.2], direction: 135, fov: 100, range: 6, height: 2.5, motion: "binary_sensor.a" }]), h)],
  ["light type unknown", (h) => ((L(h).rooms[0].lights = [{ entity: "light.a", type: "laser" }]), h)],
  ["light spots wrong", (h) => ((L(h).rooms[0].lights = [{ entity: "light.a", type: "spot", spots: [[1, 1], [2]] }]), h)],
  ["light to wrong", (h) => ((L(h).rooms[0].lights = [{ entity: "light.a", at: [1, 1], to: "east" }]), h)],
  ["light height wrong", (h) => ((L(h).rooms[0].lights = [{ entity: "light.a", height: 9 }]), h)],
  ["strip without to", (h) => ((L(h).rooms[0].lights = [{ entity: "light.a", type: "strip", at: [1, 1] }]), h)],
  ["valid: spots and a strip", (h) => ((L(h).rooms[0].lights = [{ entity: "light.a", type: "spot", at: [1, 1], spots: [[2, 1]] }, { entity: "light.b", type: "strip", at: [0.2, 0.2], to: [3, 0.2], height: 2.4 }, { entity: "light.c", type: "indirect" }]), h)],
  ["furniture unknown type", (h) => ((L(h).rooms[0].furniture = [{ type: "throne", at: [1, 1] }]), h)],
  ["furniture without at", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa" }]), h)],
  ["furniture bad size", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa", at: [1, 1], size: [0, 1] }]), h)],
  ["furniture bad mount", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa", at: [1, 1], mount: "roof" }]), h)],
  ["furniture bad height", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa", at: [1, 1], height: -1 }]), h)],
  ["furniture bad model", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa", at: [1, 1], model: "ikea:klippan" }]), h)],
  ["furniture model number", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa", at: [1, 1], model: 3 }]), h)],
  ["furniture bad accent", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa", at: [1, 1], accent: ["black"] }]), h)],
  ["furniture bad finish", (h) => ((L(h).rooms[0].furniture = [{ type: "sofa", at: [1, 1], finish: 7 }]), h)],
  ["opening unknown room", (h) => ((L(h).openings[0].room = "zz"), h)],
  ["opening bad side", (h) => ((L(h).openings[0].side = "up"), h)],
  ["opening without side", (h) => (delete L(h).openings[0].side, h)],
  ["opening bad type", (h) => ((L(h).openings[0].type = "hatch"), h)],
  ["opening without width", (h) => (delete L(h).openings[0].width, h)],
  ["opening zero width", (h) => ((L(h).openings[0].width = 0), h)],
  ["wall between unknown", (h) => ((L(h).walls[0].between = ["a", "q"]), h)],
  ["wall between three", (h) => ((L(h).walls[0].between = ["a", "b", "c"]), h)],
  ["wall bad side", (h) => ((L(h).walls[0].side = "up"), h)],
  ["wall bad thickness", (h) => ((L(h).walls[1].thickness = 5), h)],
  ["wall line too short", (h) => ((L(h).walls[2].line = [[1, 7], [1.01, 7]]), h)],
  ["wall with nothing", (h) => ((L(h).walls[2] = { type: "wall" }), h)],
  ["no outline", (h) => (delete h.outline, h)],
  ["level outline bad", (h) => ((L(h, 1).outline = { rect: [0, 0, -1, 2] }), h)],
  ["include_floors not a list", (h) => ((L(h).include_floors = "outside"), h)],
  ["include_floors numbers", (h) => ((L(h).include_floors = [1]), h)],
  ["facade bad side", (h) => ((h.facade_openings[0].side = "top"), h)],
  ["facade no width", (h) => ((h.facade_openings[0].width = 0), h)],
  ["facade bad type", (h) => ((h.facade_openings[0].type = "porthole"), h)],
  ["facade unknown level", (h) => ((h.facade_openings[0].levels = ["g", "attic"]), h)],
  ["stairs unknown from", (h) => ((h.vertical[0].from = "cellar"), h)],
  ["stairs unknown to", (h) => ((h.vertical[0].to = "roof"), h)],
  ["stairs down", (h) => ((h.vertical[0].from = "f"), (h.vertical[0].to = "g"), h)],
  ["stairs bad shape", (h) => ((h.vertical[0].shape = "spiral"), h)],
  ["stairs bad up", (h) => ((h.vertical[0].up = "down"), h)],
  ["stairs bad start", (h) => ((h.vertical[0].start = "east"), h)],
  ["stairs bad entry", (h) => ((h.vertical[0].entry = 2.9), h)],
  ["stairs entry text", (h) => ((h.vertical[0].entry = "1"), h)],
  ["stairs without shape", (h) => (delete h.vertical[0].rect, h)],
  ["roof bad ridge", (h) => ((h.roof.ridge = "diagonal"), h)],
  ["roof steep", (h) => ((h.roof.pitch = 80), h)],
  ["roof flat", (h) => ((h.roof.pitch = 0), h)],
  ["energy bad kind", (h) => ((h.energy[0].kind = "wind"), h)],
  ["energy null", (h) => ((h.energy[0] = null), h)],
  ["energy without level", (h) => (delete h.energy[1].level, h)],
  ["energy unknown level", (h) => ((h.energy[1].level = "loft"), h)],
  ["energy without at", (h) => (delete h.energy[1].at, h)],
  ["device without power", (h) => (delete h.energy[2].power, h)],
  ["energy bad roof", (h) => ((h.energy[0].roof = "up"), h)],
  ["energy duplicate id", (h) => ((h.energy[1].id = "x"), (h.energy[2].id = "x"), h)],
  ["energy to unknown", (h) => ((h.energy[2].to = "grid"), h)],
  ["energy to itself", (h) => ((h.energy[2].id = "w"), (h.energy[2].to = "w"), h)],
  ["energy same names", (h) => ((h.energy[1].name = "Washer"), (h.energy[1].to = "washer_2"), h)],
  ["inverted_covers not a list", (h) => ((h.inverted_covers = "cover.awning"), h)],
  ["robot not a robot", (h) => ((h.robots[0].entity = "light.robo"), h)],
  ["robot unknown level", (h) => ((h.robots[0].level = "attic"), h)],
  ["robot without dock", (h) => (delete h.robots[0].dock, h)],
  ["north as text", (h) => ((h.north = "NNE"), h)],
  ["underfloor not an entity", (h) => ((L(h).rooms[0].underfloor = "warm"), h)],
  ["dormer without side", (h) => ((h.roof = { dormers: [{ at: 2 }] }), h)],
  ["dormer too wide", (h) => ((h.roof = { dormers: [{ side: "south", at: 2, width: 9 }] }), h)],
  ["railing odd", (h) => ((L(h).rooms[0].railing = "rope"), h)],
  ["roof odd shape", (h) => ((h.roof = { shape: "dome" }), h)],
  ["roof odd finish", (h) => ((h.roof = { finish: "straw" }), h)],
  ["roof window without at", (h) => ((h.roof = { windows: [{ side: "south" }] }), h)],
  ["roof window too big", (h) => ((h.roof = { windows: [{ side: "south", at: 2, width: 5 }] }), h)],
  ["roof window cover not a cover", (h) => ((h.roof = { windows: [{ side: "south", at: 2, cover: "light.x" }] }), h)],
  ["dormer odd shape", (h) => ((h.roof = { dormers: [{ side: "south", at: 2, shape: "round" }] }), h)],
  ["energy details not entities", (h) => ((h.energy[2].details = ["cop"]), h)],
  ["furniture readings not entities", (h) => ((L(h).rooms[0].furniture = [{ type: "car", at: [1, 1], readings: ["range"] }]), h)],
  ["errors hide later checks", (h) => ((h.north = "NNE"), (h.roof.pitch = 90), h)],
  ["several errors at once", (h) => ((L(h).openings[0].room = "zz"), (L(h).rooms[0].furniture[0].type = "x"), (h.energy[0].kind = "?"), h)],
];

function cases() {
  const out: { name: string; house: unknown; errors: { path: string; message: string }[] }[] = [];
  const add = (name: string, house: unknown) => out.push({ name, house, errors: expandHouse(house).issues.filter((i) => i.severity === "error").map(({ path, message }) => ({ path, message })) });
  add("demo", demo);
  add("full", full);
  for (const [name, mutate] of MUTATIONS) add(name, mutate(clone(full)));
  return out;
}

const FILE = "tests/validation_cases.json";
const CATALOG = "custom_components/homeslice/catalog.json";

describe("the integration's copy of the rules", () => {
  it("the valid houses are valid and every broken one says why", () => {
    const c = cases();
    expect(c[0].errors).toEqual([]);
    expect(c[1].errors).toEqual([]);
    for (const x of c.slice(2)) if (!x.name.includes("only a warning") && !x.name.startsWith("valid")) expect(x.errors.length, x.name).toBeGreaterThan(0);
  });

  it("tests/validation_cases.json is up to date (UPDATE_CASES=1 to rewrite)", () => {
    const text = JSON.stringify(cases(), null, 1) + "\n";
    if (process.env.UPDATE_CASES) writeFileSync(FILE, text);
    expect(existsSync(FILE) && readFileSync(FILE, "utf8") === text, `${FILE} is out of date: UPDATE_CASES=1 npx vitest run frontend/model/validation.test.ts`).toBe(true);
  });

  it("catalog.json is up to date (node scripts/catalog.mjs)", () => {
    expect(JSON.parse(readFileSync(CATALOG, "utf8")), `${CATALOG} is out of date: node scripts/catalog.mjs`).toEqual(JSON.parse(JSON.stringify(catalog())));
  });
});
