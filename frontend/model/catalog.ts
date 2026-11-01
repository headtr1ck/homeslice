// What a house file may name: furniture types and models, opening kinds, floors, sides.
// The integration gets the same lists as custom_components/homeslice/catalog.json
// (written by scripts/catalog.mjs; a test checks it is up to date), so its validator
// and the AI guide never drift from the editor.

import { FLOOR_FINISHES, WALL_FINISHES } from "./finishes";
import { FURNITURE } from "./furniture";
import { FINISHES, MODERN_GROUPS, kindTags } from "./modern";
import en from "../i18n/en.json";

export const OPENING_STYLES = {
  window: ["single", "double", "triple", "fixed", "split", "split_single"],
  door: ["single", "double", "sliding", "sliding_glass", "glass", "glass_double", "entrance_strip", "entrance_panes", "entrance_sidelight"],
  garage_door: ["single"],
  opening: ["square", "arch"],
};

export function catalog() {
  const name = (key: string) => (en as Record<string, string>)[key];
  return {
    sides: ["north", "south", "east", "west"],
    room_kinds: ["room", "outdoor", "void"],
    floor_finishes: FLOOR_FINISHES,
    wall_finishes: WALL_FINISHES,
    opening_types: Object.keys(OPENING_STYLES),
    opening_styles: OPENING_STYLES,
    furniture_types: Object.fromEntries(
      Object.entries(FURNITURE).map(([t, d]) => [t, { name: name(`furniture.${t}`), size: d.size, height: d.height, ...(d.mount ? { mount: d.mount } : {}), ...(d.elevation !== undefined ? { elevation: d.elevation } : {}) }]),
    ),
    modern: MODERN_GROUPS.flatMap((g) =>
      g.kinds.map((k) => ({ model: `modern:${k.id}`, name: name(`modern.${k.id}`), group: g.id, type: k.type, size: k.size, finishes: k.finishes, ...(kindTags(k.id, k.type).length ? { tags: kindTags(k.id, k.type) } : {}), ...(k.accents ? { accents: k.accents } : {}), ...(k.mount ? { mount: k.mount } : {}), ...(k.elevation !== undefined ? { elevation: k.elevation } : {}) })),
    ),
    finishes: Object.keys(FINISHES),
    energy_kinds: ["solar", "battery", "grid", "inverter", "device"],
  };
}
