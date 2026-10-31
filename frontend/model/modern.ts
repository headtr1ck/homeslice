// The "Modern" library: furniture Homeslice draws itself (render/modern.ts), fitted to
// each piece's size: a wider sofa gets more seats, a wardrobe more doors, a cube shelf
// more cells, a kitchen run more units. Each kind lists its finishes (the first is the
// default) and is placed as a furniture type (plan symbol, lights, defaults).

import type { FurnitureMount, FurnitureType } from "./types";

export interface ModernKind {
  id: string;
  type: FurnitureType;
  /** Width, depth, height in metres. */
  size: [number, number, number];
  mount?: FurnitureMount;
  elevation?: number;
  finishes: string[];
}

/** Colours of the finishes (wood, lacquer, fabric, stone). */
export const FINISHES: Record<string, string> = {
  white: "#eeece8",
  oak: "#c9a47c",
  walnut: "#6e4b33",
  black: "#2b2c2e",
  anthracite: "#45484d",
  grey: "#8d9299",
  beige: "#d6c9b2",
  sand: "#c4b08f",
  green: "#5d7a60",
  blue: "#4d6a88",
  terracotta: "#b5683f",
  pink: "#d4a19b",
  concrete: "#a8a59f",
  marble: "#e6e3dd",
  red: "#a8322d",
  silver: "#b9bdc2",
};

const WOOD = ["oak", "white", "walnut", "black", "anthracite"];
const FABRIC = ["grey", "beige", "anthracite", "green", "blue", "terracotta", "pink"];
const LAMP = ["black", "white", "oak", "sand"];
const POT = ["white", "terracotta", "anthracite", "concrete"];
const PAINT = ["silver", "white", "black", "anthracite", "blue", "red", "green"];

const k = (id: string, type: FurnitureType, size: [number, number, number], finishes: string[], more: Partial<ModernKind> = {}): ModernKind => ({ id, type, size, finishes, ...more });

export const MODERN_GROUPS: { id: string; kinds: ModernKind[] }[] = [
  {
    id: "living",
    kinds: [
      k("sofa", "sofa", [2.2, 0.95, 0.8], FABRIC),
      k("sofa_corner", "sofa_corner", [2.8, 1.9, 0.8], FABRIC),
      k("sofa_chaise", "sofa_corner", [2.6, 1.6, 0.8], FABRIC),
      k("armchair", "armchair", [0.85, 0.85, 0.8], FABRIC),
      k("coffee_table", "coffee_table", [1.2, 0.6, 0.4], WOOD),
      k("coffee_table_round", "coffee_table", [0.8, 0.8, 0.38], WOOD),
      k("coffee_tables_nested", "coffee_table", [1.0, 0.65, 0.45], ["oak", "walnut", "black", "white", "marble"]),
      k("coffee_table_block", "coffee_table", [1.1, 0.7, 0.32], ["concrete", "oak", "white", "marble", "black"]),
      k("side_table", "side_table", [0.45, 0.45, 0.52], ["black", "oak", "white", "marble"]),
      k("tv_board", "shelf", [1.8, 0.4, 0.45], WOOD),
      k("tv_board_wall", "shelf", [1.8, 0.38, 0.32], WOOD, { mount: "wall", elevation: 0.35 }),
      k("sideboard", "shelf", [1.6, 0.45, 0.8], WOOD),
      k("tv_stand", "tv", [1.6, 0.4, 1.3], WOOD),
      k("tv_wall", "tv", [1.45, 0.06, 0.84], ["black"], { mount: "wall", elevation: 1.0 }),
      k("soundbar", "item", [0.95, 0.11, 0.07], ["black", "white"], { mount: "wall", elevation: 0.85 }),
      k("speaker_floor", "item", [0.22, 0.3, 1.0], ["black", "walnut", "white"]),
      k("speaker_shelf", "item", [0.18, 0.24, 0.3], ["black", "white", "walnut"]),
      k("cube_shelf", "shelf", [0.77, 0.39, 1.47], ["white", "oak", "black", "walnut"]),
      k("bookshelf", "shelf", [0.8, 0.3, 2.0], WOOD),
      k("bookshelf_wide", "shelf", [1.6, 0.35, 2.1], WOOD),
      k("bookshelf_low", "shelf", [1.2, 0.3, 0.8], WOOD),
      k("bookshelf_grid", "shelf", [1.5, 0.35, 1.8], WOOD),
      k("bookshelf_ladder", "shelf", [0.7, 0.42, 1.8], ["oak", "white", "black", "walnut"]),
      k("bookshelf_wall", "shelf", [1.2, 0.22, 0.9], ["oak", "white", "black", "walnut"], { mount: "wall", elevation: 1.0 }),
      k("floor_lamp_arc", "floor_lamp", [1.3, 0.4, 2.0], LAMP),
      k("floor_lamp_tripod", "floor_lamp", [0.55, 0.55, 1.55], LAMP),
      k("floor_lamp_globe", "floor_lamp", [0.3, 0.3, 1.45], LAMP),
      k("table_lamp", "table_lamp", [0.3, 0.3, 0.5], LAMP),
      k("rug", "rug", [2.0, 1.4, 0.015], ["beige", "grey", "terracotta", "green", "blue", "anthracite"]),
      k("rug_round", "rug", [1.6, 1.6, 0.015], ["beige", "grey", "terracotta", "green", "blue", "anthracite"]),
      k("rug_runner", "rug", [0.8, 2.5, 0.012], ["beige", "grey", "terracotta", "blue", "anthracite"]),
      k("rug_shaggy", "rug", [2.0, 1.4, 0.04], ["beige", "white", "grey", "anthracite"]),
      k("mirror_floor", "mirror", [0.6, 0.35, 1.8], ["black", "oak", "white", "sand"], { mount: "floor" }),
      k("mirror_round", "mirror", [0.7, 0.03, 0.7], ["black", "oak", "sand", "white"], { mount: "wall", elevation: 1.2 }),
      k("mirror_wall", "mirror", [0.5, 0.03, 1.1], ["black", "oak", "white", "sand"], { mount: "wall", elevation: 0.9 }),
    ],
  },
  {
    id: "dining",
    kinds: [
      k("dining_table", "table", [1.8, 0.9, 0.75], ["oak", "walnut", "white", "black"]),
      k("dining_table_round", "table", [1.1, 1.1, 0.75], ["oak", "walnut", "white", "black", "marble"]),
      k("chair_shell", "chair", [0.48, 0.53, 0.8], ["white", "black", "grey", "green", "terracotta", "sand"]),
      k("chair_wood", "chair", [0.45, 0.5, 0.8], ["oak", "walnut", "black"]),
      k("bar_stool", "stool", [0.4, 0.4, 0.75], ["black", "oak", "white"]),
    ],
  },
  {
    id: "kitchen",
    kinds: [
      k("kitchen", "kitchen", [3.0, 0.62, 0.91], ["white", "anthracite", "oak", "green", "blue", "black"]),
      k("kitchen_island", "kitchen", [2.4, 1.0, 0.92], ["white", "anthracite", "oak", "green", "blue", "black"]),
      k("kitchen_upper", "kitchen_upper", [2.4, 0.35, 0.72], ["white", "anthracite", "oak", "green", "blue", "black"], { mount: "wall", elevation: 1.45 }),
      k("kitchen_tall", "fridge", [0.6, 0.62, 2.2], ["white", "anthracite", "oak", "green", "blue", "black"]),
    ],
  },
  {
    id: "bedroom",
    kinds: [
      k("bed", "bed", [1.8, 2.1, 1.0], ["beige", "grey", "anthracite", "green", "blue", "pink", "oak"]),
      k("bed_single", "bed_single", [0.9, 2.05, 0.9], ["beige", "grey", "anthracite", "green", "blue", "pink", "oak"]),
      k("nightstand", "nightstand", [0.45, 0.38, 0.5], WOOD),
      k("nightstand_wall", "nightstand", [0.45, 0.32, 0.18], WOOD, { mount: "wall", elevation: 0.45 }),
      k("wardrobe", "wardrobe", [2.0, 0.6, 2.2], WOOD),
      k("wardrobe_sliding", "wardrobe", [2.0, 0.65, 2.2], [...WOOD, "grey"]),
      k("wardrobe_open", "wardrobe", [1.6, 0.55, 2.0], ["black", "oak", "white"]),
      k("dresser", "shelf", [1.2, 0.48, 0.8], WOOD),
      k("desk", "desk", [1.4, 0.7, 0.75], ["oak", "white", "walnut", "black"]),
      k("chair_office", "chair", [0.6, 0.6, 1.05], ["black", "grey", "white"]),
    ],
  },
  {
    id: "hall",
    kinds: [
      k("shoe_shelf", "shelf", [0.8, 0.3, 0.9], ["black", "oak", "white"]),
      k("shoe_cabinet", "shelf", [0.8, 0.24, 1.05], WOOD),
      k("hall_bench", "bench", [1.0, 0.38, 0.47], ["oak", "black", "white", "walnut"]),
      k("coat_hooks", "item", [0.9, 0.12, 0.6], ["black", "oak", "white"], { mount: "wall", elevation: 1.15 }),
      k("coat_stand", "item", [0.45, 0.45, 1.75], ["black", "oak", "white"]),
      k("letter_box", "item", [0.38, 0.12, 0.42], ["anthracite", "black", "white", "concrete"], { mount: "wall", elevation: 0.95 }),
      k("letter_box_post", "item", [0.4, 0.3, 1.25], ["anthracite", "black", "white", "concrete"]),
    ],
  },
  {
    id: "bathroom",
    kinds: [
      k("toilet_wall", "toilet", [0.37, 0.55, 0.8], ["white", "black"]),
      k("bidet", "toilet", [0.37, 0.54, 0.4], ["white", "black"]),
      k("vanity", "sink", [0.8, 0.47, 0.85], WOOD),
      k("vanity_double", "sink", [1.4, 0.47, 0.85], WOOD),
      k("sink_large", "sink", [1.0, 0.5, 0.9], ["white", "concrete", "marble", "black"]),
      k("mirror_cabinet", "mirror", [0.8, 0.15, 0.7], ["white", "black", "oak"], { mount: "wall", elevation: 1.25 }),
      k("shower_glass", "shower", [1.2, 0.9, 2.1], ["black", "white"]),
      k("bathtub", "bathtub", [1.8, 0.8, 0.58], ["white", "black", "concrete"]),
      k("towel_radiator", "item", [0.5, 0.06, 1.2], ["white", "black", "anthracite"], { mount: "wall", elevation: 0.2 }),
    ],
  },
  {
    id: "plants",
    kinds: [
      k("monstera", "plant", [0.9, 0.9, 1.15], POT),
      k("fiddle_fig", "plant", [0.6, 0.6, 1.7], POT),
      k("snake_plant", "plant", [0.35, 0.35, 0.85], POT),
      k("areca_palm", "plant", [0.9, 0.9, 1.6], POT),
      k("olive_tree", "plant", [0.6, 0.6, 1.5], POT),
      k("plant_hanging", "plant", [0.45, 0.45, 0.75], POT, { mount: "ceiling" }),
      k("plant_small", "plant", [0.22, 0.22, 0.3], POT),
    ],
  },
  {
    id: "outside",
    kinds: [
      k("tree_deciduous", "tree", [4.5, 4.5, 6.5], ["green"]),
      k("tree_birch", "tree_small", [2.4, 2.4, 6], ["green"]),
      k("tree_conifer", "pine", [2.6, 2.6, 7], ["green"]),
      k("tree_fruit", "tree_small", [3, 3, 3.6], ["green"]),
      k("shrub", "bush", [1.2, 1.2, 1.0], ["green"]),
      k("ornamental_grass", "bush", [0.8, 0.8, 0.9], ["green", "sand"]),
      k("hedge_leafy", "hedge", [3, 0.7, 1.6], ["green"]),
      k("flower_bed", "flower_bed", [2, 0.8, 0.45], ["terracotta", "pink", "white", "blue"]),
      k("lavender", "flower_bed", [1.6, 0.5, 0.5], ["blue"]),
      k("planter_box", "plant", [1.2, 0.4, 0.9], ["anthracite", "terracotta", "concrete", "oak"]),
      k("sun_lounger", "item", [0.7, 1.95, 0.4], ["oak", "anthracite", "white"]),
      k("parasol", "item", [2.8, 2.8, 2.5], ["sand", "white", "anthracite", "terracotta"]),
      k("garden_table", "table", [1.6, 0.9, 0.74], ["oak", "anthracite", "white"]),
      k("garden_sofa", "sofa", [1.9, 0.8, 0.7], ["anthracite", "sand", "grey"]),
      k("deck_chair", "chair", [0.6, 1.0, 0.9], ["blue", "terracotta", "green", "beige"]),
      k("hammock", "item", [3.4, 1.0, 1.3], ["beige", "terracotta", "blue", "green"]),
      k("fence_slats", "fence", [3.0, 0.08, 1.8], ["anthracite", "oak", "walnut", "grey"]),
      k("garden_light", "floor_lamp", [0.16, 0.16, 0.6], ["anthracite", "black", "silver"]),
    ],
  },
  {
    id: "garden",
    kinds: [
      k("bbq_kettle", "item", [0.6, 0.6, 1.0], ["black", "red", "green"]),
      k("bbq_gas", "item", [1.35, 0.6, 1.15], ["black", "silver", "anthracite"]),
      k("fire_pit", "item", [0.9, 0.9, 0.4], ["terracotta", "black", "concrete"]),
      k("raised_bed", "flower_bed", [2.0, 0.8, 0.75], ["oak", "anthracite", "terracotta"]),
      k("greenhouse", "item", [2.5, 1.9, 2.2], ["silver", "anthracite", "green"]),
      k("garden_shed", "item", [2.4, 2.0, 2.2], ["oak", "anthracite", "green", "grey", "red"]),
      k("pool", "item", [4.0, 2.2, 1.2], ["blue", "grey", "anthracite", "oak"]),
      k("trampoline", "item", [3.0, 3.0, 2.6], ["green", "blue", "anthracite"]),
      k("swing", "item", [2.6, 1.6, 2.1], ["oak", "green", "blue"]),
      k("playhouse", "item", [1.5, 1.5, 1.8], ["blue", "red", "green", "white", "oak"]),
      k("sandbox", "item", [1.5, 1.5, 0.3], ["oak", "green", "blue"]),
      k("rain_barrel", "item", [0.6, 0.6, 1.0], ["green", "anthracite", "oak"]),
      k("compost_bin", "item", [0.8, 0.8, 0.8], ["oak", "green", "anthracite"]),
      k("wheelbarrow", "item", [0.62, 1.4, 0.62], ["green", "red", "silver"]),
      k("robot_mower", "item", [0.55, 0.65, 0.27], ["white", "anthracite", "green"]),
      k("rotary_dryer", "item", [2.6, 2.6, 1.9], ["silver", "white", "anthracite"]),
      k("wheelie_bins", "item", [2.4, 0.75, 1.07], ["anthracite"]),
      k("heat_pump", "item", [1.1, 0.45, 0.95], ["white", "anthracite", "grey"]),
    ],
  },
  {
    id: "vehicles",
    kinds: [
      k("car_hatchback", "car", [1.8, 4.1, 1.48], PAINT),
      k("car_estate", "car", [1.85, 4.8, 1.5], PAINT),
      k("car_suv", "car", [1.95, 4.7, 1.7], PAINT),
      k("car_van", "car", [2.0, 5.0, 1.98], PAINT),
      k("bicycle", "item", [0.6, 1.75, 1.05], ["black", "red", "blue", "silver", "green"]),
      k("bike_rack", "item", [1.6, 0.5, 0.8], ["silver", "anthracite"]),
      k("wallbox", "item", [0.26, 0.13, 0.4], ["white", "anthracite", "black"], { mount: "wall", elevation: 1.0 }),
    ],
  },
];

export const MODERN: Record<string, ModernKind> = Object.fromEntries(MODERN_GROUPS.flatMap((g) => g.kinds.map((x) => [x.id, x])));
