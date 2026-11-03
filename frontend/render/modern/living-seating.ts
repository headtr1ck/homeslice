// More detailed built-in pieces: living seating. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import type { Build, Builder } from "../modern";
import { C, back, ledMat, mat, matrix, v } from "../modern";
import { FINISHES } from "../../model/modern";

// ----- soft shapes -----

interface Puff {
  /** Squareness per axis: 1 a sphere, towards 0 a box. */
  ex?: number;
  ey?: number;
  ez?: number;
  /** The top bulging up (crown > 0) or sinking in (< 0), as a fraction of the half height. */
  crown?: number;
  /** Thinner towards the edges in z (a throw pillow), 0..1. */
  pinch?: number;
  /** The ends curving forward in z by this much (metres) at x = ±w/2. */
  bend?: number;
  ws?: number;
  hs?: number;
  /** The axis through the sphere's poles (where its triangles fan): put it where it shows least. */
  pole?: "y" | "z";
}

/** A soft cushion fitted to w × h × d, centred on the origin: a squared-off sphere. */
function cushionGeo(w: number, h: number, d: number, o: Puff = {}): THREE.BufferGeometry {
  const { ex = 0.25, ey = 0.45, ez = 0.25, crown = 0, pinch = 0, bend = 0, ws = 14, hs = 10, pole = "y" } = o;
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  // (rounding noise such as sin(2π) ≈ −2e−16 must stay 0: raised to a small power it would
  // open a crack along the sphere's seam)
  const f = (t: number, e: number) => (Math.abs(t) < 1e-9 ? 0 : Math.sign(t) * Math.pow(Math.abs(t), e));
  for (let i = 0; i < p.count; i++) {
    const zp = pole === "z";
    const x = f(p.getX(i), ex);
    let y = f(zp ? p.getZ(i) : p.getY(i), ey);
    let z = f(zp ? p.getY(i) : p.getZ(i), ez);
    if (pinch) z *= 1 - pinch * (1 - (1 - x * x) * (1 - y * y));
    if (crown && y > 0) y += crown * (1 - x * x) * (1 - z * z) * y;
    p.setXYZ(i, (x * w) / 2, (y * h) / 2, (z * d) / 2 + bend * x * x);
  }
  if (pole === "z") g.index && g.setIndex(Array.from(g.index.array).map((_, i, a) => a[i - (i % 3) + [0, 2, 1][i % 3]]));
  g.computeVertexNormals();
  boxUV(g);
  return g;
}

/** Texture coordinates projected from the side each vertex faces (the fabric's weave stays even). */
function boxUV(g: THREE.BufferGeometry, scale = 1.6) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) * scale, p.getZ(i) * scale);
    else if (ax >= az) uv.setXY(i, p.getZ(i) * scale, p.getY(i) * scale);
    else uv.setXY(i, p.getX(i) * scale, p.getY(i) * scale);
  }
}

/** Adds a geometry placed at (x, y, z) turned by (rx, ry, rz), then moved by T. */
function put(b: Builder, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, T?: THREE.Matrix4) {
  const M = matrix(x, y, z, rx, ry, rz);
  if (T) M.premultiply(T);
  geo.applyMatrix4(M);
  return b.add(geo, m);
}

/** A finish's colour, darker (k < 1) or lighter (k > 1), for buttons and pillows. */
const tone = (color: string, k: number, extra: THREE.MeshStandardMaterialParameters = { roughness: 1 }) => {
  const c = new THREE.Color(FINISHES[color] ?? color);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color("#ffffff"), k - 1);
  return mat("#" + c.getHexString(), extra);
};

/** A throw pillow of size s leaning back at (x, y, z), turned by ry, tipped by rz. */
function pillow(b: Builder, s: number, x: number, y: number, z: number, m: THREE.Material, ry = 0, rz = 0, lean = -0.3) {
  put(b, cushionGeo(s, s, 0.16, { ex: 0.45, ey: 0.45, ez: 0.6, pinch: 0.6, ws: 10, hs: 8 }), m, x, y, z, lean, ry, rz);
}

/** Tapered legs (wood or metal) at the given floor points, splayed outward by `splay`. */
function sofaLegs(b: Builder, pts: [number, number][], legH: number, m: THREE.Material, r = 0.02, splay = 0) {
  for (const [x, z] of pts) {
    if (!splay) {
      b.cyl(r, r * 0.65, legH, x, 0, z, m, 10);
      continue;
    }
    const sx = Math.sign(x) || 1;
    const sz = Math.sign(z) || 1;
    b.rod(v(x - sx * splay, legH, z - sz * splay), v(x, 0, z), r * 0.8, m, 8);
  }
}

// ----- an upholstered run (sofa, armchair): base, back, arms, cushions -----

interface Run {
  L: number;
  D: number;
  h: number;
  armL: boolean;
  armR: boolean;
  /** Arm width. */
  aw?: number;
  legH: number;
  /** Seat cushions from x = seatL to seatR (default: between the arms). */
  seatL?: number;
  seatR?: number;
  n?: number;
  /** The back frame reaches this much further at the +x end (a corner). */
  backExt?: number;
  /** Arm shape: plump rounded, or slim square track arms. */
  arms?: "round" | "track";
  /** Buttons on the back cushions. */
  buttons?: THREE.Material;
  /** The base's height above the legs (default h × 0.24), the arms' top (default h × 0.77). */
  baseH?: number;
  armTop?: number;
}

function run(b: Builder, T: THREE.Matrix4, f: THREE.Material, o: Run) {
  const { L, D, h, armL, armR, legH, n: want, backExt = 0, arms = "round" } = o;
  const aw = o.aw ?? 0.17;
  const bt = 0.15; // back frame thickness
  const baseTop = legH + (o.baseH ?? h * 0.24);
  const seatTop = Math.max(h * 0.56, baseTop + 0.1);
  const armTop = o.armTop ?? h * 0.77;
  const backTop = h * 0.8;
  const sL = o.seatL ?? -L / 2 + (armL ? aw : 0);
  const sR = o.seatR ?? L / 2 - (armR ? aw : 0);
  // the base, its front a little rounded
  const inL = armL ? 0.015 : 0;
  const inR = armR ? 0.015 : 0;
  put(b, cushionGeo(L - inL - inR, baseTop - legH, D - 0.01, { ex: 0.12, ey: 0.3, ez: 0.12, ws: 10, hs: 8 }), f, (inL - inR) / 2, (legH + baseTop) / 2, -0.005, 0, 0, 0, T);
  // the back frame
  const bl = L + backExt;
  put(b, cushionGeo(bl, backTop - legH, bt, { ex: 0.1, ey: 0.25, ez: 0.4, ws: 10, hs: 6, pole: "z" }), f, backExt / 2, (legH + backTop) / 2, -D / 2 + bt / 2, 0, 0, 0, T);
  // the arms: plump with a rolled top, or slim and square
  for (const [on, sx] of [[armL, -1], [armR, 1]] as const) {
    if (!on) continue;
    const ah = armTop - legH;
    const geo = arms === "round" ? cushionGeo(aw, ah, D, { ex: 0.3, ey: 0.3, ez: 0.18, crown: 0.06, ws: 16, hs: 10, pole: "z" }) : cushionGeo(aw, ah, D, { ex: 0.12, ey: 0.15, ez: 0.12, ws: 10, hs: 8 });
    put(b, geo, f, sx * (L / 2 - aw / 2), legH + ah / 2, 0, 0, 0, 0, T);
  }
  // seat cushions, a little sat-in, and back cushions leaning on the back
  const len = sR - sL;
  const n = want ?? Math.max(1, Math.round(len / 0.78));
  const cw = len / n;
  const st = seatTop - baseTop;
  const sd = D - bt + 0.015;
  const bc = Math.min(0.22, D * 0.24);
  const bh = h - seatTop + 0.03;
  for (let i = 0; i < n; i++) {
    const x = sL + cw * (i + 0.5);
    put(b, cushionGeo(cw - 0.012, st, sd, { ex: 0.16, ey: 0.5, ez: 0.16, crown: -0.12, ws: 14, hs: 10 }), f, x, baseTop + st / 2, -D / 2 + bt + sd / 2 - 0.005, 0, 0, 0, T);
    put(b, cushionGeo(cw - 0.02, bh, bc, { ex: 0.3, ey: 0.3, ez: 0.55, crown: 0.06, ws: 12, hs: 10 }), f, x, seatTop + bh / 2 - 0.02, -D / 2 + bt + bc / 2 - 0.02, -0.14, 0, 0, T);
    if (o.buttons)
      for (const by of [0.3, 0.62])
        for (const bx of [-0.25, 0, 0.25]) {
          const q = v(x + bx * (cw - 0.02), seatTop - 0.02 + bh * by, -D / 2 + bt + bc - 0.035 + (bh * by - bh / 2) * -0.14).applyMatrix4(T);
          b.sphere(0.011, q.x, q.y, q.z, o.buttons, 1, 1, 1, 6);
        }
  }
  return { seatTop, armTop, backTop, baseTop, bt, bc, bh, aw, cw, n, sL };
}


// ----- the lounge chair and its ottoman: plywood shells, leather cushions, a star base -----

/** A star base of `n` tapered aluminium legs reaching radius r, a column up to y = top. */
function starBase(b: Builder, n: number, r: number, top: number, z = 0, turn = Math.PI / 2) {
  const metal = mat("#a9afb5", { metalness: 0.7, roughness: 0.3 });
  const dark = mat(C.black, { roughness: 0.6 });
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + turn;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const leg = new THREE.CylinderGeometry(0.012, 0.022, r - 0.03, 6, 1).toNonIndexed();
    leg.scale(1.6, 1, 1);
    leg.computeVertexNormals();
    put(b, leg, metal, (c * (r + 0.03)) / 2, 0.055, z + (s * (r + 0.03)) / 2, 0, -ang, Math.PI / 2 - 0.12);
    b.cyl(0.018, 0.02, 0.016, c * (r - 0.01), 0, z + s * (r - 0.01), dark, 10);
  }
  b.cyl(0.04, 0.04, 0.05, 0, 0.04, z, metal, 16);
  b.cyl(0.026, 0.03, top - 0.09, 0, 0.09, z, metal, 12);
}

/** Lengthwise along a leaning back: from (y0, z0), `t` metres up the lean, `off` in front. */
const leanAt = (y0: number, z0: number, lean: number, t: number, off = 0) => [y0 + t * Math.cos(lean) + off * Math.sin(lean), z0 - t * Math.sin(lean) + off * Math.cos(lean)] as const;

type Corner = "none" | "l" | "chaise";

/** A sofa (straight, L-shaped or with a chaise) of soft cushions on legs in the accent. */
function bigSofa(b: Builder, w: number, d: number, h: number, f: THREE.Material, color: string, corner: Corner, legM: THREE.Material) {
  const sd = Math.min(d, 0.95);
  const legH = h * 0.12;
  const zb = back(d);
  const aw = 0.17;
  const pil = mat(C.pillow, { roughness: 1 });
  const pil2 = tone(color, 0.72);
  const T0 = matrix(0, 0, zb + sd / 2);
  const legPts: [number, number][] = [
    [w / 2 - 0.07, zb + 0.07],
    [w / 2 - 0.07, zb + sd - 0.07],
  ];
  if (corner === "none") {
    const r = run(b, T0, f, { L: w, D: sd, h, armL: true, armR: true, aw, legH });
    legPts.push([-w / 2 + 0.07, zb + 0.07], [-w / 2 + 0.07, zb + sd - 0.07]);
    if (w > 1.9) legPts.push([0, zb + 0.07], [0, zb + sd - 0.07]);
    const py = r.seatTop + 0.2;
    pillow(b, 0.44, -w / 2 + aw + 0.27, py, zb + 0.36, pil, 0.25, -0.06);
    pillow(b, 0.4, -w / 2 + aw + 0.52, py - 0.02, zb + 0.4, pil2, 0.1, 0.08);
    pillow(b, 0.44, w / 2 - aw - 0.27, py, zb + 0.36, pil, -0.25, 0.06);
  } else if (corner === "l") {
    // the long run along the back, the short run along the left wall; one corner seat
    const bt = 0.15;
    const len = w - bt - aw;
    const n = Math.max(2, Math.round(len / 0.8));
    const cw = len / n + bt;
    const r = run(b, T0, f, { L: w, D: sd, h, armL: false, armR: true, aw, legH, seatL: -w / 2 + bt, n });
    const sl = d - sd;
    const T1 = matrix(-w / 2 + cw / 2, 0, zb + sd + sl / 2, 0, Math.PI / 2, 0);
    run(b, T1, f, { L: sl, D: cw, h, armL: true, armR: false, aw, legH, backExt: sd, seatR: sl / 2 });
    // the corner seat's second back cushion, against the side back
    const cz0 = zb + bt + r.bc - 0.02;
    const cz1 = zb + sd;
    put(b, cushionGeo(cz1 - cz0, r.bh, r.bc, { ex: 0.3, ey: 0.3, ez: 0.55, crown: 0.06 }), f, -w / 2 + bt + r.bc / 2 - 0.02, r.seatTop + r.bh / 2 - 0.02, (cz0 + cz1) / 2, -0.14, Math.PI / 2, 0);
    legPts.push([-w / 2 + 0.07, zb + 0.07], [-w / 2 + 0.07, d / 2 - 0.07], [-w / 2 + cw - 0.07, d / 2 - 0.07], [-w / 2 + cw - 0.07, zb + sd - 0.07]);
    if (w > 2.4) legPts.push([cw / 2, zb + 0.07], [cw / 2, zb + sd - 0.07]);
    const py = r.seatTop + 0.2;
    pillow(b, 0.46, -w / 2 + bt + 0.3, py, zb + bt + 0.3, pil, Math.PI / 4, 0);
    pillow(b, 0.42, -w / 2 + bt + 0.62, py - 0.02, zb + 0.4, pil2, 0.12, 0.08);
    pillow(b, 0.44, w / 2 - aw - 0.27, py, zb + 0.36, pil, -0.25, 0.06);
  } else {
    // a chaise at the left end: one long cushion, an arm along its outer side
    const cw = Math.min(0.9, w * 0.38);
    const r = run(b, T0, f, { L: w, D: sd, h, armL: false, armR: true, aw, legH, seatL: -w / 2 + cw });
    const ext = d - sd;
    const baseH = r.baseTop - legH;
    put(b, cushionGeo(cw, baseH, ext + 0.02, { ex: 0.12, ey: 0.3, ez: 0.12, ws: 10, hs: 6 }), f, -w / 2 + cw / 2, legH + baseH / 2, zb + sd + ext / 2 - 0.01);
    const ah = r.armTop - legH;
    put(b, cushionGeo(aw, ah, d, { ex: 0.3, ey: 0.3, ez: 0.12, crown: 0.06, ws: 16, hs: 10, pole: "z" }), f, -w / 2 + aw / 2, legH + ah / 2, 0);
    const st = r.seatTop - r.baseTop;
    const cl = d - r.bt + 0.01;
    put(b, cushionGeo(cw - aw - 0.012, st, cl, { ex: 0.16, ey: 0.5, ez: 0.1, crown: -0.12, ws: 14, hs: 12 }), f, -w / 2 + aw + (cw - aw) / 2, r.baseTop + st / 2, zb + r.bt + cl / 2 - 0.005);
    put(b, cushionGeo(cw - aw - 0.02, r.bh, r.bc, { ex: 0.3, ey: 0.3, ez: 0.55, crown: 0.06 }), f, -w / 2 + aw + (cw - aw) / 2, r.seatTop + r.bh / 2 - 0.02, zb + r.bt + r.bc / 2 - 0.02, -0.14);
    legPts.push([-w / 2 + 0.07, zb + 0.07], [-w / 2 + 0.07, d / 2 - 0.07], [-w / 2 + cw - 0.07, d / 2 - 0.07], [-w / 2 + cw - 0.07, zb + sd - 0.07]);
    const py = r.seatTop + 0.2;
    pillow(b, 0.44, -w / 2 + aw + 0.28, py, zb + 0.36, pil, 0.3, -0.06);
    pillow(b, 0.4, -w / 2 + aw + 0.55, py - 0.02, zb + 0.4, pil2, 0.1, 0.08);
    pillow(b, 0.44, w / 2 - aw - 0.27, py, zb + 0.36, pil, -0.25, 0.06);
  }
  sofaLegs(b, legPts, legH, legM, 0.02);
}

/** Scales a geometry to exactly w × h × d, standing on y = 0 and centred on x and z. */
function fit(g: THREE.BufferGeometry, w: number, h: number, d: number) {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const s = bb.getSize(new THREE.Vector3());
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.scale(w / s.x, h / s.y, d / s.z);
  g.computeVertexNormals();
  boxUV(g);
  return g;
}

/** A rocker: a band `t` high whose underside follows a circle of radius R (lowest at z = 0)
 *  from z0 to z1, tapering at its ends, `th` thick in x. */
function rockerGeo(R: number, z0: number, z1: number, t: number, th: number) {
  const s = new THREE.Shape();
  const n = 18;
  const yAt = (z: number) => R - Math.sqrt(R * R - z * z);
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    if (i) s.lineTo(z, yAt(z));
    else s.moveTo(z, yAt(z));
  }
  for (let i = n; i >= 0; i--) {
    const z = z0 + ((z1 - z0) * i) / n;
    s.lineTo(z, yAt(z) + t * (0.5 + 0.5 * Math.sin((Math.PI * i) / n)));
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -th / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

export const BUILDERS: Record<string, Build> = {
  sofa: (b, w, d, h, f, c, a) => bigSofa(b, w, d, h, f, c, "none", a),
  sofa_corner: (b, w, d, h, f, c, a) => bigSofa(b, w, d, h, f, c, "l", a),
  sofa_chaise: (b, w, d, h, f, c, a) => bigSofa(b, w, d, h, f, c, "chaise", a),
  lounge_chair: (b, w, d, h, f, _c, a) => {
    // the classic lounge chair: bent plywood shells, plump leather cushions, a low star base;
    // the seat tipped back and the back reclined
    const seatTop = Math.min(0.4, h * 0.47);
    const lean = 0.42;
    const tilt = -0.15;
    starBase(b, 5, Math.min(w, d) * 0.42, seatTop - 0.16, 0.04);
    // the seat: shell and cushion, tipped back
    const sw = w * 0.74;
    const sd = d * 0.58;
    put(b, cushionGeo(sw, 0.035, sd, { ex: 0.2, ey: 0.6, ez: 0.2, bend: -0.05, ws: 14, hs: 6 }), a, 0, seatTop - 0.11, 0.1, tilt);
    put(b, cushionGeo(sw - 0.02, 0.12, sd - 0.01, { ex: 0.32, ey: 0.5, ez: 0.3, crown: 0.25, bend: -0.05, ws: 16, hs: 10 }), f, 0, seatTop - 0.05, 0.11, tilt);
    // back and headrest, each a shell with its cushion, along the lean
    const y0 = seatTop - 0.1;
    const z0 = -d / 2 + 0.3;
    const avail = (h - y0) / Math.cos(lean) - 0.03;
    const bl = avail * 0.6;
    const hl = avail * 0.37;
    for (const [t0, len, cwid] of [[0, bl, w * 0.78], [bl + 0.012, hl, w * 0.66]] as const) {
      const [sy, sz] = leanAt(y0, z0, lean, t0 + len / 2, -0.05);
      put(b, cushionGeo(cwid, len, 0.035, { ex: 0.2, ey: 0.2, ez: 0.6, bend: 0.08, ws: 14, hs: 8, pole: "z" }), a, 0, sy, sz, -lean);
      const [cy, cz] = leanAt(y0, z0, lean, t0 + len / 2, 0.02);
      put(b, cushionGeo(cwid - 0.05, len - 0.02, 0.11, { ex: 0.35, ey: 0.35, ez: 0.5, crown: 0.1, bend: 0.08, ws: 14, hs: 10 }), f, 0, cy, cz, -lean);
    }
    // the spine joining seat and back, and the arms: a shell with a cushion on each side
    const metal = mat("#2f3134", { metalness: 0.5, roughness: 0.4 });
    const [my, mz] = leanAt(y0, z0, lean, bl * 0.4, -0.08);
    b.rod(v(0, seatTop - 0.13, z0 + 0.08), v(0, my, mz), 0.024, metal, 8);
    const ay = seatTop + 0.13;
    for (const sx of [-1, 1]) {
      const x = sx * Math.min(w / 2 - 0.045, w * 0.4);
      const pz0 = -d / 2 + 0.2;
      const pz1 = pz0 + d * 0.48;
      const [by, bz] = leanAt(y0, z0, lean, bl * 0.42, -0.06);
      b.rod(v(sx * w * 0.37, by, bz), v(x, ay - 0.03, pz0 + 0.06), 0.012, metal, 6);
      b.rod(v(x, ay - 0.03, pz1 - 0.12), v(sx * w * 0.36, seatTop - 0.11, pz1 - 0.12), 0.012, metal, 6);
      put(b, cushionGeo(0.1, 0.025, pz1 - pz0, { ex: 0.3, ey: 0.6, ez: 0.25, ws: 10, hs: 6 }), a, x, ay - 0.02, (pz0 + pz1) / 2, 0.06);
      put(b, cushionGeo(0.09, 0.05, pz1 - pz0 - 0.01, { ex: 0.4, ey: 0.6, ez: 0.3, ws: 10, hs: 8, pole: "z" }), f, x, ay + 0.015, (pz0 + pz1) / 2, 0.06);
    }
  },
  lounge_ottoman: (b, w, d, h, f, _c, a) => {
    starBase(b, 4, Math.min(w, d) * 0.42, h - 0.17, 0, Math.PI / 4);
    put(b, cushionGeo(w, 0.035, d, { ex: 0.2, ey: 0.6, ez: 0.2, bend: -0.03, ws: 14, hs: 6 }), a, 0, h - 0.15, 0, 0.06);
    put(b, cushionGeo(w - 0.03, 0.12, d - 0.03, { ex: 0.32, ey: 0.5, ez: 0.3, crown: 0.25, bend: -0.03, ws: 16, hs: 10 }), f, 0, h - 0.075, 0, 0.06);
  },
  armchair_wingback: (b, w, d, h, f, c, a) => {
    // tapered legs, a deep seat, rolled arms, wings and a buttoned high back
    const legH = 0.14;
    const seatTop = 0.46;
    const armTop = Math.min(0.64, h * 0.62);
    sofaLegs(b, [[-w / 2 + 0.07, d / 2 - 0.09], [w / 2 - 0.07, d / 2 - 0.09]], legH, a, 0.022);
    for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.08), legH, -d / 2 + 0.1), v(sx * (w / 2 - 0.06), 0, -d / 2 + 0.05), 0.016, a, 8);
    // the seat box and its thick cushion
    put(b, cushionGeo(w - 0.04, seatTop - 0.1 - legH, d - 0.06, { ex: 0.15, ey: 0.3, ez: 0.15, ws: 12, hs: 8 }), f, 0, legH + (seatTop - 0.1 - legH) / 2, 0.02);
    const aw = 0.13;
    put(b, cushionGeo(w - 2 * aw - 0.01, 0.12, d - 0.2, { ex: 0.2, ey: 0.5, ez: 0.2, crown: 0.25, ws: 14, hs: 10 }), f, 0, seatTop - 0.05, 0.08);
    // rolled arms: a panel with a roll on top and a scrolled front
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - aw / 2);
      put(b, cushionGeo(aw - 0.02, armTop - legH - 0.05, d - 0.18, { ex: 0.2, ey: 0.2, ez: 0.2, ws: 10, hs: 8, pole: "z" }), f, x - sx * 0.01, legH + (armTop - legH - 0.05) / 2, 0.06);
      const roll = new THREE.CylinderGeometry(aw * 0.55, aw * 0.55, d - 0.16, 16, 1);
      roll.rotateX(Math.PI / 2);
      b.add(roll, f, x + sx * 0.012, armTop - aw * 0.55, 0.06);
      b.cyl(aw * 0.42, aw * 0.42, 0.012, x + sx * 0.012, armTop - aw * 0.55, d / 2 - 0.02, tone(c, 0.82), 16).rotation.x = Math.PI / 2;
    }
    // the high back, its top arched, and the wings reaching forward
    const bt = 0.15;
    put(b, cushionGeo(w - 0.08, h - legH, bt, { ex: 0.2, ey: 0.25, ez: 0.4, crown: 0.06, ws: 14, hs: 10, pole: "z" }), f, 0, legH + (h - legH) / 2 - 0.012, -d / 2 + bt / 2);
    const bh = h - seatTop - 0.06;
    put(b, cushionGeo(w - 2 * aw - 0.02, bh, 0.12, { ex: 0.4, ey: 0.3, ez: 0.55, crown: 0.04, ws: 14, hs: 12, pole: "z" }), f, 0, seatTop + bh / 2 - 0.02, -d / 2 + bt + 0.04, -0.1);
    const btn = tone(c, 0.6);
    for (const [by, xs] of [[0.4, [-0.2, 0.2]], [0.7, [-0.3, 0, 0.3]]] as const)
      for (const bx of xs) b.sphere(0.012, bx * (w - 2 * aw), seatTop + bh * by - 0.02, -d / 2 + bt + 0.1 - (bh * by - bh / 2) * 0.1, btn, 1, 1, 0.6, 6);
    const wd = Math.min(0.36, d * 0.42);
    const wing = new THREE.Shape();
    wing.moveTo(0, 0);
    wing.lineTo(0, h - armTop - 0.06);
    wing.quadraticCurveTo(wd * 0.85, h - armTop - 0.04, wd, (h - armTop) * 0.55);
    wing.quadraticCurveTo(wd * 1.02, (h - armTop) * 0.15, wd * 0.82, 0);
    wing.lineTo(0, 0);
    for (const sx of [-1, 1]) {
      const geo = new THREE.ExtrudeGeometry(wing, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 8 });
      geo.rotateY(-Math.PI / 2);
      geo.computeVertexNormals();
      boxUV(geo);
      const m = b.add(geo, f, sx * (w / 2 - 0.035) + 0.025, armTop - 0.03, -d / 2 + 0.06);
      m.rotation.y = sx * 0.12;
    }
  },
  armchair: (b, w, d, h, f, _c, a) => {
    const legH = h * 0.13;
    run(b, matrix(0, 0, 0), f, { L: w, D: d, h, armL: true, armR: true, aw: Math.min(0.17, w * 0.2), legH, n: 1 });
    sofaLegs(b, [[-w / 2 + 0.07, -d / 2 + 0.07], [w / 2 - 0.07, -d / 2 + 0.07], [-w / 2 + 0.07, d / 2 - 0.07], [w / 2 - 0.07, d / 2 - 0.07]], legH, a, 0.02);
  },
  sofa_midcentury: (b, w, d, h, f, c, a) => {
    // slim track arms, a thin tailored seat, buttoned back cushions, a wooden rail on splayed legs
    const legH = Math.min(0.17, h * 0.22);
    const r = run(b, matrix(0, 0, 0), f, { L: w, D: d - 0.02, h, armL: true, armR: true, aw: 0.09, legH: legH + 0.03, baseH: h * 0.14, armTop: h * 0.7, arms: "track", buttons: tone(c, 0.6) });
    b.box(w - 0.06, 0.035, d - 0.08, 0, legH, 0, a, 0.008);
    const ix = w / 2 - 0.12;
    const iz = d / 2 - 0.12;
    sofaLegs(b, [[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]], legH, a, 0.022, 0.05);
    pillow(b, 0.4, -w / 2 + 0.36, r.seatTop + 0.19, -d / 2 + 0.34, mat(C.pillow, { roughness: 1 }), 0.2, -0.05);
  },
  sofa_modular: (b, w, d, h, f, c) => {
    // low deep modules on a dark recessed plinth: wide low arms, thick cushions, one per module
    const plinth = 0.04;
    const aw = Math.min(0.26, w * 0.09);
    const n = Math.max(2, Math.round((w - 2 * aw) / 0.85));
    const r = run(b, matrix(0, 0, 0), f, { L: w, D: d, h, armL: true, armR: true, aw, legH: plinth, baseH: h * 0.3, armTop: h * 0.66, arms: "track", n });
    b.box(w - 0.12, plinth, d - 0.12, 0, 0, 0, mat(C.black, { roughness: 0.8 }), 0.005);
    const py = r.seatTop + 0.21;
    pillow(b, 0.48, -w / 2 + aw + 0.3, py, -d / 2 + 0.42, mat(C.pillow, { roughness: 1 }), 0.25, -0.06);
    pillow(b, 0.44, -w / 2 + aw + 0.62, py - 0.02, -d / 2 + 0.45, tone(c, 0.72), 0.1, 0.08);
    pillow(b, 0.48, w / 2 - aw - 0.3, py, -d / 2 + 0.42, mat(C.pillow, { roughness: 1 }), -0.25, 0.06);
  },
  daybed: (b, w, d, h, f, c, a) => {
    // a wooden frame with slatted back and ends, a mattress, two bolsters and pillows along the back
    const legH = 0.1;
    const railTop = Math.min(0.26, h * 0.36);
    const endTop = h * 0.78;
    const t = 0.045;
    sofaLegs(b, [[-w / 2 + 0.05, -d / 2 + 0.05], [w / 2 - 0.05, -d / 2 + 0.05], [-w / 2 + 0.05, d / 2 - 0.05], [w / 2 - 0.05, d / 2 - 0.05]], legH, a, 0.024);
    b.box(w, railTop - legH, d, 0, legH, 0, a, 0.01);
    // posts, top rails and slats: the ends, then the back
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - t / 2);
      for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) b.box(t, (z < 0 ? h : endTop) - railTop, t, x, railTop, z, a, 0.006);
      b.box(t + 0.01, 0.045, d, x, endTop - 0.045, 0, a, 0.008);
      const ns = Math.max(3, Math.round(d / 0.13));
      for (let i = 1; i < ns; i++) b.box(0.018, endTop - railTop - 0.04, 0.03, x, railTop, -d / 2 + (d * i) / ns, a);
    }
    b.box(w, 0.05, t + 0.01, 0, h - 0.05, -d / 2 + t / 2, a, 0.008);
    const nb = Math.max(4, Math.round(w / 0.14));
    for (let i = 1; i < nb; i++) b.box(0.035, h - railTop - 0.05, 0.018, -w / 2 + (w * i) / nb, railTop, -d / 2 + t / 2, a);
    // the mattress, bolsters against the ends, pillows against the back
    const mt = 0.16;
    put(b, cushionGeo(w - 2 * t - 0.01, mt, d - t - 0.02, { ex: 0.12, ey: 0.35, ez: 0.12, crown: 0.05, ws: 16, hs: 8 }), f, 0, railTop + mt / 2 - 0.01, t / 2);
    const br = 0.1;
    for (const sx of [-1, 1]) put(b, cushionGeo(d - t - 0.12, 2 * br, 2 * br, { ex: 0.12, ey: 1, ez: 1, ws: 14, hs: 10 }), f, sx * (w / 2 - t - br - 0.005), railTop + mt + br - 0.03, t / 2 + 0.02, 0, Math.PI / 2);
    const py = railTop + mt + 0.2;
    const pil = mat(C.pillow, { roughness: 1 });
    pillow(b, 0.46, -w * 0.22, py, -d / 2 + t + 0.1, pil, 0.05, -0.04);
    pillow(b, 0.46, w * 0.22, py, -d / 2 + t + 0.1, pil, -0.05, 0.04);
    pillow(b, 0.4, 0, py - 0.03, -d / 2 + t + 0.14, tone(c, 0.72), 0, 0.02);
  },
  rocking_chair: (b, w, d, h, f) => {
    // two curved rockers, turned legs and stretchers, a saddled seat with a tied cushion, flat arms,
    // a spindle back under a curved crest rail
    const R = Math.max(1, d * 1.35);
    const t = 0.04;
    const zf = d * 0.2;
    const zb = -d * 0.22;
    const seatY = Math.min(0.43, h * 0.45);
    const armY = Math.min(0.64, h * 0.67);
    const lean = 0.16;
    const yr = (z: number) => R - Math.sqrt(R * R - z * z) + t * 0.85;
    const x0 = w / 2 - 0.04;
    for (const sx of [-1, 1]) {
      const x = sx * x0;
      put(b, rockerGeo(R, -d / 2, d / 2, t, 0.03), f, x, 0, 0);
      // front leg up to the arm, back leg on up as the back post, leaning back
      b.rod(v(x, yr(zf), zf), v(x, armY, zf + 0.01), 0.017, f, 10);
      b.rod(v(x, yr(zb), zb), v(x, h - 0.02, zb - (h - seatY) * Math.tan(lean)), 0.019, f, 10);
      b.cyl(0.024, 0.024, 0.04, x, seatY * 0.55, zf + 0.004, f, 10);
      // side stretcher and the arm, rounded at its front
      b.rod(v(x, 0.2, zf), v(x, 0.2, zb), 0.011, f, 8);
      const zArm = zb - (armY - seatY) * Math.tan(lean);
      b.box(0.06, 0.022, zf - zArm + 0.08, x + sx * 0.01, armY, (zf + zArm) / 2 + 0.035, f, 0.01);
    }
    b.rod(v(-x0, 0.2, zf), v(x0, 0.2, zf), 0.011, f, 8);
    b.rod(v(-x0, 0.24, zb), v(x0, 0.24, zb), 0.011, f, 8);
    // the seat, its front edge rounded, and a linen cushion tied to the back posts
    const sd = zf - zb + 0.06;
    put(b, cushionGeo(2 * x0 + 0.04, 0.035, sd, { ex: 0.12, ey: 0.4, ez: 0.12, crown: -0.15, ws: 12, hs: 6 }), f, 0, seatY - 0.0175, (zf + zb) / 2 + 0.01, -0.04);
    const lin = mat(C.linen, { roughness: 1 });
    put(b, cushionGeo(2 * x0 - 0.08, 0.045, sd - 0.06, { ex: 0.3, ey: 0.6, ez: 0.3, crown: 0.3, ws: 12, hs: 8 }), lin, 0, seatY + 0.022, (zf + zb) / 2 + 0.01, -0.04);
    // spindles and the crest rail, along the back's lean
    const top = h - 0.05;
    const back = (y: number) => zb - (y - seatY) * Math.tan(lean);
    const ns = 5;
    for (let i = 0; i < ns; i++) {
      const x = (i / (ns - 1) - 0.5) * (2 * x0 - 0.12);
      const bow = -0.02 * (1 - (x / x0) ** 2);
      b.rod(v(x, seatY, back(seatY) + 0.01 + bow), v(x, top - 0.02, back(top) + bow), 0.008, f, 6);
    }
    put(b, cushionGeo(2 * x0 + 0.04, 0.07, 0.03, { ex: 0.2, ey: 0.3, ez: 0.4, bend: 0.03, ws: 14, hs: 6, pole: "z" }), f, 0, top + 0.012, back(top) - 0.012, -lean);
    b.rod(v(-x0, armY + 0.06, back(armY + 0.06)), v(x0, armY + 0.06, back(armY + 0.06)), 0.012, f, 8);
  },
  egg_chair: (b, w, d, h, f, c, a) => {
    // a woven egg (an outer and inner skin, a rim round the opening, rattan bands) hanging on a
    // chain from an arched stand on a round foot; cushions inside
    const R = Math.min(w, d) * 0.42;
    const H = Math.min(R * 2.7, h * 0.6);
    const zc = 0.06;
    const top = h * 0.8;
    const cy = top - H / 2;
    const gap = Math.PI * 0.3;
    const N = 14;
    const rad = (k: number) => {
      const th = (Math.PI * k) / N;
      return Math.max(0.002, R * Math.sin(th) * (1 + 0.12 * Math.cos(th)));
    };
    const yAt = (k: number) => -(H / 2) * Math.cos((Math.PI * k) / N);
    const prof = (off: number) => Array.from({ length: N + 1 }, (_, k) => new THREE.Vector2(Math.max(0.001, rad(k) - off), yAt(k)));
    const outer = new THREE.LatheGeometry(prof(0), 24, gap, Math.PI * 2 - 2 * gap);
    const inner = new THREE.LatheGeometry(prof(0.03).reverse(), 24, gap, Math.PI * 2 - 2 * gap);
    const dark = tone(c, c === "black" ? 1.25 : 0.82);
    for (const g of [outer, inner]) {
      boxUV(g);
      b.add(g, f, 0, cy, zc);
    }
    // the rim round the opening: a closed loop down one edge and up the other
    const pts: THREE.Vector3[] = [];
    for (let k = 1; k < N; k++) pts.push(v(Math.sin(gap) * (rad(k) - 0.015), yAt(k), Math.cos(gap) * (rad(k) - 0.015)));
    for (let k = N - 1; k > 0; k--) pts.push(v(-Math.sin(gap) * (rad(k) - 0.015), yAt(k), Math.cos(gap) * (rad(k) - 0.015)));
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, 0.022, 6, true), dark, 0, cy, zc);
    // rattan bands round the outside
    for (let k = 2; k < N - 1; k += 2) {
      const ring = new THREE.TorusGeometry(rad(k) + 0.002, 0.006, 4, 20, Math.PI * 2 - 2 * gap).toNonIndexed();
      ring.rotateX(Math.PI / 2);
      ring.computeVertexNormals();
      ring.rotateY((Math.PI * 3) / 2 - gap);
      b.add(ring, dark, 0, cy + yAt(k), zc);
    }
    // cushions: a round seat and a back cushion against the inside
    const cush = mat(c === "white" ? "#8d9399" : C.linen, { roughness: 1 });
    const sk = N * 0.3;
    const sy = cy + yAt(sk);
    const sr = rad(sk) - 0.04;
    put(b, cushionGeo(2 * sr, 0.13, 2 * sr * 0.9, { ex: 0.6, ey: 0.45, ez: 0.6, crown: 0.2, ws: 18, hs: 8 }), cush, 0, sy + 0.05, zc + 0.02);
    put(b, cushionGeo(R * 1.2, H * 0.36, 0.14, { ex: 0.45, ey: 0.4, ez: 0.6, crown: 0.1, bend: 0.12, ws: 14, hs: 10, pole: "z" }), cush, 0, sy + 0.12 + H * 0.18, zc - R * 0.62, -0.18);
    // the stand: a round foot, an arch up the back and over, a hook and a chain
    const zb = zc - 0.05;
    b.cyl(0.3, 0.32, 0.035, 0, 0, zb, a, 32);
    b.cyl(0.06, 0.09, 0.05, 0, 0.035, zb, a, 16);
    const arch = new THREE.CatmullRomCurve3([v(0, 0.06, zb), v(0, 0.35, -d / 2 + 0.08), v(0, h * 0.62, -d / 2 + 0.03), v(0, h - 0.07, -d * 0.18), v(0, h - 0.05, zc - 0.02), v(0, h - 0.1, zc)]);
    b.add(new THREE.TubeGeometry(arch, 32, 0.026, 8), a);
    b.sphere(0.026, 0, h - 0.1, zc, a, 1, 1, 1, 10);
    const links = Math.max(2, Math.round((h - 0.12 - top) / 0.05));
    const step = (h - 0.12 - top) / links;
    for (let i = 0; i < links; i++) {
      const l = new THREE.TorusGeometry(0.016, 0.004, 4, 8).toNonIndexed();
      l.scale(0.7, 1.4, 1);
      l.computeVertexNormals();
      if (i % 2) l.rotateY(Math.PI / 2);
      b.add(l, mat(C.steel, { metalness: 0.7, roughness: 0.3 }), 0, h - 0.12 - step * (i + 0.5), zc);
    }
    b.cyl(0.03, 0.045, 0.03, 0, top - 0.015, zc, dark, 12);
  },
  bean_bag: (b, w, d, h, f) => {
    // a soft sack: six panels with seams, a dip where one sits, the back pushed up, folds round the foot
    const g = new THREE.SphereGeometry(1, 30, 18);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      const ang = Math.atan2(z, x);
      const k = (1 - 0.07 * Math.pow(Math.abs(Math.cos(3 * ang + 0.5)), 16)) * (1 + 0.03 * Math.sin(7 * ang + 3 * y) * (1 - y * y));
      x *= k;
      z *= k;
      if (y < -0.45) y = -0.45 - (y + 0.45) * 0.15;
      // the seat: the front of the top pressed down; the back stays up as a backrest
      if (y > -0.2) y -= 0.85 * (y + 0.2) * Math.max(0, z + 0.05) ** 1.3;
      if (z < 0) y += 0.18 * -z * Math.max(0, y + 0.3);
      p.setXYZ(i, x, y, z);
    }
    b.add(fit(g, w, h, d), f);
  },
  pouf: (b, w, d, h, f, c) => {
    // a round knitted pouf: bulging sides, ribs all round, a dimple and button on top
    const g = new THREE.SphereGeometry(1, 48, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const s = Math.hypot(x, z);
      const ang = Math.atan2(z, x);
      const yy = Math.sign(y) * Math.pow(Math.abs(y), 0.55);
      const ss = s > 1e-6 ? Math.pow(s, 0.3) * (1 + 0.04 * Math.cos(16 * ang) * (1 - Math.abs(yy) ** 6)) : 0;
      const k = s > 1e-6 ? ss / s : 0;
      p.setXYZ(i, x * k, yy - (yy > 0 ? 0.12 * (1 - ss) ** 2 : 0), z * k);
    }
    b.add(fit(g, w, h, d), f);
    b.sphere(0.022, 0, h - 0.11 * (h / 2) - 0.004, 0, tone(c, 0.75), 1, 0.5, 1, 10);
  },
  record_player: (b, w, d, h, f) => {
    // a plinth on feet, a platter with a record that turns while it plays, a tone arm with its
    // counterweight, rest and headshell, speed buttons and a light, dust-cover hinges at the back
    const black = mat(C.black, { roughness: 0.6 });
    const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
    const feet = 0.012;
    const ph = h * 0.48;
    const top = feet + ph;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.018, 0.02, feet, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04), black, 12);
    b.box(w, ph, d, 0, feet, 0, f, 0.008);
    const r = Math.min(w * 0.42, d * 0.43);
    const px = -w / 2 + r + 0.025;
    b.cyl(r * 0.97, r * 0.97, 0.006, px, top, 0, black, 40);
    b.cyl(r, r, 0.01, px, top + 0.004, 0, mat(C.steel, { metalness: 0.6, roughness: 0.35 }), 40);
    b.spinner(px, top + 0.014, 0, "y", () => {
      b.cyl(r * 0.96, r * 0.96, 0.003, px, top + 0.014, 0, mat("#141414", { roughness: 0.35 }), 40);
      b.cyl(r * 0.6, r * 0.6, 0.0035, px, top + 0.014, 0, mat("#202020", { roughness: 0.2 }), 32);
      b.cyl(r * 0.3, r * 0.3, 0.004, px, top + 0.014, 0, mat("#c0392b"), 20);
      b.box(r * 0.25, 0.0005, r * 0.06, px + r * 0.13, top + 0.018, 0, mat(C.pillow));
      b.cyl(0.004, 0.004, 0.012, px, top + 0.014, 0, chrome, 8);
    });
    // the tone arm: pivot, counterweight behind, the arm reaching over the record's edge
    const ax = w / 2 - 0.055;
    const az = -d / 2 + 0.07;
    const ay = top + 0.032;
    b.cyl(0.024, 0.026, 0.01, ax, top, az, black, 16);
    b.cyl(0.009, 0.011, 0.026, ax, top + 0.01, az, chrome, 12);
    const tip = v(px + r * 0.62, ay - 0.012, r * 0.35);
    const dir = tip.clone().sub(v(ax, ay, az)).normalize();
    b.rod(v(ax, ay, az).addScaledVector(dir, -0.045), tip, 0.0035, chrome, 6);
    b.rod(v(ax, ay, az).addScaledVector(dir, -0.065), v(ax, ay, az).addScaledVector(dir, -0.04), 0.012, chrome, 14);
    const head = b.box(0.014, 0.006, 0.03, tip.x, tip.y - 0.006, tip.z, black, 0.002);
    head?.rotation.set(0, Math.atan2(dir.x, dir.z) + 0.4, 0);
    b.cyl(0.004, 0.004, 0.03, ax - 0.006, top, az + 0.06, chrome, 8);
    b.box(0.012, 0.005, 0.012, ax - 0.006, top + 0.03, az + 0.06, black);
    // speed buttons and a start button with its light, front right
    for (const [i, x] of [[0, w / 2 - 0.1], [1, w / 2 - 0.07]] as const) b.cyl(0.009, 0.009, 0.005, x, top, d / 2 - 0.035, i ? chrome : black, 14);
    b.box(0.03, 0.005, 0.02, w / 2 - 0.035, top, d / 2 - 0.035, chrome, 0.002);
    b.box(0.006, 0.002, 0.006, w / 2 - 0.13, top, d / 2 - 0.035, ledMat("#e04a3a"));
    for (const sx of [-1, 1]) b.box(0.04, 0.016, 0.014, sx * w * 0.3, top - 0.01, -d / 2 - 0.004, black, 0.003);
  },
  game_console: (b, w, d, h, f, c) => {
    // a console lying flat (two shells round a dark vented band, a disc slot, ports and a light),
    // and its controller in front
    const black = mat(C.black, { roughness: 0.5 });
    const trim = c === "black" ? mat("#3a3c40", { roughness: 0.45 }) : black;
    const bd = d * 0.66;
    const bz = -d / 2 + bd / 2;
    const feet = 0.006;
    const sh = (h - feet) * 0.44;
    for (const sx of [-1, 1]) b.box(w - 0.06, feet, 0.02, 0, 0, bz + sx * (bd / 2 - 0.03), black);
    b.box(w, sh, bd, 0, feet, bz, f, 0.012);
    b.box(w - 0.012, h - feet - 2 * sh + 0.01, bd - 0.012, 0, feet + sh - 0.005, bz, black, 0.004);
    b.box(w, sh, bd, 0, h - sh, bz, f, 0.012);
    for (let i = 0; i < 9; i++) b.box(0.012, h - feet - 2 * sh, 0.002, -w / 2 + 0.06 + i * 0.022, feet + sh, bz + bd / 2 - 0.004, trim);
    b.box(w * 0.4, 0.003, 0.002, w * 0.18, feet + sh * 0.5, bz + bd / 2 + 0.0005, black);
    for (const x of [-w * 0.36, -w * 0.3]) b.box(0.012, 0.005, 0.002, x, h - sh * 0.55, bz + bd / 2 + 0.0005, black);
    b.box(0.02, 0.003, 0.002, w * 0.38, h - sh * 0.55, bz + bd / 2 + 0.0008, ledMat("#3fa8ff"));
    // the controller: a body with two grips, sticks, a cross, four buttons and a touch pad
    const cw = Math.min(0.15, w * 0.52);
    const cd = Math.min(0.065, d - bd - 0.02);
    const cx = w * 0.12;
    const cz = d / 2 - cd / 2 - 0.012;
    const ch = 0.022;
    put(b, cushionGeo(cw * 0.7, ch, cd, { ex: 0.3, ey: 0.4, ez: 0.3, ws: 12, hs: 6 }), f, cx, ch / 2 + 0.006, cz);
    for (const sx of [-1, 1]) {
      const grip = new THREE.CapsuleGeometry(0.017, cd * 0.55, 3, 10);
      grip.rotateX(Math.PI / 2 - 0.25);
      put(b, grip, f, cx + sx * cw * 0.33, 0.017, cz + 0.01, 0, sx * 0.3, 0);
      b.cyl(0.008, 0.007, 0.01, cx + sx * cw * 0.12, ch + 0.004, cz + 0.012, black, 10);
    }
    b.box(0.012, 0.003, 0.004, cx - cw * 0.26, ch + 0.004, cz - 0.008, black);
    b.box(0.004, 0.003, 0.012, cx - cw * 0.26, ch + 0.004, cz - 0.008, black);
    for (const [bx, bz2] of [[0, -0.007], [0, 0.007], [-0.007, 0], [0.007, 0]]) b.cyl(0.003, 0.003, 0.003, cx + cw * 0.26 + bx, ch + 0.004, cz - 0.008 + bz2, trim, 8);
    b.box(cw * 0.3, 0.002, cd * 0.35, cx, ch + 0.0035, cz - cd * 0.18, trim, 0.001);
  },
};
