// The "Modern" furniture, drawn in code and fitted to each piece's size (see
// model/modern.ts). Pieces are built in their own frame: centred, the back at -z, the
// front at +z, standing on y = 0 (wall pieces from their bottom, ceiling pieces hang
// from y = height). Loaded only by cards whose house uses one.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FABRIC, FINISHES, MODERN } from "../model/modern";
import { fabricTexture, finishLook } from "./finishes";

// ----- materials (shared, so a card converts each once) -----

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(extra);
  let m = materials.get(key);
  if (!m) materials.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra })));
  return m;
}
const C = {
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
const glass = () => mat("#cfe3ea", { transparent: true, opacity: 0.3, roughness: 0.1 });
const leafMat = (color: string) => mat(color, { side: THREE.DoubleSide, roughness: 0.9 });

/** Deterministic randomness: the same piece looks the same every time. */
function random(seed: number) {
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

class Builder {
  readonly g = new THREE.Group();
  /** Geometries merged per material at the end (plants: thousands of leaves, one mesh). */
  private batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  /** Where new meshes go: the piece, or a part being drawn (see spinner). */
  private into: THREE.Object3D = this.g;

  add(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
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
    // only positions and normals: every batch merges
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
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

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const matrix = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")), v(s, s, s));

/** Four legs inset from the corners. */
function legs(b: Builder, w: number, d: number, h: number, inset: number, r: number, m: THREE.Material, square = false) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset);
      const z = sz * (d / 2 - inset);
      if (square) b.box(r * 2, h, r * 2, x, 0, z, m);
      else b.cyl(r, r * 0.8, h, x, 0, z, m, 10);
    }
}

/** A flat leaf outline (base at 0, tip at +y), bent backwards along its length. */
function leafGeometry(len: number, width: number, bend: number, holes = 0): THREE.BufferGeometry {
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
function smallLeaf(size: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const s = size;
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, s * 0.35, s * 0.5, 0.02 * s, 0, s, 0, 0, 0, 0, 0, s, 0, -s * 0.35, s * 0.5, 0.02 * s], 3));
  geo.computeVertexNormals();
  return geo;
}

/** A pot with soil (lathe profile), `r` its top radius. */
function pot(b: Builder, r: number, h: number, m: THREE.Material, y = 0) {
  const pts = [v(0, 0, 0), v(r * 0.72, 0, 0), v(r * 0.78, h * 0.08, 0), v(r, h * 0.92, 0), v(r * 0.96, h, 0), v(r * 0.9, h, 0), v(r * 0.86, h * 0.9, 0), v(0, h * 0.86, 0)].map((p) => new THREE.Vector2(p.x, p.y));
  b.add(new THREE.LatheGeometry(pts, 28), m, 0, y, 0);
  b.cyl(r * 0.88, r * 0.88, 0.01, 0, y + h * 0.86, 0, mat(C.soil), 24);
}

/** Leaves scattered in a ball (trees, shrubs, hedges); `fill` darkens the inside. */
function foliage(b: Builder, rand: () => number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, leafSize: number, colors: string[], fill = true) {
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

type Build = (b: Builder, w: number, d: number, h: number, finish: THREE.MeshStandardMaterial, color: string, accent: THREE.MeshStandardMaterial, accentColor: string) => void;

const back = (d: number) => -d / 2;

/** Seats of a sofa along x from x0, `n` cushions. */
function sofaSeats(b: Builder, x0: number, len: number, z0: number, depth: number, fabric: THREE.Material, backrest: boolean, n = Math.max(1, Math.round(len / 0.8))) {
  const cw = len / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + cw * (i + 0.5);
    b.box(cw - 0.015, 0.17, depth - (backrest ? 0.2 : 0.04), x, 0.24, z0 + (backrest ? 0.1 : 0), fabric, 0.05);
    if (backrest) b.box(cw - 0.02, 0.42, 0.2, x, 0.38, z0 - depth / 2 + 0.12, fabric, 0.07);
  }
}

function sofa(b: Builder, w: number, d: number, fabric: THREE.Material, corner: "none" | "l" | "chaise", legM: THREE.Material) {
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
function fronts(b: Builder, x0: number, w: number, y0: number, h: number, z: number, n: number, m: THREE.Material, rows = 1, handle?: "bar" | "knob", handleM: THREE.Material = mat(C.black)) {
  const cw = w / n;
  const rh = h / rows;
  // dark joints between fronts: they show even where the fronts sit flush in the carcass
  const joint = mat("#26272a", { roughness: 1 });
  for (let i = 1; i < n; i++) b.box(0.005, h, 0.02, x0 + cw * i, y0, z + 0.0105, joint);
  for (let r = 1; r < rows; r++) b.box(w, 0.005, 0.02, x0 + w / 2, y0 + rh * r - 0.0025, z + 0.0105, joint);
  for (let i = 0; i < n; i++)
    for (let r = 0; r < rows; r++) {
      b.box(cw - 0.004, rh - 0.004, 0.018, x0 + cw * (i + 0.5), y0 + rh * r + 0.002, z + 0.009, m, 0.003);
      if (handle === "bar") b.box(rows > 1 ? Math.min(0.2, cw * 0.4) : 0.012, rows > 1 ? 0.012 : Math.min(0.3, rh * 0.25), 0.02, x0 + cw * (i + 0.5) + (rows > 1 ? 0 : (i % 2 ? -1 : 1) * (cw / 2 - 0.05)), y0 + rh * r + (rows > 1 ? rh - 0.06 : rh * 0.5), z + 0.028, handleM);
      if (handle === "knob") b.sphere(0.015, x0 + cw * (i + 0.5), y0 + rh * (r + 0.5), z + 0.03, handleM, 1, 1, 1, 8);
    }
}

function shelves(b: Builder, w: number, d: number, h: number, m: THREE.Material, count: number, rand: () => number, withBooks = true) {
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
function glowing<M extends THREE.Material>(m: M): M {
  m.userData.glow = true;
  return m;
}
/**
 * Marks a material as a part a linked device drives (scene.ts linkDevice): a screen that
 * lights up while it plays, flames that burn while it is on, a status light. Unlinked
 * pieces keep the look they are drawn with.
 */
function part<M extends THREE.Material>(m: M, role: "screen" | "fire" | "led" | "warm"): M {
  m.userData.part = role;
  return m;
}
/** A 240 l wheelie bin at x: a tapering body, the lid in its own colour, wheels at the back. */
function wheelieBin(b: Builder, x: number, bw: number, d: number, h: number, body: THREE.Material, lid: THREE.Material) {
  const geo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.88, 1, 4, 1, false, Math.PI / 4);
  geo.scale(bw, h - 0.12, d - 0.05);
  b.add(geo, body, x, (h - 0.12) / 2 + 0.04, 0);
  b.box(bw + 0.03, 0.04, d, x, h - 0.08, 0.01, lid, 0.01);
  for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), mat(C.black), x + sx * (bw / 2 - 0.02), 0.1, -d / 2 + 0.1).rotation.z = Math.PI / 2;
  b.rod(v(x - bw * 0.4, h - 0.05, -d / 2 + 0.01), v(x + bw * 0.4, h - 0.05, -d / 2 + 0.01), 0.015, body, 6);
}

/** A radiator's thermostatic valve: the pipe and a white head with ribs. */
function radiatorValve(b: Builder, x: number, y: number, z: number) {
  b.cyl(0.01, 0.01, 0.06, x - 0.03, y, z, mat(C.chrome), 10).rotation.z = Math.PI / 2;
  b.cyl(0.024, 0.024, 0.07, x, y - 0.035, z, mat(C.ceramic), 16);
  b.cyl(0.026, 0.026, 0.01, x, y + 0.02, z, mat("#d9d9d6"), 16);
}

/** A copy of a finish that glows warm while its heating runs (radiators). */
const warmMat = <M extends THREE.Material>(f: M) => part(f.clone() as M, "warm");
const screenMat = () => part(mat(C.screen, { roughness: 0.15, metalness: 0.2, name: "screen" }), "screen");
const ledMat = (color = "#3fd27a") => part(mat(color, { emissive: color, emissiveIntensity: 0.7, name: "led" }), "led");
const shadeMat = (_finish: THREE.Material, color: string) =>
  ["black", "anthracite"].includes(color) ? mat(FINISHES[color], { side: THREE.DoubleSide }) : glowing(mat(C.shade, { side: THREE.DoubleSide }));

const BUILDERS: Record<string, Build> = {
  sofa: (b, w, d, _h, f, _c, a) => sofa(b, w, d, f, "none", a),
  garden_sofa: (b, w, d, _h, f, _c, a) => {
    // a frame of slats and thick cushions
    const frame = a;
    b.box(w, 0.3, d, 0, 0.05, 0, frame, 0.01);
    b.box(w, 0.35, 0.08, 0, 0.35, back(d) + 0.04, frame, 0.01);
    for (const sx of [-1, 1]) b.box(0.08, 0.3, d, sx * (w / 2 - 0.04), 0.35, 0, frame, 0.01);
    sofaSeats(b, -w / 2 + 0.08, w - 0.16, 0.04, d - 0.08, f, true);
    legs(b, w, d, 0.05, 0.05, 0.02, frame, true);
  },
  sofa_corner: (b, w, d, _h, f, _c, a) => sofa(b, w, d, f, "l", a),
  sofa_chaise: (b, w, d, _h, f, _c, a) => sofa(b, w, d, f, "chaise", a),
  armchair: (b, w, d, _h, f, _c, a) => {
    b.box(w, 0.26, d, 0, 0.12, 0, f, 0.06);
    b.box(w, 0.46, 0.16, 0, 0.3, back(d) + 0.08, f, 0.07);
    for (const sx of [-1, 1]) b.box(0.13, 0.3, d, sx * (w / 2 - 0.065), 0.3, 0, f, 0.06);
    b.box(w - 0.26, 0.14, d - 0.2, 0, 0.36, 0.08, f, 0.05);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.08), 0.13, sz * (d / 2 - 0.08)), v(sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04)), 0.014, a);
  },
  coffee_table: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.035, d, 0, h - 0.035, 0, f, 0.008);
    b.box(w - 0.1, 0.02, d - 0.1, 0, h * 0.3, 0, f, 0.004);
    legs(b, w, d, h - 0.035, 0.05, 0.016, a, true);
  },
  coffee_table_round: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.03, 0, h - 0.03, 0, f, 40);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      b.rod(v(Math.cos(a) * r * 0.55, h - 0.03, Math.sin(a) * r * 0.55), v(Math.cos(a) * r * 0.75, 0, Math.sin(a) * r * 0.75), 0.016, f);
    }
  },
  coffee_tables_nested: (b, w, d, h, f, _c, a) => {
    const r1 = Math.min(d / 2, w * 0.33);
    const r2 = r1 * 0.75;
    const metal = a;
    for (const [x, z, r, hh] of [[-w / 2 + r1, 0, r1, h * 0.85], [w / 2 - r2, d / 2 - r2, r2, h]] as const) {
      b.cyl(r, r, 0.025, x, hh - 0.025, z, f, 36);
      b.add(new THREE.TorusGeometry(r * 0.92, 0.008, 6, 36), metal, x, hh * 0.15, z).rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.box(0.012, hh - 0.025, 0.012, x + Math.cos(a) * r * 0.92, 0, z + Math.sin(a) * r * 0.92, metal);
      }
    }
  },
  coffee_table_block: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.03);
  },
  side_table: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.022, 0, h - 0.022, 0, f, 32);
    b.cyl(0.018, 0.018, h - 0.022, 0, 0, 0, a, 12);
    b.cyl(r * 0.6, r * 0.6, 0.015, 0, 0, 0, a, 28);
  },
  tv_board: (b, w, d, h, f, _c, a) => {
    b.box(w, h - 0.12, d, 0, 0.12, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.13, h - 0.14, d / 2 - 0.018, Math.max(2, Math.round(w / 0.6)), f, 1);
    legs(b, w, d, 0.12, 0.05, 0.012, a);
  },
  tv_board_wall: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.005, h - 0.01, d / 2 - 0.018, Math.max(2, Math.round(w / 0.6)), f, 1);
  },
  sideboard: (b, w, d, h, f) => {
    b.box(w, h - 0.15, d, 0, 0.15, 0, f, 0.008);
    fronts(b, -w / 2, w, 0.16, h - 0.17, d / 2 - 0.018, Math.max(2, Math.round(w / 0.45)), f, 1, "bar");
    legs(b, w, d, 0.15, 0.06, 0.014, f);
  },
  tv_stand: (b, w, d, h, f, c, a, ac) => {
    const board = Math.min(0.45, h * 0.35);
    BUILDERS.tv_board(b, w, d, board, f, c, a, ac);
    const tw = Math.min(w * 0.85, 1.45);
    const th = Math.min(h - board - 0.06, tw * 0.58);
    b.box(0.25, 0.012, 0.16, 0, board, 0, mat(C.black));
    b.box(0.05, 0.06, 0.03, 0, board, -0.02, mat(C.black));
    tvPanel(b, tw, th, board + 0.06, -0.02);
  },
  tv_wall: (b, w, _d, h) => tvPanel(b, w, h, 0, 0),
  soundbar: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, Math.min(h, d) * 0.45);
    b.pulser(0, h / 2, d / 2, () => b.box(w - 0.04, h * 0.7, 0.004, 0, h * 0.15, d / 2, mat(C.black, { roughness: 1 })));
  },
  speaker_floor: (b, w, d, h, f) => {
    b.box(w, h - 0.03, d, 0, 0.03, 0, f, 0.012);
    const cone = mat("#2b2d31", { roughness: 0.9 });
    // a tweeter on top, three woofers below
    for (const [y, r] of [[0.9, 0.025], [0.72, 0.065], [0.5, 0.075], [0.28, 0.075]] as const) {
      const cy = 0.03 + (h - 0.03) * y;
      // the woofers move with the music
      const draw = () => {
        b.add(new THREE.CircleGeometry(Math.min(r, w * 0.4), 24), cone, 0, cy, d / 2 + 0.002);
        b.add(new THREE.TorusGeometry(Math.min(r, w * 0.4), 0.004, 4, 24), mat(C.steel, { metalness: 0.6, roughness: 0.3 }), 0, cy, d / 2 + 0.003);
      };
      if (r > 0.05) b.pulser(0, cy, d / 2, draw);
      else draw();
    }
    legs(b, w, d, 0.03, 0.03, 0.008, mat(C.black));
  },
  speaker_shelf: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.012);
    b.pulser(0, h * 0.38, d / 2, () => b.add(new THREE.CircleGeometry(w * 0.32, 24), mat("#3a3c40"), 0, h * 0.38, d / 2 + 0.001));
    b.add(new THREE.CircleGeometry(w * 0.12, 16), mat("#3a3c40"), 0, h * 0.78, d / 2 + 0.001);
  },
  cube_shelf: (b, w, d, h, f) => {
    // square cells of about 33 cm, a frame thicker than the dividers
    const nx = Math.max(1, Math.round(w / 0.39));
    const ny = Math.max(1, Math.round(h / 0.39));
    const t = 0.04;
    const tt = 0.016;
    b.box(t, h, d, -w / 2 + t / 2, 0, 0, f);
    b.box(t, h, d, w / 2 - t / 2, 0, 0, f);
    b.box(w - 2 * t, t, d, 0, 0, 0, f);
    b.box(w - 2 * t, t, d, 0, h - t, 0, f);
    const cw = (w - 2 * t) / nx;
    const ch = (h - 2 * t) / ny;
    for (let i = 1; i < nx; i++) b.box(tt, h - 2 * t, d, -w / 2 + t + cw * i, t, 0, f);
    for (let j = 1; j < ny; j++) b.box(w - 2 * t, tt, d, 0, t + ch * j - tt / 2, 0, f);
    // a few boxes and books in the cells
    const rand = random(nx * 31 + ny * 7);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const x = -w / 2 + t + cw * (i + 0.5);
        const y = t + ch * j + (j ? tt / 2 : 0);
        const r = rand();
        if (r < 0.25) b.box(cw - 0.03, ch - 0.03, d - 0.04, x, y, 0.01, mat(["#d9d4c7", "#8d9299", "#c9a47c"][j % 3], { roughness: 1 }), 0.01);
        else if (r < 0.55)
          for (let k = 0; k < 7; k++) b.batch(new THREE.BoxGeometry(0.03, ch * (0.7 + rand() * 0.2), d * 0.75), mat(C.book[(i + j + k) % C.book.length]), matrix(x - cw / 2 + 0.03 + k * 0.034, y + (ch * 0.75) / 2, 0));
      }
  },
  bookshelf: (b, w, d, h, f) => shelves(b, w, d, h, f, Math.max(3, Math.round(h / 0.35)), random(Math.round(w * 100 + h * 10))),
  floor_lamp_arc: (b, w, d, h, f, color, a) => {
    const base = mat(C.ceramic);
    const x0 = -w / 2 + 0.18;
    b.cyl(0.17, 0.17, 0.05, x0, 0, 0, mat("#e8e6e1"), 32);
    const curve = new THREE.QuadraticBezierCurve3(v(x0, 0.05, 0), v(x0 + 0.1, h + 0.25, 0), v(w / 2 - 0.15, h - 0.12, 0));
    b.add(new THREE.TubeGeometry(curve, 40, 0.012, 8, false), a);
    const dome = b.add(new THREE.SphereGeometry(Math.min(0.2, d / 2), 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), shadeMat(f, color), w / 2 - 0.15, h - 0.22, 0);
    dome.material = (dome.material as THREE.Material).clone();
    (dome.material as THREE.Material).side = THREE.DoubleSide;
    void base;
  },
  floor_lamp_tripod: (b, w, d, h, f, color, a) => {
    const r = Math.min(w, d) / 2;
    const top = v(0, h * 0.62, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      b.rod(top, v(Math.cos(a) * r * 0.85, 0, Math.sin(a) * r * 0.85), 0.012, f);
    }
    b.rod(top, v(0, h - 0.3, 0), 0.008, a);
    b.cyl(r * 0.75, r * 0.8, 0.32, 0, h - 0.32, 0, shadeMat(f, color), 32, true);
  },
  floor_lamp_globe: (b, w, _d, h, _f, _c, a) => {
    b.cyl(w * 0.45, w * 0.45, 0.025, 0, 0, 0, a, 28);
    b.cyl(0.01, 0.01, h - 0.3, 0, 0.025, 0, a, 8);
    b.sphere(w * 0.5, 0, h - w * 0.5, 0, glowing(mat("#f6f1e6", { transparent: true, opacity: 0.92 })), 1, 1, 1, 24);
  },
  table_lamp: (b, w, _d, h, f, color, a) => {
    b.sphere(w * 0.28, 0, h * 0.24, 0, f, 1, 0.9, 1, 20);
    b.cyl(0.008, 0.008, h * 0.35, 0, h * 0.4, 0, a, 8);
    b.cyl(w * 0.38, w * 0.5, h * 0.32, 0, h * 0.68, 0, shadeMat(f, color), 28, true);
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
  dining_table: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.035, d, 0, h - 0.035, 0, f, 0.01);
    // two trestles
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.25);
      b.rod(v(x, h - 0.035, -d / 2 + 0.12), v(x, 0, -d / 2 + 0.06), 0.02, a);
      b.rod(v(x, h - 0.035, d / 2 - 0.12), v(x, 0, d / 2 - 0.06), 0.02, a);
      b.box(0.04, 0.04, d - 0.2, x, h - 0.075, 0, a);
    }
  },
  dining_table_round: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.035, 0, h - 0.035, 0, f, 48);
    b.cyl(0.06, 0.09, h - 0.035, 0, 0, 0, a, 20);
    b.cyl(r * 0.45, r * 0.5, 0.03, 0, 0, 0, a, 32);
  },
  garden_table: (b, w, d, h, f, _c, a) => {
    for (let i = 0; i < Math.round(w / 0.1); i++) b.box(w / Math.round(w / 0.1) - 0.012, 0.03, d, -w / 2 + (w / Math.round(w / 0.1)) * (i + 0.5), h - 0.03, 0, f);
    legs(b, w, d, h - 0.03, 0.06, 0.025, a, true);
  },
  chair_shell: (b, w, d, h, f, _c, a) => {
    // a moulded seat bowl and back on wooden legs
    const shell = mat((f.color as THREE.Color).getStyle(), { side: THREE.DoubleSide });
    const seat = b.add(new THREE.SphereGeometry(0.5, 28, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), shell, 0, 0.53, 0.03);
    seat.scale.set(w, 0.3, d * 0.85);
    const backrest = b.add(new THREE.CylinderGeometry(w * 0.48, w * 0.44, h - 0.48, 24, 1, true, Math.PI * 0.7, Math.PI * 0.6), shell, 0, 0.47 + (h - 0.48) / 2, -0.02);
    backrest.scale.set(1, 1, (d * 0.9) / w);
    backrest.rotation.x = -0.12;
    const wood = a;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * 0.1, 0.4, sz * 0.1), v(sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04)), 0.013, wood);
    for (const sz of [-1, 1]) b.rod(v(-w / 2 + 0.07, 0.15, sz * (d / 2 - 0.07)), v(w / 2 - 0.07, 0.15, sz * (d / 2 - 0.07)), 0.006, mat(C.black), 4);
  },
  chair_wood: (b, w, d, h, f) => {
    b.box(w, 0.025, d - 0.04, 0, 0.44, 0.02, f, 0.008);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.014, 0.012, 0.44, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.04), f, 10);
    for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.03), 0.44, back(d) + 0.04), v(sx * (w / 2 - 0.03), h, back(d) + 0.01), 0.013, f);
    b.box(w - 0.02, 0.1, 0.02, 0, h - 0.13, back(d) + 0.02, f, 0.005);
  },
  bar_stool: (b, w, _d, h, f, _c, acc) => {
    b.cyl(w * 0.45, w * 0.42, 0.05, 0, h - 0.05, 0, f, 28);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.rod(v(Math.cos(a) * w * 0.25, h - 0.05, Math.sin(a) * w * 0.25), v(Math.cos(a) * w * 0.45, 0, Math.sin(a) * w * 0.45), 0.012, acc);
    }
    b.add(new THREE.TorusGeometry(w * 0.37, 0.008, 6, 24), acc, 0, h * 0.32, 0).rotation.x = Math.PI / 2;
  },
  kitchen: (b, w, d, h, f, _c, a) => {
    const n = Math.max(1, Math.round(w / 0.6));
    const uw = w / n;
    const top = 0.04;
    b.box(w - 0.02, 0.1, d - 0.08, 0, 0, back(d) + (d - 0.08) / 2, mat(C.black));
    b.box(w, h - top - 0.1, d - 0.03, 0, 0.1, back(d) + (d - 0.03) / 2, mat("#e8e6e1"));
    b.box(w, top, d, 0, h - top, 0, a, 0.004);
    const sink = n > 1 ? Math.floor(n / 3) : -1;
    const hob = n > 2 ? Math.min(n - 1, sink + 2) : -1;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + uw * (i + 0.5);
      const fz = d / 2 - 0.03;
      if (i === hob) {
        // an oven under the hob
        b.box(uw - 0.006, 0.12, 0.018, x, h - top - 0.14, fz + 0.009, f, 0.003);
        b.box(uw - 0.006, 0.58, 0.018, x, 0.12, fz + 0.009, mat(C.screen, { roughness: 0.2 }), 0.003);
        b.box(uw - 0.1, 0.005, d - 0.12, x, h, 0, mat(C.screen, { roughness: 0.15 }));
        for (const [dx, dz, r] of [[-0.12, -0.08, 0.09], [0.12, -0.08, 0.07], [-0.12, 0.12, 0.07], [0.12, 0.12, 0.09]]) b.add(new THREE.RingGeometry(r - 0.006, r, 24), mat("#555"), x + dx, h + 0.006, dz).rotation.x = -Math.PI / 2;
      } else fronts(b, x - uw / 2, uw, 0.1, h - top - 0.1, fz, 1, f, i % 2 ? 3 : 1);
      if (i === sink) {
        b.box(uw - 0.14, 0.004, d - 0.22, x, h, 0.02, mat(C.steel, { metalness: 0.6, roughness: 0.3 }));
        b.box(uw - 0.18, 0.005, d - 0.26, x, h + 0.001, 0.02, mat("#8e9398", { metalness: 0.5, roughness: 0.4 }));
        const tap = mat(C.chrome, { metalness: 0.8, roughness: 0.2 });
        b.cyl(0.015, 0.015, 0.3, x, h, back(d) + 0.06, tap, 12);
        b.rod(v(x, h + 0.3, back(d) + 0.06), v(x, h + 0.26, back(d) + 0.22), 0.012, tap);
      }
    }
  },
  kitchen_island: (b, w, d, h, f, _c, a) => {
    const top = 0.04;
    const over = Math.min(0.3, d * 0.3);
    const bd = d - over;
    b.box(w - 0.1, 0.1, bd - 0.08, 0, 0, back(d) + bd / 2, mat(C.black));
    b.box(w - 0.08, h - top - 0.1, bd, 0, 0.1, back(d) + bd / 2, f, 0.004);
    // fronts towards the kitchen (the back), seats under the overhang
    fronts(b, -w / 2 + 0.04, w - 0.08, 0.1, h - top - 0.1, back(d) - 0.018, Math.max(1, Math.round((w - 0.08) / 0.6)), f, 3);
    // a worktop folding down at both ends
    const worktop = a;
    b.box(w, top, d, 0, h - top, 0, worktop, 0.004);
    for (const sx of [-1, 1]) b.box(top, h - top, d, sx * (w / 2 - top / 2), 0, 0, worktop, 0.004);
  },
  kitchen_upper: (b, w, d, h, f) => {
    const n = Math.max(1, Math.round(w / 0.6));
    b.box(w, h, d - 0.02, 0, 0, back(d) + (d - 0.02) / 2, mat("#e8e6e1"));
    fronts(b, -w / 2, w, 0, h, d / 2 - 0.02, n, f, 1);
    // light under the cabinets
    b.box(w - 0.04, 0.008, 0.03, 0, -0.008, d / 2 - 0.06, mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.4 }));
  },
  kitchen_tall: (b, w, d, h, f) => {
    b.box(w, h - 0.1, d - 0.03, 0, 0.1, back(d) + (d - 0.03) / 2, mat("#e8e6e1"));
    b.box(w - 0.02, 0.1, d - 0.08, 0, 0, back(d) + (d - 0.08) / 2, mat(C.black));
    const z = d / 2 - 0.03;
    b.box(w - 0.004, h * 0.55, 0.018, 0, 0.1, z + 0.009, f, 0.003);
    b.box(w - 0.004, 0.6, 0.018, 0, 0.1 + h * 0.55 + 0.004, z + 0.009, mat(C.screen, { roughness: 0.2 }), 0.003);
    b.box(w - 0.004, h - 0.1 - h * 0.55 - 0.61, 0.018, 0, 0.1 + h * 0.55 + 0.608, z + 0.009, f, 0.003);
  },
  bed: (b, w, d, h, f, _c, a) => bed(b, w, d, h, f, a),
  bed_single: (b, w, d, h, f, _c, a) => bed(b, w, d, h, f, a),
  nightstand: (b, w, d, h, f, _c, a) => {
    b.box(w, h - 0.15, d, 0, 0.15, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.16, h - 0.17, d / 2 - 0.018, 1, f, 2, "knob");
    legs(b, w, d, 0.15, 0.04, 0.01, a);
  },
  nightstand_wall: (b, w, d, h, f, _c, a) => {
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.005, h - 0.01, d / 2 - 0.018, 1, f, 1);
    b.box(Math.min(0.2, w * 0.4), 0.012, 0.02, 0, h * 0.62, d / 2 + 0.006, a, 0.004);
  },
  wardrobe: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, {}),
  wardrobe_1door: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 1 }),
  wardrobe_2door: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 2 }),
  wardrobe_3door: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 3, mirror: [1] }),
  wardrobe_4door: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 4 }),
  wardrobe_drawers: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 2, drawers: 2 }),
  wardrobe_mirror: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 2, mirror: [0, 1] }),
  wardrobe_top: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { top: true }),
  wardrobe_legs: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 2, legs: true, drawers: 1 }),
  chest_tall: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 0, drawers: Math.max(3, Math.round(h / 0.2)), legs: true }),
  chest_low: (b, w, d, h, f, _c, a) => cupboard(b, w, d, h, f, a, { doors: 0, drawers: 3, columns: Math.max(1, Math.round(w / 0.8)) }),
  wardrobe_sliding: (b, w, d, h, f, _c, a) => {
    b.box(w, h, d - 0.06, 0, 0, back(d) + (d - 0.06) / 2, f);
    const n = Math.max(2, Math.round(w / 1));
    const pw = w / n + 0.03;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const z = d / 2 - (i % 2 ? 0.05 : 0.025);
      b.box(Math.min(pw, w / n + 0.03), h - 0.04, 0.02, x, 0.02, z, f, 0.004);
      // a mirror on every other panel
      if (i % 2 === 1) b.box(pw - 0.1, h - 0.3, 0.004, x, 0.15, z + 0.012, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }));
      b.box(0.01, 0.35, 0.012, x + (i % 2 ? -1 : 1) * (pw / 2 - 0.04), h * 0.45, z + 0.014, a);
    }
  },
  wardrobe_open: (b, w, d, h, f) => {
    // a frame with a rail, clothes, a shelf on top and shoes below
    const m = f;
    for (const sx of [-1, 1]) {
      b.box(0.03, h, 0.03, sx * (w / 2 - 0.015), 0, back(d) + 0.015, m);
      b.box(0.03, h, 0.03, sx * (w / 2 - 0.015), 0, d / 2 - 0.015, m);
    }
    b.box(w, 0.025, d, 0, h - 0.3, 0, m);
    b.box(w, 0.025, d, 0, 0.12, 0, m);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, w - 0.06, 10), mat(C.chrome, { metalness: 0.7, roughness: 0.3 }), 0, h - 0.4, 0).rotation.z = Math.PI / 2;
    const rand = random(Math.round(w * 100));
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.12) {
      const len = 0.6 + rand() * 0.6;
      const t = 0.03 + rand() * 0.04;
      b.batch(new RoundedBoxGeometry(t, len, d * 0.8, 1, 0.012), mat(C.clothes[Math.floor(rand() * C.clothes.length)], { roughness: 1 }), matrix(x, h - 0.42 - len / 2, 0, 0, 0, (rand() - 0.5) * 0.06));
      x += t + 0.015 + rand() * 0.02;
    }
    for (let i = 0; i < Math.floor((w - 0.1) / 0.25); i++) for (const dx of [-0.05, 0.05]) b.box(0.08, 0.08, 0.26, -w / 2 + 0.15 + i * 0.25 + dx, 0.145, 0.02, mat(C.clothes[(i + 2) % C.clothes.length]), 0.03);
    for (let i = 0; i < 3; i++) b.box(0.32, 0.18, d * 0.7, -w / 2 + 0.25 + i * 0.4, h - 0.275, 0, mat(["#d9d4c7", "#c9a47c", "#8d9299"][i]), 0.01);
  },
  dresser: (b, w, d, h, f, _c, a) => {
    b.box(w, h - 0.12, d, 0, 0.12, 0, f, 0.008);
    fronts(b, -w / 2, w, 0.13, h - 0.14, d / 2 - 0.018, Math.max(1, Math.round(w / 0.6)), f, 3, "bar");
    legs(b, w, d, 0.12, 0.05, 0.012, a);
  },
  desk: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.006);
    const metal = a;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.06);
      b.box(0.03, h - 0.03, 0.03, x, 0, -d / 2 + 0.05, metal);
      b.box(0.03, h - 0.03, 0.03, x, 0, d / 2 - 0.05, metal);
      b.box(0.03, 0.03, d - 0.1, x, h - 0.06, 0, metal);
    }
    // a screen and a lamp
    b.box(0.6, 0.36, 0.02, 0, h + 0.1, back(d) + 0.12, mat(C.screen, { roughness: 0.3 }), 0.005);
    b.box(0.04, 0.1, 0.04, 0, h, back(d) + 0.12, metal);
  },
  chair_office: (b, w, d, h, f, _c, a) => {
    const metal = a;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.rod(v(0, 0.08, 0), v(Math.cos(a) * w * 0.45, 0.04, Math.sin(a) * w * 0.45), 0.015, metal);
      b.sphere(0.025, Math.cos(a) * w * 0.45, 0.025, Math.sin(a) * w * 0.45, metal, 1, 1, 1, 8);
    }
    b.cyl(0.025, 0.025, 0.36, 0, 0.08, 0, metal, 10);
    b.box(w * 0.8, 0.08, d * 0.75, 0, 0.44, 0.03, f, 0.03);
    b.box(w * 0.75, h - 0.6, 0.06, 0, 0.58, back(d) + 0.08, f, 0.03)?.rotation.set(-0.1, 0, 0);
  },
  shoe_shelf: (b, w, d, h, f) => {
    b.box(0.02, h, d, -w / 2 + 0.01, 0, 0, f);
    b.box(0.02, h, d, w / 2 - 0.01, 0, 0, f);
    const n = Math.max(2, Math.round(h / 0.3));
    const rand = random(n);
    for (let i = 0; i < n; i++) {
      const y = 0.06 + (i * (h - 0.1)) / n;
      const shelf = b.box(w - 0.04, 0.02, d, 0, y, 0, f);
      shelf?.rotation.set(0.25, 0, 0);
      for (let k = 0; k < Math.floor((w - 0.06) / 0.2); k++) {
        const c = mat(C.clothes[Math.floor(rand() * C.clothes.length)]);
        for (const dx of [-0.045, 0.045]) b.box(0.08, 0.08, 0.24, -w / 2 + 0.13 + k * 0.2 + dx, y + 0.03, 0, c, 0.03)?.rotation.set(0.25, 0, 0);
      }
    }
  },
  shoe_cabinet: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.005, h - 0.01, d / 2 - 0.018, 1, f, 3, "bar");
  },
  hall_bench: (b, w, d, h, f) => {
    b.box(w, 0.04, d, 0, h - 0.04, 0, f, 0.008);
    b.box(w, 0.02, d, 0, 0.12, 0, f);
    for (const sx of [-1, 1]) b.box(0.03, h - 0.04, d, sx * (w / 2 - 0.015), 0, 0, f);
    for (let k = 0; k < Math.floor((w - 0.06) / 0.22); k++) for (const dx of [-0.045, 0.045]) b.box(0.08, 0.08, 0.26, -w / 2 + 0.14 + k * 0.22 + dx, 0.14, 0, mat(C.clothes[k % C.clothes.length]), 0.03);
    b.box(w * 0.4, 0.05, d * 0.8, -w * 0.2, h, 0, mat(C.linen), 0.02);
  },
  coat_hooks: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.08, 0.02, 0, h - 0.08, back(d) + 0.01, f, 0.004);
    const n = Math.max(2, Math.round(w / 0.18));
    const rand = random(n);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      b.rod(v(x, h - 0.05, back(d) + 0.02), v(x, h - 0.02, back(d) + 0.08), 0.008, a);
      if (i % 2 === 0) {
        // a coat: shoulders narrow at the hook, wider and longer below, sleeves at the sides
        const cm = mat(C.clothes[Math.floor(rand() * C.clothes.length)], { roughness: 1 });
        const coat = new THREE.CylinderGeometry(0.1, 0.17, h - 0.12, 4, 1, false, Math.PI / 4);
        coat.scale(1, 1, 0.35);
        b.add(coat, cm, x, (h - 0.12) / 2, back(d) + 0.07);
        for (const sx of [-1, 1]) b.add(new THREE.CapsuleGeometry(0.03, (h - 0.12) * 0.55, 4, 8), cm, x + sx * 0.13, (h - 0.12) * 0.6, back(d) + 0.08).rotation.z = sx * 0.12;
      }
    }
  },
  coat_stand: (b, w, _d, h, f) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      b.rod(v(0, h, 0), v(Math.cos(a) * w * 0.45, 0, Math.sin(a) * w * 0.45), 0.012, f);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.rod(v(0, h - 0.12, 0), v(Math.cos(a) * 0.12, h - 0.05, Math.sin(a) * 0.12), 0.01, f);
    }
    b.box(0.34, 0.85, 0.12, 0.1, h - 1.0, 0.05, mat(C.clothes[1], { roughness: 1 }), 0.04);
  },
  letter_box: (b, w, d, h, f) => letterBox(b, w, d, h, 0, f),
  letter_box_post: (b, w, d, h, f) => {
    const bh = Math.min(0.42, h * 0.35);
    b.box(0.06, h - bh, 0.06, 0, 0, 0, f);
    b.box(0.3, 0.02, 0.2, 0, 0, 0, f);
    letterBox(b, w, d, bh, h - bh, f);
  },
  toilet_wall: (b, w, d, _h, f, _c, a) => toiletBowl(b, w, d, back(d), f, a),
  bidet: (b, w, d, _h, f, _c, a) => bidet(b, w, d, f, a, {}),
  bidet_square: (b, w, d, _h, f, _c, a) => bidet(b, w, d, f, a, { square: true }),
  bidet_floor: (b, w, d, _h, f, _c, a) => bidet(b, w, d, f, a, { floor: true, open: true }),
  toilet_wall_square: (b, w, d, _h, f, _c, a) => toiletBowl(b, w, d, back(d), f, a, { square: true }),
  toilet_floor: (b, w, d, _h, f, _c, a) => toiletBowl(b, w, d, back(d), f, a, { floor: true }),
  toilet_floor_square: (b, w, d, _h, f, _c, a) => toiletBowl(b, w, d, back(d), f, a, { floor: true, square: true }),
  vanity: (b, w, d, h, f, _c, a) => vanity(b, w, d, h, f, Math.max(1, Math.round(w / 0.75)), a),
  vanity_double: (b, w, d, h, f, _c, a) => vanity(b, w, d, h, f, Math.max(2, Math.round(w / 0.7)), a),
  sink_large: (b, w, d, h, f, _c, a) => {
    // one or two bowls on a wooden shelf
    const top = h - 0.14;
    b.box(w, 0.04, d, 0, top - 0.04, 0, surface("oak", 0.7), 0.006);
    const n = w > 0.9 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      vessel(b, Math.min(0.48, w / n - 0.08), d * 0.78, top, f);
      tapBasin(b, x, top, back(d) + 0.05, a, 0.26);
      if (n > 1) b.g.children.at(-4)?.position.setX(x);
    }
  },
  mirror_cabinet: (b, w, d, h, f) => {
    b.box(w, h, d - 0.02, 0, 0, back(d) + (d - 0.02) / 2, f, 0.004);
    const n = Math.max(1, Math.round(w / 0.4));
    for (let i = 0; i < n; i++) b.box(w / n - 0.006, h - 0.04, 0.008, -w / 2 + (w / n) * (i + 0.5), 0.02, d / 2 - 0.016, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }));
    b.box(w - 0.04, 0.01, 0.02, 0, -0.01, d / 2 - 0.04, mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.4 }));
  },
  shower_glass: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.04, d, 0, 0, 0, mat(C.ceramic), 0.01);
    b.box(w * 0.4, 0.004, 0.06, 0, 0.04, 0, mat("#999"));
    b.box(0.008, h - 0.04, d * 0.9, w / 2 - 0.02, 0.04, 0, glass());
    b.box(0.02, 0.02, d * 0.9, w / 2 - 0.02, h - 0.02, 0, f);
    const chrome = a;
    b.cyl(0.012, 0.012, h - 0.2, -w / 2 + 0.35, 0.9, back(d) + 0.03, chrome, 10);
    b.cyl(0.13, 0.13, 0.012, -w / 2 + 0.35, h - 0.12, back(d) + 0.2, chrome, 28);
    b.rod(v(-w / 2 + 0.35, h - 0.1, back(d) + 0.03), v(-w / 2 + 0.35, h - 0.1, back(d) + 0.2), 0.01, chrome);
  },
  bathtub: (b, w, d, h, f, _c, a) => {
    // freestanding: a soft block, an oval basin inside
    b.box(w, h, d, 0, 0, 0, f, Math.min(0.2, d * 0.3));
    const inner = new THREE.CircleGeometry(0.5, 40);
    inner.scale(w - 0.14, d - 0.14, 1);
    b.add(inner, mat("#dfe9ec", { roughness: 0.2 }), 0, h + 0.002, 0).rotation.x = -Math.PI / 2;
    floorTap(b, w / 2 + 0.15, h, 0, a);
  },
  towel_radiator: (b, w, d, h, f) => {
    f = warmMat(f);
    for (const sx of [-1, 1]) b.cyl(0.015, 0.015, h, sx * (w / 2 - 0.02), 0, back(d) + 0.035, f, 10);
    const n = Math.max(4, Math.round(h / 0.08));
    for (let i = 0; i < n; i++) b.add(new THREE.CylinderGeometry(0.009, 0.009, w - 0.04, 8), f, 0, 0.04 + (i * (h - 0.08)) / (n - 1), back(d) + 0.035).rotation.z = Math.PI / 2;
    b.box(w * 0.7, h * 0.35, 0.03, 0, h * 0.45, back(d) + 0.06, mat(C.linen, { roughness: 1 }), 0.01);
  },
  // ----- plants -----
  monstera: (b, w, d, h, f) => {
    const rand = random(11);
    const ph = Math.min(0.32, h * 0.28);
    const r = Math.min(w, d) * 0.22;
    pot(b, r, ph, f);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.5;
      const reach = 0.35 + rand() * 0.25;
      const top = v(Math.cos(a) * reach * (w / 2) * 1.2, ph + (h - ph) * (0.45 + rand() * 0.4), Math.sin(a) * reach * (d / 2) * 1.2);
      b.batch(new THREE.CylinderGeometry(0.006, 0.008, 1, 5), mat(C.leaf), new THREE.Matrix4().compose(v(top.x / 2, (ph + top.y) / 2, top.z / 2), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), top.clone().sub(v(0, ph, 0)).normalize()), v(1, top.distanceTo(v(0, ph, 0)), 1)));
      const size = 0.28 + rand() * 0.14;
      b.batch(leafGeometry(size, size * 0.95, 0.35, 3), leafMat(i % 3 ? C.leafDark : C.leaf), matrix(top.x, top.y, top.z, -0.7 - rand() * 0.5, -a - Math.PI / 2, 0));
    }
  },
  fiddle_fig: (b, w, d, h, f) => {
    const rand = random(23);
    const ph = 0.3;
    pot(b, Math.min(w, d) * 0.32, ph, f);
    b.cyl(0.015, 0.025, h * 0.75, 0, ph, 0, mat(C.trunk), 8);
    for (let i = 0; i < 34; i++) {
      const y = ph + (h - ph) * (0.35 + (i / 34) * 0.62);
      const a = i * 2.4;
      const r = 0.05 + rand() * 0.12 * (1 - i / 50);
      const size = 0.16 + rand() * 0.08;
      b.batch(leafGeometry(size, size * 0.85, 0.15), leafMat(rand() > 0.5 ? C.leafDark : C.leaf), matrix(Math.cos(a) * r, y, Math.sin(a) * r, -0.9 + rand() * 0.5, -a - Math.PI / 2, 0));
    }
  },
  snake_plant: (b, w, d, h, f) => {
    const rand = random(5);
    const ph = 0.22;
    pot(b, Math.min(w, d) * 0.42, ph, f);
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * 0.06;
      const len = (h - ph) * (0.6 + rand() * 0.45);
      b.batch(leafGeometry(len, 0.07, 0.05), leafMat(i % 2 ? "#3c6a3a" : "#5d8a45"), matrix(Math.cos(a) * r, ph * 0.85, Math.sin(a) * r, -0.08 + (rand() - 0.5) * 0.2, a, (rand() - 0.5) * 0.25));
    }
  },
  areca_palm: (b, w, d, h, f) => {
    const rand = random(7);
    const ph = 0.34;
    pot(b, Math.min(w, d) * 0.25, ph, f);
    for (let s = 0; s < 7; s++) {
      const a = (s / 7) * Math.PI * 2 + rand() * 0.4;
      const len = (h - ph) * (0.75 + rand() * 0.3);
      const out = (w / 2) * (0.6 + rand() * 0.3);
      const curve = new THREE.QuadraticBezierCurve3(v(0, ph, 0), v(Math.cos(a) * out * 0.2, ph + len, Math.sin(a) * out * 0.2), v(Math.cos(a) * out, ph + len * 0.75, Math.sin(a) * out));
      b.batch(new THREE.TubeGeometry(curve, 10, 0.006, 4, false), mat(C.leafYellow));
      for (let k = 4; k < 20; k++) {
        const t = k / 20;
        const p = curve.getPoint(t);
        for (const side of [-1, 1]) b.batch(leafGeometry(0.22 * (1 - t * 0.5), 0.025, 0.4), leafMat(k % 2 ? C.leaf : C.leafLight), matrix(p.x, p.y, p.z, -1.0 - t * 0.6, -a - Math.PI / 2 + side * 1.1, side * 0.4));
      }
    }
  },
  olive_tree: (b, w, d, h, f) => {
    const rand = random(13);
    const ph = 0.38;
    pot(b, Math.min(w, d) * 0.36, ph, f);
    b.cyl(0.025, 0.04, h * 0.5, 0, ph, 0, mat(C.trunk), 8);
    for (let c = 0; c < 6; c++) {
      const a = (c / 6) * Math.PI * 2;
      const center = v(Math.cos(a) * w * 0.18, ph + h * 0.5 + (h - ph - h * 0.5) * (0.3 + rand() * 0.4), Math.sin(a) * d * 0.18);
      b.rod(v(0, ph + h * 0.42, 0), center, 0.012, mat(C.trunk), 5);
      for (let i = 0; i < 70; i++) {
        const p = center.clone().add(v((rand() - 0.5) * w * 0.32, (rand() - 0.5) * h * 0.22, (rand() - 0.5) * d * 0.32));
        b.batch(leafGeometry(0.06, 0.012, 0.1), leafMat(rand() > 0.5 ? C.leafOlive : "#a2ac85"), matrix(p.x, p.y, p.z, rand() * 3, rand() * 6, rand() * 3));
      }
    }
  },
  plant_hanging: (b, w, d, h, f) => {
    // hangs from the ceiling: a pot on cords, trailing leaves
    const rand = random(17);
    const r = Math.min(w, d) * 0.3;
    const py = h * 0.45;
    pot(b, r, 0.16, f, py);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      b.rod(v(Math.cos(a) * r, py + 0.16, Math.sin(a) * r), v(0, h, 0), 0.003, mat(C.linen), 4);
    }
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      const len = 0.2 + rand() * (py + 0.1);
      for (let k = 0; k < 10; k++) {
        const t = k / 10;
        const p = v(Math.cos(a) * (r + 0.03 + t * 0.05), py + 0.15 - t * len, Math.sin(a) * (r + 0.03 + t * 0.05));
        b.batch(leafGeometry(0.06, 0.05, 0.2), leafMat(k % 2 ? C.leaf : C.leafLight), matrix(p.x, p.y, p.z, 1.6 + rand() * 0.5, -a + Math.PI / 2 + rand(), 0));
      }
    }
  },
  plant_small: (b, w, d, h, f) => {
    const rand = random(3);
    pot(b, Math.min(w, d) * 0.45, h * 0.45, f);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      b.batch(leafGeometry(h * 0.45, 0.03, 0.3), leafMat(i % 2 ? C.leaf : C.leafLight), matrix(Math.cos(a) * 0.02, h * 0.4, Math.sin(a) * 0.02, -0.4 - rand() * 0.6, a, 0));
    }
  },
  planter_box: (b, w, d, h, f) => {
    const bh = Math.min(0.45, h * 0.5);
    b.box(w, bh, d, 0, 0, 0, f, 0.006);
    b.box(w - 0.04, 0.01, d - 0.04, 0, bh - 0.04, 0, mat(C.soil));
    grass(b, random(29), w - 0.1, d - 0.1, h - bh, bh - 0.04, 140, ["#6f8f48", "#8aa35a", "#a6b46a"]);
  },
  // ----- outside -----
  tree_deciduous: (b, w, d, h, _f, color) => tree(b, w, d, h, 41, color === "autumn" ? "autumn" : "round"),
  tree_fruit: (b, w, d, h) => tree(b, w, d, h, 43, "fruit"),
  tree_birch: (b, w, d, h) => tree(b, w, d, h, 47, "birch"),
  tree_conifer: (b, w, d, h) => {
    // a spruce: whorls of drooping branches, needles in clusters along them, narrow at the top
    const rand = random(53);
    const bark = finishLook("bark");
    const barkMat = bark.map ? new THREE.MeshStandardMaterial({ map: bark.map, roughness: 1 }) : mat(C.trunk);
    const R = Math.min(w, d) / 2;
    b.cyl(0.03, 0.14, h * 0.97, 0, 0, 0, barkMat, 10);
    const tiers = Math.max(8, Math.round(h / 0.45));
    const needles = smallLeaf(0.07);
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers;
      const y = h * (0.12 + f * 0.85);
      const reach = R * (1 - f) * (0.85 + rand() * 0.15) + 0.12;
      const n = 6 + Math.round((1 - f) * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + t * 0.7 + rand() * 0.4;
        const end = v(Math.cos(a) * reach, y - reach * 0.35, Math.sin(a) * reach);
        b.rod(v(0, y, 0), end, 0.012 + 0.03 * (1 - f), barkMat, 4);
        // needle clusters along the branch, denser towards its end
        for (let q = 0; q < 7; q++) {
          const s2 = 0.25 + (q / 7) * 0.8;
          const p = v(0, y, 0).lerp(end, Math.min(1, s2));
          for (let z = 0; z < 6; z++)
            b.batch(needles.clone(), leafMat(z % 2 ? C.leafDark : "#2f5a33"), matrix(p.x + (rand() - 0.5) * 0.15, p.y + (rand() - 0.5) * 0.12, p.z + (rand() - 0.5) * 0.15, rand() * 3, rand() * 6, rand() * 3, 1.2 + rand()));
        }
      }
    }
    b.add(new THREE.ConeGeometry(0.08, 0.35, 6), mat(C.leafDark), 0, h - 0.17, 0);
  },
  shrub: (b, w, d, h) => foliage(b, random(61), 0, h / 2, 0, w / 2, h / 2, d / 2, 380, 0.11, [C.leaf, C.leafDark, C.leafLight]),
  hedge_leafy: (b, w, d, h) => {
    const rand = random(67);
    const n = Math.max(1, Math.round(w / 0.8));
    for (let i = 0; i < n; i++) foliage(b, rand, -w / 2 + (w / n) * (i + 0.5), h / 2, 0, w / n / 2 + 0.12, h / 2, d / 2, 260, 0.1, [C.leafDark, C.leaf, "#3d6d34"]);
  },
  ornamental_grass: (b, w, d, h, _f, color) => grass(b, random(71), w * 0.5, d * 0.5, h, 0, 260, color === "sand" ? ["#c8b27e", "#b49a63", "#d8c79c"] : ["#6f8f48", "#8aa35a", "#5b7a3c"], true),
  flower_bed: (b, w, d, h, _f, color) => {
    const rand = random(73);
    b.box(w, 0.04, d, 0, 0, 0, mat(C.soil));
    grass(b, rand, w - 0.05, d - 0.05, h * 0.5, 0.03, Math.round(w * d * 140), ["#4c7d3a", "#5d8a45"]);
    const petals = { terracotta: ["#d4553a", "#e8a33d", "#f2d14b"], pink: ["#e58fb0", "#c24b7a", "#f4c6d6"], white: ["#f4f2ec", "#f2e7a8", "#e6e0f0"], blue: ["#5d6fc4", "#8a74b8", "#a9c4ea"] }[color] ?? ["#d4553a", "#f2d14b"];
    const flower = new THREE.CircleGeometry(0.035, 6);
    for (let i = 0; i < Math.round(w * d * 60); i++) {
      const x = (rand() - 0.5) * (w - 0.1);
      const z = (rand() - 0.5) * (d - 0.1);
      const y = h * (0.55 + rand() * 0.45);
      b.batch(new THREE.CylinderGeometry(0.004, 0.004, y, 4), mat(C.leaf), matrix(x, y / 2, z));
      b.batch(flower.clone(), leafMat(petals[i % petals.length]), matrix(x, y, z, -Math.PI / 2 + (rand() - 0.5) * 0.6, rand() * 6, 0));
    }
  },
  lavender: (b, w, d, h) => {
    const rand = random(79);
    const n = Math.max(1, Math.round(w / 0.45));
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + (w / n) * (i + 0.5);
      foliage(b, rand, cx, h * 0.22, 0, w / n / 2.2, h * 0.22, d / 2.2, 60, 0.06, ["#7d8f78", "#93a28c"], true);
      for (let k = 0; k < 40; k++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * Math.min(w / n, d) * 0.4;
        const top = v(cx + Math.cos(a) * r * 1.4, h * (0.75 + rand() * 0.25), Math.sin(a) * r * 1.4);
        const base = v(cx + Math.cos(a) * r * 0.5, h * 0.3, Math.sin(a) * r * 0.5);
        b.batch(new THREE.CylinderGeometry(0.003, 0.003, top.distanceTo(base), 3), mat("#7d8f78"), new THREE.Matrix4().compose(base.clone().add(top).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), top.clone().sub(base).normalize()), v(1, 1, 1)));
        b.batch(new THREE.CylinderGeometry(0.012, 0.008, 0.08, 5), mat("#8068b3"), matrix(top.x, top.y, top.z));
      }
    }
  },
  sun_lounger: (b, w, d, h, f) => {
    const frame = f;
    b.box(w, 0.04, d * 0.65, 0, h - 0.12, d * 0.17, frame, 0.01);
    legs(b, w, d * 0.9, h - 0.12, 0.05, 0.02, frame, true);
    b.box(w - 0.06, 0.06, d * 0.62, 0, h - 0.08, d * 0.17, mat(C.linen, { roughness: 1 }), 0.025);
    const backrest = b.box(w - 0.06, 0.06, d * 0.36, 0, 0, 0, mat(C.linen, { roughness: 1 }), 0.025);
    backrest?.position.set(0, h + 0.08, back(d) + d * 0.18);
    backrest?.rotation.set(0.7, 0, 0);
  },
  parasol: (b, w, d, h, f) => {
    b.box(0.5, 0.08, 0.5, 0, 0, 0, mat("#5a5d61"), 0.01);
    b.cyl(0.02, 0.02, h - 0.1, 0, 0.08, 0, mat("#cfcac0"), 10);
    b.add(new THREE.ConeGeometry(Math.min(w, d) / 2, 0.45, 8, 1, true), mat((f.color as THREE.Color).getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, h - 0.2, 0);
  },
  // ----- more shelves -----
  bookshelf_wide: (b, w, d, h, f) => {
    const rand = random(83);
    const n = Math.max(1, Math.round(w / 0.8));
    const t = 0.022;
    const base = Math.min(0.75, h * 0.35);
    b.box(w, t, d, 0, h - t, 0, f);
    for (let i = 0; i <= n; i++) b.box(t, h, d, -w / 2 + t / 2 + (i * (w - t)) / n, 0, 0, f);
    fronts(b, -w / 2 + t, w - 2 * t, 0.04, base - 0.04, d / 2 - 0.02, n * 2, f, 1, "knob");
    b.box(w, base, d - 0.02, 0, 0, -0.01, f);
    const cw = (w - t) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + t + i * cw;
      const rows = Math.max(2, Math.round((h - base) / 0.36));
      for (let r = 0; r < rows; r++) {
        const y = base + (r * (h - base - t)) / rows;
        b.box(cw - t, t, d - 0.01, x0 + (cw - t) / 2, y - t, 0, f);
        if (rand() > 0.2) books(b, rand, x0 + 0.01, x0 + (cw - t) * (0.4 + rand() * 0.55), y, (h - base) / rows - 0.04, d * 0.75, 0);
      }
    }
  },
  bookshelf_low: (b, w, d, h, f) => shelves(b, w, d, h, f, 3, random(89)),
  bookshelf_grid: (b, w, d, h, f) => {
    // irregular cells, books standing and lying, open front and back (a room divider)
    const rand = random(97);
    const t = 0.025;
    const rows = Math.max(2, Math.round(h / 0.38));
    const rh = (h - t) / rows;
    for (const sx of [-1, 1]) b.box(t, h, d, sx * (w / 2 - t / 2), 0, 0, f);
    for (let r = 0; r <= rows; r++) b.box(w, t, d, 0, r * rh, 0, f);
    for (let r = 0; r < rows; r++) {
      const cuts = [-w / 2 + t];
      let x = cuts[0];
      while (x < w / 2 - 0.45) {
        x += 0.3 + rand() * 0.35;
        if (x < w / 2 - 0.2) cuts.push(x);
      }
      cuts.push(w / 2 - t);
      for (let i = 0; i < cuts.length; i++) {
        if (i > 0 && i < cuts.length - 1) b.box(t, rh, d, cuts[i], r * rh + t, 0, f);
        if (i === cuts.length - 1) break;
        const x0 = cuts[i] + t / 2;
        const x1 = cuts[i + 1] - t / 2;
        const what = rand();
        if (what < 0.5) books(b, rand, x0 + 0.01, x0 + (x1 - x0) * (0.5 + rand() * 0.45), r * rh + t, rh - 0.05, d * 0.7, 0);
        else if (what < 0.75) for (let k = 0; k < 4; k++) b.batch(new THREE.BoxGeometry((x1 - x0) * 0.7, 0.03, d * 0.6), mat(C.book[(k + r) % C.book.length]), matrix((x0 + x1) / 2, r * rh + t + 0.015 + k * 0.031, 0, 0, (rand() - 0.5) * 0.3, 0));
        else if (what < 0.88) {
          const px = (x0 + x1) / 2;
          b.cyl(0.06, 0.045, 0.11, px, r * rh + t, 0, mat(C.ceramic), 12);
          foliage(b, rand, px, r * rh + t + 0.17, 0, 0.07, 0.07, 0.07, 18, 0.05, [C.leaf, C.leafLight], true);
        }
      }
    }
  },
  bookshelf_ladder: (b, w, d, h, f) => {
    // leans against the wall: rails from the floor in front to the wall at the top
    const rand = random(101);
    const zAt = (y: number) => d / 2 - 0.02 - (y / h) * (d - 0.04);
    for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.02), 0, zAt(0)), v(sx * (w / 2 - 0.02), h, zAt(h)), 0.018, f, 6);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const y = 0.12 + (i * (h - 0.3)) / (n - 1);
      const front = zAt(y);
      const sd = Math.max(0.12, front + d / 2 - 0.01);
      const z = front - sd / 2;
      b.box(w - 0.04, 0.02, sd, 0, y, z, f);
      if (i < n - 1 && rand() > 0.25) books(b, rand, -w / 2 + 0.05, -w / 2 + 0.05 + (w - 0.1) * (0.35 + rand() * 0.5), y + 0.02, 0.26, sd * 0.75, z);
    }
  },
  bookshelf_wall: (b, w, d, h, f) => {
    const rand = random(103);
    const n = Math.max(2, Math.round(h / 0.4) + 1);
    for (let i = 0; i < n; i++) {
      const y = (i * (h - 0.025)) / (n - 1);
      const sw = w * (i % 2 ? 0.8 : 1);
      const x = i % 2 ? w * 0.1 : 0;
      b.box(sw, 0.025, d, x, y, 0, f);
      if (i < n - 1) books(b, rand, x - sw / 2 + 0.03, x - sw / 2 + sw * (0.3 + rand() * 0.4), y + 0.025, Math.min(0.26, (h - 0.025) / (n - 1) - 0.03), d * 0.8, 0);
    }
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
  bbq_kettle: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2 - 0.02;
    const y = h - r * 0.9;
    b.sphere(r, 0, y, 0, f, 1, 0.92, 1, 24);
    b.add(new THREE.TorusGeometry(r * 0.995, 0.006, 4, 32), mat(C.steel), 0, y, 0).rotation.x = Math.PI / 2;
    b.cyl(0.03, 0.03, 0.04, 0, y + r * 0.85, 0, mat(C.black), 10);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      b.rod(v(Math.cos(a) * r * 0.5, y - r * 0.7, Math.sin(a) * r * 0.5), v(Math.cos(a) * r * 0.95, 0, Math.sin(a) * r * 0.95), 0.012, mat(C.steel), 6);
    }
    b.add(new THREE.TorusGeometry(r * 0.75, 0.008, 4, 24), mat(C.steel), 0, y - r * 0.85, 0).rotation.x = Math.PI / 2;
  },
  bbq_gas: (b, w, d, h, f) => {
    const cw = w * 0.6;
    const ch = h * 0.72;
    b.box(cw, ch - 0.1, d * 0.9, 0, 0.1, 0, f, 0.01);
    fronts(b, -cw / 2, cw, 0.15, ch - 0.3, d * 0.45, 2, mat(C.steel), 1, "bar");
    b.box(cw, 0.08, d * 0.95, 0, ch - 0.12, 0, mat(C.steel));
    const hood = b.add(new THREE.CylinderGeometry(d * 0.45, d * 0.45, cw, 20, 1, false, 0, Math.PI), f, 0, ch - 0.04, 0);
    hood.rotation.set(0, 0, Math.PI / 2);
    b.rod(v(-cw * 0.35, ch + d * 0.3, d * 0.42), v(cw * 0.35, ch + d * 0.3, d * 0.42), 0.012, mat(C.steel), 6);
    for (const sx of [-1, 1]) b.box((w - cw) / 2, 0.03, d * 0.8, sx * (cw / 2 + (w - cw) / 4), ch - 0.06, 0, mat(C.steel));
    for (let i = 0; i < 4; i++) b.cyl(0.02, 0.02, 0.03, -cw * 0.3 + (i * cw * 0.6) / 3, ch - 0.09, d * 0.48, mat(C.black), 10).rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), mat(C.black), sx * cw * 0.4, 0.05, d * 0.3).rotation.z = Math.PI / 2;
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
  greenhouse: (b, w, d, h, f) => {
    const wall = h * 0.62;
    const frame = f;
    const pane = glass();
    b.box(w, 0.08, d, 0, 0, 0, mat(C.black));
    b.box(w - 0.04, wall - 0.08, d - 0.04, 0, 0.08, 0, pane);
    gableRoof(b, w, d, wall, h - wall, pane);
    const n = Math.max(2, Math.round(w / 0.6));
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + (i * w) / n;
      for (const sz of [-1, 1]) b.rod(v(x, 0, sz * d / 2), v(x, wall, sz * d / 2), 0.015, frame, 4);
      for (const sz of [-1, 1]) b.rod(v(x, wall, sz * d / 2), v(x, h, 0), 0.015, frame, 4);
    }
    for (const sx of [-1, 1]) for (const z of [-d / 2, 0, d / 2]) b.rod(v(sx * w / 2, 0, z), v(sx * w / 2, z === 0 ? h : wall, z), 0.015, frame, 4);
    for (const [a, c] of [[v(-w / 2, wall, -d / 2), v(w / 2, wall, -d / 2)], [v(-w / 2, wall, d / 2), v(w / 2, wall, d / 2)], [v(-w / 2, h, 0), v(w / 2, h, 0)]]) b.rod(a, c, 0.015, frame, 4);
    const rand = random(113);
    b.box(w * 0.8, 0.04, 0.4, 0, 0.75, -d / 2 + 0.3, mat(FINISHES.oak));
    for (let i = 0; i < 5; i++) foliage(b, rand, -w * 0.35 + (i * w * 0.7) / 4, 0.95, -d / 2 + 0.3, 0.12, 0.15, 0.12, 30, 0.07, [C.leaf, C.leafLight], true);
  },
  garden_shed: (b, w, d, h, f) => {
    const wall = h * 0.72;
    const rows = Math.max(4, Math.round(wall / 0.14));
    for (let r = 0; r < rows; r++) b.box(w, wall / rows - 0.006, d, 0, (r * wall) / rows, 0, f);
    gableRoof(b, w + 0.25, d + 0.25, wall, h - wall, mat(C.black));
    b.box(0.9, wall * 0.85, 0.03, -w * 0.15, 0, d / 2, mat((f as THREE.MeshStandardMaterial).color.clone().multiplyScalar(0.8).getStyle()));
    b.sphere(0.025, -w * 0.15 + 0.35, wall * 0.42, d / 2 + 0.03, mat(C.black), 1, 1, 1, 8);
    b.box(0.6, 0.45, 0.03, w * 0.28, wall * 0.45, d / 2, glass());
    b.box(0.66, 0.51, 0.02, w * 0.28, wall * 0.45 - 0.03, d / 2 - 0.005, mat(C.ceramic));
  },
  pool: (b, w, d, h, f) => {
    const t = 0.08;
    b.box(w, h, t, 0, 0, d / 2 - t / 2, f, 0.02);
    b.box(w, h, t, 0, 0, -d / 2 + t / 2, f, 0.02);
    b.box(t, h, d - 2 * t, -w / 2 + t / 2, 0, 0, f, 0.02);
    b.box(t, h, d - 2 * t, w / 2 - t / 2, 0, 0, f, 0.02);
    b.box(w - 2 * t, 0.02, d - 2 * t, 0, 0.02, 0, mat("#9fd3e0"));
    b.box(w - 2 * t, 0.02, d - 2 * t, 0, h - 0.2, 0, mat("#3fa4c8", { transparent: true, opacity: 0.7, roughness: 0.05 }));
    for (const sx of [-1, 1]) {
      b.rod(v(w / 2 - 0.4 + sx * 0.2, 0, d / 2 + 0.4), v(w / 2 - 0.4 + sx * 0.2, h + 0.3, d / 2 - 0.02), 0.02, mat(C.chrome), 6);
    }
    for (let i = 1; i < 4; i++) b.rod(v(w / 2 - 0.6, (h * i) / 4, d / 2 + 0.4 - (0.42 * i) / 4), v(w / 2 - 0.2, (h * i) / 4, d / 2 + 0.4 - (0.42 * i) / 4), 0.015, mat(C.chrome), 6);
  },
  trampoline: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    const top = Math.min(0.9, h * 0.35);
    const steel = mat(C.steel);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.rod(v(Math.cos(a) * r * 0.95, 0, Math.sin(a) * r * 0.95), v(Math.cos(a) * r, top, Math.sin(a) * r), 0.025, steel, 6);
      b.rod(v(Math.cos(a) * r, top, Math.sin(a) * r), v(Math.cos(a) * r * 0.97, h, Math.sin(a) * r * 0.97), 0.02, f, 6);
    }
    b.add(new THREE.TorusGeometry(r, 0.03, 6, 40), steel, 0, top, 0).rotation.x = Math.PI / 2;
    b.add(new THREE.TorusGeometry(r * 0.92, r * 0.08, 4, 40), f, 0, top + 0.02, 0).rotation.x = Math.PI / 2;
    b.cyl(r * 0.84, r * 0.84, 0.01, 0, top - 0.04, 0, mat(C.black), 40);
    b.add(new THREE.CylinderGeometry(r * 0.97, r, h - top, 32, 1, true), mat("#202326", { transparent: true, opacity: 0.25, side: THREE.DoubleSide }), 0, top + (h - top) / 2, 0);
    b.add(new THREE.TorusGeometry(r * 0.97, 0.025, 6, 40), f, 0, h, 0).rotation.x = Math.PI / 2;
  },
  swing: (b, w, d, h, f) => {
    const wood = mat(FINISHES.oak);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)), v(sx * (w / 2 - 0.05), h - 0.06, 0), 0.05, wood, 8);
    b.box(w, 0.1, 0.1, 0, h - 0.1, 0, wood);
    for (const sx of [-0.25, 0.25]) {
      const x = sx * w;
      for (const ox of [-0.2, 0.2]) b.rod(v(x + ox, h - 0.1, 0), v(x + ox, 0.42, 0), 0.008, mat(C.linen), 4);
      b.box(0.46, 0.04, 0.2, x, 0.4, 0, f, 0.01);
    }
  },
  playhouse: (b, w, d, h, f) => {
    const wall = h * 0.6;
    b.box(w, wall, d, 0, 0, 0, f, 0.01);
    gableRoof(b, w + 0.2, d + 0.2, wall, h - wall, mat(C.ceramic));
    b.box(0.5, wall * 0.8, 0.02, -w * 0.18, 0, d / 2, mat(C.ceramic));
    b.box(0.35, 0.35, 0.02, w * 0.22, wall * 0.45, d / 2, glass());
    b.box(0.41, 0.41, 0.015, w * 0.22, wall * 0.45 - 0.03, d / 2 - 0.004, mat(C.ceramic));
    b.box(0.35, 0.35, 0.02, w / 2, wall * 0.45, 0, glass())!.rotation.y = Math.PI / 2;
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
  robot_mower: (b, w, d, h, f) => {
    b.box(w, h * 0.55, d, 0, h * 0.15, 0, mat(C.black), 0.06);
    b.box(w * 0.92, h * 0.35, d * 0.85, 0, h * 0.6, -d * 0.03, f, 0.08);
    b.box(0.1, 0.04, 0.06, 0, h * 0.92, -d * 0.15, mat("#d23a2a"), 0.01);
    for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(h * 0.4, h * 0.4, 0.06, 18), mat(C.black), sx * (w / 2 - 0.02), h * 0.4, -d * 0.2).rotation.z = Math.PI / 2;
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
  solar_panel: (b, w, d, h, f) => {
    // lying flat: an aluminium frame, cells in a grid under glass (6 × 10 for a full panel)
    b.box(w, h, d, 0, 0, 0, mat(C.steel, { metalness: 0.5, roughness: 0.4 }), 0.004);
    const cols = Math.max(2, Math.round(w / 0.18));
    const rows = Math.max(2, Math.round(d / 0.17));
    const cw = (w - 0.04) / cols;
    const rd = (d - 0.04) / rows;
    const cell = f;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) b.box(cw - 0.006, 0.002, rd - 0.006, -w / 2 + 0.02 + (i + 0.5) * cw, h, -d / 2 + 0.02 + (j + 0.5) * rd, cell);
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
  wheelie_bin: (b, w, d, h, f, _c, a) => wheelieBin(b, 0, w - 0.03, d, h, f, a),
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
  wheelie_bins: (b, w, d, h) => {
    const colors = ["#3a3d41", "#2f5fa8", "#6b4a35", "#e2c33a"];
    const n = Math.max(1, Math.round(w / 0.62));
    const bw = w / n - 0.04;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const body = mat(colors[i % colors.length], { roughness: 0.6 });
      const geo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.88, 1, 4, 1, false, Math.PI / 4);
      geo.scale(bw, h - 0.12, d - 0.05);
      b.add(geo, body, x, (h - 0.12) / 2 + 0.04, 0);
      b.box(bw + 0.03, 0.04, d, x, h - 0.08, 0.01, body, 0.01);
      for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), mat(C.black), x + sx * (bw / 2 - 0.02), 0.1, -d / 2 + 0.1).rotation.z = Math.PI / 2;
      b.rod(v(x - bw * 0.4, h - 0.05, -d / 2 + 0.01), v(x + bw * 0.4, h - 0.05, -d / 2 + 0.01), 0.015, body, 6);
    }
  },
  heat_pump: (b, w, d, h, f) => outdoorUnit(b, w, d, h, f, false),
  // ----- kitchen, piece by piece (fronts in the finish, the worktop in the accent) -----
  kitchen_base: (b, w, d, h, f, _c, a) => {
    const u = kitchenBase(b, w, d, h, a);
    const n = Math.max(1, Math.round(w / 0.6));
    fronts(b, -w / 2, w, u.y1 - 0.17, 0.17, u.fz, n, f, 1, "bar");
    fronts(b, -w / 2, w, u.y0, u.y1 - u.y0 - 0.17, u.fz, n, f, 1, "bar");
  },
  kitchen_drawers: (b, w, d, h, f, _c, a) => {
    const u = kitchenBase(b, w, d, h, a);
    const n = Math.max(1, Math.round(w / 0.9));
    const rows = [0.17, 0.27, u.y1 - u.y0 - 0.44];
    let y = u.y1;
    for (const rh of rows) {
      y -= rh;
      fronts(b, -w / 2, w, y, rh, u.fz, n, f, 1, "bar");
    }
  },
  kitchen_sink_unit: (b, w, d, h, f, _c, a) => {
    const u = kitchenBase(b, w, d, h, a);
    fronts(b, -w / 2, w, u.y0, u.y1 - u.y0, u.fz, Math.max(1, Math.round(w / 0.45)), f, 1, "bar");
    const bw = Math.min(w - 0.16, 0.7);
    const steel = mat(C.steel, { metalness: 0.6, roughness: 0.3 });
    b.box(bw + 0.04, 0.006, d - 0.2, 0, h, 0.03, steel, 0.01);
    b.box(bw, 0.004, d - 0.26, 0, h + 0.002, 0.03, mat("#6d7277", { metalness: 0.5, roughness: 0.4 }), 0.03);
    b.cyl(0.025, 0.025, 0.004, 0, h + 0.006, 0.03, mat("#3a3d41"), 16);
    tapGooseneck(b, 0, h, back(d) + 0.07, mat(C.chrome, { metalness: 0.85, roughness: 0.2 }));
  },
  kitchen_hob_gas: (b, w, d, h, f, _c, a) => {
    const u = kitchenBase(b, w, d, h, a);
    oven(b, w, u, f);
    const steel = mat(C.steel, { metalness: 0.6, roughness: 0.35 });
    const iron = mat("#1f2023", { roughness: 0.6 });
    b.box(w - 0.06, 0.008, d - 0.1, 0, h, 0, steel, 0.004);
    const pw = w - 0.12;
    for (const [dx, dz, r] of [[-0.25, -0.22, 0.05], [0.25, -0.22, 0.04], [-0.25, 0.22, 0.04], [0.25, 0.22, 0.06]] as const) {
      const x = dx * pw;
      const z = dz * (d - 0.1);
      b.cyl(r * 1.4, r * 1.5, 0.012, x, h + 0.008, z, mat("#2b2c2e"), 20);
      b.cyl(r, r, 0.012, x, h + 0.02, z, iron, 20);
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + Math.PI / 4;
        b.rod(v(x + Math.cos(ang) * r * 0.9, h + 0.04, z + Math.sin(ang) * r * 0.9), v(x + Math.cos(ang) * r * 2.1, h + 0.04, z + Math.sin(ang) * r * 2.1), 0.005, iron, 4);
      }
      b.add(new THREE.TorusGeometry(r * 2.1, 0.005, 4, 20), iron, x, h + 0.04, z).rotation.x = Math.PI / 2;
    }
  },
  kitchen_hob_electric: (b, w, d, h, f, _c, a) => {
    // the old kind: four cast-iron plates with chrome rims, knobs on the front
    const u = kitchenBase(b, w, d, h, a);
    oven(b, w, u, f, true);
    b.box(w - 0.06, 0.012, d - 0.1, 0, h, 0, mat(C.ceramic, { roughness: 0.4 }), 0.006);
    const pw = w - 0.12;
    for (const [dx, dz, r] of [[-0.25, -0.22, 0.09], [0.25, -0.22, 0.072], [-0.25, 0.22, 0.072], [0.25, 0.22, 0.09]] as const) {
      const x = dx * pw;
      const z = dz * (d - 0.1);
      b.cyl(r, r, 0.016, x, h + 0.012, z, mat("#2a2b2e", { roughness: 0.7 }), 24);
      b.add(new THREE.TorusGeometry(r, 0.005, 4, 24), mat(C.chrome, { metalness: 0.8, roughness: 0.25 }), x, h + 0.026, z).rotation.x = Math.PI / 2;
      b.cyl(0.012, 0.012, 0.004, x, h + 0.028, z, mat("#d23a2a"), 8);
    }
  },
  kitchen_hob_ceran: (b, w, d, h, f, _c, a) => {
    const u = kitchenBase(b, w, d, h, a);
    oven(b, w, u, f);
    b.box(w - 0.04, 0.006, d - 0.06, 0, h, 0, mat(C.screen, { roughness: 0.08, metalness: 0.2 }), 0.004);
    const pw = w - 0.12;
    for (const [dx, dz, r] of [[-0.25, -0.22, 0.09], [0.25, -0.22, 0.075], [-0.25, 0.22, 0.075], [0.25, 0.22, 0.1]] as const)
      for (const k of [1, 0.6]) b.add(new THREE.RingGeometry(r * k - 0.003, r * k, 32), mat("#6a6d72"), dx * pw, h + 0.007, dz * (d - 0.1)).rotation.x = -Math.PI / 2;
    for (let i = 0; i < 6; i++) b.add(new THREE.CircleGeometry(0.006, 8), mat("#c9cdd1", { emissive: "#c9cdd1", emissiveIntensity: 0.3 }), -0.08 + i * 0.032, h + 0.007, d / 2 - 0.07).rotation.x = -Math.PI / 2;
  },
  kitchen_oven: (b, w, d, h, f, _c, a) => {
    const u = kitchenBase(b, w, d, h, a);
    oven(b, w, u, f);
  },
  kitchen_dishwasher: (b, w, d, h, f, _c, a) => {
    const u = kitchenBase(b, w, d, h, a);
    fronts(b, -w / 2, w, u.y0, u.y1 - u.y0, u.fz, 1, f, 1, "bar");
  },
  kitchen_corner: (b, w, d, h, f, _c, a) => {
    // the blind corner of an L: the worktop runs on, a door on the open part
    const t = 0.04;
    b.box(w - 0.05, 0.1, d - 0.05, -0.025, 0, -0.025, mat(C.black));
    b.box(w - 0.02, h - t - 0.1, d - 0.02, -0.01, 0.1, -0.01, mat("#e8e6e1"));
    b.box(w, t, d, 0, h - t, 0, a, 0.004);
    const open = Math.max(0.3, w - 0.62);
    fronts(b, -w / 2, open, 0.1, h - t - 0.1, d / 2 - 0.02, 1, f, 1, "bar");
    fronts(b, -w / 2, open, 0.1, 0, d / 2 - 0.02, 1, f, 1);
    const side = b.box(Math.max(0.3, d - 0.62), h - t - 0.1, 0.018, 0, 0.1, 0, f, 0.003);
    side?.position.set(w / 2 - 0.009 + 0.001, 0.1 + (h - t - 0.1) / 2, -d / 2 + Math.max(0.3, d - 0.62) / 2);
    side?.rotation.set(0, Math.PI / 2, 0);
  },
  kitchen_pantry: (b, w, d, h, f) => tallUnit(b, w, d, h, f, [0.45, 0.55]),
  kitchen_pantry_mid: (b, w, d, h, f) => tallUnit(b, w, d, h, f, [0.6, 0.4]),
  kitchen_tall_fridge: (b, w, d, h, f) => tallUnit(b, w, d, h, f, [0.33, 0.47, 0.2]),
  kitchen_tall_oven: (b, w, d, h, f) => {
    // drawers, an oven at eye height, a microwave over it, a door on top
    const z = d / 2 - 0.03;
    tallUnit(b, w, d, h, f, []);
    const y0 = 0.1;
    fronts(b, -w / 2, w, y0, 0.6, z, 1, f, 2, "bar");
    const oy = y0 + 0.62;
    applianceFront(b, w, oy, 0.6, z, "oven");
    applianceFront(b, w, oy + 0.62, 0.38, z, "microwave");
    fronts(b, -w / 2, w, oy + 1.02, h - (oy + 1.02), z, 1, f, 1, "bar");
  },
  kitchen_upper_glass: (b, w, d, h, f) => {
    const n = Math.max(1, Math.round(w / 0.5));
    hollow(b, w, h, d - 0.02, 0, back(d) + (d - 0.02) / 2, mat("#e8e6e1"), 0.018);
    for (let s = 1; s < 3; s++) b.box(w - 0.04, 0.015, d - 0.06, 0, (h * s) / 3, back(d) + (d - 0.04) / 2, mat("#f3f1ec"));
    for (let s = 0; s < 3; s++) for (let i = 0; i < Math.floor((w - 0.06) / 0.12); i++) b.cyl(0.05, 0.04, 0.03, -w / 2 + 0.09 + i * 0.12, (h * s) / 3 + 0.02, -0.03, mat(C.ceramic), 14);
    const cw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + cw * (i + 0.5);
      for (const [fx, fy, fw, fh] of [[0, 0, cw - 0.004, 0.05], [0, h - 0.05, cw - 0.004, 0.05], [-(cw / 2 - 0.027), 0, 0.05, h], [cw / 2 - 0.027, 0, 0.05, h]]) b.box(fw, fh, 0.018, x + fx, fy, d / 2 - 0.011, f);
      b.box(cw - 0.1, h - 0.1, 0.006, x, 0.05, d / 2 - 0.012, glass());
    }
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
  kitchen_hood: (b, w, d, h, f) => {
    // a chimney hood: a sloped canopy and the duct to the ceiling
    const canopy = Math.min(0.25, h * 0.3);
    const geo = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.35, Math.SQRT1_2, canopy, 4, 1, false, Math.PI / 4);
    geo.scale(w, 1, d);
    geo.translate(0, canopy / 2, 0);
    b.add(geo, f);
    b.box(w * 0.42, h - canopy, d * 0.42, 0, canopy, back(d) + d * 0.21, f);
    b.box(w - 0.04, 0.006, d - 0.04, 0, -0.003, 0, mat("#55595e", { metalness: 0.5, roughness: 0.5 }));
    for (const sx of [-1, 1]) b.add(new THREE.CircleGeometry(0.02, 12), mat("#fff3d6", { emissive: "#ffe8b8", emissiveIntensity: 0.7 }), sx * w * 0.3, -0.004, 0.05).rotation.x = Math.PI / 2;
  },
  fridge_freestanding: (b, w, d, h, f) => {
    b.box(w, h - 0.03, d - 0.05, 0, 0.03, -0.025, f, 0.03);
    const split = h * 0.62;
    b.box(w - 0.004, split - 0.04, 0.05, 0, h - split, d / 2 - 0.03, f, 0.02);
    b.box(w - 0.004, h - split - 0.06, 0.05, 0, 0.03, d / 2 - 0.03, f, 0.02);
    const handle = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
    b.box(0.02, 0.4, 0.03, w / 2 - 0.06, h - split + 0.05, d / 2 + 0.01, handle, 0.008);
    b.box(0.02, 0.3, 0.03, w / 2 - 0.06, h - split - 0.4, d / 2 + 0.01, handle, 0.008);
    for (const sx of [-1, 1]) b.cyl(0.02, 0.02, 0.03, sx * (w / 2 - 0.05), 0, d / 2 - 0.08, mat(C.black), 8);
  },
  fridge_double: (b, w, d, h, f) => {
    // side by side, with ice and water in the left door
    b.box(w, h - 0.03, d - 0.06, 0, 0.03, -0.03, f, 0.03);
    const handle = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
    for (const sx of [-1, 1]) {
      const dw = sx < 0 ? w * 0.42 : w * 0.58;
      const x = sx < 0 ? -w / 2 + dw / 2 : w / 2 - dw / 2;
      b.box(dw - 0.006, h - 0.05, 0.06, x, 0.04, d / 2 - 0.035, f, 0.02);
      b.box(0.022, h * 0.55, 0.035, sx < 0 ? -w / 2 + dw - 0.04 : w / 2 - dw + 0.04, h * 0.25, d / 2 + 0.01, handle, 0.008);
    }
    b.box(w * 0.2, 0.28, 0.01, -w / 2 + w * 0.21, h * 0.55, d / 2 + 0.002, mat("#2b2d31"), 0.01);
    b.box(w * 0.08, 0.02, 0.012, -w / 2 + w * 0.21, h * 0.55 + 0.23, d / 2 + 0.004, mat("#7fc7f0", { emissive: "#7fc7f0", emissiveIntensity: 0.5 }));
  },
  microwave: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.015);
    b.box(w * 0.68, h * 0.75, 0.006, -w * 0.12, h * 0.12, d / 2, mat(C.screen, { roughness: 0.1 }), 0.006);
    b.box(w * 0.18, h * 0.2, 0.006, w * 0.33, h * 0.68, d / 2, mat("#0f1a14", { emissive: "#3fd27a", emissiveIntensity: 0.15 }));
    for (let i = 0; i < 2; i++) b.cyl(0.018, 0.018, 0.015, w * 0.33, h * (0.22 + i * 0.22), d / 2 + 0.007, mat(C.steel), 14).rotation.x = Math.PI / 2;
  },
  coffee_capsule: (b, w, d, h, f) => {
    // a slim capsule machine: water tank at the back, a lever on top, a cup under the spout
    b.box(w, h * 0.85, d * 0.62, 0, 0, d * 0.19, f, 0.02);
    b.box(w * 0.9, h * 0.8, d * 0.36, 0, 0, -d * 0.31, glass(), 0.015);
    b.box(w * 0.9, 0.02, d * 0.75, 0, 0, d * 0.12, mat(C.steel, { metalness: 0.6, roughness: 0.3 }));
    b.box(w * 0.7, 0.04, 0.14, 0, h * 0.85, d * 0.2, mat(C.chrome, { metalness: 0.8, roughness: 0.2 }), 0.015)?.rotation.set(-0.3, 0, 0);
    b.cyl(0.035, 0.03, 0.07, 0, 0.02, d * 0.36, mat(C.ceramic), 14);
  },
  coffee_portafilter: (b, w, d, h, f) => {
    // a dual-boiler style espresso machine: steel body, group head, portafilter, steam wand, cups on top
    const steel = mat(C.chrome, { metalness: 0.8, roughness: 0.22 });
    b.box(w, h * 0.82, d * 0.8, 0, 0.04, -d * 0.1, f, 0.015);
    legs(b, w * 0.9, d * 0.7, 0.04, 0.02, 0.012, mat(C.black));
    b.box(w * 0.9, 0.02, d * 0.25, 0, 0.04, d * 0.36, steel);
    b.cyl(0.04, 0.045, 0.06, -w * 0.08, h * 0.5, d * 0.32, steel, 18);
    b.cyl(0.035, 0.035, 0.03, -w * 0.08, h * 0.5 - 0.035, d * 0.34, steel, 18);
    b.rod(v(-w * 0.08, h * 0.5 - 0.02, d * 0.34), v(-w * 0.08, h * 0.5 - 0.03, d * 0.5 + 0.08), 0.012, mat(C.black), 8);
    b.rod(v(w * 0.32, h * 0.62, d * 0.32), v(w * 0.36, h * 0.25, d * 0.4), 0.006, steel, 6);
    b.cyl(0.03, 0.03, 0.006, w * 0.25, h * 0.7, d * 0.31, mat("#f4f4f4"), 18).rotation.x = Math.PI / 2;
    b.cyl(0.03, 0.03, 0.006, -w * 0.32, h * 0.7, d * 0.31, mat("#f4f4f4"), 18).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) b.cyl(0.03, 0.025, 0.05, -w * 0.25 + i * w * 0.25, h * 0.86, -d * 0.1, mat(C.ceramic), 12);
    b.cyl(0.035, 0.03, 0.06, -w * 0.08, 0.06, d * 0.36, mat(C.ceramic), 14);
  },
  // ----- bathroom, more and rounder (ceramics in the finish, taps and frames in the accent) -----
  sink_wall: (b, w, d, h, f, _c, a) => {
    basin(b, w, d, h, f, 0.16);
    // a bottle trap under it
    b.cyl(0.02, 0.02, 0.12, 0, h - 0.3, -0.02, a, 12);
    b.sphere(0.035, 0, h - 0.33, -0.02, a, 1, 1.2, 1, 12);
    b.rod(v(0, h - 0.38, -0.02), v(0, h - 0.38, back(d)), 0.016, a, 8);
    tapBasin(b, 0, h, back(d) + 0.06, a);
  },
  sink_wall_square: (b, w, d, h, f, _c, a) => {
    basin(b, w, d, h, f, 0.12, true);
    b.box(0.05, 0.12, 0.05, 0, h - 0.24, -0.02, a, 0.01);
    b.rod(v(0, h - 0.2, -0.02), v(0, h - 0.2, back(d)), 0.016, a, 8);
    tapBasin(b, 0, h, back(d) + 0.06, a);
  },
  sink_pedestal: (b, w, d, h, f, _c, a) => {
    // standing: a rounded basin on a column
    basin(b, w, d, h, f, 0.16);
    const col = new THREE.LatheGeometry([[0.001, 0], [0.12, 0], [0.09, 0.15], [0.08, 0.8], [0.13, 1], [0.001, 1]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
    col.scale(1, h - 0.16, 0.8);
    b.add(col, f, 0, 0, -0.04);
    tapBasin(b, 0, h, back(d) + 0.06, a);
  },
  vanity_square: (b, w, d, h, f, _c, a) => vanity(b, w, d, h, f, Math.max(1, Math.round(w / 0.75)), a, true),
  sink_counter_square: (b, w, d, h, f, _c, a) => {
    // a rectangular bowl on a wall shelf
    const top = h - 0.13;
    b.box(w, 0.04, d, 0, top - 0.04, 0, surface("oak", 0.7), 0.006);
    const bw = Math.min(0.55, w - 0.1);
    b.box(bw, 0.13, d * 0.78, 0, top, 0.02, f, 0.015);
    flat(b, bw - 0.06, d * 0.78 - 0.06, h + 0.002, 0.02, mat("#dcdcd8", { roughness: 0.3 }), true);
    tapBasin(b, bw / 2 + 0.08 > w / 2 ? 0 : bw / 2 + 0.06, top, back(d) + 0.05, a, 0.26);
  },
  sink_wall_small: (b, w, d, h, f, _c, a) => {
    basin(b, w, d, h, f, 0.13);
    b.cyl(0.018, 0.018, 0.1, 0, h - 0.24, -0.02, a, 12);
    b.rod(v(0, h - 0.28, -0.02), v(0, h - 0.28, back(d)), 0.014, a, 8);
    tapBasin(b, -w * 0.25, h, back(d) + 0.05, a);
  },
  vanity_floor: (b, w, d, h, f, _c, a) => {
    // a standing washstand: open shelf below, a bowl on top
    const top = h - 0.14;
    legs(b, w, d, top - 0.03, 0.03, 0.015, a, true);
    b.box(w, 0.03, d, 0, top - 0.03, 0, f, 0.005);
    b.box(w - 0.06, 0.02, d - 0.06, 0, 0.18, 0, f, 0.004);
    for (let i = 0; i < 3; i++) b.box(0.32, 0.06, d * 0.6, -w / 4, 0.2 + i * 0.065, 0, mat(i % 2 ? C.linen : "#cfd8dc", { roughness: 1 }), 0.02);
    vessel(b, Math.min(0.5, w * 0.55), d * 0.75, top, mat(C.ceramic, { roughness: 0.3 }));
    tapBasin(b, 0, top, back(d) + 0.05, a, 0.28);
  },
  toilet_prewall: (b, w, d, h, f, _c, a) => {
    // a pre-wall box across the niche with a ledge, the bowl hung in front of it
    const pd = 0.2;
    b.box(w, h, pd, 0, 0, back(d) + pd / 2, mat("#e9e7e2"), 0.006);
    b.box(w + 0.02, 0.02, pd + 0.02, 0, h, back(d) + pd / 2, mat("#f1efea"), 0.004);
    flushPlate(b, 0, Math.min(h, 1.05) - 0.12, back(d) + pd, a);
    toiletBowl(b, Math.min(0.37, w), d - pd, back(d) + pd, f, a);
  },
  shower_walk_in: (b, w, d, h, f, _c, a) => walkIn(b, w, d, h, f, a, false),
  shower_large: (b, w, d, h, f, _c, a) => walkIn(b, w, d, h, f, a, true),
  shower_niche: (b, w, d, h, f, _c, a) => {
    // between three walls: a tray and a hinged glass door across the front
    b.box(w, 0.04, d, 0, 0, 0, mat(C.ceramic), 0.01);
    b.box(w * 0.5, 0.004, 0.05, 0, 0.04, back(d) + 0.1, mat("#999"));
    b.box(w - 0.04, h - 0.06, 0.008, 0, 0.05, d / 2 - 0.02, glass());
    for (const sx of [-1, 1]) b.box(0.025, h - 0.04, 0.03, sx * (w / 2 - 0.0125), 0.04, d / 2 - 0.02, f);
    b.box(w, 0.025, 0.03, 0, h - 0.025, d / 2 - 0.02, f);
    b.box(0.015, 0.3, 0.03, w / 2 - 0.1, h * 0.45, d / 2 + 0.005, f, 0.005);
    showerSet(b, 0, h, back(d), a, false);
  },
  shower_corner: (b, w, d, h, f, _c, a) => {
    // two glass sides on a square tray, the door at the front
    b.box(w, 0.04, d, 0, 0, 0, mat(C.ceramic), 0.01);
    b.cyl(0.04, 0.04, 0.005, 0, 0.04, 0, mat("#999"), 16);
    b.box(w - 0.02, h - 0.06, 0.008, 0, 0.05, d / 2 - 0.02, glass());
    b.box(0.008, h - 0.06, d - 0.02, w / 2 - 0.02, 0.05, 0, glass());
    b.box(0.03, h - 0.04, 0.03, w / 2 - 0.02, 0.04, d / 2 - 0.02, f);
    b.box(w, 0.02, 0.025, 0, h - 0.02, d / 2 - 0.02, f);
    b.box(0.025, 0.02, d, w / 2 - 0.02, h - 0.02, 0, f);
    b.box(0.015, 0.3, 0.03, 0, h * 0.45, d / 2 + 0.005, f, 0.005);
    showerSet(b, -w / 2 + 0.05, h, back(d), a, true);
  },
  shower_quadrant: (b, w, d, h, f, _c, a) => {
    // a quarter circle in the corner (back left), curved sliding glass
    const tray = new THREE.CylinderGeometry(1, 1, 0.04, 24, 1, false, 0, Math.PI / 2);
    tray.scale(w, 1, d);
    tray.translate(-w / 2, 0.02, -d / 2);
    b.add(tray, mat(C.ceramic));
    const curved = new THREE.CylinderGeometry(1, 1, h - 0.06, 24, 1, true, 0, Math.PI / 2);
    curved.scale(w - 0.02, 1, d - 0.02);
    curved.translate(-w / 2, 0.05 + (h - 0.06) / 2, -d / 2);
    b.add(curved, mat("#cfe3ea", { transparent: true, opacity: 0.3, roughness: 0.1, side: THREE.DoubleSide }));
    const rail = new THREE.TorusGeometry(1, 0.012, 4, 24, Math.PI / 2);
    rail.rotateX(Math.PI / 2);
    rail.rotateY(Math.PI / 2);
    rail.scale(w - 0.02, 1, d - 0.02);
    for (const y of [0.05, h - 0.02]) b.add(rail.clone(), f, -w / 2, y, -d / 2);
    showerSet(b, -w / 2 + 0.04, h, -d / 2 + 0.25, a, true);
  },
  bathtub_oval: (b, w, d, h, f, _c, a) => {
    tubLathe(b, w, d, h, f, 0.5);
    floorTap(b, w / 2 + 0.15, h, 0, a);
  },
  bathtub_round: (b, w, d, h, f, _c, a) => {
    tubLathe(b, w, d, h, f, 0.5);
    floorTap(b, Math.min(w, d) / 2 + 0.12, h, 0, a);
  },
  bathtub_square: (b, w, d, h, f, _c, a) => {
    // crisp, slightly rounded block; a soft rectangle of water-white inside
    b.box(w, h, d, 0, 0, 0, f, 0.05);
    const inner = new THREE.Shape();
    const iw = w - 0.16;
    const id = d - 0.16;
    const r = Math.min(0.18, id / 2 - 0.01);
    inner.moveTo(-iw / 2 + r, -id / 2);
    inner.lineTo(iw / 2 - r, -id / 2);
    inner.quadraticCurveTo(iw / 2, -id / 2, iw / 2, -id / 2 + r);
    inner.lineTo(iw / 2, id / 2 - r);
    inner.quadraticCurveTo(iw / 2, id / 2, iw / 2 - r, id / 2);
    inner.lineTo(-iw / 2 + r, id / 2);
    inner.quadraticCurveTo(-iw / 2, id / 2, -iw / 2, id / 2 - r);
    inner.lineTo(-iw / 2, -id / 2 + r);
    inner.quadraticCurveTo(-iw / 2, -id / 2, -iw / 2 + r, -id / 2);
    b.add(new THREE.ShapeGeometry(inner, 6), mat("#dfe9ec", { roughness: 0.2 }), 0, h + 0.002, 0).rotation.x = -Math.PI / 2;
    floorTap(b, w / 2 + 0.15, h, 0, a);
  },
  bathtub_built_in: (b, w, d, h, f, _c, a) => {
    // a tiled apron, the tub's rim on top, taps and a hand shower on the wall
    b.box(w, h - 0.03, d, 0, 0, 0, tileMaterial(), 0);
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.01);
    const oval = new THREE.CircleGeometry(0.5, 32);
    oval.scale(w - 0.2, d - 0.16, 1);
    b.add(oval, mat("#dfe9ec", { roughness: 0.2 }), 0, h + 0.002, 0.01).rotation.x = -Math.PI / 2;
    b.box(0.2, 0.06, 0.06, 0, h + 0.15, back(d) + 0.03, a, 0.015);
    b.rod(v(0, h + 0.15, back(d) + 0.06), v(0, h + 0.12, back(d) + 0.16), 0.012, a);
    b.rod(v(w * 0.3, h + 0.25, back(d) + 0.02), v(w * 0.3, h + 0.85, back(d) + 0.02), 0.01, a);
  },
  bathtub_corner: (b, w, d, h, f, _c, a) => {
    // a quarter-round front, the bath turned towards the room
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2);
    s.lineTo(w / 2, -d / 2);
    s.lineTo(w / 2, -d / 2 + d * 0.35);
    s.quadraticCurveTo(w / 2 - w * 0.1, d / 2 - d * 0.1, -w / 2 + w * 0.35, d / 2);
    s.lineTo(-w / 2, d / 2);
    s.lineTo(-w / 2, -d / 2);
    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 12 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, h, 0);
    b.add(geo, f);
    const oval = new THREE.CircleGeometry(0.5, 32);
    oval.scale(Math.hypot(w, d) * 0.62, Math.min(w, d) * 0.55, 1);
    const m = b.add(oval, mat("#dfe9ec", { roughness: 0.2 }), -w * 0.03, h + 0.023, -d * 0.03);
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    b.cyl(0.02, 0.02, 0.1, -w / 2 + 0.12, h, -d / 2 + 0.12, a, 10);
    b.rod(v(-w / 2 + 0.12, h + 0.1, -d / 2 + 0.12), v(-w / 2 + 0.22, h + 0.08, -d / 2 + 0.22), 0.012, a);
  },
  whirlpool: (b, w, d, h, f, _c, a) => {
    // a square spa: clad shell, cushioned rim, seats and jets under the water
    b.box(w, h - 0.1, d, 0, 0, 0, f, 0.04);
    const rim = mat("#d8d6d2", { roughness: 0.6 });
    for (const sz of [-1, 1]) b.box(w, 0.06, 0.14, 0, h - 0.06, sz * (d / 2 - 0.07), rim, 0.03);
    for (const sx of [-1, 1]) b.box(0.14, 0.06, d - 0.2, sx * (w / 2 - 0.07), h - 0.06, 0, rim, 0.03);
    b.box(w - 0.1, 0.01, d - 0.1, 0, h - 0.1, 0, mat("#bfe6ef", { roughness: 0.3 }));
    b.box(w - 0.12, 0.01, d - 0.12, 0, h - 0.075, 0, mat("#3fa4c8", { transparent: true, opacity: 0.55, roughness: 0.05 }));
    for (const sx of [-1, 1]) b.box(0.14, 0.04, d - 0.2, sx * (w / 2 - 0.07), h - 0.1, 0, f, 0.01);
    const rand = random(151);
    for (let i = 0; i < 18; i++) {
      const side = i % 4;
      const t = (rand() - 0.5) * 0.7;
      const x = side < 2 ? t * w : (side === 2 ? -1 : 1) * (w / 2 - 0.13);
      const z = side >= 2 ? t * d : (side === 0 ? -1 : 1) * (d / 2 - 0.13);
      b.cyl(0.018, 0.018, 0.012, x, h - 0.2, z, a, 10);
    }
    for (const sx of [-1, 1]) b.box(0.28, 0.08, 0.14, sx * (w / 2 - 0.3), h - 0.04, back(d) + 0.08, mat(C.black, { roughness: 1 }), 0.03);
    b.box(0.6, 0.18, 0.3, 0, 0, d / 2 + 0.15, f, 0.02);
  },
  // ----- chairs and seats -----
  chair_cantilever: (b, w, d, h, f, _c, a) => {
    // one bent tube per side: along the floor, up at the front, back under the seat, up the back
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.02);
      const pts = [v(x, 0.012, -d / 2 + 0.04), v(x, 0.012, d / 2 - 0.06), v(x, 0.06, d / 2 - 0.02), v(x, 0.4, d / 2 - 0.04), v(x, 0.44, d / 2 - 0.1), v(x, 0.44, -d / 2 + 0.08), v(x, 0.5, -d / 2 + 0.04), v(x, h - 0.02, -d / 2 + 0.02)];
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.1), 48, 0.011, 8), a);
    }
    b.box(w - 0.02, 0.05, d - 0.14, 0, 0.44, 0.0, f, 0.02);
    b.box(w - 0.02, 0.3, 0.04, 0, h - 0.33, -d / 2 + 0.04, f, 0.015)?.rotation.set(-0.08, 0, 0);
  },
  chair_upholstered: (b, w, d, h, f, _c, a) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.018, 0.013, 0.42, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.06), a, 10);
    b.box(w, 0.09, d - 0.04, 0, 0.4, 0.02, f, 0.035);
    const back2 = b.box(w - 0.02, h - 0.46, 0.08, 0, 0, 0, f, 0.035);
    back2?.position.set(0, 0.46 + (h - 0.46) / 2, -d / 2 + 0.06);
    back2?.rotation.set(-0.1, 0, 0);
  },
  chair_spindle: (b, w, d, h, f) => {
    // Windsor: a saddle seat, splayed legs, spindles under a curved crest rail
    const seat = new THREE.CylinderGeometry(0.5, 0.5, 0.04, 28);
    seat.scale(w, 1, d);
    b.add(seat, f, 0, 0.44, 0.02);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * w * 0.3, 0.43, sz * d * 0.28), v(sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02)), 0.016, f, 8);
    const r = w * 0.48;
    const crest = new THREE.TorusGeometry(r, 0.02, 6, 20, Math.PI * 0.8);
    crest.rotateX(Math.PI / 2);
    crest.rotateY(Math.PI * 0.1 + Math.PI);
    b.add(crest, f, 0, h - 0.03, -d / 2 + r * 0.55 + 0.02);
    for (let i = 0; i < 7; i++) {
      const ang = Math.PI * 1.1 + (i / 6) * Math.PI * 0.8;
      const x = Math.cos(ang) * r;
      const z = -Math.sin(ang) * r * -1;
      b.rod(v(x * 0.85, 0.46, -d / 2 + r * 0.55 + 0.02 + z * 0.85), v(x, h - 0.03, -d / 2 + r * 0.55 + 0.02 + z), 0.008, f, 6);
    }
  },
  chair_wishbone: (b, w, d, h, f) => {
    // a woven seat, a bow of a backrest-armrest on its Y-shaped back support
    const cord = mat("#d9c49a", { roughness: 1 });
    for (const sx of [-1, 1]) {
      b.rod(v(sx * (w / 2 - 0.04), 0, d / 2 - 0.04), v(sx * (w / 2 - 0.05), 0.44, d / 2 - 0.06), 0.016, f, 8);
      b.rod(v(sx * (w / 2 - 0.05), 0, -d / 2 + 0.05), v(sx * (w / 2 - 0.08), h - 0.04, -d / 2 + 0.1), 0.016, f, 8);
    }
    b.box(w - 0.08, 0.035, d - 0.1, 0, 0.42, 0, cord, 0.012);
    const bow = new THREE.TorusGeometry(w / 2 - 0.06, 0.018, 6, 24, Math.PI);
    bow.rotateX(Math.PI / 2);
    bow.scale(1, 1, 0.75);
    b.add(bow, f, 0, h - 0.03, -d / 2 + 0.1);
    b.rod(v(0, 0.46, -d / 2 + 0.08), v(-0.06, h - 0.2, -d / 2 + 0.1), 0.012, f, 6);
    b.rod(v(0, 0.46, -d / 2 + 0.08), v(0.06, h - 0.2, -d / 2 + 0.1), 0.012, f, 6);
  },
  chair_folding: (b, w, d, h, f, _c, a) => {
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.02);
      b.rod(v(x, 0, d / 2 - 0.03), v(x, h, -d / 2 + 0.03), 0.01, a, 6);
      b.rod(v(x, 0, -d / 2 + 0.05), v(x, 0.45, d / 2 - 0.08), 0.01, a, 6);
    }
    for (let i = 0; i < 4; i++) b.box(w - 0.06, 0.016, 0.08, 0, 0.44, -d / 2 + 0.12 + i * 0.095, f, 0.004);
    for (let i = 0; i < 2; i++) b.box(w - 0.06, 0.07, 0.016, 0, h - 0.2 + i * 0.09, -d / 2 + 0.06 - i * 0.012, f, 0.004)?.rotation.set(-0.25, 0, 0);
  },
  lounge_chair: (b, w, d, h, f, _c, a) => {
    // the classic lounge chair: plywood shells, leather cushions, a star base
    const metal = mat("#9ca3aa", { metalness: 0.6, roughness: 0.35 });
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + Math.PI / 2;
      b.box(0.04, 0.03, 0.36, Math.cos(ang) * 0.17, 0.02, Math.sin(ang) * 0.17, metal, 0.01)?.rotation.set(0, -ang + Math.PI / 2, 0);
    }
    b.cyl(0.035, 0.035, 0.22, 0, 0.03, 0, metal, 12);
    const seat = b.box(w * 0.82, 0.05, d * 0.62, 0, 0, 0, a, 0.02);
    seat?.position.set(0, 0.3, 0.06);
    seat?.rotation.set(-0.12, 0, 0);
    const cushion = b.box(w * 0.78, 0.12, d * 0.58, 0, 0, 0, f, 0.05);
    cushion?.position.set(0, 0.38, 0.07);
    cushion?.rotation.set(-0.12, 0, 0);
    const backShell = b.box(w * 0.8, h * 0.6, 0.05, 0, 0, 0, a, 0.02);
    backShell?.position.set(0, 0.62, -d / 2 + 0.12);
    backShell?.rotation.set(-0.35, 0, 0);
    const backCushion = b.box(w * 0.74, h * 0.56, 0.12, 0, 0, 0, f, 0.05);
    backCushion?.position.set(0, 0.64, -d / 2 + 0.2);
    backCushion?.rotation.set(-0.35, 0, 0);
    for (const sx of [-1, 1]) {
      b.box(0.1, 0.05, d * 0.5, sx * (w / 2 - 0.06), 0.52, 0.0, a, 0.02);
      b.box(0.1, 0.06, d * 0.46, sx * (w / 2 - 0.06), 0.57, 0.0, f, 0.025);
    }
  },
  lounge_ottoman: (b, w, d, h, f, _c, a) => {
    const metal = mat("#9ca3aa", { metalness: 0.6, roughness: 0.35 });
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.box(0.035, 0.03, 0.3, Math.cos(ang) * 0.14, 0.02, Math.sin(ang) * 0.14, metal, 0.01)?.rotation.set(0, -ang + Math.PI / 2, 0);
    }
    b.cyl(0.03, 0.03, h - 0.2, 0, 0.03, 0, metal, 12);
    b.box(w, 0.05, d, 0, h - 0.18, 0, a, 0.02);
    b.box(w - 0.04, 0.13, d - 0.04, 0, h - 0.14, 0, f, 0.05);
  },
  armchair_wingback: (b, w, d, h, f, _c, a) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.02, 0.014, 0.16, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), a, 10);
    b.box(w - 0.06, 0.26, d - 0.06, 0, 0.15, 0.02, f, 0.05);
    b.box(w - 0.24, 0.12, d - 0.26, 0, 0.4, 0.1, f, 0.05);
    b.box(w - 0.14, h - 0.4, 0.16, 0, 0.4, -d / 2 + 0.1, f, 0.06);
    for (const sx of [-1, 1]) {
      b.box(0.12, 0.26, d - 0.2, sx * (w / 2 - 0.09), 0.4, 0.06, f, 0.05);
      const wing = b.box(0.1, h * 0.42, d * 0.36, 0, 0, 0, f, 0.04);
      wing?.position.set(sx * (w / 2 - 0.07), h * 0.72, -d / 2 + d * 0.22);
      wing?.rotation.set(0, sx * 0.25, 0);
    }
  },
  rocking_chair: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.03);
      const rocker = new THREE.TorusGeometry(d * 1.1, 0.018, 6, 24, 0.95);
      rocker.rotateZ(Math.PI * 1.5 - 0.475);
      rocker.rotateY(Math.PI / 2);
      b.add(rocker, f, x, d * 1.1 + 0.02, 0);
      b.rod(v(x, 0.04, d * 0.28), v(x, 0.42, d * 0.25), 0.016, f, 8);
      b.rod(v(x, 0.04, -d * 0.28), v(x, h, -d * 0.36), 0.016, f, 8);
      b.rod(v(x, 0.62, d * 0.25), v(x, 0.62, -d * 0.32), 0.014, f, 8);
      b.rod(v(x, 0.42, d * 0.25), v(x, 0.62, d * 0.25), 0.014, f, 8);
    }
    b.box(w - 0.04, 0.035, d * 0.55, 0, 0.42, -0.01, f, 0.01);
    for (let i = 0; i < 5; i++) b.rod(v(-w * 0.3 + (i * w * 0.6) / 4, 0.45, -d * 0.29), v(-w * 0.3 + (i * w * 0.6) / 4, h - 0.04, -d * 0.35), 0.009, f, 6);
    b.box(w - 0.04, 0.06, 0.03, 0, h - 0.06, -d * 0.355, f, 0.01);
  },
  egg_chair: (b, w, d, h, f, _c, a) => {
    // a woven egg hanging from an arched stand
    const r = Math.min(w, d) * 0.42;
    b.cyl(0.32, 0.34, 0.04, 0, 0, -d * 0.1, a, 28);
    const arch = new THREE.CatmullRomCurve3([v(0, 0.04, -d * 0.1), v(0, h * 0.6, -d / 2 + 0.02), v(0, h, -d * 0.2), v(0, h - 0.02, 0.05)]);
    b.add(new THREE.TubeGeometry(arch, 24, 0.025, 8), a);
    b.rod(v(0, h - 0.05, 0.05), v(0, h * 0.55 + r * 1.3, 0.05), 0.008, a, 6);
    const shell = new THREE.SphereGeometry(r, 28, 14, Math.PI * 0.25, Math.PI * 1.5);
    shell.scale(1, 1.35, 1);
    b.add(shell, mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, h * 0.55, 0.05).rotation.y = Math.PI;
    b.cyl(r * 0.8, r * 0.8, 0.08, 0, h * 0.55 - r * 0.6, 0.08, mat(C.linen, { roughness: 1 }), 24);
  },
  bean_bag: (b, w, d, h, f) => {
    const geo = new THREE.SphereGeometry(0.5, 24, 14);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // flat below, a dip where one sits, leaning back
      pos.setY(i, Math.max(y, -0.38) + (z > 0 && y > 0 ? -0.18 * y : 0));
    }
    geo.computeVertexNormals();
    geo.scale(w, h * 1.1, d);
    b.add(geo, f, 0, h * 0.42, 0);
  },
  stool_wood: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.035, 0, h - 0.035, 0, f, 28);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      b.rod(v(Math.cos(ang) * r * 0.55, h - 0.035, Math.sin(ang) * r * 0.55), v(Math.cos(ang) * r * 0.95, 0, Math.sin(ang) * r * 0.95), 0.016, f, 8);
    }
  },
  pouf: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.add(new THREE.CapsuleGeometry(r - h * 0.25, 0.001, 6, 24).scale(1, (h * 0.5) / r, 1), f, 0, h / 2, 0);
    b.cyl(r * 0.98, r * 0.98, h * 0.5, 0, h * 0.25, 0, f, 28);
  },
  dining_bench: (b, w, d, h, f) => {
    b.box(w, 0.045, d, 0, h - 0.045, 0, f, 0.008);
    for (const sx of [-1, 1]) b.box(0.05, h - 0.045, d - 0.04, sx * (w / 2 - 0.12), 0, 0, f, 0.006);
    b.box(w - 0.3, 0.04, 0.03, 0, 0.12, 0, f, 0.005);
  },
  // ----- lighting (ceiling pieces hang from y = h; shades in the finish, fittings in the accent) -----
  pendant_dome: (b, w, d, h, f, c, a) => {
    const r = Math.min(w, d) / 2;
    canopyAndCord(b, h, r * 0.9, a);
    b.add(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), shadeMat(f, c), 0, r * 0.75 - r, 0).scale.y = 0.75;
    b.cyl(0.03, 0.03, 0.05, 0, r * 0.75 - 0.03, 0, a, 12);
    bulb(b, 0, 0.06, 0, 0.04);
  },
  pendant_globe: (b, w, _d, h, _f, _c, a) => {
    const r = w / 2;
    canopyAndCord(b, h, r * 2, a);
    b.cyl(0.03, 0.04, 0.04, 0, r * 2 - 0.02, 0, a, 14);
    b.sphere(r, 0, r, 0, opal(), 1, 1, 1, 28);
  },
  pendant_linear: (b, w, d, h, f, _c, a) => {
    // a long bar over a table, on two wires
    const bh = 0.06;
    for (const sx of [-1, 1]) {
      b.rod(v(sx * w * 0.35, bh, 0), v(sx * w * 0.35, h, 0), 0.002, a, 4);
      b.cyl(0.04, 0.04, 0.015, sx * w * 0.35, h - 0.015, 0, a, 14);
    }
    b.box(w, bh, Math.min(d, 0.08), 0, 0, 0, f, 0.01);
    b.box(w - 0.04, 0.005, Math.min(d, 0.08) - 0.02, 0, -0.004, 0, opal());
  },
  pendant_cluster: (b, w, d, h, _f, _c, a) => {
    const rand = random(163);
    b.cyl(Math.min(w, d) * 0.35, Math.min(w, d) * 0.35, 0.02, 0, h - 0.02, 0, a, 24);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const rr = Math.min(w, d) * 0.28;
      const r = 0.06 + rand() * 0.05;
      const y = r + rand() * (h * 0.5);
      b.rod(v(Math.cos(ang) * rr, y + r, Math.sin(ang) * rr), v(Math.cos(ang) * rr, h - 0.02, Math.sin(ang) * rr), 0.003, a, 4);
      b.sphere(r, Math.cos(ang) * rr, y, Math.sin(ang) * rr, opal(), 1, 1, 1, 18);
    }
  },
  pendant_rattan: (b, w, d, h, f, c, a) => {
    const r = Math.min(w, d) / 2;
    const sh = Math.min(h * 0.5, r * 1.1);
    canopyAndCord(b, h, sh, a);
    const profile = [[0.05, 1], [0.35, 0.92], [0.48, 0.6], [0.5, 0.3], [0.4, 0]].map(([x, y]) => new THREE.Vector2(x * r * 2, y * sh));
    b.add(new THREE.LatheGeometry(profile, 32), wickerMat(c), 0, 0, 0);
    bulb(b, 0, sh * 0.35, 0, 0.05);
    void f;
  },
  ceiling_flush: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r * 0.96, h * 0.4, 0, h * 0.6, 0, a, 36);
    b.add(new THREE.SphereGeometry(r * 0.94, 36, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), opal(), 0, h * 0.6, 0).scale.y = (h * 0.6) / (r * 0.94);
    void f;
  },
  ceiling_spots: (b, w, d, h, f) => {
    // a track with three spots
    b.box(w, 0.035, 0.04, 0, h - 0.035, 0, f, 0.006);
    const n = Math.max(2, Math.round(w / 0.4));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      b.cyl(0.012, 0.012, 0.04, x, h - 0.075, 0, f, 8);
      const spot = b.add(new THREE.CylinderGeometry(0.035, 0.03, 0.11, 18), f, x, h - 0.12, 0.02);
      spot.rotation.x = 0.5 * (i % 2 ? 1 : -1);
      b.add(new THREE.CircleGeometry(0.028, 16), glowMat(), x, h - 0.17, 0.02 + (i % 2 ? 0.03 : -0.03)).rotation.x = Math.PI / 2;
    }
    void d;
  },
  chandelier: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, d) / 2 - 0.05;
    b.rod(v(0, h * 0.35, 0), v(0, h, 0), 0.006, a, 6);
    b.sphere(0.04, 0, h * 0.32, 0, a, 1, 1, 1, 14);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const tip = v(Math.cos(ang) * r, h * 0.3, Math.sin(ang) * r);
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v(0, h * 0.32, 0), v(Math.cos(ang) * r * 0.5, h * 0.12, Math.sin(ang) * r * 0.5), tip]), 12, 0.008, 6), a);
      b.cyl(0.03, 0.02, 0.03, tip.x, tip.y, tip.z, a, 10);
      b.cyl(0.012, 0.012, 0.09, tip.x, tip.y + 0.03, tip.z, mat(C.ceramic), 8);
      bulb(b, tip.x, tip.y + 0.14, tip.z, 0.018);
    }
    void f;
  },
  wall_sconce: (b, w, d, h, f) => {
    // a cylinder throwing light up and down
    b.box(w * 0.5, h * 0.4, 0.015, 0, h * 0.3, back(d) + 0.0075, f, 0.004);
    b.box(0.03, 0.03, d - 0.08, 0, h / 2 - 0.015, back(d) + (d - 0.08) / 2, f);
    b.cyl(Math.min(w, 0.12) / 2, Math.min(w, 0.12) / 2, h, 0, 0, d / 2 - Math.min(w, 0.12) / 2, f, 20);
    for (const y of [-0.001, h + 0.001]) b.add(new THREE.CircleGeometry(Math.min(w, 0.12) / 2 - 0.01, 16), glowMat(), 0, y, d / 2 - Math.min(w, 0.12) / 2).rotation.x = y < 0 ? Math.PI / 2 : -Math.PI / 2;
  },
  wall_swing_arm: (b, w, d, h, f, c, a) => {
    b.box(0.08, 0.14, 0.02, 0, h * 0.3, back(d) + 0.01, a, 0.01);
    b.rod(v(0, h * 0.37, back(d) + 0.02), v(0, h * 0.55, d / 2 - 0.12), 0.008, a, 6);
    const shade = b.add(new THREE.CylinderGeometry(0.05, Math.min(w, 0.2) / 2, 0.16, 24, 1, true), shadeMat(f, c), 0, h * 0.5, d / 2 - 0.1);
    shade.rotation.x = 0.5;
    bulb(b, 0, h * 0.47, d / 2 - 0.09, 0.03);
  },
  wall_globe: (b, w, d, h, _f, _c, a) => {
    const r = Math.min(w, h) / 2 - 0.01;
    b.cyl(0.06, 0.06, 0.02, 0, h / 2, back(d) + 0.01, a, 20).rotation.x = Math.PI / 2;
    b.rod(v(0, h / 2, back(d) + 0.02), v(0, h / 2, d / 2 - r * 2), 0.01, a, 8);
    b.sphere(r, 0, h / 2, d / 2 - r, opal(), 1, 1, 1, 24);
  },
  wall_updown: (b, w, d, h, f) => {
    // outdoor: a square tube lighting the wall up and down
    b.box(w, h, d - 0.02, 0, 0, 0.01, f, 0.008);
    for (const y of [-0.001, h + 0.001]) b.add(new THREE.PlaneGeometry(w - 0.02, d - 0.04), glowMat(), 0, y, 0.01).rotation.x = y < 0 ? Math.PI / 2 : -Math.PI / 2;
  },
  table_lamp_mushroom: (b, w, _d, h, f) => {
    const r = w / 2;
    b.cyl(r * 0.55, r * 0.6, 0.02, 0, 0, 0, f, 28);
    b.cyl(0.025, 0.035, h - r * 0.55, 0, 0.02, 0, f, 16);
    b.add(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), f, 0, h - r * 0.6, 0).scale.y = 0.6;
    b.add(new THREE.CircleGeometry(r * 0.97, 32), glowMat(), 0, h - r * 0.6 - 0.002, 0).rotation.x = Math.PI / 2;
  },
  table_lamp_ceramic: (b, w, _d, h, f, c, a) => {
    // a turned vase base, a pleated drum shade
    const base = [[0.001, 0], [0.32, 0], [0.42, 0.12], [0.45, 0.25], [0.3, 0.42], [0.12, 0.48], [0.1, 0.52], [0.001, 0.52]].map(([x, y]) => new THREE.Vector2(x * w * 0.7, y * h));
    b.add(new THREE.LatheGeometry(base, 32), f);
    b.cyl(0.008, 0.008, h * 0.2, 0, h * 0.52, 0, a, 8);
    const pleats = new THREE.CylinderGeometry(w * 0.36, w * 0.5, h * 0.34, 36, 1, true);
    const pos = pleats.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const k = 1 + 0.04 * Math.cos(ang * 18);
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    pleats.computeVertexNormals();
    b.add(pleats, mat(C.shade, { side: THREE.DoubleSide, roughness: 1 }), 0, h * 0.83, 0);
    bulb(b, 0, h * 0.72, 0, 0.03);
    void c;
  },
  desk_lamp: (b, w, d, h, f, _c, a) => {
    // an architect lamp: weighted foot, two arms, a cone head
    b.cyl(0.08, 0.09, 0.03, 0, 0, 0, f, 24);
    const knee = v(0, h * 0.6, -d * 0.2);
    const head = v(w * 0.3, h * 0.85, d * 0.25);
    b.rod(v(0, 0.03, 0), knee, 0.009, a, 6);
    b.rod(knee, head, 0.009, a, 6);
    b.sphere(0.015, knee.x, knee.y, knee.z, f, 1, 1, 1, 8);
    const cone = b.add(new THREE.CylinderGeometry(0.03, 0.075, 0.13, 24, 1, true), mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide }), head.x, head.y - 0.05, head.z);
    cone.rotation.z = 0.5;
    bulb(b, head.x + 0.03, head.y - 0.09, head.z, 0.025);
  },
  floor_lamp_drum: (b, w, _d, h, f, c, a) => {
    b.cyl(w * 0.4, w * 0.42, 0.025, 0, 0, 0, a, 28);
    b.cyl(0.011, 0.011, h - 0.3, 0, 0.025, 0, a, 10);
    b.cyl(w / 2, w / 2, 0.32, 0, h - 0.32, 0, shadeMat(f, c), 36, true);
    bulb(b, 0, h - 0.2, 0, 0.035);
  },
  floor_lamp_uplight: (b, w, _d, h, f, _c, a) => {
    b.cyl(w * 0.35, w * 0.4, 0.03, 0, 0, 0, a, 28);
    b.cyl(0.012, 0.012, h - 0.12, 0, 0.03, 0, a, 10);
    const bowlP = [[0.001, 0], [0.12, 0], [0.4, 0.6], [0.5, 1], [0.48, 1], [0.38, 0.62], [0.001, 0.08]].map(([x, y]) => new THREE.Vector2(x * w, y * 0.12));
    b.add(new THREE.LatheGeometry(bowlP, 32), f, 0, h - 0.12, 0);
    b.add(new THREE.CircleGeometry(w * 0.45, 32), glowMat(), 0, h - 0.015, 0).rotation.x = -Math.PI / 2;
  },
  floor_lamp_paper: (b, w, d, h, _f, _c, a) => {
    // a tall paper lantern on a slim frame
    const r = Math.min(w, d) / 2;
    b.box(r * 1.2, 0.02, r * 1.2, 0, 0, 0, a, 0.005);
    const lantern = new THREE.CylinderGeometry(r, r, h - 0.08, 32, 12);
    const pos = lantern.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / (h - 0.08) + 0.5;
      const k = 1 - 0.04 * Math.abs(Math.sin(y * Math.PI * 12));
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    lantern.computeVertexNormals();
    b.add(lantern, opal(), 0, 0.04 + (h - 0.08) / 2, 0);
  },
  // ----- utility -----
  washer: (b, w, d, h, f, _c, a) => laundry(b, w, d, h, f, a, "washer"),
  dryer: (b, w, d, h, f, _c, a) => laundry(b, w, d, h, f, a, "dryer"),
  washer_dryer_stack: (b, w, d, h, f, _c, a) => {
    laundry(b, w, d, h / 2 - 0.01, f, a, "washer");
    b.box(w, 0.02, d, 0, h / 2 - 0.01, 0, mat(C.steel));
    const top = new Builder();
    laundry(top, w, d, h / 2 - 0.01, f, a, "dryer");
    const g = top.done();
    g.position.y = h / 2 + 0.01;
    b.g.add(g);
  },
  ceiling_fan: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, d) / 2;
    b.cyl(0.06, 0.04, 0.04, 0, h - 0.04, 0, a, 18);
    b.cyl(0.012, 0.012, h * 0.5, 0, h * 0.45, 0, a, 8);
    b.cyl(0.11, 0.09, 0.09, 0, h * 0.35, 0, a, 24);
    b.add(new THREE.SphereGeometry(0.09, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), opal(), 0, h * 0.35, 0);
    b.spinner(0, h * 0.4, 0, "y", () => {
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        const blade = b.box(r - 0.12, 0.012, 0.13, 0, 0, 0, f, 0.006);
        blade?.position.set(Math.cos(ang) * (r / 2 + 0.06), h * 0.4, Math.sin(ang) * (r / 2 + 0.06));
        blade?.rotation.set(0.12, -ang, 0);
      }
    });
  },
  laundry_basket: (b, w, d, h, f) => {
    const geo = new THREE.CylinderGeometry(0.5, 0.42, 1, 24, 1, true);
    geo.scale(w, h, d);
    b.add(geo, wickerMat("sand"), 0, h / 2, 0);
    b.add(new THREE.CircleGeometry(0.42, 24).scale(w, d, 1), wickerMat("sand"), 0, 0.005, 0).rotation.x = -Math.PI / 2;
    foliage(b, random(167), 0, h * 0.85, 0, w * 0.35, 0.06, d * 0.35, 12, 0.12, C.clothes.slice(0, 4), true);
    void f;
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
  // ----- more indoor plants (the pot in the finish) -----
  peace_lily: (b, w, d, h, f) => {
    const rand = random(181);
    const ph = Math.min(0.24, h * 0.32);
    pot(b, Math.min(w, d) * 0.3, ph, f);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rand() * 0.4;
      const reach = (Math.min(w, d) / 2) * (0.35 + rand() * 0.4);
      const top = v(Math.cos(a) * reach * 0.5, ph + (h - ph) * (0.35 + rand() * 0.3), Math.sin(a) * reach * 0.5);
      stem(b, v(0, ph, 0), top, 0.004, C.leaf);
      b.batch(leafGeometry(0.22 + rand() * 0.08, 0.09, 0.45), leafMat(i % 3 ? "#2f5a2f" : "#3d6d3a"), matrix(top.x, top.y, top.z, -0.5 - rand() * 0.5, -a - Math.PI / 2, 0));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const top = v(Math.cos(a) * 0.06, h - 0.12 - rand() * 0.08, Math.sin(a) * 0.06);
      stem(b, v(0, ph, 0), top, 0.004, C.leaf);
      b.batch(leafGeometry(0.11, 0.07, -0.25), leafMat("#f4f3ec"), matrix(top.x, top.y, top.z, 0.15, -a + Math.PI / 2, 0));
      b.batch(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 6), mat("#e8dfa0"), matrix(top.x, top.y + 0.04, top.z));
    }
  },
  rubber_tree: (b, w, d, h, f) => {
    // Ficus elastica: a stem with big glossy oval leaves, red tips
    const rand = random(191);
    const ph = 0.3;
    pot(b, Math.min(w, d) * 0.32, ph, f);
    for (const [ox, top] of [[-0.03, h], [0.05, h * 0.78]] as const) {
      b.cyl(0.012, 0.02, top - ph, ox, ph, 0, mat("#5a4632"), 8);
      const n = Math.round((top - ph) / 0.07);
      for (let i = 0; i < n; i++) {
        const y = ph + 0.15 + ((top - ph - 0.2) * i) / n;
        const a = i * 2.3 + ox * 10;
        const size = 0.18 + rand() * 0.06;
        b.batch(leafGeometry(size, size * 0.6, 0.12), leafMat(rand() > 0.3 ? "#22382a" : "#2f4a35"), matrix(ox + Math.cos(a) * 0.03, y, Math.sin(a) * 0.03, -0.9 + (i / n) * 0.5, -a - Math.PI / 2, 0));
      }
      b.batch(new THREE.ConeGeometry(0.012, 0.08, 6), mat("#8a3a32"), matrix(ox, top + 0.03, 0));
    }
  },
  palm_kentia: (b, w, d, h, f) => palm(b, w, d, h, f, 193, { fronds: 9, leaflets: 26, droop: 0.9, color: [C.leafDark, "#3a6a35"], width: 0.03 }),
  fern: (b, w, d, h, f) => {
    const ph = Math.min(0.25, h * 0.4);
    pot(b, Math.min(w, d) * 0.3, ph, f);
    const rand = random(197);
    for (let s = 0; s < 22; s++) {
      const a = (s / 22) * Math.PI * 2 + rand() * 0.3;
      const out = (Math.min(w, d) / 2) * (0.7 + rand() * 0.3);
      const curve = new THREE.QuadraticBezierCurve3(v(0, ph, 0), v(Math.cos(a) * out * 0.4, h, Math.sin(a) * out * 0.4), v(Math.cos(a) * out, ph * 0.6 + rand() * 0.1, Math.sin(a) * out));
      for (let k = 2; k < 16; k++) {
        const t = k / 16;
        const p = curve.getPoint(t);
        for (const side of [-1, 1]) b.batch(leafGeometry(0.07 * (1 - t * 0.6), 0.018, 0.2), leafMat(k % 2 ? "#5f9a3f" : "#4c8a35"), matrix(p.x, p.y, p.z, -1.2 - t, -a - Math.PI / 2 + side * 1.2, side * 0.3));
      }
    }
  },
  dracaena: (b, w, d, h, f) => {
    // three bare canes of different heights, each with a spiky crown
    const rand = random(199);
    const ph = 0.28;
    pot(b, Math.min(w, d) * 0.34, ph, f);
    for (const [ox, oz, top] of [[0, 0, h * 0.95], [0.05, 0.03, h * 0.72], [-0.04, 0.04, h * 0.55]] as const) {
      b.rod(v(ox, ph, oz), v(ox * 2, top - 0.1, oz * 2), 0.013, mat("#7a6a55"), 6);
      for (let i = 0; i < 26; i++) {
        const a = rand() * Math.PI * 2;
        b.batch(leafGeometry(0.22 + rand() * 0.1, 0.02, 0.25), leafMat(i % 3 ? "#3f6d38" : "#7a3b3b"), matrix(ox * 2, top - 0.1, oz * 2, -0.2 - rand() * 1.0, a, 0));
      }
    }
  },
  yucca: (b, w, d, h, f) => {
    const rand = random(211);
    const ph = 0.3;
    pot(b, Math.min(w, d) * 0.35, ph, f);
    for (const [ox, top] of [[0, h * 0.75], [0.06, h * 0.55]] as const) {
      b.cyl(0.035, 0.05, top - ph, ox, ph, 0, mat("#8a7a62", { roughness: 1 }), 10);
      for (let i = 0; i < 34; i++) {
        const a = rand() * Math.PI * 2;
        b.batch(leafGeometry(0.32 + rand() * 0.1, 0.035, 0.12), leafMat(i % 2 ? "#4d7a3a" : "#6b8f45"), matrix(ox, top, 0, -0.15 - rand() * 1.1, a, 0));
      }
    }
  },
  zz_plant: (b, w, d, h, f) => {
    const rand = random(223);
    const ph = 0.2;
    pot(b, Math.min(w, d) * 0.32, ph, f);
    for (let s = 0; s < 9; s++) {
      const a = (s / 9) * Math.PI * 2 + rand() * 0.3;
      const top = v(Math.cos(a) * w * 0.25, ph + (h - ph) * (0.7 + rand() * 0.3), Math.sin(a) * d * 0.25);
      stem(b, v(Math.cos(a) * 0.02, ph, Math.sin(a) * 0.02), top, 0.008, "#3d5a2a");
      for (let k = 3; k < 12; k++) {
        const t = k / 12;
        const p = v(Math.cos(a) * 0.02, ph, Math.sin(a) * 0.02).lerp(top, t);
        for (const side of [-1, 1]) b.batch(leafGeometry(0.06, 0.035, 0.05), leafMat(k % 2 ? "#1f3d22" : "#2a4f2c"), matrix(p.x, p.y, p.z, -0.6, -a - Math.PI / 2 + side * 1.3, 0));
      }
    }
  },
  pothos_stand: (b, w, d, h, f) => {
    // on a plant stand: vines trailing down its sides
    const rand = random(227);
    const ph = 0.18;
    const top = h - ph - 0.05;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * w * 0.25, top, sz * d * 0.25), v(sx * w * 0.38, 0, sz * d * 0.38), 0.012, surface("oak", 0.7), 6);
    b.cyl(Math.min(w, d) * 0.3, Math.min(w, d) * 0.3, 0.02, 0, top - 0.02, 0, surface("oak", 0.7), 24);
    const r = Math.min(w, d) * 0.22;
    pot(b, r, ph, f, top);
    foliage(b, rand, 0, top + ph + 0.04, 0, r * 1.1, 0.06, r * 1.1, 40, 0.07, ["#5d9a3f", "#a8c45a"], true);
    for (let s = 0; s < 9; s++) {
      const a = (s / 9) * Math.PI * 2 + rand() * 0.4;
      const len = 0.25 + rand() * (top - 0.1);
      for (let k = 0; k < 12; k++) {
        const t = k / 12;
        const p = v(Math.cos(a) * (r + 0.02 + t * 0.06), top + ph - t * len, Math.sin(a) * (r + 0.02 + t * 0.06));
        b.batch(leafGeometry(0.06, 0.05, 0.15), leafMat(k % 2 ? "#5d9a3f" : "#a8c45a"), matrix(p.x, p.y, p.z, 1.4 + rand() * 0.5, -a + Math.PI / 2 + rand(), 0));
      }
    }
  },
  cactus_column: (b, w, d, h, f) => {
    const ph = Math.min(0.28, h * 0.25);
    pot(b, Math.min(w, d) * 0.36, ph, f);
    const r = Math.min(w, d) * 0.13;
    ribbed(b, r, h - ph - r, 0, ph, 0);
    for (const [side, y, len] of [[1, 0.45, 0.3], [-1, 0.6, 0.22]] as const) {
      const ay = ph + (h - ph) * y;
      b.rod(v(0, ay, 0), v(side * r * 2.2, ay + 0.04, 0), r * 0.6, mat("#4f7a45"), 10);
      ribbed(b, r * 0.65, (h - ph) * len, side * r * 2.2, ay, 0);
    }
  },
  cactus_round: (b, w, d, h, f) => {
    const ph = h * 0.45;
    pot(b, Math.min(w, d) * 0.42, ph, f);
    const r = Math.min(w, d) * 0.34;
    const ball = new THREE.SphereGeometry(r, 20, 12);
    ribs(ball, 14, 0.07);
    b.add(ball, mat("#4f7a45", { roughness: 0.9 }), 0, ph + r * 0.75, 0).scale.y = Math.min(1, (h - ph) / (r * 1.75));
    b.sphere(r * 0.18, 0, ph + r * 1.6, 0, mat("#e85a8a"), 1, 0.5, 1, 10);
  },
  succulent_bowl: (b, w, d, h, f) => {
    const rand = random(229);
    const r = Math.min(w, d) / 2;
    b.add(new THREE.LatheGeometry([[0.001, 0], [0.7, 0], [1, 0.9], [0.94, 1], [0.001, 0.75]].map(([x, y]) => new THREE.Vector2(x * r, y * h * 0.6)), 28), f);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand();
      const rr = i ? r * 0.55 : 0;
      rosette(b, Math.cos(a) * rr, h * 0.5, Math.sin(a) * rr, 0.05 + rand() * 0.03, i % 2 ? "#8fb39a" : "#a6b58a", rand);
    }
  },
  aloe: (b, w, d, h, f) => {
    const rand = random(233);
    const ph = h * 0.35;
    pot(b, Math.min(w, d) * 0.38, ph, f);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 * 2.6;
      const len = (h - ph) * (0.7 + rand() * 0.4);
      const leaf = new THREE.ConeGeometry(0.025, len, 4);
      leaf.translate(0, len / 2, 0);
      leaf.scale(1.6, 1, 0.6);
      b.batch(leaf, leafMat(i % 2 ? "#6f9a6a" : "#7fa877"), matrix(0, ph * 0.9, 0, 0.25 + (i / 16) * 0.5, a, 0));
    }
  },
  bird_of_paradise: (b, w, d, h, f) => {
    // Strelitzia: big paddle leaves high on long upright stems
    const rand = random(239);
    const ph = 0.34;
    pot(b, Math.min(w, d) * 0.3, ph, f);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.4;
      const len = 0.38 + rand() * 0.12;
      const top = v(Math.cos(a) * w * 0.32, h - len - rand() * 0.35, Math.sin(a) * d * 0.32);
      stem(b, v(0, ph, 0), top, 0.008, "#4d7040");
      b.batch(leafGeometry(len, 0.17, 0.08), leafMat(i % 2 ? "#3f6a3a" : "#4f7d45"), matrix(top.x, top.y, top.z, -0.25 - rand() * 0.3, -a - Math.PI / 2, 0));
    }
  },
  money_tree: (b, w, d, h, f) => {
    // Pachira: a braided trunk, a crown of hand-shaped leaves
    const rand = random(241);
    const ph = 0.26;
    pot(b, Math.min(w, d) * 0.32, ph, f);
    const top = h * 0.55;
    for (let k = 0; k < 3; k++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const ang = (k / 3) * Math.PI * 2 + t * Math.PI * 3;
        pts.push(v(Math.cos(ang) * 0.025, ph + t * (top - ph), Math.sin(ang) * 0.025));
      }
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.014, 6), mat("#7d6a50"));
    }
    for (let s = 0; s < 16; s++) {
      const a = rand() * Math.PI * 2;
      const tip = v(Math.cos(a) * w * (0.15 + rand() * 0.25), top + rand() * (h - top - 0.1), Math.sin(a) * d * (0.15 + rand() * 0.25));
      stem(b, v(0, top, 0), tip, 0.004, "#4d7040");
      for (let l = 0; l < 5; l++) b.batch(leafGeometry(0.12, 0.045, 0.15), leafMat(l % 2 ? C.leaf : C.leafLight), matrix(tip.x, tip.y, tip.z, -0.9, -a - Math.PI / 2 + (l - 2) * 0.45, 0));
    }
  },
  // ----- the rest of what Kenney's kits had, redrawn -----
  laptop: (b, w, d, _h, f) => {
    b.box(w, 0.015, d * 0.95, 0, 0, d * 0.025, f, 0.004);
    b.box(w * 0.86, 0.002, d * 0.45, 0, 0.015, d * 0.12, mat("#2a2c30"));
    b.box(w * 0.3, 0.001, d * 0.2, 0, 0.015, d * 0.38, mat("#3a3d42"));
    const lid = b.box(w, d * 0.9, 0.008, 0, 0, 0, f, 0.004);
    lid?.position.set(0, d * 0.42, -d / 2 + 0.08);
    lid?.rotation.set(-0.3, 0, 0);
    const screen = b.box(w * 0.92, d * 0.8, 0.002, 0, 0, 0, mat(C.screen, { emissive: "#24303c", emissiveIntensity: 0.4 }));
    screen?.position.set(0, d * 0.42, -d / 2 + 0.085);
    screen?.rotation.set(-0.3, 0, 0);
  },
  monitor: (b, w, d, h, f) => {
    b.box(w * 0.3, 0.012, d * 0.9, 0, 0, 0, f, 0.006);
    b.box(0.04, h * 0.5, 0.02, 0, 0.012, -d * 0.2, f, 0.006);
    b.box(w, h * 0.62, 0.025, 0, h * 0.36, -d * 0.1, f, 0.008);
    b.box(w - 0.02, h * 0.62 - 0.03, 0.002, 0, h * 0.36 + 0.02, -d * 0.1 + 0.0135, part(mat(C.screen, { emissive: "#24303c", emissiveIntensity: 0.4 }), "screen"));
  },
  books: (b, w, d, h) => {
    const rand = random(251);
    books(b, rand, -w / 2, w * 0.1, 0, h, d, 0);
    let y = 0;
    while (y < h * 0.5) {
      const bh = 0.025 + rand() * 0.02;
      b.box(w * 0.38, bh, d * (0.8 + rand() * 0.2), w * 0.3, y, 0, mat(C.book[Math.floor(rand() * C.book.length)]), 0.003)?.rotation.set(0, (rand() - 0.5) * 0.3, 0);
      y += bh;
    }
  },
  toaster: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, Math.min(0.04, d / 3));
    for (const sx of [-1, 1]) b.box(w * 0.6, 0.004, 0.025, 0, h, sx * d * 0.18, mat("#1c1d20"));
    b.box(0.02, 0.03, 0.03, w / 2 - 0.05, h * 0.55, d / 2 + 0.01, mat(C.black), 0.005);
  },
  kettle: (b, w, d, h, f) => {
    const r = Math.min(w, d) * 0.4;
    b.cyl(r * 1.05, r * 1.1, 0.02, 0, 0, 0, mat(C.black), 20);
    b.add(new THREE.LatheGeometry([[0.001, 0], [1, 0], [1.02, 0.5], [0.85, 0.92], [0.4, 1], [0.001, 1]].map(([x, y]) => new THREE.Vector2(x * r, y * (h - 0.04))), 28), f, 0, 0.02, 0);
    b.rod(v(0, h * 0.85, -r * 0.5), v(0, h - 0.01, -r * 1.2), 0.012, f, 6);
    b.rod(v(0, h - 0.01, -r * 1.2), v(0, h * 0.35, -r * 1.25), 0.014, mat(C.black), 6);
    b.rod(v(0, h * 0.55, r * 0.9), v(0, h * 0.82, r * 1.35), 0.018, f, 8);
  },
  kitchen_bin: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r * 0.96, h - 0.04, 0, 0, 0, f, 28);
    b.add(new THREE.SphereGeometry(r, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2), f, 0, h - 0.04, 0).scale.y = 0.12 / r;
    b.box(0.08, 0.02, 0.06, 0, 0.01, r, mat(C.black), 0.006);
  },
  bunk_bed: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.06, h, 0.06, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03), f, 0.01);
    for (const y of [0.2, h * 0.58]) {
      b.box(w, 0.06, d, 0, y, 0, f, 0.01);
      b.box(w - 0.08, 0.16, d - 0.1, 0, y + 0.06, 0, mat(C.mattress), 0.04);
      b.box(w - 0.06, 0.05, d * 0.62, 0, y + 0.22, d * 0.16, mat(C.linen, { roughness: 1 }), 0.025);
      b.box(w * 0.6, 0.1, 0.3, 0, y + 0.22, -d / 2 + 0.22, mat(C.pillow), 0.04);
    }
    for (const sz of [-1, 1]) b.box(w, 0.04, 0.025, 0, h - 0.12, sz * (d / 2 - 0.03), f, 0.006);
    b.box(0.025, 0.04, d * 0.6, w / 2 - 0.03, h - 0.12, -d * 0.15, f, 0.006);
    // the ladder at the foot end
    for (const sx of [-0.2, 0.2]) b.box(0.04, h * 0.8, 0.04, sx, 0, d / 2 + 0.02, f, 0.006);
    for (let i = 1; i < 5; i++) b.box(0.4, 0.03, 0.03, 0, (i * h * 0.8) / 5, d / 2 + 0.02, f, 0.006);
  },
  bed_storage: (b, w, d, h, f, _c, a) => {
    // a box bed with drawers under it and a panel headboard
    b.box(w, 0.36, d, 0, 0, 0, f, 0.008);
    for (const sx of [-1, 1]) fronts(b, sx < 0 ? -w / 2 + 0.1 : 0.1, w / 2 - 0.2, 0.04, 0.26, d / 2, 1, f, 1, "bar", a);
    b.box(w + 0.04, h, 0.06, 0, 0, -d / 2 + 0.03, f, 0.01);
    b.box(w - 0.06, 0.2, d - 0.1, 0, 0.36, 0.03, mat(C.mattress), 0.05);
    b.box(w - 0.02, 0.07, (d - 0.12) * 0.66, 0, 0.54, d / 2 - ((d - 0.12) * 0.66) / 2 - 0.02, mat(C.linen, { roughness: 1 }), 0.035);
    const n = w > 1.2 ? 2 : 1;
    for (let i = 0; i < n; i++) b.box(w / n - 0.14, 0.13, 0.36, -w / 2 + (w / n) * (i + 0.5), 0.54, -d / 2 + 0.3, mat(C.pillow), 0.06);
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
  path_paving: (b, w, d, h, f) => {
    // slabs in a running bond: every other row shifted by half a slab, cut at the edges
    const rows = Math.max(1, Math.round(d / 0.4));
    const sw = w / Math.max(1, Math.round(w / 0.6));
    for (let r = 0; r < rows; r++) {
      const z = -d / 2 + (d / rows) * (r + 0.5);
      for (let x0 = -w / 2 - (r % 2 ? sw / 2 : 0); x0 < w / 2 - 0.01; x0 += sw) {
        const a = Math.max(x0, -w / 2);
        const c = Math.min(x0 + sw, w / 2);
        if (c - a > 0.05) b.box(c - a - 0.012, h, d / rows - 0.012, (a + c) / 2, 0, z, f, 0.004);
      }
    }
  },
  path_boardwalk: (b, w, d, h, f) => {
    const n = Math.max(2, Math.round(d / 0.15));
    for (let i = 0; i < n; i++) b.box(w, h, d / n - 0.01, 0, 0, -d / 2 + (d / n) * (i + 0.5), f, 0.004);
  },
  log_stack: (b, w, d, h) => {
    const rand = random(257);
    const r = 0.08;
    const rows = Math.max(1, Math.floor(h / (r * 1.8)));
    for (let row = 0; row < rows; row++) {
      const n = Math.max(1, Math.floor(w / (r * 2.05)) - (row % 2));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + r + (row % 2) * r + i * r * 2.05;
        const log = b.add(new THREE.CylinderGeometry(r * (0.85 + rand() * 0.15), r * (0.85 + rand() * 0.15), d, 10), mat(i % 2 ? C.trunk : "#7a5a43"), x, r + row * r * 1.75, 0);
        log.rotation.x = Math.PI / 2;
        b.add(new THREE.CircleGeometry(r * 0.8, 10), mat("#c9a77c"), x, r + row * r * 1.75, d / 2 + 0.001);
      }
    }
  },
  tree_stump: (b, w, d, h) => {
    const r = Math.min(w, d) / 2;
    b.add(new THREE.LatheGeometry([[0.001, 0], [1, 0], [0.75, 0.25], [0.68, 1], [0.001, 1]].map(([x, y]) => new THREE.Vector2(x * r, y * h)), 14), mat(C.trunk, { roughness: 1 }));
    b.add(new THREE.CircleGeometry(r * 0.66, 14), mat("#c9a77c"), 0, h + 0.001, 0).rotation.x = -Math.PI / 2;
    for (let i = 1; i < 4; i++) b.add(new THREE.RingGeometry(r * 0.15 * i, r * 0.15 * i + 0.006, 14), mat("#a8845a"), 0, h + 0.002, 0).rotation.x = -Math.PI / 2;
  },
  tree_palm: (b, w, d, h) => {
    // a curved ringed trunk, a crown of long fronds
    const rand = random(263);
    const top = v(w * 0.12, h * 0.85, 0);
    const curve = new THREE.QuadraticBezierCurve3(v(0, 0, 0), v(-w * 0.05, h * 0.45, 0), top);
    b.add(new THREE.TubeGeometry(curve, 16, 0.11, 8), mat("#8a7458", { roughness: 1 }));
    for (let i = 1; i < 14; i++) {
      const p = curve.getPoint(i / 14);
      b.add(new THREE.TorusGeometry(0.11, 0.015, 4, 10), mat("#6d5a43"), p.x, p.y, p.z).rotation.x = Math.PI / 2;
    }
    for (let s = 0; s < 11; s++) {
      const a = (s / 11) * Math.PI * 2 + rand() * 0.3;
      const out = Math.min(w, d) * (0.4 + rand() * 0.1);
      const frond = new THREE.QuadraticBezierCurve3(top, top.clone().add(v(Math.cos(a) * out * 0.5, h * 0.12, Math.sin(a) * out * 0.5)), top.clone().add(v(Math.cos(a) * out, -h * 0.12, Math.sin(a) * out)));
      for (let k = 2; k < 18; k++) {
        const t = k / 18;
        const p = frond.getPoint(t);
        for (const side of [-1, 1]) b.batch(leafGeometry(0.5 * (1 - t * 0.5), 0.05, 0.6), leafMat(k % 2 ? C.leaf : C.leafDark), matrix(p.x, p.y, p.z, -1.5 - t * 0.5, -a - Math.PI / 2 + side * 1.1, side * 0.5));
      }
    }
  },
  tree_pine: (b, w, d, h) => {
    // a tall Scots pine: orange-brown bare trunk, a flat, layered crown up top
    const rand = random(269);
    const crownY = h * 0.55;
    b.cyl(0.08, 0.15, h * 0.92, 0, 0, 0, mat("#9a5f3c", { roughness: 1 }), 10);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 * 1.7 + rand();
      const t = i / 12;
      const reach = (Math.min(w, d) / 2) * (0.85 - t * 0.5);
      const c = v(Math.cos(a) * reach * 0.5, crownY + t * (h - crownY) * 0.85, Math.sin(a) * reach * 0.5);
      b.rod(v(0, c.y - 0.25, 0), c, 0.035, mat("#7a4a32"), 5);
      foliage(b, rand, c.x, c.y, c.z, reach * 0.8, (h - crownY) * 0.12, reach * 0.8, 160, 0.16, [C.leafDark, "#2f5a33", "#3d6b3a"]);
    }
  },
  car_sports: (b, w, d, h, _f, color) => car(b, w, d, h, color, "sports"),
  flower_pots: (b, w, d, h, f) => {
    const rand = random(271);
    const n = Math.max(1, Math.round(w / 0.32));
    const petals = ["#d4553a", "#e8a33d", "#f2d14b", "#e58fb0", "#8a74b8", "#f4f2ec"];
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const r = Math.min(w / n, d) * 0.4;
      const ph = h * 0.45;
      const g = new Builder();
      pot(g, r, ph, f);
      const pg = g.done();
      pg.position.x = x;
      b.g.add(pg);
      for (let k = 0; k < 12; k++) {
        const a = rand() * Math.PI * 2;
        const rr = rand() * r * 0.7;
        const y = ph + (h - ph) * (0.5 + rand() * 0.5);
        stem(b, v(x + Math.cos(a) * rr * 0.4, ph * 0.9, Math.sin(a) * rr * 0.4), v(x + Math.cos(a) * rr, y, Math.sin(a) * rr), 0.004, C.leaf);
        b.batch(new THREE.CircleGeometry(0.03, 6), leafMat(petals[(i * 3 + k) % petals.length]), matrix(x + Math.cos(a) * rr, y, Math.sin(a) * rr, -Math.PI / 2 + (rand() - 0.5) * 0.6, rand() * 6, 0));
      }
    }
  },
  // ----- living, more -----
  fireplace_stove: (b, w, d, h, f) => {
    // a wood stove on a stone plate, a glass door with fire, the flue to the ceiling
    b.box(w + 0.3, 0.03, d + 0.35, 0, 0, 0.1, mat("#6e6a64", { roughness: 0.9 }), 0.005);
    const bh = Math.min(h * 0.62, 1.0);
    b.box(w, bh, d, 0, 0.03, 0, f, 0.04);
    b.box(w * 0.7, bh * 0.45, 0.01, 0, 0.03 + bh * 0.3, d / 2, mat("#1a1210", { roughness: 0.1 }), 0.01);
    fire(b, w * 0.5, 0.03 + bh * 0.32, d / 2 + 0.02, bh * 0.3);
    b.box(0.02, bh * 0.35, 0.03, w * 0.32, 0.03 + bh * 0.35, d / 2 + 0.015, mat(C.steel), 0.005);
    b.cyl(0.075, 0.075, h - bh - 0.03, 0, 0.03 + bh, -d * 0.1, f, 18);
  },
  fireplace_wall: (b, w, d, h, f) => {
    // a built-in fireplace: plaster surround, a long low opening with flames, a hearth ledge
    b.box(w, h, d, 0, 0, 0, f, 0.01);
    b.box(w * 0.75, 0.32, 0.02, 0, 0.35, d / 2 + 0.005, mat("#121212", { roughness: 0.2 }));
    fire(b, w * 0.65, 0.37, d / 2 + 0.04, 0.22);
    b.box(w + 0.1, 0.06, d + 0.15, 0, 0.18, 0.075, mat("#3b3b3d"), 0.01);
  },
  piano_upright: (b, w, d, h, f) => {
    const kh = 0.72;
    b.box(w, h, d * 0.55, 0, 0, -d / 2 + d * 0.275, f, 0.012);
    for (const sx of [-1, 1]) b.box(0.05, kh, d, sx * (w / 2 - 0.025), 0, 0, f, 0.01);
    b.box(w - 0.1, 0.05, d * 0.45, 0, kh, d * 0.22, f, 0.008);
    keys(b, w - 0.12, kh + 0.05, d * 0.3);
    b.box(w - 0.1, 0.12, 0.02, 0, kh + 0.06, -d / 2 + d * 0.56, f, 0.006);
    b.box(w - 0.3, 0.02, 0.03, 0, 0.05, d * 0.3, mat(FINISHES.brass, { metalness: 0.7, roughness: 0.3 }));
  },
  piano_grand: (b, w, d, h, f) => {
    // the curved case, lid propped open, three legs, the keyboard at the front (+z)
    const s = new THREE.Shape();
    s.moveTo(-w / 2, d / 2);
    s.lineTo(w / 2, d / 2);
    s.lineTo(w / 2, -d * 0.05);
    s.bezierCurveTo(w / 2, -d * 0.35, w * 0.05, -d * 0.2, 0, -d / 2);
    s.bezierCurveTo(-w * 0.3, -d * 0.6, -w / 2, -d * 0.2, -w / 2, d / 2);
    const caseH = 0.3;
    const geo = new THREE.ExtrudeGeometry(s, { depth: caseH, bevelEnabled: false, curveSegments: 16 });
    geo.rotateX(-Math.PI / 2);
    geo.scale(1, 1, -1);
    b.add(geo, f, 0, h - caseH - 0.08, 0);
    const lid = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 16 });
    lid.rotateX(-Math.PI / 2);
    lid.scale(1, 1, -1);
    // the lid, propped open on its long straight side
    const hinge = new THREE.Group();
    hinge.position.set(w / 2, h - 0.08, 0);
    const lidMesh = new THREE.Mesh(lid, f);
    lidMesh.position.set(-w / 2, 0, 0);
    hinge.add(lidMesh);
    hinge.rotation.z = 0.45;
    b.g.add(hinge);
    for (const [x, z] of [[-w * 0.4, d * 0.4], [w * 0.4, d * 0.4], [-w * 0.1, -d * 0.35]]) b.cyl(0.05, 0.04, h - caseH - 0.08, x, 0, z, f, 12);
    keys(b, w - 0.1, h - caseH - 0.03, d / 2 - 0.1);
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
  sofa_midcentury: (b, w, d, h, f, _c, a) => {
    // a slim frame on splayed wooden legs, buttoned back cushions
    b.box(w, 0.16, d - 0.05, 0, 0.2, 0.02, f, 0.03);
    const n = Math.max(2, Math.round(w / 0.75));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.08 + ((w - 0.16) / n) * (i + 0.5);
      b.box((w - 0.16) / n - 0.01, 0.12, d - 0.25, x, 0.36, 0.1, f, 0.04);
      b.box((w - 0.16) / n - 0.01, h - 0.42, 0.16, x, 0.38, -d / 2 + 0.12, f, 0.05)?.rotation.set(-0.1, 0, 0);
      for (const by of [0.55, 0.68]) b.sphere(0.012, x, by, -d / 2 + 0.215, mat((f as THREE.MeshStandardMaterial).color.clone().multiplyScalar(0.7).getStyle()), 1, 1, 0.5, 6);
    }
    for (const sx of [-1, 1]) b.box(0.06, 0.24, d - 0.1, sx * (w / 2 - 0.03), 0.28, 0.02, a, 0.01);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.12), 0.2, sz * (d / 2 - 0.12)), v(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06)), 0.016, a, 8);
  },
  sofa_modular: (b, w, d, h, f) => {
    // low deep modules, thick cushions, no legs
    const n = Math.max(2, Math.round(w / 1.0));
    const mw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + mw * (i + 0.5);
      b.box(mw - 0.01, 0.28, d, x, 0, 0, f, 0.05);
      b.box(mw - 0.03, 0.14, d - 0.3, x, 0.28, 0.13, f, 0.06);
      b.box(mw - 0.03, h - 0.28, 0.28, x, 0.28, -d / 2 + 0.14, f, 0.08);
    }
    b.box(0.45, 0.4, 0.14, -w / 2 + 0.4, 0.38, -d / 2 + 0.36, mat(C.pillow), 0.05)?.rotation.set(-0.3, 0.2, 0);
  },
  daybed: (b, w, d, h, f, _c, a) => {
    // a frame with low back and arms, a mattress and two bolsters
    b.box(w, 0.3, d, 0, 0.08, 0, a, 0.01);
    legs(b, w, d, 0.08, 0.05, 0.02, a);
    b.box(w, h - 0.08, 0.06, 0, 0.08, -d / 2 + 0.03, a, 0.01);
    for (const sx of [-1, 1]) b.box(0.06, h * 0.75 - 0.08, d, sx * (w / 2 - 0.03), 0.08, 0, a, 0.01);
    b.box(w - 0.14, 0.16, d - 0.1, 0, 0.38, 0.03, f, 0.05);
    for (const sx of [-1, 1]) b.add(new THREE.CapsuleGeometry(0.1, d - 0.4, 6, 16).rotateX(Math.PI / 2), f, sx * (w / 2 - 0.18), 0.64, 0.03);
  },
  tv_frame: (b, w, d, h, _f, c, a) => {
    // a TV that looks like a framed picture
    b.box(w, h, d, 0, 0, 0, a, 0.004);
    b.box(w - 0.07, h - 0.07, 0.004, 0, 0.035, d / 2, mat("#f4f1ea"));
    art(b, w - 0.24, h - 0.22, 0.11, d / 2 + 0.003, c);
  },
  folding_screen: (b, w, d, h, f) => {
    const n = 3;
    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const panel = b.box(pw - 0.01, h - 0.04, 0.025, 0, 0.04, 0, f, 0.006);
      panel?.position.set(-w / 2 + pw * (i + 0.5), 0.04 + (h - 0.04) / 2, i % 2 ? d * 0.25 : -d * 0.25);
      panel?.rotation.set(0, i % 2 ? -0.35 : 0.35, 0);
    }
  },
  // ----- dining and office, more -----
  dining_table_legs: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.04, d, 0, h - 0.04, 0, f, 0.008);
    b.box(w - 0.16, 0.08, d - 0.16, 0, h - 0.12, 0, f);
    legs(b, w, d, h - 0.04, 0.07, 0.035, a, true);
  },
  dining_table_oval: (b, w, d, h, f, _c, a) => {
    b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.035, 48).scale(w, 1, d), f, 0, h - 0.0175, 0);
    for (const sx of [-1, 1]) {
      b.cyl(0.05, 0.07, h - 0.035, sx * w * 0.25, 0, 0, a, 18);
      b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 32).scale(0.4, 1, d * 0.55), a, sx * w * 0.25, 0.015, 0);
    }
  },
  dining_table_glass: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.012, d, 0, h - 0.012, 0, glass(), 0.004);
    b.box(w - 0.1, 0.03, d - 0.1, 0, h - 0.045, 0, a, 0.004);
    for (const sx of [-1, 1]) {
      b.rod(v(sx * (w / 2 - 0.15), h - 0.045, -d / 2 + 0.08), v(sx * (w / 2 - 0.1), 0, -d / 2 + 0.06), 0.015, a, 8);
      b.rod(v(sx * (w / 2 - 0.15), h - 0.045, d / 2 - 0.08), v(sx * (w / 2 - 0.1), 0, d / 2 - 0.06), 0.015, a, 8);
    }
    void f;
  },
  desk_drawers: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.006);
    const pw = Math.min(0.45, w * 0.32);
    b.box(pw, h - 0.03, d - 0.04, w / 2 - pw / 2, 0, -0.02, f, 0.004);
    fronts(b, w / 2 - pw, pw, 0.02, h - 0.07, d / 2 - 0.058, 1, f, 3, "bar", a);
    for (const sz of [-1, 1]) b.box(0.035, h - 0.03, 0.035, -w / 2 + 0.04, 0, sz * (d / 2 - 0.04), a);
    b.box(0.6, 0.36, 0.02, -w * 0.1, h + 0.1, -d / 2 + 0.12, mat(C.screen, { roughness: 0.3 }), 0.005);
    b.box(0.04, 0.1, 0.04, -w * 0.1, h, -d / 2 + 0.12, mat(C.black));
  },
  desk_standing: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.006);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.12);
      b.box(0.07, h - 0.06, 0.05, x, 0.03, 0, a, 0.006);
      b.box(0.06, 0.03, d - 0.08, x, 0, 0, a, 0.008);
      b.box(0.05, 0.03, d - 0.2, x, h - 0.06, 0, a);
    }
    b.box(w - 0.3, 0.05, 0.03, 0, h - 0.11, -d / 2 + 0.1, a);
    b.box(0.7, 0.4, 0.02, 0, h + 0.12, -d / 2 + 0.14, mat(C.screen, { roughness: 0.3 }), 0.005);
    b.box(0.04, 0.12, 0.04, 0, h, -d / 2 + 0.14, mat(C.black));
    b.box(0.45, 0.015, 0.14, 0, h, d * 0.1, mat("#2b2c2e"), 0.004);
  },
  desk_corner: (b, w, d, h, f, _c, a) => {
    // an L: the long arm along the back, the short arm down the left
    const arm = Math.min(0.7, d * 0.45);
    b.box(w, 0.03, arm, 0, h - 0.03, -d / 2 + arm / 2, f, 0.006);
    b.box(arm, 0.03, d - arm, -w / 2 + arm / 2, h - 0.03, arm / 2, f, 0.006);
    for (const [x, z] of [[w / 2 - 0.04, -d / 2 + 0.04], [w / 2 - 0.04, -d / 2 + arm - 0.04], [-w / 2 + 0.04, d / 2 - 0.04], [-w / 2 + arm - 0.04, d / 2 - 0.04], [-w / 2 + 0.04, -d / 2 + 0.04]]) b.box(0.035, h - 0.03, 0.035, x, 0, z, a);
    b.box(0.55, 0.34, 0.02, -w / 2 + arm + 0.3, h + 0.1, -d / 2 + 0.12, mat(C.screen, { roughness: 0.3 }), 0.005)?.rotation.set(0, 0.3, 0);
    b.box(0.04, 0.1, 0.04, -w / 2 + arm + 0.3, h, -d / 2 + 0.12, mat(C.black));
  },
  drawer_unit: (b, w, d, h, f, _c, a) => {
    b.box(w, h - 0.05, d, 0, 0.05, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.06, h - 0.07, d / 2 - 0.018, 1, f, 3, "bar", a);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sphere(0.022, sx * (w / 2 - 0.05), 0.025, sz * (d / 2 - 0.05), mat(C.black), 1, 1, 1, 8);
  },
  printer: (b, w, d, h, f) => {
    b.box(w, h * 0.75, d, 0, 0, 0, f, 0.015);
    b.box(w * 0.85, h * 0.25, d * 0.7, 0, h * 0.75, -d * 0.1, f, 0.015);
    b.box(w * 0.6, 0.012, d * 0.3, 0, h * 0.35, d / 2 + 0.02, mat("#f7f7f2"));
    b.box(w * 0.25, 0.04, 0.005, w * 0.25, h * 0.6, d / 2 + 0.002, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }));
  },
  gaming_chair: (b, w, d, h, f, _c, a) => {
    const metal = mat(C.black);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      b.rod(v(0, 0.09, 0), v(Math.cos(ang) * w * 0.45, 0.05, Math.sin(ang) * w * 0.45), 0.017, metal, 6);
      b.sphere(0.028, Math.cos(ang) * w * 0.45, 0.028, Math.sin(ang) * w * 0.45, metal, 1, 1, 1, 8);
    }
    b.cyl(0.03, 0.03, 0.38, 0, 0.09, 0, metal, 10);
    b.box(w * 0.75, 0.1, d * 0.75, 0, 0.45, 0.03, f, 0.04);
    for (const sx of [-1, 1]) b.box(0.08, 0.08, d * 0.7, sx * w * 0.36, 0.5, 0.03, a, 0.03);
    const back2 = b.box(w * 0.68, h - 0.55, 0.12, 0, 0, 0, f, 0.05);
    back2?.position.set(0, 0.55 + (h - 0.55) / 2, -d / 2 + 0.12);
    back2?.rotation.set(-0.12, 0, 0);
    for (const sx of [-1, 1]) {
      const wing = b.box(0.1, (h - 0.55) * 0.8, 0.13, 0, 0, 0, a, 0.04);
      wing?.position.set(sx * w * 0.3, 0.55 + (h - 0.55) * 0.45, -d / 2 + 0.14);
      wing?.rotation.set(-0.12, 0, 0);
    }
    b.box(w * 0.4, 0.12, 0.1, 0, h - 0.18, -d / 2 + 0.2, a, 0.04);
    for (const sx of [-1, 1]) b.box(0.06, 0.2, 0.05, sx * w * 0.42, 0.5, 0.03, metal);
  },
  // ----- bedroom and kids, more -----
  bed_platform: (b, w, d, h, f) => {
    // a low wooden platform wider than the mattress, a low headboard
    b.box(w, 0.18, d, 0, 0.04, 0, f, 0.01);
    b.box(w - 0.1, 0.04, d - 0.1, 0, 0, 0, mat(C.black));
    b.box(w, h - 0.04, 0.05, 0, 0.04, -d / 2 + 0.025, f, 0.01);
    bedding(b, w - 0.24, d - 0.2, 0.22, 0.05);
  },
  bed_canopy: (b, w, d, h, f) => {
    b.box(w, 0.3, d, 0, 0.08, 0, f, 0.01);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.06, h, 0.06, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03), f, 0.01);
    for (const sz of [-1, 1]) b.box(w, 0.05, 0.05, 0, h - 0.05, sz * (d / 2 - 0.03), f);
    for (const sx of [-1, 1]) b.box(0.05, 0.05, d, sx * (w / 2 - 0.03), h - 0.05, 0, f);
    b.box(w - 0.1, 0.9, 0.04, 0, 0.38, -d / 2 + 0.05, f, 0.01);
    bedding(b, w - 0.12, d - 0.14, 0.38, 0.02);
    for (const sx of [-1, 1]) {
      const drape = new THREE.PlaneGeometry(0.3, h - 0.5, 10, 1);
      const pos = drape.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 40) * 0.025);
      drape.computeVertexNormals();
      b.add(drape, mat(C.linen, { side: THREE.DoubleSide, roughness: 1 }), sx * (w / 2 - 0.16), 0.5 + (h - 0.5) / 2 - 0.02, d / 2 - 0.05);
    }
  },
  bed_upholstered: (b, w, d, h, f, _c, a) => {
    // a padded frame, a tall buttoned headboard
    b.box(w, 0.3, d - 0.08, 0, 0.08, 0.04, f, 0.05);
    legs(b, w, d - 0.1, 0.08, 0.06, 0.02, a);
    b.box(w + 0.06, h - 0.08, 0.12, 0, 0.08, -d / 2 + 0.06, f, 0.05);
    const button = mat((f as THREE.MeshStandardMaterial).color.clone().multiplyScalar(0.7).getStyle());
    for (let r = 0; r < 3; r++) for (let i = 0; i < Math.round(w / 0.2); i++) b.sphere(0.012, -w / 2 + 0.1 + i * 0.2 + (r % 2) * 0.1, 0.6 + r * 0.17, -d / 2 + 0.122, button, 1, 1, 0.5, 6);
    bedding(b, w - 0.08, d - 0.16, 0.38, 0.04);
  },
  crib: (b, w, d, h, f) => {
    // a cot: slatted sides, a mattress
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.045, h, 0.045, sx * (w / 2 - 0.022), 0, sz * (d / 2 - 0.022), f, 0.008);
    for (const y of [0.25, h - 0.03]) {
      for (const sz of [-1, 1]) b.box(w, 0.03, 0.03, 0, y, sz * (d / 2 - 0.022), f);
      for (const sx of [-1, 1]) b.box(0.03, 0.03, d, sx * (w / 2 - 0.022), y, 0, f);
    }
    for (let i = 1; i < Math.round(d / 0.08); i++) for (const sx of [-1, 1]) b.box(0.02, h - 0.28, 0.02, sx * (w / 2 - 0.022), 0.27, -d / 2 + i * 0.08, f);
    for (let i = 1; i < Math.round(w / 0.08); i++) for (const sz of [-1, 1]) b.box(0.02, h - 0.28, 0.02, -w / 2 + i * 0.08, 0.27, sz * (d / 2 - 0.022), f);
    b.box(w - 0.08, 0.1, d - 0.08, 0, 0.28, 0, mat(C.mattress), 0.03);
    b.box(w * 0.6, 0.05, d * 0.45, 0, 0.38, d * 0.15, mat("#bcd4e6", { roughness: 1 }), 0.02);
  },
  changing_table: (b, w, d, h, f, _c, a) => {
    b.box(w, h - 0.12, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.02, h - 0.16, d / 2 - 0.018, 1, f, 3, "knob", a);
    for (const sx of [-1, 1]) b.box(0.02, 0.12, d, sx * (w / 2 - 0.01), h - 0.12, 0, f);
    b.box(w, 0.12, 0.02, 0, h - 0.12, -d / 2 + 0.01, f);
    b.box(w - 0.06, 0.08, d - 0.06, 0, h - 0.12, 0.02, mat("#cfe0ea", { roughness: 1 }), 0.03);
  },
  dressing_table: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.006);
    fronts(b, -w / 2, w, h - 0.15, 0.12, d / 2 - 0.018, 2, f, 1, "knob", a);
    b.box(w, 0.12, d - 0.02, 0, h - 0.15, -0.01, f);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.05), h - 0.15, sz * (d / 2 - 0.05)), v(sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03)), 0.015, f, 8);
    const r = Math.min(0.32, w * 0.3);
    b.add(new THREE.CylinderGeometry(r, r, 0.02, 40).rotateX(Math.PI / 2), a, 0, h + r + 0.05, -d / 2 + 0.03);
    b.add(new THREE.CircleGeometry(r * 0.94, 40), mat(C.mirror, { metalness: 0.9, roughness: 0.05 }), 0, h + r + 0.05, -d / 2 + 0.041);
    b.box(0.04, 0.06, 0.03, 0, h, -d / 2 + 0.03, a);
  },
  toy_box: (b, w, d, h, f) => {
    b.box(w, h - 0.03, d, 0, 0, 0, f, 0.02);
    b.box(w + 0.02, 0.04, d + 0.02, 0, h - 0.04, 0, f, 0.015);
    const rand = random(293);
    for (let i = 0; i < 3; i++) b.box(0.06, 0.06, 0.06, -w * 0.3 + i * 0.12, h, (rand() - 0.5) * d * 0.4, mat(["#e04a3a", "#3a7de0", "#f2d14b"][i]), 0.01)?.rotation.set(0, rand(), 0);
  },
  rocking_horse: (b, w, d, h, f) => {
    // a wooden horse on two rockers
    for (const sx of [-1, 1]) {
      const rocker = new THREE.TorusGeometry(d * 0.9, 0.018, 6, 24, 1.0);
      rocker.rotateZ(Math.PI * 1.5 - 0.5);
      rocker.rotateY(Math.PI / 2);
      b.add(rocker, f, sx * (w / 2 - 0.02), d * 0.9 + 0.02, 0);
      for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.02), 0.06, sz * d * 0.3), v(sx * 0.05, h * 0.55, sz * d * 0.22), 0.02, f, 6);
    }
    b.add(new THREE.CapsuleGeometry(0.1, d * 0.35, 6, 12).rotateX(Math.PI / 2), f, 0, h * 0.6, 0);
    b.box(0.09, 0.28, 0.12, 0, h * 0.62, d * 0.28, f, 0.03)?.rotation.set(-0.4, 0, 0);
    b.box(0.08, 0.1, 0.2, 0, h * 0.82, d * 0.36, f, 0.03);
    b.box(0.02, 0.2, 0.18, 0, h * 0.72, d * 0.25, mat("#5a3a24"), 0.008)?.rotation.set(-0.4, 0, 0);
    b.box(0.14, 0.03, 0.18, 0, h * 0.7, 0, mat("#c8382c"), 0.01);
  },
  teepee: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    const tent = new THREE.ConeGeometry(r, h * 0.9, 5, 1, true, 0.6, Math.PI * 2 - 1.0);
    b.add(tent, mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, h * 0.45, 0);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      b.rod(v(Math.cos(ang) * r, 0, Math.sin(ang) * r), v(-Math.cos(ang) * 0.12, h, -Math.sin(ang) * 0.12), 0.015, surface("oak", 0.7), 6);
    }
    b.cyl(r * 0.8, r * 0.8, 0.04, 0, 0, 0, mat(C.linen, { roughness: 1 }), 20);
  },
  kids_table: (b, w, d, h, f, _c, a) => {
    // a small table with two little chairs
    const tw = w * 0.6;
    b.box(tw, 0.025, d, 0, h - 0.025, 0, f, 0.01);
    legs(b, tw, d, h - 0.025, 0.04, 0.02, a);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.12);
      b.box(0.24, 0.02, 0.24, x, h * 0.6, 0, a, 0.006);
      legs(b, 0.24, 0.24, h * 0.6, 0.03, 0.012, a);
      b.box(0.02, h * 0.45, 0.22, x + sx * 0.11, h * 0.6, 0, a, 0.006);
    }
  },
  // ----- utility, energy and garage -----
  ironing_board: (b, w, d, h, f) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2);
    s.lineTo(w / 2 - d, -d / 2);
    s.quadraticCurveTo(w / 2 + 0.05, 0, w / 2 - d, d / 2);
    s.lineTo(-w / 2, d / 2);
    s.lineTo(-w / 2, -d / 2);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false, curveSegments: 10 });
    geo.rotateX(Math.PI / 2);
    b.add(geo, f, 0, h, 0);
    for (const sx of [-1, 1]) b.rod(v(sx * w * 0.3, 0, -d * 0.35), v(-sx * w * 0.25, h - 0.03, 0), 0.012, mat(C.steel), 6);
    b.box(0.15, 0.08, 0.1, w * 0.3, h, 0, mat(C.ceramic), 0.02);
  },
  drying_rack: (b, w, d, h, f) => {
    const steel = mat(C.chrome, { metalness: 0.6, roughness: 0.3 });
    for (const sx of [-1, 1]) {
      b.rod(v(sx * w / 2, 0, -d / 2), v(sx * w / 2, h, 0), 0.008, steel, 6);
      b.rod(v(sx * w / 2, 0, d / 2), v(sx * w / 2, h, 0), 0.008, steel, 6);
    }
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const z = (t - 0.5) * d * 0.9;
      b.rod(v(-w / 2, h - Math.abs(z) * (h / (d / 2)) * 0.15, z), v(w / 2, h - Math.abs(z) * (h / (d / 2)) * 0.15, z), 0.004, steel, 4);
    }
    const rand = random(307);
    for (let i = 0; i < 5; i++) b.box(0.3 + rand() * 0.2, 0.4 + rand() * 0.2, 0.008, -w / 2 + 0.25 + i * (w - 0.5) / 4, h - 0.3, (rand() - 0.5) * d * 0.6, mat(C.clothes[i % C.clothes.length], { side: THREE.DoubleSide }));
    void f;
  },
  water_heater: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.add(new THREE.CapsuleGeometry(r * 0.96, h - r * 2, 8, 28), f, 0, h / 2, 0);
    for (const y of [0.25, 0.7]) b.rod(v(-r * 0.4, h * y, r), v(-r * 0.4, h * y, r + 0.12), 0.015, mat(C.steel), 6);
    b.box(0.12, 0.08, 0.02, r * 0.3, h * 0.5, r * 0.98, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }), 0.006);
  },
  heat_pump_indoor: (b, w, d, h, f) => {
    // an indoor unit with its hot-water tank: a tall cabinet, a display, pipes on top
    b.box(w, h - 0.15, d, 0, 0, 0, f, 0.02);
    b.box(w, 0.04, d, 0, h * 0.42, 0.001, mat("#d9dcdf"));
    b.box(0.16, 0.1, 0.01, 0, h * 0.7, d / 2 + 0.001, part(mat(C.screen, { emissive: "#2a5a8a", emissiveIntensity: 0.4 }), "led"), 0.006);
    for (let i = 0; i < 4; i++) b.cyl(0.018, 0.018, 0.15, -w / 2 + 0.12 + i * (w - 0.24) / 3, h - 0.15, -d * 0.2, i % 2 ? mat("#b87333", { metalness: 0.6, roughness: 0.35 }) : mat(C.ceramic), 10);
  },
  fuse_box: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.01);
    b.box(w - 0.04, h - 0.04, 0.01, 0, 0.02, d / 2, f, 0.006);
    b.box(0.02, 0.1, 0.02, w / 2 - 0.05, h * 0.45, d / 2 + 0.01, mat(C.black), 0.004);
    b.box(w * 0.4, 0.06, 0.004, 0, h * 0.8, d / 2 + 0.006, mat("#f2d14b"));
  },
  network_cabinet: (b, w, d, h, f) => {
    // a small rack: glass door, a switch and a router with their lights
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    b.box(w - 0.08, h - 0.08, 0.005, 0, 0.04, d / 2 + 0.001, mat("#6a7680", { transparent: true, opacity: 0.25, roughness: 0.1 }));
    const units = [0.18, 0.32, 0.46];
    for (const [i, y] of units.entries()) {
      b.box(w - 0.12, 0.045, 0.01, 0, h * y, d / 2 - 0.02, mat("#2b2d31"));
      for (let k = 0; k < 8; k++) b.box(0.008, 0.008, 0.004, -w / 2 + 0.1 + k * 0.035, h * y + 0.02, d / 2 - 0.013, mat(k % 3 ? "#3fd27a" : "#f2a53a", { emissive: k % 3 ? "#3fd27a" : "#f2a53a", emissiveIntensity: 0.8 }));
      void i;
    }
  },
  home_battery: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.03);
    b.box(w * 0.04, h * 0.5, 0.004, -w * 0.35, h * 0.25, d / 2 + 0.001, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.6 }));
    b.box(w * 0.3, 0.04, 0.004, 0, h * 0.85, d / 2 + 0.001, mat("#9aa0a6"));
  },
  inverter: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.02);
    for (let i = 0; i < 6; i++) b.box(w * 0.8, 0.008, 0.01, 0, 0.05 + i * 0.03, d / 2, mat("#9aa0a6"));
    b.box(w * 0.3, 0.06, 0.004, 0, h * 0.7, d / 2 + 0.001, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }), 0.004);
    b.box(0.02, 0.02, 0.004, w * 0.25, h * 0.7, d / 2 + 0.001, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.8 }));
  },
  freezer_chest: (b, w, d, h, f) => {
    b.box(w, h - 0.05, d, 0, 0, 0, f, 0.03);
    b.box(w + 0.01, 0.06, d + 0.01, 0, h - 0.06, 0, f, 0.025);
    b.box(w * 0.3, 0.03, 0.03, 0, h - 0.07, d / 2 + 0.01, mat("#9aa0a6"), 0.01);
    b.box(0.03, 0.02, 0.004, -w * 0.4, h * 0.85, d / 2 + 0.001, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.6 }));
  },
  shelving_metal: (b, w, d, h, f) => {
    // a garage rack: angle posts, four shelves, boxes and tins
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.035, h, 0.035, sx * (w / 2 - 0.018), 0, sz * (d / 2 - 0.018), f);
    const rand = random(311);
    for (let i = 0; i < 4; i++) {
      const y = 0.08 + i * (h - 0.12) / 3;
      b.box(w, 0.02, d, 0, y, 0, f);
      let x = -w / 2 + 0.05;
      while (x < w / 2 - 0.25 && i < 3) {
        const bw = 0.2 + rand() * 0.2;
        const bh = 0.15 + rand() * 0.2;
        b.box(bw, bh, d * 0.8, x + bw / 2, y + 0.02, 0, mat(rand() > 0.5 ? "#b8956a" : ["#3a7de0", "#e04a3a", "#4f7a45", "#3a3d41"][Math.floor(rand() * 4)]), 0.01);
        x += bw + 0.04;
      }
    }
  },
  workbench: (b, w, d, h, f, _c, a) => {
    // a wooden top on a steel frame, a pegboard with tools behind it
    b.box(w, 0.05, d, 0, h - 0.05, 0, surface("oak", 0.8), 0.006);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.05, h - 0.05, 0.05, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), a);
    b.box(w - 0.1, 0.03, d - 0.1, 0, 0.15, 0, surface("oak", 0.8));
    b.box(w, 0.8, 0.02, 0, h + 0.15, -d / 2 + 0.01, f);
    const tool = mat("#2b2d31");
    for (let i = 0; i < 7; i++) {
      const x = -w / 2 + 0.15 + i * (w - 0.3) / 6;
      if (i % 3 === 0) b.box(0.03, 0.28, 0.02, x, h + 0.35, -d / 2 + 0.035, mat("#c8382c"), 0.006);
      else if (i % 3 === 1) b.add(new THREE.TorusGeometry(0.06, 0.012, 6, 16), tool, x, h + 0.6, -d / 2 + 0.035);
      else b.box(0.12, 0.04, 0.02, x, h + 0.55, -d / 2 + 0.035, tool, 0.006);
    }
    b.box(0.2, 0.12, 0.12, w * 0.3, h, 0, mat("#c8382c"), 0.01);
  },
  // ----- garden furniture and plants, more -----
  garden_chair: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) {
      b.box(0.04, 0.42, 0.04, sx * (w / 2 - 0.03), 0, d / 2 - 0.05, f);
      b.box(0.04, h, 0.04, sx * (w / 2 - 0.03), 0, -d / 2 + 0.05, f)?.rotation.set(-0.1, 0, 0);
      b.box(0.05, 0.03, d - 0.08, sx * (w / 2 - 0.03), 0.6, 0, f);
    }
    for (let i = 0; i < 5; i++) b.box(w - 0.04, 0.02, 0.07, 0, 0.42, -d / 2 + 0.1 + i * (d - 0.15) / 4, f, 0.004);
    for (let i = 0; i < 4; i++) b.box(w - 0.08, 0.06, 0.02, 0, 0.5 + i * (h - 0.55) / 4, -d / 2 + 0.06 - i * 0.012, f, 0.004);
  },
  garden_bench: (b, w, d, h, f, _c, a) => {
    // wooden slats on cast iron sides
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.04);
      b.box(0.04, 0.44, 0.05, x, 0, d / 2 - 0.08, a);
      b.box(0.04, h, 0.05, x, 0, -d / 2 + 0.06, a)?.rotation.set(-0.12, 0, 0);
      b.box(0.04, 0.04, d - 0.05, x, 0.62, 0.02, a, 0.01);
      b.box(0.04, 0.04, d - 0.15, x, 0.4, 0, a);
    }
    for (let i = 0; i < 5; i++) b.box(w - 0.04, 0.025, 0.07, 0, 0.44, -d / 2 + 0.12 + i * (d - 0.2) / 4, f, 0.004);
    for (let i = 0; i < 3; i++) b.box(w - 0.04, 0.07, 0.025, 0, 0.55 + i * 0.11, -d / 2 + 0.1 - i * 0.012, f, 0.004);
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
  pergola: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.12, h, 0.12, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), f);
    for (const sz of [-1, 1]) b.box(w + 0.2, 0.18, 0.08, 0, h - 0.18, sz * (d / 2 - 0.06), f);
    const n = Math.max(4, Math.round(w / 0.4));
    for (let i = 0; i <= n; i++) b.box(0.05, 0.14, d + 0.2, -w / 2 - 0.05 + (i * (w + 0.1)) / n, h, 0, f);
  },
  outdoor_kitchen: (b, w, d, h, f) => {
    // a masonry block with a grill, a sink and a worktop
    b.box(w, h - 0.05, d, 0, 0, 0, f, 0.01);
    b.box(w + 0.04, 0.05, d + 0.04, 0, h - 0.05, 0, mat("#3b3b3d", { roughness: 0.6 }), 0.006);
    const steel = mat(C.steel, { metalness: 0.6, roughness: 0.35 });
    b.box(0.75, 0.2, d * 0.7, -w / 2 + 0.55, h, -0.02, steel, 0.02);
    fronts(b, -w / 2 + 0.17, 0.75, 0.12, h - 0.35, d / 2 - 0.018, 2, steel, 1, "bar");
    b.box(0.45, 0.004, d * 0.55, w / 2 - 0.4, h, 0.02, mat("#6d7277", { metalness: 0.5, roughness: 0.4 }));
    tapGooseneck(b, w / 2 - 0.4, h, -d / 2 + 0.08, mat(C.chrome, { metalness: 0.85, roughness: 0.2 }));
  },
  dog_house: (b, w, d, h, f) => {
    const wall = h * 0.6;
    b.box(w, wall, d, 0, 0, 0, f, 0.01);
    gableRoof(b, d + 0.12, w + 0.12, wall, h - wall, mat(C.black));
    b.g.children.at(-1)!.rotation.y = Math.PI / 2;
    const door = new THREE.Shape();
    door.moveTo(-0.15, 0);
    door.lineTo(0.15, 0);
    door.lineTo(0.15, wall * 0.5);
    door.absarc(0, wall * 0.5, 0.15, 0, Math.PI, false);
    b.add(new THREE.ShapeGeometry(door, 8), mat("#1c1c1c"), 0, 0, d / 2 + 0.002);
  },
  bird_house: (b, w, d, h, f) => {
    b.cyl(0.03, 0.035, h - 0.25, 0, 0, 0, mat(C.trunk), 8);
    b.box(w * 0.8, 0.2, d * 0.8, 0, h - 0.25, 0, f, 0.01);
    gableRoof(b, w, d, h - 0.05, 0.08, mat("#8a3a32"));
    b.add(new THREE.CircleGeometry(0.025, 12), mat("#1c1c1c"), 0, h - 0.13, d * 0.4 + 0.001);
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
    b.add(new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2), mat("#3f7f9a", { roughness: 0.05 }), 0, h * 0.4, 0);
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
  rose_bush: (b, w, d, h) => {
    const rand = random(317);
    foliage(b, rand, 0, h * 0.5, 0, w / 2, h / 2, d / 2, 260, 0.08, [C.leafDark, C.leaf]);
    for (let i = 0; i < 26; i++) {
      const u = rand() * Math.PI * 2;
      const wv = Math.acos(2 * rand() - 1);
      b.sphere(0.04, Math.sin(wv) * Math.cos(u) * w * 0.48, h * 0.5 + Math.cos(wv) * h * 0.48, Math.sin(wv) * Math.sin(u) * d * 0.48, mat(rand() > 0.3 ? "#c2273a" : "#e88aa0"), 1, 0.8, 1, 8);
    }
  },
  hydrangea: (b, w, d, h) => {
    const rand = random(331);
    foliage(b, rand, 0, h * 0.45, 0, w / 2, h * 0.45, d / 2, 200, 0.12, [C.leaf, C.leafDark]);
    for (let i = 0; i < 16; i++) {
      const u = rand() * Math.PI * 2;
      const wv = Math.acos(rand() * 0.9);
      b.batch(new THREE.IcosahedronGeometry(0.09, 1), mat(["#8fa6e0", "#b59ad9", "#e6a8c4"][i % 3], { roughness: 1 }), matrix(Math.sin(wv) * Math.cos(u) * w * 0.42, h * 0.45 + Math.cos(wv) * h * 0.45, Math.sin(wv) * Math.sin(u) * d * 0.42));
    }
  },
  bamboo: (b, w, d, h) => {
    const rand = random(337);
    for (let i = 0; i < 18; i++) {
      const x = (rand() - 0.5) * w * 0.8;
      const z = (rand() - 0.5) * d * 0.8;
      const top = h * (0.7 + rand() * 0.3);
      const tip = v(x + (rand() - 0.5) * 0.3, top, z + (rand() - 0.5) * 0.3);
      b.rod(v(x, 0, z), tip, 0.015, mat(i % 2 ? "#8aa35a" : "#6f8f48"), 6);
      for (let k = 0; k < 10; k++) {
        const p = v(x, 0, z).lerp(tip, 0.4 + (k / 10) * 0.6);
        b.batch(leafGeometry(0.16, 0.025, 0.4), leafMat(k % 2 ? C.leaf : C.leafLight), matrix(p.x, p.y, p.z, -1.0, rand() * 6, 0));
      }
    }
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
  // ----- bathroom, hall and kitchen extras -----
  towel_ladder: (b, w, d, h, f) => {
    const zAt = (y: number) => d / 2 - 0.02 - (y / h) * (d - 0.04);
    for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.02), 0, zAt(0)), v(sx * (w / 2 - 0.02), h, zAt(h)), 0.016, f, 6);
    for (let i = 1; i < 5; i++) {
      const y = (i * h) / 5;
      b.add(new THREE.CylinderGeometry(0.012, 0.012, w - 0.04, 8).rotateZ(Math.PI / 2), f, 0, y, zAt(y));
      if (i % 2) b.box(w * 0.7, 0.35, 0.03, 0, y - 0.34, zAt(y) + 0.02, mat(i === 1 ? C.linen : "#9fb3c8", { roughness: 1 }), 0.01);
    }
  },
  bath_tall_cabinet: (b, w, d, h, f, _c, a) => {
    b.box(w, h, d - 0.02, 0, 0, -0.01, f, 0.006);
    fronts(b, -w / 2, w, 0.02, h * 0.62, d / 2 - 0.038, 1, f, 1, "bar", a);
    b.box(w - 0.04, 0.02, d - 0.06, 0, h * 0.66, 0, f);
    for (let i = 0; i < 3; i++) b.cyl(0.03, 0.03, 0.12, -w * 0.25 + i * w * 0.25, h * 0.66 + 0.02, 0, mat(["#f2f2f2", "#9fd3e0", "#e8c8a8"][i]), 12);
    fronts(b, -w / 2, w, h * 0.82, h * 0.16, d / 2 - 0.038, 1, f, 1, "bar", a);
  },
  bath_shelf: (b, w, d, h, f) => {
    // a wall shelf with rolled towels and bottles
    for (const y of [0, h - 0.02]) b.box(w, 0.02, d, 0, y, 0, f, 0.004);
    for (const sx of [-1, 1]) b.box(0.02, h, d, sx * (w / 2 - 0.01), 0, 0, f);
    for (let i = 0; i < 3; i++) b.add(new THREE.CylinderGeometry(0.06, 0.06, d * 0.8, 14).rotateX(Math.PI / 2), mat(["#f4f1ea", "#9fb3c8", "#f4f1ea"][i]), -w * 0.25 + i * 0.12, 0.08, 0);
    for (let i = 0; i < 3; i++) b.cyl(0.025, 0.028, 0.14 + i * 0.03, w * 0.15 + i * 0.07, 0.02, 0, mat(["#dfe6ea", "#c9a47c", "#2b2c2e"][i], { roughness: 0.4 }), 10);
  },
  mirror_lit: (b, w, d, h, f) => {
    // a mirror with a glowing edge
    b.box(w, h, d * 0.5, 0, 0, -d / 4, f, 0.02);
    b.box(w - 0.01, h - 0.01, 0.004, 0, 0.005, d / 4, mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.8 }), 0.02);
    b.box(w - 0.05, h - 0.05, 0.006, 0, 0.025, d / 4 + 0.002, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }), 0.015);
  },
  laundry_hamper: (b, w, d, h, f) => {
    b.box(w, h - 0.03, d, 0, 0, 0, wickerMat("sand"), 0.03);
    b.box(w + 0.01, 0.04, d + 0.01, 0, h - 0.04, 0, f, 0.015);
  },
  console_table: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.006);
    b.box(w - 0.06, 0.02, d - 0.04, 0, 0.18, 0, f, 0.004);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.025, h - 0.03, 0.025, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03), a);
    b.cyl(0.07, 0.05, 0.2, -w * 0.3, h, 0, mat(C.ceramic), 16);
    b.cyl(0.08, 0.08, 0.02, w * 0.25, h, 0, mat(FINISHES.brass, { metalness: 0.7, roughness: 0.3 }), 18);
  },
  umbrella_stand: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r * 0.9, h, 0, 0, 0, f, 20);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2;
      b.rod(v(Math.cos(ang) * r * 0.4, 0.1, Math.sin(ang) * r * 0.4), v(Math.cos(ang) * r * 0.7, h + 0.35, Math.sin(ang) * r * 0.7), 0.012, mat(["#2b2c2e", "#8a3a32", "#2f5fa8"][i]), 6);
      b.add(new THREE.TorusGeometry(0.04, 0.008, 6, 10, Math.PI), mat("#5a3a24"), Math.cos(ang) * r * 0.7, h + 0.38, Math.sin(ang) * r * 0.7);
    }
  },
  hall_wardrobe: (b, w, d, h, f, _c, a) => {
    // an open coat bay with a bench and hooks, a cupboard beside it
    const cw = w * 0.45;
    b.box(cw, h, d, w / 2 - cw / 2, 0, 0, f, 0.006);
    fronts(b, w / 2 - cw, cw, 0.05, h - 0.1, d / 2 - 0.018, 1, f, 1, "bar", a);
    b.box(w - cw, 0.02, d, -cw / 2, h - 0.02, 0, f);
    b.box(0.02, h, d, -w / 2 + 0.01, 0, 0, f);
    b.box(w - cw, 0.04, d, -cw / 2, 0.42, 0, f, 0.006);
    b.box(w - cw - 0.04, 0.38, d - 0.04, -cw / 2, 0.02, 0, f, 0.006);
    fronts(b, -w / 2, w - cw, 0.04, 0.36, d / 2 - 0.018, 2, f, 1, "bar", a);
    b.box(w - cw, 0.02, 0.02, -cw / 2, h - 0.35, -d / 2 + 0.03, f);
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + 0.12 + i * ((w - cw - 0.2) / 2);
      b.rod(v(x, h - 0.37, -d / 2 + 0.04), v(x, h - 0.33, -d / 2 + 0.1), 0.007, a, 4);
      b.box(0.08, 0.6, 0.3, x, h - 1.0, -d / 2 + 0.17, mat(C.clothes[i], { roughness: 1 }), 0.03);
    }
  },
  key_cabinet: (b, w, d, h, f, _c, a) => {
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.005, h - 0.01, d / 2 - 0.018, 1, f, 1, "knob", a);
  },
  bar_cart: (b, w, d, h, f, _c, a) => {
    for (const y of [0.15, h - 0.08]) {
      b.box(w, 0.012, d, 0, y, 0, f, 0.004);
      for (const sz of [-1, 1]) b.box(w, 0.04, 0.008, 0, y, sz * (d / 2 - 0.004), a);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.01, 0.01, h, sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02), a, 8);
    b.add(new THREE.TorusGeometry(0.1, 0.012, 6, 20).rotateY(Math.PI / 2), mat(C.black), w / 2 - 0.02, 0.1, 0);
    b.rod(v(-w / 2 - 0.04, h, -d / 2 + 0.02), v(-w / 2 - 0.04, h, d / 2 - 0.02), 0.01, a, 6);
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + 0.1 + i * 0.13;
      b.cyl(0.035, 0.035, 0.22, x, h - 0.068, -0.05, mat(["#2f6b45", "#8a3a32", "#c9a47c", "#e6e1d6"][i], { transparent: true, opacity: 0.85, roughness: 0.1 }), 12);
      b.cyl(0.012, 0.015, 0.08, x, h + 0.152, -0.05, mat(["#2f6b45", "#8a3a32", "#c9a47c", "#e6e1d6"][i]), 8);
    }
  },
  wine_fridge: (b, w, d, h, f) => {
    hollow(b, w, h, d - 0.02, 0, -0.01, f, 0.03);
    b.box(w - 0.04, h - 0.08, 0.01, 0, 0.06, d / 2 - 0.01, mat("#1c2024", { transparent: true, opacity: 0.35, roughness: 0.05 }));
    for (let r = 0; r < 6; r++)
      for (let i = 0; i < 6; i++) {
        const btl = b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 10).rotateX(Math.PI / 2), mat(i % 3 ? "#3a1f24" : "#2f4a35"), -w / 2 + 0.08 + i * (w - 0.16) / 5, 0.12 + r * (h - 0.2) / 6, d / 2 - 0.08);
        void btl;
      }
    b.box(0.02, h * 0.6, 0.03, w / 2 - 0.05, h * 0.2, d / 2 + 0.01, mat(C.chrome, { metalness: 0.8, roughness: 0.2 }), 0.006);
  },
  kitchen_trolley: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.035, d, 0, h - 0.035, 0, surface("oak", 0.7), 0.006);
    for (const y of [0.12, h * 0.5]) b.box(w - 0.04, 0.015, d - 0.04, 0, y, 0, f);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box(0.025, h - 0.06, 0.025, sx * (w / 2 - 0.02), 0.05, sz * (d / 2 - 0.02), f);
      b.sphere(0.025, sx * (w / 2 - 0.02), 0.025, sz * (d / 2 - 0.02), mat(C.black), 1, 1, 1, 8);
    }
    b.rod(v(w / 2 + 0.03, h - 0.08, -d / 2 + 0.05), v(w / 2 + 0.03, h - 0.08, d / 2 - 0.05), 0.01, a, 6);
    for (let i = 0; i < 4; i++) b.cyl(0.04, 0.04, 0.1, -w / 2 + 0.1 + i * 0.13, h * 0.5 + 0.015, 0, glass(), 12);
  },
  display_cabinet: (b, w, d, h, f, _c, a) => {
    // a glass-fronted cabinet with dishes and vases on glass shelves
    const body = new Builder();
    hollow(body, w, h - 0.12, d, 0, 0, f, 0.02);
    const g = body.done();
    g.position.y = 0.12;
    b.g.add(g);
    legs(b, w, d, 0.12, 0.04, 0.012, a);
    const n = Math.max(1, Math.round(w / 0.5));
    for (let i = 0; i < n; i++) {
      const cw = w / n;
      const x = -w / 2 + cw * (i + 0.5);
      b.box(cw - 0.06, h - 0.22, 0.004, x, 0.17, d / 2 + 0.002, glass());
      for (let s = 1; s < 4; s++) {
        const y = 0.12 + ((h - 0.12) * s) / 4;
        b.box(cw - 0.06, 0.008, d - 0.06, x, y, 0, glass());
        if (s % 2) for (let k = 0; k < 3; k++) b.cyl(0.08, 0.075, 0.015, x - cw * 0.2 + k * cw * 0.2, y + 0.008, 0, mat(C.ceramic), 16);
        else b.cyl(0.04, 0.06, 0.18, x, y + 0.008, 0, mat(["#5d7a60", "#b5683f", "#4d6a88"][(i + s) % 3]), 14);
      }
      b.box(0.012, 0.15, 0.02, x + cw / 2 - 0.05, h * 0.5, d / 2 + 0.01, a, 0.004);
      b.box(0.005, h - 0.2, 0.02, -w / 2 + cw * (i + 1), 0.16, d / 2, mat("#26272a"));
    }
  },
  bar_stool_back: (b, w, d, h, f, _c, a) => {
    const seat = h * 0.68;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.06), seat, sz * (d / 2 - 0.06)), v(sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03)), 0.012, a, 6);
    b.add(new THREE.TorusGeometry(Math.min(w, d) * 0.42, 0.008, 6, 4, Math.PI * 2).rotateX(Math.PI / 2).rotateY(Math.PI / 4), a, 0, seat * 0.35, 0);
    b.box(w - 0.04, 0.05, d - 0.06, 0, seat, 0.01, f, 0.02);
    b.box(w - 0.06, h - seat - 0.05, 0.04, 0, seat + 0.05, -d / 2 + 0.04, f, 0.02)?.rotation.set(-0.1, 0, 0);
  },
  dining_armchair: (b, w, d, h, f, _c, a) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * w * 0.25, 0.42, 0.02 + sz * d * 0.22), v(sx * w * 0.36, 0, 0.02 + sz * d * 0.34), 0.016, a, 8);
    // a curved shell: back and arms in one, a cushion
    const shell = new THREE.CylinderGeometry(w / 2, w / 2 - 0.03, h - 0.44, 28, 1, true, Math.PI * 0.6, Math.PI * 0.8);
    shell.scale(1, 1, (d * 0.95) / w);
    b.add(shell, mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, 0.44 + (h - 0.44) / 2, 0.02);
    b.add(new THREE.CylinderGeometry(w / 2 - 0.03, w / 2 - 0.03, 0.08, 28).scale(1, 1, (d * 0.9) / w), f, 0, 0.44, 0.02);
  },
  rug_persian: (b, w, d, h, _f, color) => b.box(w, h, d, 0, 0, 0, rugMaterial("persian", color, mat(FINISHES[color] ?? FINISHES.terracotta))),
  rug_berber: (b, w, d, h, _f, color) => b.box(w, h, d, 0, 0, 0, rugMaterial("berber", color, mat(FINISHES[color] ?? FINISHES.beige))),
  floor_lamp_reading: (b, w, d, h, f, _c, a) => {
    b.cyl(w * 0.4, w * 0.42, 0.025, 0, 0, 0, a, 24);
    b.cyl(0.01, 0.01, h - 0.15, 0, 0.025, 0, a, 8);
    b.rod(v(0, h - 0.13, 0), v(0, h - 0.05, d * 0.35), 0.008, a, 6);
    const shade = b.add(new THREE.CylinderGeometry(0.04, 0.08, 0.14, 20, 1, true), mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide }), 0, h - 0.1, d * 0.4);
    shade.rotation.x = 0.4;
    bulb(b, 0, h - 0.14, d * 0.42, 0.025);
  },
  table_lamp_glass: (b, w, _d, h, f, c, a) => {
    // a clear glass base, a linen drum
    b.add(new THREE.LatheGeometry([[0.001, 0], [0.4, 0], [0.48, 0.25], [0.42, 0.45], [0.15, 0.55], [0.001, 0.55]].map(([x, y]) => new THREE.Vector2(x * w * 0.6, y * h)), 28), glass());
    b.cyl(0.008, 0.008, h * 0.15, 0, h * 0.55, 0, a, 8);
    b.cyl(w * 0.42, w * 0.5, h * 0.32, 0, h * 0.66, 0, shadeMat(f, c), 30, true);
    bulb(b, 0, h * 0.72, 0, 0.03);
  },
  pendant_bell: (b, w, d, h, f, c, a) => {
    const r = Math.min(w, d) / 2;
    const sh = r * 1.2;
    canopyAndCord(b, h, sh, a);
    b.add(new THREE.LatheGeometry([[0.06, 1], [0.12, 0.85], [0.18, 0.5], [0.35, 0.15], [0.5, 0]].map(([x, y]) => new THREE.Vector2(x * r * 2, y * sh)), 32), shadeMat(f, c), 0, 0, 0);
    bulb(b, 0, sh * 0.2, 0, 0.04);
  },
  fireplace_open: (b, w, d, h, f, _c, a) => {
    // a classic open fireplace: a surround with a mantel shelf, an arched firebox, logs burning
    const ow = w * 0.55;
    const oh = Math.min(0.75, h * 0.6);
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h - 0.08);
    s.lineTo(-w / 2, h - 0.08);
    s.lineTo(-w / 2, 0);
    const hole = new THREE.Path();
    hole.moveTo(-ow / 2, 0.08);
    hole.lineTo(ow / 2, 0.08);
    hole.lineTo(ow / 2, oh - ow * 0.2);
    hole.quadraticCurveTo(0, oh + ow * 0.12, -ow / 2, oh - ow * 0.2);
    hole.lineTo(-ow / 2, 0.08);
    s.holes.push(hole);
    const surround = new THREE.ExtrudeGeometry(s, { depth: d * 0.35, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 12 });
    b.add(surround, f, 0, 0, d / 2 - d * 0.35);
    b.box(ow + 0.02, oh + 0.05, d * 0.65, 0, 0.06, -d / 2 + d * 0.325, mat("#1b1714", { roughness: 1 }));
    b.box(w + 0.14, 0.08, d + 0.06, 0, h - 0.08, 0.03, a, 0.01);
    b.box(w + 0.3, 0.06, d + 0.3, 0, 0, 0.15, mat("#5e5a54", { roughness: 0.9 }), 0.005);
    for (const [x, rz] of [[-0.12, 0.25], [0.1, -0.2], [0, 0]] as const) b.add(new THREE.CylinderGeometry(0.05, 0.05, ow * 0.7, 8).rotateZ(Math.PI / 2 + rz), mat(C.trunk), x * ow, 0.13 + (rz === 0 ? 0.07 : 0), 0.02);
    fire(b, ow * 0.6, 0.12, 0.06, oh * 0.45);
    for (const sx of [-1, 1]) b.cyl(0.03, 0.03, 0.14, sx * w * 0.32, h, 0.05, mat(C.ceramic), 12);
  },
  fireplace_glass: (b, w, d, h, f) => {
    // a modern fire behind glass on three sides, a black frame, a plinth with logs stored under it
    const base = Math.min(0.45, h * 0.35);
    const fh = Math.min(0.55, h - base - 0.1);
    b.box(w, base, d, 0, 0, 0, f, 0.01);
    for (let i = 0; i < Math.round(w / 0.16); i++) b.add(new THREE.CylinderGeometry(0.05, 0.05, d * 0.8, 8).rotateX(Math.PI / 2), mat(i % 2 ? C.trunk : "#7a5a43"), -w / 2 + 0.1 + i * 0.16, 0.08, 0.05);
    b.box(w - 0.04, base - 0.12, 0.02, 0, 0.1, d / 2 - 0.05, mat("#141414"));
    const y = base;
    b.box(w, 0.04, d, 0, y, 0, mat(C.black));
    b.box(w, 0.04, d, 0, y + fh, 0, mat(C.black));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.03, fh, 0.03, sx * (w / 2 - 0.015), y + 0.04, sz * (d / 2 - 0.015), mat(C.black));
    b.box(w - 0.06, 0.02, d - 0.06, 0, y + 0.04, 0, mat("#3a3a3a", { roughness: 1 }));
    fire(b, w * 0.7, y + 0.06, 0, fh * 0.6);
    b.box(w - 0.03, fh - 0.04, 0.004, 0, y + 0.06, d / 2 - 0.015, glass());
    for (const sx of [-1, 1]) b.box(0.004, fh - 0.04, d - 0.03, sx * (w / 2 - 0.015), y + 0.06, 0, glass());
    b.box(w, h - y - fh - 0.04, d * 0.9, 0, y + fh + 0.04, -d * 0.05, f, 0.01);
  },
  hedge_trimmed: (b, w, d, h) => {
    // a hedge cut to a crisp block: a slightly rounded core, small leaves all over
    const rand = random(353);
    b.batch(new RoundedBoxGeometry(w, h - 0.03, d, 3, Math.min(0.08, d / 4)), mat("#2f5a2f"), matrix(0, (h - 0.03) / 2 + 0.03, 0));
    const leaf = smallLeaf(0.05);
    const n = Math.min(2400, Math.round((w * h * 2 + d * h * 2 + w * d) * 160));
    for (let i = 0; i < n; i++) {
      const face = rand();
      let x: number;
      let y: number;
      let z: number;
      if (face < (w * d) / (w * d + 2 * w * h + 2 * d * h)) [x, y, z] = [(rand() - 0.5) * w, h, (rand() - 0.5) * d];
      else if (rand() < w / (w + d)) [x, y, z] = [(rand() - 0.5) * w, 0.05 + rand() * (h - 0.05), (rand() > 0.5 ? 1 : -1) * (d / 2)];
      else [x, y, z] = [(rand() > 0.5 ? 1 : -1) * (w / 2), 0.05 + rand() * (h - 0.05), (rand() - 0.5) * d];
      b.batch(leaf.clone(), leafMat(i % 3 ? "#3f7037" : "#4f8a3f"), matrix(x, y, z, rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI, 0.8 + rand() * 0.5));
    }
    b.box(w * 0.2, 0.05, d * 0.3, 0, 0, 0, mat(C.trunk));
  },
  chair_arm_wood: (b, w, d, h, f, _c, a) => {
    // a classic wooden dining chair with arms and an upholstered seat
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.03);
      b.box(0.04, 0.65, 0.04, x, 0, d / 2 - 0.05, f);
      b.box(0.04, h, 0.04, x, 0, -d / 2 + 0.04, f)?.rotation.set(-0.06, 0, 0);
      b.box(0.05, 0.03, d - 0.02, x, 0.65, 0.0, f, 0.01);
      b.box(0.03, 0.03, d - 0.1, x, 0.15, 0, f);
    }
    b.box(w - 0.06, 0.06, d - 0.08, 0, 0.4, 0.01, f, 0.01);
    b.box(w - 0.1, 0.06, d - 0.14, 0, 0.45, 0.02, a, 0.025);
    b.box(w - 0.08, 0.12, 0.03, 0, h - 0.14, -d / 2 + 0.05, f, 0.01)?.rotation.set(-0.06, 0, 0);
    for (let i = 0; i < 3; i++) b.box(0.03, h - 0.65, 0.02, -w * 0.18 + i * w * 0.18, 0.5, -d / 2 + 0.06, f)?.rotation.set(-0.06, 0, 0);
  },
  // ----- hobby, sport and pets -----
  treadmill: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.18, d, 0, 0, 0, f, 0.03);
    b.box(w * 0.7, 0.01, d * 0.85, 0, 0.18, 0.05, mat("#1c1d20", { roughness: 1 }));
    for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.05), 0.15, -d / 2 + 0.15), v(sx * (w / 2 - 0.08), h - 0.2, -d / 2 + 0.05), 0.03, a, 8);
    b.box(w * 0.85, 0.2, 0.18, 0, h - 0.25, -d / 2 + 0.05, f, 0.03)?.rotation.set(0.5, 0, 0);
    b.box(w * 0.35, 0.12, 0.01, 0, h - 0.22, -d / 2 + 0.16, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }))?.rotation.set(0.5, 0, 0);
    for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.06), h - 0.35, -d / 2 + 0.1), v(sx * (w / 2 - 0.06), h - 0.35, -d / 2 + 0.45), 0.018, a, 6);
  },
  exercise_bike: (b, w, d, h, f, _c, a) => {
    b.box(w, 0.05, 0.08, 0, 0, -d / 2 + 0.1, a, 0.02);
    b.box(w, 0.05, 0.08, 0, 0, d / 2 - 0.1, a, 0.02);
    b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 28).rotateZ(Math.PI / 2), f, 0, 0.3, d / 2 - 0.25);
    b.rod(v(0, 0.05, -d / 2 + 0.1), v(0, 0.75, -d * 0.12), 0.035, a, 8);
    b.rod(v(0, 0.05, d / 2 - 0.1), v(0, h - 0.15, d / 2 - 0.25), 0.035, a, 8);
    b.box(0.16, 0.06, 0.26, 0, 0.78, -d * 0.12, mat(C.black), 0.03);
    b.rod(v(-0.22, h - 0.12, d / 2 - 0.3), v(0.22, h - 0.12, d / 2 - 0.3), 0.015, mat(C.black), 6);
    b.box(0.2, 0.12, 0.02, 0, h - 0.05, d / 2 - 0.22, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }))?.rotation.set(-0.5, 0, 0);
  },
  rowing_machine: (b, w, d, h, f, _c, a) => {
    b.box(0.1, 0.06, d * 0.75, 0, 0.12, -d * 0.1, a, 0.02);
    for (const z of [-d / 2 + 0.05, d * 0.25]) b.box(w, 0.04, 0.06, 0, 0, z, a, 0.01);
    b.rod(v(0, 0.04, -d / 2 + 0.05), v(0, 0.12, -d / 2 + 0.12), 0.02, a, 6);
    b.box(0.3, 0.06, 0.3, 0, 0.22, -d * 0.15, mat(C.black), 0.03);
    b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 28).rotateZ(Math.PI / 2), f, 0, h - 0.24, d / 2 - 0.22);
    for (const sx of [-1, 1]) b.box(0.12, 0.02, 0.26, sx * 0.1, 0.18, d * 0.18, mat(C.black), 0.01)?.rotation.set(-0.6, 0, 0);
    b.rod(v(-0.2, 0.5, d * 0.3), v(0.2, 0.5, d * 0.3), 0.015, mat(C.black), 6);
  },
  weight_bench: (b, w, d, h, f, _c, a) => {
    b.box(w * 0.5, 0.08, d, 0, h - 0.08, 0, f, 0.03);
    for (const z of [-d / 2 + 0.15, d / 2 - 0.15]) {
      b.box(0.05, h - 0.08, 0.05, 0, 0, z, a);
      b.box(w, 0.05, 0.06, 0, 0, z, a, 0.01);
    }
  },
  dumbbell_rack: (b, w, d, h, f, _c, a) => {
    for (const sx of [-1, 1]) b.box(0.05, h, d, sx * (w / 2 - 0.025), 0, 0, a);
    for (let r = 0; r < 2; r++) {
      const y = 0.3 + r * (h - 0.4) / 1.5;
      b.box(w, 0.03, d * 0.7, 0, y, 0, a)?.rotation.set(r ? 0.3 : 0.2, 0, 0);
      const n = Math.max(3, Math.round(w / 0.2));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.12 + (i * (w - 0.24)) / (n - 1);
        const s = 0.04 + (i / n) * 0.03;
        for (const sz of [-1, 1]) b.add(new THREE.CylinderGeometry(s, s, 0.05, 12).rotateX(Math.PI / 2), f, x, y + 0.06, sz * 0.09);
        b.rod(v(x, y + 0.06, -0.09), v(x, y + 0.06, 0.09), 0.012, mat(C.steel), 6);
      }
    }
  },
  yoga_mat: (b, w, d, h, f) => {
    b.box(w, Math.max(0.006, h), d - 0.15, 0, 0, 0.075, f, 0.004);
    b.add(new THREE.CylinderGeometry(0.06, 0.06, w, 18).rotateZ(Math.PI / 2), f, 0, 0.06, -d / 2 + 0.07);
  },
  punching_bag: (b, w, d, h, f) => {
    // hangs from the ceiling on chains
    const r = Math.min(w, d) / 2;
    const bag = Math.min(1.2, h * 0.65);
    b.add(new THREE.CapsuleGeometry(r * 0.9, bag - r * 1.8, 6, 20), f, 0, h - 0.3 - bag / 2, 0);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      b.rod(v(Math.cos(ang) * r * 0.7, h - 0.3, Math.sin(ang) * r * 0.7), v(0, h - 0.02, 0), 0.005, mat(C.steel), 4);
    }
  },
  billiard_table: (b, w, d, h, f, _c, a) => {
    const t = 0.12;
    b.box(w, 0.2, d, 0, h - 0.2, 0, f, 0.02);
    b.box(w - 2 * t, 0.012, d - 2 * t, 0, h, 0, mat("#2f6b45", { roughness: 1 }));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]) b.cyl(0.05, 0.05, 0.015, x * (w / 2 - t), h - 0.002, z * (d / 2 - t), mat("#111"), 14);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.14, h - 0.2, 0.14, sx * (w / 2 - 0.15), 0, sz * (d / 2 - 0.2), f, 0.02);
    const rand = random(359);
    const balls = ["#f2d14b", "#3a7de0", "#d23a2a", "#7a3b8f", "#e8892e", "#2f7a45", "#8a3a32", "#111111", "#f4f4f0"];
    for (let i = 0; i < balls.length; i++) b.sphere(0.028, (rand() - 0.5) * (w - 0.4), h + 0.04, (rand() - 0.5) * (d - 0.5), mat(balls[i], { roughness: 0.3 }), 1, 1, 1, 12);
    b.rod(v(-w * 0.2, h + 0.03, d * 0.1), v(w * 0.3, h + 0.05, d * 0.45), 0.012, a, 6);
  },
  table_tennis: (b, w, d, h, f) => {
    b.box(w, 0.025, d, 0, h - 0.025, 0, f, 0.004);
    const line = mat("#f4f4f0");
    for (const sx of [-1, 1]) b.box(0.02, 0.002, d, sx * (w / 2 - 0.01), h, 0, line);
    for (const sz of [-1, 1]) b.box(w, 0.002, 0.02, 0, h, sz * (d / 2 - 0.01), line);
    b.box(0.004, 0.002, d, 0, h, 0, line);
    b.box(w + 0.1, 0.15, 0.01, 0, h, 0, mat("#e8e6e1", { transparent: true, opacity: 0.6 }));
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) b.box(0.05, h - 0.025, 0.05, sx * (w / 2 - 0.2), 0, sz * (d / 2 - 0.4), mat(C.black));
  },
  foosball: (b, w, d, h, f, _c, a) => {
    const top = h - 0.12;
    b.box(w, 0.25, d, 0, top - 0.25, 0, f, 0.02);
    b.box(w - 0.08, 0.01, d - 0.08, 0, top - 0.22, 0, mat("#2f7a45", { roughness: 1 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.07, top - 0.25, 0.07, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.08), f, 0.01);
    const rods = 8;
    for (let i = 0; i < rods; i++) {
      const z = -d / 2 + 0.12 + (i * (d - 0.24)) / (rods - 1);
      b.rod(v(-w / 2 - 0.12, top - 0.1, z), v(w / 2 + 0.12, top - 0.1, z), 0.008, mat(C.steel), 6);
      const players = [1, 2, 5, 3, 3, 5, 2, 1][i];
      for (let p = 0; p < players; p++) b.box(0.03, 0.12, 0.02, -w / 2 + 0.1 + ((p + 0.5) * (w - 0.2)) / players, top - 0.2, z, mat(i % 2 ? "#d23a2a" : "#3a7de0"), 0.008);
      b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2), a, (i % 2 ? -1 : 1) * (w / 2 + 0.17), top - 0.1, z);
    }
  },
  dartboard: (b, w, d, h) => {
    const r = Math.min(w, h) / 2;
    b.add(new THREE.CylinderGeometry(r, r, d, 40).rotateX(Math.PI / 2), mat("#1c1c1c"), 0, r, 0);
    // twenty segments, light and dark, with the red and green double and treble rings
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * Math.PI * 2;
      const seg = (r0: number, r1: number, c: string, z: number) => b.add(new THREE.RingGeometry(r * r0, r * r1, 2, 1, a0, Math.PI / 10), mat(c), 0, r, d / 2 + z);
      seg(0.08, 0.78, i % 2 ? "#e8dcc0" : "#2b2b2b", 0.001);
      seg(0.45, 0.5, i % 2 ? "#2f7a45" : "#c8382c", 0.0015);
      seg(0.73, 0.78, i % 2 ? "#2f7a45" : "#c8382c", 0.0015);
    }
    b.add(new THREE.CircleGeometry(r * 0.08, 20), mat("#2f7a45"), 0, r, d / 2 + 0.001);
    b.add(new THREE.CircleGeometry(r * 0.035, 16), mat("#c8382c"), 0, r, d / 2 + 0.0015);
  },
  projector_screen: (b, w, d, h, f) => {
    b.box(w + 0.1, 0.08, d, 0, h - 0.08, 0, f, 0.02);
    b.box(w, h - 0.12, 0.004, 0, 0.04, 0, part(mat("#f6f6f4", { roughness: 1 }), "screen"));
    b.box(w, 0.04, 0.01, 0, 0.0, 0, mat(C.black));
  },
  cat_tree: (b, w, d, h, f) => {
    const sisal = mat("#c9ad80", { roughness: 1 });
    b.box(w, 0.04, d, 0, 0, 0, f, 0.01);
    for (const [x, z, ph] of [[-w * 0.25, -d * 0.2, h * 0.55], [w * 0.25, d * 0.2, h * 0.95], [w * 0.25, -d * 0.25, h * 0.35]] as const) b.cyl(0.05, 0.05, ph, x, 0.04, z, sisal, 12);
    b.box(w * 0.7, 0.03, d * 0.5, -w * 0.1, h * 0.55, -d * 0.15, f, 0.01);
    b.box(w * 0.55, 0.03, d * 0.55, w * 0.15, h * 0.95, d * 0.1, f, 0.01);
    b.box(0.32, 0.3, 0.32, -w * 0.15, h * 0.58, -d * 0.15, f, 0.02);
    b.add(new THREE.CircleGeometry(0.09, 16), mat("#1c1c1c"), -w * 0.15, h * 0.58 + 0.15, -d * 0.15 + 0.161);
    b.sphere(0.05, w * 0.35, h * 0.3, d * 0.2, mat("#d23a2a"), 1, 1, 1, 10);
  },
  dog_bed: (b, w, d, h, f) => {
    const rim = new THREE.TorusGeometry(0.5, 0.12, 10, 28);
    rim.rotateX(Math.PI / 2);
    rim.scale(w * 0.85, h / 0.24, d * 0.85);
    b.add(rim, f, 0, h * 0.5, 0);
    b.add(new THREE.CylinderGeometry(0.5, 0.5, h * 0.4, 28).scale(w * 0.8, 1, d * 0.8), mat(C.linen, { roughness: 1 }), 0, h * 0.2, 0);
  },
  pet_bowls: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) {
      b.add(new THREE.LatheGeometry([[0.001, 0], [0.07, 0], [0.085, h], [0.075, h], [0.06, 0.012], [0.001, 0.012]].map(([x, y]) => new THREE.Vector2(x, y)), 20), f, sx * w * 0.25, 0, 0);
      b.cyl(0.06, 0.06, 0.005, sx * w * 0.25, h * 0.6, 0, mat(sx < 0 ? "#8a5a3a" : "#7fc7f0", { roughness: sx < 0 ? 1 : 0.1 }), 16);
    }
    void d;
  },
  bird_cage: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.04, 0, 0, 0, f, 20);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      b.rod(v(Math.cos(a) * r * 0.95, 0.04, Math.sin(a) * r * 0.95), v(Math.cos(a) * r * 0.95, h * 0.7, Math.sin(a) * r * 0.95), 0.004, f, 3);
      b.rod(v(Math.cos(a) * r * 0.95, h * 0.7, Math.sin(a) * r * 0.95), v(0, h - 0.06, 0), 0.004, f, 3);
    }
    b.add(new THREE.TorusGeometry(0.03, 0.006, 6, 12), f, 0, h - 0.03, 0);
    b.rod(v(-r * 0.6, h * 0.35, 0), v(r * 0.6, h * 0.35, 0), 0.006, mat(C.trunk), 4);
    b.sphere(0.04, 0, h * 0.35 + 0.05, 0, mat("#3fae5f"), 0.8, 1, 1.3, 10);
  },
  guitar_stand: (b, w, d, h, f, _c, a) => {
    // an acoustic guitar leaning in its stand
    for (const [x, z] of [[-0.12, 0.1], [0.12, 0.1], [0, -0.12]]) b.rod(v(0, 0.3, -0.05), v(x, 0, z), 0.008, a, 4);
    b.rod(v(0, 0.3, -0.05), v(0, h * 0.62, -0.1), 0.008, a, 4);
    const g = new THREE.Group();
    const body = new THREE.Shape();
    body.moveTo(0, 0);
    body.bezierCurveTo(0.2, 0, 0.21, 0.2, 0.12, 0.27);
    body.bezierCurveTo(0.16, 0.33, 0.15, 0.48, 0, 0.5);
    body.bezierCurveTo(-0.15, 0.48, -0.16, 0.33, -0.12, 0.27);
    body.bezierCurveTo(-0.21, 0.2, -0.2, 0, 0, 0);
    const geo = new THREE.ExtrudeGeometry(body, { depth: 0.1, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 10 });
    g.add(new THREE.Mesh(geo, f));
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), mat("#1c1c1c"));
    hole.position.set(0, 0.33, 0.109);
    g.add(hole);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.03), mat("#4a3022"));
    neck.position.set(0, 0.74, 0.08);
    g.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.17, 0.03), mat("#4a3022"));
    head.position.set(0, 1.04, 0.08);
    g.add(head);
    g.scale.setScalar(h / 1.12);
    g.position.set(0, 0.08, -0.02);
    g.rotation.x = -0.18;
    b.g.add(g);
    void w;
    void d;
  },
  drum_kit: (b, w, d, h, f, _c, a) => {
    const shell = f;
    const head = mat("#f4f2ec", { roughness: 0.8 });
    const drum = (r: number, depth: number, x: number, y: number, z: number, rx = 0) => {
      const m = b.add(new THREE.CylinderGeometry(r, r, depth, 28), shell, x, y, z);
      m.rotation.x = rx;
      const hd = b.add(new THREE.CylinderGeometry(r * 0.97, r * 0.97, depth + 0.004, 28), head, x, y, z);
      hd.rotation.x = rx;
      hd.scale.set(1, 1, 1);
    };
    drum(0.28, 0.4, 0, 0.28, -0.05, Math.PI / 2);
    drum(0.18, 0.15, -w * 0.12, 0.72, -0.1, 0.4);
    drum(0.18, 0.15, w * 0.12, 0.72, -0.1, 0.4);
    drum(0.22, 0.4, w * 0.32, 0.25, d * 0.15);
    drum(0.18, 0.14, -w * 0.22, 0.6, d * 0.2);
    for (const [x, z, y] of [[-w * 0.4, -d * 0.1, h - 0.1], [w * 0.4, -d * 0.25, h], [-w * 0.35, d * 0.3, 0.85]] as const) {
      b.rod(v(x, 0, z), v(x, y, z), 0.01, a, 6);
      b.cyl(0.22, 0.01, 0.015, x, y, z, mat(FINISHES.brass, { metalness: 0.8, roughness: 0.3 }), 24);
    }
    b.cyl(0.17, 0.17, 0.08, 0, 0.5, d * 0.42, mat(C.black), 18);
    b.cyl(0.02, 0.02, 0.5, 0, 0, d * 0.42, a, 8);
  },
  keyboard_stand: (b, w, d, h, f, _c, a) => {
    for (const sx of [-1, 1]) {
      b.rod(v(sx * w * 0.3, 0, -d * 0.3), v(sx * w * 0.3, h - 0.12, d * 0.3), 0.015, a, 6);
      b.rod(v(sx * w * 0.3, 0, d * 0.3), v(sx * w * 0.3, h - 0.12, -d * 0.3), 0.015, a, 6);
    }
    b.box(w, 0.1, d, 0, h - 0.1, 0, f, 0.02);
    keys(b, w - 0.12, h, d * 0.15);
    b.box(w * 0.3, 0.004, 0.06, -w * 0.2, h, -d * 0.3, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.3 }));
  },
  // ----- climate -----
  radiator_panel: (b, w, d, h, f) => {
    f = warmMat(f);
    b.box(w, h, d * 0.5, 0, 0, -d * 0.1, f, 0.006);
    for (let i = 0; i < Math.round(w / 0.05); i++) b.box(0.018, h - 0.04, 0.012, -w / 2 + 0.025 + i * 0.05, 0.02, d * 0.15 + 0.006, f, 0.004);
    b.box(w, 0.03, d * 0.6, 0, h, -d * 0.05, f, 0.006);
    b.cyl(0.02, 0.025, 0.08, w / 2 - 0.05, h, d * 0.1, mat(C.ceramic), 12);
  },
  radiator_flat: (b, w, d, h, f) => {
    // a flat-front panel: smooth face, closed ends, a grille on top, the valve at the side
    f = warmMat(f);
    b.box(w, h, d * 0.55, 0, 0, back(d) + d * 0.35, f, 0.008);
    b.box(w - 0.02, h - 0.01, 0.012, 0, 0.005, back(d) + d * 0.66, f, 0.004);
    for (let i = 0; i < Math.floor((w - 0.06) / 0.025); i++) b.box(0.008, 0.004, d * 0.4, -w / 2 + 0.04 + i * 0.025, h - 0.001, back(d) + d * 0.35, mat(C.black));
    radiatorValve(b, w / 2 + 0.035, h * 0.75, back(d) + d * 0.35);
  },
  radiator_vertical: (b, w, d, h, f) => {
    // a tall designer panel: a slim body, a front of vertical channels, a hidden valve below
    f = warmMat(f);
    b.box(w, h, d * 0.45, 0, 0, back(d) + d * 0.3, f, 0.01);
    const n = Math.max(3, Math.round(w / 0.075));
    for (let i = 0; i < n; i++) b.box(w / n - 0.008, h - 0.02, 0.02, -w / 2 + (i + 0.5) * (w / n), 0.01, back(d) + d * 0.62, f, 0.008);
    b.cyl(0.012, 0.012, 0.1, w / 2 - 0.05, -0.1, back(d) + d * 0.3, mat(C.chrome), 10);
  },
  radiator_tube: (b, w, d, h, f) => {
    // steel column tubes, two deep, with headers top and bottom
    f = warmMat(f);
    const n = Math.max(4, Math.round(w / 0.045));
    const tube = new THREE.CylinderGeometry(0.0125, 0.0125, h - 0.05, 10);
    for (let i = 0; i < n; i++)
      for (const z of [back(d) + d * 0.3, back(d) + d * 0.7]) b.batch(tube.clone(), f, new THREE.Matrix4().makeTranslation(-w / 2 + (i + 0.5) * (w / n), h / 2, z));
    for (const y of [0, h - 0.035]) b.box(w, 0.035, d * 0.75, 0, y, back(d) + d * 0.5, f, 0.012);
    radiatorValve(b, w / 2 + 0.035, h * 0.15, back(d) + d * 0.5);
  },
  radiator_cast_iron: (b, w, d, h, f) => {
    // an old cast-iron radiator on feet: sections of rounded columns, hubs top and bottom
    f = warmMat(f);
    const n = Math.max(4, Math.round(w / 0.065));
    const pitch = w / n;
    const col = new THREE.CapsuleGeometry(0.016, h - 0.16, 4, 10);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * pitch;
      for (const z of [-d * 0.22, 0, d * 0.22]) b.batch(col.clone(), f, new THREE.Matrix4().makeTranslation(x, h / 2 + 0.03, z));
      for (const y of [0.1, h - 0.06]) b.batch(new THREE.CylinderGeometry(0.024, 0.024, pitch * 0.9, 10).rotateZ(Math.PI / 2), f, new THREE.Matrix4().makeTranslation(x, y, 0));
    }
    // a little ornament on the top of each section
    for (let i = 0; i < n; i++) b.batch(new THREE.SphereGeometry(0.012, 8, 6), f, new THREE.Matrix4().makeTranslation(-w / 2 + (i + 0.5) * pitch, h - 0.012, 0));
    for (const sx of [-1, 1]) b.box(0.05, 0.06, d * 0.8, sx * (w / 2 - pitch / 2), 0, 0, f, 0.01);
    b.cyl(0.012, 0.012, 0.08, w / 2 + 0.03, h - 0.1, 0, mat(C.chrome), 10).rotation.z = Math.PI / 2;
    b.cyl(0.022, 0.022, 0.04, w / 2 + 0.08, h - 0.11, 0, mat("#2b2c2e"), 12);
  },
  radiator_convector: (b, w, d, h, f) => {
    // a 1970s convector: a box with a slanted front, louvres on top, a knob at the side
    f = warmMat(f);
    b.box(w, h, d * 0.9, 0, 0, back(d) + d * 0.45, f, 0.012);
    for (let i = 0; i < Math.floor((w - 0.08) / 0.03); i++) b.box(0.012, 0.004, d * 0.6, -w / 2 + 0.05 + i * 0.03, h - 0.002, back(d) + d * 0.45, mat(C.black));
    for (let i = 0; i < 6; i++) b.box(w - 0.12, 0.006, 0.004, 0, 0.05 + i * 0.022, back(d) + d * 0.9 + 0.001, mat(C.black));
    b.cyl(0.02, 0.02, 0.025, w / 2 - 0.06, h * 0.6, back(d) + d * 0.9 + 0.012, mat(C.steel), 16).rotation.x = Math.PI / 2;
  },
  ac_split: (b, w, d, h, f) => {
    // a classic wall unit: a rounded body, an intake grille on top, the louvre underneath
    b.box(w, h, d, 0, 0, 0, f, Math.min(0.06, h / 3));
    for (let i = 0; i <= Math.floor((w - 0.12) / 0.03); i++) b.box(0.012, 0.004, d * 0.5, -w / 2 + 0.06 + i * 0.03, h - 0.002, -d * 0.1, mat("#aeb3b8"));
    b.box(w - 0.1, 0.03, 0.006, 0, 0.012, d / 2 - 0.004, mat("#3a3d41"));
    b.box(w - 0.06, 0.04, 0.03, 0, 0.02, d / 2 - 0.01, mat("#c9cdd1"), 0.01)?.rotation.set(0.5, 0, 0);
    b.box(0.04, 0.012, 0.004, w * 0.3, h * 0.6, d / 2 + 0.001, ledMat());
  },
  ac_wall_design: (b, w, d, h, f) => {
    // a flat designer unit: a slim body behind a front panel in the finish, a thin outlet slot
    b.box(w - 0.02, h - 0.02, d - 0.03, 0, 0.01, -0.015, mat("#dcdfe2"), 0.02);
    b.box(w, h - 0.03, 0.025, 0, 0.03, d / 2 - 0.0125, f, 0.012);
    b.box(w - 0.08, 0.012, 0.01, 0, 0.012, d / 2 - 0.03, mat("#2b2c2e"));
    b.box(w * 0.18, 0.004, 0.002, 0, h * 0.25, d / 2 + 0.001, ledMat("#f2f2f2"));
  },
  ac_ceiling: (b, w, d, h, f) => {
    // an under-ceiling unit: a wide flat body, the outlet and louvre along its front
    b.box(w, h - 0.02, d, 0, 0.02, 0, f, Math.min(0.05, h / 3));
    for (const sx of [-1, 1]) b.box(0.05, 0.02, d * 0.6, sx * (w / 2 - 0.1), h - 0.02, -d * 0.1, mat(C.steel));
    b.box(w - 0.12, h * 0.25, 0.006, 0, 0.02 + h * 0.2, d / 2 - 0.002, mat("#3a3d41"));
    b.box(w - 0.14, 0.03, 0.035, 0, 0.0, d / 2 - 0.03, mat("#c9cdd1"), 0.01)?.rotation.set(-0.4, 0, 0);
    b.box(0.03, 0.012, 0.004, w / 2 - 0.08, h * 0.6, d / 2 + 0.001, ledMat());
  },
  ac_cassette: (b, w, d, h, f) => {
    // a ceiling cassette: the unit sits above the ceiling, only its square panel shows
    b.box(w, h - 0.006, d, 0, 0.006, 0, f, 0.01);
    const g = Math.min(w, d) * 0.45;
    b.box(g, 0.005, g, 0, 0, 0, mat("#c3c7cb"));
    for (let i = 0; i < 9; i++) b.box(g, 0.006, 0.006, 0, 0, -g / 2 + (g * (i + 0.5)) / 9, mat("#aeb3b8"));
    for (const [x, z, rw, rd] of [[0, 1, w * 0.6, 0.05], [0, -1, w * 0.6, 0.05], [1, 0, 0.05, d * 0.6], [-1, 0, 0.05, d * 0.6]])
      b.box(rw, 0.006, rd, x * (w / 2 - 0.07), 0, z * (d / 2 - 0.07), mat("#3a3d41"));
    b.box(0.03, 0.006, 0.012, w / 2 - 0.05, 0, d / 2 - 0.03, ledMat());
  },
  ac_floor: (b, w, d, h, f) => {
    // a floor console: a low cabinet, an outlet on top, an intake below
    b.box(w, h, d, 0, 0, 0, f, 0.03);
    b.box(w - 0.08, 0.01, d * 0.5, 0, h - 0.002, 0, mat("#3a3d41"));
    for (let i = 0; i < 6; i++) b.box(w - 0.12, 0.006, 0.006, 0, 0.05 + i * 0.025, d / 2 + 0.002, mat("#aeb3b8"));
    b.box(0.04, 0.012, 0.004, w * 0.3, h * 0.75, d / 2 + 0.001, ledMat());
  },
  // ----- office, utility, garage -----
  filing_cabinet: (b, w, d, h, f) => {
    // four drawers with label holders and recessed pulls
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    const n = 4;
    const dh = (h - 0.04) / n;
    for (let i = 0; i < n; i++) {
      const y = 0.02 + i * dh;
      b.box(w - 0.02, dh - 0.012, 0.012, 0, y + 0.006, d / 2, f, 0.004);
      b.box(w * 0.4, 0.025, 0.006, 0, y + dh * 0.62, d / 2 + 0.008, mat(C.chrome, { metalness: 0.7, roughness: 0.3 }), 0.004);
      b.box(w * 0.18, 0.035, 0.003, 0, y + dh * 0.78, d / 2 + 0.007, mat("#f4f1ea"));
    }
  },
  whiteboard: (b, w, d, h, _f, _c, a) => {
    // an aluminium frame, the white board, a pen tray with markers
    b.box(w, h, d * 0.5, 0, 0, back(d) + d * 0.25, a, 0.006);
    b.box(w - 0.04, h - 0.04, 0.004, 0, 0.02, back(d) + d * 0.5 + 0.002, mat("#fbfbf8", { roughness: 0.2 }));
    b.box(w * 0.4, 0.02, 0.05, 0, -0.005, back(d) + d * 0.5 + 0.02, a, 0.004);
    ["#2b2c2e", "#c0392b", "#2e6fb5"].forEach((c, i) => b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8).rotateZ(Math.PI / 2), mat(c), -w * 0.1 + i * 0.05, 0.022, back(d) + d * 0.5 + 0.025));
    // a few lines and boxes drawn on it
    const ink = mat("#3a5f9f", { roughness: 1 });
    for (let i = 0; i < 4; i++) b.box(w * (0.25 + (i % 2) * 0.15), 0.006, 0.002, -w * 0.18 + (i % 2) * 0.05, h * (0.75 - i * 0.12), back(d) + d * 0.5 + 0.005, ink);
    b.box(w * 0.22, h * 0.3, 0.002, w * 0.25, h * 0.45, back(d) + d * 0.5 + 0.004, mat("#e8a53c", { roughness: 1 }));
  },
  vacuum_stick: (b, w, d, h, f, _c, a) => {
    // a cordless vacuum on its wall dock: floor head, wand, motor with dust bin, handle
    b.box(w * 0.6, 0.02, 0.04, 0, h * 0.72, back(d) + 0.02, mat(C.black), 0.006);
    b.box(w, 0.05, d * 0.45, 0, 0, d * 0.12, f, 0.02);
    b.box(w * 0.85, 0.012, 0.02, 0, 0.005, d * 0.12 + d * 0.22, a, 0.004);
    b.rod(v(0, 0.05, d * 0.05), v(0, h * 0.68, back(d) + 0.06), 0.014, mat(C.chrome, { metalness: 0.8, roughness: 0.25 }), 10);
    b.cyl(0.045, 0.045, 0.2, 0, h * 0.62, back(d) + 0.07, mat("#cfe3ea", { transparent: true, opacity: 0.6 }), 16);
    b.box(0.1, 0.16, 0.12, 0, h * 0.78, back(d) + 0.08, a, 0.03);
    b.box(0.04, 0.16, 0.04, 0, h * 0.85, back(d) + 0.16, f, 0.015);
  },
  step_ladder: (b, w, d, h, f, _c, a) => {
    // two aluminium frames meeting at the top, four treads, a platform
    const steel = f;
    const top = v(0, h, -d * 0.05);
    for (const sx of [-1, 1]) {
      b.rod(v(sx * w * 0.45, 0, d * 0.45), v(sx * w * 0.36, h, -d * 0.02), 0.016, steel, 8);
      b.rod(v(sx * w * 0.45, 0, -d * 0.45), v(sx * w * 0.36, h * 0.96, -d * 0.1), 0.014, steel, 8);
    }
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      b.box(w * (0.88 - t * 0.17), 0.025, 0.09, 0, h * t - 0.03, d * 0.45 - t * d * 0.47, steel, 0.004);
    }
    b.box(w * 0.74, 0.04, d * 0.22, top.x, h - 0.04, top.z, a, 0.008);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.05, 0.03, 0.05, sx * w * 0.45, 0, sz * d * 0.45, mat(C.black), 0.008);
  },
  tool_wall: (b, w, d, h, f) => {
    // a pegboard with hooks and tools: hammer, saw, screwdrivers, a spirit level, pliers
    b.box(w, h, 0.02, 0, 0, back(d) + 0.01, f);
    const holes = mat("#3a3530");
    for (let x = -w / 2 + 0.05; x < w / 2 - 0.02; x += 0.05) for (let y = 0.05; y < h - 0.02; y += 0.05) b.add(new THREE.CircleGeometry(0.004, 6), holes, x, y, back(d) + 0.0205);
    const z = back(d) + 0.035;
    const red = mat("#c0392b");
    const steel = mat(C.steel, { metalness: 0.7, roughness: 0.3 });
    const wood = mat(C.trunk);
    b.box(0.03, 0.3, 0.02, -w * 0.35, h * 0.45, z, wood, 0.006);
    b.box(0.12, 0.04, 0.03, -w * 0.35, h * 0.45 + 0.29, z, steel, 0.006);
    b.add(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.42, 0.04), new THREE.Vector2(0.42, 0.14), new THREE.Vector2(0, 0.12)])), steel, -w * 0.18, h * 0.55, z);
    b.box(0.1, 0.12, 0.03, -w * 0.21, h * 0.57, z, red, 0.02);
    for (let i = 0; i < 4; i++) {
      b.box(0.025, 0.1, 0.025, w * 0.18 + i * 0.05, h * 0.62, z, i % 2 ? red : mat("#f0c02b"), 0.008);
      b.box(0.006, 0.12, 0.006, w * 0.18 + i * 0.05, h * 0.5, z, steel);
    }
    b.box(0.6, 0.05, 0.03, w * 0.05, h * 0.18, z, mat("#f0c02b"), 0.006);
    b.box(0.08, 0.012, 0.012, w * 0.05, h * 0.18 + 0.02, z + 0.015, mat("#7bd1e8", { transparent: true, opacity: 0.8 }));
    for (const sx of [-1, 1]) b.rod(v(w * 0.4 + sx * 0.02, h * 0.62, z), v(w * 0.4 - sx * 0.03, h * 0.42, z), 0.007, red, 6);
  },
  motorcycle: (b, w, d, h, _f, color) => {
    // along z: two wheels, a frame from the steering head to the rear axle, the engine
    // under the tank, the seat, the fork and handlebar, lights
    const paint = mat(FINISHES[color] ?? FINISHES.red, { roughness: 0.35, metalness: 0.3 });
    const black = mat(C.black, { roughness: 0.6 });
    const steel = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
    const r = Math.min(0.33, h * 0.29);
    const front = d / 2 - r;
    const rear = -d / 2 + r;
    for (const z of [rear, front]) {
      b.add(new THREE.TorusGeometry(r * 0.8, r * 0.2, 10, 28).rotateY(Math.PI / 2), mat("#1a1a1a", { roughness: 0.9 }), 0, r, z);
      b.add(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.025, 20).rotateZ(Math.PI / 2), mat("#3a3d41", { metalness: 0.5 }), 0, r, z);
      b.add(new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.12, 12).rotateZ(Math.PI / 2), steel, 0, r, z);
    }
    const head = v(0, h * 0.8, front - d * 0.17);
    const seatBack = v(0, h * 0.62, rear + d * 0.12);
    // frame: head to the seat's back, head down to the engine, the swing arms to the rear axle
    b.rod(head, seatBack, 0.03, black, 8);
    b.rod(head, v(0, r * 0.75, -d * 0.02), 0.03, black, 8);
    for (const sx of [-1, 1]) b.rod(v(sx * 0.07, r * 0.85, -d * 0.12), v(sx * 0.07, r, rear), 0.02, black, 8);
    b.rod(seatBack, v(0, r * 1.05, rear + 0.05), 0.022, black, 8);
    // engine: block, cylinders, exhaust to the back
    b.box(0.26, 0.26, 0.42, 0, r * 0.45, -d * 0.04, mat("#55595f", { metalness: 0.5, roughness: 0.4 }), 0.04);
    for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 12).rotateZ((sx * Math.PI) / 3), mat("#7a7f86", { metalness: 0.6 }), sx * 0.13, r * 0.95, d * 0.02);
    b.rod(v(0.12, r * 0.55, d * 0.05), v(0.16, r * 0.75, rear - 0.05), 0.04, steel, 12);
    // tank, seat, rear cowl
    b.add(new THREE.SphereGeometry(0.2, 18, 12).scale(0.75, 0.55, 1.35), paint, 0, h * 0.7, front - d * 0.33);
    b.box(0.26, 0.08, d * 0.3, 0, h * 0.6, rear + d * 0.27, black, 0.035);
    b.box(0.22, 0.07, d * 0.16, 0, h * 0.6, rear + d * 0.07, paint, 0.03);
    // fork, handlebar, mirrors, headlight, tail light, front mudguard
    for (const sx of [-1, 1]) b.rod(v(sx * 0.06, r, front), v(sx * 0.06, h * 0.82, head.z + 0.03), 0.022, steel, 8);
    b.rod(v(-w * 0.43, h * 0.92, head.z - 0.04), v(w * 0.43, h * 0.92, head.z - 0.04), 0.014, black, 8);
    b.rod(v(0, h * 0.82, head.z + 0.03), v(0, h * 0.92, head.z - 0.04), 0.02, steel, 8);
    for (const sx of [-1, 1]) b.sphere(0.03, sx * w * 0.36, h * 0.99, head.z - 0.04, steel, 1.4, 1, 0.5, 8);
    b.sphere(0.08, 0, h * 0.74, head.z + 0.1, mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.3 }), 1, 1, 0.7, 14);
    b.box(0.1, 0.035, 0.03, 0, h * 0.58, rear - 0.02, mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.4 }), 0.01);
    b.add(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.12, 20, 1, true, -0.2, 1.4).rotateZ(Math.PI / 2), mat((paint as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 0.4 }), 0, r, front);
  },
  e_scooter: (b, w, d, h, f) => {
    // a deck on two small wheels, the stem and the handlebar
    const r = 0.1;
    for (const z of [-d / 2 + r, d / 2 - r]) {
      b.add(new THREE.TorusGeometry(r * 0.75, r * 0.25, 8, 20).rotateY(Math.PI / 2), mat("#1a1a1a", { roughness: 0.9 }), 0, r, z);
      b.add(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.05, 14).rotateZ(Math.PI / 2), mat(C.steel, { metalness: 0.6 }), 0, r, z);
    }
    b.box(0.16, 0.05, d - 2 * r - 0.05, 0, r * 0.7, 0, f, 0.02);
    b.box(0.13, 0.006, d - 2 * r - 0.15, 0, r * 0.7 + 0.05, 0, mat("#1d1d1d", { roughness: 1 }));
    b.rod(v(0, r, d / 2 - r), v(0, h - 0.04, d / 2 - r - 0.08), 0.022, f, 10);
    b.rod(v(-w * 0.45, h - 0.04, d / 2 - r - 0.08), v(w * 0.45, h - 0.04, d / 2 - r - 0.08), 0.014, mat(C.black), 8);
    b.box(0.07, 0.04, 0.04, 0, h - 0.07, d / 2 - r - 0.06, mat(C.black), 0.01);
    b.box(0.04, 0.012, 0.004, 0, h - 0.045, d / 2 - r - 0.035, ledMat("#3fa8ff"));
  },
  // ----- garden -----
  barrel_sauna: (b, w, d, h, f) => {
    // a barrel of staves on two cradles, steel bands, a glass front with a door
    const r = Math.min(w, h) / 2;
    const len = d - 0.1;
    const staves = 28;
    for (let i = 0; i < staves; i++) {
      const a = (i / staves) * Math.PI * 2;
      const stave = b.add(new THREE.BoxGeometry(r * 0.23, 0.05, len), mat(i % 2 ? FINISHES.oak : "#b98f62"), Math.cos(a) * r * 0.97, r + 0.08 + Math.sin(a) * r * 0.97, 0);
      stave.rotation.z = a + Math.PI / 2;
    }
    for (const z of [-len / 2 + 0.25, len / 2 - 0.25]) {
      b.add(new THREE.TorusGeometry(r + 0.01, 0.012, 6, 40), mat(C.black), 0, r + 0.08, z);
      b.box(w * 0.9, 0.14, 0.12, 0, 0, z, f, 0.01);
    }
    // the back wall and the glass front with its door and handle
    b.add(new THREE.CircleGeometry(r * 0.98, 40), f, 0, r + 0.08, -len / 2 - 0.001).rotation.y = Math.PI;
    b.add(new THREE.CircleGeometry(r * 0.98, 40), mat("#b7d6e6", { transparent: true, opacity: 0.45, roughness: 0.05, side: THREE.DoubleSide }), 0, r + 0.08, len / 2 - 0.02);
    b.box(0.6, Math.min(1.75, 2 * r * 0.85), 0.03, 0, r + 0.08 - Math.min(1.75, 2 * r * 0.85) / 2, len / 2 - 0.01, mat("#9cc0d2", { transparent: true, opacity: 0.5, roughness: 0.05 }));
    b.box(0.02, 0.25, 0.04, 0.26, r * 0.95, len / 2 + 0.02, mat(C.trunk), 0.008);
    b.cyl(0.05, 0.06, 0.4, r * 0.3, 2 * r + 0.1, -len * 0.3, mat(C.black), 12);
  },
  gazebo: (b, w, d, h, f, _c, a) => {
    // four posts, a hipped canopy in the accent, curtains tied at the posts
    const post = 0.08;
    const eaves = h * 0.78;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box(post, eaves, post, sx * (w / 2 - post), 0, sz * (d / 2 - post), f, 0.01);
      b.cyl(0.07, 0.04, eaves * 0.8, sx * (w / 2 - post - 0.06), 0.1, sz * (d / 2 - post - 0.06), mat((a as THREE.MeshStandardMaterial).color.getStyle(), { roughness: 1 }), 10);
    }
    for (const sz of [-1, 1]) b.box(w - 0.1, 0.1, 0.06, 0, eaves - 0.1, sz * (d / 2 - post), f, 0.01);
    for (const sx of [-1, 1]) b.box(0.06, 0.1, d - 0.1, sx * (w / 2 - post), eaves - 0.1, 0, f, 0.01);
    const roof = new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.1, h - eaves, 4, 1, true).rotateY(Math.PI / 4);
    roof.scale(w / Math.min(w, d), 1, d / Math.min(w, d));
    b.add(roof, mat((a as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, eaves + (h - eaves) / 2, 0);
    b.cyl(0.04, 0.06, 0.15, 0, h - 0.05, 0, f, 8);
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
  // ----- kids and living -----
  slide: (b, w, d, h, f, _c, a) => {
    // a ladder at the back, a platform, the slide down to the front with raised edges
    const frame = a;
    const top = h * 0.75;
    for (const sx of [-1, 1]) {
      b.rod(v(sx * w * 0.42, 0, -d / 2 + 0.05), v(sx * w * 0.42, h, -d / 2 + 0.25), 0.025, frame, 8);
      b.rod(v(sx * w * 0.42, 0, -d / 2 + 0.55), v(sx * w * 0.42, h, -d / 2 + 0.55), 0.025, frame, 8);
    }
    for (let i = 1; i < 5; i++) b.rod(v(-w * 0.42, (top * i) / 5, -d / 2 + 0.05 + (0.2 * i) / 5), v(w * 0.42, (top * i) / 5, -d / 2 + 0.05 + (0.2 * i) / 5), 0.018, frame, 8);
    b.box(w * 0.88, 0.04, 0.35, 0, top, -d / 2 + 0.4, frame, 0.01);
    const curve = new THREE.CubicBezierCurve3(v(0, top, -d / 2 + 0.6), v(0, top * 0.75, -d / 2 + 1.0), v(0, 0.25, d / 2 - 0.6), v(0, 0.2, d / 2 - 0.05));
    const n = 16;
    for (let i = 0; i < n; i++) {
      const p0 = curve.getPoint(i / n);
      const p1 = curve.getPoint((i + 1) / n);
      const seg = p0.distanceTo(p1);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const tilt = Math.atan2(p0.y - p1.y, p1.z - p0.z);
      b.add(new THREE.BoxGeometry(w * 0.8, 0.025, seg + 0.01), f, mid.x, mid.y, mid.z).rotation.x = tilt;
      for (const sx of [-1, 1]) b.add(new THREE.BoxGeometry(0.04, 0.12, seg + 0.01), f, mid.x + sx * w * 0.42, mid.y + 0.05, mid.z).rotation.x = tilt;
    }
  },
  play_kitchen: (b, w, d, h, f, _c, a) => {
    // a little kitchen: an oven door, a hob, a sink, a back panel with knobs and hooks
    const top = h * 0.55;
    b.box(w, top, d, 0, 0, 0, f, 0.01);
    b.box(w + 0.02, 0.03, d + 0.02, 0, top, 0, a, 0.006);
    b.box(w, h - top, 0.03, 0, top + 0.03, back(d) + 0.015, f, 0.01);
    b.box(w * 0.42, top * 0.7, 0.01, -w * 0.25, top * 0.12, d / 2, mat("#2f3a40", { roughness: 0.1 }), 0.01);
    for (const [x, z] of [[-0.12, 0.05], [-0.25, -0.05]]) b.add(new THREE.TorusGeometry(0.045, 0.008, 6, 20).rotateX(Math.PI / 2), mat(C.black), w * x * 2, top + 0.035, z);
    b.cyl(0.11, 0.09, 0.06, w * 0.25, top - 0.03, 0, mat(C.steel, { metalness: 0.7, side: THREE.DoubleSide }), 20, true);
    b.rod(v(w * 0.25, top + 0.03, back(d) + 0.04), v(w * 0.25, top + 0.15, back(d) + 0.04), 0.01, mat(C.chrome, { metalness: 0.8 }), 8);
    for (let i = 0; i < 3; i++) b.cyl(0.02, 0.02, 0.015, -w * 0.32 + i * 0.07, top + 0.12, back(d) + 0.035, mat(["#e74c3c", "#f1c40f", "#3498db"][i]), 12).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) b.box(0.04, 0.08, 0.02, -w * 0.1 + i * 0.08, h - 0.15, back(d) + 0.04, mat(["#e8a53c", "#c0392b", "#27ae60"][i]), 0.01);
  },
  record_player: (b, w, d, h, f) => {
    // a plinth, the platter with a record, the tone arm, two knobs
    b.box(w, h * 0.55, d, 0, 0, 0, f, 0.01);
    const r = Math.min(w, d) * 0.4;
    b.cyl(r, r, 0.015, -w * 0.08, h * 0.55, 0, mat(C.steel, { metalness: 0.6 }), 32);
    b.cyl(r * 0.96, r * 0.96, 0.004, -w * 0.08, h * 0.55 + 0.015, 0, mat("#141414", { roughness: 0.3 }), 32);
    b.cyl(r * 0.3, r * 0.3, 0.005, -w * 0.08, h * 0.55 + 0.016, 0, mat("#c0392b"), 20);
    b.cyl(0.02, 0.02, 0.04, w * 0.36, h * 0.55, -d * 0.3, mat(C.chrome, { metalness: 0.8 }), 12);
    b.rod(v(w * 0.36, h * 0.55 + 0.035, -d * 0.3), v(w * 0.05, h * 0.55 + 0.03, d * 0.15), 0.004, mat(C.chrome, { metalness: 0.8 }), 6);
    for (const x of [0.3, 0.4]) b.cyl(0.012, 0.012, 0.01, w * x, h * 0.55, d * 0.38, mat(C.chrome, { metalness: 0.8 }), 10);
  },
  game_console: (b, w, d, h, f) => {
    // a console with a vent line and a light, and a controller in front
    b.box(w, h, d * 0.75, 0, 0, back(d) + d * 0.375, f, 0.015);
    b.box(w * 0.92, 0.004, 0.003, 0, h * 0.6, back(d) + d * 0.75 + 0.001, mat(C.black));
    b.box(0.03, 0.004, 0.002, -w * 0.38, h * 0.3, back(d) + d * 0.75 + 0.001, ledMat("#3fa8ff"));
    const c = mat(C.black, { roughness: 0.5 });
    b.box(0.13, 0.025, 0.07, w * 0.05, 0, d / 2 - 0.05, c, 0.012);
    for (const sx of [-1, 1]) b.sphere(0.022, w * 0.05 + sx * 0.055, 0.012, d / 2 - 0.03, c, 1, 0.6, 1.2, 10);
  },
  // ----- smart home: small devices whose status light follows their entity -----
  smoke_detector: (b, w, d, h, f) => {
    // a ceiling disc: a ring of slits, a test button with its light
    const r = Math.min(w, d) / 2;
    b.cyl(r * 0.98, r, h * 0.7, 0, h * 0.3, 0, f, 32);
    b.cyl(r * 0.8, r * 0.9, h * 0.3, 0, 0, 0, f, 32);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      b.box(0.004, h * 0.18, 0.012, Math.cos(a) * r * 0.86, h * 0.07, Math.sin(a) * r * 0.86, mat("#9aa0a6"))!.rotation.y = -a;
    }
    b.cyl(r * 0.25, r * 0.25, 0.004, 0, -0.002, 0, mat("#e3e3df"), 20);
    b.cyl(0.004, 0.004, 0.003, r * 0.4, -0.003, 0, ledMat("#ff3b30"), 8);
  },
  leak_sensor: (b, w, d, h, f) => {
    // a puck on the floor with metal contacts underneath
    const r = Math.min(w, d) / 2;
    b.cyl(r * 0.9, r, h, 0, 0, 0, f, 28);
    for (const a of [0, 2.1, 4.2]) b.cyl(0.004, 0.004, 0.003, Math.cos(a) * r * 0.6, -0.001, Math.sin(a) * r * 0.6, mat(C.chrome, { metalness: 0.8 }), 8);
    b.cyl(0.004, 0.004, 0.002, 0, h, r * 0.5, ledMat("#3fa8ff"), 8);
  },
  motion_sensor: (b, w, d, h, f) => {
    // a corner-style block with a faceted lens
    b.box(w, h, d * 0.5, 0, 0, back(d) + d * 0.25, f, 0.01);
    b.sphere(Math.min(w, h) * 0.38, 0, h * 0.5, back(d) + d * 0.5, mat("#f3f2ee", { roughness: 0.3, transparent: true, opacity: 0.9 }), 1, 1, 0.9, 10);
    b.box(0.006, 0.006, 0.003, w * 0.3, h * 0.15, back(d) + d * 0.5 + 0.001, ledMat("#3fd27a"));
  },
  contact_sensor: (b, w, d, h, f) => {
    // the sensor on the frame and its magnet on the leaf
    b.box(w * 0.62, h, d, -w * 0.18, 0, 0, f, 0.004);
    b.box(w * 0.3, h * 0.8, d * 0.8, w * 0.33, h * 0.1, 0, f, 0.004);
    b.box(0.004, 0.004, 0.002, -w * 0.18, h * 0.8, d / 2 + 0.001, ledMat("#ff9a2a"));
  },
  thermostat: (b, w, d, h, f) => {
    // a square with a round dial and a small display
    b.box(w, h, d * 0.6, 0, 0, back(d) + d * 0.3, f, 0.01);
    b.add(new THREE.CylinderGeometry(w * 0.3, w * 0.32, d * 0.5, 32).rotateX(Math.PI / 2), mat(C.chrome, { metalness: 0.7, roughness: 0.3 }), 0, h / 2, back(d) + d * 0.85);
    b.add(new THREE.CircleGeometry(w * 0.24, 32), screenMat(), 0, h / 2, back(d) + d * 1.105);
    b.box(0.008, 0.004, 0.002, 0, h * 0.12, back(d) + d * 0.61, ledMat("#ff8a3a"));
  },
  climate_sensor: (b, w, d, h, f) => {
    // a small square with an e-ink face
    b.box(w, h, d, 0, 0, 0, f, 0.008);
    b.box(w * 0.75, h * 0.6, 0.002, 0, h * 0.25, d / 2 + 0.001, mat("#d7d9d3", { roughness: 1 }));
    b.box(w * 0.35, 0.006, 0.001, 0, h * 0.62, d / 2 + 0.002, mat("#333"));
    b.box(w * 0.2, 0.004, 0.001, 0, h * 0.45, d / 2 + 0.002, mat("#333"));
  },
  smart_plug: (b, w, d, h, f) => {
    // a plug on the socket, a button with its ring light
    b.box(w * 1.2, h * 1.2, 0.01, 0, -h * 0.1, back(d) + 0.005, mat(C.ceramic), 0.008);
    b.box(w, h, d - 0.01, 0, 0, back(d) + 0.01 + (d - 0.01) / 2, f, 0.012);
    b.cyl(w * 0.18, w * 0.18, 0.004, 0, h * 0.7, d / 2, f, 20).rotation.x = Math.PI / 2;
    b.add(new THREE.TorusGeometry(w * 0.2, 0.002, 4, 20), ledMat("#3fa8ff"), 0, h * 0.7, d / 2 + 0.002);
  },
  doorbell_camera: (b, w, d, h, f) => {
    // a slim upright: the lens at the top, the ring button below
    b.box(w, h, d, 0, 0, 0, f, 0.01);
    b.cyl(w * 0.22, w * 0.22, 0.004, 0, h * 0.78, d / 2, mat("#111", { roughness: 0.1 }), 20).rotation.x = Math.PI / 2;
    b.cyl(w * 0.3, w * 0.3, 0.004, 0, h * 0.28, d / 2, mat("#2b2c2e"), 24).rotation.x = Math.PI / 2;
    b.add(new THREE.TorusGeometry(w * 0.3, 0.003, 4, 24), ledMat("#3fa8ff"), 0, h * 0.28, d / 2 + 0.003);
  },
  security_camera: (b, w, d, h, f) => {
    // a wall bracket and a bullet camera looking down and out
    b.box(w * 0.7, h * 0.8, 0.012, 0, h * 0.1, back(d) + 0.006, f, 0.004);
    b.rod(v(0, h * 0.5, back(d) + 0.01), v(0, h * 0.62, back(d) + d * 0.35), 0.008, f, 8);
    // the body along its axis, tilted down; the lens at its front end
    const tilt = Math.PI / 2 + 0.35;
    const len = d * 0.7;
    const centre = v(0, h * 0.62, back(d) + d * 0.6);
    const axis = v(0, Math.cos(tilt), Math.sin(tilt));
    b.add(new THREE.CylinderGeometry(w * 0.42, w * 0.42, len, 20), f, centre.x, centre.y, centre.z).rotation.x = tilt;
    const front = centre.clone().addScaledVector(axis, len / 2 + 0.002);
    b.add(new THREE.CylinderGeometry(w * 0.3, w * 0.3, 0.004, 20), mat("#111", { roughness: 0.1 }), front.x, front.y, front.z).rotation.x = tilt;
    b.box(0.006, 0.006, 0.003, w * 0.25, h * 0.75, back(d) + d * 0.6, ledMat("#ff3b30"));
  },
  smart_hub: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.012);
    b.box(w * 0.5, 0.003, 0.004, 0, h * 0.45, d / 2, ledMat("#3fd27a"));
  },
  smart_speaker: (b, w, d, h, f) => {
    // a fabric cylinder with a light ring on top
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, h * 0.95, 0, 0, 0, f, 32);
    b.cyl(r * 0.96, r * 0.96, h * 0.05, 0, h * 0.95, 0, mat(C.black, { roughness: 0.4 }), 32);
    b.add(new THREE.TorusGeometry(r * 0.8, 0.004, 4, 32).rotateX(Math.PI / 2), ledMat("#3fa8ff"), 0, h + 0.001, 0);
  },
  keypad: (b, w, d, h, f) => {
    // an alarm keypad: twelve keys and a status light
    b.box(w, h, d, 0, 0, 0, f, 0.008);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) b.box(w * 0.2, h * 0.12, 0.004, (c - 1) * w * 0.26, h * (0.12 + r * 0.17), d / 2, mat("#d9dcdf"), 0.002);
    b.box(w * 0.5, 0.005, 0.002, 0, h * 0.88, d / 2 + 0.001, ledMat("#3fd27a"));
  },
  ac_outdoor: (b, w, d, h, f) => outdoorUnit(b, w, d, h, f, false),
  ac_outdoor_wall: (b, w, d, h, f) => outdoorUnit(b, w, d, h, f, true),
  fan_standing: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, d) * 0.45;
    b.cyl(r * 0.8, r * 0.85, 0.04, 0, 0, 0, a, 24);
    b.cyl(0.015, 0.015, h - r * 1.2, 0, 0.04, 0, a, 8);
    const y = h - r;
    b.box(0.12, 0.12, 0.16, 0, y - 0.06, -0.08, a, 0.04);
    for (let k = 1; k <= 3; k++) b.add(new THREE.TorusGeometry((r * k) / 3, 0.004, 4, 28), f, 0, y, 0.04);
    for (let k = 0; k < 8; k++) b.box(0.004, r * 2, 0.004, 0, y - r, 0.04, f)?.rotation.set(0, 0, (k / 8) * Math.PI);
    b.spinner(0, y, 0.02, "z", () => {
      for (let k = 0; k < 3; k++) {
        const blade = b.add(new THREE.CircleGeometry(r * 0.75, 12, 0, 0.9), mat("#cfe3ea", { transparent: true, opacity: 0.7, side: THREE.DoubleSide }), 0, y, 0.02);
        blade.rotation.z = (k / 3) * Math.PI * 2;
      }
    });
  },
  air_purifier: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, h - 0.03, 0, 0, 0, f, 32);
    b.cyl(r * 0.9, r * 0.9, 0.03, 0, h - 0.03, 0, mat("#2b2c2e"), 32);
    for (let k = 1; k < 4; k++) b.add(new THREE.RingGeometry(r * 0.2 * k, r * 0.2 * k + 0.006, 32), mat("#5a5d61"), 0, h + 0.001, 0).rotation.x = -Math.PI / 2;
    b.box(0.05, 0.02, 0.004, 0, h * 0.8, r + 0.001, ledMat("#3f8fe0"));
  },
  dehumidifier: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.03);
    for (let i = 0; i < 8; i++) b.box(w * 0.7, 0.008, 0.01, 0, h * 0.55 + i * 0.025, d / 2, mat("#9aa0a6"));
    b.box(w * 0.8, h * 0.3, 0.01, 0, 0.04, d / 2, mat("#d9dcdf"), 0.01);
    b.box(0.05, 0.02, 0.004, 0, h * 0.92, d / 2 + 0.001, ledMat("#3f8fe0"));
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
  fruit_bowl: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.add(new THREE.LatheGeometry([[0.001, 0], [r * 0.4, 0], [r, h * 0.55], [r * 0.95, h * 0.55], [r * 0.38, h * 0.08], [0.001, h * 0.08]].map(([x, y]) => new THREE.Vector2(x, y)), 28), f);
    const rand = random(379);
    const fruit: [string, number][] = [["#d23a2a", 0.04], ["#f2a53a", 0.04], ["#9cc04a", 0.038], ["#e8d24a", 0.035], ["#d23a2a", 0.04], ["#f2a53a", 0.042]];
    fruit.forEach(([c, fr], i) => {
      const a = (i / fruit.length) * Math.PI * 2 + rand() * 0.3;
      b.sphere(fr, Math.cos(a) * r * 0.45, h * 0.35 + (i % 2) * 0.04, Math.sin(a) * r * 0.45, mat(c, { roughness: 0.5 }), 1, 0.95, 1, 12);
    });
    b.add(new THREE.CapsuleGeometry(0.018, 0.14, 4, 8).rotateZ(1.2), mat("#f2d14b"), 0, h * 0.6, 0);
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
  bowl_decor: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.add(new THREE.LatheGeometry([[0.001, 0], [r * 0.35, 0], [r, h * 0.85], [r * 0.97, h], [r * 0.9, h * 0.85], [r * 0.32, h * 0.1], [0.001, h * 0.1]].map(([x, y]) => new THREE.Vector2(x, y)), 32), f);
  },
  globe: (b, w, d, h, _f, _c, a) => {
    const r = Math.min(w, d, h * 0.7) / 2;
    b.cyl(r * 0.5, r * 0.6, 0.03, 0, 0, 0, a, 20);
    b.cyl(0.012, 0.012, h - 2 * r - 0.05, 0, 0.03, 0, a, 8);
    const y = h - r - 0.02;
    const g = b.sphere(r, 0, y, 0, mat("#4d7fa8", { roughness: 0.6 }), 1, 1, 1, 24);
    g.rotation.z = 0.4;
    const rand = random(383);
    for (let i = 0; i < 9; i++) {
      const u = rand() * Math.PI * 2;
      const t = Math.acos(2 * rand() - 1);
      const p = v(Math.sin(t) * Math.cos(u), Math.cos(t), Math.sin(t) * Math.sin(u)).multiplyScalar(r * 1.002);
      const land = b.add(new THREE.CircleGeometry(r * (0.15 + rand() * 0.2), 7), mat("#c9b27e"), p.x, y + p.y, p.z);
      land.lookAt(land.position.clone().multiplyScalar(2).sub(v(0, y, 0)));
    }
    const ring = b.add(new THREE.TorusGeometry(r * 1.08, 0.006, 6, 32, Math.PI), a, 0, y, 0);
    ring.rotation.set(0, Math.PI / 2, 0.4);
  },
  magazine_rack: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) b.box(0.02, h, d, sx * (w / 2 - 0.01), 0, 0, f);
    b.box(w, 0.02, d, 0, 0.04, 0, f);
    for (let i = 0; i < 5; i++) b.box(w - 0.06, h * (0.75 + (i % 3) * 0.05), 0.01, 0, 0.06, -d / 2 + 0.05 + i * (d - 0.1) / 4, mat(C.book[i % C.book.length]))?.rotation.set(0.05 * (i - 2), 0, 0);
  },
  terrarium: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r * 0.9, r * 0.9, 0.04, 0, 0, 0, mat(C.soil), 20);
    b.sphere(r, 0, h * 0.5, 0, glass(), 1, h / (2 * r), 1, 24);
    rosette(b, -r * 0.3, 0.05, 0, 0.04, "#8fb39a", random(389));
    b.cyl(0.02, 0.02, 0.1, r * 0.3, 0.04, 0.02, mat("#4f7a45"), 8);
    b.cyl(0.02, 0.02, 0.01, 0, h - 0.01, 0, f, 12);
  },
  photo_frames: (b, w, d, h, f, c) => {
    // three framed photos standing on a shelf or sideboard
    const sizes: [number, number, number][] = [[-w * 0.3, 0.13, h], [0, 0.1, h * 0.75], [w * 0.3, 0.16, h * 0.85]];
    sizes.forEach(([x, fw, fh], i) => {
      b.box(fw, fh, 0.015, x, 0, 0, f, 0.003);
      b.box(fw - 0.02, fh - 0.02, 0.002, x, 0.01, 0.008, mat("#f4f1ea"));
      const pic = new Builder();
      art(pic, fw - 0.04, fh - 0.04, 0.02, 0.0095, ["blue", "terracotta", "green"][(i + c.length) % 3]);
      const g = pic.done();
      g.position.x = x;
      b.g.add(g);
    });
    void d;
  },
  stand_mixer: (b, w, d, h, f) => {
    b.box(w * 0.5, 0.06, d, 0, 0, 0, f, 0.02);
    b.box(w * 0.32, h * 0.6, w * 0.32, 0, 0.06, -d / 2 + w * 0.2, f, 0.05);
    b.add(new THREE.CapsuleGeometry(w * 0.16, d * 0.55, 6, 16).rotateX(Math.PI / 2), f, 0, h - w * 0.17, d * 0.05);
    b.add(new THREE.LatheGeometry([[0.001, 0], [w * 0.15, 0], [w * 0.22, h * 0.3], [w * 0.21, h * 0.32], [w * 0.14, 0.01]].map(([x, y]) => new THREE.Vector2(x, y)), 24), mat(C.chrome, { metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide }), 0, 0.06, d * 0.15);
  },
  knife_block: (b, w, d, h, f) => {
    const block = b.box(w, h * 0.7, d, 0, 0, 0, f, 0.01);
    block?.rotation.set(-0.25, 0, 0);
    for (let i = 0; i < 4; i++) b.box(0.012, h * 0.3, 0.02, -w * 0.3 + i * w * 0.2, h * 0.68, -0.02, mat("#1c1c1c"), 0.004)?.rotation.set(-0.25, 0, 0);
  },
  bread_bin: (b, w, d, h, f) => {
    b.box(w, h * 0.5, d, 0, 0, 0, f, 0.02);
    b.add(new THREE.CylinderGeometry(h * 0.5, h * 0.5, w, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, d / h), f, 0, h * 0.5, 0);
    b.box(0.08, 0.015, 0.02, 0, h * 0.62, d / 2 + 0.01, mat(C.black), 0.006);
  },
  pots_pans: (b, w, d, h, f) => {
    // a pot and a pan for the hob
    b.cyl(0.11, 0.1, h * 0.8, -w * 0.2, 0, -d * 0.1, f, 24);
    b.cyl(0.115, 0.115, 0.02, -w * 0.2, h * 0.8, -d * 0.1, f, 24);
    b.sphere(0.02, -w * 0.2, h * 0.82 + 0.02, -d * 0.1, mat(C.black), 1, 0.6, 1, 8);
    b.cyl(0.13, 0.12, 0.05, w * 0.18, 0, d * 0.12, mat("#2b2b2b"), 24);
    b.rod(v(w * 0.18 + 0.12, 0.04, d * 0.12), v(w / 2, 0.06, d * 0.12), 0.012, mat(C.black), 6);
  },
  dish_rack: (b, w, d, h, f) => {
    const steel = mat(C.chrome, { metalness: 0.6, roughness: 0.3 });
    b.box(w, 0.015, d, 0, 0, 0, f, 0.006);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.02), 0.015, sz * (d / 2 - 0.02)), v(sx * (w / 2 - 0.02), h * 0.5, sz * (d / 2 - 0.02)), 0.004, steel, 4);
    for (let i = 0; i < 6; i++) b.add(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 20).rotateX(Math.PI / 2 - 0.15), mat(C.ceramic), -w * 0.3 + i * 0.045, 0.12, 0);
    for (let i = 0; i < 3; i++) b.cyl(0.035, 0.03, 0.1, w * 0.3, 0.015, -d * 0.25 + i * 0.08, glass(), 12);
  },
  // ----- outside, more -----
  carport: (b, w, d, h, f, _c, a) => {
    // four posts, beams, a flat roof sloping a little to the back
    const post = 0.12;
    for (const sx of [-1, 1]) for (const z of [-d / 2 + 0.2, 0, d / 2 - 0.2]) b.box(post, h - 0.2, post, sx * (w / 2 - post / 2), 0, z, f);
    for (const sx of [-1, 1]) b.box(post, 0.2, d, sx * (w / 2 - post / 2), h - 0.25, 0, f);
    for (let i = 0; i < Math.round(d / 0.6); i++) b.box(w, 0.12, 0.06, 0, h - 0.18, -d / 2 + 0.1 + (i * (d - 0.2)) / (Math.round(d / 0.6) - 1), f);
    b.box(w + 0.2, 0.05, d + 0.2, 0, h - 0.05, 0, a, 0.006);
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
  pizza_oven: (b, w, d, h, f) => {
    // a domed oven on a stand, a flue, an arched mouth
    const base = h * 0.55;
    b.box(w, base, d, 0, 0, 0, f, 0.01);
    b.box(w + 0.04, 0.06, d + 0.04, 0, base, 0, mat("#3b3b3d"), 0.006);
    const r = Math.min(w, d) * 0.45;
    b.add(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat("#b5683f", { roughness: 1 }), 0, base + 0.06, 0).scale.y = (h - base - 0.06) / r * 0.75;
    b.cyl(0.05, 0.05, h * 0.25, -r * 0.3, base + (h - base) * 0.6, -r * 0.3, mat(C.black), 12);
    const mouth = new THREE.Shape();
    mouth.moveTo(-0.15, 0);
    mouth.lineTo(0.15, 0);
    mouth.absarc(0, 0, 0.15, 0, Math.PI, false);
    b.add(new THREE.ShapeGeometry(mouth, 10), mat("#1a1210"), 0, base + 0.06, r * 0.98);
    b.add(new THREE.CircleGeometry(0.06, 10), mat("#ff8a3a", { emissive: "#ff5a1a", emissiveIntensity: 0.8 }), 0, base + 0.1, r * 0.95);
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
  parasol_cantilever: (b, w, d, h, f, _c, a) => {
    // a hanging parasol: the pole at one side, the arm over the middle
    const base = 0.8;
    b.box(base, 0.1, base, -w / 2 + base / 2, 0, 0, mat("#5a5d61"), 0.02);
    b.cyl(0.04, 0.04, h - 0.1, -w / 2 + base / 2, 0.1, 0, a, 12);
    b.rod(v(-w / 2 + base / 2, h - 0.1, 0), v(0, h - 0.25, 0), 0.03, a, 8);
    const r = Math.min(w, d) / 2;
    b.add(new THREE.ConeGeometry(r, 0.35, 8, 1, true), mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, h - 0.45, 0);
    b.rod(v(0, h - 0.25, 0), v(0, h - 0.65, 0), 0.015, a, 6);
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
  // ----- vehicles -----
  car_hatchback: (b, w, d, h, _f, color) => car(b, w, d, h, color, "hatchback"),
  car_estate: (b, w, d, h, _f, color) => car(b, w, d, h, color, "estate"),
  car_suv: (b, w, d, h, _f, color) => car(b, w, d, h, color, "suv"),
  car_van: (b, w, d, h, _f, color) => car(b, w, d, h, color, "van"),
  bicycle: (b, w, d, h, f) => {
    // along z, front wheel at +z
    const r = Math.min(0.34, h * 0.33);
    const zr = -d / 2 + r + 0.02;
    const zf = d / 2 - r - 0.02;
    for (const z of [zr, zf]) {
      b.add(new THREE.TorusGeometry(r, 0.02, 6, 28), mat(C.black), 0, r, z).rotation.y = Math.PI / 2;
      b.add(new THREE.TorusGeometry(r * 0.88, 0.006, 3, 28), mat(C.steel), 0, r, z).rotation.y = Math.PI / 2;
      b.cyl(0.03, 0.03, 0.08, 0, r - 0.04, z, mat(C.steel), 8);
    }
    const crank = v(0, r * 0.95, (zr + zf) / 2 - 0.05);
    const seat = v(0, h * 0.8, zr + r * 0.45);
    const head = v(0, h * 0.82, zf - r * 0.45);
    for (const [a, c] of [[v(0, r, zr), crank], [v(0, r, zr), seat.clone().setY(seat.y - 0.08)], [crank, seat.clone().setY(seat.y - 0.05)], [crank, head.clone().setY(head.y - 0.12)], [seat.clone().setY(seat.y - 0.08), head], [head, v(0, r, zf)]] as const) b.rod(a, c, 0.018, f, 6);
    b.box(0.14, 0.04, 0.24, 0, seat.y, seat.z - 0.02, mat(C.black), 0.015);
    b.rod(v(-w / 2 + 0.05, h - 0.02, head.z - 0.05), v(w / 2 - 0.05, h - 0.02, head.z - 0.05), 0.012, mat(C.black), 6);
    b.rod(head, v(0, h - 0.02, head.z - 0.05), 0.015, f, 6);
    b.add(new THREE.TorusGeometry(0.09, 0.008, 4, 16), mat(C.steel), 0, crank.y, crank.z).rotation.y = Math.PI / 2;
  },
  bike_rack: (b, w, d, h, f) => {
    const n = Math.max(1, Math.round(w / 0.4));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const pts = [v(x, 0, -d * 0.3), v(x, h - 0.15, -d * 0.3), v(x, h, -d * 0.1), v(x, h, d * 0.1), v(x, h - 0.15, d * 0.3), v(x, 0, d * 0.3)];
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.02, 6), f);
    }
    b.box(w, 0.03, 0.06, 0, 0.1, -d * 0.3, f);
    b.box(w, 0.03, 0.06, 0, 0.1, d * 0.3, f);
  },
  wallbox: (b, w, d, h, f) => {
    b.box(w, h, d * 0.7, 0, 0, -d * 0.15, f, 0.03);
    b.box(w * 0.5, h * 0.18, 0.005, 0, h * 0.62, d * 0.2, mat(C.screen));
    b.box(w * 0.3, 0.01, 0.006, 0, h * 0.82, d * 0.2, ledMat());
    b.add(new THREE.TorusGeometry(w * 0.32, 0.012, 6, 20), mat(C.black), 0, h * 0.3, d * 0.3).rotation.y = 0;
    b.box(0.05, 0.1, 0.06, 0, h * 0.05, d * 0.25, mat(C.black), 0.01);
  },
};


/**
 * An outdoor unit (heat pump or air conditioner): a box with a round fan grille, on feet or
 * on a wall bracket; the fan turns while its linked climate entity runs.
 */
function outdoorUnit(b: Builder, w: number, d: number, h: number, f: THREE.Material, bracket: boolean) {
  if (bracket) {
    // two steel arms from the wall under the unit
    for (const sx of [-1, 1]) {
      b.box(0.04, 0.04, d, sx * (w / 2 - 0.12), 0, 0, mat(C.steel));
      b.box(0.04, h * 0.6, 0.04, sx * (w / 2 - 0.12), 0, back(d) + 0.02, mat(C.steel));
    }
    d -= 0.08;
  }
  const z0 = bracket ? 0.04 : 0;
  b.box(w, h - 0.1, d - 0.05, 0, 0.1, z0 - 0.025, f, 0.015);
  if (!bracket) for (const sx of [-1, 1]) b.box(0.08, 0.1, d, sx * (w / 2 - 0.15), 0, 0, mat(C.black));
  else for (const sx of [-1, 1]) b.box(0.06, 0.1, d - 0.05, sx * (w / 2 - 0.12), 0.0, z0 - 0.025, mat(C.black));
  const r = Math.min(w * 0.3, (h - 0.1) * 0.4);
  const cx = -w * 0.12;
  const cy = 0.1 + (h - 0.1) / 2;
  const z = z0 + d / 2;
  b.add(new THREE.CircleGeometry(r, 32), mat(C.black), cx, cy, z - 0.045);
  for (let k = 1; k <= 4; k++) b.add(new THREE.TorusGeometry((r * k) / 4, 0.004, 3, 32), mat(C.steel), cx, cy, z - 0.04);
  // the fan behind the grille: three dark blades that turn while it runs
  b.spinner(cx, cy, z - 0.042, "z", () => {
    for (let i = 0; i < 3; i++) b.add(new THREE.CircleGeometry(r * 0.92, 10, 0, 0.75), mat("#3a3d41", { side: THREE.DoubleSide }), cx, cy, z - 0.042).rotation.z = (i / 3) * Math.PI * 2;
  });
  for (let i = 0; i < 2; i++) b.box(0.006, r * 2, 0.006, cx, cy - r, z - 0.04, mat(C.steel))!.rotation.z = (i * Math.PI) / 2;
  b.box(w * 0.18, 0.06, 0.01, w * 0.32, h * 0.8, z - 0.045, mat(C.steel));
  b.box(0.03, 0.012, 0.004, w * 0.32, h * 0.7, z - 0.044, ledMat());
}

/** A row of books standing between x0 and x1 on a shelf at y. */
function books(b: Builder, rand: () => number, x0: number, x1: number, y: number, maxH: number, depth: number, z: number) {
  let x = x0;
  while (x < x1) {
    const bw = 0.02 + rand() * 0.03;
    const bh = Math.max(0.05, Math.min(maxH, 0.17 + rand() * 0.12));
    b.batch(new THREE.BoxGeometry(bw, bh, depth), mat(C.book[Math.floor(rand() * C.book.length)]), matrix(x + bw / 2, y + bh / 2, z));
    x += bw + 0.002;
  }
}

/** A gable roof on walls of w × d at height y, the ridge along x. */
function gableRoof(b: Builder, w: number, d: number, y: number, rise: number, m: THREE.Material) {
  const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rise)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(-w / 2, y, 0);
  b.add(geo, m);
}

/**
 * A car along z (front at +z), from a side profile: the body up to the window line in
 * the paint, the cabin in dark glass under a painted roof, wheels, lights.
 */
const CAR_PROFILES: Record<string, { body: [number, number][]; cabin: [number, number][] }> = {
  hatchback: { body: [[0, 0.17], [0, 0.58], [0.04, 0.62], [0.72, 0.62], [0.95, 0.52], [1, 0.42], [1, 0.17]], cabin: [[0.03, 0.62], [0.08, 0.97], [0.5, 1], [0.73, 0.62]] },
  estate: { body: [[0, 0.17], [0, 0.56], [0.03, 0.6], [0.75, 0.6], [0.96, 0.5], [1, 0.4], [1, 0.17]], cabin: [[0.02, 0.6], [0.04, 0.95], [0.6, 0.98], [0.77, 0.6]] },
  suv: { body: [[0, 0.17], [0, 0.6], [0.03, 0.64], [0.76, 0.64], [0.96, 0.57], [1, 0.47], [1, 0.17]], cabin: [[0.02, 0.64], [0.04, 0.97], [0.64, 0.99], [0.78, 0.64]] },
  sports: { body: [[0, 0.16], [0, 0.5], [0.05, 0.56], [0.62, 0.56], [0.9, 0.45], [1, 0.36], [1, 0.16]], cabin: [[0.12, 0.56], [0.3, 0.92], [0.52, 0.95], [0.7, 0.56]] },
  van: { body: [[0, 0.14], [0, 0.97], [0.03, 1], [0.8, 1], [0.86, 0.62], [1, 0.5], [1, 0.4], [1, 0.14]], cabin: [[0.79, 0.95], [0.85, 0.62], [0.95, 0.6], [0.83, 0.97]] },
};
function car(b: Builder, w: number, d: number, h: number, color: string, style: string) {
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
function hollow(b: Builder, w: number, h: number, d: number, x: number, z: number, m: THREE.Material, t: number) {
  b.box(w, h, t, x, 0, z - d / 2 + t / 2, m);
  for (const sx of [-1, 1]) b.box(t, h, d, x + sx * (w / 2 - t / 2), 0, z, m);
  b.box(w, t, d, x, 0, z, m);
  b.box(w, t, d, x, h - t, z, m);
}

/** A kitchen base unit: plinth, carcass and worktop; where its fronts go. */
function kitchenBase(b: Builder, w: number, d: number, h: number, top: THREE.Material) {
  const t = 0.04;
  b.box(w - 0.02, 0.1, d - 0.08, 0, 0, back(d) + (d - 0.08) / 2, mat(C.black));
  b.box(w, h - t - 0.1, d - 0.03, 0, 0.1, back(d) + (d - 0.03) / 2, mat("#e8e6e1"));
  b.box(w, t, d, 0, h - t, 0, top, 0.004);
  return { y0: 0.1, y1: h - t, fz: d / 2 - 0.03 };
}

/** An appliance front: an oven (glass door, handle, controls) or a microwave. */
function applianceFront(b: Builder, w: number, y: number, h: number, z: number, kind: "oven" | "microwave", knobs = false) {
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
function oven(b: Builder, w: number, u: { y0: number; y1: number; fz: number }, f: THREE.Material, knobs = false) {
  const oh = Math.min(0.6, u.y1 - u.y0 - 0.12);
  applianceFront(b, w, u.y1 - oh - 0.01, oh, u.fz, "oven", knobs);
  fronts(b, -w / 2, w, u.y0, u.y1 - oh - 0.01 - u.y0, u.fz, 1, f, 1, "bar");
}

/** A tall unit with doors stacked by the given shares of its height. */
function tallUnit(b: Builder, w: number, d: number, h: number, f: THREE.Material, shares: number[]) {
  b.box(w - 0.02, 0.1, d - 0.08, 0, 0, back(d) + (d - 0.08) / 2, mat(C.black));
  b.box(w, h - 0.1, d - 0.03, 0, 0.1, back(d) + (d - 0.03) / 2, mat("#e8e6e1"));
  let y = 0.1;
  for (const s of shares) {
    const dh = (h - 0.1) * s;
    fronts(b, -w / 2, w, y, dh, d / 2 - 0.03, Math.max(1, Math.round(w / 0.6)), f, 1, "bar");
    y += dh;
  }
}

/** A tall kitchen tap, curving over the sink. */
function tapGooseneck(b: Builder, x: number, y: number, z: number, m: THREE.Material) {
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
function roundedRect(w: number, d: number, r: number): THREE.Shape {
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
function flat(b: Builder, w: number, d: number, y: number, z: number, m: THREE.Material, square: boolean, thick = 0) {
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

/** A ceramic toilet: the bowl, a closed seat and lid; standing ones get a cistern. */
function toiletBowl(b: Builder, w: number, d: number, zBack: number, f: THREE.Material, hinge: THREE.Material, style: BowlStyle = {}) {
  const front = bowlShape(b, w, d, zBack, f, style);
  const seatM = mat(C.ceramic, { roughness: 0.35 });
  flat(b, w * 1.02, front.L * 1.02, 0.4, front.z, seatM, !!style.square, 0.022);
  if (style.square) flat(b, w * 0.98, front.L * 0.98, 0.422, front.z, seatM, true, 0.02);
  else {
    const lid = new THREE.SphereGeometry(0.5, 32, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    lid.scale(w, 0.05, front.L * 0.98);
    b.add(lid, seatM, 0, 0.42, front.z);
  }
  for (const sx of [-1, 1]) b.box(0.03, 0.025, 0.04, sx * w * 0.25, 0.41, front.z0 + 0.02, hinge, 0.008);
}

/**
 * The bowl: narrow at its foot, wide at the seat (oval or squared); hung ones are joined to
 * the wall, standing ones reach the floor and have a cistern behind.
 */
function bowlShape(b: Builder, w: number, d: number, zBack: number, f: THREE.Material, style: BowlStyle = {}) {
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
function bidet(b: Builder, w: number, d: number, f: THREE.Material, tap: THREE.Material, style: BowlStyle) {
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
function basin(b: Builder, w: number, d: number, h: number, f: THREE.Material, depth: number, square = false) {
  b.box(w, depth, d, 0, h - depth, 0, f, square ? 0.012 : Math.min(depth / 2 - 0.01, 0.06));
  flat(b, w - 0.12, d - 0.16, h + 0.002, 0.03, mat("#dcdcd8", { roughness: 0.3 }), square);
  b.cyl(0.02, 0.02, 0.003, 0, h + 0.003, 0.03, mat(C.steel), 12);
}

/** A bowl standing on a top at y. */
function vessel(b: Builder, w: number, d: number, y: number, f: THREE.Material) {
  const profile = [[0.001, 0], [0.26, 0], [0.42, 0.3], [0.5, 1], [0.47, 1], [0.39, 0.35], [0.23, 0.09], [0.001, 0.09]].map(([r, yy]) => new THREE.Vector2(r, yy));
  const geo = new THREE.LatheGeometry(profile, 36);
  geo.scale(w, 0.14, d);
  b.add(geo, f, 0, y, 0.02);
}

/** A basin mixer: a column, its spout and lever. */
function tapBasin(b: Builder, x: number, y: number, z: number, m: THREE.Material, h = 0.16) {
  b.cyl(0.018, 0.02, h, x, y, z, m, 14);
  b.rod(v(x, y + h - 0.012, z), v(x, y + h - 0.025, z + 0.13), 0.011, m, 8);
  b.rod(v(x, y + h + 0.005, z - 0.005), v(x, y + h + 0.02, z - 0.07), 0.006, m, 6);
}

/** The flush plate in the wall with its two buttons. */
function flushPlate(b: Builder, x: number, y: number, z: number, m: THREE.Material) {
  b.box(0.24, 0.16, 0.012, x, y, z + 0.006, m, 0.004);
  b.box(0.1, 0.12, 0.006, x - 0.055, y + 0.02, z + 0.014, m, 0.004);
  b.box(0.1, 0.12, 0.006, x + 0.055, y + 0.02, z + 0.014, m, 0.004);
}

/** Overhead rain shower on an arm, a mixer, and optionally a hand shower on a rail. */
function showerSet(b: Builder, x: number, h: number, z: number, m: THREE.Material, hand: boolean) {
  b.rod(v(x, h - 0.1, z), v(x, h - 0.1, z + 0.3), 0.01, m, 8);
  b.cyl(0.13, 0.13, 0.012, x, h - 0.12, z + 0.3, m, 32);
  b.cyl(0.035, 0.035, 0.05, x, 1.05, z + 0.02, m, 14).rotation.x = Math.PI / 2;
  if (hand) {
    b.rod(v(x + 0.25, 0.9, z + 0.025), v(x + 0.25, 1.7, z + 0.025), 0.01, m, 8);
    b.cyl(0.03, 0.022, 0.2, x + 0.25, 1.35, z + 0.05, m, 12);
  }
}

/** A walk-in shower: flush tiled floor, linear drain, one glass panel, its brace. */
function walkIn(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, large: boolean) {
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

/** A freestanding tub turned on a lathe: the shell in the finish, white inside. */
function tubLathe(b: Builder, w: number, d: number, h: number, f: THREE.Material, _r: number) {
  const outer = [[0.001, 0], [0.36, 0], [0.45, 0.3], [0.5, 1], [0.475, 1.0]].map(([r, y]) => new THREE.Vector2(r, y));
  const inner = [[0.475, 1.0], [0.43, 0.4], [0.35, 0.14], [0.001, 0.12]].map(([r, y]) => new THREE.Vector2(r, y));
  const o = new THREE.LatheGeometry(outer, 40);
  o.scale(w, h, d);
  b.add(o, f);
  const i = new THREE.LatheGeometry(inner, 40);
  i.scale(w, h, d);
  b.add(i, mat(C.ceramic, { roughness: 0.3, side: THREE.DoubleSide }));
}

/** A floor-standing bath mixer at the tub's end. */
function floorTap(b: Builder, x: number, h: number, z: number, m: THREE.Material) {
  b.cyl(0.05, 0.05, 0.01, x, 0, z, m, 16);
  b.cyl(0.018, 0.018, h + 0.32, x, 0, z, m, 12);
  const curve = new THREE.CatmullRomCurve3([v(x, h + 0.3, z), v(x, h + 0.38, z), v(x - 0.1, h + 0.37, z), v(x - 0.18, h + 0.3, z)]);
  b.add(new THREE.TubeGeometry(curve, 12, 0.012, 8), m);
  b.cyl(0.025, 0.02, 0.18, x + 0.03, h + 0.05, z, m, 10);
}

/** Small square tiles with grout, for showers and tub aprons. */
let tiles: THREE.MeshStandardMaterial | undefined;
function tileMaterial(): THREE.MeshStandardMaterial {
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

/** A ceiling canopy and the cord down to a shade whose top is at y. */
function canopyAndCord(b: Builder, h: number, y: number, m: THREE.Material) {
  b.cyl(0.05, 0.05, 0.025, 0, h - 0.025, 0, m, 20);
  b.rod(v(0, y, 0), v(0, h - 0.02, 0), 0.003, m, 4);
}

/** A glowing bulb. */
function bulb(b: Builder, x: number, y: number, z: number, r: number) {
  b.sphere(r, x, y, z, glowMat(), 1, 1.15, 1, 14);
}
const glowMat = () => glowing(mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.8, side: THREE.DoubleSide }));
/** Opal glass: lit from within. */
const opal = () => glowing(mat("#e6e1d6", { emissive: "#fff1d6", emissiveIntensity: 0.12, roughness: 0.5, side: THREE.DoubleSide }));

/** Woven rattan or wicker, see-through-ish and double-sided. */
const wicker = new Map<string, THREE.MeshStandardMaterial>();
function wickerMat(color: string): THREE.MeshStandardMaterial {
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
function laundry(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, kind: "washer" | "dryer") {
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
function stem(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r: number, color: string) {
  const len = a.distanceTo(c);
  b.batch(new THREE.CylinderGeometry(r * 0.8, r, len, 5), mat(color), new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), c.clone().sub(a).normalize()), v(1, 1, 1)));
}

/** A palm in a pot: arching fronds with leaflets on both sides. */
function palm(b: Builder, w: number, d: number, h: number, f: THREE.Material, seed: number, o: { fronds: number; leaflets: number; droop: number; color: string[]; width: number }) {
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
function ribs(geo: THREE.BufferGeometry, n: number, depth: number) {
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
function ribbed(b: Builder, r: number, len: number, x: number, y: number, z: number) {
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 6, 20);
  ribs(geo, 10, 0.08);
  b.add(geo, mat("#4f7a45", { roughness: 0.9 }), x, y + len / 2, z);
}

/** A succulent rosette: rings of fat pointed leaves. */
function rosette(b: Builder, x: number, y: number, z: number, r: number, color: string, rand: () => number) {
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
function cupboard(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, o: { doors?: number; drawers?: number; columns?: number; mirror?: number[]; top?: boolean; legs?: boolean }) {
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
function fire(b: Builder, w: number, y: number, z: number, h: number) {
  const rand = random(277);
  b.box(w, 0.03, 0.04, 0, y, z, mat("#3a2a20"));
  for (let i = 0; i < Math.max(3, Math.round(w / 0.08)); i++) {
    const x = -w / 2 + (w * (i + 0.5)) / Math.max(3, Math.round(w / 0.08));
    const fh = h * (0.4 + rand() * 0.6);
    b.add(new THREE.ConeGeometry(0.035, fh, 6), part(mat(i % 2 ? "#ffb347" : "#ff7a2e", { emissive: i % 2 ? "#ff9a2a" : "#ff5a1a", emissiveIntensity: 0.9 }), "fire"), x, y + 0.03 + fh / 2, z + (rand() - 0.5) * 0.04);
  }
}

/** A piano keyboard: white keys and the black ones in their groups. */
function keys(b: Builder, w: number, y: number, z: number) {
  b.box(w, 0.025, 0.15, 0, y, z, mat("#f6f4ee"), 0.002);
  const white = Math.max(14, Math.round(w / 0.0235));
  const kw = w / white;
  for (let i = 0; i < white - 1; i++) {
    b.box(0.0015, 0.026, 0.15, -w / 2 + kw * (i + 1), y, z, mat("#bdbab2"));
    if ([0, 1, 3, 4, 5].includes(i % 7)) b.box(kw * 0.55, 0.018, 0.09, -w / 2 + kw * (i + 1), y + 0.025, z - 0.03, mat("#141414"));
  }
}

/** An abstract print: a few soft shapes in a palette around a colour. */
function art(b: Builder, w: number, h: number, y0: number, z: number, color: string) {
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

/** A made bed's mattress, duvet and pillows, its mattress on y. */
function bedding(b: Builder, w: number, d: number, y: number, back = 0.04) {
  b.box(w, 0.2, d, 0, y, back / 2, mat(C.mattress), 0.05);
  b.box(w + 0.02, 0.07, d * 0.66, 0, y + 0.18, d / 2 - (d * 0.66) / 2 + back / 2, mat(C.linen, { roughness: 1 }), 0.035);
  b.box(w + 0.02, 0.04, 0.3, 0, y + 0.21, d / 2 - d * 0.66 + 0.12 + back / 2, mat(C.linen, { roughness: 1 }), 0.02);
  const n = w > 1.2 ? 2 : 1;
  for (let i = 0; i < n; i++) b.box(w / n - 0.14, 0.13, 0.36, -w / 2 + (w / n) * (i + 0.5), y + 0.18, -d / 2 + 0.27 + back / 2, mat(C.pillow), 0.06);
}

function tvPanel(b: Builder, w: number, h: number, y: number, z: number) {
  b.box(w, h, 0.03, 0, y, z, mat(C.black, { roughness: 0.4 }), 0.004);
  b.box(w - 0.016, h - 0.016, 0.002, 0, y + 0.008, z + 0.016, screenMat());
}

function letterBox(b: Builder, w: number, d: number, h: number, y: number, f: THREE.Material) {
  b.box(w, h, d, 0, y, 0, f, 0.01);
  b.box(w * 0.65, 0.025, 0.004, 0, y + h * 0.78, d / 2, mat(C.black));
  b.box(w * 0.3, 0.06, 0.004, 0, y + h * 0.35, d / 2, mat("#d9d5ce"));
}

function bed(b: Builder, w: number, d: number, h: number, f: THREE.Material, legM: THREE.Material) {
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

function vanity(b: Builder, w: number, d: number, h: number, f: THREE.Material, basins: number, tap: THREE.Material, square = false) {
  // a cabinet on the wall and basins in a ceramic top
  b.box(w, 0.42, d - 0.02, 0, h - 0.47, back(d) + (d - 0.02) / 2, f, 0.006);
  fronts(b, -w / 2, w, h - 0.47, 0.42, d / 2 - 0.02, basins, f, 2, "bar");
  b.box(w + 0.01, 0.05, d, 0, h - 0.05, 0, mat(C.ceramic), 0.01);
  for (let i = 0; i < basins; i++) {
    const x = -w / 2 + (w / basins) * (i + 0.5);
    flat(b, Math.min(0.5, w / basins - 0.12), d - 0.18, h + 0.002, 0.03, mat("#dcdcd8", { roughness: 0.3 }), square).position.x = x;
    b.cyl(0.02, 0.02, 0.003, x, h + 0.003, 0.03, mat(C.steel), 12);
    tapBasin(b, x, h, back(d) + 0.06, tap);
  }
}

/** Blades of grass on a patch, from height y. */
function grass(b: Builder, rand: () => number, w: number, d: number, h: number, y: number, count: number, colors: string[], fountain = false) {
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
function tree(b: Builder, w: number, d: number, h: number, seed: number, kind: "round" | "birch" | "fruit" | "autumn") {
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

const rugTextures = new Map<string, THREE.Material>();
function rugMaterial(pattern: "border" | "rings" | "stripes" | "persian" | "berber", color: string, fallback: THREE.Material): THREE.Material {
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
const SHARED: Record<string, string> = { oak: "veneer_oak", walnut: "veneer_walnut", marble: "marble", concrete: "concrete", terrazzo: "terrazzo" };
const surfaces = new Map<string, THREE.MeshStandardMaterial>();
/** A finish as a material: textured where it is a material (wood, stone), else plain. */
function surface(color: string, roughness: number): THREE.MeshStandardMaterial {
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

const fabricMats = new Map<string, THREE.MeshStandardMaterial>();
/** Upholstery: the finish's colour woven (one material per colour). */
function fabricMat(color: string, map: THREE.Texture): THREE.MeshStandardMaterial {
  let m = fabricMats.get(color);
  if (!m) fabricMats.set(color, (m = new THREE.MeshStandardMaterial({ map, roughness: 1 })));
  return m;
}

/**
 * A Modern piece in its own frame, or null for an unknown kind. `finish` and `accent`
 * name FINISHES (default: the kind's first finish and accent).
 */
export function buildModern(kind: string, size: [number, number], height: number, finish?: string, accent?: string): THREE.Group | null {
  const def = MODERN[kind];
  const build = BUILDERS[kind];
  if (!def || !build) return null;
  const color = finish && FINISHES[finish] ? finish : def.finishes[0];
  const accentColor = accent && FINISHES[accent] && def.accents ? accent : (def.accents?.[0] ?? "black");
  const b = new Builder();
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
  const box = new THREE.Box3().setFromObject(piece);
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
