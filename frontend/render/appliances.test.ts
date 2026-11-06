import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MODERN } from "../model/modern";
import { buildModern } from "./modern";

/** Roles of the materials a linked piece drives (scene.ts setDevice), and whether it has a spinner. */
function driven(id: string, options: Record<string, string> = {}) {
  const def = MODERN[id];
  expect(def, id).toBeTruthy();
  const g = buildModern(id, [def.size[0], def.size[1]], def.size[2], undefined, undefined, options);
  expect(g, id).toBeTruthy();
  const roles = new Set<string>();
  let spinners = 0;
  g!.traverse((o) => {
    if (o.userData.spin) spinners++;
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.part) roles.add(m.userData.part as string);
  });
  return { roles, spinners };
}

describe("linked appliances react", () => {
  const cases: [string, Record<string, string>, string[]][] = [
    ["kitchen_tall", { fronts: "oven" }, ["cook", "screen"]],
    ["kitchen_tall", { fronts: "oven_microwave" }, ["cook", "screen"]],
    ["kitchen_tall", { fronts: "oven_steam" }, ["cook"]],
    ["kitchen_tall", { fronts: "coffee" }, ["screen", "led"]],
    ["kitchen_tall", { fronts: "dishwasher" }, ["led"]],
    ["kitchen_base", { top: "hob_ceran", fronts: "oven" }, ["cook", "screen"]],
    ["kitchen_base", { top: "hob_gas", fronts: "oven" }, ["cook", "fire"]],
    ["kitchen_base", { top: "hob_electric" }, ["cook"]],
    ["kitchen_base", { top: "hob_downdraft" }, ["cook"]],
    ["kitchen_dishwasher", {}, ["led"]],
    ["kitchen_hood", {}, ["cook", "led"]],
    ["microwave", {}, ["cook", "screen"]],
    ["coffee_capsule", {}, ["led"]],
    ["coffee_automatic", {}, ["screen", "led"]],
    ["coffee_portafilter", {}, ["led"]],
    ["toaster", {}, ["cook"]],
    ["kettle", {}, ["cook", "led"]],
    ["fridge_freestanding", {}, ["led"]],
    ["fridge_double", {}, ["led"]],
    ["wine_fridge", {}, ["led"]],
    ["freezer_chest", {}, ["led"]],
    ["vacuum_stick", {}, ["led"]],
    ["robot_dock", {}, ["led"]],
    ["robot_dock_empty", {}, ["led"]],
    ["robot_dock_wash", {}, ["screen", "led"]],
    ["range_cooker", {}, ["cook", "fire", "screen"]],
    ["air_fryer", {}, ["cook", "screen"]],
    ["food_processor", {}, ["screen", "led"]],
    ["stand_mixer", {}, []],
  ];
  for (const [id, options, want] of cases)
    it(`${id} ${JSON.stringify(options)}`, () => {
      const { roles, spinners } = driven(id, options);
      for (const r of want) expect([...roles], id).toContain(r);
      expect(roles.size + spinners, id).toBeGreaterThan(0);
    });

  it("turns the stand mixer's beater", () => {
    expect(driven("stand_mixer").spinners).toBeGreaterThan(0);
  });

  it("hides gas flames on an unlinked hob", () => {
    const def = MODERN.range_cooker;
    const g = buildModern("range_cooker", [def.size[0], def.size[1]], def.size[2])!;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.Material).userData.part === "fire") {
        let shown = true;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) shown &&= p.visible;
        expect(shown).toBe(false);
      }
    });
  });

  it("leaves the plain kitchen parts unmarked", () => {
    // a cupboard of fronts only: nothing lights or moves
    const { roles, spinners } = driven("kitchen_tall", { fronts: "doors" });
    expect(roles.size + spinners).toBe(0);
  });
});
