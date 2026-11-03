// More detailed built-in pieces: outside. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Builder, C, fronts, leafMat, mat, matrix, pot, random, smallLeaf, tapGooseneck, v } from "../modern";
import type { Build } from "../modern";
import { finishLook } from "../finishes";

type Rand = () => number;
type M = THREE.Material;
const UP = new THREE.Vector3(0, 1, 0);

// ----- helpers -----

/** The colour of a material, as a CSS string. */
const colorOf = (m: M) => ((m as THREE.MeshStandardMaterial).color ?? new THREE.Color("#888")).getStyle();
/** A colour of a material, lighter (k > 1) or darker (k < 1). */
const shade = (m: M | string, k: number) => {
  const c = new THREE.Color(typeof m === "string" ? m : colorOf(m));
  return (k > 1 ? c.lerp(new THREE.Color("#ffffff"), k - 1) : c.multiplyScalar(k)).getStyle();
};

/** A tapered round piece from a to c (radius r0 at a, r1 at c), merged with others of its material. */
function limb(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r0: number, r1: number, m: M, seg = 6, open = false) {
  const len = a.distanceTo(c);
  if (len < 1e-4) return;
  const geo = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  b.batch(geo, m, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, c.clone().sub(a).normalize()), v(1, 1, 1)));
}
/** A box merged with others of its material (bottom centre at x, y, z), turned by ry. */
function bbox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, rx = 0, ry = 0, rz = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.batch(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), m, matrix(x, y, z, rx, ry, rz));
}
/** A box from a to c (its long side), w wide and t thick, merged. */
function beam(b: Builder, a: THREE.Vector3, c: THREE.Vector3, w: number, t: number, m: M) {
  const len = a.distanceTo(c);
  const geo = new THREE.BoxGeometry(w, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, c.clone().sub(a).normalize());
  b.batch(geo, m, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, v(1, 1, 1)));
}
/** A rounded box, merged (bottom centre). */
function rbox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, r: number, rx = 0, ry = 0, seg = 1) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const geo = rr > 0.002 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  b.batch(geo.translate(0, h / 2, 0), m, matrix(x, y, z, rx, ry));
}

/** A lumpy ball (a clump of leaves, a stone): an icosahedron pushed in and out, flat shaded. */
function lumpy(detail: number, seed: number, amp: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const s = seed * 1.7;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + amp * (Math.sin(x * 3.1 + s) * Math.sin(y * 2.7 + s * 1.3) * Math.sin(z * 3.3 + s * 0.7) + 0.5 * Math.sin(x * 6.3 + y * 5.1 + z * 5.7 + s * 2.1));
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

/**
 * A clump of foliage: a lumpy body in `body` with small leaves standing out of its
 * surface (more on the top and outside), all merged.
 */
function clump(b: Builder, rand: Rand, x: number, y: number, z: number, rx: number, ry: number, rz: number, body: string, leaves: string[], count: number, leafSize: number, detail = 1, amp = 0.2) {
  // turned before it is stretched: a long clump stays along its axes
  b.batch(lumpy(detail, rand() * 100, amp).rotateY(rand() * 6), mat(body, { roughness: 0.95 }), new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion(), v(rx, ry, rz)));
  const leaf = smallLeaf(leafSize);
  for (let i = 0; i < count; i++) {
    const u = rand() * Math.PI * 2;
    // biased to the upper half: the light side
    const cw = Math.min(1, 2 * rand() - 0.6);
    const sw = Math.sqrt(1 - cw * cw);
    const k = 0.92 + rand() * 0.16;
    b.batch(leaf.clone(), leafMat(leaves[i % leaves.length]), matrix(x + sw * Math.cos(u) * rx * k, y + cw * ry * k, z + sw * Math.sin(u) * rz * k, rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI, 0.7 + rand() * 0.6));
  }
}

const barkMats = new Map<string, THREE.MeshStandardMaterial>();
/** The textured bark (for trunks drawn as their own mesh, with texture coordinates). */
function barkMat(id: "bark" | "bark_birch"): THREE.MeshStandardMaterial {
  let m = barkMats.get(id);
  if (m) return m;
  const look = finishLook(id);
  m = look.map ? new THREE.MeshStandardMaterial({ map: look.map, roughness: 1 }) : mat(id === "bark" ? C.trunk : C.birch, { roughness: 1 });
  barkMats.set(id, m);
  return m;
}

/** A trunk with a root flare (lathe), from the ground up to `top`, r its radius up there. */
function trunk(b: Builder, base: number, top: number, len: number, m: M, flare = 1.6) {
  const pts: THREE.Vector2[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = top + (base - top) * (1 - t) + base * (flare - 1) * Math.pow(1 - t, 6);
    pts.push(new THREE.Vector2(r, t * len));
  }
  b.add(new THREE.LatheGeometry(pts, 12), m);
}

interface TreeKind {
  seed: number;
  trunkFrac: number; // where the crown starts, as a share of the height
  trunkR: number; // the trunk's radius at the bottom, as a share of the smaller side
  limbs: number; // main limbs out of the trunk
  bark: "bark" | "bark_birch";
  wood: string; // the colour of the thin branches
  body: string[]; // colours of the clumps' bodies (inside to outside)
  leaves: string[];
  leafSize: number;
  leafCount: number; // leaves per outer clump
  clumps: number; // outer clumps
  clump: number; // clump radius, as a share of the crown radius
  leader?: boolean; // the trunk runs on up through the crown (birch)
  droop?: number; // outer clumps hang lower at the sides
}

/**
 * A grown tree in an ellipsoid crown that fills the box above the clear trunk: a flared
 * trunk, main limbs forking into branches that end in lumpy clumps of foliage in layers
 * (dark ones deep inside, lighter ones outside), gaps between them where the wood shows.
 */
function grownTree(b: Builder, w: number, d: number, h: number, o: TreeKind) {
  const rand = random(o.seed);
  const R = Math.min(w, d) / 2;
  const base = h * o.trunkFrac;
  const ry = (h - base) / 2;
  const cy = base + ry;
  const cr = R * o.clump;
  const r0 = Math.max(0.05, Math.min(w, d) * o.trunkR);
  const barkM = barkMat(o.bark);
  const wood = mat(o.wood, { roughness: 1 });
  const crownBark = o.bark === "bark_birch" ? barkM : barkMat("bark");
  // the trunk, up to where the limbs leave it (or on through the crown)
  const forkY = o.leader ? h - ry * 0.5 : base + ry * 0.35;
  trunk(b, r0, o.leader ? r0 * 0.25 : r0 * 0.55, forkY, barkM);
  const lead = v(0, forkY, 0);
  // the outer clumps: on the crown's shell (Fibonacci spiral), not too far down
  type Clump = { p: THREE.Vector3; s: number };
  const outer: Clump[] = [];
  const n = o.clumps;
  for (let i = 0; i < n; i++) {
    const yy = 1 - (i + 0.5) / n * 1.55; // 1 … -0.55
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const a = i * 2.39996 + rand() * 0.3;
    const s = cr * (0.85 + rand() * 0.3);
    let y = cy + yy * (ry - s * 0.75);
    if (o.droop) y -= o.droop * rr * ry * 0.4;
    outer.push({ p: v(Math.cos(a) * rr * (w / 2 - s), y, Math.sin(a) * rr * (d / 2 - s)), s });
  }
  // main limbs: out of the fork (and along the leader) towards sectors of the crown
  const limbEnds: THREE.Vector3[] = [];
  for (let k = 0; k < o.limbs; k++) {
    const a = (k / o.limbs) * Math.PI * 2 + rand() * 0.6;
    const from = o.leader ? v(lead.x * 0.5, base + (forkY - base) * (0.2 + (0.6 * k) / o.limbs), lead.z * 0.5) : lead.clone();
    const to = v(Math.cos(a) * R * 0.5, from.y + ry * (o.leader ? 0.45 : 0.6), Math.sin(a) * R * 0.5);
    const mid = from.clone().lerp(to, 0.5).add(v((rand() - 0.5) * 0.2, 0, (rand() - 0.5) * 0.2));
    const lr = o.leader ? r0 * 0.3 : r0 * 0.42;
    limb(b, from, mid, lr, lr * 0.8, crownBark, 7);
    limb(b, mid, to, lr * 0.8, lr * 0.55, lr > 0.05 ? crownBark : wood, 6);
    limbEnds.push(mid, to);
  }
  // each clump on a branch from the nearest limb
  const near = (p: THREE.Vector3) => limbEnds.reduce((m, q) => (q.distanceToSquared(p) < m.distanceToSquared(p) ? q : m));
  for (const c of outer) {
    const from = near(c.p);
    const to = from.clone().lerp(c.p, 0.85);
    limb(b, from, to, Math.max(0.012, r0 * 0.18), 0.01, wood, 5);
  }
  // inner clumps: darker, a smaller crown inside
  const inner = Math.max(3, Math.round(n * 0.35));
  for (let i = 0; i < inner; i++) {
    const a = i * 2.39996 + 1;
    const yy = 0.6 - (1.2 * (i + 0.5)) / inner;
    const s = cr * (0.9 + rand() * 0.2);
    const p = v(Math.cos(a) * R * 0.35, cy + yy * ry * 0.5, Math.sin(a) * R * 0.35);
    clump(b, rand, p.x, p.y, p.z, s, s * 0.85, s, o.body[0], o.leaves.slice(0, 2), Math.round(o.leafCount * 0.25), o.leafSize);
  }
  for (const c of outer) {
    const top = c.p.y > cy + ry * 0.2;
    clump(b, rand, c.p.x, c.p.y, c.p.z, c.s, c.s * 0.85, c.s, o.body[top ? o.body.length - 1 : Math.min(1, o.body.length - 1)], o.leaves, o.leafCount, o.leafSize);
  }
  return { rand, outer, cr, base, r0 };
}

// ----- umbrellas -----

/**
 * An umbrella canopy: `ribs` panels from the apex (cx, cy, cz) down to the rim, a little
 * domed, the cloth drawn in between the ribs, a short valance round the rim; ribs under it,
 * struts from a runner on the pole (when `runner` is given), a finial on top.
 */
function canopy(b: Builder, cx: number, cy: number, cz: number, R: number, rise: number, ribs: number, cloth: M, frame: M, runner?: number, valance = 0.09) {
  const rings = 4;
  const seg = ribs * 2;
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (t: number, k: number) => {
    const a = (k / seg) * Math.PI * 2;
    const mid = k % 2 === 1;
    const r = R * t * (mid ? Math.cos(Math.PI / seg) * 0.96 : 1);
    return v(cx + Math.cos(a) * r, cy - rise * (0.35 * t + 0.65 * t * t) - (mid ? 0.04 * t * t : 0), cz + Math.sin(a) * r);
  };
  // each panel its own vertices: smooth within, creased at the ribs
  for (let q = 0; q < ribs; q++) {
    const first = pos.length / 3;
    for (let j = 0; j <= rings; j++)
      for (let c = 0; c <= 2; c++) {
        const p = at(j / rings, q * 2 + c);
        pos.push(p.x, p.y, p.z);
      }
    for (let j = 0; j < rings; j++)
      for (let c = 0; c < 2; c++) {
        const i0 = first + j * 3 + c;
        const o0 = i0 + 3;
        idx.push(i0, o0 + 1, o0, i0, i0 + 1, o0 + 1);
      }
  }
  // the valance: a band hanging from the rim, its own vertices (a crease)
  const v0 = pos.length / 3;
  for (let k = 0; k < seg; k++) {
    const p = at(1, k);
    pos.push(p.x, p.y, p.z, p.x, p.y - valance, p.z);
  }
  for (let k = 0; k < seg; k++) {
    const t0 = v0 + k * 2;
    const t1 = v0 + ((k + 1) % seg) * 2;
    idx.push(t0, t1, t0 + 1, t1, t1 + 1, t0 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  b.batch(geo, cloth);
  // ribs under the cloth, struts from the runner, the tips
  for (let k = 0; k < seg; k += 2) {
    const tip = at(1, k).add(v(0, -0.012, 0));
    limb(b, v(cx, cy - 0.04, cz), tip, 0.009, 0.007, frame, 4, false);
    b.batch(new THREE.SphereGeometry(0.014, 6, 4), frame, matrix(tip.x, tip.y, tip.z));
    if (runner !== undefined) limb(b, v(cx, runner, cz), at(0.5, k).add(v(0, -0.015, 0)), 0.007, 0.007, frame, 4, false);
  }
  b.batch(new THREE.ConeGeometry(0.045, 0.06, 8), frame, matrix(cx, cy + 0.03, cz));
  b.batch(new THREE.SphereGeometry(0.02, 8, 6), frame, matrix(cx, cy + 0.07, cz));
}

/** A cloth material in a finish's colour, shown from both sides. */
const clothOf = (f: M) => mat(colorOf(f), { side: THREE.DoubleSide, roughness: 1 });

/**
 * A beam along x, `len` long, `hgt` high, `t` thick, its bottom corners cut off at the ends
 * (rafter tails), bottom centre at (x, y, z), turned by ry.
 */
function tailBeam(b: Builder, len: number, hgt: number, t: number, x: number, y: number, z: number, m: M, ry = 0, cut = Math.min(0.15, len * 0.1), rz = 0) {
  const s = new THREE.Shape([new THREE.Vector2(-len / 2 + cut, 0), new THREE.Vector2(len / 2 - cut, 0), new THREE.Vector2(len / 2, hgt * 0.55), new THREE.Vector2(len / 2, hgt), new THREE.Vector2(-len / 2, hgt), new THREE.Vector2(-len / 2, hgt * 0.55)]);
  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  geo.translate(0, 0, -t / 2);
  b.batch(geo, m, matrix(x, y, z, 0, ry, rz));
}

export const BUILDERS: Record<string, Build> = {
  // ----- trees -----
  tree_deciduous: (b, w, d, h, _f, color) => {
    const autumn = color === "autumn";
    grownTree(b, w, d, h, {
      seed: 41,
      trunkFrac: 0.3,
      trunkR: 0.042,
      limbs: 4,
      bark: "bark",
      wood: "#5e4635",
      body: autumn ? ["#7a3f1e", "#a8612c", "#c1843a"] : ["#244624", "#35632e", "#4a7d3c"],
      leaves: autumn ? ["#c98a3a", "#b5562e", "#d9b04a", "#9a3f22"] : [C.leaf, "#5b9145", "#3f7037", C.leafLight],
      leafSize: 0.2,
      leafCount: 64,
      clumps: 24,
      clump: 0.25,
    });
  },
  tree_birch: (b, w, d, h) => {
    const t = grownTree(b, w, d, h, {
      seed: 47,
      trunkFrac: 0.3,
      trunkR: 0.026,
      limbs: 6,
      bark: "bark_birch",
      wood: "#4a3f38",
      body: ["#41702f", "#5a8a3a", "#78a04a"],
      leaves: [C.leafLight, C.leafYellow, "#6f9c45", "#8fb556"],
      leafSize: 0.13,
      leafCount: 56,
      clumps: 24,
      clump: 0.27,
      leader: true,
      droop: 0.5,
    });
    // dark markings on the white bark
    const dark = mat("#2f2a27", { roughness: 1 });
    for (let i = 0; i < 22; i++) {
      const y = 0.2 + t.rand() * h * 0.6;
      const a = t.rand() * Math.PI * 2;
      const r = y < t.base ? t.r0 * (1 - (0.3 * y) / t.base) : t.r0 * (0.7 - (0.3 * (y - t.base)) / (h * 0.5));
      bbox(b, 0.012 + r * 0.6, 0.014 + t.rand() * 0.014, 0.012, Math.cos(a) * (r - 0.004), y, Math.sin(a) * (r - 0.004), dark, 0, -a + Math.PI / 2);
    }
  },
  tree_fruit: (b, w, d, h) => {
    const t = grownTree(b, w, d, h, {
      seed: 43,
      trunkFrac: 0.26,
      trunkR: 0.04,
      limbs: 4,
      bark: "bark",
      wood: "#5b4636",
      body: ["#2a5128", "#3a6a31", "#4b7f3d"],
      leaves: [C.leaf, C.leafLight, "#3f7037", "#5d9548"],
      leafSize: 0.15,
      leafCount: 46,
      clumps: 20,
      clump: 0.27,
    });
    // apples on the outside of the clumps, mostly their lower half
    const rand = t.rand;
    const apple = new THREE.SphereGeometry(0.05, 6, 4);
    const reds = [mat("#c8382c", { roughness: 0.5 }), mat("#d9572e", { roughness: 0.5 }), mat("#a82a26", { roughness: 0.5 })];
    for (let i = 0; i < 48; i++) {
      const c = t.outer[i % t.outer.length];
      const u = rand() * Math.PI * 2;
      const cw = -0.7 + rand() * 1.1;
      const sw = Math.sqrt(1 - cw * cw);
      const k = c.s * 0.98;
      b.batch(apple.clone(), reds[i % 3], matrix(c.p.x + Math.cos(u) * sw * k, c.p.y + cw * k * 0.85, c.p.z + Math.sin(u) * sw * k, 0, 0, 0, 0.9 + rand() * 0.3));
    }
  },
  tree_conifer: (b, w, d, h) => {
    // a spruce: a straight trunk, whorls of drooping, star-shaped skirts, narrowing to a spike
    const rand = random(53);
    const R = Math.min(w, d) / 2;
    trunk(b, Math.max(0.08, R * 0.08), 0.03, h * 0.94, barkMat("bark"), 1.4);
    const tiers = Math.max(10, Math.round(h / 0.42));
    const greens = ["#1f4426", "#24502c", "#2c5a31", "#33653a"].map((c) => leafMat(c));
    const tipsMat = leafMat("#4d7d45");
    const needle = smallLeaf(0.09);
    const y0 = h * 0.07;
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1);
      const y = y0 + f * (h * 0.93 - y0);
      const reach = R * Math.pow(1 - f, 0.9) * (0.92 + rand() * 0.08) + 0.08;
      const drop = Math.max(0.12, ((h - y0) / tiers) * 1.9);
      const n = 16;
      const points = 7 + Math.round((1 - f) * 3);
      const geo = new THREE.ConeGeometry(1, 1, n, 2, true);
      const p = geo.attributes.position;
      const phase = rand() * 6;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const yy = p.getY(i); // -0.5 (rim) … 0.5 (tip)
        const a = Math.atan2(z, x);
        const star = 1 + 0.22 * Math.cos(a * points + phase);
        const rim = 0.5 - yy; // 0 at the tip, 1 at the rim
        p.setXYZ(i, x * star, yy - rim * rim * 0.25 * (star - 0.8), z * star);
      }
      geo.deleteAttribute("normal");
      geo.deleteAttribute("uv");
      geo.computeVertexNormals();
      b.batch(geo, greens[t % greens.length], new THREE.Matrix4().compose(v(0, y + drop * 0.35, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6, 0)), v(reach, drop, reach)));
      // tufts of needles at the branch tips
      for (let k = 0; k < points; k++) {
        const a = phase / -points + (k / points) * Math.PI * 2;
        for (let q = 0; q < 4; q++) {
          const rr = reach * (0.8 + rand() * 0.45);
          b.batch(needle.clone(), q % 2 ? tipsMat : greens[(t + 1) % greens.length], matrix(Math.cos(a + (rand() - 0.5) * 0.4) * rr, y + drop * (0.35 - 0.5) - rand() * 0.08, Math.sin(a + (rand() - 0.5) * 0.4) * rr, rand() * 3, rand() * 6, rand() * 3, 1 + rand()));
        }
      }
    }
    b.batch(new THREE.ConeGeometry(0.05, 0.4, 6), greens[3], matrix(0, h - 0.2, 0));
  },
  tree_pine: (b, w, d, h) => {
    // a Scots pine: a tall bare trunk, grey-brown below and orange above, a few limbs carrying
    // flat, layered cushions of needles up top
    const rand = random(269);
    const R = Math.min(w, d) / 2;
    const lower = mat("#6b5244", { roughness: 1 });
    const upper = mat("#b0673d", { roughness: 1 });
    const pts = [v(0, 0, 0), v(0.06, h * 0.25, 0.02), v(-0.04, h * 0.5, 0.05), v(0.05, h * 0.75, -0.02), v(0, h * 0.97, 0)];
    const curve = new THREE.CatmullRomCurve3(pts);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      limb(b, curve.getPoint(t0), curve.getPoint(t1), 0.17 * (1 - t0 * 0.75) + (i === 0 ? 0.04 : 0), 0.17 * (1 - t1 * 0.75), t0 < 0.4 ? lower : upper, 9);
    }
    // dead stubs low down
    for (let i = 0; i < 5; i++) {
      const p = curve.getPoint(0.3 + rand() * 0.25);
      const a = rand() * 6;
      limb(b, p, p.clone().add(v(Math.cos(a) * 0.35, 0.1, Math.sin(a) * 0.35)), 0.025, 0.01, lower, 4);
    }
    const crown0 = h * 0.58;
    const greens = ["#24452c", "#2c5234", "#365f3c"];
    const limbs = 9;
    for (let i = 0; i < limbs; i++) {
      const f = i / (limbs - 1);
      const a = i * 2.4 + rand() * 0.5;
      const y = crown0 + f * (h * 0.86 - crown0);
      const reach = R * (0.92 - f * 0.5) * (0.85 + rand() * 0.15);
      const start = curve.getPoint(y / h);
      const end = v(Math.cos(a) * reach * 0.72, y + 0.35 + rand() * 0.25, Math.sin(a) * reach * 0.72);
      limb(b, start, end, 0.06 * (1 - f * 0.5), 0.025, upper, 6);
      const s = reach * 0.42 + 0.15;
      clump(b, rand, end.x, end.y + 0.1, end.z, s, s * 0.32, s * 0.9, greens[i % 3], ["#2f5a33", "#3d6b3a", "#4a7843"], 70, 0.18, 1, 0.25);
      // a smaller cushion further in
      const m2 = start.clone().lerp(end, 0.45);
      clump(b, rand, m2.x, m2.y + 0.15, m2.z, s * 0.7, s * 0.26, s * 0.7, greens[(i + 1) % 3], ["#2f5a33", "#3d6b3a"], 30, 0.16, 1, 0.25);
    }
    clump(b, rand, 0, h * 0.94, 0, R * 0.3, R * 0.14, R * 0.3, greens[2], ["#3d6b3a", "#4a7843"], 40, 0.16, 1, 0.25);
  },
  tree_palm: (b, w, d, h) => {
    // a ringed, curving trunk; a crown of arching fronds with leaflets hanging from both sides
    const rand = random(263);
    const R = Math.min(w, d) / 2;
    const top = v(R * 0.18, h * 0.8, R * 0.05);
    const curve = new THREE.QuadraticBezierCurve3(v(0, 0, 0), v(-R * 0.12, h * 0.42, 0), top);
    const rings = 20;
    const ringA = mat("#8a7458", { roughness: 1 });
    const ringB = mat("#73604a", { roughness: 1 });
    for (let i = 0; i < rings; i++) {
      const t0 = i / rings;
      const t1 = (i + 1) / rings;
      const r = 0.17 - 0.06 * t0 + (i === 0 ? 0.05 : 0);
      // each ring a little wider at its top: the old leaf bases
      limb(b, curve.getPoint(t0), curve.getPoint(t1), r * 0.9, r * 1.04, i % 2 ? ringA : ringB, 10, false);
    }
    // the crown shaft and coconuts
    b.batch(new THREE.SphereGeometry(0.16, 10, 8), mat("#6f6a3c", { roughness: 1 }), new THREE.Matrix4().compose(top.clone().add(v(0, 0.08, 0)), new THREE.Quaternion(), v(1, 1.4, 1)));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.batch(new THREE.SphereGeometry(0.075, 8, 6), mat(i % 2 ? "#6b5a2e" : "#7d6a33", { roughness: 0.8 }), matrix(top.x + Math.cos(a) * 0.15, top.y - 0.05 - (i % 2) * 0.06, top.z + Math.sin(a) * 0.15));
    }
    const leafMats = [leafMat("#3f7a34"), leafMat("#4d8a3c"), leafMat("#36692f")];
    const rachis = mat("#6d7a3c");
    const fronds = 13;
    for (let s = 0; s < fronds; s++) {
      const a = (s / fronds) * Math.PI * 2 + rand() * 0.3;
      const lift = s % 3 === 0 ? 0.45 : s % 3 === 1 ? 0.1 : -0.25; // some up, some flat, some hanging
      const out = (R - top.x * 0.3) * (0.85 + rand() * 0.15);
      const dir = v(Math.cos(a), 0, Math.sin(a));
      const c1 = top.clone().addScaledVector(dir, out * 0.45).add(v(0, h * (0.1 + lift * 0.15), 0));
      const c2 = top.clone().addScaledVector(dir, out * (0.95 - Math.max(0, -lift) * 0.15)).add(v(0, h * (-0.12 + lift * 0.12), 0));
      const fr = new THREE.QuadraticBezierCurve3(top.clone().add(v(0, 0.15, 0)), c1, c2);
      b.batch(new THREE.TubeGeometry(fr, 8, 0.014, 4, false), rachis);
      // leaflets: thin quads, two per step, drooping off both sides
      const pos: number[] = [];
      const steps = 22;
      for (let k = 2; k < steps; k++) {
        const t = k / steps;
        const p = fr.getPoint(t);
        const tan = fr.getTangent(t);
        const side = tan.clone().cross(UP).normalize();
        const len = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (out / 1.6) + 0.08;
        for (const sd of [-1, 1]) {
          const tip = p.clone().addScaledVector(side, sd * len * 0.75).add(v(0, -len * 0.6, 0)).addScaledVector(tan, len * 0.25);
          const b0 = p;
          const b1 = p.clone().addScaledVector(tan, 0.05);
          const t1 = tip.clone().addScaledVector(tan, 0.02);
          pos.push(b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, t1.x, t1.y, t1.z, b0.x, b0.y, b0.z, t1.x, t1.y, t1.z, tip.x, tip.y, tip.z);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      b.batch(geo, leafMats[s % 3]);
    }
    // two dead fronds hanging down the trunk
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      const fr = new THREE.QuadraticBezierCurve3(top.clone(), top.clone().add(v(Math.cos(a) * 0.3, -0.1, Math.sin(a) * 0.3)), top.clone().add(v(Math.cos(a) * 0.35, -0.9, Math.sin(a) * 0.35)));
      b.batch(new THREE.TubeGeometry(fr, 5, 0.03, 4, false), mat("#8a7550", { roughness: 1 }));
    }
  },
  tree_stump: (b, w, d, h) => {
    // a sawn stump: bark with buttress roots, pale wood with rings and cracks on top
    const r = Math.min(w, d) / 2;
    const rand = random(211);
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(new THREE.Vector2(r * (0.66 + 0.34 * Math.pow(1 - t, 3)), t * h));
    }
    pts.push(new THREE.Vector2(r * 0.6, h), new THREE.Vector2(0.001, h));
    const geo = new THREE.LatheGeometry(pts, 18);
    // bumpy bark
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = p.getY(i) < h - 0.001 ? 1 + 0.05 * Math.sin(a * 7) : 1;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    b.add(geo, barkMat("bark"));
    b.add(new THREE.CircleGeometry(r * 0.62, 20), mat("#c9a77c", { roughness: 0.9 }), 0, h + 0.002, 0).rotation.x = -Math.PI / 2;
    for (let i = 1; i < 6; i++) b.add(new THREE.RingGeometry(r * 0.1 * i, r * 0.1 * i + 0.005, 20), mat("#a8845a"), 0, h + 0.003, 0).rotation.x = -Math.PI / 2;
    b.add(new THREE.RingGeometry(r * 0.58, r * 0.63, 20), mat("#8a6646"), 0, h + 0.003, 0).rotation.x = -Math.PI / 2;
    // two drying cracks from the rim inwards
    for (let i = 0; i < 2; i++) {
      const a = rand() * 6;
      bbox(b, 0.01, 0.002, r * 0.3, Math.cos(a) * r * 0.42, h + 0.003, Math.sin(a) * r * 0.42, mat("#5a4030"), 0, Math.PI / 2 - a);
    }
    // roots running into the ground
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rand() * 0.5;
      limb(b, v(Math.cos(a) * r * 0.6, h * 0.25, Math.sin(a) * r * 0.6), v(Math.cos(a) * r * 1.0, 0, Math.sin(a) * r * 1.0), r * 0.18, r * 0.06, mat("#5f4634", { roughness: 1 }), 6, false);
    }
    // moss
    clump(b, rand, r * 0.45, h * 0.3, r * 0.4, r * 0.25, r * 0.12, r * 0.2, "#5f7a3a", ["#6f8f48"], 10, 0.04);
  },
  log_stack: (b, w, d, h) => {
    // split and round logs stacked in rows, bark on the sides, pale ends with rings
    const rand = random(257);
    const r = 0.075;
    const rows = Math.max(1, Math.floor((h - r * 0.2) / (r * 1.75)));
    const barks = [mat("#5f4634", { roughness: 1 }), mat("#6e5240", { roughness: 1 }), mat("#4f3b2d", { roughness: 1 })];
    const ends = [mat("#cfae80", { roughness: 0.9 }), mat("#c39c6c", { roughness: 0.9 }), mat("#d8bb90", { roughness: 0.9 })];
    const ring = mat("#a5815a");
    for (let row = 0; row < rows; row++) {
      const n = Math.max(1, Math.floor(w / (r * 2.05)) - (row % 2));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + r + (row % 2) * r + i * r * 2.05;
        const rr = r * (0.82 + rand() * 0.18);
        const y = r + row * r * 1.75;
        const len = d * (0.9 + rand() * 0.1);
        const split = rand() < 0.4;
        const seg = split ? 3 : 9;
        const z = (rand() - 0.5) * 0.04;
        let geo: THREE.BufferGeometry = new THREE.CylinderGeometry(rr, rr, len, seg, 1, false, split ? rand() * 6 : 0);
        if (split) {
          // a split quarter: flat faces, sharp edges
          geo = geo.toNonIndexed();
          geo.computeVertexNormals();
        }
        geo.rotateX(Math.PI / 2);
        b.batch(geo, barks[i % 3], matrix(x, y, z, 0, 0, rand() * 6));
        if (!split) {
          // the pale end: a thin disc standing proud of the bark's cap, a darker heart
          b.batch(new THREE.CylinderGeometry(rr * 0.86, rr * 0.86, 0.006, 9).rotateX(Math.PI / 2), ends[(i + row) % 3], matrix(x, y, z + len / 2 + 0.002));
          b.batch(new THREE.CylinderGeometry(rr * 0.3, rr * 0.3, 0.006, 7).rotateX(Math.PI / 2), ring, matrix(x, y, z + len / 2 + 0.003));
        }
      }
    }
  },
  // ----- shrubs, hedges and flowers -----
  shrub: (b, w, d, h) => {
    // a dome of overlapping leafy clumps on a few woody stems: darker low and inside, lighter on top
    const rand = random(61);
    const greens = ["#264a25", "#33602d", "#437537"];
    const leaves = [C.leaf, C.leafDark, C.leafLight, "#5b9145"];
    const stem = mat("#5a4636", { roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand() * 0.6;
      limb(b, v(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03), v(Math.cos(a) * w * 0.2, h * 0.4, Math.sin(a) * d * 0.2), 0.02, 0.01, stem, 5);
    }
    const m = Math.min(w, d);
    const s0 = m * 0.24;
    // a ring low down, a ring higher up, one on top
    const ring = (n: number, rr: number, y: number, s: number, tone: number, a0: number) => {
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2 + rand() * 0.4;
        const k = s * (0.9 + rand() * 0.2);
        clump(b, rand, Math.cos(a) * (w / 2 - k) * rr, y, Math.sin(a) * (d / 2 - k) * rr, k, Math.min(k, y) * 0.9, k, greens[tone], leaves, 40, 0.1, 1, 0.15);
      }
    };
    ring(6, 1, Math.min(h * 0.3, s0), s0, 0, 0);
    ring(4, 0.55, h * 0.55, s0 * 1.05, 1, 0.8);
    ring(1, 0, h - s0 * 0.85, s0 * 1.1, 2, 0);
  },
  hedge_leafy: (b, w, d, h) => {
    // a loose, informal hedge: a continuous leafy body with clumps bulging out of its
    // sides and an uneven top; its leaves and clumps grow with its length
    const rand = random(67);
    const body = ["#26492a", "#2f5a2c", "#3a6a33"];
    const leaves = [C.leafDark, C.leaf, "#3d6d34", "#5b8c45"];
    const stem = mat("#4f3d30", { roughness: 1 });
    // the core: overlapping long lumps along x
    const n = Math.max(1, Math.round(w / 0.9));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const sx = (w / n) * 0.62;
      clump(b, rand, x, h * 0.44, 0, sx, h * 0.4, d * 0.36, body[0], leaves, 50, 0.13, 1, 0.12);
      limb(b, v(x - 0.1, 0, 0.05), v(x + 0.05, h * 0.25, 0), 0.025, 0.015, stem, 5);
      limb(b, v(x + 0.15, 0, -0.04), v(x + 0.1, h * 0.25, 0.02), 0.022, 0.014, stem, 5);
    }
    // clumps bulging out: front, back and top
    const m = Math.max(3, Math.round(w / 0.24));
    for (let i = 0; i < m; i++) {
      const x = -w / 2 + (w / m) * (i + 0.5) + (rand() - 0.5) * 0.1;
      const s = Math.min(d * 0.42, h * 0.3) * (0.8 + rand() * 0.4);
      const side = i % 3;
      const lx = Math.max(-w / 2 + s, Math.min(w / 2 - s, x));
      if (side === 2) clump(b, rand, lx, h - s * 0.85, (rand() - 0.5) * d * 0.2, s * 1.1, s * 0.85, s, body[2], leaves, 26, 0.13, 1, 0.15);
      else clump(b, rand, lx, s + rand() * (h - 2.4 * s), (side ? 1 : -1) * (d / 2 - s * 0.9), s, s * 1.1, s * 0.9, body[1], leaves, 26, 0.13, 1, 0.15);
    }
  },
  hedge_trimmed: (b, w, d, h) => {
    // a hedge cut to a crisp block, slightly narrower at the top, with small leaves all over
    const rand = random(353);
    const geo = new RoundedBoxGeometry(w, h - 0.06, d, 3, Math.min(0.07, d / 4));
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + (h - 0.06) / 2) / (h - 0.06);
      const k = 1 - 0.08 * t;
      // a soft bulge along the length
      const bulge = 1 + 0.015 * Math.sin(p.getX(i) * 4);
      p.setZ(i, p.getZ(i) * k * bulge);
    }
    geo.deleteAttribute("uv");
    geo.computeVertexNormals();
    b.batch(geo, mat("#2c5a2c", { roughness: 1 }), matrix(0, (h - 0.06) / 2 + 0.06, 0));
    // bare stems at the base
    for (let i = 0; i < Math.round(w / 0.25); i++) limb(b, v(-w / 2 + 0.12 + i * 0.25, 0, (rand() - 0.5) * d * 0.4), v(-w / 2 + 0.12 + i * 0.25, 0.1, 0), 0.02, 0.018, mat("#4a3a2c"), 5);
    const leaf = smallLeaf(0.055);
    const greens = [leafMat("#3f7037"), leafMat("#4f8a3f"), leafMat("#365f30"), leafMat("#5c9446")];
    const top = w * d;
    const side = w * h;
    const end = d * h;
    const n = Math.min(1700, Math.round((top + side * 2 + end * 2) * 180));
    for (let i = 0; i < n; i++) {
      const pick = rand() * (top + 2 * side + 2 * end);
      let x: number;
      let y: number;
      let z: number;
      const dz = (yy: number) => (d / 2) * (1 - (0.08 * (yy - 0.06)) / (h - 0.06));
      if (pick < top) [x, y, z] = [(rand() - 0.5) * w, h, (rand() - 0.5) * d * 0.9];
      else if (pick < top + 2 * side) {
        y = 0.08 + rand() * (h - 0.08);
        [x, z] = [(rand() - 0.5) * w, (rand() > 0.5 ? 1 : -1) * dz(y)];
      } else {
        y = 0.08 + rand() * (h - 0.08);
        [x, z] = [(rand() > 0.5 ? 1 : -1) * (w / 2), (rand() - 0.5) * 2 * dz(y)];
      }
      b.batch(leaf.clone(), greens[pick < top ? 3 - (i % 2) : i % 3], matrix(x, y, z, rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI, 0.8 + rand() * 0.5));
    }
  },
  rose_bush: (b, w, d, h) => {
    // a loose bush of dark leaves on thorny canes, roses open on top and around
    const rand = random(317);
    for (let i = 0; i < 9; i++) {
      const a = rand() * 6;
      limb(b, v(0, 0, 0), v(Math.cos(a) * w * 0.3, h * (0.55 + rand() * 0.3), Math.sin(a) * d * 0.3), 0.012, 0.007, mat("#4c5a2c"), 4);
    }
    const greens = ["#24472a", "#2e5b2b"];
    const leaves = [C.leafDark, C.leaf, "#356a33"];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand();
      const s = Math.min(w, d) * (0.24 + rand() * 0.06);
      const rr = i === 0 ? 0 : Math.min(w, d) / 2 - s;
      clump(b, rand, Math.cos(a) * rr, i === 0 ? h * 0.62 : h * (0.42 + rand() * 0.12), Math.sin(a) * rr, s, s * 0.95, s, greens[i % 2], leaves, 46, 0.075);
    }
    const reds = ["#b81f33", "#d23a4e", "#e88aa0"].map((c) => mat(c, { roughness: 0.7, side: THREE.DoubleSide }));
    const petal = new THREE.SphereGeometry(0.045, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const bud = new THREE.SphereGeometry(0.026, 6, 5);
    for (let i = 0; i < 24; i++) {
      const u = rand() * Math.PI * 2;
      const cw = 0.1 + rand() * 0.9;
      const sw = Math.sqrt(1 - cw * cw);
      const p = v(sw * Math.cos(u) * w * 0.47, h * 0.55 + cw * h * 0.43, sw * Math.sin(u) * d * 0.47);
      const m = reds[i % 5 === 0 ? 2 : i % 2];
      // an open cup, its opening facing outwards and up, a tight centre inside
      const q = new THREE.Quaternion().setFromUnitVectors(UP, v(sw * Math.cos(u), cw + 0.6, sw * Math.sin(u)).normalize());
      b.batch(petal.clone().scale(1, 0.7, 1).rotateX(Math.PI), m, new THREE.Matrix4().compose(p, q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), Math.PI)), v(1, 1, 1)));
      b.batch(bud.clone(), m, new THREE.Matrix4().compose(p.clone().addScaledVector(v(sw * Math.cos(u), cw, sw * Math.sin(u)), 0.005), q, v(1, 0.8, 1)));
    }
  },
  hydrangea: (b, w, d, h) => {
    // a rounded bush of big leaves with large mophead flower balls of many florets
    const rand = random(331);
    const greens = ["#2e5b2b", "#3a6a31"];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rand();
      const s = Math.min(w, d) * (0.28 + rand() * 0.05);
      const rr = i === 0 ? 0 : Math.min(w, d) / 2 - s;
      clump(b, rand, Math.cos(a) * rr, i === 0 ? h * 0.5 : h * 0.36, Math.sin(a) * rr, s, s * 0.9, s, greens[i % 2], [C.leaf, C.leafDark, "#4f8a3c"], 40, 0.14);
    }
    const tones = ["#8fa6e0", "#b59ad9", "#e6a8c4", "#a3b8ec"];
    const floret = new THREE.CircleGeometry(0.022, 4);
    for (let i = 0; i < 15; i++) {
      const u = rand() * Math.PI * 2;
      const cw = 0.2 + rand() * 0.8;
      const sw = Math.sqrt(1 - cw * cw);
      const r = 0.08 + rand() * 0.035;
      const c = v(sw * Math.cos(u) * (w / 2 - r), h * 0.5 + cw * (h * 0.5 - r), sw * Math.sin(u) * (d / 2 - r));
      const tone = tones[i % tones.length];
      b.batch(lumpy(1, i, 0.12), mat(shade(tone, 0.82), { roughness: 1 }), matrix(c.x, c.y, c.z, 0, 0, 0, r * 0.92));
      for (let k = 0; k < 26; k++) {
        const fu = rand() * Math.PI * 2;
        const fc = 2 * rand() - 0.6;
        const fs = Math.sqrt(Math.max(0, 1 - Math.min(1, fc) ** 2));
        const n = v(fs * Math.cos(fu), Math.min(1, fc), fs * Math.sin(fu));
        const q = new THREE.Quaternion().setFromUnitVectors(v(0, 0, 1), n);
        b.batch(floret.clone(), leafMat(k % 3 ? tone : shade(tone, 1.25)), new THREE.Matrix4().compose(c.clone().addScaledVector(n, r), q.multiply(new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), rand() * 3)), v(1, 1, 1)));
      }
    }
  },
  lavender: (b, w, d, h) => {
    // a row of grey-green mounds with many upright flower spikes
    const rand = random(79);
    const n = Math.max(1, Math.round(w / 0.42));
    const spike = new THREE.OctahedronGeometry(1, 0);
    const purple = [mat("#7d62b0", { roughness: 1 }), mat("#8a6ec0", { roughness: 1 }), mat("#6a54a0", { roughness: 1 })];
    const stalk = leafMat("#7d8f78");
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + (w / n) * (i + 0.5);
      const rx = w / n / 2;
      const rz = d / 2;
      clump(b, rand, cx, h * 0.18, 0, rx * 0.95, h * 0.2, rz * 0.9, "#6c7f68", ["#7d8f78", "#93a28c", "#8a9a84"], 70, 0.06);
      for (let k = 0; k < 46; k++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand());
        const base = v(cx + Math.cos(a) * r * rx * 0.5, h * 0.25, Math.sin(a) * r * rz * 0.5);
        const top = v(cx + Math.cos(a) * r * rx * 0.95, h * (0.8 + rand() * 0.2), Math.sin(a) * r * rz * 0.95);
        b.batch(new THREE.CylinderGeometry(0.003, 0.004, top.distanceTo(base), 3, 1, true), stalk, new THREE.Matrix4().compose(base.clone().add(top).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, top.clone().sub(base).normalize()), v(1, 1, 1)));
        b.batch(spike.clone(), purple[k % 3], new THREE.Matrix4().compose(top.clone().add(v(0, -0.035, 0)), new THREE.Quaternion().setFromUnitVectors(UP, top.clone().sub(base).normalize()), v(0.013, 0.05, 0.013)));
      }
    }
  },
  bamboo: (b, w, d, h) => {
    // green culms with pale node rings, leaning a little, leaf sprays along their upper part
    const rand = random(337);
    const culm = [mat("#7f9a45", { roughness: 0.6 }), mat("#6c8a3c", { roughness: 0.6 }), mat("#93a957", { roughness: 0.6 })];
    const node = mat("#c7c48a", { roughness: 0.6 });
    const leaves = [leafMat(C.leaf), leafMat(C.leafLight), leafMat("#5f8f3f")];
    const leaf = new THREE.BufferGeometry();
    leaf.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.012, 0.06, 0.004, 0, 0.2, 0, 0, 0, 0, 0, 0.2, 0, -0.012, 0.06, 0.004], 3));
    leaf.computeVertexNormals();
    for (let i = 0; i < 16; i++) {
      const x = (rand() - 0.5) * w * 0.7;
      const z = (rand() - 0.5) * d * 0.6;
      const top = h * (0.72 + rand() * 0.28);
      const tip = v(x * 1.25 + (rand() - 0.5) * 0.2, top, z * 1.25 + (rand() - 0.5) * 0.2);
      const base = v(x, 0, z);
      const r = 0.012 + rand() * 0.008;
      limb(b, base, tip, r, r * 0.7, culm[i % 3], 6);
      const nodes = Math.round(top / 0.28);
      for (let k = 1; k < nodes; k++) {
        const p = base.clone().lerp(tip, k / nodes);
        b.batch(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.012, 6), node, new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(UP, tip.clone().sub(base).normalize()), v(1, 1, 1)));
        if (k / nodes < 0.4) continue;
        // a spray of leaves off the node, hanging out and down
        const a0 = rand() * 6;
        for (let q = 0; q < 4; q++) {
          const a = a0 + (q - 1.5) * 0.35;
          b.batch(leaf.clone(), leaves[(k + q) % 3], matrix(p.x + Math.cos(a) * 0.04, p.y, p.z + Math.sin(a) * 0.04, 1.9 + rand() * 0.4, -a + Math.PI / 2, 0, 0.8 + rand() * 0.5));
        }
      }
    }
    // the clump's base: a mound of soil and old sheaths
    b.batch(lumpy(1, 2, 0.15), mat(C.soil, { roughness: 1 }), new THREE.Matrix4().compose(v(0, 0, 0), new THREE.Quaternion(), v(w * 0.4, 0.06, d * 0.4)));
  },
  ornamental_grass: (b, w, d, h, _f, color) => {
    // a fountain of arching blades, feathery plumes above
    const rand = random(71);
    const sand = color === "sand";
    const colors = sand ? ["#c8b27e", "#b49a63", "#d8c79c", "#a88f5c"] : ["#6f8f48", "#8aa35a", "#5b7a3c", "#7a9a50"];
    const R = Math.min(w, d) / 2;
    for (let i = 0; i < 300; i++) {
      const a = rand() * Math.PI * 2;
      const r0 = rand() * R * 0.18;
      const len = h * (0.55 + rand() * 0.35);
      const lean = 0.25 + rand() * 0.75;
      const pts: number[] = [];
      const seg = 4;
      const bw = 0.01;
      const pt = (t: number) => [Math.cos(a) * (r0 + lean * R * 0.9 * t * t), len * Math.sin((t * Math.PI) / 2.2) * (1 - lean * 0.3 * t * t), Math.sin(a) * (r0 + lean * R * 0.9 * t * t)];
      const sx = -Math.sin(a);
      const sz = Math.cos(a);
      for (let s = 0; s < seg; s++) {
        const p0 = pt(s / seg);
        const p1 = pt((s + 1) / seg);
        const w0 = bw * (1 - s / seg);
        const w1 = bw * (1 - (s + 1) / seg);
        pts.push(p0[0] - sx * w0, p0[1], p0[2] - sz * w0, p0[0] + sx * w0, p0[1], p0[2] + sz * w0, p1[0] + sx * w1, p1[1], p1[2] + sz * w1);
        pts.push(p0[0] - sx * w0, p0[1], p0[2] - sz * w0, p1[0] + sx * w1, p1[1], p1[2] + sz * w1, p1[0] - sx * w1, p1[1], p1[2] - sz * w1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.computeVertexNormals();
      b.batch(g, leafMat(colors[i % colors.length]), matrix((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.04));
    }
    // plumes: soft spindles on thin stalks, over the top
    const plume = new THREE.OctahedronGeometry(1, 1);
    const plumeM = mat(sand ? "#e6d8b4" : "#c9b98a", { roughness: 1 });
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * R * 0.55;
      const top = v(Math.cos(a) * r, h * (0.82 + rand() * 0.18), Math.sin(a) * r);
      const dir = top.clone().normalize();
      limb(b, v(0, 0.05, 0), top, 0.003, 0.002, leafMat(colors[1]), 3);
      b.batch(plume.clone(), plumeM, new THREE.Matrix4().compose(top.clone().addScaledVector(dir, -0.04), new THREE.Quaternion().setFromUnitVectors(UP, dir), v(0.018, 0.08, 0.018)));
    }
  },
  flower_bed: (b, w, d, h, _f, color) => {
    // a raised bed: a timber edging, soil, low leafy mounds and flowers at different heights
    const rand = random(73);
    const edge = mat("#8a6a4c", { roughness: 1 });
    const eh = Math.min(0.12, h * 0.3);
    for (const sz of [-1, 1]) bbox(b, w, eh, 0.04, 0, 0, sz * (d / 2 - 0.02), edge);
    for (const sx of [-1, 1]) bbox(b, 0.04, eh, d - 0.08, sx * (w / 2 - 0.02), 0, 0, edge);
    bbox(b, w - 0.08, eh - 0.02, d - 0.08, 0, 0, 0, mat(C.soil, { roughness: 1 }));
    const petals = { terracotta: ["#d4553a", "#e8a33d", "#f2d14b"], pink: ["#e58fb0", "#c24b7a", "#f4c6d6"], white: ["#f4f2ec", "#f2e7a8", "#e6e0f0"], blue: ["#5d6fc4", "#8a74b8", "#a9c4ea"] }[color] ?? ["#d4553a", "#f2d14b"];
    const n = Math.max(3, Math.round((w * d) / 0.12));
    const flower = new THREE.CircleGeometry(0.03, 5);
    const centre = mat("#e8c33a");
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.12 + ((i + rand() * 0.6) / n) * (w - 0.24);
      const z = (rand() - 0.5) * (d - 0.24);
      const s = 0.09 + rand() * 0.06;
      clump(b, rand, x, eh, z, s, s * 0.8, s, i % 2 ? "#3a6a31" : "#2e5b2b", [C.leaf, C.leafDark, "#5d8a45"], 22, 0.06);
      const fh = eh + (h - eh) * (0.45 + rand() * 0.55);
      const tone = petals[i % petals.length];
      for (let k = 0; k < 10; k++) {
        const fx = x + (rand() - 0.5) * s * 1.6;
        const fz = z + (rand() - 0.5) * s * 1.6;
        const fy = fh * (0.85 + rand() * 0.15);
        limb(b, v(x, eh, z), v(fx, fy, fz), 0.003, 0.003, leafMat(C.leaf), 3);
        b.batch(flower.clone(), leafMat(tone), matrix(fx, fy, fz, -Math.PI / 2 + (rand() - 0.5) * 0.6, rand() * 6, 0));
        b.batch(new THREE.CircleGeometry(0.009, 5), centre, matrix(fx, fy + 0.002, fz, -Math.PI / 2, 0, 0));
      }
    }
  },
  flower_pots: (b, w, d, h, f) => {
    // a row of pots of different sizes in the finish: geraniums, a little grass, a ball of box
    const rand = random(271);
    const n = Math.max(1, Math.round(w / 0.3));
    const petals = ["#d4553a", "#e58fb0", "#f2d14b", "#8a74b8", "#f4f2ec", "#c24b7a"];
    const flower = new THREE.CircleGeometry(0.028, 5);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const scale = [1, 0.8, 0.92][i % 3];
      const r = Math.min(w / n, d) * 0.45 * scale;
      const ph = h * 0.42 * scale;
      const g = new Builder();
      pot(g, r, ph, f);
      const pg = g.done();
      pg.position.x = x;
      b.g.add(pg);
      const kind = i % 3;
      if (kind === 1) {
        // a ball of box
        const s = Math.min(r * 1.1, (h - ph) / 2);
        clump(b, rand, x, ph + s * 0.9, 0, s, s, s, "#2e5b2b", ["#3f7037", "#4f8a3f"], 70, 0.04, 2, 0.06);
      } else {
        // a leafy mound with flowers on stalks above it
        const s = r * 1.05;
        clump(b, rand, x, ph + s * 0.4, 0, s, s * 0.6, s * 0.9, "#2e5b2b", [C.leaf, C.leafDark, "#5b9145"], 44, 0.07);
        const tone = petals[(i * 2 + kind) % petals.length];
        for (let k = 0; k < 9; k++) {
          const a = rand() * Math.PI * 2;
          const rr = rand() * r * 0.9;
          const y = ph + (h - ph) * (0.6 + rand() * 0.4);
          limb(b, v(x, ph, 0), v(x + Math.cos(a) * rr, y, Math.sin(a) * rr), 0.004, 0.003, leafMat(C.leaf), 3);
          // a head of a few petals
          for (let q = 0; q < 3; q++) b.batch(flower.clone(), leafMat(tone), matrix(x + Math.cos(a) * rr + (rand() - 0.5) * 0.03, y + q * 0.006, Math.sin(a) * rr + (rand() - 0.5) * 0.03, -Math.PI / 2 + (rand() - 0.5) * 0.7, rand() * 6, 0));
        }
      }
    }
  },
  // ----- garden furniture -----
  sun_lounger: (b, w, d, h, f) => {
    // a lounger: side rails on square legs, wheels at the head, a slatted bed under a
    // three-part cushion, its back part raised a little, a head roll
    const frame = f;
    const cushion = mat(C.linen, { roughness: 1 });
    const piping = mat(shade(C.linen, 0.78), { roughness: 1 });
    const railTop = h * 0.5;
    const rh = 0.07;
    const z0 = -d / 2;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.022);
      rbox(b, 0.044, rh, d - 0.02, x, railTop - rh, 0, frame, 0.008);
      // the foot legs, the head legs with a wheel outside
      rbox(b, 0.05, railTop - rh, 0.05, sx * (w / 2 - 0.055), 0, d / 2 - 0.08, frame, 0.006);
      rbox(b, 0.05, railTop - rh - 0.06, 0.05, sx * (w / 2 - 0.055), 0.06, z0 + 0.12, frame, 0.006);
    }
    for (const sx of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.065, 0.065, 0.03, 16).rotateZ(Math.PI / 2);
      b.batch(wheel, mat("#2c2d30", { roughness: 0.7 }), matrix(sx * (w / 2 - 0.015), 0.065, z0 + 0.12));
      b.batch(new THREE.CylinderGeometry(0.03, 0.03, 0.034, 10).rotateZ(Math.PI / 2), mat(C.steel, { metalness: 0.5, roughness: 0.4 }), matrix(sx * (w / 2 - 0.015), 0.065, z0 + 0.12));
    }
    for (const sz of [-1, 1]) rbox(b, w - 0.08, rh * 0.8, 0.04, 0, railTop - rh, sz * (d / 2 - 0.03), frame, 0.006);
    // slats across, under the cushion (they show at its edges)
    const n = Math.max(6, Math.round(d / 0.12));
    for (let i = 0; i < n; i++) bbox(b, w - 0.09, 0.015, 0.07, 0, railTop - 0.03, -d / 2 + 0.07 + (i * (d - 0.14)) / (n - 1), frame);
    // the cushion: back part raised to the full height, seat and foot parts flat
    const ct = 0.055;
    const cw = w - 0.07;
    const backLen = Math.min(0.7, d * 0.34);
    const flatLen = d - 0.04 - backLen;
    const y0 = railTop - 0.015;
    const lift = Math.max(0, h - 0.035 - y0 - ct);
    const ang = Math.asin(Math.min(0.5, lift / backLen));
    rbox(b, cw, ct, flatLen * 0.55 - 0.01, 0, y0, d / 2 - 0.02 - flatLen * 0.275, cushion, 0.022);
    rbox(b, cw, ct, flatLen * 0.45 - 0.01, 0, y0, d / 2 - 0.02 - flatLen * 0.55 - flatLen * 0.225, cushion, 0.022);
    const bz = d / 2 - 0.02 - flatLen - (backLen / 2) * Math.cos(ang);
    rbox(b, cw, ct, backLen - 0.01, 0, y0 + (backLen / 2) * Math.sin(ang), bz, cushion, 0.022, ang);
    // the head roll on the raised end
    const head = new THREE.CylinderGeometry(0.035, 0.035, cw - 0.06, 14).rotateZ(Math.PI / 2);
    b.batch(head, cushion, matrix(0, y0 + ct + backLen * 0.82 * Math.sin(ang) + 0.012, z0 + 0.02 + backLen * 0.18 * Math.cos(ang) + 0.06));
    // piping along the cushion's sides
    for (const sx of [-1, 1]) bbox(b, 0.008, 0.008, flatLen - 0.02, sx * (cw / 2 - 0.002), y0 + ct * 0.5, d / 2 - 0.02 - flatLen / 2, piping);
  },
  garden_table: (b, w, d, h, f, _c, a) => {
    // a slatted top in a wooden frame, a metal apron and square legs with foot caps
    const t = 0.03;
    const e = 0.07;
    for (const sz of [-1, 1]) rbox(b, w, t, e, 0, h - t, sz * (d / 2 - e / 2), f, 0.008);
    for (const sx of [-1, 1]) rbox(b, e, t, d - 2 * e, sx * (w / 2 - e / 2), h - t, 0, f, 0.006);
    const n = Math.max(3, Math.round((w - 2 * e) / 0.09));
    const sw = (w - 2 * e) / n;
    for (let i = 0; i < n; i++) rbox(b, sw - 0.008, t * 0.9, d - 2 * e, -w / 2 + e + sw * (i + 0.5), h - t, 0, f, 0.004);
    // apron under the top
    const inset = 0.06;
    for (const sz of [-1, 1]) bbox(b, w - 2 * inset, 0.06, 0.02, 0, h - t - 0.06, sz * (d / 2 - inset), a);
    for (const sx of [-1, 1]) bbox(b, 0.02, 0.06, d - 2 * inset, sx * (w / 2 - inset), h - t - 0.06, 0, a);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        rbox(b, 0.045, h - t, 0.045, sx * (w / 2 - inset), 0.012, sz * (d / 2 - inset), a, 0.006);
        bbox(b, 0.05, 0.012, 0.05, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), mat("#2c2d30", { roughness: 0.8 }));
      }
  },
  garden_chair: (b, w, d, h, f) => {
    // a slatted armchair: square legs, the back legs leaning, arms on the front legs,
    // a slatted seat and three wide back slats, all with softened edges
    const seat = 0.43;
    const lean = 0.1;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.03);
      rbox(b, 0.042, 0.62, 0.042, x, 0, d / 2 - 0.06, f, 0.006);
      // the back leg: straight to the seat, then leaning back up to the top
      rbox(b, 0.042, seat, 0.042, x, 0, -d / 2 + 0.1, f, 0.006);
      beam(b, v(x, seat - 0.02, -d / 2 + 0.1), v(x, h, -d / 2 + 0.1 - (h - seat) * Math.tan(lean)), 0.042, 0.042, f);
      // the arm and the seat rail
      rbox(b, 0.06, 0.028, d - 0.08, sx * (w / 2 - 0.035), 0.62, 0.01, f, 0.01);
      rbox(b, 0.03, 0.06, d - 0.14, x, seat - 0.08, 0, f, 0.005);
      // a stretcher low down
      bbox(b, 0.025, 0.025, d - 0.18, x, 0.12, -0.02, f);
    }
    for (let i = 0; i < 5; i++) rbox(b, w - 0.08, 0.02, 0.07, 0, seat - 0.02, -d / 2 + 0.13 + (i * (d - 0.2)) / 4, f, 0.006);
    for (let i = 0; i < 3; i++) {
      const y = seat + 0.1 + i * ((h - seat - 0.15) / 2.5);
      rbox(b, w - 0.1, 0.075, 0.02, 0, y, -d / 2 + 0.1 - (y - seat + 0.04) * Math.tan(lean), f, 0.006, -lean);
    }
  },
  garden_bench: (b, w, d, h, f, _c, a) => {
    // wooden slats on cast iron sides: a curved back leg, a front leg, a scrolled arm
    const seat = 0.44;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.04);
      const backFoot = v(x, 0, -d / 2 + 0.1);
      const backTop = v(x, h, -d / 2 + 0.02);
      const back = new THREE.QuadraticBezierCurve3(backFoot, v(x, seat, -d / 2 + 0.2), backTop);
      b.batch(new THREE.TubeGeometry(back, 10, 0.022, 6, false), a);
      b.batch(new THREE.SphereGeometry(0.024, 8, 6), a, matrix(backTop.x, backTop.y, backTop.z));
      rbox(b, 0.04, 0.64, 0.045, x, 0, d / 2 - 0.08, a, 0.01);
      // feet
      rbox(b, 0.05, 0.02, 0.09, x, 0, d / 2 - 0.08, a, 0.006);
      rbox(b, 0.05, 0.02, 0.09, x, 0, -d / 2 + 0.1, a, 0.006);
      // the seat bearer, the arm with a scroll at its front end
      rbox(b, 0.04, 0.04, d - 0.12, x, seat - 0.06, -0.01, a, 0.01);
      const arm = new THREE.CatmullRomCurve3([v(x, 0.6, -d / 2 + 0.17), v(x, 0.64, 0), v(x, 0.65, d / 2 - 0.06), v(x, 0.6, d / 2 - 0.01), v(x, 0.57, d / 2 - 0.05)]);
      b.batch(new THREE.TubeGeometry(arm, 16, 0.02, 6, false), a);
      b.batch(new THREE.SphereGeometry(0.021, 8, 6), a, matrix(x, 0.57, d / 2 - 0.05));
      b.batch(new THREE.SphereGeometry(0.021, 8, 6), a, matrix(x, 0.6, -d / 2 + 0.17));
    }
    for (let i = 0; i < 5; i++) rbox(b, w - 0.03, 0.025, 0.07, 0, seat - 0.02, -d / 2 + 0.14 + (i * (d - 0.22)) / 4, f, 0.006);
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.6) / 3.4;
      const y = seat + 0.08 + t * (h - seat - 0.12);
      // follow the back legs' curve
      const z = -d / 2 + 0.2 * (1 - t) * 0.6 + 0.02 + 0.03;
      rbox(b, w - 0.03, 0.08, 0.022, 0, y, z, f, 0.006, -0.15);
    }
  },
  // ----- structures -----
  pergola: (b, w, d, h, f) => {
    // posts on steel shoes, a pair of beams along the front and back, rafters across
    // them with cut tails, battens on top, knee braces in the corners
    const p = 0.12;
    const steel = mat("#3a3c40", { roughness: 0.6, metalness: 0.3 });
    const beamH = 0.2;
    const rafH = 0.16;
    const top = h - rafH - 0.04; // where the rafters sit
    const px = w / 2 - 0.25;
    const pz = d / 2 - 0.12;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * px;
        const z = sz * pz;
        bbox(b, p + 0.02, 0.1, p + 0.02, x, 0, z, steel);
        rbox(b, p, top - beamH - 0.02, p, x, 0.1, z, f, 0.01);
        // knee braces along x and along z
        beam(b, v(x, top - beamH - 0.55, z), v(x - sx * 0.5, top - beamH + 0.02, z), 0.07, 0.06, f);
        beam(b, v(x, top - beamH - 0.55, z), v(x, top - beamH + 0.02, z - sz * 0.5), 0.06, 0.07, f);
      }
    // the beams: one each side of the posts' line
    for (const sz of [-1, 1]) for (const k of [-1, 1]) tailBeam(b, w, beamH, 0.05, 0, top - beamH, sz * pz + k * (p / 2 + 0.025), f, 0, 0.18);
    const n = Math.max(4, Math.round(w / 0.45));
    for (let i = 0; i <= n; i++) tailBeam(b, d, rafH, 0.05, -w / 2 + 0.04 + (i * (w - 0.08)) / n, top, 0, f, Math.PI / 2, 0.14);
    // battens on top, across the rafters
    const m = Math.max(3, Math.round(d / 0.3));
    for (let i = 0; i < m; i++) bbox(b, w - 0.1, 0.04, 0.04, 0, h - 0.04, -d / 2 + 0.2 + (i * (d - 0.4)) / (m - 1), f);
  },
  carport: (b, w, d, h, f, _c, a) => {
    // posts on steel shoes, side beams, rafters across, a ribbed roof sheet in the accent
    // falling to the back, a fascia round it, a gutter and a down pipe at the back
    const p = 0.12;
    const steel = mat("#3a3c40", { roughness: 0.6, metalness: 0.3 });
    const fall = Math.min(0.12, h * 0.05);
    const roofT = 0.03;
    const front = h - roofT - 0.02; // the rafters' top at the front
    const yAt = (z: number) => front - fall * ((d / 2 - z) / d);
    const beamH = 0.2;
    const rows = Math.max(2, Math.round(d / 2.4) + 1);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - p / 2 - 0.05);
      for (let i = 0; i < rows; i++) {
        const z = -d / 2 + 0.25 + (i * (d - 0.5)) / (rows - 1);
        const top = yAt(z) - 0.12 - beamH;
        bbox(b, p + 0.02, 0.12, p + 0.02, x, 0, z, steel);
        rbox(b, p, top - 0.12 + 0.02, p, x, 0.12, z, f, 0.01);
        if (i < rows - 1) beam(b, v(x, top - 0.5, z), v(x, top + 0.02, z + 0.5), p * 0.6, 0.07, f);
        if (i > 0) beam(b, v(x, top - 0.5, z), v(x, top + 0.02, z - 0.5), p * 0.6, 0.07, f);
      }
      // the side beam, falling with the roof
      const ang = Math.atan2(fall, d);
      tailBeam(b, d + 0.1, beamH, p, x, yAt(0) - 0.12 - beamH, 0, f, Math.PI / 2, 0.12, -ang);
    }
    // rafters across, the roof sheet on them
    const n = Math.max(4, Math.round(d / 0.65));
    for (let i = 0; i <= n; i++) {
      const z = -d / 2 + 0.05 + (i * (d - 0.1)) / n;
      bbox(b, w - 0.02, 0.12, 0.06, 0, yAt(z) - 0.12, z, f);
    }
    const tilt = Math.atan2(fall, d);
    const ribs = Math.max(6, Math.round(w / 0.2));
    rbox(b, w + 0.1, roofT * 0.4, d + 0.1, 0, yAt(0), 0, a, 0.004, -tilt);
    for (let i = 0; i <= ribs; i++) bbox(b, 0.03, roofT * 0.6, d + 0.1, -w / 2 - 0.05 + 0.015 + (i * (w + 0.07)) / ribs, yAt(0) + roofT * 0.35, 0, a, -tilt);
    // fascia boards along the sides and the front
    for (const sx of [-1, 1]) bbox(b, 0.03, 0.14, d + 0.12, sx * (w / 2 + 0.065), yAt(0) - 0.1, 0, f, -tilt);
    bbox(b, w + 0.16, 0.14, 0.03, 0, front - 0.1, d / 2 + 0.065, f);
    // gutter along the back and a down pipe
    const gy = yAt(-d / 2) - 0.02;
    const gutter = new THREE.CylinderGeometry(0.05, 0.05, w + 0.1, 10).rotateZ(Math.PI / 2);
    b.batch(gutter, a, matrix(0, gy, -d / 2 - 0.09));
    const gx = w / 2 - 0.12;
    limb(b, v(gx, gy, -d / 2 - 0.09), v(gx, 0.05, -d / 2 - 0.09), 0.035, 0.035, a, 8, false);
  },
  outdoor_kitchen: (b, w, d, h, f) => {
    // a masonry block on a recessed plinth under a stone worktop: a gas grill with a
    // domed hood, a control panel with knobs, steel doors (the handle option), a sink
    const plinth = 0.08;
    const top = 0.05;
    const bodyH = h - top;
    bbox(b, w - 0.04, plinth, d - 0.08, 0, 0, -0.02, mat("#2b2c2f", { roughness: 0.9 }));
    rbox(b, w, bodyH - plinth, d, 0, plinth, 0, f, 0.008);
    // stone joints on the masonry: faint horizontal lines on the front
    const joint = mat("#8d8a85", { roughness: 1 });
    rbox(b, w + 0.04, top, d + 0.04, 0, bodyH, 0, mat("#3b3b3d", { roughness: 0.5 }), 0.008);
    const steel = mat(C.steel, { metalness: 0.6, roughness: 0.35 });
    const brushed = mat("#9ea3a8", { metalness: 0.6, roughness: 0.45 });
    const black = mat("#232427", { roughness: 0.6 });
    // the grill on the left
    const gw = Math.min(0.8, w * 0.36);
    const gx = -w / 2 + 0.12 + gw / 2;
    const gd = d * 0.72;
    rbox(b, gw, 0.08, gd, gx, h, -0.03, steel, 0.01);
    const hood = new THREE.CylinderGeometry(gd / 2, gd / 2, gw - 0.02, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
    // the hood: a half cylinder lying along x, its flat side down
    b.batch(hood.scale(1, 0.55, 1), steel, matrix(gx, h + 0.08, -0.03));
    for (const sx of [-1, 1]) b.batch(new THREE.CircleGeometry(gd / 2, 20, 0, Math.PI).scale(1, 0.55, 1).rotateY((sx * Math.PI) / 2), steel, matrix(gx + sx * (gw / 2 - 0.01), h + 0.08, -0.03));
    // the hood's handle on two posts, a thermometer
    const hz = -0.03 + gd / 2 + 0.035;
    b.batch(new THREE.CylinderGeometry(0.012, 0.012, gw * 0.7, 10).rotateZ(Math.PI / 2), brushed, matrix(gx, h + 0.12, hz));
    for (const sx of [-1, 1]) bbox(b, 0.015, 0.015, 0.05, gx + sx * gw * 0.3, h + 0.112, hz - 0.03, brushed);
    b.batch(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 14).rotateX(Math.PI / 2), black, matrix(gx, h + 0.08 + gd * 0.24, -0.03 + gd * 0.42));
    // the control panel under the worktop's edge, knobs on it
    const panelZ = d / 2;
    bbox(b, gw, 0.12, 0.012, gx, bodyH - 0.13, panelZ + 0.006, brushed);
    for (let i = 0; i < 4; i++) {
      const kx = gx - gw * 0.36 + (i * gw * 0.72) / 3;
      b.batch(new THREE.CylinderGeometry(0.022, 0.024, 0.03, 12).rotateX(Math.PI / 2), black, matrix(kx, bodyH - 0.07, panelZ + 0.027));
    }
    // doors under the grill and under the sink
    const doorH = bodyH - 0.17 - plinth - 0.03;
    fronts(b, gx - gw / 2, gw, plinth + 0.03, doorH, d / 2, 2, steel, 1, "bar");
    const sw = Math.min(0.6, w * 0.27);
    const sx0 = w / 2 - 0.12 - sw;
    fronts(b, sx0, sw, plinth + 0.03, bodyH - plinth - 0.1, d / 2, 2, steel, 1, "bar");
    // between them: masonry with joints
    const mx0 = gx + gw / 2 + 0.06;
    const mx1 = sx0 - 0.06;
    if (mx1 - mx0 > 0.1) for (let r = 1; r < 5; r++) bbox(b, mx1 - mx0, 0.006, 0.006, (mx0 + mx1) / 2, plinth + (r * (bodyH - plinth)) / 5, d / 2 + 0.001, joint);
    // the sink: a steel rim, a dark basin, the drain, a tap
    const sxc = sx0 + sw / 2;
    const bw = sw * 0.75;
    const bd = d * 0.5;
    rbox(b, bw + 0.04, 0.006, bd + 0.04, sxc, h, 0.02, steel, 0.002);
    bbox(b, bw, 0.004, bd, sxc, h + 0.004, 0.02, mat("#5f6469", { metalness: 0.5, roughness: 0.4 }));
    b.batch(new THREE.CircleGeometry(0.025, 12).rotateX(-Math.PI / 2), black, matrix(sxc, h + 0.009, 0.02));
    tapGooseneck(b, sxc, h, -d / 2 + 0.09, mat(C.chrome, { metalness: 0.85, roughness: 0.2 }));
  },
  dog_house: (b, w, d, h, f) => {
    // a kennel of boards on runners, its door in the gable end at the front: an arched
    // opening with a trim, a shingled roof with an overhang and a ridge board
    const wall = h * 0.58;
    const base = 0.06;
    // (fixed colours: a textured finish's own colour is white)
    const dark = mat("#3a332d", { roughness: 1 });
    const trim = mat("#ece6da", { roughness: 0.9 });
    for (const sx of [-1, 1]) rbox(b, 0.06, base, d - 0.04, sx * (w / 2 - 0.08), 0, 0, dark, 0.008);
    rbox(b, w, wall - base, d, 0, base, 0, f, 0.008);
    // board joints on the sides
    const rows = Math.max(3, Math.round((wall - base) / 0.1));
    for (let r = 1; r < rows; r++) {
      const y = base + (r * (wall - base)) / rows;
      for (const sx of [-1, 1]) bbox(b, 0.004, 0.006, d - 0.02, sx * (w / 2 + 0.001), y, 0, dark);
    }
    // the gables, front and back, with upright boards
    const rise = h - wall - 0.05;
    const gable = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
    const gg = new THREE.ExtrudeGeometry(gable, { depth: d - 0.02, bevelEnabled: false });
    b.batch(gg, f, matrix(0, wall, -d / 2 + 0.01));
    // the door: an arched opening, dark inside, a trim round it
    const dw = Math.min(0.36, w * 0.45);
    const dh = Math.min(wall * 0.85, wall - base - 0.04) - dw / 2;
    const door = new THREE.Shape();
    door.moveTo(-dw / 2, 0);
    door.lineTo(dw / 2, 0);
    door.lineTo(dw / 2, dh);
    door.absarc(0, dh, dw / 2, 0, Math.PI, false);
    door.lineTo(-dw / 2, 0);
    b.batch(new THREE.ShapeGeometry(door, 10), mat("#141414", { roughness: 1 }), matrix(0, base + 0.02, d / 2 + 0.002));
    for (const sx of [-1, 1]) rbox(b, 0.035, dh, 0.025, sx * (dw / 2 + 0.017), base + 0.02, d / 2 + 0.008, trim, 0.006);
    const arch = new THREE.TorusGeometry(dw / 2 + 0.017, 0.016, 6, 14, Math.PI);
    b.batch(arch, trim, matrix(0, base + 0.02 + dh, d / 2 + 0.012));
    rbox(b, dw + 0.12, 0.025, 0.04, 0, base, d / 2 + 0.01, trim, 0.006);
    // the roof: two boarded planes with rows of shingles, a ridge board
    const ov = 0.07;
    const half = w / 2 + ov;
    const slope = Math.atan2(rise + 0.01, w / 2);
    const len = half / Math.cos(slope);
    const roof = mat("#3d3f44", { roughness: 0.9 });
    const roofEdge = mat("#2c2e32", { roughness: 0.9 });
    const ridge = wall + rise + 0.004;
    for (const sx of [-1, 1]) {
      bbox(b, len + 0.02, 0.03, d + 0.14, (sx * half) / 2, ridge - (half / 2) * Math.tan(slope), 0, roof, 0, 0, -sx * slope);
      // shingle rows: steps down the slope
      for (let r = 1; r < 4; r++) {
        const t = r / 4;
        bbox(b, 0.05, 0.012, d + 0.14, sx * t * half, ridge + 0.025 - t * half * Math.tan(slope), 0, roofEdge, 0, 0, -sx * slope);
      }
    }
    rbox(b, 0.07, 0.04, d + 0.16, 0, ridge + 0.01, 0, roofEdge, 0.01);
  },
  bird_house: (b, w, d, h, f) => {
    // a nesting box on a post: a gabled roof with an overhang, an entry hole with a ring,
    // a perch under it, a bracket under the box
    const post = mat(C.trunk, { roughness: 1 });
    const bh = 0.22;
    const y0 = h - bh - 0.07;
    limb(b, v(0, 0, 0), v(0, y0, 0), 0.035, 0.03, post, 8, false);
    bbox(b, w * 0.5, 0.025, d * 0.5, 0, y0 - 0.02, 0, post);
    rbox(b, w * 0.72, bh, d * 0.72, 0, y0, 0, f, 0.006);
    const rise = 0.07;
    const gable = new THREE.Shape([new THREE.Vector2(-w * 0.36, 0), new THREE.Vector2(w * 0.36, 0), new THREE.Vector2(0, rise)]);
    b.batch(new THREE.ExtrudeGeometry(gable, { depth: d * 0.72, bevelEnabled: false }), f, matrix(0, y0 + bh, -d * 0.36));
    const slope = Math.atan2(rise, w * 0.36);
    const half = w / 2 / Math.cos(slope);
    const roof = mat("#8a3a32", { roughness: 0.8 });
    for (const sx of [-1, 1]) bbox(b, half + 0.01, 0.015, d, (sx * w) / 4, y0 + bh + rise - (w / 4) * Math.tan(slope), 0, roof, 0, 0, -sx * slope);
    b.batch(new THREE.TorusGeometry(0.03, 0.008, 6, 14), mat("#3a332d"), matrix(0, y0 + bh * 0.62, d * 0.36 + 0.002));
    b.batch(new THREE.CircleGeometry(0.028, 14), mat("#141414"), matrix(0, y0 + bh * 0.62, d * 0.36 + 0.003));
    b.batch(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6).rotateX(Math.PI / 2), post, matrix(0, y0 + bh * 0.4, d * 0.36 + 0.03));
  },
  pizza_oven: (b, w, d, h, f) => {
    // a domed brick oven on a masonry stand with an arched log store, a hearth slab, a brick
    // arch round the mouth, a flue with a cap, the fire glowing inside
    const base = h * 0.5;
    const slab = mat("#3b3b3d", { roughness: 0.7 });
    rbox(b, w, base, d, 0, 0, 0, f, 0.01);
    // the log store: a dark arch in the front with logs in it
    const aw = w * 0.6;
    const ah = base * 0.5;
    const store = new THREE.Shape();
    store.moveTo(-aw / 2, 0);
    store.lineTo(aw / 2, 0);
    store.lineTo(aw / 2, ah - aw * 0.25);
    store.quadraticCurveTo(0, ah + aw * 0.12, -aw / 2, ah - aw * 0.25);
    store.lineTo(-aw / 2, 0);
    b.batch(new THREE.ShapeGeometry(store, 8), mat("#1b1a19", { roughness: 1 }), matrix(0, 0.08, d / 2 + 0.002));
    const logEnd = mat("#c9a77c", { roughness: 0.9 });
    const logBark = mat("#5f4634", { roughness: 1 });
    const lr = 0.045;
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < Math.floor(aw / (lr * 2.1)) - r; i++) {
        const x = -aw / 2 + lr * 1.15 + r * lr + i * lr * 2.1;
        const y = 0.08 + lr + r * lr * 1.75;
        if (y + lr > 0.08 + ah - aw * 0.2) continue;
        b.batch(new THREE.CylinderGeometry(lr, lr, 0.05, 8).rotateX(Math.PI / 2), logBark, matrix(x, y, d / 2 - 0.02));
        b.batch(new THREE.CircleGeometry(lr * 0.85, 8), logEnd, matrix(x, y, d / 2 + 0.006));
      }
    rbox(b, w + 0.06, 0.07, d + 0.06, 0, base, 0, slab, 0.008);
    // the dome
    const r = Math.min(w, d) * 0.42;
    const top = h - base - 0.07 - 0.25;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(t) * r * (1 + 0.06 * Math.sin(t * 2))), Math.sin(t) * top));
    }
    const brick = mat("#b5683f", { roughness: 1 });
    const oz = -d * 0.04;
    b.add(new THREE.LatheGeometry(pts, 28), brick, 0, base + 0.07, oz);
    // mortar courses round the dome
    const mortar = mat("#d9c7a8", { roughness: 1 });
    for (let i = 1; i < 4; i++) {
      const t = (i / 4) * (Math.PI / 2) * 0.9;
      const rr = Math.cos(t) * r * (1 + 0.06 * Math.sin(t * 2));
      b.batch(new THREE.TorusGeometry(rr + 0.002, 0.006, 4, 28).rotateX(Math.PI / 2), mortar, matrix(0, base + 0.07 + Math.sin(t) * top, oz));
    }
    // the entrance: a short vault out to the front with a brick arch, the mouth dark, the fire inside
    const mw = r * 0.62;
    const mh = top * 0.42;
    const mz = oz + r * 0.8;
    const vault = new THREE.Shape();
    vault.moveTo(-mw / 2 - 0.07, 0);
    vault.lineTo(mw / 2 + 0.07, 0);
    vault.lineTo(mw / 2 + 0.07, mh);
    vault.absarc(0, mh, mw / 2 + 0.07, 0, Math.PI, false);
    vault.lineTo(-mw / 2 - 0.07, 0);
    const mouth = new THREE.Path();
    mouth.moveTo(-mw / 2, 0);
    mouth.absarc(0, mh, mw / 2, Math.PI, 0, true);
    mouth.lineTo(mw / 2, 0);
    mouth.lineTo(-mw / 2, 0);
    vault.holes.push(mouth);
    const depth = Math.max(0.05, d / 2 - mz - 0.02);
    b.batch(new THREE.ExtrudeGeometry(vault, { depth, bevelEnabled: false, curveSegments: 10 }), mat("#a35a35", { roughness: 1 }), matrix(0, base + 0.07, mz));
    const inside = new THREE.Shape();
    inside.moveTo(-mw / 2, 0);
    inside.lineTo(mw / 2, 0);
    inside.lineTo(mw / 2, mh);
    inside.absarc(0, mh, mw / 2, 0, Math.PI, false);
    inside.lineTo(-mw / 2, 0);
    b.batch(new THREE.ShapeGeometry(inside, 10), mat("#1a1210", { roughness: 1 }), matrix(0, base + 0.07, mz + 0.01));
    const fire = mat("#ff8a3a", { emissive: "#ff5a1a", emissiveIntensity: 0.8 });
    b.add(new THREE.SphereGeometry(mw * 0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), fire, 0, base + 0.07, mz + 0.03).scale.set(1, 0.7, 0.5);
    // the flue on top of the entrance, a cap
    const fz = mz + depth * 0.4;
    const fy = base + 0.07 + mh + mw / 2 + 0.06;
    limb(b, v(0, fy - 0.05, fz), v(0, h - 0.05, fz), 0.05, 0.05, mat(C.black, { roughness: 0.6 }), 12, false);
    b.batch(new THREE.ConeGeometry(0.1, 0.05, 12), mat(C.black, { roughness: 0.6 }), matrix(0, h - 0.025, fz));
  },
  // ----- paths: flat, often long, so plain merged boxes over a dark bed that shows as joints -----
  path_paving: (b, w, d, h, f) => {
    // slabs in a running bond (every other row shifted by half a slab, cut at the edges),
    // a hair lower or higher each, on a dark bed whose top shows in the joints
    const rand = random(401);
    const gap = 0.008;
    bbox(b, w - 0.004, h * 0.6, d - 0.004, 0, 0, 0, mat("#3d3b38", { roughness: 1 }));
    const rows = Math.max(1, Math.round(d / 0.4));
    const sw = w / Math.max(1, Math.round(w / 0.6));
    for (let r = 0; r < rows; r++) {
      const z = -d / 2 + (d / rows) * (r + 0.5);
      for (let x0 = -w / 2 - (r % 2 ? sw / 2 : 0); x0 < w / 2 - 0.01; x0 += sw) {
        const a = Math.max(x0, -w / 2);
        const c = Math.min(x0 + sw, w / 2);
        if (c - a > 0.05) bbox(b, c - a - gap, h * (0.94 + rand() * 0.06), d / rows - gap, (a + c) / 2, 0, z, f);
      }
    }
  },
  path_boardwalk: (b, w, d, h, f) => {
    // boards across two joists, dark gaps between them, a little uneven in height
    const rand = random(409);
    const joist = mat("#3a332d", { roughness: 1 });
    for (const sx of [-1, 1]) bbox(b, 0.06, h * 0.6, d - 0.01, sx * (w / 2 - 0.12), 0, 0, joist);
    const n = Math.max(2, Math.round(d / 0.15));
    const bh = h * 0.4;
    for (let i = 0; i < n; i++) bbox(b, w, bh * (0.92 + rand() * 0.08), d / n - 0.01, 0, h - bh, -d / 2 + (d / n) * (i + 0.5), f);
  },
  // ----- umbrellas and shade -----
  parasol: (b, w, d, h, f) => {
    // a market parasol: a granite foot, an aluminium pole with a crank and a runner,
    // eight ribs under a domed cloth with a valance, a finial on top
    const R = Math.min(w, d) / 2;
    const pole = mat("#d4d0c8", { roughness: 0.4, metalness: 0.4 });
    const dark = mat("#45484d", { roughness: 0.6 });
    rbox(b, 0.5, 0.07, 0.5, 0, 0, 0, mat("#5d6064", { roughness: 0.9 }), 0.012);
    b.batch(new THREE.CylinderGeometry(0.04, 0.055, 0.16, 12), dark, matrix(0, 0.15, 0));
    const top = h - 0.1;
    b.batch(new THREE.CylinderGeometry(0.022, 0.024, top - 0.07, 10), pole, matrix(0, 0.07 + (top - 0.07) / 2, 0));
    const rise = Math.min(0.5, R * 0.3);
    const runner = top - rise - Math.min(0.45, R * 0.3);
    b.batch(new THREE.CylinderGeometry(0.036, 0.036, 0.1, 12), dark, matrix(0, runner, 0));
    // the crank: a housing and a little handle
    const cy = Math.min(1.15, top * 0.45);
    b.batch(new THREE.CylinderGeometry(0.034, 0.034, 0.09, 12), dark, matrix(0, cy, 0));
    bbox(b, 0.012, 0.012, 0.09, 0, cy - 0.006, 0.075, dark);
    bbox(b, 0.012, 0.05, 0.012, 0, cy - 0.044, 0.12, dark);
    canopy(b, 0, top, 0, R, rise, 8, clothOf(f), pole, runner);
  },
  parasol_cantilever: (b, w, d, h, f, _c, a) => {
    // a hanging parasol: a cross foot with weight slabs and the mast at one side, an arm
    // curving over to the middle, the canopy hanging from it
    const px = -w / 2 + 0.4;
    const R = Math.min(d / 2, (w / 2 - px - 0.1) / 2);
    const cx = w / 2 - R;
    const slab = mat("#5d6064", { roughness: 0.9 });
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) rbox(b, 0.36, 0.06, 0.36, px + sx * 0.2, 0.05, sz * 0.2, slab, 0.01);
    bbox(b, 0.8, 0.05, 0.07, px, 0, 0, a);
    bbox(b, 0.07, 0.05, 0.8, px, 0, 0, a);
    b.batch(new THREE.CylinderGeometry(0.045, 0.045, h - 0.1, 12), a, matrix(px, 0.05 + (h - 0.1) / 2, 0));
    b.batch(new THREE.SphereGeometry(0.05, 10, 6), a, matrix(px, h - 0.05, 0));
    // a crank half way up
    b.batch(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), a, matrix(px, 1.2, 0));
    bbox(b, 0.015, 0.015, 0.12, px, 1.19, 0.1, mat(C.black));
    const top = h - 0.18;
    const arm = new THREE.QuadraticBezierCurve3(v(px, h - 0.05, 0), v(cx - R * 0.3, h + 0.02, 0), v(cx, h - 0.06, 0));
    b.batch(new THREE.TubeGeometry(arm, 12, 0.03, 8, false), a);
    b.batch(new THREE.SphereGeometry(0.03, 8, 6), a, matrix(cx, h - 0.06, 0));
    limb(b, v(cx, h - 0.06, 0), v(cx, top, 0), 0.015, 0.015, a, 6, false);
    // a brace from the mast up to the arm
    limb(b, v(px, h - 0.7, 0), arm.getPoint(0.45), 0.018, 0.018, a, 6, false);
    const rise = Math.min(0.4, R * 0.28);
    canopy(b, cx, top, 0, R, rise, 8, clothOf(f), a);
  },
};
