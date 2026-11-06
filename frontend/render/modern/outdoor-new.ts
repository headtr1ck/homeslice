// Built-in pieces added later: outdoor new. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  car_pickup: placeholder,
  caravan: placeholder,
  motorhome: placeholder,
  trailer: placeholder,
  hot_tub: placeholder,
  sauna_cabin: placeholder,
  beach_chair: placeholder,
  kamado_grill: placeholder,
  lawn_mower: placeholder,
  sliding_gate: placeholder,
  snowman: placeholder,
  christmas_tree: placeholder,
  pumpkin: placeholder,
};
