// The Homeslice editor: a full-screen sidebar panel with the 2D plan of one level, a live
// 3D preview and an inspector. Edits work on the short-form model and are saved to
// Homeslice's storage, where every card picks them up at once.

import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { ref } from "lit/directives/ref.js";
import { type Command, searchCommands } from "./commands";
import { OPENING_GROUPS, OPENING_PRESETS, applyPreset, kindOf, presetOf, type OpeningPreset } from "./openings";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { areaEntities, type Hass } from "../ha/hass";
import { linkDomain } from "../ha/devices";
import { formatNumber, loadLanguage, localize, texts, type StringKey } from "../i18n/localize";
import en from "../i18n/en.json";
import de from "../i18n/de.json";
import { DEFAULTS, LIGHT_TYPES, expandHouse } from "../model/expand";
import { bbox, bendEdges, edgeDistance, labelPoint, normalizeOrientation, pointInPolygon, project, signedArea, within } from "../model/geometry";
import { closedFaces, faceAt } from "../model/faces";
import type { Building, DormerInput, EnergyInput, LevelInput, RoofInput, RoofPartInput, RoofWindowInput, SectionInput, FurnitureInput, FurnitureMount, FurnitureType, HouseInput, Issue, LightType, OpeningInput, OpeningSource, OpeningType, PieceInput, RoomInput, ShapeInput, Side, StairShape, Vec2, VerticalInput } from "../model/types";
import { deriveWalls, innerPolygon, sideOfRoom, type Wall, type WallOpening } from "../model/walls";
import { HouseRenderer } from "../render/scene";
import { stairHoleOn, stairPath, stairTreads } from "../model/stairs";
import { misalignedWalls } from "../model/checks";
import { migrateHouse } from "../model/migrate";
import { FURNITURE, FURNITURE_TYPES, mountOf } from "../model/furniture";
import { loadModel } from "../render/models";
import { FINISHES, MODERN, defaultKind, resolveKind } from "../model/modern";
import { FINISHES_BY_ID, FINISH_GROUPS, FINISH_LIST, type Surface } from "../model/finishes";
import { finishPreview } from "../render/finishes";
import {
  LIBRARY_SOURCES,
  builtinGroups,
  customGroups,
  filterGroups,
  humanize,
  planPicture,
  polyhavenGroups,
  credit,
  type SketchfabHit,
  type CustomAsset,
  type LibraryGroup,
  type LibraryItem,
  type LibrarySource,
  type PolyhavenAsset,
  type PolyhavenTexture,
} from "./library";
import { areaLightRooms, listedLights, placeLights, type PlacedLight } from "../model/lights";
import { prefsSensors, type EnergyPrefs } from "../ha/energy";
import { applyAll, checklist, type CheckItem } from "./checklist";
import { assignMaps, bestMatch, extractYaml, mapNotes, mapScale, ownNames, type MapNote } from "./start";
import { pollPosition, rawPosition, readRobot } from "../ha/robots";
import { ENERGY_COLORS } from "../render/scene";
import {
  History,
  addFreeWall,
  boundaryThickness,
  deleteFreeWall,
  freeWallIndexes,
  railingIndexes,
  resizeSide,
  setBoundaryThickness,
  setOpeningDefaults,
  setPartyWalls,
  setWallThickness,
  updateFreeWall,
  wallSnap,
  connectEnergy,
  setCoverInverted,
  updateHouse,
  setOpeningLevels,
  addRobot,
  updateRobot,
  deleteRobot,
  setRobotPosition,
  addRobotPoint,
  clearRobotPoints,
  snapFurniture,
  footprintHalf,
  flipFurniture,
  addOpening,
  addRoom,
  addFurniture,
  deleteFurniture,
  moveFurniture,
  updateFurniture,
  copyRooms,
  duplicateLevel,
  moveRoomToLevel,
  movePieceToLevel,
  mergePieces,
  setPiece,
  assignArea,
  bendEdge,
  transformLevel,
  drawRoomOver,
  uncoveredPieces,
  snapValue,
  hostRoom,
  roomAt,
  divideRoom,
  shapeCorners,
  addEnergy,
  deleteEnergy,
  updateEnergy,
  setRoof,
  placeLight,
  removeLight,
  setLightHidden,
  setLightShape,
  addCamera,
  updateCamera,
  removeCamera,
  addStairs,
  deleteStairs,
  setStairsRect,
  stairsRect,
  updateStairs,
  addLevel,
  deleteLevel,
  newHouse,
  slug,
  uniqueId,
  updateLevel,
  suggestMerges,
  type AreaSeed,
  deleteOpening,
  readOpening,
  updateOpening,
  area,
  clone,
  cornerAngle,
  deleteRoom,
  moveEdge,
  moveWallPiece,
  moveLevel,
  moveVertex,
  openSides,
  outlineScope,
  setBoundaryOpen,
  setBoundaryOpenAll,
  boundaryOpenAll,
  setOpenSegments,
  setSegmentThickness,
  segmentThickness,
  setOutlineAuto,
  setOwnOutline,
  removeVertex,
  roomPolygon,
  snap,
  splitEdge,
  updateRoom,
  type SnapContext,
  type Snapped,
  addRoofLevel,
  addRoofPart,
  addSolarPanels,
  removeRoofPart,
  ROOF_PRESETS,
  updateRoofPart,
} from "./ops";

/** What a click on the plan does: select and drag, or add something. */
type Tool = "select" | "rect" | "balcony" | "stairs" | "wall" | "railing" | "divide" | "assign" | "opening" | "furniture" | "devices" | "robots" | "measure" | "section";
/** What the plan shows (visibility toggles below the tools). */
type Layer = "dims" | "furniture" | "lights" | "devices" | "below";
const LAYERS: { layer: Layer; icon: string }[] = [
  { layer: "dims", icon: "mdi:ruler" },
  { layer: "furniture", icon: "mdi:sofa-single-outline" },
  { layer: "lights", icon: "mdi:lightbulb-outline" },
  { layer: "devices", icon: "mdi:robot-vacuum" },
  { layer: "below", icon: "mdi:layers-outline" },
];

function readLayers(): Record<Layer, boolean> {
  const show = { dims: true, furniture: true, lights: true, devices: true, below: true };
  try {
    return { ...show, ...JSON.parse(readPref("homeslice-layers") ?? "{}") };
  } catch {
    return show;
  }
}

/** The furniture library's sources, shown as the furniture tool's sub-tools. */
const LIBRARY_ICONS: Record<LibrarySource, string> = { builtin: "mdi:shape-outline", polyhaven: "mdi:image-filter-hdr", sketchfab: "mdi:cube-scan", custom: "mdi:upload-outline" };

/** A shape walls close off that no room fills: outside every room, or cut off a room (its host keeps `keep`). */
type FreeShape = { poly: Vec2[]; host?: { room: string; keep?: Vec2[] } };

/** The tools: tool, icon, shortcut, and the toolbar button they share (its sub-tools, shown in a bar over the plan). */
const TOOLS: { tool: Tool; icon: string; key: string; group?: "build" | "openings" | "devices" }[] = [
  { tool: "select", icon: "mdi:cursor-default-outline", key: "V" },
  { tool: "rect", icon: "mdi:vector-square-plus", key: "R", group: "build" },
  { tool: "wall", icon: "mdi:wall", key: "W", group: "build" },
  { tool: "railing", icon: "mdi:fence", key: "G", group: "build" },
  { tool: "balcony", icon: "mdi:balcony", key: "B", group: "build" },
  { tool: "divide", icon: "mdi:vector-line", key: "X", group: "build" },
  { tool: "assign", icon: "mdi:tag-outline", key: "A", group: "build" },
  { tool: "opening", icon: "mdi:window-closed-variant", key: "D", group: "openings" },
  { tool: "stairs", icon: "mdi:stairs", key: "S", group: "openings" },
  { tool: "furniture", icon: "mdi:sofa-outline", key: "F" },
  { tool: "devices", icon: "mdi:lightning-bolt-outline", key: "E", group: "devices" },
  { tool: "robots", icon: "mdi:robot-vacuum", key: "O", group: "devices" },
  { tool: "measure", icon: "mdi:tape-measure", key: "M" },
  { tool: "section", icon: "mdi:box-cutter", key: "C" },
];

/** The guided tour's steps: what to do, and the control it is about. */
const TOUR: { id: "floors" | "room" | "reshape" | "opening" | "furniture" | "save"; target?: string }[] = [
  { id: "floors", target: "aside.levels" },
  { id: "room", target: 'aside.tools button[data-group="build"]' },
  { id: "reshape", target: "svg.plan" },
  { id: "opening", target: 'aside.tools button[data-group="openings"]' },
  { id: "furniture", target: 'aside.tools button[data-tool="furniture"]' },
  { id: "save", target: "header button.save" },
];
type TourCounts = { rooms: number; openings: number; furniture: number };

/** What is left of a wall segment once a piece of it is taken out: up to two segments. */
function remainder(whole: [Vec2, Vec2], piece: [Vec2, Vec2]): [Vec2, Vec2][] {
  const [w0, w1] = whole;
  const len = Math.hypot(w1[0] - w0[0], w1[1] - w0[1]);
  if (len < 1e-6) return [];
  const t = piece.map((p) => project(p, w0, w1).t).sort((x, y) => x - y);
  const at = (d: number): Vec2 => [w0[0] + ((w1[0] - w0[0]) * d) / len, w0[1] + ((w1[1] - w0[1]) * d) / len];
  const out: [Vec2, Vec2][] = [];
  if (t[0] > 0.01) out.push([w0, at(t[0])]);
  if (t[1] < len - 0.01) out.push([at(t[1]), w1]);
  return out;
}

/** Whether two wall segments lie on each other (one's middle on the other): the same wall, if split or merged since. */
function overlaps(l: [Vec2, Vec2], m: [Vec2, Vec2]): boolean {
  const on = (seg: [Vec2, Vec2], p: Vec2) => {
    const pr = project(p, seg[0], seg[1]);
    return pr.distance < 0.03 && pr.t > 0.01 && pr.t < pr.length - 0.01;
  };
  const mid = (seg: [Vec2, Vec2]): Vec2 => [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2];
  return on(l, mid(m)) || on(m, mid(l));
}

/** More words each tool is found by in the command search. */
const TOOL_WORDS: Record<Tool, string> = {
  select: "select move drag pick",
  rect: "room rectangle shape draw area",
  wall: "wall free standing partition",
  railing: "railing fence banister balustrade gallery",
  balcony: "balcony terrace loggia deck patio",
  divide: "divider invisible wall split open kitchen",
  assign: "assign area name home assistant unassigned",
  opening: "door window garage skylight opening blind shutter contact",
  stairs: "stairs staircase steps ladder",
  furniture: "furniture sofa bed table chair lamp model polyhaven sketchfab",
  devices: "energy solar battery grid inverter heat pump wallbox",
  robots: "robot vacuum mower dock",
  measure: "measure ruler distance length",
  section: "section cut slice cross-section dollhouse profile",
};

// ----- drafts: unsaved changes kept in this browser -----

const draftKey = (house: string) => `homeslice-draft:${house}`;

function readDraft(house: string): { model: HouseInput; time: number; base: string } | null {
  try {
    const raw = localStorage.getItem(draftKey(house));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(house: string, draft: { model: HouseInput; time: number; base: string } | null) {
  try {
    if (draft) localStorage.setItem(draftKey(house), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(house));
  } catch {
    // private mode or full storage: no drafts, nothing else breaks
  }
}

/** A short fingerprint of a saved model (to tell whether a draft was based on it). */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Natural size of an image (data URL). */
function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("not an image"));
    img.src = src;
  });
}

/** Reads an image file and shrinks it to at most `max` pixels on its longer side (JPEG). */
async function shrinkImage(file: File, max: number): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const { width, height } = await imageSize(src);
  const k = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  img.src = src;
  await img.decode();
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** A level's floor plan image: where its top-left corner sits, metres per pixel, degrees. */
interface Underlay {
  level: string;
  /** Which of the level's backdrops (0: the first). */
  slot: number;
  image: string;
  width: number;
  height: number;
  /** `ruler`: the line the scale was set on (image pixels), shown as a measuring line. */
  place: { origin: Vec2; scale: number; rotation: number; ruler?: { a: Vec2; b: Vec2 } };
  opacity: number;
  /** A robot's map picture it was taken from (`image.*`): its rooms can be read off it. */
  source?: string;
}

/** The start screen: the house's name, the open choice and what it holds. */
interface StartState {
  replace: boolean;
  name: string;
  open: "ai" | "trace" | "file" | null;
  images: { name: string; data: string }[];
  withMaps: boolean;
  /** Floor → the robot map picture put under it ("" none). */
  floorMaps: Record<string, string>;
  /** Floor → a floor plan image (a data: URL) put under it. */
  plans?: Record<string, string>;
  /** The user picked maps for floors (the guess then stays out of it). */
  mapsTouched?: boolean;
  /** The floor whose live map catching is shown. */
  capture: { floor: string; map: string } | null;
  aiEntity: string;
  busy: boolean;
  paste: string;
  problems: string[];
  note: string;
  copied: boolean;
}

/** What Home Assistant keeps of a start: robot maps caught (by floor), the watches running. */
interface StartKept {
  captures: Record<string, { source: string; data: string; at: number; done: boolean }>;
  watches: Record<string, { map: string; robot: string | null; since: number }>;
}

/** A stored house, as the integration lists it (with the version a restore brings back). */
interface HouseSummary {
  id: string;
  name: string;
  updated?: string;
  source?: string;
  previous?: { updated: string; source: string };
}

type Drag =
  | { kind: "pan"; start: Vec2; offset: Vec2 }
  | { kind: "underlay"; start: Vec2; origin: Vec2 }
  | { kind: "floor-move"; start: Vec2; origin: HouseInput; place: Underlay["place"] | null }
  | { kind: "vertex"; origin: HouseInput; from: Vec2; ctx: SnapContext }
  | { kind: "edge"; origin: HouseInput; a: Vec2; b: Vec2; startWorld: Vec2; normal: Vec2; ctx: SnapContext; faces: number[] }
  | { kind: "rect"; start: Vec2; ctx: SnapContext }
  | { kind: "stair-move"; origin: HouseInput; id: string; rect: [number, number, number, number]; startWorld: Vec2; ctx: SnapContext; moved: boolean }
  | { kind: "stair-resize"; origin: HouseInput; id: string; fixed: Vec2; ctx: SnapContext }
  | { kind: "furniture"; origin: HouseInput; room: string; index: number; startWorld: Vec2; centre: Vec2; moved: boolean }
  | { kind: "energy"; origin: HouseInput; index: number; startWorld: Vec2; at: Vec2; moved: boolean }
  | { kind: "camera"; origin: HouseInput; room: string; index: number; startWorld: Vec2; moved: boolean }
  | { kind: "light"; origin: HouseInput; entity: string; room: string; startWorld: Vec2; ctx: SnapContext; moved: boolean; part?: number | "to" }
  | { kind: "wall"; origin: HouseInput; a: Vec2; b: Vec2; startWorld: Vec2; normal: Vec2; thickness: number; faces: number[] }
  | { kind: "opening"; origin: HouseInput; base?: HouseInput; src: OpeningSource; axis: 0 | 1; startWorld: Vec2; at: number; snaps: OpeningSnaps; room: string }
  | { kind: "measure"; ctx: SnapContext }
  | { kind: "section"; ctx: SnapContext }
  | { kind: "section-end"; origin: HouseInput; index: number; end: 0 | 1; ctx: SnapContext }
  | { kind: "freewall"; ctx: SnapContext }
  | { kind: "freewall-end"; origin: HouseInput; index: number; end: 0 | 1; ctx: SnapContext }
  | { kind: "freewall-move"; origin: HouseInput; index: number; line: [Vec2, Vec2]; startWorld: Vec2; ctx: SnapContext; faces: number[]; normal: Vec2 }
  | { kind: "energy-link"; from: number }
  | { kind: "robot"; origin: HouseInput; index: number; startWorld: Vec2; dock: Vec2; moved: boolean };

/** A length shown on the plan that can be clicked and typed. */
interface DimTarget {
  value: number;
  apply: (value: number) => HouseInput | null;
}

const cm = (m: number) => Math.round(m * 1000) / 10;

/** Words in lines of at most `chars` characters (a word longer than that keeps its own line). */
export function wrapWords(text: string, chars: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= Math.max(1, chars)) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length ? lines : [text];
}


function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // no storage: the setting lasts until the page is closed
  }
}

/** Where a dragged door or window can snap to, as positions along its wall. */
interface OpeningSnaps {
  /** The room's position along the wall axis (the opening's `at` is measured from here). */
  origin: number;
  width: number;
  /** Positions the opening's start or end can line up with. */
  edges: number[];
  /** Positions its centre can line up with. */
  centres: number[];
}

/** A floor's colour on the plan: its finish's, lightened so lines and labels stay readable. */
function planColor(floor: string): string {
  const c = FINISHES_BY_ID[floor]?.color ?? FINISHES_BY_ID.wood.color;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (v: number) => Math.round(v + (255 - v) * 0.55);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** Selection id for the level's outline (its outside walls). */
const OUTLINE = "__outline__";

const OPPOSITE: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };

export class HomeslicePanel extends LitElement {
  static override properties = {
    narrow: { type: Boolean },
    _houses: { state: true },
    _house: { state: true },
    _model: { state: true },
    _level: { state: true },
    _room: { state: true },
    _tool: { state: true },
    _drag: { state: true },
    _hint: { state: true },
    _view: { state: true },
    _saved: { state: true },
    _error: { state: true },
    _rectPreview: { state: true },
    _arriving: { state: true },
    _toolMiss: { state: true },
    _flyout: { state: true },
    _vertexSel: { state: true },
    _assignArea: { state: true },
    _assignHover: { state: true },
    _levelDrag: { state: true },
    _wall: { state: true },
    _opening: { state: true },
    _guides: { state: true },
    _loupe: { state: true },
    _create: { state: true },
    _start: { state: true },
    _startKept: { state: true },
    _startNext: { state: true },
    _pendingArea: { state: true },
    _stair: { state: true },
    _furn: { state: true },
    _folded: { state: true },
    _shortcuts: { state: true },
    _palette: { state: true },
    _tip: { state: true },
    _tour: { state: true },
    _draft: { state: true },
    _settings: { state: true },
    _wallView: { state: true },
    _energyPlace: { state: true },
    _energySel: { state: true },
    _energyPrefs: { state: true },
    _underlay: { state: true },
    _underlayHidden: { state: true },
    _underlaySlots: { state: true },
    _underlayAdding: { state: true },
    _calib: { state: true },
    _straighten: { state: true },
    _rulerHidden: { state: true },
    _underlayMove: { state: true },
    _floorMove: { state: true },
    _show: { state: true },
    _dimEdit: { state: true },
    _measure: { state: true },
    _sectionSel: { state: true },
    _sectionDraft: { state: true },
    _linePreview: { state: true },
    _freeWall: { state: true },
    _linkEnd: { state: true },
    _robotPlace: { state: true },
    _libraryFilter: { state: true },
    _snapPieces: { state: true },
    _librarySource: { state: true },
    _polyhaven: { state: true },
    _textures: { state: true },
    _finishSource: { state: true },
    _textureFilter: { state: true },
    _textureBusy: { state: true },
    _entityFilter: { state: true },
    _customModels: { state: true },
    _sketchfab: { state: true },
    _sfResults: { state: true },
    _sfBusy: { state: true },
    _sfError: { state: true },
    _placing: { state: true },
    _sideWidth: { state: true },
    _curveEdge: { state: true },
    _libraryError: { state: true },
    _checklist: { state: true },
    _openingPreset: { state: true },
    _hintsHidden: { state: true },
    _robotSel: { state: true },
    _robotCalib: { state: true },
  };

  narrow = false;
  private _hass?: Hass;
  private _houses: HouseSummary[] = [];
  private _house = "";
  private _model: HouseInput | null = null;
  private _level = "";
  private _room: string | null = null;
  private _tool: Tool = "select";
  private _drag: Drag | null = null;
  /** Readout next to the cursor while dragging. */
  private _hint: { x: number; y: number; lines: string[] } | null = null;
  /** Screen transform: px per metre and offset. */
  private _view = { scale: 40, ox: 40, oy: 40 };
  /** JSON of the last saved model, for the unsaved-changes indicator. */
  private _saved = "";
  private _error = "";
  private _rectPreview: Vec2[] | null = null;
  /** The assign tool: the area picked (tap a shape next), the one being dragged, and the shape it would go to. */
  private _assignArea: string | null = null;
  private _assignedLast: string | null = null;
  private assignDrag: string | null = null;
  private _assignHover: { poly: Vec2[]; area: string; room?: string } | null = null;
  /** A room corner selected (Delete removes it, its neighbours joined). */
  private _vertexSel: Vec2 | null = null;
  /** The toolbar button whose choices are open beside it, and where. */
  private _flyout: string | null = null;
  private _flyoutAt: { x: number; y: number } | null = null;
  /** Why the last stroke of a tool did nothing (until the next press). */
  private _toolMiss = "";
  /** The sub-tool last used in each toolbar group. */
  private _lastInGroup: Record<string, Tool> = {};
  /** A piece on its way (downloading into Home Assistant, then loading): where it will land, and what it is. */
  private _arriving: { at: Vec2; size: Vec2; name: string; bytes?: number } | null = null;
  /** Level being dragged in the level list (display indexes, top first). */
  private _levelDrag: { id: string; from: number; over: number; startY: number; dy: number; step: number; moved: boolean } | null = null;
  /** Selected wall between two rooms: the rooms and its side as seen from `a`. */
  /** A selected inside wall: its rooms and side (seen from `a`; null for a slanted wall). */
  private _wall: { a: string; b: string; side: Side | null; line?: [Vec2, Vec2] } | null = null;
  /** The wall view: one side of a room seen from inside it, and what is being dragged there. */
  private _wallView: { room: string; side: Side; sel?: string } | null = null;
  private robotPolledAt = 0;
  private wallDrag: { key: string; origin: HouseInput; start: Vec2; u: number; z: number; moved: boolean } | null = null;
  /** Selected opening (doors & windows mode) and the room it belongs to on this level. */
  private _opening: { src: OpeningSource; room: string } | null = null;
  /** Snap feedback drawn on the plan: guide lines and the corner snapped to. */
  /** The plan's drawing, for the loupe. */
  private _planContent: unknown = nothing;
  /** Touch drags: where the finger is (plan pixels), shown magnified in a free corner. */
  private _loupe: { x: number; y: number } | null = null;
  private _guides: { x?: number; y?: number; ring?: Vec2; rays?: [Vec2, Vec2][] } | null = null;
  /** The "new house" form while it is open. */
  /** `merges`: HA floors whose areas go onto another floor's level (floor → floor). */
  private _create: { name: string; width: number; depth: number; floors: string[]; rooms: boolean; merges: Record<string, string> } | null = null;
  /** The start screen (a new house, or starting this one over): its choices and what they hold. */
  private _start: StartState | null = null;
  /** What Home Assistant keeps of the start: maps caught (by floor) and the watches running. */
  private _startKept: StartKept = { captures: {}, watches: {} };
  private startSaveTimer?: number;
  private startPollTimer?: number;
  /** After a start: the next step, shown over the plan until dismissed. */
  private _startNext: string | null = null;
  /** The current level's floor plan image (loaded from HA), if any. */
  private _underlay: Underlay | null = null;
  private _underlayHidden = false;
  /** The current level's backdrops (slots), and the one shown last on each level. */
  private _underlaySlots: number[] = [];
  private underlaySlotOf: Record<string, number> = {};
  /** Adding another backdrop: an upload goes to a new slot. */
  private _underlayAdding = false;
  /** Setting the image's scale: two clicked points (image pixels), then their distance. */
  private _calib: { a?: Vec2; b?: Vec2; distance?: string } | null = null;
  /** Straightening a scan: two points (plan metres) along a wall that should run straight. */
  private _straighten: { a?: Vec2; to?: Vec2 } | null = null;
  private _rulerHidden = false;
  /** Dragging moves the image instead of editing the plan. */
  private _underlayMove = false;
  /** Moving the whole floor (rooms, everything in them, its floor plan image) by dragging. */
  private _floorMove = false;
  private underlayRequest = "";
  private underlaySaveTimer = 0;
  private _shortcuts = false;
  /** The command search (Ctrl+K): what is typed, the result picked. */
  private _palette: { q: string; i: number } | null = null;
  /** A tip right after doing something for the first time (each shown once in this browser). */
  private _tip: string | null = null;
  /** The guided tour: its step (0 is the offer), and the house as that step began. */
  private _tour: number | null = null;
  private tourBase: { model: string; level: string; counts: TourCounts } | null = null;
  /** Show the rooms' inside lengths on the plan. */
  private _show: Record<Layer, boolean> = readLayers();
  /** A length being typed: where its field sits and what it changes. */
  private _dimEdit: { x: number; y: number; target: DimTarget } | null = null;
  /** Lengths on the plan that can be typed, by key (filled while rendering). */
  private dimTargets = new Map<string, DimTarget>();
  /** The measuring tool's line. */
  private _measure: { a: Vec2; b: Vec2 } | null = null;
  /** The selected section (its index), and one being drawn. */
  private _sectionSel: number | null = null;
  private _sectionDraft: { a: Vec2; b: Vec2 } | null = null;
  /** A free-standing wall being drawn. */
  private _linePreview: [Vec2, Vec2] | null = null;
  /** Selected free-standing wall (index in the level's `walls`). */
  private _freeWall: number | null = null;
  /** Robot entity waiting for a click on its dock. */
  private _robotPlace: string | null = null;
  private _robotSel: number | null = null;
  /** Calibrating a robot: its reading now, waiting for a click where it is on the plan. */
  private _robotCalib: { index: number; reading: Vec2 } | null = null;
  /** While connecting two energy items: the free end of the line (plan metres). */
  private _linkEnd: Vec2 | null = null;
  /** The checklist is open in the inspector. */
  private _checklist = false;
  private checkCache: { model: HouseInput; states: unknown; items: CheckItem[] } | null = null;
  /** Filter text of the furniture library. */
  private _libraryFilter = "";
  /** Pieces snap to walls (wall pieces hang on them) and to each other; off: placed freely. */
  private _snapPieces = readPref("homeslice-snap-pieces") !== "off";
  /** Tools whose hint was dismissed. */
  private _hintsHidden: string[] = (() => {
    try {
      return JSON.parse(readPref("homeslice-hints-hidden") ?? "[]");
    } catch {
      return [];
    }
  })();
  /** What a click on a wall adds with the door & window tool. */
  private _openingPreset = "window";
  /** Door or window being dragged from the library onto a wall. */
  private openingDrag: string | null = null;
  /** Furniture type being dragged from the library onto the plan. */
  private libraryDrag: LibraryItem | null = null;
  /** The library's source (remembered in this browser). */
  // "modern" was a source of its own before it joined the built-in pieces
  private _librarySource: LibrarySource = (LIBRARY_SOURCES as string[]).includes(readPref("homeslice-library") ?? "") ? (readPref("homeslice-library") as LibrarySource) : "builtin";
  /** Poly Haven's catalogue: loading (null), loaded, or why it can't be. */
  private _polyhaven: PolyhavenAsset[] | { error: string } | null = null;
  /** Poly Haven's textures for the finish pickers. */
  private _textures: PolyhavenTexture[] | { error: string } | null = null;
  private _finishSource: "builtin" | "polyhaven" = "builtin";
  private _textureFilter = "";
  private _textureBusy: string | null = null;
  private _entityFilter = "";
  private _customModels: CustomAsset[] | null = null;
  /** Sketchfab: whether a token is set (whose), the last search, a download going on, a problem. */
  private _sketchfab: { configured: boolean; username: string | null } | null = null;
  private _sfResults: { query: string; results: SketchfabHit[]; next: string | null } | null = null;
  private _sfBusy: string | null = null;
  private _sfError = "";
  /** A library item being downloaded or measured before it is placed. */
  private _placing: string | null = null;
  /** The side panel's width (px), dragged by its edge and kept in this browser; null: the default. */
  private _sideWidth: number | null = Number(readPref("homeslice-side-width")) || null;
  private sideDrag: { x: number; width: number; max: number } | null = null;
  /** The wall picked in a curves control (by its room or the outline). */
  private _curveEdge: { target: string; edge: number } | null = null;
  private _libraryError = "";
  /** Selected piece of furniture (objects mode). */
  private _furn: { room: string; index: number } | null = null;
  /** Library groups folded shut (remembered in this browser). */
  private _folded = new Set<string>(JSON.parse(readPref("homeslice-folded") ?? "[]") as string[]);
  /** A piece copied with Ctrl+C or Ctrl+X, with where it came from. */
  private _clip: { piece: FurnitureInput; level: string; room: string } | null = null;
  /** Where the pointer is on the plan, for pasting there. */
  private _planPointer: Vec2 | null = null;
  /** Unsaved changes found from an earlier visit, offered for restoring. */
  private _draft: { model: HouseInput; time: number; stale: boolean } | null = null;
  private draftTimer = 0;
  /** House settings in the inspector: name, YAML in and out, delete. */
  private _settings: { paste?: string; problems?: string[]; copied?: boolean; prompt?: "copying" | "copied" | string; errorsCopied?: boolean; notice?: string } | null = null;
  /** Energy item waiting for a click on the plan to be placed. */
  private _energyPlace: EnergyInput | null = null;
  private _energySel: number | null = null;
  private _energyPrefs: EnergyPrefs | null = null;
  /** Selected stair or shaft (id in `vertical`). */
  private _stair: string | null = null;
  /** Area to link to the next room drawn with the rectangle tool. */
  private _pendingArea: string | null = null;
  private history = new History<HouseInput>();
  private renderer?: HouseRenderer;
  private previewTimer = 0;
  private tourOffered = false;
  /** The room selected until just now (a click picked something else): for a double-click that follows. */
  private roomBefore: { id: string; time: number } | null = null;
  private fitted = "";
  private onKey = (e: KeyboardEvent) => this.handleKey(e);

  get hass() {
    return this._hass;
  }

  set hass(hass: Hass | undefined) {
    const first = !this._hass && hass;
    this._hass = hass;
    void loadLanguage(hass?.locale?.language).then((loaded) => loaded && this.requestUpdate());
    if (first) void this.loadHouses();
    // live readings (robots, lights) follow HA, at most once a second
    if (!this.hassRefresh)
      this.hassRefresh = window.setTimeout(() => {
        this.hassRefresh = 0;
        this.requestUpdate();
      }, 1000);
  }

  private hassRefresh = 0;

  private t(key: StringKey, vars?: Record<string, string | number>) {
    return localize(this._hass?.locale?.language, key, vars);
  }

  /** A number for reading, with the user's decimal separator. */
  private n(v: number, digits = 2) {
    return formatNumber(this._hass?.locale, v, digits);
  }

  private fmtM(v: number) {
    return `${this.n(v)} m`;
  }

  /** Keeps unsaved changes in this browser, so a reload or crash doesn't lose them. */
  private keepDraft() {
    clearTimeout(this.draftTimer);
    const house = this._house;
    this.draftTimer = window.setTimeout(() => {
      if (!this._model || house !== this._house) return;
      if (this.dirty) writeDraft(house, { model: this._model, time: Date.now(), base: hash(this._saved) });
      else writeDraft(house, null);
    }, 400);
  }

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!this.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("beforeunload", this.onBeforeUnload);
    // HA may create the element and set hass before this bundle has defined it: those
    // values then sit on the instance and hide the setters, so pass them on now
    for (const key of ["hass", "narrow"] as const) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const value = (this as Record<string, unknown>)[key];
        delete (this as Record<string, unknown>)[key];
        (this as Record<string, unknown>)[key] = value;
      }
    }
    window.addEventListener("keydown", this.onKey);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    // leaving the editor: the start is kept as it is right now
    if (this.startSaveTimer !== undefined) this.saveStart();
    clearTimeout(this.startPollTimer);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    window.removeEventListener("keydown", this.onKey);
    clearTimeout(this.hassRefresh);
    this.hassRefresh = 0;
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  // ----- loading and saving -----

  private async loadHouses() {
    this._hass!.callWS<EnergyPrefs>({ type: "energy/get_prefs" })
      .then((p) => (this._energyPrefs = p))
      .catch(() => (this._energyPrefs = { energy_sources: [], device_consumption: [] }));
    try {
      this._houses = await this._hass!.callWS<HouseSummary[]>({ type: "homeslice/houses" });
      this.housesLoaded = true;
      // a start left half way (gone to Settings to reload the robot's integration, say): back where it was
      const kept = await this.loadStart();
      if (this._houses.length) await this.openHouse(this._houses[0].id);
      if (kept?.state) this._start = { ...this.newStart(!!kept.state.replace), ...kept.state, busy: false, note: "", problems: [], copied: false } as StartState;
      else if (!this._houses.length) this._start = this.newStart(false);
    } catch (e) {
      this._error = String((e as { message?: string }).message ?? e);
    }
  }

  private housesLoaded = false;

  // ----- the start: a new house from what Home Assistant already knows -----

  private newStart(replace: boolean): StartState {
    const maps = this.startMaps();
    return {
      replace,
      name: replace ? (this._model?.name ?? "") : this._houses.length ? "" : this._hass?.config?.location_name || this.t("editor.new_house_default_name"),
      open: null,
      images: [],
      withMaps: maps.length > 0,
      floorMaps: Object.fromEntries(this.haFloors().map((f) => [f.floor_id, maps.find((m) => m.live && m.scale && m.floor === f.floor_id)?.id ?? ""])),
      capture: null,
      aiEntity: this.aiEntities()[0]?.id ?? "",
      busy: false,
      paste: "",
      problems: [],
      note: "",
      copied: false,
    };
  }

  private setStart(patch: Partial<StartState>) {
    this._start = { ...(this._start ?? this.newStart(false)), ...patch };
    // kept in Home Assistant, so the start goes on where it was left (any page, any device)
    clearTimeout(this.startSaveTimer);
    this.startSaveTimer = window.setTimeout(() => this.saveStart(), 600);
  }

  private saveStart() {
    clearTimeout(this.startSaveTimer);
    this.startSaveTimer = undefined;
    const st = this._start;
    if (!st) return;
    const { busy: _b, note: _n, problems: _p, copied: _c, ...keep } = st;
    void this._hass?.callWS({ type: "homeslice/start/set", state: keep }).catch(() => undefined);
  }

  /** What Home Assistant keeps of the start; polled while a robot's map is being watched. */
  private async loadStart(): Promise<{ state: Partial<StartState> | null } | null> {
    try {
      const got = await this._hass!.callWS<{ state: Partial<StartState> | null } & StartKept>({ type: "homeslice/start" });
      this._startKept = { captures: got.captures ?? {}, watches: got.watches ?? {} };
      clearTimeout(this.startPollTimer);
      if (Object.keys(this._startKept.watches).length) this.startPollTimer = window.setTimeout(() => void this.loadStart(), this._start ? 5000 : 30000);
      return got;
    } catch {
      return null;
    }
  }

  /** The start is over (a house made, or cancelled): nothing of it is kept. */
  private endStart() {
    clearTimeout(this.startSaveTimer);
    this.startSaveTimer = undefined;
    clearTimeout(this.startPollTimer);
    this._startKept = { captures: {}, watches: {} };
    void this._hass?.callWS({ type: "homeslice/start/clear" }).catch(() => undefined);
  }

  /** AI Task entities (an AI connected to Home Assistant), those taking pictures first. */
  private aiEntities(): { id: string; name: string; pictures: boolean }[] {
    const states = this._hass?.states ?? {};
    return Object.keys(states)
      .filter((id) => id.startsWith("ai_task.") && states[id].state !== "unavailable")
      .map((id) => ({ id, name: this.entityName(id), pictures: (Number(states[id].attributes.supported_features ?? 0) & 2) === 2 }))
      .sort((a, b) => Number(b.pictures) - Number(a.pictures));
  }

  /** Robot map pictures: their robot, scale (if known) and the floor they seem to show. */
  private startMaps(): { id: string; name: string; scale: number | null; floor?: string; live: boolean; own: string }[] {
    const states = this._hass?.states ?? {};
    const ids = this.robotMaps();
    // the maps' own names: what one robot's maps share in front (its name) taken off
    const own = ownNames(
      ids.map((id) => {
        const device = this._hass?.entities?.[id]?.device_id ?? undefined;
        const d = device ? this._hass?.devices?.[device] : undefined;
        return { id, name: this.entityName(id), robot: device, device: d?.name_by_user ?? d?.name ?? undefined };
      }),
    );
    // which floor each shows: by name at first, then also by its rooms (once the robot named them)
    const guess = this.mapGuess ?? assignMaps(ids.map((id) => ({ id, name: own[id], rooms: [] })), this.floorEvidence());
    const floorOf = Object.fromEntries(Object.entries(guess).map(([f, m]) => [m, f]));
    return ids.map((id) => ({
      id,
      name: this.entityName(id),
      own: own[id],
      scale: mapScale(this._hass?.entities?.[id]?.platform),
      floor: floorOf[id],
      // some robots show their map only while they work (it is "unknown" in between)
      live: !["unknown", "unavailable"].includes(states[id]?.state ?? "unknown"),
    }));
  }

  /** Floors as evidence for robot maps: their names and their areas' names. */
  private floorEvidence() {
    return this.haFloors().map((f) => ({ floor_id: f.floor_id, name: f.name, areas: this.floorAreas(f.floor_id).map((a) => a.name) }));
  }

  /** The guess of which map shows which floor, with the robots' room names as evidence too. */
  private mapGuess: Record<string, string> | null = null;
  private guessing = false;

  private async guessMapFloors() {
    if (this.guessing) return;
    this.guessing = true;
    try {
      const maps = this.startMaps();
      const evidence = await Promise.all(maps.map(async (m) => ({ id: m.id, name: m.own, rooms: Object.values(await this.robotRoomNames(m.id)) })));
      this.mapGuess = assignMaps(evidence, this.floorEvidence());
      const st = this._start;
      // the user's own picks stay; else the better guess
      if (st && !st.mapsTouched) {
        const live = new Set(maps.filter((m) => m.live && m.scale).map((m) => m.id));
        this.setStart({ floorMaps: Object.fromEntries(this.haFloors().map((f) => [f.floor_id, live.has(this.mapGuess![f.floor_id]) ? this.mapGuess![f.floor_id] : ""])) });
      }
    } finally {
      this.guessing = false;
    }
  }

  /** A map picture as it is now, in its own colours (a data URL). */
  private async grabMap(id: string): Promise<string> {
    const url = this._hass?.states[id]?.attributes.entity_picture as string | undefined;
    if (!url) throw new Error(this.t("editor.start_capture_none"));
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  /** The house's floors from Home Assistant (bottom first), "Outside" joining the ground floor; placeholder rooms where `rooms` says. */
  private floorSeeds(rooms: (floorId: string) => boolean) {
    const floors = this.haFloors();
    const merges = suggestMerges([...floors].reverse().map((f) => ({ floor_id: f.floor_id, name: f.name, level: f.level, areas: this.floorAreas(f.floor_id) })));
    const merged = (f: string) => !!merges[f] && !merges[merges[f]];
    return floors
      .filter((f) => !merged(f.floor_id))
      .reverse()
      .map((f) => {
        const include = floors.map((x) => x.floor_id).filter((x) => merged(x) && merges[x] === f.floor_id);
        return { floor_id: f.floor_id, ...(include.length ? { include_floors: include } : {}), areas: rooms(f.floor_id) ? [f.floor_id, ...include].flatMap((x) => this.floorAreas(x)) : [] };
      });
  }

  /** Keeps a started house (a new one, or this one replaced) and opens it. */
  private async startHouse(model: HouseInput, next: string | null): Promise<string | null> {
    const st = this._start!;
    const name = st.name.trim() || model.name || this.t("editor.new_house_default_name");
    const id = st.replace ? this._house : uniqueId(this._houses.map((h) => h.id), slug(name, "home"));
    const m: HouseInput = { ...migrateHouse(model), id, name };
    try {
      await this._hass!.callWS({ type: "homeslice/model/save", house: id, model: m });
    } catch (e) {
      this.setStart({ busy: false, note: this.t("editor.save_failed", { message: String((e as { message?: string }).message ?? e) }) });
      return null;
    }
    this._houses = await this._hass!.callWS<HouseSummary[]>({ type: "homeslice/houses" });
    this._model = null;
    this._saved = "";
    this._start = null;
    this.endStart();
    await this.openHouse(id);
    this._startNext = next;
    return id;
  }

  /** A house with the floors only (to trace a plan on, or to draw by hand). */
  private async startEmpty() {
    const model = newHouse("home", "", [10, 8], this.floorSeeds(() => false));
    for (const l of model.levels) l.rooms = [];
    await this.startHouse(model, this.t("editor.start_next_empty"));
  }

  /** What the assistant is told: the guide (this Home Assistant's floors, areas, entities), the maps, the answer wanted. */
  private async startPrompt(st: StartState, attached: boolean): Promise<string> {
    const { guide } = await this._hass!.callWS<{ guide: string }>({ type: "homeslice/guide" });
    const notes: MapNote[] = [];
    if (st.withMaps) {
      const maps = this.startMaps();
      for (const [floor, id] of Object.entries(st.floorMaps)) {
        const m = maps.find((x) => x.id === id && x.live);
        if (m) notes.push({ name: m.name, floor, scale: m.scale, rooms: await this.robotRoomNames(m.id) });
      }
      for (const [floor, c] of Object.entries(this._startKept.captures)) {
        const m = maps.find((x) => x.id === c.source);
        notes.push({ name: this.entityName(c.source), floor, scale: m?.scale ?? null, rooms: await this.robotRoomNames(c.source) });
      }
    }
    const pictures = st.images.length || (st.withMaps && notes.length);
    return [
      this.t("editor.ai_prompt_intro"),
      pictures ? (attached ? "I attach pictures of my home: a floor plan (photo or sketch) and/or robot vacuum maps." : "I'll attach pictures of my home: a floor plan (photo or sketch) and/or robot vacuum maps.") : "I have no floor plan at hand: make a sensible first draft from the floors and areas below, rooms of typical sizes.",
      "Reply with the whole house in one YAML code block, nothing else.",
      guide,
      mapNotes(notes),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** A house in YAML (an assistant's answer, a pasted file): checked, then started. */
  private async startFromYaml(text: string) {
    let parsed: unknown;
    try {
      parsed = parseYaml(extractYaml(text));
    } catch (e) {
      this.setStart({ busy: false, problems: [String((e as { message?: string }).message ?? e)] });
      return;
    }
    const { issues } = expandHouse(parsed);
    const errors = issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`);
    if (errors.length) {
      this.setStart({ busy: false, problems: errors });
      return;
    }
    await this.startHouse(parsed as HouseInput, this.t("editor.start_next_ai"));
  }

  /** Puts a picture into Home Assistant's media (for an AI Task to look at); its media id. */
  private async uploadMedia(name: string, data: string): Promise<string> {
    const hass = this._hass!;
    if (!hass.fetchWithAuth) throw new Error("This Home Assistant does not take uploads here");
    const blob = await (await fetch(data)).blob();
    const form = new FormData();
    form.append("media_content_id", "media-source://media_source/local/.");
    form.append("file", new File([blob], name.replace(/[^\w.-]+/g, "_") || "plan.jpg", { type: blob.type || "image/jpeg" }));
    const res = await hass.fetchWithAuth("/api/media_source/local_source/upload", { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return ((await res.json()) as { media_content_id: string }).media_content_id;
  }

  /** "Draw it with AI" through Home Assistant's AI Task: the pictures and maps attached, the house back. */
  private async startWithAi(st: StartState) {
    this.setStart({ busy: true, problems: [], note: this.t("editor.start_ai_working") });
    try {
      const attachments: { media_content_id: string; media_content_type: string }[] = [];
      for (const img of st.images) attachments.push({ media_content_id: await this.uploadMedia(img.name, img.data), media_content_type: img.data.slice(5, img.data.indexOf(";")) || "image/jpeg" });
      if (st.withMaps) {
        const live = new Set(this.startMaps().filter((m) => m.live).map((m) => m.id));
        for (const id of Object.values(st.floorMaps)) if (id && live.has(id)) attachments.push({ media_content_id: `media-source://image/${id}`, media_content_type: "image/png" });
        for (const c of Object.values(this._startKept.captures)) attachments.push({ media_content_id: await this.uploadMedia(`${c.source}.png`, c.data), media_content_type: "image/png" });
      }
      const instructions = await this.startPrompt(st, true);
      const res = (await this._hass!.callService("ai_task", "generate_data", { task_name: "Homeslice house", entity_id: st.aiEntity, instructions, ...(attachments.length ? { attachments } : {}) }, undefined, false, true)) as { response?: { data?: unknown } };
      const data = res?.response?.data;
      if (typeof data !== "string" || !data.trim()) throw new Error(this.t("editor.start_ai_empty"));
      this.setStart({ paste: data, note: "" });
      await this.startFromYaml(data);
    } catch (e) {
      this.setStart({ busy: false, note: String((e as { message?: string }).message ?? e) });
    }
  }

  /**
   * A house with the floors only, each with its backdrops to trace: the floor plan image
   * given for it and the robot's map (true to scale), to switch between.
   */
  private async startTrace(st: StartState) {
    this.setStart({ busy: true, note: "", problems: [] });
    try {
      const all = this.startMaps();
      const caught = this._startKept.captures;
      const model = newHouse("home", "", [10, 8], this.floorSeeds(() => false));
      for (const l of model.levels) l.rooms = [];
      const backdrops: { level: string; image: string; place: Underlay["place"]; source?: string }[] = [];
      for (const level of model.levels) {
        const floors = [level.floor_id, ...(level.include_floors ?? [])].filter((f): f is string => !!f);
        // the floor plan first (it shows the walls and doors), then the robot's map
        for (const f of floors) {
          const plan = st.plans?.[f];
          if (!plan) continue;
          const { width } = await imageSize(plan);
          backdrops.push({ level: level.id, image: plan, place: { origin: [0, 0], scale: 10 / width, rotation: 0 } });
        }
        for (const f of floors) {
          const c = caught[f];
          const map = all.find((x) => x.id === (c?.source ?? st.floorMaps[f]));
          if (!map?.scale || (!c && !map.live)) continue;
          const blob = await (await fetch(c?.data ?? (await this.grabMap(map.id)))).blob();
          const bitmap = await createImageBitmap(blob);
          const image = await shrinkImage(new File([blob], "map.png", { type: blob.type }), 2400);
          const { width } = await imageSize(image);
          backdrops.push({ level: level.id, image, place: { origin: [0, 0], scale: (map.scale * bitmap.width) / width, rotation: 0 }, source: map.id });
        }
      }
      const several = backdrops.some((b, i) => backdrops.findIndex((x) => x.level === b.level) !== i);
      const id = await this.startHouse(model, this.t(several ? "editor.start_next_trace_both" : backdrops.length ? "editor.start_next_trace_one" : "editor.start_next_trace"));
      if (!id) return;
      const slots: Record<string, number> = {};
      for (const b of backdrops) {
        const slot = (slots[b.level] = (slots[b.level] ?? -1) + 1);
        await this._hass!.callWS({ type: "homeslice/underlay/set", house: id, level: b.level, slot, image: b.image, place: b.place, opacity: 0.5, source: b.source ?? null });
      }
      this.underlayRequest = "";
      void this.loadUnderlay();
    } catch (e) {
      this.setStart({ busy: false, note: String((e as { message?: string }).message ?? e) });
    }
  }

  /** "Restore or import a file": a Homeslice backup or house, Sweet Home 3D, an SVG plan, another floor-plan card's export. */
  private async startFromFile(file: File) {
    this.setStart({ busy: true, problems: [], note: "" });
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".zip")) {
        const data = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.readAsDataURL(file);
        });
        const r = await this._hass!.callWS<{ houses: string[] }>({ type: "homeslice/backup/restore", data });
        this._houses = await this._hass!.callWS<HouseSummary[]>({ type: "homeslice/houses" });
        this._start = null;
        this._model = null;
        await this.openHouse(r.houses[0] ?? this._houses[0].id);
        return;
      }
      let model: HouseInput;
      if (name.endsWith(".sh3d")) {
        const { sh3dXml, sweetHomeToHouse } = await import("../import/sweethome");
        model = sweetHomeToHouse(sh3dXml(new Uint8Array(await file.arrayBuffer())));
      } else if (name.endsWith(".svg")) {
        const width = parseFloat((prompt(this.t("editor.import_svg_width"), "12") ?? "").replace(",", "."));
        if (!(width > 0)) return this.setStart({ busy: false });
        const { svgToHouse } = await import("../import/svgplan");
        model = svgToHouse(await file.text(), width).house as HouseInput;
      } else {
        const text = await file.text();
        let parsed: unknown = null;
        try {
          parsed = parseYaml(text);
        } catch {
          // not YAML: another card's export
        }
        if (parsed && typeof parsed === "object" && "levels" in parsed) return void (await this.startFromYaml(text));
        const { planToHouse } = await import("../import/planjson");
        model = planToHouse(text).house as HouseInput;
      }
      await this.startHouse(model, this.t("editor.start_next_file"));
    } catch (e) {
      this.setStart({ busy: false, note: String((e as { message?: string }).message ?? e) });
    }
  }

  private renderStart(st: StartState) {
    const floors = this.haFloors();
    const areas = Object.keys(this._hass?.areas ?? {}).length;
    const ai = this.aiEntities();
    const maps = this.startMaps();
    const box = (key: string, icon: string, badge: string, found: unknown, body: unknown, act: () => void, open = false, grey = false) => html`<section class="start-box ${open ? "open" : ""} ${grey ? "grey" : ""}" data-start=${key}>
        <button class="start-head" ?disabled=${grey || st.busy} @click=${act} aria-expanded=${open}>
          <ha-icon icon=${icon}></ha-icon>
          <span class="start-title">${this.t(`editor.start_${key}` as StringKey)}${badge ? html`<span class="badge">${badge}</span>` : nothing}</span>
          <span class="muted start-text">${this.t(`editor.start_${key}_text` as StringKey)}</span>
          <span class="start-found">${found}</span>
        </button>
        ${open ? html`<div class="start-body">${body}</div>` : nothing}
      </section>`;
    const toggle = (k: StartState["open"]) => () => {
      this.setStart({ open: st.open === k ? null : k, note: "", problems: [] });
      if (k === "trace" || k === "ai") void this.guessMapFloors();
    };
    const problems = st.problems.length
      ? html`<ul class="problems">${st.problems.map((x) => html`<li>${x}</li>`)}</ul>
          <button @click=${async () => {
            await navigator.clipboard?.writeText(this.t("editor.ai_errors_text") + "\n" + st.problems.map((x) => `- ${x}`).join("\n")).catch(() => undefined);
          }}>${this.t("editor.ai_errors")}</button>`
      : nothing;
    const aiBody = html`
      <p class="muted">${this.t("editor.start_ai_images")}</p>
      <div class="start-images">
        ${st.images.map((img, i) => html`<figure><img src=${img.data} alt=${img.name} /><button class="remove-model" aria-label=${this.t("editor.light_remove")} @click=${() => this.setStart({ images: st.images.filter((_, k) => k !== i) })}>×</button></figure>`)}
        <label class="file">${this.t("editor.start_ai_add_image")}<input type="file" accept="image/*" multiple data-start-images @change=${async (e: Event) => {
          const files = [...((e.target as HTMLInputElement).files ?? [])];
          (e.target as HTMLInputElement).value = "";
          const added = await Promise.all(files.map(async (f) => ({ name: f.name, data: await shrinkImage(f, 2000) })));
          this.setStart({ images: [...(this._start ?? st).images, ...added] });
        }} /></label>
      </div>
      ${maps.length
        ? html`<label class="check"><input type="checkbox" data-start-maps .checked=${st.withMaps} @change=${(e: Event) => this.setStart({ withMaps: (e.target as HTMLInputElement).checked })} />
            ${this.t("editor.start_ai_maps", { maps: maps.map((m) => m.name).join(", ") })}</label>`
        : nothing}
      ${ai.length
        ? html`${ai.length > 1
              ? html`<label>${this.t("editor.start_ai_entity")}<select @change=${(e: Event) => this.setStart({ aiEntity: (e.target as HTMLSelectElement).value })}>
                  ${ai.map((a) => html`<option value=${a.id} ?selected=${a.id === st.aiEntity}>${a.name}</option>`)}</select></label>`
              : nothing}
            <button class="primary" data-start-ai-run ?disabled=${st.busy} @click=${() => void this.startWithAi(st)}>${this.t("editor.start_ai_run")}</button>
            <p class="muted">${this.t("editor.start_ai_or")}</p>`
        : nothing}
      <div class="row">
        <button data-start-ai-copy @click=${async () => {
          const text = await this.startPrompt(st, false);
          await navigator.clipboard?.writeText(text).catch(() => undefined);
          this.setStart({ copied: true });
        }}>${st.copied ? this.t("editor.copied") : this.t("editor.start_ai_copy")}</button>
        ${st.withMaps
          ? maps.map(
              (m) => html`<a class="button" download=${`${m.id}.png`} href=${String(this._hass?.states[m.id]?.attributes.entity_picture ?? "")}>${this.t("editor.start_ai_map_download", { map: m.name })}</a>`,
            )
          : nothing}
      </div>
      <p class="muted">${this.t("editor.start_ai_paste_hint")}</p>
      <textarea class="yaml" rows="6" spellcheck="false" data-start-paste .value=${st.paste} @input=${(e: Event) => this.setStart({ paste: (e.target as HTMLTextAreaElement).value, problems: [] })}></textarea>
      ${problems}
      <button class="primary" data-start-paste-use ?disabled=${!st.paste.trim() || st.busy} @click=${() => void this.startFromYaml(st.paste)}>${this.t("editor.start_ai_use")}</button>`;
    const ready = maps.filter((m) => m.live && m.scale);
    const liveOnly = maps.filter((m) => !m.live && m.scale);
    const robotName = (m: (typeof maps)[number]) => this.entityName(Object.values(this._hass?.entities ?? {}).find((e) => e.entity_id.startsWith("vacuum.") && e.device_id === this._hass?.entities?.[m.id]?.device_id)?.entity_id ?? m.id);
    const kept = this._startKept;
    const chosen = (f: string) => !!kept.captures[f] || !!st.floorMaps[f];
    const cap = st.capture;
    const capMap = cap ? maps.find((m) => m.id === cap.map) : undefined;
    const floorName = (id: string) => floors.find((f) => f.floor_id === id)?.name ?? id;
    const traceBody = html`
      <p class="muted">${this.t("editor.start_trace_floors")}</p>
      ${floors.map((f) => {
        const c = kept.captures[f.floor_id];
        const watching = kept.watches[f.floor_id];
        return html`<div class="start-floor" data-start-floor=${f.floor_id}>
          <span class="start-floor-name">${f.name}</span>
          ${watching
            ? html`<span class="start-floor-map"><ha-icon icon="mdi:radar"></ha-icon>${this.t("editor.start_capture_watching", { robot: this.entityName(watching.robot ?? watching.map) })}
                <button class="link" @click=${() => this.setStart({ capture: { floor: f.floor_id, map: watching.map } })}>${this.t("editor.start_capture_show")}</button></span>`
            : c
            ? html`<span class="start-floor-map"><ha-icon icon="mdi:check"></ha-icon>${this.t("editor.start_capture_kept", { map: this.entityName(c.source) })}
                <button class="link" @click=${async () => {
                  await this._hass!.callWS({ type: "homeslice/start/stop", floor: f.floor_id, drop: true });
                  await this.loadStart();
                }}>${this.t("editor.light_remove")}</button></span>`
            : html`<select data-start-map=${f.floor_id} @change=${(e: Event) => this.setStart({ floorMaps: { ...st.floorMaps, [f.floor_id]: (e.target as HTMLSelectElement).value }, mapsTouched: true })}>
                <option value="">${this.t("editor.start_map_none")}</option>
                ${ready.map((m) => html`<option value=${m.id} ?selected=${st.floorMaps[f.floor_id] === m.id}>${m.name}</option>`)}
              </select>`}
          <label class="file start-plan">
            ${st.plans?.[f.floor_id] ? html`<img alt="" src=${st.plans[f.floor_id]} />` : nothing}
            ${this.t(st.plans?.[f.floor_id] ? "editor.start_plan_replace" : "editor.start_plan_add")}
            <input type="file" accept="image/png,image/jpeg,image/webp" data-start-plan=${f.floor_id} @change=${async (e: Event) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = "";
              if (!file) return;
              const data = await shrinkImage(file, 2400);
              this.setStart({ plans: { ...((this._start ?? st).plans ?? {}), [f.floor_id]: data } });
            }} />
          </label>
          ${chosen(f.floor_id) || !maps.length
            ? nothing
            : html`<div class="start-floor-help">
                ${ready.length
                  ? html`<div class="start-recommend" data-start-recommend=${f.floor_id}><ha-icon icon="mdi:star-outline"></ha-icon>
                      <span>${this.t("editor.start_floor_carry", { robot: robotName(ready[0]), floor: f.name })}</span></div>`
                  : nothing}
                ${ready.length && liveOnly.length ? html`<span class="muted">${this.t("editor.start_floor_or")}</span>` : nothing}
                ${liveOnly.map(
                  (m) => html`<button data-start-capture=${f.floor_id} @click=${async () => {
                    // Home Assistant watches the map from now on (with the editor closed too)
                    await this._hass!.callWS({ type: "homeslice/start/watch", floor: f.floor_id, map: m.id });
                    await this.loadStart();
                    this.setStart({ capture: { floor: f.floor_id, map: m.id } });
                  }}>
                    ${this.t("editor.start_capture_start", { robot: robotName(m) })}</button>`,
                )}
              </div>`}
        </div>`;
      })}
      ${cap && capMap
        ? html`<div class="start-capture" data-start-capture-panel>
            <h4>${this.t("editor.start_capture_title", { robot: robotName(capMap), floor: floorName(cap.floor) })}</h4>
            <ol>
              <li>${this.t("editor.start_capture_1", { floor: floorName(cap.floor) })}</li>
              <li>${this.t("editor.start_capture_2")}</li>
              <li>${this.t("editor.start_capture_3")}</li>
            </ol>
            <p class="muted">${this.t("editor.start_capture_away")}</p>
            ${kept.captures[cap.floor]
              ? html`<img class="start-live" alt="" src=${kept.captures[cap.floor].data} />
                  <p class="muted">${this.t("editor.start_capture_latest", { time: new Date(kept.captures[cap.floor].at * 1000).toLocaleTimeString() })}</p>`
              : capMap.live
                ? html`<img class="start-live" alt="" src=${String(this._hass?.states[capMap.id]?.attributes.entity_picture ?? "")} />`
                : html`<p class="notice">${this.t("editor.start_capture_waiting", { robot: robotName(capMap) })}</p>`}
            <div class="row">
              <button class="primary" data-start-capture-keep ?disabled=${(!capMap.live && !kept.captures[cap.floor]) || st.busy} @click=${async () => {
                try {
                  // done: as it is now (if it is showing), else the last picture caught
                  if (capMap.live) await this._hass!.callWS({ type: "homeslice/start/capture", floor: cap.floor, map: capMap.id });
                  await this._hass!.callWS({ type: "homeslice/start/stop", floor: cap.floor });
                  await this.loadStart();
                  this.setStart({ capture: null });
                } catch (e) {
                  this.setStart({ note: String((e as { message?: string }).message ?? e) });
                }
              }}>${this.t("editor.start_capture_keep")}</button>
              <button @click=${async () => {
                await this._hass!.callWS({ type: "homeslice/start/stop", floor: cap.floor, drop: !kept.captures[cap.floor]?.done });
                await this.loadStart();
                this.setStart({ capture: null });
              }}>${this.t("editor.start_capture_stop")}</button>
              <button @click=${() => this.setStart({ capture: null })}>${this.t("editor.start_capture_hide")}</button>
            </div>
          </div>`
        : nothing}
      ${ready.length ? html`<p class="muted">${this.t("editor.start_recheck")}</p>` : nothing}
      ${maps.some((m) => !m.scale) ? html`<p class="muted">${this.t("editor.start_map_scale_unknown")}</p>` : nothing}
      <p class="muted">${this.t("editor.start_trace_after")}</p>
      <button class="primary" data-start-trace-run ?disabled=${st.busy} @click=${() => void this.startTrace(st)}>${this.t("editor.start_trace_run")}</button>`;
    const fileBody = html`<label class="file">${this.t("editor.start_file_pick")}<input type="file" accept=".zip,.yaml,.yml,.json,.sh3d,.svg" data-start-file @change=${(e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = "";
        if (f) void this.startFromFile(f);
      }} /></label>
      ${problems}`;
    return html`<div class="start" role="dialog" aria-label=${this.t("editor.start_title")}>
      <h1>${this.t(st.replace ? "editor.start_title_again" : "editor.start_title")}</h1>
      <p class="muted">${this.t("editor.start_intro")}</p>
      <label class="start-name">${this.t("editor.house_name")}<input .value=${st.name} @input=${(e: Event) => this.setStart({ name: (e.target as HTMLInputElement).value })} /></label>
      ${box("ai", "mdi:creation-outline", this.t("editor.start_badge_easiest"), ai.length ? this.t("editor.start_ai_found", { ai: ai.map((a) => a.name).join(", ") }) : this.t("editor.start_ai_none"), aiBody, toggle("ai"), st.open === "ai")}
      ${box(
        "trace",
        "mdi:layers-outline",
        this.t("editor.start_badge_accurate"),
        maps.length ? this.t("editor.start_trace_maps", { maps: maps.map((m) => m.name).join(", ") }) : this.t("editor.start_trace_no_maps"),
        traceBody,
        toggle("trace"),
        st.open === "trace",
      )}
      ${box("file", "mdi:file-import-outline", "", this.t("editor.start_file_found"), fileBody, toggle("file"), st.open === "file")}
      ${box("floors", "mdi:home-floor-1", "", floors.length ? this.t("editor.start_floors_found", { floors: floors.length, areas }) : this.t("editor.no_ha_floors"), nothing, () => {
        this._start = null;
        this.startWizard();
      })}
      ${box("empty", "mdi:pencil-ruler", this.t("editor.start_badge_control"), "", nothing, () => void this.startEmpty())}
      ${st.note ? html`<p class="notice" data-start-note>${st.note}</p>` : nothing}
      ${this._model
        ? html`<div class="row end"><button data-start-cancel @click=${() => {
            this._start = null;
            this.endStart();
          }}>${this.t("editor.cancel")}</button></div>`
        : nothing}
    </div>`;
  }

  private async openHouse(id: string) {
    if (this.dirty && !confirm(this.t("editor.discard"))) return;
    const model = await this._hass!.callWS<HouseInput>({ type: "homeslice/model", house: id });
    this._house = id;
    // an older file is brought up to date at once (saved like that with the next save)
    this._model = migrateHouse(model);
    this._saved = JSON.stringify(model);
    this.history = new History();
    this._level = this.entranceLevel(model);
    this._room = null;
    this.fitted = "";
    this._draft = null;
    const draft = readDraft(id);
    if (draft && JSON.stringify(draft.model) !== this._saved && JSON.stringify(draft.model) !== JSON.stringify(this._model)) this._draft = { model: draft.model, time: draft.time, stale: draft.base !== hash(this._saved) };
  }

  /** The level to open first: the one on HA's entrance floor (level 0), else the lowest indoor one. */
  private entranceLevel(model: HouseInput): string {
    const floors = this._hass?.floors ?? {};
    return (
      model.levels.find((l) => l.floor_id && floors[l.floor_id]?.level === 0)?.id ??
      model.levels.find((l) => l.floor_id && (floors[l.floor_id]?.level ?? -1) >= 0)?.id ??
      model.levels[0]?.id ??
      ""
    );
  }

  /** HA floors, top first (as HA lists them). */
  private haFloors() {
    return Object.values(this._hass?.floors ?? {}).sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
  }

  /** HA floors already on a level (as its floor or included), except `except`'s. */
  private usedFloors(except?: string): Set<string> {
    return new Set((this._model?.levels ?? []).filter((l) => l.id !== except).flatMap((l) => [l.floor_id, ...(l.include_floors ?? [])].filter((x): x is string => !!x)));
  }

  /** The areas of a level: its HA floor's and those of the floors it includes. */
  private levelAreas(l: { floor_id?: string; include_floors?: string[] }): AreaSeed[] {
    return [l.floor_id, ...(l.include_floors ?? [])].flatMap((f) => this.floorAreas(f));
  }

  private floorAreas(floorId: string | undefined): AreaSeed[] {
    if (!floorId) return [];
    return Object.values(this._hass?.areas ?? {})
      .filter((a) => a.floor_id === floorId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ area_id: a.area_id, name: a.name }));
  }

  /** A new house (or this one over again): the start screen. */
  private startCreate() {
    if (this.dirty && !confirm(this.t("editor.discard"))) return;
    this._start = this.newStart(false);
  }

  /** "From your floors and areas": the floors to take and a rough size, placeholder rooms per area. */
  private startWizard() {
    const floors = this.haFloors();
    // an "Outside" floor joins the ground floor (HA lists floors top first)
    const merges = suggestMerges([...floors].reverse().map((f) => ({ floor_id: f.floor_id, name: f.name, level: f.level, areas: this.floorAreas(f.floor_id) })));
    this._create = { name: this._houses.length ? "" : this.t("editor.new_house_default_name"), width: 10, depth: 8, floors: floors.map((f) => f.floor_id), rooms: true, merges };
  }

  private async createHouse() {
    const c = this._create;
    if (!c) return;
    const name = c.name.trim() || this.t("editor.new_house_default_name");
    const id = uniqueId(
      this._houses.map((h) => h.id),
      slug(name, "home"),
    );
    // HA lists floors top first; the model goes bottom to top
    const merged = (f: string) => c.merges[f] && c.floors.includes(c.merges[f]) && !c.merges[c.merges[f]];
    const seeds = this.haFloors()
      .filter((f) => c.floors.includes(f.floor_id) && !merged(f.floor_id))
      .reverse()
      .map((f) => {
        const include = c.floors.filter((x) => merged(x) && c.merges[x] === f.floor_id);
        return {
          floor_id: f.floor_id,
          ...(include.length ? { include_floors: include } : {}),
          areas: c.rooms ? [f.floor_id, ...include].flatMap((x) => this.floorAreas(x)) : [],
        };
      });
    const model = newHouse(id, name, [Math.max(1, c.width), Math.max(1, c.depth)], seeds);
    try {
      await this._hass!.callWS({ type: "homeslice/model/save", house: id, model });
      this._create = null;
      this._houses = await this._hass!.callWS<HouseSummary[]>({ type: "homeslice/houses" });
      this._saved = "";
      this._model = null;
      await this.openHouse(id);
    } catch (e) {
      this._error = this.t("editor.save_failed", { message: String((e as { message?: string }).message ?? e) });
    }
  }

  private renderCreate() {
    const c = this._create!;
    const set = (patch: Partial<typeof c>) => (this._create = { ...c, ...patch });
    const floors = this.haFloors();
    return html`<div class="create" role="dialog" aria-label=${this.t("editor.new_house")}>
      <h2>${this.t("editor.new_house")}</h2>
      <label>${this.t("editor.house_name")}
        <input .value=${c.name} @input=${(e: Event) => set({ name: (e.target as HTMLInputElement).value })} />
      </label>
      <div class="row">
        <label>${this.t("editor.width_ew")}
          <input type="number" min="1" step="0.1" .value=${String(c.width)} @change=${(e: Event) => set({ width: Number((e.target as HTMLInputElement).value) || 10 })} />
        </label>
        <label>${this.t("editor.depth_ns")}
          <input type="number" min="1" step="0.1" .value=${String(c.depth)} @change=${(e: Event) => set({ depth: Number((e.target as HTMLInputElement).value) || 8 })} />
        </label>
      </div>
      <p class="muted">${this.t("editor.size_hint")}</p>
      <fieldset>
        <legend>${this.t("editor.new_house_floors")}</legend>
        ${floors.length
          ? floors.map((f) => {
              const on = c.floors.includes(f.floor_id);
              // a floor can join one that has its own level
              const hosts = floors.filter((x) => x.floor_id !== f.floor_id && c.floors.includes(x.floor_id) && !c.merges[x.floor_id]);
              const target = c.merges[f.floor_id];
              return html`<div class="floor-row">
                <label class="check"><input type="checkbox" .checked=${on} @change=${(e: Event) =>
                  set({ floors: (e.target as HTMLInputElement).checked ? [...c.floors, f.floor_id] : c.floors.filter((x) => x !== f.floor_id) })} />
                  ${f.name} <span class="muted">${this.t("editor.areas_count", { count: this.floorAreas(f.floor_id).length })}</span></label>
                ${on && hosts.length && !Object.values(c.merges).includes(f.floor_id)
                  ? html`<select aria-label=${this.t("editor.floor_level_for", { floor: f.name })} @change=${(e: Event) => {
                      const v = (e.target as HTMLSelectElement).value;
                      const merges = { ...c.merges };
                      if (v) merges[f.floor_id] = v;
                      else delete merges[f.floor_id];
                      set({ merges });
                    }}>
                      <option value="" ?selected=${!target}>${this.t("editor.own_level")}</option>
                      ${hosts.map((h) => html`<option value=${h.floor_id} ?selected=${target === h.floor_id}>${this.t("editor.join_level", { floor: h.name })}</option>`)}
                    </select>`
                  : nothing}
              </div>`;
            })
          : html`<p class="muted">${this.t("editor.no_ha_floors")}</p>`}
        ${floors.length > 1 ? html`<p class="muted">${this.t("editor.merge_hint")}</p>` : nothing}
      </fieldset>
      <label class="check"><input type="checkbox" .checked=${c.rooms} @change=${(e: Event) => set({ rooms: (e.target as HTMLInputElement).checked })} />
        ${this.t("editor.new_house_rooms")}</label>
      <div class="row end">
        <button @click=${() => {
          // back to where to start
          this._create = null;
          this._start = this.newStart(false);
        }}>${this.t("editor.cancel")}</button>
        <button class="primary" @click=${() => this.createHouse()}>${this.t("editor.create")}</button>
      </div>
    </div>`;
  }

  get dirty() {
    return !!this._model && JSON.stringify(this._model) !== this._saved;
  }

  private async save() {
    if (!this._model || !this.dirty) return;
    try {
      await this._hass!.callWS({ type: "homeslice/model/save", house: this._house, model: this._model });
      this._saved = JSON.stringify(this._model);
      this._error = "";
    } catch (e) {
      this._error = this.t("editor.save_failed", { message: String((e as { message?: string }).message ?? e) });
    }
  }

  /** Every edit goes through here: one undo step per call. */
  private commit(next: HouseInput, previous: HouseInput = this._model!) {
    // a field's change event can fire again when it loses focus: no empty undo steps
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    this.history.push(previous);
    // (a pasted or restored older file: brought up to date)
    this._model = migrateHouse(next);
  }

  private undo() {
    const prev = this._model && this.history.undo(this._model);
    if (prev) this._model = prev;
  }

  private redo() {
    const next = this._model && this.history.redo(this._model);
    if (next) this._model = next;
  }

  /**
   * The hint at the top of the plan: what to do right now (placing, calibrating), else how
   * the current tool works; tool hints can be dismissed (remembered per tool).
   */
  private renderHint() {
    const action = this._toolMiss
      ? this._toolMiss
      : this._calib
      ? this.t(!this._calib.a ? "editor.calib_first" : !this._calib.b ? "editor.calib_second" : "editor.calib_distance")
      : this._underlayMove
        ? this.t("editor.underlay_move_hint")
        : this._energyPlace
          ? this.t("editor.energy_click", { name: this.energyName(this._energyPlace) })
          : this._robotPlace
            ? this.t("editor.robot_click", { name: this.entityName(this._robotPlace) })
            : this._robotCalib
              ? this.t("editor.robot_calib_click")
              : this._pendingArea && this._tool === "rect"
                ? this.t("editor.drawing_for", { area: this._hass?.areas?.[this._pendingArea]?.name ?? this._pendingArea })
                : "";
    const m = this._model;
    const top = !!m && m.levels.findIndex((l) => l.id === this._level) >= m.levels.length - 1;
    // stairs lead up: on the top floor there is nowhere to go
    const text = this._tool === "stairs" && top ? this.t("editor.stairs_top") : this.t(`editor.help_${this._tool}` as StringKey);
    if (!action && this._hintsHidden.includes(this._tool) && !(this._tool === "stairs" && top)) return nothing;
    const name = this.t(`editor.tool_${this._tool}` as StringKey).replace(/\s*\([^)]*\)$/, "");
    return html`<div class="hint-bar ${action ? "action" : ""}" role="status">
      ${action ? html`<b>${action}</b>` : html`<b>${name}:</b> ${text}`}
      ${action
        ? nothing
        : html`<button class="close" aria-label=${this.t("editor.hint_hide")} title=${this.t("editor.hint_hide")} @click=${() => {
            this._hintsHidden = [...this._hintsHidden, this._tool];
            writePref("homeslice-hints-hidden", JSON.stringify(this._hintsHidden));
          }}>×</button>`}
    </div>`;
  }

  /** Nothing selected. */
  private clearSelection() {
    this._wallView = null;
    this._vertexSel = null;
    this._room = null;
    this._wall = null;
    this._opening = null;
    this._stair = null;
    this._freeWall = null;
    this._furn = null;
    this._energySel = null;
    this._robotSel = null;
    this._sectionSel = null;
  }

  private toggleLayer(layer: Layer, on = !this._show[layer]) {
    this._show = { ...this._show, [layer]: on };
    writePref("homeslice-layers", JSON.stringify(this._show));
  }

  /** The sub-tool a group's toolbar button stands for: the one in use, else the last one used. */
  private groupTool(group: string): Tool {
    const members = TOOLS.filter((t) => t.group === group);
    const current = members.find((t) => t.tool === this._tool) ?? members.find((t) => t.tool === this._lastInGroup[group]) ?? members[0];
    return current.tool;
  }

  /** While a sub-tool is in use: its siblings, named, over the plan. */
  private renderSubTools() {
    // furniture: where the library's pieces come from
    if (this._tool === "furniture")
      return html`<div class="sub-tools" role="tablist" aria-label=${this.t("editor.tool_furniture")}>
        ${LIBRARY_SOURCES.map(
          (src) => html`<button role="tab" class=${src === this._librarySource ? "active" : ""} aria-selected=${src === this._librarySource} data-source=${src}
            @click=${() => {
              this._librarySource = src;
              this._libraryError = "";
              writePref("homeslice-library", src);
            }}><ha-icon icon=${LIBRARY_ICONS[src]}></ha-icon><span>${this.t(`editor.library_${src}` as StringKey)}</span></button>`,
        )}
      </div>`;
    const group = TOOLS.find((t) => t.tool === this._tool)?.group;
    if (!group) return nothing;
    return html`<div class="sub-tools" role="toolbar" aria-label=${this.t(`editor.group_${group}` as StringKey)}>
      ${TOOLS.filter((t) => t.group === group).map(
        ({ tool, icon, key }) => html`<button class=${this._tool === tool ? "active" : ""} data-sub-tool=${tool} aria-pressed=${this._tool === tool}
          title=${this.t(`editor.tool_${tool}` as StringKey)} @click=${() => this.setTool(tool)}>
          <ha-icon icon=${icon}></ha-icon><span>${this.t(`editor.sub_${tool}` as StringKey)}</span><kbd>${key}</kbd>
        </button>`,
      )}
    </div>`;
  }

  /**
   * Where an area dropped at p would go: the room there, else the smallest shape that walls
   * close off around p (free-standing walls, the outline, room edges) that no room fills yet.
   */
  private assignTarget(p: Vec2): { poly: Vec2[]; room?: string; host?: { room: string; keep?: Vec2[] } } | null {
    const m = this._model!;
    const rooms = (this.levelInput?.rooms ?? []).filter((r) => r.kind !== "void");
    // a part walls cut off a room, else the room, else a shape walls close outside any room
    const shapes = this.freeShapes();
    const hosted = faceAt(shapes.filter((x) => x.host).map((x) => x.poly), p);
    if (hosted) {
      const x = shapes.find((y) => y.poly === hosted)!;
      return { poly: x.poly, host: x.host };
    }
    const room = roomAt(m, rooms, p);
    if (room) return { poly: roomPolygon(m, room), room: room.id };
    const face = faceAt(shapes.filter((x) => !x.host).map((x) => x.poly), p);
    if (face) return { poly: face };
    return null;
  }

  private freeShapesMemo: { model: HouseInput; level: string; faces: FreeShape[] } | null = null;

  /**
   * Shapes closed off by walls (free-standing ones, with the outline and room edges) that no
   * room fills: rooms in all but name, waiting for an area.
   */
  private freeShapes(): FreeShape[] {
    const m = this._model!;
    if (this.freeShapesMemo?.model === m && this.freeShapesMemo.level === this._level) return this.freeShapesMemo.faces;
    // voids (stairwells, shafts) take their space too
    const rooms = this.levelInput?.rooms ?? [];
    const lines = (this.levelInput?.walls ?? []).filter((w) => w.line && (w.type ?? "wall") === "wall" && w.line.every((q) => typeof q[0] === "number" && typeof q[1] === "number"));
    let faces: FreeShape[] = [];
    // only free-standing walls close new shapes: without them, nothing to look for
    if (lines.length) {
      const segments: [Vec2, Vec2][] = lines.map((w) => w.line as [Vec2, Vec2]);
      const ring = (poly: Vec2[]) => poly.forEach((a, i) => segments.push([a, poly[(i + 1) % poly.length]]));
      ring(outlineScope(m, this._level).poly);
      for (const r of rooms) ring(roomPolygon(m, r));
      const drawn = segments.slice(0, lines.length);
      // a shape some drawn wall helps close (space left between rooms on purpose isn't one)
      const byWall = (f: Vec2[]) =>
        f.some((p, i) => {
          const q = f[(i + 1) % f.length];
          const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          return drawn.some(([a, b]) => {
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const t = len ? ((mid[0] - a[0]) * (b[0] - a[0]) + (mid[1] - a[1]) * (b[1] - a[1])) / len : 0;
            const d = len ? Math.abs((mid[0] - a[0]) * (b[1] - a[1]) - (mid[1] - a[1]) * (b[0] - a[0])) / len : Infinity;
            return d < 0.03 && t > -0.06 && t < len + 0.06;
          });
        });
      const all = closedFaces(segments);
      const hostOf = (f: Vec2[]) => roomAt(m, rooms, labelPoint(f));
      // outside every room: a room in all but name
      faces = all.filter((f) => !hostOf(f) && byWall(f)).map((poly) => ({ poly }));
      // a room the walls cut up: the parts away from its name are rooms in all but name, the
      // room keeping the part with its name
      for (const r of rooms) {
        if (r.kind === "void") continue;
        const poly = roomPolygon(m, r);
        const size = Math.abs(signedArea(poly));
        // the room's own face (whole, when the walls stand free inside it) is no new shape
        const inside = all.filter((f) => hostOf(f) === r && Math.abs(Math.abs(signedArea(f)) - size) > 0.01);
        // wholly inside, its edges clear of the room's: a room of its own, a hole in this one
        const clear = (f: Vec2[]) => f.every((p) => edgeDistance(p, poly) > 0.01);
        for (const f of inside) if (clear(f) && byWall(f) && !rooms.some((x) => x !== r && within(roomPolygon(m, x), poly) && Math.abs(Math.abs(signedArea(roomPolygon(m, x))) - Math.abs(signedArea(f))) < 0.01)) faces.push({ poly: f, host: { room: r.id } });
        // cut into parts reaching its edges: the part with its name stays the room
        const parts = inside.filter((f) => !clear(f));
        if (parts.length < 2) continue;
        const centre = labelPoint(poly);
        const keep = parts.find((f) => pointInPolygon(centre, f)) ?? parts.reduce((a, b) => (Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b));
        for (const f of parts) if (f !== keep && byWall(f)) faces.push({ poly: f, host: { room: r.id, keep } });
      }
    }
    this.freeShapesMemo = { model: m, level: this._level, faces };
    return faces;
  }

  /** A shape or room without an area: says so, with a button that opens the assign tool. */
  private renderUnassignedBadge(at: Vec2, key: string) {
    const label = this.t("editor.unassigned_room");
    const w = label.length * 6.6 + 34;
    return svg`<g class="unassigned" data-unassigned=${key}>
      <rect class="pill" x=${at[0] - w / 2} y=${at[1] - 11} width=${w} height="22" rx="11"></rect>
      <text x=${at[0] - w / 2 + 10} y=${at[1] + 4}>${label}</text>
      <g class="open-assign" data-assign-open=${key} role="button" aria-label=${this.t("editor.unassigned_open")}>
        <title>${this.t("editor.unassigned_open")}</title>
        <circle cx=${at[0] + w / 2 - 12} cy=${at[1]} r="9"></circle>
        <path d=${`M ${at[0] + w / 2 - 16} ${at[1] - 3} h 5 l 3 3 l -3 3 h -5 z`}></path>
      </g>
    </g>`;
  }

  /** Every shape the drawn walls close off becomes a room without an area (it then says so). */
  private completeRooms(line: [Vec2, Vec2]) {
    const walled = this._model!;
    let m = walled;
    let made = 0;
    // shapes this wall closes (others were left as they are on purpose)
    const along = (f: Vec2[]) =>
      f.some((p, i) => {
        const q = f[(i + 1) % f.length];
        const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const { distance, t, length } = project(mid, line[0], line[1]);
        return distance < 0.03 && t > -0.06 && t < length + 0.06;
      });
    // one at a time: a carve changes the shapes left
    for (let guard = 0; guard < 20; guard++) {
      const shape = this.freeShapes().find((x) => along(x.poly));
      if (!shape) break;
      m = assignArea(m, this._level, undefined, { polygon: shape.poly, host: shape.host }).model;
      this._model = m;
      made++;
    }
    if (made) {
      this.commit(m, walled);
      this._freeWall = null;
    } else this._model = walled;
  }

  /** Puts an area where it was dropped (or tapped): onto the room there, or a new room in the closed shape. */
  private assignAt(area: string, p: Vec2) {
    const target = this.assignTarget(p);
    this._assignHover = null;
    if (!target) {
      this._toolMiss = this.t("editor.assign_missed");
      return;
    }
    const { model, room } = assignArea(this._model!, this._level, area, target.room ? { room: target.room } : { polygon: target.poly, host: target.host });
    this.commit(model);
    this._assignArea = null;
    this._room = null;
    // the shape just given an area flashes in the list as placed
    this._assignedLast = room;
  }

  private renderAssignHover() {
    const h = this._assignHover;
    if (!h) return nothing;
    const pts = h.poly.map((p) => this.toScreen(p).join(",")).join(" ");
    const [x, y] = this.toScreen(labelPoint(h.poly));
    const r = h.room ? this.levelInput?.rooms.find((x) => x.id === h.room) : undefined;
    const name = this._hass?.areas?.[h.area]?.name ?? h.area;
    const what = !r ? this.t("editor.assign_new_room") : r.area_id && r.area_id !== h.area ? this.t("editor.assign_replaces", { area: this.roomName(r) }) : "";
    return svg`<g class="assign-hover" data-assign-hover=${h.room ?? "new"}>
      <polygon points=${pts}></polygon>
      <text x=${x} y=${y} text-anchor="middle"><tspan x=${x} dy="0">${name}</tspan>${what ? svg`<tspan x=${x} dy="18" class="what">${what}</tspan>` : nothing}</text>
    </g>`;
  }

  /**
   * A room walled off inside or beside another (an alcove behind an opening, a walk-in
   * wardrobe) may be the same room to Home Assistant: one click gives it that room's area.
   */
  private renderSameRoom(r: RoomInput) {
    const m = this._model!;
    const host = hostRoom(m, this._level, r.id);
    const touching = this.levelWalls()
      .filter((w) => w.rooms.includes(r.id) && w.rooms.length > 1)
      .flatMap((w) => w.rooms.filter((x) => x !== r.id));
    const ids = [...new Set([...(host ? [host.id] : []), ...touching])];
    const others = ids
      .map((id) => this.levelInput?.rooms.find((x) => x.id === id))
      .filter((x): x is RoomInput => !!x && !!x.area_id && x.area_id !== r.area_id && x.kind !== "void")
      .slice(0, 4);
    if (!others.length) return nothing;
    return html`<div class="same-room" data-same-room>
      <span class="muted">${this.t(host && others[0].id === host.id ? "editor.same_room_inside" : "editor.same_room")}</span>
      ${others.map(
        (o) => html`<button data-same-as=${o.id} @click=${() => this.commit(updateRoom(m, this._level, r.id, { area_id: o.area_id }))}>${this.t("editor.same_room_as", { room: this.roomName(o) })}</button>`,
      )}
    </div>`;
  }

  /** The assign tool's panel: Home Assistant's areas to drag onto rooms and closed shapes. */
  private renderAssignPanel() {
    const m = this._model!;
    const areas = Object.values(this._hass?.areas ?? {});
    const placed = new Map<string, { room: RoomInput; level: string }>();
    for (const l of m.levels) for (const r of l.rooms) if (r.area_id && !placed.has(r.area_id)) placed.set(r.area_id, { room: r, level: l.id });
    const floor = m.levels.find((l) => l.id === this._level)?.floor_id;
    const levelName = (id: string) => {
      const l = m.levels.find((x) => x.id === id);
      return l ? this.levelName(l) : id;
    };
    // this floor's areas first, then those on no floor, then the other floors'; in each, the ones still to place first
    const groups: { key: string; title: string; items: typeof areas }[] = [
      { key: "here", title: this.t("editor.assign_group_here"), items: floor ? areas.filter((a) => a.floor_id === floor) : [] },
      { key: "none", title: this.t("editor.assign_group_none"), items: areas.filter((a) => !a.floor_id) },
      { key: "other", title: this.t("editor.assign_group_other"), items: areas.filter((a) => a.floor_id && a.floor_id !== floor) },
    ];
    const sort = (list: typeof areas) => [...list].sort((a, b) => Number(placed.has(a.area_id)) - Number(placed.has(b.area_id)) || a.name.localeCompare(b.name));
    const floorName = (id?: string | null) => (id && this._hass?.floors?.[id]?.name) || "";
    const chip = (a: (typeof areas)[number], showFloor: boolean) => {
      const at = placed.get(a.area_id);
      const where = at ? (at.level === this._level ? this.t("editor.assign_here_in", { room: this.roomName(at.room) }) : levelName(at.level)) : showFloor && floorName(a.floor_id) ? floorName(a.floor_id) : this.t("editor.assign_unplaced");
      return html`<button class="area-chip ${this._assignArea === a.area_id ? "active" : ""} ${at ? "placed" : ""} ${this._assignedLast && at?.room.id === this._assignedLast && at.level === this._level ? "just" : ""}"
        draggable="true" data-area=${a.area_id} aria-pressed=${this._assignArea === a.area_id}
        title=${at ? this.t("editor.assign_placed_title") : ""}
        @dragstart=${(e: DragEvent) => {
          this.assignDrag = a.area_id;
          e.dataTransfer?.setData("text/plain", a.area_id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "link";
        }}
        @dragend=${() => {
          this.assignDrag = null;
          this._assignHover = null;
        }}
        @click=${() => (this._assignArea = this._assignArea === a.area_id ? null : a.area_id)}>
        <ha-icon icon=${a.icon || "mdi:texture-box"}></ha-icon><span class="name">${a.name}</span><span class="where">${where}</span>
      </button>`;
    };
    return html`<h2>${this.t("editor.tool_assign").replace(/\s*\([^)]*\)$/, "")}</h2>
      <p class="muted">${this.t("editor.assign_hint")}</p>
      ${floor
        ? nothing
        : html`<p class="warning" data-assign-unlinked>
            ${this.t("editor.assign_unlinked", { level: levelName(this._level) })}
            <button class="link" @click=${() => {
              // the level's own panel: where it is linked
              this.setTool("select");
              this.clearSelection();
            }}>${this.t("editor.assign_link_floor")}</button>
          </p>`}
      ${groups.map((g) =>
        g.items.length
          ? html`<h4 data-assign-group=${g.key}>${g.title}</h4>
              <div class="assign-areas">${sort(g.items).map((a) => chip(a, g.key === "other"))}</div>`
          : nothing,
      )}
      ${areas.length ? nothing : html`<p class="muted">${this.t("editor.assign_no_areas")}</p>`}`;
  }

  /** Opens a toolbar button's choices beside it (below it when the toolbar is a row, on phones). */
  private openFlyout(key: string, button: HTMLElement) {
    const main = this.renderRoot.querySelector("main") as HTMLElement;
    const r = button.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    const row = getComputedStyle(button.parentElement!).flexDirection === "row";
    this._flyout = key;
    this._flyoutAt = row ? { x: Math.max(0, Math.min(r.left - m.left, m.width - 320)), y: r.bottom - m.top + 6 } : { x: r.right - m.left + 6, y: r.top - m.top };
  }

  private renderFlyout() {
    if (!this._flyout || !this._flyoutAt) return nothing;
    const content = this.renderSubTools();
    if (content === nothing) return nothing;
    return html`<div class="flyout" style="left:${this._flyoutAt.x}px;top:${this._flyoutAt.y}px"
      @click=${(e: Event) => {
        // a choice made: the flyout goes
        if ((e.target as Element).closest("button")) this._flyout = null;
      }}>${content}</div>`;
  }

  private setTool(tool: Tool) {
    this._flyout = null;
    this._assignArea = null;
    this._assignHover = null;
    const group = TOOLS.find((t) => t.tool === tool)?.group;
    if (group) this._lastInGroup = { ...this._lastInGroup, [group]: tool };
    // adding furniture or devices shows them
    if (tool === "furniture" && !this._show.furniture) this.toggleLayer("furniture", true);
    if ((tool === "devices" || tool === "robots") && !this._show.devices) this.toggleLayer("devices", true);
    this._tool = tool;
    this._pendingArea = tool === "rect" ? this._pendingArea : null;
  }

  private handleKey(e: KeyboardEvent) {
    const target = e.composedPath()[0] as HTMLElement | undefined;
    // fields keep their keys; checkboxes and buttons don't need them (Ctrl+Z still undoes)
    const typing = target && (["SELECT", "TEXTAREA"].includes(target.tagName) || (target.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((target as HTMLInputElement).type)));
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this._palette = this._palette ? null : { q: "", i: 0 };
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void this.save();
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._opening && this._model) {
      this.commit(deleteOpening(this._model, this._level, this._opening.src));
      this._opening = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._furn && this._model) {
      this.commit(deleteFurniture(this._model, this._level, this._furn.room, this._furn.index));
      this._furn = null;
    } else if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") && this._furn && this._model && !String(window.getSelection() ?? "")) {
      e.preventDefault();
      this.copyFurniture(e.key.toLowerCase() === "x");
    } else if (mod && e.key.toLowerCase() === "v" && this._clip && this._model) {
      e.preventDefault();
      this.pasteFurniture();
    } else if (mod && e.key.toLowerCase() === "d" && this._furn && this._model) {
      e.preventDefault();
      this.duplicateFurniture();
    } else if (e.key === "r" && !mod && this._furn && this._model) {
      this.rotateFurniture(e.shiftKey ? -90 : 90);
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._robotSel !== null && this._model) {
      this.commit(deleteRobot(this._model, this._robotSel));
      this._robotSel = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._energySel !== null && this._model) {
      this.commit(deleteEnergy(this._model, this._energySel));
      this._energySel = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._vertexSel && this._model) {
      // a corner: its two neighbours joined directly
      this.commit(removeVertex(this._model, this._level, this._vertexSel));
      this._vertexSel = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._freeWall !== null && this._model) {
      this.commit(deleteFreeWall(this._model, this._level, this._freeWall));
      this._freeWall = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._stair && this._model) {
      this.commit(deleteStairs(this._model, this._stair));
      this._stair = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._room && this._room !== OUTLINE && this._model) {
      this.commit(deleteRoom(this._model, this._level, this._room));
      this._room = null;
    } else if (e.key === "Escape" && this._flyout) {
      this._flyout = null;
    } else if (e.key === "Escape") {
      // first Escape: let go of the selection and anything half done; the next: back to Select
      const busy =
        !!(this._room || this._wall || this._opening || this._stair || this._furn || this._energyPlace || this._robotPlace || this._robotCalib || this._settings || this._checklist) ||
        this._freeWall !== null || this._energySel !== null || this._robotSel !== null || this._sectionSel !== null || !!this._measure || !!this._dimEdit || !!this._calib || !!this._straighten || this._underlayMove;
      // drawing walls or railings: one Escape is enough (the last one drawn stays selected meanwhile)
      if (!busy || this._tool === "wall" || this._tool === "railing" || this._tool === "divide" || this._tool === "assign") this._tool = "select";
      this.clearSelection();
      this._checklist = false;
      this._pendingArea = null;
      this._calib = null;
      this._straighten = null;
      this._underlayMove = false;
      this._energyPlace = null;
      this._furn = null;
      this._energySel = null;
      this._robotSel = null;
      this._robotPlace = null;
      this._robotCalib = null;
      this._settings = null;
      this._shortcuts = false;
      this._drag = null;
      this._rectPreview = null;
      this._measure = null;
      this._linePreview = null;
      this._freeWall = null;
      this._dimEdit = null;
    } else if (e.key.startsWith("Arrow") && this._model && (this._stair || this._energySel !== null)) {
      // nudge the selected stairs or energy item: 5 cm, Shift 50 cm
      e.preventDefault();
      const step = e.shiftKey ? 0.5 : 0.05;
      const d: Vec2 = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] as Vec2 ?? [0, 0];
      if (this._stair) {
        const v = this._model.vertical?.find((x) => x.id === this._stair);
        if (v) {
          const [x, y, w, h] = stairsRect(this._model, v);
          this.commit(setStairsRect(this._model, v.id, [x + d[0], y + d[1], w, h]));
        }
      } else if (this._energySel !== null) {
        const en = this._model.energy?.[this._energySel];
        if (en?.at) this.commit(updateEnergy(this._model, this._energySel, { at: [en.at[0] + d[0], en.at[1] + d[1]] }));
      }
    } else if (e.key === "?") {
      this._shortcuts = !this._shortcuts;
    } else if (e.key.toLowerCase() === "n" && !mod && !e.altKey && this._underlaySlots.length > 1) {
      this.cycleUnderlay();
    } else if (!mod && !e.altKey) {
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) this.setTool(t.tool);
    }
  }

  // ----- geometry helpers -----

  private get levelInput() {
    return this._model?.levels.find((l) => l.id === this._level);
  }

  private toScreen = ([x, y]: Vec2): Vec2 => [x * this._view.scale + this._view.ox, y * this._view.scale + this._view.oy];
  private toWorld = ([x, y]: Vec2): Vec2 => [(x - this._view.ox) / this._view.scale, (y - this._view.oy) / this._view.scale];

  private eventWorld(e: PointerEvent | WheelEvent): Vec2 {
    const svgEl = this.renderRoot.querySelector("svg.plan") as SVGSVGElement;
    const r = svgEl.getBoundingClientRect();
    return this.toWorld([e.clientX - r.left, e.clientY - r.top]);
  }

  private eventScreen(e: PointerEvent): Vec2 {
    const r = (this.renderRoot.querySelector("svg.plan") as SVGSVGElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** "0.50 m east": how far a wall moved, with the compass direction (x east, y south). */
  private moveReadout(delta: Vec2): string {
    const d = Math.hypot(delta[0], delta[1]);
    if (d < 0.005) return "0.00 m";
    const side = Math.abs(delta[0]) >= Math.abs(delta[1]) ? (delta[0] > 0 ? "east" : "west") : delta[1] > 0 ? "south" : "north";
    return `${this.n(d)} m ${this.t(`editor.towards_${side}` as StringKey)}`;
  }

  /** Faces (and centres) of the walls parallel to `line`, as offsets along `normal`. */
  private parallelFaces(line: [Vec2, Vec2], normal: Vec2): number[] {
    const out: number[] = [];
    for (const w of this.levelWalls()) {
      if (Math.abs(w.normal[0] * normal[1] - w.normal[1] * normal[0]) > 0.01) continue;
      const same = [line[0], line[1]].every((p) => [w.line[0], w.line[1]].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01));
      if (same) continue;
      const c = w.a[0] * normal[0] + w.a[1] * normal[1];
      out.push(c - w.thickness / 2, c, c + w.thickness / 2);
    }
    // the other floors' outside walls, to line this one up with
    for (const l of this._model?.levels ?? []) {
      if (l.id === this._level) continue;
      const poly = outlineScope(this._model!, l.id).poly;
      poly.forEach((p, i) => {
        const q = poly[(i + 1) % poly.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        if (Math.abs(((q[0] - p[0]) / len) * normal[0] + ((q[1] - p[1]) / len) * normal[1]) > 0.01) return;
        out.push(p[0] * normal[0] + p[1] * normal[1]);
      });
    }
    return out;
  }

  /** The corners joined to `p` by a wall of this level's rooms. */
  private neighbourCorners(p: Vec2): Vec2[] {
    const m = this._model!;
    const near = (q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.01;
    const out: Vec2[] = [];
    for (const r of this.levelInput?.rooms ?? []) {
      const poly = roomPolygon(m, r);
      poly.forEach((q, i) => {
        if (near(q)) for (const n of [poly[(i - 1 + poly.length) % poly.length], poly[(i + 1) % poly.length]]) if (!near(n) && !out.some((o) => o[0] === n[0] && o[1] === n[1])) out.push(n);
      });
    }
    return out;
  }

  /** Corners to snap to: this level's rooms (minus `except`) and the level below. */
  private snapContext(except?: Vec2): SnapContext {
    const m = this._model!;
    const idx = m.levels.findIndex((l) => l.id === this._level);
    const levels = [m.levels[idx], m.levels[idx - 1]].filter(Boolean);
    const points: Vec2[] = [];
    for (const l of levels) for (const r of l.rooms) for (const p of roomPolygon(m, r)) if (!except || Math.hypot(p[0] - except[0], p[1] - except[1]) > 0.01) points.push(p);
    // the ends of free-standing walls and railings: a new one starts where another ends
    for (const w of m.levels[idx]?.walls ?? [])
      for (const p of w.line ?? []) if (typeof p[0] === "number" && typeof p[1] === "number" && (!except || Math.hypot(p[0] - except[0], p[1] - except[1]) > 0.01)) points.push([p[0], p[1]]);
    // the walls of this level: room edges, the outline, free-standing walls (not those at the corner dragged)
    const segments: [Vec2, Vec2][] = [];
    const away = (a: Vec2, b: Vec2) => !except || (Math.hypot(a[0] - except[0], a[1] - except[1]) > 0.01 && Math.hypot(b[0] - except[0], b[1] - except[1]) > 0.01);
    const ring = (poly: Vec2[]) => poly.forEach((a, i) => away(a, poly[(i + 1) % poly.length]) && segments.push([a, poly[(i + 1) % poly.length]]));
    for (const r of m.levels[idx]?.rooms ?? []) ring(roomPolygon(m, r));
    ring(outlineScope(m, this._level).poly);
    for (const w of m.levels[idx]?.walls ?? [])
      if (w.line && w.line.every((q) => typeof q[0] === "number" && typeof q[1] === "number") && away(w.line[0] as Vec2, w.line[1] as Vec2)) segments.push([w.line[0] as Vec2, w.line[1] as Vec2]);
    return {
      grid: 0.05,
      points,
      align: { x: points.map((p) => p[0]), y: points.map((p) => p[1]) },
      tolerance: 10 / this._view.scale,
      segments,
    };
  }

  private fitView() {
    const m = this._model;
    const l = this.levelInput;
    const svgEl = this.renderRoot.querySelector("svg.plan") as SVGSVGElement | null;
    if (!m || !l || !svgEl) return;
    // fit the building; gardens and terraces may run off the edge
    const indoor = l.rooms.filter((r) => (r.kind ?? "room") === "room");
    const pts = (indoor.length ? indoor : l.rooms).flatMap((r) => roomPolygon(m, r));
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const { width, height } = svgEl.getBoundingClientRect();
    if (!width || !height) return;
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const scale = Math.min((width - 80) / (w || 1), (height - 80) / (h || 1));
    this._view = {
      scale,
      ox: (width - w * scale) / 2 - Math.min(...xs) * scale,
      oy: (height - h * scale) / 2 - Math.min(...ys) * scale,
    };
  }

  // ----- pointer handling on the plan -----

  /** Things that can be selected on the plan, topmost first: their attribute. */
  private static readonly PICKABLE = ["data-robot", "data-energy", "data-camera", "data-light", "data-opening", "data-furniture", "data-freewall", "data-stair", "data-wall", "data-room", "data-outline"];
  private lastPress: { x: number; y: number } | null = null;

  /**
   * What a press means: the topmost thing there, or, pressed again on the same spot while that
   * is selected, the next one under it (stairs under stairs, a door under a lamp…), round again.
   */
  private underneath(e: PointerEvent): Element {
    const top = e.target as Element;
    const again = this.lastPress && Math.hypot(e.clientX - this.lastPress.x, e.clientY - this.lastPress.y) < 6;
    this.lastPress = { x: e.clientX, y: e.clientY };
    // handles of what is selected are pressed as they are (to drag them); a selected edge
    // with something else under it (a door in the wall) takes its turn in the round
    if (!again || top.closest("[data-handle]:not(.edge-hit), [data-freeend], [data-stairhandle], [data-dimedit], [data-assign-open]")) return top;
    const stack: { el: Element; key: string }[] = [];
    for (const el of (this.renderRoot as ShadowRoot).elementsFromPoint(e.clientX, e.clientY)) {
      for (const attr of HomeslicePanel.PICKABLE) {
        const hit = el.closest(`[${attr}]`);
        if (!hit) continue;
        const key = `${attr}=${hit.getAttribute(attr)}`;
        if (!stack.some((x) => x.key === key)) stack.push({ el: hit, key });
        break;
      }
    }
    const i = stack.findIndex((x) => x.key === this.selectedKey());
    return i >= 0 && stack.length > 1 ? stack[(i + 1) % stack.length].el : top;
  }

  /** The selection, as the attribute of what shows it on the plan. */
  private selectedKey(): string {
    if (this._furn) return `data-furniture=${JSON.stringify(this._furn)}`;
    if (this._stair) return `data-stair=${this._stair}`;
    if (this._freeWall !== null) return `data-freewall=${this._freeWall}`;
    if (this._opening) return `data-opening=${JSON.stringify(this._opening)}`;
    if (this._wall) return `data-wall=${JSON.stringify(this._wall)}`;
    if (this._room === OUTLINE) return "data-outline=1";
    if (this._room) return `data-room=${this._room}`;
    if (this._robotSel !== null) return `data-robot=${this._robotSel}`;
    if (this._energySel !== null) return `data-energy=${this._energySel}`;
    return "";
  }

  private onPlanDown(e: PointerEvent) {
    if (!this._model) return;
    // typing a length: the field handles its own clicks
    if ((e.target as Element).closest("foreignObject")) return;
    this._settings = null;
    // pressed again where the selection is: what lies under it instead
    const target = this._tool === "select" ? this.underneath(e) : (e.target as Element);
    // (a pointer the browser no longer tracks cannot be captured)
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* keep going without capture */
    }
    const world = this.eventWorld(e);
    this._toolMiss = "";
    this._flyout = null;
    // a corner stays selected only while it is what was pressed
    this._vertexSel = null;
    const u = this._underlay?.level === this._level ? this._underlay : null;
    if (u && this._straighten) {
      if (!this._straighten.a) this._straighten = { a: world };
      else this.straightenUnderlay(this._straighten.a, world);
      return;
    }
    if (u && this._calib && !(this._calib.a && this._calib.b)) {
      const p = this.planToUnderlay(u, world);
      this._calib = this._calib.a ? { ...this._calib, b: p } : { a: p };
      return;
    }
    if (u && this._underlayMove) {
      this._drag = { kind: "underlay", start: world, origin: u.place.origin };
      return;
    }
    if (this._floorMove) {
      this._drag = { kind: "floor-move", start: world, origin: clone(this._model), place: u ? { ...u.place } : null };
      return;
    }
    // a length that can be typed
    const dimHit = target.closest("[data-dimedit]") as SVGElement | null;
    const dim = dimHit ? this.dimTargets.get(dimHit.dataset.dimedit!) : undefined;
    if (dimHit && dim) {
      // no mousedown: its focus change would close the field right away
      e.preventDefault();
      const screen = this.eventScreen(e);
      this._dimEdit = { x: screen[0], y: screen[1], target: dim };
      return;
    }
    this._dimEdit = null;
    // the button of an unassigned room or shape: the assign tool
    if (target.closest("[data-assign-open]") && this._tool !== "assign") {
      this.setTool("assign");
      this.clearSelection();
      return;
    }
    // assigning by tapping: the picked area goes to the shape tapped
    if (this._tool === "assign" && this._assignArea) {
      this.assignAt(this._assignArea, world);
      return;
    }
    // drawing walls: a press anywhere starts the next one (on another's end, a door or a lamp too)
    if (this._tool === "wall" || this._tool === "railing" || this._tool === "divide") {
      const ctx = this.snapContext();
      const p = snap(world, ctx).p;
      this._linePreview = [p, p];
      this._drag = { kind: "freewall", ctx };
      return;
    }
    // a selected section's end: dragged
    const sectionEnd = target.closest("[data-section-end]") as SVGElement | null;
    if (sectionEnd && this._sectionSel !== null && this._model.sections?.[this._sectionSel]) {
      const endNo = Number(sectionEnd.dataset.sectionEnd) as 0 | 1;
      const line = this._model.sections[this._sectionSel].line;
      this._drag = { kind: "section-end", origin: clone(this._model), index: this._sectionSel, end: endNo, ctx: this.snapContext(line[endNo] as Vec2) };
      return;
    }
    // drawing a room, balcony or stairs: a press anywhere starts it (on a door or a lamp too)
    if (this._tool === "rect" || this._tool === "balcony" || this._tool === "stairs") {
      const ctx = this.snapContext();
      this._drag = { kind: "rect", start: snap(world, ctx).p, ctx };
      return;
    }
    if (this._tool === "measure") {
      const ctx = this.snapContext();
      const p = snap(world, ctx).p;
      this._measure = { a: p, b: p };
      this._drag = { kind: "measure", ctx };
      return;
    }
    if (this._tool === "section") {
      const ctx = this.snapContext();
      const p = snap(world, ctx).p;
      this._sectionDraft = { a: p, b: p };
      this._drag = { kind: "section", ctx };
      return;
    }
    // one click places something waiting for its spot
    if (this._robotCalib) {
      // where the robot is now: one calibration point
      this.commit(addRobotPoint(this._model, this._robotCalib.index, this._robotCalib.reading, world));
      this._robotCalib = null;
      return;
    }
    if (this._robotPlace) {
      const { model, index } = addRobot(this._model, { entity: this._robotPlace, level: this._level, dock: world });
      this.commit(model);
      this._robotPlace = null;
      this.clearSelection();
      this._robotSel = index;
      return;
    }
    if (this._energyPlace) {
      const at = snap(world, { ...this.snapContext(), points: [], align: { x: [], y: [] } }).p;
      const { model, index } = addEnergy(this._model, { ...this._energyPlace, level: this._level, at });
      this.commit(model);
      this._energyPlace = null;
      this.clearSelection();
      this._energySel = index;
      return;
    }
    // things on the plan, top first: robots, energy items (and their connector), lights,
    // doors and windows, furniture; then handles, walls and rooms
    const hitRobot = target.closest("[data-robot]") as SVGElement | null;
    const robot = hitRobot ? this._model.robots?.[Number(hitRobot.dataset.robot)] : undefined;
    if (hitRobot && robot) {
      const index = Number(hitRobot.dataset.robot);
      this.clearSelection();
      this._robotSel = index;
      this._drag = { kind: "robot", origin: clone(this._model), index, startWorld: world, dock: robot.dock, moved: false };
      return;
    }
    const linkHandle = target.closest("[data-energylink]") as SVGElement | null;
    if (linkHandle) {
      this._drag = { kind: "energy-link", from: Number(linkHandle.dataset.energylink) };
      this._linkEnd = world;
      return;
    }
    const hitEnergy = target.closest("[data-energy]") as SVGElement | null;
    const energy = hitEnergy ? this._model.energy?.[Number(hitEnergy.dataset.energy)] : undefined;
    if (hitEnergy && energy?.at) {
      const index = Number(hitEnergy.dataset.energy);
      this.clearSelection();
      this._energySel = index;
      this._drag = { kind: "energy", origin: clone(this._model), index, startWorld: world, at: energy.at, moved: false };
      return;
    }
    const hitCamera = target.closest("[data-camera]") as SVGElement | null;
    if (hitCamera) {
      const { room, index } = JSON.parse(hitCamera.dataset.camera!) as { room: string; index: number };
      this.clearSelection();
      this._room = room;
      this._drag = { kind: "camera", origin: clone(this._model), room, index, startWorld: world, moved: false };
      return;
    }
    const hitLight = target.closest("[data-light]") as SVGElement | null;
    if (hitLight) {
      const { entity, room, part } = JSON.parse(hitLight.dataset.light!) as { entity: string; room: string; part?: number | "to" };
      const lamps = this.levelLamps();
      const ctx = this.snapContext();
      // line up with the other lamps and the rooms' centres
      const extra = [...lamps.filter((x) => x.entity !== entity).map((x) => x.at), ...(this.levelInput?.rooms ?? []).map((r) => labelPoint(this.inner(r)))];
      ctx.points = extra;
      ctx.align = { x: extra.map((p) => p[0]), y: extra.map((p) => p[1]) };
      this.clearSelection();
      this._room = room;
      this._drag = { kind: "light", origin: clone(this._model), entity, room, startWorld: world, ctx, moved: false, part };
      return;
    }
    const hitOpening = target.closest("[data-opening]") as SVGElement | null;
    if (hitOpening) {
      const sel = JSON.parse(hitOpening.dataset.opening!) as { src: OpeningSource; room: string };
      const o = readOpening(this._model, this._level, sel.src);
      if (o) {
        this.clearSelection();
        this._opening = sel;
        const axis = o.side === "north" || o.side === "south" ? 0 : 1;
        this._drag = { kind: "opening", origin: clone(this._model), src: sel.src, axis, startWorld: world, at: o.at, snaps: this.openingSnaps(sel, o, axis), room: sel.room };
        return;
      }
    }
    if (this._tool === "opening") {
      // the door & window tool: a click on a wall adds a window
      const hitWall = target.closest("[data-addwall]") as SVGElement | null;
      if (hitWall) {
        this.clearSelection();
        this.addOpeningAt(JSON.parse(hitWall.dataset.addwall!), world);
        return;
      }
      this.clearSelection();
      this._drag = { kind: "pan", start: this.eventScreen(e), offset: [this._view.ox, this._view.oy] };
      return;
    }
    const hitFurn = target.closest("[data-furniture]") as SVGElement | null;
    if (hitFurn) {
      const sel = JSON.parse(hitFurn.dataset.furniture!) as { room: string; index: number };
      const centre = this.furnitureCentre(sel.room, sel.index);
      if (centre) {
        this.clearSelection();
        this._furn = sel;
        this._drag = { kind: "furniture", origin: clone(this._model), room: sel.room, index: sel.index, startWorld: world, centre, moved: false };
        return;
      }
    }
    this._furn = null;
    this._energySel = null;
    this._robotSel = null;
    this._opening = null;
    const freeEnd = target.closest("[data-freeend]") as SVGElement | null;
    if (freeEnd && this._freeWall !== null) {
      const endNo = Number(freeEnd.dataset.freeend) as 0 | 1;
      const fw = this.levelInput?.walls?.[this._freeWall]?.line;
      this._drag = { kind: "freewall-end", origin: clone(this._model), index: this._freeWall, end: endNo, ctx: this.snapContext(fw ? (fw[endNo] as Vec2) : undefined) };
      return;
    }
    const freeHit = target.closest("[data-freewall]") as SVGElement | null;
    if (freeHit) {
      const index = Number(freeHit.dataset.freewall);
      this._freeWall = index;
      this._room = null;
      this._wall = null;
      this._stair = null;
      // dragged by its body: the whole wall moves (its ends snap to corners and other walls' ends)
      const w = this.levelInput?.walls?.[index];
      if (w?.line && w.line.every((p) => typeof p[0] === "number" && typeof p[1] === "number")) {
        const line = (w.line as [Vec2, Vec2]).map((p) => [...p]) as [Vec2, Vec2];
        const ctx = this.snapContext();
        const away = (p: Vec2) => line.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01);
        ctx.points = ctx.points.filter(away);
        ctx.align = { x: ctx.points.map((p) => p[0]), y: ctx.points.map((p) => p[1]) };
        const len = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) || 1;
        const normal: Vec2 = [-(line[1][1] - line[0][1]) / len, (line[1][0] - line[0][0]) / len];
        ctx.segments = (ctx.segments ?? []).filter(([a, b]) => !(line.some((q) => Math.hypot(a[0] - q[0], a[1] - q[1]) < 0.01) && line.some((q) => Math.hypot(b[0] - q[0], b[1] - q[1]) < 0.01)));
        this._drag = { kind: "freewall-move", origin: clone(this._model), index, line, startWorld: world, ctx, faces: this.parallelFaces(line, normal), normal };
      }
      return;
    }
    this._freeWall = null;
    const handle = target.closest("[data-handle]") as SVGElement | null;
    if (handle?.dataset.handle === "vertex") {
      const from: Vec2 = JSON.parse(handle.dataset.at!);
      // a press selects the corner (Delete removes it); dragging moves it
      this._vertexSel = from;
      this._drag = { kind: "vertex", origin: clone(this._model), from, ctx: { ...this.snapContext(from), anchors: this.neighbourCorners(from) } };
      return;
    }
    if (handle?.dataset.handle === "edge") {
      const [a, b]: [Vec2, Vec2] = JSON.parse(handle.dataset.at!);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const normal: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      this._drag = { kind: "edge", origin: clone(this._model), a, b, startWorld: world, normal, ctx: this.snapContext(), faces: this.parallelFaces([a, b], normal) };
      return;
    }
    const stairHandle = target.closest("[data-stairhandle]") as SVGElement | null;
    if (stairHandle && this._stair) {
      const fixed: Vec2 = JSON.parse(stairHandle.dataset.stairhandle!);
      this._drag = { kind: "stair-resize", origin: clone(this._model), id: this._stair, fixed, ctx: this.snapContext() };
      return;
    }
    const stairHit = target.closest("[data-stair]") as SVGElement | null;
    if (stairHit) {
      const id = stairHit.dataset.stair!;
      const v = this._model.vertical?.find((x) => x.id === id);
      if (v) {
        this._stair = id;
        this._room = null;
        this._wall = null;
        this._drag = { kind: "stair-move", origin: clone(this._model), id, rect: stairsRect(this._model, v), startWorld: world, ctx: this.snapContext(), moved: false };
        return;
      }
    }
    this._stair = null;
    const wallHit = target.closest("[data-wall]") as SVGElement | null;
    // the piece of the wall between the corners nearest the click (a wall split by a corner: one half)
    this._wall = wallHit ? this.wallPiece(JSON.parse(wallHit.dataset.wall!), world) : null;
    if (wallHit) {
      // drag just this piece of wall, e.g. to line its face up with another wall
      const { line, thickness } = JSON.parse(wallHit.dataset.wall!) as { line: [Vec2, Vec2]; thickness: number };
      const [a, b] = line;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const normal: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      this._room = null;
      this._drag = { kind: "wall", origin: clone(this._model), a, b, startWorld: world, normal, thickness, faces: this.parallelFaces(line, normal) };
      return;
    }
    const roomId = wallHit ? null : target.closest("[data-outline]") ? OUTLINE : (target.closest("[data-room]") as SVGElement | null)?.dataset.room;
    this._room = roomId ?? null;
    this._drag = { kind: "pan", start: this.eventScreen(e), offset: [this._view.ox, this._view.oy] };
  }

  private onPlanMove(e: PointerEvent) {
    this._planPointer = this.eventWorld(e);
    if (this._straighten?.a) this._straighten = { ...this._straighten, to: this.eventWorld(e) };
    if (this._tool === "assign" && this._assignArea && !this._drag) {
      const t = this.assignTarget(this.eventWorld(e));
      const key = t ? `${t.room ?? ""}:${JSON.stringify(t.poly[0])}` : "";
      const was = this._assignHover ? `${this._assignHover.room ?? ""}:${JSON.stringify(this._assignHover.poly[0])}` : "";
      if (key !== was) this._assignHover = t ? { ...t, area: this._assignArea } : null;
    }
    const drag = this._drag;
    if (!drag || !this._model) return;
    const world = this.eventWorld(e);
    const screen = this.eventScreen(e);
    const free = e.altKey;
    // a finger hides what it drags: show it magnified
    this._loupe = e.pointerType !== "mouse" && drag.kind !== "pan" && drag.kind !== "underlay" ? { x: screen[0], y: screen[1] } : null;
    const snapped = (p: Vec2, ctx: SnapContext): Snapped => (free ? { p, kind: "free" } : snap(p, ctx));
    if (drag.kind === "floor-move") {
      // in 5 cm steps (Alt: freely)
      const step = (v: number) => (free ? v : Math.round(v / 0.05) * 0.05);
      const by: Vec2 = [step(world[0] - drag.start[0]), step(world[1] - drag.start[1])];
      this._model = transformLevel(drag.origin, this._level, { turn: 0, about: [0, 0], by });
      const u = this._underlay;
      if (u && drag.place && u.level === this._level) this._underlay = { ...u, place: { ...drag.place, origin: [drag.place.origin[0] + by[0], drag.place.origin[1] + by[1]] } };
      this._hint = { x: screen[0], y: screen[1], lines: [this.moveReadout(by)] };
      return;
    }
    if (drag.kind === "underlay") {
      const u = this._underlay;
      if (u) this._underlay = { ...u, place: { ...u.place, origin: [drag.origin[0] + world[0] - drag.start[0], drag.origin[1] + world[1] - drag.start[1]] } };
      return;
    }
    if (drag.kind === "pan") {
      this._view = { ...this._view, ox: drag.offset[0] + screen[0] - drag.start[0], oy: drag.offset[1] + screen[1] - drag.start[1] };
      return;
    }
    if (drag.kind === "vertex") {
      const s = snapped(world, drag.ctx);
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target, rays: s.rays };
      this._model = moveVertex(drag.origin, this._level, drag.from, s.p, !e.shiftKey);
      this._hint = { x: screen[0], y: screen[1], lines: [...this.cornerReadout(s.p), this.t(`editor.snap_${s.kind}` as StringKey)] };
      return;
    }
    if (drag.kind === "edge") {
      // walls move along their normal only, so right angles stay right
      const along = (world[0] - drag.startWorld[0]) * drag.normal[0] + (world[1] - drag.startWorld[1]) * drag.normal[1];
      const moved: Vec2 = [drag.a[0] + drag.normal[0] * along, drag.a[1] + drag.normal[1] * along];
      const s = snapped(moved, { ...drag.ctx, points: [], segments: [] });
      this._guides = { x: s.alignX, y: s.alignY };
      let snappedAlong = (s.p[0] - drag.a[0]) * drag.normal[0] + (s.p[1] - drag.a[1]) * drag.normal[1];
      // in line with another wall: its centre line or either face
      const base = drag.a[0] * drag.normal[0] + drag.a[1] * drag.normal[1];
      const wall = free ? null : snapValue(base + along, drag.faces, 10 / this._view.scale);
      if (wall !== null) {
        snappedAlong = Math.round((wall - base) * 1000) / 1000;
        const vertical = Math.abs(drag.normal[0]) > 0.999;
        const horizontal = Math.abs(drag.normal[1]) > 0.999;
        this._guides = vertical ? { x: wall * Math.sign(drag.normal[0]) } : horizontal ? { y: wall * Math.sign(drag.normal[1]) } : null;
      }
      const delta: Vec2 = [drag.normal[0] * snappedAlong, drag.normal[1] * snappedAlong];
      this._model = moveEdge(drag.origin, this._level, drag.a, drag.b, delta, !e.shiftKey);
      this._hint = { x: screen[0], y: screen[1], lines: [this.moveReadout(delta), ...this.roomReadout()] };
      return;
    }
    if (drag.kind === "furniture") {
      const p: Vec2 = [drag.centre[0] + world[0] - drag.startWorld[0], drag.centre[1] + world[1] - drag.startWorld[1]];
      if (!drag.moved && Math.hypot(p[0] - drag.centre[0], p[1] - drag.centre[1]) * this._view.scale < 4) return;
      drag.moved = true;
      const rooms = (this.levelInput?.rooms ?? []).filter((r) => r.kind !== "void");
      const into = roomAt(this._model!, rooms, p)?.id ?? drag.room;
      const piece = drag.origin.levels.find((l) => l.id === this._level)?.rooms.find((r) => r.id === drag.room)?.furniture?.[drag.index];
      const target = rooms.find((r) => r.id === into);
      if (!piece || !target) return;
      const mount = mountOf(piece);
      const size = piece.size ?? FURNITURE[piece.type].size;
      const loose = free || !this._snapPieces;
      let at = p;
      let guides: { x?: number; y?: number } = {};
      let rotation: number | undefined;
      if (loose) {
        // placed freely: no walls, no neighbours, no grid
      } else if (mount === "wall") {
        // wall pieces slide along the walls, their back against them
        const onWall = wallSnap(this.inner(target), p, size[1]);
        if (onWall) [at, rotation] = [onWall.at, onWall.rotation];
      } else {
        const half = footprintHalf(size, piece.rotation ?? 0);
        if (half) {
          // floor pieces snap to walls and to each other; ceiling pieces to each other and the room's middle
          const inner = this.inner(target);
          const walls = mount === "floor" ? inner.map((q, i) => [q, inner[(i + 1) % inner.length]] as [Vec2, Vec2]) : [];
          const snappedPiece = snapFurniture({ c: p, half }, walls, this.footprints(drag.room, drag.index, mount), mount === "ceiling" ? [labelPoint(inner)] : [], 10 / this._view.scale, (q) => pointInPolygon(q, inner));
          at = snappedPiece.c;
          guides = snappedPiece.guide;
        } else at = snapped(p, { ...this.snapContext(), points: [] }).p;
      }
      let moved = moveFurniture(drag.origin, this._level, drag.room, drag.index, at, into);
      if (rotation !== undefined) moved = { ...moved, model: updateFurniture(moved.model, this._level, moved.room, moved.index, { rotation }) };
      this._model = moved.model;
      this._furn = { room: moved.room, index: moved.index };
      this._guides = guides;
      return;
    }
    if (drag.kind === "robot") {
      const p: Vec2 = [drag.dock[0] + world[0] - drag.startWorld[0], drag.dock[1] + world[1] - drag.startWorld[1]];
      if (!drag.moved && Math.hypot(p[0] - drag.dock[0], p[1] - drag.dock[1]) * this._view.scale < 4) return;
      drag.moved = true;
      const s = snapped(p, { ...this.snapContext(), points: [] });
      this._guides = { x: s.alignX, y: s.alignY };
      this._model = updateRobot(drag.origin, drag.index, { dock: s.p });
      return;
    }
    if (drag.kind === "energy") {
      const p: Vec2 = [drag.at[0] + world[0] - drag.startWorld[0], drag.at[1] + world[1] - drag.startWorld[1]];
      if (!drag.moved && Math.hypot(p[0] - drag.at[0], p[1] - drag.at[1]) * this._view.scale < 4) return;
      drag.moved = true;
      const s = snapped(p, { ...this.snapContext(), points: [] });
      this._guides = { x: s.alignX, y: s.alignY };
      this._model = updateEnergy(drag.origin, drag.index, { at: s.p });
      return;
    }
    if (drag.kind === "camera") {
      if (!drag.moved && Math.hypot(world[0] - drag.startWorld[0], world[1] - drag.startWorld[1]) * this._view.scale < 4) return;
      drag.moved = true;
      const room = this.levelInput?.rooms.find((r) => r.id === drag.room);
      if (!room) return;
      const s = snapped(world, { ...this.snapContext(), points: [] });
      const { min } = bbox(roomPolygon(this._model!, room));
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
      this._model = updateCamera(drag.origin, this._level, room.id, drag.index, { at: [s.p[0] - min[0], s.p[1] - min[1]] });
      return;
    }
    if (drag.kind === "light") {
      if (!drag.moved && Math.hypot(world[0] - drag.startWorld[0], world[1] - drag.startWorld[1]) * this._view.scale < 4) return;
      drag.moved = true;
      const s = snapped(world, drag.ctx);
      if (drag.part !== undefined) {
        // a spot of a row or a strip's far end: stays in the light's room
        const room = this.levelInput?.rooms.find((r) => r.id === drag.room);
        const entry = room?.lights?.find((x) => x.entity === drag.entity);
        if (!room || !entry) return;
        const { min } = bbox(roomPolygon(this._model!, room));
        const p: [number, number] = [s.p[0] - min[0], s.p[1] - min[1]];
        this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
        const shape = drag.part === "to" ? { to: p } : { spots: (entry.spots ?? []).map((q, i) => (i === drag.part ? p : q)) };
        this._model = setLightShape(drag.origin, this._level, room.id, drag.entity, shape);
        return;
      }
      const rooms = (this.levelInput?.rooms ?? []).filter((r) => r.kind !== "void");
      const room = roomAt(this._model!, rooms, s.p) ?? rooms.find((r) => r.id === drag.room);
      if (!room) return;
      const { min } = bbox(roomPolygon(this._model!, room));
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
      this._model = placeLight(drag.origin, this._level, room.id, drag.entity, [s.p[0] - min[0], s.p[1] - min[1]]);
      this._room = room.id;
      this._hint = { x: screen[0], y: screen[1], lines: [this.entityName(drag.entity), `→ ${this.roomName(room)}`] };
      return;
    }
    if (drag.kind === "stair-move") {
      const [x, y, w, d] = drag.rect;
      const corner: Vec2 = [x + world[0] - drag.startWorld[0], y + world[1] - drag.startWorld[1]];
      if (!drag.moved && Math.hypot(corner[0] - x, corner[1] - y) * this._view.scale < 4) return;
      drag.moved = true;
      // snap the corner nearest the cursor's direction: try all four, keep the closest snap
      const offsets: Vec2[] = [[0, 0], [w, 0], [0, d], [w, d]];
      const snaps = offsets.map((o) => {
        const s = snapped([corner[0] + o[0], corner[1] + o[1]], drag.ctx);
        return { s, o, dist: Math.hypot(s.p[0] - corner[0] - o[0], s.p[1] - corner[1] - o[1]) + (s.kind === "grid" || s.kind === "free" ? 1 : 0) };
      });
      const best = snaps.sort((a, b) => a.dist - b.dist)[0];
      const nx = best.s.p[0] - best.o[0];
      const ny = best.s.p[1] - best.o[1];
      this._guides = { x: best.s.alignX, y: best.s.alignY, ring: best.s.target };
      this._model = setStairsRect(drag.origin, drag.id, [nx, ny, w, d]);
      this._hint = { x: screen[0], y: screen[1], lines: [`${this.n(nx)}; ${this.n(ny)} m`] };
      return;
    }
    if (drag.kind === "stair-resize") {
      const s = snapped(world, drag.ctx);
      const [fx, fy] = drag.fixed;
      const w = Math.max(0.6, Math.abs(s.p[0] - fx));
      const d = Math.max(0.6, Math.abs(s.p[1] - fy));
      const x = s.p[0] < fx ? fx - w : fx;
      const y = s.p[1] < fy ? fy - d : fy;
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
      this._model = setStairsRect(drag.origin, drag.id, [x, y, w, d]);
      this._hint = { x: screen[0], y: screen[1], lines: [`${this.n(w)} × ${this.n(d)} m`] };
      return;
    }
    if (drag.kind === "wall") {
      const raw = (world[0] - drag.startWorld[0]) * drag.normal[0] + (world[1] - drag.startWorld[1]) * drag.normal[1];
      const base = drag.a[0] * drag.normal[0] + drag.a[1] * drag.normal[1];
      // line either face (or the centre) up with a face of a parallel wall
      const tol = free ? 0 : 10 / this._view.scale;
      const half = drag.thickness / 2;
      const best = drag.faces
        .flatMap((f) => [-half, 0, half].map((o) => ({ along: f - base - o, guide: f })))
        .filter((c) => Math.abs(c.along - raw) < tol)
        .sort((u, v) => Math.abs(u.along - raw) - Math.abs(v.along - raw))[0];
      const along = Math.round((best ? best.along : Math.round(raw / 0.05) * 0.05) * 1000) / 1000;
      const vertical = Math.abs(drag.normal[0]) > 0.999;
      const horizontal = Math.abs(drag.normal[1]) > 0.999;
      this._guides = best && vertical ? { x: best.guide * Math.sign(drag.normal[0]) } : best && horizontal ? { y: best.guide * Math.sign(drag.normal[1]) } : null;
      this._model = Math.abs(along) < 1e-6 ? drag.origin : moveWallPiece(drag.origin, this._level, drag.a, drag.b, [drag.normal[0] * along, drag.normal[1] * along]);
      this._hint = { x: screen[0], y: screen[1], lines: [this.moveReadout([drag.normal[0] * along, drag.normal[1] * along])] };
      return;
    }
    if (drag.kind === "opening") {
      // dragged off its wall onto another one: it moves there
      if (drag.src.kind === "level" && this.rehomeOpening(drag, world)) return;
      const delta = world[drag.axis] - drag.startWorld[drag.axis];
      const { origin, width, edges, centres } = drag.snaps;
      const start = origin + drag.at + delta;
      // line up the start, end or centre with room edges, the room's centre and the
      // doors and windows on the levels above and below
      const tol = free ? 0 : 10 / this._view.scale;
      const options = [
        ...edges.map((t) => ({ d: t - start, guide: t })),
        ...edges.map((t) => ({ d: t - (start + width), guide: t })),
        ...centres.map((t) => ({ d: t - (start + width / 2), guide: t })),
      ].filter((c) => Math.abs(c.d) < tol);
      const best = options.sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
      const raw = best ? start + best.d - origin : Math.round((start - origin) / 0.05) * 0.05;
      const at = Math.max(0, raw);
      this._guides = best ? (drag.axis === 0 ? { x: best.guide } : { y: best.guide }) : null;
      this._model = updateOpening(drag.base ?? drag.origin, this._level, drag.src, { at: Math.round(at * 100) / 100 });
      const o = readOpening(this._model, this._level, drag.src);
      this._hint = { x: screen[0], y: screen[1], lines: [this.t("editor.opening_at", { at: this.n(o?.at ?? 0), width: this.n(o?.width ?? 0) })] };
      return;
    }
    if (drag.kind === "energy-link") {
      this._linkEnd = world;
      return;
    }
    if (drag.kind === "section" && this._sectionDraft) {
      const s = snapped(world, drag.ctx);
      this._sectionDraft = { a: this._sectionDraft.a, b: s.p };
      return;
    }
    if (drag.kind === "measure" && this._measure) {
      const s = snapped(world, drag.ctx);
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
      this._measure = { a: this._measure.a, b: s.p };
      return;
    }
    if (drag.kind === "freewall" && this._linePreview) {
      const a = this._linePreview[0];
      // straight, or at 45°, from where it starts
      const s = snapped(world, { ...drag.ctx, anchors: [a] });
      const b = s.p;
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target, rays: s.rays };
      this._linePreview = [a, b];
      this._hint = { x: screen[0], y: screen[1], lines: [this.fmtM(Math.hypot(b[0] - a[0], b[1] - a[1]))] };
      return;
    }
    if (drag.kind === "freewall-move") {
      const d: Vec2 = [world[0] - drag.startWorld[0], world[1] - drag.startWorld[1]];
      const moved = drag.line.map((p) => [p[0] + d[0], p[1] + d[1]] as Vec2);
      // an end landing on a corner pulls the wall onto it; otherwise it moves in 5 cm steps
      const pulls = free ? [] : moved.map((p) => ({ p, s: snap(p, drag.ctx) })).filter((x) => x.s.kind === "point");
      const pull = pulls.sort((u, v) => Math.hypot(u.s.p[0] - u.p[0], u.s.p[1] - u.p[1]) - Math.hypot(v.s.p[0] - v.p[0], v.s.p[1] - v.p[1]))[0];
      const step = (v: number) => (free ? v : Math.round(v / 0.05) * 0.05);
      let by: Vec2 = pull ? [d[0] + pull.s.p[0] - pull.p[0], d[1] + pull.s.p[1] - pull.p[1]] : [step(d[0]), step(d[1])];
      // no corner to land on: across, in line with a parallel wall (its centre line or a face)
      if (!pull && !free) {
        const n = drag.normal;
        const base = drag.line[0][0] * n[0] + drag.line[0][1] * n[1];
        const across = d[0] * n[0] + d[1] * n[1];
        const wall = snapValue(base + across, drag.faces, 10 / this._view.scale);
        if (wall !== null) {
          const shift = wall - base - (by[0] * n[0] + by[1] * n[1]);
          by = [by[0] + n[0] * shift, by[1] + n[1] * shift];
        }
      }
      const line = drag.line.map((p) => [Math.round((p[0] + by[0]) * 1000) / 1000, Math.round((p[1] + by[1]) * 1000) / 1000]) as [Vec2, Vec2];
      this._guides = pull ? { ring: pull.s.p } : null;
      this._model = updateFreeWall(drag.origin, this._level, drag.index, { line });
      this._hint = { x: screen[0], y: screen[1], lines: [this.moveReadout(by)] };
      return;
    }
    if (drag.kind === "section-end") {
      const sec = drag.origin.sections?.[drag.index];
      if (!sec) return;
      const line = sec.line.map((p) => [...p]) as [[number, number], [number, number]];
      const s = snapped(world, { ...drag.ctx, anchors: [line[1 - drag.end] as Vec2] });
      line[drag.end] = [Math.round(s.p[0] * 100) / 100, Math.round(s.p[1] * 100) / 100];
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target, rays: s.rays };
      const next = clone(drag.origin);
      next.sections![drag.index].line = line;
      this._model = next;
      this._hint = { x: screen[0], y: screen[1], lines: [this.fmtM(Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]))] };
      return;
    }
    if (drag.kind === "freewall-end") {
      const w = drag.origin.levels.find((l) => l.id === this._level)?.walls?.[drag.index];
      if (!w?.line) return;
      const line = (w.line as [Vec2, Vec2]).map((p) => [...p]) as [Vec2, Vec2];
      const s = snapped(world, { ...drag.ctx, anchors: [line[1 - drag.end]] });
      line[drag.end] = s.p;
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target, rays: s.rays };
      this._model = updateFreeWall(drag.origin, this._level, drag.index, { line });
      this._hint = { x: screen[0], y: screen[1], lines: [this.fmtM(Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]))] };
      return;
    }
    if (drag.kind === "rect") {
      const endSnap = snapped(world, drag.ctx);
      const end = endSnap.p;
      this._guides = { x: endSnap.alignX, y: endSnap.alignY, ring: endSnap.target };
      const [x0, y0] = drag.start;
      this._rectPreview = [[x0, y0], [end[0], y0], [end[0], end[1]], [x0, end[1]]];
      const w = Math.abs(end[0] - x0);
      const d = Math.abs(end[1] - y0);
      this._hint = { x: screen[0], y: screen[1], lines: [`${this.n(w)} × ${this.n(d)} m`, `${this.n(w * d)} m²`] };
    }
  }

  private onPlanUp(e?: PointerEvent) {
    const drag = this._drag;
    this._drag = null;
    this._hint = null;
    this._guides = null;
    this._loupe = null;
    if (!drag || !this._model) return;
    if (drag.kind === "energy-link") {
      this._linkEnd = null;
      // dropped on another item's marker: connect to it
      const hit = e ? (this.renderRoot as ShadowRoot).elementFromPoint(e.clientX, e.clientY)?.closest("[data-energy]") : null;
      const to = hit ? Number((hit as SVGElement).dataset.energy) : null;
      if (to !== null && to !== drag.from) this.commit(connectEnergy(this._model, drag.from, to));
      return;
    }
    if (drag.kind === "underlay" && this._underlay) {
      this.saveUnderlay({ place: this._underlay.place });
      return;
    }
    if (drag.kind === "section") {
      const d = this._sectionDraft;
      this._sectionDraft = null;
      if (!d || Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < 0.5) return;
      const m = structuredClone(this._model);
      const sections = (m.sections ??= []);
      const ids = new Set(sections.map((s) => s.id));
      let n = sections.length + 1;
      while (ids.has(`section_${n}`)) n++;
      // looking across the line: north or west (from the street side up), whichever crosses it
      const horizontal = Math.abs(d.b[0] - d.a[0]) >= Math.abs(d.b[1] - d.a[1]);
      const r = (p: Vec2): [number, number] => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
      sections.push({ id: `section_${n}`, name: this.t("editor.section_name", { n: String(n) }), line: [r(d.a), r(d.b)], look: horizontal ? "north" : "west" });
      this.commit(m);
      this.clearSelection();
      this._sectionSel = sections.length - 1;
      this.tipOnce("section");
      return;
    }
    if (drag.kind === "floor-move") {
      if (JSON.stringify(drag.origin) !== JSON.stringify(this._model)) this.commit(this._model, drag.origin);
      if (this._underlay && drag.place && this._underlay.level === this._level) this.saveUnderlay({ place: this._underlay.place });
      return;
    }
    if (drag.kind === "freewall" && this._linePreview) {
      const [a, b] = this._linePreview;
      this._linePreview = null;
      if (this._tool === "divide") {
        // a line across a room: two rooms, open to each other
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const room = roomAt(this._model!, this.levelInput?.rooms ?? [], mid);
        const out = room && Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.2 ? divideRoom(this._model, this._level, room.id, a, b) : null;
        if (out) {
          this.commit(out.model);
          this.clearSelection();
          // the new part: next, give it its area
          this._room = out.ids[1];
        } else this._toolMiss = this.t("editor.divide_missed");
        return;
      }
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.2) {
        // only where there is no wall yet: along an existing one, nothing is added
        const pieces = uncoveredPieces(a, b, this.snapContext().segments ?? []);
        let model = this._model;
        let index = -1;
        for (const [p, q] of pieces) {
          ({ model, index } = addFreeWall(model, this._level, p, q));
          // the railing sub-tool: a railing along a gallery or stair edge, or round a roof terrace
          if (this._tool === "railing") model = updateFreeWall(model, this._level, index, { type: "railing" });
        }
        this.commit(model);
        this._freeWall = index >= 0 ? index : null;
        this._room = null;
        // a wall that closes a shape completes a room there (no area yet); undo takes back just that
        if (this._tool === "wall") this.completeRooms([a, b]);
        if (this._tool === "wall") this.tipOnce("wall");
        // the tool stays: the next wall can start where this one ended (Esc or V to stop)
      }
      return;
    }
    // a selected room's side clicked, not dragged: the wall there (between it and the next room)
    if (drag.kind === "edge" && JSON.stringify(drag.origin) === JSON.stringify(this._model)) {
      const wall = this.insideWallAt(drag.startWorld);
      if (wall) {
        this.clearSelection();
        this._wall = wall;
        return;
      }
    }
    if (drag.kind === "vertex" || drag.kind === "edge" || drag.kind === "opening" || drag.kind === "wall" || drag.kind === "stair-move" || drag.kind === "stair-resize" || drag.kind === "light" || drag.kind === "energy" || drag.kind === "furniture" || drag.kind === "freewall-end" || drag.kind === "section-end" || drag.kind === "freewall-move" || drag.kind === "robot" || drag.kind === "camera") {
      if (JSON.stringify(drag.origin) !== JSON.stringify(this._model)) this.commit(this._model, drag.origin);
    } else if (drag.kind === "rect" && this._rectPreview && this._tool === "stairs") {
      const [[x0, y0], , [x1, y1]] = this._rectPreview;
      this._rectPreview = null;
      const idx = this._model.levels.findIndex((l) => l.id === this._level);
      const above = this._model.levels[idx + 1];
      if (above && Math.abs(x1 - x0) >= 0.6 && Math.abs(y1 - y0) >= 0.6) {
        const { model, id } = addStairs(this._model, [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)], this._level, above.id);
        this.commit(model);
        this._stair = id;
        this._room = null;
        this._tool = "select";
        this.tipOnce("stairs");
      }
    } else if (drag.kind === "rect" && this._rectPreview) {
      const [[x0, y0], , [x1, y1]] = this._rectPreview;
      this._rectPreview = null;
      if (Math.abs(x1 - x0) >= 0.3 && Math.abs(y1 - y0) >= 0.3) {
        const pending = this._pendingArea;
        const props: Partial<RoomInput> = pending ? { id: uniqueId(this.levelInput!.rooms.map((r) => r.id), slug(pending, "room")), area_id: pending } : {};
        this._pendingArea = null;
        const rect: Vec2[] = [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]];
        // the balcony tool: outdoors, with a railing on its free edges on upper floors (a terrace
        // on the ground floor); the room tool always makes a room
        const upper = this._model.levels.findIndex((l) => l.id === this._level) > 0;
        if (this._tool === "balcony") {
          Object.assign(props, upper ? { kind: "outdoor", railing: "metal" } : { kind: "outdoor" });
          if (!props.id) props.id = uniqueId(this.levelInput!.rooms.map((r) => r.id), upper ? "balcony" : "terrace");
        }
        // a room drawn over others takes its space from them (balconies just go where drawn)
        const { model, id } = this._tool === "rect" ? drawRoomOver(this._model, this._level, rect, props) : addRoom(this._model, this._level, rect, props);
        this.commit(model);
        this._room = id;
        this._tool = "select";
        // (a balcony is outdoors: no room tip)
        if (!props.kind) this.tipOnce("room");
      }
    }
  }

  private onPlanDoubleClick(e: MouseEvent) {
    if (!this._model) return;
    // the plan holds the pointer while pressed, so the event names the plan: ask what is under it
    const under = (this.renderRoot as ShadowRoot).elementsFromPoint(e.clientX, e.clientY);
    const handle = under.map((el) => el.closest("[data-handle]") as SVGElement | null).find((h) => h?.dataset.handle === "vertex") ?? under.map((el) => el.closest("[data-handle]") as SVGElement | null).find(Boolean);
    // its first click picked something else (the wall on a selected room's side): back to that
    // room, and its side under the pointer
    const r0 = (this.renderRoot.querySelector("svg.plan") as SVGSVGElement).getBoundingClientRect();
    const where = this.toWorld([e.clientX - r0.left, e.clientY - r0.top]);
    const before = this.roomBefore && Date.now() - this.roomBefore.time < 800 ? this.roomBefore.id : null;
    this.roomBefore = null;
    const poly = before && !this._room ? this.levelInputRoomPolygon(before) : null;
    const near = poly
      ?.map((a, i) => ({ a, b: poly[(i + 1) % poly.length], d: project(where, a, poly[(i + 1) % poly.length]) }))
      .filter((x) => x.d.t > 0 && x.d.t < x.d.length && x.d.distance < Math.max(0.2, 10 / this._view.scale))
      .sort((x, y) => x.d.distance - y.d.distance)[0];
    const recent = near && before ? { room: before, a: near.a, b: near.b } : null;
    if (handle?.dataset.handle === "vertex") {
      this.commit(removeVertex(this._model, this._level, JSON.parse(handle.dataset.at!)));
      // (it is gone: nothing left to have selected)
      this._vertexSel = null;
    } else if (handle?.dataset.handle === "edge" || recent) {
      if (recent && handle?.dataset.handle !== "edge") {
        this._wall = null;
        this._room = recent.room;
      }
      const [a, b]: [Vec2, Vec2] = handle?.dataset.handle === "edge" ? JSON.parse(handle.dataset.at!) : [recent!.a, recent!.b];
      // the new corner where the wall was clicked (to the centimetre), clear of its ends
      const r = (this.renderRoot.querySelector("svg.plan") as SVGSVGElement).getBoundingClientRect();
      const w = this.toWorld([e.clientX - r.left, e.clientY - r.top]);
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
      const t = Math.min(0.9, Math.max(0.1, ((w[0] - a[0]) * (b[0] - a[0]) + (w[1] - a[1]) * (b[1] - a[1])) / len2));
      const at: Vec2 = [Math.round((a[0] + t * (b[0] - a[0])) * 100) / 100, Math.round((a[1] + t * (b[1] - a[1])) * 100) / 100];
      this.commit(splitEdge(this._model, this._level, a, b, at));
    }
  }

  private onPlanWheel(e: WheelEvent) {
    e.preventDefault();
    const r = (this.renderRoot.querySelector("svg.plan") as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const [wx, wy] = this.toWorld([sx, sy]);
    const scale = Math.min(400, Math.max(5, this._view.scale * Math.exp(-e.deltaY * 0.0015)));
    this._view = { scale, ox: sx - wx * scale, oy: sy - wy * scale };
  }

  /** Lengths and angle at a dragged corner, plus the selected room's area. */
  private cornerReadout(at: Vec2): string[] {
    const m = this._model!;
    const lines: string[] = [];
    for (const r of this.levelInput?.rooms ?? []) {
      const poly = roomPolygon(m, r);
      const i = poly.findIndex((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < 0.01);
      if (i < 0 || (this._room && r.id !== this._room)) continue;
      // inside dimensions of the two sides at this corner
      const inner = this.inner(r);
      const sides = this.innerSides(poly, inner);
      lines.push(`${this.fmtM(sides[(i - 1 + poly.length) % poly.length])} · ${this.fmtM(sides[i])} · ${Math.round(cornerAngle(poly, i))}°`);
      lines.push(`${this.roomName(r)}: ${this.n(area(inner))} m²`);
      break;
    }
    return lines;
  }

  private roomReadout(): string[] {
    const r = this.levelInput?.rooms.find((x) => x.id === this._room);
    return r ? [`${this.roomName(r)}: ${this.n(area(this.inner(r)))} m²`] : [];
  }

  /** Walls of the level being edited (derived from the current model). */
  /** The inside wall under a plan point (as clicking it selects it), the selected room's side first. */
  private insideWallAt(p: Vec2): { a: string; b: string; side: Side | null; line: [Vec2, Vec2]; thickness: number } | null {
    let best: Wall | null = null;
    let dist = Infinity;
    for (const w of this.levelWalls()) {
      if ((w.type !== "interior" && w.type !== "open") || !w.rooms.length) continue;
      const pr = project(p, w.line[0], w.line[1]);
      const len = Math.hypot(w.line[1][0] - w.line[0][0], w.line[1][1] - w.line[0][1]);
      if (pr.t < 0 || pr.t > len || pr.distance >= dist) continue;
      [best, dist] = [w, pr.distance];
    }
    if (!best || dist > Math.max(best.thickness / 2, 8 / this._view.scale)) return null;
    const a = this._room && best.rooms.includes(this._room) ? this._room : best.rooms[0];
    const b = best.rooms.find((r) => r !== a) ?? "";
    const own = this.levelInputRoomPolygon(a);
    const side = own ? sideOfRoom(own, best.line[0], best.line[1]) : null;
    return this.wallPiece({ a, b, side, line: best.line, thickness: best.thickness }, p);
  }

  /**
   * A wall narrowed to the piece around a point: between the corners of its two rooms that lie on
   * it (one added on a straight wall splits it), so that piece alone can be opened.
   */
  private wallPiece<T extends { a: string; b: string; line: [Vec2, Vec2] }>(sel: T, p: Vec2): T {
    const [s0, s1] = sel.line;
    const len = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    if (len < 1e-6) return sel;
    const cuts = [0, len];
    for (const id of [sel.a, sel.b]) {
      for (const q of (id && this.levelInputRoomPolygon(id)) || []) {
        const pr = project(q, s0, s1);
        if (pr.distance < 0.01 && pr.t > 0.01 && pr.t < len - 0.01) cuts.push(pr.t);
      }
    }
    if (cuts.length === 2) return sel;
    cuts.sort((x, y) => x - y);
    const t = Math.min(len, Math.max(0, project(p, s0, s1).t));
    const i = Math.max(0, cuts.findIndex((c) => c >= t) - 1);
    const at = (d: number): Vec2 => [s0[0] + ((s1[0] - s0[0]) * d) / len, s0[1] + ((s1[1] - s0[1]) * d) / len];
    return { ...sel, line: [at(cuts[i]), at(cuts[Math.min(cuts.length - 1, i + 1)])] };
  }

  private levelWalls(): Wall[] {
    const { house } = expandHouse(this._model!);
    const level = house?.levels.find((x) => x.id === this._level);
    return level && house ? deriveWalls(level, house.walls, []) : [];
  }

  /**
   * Inside length of each side of a room: the stretch of the inner outline that lies
   * along that side (the inner outline may have extra corners where walls change).
   */
  private innerSides(poly: Vec2[], inner: Vec2[]): number[] {
    return poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const ts = inner
        .filter((p) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]) < 0.45)
        .map((p) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1])
        .filter((t) => t > -0.45 && t < length + 0.45);
      return ts.length >= 2 ? Math.max(...ts) - Math.min(...ts) : length;
    });
  }

  /** A room as it really is: to the inside of its walls (outdoor areas as drawn). */
  private inner(r: RoomInput, walls = this.levelWalls()): Vec2[] {
    // (curved walls: the room as bent; its corners stay what editing moves)
    const poly = r.curves?.length ? normalizeOrientation(bendEdges(shapeCorners(this._model!, r), r.curves)) : roomPolygon(this._model!, r);
    return (r.kind ?? "room") === "room" ? innerPolygon(poly, walls) : poly;
  }

  private alongWall(w: Wall, t: number): Vec2 {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    return this.toScreen([w.a[0] + ((w.b[0] - w.a[0]) * t) / len, w.a[1] + ((w.b[1] - w.a[1]) * t) / len]);
  }

  private levelInputRoomPolygon(id: string): Vec2[] | null {
    const r = this.levelInput?.rooms.find((x) => x.id === id);
    return r ? roomPolygon(this._model!, r) : null;
  }

  private roomName(r: RoomInput) {
    return (r.area_id && this._hass?.areas?.[r.area_id]?.name) || r.name || r.id;
  }

  // ----- 3D preview -----

  protected override updated(changed: PropertyValues) {
    // a room let go of (something else picked): kept a moment, for a double-click that follows
    const was = changed.get("_room") as string | null | undefined;
    if (changed.has("_room") && was && was !== OUTLINE && !this._room) this.roomBefore = { id: was, time: Date.now() };
    if (this._tour !== null) {
      if (changed.has("_model") || changed.has("_level") || changed.has("_saved")) this.checkTour();
      this.markTourTarget();
    } else if (changed.has("_tour")) this.markTourTarget();
    // someone new, with a house open and no start screen: the tour, offered once
    if (changed.has("_model") && this._model && this._tour === null && !this._start && !this.tourOffered) {
      this.tourOffered = true;
      let seen = false;
      try {
        seen = !!localStorage.getItem("homeslice-tour");
      } catch {
        seen = true;
      }
      if (!seen) this.startTour(true);
    }
    if (changed.has("_dimEdit") && this._dimEdit) {
      const input = this.renderRoot.querySelector("input.dim-input") as HTMLInputElement | null;
      input?.focus();
      input?.select();
    }
    if ((changed.has("_level") || changed.has("_house")) && this._model) void this.loadUnderlay();
    if ((changed.has("_model") || changed.has("_saved")) && this._model && !this._draft) this.keepDraft();
    if (changed.has("_model") || changed.has("_level") || changed.has("_sectionSel")) {
      if (this._model && this.fitted !== `${this._house}/${this._level}`) {
        this.fitted = `${this._house}/${this._level}`;
        this.fitView();
      }
      clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => this.updatePreview(), 120);
    }
  }

  // ----- the side panel's width: dragged by its edge -----

  private onSideDown = (e: PointerEvent) => {
    const side = this.renderRoot.querySelector<HTMLElement>("section.side");
    const main = this.renderRoot.querySelector<HTMLElement>("main");
    if (!side || !main) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // at most two thirds of the editor: the plan keeps room to work in
    this.sideDrag = { x: e.clientX, width: side.getBoundingClientRect().width, max: main.getBoundingClientRect().width * 0.66 };
    e.preventDefault();
  };

  private onSideMove = (e: PointerEvent) => {
    const d = this.sideDrag;
    if (!d) return;
    this._sideWidth = Math.round(Math.max(300, Math.min(d.max, d.width + d.x - e.clientX)));
  };

  private onSideUp = () => {
    if (!this.sideDrag) return;
    this.sideDrag = null;
    if (this._sideWidth) writePref("homeslice-side-width", String(this._sideWidth));
    // the preview draws at its new size
    this.updateComplete.then(() => this.updatePreview());
  };

  private updatePreview() {
    const canvas = this.renderRoot.querySelector("canvas.preview") as HTMLCanvasElement | null;
    if (!canvas || !this._model) return;
    if (!this.renderer) {
      try {
        this.renderer = new HouseRenderer(canvas);
        this.renderer.onChange = () => this.renderer?.draw();
      } catch {
        return;
      }
    }
    const { house, issues } = expandHouse(this._model);
    if (!house) return;
    const walls = new Map<string, Wall[]>();
    for (const l of house.levels) walls.set(l.id, deriveWalls(l, house.walls, issues));
    const keep = this.renderer.orientation.fov ? { ...this.renderer.orientation } : null;
    const zoom = this.renderer.zoom;
    this.renderer.setModel(house, walls, { focus: { azimuth: 200, elevation: 50, projection: "perspective" } });
    const index = house.levels.findIndex((l) => l.id === this._level);
    // a selected section: the preview shows its cut, all floors
    const section = this._sectionSel !== null ? (house.sections[this._sectionSel] ?? null) : null;
    void this.renderer.setFocus(section ? null : index >= 0 ? index : null, false);
    void this.renderer.setSection(section, false);
    if (keep && this.previewTouched && !section) {
      this.renderer.orientation = keep;
      this.renderer.zoom = zoom;
    }
    const { width, height } = canvas.getBoundingClientRect();
    if (width && height) this.renderer.render(width, height);
  }

  // ----- floor plan image -----

  private async loadUnderlay(slot?: number) {
    const key = `${this._house}/${this._level}#${slot ?? ""}`;
    if (this.underlayRequest === key) return;
    this.underlayRequest = key;
    this._underlay = null;
    this._calib = null;
    this._underlayMove = false;
    this._underlayAdding = false;
    const level = this._level;
    try {
      const list = await this._hass!.callWS<{ levels: string[]; slots?: string[] }>({ type: "homeslice/underlay/get", house: this._house });
      if (this.underlayRequest !== key) return;
      // "level" is its first backdrop, "level#2" another
      const slots = (list.slots ?? list.levels)
        .map((k) => k.split("#"))
        .filter(([l]) => l === level)
        .map(([, n]) => Number(n ?? 0))
        .sort((a, b) => a - b);
      this._underlaySlots = slots;
      const want = slot ?? this.underlaySlotOf[level];
      const pick = slots.includes(want as number) ? (want as number) : slots[0];
      if (pick === undefined) return;
      const got = await this._hass!.callWS<{ image: string; place?: Underlay["place"]; opacity?: number; source?: string | null } | null>({
        type: "homeslice/underlay/get",
        house: this._house,
        level,
        slot: pick,
      });
      if (!got || this.underlayRequest !== key) return;
      const { width, height } = await imageSize(got.image);
      this.underlaySlotOf[level] = pick;
      this._underlay = { level, slot: pick, image: got.image, width, height, place: got.place ?? { origin: [0, 0], scale: 0.01, rotation: 0 }, opacity: got.opacity ?? 0.5, ...(got.source ? { source: got.source } : {}) };
    } catch {
      // no image (or an older backend): nothing to show
    }
  }

  /** The robots on this floor whose map picture a backdrop is (the same device). */
  private robotsOfMap(source: string): number[] {
    const device = this._hass?.entities?.[source]?.device_id;
    return (this._model?.robots ?? []).flatMap((r, i) => (r.level === this._level && device && this._hass?.entities?.[r.entity]?.device_id === device ? [i] : []));
  }

  /** A robot's map as a backdrop: shown on the card's floor too, while the robot is out. */
  private renderRobotMapLink(u: Underlay) {
    if (!u.source) return nothing;
    const source = u.source;
    return this.robotsOfMap(source).map((i) => {
      const r = this._model!.robots![i];
      return html`<label class="check"><input type="checkbox" data-robot-map-card=${i} .checked=${r.map?.entity === source}
          @change=${async (e: Event) => {
            if (!(e.target as HTMLInputElement).checked) return this.commit(updateRobot(this._model!, i, { map: undefined }));
            const map = await this.robotMapPlace(u);
            if (map) this.commit(updateRobot(this._model!, i, { map }));
          }} />
        ${this.t("editor.robot_map_card", { robot: r.name ?? this.entityName(r.entity) })}</label>`;
    });
  }

  /** Where the live map picture lies, as the backdrop does (its size: the picture's own, unshrunk). */
  private async robotMapPlace(u: Underlay): Promise<NonNullable<HouseInput["robots"]>[number]["map"] | null> {
    const url = this._hass?.states[u.source!]?.attributes.entity_picture as string | undefined;
    let width = u.width;
    let height = u.height;
    if (url)
      try {
        ({ width, height } = await imageSize(url));
      } catch {
        // not showing right now: the backdrop's size it is
      }
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return { entity: u.source!, size: [width, height], origin: [r3(u.place.origin[0]), r3(u.place.origin[1])], scale: Math.round(((u.place.scale * u.width) / width) * 1e6) / 1e6, rotation: r3(u.place.rotation) };
  }

  /** What a backdrop is: the robot's map it came from, or an image. */
  private backdropName(u: Underlay): string {
    return u.source ? this.entityName(u.source) : this.t("editor.backdrop_image");
  }

  /** Shows the level's next backdrop (the floor plan, then the robot's map, …). */
  private cycleUnderlay() {
    const slots = this._underlaySlots;
    if (slots.length < 2) return;
    const now = this._underlay?.level === this._level ? this._underlay.slot : slots[0];
    this._underlayHidden = false;
    void this.loadUnderlay(slots[(slots.indexOf(now) + 1) % slots.length]);
  }

  /** Image pixels → plan metres, and back. */
  private underlayToPlan(u: Underlay, [px, py]: Vec2): Vec2 {
    const r = (u.place.rotation * Math.PI) / 180;
    const x = px * u.place.scale;
    const y = py * u.place.scale;
    return [u.place.origin[0] + x * Math.cos(r) - y * Math.sin(r), u.place.origin[1] + x * Math.sin(r) + y * Math.cos(r)];
  }

  private planToUnderlay(u: Underlay, [x, y]: Vec2): Vec2 {
    const r = (-u.place.rotation * Math.PI) / 180;
    const dx = x - u.place.origin[0];
    const dy = y - u.place.origin[1];
    return [(dx * Math.cos(r) - dy * Math.sin(r)) / u.place.scale, (dx * Math.sin(r) + dy * Math.cos(r)) / u.place.scale];
  }

  private saveUnderlay(patch: { place?: Underlay["place"]; opacity?: number }, delay = 0) {
    const u = this._underlay;
    if (!u) return;
    this._underlay = { ...u, ...patch };
    // a robot showing this map on the card: it moves along
    const moved = this._underlay;
    if (patch.place && moved.source && this._model?.robots?.some((r) => r.map?.entity === moved.source)) {
      let m = this._model;
      m.robots!.forEach((r, i) => {
        const map = r.map;
        if (!map || map.entity !== moved.source) return;
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        m = updateRobot(m, i, { map: { ...map, origin: [r3(moved.place.origin[0]), r3(moved.place.origin[1])], scale: Math.round(((moved.place.scale * moved.width) / map.size[0]) * 1e6) / 1e6, rotation: r3(moved.place.rotation) } });
      });
      this.commit(m);
    }
    clearTimeout(this.underlaySaveTimer);
    const send = () =>
      this._hass!.callWS({ type: "homeslice/underlay/set", house: this._house, level: u.level, slot: u.slot, ...patch }).catch((e) => {
        this._error = this.t("editor.save_failed", { message: String((e as { message?: string }).message ?? e) });
      });
    if (delay) this.underlaySaveTimer = window.setTimeout(send, delay);
    else void send();
  }

  private async uploadUnderlay(file: File | Blob, metresPerPixel?: number, source?: string) {
    const level = this._level;
    const current = this._underlay?.level === level ? this._underlay : null;
    // another backdrop: the first free slot; else this one is replaced
    const slot = this._underlayAdding ? [0, 1, 2, 3].find((n) => !this._underlaySlots.includes(n)) : (current?.slot ?? 0);
    if (slot === undefined) return;
    try {
      const image = await shrinkImage(file as File, 2400);
      const { width, height } = await imageSize(image);
      // start by fitting the image to the house's width (a robot's map comes at its own scale)
      const outline = outlineScope(this._model!, level).poly;
      const { min, max } = outline.length ? bbox(outline) : { min: [0, 0] as Vec2, max: [10, 8] as Vec2 };
      const scale = metresPerPixel ?? Math.max(0.001, (max[0] - min[0]) / width);
      const place = { origin: [min[0], min[1]] as Vec2, scale, rotation: 0 };
      await this._hass!.callWS({ type: "homeslice/underlay/set", house: this._house, level, slot, image, place, opacity: 0.5, source: source ?? null });
      this._underlay = { level, slot, image, width, height, place, opacity: 0.5, ...(source ? { source } : {}) };
      this._underlaySlots = [...new Set([...this._underlaySlots, slot])].sort((a, b) => a - b);
      this.underlaySlotOf[level] = slot;
      this.underlayRequest = `${this._house}/${level}#${slot}`;
      this._underlayAdding = false;
      this._underlayHidden = false;
      // first straighten the scan (a robot's map is straight), then set its scale
      if (metresPerPixel) this._calib = {};
      else this._straighten = {};
    } catch (e) {
      this._error = this.t("editor.underlay_failed", { message: String((e as { message?: string }).message ?? e) });
    }
  }

  /** Turns the image so the line a→b (along a wall) runs exactly across or up the plan, then on to the scale. */
  private straightenUnderlay(a: Vec2, b: Vec2) {
    this._straighten = null;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) return;
    const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    this.rotateUnderlay(Math.round(angle / 90) * 90 - angle);
    if (!this._underlay?.place.ruler) this._calib = {};
  }

  private rotateUnderlay(by: number) {
    const u = this._underlay;
    if (!u) return;
    // turn around the image's centre
    const centre = this.underlayToPlan(u, [u.width / 2, u.height / 2]);
    const rotation = (((u.place.rotation + by) % 360) + 360) % 360;
    const r = (rotation * Math.PI) / 180;
    const hx = (u.width / 2) * u.place.scale;
    const hy = (u.height / 2) * u.place.scale;
    const origin: Vec2 = [centre[0] - (hx * Math.cos(r) - hy * Math.sin(r)), centre[1] - (hx * Math.sin(r) + hy * Math.cos(r))];
    this.saveUnderlay({ place: { ...u.place, origin, rotation } });
  }

  private applyCalibration() {
    const u = this._underlay;
    const c = this._calib;
    const d = parseFloat((c?.distance ?? "").replace(",", "."));
    if (!u || !c?.a || !c.b || !(d > 0)) return;
    const px = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
    if (px < 1) return;
    // keep the first point where it is on the plan
    const anchor = this.underlayToPlan(u, c.a);
    const scale = d / px;
    const r = (u.place.rotation * Math.PI) / 180;
    const x = c.a[0] * scale;
    const y = c.a[1] * scale;
    const origin: Vec2 = [anchor[0] - (x * Math.cos(r) - y * Math.sin(r)), anchor[1] - (x * Math.sin(r) + y * Math.cos(r))];
    this.saveUnderlay({ place: { ...u.place, origin, scale, ruler: { a: c.a, b: c.b } } });
    this._calib = null;
    this._rulerHidden = false;
    this._underlayMove = true;
  }

  private renderUnderlay() {
    const u = this._underlay;
    if (!u || u.level !== this._level || this._underlayHidden) return nothing;
    const [sx, sy] = this.toScreen(u.place.origin);
    const k = u.place.scale * this._view.scale;
    const c = this._calib;
    const mark = (p: Vec2 | undefined) => {
      if (!p) return nothing;
      const [x, y] = this.toScreen(this.underlayToPlan(u, p));
      return svg`<circle class="calib-point" cx=${x} cy=${y} r="6"></circle>`;
    };
    const line =
      c?.a && c.b
        ? (() => {
            const [x1, y1] = this.toScreen(this.underlayToPlan(u, c.a!));
            const [x2, y2] = this.toScreen(this.underlayToPlan(u, c.b!));
            return svg`<line class="calib-line" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>`;
          })()
        : nothing;
    // the straightening line: from its first point to the pointer
    const st = this._straighten?.a ? this.toScreen(this._straighten.a) : null;
    const hover = st && this._straighten?.to ? this.toScreen(this._straighten.to) : null;
    return svg`<image class="underlay" href=${u.image} x="0" y="0" width=${u.width} height=${u.height} opacity=${u.opacity}
        transform="translate(${sx} ${sy}) rotate(${u.place.rotation}) scale(${k})" preserveAspectRatio="none"></image>
      ${line}${mark(c?.a)}${mark(c?.b)}${!c && !this._rulerHidden && u.place.ruler ? this.renderRuler(u, u.place.ruler) : nothing}
      ${st ? svg`<circle class="calib-point" cx=${st[0]} cy=${st[1]} r="6"></circle>${hover ? svg`<line class="calib-line" x1=${st[0]} y1=${st[1]} x2=${hover[0]} y2=${hover[1]}></line>` : nothing}` : nothing}`;
  }

  /** The line the scale was set on, with end ticks and its length: a check that the scale still fits. */
  private renderRuler(u: Underlay, r: { a: Vec2; b: Vec2 }) {
    const [x1, y1] = this.toScreen(this.underlayToPlan(u, r.a));
    const [x2, y2] = this.toScreen(this.underlayToPlan(u, r.b));
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 2) return nothing;
    const [nx, ny] = [-(y2 - y1) / len, (x2 - x1) / len];
    const metres = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) * u.place.scale;
    const tick = (x: number, y: number) => svg`<line x1=${x - nx * 7} y1=${y - ny * 7} x2=${x + nx * 7} y2=${y + ny * 7}></line>`;
    return svg`<g class="ruler" data-ruler>
      <line x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>${tick(x1, y1)}${tick(x2, y2)}
      <text x=${(x1 + x2) / 2 + nx * 14} y=${(y1 + y2) / 2 + ny * 14} text-anchor="middle" dominant-baseline="middle">${this.fmtM(metres)}</text>
    </g>`;
  }

  /** Map pictures of robot vacuums: image entities on the same device as a vacuum. */
  private robotMaps(): string[] {
    const hass = this._hass;
    if (!hass?.entities) return [];
    const devices = new Set(Object.values(hass.entities).filter((e) => e.entity_id.startsWith("vacuum.") && e.device_id).map((e) => e.device_id));
    return Object.values(hass.entities)
      .filter((e) => e.entity_id.startsWith("image.") && e.device_id && devices.has(e.device_id) && hass.states[e.entity_id]?.attributes.entity_picture)
      .map((e) => e.entity_id);
  }

  private renderUnderlayInspector() {
    const u = this._underlay?.level === this._level ? this._underlay : null;
    const c = this._calib;
    const fileInput = html`<label class="file">
      <input type="file" accept="image/png,image/jpeg,image/webp" @change=${(e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) void this.uploadUnderlay(f);
        (e.target as HTMLInputElement).value = "";
      }} />
      <span>${u && !this._underlayAdding ? this.t("editor.underlay_replace") : this.t("editor.underlay_upload")}</span>
    </label>`;
    // robot vacuums' maps (image entities of a vacuum's device): true to scale, to trace rooms on
    const maps = this.robotMaps();
    const mapButtons = maps.length
      ? html`<div class="row wrap">
          ${maps.map(
            (id) => html`<button data-robot-map=${id} @click=${async () => {
              const url = this._hass?.states[id]?.attributes.entity_picture as string | undefined;
              if (!url) return;
              // beside the floor plan as another backdrop (this map again: replaced)
              if (u && u.source !== id && this._underlaySlots.length < 4) this._underlayAdding = true;
              const blob = await (await fetch(url)).blob();
              // Roborock draws its maps at 12.5 mm per pixel
              await this.uploadUnderlay(blob, 0.0125, id);
            }}>${this.t("editor.underlay_robot_map", { map: this.entityName(id) })}</button>`,
          )}
        </div>
        <p class="muted">${this.t("editor.underlay_robot_hint")}</p>`
      : nothing;
    // the level's backdrops: the floor plan, a robot's map, … (N switches)
    const slots = this._underlaySlots;
    const backdrops = slots.length
      ? html`<div class="backdrops">
          ${slots.map(
            (n, i) => html`<button class=${u?.slot === n && !this._underlayAdding ? "active" : ""} data-backdrop=${n} @click=${() => {
              this._underlayAdding = false;
              this._underlayHidden = false;
              if (u?.slot !== n) void this.loadUnderlay(n);
            }}>${u?.slot === n ? this.backdropName(u) : String(i + 1)}</button>`,
          )}
          ${slots.length < 4
            ? html`<button data-backdrop-add class=${this._underlayAdding ? "active" : ""} title=${this.t("editor.backdrop_add")} @click=${() => (this._underlayAdding = !this._underlayAdding)}>+ ${this.t("editor.backdrop_add")}</button>`
            : nothing}
        </div>`
      : nothing;
    if (this._underlayAdding)
      return html`<h3>${this.t("editor.underlay")}</h3>${backdrops}<p class="muted">${this.t("editor.backdrop_add_hint")}</p>${fileInput}${mapButtons}`;
    if (!u) return html`<h3>${this.t("editor.underlay")}</h3><p class="muted">${this.t("editor.underlay_hint")}</p>${fileInput}${mapButtons}`;
    return html`<h3>${this.t("editor.underlay")}</h3>
      ${backdrops}
      ${this._straighten
        ? html`<div class="calib">
            <p>${this.t(this._straighten.a ? "editor.straighten_second" : "editor.straighten_first")}</p>
            <button @click=${() => {
              this._straighten = null;
              if (!u.place.ruler) this._calib = {};
            }}>${this.t(u.place.ruler ? "editor.cancel" : "editor.straighten_skip")}</button>
          </div>`
        : c
        ? html`<div class="calib">
            <p>${!c.a ? this.t("editor.calib_first") : !c.b ? this.t("editor.calib_second") : this.t("editor.calib_distance")}</p>
            ${c.a && c.b
              ? html`<div class="row">
                  <label>${this.t("editor.calib_metres")}
                    <input class="calib-distance" inputmode="decimal" .value=${c.distance ?? ""} @input=${(e: Event) => (this._calib = { ...c, distance: (e.target as HTMLInputElement).value })}
                      @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.applyCalibration()} />
                  </label>
                </div>
                <button class="primary" @click=${() => this.applyCalibration()}>${this.t("editor.calib_apply")}</button>`
              : nothing}
            <button @click=${() => (this._calib = null)}>${this.t("editor.cancel")}</button>
          </div>`
        : html`<div class="row">
            <button @click=${() => {
              this._calib = {};
              this._underlayMove = false;
            }}>${this.t("editor.underlay_scale")}</button>
            <button class=${this._underlayMove ? "active" : ""} @click=${() => (this._underlayMove = !this._underlayMove)}>${this.t("editor.underlay_move")}</button>
            <button data-straighten @click=${() => {
              this._straighten = {};
              this._underlayMove = false;
            }}>${this.t("editor.underlay_straighten")}</button>
          </div>
          <div class="row">
            <label>${this.t("editor.underlay_rotation")}
              <input class="underlay-rotation" type="number" step="0.1" .value=${String(Math.round(u.place.rotation * 10) / 10)}
                @change=${(e: Event) => {
                  const v = parseFloat((e.target as HTMLInputElement).value.replace(",", "."));
                  if (Number.isFinite(v)) this.rotateUnderlay(v - u.place.rotation);
                }} />
            </label>
            <button title=${this.t("editor.underlay_rotate_left")} aria-label=${this.t("editor.underlay_rotate_left")} @click=${() => this.rotateUnderlay(-90)}>⟲</button>
            <button title=${this.t("editor.underlay_rotate_right")} aria-label=${this.t("editor.underlay_rotate_right")} @click=${() => this.rotateUnderlay(90)}>⟳</button>
          </div>`}
      <label>${this.t("editor.underlay_opacity")}
        <input type="range" min="0.1" max="1" step="0.05" .value=${String(u.opacity)} @input=${(e: Event) => this.saveUnderlay({ opacity: Number((e.target as HTMLInputElement).value) }, 400)} />
      </label>
      <div class="row">
        <label class="check"><input type="checkbox" .checked=${!this._underlayHidden} @change=${(e: Event) => (this._underlayHidden = !(e.target as HTMLInputElement).checked)} />
          ${this.t("editor.underlay_show")}</label>
        ${u.place.ruler
          ? html`<label class="check"><input type="checkbox" .checked=${!this._rulerHidden} @change=${(e: Event) => (this._rulerHidden = !(e.target as HTMLInputElement).checked)} />
              ${this.t("editor.underlay_ruler")}</label>`
          : nothing}
      </div>
      ${this.renderRobotMapLink(u)}
      <div class="row">
        ${fileInput}
        <button class="danger" @click=${async () => {
          if (!confirm(this.t("editor.underlay_remove_confirm"))) return;
          await this._hass!.callWS({ type: "homeslice/underlay/delete", house: this._house, level: this._level, slot: u.slot });
          this._underlay = null;
          this._calib = null;
          this._underlayMove = false;
          // on to the level's next backdrop, if any
          this.underlayRequest = "";
          void this.loadUnderlay();
        }}>${this.t("editor.underlay_remove")}</button>
      </div>
      ${mapButtons}`;
  }

  /** The robot's room names by room number, for the map picture `image` (Roborock: `roborock.get_maps`). */
  private async robotRoomNames(image: string): Promise<Record<number, string>> {
    const hass = this._hass!;
    if (!hass.services?.roborock?.get_maps) return {};
    const device = hass.entities?.[image]?.device_id;
    const vacuum = Object.values(hass.entities ?? {}).find((e) => e.entity_id.startsWith("vacuum.") && e.device_id === device)?.entity_id;
    if (!vacuum) return {};
    try {
      const res = (await hass.callService("roborock", "get_maps", {}, { entity_id: vacuum }, false, true)) as { response?: Record<string, { maps?: { name?: string; rooms?: Record<string, string> }[] }> };
      const maps = res?.response?.[vacuum]?.maps ?? [];
      // the robot's map whose name is most like the picture's own name, else the only one
      const own = this.startMaps().find((m) => m.id === image)?.own ?? this.entityName(image);
      const map = bestMatch(own, maps, (x) => x.name ?? "", 0.5) ?? (maps.length === 1 ? maps[0] : undefined);
      return Object.fromEntries(Object.entries(map?.rooms ?? {}).map(([n, name]) => [Number(n), name]));
    } catch {
      return {};
    }
  }

  private previewTouched = false;
  private previewDrag: Vec2 | null = null;

  private onPreviewDown(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.previewDrag = [e.clientX, e.clientY];
  }

  private onPreviewMove(e: PointerEvent) {
    if (!this.previewDrag || !this.renderer) return;
    this.renderer.orbit(-(e.clientX - this.previewDrag[0]) * 0.35, (e.clientY - this.previewDrag[1]) * 0.25);
    this.previewDrag = [e.clientX, e.clientY];
    this.previewTouched = true;
  }

  private onPreviewWheel(e: WheelEvent) {
    e.preventDefault();
    this.renderer?.zoomBy(Math.exp(-e.deltaY * 0.0015));
    this.previewTouched = true;
  }

  // ----- rendering -----

  private issues(): Issue[] {
    if (!this._model) return [];
    const { house, issues } = expandHouse(this._model);
    if (!house) return issues;
    const walls = new Map(house.levels.map((l) => [l.id, deriveWalls(l, house.walls, issues)]));
    const name = (levelId: string, roomId: string) => {
      const r = this._model!.levels.find((l) => l.id === levelId)?.rooms.find((x) => x.id === roomId);
      return r ? this.roomName(r) : roomId;
    };
    return [...issues, ...misalignedWalls(house, walls, name)];
  }

  protected override render() {
    // no house yet: where to start (once the houses are known)
    if (this._start || (!this._model && !this._create && this._hass && !this._houses.length && this.housesLoaded && !this._error))
      return html`<div class="empty start-wrap">${this.renderStart(this._start ?? this.newStart(false))}</div>`;
    if (this._create) return html`<div class="empty">${this._error ? html`<div class="error">${this._error}</div>` : nothing}${this.renderCreate()}</div>`;
    if (!this._model) {
      return html`<div class="empty">
        ${this._error || (this._houses.length || !this._hass ? this.t("card.loading") : html`<p>${this.t("editor.no_houses")}</p>
          <button class="primary" @click=${() => this.startCreate()}>${this.t("editor.new_house")}</button>`)}
      </div>`;
    }
    const levels = [...this._model.levels].reverse();
    const issues = this.issues();
    return html`
      <header>
        <ha-menu-button .hass=${this._hass} .narrow=${this.narrow}></ha-menu-button>
        <h1>Homeslice</h1>
        <select class="house" aria-label=${this.t("editor.house")} @change=${(e: Event) => {
          const sel = e.target as HTMLSelectElement;
          if (sel.value === "__new__") {
            sel.value = this._house;
            this.startCreate();
          } else void this.openHouse(sel.value);
        }}>
          ${this._houses.map((h) => html`<option value=${h.id} ?selected=${h.id === this._house}>${h.name}</option>`)}
          <option value="__new__">${this.t("editor.new_house")}…</option>
        </select>
        <button class="icon" title=${this.t("editor.new_house")} aria-label=${this.t("editor.new_house")} @click=${() => this.startCreate()}>+</button>
        <button class="icon" data-palette-open title=${this.t("editor.search_hint")} aria-label=${this.t("editor.search")} @click=${() => (this._palette = { q: "", i: 0 })}><ha-icon icon="mdi:magnify"></ha-icon></button>
        <button class="icon" title=${this.t("editor.shortcuts")} aria-label=${this.t("editor.shortcuts")} @click=${() => (this._shortcuts = !this._shortcuts)}>?</button>
        <button class="icon ${this._settings ? "active" : ""}" title=${this.t("editor.house_settings")} aria-label=${this.t("editor.house_settings")}
          @click=${() => (this._settings = this._settings ? null : {})}>⚙</button>
        ${(() => {
          const open = this.checks().length;
          return html`<button class="icon checklist-button ${this._checklist ? "active" : ""}" title=${this.t("editor.checklist")} aria-label=${this.t("editor.checklist")}
            @click=${() => {
              this._checklist = !this._checklist;
              this._settings = null;
            }}>✓${open ? html`<span class="badge">${open}</span>` : nothing}</button>`;
        })()}
        <span class="spacer"></span>
        ${Object.entries(this._startKept.watches).map(
          ([floor, w]) => html`<button class="mapping-chip" data-mapping=${floor} @click=${async () => {
            // back to the start, where it was left
            const kept = await this.loadStart();
            this._start = { ...this.newStart(false), ...(kept?.state ?? {}), open: "trace", capture: { floor, map: w.map }, busy: false, note: "", problems: [], copied: false } as StartState;
          }}><ha-icon icon="mdi:radar"></ha-icon>${this.t("editor.header_mapping", { robot: this.entityName(w.robot ?? w.map), floor: this._hass?.floors?.[floor]?.name ?? floor })}</button>`,
        )}
        <span class="spacer"></span>
        <button class="icon" title=${this.t("editor.undo")} aria-label=${this.t("editor.undo")} ?disabled=${!this.history.canUndo} @click=${() => this.undo()}>↶</button>
        <button class="icon" title=${this.t("editor.redo")} aria-label=${this.t("editor.redo")} ?disabled=${!this.history.canRedo} @click=${() => this.redo()}>↷</button>
        <button class="save ${this.dirty ? "dirty" : ""}" ?disabled=${!this.dirty} @click=${() => this.save()}>
          ${this.dirty ? this.t("editor.save") : this.t("editor.saved")}
        </button>
      </header>
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      ${this._shortcuts ? this.renderShortcuts() : nothing}
      ${this._palette ? this.renderPalette(this._palette) : nothing}
      ${this._draft
        ? html`<div class="draft">
            <span>${this.t(this._draft.stale ? "editor.draft_stale" : "editor.draft", { time: new Date(this._draft.time).toLocaleString(this._hass?.locale?.language) })}</span>
            <button class="primary" @click=${() => {
              this.commit(this._draft!.model);
              this._draft = null;
            }}>${this.t("editor.draft_restore")}</button>
            <button @click=${() => {
              writeDraft(this._house, null);
              this._draft = null;
            }}>${this.t("editor.draft_discard")}</button>
          </div>`
        : nothing}
      <main>
        <aside class="tools">
          ${TOOLS.filter((t) => !t.group || t.tool === this.groupTool(t.group)).map(({ tool, icon, group }) => {
            const active = group ? TOOLS.some((t) => t.group === group && t.tool === this._tool) : this._tool === tool;
            const label = this.t((group ? `editor.group_${group}` : `editor.tool_${tool}`) as StringKey);
            const menu = !!group || tool === "furniture";
            return html`<button class="tool ${active ? "active" : ""} ${menu ? "group" : ""}" data-tool=${tool} data-group=${group ?? nothing} title=${label}
              aria-label=${label} aria-pressed=${active} aria-haspopup=${menu ? "true" : nothing} aria-expanded=${menu ? this._flyout === (group ?? tool) : nothing}
              @click=${(e: Event) => {
                const open = this._flyout === (group ?? tool);
                this.setTool(tool);
                // a group, or the furniture's sources: its choices beside the button (a second click closes them)
                if (menu && !open) this.openFlyout(group ?? tool, e.currentTarget as HTMLElement);
              }}>
              <ha-icon icon=${icon}></ha-icon>
            </button>`;
          })}
          <span class="divider" role="separator"></span>
          ${LAYERS.map(
            ({ layer, icon }) => html`<button class="layer ${this._show[layer] ? "active" : ""}" data-layer=${layer} title=${this.t(`editor.show_${layer}` as StringKey)}
              aria-label=${this.t(`editor.show_${layer}` as StringKey)} aria-pressed=${this._show[layer]} @click=${() => this.toggleLayer(layer)}>
              <ha-icon icon=${icon}></ha-icon>
            </button>`,
          )}
          <button title=${this.t("editor.fit")} aria-label=${this.t("editor.fit")} @click=${() => this.fitView()}>
            <ha-icon icon="mdi:fit-to-screen-outline"></ha-icon>
          </button>
        </aside>
        <aside class="levels" aria-label=${this.t("editor.levels")}>
          ${levels.map((l, i) => {
            const d = this._levelDrag;
            let shift = 0;
            if (d && d.moved && l.id !== d.id) {
              // the others slide aside to make room for the dragged level
              if (d.from < i && i <= d.over) shift = -d.step;
              if (d.over <= i && i < d.from) shift = d.step;
            }
            const dragging = d?.moved && l.id === d.id;
            return html`<button
              class="level ${l.id === this._level ? "active" : ""} ${dragging ? "dragging" : ""}"
              style=${dragging ? `transform: translateY(${d!.dy}px); transition: none` : `transform: translateY(${shift}px)`}
              title=${this.t("editor.level_drag")}
              @pointerdown=${(e: PointerEvent) => this.onLevelDown(e, l.id, i)}
              @pointermove=${(e: PointerEvent) => this.onLevelMove(e, levels.length)}
              @pointerup=${() => this.onLevelUp(l.id, levels.length)}
              @pointercancel=${() => (this._levelDrag = null)}
              @keydown=${(e: KeyboardEvent) => this.onLevelKey(e, l.id)}
            >
              <ha-icon icon="mdi:drag-vertical"></ha-icon>
              <span>${this.levelName(l)}</span>
            </button>`;
          })}
          <button class="add-level" title=${this.t("editor.add_level_above")} @click=${() => this.addLevelAt(this._model!.levels.filter((l) => l.kind !== "roof").length)}>+ ${this.t("editor.add_level")}</button>
          ${this._model!.levels.some((l) => l.kind === "roof")
            ? nothing
            : html`<button class="add-level" data-add-roof title=${this.t("editor.roof_level_add_hint")} @click=${() => this.addRoofLevelOnTop()}>+ ${this.t("editor.add_roof")}</button>`}
        </aside>
        <section class="plan-wrap">
          ${this.renderPlan()}
          ${this.renderCompass()}
          ${this._underlaySlots.length > 1 && this._underlay?.level === this._level
            ? html`<button class="backdrop-cycle" data-backdrop-cycle title=${this.t("editor.backdrop_next")} @click=${() => this.cycleUnderlay()}>
                <ha-icon icon="mdi:layers-triple-outline"></ha-icon>${this.backdropName(this._underlay)}
                <span class="muted">${this._underlaySlots.indexOf(this._underlay.slot) + 1}/${this._underlaySlots.length}</span></button>`
            : nothing}
          ${this.renderWallView()}
          ${this.renderLoupe()}
          ${this._hint
            ? html`<div class="hint" style="left:${this._hint.x + 16}px;top:${this._hint.y + 16}px">${this._hint.lines.map((l) => html`<div>${l}</div>`)}</div>`
            : nothing}
          <div class="plan-top">${this._startNext
              ? html`<div class="start-next" role="status" data-start-next><ha-icon icon="mdi:flag-checkered"></ha-icon><span>${this._startNext}</span>
                  <button class="close" aria-label=${this.t("editor.hint_hide")} @click=${() => (this._startNext = null)}>×</button></div>`
              : nothing}${this.renderHint()}</div>
          ${this.renderTour()}
          ${this._tip && this._tour === null
            ? html`<div class="start-next tip" role="status" data-tip><ha-icon icon="mdi:lightbulb-on-outline"></ha-icon><span>${this._tip}</span>
                <button class="close" aria-label=${this.t("editor.hint_hide")} @click=${() => (this._tip = null)}>×</button></div>`
            : nothing}
        </section>
        ${this.renderFlyout()}
        <div class="side-handle" role="separator" aria-orientation="vertical" aria-label=${this.t("editor.side_resize")} title=${this.t("editor.side_resize")}
          @pointerdown=${this.onSideDown} @pointermove=${this.onSideMove} @pointerup=${this.onSideUp} @pointercancel=${this.onSideUp}
          @dblclick=${() => {
            this._sideWidth = null;
            writePref("homeslice-side-width", "");
            this.updateComplete.then(() => this.updatePreview());
          }}></div>
        <section class="side" style=${this._sideWidth ? `width:${this._sideWidth}px` : ""}>
          <canvas
            class="preview"
            @pointerdown=${this.onPreviewDown}
            @pointermove=${this.onPreviewMove}
            @pointerup=${() => (this.previewDrag = null)}
            @wheel=${this.onPreviewWheel}
          ></canvas>
          <div class="inspector">${this.renderInspector()}</div>
          ${issues.length
            ? html`<details class="issues" open>
                <summary>${this.t("card.issues", { count: issues.length })}</summary>
                <ul>${issues.map((i) => html`<li class=${i.severity}><code>${i.path}</code> ${i.message}</li>`)}</ul>
              </details>`
            : nothing}
        </section>
      </main>
    `;
  }

  /**
   * Where real north is: the plan's top need not face north. The needle turns with the
   * house's `north`; a click opens the building settings to set it.
   */
  private renderCompass() {
    const north = this._model?.north ?? 0;
    return html`<button class="compass" title=${this.t("editor.compass", { deg: this.n(north) })} aria-label=${this.t("editor.compass", { deg: this.n(north) })} @click=${() => {
        this.clearSelection();
        this._room = OUTLINE;
      }}>
      <svg viewBox="-20 -20 40 40" aria-hidden="true">
        <circle r="18"></circle>
        <g style="transform: rotate(${-north}deg)">
          <path class="n" d="M 0 -15 L 5 0 L -5 0 Z"></path>
          <path class="s" d="M 0 15 L 5 0 L -5 0 Z"></path>
          <text y="-7.5" dy="-9">N</text>
        </g>
      </svg>
    </button>`;
  }

  /** The outside walls of the floors below and above, dashed, where they differ from this floor's (dragging snaps to them). */
  private renderNeighbourOutlines(pts: (poly: Vec2[]) => string) {
    const m = this._model!;
    const idx = m.levels.findIndex((l) => l.id === this._level);
    // (the level just deleted, for a moment)
    if (idx < 0) return nothing;
    const own = JSON.stringify(outlineScope(m, this._level).poly);
    return [m.levels[idx - 1], m.levels[idx + 1]].map((x, i) => {
      if (!x) return nothing;
      const poly = outlineScope(m, x.id).poly;
      if (poly.length < 3 || JSON.stringify(poly) === own) return nothing;
      return svg`<polygon class="ghost-outline ${i ? "above" : "below"}" data-ghost-outline=${x.id} points=${pts(poly)}><title>${this.levelName(x)}</title></polygon>`;
    });
  }

  private renderPlan() {
    const m = this._model!;
    const idx = m.levels.findIndex((l) => l.id === this._level);
    const below = m.levels[idx - 1];
    const l = m.levels[idx];
    const pts = (poly: Vec2[]) => poly.map((p) => this.toScreen(p).join(",")).join(" ");
    const { house } = expandHouse(m);
    const level = house?.levels.find((x) => x.id === this._level);
    const walls = level && house ? deriveWalls(level, house.walls, []) : [];
    const selected = l?.rooms.find((r) => r.id === this._room);
    const selPoly = this._room === OUTLINE ? outlineScope(m, this._level).poly : selected ? roomPolygon(m, selected) : [];
    const grid = this._view.scale >= 20 ? 1 : 5;
    this.dimTargets.clear();
    // also shown magnified around the finger on touch screens
    // rooms without an area (filled in while drawing the labels), badged at the end
    const unassignedAt: [string, Vec2][] = [];
    const content = svg`      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead"></path>
        </marker>
        <pattern id="grid" width=${grid * this._view.scale} height=${grid * this._view.scale} patternUnits="userSpaceOnUse" x=${this._view.ox} y=${this._view.oy}>
          <path d="M ${grid * this._view.scale} 0 L 0 0 0 ${grid * this._view.scale}" fill="none" class="gridline"></path>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)"></rect>
      ${this.renderUnderlay()}
      ${below && this._show.below ? below.rooms.map((r) => svg`<polygon class="ghost" points=${pts(roomPolygon(m, r))}></polygon>`) : nothing}
      ${this._show.below ? this.renderNeighbourOutlines(pts) : nothing}
      ${l?.kind === "roof" ? this.renderRoofParts(l, pts) : nothing}
      ${[...(l?.rooms ?? [])]
        // a room inside another is drawn over it
        .sort((a, b) => Math.abs(signedArea(roomPolygon(m, b))) - Math.abs(signedArea(roomPolygon(m, a))))
        .map((r) => {
        const poly = this.inner(r, walls);
        return svg`<g data-room=${r.id}>
          <polygon class="room ${r.kind ?? "room"} ${r.id === this._room ? "selected" : ""}" points=${pts(poly)} fill=${planColor(r.floor ?? (r.kind === "outdoor" ? "lawn" : "wood"))}></polygon>
        </g>`;
      })}
      ${[...walls]
        // inner walls first, so their ends disappear under the outer walls
        .sort((a, b) => Number(a.type === "exterior" || a.type === "party") - Number(b.type === "exterior" || b.type === "party"))
        .map((w) => this.renderWall(w))}
      ${l?.rooms.map((r) => {
        const lamps = this.levelLamps();
        // names on top of the walls, so long ones aren't cut off
        const poly = this.inner(r, walls);
        const at = this.toScreen(labelPoint(poly));
        // the name, broken into lines that fit, and the area: centred on the room, or below
        // a lamp drawn at its centre
        const { min, max } = bbox(poly);
        // no Home Assistant area: the badge says so, in place of the name unless one was typed
        const unassigned = !r.area_id && r.kind !== "void";
        const lines = unassigned && !r.name ? [] : wrapWords(this.roomName(r), ((max[0] - min[0]) * this._view.scale * 0.9) / 7.2);
        const centre = labelPoint(poly);
        const lampThere = this._show.lights && lamps.some((x) => x.roomId === r.id && Math.hypot(x.at[0] - centre[0], x.at[1] - centre[1]) * this._view.scale < 18);
        const badge = unassigned ? 26 : 0;
        const height = lines.length * 14 + 13 + badge;
        const top = lampThere ? at[1] + 16 : at[1] - height / 2;
        if (unassigned) unassignedAt.push([r.id, [at[0], top + lines.length * 14 + 11]]);
        return svg`<g class="room-label">
          <text class="room-name" x=${at[0]} y=${top + 11} text-anchor="middle">${lines.map((line, i) => svg`<tspan x=${at[0]} dy=${i ? 14 : 0}>${line}</tspan>`)}</text>
          <text class="room-area" x=${at[0]} y=${top + lines.length * 14 + badge + 10} text-anchor="middle">${this.n(area(poly) - (l?.rooms ?? []).filter((x) => x !== r && within(roomPolygon(m, x), roomPolygon(m, r))).reduce((n, x) => n + Math.abs(signedArea(roomPolygon(m, x))), 0), 1)} m²</text></g>
`;
      })}
      ${this.freeShapes().map((f) => svg`<g class="free-shape"><polygon points=${pts(f.poly)}></polygon></g>`)}
      ${(house?.vertical ?? [])
        // the hole where a stair arrives; where a flight starts, its footprint and the way up
        .filter((v) => idx >= v.from && idx <= v.to)
        .map((v) => {
          const sel = v.id === this._stair;
          const flight = v.kind === "stairs" && idx < v.to;
          return svg`<g data-stair=${v.id} class="stair ${sel ? "selected" : ""}">
            ${idx > v.from ? svg`<polygon class="stairwell" points=${pts(stairHoleOn(v, house!.vertical, idx))}></polygon>` : nothing}
            <polygon class="stair-hit" points=${pts(v.polygon)}></polygon>
            ${flight ? stairTreads(v, house!.levels[idx].height).map((t) => svg`<polygon class="stair-step" points=${pts(t.poly)}></polygon>`) : nothing}
            ${flight ? svg`<polyline class="stair-path" marker-end="url(#arrow)" points=${pts(stairPath(v))}></polyline>` : nothing}
          </g>`;
        })}
      ${this._show.dims && l ? this.renderRoomDims(l.rooms, walls) : nothing}
      ${this._show.dims && l ? this.renderOverallDims() : nothing}
      ${level ? this.renderFreeWalls(level.freeWalls, level.railings ?? []) : nothing}
      ${this._stair ? this.renderStairHandles() : nothing}
      ${this._show.furniture ? this.renderFurniture() : nothing}
      ${this._show.lights ? this.renderLamps() : nothing}
      ${this.renderCameras()}
      ${this._show.devices ? this.renderEnergyLinks() : nothing}
      ${this._show.devices ? this.renderEnergyMarkers() : nothing}
      ${this._show.devices ? this.renderRobotMarkers() : nothing}
      ${selPoly.length && this._tool !== "opening" ? this.renderHandles(selPoly, selected ? this.inner(selected, walls) : selPoly) : nothing}
      ${this._rectPreview ? svg`<polygon class="rect-preview" points=${pts(this._rectPreview)}></polygon>` : nothing}
      ${this.renderArriving()}
      ${
        // rooms and shapes without an area: on top of everything, so their button can be pressed
        [...unassignedAt.map(([id, at]) => this.renderUnassignedBadge(at, id)), ...this.freeShapes().map((f) => this.renderUnassignedBadge(this.toScreen(labelPoint(f.poly)), f.host ? `shape:${f.host.room}` : "shape"))]
      }
      ${this.renderAssignHover()}
      ${this._linePreview ? svg`<polyline class="line-preview ${this._tool === "divide" ? "divide" : ""}" points=${pts(this._linePreview)}></polyline>` : nothing}
      ${this._opening ? this.renderOpeningDims(walls) : nothing}
      ${this._measure ? this.renderMeasure(this._measure) : nothing}
      ${this.renderSections()}
      ${this.renderGuides()}
      ${this._dimEdit ? this.renderDimEdit(this._dimEdit) : nothing}`;
    this._planContent = content;
    return html`<svg
      class="plan tool-${this._tool} ${this._underlayMove ? "underlay-move" : ""} ${this._underlay?.level === this._level && !this._underlayHidden ? "has-underlay" : ""}"
      @pointerdown=${this.onPlanDown}
      @pointermove=${this.onPlanMove}
      @pointerleave=${() => (this._planPointer = null)}
      @pointerup=${this.onPlanUp}
      @pointercancel=${this.onPlanUp}
      @dblclick=${this.onPlanDoubleClick}
      @wheel=${this.onPlanWheel}
      @dragover=${(e: DragEvent) => {
        if (this.assignDrag) {
          // the shape the area would go to lights up
          e.preventDefault();
          const t = this.assignTarget(this.eventWorld(e as unknown as PointerEvent));
          if (e.dataTransfer) e.dataTransfer.dropEffect = t ? "link" : "none";
          const key = t ? `${t.room ?? ""}:${JSON.stringify(t.poly[0])}` : "";
          const was = this._assignHover ? `${this._assignHover.room ?? ""}:${JSON.stringify(this._assignHover.poly[0])}` : "";
          if (key !== was) this._assignHover = t ? { ...t, area: this.assignDrag } : null;
          return;
        }
        if (!this.libraryDrag && !this.openingDrag) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }}
      @dragleave=${(e: DragEvent) => {
        if (this.assignDrag && !(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) this._assignHover = null;
      }}
      @drop=${(e: DragEvent) => {
        if (this.assignDrag) {
          e.preventDefault();
          const area = this.assignDrag;
          this.assignDrag = null;
          this.assignAt(area, this.eventWorld(e as unknown as PointerEvent));
          return;
        }
        const preset = this.openingDrag;
        this.openingDrag = null;
        if (preset) {
          // dropped on a wall: a door or window right there
          e.preventDefault();
          // the wall under the drop, also beneath doors and windows already there
          const wall = ((this.renderRoot as ShadowRoot).elementsFromPoint(e.clientX, e.clientY).find((el) => el.closest("[data-addwall]"))?.closest("[data-addwall]") ?? null) as SVGElement | null;
          if (wall) {
            this.clearSelection();
            this.addOpeningAt(JSON.parse(wall.dataset.addwall!), this.eventWorld(e as unknown as PointerEvent), preset);
          }
          return;
        }
        const item = this.libraryDrag;
        this.libraryDrag = null;
        if (!item) return;
        e.preventDefault();
        void this.addFurnitureAt(item, this.eventWorld(e as unknown as PointerEvent));
      }}
    >${content}</svg>`;
  }

  /** Lamps on this level: placed ones and the area lights spread automatically. */
  private levelLamps(): PlacedLight[] {
    const m = this._model;
    if (!m) return [];
    const { house } = expandHouse(m);
    const level = house?.levels.find((l) => l.id === this._level);
    if (!house || !level) return [];
    const walls = deriveWalls(level, house.walls, []);
    const listed = listedLights(house);
    const hass = this._hass;
    const lit = areaLightRooms(level.rooms);
    return level.rooms
      .filter((r) => r.kind !== "void")
      .flatMap((r) =>
        placeLights(level.id, r, r.kind === "room" ? innerPolygon(r.polygon, walls) : r.polygon, r.areaId && hass && lit.has(r.id) ? areaEntities(hass, r.areaId, "light") : [], listed),
      );
  }

  private entityName(id: string) {
    return (this._hass?.states[id]?.attributes.friendly_name as string | undefined) ?? id;
  }

  private renderLamps() {
    // a piece's light is moved with the piece
    return svg`${this.levelLamps().filter((l) => !l.piece).map((l) => {
      const [x, y] = this.toScreen(l.at);
      const on = this._hass?.states[l.entity]?.state === "on";
      const sel = this._room === l.roomId;
      // a strip's line and far end, a row's further spots: each dragged on its own
      const part = (p: Vec2, which: number | "to") => {
        const [px, py] = this.toScreen(p);
        return svg`<circle class="lamp-part ${on ? "on" : ""}" cx=${px} cy=${py} r="6" data-light=${JSON.stringify({ entity: l.entity, room: l.roomId, part: which })}><title>${this.entityName(l.entity)}</title></circle>`;
      };
      const extra =
        l.type === "strip" && l.to
          ? svg`<line class="lamp-strip ${on ? "on" : ""}" x1=${x} y1=${y} x2=${this.toScreen(l.to)[0]} y2=${this.toScreen(l.to)[1]}></line>${part(l.to, "to")}`
          : l.type === "spot"
            ? svg`${l.spots.map((p, i) => part(p, i))}`
            : nothing;
      return svg`${extra}<g class="lamp-marker ${l.auto ? "auto" : "placed"} ${on ? "on" : ""} ${sel ? "selected" : ""}" data-light=${JSON.stringify({ entity: l.entity, room: l.roomId })}>
        <circle cx=${x} cy=${y} r="10"></circle>
        <path d="M ${x - 3.5} ${y + 5} h 7 M ${x - 2.5} ${y + 7.5} h 5" class="base"></path>
        <circle cx=${x} cy=${y - 1.5} r="4.5" class="bulb"></circle>
        <title>${this.entityName(l.entity)}${l.auto ? ` (${this.t("editor.light_auto")})` : ""}</title>
      </g>`;
    })}`;
  }

  /** Cameras on the plan: what each sees as a fan, the camera itself to drag. */
  private renderCameras() {
    const m = this._model;
    const level = this.levelInput;
    if (!m || !level) return nothing;
    return svg`${level.rooms.flatMap((r) =>
      (r.cameras ?? []).map((c, index) => {
        const { min } = bbox(roomPolygon(m, r));
        const at: Vec2 = [min[0] + c.at[0], min[1] + c.at[1]];
        const a = ((c.direction ?? 180) * Math.PI) / 180;
        const fov = (Math.min(c.fov ?? 90, 359) * Math.PI) / 180;
        const range = c.range ?? 5;
        const edge = (k: number): Vec2 => [at[0] + Math.sin(a + k) * range, at[1] - Math.cos(a + k) * range];
        const arc = Array.from({ length: 17 }, (_, i) => this.toScreen(edge(-fov / 2 + (fov * i) / 16)));
        const [x, y] = this.toScreen(at);
        return svg`<g class="camera-marker ${this._room === r.id ? "selected" : ""}">
          <polygon class="camera-view" points=${[[x, y], ...arc].map((p) => p.join(",")).join(" ")}></polygon>
          <g data-camera=${JSON.stringify({ room: r.id, index })} transform="translate(${x} ${y}) rotate(${(c.direction ?? 180) - 90})">
            <rect x="-9" y="-6" width="16" height="12" rx="3"></rect>
            <circle cx="9" cy="0" r="3.5"></circle>
            <title>${this.entityName(c.entity)}</title>
          </g>
        </g>`;
      }),
    )}`;
  }

  /** While a robot with a position service is selected: ask it every 1.5 s, show the answer. */
  private pollRobotHere(entity: string, service: string) {
    if (this.robotPolledAt && Date.now() - this.robotPolledAt < 1500) return;
    this.robotPolledAt = Date.now();
    void pollPosition(this._hass!, entity, service).then(() => {
      if (this._robotSel !== null) window.setTimeout(() => this.requestUpdate(), 1500);
    });
  }

  private furnitureCentre(roomId: string, index: number): Vec2 | null {
    const r = this.levelInput?.rooms.find((x) => x.id === roomId);
    const f = r?.furniture?.[index];
    if (!r || !f) return null;
    const { min } = bbox(roomPolygon(this._model!, r));
    return [min[0] + f.at[0], min[1] + f.at[1]];
  }

  private rotateFurniture(by: number) {
    const sel = this._furn;
    const f = sel && this.levelInput?.rooms.find((x) => x.id === sel.room)?.furniture?.[sel.index];
    if (!sel || !f) return;
    this.commit(updateFurniture(this._model!, this._level, sel.room, sel.index, { rotation: (f.rotation ?? 0) + by }));
  }

  /** Furniture on the plan: the piece seen from above at its size, an arrow at its front, its name and size when selected. */
  private renderFurniture() {
    const m = this._model!;
    return svg`${(this.levelInput?.rooms ?? []).flatMap((r) => {
      const { min } = bbox(roomPolygon(m, r));
      return (r.furniture ?? []).map((f, i) => {
        const [w, d] = f.size ?? FURNITURE[f.type]?.size ?? [1, 1];
        const [cx, cy] = this.toScreen([min[0] + f.at[0], min[1] + f.at[1]]);
        const k = this._view.scale;
        const sel = this._furn?.room === r.id && this._furn.index === i;
        const label = `${this.t(`furniture.${f.type}` as StringKey)} · ${this.n(w)} × ${this.n(d)} m`;
        return svg`<g class="furniture mount-${mountOf(f)} editable ${sel ? "selected" : ""}" data-furniture=${JSON.stringify({ room: r.id, index: i })}
            transform="translate(${cx} ${cy}) rotate(${f.rotation ?? 0})">
          <image href=${planPicture(f)} x=${(-w * k) / 2} y=${(-d * k) / 2} width=${w * k} height=${d * k} preserveAspectRatio="none"
            transform=${f.mirror ? "scale(-1 1)" : ""}></image>
          <rect x=${(-w * k) / 2} y=${(-d * k) / 2} width=${w * k} height=${d * k} rx="2"><title>${label}</title></rect>
          ${this.frontArrow(w * k, d * k)}
        </g>
        ${sel ? svg`<text class="furniture-label" x=${cx} y=${cy + (Math.max(w, d) * k) / 2 + 16} text-anchor="middle">${label}</text>` : nothing}`;
      });
    })}`;
  }

  /** A small arrow at a piece's front edge (south before it is turned: its back is to the north), pointing out. */
  private frontArrow(w: number, d: number) {
    const a = Math.min(7, w / 4, d / 4);
    if (a < 2.5) return nothing;
    const y = d / 2;
    return svg`<path class="front" d="M ${-a} ${y - a} L 0 ${y} L ${a} ${y - a}"></path>`;
  }

  private renderFurnitureInspector(sel: { room: string; index: number }) {
    const m = this._model!;
    const r = this.levelInput?.rooms.find((x) => x.id === sel.room);
    const f = r?.furniture?.[sel.index];
    if (!r || !f) return nothing;
    const set = (patch: Partial<FurnitureInput>) => this.commit(updateFurniture(m, this._level, r.id, sel.index, patch));
    const [w, d] = f.size ?? FURNITURE[f.type].size;
    // the built-in piece it is drawn as: named, or the type's own when it names none
    const named = f.model?.startsWith("modern:") ? f.model.slice(7) : f.model ? undefined : defaultKind(f.type, mountOf(f));
    // an older name (kitchen_drawers) is a piece with options (kitchen_base, fronts: drawers_3)
    const resolved = named ? resolveKind(named, f.options) : undefined;
    const kindId = resolved?.id;
    const kind = kindId ? MODERN[kindId] : undefined;
    const size = (axis: 0 | 1) => (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (!(v > 0.05)) return;
      const next: [number, number] = axis === 0 ? [v, d] : [w, v];
      const def = FURNITURE[f.type].size;
      set({ size: next[0] === def[0] && next[1] === def[1] ? undefined : next });
    };
    return html`<h2>${this.t(`furniture.${f.type}` as StringKey)}</h2>
      <p class="muted">${this.roomName(r)} · ${this.t("editor.furniture_drag")}</p>
      <label>${this.t("editor.furniture_type")}
        <select @change=${(e: Event) => set({ type: (e.target as HTMLSelectElement).value as FurnitureType, size: undefined })}>
          ${FURNITURE_TYPES.map((t) => html`<option value=${t} ?selected=${t === f.type}>${this.t(`furniture.${t}` as StringKey)}</option>`)}
        </select>
      </label>
      <div class="row">
        <label>${this.t("editor.furniture_width")}<input type="number" min="0.1" step="0.05" .value=${String(w)} @change=${size(0)} /></label>
        <label>${this.t("editor.furniture_depth")}<input type="number" min="0.1" step="0.05" .value=${String(d)} @change=${size(1)} /></label>
        <label>${this.t("editor.furniture_height")}<input type="number" min="0.02" step="0.05" .value=${String(f.height ?? FURNITURE[f.type].height)} @change=${(e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (v > 0) set({ height: v === FURNITURE[f.type].height ? undefined : v });
        }} /></label>
      </div>
      ${kind?.widths
        ? html`<div class="widths" role="radiogroup" aria-label=${this.t("editor.furniture_widths")}>
            <span class="muted">${this.t("editor.furniture_widths")}</span>
            ${kind.widths.map((x) => {
              const on = Math.abs(w - x) < 0.001;
              return html`<button role="radio" class=${on ? "active" : ""} aria-checked=${on} data-width=${x}
                @click=${() => {
                  const def = FURNITURE[f.type].size;
                  set({ size: x === def[0] && d === def[1] ? undefined : [x, d] });
                }}>${Math.round(x * 100)}</button>`;
            })}
          </div>`
        : nothing}
      ${Object.entries(kind?.options ?? {}).map(([key, values]) => {
        const have = resolved?.options ?? {};
        const current = have[key] && values.includes(have[key]) ? have[key] : values[0];
        return html`<div class="choices" role="radiogroup" aria-label=${this.t(`option.${key}` as StringKey)} data-option=${key}>
          <span class="muted">${this.t(`option.${key}` as StringKey)}</span>
          ${values.map(
            (x, i) => html`<button role="radio" class=${current === x ? "active" : ""} aria-checked=${current === x} data-value=${x}
              @click=${() => {
                // the first is the piece's own: no need to write it down
                const next = { ...have };
                if (i === 0) delete next[key];
                else next[key] = x;
                // an older name is written as the piece it is now
                set({ options: Object.keys(next).length ? next : undefined, ...(named !== kindId && f.model ? { model: `modern:${kindId}` } : {}) });
              }}>${this.t(`option.${key}_${x}` as StringKey)}</button>`,
          )}
        </div>`;
      })}
      ${f.model ? html`<p class="muted">${this.t("editor.furniture_model")}: ${this.modelName(f.model)}</p>` : nothing}
      ${kind
        ? html`<div class="finishes" role="radiogroup" aria-label=${this.t("editor.furniture_finish")}>
            <span class="muted">${this.t("editor.furniture_finish")}</span>
            ${kind.finishes.map(
              (x, i) => html`<button role="radio" class="swatch ${(f.finish ?? kind.finishes[0]) === x ? "active" : ""}" aria-checked=${(f.finish ?? kind.finishes[0]) === x}
                title=${this.t(`finish.${x}` as StringKey)} data-finish=${x} style="--swatch:${FINISHES[x]}" @click=${() => set({ finish: i === 0 ? undefined : x })}></button>`,
            )}
          </div>`
        : nothing}
      ${kind?.accents
        ? html`<div class="finishes" role="radiogroup" aria-label=${this.t("editor.furniture_accent")}>
            <span class="muted">${this.t("editor.furniture_accent")}</span>
            ${kind.accents.map(
              (x, i) => html`<button role="radio" class="swatch ${(f.accent ?? kind.accents![0]) === x ? "active" : ""}" aria-checked=${(f.accent ?? kind.accents![0]) === x}
                title=${this.t(`finish.${x}` as StringKey)} data-accent=${x} style="--swatch:${FINISHES[x]}" @click=${() => set({ accent: i === 0 ? undefined : x })}></button>`,
            )}
          </div>`
        : nothing}
      <div class="row">
        ${mountOf(f) === "wall"
          ? html`<label>${this.t("editor.furniture_elevation")}
              <input type="number" min="0" max="4" step="0.05" .value=${String(f.elevation ?? FURNITURE[f.type].elevation ?? 1.2)} @change=${(e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (v >= 0 && v <= 4) set({ elevation: v === (FURNITURE[f.type].elevation ?? 1.2) ? undefined : v });
              }} />
            </label>`
          : nothing}
      </div>
      <p class="muted">${this.t(`editor.mount_${mountOf(f)}_hint` as StringKey)}</p>
      ${this.renderSnapPieces()}
      ${this.linkSelect(r.area_id, f.entity, (entity) => set({ entity }), linkDomain(f.type, kindId))}
      <p class="muted">${this.t("editor.furniture_entity_hint")}</p>
      ${(f.readings ?? []).map(
        (id, i) => html`<div class="row detail">
          <span>${this.entityName(id)}</span>
          <button class="icon" title=${this.t("editor.light_remove")} @click=${() => set({ readings: (f.readings ?? []).filter((_, j) => j !== i) })}><ha-icon icon="mdi:close"></ha-icon></button>
        </div>`,
      )}
      ${this.entitySelect(this.t("editor.furniture_reading_add"), "sensor", r.area_id, undefined, (id) => id && set({ readings: [...(f.readings ?? []), id] }))}
      <div class="row">
        <button title=${this.t("editor.turn_left")} @click=${() => this.rotateFurniture(-90)}>⟲ 90°</button>
        <button title=${this.t("editor.turn_right")} @click=${() => this.rotateFurniture(90)}>⟳ 90°</button>
      </div>
      <div class="row">
        <button title=${this.t("editor.furniture_mirror_h")} @click=${() => set(flipFurniture(f, "x"))}>⇋ ${this.t("editor.furniture_mirror_h")}</button>
        <button title=${this.t("editor.furniture_mirror_v")} @click=${() => set(flipFurniture(f, "y"))}>⇅ ${this.t("editor.furniture_mirror_v")}</button>
      </div>
      ${this.entitySelect(this.t("editor.visible_when"), "input_boolean", undefined, f.visible_when, (visible_when) => set({ visible_when }))}
      <button @click=${() => this.duplicateFurniture()}>${this.t("editor.furniture_duplicate")}</button>
      ${this.moveToFloor((to) => {
        const moved = movePieceToLevel(m, this._level, r.id, sel.index, to);
        if (!moved.roomId) return;
        this.commit(moved.model);
        this._furn = null;
        this._level = to;
      })}
      <button class="danger" @click=${() => {
        this.commit(deleteFurniture(m, this._level, r.id, sel.index));
        this._furn = null;
      }}>${this.t("editor.furniture_delete")}</button>`;
  }

  private renderEnergyMarkers() {
    const m = this._model!;
    return svg`${(m.energy ?? []).map((e, i) => {
      if (e.kind === "solar" || e.level !== this._level || !e.at) return nothing;
      const [x, y] = this.toScreen(e.at);
      const letter = { battery: "B", grid: "G", inverter: "I", device: "⚡" }[e.kind as string] ?? "?";
      return svg`<g class="energy-marker ${this._energySel === i ? "selected" : ""}" data-energy=${i} style="--energy:${ENERGY_COLORS[e.kind]}">
        <rect x=${x - 11} y=${y - 11} width="22" height="22" rx="6"></rect>
        <text x=${x} y=${y + 4} text-anchor="middle">${letter}</text>
        <title>${this.energyName(e)}</title>
      </g>${this._energySel === i
        ? svg`<g class="link-handle" data-energylink=${i}><title>${this.t("editor.energy_link_drag")}</title>
            <line x1=${x + 11} y1=${y} x2=${x + 22} y2=${y}></line><circle cx=${x + 27} cy=${y} r="6"></circle></g>`
        : nothing}`;
    })}`;
  }

  /**
   * The energy overlay's lines as the card draws them: from each item to the one it is
   * connected to. Ends on another level or on the roof show as a short arrow with a name.
   */
  private renderEnergyLinks() {
    const m = this._model!;
    const { house } = expandHouse(m);
    const items = house?.energy ?? [];
    const here = (e: (typeof items)[number]) => e.kind !== "solar" && m.energy?.[e.index]?.level === this._level && !!e.at;
    const where = (e: (typeof items)[number]) => (e.kind === "solar" ? this.t("editor.energy_on_roof") : this.levelName(m.levels.find((l) => l.id === m.energy?.[e.index]?.level) ?? { id: "" }));
    const out: unknown[] = [];
    for (const e of items) {
      const target = e.to === null ? undefined : items.find((x) => x.index === e.to);
      if (!target) continue;
      const color = ENERGY_COLORS[e.kind];
      const a = here(e) ? this.toScreen(e.at!) : null;
      const b = here(target) ? this.toScreen(target.at!) : null;
      if (a && b) {
        out.push(svg`<line class="energy-link" style="stroke:${color}" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]}></line>`);
      } else if (a || b) {
        // one end elsewhere: a stub pointing away, named
        const [p, other, toward] = a ? [a, target, true] : [b!, e, false];
        out.push(svg`<line class="energy-link" style="stroke:${color}" x1=${p[0]} y1=${p[1]} x2=${p[0]} y2=${p[1] - 34}></line>
          <text class="energy-link-label" x=${p[0] + 4} y=${p[1] - 38}>${toward ? "→" : "←"} ${this.energyName(m.energy![other.index])} · ${where(other)}</text>`);
      }
    }
    const from = this._linkEnd && this._drag?.kind === "energy-link" ? m.energy?.[this._drag.from] : undefined;
    if (from?.at && this._linkEnd) {
      const [ax, ay] = this.toScreen(from.at);
      const [bx, by] = this.toScreen(this._linkEnd);
      out.push(svg`<line class="energy-link drawing" x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>`);
    }
    return out;
  }

  /** The level's robots on the plan: their dock (drag to move) and where HA says they are. */
  private renderRobotMarkers() {
    const m = this._model!;
    const { house } = expandHouse(m);
    return svg`${(m.robots ?? []).map((r, i) => {
      if (r.level !== this._level) return nothing;
      const [x, y] = this.toScreen(r.dock);
      const robot = house?.robots.find((x) => x.index === i);
      const reading = robot && this._hass ? readRobot(this._hass, robot) : null;
      const live = reading?.live && reading.at ? this.toScreen(reading.at) : null;
      return svg`<g class="robot-marker ${this._robotSel === i ? "selected" : ""}" data-robot=${i}>
          <rect x=${x - 12} y=${y - 9} width="24" height="18" rx="5"></rect>
          <text x=${x} y=${y + 4} text-anchor="middle">${r.entity.startsWith("lawn_mower.") ? "M" : "V"}</text>
          <title>${this.robotName(r.entity, r.name)}</title>
        </g>
        ${live ? svg`<circle class="robot-live" cx=${live[0]} cy=${live[1]} r="7"><title>${this.robotName(r.entity, r.name)}</title></circle>` : nothing}`;
    })}`;
  }

  private robotName(entity: string, name?: string) {
    return name || this.entityName(entity);
  }

  /** Robot vacuums and mowers: placed ones, then the ones HA has that aren't placed yet. */
  private renderRobotSection() {
    const m = this._model!;
    const placed = m.robots ?? [];
    const offers = Object.keys(this._hass?.states ?? {}).filter((id) => (id.startsWith("vacuum.") || id.startsWith("lawn_mower.")) && !placed.some((r) => r.entity === id));
    if (!placed.length && !offers.length) return nothing;
    return html`<h3>${this.t("editor.robots")}</h3>
      <p class="muted">${this.t("editor.robots_hint")}</p>
      <ul class="lights">
        ${placed.map(
          (r, i) => html`<li class=${this._robotSel === i ? "selected" : ""}>
            <button class="link name" @click=${() => {
              this._robotSel = i;
              if (r.level !== this._level) this._level = r.level;
            }}>${this.robotName(r.entity, r.name)}<small class="muted">${this.levelName(m.levels.find((l) => l.id === r.level) ?? { id: r.level })}</small></button>
          </li>`,
        )}
        ${offers.map(
          (id) => html`<li>
            <span class="name">${this.entityName(id)}</span>
            <button class=${this._robotPlace === id ? "active" : ""} @click=${() => {
              this._robotPlace = id;
              this._room = null;
            }}>${this.t("editor.energy_place")}</button>
          </li>`,
        )}
      </ul>`;
  }

  /**
   * A robot: its name and, for a live position, where it comes from and the calibration
   * (two spots where the robot's own position and the plan are matched up).
   */
  private renderRobotInspector(index: number) {
    const m = this._model!;
    const r = m.robots![index];
    const hass = this._hass;
    const states = hass?.states ?? {};
    const { house } = expandHouse(m);
    const robot = house?.robots.find((x) => x.index === index);
    const reading = robot && hass ? readRobot(hass, robot) : null;
    const source = r.position?.entity ?? r.entity;
    // entities that know a position: map coordinates in an attribute, or GPS
    const hasPosition = (id: string) => {
      const a = states[id]?.attributes ?? {};
      return typeof a.latitude === "number" || Object.values(a).some((v) => (Array.isArray(v) && v.length >= 2 && typeof v[0] === "number") || (v && typeof v === "object" && typeof (v as { x?: unknown }).x === "number"));
    };
    const candidates = [r.entity, ...Object.keys(states).filter((id) => id !== r.entity && hasPosition(id))];
    const attrs = Object.entries(states[source]?.attributes ?? {})
      .filter(([, v]) => (Array.isArray(v) && v.length >= 2 && typeof v[0] === "number") || (v && typeof v === "object" && typeof (v as { x?: unknown }).x === "number"))
      .map(([k]) => k);
    const gps = typeof states[source]?.attributes.latitude === "number";
    // Roborock answers its position through a service, not an attribute
    const service = hass?.services?.roborock?.get_vacuum_current_position && r.entity.startsWith("vacuum.") ? "roborock.get_vacuum_current_position" : undefined;
    if (r.position?.service && hass) this.pollRobotHere(r.position.entity ?? r.entity, r.position.service);
    const raw = r.position && hass && robot?.position ? rawPosition(hass, robot.position) : null;
    const points = r.position?.points?.length ?? 0;
    return html`<h2>${this.robotName(r.entity, r.name)}</h2>
      <p class="muted">${this.t(r.entity.startsWith("lawn_mower.") ? "editor.robot_mower" : "editor.robot_vacuum")} · ${this.t("editor.robot_drag")}</p>
      <p>${states[r.entity]?.state ?? "—"}${reading?.battery !== null && reading?.battery !== undefined ? ` · ${Math.round(reading.battery)} %` : ""}</p>
      <label>${this.t("editor.energy_name")}
        <input .value=${r.name ?? ""} placeholder=${this.entityName(r.entity)} @change=${(e: Event) => this.commit(updateRobot(m, index, { name: (e.target as HTMLInputElement).value.trim() || undefined }))} />
      </label>
      <h3>${this.t("editor.robot_live")}</h3>
      <p class="muted">${this.t("editor.robot_live_hint")}</p>
      <label class="check"><input type="checkbox" .checked=${!!r.position} @change=${(e: Event) => this.commit(setRobotPosition(m, index, (e.target as HTMLInputElement).checked ? (service && !attrs.length ? { service } : { attribute: attrs[0] }) : null))} />
        ${this.t("editor.robot_live_on")}</label>
      ${r.position
        ? html`<label>${this.t("editor.robot_source")}
              <select @change=${(e: Event) => {
                const entity = (e.target as HTMLSelectElement).value;
                if (entity === "service") return this.commit(setRobotPosition(m, index, { service }));
                const first = Object.entries(states[entity]?.attributes ?? {}).find(([, v]) => v && typeof v === "object" && (Array.isArray(v) ? typeof v[0] === "number" : typeof (v as { x?: unknown }).x === "number"))?.[0];
                this.commit(setRobotPosition(m, index, { entity, attribute: first }));
              }}>
                ${service ? html`<option value="service" ?selected=${!!r.position?.service}>${this.t("editor.robot_roborock")}</option>` : nothing}
                ${candidates.map((id) => html`<option value=${id} ?selected=${id === source && !r.position?.service}>${this.entityName(id)}</option>`)}
              </select>
            </label>
            <label>${this.t("editor.robot_attribute")}
              <select @change=${(e: Event) => this.commit(setRobotPosition(m, index, { entity: source, attribute: (e.target as HTMLSelectElement).value || undefined }))}>
                ${attrs.map((a) => html`<option value=${a} ?selected=${r.position?.attribute === a}>${a}</option>`)}
                ${gps ? html`<option value="" ?selected=${!r.position?.attribute}>${this.t("editor.robot_gps")}</option>` : nothing}
              </select>
            </label>
            <p class="muted">${raw ? this.t("editor.robot_reading", { at: raw.gps ? raw.at.map((v) => v.toFixed(6)).join(", ") : raw.at.map((v) => Math.round(v)).join(", ") }) : this.t("editor.robot_no_reading")}</p>
            <p>${reading?.live ? this.t("editor.robot_calibrated") : this.t("editor.robot_points", { count: points })}</p>
            <div class="row">
              <button ?disabled=${!raw} class=${this._robotCalib?.index === index ? "active" : ""} @click=${() => {
                // the reading at this moment, not when the inspector was drawn
                const now = this._hass && robot?.position ? rawPosition(this._hass, robot.position) : null;
                if (now) this._robotCalib = { index, reading: now.at };
              }}>${this.t("editor.robot_record")}</button>
              <button ?disabled=${!points} @click=${() => this.commit(clearRobotPoints(m, index))}>${this.t("editor.robot_clear")}</button>
            </div>
            <p class="muted">${this.t("editor.robot_calib_hint")}</p>
            ${r.position?.service ? html`<p class="muted">${this.t("editor.robot_app_hint")}</p>` : nothing}`
        : nothing}
      <button class="danger" @click=${() => {
        this.commit(deleteRobot(m, index));
        this._robotSel = null;
      }}>${this.t("editor.light_remove")}</button>`;
  }

  /** One energy item: its name, sensors and what its line connects to. */
  private renderEnergyInspector(index: number) {
    const m = this._model!;
    const e = m.energy?.[index];
    if (!e) return nothing;
    const { house } = expandHouse(m);
    const items = house?.energy ?? [];
    const me = items.find((x) => x.index === index);
    const hub = items.find((x) => x.kind === "inverter") ?? items.find((x) => x.kind === "battery") ?? items.find((x) => x.kind === "grid");
    const set = (patch: Partial<EnergyInput>) => this.commit(updateEnergy(m, index, patch));
    const fromPrefs = e.kind === "device" ? [] : prefsSensors(this._energyPrefs, e.kind);
    const power = (id: string) => this._hass?.states[id]?.attributes.device_class === "power";
    return html`<h2>${this.energyName(e)}</h2>
      <p class="muted">${this.t(`card.energy_${e.kind}` as StringKey)}${e.kind === "solar" ? ` · ${this.t("editor.energy_on_roof")}` : ` · ${this.t("editor.energy_drag")}`}</p>
      <label>${this.t("editor.energy_name")}
        <input .value=${e.name ?? ""} placeholder=${this.energyName({ ...e, name: undefined })} @change=${(ev: Event) => set({ name: (ev.target as HTMLInputElement).value.trim() || undefined })} />
      </label>
      ${this.entitySelect(this.t("editor.energy_power"), "sensor", undefined, e.power, (id) => set({ power: id }), power)}
      ${!e.power && fromPrefs.length ? html`<p class="muted">${this.t("editor.energy_power_default", { sensors: fromPrefs.map((x) => this.entityName(x)).join(", ") })}</p>` : nothing}
      <p class="muted">${this.t("editor.energy_power_hint")}</p>
      ${e.kind === "battery"
        ? this.entitySelect(this.t("editor.energy_soc"), "sensor", undefined, e.soc, (id) => set({ soc: id }), (id) => this._hass?.states[id]?.attributes.device_class === "battery")
        : nothing}
      <h4>${this.t("editor.energy_details")}</h4>
      ${(e.details ?? []).map((d, i) => {
        const id = typeof d === "string" ? d : d.entity;
        return html`<div class="row detail">
          <span>${this.entityName(id)}</span>
          <button class="icon" title=${this.t("editor.light_remove")} @click=${() => set({ details: (e.details ?? []).filter((_, j) => j !== i) })}><ha-icon icon="mdi:close"></ha-icon></button>
        </div>`;
      })}
      ${this.entitySelect(this.t("editor.energy_detail_add"), "sensor", undefined, undefined, (id) => id && set({ details: [...(e.details ?? []), id] }))}
      <p class="muted">${this.t("editor.energy_details_hint")}</p>
      ${e.kind === "solar"
        ? html`<label>${this.t("editor.energy_roof_side")}
            <select @change=${(ev: Event) => set({ roof: (ev.target as HTMLSelectElement).value as Side })}>
              ${(["south", "north", "east", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${(e.roof ?? "south") === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
            </select>
          </label>`
        : nothing}
      <label>${this.t("editor.energy_to")}
        <select @change=${(ev: Event) => {
          const v = (ev.target as HTMLSelectElement).value;
          this.commit(connectEnergy(m, index, v === "" ? null : Number(v)));
        }}>
          <option value="" ?selected=${!e.to}>${hub && hub.index !== index ? this.t("editor.energy_to_hub", { hub: this.energyName(m.energy![hub.index]) }) : this.t("editor.energy_to_none")}</option>
          ${items
            .filter((x) => x.index !== index)
            .map((x) => html`<option value=${x.index} ?selected=${!!e.to && me?.to === x.index}>${this.energyName(m.energy![x.index])}</option>`)}
        </select>
      </label>
      <p class="muted">${this.t(e.kind === "solar" ? "editor.energy_to_hint_roof" : "editor.energy_to_hint")}</p>
      <button class="danger" @click=${() => {
        this.commit(deleteEnergy(m, index));
        this._energySel = null;
      }}>${this.t("editor.light_remove")}</button>`;
  }

  private energyName(e: EnergyInput): string {
    if (e.name) return e.name;
    if (e.kind === "device") return (e.power && this.entityName(e.power)) || this.t("card.energy_device");
    return this.t(`card.energy_${e.kind}` as StringKey);
  }

  /** The energy items to offer: HA's energy settings, then what is already placed. */
  private renderEnergySection() {
    const m = this._model!;
    const prefs = this._energyPrefs;
    const placed = m.energy ?? [];
    const hasSource = (type: string) => !!prefs?.energy_sources.some((x) => x.type === type);
    const offers: EnergyInput[] = [
      ...(hasSource("solar") ? [{ kind: "solar" as const }] : []),
      ...(hasSource("battery") ? [{ kind: "battery" as const }] : []),
      ...(hasSource("grid") ? [{ kind: "grid" as const }] : []),
      { kind: "inverter" as const },
      ...(prefs?.device_consumption ?? []).filter((d) => d.stat_rate).map((d) => ({ kind: "device" as const, power: d.stat_rate, name: d.name })),
    ].filter((o) => !placed.some((p) => p.kind === o.kind && (o.kind !== "device" || p.power === o.power)));
    const levelName = (id?: string) => {
      const l = m.levels.find((x) => x.id === id);
      return l ? this.levelName(l) : "";
    };
    const place = (o: EnergyInput) => {
      if (o.kind === "solar") {
        this.commit(addEnergy(m, { kind: "solar" }).model);
        return;
      }
      this._energyPlace = o;
      this._room = null;
    };
    return html`<h3>${this.t("editor.energy")}</h3>
      <p class="muted">${this.t("editor.energy_hint")}</p>
      ${placed.length
        ? html`<ul class="lights energy">
            ${placed.map(
              (e, i) => html`<li class=${this._energySel === i ? "selected" : ""} style="--energy:${ENERGY_COLORS[e.kind]}">
                <button class="link name" @click=${() => {
                  this._energySel = i;
                  if (e.level && e.level !== this._level) this._level = e.level;
                }}>${this.energyName(e)}<small class="muted">${e.kind === "solar" ? this.t("editor.energy_on_roof") : levelName(e.level)}</small></button>
                ${e.kind === "solar"
                  ? html`<select aria-label=${this.t("editor.energy_roof_side")} @change=${(ev: Event) => this.commit(updateEnergy(m, i, { roof: (ev.target as HTMLSelectElement).value as Side }))}>
                      ${(["south", "north", "east", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${(e.roof ?? "south") === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
                    </select>`
                  : nothing}
                <button @click=${() => {
                  this.commit(deleteEnergy(m, i));
                  this._energySel = null;
                }}>${this.t("editor.light_remove")}</button>
              </li>`,
            )}
          </ul>`
        : nothing}
      ${offers.length
        ? html`<ul class="lights offers">
            ${offers.map(
              (o) => html`<li>
                <span class="name">${this.energyName(o)}</span>
                <button class=${this._energyPlace && this._energyPlace.kind === o.kind && this._energyPlace.power === o.power ? "active" : ""} @click=${() => place(o)}>
                  ${o.kind === "solar" ? this.t("editor.energy_add") : this.t("editor.energy_place")}
                </button>
              </li>`,
            )}
          </ul>`
        : nothing}
      ${this.entitySelect(this.t("editor.energy_other"), "sensor", undefined, undefined, (power) => power && place({ kind: "device", power }), (id) =>
        this._hass?.states[id]?.attributes.device_class === "power" && !placed.some((p) => p.power === id),
      )}`;
  }

  private renderStairHandles() {
    const v = this._model?.vertical?.find((x) => x.id === this._stair);
    if (!v) return nothing;
    const [x, y, w, d] = stairsRect(this._model!, v);
    const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
    return svg`${corners.map((c, i) => {
      const [sx, sy] = this.toScreen(c);
      return svg`<circle class="vertex" data-stairhandle=${JSON.stringify(corners[(i + 2) % 4])} cx=${sx} cy=${sy} r="6"></circle>`;
    })}`;
  }

  /** A magnifier of the plan around the finger, in the corner away from it. */
  private renderLoupe() {
    const at = this._loupe;
    const svgEl = this.renderRoot.querySelector("svg.plan") as SVGSVGElement | null;
    if (!at || !svgEl) return nothing;
    const { width, height } = svgEl.getBoundingClientRect();
    const size = 132;
    const zoom = 2.5;
    const r = size / 2 / zoom;
    const right = at.x < width / 2;
    const bottom = at.y < Math.min(height / 2, size + 40);
    const style = `${right ? "right" : "left"}:12px;${bottom ? "bottom" : "top"}:12px`;
    return html`<div class="loupe" style=${style}>
      <svg viewBox="${at.x - r} ${at.y - r} ${2 * r} ${2 * r}">${this._planContent}</svg>
      <div class="loupe-cross"></div>
    </div>`;
  }

  private renderGuides() {
    const g = this._guides;
    if (!g) return nothing;
    const x = g.x !== undefined ? this.toScreen([g.x, 0])[0] : null;
    const y = g.y !== undefined ? this.toScreen([0, g.y])[1] : null;
    const ring = g.ring ? this.toScreen(g.ring) : null;
    return svg`${x !== null ? svg`<line class="guide" x1=${x} y1="0" x2=${x} y2="100%"></line>` : nothing}
      ${y !== null ? svg`<line class="guide" x1="0" y1=${y} x2="100%" y2=${y}></line>` : nothing}
      ${ring ? svg`<circle class="snap-ring" cx=${ring[0]} cy=${ring[1]} r="11"></circle>` : nothing}
      ${(g.rays ?? []).map(([a, b]) => {
        // the 45° line, a little past both ends
        const [p, q] = [this.toScreen(a), this.toScreen(b)];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const [ux, uy] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
        return svg`<line class="guide" x1=${p[0] - ux * 40} y1=${p[1] - uy * 40} x2=${q[0] + ux * 40} y2=${q[1] + uy * 40}></line>`;
      })}`;
  }

  private renderWall(w: Wall) {
    const [ax, ay] = this.alongWall(w, -w.extendStart);
    const [bx, by] = this.alongWall(w, Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) + w.extendEnd);
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const along = (t: number): Vec2 => this.toScreen([w.a[0] + ((w.b[0] - w.a[0]) * t) / len, w.a[1] + ((w.b[1] - w.a[1]) * t) / len]);
    if (this._tool === "opening" && w.type !== "open") {
      const width = Math.max(2, w.thickness * this._view.scale);
      return svg`<line class="wall ${w.type}" x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${width}></line>
        ${w.rooms.length ? svg`<line class="wall-hit add" data-addwall=${JSON.stringify({ line: w.line, rooms: w.rooms })} x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${Math.max(14, width)}></line>` : nothing}
        ${w.openings.map((o) => {
          const [x1, y1] = this.alongWall(w, o.start);
          const [x2, y2] = this.alongWall(w, o.end);
          const selected = !!this._opening && JSON.stringify(this._opening.src) === JSON.stringify(o.source);
          return svg`<line class="opening-gap" x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke-width=${width + 1}></line>
            <line class="opening type-${o.type} ${selected ? "selected" : ""}" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>
            ${this.openingSymbol(w, o)}
            <line class="opening-hit" data-opening=${JSON.stringify({ src: o.source, room: o.room })} x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke-width=${Math.max(16, width + 6)}></line>`;
        })}`;
    }
    const sel = this._wall;
    // (a wall of one room only: the other side is empty)
    const room = sel && w.rooms.includes(sel.a) && (sel.b ? w.rooms.includes(sel.b) : w.rooms.length === 1) ? this.levelInputRoomPolygon(sel.a) : null;
    const selected = !!sel && !!room && (sel.line ? overlaps(w.line, sel.line) : sideOfRoom(room, w.line[0], w.line[1]) === sel.side);
    let hit: unknown = nothing;
    // every inside wall can be selected: between two rooms, or one room's with nothing beside it
    if ((w.type === "interior" || w.type === "open") && w.rooms.length >= 1) {
      const [a, b = ""] = w.rooms;
      const own = this.levelInputRoomPolygon(a);
      // (a slanted wall has no side: its settings then hold all along)
      const side = own ? sideOfRoom(own, w.line[0], w.line[1]) : null;
      hit = svg`<line class="wall-hit" data-wall=${JSON.stringify({ a, b, side, line: w.line, thickness: w.thickness })} x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${Math.max(14, w.thickness * this._view.scale)}></line>`;
    }

    // the selected wall stands out: a halo round it, a dot at each end
    const halo = (width: number) => {
      if (!selected) return nothing;
      // just the piece picked (a wall split by a corner: one half)
      const [[hx0, hy0], [hx1, hy1]] = sel?.line ? [this.toScreen(sel.line[0]), this.toScreen(sel.line[1])] : [[ax, ay], [bx, by]];
      return svg`<line class="wall-halo" x1=${hx0} y1=${hy0} x2=${hx1} y2=${hy1} stroke-width=${width + 10}></line>
        <circle class="wall-end" cx=${hx0} cy=${hy0} r="4"></circle><circle class="wall-end" cx=${hx1} cy=${hy1} r="4"></circle>`;
    };
    if (w.type === "open") return svg`${halo(2)}<line class="wall open ${selected ? "selected" : ""}" x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>${hit}`;
    const width = Math.max(2, w.thickness * this._view.scale);
    const outside = w.type !== "interior";
    return svg`${halo(width)}<line class="wall ${w.type} ${(outside && this._room === OUTLINE) || selected ? "selected" : ""}" x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${width}></line>${hit}
      ${outside ? svg`<line class="wall-hit" data-outline="1" x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${Math.max(12, width)}></line>` : nothing}
      ${w.openings.map((o) => {
        const [x1, y1] = along(o.start);
        const [x2, y2] = along(o.end);
        const selected = !!this._opening && JSON.stringify(this._opening.src) === JSON.stringify(o.source);
        return svg`<line class="opening-gap" x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke-width=${width + 1}></line>
          <line class="opening type-${o.type} ${selected ? "selected" : ""}" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>
          ${this.openingSymbol(w, o)}
          <line class="opening-hit" data-opening=${JSON.stringify({ src: o.source, room: o.room })} x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke-width=${Math.max(16, width + 6)}></line>`;
      })}`;
  }

  /**
   * How a door or window opens, as in a floor plan: a door's leaf and its swing, dashed for
   * windows; two of them for double ones; two offset panels for sliding doors.
   */
  private openingSymbol(w: Wall, o: WallOpening) {
    const fixed = o.style === "fixed" || o.type === "garage_door" || o.type === "opening";
    if (fixed) return nothing;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const at = (t: number): Vec2 => [w.a[0] + u[0] * t, w.a[1] + u[1] * t];
    // which side of the wall its room is on
    const n: Vec2 = [-u[1], u[0]];
    const room = this.levelInputRoomPolygon(o.room);
    const m = at((o.start + o.end) / 2);
    const inward: Vec2 = room && pointInPolygon([m[0] + n[0] * 0.3, m[1] + n[1] * 0.3], room) ? n : [-n[0], -n[1]];
    const swing: Vec2 = o.swing === "out" ? [-inward[0], -inward[1]] : inward;
    const face = (p: Vec2): Vec2 => [p[0] + (swing[0] * w.thickness) / 2, p[1] + (swing[1] * w.thickness) / 2];
    const cls = o.type === "window" ? "swing window" : "swing";
    if (o.style === "sliding") {
      // one leaf, slid along the wall
      const off = w.thickness / 5;
      const [a, b] = [at(o.start), at(o.end)].map((p) => this.toScreen([p[0] + inward[0] * off, p[1] + inward[1] * off]));
      return svg`<line class="sliding solid" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]}></line>`;
    }
    if (o.style === "sliding_glass" || o.style === "lift_slide") {
      // two panels, overlapping in the middle
      const off = w.thickness / 5;
      const panel = (t0: number, t1: number, side: number) => {
        const [a, b] = [at(t0), at(t1)].map((p) => this.toScreen([p[0] + inward[0] * off * side, p[1] + inward[1] * off * side]));
        return svg`<line class="sliding" x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]}></line>`;
      };
      const span = o.end - o.start;
      return svg`${panel(o.start, o.start + span * 0.55, 1)}${panel(o.end - span * 0.55, o.end, -1)}`;
    }
    // hinges: seen from the room (facing the wall), on its left or right end
    const facing: Vec2 = [-inward[0], -inward[1]];
    const left: Vec2 = [facing[1], -facing[0]];
    const [s0, s1] = [at(o.start), at(o.end)];
    const leftEnd = s0[0] * left[0] + s0[1] * left[1] > s1[0] * left[0] + s1[1] * left[1] ? 0 : 1;
    const leaf = (hinge: Vec2, other: Vec2) => {
      const r = Math.hypot(other[0] - hinge[0], other[1] - hinge[1]);
      const tip: Vec2 = [hinge[0] + swing[0] * r, hinge[1] + swing[1] * r];
      const arc = Array.from({ length: 13 }, (_, i) => {
        const t = (i / 12) * (Math.PI / 2);
        return this.toScreen([hinge[0] + (tip[0] - hinge[0]) * Math.cos(t) + (other[0] - hinge[0]) * Math.sin(t), hinge[1] + (tip[1] - hinge[1]) * Math.cos(t) + (other[1] - hinge[1]) * Math.sin(t)]);
      });
      const [h, e] = [this.toScreen(hinge), this.toScreen(tip)];
      return svg`<line class="${cls} leaf" x1=${h[0]} y1=${h[1]} x2=${e[0]} y2=${e[1]}></line><polyline class=${cls} points=${arc.map((p) => p.join(",")).join(" ")}></polyline>`;
    };
    // an entrance door with a side panel: the leaf takes about three quarters of the width
    const leafEnd = o.style === "entrance_sidelight" ? at(o.start + (o.end - o.start) * 0.72) : s1;
    const ends = [face(s0), face(leafEnd)];
    if (o.style === "double" || o.style === "glass_double" || o.style === "split") {
      const middle = face(at((o.start + o.end) / 2));
      return svg`${leaf(ends[0], middle)}${leaf(ends[1], middle)}`;
    }
    if (o.style === "triple") {
      // three sashes: the outer ones hinged at the ends, the middle one like a single window
      const [t1, t2] = [face(at(o.start + (o.end - o.start) / 3)), face(at(o.end - (o.end - o.start) / 3))];
      const mids = [t1, t2];
      const h = o.hinge === "right" ? 1 - leftEnd : leftEnd;
      return svg`${leaf(ends[0], t1)}${leaf(mids[h], mids[1 - h])}${leaf(ends[1], t2)}`;
    }
    const hinge = o.hinge === "right" ? 1 - leftEnd : leftEnd;
    return leaf(ends[hinge], ends[1 - hinge]);
  }

  /** Registers a length that can be clicked and typed; returns its key for `data-dimedit`. */
  private dimTarget(key: string, value: number, apply: (v: number) => HouseInput | null): string {
    this.dimTargets.set(key, { value, apply });
    return key;
  }

  /** Inside lengths of every room, along its walls (the selected room shows them on its handles). */
  private renderRoomDims(rooms: RoomInput[], walls: Wall[]) {
    const out: unknown[] = [];
    for (const r of rooms) {
      if (r.id === this._room) continue;
      // the selected door or window shows its own distances along that room's wall
      if (r.id === this._opening?.room) continue;
      if ((r.kind ?? "room") === "void") continue;
      const inner = this.inner(r, walls);
      inner.forEach((p, i) => {
        const q = inner[(i + 1) % inner.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const [ax, ay] = this.toScreen(p);
        const [bx, by] = this.toScreen(q);
        const sl = Math.hypot(bx - ax, by - ay);
        // short sides (steps, wall ends) would only clutter
        if (sl < 46 || len < 0.3) return;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        let nx = -(by - ay) / sl;
        let ny = (bx - ax) / sl;
        if (!pointInPolygon(this.toWorld([mx + nx * 10, my + ny * 10]), inner)) {
          nx = -nx;
          ny = -ny;
        }
        let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        const x = mx + nx * 9;
        const y = my + ny * 9;
        out.push(svg`<text class="room-dim" x=${x} y=${y} dominant-baseline="middle" text-anchor="middle" transform="rotate(${angle} ${x} ${y})">${this.n(len)}</text>`);
      });
    }
    return out;
  }

  /** The house's outside width and depth, as dimension lines along its north and west sides. */
  private renderOverallDims() {
    // the house's outside size: to the outer face of its outside walls
    const poly = expandHouse(this._model!).house?.levels.find((l) => l.id === this._level)?.outer ?? [];
    if (poly.length < 3) return nothing;
    const { min, max } = bbox(poly);
    const [x0, y0] = this.toScreen(min);
    const [x1, y1] = this.toScreen(max);
    const gap = 26;
    const tick = (x: number, y: number, vertical: boolean) =>
      svg`<line class="dim-line" x1=${vertical ? x - 5 : x} y1=${vertical ? y : y - 5} x2=${vertical ? x + 5 : x} y2=${vertical ? y : y + 5}></line>`;
    const ty = y0 - gap;
    const tx = x0 - gap;
    return svg`<g class="overall-dims">
      <line class="dim-line" x1=${x0} y1=${ty} x2=${x1} y2=${ty}></line>${tick(x0, ty, false)}${tick(x1, ty, false)}
      <text class="dim overall" x=${(x0 + x1) / 2} y=${ty - 5} text-anchor="middle">${this.fmtM(max[0] - min[0])}</text>
      <line class="dim-line" x1=${tx} y1=${y0} x2=${tx} y2=${y1}></line>${tick(tx, y0, true)}${tick(tx, y1, true)}
      <text class="dim overall" x=${tx - 5} y=${(y0 + y1) / 2} text-anchor="middle" transform="rotate(-90 ${tx - 5} ${(y0 + y1) / 2})">${this.fmtM(max[1] - min[1])}</text>
    </g>`;
  }

  /**
   * The selected door or window's distances to the room's inside corners and its width,
   * drawn along the inside face of its wall; each can be clicked and typed.
   */
  private renderOpeningDims(walls: Wall[]) {
    const sel = this._opening!;
    const m = this._model!;
    const o = readOpening(m, this._level, sel.src);
    const room = this.levelInput?.rooms.find((r) => r.id === sel.room);
    const key = JSON.stringify(sel.src);
    const wall = walls.find((w) => w.openings.some((x) => JSON.stringify(x.source) === key && x.room === sel.room));
    const wo = wall?.openings.find((x) => JSON.stringify(x.source) === key && x.room === sel.room);
    if (!o || !room || !wall || !wo) return nothing;
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) || 1;
    const u: Vec2 = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len];
    const n: Vec2 = [-u[1], u[0]];
    const tOf = (p: Vec2) => (p[0] - wall.a[0]) * u[0] + (p[1] - wall.a[1]) * u[1];
    const dOf = (p: Vec2) => (p[0] - wall.a[0]) * n[0] + (p[1] - wall.a[1]) * n[1];
    // the room's inside face along this wall: parallel, within the wall, overlapping the opening
    const inner = this.inner(room, walls);
    let face: { t0: number; t1: number; d: number } | null = null;
    inner.forEach((p, i) => {
      const q = inner[(i + 1) % inner.length];
      const d0 = dOf(p);
      if (Math.abs(d0 - dOf(q)) > 0.01 || Math.abs(d0) > wall.thickness + 0.01) return;
      const [t0, t1] = [tOf(p), tOf(q)].sort((x, y) => x - y);
      if (t1 < wo.start || t0 > wo.end) return;
      if (!face || t1 - t0 > face.t1 - face.t0) face = { t0, t1, d: d0 };
    });
    if (!face) return nothing;
    const { t0, t1, d } = face as { t0: number; t1: number; d: number };
    const axis = o.side === "north" || o.side === "south" ? 0 : 1;
    const sign = Math.sign(u[axis]) || 1;
    const shift = (dt: number) => updateOpening(m, this._level, sel.src, { at: Math.max(0, Math.round((o.at + dt * sign) * 100) / 100) });
    // drawn a little into the room
    const inward = Math.sign(d) || 1;
    const off = d + (inward * 16) / this._view.scale;
    const at = (t: number): Vec2 => this.toScreen([wall.a[0] + u[0] * t + n[0] * off, wall.a[1] + u[1] * t + n[1] * off]);
    const parts: { from: number; to: number; key: string; apply: (v: number) => HouseInput | null }[] = [
      { from: t0, to: wo.start, key: "gap-a", apply: (v) => (v >= 0 ? shift(t0 + v - wo.start) : null) },
      { from: wo.start, to: wo.end, key: "width", apply: (v) => (v > 0.1 ? updateOpening(m, this._level, sel.src, { width: Math.round(v * 100) / 100 }) : null) },
      { from: wo.end, to: t1, key: "gap-b", apply: (v) => (v >= 0 ? shift(t1 - v - wo.end) : null) },
    ];
    return svg`<g class="opening-dims">${parts.map((part) => {
      const value = part.to - part.from;
      const [ax, ay] = at(part.from);
      const [bx, by] = at(part.to);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      const tick = (x: number, y: number) => svg`<line class="dim-line" x1=${x - n[0] * 5} y1=${y - n[1] * 5} x2=${x + n[0] * 5} y2=${y + n[1] * 5}></line>`;
      return svg`<line class="dim-line" x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>${tick(ax, ay)}${tick(bx, by)}
        <text class="dim editable" data-dimedit=${this.dimTarget(part.key, value, part.apply)} x=${mx} y=${my} dy="-5" text-anchor="middle" transform="rotate(${angle} ${mx} ${my})">${this.n(value)}</text>`;
    })}</g>`;
  }

  /** The house's sections on the plan: a dash-dot line, arrows the way one looks, its name. */
  private renderSections() {
    const list = (this._model?.sections ?? []).map((s, i) => ({ a: s.line[0] as Vec2, b: s.line[1] as Vec2, look: s.look as Side | undefined, name: s.name ?? s.id, i }));
    if (this._sectionDraft) list.push({ ...this._sectionDraft, look: undefined, name: "", i: -1 });
    const dirs: Record<Side, Vec2> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    return svg`${list.map(({ a, b, look, name, i }) => {
      const [ax, ay] = this.toScreen(a);
      const [bx, by] = this.toScreen(b);
      const sel = i === this._sectionSel;
      const d = look ? dirs[look] : null;
      // an arrow at each end, the way one looks
      const arrow = (x: number, y: number) => (d ? svg`<path class="section-arrow" d="M ${x} ${y} l ${d[0] * 22} ${d[1] * 22} m ${-d[0] * 7 - d[1] * 6} ${-d[1] * 7 - d[0] * 6} l ${d[0] * 7 + d[1] * 6} ${d[1] * 7 + d[0] * 6} l ${-d[0] * 7 + d[1] * 6} ${-d[1] * 7 - d[0] * 6}"></path>` : nothing);
      return svg`<g class="section-line ${sel ? "selected" : ""}" data-section=${i}>
        <line x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>
        ${arrow(ax, ay)}${arrow(bx, by)}
        ${name ? svg`<text x=${ax} y=${ay - (d && d[1] < 0 ? 34 : 12)} text-anchor="end">${name}</text>` : nothing}
        ${i >= 0
          ? svg`<line class="section-hit" x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width="14" @pointerdown=${(e: PointerEvent) => {
              if (this._tool !== "select" && this._tool !== "section") return;
              e.stopPropagation();
              this.clearSelection();
              this._sectionSel = i;
            }}></line>`
          : nothing}
        ${sel ? svg`<circle class="section-end" data-section-end="0" cx=${ax} cy=${ay} r="7"></circle><circle class="section-end" data-section-end="1" cx=${bx} cy=${by} r="7"></circle>` : nothing}
      </g>`;
    })}`;
  }

  private renderSectionInspector(i: number) {
    const m = this._model!;
    const s = m.sections![i];
    const set = (patch: Partial<SectionInput>) => {
      const next = structuredClone(m);
      Object.assign(next.sections![i], patch);
      this.commit(next);
    };
    const horizontal = Math.abs(s.line[1][0] - s.line[0][0]) >= Math.abs(s.line[1][1] - s.line[0][1]);
    const looks: Side[] = horizontal ? ["north", "south"] : ["west", "east"];
    return html`<h2>${s.name ?? s.id}</h2>
      <p class="muted">${this.t("editor.section_hint")}</p>
      <label>${this.t("editor.section_name_label")}
        <input data-section-name .value=${s.name ?? ""} @change=${(e: Event) => set({ name: (e.target as HTMLInputElement).value.trim() || undefined })} />
      </label>
      <label>${this.t("editor.section_look")}
        <select data-section-look @change=${(e: Event) => set({ look: (e.target as HTMLSelectElement).value as Side })}>
          ${looks.map((sd) => html`<option value=${sd} ?selected=${s.look === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
        </select>
      </label>
      <button class="danger" data-section-delete @click=${() => {
        const next = structuredClone(m);
        next.sections!.splice(i, 1);
        if (!next.sections!.length) delete next.sections;
        this._sectionSel = null;
        this.commit(next);
      }}>${this.t("editor.section_delete")}</button>`;
  }

  private renderMeasure({ a, b }: { a: Vec2; b: Vec2 }) {
    const [ax, ay] = this.toScreen(a);
    const [bx, by] = this.toScreen(b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    const diagonal = dx > 0.005 && dy > 0.005;
    return svg`<g class="measure">
      <line x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>
      <circle cx=${ax} cy=${ay} r="4"></circle><circle cx=${bx} cy=${by} r="4"></circle>
      ${len > 0.005
        ? svg`<text class="dim" x=${(ax + bx) / 2} y=${(ay + by) / 2 - 8} text-anchor="middle">${this.fmtM(len)}${diagonal ? ` (${this.n(dx)} × ${this.n(dy)})` : ""}</text>`
        : nothing}
    </g>`;
  }

  /** Click targets and handles of free-standing walls (the walls themselves are drawn with the others). */
  private renderFreeWalls(free: { a: Vec2; b: Vec2 }[], railings: { a: Vec2; b: Vec2 }[]) {
    const walls = freeWallIndexes(this._model!, this._level);
    const rails = railingIndexes(this._model!, this._level);
    // (railings drawn as a thin double line: see-through, not a wall)
    const list = [...free.map((w, k) => ({ ...w, index: walls[k], railing: false })), ...railings.map((w, k) => ({ ...w, index: rails[k], railing: true }))];
    return svg`${list.map((w) => {
      const index = w.index;
      const [ax, ay] = this.toScreen(w.a);
      const [bx, by] = this.toScreen(w.b);
      const sel = index === this._freeWall;
      return svg`${w.railing ? svg`<line class="railing-line" x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>` : nothing}<line class="wall-hit free ${sel ? "selected" : ""}" data-freewall=${index} x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width="14"></line>
        ${sel ? svg`<circle class="vertex" data-freeend="0" cx=${ax} cy=${ay} r="7"></circle><circle class="vertex" data-freeend="1" cx=${bx} cy=${by} r="7"></circle>` : nothing}`;
    })}`;
  }

  private renderDimEdit(edit: { x: number; y: number; target: DimTarget }) {
    const done = (input: HTMLInputElement) => {
      const v = parseFloat(input.value.replace(",", "."));
      this._dimEdit = null;
      if (isNaN(v) || Math.abs(v - edit.target.value) < 0.0005) return;
      const next = edit.target.apply(v);
      if (next) this.commit(next);
    };
    // an HTML field inside the SVG (an svg template would make it an SVG element)
    return svg`<foreignObject x=${edit.x - 45} y=${edit.y - 16} width="90" height="32">${html`
      <input class="dim-input" type="number" step="0.01" .value=${edit.target.value.toFixed(2)} aria-label=${this.t("editor.dim_edit")}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") done(e.target as HTMLInputElement);
          else if (e.key === "Escape") this._dimEdit = null;
        }}
        @blur=${(e: Event) => this._dimEdit && done(e.target as HTMLInputElement)} />`}
    </foreignObject>`;
  }

  /** Handles sit on the wall centre lines; the lengths shown are inside dimensions. */
  private renderHandles(poly: Vec2[], inner: Vec2[]) {
    const sides = this.innerSides(poly, inner);
    const m = this._model!;
    return svg`${poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const [ax, ay] = this.toScreen(p);
      const [bx, by] = this.toScreen(q);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const len = sides[i];
      // label outside the edge (positive orientation: outside is to the right of a→b in screen terms)
      const nx = (by - ay) / (Math.hypot(bx - ax, by - ay) || 1);
      const ny = -(bx - ax) / (Math.hypot(bx - ax, by - ay) || 1);
      return svg`<g>
        <line class="edge-hit" data-handle="edge" data-at=${JSON.stringify([p, q])} x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>
        <rect class="edge-handle" data-handle="edge" data-at=${JSON.stringify([p, q])} x=${mx - 5} y=${my - 5} width="10" height="10" rx="2"></rect>
        <text class="dim editable" data-dimedit=${this.dimTarget(`side-${i}`, len, (v) => (v > 0.2 ? resizeSide(m, this._level, poly, i, v - len) : null))}
          x=${mx + nx * 16} y=${my + ny * 16 + 4} text-anchor="middle">${this.n(len)}</text>
      </g>`;
    })}
    ${poly.map((p) => {
      const [x, y] = this.toScreen(p);
      const sel = !!this._vertexSel && Math.hypot(this._vertexSel[0] - p[0], this._vertexSel[1] - p[1]) < 0.01;
      return svg`<circle class="vertex ${sel ? "selected" : ""}" data-handle="vertex" data-at=${JSON.stringify(p)} cx=${x} cy=${y} r=${sel ? 9 : 7}></circle>`;
    })}`;
  }

  private renderInspector() {
    const m = this._model!;
    const l = this.levelInput;
    if (!l) return nothing;
    if (this._settings) return this.renderHouseSettings();
    if (this._checklist) return this.renderChecklist();
    // what is selected, else what the tool adds
    if (this._furn) return this.renderFurnitureInspector(this._furn);
    if (this._energySel !== null && this._model?.energy?.[this._energySel]) return this.renderEnergyInspector(this._energySel);
    if (this._robotSel !== null && this._model?.robots?.[this._robotSel]) return this.renderRobotInspector(this._robotSel);
    if (this._opening) return this.renderOpeningInspector(this._opening);
    if (this._tool === "assign") return this.renderAssignPanel();
    if (this._tool === "opening")
      return html`<h2>${this.t("editor.tool_opening")}</h2>
        <p class="muted">${this.t("editor.opening_library_hint")}</p>
        ${OPENING_GROUPS.map(
          (g) => html`${this.groupHead(`opening:${g.id}`, this.t(`editor.opening_group_${g.id}` as StringKey))}
        ${this.isFolded(`opening:${g.id}`) ? nothing : html`<div class="library openings">
          ${g.presets.map(
            (p) => html`<button class="piece ${this._openingPreset === p.id ? "active" : ""}" draggable="true" data-preset=${p.id} aria-pressed=${this._openingPreset === p.id}
              @dragstart=${(e: DragEvent) => {
                this.openingDrag = p.id;
                e.dataTransfer?.setData("text/plain", p.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
              }}
              @dragend=${() => (this.openingDrag = null)}
              @click=${() => (this._openingPreset = p.id)}>
              ${this.openingIcon(p)}
              <span>${this.t(`editor.opening_${p.id}` as StringKey)}</span>
            </button>`,
          )}
        </div>`}`,
        )}
        ${this.renderOpeningDefaults()}`;
    if (this._tool === "furniture") {
      const room = l.rooms.find((x) => x.id === this._room) ?? null;
      return html`<h2>${this.t("editor.furniture")}</h2>${this.renderLibrary(room)}`;
    }
    if (this._tool === "devices")
      return html`<h2>${this.t("editor.sub_devices")}</h2>
        ${this.renderEnergySection()}`;
    if (this._tool === "robots")
      return html`<h2>${this.t("editor.sub_robots")}</h2>
        ${this.renderRobotSection() === nothing ? html`<p class="muted">${this.t("editor.robots_none")}</p>` : this.renderRobotSection()}`;
    if (this._sectionSel !== null && this._model?.sections?.[this._sectionSel]) return this.renderSectionInspector(this._sectionSel);
    if (this._stair) return this.renderStairInspector(this._stair);
    if (this._freeWall !== null) return this.renderFreeWallInspector(this._freeWall);
    if (this._room === OUTLINE) return this.renderOutlineInspector();
    if (this._wall) return this.renderWallInspector(this._wall);
    const r = l.rooms.find((x) => x.id === this._room);
    const set = (patch: Partial<RoomInput>) => r && this.commit(updateRoom(m, this._level, r.id, patch));
    if (!r) return this.renderLevelInspector();
    const poly = this.inner(r);
    const areas = Object.values(this._hass?.areas ?? {}).sort((a, b) => {
      // the level's own floor first
      const mine = (f?: string | null) => !!f && (f === l.floor_id || !!l.include_floors?.includes(f));
      const fa = mine(a.floor_id) ? 0 : 1;
      const fb = mine(b.floor_id) ? 0 : 1;
      return fa - fb || a.name.localeCompare(b.name);
    });
    return html`<h2>${this.roomName(r)}</h2>
      <p class="muted">${this.n(area(poly))} m² · ${this.t("editor.perimeter")} ${this.n(poly.reduce((s, p, i) => s + Math.hypot(poly[(i + 1) % poly.length][0] - p[0], poly[(i + 1) % poly.length][1] - p[1]), 0))} m</p>
      <label>${this.t("editor.ha_area")}
        <select @change=${(e: Event) => set({ area_id: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">—</option>
          ${areas.map((a) => html`<option value=${a.area_id} ?selected=${a.area_id === r.area_id}>${a.name}</option>`)}
        </select>
      </label>
      ${this.renderSameRoom(r)}
      <label>${this.t("editor.room_id")}
        <input .value=${r.id} @change=${(e: Event) => {
          const id = (e.target as HTMLInputElement).value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
          if (id && id !== r.id && !l.rooms.some((x) => x.id === id)) {
            set({ id });
            this._room = id;
          }
        }} />
      </label>
      ${r.rect && typeof r.rect[0] === "number" && typeof r.rect[1] === "number"
        ? (() => {
            const [x, y, w, d] = r.rect as [number, number, number, number];
            // moving the east or south wall, like dragging it (neighbours follow)
            const resize = (axis: 0 | 1, value: number) => {
              if (!(value > 0.3)) return;
              const delta = value - (axis === 0 ? w : d);
              if (Math.abs(delta) < 1e-6) return;
              const a: Vec2 = axis === 0 ? [x + w, y] : [x, y + d];
              const b: Vec2 = axis === 0 ? [x + w, y + d] : [x + w, y + d];
              this.commit(moveEdge(m, this._level, a, b, axis === 0 ? [delta, 0] : [0, delta]));
            };
            return html`<div class="row">
              <label>${this.t("editor.room_width")}
                <input type="number" min="0.3" step="0.05" .value=${String(w)} @change=${(e: Event) => resize(0, Number((e.target as HTMLInputElement).value))} />
              </label>
              <label>${this.t("editor.room_depth")}
                <input type="number" min="0.3" step="0.05" .value=${String(d)} @change=${(e: Event) => resize(1, Number((e.target as HTMLInputElement).value))} />
              </label>
            </div>
            <p class="muted">${this.t("editor.room_size_hint")}</p>`;
          })()
        : nothing}
      ${r.area_id && this._hass?.areas?.[r.area_id]
        ? (() => {
            const areaId = r.area_id!;
            const current = this._hass!.areas![areaId].temperature_entity_id ?? undefined;
            return html`${this.entitySelect(this.t("editor.temperature_sensor"), "sensor", areaId, current, async (entity) => {
                try {
                  await this._hass!.callWS({ type: "config/area_registry/update", area_id: areaId, temperature_entity_id: entity ?? null });
                } catch (e) {
                  this._error = String((e as { message?: string }).message ?? e);
                }
              }, (id) => this._hass?.states[id]?.attributes.device_class === "temperature")}
              <p class="muted">${this.t("editor.temperature_hint")}</p>`;
          })()
        : nothing}
      <label>${this.t("editor.kind")}
        <select @change=${(e: Event) => set({ kind: (e.target as HTMLSelectElement).value as RoomInput["kind"] })}>
          ${(["room", "outdoor", "void"] as const).map((k) => html`<option value=${k} ?selected=${(r.kind ?? "room") === k}>${this.t(`editor.kind_${k}` as StringKey)}</option>`)}
        </select>
      </label>
      ${(r.kind ?? "room") !== "void" ? html`<h4>${this.t("editor.surface_floor")}</h4>${this.renderFinishPicker("floor", r.floor, (floor) => set({ floor }), this.t("editor.default"))}` : nothing}
      ${(r.kind ?? "room") === "room" ? this.renderWallFinishes(r, set) : nothing}
      ${(r.kind ?? "room") === "room" ? this.entitySelect(this.t("editor.underfloor"), "climate", r.area_id, r.underfloor, (underfloor) => set({ underfloor })) : nothing}
      ${(r.kind ?? "room") === "outdoor"
        ? html`<label>${this.t("editor.railing")}
              <select @change=${(e: Event) => set({ railing: ((e.target as HTMLSelectElement).value || undefined) as RoomInput["railing"] })}>
                ${(["", "glass", "metal", "wood"] as const).map((v) => html`<option value=${v} ?selected=${(r.railing ?? "") === v}>${this.t(`editor.railing_${v || "none"}`)}</option>`)}
              </select>
            </label>
            ${this.entitySelect(this.t("editor.awning"), "cover", r.area_id, r.awning, (awning) => set({ awning }))}
            ${r.awning ? this.invertedToggle(r.awning, "editor.awning_inverted") : nothing}
            <p class="muted">${this.t("editor.awning_hint")}</p>`
        : nothing}
      ${(r.kind ?? "room") === "room" ? this.renderBuilding(r, set) : nothing}
      <div class="row wall-views">
        <span class="muted">${this.t("editor.wall_view")}</span>
        ${(["north", "east", "south", "west"] as Side[]).map((sd) => html`<button data-wall-view=${sd} @click=${() => (this._wallView = { room: r.id, side: sd })}>${this.t(`editor.side_${sd}` as StringKey)}</button>`)}
      </div>
      ${this.renderCurves(r, { room: r.id })}
      ${this.renderRoomRoofWindows(r)}
      ${this.renderRoomObjects(r)}
      ${this.moveToFloor((to) => {
        const moved = moveRoomToLevel(m, this._level, r.id, to);
        this.commit(moved.model);
        this._level = to;
        this._room = moved.roomId;
      })}
      <button class="danger" @click=${() => {
        this.commit(deleteRoom(m, this._level, r.id));
        this._room = null;
      }}>${this.t("editor.delete_room")}</button>`;
  }

  /**
   * A finish picker: the current one (its picture and name), opening to every finish for
   * that surface in groups. `fallback` names what no finish means (the default).
   */
  /** A room standing apart from the house (a shed, a garage, a carport): its building's roof and walls. */
  private renderBuilding(r: RoomInput, set: (patch: Partial<RoomInput>) => void) {
    const { house } = expandHouse(this._model!);
    const level = house?.levels.find((x) => x.id === this._level);
    const inside = labelPoint(roomPolygon(this._model!, r));
    const i = level?.annexes.findIndex((a) => pointInPolygon(inside, a)) ?? -1;
    if (!level || i < 0) return nothing;
    const b = level.annexBuildings[i];
    // the settings live on the room that has them, else on this one
    const owner = this._model!.levels.find((l) => l.id === this._level)!.rooms.find((x) => x.building && pointInPolygon(labelPoint(roomPolygon(this._model!, x)), level.annexes[i])) ?? r;
    const put = (patch: Partial<NonNullable<RoomInput["building"]>>) => {
      const next = Object.fromEntries(Object.entries({ ...owner.building, ...patch }).filter(([, v]) => v !== undefined && v !== false));
      const value = Object.keys(next).length ? next : undefined;
      if (owner === r) set({ building: value });
      else this.commit(updateRoom(this._model!, this._level, owner.id, { building: value }));
    };
    return html`<h4 data-building>${this.t("editor.building")}</h4>
      <p class="muted">${this.t("editor.building_hint")}</p>
      <div class="row">
        <label>${this.t("editor.roof_shape")}
          <select data-building-roof @change=${(e: Event) => put({ roof: (e.target as HTMLSelectElement).value as Building["roof"], pitch: undefined })}>
            ${(["shed", "gable", "hip", "flat"] as const).map((v) => html`<option value=${v} ?selected=${b.roof === v}>${this.t(`editor.roof_shape_${v}`)}</option>`)}
          </select>
        </label>
        <label>${this.t("editor.roof_pitch")}
          <input type="number" min="0" max="60" step="1" .value=${String(b.pitch)} @change=${(e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (v >= 0 && v <= 60) put({ pitch: v });
          }} />
        </label>
      </div>
      <label class="check"><input type="checkbox" data-building-open .checked=${b.open} @change=${(e: Event) => put({ open: (e.target as HTMLInputElement).checked || undefined })} /> ${this.t("editor.building_open")}</label>
      ${b.open
        ? nothing
        : html`<label>${this.t("editor.building_thickness")}
            <input type="number" min="0.05" max="0.99" step="0.01" placeholder=${String(house!.walls.exterior)} .value=${b.thickness === undefined ? "" : String(b.thickness)} @change=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value;
              const v = Number(raw);
              if (!raw) put({ thickness: undefined });
              else if (v > 0 && v < 1) put({ thickness: v });
            }} />
          </label>
          <h4>${this.t("editor.building_facade")}</h4>
          ${this.renderFinishPicker("wall", b.facade, (facade) => put({ facade }), this.t("editor.default"))}`}
      <h4>${this.t("editor.building_roof")}</h4>
      ${this.renderFinishPicker("roof", b.finish, (roof_finish) => put({ roof_finish }), this.t("editor.default"))}`;
  }

  private renderFinishPicker(surface: Surface, current: string | undefined, pick: (id: string | undefined) => void, fallback: string) {
    const name = (id: string) => this.t(`surface.${id}` as StringKey);
    const list = FINISH_LIST.filter((f) => f.on.includes(surface));
    const choose = (e: Event, id: string | undefined) => {
      (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
      pick(id);
    };
    const source = this._finishSource;
    return html`<details class="finish-picker" data-surface=${surface}>
      <summary>${this.finishSwatch(current)}<span>${current ? this.finishName(current) : fallback}</span></summary>
      <div class="library-sources" role="tablist">
        ${(["builtin", "polyhaven"] as const).map(
          (s) => html`<button role="tab" class=${s === source ? "active" : ""} aria-selected=${s === source} data-finish-source=${s} @click=${() => (this._finishSource = s)}>${this.t(`editor.library_${s}` as StringKey)}</button>`,
        )}
      </div>
      ${source === "polyhaven" ? this.renderTextureList(surface, current, choose) : nothing}
      ${source === "builtin"
        ? html`<button class="finish ${current ? "" : "active"}" data-finish="" @click=${(e: Event) => choose(e, undefined)}>${this.finishSwatch(undefined)}<span>${fallback}</span></button>
      ${FINISH_GROUPS.map((g) => {
        const items = list.filter((f) => f.group === g);
        return items.length
          ? html`<h5>${this.t(`surface_group.${g}` as StringKey)}</h5>
              <div class="finish-grid">
                ${items.map((f) => html`<button class="finish ${current === f.id ? "active" : ""}" data-finish=${f.id} title=${name(f.id)} @click=${(e: Event) => choose(e, f.id)}>${this.finishSwatch(f.id)}<span>${name(f.id)}</span></button>`)}
              </div>`
          : nothing;
      })}`
        : nothing}
    </details>`;
  }

  /** Poly Haven's textures for a surface: searchable; picking one downloads it into Home Assistant first. */
  private renderTextureList(surface: Surface, current: string | undefined, choose: (e: Event, id: string | undefined) => void) {
    const c = this._textures;
    if (!c) {
      this.loadTextures();
      return html`<p class="muted">${this.t("editor.library_loading")}</p>`;
    }
    if ("error" in c) return html`<p class="muted">${this.t("editor.library_polyhaven_error", { error: c.error })}</p>`;
    const words = this._textureFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // roofs: Poly Haven's roofing textures
    const fits = (t: (typeof c)[number]) => (surface === "roof" ? [...t.categories, ...t.tags].some((x) => /roof/i.test(x)) : t.on.includes(surface));
    const list = c.filter((t) => fits(t) && words.every((w) => `${t.name} ${t.tags.join(" ")} ${t.categories.join(" ")}`.toLowerCase().includes(w)));
    return html`<p class="muted credit">${this.t("editor.texture_polyhaven_credit")} <a href="https://polyhaven.com/textures" target="_blank" rel="noopener">polyhaven.com</a></p>
      <input class="texture-search" type="search" placeholder=${this.t("editor.library_search")} aria-label=${this.t("editor.library_search")} .value=${this._textureFilter}
        @input=${(e: Event) => (this._textureFilter = (e.target as HTMLInputElement).value)} />
      <div class="finish-grid">
        ${list.slice(0, 60).map((t) => {
          const ref = `polyhaven:${t.id}`;
          return html`<button class="finish ${current === ref ? "active" : ""}" data-finish=${ref} title=${t.name} ?disabled=${this._textureBusy === t.id}
            @click=${async (e: Event) => {
              const target = e.currentTarget as HTMLElement;
              this._textureBusy = t.id;
              try {
                await this._hass!.callWS({ type: "homeslice/assets/textures/fetch", asset: t.id });
                choose({ currentTarget: target } as unknown as Event, ref);
              } catch (err) {
                this._error = String((err as { message?: string }).message ?? err);
              } finally {
                this._textureBusy = null;
              }
            }}>${this.finishSwatch(ref)}<span>${this._textureBusy === t.id ? this.t("editor.texture_loading") : t.name}</span></button>`;
        })}
      </div>
      ${list.length > 60 ? html`<p class="muted">${this.t("editor.texture_more", { count: list.length - 60 })}</p>` : nothing}`;
  }

  private finishName(id: string): string {
    if (!id.startsWith("polyhaven:")) return this.t(`surface.${id}` as StringKey);
    const t = this._textures && !("error" in this._textures) ? this._textures.find((x) => `polyhaven:${x.id}` === id) : undefined;
    return `Poly Haven · ${t?.name ?? humanize(id.slice(10))}`;
  }

  private finishSwatch(id: string | undefined) {
    const url = id ? finishPreview(id) : null;
    const color = id ? (FINISHES_BY_ID[id]?.color ?? "#ccc") : "#eeeae3";
    return html`<span class="finish-swatch" style=${url ? `background-image:url(${url})` : `background:${color}`}></span>`;
  }

  /** A room's walls: one finish for all, and sides in another (accent walls). */
  private renderWallFinishes(r: RoomInput, set: (patch: Partial<RoomInput>) => void) {
    const sides = r.wall_sides ?? {};
    const setSide = (side: Side, id: string | undefined) => {
      const next = { ...sides, [side]: id };
      if (!id) delete next[side];
      set({ wall_sides: Object.keys(next).length ? next : undefined });
    };
    const free = (["north", "east", "south", "west"] as Side[]).filter((s) => !sides[s]);
    return html`<h4>${this.t("editor.surface_wall")}</h4>
      ${this.renderFinishPicker("wall", r.wall, (wall) => set({ wall }), this.t("editor.surface_plain"))}
      ${(Object.keys(sides) as Side[]).map(
        (side) => html`<div class="wall-side" data-side=${side}>
          <span class="muted">${this.t(`editor.side_${side}` as StringKey)}</span>
          ${this.renderFinishPicker("wall", sides[side], (id) => setSide(side, id), this.t("editor.surface_same"))}
        </div>`,
      )}
      ${free.length
        ? html`<label>${this.t("editor.surface_sides")}
            <select class="add-wall-side" .value=${""} @change=${(e: Event) => {
              const side = (e.target as HTMLSelectElement).value as Side;
              (e.target as HTMLSelectElement).value = "";
              if (side) setSide(side, r.wall === "acoustic_oak" ? "paint_white" : "acoustic_oak");
            }}>
              <option value="">…</option>
              ${free.map((s) => html`<option value=${s}>${this.t(`editor.side_${s}` as StringKey)}</option>`)}
            </select>
          </label>`
        : nothing}`;
  }

  // ----- level list: pointer-based sorting (works with mouse and touch) -----

  private onLevelDown(e: PointerEvent, id: string, index: number) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const step = el.getBoundingClientRect().height + 6; // button height + gap
    this._levelDrag = { id, from: index, over: index, startY: e.clientY, dy: 0, step, moved: false };
  }

  private onLevelMove(e: PointerEvent, count: number) {
    const d = this._levelDrag;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const moved = d.moved || Math.abs(dy) > 4;
    const over = Math.max(0, Math.min(count - 1, d.from + Math.round(dy / d.step)));
    this._levelDrag = { ...d, dy, moved, over };
  }

  private onLevelUp(id: string, count: number) {
    const d = this._levelDrag;
    this._levelDrag = null;
    if (!d || !this._model) return;
    if (!d.moved) {
      this._level = id;
      this._room = null;
      this._wall = null;
      this._opening = null;
      return;
    }
    // the list shows the top level first; the model stores the bottom level first
    if (d.over !== d.from) this.commit(moveLevel(this._model, id, count - 1 - d.over));
  }

  private onLevelKey(e: KeyboardEvent, id: string) {
    if (!e.altKey || !this._model || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const index = this._model.levels.findIndex((l) => l.id === id);
    const target = index + (e.key === "ArrowUp" ? 1 : -1);
    if (target < 0 || target >= this._model.levels.length) return;
    this.commit(moveLevel(this._model, id, target));
  }

  /** Room edges and centre, and the doors and windows stacked above and below, along the wall. */
  /**
   * A door or window dragged well off its wall, over another wall: moved onto it (its own
   * settings kept), the drag going on along the new wall. True if it moved.
   */
  private rehomeOpening(drag: Extract<Drag, { kind: "opening" }>, world: Vec2): boolean {
    const base = drag.base ?? drag.origin;
    const o = readOpening(base, this._level, drag.src);
    const poly = o ? this.levelInputRoomPolygonOf(base, o.room) : null;
    if (!o || !poly) return false;
    // how far from its own wall the pointer is
    const { min, max } = bbox(poly);
    const across = o.side === "north" ? min[1] : o.side === "south" ? max[1] : o.side === "west" ? min[0] : max[0];
    const off = Math.abs(world[drag.axis === 0 ? 1 : 0] - across);
    if (off < 0.4) return false;
    // the wall under the pointer (whatever the tool): the nearest one, within its thickness or a few pixels
    let wall: { line: [Vec2, Vec2]; rooms: string[] } | null = null;
    let best = Infinity;
    for (const w of this.levelWalls()) {
      if (!w.rooms.length || w.type === "open") continue;
      const { distance, t, length } = project(world, w.line[0], w.line[1]);
      if (t < 0 || t > length) continue;
      const reach = Math.max(w.thickness / 2, 8 / this._view.scale);
      if (distance <= reach && distance < best) [wall, best] = [{ line: w.line, rooms: w.rooms }, distance];
    }
    if (!wall) return false;
    // its room if the wall is one of its room's, else the room on the side it came from
    const room = wall.rooms.includes(o.room) ? o.room : (wall.rooms.find((r) => r === drag.room) ?? wall.rooms[0]);
    const target = room ? this.levelInputRoomPolygonOf(base, room) : null;
    const side = target ? sideOfRoom(target, wall.line[0], wall.line[1]) : null;
    if (!target || !side || (room === o.room && side === o.side)) return false;
    const axis = side === "north" || side === "south" ? 0 : 1;
    const from = Math.min(...target.map((p) => p[axis]));
    const at = Math.max(0, Math.round((world[axis] - from - o.width / 2) / 0.05) * 0.05);
    const { model, source } = addOpening(deleteOpening(base, this._level, drag.src), this._level, { ...o, room, side, at: Math.round(at * 100) / 100 });
    this._model = model;
    const moved = readOpening(model, this._level, source)!;
    this._opening = { src: source, room };
    this._drag = { ...drag, base: model, src: source, axis, startWorld: world, at: moved.at, snaps: this.openingSnaps({ src: source, room }, moved, axis), room };
    return true;
  }

  private levelInputRoomPolygonOf(m: HouseInput, roomId: string): Vec2[] | null {
    const r = m.levels.find((l) => l.id === this._level)?.rooms.find((x) => x.id === roomId);
    return r ? roomPolygon(m, r) : null;
  }

  private openingSnaps(sel: { src: OpeningSource; room: string }, o: OpeningInput, axis: 0 | 1): OpeningSnaps {
    const poly = this.levelInputRoomPolygon(sel.room) ?? [];
    const along = poly.map((p) => p[axis]);
    const across = poly.map((p) => p[1 - axis]);
    const origin = Math.min(...along);
    const end = Math.max(...along);
    const line = o.side === "north" || o.side === "west" ? Math.min(...across) : Math.max(...across);
    const edges = [origin, end];
    const centres = [(origin + end) / 2];
    const { house } = expandHouse(this._model!);
    for (const level of house?.levels ?? []) {
      for (const w of deriveWalls(level, house!.walls, [])) {
        if (w.type === "open" || Math.abs(w.line[0][1 - axis] - line) > 0.6 || Math.abs(w.line[1][1 - axis] - line) > 0.6) continue;
        const len = Math.hypot(w.line[1][0] - w.line[0][0], w.line[1][1] - w.line[0][1]) || 1;
        const at = (t: number) => w.line[0][axis] + ((w.line[1][axis] - w.line[0][axis]) * t) / len;
        for (const x of w.openings) {
          if (level.id === this._level && JSON.stringify(x.source) === JSON.stringify(sel.src)) continue;
          const [a, b] = [at(x.start), at(x.end)].sort((p, q) => p - q);
          edges.push(a, b);
          centres.push((a + b) / 2);
        }
      }
    }
    return { origin, width: o.width, edges, centres };
  }

  /** Adds a 1 m window centred on the clicked spot of a wall. */
  /** Adds a door or window (a library preset) centred on the clicked spot of a wall. */
  private addOpeningAt(hit: { line: [Vec2, Vec2]; rooms: string[] }, world: Vec2, presetId = this._openingPreset) {
    const room = hit.rooms[0];
    const poly = room ? this.levelInputRoomPolygon(room) : null;
    const side = poly ? sideOfRoom(poly, hit.line[0], hit.line[1]) : null;
    if (!poly || !side) return;
    const preset = OPENING_PRESETS.find((p) => p.id === presetId) ?? OPENING_PRESETS[0];
    const axis = side === "north" || side === "south" ? 0 : 1;
    const width = preset.width;
    const min = Math.min(...poly.map((p) => p[axis]));
    const at = Math.max(0, Math.round((world[axis] - min - width / 2) / 0.05) * 0.05);
    const look = Object.fromEntries(Object.entries(applyPreset(preset)).filter(([, v]) => v !== undefined));
    const { model, source } = addOpening(this._model!, this._level, { room, side, at: Math.round(at * 100) / 100, ...look, width });
    this.commit(model);
    this._opening = { src: source, room };
    this.tipOnce("opening");
  }

  /** The tip for `what`, the first time it is done in this browser. */
  private tipOnce(what: "room" | "wall" | "opening" | "stairs" | "section") {
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem("homeslice-tips") ?? "[]");
    } catch {
      // no storage: tips every time, harmless
    }
    if (seen.includes(what)) return;
    try {
      localStorage.setItem("homeslice-tips", JSON.stringify([...seen, what]));
    } catch {
      // (as above)
    }
    const tip = (this._tip = this.t(`editor.tip_${what}` as StringKey));
    // gone by itself after a while (or with ×)
    window.setTimeout(() => {
      if (this._tip === tip) this._tip = null;
    }, 20000);
  }

  private renderOpeningInspector(sel: { src: OpeningSource; room: string }) {
    const m = this._model!;
    const o = readOpening(m, this._level, sel.src);
    if (!o) return nothing;
    const set = (patch: Partial<OpeningInput>) => this.commit(updateOpening(m, this._level, sel.src, patch));
    const num = (key: "width" | "sill" | "height" | "at") => (e: Event) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(v) && v >= 0) set({ [key]: Math.round(v * 100) / 100 });
    };
    const roomInput = this.levelInput?.rooms.find((r) => r.id === sel.room);
    const areaId = roomInput?.area_id;
    const states = this._hass?.states ?? {};
    const shared = sel.src.kind === "facade" ? m.facade_openings?.[sel.src.index]?.levels ?? [] : [];
    // its kind (e.g. "Double window"); the tiles below change it, also into a door
    return html`<h2>${this.t(`editor.opening_${kindOf(o)}` as StringKey)}</h2>
      <p class="muted">${roomInput ? this.roomName(roomInput) : ""} · ${this.t(`editor.side_${o.side}` as StringKey)}</p>
      ${shared.length ? html`<p class="muted">${this.t("editor.opening_shared", { levels: shared.join(", ") })}</p>` : nothing}
      <p class="muted">${this.t("editor.opening_change_kind")}</p>
      ${OPENING_GROUPS.map(
        (g) => html`<h4>${this.t(`editor.opening_group_${g.id}` as StringKey)}</h4>
          <div class="opening-kinds" role="radiogroup" aria-label=${this.t(`editor.opening_group_${g.id}` as StringKey)}>
            ${g.presets.map((p) => {
              const current = presetOf(o)?.id === p.id;
              return html`<button class="kind ${current ? "active" : ""}" role="radio" aria-checked=${current} data-preset=${p.id} title=${this.t(`editor.opening_${p.id}` as StringKey)}
                @click=${() => set(applyPreset(p))}>${this.openingIcon(p)}</button>`;
            })}
          </div>`,
      )}
      ${o.style === "split" || o.style === "split_single"
        ? html`<label>${this.t("editor.opening_split")}
            <input type="number" min="0.1" step="0.05" placeholder=${String(((o.height ?? 1.3) / 2).toFixed(2))} .value=${o.split === undefined ? "" : String(o.split)}
              @change=${(e: Event) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                set({ split: v > 0 ? Math.round(v * 100) / 100 : undefined });
              }} />
          </label>`
        : nothing}
      ${(o.type ?? "window") === "door" || (o.type ?? "window") === "window"
        ? o.style === "fixed" || o.style === "sliding" || o.style === "sliding_glass" || o.style === "lift_slide"
          ? nothing
          : html`<div class="row">
              <button @click=${() => set({ hinge: o.hinge === "right" ? undefined : "right" })}>⇄ ${this.t(o.hinge === "right" ? "editor.hinge_right" : "editor.hinge_left")}</button>
              <button @click=${() => set({ swing: o.swing === "out" ? undefined : "out" })}>⇅ ${this.t(o.swing === "out" ? "editor.swing_out" : "editor.swing_in")}</button>
            </div>`
        : nothing}
      <div class="row">
        <label>${this.t("editor.opening_at_label")}<input type="number" step="0.05" .value=${String(o.at)} @change=${num("at")} /></label>
        <label>${this.t("editor.opening_width")}<input type="number" step="0.05" .value=${String(o.width)} @change=${num("width")} /></label>
      </div>
      <div class="row">
        <label>${this.t("editor.opening_sill")}<input type="number" step="0.05" placeholder=${this.t("editor.default")} .value=${o.sill === undefined ? "" : String(o.sill)} @change=${num("sill")} /></label>
        <label>${this.t("editor.opening_height")}<input type="number" step="0.05" placeholder=${this.t("editor.default")} .value=${o.height === undefined ? "" : String(o.height)} @change=${num("height")} /></label>
      </div>
      ${this.entitySelect(this.t("editor.opening_cover"), "cover", areaId, o.cover, (cover) => set({ cover }))}
      ${o.cover ? this.invertedToggle(o.cover, "editor.cover_inverted") : nothing}
      ${(o.type ?? "window") === "garage_door" ? nothing : this.entitySelect(this.t("editor.opening_blind"), "cover", areaId, o.blind, (blind) => set({ blind }))}
      ${o.blind
        ? html`<label>${this.t("editor.blind_style")}
            <select @change=${(e: Event) => set({ blind_style: (e.target as HTMLSelectElement).value === "venetian" ? "venetian" : undefined })}>
              ${(["roller", "venetian"] as const).map((v) => html`<option value=${v} ?selected=${(o.blind_style ?? "roller") === v}>${this.t(`editor.blind_style_${v}`)}</option>`)}
            </select>
          </label>`
        : nothing}
      ${this.entitySelect(this.t("editor.opening_contact"), "binary_sensor", areaId, o.contact, (contact) => set({ contact }), (id) =>
        ["door", "window", "opening", "garage_door"].includes(String(states[id]?.attributes.device_class)),
      )}
      ${(o.type ?? "window") === "door" ? this.entitySelect(this.t("editor.opening_lock"), "lock", areaId, o.lock, (lock) => set({ lock })) : nothing}
      ${this.renderOpeningFloors(sel, shared)}
      <button class="danger" @click=${() => {
        this.commit(deleteOpening(m, this._level, sel.src));
        this._opening = null;
      }}>${shared.length > 1 ? this.t("editor.opening_delete_here") : this.t("editor.opening_delete")}</button>`;
  }

  /** The checklist for the current model and HA states (recomputed only when either changes). */
  private checks(): CheckItem[] {
    const m = this._model;
    const hass = this._hass;
    if (!m || !hass) return [];
    if (this.checkCache?.model === m && this.checkCache.states === hass.states) return this.checkCache.items;
    const items = checklist(m, hass, (id) => {
      const l = m.levels.find((x) => x.id === id);
      return l ? this.levelAreas(l) : [];
    });
    this.checkCache = { model: m, states: hass.states, items };
    return items;
  }

  private renderChecklist() {
    const items = this.checks();
    const m = this._model!;
    const levelName = (id?: string) => {
      const l = m.levels.find((x) => x.id === id);
      return l ? this.levelName(l) : "";
    };
    const roomName = (level?: string, room?: string) => {
      const r = m.levels.find((x) => x.id === level)?.rooms.find((x) => x.id === room);
      return r ? this.roomName(r) : room ?? "";
    };
    const go = (level?: string, room?: string) => {
      if (level) this._level = level;
      this.clearSelection();
      this.setTool("select");
      this._room = room ?? null;
      this._checklist = false;
    };
    const links = items.filter((i) => (i.kind === "cover" || i.kind === "contact") && i.target);
    const text = (i: CheckItem) => {
      switch (i.kind) {
        case "area":
          return this.t("editor.check_area", { area: i.name, level: levelName(i.level) });
        case "cover":
        case "contact":
          return i.target
            ? this.t(i.kind === "cover" ? "editor.check_cover_link" : "editor.check_contact_link", {
                entity: this.entityName(i.entity),
                room: roomName(i.target.level, i.target.room),
                side: this.t(`editor.side_${i.target.side}` as StringKey),
              })
            : this.t(i.room ? "editor.check_unlinked_room" : "editor.check_unlinked", { entity: this.entityName(i.entity), room: roomName(i.level, i.room) });
        case "beside":
          return this.t("editor.check_beside", { rooms: i.rooms.map((r) => roomName(i.level, r)).join(", "), cm: Math.max(1, Math.round(i.off * 100)) });
        default:
          return i.message;
      }
    };
    return html`<h2>${this.t("editor.checklist")}</h2>
      ${items.length ? html`<p class="muted">${this.t("editor.checklist_hint")}</p>` : html`<p>${this.t("editor.checklist_done")}</p>`}
      ${links.length > 1 ? html`<button class="primary" @click=${() => this.commit(applyAll(m, items))}>${this.t("editor.check_link_all", { count: links.length })}</button>` : nothing}
      <ul class="lights checklist">
        ${items.map(
          (i) => html`<li>
            <span class="name">${text(i)}</span>
            ${i.kind === "area"
              ? html`<button @click=${() => {
                  go(i.level);
                  this._pendingArea = i.area;
                  this._tool = "rect";
                }}>${this.t("editor.draw_room")}</button>`
              : i.kind === "beside"
                ? html`<button data-check-beside=${i.level} @click=${() => {
                    go(i.level);
                    this.commit(i.fix);
                  }}>${this.t("editor.check_beside_fix")}</button>`
              : (i.kind === "cover" || i.kind === "contact") && i.fix
                ? html`<button @click=${() => this.commit(i.fix!)}>${this.t("editor.check_link")}</button>`
                : i.level
                  ? html`<button @click=${() => go(i.level, "room" in i ? i.room : undefined)}>${this.t("editor.check_show")}</button>`
                  : nothing}
          </li>`,
        )}
      </ul>`;
  }

  private openingIcon(p: OpeningPreset) {
    return html`<svg class="opening-icon" viewBox="0 0 64 64" aria-hidden="true">${unsafeSVG(p.icon)}</svg>`;
  }

  /** Outside doors and windows: the other floors the same one is on (stacked façade windows). */
  private renderOpeningFloors(sel: { src: OpeningSource; room: string }, shared: string[]) {
    const m = this._model!;
    const key = JSON.stringify(sel.src);
    const wall = this.levelWalls().find((w) => w.openings.some((x) => JSON.stringify(x.source) === key));
    if (!wall || (wall.type !== "exterior" && wall.type !== "party") || m.levels.length < 2) return nothing;
    const others = shared.filter((id) => id !== this._level);
    const toggle = (id: string, on: boolean) => {
      const next = on ? [...others, id] : others.filter((x) => x !== id);
      const { model, source } = setOpeningLevels(m, this._level, sel.src, next);
      this.commit(model);
      this._opening = { src: source, room: sel.room };
    };
    return html`<h3>${this.t("editor.opening_floors")}</h3>
      <div class="checks">
        ${m.levels
          .filter((l) => l.id !== this._level)
          .map((l) => html`<label class="check"><input type="checkbox" .checked=${others.includes(l.id)} @change=${(e: Event) => toggle(l.id, (e.target as HTMLInputElement).checked)} />${this.levelName(l)}</label>`)}
      </div>
      <p class="muted">${this.t("editor.opening_floors_hint")}</p>`;
  }

  /** Pieces of the boundary between two rooms, with their side as seen from `a`. */
  private boundary(a: string, b: string): { side: Side; wall: Wall }[] {
    const m = this._model!;
    const { house } = expandHouse(m);
    const level = house?.levels.find((x) => x.id === this._level);
    const room = level?.rooms.find((r) => r.id === a);
    if (!level || !house || !room) return [];
    return deriveWalls(level, house.walls, [])
      .filter((w) => (w.type === "interior" || w.type === "open") && w.rooms.includes(a) && w.rooms.includes(b))
      .map((wall) => ({ wall, side: sideOfRoom(room.polygon, wall.line[0], wall.line[1]) }))
      .filter((x): x is { side: Side; wall: Wall } => !!x.side);
  }

  private renderWallInspector(sel: { a: string; b: string; side: Side | null; line?: [Vec2, Vec2] }) {
    const m = this._model!;
    const l = this.levelInput!;
    const name = (id: string) => {
      const r = l.rooms.find((x) => x.id === id);
      return r ? this.roomName(r) : id;
    };
    // one room's wall, nothing on its other side (a gap to the outside wall, an empty space)
    if (!sel.b)
      return html`<h2>${this.t("editor.wall")}</h2>
        <p class="muted">${sel.side ? this.t("editor.wall_of", { room: name(sel.a), side: this.t(`editor.side_${sel.side}` as StringKey) }) : this.t("editor.wall_of_slanted", { room: name(sel.a) })}</p>
        <p class="muted">${this.t("editor.wall_alone_hint")}</p>
        <div class="row wall-views">
          <span class="muted">${this.t("editor.wall_view")}</span>
          ${sel.side ? html`<button @click=${() => (this._wallView = { room: sel.a, side: sel.side! })}>${name(sel.a)}</button>` : nothing}
          <button @click=${() => {
            this._wall = null;
            this._room = sel.a;
          }}>${this.t("editor.wall_select_room", { room: name(sel.a) })}</button>
        </div>`;
    const all = [...new Set(this.boundary(sel.a, sel.b).map((x) => x.side))];
    const side = sel.side;
    // the walls between the two rooms, and the one clicked: changed on its own
    const pieces = this.levelWalls().filter((w) => (w.type === "interior" || w.type === "open") && w.rooms.includes(sel.a) && w.rooms.includes(sel.b));
    const piece = sel.line ? pieces.find((w) => overlaps(w.line, sel.line!)) : undefined;
    const open = piece ? piece.type === "open" : side ? openSides(m, this._level, sel.a, sel.b, all).includes(side) : boundaryOpenAll(m, this._level, sel.a, sel.b);
    // the clicked piece may be part of a longer wall (split by a corner): the rest keeps its state
    const part = piece && sel.line ? sel.line : piece?.line;
    const rest = piece && part ? remainder(piece.line, part) : [];
    const set = (o: boolean) =>
      this.commit(
        piece && part
          ? setOpenSegments(
              m,
              this._level,
              sel.a,
              sel.b,
              [...pieces.filter((w) => w !== piece && w.type === "open").map((w) => w.line), ...(piece.type === "open" ? rest : []), ...(o ? [part] : [])],
              pieces.length + rest.length,
            )
          : side
            ? setBoundaryOpen(m, this._level, sel.a, sel.b, side, o, all)
            : setBoundaryOpenAll(m, this._level, sel.a, sel.b, o),
      );
    return html`<h2>${this.t("editor.wall")}</h2>
      <p class="muted">${side ? this.t("editor.wall_between", { a: name(sel.a), b: name(sel.b), side: this.t(`editor.side_${side}` as StringKey) }) : this.t("editor.wall_between_slanted", { a: name(sel.a), b: name(sel.b) })}</p>
      <div class="segmented" role="radiogroup">
        <button role="radio" aria-checked=${!open} class=${!open ? "active" : ""} @click=${() => set(false)}>${this.t("editor.wall_solid")}</button>
        <button role="radio" aria-checked=${open} class=${open ? "active" : ""} @click=${() => set(true)}>${this.t("editor.wall_open")}</button>
      </div>
      <p class="muted">${this.t("editor.wall_hint")}</p>
      ${side
        ? html`<div class="row wall-views">
            <span class="muted">${this.t("editor.wall_view")}</span>
            <button @click=${() => (this._wallView = { room: sel.a, side })}>${name(sel.a)}</button>
            <button @click=${() => (this._wallView = { room: sel.b, side: OPPOSITE[side] })}>${name(sel.b)}</button>
          </div>`
        : nothing}
      ${open
        ? nothing
        : (() => {
            const own = (part ? segmentThickness(m, this._level, sel.a, sel.b, part) : undefined) ?? boundaryThickness(m, this._level, sel.a, sel.b, sel.side);
            const house = m.walls?.interior ?? DEFAULTS.walls.interior;
            return html`${this.cmInput(this.t("editor.wall_thickness"), own, house, (v) => this.commit(part ? setSegmentThickness(m, this._level, sel.a, sel.b, part, v) : setBoundaryThickness(m, this._level, sel.a, sel.b, sel.side, v)))}
              <p class="muted">${this.t("editor.wall_thickness_hint", { cm: cm(house) })}</p>`;
          })()}`;
  }

  /** "Inverted" for a cover that reports its position the other way round (house-wide, by entity). */
  private invertedToggle(cover: string, label: StringKey) {
    const m = this._model!;
    const on = !!m.inverted_covers?.includes(cover);
    return html`<label class="check"><input type="checkbox" .checked=${on} @change=${(e: Event) => this.commit(setCoverInverted(m, cover, (e.target as HTMLInputElement).checked))} />
      ${this.t(label)}</label>`;
  }

  /** A thickness in centimetres (stored in metres); empty means `fallback`. */
  private cmInput(label: string, value: number | undefined, fallback: number, set: (metres: number | undefined) => void) {
    return html`<label>${label}
      <input type="number" min="1" max="150" step="0.5" placeholder=${String(cm(fallback))} .value=${value === undefined ? "" : String(cm(value))}
        @change=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          const v = parseFloat(raw.replace(",", "."));
          if (raw === "") set(undefined);
          else if (v > 0 && v <= 150) set(Math.round(v * 10) / 1000);
        }} />
    </label>`;
  }

  private renderFreeWallInspector(index: number) {
    // (handlers read the model when they run: a field committing on blur must not undo a change made just before)
    const m = this._model!;
    const w = this.levelInput?.walls?.[index];
    if (!w?.line) return nothing;
    const [a, b] = w.line as [Vec2, Vec2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return html`<h2>${this.t("editor.free_wall")}</h2>
      <p class="muted">${this.t("editor.free_wall_hint")}</p>
      <div class="row">
        <label>${this.t("editor.free_wall_length")}
          <input type="number" min="0.2" step="0.05" .value=${len.toFixed(2)} @change=${(e: Event) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            if (!(v >= 0.2) || !len) return;
            // the second end moves along the wall
            const end: Vec2 = [a[0] + ((b[0] - a[0]) * v) / len, a[1] + ((b[1] - a[1]) * v) / len];
            this.commit(updateFreeWall(this._model!, this._level, index, { line: [a, end] }));
          }} />
        </label>
        ${w.type === "railing" ? nothing : this.cmInput(this.t("editor.wall_thickness"), w.thickness, m.walls?.interior ?? DEFAULTS.walls.interior, (v) => this.commit(updateFreeWall(this._model!, this._level, index, { thickness: v })))}
      </div>
      <div class="row">
        <label>${this.t("editor.free_wall_kind")}
          <select data-free-kind @change=${(e: Event) => this.commit(updateFreeWall(this._model!, this._level, index, { type: (e.target as HTMLSelectElement).value === "railing" ? "railing" : "wall" }))}>
            <option value="wall" ?selected=${w.type !== "railing"}>${this.t("editor.free_wall_kind_wall")}</option>
            <option value="railing" ?selected=${w.type === "railing"}>${this.t("editor.free_wall_kind_railing")}</option>
          </select>
        </label>
        ${w.type === "railing"
          ? html`<label>${this.t("editor.railing")}
              <select @change=${(e: Event) => this.commit(updateFreeWall(this._model!, this._level, index, { railing: (e.target as HTMLSelectElement).value as "glass" | "metal" | "wood" }))}>
                ${(["metal", "glass", "wood"] as const).map((v) => html`<option value=${v} ?selected=${(w.railing ?? "metal") === v}>${this.t(`editor.railing_${v}`)}</option>`)}
              </select>
            </label>`
          : nothing}
      </div>
      <button class="danger" @click=${() => {
        this.commit(deleteFreeWall(this._model!, this._level, index));
        this._freeWall = null;
      }}>${this.t("editor.free_wall_delete")}</button>`;
  }

  /** House-wide sill and height per type of door or window. */
  private renderOpeningDefaults() {
    const m = this._model!;
    const types: OpeningType[] = ["window", "door", "garage_door", "opening"];
    const field = (type: OpeningType, key: "sill" | "height") => {
      const own = m.opening_defaults?.[type]?.[key];
      return html`<input type="number" min="0" max="5" step="0.05" aria-label=${`${this.t(`editor.type_${type}` as StringKey)} ${this.t(`editor.opening_${key}` as StringKey)}`}
        placeholder=${String(DEFAULTS.opening[type][key])} .value=${own === undefined ? "" : String(own)}
        @change=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          const v = parseFloat(raw.replace(",", "."));
          if (raw === "") this.commit(setOpeningDefaults(m, type, { [key]: undefined }));
          else if (v >= 0 && v <= 5) this.commit(setOpeningDefaults(m, type, { [key]: Math.round(v * 100) / 100 }));
        }} />`;
    };
    return html`<h3>${this.t("editor.opening_defaults")}</h3>
      <p class="muted">${this.t("editor.opening_defaults_hint")}</p>
      <table class="defaults">
        <tr><th></th><th>${this.t("editor.opening_sill")}</th><th>${this.t("editor.opening_height")}</th></tr>
        ${types.map((t) => html`<tr><th>${this.t(`editor.type_${t}` as StringKey)}</th><td>${field(t, "sill")}</td><td>${field(t, "height")}</td></tr>`)}
      </table>`;
  }

  private levelName(l: { floor_id?: string; name?: string; id: string }) {
    return (l.floor_id && this._hass?.floors?.[l.floor_id]?.name) || l.name || l.id;
  }

  /** Adds a level at `index` (0 = bottom), on the next HA floor in that direction that has no level yet. */
  /** A roof level over the top floor's outline (one roof part to start with), opened. */
  private addRoofLevelOnTop() {
    const m = this._model!;
    const { house } = expandHouse(m);
    const top = house?.levels.filter((l) => l.kind !== "roof").at(-1);
    const b = top?.outline.length ? bbox(top.outline) : { min: [0, 0], max: [8, 8] };
    const { model, id } = addRoofLevel(m, [b.min[0], b.min[1], b.max[0] - b.min[0], b.max[1] - b.min[1]]);
    this.commit(model);
    this._settings = null;
    this.clearSelection();
    this._tool = "select";
    this._level = id;
    this._roofPart = 0;
  }

  private addLevelAt(index: number) {
    const m = this._model!;
    const used = this.usedFloors();
    const free = this.haFloors().filter((f) => !used.has(f.floor_id));
    // an HA floor that fits between the neighbours, closest to the one it's added next to
    const lvl = (l?: { floor_id?: string }) => (l?.floor_id ? this._hass?.floors?.[l.floor_id]?.level : undefined) ?? undefined;
    const lo = lvl(m.levels[index - 1]) ?? -Infinity;
    const hi = lvl(m.levels[index]) ?? Infinity;
    const fits = free.filter((f) => (f.level ?? 0) > lo && (f.level ?? 0) < hi).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    const floor = index >= m.levels.length ? fits[0] : fits[fits.length - 1];
    const seed = floor ? { floor_id: floor.floor_id, areas: this.floorAreas(floor.floor_id) } : { name: this.t("editor.new_level_name"), areas: [] };
    const { model, id } = addLevel(m, index, seed);
    this.commit(model);
    this._level = id;
    this._room = null;
    this._wall = null;
  }

  // ----- roof levels -----

  /** The roof part being edited on a roof level. */
  private _roofPart = 0;

  /** A roof level's parts on the plan: their outline, the ridge, their name; a tap picks one. */
  private renderRoofParts(l: LevelInput, pts: (poly: Vec2[]) => string) {
    const { house } = expandHouse(this._model!);
    const parts = house?.levels.find((x) => x.id === l.id)?.roofs ?? [];
    return parts.map((part, i) => {
      const th = (part.angle * Math.PI) / 180;
      const d: Vec2 = [Math.cos(th), Math.sin(th)];
      const n: Vec2 = [-Math.sin(th), Math.cos(th)];
      const as = part.polygon.map((p) => p[0] * d[0] + p[1] * d[1]);
      const cs = part.polygon.map((p) => p[0] * n[0] + p[1] * n[1]);
      const [a0, a1, c0, c1] = [Math.min(...as), Math.max(...as), Math.min(...cs), Math.max(...cs)];
      const P = (a: number, c: number): Vec2 => [a * d[0] + c * n[0], a * d[1] + c * n[1]];
      const mid = (c0 + c1) / 2;
      // the ridge: across a gable or hip roof's middle (a hip's shorter); a shed's high edge
      const inset = part.shape === "hip" ? Math.min((c1 - c0) / 2, (a1 - a0) / 2) : 0;
      const ridge = part.shape === "flat" ? null : part.shape === "shed" ? [P(a0, mid), P(a1, mid)] : [P(a0 + inset, mid), P(a1 - inset, mid)];
      return svg`<g data-roof-part=${i} @pointerdown=${(e: PointerEvent) => {
        e.stopPropagation();
        this._roofPart = i;
        this._room = null;
      }}>
        <polygon class="roof-part ${i === this._roofPart ? "selected" : ""}" points=${pts(part.polygon)}></polygon>
        ${ridge ? svg`<polyline class="roof-ridge" points=${pts(ridge)}></polyline>` : nothing}
      </g>`;
    });
  }

  private renderRoofLevelInspector(l: LevelInput) {
    const m = this._model!;
    const parts = l.roofs ?? [];
    const i = Math.min(this._roofPart, parts.length - 1);
    const part = parts[i];
    const set = (patch: Partial<RoofPartInput>, preset?: string) => this.commit(updateRoofPart(m, l.id, i, patch, preset));
    const below = m.levels[m.levels.length - 2];
    const cover = (): [number, number, number, number] => {
      const { house } = expandHouse(m);
      const top = house?.levels.find((x) => x.id === below?.id);
      const b = top?.outline.length ? bbox(top.outline) : { min: [0, 0], max: [8, 8] };
      return [b.min[0], b.min[1], b.max[0] - b.min[0], b.max[1] - b.min[1]];
    };
    const num = (label: string, value: number | undefined, fallback: number, step: number, apply: (v: number) => void, min?: number, max?: number) =>
      html`<label>${label}
        <input type="number" step=${step} min=${min ?? ""} max=${max ?? ""} .value=${String(value ?? fallback)} @change=${(e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) apply(v);
        }} />
      </label>`;
    const ridge = part?.ridge ?? "left_right";
    return html`<h2>${this.levelName(l)}</h2>
      <p class="muted">${this.t("editor.roof_level_hint")}</p>
      <div class="row">
        ${parts.map((p, j) => html`<button class=${j === i ? "primary" : ""} @click=${() => (this._roofPart = j)}>${p.id ?? j + 1}</button>`)}
        <button data-add-roof-part @click=${() => {
          const { model, index } = addRoofPart(m, l.id, cover());
          this.commit(model);
          this._roofPart = index;
        }}>${this.t("editor.roof_part_add")}</button>
      </div>
      ${part
        ? html`<h3>${this.t("editor.roof_presets")}</h3>
            <div class="row presets">
              ${Object.keys(ROOF_PRESETS).map((k) => html`<button data-roof-preset=${k} @click=${() => set({}, k)}>${this.t(`editor.roof_preset_${k}` as StringKey)}</button>`)}
            </div>
            <h3>${this.t("editor.roof_part")}</h3>
            <div class="row">
              ${(["x", "y", "w", "d"] as const).map((k, idx) =>
                num(this.t(`editor.roof_rect_${k}`), part.rect?.[idx] as number | undefined, 0, 0.1, (v) => {
                  const rect = [...(part.rect ?? cover())] as [number, number, number, number];
                  rect[idx] = v;
                  set({ rect });
                }),
              )}
            </div>
            <div class="row">
              <label>${this.t("editor.roof_shape")}
                <select @change=${(e: Event) => set({ shape: (e.target as HTMLSelectElement).value as RoofPartInput["shape"] })}>
                  ${(["gable", "hip", "shed", "flat"] as const).map((sh) => html`<option value=${sh} ?selected=${(part.shape ?? "gable") === sh}>${this.t(`editor.roof_shape_${sh}`)}</option>`)}
                </select>
              </label>
              <label>${this.t("editor.roof_ridge")}
                <select @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  set({ ridge: v === "angle" ? 30 : (v as "left_right" | "up_down") });
                }}>
                  <option value="left_right" ?selected=${ridge === "left_right"}>${this.t("editor.roof_east_west")}</option>
                  <option value="up_down" ?selected=${ridge === "up_down"}>${this.t("editor.roof_north_south")}</option>
                  <option value="angle" ?selected=${typeof ridge === "number"}>${this.t("editor.roof_ridge_angle")}</option>
                </select>
              </label>
              ${typeof ridge === "number" ? num(this.t("editor.roof_ridge_degrees"), ridge, 30, 1, (v) => set({ ridge: v }), -180, 180) : nothing}
            </div>
            <div class="row">
              ${num(this.t("editor.roof_pitch"), part.pitch, 35, 1, (v) => v > 0 && v < 75 && set({ pitch: v }), 1, 74)}
              ${num(this.t("editor.roof_overhang"), part.overhang, 0.3, 0.05, (v) => v >= 0 && v <= 2 && set({ overhang: v }), 0, 2)}
              ${num(this.t("editor.roof_offset"), part.offset, 0, 0.1, (v) => v >= -10 && v <= 10 && set({ offset: v || undefined }), -10, 10)}
            </div>
            <p class="muted">${this.t("editor.roof_offset_hint")}</p>
            ${part.shape === "shed"
              ? html`<label>${this.t("editor.roof_high")}
                  <select @change=${(e: Event) => set({ high: (e.target as HTMLSelectElement).value as Side })}>
                    ${(["north", "south", "east", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${part.high === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
                  </select>
                </label>`
              : nothing}
            <h4>${this.t("editor.roof_covering")}</h4>
            ${this.renderFinishPicker("roof", part.finish, (finish) => set({ finish }), this.t("surface.roof_clay"))}
            <h4>${this.t("editor.solar_panels")}</h4>
            <div class="row">
              ${num(this.t("editor.solar_rows"), this._solar.rows, 2, 1, (v) => (this._solar = { ...this._solar, rows: Math.max(1, Math.round(v)) }), 1, 20)}
              ${num(this.t("editor.solar_columns"), this._solar.columns, 4, 1, (v) => (this._solar = { ...this._solar, columns: Math.max(1, Math.round(v)) }), 1, 20)}
              <button data-add-solar=far @click=${() => this.commit(addSolarPanels(m, l.id, i, this._solar.rows, this._solar.columns, "far"))}>${this.t("editor.solar_add_far")}</button>
              <button data-add-solar=near @click=${() => this.commit(addSolarPanels(m, l.id, i, this._solar.rows, this._solar.columns, "near"))}>${this.t("editor.solar_add_near")}</button>
            </div>
            ${part.furniture?.length
              ? html`<p class="muted">${this.t("editor.roof_pieces", { count: part.furniture.length })}
                  <button @click=${() => set({ furniture: undefined })}>${this.t("editor.roof_pieces_clear")}</button></p>`
              : nothing}
            <button class="danger" @click=${() => {
              this.commit(removeRoofPart(m, l.id, i));
              this._roofPart = 0;
            }}>${this.t("editor.roof_part_remove")}</button>`
        : nothing}`;
  }

  private _solar = { rows: 2, columns: 4 };

  /** Turns the floor, its floor plan image along, around the middle of its rooms (else of its image). */
  private turnFloor(turn: 90 | 180 | 270) {
    const m = this._model!;
    const pts = (this.levelInput?.rooms ?? []).flatMap((r) => roomPolygon(m, r));
    const u = this._underlay?.level === this._level ? this._underlay : null;
    const box = pts.length ? bbox(pts) : u ? bbox([this.underlayToPlan(u, [0, 0]), this.underlayToPlan(u, [u.width, u.height])]) : null;
    if (!box) return;
    // on the 5 cm grid, so turned corners stay on it
    const about: Vec2 = [Math.round(((box.min[0] + box.max[0]) / 2) * 20) / 20, Math.round(((box.min[1] + box.max[1]) / 2) * 20) / 20];
    this.commit(transformLevel(m, this._level, { turn, about, by: [0, 0] }));
    if (u) {
      // the image turns around the same point
      const k = turn / 90;
      let [dx, dy] = [u.place.origin[0] - about[0], u.place.origin[1] - about[1]];
      for (let i = 0; i < k; i++) [dx, dy] = [-dy, dx];
      this.saveUnderlay({ place: { ...u.place, origin: [about[0] + dx, about[1] + dy], rotation: (u.place.rotation + turn) % 360 } });
    }
  }

  private renderLevelInspector() {
    const m = this._model!;
    const l = this.levelInput!;
    if (l.kind === "roof") return this.renderRoofLevelInspector(l);
    const index = m.levels.findIndex((x) => x.id === l.id);
    const used = this.usedFloors(l.id);
    const set = (patch: Parameters<typeof updateLevel>[2]) => this.commit(updateLevel(m, l.id, patch));
    const placed = new Set(l.rooms.map((r) => r.area_id));
    const unplaced = this.levelAreas(l).filter((a) => !placed.has(a.area_id));
    const includable = this.haFloors().filter((f) => f.floor_id !== l.floor_id && (!used.has(f.floor_id) || l.include_floors?.includes(f.floor_id)));
    return html`<h2>${this.levelName(l)}</h2>
      <label>${this.t("editor.ha_floor")}
        <select @change=${(e: Event) => set({ floor_id: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">—</option>
          ${this.haFloors().map((f) => html`<option value=${f.floor_id} ?selected=${f.floor_id === l.floor_id} ?disabled=${used.has(f.floor_id)}>${f.name}</option>`)}
        </select>
      </label>
      ${l.floor_id
        ? nothing
        : html`<label>${this.t("editor.level_name")}
            <input .value=${l.name ?? ""} @change=${(e: Event) => set({ name: (e.target as HTMLInputElement).value.trim() || undefined })} />
          </label>`}
      ${includable.length
        ? html`<h3>${this.t("editor.include_floors")}</h3>
            <div class="checks">
              ${includable.map(
                (f) => html`<label class="check"><input type="checkbox" .checked=${!!l.include_floors?.includes(f.floor_id)} @change=${(e: Event) => {
                  const on = (e.target as HTMLInputElement).checked;
                  const next = on ? [...(l.include_floors ?? []), f.floor_id] : (l.include_floors ?? []).filter((x) => x !== f.floor_id);
                  set({ include_floors: next.length ? next : undefined });
                }} />${f.name}</label>`,
              )}
            </div>
            <p class="muted">${this.t("editor.include_floors_hint")}</p>`
        : nothing}
      <div class="row">
        <label>${this.t("editor.level_height")}
          <input type="number" min="1" max="10" step="0.05" .value=${String(l.height ?? 2.6)} @change=${(e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            set({ height: v > 0 && v !== 2.6 ? v : undefined });
          }} />
        </label>
        ${this.cmInput(this.t("editor.slab"), l.slab, DEFAULTS.slab, (v) => set({ slab: v }))}
      </div>
      <label>${this.t("editor.level_elevation")}
        <input type="number" step="0.05" data-level-elevation placeholder=${this.t("editor.level_elevation_stacked")} .value=${l.elevation === undefined ? "" : String(l.elevation)} @change=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          const v = parseFloat(raw.replace(",", "."));
          set({ elevation: raw === "" || !Number.isFinite(v) ? undefined : v });
        }} />
      </label>
      <p class="muted">${this.t("editor.level_elevation_hint")}</p>
      <p class="muted">${this.t("editor.rooms_count", { count: l.rooms.length })} · ${this.t("editor.select_hint")}</p>
      ${unplaced.length
        ? html`<h3>${this.t("editor.unplaced_areas")}</h3>
            <p class="muted">${this.t("editor.unplaced_hint")}</p>
            <ul class="unplaced">
              ${unplaced.map(
                (a) => html`<li>
                  <span>${a.name}</span>
                  <button class=${this._pendingArea === a.area_id ? "active" : ""} @click=${() => {
                    this._pendingArea = a.area_id;
                    this._tool = "rect";
                  }}>${this.t("editor.draw_room")}</button>
                </li>`,
              )}
            </ul>`
        : nothing}
      ${index > 0
        ? html`<button @click=${() => {
            if (l.rooms.length && !confirm(this.t("editor.copy_below_confirm"))) return;
            this.commit(copyRooms(m, m.levels[index - 1].id, l.id));
            this._room = null;
          }}>${this.t("editor.copy_below")}</button>
          <p class="muted">${this.t("editor.copy_below_hint")}</p>`
        : nothing}
      <h3>${this.t("editor.floor_turn")}</h3>
      <p class="muted">${this.t("editor.floor_turn_hint")}</p>
      <div class="row wrap">
        <button data-floor-turn="270" title=${this.t("editor.floor_turn_left")} @click=${() => this.turnFloor(270)}>⟲ 90°</button>
        <button data-floor-turn="90" title=${this.t("editor.floor_turn_right")} @click=${() => this.turnFloor(90)}>⟳ 90°</button>
        <button data-floor-turn="180" @click=${() => this.turnFloor(180)}>180°</button>
        <button data-floor-move class=${this._floorMove ? "active" : ""} aria-pressed=${this._floorMove} @click=${() => {
          this._floorMove = !this._floorMove;
          this._underlayMove = false;
        }}>${this.t("editor.floor_move")}</button>
      </div>
      ${this._floorMove ? html`<p class="notice">${this.t("editor.floor_move_hint")}</p>` : nothing}
      ${this.renderUnderlayInspector()}
      <div class="row">
        <button @click=${() => this.addLevelAt(index + 1)}>${this.t("editor.add_level_above")}</button>
        <button @click=${() => this.addLevelAt(index)}>${this.t("editor.add_level_below")}</button>
      </div>
      <button data-duplicate-level @click=${() => {
        const copy = duplicateLevel(m, l.id);
        this.commit(copy.model);
        this._level = copy.id;
      }}>${this.t("editor.duplicate_level")}</button>
      <button class="danger" ?disabled=${m.levels.length <= 1} @click=${() => {
        if (!confirm(this.t("editor.delete_level_confirm", { name: this.levelName(l) }))) return;
        const next = deleteLevel(m, l.id);
        this.commit(next);
        this._level = next.levels[Math.max(0, index - 1)].id;
      }}>${this.t("editor.delete_level")}</button>`;
  }

  /** One own piece: its name and size, and a row per part (shape, size, place, finish). */
  private renderPieceEditor(p: PieceInput) {
    const m = this._model!;
    const save = (next: PieceInput) => this.commit(setPiece(this._model!, p.id, next));
    const num = (v: string, fallback: number) => {
      const n = parseFloat(v.replace(",", "."));
      return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : fallback;
    };
    const triple = (label: string, value: [number, number, number], set: (v: [number, number, number]) => void, min = 0.01) =>
      html`<span class="triple" title=${label}>${value.map(
        (v, k) => html`<input type="number" step="0.01" min=${min} .value=${String(v)} aria-label=${`${label} ${k + 1}`}
          @change=${(e: Event) => {
            const next = [...value] as [number, number, number];
            next[k] = Math.max(min, num((e.target as HTMLInputElement).value, v));
            set(next);
          }} />`,
      )}</span>`;
    return html`<details class="piece-editor" data-piece=${p.id}>
      <summary>${p.name ?? p.id} <span class="muted">piece:${p.id}</span></summary>
      <label>${this.t("editor.piece_name")}<input .value=${p.name ?? ""} @change=${(e: Event) => save({ ...p, name: (e.target as HTMLInputElement).value || undefined })} /></label>
      <label>${this.t("editor.piece_size")} ${triple(this.t("editor.piece_size"), p.size, (size) => save({ ...p, size }))}</label>
      ${p.parts.map(
        (part, j) => html`<div class="piece-part" data-part=${j}>
          <select aria-label=${this.t("editor.piece_shape")} @change=${(e: Event) => save({ ...p, parts: p.parts.map((x, k) => (k === j ? { ...x, shape: (e.target as HTMLSelectElement).value as typeof x.shape } : x)) })}>
            ${(["box", "cylinder", "taper", "sphere"] as const).map((s) => html`<option value=${s} ?selected=${part.shape === s}>${this.t(`editor.piece_shape_${s}`)}</option>`)}
          </select>
          ${triple(this.t("editor.piece_size"), part.size, (size) => save({ ...p, parts: p.parts.map((x, k) => (k === j ? { ...x, size } : x)) }))}
          ${triple(this.t("editor.piece_at"), part.at ?? [0, 0, 0], (at) => save({ ...p, parts: p.parts.map((x, k) => (k === j ? { ...x, at } : x)) }), -50)}
          <input class="finish" list="piece-finishes" .value=${part.finish ?? ""} placeholder=${this.t("editor.piece_finish")} aria-label=${this.t("editor.piece_finish")}
            @change=${(e: Event) => save({ ...p, parts: p.parts.map((x, k) => (k === j ? { ...x, finish: (e.target as HTMLInputElement).value || undefined } : x)) })} />
          <button title=${this.t("editor.piece_part_delete")} aria-label=${this.t("editor.piece_part_delete")} ?disabled=${p.parts.length < 2}
            @click=${() => save({ ...p, parts: p.parts.filter((_, k) => k !== j) })}>×</button>
        </div>`,
      )}
      <datalist id="piece-finishes">${Object.keys(FINISHES).map((f) => html`<option value=${f}></option>`)}</datalist>
      <div class="row">
        <button data-part-add @click=${() => save({ ...p, parts: [...p.parts, { shape: "box", size: [0.2, 0.2, 0.2], at: [0, 0, p.size[2]] }] })}>${this.t("editor.piece_part_add")}</button>
        <button class="danger" @click=${() => {
          const used = m.levels.some((l) => l.rooms.some((r) => (r.furniture ?? []).some((f) => f.model === `piece:${p.id}`)));
          if (used && !confirm(this.t("editor.piece_delete_used"))) return;
          this.commit(setPiece(m, p.id, null));
        }}>${this.t("editor.piece_delete")}</button>
      </div>
    </details>`;
  }

  /** A room's own roof windows (in the slope above it): where on the plan, their shutter and contact. */
  private renderRoomRoofWindows(r: RoomInput) {
    const m = this._model!;
    const list = r.roof_windows ?? [];
    const save = (next: NonNullable<RoomInput["roof_windows"]>) => this.commit(updateRoom(this._model!, this._level, r.id, { roof_windows: next.length ? next : undefined }));
    const { min, max } = bbox(roomPolygon(m, r));
    const areaId = r.area_id;
    return html`<details class="roof-windows" ?open=${list.length > 0}>
      <summary>${this.t("editor.room_roof_windows")}${list.length ? html` <span class="muted">(${list.length})</span>` : nothing}</summary>
      <p class="muted">${this.t("editor.room_roof_windows_hint")}</p>
      ${list.map(
        (w, i) => html`<div class="room-roof-window" data-roof-window=${i}>
          <div class="row">
            ${(["x", "y"] as const).map(
              (axis, k) => html`<label>${this.t(`editor.room_roof_window_${axis}`)}
                <input type="number" step="0.05" .value=${String(w.at[k])} @change=${(e: Event) => {
                  const v = parseFloat((e.target as HTMLInputElement).value.replace(",", "."));
                  if (!Number.isFinite(v)) return;
                  const at: [number, number] = [...w.at];
                  at[k] = Math.round(v * 100) / 100;
                  save(list.map((x, j) => (j === i ? { ...x, at } : x)));
                }} /></label>`,
            )}
          </div>
          ${this.entitySelect(this.t("editor.roof_window_shutter"), "cover", areaId, w.cover, (cover) => save(list.map((x, j) => (j === i ? { ...x, cover } : x))))}
          ${this.entitySelect(this.t("editor.opening_contact"), "binary_sensor", areaId, w.contact, (contact) => save(list.map((x, j) => (j === i ? { ...x, contact } : x))))}
          <button class="danger" @click=${() => save(list.filter((_, j) => j !== i))}>${this.t("editor.room_roof_window_delete")}</button>
        </div>`,
      )}
      <button data-room-roof-window-add @click=${() => save([...list, { at: [Math.round(((max[0] - min[0]) / 2) * 100) / 100, Math.round(((max[1] - min[1]) / 2) * 100) / 100] }])}>${this.t("editor.roof_window_add")}</button>
    </details>`;
  }

  /** Curved walls of a room or the outline: pick a wall, say how far it bows (0: straight). */
  private renderCurves(shape: ShapeInput | undefined, target: { room: string } | "outline") {
    if (!shape || !this._model) return nothing;
    const corners = shapeCorners(this._model, shape);
    if (corners.length < 3) return nothing;
    const sides = ["north", "east", "south", "west"] as const;
    const name = (i: number) => (shape.rect ? this.t(`editor.side_${sides[i]}` as StringKey) : this.t("editor.curve_wall", { n: i + 1 }));
    const pick = this._curveEdge?.target === JSON.stringify(target) ? this._curveEdge.edge : (shape.curves?.[0]?.edge ?? (shape.rect ? 2 : 0));
    const bulge = shape.curves?.find((c) => c.edge === pick)?.bulge ?? 0;
    return html`<details class="curves" ?open=${!!shape.curves?.length}>
      <summary>${this.t("editor.curves")}${shape.curves?.length ? html` <span class="muted">(${shape.curves.length})</span>` : nothing}</summary>
      <p class="muted">${this.t(target === "outline" ? "editor.curves_outline_hint" : "editor.curves_hint")}</p>
      <div class="row">
        <label>${this.t("editor.curve_which")}
          <select data-curve-edge @change=${(e: Event) => (this._curveEdge = { target: JSON.stringify(target), edge: Number((e.target as HTMLSelectElement).value) })}>
            ${corners.map((_, i) => html`<option value=${i} ?selected=${i === pick}>${name(i)}${shape.curves?.some((c) => c.edge === i) ? " ◠" : ""}</option>`)}
          </select>
        </label>
        <label>${this.t("editor.curve_bulge")}
          <input type="number" step="0.05" data-curve-bulge .value=${String(bulge)} @change=${(e: Event) => {
            const v = parseFloat((e.target as HTMLInputElement).value.replace(",", "."));
            this.commit(bendEdge(this._model!, this._level, target, pick, Number.isFinite(v) ? v : 0));
          }} />
        </label>
      </div>
    </details>`;
  }

  /** "Move to floor…": the other floors (not the roof). */
  private moveToFloor(onPick: (levelId: string) => void) {
    const others = (this._model?.levels ?? []).filter((l) => l.id !== this._level && l.kind !== "roof");
    if (!others.length) return nothing;
    return html`<label class="move-floor">${this.t("editor.move_to_floor")}
      <select @change=${(e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        (e.target as HTMLSelectElement).value = "";
        if (v) onPick(v);
      }}>
        <option value="">—</option>
        ${others.map((l) => html`<option value=${l.id}>${this.levelName(l)}</option>`)}
      </select>
    </label>`;
  }

  /**
   * A dropdown of entities of one domain; the area's own entities come first, marked ★,
   * then all others by name.
   */
  private entitySelect(label: string, domain: string, areaId: string | undefined, value: string | undefined, onChange: (id: string | undefined) => void, filter: (id: string) => boolean = () => true) {
    const hass = this._hass;
    const states = hass?.states ?? {};
    const name = (id: string) => (states[id]?.attributes.friendly_name as string | undefined) ?? id;
    const all = Object.keys(states).filter((id) => id.startsWith(`${domain}.`) && filter(id));
    const own = new Set(areaId && hass ? areaEntities(hass, areaId, domain) : []);
    const ids = [...all.filter((id) => own.has(id)), ...all.filter((id) => !own.has(id)).sort((a, b) => name(a).localeCompare(name(b)))];
    return html`<label>${label}
      <select @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value || undefined)}>
        <option value="">—</option>
        ${ids.map((id) => html`<option value=${id} ?selected=${value === id}>${own.has(id) ? `★ ${name(id)}` : name(id)}</option>`)}
      </select>
    </label>`;
  }

  /** The devices tool: energy items and robots. */
  /** A room's cameras: where each looks and how wide, its motion sensor; add or remove. */
  private renderRoomCameras(r: RoomInput) {
    const m = this._model!;
    const cams = r.cameras ?? [];
    const num = (index: number, key: "direction" | "fov" | "range", lo: number, hi: number, fallback: number) => html`<label class="inline"
      >${this.t(`editor.camera_${key}` as StringKey)}
      <input type="number" min=${lo} max=${hi} step=${key === "range" ? 0.5 : 5} .value=${String(cams[index][key] ?? fallback)} @change=${(e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (v >= lo && v <= hi) this.commit(updateCamera(m, this._level, r.id, index, { [key]: v === fallback ? undefined : v }));
      }} />
    </label>`;
    return html`<h3>${this.t("editor.cameras")}</h3>
      ${cams.length
        ? html`<ul class="lights">
            ${cams.map(
              (c, i) => html`<li>
                <span class="name">${this.entityName(c.entity)}</span>
                <button @click=${() => this.commit(removeCamera(m, this._level, r.id, i))}>${this.t("editor.light_remove")}</button>
                <span class="light-shape">${num(i, "direction", -360, 360, 180)}${num(i, "fov", 10, 360, 90)}${num(i, "range", 0.5, 50, 5)}</span>
                <span class="light-shape">${this.entitySelect(this.t("editor.camera_motion"), "binary_sensor", r.area_id, c.motion, (motion) => this.commit(updateCamera(m, this._level, r.id, i, { motion: motion || undefined })))}</span>
              </li>`,
            )}
          </ul>`
        : nothing}
      ${this.entitySelect(this.t("editor.camera_add"), "camera", r.area_id, undefined, (entity) => {
        if (!entity) return;
        // in the middle of the room; drag it to its wall
        const poly = roomPolygon(m, r);
        const { min } = bbox(poly);
        const c = labelPoint(poly);
        this.commit(addCamera(m, this._level, r.id, entity, [c[0] - min[0], c[1] - min[1]]));
      })}`;
  }

  /** How a light looks: lamp, spots (add or remove one), strip (its height), indirect. */
  private renderLightShape(r: RoomInput, l: PlacedLight) {
    const m = this._model!;
    const { min } = bbox(roomPolygon(m, r));
    const rel = (p: Vec2): [number, number] => [p[0] - min[0], p[1] - min[1]];
    const set = (shape: Parameters<typeof setLightShape>[4]) => this.commit(setLightShape(m, this._level, r.id, l.entity, shape, rel(l.at)));
    const spots = l.spots.map(rel);
    return html`<span class="light-shape">
      <select aria-label=${this.t("editor.light_type")} @change=${(e: Event) => set({ type: (e.target as HTMLSelectElement).value as LightType })}>
        ${LIGHT_TYPES.map((t) => html`<option value=${t} ?selected=${l.type === t}>${this.t(`editor.light_type_${t}` as StringKey)}</option>`)}
      </select>
      ${l.type === "spot"
        ? html`<button title=${this.t("editor.light_spot_add")} @click=${() => {
              // the next spot continues the row (or starts it east of the first)
              const last = spots.at(-1) ?? rel(l.at);
              const prev = spots.length > 1 ? spots.at(-2)! : rel(l.at);
              const step: [number, number] = spots.length ? [last[0] - prev[0], last[1] - prev[1]] : [0.8, 0];
              set({ spots: [...spots, [last[0] + step[0], last[1] + step[1]]] });
            }}>+</button>
            <button ?disabled=${!spots.length} title=${this.t("editor.light_spot_remove")} @click=${() => set({ spots: spots.slice(0, -1) })}>−</button>`
        : nothing}
      ${l.type === "strip"
        ? html`<label class="inline">${this.t("editor.light_height")}
            <input type="number" min="0" max="6" step="0.05" placeholder=${this.t("editor.default")} .value=${l.height === undefined ? "" : String(l.height)} @change=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              set({ height: v === "" ? null : Math.max(0, Math.min(6, Number(v))) });
            }} />
          </label>`
        : nothing}
    </span>`;
  }

  // ----- wall view -----


  /**
   * What stands on one side of a room, seen from inside it: the wall, its doors and
   * windows, and the pieces against it (hanging or standing), with their heights and
   * gaps. Drag them along the wall, and wall pieces and windows up and down.
   */
  private wallViewItems() {
    const wv = this._wallView;
    const m = this._model;
    if (!wv || !m) return null;
    const { house } = expandHouse(m);
    const level = house?.levels.find((l) => l.id === this._level);
    const room = level?.rooms.find((r) => r.id === wv.room);
    if (!level || !room) return null;
    const { min, max } = bbox(room.polygon);
    const ns = wv.side === "north" || wv.side === "south";
    const span = ns ? max[0] - min[0] : max[1] - min[1];
    const wallAt = { north: min[1], south: max[1], west: min[0], east: max[0] }[wv.side];
    type Item = { key: string; kind: "opening" | "piece"; label: string; u: number; w: number; z: number; h: number; style: string; vertical: boolean };
    const items: Item[] = [];
    level.openings.forEach((o) => {
      if (o.room !== wv.room || o.side !== wv.side) return;
      items.push({ key: `o:${JSON.stringify(o.source)}`, kind: "opening", label: this.t(`editor.type_${o.type}` as StringKey), u: o.at + o.width / 2, w: o.width, z: o.sill, h: o.height, style: o.type, vertical: o.type === "window" });
    });
    room.furniture.forEach((f, i) => {
      const along = (f.rotation % 180 === 0) === ns ? f.size[0] : f.size[1];
      const across = (f.rotation % 180 === 0) === ns ? f.size[1] : f.size[0];
      const off = Math.abs((ns ? f.at[1] : f.at[0]) - wallAt);
      // standing or hanging against this wall
      if (off > across / 2 + 0.25) return;
      const z = f.elevation ?? level.height - f.height;
      items.push({ key: `f:${i}`, kind: "piece", label: this.t(`furniture.${f.type}` as StringKey), u: (ns ? f.at[0] - min[0] : f.at[1] - min[1]), w: along, z, h: f.height, style: f.mount, vertical: f.mount === "wall" });
    });
    return { span, height: level.height, items, flip: wv.side === "south" || wv.side === "west", room: room.id };
  }

  private renderWallView() {
    const v = this.wallViewItems();
    if (!v || !this._wallView) return nothing;
    const { span, height, items, flip } = v;
    // drawn in centimetres (browsers keep text from getting tiny in metres)
    const X = (u: number) => (flip ? span - u : u) * 100;
    const Y = (z: number) => (height - z) * 100;
    const sel = items.find((i) => i.key === this._wallView!.sel);
    const n = (x: number) => this.n(Math.round(x * 100) / 100);
    // gaps of the selected item to the wall's ends and its height off the floor
    const dims = sel
      ? svg`<g class="wv-dims">
          <line x1=${X(0)} y1=${Y(sel.z + sel.h / 2)} x2=${X(sel.u - sel.w / 2)} y2=${Y(sel.z + sel.h / 2)}></line>
          <text x=${(X(0) + X(sel.u - sel.w / 2)) / 2} y=${Y(sel.z + sel.h / 2) - 6}>${n(sel.u - sel.w / 2)}</text>
          <line x1=${X(sel.u + sel.w / 2)} y1=${Y(sel.z + sel.h / 2)} x2=${X(span)} y2=${Y(sel.z + sel.h / 2)}></line>
          <text x=${(X(sel.u + sel.w / 2) + X(span)) / 2} y=${Y(sel.z + sel.h / 2) - 6}>${n(span - sel.u - sel.w / 2)}</text>
          ${sel.z > 0.01 ? svg`<line x1=${X(sel.u)} y1=${Y(0)} x2=${X(sel.u)} y2=${Y(sel.z)}></line><text x=${X(sel.u) + 5} y=${Y(sel.z / 2)} text-anchor="start">${n(sel.z)}</text>` : nothing}
        </g>`
      : nothing;
    const room = this.levelInput?.rooms.find((r) => r.id === v.room);
    return html`<div class="wall-view" @pointermove=${this.onWallViewMove} @pointerup=${this.onWallViewUp} @pointercancel=${this.onWallViewUp}>
      <header>
        <strong>${room ? this.roomName(room) : v.room} · ${this.t(`editor.side_${this._wallView.side}` as StringKey)}</strong>
        <span class="muted">${this.t("editor.wall_view_hint")}</span>
        <button class="close" aria-label=${this.t("editor.close")} @click=${() => (this._wallView = null)}>×</button>
      </header>
      <svg viewBox="-25 -30 ${span * 100 + 50} ${height * 100 + 60}" preserveAspectRatio="xMidYMid meet">
        <rect class="wv-bg" x="0" y="0" width=${span * 100} height=${height * 100}></rect>
        <line class="wv-floor" x1="-25" y1=${height * 100} x2=${span * 100 + 25} y2=${height * 100}></line>
        ${items.map((i) => {
          const x = Math.min(X(i.u - i.w / 2), X(i.u + i.w / 2));
          return svg`<g class="wv-item wv-${i.kind} wv-${i.style} ${i.key === this._wallView!.sel ? "selected" : ""}" data-wv=${i.key} @pointerdown=${(e: PointerEvent) => this.onWallViewDown(e, i.key, i.u, i.z)}>
            <rect x=${x} y=${Y(i.z + i.h)} width=${i.w * 100} height=${i.h * 100}></rect>
            <text x=${x + (i.w * 100) / 2} y=${Y(i.z + i.h / 2)}>${i.label}</text>
            <text class="size" x=${x + (i.w * 100) / 2} y=${Y(i.z + i.h / 2) + 14}>${n(i.w)} × ${n(i.h)}</text>
          </g>`;
        })}
        ${dims}
        <text class="wv-span" x=${span * 50} y=${height * 100 + 22}>${n(span)} m</text>
      </svg>
    </div>`;
  }

  private onWallViewDown(e: PointerEvent, key: string, u: number, z: number) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    this._wallView = { ...this._wallView!, sel: key };
    this.wallDrag = { key, origin: clone(this._model!), start: this.wallViewPoint(e), u, z, moved: false };
  }

  /** A pointer position in metres along the wall (from its left end as seen) and up. */
  private wallViewPoint(e: PointerEvent): Vec2 {
    const svgEl = this.renderRoot.querySelector<SVGSVGElement>(".wall-view svg");
    const ctm = svgEl?.getScreenCTM();
    if (!svgEl || !ctm) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [p.x / 100, p.y / 100];
  }

  private onWallViewMove = (e: PointerEvent) => {
    const d = this.wallDrag;
    const v = this.wallViewItems();
    if (!d || !v) return;
    const p = this.wallViewPoint(e);
    const dx = (p[0] - d.start[0]) * (v.flip ? -1 : 1);
    const dz = -(p[1] - d.start[1]);
    if (!d.moved && Math.hypot(dx, dz) < 0.02) return;
    d.moved = true;
    const item = v.items.find((i) => i.key === d.key);
    if (!item) return;
    // 5 cm steps, kept on the wall
    const snap = (x: number) => Math.round(x * 20) / 20;
    const u = Math.max(item.w / 2, Math.min(v.span - item.w / 2, snap(d.u + dx)));
    const z = Math.max(0, Math.min(v.height - item.h, snap(d.z + dz)));
    if (d.key.startsWith("o:")) {
      const src = JSON.parse(d.key.slice(2)) as OpeningSource;
      this._model = updateOpening(d.origin, this._level, src, { at: Math.round((u - item.w / 2) * 100) / 100, ...(item.vertical ? { sill: z } : {}) });
    } else {
      const index = Number(d.key.slice(2));
      const r = this.levelInput?.rooms.find((x) => x.id === v.room);
      const f = r?.furniture?.[index];
      if (!r || !f) return;
      const ns = this._wallView!.side === "north" || this._wallView!.side === "south";
      // furniture stands room-relative, as the wall view measures
      const at: [number, number] = ns ? [Math.round(u * 100) / 100, f.at[1]] : [f.at[0], Math.round(u * 100) / 100];
      this._model = updateFurniture(d.origin, this._level, r.id, index, { at, ...(item.vertical ? { elevation: z } : {}) });
    }
  };

  private onWallViewUp = () => {
    const d = this.wallDrag;
    this.wallDrag = null;
    if (d?.moved && JSON.stringify(d.origin) !== JSON.stringify(this._model)) this.commit(this._model!, d.origin);
  };

  /** A room's lights and furniture (part of the room inspector). */
  private renderRoomObjects(r: RoomInput) {
    const m = this._model!;
    const lamps = this.levelLamps();
    const own = lamps.filter((l) => l.roomId === r.id);
    const hidden = (r.lights ?? []).filter((l) => l.hidden);
    const areaLights = new Set(r.area_id && this._hass ? areaEntities(this._hass, r.area_id, "light") : []);
    const shown = new Set([...own.map((l) => l.entity), ...hidden.map((l) => l.entity)]);
    return html`<h3>${this.t("editor.lights")}</h3>
      ${own.length || hidden.length
        ? html`<ul class="lights">
            ${own.map(
              (l) => html`<li>
                <span class="name">${this.entityName(l.entity)}<small class="muted">${l.auto ? this.t("editor.light_auto") : this.t("editor.light_placed")}</small></span>
                ${l.piece ? nothing : this.renderLightShape(r, l)}
                ${l.auto ? nothing : html`<button title=${this.t("editor.light_reset_hint")} @click=${() => this.commit(placeLight(m, this._level, r.id, l.entity))}>${this.t("editor.light_reset")}</button>`}
                ${areaLights.has(l.entity)
                  ? html`<button @click=${() => this.commit(setLightHidden(m, this._level, r.id, l.entity, true))}>${this.t("editor.light_hide")}</button>`
                  : html`<button @click=${() => this.commit(removeLight(m, this._level, r.id, l.entity))}>${this.t("editor.light_remove")}</button>`}
              </li>`,
            )}
            ${hidden.map(
              (l) => html`<li class="hidden">
                <span class="name">${this.entityName(l.entity)}<small class="muted">${this.t("editor.light_hidden")}</small></span>
                <button @click=${() => this.commit(removeLight(m, this._level, r.id, l.entity))}>${this.t("editor.light_show")}</button>
              </li>`,
            )}
          </ul>`
        : html`<p class="muted">${this.t("editor.no_lights")}</p>`}
      ${this.entitySelect(this.t("editor.light_add"), "light", r.area_id, undefined, (entity) => entity && this.commit(placeLight(m, this._level, r.id, entity)), (id) => !shown.has(id))}
      <p class="muted">${this.t("editor.lights_hint")}</p>
      ${this.renderRoomCameras(r)}
      <h3>${this.t("editor.furniture")}</h3>
      ${(r.furniture ?? []).length
        ? html`<ul class="lights">
            ${r.furniture!.map(
              (f, i) => html`<li>
                <span class="name">${this.t(`furniture.${f.type}` as StringKey)}</span>
                <button @click=${() => (this._furn = { room: r.id, index: i })}>${this.t("editor.edit")}</button>
              </li>`,
            )}
          </ul>`
        : nothing}
      <button @click=${() => {
        this.setTool("furniture");
        // where the pieces come from, beside the furniture tool
        const b = this.renderRoot.querySelector('aside.tools button[data-tool="furniture"]') as HTMLElement | null;
        if (b) this.openFlyout("furniture", b);
      }}>${this.t("editor.furniture_add")}</button>`;
  }

  /**
   * The furniture library, grouped like a home is furnished, from one source at a time:
   * drag a piece onto a room, or click it to put it into the selected room.
   */
  private renderLibrary(room: RoomInput | null) {
    const source = this._librarySource;
    const typeName = (t: FurnitureType) => this.t(`furniture.${t}` as StringKey);
    let groups: LibraryGroup[] = [];
    let status: unknown = nothing;
    if (source === "builtin")
      groups = builtinGroups().map((g) => ({
        ...g,
        items: g.items.map((i) => (i.nameKey ? { ...i, name: this.t(i.nameKey as StringKey), tags: [...(i.tags ?? []), ...this.aliases(i.key.slice(7)), this.t(`furniture.group_${g.id}` as StringKey)] } : i)),
      }));
    else if (source === "polyhaven") {
      const c = this._polyhaven;
      if (!c) {
        this.loadPolyhaven();
        status = html`<p class="muted">${this.t("editor.library_loading")}</p>`;
      } else if ("error" in c) status = html`<p class="muted">${this.t("editor.library_polyhaven_error", { error: c.error })}</p>`;
      else groups = polyhavenGroups(c);
    } else if (source === "sketchfab") {
      status = this.renderSketchfab(room);
    } else {
      if (!this._customModels) this.loadCustomModels();
      groups = customGroups(this._customModels ?? [], this._model?.pieces ?? []);
    }
    groups = filterGroups(groups, this._libraryFilter, typeName);
    const credit =
      source === "polyhaven"
        ? html`<p class="muted credit">${this.t("editor.library_polyhaven_credit")} <a href="https://polyhaven.com" target="_blank" rel="noopener">polyhaven.com</a></p>`
        : nothing;
    return html`${credit}
      <p class="muted">${this.t(room ? "editor.library_hint_room" : "editor.library_hint", { room: room ? this.roomName(room) : "" })}</p>
      ${this.renderSnapPieces()}
      ${source === "custom"
        ? html`<label class="file upload-model"
            >${this.t("editor.library_upload")}<input type="file" accept=".glb,model/gltf-binary" @change=${(e: Event) => this.uploadModel(e)}
          /></label>
          <p class="muted">${this.t("editor.library_upload_hint")}</p>`
        : nothing}
      ${this._libraryError ? html`<p class="error">${this._libraryError}</p>` : nothing}
      ${source === "sketchfab"
        ? nothing
        : html`<input class="library-search" type="search" placeholder=${this.t("editor.library_search")} aria-label=${this.t("editor.library_search")} .value=${this._libraryFilter}
            @input=${(e: Event) => (this._libraryFilter = (e.target as HTMLInputElement).value)} />`}
      ${status}
      ${status === nothing && !groups.length ? html`<p class="muted">${this.t(source === "custom" && !this._libraryFilter ? "editor.library_no_uploads" : "editor.library_none")}</p>` : nothing}
      ${groups.map(
        (g) => html`${this.groupHead(`furniture:${g.id}`, this.t(`furniture.group_${g.id}` as StringKey))}
          ${this.isFolded(`furniture:${g.id}`) ? nothing : html`<div class="library">
            ${g.items.map((item) => {
              const name = item.name ?? typeName(item.type);
              return html`<div class="piece-wrap">
                <button class="piece ${this._placing === item.key ? "placing" : ""}" draggable="true" title=${item.credit ? `${name} — ${item.credit}` : name} data-type=${item.type} data-key=${item.key}
                  @dragstart=${(e: DragEvent) => {
                    this.libraryDrag = item;
                    e.dataTransfer?.setData("text/plain", item.key);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
                  }}
                  @dragend=${() => (this.libraryDrag = null)}
                  @click=${() => room && this.addFurnitureAt(item, labelPoint(this.inner(room)), room.id)}>
                  ${item.thumb ? html`<img src=${item.thumb} alt="" loading="lazy" draggable="false" />` : html`<span class="no-thumb"><ha-icon icon="mdi:cube-outline"></ha-icon></span>`}
                  <span>${name}</span>
                </button>
                ${source === "custom"
                  ? html`<button class="remove-model" title=${this.t("editor.library_delete_model")} aria-label=${this.t("editor.library_delete_model")}
                      @click=${() => this.deleteModel(item.model.slice(7), name)}>×</button>`
                  : nothing}
              </div>`;
            })}
          </div>`}`,
      )}`;
  }

  /** A library group's heading, which folds the group shut or open. */
  private groupHead(key: string, title: string) {
    const open = !this.isFolded(key);
    return html`<h4 class="group-head"><button data-group=${key} aria-expanded=${open} @click=${() => {
      const folded = new Set(this._folded);
      if (open) folded.add(key);
      else folded.delete(key);
      this._folded = folded;
      writePref("homeslice-folded", JSON.stringify([...folded]));
    }}><ha-icon icon=${open ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>${title}</button></h4>`;
  }

  /** Whether a library group is folded shut (a search shows every group). */
  private isFolded(key: string): boolean {
    return this._folded.has(key) && !this._libraryFilter.trim();
  }

  /** Other words for a piece in English, German and the user's language (people search in the words they think in). */
  private aliases(kind: string): string[] {
    return [...new Set([en, de, texts(this._hass?.locale?.language)])].map((l) => (l as Record<string, string>)[`alias.${kind}`] ?? "").filter(Boolean);
  }

  /** Where a piece's model is from and its name, e.g. "Poly Haven · Sofa 01". */
  private modelName(model: string): string {
    const [source, id] = model.includes(":") ? model.split(":", 2) : [model, ""];
    if (source === "kenney") return this.t("editor.library_builtin");
    if (source === "builtin") return `${this.t("editor.library_builtin")} · ${this.t("editor.library_simple")}`;
    if (source === "modern") return `${this.t("editor.library_builtin")} · ${this.t(`modern.${id}` as StringKey)}`;
    const own = source === "custom" ? this._customModels?.find((m) => m.id === id) : undefined;
    // a Sketchfab model: its author and licence go with its name (attribution)
    const custom = own ? [own.name, credit(own)].filter(Boolean).join(" — ") : undefined;
    const polyhaven = source === "polyhaven" && this._polyhaven && !("error" in this._polyhaven) ? this._polyhaven.find((a) => a.id === id)?.name : undefined;
    return `${this.t(`editor.library_${source}` as StringKey)} · ${custom ?? polyhaven ?? humanize(id)}`;
  }

  private loadTextures() {
    if (this._textures || this.texturesRequest || !this._hass) return;
    this.texturesRequest = this._hass
      .callWS<PolyhavenTexture[]>({ type: "homeslice/assets/textures" })
      .then((c) => (this._textures = c))
      .catch((e: { message?: string }) => (this._textures = { error: e?.message ?? String(e) }))
      .finally(() => (this.texturesRequest = null));
  }
  private texturesRequest: Promise<unknown> | null = null;

  private loadPolyhaven() {
    if (this._polyhaven || this.polyhavenRequest || !this._hass) return;
    this.polyhavenRequest = this._hass
      .callWS<PolyhavenAsset[]>({ type: "homeslice/assets/polyhaven" })
      .then((c) => (this._polyhaven = c))
      .catch((e: { message?: string }) => (this._polyhaven = { error: e?.message ?? String(e) }))
      .finally(() => (this.polyhavenRequest = null));
  }
  private polyhavenRequest: Promise<unknown> | null = null;

  /** After an export with Sketchfab models in it: "for your own backup only" and the credits it needs. */
  private licenceNotice(models: CustomAsset[]) {
    const from = models.filter((m) => m.source === "sketchfab");
    if (!from.length) return;
    const line = (m: CustomAsset) => `${m.name} (${credit(m)})`;
    const own = from.filter((m) => !m.shareable).map(line);
    const credits = from.filter((m) => m.shareable && m.licence?.slug !== "cc0").map(line);
    const notice = [own.length ? this.t("editor.backup_private", { models: own.join(", ") }) : "", credits.length ? this.t("editor.backup_credits", { models: credits.join(", ") }) : ""].filter(Boolean).join(" ");
    if (notice) this._settings = { ...(this._settings ?? {}), notice };
  }

  // ----- Sketchfab: with the user's own API token, kept in Home Assistant -----

  private loadSketchfab() {
    if (this.sketchfabRequest || !this._hass) return;
    this.sketchfabRequest = this._hass
      .callWS<{ configured: boolean; username: string | null }>({ type: "homeslice/sketchfab" })
      .then((s) => (this._sketchfab = s))
      .catch(() => (this._sketchfab = { configured: false, username: null }))
      .finally(() => (this.sketchfabRequest = null));
  }
  private sketchfabRequest: Promise<unknown> | null = null;

  private async sketchfabSearch(query: string, more = false) {
    this._sfError = "";
    try {
      const r = await this._hass!.callWS<{ results: SketchfabHit[]; next: string | null }>({ type: "homeslice/sketchfab/search", query, ...(more && this._sfResults?.next ? { cursor: this._sfResults.next } : {}) });
      this._sfResults = { query, results: more ? [...(this._sfResults?.results ?? []), ...r.results] : r.results, next: r.next };
    } catch (err) {
      this._sfError = String((err as { message?: string }).message ?? err);
    }
  }

  /** A Sketchfab model in Home Assistant: downloaded once (null when that fails: the reason is shown). */
  private async sketchfabModel(uid: string): Promise<CustomAsset | null> {
    const known = this._customModels?.find((m) => m.source === "sketchfab" && m.uid === uid);
    if (known) return known;
    if (this._sfBusy) return null;
    this._sfBusy = uid;
    this._sfError = "";
    try {
      const stored = await this._hass!.callWS<CustomAsset>({ type: "homeslice/sketchfab/fetch", uid });
      this._customModels = [...(this._customModels ?? []), stored];
      return stored;
    } catch (err) {
      this._sfError = String((err as { message?: string }).message ?? err);
      return null;
    } finally {
      this._sfBusy = null;
    }
  }

  /** The library item of a Sketchfab result (placing it downloads it first). */
  private sketchfabItem = (hit: SketchfabHit): LibraryItem => ({ key: `sketchfab:${hit.uid}`, type: "item", model: `sketchfab:${hit.uid}`, name: hit.name, thumb: hit.thumbnail ?? "" });

  /** A click on a result: placed in the picked room, else just downloaded (then in Custom). */
  private async sketchfabFetch(hit: SketchfabHit, room: RoomInput | null) {
    if (room) await this.addFurnitureAt(this.sketchfabItem(hit), labelPoint(this.inner(room)), room.id);
    else {
      const stored = await this.sketchfabModel(hit.uid);
      if (stored) this._sfError = this.t("editor.sketchfab_added", { name: stored.name });
    }
  }

  private renderSketchfab(room: RoomInput | null) {
    if (!this._sketchfab) {
      this.loadSketchfab();
      return html`<p class="muted">${this.t("editor.library_loading")}</p>`;
    }
    if (!this._customModels) this.loadCustomModels();
    if (!this._sketchfab.configured)
      return html`<div class="sketchfab-token">
        <p class="muted">${this.t("editor.sketchfab_hint")}
          <a href="https://sketchfab.com/settings/password" target="_blank" rel="noopener">sketchfab.com/settings/password</a></p>
        <label>${this.t("editor.sketchfab_token")}<input type="password" data-sketchfab-token autocomplete="off" /></label>
        <button class="primary" @click=${async (e: Event) => {
          const input = (e.target as HTMLElement).parentElement!.querySelector("input")!;
          try {
            this._sketchfab = await this._hass!.callWS({ type: "homeslice/sketchfab/token", token: input.value });
            this._sfError = "";
          } catch (err) {
            this._sfError = String((err as { message?: string }).message ?? err);
          }
        }}>${this.t("editor.sketchfab_save")}</button>
        ${this._sfError ? html`<p class="error">${this._sfError}</p>` : nothing}
      </div>`;
    const res = this._sfResults;
    const mb = (b: number | null) => (b ? `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB` : "");
    return html`<div class="sketchfab">
      <p class="muted">${this.t("editor.sketchfab_signed_in", { name: this._sketchfab.username ?? "" })}
        <button class="link" @click=${async () => {
          this._sketchfab = await this._hass!.callWS({ type: "homeslice/sketchfab/token", token: null });
          this._sfResults = null;
        }}>${this.t("editor.sketchfab_forget")}</button></p>
      <p class="muted">${this.t("editor.sketchfab_licence_hint")}</p>
      <input type="search" class="sketchfab-search" placeholder=${this.t("editor.sketchfab_search")} aria-label=${this.t("editor.sketchfab_search")} .value=${res?.query ?? ""}
        @keydown=${(e: KeyboardEvent) => e.key === "Enter" && void this.sketchfabSearch((e.target as HTMLInputElement).value.trim())} />
      ${this._sfError ? html`<p class="muted">${this._sfError}</p>` : nothing}
      ${this.renderSketchfabDownloaded(room)}
      ${res ? html`<h4>${this.t("editor.sketchfab_results")}</h4>` : nothing}
      <div class="library">
        ${(res?.results ?? []).map(
          (hit) => html`<div class="piece-wrap">
            <button class="piece ${this._sfBusy === hit.uid ? "placing" : ""}" data-sketchfab=${hit.uid} title=${`${hit.name} — ${[hit.author, hit.licence.label].filter(Boolean).join(" · ")}`}
              draggable="true" ?disabled=${!!this._sfBusy}
              @dragstart=${(e: DragEvent) => {
                this.libraryDrag = this.sketchfabItem(hit);
                e.dataTransfer?.setData("text/plain", hit.uid);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
              }}
              @dragend=${() => (this.libraryDrag = null)}
              @click=${() => void this.sketchfabFetch(hit, room)}>
              ${hit.thumbnail ? html`<img src=${hit.thumbnail} alt="" loading="lazy" draggable="false" />` : html`<span class="no-thumb"><ha-icon icon="mdi:cube-outline"></ha-icon></span>`}
              <span>${hit.name}</span>
              <small class="muted">${[hit.licence.label, mb(hit.bytes)].filter(Boolean).join(" · ")}</small>
            </button>
            ${this.sketchfabDownloadButton(hit)}
          </div>`,
        )}
      </div>
      ${res?.next ? html`<button @click=${() => void this.sketchfabSearch(res.query, true)}>${this.t("editor.sketchfab_more")}</button>` : nothing}
      ${res && !res.results.length ? html`<p class="muted">${this.t("editor.library_none")}</p>` : nothing}
    </div>`;
  }

  /** On a result: download it into Home Assistant without placing it (or: it is there already). */
  private sketchfabDownloadButton(hit: SketchfabHit) {
    const have = this._customModels?.some((m) => m.source === "sketchfab" && m.uid === hit.uid);
    const busy = this._sfBusy === hit.uid;
    const label = this.t(have ? "editor.sketchfab_have" : "editor.sketchfab_download");
    return html`<button class="fetch-model ${have ? "have" : ""}" data-sketchfab-download=${hit.uid} title=${label} aria-label=${label} ?disabled=${have || !!this._sfBusy}
      @click=${() => void this.sketchfabModel(hit.uid)}>
      <ha-icon icon=${busy ? "mdi:progress-download" : have ? "mdi:check" : "mdi:download"}></ha-icon>
    </button>`;
  }

  /** The Sketchfab models in Home Assistant already: placed like any piece, or removed. */
  private renderSketchfabDownloaded(room: RoomInput | null) {
    const mine = (this._customModels ?? []).filter((m) => m.source === "sketchfab");
    if (!mine.length) return nothing;
    const [group] = customGroups(mine, []);
    return html`<h4>${this.t("editor.sketchfab_downloaded")}</h4>
      <div class="library sketchfab-downloaded">
        ${group.items.map((item) => {
          const name = item.name ?? "";
          return html`<div class="piece-wrap">
            <button class="piece ${this._placing === item.key ? "placing" : ""}" draggable="true" title=${item.credit ? `${name} — ${item.credit}` : name} data-key=${item.key}
              @dragstart=${(e: DragEvent) => {
                this.libraryDrag = item;
                e.dataTransfer?.setData("text/plain", item.key);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
              }}
              @dragend=${() => (this.libraryDrag = null)}
              @click=${() => room && this.addFurnitureAt(item, labelPoint(this.inner(room)), room.id)}>
              ${item.thumb ? html`<img src=${item.thumb} alt="" loading="lazy" draggable="false" />` : html`<span class="no-thumb"><ha-icon icon="mdi:cube-outline"></ha-icon></span>`}
              <span>${name}</span>
            </button>
            <button class="remove-model" title=${this.t("editor.library_delete_model")} aria-label=${this.t("editor.library_delete_model")}
              @click=${() => this.deleteModel(item.model.slice(7), name)}>×</button>
          </div>`;
        })}
      </div>`;
  }

  private loadCustomModels() {
    if (this.customRequest || !this._hass) return;
    this.customRequest = this._hass
      .callWS<CustomAsset[]>({ type: "homeslice/assets/custom" })
      .then((c) => (this._customModels = c))
      .catch(() => (this._customModels = []))
      .finally(() => (this.customRequest = null));
  }
  private customRequest: Promise<unknown> | null = null;

  /** Uploads a .glb into Home Assistant and adds it to the library. */
  private async uploadModel(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !this._hass) return;
    this._libraryError = "";
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    try {
      const added = await this._hass.callWS<CustomAsset>({ type: "homeslice/assets/custom/upload", name: file.name.replace(/\.glb$/i, ""), data });
      this._customModels = [...(this._customModels ?? []), added].sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      this._libraryError = (err as { message?: string })?.message ?? String(err);
    }
  }

  private async deleteModel(id: string, name: string) {
    if (!this._hass) return;
    const used = (this._model?.levels ?? []).some((l) => l.rooms.some((r) => (r.furniture ?? []).some((f) => f.model === `custom:${id}`)));
    if (!confirm(this.t(used ? "editor.library_delete_used" : "editor.library_delete_confirm", { name }))) return;
    await this._hass.callWS({ type: "homeslice/assets/custom/delete", asset: id });
    this._customModels = (this._customModels ?? []).filter((m) => m.id !== id);
  }

  /** Adds a piece where it was dropped (wall pieces go against the nearest wall) and selects it. */
  private async addFurnitureAt(item: LibraryItem, world: Vec2, roomId?: string) {
    // a model still to download or load: a placeholder where it will land meanwhile
    const remote = /^(sketchfab|polyhaven|custom):/.test(item.model);
    if (remote) {
      if (this._arriving) return;
      const hit = item.model.startsWith("sketchfab:") ? this._sfResults?.results.find((h) => h.uid === item.model.slice(10)) : undefined;
      this._arriving = { at: world, size: item.size ?? [0.8, 0.8], name: item.name ?? "", bytes: hit?.bytes ?? undefined };
    }
    try {
      await this.placeFurniture(item, world, roomId);
    } finally {
      if (remote) this._arriving = null;
    }
  }

  /** The placeholder of a piece on its way: its footprint (or a guess), a spinner, its name and download size. */
  private renderArriving() {
    const a = this._arriving;
    if (!a) return nothing;
    const [x, y] = this.toScreen(a.at);
    const w = Math.max(24, a.size[0] * this._view.scale);
    const h = Math.max(24, a.size[1] * this._view.scale);
    const r = Math.min(w, h, 40) / 3;
    const label = a.bytes ? `${a.name} · ${(a.bytes / 1e6).toFixed(1)} MB` : a.name;
    return svg`<g class="arriving" data-arriving>
      <rect x=${x - w / 2} y=${y - h / 2} width=${w} height=${h} rx="4"></rect>
      <circle class="spinner" cx=${x} cy=${y} r=${r} style=${`transform-origin: ${x}px ${y}px`}></circle>
      <text x=${x} y=${y + h / 2 + 14} text-anchor="middle">${label}</text>
      <title>${this.t("editor.arriving", { name: a.name })}</title>
    </g>`;
  }

  private async placeFurniture(item: LibraryItem, world: Vec2, roomId?: string) {
    // a Sketchfab model: into Home Assistant first (once), then placed like an upload
    if (item.model.startsWith("sketchfab:")) {
      const stored = await this.sketchfabModel(item.model.slice(10));
      if (!stored) return;
      item = { ...item, key: `custom:${stored.id}`, model: `custom:${stored.id}`, name: stored.name };
    }
    const type = item.type;
    let size = item.size;
    let height = item.height;
    if (item.model.startsWith("polyhaven:") || item.model.startsWith("custom:")) {
      if (this._placing) return;
      this._placing = item.key;
      this._libraryError = "";
      try {
        // Poly Haven's: into Home Assistant first (once); every device loads it from there
        if (item.model.startsWith("polyhaven:")) await this._hass!.callWS({ type: "homeslice/assets/polyhaven/fetch", asset: item.model.slice(10) });
        // uploaded ones: as big as the model says (glTF is in metres)
        if (!size) {
          const loaded = await loadModel(item.model);
          if (!loaded) throw new Error(this.t("editor.library_model_failed"));
          const { Box3, Vector3 } = await import("three");
          const s = new Box3().setFromObject(loaded).getSize(new Vector3());
          const r = (v: number) => Math.max(0.05, Math.round(v * 100) / 100);
          size = [r(s.x), r(s.z)];
          height = r(s.y);
        }
      } catch (err) {
        this._libraryError = (err as { message?: string })?.message ?? String(err);
        return;
      } finally {
        this._placing = null;
      }
    }
    const m = this._model!;
    const rooms = (this.levelInput?.rooms ?? []).filter((r) => r.kind !== "void");
    const room = rooms.find((r) => r.id === roomId) ?? roomAt(m, rooms, world);
    if (!room) return;
    const { min } = bbox(roomPolygon(m, room));
    const def = FURNITURE[type];
    const depth = size?.[1] ?? def.size[1];
    const onWall = (item.mount ?? def.mount) === "wall" && this._snapPieces ? wallSnap(this.inner(room), world, depth) : null;
    const p = onWall?.at ?? world;
    const at: [number, number] = [Math.round((p[0] - min[0]) * 100) / 100, Math.round((p[1] - min[1]) * 100) / 100];
    const piece: FurnitureInput = { type, at, model: item.model, ...(onWall?.rotation ? { rotation: onWall.rotation } : {}) };
    if (item.mount && item.mount !== (def.mount ?? "floor")) piece.mount = item.mount;
    if (item.elevation !== undefined && item.elevation !== def.elevation) piece.elevation = item.elevation;
    if (size && (size[0] !== def.size[0] || size[1] !== def.size[1])) piece.size = size;
    if (height !== undefined && height !== def.height) piece.height = height;
    const { model, index } = addFurniture(m, this._level, room.id, piece);
    this.commit(model);
    this._room = room.id;
    this._furn = { room: room.id, index };
  }

  /** Footprints of the level's other pieces with the same mount (turned by right angles only). */
  private footprints(room: string, index: number, mount: FurnitureMount): { c: Vec2; half: Vec2 }[] {
    const m = this._model!;
    return (this.levelInput?.rooms ?? []).flatMap((r) => {
      const { min } = bbox(roomPolygon(m, r));
      return (r.furniture ?? []).flatMap((f, i) => {
        if ((r.id === room && i === index) || mountOf(f) !== mount) return [];
        const half = footprintHalf(f.size ?? FURNITURE[f.type].size, f.rotation ?? 0);
        return half ? [{ c: [min[0] + f.at[0], min[1] + f.at[1]] as Vec2, half }] : [];
      });
    });
  }

  /** A copy of the selected piece, right next to it (to its east, or south if it is turned). */
  private duplicateFurniture() {
    const m = this._model!;
    const sel = this._furn;
    const f = sel ? this.levelInput?.rooms.find((r) => r.id === sel.room)?.furniture?.[sel.index] : undefined;
    if (!sel || !f) return;
    const [w] = f.size ?? FURNITURE[f.type].size;
    const turned = ((f.rotation ?? 0) / 90) % 2 === 1;
    const at: [number, number] = turned ? [f.at[0], f.at[1] + w] : [f.at[0] + w, f.at[1]];
    const { model, index } = addFurniture(m, this._level, sel.room, { ...f, at });
    this.commit(model);
    this._furn = { room: sel.room, index };
  }

  /** The selected piece into the editor's clipboard; cut takes it out of the house too. */
  private copyFurniture(cut: boolean) {
    const sel = this._furn;
    const f = sel ? this.levelInput?.rooms.find((r) => r.id === sel.room)?.furniture?.[sel.index] : undefined;
    if (!sel || !f) return;
    this._clip = { piece: structuredClone(f), level: this._level, room: sel.room };
    if (cut) {
      this.commit(deleteFurniture(this._model!, this._level, sel.room, sel.index));
      this._furn = null;
    }
  }

  /**
   * The copied piece into the house, as it was (turn, size, colours, link): under the pointer when it is over a room of the plan,
   * otherwise next to where it came from (or in the middle of the selected room on another floor).
   */
  private pasteFurniture() {
    const clip = this._clip;
    if (!clip) return;
    const m = this._model!;
    const rooms = (this.levelInput?.rooms ?? []).filter((r) => r.kind !== "void");
    const piece = structuredClone(clip.piece);
    const pointer = this._planPointer;
    const under = pointer ? roomAt(m, rooms, pointer) : undefined;
    let room = under;
    let world: Vec2 | undefined = under ? pointer! : undefined;
    if (!room) {
      const home = clip.level === this._level ? rooms.find((r) => r.id === clip.room) : undefined;
      if (home) {
        const { min } = bbox(roomPolygon(m, home));
        const [w] = piece.size ?? FURNITURE[piece.type].size;
        const turned = ((piece.rotation ?? 0) / 90) % 2 === 1;
        room = home;
        world = turned ? [min[0] + piece.at[0], min[1] + piece.at[1] + w] : [min[0] + piece.at[0] + w, min[1] + piece.at[1]];
      } else {
        room = rooms.find((r) => r.id === this._room) ?? rooms[0];
        if (!room) return;
        world = labelPoint(this.inner(room));
      }
    }
    const { min } = bbox(roomPolygon(m, room));
    piece.at = [world![0] - min[0], world![1] - min[1]];
    const { model, index } = addFurniture(m, this._level, room.id, piece);
    this.commit(model);
    this._room = room.id;
    this._furn = { room: room.id, index };
  }

  /** An entity a piece of furniture is: the area's own first, then all of the usual domains. */
  /**
   * What a piece is in Home Assistant: a searchable list of entities (by name, id, device
   * or area), the room's own first, lights first for lamps.
   */
  private linkSelect(areaId: string | undefined, value: string | undefined, onChange: (id: string | undefined) => void, prefer?: string) {
    const domains = ["light", "switch", "media_player", "fan", "climate", "humidifier", "vacuum", "lawn_mower", "sensor", "binary_sensor", "cover", "water_heater", "lock", "camera", "remote", "input_boolean", "valve", "siren", "button"];
    const hass = this._hass;
    const states = hass?.states ?? {};
    const name = (id: string) => (states[id]?.attributes.friendly_name as string | undefined) ?? id;
    const deviceOf = (id: string) => {
      const d = hass?.entities?.[id]?.device_id;
      const dev = d ? hass?.devices?.[d] : undefined;
      return dev ? (dev.name_by_user ?? dev.name ?? undefined) : undefined;
    };
    const own = new Set(areaId && hass ? domains.flatMap((d) => areaEntities(hass, areaId, d)) : []);
    const words = this._entityFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rank = (id: string) => (own.has(id) ? 0 : 2) + (prefer && id.startsWith(`${prefer}.`) ? 0 : 1);
    const ids = Object.keys(states)
      .filter((id) => domains.includes(id.split(".")[0]))
      .filter((id) => words.every((w) => `${name(id)} ${id} ${deviceOf(id) ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)));
    const choose = (e: Event, id: string | undefined) => {
      (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
      this._entityFilter = "";
      onChange(id);
    };
    return html`<div class="entity-link">
      <span class="label">${this.t("editor.furniture_entity")}</span>
      <details class="entity-picker">
        <summary>${value ? html`<b>${name(value)}</b> <span class="muted">${deviceOf(value) ? `${deviceOf(value)} · ` : ""}${value}</span>` : "—"}</summary>
        <input class="entity-search" type="search" placeholder=${this.t("editor.entity_search")} aria-label=${this.t("editor.entity_search")} .value=${this._entityFilter}
          @input=${(e: Event) => (this._entityFilter = (e.target as HTMLInputElement).value)} />
        <button class="entity-option" data-entity="" @click=${(e: Event) => choose(e, undefined)}>— ${this.t("editor.entity_none")}</button>
        ${ids.slice(0, 40).map(
          (id) => html`<button class="entity-option ${value === id ? "active" : ""}" data-entity=${id} @click=${(e: Event) => choose(e, id)}>
            <b>${own.has(id) ? "★ " : ""}${name(id)}</b><span class="muted">${deviceOf(id) ? `${deviceOf(id)} · ` : ""}${id}</span>
          </button>`,
        )}
        ${ids.length > 40 ? html`<p class="muted">${this.t("editor.texture_more", { count: ids.length - 40 })}</p>` : nothing}
      </details>
    </div>`;
  }

  /** The switch between snapping pieces into place and placing them freely. */
  private renderSnapPieces() {
    return html`<label class="check snap-pieces"
      ><input type="checkbox" .checked=${this._snapPieces} @change=${(e: Event) => {
        this._snapPieces = (e.target as HTMLInputElement).checked;
        writePref("homeslice-snap-pieces", this._snapPieces ? "on" : "off");
      }} />${this.t("editor.snap_pieces")}</label>`;
  }

  /** The house as a binary glTF file: floors stacked as built, with the roof. */
  private async exportGlb() {
    const { house, issues } = expandHouse(this._model!);
    if (!house) return;
    const canvas = document.createElement("canvas");
    const r = new HouseRenderer(canvas);
    try {
      const walls = new Map(house.levels.map((l) => [l.id, deriveWalls(l, house.walls, issues)]));
      r.setModel(house, walls, { explode: 0, roof: true, showOutdoor: true });
      await r.modelsReady();
      const glb = (await new GLTFExporter().parseAsync(r.object, { binary: true })) as ArrayBuffer;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
      a.download = `${this._house}.glb`;
      a.click();
      // the models it holds: what may not be passed on, what needs credit
      const used = new Set(this._model!.levels.flatMap((l) => l.rooms.flatMap((r) => (r.furniture ?? []).map((f) => f.model?.slice(7)))));
      this.licenceNotice((this._customModels ?? []).filter((m) => used.has(m.id)));
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } finally {
      r.dispose();
    }
  }

  /** Everything the command search finds: tools, settings, floors, rooms. */
  private commands(): Command[] {
    const m = this._model!;
    const tool = (t: (typeof TOOLS)[number]): Command => ({
      id: `tool:${t.tool}`,
      label: this.t(`editor.tool_${t.tool}` as StringKey).replace(/\s*\([^)]*\)$/, ""),
      key: t.key,
      words: TOOL_WORDS[t.tool],
      run: () => this.setTool(t.tool),
    });
    const levelIndex = m.levels.findIndex((l) => l.id === this._level);
    const out: Command[] = [
      ...TOOLS.map(tool),
      ...(m.levels.some((l) => l.kind === "roof")
        ? []
        : [{ id: "roof", label: `+ ${this.t("editor.add_roof")}`, hint: this.t("editor.roof_level_add_hint"), words: "roof level attic gable hip solar panels dormer", run: () => this.addRoofLevelOnTop() }]),
      { id: "level", label: this.t("editor.add_level_above"), words: "floor storey level add new", run: () => this.addLevelAt(Math.max(0, levelIndex) + 1) },
      {
        id: "underlay",
        label: this.t("editor.underlay"),
        words: "backdrop background image plan trace robot map scale",
        run: () => {
          this.setTool("select");
          this.clearSelection();
        },
      },
      {
        id: "curve",
        label: this.t("editor.search_curve"),
        words: "curved bow arc round wall bulge",
        // the outside walls selected: their panel has the curves
        run: () => {
          this.goTo(this._level);
          this._room = OUTLINE;
        },
      },
      { id: "corner", label: this.t("editor.search_corner"), words: "corner shape polygon l-shape non-rectangular double-click", run: () => this.setTool("select") },
      { id: "settings", label: this.t("editor.house_settings"), words: "yaml backup restore download export walls thickness", run: () => (this._settings = {}) },
      { id: "checklist", label: this.t("editor.checklist"), words: "todo problems missing areas blinds contacts", run: () => (this._checklist = true) },
      { id: "shortcuts", label: this.t("editor.shortcuts"), key: "?", words: "keys keyboard help", run: () => (this._shortcuts = true) },
      { id: "tour", label: this.t("editor.tour"), words: "tour guide tutorial help introduction learn", run: () => this.startTour() },
      { id: "save", label: this.t("editor.save"), key: "Ctrl+S", words: "store", run: () => void this.save() },
      {
        id: "start-over",
        label: this.t("editor.start_over"),
        words: "new reset ai robot import trace",
        run: () => {
          if (this.dirty && !confirm(this.t("editor.discard"))) return;
          this._start = this.newStart(true);
        },
      },
      ...m.levels.map((l) => ({ id: `level:${l.id}`, label: this.levelName(l), hint: this.t("editor.search_floor"), words: "floor level storey", run: () => this.goTo(l.id) })),
      ...m.levels.flatMap((l) =>
        l.rooms.map((r) => ({ id: `room:${l.id}:${r.id}`, label: this.roomName(r), hint: this.levelName(l), words: `${r.id} room`, run: () => this.goTo(l.id, r.id) })),
      ),
    ];
    return out;
  }

  private goTo(level: string, room?: string) {
    this.setTool("select");
    this.clearSelection();
    this._level = level;
    if (room) this._room = room;
  }

  private renderPalette(p: { q: string; i: number }) {
    const found = searchCommands(this.commands(), p.q);
    const i = Math.min(p.i, Math.max(0, found.length - 1));
    const run = (c: Command | undefined) => {
      if (!c) return;
      this._palette = null;
      c.run();
    };
    return html`<div class="shortcuts palette" role="dialog" aria-label=${this.t("editor.search")} @click=${() => (this._palette = null)}>
      <div @click=${(e: Event) => e.stopPropagation()}>
        <input class="palette-input" type="search" placeholder=${this.t("editor.search_placeholder")} .value=${p.q}
          ${ref((el) => el && requestAnimationFrame(() => (el as HTMLInputElement).focus()))}
          @input=${(e: Event) => (this._palette = { q: (e.target as HTMLInputElement).value, i: 0 })}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              this._palette = { ...p, i: (i + (e.key === "ArrowDown" ? 1 : -1) + found.length) % Math.max(1, found.length) };
            } else if (e.key === "Enter") run(found[i]);
            else if (e.key === "Escape") this._palette = null;
          }} />
        <ul class="palette-list">
          ${found.length
            ? found.map(
                (c, k) => html`<li class=${k === i ? "active" : ""} data-command=${c.id} @click=${() => run(c)}>
                  <span class="name">${c.label}${c.hint ? html`<span class="muted">${c.hint}</span>` : nothing}</span>
                  ${c.key ? html`<kbd>${c.key}</kbd>` : nothing}
                </li>`,
              )
            : html`<li class="muted">${this.t("editor.search_none")}</li>`}
        </ul>
      </div>
    </div>`;
  }

  // ----- the guided tour -----

  /** Starts the tour (from ? or the search), or offers it once to someone new. */
  private startTour(offer = false) {
    this._shortcuts = false;
    this._tip = null;
    this._tour = offer ? 0 : 1;
    this.tourBase = this.tourSnapshot();
  }

  private endTour() {
    this._tour = null;
    this.tourBase = null;
    try {
      localStorage.setItem("homeslice-tour", "done");
    } catch {
      // no storage: offered again next time, harmless
    }
  }

  private tourSnapshot() {
    const m = this._model;
    const counts: TourCounts = { rooms: 0, openings: 0, furniture: 0 };
    for (const l of m?.levels ?? []) {
      counts.rooms += l.rooms.length;
      counts.openings += l.openings?.length ?? 0;
      for (const r of l.rooms) counts.furniture += r.furniture?.length ?? 0;
    }
    counts.openings += m?.facade_openings?.length ?? 0;
    return { model: JSON.stringify(m), level: this._level, counts };
  }

  /** A step is done once its thing happened: the next one begins. */
  private checkTour() {
    const step = this._tour !== null ? TOUR[this._tour - 1] : undefined;
    if (!step || !this.tourBase) return;
    const now = this.tourSnapshot();
    const base = this.tourBase;
    const done =
      step.id === "floors" ? now.level !== base.level
      : step.id === "room" ? now.counts.rooms > base.counts.rooms
      : step.id === "reshape" ? now.model !== base.model && now.counts.rooms === base.counts.rooms
      : step.id === "opening" ? now.counts.openings > base.counts.openings
      : step.id === "furniture" ? now.counts.furniture > base.counts.furniture
      : step.id === "save" ? !this.dirty
      : false;
    if (done) this.nextTourStep();
  }

  private nextTourStep() {
    if (this._tour === null) return;
    this._tour += 1;
    this.tourBase = this.tourSnapshot();
  }

  private renderTour() {
    if (this._tour === null) return nothing;
    if (this._tour === 0)
      return html`<div class="tour" role="dialog" data-tour="offer" aria-label=${this.t("editor.tour")}>
        <h3>${this.t("editor.tour_offer_title")}</h3>
        <p>${this.t("editor.tour_offer")}</p>
        <div class="row"><button class="primary" data-tour-start @click=${() => this.startTour()}>${this.t("editor.tour_start")}</button>
          <button data-tour-skip @click=${() => this.endTour()}>${this.t("editor.tour_no")}</button></div>
      </div>`;
    const step = TOUR[this._tour - 1];
    if (!step)
      return html`<div class="tour" role="dialog" data-tour="done" aria-label=${this.t("editor.tour")}>
        <h3>${this.t("editor.tour_done_title")}</h3>
        <p>${this.t("editor.tour_done")}</p>
        <div class="row"><button class="primary" data-tour-close @click=${() => this.endTour()}>${this.t("editor.tour_close")}</button></div>
      </div>`;
    return html`<div class="tour" role="dialog" data-tour=${step.id} aria-label=${this.t("editor.tour")}>
      <p class="muted">${this.t("editor.tour_step", { n: String(this._tour), of: String(TOUR.length) })}</p>
      <p>${this.t(`editor.tour_${step.id}` as StringKey)}</p>
      <div class="row"><button data-tour-next @click=${() => this.nextTourStep()}>${this.t("editor.tour_next")}</button>
        <button data-tour-skip @click=${() => this.endTour()}>${this.t("editor.tour_skip")}</button></div>
    </div>`;
  }

  /** The control a tour step is about glows. */
  private markTourTarget() {
    const root = this.renderRoot as ShadowRoot;
    root.querySelectorAll(".tour-target").forEach((el) => el.classList.remove("tour-target"));
    const step = this._tour ? TOUR[this._tour - 1] : undefined;
    if (step?.target) root.querySelector(step.target)?.classList.add("tour-target");
  }

  private renderShortcuts() {
    const keys: [string, StringKey][] = [
      ["V", "editor.key_select"],
      ["R", "editor.key_room"],
      ["S", "editor.key_stairs"],
      ["W", "editor.key_wall"],
      ["M", "editor.key_measure"],
      ["C", "editor.key_section"],
      ["R (" + this.t("editor.mode_objects") + ")", "editor.key_turn"],
      ["Ctrl+D", "editor.key_duplicate"],
      ["Ctrl+C / Ctrl+X / Ctrl+V", "editor.key_clipboard"],
      ["D", "editor.key_opening"],
      ["F", "editor.key_furniture"],
      ["E", "editor.key_devices"],
      ["Ctrl+K", "editor.key_search"],
      ["Del", "editor.key_delete"],
      ["N", "editor.key_backdrop"],
      ["Esc", "editor.key_escape"],
      ["Ctrl+Z / Ctrl+Shift+Z", "editor.key_undo"],
      ["Ctrl+S", "editor.key_save"],
      ["Alt", "editor.key_alt"],
      ["← ↑ → ↓", "editor.key_nudge"],
      [this.t("editor.key_double_click"), "editor.key_corner"],
      [this.t("editor.key_wheel"), "editor.key_zoom"],
      ["?", "editor.key_help"],
    ];
    return html`<div class="shortcuts" role="dialog" aria-label=${this.t("editor.shortcuts")} @click=${() => (this._shortcuts = false)}>
      <div @click=${(e: Event) => e.stopPropagation()}>
        <h2>${this.t("editor.shortcuts")}</h2>
        <dl>${keys.map(([k, what]) => html`<dt><kbd>${k}</kbd></dt><dd>${this.t(what)}</dd>`)}</dl>
        <button data-tour-restart @click=${() => this.startTour()}>${this.t("editor.tour_restart")}</button>
      </div>
    </div>`;
  }

  private renderHouseSettings() {
    const m = this._model!;
    const st = this._settings!;
    const yaml = () => toYaml(m, { lineWidth: 0, flowCollectionPadding: false });
    const download = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([yaml()], { type: "text/yaml" }));
      a.download = `${this._house}.yaml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const applyPaste = () => {
      let next: unknown;
      try {
        next = parseYaml(st.paste ?? "");
      } catch (e) {
        this._settings = { ...st, problems: [String((e as Error).message)] };
        return;
      }
      const { house, issues } = expandHouse(next as HouseInput);
      const errors = issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`);
      if (!house || errors.length) {
        this._settings = { ...st, problems: errors.length ? errors : [this.t("editor.paste_invalid")] };
        return;
      }
      // the house keeps its id: the file name decides that
      this.commit({ ...(next as HouseInput), id: m.id });
      if (!(next as HouseInput).levels.some((x) => x.id === this._level)) this._level = (next as HouseInput).levels[0].id;
      this._settings = null;
    };
    return html`<h2>${this.t("editor.house_settings")}</h2>
      <label>${this.t("editor.house_name")}
        <input .value=${m.name ?? ""} @change=${(e: Event) => {
          const name = (e.target as HTMLInputElement).value.trim();
          this.commit({ ...m, name: name || undefined } as HouseInput);
        }} />
      </label>
      <p class="muted">${this.t("editor.house_id", { id: this._house })}</p>
      <h3>${this.t("editor.yaml")}</h3>
      <p class="muted">${this.t("editor.yaml_hint")}</p>
      <div class="row">
        <button @click=${async () => {
          await navigator.clipboard?.writeText(yaml()).catch(() => undefined);
          this._settings = { ...st, copied: true };
        }}>${st.copied ? this.t("editor.copied") : this.t("editor.yaml_copy")}</button>
        <button @click=${download}>${this.t("editor.yaml_download")}</button>
      </div>
      <h3>${this.t("editor.ai")}</h3>
      <p class="muted">${this.t("editor.ai_hint")}</p>
      <div class="row">
        <button @click=${() => void this.copyPrompt()}>${st.prompt === "copied" ? this.t("editor.copied") : st.prompt === "copying" ? "…" : this.t("editor.ai_prompt")}</button>
      </div>
      ${st.prompt && st.prompt !== "copied" && st.prompt !== "copying" ? html`<p class="error">${st.prompt}</p>` : nothing}
      <p class="muted">${this.t("editor.ai_tools_hint")}</p>
      ${this.renderRestore()}
      <h3>${this.t("editor.export_3d")}</h3>
      <p class="muted">${this.t("editor.export_3d_hint")}</p>
      <button @click=${() => void this.exportGlb()}>${this.t("editor.export_glb")}</button>
      <label>${this.t("editor.yaml_paste")}
        <textarea class="yaml" rows="8" spellcheck="false" .value=${st.paste ?? ""} @input=${(e: Event) => (this._settings = { ...st, paste: (e.target as HTMLTextAreaElement).value, problems: undefined })}></textarea>
      </label>
      ${st.problems?.length
        ? html`<ul class="problems">${st.problems.map((x) => html`<li>${x}</li>`)}</ul>
            <button @click=${async () => {
              await navigator.clipboard?.writeText(this.t("editor.ai_errors_text") + "\n" + st.problems!.map((x) => `- ${x}`).join("\n")).catch(() => undefined);
              this._settings = { ...st, errorsCopied: true };
            }}>${st.errorsCopied ? this.t("editor.copied") : this.t("editor.ai_errors")}</button>`
        : nothing}
      <button class="primary" ?disabled=${!st.paste?.trim()} @click=${applyPaste}>${this.t("editor.yaml_apply")}</button>
      <h3>${this.t("editor.pieces")}</h3>
      <p class="muted">${this.t("editor.pieces_hint", { count: m.pieces?.length ?? 0 })}</p>
      ${(m.pieces ?? []).map((p) => this.renderPieceEditor(p))}
      <button data-piece-new @click=${() => {
        const id = uniqueId((m.pieces ?? []).map((p) => p.id), "piece");
        this.commit(setPiece(m, id, { id, name: this.t("editor.piece_new_name"), size: [0.6, 0.4, 0.8], parts: [{ shape: "box", size: [0.6, 0.4, 0.8], finish: "oak" }] }));
      }}>${this.t("editor.piece_new")}</button>
      <div class="row">
        <button data-pieces-download ?disabled=${!m.pieces?.length} @click=${() => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([toYaml({ pieces: m.pieces }, { lineWidth: 0, flowCollectionPadding: false })], { type: "text/yaml" }));
          a.download = `${m.id}-pieces.yaml`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }}>${this.t("editor.pieces_download")}</button>
        <label class="file"
          >${this.t("editor.pieces_add")}
          <input type="file" accept=".yaml,.yml,.json" data-pieces-add @change=${async (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = "";
            if (!file) return;
            try {
              const pack = parseYaml(await file.text()) as { pieces?: unknown };
              const pieces = Array.isArray(pack?.pieces) ? pack.pieces : Array.isArray(pack) ? pack : null;
              if (!pieces) throw new Error(this.t("editor.pieces_none"));
              const merged = mergePieces(m, pieces);
              // checked like any house change: a broken pack is not taken
              const problems = expandHouse(merged.model).issues.filter((i) => i.severity === "error" && i.path.startsWith("pieces"));
              if (problems.length) {
                this._settings = { ...st, problems: problems.map((p) => `${p.path}: ${p.message}`) };
                return;
              }
              this.commit(merged.model);
              this._settings = { ...st, problems: undefined, notice: this.t("editor.pieces_added", { count: merged.added.length }) };
            } catch (err) {
              this._settings = { ...st, problems: [String((err as Error).message)] };
            }
          }} />
        </label>
      </div>
      <h3>${this.t("editor.import")}</h3>
      <label class="file"
        >${this.t("editor.import_sh3d")}
        <input type="file" accept=".sh3d" @change=${async (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          try {
            // the converter (and its unzip) loads only when someone imports
            const { sh3dXml, sweetHomeToHouse } = await import("../import/sweethome");
            const house = sweetHomeToHouse(sh3dXml(new Uint8Array(await file.arrayBuffer())), m.id);
            // into the box above, to look at (and fix) before using it
            this._settings = { ...st, paste: toYaml(house, { lineWidth: 0, flowCollectionPadding: false }), problems: undefined };
          } catch (err) {
            this._settings = { ...st, problems: [String((err as Error).message)] };
          }
        }} />
      </label>
      <label class="file"
        >${this.t("editor.import_plan")}
        <input type="file" accept=".json,application/json" data-import-plan @change=${async (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          (e.target as HTMLInputElement).value = "";
          if (!file) return;
          try {
            const { planToHouse } = await import("../import/planjson");
            const found = planToHouse(await file.text(), m.id);
            this._settings = {
              ...st,
              paste: toYaml(found.house, { lineWidth: 0, flowCollectionPadding: false }),
              problems: found.skipped.length ? found.skipped : undefined,
              notice: this.t("editor.import_plan_done", { rooms: found.rooms, skipped: found.skipped.length }),
            };
          } catch (err) {
            this._settings = { ...st, problems: [String((err as Error).message)] };
          }
        }} />
      </label>
      <label class="file"
        >${this.t("editor.import_svg")}
        <input type="file" accept=".svg,image/svg+xml" data-import-svg @change=${async (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          (e.target as HTMLInputElement).value = "";
          if (!file) return;
          // SVG units mean nothing on their own: how wide the drawing is in reality
          const width = parseFloat((prompt(this.t("editor.import_svg_width"), "12") ?? "").replace(",", "."));
          if (!(width > 0)) return;
          try {
            const { svgToHouse } = await import("../import/svgplan");
            const found = svgToHouse(await file.text(), width, m.id);
            this._settings = { ...st, paste: toYaml(found.house, { lineWidth: 0, flowCollectionPadding: false }), problems: undefined, notice: this.t("editor.import_svg_done", { rooms: found.rooms, entities: found.entities }) };
          } catch (err) {
            this._settings = { ...st, problems: [String((err as Error).message)] };
          }
        }} />
      </label>
      <p class="muted">${this.t("editor.import_hint")}</p>
      <h3>${this.t("editor.backup")}</h3>
      <div class="row">
        <button data-backup @click=${async () => {
          const { name, data } = await this._hass!.callWS<{ name: string; data: string }>({ type: "homeslice/backup" });
          const a = document.createElement("a");
          a.href = data;
          a.download = `${new Date().toISOString().slice(0, 10)}-${name}`;
          a.click();
          // never held back: but it says what in it is for this home only, and what needs credit
          this.licenceNotice(this._customModels ?? (await this._hass!.callWS<CustomAsset[]>({ type: "homeslice/assets/custom" })));
        }}>${this.t("editor.backup_download")}</button>
        <label class="file"
          >${this.t("editor.backup_restore")}
          <input type="file" accept=".zip" @change=${async (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file || !confirm(this.t("editor.backup_restore_confirm"))) return;
            const data = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.readAsDataURL(file);
            });
            try {
              const r = await this._hass!.callWS<{ houses: string[]; plans: number; models: number }>({ type: "homeslice/backup/restore", data });
              this._settings = { ...st, problems: undefined, notice: this.t("editor.backup_restored", { houses: r.houses.length, plans: r.plans, models: r.models }) };
              this._houses = await this._hass!.callWS<HouseSummary[]>({ type: "homeslice/houses" });
              await this.openHouse(this._house);
            } catch (err) {
              this._settings = { ...st, problems: [String((err as { message?: string }).message ?? err)] };
            }
          }} />
        </label>
      </div>
      ${st.notice ? html`<p class="notice">${st.notice}</p>` : nothing}
      <p class="muted">${this.t("editor.backup_hint")}</p>
      <h3>${this.t("editor.start_over")}</h3>
      <p class="muted">${this.t("editor.start_over_hint")}</p>
      <button data-start-over @click=${() => {
        if (this.dirty && !confirm(this.t("editor.discard"))) return;
        this._settings = null;
        this._start = this.newStart(true);
      }}>${this.t("editor.start_over")}</button>
      <h3>${this.t("editor.danger")}</h3>
      <button class="danger" @click=${async () => {
        if (!confirm(this.t("editor.delete_house_confirm", { name: m.name ?? this._house }))) return;
        await this._hass!.callWS({ type: "homeslice/model/delete", house: this._house });
        this._settings = null;
        this._saved = "";
        this._model = null;
        this._houses = await this._hass!.callWS<HouseSummary[]>({ type: "homeslice/houses" });
        if (this._houses.length) await this.openHouse(this._houses[0].id);
        // none left: where to start
        else this._start = this.newStart(false);
      }}>${this.t("editor.delete_house")}</button>`;
  }

  /** Copies the guide (with this Home Assistant's floors, areas and entities) as a prompt for any chat assistant. */
  private async copyPrompt() {
    const st = this._settings!;
    this._settings = { ...st, prompt: "copying" };
    try {
      const { guide } = await this._hass!.callWS<{ guide: string }>({ type: "homeslice/guide", house: this._house });
      await navigator.clipboard.writeText(`${this.t("editor.ai_prompt_intro")}\n\n${guide}`);
      this._settings = { ...this._settings!, prompt: "copied" };
    } catch (e) {
      this._settings = { ...this._settings!, prompt: (e as { message?: string })?.message ?? String(e) };
    }
  }

  /** "Restore previous version": the house as it was before its last save (an assistant's, the editor's or a file's). */
  private renderRestore() {
    const prev = this._houses.find((h) => h.id === this._house)?.previous;
    if (!prev) return nothing;
    const who = (source: string) =>
      source === "api" ? this.t("editor.source_editor") : source.startsWith("file:") ? this.t("editor.source_file", { file: source.slice(5) }) : source.startsWith("assistant:") ? this.t("editor.source_assistant", { name: source.slice(10) }) : source;
    const when = new Date(prev.updated).toLocaleString(this._hass?.locale?.language);
    const current = this._houses.find((h) => h.id === this._house);
    return html`<p class="muted">${this.t("editor.restore_hint", { source: who(current?.source ?? ""), when: new Date(current?.updated ?? "").toLocaleString(this._hass?.locale?.language) })}</p>
      <button @click=${async () => {
        if (!confirm(this.t("editor.restore_confirm", { when, source: who(prev.source) }))) return;
        await this._hass!.callWS({ type: "homeslice/model/restore", house: this._house });
        this._houses = await this._hass!.callWS<HouseSummary[]>({ type: "homeslice/houses" });
        this._settings = null;
        await this.openHouse(this._house);
      }}>${this.t("editor.restore", { when, source: who(prev.source) })}</button>`;
  }

  private renderStairInspector(id: string) {
    const m = this._model!;
    const v = m.vertical?.find((x) => x.id === id);
    if (!v) return nothing;
    const set = (patch: Parameters<typeof updateStairs>[2]) => this.commit(updateStairs(m, id, patch));
    const [, , w, d] = stairsRect(m, v);
    const up = v.up ?? (w >= d ? "east" : "south");
    const across: Side[] = up === "north" || up === "south" ? ["east", "west"] : ["north", "south"];
    // older files: l_turn and u_turn are flights with one and two quarter turns
    const form = v.shape === "spiral" || v.shape === "curved" ? v.shape : "straight";
    const turnsOf: 0 | 1 | 2 | 3 = v.turns ?? (v.shape === "l_turn" ? 1 : v.shape === "u_turn" ? 2 : 0);
    const turnOf = v.turn ?? (v.shape === "u_turn" ? "winders" : "landing");
    const length = up === "east" || up === "west" ? w : d;
    const levelOptions = (value: string, ok: (i: number) => boolean) =>
      m.levels.map((l, i) => html`<option value=${l.id} ?selected=${l.id === value} ?disabled=${!ok(i)}>${this.levelName(l)}</option>`);
    const fromIndex = m.levels.findIndex((l) => l.id === v.from);
    const toIndex = m.levels.findIndex((l) => l.id === v.to);
    return html`<h2>${this.t(v.kind === "shaft" ? "editor.shaft" : "editor.stairs")}</h2>
      <p class="muted">${this.n(w)} × ${this.n(d)} m · ${this.t("editor.stairs_hint")}</p>
      <div class="row">
        <label>${this.t("editor.stairs_from")}
          <select @change=${(e: Event) => set({ from: (e.target as HTMLSelectElement).value })}>${levelOptions(v.from, (i) => i < toIndex)}</select>
        </label>
        <label>${this.t("editor.stairs_to")}
          <select @change=${(e: Event) => set({ to: (e.target as HTMLSelectElement).value })}>${levelOptions(v.to, (i) => i > fromIndex)}</select>
        </label>
      </div>
      <label>${this.t("editor.kind")}
        <select @change=${(e: Event) => set({ kind: (e.target as HTMLSelectElement).value as "stairs" | "shaft" })}>
          <option value="stairs" ?selected=${v.kind !== "shaft"}>${this.t("editor.stairs")}</option>
          <option value="shaft" ?selected=${v.kind === "shaft"}>${this.t("editor.shaft")}</option>
        </select>
      </label>
      ${v.kind === "shaft"
        ? nothing
        : html`<div class="row">
              <label>${this.t("editor.stairs_shape")}
                <select data-stair-shape @change=${(e: Event) => {
                  const shape = (e.target as HTMLSelectElement).value as StairShape;
                  // round ones turn by themselves; flights keep their turns
                  set(shape === "straight" ? { shape: undefined, turns: turnsOf || undefined, turn: v.turn ?? (v.shape === "u_turn" ? "winders" : undefined) } : { shape, turns: undefined, turn: undefined });
                }}>
                  ${(["straight", "spiral", "curved"] as const).map((sh) => html`<option value=${sh} ?selected=${form === sh}>${this.t(sh === "straight" ? "editor.stairs_flights" : `editor.stairs_${sh}`)}</option>`)}
                </select>
              </label>
              <label>${this.t("editor.stairs_up")}
                <select @change=${(e: Event) => set({ up: (e.target as HTMLSelectElement).value as Side })}>
                  ${(["north", "east", "south", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${up === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
                </select>
              </label>
            </div>
            ${form === "straight"
              ? html`<div class="row">
                  <label>${this.t("editor.stairs_turns")}
                    <select data-stair-turns @change=${(e: Event) => {
                      const turns = Number((e.target as HTMLSelectElement).value) as 0 | 1 | 2 | 3;
                      // (an older l_turn / u_turn becomes flights with turns)
                      set({ shape: undefined, turns: turns || undefined, turn: v.turn ?? (v.shape === "u_turn" ? "winders" : undefined) });
                    }}>
                      ${[0, 1, 2, 3].map((n) => html`<option value=${n} ?selected=${turnsOf === n}>${this.t(`editor.stairs_turns_${n}` as StringKey)}</option>`)}
                    </select>
                  </label>
                  ${turnsOf
                    ? html`<label>${this.t("editor.stairs_turn")}
                        <select data-stair-turn @change=${(e: Event) => set({ shape: undefined, turns: turnsOf, turn: (e.target as HTMLSelectElement).value as "landing" | "winders" })}>
                          ${(["landing", "winders"] as const).map((t) => html`<option value=${t} ?selected=${turnOf === t}>${this.t(`editor.stairs_turn_${t}`)}</option>`)}
                        </select>
                      </label>`
                    : nothing}
                </div>`
              : nothing}
            <label>${this.t("editor.stairs_railing")}
              <select data-stair-railing @change=${(e: Event) => set({ railing: ((e.target as HTMLSelectElement).value || undefined) as VerticalInput["railing"] })}>
                <option value="" ?selected=${!v.railing}>${this.t("editor.stairs_railing_none")}</option>
                ${(["metal", "wood", "glass"] as const).map((r) => html`<option value=${r} ?selected=${v.railing === r}>${this.t(`editor.railing_${r}`)}</option>`)}
              </select>
            </label>
            <label>${this.t("editor.stairs_treads")}
              <select data-stair-treads @change=${(e: Event) => set({ treads: (e.target as HTMLSelectElement).value === "solid" ? "solid" : undefined })}>
                ${(["open", "solid"] as const).map((t) => html`<option value=${t} ?selected=${(v.treads ?? "open") === t}>${this.t(`editor.stairs_treads_${t}`)}</option>`)}
              </select>
            </label>
            ${form === "straight" && v.treads !== "solid"
              ? html`<label>${this.t("editor.stairs_stringers")}
                  <select data-stair-stringers @change=${(e: Event) => set({ stringers: ((e.target as HTMLSelectElement).value || undefined) as VerticalInput["stringers"] })}>
                    ${(["", "sides", "centre", "none"] as const).map((k) => html`<option value=${k} ?selected=${(v.stringers ?? "") === k}>${this.t(`editor.stairs_stringers_${k || "carriers"}`)}</option>`)}
                  </select>
                </label>`
              : nothing}
            <h4>${this.t("editor.stairs_finish")}</h4>
            ${this.renderFinishPicker("floor", v.finish, (finish) => set({ finish }), this.t("surface.wood"))}
            ${turnsOf || form !== "straight"
              ? html`<label>${this.t("editor.stairs_start")}
                  <select @change=${(e: Event) => set({ start: (e.target as HTMLSelectElement).value as Side })}>
                    ${across.map((sd) => html`<option value=${sd} ?selected=${(v.start ?? across[1]) === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
                  </select>
                </label>`
              : nothing}
            <label>${this.t("editor.stairs_entry")}
              <input type="number" min="0" max=${Math.max(0, length - 0.5).toFixed(2)} step="0.05" .value=${String(v.entry ?? 0)} @change=${(e: Event) => {
                const val = Number((e.target as HTMLInputElement).value);
                if (val >= 0 && val <= length - 0.5) set({ entry: Math.round(val * 100) / 100 });
              }} />
            </label>
            <p class="muted">${this.t("editor.stairs_entry_hint")}</p>`}
      <button class="danger" @click=${() => {
        this.commit(deleteStairs(m, id));
        this._stair = null;
      }}>${this.t("editor.stairs_delete")}</button>`;
  }

  private renderOutlineInspector() {
    const m = this._model!;
    const scope = outlineScope(m, this._level);
    const names = scope.levels.map((id) => {
      const lv = m.levels.find((x) => x.id === id)!;
      return (lv.floor_id && this._hass?.floors?.[lv.floor_id]?.name) || lv.name || lv.id;
    });
    const poly = scope.poly;
    return html`<h2>${this.t("editor.outline")}</h2>
      <p class="muted">${this.n(area(poly))} m² ${this.t("editor.outline_area")}</p>
      <label class="check">
        <input type="checkbox" data-outline-auto .checked=${scope.owner === "auto"} @change=${(e: Event) => this.commit(setOutlineAuto(m, (e.target as HTMLInputElement).checked))} />
        ${this.t("editor.outline_auto")}
      </label>
      <p class="muted">${scope.owner === "auto" ? this.t("editor.outline_auto_hint") : scope.owner === "house" ? this.t("editor.outline_shared", { levels: names.join(", ") }) : this.t("editor.outline_own")}</p>
      <p class="muted">${this.t("editor.outline_hint")}</p>
      ${scope.owner === "auto"
        ? nothing
        : html`<button @click=${() => this.commit(setOwnOutline(m, this._level, scope.owner === "house"))}>
            ${scope.owner === "house" ? this.t("editor.outline_make_own") : this.t("editor.outline_use_house")}
          </button>`}
      ${this.renderCurves(scope.owner === "auto" ? { polygon: scope.poly } : ((scope.owner === "house" ? m.outline : this.levelInput?.outline) as ShapeInput | undefined), "outline")}
      <h3>${this.t("editor.surface_facade")}</h3>
      <p class="muted">${this.t("editor.surface_facade_hint")}</p>
      ${this.renderFinishPicker("wall", m.facade, (facade) => {
        const next = { ...m, facade };
        if (!facade) delete next.facade;
        this.commit(next);
      }, this.t("editor.surface_plain"))}
      <h3>${this.t("editor.roof")}</h3>
      <p class="muted">${this.t("editor.roof_hint")}</p>
      ${m.levels.some((x) => x.kind === "roof")
        ? html`<p class="muted">${this.t("editor.roof_on_level")}</p>`
        : html`<button data-add-roof-level @click=${() => this.addRoofLevelOnTop()}>${this.t("editor.roof_level_add")}</button>
          <p class="muted">${this.t("editor.roof_level_add_hint")}</p>`}
      <div class="row">
        <label>${this.t("editor.roof_shape")}
          <select @change=${(e: Event) => this.commit(setRoof(m, { shape: ((e.target as HTMLSelectElement).value || undefined) as RoofInput["shape"] }))}>
            ${(["gable", "hip", "shed", "flat"] as const).map((sh) => html`<option value=${sh === "gable" ? "" : sh} ?selected=${(m.roof?.shape ?? "gable") === sh}>${this.t(`editor.roof_shape_${sh}`)}</option>`)}
          </select>
        </label>
        ${m.roof?.shape === "shed"
          ? html`<label>${this.t("editor.roof_high")}
              <select @change=${(e: Event) => this.commit(setRoof(m, { high: (e.target as HTMLSelectElement).value as Side }))}>
                ${(["north", "south", "east", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${m.roof?.high === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
              </select>
            </label>`
          : nothing}
      </div>
      <h4>${this.t("editor.roof_covering")}</h4>
      ${this.renderFinishPicker("roof", m.roof?.finish, (finish) => this.commit(setRoof(m, { finish })), this.t("surface.roof_clay"))}
      <div class="row">
        <label>${this.t("editor.roof_ridge")}
          <select @change=${(e: Event) => this.commit(setRoof(m, { ridge: ((e.target as HTMLSelectElement).value || undefined) as "east_west" | "north_south" | undefined }))}>
            <option value="" ?selected=${!m.roof?.ridge}>${this.t("editor.roof_ridge_auto")}</option>
            <option value="east_west" ?selected=${m.roof?.ridge === "east_west"}>${this.t("editor.roof_east_west")}</option>
            <option value="north_south" ?selected=${m.roof?.ridge === "north_south"}>${this.t("editor.roof_north_south")}</option>
          </select>
        </label>
        <label>${this.t("editor.roof_pitch")}
          <input type="number" min="5" max="70" step="1" .value=${String(m.roof?.pitch ?? 35)} @change=${(e: Event) => {
            const val = Number((e.target as HTMLInputElement).value);
            if (val > 0 && val < 75) this.commit(setRoof(m, { pitch: val === 35 ? undefined : val }));
          }} />
        </label>
        <label>${this.t("editor.roof_overhang")}
          <input type="number" min="0" max="2" step="0.05" .value=${String(m.roof?.overhang ?? 0.3)} @change=${(e: Event) => {
            const val = Number((e.target as HTMLInputElement).value);
            if (val >= 0 && val <= 2) this.commit(setRoof(m, { overhang: val === 0.3 ? undefined : val }));
          }} />
        </label>
      </div>
      ${(m.roof?.dormers ?? []).map((d, i) => {
        const dormers = m.roof?.dormers ?? [];
        const setD = (patch: Partial<DormerInput>) => this.commit(setRoof(m, { dormers: dormers.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
        return html`<div class="row dormer">
          <label>${this.t("editor.dormer")} ${i + 1}
            <select @change=${(e: Event) => setD({ side: (e.target as HTMLSelectElement).value as Side })}>
              ${(["north", "south", "east", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${d.side === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
            </select>
          </label>
          <label>${this.t("editor.dormer_at")}
            <input type="number" step="0.1" .value=${String(d.at)} @change=${(e: Event) => setD({ at: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>${this.t("editor.dormer_width")}
            <input type="number" min="0.5" max="6" step="0.1" .value=${String(d.width ?? 1.6)} @change=${(e: Event) => setD({ width: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>${this.t("editor.dormer_shape")}
            <select @change=${(e: Event) => setD({ shape: (e.target as HTMLSelectElement).value as "gable" | "shed" })}>
              ${(["gable", "shed"] as const).map((sh) => html`<option value=${sh} ?selected=${(d.shape ?? "gable") === sh}>${this.t(`editor.dormer_${sh}`)}</option>`)}
            </select>
          </label>
          <button class="icon" title=${this.t("editor.light_remove")} @click=${() => this.commit(setRoof(m, { dormers: dormers.filter((_, j) => j !== i).length ? dormers.filter((_, j) => j !== i) : undefined }))}><ha-icon icon="mdi:close"></ha-icon></button>
        </div>`;
      })}
      ${(m.roof?.windows ?? []).map((w, i) => {
        const list = m.roof?.windows ?? [];
        const setW = (patch: Partial<RoofWindowInput>) => this.commit(setRoof(m, { windows: list.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
        return html`<div class="row dormer">
          <label>${this.t("editor.roof_window")} ${i + 1}
            <select @change=${(e: Event) => setW({ side: (e.target as HTMLSelectElement).value as Side })}>
              ${(["north", "south", "east", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${w.side === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
            </select>
          </label>
          <label>${this.t("editor.dormer_at")}
            <input type="number" step="0.1" .value=${String(w.at)} @change=${(e: Event) => setW({ at: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>${this.t("editor.roof_window_up")}
            <input type="number" min="0" max="20" step="0.1" .value=${String(w.up ?? 1.2)} @change=${(e: Event) => setW({ up: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <button class="icon" title=${this.t("editor.light_remove")} @click=${() => {
            const rest = list.filter((_, j) => j !== i);
            this.commit(setRoof(m, { windows: rest.length ? rest : undefined }));
          }}><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        ${this.entitySelect(this.t("editor.roof_window_shutter"), "cover", undefined, w.cover, (cover) => setW({ cover }))}
        ${this.entitySelect(this.t("editor.opening_contact"), "binary_sensor", undefined, w.contact, (contact) => setW({ contact }))}`;
      })}
      <button data-add-roof-window @click=${() => {
        const { house } = expandHouse(m);
        const top = house?.levels.at(-1);
        const b = top?.outline.length ? bbox(top.outline) : { min: [0, 0], max: [8, 8] };
        const eastWest = (house?.roof.ridge ?? "east_west") === "east_west";
        const length = eastWest ? b.max[0] - b.min[0] : b.max[1] - b.min[1];
        this.commit(setRoof(m, { windows: [...(m.roof?.windows ?? []), { side: eastWest ? "south" : "east", at: Math.round(length * 3) / 10 }] }));
      }}>${this.t("editor.roof_window_add")}</button>
      <button data-add-dormer @click=${() => {
        const { house } = expandHouse(m);
        const top = house?.levels.at(-1);
        const b = top?.outline.length ? bbox(top.outline) : { min: [0, 0], max: [8, 8] };
        const eastWest = (house?.roof.ridge ?? "east_west") === "east_west";
        const length = eastWest ? b.max[0] - b.min[0] : b.max[1] - b.min[1];
        this.commit(setRoof(m, { dormers: [...(m.roof?.dormers ?? []), { side: eastWest ? "south" : "east", at: Math.round(length * 5) / 10 }] }));
      }}>${this.t("editor.dormer_add")}</button>
      <label>${this.t("editor.north")}
        <input type="number" min="-180" max="180" step="1" .value=${String(m.north ?? 0)} @change=${(e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (v >= -180 && v <= 180) this.commit(updateHouse(m, { north: v || undefined }));
        }} />
      </label>
      <p class="muted">${this.t("editor.north_hint")}</p>
      <h3>${this.t("editor.walls_section")}</h3>
      <div class="row">
        ${this.cmInput(this.t("editor.walls_exterior"), m.walls?.exterior, DEFAULTS.walls.exterior, (v) => this.commit(setWallThickness(m, { exterior: v })))}
        ${this.cmInput(this.t("editor.walls_interior"), m.walls?.interior, DEFAULTS.walls.interior, (v) => this.commit(setWallThickness(m, { interior: v })))}
        ${this.cmInput(this.t("editor.walls_party"), m.walls?.party, DEFAULTS.walls.party, (v) => this.commit(setWallThickness(m, { party: v })))}
      </div>
      <p class="muted">${this.t("editor.walls_hint")}</p>
      <h3>${this.t("editor.party")}</h3>
      ${(() => {
        const l = this.levelInput!;
        // a level with its own setting (e.g. a top floor that stands free) shows and changes that
        const own = l.party_walls !== undefined;
        const sides = l.party_walls ?? m.party_walls ?? [];
        const toggle = (side: Side, on: boolean) => {
          const next = (["north", "east", "south", "west"] as Side[]).filter((x) => (x === side ? on : sides.includes(x)));
          this.commit(setPartyWalls(m, next, own ? l.id : undefined));
        };
        return html`<div class="checks">
            ${(["north", "east", "south", "west"] as Side[]).map(
              (side) => html`<label class="check"><input type="checkbox" .checked=${sides.includes(side)} @change=${(e: Event) => toggle(side, (e.target as HTMLInputElement).checked)} />${this.t(`editor.side_${side}` as StringKey)}</label>`,
            )}
          </div>
          <p class="muted">${this.t(own ? "editor.party_level_hint" : "editor.party_hint")}</p>`;
      })()}`;
  }

  static override styles = css`
    p.notice {
      padding: 8px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--success-color, #43a047) 15%, transparent);
    }
    :host {
      display: flex;
      flex-direction: column;
      /* HA gives custom panels no fixed height */
      height: 100vh;
      background: var(--primary-background-color, #111);
      color: var(--primary-text-color, #eee);
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
      --accent: var(--primary-color, #03a9f4);
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      min-height: 48px;
      border-bottom: 1px solid var(--divider-color, #333);
      background: var(--app-header-background-color, var(--card-background-color, #1c1c1c));
      flex-wrap: wrap;
    }
    h1 {
      font-size: 18px;
      font-weight: 500;
      margin: 0 8px 0 0;
    }
    .spacer {
      flex: 1;
    }
    button,
    select,
    input {
      font: inherit;
      color: inherit;
      background: var(--card-background-color, #1c1c1c);
      border: 1px solid var(--divider-color, #444);
      border-radius: 8px;
      min-height: 36px;
      padding: 0 10px;
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    button.icon {
      min-width: 36px;
      font-size: 18px;
    }
    button.save.dirty {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--text-primary-color, #fff);
    }
    button.danger {
      color: var(--error-color, #e57373);
      margin-top: 8px;
    }
    aside.levels {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      width: 150px;
      border-right: 1px solid var(--divider-color, #333);
    }
    button.level {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px 0 2px;
      min-height: 44px;
      text-align: left;
      cursor: grab;
      touch-action: none;
      user-select: none;
      position: relative;
      transition: transform 0.18s ease;
      --mdc-icon-size: 18px;
    }
    button.level ha-icon {
      color: var(--secondary-text-color);
    }
    button.level.dragging {
      z-index: 1;
      cursor: grabbing;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
      border-color: var(--accent);
    }
    @media (prefers-reduced-motion: reduce) {
      button.level {
        transition: none;
      }
    }
    .wall-hit {
      stroke: transparent;
      cursor: pointer;
    }
    .wall.selected {
      stroke: var(--accent);
    }
    .wall-halo {
      stroke: var(--accent);
      stroke-opacity: 0.3;
      stroke-linecap: round;
      pointer-events: none;
    }
    .wall-end {
      fill: var(--card-background-color, #fff);
      stroke: var(--accent);
      stroke-width: 2;
      pointer-events: none;
    }
    .wall.open {
      stroke: #848b92;
      stroke-width: 1.5;
      stroke-dasharray: 6 5;
      pointer-events: none;
    }
    .wall.open.selected {
      stroke: var(--accent);
      stroke-width: 3;
    }
    .segmented {
      display: flex;
    }
    .tools .divider {
      height: 1px;
      background: var(--divider-color, #333);
      margin: 2px 4px;
    }
    .wall-hit.add {
      cursor: copy;
    }
    .swing {
      fill: none;
      stroke: #4a4f55;
      stroke-width: 1;
      pointer-events: none;
    }
    .swing.leaf {
      stroke-width: 2;
    }
    .swing.window {
      stroke-dasharray: 3 3;
      stroke: #3b82b8;
    }
    .sliding.solid {
      stroke: #8a6a4a;
      stroke-width: 3;
    }
    .sliding {
      stroke: #3b82b8;
      stroke-width: 2.5;
      pointer-events: none;
    }
    .opening-hit {
      stroke: transparent;
      cursor: ew-resize;
    }
    .opening.selected {
      stroke: #ffb347;
      stroke-width: 5;
    }
    svg.plan.mode-openings .room,
    svg.plan.mode-objects .room {
      cursor: grab;
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .row label {
      flex: 1;
      min-width: 0;
    }
    .row input {
      width: 100%;
      box-sizing: border-box;
    }
    .segmented button {
      flex: 1;
      border-radius: 0;
    }
    .segmented button:first-child {
      border-radius: 8px 0 0 8px;
    }
    .segmented button:last-child {
      border-radius: 0 8px 8px 0;
    }
    fieldset.open-to {
      border: 1px solid var(--divider-color, #444);
      border-radius: 8px;
      padding: 6px 10px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    fieldset.open-to legend {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    label.check {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      color: var(--primary-text-color);
      font-size: 14px;
    }
    label.check input {
      min-height: 0;
      width: 18px;
      height: 18px;
    }
    .error {
      padding: 8px 16px;
      color: var(--error-color);
    }
    main {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .tools {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border-right: 1px solid var(--divider-color, #333);
    }
    .tools button {
      width: 44px;
      height: 44px;
      padding: 0;
      display: grid;
      place-items: center;
    }
    .loupe {
      position: absolute;
      width: 132px;
      height: 132px;
      border-radius: 50%;
      overflow: hidden;
      pointer-events: none;
      background: var(--primary-background-color, #fff);
      border: 2px solid var(--primary-color, #03a9f4);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      z-index: 3;
    }
    .loupe svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .loupe svg * {
      vector-effect: non-scaling-stroke;
    }
    .loupe-cross {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(var(--primary-color, #03a9f4), var(--primary-color, #03a9f4)) center / 14px 1px no-repeat,
        linear-gradient(var(--primary-color, #03a9f4), var(--primary-color, #03a9f4)) center / 1px 14px no-repeat;
    }
    .plan-wrap {
      position: relative;
      flex: 1;
      min-width: 0;
    }
    .wall-view {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 12px;
      height: 55%;
      display: flex;
      flex-direction: column;
      background: var(--card-background-color, #1c1f24);
      border: 1px solid var(--divider-color, #444);
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
      z-index: 3;
    }
    .wall-view header {
      display: flex;
      gap: 12px;
      align-items: baseline;
      padding: 8px 12px;
    }
    .wall-view header .close {
      margin-left: auto;
    }
    .wall-view svg {
      flex: 1;
      min-height: 0;
      width: 100%;
    }
    .wv-bg {
      fill: #e9e5de;
    }
    .wv-floor {
      stroke: #888;
      stroke-width: 2;
    }
    .wv-item rect {
      stroke: #555;
      stroke-width: 1;
      fill: #b9bcc0;
      cursor: grab;
    }
    .wv-item.wv-window rect {
      fill: #9cc8ee;
    }
    .wv-item.wv-door rect,
    .wv-item.wv-garage_door rect {
      fill: #a77b55;
    }
    .wv-item.wv-wall rect {
      fill: #8d97a3;
    }
    .wv-item.selected rect {
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 3;
    }
    .wv-item text,
    .wv-span,
    .wv-dims text {
      font-size: 11px;
      text-anchor: middle;
      dominant-baseline: middle;
      fill: #222;
      pointer-events: none;
    }
    .wv-item text.size {
      font-size: 8px;
      fill: #333;
    }
    .wv-span {
      fill: var(--secondary-text-color, #aaa);
    }
    .wv-dims line {
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 1.2;
      stroke-dasharray: 4 3;
    }
    .wv-dims text {
      fill: var(--primary-color, #03a9f4);
      font-weight: 700;
    }
    .backdrop-cycle {
      position: absolute;
      right: 60px;
      top: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: 45%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      --mdc-icon-size: 18px;
    }
    .backdrops {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }
    .backdrops button.active {
      border-color: var(--primary-color, #03a9f4);
      font-weight: 600;
    }
    .start-plan img {
      height: 32px;
      vertical-align: middle;
      margin-right: 6px;
    }
    .compass {
      position: absolute;
      right: 10px;
      top: 10px;
      width: 40px;
      height: 40px;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
    }
    .compass svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .compass circle {
      fill: rgba(20, 24, 28, 0.75);
      stroke: rgba(255, 255, 255, 0.35);
    }
    .compass .n {
      fill: #e5534b;
    }
    .compass .s {
      fill: #c9d1d9;
    }
    .compass text {
      fill: #fff;
      font-size: 7px;
      font-weight: 700;
      text-anchor: middle;
      dominant-baseline: middle;
    }
    svg.plan {
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      user-select: none;
      cursor: grab;
    }
    g.arriving rect {
      fill: color-mix(in srgb, var(--primary-color) 12%, transparent);
      stroke: var(--primary-color);
      stroke-width: 1.5;
      stroke-dasharray: 5 4;
    }
    g.arriving .spinner {
      fill: none;
      stroke: var(--primary-color);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-dasharray: 40 100;
      animation: arriving-spin 0.9s linear infinite;
    }
    g.arriving text {
      font-size: 12px;
      fill: var(--primary-text-color);
      paint-order: stroke;
      stroke: var(--card-background-color, #fff);
      stroke-width: 3px;
    }
    @keyframes arriving-spin {
      to {
        transform: rotate(360deg);
      }
    }
    svg.plan.tool-rect,
    svg.plan.tool-balcony,
    svg.plan.tool-wall,
    svg.plan.tool-divide,
    svg.plan.tool-assign {
      cursor: crosshair;
    }
    .gridline {
      stroke: var(--divider-color, #333);
      stroke-width: 1;
    }
    .ghost-outline {
      fill: none;
      stroke-width: 2;
      stroke-dasharray: 8 5;
      pointer-events: none;
    }
    .ghost-outline.below {
      stroke: var(--secondary-text-color, #888);
    }
    .ghost-outline.above {
      stroke: var(--accent-color, #ff9800);
      opacity: 0.8;
    }
    .ghost {
      fill: none;
      stroke: var(--secondary-text-color, #888);
      stroke-dasharray: 4 4;
      opacity: 0.6;
    }
    .room {
      stroke: rgba(0, 0, 0, 0.25);
      stroke-width: 1;
      opacity: 0.85;
      cursor: pointer;
    }
    .room.outdoor {
      opacity: 0.55;
    }
    .room.selected {
      stroke: var(--accent);
      stroke-width: 2.5;
    }
    .room-name {
      font-size: 13px;
      font-weight: 500;
      fill: #222;
      pointer-events: none;
    }
    .room-area {
      font-size: 11px;
      fill: #444;
      pointer-events: none;
    }
    .wall {
      stroke: #5d646b;
      /* flat ends: outer walls meet exactly at the corners */
      stroke-linecap: butt;
      pointer-events: none;
    }
    /* shared with the neighbours: solid, a bit darker (dashes mean "open") */
    .wall.party {
      stroke: #4b5157;
    }
    .wall.interior {
      stroke: #848b92;
    }
    .opening-gap {
      stroke: #f4f4f4;
      pointer-events: none;
    }
    .opening {
      stroke: #3d8bfd;
      stroke-width: 3;
      pointer-events: none;
    }
    .opening.type-door,
    .opening.type-garage_door,
    .opening.type-opening {
      stroke: #b07c49;
    }
    .stairwell {
      fill: rgba(80, 90, 100, 0.25);
      stroke: #6b747c;
      stroke-dasharray: 3 3;
      pointer-events: none;
    }
    .has-underlay .room {
      fill-opacity: 0.3;
    }
    image.underlay {
      pointer-events: none;
      filter: grayscale(1);
    }
    .tool-select.underlay-move {
      cursor: move;
    }
    .calib-point {
      fill: #ff6b6b;
      stroke: #fff;
      stroke-width: 2;
      pointer-events: none;
    }
    .ruler line {
      stroke: #ff6b6b;
      stroke-width: 2;
    }
    .ruler text {
      fill: #ff6b6b;
      font-size: 12px;
      font-weight: 600;
      paint-order: stroke;
      stroke: var(--card, #fff);
      stroke-width: 3px;
    }
    .ruler {
      pointer-events: none;
    }
    .calib-line {
      stroke: #ff6b6b;
      stroke-width: 2;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    .calib {
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .calib p {
      margin: 0;
    }
    label.file {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      border: 1px solid var(--divider-color, #444);
      border-radius: 8px;
      cursor: pointer;
      color: var(--primary-text-color, #eee);
      font-size: 14px;
    }
    label.file input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .room-label {
      pointer-events: none;
    }
    .room-label text {
      paint-order: stroke;
      /* room fills are always light: a light halo keeps names readable over walls */
      stroke: rgba(255, 255, 255, 0.75);
      stroke-width: 3px;
      stroke-linejoin: round;
    }
    /* no outline: just the piece; outlined when selected, faintly under the mouse */
    .furniture rect {
      fill: transparent;
      stroke: none;
    }
    .furniture.editable:hover rect {
      stroke: rgba(60, 64, 70, 0.5);
      stroke-width: 1;
    }
    .furniture image {
      opacity: 0.9;
    }
    .furniture path.front {
      fill: none;
      stroke: rgba(60, 64, 70, 0.55);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .furniture.selected path.front {
      stroke: var(--accent);
      stroke-width: 2;
    }
    .furniture-label {
      font-size: 11px;
      font-weight: 600;
      fill: #222;
      paint-order: stroke;
      stroke: rgba(255, 255, 255, 0.85);
      stroke-width: 3px;
      pointer-events: none;
    }
    .furniture {
      pointer-events: none;
    }
    .furniture.editable {
      pointer-events: auto;
      cursor: grab;
    }
    .furniture.editable rect {
      fill: transparent;
    }
    .furniture.selected rect {
      stroke: var(--accent);
      stroke-width: 2.5;
    }
    /* hanging pieces: dashed, ceiling ones lighter */
    .furniture.mount-wall rect {
      stroke-dasharray: 4 2;
    }
    .furniture.mount-ceiling rect {
      stroke-dasharray: 2 3;
      fill: rgba(60, 64, 70, 0.08);
    }
    .floor-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .floor-row select {
      min-height: 30px;
      font-size: 13px;
    }
    .robot-marker {
      cursor: grab;
    }
    .robot-marker rect {
      fill: #455a64;
      stroke: #fff;
      stroke-width: 2;
    }
    .robot-marker.selected rect {
      stroke: var(--accent);
      stroke-width: 3;
    }
    .robot-marker text {
      fill: #fff;
      font-size: 11px;
      font-weight: 600;
      pointer-events: none;
    }
    .robot-live {
      fill: #4caf50;
      stroke: #fff;
      stroke-width: 2;
      pointer-events: none;
    }
    .energy-link {
      stroke-width: 2.5;
      stroke-dasharray: 7 4;
      opacity: 0.8;
      pointer-events: none;
    }
    .energy-link.drawing {
      stroke: var(--accent);
      stroke-dasharray: none;
    }
    .energy-link-label {
      font-size: 11px;
      fill: #222;
      paint-order: stroke;
      stroke: rgba(255, 255, 255, 0.8);
      stroke-width: 3px;
      pointer-events: none;
    }
    .link-handle {
      cursor: crosshair;
    }
    .link-handle line {
      stroke: var(--accent);
      stroke-width: 2;
    }
    .link-handle circle {
      fill: #fff;
      stroke: var(--accent);
      stroke-width: 2.5;
    }
    button.link {
      border: none;
      background: none;
      padding: 0;
      min-height: 0;
      text-align: left;
      cursor: pointer;
    }
    .checklist-button {
      position: relative;
    }
    .checklist-button .badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      background: var(--accent);
      color: #fff;
      font-size: 11px;
      line-height: 18px;
      text-align: center;
      padding: 0 4px;
      box-sizing: border-box;
    }
    ul.checklist li .name {
      white-space: normal;
    }
    .opening-icon {
      width: 48px;
      height: 48px;
    }
    .opening-icon .frame {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
    }
    .opening-icon .glass {
      fill: #9ad3f5;
    }
    .opening-icon .leaf {
      fill: #c8a27a;
      stroke: #8a6a4a;
      stroke-width: 1;
    }
    .opening-icon .floor {
      stroke: currentColor;
      stroke-width: 2;
      opacity: 0.4;
    }
    .opening-icon .white {
      fill: #f4f4f2;
      stroke: #9a9a96;
      stroke-width: 1;
    }
    .opening-icon .frosted {
      fill: #dbe5ec;
      stroke: #b8c4cc;
      stroke-width: 0.6;
    }
    .opening-icon .handle {
      fill: #555;
      stroke: #555;
      stroke-width: 2;
    }
    .library .piece.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .opening-kinds {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .opening-kinds .kind {
      padding: 2px;
      min-height: 0;
      display: grid;
      place-items: center;
    }
    .opening-kinds .kind .opening-icon {
      width: 36px;
      height: 36px;
    }
    .opening-kinds .kind.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .library-search {
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 4px;
    }
    h4.group-head button {
      all: unset;
      display: flex;
      align-items: center;
      gap: 2px;
      width: 100%;
      cursor: pointer;
      font: inherit;
    }
    h4.group-head button:focus-visible {
      outline: 2px solid var(--accent);
    }
    h4.group-head ha-icon {
      --mdc-icon-size: 18px;
      color: var(--secondary-text-color);
    }
    .library {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
      gap: 6px;
    }
    .library .piece {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 4px 2px 6px;
      min-height: 0;
      cursor: grab;
      font-size: 11px;
      line-height: 1.2;
      text-align: center;
    }
    .library .piece:hover {
      border-color: var(--accent);
    }
    .widths,
    .choices {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin: 6px 0;
    }
    .widths button,
    .choices button {
      min-width: 36px;
      padding: 2px 6px;
    }
    .widths button.active,
    .choices button.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .finishes {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 6px 0;
    }
    .entity-link .label {
      display: block;
      margin-top: 8px;
      font-size: 12px;
      color: var(--secondary-text-color, #999);
    }
    .entity-picker summary {
      cursor: pointer;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, #444);
    }
    .entity-picker .entity-search {
      width: 100%;
      margin: 6px 0;
      box-sizing: border-box;
    }
    button.entity-option {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      width: 100%;
      text-align: left;
      padding: 4px 8px;
      margin: 1px 0;
    }
    button.entity-option.active {
      outline: 2px solid var(--accent);
    }
    button.entity-option .muted {
      font-size: 11px;
    }
    .finish-picker {
      margin: 4px 0 8px;
    }
    .finish-picker summary {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 4px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, #444);
    }
    .finish-picker h5 {
      margin: 8px 0 4px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--secondary-text-color, #999);
    }
    .finish-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 4px;
    }
    button.finish {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 4px;
      font-size: 10px;
      line-height: 1.15;
      min-width: 0;
      text-align: center;
    }
    button.finish.active {
      outline: 2px solid var(--accent);
    }
    .finish-swatch {
      display: inline-block;
      flex: none;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background-size: cover;
      border: 1px solid var(--divider-color, #555);
    }
    .wall-side {
      display: grid;
      grid-template-columns: 52px 1fr;
      align-items: start;
      gap: 6px;
    }
    .swatch {
      width: 26px;
      height: 26px;
      min-width: 0;
      padding: 0;
      border-radius: 50%;
      background: var(--swatch);
      border: 2px solid var(--divider-color, #555);
    }
    .swatch.active {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
    }
    .library-sources {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 4px 0 6px;
    }
    .library-sources button {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      font-size: 12px;
    }
    .library-sources button.active {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .credit a {
      color: inherit;
    }
    .piece-wrap {
      position: relative;
      display: flex;
    }
    .piece-wrap .piece {
      flex: 1;
    }
    .library .piece.placing {
      opacity: 0.5;
      cursor: progress;
    }
    .library .no-thumb {
      width: 56px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      --mdc-icon-size: 32px;
      opacity: 0.6;
    }
    .fetch-model {
      position: absolute;
      top: 2px;
      right: 2px;
      min-width: 0;
      width: 26px;
      height: 26px;
      padding: 0;
      display: grid;
      place-items: center;
      border-radius: 50%;
      --mdc-icon-size: 16px;
      background: var(--card-background-color, #1c1c1c);
    }
    .fetch-model.have {
      color: var(--success-color, #43a047);
      opacity: 1;
    }
    .remove-model {
      position: absolute;
      top: 0;
      right: 0;
      min-width: 0;
      width: 20px;
      height: 20px;
      padding: 0;
      line-height: 1;
      border-radius: 50%;
    }
    .library .piece img {
      width: 56px;
      height: 56px;
      object-fit: contain;
      pointer-events: none;
    }
    .inspector h4 {
      margin: 10px 0 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--secondary-text-color);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .furniture .front {
      stroke: rgba(60, 64, 70, 0.8);
      stroke-width: 2;
    }
    .furniture text {
      font-size: 10px;
      fill: #222;
      pointer-events: none;
    }
    .camera-view {
      fill: rgba(79, 163, 255, 0.16);
      stroke: rgba(79, 163, 255, 0.6);
      stroke-width: 1;
      pointer-events: none;
    }
    .camera-marker rect {
      fill: #e9ebee;
      stroke: #1d2126;
      stroke-width: 1.5;
      cursor: grab;
    }
    .camera-marker circle {
      fill: #1d2126;
    }
    .camera-marker.selected rect {
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 2.5;
    }
    .lamp-part {
      fill: #2b2f36;
      stroke: #f4c96b;
      stroke-width: 2;
      cursor: grab;
    }
    .lamp-part.on {
      fill: #ffd56b;
    }
    .lamp-strip {
      stroke: #f4c96b;
      stroke-width: 4;
      stroke-linecap: round;
      pointer-events: none;
    }
    .lamp-strip.on {
      stroke: #ffd56b;
    }
    /* on its own line under the light's name and buttons */
    .light-shape {
      order: 3;
      flex-basis: 100%;
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .light-shape select {
      flex: 1;
    }
    .lamp-marker {
      cursor: grab;
    }
    .mode-objects .wall-hit {
      pointer-events: none;
    }
    .lamp-marker circle:first-child {
      fill: rgba(20, 24, 28, 0.85);
      stroke: #c9d1d9;
      stroke-width: 1.5;
    }
    .lamp-marker.auto circle:first-child {
      stroke-dasharray: 3 2;
    }
    .lamp-marker.selected circle:first-child {
      stroke: var(--accent);
      stroke-width: 2.5;
    }
    .lamp-marker .bulb {
      fill: #8d949b;
    }
    .lamp-marker .base {
      stroke: #8d949b;
      stroke-width: 1.5;
    }
    .lamp-marker.on .bulb {
      fill: #ffcf6b;
    }
    .energy-marker {
      cursor: grab;
    }
    .energy-marker rect {
      fill: rgba(20, 24, 28, 0.9);
      stroke: var(--energy);
      stroke-width: 2;
    }
    .energy-marker.selected rect {
      stroke-width: 3.5;
    }
    .energy-marker text {
      fill: var(--energy);
      font-size: 12px;
      font-weight: 700;
      pointer-events: none;
    }
    ul.energy li {
      border-left: 3px solid var(--energy);
      padding-left: 6px;
    }
    ul.energy li.selected {
      background: rgba(255, 255, 255, 0.05);
    }
    textarea.yaml {
      font-family: ui-monospace, monospace;
      font-size: 12px;
      background: var(--card-background-color, #1c1c1c);
      color: var(--primary-text-color, #eee);
      border: 1px solid var(--divider-color, #444);
      border-radius: 8px;
      padding: 8px;
      resize: vertical;
    }
    .palette {
      place-items: start center;
      padding-top: 12vh;
    }
    .palette > div {
      width: min(520px, calc(100vw - 32px));
      min-width: 0;
      padding: 12px;
    }
    .palette-input {
      width: 100%;
      box-sizing: border-box;
      font-size: 16px;
      padding: 8px 10px;
    }
    .palette-list {
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
    }
    .palette-list li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    .palette-list li.active,
    .palette-list li:hover {
      background: var(--secondary-background-color, rgba(127, 127, 127, 0.15));
    }
    .palette-list .name {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .palette-list .name .muted {
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .shortcuts {
      position: fixed;
      inset: 0;
      z-index: 20;
      background: rgba(0, 0, 0, 0.5);
      display: grid;
      place-items: center;
    }
    .shortcuts > div {
      background: var(--card-background-color, #1c1c1c);
      border-radius: 12px;
      padding: 16px 24px;
      min-width: 360px;
    }
    .shortcuts h2 {
      margin: 0 0 8px;
    }
    .shortcuts dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 16px;
      margin: 0;
    }
    .shortcuts dd {
      margin: 0;
    }
    kbd {
      font-family: inherit;
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--divider-color, #555);
    }
    .draft {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: rgba(255, 193, 7, 0.15);
      border-bottom: 1px solid rgba(255, 193, 7, 0.5);
    }
    .draft span {
      flex: 1;
    }
    ul.problems {
      color: var(--error-color, #ff6b6b);
      font-size: 12px;
      margin: 0;
      padding-left: 18px;
    }
    ul.lights {
      list-style: none;
      padding: 0;
      margin: 0 0 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    ul.lights li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    ul.lights li .name {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    ul.lights li.hidden .name {
      opacity: 0.6;
    }
    .stair-hit {
      fill: transparent;
      stroke: #8a8f94;
      stroke-width: 1;
      cursor: move;
    }
    .mode-openings .stair-hit,
    .mode-objects .stair-hit {
      pointer-events: none;
    }
    .stair.selected .stair-hit {
      stroke: var(--accent);
      stroke-width: 2;
    }
    .stair-step {
      fill: none;
      stroke: #b8bdc2;
      stroke-width: 0.75;
      opacity: 0.6;
      pointer-events: none;
    }
    .stair-path {
      fill: none;
      stroke: #b8bdc2;
      stroke-width: 1.5;
      pointer-events: none;
    }
    .arrowhead {
      fill: #b8bdc2;
    }
    .edge-hit {
      stroke: transparent;
      stroke-width: 14;
      cursor: move;
    }
    .edge-handle {
      fill: #fff;
      stroke: var(--accent);
      stroke-width: 2;
      cursor: move;
    }
    .vertex.selected {
      fill: var(--primary-color, #03a9f4);
      stroke: #fff;
      stroke-width: 2;
    }
    .vertex {
      fill: var(--accent);
      stroke: #fff;
      stroke-width: 2;
      cursor: move;
    }
    .dim {
      font-size: 11px;
      fill: #222;
      paint-order: stroke;
      /* room fills are always light: a light halo keeps names readable over walls */
      stroke: rgba(255, 255, 255, 0.75);
      stroke-width: 3px;
      pointer-events: none;
    }
    .guide {
      stroke: #ff4fa3;
      stroke-width: 1;
      stroke-dasharray: 5 4;
      pointer-events: none;
    }
    .snap-ring {
      fill: none;
      stroke: #ff4fa3;
      stroke-width: 2;
      pointer-events: none;
    }
    .room-dim {
      font-size: 10px;
      fill: #4a4f55;
      pointer-events: none;
    }
    .dim.editable {
      pointer-events: auto;
      cursor: text;
      font-weight: 600;
      fill: #0277bd;
    }
    .dim.editable:hover {
      fill: #01579b;
      font-size: 12px;
    }
    .overall-dims .dim-line {
      stroke: var(--secondary-text-color, #aaa);
    }
    .dim.overall {
      fill: var(--primary-text-color, #eee);
      stroke: none;
      font-weight: 600;
    }
    .dim-line {
      stroke: #4a4f55;
      stroke-width: 1;
      pointer-events: none;
    }
    .section-line line:not(.section-hit),
    .section-line .section-arrow {
      stroke: #e0565b;
      stroke-width: 2;
      fill: none;
    }
    .section-line line:not(.section-hit) {
      stroke-dasharray: 14 4 3 4;
    }
    .section-line.selected line:not(.section-hit),
    .section-line.selected .section-arrow {
      stroke-width: 3.5;
    }
    .section-line text {
      fill: #e0565b;
      font-size: 12px;
      font-weight: 600;
      paint-order: stroke;
      stroke: var(--plan-bg, #fff);
      stroke-width: 3px;
    }
    .section-end {
      fill: var(--card-background-color, #fff);
      stroke: #e0565b;
      stroke-width: 2.5;
      cursor: grab;
    }
    .section-hit {
      stroke: transparent;
      cursor: pointer;
    }
    .measure line {
      stroke: #ff4fa3;
      stroke-width: 2;
    }
    .measure circle {
      fill: #ff4fa3;
    }
    .measure {
      pointer-events: none;
    }
    g.free-shape polygon {
      fill: color-mix(in srgb, var(--warning-color, #ffa600) 10%, transparent);
      stroke: var(--warning-color, #ffa600);
      stroke-width: 1.5;
      stroke-dasharray: 6 5;
      pointer-events: none;
    }
    g.unassigned .pill {
      fill: color-mix(in srgb, var(--warning-color, #ffa600) 22%, var(--card-background-color, #1c1c1c));
      stroke: var(--warning-color, #ffa600);
      stroke-width: 1;
    }
    g.unassigned text {
      font-size: 11px;
      font-weight: 600;
      fill: var(--primary-text-color, #fff);
      pointer-events: none;
    }
    g.unassigned .open-assign {
      cursor: pointer;
    }
    g.unassigned .open-assign circle {
      fill: var(--warning-color, #ffa600);
    }
    g.unassigned .open-assign:hover circle {
      fill: var(--primary-color, #03a9f4);
    }
    g.unassigned .open-assign path {
      fill: var(--card-background-color, #1c1c1c);
      pointer-events: none;
    }
    g.assign-hover polygon {
      fill: color-mix(in srgb, var(--primary-color, #03a9f4) 28%, transparent);
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 3;
      pointer-events: none;
    }
    g.assign-hover text {
      font-size: 15px;
      font-weight: 600;
      fill: var(--primary-text-color, #fff);
      paint-order: stroke;
      stroke: var(--card-background-color, #1c1c1c);
      stroke-width: 4px;
      pointer-events: none;
    }
    g.assign-hover text .what {
      font-size: 12px;
      font-weight: 400;
    }
    p.warning {
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--warning-color, #ffa600);
      background: color-mix(in srgb, var(--warning-color, #ffa600) 14%, transparent);
    }
    p.warning button.link {
      display: inline;
      padding: 0;
      margin-left: 4px;
    }
    .start-wrap {
      align-items: flex-start;
      overflow: auto;
    }
    .start {
      max-width: 760px;
      margin: 24px auto;
      padding: 0 16px 32px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .start h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 500;
    }
    .start-name {
      max-width: 360px;
    }
    .start-box {
      border: 1px solid var(--divider-color, #444);
      border-radius: 14px;
      background: var(--card-background-color, #1c1c1c);
      overflow: hidden;
    }
    .start-box.open {
      border-color: var(--primary-color, #03a9f4);
    }
    .start-box.grey .start-head {
      opacity: 0.55;
      cursor: default;
    }
    .start-head {
      display: grid;
      grid-template-columns: 40px 1fr;
      grid-template-rows: auto auto auto;
      column-gap: 12px;
      row-gap: 3px;
      width: 100%;
      padding: 14px 16px;
      border: none;
      border-radius: 0;
      background: none;
      text-align: left;
      cursor: pointer;
      --mdc-icon-size: 30px;
    }
    .start-head ha-icon {
      grid-row: 1 / 4;
      align-self: center;
      color: var(--primary-color, #03a9f4);
    }
    .start-title {
      font-size: 17px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .start-title .badge {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, transparent);
      color: var(--primary-text-color, #fff);
    }
    .start-found {
      font-size: 12px;
      color: var(--primary-color, #03a9f4);
    }
    .start-box.grey .start-found {
      color: inherit;
    }
    .start-body {
      padding: 0 16px 16px 68px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .start-images {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .start-images figure {
      position: relative;
      margin: 0;
    }
    .start-images img {
      width: 96px;
      height: 72px;
      object-fit: cover;
      border-radius: 8px;
      display: block;
    }
    .mapping-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 16px;
      padding: 4px 12px;
      --mdc-icon-size: 18px;
      border-color: var(--primary-color, #03a9f4);
    }
    .start-floor {
      display: grid;
      grid-template-columns: minmax(110px, 1fr) 2fr;
      align-items: center;
      gap: 6px 10px;
      padding: 6px 0;
      border-top: 1px solid var(--divider-color, #333);
    }
    .start-floor-name {
      font-weight: 500;
    }
    .start-floor-map {
      display: flex;
      align-items: center;
      gap: 6px;
      --mdc-icon-size: 18px;
    }
    .start-floor-help {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .start-recommend {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      flex: 1 1 100%;
      padding: 6px 8px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
      --mdc-icon-size: 16px;
    }
    .start-capture {
      border: 1px solid var(--primary-color, #03a9f4);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .start-capture h4 {
      margin: 0 0 4px;
    }
    .start-capture ol {
      margin: 0 0 8px;
      padding-left: 20px;
    }
    .start-live {
      max-width: 100%;
      max-height: 320px;
      border-radius: 8px;
      background: #fff;
    }
    .start-map {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 8px;
    }
    a.button {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, #444);
      color: inherit;
      text-decoration: none;
    }
    .tour {
      position: absolute;
      right: 12px;
      bottom: 12px;
      z-index: 3;
      width: min(340px, calc(100% - 24px));
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--card-background-color, #1c1c1c);
      border: 1px solid var(--primary-color, #03a9f4);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    }
    .tour h3 {
      margin: 0 0 6px;
      font-size: 16px;
    }
    .tour p {
      margin: 0 0 10px;
    }
    .tour-target {
      outline: 3px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
      animation: tour-glow 1.4s ease-in-out infinite;
    }
    @keyframes tour-glow {
      50% {
        outline-color: transparent;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tour-target {
        animation: none;
      }
    }
    .start-next.tip {
      position: absolute;
      left: 12px;
      bottom: 12px;
      z-index: 2;
      max-width: min(56ch, calc(100% - 24px));
      /* the plan under it stays usable: only its × takes clicks */
      pointer-events: none;
    }
    .start-next.tip .close {
      pointer-events: auto;
    }
    .start-next {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      max-width: min(64ch, 100%);
      padding: 8px 8px 8px 12px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 18%, var(--card-background-color, #1c1c1c));
      border: 1px solid var(--primary-color, #03a9f4);
    }
    @media (max-width: 700px) {
      .start-body {
        padding-left: 16px;
      }
    }
    .same-room {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 4px 0 10px;
    }
    .assign-areas {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .area-chip {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      text-align: left;
      cursor: grab;
    }
    .area-chip .where {
      font-size: 12px;
      opacity: 0.7;
    }
    /* already somewhere: still draggable (to move it), but out of the way */
    .area-chip.placed {
      opacity: 0.45;
      filter: grayscale(1);
    }
    .area-chip.placed:hover,
    .area-chip.placed.active {
      opacity: 0.8;
    }
    .area-chip.active {
      border-color: var(--primary-color, #03a9f4);
      box-shadow: 0 0 0 2px var(--primary-color, #03a9f4);
    }
    .area-chip.just {
      animation: area-just 1.2s ease-out;
    }
    @keyframes area-just {
      from {
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 40%, transparent);
      }
    }
    .line-preview.divide {
      stroke-width: 3;
      stroke-dasharray: 8 6;
      stroke-linecap: butt;
    }
    .line-preview {
      fill: none;
      stroke: var(--accent);
      stroke-width: 6;
      stroke-linecap: round;
      opacity: 0.7;
      pointer-events: none;
    }
    button.link {
      border: none;
      background: none;
      padding: 0 0 0 6px;
      min-height: 0;
      color: var(--accent);
      text-decoration: underline;
      cursor: pointer;
    }
    .piece-editor {
      border: 1px solid var(--line, rgba(127, 127, 127, 0.3));
      border-radius: 8px;
      padding: 6px 8px;
      margin: 6px 0;
    }
    .piece-editor summary {
      cursor: pointer;
    }
    .piece-part {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
      margin: 4px 0;
    }
    .triple {
      display: inline-flex;
      gap: 2px;
    }
    .triple input {
      width: 58px;
    }
    .piece-part input.finish {
      width: 96px;
    }
    .railing-line {
      stroke: var(--primary-text-color, #333);
      stroke-width: 3;
      stroke-dasharray: 2 4;
      stroke-linecap: round;
      pointer-events: none;
    }
    .wall-hit.free.selected {
      stroke: var(--accent);
      stroke-opacity: 0.35;
    }
    input.dim-input {
      width: 84px;
      min-height: 28px;
      height: 28px;
      box-sizing: border-box;
      padding: 0 6px;
      border: 2px solid var(--accent);
    }
    table.defaults {
      border-collapse: collapse;
      width: 100%;
    }
    table.defaults th {
      font-weight: normal;
      font-size: 12px;
      text-align: left;
      color: var(--secondary-text-color);
      padding: 2px 4px 2px 0;
    }
    table.defaults input {
      width: 100%;
      box-sizing: border-box;
    }
    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
    }
    .rect-preview {
      fill: rgba(3, 169, 244, 0.15);
      stroke: var(--accent);
      stroke-width: 2;
      stroke-dasharray: 5 4;
      pointer-events: none;
    }
    .hint {
      position: absolute;
      pointer-events: none;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--card-background-color, #222);
      border: 1px solid var(--divider-color, #444);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .plan-top {
      position: absolute;
      left: 10px;
      top: 10px;
      right: 10px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      pointer-events: none;
    }
    .plan-top > * {
      pointer-events: auto;
    }
    main {
      position: relative;
    }
    /* a toolbar button's choices, beside it */
    .flyout {
      position: absolute;
      z-index: 20;
      max-width: min(480px, calc(100% - 12px));
      padding: 6px;
      border-radius: 12px;
      background: var(--card-background-color, #1c1c1c);
      border: 1px solid var(--divider-color, #444);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      animation: flyout-in 0.12s ease-out;
    }
    @keyframes flyout-in {
      from {
        opacity: 0;
        transform: translateX(-6px);
      }
    }
    .sub-tools {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .sub-tools button {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 0 10px;
      border-radius: 8px;
    }
    .sub-tools button.active {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    .sub-tools kbd {
      font: inherit;
      font-size: 11px;
      opacity: 0.65;
    }
    .tools button.group {
      position: relative;
    }
    /* a corner mark: there is more under this button */
    .tools button.group::after {
      content: "";
      position: absolute;
      right: 4px;
      bottom: 4px;
      border: 4px solid transparent;
      border-right-color: currentColor;
      border-bottom-color: currentColor;
      opacity: 0.6;
    }
    .hint-bar {
      max-width: min(60ch, 100%);
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 6px 6px 12px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--card-background-color, #1c1c1c) 92%, transparent);
      border: 1px solid var(--divider-color, #444);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      font-size: 13px;
      line-height: 1.35;
      color: var(--primary-text-color, #eee);
      /* the plan stays usable underneath; only the close button takes clicks */
      pointer-events: none;
    }
    .hint-bar .close {
      pointer-events: auto;
    }
    .hint-bar.action {
      border-color: var(--accent);
    }
    .hint-bar .close {
      flex: none;
      min-height: 0;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      background: none;
      font-size: 16px;
      line-height: 1;
      opacity: 0.7;
    }
    .side-handle {
      width: 6px;
      margin-right: -6px;
      flex: none;
      cursor: col-resize;
      position: relative;
      z-index: 3;
      touch-action: none;
    }
    .side-handle:hover,
    .side-handle:active {
      background: var(--accent);
      opacity: 0.5;
    }
    .side {
      width: min(420px, 40%);
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--divider-color, #333);
      min-height: 0;
      overflow: auto;
    }
    canvas.preview {
      width: 100%;
      height: 300px;
      flex: none;
      display: block;
      cursor: grab;
      touch-action: none;
      border-bottom: 1px solid var(--divider-color, #333);
    }
    .inspector {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .inspector h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 500;
    }
    .inspector label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color, #aaa);
    }
    .muted {
      margin: 0;
      font-size: 12px;
      color: var(--secondary-text-color, #aaa);
    }
    .issues {
      padding: 8px 16px 16px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .issues li.error {
      color: var(--error-color);
    }
    .create {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: min(440px, calc(100vw - 32px));
      text-align: left;
      background: var(--card-background-color, #1c1c1c);
      border-radius: 12px;
      padding: 20px;
    }
    .create h2 {
      margin: 0;
    }
    .create label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color, #aaa);
    }
    .create label.check,
    .inspector label.check {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .create fieldset {
      border: 1px solid var(--divider-color, #333);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .row > label {
      flex: 1;
    }
    .row.end {
      justify-content: flex-end;
    }
    button.primary {
      background: var(--accent);
      color: var(--text-primary-color, #fff);
      border-color: var(--accent);
    }
    .add-level {
      font-size: 13px;
      opacity: 0.8;
    }
    ul.unplaced {
      list-style: none;
      padding: 0;
      margin: 0 0 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    ul.unplaced li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .inspector h3 {
      font-size: 14px;
      margin: 12px 0 2px;
    }
    .empty {
      padding: 32px;
      color: var(--secondary-text-color);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    /* phones: the plan first; header, tools and floors in slim rows, the inspector a sheet below */
    @media (max-width: 700px) {
      header {
        flex-wrap: nowrap;
        overflow-x: auto;
        gap: 6px;
        padding: 4px 8px;
        min-height: 0;
      }
      h1,
      canvas.preview {
        display: none;
      }
      header > * {
        flex: none;
        white-space: nowrap;
      }
      .tools .divider {
        width: 1px;
        height: auto;
        flex: none;
        margin: 4px 2px;
      }
      .tools {
        padding: 4px 8px;
        gap: 4px;
        overflow-x: auto;
      }
      .tools button {
        width: 36px;
        height: 36px;
        flex: none;
      }
      aside.levels {
        padding: 4px 8px;
      }
      .plan-wrap {
        min-height: 0;
      }
      .side {
        max-height: 34% !important;
      }
    }
    @media (max-width: 900px) {
      main {
        flex-direction: column;
      }
      aside.levels {
        flex-direction: row;
        width: auto;
        overflow-x: auto;
        border-right: none;
      }
      .tools {
        flex-direction: row;
        border-right: none;
        border-bottom: 1px solid var(--divider-color, #333);
      }
      .side-handle {
        display: none;
      }
      .side {
        width: 100% !important;
        max-height: 45%;
        border-left: none;
        border-top: 1px solid var(--divider-color, #333);
      }
    }
  `;
}
