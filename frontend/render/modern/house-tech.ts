// Built-in pieces added later: house tech. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  boiler: placeholder,
  boiler_floor: placeholder,
  ufh_manifold: placeholder,
  ventilation_unit: placeholder,
  humidifier: placeholder,
  buffer_tank: placeholder,
  water_softener: placeholder,
  utility_sink: placeholder,
  air_fryer: placeholder,
  food_processor: placeholder,
  range_cooker: placeholder,
  loft_bed: placeholder,
  tool_chest: placeholder,
  power_rack: placeholder,
  elliptical: placeholder,
  column: placeholder,
  ceiling_beam: placeholder,
  room_divider_slats: placeholder,
  glass_partition: placeholder,
};
