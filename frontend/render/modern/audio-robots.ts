// Built-in pieces added later: audio robots. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  speaker_inwall_round: placeholder,
  speaker_inwall_square: placeholder,
  speaker_inwall_rect: placeholder,
  speaker_ceiling_round: placeholder,
  speaker_ceiling_square: placeholder,
  robot_dock: placeholder,
  robot_dock_empty: placeholder,
  robot_dock_wash: placeholder,
  robot_mower_awd: placeholder,
  robot_mower_vision: placeholder,
  robot_mower_dock: placeholder,
  rtk_antenna: placeholder,
  robot_mower_garage: placeholder,
  lawn_tractor: placeholder,
};
