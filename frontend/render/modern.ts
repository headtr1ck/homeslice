// The "Modern" furniture, drawn in code and fitted to each piece's size (see
// model/modern.ts). Pieces are built in their own frame: centred, the back at -z, the
// front at +z, standing on y = 0 (wall pieces from their bottom, ceiling pieces hang
// from y = height). Loaded only by cards whose house uses one.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FABRIC, FINISHES, MODERN, resolveKind } from "../model/modern";
import { fabricTexture, finishLook } from "./finishes";
import { BUILDERS as CAR_HATCHBACK } from "./modern/car-hatchback";
import { BUILDERS as CAR_ESTATE } from "./modern/car-estate";
import { BUILDERS as CAR_SUV } from "./modern/car-suv";
import { BUILDERS as CAR_VAN } from "./modern/car-van";
import { BUILDERS as CAR_SPORTS } from "./modern/car-sports";
import { BUILDERS as VEHICLES } from "./modern/vehicles";
import { BUILDERS as LIVING_SEATING } from "./modern/living-seating";
import { BUILDERS as LIVING_REST } from "./modern/living-rest";
import { BUILDERS as DINING } from "./modern/dining";
import { BUILDERS as KITCHEN } from "./modern/kitchen";
import { BUILDERS as BEDROOM_KIDS } from "./modern/bedroom-kids";
import { BUILDERS as BATHROOM } from "./modern/bathroom";
import { BUILDERS as PLANTS } from "./modern/plants";
import { BUILDERS as OUTSIDE } from "./modern/outside";
import { BUILDERS as GARDEN } from "./modern/garden";
import { BUILDERS as LIGHTING } from "./modern/lighting";
import { BUILDERS as OFFICE_SMART } from "./modern/office-smart";
import { BUILDERS as CLIMATE_UTILITY } from "./modern/climate-utility";
import { BUILDERS as HALL_DECOR } from "./modern/hall-decor";
import { BUILDERS as HOBBY } from "./modern/hobby";

// ----- materials (shared, so a card converts each once) -----

export const materials = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(extra);
  let m = materials.get(key);
  if (!m) materials.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra })));
  return m;
}
export const C = {
  black: "#232427",
  chrome: "#c9cdd1",
  steel: "#aeb3b8",
  ceramic: "#f3f3f1",
  screen: "#16181b",
  mirror: "#cdd8de",
  mattress: "#f1efe9",
  linen: "#e7e1d6",
  pillow: "#f6f4ef",
  shade: "#f1e8d6",
  soil: "#4a3a2c",
  trunk: "#6a4e39",
  birch: "#e6e2da",
  leaf: "#4c7d3a",
  leafDark: "#2e5b2b",
  leafLight: "#77a356",
  leafOlive: "#869466",
  leafYellow: "#9fb34a",
  book: ["#b5523b", "#3f6c8f", "#e3c46b", "#5f8a5c", "#7a5a8c", "#d9d4c7"],
  clothes: ["#2f3e55", "#c9b9a0", "#8a3b3b", "#e8e4dc", "#5b6b58", "#3a3a3a"],
};
export const glass = () => mat("#cfe3ea", { transparent: true, opacity: 0.3, roughness: 0.1 });
export const leafMat = (color: string) => mat(color, { side: THREE.DoubleSide, roughness: 0.9 });

/** Deterministic randomness: the same piece looks the same every time. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- building blocks -----

const textured = (m: THREE.Material) => !!(m as THREE.MeshStandardMaterial).map;

/**
 * Texture coordinates in metres for a shape made without them (a loft, a bent sheet):
 * each triangle takes the plane it faces most, like a box's sides.
 */
export function projectedUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, 3 * t);
    e1.fromBufferAttribute(pos, 3 * t + 1).sub(a);
    e2.fromBufferAttribute(pos, 3 * t + 2).sub(a);
    const n = e1.cross(e2);
    const [ax, ay, az] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    for (let k = 3 * t; k < 3 * t + 3; k++) {
      const [x, y, z] = [pos.getX(k), pos.getY(k), pos.getZ(k)];
      if (ay >= ax && ay >= az) uv.set([x, z], 2 * k);
      else if (ax >= az) uv.set([z, y], 2 * k);
      else uv.set([x, y], 2 * k);
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

export class Builder {
  readonly g = new THREE.Group();
  /** Geometries merged per material at the end (plants: thousands of leaves, one mesh). */
  private batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  /** Where new meshes go: the piece, or a part being drawn (see spinner). */
  private into: THREE.Object3D = this.g;

  /** The piece's chosen options (e.g. handle: knob); see ModernKind.options. */
  constructor(readonly options: Record<string, string> = {}) {}

  add(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
    if (textured(m) && !geo.attributes.uv) geo = projectedUVs(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    this.into.add(mesh);
    return mesh;
  }
  /**
   * Draws a part that turns around (x, y, z) on an axis when its device runs: fan blades,
   * a drum. Drawn in the piece's coordinates; a card turns it (scene.ts linkDevice).
   */
  spinner(x: number, y: number, z: number, axis: "y" | "z", draw: () => void) {
    const part = new THREE.Group();
    part.position.set(x, y, z);
    part.userData.spin = axis;
    this.g.add(part);
    this.into = part;
    draw();
    this.into = this.g;
    for (const child of part.children) child.position.sub(part.position);
    return part;
  }
  /**
   * Draws a part that may stand above the piece's height: a tap on a sink unit is not part
   * of the unit's 91 cm, so the piece is not squeezed to fit it in.
   */
  above(draw: () => void) {
    const part = new THREE.Group();
    part.userData.above = true;
    this.g.add(part);
    this.into = part;
    draw();
    this.into = this.g;
    return part;
  }
  /** Draws a part that shows (and turns) only while its device runs: a sprinkler's spray. */
  spray(x: number, y: number, z: number, draw: () => void) {
    const part = this.spinner(x, y, z, "y", draw);
    part.userData.spray = true;
    part.visible = false;
    return part;
  }
  /** Draws a part that pulses (a speaker's cone) around (x, y, z) while its device plays. */
  pulser(x: number, y: number, z: number, draw: () => void) {
    const part = this.spinner(x, y, z, "y", draw);
    delete part.userData.spin;
    part.userData.pulse = true;
    return part;
  }
  /** A box from its bottom centre, optionally with rounded edges. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const geo = rr > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, m, x, y + h / 2, z);
  }
  cyl(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 24, open = false) {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open), m, x, y + h / 2, z);
  }
  /** A thin rod from a to b. */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 8) {
    const len = a.distanceTo(b);
    const mesh = this.add(new THREE.CylinderGeometry(r, r, len, seg), m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return mesh;
  }
  sphere(r: number, x: number, y: number, z: number, m: THREE.Material, sx = 1, sy = 1, sz = 1, seg = 16) {
    const mesh = this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2)), m, x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  }
  /** Geometry to merge with others of the same material. */
  batch(geo: THREE.BufferGeometry, m: THREE.Material, matrix?: THREE.Matrix4) {
    if (matrix) geo.applyMatrix4(matrix);
    const g = geo.index ? geo.toNonIndexed() : geo;
    // only positions and normals (and, under a texture, coordinates made alike): every batch merges
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (textured(m)) projectedUVs(g);
    let list = this.batches.get(m);
    if (!list) this.batches.set(m, (list = []));
    list.push(g);
  }
  done(): THREE.Group {
    for (const [m, list] of this.batches) {
      const merged = mergeGeometries(list, false);
      if (merged) this.g.add(new THREE.Mesh(merged, m));
    }
    this.batches.clear();
    this.g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    return this.g;
  }
}

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const matrix = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")), v(s, s, s));

/** Four legs inset from the corners. */
export function legs(b: Builder, w: number, d: number, h: number, inset: number, r: number, m: THREE.Material, square = false) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset);
      const z = sz * (d / 2 - inset);
      if (square) b.box(r * 2, h, r * 2, x, 0, z, m);
      else b.cyl(r, r * 0.8, h, x, 0, z, m, 10);
    }
}

/** A flat leaf outline (base at 0, tip at +y), bent backwards along its length. */
export function leafGeometry(len: number, width: number, bend: number, holes = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(width * 0.7, len * 0.15, width * 0.6, len * 0.75, 0, len);
  s.bezierCurveTo(-width * 0.6, len * 0.75, -width * 0.7, len * 0.15, 0, 0);
  for (let i = 0; i < holes; i++) {
    // the windows of a monstera leaf, along both sides of the middle
    for (const side of [-1, 1]) {
      const y = len * (0.3 + (0.45 * i) / Math.max(1, holes - 1));
      const h = new THREE.Path();
      h.absellipse(side * width * 0.28, y, width * 0.12, len * 0.025, 0, Math.PI * 2, false, 0);
      s.holes.push(h);
    }
  }
  const geo = new THREE.ShapeGeometry(s, 5);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    p.setZ(i, -bend * len * t * t + Math.abs(p.getX(i)) * 0.25);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A diamond-shaped small leaf (two triangles), for trees and shrubs. */
export function smallLeaf(size: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const s = size;
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, s * 0.35, s * 0.5, 0.02 * s, 0, s, 0, 0, 0, 0, 0, s, 0, -s * 0.35, s * 0.5, 0.02 * s], 3));
  geo.computeVertexNormals();
  return geo;
}

/** A pot with soil (lathe profile), `r` its top radius. */
export function pot(b: Builder, r: number, h: number, m: THREE.Material, y = 0) {
  const pts = [v(0, 0, 0), v(r * 0.72, 0, 0), v(r * 0.78, h * 0.08, 0), v(r, h * 0.92, 0), v(r * 0.96, h, 0), v(r * 0.9, h, 0), v(r * 0.86, h * 0.9, 0), v(0, h * 0.86, 0)].map((p) => new THREE.Vector2(p.x, p.y));
  b.add(new THREE.LatheGeometry(pts, 28), m, 0, y, 0);
  b.cyl(r * 0.88, r * 0.88, 0.01, 0, y + h * 0.86, 0, mat(C.soil), 24);
}

/** Leaves scattered in a ball (trees, shrubs, hedges); `fill` darkens the inside. */
export function foliage(b: Builder, rand: () => number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, leafSize: number, colors: string[], fill = true) {
  if (fill) b.batch(new THREE.IcosahedronGeometry(1, 2), mat(C.leafDark), new THREE.Matrix4().compose(v(cx, cy, cz), new THREE.Quaternion(), v(rx * 0.86, ry * 0.86, rz * 0.86)));
  const leaf = smallLeaf(leafSize);
  for (let i = 0; i < count; i++) {
    // on the surface, a little inside
    const u = rand() * Math.PI * 2;
    const w = Math.acos(2 * rand() - 1);
    const k = 0.82 + rand() * 0.2;
    const x = cx + Math.sin(w) * Math.cos(u) * rx * k;
    const y = cy + Math.cos(w) * ry * k;
    const z = cz + Math.sin(w) * Math.sin(u) * rz * k;
    b.batch(leaf.clone(), leafMat(colors[i % colors.length]), matrix(x, y, z, rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI, 0.7 + rand() * 0.6));
  }
}

// ----- the kinds -----

export type Build = (b: Builder, w: number, d: number, h: number, finish: THREE.MeshStandardMaterial, color: string, accent: THREE.MeshStandardMaterial, accentColor: string) => void;

export const back = (d: number) => -d / 2;

/** Seats of a sofa along x from x0, `n` cushions. */
export function sofaSeats(b: Builder, x0: number, len: number, z0: number, depth: number, fabric: THREE.Material, backrest: boolean, n = Math.max(1, Math.round(len / 0.8))) {
  const cw = len / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + cw * (i + 0.5);
    b.box(cw - 0.015, 0.17, depth - (backrest ? 0.2 : 0.04), x, 0.24, z0 + (backrest ? 0.1 : 0), fabric, 0.05);
    if (backrest) b.box(cw - 0.02, 0.42, 0.2, x, 0.38, z0 - depth / 2 + 0.12, fabric, 0.07);
  }
}

export function sofa(b: Builder, w: number, d: number, fabric: THREE.Material, corner: "none" | "l" | "chaise", legM: THREE.Material) {
  const arm = 0.18;
  const sd = Math.min(d, 0.95);
  const z0 = back(d) + sd / 2;
  // base and back along the back wall
  b.box(w, 0.24, sd, 0, 0.06, z0, fabric, 0.04);
  b.box(w, 0.36, 0.18, 0, 0.3, back(d) + 0.09, fabric, 0.06);
  b.box(arm, 0.36, sd, w / 2 - arm / 2, 0.06, z0, fabric, 0.06);
  if (corner === "none") b.box(arm, 0.36, sd, -w / 2 + arm / 2, 0.06, z0, fabric, 0.06);
  // the corner (left end) reaches forward
  if (corner !== "none") {
    const cw = corner === "l" ? Math.min(0.95, w * 0.4) : Math.min(0.9, w * 0.38);
    const x = -w / 2 + cw / 2;
    const ext = d - sd;
    b.box(cw, 0.24, ext + 0.02, x, 0.06, back(d) + sd + ext / 2 - 0.01, fabric, 0.04);
    if (corner === "l") {
      b.box(0.18, 0.36, d, -w / 2 + 0.09, 0.3, 0, fabric, 0.06);
      b.box(cw - 0.18, 0.36, arm, x + 0.09, 0.06, d / 2 - arm / 2, fabric, 0.06);
      sofaSeats(b, -w / 2 + 0.18, cw - 0.18, back(d) + sd + (ext - arm) / 2, ext - arm + 0.2, fabric, false, 1);
    } else {
      // a chaise: one long cushion, no arm at its end
      b.box(cw - 0.03, 0.17, d - 0.22, x, 0.24, back(d) + 0.2 + (d - 0.22) / 2, fabric, 0.05);
      b.box(0.14, 0.36, sd, -w / 2 + 0.07, 0.06, z0, fabric, 0.05);
    }
    sofaSeats(b, -w / 2 + cw, w - cw - arm, z0, sd, fabric, true);
    if (corner === "chaise") b.box(cw - 0.02, 0.42, 0.2, x, 0.38, back(d) + 0.12, fabric, 0.07);
  } else sofaSeats(b, -w / 2 + arm, w - 2 * arm, z0, sd, fabric, true);
  // thin legs
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const z of [back(d) + 0.08, back(d) + sd - 0.08]) b.cyl(0.015, 0.012, 0.06, x, 0, z, legM, 8);
  // throw pillows
  const pillow = mat(C.pillow);
  b.box(0.42, 0.4, 0.12, w / 2 - arm - 0.3, 0.4, back(d) + 0.3, pillow, 0.06)?.rotation.set(-0.25, -0.2, 0.05);
}

/** Doors (or drawers) across a front at z, gaps between them, and handles if asked. */
/** How fronts open: a bar or a knob, a grip rail along the top (handleless) or a push (no handle at all). */
export type Handle = "bar" | "knob" | "handleless" | "push";

/**
 * Doors or drawer fronts in a grid, with joints between them. `handle` is the piece's own
 * handle; a piece whose fronts have one takes the handle chosen for it (options.handle).
 */
export function fronts(b: Builder, x0: number, w: number, y0: number, h: number, z: number, n: number, m: THREE.Material, rows = 1, own?: Handle, handleM: THREE.Material = mat(C.black), drawers = rows > 1) {
  const chosen = b.options.handle as Handle | undefined;
  const handle: Handle | undefined = own && chosen && ["bar", "knob", "handleless", "push"].includes(chosen) ? chosen : own;
  const cw = w / n;
  const rh = h / rows;
  // handleless: each row's fronts stop short of a recessed grip rail along their top
  const rail = handle === "handleless" ? Math.min(0.035, rh * 0.2) : 0;
  if (rail)
    for (let r = 0; r < rows; r++) {
      b.box(w, rail, 0.008, x0 + w / 2, y0 + rh * (r + 1) - rail, z + 0.004, mat("#2c2e31", { roughness: 0.9 }));
      b.box(w, 0.006, 0.016, x0 + w / 2, y0 + rh * (r + 1) - rail * 0.55, z + 0.006, mat("#a9adb2", { metalness: 0.7, roughness: 0.35 }));
    }
  // dark joints between fronts: they show even where the fronts sit flush in the carcass
  const joint = mat("#26272a", { roughness: 1 });
  for (let i = 1; i < n; i++) b.box(0.005, h, 0.02, x0 + cw * i, y0, z + 0.0105, joint);
  for (let r = 1; r < rows; r++) b.box(w, 0.005, 0.02, x0 + w / 2, y0 + rh * r - 0.0025, z + 0.0105, joint);
  for (let i = 0; i < n; i++)
    for (let r = 0; r < rows; r++) {
      b.box(cw - 0.004, rh - 0.004 - rail, 0.018, x0 + cw * (i + 0.5), y0 + rh * r + 0.002, z + 0.009, m, 0.003);
      // drawers: a bar across the top; doors: upright at the side they open on
      if (handle === "bar") b.box(drawers ? Math.min(0.2, cw * 0.4) : 0.012, drawers ? 0.012 : Math.min(0.3, rh * 0.25), 0.02, x0 + cw * (i + 0.5) + (drawers ? 0 : (i % 2 ? -1 : 1) * (cw / 2 - 0.05)), y0 + rh * r + (drawers ? rh - 0.06 : rh * 0.5), z + 0.028, handleM);
      if (handle === "knob") b.sphere(0.015, x0 + cw * (i + 0.5), y0 + rh * (r + 0.5), z + 0.03, handleM, 1, 1, 1, 8);
    }
}

export function shelves(b: Builder, w: number, d: number, h: number, m: THREE.Material, count: number, rand: () => number, withBooks = true) {
  const t = 0.022;
  b.box(t, h, d, -w / 2 + t / 2, 0, 0, m);
  b.box(t, h, d, w / 2 - t / 2, 0, 0, m);
  for (let i = 0; i < count; i++) {
    const y = (i * (h - t)) / (count - 1);
    b.box(w - 2 * t, t, d, 0, y, 0, m);
    if (withBooks && i < count - 1 && rand() > 0.25) {
      let x = -w / 2 + t + 0.02;
      const end = x + (w - 2 * t) * (0.4 + rand() * 0.5);
      const top = (h - t) / (count - 1) - 0.04;
      while (x < end) {
        const bw = 0.02 + rand() * 0.03;
        const bh = Math.min(top, 0.18 + rand() * 0.12);
        b.batch(new THREE.BoxGeometry(bw, bh, d * 0.75), mat(C.book[Math.floor(rand() * C.book.length)]), matrix(x + bw / 2, y + t + bh / 2, 0));
        x += bw + 0.002;
      }
    }
  }
}

/** Lamp shades: open cones and domes, light inside. */
/** Marks a material as lit by its lamp: a card lights it with the linked light. */
export function glowing<M extends THREE.Material>(m: M): M {
  m.userData.glow = true;
  return m;
}
/**
 * Marks a material as a part a linked device drives (scene.ts linkDevice): a screen that
 * lights up while it plays, flames that burn while it is on, a status light. Unlinked
 * pieces keep the look they are drawn with.
 */
export function part<M extends THREE.Material>(m: M, role: "screen" | "fire" | "led" | "warm" | "water" | "photo"): M {
  m.userData.part = role;
  return m;
}

/** A radiator's thermostatic valve: the pipe and a white head with ribs. */
export function radiatorValve(b: Builder, x: number, y: number, z: number) {
  b.cyl(0.01, 0.01, 0.06, x - 0.03, y, z, mat(C.chrome), 10).rotation.z = Math.PI / 2;
  b.cyl(0.024, 0.024, 0.07, x, y - 0.035, z, mat(C.ceramic), 16);
  b.cyl(0.026, 0.026, 0.01, x, y + 0.02, z, mat("#d9d9d6"), 16);
}

/** A copy of a finish that glows warm while its heating runs (radiators). */
export const warmMat = <M extends THREE.Material>(f: M) => part(f.clone() as M, "warm");
export const screenMat = () => part(mat(C.screen, { roughness: 0.15, metalness: 0.2, name: "screen" }), "screen");
export const ledMat = (color = "#3fd27a") => part(mat(color, { emissive: color, emissiveIntensity: 0.7, name: "led" }), "led");
export const shadeMat = (_finish: THREE.Material, color: string) =>
  ["black", "anthracite"].includes(color) ? mat(FINISHES[color], { side: THREE.DoubleSide }) : glowing(mat(C.shade, { side: THREE.DoubleSide }));

const BASE_BUILDERS: Record<string, Build> = {
  garden_sofa: (b, w, d, _h, f, _c, a) => {
    // a frame of slats and thick cushions
    const frame = a;
    b.box(w, 0.3, d, 0, 0.05, 0, frame, 0.01);
    b.box(w, 0.35, 0.08, 0, 0.35, back(d) + 0.04, frame, 0.01);
    for (const sx of [-1, 1]) b.box(0.08, 0.3, d, sx * (w / 2 - 0.04), 0.35, 0, frame, 0.01);
    sofaSeats(b, -w / 2 + 0.08, w - 0.16, 0.04, d - 0.08, f, true);
    legs(b, w, d, 0.05, 0.05, 0.02, frame, true);
  },
  soundbar: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, Math.min(h, d) * 0.45);
    b.pulser(0, h / 2, d / 2, () => b.box(w - 0.04, h * 0.7, 0.004, 0, h * 0.15, d / 2, mat(C.black, { roughness: 1 })));
  },
  speaker_shelf: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.012);
    b.pulser(0, h * 0.38, d / 2, () => b.add(new THREE.CircleGeometry(w * 0.32, 24), mat("#3a3c40"), 0, h * 0.38, d / 2 + 0.001));
    b.add(new THREE.CircleGeometry(w * 0.12, 16), mat("#3a3c40"), 0, h * 0.78, d / 2 + 0.001);
  },
  rug: (b, w, d, h, f, color) => b.box(w, h, d, 0, 0, 0, rugMaterial("border", color, f)),
  rug_round: (b, w, d, h, f, color) => {
    const m = rugMaterial("rings", color, f);
    const disc = b.cyl(0.5, 0.5, h, 0, 0, 0, m, 48);
    disc.scale.set(w, 1, d);
  },
  rug_runner: (b, w, d, h, f, color) => b.box(w, h, d, 0, 0, 0, rugMaterial("stripes", color, f)),
  rug_shaggy: (b, w, d, h, f) => b.box(w, h, d, 0, 0, 0, f, Math.min(0.02, h / 2)),
  mirror_floor: (b, w, d, h, f) => {
    // leaning against the wall
    const lean = Math.atan2(Math.min(d, 0.3) - 0.04, h);
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.03, 2, 0.01), f);
    frame.position.set(0, h / 2, 0);
    const glassM = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, h - 0.04, 0.005), mat(C.mirror, { metalness: 0.9, roughness: 0.05 }));
    glassM.position.set(0, h / 2, 0.016);
    g.add(frame, glassM);
    g.rotation.x = -lean;
    g.position.z = d / 2 - 0.03;
    b.g.add(g);
  },
  mirror_round: (b, w, d, h, f) => {
    const r = Math.min(w, h) / 2;
    const ring = b.add(new THREE.TorusGeometry(r - 0.012, 0.012, 8, 48), f, 0, h / 2, -d / 2 + 0.015);
    void ring;
    b.add(new THREE.CircleGeometry(r - 0.015, 48), mat(C.mirror, { metalness: 0.9, roughness: 0.05 }), 0, h / 2, -d / 2 + 0.016);
  },
  mirror_wall: (b, w, d, h, f) => {
    b.box(w, h, 0.02, 0, 0, back(d) + 0.01, f, 0.005);
    b.box(w - 0.03, h - 0.03, 0.004, 0, 0.015, back(d) + 0.022, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }));
  },
  kitchen_panel: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, Math.min(0.003, w / 4));
  },
  planter_box: (b, w, d, h, f) => {
    const bh = Math.min(0.45, h * 0.5);
    b.box(w, bh, d, 0, 0, 0, f, 0.006);
    b.box(w - 0.04, 0.01, d - 0.04, 0, bh - 0.04, 0, mat(C.soil));
    grass(b, random(29), w - 0.1, d - 0.1, h - bh, bh - 0.04, 140, ["#6f8f48", "#8aa35a", "#a6b46a"]);
  },
  // ----- garden, more -----
  deck_chair: (b, w, d, h, f, _c, a) => {
    const wood = a;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.02);
      b.rod(v(x, 0, d / 2), v(x, h, -d / 2 + 0.05), 0.016, wood, 6);
      b.rod(v(x, 0, -d / 2), v(x, h * 0.45, d / 2 - 0.05), 0.016, wood, 6);
    }
    const sling = new THREE.PlaneGeometry(w - 0.08, Math.hypot(h, d) * 0.85, 1, 8);
    const pos = sling.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / (Math.hypot(h, d) * 0.85) + 0.5;
      pos.setZ(i, Math.sin(t * Math.PI) * 0.12);
    }
    sling.computeVertexNormals();
    const m = b.add(sling, mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, h * 0.55, 0);
    m.rotation.x = -(Math.PI / 2 - Math.atan2(h * 0.9, d * 0.9));
  },
  hammock: (b, w, d, h, f, _c, a) => {
    // a wooden frame (a post pair at each end, a beam on the ground) and a sagging cloth
    const wood = a;
    const top = h * 0.92;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.05);
      for (const sz of [-1, 1]) b.rod(v(x - sx * 0.15, 0, sz * (d / 2 - 0.05)), v(x, top, 0), 0.04, wood, 8);
      b.box(0.08, 0.08, d, x - sx * 0.15, 0, 0, wood);
    }
    b.box(w - 0.3, 0.08, 0.08, 0, 0, 0, wood);
    const len = w * 0.62;
    const cloth = new THREE.PlaneGeometry(len, Math.min(0.9, d * 0.8), 16, 4);
    const pos = cloth.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) / len;
      const s2 = pos.getY(i) / Math.min(0.9, d * 0.8);
      pos.setZ(i, -(1 - 4 * t * t) * h * 0.35 - (1 - 4 * s2 * s2) * 0.08);
    }
    cloth.computeVertexNormals();
    const m = b.add(cloth, mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, h * 0.75, 0);
    m.rotation.x = -Math.PI / 2;
    for (const sx of [-1, 1]) b.rod(v((sx * len) / 2, h * 0.75, 0), v(sx * (w / 2 - 0.07), top - 0.03, 0), 0.008, mat(C.linen), 4);
  },
  fence_slats: (b, w, d, h, f, _c, a) => {
    const n = Math.max(1, Math.round(w / 1.8));
    for (let i = 0; i <= n; i++) b.box(0.07, h, 0.07, -w / 2 + 0.035 + (i * (w - 0.07)) / n, 0, 0, a);
    const rows = Math.max(3, Math.round(h / 0.12));
    for (let r = 0; r < rows; r++) b.box(w - 0.02, (h / rows) * 0.72, Math.min(0.025, d), 0, 0.03 + (r * (h - 0.03)) / rows, 0.045, f);
  },
  garden_light: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, h - 0.08, 0, 0, 0, f, 20);
    b.cyl(r * 0.95, r * 0.95, 0.06, 0, h - 0.08, 0, glowing(mat("#fff3d6", { emissive: "#ffe2a8", emissiveIntensity: 0.6 })), 20);
    b.cyl(r * 1.05, r * 1.05, 0.02, 0, h - 0.02, 0, f, 20);
  },
  fire_pit: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    const profile = [v(0.001, 0, 0), v(r * 0.3, 0, 0), v(r * 0.75, h * 0.35, 0), v(r, h * 0.8, 0), v(r * 0.98, h * 0.8, 0), v(r * 0.73, h * 0.38, 0), v(0.001, h * 0.3, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    b.add(new THREE.LatheGeometry(profile, 32), mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 0.9 }));
    const rand = random(107);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.rod(v(Math.cos(a) * r * 0.45, h * 0.35, Math.sin(a) * r * 0.45), v(Math.cos(a + 2.4) * r * 0.4, h * 0.5 + rand() * 0.05, Math.sin(a + 2.4) * r * 0.4), 0.035, mat(C.trunk), 6);
    }
    b.sphere(r * 0.25, 0, h * 0.42, 0, part(mat("#ff8a3a", { emissive: "#ff5a1a", emissiveIntensity: 0.8 }), "fire"), 1, 0.4, 1, 10);
  },
  raised_bed: (b, w, d, h, f) => {
    const t = 0.04;
    const rows = Math.max(3, Math.round(h / 0.15));
    for (let r = 0; r < rows; r++) {
      const y = (r * h) / rows;
      const bh = h / rows - 0.008;
      b.box(w, bh, t, 0, y, d / 2 - t / 2, f);
      b.box(w, bh, t, 0, y, -d / 2 + t / 2, f);
      b.box(t, bh, d - 2 * t, -w / 2 + t / 2, y, 0, f);
      b.box(t, bh, d - 2 * t, w / 2 - t / 2, y, 0, f);
    }
    b.box(w - 2 * t, 0.02, d - 2 * t, 0, h - 0.06, 0, mat(C.soil));
    const rand = random(109);
    const n = Math.max(2, Math.round(w / 0.3));
    for (let i = 0; i < n; i++)
      for (const z of [-d / 4, d / 4]) {
        const x = -w / 2 + t + ((w - 2 * t) * (i + 0.5)) / n;
        if (i % 3 === 2) foliage(b, rand, x, h + 0.12, z, 0.1, 0.14, 0.1, 30, 0.06, [C.leaf, C.leafDark], true);
        else for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          b.batch(leafGeometry(0.13, 0.08, 0.4), leafMat(i % 2 ? C.leafLight : "#8bb85c"), matrix(x, h - 0.04, z, -0.6 - rand() * 0.4, a, 0));
        }
      }
  },
  sandbox: (b, w, d, h, f) => {
    const t = 0.05;
    for (const sz of [-1, 1]) b.box(w, h, t, 0, 0, sz * (d / 2 - t / 2), f);
    for (const sx of [-1, 1]) b.box(t, h, d - 2 * t, sx * (w / 2 - t / 2), 0, 0, f);
    b.box(w - 2 * t, h * 0.6, d - 2 * t, 0, 0, 0, mat("#e3cf9c", { roughness: 1 }));
    for (const [sx, sz] of [[-1, -1], [1, 1]]) {
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0, 0.3)]);
      const seat = b.add(new THREE.ExtrudeGeometry(tri, { depth: 0.025, bevelEnabled: false }), f, sx * (w / 2 - 0.02), h + 0.025, sz * (d / 2 - 0.02));
      seat.rotation.x = Math.PI / 2;
      seat.rotation.z = sx === -1 ? 0 : Math.PI;
    }
    b.cyl(0.07, 0.055, 0.12, w * 0.15, h * 0.6, 0, mat("#e04a3a"), 12);
    b.cyl(0.03, 0.03, 0.02, -w * 0.2, h * 0.6, d * 0.1, mat("#3a7de0"), 10);
  },
  rain_barrel: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.add(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(r * 0.85, 0), new THREE.Vector2(r, h * 0.5), new THREE.Vector2(r * 0.88, h - 0.02), new THREE.Vector2(0.001, h - 0.02)], 24), f);
    b.cyl(r * 0.9, r * 0.9, 0.04, 0, h - 0.04, 0, f, 24);
    for (const y of [0.25, 0.75]) b.add(new THREE.TorusGeometry(r * (y === 0.25 ? 0.93 : 0.95), 0.012, 4, 24), f, 0, h * y, 0).rotation.x = Math.PI / 2;
    b.rod(v(0, 0.15, r * 0.9), v(0, 0.15, r + 0.08), 0.015, mat(C.chrome), 6);
  },
  compost_bin: (b, w, d, h, f) => {
    const rows = Math.max(4, Math.round(h / 0.12));
    for (let r = 0; r < rows; r++) {
      const y = (r * h) / rows;
      const sh = h / rows - 0.03;
      for (const sz of [-1, 1]) b.box(w, sh, 0.025, 0, y, sz * (d / 2 - 0.0125), f);
      for (const sx of [-1, 1]) b.box(0.025, sh, d - 0.05, sx * (w / 2 - 0.0125), y, 0, f);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.05, h + 0.04, 0.05, sx * (w / 2 - 0.025), 0, sz * (d / 2 - 0.025), f);
    b.box(w - 0.06, h * 0.75, d - 0.06, 0, 0, 0, mat(C.soil, { roughness: 1 }));
    foliage(b, random(127), 0, h * 0.78, 0, w * 0.3, 0.05, d * 0.3, 25, 0.06, ["#7a8a3a", "#a08d4a"], true);
  },
  wheelbarrow: (b, w, d, h, f) => {
    const tray = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.6, 0.3, 4, 1, false, Math.PI / 4);
    tray.scale(w, 1, d * 0.55);
    b.add(tray, f, 0, h - 0.17, d * 0.05);
    b.add(new THREE.TorusGeometry(0.17, 0.05, 8, 20), mat(C.black), 0, 0.2, d / 2 - 0.2).rotation.y = Math.PI / 2;
    for (const sx of [-1, 1]) {
      b.rod(v(sx * 0.2, h - 0.25, -d / 2), v(sx * 0.06, 0.2, d / 2 - 0.2), 0.016, mat(C.steel), 6);
      b.rod(v(sx * 0.18, h - 0.32, -d * 0.15), v(sx * 0.18, 0, -d * 0.2), 0.014, mat(C.steel), 6);
      b.cyl(0.02, 0.02, 0.12, sx * 0.2, h - 0.25, -d / 2 + 0.06, mat(C.black), 8).rotation.x = Math.PI / 2 - 0.25;
    }
  },
  rotary_dryer: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(0.02, 0.022, h - 0.05, 0, 0, 0, f, 8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.rod(v(0, h - 0.2, 0), v(Math.cos(a) * r, h - 0.05, Math.sin(a) * r), 0.012, f, 4);
      b.rod(v(0, h - 0.6, 0), v(Math.cos(a) * r * 0.6, h - 0.12, Math.sin(a) * r * 0.6), 0.01, f, 4);
    }
    for (let k = 1; k <= 5; k++) {
      const rr = (r * k) / 5;
      const ring = b.add(new THREE.TorusGeometry(rr * Math.SQRT2 * 0.707, 0.003, 3, 4), mat(C.linen), 0, h - 0.2 + (0.15 * k) / 5, 0);
      ring.rotation.x = Math.PI / 2;
    }
    const rand = random(131);
    for (let i = 0; i < 6; i++) {
      const a = (Math.floor(i / 2) * Math.PI) / 2 + (i % 2) * 0.6 + 0.2;
      const rr = r * (0.5 + (i % 3) * 0.15);
      b.box(0.35, 0.45, 0.01, Math.cos(a) * rr * 0.7, h - 0.62, Math.sin(a) * rr * 0.7, mat(C.clothes[Math.floor(rand() * C.clothes.length)], { side: THREE.DoubleSide }))!.rotation.y = -a;
    }
  },
  sprinkler: (b, w, _d, h, f) => {
    // a pop-up sprinkler head; while its valve is open, four jets turn round it
    b.cyl(w / 2, w / 2, 0.03, 0, 0, 0, f, 16);
    b.cyl(w * 0.18, w * 0.22, h - 0.03, 0, 0.03, 0, mat(C.black), 12);
    const drop = mat("#9fd8ff", { transparent: true, opacity: 0.55 });
    b.spray(0, h, 0, () => {
      for (let j = 0; j < 4; j++) {
        const a = (j / 4) * Math.PI * 2;
        for (let i = 1; i <= 12; i++) {
          // a parabola out to about 2.4 m
          const r = (i / 12) * 2.4;
          const y = h + r * 0.9 - (r * r) / 3;
          b.add(new THREE.SphereGeometry(0.025, 6, 4), drop, Math.cos(a) * r, y, Math.sin(a) * r);
        }
      }
    });
  },
  satellite_dish: (b, w, d, h, f) => {
    // a dish on an arm from the wall, tilted up, the receiver on its feed arm
    const r = Math.min(w, h) * 0.45;
    const dish = new THREE.LatheGeometry(
      Array.from({ length: 9 }, (_, i) => new THREE.Vector2((i / 8) * r, ((i / 8) * r) ** 2 / (4 * r * 0.6))),
      28,
    );
    const m = b.add(dish, f, 0, h * 0.55, back(d) + d * 0.55);
    m.rotation.x = Math.PI / 2 - 0.45;
    b.box(0.05, 0.05, d * 0.5, 0, h * 0.45, back(d) + d * 0.25, mat(C.steel));
    b.box(0.12, 0.2, 0.03, 0, h * 0.35, back(d) + 0.015, mat(C.steel));
    b.rod(v(0, h * 0.4, back(d) + d * 0.55), v(0, h * 0.5, back(d) + d * 0.98), 0.012, mat(C.steel), 6);
    b.box(0.06, 0.05, 0.09, 0, h * 0.48, back(d) + d * 0.95, mat(C.black), 0.01);
  },
  mailbox: (b, w, d, h, f) => {
    // a wall letterbox: a rounded body, a slanted lid with the slot, a name plate, a lock
    b.box(w, h - 0.05, d, 0, 0, 0, f, 0.015);
    b.box(w + 0.01, 0.06, d + 0.02, 0, h - 0.06, 0.008, f, 0.012)?.rotation.set(-0.15, 0, 0);
    b.box(w * 0.7, 0.012, 0.006, 0, h - 0.04, d / 2 + 0.02, mat(C.black));
    b.box(w * 0.4, 0.04, 0.004, 0, h * 0.45, d / 2 + 0.001, mat(C.ceramic));
    b.cyl(0.012, 0.012, 0.008, w * 0.32, h * 0.25, d / 2 + 0.002, mat(C.chrome), 12).rotation.x = Math.PI / 2;
  },
  mailbox_post: (b, w, d, h, f) => {
    // a free-standing letterbox on a post
    const box = Math.min(0.42, h * 0.3);
    b.box(0.07, h - box, 0.07, 0, 0, 0, f, 0.01);
    b.box(0.3, 0.02, 0.25, 0, 0, 0, f, 0.005);
    b.box(w, box, d, 0, h - box, 0, f, 0.03);
    b.box(w * 0.7, 0.012, 0.006, 0, h - 0.05, d / 2 + 0.001, mat(C.black));
    b.box(w * 0.4, 0.04, 0.004, 0, h - box * 0.6, d / 2 + 0.001, mat(C.ceramic));
  },
  kitchen_upper_open: (b, w, d, h, f) => {
    const rand = random(139);
    const shelves2 = Math.max(1, Math.round(h / 0.35));
    for (let s = 0; s < shelves2; s++) {
      const y = (s * h) / shelves2 + (s ? 0 : 0);
      b.box(w, 0.03, d, 0, y, 0, f, 0.004);
      let x = -w / 2 + 0.06;
      while (x < w / 2 - 0.1) {
        const kind = rand();
        if (kind < 0.4) b.cyl(0.045, 0.045, 0.14, x + 0.045, y + 0.03, 0, glass(), 12);
        else if (kind < 0.7) for (let k = 0; k < 4; k++) b.cyl(0.11, 0.1, 0.015, x + 0.11, y + 0.03 + k * 0.016, 0, mat(C.ceramic), 18);
        else b.cyl(0.04, 0.035, 0.09, x + 0.04, y + 0.03, 0, mat(C.book[Math.floor(rand() * C.book.length)]), 12);
        x += kind < 0.4 ? 0.12 : kind < 0.7 ? 0.25 : 0.11;
      }
    }
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.004);
  },
  path_stepping: (b, w, d, h, f) => {
    const n = Math.max(2, Math.round(d / 0.6));
    const rand = random(173);
    for (let i = 0; i < n; i++) {
      const geo = new THREE.CylinderGeometry(0.5, 0.5, h, 9);
      geo.scale(w * (0.8 + rand() * 0.2), 1, (d / n) * 0.75);
      b.add(geo, f, (rand() - 0.5) * w * 0.15, h / 2, -d / 2 + (d / n) * (i + 0.5)).rotation.y = rand() * 0.5;
    }
  },
  fence_picket: (b, w, d, h, f) => {
    const n = Math.max(2, Math.round(w / 0.12));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      b.box(0.07, h - 0.06, Math.min(0.02, d), x, 0, 0.02, f);
      b.add(new THREE.ConeGeometry(0.05, 0.08, 4).rotateY(Math.PI / 4).scale(1, 1, 0.3), f, x, h - 0.02, 0.02);
    }
    for (const y of [0.15, h - 0.25]) b.box(w, 0.07, 0.025, 0, y, -0.005, f);
  },
  fence_planks: (b, w, d, h, f) => {
    const n = Math.max(1, Math.round(w / 1.8));
    for (let i = 0; i <= n; i++) b.box(0.09, h + 0.05, 0.09, -w / 2 + 0.045 + (i * (w - 0.09)) / n, 0, -0.02, f);
    const boards = Math.max(4, Math.round(w / 0.14));
    for (let i = 0; i < boards; i++) b.box(w / boards - 0.012, h - 0.05, Math.min(0.02, d), -w / 2 + (w / boards) * (i + 0.5), 0.05, 0.035, f);
  },
  garden_gate: (b, w, d, h, f, _c, a) => {
    for (const sx of [-1, 1]) b.box(0.1, h + 0.1, 0.1, sx * (w / 2 - 0.05), 0, 0, mat(C.black));
    const gw = w - 0.24;
    const boards = Math.max(4, Math.round(gw / 0.12));
    for (let i = 0; i < boards; i++) b.box(gw / boards - 0.01, h - 0.1, 0.022, -gw / 2 + (gw / boards) * (i + 0.5), 0.06, 0.03, f);
    for (const y of [0.2, h - 0.25]) b.box(gw, 0.08, 0.025, 0, y, 0.005, f);
    b.rod(v(-gw / 2 + 0.05, 0.25, 0.01), v(gw / 2 - 0.05, h - 0.2, 0.01), 0.02, f, 6);
    b.box(0.03, 0.12, 0.03, gw / 2 - 0.06, h * 0.55, 0.06, a, 0.006);
    void d;
  },
  aquarium: (b, w, d, h, f) => {
    const cab = Math.min(0.7, h * 0.55);
    b.box(w, cab, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.01, cab - 0.02, d / 2 - 0.018, Math.max(2, Math.round(w / 0.5)), f, 1);
    const th = h - cab;
    b.box(w - 0.04, 0.05, d - 0.04, 0, cab, 0, mat("#c9b48a", { roughness: 1 }));
    b.box(w - 0.04, th * 0.8, d - 0.04, 0, cab + 0.05, 0, mat("#5fb4d8", { transparent: true, opacity: 0.35, roughness: 0.05 }));
    b.box(w, th, d, 0, cab, 0, glass());
    b.box(w, 0.04, d, 0, h - 0.04, 0, mat(C.black), 0.004);
    // the tank's light under the lid
    b.box(w - 0.1, 0.008, 0.04, 0, h - 0.05, 0, glowing(mat("#eaf6ff", { emissive: "#cfeaff", emissiveIntensity: 0.5 })));
    const rand = random(281);
    for (let i = 0; i < 9; i++) grass(b, rand, 0.08, 0.06, th * (0.3 + rand() * 0.5), cab + 0.05, 8, ["#3f8a4a", "#6aa84f"]);
    for (let i = 0; i < 6; i++) b.sphere(0.02, (rand() - 0.5) * w * 0.8, cab + 0.15 + rand() * th * 0.5, (rand() - 0.5) * d * 0.6, mat(["#ff7a2e", "#f2d14b", "#3f8fe0"][i % 3]), 1.6, 1, 0.6, 8);
  },
  picture_frame: (b, w, d, h, _f, c, a) => {
    // an abstract print behind glass in a thin frame (frame in the accent)
    b.box(w, h, d, 0, 0, 0, a, 0.004);
    b.box(w - 0.04, h - 0.04, 0.004, 0, 0.02, d / 2, mat("#f4f1ea"));
    art(b, w - 0.14, h - 0.14, 0.07, d / 2 + 0.003, c);
    // linked to an image entity: its picture over the print
    b.box(w - 0.14, h - 0.14, 0.002, 0, 0.07, d / 2 + 0.006, part(new THREE.MeshStandardMaterial({ color: "#000000", visible: false }), "photo"));
  },
  picture_set: (b, w, d, h, _f, c, a) => {
    // a gallery wall: frames of different sizes on a common centre line
    const rand = random(283);
    const n = Math.max(2, Math.round(w / 0.4));
    let x = -w / 2;
    for (let i = 0; i < n; i++) {
      const fw = w / n - 0.06;
      const fh = h * (0.55 + rand() * 0.45);
      const y = (h - fh) / 2;
      b.box(fw, fh, d, x + fw / 2 + 0.03, y, 0, a, 0.004);
      b.box(fw - 0.03, fh - 0.03, 0.004, x + fw / 2 + 0.03, y + 0.015, d / 2, mat("#f4f1ea"));
      const pic = new Builder();
      art(pic, fw - 0.1, fh - 0.1, 0.05, d / 2 + 0.003, ["terracotta", "blue", "green", "sand", "pink"][(i + c.length) % 5]);
      const g = pic.done();
      g.position.set(x + fw / 2 + 0.03, y, 0);
      b.g.add(g);
      x += w / n;
    }
  },
  wall_clock: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, h) / 2;
    b.add(new THREE.CylinderGeometry(r, r, d, 40).rotateX(Math.PI / 2), a, 0, r, 0);
    b.add(new THREE.CircleGeometry(r * 0.92, 40), f, 0, r, d / 2 + 0.001);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      b.box(0.006, i % 3 ? 0.02 : 0.04, 0.003, Math.sin(ang) * r * 0.8, r + Math.cos(ang) * r * 0.8 - 0.01, d / 2 + 0.002, a)?.rotation.set(0, 0, -ang);
    }
    b.box(0.008, r * 0.5, 0.004, 0, r, d / 2 + 0.004, a)?.rotation.set(0, 0, -1.0);
    b.box(0.006, r * 0.75, 0.004, 0, r, d / 2 + 0.006, a)?.rotation.set(0, 0, 2.2);
  },
  curtains: (b, w, d, h, f, _c, a) => {
    // a rod at the top, two drawn-back panels in soft folds
    b.rod(v(-w / 2 - 0.05, h - 0.04, 0), v(w / 2 + 0.05, h - 0.04, 0), 0.012, a, 8);
    for (const sx of [-1, 1]) {
      b.sphere(0.025, sx * (w / 2 + 0.06), h - 0.04, 0, a, 1, 1, 1, 10);
      const pw = w * 0.28;
      const panel = new THREE.PlaneGeometry(pw, h - 0.06, 24, 1);
      const pos = panel.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / pw) * Math.PI * 9) * 0.035);
      panel.computeVertexNormals();
      // pinned at the outer end, so a linked cover draws it closed by widening it
      panel.translate(-sx * (pw / 2), 0, 0);
      const m = b.add(panel, mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), sx * (w / 2), (h - 0.06) / 2, 0);
      m.userData.curtain = (w / 2 + 0.01) / pw;
    }
    void d;
  },
  tv_frame: (b, w, d, h, _f, c, a) => {
    // a TV that looks like a framed picture
    b.box(w, h, d, 0, 0, 0, a, 0.004);
    b.box(w - 0.07, h - 0.07, 0.004, 0, 0.035, d / 2, mat("#f4f1ea"));
    art(b, w - 0.24, h - 0.22, 0.11, d / 2 + 0.003, c);
  },
  bistro_set: (b, w, d, h, f, _c, a) => {
    const r = Math.min(0.35, d / 2);
    b.cyl(r, r, 0.025, 0, h - 0.025, 0, f, 32);
    b.cyl(0.02, 0.02, h - 0.025, 0, 0, 0, a, 10);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      b.rod(v(0, 0.15, 0), v(Math.cos(ang) * r * 0.8, 0, Math.sin(ang) * r * 0.8), 0.012, a, 6);
    }
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.22);
      b.cyl(0.2, 0.2, 0.02, x, 0.45, 0, f, 24);
      for (const sz of [-1, 1]) for (const dx of [-1, 1]) b.rod(v(x + dx * 0.14, 0.45, sz * 0.14), v(x + dx * 0.18, 0, sz * 0.18), 0.009, a, 6);
      const back2 = new THREE.TorusGeometry(0.17, 0.01, 6, 20, Math.PI);
      back2.rotateY(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      b.add(back2, a, x + sx * 0.14, 0.62, 0);
    }
  },
  fountain: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    const water = mat("#5fb4d8", { transparent: true, opacity: 0.75, roughness: 0.05 });
    b.add(new THREE.LatheGeometry([[0.001, 0], [r, 0], [r, 0.35], [r * 0.9, 0.35], [r * 0.9, 0.08], [0.001, 0.08]].map(([x, y]) => new THREE.Vector2(x, y)), 36), f);
    b.cyl(r * 0.9, r * 0.9, 0.01, 0, 0.3, 0, water, 36);
    b.cyl(0.08, 0.12, h * 0.55, 0, 0.08, 0, f, 16);
    b.add(new THREE.LatheGeometry([[0.001, 0], [r * 0.45, 0.12], [r * 0.42, 0.14], [0.001, 0.05]].map(([x, y]) => new THREE.Vector2(x, y)), 28), f, 0, h * 0.6, 0);
    b.cyl(r * 0.42, r * 0.42, 0.01, 0, h * 0.6 + 0.12, 0, water, 28);
    b.cyl(0.03, 0.05, h * 0.25, 0, h * 0.6 + 0.1, 0, f, 12);
    b.sphere(0.06, 0, h - 0.05, 0, f, 1, 1, 1, 14);
  },
  pond: (b, w, d, h, f) => {
    const rand = random(313);
    const s = new THREE.Shape();
    for (let i = 0; i <= 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const k = 0.85 + rand() * 0.15;
      const p = new THREE.Vector2((Math.cos(ang) * w * k) / 2, (Math.sin(ang) * d * k) / 2);
      if (i === 0) s.moveTo(p.x, p.y);
      else s.lineTo(p.x, p.y);
    }
    // the water lights up with the pond's pump or light linked
    b.add(new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2), glowing(part(mat("#3f7f9a", { roughness: 0.05 }), "water")), 0, h * 0.4, 0);
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      b.sphere(0.12 + rand() * 0.08, (Math.cos(ang) * w) / 2, 0.05, (Math.sin(ang) * d) / 2, f, 1.3, 0.6, 1.1, 8);
    }
    for (let i = 0; i < 6; i++) b.add(new THREE.CircleGeometry(0.1, 12, 0.3, Math.PI * 1.8), leafMat("#4f8a3a"), (rand() - 0.5) * w * 0.5, h * 0.4 + 0.005, (rand() - 0.5) * d * 0.5).rotation.x = -Math.PI / 2;
    b.sphere(0.04, w * 0.1, h * 0.4 + 0.03, 0, mat("#f4c6d6"), 1, 0.6, 1, 8);
  },
  string_lights: (b, w, d, h, f) => {
    // two posts, a sagging string of warm bulbs
    for (const sx of [-1, 1]) b.box(0.08, h, 0.08, sx * (w / 2 - 0.04), 0, 0, f);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push(v(-w / 2 + 0.04 + t * (w - 0.08), h - 0.05 - Math.sin(t * Math.PI) * h * 0.15, 0));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.004, 4), mat(C.black));
    for (let i = 1; i < 20; i += 1.5) {
      const p = pts[Math.floor(i)];
      bulb(b, p.x, p.y - 0.05, 0, 0.025);
    }
    void d;
  },
  lantern: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.box(r * 2, 0.03, r * 2, 0, 0, 0, f, 0.006);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.015, h * 0.7, 0.015, sx * (r - 0.01), 0.03, sz * (r - 0.01), f);
    b.box(r * 1.9, h * 0.7, r * 1.9, 0, 0.03, 0, glass());
    b.cyl(0.03, 0.035, h * 0.35, 0, 0.03, 0, mat(C.ceramic), 12);
    bulb(b, 0, 0.03 + h * 0.4, 0, 0.012);
    b.add(new THREE.ConeGeometry(r * 1.1, h * 0.15, 4).rotateY(Math.PI / 4), f, 0, 0.03 + h * 0.77, 0);
    b.add(new THREE.TorusGeometry(0.04, 0.008, 6, 14), f, 0, h - 0.03, 0);
  },
  boxwood_ball: (b, w, d, h, f) => {
    const ph = h * 0.35;
    pot(b, Math.min(w, d) * 0.42, ph, f);
    const r = Math.min(w, d, h - ph) / 2;
    foliage(b, random(347), 0, ph + r, 0, r, r, r, 220, 0.06, [C.leafDark, "#3f7037", C.leaf]);
  },
  topiary_cone: (b, w, d, h, f) => {
    const ph = Math.min(0.4, h * 0.28);
    pot(b, Math.min(w, d) * 0.42, ph, f);
    const rand = random(349);
    b.batch(new THREE.ConeGeometry(Math.min(w, d) * 0.42, h - ph, 16), mat(C.leafDark), matrix(0, ph + (h - ph) / 2, 0));
    const leaf = smallLeaf(0.05);
    for (let i = 0; i < 260; i++) {
      const t = rand();
      const ang = rand() * Math.PI * 2;
      const rr = Math.min(w, d) * 0.42 * (1 - t);
      b.batch(leaf.clone(), leafMat(i % 2 ? C.leaf : "#3f7037"), matrix(Math.cos(ang) * rr, ph + t * (h - ph), Math.sin(ang) * rr, rand() * 3, rand() * 6, rand() * 3));
    }
  },
  patio_heater: (b, w, d, h, f) => {
    // a weighted base, the gas tank housing, a pole, the burner and its reflector hood
    const r = Math.min(w, d) / 2;
    b.cyl(r * 0.5, r * 0.55, 0.05, 0, 0, 0, f, 24);
    b.cyl(0.17, 0.17, 0.75, 0, 0.05, 0, f, 20);
    b.cyl(0.04, 0.04, h - 1.0, 0, 0.8, 0, f, 12);
    b.cyl(0.09, 0.12, 0.22, 0, h - 0.38, 0, mat("#3a3d41"), 16);
    b.cyl(0.07, 0.07, 0.12, 0, h - 0.3, 0, part(mat("#ff7a2e", { emissive: "#ff5a1a", emissiveIntensity: 0.6 }), "fire"), 16);
    b.add(new THREE.ConeGeometry(r, 0.18, 32, 1, true).rotateX(Math.PI), mat(C.chrome, { metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }), 0, h - 0.09, 0);
  },
  outdoor_shower: (b, w, d, h, f) => {
    // a post with a rain head, a hand shower, a mixer, a slatted floor
    const r = Math.min(w, d) / 2;
    b.box(w, 0.04, d, 0, 0, 0, mat(FINISHES.oak), 0.008);
    for (let i = 0; i < 6; i++) b.box(0.006, 0.042, d - 0.02, -w / 2 + ((i + 1) * w) / 7, 0, 0, mat("#3a2a20"));
    b.box(0.09, h, 0.09, 0, 0.04, back(d) + 0.06, f, 0.01);
    b.rod(v(0, h - 0.05, back(d) + 0.06), v(0, h - 0.05, back(d) + 0.06 + r * 0.9), 0.015, mat(C.chrome, { metalness: 0.8 }), 8);
    b.cyl(0.12, 0.12, 0.02, 0, h - 0.07, back(d) + 0.06 + r * 0.9, mat(C.chrome, { metalness: 0.8, roughness: 0.25 }), 24);
    b.cyl(0.03, 0.03, 0.06, 0.08, 1.05, back(d) + 0.12, mat(C.chrome, { metalness: 0.8 }), 12).rotation.x = Math.PI / 2;
    b.rod(v(0.05, 1.3, back(d) + 0.11), v(0.05, 1.5, back(d) + 0.12), 0.012, mat(C.chrome, { metalness: 0.8 }), 8);
  },
  hose_reel: (b, w, d, h, f) => {
    // a frame on two small wheels, the drum with green hose wound on it, a crank
    const r = Math.min(h * 0.38, 0.28);
    for (const sx of [-1, 1]) {
      b.box(0.03, h - 0.05, 0.04, sx * (w / 2 - 0.03), 0.05, 0, f, 0.008);
      b.add(new THREE.TorusGeometry(0.06, 0.02, 6, 16).rotateY(Math.PI / 2), mat(C.black), sx * (w / 2 - 0.02), 0.08, d * 0.25);
    }
    b.rod(v(-w / 2 + 0.03, h - 0.05, 0), v(w / 2 - 0.03, h - 0.05, 0), 0.015, f, 8);
    b.add(new THREE.CylinderGeometry(r, r, w - 0.12, 24).rotateZ(Math.PI / 2), mat("#3c8a3c", { roughness: 0.7 }), 0, h * 0.5, 0);
    for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.015, 24).rotateZ(Math.PI / 2), f, sx * (w / 2 - 0.07), h * 0.5, 0);
    b.box(0.02, 0.12, 0.02, w / 2, h * 0.5 + 0.05, 0, f, 0.006);
  },
  bird_bath: (b, w, d, h, f) => {
    // a pedestal and a shallow bowl of water
    const r = Math.min(w, d) / 2;
    b.cyl(r * 0.4, r * 0.45, 0.06, 0, 0, 0, f, 20);
    b.add(new THREE.LatheGeometry([0.12, 0.08, 0.07, 0.09, 0.14].map((x, i) => new THREE.Vector2(x * (r / 0.27), 0.06 + (i * (h - 0.2)) / 4)), 20), f);
    const bowl = [v(0.001, h - 0.14, 0), v(r * 0.5, h - 0.13, 0), v(r, h - 0.03, 0), v(r * 0.95, h, 0), v(r * 0.85, h - 0.04, 0), v(0.001, h - 0.09, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    b.add(new THREE.LatheGeometry(bowl, 32), f);
    b.add(new THREE.CircleGeometry(r * 0.84, 32).rotateX(-Math.PI / 2), mat("#7fb2cf", { roughness: 0.05, transparent: true, opacity: 0.8 }), 0, h - 0.05, 0);
  },
  // ----- decor and kitchen things -----
  vase_flowers: (b, w, d, h, f) => {
    const rand = random(367);
    const r = Math.min(w, d) * 0.22;
    const vh = h * 0.42;
    b.add(new THREE.LatheGeometry([[0.001, 0], [r * 0.8, 0], [r, vh * 0.3], [r * 0.7, vh * 0.85], [r * 0.6, vh], [r * 0.5, vh], [0.001, vh * 0.85]].map(([x, y]) => new THREE.Vector2(x, y)), 24), f);
    const petals = ["#e58fb0", "#f4f2ec", "#f2d14b", "#d4553a", "#a98fd0"];
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2;
      const top = v(Math.cos(a) * w * 0.3 * rand(), vh + (h - vh) * (0.6 + rand() * 0.4), Math.sin(a) * d * 0.3 * rand());
      stem(b, v(0, vh * 0.8, 0), top, 0.004, C.leaf);
      b.batch(leafGeometry(0.08, 0.03, 0.2), leafMat(C.leaf), matrix(top.x * 0.6, vh + (top.y - vh) * 0.5, top.z * 0.6, -1, rand() * 6, 0));
      for (let p = 0; p < 6; p++) b.batch(leafGeometry(0.045, 0.035, -0.3), leafMat(petals[i % petals.length]), matrix(top.x, top.y, top.z, -1.2, (p / 6) * Math.PI * 2, 0));
      b.batch(new THREE.SphereGeometry(0.012, 6, 4), mat("#e8b84a"), matrix(top.x, top.y + 0.01, top.z));
    }
  },
  vase_branches: (b, w, d, h, f) => {
    const rand = random(373);
    const r = Math.min(w, d) * 0.3;
    const vh = h * 0.38;
    b.add(new THREE.LatheGeometry([[0.001, 0], [r * 0.7, 0], [r, vh * 0.45], [r * 0.45, vh * 0.92], [r * 0.4, vh], [0.001, vh * 0.9]].map(([x, y]) => new THREE.Vector2(x, y)), 24), f);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rand();
      const top = v(Math.cos(a) * w * 0.4, h * (0.85 + rand() * 0.15), Math.sin(a) * d * 0.4);
      b.rod(v(0, vh * 0.8, 0), top, 0.006, mat(C.trunk), 4);
      for (let k = 0; k < 8; k++) {
        const p = v(0, vh, 0).lerp(top, 0.4 + (k / 8) * 0.6);
        b.batch(leafGeometry(0.05, 0.025, 0.2), leafMat(k % 2 ? "#7d9a6a" : "#a3b48a"), matrix(p.x, p.y, p.z, -1.0, rand() * 6, 0));
      }
    }
  },
  candles: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.015, d, 0, 0, 0, a, 0.006);
    [[-w * 0.25, h * 0.9], [0, h * 0.6], [w * 0.25, h * 0.75]].forEach(([x, ch]) => {
      b.cyl(0.025, 0.025, ch - 0.03, x, 0.015, 0, f, 16);
      b.add(new THREE.ConeGeometry(0.008, 0.03, 8), mat("#ffcf6a", { emissive: "#ff9a2a", emissiveIntensity: 0.9 }), x, 0.015 + ch - 0.015, 0);
    });
  },
  tray_decor: (b, w, d, h, f) => {
    b.box(w, 0.012, d, 0, 0, 0, f, 0.01);
    for (const sz of [-1, 1]) b.box(w, 0.03, 0.006, 0, 0.012, sz * (d / 2 - 0.003), f);
    for (const sx of [-1, 1]) b.box(0.006, 0.03, d, sx * (w / 2 - 0.003), 0.012, 0, f);
    b.cyl(0.04, 0.035, h - 0.012, -w * 0.25, 0.012, 0, mat(C.ceramic), 16);
    b.box(0.12, 0.03, 0.16, w * 0.18, 0.012, 0, mat(C.book[1]), 0.004);
    b.box(0.11, 0.025, 0.15, w * 0.18, 0.042, 0, mat(C.book[2]), 0.004)?.rotation.set(0, 0.2, 0);
  },
  bin_store: (b, w, d, h, f) => {
    // slatted boxes for the bins, lids on top
    const n = Math.max(1, Math.round(w / 0.75));
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + bw * (i + 0.5);
      for (let r = 0; r < Math.round(h / 0.11); r++) b.box(bw - 0.04, 0.08, 0.02, x, r * 0.11, d / 2 - 0.01, f);
      b.box(bw - 0.01, 0.03, d, x, h - 0.03, 0, f, 0.006);
      b.box(0.03, h, d, x - bw / 2 + 0.015, 0, 0, f);
    }
    b.box(0.03, h, d, w / 2 - 0.015, 0, 0, f);
    b.box(w, h, 0.02, 0, 0, -d / 2 + 0.01, f);
  },
  firewood_shelter: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.07, h - 0.1, 0.07, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04), f);
    const roof = b.box(w + 0.15, 0.03, d + 0.2, 0, h - 0.08, 0, mat(C.black), 0.006);
    roof?.rotation.set(0.15, 0, 0);
    b.box(w - 0.06, 0.04, d - 0.06, 0, 0.08, 0, f);
    const logs = new Builder();
    BUILDERS.log_stack(logs, w - 0.12, d - 0.12, h * 0.7, f, "oak", f, "oak");
    const g = logs.done();
    g.position.y = 0.12;
    b.g.add(g);
  },
  adirondack_chair: (b, w, d, h, f) => {
    // slanted slatted back, deep seat, wide arms
    for (const sx of [-1, 1]) {
      b.box(0.04, 0.4, 0.06, sx * (w / 2 - 0.08), 0, d / 2 - 0.12, f);
      b.rod(v(sx * (w / 2 - 0.08), 0.05, -d / 2 + 0.15), v(sx * (w / 2 - 0.08), 0.4, d / 2 - 0.12), 0.025, f, 6);
      b.box(0.13, 0.025, d * 0.6, sx * (w / 2 - 0.065), 0.6, d * 0.12, f, 0.006);
    }
    for (let i = 0; i < 5; i++) b.box(w - 0.18, 0.02, 0.07, 0, 0.32 - i * 0.03, d / 2 - 0.15 - i * 0.09, f, 0.004)?.rotation.set(0.3, 0, 0);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const slat = b.box(0.07, h * 0.75, 0.02, 0, 0, 0, f, 0.006);
      slat?.position.set(-w * 0.3 + (i * w * 0.6) / (n - 1), 0.25 + h * 0.37, -d / 2 + 0.22);
      slat?.rotation.set(-0.45, 0, 0);
    }
  },
  swing_bench: (b, w, d, h, f) => {
    // a two-seat bench hanging in an A-frame
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)), v(sx * (w / 2 - 0.05), h - 0.05, 0), 0.045, f, 8);
    b.box(w, 0.1, 0.1, 0, h - 0.1, 0, f);
    const seatW = w - 0.5;
    for (const sx of [-1, 1]) b.rod(v(sx * (seatW / 2 - 0.05), h - 0.1, 0), v(sx * (seatW / 2 - 0.05), 0.75, 0), 0.008, mat(C.steel), 4);
    b.box(seatW, 0.05, 0.55, 0, 0.42, 0.05, f, 0.01);
    b.box(seatW, 0.45, 0.04, 0, 0.45, -0.2, f, 0.01)?.rotation.set(-0.2, 0, 0);
    b.box(seatW - 0.06, 0.08, 0.5, 0, 0.47, 0.06, mat(C.linen, { roughness: 1 }), 0.03);
    for (const sx of [-1, 1]) b.box(0.05, 0.25, 0.5, sx * seatW / 2, 0.47, 0.05, f, 0.01);
  },
  outdoor_rug: (b, w, d, h, _f, color) => b.box(w, h, d, 0, 0, 0, rugMaterial("stripes", color, mat(FINISHES[color] ?? FINISHES.blue))),
  planter_tall: (b, w, d, h, f) => {
    const ph = h * 0.5;
    b.box(w, ph, d, 0, 0, 0, f, 0.01);
    b.box(w - 0.04, 0.01, d - 0.04, 0, ph - 0.03, 0, mat(C.soil));
    grass(b, random(397), w * 0.7, d * 0.7, h - ph, ph - 0.03, 120, ["#6f8f48", "#8aa35a", "#5b7a3c"], true);
  },
  sun_sail: (b, w, d, h, f) => {
    // a triangular shade sail on three posts
    const pts = [v(-w / 2, h, -d / 2), v(w / 2, h * 0.75, -d / 2 + 0.2), v(-w / 2 + 0.3, h * 0.8, d / 2)];
    for (const p of pts) b.rod(v(p.x, 0, p.z), v(p.x, p.y + 0.15, p.z), 0.04, mat(C.steel), 8);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    b.add(geo, mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }));
  },
};

/** A row of books standing between x0 and x1 on a shelf at y. */
export function books(b: Builder, rand: () => number, x0: number, x1: number, y: number, maxH: number, depth: number, z: number) {
  let x = x0;
  while (x < x1) {
    const bw = 0.02 + rand() * 0.03;
    const bh = Math.max(0.05, Math.min(maxH, 0.17 + rand() * 0.12));
    b.batch(new THREE.BoxGeometry(bw, bh, depth), mat(C.book[Math.floor(rand() * C.book.length)]), matrix(x + bw / 2, y + bh / 2, z));
    x += bw + 0.002;
  }
}

/**
 * A car along z (front at +z), from a side profile: the body up to the window line in
 * the paint, the cabin in dark glass under a painted roof, wheels, lights.
 */
export const CAR_PROFILES: Record<string, { body: [number, number][]; cabin: [number, number][] }> = {
  hatchback: { body: [[0, 0.17], [0, 0.58], [0.04, 0.62], [0.72, 0.62], [0.95, 0.52], [1, 0.42], [1, 0.17]], cabin: [[0.03, 0.62], [0.08, 0.97], [0.5, 1], [0.73, 0.62]] },
  estate: { body: [[0, 0.17], [0, 0.56], [0.03, 0.6], [0.75, 0.6], [0.96, 0.5], [1, 0.4], [1, 0.17]], cabin: [[0.02, 0.6], [0.04, 0.95], [0.6, 0.98], [0.77, 0.6]] },
  suv: { body: [[0, 0.17], [0, 0.6], [0.03, 0.64], [0.76, 0.64], [0.96, 0.57], [1, 0.47], [1, 0.17]], cabin: [[0.02, 0.64], [0.04, 0.97], [0.64, 0.99], [0.78, 0.64]] },
  sports: { body: [[0, 0.16], [0, 0.5], [0.05, 0.56], [0.62, 0.56], [0.9, 0.45], [1, 0.36], [1, 0.16]], cabin: [[0.12, 0.56], [0.3, 0.92], [0.52, 0.95], [0.7, 0.56]] },
  van: { body: [[0, 0.14], [0, 0.97], [0.03, 1], [0.8, 1], [0.86, 0.62], [1, 0.5], [1, 0.4], [1, 0.14]], cabin: [[0.79, 0.95], [0.85, 0.62], [0.95, 0.6], [0.83, 0.97]] },
};
export function car(b: Builder, w: number, d: number, h: number, color: string, style: string) {
  const prof = CAR_PROFILES[style] ?? CAR_PROFILES.hatchback;
  const paint = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.35, metalness: 0.3 });
  const dark = mat("#20262d", { roughness: 0.15, metalness: 0.4 });
  const r = Math.min(0.34, h * 0.22);
  const wheels = [0.17, 0.8].map((t) => -d / 2 + t * d);
  const side = (pts: [number, number][], width: number, m: THREE.Material, bevel: number, smooth = false, arches = false) => {
    const p = pts.map(([t, y]) => new THREE.Vector2(-d / 2 + bevel + t * (d - 2 * bevel), y * h));
    const shape = new THREE.Shape();
    shape.moveTo(p[0].x, p[0].y);
    // a flowing upper line through the profile's points (the cabin keeps its corners)
    if (smooth) shape.splineThru(p.slice(1, -1));
    else for (const q of p.slice(1, -1)) shape.lineTo(q.x, q.y);
    shape.lineTo(p[p.length - 1].x, p[p.length - 1].y);
    if (arches) {
      // back along the sill, up and over each wheel
      const yb = p[0].y;
      const ra = r * 1.32;
      const phi = Math.asin(Math.max(-1, Math.min(1, (r - yb) / ra)));
      const dx = ra * Math.cos(phi);
      for (const zc of [...wheels].sort((a, b) => b - a)) {
        shape.lineTo(zc + dx, yb);
        shape.absarc(zc, r, ra, -phi, Math.PI + phi, false);
      }
    }
    shape.lineTo(p[0].x, p[0].y);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 });
    geo.rotateY(-Math.PI / 2);
    geo.translate(width / 2 - bevel, 0, 0);
    b.add(geo, m);
  };
  side(prof.body, w * 0.93, paint, 0.05, style !== "van", true);
  side(prof.cabin, w * (style === "van" ? 0.975 : 0.84), dark, 0.03);
  if (style !== "van") {
    // the roof over the cabin's top edge
    const [, a, c] = prof.cabin;
    const len = (c[0] - a[0]) * d;
    b.box(w * 0.82, 0.04, len, 0, Math.max(a[1], c[1]) * h - 0.005, -d / 2 + ((a[0] + c[0]) / 2) * d, paint, 0.02);
  }
  // dark liners in the arches (the body is solid behind them)
  for (const z of wheels) b.add(new THREE.CylinderGeometry(r * 1.32 - 0.06, r * 1.32 - 0.06, w * 0.9, 24, 1, true).rotateZ(Math.PI / 2), mat("#141518", { roughness: 0.9, side: THREE.DoubleSide }), 0, r, z);
  for (const z of wheels)
    for (const sx of [-1, 1]) {
      // the tyre's outside about flush with the body
      const x = sx * (w * 0.465 - 0.09);
      // a rounded tyre, a dished rim with five spokes, and the dark arch over it
      b.add(new THREE.TorusGeometry(r * 0.78, r * 0.24, 10, 28).rotateY(Math.PI / 2), mat(C.black, { roughness: 0.9 }), x, r, z);
      b.add(new THREE.CylinderGeometry(r * 0.56, r * 0.56, 0.16, 24).rotateZ(Math.PI / 2), mat("#3a3d41", { metalness: 0.5, roughness: 0.4 }), x, r, z);
      const rim = mat(C.steel, { metalness: 0.7, roughness: 0.25 });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        b.add(new THREE.BoxGeometry(0.02, r * 0.5, r * 0.12), rim, x + sx * 0.085, r + Math.cos(a) * r * 0.27, z + Math.sin(a) * r * 0.27).rotation.x = -a;
      }
      b.add(new THREE.CylinderGeometry(r * 0.14, r * 0.14, 0.02, 12).rotateZ(Math.PI / 2), rim, x + sx * 0.09, r, z);
    }
  const lowFront = prof.body.find(([t]) => t === 1)?.[1] ?? 0.4;
  for (const sx of [-1, 1]) {
    b.box(w * 0.2, 0.06, 0.03, sx * w * 0.33, lowFront * h - 0.1, d / 2 - 0.005, mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.3 }), 0.01);
    b.box(w * 0.18, 0.07, 0.03, sx * w * 0.36, prof.body[1][1] * h - 0.14, -d / 2 + 0.005, mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.4 }), 0.01);
  }
  b.box(w * 0.5, 0.11, 0.02, 0, 0.3, -d / 2 + 0.002, mat(C.ceramic), 0.005);
  // grille, door lines, mirrors and the pillar between the side windows
  const black = mat("#1c1e21", { roughness: 0.6 });
  b.box(w * 0.42, 0.09, 0.02, 0, lowFront * h - 0.22, d / 2 - 0.005, black, 0.01);
  const [c0, c1, c2, c3] = prof.cabin;
  const belt = c0[1] * h;
  if (style !== "van") {
    const mid = -d / 2 + ((c1[0] + c2[0]) / 2) * d;
    b.box(w * 0.85, (Math.max(c1[1], c2[1]) * h - belt) * 0.95, 0.07, 0, belt, mid, paint);
    for (const z of [mid, -d / 2 + c3[0] * d - 0.05]) for (const sx of [-1, 1]) b.box(0.004, belt - 0.3, 0.006, sx * w * 0.466, 0.28, z, black);
  }
  for (const sx of [-1, 1]) b.box(0.08, 0.06, 0.12, sx * (w / 2 - 0.02), belt + 0.02, -d / 2 + c3[0] * d - 0.08, paint, 0.02);
}

/** An open-fronted box (glass cabinets): back, sides, top and bottom of thickness t. */
export function hollow(b: Builder, w: number, h: number, d: number, x: number, z: number, m: THREE.Material, t: number) {
  b.box(w, h, t, x, 0, z - d / 2 + t / 2, m);
  for (const sx of [-1, 1]) b.box(t, h, d, x + sx * (w / 2 - t / 2), 0, z, m);
  b.box(w, t, d, x, 0, z, m);
  b.box(w, t, d, x, h - t, z, m);
}

/** An appliance front: an oven (glass door, handle, controls) or a microwave. */
export function applianceFront(b: Builder, w: number, y: number, h: number, z: number, kind: "oven" | "microwave", knobs = false) {
  b.box(w - 0.006, h - 0.004, 0.02, 0, y + 0.002, z + 0.01, mat(C.screen, { roughness: 0.15, metalness: 0.2 }), 0.004);
  const steel = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
  if (kind === "oven") {
    b.box(w - 0.006, 0.09, 0.022, 0, y + h - 0.09, z + 0.011, mat(C.steel, { metalness: 0.6, roughness: 0.35 }), 0.003);
    b.rod(v(-w * 0.38, y + h - 0.13, z + 0.05), v(w * 0.38, y + h - 0.13, z + 0.05), 0.01, steel, 8);
    b.box(w * 0.6, h * 0.5, 0.004, 0, y + h * 0.15, z + 0.022, mat("#2f3a40", { roughness: 0.05 }), 0.01);
    if (knobs) for (let i = 0; i < 5; i++) b.cyl(0.018, 0.018, 0.02, -w * 0.36 + (i * w * 0.72) / 4, y + h - 0.045, z + 0.03, mat(C.black), 12).rotation.x = Math.PI / 2;
  } else {
    b.box(w * 0.55, h * 0.7, 0.004, -w * 0.12, y + h * 0.15, z + 0.022, mat("#2f3a40", { roughness: 0.05 }), 0.01);
    b.box(0.012, h * 0.5, 0.02, w * 0.22, y + h * 0.25, z + 0.03, steel, 0.004);
  }
}

/** The oven under a hob or worktop, with a drawer below. */
export function oven(b: Builder, w: number, u: { y0: number; y1: number; fz: number }, f: THREE.Material, knobs = false) {
  const oh = Math.min(0.6, u.y1 - u.y0 - 0.12);
  applianceFront(b, w, u.y1 - oh - 0.01, oh, u.fz, "oven", knobs);
  fronts(b, -w / 2, w, u.y0, u.y1 - oh - 0.01 - u.y0, u.fz, 1, f, 1, "bar", undefined, true);
}

/** A tall kitchen tap, curving over the sink. */
export function tapGooseneck(b: Builder, x: number, y: number, z: number, m: THREE.Material) {
  b.cyl(0.022, 0.025, 0.06, x, y, z, m, 14);
  const curve = new THREE.CatmullRomCurve3([v(x, y + 0.05, z), v(x, y + 0.3, z), v(x, y + 0.36, z + 0.08), v(x, y + 0.28, z + 0.18)]);
  b.add(new THREE.TubeGeometry(curve, 16, 0.012, 8), m);
  b.rod(v(x + 0.025, y + 0.04, z), v(x + 0.07, y + 0.08, z + 0.02), 0.006, m, 6);
}

/** How a toilet or bidet looks: oval or squared, hung on the wall or standing. */
interface BowlStyle {
  square?: boolean;
  floor?: boolean;
  /** A bidet: no cistern. */
  open?: boolean;
}

/** A rounded rectangle, centred, for seats, lids and basins. */
export function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const rr = Math.min(r, w / 2 - 0.001, d / 2 - 0.001);
  s.moveTo(-w / 2 + rr, -d / 2);
  s.lineTo(w / 2 - rr, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + rr);
  s.lineTo(w / 2, d / 2 - rr);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - rr, d / 2);
  s.lineTo(-w / 2 + rr, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - rr);
  s.lineTo(-w / 2, -d / 2 + rr);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + rr, -d / 2);
  return s;
}

/** A flat oval or rounded rectangle lying at y (seats, lids, basins' insides). */
export function flat(b: Builder, w: number, d: number, y: number, z: number, m: THREE.Material, square: boolean, thick = 0) {
  if (thick > 0) {
    const geo = square
      ? new THREE.ExtrudeGeometry(roundedRect(w, d, 0.07), { depth: thick, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2)
      : new THREE.CylinderGeometry(0.5, 0.5, thick, 36).scale(w, 1, d).translate(0, thick / 2, 0);
    return b.add(geo, m, 0, y, z);
  }
  const geo = square ? new THREE.ShapeGeometry(roundedRect(w, d, 0.06), 6) : new THREE.CircleGeometry(0.5, 36).scale(w, d, 1);
  const mesh = b.add(geo, m, 0, y, z);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/**
 * The bowl: narrow at its foot, wide at the seat (oval or squared); hung ones are joined to
 * the wall, standing ones reach the floor and have a cistern behind.
 */
export function bowlShape(b: Builder, w: number, d: number, zBack: number, f: THREE.Material, style: BowlStyle = {}) {
  const cistern = style.floor && !style.open ? 0.18 : 0;
  const z0 = zBack + 0.06 + cistern;
  const L = d - 0.06 - cistern;
  const y0 = style.floor ? 0 : 0.16;
  const shape = style.floor
    ? style.square
      ? [[0.001, 0], [0.3, 0], [0.32, 0.4], [0.44, 0.7], [0.5, 1]]
      : [[0.001, 0], [0.22, 0], [0.24, 0.3], [0.34, 0.55], [0.46, 0.85], [0.5, 1]]
    : style.square
      ? [[0.001, 0], [0.4, 0], [0.45, 0.25], [0.49, 0.65], [0.5, 1]]
      : [[0.001, 0], [0.3, 0], [0.38, 0.2], [0.45, 0.55], [0.49, 0.85], [0.5, 1]];
  // closed: up the outside, over the rim, down the inside, so no light gets through
  const inside = (style.square ? [[0.43, 1], [0.4, 0.75], [0.3, 0.5], [0.001, 0.45]] : [[0.42, 1], [0.36, 0.75], [0.22, 0.5], [0.001, 0.45]]) as number[][];
  const profile = [...shape, ...inside].map(([r, y]) => new THREE.Vector2(r, y));
  const bowl = style.square ? new THREE.LatheGeometry(profile, 4, Math.PI / 4) : new THREE.LatheGeometry(profile, 32);
  const k = style.square ? Math.SQRT2 : 1;
  bowl.scale(w * k, 0.4 - y0, L * k);
  b.add(bowl, f, 0, y0, z0 + L / 2);
  if (cistern) {
    b.box(w * 0.92, 0.38, cistern, 0, 0.42, zBack + cistern / 2, f, style.square ? 0.015 : 0.05);
    b.box(w * 0.94, 0.03, cistern + 0.01, 0, 0.8, zBack + cistern / 2, f, 0.012);
    b.cyl(0.025, 0.025, 0.008, 0, 0.83, zBack + cistern / 2, mat(C.chrome, { metalness: 0.8, roughness: 0.2 }), 14);
    b.box(w * 0.5, 0.42, 0.12, 0, 0, zBack + cistern + 0.04, f, 0.04);
  } else if (style.floor) b.box(w * 0.5, 0.4, 0.14, 0, 0, zBack + 0.07, f, 0.04);
  else b.box(w * 0.7, 0.22, 0.16, 0, 0.18, zBack + 0.08, f, style.square ? 0.02 : 0.06);
  return { L, z: z0 + L / 2, z0 };
}

/** An open bidet: its bowl (no seat), the rim and a tap. */
export function bidet(b: Builder, w: number, d: number, f: THREE.Material, tap: THREE.Material, style: BowlStyle) {
  const bowl = bowlShape(b, w, d, back(d), f, style);
  if (style.square) {
    const outline = roundedRect(w, bowl.L, 0.06);
    outline.holes.push(roundedRect(w * 0.8, bowl.L * 0.78, 0.05));
    const ring = new THREE.ExtrudeGeometry(outline, { depth: 0.02, bevelEnabled: false });
    ring.translate(0, 0, -0.02);
    ring.rotateX(Math.PI / 2);
    b.add(ring, f, 0, 0.4, bowl.z);
  }
  tapBasin(b, 0, 0.4, bowl.z0 + 0.04, tap, 0.1);
}

/** A wall-hung basin: a soft slab (or a crisp one), an oval (or squared) bowl in it, the drain. */
export function basin(b: Builder, w: number, d: number, h: number, f: THREE.Material, depth: number, square = false) {
  b.box(w, depth, d, 0, h - depth, 0, f, square ? 0.012 : Math.min(depth / 2 - 0.01, 0.06));
  flat(b, w - 0.12, d - 0.16, h + 0.002, 0.03, mat("#dcdcd8", { roughness: 0.3 }), square);
  b.cyl(0.02, 0.02, 0.003, 0, h + 0.003, 0.03, mat(C.steel), 12);
}

/** A bowl standing on a top at y. */
export function vessel(b: Builder, w: number, d: number, y: number, f: THREE.Material) {
  const profile = [[0.001, 0], [0.26, 0], [0.42, 0.3], [0.5, 1], [0.47, 1], [0.39, 0.35], [0.23, 0.09], [0.001, 0.09]].map(([r, yy]) => new THREE.Vector2(r, yy));
  const geo = new THREE.LatheGeometry(profile, 36);
  geo.scale(w, 0.14, d);
  b.add(geo, f, 0, y, 0.02);
}

/** A basin mixer: a column, its spout and lever. */
export function tapBasin(b: Builder, x: number, y: number, z: number, m: THREE.Material, h = 0.16) {
  b.cyl(0.018, 0.02, h, x, y, z, m, 14);
  b.rod(v(x, y + h - 0.012, z), v(x, y + h - 0.025, z + 0.13), 0.011, m, 8);
  b.rod(v(x, y + h + 0.005, z - 0.005), v(x, y + h + 0.02, z - 0.07), 0.006, m, 6);
}

/** Overhead rain shower on an arm, a mixer, and optionally a hand shower on a rail. */
export function showerSet(b: Builder, x: number, h: number, z: number, m: THREE.Material, hand: boolean) {
  b.rod(v(x, h - 0.1, z), v(x, h - 0.1, z + 0.3), 0.01, m, 8);
  b.cyl(0.13, 0.13, 0.012, x, h - 0.12, z + 0.3, m, 32);
  b.cyl(0.035, 0.035, 0.05, x, 1.05, z + 0.02, m, 14).rotation.x = Math.PI / 2;
  if (hand) {
    b.rod(v(x + 0.25, 0.9, z + 0.025), v(x + 0.25, 1.7, z + 0.025), 0.01, m, 8);
    b.cyl(0.03, 0.022, 0.2, x + 0.25, 1.35, z + 0.05, m, 12);
  }
}

/** A walk-in shower: flush tiled floor, linear drain, one glass panel, its brace. */
export function walkIn(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, large: boolean) {
  b.box(w, 0.02, d, 0, 0, 0, tileMaterial(), 0);
  b.box(w - 0.2, 0.004, 0.06, 0, 0.02, back(d) + 0.08, mat("#8e9398", { metalness: 0.5, roughness: 0.4 }));
  const gw = w * (large ? 0.5 : 0.62);
  b.box(gw, h - 0.02, 0.01, -w / 2 + gw / 2, 0.02, d / 2 - 0.02, glass());
  b.box(gw, 0.02, 0.02, -w / 2 + gw / 2, 0.02, d / 2 - 0.02, f);
  b.box(0.02, 0.02, 0.02, -w / 2 + gw, h - 0.3, d / 2 - 0.02, f);
  b.rod(v(-w / 2 + gw - 0.01, h - 0.1, d / 2 - 0.02), v(-w / 2 + gw - 0.01, h - 0.1, back(d)), 0.01, f, 6);
  showerSet(b, -w / 4, h, back(d), a, true);
  if (large) {
    showerSet(b, w / 4, h, back(d), a, false);
    b.box(0.4, 0.45, d - 0.1, w / 2 - 0.22, 0.02, 0, surface("oak", 0.7), 0.02);
  }
}

/** Small square tiles with grout, for showers and tub aprons. */
let tiles: THREE.MeshStandardMaterial | undefined;
export function tileMaterial(): THREE.MeshStandardMaterial {
  if (tiles) return tiles;
  if (typeof document === "undefined") return mat("#d9dad6", { roughness: 0.5 });
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#bdbfbb";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    ctx.fillStyle = (i + j) % 3 ? "#dcddd9" : "#d6d7d3";
    ctx.fillRect(i * 32 + 1, j * 32 + 1, 30, 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tiles = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  return tiles;
}

/** A glowing bulb. */
export function bulb(b: Builder, x: number, y: number, z: number, r: number) {
  b.sphere(r, x, y, z, glowMat(), 1, 1.15, 1, 14);
}
export const glowMat = () => glowing(mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.8, side: THREE.DoubleSide }));
/** Opal glass: lit from within. */
export const opal = () => glowing(mat("#e6e1d6", { emissive: "#fff1d6", emissiveIntensity: 0.12, roughness: 0.5, side: THREE.DoubleSide }));

/** Woven rattan or wicker, see-through-ish and double-sided. */
export const wicker = new Map<string, THREE.MeshStandardMaterial>();
export function wickerMat(color: string): THREE.MeshStandardMaterial {
  let m = wicker.get(color);
  if (m) return m;
  const base = new THREE.Color(FINISHES[color] ?? FINISHES.sand);
  if (typeof document === "undefined") m = mat(base.getStyle(), { side: THREE.DoubleSide, roughness: 1 });
  else {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = base.clone().multiplyScalar(0.6).getStyle();
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++) {
        ctx.fillStyle = base.clone().multiplyScalar((i + j) % 2 ? 1 : 0.85).getStyle();
        if ((i + j) % 2) ctx.fillRect(i * 8 + 1, j * 8, 6, 8);
        else ctx.fillRect(i * 8, j * 8 + 1, 8, 6);
      }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 3);
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide });
  }
  wicker.set(color, m);
  return m;
}

/** A front-loading washer or dryer: body, control strip with a dial, round door. */
export function laundry(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, kind: "washer" | "dryer") {
  b.box(w, h, d, 0, 0, 0, f, 0.015);
  b.box(w - 0.02, 0.1, 0.01, 0, h - 0.12, d / 2, mat(kind === "washer" ? C.ceramic : "#dfe3e6"), 0.004);
  b.cyl(0.03, 0.03, 0.02, w * 0.3, h - 0.07, d / 2 + 0.01, a, 20).rotation.x = Math.PI / 2;
  b.box(0.12, 0.035, 0.006, -w * 0.05, h - 0.085, d / 2 + 0.006, mat(C.screen), 0.004);
  b.box(0.1, 0.03, 0.01, -w * 0.32, h - 0.08, d / 2 + 0.005, mat("#cfd3d6"), 0.004);
  const r = Math.min(w * 0.33, (h - 0.16) * 0.4);
  const cy = (h - 0.14) * 0.48;
  b.add(new THREE.TorusGeometry(r, 0.028, 10, 36), a, 0, cy, d / 2 + 0.012);
  b.add(new THREE.CircleGeometry(r * 0.94, 36), mat(kind === "washer" ? "#2c3e48" : "#3a3f44", { roughness: 0.1, metalness: 0.3 }), 0, cy, d / 2 + 0.006);
  b.add(new THREE.CircleGeometry(r * 0.7, 36), mat("#8e9398", { metalness: 0.6, roughness: 0.4 }), 0, cy, d / 2 + 0.003);
  // the drum's paddles, turning while it runs
  b.spinner(0, cy, d / 2 + 0.004, "z", () => {
    for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.03, r * 0.4, 0.004).translate(0, r * 0.45, 0), mat("#6c7176", { metalness: 0.5 }), 0, cy, d / 2 + 0.004).rotation.z = (i / 3) * Math.PI * 2;
  });
  b.box(0.012, 0.012, 0.004, w * 0.12, h - 0.07, d / 2 + 0.007, ledMat());
}

/** A thin green stem from a to b (merged with the leaves). */
export function stem(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r: number, color: string) {
  const len = a.distanceTo(c);
  b.batch(new THREE.CylinderGeometry(r * 0.8, r, len, 5), mat(color), new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), c.clone().sub(a).normalize()), v(1, 1, 1)));
}

/** A palm in a pot: arching fronds with leaflets on both sides. */
export function palm(b: Builder, w: number, d: number, h: number, f: THREE.Material, seed: number, o: { fronds: number; leaflets: number; droop: number; color: string[]; width: number }) {
  const rand = random(seed);
  const ph = 0.34;
  pot(b, Math.min(w, d) * 0.25, ph, f);
  for (let s = 0; s < o.fronds; s++) {
    const a = (s / o.fronds) * Math.PI * 2 + rand() * 0.4;
    const len = (h - ph) * (0.8 + rand() * 0.25);
    const out = (Math.min(w, d) / 2) * (0.7 + rand() * 0.3);
    const curve = new THREE.QuadraticBezierCurve3(v(0, ph, 0), v(Math.cos(a) * out * 0.25, ph + len, Math.sin(a) * out * 0.25), v(Math.cos(a) * out, ph + len * (1 - o.droop * 0.5), Math.sin(a) * out));
    b.batch(new THREE.TubeGeometry(curve, 10, 0.007, 4, false), mat("#4d6a35"));
    for (let k = 4; k < o.leaflets; k++) {
      const t = k / o.leaflets;
      const p = curve.getPoint(t);
      for (const side of [-1, 1]) b.batch(leafGeometry(0.3 * (1 - t * 0.5), o.width, 0.5), leafMat(o.color[k % o.color.length]), matrix(p.x, p.y, p.z, -1.3 - t * 0.6 * o.droop, -a - Math.PI / 2 + side * 1.0, side * 0.5));
    }
  }
}

/** Ribs around a round shape (cacti): pushes vertices out and in around y. */
export function ribs(geo: THREE.BufferGeometry, n: number, depth: number) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + depth * Math.cos(ang * n);
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
}

/** A ribbed column with a rounded top (a cactus stem), from y up by len. */
export function ribbed(b: Builder, r: number, len: number, x: number, y: number, z: number) {
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 6, 20);
  ribs(geo, 10, 0.08);
  b.add(geo, mat("#4f7a45", { roughness: 0.9 }), x, y + len / 2, z);
}

/** A succulent rosette: rings of fat pointed leaves. */
export function rosette(b: Builder, x: number, y: number, z: number, r: number, color: string, rand: () => number) {
  for (let ring = 0; ring < 3; ring++)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + ring * 0.45;
      const leaf = new THREE.SphereGeometry(r * (0.55 - ring * 0.12), 8, 6);
      leaf.scale(0.6, 0.35, 1.2);
      leaf.translate(0, 0, r * (0.5 - ring * 0.12));
      b.batch(leaf, mat(color, { roughness: 0.6 }), matrix(x, y + ring * r * 0.25, z, -0.3 - ring * 0.35 - rand() * 0.1, a, 0));
    }
}

/**
 * A cupboard: doors (some mirrored), drawers below, boxes on top, a plinth or legs.
 * Handles in the accent.
 */
export function cupboard(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, o: { doors?: number; drawers?: number; columns?: number; mirror?: number[]; top?: boolean; legs?: boolean }) {
  const base = o.legs ? 0.14 : 0.08;
  b.box(w, h - base, d - 0.02, 0, base, back(d) + (d - 0.02) / 2, f, o.legs ? 0.01 : 0);
  if (o.legs) legs(b, w - 0.04, d - 0.06, base, 0.04, 0.016, a);
  else b.box(w - 0.02, base, d - 0.06, 0, 0, back(d) + (d - 0.06) / 2, mat(C.black));
  const z = d / 2 - 0.02;
  const doors = o.doors ?? Math.max(1, Math.round(w / 0.5));
  const drawerH = 0.2;
  const drawers = o.drawers ?? 0;
  const topH = o.top ? Math.min(0.45, h * 0.18) : 0;
  let y = base;
  if (drawers) {
    const dh = doors ? drawers * drawerH : h - base;
    fronts(b, -w / 2, w, y, dh, z, o.columns ?? (doors ? Math.max(1, Math.min(doors, Math.round(w / 0.8))) : 1), f, drawers, "bar", a);
    y += dh;
  }
  if (doors) {
    const dh = h - y - topH;
    fronts(b, -w / 2, w, y, dh, z, doors, f, 1, "bar", a);
    for (const i of o.mirror ?? []) {
      if (i >= doors) continue;
      const cw = w / doors;
      b.box(cw - 0.08, dh - 0.16, 0.004, -w / 2 + cw * (i + 0.5), y + 0.08, z + 0.02, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }));
    }
    y += dh;
  }
  if (topH) fronts(b, -w / 2, w, y, topH, z, doors, f, 1, "knob", a);
}

/** Flames and embers in a fire opening (glowing). */
export function fire(b: Builder, w: number, y: number, z: number, h: number) {
  const rand = random(277);
  b.box(w, 0.03, 0.04, 0, y, z, mat("#3a2a20"));
  for (let i = 0; i < Math.max(3, Math.round(w / 0.08)); i++) {
    const x = -w / 2 + (w * (i + 0.5)) / Math.max(3, Math.round(w / 0.08));
    const fh = h * (0.4 + rand() * 0.6);
    b.add(new THREE.ConeGeometry(0.035, fh, 6), part(mat(i % 2 ? "#ffb347" : "#ff7a2e", { emissive: i % 2 ? "#ff9a2a" : "#ff5a1a", emissiveIntensity: 0.9 }), "fire"), x, y + 0.03 + fh / 2, z + (rand() - 0.5) * 0.04);
  }
}

/** A piano keyboard: white keys and the black ones in their groups. */
export function keys(b: Builder, w: number, y: number, z: number) {
  b.box(w, 0.025, 0.15, 0, y, z, mat("#f6f4ee"), 0.002);
  const white = Math.max(14, Math.round(w / 0.0235));
  const kw = w / white;
  for (let i = 0; i < white - 1; i++) {
    b.box(0.0015, 0.026, 0.15, -w / 2 + kw * (i + 1), y, z, mat("#bdbab2"));
    if ([0, 1, 3, 4, 5].includes(i % 7)) b.box(kw * 0.55, 0.018, 0.09, -w / 2 + kw * (i + 1), y + 0.025, z - 0.03, mat("#141414"));
  }
}

/** An abstract print: a few soft shapes in a palette around a colour. */
export function art(b: Builder, w: number, h: number, y0: number, z: number, color: string) {
  const rand = random(color.length * 31 + Math.round(w * 100));
  const base = new THREE.Color(FINISHES[color] ?? FINISHES.terracotta);
  const tones = [base, base.clone().lerp(new THREE.Color("#ffffff"), 0.45), base.clone().lerp(new THREE.Color("#1c1c1c"), 0.35), new THREE.Color("#d9c9a8")];
  for (let i = 0; i < 4; i++) {
    const m = mat(tones[i].getStyle(), { roughness: 1 });
    const x = (rand() - 0.5) * w * 0.5;
    const y = y0 + h * (0.25 + rand() * 0.5);
    if (i % 2) b.add(new THREE.CircleGeometry(Math.min(w, h) * (0.15 + rand() * 0.15), 28), m, x, y, z + i * 0.0005);
    else b.add(new THREE.PlaneGeometry(w * (0.3 + rand() * 0.4), h * (0.2 + rand() * 0.3)), m, x, y, z + i * 0.0005);
  }
}

export function bed(b: Builder, w: number, d: number, h: number, f: THREE.Material, legM: THREE.Material) {
  // an upholstered frame and headboard, mattress, duvet and pillows
  b.box(w, 0.28, d - 0.08, 0, 0.06, 0.04, f, 0.04);
  b.box(w + 0.04, h, 0.1, 0, 0.06, back(d) + 0.05, f, 0.04);
  b.box(w - 0.06, 0.2, d - 0.16, 0, 0.32, 0.06, mat(C.mattress), 0.05);
  b.box(w - 0.02, 0.07, (d - 0.12) * 0.68, 0, 0.5, d / 2 - ((d - 0.12) * 0.68) / 2 - 0.02, mat(C.linen, { roughness: 1 }), 0.035);
  b.box(w - 0.02, 0.04, 0.3, 0, 0.53, d / 2 - (d - 0.12) * 0.68 + 0.12, mat(C.linen, { roughness: 1 }), 0.02);
  const n = w > 1.2 ? 2 : 1;
  for (let i = 0; i < n; i++) b.box(w / n - 0.14, 0.13, 0.36, -w / 2 + (w / n) * (i + 0.5), 0.5, back(d) + 0.33, mat(C.pillow), 0.06);
  legs(b, w, d - 0.08, 0.06, 0.08, 0.02, legM);
}

export function vanity(b: Builder, w: number, d: number, h: number, f: THREE.Material, basins: number, tap: THREE.Material, square = false) {
  // a cabinet on the wall and basins on a ceramic top: a white rim round a grey bowl
  b.box(w, 0.42, d - 0.02, 0, h - 0.47, back(d) + (d - 0.02) / 2, f, 0.006);
  fronts(b, -w / 2, w, h - 0.47, 0.42, d / 2 - 0.02, basins, f, 2, "bar");
  b.box(w + 0.01, 0.05, d, 0, h - 0.05, 0, mat(C.ceramic), 0.01);
  for (let i = 0; i < basins; i++) {
    const x = -w / 2 + (w / basins) * (i + 0.5);
    const bw = Math.min(0.5, w / basins - 0.12);
    flat(b, bw, d - 0.16, h, 0.03, mat(C.ceramic, { roughness: 0.25 }), square, 0.1).position.x = x;
    flat(b, bw - 0.05, d - 0.21, h + 0.102, 0.03, mat("#b9bdc1", { roughness: 0.35 }), square).position.x = x;
    b.cyl(0.022, 0.022, 0.004, x, h + 0.104, 0.03, mat(C.steel, { metalness: 0.7, roughness: 0.3 }), 12);
    tapBasin(b, x, h, back(d) + 0.06, tap, 0.24);
  }
}

/** Blades of grass on a patch, from height y. */
export function grass(b: Builder, rand: () => number, w: number, d: number, h: number, y: number, count: number, colors: string[], fountain = false) {
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * w * (fountain ? 0.4 : 1);
    const z = (rand() - 0.5) * d * (fountain ? 0.4 : 1);
    const len = h * (0.6 + rand() * 0.4);
    const blade = new THREE.BufferGeometry();
    const bw = 0.012;
    // curved: three segments leaning outwards
    const lean = fountain ? 0.6 + rand() * 0.5 : rand() * 0.4;
    const a = rand() * Math.PI * 2;
    const pts: number[] = [];
    const seg = 3;
    for (let s = 0; s < seg; s++) {
      const t0 = s / seg;
      const t1 = (s + 1) / seg;
      const p = (t: number) => [Math.cos(a) * lean * len * t * t, len * t, Math.sin(a) * lean * len * t * t];
      const [a0, b0] = [p(t0), p(t1)];
      const w0 = bw * (1 - t0);
      const w1 = bw * (1 - t1);
      pts.push(a0[0] - w0, a0[1], a0[2], a0[0] + w0, a0[1], a0[2], b0[0] + w1, b0[1], b0[2], a0[0] - w0, a0[1], a0[2], b0[0] + w1, b0[1], b0[2], b0[0] - w1, b0[1], b0[2]);
    }
    blade.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    blade.computeVertexNormals();
    b.batch(blade, leafMat(colors[i % colors.length]), matrix(x, y, z, 0, rand() * 6));
  }
}

/**
 * A grown deciduous tree: the trunk splits into limbs, limbs into branches, and leaves sit
 * in clusters at the branch ends, with gaps between them so the branches show.
 */
export function tree(b: Builder, w: number, d: number, h: number, seed: number, kind: "round" | "birch" | "fruit" | "autumn") {
  const rand = random(seed);
  const birch = kind === "birch";
  const fruit = kind === "fruit";
  const bark = finishLook(birch ? "bark_birch" : "bark");
  const barkMat = bark.map ? new THREE.MeshStandardMaterial({ map: bark.map, roughness: 1 }) : mat(birch ? C.birch : C.trunk);
  const colors = fruit ? [C.leaf, C.leafLight, C.leafDark] : birch ? [C.leafLight, C.leafYellow, C.leaf] : kind === "autumn" ? ["#c98a3a", "#b5562e", "#d9b04a"] : [C.leaf, C.leafDark, "#3f7037"];
  const trunkH = h * (birch ? 0.32 : fruit ? 0.22 : 0.24);
  const trunkR = Math.max(0.05, Math.min(w, d) * (birch ? 0.022 : 0.035));
  const crownR = Math.min(w, d) / 2;
  // the branches first in a frame of their own, then fitted into the crown
  const wood = new Builder();
  const tips: THREE.Vector3[] = [];
  const knots: THREE.Vector3[] = [];
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    wood.rod(from, to, r, barkMat, depth > 1 ? 7 : 5);
    if (depth === 0) {
      tips.push(to);
      return;
    }
    if (depth === 1) knots.push(to);
    const n = depth === 3 ? (birch ? 3 : 4) : 2 + (rand() > 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      // spread round the parent and outwards, always reaching up a little
      const az = (k / n) * Math.PI * 2 + rand() * 0.9;
      const tilt = (depth === 3 ? (birch ? 0.35 : fruit ? 0.8 : 0.6) : 0.45) + rand() * 0.3;
      const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const next = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(out, Math.sin(tilt)).add(v(0, 0.3, 0)).normalize();
      grow(to, next, len * (0.68 + rand() * 0.14), r * 0.62, depth - 1);
    }
  };
  b.cyl(trunkR * 0.8, trunkR * 1.25, trunkH, 0, 0, 0, barkMat, 10);
  grow(v(0, trunkH * 0.98, 0), v(0, 1, 0), (h - trunkH) * 0.32, trunkR * 0.75, 3);
  // as wide and tall as the box allows (leaves reach a little further)
  const spread = Math.max(...tips.map((t) => Math.hypot(t.x, t.z)), 0.1);
  const height = Math.max(...tips.map((t) => t.y), trunkH + 0.1) - trunkH;
  const kx = (crownR * 0.72) / spread;
  const ky = Math.min(2, (h * 0.84 - trunkH) / height);
  const branches = wood.done();
  branches.scale.set(kx, ky, kx);
  branches.position.y = trunkH * (1 - ky);
  b.g.add(branches);
  const place = (p: THREE.Vector3) => v(p.x * kx, trunkH + (p.y - trunkH) * ky, p.z * kx);
  const leafSize = birch ? 0.09 : 0.14;
  const cr = crownR * (birch ? 0.24 : 0.3);
  for (const t of tips.map(place)) foliage(b, rand, t.x, t.y, t.z, cr, cr * 0.7, cr, birch ? 55 : 70, leafSize, colors, false);
  for (const t of knots.map(place)) foliage(b, rand, t.x, t.y, t.z, cr * 0.8, cr * 0.6, cr * 0.8, birch ? 30 : 45, leafSize, colors, false);
  if (fruit) for (let i = 0; i < 30; i++) {
    const t = place(tips[Math.floor(rand() * tips.length)]);
    b.batch(new THREE.SphereGeometry(0.045, 8, 6), mat("#c8382c"), matrix(t.x + (rand() - 0.5) * 0.5, t.y - 0.1 - rand() * 0.3, t.z + (rand() - 0.5) * 0.5));
  }
}

// ----- rugs: woven patterns on a canvas -----

export const rugTextures = new Map<string, THREE.Material>();
export function rugMaterial(pattern: "border" | "rings" | "stripes" | "persian" | "berber", color: string, fallback: THREE.Material): THREE.Material {
  const key = `${pattern}/${color}`;
  let m = rugTextures.get(key);
  if (m) return m;
  if (typeof document === "undefined") return fallback;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const base = new THREE.Color(FINISHES[color] ?? "#d6c9b2");
  const light = base.clone().lerp(new THREE.Color("#ffffff"), 0.45).getStyle();
  const dark = base.clone().lerp(new THREE.Color("#000000"), 0.35).getStyle();
  ctx.fillStyle = base.getStyle();
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = light;
  if (pattern === "border") {
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, 220, 220);
    ctx.lineWidth = 3;
    ctx.strokeStyle = dark;
    ctx.strokeRect(36, 36, 184, 184);
  } else if (pattern === "rings") {
    for (const [r, wdt, col] of [[118, 6, light], [95, 3, dark], [60, 5, light]] as const) {
      ctx.lineWidth = wdt;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(128, 128, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (pattern === "persian") {
    // borders, a medallion, small motifs scattered over the field
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = base.getStyle();
    ctx.fillRect(22, 22, 212, 212);
    ctx.strokeStyle = light;
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, 232, 232);
    ctx.strokeRect(30, 30, 196, 196);
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(128, 70);
    ctx.lineTo(186, 128);
    ctx.lineTo(128, 186);
    ctx.lineTo(70, 128);
    ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(128, 128, 24, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        if ((i === 1 || i === 2) && (j === 1 || j === 2)) continue;
        ctx.fillStyle = (i + j) % 2 ? light : dark;
        ctx.fillRect(52 + i * 46, 52 + j * 46, 10, 10);
      }
  } else if (pattern === "berber") {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3;
    for (let x = -256; x < 512; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 128, 128);
      ctx.lineTo(x, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 24, 0);
      ctx.lineTo(x - 104, 128);
      ctx.lineTo(x + 24, 256);
      ctx.stroke();
    }
  } else {
    for (let y = 0; y < 256; y += 32) {
      ctx.fillStyle = (y / 32) % 2 ? light : dark;
      ctx.fillRect(0, y + 10, 256, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  rugTextures.set(key, m);
  return m;
}

// ----- surfaces: the shared finishes (render/finishes.ts) for wood, stone and concrete -----

/** Furniture finishes that are surface finishes too (the same texture on a floor or a sideboard). */
export const SHARED: Record<string, string> = { oak: "veneer_oak", walnut: "veneer_walnut", marble: "marble", concrete: "concrete", terrazzo: "terrazzo" };
export const surfaces = new Map<string, THREE.MeshStandardMaterial>();
/** A finish as a material: textured where it is a material (wood, stone), else plain. */
export function surface(color: string, roughness: number): THREE.MeshStandardMaterial {
  const shared = SHARED[color];
  if (!shared || typeof document === "undefined") return mat(FINISHES[color] ?? color, { roughness });
  const key = `${color}/${roughness}`;
  let m = surfaces.get(key);
  if (!m) {
    const look = finishLook(shared);
    surfaces.set(key, (m = look.map ? new THREE.MeshStandardMaterial({ map: look.map, roughness }) : mat(FINISHES[color], { roughness })));
  }
  return m;
}

export const fabricMats = new Map<string, THREE.MeshStandardMaterial>();
/** Upholstery: the finish's colour woven (one material per colour). */
export function fabricMat(color: string, map: THREE.Texture): THREE.MeshStandardMaterial {
  let m = fabricMats.get(color);
  if (!m) fabricMats.set(color, (m = new THREE.MeshStandardMaterial({ map, roughness: 1 })));
  return m;
}

/**
 * A Modern piece in its own frame, or null for an unknown kind. `finish` and `accent`
 * name FINISHES (default: the kind's first finish and accent).
 */
/**
 * The pieces: the ones above, each part file's (modern/*.ts) replacing those of the same
 * key with more detailed ones.
 */
const BUILDERS: Record<string, Build> = {
  ...BASE_BUILDERS,
  ...CAR_HATCHBACK,
  ...CAR_ESTATE,
  ...CAR_SUV,
  ...CAR_VAN,
  ...CAR_SPORTS,
  ...VEHICLES,
  ...LIVING_SEATING,
  ...LIVING_REST,
  ...DINING,
  ...KITCHEN,
  ...BEDROOM_KIDS,
  ...BATHROOM,
  ...PLANTS,
  ...OUTSIDE,
  ...GARDEN,
  ...LIGHTING,
  ...OFFICE_SMART,
  ...CLIMATE_UTILITY,
  ...HALL_DECOR,
  ...HOBBY,
};

export function buildModern(name: string, size: [number, number], height: number, finish?: string, accent?: string, chosen: Record<string, string> = {}): THREE.Group | null {
  // an older name stands for a piece with options
  const { id: kind, options } = resolveKind(name, chosen);
  const def = MODERN[kind];
  const build = BUILDERS[kind];
  if (!def || !build) return null;
  const color = finish && FINISHES[finish] ? finish : def.finishes[0];
  const accentColor = accent && FINISHES[accent] && def.accents ? accent : (def.accents?.[0] ?? "black");
  // only the options the piece offers, with values it knows
  const b = new Builder(Object.fromEntries(Object.entries(options).filter(([k, val]) => def.options?.[k]?.includes(val))));
  const fabricLike =
    ["sofa", "armchair", "bed", "rug"].includes(def.type) || kind.startsWith("sofa") || def.finishes === FABRIC || ["garden_sofa", "chair_office", "curtains", "dog_bed", "lounge_ottoman", "gaming_chair"].includes(kind);
  const fabric = fabricLike && !SHARED[color] ? fabricTexture(FINISHES[color]) : null;
  const finishMat = fabric ? fabricMat(color, fabric) : surface(color, fabricLike ? 1 : color === "marble" || color === "white" ? 0.5 : 0.75);
  const metal = ["brass", "chrome", "silver"].includes(accentColor);
  const accentMat = metal ? mat(FINISHES[accentColor], { metalness: 0.7, roughness: 0.3 }) : surface(accentColor, 0.7);
  build(b, size[0], size[1], height, finishMat, color, accentMat, accentColor);
  const piece = b.done();
  // never larger than asked for and never below the floor: squeeze and lift what sticks
  // out (taps, leaves, a sofa's fixed seat height in a lower box)
  // parts drawn above the piece (b.above) don't count
  const box = new THREE.Box3();
  piece.updateMatrixWorld(true);
  piece.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (let p: THREE.Object3D | null = o; p && p !== piece; p = p.parent) if (p.userData.above) return;
    box.expandByObject(o);
  });
  if (box.isEmpty()) return piece;
  const bottom = Math.min(0, box.min.y);
  const got = box.getSize(new THREE.Vector3());
  const fit = (want: number, have: number) => (have > want * 1.04 + 0.04 ? want / have : 1);
  const sx = fit(size[0], got.x);
  const sy = fit(height, box.max.y - bottom);
  const sz = fit(size[1], got.z);
  if (sx === 1 && sy === 1 && sz === 1 && bottom === 0) return piece;
  const centre = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  piece.position.set(-centre.x, -bottom, -centre.z);
  inner.add(piece);
  inner.scale.set(sx, sy, sz);
  inner.position.set(centre.x * sx, 0, centre.z * sz);
  const outer = new THREE.Group();
  outer.add(inner);
  return outer;
}
