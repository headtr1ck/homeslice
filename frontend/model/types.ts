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
export type WallType = "exterior" | "party" | "interior";

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
  name?: string;
  height?: number;
  slab?: number;
  outline?: ShapeInput;
  party_walls?: Side[];
  rooms: RoomInput[];
  openings?: OpeningInput[];
}

/**
 * A window or door defined once on the house outline and repeated on several levels
 * (stacked façade windows). On each level it belongs to whichever room lies behind it.
 */
export interface FacadeOpeningInput {
  id?: string;
  side: Side;
  /** Metres from the outline's west end (north/south façades) or north end (east/west). */
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

export interface VerticalInput extends ShapeInput {
  id: string;
  kind?: "stairs" | "shaft";
  from: string;
  to: string;
}

export interface HouseInput {
  schema: 1;
  id: string;
  name?: string;
  outline?: ShapeInput;
  grid?: { x?: Record<string, number>; y?: Record<string, number> };
  walls?: Partial<WallThickness>;
  party_walls?: Side[];
  /** House-wide defaults per opening type, e.g. floor-to-ceiling windows. */
  opening_defaults?: Partial<Record<OpeningType, { sill?: number; height?: number }>>;
  facade_openings?: FacadeOpeningInput[];
  vertical?: VerticalInput[];
  /** Bottom to top. */
  levels: LevelInput[];
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
}

export interface Opening {
  id: string;
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
}

export interface Vertical {
  id: string;
  kind: "stairs" | "shaft";
  polygon: Vec2[];
  from: number;
  to: number;
}

export interface House {
  id: string;
  name: string;
  walls: WallThickness;
  levels: Level[];
  vertical: Vertical[];
}

export interface Issue {
  severity: "error" | "warning";
  /** Dotted path into the input, e.g. `levels.ground.rooms.kitchen`. */
  path: string;
  message: string;
}
