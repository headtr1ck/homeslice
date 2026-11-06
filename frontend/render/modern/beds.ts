// Built-in pieces added later: beds. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  bed_car: placeholder,
  bed_midsleeper: placeholder,
  bunk_bed_l: placeholder,
  loft_bed_slide: placeholder,
  bed_trundle: placeholder,
  crib_bedside: placeholder,
  moses_basket: placeholder,
  bed_murphy: placeholder,
  sofa_bed: placeholder,
};
