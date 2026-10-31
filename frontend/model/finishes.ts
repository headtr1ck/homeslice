// Surface finishes for floors, walls and the facade: wood floors, tiles, stone, concrete,
// paint, panels, brick… A room has a floor finish and a wall finish (with an optional one
// per side, an accent wall); the house has a facade finish. render/finishes.ts draws them.

export type Surface = "floor" | "wall";

export interface Finish {
  id: string;
  group: string;
  /** Where it can go. */
  on: Surface[];
  /** Its overall colour (plan view, simple drawings, swatches). */
  color: string;
}

const f = (id: string, group: string, on: Surface[], color: string): Finish => ({ id, group, on, color });
const FLOOR: Surface[] = ["floor"];
const WALL: Surface[] = ["wall"];
const BOTH: Surface[] = ["floor", "wall"];

export const FINISH_LIST: Finish[] = [
  // wood
  f("wood", "wood", FLOOR, "#b07c49"),
  f("oak_light", "wood", FLOOR, "#d2b48a"),
  f("oak_herringbone", "wood", FLOOR, "#bf9466"),
  f("oak_chevron", "wood", FLOOR, "#c49c6c"),
  f("walnut", "wood", FLOOR, "#6e4b33"),
  f("oak_grey", "wood", FLOOR, "#a39a8e"),
  f("parquet_squares", "wood", FLOOR, "#b8895a"),
  // tiles
  f("tile", "tiles", BOTH, "#a7acb1"),
  f("tile_white", "tiles", BOTH, "#e8e7e3"),
  f("tile_black", "tiles", BOTH, "#3a3b3d"),
  f("terrazzo", "tiles", BOTH, "#dcd7cf"),
  f("tile_hex", "tiles", BOTH, "#e2ddd3"),
  f("tile_checker", "tiles", FLOOR, "#9a9894"),
  f("tile_cement", "tiles", BOTH, "#c9c1b2"),
  f("tile_subway", "tiles", WALL, "#efeeea"),
  f("tile_zellige", "tiles", WALL, "#5f8a7a"),
  // stone and concrete
  f("concrete", "stone", BOTH, "#8d8f92"),
  f("concrete_polished", "stone", FLOOR, "#a6a8aa"),
  f("marble", "stone", BOTH, "#e6e3dd"),
  f("slate", "stone", BOTH, "#4f5357"),
  f("travertine", "stone", BOTH, "#d8c9ad"),
  f("stone_flags", "stone", BOTH, "#a59c8c"),
  // soft
  f("carpet", "soft", FLOOR, "#9a8f84"),
  f("carpet_grey", "soft", FLOOR, "#7d8085"),
  f("sisal", "soft", FLOOR, "#c4ad86"),
  // paint and plaster
  f("paint_white", "paint", WALL, "#eeeae3"),
  f("paint_warm", "paint", WALL, "#e9dfcf"),
  f("paint_grey", "paint", WALL, "#b9bbbd"),
  f("paint_sage", "paint", WALL, "#a9b7a0"),
  f("paint_terracotta", "paint", WALL, "#c27a5b"),
  f("paint_ochre", "paint", WALL, "#d1a54f"),
  f("paint_blush", "paint", WALL, "#e2bfb4"),
  f("paint_navy", "paint", WALL, "#3b4a63"),
  f("paint_green", "paint", WALL, "#3f5a4a"),
  f("paint_charcoal", "paint", WALL, "#3c3e42"),
  f("limewash", "paint", WALL, "#d9d2c4"),
  f("wallpaper_stripes", "paint", WALL, "#d6d9cf"),
  f("wallpaper_leaves", "paint", WALL, "#9fb39a"),
  // panels and boards
  f("acoustic_oak", "panels", WALL, "#b08758"),
  f("acoustic_walnut", "panels", WALL, "#5e4130"),
  f("acoustic_black", "panels", WALL, "#2a2b2d"),
  f("veneer_oak", "panels", WALL, "#c9a47c"),
  f("veneer_walnut", "panels", WALL, "#6e4b33"),
  f("beadboard", "panels", WALL, "#ecebe6"),
  f("wood_cladding", "panels", WALL, "#9b7652"),
  // brick
  f("brick_red", "brick", WALL, "#9c5a43"),
  f("brick_white", "brick", WALL, "#e4e0d8"),
  f("brick_grey", "brick", WALL, "#7d7a76"),
  // outside
  f("lawn", "outside", FLOOR, "#5f8f4c"),
  f("paving", "outside", FLOOR, "#9b9285"),
  f("gravel", "outside", FLOOR, "#a39b8f"),
  f("decking", "outside", FLOOR, "#8e6a4a"),
  f("cobbles", "outside", FLOOR, "#86807a"),
  f("render_white", "outside", WALL, "#efede8"),
  f("render_grey", "outside", WALL, "#a9aaa8"),
];

export const FINISHES_BY_ID: Record<string, Finish> = Object.fromEntries(FINISH_LIST.map((x) => [x.id, x]));

/** The groups in the order the editor shows them. */
export const FINISH_GROUPS = ["wood", "tiles", "stone", "soft", "paint", "panels", "brick", "outside"];

/** Finishes a floor can have (`none`: no floor, e.g. a void). */
export const FLOOR_FINISHES = ["none", ...FINISH_LIST.filter((x) => x.on.includes("floor")).map((x) => x.id)];
/** Finishes a wall or the facade can have. */
export const WALL_FINISHES = FINISH_LIST.filter((x) => x.on.includes("wall")).map((x) => x.id);
