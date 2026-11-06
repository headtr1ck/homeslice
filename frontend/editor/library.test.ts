import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import type { FurnitureType } from "../model/types";
import { builtinGroups, filterGroups, searchScore } from "./library";

const t = en as Record<string, string>;
const typeName = (type: FurnitureType) => t[`furniture.${type}`] ?? type;
// the library as the editor shows it in English: names, aliases and the group's name to search
const groups = builtinGroups().map((g) => ({
  ...g,
  items: g.items.map((i) => (i.nameKey ? { ...i, name: t[i.nameKey], tags: [...(i.tags ?? []), t[`alias.${i.key.slice(7)}`] ?? "", t[`furniture.group_${g.id}`] ?? ""] } : i)),
}));
const first = (q: string) => {
  const hit = filterGroups(groups, q, typeName)[0]?.items[0];
  return hit ? `${hit.name ?? typeName(hit.type)} (${hit.type})` : "";
};

describe("searching the library", () => {
  it("puts a piece named for the search above one only mentioning it", () => {
    expect(first("fridge")).toMatch(/\(fridge\)$/);
    expect(first("Fridge")).toBe(first("fridge"));
    const fridges = filterGroups(groups, "fridge", typeName).flatMap((g) => g.items.map((i) => i.key));
    expect(fridges.indexOf("modern:fridge_freestanding")).toBeLessThan(fridges.indexOf("modern:kitchen_tall"));
    expect(fridges.indexOf("modern:fridge_double")).toBeLessThan(fridges.indexOf("modern:kitchen_tall"));
  });

  it("gives common searches a sensible first hit", () => {
    const want: Record<string, FurnitureType[]> = {
      sofa: ["sofa", "sofa_corner"],
      bed: ["bed", "bed_single"],
      lamp: ["floor_lamp", "table_lamp", "wall_lamp", "ceiling_lamp"],
      tv: ["tv"],
      shower: ["shower"],
      tree: ["tree", "tree_small", "pine"],
      car: ["car"],
    };
    for (const [q, types] of Object.entries(want)) expect([q, first(q)]).toEqual([q, expect.stringMatching(new RegExp(`\\((${types.join("|")})\\)$`))]);
  });

  it("scores its own name, then aliases, then words only somewhere", () => {
    const item = { key: "x", type: "kitchen" as FurnitureType, model: "x", thumb: "", name: "Tall unit", tags: ["pantry, integrated fridge"] };
    expect(searchScore(item, "tall", typeName)).toBeGreaterThan(searchScore(item, "pantry", typeName));
    expect(searchScore(item, "pantry", typeName)).toBeGreaterThan(searchScore(item, "counter", typeName));
    expect(searchScore(item, "counter", typeName)).toBeGreaterThan(searchScore(item, "fridge", typeName));
    // its type is what was searched for: above the same match of another type
    expect(searchScore({ ...item, name: "Unit" }, "kitchen counter", typeName)).toBeGreaterThan(searchScore({ ...item, type: "item", name: "Unit", tags: ["kitchen counter"] }, "kitchen counter", typeName));
    expect(searchScore(item, "sofa", typeName)).toBe(0);
    // every word somewhere
    expect(searchScore(item, "tall fridge", typeName)).toBeGreaterThan(0);
  });
});
