// The demo site's houses (examples/houses/*.yaml, furnished as the site shows them): valid,
// every room reachable from an entrance, no piece in a wall, nothing left on the editor's checklist.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checklist } from "../editor/checklist";
import type { Hass } from "../ha/hass";
import { piecesInWalls, unreachableRooms } from "./checks";
import { expandHouse } from "./expand";
import type { HouseInput } from "./types";
import { deriveWalls } from "./walls";
// @ts-expect-error: a plain script without types (the demo site's builder uses it too)
import { houses } from "../../scripts/demo-model.mjs";

const ids = readdirSync("examples/houses").filter((f) => f.endsWith(".yaml")).map((f) => f.replace(/\.yaml$/, ""));

describe("demo houses", () => {
  it("each has its pretend Home Assistant", () => {
    expect(Object.keys(houses).sort()).toEqual([...ids].sort());
  });
  it.each(ids)("%s is valid, reachable and has nothing in its walls", (id) => {
    const fixture = houses[id]();
    const model = fixture.model as HouseInput;
    const { house, issues } = expandHouse(model);
    const all = [...issues];
    const walls = new Map(house!.levels.map((l) => [l.id, deriveWalls(l, house!.walls, all)]));
    expect(all.map((i) => `${i.severity}: ${i.path}: ${i.message}`)).toEqual([]);
    expect(unreachableRooms(house!, walls)).toEqual([]);
    expect(piecesInWalls(house!, walls)).toEqual([]);
    // every area on a level's floor has its room, every blind and contact its window or door
    const areas = Object.values(fixture.areas) as { area_id: string; name: string; floor_id: string }[];
    const levelAreas = (levelId: string) => {
      const l = model.levels.find((x) => x.id === levelId)!;
      return areas.filter((a) => a.floor_id === l.floor_id || l.include_floors?.includes(a.floor_id));
    };
    expect(checklist(model, fixture as unknown as Hass, levelAreas)).toEqual([]);
    // the areas the rooms name and the entities the house links are in Home Assistant
    const linked = JSON.stringify(model).match(/"(light|cover|climate|media_player|switch|lock|binary_sensor|sensor|device_tracker|lawn_mower|vacuum)\.[a-z0-9_]+"/g) ?? [];
    for (const e of linked) expect(fixture.states, e).toHaveProperty([JSON.parse(e)]);
    for (const r of model.levels.flatMap((l) => l.rooms)) if (r.area_id) expect(fixture.areas, r.area_id).toHaveProperty([r.area_id]);
  });
});
