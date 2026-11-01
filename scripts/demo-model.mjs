// The demo house furnished, painted and lit (no browser needed): for the README's pictures
// and animation and for the demo site.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// the furniture types of the pieces used (the editor sets them from the library)
const MODERN_TYPES = {
  tv_board: "shelf", tv_wall: "tv", rug_berber: "rug", rug_runner: "rug", rug_shaggy: "rug", rug_round: "rug", sofa_corner: "sofa_corner", coffee_table_round: "coffee_table",
  floor_lamp_arc: "floor_lamp", monstera: "plant", fiddle_fig: "plant", olive_tree: "plant", dining_table_oval: "table", chair_wishbone: "chair", kitchen: "kitchen",
  fridge_freestanding: "fridge", kitchen_island: "kitchen", bar_stool_back: "stool", pendant_globe: "ceiling_lamp", hall_wardrobe: "wardrobe", bed_upholstered: "bed",
  nightstand: "nightstand", wardrobe_sliding: "wardrobe", armchair_wingback: "armchair", vanity: "sink", toilet_wall: "toilet", shower_walk_in: "shower",
  bunk_bed: "bed_single", desk: "desk", chair_office: "chair", kids_table: "table", towel_ladder: "item", teepee: "item", toy_box: "item", umbrella_stand: "item",
};

export const fixture = () => {
  const f = JSON.parse(readFileSync(join(root, "dev/fixtures/demo-hass.json"), "utf8"));
  f.model = parse(readFileSync(join(root, f.model), "utf8"));
  return f;
};

/** The demo house, furnished and painted, with its lights on. */
export function showcase(f) {
  const m = f.model;
  const rooms = Object.fromEntries(m.levels.flatMap((l) => l.rooms).map((r) => [r.id, r]));
  const set = (id, patch) => rooms[id] && Object.assign(rooms[id], patch);
  set("living", { floor: "oak_herringbone", wall: "paint_warm", wall_sides: { north: "acoustic_oak" } });
  set("kitchen", { floor: "terrazzo", wall: "tile_subway" });
  set("hall", { floor: "tile_cement" });
  m.facade = "render_white";
  const furnish = (id, pieces) => rooms[id] && (rooms[id].furniture = [...(rooms[id].furniture ?? []), ...pieces]);
  const d = (model, at, more = {}) => ({ type: MODERN_TYPES[model] ?? "item", model: `modern:${model}`, at, ...more });
  furnish("living", [
    d("tv_board", [2.5, 0.22], { size: [1.8, 0.4], height: 0.45 }),
    d("tv_wall", [2.5, 0.12], { mount: "wall", elevation: 1.0, entity: "media_player.living_room_tv" }),
    d("rug_berber", [2.5, 2.4], { size: [2.6, 1.9] }),
    d("sofa_corner", [2.4, 3.6], { rotation: 180, size: [2.8, 1.9] }),
    d("coffee_table_round", [2.6, 2.1]),
    d("floor_lamp_arc", [0.7, 2.6], { entity: "light.reading_lamp" }),
    d("monstera", [0.5, 0.5]),
    d("dining_table_oval", [6.5, 4.1], { rotation: 90, size: [1.9, 1.0] }),
    ...[[5.85, 3.6, 90], [5.85, 4.6, 90], [7.15, 3.6, 270], [7.15, 4.6, 270]].map(([x, y, r]) => d("chair_wishbone", [x, y], { rotation: r })),
    d("fiddle_fig", [7.6, 5.6]),
  ]);
  furnish("kitchen", [
    d("kitchen", [2.2, 0.31], { size: [3.6, 0.62] }),
    d("fridge_freestanding", [4.55, 0.33]),
    d("kitchen_island", [2.3, 2.3], { size: [2.0, 0.95] }),
    d("bar_stool_back", [1.8, 3.1], { rotation: 180 }),
    d("bar_stool_back", [2.8, 3.1], { rotation: 180 }),
    d("pendant_globe", [1.8, 2.3], { mount: "ceiling" }),
    d("pendant_globe", [2.8, 2.3], { mount: "ceiling" }),
  ]);
  furnish("hall", [d("hall_wardrobe", [1.55, 0.22], { size: [1.3, 0.4] }), d("rug_runner", [1.5, 2.3], { size: [0.8, 2.2] }), d("umbrella_stand", [2.75, 0.3])]);
  furnish("bedroom", [
    d("bed_upholstered", [2.5, 1.12], { size: [1.8, 2.15] }),
    d("nightstand", [1.2, 0.22]),
    d("nightstand", [3.8, 0.22]),
    d("wardrobe_sliding", [2.5, 5.65], { rotation: 180, size: [2.4, 0.65] }),
    d("rug_shaggy", [2.5, 2.9], { size: [2.4, 1.6] }),
    d("armchair_wingback", [4.3, 4.3], { rotation: 225 }),
    d("olive_tree", [0.45, 5.4]),
  ]);
  furnish("bath", [d("vanity", [1.5, 0.25], { size: [1.0, 0.47] }), d("toilet_wall", [2.7, 1.5], { rotation: 90 }), d("shower_walk_in", [1.0, 3.5], { rotation: 180, size: [1.6, 0.9] }), d("towel_ladder", [2.75, 3.2], { rotation: 90 })]);
  furnish("kids", [
    d("bunk_bed", [0.6, 1.1]),
    d("desk", [3.5, 0.4], { size: [1.2, 0.6] }),
    d("chair_office", [3.5, 1.05], { rotation: 180 }),
    d("rug_round", [4.4, 2.5]),
    d("kids_table", [5.6, 2.6]),
    d("teepee", [7.2, 0.8]),
    d("toy_box", [7.3, 3.7], { rotation: 180 }),
  ]);
  for (const id of Object.keys(f.states)) if (id.startsWith("light.")) f.states[id] = { ...f.states[id], state: "on", attributes: { ...f.states[id].attributes, brightness: 220 } };
  return f;
}

