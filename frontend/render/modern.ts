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
const shadeMat = (_finish: THREE.Material, color: string) => mat(["black", "anthracite"].includes(color) ? FINISHES[color] : C.shade, { side: THREE.DoubleSide });

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
    b.sphere(w * 0.5, 0, h - w * 0.5, 0, mat("#f6f1e6", { transparent: true, opacity: 0.92 }), 1, 1, 1, 24);
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
  nightstand_wall: (b, w, d, h, f) => {
    b.box(w, h, d, 0, 0, 0, f, 0.006);
    fronts(b, -w / 2, w, 0.005, h - 0.01, d / 2 - 0.018, 1, f, 1);
  },
  wardrobe: (b, w, d, h, f) => {
    b.box(w, h - 0.08, d - 0.02, 0, 0.08, back(d) + (d - 0.02) / 2, f);
    b.box(w - 0.02, 0.08, d - 0.06, 0, 0, back(d) + (d - 0.06) / 2, mat(C.black));
    fronts(b, -w / 2, w, 0.08, h - 0.08, d / 2 - 0.02, Math.max(1, Math.round(w / 0.5)), f, 1, "bar");
  },
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
    b.cyl(r * 0.95, r * 0.95, 0.06, 0, h - 0.08, 0, mat("#fff3d6", { emissive: "#ffe2a8", emissiveIntensity: 0.6 }), 20);
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
    b.sphere(r * 0.25, 0, h * 0.42, 0, mat("#ff8a3a", { emissive: "#ff5a1a", emissiveIntensity: 0.8 }), 1, 0.4, 1, 10);
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
  heat_pump: (b, w, d, h, f) => {
    b.box(w, h - 0.1, d - 0.05, 0, 0.1, -0.025, f, 0.015);
    for (const sx of [-1, 1]) b.box(0.08, 0.1, d, sx * (w / 2 - 0.15), 0, 0, mat(C.black));
    const r = Math.min(w * 0.3, (h - 0.1) * 0.4);
    const cx = -w * 0.12;
    const cy = 0.1 + (h - 0.1) / 2;
    b.add(new THREE.CircleGeometry(r, 32), mat(C.black), cx, cy, d / 2 - 0.045);
    for (let k = 1; k <= 4; k++) b.add(new THREE.TorusGeometry((r * k) / 4, 0.004, 3, 32), mat(C.steel), cx, cy, d / 2 - 0.04);
    for (let i = 0; i < 2; i++) b.box(0.006, r * 2, 0.006, cx, cy - r, d / 2 - 0.04, mat(C.steel))!.rotation.z = (i * Math.PI) / 2;
    b.box(w * 0.18, 0.06, 0.01, w * 0.32, h * 0.8, d / 2 - 0.045, mat(C.steel));
  },
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
    b.box(w, h, d - 0.02, 0, 0, back(d) + (d - 0.02) / 2, mat("#e8e6e1"));
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
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const blade = b.box(r - 0.12, 0.012, 0.13, 0, 0, 0, f, 0.006);
      blade?.position.set(Math.cos(ang) * (r / 2 + 0.06), h * 0.4, Math.sin(ang) * (r / 2 + 0.06));
      blade?.rotation.set(0.12, -ang, 0);
    }
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
    b.box(w * 0.3, 0.01, 0.006, 0, h * 0.82, d * 0.2, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.7 }));
    b.add(new THREE.TorusGeometry(w * 0.32, 0.012, 6, 20), mat(C.black), 0, h * 0.3, d * 0.3).rotation.y = 0;
    b.box(0.05, 0.1, 0.06, 0, h * 0.05, d * 0.25, mat(C.black), 0.01);
  },
};

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
  van: { body: [[0, 0.14], [0, 0.97], [0.03, 1], [0.8, 1], [0.86, 0.62], [1, 0.5], [1, 0.4], [1, 0.14]], cabin: [[0.79, 0.95], [0.85, 0.62], [0.95, 0.6], [0.83, 0.97]] },
};
function car(b: Builder, w: number, d: number, h: number, color: string, style: string) {
  const prof = CAR_PROFILES[style] ?? CAR_PROFILES.hatchback;
  const paint = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.35, metalness: 0.3 });
  const dark = mat("#20262d", { roughness: 0.15, metalness: 0.4 });
  const side = (pts: [number, number][], width: number, m: THREE.Material, bevel: number) => {
    const shape = new THREE.Shape(pts.map(([t, y]) => new THREE.Vector2(-d / 2 + bevel + t * (d - 2 * bevel), y * h)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    geo.rotateY(-Math.PI / 2);
    geo.translate(width / 2 - bevel, 0, 0);
    b.add(geo, m);
  };
  side(prof.body, w * 0.93, paint, 0.04);
  side(prof.cabin, w * (style === "van" ? 0.975 : 0.84), dark, 0.03);
  if (style !== "van") {
    // the roof over the cabin's top edge
    const [, a, c] = prof.cabin;
    const len = (c[0] - a[0]) * d;
    b.box(w * 0.82, 0.04, len, 0, Math.max(a[1], c[1]) * h - 0.005, -d / 2 + ((a[0] + c[0]) / 2) * d, paint, 0.02);
  }
  const r = Math.min(0.34, h * 0.22);
  for (const t of [0.17, 0.8])
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.1);
      const z = -d / 2 + t * d;
      b.add(new THREE.CylinderGeometry(r, r, 0.22, 20), mat(C.black, { roughness: 0.9 }), x, r, z).rotation.z = Math.PI / 2;
      b.add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.23, 12), mat(C.steel, { metalness: 0.6, roughness: 0.3 }), x, r, z).rotation.z = Math.PI / 2;
    }
  const lowFront = prof.body.find(([t]) => t === 1)?.[1] ?? 0.4;
  for (const sx of [-1, 1]) {
    b.box(w * 0.2, 0.06, 0.03, sx * w * 0.33, lowFront * h - 0.1, d / 2 - 0.005, mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.3 }), 0.01);
    b.box(w * 0.18, 0.07, 0.03, sx * w * 0.36, prof.body[1][1] * h - 0.14, -d / 2 + 0.005, mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.4 }), 0.01);
  }
  b.box(w * 0.5, 0.11, 0.02, 0, 0.3, -d / 2 + 0.002, mat(C.ceramic), 0.005);
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
const glowMat = () => mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.8, side: THREE.DoubleSide });
/** Opal glass: lit from within. */
const opal = () => mat("#e6e1d6", { emissive: "#fff1d6", emissiveIntensity: 0.12, roughness: 0.5, side: THREE.DoubleSide });

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
}

function tvPanel(b: Builder, w: number, h: number, y: number, z: number) {
  b.box(w, h, 0.03, 0, y, z, mat(C.black, { roughness: 0.4 }), 0.004);
  b.box(w - 0.016, h - 0.016, 0.002, 0, y + 0.008, z + 0.016, mat(C.screen, { roughness: 0.15, metalness: 0.2 }));
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

// ----- surfaces: wood grain, marble veins, concrete, drawn once per finish -----

const surfaces = new Map<string, THREE.MeshStandardMaterial>();
/** A finish as a material: textured where the finish is a material (wood, stone), else plain. */
function surface(color: string, roughness: number): THREE.MeshStandardMaterial {
  const kind = color === "oak" || color === "walnut" ? "wood" : color === "marble" ? "marble" : color === "concrete" ? "concrete" : null;
  if (!kind || typeof document === "undefined") return mat(FINISHES[color] ?? color, { roughness });
  const key = `${color}/${roughness}`;
  let m = surfaces.get(key);
  if (m) return m;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const base = new THREE.Color(FINISHES[color]);
  const shade = (k: number) => base.clone().lerp(new THREE.Color(k > 0 ? "#ffffff" : "#000000"), Math.abs(k)).getStyle();
  ctx.fillStyle = base.getStyle();
  ctx.fillRect(0, 0, 256, 256);
  const rand = random(color.length * 7919);
  if (kind === "wood") {
    // long wavy grain lines along u, a few darker ones
    for (let i = 0; i < 70; i++) {
      const y = rand() * 256;
      ctx.strokeStyle = shade(rand() > 0.8 ? -0.32 : rand() > 0.5 ? -0.16 : 0.12);
      ctx.lineWidth = 0.5 + rand() * 1.8;
      ctx.beginPath();
      for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 3 * rand());
      ctx.stroke();
    }
  } else if (kind === "marble") {
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = shade(-(0.12 + rand() * 0.2));
      ctx.lineWidth = 0.6 + rand() * 1.5;
      ctx.beginPath();
      let x = rand() * 256;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < 256) {
        x += (rand() - 0.5) * 40;
        y += 10 + rand() * 25;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = shade((rand() - 0.5) * 0.25);
      ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness });
  surfaces.set(key, m);
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
  const fabricLike = ["sofa", "armchair", "bed", "rug"].includes(def.type) || kind.startsWith("sofa") || kind === "garden_sofa" || kind === "chair_office";
  const finishMat = surface(color, fabricLike ? 1 : color === "marble" || color === "white" ? 0.5 : 0.75);
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
