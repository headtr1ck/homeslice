// Builds a three.js scene from the expanded model and renders it on demand. Plan (x, y)
// maps to world (x, z) with y up, so south is +z. Nothing renders continuously: frames
// are drawn on request, and during short transitions (focusing a floor) only until the
// transition ends.

import * as THREE from "three";
import { simplePiece } from "./simple";
import { buildPiece, loadModel, modelColor, modelFiles, partsFor } from "./models";
import { nearestCorner, offsetPolygon, perimeterPath } from "../model/route";
import { floorTexture } from "./textures";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { House, Level, Vec2, Vertical } from "../model/types";
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
  /** A floor plan: no shadows (they read as dirt from above), gardens framed with the floor. */
  plan: boolean;
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

const FLOOR_COLORS: Record<string, string> = {
  wood: "#b07c49",
  tile: "#a7acb1",
  concrete: "#8d8f92",
  carpet: "#9a8f84",
  lawn: "#5f8f4c",
  paving: "#9b9285",
  gravel: "#a39b8f",
};
const COLORS = {
  wall: "#eeeae3",
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
const FOCUS_MS = 450;
const HOVER_MS = 160;
/** Opacity of the levels above a hovered level. */
const HOVER_FADE = 0.18;
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

function holesFor(level: Level, vertical: Vertical[]): Vec2[][] {
  // a stairwell cuts the floors it leads up to, not the one it starts on
  return vertical.filter((v) => level.index > v.from && level.index <= v.to).map(stairHole);
}

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
  private lampObjects: THREE.Object3D[] = [];
  private glowTexture?: THREE.Texture;
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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(this.root);
    this.scene.add(this.sky, this.ambient);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
  }

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
    for (const level of house.levels) {
      const materials = new Set<THREE.Material>();
      this.building = materials;
      const group = this.buildLevel(level, walls.get(level.id) ?? [], house.vertical);
      this.building = null;
      const baseY = level.elevation + level.index * this.view.explode;
      group.position.y = baseY;
      this.root.add(group);
      const floorMaterials = new Set(level.rooms.map((r) => this.floors.get(`${level.id}/${r.id}`)?.material));
      const tintable = [...materials].filter((m): m is THREE.MeshLambertMaterial => m instanceof THREE.MeshLambertMaterial && !floorMaterials.has(m));
      this.levels.push({ group, baseY, materials, tintable, opacity: 1, lift: 0, hoverOpacity: 1 });
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
    this.sun.castShadow = !this.view.plan;
    this.focus = null;
    this.hover = null;
    this.orientation = this.cameraFor(null);
    this.box = this.boxFor(null);
    this.aspect = this.extent(this.orientation, this.box);
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

  private mesh<M extends THREE.Material>(geometry: THREE.BufferGeometry, material: M, shadows = true) {
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
      const color = FLOOR_COLORS[room.floor] ?? FLOOR_COLORS.wood;
      // outdoor areas reach over the floors below in the exploded view: keep them see-through
      const map = floorTexture(room.floor);
      const material = room.kind === "outdoor" ? this.lambert(color, { map, transparent: true, opacity: 0.55, depthWrite: false }) : this.lambert(color, { map });
      const floor = this.mesh(geo, material, false);
      floor.userData.room = `${level.id}/${room.id}`;
      floor.userData.outdoor = room.kind === "outdoor";
      this.floors.set(`${level.id}/${room.id}`, floor);
      g.add(floor);
    }

    for (const room of level.rooms) for (const f of room.furniture) g.add(this.furniture(f, level.height));

    for (const room of level.rooms) if (room.awning && (room.kind !== "outdoor" || this.view.showOutdoor)) this.awning(g, level, room);

    // walls, split around openings
    const wallMat = this.lambert(COLORS.wall);
    const glass = this.lambert(COLORS.glass, { transparent: true, opacity: 0.45 });
    const garage = this.lambert(COLORS.garageDoor);
    const doorLeaf = this.lambert(COLORS.door);
    const whiteLeaf = this.lambert(COLORS.entranceDoor);
    const frosted = this.lambert(COLORS.frosted, { transparent: true, opacity: 0.85 });
    for (const w of walls) {
      if (w.type === "open") continue; // rooms open to each other: no wall
      // outer walls are split at the cut height; the upper part hides while it faces a low camera
      const cuttable = w.type !== "interior";
      const cutAt = Math.min(this.view.cutHeight, w.height);
      const H = w.height;
      const box = (s: number, e: number, z0: number, z1: number, mat: THREE.Material, thickness = w.thickness) => {
        if (e - s < 1e-3 || z1 - z0 < 1e-3) return;
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
        box(o.start, o.end, 0, o.sill, wallMat);
        box(o.start, o.end, o.sill + o.height, H, wallMat);
        const top = o.sill + o.height;
        const mid = (o.start + o.end) / 2;
        // a bar in the middle (double windows, sliding doors)
        const bar = () => box(mid - 0.03, mid + 0.03, o.sill, top, wallMat, 0.07);
        // windows, and glass doors (sliding and terrace doors)
        if (o.type === "window" || (o.type === "door" && ["sliding_glass", "glass", "glass_double"].includes(o.style))) {
          const mat = o.contact ? this.lambert(COLORS.glass, { transparent: true, opacity: 0.45 }) : glass;
          if (o.contact) this.glasses.set(o.id, mat);
          box(o.start, o.end, o.sill, top, mat, 0.03);
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
          box(o.start, leafEnd, o.sill, top, whiteLeaf, 0.045);
          const pane = (s0: number, s1: number, z0: number, z1: number) => box(s0, s1, z0, z1, frosted, 0.055);
          if (o.style === "entrance_sidelight") pane(leafEnd + 0.04, o.end, o.sill + 0.05, top - 0.05);
          else if (o.style === "entrance_strip") pane(o.start + w * 0.3 - 0.06, o.start + w * 0.3 + 0.06, o.sill + 0.3, top - 0.3);
          else for (let i = 0; i < 4; i++) pane(mid - 0.09, mid + 0.09, o.sill + 1.05 + i * 0.27, o.sill + 1.23 + i * 0.27);
        } else if (o.type === "door") {
          // closed leaves: one, or two meeting in the middle
          if (o.style === "double") {
            box(o.start, mid - 0.005, o.sill, top, doorLeaf, 0.045);
            box(mid + 0.005, o.end, o.sill, top, doorLeaf, 0.045);
          } else box(o.start, o.end, o.sill, top, doorLeaf, 0.045);
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
        if (o.type === "garage_door") box(o.start, o.end, o.sill, top, garage, 0.06);
        if (o.cover) this.addCover(g, w, o, cutAt, cuttable);
        cursor = o.end;
      }
      box(cursor, length, 0, H, wallMat);
    }

    // one flight of stairs per storey the stairwell passes through
    for (const v of vertical) if (v.kind === "stairs" && level.index >= v.from && level.index < v.to) g.add(this.stairs(v, level));
    return g;
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

  private wallBox(w: Wall, s: number, e: number, z0: number, z1: number, thickness: number, mat: THREE.Material, offset = 0) {
    const dx = w.b[0] - w.a[0];
    const dy = w.b[1] - w.a[1];
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const mid = (s + e) / 2;
    const m = this.mesh(new THREE.BoxGeometry(e - s, z1 - z0, thickness), mat);
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
  setLamps(lamps: { levelId: string; entity: string; at: Vec2 }[]) {
    for (const o of this.lampObjects) {
      o.removeFromParent();
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    this.lampObjects = [];
    this.lamps.clear();
    this.glowTexture ??= glowTexture();
    for (const lamp of lamps) {
      const i = this.levelIds.indexOf(lamp.levelId);
      const level = this.levels[i];
      if (!level) continue;
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: this.glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      glow.position.set(lamp.at[0], 0.02, lamp.at[1]);
      glow.visible = false;
      glow.renderOrder = 2;
      glow.userData.outdoor = true; // not a tap target for rooms
      level.group.add(glow);
      level.materials.add(glow.material);
      this.lampObjects.push(glow);
      this.applyLevel(level);
      const list = this.lamps.get(lamp.entity) ?? [];
      list.push(glow);
      this.lamps.set(lamp.entity, list);
    }
  }

  /** A lamp's light: colour and brightness, or null when off. */
  setLamp(entity: string, light: LightLook | null) {
    for (const glow of this.lamps.get(entity) ?? []) {
      if (!light) {
        glow.visible = false;
        continue;
      }
      const c = new THREE.Color().setRGB(light.rgb[0] / 255, light.rgb[1] / 255, light.rgb[2] / 255, THREE.SRGBColorSpace);
      glow.material.color.copy(c).multiplyScalar(0.35 + 0.65 * light.brightness);
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
  setRobotState(key: string, at: Vec2 | null, color: string) {
    const r = this.robots.get(key);
    if (!r) return;
    r.body.visible = !!at;
    if (at) r.body.position.set(at[0], 0, at[1]);
    r.ring.color.set(color);
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
    return [...this.robots.entries()].map(([key, r]) => ({ key, visible: r.body.visible, at: [r.body.position.x, r.body.position.z], color: `#${r.ring.color.getHexString()}` }));
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
    g.traverse((o) => (o.userData.outdoor = true)); // not a tap target: taps go to the room
    if (this.view.furniture === "detailed" && (partsFor(f.type, f.mount, f.model) || f.model?.startsWith("modern:"))) this.detail(g, f);
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
        converted.set(source, m);
        materials.add(m);
        // join the level's fading and hover tint as they are now
        const level = this.levels.find((l) => l.materials === materials);
        if (level) {
          level.tintable.push(m);
          m.emissive.copy(level.tintable[0].emissive);
        }
      }
      return m;
    };
    const files = modelFiles(f.type, f.mount, f.model);
    // Modern pieces are drawn in code (their module loads with the first one)
    const modern = f.model?.startsWith("modern:") ? import("./modern") : null;
    const done = Promise.all([modern, ...files.map(async (file) => [file, await loadModel(file)] as const)]).then(([mod, ...loaded]) => {
      if (generation !== this.generation) return;
      let piece: THREE.Group | null;
      if (mod) {
        piece = mod.buildModern(f.model!.slice(7), f.size, f.height, f.finish, f.accent);
        piece?.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
        });
      } else piece = buildPiece(f.type, f.mount, f.size, f.height, new Map(loaded as [string, THREE.Object3D | null][]), convert, f.model);
      if (!piece) return; // keep the simple shapes
      for (const child of [...g.children]) {
        g.remove(child);
        child.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      }
      piece.traverse((o) => (o.userData.outdoor = true));
      piece.userData.detailed = true;
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
    c.closed = open === null ? 0 : Math.min(1, Math.max(0, 1 - open));
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
      levels: this.levels.map((_, i) => (index !== null && i > index ? { opacity: 0, lift: this.view.explode * 1.5 } : { opacity: 1, lift: 0 })),
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
    l.group.position.y = l.baseY + l.lift;
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
    const from = this.levels.map((l) => l.hoverOpacity);
    const to = this.levels.map((_, i) => (index !== null && i > index ? HOVER_FADE : 1));
    cancelAnimationFrame(this.hoverAnimation);
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / HOVER_MS);
        this.levels.forEach((l, i) => {
          l.hoverOpacity = from[i] + (to[i] - from[i]) * t;
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
    const e = this.sunAt?.elevation ?? 45;
    // day: full light, a little warmer and weaker when the sun is low; night: dim and cool
    const day = Math.max(0, Math.min(1, (e + 4) / 14));
    this.sun.intensity = 2.2 * day;
    this.sun.color.set(e < 15 && day > 0 ? 0xffe2c0 : 0xffffff);
    this.sky.intensity = 0.55 + 0.85 * day;
    this.sky.color.set(day > 0.5 ? 0xffffff : 0xb8c4ff);
    this.ambient.intensity = 0.2 + 0.15 * day;
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
    const v = new THREE.Vector3(x, l.group.position.y + h, y).project(this.camera);
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.size = { width, height };
    // wide lines are sized in pixels
    for (const f of this.flows) for (const m of [f.line.material, f.pulse, f.glow]) m.resolution.set(width, height);
    this.draw();
  }

  /** Draws a frame at the current size and camera. */
  draw(now = performance.now()) {
    this.fitCamera();
    if (this.flows.length) this.updateFlows(now);
    this.applyCuts();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
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
