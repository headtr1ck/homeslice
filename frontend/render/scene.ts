// Builds a three.js scene from the expanded model and renders it on demand with a
// fixed orthographic camera. Plan (x, y) maps to world (x, z) with y up, so south is +z.

import * as THREE from "three";
import type { House, Level, Vec2, Vertical } from "../model/types";
import type { Wall } from "../model/walls";
import { bbox, pointInPolygon } from "../model/geometry";

export interface ViewOptions {
  /** Compass direction the camera looks from: 0 north, 90 east, 180 south, 270 west. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Extra gap between levels in metres. */
  explode: number;
  /** Outer walls facing the camera are cut down to this height so you can look in. */
  cutHeight: number;
}

export const DEFAULT_VIEW: ViewOptions = { azimuth: 250, elevation: 38, explode: 2.6, cutHeight: 0.4 };

const FLOOR_COLORS: Record<string, string> = {
  wood: "#b07c49",
  tile: "#a7acb1",
  concrete: "#8d8f92",
  carpet: "#9a8f84",
  lawn: "#5f8f4c",
  paving: "#9b9285",
  gravel: "#a39b8f",
};

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

export class HouseRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private root = new THREE.Group();
  private materials = new Map<string, THREE.Material>();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private view: ViewOptions = DEFAULT_VIEW;
  private levelGroups = new Map<string, THREE.Group>();
  /** Room floors keyed by `level/room`, each with its own material so it can glow. */
  private floors = new Map<string, THREE.MeshLambertMaterial>();
  private size = { width: 1, height: 1 };
  /** Width / height of the house as seen from the camera. */
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

  private material(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.materials.get(key);
    if (!m) this.materials.set(key, (m = make()));
    return m;
  }

  private lambert(color: string, extra: THREE.MeshLambertMaterialParameters = {}) {
    return this.material(`lambert:${color}:${JSON.stringify(extra)}`, () => new THREE.MeshLambertMaterial({ color, ...extra }));
  }

  setModel(house: House, walls: Map<string, Wall[]>, view: Partial<ViewOptions> = {}) {
    this.view = { ...DEFAULT_VIEW, ...view };
    this.clear();
    for (const level of house.levels) {
      const g = this.buildLevel(level, walls.get(level.id) ?? [], house.vertical);
      g.position.y = level.elevation + level.index * this.view.explode;
      this.root.add(g);
      this.levelGroups.set(level.id, g);
    }
    this.placeCameraAndSun();
  }

  /** Lights a room's floor in the light's colour; `null` switches it off. */
  setRoomLight(levelId: string, roomId: string, light: { rgb: [number, number, number]; brightness: number } | null) {
    const m = this.floors.get(`${levelId}/${roomId}`);
    if (!m) return;
    if (!light) m.emissive.setRGB(0, 0, 0);
    else {
      const k = 0.18 + 0.32 * light.brightness;
      m.emissive.setRGB((light.rgb[0] / 255) * k, (light.rgb[1] / 255) * k, (light.rgb[2] / 255) * k, THREE.SRGBColorSpace);
    }
  }

  /** Shows only the levels up to (and including) the given index; null shows all. */
  showLevelsUpTo(index: number | null) {
    [...this.levelGroups.values()].forEach((g, i) => (g.visible = index === null || i <= index));
  }

  /** Screen position (CSS px from the canvas' top left) of a plan point on a level. */
  project(levelId: string, [x, y]: Vec2, h = 0): { x: number; y: number } | null {
    const g = this.levelGroups.get(levelId);
    if (!g) return null;
    const v = new THREE.Vector3(x, g.position.y + h, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.width, y: ((1 - v.y) / 2) * this.size.height };
  }

  private clear() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.root.clear();
    this.levelGroups.clear();
    for (const m of this.floors.values()) m.dispose();
    this.floors.clear();
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, shadows = true) {
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
      g.add(this.mesh(slab, this.lambert("#6f7275")));
    }

    // room floors
    for (const room of level.rooms) {
      if (room.kind === "void") continue;
      const inside = holes.filter((h) => pointInPolygon(centroid(h), room.polygon));
      const floor = new THREE.ShapeGeometry(shapeOf(room.polygon, inside));
      floor.rotateX(-Math.PI / 2);
      floor.translate(0, room.kind === "outdoor" ? -level.slab + 0.01 : 0.004, 0);
      const mat = new THREE.MeshLambertMaterial({ color: FLOOR_COLORS[room.floor] ?? FLOOR_COLORS.wood });
      this.floors.set(`${level.id}/${room.id}`, mat);
      g.add(this.mesh(floor, mat, false));
    }

    // walls, split around openings
    const wallMat = this.lambert("#eeeae3");
    const glass = this.lambert("#9cc8ee", { transparent: true, opacity: 0.45 });
    const garage = this.lambert("#7d858d");
    const toCamera = this.cameraPlanDirection();
    for (const w of walls) {
      // outer walls whose outside faces the camera are cut down, like a dollhouse
      const facing = w.type !== "interior" && w.normal[0] * toCamera[0] + w.normal[1] * toCamera[1] > 0.2;
      const H = facing ? Math.min(this.view.cutHeight, w.height) : w.height;
      const box = (s: number, e: number, z0: number, z1: number, mat: THREE.Material, thickness = w.thickness) => {
        if (e - s < 1e-3 || z1 - z0 < 1e-3) return;
        g.add(this.wallBox(w, s, e, z0, z1, thickness, mat));
      };
      let cursor = 0;
      const length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      for (const o of w.openings) {
        box(cursor, o.start, 0, H, wallMat);
        box(o.start, o.end, 0, Math.min(o.sill, H), wallMat);
        box(o.start, o.end, o.sill + o.height, H, wallMat);
        const top = Math.min(o.sill + o.height, H);
        if (o.type === "window") box(o.start, o.end, o.sill, top, glass, 0.03);
        if (o.type === "garage_door") box(o.start, o.end, o.sill, top, garage, 0.06);
        cursor = o.end;
      }
      box(cursor, length, 0, H, wallMat);
    }

    // stairs from this level up to the next
    for (const v of vertical) if (v.kind === "stairs" && level.index === v.from) g.add(this.stairs(v, level));
    return g;
  }

  private wallBox(w: Wall, s: number, e: number, z0: number, z1: number, thickness: number, mat: THREE.Material) {
    const dx = w.b[0] - w.a[0];
    const dy = w.b[1] - w.a[1];
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const mid = (s + e) / 2;
    const m = this.mesh(new THREE.BoxGeometry(e - s, z1 - z0, thickness), mat);
    m.position.set(w.a[0] + ux * mid, (z0 + z1) / 2, w.a[1] + uy * mid);
    m.rotation.y = Math.atan2(-dy, dx);
    return m;
  }

  private stairs(v: Vertical, level: Level): THREE.Group {
    const g = new THREE.Group();
    const { min, max } = bbox(v.polygon);
    const rise = level.height + level.slab;
    const n = Math.max(2, Math.round(rise / 0.18));
    const alongX = max[0] - min[0] >= max[1] - min[1];
    const run = alongX ? max[0] - min[0] : max[1] - min[1];
    const width = (alongX ? max[1] - min[1] : max[0] - min[0]) * 0.45;
    const mat = this.lambert("#d8d3ca");
    for (let i = 0; i < n; i++) {
      const h = ((i + 1) * rise) / n;
      const depth = run / n;
      const geo = new THREE.BoxGeometry(alongX ? depth : width, h, alongX ? width : depth);
      const m = this.mesh(geo, mat);
      const along = (alongX ? min[0] : min[1]) + depth * (i + 0.5);
      const across = alongX ? max[1] - width / 2 : max[0] - width / 2;
      m.position.set(alongX ? along : across, h / 2, alongX ? across : along);
      g.add(m);
    }
    return g;
  }

  /** Horizontal direction from the house towards the camera, in plan coordinates. */
  private cameraPlanDirection(): Vec2 {
    const az = THREE.MathUtils.degToRad(this.view.azimuth);
    return [Math.sin(az), -Math.cos(az)];
  }

  private viewDirection(): THREE.Vector3 {
    const az = THREE.MathUtils.degToRad(this.view.azimuth);
    const el = THREE.MathUtils.degToRad(this.view.elevation);
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  private bounds = { left: -1, right: 1, top: 1, bottom: -1 };

  private placeCameraAndSun() {
    const box = new THREE.Box3().setFromObject(this.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.camera.position.copy(center).addScaledVector(this.viewDirection(), size * 2);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.near = 0.1;
    this.camera.far = size * 5;
    this.camera.updateMatrixWorld();

    // extent of the house in camera space
    const inv = this.camera.matrixWorldInverse;
    const b = { left: Infinity, right: -Infinity, top: -Infinity, bottom: Infinity };
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
          b.left = Math.min(b.left, p.x);
          b.right = Math.max(b.right, p.x);
          b.bottom = Math.min(b.bottom, p.y);
          b.top = Math.max(b.top, p.y);
        }
    this.bounds = b;
    this.aspect = (b.right - b.left) / (b.top - b.bottom);

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

  /** Renders one frame at the given CSS size, letterboxing to keep the house's aspect. */
  render(width: number, height: number) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.size = { width, height };
    const margin = 1.04;
    const b = this.bounds;
    let w = (b.right - b.left) * margin;
    let h = (b.top - b.bottom) * margin;
    const target = width / height;
    if (w / h < target) w = h * target;
    else h = w / target;
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    Object.assign(this.camera, { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 });
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clear();
    for (const m of this.materials.values()) m.dispose();
    this.renderer.dispose();
  }
}

function centroid(poly: Vec2[]): Vec2 {
  const s = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Vec2, [0, 0] as Vec2);
  return [s[0] / poly.length, s[1] / poly.length];
}

