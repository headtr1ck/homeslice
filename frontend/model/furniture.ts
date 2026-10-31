// Default sizes of the furniture (width × depth × height, metres).

import type { FurnitureType } from "./types";

export const FURNITURE: Record<FurnitureType, { size: [number, number]; height: number }> = {
  sofa: { size: [2.2, 0.9], height: 0.8 },
  armchair: { size: [0.9, 0.85], height: 0.8 },
  table: { size: [1.6, 0.9], height: 0.75 },
  chair: { size: [0.45, 0.5], height: 0.9 },
  bed: { size: [1.8, 2.05], height: 0.5 },
  bed_single: { size: [0.9, 2.0], height: 0.5 },
  desk: { size: [1.4, 0.7], height: 0.75 },
  wardrobe: { size: [1.5, 0.6], height: 2.1 },
  shelf: { size: [1.0, 0.35], height: 1.8 },
  kitchen: { size: [2.4, 0.6], height: 0.9 },
  tv: { size: [1.6, 0.4], height: 1.2 },
  bathtub: { size: [1.7, 0.75], height: 0.55 },
  shower: { size: [0.9, 0.9], height: 2.0 },
  toilet: { size: [0.4, 0.65], height: 0.75 },
  sink: { size: [0.6, 0.45], height: 0.85 },
  plant: { size: [0.45, 0.45], height: 1.1 },
  car: { size: [1.85, 4.6], height: 1.5 },
  washer: { size: [0.6, 0.6], height: 0.85 },
  dryer: { size: [0.6, 0.6], height: 0.85 },
  fridge: { size: [0.6, 0.65], height: 1.8 },
};

export const FURNITURE_TYPES = Object.keys(FURNITURE) as FurnitureType[];
