// Homeslice house model.
//
// Plan coordinates are metres: x points east, y points south (north is up, as in a
// printed floor plan), z points up. Two shapes exist for every type: the short *input*
// form people and LLMs write, and the *expanded* form the renderer uses.

export type Vec2 = [number, number];
/** A coordinate is metres or the name of a grid axis (`grid.x` / `grid.y`). */
export type Coord = number | string;
export type Side = "north" | "south" | "east" | "west";
export type RoomKind = "room" | "outdoor" | "void";
export type OpeningType = "window" | "door" | "garage_door" | "opening";
/** `open`: a boundary between two rooms that are open to each other (no wall is built). */
export type WallType = "exterior" | "party" | "interior" | "open";

// ----- input (short form) -----

export interface ShapeInput {
  /** [x, y, width, depth]; x/y may be grid names. */
  rect?: [Coord, Coord, number, number];
  polygon?: [Coord, Coord][];
}

export interface RoomInput extends ShapeInput {
  id: string;
  area_id?: string;
  name?: string;
  kind?: RoomKind;
  floor?: string;
  /** Cover entity of an awning over this (outdoor) area, mounted on the house wall. */
  awning?: string;
  /**
   * Lights in this room. The area's lights are included automatically and placed
   * evenly; list a light to place it (`at`), hide it, or add one from another area.
   */
  lights?: LightInput[];
  furniture?: FurnitureInput[];
}

export type FurnitureType =
  | "sofa"
  | "sofa_corner"
  | "armchair"
  | "coffee_table"
  | "tv"
  | "shelf"
  | "rug"
  | "floor_lamp"
  | "plant"
  | "table"
  | "chair"
  | "kitchen"
  | "kitchen_upper"
  | "fridge"
  | "bed"
  | "bed_single"
  | "nightstand"
  | "wardrobe"
  | "desk"
  | "bathtub"
  | "shower"
  | "toilet"
  | "sink"
  | "mirror"
  | "washer"
  | "dryer"
  | "wall_lamp"
  | "ceiling_lamp"
  | "ceiling_fan"
  | "car";

/** `wall`: hangs on a wall (its back against it); `ceiling`: hangs from the ceiling. */
export type FurnitureMount = "floor" | "wall" | "ceiling";

/** A piece of furniture: simple shapes, or a detailed model if the card asks for one. */
export interface FurnitureInput {
  type: FurnitureType;
  /** Centre, metres from the room's north-west corner. */
  at: [number, number];
  /** Degrees clockwise (0: the back is to the north, e.g. a sofa facing south). */
  rotation?: number;
  /** Width and depth in metres (default by type). */
  size?: [number, number];
  /** Default by type (upper kitchen cabinets and mirrors hang on a wall, ceiling lamps from the ceiling). */
  mount?: FurnitureMount;
  /** Wall pieces: metres from the floor to the piece's bottom (default by type). */
  elevation?: number;
}

export interface LightInput {
  entity: string;
  /** Metres east and south of the room's north-west corner (its bounding box). */
  at?: [number, number];
  /** Leave this light out of the house view. */
  hidden?: boolean;
}

/**
 * Walls are generated from the room boundaries; these entries change them. Either a
 * boundary between two rooms (optionally only one side of the first room), or a
 * free-standing wall along a line.
 */
export interface WallInput {
  /** The boundary between these two rooms. */
  between?: [string, string];
  /** Only the boundary on this side of the first room. */
  side?: Side;
  /** A free-standing wall (not on a room boundary). */
  line?: [[Coord, Coord], [Coord, Coord]];
  /**
   * `open`: no wall there (default for `between`); `wall`: build one (default for `line`;
   * with `between`, used to give that wall its own `thickness`).
   */
  type?: "open" | "wall";
  /** Metres (default: the house's interior wall thickness). */
  thickness?: number;
}

export interface OpeningInput {
  id?: string;
  room: string;
  side: Side;
  /** Metres from the room's west end (north/south sides) or north end (east/west sides). */
  at: number;
  width: number;
  type?: OpeningType;
  sill?: number;
  height?: number;
  cover?: string;
  contact?: string;
}

export interface LevelInput {
  id: string;
  floor_id?: string;
  /**
   * More Home Assistant floors whose areas are on this level, e.g. an "Outside" floor
   * with the garden and terrace on the ground level.
   */
  include_floors?: string[];
  name?: string;
  height?: number;
  slab?: number;
  outline?: ShapeInput;
  party_walls?: Side[];
  rooms: RoomInput[];
  openings?: OpeningInput[];
  walls?: WallInput[];
}

/**
 * A window or door defined once on the house outline and repeated on several levels
 * (stacked façade windows). On each level it belongs to whichever room lies behind it.
 */
export interface FacadeOpeningInput {
  id?: string;
  side: Side;
  /**
   * Metres from the house outline's west end (north/south façades) or north end
   * (east/west), the same on every level even where a level's own outline differs.
   */
  at: number;
  width: number;
  levels: string[];
  type?: OpeningType;
  sill?: number;
  height?: number;
  /** Cover per level id. */
  covers?: Record<string, string>;
  /** Contact sensor per level id. */
  contacts?: Record<string, string>;
}

export type StairShape = "straight" | "u_turn";

export interface VerticalInput extends ShapeInput {
  id: string;
  kind?: "stairs" | "shaft";
  from: string;
  to: string;
  /** `straight` (default) or `u_turn`: two flights side by side, joined by winders. */
  shape?: StairShape;
  /** Compass direction the first flight climbs towards (default: along the longer side). */
  up?: Side;
  /** u_turn: the side of the stairwell the first flight runs along. */
  start?: Side;
  /**
   * Metres of floor at the start of the stairwell before the first step, e.g. where the
   * stair up begins further in than the one arriving from below (default 0).
   */
  entry?: number;
}

/**
 * Something that makes, stores or uses power, for the energy overlay. Entities default to
 * Home Assistant's energy settings (solar, battery, grid); devices name their power sensor.
 */
export interface EnergyInput {
  kind: EnergyKind;
  /** For `to` (default: from the name or kind, e.g. `battery`). */
  id?: string;
  /**
   * The item its flow line goes to (an id). Default: the hub, i.e. the inverter, else
   * the battery, else the grid.
   */
  to?: string;
  /** Level and plan position (metres); solar panels go on the roof instead. */
  level?: string;
  at?: [number, number];
  /** Power sensor (W or kW); positive = producing for solar, discharging for a battery, importing for the grid. */
  power?: string;
  /** Battery charge sensor (%). */
  soc?: string;
  name?: string;
  /** Solar: the roof side the panels are on (default south). */
  roof?: Side;
}

export type EnergyKind = "solar" | "battery" | "grid" | "inverter" | "device";

export interface RoofInput {
  /** Only gable roofs for now. */
  shape?: "gable";
  /** Direction of the ridge (default along the longer side). */
  ridge?: "east_west" | "north_south";
  /** Degrees (default 35). */
  pitch?: number;
  /** Metres past the walls (default 0.3). */
  overhang?: number;
}

export interface HouseInput {
  schema: 1;
  id: string;
  name?: string;
  outline?: ShapeInput;
  grid?: { x?: Record<string, number>; y?: Record<string, number> };
  walls?: Partial<WallThickness>;
  party_walls?: Side[];
  /**
   * Covers that report their position the other way round (open when a blind is down,
   * or when an awning is rolled up). Without them: blinds are open when rolled up,
   * awnings when extended, as in Home Assistant.
   */
  inverted_covers?: string[];
  /** House-wide defaults per opening type, e.g. floor-to-ceiling windows. */
  opening_defaults?: Partial<Record<OpeningType, { sill?: number; height?: number }>>;
  facade_openings?: FacadeOpeningInput[];
  vertical?: VerticalInput[];
  /** Bottom to top. */
  levels: LevelInput[];
  roof?: RoofInput;
  energy?: EnergyInput[];
}

// ----- expanded -----

export interface WallThickness {
  exterior: number;
  interior: number;
  party: number;
}

export interface Room {
  id: string;
  areaId?: string;
  name?: string;
  kind: RoomKind;
  floor: string;
  /** Positive shoelace area in plan coordinates (see geometry.signedArea). */
  polygon: Vec2[];
  awning?: string;
  /** As in the input, with `at` in plan coordinates. */
  lights: { entity: string; at?: Vec2; hidden: boolean }[];
  /** `elevation`: bottom above the floor in metres (ceiling pieces: null, they hang from the ceiling). */
  furniture: { type: FurnitureType; at: Vec2; rotation: number; size: [number, number]; height: number; mount: FurnitureMount; elevation: number | null }[];
}

/** Where an opening is defined: a level's own list, or a façade entry shared by levels. */
export type OpeningSource = { kind: "level"; index: number } | { kind: "facade"; index: number };

export interface Opening {
  id: string;
  source: OpeningSource;
  room: string;
  side: Side;
  at: number;
  width: number;
  type: OpeningType;
  sill: number;
  height: number;
  cover?: string;
  contact?: string;
}

export interface Level {
  id: string;
  floorId?: string;
  name: string;
  index: number;
  elevation: number;
  height: number;
  slab: number;
  outline: Vec2[];
  partyWalls: Side[];
  rooms: Room[];
  openings: Opening[];
  /** Boundaries between two rooms that are open (no wall), optionally one side only. */
  openBoundaries: { between: [string, string]; side?: Side }[];
  /** Free-standing walls. */
  freeWalls: { a: Vec2; b: Vec2; thickness?: number }[];
  /** Walls between two rooms with their own thickness, optionally one side only. */
  thickBoundaries: { between: [string, string]; side?: Side; thickness: number }[];
}

export interface Vertical {
  id: string;
  kind: "stairs" | "shaft";
  polygon: Vec2[];
  from: number;
  to: number;
  shape: StairShape;
  up: Side;
  start: Side;
  entry: number;
}

export interface House {
  id: string;
  name: string;
  walls: WallThickness;
  levels: Level[];
  vertical: Vertical[];
  roof: Required<RoofInput>;
  energy: Energy[];
  invertedCovers: string[];
}

export interface Energy {
  kind: EnergyKind;
  id: string;
  /** Index (`index`) of the item its flow line goes to, or null (the hub itself). */
  to: number | null;
  /** Index into the input list (for the editor). */
  index: number;
  levelIndex: number | null;
  at: Vec2 | null;
  power?: string;
  soc?: string;
  name?: string;
  roof: Side;
}

export interface Issue {
  severity: "error" | "warning";
  /** Dotted path into the input, e.g. `levels.ground.rooms.kitchen`. */
  path: string;
  message: string;
}
