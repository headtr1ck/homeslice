import { describe, expect, it } from "vitest";
import type { Hass } from "../ha/hass";
import type { HouseInput } from "../model/types";
import { applyAll, checklist } from "./checklist";

const model = (): HouseInput => ({
  schema: 1,
  id: "t",
  outline: { rect: [0, 0, 10, 8] },
  levels: [
    {
      id: "g",
      floor_id: "ground",
      rooms: [{ id: "living", area_id: "living", rect: [0, 0, 10, 8] }],
      openings: [
        { room: "living", side: "south", at: 1, width: 2 },
        { room: "living", side: "west", at: 2, width: 1 },
        { room: "living", side: "north", at: 4, width: 1, type: "door" },
      ],
    },
  ],
});

const state = (entity_id: string, device_class: string, friendly_name: string) => ({ entity_id, state: "open", attributes: { device_class, friendly_name } });
const hass = {
  areas: { living: { area_id: "living", name: "Living", floor_id: "ground" }, office: { area_id: "office", name: "Office", floor_id: "ground" } },
  entities: {
    "cover.living_west": { entity_id: "cover.living_west", area_id: "living" },
    "cover.living_south": { entity_id: "cover.living_south", area_id: "living" },
    "binary_sensor.front_door": { entity_id: "binary_sensor.front_door", area_id: "living" },
    "cover.loose": { entity_id: "cover.loose", area_id: null },
  },
  states: {
    "cover.living_west": state("cover.living_west", "blind", "Living West"),
    "cover.living_south": state("cover.living_south", "shutter", "Living Süd"),
    "binary_sensor.front_door": state("binary_sensor.front_door", "door", "Front door"),
    "cover.loose": state("cover.loose", "blind", "Somewhere"),
  },
} as unknown as Hass;

describe("checklist", () => {
  const areas = () => [
    { area_id: "living", name: "Living" },
    { area_id: "office", name: "Office" },
  ];
  it("finds areas without a room and links blinds and contacts to the right windows", () => {
    const items = checklist(model(), hass, areas);
    expect(items.find((i) => i.kind === "area")).toMatchObject({ level: "g", area: "office" });
    const west = items.find((i) => i.kind === "cover" && i.entity === "cover.living_west");
    const south = items.find((i) => i.kind === "cover" && i.entity === "cover.living_south");
    const door = items.find((i) => i.kind === "contact");
    expect(west && "target" in west && west.target?.side).toBe("west");
    expect(south && "target" in south && south.target?.side).toBe("south");
    expect(door && "target" in door && door.target?.side).toBe("north");
    // a blind in no area: listed, but nothing to suggest
    expect(items.find((i) => i.kind === "cover" && i.entity === "cover.loose")).toMatchObject({ kind: "cover", entity: "cover.loose" });
    const fixed = applyAll(model(), items);
    expect(fixed.levels[0].openings!.map((o) => [o.cover, o.contact])).toEqual([
      ["cover.living_south", undefined],
      ["cover.living_west", undefined],
      [undefined, "binary_sensor.front_door"],
    ]);
    // once linked, they are off the list
    expect(checklist(fixed, hass, areas).filter((i) => i.kind === "cover" || i.kind === "contact").map((i) => "entity" in i && i.entity)).toEqual(["cover.loose"]);
  });
});
