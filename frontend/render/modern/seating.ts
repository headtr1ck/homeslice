// Built-in pieces added later: seating. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  armchair_club: placeholder,
  armchair_cocktail: placeholder,
  recliner: placeholder,
  armchair_swivel: placeholder,
  papasan_chair: placeholder,
  armchair_chesterfield: placeholder,
  armchair_barrel: placeholder,
  armchair_slipper: placeholder,
  armchair_rattan: placeholder,
  chimney: placeholder,
  chimney_breast: placeholder,
};
