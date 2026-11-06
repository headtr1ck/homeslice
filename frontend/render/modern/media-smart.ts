// Built-in pieces added later: media smart. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import type { Build, Builder } from "../modern";

/** Stand-in until the piece is drawn: a box filling its size. */
const placeholder = (b: Builder, w: number, d: number, h: number, finish: import("three").Material) => {
  b.box(w, h, d, 0, 0, 0, finish);
};

export const BUILDERS: Record<string, Build> = {
  projector: placeholder,
  speaker_subwoofer: placeholder,
  av_receiver: placeholder,
  cinema_seats: placeholder,
  light_bar: placeholder,
  light_pillar: placeholder,
  orb_lamp: placeholder,
  tower_pc: placeholder,
  wifi_router: placeholder,
  access_point: placeholder,
  nas: placeholder,
  smart_display: placeholder,
  siren: placeholder,
  air_quality_monitor: placeholder,
  wall_switch: placeholder,
  wall_socket: placeholder,
  arcade_cabinet: placeholder,
  pet_feeder: placeholder,
  pet_fountain: placeholder,
  litter_box: placeholder,
};
