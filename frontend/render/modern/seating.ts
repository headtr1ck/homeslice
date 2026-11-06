// Built-in pieces added later: seating. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import * as THREE from "three";
import type { Build, Builder } from "../modern";
import { C, mat, matrix, v, wickerMat } from "../modern";
import { fabricTexture, finishLook } from "../finishes";
import { FINISHES } from "../../model/modern";

type M = THREE.Material;

// ----- soft shapes (as in living-seating.ts) -----

interface Puff {
  /** Squareness per axis: 1 a sphere, towards 0 a box. */
  ex?: number;
  ey?: number;
  ez?: number;
  /** The top bulging up (crown > 0) or sinking in (< 0), as a fraction of the half height. */
  crown?: number;
  /** The ends curving forward in z by this much (metres) at x = ±w/2. */
  bend?: number;
  ws?: number;
  hs?: number;
  /** The axis through the sphere's poles (where its triangles fan): put it where it shows least. */
  pole?: "y" | "z";
}

/** A soft cushion fitted to w × h × d, centred on the origin: a squared-off sphere. */
function cushionGeo(w: number, h: number, d: number, o: Puff = {}): THREE.BufferGeometry {
  const { ex = 0.25, ey = 0.45, ez = 0.25, crown = 0, bend = 0, ws = 14, hs = 10, pole = "y" } = o;
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  const f = (t: number, e: number) => (Math.abs(t) < 1e-9 ? 0 : Math.sign(t) * Math.pow(Math.abs(t), e));
  for (let i = 0; i < p.count; i++) {
    const zp = pole === "z";
    const x = f(p.getX(i), ex);
    let y = f(zp ? p.getZ(i) : p.getY(i), ey);
    const z = f(zp ? p.getY(i) : p.getZ(i), ez);
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
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
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

/** Adds a geometry placed at (x, y, z) turned by (rx, ry, rz). */
function put(b: Builder, geo: THREE.BufferGeometry, m: M, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  geo.applyMatrix4(matrix(x, y, z, rx, ry, rz));
  return b.add(geo, m);
}

/** A finish's colour, darker (k < 1) or lighter (k > 1). */
const tone = (color: string, k: number, extra: THREE.MeshStandardMaterialParameters = { roughness: 1 }) => {
  const c = new THREE.Color(FINISHES[color] ?? color);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color("#ffffff"), k - 1);
  return mat("#" + c.getHexString(), extra);
};

/**
 * Leather in a finish's colour: smooth with a soft sheen. Every tone (the main hide, darker
 * panels, buttons) is the colour scaled the same way, so black stays black, just a touch lifted.
 */
const leather = (color: string, k = 1) => {
  const c = new THREE.Color(FINISHES[color] ?? color).multiplyScalar(color === "black" ? 1.15 * k : k);
  return mat("#" + c.getHexString(), { roughness: 0.42 });
};

const accentFabrics = new Map<string, THREE.MeshStandardMaterial>();
/** The accent as upholstery (a cushion in one of the fabric colours). */
function accentFabric(color: string, fallback: M): M {
  let m = accentFabrics.get(color);
  if (m) return m;
  const tex = fabricTexture(FINISHES[color] ?? color);
  if (!tex) return fallback;
  accentFabrics.set(color, (m = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })));
  return m;
}

/** Small low-poly studs (buttons, nailheads) at the given points, merged into one mesh. */
function studs(b: Builder, pts: THREE.Vector3[], r: number, m: M, flat = 0.6, ry = 0, tiny = false) {
  for (const p of pts) {
    const g = tiny ? new THREE.OctahedronGeometry(r, 0) : new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 1, flat);
    b.batch(g, m, matrix(p.x, p.y, p.z, 0, ry, 0));
  }
}

/** Tapered legs at the given floor points, splayed outward by `splay`. */
function taperLegs(b: Builder, pts: [number, number][], legH: number, m: M, r = 0.02, splay = 0) {
  for (const [x, z] of pts) {
    if (!splay) {
      b.cyl(r, r * 0.6, legH, x, 0, z, m, 10);
      continue;
    }
    const sx = Math.sign(x) || 1;
    const sz = Math.sign(z) || 1;
    const top = v(x - sx * splay, legH, z - sz * splay);
    const foot = v(x, 0, z);
    const mesh = b.add(new THREE.CylinderGeometry(r, r * 0.6, top.distanceTo(foot), 8), m);
    mesh.position.copy(top).add(foot).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
  }
}

/**
 * A tufted pad facing +z: w × h, up to `depth` thick, pulled in at buttons on a diamond grid
 * (`cols` in the even rows, one fewer between them in the odd rows). Returns the geometry
 * and where its buttons sit.
 */
function tuftPad(w: number, h: number, depth: number, cols: number, rows: number, pull = 0.55) {
  const sx = Math.max(10, cols * 4);
  const sy = Math.max(6, (rows + 1) * 3);
  const g = new THREE.PlaneGeometry(w, h, sx, sy);
  const dimples: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const y = -h / 2 + (h * (r + 1)) / (rows + 1);
    if (r % 2 === 0) for (let c = 0; c < cols; c++) dimples.push([-w / 2 + (w * (c + 0.5)) / cols, y]);
    else for (let c = 0; c < cols - 1; c++) dimples.push([-w / 2 + (w * (c + 1)) / cols, y]);
  }
  const sig = Math.min(w / cols, h / (rows + 1)) * 0.28;
  const zAt = (x: number, y: number) => {
    const ex = Math.max(0, 1 - Math.pow((2 * x) / w, 8));
    const ey = Math.max(0, 1 - Math.pow((2 * y) / h, 8));
    let dip = 0;
    for (const [dx, dy] of dimples) dip += Math.exp(-((x - dx) ** 2 + (y - dy) ** 2) / (sig * sig));
    return depth * Math.sqrt(ex * ey) * (1 - pull * Math.min(1, dip));
  };
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, zAt(p.getX(i), p.getY(i)));
  g.computeVertexNormals();
  boxUV(g);
  return { geo: g, buttons: dimples.map(([x, y]) => v(x, y, zAt(x, y))) };
}

/** Places a tufted pad (and its buttons, in `btn`) by a matrix. */
function pad(b: Builder, T: THREE.Matrix4, f: M, btn: M, w: number, h: number, depth: number, cols: number, rows: number, pull?: number, br = 0.011) {
  const { geo, buttons } = tuftPad(w, h, depth, cols, rows, pull);
  geo.applyMatrix4(T);
  b.add(geo, f);
  const ry = new THREE.Euler().setFromRotationMatrix(T, "YXZ").y;
  studs(b, buttons.map((p) => p.applyMatrix4(T)), br, btn, 0.55, ry);
}

// ----- a curved upholstered wall: a tub's back flowing into its arms -----

interface Shell {
  /** The wall's middle line: half an ellipse rx × rz around (0, zc), from −A to +A (0 at the back). */
  rx: number;
  rz: number;
  zc: number;
  A: number;
  /** Thickness, bottom, and the top at s = |θ| / A (0 at the back, 1 at the arm ends). */
  t: number;
  y0: number;
  top: (s: number) => number;
  segs?: number;
  /** Vertical channels on the inside: how many, and how deep (fraction of the thickness). */
  channels?: number;
  deep?: number;
}

/** The wall as a closed sweep (rounded top) with flat ends at the arm fronts. */
function shellGeo(o: Shell): THREE.BufferGeometry[] {
  const { rx, rz, zc, A, t, y0, top, channels = 0, deep = 0.5 } = o;
  const S = o.segs ?? (channels ? channels * 6 : 28);
  const r = t / 2;
  const K = 8;
  const prof = (T: number): [number, number][] => {
    const mid = (y0 + T - r) / 2;
    const pts: [number, number][] = [[-r, y0], [-r, mid]];
    for (let k = 0; k <= K; k++) {
      const a = Math.PI - (Math.PI * k) / K;
      pts.push([r * Math.cos(a), T - r + r * Math.sin(a)]);
    }
    pts.push([r, mid], [r, y0]);
    return pts;
  };
  const P = prof(1).length;
  const pos: number[] = [];
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= S; i++) {
    const th = -A + (2 * A * i) / S;
    const px = rx * Math.sin(th);
    const pz = zc - rz * Math.cos(th);
    const nn = v(Math.sin(th) / rx, 0, -Math.cos(th) / rz).normalize();
    const bump = channels ? Math.abs(Math.sin((channels * Math.PI * (th + A)) / (2 * A))) : 0;
    const ring: THREE.Vector3[] = [];
    for (const [n, y] of prof(top(Math.abs(th) / A))) {
      const nk = n < 0 ? n * (1 + deep * bump * Math.min(1, (y - y0) / 0.12)) : n;
      const q = v(px + nn.x * nk, y, pz + nn.z * nk);
      ring.push(q);
      pos.push(q.x, q.y, q.z);
    }
    rings.push(ring);
  }
  const idx: number[] = [];
  for (let i = 0; i < S; i++)
    for (let j = 0; j < P; j++) {
      const a = i * P + j;
      const b2 = (i + 1) * P + j;
      const c = (i + 1) * P + ((j + 1) % P);
      const d = i * P + ((j + 1) % P);
      idx.push(a, b2, c, a, c, d);
    }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  boxUV(body);
  // the ends: a fan over each end ring, facing along the wall
  const caps: number[] = [];
  for (const [i, dir] of [[0, -1], [S, 1]] as const) {
    const ring = rings[i];
    const c = ring.reduce((s, q) => s.add(q), v(0, 0, 0)).multiplyScalar(1 / P);
    const along = rings[dir > 0 ? i : i + 1][0].clone().sub(rings[dir > 0 ? i - 1 : i][0]).multiplyScalar(dir);
    for (let j = 0; j < P; j++) {
      const p1 = ring[j];
      const p2 = ring[(j + 1) % P];
      const n = p1.clone().sub(c).cross(p2.clone().sub(c));
      const [a, b2] = n.dot(along) > 0 ? [p1, p2] : [p2, p1];
      caps.push(c.x, c.y, c.z, a.x, a.y, a.z, b2.x, b2.y, b2.z);
    }
  }
  const cap = new THREE.BufferGeometry();
  cap.setAttribute("position", new THREE.Float32BufferAttribute(caps, 3));
  cap.computeVertexNormals();
  boxUV(cap);
  return [body, cap];
}

const shell = (b: Builder, o: Shell, f: M) => shellGeo(o).forEach((g) => b.add(g, f));

/**
 * Narrows a cushion (already placed) from the sides so it stays inside a shell's inner wall:
 * the half ellipse rx × rz around (0, zc), as far forward as the arm ends at angle A.
 */
function fitInside(g: THREE.BufferGeometry, rx: number, rz: number, zc: number, A: number) {
  const p = g.attributes.position;
  const zEnd = zc - rz * Math.cos(A);
  let half = 0;
  for (let i = 0; i < p.count; i++) half = Math.max(half, Math.abs(p.getX(i)));
  // squeezed across in proportion (not clipped), so no face folds over
  for (let i = 0; i < p.count; i++) {
    const z = Math.min(p.getZ(i), zEnd);
    const u = (z - zc) / rz;
    const lim = rx * Math.sqrt(Math.max(0, 1 - Math.min(1, u * u)));
    if (half > lim) p.setX(i, (p.getX(i) * lim) / half);
  }
  g.computeVertexNormals();
  boxUV(g);
  return g;
}

/** Leg feet spread round an elliptical base (half axes ex × ez), at ±45° off the axes. */
const ovalFeet = (ex: number, ez: number, k = 0.7): [number, number][] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [sx * ex * k, sz * ez * k]);

/** A smooth step from 0 at a to 1 at b. */
const step = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ----- masonry -----

const brickMats = new Map<string, THREE.MeshStandardMaterial>();
/** Red brick (the wall finish's texture, in metres). */
function brick(): THREE.MeshStandardMaterial {
  let m = brickMats.get("red");
  if (m) return m;
  const look = finishLook("brick_red");
  m = look.map ? new THREE.MeshStandardMaterial({ map: look.map, roughness: 0.9 }) : mat(FINISHES.terracotta, { roughness: 0.9 });
  brickMats.set("red", m);
  return m;
}

/** A box from its bottom centre, its texture (if any) in the piece's metres so courses line up. */
function block(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  if ((m as THREE.MeshStandardMaterial).map) g.deleteAttribute("uv");
  return b.add(g, m);
}

/** A clay chimney pot: a flared foot, a tapering body and a rolled rim. */
function chimneyPot(b: Builder, r: number, ph: number, x: number, y: number, z: number, m: M) {
  const pts = [
    [0.001, 0],
    [r * 1.15, 0],
    [r * 1.15, ph * 0.08],
    [r, ph * 0.14],
    [r * 0.82, ph * 0.85],
    [r * 0.9, ph * 0.88],
    [r * 0.92, ph * 0.97],
    [r * 0.84, ph],
    [r * 0.7, ph],
    [r * 0.7, ph * 0.9],
  ].map(([a, c]) => new THREE.Vector2(a, c));
  b.add(new THREE.LatheGeometry(pts, 16), m, x, y, z);
  b.cyl(r * 0.69, r * 0.69, 0.01, x, y + ph * 0.86, z, mat("#1d1b1a", { roughness: 1 }), 12);
}

export const BUILDERS: Record<string, Build> = {
  armchair_club: (b, w, d, h, _f, c) => {
    // a deep leather club chair: thick rolled arms, a low wrapped back with a buttoned inside,
    // a plump seat cushion, short turned feet
    const L = leather(c);
    const dark = leather(c, 0.78);
    const btn = leather(c, 0.55);
    const wood = mat("#3b2a1e", { roughness: 0.5 });
    const legH = Math.min(0.07, h * 0.1);
    const baseTop = h * 0.4;
    const seatTop = Math.min(0.45, h * 0.57);
    const armTop = h * 0.77;
    const aw = Math.min(0.21, w * 0.23);
    const bt = Math.min(0.2, d * 0.22);
    // feet: short and turned
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.08);
        const z = sz * (d / 2 - 0.08);
        b.cyl(0.032, 0.024, legH, x, 0, z, wood, 12);
        b.sphere(0.034, x, legH * 0.7, z, wood, 1, 0.45, 1, 12);
      }
    // the base, its front softly rounded
    put(b, cushionGeo(w - 0.04, baseTop - legH, d - 0.02, { ex: 0.18, ey: 0.35, ez: 0.18, ws: 12, hs: 8 }), L, 0, (legH + baseTop) / 2, 0);
    // the back: an outer shell wrapping forward a little, a buttoned inner back leaning on it
    put(b, cushionGeo(w - 0.03, h - legH, bt, { ex: 0.3, ey: 0.3, ez: 0.45, crown: 0.05, bend: 0.04, ws: 16, hs: 10, pole: "z" }), L, 0, legH + (h - legH) / 2 - 0.005, -d / 2 + bt / 2);
    const iw = w - 2 * aw - 0.01;
    const ih = h - seatTop - 0.02;
    pad(b, matrix(0, seatTop - 0.05 + ih / 2, -d / 2 + bt - 0.02, -0.12), L, btn, iw + 0.07, ih, 0.08, 4, 3, 0.55, 0.01);
    // the arms: deep, rolled outward along the top, a darker panel on the front
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - aw / 2);
      const ah = armTop - legH - aw * 0.3;
      put(b, cushionGeo(aw - 0.02, ah, d - 0.04, { ex: 0.3, ey: 0.25, ez: 0.22, ws: 12, hs: 8 }), L, x - sx * 0.008, legH + ah / 2, 0.01);
      put(b, cushionGeo(aw, aw * 0.62, d - 0.03, { ex: 0.6, ey: 0.6, ez: 0.2, crown: 0.1, ws: 14, hs: 10, pole: "z" }), L, x, armTop - aw * 0.31, 0.012);
      put(b, cushionGeo(aw * 0.78, armTop - legH - 0.08, 0.02, { ex: 0.3, ey: 0.2, ez: 0.5, ws: 10, hs: 6, pole: "z" }), dark, x, legH + (armTop - legH) / 2, d / 2 - 0.015);
    }
    // the seat cushion, thick and crowned, its front over the base
    const sd = d - bt - 0.01;
    put(b, cushionGeo(iw - 0.005, seatTop - baseTop + 0.02, sd, { ex: 0.2, ey: 0.5, ez: 0.2, crown: 0.3, ws: 14, hs: 10 }), L, 0, (baseTop + seatTop) / 2, -d / 2 + bt + sd / 2 - 0.01);
  },

  armchair_cocktail: (b, w, d, h, f, _c, a) => {
    // a small tub chair: one curved back sweeping down into the arms, a round seat cushion, an
    // upholstered deck on slim splayed legs
    const legH = Math.min(0.17, h * 0.22);
    const seatTop = Math.min(0.52, h * 0.6);
    const deck = seatTop - Math.max(0.09, (seatTop - legH) * 0.35);
    const armTop = Math.min(0.62 * Math.max(1, h / 0.78), h * 0.79);
    const t = 0.09;
    const A = Math.PI * 0.6;
    const rx = w / 2 - t / 2;
    const rz = d * 0.56 - t / 2;
    const zc = -d / 2 + t / 2 + rz;
    shell(b, { rx, rz, zc, A, t, y0: legH + 0.04, top: (s) => h - (h - armTop) * step(0.25, 0.85, s) }, f);
    put(b, cushionGeo(w - 0.03, deck - legH, d - 0.03, { ex: 1, ey: 0.25, ez: 1, ws: 28, hs: 8 }), f, 0, (legH + deck) / 2, 0.005);
    const sw = 2 * rx - t;
    const sd = d / 2 - (zc - rz + t / 2) - 0.01;
    const seat = cushionGeo(sw, seatTop - deck + 0.03, sd, { ex: 0.5, ey: 0.5, ez: 0.45, crown: 0.3, ws: 16, hs: 10 });
    seat.translate(0, (deck + seatTop) / 2, d / 2 - sd / 2 - 0.01);
    b.add(fitInside(seat, rx - t / 2 - 0.004, rz - t / 2 - 0.004, zc, A), f);
    // a loose back cushion inside the curve
    put(b, cushionGeo(sw * 0.7, (h - seatTop) * 0.7, 0.1, { ex: 0.4, ey: 0.4, ez: 0.6, crown: 0.1, bend: 0.05, ws: 14, hs: 10 }), f, 0, seatTop + (h - seatTop) * 0.36, zc - rz + t / 2 + 0.05, -0.15);
    // legs under the oval deck, splayed out
    const splay = 0.03 * Math.min(1.4, legH / 0.17);
    taperLegs(b, ovalFeet(w / 2 - 0.015, d / 2 - 0.015, 0.74), legH + 0.01, a, 0.017 * Math.max(1, Math.min(1.3, w / 0.7)), splay);
  },

  recliner: (b, w, d, h, f, c) => {
    // a padded recliner: a recessed plinth, chunky arms with padded tops, a thick seat, the
    // folded footrest across the front, a reclined back of three pillow rolls, a pull handle
    const plinth = 0.04;
    const aw = Math.min(0.26, w * 0.235);
    const k = Math.min(1.5, Math.max(0.75, d / 0.95));
    const baseTop = Math.min(0.36, h * 0.34);
    const seatTop = Math.min(0.5, h * 0.48);
    const armTop = Math.min(0.64, h * 0.6);
    const lean = 0.24;
    b.box(w - 0.12, plinth, d - 0.2, 0, 0, 0, mat(C.black, { roughness: 0.8 }), 0.005);
    // the base between the arms and the footrest folded against its front
    const iw = w - 2 * aw + 0.02;
    put(b, cushionGeo(iw, baseTop - plinth, d - 0.1, { ex: 0.15, ey: 0.3, ez: 0.15, ws: 10, hs: 8 }), f, 0, (plinth + baseTop) / 2, -0.03);
    put(b, cushionGeo(iw - 0.04, baseTop - plinth - 0.05, 0.07, { ex: 0.25, ey: 0.3, ez: 0.5, crown: 0.05, ws: 12, hs: 8, pole: "z" }), f, 0, plinth + 0.03 + (baseTop - plinth - 0.05) / 2, d / 2 - 0.04);
    // chunky arms with a padded top roll
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - aw / 2 - 0.006);
      const ah = armTop - plinth - 0.05;
      put(b, cushionGeo(aw - 0.01, ah, d - 0.08, { ex: 0.28, ey: 0.2, ez: 0.22, ws: 12, hs: 8 }), f, x, plinth + ah / 2, 0.02);
      put(b, cushionGeo(aw, 0.11, d - 0.06, { ex: 0.5, ey: 0.55, ez: 0.25, crown: 0.15, ws: 14, hs: 8, pole: "z" }), f, x, armTop - 0.055, 0.025);
    }
    // the seat: thick, its front rolled over the footrest
    const sd = d * 0.62;
    put(b, cushionGeo(w - 2 * aw - 0.02, seatTop - baseTop + 0.04, sd, { ex: 0.2, ey: 0.45, ez: 0.25, crown: 0.25, ws: 14, hs: 10 }), f, 0, (baseTop + seatTop) / 2, d / 2 - sd / 2 - 0.01);
    // the back: a frame and three pillows down its front, all leaning back
    const y0 = baseTop - 0.06;
    const bl = (h - y0) / Math.cos(lean) - 0.02;
    const z0 = -d / 2 + 0.09 * k + bl * Math.sin(lean);
    const at = (t: number, off: number) => [y0 + t * Math.cos(lean) + off * Math.sin(lean), z0 - t * Math.sin(lean) + off * Math.cos(lean)] as const;
    const [fy, fz] = at(bl / 2, 0);
    put(b, cushionGeo(w - 2 * aw + 0.06, bl, 0.17 * k, { ex: 0.2, ey: 0.25, ez: 0.4, ws: 12, hs: 8, pole: "z" }), f, 0, fy, fz, -lean);
    const pw = w - 2 * aw - 0.03;
    const top = bl - 0.02;
    const from = seatTop - y0 - 0.02;
    const ph = (top - from) / 3;
    for (let i = 0; i < 3; i++) {
      const [py, pz] = at(from + ph * (i + 0.5), (0.13 + (i === 2 ? 0.02 : 0)) * k);
      put(b, cushionGeo(pw + (i === 2 ? 0.02 : 0), ph + 0.04, 0.17 * k, { ex: 0.35, ey: 0.6, ez: 0.6, crown: 0.05, ws: 14, hs: 10, pole: "z" }), f, 0, py, pz, -lean);
    }
    // the pull handle on the right arm's outer side
    const hm = mat(c === "black" ? "#55585e" : C.black, { roughness: 0.45 });
    b.box(0.006, 0.06, 0.14, w / 2 - 0.009, baseTop + 0.02, d / 2 - 0.22, hm, 0.002);
    b.box(0.016, 0.03, 0.1, w / 2 - 0.01, baseTop + 0.035, d / 2 - 0.22, hm, 0.008);
  },

  armchair_swivel: (b, w, d, h, f, _c, a) => {
    // a round tub on a swivel: a disc base and column in the accent, a round drum body, the back
    // curving round into low arms, a round seat cushion
    const R = Math.min(w, d) / 2;
    const disc = 0.025;
    const col = Math.min(0.11, h * 0.14);
    const seatTop = Math.min(0.52, h * 0.6);
    const deck = seatTop - Math.max(0.09, (seatTop - col) * 0.33);
    const armTop = Math.min(0.6 * Math.max(1, h / 0.78), h * 0.77);
    const t = 0.1;
    b.cyl(R * 0.68, R * 0.72, disc, 0, 0, 0, a, 40);
    b.cyl(R * 0.62, R * 0.68, 0.006, 0, disc, 0, a, 40);
    b.cyl(0.045, 0.055, col - disc, 0, disc, 0, a, 20);
    b.cyl(R * 0.4, R * 0.4, 0.012, 0, col - 0.012, 0, a, 28);
    // the body: a straight-sided drum with softly rounded edges, its side inside the shell's
    const rd = R - t * 0.45;
    const e = Math.min(0.035, (deck - col) / 3);
    const prof: THREE.Vector2[] = [new THREE.Vector2(0.001, col)];
    for (let k = 0; k <= 4; k++) {
      const q = (Math.PI / 2) * (k / 4);
      prof.push(new THREE.Vector2(rd - e + e * Math.sin(q), col + e - e * Math.cos(q)));
    }
    for (let k = 0; k <= 4; k++) {
      const q = (Math.PI / 2) * (k / 4);
      prof.push(new THREE.Vector2(rd - e + e * Math.cos(q), deck - e + e * Math.sin(q)));
    }
    prof.push(new THREE.Vector2(0.001, deck));
    const drum = new THREE.LatheGeometry(prof, 48);
    boxUV(drum);
    b.add(drum, f);
    shell(b, { rx: R - t / 2, rz: R - t / 2, zc: 0, A: Math.PI * 0.68, t, y0: col + 0.012, top: (s) => h - (h - armTop) * step(0.3, 0.8, s), segs: 34 }, f);
    const sr = R - t - 0.005;
    put(b, cushionGeo(2 * sr, seatTop - deck + 0.03, 2 * sr, { ex: 0.85, ey: 0.5, ez: 0.85, crown: 0.3, ws: 24, hs: 10 }), f, 0, (deck + seatTop) / 2, 0.01);
    put(b, cushionGeo(sr * 1.3, (h - seatTop) * 0.62, 0.1, { ex: 0.4, ey: 0.4, ez: 0.6, crown: 0.1, bend: 0.08, ws: 14, hs: 10 }), f, 0, seatTop + (h - seatTop) * 0.34, -R + t + 0.05, -0.15);
  },

  papasan_chair: (b, w, d, h, _f, c, a, ac) => {
    // a big rattan bowl tipped back on a woven ring base, a thick round cushion in it
    const wick = wickerMat(c);
    const pole = tone(c, c === "black" ? 0.9 : 0.78, { roughness: 0.7 });
    const cush = accentFabric(ac, a);
    const R = Math.min(w, d) / 2 - 0.03;
    const tilt = 0.34;
    const D = Math.min(R * 0.68, 0.38);
    const rimT = 0.035;
    // the bowl's lowest point: its rim's highest (at the back) just under h
    const by = Math.max(0.1, h - rimT - D * Math.cos(tilt) - R * Math.sin(tilt));
    // the base: a squat waisted drum of wicker with hoops round top and bottom, the bowl sat in it
    const rb = R * 0.66;
    const hb = by + D * 0.15;
    const base = [
      [rb, 0],
      [rb * 0.9, hb * 0.35],
      [rb * 0.82, hb * 0.6],
      [rb * 0.86, hb],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const bg = new THREE.LatheGeometry(base, 32);
    const buv = bg.attributes.uv.array as Float32Array;
    for (let i = 0; i < buv.length; i++) buv[i] *= i % 2 ? 1.4 : 5;
    b.add(bg, wick);
    for (const [y, r] of [[0.012, rb], [hb - 0.01, rb * 0.86]]) {
      const ring = new THREE.TorusGeometry(r, 0.016, 5, 28);
      ring.rotateX(Math.PI / 2);
      b.add(ring, pole, 0, y, 0);
    }
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const pts = base.map((p) => v(Math.cos(ang) * (p.x + 0.01), p.y, Math.sin(ang) * (p.x + 0.01)));
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.01, 4), pole);
    }
    // the bowl: a spherical cap, its rim a thick rattan hoop, ribs running out underneath
    const Rs = (R * R + D * D) / (2 * D);
    const fmax = Math.asin(R / Rs);
    const N = 12;
    const prof: THREE.Vector2[] = [];
    for (let k = 0; k <= N; k++) {
      const p = (fmax * k) / N;
      prof.push(new THREE.Vector2(Math.max(0.001, Rs * Math.sin(p)), Rs * (1 - Math.cos(p))));
    }
    const bowl = new THREE.LatheGeometry(prof, 36);
    const wuv = bowl.attributes.uv.array as Float32Array;
    for (let i = 0; i < wuv.length; i++) wuv[i] *= i % 2 ? 2.5 : 3;
    const T = matrix(0, by, -0.02, tilt);
    bowl.applyMatrix4(T);
    b.add(bowl, wick);
    const rim = new THREE.TorusGeometry(R, rimT, 6, 40);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, D, 0);
    rim.applyMatrix4(T);
    b.add(rim, pole);
    const ribs = 10;
    for (let i = 0; i < ribs; i++) {
      const ang = (i / ribs) * Math.PI * 2 + 0.3;
      const pts = prof.filter((_, k) => k % 2 === 0 && k > 0).map((p) => v(Math.cos(ang) * (p.x + 0.01), p.y - 0.008, Math.sin(ang) * (p.x + 0.01)).applyMatrix4(T));
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.011, 4), pole);
    }
    // the cushion: thick and round, dished to the bowl, a button in the middle
    const cr = R - 0.05;
    const th = Math.min(0.24, D * 0.65);
    const cg = cushionGeo(2 * cr, th, 2 * cr, { ex: 0.85, ey: 0.5, ez: 0.85, crown: 0.15, ws: 28, hs: 10 });
    const cp = cg.attributes.position;
    const sink = (r2: number) => Rs - Math.sqrt(Rs * Rs - r2);
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i);
      const z = cp.getZ(i);
      const r2 = x * x + z * z;
      cp.setY(i, cp.getY(i) + th / 2 + 0.008 + sink(r2) - 0.035 * Math.exp(-r2 / 0.012));
    }
    cg.computeVertexNormals();
    boxUV(cg);
    cg.applyMatrix4(T);
    b.add(cg, cush);
    const bp = v(0, th + 0.008 - 0.03, 0).applyMatrix4(T);
    b.sphere(0.02, bp.x, bp.y, bp.z, tone(ac, 0.7), 1, 0.5, 1, 10);
  },

  armchair_chesterfield: (b, w, d, h, _f, c) => {
    // the chesterfield: back and arms the same height, rolled outward all round the top, deep
    // diamond buttoning inside, nailheads along the front, turned feet
    const L = leather(c);
    const btn = leather(c, 0.5);
    const scroll = leather(c, 0.8);
    const wood = mat("#3a271b", { roughness: 0.45 });
    const brass = mat(FINISHES.brass, { metalness: 0.75, roughness: 0.35 });
    const legH = Math.min(0.1, h * 0.14);
    const baseTop = h * 0.42;
    const seatTop = Math.min(0.44, h * 0.58);
    const rr = Math.min(0.09, w * 0.09, d * 0.1);
    const ry = h - rr;
    // turned feet
    const foot = [
      [0.001, 0],
      [0.022, 0],
      [0.036, legH * 0.35],
      [0.022, legH * 0.7],
      [0.034, legH * 0.8],
      [0.034, legH],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new THREE.LatheGeometry(foot, 10), wood, sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07));
    // the base: tight and square, nailheads along its front near the bottom
    b.box(w - 0.02, baseTop - legH, d - 0.01, 0, legH, 0, L, 0.02);
    const nails: THREE.Vector3[] = [];
    const ny = legH + 0.035;
    const nx = Math.floor((w - 0.08) / 0.032);
    for (let i = 0; i <= nx; i++) nails.push(v(-(w - 0.08) / 2 + (i * (w - 0.08)) / nx, ny, d / 2 - 0.004));
    // the back: a panel with the roll along its top
    const bt = 2 * rr;
    put(b, cushionGeo(w - 2 * rr, ry - legH, bt - 0.02, { ex: 0.15, ey: 0.15, ez: 0.3, ws: 10, hs: 6, pole: "z" }), L, 0, legH + (ry - legH) / 2, -d / 2 + bt / 2 + 0.005);
    const backRoll = new THREE.CylinderGeometry(rr, rr, w - 2 * rr, 16, 1, true);
    backRoll.rotateZ(Math.PI / 2);
    b.add(backRoll, L, 0, ry, -d / 2 + rr);
    // the arms: a panel, the roll along its top, a pleated scroll on its front
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - rr);
      put(b, cushionGeo(bt - 0.035, ry - legH, d - 0.01, { ex: 0.15, ey: 0.15, ez: 0.15, ws: 10, hs: 6 }), L, x - sx * 0.012, legH + (ry - legH) / 2, 0);
      const roll = new THREE.CylinderGeometry(rr, rr, d - rr - 0.012, 16, 1, false);
      roll.rotateX(Math.PI / 2);
      b.add(roll, L, x, ry, (rr - 0.012) / 2);
      b.sphere(rr, x, ry, -d / 2 + rr, L, 1, 1, 1, 14);
      const fan = new THREE.CylinderGeometry(rr * 0.92, rr * 0.92, 0.012, 16);
      fan.rotateX(Math.PI / 2);
      b.add(fan, scroll, x, ry, d / 2 - 0.012);
      // pleats gathered into the scroll, nailheads down the arm front
      for (let k = 0; k < 6; k++) {
        const ang = Math.PI * (0.15 + (0.7 * k) / 5);
        const pleat = new THREE.BoxGeometry(rr * 0.85, 0.006, 0.006);
        pleat.translate(rr * 0.425, 0, 0);
        pleat.rotateZ(-ang);
        b.add(pleat, btn, x, ry, d / 2 - 0.004);
      }
      const ah = ry - rr - ny;
      const nn = Math.floor(ah / 0.032);
      for (let i = 0; i <= nn; i++) nails.push(v(x - sx * 0.012 + sx * (bt / 2 - 0.035), ny + (i * ah) / nn, d / 2 - 0.004));
      // the deep buttoned inside of the arm
      pad(b, matrix(x - sx * (rr + 0.004), seatTop + (ry - seatTop) / 2 - 0.01, -0.01, 0, (-sx * Math.PI) / 2), L, btn, d - bt - 0.1, ry - seatTop - 0.03, 0.035, 4, 2, 0.6, 0.01);
    }
    studs(b, nails, 0.0065, brass, 0.5, 0, true);
    // the seat cushion and the deep buttoned inside back
    const iw = w - 4 * rr;
    const sd = d - bt - 0.01;
    put(b, cushionGeo(iw, seatTop - baseTop + 0.03, sd, { ex: 0.16, ey: 0.5, ez: 0.2, crown: 0.2, ws: 14, hs: 10 }), L, 0, (baseTop + seatTop) / 2, -d / 2 + bt + sd / 2 - 0.005);
    const ih = ry - seatTop + 0.02;
    pad(b, matrix(0, seatTop + ih / 2 - 0.02, -d / 2 + bt - 0.012, -0.05), L, btn, iw + 0.01, ih, 0.06, 5, 3, 0.65, 0.011);
  },

  armchair_barrel: (b, w, d, h, f, _c, a) => {
    // a barrel chair: one channelled wall wrapping from the back round into the arms, nearly
    // the same height all round, a round seat cushion, short tapered legs
    const legH = Math.min(0.13, h * 0.18);
    const seatTop = Math.min(0.5, h * 0.61);
    const deck = seatTop - Math.max(0.08, (seatTop - legH) * 0.3);
    const t = 0.11;
    const A = Math.PI * 0.6;
    const rx = w / 2 - t / 2;
    const rz = d * 0.55 - t / 2;
    const zc = -d / 2 + t / 2 + rz;
    shell(b, { rx, rz, zc, A, t, y0: legH + 0.01, top: (s) => h - 0.09 * step(0.4, 1, s), channels: 9, deep: 0.45 }, f);
    put(b, cushionGeo(w - 0.04, deck - legH, d - 0.03, { ex: 1, ey: 0.25, ez: 1, ws: 28, hs: 8 }), f, 0, (legH + deck) / 2, 0.005);
    const sw = 2 * rx - t - 0.01;
    const sd = d / 2 - (zc - rz + t / 2) - 0.01;
    const seat = cushionGeo(sw, seatTop - deck + 0.03, sd, { ex: 0.6, ey: 0.5, ez: 0.5, crown: 0.3, ws: 18, hs: 10 });
    seat.translate(0, (deck + seatTop) / 2, d / 2 - sd / 2 - 0.01);
    b.add(fitInside(seat, rx - t / 2 - 0.004, rz - t / 2 - 0.004, zc, A), f);
    // legs set in under the round deck
    taperLegs(b, ovalFeet(w / 2 - 0.02, d / 2 - 0.015, 0.66), legH + 0.01, a, 0.022 * Math.max(1, Math.min(1.3, w / 0.75)));
  },

  armchair_slipper: (b, w, d, h, f, c, a) => {
    // an armless slipper chair: a low thick seat, a tall softly arched back leaning a little,
    // tapered legs (the back ones raked back)
    const legH = Math.min(0.17, h * 0.21);
    const seatTop = Math.min(0.42, h * 0.52);
    const lean = 0.13;
    put(b, cushionGeo(w - 0.01, seatTop - legH - 0.05, d - 0.02, { ex: 0.18, ey: 0.3, ez: 0.18, ws: 12, hs: 8 }), f, 0, (legH + seatTop - 0.05) / 2, 0);
    const sd = d * 0.72;
    put(b, cushionGeo(w - 0.03, 0.08, sd, { ex: 0.25, ey: 0.5, ez: 0.25, crown: 0.3, ws: 14, hs: 10 }), f, 0, seatTop - 0.04, d / 2 - sd / 2 - 0.01);
    // the back: an arched panel, its sides flaring a little
    const bh = (h - legH - 0.02) / Math.cos(lean);
    const bev = 0.03;
    const bw0 = w / 2 - bev - 0.01;
    const bw1 = w / 2 - bev;
    const arc = Math.min(0.14, bh * 0.2);
    const s = new THREE.Shape();
    s.moveTo(-bw0, 0);
    s.lineTo(bw0, 0);
    s.lineTo(bw1, bh - arc - bev);
    s.quadraticCurveTo(bw1, bh - bev, 0, bh - bev);
    s.quadraticCurveTo(-bw1, bh - bev, -bw1, bh - arc - bev);
    s.lineTo(-bw0, 0);
    const depth = 0.06;
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 12 });
    g.translate(0, 0, -depth - bev);
    g.computeVertexNormals();
    boxUV(g);
    const zf = -d / 2 + bh * Math.sin(lean) + 0.002;
    put(b, g, f, 0, legH + 0.02, zf, -lean);
    // two buttons down the back's inside
    const pts = [0.45, 0.7].map((t) => v(0, legH + 0.02 + bh * t * Math.cos(lean), zf - bh * t * Math.sin(lean)));
    studs(b, pts, 0.012, tone(c, 0.62), 0.6);
    const ix = w / 2 - 0.06;
    const iz = d / 2 - 0.07;
    taperLegs(b, [[-ix, iz], [ix, iz]], legH + 0.01, a, 0.02);
    for (const sx of [-1, 1]) b.rod(v(sx * ix, legH + 0.01, -iz + 0.06), v(sx * ix, 0, -d / 2 + 0.03), 0.017, a, 8);
  },

  armchair_rattan: (b, w, d, h, _f, c, a, ac) => {
    // a rattan armchair: a bent-pole frame (legs, arm loops, the back's arched loop, rails),
    // woven back and arm panels, a woven seat, cushions in the accent
    const wick = wickerMat(c);
    const pole = tone(c, c === "black" ? 0.9 : 0.8, { roughness: 0.65 });
    const cush = accentFabric(ac, a);
    const r = 0.018;
    const seatY = Math.min(0.36, h * 0.45);
    const armY = Math.min(0.62, h * 0.78);
    const lean = 0.16;
    const x = w / 2 - r - 0.005;
    const zf = d / 2 - r - 0.03;
    const zb = -d / 2 + r + 0.005 + (h - seatY) * Math.tan(lean);
    const backZ = (y: number) => zb - Math.max(0, y - seatY) * Math.tan(lean);
    const tube = (pts: THREE.Vector3[], seg = 24, rad = r) => b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), seg, rad, 6), pole);
    const top = h - r;
    // the back loop: up one back post, round the arched top, down the other
    const xt = x - 0.02;
    tube([v(-x, 0, zb), v(-x, seatY, zb), v(-xt, top - 0.1, backZ(top - 0.1)), v(0, top, backZ(top)), v(xt, top - 0.1, backZ(top - 0.1)), v(x, seatY, zb), v(x, 0, zb)], 48);
    // the arm loops: up the front leg, curving back along the arm into the back post
    for (const sx of [-1, 1]) {
      const X = sx * x;
      tube([v(X, 0, zf), v(X, armY - 0.08, zf), v(X, armY, zf - 0.07), v(X, armY + 0.005, (zf + backZ(armY)) / 2), v(X * 0.995, armY, backZ(armY) + 0.02)], 28);
      // side rails at the seat and near the floor, and the woven arm panel between them
      tube([v(X, seatY - 0.03, zf), v(X, seatY - 0.03, zb)], 2, r * 0.8);
      tube([v(X, 0.1, zf), v(X, 0.1, zb)], 2, r * 0.7);
      const s = new THREE.Shape();
      const z0 = zb + 0.01;
      const z1 = zf - 0.01;
      s.moveTo(z0, seatY - 0.03);
      s.lineTo(z1, seatY - 0.03);
      s.lineTo(z1, armY - 0.08);
      s.quadraticCurveTo(z1, armY - 0.01, z1 - 0.07, armY - 0.01);
      s.lineTo(z0 - (armY - seatY) * Math.tan(lean) + 0.02, armY - 0.01);
      s.lineTo(z0, seatY - 0.03);
      const g = new THREE.ShapeGeometry(s, 6);
      g.rotateY(-Math.PI / 2);
      b.add(g, wick, X, 0, 0);
    }
    for (const [y, z, rad] of [[seatY - 0.03, zf, r * 0.8], [seatY - 0.03, zb, r * 0.8], [0.1, zf, r * 0.7]] as const) tube([v(-x, y, z), v(x, y, z)], 2, rad);
    // the woven seat and back
    b.box(2 * x - 0.01, 0.012, zf - zb, 0, seatY - 0.03, (zf + zb) / 2, wick);
    const bs = new THREE.Shape();
    const bh = (top - seatY) / Math.cos(lean) - 0.01;
    const hx = xt - 0.005;
    bs.moveTo(-x + 0.004, 0);
    bs.lineTo(x - 0.004, 0);
    bs.lineTo(hx, bh - 0.14);
    bs.quadraticCurveTo(hx * 0.85, bh - 0.01, 0, bh - 0.005);
    bs.quadraticCurveTo(-hx * 0.85, bh - 0.01, -hx, bh - 0.14);
    bs.lineTo(-x + 0.004, 0);
    put(b, new THREE.ShapeGeometry(bs, 8), wick, 0, seatY - 0.03, zb, -lean);
    // the cushions: a thick seat cushion and a back cushion leaning on the weave
    const sw = 2 * x - 2 * r - 0.01;
    const sd = zf - zb - 0.01;
    put(b, cushionGeo(sw, 0.1, sd, { ex: 0.2, ey: 0.5, ez: 0.2, crown: 0.2, ws: 14, hs: 10 }), cush, 0, seatY + 0.03, (zf + zb) / 2 + 0.01);
    const ch = (top - seatY) * 0.75;
    const cy = seatY + 0.08 + (ch / 2) * Math.cos(lean);
    put(b, cushionGeo(sw - 0.04, ch, 0.11, { ex: 0.3, ey: 0.35, ez: 0.6, crown: 0.1, ws: 14, hs: 10, pole: "z" }), cush, 0, cy, backZ(cy) + 0.065, -lean);
  },

  chimney: (b, w, d, h, f, c) => {
    // a chimney stack: a plain body, a cap of projecting courses (corbelled brick under a sloped
    // mortar flaunching, or a precast concrete slab on a rendered stack) and clay flue pots
    const isBrick = c === "terracotta";
    const body = isBrick ? brick() : f;
    const ov = Math.min(0.045, w * 0.08, d * 0.08);
    const potH = Math.min(0.32, h * 0.1);
    const capH = isBrick ? 0.2 : 0.09;
    const stackTop = h - potH - capH;
    const pot = mat("#a4583a", { roughness: 0.85 });
    const conc = mat("#9d9a94", { roughness: 0.95 });
    block(b, w - 2 * ov, stackTop, d - 2 * ov, 0, 0, 0, body);
    if (isBrick) {
      // two corbelled courses and the flaunching sloping up to the pots
      block(b, w - ov, 0.075, d - ov, 0, stackTop, 0, body);
      block(b, w, 0.075, d, 0, stackTop + 0.075, 0, body);
      block(b, w - 0.01, 0.02, d - 0.01, 0, stackTop + 0.15, 0, conc);
      const fl = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.5, Math.SQRT1_2, 1, 4, 1);
      fl.rotateY(Math.PI / 4);
      fl.scale(w - 0.03, capH - 0.17, d - 0.03);
      b.add(fl, conc, 0, stackTop + 0.17 + (capH - 0.17) / 2, 0);
    } else {
      // a precast cap slab over a shadow line
      const cap = c === "concrete" ? mat("#8f8c86", { roughness: 0.95 }) : conc;
      block(b, w, capH - 0.015, d, 0, stackTop + 0.015, 0, cap);
      block(b, w - 2 * ov + 0.02, 0.015, d - 2 * ov + 0.02, 0, stackTop, 0, cap);
    }
    const pr = Math.min(0.1, d * 0.24, w * 0.2);
    const n = w > 0.85 ? 2 : 1;
    for (let i = 0; i < n; i++) chimneyPot(b, pr, potH, n === 1 ? 0 : (i - 0.5) * w * 0.48, h - potH, 0, pot);
  },

  chimney_breast: (b, w, d, h, f, c) => {
    // an indoor chimney breast from the floor to the ceiling: plastered (with skirting and a
    // cornice) or bare brick, an air vent low on its front
    if (c === "terracotta") {
      block(b, w, h, d, 0, 0, 0, brick());
      // a terracotta air brick
      const air = mat("#8e4a2f", { roughness: 0.9 });
      const hole = mat("#1d1a18", { roughness: 1 });
      b.box(0.215, 0.065, 0.01, 0, 0.3, d / 2, air);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) b.box(0.022, 0.018, 0.004, -0.08 + i * 0.032, 0.31 + j * 0.026, d / 2 + 0.008, hole);
      return;
    }
    const trim = mat("#f4f3ef", { roughness: 0.55 });
    // the body set in by the cornice's reach, so skirting and cornice stay inside the box
    const e = 0.035;
    const fz = d / 2 - e;
    block(b, w - 2 * e, h, d - e, 0, 0, -e / 2, f);
    // skirting round the three faces
    const sk = 0.016;
    b.box(w - 2 * e + 2 * sk, 0.1, sk, 0, 0, fz + sk / 2, trim, 0.004);
    for (const sx of [-1, 1]) b.box(sk, 0.1, d - e, sx * (w / 2 - e + sk / 2), 0, -e / 2, trim, 0.004);
    // a cornice stepping out under the ceiling
    for (const [y, out] of [[h - 0.09, e * 0.4], [h - 0.06, e * 0.75], [h - 0.03, e]] as const) {
      b.box(w - 2 * e + 2 * out, 0.03, out, 0, y, fz + out / 2, trim);
      for (const sx of [-1, 1]) b.box(out, 0.03, d - e, sx * (w / 2 - e + out / 2), y, -e / 2, trim);
    }
    // a slatted vent plate
    const vent = c === "white" ? trim : mat(c === "anthracite" ? "#3a3d42" : "#d9d7d2", { roughness: 0.6 });
    const slot = mat("#2a2a2a", { roughness: 1 });
    b.box(0.24, 0.16, 0.008, 0, 0.26, fz, vent, 0.003);
    for (let i = 0; i < 5; i++) b.box(0.19, 0.012, 0.003, 0, 0.285 + i * 0.023, fz + 0.006, slot);
  },
};
