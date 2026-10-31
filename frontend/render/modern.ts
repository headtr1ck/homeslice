// The "Modern" furniture, drawn in code and fitted to each piece's size (see
// model/modern.ts). Pieces are built in their own frame: centred, the back at -z, the
// front at +z, standing on y = 0 (wall pieces from their bottom, ceiling pieces hang
// from y = height). Loaded only by cards whose house uses one.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINISHES, MODERN } from "../model/modern";

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

  add(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    this.g.add(mesh);
    return mesh;
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
  const pts = [v(0, 0, 0), v(r * 0.72, 0, 0), v(r * 0.78, h * 0.08, 0), v(r, h * 0.92, 0), v(r * 0.96, h, 0), v(r * 0.9, h, 0), v(r * 0.86, h * 0.9, 0)].map((p) => new THREE.Vector2(p.x, p.y));
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

type Build = (b: Builder, w: number, d: number, h: number, finish: THREE.MeshStandardMaterial, color: string) => void;

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

function sofa(b: Builder, w: number, d: number, fabric: THREE.Material, corner: "none" | "l" | "chaise") {
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
  // thin black legs
  const legM = mat(C.black);
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const z of [back(d) + 0.08, back(d) + sd - 0.08]) b.cyl(0.015, 0.012, 0.06, x, 0, z, legM, 8);
  // throw pillows
  const pillow = mat(C.pillow);
  b.box(0.42, 0.4, 0.12, w / 2 - arm - 0.3, 0.4, back(d) + 0.3, pillow, 0.06)?.rotation.set(-0.25, -0.2, 0.05);
}

/** Doors (or drawers) across a front at z, gaps between them, and handles if asked. */
function fronts(b: Builder, x0: number, w: number, y0: number, h: number, z: number, n: number, m: THREE.Material, rows = 1, handle?: "bar" | "knob") {
  const cw = w / n;
  const rh = h / rows;
  for (let i = 0; i < n; i++)
    for (let r = 0; r < rows; r++) {
      b.box(cw - 0.004, rh - 0.004, 0.018, x0 + cw * (i + 0.5), y0 + rh * r + 0.002, z + 0.009, m, 0.003);
      if (handle === "bar") b.box(rows > 1 ? Math.min(0.2, cw * 0.4) : 0.012, rows > 1 ? 0.012 : Math.min(0.3, rh * 0.25), 0.02, x0 + cw * (i + 0.5) + (rows > 1 ? 0 : (i % 2 ? -1 : 1) * (cw / 2 - 0.05)), y0 + rh * r + (rows > 1 ? rh - 0.06 : rh * 0.5), z + 0.028, mat(C.black));
      if (handle === "knob") b.sphere(0.015, x0 + cw * (i + 0.5), y0 + rh * (r + 0.5), z + 0.03, mat(C.black), 1, 1, 1, 8);
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
const shadeMat = (finish: THREE.Material, color: string) => (["black", "anthracite"].includes(color) ? finish : mat(C.shade, { side: THREE.DoubleSide }));

const BUILDERS: Record<string, Build> = {
  sofa: (b, w, d, _h, f) => sofa(b, w, d, f, "none"),
  garden_sofa: (b, w, d, _h, f) => {
    // a frame of slats and thick cushions
    const frame = mat(C.black);
    b.box(w, 0.3, d, 0, 0.05, 0, frame, 0.01);
    b.box(w, 0.35, 0.08, 0, 0.35, back(d) + 0.04, frame, 0.01);
    for (const sx of [-1, 1]) b.box(0.08, 0.3, d, sx * (w / 2 - 0.04), 0.35, 0, frame, 0.01);
    sofaSeats(b, -w / 2 + 0.08, w - 0.16, 0.04, d - 0.08, f, true);
    legs(b, w, d, 0.05, 0.05, 0.02, frame, true);
  },
  sofa_corner: (b, w, d, _h, f) => sofa(b, w, d, f, "l"),
  sofa_chaise: (b, w, d, _h, f) => sofa(b, w, d, f, "chaise"),
  armchair: (b, w, d, _h, f) => {
    b.box(w, 0.26, d, 0, 0.12, 0, f, 0.06);
    b.box(w, 0.46, 0.16, 0, 0.3, back(d) + 0.08, f, 0.07);
    for (const sx of [-1, 1]) b.box(0.13, 0.3, d, sx * (w / 2 - 0.065), 0.3, 0, f, 0.06);
    b.box(w - 0.26, 0.14, d - 0.2, 0, 0.36, 0.08, f, 0.05);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * (w / 2 - 0.08), 0.13, sz * (d / 2 - 0.08)), v(sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04)), 0.014, mat(C.black));
  },
  coffee_table: (b, w, d, h, f) => {
    b.box(w, 0.035, d, 0, h - 0.035, 0, f, 0.008);
    b.box(w - 0.1, 0.02, d - 0.1, 0, h * 0.3, 0, f, 0.004);
    legs(b, w, d, h - 0.035, 0.05, 0.016, mat(C.black), true);
  },
  coffee_table_round: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.03, 0, h - 0.03, 0, f, 40);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      b.rod(v(Math.cos(a) * r * 0.55, h - 0.03, Math.sin(a) * r * 0.55), v(Math.cos(a) * r * 0.75, 0, Math.sin(a) * r * 0.75), 0.016, f);
    }
  },
  coffee_tables_nested: (b, w, d, h, f) => {
    const r1 = Math.min(d / 2, w * 0.33);
    const r2 = r1 * 0.75;
    const metal = mat(C.black);
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
  side_table: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.022, 0, h - 0.022, 0, f, 32);
    b.cyl(0.018, 0.018, h - 0.022, 0, 0, 0, mat(C.black), 12);
    b.cyl(r * 0.6, r * 0.6, 0.015, 0, 0, 0, mat(C.black), 28);
  },
  tv_board: (b, w, d, h, f) => {
    b.box(w, h - 0.12, d, 0, 0.12, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.13, h - 0.14, d / 2 - 0.018, Math.max(2, Math.round(w / 0.6)), f, 1);
    legs(b, w, d, 0.12, 0.05, 0.012, mat(C.black));
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
  tv_stand: (b, w, d, h, f) => {
    const board = Math.min(0.45, h * 0.35);
    BUILDERS.tv_board(b, w, d, board, f, "");
    const tw = Math.min(w * 0.85, 1.45);
    const th = Math.min(h - board - 0.06, tw * 0.58);
    b.box(0.25, 0.012, 0.16, 0, board, 0, mat(C.black));
    b.box(0.05, 0.06, 0.03, 0, board, -0.02, mat(C.black));
    tvPanel(b, tw, th, board + 0.06, -0.02);
  },
  tv_wall: (b, w, _d, h) => tvPanel(b, w, h, 0, 0),
  soundbar: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, Math.min(h, d) * 0.45);
    b.box(w - 0.04, h * 0.7, 0.004, 0, h * 0.15, d / 2, mat(C.black, { roughness: 1 }));
  },
  speaker_floor: (b, w, d, h, f) => {
    b.box(w, h - 0.03, d, 0, 0.03, 0, f, 0.012);
    b.box(w - 0.02, h - 0.1, 0.005, 0, 0.07, d / 2, mat("#3a3c40", { roughness: 1 }));
    legs(b, w, d, 0.03, 0.03, 0.008, mat(C.black));
  },
  speaker_shelf: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.012);
    b.add(new THREE.CircleGeometry(w * 0.32, 24), mat("#3a3c40"), 0, h * 0.38, d / 2 + 0.001);
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
  floor_lamp_arc: (b, w, d, h, f, color) => {
    const base = mat(C.ceramic);
    const x0 = -w / 2 + 0.18;
    b.cyl(0.17, 0.17, 0.05, x0, 0, 0, mat("#e8e6e1"), 32);
    const curve = new THREE.QuadraticBezierCurve3(v(x0, 0.05, 0), v(x0 + 0.1, h + 0.25, 0), v(w / 2 - 0.15, h - 0.12, 0));
    b.add(new THREE.TubeGeometry(curve, 40, 0.012, 8, false), mat(C.steel, { metalness: 0.6, roughness: 0.3 }));
    const dome = b.add(new THREE.SphereGeometry(Math.min(0.2, d / 2), 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), shadeMat(f, color), w / 2 - 0.15, h - 0.22, 0);
    dome.material = (dome.material as THREE.Material).clone();
    (dome.material as THREE.Material).side = THREE.DoubleSide;
    void base;
  },
  floor_lamp_tripod: (b, w, d, h, f, color) => {
    const r = Math.min(w, d) / 2;
    const top = v(0, h * 0.62, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      b.rod(top, v(Math.cos(a) * r * 0.85, 0, Math.sin(a) * r * 0.85), 0.012, f);
    }
    b.rod(top, v(0, h - 0.3, 0), 0.008, mat(C.black));
    b.cyl(r * 0.75, r * 0.8, 0.32, 0, h - 0.32, 0, shadeMat(f, color), 32, true);
  },
  floor_lamp_globe: (b, w, _d, h, f) => {
    b.cyl(w * 0.45, w * 0.45, 0.025, 0, 0, 0, f, 28);
    b.cyl(0.01, 0.01, h - 0.3, 0, 0.025, 0, f, 8);
    b.sphere(w * 0.5, 0, h - w * 0.5, 0, mat("#f6f1e6", { transparent: true, opacity: 0.92 }), 1, 1, 1, 24);
  },
  table_lamp: (b, w, _d, h, f, color) => {
    b.sphere(w * 0.28, 0, h * 0.24, 0, f, 1, 0.9, 1, 20);
    b.cyl(0.008, 0.008, h * 0.35, 0, h * 0.4, 0, mat(C.black), 8);
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
  dining_table: (b, w, d, h, f) => {
    b.box(w, 0.035, d, 0, h - 0.035, 0, f, 0.01);
    // two trestles
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.25);
      b.rod(v(x, h - 0.035, -d / 2 + 0.12), v(x, 0, -d / 2 + 0.06), 0.02, f);
      b.rod(v(x, h - 0.035, d / 2 - 0.12), v(x, 0, d / 2 - 0.06), 0.02, f);
      b.box(0.04, 0.04, d - 0.2, x, h - 0.075, 0, f);
    }
  },
  dining_table_round: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.035, 0, h - 0.035, 0, f, 48);
    b.cyl(0.06, 0.09, h - 0.035, 0, 0, 0, f, 20);
    b.cyl(r * 0.45, r * 0.5, 0.03, 0, 0, 0, f, 32);
  },
  garden_table: (b, w, d, h, f) => {
    for (let i = 0; i < Math.round(w / 0.1); i++) b.box(w / Math.round(w / 0.1) - 0.012, 0.03, d, -w / 2 + (w / Math.round(w / 0.1)) * (i + 0.5), h - 0.03, 0, f);
    legs(b, w, d, h - 0.03, 0.06, 0.025, mat(C.black), true);
  },
  chair_shell: (b, w, d, h, f) => {
    // a moulded seat bowl and back on wooden legs
    const shell = mat((f.color as THREE.Color).getStyle(), { side: THREE.DoubleSide });
    const seat = b.add(new THREE.SphereGeometry(0.5, 28, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), shell, 0, 0.53, 0.03);
    seat.scale.set(w, 0.3, d * 0.85);
    const backrest = b.add(new THREE.CylinderGeometry(w * 0.48, w * 0.44, h - 0.48, 24, 1, true, Math.PI * 0.7, Math.PI * 0.6), shell, 0, 0.47 + (h - 0.48) / 2, -0.02);
    backrest.scale.set(1, 1, (d * 0.9) / w);
    backrest.rotation.x = -0.12;
    const wood = mat("#c9a47c");
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * 0.1, 0.4, sz * 0.1), v(sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04)), 0.013, wood);
    for (const sz of [-1, 1]) b.rod(v(-w / 2 + 0.07, 0.15, sz * (d / 2 - 0.07)), v(w / 2 - 0.07, 0.15, sz * (d / 2 - 0.07)), 0.006, mat(C.black), 4);
  },
  chair_wood: (b, w, d, h, f) => {
    b.box(w, 0.025, d - 0.04, 0, 0.44, 0.02, f, 0.008);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.014, 0.012, 0.44, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.04), f, 10);
    for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.03), 0.44, back(d) + 0.04), v(sx * (w / 2 - 0.03), h, back(d) + 0.01), 0.013, f);
    b.box(w - 0.02, 0.1, 0.02, 0, h - 0.13, back(d) + 0.02, f, 0.005);
  },
  bar_stool: (b, w, _d, h, f) => {
    b.cyl(w * 0.48, w * 0.44, 0.06, 0, h - 0.06, 0, f, 28);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.rod(v(Math.cos(a) * w * 0.25, h - 0.05, Math.sin(a) * w * 0.25), v(Math.cos(a) * w * 0.45, 0, Math.sin(a) * w * 0.45), 0.012, mat(C.black));
    }
    b.add(new THREE.TorusGeometry(w * 0.37, 0.008, 6, 24), mat(C.black), 0, h * 0.32, 0).rotation.x = Math.PI / 2;
  },
  bench_dining: (b, w, d, h, f) => {
    b.box(w, 0.04, d, 0, h - 0.04, 0, f, 0.008);
    legs(b, w, d, h - 0.04, 0.08, 0.02, f);
  },
  kitchen: (b, w, d, h, f) => {
    const n = Math.max(1, Math.round(w / 0.6));
    const uw = w / n;
    const top = 0.04;
    b.box(w - 0.02, 0.1, d - 0.08, 0, 0, back(d) + (d - 0.08) / 2, mat(C.black));
    b.box(w, h - top - 0.1, d - 0.03, 0, 0.1, back(d) + (d - 0.03) / 2, mat("#e8e6e1"));
    b.box(w, top, d, 0, h - top, 0, mat("#d9d5ce", { roughness: 0.4 }), 0.004);
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
  kitchen_island: (b, w, d, h, f) => {
    const top = 0.04;
    const over = Math.min(0.3, d * 0.3);
    const bd = d - over;
    b.box(w - 0.1, 0.1, bd - 0.08, 0, 0, back(d) + bd / 2, mat(C.black));
    b.box(w - 0.08, h - top - 0.1, bd, 0, 0.1, back(d) + bd / 2, f, 0.004);
    // fronts towards the kitchen (the back), seats under the overhang
    fronts(b, -w / 2 + 0.04, w - 0.08, 0.1, h - top - 0.1, back(d) - 0.018, Math.max(1, Math.round((w - 0.08) / 0.6)), f, 3);
    // a worktop folding down at both ends
    const worktop = mat("#e6e3dd", { roughness: 0.35 });
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
  bed: (b, w, d, h, f) => bed(b, w, d, h, f),
  bed_single: (b, w, d, h, f) => bed(b, w, d, h, f),
  nightstand: (b, w, d, h, f) => {
    b.box(w, h - 0.15, d, 0, 0.15, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.16, h - 0.17, d / 2 - 0.018, 1, f, 2, "knob");
    legs(b, w, d, 0.15, 0.04, 0.01, mat(C.black));
  },
  nightstand_wall: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.005, h - 0.01, d / 2 - 0.018, 1, f, 1);
  },
  wardrobe: (b, w, d, h, f) => {
    b.box(w, h - 0.08, d - 0.02, 0, 0.08, back(d) + (d - 0.02) / 2, f);
    b.box(w - 0.02, 0.08, d - 0.06, 0, 0, back(d) + (d - 0.06) / 2, mat(C.black));
    fronts(b, -w / 2, w, 0.08, h - 0.08, d / 2 - 0.02, Math.max(1, Math.round(w / 0.5)), f, 1, "bar");
  },
  wardrobe_sliding: (b, w, d, h, f) => {
    b.box(w, h, d - 0.06, 0, 0, back(d) + (d - 0.06) / 2, f);
    const n = Math.max(2, Math.round(w / 1));
    const pw = w / n + 0.03;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const z = d / 2 - (i % 2 ? 0.05 : 0.025);
      b.box(Math.min(pw, w / n + 0.03), h - 0.04, 0.02, x, 0.02, z, f, 0.004);
      // a mirror on every other panel
      if (i % 2 === 1) b.box(pw - 0.1, h - 0.3, 0.004, x, 0.15, z + 0.012, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }));
      b.box(0.01, 0.35, 0.012, x + (i % 2 ? -1 : 1) * (pw / 2 - 0.04), h * 0.45, z + 0.014, mat(C.black));
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
  dresser: (b, w, d, h, f) => {
    b.box(w, h - 0.12, d, 0, 0.12, 0, f, 0.008);
    fronts(b, -w / 2, w, 0.13, h - 0.14, d / 2 - 0.018, Math.max(1, Math.round(w / 0.6)), f, 3, "bar");
    legs(b, w, d, 0.12, 0.05, 0.012, mat(C.black));
  },
  desk: (b, w, d, h, f) => {
    b.box(w, 0.03, d, 0, h - 0.03, 0, f, 0.006);
    const metal = mat(C.black);
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
  chair_office: (b, w, d, h, f) => {
    const metal = mat(C.black);
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
  coat_hooks: (b, w, d, h, f) => {
    b.box(w, 0.08, 0.02, 0, h - 0.08, back(d) + 0.01, f, 0.004);
    const n = Math.max(2, Math.round(w / 0.18));
    const rand = random(n);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      b.rod(v(x, h - 0.05, back(d) + 0.02), v(x, h - 0.02, back(d) + 0.08), 0.008, mat(C.black));
      if (i % 2 === 0) b.box(0.32, h - 0.12, 0.08, x, 0, back(d) + 0.07, mat(C.clothes[Math.floor(rand() * C.clothes.length)], { roughness: 1 }), 0.03);
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
  toilet_wall: (b, w, d, h, f) => {
    // a hanging bowl and the flush plate in the wall
    const ceramic = f;
    const bowl = b.add(new THREE.SphereGeometry(0.5, 24, 12), ceramic, 0, 0.33, 0.02);
    bowl.scale.set(w, 0.28, d * 0.95);
    b.box(w * 0.82, 0.2, 0.12, 0, 0.22, back(d) + 0.06, ceramic, 0.04);
    b.box(w * 0.95, 0.025, d * 0.9, 0, 0.4, 0.02, mat(C.ceramic), 0.01);
    b.box(0.24, 0.16, 0.012, 0, Math.min(h, 1.05) - 0.16, back(d) + 0.006, mat(C.chrome, { metalness: 0.6, roughness: 0.3 }), 0.004);
  },
  bidet: (b, w, d, _h, f) => {
    const bowl = b.add(new THREE.SphereGeometry(0.5, 24, 12), f, 0, 0.3, 0.02);
    bowl.scale.set(w, 0.3, d * 0.95);
    b.box(w * 0.82, 0.2, 0.12, 0, 0.2, back(d) + 0.06, f, 0.04);
    b.box(w * 0.92, 0.03, d * 0.88, 0, 0.4, 0.02, f, 0.012);
    b.box(w * 0.7, 0.004, d * 0.62, 0, 0.43, 0.05, mat("#d8d8d4"), 0.01);
    b.cyl(0.012, 0.012, 0.1, 0, 0.43, back(d) + 0.12, mat(C.chrome, { metalness: 0.8, roughness: 0.2 }), 10);
  },
  vanity: (b, w, d, h, f) => vanity(b, w, d, h, f, Math.max(1, Math.round(w / 0.75))),
  vanity_double: (b, w, d, h, f) => vanity(b, w, d, h, f, Math.max(2, Math.round(w / 0.7))),
  sink_large: (b, w, d, h, f) => {
    // a long washbasin on a shelf
    b.box(w, 0.04, d, 0, h - 0.18, 0, mat("#c9a47c"), 0.006);
    b.box(w * 0.9, 0.14, d * 0.85, 0, h - 0.14, 0.02, f, 0.03);
    b.box(w * 0.82, 0.004, d * 0.65, 0, h, 0.04, mat("#d8d8d4"));
    const tap = mat(C.chrome, { metalness: 0.8, roughness: 0.2 });
    for (const x of w > 0.9 ? [-w / 4, w / 4] : [0]) b.rod(v(x, h + 0.02, back(d) + 0.05), v(x, h + 0.2, back(d) + 0.05), 0.01, tap);
  },
  mirror_cabinet: (b, w, d, h, f) => {
    b.box(w, h, d - 0.02, 0, 0, back(d) + (d - 0.02) / 2, f, 0.004);
    const n = Math.max(1, Math.round(w / 0.4));
    for (let i = 0; i < n; i++) b.box(w / n - 0.006, h - 0.04, 0.008, -w / 2 + (w / n) * (i + 0.5), 0.02, d / 2 - 0.016, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }));
    b.box(w - 0.04, 0.01, 0.02, 0, -0.01, d / 2 - 0.04, mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.4 }));
  },
  shower_glass: (b, w, d, h, f) => {
    b.box(w, 0.04, d, 0, 0, 0, mat(C.ceramic), 0.01);
    b.box(w * 0.4, 0.004, 0.06, 0, 0.04, 0, mat("#999"));
    b.box(0.008, h - 0.04, d * 0.9, w / 2 - 0.02, 0.04, 0, glass());
    b.box(0.02, 0.02, d * 0.9, w / 2 - 0.02, h - 0.02, 0, f);
    const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.2 });
    b.cyl(0.012, 0.012, h - 0.2, -w / 2 + 0.35, 0.9, back(d) + 0.03, chrome, 10);
    b.cyl(0.13, 0.13, 0.012, -w / 2 + 0.35, h - 0.12, back(d) + 0.2, chrome, 28);
    b.rod(v(-w / 2 + 0.35, h - 0.1, back(d) + 0.03), v(-w / 2 + 0.35, h - 0.1, back(d) + 0.2), 0.01, chrome);
  },
  bathtub: (b, w, d, h, f) => {
    // freestanding: a rounded tub, white inside
    b.box(w, h, d, 0, 0, 0, f, Math.min(0.2, d * 0.3));
    b.box(w - 0.12, 0.004, d - 0.12, 0, h - 0.004, 0, mat(C.ceramic), 0.004);
    b.box(w - 0.16, 0.004, d - 0.16, 0, h - 0.002, 0, mat("#cfe0e6", { roughness: 0.2 }), 0.004);
    const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.2 });
    b.cyl(0.015, 0.015, h + 0.35, w / 2 + 0.12, 0, 0, chrome, 10);
    b.rod(v(w / 2 + 0.12, h + 0.35, 0), v(w / 2 - 0.05, h + 0.3, 0), 0.012, chrome);
  },
  towel_radiator: (b, w, d, h, f) => {
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
      b.batch(leafGeometry(size, size * 0.95, 0.35, 3), leafMat(i % 3 ? C.leafDark : C.leaf), matrix(top.x, top.y, top.z, -0.7 - rand() * 0.5, -a + Math.PI / 2, 0));
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
      b.batch(leafGeometry(size, size * 0.85, 0.15), leafMat(rand() > 0.5 ? C.leafDark : C.leaf), matrix(Math.cos(a) * r, y, Math.sin(a) * r, -0.9 + rand() * 0.5, -a + Math.PI / 2, 0));
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
        for (const side of [-1, 1]) b.batch(leafGeometry(0.22 * (1 - t * 0.5), 0.025, 0.4), leafMat(k % 2 ? C.leaf : C.leafLight), matrix(p.x, p.y, p.z, -1.0 - t * 0.6, -a + Math.PI / 2 + side * 1.1, side * 0.4));
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
  tree_deciduous: (b, w, d, h) => tree(b, w, d, h, 41, "round"),
  tree_fruit: (b, w, d, h) => tree(b, w, d, h, 43, "fruit"),
  tree_birch: (b, w, d, h) => tree(b, w, d, h, 47, "birch"),
  tree_conifer: (b, w, d, h) => {
    const rand = random(53);
    b.cyl(0.08, 0.14, h * 0.25, 0, 0, 0, mat(C.trunk), 8);
    const tiers = 9;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const y = h * (0.15 + t * 0.78);
      const r = (Math.min(w, d) / 2) * (1 - t) * 0.95 + 0.1;
      b.batch(new THREE.ConeGeometry(r, h * 0.2, 14, 1, true), mat(i % 2 ? C.leafDark : "#335f35", { side: THREE.DoubleSide }), matrix((rand() - 0.5) * 0.05, y + h * 0.1, (rand() - 0.5) * 0.05, 0, rand() * 6));
    }
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
    const canopy = b.add(new THREE.ConeGeometry(Math.min(w, d) / 2, 0.45, 8, 1, true), mat((f.color as THREE.Color).getStyle(), { side: THREE.DoubleSide, roughness: 1 }), 0, h - 0.2, 0);
    void canopy;
  },
};

function tvPanel(b: Builder, w: number, h: number, y: number, z: number) {
  b.box(w, h, 0.03, 0, y, z, mat(C.black, { roughness: 0.4 }), 0.004);
  b.box(w - 0.016, h - 0.016, 0.002, 0, y + 0.008, z + 0.016, mat(C.screen, { roughness: 0.15, metalness: 0.2 }));
}

function letterBox(b: Builder, w: number, d: number, h: number, y: number, f: THREE.Material) {
  b.box(w, h, d, 0, y, 0, f, 0.01);
  b.box(w * 0.65, 0.025, 0.004, 0, y + h * 0.78, d / 2, mat(C.black));
  b.box(w * 0.3, 0.06, 0.004, 0, y + h * 0.35, d / 2, mat("#d9d5ce"));
}

function bed(b: Builder, w: number, d: number, h: number, f: THREE.Material) {
  // an upholstered frame and headboard, mattress, duvet and pillows
  b.box(w, 0.28, d - 0.08, 0, 0.06, 0.04, f, 0.04);
  b.box(w + 0.04, h, 0.1, 0, 0.06, back(d) + 0.05, f, 0.04);
  b.box(w - 0.06, 0.2, d - 0.16, 0, 0.32, 0.06, mat(C.mattress), 0.05);
  b.box(w - 0.02, 0.07, (d - 0.12) * 0.68, 0, 0.5, d / 2 - ((d - 0.12) * 0.68) / 2 - 0.02, mat(C.linen, { roughness: 1 }), 0.035);
  b.box(w - 0.02, 0.04, 0.3, 0, 0.53, d / 2 - (d - 0.12) * 0.68 + 0.12, mat(C.linen, { roughness: 1 }), 0.02);
  const n = w > 1.2 ? 2 : 1;
  for (let i = 0; i < n; i++) b.box(w / n - 0.14, 0.13, 0.36, -w / 2 + (w / n) * (i + 0.5), 0.5, back(d) + 0.33, mat(C.pillow), 0.06);
  legs(b, w, d - 0.08, 0.06, 0.08, 0.02, mat(C.black));
}

function vanity(b: Builder, w: number, d: number, h: number, f: THREE.Material, basins: number) {
  // a cabinet on the wall and basins in a ceramic top
  b.box(w, 0.42, d - 0.02, 0, h - 0.47, back(d) + (d - 0.02) / 2, f, 0.006);
  fronts(b, -w / 2, w, h - 0.47, 0.42, d / 2 - 0.02, basins, f, 2, "bar");
  b.box(w + 0.01, 0.05, d, 0, h - 0.05, 0, mat(C.ceramic), 0.01);
  const tap = mat(C.chrome, { metalness: 0.8, roughness: 0.2 });
  for (let i = 0; i < basins; i++) {
    const x = -w / 2 + (w / basins) * (i + 0.5);
    b.box(Math.min(0.5, w / basins - 0.12), 0.004, d - 0.16, x, h, 0.03, mat("#dcdcd8"), 0.01);
    b.cyl(0.014, 0.014, 0.16, x, h, back(d) + 0.05, tap, 10);
    b.rod(v(x, h + 0.16, back(d) + 0.05), v(x, h + 0.14, back(d) + 0.15), 0.01, tap);
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

function tree(b: Builder, w: number, d: number, h: number, seed: number, kind: "round" | "birch" | "fruit") {
  const rand = random(seed);
  const bark = mat(kind === "birch" ? C.birch : C.trunk);
  const trunkH = h * (kind === "birch" ? 0.55 : kind === "fruit" ? 0.35 : 0.42);
  const trunkR = Math.max(0.06, Math.min(w, d) * (kind === "birch" ? 0.025 : 0.04));
  b.cyl(trunkR * 0.7, trunkR, trunkH, 0, 0, 0, bark, 10);
  if (kind === "birch") for (let i = 0; i < 12; i++) b.box(trunkR * 1.5, 0.03, trunkR * 0.6, 0, rand() * trunkH, trunkR * 0.7, mat("#2b2b2b"))!.rotation.y = rand() * 6;
  // branches to the clumps of leaves
  const clumps = kind === "birch" ? 7 : 6;
  const crown = v(0, trunkH + (h - trunkH) * 0.45, 0);
  const rx = w / 2;
  const rz = d / 2;
  const ry = (h - trunkH) / 2;
  const colors = kind === "fruit" ? [C.leaf, C.leafLight, C.leafDark] : kind === "birch" ? [C.leafLight, C.leafYellow, C.leaf] : [C.leaf, C.leafDark, "#3f7037"];
  for (let i = 0; i < clumps; i++) {
    const a = (i / clumps) * Math.PI * 2 + rand() * 0.6;
    const c = v(Math.cos(a) * rx * 0.45, crown.y + (rand() - 0.3) * ry * 0.8, Math.sin(a) * rz * 0.45);
    b.rod(v(0, trunkH * 0.92, 0), c, trunkR * 0.45, bark, 6);
    foliage(b, rand, c.x, c.y, c.z, rx * 0.55, ry * 0.6, rz * 0.55, kind === "birch" ? 180 : 260, kind === "birch" ? 0.1 : 0.16, colors);
  }
  foliage(b, rand, 0, crown.y + ry * 0.35, 0, rx * 0.6, ry * 0.65, rz * 0.6, 300, 0.16, colors);
  if (kind === "fruit") for (let i = 0; i < 26; i++) b.batch(new THREE.SphereGeometry(0.045, 8, 6), mat("#c8382c"), matrix((rand() - 0.5) * rx * 1.4, crown.y + (rand() - 0.5) * ry, (rand() - 0.5) * rz * 1.4));
}

// ----- rugs: woven patterns on a canvas -----

const rugTextures = new Map<string, THREE.Material>();
function rugMaterial(pattern: "border" | "rings" | "stripes", color: string, fallback: THREE.Material): THREE.Material {
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

/**
 * A Modern piece in its own frame, or null for an unknown kind. `finish` names one of
 * FINISHES (default: the kind's first).
 */
export function buildModern(kind: string, size: [number, number], height: number, finish?: string): THREE.Group | null {
  const def = MODERN[kind];
  const build = BUILDERS[kind];
  if (!def || !build) return null;
  const color = finish && FINISHES[finish] ? finish : def.finishes[0];
  const b = new Builder();
  const fabricLike = ["sofa", "armchair", "bed", "rug"].includes(def.type) || kind.startsWith("sofa") || kind === "garden_sofa" || kind === "chair_office";
  const finishMat = mat(FINISHES[color], { roughness: fabricLike ? 1 : color === "marble" || color === "white" ? 0.5 : 0.75 });
  build(b, size[0], size[1], height, finishMat, color);
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
