// The furniture catalogue: default sizes (width × depth × height, metres), where a
// piece is mounted, and the library groups the editor shows them in.

import type { FurnitureMount, FurnitureType } from "./types";

export interface FurnitureDefaults {
  size: [number, number];
  height: number;
  /** Default mount; wall pieces hang `elevation` metres above the floor. */
  mount?: FurnitureMount;
  elevation?: number;
}

export const FURNITURE: Record<FurnitureType, FurnitureDefaults> = {
  sofa: { size: [2.2, 0.9], height: 0.8 },
  sofa_corner: { size: [2.6, 1.8], height: 0.8 },
  armchair: { size: [0.9, 0.85], height: 0.8 },
  coffee_table: { size: [1.1, 0.6], height: 0.42 },
  tv: { size: [1.6, 0.4], height: 1.2 },
  shelf: { size: [1.0, 0.35], height: 1.8 },
  rug: { size: [2.0, 1.4], height: 0.02 },
  floor_lamp: { size: [0.35, 0.35], height: 1.6 },
  plant: { size: [0.45, 0.45], height: 1.1 },
  table: { size: [1.6, 0.9], height: 0.75 },
  chair: { size: [0.45, 0.5], height: 0.9 },
  kitchen: { size: [2.4, 0.6], height: 0.9 },
  kitchen_upper: { size: [2.4, 0.35], height: 0.7, mount: "wall", elevation: 1.45 },
  fridge: { size: [0.6, 0.65], height: 1.8 },
  bed: { size: [1.8, 2.05], height: 0.5 },
  bed_single: { size: [0.9, 2.0], height: 0.5 },
  nightstand: { size: [0.45, 0.4], height: 0.5 },
  wardrobe: { size: [1.5, 0.6], height: 2.1 },
  desk: { size: [1.4, 0.7], height: 0.75 },
  bathtub: { size: [1.7, 0.75], height: 0.55 },
  shower: { size: [0.9, 0.9], height: 2.0 },
  toilet: { size: [0.4, 0.65], height: 0.75 },
  sink: { size: [0.6, 0.45], height: 0.85 },
  mirror: { size: [0.6, 0.04], height: 0.8, mount: "wall", elevation: 1.2 },
  washer: { size: [0.6, 0.6], height: 0.85 },
  dryer: { size: [0.6, 0.6], height: 0.85 },
  wall_lamp: { size: [0.3, 0.2], height: 0.12, mount: "wall", elevation: 1.8 },
  ceiling_lamp: { size: [0.3, 0.3], height: 0.55, mount: "ceiling" },
  ceiling_fan: { size: [1.2, 1.2], height: 0.4, mount: "ceiling" },
  tree: { size: [4, 4], height: 6 },
  tree_small: { size: [2.2, 2.2], height: 3.5 },
  pine: { size: [2.5, 2.5], height: 7 },
  bush: { size: [1.2, 1.2], height: 1 },
  hedge: { size: [3, 0.8], height: 1.6 },
  flower_bed: { size: [2, 0.8], height: 0.4 },
  fence: { size: [3, 0.1], height: 1 },
  garden_path: { size: [3, 0.8], height: 0.05 },
  bench: { size: [1.5, 0.5], height: 0.45 },
  car: { size: [1.85, 4.6], height: 1.5 },
  side_table: { size: [0.5, 0.5], height: 0.55 },
  table_lamp: { size: [0.3, 0.3], height: 0.5 },
  stool: { size: [0.4, 0.4], height: 0.65 },
  item: { size: [0.6, 0.6], height: 0.8 },
};

export const FURNITURE_TYPES = Object.keys(FURNITURE) as FurnitureType[];

/** The editor's library: groups in the order a home is usually furnished. */
export const FURNITURE_GROUPS: { id: string; types: FurnitureType[] }[] = [
  { id: "living", types: ["sofa", "sofa_corner", "armchair", "coffee_table", "side_table", "tv", "shelf", "rug", "floor_lamp", "table_lamp", "plant"] },
  { id: "dining", types: ["table", "chair", "stool"] },
  { id: "kitchen", types: ["kitchen", "kitchen_upper", "fridge"] },
  { id: "bedroom", types: ["bed", "bed_single", "nightstand", "wardrobe"] },
  { id: "office", types: ["desk"] },
  { id: "bathroom", types: ["bathtub", "shower", "toilet", "sink", "mirror"] },
  { id: "utility", types: ["washer", "dryer"] },
  { id: "lighting", types: ["ceiling_lamp", "wall_lamp", "ceiling_fan"] },
  { id: "outside", types: ["tree", "tree_small", "pine", "bush", "hedge", "flower_bed", "fence", "garden_path", "bench", "car"] },
];

/** Where a piece hangs: its own mount, else its type's. */
export function mountOf(f: { type: FurnitureType; mount?: FurnitureMount }): FurnitureMount {
  return f.mount ?? FURNITURE[f.type]?.mount ?? "floor";
}
