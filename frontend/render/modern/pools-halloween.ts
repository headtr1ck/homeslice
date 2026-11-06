// Built-in pieces added later: pools halloween. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  pool_frame: placeholder,
  pool_quickup: placeholder,
  pool_inground: placeholder,
  pool_steel_wall: placeholder,
  paddling_pool: placeholder,
  halloween_skeleton: placeholder,
  halloween_tombstones: placeholder,
  halloween_ghost: placeholder,
  halloween_cauldron: placeholder,
  halloween_spider_web: placeholder,
  scarecrow: placeholder,
};
