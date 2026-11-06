// Built-in pieces added later: festive. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  advent_wreath: placeholder,
  christmas_reindeer: placeholder,
  christmas_star_window: placeholder,
  candle_arch: placeholder,
  nutcracker: placeholder,
  christmas_presents: placeholder,
  easter_bunny: placeholder,
  easter_tree: placeholder,
  easter_basket: placeholder,
  menorah: placeholder,
  diwali_diyas: placeholder,
  ramadan_lantern: placeholder,
  chinese_lanterns: placeholder,
};
