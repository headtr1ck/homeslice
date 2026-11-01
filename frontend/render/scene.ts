// Builds a three.js scene from the expanded model and renders it on demand. Plan (x, y)
// maps to world (x, z) with y up, so south is +z. Nothing renders continuously: frames
// are drawn on request, and during short transitions (focusing a floor) only until the
// transition ends.

import * as THREE from "three";
import { simplePiece } from "./simple";
import { detailFor, fitModel, loadModel, modelColor } from "./models";
import { nearestCorner, offsetPolygon, perimeterPath } from "../model/route";
import { finishLook, onFinishLoaded } from "./finishes";
import { FINISHES_BY_ID } from "../model/finishes";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { House, Level, LightType, Side, Vec2, Vertical } from "../model/types";
import { innerPolygon, type Wall, type WallOpening } from "../model/walls";
import { bbox, overlap, pointInPolygon } from "../model/geometry";
import { stairFrame, stairHole } from "../model/stairs";

/** `isometric`: parallel lines stay parallel; `perspective`: walls lean, like a photo. */
export type Projection = "isometric" | "perspective";

export interface Orientation {
  /** Compass direction the camera looks from: 0 north, 90 east, 180 south, 270 west. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  projection?: Projection;
}

export interface ViewOptions {
  azimuth: number;
  elevation: number;
  /** Overview projection. */
  projection: Projection;
  /** Extra gap between levels in metres. */
  explode: number;
  /** Outer walls facing the camera are cut down to this height so you can look in… */
  cutHeight: number;
  /** …but only while the camera is lower than this many degrees; steeper views show full walls. */
  cutBelow: number;
  /** Camera when a level is focused; by default from the south, steep, with perspective. */
  focus: Orientation;
  /** Per-level camera when that level is focused, keyed by level id. */
  levels: Record<string, Partial<Orientation>>;
  /** Draw outdoor areas (garden, terrace); they are see-through so lower floors show. */
  showOutdoor: boolean;
  /** Draw the house's roof in the overview (hidden while a floor is picked or hovered). */
  roof: boolean;
  /** Furniture from simple shapes, or detailed models (loaded when first needed). */
  furniture: "simple" | "detailed";
  /** A floor plan: no shadows (they read as dirt from above), gardens framed with the floor, walls dark as on a drawn plan, door swings on the floor. */
  plan: boolean;
  /** Floors next to each other, left to right from the lowest, instead of stacked (a plan of every floor). */
  sideBySide: boolean;
  /** Walls (and doors, windows) end at this height: a tilted plan that looks into the rooms (null: full height). */
  lowWalls: number | null;
}

export const DEFAULT_VIEW: ViewOptions = {
  azimuth: 250,
  elevation: 38,
  projection: "isometric",
  explode: 2.6,
  cutHeight: 0.4,
  cutBelow: 60,
  focus: { azimuth: 180, elevation: 65, projection: "perspective" },
  levels: {},
  showOutdoor: true,
  roof: false,
  furniture: "detailed",
  plan: false,
  sideBySide: false,
  lowWalls: null,
};

/** View options from a card config or a saved view (which use snake_case keys). */
export function viewOptions(
  view: (Partial<ViewOptions> & { cut_height?: number; cut_below?: number; show_outdoor?: boolean; locked?: boolean; id?: string; name?: string }) | undefined,
): Partial<ViewOptions> {
  if (!view) return {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cut_height, cut_below, show_outdoor, locked, id, name, ...rest } = view;
  return {
    ...rest,
    ...(cut_height !== undefined ? { cutHeight: cut_height } : {}),
    ...(cut_below !== undefined ? { cutBelow: cut_below } : {}),
    ...(show_outdoor !== undefined ? { showOutdoor: show_outdoor } : {}),
  };
}

/** The least power that moves the pulses on a flow line. */
const MIN_FLOW_WATTS = 10;

// One perspective camera does both: "isometric" is a very narrow lens from far away, so
// switching projections animates as a smooth zoom.
const FOV: Record<Projection, number> = { isometric: 3, perspective: 40 };

export interface LightLook {
  rgb: [number, number, number];
  /** 0..1 */
  brightness: number;
}

/** The animated camera state. */
interface CameraState {
  azimuth: number;
  elevation: number;
  fov: number;
}

/** How the house is drawn: by day, at night, as a white model or as a blueprint. */
export type Look = "day" | "night" | "white" | "blueprint";

const BLUEPRINT = { background: "#0b1a33", surface: "#2f5c9e", glass: "#6aa6ff" };

/** The night look's outlines, unless the card picks another colour. */
export const DEFAULT_ACCENT = "#4fc3f7";

const COLORS = {
  wall: "#eeeae3",
  planWall: "#3a3f45",
  cameraView: "#4fa3ff",
  cameraMotion: "#ff4d4d",
  slab: "#6f7275",
  stairs: "#d8d3ca",
  tread: "#c9965c",
  steel: "#3b4046",
  glass: "#9cc8ee",
  glassOpen: "#ffb05c",
  door: "#a77b55",
  entranceDoor: "#f3f3f0",
  frosted: "#dde7ee",
  garageDoor: "#7d858d",
  shutter: "#5d666f",
  shutterBox: "#4a5159",
  stripClosed: "#6b747c",
  stripOpen: "#7fb0ff",
  awning: "#d9c9a3",
  roof: "#8e5b45",
  panel: "#1d2b44",
  panelFrame: "#b9c0c8",
};

/** Colours of the energy overlay, per kind. */
export const ENERGY_COLORS: Record<string, string> = {
  solar: "#ffc23d",
  battery: "#4cd07d",
  grid: "#5aa9ff",
  inverter: "#c9d1d9",
  device: "#ff8a4c",
};

/** An item of the energy overlay as the renderer needs it. */
export interface EnergyItem {
  key: string;
  /** The item its flow line goes to (null: none). */
  to: string | null;
  kind: string;
  levelIndex: number | null;
  at: Vec2 | null;
  roof: string;
}

/** A point of a flow line: on a level, in that level's coordinates (it moves with the level). */
interface RoutePoint {
  levelIndex: number;
  local: THREE.Vector3;
}

/** The solar field on its roof side, for starting its line at the field's edge. */
interface SolarField {
  /** Where the field starts and ends along the ridge. */
  ends: [number, number];
  /** A point on the roof: `r` along the ridge, `k` from the eave (0) to the ridge (1). */
  at: (r: number, k: number) => THREE.Vector3;
  /** How far along the ridge a plan point is. */
  rOf: (p: Vec2) => number;
}

type EnergyPoint = { levelIndex: number; local: THREE.Vector3; onRoof?: boolean; field?: SolarField };

interface Flow {
  key: string;
  to: string;
  /** From the item along the walls and down a corner of the house to `to`. */
  route: RoutePoint[];
  /** The cable, always shown; `dots`: the coloured pulses moving along it (and their glow). */
  line: Line2;
  dots: THREE.Group;
  pulse: LineMaterial;
  glow: LineMaterial;
  geometry: LineGeometry;
  /** The world positions last given to the geometry (it is rebuilt only when they change). */
  placed: string;
  /** Watts towards `to` (negative: away from it). */
  watts: number;
}
const FOCUS_MS = 600;
const HOVER_MS = 160;
/** Opacity of the levels above a hovered level. */
/** Hovered: the floors above slide up out of the way and fade out completely (no ghosts). */
const HOVER_FADE = 0;
const HOVER_TINT = new THREE.Color(0x1d3047);
const SHUTTER_DEPTH = 0.05;

/** Shape in the XY plane that lands on the XZ plane after rotateX(-90°). */
function shapeOf(poly: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, -y)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, -y))));
  return shape;
}

/** For tests and debugging. */
export type RoofShape = House["roof"];

/** A soft round spot of light: white in the middle, fading out to the edge. */
function glowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.75)");
  g.addColorStop(0.45, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bright at the top, fading out downwards: cones of downlights, washes on walls. */
function fadeTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.35, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bright at the bottom, fading out upwards: the night look's light at the foot of walls. */
function riseTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,0.6)");
  g.addColorStop(0.3, "rgba(255,255,255,0.2)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function holesFor(level: Level, vertical: Vertical[]): Vec2[][] {
  // a stairwell cuts the floors it leads up to, not the one it starts on
  return vertical.filter((v) => level.index > v.from && level.index <= v.to).map(stairHole);
}

/** Lamps lighting the scene at once (a fixed number: changing it would rebuild every shader). */
const LIGHT_POOL = 8;

interface LevelState {
  group: THREE.Group;
  baseY: number;
  materials: Set<THREE.Material>;
  /** Materials of walls, slabs and stairs (not floors, whose glow shows the lights). */
  tintable: THREE.MeshLambertMaterial[];
  /** Animated values: 0..1 opacity and lift in metres for focus, 0..1 opacity for hover. */
  opacity: number;
  lift: number;
  hoverOpacity: number;
  /** Metres the level is lifted out of the way while a level below it is hovered. */
  hoverLift: number;
}

/**
 * A cover is drawn twice: as a shutter outside the window, and as a status strip on top
 * of the cut-down wall. Which one shows depends on the camera.
 */
interface CoverView {
  shutter: { mesh: THREE.Mesh; top: number; height: number } | null;
  strip: { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial };
  normal: Vec2;
  cuttable: boolean;
  /** 0 open … 1 closed */
  closed: number;
  /** A garage door with a contact but no cover: open or closed with the contact. */
  byContact?: boolean;
}

/** What a linked device shows (see ha/devices.ts). */
export interface DeviceLook {
  /** Switched on (a TV on, a fire burning, a pump powered). */
  on: boolean;
  /** Doing its work: playing, running, heating, charging. */
  active: boolean;
  /** Covers: 1 open … 0 closed. */
  open?: number | null;
  /** Climate: what it is doing, for the status light's colour; alarms are red. */
  tone?: "heat" | "cool" | "alarm" | null;
  /** Fans: 0 … 1. */
  speed?: number | null;
}

type LeafHow = "swing" | "tilt" | "slide";

/** A light as the card places it (see model/lights.ts PlacedLight). */
export interface LampPlace {
  levelId: string;
  entity: string;
  at: Vec2;
  type?: LightType;
  spots?: Vec2[];
  to?: Vec2;
  height?: number;
  /** Indirect light: the room's floor inside its walls, whose walls it washes. */
  outline?: Vec2[];
}

interface LeafView {
  pivot: THREE.Group;
  how: LeafHow;
  /** +1: the leaf runs from its hinge along the wall's direction, -1 against it. */
  dir: number;
  u: Vec2;
  n: Vec2;
  /** +1: it opens to the n side of the wall, -1 to the other. */
  swing: number;
  width: number;
  /** 0 closed … 1 open: where it goes, and where it is. */
  target: number;
  now: number;
  shown?: boolean;
  /** Adds a part that moves with the leaf (glass in a door). */
  add(s0: number, s1: number, z0: number, z1: number, material: THREE.Material, thickness: number): THREE.Mesh;
}

interface DeviceParts {
  materials: THREE.MeshLambertMaterial[];
  spinners: THREE.Object3D[];
  curtains: THREE.Object3D[];
}

export class HouseRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private root = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private sky = new THREE.HemisphereLight(0xffffff, 0x50555c, 1.4);
  private ambient = new THREE.AmbientLight(0xffffff, 0.35);
  /** The real sun (plan degrees: 0 north, 90 east) or null for the default light from the south-west. */
  private sunAt: { azimuth: number; elevation: number } | null = null;
  private view: ViewOptions = DEFAULT_VIEW;
  private levels: LevelState[] = [];

  private levelIds: string[] = [];
  /** Room floors keyed by `level/room`, each with its own material so it can glow. */
  private floors = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>>();
  private covers = new Map<string, CoverView>();
  private glasses = new Map<string, THREE.MeshLambertMaterial>();
  /** Lamps by entity: the fitting and its pool of light on the floor. */
  private lamps = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]>();
  /** The glowing parts (bulbs, shades, opal glass) of pieces linked to a light, by light. */
  private pieceGlows = new Map<string, THREE.MeshLambertMaterial[]>();
  /**
   * Real light from the lamps that are on: a fixed pool (the shaders never change), given
   * to the brightest lamps on the levels in view. Where each lamp is: level and plan point.
   */
  private lightPool: THREE.PointLight[] = [];
  private lampPlaces = new Map<string, { level: number; at: Vec2; high?: boolean }[]>();
  /** 0 by day … 1 at night: lamps light the rooms more when it is dark. */
  private night = 0;
  /** Each light's last look, for pieces that finish loading later. */
  private lampLooks = new Map<string, LightLook | null>();
  /** Pieces linked to an entity, for taps. */
  private linked: THREE.Object3D[] = [];
  /** The parts of linked pieces their device drives (screens, flames, fans…), by entity. */
  private devices = new Map<string, DeviceParts[]>();
  private deviceLooks = new Map<string, DeviceLook | null>();
  private look: Look = "day";
  /** Each material's own colour and texture, while a look paints over them. */
  private ownLooks = new WeakMap<THREE.Material, { color: THREE.Color; map: THREE.Texture | null }>();
  private accent = DEFAULT_ACCENT;
  private outlines: THREE.Group[] = [];
  /** Cameras' views on the floor, by camera. */
  private cameraViews = new Map<string, THREE.MeshBasicMaterial[]>();
  /** A drawn plan's door swings (wide lines need the canvas size). */
  private planLines: LineSegments2[] = [];
  /** Door leaves and window panes that open with their contact, by opening. */
  private leaves = new Map<string, LeafView[]>();
  private lastSpin = 0;
  private turnFrame = 0;
  /** Where the next floor starts when floors are side by side. */
  private sideX = 0;
  private lampObjects: THREE.Object3D[] = [];
  private glowTexture?: THREE.Texture;
  private fadeTexture?: THREE.Texture;
  private riseTexture?: THREE.Texture;
  private white?: THREE.Texture;
  private roof: THREE.Group | null = null;
  /** Furniture materials of the level being built. */
  private furnitureMaterials = new Map<string, THREE.MeshLambertMaterial>();
  /** Detailed furniture models' materials turned into the level's, per level being built. */
  private modelMaterials = new Map<THREE.Material, THREE.MeshLambertMaterial>();
  /** Bumped on every rebuild, so models that arrive late skip a house that is gone. */
  private generation = 0;
  private pendingModels: Promise<void>[] = [];
  /** Called when something changes without a call from outside (a model has loaded). */
  onChange?: () => void;
  /** The roof's shape and the level it sits on, for placing solar panels. */
  private roofInfo: { level: Level; shape: RoofShape } | null = null;
  private energyObjects: THREE.Object3D[] = [];
  /** Robots: their body (moved to the live position) and status ring, on their level. */
  private robots = new Map<string, { levelIndex: number; body: THREE.Group; ring: THREE.MeshBasicMaterial }>();
  private robotObjects: THREE.Object3D[] = [];
  /** Where each energy item is, in its level group's coordinates (solar: on the roof). */
  private energyPoints = new Map<string, EnergyPoint>();
  private flows: Flow[] = [];
  /** Each level's outline and storey height, for routing the energy lines along the house. */
  private levelOutlines: Vec2[][] = [];
  private levelHeights: number[] = [];
  private levelRooms: Vec2[][][] = [];
  /** Awnings by "level/room": the fabric scales along its depth with the cover position. */
  private awnings = new Map<string, THREE.Mesh>();
  /** Upper parts of outer walls, hidden while they face a low camera. */
  private cuttables: { mesh: THREE.Mesh; normal: Vec2 }[] = [];
  private building: Set<THREE.Material> | null = null;
  /** The house's facade finish (outside faces of exterior walls). */
  private facade?: string;
  private size = { width: 1, height: 1 };
  private focus: number | null = null;
  private animation = 0;
  private hover: number | null = null;
  private hoverAnimation = 0;
  /** Current camera (animated between the overview and focus cameras). */
  orientation: CameraState = { azimuth: 0, elevation: 0, fov: FOV.isometric };
  /** What the camera frames (animated, levels at rest). */
  private box = new THREE.Box3();
  /** Interactive zoom on top of the framing (1 = fit). */
  zoom = 1;
  /** Width / height of the whole house as seen by the overview camera. */
  aspect = 1.6;

  /**
   * `low` quality is for weak wall tablets: no shadows or edge smoothing, plain colours
   * instead of textures, two lamp lights, one pixel per CSS pixel.
   */
  readonly quality: "high" | "low";

  constructor(canvas: HTMLCanvasElement, options: { quality?: "high" | "low" } = {}) {
    this.quality = options.quality ?? "high";
    const low = this.quality === "low";
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, alpha: true });
    this.renderer.shadowMap.enabled = !low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(this.root);
    this.scene.add(this.sky, this.ambient);
    this.sun.castShadow = !low;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    // round shapes (hedges, bushes) would shade themselves in stripes without it
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    for (let i = 0; i < (low ? 2 : LIGHT_POOL); i++) {
      const light = new THREE.PointLight(0xffe4b8, 0, 7, 2);
      this.lightPool.push(light);
      this.scene.add(light);
    }
    // a downloaded floor or wall texture arrived: draw again
    this.stopFinishes = onFinishLoaded(() => this.onChange?.());
  }
  private stopFinishes: () => void;

  // ----- building -----

  /** A material owned by the level being built (levels fade independently). */
  private lambert(color: string, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ color, ...extra });
    this.building?.add(m);
    return m;
  }

  setModel(house: House, walls: Map<string, Wall[]>, view: Partial<ViewOptions> = {}) {
    this.view = { ...DEFAULT_VIEW, ...view, focus: { ...DEFAULT_VIEW.focus, ...view.focus }, levels: view.levels ?? {} };
    this.clear();
    this.sideX = 0;
    this.facade = house.facade;
    for (const level of house.levels) {
      const materials = new Set<THREE.Material>();
      this.building = materials;
      const group = this.buildLevel(level, walls.get(level.id) ?? [], house.vertical);
      this.building = null;
      const baseY = this.view.sideBySide ? 0 : level.elevation + level.index * this.view.explode;
      group.position.y = baseY;
      if (this.view.sideBySide) {
        // each floor to the right of the one below, a gap between
        const { min, max } = bbox(level.outline.length ? level.outline : level.rooms.flatMap((r) => r.polygon));
        group.position.x = this.sideX - min[0];
        this.sideX += max[0] - min[0] + 2;
      }
      this.root.add(group);
      const floorMaterials = new Set(level.rooms.map((r) => this.floors.get(`${level.id}/${r.id}`)?.material));
      const tintable = [...materials].filter((m): m is THREE.MeshLambertMaterial => m instanceof THREE.MeshLambertMaterial && !floorMaterials.has(m));
      this.levels.push({ group, baseY, materials, tintable, opacity: 1, lift: 0, hoverOpacity: 1, hoverLift: 0 });
      this.levelOutlines.push(level.outline);
      this.levelHeights.push(level.height);
      this.levelRooms.push(level.rooms.filter((r) => r.kind === "room").map((r) => r.polygon));
      this.levelIds.push(level.id);
    }
    const top = house.levels[house.levels.length - 1];
    this.roofInfo = top ? { level: top, shape: house.roof } : null;
    if (this.view.roof && top) {
      this.roof = this.buildRoof(top, house.roof);
      const l = this.levels[this.levels.length - 1];
      l.group.add(this.roof);
    }
    this.sun.castShadow = !this.view.plan && this.quality !== "low";
    this.focus = null;
    this.hover = null;
    this.orientation = this.cameraFor(null);
    this.box = this.boxFor(null);
    this.aspect = this.extent(this.orientation, this.box);
    this.applyTheme();
    this.placeSun();
  }

  private clear() {
    cancelAnimationFrame(this.animation);
    cancelAnimationFrame(this.hoverAnimation);
    this.generation++;
    this.pendingModels = [];
    this.root.traverse((o) => {
      // loaded models share their geometry between pieces and cards
      if (o instanceof THREE.Mesh && !o.userData.shared) o.geometry.dispose();
    });
    for (const l of this.levels) for (const m of l.materials) m.dispose();
    this.root.clear();
    this.levels = [];
    this.levelIds = [];
    this.floors.clear();
    this.pieceGlows.clear();
    this.devices.clear();
    this.leaves.clear();
    this.outlines = [];
    this.planLines = [];
    this.cameraViews.clear();
    this.linked = [];
    this.covers.clear();
    this.glasses.clear();
    this.awnings.clear();
    this.roof = null;
    this.roofInfo = null;
    this.energyObjects = [];
    this.energyPoints.clear();
    this.flows = [];
    this.robots.clear();
    this.robotObjects = [];
    this.levelOutlines = [];
    this.levelHeights = [];
    this.levelRooms = [];
    this.lamps.clear();
    this.lampObjects = [];
    this.cuttables = [];
  }

  private mesh<M extends THREE.Material | THREE.Material[]>(geometry: THREE.BufferGeometry, material: M, shadows = true) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadows;
    m.receiveShadow = true;
    return m;
  }

  private buildLevel(level: Level, walls: Wall[], vertical: Vertical[]): THREE.Group {
    const g = new THREE.Group();
    this.furnitureMaterials.clear();
    this.modelMaterials = new Map();
    g.name = level.id;
    const holes = holesFor(level, vertical);

    // slab under the level
    if (level.outline.length) {
      const slab = new THREE.ExtrudeGeometry(shapeOf(level.outline, holes), { depth: level.slab, bevelEnabled: false });
      slab.rotateX(-Math.PI / 2);
      slab.translate(0, -level.slab, 0);
      g.add(this.mesh(slab, this.lambert(COLORS.slab)));
    }

    // room floors
    for (const room of level.rooms) {
      if (room.kind === "void" || (room.kind === "outdoor" && !this.view.showOutdoor)) continue;
      // floors end at the inside of their walls, so a room's light doesn't glow under them
      const floorPoly = room.kind === "room" ? innerPolygon(room.polygon, walls) : room.polygon;
      // the stairwell's part inside this room (it may reach into it only partly)
      const inside = holes.map((h) => overlap(h, floorPoly)).filter((h): h is Vec2[] => !!h);
      const geo = new THREE.ShapeGeometry(shapeOf(floorPoly, inside));
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, room.kind === "outdoor" ? -level.slab + 0.01 : 0.004, 0);
      // its finish: a texture in plan metres, or a colour
      const { map, color } = this.finish(room.floor);
      // outdoor areas reach over the floors below in the exploded view: keep them see-through
      // (on the lowest level nothing is below: solid there)
      const material = room.kind === "outdoor" && level.index > 0 ? this.lambert(color, { map, transparent: true, opacity: 0.55, depthWrite: false }) : this.lambert(color, { map });
      const floor = this.mesh(geo, material, false);
      floor.userData.room = `${level.id}/${room.id}`;
      floor.userData.outdoor = room.kind === "outdoor";
      this.floors.set(`${level.id}/${room.id}`, floor);
      g.add(floor);
    }

    for (const room of level.rooms) for (const f of room.furniture) g.add(this.furniture(f, level.height));

    for (const room of level.rooms) if (room.awning && (room.kind !== "outdoor" || this.view.showOutdoor)) this.awning(g, level, room);
    for (const room of level.rooms) for (const c of room.cameras ?? []) this.camera3d(g, c);

    // walls, split around openings; each face in its room's finish (or the facade's)
    // a drawn plan shows walls dark from above
    const wallMat = this.lambert(this.view.plan ? COLORS.planWall : COLORS.wall);
    const finishMats = new Map<string, THREE.MeshLambertMaterial>();
    const finishMat = (id: string | undefined) => {
      if (!id) return wallMat;
      let m = finishMats.get(id);
      if (!m) {
        const look = this.finish(id);
        finishMats.set(id, (m = this.lambert(look.color, { map: look.map })));
      }
      return m;
    };
    const rooms = level.rooms.filter((r) => r.kind === "room");
    /** The finish of a wall face looking along n from the wall's middle. */
    const faceFinish = (w: Wall, n: Vec2): string | undefined => {
      const mid: Vec2 = [(w.a[0] + w.b[0]) / 2 + n[0] * (w.thickness / 2 + 0.05), (w.a[1] + w.b[1]) / 2 + n[1] * (w.thickness / 2 + 0.05)];
      const room = rooms.find((r) => pointInPolygon(mid, r.polygon));
      if (!room) return w.type === "exterior" ? this.facade : undefined;
      // the room's wall on its north side faces south, and so on
      const side: Side = Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? "west" : "east") : n[1] > 0 ? "north" : "south";
      return room.wallSides?.[side] ?? room.wall;
    };
    const glass = this.lambert(COLORS.glass, { transparent: true, opacity: 0.45 });
    const garage = this.lambert(COLORS.garageDoor);
    const doorLeaf = this.lambert(COLORS.door);
    const whiteLeaf = this.lambert(COLORS.entranceDoor);
    const frosted = this.lambert(COLORS.frosted, { transparent: true, opacity: 0.85 });
    for (const w of walls) {
      if (w.type === "open") continue; // rooms open to each other: no wall
      const finishes: [THREE.Material, THREE.Material] = [finishMat(faceFinish(w, w.normal)), finishMat(faceFinish(w, [-w.normal[0], -w.normal[1]]))];
      const painted = finishes[0] !== wallMat || finishes[1] !== wallMat;
      // outer walls are split at the cut height; the upper part hides while it faces a low camera
      const cuttable = w.type !== "interior";
      const cutAt = Math.min(this.view.cutHeight, w.height);
      const H = this.view.lowWalls ? Math.min(w.height, this.view.lowWalls) : w.height;
      const box = (s: number, e: number, z0: number, z1: number, plain: THREE.Material, thickness = w.thickness) => {
        if (e - s < 1e-3 || z1 - z0 < 1e-3) return;
        // wall pieces carry their faces' finishes (frames and leaves stay as they are)
        const mat: THREE.Material | THREE.Material[] = plain === wallMat && painted ? this.wallFaces(w, wallMat, finishes) : plain;
        if (!cuttable || z1 <= cutAt + 1e-3) {
          g.add(this.wallBox(w, s, e, z0, z1, thickness, mat));
          return;
        }
        if (z0 < cutAt) g.add(this.wallBox(w, s, e, z0, cutAt, thickness, mat));
        const upper = this.wallBox(w, s, e, Math.max(z0, cutAt), z1, thickness, mat);
        this.cuttables.push({ mesh: upper, normal: w.normal });
        g.add(upper);
      };
      let cursor = -w.extendStart;
      const length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) + w.extendEnd;
      for (const o of w.openings) {
        box(cursor, o.start, 0, H, wallMat);
        box(o.start, o.end, 0, Math.min(o.sill, H), wallMat);
        box(o.start, o.end, o.sill + o.height, H, wallMat);
        // low walls end below the top of a door or window (and a high window is gone)
        const top = Math.min(o.sill + o.height, H);
        if (top - o.sill < 0.02) {
          cursor = o.end;
          continue;
        }
        if (this.view.plan && o.type === "door") this.doorSwing(g, w, o, rooms);
        const mid = (o.start + o.end) / 2;
        // a bar in the middle (double windows, sliding doors)
        const bar = () => box(mid - 0.03, mid + 0.03, o.sill, top, wallMat, 0.07);
        // with a contact, leaves and panes move: they are drawn on their own, around their hinge
        const moving = o.contact ? this.opener(g, w, o, rooms, cutAt, cuttable) : null;
        const pane = (s0: number, s1: number, z0: number, z1: number, m: THREE.Material, t: number, how: LeafHow) => (moving ? moving(s0, s1, z0, z1, m, t, how) : box(s0, s1, z0, z1, m, t));
        // windows, and glass doors (sliding and terrace doors)
        if (o.type === "window" || (o.type === "door" && ["sliding_glass", "glass", "glass_double"].includes(o.style))) {
          const mat = o.contact ? this.lambert(COLORS.glass, { transparent: true, opacity: 0.45 }) : glass;
          if (o.contact) this.glasses.set(o.id, mat);
          if (!moving) box(o.start, o.end, o.sill, top, mat, 0.03);
          else if (o.type === "door" && o.style === "sliding_glass") {
            // two panels: the one on the hinge side slides over the other
            pane(o.start, mid + 0.03, o.sill, top, mat, 0.03, "slide");
            box(mid - 0.03, o.end, o.sill, top, mat, 0.03);
          } else if (o.type === "door") {
            if (o.style === "glass_double") {
              pane(o.start, mid, o.sill, top, mat, 0.03, "swing");
              pane(mid, o.end, o.sill, top, mat, 0.03, "swing");
            } else pane(o.start, o.end, o.sill, top, mat, 0.03, "swing");
          } else if (o.style === "fixed" || o.style === "split" || o.style === "split_single") box(o.start, o.end, o.sill, top, mat, 0.03);
          else pane(o.start, o.end, o.sill, top, mat, 0.03, "tilt");
          if (o.style === "double" || o.style === "sliding_glass" || o.style === "glass_double") bar();
          if (o.style === "triple") {
            const third = (o.end - o.start) / 3;
            for (const b of [o.start + third, o.end - third]) box(b - 0.03, b + 0.03, o.sill, top, wallMat, 0.07);
          }
          if (o.style === "split" || o.style === "split_single") {
            // a fixed pane below, a double (or single) window above
            const at = o.sill + o.split;
            box(o.start, o.end, at - 0.03, at + 0.03, wallMat, 0.07);
            if (o.style === "split") box(mid - 0.03, mid + 0.03, at, top, wallMat, 0.07);
          }
        } else if (o.type === "door" && o.style.startsWith("entrance")) {
          // white entrance doors with frosted glass: a strip, small panes, or a side panel
          const w = o.end - o.start;
          const leafEnd = o.style === "entrance_sidelight" ? o.start + w * 0.72 : o.end;
          if (moving) {
            // the leaf and its glass swing together (the side panel stays)
            const leaf = moving(o.start, leafEnd, o.sill, top, whiteLeaf, 0.045, "swing");
            const glassAt = (s0: number, s1: number, z0: number, z1: number) => leaf?.add(s0, s1, z0, z1, frosted, 0.055);
            if (o.style === "entrance_strip") glassAt(o.start + w * 0.3 - 0.06, o.start + w * 0.3 + 0.06, o.sill + 0.3, top - 0.3);
            else if (o.style !== "entrance_sidelight") for (let i = 0; i < 4; i++) glassAt(mid - 0.09, mid + 0.09, o.sill + 1.05 + i * 0.27, o.sill + 1.23 + i * 0.27);
            if (o.style === "entrance_sidelight") box(leafEnd + 0.04, o.end, o.sill + 0.05, top - 0.05, frosted, 0.055);
          } else {
            box(o.start, leafEnd, o.sill, top, whiteLeaf, 0.045);
            const glassPane = (s0: number, s1: number, z0: number, z1: number) => box(s0, s1, z0, z1, frosted, 0.055);
            if (o.style === "entrance_sidelight") glassPane(leafEnd + 0.04, o.end, o.sill + 0.05, top - 0.05);
            else if (o.style === "entrance_strip") glassPane(o.start + w * 0.3 - 0.06, o.start + w * 0.3 + 0.06, o.sill + 0.3, top - 0.3);
            else for (let i = 0; i < 4; i++) glassPane(mid - 0.09, mid + 0.09, o.sill + 1.05 + i * 0.27, o.sill + 1.23 + i * 0.27);
          }
        } else if (o.type === "door") {
          // closed leaves: one, or two meeting in the middle
          if (o.style === "double") {
            pane(o.start, mid - 0.005, o.sill, top, doorLeaf, 0.045, "swing");
            pane(mid + 0.005, o.end, o.sill, top, doorLeaf, 0.045, "swing");
          } else pane(o.start, o.end, o.sill, top, doorLeaf, 0.045, o.style === "sliding" ? "slide" : "swing");
        } else if (o.type === "opening" && o.style === "arch") {
          // the wall fills the corners above a round arch (in steps)
          const r = Math.min((o.end - o.start) / 2, o.height);
          const zc = top - r;
          const steps = 10;
          for (let k = 0; k < steps; k++) {
            const z0 = zc + (r * k) / steps;
            const z1 = zc + (r * (k + 1)) / steps;
            const half = Math.sqrt(Math.max(0, r * r - ((z0 + z1) / 2 - zc) ** 2));
            box(o.start, mid - half, z0, z1, wallMat);
            box(mid + half, o.end, z0, z1, wallMat);
          }
        }
        if (o.type === "garage_door" && (o.cover || o.contact)) this.addGarageDoor(g, w, o, top, garage);
        else if (o.type === "garage_door") box(o.start, o.end, o.sill, top, garage, 0.06);
        if (o.cover && o.type !== "garage_door" && !this.view.lowWalls) this.addCover(g, w, o, cutAt, cuttable);
        cursor = o.end;
      }
      box(cursor, length, 0, H, wallMat);
    }

    // one flight of stairs per storey the stairwell passes through
    for (const v of vertical) if (v.kind === "stairs" && level.index >= v.from && level.index < v.to) g.add(this.stairs(v, level));
    g.add(this.outline(walls));
    return g;
  }

  /**
   * The night look's glow: lines along the foot of every wall, and a soft light rising
   * from the floor up each wall face, one group per level (hidden by day).
   */
  private outline(walls: Wall[]): THREE.Group {
    const pts: number[] = [];
    this.riseTexture ??= riseTexture();
    const glow = new THREE.MeshBasicMaterial({ color: this.accent, map: this.riseTexture, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.building?.add(glow);
    const faces: THREE.Mesh[] = [];
    const seg = (a: Vec2, b: Vec2, y: number) => pts.push(a[0], y, a[1], b[0], y, b[1]);
    for (const w of walls) {
      if (w.type === "open") continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
      const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const t = w.thickness / 2;
      const p = (along: number, side: number): Vec2 => [w.a[0] + u[0] * along + w.normal[0] * t * side, w.a[1] + u[1] * along + w.normal[1] * t * side];
      const [s0, s1] = [-w.extendStart, len + w.extendEnd];
      const y = 0.015;
      seg(p(s0, 1), p(s1, 1), y);
      seg(p(s0, -1), p(s1, -1), y);
      seg(p(s0, 1), p(s0, -1), y);
      seg(p(s1, 1), p(s1, -1), y);
      // the rising light on both faces, a hair in front of them
      for (const side of [1, -1]) {
        const h = Math.min(0.45, w.height);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(s1 - s0, h), glow);
        const c = p((s0 + s1) / 2, side);
        face.position.set(c[0] + w.normal[0] * 0.004 * side, h / 2, c[1] + w.normal[1] * 0.004 * side);
        face.rotation.y = Math.atan2(-u[1], u[0]);
        faces.push(face);
      }
    }
    // a sharp line over a wide faint one: a soft glow
    const lines = new THREE.Group();
    lines.add(...faces);
    for (const [linewidth, opacity] of [[6, 0.22], [1.6, 0.95]]) {
      const geo = new LineSegmentsGeometry().setPositions(pts);
      const material = new LineMaterial({ color: this.accent, linewidth, transparent: true, opacity, depthWrite: false });
      material.resolution.set(this.size.width, this.size.height);
      this.building?.add(material);
      lines.add(new LineSegments2(geo, material));
    }
    lines.visible = this.look === "night" || this.look === "blueprint";
    lines.traverse((o) => (o.userData.outdoor = true)); // not a tap target
    this.outlines.push(lines);
    return lines;
  }

  /**
   * The look: `day` (as lit by the sun) or `night` (dark, lamps and glowing outlines in the
   * accent colour stand out; for wall tablets at night).
   */
  setLook(look: Look, accent = DEFAULT_ACCENT) {
    if (look === this.look && accent === this.accent) return;
    this.look = look;
    this.accent = accent;
    for (const l of this.outlines) {
      l.visible = look === "night" || look === "blueprint";
      for (const part of l.children as (LineSegments2 | THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>)[]) part.material.color.set(accent);
    }
    this.scene.background = look === "blueprint" ? new THREE.Color(BLUEPRINT.background) : null;
    this.applyTheme();
    this.setSun(this.sunAt?.azimuth ?? null, this.sunAt?.elevation ?? null);
  }

  /** Every material in the house in the look's colours (or back in its own). */
  private applyTheme() {
    for (const level of this.levels) for (const m of level.materials) this.themeMaterial(m);
  }

  /**
   * One material in the look: its own colour and texture by day and night; one plain
   * colour for every surface of a white model or a blueprint (glass stays see-through,
   * lit parts keep their glow). A room's daylight (lux) dims its floor on top.
   */
  private themeMaterial(m: THREE.Material) {
    if (!(m instanceof THREE.MeshLambertMaterial)) return;
    let own = this.ownLooks.get(m);
    if (!own) this.ownLooks.set(m, (own = { color: m.color.clone(), map: m.map }));
    const plain = this.look === "white" || this.look === "blueprint";
    const see = m.transparent && ((m.userData.baseOpacity as number | undefined) ?? m.opacity) < 0.9;
    if (!plain) m.color.copy(own.color);
    else if (this.look === "white") m.color.set(see ? "#dfe8ee" : "#f1f0ec");
    else m.color.set(see ? BLUEPRINT.glass : BLUEPRINT.surface);
    const map = plain ? null : own.map;
    if (m.map !== map) {
      m.map = map;
      m.needsUpdate = true;
    }
    const tint = m.userData.tint as string | undefined;
    if (tint) m.color.lerp(new THREE.Color(tint), 0.55);
    const daylight = m.userData.daylight as number | undefined;
    if (daylight !== undefined) m.color.multiplyScalar(0.3 + 0.7 * daylight);
  }

  /** A copy of a material that keeps its own look (for linked pieces' own materials). */
  private copyMaterial(m: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
    const c = m.clone();
    const own = this.ownLooks.get(m);
    if (own) this.ownLooks.set(c, own);
    return c;
  }

  /**
   * A camera: a small body where it hangs, looking its way, and what it sees as a fan of
   * light on the floor (blue; red while its motion sensor is on). A tap shows its picture.
   */
  private camera3d(g: THREE.Group, c: Level["rooms"][number]["cameras"][number]) {
    const a = THREE.MathUtils.degToRad(c.direction);
    const look: Vec2 = [Math.sin(a), -Math.cos(a)];
    const body = new THREE.Group();
    body.position.set(c.at[0], c.height, c.at[1]);
    body.rotation.y = Math.atan2(-look[1], look[0]);
    body.add(this.mesh(new THREE.BoxGeometry(0.14, 0.08, 0.08), this.lambert("#e9ebee")));
    const lens = this.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16).rotateZ(Math.PI / 2), this.lambert("#1d2126"));
    lens.position.x = 0.075;
    body.add(lens);
    body.userData.entity = c.entity;
    body.userData.outdoor = true;
    body.traverse((o) => (o.userData.outdoor = true));
    this.linked.push(body);
    g.add(body);
    // the fan on the floor: the circle's angle 0 is plan +x, counter-clockwise seen from above
    const fov = THREE.MathUtils.degToRad(Math.min(c.fov, 359));
    const centre = Math.PI / 2 - a;
    const material = new THREE.MeshBasicMaterial({ color: COLORS.cameraView, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.building?.add(material);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(c.range, 32, centre - fov / 2, fov).rotateX(-Math.PI / 2), material);
    fan.position.set(c.at[0], 0.025, c.at[1]);
    fan.renderOrder = 2;
    fan.userData.outdoor = true;
    g.add(fan);
    const list = this.cameraViews.get(c.entity) ?? [];
    list.push(material);
    this.cameraViews.set(c.entity, list);
  }

  /** A camera's motion: its view red while something moves. */
  setCameraMotion(entity: string, moving: boolean) {
    for (const m of this.cameraViews.get(entity) ?? []) {
      m.color.set(moving ? COLORS.cameraMotion : COLORS.cameraView);
      m.opacity = moving ? 0.32 : 0.22;
      m.userData.baseOpacity = m.opacity;
    }
  }

  /** For tests: how a camera's view is drawn. */
  cameraState(entity: string) {
    const list = this.cameraViews.get(entity);
    return list ? { views: list.length, color: list[0].color.getHexString() } : null;
  }

  /**
   * A drawn plan's door swing: the leaf's quarter circle on the floor, on the side it
   * opens to (as the editor draws it); sliding doors have none.
   */
  private doorSwing(g: THREE.Group, w: Wall, o: WallOpening, rooms: Level["rooms"]) {
    if (["sliding", "sliding_glass"].includes(o.style) || o.style === "entrance_sidelight") return;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const n: Vec2 = [-u[1], u[0]];
    const at = (t: number): Vec2 => [w.a[0] + u[0] * t, w.a[1] + u[1] * t];
    const room = rooms.find((r) => r.id === o.room);
    const m = at((o.start + o.end) / 2);
    const inward = room && pointInPolygon([m[0] + n[0] * 0.3, m[1] + n[1] * 0.3], room.polygon) ? 1 : -1;
    const swing = o.swing === "out" ? -inward : inward;
    const hingeAtStart = (o.hinge === "right") === (inward > 0);
    const leaves: [number, number][] = o.style === "double" || o.style === "glass_double" ? [[o.start, (o.start + o.end) / 2], [o.end, (o.start + o.end) / 2]] : [hingeAtStart ? [o.start, o.end] : [o.end, o.start]];
    const pts: number[] = [];
    const face = (w.thickness / 2) * swing;
    for (const [h, e] of leaves) {
      const r = Math.abs(e - h);
      const along: Vec2 = [u[0] * Math.sign(e - h), u[1] * Math.sign(e - h)];
      const p = (a: number): Vec2 => {
        const hp = at(h);
        return [hp[0] + n[0] * face + (along[0] * Math.cos(a) + n[0] * swing * Math.sin(a)) * r, hp[1] + n[1] * face + (along[1] * Math.cos(a) + n[1] * swing * Math.sin(a)) * r];
      };
      const hp: Vec2 = [at(h)[0] + n[0] * face, at(h)[1] + n[1] * face];
      // the open leaf, then the arc back to the frame
      const tip = p(Math.PI / 2);
      pts.push(hp[0], 0.03, hp[1], tip[0], 0.03, tip[1]);
      for (let k = 0; k < 12; k++) {
        const [a, b] = [p((k / 12) * (Math.PI / 2)), p(((k + 1) / 12) * (Math.PI / 2))];
        pts.push(a[0], 0.03, a[1], b[0], 0.03, b[1]);
      }
    }
    const material = new LineMaterial({ color: COLORS.planWall, linewidth: 1.2, transparent: true, opacity: 0.8 });
    material.resolution.set(this.size.width, this.size.height);
    this.building?.add(material);
    const line = new LineSegments2(new LineSegmentsGeometry().setPositions(pts), material);
    line.userData.outdoor = true;
    this.planLines.push(line);
    g.add(line);
  }

  /**
   * Draws an opening's moving parts (with a contact): each leaf or pane turns around its
   * hinge (seen from the room, as the plan draws it) into its swing side, a window tilts
   * in at the top, a sliding leaf slides. Returns the function that draws one part; parts
   * of a double door hinge at their own outer ends.
   */
  private opener(g: THREE.Group, w: Wall, o: WallOpening, rooms: Level["rooms"], cutAt: number, cuttable: boolean) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const at = (t: number): Vec2 => [w.a[0] + u[0] * t, w.a[1] + u[1] * t];
    const n: Vec2 = [-u[1], u[0]];
    const room = rooms.find((r) => r.id === o.room);
    const m = at((o.start + o.end) / 2);
    const inward = room && pointInPolygon([m[0] + n[0] * 0.3, m[1] + n[1] * 0.3], room.polygon) ? 1 : -1;
    const swing = o.swing === "out" ? -inward : inward;
    // the hinge end, seen from the room facing the wall: left is the end towards -u × inward
    const hingeAtStart = (o.hinge === "right") === (inward > 0);
    const list = this.leaves.get(o.id) ?? [];
    this.leaves.set(o.id, list);
    return (s0: number, s1: number, z0: number, z1: number, material: THREE.Material, thickness: number, how: LeafHow) => {
      // double doors: each half hinges at its own outer end
      const half = s1 - s0 < (o.end - o.start) * 0.75;
      const fromStart = half ? Math.abs(s0 - o.start) < 0.01 : hingeAtStart;
      const hinge = fromStart ? s0 : s1;
      const pivot = new THREE.Group();
      const face = how === "slide" ? swing * 0.04 : swing * Math.max(0, w.thickness / 2 - thickness / 2);
      const p = at(hinge);
      pivot.position.set(p[0] + n[0] * face, how === "tilt" ? z0 : 0, p[1] + n[1] * face);
      g.add(pivot);
      const leaf: LeafView = {
        pivot,
        how,
        dir: fromStart ? 1 : -1,
        u,
        n,
        swing,
        width: s1 - s0,
        target: 0,
        now: 0,
        add: (a0, a1, b0, b1, mat, t) => {
          const mesh = this.mesh(new THREE.BoxGeometry(a1 - a0, b1 - b0, t), mat);
          // along the leaf from its hinge, up from the floor (or the sill, tilting)
          mesh.position.set(((a0 + a1) / 2 - hinge) * leaf.dir, (b0 + b1) / 2 - (how === "tilt" ? z0 : 0), 0);
          pivot.add(mesh);
          if (cuttable && b1 > cutAt + 1e-3) this.cuttables.push({ mesh, normal: w.normal });
          return mesh;
        },
      };
      leaf.add(s0, s1, z0, z1, material, thickness);
      list.push(leaf);
      this.placeLeaf(leaf);
      return leaf;
    };
  }

  /** Turns, tilts or slides a leaf to how far open it is now (0 closed … 1 open). */
  private placeLeaf(l: LeafView) {
    const k = l.now;
    const along: Vec2 = [l.u[0] * l.dir, l.u[1] * l.dir];
    let v = along;
    if (l.how === "swing") {
      const a = k * THREE.MathUtils.degToRad(80);
      v = [along[0] * Math.cos(a) + l.n[0] * l.swing * Math.sin(a), along[1] * Math.cos(a) + l.n[1] * l.swing * Math.sin(a)];
    }
    // local x along the leaf, as walls are turned
    l.pivot.rotation.set(0, Math.atan2(-v[1], v[0]), 0);
    if (l.how === "tilt") {
      // the top leans to the swing side (local z is the plan's n times dir)
      l.pivot.rotateX(k * THREE.MathUtils.degToRad(12) * l.swing * l.dir);
    }
    const shift = l.how === "slide" ? k * l.width * 0.6 : 0;
    l.pivot.children.forEach((c) => {
      c.userData.base ??= c.position.x;
      c.position.x = (c.userData.base as number) + shift;
    });
  }

  /** Whether a door or window is still moving (the card animates only then). */
  get leavesMoving() {
    for (const list of this.leaves.values()) for (const l of list) if (l.now !== l.target) return true;
    return false;
  }

  /** For tests: how far an opening's leaves are open (0 … 1). */
  leafState(openingId: string) {
    return this.leaves.get(openingId)?.map((l) => ({ how: l.how, open: l.now })) ?? null;
  }

  private moveLeaves(dt: number) {
    for (const list of this.leaves.values())
      for (const l of list) {
        if (l.now === l.target) continue;
        // about 0.6 s from closed to open; the last step lands exactly on it
        const step = dt / 0.6;
        l.now = Math.abs(l.target - l.now) <= step ? l.target : l.now + Math.sign(l.target - l.now) * step;
        this.placeLeaf(l);
      }
  }

  /**
   * A garage door linked to a cover (or only a contact): it rolls up into the lintel as far
   * as the cover is open. It is drawn like a shutter, in the opening itself.
   */
  private addGarageDoor(g: THREE.Group, w: Wall, o: WallOpening, top: number, material: THREE.Material) {
    const strip = this.wallBox(w, o.start, o.end, top - 0.02, top, 0.07, this.lambert(COLORS.stripClosed));
    strip.visible = false;
    g.add(strip);
    // unit height, scaled to the closed part
    const mesh = this.wallBox(w, o.start, o.end, 0, 1, 0.06, material);
    g.add(mesh);
    const view: CoverView = { shutter: { mesh, top, height: top - o.sill }, strip: { mesh: strip, material: strip.material as THREE.MeshLambertMaterial }, normal: w.normal, cuttable: false, closed: 1, byContact: !o.cover };
    this.covers.set(o.id, view);
    this.setCover(o.id, null);
  }

  /** Shutter (with its box) outside the window, plus a status strip for the cut-down wall. */
  private addCover(g: THREE.Group, w: Wall, o: WallOpening, cutAt: number, cuttable: boolean) {
    const outside = w.type === "interior" ? 0 : w.thickness / 2 + SHUTTER_DEPTH / 2 + 0.005;
    const stripMaterial = this.lambert(COLORS.stripClosed);
    const strip = this.wallBox(w, o.start, o.end, cutAt, cutAt + 0.06, w.thickness + 0.02, stripMaterial);
    strip.visible = false;
    g.add(strip);
    let shutter: CoverView["shutter"] = null;
    if (o.sill + o.height > cutAt) {
      const top = o.sill + o.height;
      const housing = this.wallBox(w, o.start - 0.03, o.end + 0.03, top, top + 0.14, SHUTTER_DEPTH + 0.04, this.lambert(COLORS.shutterBox), outside);
      g.add(housing);
      if (cuttable) this.cuttables.push({ mesh: housing, normal: w.normal });
      // unit height, scaled to the closed part
      const mesh = this.wallBox(w, o.start, o.end, 0, 1, SHUTTER_DEPTH, this.lambert(COLORS.shutter), outside);
      mesh.visible = false;
      g.add(mesh);
      shutter = { mesh, top, height: o.height };
    }
    this.covers.set(o.id, { shutter, strip: { mesh: strip, material: stripMaterial }, normal: w.normal, cuttable, closed: 0 });
  }

  /**
   * The six materials of a wall box: its two long faces in their finishes (+z local is
   * the side of the wall's normal or the other), the rest plain.
   */
  private wallFaces(w: Wall, plain: THREE.Material, finishes: [THREE.Material, THREE.Material]): THREE.Material[] {
    const length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ux = (w.b[0] - w.a[0]) / length;
    const uy = (w.b[1] - w.a[1]) / length;
    const plusZIsNormal = -uy * w.normal[0] + ux * w.normal[1] > 0;
    const [pz, nz] = plusZIsNormal ? finishes : [finishes[1], finishes[0]];
    return [plain, plain, plain, plain, pz, nz];
  }

  private wallBox(w: Wall, s: number, e: number, z0: number, z1: number, thickness: number, mat: THREE.Material | THREE.Material[], offset = 0) {
    const dx = w.b[0] - w.a[0];
    const dy = w.b[1] - w.a[1];
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const mid = (s + e) / 2;
    const geo = new THREE.BoxGeometry(e - s, z1 - z0, thickness);
    if (Array.isArray(mat)) {
      // texture coordinates in metres along the wall and up, so patterns run on across pieces
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (const group of geo.groups.slice(4))
        for (let i = 0; i < group.count; i++) {
          const k = geo.index!.getX(group.start + i);
          uv.setXY(k, (pos.getZ(k) > 0 ? 1 : -1) * (mid + pos.getX(k)), (z0 + z1) / 2 + pos.getY(k));
        }
    }
    const m = this.mesh(geo, mat);
    m.position.set(w.a[0] + ux * mid + w.normal[0] * offset, (z0 + z1) / 2, w.a[1] + uy * mid + w.normal[1] * offset);
    m.rotation.y = Math.atan2(-dy, dx);
    return m;
  }

  /**
   * One flight of stairs up to the next level: open wooden treads on dark steel. A
   * u_turn stair has two flights side by side, joined by winders, with a screen of bars
   * between them.
   */
  private stairs(v: Vertical, level: Level): THREE.Group {
    const g = new THREE.Group();
    // local frame: u along the climb, w across the stairwell from the start side
    const { L, W, plan } = stairFrame(v);

    const rise = level.height; // up to the ceiling: the real rise would poke out above the walls
    const n = Math.max(3, Math.round(rise / 0.19));
    const step = rise / n;
    const treads: { poly: Vec2[]; top: number }[] = [];
    const rect = (u0: number, u1: number, w0: number, w1: number): Vec2[] => [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];

    if (v.shape === "u_turn") {
      const fw = W / 2; // flight width
      const S = Math.max(0.5, L - fw); // straight part; the turn takes a square at the far end
      const k = Math.min(6, Math.max(3, Math.round(n / 3))); // winders over 180°
      // the first flight starts `entry` in; the straight steps are shared by length
      const E = Math.min(v.entry, S - 0.25);
      const a = Math.max(1, Math.round(((n - k) * (S - E)) / (2 * S - E)));
      const b = n - k - a;
      for (let i = 0; i < a; i++) treads.push({ poly: rect(E + (i * (S - E)) / a, E + ((i + 1) * (S - E)) / a, 0, fw), top: (i + 1) * step });
      // winders: wedges around the turn's pivot, clipped to the stairwell's far end
      const pivot: Vec2 = [S, W / 2];
      const hit = (deg: number): Vec2 => {
        const r = THREE.MathUtils.degToRad(deg);
        const du = Math.cos(r);
        const dw = Math.sin(r);
        const t = Math.min(du > 1e-6 ? (L - S) / du : Infinity, dw > 1e-6 ? (W - pivot[1]) / dw : dw < -1e-6 ? -pivot[1] / dw : Infinity);
        return [pivot[0] + du * t, pivot[1] + dw * t];
      };
      const corners: [number, Vec2][] = [
        [-Math.atan2(W / 2, L - S) * (180 / Math.PI), [L, 0]],
        [Math.atan2(W / 2, L - S) * (180 / Math.PI), [L, W]],
      ];
      for (let j = 0; j < k; j++) {
        const a0 = -90 + (180 * j) / k;
        const a1 = -90 + (180 * (j + 1)) / k;
        const poly: Vec2[] = [pivot, hit(a0), ...corners.filter(([deg]) => deg > a0 && deg < a1).map(([, p]) => p), hit(a1)];
        treads.push({ poly, top: (a + j + 1) * step });
      }
      for (let m = 0; m < b; m++) treads.push({ poly: rect(S - ((m + 1) * S) / b, S - (m * S) / b, W - fw, W), top: (a + k + m + 1) * step });
    } else {
      const width = W * 0.9;
      const E = Math.min(v.entry, L - 0.5);
      for (let i = 0; i < n; i++) treads.push({ poly: rect(E + (i * (L - E)) / n, E + ((i + 1) * (L - E)) / n, (W - width) / 2, (W + width) / 2), top: (i + 1) * step });
    }

    const wood = this.lambert(COLORS.tread);
    const steel = this.lambert(COLORS.steel);
    for (const t of treads) {
      const poly = t.poly.map(plan);
      const tread = new THREE.ExtrudeGeometry(shapeOf(normalize(poly)), { depth: 0.05, bevelEnabled: false });
      tread.rotateX(-Math.PI / 2);
      tread.translate(0, t.top - 0.05, 0);
      g.add(this.mesh(tread, wood));
      // dark steel carrier under the tread
      const carrier = new THREE.ExtrudeGeometry(shapeOf(normalize(shrink(poly, 0.06))), { depth: 0.04, bevelEnabled: false });
      carrier.rotateX(-Math.PI / 2);
      carrier.translate(0, t.top - 0.09, 0);
      g.add(this.mesh(carrier, steel));
    }
    if (v.shape === "u_turn") {
      // screen of vertical bars between the two flights
      const S = Math.max(0.5, L - W / 2);
      for (let u = 0.06; u < S; u += 0.11) {
        const [x, y] = plan([u, W / 2]);
        const bar = this.mesh(new THREE.BoxGeometry(0.03, rise, 0.03), steel);
        bar.position.set(x, rise / 2, y);
        g.add(bar);
      }
    }
    return g;
  }

  // ----- live state -----

  /** Lights a room's floor in the light's colour; `null` switches it off. */
  /** A room's floor tinted by a reading (heatmap), or null for its own colour. */
  setRoomTint(levelId: string, roomId: string, color: string | null) {
    const m = this.floors.get(`${levelId}/${roomId}`)?.material;
    if (!m) return;
    if (color) m.userData.tint = color;
    else delete m.userData.tint;
    this.themeMaterial(m);
  }

  /**
   * How much daylight a room gets (0 dark … 1 bright, from its lux sensor), or null to
   * follow the sun alone: its floor dims, its lights still glow.
   */
  setRoomDaylight(levelId: string, roomId: string, k: number | null) {
    const m = this.floors.get(`${levelId}/${roomId}`)?.material;
    if (!m) return;
    if (k === null) delete m.userData.daylight;
    else m.userData.daylight = k;
    this.themeMaterial(m);
  }

  setRoomLight(levelId: string, roomId: string, light: LightLook | null) {
    const m = this.floors.get(`${levelId}/${roomId}`)?.material;
    if (!m) return;
    if (!light) m.emissive.setRGB(0, 0, 0);
    else {
      const k = 0.18 + 0.32 * light.brightness;
      m.emissive.setRGB((light.rgb[0] / 255) * k, (light.rgb[1] / 255) * k, (light.rgb[2] / 255) * k, THREE.SRGBColorSpace);
    }
  }

  /**
   * An awning on the house wall along the room's side that lies on the level outline,
   * reaching across the room. Built fully extended; setAwning scales it.
   */
  private awning(g: THREE.Group, level: Level, room: Level["rooms"][number]) {
    const outline = level.outline;
    const onOutline = (p: Vec2) =>
      outline.some((a, i) => {
        const b = outline[(i + 1) % outline.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
        const dist = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len;
        return dist < 0.02 && t > -0.02 && t < len + 0.02;
      });
    const poly = room.polygon;
    let best: [Vec2, Vec2] | null = null;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if (onOutline(a) && onOutline(b) && (!best || Math.hypot(b[0] - a[0], b[1] - a[1]) > Math.hypot(best[1][0] - best[0][0], best[1][1] - best[0][1]))) best = [a, b];
    });
    if (!best) return;
    const [a, b] = best as [Vec2, Vec2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // into the room: the polygon is positively oriented, so its inside is to the left
    const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const c = centroid(poly);
    let n: Vec2 = [-dir[1], dir[0]];
    if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const reach = Math.min(3.5, Math.max(...poly.map((p) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1])));
    const drop = 0.35;
    const depth = Math.hypot(reach, drop);
    const geo = new THREE.BoxGeometry(len, 0.03, depth);
    geo.translate(0, 0, depth / 2); // pivot on the wall
    const mesh = this.mesh(geo, this.lambert(COLORS.awning, { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    mesh.position.set(mid[0], level.height - 0.25, mid[1]);
    // local z → n in the plan (world x/z), tilted down by the drop
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = Math.atan2(n[0], n[1]);
    mesh.rotation.x = Math.atan2(drop, reach);
    mesh.userData.outdoor = true;
    this.awnings.set(`${level.id}/${room.id}`, mesh);
    g.add(mesh);
  }

  /**
   * Places the lamps (replacing the previous ones): a soft pool of light on the floor
   * under each, shown while the light is on.
   */
  setLamps(lamps: LampPlace[]) {
    for (const o of this.lampObjects) {
      o.removeFromParent();
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    this.lampObjects = [];
    this.lamps.clear();
    this.lampPlaces.clear();
    this.glowTexture ??= glowTexture();
    this.fadeTexture ??= fadeTexture();
    for (const lamp of lamps) {
      const i = this.levelIds.indexOf(lamp.levelId);
      const level = this.levels[i];
      if (!level) continue;
      const height = this.levelHeights[i] ?? 2.6;
      // each part glows in the light's colour times k while it is on
      const glow = (geometry: THREE.BufferGeometry, k: number, map = this.glowTexture!, side: THREE.Side = THREE.FrontSide) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side }));
        mesh.visible = false;
        mesh.renderOrder = 2;
        mesh.userData.outdoor = true; // not a tap target for rooms
        mesh.userData.k = k;
        level.group.add(mesh);
        level.materials.add(mesh.material);
        this.lampObjects.push(mesh);
        const list = this.lamps.get(lamp.entity) ?? [];
        list.push(mesh);
        this.lamps.set(lamp.entity, list);
        return mesh;
      };
      const places: Vec2[] = [];
      const type = lamp.type ?? "lamp";
      if (type === "spot") {
        // a downlight: a soft cone from the ceiling and a bright spot under it
        for (const at of [lamp.at, ...(lamp.spots ?? [])]) {
          glow(new THREE.CircleGeometry(0.6, 32).rotateX(-Math.PI / 2), 1.25).position.set(at[0], 0.02, at[1]);
          const cone = glow(new THREE.CylinderGeometry(0.03, 0.45, height - 0.05, 24, 1, true), 0.35, this.fadeTexture!, THREE.DoubleSide);
          cone.position.set(at[0], (height - 0.05) / 2, at[1]);
          places.push(at);
        }
      } else if (type === "strip" && lamp.to) {
        // an LED strip: the strip itself, and a long pool of light under it
        const [a, b] = [lamp.at, lamp.to];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const turn = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
        const y = lamp.height ?? height - 0.06;
        const bar = glow(new THREE.BoxGeometry(len, 0.02, 0.03), 2.2, this.whiteTexture());
        bar.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
        bar.rotation.y = turn;
        const pool = glow(new THREE.PlaneGeometry(len + 1.2, 1.4).rotateX(-Math.PI / 2), 0.9);
        pool.position.set((a[0] + b[0]) / 2, 0.02, (a[1] + b[1]) / 2);
        pool.rotation.y = turn;
        places.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      } else if (type === "indirect" && lamp.outline?.length) {
        // light washing the walls from the ceiling down, all round the room
        const poly = lamp.outline;
        const band = Math.min(1.1, height * 0.45);
        poly.forEach((p, k) => {
          const q = poly[(k + 1) % poly.length];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 0.05) return;
          const wash = glow(new THREE.PlaneGeometry(len, band), 0.8, this.fadeTexture!, THREE.DoubleSide);
          // a hair inside the wall face
          const inward = 0.01;
          const nx = -(q[1] - p[1]) / len;
          const ny = (q[0] - p[0]) / len;
          const centre: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const side = pointInPolygon([centre[0] + nx * 0.05, centre[1] + ny * 0.05], poly) ? 1 : -1;
          wash.position.set(centre[0] + nx * inward * side, height - band / 2 - 0.02, centre[1] + ny * inward * side);
          wash.rotation.y = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
        });
        glow(new THREE.CircleGeometry(1.6, 32).rotateX(-Math.PI / 2), 0.45).position.set(lamp.at[0], 0.02, lamp.at[1]);
        places.push(lamp.at);
      } else {
        glow(new THREE.CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), 1).position.set(lamp.at[0], 0.02, lamp.at[1]);
        places.push(lamp.at);
      }
      this.applyLevel(level);
      const list = this.lampPlaces.get(lamp.entity) ?? [];
      list.push(...places.map((at) => ({ level: i, at, high: type === "spot" || type === "indirect" })));
      this.lampPlaces.set(lamp.entity, list);
    }
  }

  /** A finish: its texture and colour, or at low quality only its colour (nothing downloaded). */
  private finish(id: string): { map: THREE.Texture | null; color: string } {
    if (this.quality !== "low") return finishLook(id);
    return { map: null, color: FINISHES_BY_ID[id]?.color ?? (id.startsWith("polyhaven:") ? "#bdb6aa" : finishLook(id).color) };
  }

  /** A plain white texture (parts glowing evenly in the light's colour). */
  private whiteTexture() {
    if (!this.white) {
      const c = document.createElement("canvas");
      c.width = c.height = 2;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 2, 2);
      this.white = new THREE.CanvasTexture(c);
    }
    return this.white;
  }

  /**
   * A piece linked to a light: its glowing parts get their own materials (in the level's
   * fade, not its hover tint, which also uses the glow) and follow the light.
   */
  private linkGlow(entity: string, piece: THREE.Object3D, materials: Set<THREE.Material>) {
    const own = new Map<THREE.Material, THREE.MeshLambertMaterial>();
    piece.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const swap = (m: THREE.Material) => {
        if (!m.userData.glow) return m;
        let c = own.get(m);
        if (!c) {
          own.set(m, (c = this.copyMaterial(m as THREE.MeshLambertMaterial)));
          materials.add(c);
        }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    if (!own.size) return;
    const list = this.pieceGlows.get(entity) ?? [];
    list.push(...own.values());
    this.pieceGlows.set(entity, list);
    if (this.lampLooks.has(entity)) this.setLamp(entity, this.lampLooks.get(entity)!);
  }

  /**
   * A piece linked to another device: its screens, flames, status lights and glowing parts
   * get their own materials (in the level's fade), its fans and drums turn, its curtains
   * follow the cover.
   */
  private linkDevice(entity: string, piece: THREE.Object3D, materials: Set<THREE.Material>) {
    const parts: DeviceParts = { materials: [], spinners: [], curtains: [] };
    const own = new Map<THREE.Material, THREE.MeshLambertMaterial>();
    piece.traverse((o) => {
      if (o.userData.spin) parts.spinners.push(o);
      if (o.userData.curtain) parts.curtains.push(o);
      if (!(o instanceof THREE.Mesh)) return;
      const swap = (m: THREE.Material) => {
        if (!m.userData.part && !m.userData.glow) return m;
        let c = own.get(m);
        if (!c) {
          own.set(m, (c = this.copyMaterial(m as THREE.MeshLambertMaterial)));
          c.userData.lit = c.emissive.clone();
          c.userData.litIntensity = c.emissiveIntensity;
          materials.add(c);
          parts.materials.push(c);
        }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    if (!parts.materials.length && !parts.spinners.length && !parts.curtains.length) return;
    const list = this.devices.get(entity) ?? [];
    list.push(parts);
    this.devices.set(entity, list);
    if (this.deviceLooks.has(entity)) this.setDevice(entity, this.deviceLooks.get(entity)!);
  }

  /**
   * A linked device's state: screens light up while it is on, flames burn, status lights
   * show running (in the heating or cooling colour), fans and drums turn while it runs,
   * curtains open as far as their cover. null: unknown, drawn as when not linked.
   */
  setDevice(entity: string, look: DeviceLook | null) {
    this.deviceLooks.set(entity, look);
    for (const parts of this.devices.get(entity) ?? []) {
      for (const m of parts.materials) {
        const lit = m.userData.lit as THREE.Color;
        const role = (m.userData.part as string | undefined) ?? "glow";
        m.visible = true;
        if (!look) {
          m.emissive.copy(lit);
          m.emissiveIntensity = m.userData.litIntensity as number;
        } else if (role === "fire") {
          m.visible = look.on;
        } else if (role === "screen") {
          // a soft picture light; brighter while playing
          m.emissive.set(look.active ? "#6f8fc4" : "#3c4f6e");
          m.emissiveIntensity = look.on ? (look.active ? 0.75 : 0.45) : 0;
        } else if (role === "led") {
          m.emissive.set(look.tone === "alarm" ? "#ff2a1f" : look.tone === "heat" ? "#ff8a3a" : look.tone === "cool" ? "#3fa8ff" : look.active ? "#3fd27a" : "#9fd6b0");
          m.emissiveIntensity = look.on ? (look.active ? (look.tone === "alarm" ? 1.4 : 0.9) : 0.3) : 0;
        } else {
          m.emissive.copy(lit);
          m.emissiveIntensity = look.on ? Math.max(0.5, m.userData.litIntensity as number) : 0;
        }
      }
      for (const c of parts.curtains) {
        // open: drawn back to the sides; closed: each panel to the middle
        const open = look?.open ?? 1;
        c.scale.x = 1 + (1 - open) * ((c.userData.curtain as number) - 1);
      }
    }
  }

  /** Whether a linked fan, drum or pump is turning (the card animates only then). */
  get spinning() {
    for (const [entity, list] of this.devices) {
      const look = this.deviceLooks.get(entity);
      if (look?.active && list.some((p) => p.spinners.length)) return true;
    }
    return false;
  }

  /** For tests: a linked device's parts as drawn. */
  deviceState(entity: string) {
    const list = this.devices.get(entity);
    if (!list) return null;
    const parts = list.flatMap((p) => p.materials);
    return {
      lit: parts.some((m) => m.visible && m.emissiveIntensity > 0.2),
      hidden: parts.some((m) => !m.visible),
      turn: list.flatMap((p) => p.spinners).map((o) => o.rotation.y + o.rotation.z),
      curtains: list.flatMap((p) => p.curtains).map((o) => o.scale.x),
    };
  }

  private spin(now: number) {
    // after a pause (nothing moved, no frames) start again with one frame's step; slow
    // devices still move in real time
    const gap = (now - this.lastSpin) / 1000;
    const dt = gap > 0.5 ? 1 / 30 : gap;
    this.lastSpin = now;
    if (!dt) return;
    this.moveLeaves(dt);
    for (const [entity, list] of this.devices) {
      const look = this.deviceLooks.get(entity);
      if (!look?.active) continue;
      // about one turn a second, faster with a fan's speed
      const speed = Math.PI * 2 * (0.5 + (look.speed ?? 0.5));
      for (const p of list) for (const o of p.spinners) o.rotation[o.userData.spin as "y" | "z"] += speed * dt;
    }
  }

  /** A lamp's light: colour and brightness, or null when off. */
  setLamp(entity: string, light: LightLook | null) {
    this.lampLooks.set(entity, light);
    // the piece itself: bulbs and shades lit in the light's colour, dull when off
    for (const m of this.pieceGlows.get(entity) ?? []) {
      if (light) {
        m.emissive.setRGB(light.rgb[0] / 255, light.rgb[1] / 255, light.rgb[2] / 255, THREE.SRGBColorSpace);
        m.emissiveIntensity = 0.25 + 0.75 * light.brightness;
      } else {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      }
    }
    for (const glow of this.lamps.get(entity) ?? []) {
      if (!light) {
        glow.visible = false;
        continue;
      }
      const c = new THREE.Color().setRGB(light.rgb[0] / 255, light.rgb[1] / 255, light.rgb[2] / 255, THREE.SRGBColorSpace);
      // by day the room's real light does most of it: the pool on the floor stays soft
      glow.material.color.copy(c).multiplyScalar((0.35 + 0.65 * light.brightness) * (0.4 + 0.6 * this.night) * ((glow.userData.k as number | undefined) ?? 1));
      glow.visible = true;
    }
  }

  /** A gable roof on top of the level: a prism over its outline's bounds, with overhang. */
  private buildRoof(level: Level, roof: RoofShape): THREE.Group {
    const g = new THREE.Group();
    const { min, max } = bbox(level.outline);
    const o = roof.overhang;
    const t = Math.tan((roof.pitch * Math.PI) / 180);
    const eastWest = roof.ridge === "east_west";
    // profile across the ridge (u) and up (v); extruded along the ridge
    const [u0, u1] = eastWest ? [min[1], max[1]] : [min[0], max[0]];
    const [r0, r1] = eastWest ? [min[0], max[0]] : [min[1], max[1]];
    const half = (u1 - u0) / 2;
    const shape = new THREE.Shape([new THREE.Vector2(-o, -o * t), new THREE.Vector2(2 * half + o, -o * t), new THREE.Vector2(half, half * t)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: r1 - r0 + 2 * o, bevelEnabled: false });
    const base = level.height;
    const m = new THREE.Matrix4();
    // shape x → across, shape y → up, extrusion z → along the ridge
    if (eastWest) m.set(0, 0, 1, r0 - o, 0, 1, 0, base, 1, 0, 0, u0, 0, 0, 0, 1);
    else m.set(1, 0, 0, u0, 0, 1, 0, base, 0, 0, 1, r0 - o, 0, 0, 0, 1);
    geo.applyMatrix4(m);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.roof, side: THREE.DoubleSide });
    this.levels[this.levels.length - 1]?.materials.add(mat);
    g.add(this.mesh(geo, mat));
    g.userData.outdoor = true;
    g.traverse((x) => (x.userData.outdoor = true));
    return g;
  }

  // ----- energy overlay -----

  /**
   * The energy overlay: a marker for each item, solar panels on the roof, and a line from
   * each item to the one it is connected to, for its flow.
   */
  setEnergy(items: EnergyItem[]) {
    for (const o of this.energyObjects) {
      o.removeFromParent();
      o.traverse((x) => {
        if (x instanceof THREE.Mesh || x instanceof THREE.Line || x instanceof THREE.Points) {
          x.geometry.dispose();
          (x.material as THREE.Material).dispose();
        }
      });
    }
    this.energyObjects = [];
    this.energyPoints.clear();
    this.flows = [];
    for (const item of items) {
      const color = ENERGY_COLORS[item.kind] ?? ENERGY_COLORS.device;
      if (item.kind === "solar") {
        const panels = this.solarPanels(item.roof);
        if (!panels) continue;
        this.energyObjects.push(panels.group);
        this.energyPoints.set(item.key, { levelIndex: this.levels.length - 1, local: panels.centre, onRoof: true, field: panels.field });
      } else if (item.levelIndex !== null && item.at && this.levels[item.levelIndex]) {
        const level = this.levels[item.levelIndex];
        const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 20), new THREE.MeshLambertMaterial({ color }));
        marker.position.set(item.at[0], 0.25, item.at[1]);
        marker.userData.outdoor = true;
        level.group.add(marker);
        level.materials.add(marker.material);
        this.applyLevel(level);
        this.energyObjects.push(marker);
        this.energyPoints.set(item.key, { levelIndex: item.levelIndex, local: new THREE.Vector3(item.at[0], 0.5, item.at[1]) });
      }
    }
    // a line and moving dots from each item to the one it is connected to, drawn over the house
    // lines that leave their floor get their own lane along the walls, side by side
    let lane = 0;
    for (const item of items) {
      if (!item.to || !this.energyPoints.has(item.key) || !this.energyPoints.has(item.to)) continue;
      const route = this.route(this.energyPoints.get(item.key)!, this.energyPoints.get(item.to)!, lane);
      if (route.length > 2) lane++;
      const color = new THREE.Color(ENERGY_COLORS[item.kind] ?? ENERGY_COLORS.device);
      // a light cable, and coloured pulses with a soft glow running along it
      const geometry = new LineGeometry();
      geometry.setPositions(new Array(route.length * 3).fill(0));
      const cable = new LineMaterial({ color: 0xd9dde2, linewidth: 3.5, transparent: true, opacity: 0.85, depthWrite: false });
      const pulse = new LineMaterial({ color, linewidth: 4.5, dashed: true, dashSize: 0.45, gapSize: 1.35, transparent: true, depthWrite: false });
      const glow = new LineMaterial({ color, linewidth: 11, dashed: true, dashSize: 0.45, gapSize: 1.35, transparent: true, opacity: 0.28, depthWrite: false });
      for (const m of [cable, pulse, glow]) m.resolution.set(this.size.width, this.size.height);
      const line = new Line2(geometry, cable);
      const dots = new THREE.Group();
      dots.add(new Line2(geometry, glow), new Line2(geometry, pulse));
      line.renderOrder = 10;
      dots.children.forEach((c, i) => (c.renderOrder = 11 + i));
      this.root.add(line, dots);
      this.energyObjects.push(line, dots);
      this.flows.push({ key: item.key, to: item.to, route, line, dots, pulse, glow, geometry, placed: "", watts: 0 });
    }
  }

  /**
   * How a flow line runs: in the same room straight across; otherwise along the outside
   * of the walls to the house corner nearest the far end, up or down that corner (the
   * roof's eave for solar), and along the walls again. `lane` keeps lines apart.
   */
  private route(from: EnergyPoint, to: EnergyPoint, lane: number): RoutePoint[] {
    // a line towards the roof is the reverse of one from it
    if (to.onRoof && !from.onRoof) return this.route(to, from, lane).reverse();
    const start = { levelIndex: from.levelIndex, local: from.local.clone() };
    const end = { levelIndex: to.levelIndex, local: to.local.clone() };
    const plan = (p: { local: THREE.Vector3 }): Vec2 => [p.local.x, p.local.z];
    const sameFloor = !from.onRoof && !to.onRoof && from.levelIndex === to.levelIndex;
    // in the same room: straight across
    if (sameFloor && (this.levelRooms[from.levelIndex] ?? []).some((poly) => pointInPolygon(plan(from), poly) && pointInPolygon(plan(to), poly))) return [start, end];
    const base = to.onRoof ? from : to;
    const outline = this.levelOutlines[base.levelIndex];
    if (!outline?.length) return [start, end];
    const outer = offsetPolygon(outline, 0.25 + 0.12 * lane);
    const at = (levelIndex: number, [x, z]: Vec2, y: number): RoutePoint => ({ levelIndex, local: new THREE.Vector3(x, y, z) });
    // the same floor, different rooms: out to the wall, along the outside, and back in
    if (sameFloor) return [start, ...perimeterPath(outer, plan(from), plan(to)).map((q) => at(from.levelIndex, q, from.local.y)), end];
    // a corner on the side the overview camera looks from (azimuth: where it stands)
    const az = (this.view.azimuth * Math.PI) / 180;
    const corner = nearestCorner(outer, plan(base), [Math.sin(az), -Math.cos(az)]);
    const points: RoutePoint[] = [start];
    if (from.onRoof && from.field) {
      // from the field's lower corner nearest the house corner: down the roof, along the eave
      const f = from.field;
      const rc = f.rOf(corner);
      const r = Math.abs(f.ends[0] - rc) < Math.abs(f.ends[1] - rc) ? f.ends[0] : f.ends[1];
      const eave = f.at(rc, 0);
      points.splice(0, 1, { levelIndex: from.levelIndex, local: f.at(r, 0.1) }, { levelIndex: from.levelIndex, local: f.at(r, 0) }, { levelIndex: from.levelIndex, local: eave });
      points.push(at(from.levelIndex, corner, eave.y));
    } else if (from.onRoof) points.push(at(from.levelIndex, corner, this.levelHeights[from.levelIndex]));
    // leave along the walls to the corner
    else points.push(...perimeterPath(outer, plan(from), corner).map((q) => at(from.levelIndex, q, from.local.y)));
    // arrive the same way round
    if (to.onRoof) points.push(at(to.levelIndex, corner, this.levelHeights[to.levelIndex]));
    else points.push(...perimeterPath(outer, corner, plan(to)).map((q) => at(to.levelIndex, q, to.local.y)));
    points.push(end);
    return points;
  }

  /**
   * Robot vacuums and mowers: a dock at its place, and the robot with a ring in its
   * status colour (moved by setRobotState).
   */
  setRobots(items: { key: string; kind: "vacuum" | "lawn_mower"; levelIndex: number; dock: Vec2 }[]) {
    for (const o of this.robotObjects) {
      o.removeFromParent();
      o.traverse((x) => x instanceof THREE.Mesh && x.geometry.dispose());
    }
    this.robotObjects = [];
    this.robots.clear();
    for (const item of items) {
      const level = this.levels[item.levelIndex];
      if (!level) continue;
      const mat = (color: string) => {
        const m = new THREE.MeshLambertMaterial({ color });
        level.materials.add(m);
        return m;
      };
      const mower = item.kind === "lawn_mower";
      // the dock: a small station (vacuum) or a platform (mower)
      const dock = this.mesh(mower ? new THREE.BoxGeometry(0.6, 0.06, 0.55) : new THREE.BoxGeometry(0.32, 0.12, 0.1), mat("#e4e4e2"));
      dock.position.set(item.dock[0], mower ? 0.03 : 0.06, item.dock[1] + (mower ? 0 : -0.2));
      // the robot
      const body = new THREE.Group();
      if (mower) {
        const shell = this.mesh(new THREE.BoxGeometry(0.42, 0.18, 0.58), mat("#3f4a42"));
        shell.position.y = 0.17;
        const top = this.mesh(new THREE.BoxGeometry(0.34, 0.06, 0.4), mat("#e07a2f"));
        top.position.y = 0.29;
        body.add(shell, top);
        for (const [x, z] of [[-0.23, -0.18], [0.23, -0.18], [-0.23, 0.2], [0.23, 0.2]]) {
          const wheel = this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), mat("#222"));
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.1, z);
          body.add(wheel);
        }
      } else {
        const disc = this.mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 32), mat("#2f3337"));
        disc.position.y = 0.055;
        const cap = this.mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 32), mat("#7b8188"));
        cap.position.y = 0.105;
        const lidar = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 20), mat("#d8dadc"));
        lidar.position.set(0, 0.125, -0.07);
        body.add(disc, cap, lidar);
      }
      const ringMaterial = new THREE.MeshBasicMaterial({ color: "#9e9e9e", transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      level.materials.add(ringMaterial);
      const r = mower ? 0.42 : 0.24;
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.06, 40), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      body.add(ring);
      body.position.set(item.dock[0], 0, item.dock[1]);
      for (const o of [dock, body]) {
        o.traverse((x) => (x.userData.outdoor = true)); // taps go to the room underneath
        level.group.add(o);
        this.robotObjects.push(o);
      }
      this.robots.set(item.key, { levelIndex: item.levelIndex, body, ring: ringMaterial });
      this.applyLevel(level);
    }
  }

  /** Where a robot is (null: unknown, hidden) and its status colour. */
  /** Where a robot is and its status colour; `unsure`: its last known spot, faded. */
  setRobotState(key: string, at: Vec2 | null, color: string, unsure = false) {
    const r = this.robots.get(key);
    if (!r) return;
    r.body.visible = !!at;
    if (at) r.body.position.set(at[0], 0, at[1]);
    r.ring.color.set(color);
    r.body.userData.unsure = unsure;
    r.body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of [o.material].flat() as THREE.Material[]) {
        // the level's fade multiplies this base opacity; keep the part's own
        const own = (m.userData.ownOpacity ??= m.userData.baseOpacity ?? m.opacity) as number;
        const ownTransparent = (m.userData.ownTransparent ??= m.userData.baseTransparent ?? m.transparent) as boolean;
        m.userData.baseOpacity = own * (unsure ? 0.4 : 1);
        m.userData.baseTransparent = unsure || ownTransparent;
      }
    });
    const level = this.levels[r.levelIndex];
    if (level) this.applyLevel(level);
  }

  /** Screen position of a robot, or null when it isn't shown. */
  projectRobot(key: string): { x: number; y: number } | null {
    const r = this.robots.get(key);
    if (!r || !r.body.visible || !this.pointVisible({ levelIndex: r.levelIndex })) return null;
    const v = this.levels[r.levelIndex].group.localToWorld(r.body.position.clone().setY(0.3)).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.width, y: ((1 - v.y) / 2) * this.size.height };
  }

  /** For tests: where each robot is drawn. */
  robotState() {
    return [...this.robots.entries()].map(([key, r]) => ({ key, visible: r.body.visible, at: [r.body.position.x, r.body.position.z], color: `#${r.ring.color.getHexString()}`, unsure: !!r.body.userData.unsure }));
  }

  /** Power per item (W towards what it is connected to); flows below a few watts stand still. */
  setFlows(watts: Record<string, number | null>) {
    for (const f of this.flows) f.watts = watts[f.key] ?? 0;
  }

  /** Whether anything is flowing (the card animates only then). */
  get flowing() {
    return this.flows.some((f) => Math.abs(f.watts) >= MIN_FLOW_WATTS);
  }

  /** For tests: the energy overlay's state. */
  energyState() {
    return { items: this.energyPoints.size, flows: this.flows.map((f) => ({ key: f.key, to: f.to, watts: f.watts, visible: f.line.visible, dots: f.dots.visible })) };
  }

  /** Moves the flow lines with their levels and the dots along them. */
  private updateFlows(now: number) {
    for (const f of this.flows) {
      const hub = this.energyPoints.get(f.to);
      const from = this.energyPoints.get(f.key);
      const shown = !!hub && !!from && this.pointVisible(from) && this.pointVisible(hub);
      f.line.visible = shown;
      f.dots.visible = shown && Math.abs(f.watts) >= MIN_FLOW_WATTS;
      if (!shown || !hub || !from) continue;
      // the route follows its levels as they lift and fade (rebuilt only when it moved)
      const world = f.route.flatMap((p) => this.levels[p.levelIndex].group.localToWorld(p.local.clone()).toArray());
      const placed = world.map((v) => v.toFixed(3)).join(",");
      if (placed !== f.placed) {
        f.placed = placed;
        f.geometry.setPositions(world);
        f.line.computeLineDistances();
      }
      if (!f.dots.visible) continue;
      // pulses run towards `to` when positive; faster with more power
      const speed = Math.min(4, 0.6 + Math.abs(f.watts) / 800); // m/s
      const offset = (((now / 1000) * speed) % 1.8) * (f.watts > 0 ? -1 : 1);
      f.pulse.dashOffset = f.glow.dashOffset = offset;
    }
  }

  private pointVisible(p: { levelIndex: number; onRoof?: boolean }) {
    const l = this.levels[p.levelIndex];
    if (!l || !l.group.visible || l.opacity * l.hoverOpacity < 0.5) return false;
    // solar panels show with the roof only (the overview)
    return !p.onRoof || !!this.roof?.visible;
  }

  /** Solar panels on one side of the roof: dark panels in rows, with a light frame. */
  private solarPanels(side: string): { group: THREE.Group; centre: THREE.Vector3; field: SolarField } | null {
    const info = this.roofInfo;
    if (!info || !this.roof) return null;
    const { level, shape } = info;
    const { min, max } = bbox(level.outline);
    const o = shape.overhang;
    const t = Math.tan((shape.pitch * Math.PI) / 180);
    const eastWest = shape.ridge === "east_west";
    const sides = eastWest ? ["south", "north"] : ["west", "east"];
    const s = sides.includes(side) ? side : sides[0];
    const [u0, u1] = eastWest ? [min[1], max[1]] : [min[0], max[0]];
    const [r0, r1] = eastWest ? [min[0], max[0]] : [min[1], max[1]];
    const half = (u1 - u0) / 2;
    const base = level.height;
    // eave and ridge across the slope (u) and their heights
    const far = s === "south" || s === "east";
    const eaveU = far ? u1 + o : u0 - o;
    const ridgeU = u0 + half;
    const eaveH = base - o * t;
    const ridgeH = base + half * t;
    const plan = (r: number, u: number): [number, number] => (eastWest ? [r, u] : [u, r]);
    const point = (r: number, k: number) => {
      // k: 0 at the eave, 1 at the ridge; slightly above the tiles
      const u = eaveU + (ridgeU - eaveU) * k;
      const h = eaveH + (ridgeH - eaveH) * k + 0.06;
      const [x, y] = plan(r, u);
      return new THREE.Vector3(x, h, y);
    };
    const group = new THREE.Group();
    group.visible = this.roof.visible;
    const panel = new THREE.MeshLambertMaterial({ color: COLORS.panel, side: THREE.DoubleSide });
    this.levels[this.levels.length - 1].materials.add(panel);
    const along = r1 - r0;
    const cols = Math.max(1, Math.floor((along - 0.6) / 1.05));
    const rows = 3;
    const r = (i: number) => r0 + (along - cols * 1.05) / 2 + i * 1.05;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const k0 = 0.12 + (row * 0.78) / rows;
        const k1 = k0 + 0.78 / rows - 0.03;
        const quad = [point(r(col), k0), point(r(col) + 1, k0), point(r(col) + 1, k1), point(r(col), k1)];
        const geo = new THREE.BufferGeometry().setFromPoints([quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]);
        geo.computeVertexNormals();
        group.add(this.mesh(geo, panel, false));
        const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(quad), new THREE.LineBasicMaterial({ color: COLORS.panelFrame }));
        group.add(outline);
      }
    group.userData.outdoor = true;
    group.traverse((x) => (x.userData.outdoor = true));
    // the panels show and hide with the roof
    this.roof.add(group);
    return {
      group,
      centre: point(r0 + along / 2, 0.5),
      field: {
        ends: [r(0), r(cols - 1) + 1],
        at: (rr: number, k: number) => point(Math.max(r0 - o, Math.min(r1 + o, rr)), k),
        rOf: ([x, y]: Vec2) => (eastWest ? x : y),
      },
    };
  }

  /**
   * A piece of furniture from a few boxes: centred on its spot, its back to the north
   * before turning (clockwise, seen from above).
   */
  private furniture(f: Level["rooms"][number]["furniture"][number], ceiling: number): THREE.Group {
    // one material per colour and level (they fade with the level)
    const m = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
      const key = `${color}${extra.opacity ?? ""}`;
      let mat = this.furnitureMaterials.get(key);
      if (!mat) {
        mat = this.lambert(color, extra);
        this.furnitureMaterials.set(key, mat);
      }
      return mat;
    };
    const g = simplePiece(f, m, (geometry, material) => this.mesh(geometry, material));
    // wall pieces hang at their height; ceiling pieces hang from the ceiling of their level
    g.position.set(f.at[0], f.elevation ?? Math.max(0, ceiling - f.height), f.at[1]);
    g.rotation.y = -(f.rotation * Math.PI) / 180;
    // mirrored in its own frame, before turning
    if (f.mirror) g.scale.x = -1;
    g.traverse((o) => (o.userData.outdoor = true)); // not a tap target for rooms: taps go to the room
    if (f.entity) {
      g.userData.entity = f.entity;
      this.linked.push(g);
    }
    if (this.view.furniture === "detailed" && detailFor(f)) this.detail(g, f);
    return g;
  }

  /** Swaps a piece's simple shapes for the detailed model once it has loaded. */
  private detail(g: THREE.Group, f: Level["rooms"][number]["furniture"][number]) {
    const generation = this.generation;
    const materials = this.building!;
    const converted = this.modelMaterials;
    const convert = (source: THREE.Material) => {
      let m = converted.get(source);
      if (!m) {
        const s = source as THREE.MeshStandardMaterial;
        m = new THREE.MeshLambertMaterial({ color: modelColor(source), map: s.map ?? null, transparent: s.transparent, opacity: s.opacity, side: s.side, emissive: s.emissive ?? 0x000000, emissiveIntensity: s.emissiveIntensity ?? 1 });
        if (source.userData.glow) m.userData.glow = true;
        if (source.userData.part) m.userData.part = source.userData.part;
        converted.set(source, m);
        materials.add(m);
        this.themeMaterial(m);
        // join the level's fading and hover tint as they are now
        const level = this.levels.find((l) => l.materials === materials);
        if (level) {
          level.tintable.push(m);
          m.emissive.copy(level.tintable[0].emissive);
        }
      }
      return m;
    };
    const how = detailFor(f)!;
    // built-in pieces are drawn in code (their module loads with the first one)
    const done = Promise.all(["kind" in how ? import("./modern") : null, "file" in how ? loadModel(how.file) : null]).then(([mod, model]) => {
      if (generation !== this.generation) return;
      let piece: THREE.Group | null = null;
      if (mod && "kind" in how) {
        piece = mod.buildModern(how.kind, f.size, f.height, f.finish, f.accent);
        piece?.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
        });
      } else if (model) piece = fitModel(model, f.size, f.height, convert);
      if (!piece) return; // keep the simple shapes
      for (const child of [...g.children]) {
        g.remove(child);
        child.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      }
      piece.traverse((o) => (o.userData.outdoor = true));
      piece.userData.detailed = true;
      if (f.entity?.startsWith("light.")) this.linkGlow(f.entity, piece, materials);
      else if (f.entity) this.linkDevice(f.entity, piece, materials);
      g.add(piece);
      const level = this.levels.find((l) => l.materials === materials);
      if (level) this.applyLevel(level);
      this.onChange?.();
    });
    this.pendingModels.push(done);
  }

  /** Resolves when every detailed piece asked for so far has loaded (or failed). */
  async modelsReady() {
    await Promise.all(this.pendingModels);
  }

  /** The house as a three.js object (for exporting it). */
  get object(): THREE.Object3D {
    return this.root;
  }

  /** For tests: whether the roof is drawn. */
  roofVisible() {
    return !!this.roof?.visible;
  }

  /** For tests: whether a lamp is drawn lit. */
  lampState(entity: string) {
    const l = this.lamps.get(entity);
    return l ? { count: l.length, on: l.some((x) => x.visible) } : null;
  }

  /** Awning position: 1 fully extended, 0 retracted, null unknown (drawn retracted). */
  setAwning(levelId: string, roomId: string, open: number | null) {
    const m = this.awnings.get(`${levelId}/${roomId}`);
    if (!m) return;
    const k = Math.min(1, Math.max(0, open ?? 0));
    m.visible = k > 0.01;
    m.scale.z = Math.max(0.001, k);
  }

  /** For tests: how far an awning is drawn extended (0..1), or null without one. */
  awningState(levelId: string, roomId: string) {
    const m = this.awnings.get(`${levelId}/${roomId}`);
    return m ? (m.visible ? m.scale.z : 0) : null;
  }

  /** Cover position for an opening: 1 fully open, 0 closed, null unknown. */
  setCover(openingId: string, open: number | null) {
    const c = this.covers.get(openingId);
    if (!c) return;
    c.strip.material.color.copy(new THREE.Color(COLORS.stripClosed).lerp(new THREE.Color(COLORS.stripOpen), open ?? 0));
    // unknown: a shutter is drawn open, a garage door closed
    c.closed = open === null ? (c.byContact !== undefined ? 1 : 0) : Math.min(1, Math.max(0, 1 - open));
    if (c.shutter) {
      c.shutter.mesh.scale.y = Math.max(0.001, c.closed * c.shutter.height);
      c.shutter.mesh.position.y = c.shutter.top - (c.closed * c.shutter.height) / 2;
    }
    this.applyCuts();
  }

  /** For tests and debugging: how a cover is currently drawn. */
  coverState(openingId: string) {
    const c = this.covers.get(openingId);
    if (!c) return null;
    return {
      shutterVisible: !!c.shutter?.mesh.visible,
      shutterHeight: c.shutter ? c.closed * c.shutter.height : 0,
      stripVisible: c.strip.mesh.visible,
      stripColor: c.strip.material.color.getHexString(),
    };
  }

  /** Window contact: open windows get orange glass. */
  setContact(openingId: string, open: boolean) {
    this.glasses.get(openingId)?.color.set(open ? COLORS.glassOpen : COLORS.glass);
    if (this.covers.get(openingId)?.byContact) this.setCover(openingId, open ? 1 : 0);
    for (const l of this.leaves.get(openingId) ?? []) {
      l.target = open ? 1 : 0;
      // the first state after drawing is shown at once, not animated
      if (!l.shown) {
        l.now = l.target;
        l.shown = true;
        this.placeLeaf(l);
      }
    }
  }

  /** Hides the upper parts of outer walls facing a low camera; shows strips instead of shutters there. */
  private applyCuts() {
    const az = THREE.MathUtils.degToRad(this.orientation.azimuth);
    const toCamera: Vec2 = [Math.sin(az), -Math.cos(az)];
    const cutting = this.orientation.elevation < this.view.cutBelow;
    const facing = (n: Vec2) => cutting && n[0] * toCamera[0] + n[1] * toCamera[1] > 0.2;
    for (const c of this.cuttables) c.mesh.visible = !facing(c.normal);
    for (const c of this.covers.values()) {
      const cut = c.cuttable && facing(c.normal);
      c.strip.mesh.visible = cut || !c.shutter;
      if (c.shutter) c.shutter.mesh.visible = !cut && c.closed > 0.01;
    }
  }

  /**
   * The entity of a linked piece under a canvas position (CSS px), if it is in front of
   * the floor there.
   */
  pickEntity(x: number, y: number): string | null {
    const ndc = new THREE.Vector2((x / this.size.width) * 2 - 1, -(y / this.size.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const visible = (o: THREE.Object3D) => {
      const level = this.levels.find((l) => l.group === o.parent);
      return !!level && level.group.visible && level.opacity > 0.5;
    };
    const pieces = this.linked.filter(visible);
    if (!pieces.length) return null;
    const hit = ray.intersectObjects([...pieces, ...[...this.floors.values()].filter(visible)], true).find((h) => h.object.visible)?.object;
    let o: THREE.Object3D | null = hit ?? null;
    while (o && !o.userData.entity && !o.userData.room) o = o.parent;
    return (o?.userData.entity as string | undefined) ?? null;
  }

  /** Room under a canvas position (CSS px), as `level/room`. */
  pick(x: number, y: number): string | null {
    const ndc = new THREE.Vector2((x / this.size.width) * 2 - 1, -(y / this.size.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const candidates = [...this.floors.values()].filter((f) => {
      const level = this.levels.find((l) => l.group === f.parent);
      return level && level.group.visible && level.opacity > 0.5;
    });
    const hit = ray.intersectObjects(candidates, false)[0];
    return (hit?.object.userData.room as string | undefined) ?? null;
  }

  // ----- focus on a level -----

  /**
   * Shows the house up to `index` (null: everything). Levels above lift away and fade,
   * and the camera moves to the focused level's camera. Resolves when the transition ends.
   */
  setFocus(index: number | null, animate = true): Promise<void> {
    this.focus = index;
    const from = {
      camera: { ...this.orientation },
      zoom: this.zoom,
      box: this.box.clone(),
      levels: this.levels.map((l) => ({ opacity: l.opacity, lift: l.lift })),
    };
    const to = {
      camera: this.cameraFor(index),
      box: this.boxFor(index),
      // one floor on its own: the floors above rise away, the floors below sink away
      levels: this.levels.map((_, i) =>
        index === null || i === index ? { opacity: 1, lift: 0 } : i > index ? { opacity: 0, lift: this.view.explode * 1.5 + 1 } : { opacity: 0, lift: -(this.view.explode + 1.5) },
      ),
    };
    // turn the short way round
    if (to.camera.azimuth - from.camera.azimuth > 180) from.camera.azimuth += 360;
    if (from.camera.azimuth - to.camera.azimuth > 180) from.camera.azimuth -= 360;
    cancelAnimationFrame(this.animation);
    const apply = (t: number) => {
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const mix = (a: number, b: number) => (t >= 1 ? b : a + (b - a) * e);
      this.orientation = {
        azimuth: mix(from.camera.azimuth, to.camera.azimuth),
        elevation: mix(from.camera.elevation, to.camera.elevation),
        fov: mix(from.camera.fov, to.camera.fov),
      };
      this.zoom = mix(from.zoom, 1);
      this.box.min.lerpVectors(from.box.min, to.box.min, e);
      this.box.max.lerpVectors(from.box.max, to.box.max, e);
      this.levels.forEach((l, i) => {
        l.opacity = mix(from.levels[i].opacity, to.levels[i].opacity);
        l.lift = mix(from.levels[i].lift, to.levels[i].lift);
        this.applyLevel(l);
      });
    };
    if (!animate || matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      apply(1);
      this.draw();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / FOCUS_MS);
        apply(t);
        this.draw();
        if (t < 1) this.animation = requestAnimationFrame(frame);
        else resolve();
      };
      this.animation = requestAnimationFrame(frame);
    });
  }

  get focusedIndex() {
    return this.focus;
  }

  isLevelVisible(levelId: string) {
    const l = this.levels[this.levelIds.indexOf(levelId)];
    return !!l && l.group.visible && l.opacity > 0.5;
  }

  private applyLevel(l: LevelState) {
    l.group.position.y = l.baseY + l.lift + l.hoverLift;
    // the roof belongs to the overview only
    if (this.roof && l === this.levels[this.levels.length - 1]) this.roof.visible = this.focus === null && this.hover === null;
    const opacity = l.opacity * l.hoverOpacity;
    l.group.visible = opacity > 0.01;
    const fading = opacity < 0.999;
    for (const m of l.materials) {
      const base = (m.userData.baseOpacity ??= m.opacity) as number;
      const baseTransparent = (m.userData.baseTransparent ??= m.transparent) as boolean;
      const baseDepthWrite = (m.userData.baseDepthWrite ??= m.depthWrite) as boolean;
      // three.js compiles opaque materials with alpha forced to 1: switching needs a rebuild
      if (m.transparent !== (fading || baseTransparent)) {
        m.transparent = fading || baseTransparent;
        m.needsUpdate = true;
      }
      m.opacity = base * opacity;
      m.depthWrite = !fading && baseDepthWrite;
    }
  }

  // ----- hover -----

  /**
   * Level under a canvas position (CSS px), or null. While a level is hovered it stays
   * hovered as long as the pointer is anywhere over it, even behind faded levels above,
   * so the highlight doesn't flicker.
   */
  levelAt(x: number, y: number): number | null {
    const ndc = new THREE.Vector2((x / this.size.width) * 2 - 1, -(y / this.size.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const groups = this.levels.filter((l) => l.group.visible && l.opacity > 0.5).map((l) => l.group);
    const hits = ray.intersectObjects(groups, true).filter((h) => h.object.visible && !h.object.userData.outdoor);
    const levelOf = (o: THREE.Object3D | null): number => {
      while (o && !groups.includes(o as THREE.Group)) o = o.parent;
      return o ? this.levels.findIndex((l) => l.group === o) : -1;
    };
    if (this.hover !== null && hits.some((h) => levelOf(h.object) === this.hover)) return this.hover;
    const first = hits.length ? levelOf(hits[0].object) : -1;
    return first >= 0 ? first : null;
  }

  get hoveredIndex() {
    return this.hover;
  }

  /** Highlights a level and fades the levels above it; null clears. Resolves when done. */
  setHover(index: number | null): Promise<void> {
    if (index === this.hover) return Promise.resolve();
    this.hover = index;
    this.levels.forEach((l, i) => {
      for (const m of l.tintable) m.emissive.copy(i === index ? HOVER_TINT : new THREE.Color(0));
    });
    const from = this.levels.map((l) => ({ opacity: l.hoverOpacity, lift: l.hoverLift }));
    const to = this.levels.map((_, i) => (index !== null && i > index ? { opacity: HOVER_FADE, lift: this.view.explode * 0.6 + 0.8 } : { opacity: 1, lift: 0 }));
    cancelAnimationFrame(this.hoverAnimation);
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / HOVER_MS);
        const e = 1 - (1 - t) ** 3;
        this.levels.forEach((l, i) => {
          l.hoverOpacity = t >= 1 ? to[i].opacity : from[i].opacity + (to[i].opacity - from[i].opacity) * e;
          l.hoverLift = t >= 1 ? to[i].lift : from[i].lift + (to[i].lift - from[i].lift) * e;
          this.applyLevel(l);
        });
        this.draw();
        if (t < 1) this.hoverAnimation = requestAnimationFrame(frame);
        else resolve();
      };
      this.hoverAnimation = requestAnimationFrame(frame);
    });
  }

  // ----- interactive camera -----

  /** Turns the camera by the given degrees (dashboard drag) and redraws. */
  orbit(dAzimuth: number, dElevation: number) {
    const o = this.orientation;
    this.orientation = {
      ...o,
      azimuth: (((o.azimuth + dAzimuth) % 360) + 360) % 360,
      elevation: Math.min(90, Math.max(5, o.elevation + dElevation)),
    };
    this.draw();
  }

  zoomBy(factor: number) {
    this.zoom = Math.min(4, Math.max(0.5, this.zoom * factor));
    this.draw();
  }

  /** Animates back to the configured camera of the current focus. */
  resetView(): Promise<void> {
    return this.setFocus(this.focus);
  }

  /** Turns the camera to an angle over a moment (view buttons); the zoom stays. */
  turnTo(azimuth: number, elevation: number): Promise<void> {
    const from = { ...this.orientation };
    let to = ((azimuth % 360) + 360) % 360;
    // the short way round
    if (to - from.azimuth > 180) to -= 360;
    if (from.azimuth - to > 180) to += 360;
    cancelAnimationFrame(this.turnFrame);
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 450);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        this.orientation = { ...from, azimuth: (((from.azimuth + (to - from.azimuth) * e) % 360) + 360) % 360, elevation: from.elevation + (elevation - from.elevation) * e };
        this.draw();
        if (t < 1) this.turnFrame = requestAnimationFrame(step);
        else resolve();
      };
      this.turnFrame = requestAnimationFrame(step);
    });
  }

  /**
   * Makes the current angle the start view of what is shown (the whole house, or the
   * focused floor), as reset and the next visit use it. Returns it, for the card to keep.
   */
  keepView(): { azimuth: number; elevation: number } {
    const o = { azimuth: Math.round(this.orientation.azimuth), elevation: Math.round(this.orientation.elevation) };
    if (this.focus === null) this.view = { ...this.view, ...o };
    else this.view = { ...this.view, levels: { ...this.view.levels, [this.levelIds[this.focus]]: { ...this.view.levels[this.levelIds[this.focus]], ...o } } };
    return o;
  }

  // ----- camera -----

  /** Overview camera for null, else the focus camera of that level. */
  private cameraFor(index: number | null): CameraState {
    const o: Orientation =
      index === null
        ? { azimuth: this.view.azimuth, elevation: this.view.elevation, projection: this.view.projection }
        : { ...this.view.focus, ...this.view.levels[this.levelIds[index]] };
    return { azimuth: o.azimuth, elevation: o.elevation, fov: FOV[o.projection ?? "perspective"] ?? FOV.perspective };
  }

  /** Camera axes for an orientation: towards the camera, screen right and screen up. */
  private axes(c: CameraState) {
    const az = THREE.MathUtils.degToRad(c.azimuth);
    const el = THREE.MathUtils.degToRad(Math.min(89.9, Math.max(-89.9, c.elevation)));
    const toCamera = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    // looking (almost) straight down, "up" on screen is the direction away from the camera
    const worldUp = c.elevation > 85 ? new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)) : new THREE.Vector3(0, 1, 0);
    const forward = toCamera.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    return { toCamera, right, up };
  }

  private corners(box: THREE.Box3) {
    const out: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }

  /** Width / height of a box seen (without perspective) from an orientation. */
  private extent(c: CameraState, box: THREE.Box3) {
    const { right, up } = this.axes(c);
    const xs = this.corners(box).map((p) => p.dot(right));
    const ys = this.corners(box).map((p) => p.dot(up));
    return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys) || 1);
  }

  /** Places the camera so the framed box fills the canvas. */
  private fitCamera() {
    const c = this.orientation;
    const { toCamera, right, up } = this.axes(c);
    const center = this.box.getCenter(new THREE.Vector3());
    const pts = this.corners(this.box).map((p) => p.sub(center));
    const xs = pts.map((p) => p.dot(right));
    const ys = pts.map((p) => p.dot(up));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const target = center.clone().addScaledVector(right, cx).addScaledVector(up, cy);
    const margin = 1.04;
    const tanV = Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) / margin;
    const tanH = tanV * (this.size.width / this.size.height);
    let distance = 0;
    pts.forEach((p, i) => {
      const depth = p.dot(toCamera);
      distance = Math.max(distance, depth + Math.abs(xs[i] - cx) / tanH, depth + Math.abs(ys[i] - cy) / tanV);
    });
    distance /= this.zoom;
    const radius = this.box.getSize(new THREE.Vector3()).length() / 2;
    this.camera.fov = c.fov;
    this.camera.aspect = this.size.width / this.size.height;
    this.camera.near = Math.max(0.05, distance - radius * 2);
    this.camera.far = distance + radius * 2;
    this.camera.position.copy(target).addScaledVector(toCamera, distance);
    this.camera.up.copy(up);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /**
   * Light from the real sun: azimuth (degrees from the plan's north, clockwise) and
   * elevation; null goes back to the default light. Below the horizon it is night: dim.
   */
  setSun(azimuth: number | null, elevation: number | null) {
    this.sunAt = azimuth === null || elevation === null ? null : { azimuth, elevation };
    // the night look is night whatever the sun does (it still sets the shadows' direction)
    const e = this.look === "night" || this.look === "blueprint" ? -10 : this.look === "white" ? Math.max(35, this.sunAt?.elevation ?? 45) : (this.sunAt?.elevation ?? 45);
    // day: full light, a little warmer and weaker when the sun is low; night: dim and cool
    const day = Math.max(0, Math.min(1, (e + 4) / 14));
    this.sun.intensity = 2.2 * day;
    this.sun.color.set(e < 15 && day > 0 ? 0xffe2c0 : 0xffffff);
    this.sky.intensity = 0.55 + 0.85 * day;
    this.sky.color.set(day > 0.5 ? 0xffffff : 0xb8c4ff);
    this.ambient.intensity = 0.2 + 0.15 * day;
    if (this.look === "night" || this.look === "blueprint") {
      // darker than a plain night, a little blue, so lamps and outlines carry the picture
      // (a blueprint a little lighter: its surfaces are already dark blue)
      this.sky.intensity = this.look === "blueprint" ? 0.6 : 0.32;
      this.sky.color.set(0x8f9cff);
      this.ambient.intensity = this.look === "blueprint" ? 0.2 : 0.1;
    }
    this.night = 1 - day;
    this.placeSun();
  }

  /** For tests: the light. */
  sunState() {
    return { at: this.sunAt, intensity: this.sun.intensity, position: this.sun.position.clone().sub(this.sun.target.position).normalize().toArray() };
  }

  private placeSun() {
    const box = new THREE.Box3().setFromObject(this.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    // the real sun (not lower than 12° for the shadows' sake), else from the south-west, high
    let dir = new THREE.Vector3(-0.5, 1.2, 0.8);
    if (this.sunAt) {
      const a = THREE.MathUtils.degToRad(this.sunAt.azimuth);
      const el = THREE.MathUtils.degToRad(Math.max(12, this.sunAt.elevation));
      dir = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)).multiplyScalar(1.45);
    }
    this.sun.position.copy(center).add(dir.multiplyScalar(size));
    this.sun.target.position.copy(center);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -size / 2;
    s.right = s.top = size / 2;
    s.near = 0.1;
    s.far = size * 3;
    s.updateProjectionMatrix();
  }

  /**
   * World box of the whole house (index null) or of one level, levels at rest. A focused
   * level is framed on its rooms; outdoor areas may run off the edge.
   */
  private boxFor(index: number | null): THREE.Box3 {
    const box = new THREE.Box3();
    this.levels.forEach((l, i) => {
      if (index !== null && i !== index) return;
      const y = l.group.position.y;
      l.group.position.y = l.baseY;
      l.group.updateMatrixWorld(true);
      if (index === null) box.expandByObject(l.group);
      else for (const child of l.group.children) if (this.view.plan || !child.userData.outdoor) box.expandByObject(child);
      l.group.position.y = y;
      l.group.updateMatrixWorld(true);
    });
    return box;
  }

  // ----- drawing -----

  /** Screen position (CSS px from the canvas' top left) of a plan point on a level. */
  project(levelId: string, [x, y]: Vec2, h = 0): { x: number; y: number } | null {
    const l = this.levels[this.levelIds.indexOf(levelId)];
    if (!l) return null;
    const v = new THREE.Vector3(x + l.group.position.x, l.group.position.y + h, y + l.group.position.z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.width, y: ((1 - v.y) / 2) * this.size.height };
  }

  /** Where the house is on screen (CSS px): the framed box's corners, projected. */
  screenBounds(): { left: number; right: number; top: number; bottom: number } {
    const b = this.box;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) {
          const v = new THREE.Vector3(x, y, z).project(this.camera);
          const sx = ((v.x + 1) / 2) * this.size.width;
          const sy = ((1 - v.y) / 2) * this.size.height;
          left = Math.min(left, sx);
          right = Math.max(right, sx);
          top = Math.min(top, sy);
          bottom = Math.max(bottom, sy);
        }
    return { left, right, top, bottom };
  }

  /** Screen position of an energy item, or null when it isn't shown. */
  projectEnergy(key: string): { x: number; y: number } | null {
    const p = this.energyPoints.get(key);
    if (!p || !this.pointVisible(p)) return null;
    const v = this.levels[p.levelIndex].group.localToWorld(p.local.clone()).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.width, y: ((1 - v.y) / 2) * this.size.height };
  }

  /** Sets the canvas size (CSS px) and draws a frame. */
  render(width: number, height: number) {
    this.renderer.setPixelRatio(this.quality === "low" ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.size = { width, height };
    // wide lines are sized in pixels
    for (const f of this.flows) for (const m of [f.line.material, f.pulse, f.glow]) m.resolution.set(width, height);
    for (const l of this.outlines) for (const part of l.children) if (part instanceof LineSegments2) part.material.resolution.set(width, height);
    for (const line of this.planLines) line.material.resolution.set(width, height);
    this.draw();
  }

  /**
   * Gives the pool's lights to the lamps that are on: the brightest, on levels in view
   * (the focused one first), placed under the ceiling where each lamp is.
   */
  private placeLights() {
    const candidates: { score: number; pos: THREE.Vector3; look: LightLook; share: number }[] = [];
    for (const [entity, places] of this.lampPlaces) {
      const look = this.lampLooks.get(entity);
      if (!look) continue;
      for (const p of places) {
        const level = this.levels[p.level];
        if (!level?.group.visible || level.opacity < 0.5) continue;
        const pos = level.group.localToWorld(new THREE.Vector3(p.at[0], (this.levelHeights[p.level] ?? 2.6) * (p.high ? 0.92 : 0.78), p.at[1]));
        // a row of spots shares its light's brightness
        candidates.push({ score: look.brightness + (this.focus === p.level ? 2 : 0), pos, look, share: 1 / Math.sqrt(places.length) });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    this.lightPool.forEach((light, i) => {
      const c = candidates[i];
      if (!c) {
        light.intensity = 0;
        return;
      }
      light.position.copy(c.pos);
      light.color.setRGB(c.look.rgb[0] / 255, c.look.rgb[1] / 255, c.look.rgb[2] / 255, THREE.SRGBColorSpace);
      // stronger at night, when it is what lights the room
      light.intensity = (2.5 + 7 * this.night) * (0.3 + 0.7 * c.look.brightness) * c.share;
    });
  }

  /** Draws a frame at the current size and camera. */
  draw(now = performance.now()) {
    this.fitCamera();
    this.placeLights();
    if (this.flows.length) this.updateFlows(now);
    if (this.devices.size || this.leaves.size) this.spin(now);
    this.applyCuts();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stopFinishes();
    this.clear();
    this.renderer.dispose();
  }
}

/** Counter-clockwise copy, as three.js shapes expect consistent winding. */
function normalize(poly: Vec2[]): Vec2[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    area += x0 * y1 - x1 * y0;
  }
  return area < 0 ? [...poly].reverse() : poly;
}

/** Moves every point towards the centroid by `by` metres (rough inset for carriers). */
function shrink(poly: Vec2[], by: number): Vec2[] {
  const [cx, cy] = centroid(poly);
  return poly.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const l = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, l - by) / l;
    return [cx + dx * k, cy + dy * k] as Vec2;
  });
}

function centroid(poly: Vec2[]): Vec2 {
  const s = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Vec2, [0, 0] as Vec2);
  return [s[0] / poly.length, s[1] / poly.length];
}
