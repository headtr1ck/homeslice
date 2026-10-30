// Builds a three.js scene from the expanded model and renders it on demand. Plan (x, y)
// maps to world (x, z) with y up, so south is +z. Nothing renders continuously: frames
// are drawn on request, and during short transitions (focusing a floor) only until the
// transition ends.

import * as THREE from "three";
import type { House, Level, Vec2, Vertical } from "../model/types";
import type { Wall, WallOpening } from "../model/walls";
import { bbox, pointInPolygon } from "../model/geometry";

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
};

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
  glass: "#9cc8ee",
  glassOpen: "#ffb05c",
  garageDoor: "#7d858d",
  shutter: "#5d666f",
  shutterBox: "#4a5159",
  stripClosed: "#6b747c",
  stripOpen: "#7fb0ff",
};
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

function holesFor(level: Level, vertical: Vertical[]): Vec2[][] {
  // a stairwell cuts the floors it leads up to, not the one it starts on
  return vertical.filter((v) => level.index > v.from && level.index <= v.to).map((v) => v.polygon);
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
  private view: ViewOptions = DEFAULT_VIEW;
  private levels: LevelState[] = [];
  private levelIds: string[] = [];
  /** Room floors keyed by `level/room`, each with its own material so it can glow. */
  private floors = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>>();
  private covers = new Map<string, CoverView>();
  private glasses = new Map<string, THREE.MeshLambertMaterial>();
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
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.4));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
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
      this.levelIds.push(level.id);
    }
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
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const l of this.levels) for (const m of l.materials) m.dispose();
    this.root.clear();
    this.levels = [];
    this.levelIds = [];
    this.floors.clear();
    this.covers.clear();
    this.glasses.clear();
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
      const inside = holes.filter((h) => pointInPolygon(centroid(h), room.polygon));
      const geo = new THREE.ShapeGeometry(shapeOf(room.polygon, inside));
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, room.kind === "outdoor" ? -level.slab + 0.01 : 0.004, 0);
      const color = FLOOR_COLORS[room.floor] ?? FLOOR_COLORS.wood;
      // outdoor areas reach over the floors below in the exploded view: keep them see-through
      const material = room.kind === "outdoor" ? this.lambert(color, { transparent: true, opacity: 0.55, depthWrite: false }) : this.lambert(color);
      const floor = this.mesh(geo, material, false);
      floor.userData.room = `${level.id}/${room.id}`;
      floor.userData.outdoor = room.kind === "outdoor";
      this.floors.set(`${level.id}/${room.id}`, floor);
      g.add(floor);
    }

    // walls, split around openings
    const wallMat = this.lambert(COLORS.wall);
    const glass = this.lambert(COLORS.glass, { transparent: true, opacity: 0.45 });
    const garage = this.lambert(COLORS.garageDoor);
    for (const w of walls) {
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
      let cursor = 0;
      const length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      for (const o of w.openings) {
        box(cursor, o.start, 0, H, wallMat);
        box(o.start, o.end, 0, o.sill, wallMat);
        box(o.start, o.end, o.sill + o.height, H, wallMat);
        if (o.type === "window") {
          const mat = o.contact ? this.lambert(COLORS.glass, { transparent: true, opacity: 0.45 }) : glass;
          if (o.contact) this.glasses.set(o.id, mat);
          box(o.start, o.end, o.sill, o.sill + o.height, mat, 0.03);
        }
        if (o.type === "garage_door") box(o.start, o.end, o.sill, o.sill + o.height, garage, 0.06);
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

  private stairs(v: Vertical, level: Level): THREE.Group {
    const g = new THREE.Group();
    const { min, max } = bbox(v.polygon);
    // up to the ceiling: the real rise to the next floor would poke out above the walls
    const rise = level.height;
    const n = Math.max(2, Math.round(rise / 0.18));
    const alongX = max[0] - min[0] >= max[1] - min[1];
    const run = alongX ? max[0] - min[0] : max[1] - min[1];
    const width = (alongX ? max[1] - min[1] : max[0] - min[0]) * 0.45;
    const mat = this.lambert(COLORS.stairs);
    for (let i = 0; i < n; i++) {
      const h = ((i + 1) * rise) / n;
      const depth = run / n;
      const m = this.mesh(new THREE.BoxGeometry(alongX ? depth : width, h, alongX ? width : depth), mat);
      const along = (alongX ? min[0] : min[1]) + depth * (i + 0.5);
      const across = alongX ? max[1] - width / 2 : max[0] - width / 2;
      m.position.set(alongX ? along : across, h / 2, alongX ? across : along);
      g.add(m);
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

  private placeSun() {
    const box = new THREE.Box3().setFromObject(this.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    // sun from the south-west, high
    this.sun.position.copy(center).add(new THREE.Vector3(-0.5, 1.2, 0.8).multiplyScalar(size));
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
      else for (const child of l.group.children) if (!child.userData.outdoor) box.expandByObject(child);
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

  /** Sets the canvas size (CSS px) and draws a frame. */
  render(width: number, height: number) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.size = { width, height };
    this.draw();
  }

  /** Draws a frame at the current size and camera. */
  draw() {
    this.fitCamera();
    this.applyCuts();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clear();
    this.renderer.dispose();
  }
}

function centroid(poly: Vec2[]): Vec2 {
  const s = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Vec2, [0, 0] as Vec2);
  return [s[0] / poly.length, s[1] / poly.length];
}
