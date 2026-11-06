// More detailed built-in pieces: plants. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
//
// Plants are often placed several times in a house, so they stay lean (≤ 3,000 triangles):
// leaves are small grids (a few rows, a fold along the midrib) batched per material, stems
// and trunks tapered tubes closed at their tips, pots lathes with a rim, an inner wall and soil.
import * as THREE from "three";
import { C, leafMat, mat, random, surface, v, type Build, type Builder } from "../modern";

type V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// ----- leaves -----

interface Sheet {
  /** Half width at t (0 base … 1 tip), relative to the leaf's half width. */
  prof: (t: number) => number;
  rows?: number;
  /** Grid columns on each side of the midrib. */
  cols?: number;
  /** Edges raised towards the face, per metre out from the midrib (a V along the midrib). */
  fold?: number;
  /** Rounded cross-section (cupped leaf), as a fraction of the half width. */
  cup?: number;
  /** The tip bends back (away from the face) by bend × len. */
  bend?: number;
  /** Heart-shaped base: the edges near the base reach back below it by lobe × len. */
  lobe?: number;
  /** Cuts from the edge towards the midrib (monstera, torn leaves): [t, depth 0..1, side (0 both, ±1 one)]. */
  slits?: [number, number, number?][];
  /** Rows at these t instead of evenly spaced ones (toothed fronds). */
  at?: number[];
  /** Grid lines (veins) rise towards the edge by slant × the distance from the midrib. */
  slant?: number;
  /** Wavy edge: amplitude (× half width) and waves along the leaf. */
  wave?: [number, number];
  /** Splits the leaf into parts for different materials: (row t, column u -1..1) → part index. */
  pick?: (t: number, u: number) => number;
}

/**
 * A leaf as a small grid: base at the origin, tip at +y (len), face towards +z, `wid` wide.
 * Returns one geometry per part (see Sheet.pick); triangles wind towards the face.
 */
function sheet(len: number, wid: number, o: Sheet): THREE.BufferGeometry[] {
  const rows = o.rows ?? 6;
  const cols = o.cols ?? 1;
  const half = wid / 2;
  const dt = 0.016;
  const slits = (o.slits ?? []).map(([t, depth, side]) => [Math.min(0.94, Math.max(0.06, t)), depth, side ?? 0]);
  const ts: { t: number; gap: number; side: number }[] = [];
  for (const t of o.at ?? Array.from({ length: rows + 1 }, (_, i) => i / rows)) {
    if (!slits.some(([st]) => Math.abs(t - st) < dt * 1.5)) ts.push({ t, gap: 0, side: 0 });
  }
  for (const [t, depth, side] of slits) ts.push({ t: t - dt, gap: depth, side }, { t: t + dt, gap: 0, side: 0 });
  ts.sort((a, b) => a.t - b.t);
  const pos: number[] = [];
  const grid: number[][] = [];
  const n = cols * 2;
  for (const { t } of ts) {
    let hw = half * Math.max(0, o.prof(t));
    if (o.wave) hw *= 1 + o.wave[0] * Math.sin(t * o.wave[1] * TAU);
    const row: number[] = [];
    if (hw < 1e-5) {
      row.push(pos.length / 3);
      pos.push(0, t * len, -(o.bend ?? 0) * len * t * t);
    } else
      for (let j = 0; j <= n; j++) {
        const u = j / cols - 1;
        const x = u * hw;
        const y = t * len - (o.lobe ?? 0) * len * Math.abs(u) * (1 - t) ** 4 + (o.slant ?? 0) * Math.abs(x);
        const z = (o.fold ?? 0) * Math.abs(x) + (o.cup ?? 0) * hw * u * u - (o.bend ?? 0) * len * (y / len) ** 2 * Math.sign(y);
        row.push(pos.length / 3);
        pos.push(x, y, z);
      }
    grid.push(row);
  }
  const parts: number[][] = [];
  const tri = (part: number, a: number, b: number, c: number) => (parts[part] ??= []).push(a, b, c);
  for (let i = 0; i + 1 < grid.length; i++) {
    const A = grid[i];
    const B = grid[i + 1];
    const tm = (ts[i].t + ts[i + 1].t) / 2;
    if (A.length === 1 && B.length === 1) continue;
    for (let j = 0; j < n; j++) {
      const uc = (j + 0.5) / cols - 1;
      if (ts[i].gap && Math.abs(uc) > 1 - ts[i].gap && uc * ts[i].side >= 0) continue;
      const part = o.pick ? o.pick(tm, uc) : 0;
      if (A.length === 1) tri(part, A[0], B[j + 1], B[j]);
      else if (B.length === 1) tri(part, A[j], A[j + 1], B[0]);
      else {
        tri(part, A[j], A[j + 1], B[j + 1]);
        tri(part, A[j], B[j + 1], B[j]);
      }
    }
  }
  const out: THREE.BufferGeometry[] = [];
  const attr = new THREE.Float32BufferAttribute(pos, 3);
  parts.forEach((index, i) => {
    if (!index) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", attr.clone());
    g.setIndex(index);
    g.computeVertexNormals();
    out[i] = g;
  });
  return out;
}
const leafOf = (len: number, wid: number, o: Sheet) => sheet(len, wid, o)[0];

/** A frame that puts a leaf's base at `at`, its length along `dir`, its face towards `face`. */
function orient(at: V3, dir: V3, face: V3 = UP): THREE.Matrix4 {
  const y = dir.clone().normalize();
  let x = y.clone().cross(face);
  if (x.lengthSq() < 1e-8) x = y.clone().cross(new THREE.Vector3(1, 0, 0));
  x.normalize();
  const z = x.clone().cross(y);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(at);
}
/** A direction: azimuth a around y, elevation e above the horizontal. */
const dirAt = (a: number, e: number) => v(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));

// common outlines
const ellipse = (t: number) => Math.sin(Math.PI * Math.min(1, t)) ** 0.8;
const lance = (t: number) => Math.sin(Math.PI * t ** 0.75) ** 0.9;
const sword = (t: number) => (t < 0.75 ? 0.75 + 0.25 * Math.sin((t / 0.75) * Math.PI * 0.5) : Math.sqrt(Math.max(0, 1 - ((t - 0.75) / 0.25) ** 2)));
const heart = (t: number) => (t >= 1 ? 0 : Math.sin(Math.PI * (0.2 + 0.8 * t)) ** 0.7 * (1 - t) ** 0.15);
const strap = (t: number) => (t > 0.999 ? 0 : 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85)) ** 0.5 * (1 - t) ** 0.3);

// ----- stems, trunks -----

/**
 * A tube along points, radius r(t) (t 0..1 along it; θ around for ribs), closed by a cone at
 * its far end (the near end is buried in soil or a leaf). Triangles wind outwards.
 */
function tube(pts: V3[], r: (t: number, th: number) => number, seg: number, radial: number, cap = true, ease = 1): THREE.BufferGeometry {
  const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(seg, false);
  if (ease !== 1) {
    // frames at the eased positions
    for (let i = 0; i <= seg; i++) {
      const t = 1 - (1 - i / seg) ** ease;
      const T = curve.getTangentAt(t);
      const N = frames.normals[i].clone();
      N.addScaledVector(T, -N.dot(T)).normalize();
      frames.tangents[i] = T;
      frames.normals[i] = N;
      frames.binormals[i] = T.clone().cross(N);
    }
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  // ease > 1 packs the rings towards the far end (a rounded top)
  const ts = Array.from({ length: seg + 1 }, (_, i) => 1 - (1 - i / seg) ** ease);
  const centres = ts.map((t) => curve.getPointAt(t));
  // where the tube bends sharply, its rings would cross on the inner side and turn faces
  // inside out: there it gets thinner than the bend's radius
  const limit = ts.map((_, i) => {
    let lim = Infinity;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j > seg) continue;
      const angle = frames.tangents[i].angleTo(frames.tangents[j]);
      if (angle > 1e-3) lim = Math.min(lim, (0.6 * centres[i].distanceTo(centres[j])) / Math.tan(Math.min(angle, 1.4)));
    }
    return lim;
  });
  for (let i = 0; i <= seg; i++) {
    const t = ts[i];
    p.copy(centres[i]);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let k = 0; k < radial; k++) {
      const th = (k / radial) * TAU;
      const rr = Math.min(r(t, th), limit[i]);
      pos.push(p.x + rr * (Math.cos(th) * N.x + Math.sin(th) * B.x), p.y + rr * (Math.cos(th) * N.y + Math.sin(th) * B.y), p.z + rr * (Math.cos(th) * N.z + Math.sin(th) * B.z));
    }
  }
  for (let i = 0; i < seg; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      idx.push(a, b, c, b, d, c);
    }
  if (cap) {
    const T = frames.tangents[seg];
    curve.getPointAt(1, p);
    const tip = pos.length / 3;
    const rEnd = r(1, 0);
    pos.push(p.x + T.x * rEnd * 0.6, p.y + T.y * rEnd * 0.6, p.z + T.z * rEnd * 0.6);
    for (let k = 0; k < radial; k++) idx.push(seg * radial + k, seg * radial + ((k + 1) % radial), tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Points on a gentle arc from a to c, bowed upwards by lift × their distance (no hairpins). */
function bow(a: V3, c: V3, lift: number, n = 5): V3[] {
  const ctrl = a.clone().lerp(c, 0.5).addScaledVector(UP, lift * a.distanceTo(c));
  return new THREE.QuadraticBezierCurve3(a, ctrl, c).getPoints(n - 1);
}
/** A tapered stem along points. */
function stalk(b: Builder, pts: V3[], r0: number, r1: number, m: THREE.Material, seg = 4, radial = 5) {
  b.batch(tube(pts, (t) => r0 + (r1 - r0) * t, seg, radial), m);
}

// ----- pots -----

type PotStyle = "classic" | "cylinder" | "round" | "tall" | "ribbed" | "bowl" | "cone";
const PROFILES: Record<PotStyle, { outer: [number, number][]; soil: number }> = {
  // a flower pot with a rolled rim band
  classic: { outer: [[0, 0], [0.7, 0], [0.73, 0.02], [0.85, 0.76], [0.87, 0.78], [0.99, 0.8], [1, 0.84], [1, 0.97], [0.98, 1]], soil: 0.9 },
  cylinder: { outer: [[0, 0], [0.9, 0], [0.97, 0.015], [1, 0.06], [1, 0.985], [0.99, 1]], soil: 0.92 },
  // a belly and a narrower neck (olive jar)
  round: { outer: [[0, 0], [0.55, 0], [0.6, 0.03], [0.88, 0.25], [1, 0.52], [0.95, 0.76], [0.86, 0.9], [0.86, 0.96], [0.88, 1]], soil: 0.92 },
  tall: { outer: [[0, 0], [0.78, 0], [0.82, 0.02], [0.98, 0.95], [1, 0.975], [0.995, 1]], soil: 0.93 },
  ribbed: { outer: [[0, 0], [0.82, 0], [0.88, 0.03], [0.98, 0.3], [1, 0.97], [0.99, 1]], soil: 0.92 },
  bowl: { outer: [[0, 0], [0.47, 0], [0.5, 0.025], [0.52, 0.12], [0.56, 0.16], [0.8, 0.32], [0.96, 0.7], [1, 0.97], [0.99, 1]], soil: 0.82 },
  // a cone on a short foot
  cone: { outer: [[0, 0], [0.47, 0], [0.5, 0.015], [0.52, 0.08], [0.6, 0.12], [0.98, 0.95], [1, 0.98], [0.99, 1]], soil: 0.92 },
};
/**
 * A pot in the finish (a lathe: bottom, outer wall, rim, inner wall down to the soil, so it is
 * closed from every side it can be seen), soil slightly mounded. Returns the soil's height.
 */
function planter(b: Builder, r: number, h: number, f: THREE.Material, style: PotStyle, y = 0, soil = C.soil, seg = 24): number {
  const { outer, soil: s } = PROFILES[style];
  const wall = Math.min(0.018, r * 0.08);
  const top = outer[outer.length - 1][0] * r;
  const pts = outer.map(([x, yy]) => new THREE.Vector2(Math.max(x * r, 0), yy * h));
  // the rim's inner edge is chamfered: the lathe smooths normals over each corner, and a sharp
  // one would tilt the rim top's normals away from a camera looking flat over it
  pts.push(new THREE.Vector2(top - wall * 0.75, h), new THREE.Vector2(top - wall, h - wall * 0.25), new THREE.Vector2(top - wall * 1.15, h * (s + (1 - s) * 0.4)), new THREE.Vector2(top - wall * 1.3, h * s));
  const geo = new THREE.LatheGeometry(pts, style === "ribbed" ? Math.max(seg, 36) : seg);
  if (style === "ribbed") {
    // vertical ribs on the outside only (the inner wall stays round)
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const rr = Math.hypot(x, z);
      if (rr < top - wall * 0.5 && p.getY(i) > h * 0.5) continue;
      const k = 1 + 0.035 * Math.cos(Math.atan2(z, x) * 12) * Math.min(1, rr / r);
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    geo.computeVertexNormals();
  }
  b.add(geo, f, 0, y, 0);
  const sr = top - wall * 1.1;
  const sy = y + h * s;
  const mound = [new THREE.Vector2(sr, 0), new THREE.Vector2(sr * 0.6, sr * 0.08), new THREE.Vector2(0.001, sr * 0.11)];
  b.add(new THREE.LatheGeometry(mound, Math.max(12, seg - 6)), mat(soil, { roughness: 1 }), 0, sy, 0);
  return sy + sr * 0.08;
}
/** A few pebbles on the soil (cacti, succulents). */
function pebbles(b: Builder, rand: () => number, r: number, y: number, n: number, colors: string[]) {
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU;
    const rr = Math.sqrt(rand()) * r;
    const s = 0.008 + rand() * 0.01;
    const g = new THREE.IcosahedronGeometry(s, 0);
    g.scale(1, 0.6, 0.85);
    b.batch(g, mat(colors[i % colors.length], { roughness: 0.9 }), new THREE.Matrix4().makeRotationY(rand() * 3).setPosition(Math.cos(a) * rr, y, Math.sin(a) * rr));
  }
}

/** A palm frond along a curve: leaflets in pairs on both sides of its rachis. */
function frond(b: Builder, curve: THREE.Curve<V3>, o: { from: number; pairs: number; len: number; wid: number; droop: number; forward: number; colors: string[]; rachis: string; r: number; rand: () => number }) {
  const seg = Math.min(16, Math.max(8, Math.round(curve.getLength() / 0.1)));
  b.batch(tube(curve.getPoints(seg * 2), (t) => o.r * (1 - t * 0.7), seg, 4), mat(o.rachis));
  for (let k = 0; k < o.pairs; k++) {
    const t = o.from + ((1 - o.from) * (k + 0.5)) / o.pairs;
    const p = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    const side = T.clone().cross(UP).normalize();
    if (side.lengthSq() < 0.5) side.set(1, 0, 0);
    const up = side.clone().cross(T).normalize();
    // leaflets shorten towards the frond's tip and its base
    const len = o.len * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (t - o.from) / (1 - o.from) * 0.85 + 0.15)));
    for (const sd of [-1, 1]) {
      const dir = side.clone().multiplyScalar(sd).addScaledVector(T, o.forward).addScaledVector(up, -o.droop + (o.rand() - 0.5) * 0.2);
      const leaf = leafOf(len, o.wid, { prof: lance, rows: 2, cols: 1, fold: 0.6, bend: 0.15 + o.droop * 0.2 });
      leaf.applyMatrix4(orient(p, dir, up));
      b.batch(leaf, leafMat(o.colors[(k + (sd > 0 ? 1 : 0)) % o.colors.length]));
    }
  }
}
/** A fleshy leaf (aloe, succulents): a closed tapering body, flat on top, keeled below, along +y, top towards +z. */
function fleshy(len: number, wid: number, th: number, bend: number, seg = 4): THREE.BufferGeometry {
  // around the leaf: underside keel (θ 0 → −z), side (−x), top (+z), side (+x)
  const g = tube([v(0, 0, 0), v(0, len, 0)], (t, a) => {
    const taper = (1 - t ** 1.25) * (t < 0.1 ? 0.8 + t * 2 : 1);
    const c = Math.round((a / TAU) * 4) % 4;
    return taper * (c === 0 ? th : c === 2 ? th * 0.35 : wid / 2);
  }, seg, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    p.setZ(i, p.getZ(i) - bend * len * t * t);
  }
  // flat shaded: smooth normals over its sharp edges would turn away from the eye
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}
/** A fat pointed succulent leaf (8 triangles, closed), base at 0, tip at +y. */
function lens(len: number, wid: number, th: number): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * wid / 2, y > 0.5 ? len : y < -0.5 ? 0 : len * 0.42, p.getZ(i) * th / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** A lumpy ball of foliage (flat shaded, closed), radius about 1. */
function lumpy(rand: () => number, amount: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const moved = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    // the same corner moves the same way in every face that shares it, so no cracks open
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = moved.get(key);
    if (k === undefined) moved.set(key, (k = 1 + (rand() - 0.5) * 2 * amount));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
/** A narrow leaf of two triangles (olive, small foliage), base at 0, tip at +y, face +z. */
function sliver(len: number, wid: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, wid / 2, len * 0.45, wid * 0.15, 0, len, 0, 0, 0, 0, 0, len, 0, -wid / 2, len * 0.45, wid * 0.15], 3));
  g.computeVertexNormals();
  return g;
}

// ----- the plants -----

export const BUILDERS: Record<string, Build> = {
  monstera: (b, w, d, h, f) => {
    // Swiss cheese plant: big split heart-shaped leaves held out on long arching stalks, a moss pole
    const rand = random(11);
    const k = Math.min(w, d);
    const ph = Math.min(0.3, h * 0.26);
    const pr = k * 0.22;
    const soil = planter(b, pr, ph, f, "cylinder");
    b.batch(tube([v(0, soil - 0.05, 0), v(0, soil + (h - ph) * 0.5, 0)], () => 0.022, 1, 8), mat("#6b5338", { roughness: 1 }));
    const greens = ["#24502a", "#2e5f30", "#356b34"];
    const n = 9;
    const s = Math.min(1.25, Math.max(0.6, (k / 0.9) * 0.6 + (h / 1.15) * 0.4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand() * 0.5;
      const young = i === 4 || i === 8;
      const len = (young ? 0.2 : 0.34 + rand() * 0.12) * s;
      const reach = Math.max(0.05, (0.3 + rand() * 0.4) * (k / 2) - len * 0.3);
      const top = v(Math.cos(a) * reach, soil + (h - soil - len * 0.35) * (0.5 + 0.5 * ((i * 0.37) % 1)), Math.sin(a) * reach);
      const base = v(Math.cos(a) * pr * 0.3, soil - 0.02, Math.sin(a) * pr * 0.3);
      const mid = v(top.x * 0.3, (base.y + top.y) / 2 + 0.05, top.z * 0.3);
      stalk(b, [base, mid, top], 0.008, 0.005, mat("#3f6b34"), 5, 5);
      const slits: [number, number][] = young ? [] : [0.2, 0.34, 0.48, 0.62, 0.76].map((t) => [t + (rand() - 0.5) * 0.04, 0.6]);
      const geo = leafOf(len, len * 0.95, { prof: heart, rows: 6, cols: 3, fold: 0.12, bend: 0.1, lobe: 0.18, slits, slant: 0.35 });
      const dir = dirAt(a + (rand() - 0.5) * 0.5, -0.1 - rand() * 0.35);
      geo.applyMatrix4(orient(top, dir, v(0, 1, 0).add(dirAt(a, 0).multiplyScalar(0.25))));
      b.batch(geo, leafMat(young ? "#5f9445" : greens[i % greens.length]));
    }
  },
  fiddle_fig: (b, w, d, h, f) => {
    // Ficus lyrata: a bare trunk, a crown of big violin-shaped leaves held out on short stalks
    const rand = random(23);
    const k = Math.min(w, d);
    const ph = Math.min(0.36, h * 0.22);
    const soil = planter(b, k * 0.3, ph, f, "tall");
    const bark = mat("#7a6650", { roughness: 1 });
    const trunk = [v(0, soil - 0.04, 0), v(0.015, soil + (h - soil) * 0.35, 0.01), v(-0.01, soil + (h - soil) * 0.65, -0.005), v(0.005, h - 0.1, 0)];
    b.batch(tube(trunk, (t) => 0.022 - t * 0.014, 6, 6), bark);
    const curve = new THREE.CatmullRomCurve3(trunk);
    const branches: [THREE.Curve<V3>, number, number][] = [[curve, 0.36, 18]];
    for (const [a, t0] of [[0.6, 0.48], [3.5, 0.6]] as const) {
      const p0 = curve.getPointAt(t0);
      const pts = [p0, p0.clone().add(v(Math.cos(a) * k * 0.12, 0.1, Math.sin(a) * k * 0.12)), p0.clone().add(v(Math.cos(a) * k * 0.2, 0.28, Math.sin(a) * k * 0.2))];
      b.batch(tube(pts, (t) => 0.011 - t * 0.006, 4, 5), bark);
      branches.push([new THREE.CatmullRomCurve3(pts), 0.25, 7]);
    }
    const fiddle = (t: number) => (t >= 1 ? 0 : (0.3 + 0.7 * Math.min(1, t / 0.7) ** 0.8) * (t > 0.78 ? Math.sqrt(1 - ((t - 0.78) / 0.22) ** 2) : 1) * (1 - 0.14 * Math.exp(-(((t - 0.45) / 0.12) ** 2))));
    const greens = ["#24452a", "#2c5230", "#335c33", "#3d6a38"].map((c) => leafMat(c));
    const ls = Math.min(1.3, Math.max(0.6, k / 0.6));
    let i = 0;
    for (const [c, from, n] of branches) {
      for (let j = 0; j < n; j++, i++) {
        const t = from + ((1 - from) * (j + 0.5)) / n;
        const p = c.getPointAt(t);
        const a = i * 2.4 + rand() * 0.3;
        const len = (0.28 + rand() * 0.1) * ls * (1 - (t - from) * 0.3);
        const leaf = leafOf(len, len * 0.68, { prof: fiddle, rows: 6, cols: 2, fold: 0.12, cup: 0.25, bend: 0.15, wave: [0.06, 2] });
        const e = 0.6 - (1 - t) * 0.8 + (rand() - 0.5) * 0.3;
        leaf.applyMatrix4(orient(p.clone().add(dirAt(a, 0).multiplyScalar(0.012)), dirAt(a, e), v(0, 0.7, 0).addScaledVector(dirAt(a, 0), 0.6)));
        b.batch(leaf, greens[i % greens.length]);
      }
    }
  },
  snake_plant: (b, w, d, h, f) => {
    // Sansevieria: upright swords in clumps, banded dark and light green, yellow margins
    const rand = random(5);
    const k = Math.min(w, d);
    const ph = Math.min(0.24, h * 0.3);
    const pr = k * 0.42;
    const soil = planter(b, pr, ph, f, "ribbed");
    const parts = [leafMat("#2b4a2e"), leafMat("#557a48"), leafMat("#c8c066")];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const clump = i % 3;
      const ca = clump * 2.1 + 0.4;
      const base = v(Math.cos(ca) * pr * 0.35 + (rand() - 0.5) * 0.04, soil - 0.02, Math.sin(ca) * pr * 0.35 + (rand() - 0.5) * 0.04);
      const len = (h - soil) * (i < 3 ? 1 : 0.55 + rand() * 0.42);
      const wid = Math.min(0.08, k * 0.2) * (0.75 + rand() * 0.35);
      const a = ca + (rand() - 0.5) * 2;
      const lean = 0.08 + rand() * 0.22;
      const dir = v(Math.cos(a) * lean, 1, Math.sin(a) * lean);
      const face = dirAt(a + (rand() - 0.5) * 2.4, 0);
      const geos = sheet(len, wid, { prof: sword, rows: 9, cols: 3, fold: 0.5, cup: 0.2, bend: 0.03 + rand() * 0.04, pick: (t, u) => (Math.abs(u) > 0.6 ? 2 : Math.floor(t * 9 + u * 0.8 + i) % 2) });
      const m = orient(base, dir, face);
      geos.forEach((g, j) => g && b.batch(g, parts[j], m));
    }
  },
  areca_palm: (b, w, d, h, f) => {
    // butterfly palm: clumped golden canes, feathery arching fronds of narrow leaflets
    const rand = random(7);
    const k = Math.min(w, d);
    const ph = Math.min(0.34, h * 0.22);
    const soil = planter(b, k * 0.26, ph, f, "cylinder");
    const fronds = 10;
    for (let s = 0; s < fronds; s++) {
      const a = (s / fronds) * TAU + rand() * 0.4;
      const base = v(Math.cos(a * 3) * 0.04, soil - 0.03, Math.sin(a * 3) * 0.04);
      const out = (k / 2) * (0.7 + rand() * 0.28);
      // a narrow, tall box: longer canes, the fronds no taller than their reach allows
      const cane = Math.max((h - soil) * (0.2 + rand() * 0.25), h - soil - out * 2.4);
      const top = base.clone().add(v(Math.cos(a) * 0.04, cane, Math.sin(a) * 0.04));
      b.batch(tube([base, top], (t) => 0.011 - t * 0.004, 2, 5), mat("#a9a24e"));
      const rise = Math.min(h - top.y - rand() * 0.15, out * 2.2);
      const curve = new THREE.QuadraticBezierCurve3(top, v(Math.cos(a) * out * 0.35, top.y + rise * 1.2, Math.sin(a) * out * 0.35), v(Math.cos(a) * out, top.y + rise * 0.45, Math.sin(a) * out));
      frond(b, curve, { from: 0.08, pairs: 15, len: 0.24 * Math.min(1.2, k / 0.9 + 0.2), wid: 0.022, droop: -0.15, forward: 0.55, colors: ["#5f8f3a", "#77a145", "#6a983f"], rachis: "#8c9a45", r: 0.006, rand });
    }
  },
  olive_tree: (b, w, d, h, f) => {
    // a gnarled twisting trunk, a rounded crown of narrow silver-green leaves, a few olives
    const rand = random(13);
    const k = Math.min(w, d);
    const ph = Math.min(0.42, h * 0.27);
    const soil = planter(b, k * 0.36, ph, f, "round");
    const bark = mat("#6e6455", { roughness: 1 });
    const fork = soil + (h - soil) * 0.36;
    b.batch(tube([v(0, soil - 0.05, 0), v(0.025, soil + (fork - soil) * 0.3, -0.01), v(-0.02, soil + (fork - soil) * 0.7, 0.015), v(0.01, fork, 0)], (t, th) => (0.04 - t * 0.016) * (1 + 0.14 * Math.cos(3 * th + t * 7)), 8, 8), bark);
    const leafColors = ["#7d8b62", "#97a27a", "#6c7a55", "#aab394"].map((c) => leafMat(c));
    const inner = mat("#6f7c56", { roughness: 1 });
    const olive = [mat("#3b2b3c", { roughness: 0.4 }), mat("#6f7a3a", { roughness: 0.5 })];
    const crown = h - fork;
    const cr = Math.min(k * 0.23, crown * 0.3);
    for (let c = 0; c < 5; c++) {
      const a = (c / 4) * TAU + rand() * 0.6;
      const r = (k / 2) * (c === 4 ? 0.05 : 0.34 + rand() * 0.08);
      const end = v(Math.cos(a) * r, Math.min(h - cr * 0.75, fork + crown * (c === 4 ? 0.8 : 0.45 + rand() * 0.2)), Math.sin(a) * r);
      const mid = v(end.x * 0.4 + (rand() - 0.5) * 0.04, (fork + end.y) / 2 + 0.03, end.z * 0.4 + (rand() - 0.5) * 0.04);
      b.batch(tube([v(0, fork - 0.04, 0), mid, end], (t) => 0.018 - t * 0.012, 4, 5), bark);
      // a core gives the cluster body; the leaves lie over its surface
      b.batch(lumpy(rand, 0.2), inner, new THREE.Matrix4().compose(end, new THREE.Quaternion(), v(cr * 0.85, cr * 0.65, cr * 0.85)));
      for (let i = 0; i < 85; i++) {
        const u = rand() * TAU;
        const wv = Math.acos(2 * rand() - 1);
        const off = v(Math.sin(wv) * Math.cos(u), Math.cos(wv) * 0.75, Math.sin(wv) * Math.sin(u));
        const p = end.clone().addScaledVector(off, cr * (0.8 + rand() * 0.2));
        const n = off.clone().normalize();
        const rnd = v(rand() - 0.5, rand() - 0.5, rand() - 0.5);
        const dir = rnd.addScaledVector(n, -rnd.dot(n)).addScaledVector(n, 0.45);
        const leaf = sliver(0.05 + rand() * 0.025, 0.016);
        leaf.applyMatrix4(orient(p, dir, n));
        b.batch(leaf, leafColors[i % 4]);
        if (i % 14 === 0) b.batch(new THREE.IcosahedronGeometry(0.008, 0).scale(0.8, 1, 0.8), olive[(i + c) % 2], new THREE.Matrix4().setPosition(p.x, p.y - 0.01, p.z));
      }
    }
  },
  plant_hanging: (b, w, d, h, f) => {
    // hangs from the ceiling: a bowl in a macramé hanger, trailing heart-leaf vines
    const rand = random(17);
    const k = Math.min(w, d);
    const pr = k * 0.3;
    const pH = Math.min(0.16, h * 0.22);
    const py = h * 0.5;
    const soil = planter(b, pr, pH, f, "bowl", py, C.soil, 20);
    const cord = mat("#e3dccb", { roughness: 1 });
    const knot = v(0, py - 0.06, 0);
    const ring = v(0, h - 0.01, 0);
    b.batch(new THREE.TorusGeometry(0.02, 0.004, 4, 12), cord, new THREE.Matrix4().setPosition(0, h - 0.02, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const rim = v(Math.cos(a) * pr * 1.04, py + pH * 0.75, Math.sin(a) * pr * 1.04);
      const under = v(Math.cos(a) * pr * 0.75, py + pH * 0.1, Math.sin(a) * pr * 0.75);
      const tie = v(Math.cos(a) * pr * 0.95, py + pH + (h - py - pH) * 0.25, Math.sin(a) * pr * 0.95);
      b.batch(tube([ring, tie], () => 0.0035, 1, 4), cord);
      b.batch(tube([tie, rim, under, knot], () => 0.0035, 8, 4), cord);
      b.batch(new THREE.IcosahedronGeometry(0.008, 0), cord, new THREE.Matrix4().setPosition(tie.x, tie.y, tie.z));
    }
    b.batch(new THREE.IcosahedronGeometry(0.016, 1), cord, new THREE.Matrix4().setPosition(knot.x, knot.y, knot.z));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      b.batch(tube([knot, v(Math.cos(a) * 0.012, knot.y - 0.09 - rand() * 0.03, Math.sin(a) * 0.012)], () => 0.0025, 1, 3), cord);
    }
    const greens = ["#4d8a3a", "#6a9f48", "#3c7330"].map((c) => leafMat(c));
    const stem = mat("#5c7a3a");
    // a tuft on the soil
    for (let i = 0; i < 10; i++) {
      const a = rand() * TAU;
      const p = v(Math.cos(a) * pr * 0.4 * rand(), soil, Math.sin(a) * pr * 0.4 * rand());
      const leaf = leafOf(0.06 + rand() * 0.02, 0.05, { prof: heart, rows: 3, cols: 1, fold: 0.3, lobe: 0.1, bend: 0.2 });
      leaf.applyMatrix4(orient(p, dirAt(a, 0.3 + rand() * 0.6), UP));
      b.batch(leaf, greens[i % 3]);
    }
    const vines = 9;
    for (let s = 0; s < vines; s++) {
      const a = (s / vines) * TAU + rand() * 0.4;
      const out = dirAt(a, 0);
      const drop = (py - 0.03) * (0.35 + rand() * 0.65);
      const rr = pr * 1.2 + 0.02;
      const sway = v((rand() - 0.5) * 0.05, 0, (rand() - 0.5) * 0.05);
      // over the rim on a smooth arc, then down
      const y0 = py + pH * 0.6;
      const over = new THREE.QuadraticBezierCurve3(v(out.x * pr * 0.5, soil, out.z * pr * 0.5), v(out.x * pr * 1.1, py + pH + 0.05, out.z * pr * 1.1), v(out.x * rr, y0, out.z * rr)).getPoints(6);
      const down = [v(out.x * (rr + 0.006), y0 - drop * 0.35, out.z * (rr + 0.006)).addScaledVector(sway, 0.4), v(out.x * (rr + 0.015), y0 - drop * 0.7, out.z * (rr + 0.015)).add(sway), v(out.x * (rr + 0.025), y0 - drop, out.z * (rr + 0.025)).add(sway)];
      const curve = new THREE.CatmullRomCurve3([...over, ...down]);
      b.batch(tube(over, () => 0.0022, 6, 3), stem);
      b.batch(tube([over[6], ...down], () => 0.0022, 9, 3), stem);
      const n = Math.round(5 + drop * 17);
      for (let j = 1; j < n; j++) {
        const t = j / n;
        const p = curve.getPointAt(t);
        const side = j % 2 ? 1 : -1;
        const sideDir = curve.getTangentAt(t).cross(UP);
        if (sideDir.lengthSq() < 1e-4) sideDir.copy(out);
        const dir = sideDir.normalize().multiplyScalar(side).add(v(0, -0.6, 0)).addScaledVector(out, 0.5);
        const leaf = leafOf((0.055 - t * 0.02) * (0.85 + rand() * 0.3), 0.045 - t * 0.012, { prof: heart, rows: 3, cols: 1, fold: 0.3, lobe: 0.1, bend: 0.1 });
        leaf.applyMatrix4(orient(p, dir, out));
        b.batch(leaf, greens[(j + s) % 3]);
      }
    }
  },
  plant_small: (b, w, d, h, f) => {
    // Pilea: round coin leaves on long thin stalks around a short stem
    const rand = random(3);
    const k = Math.min(w, d);
    const ph = h * 0.42;
    const soil = planter(b, k * 0.4, ph, f, "classic", 0, C.soil, 20);
    const top = soil + (h - soil) * 0.45;
    b.batch(tube([v(0, soil - 0.01, 0), v(0.004, top, 0)], (t) => 0.005 - t * 0.002, 2, 5), mat("#6d7f45"));
    const round = (t: number) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    const greens = ["#4f8a3a", "#5f9a45", "#6aa64a"].map((c) => leafMat(c));
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4;
      const yy = soil + (top - soil) * (0.3 + (0.7 * i) / n);
      const reach = (k / 2) * (0.55 + 0.4 * (1 - i / n)) * (0.85 + rand() * 0.2);
      const size = Math.min(0.075, k * 0.32) * (0.7 + 0.4 * (1 - i / n)) * (0.85 + rand() * 0.25);
      const end = v(Math.cos(a) * (reach - size * 0.5), Math.min(h - 0.015, yy + (h - yy) * (0.3 + rand() * 0.5)), Math.sin(a) * (reach - size * 0.5));
      const p0 = v(0, yy, 0);
      b.batch(tube(bow(p0, end, 0.15), () => 0.0015, 4, 3), mat("#7a9a4f"));
      // peltate: the stalk meets the leaf near its middle
      const leaf = leafOf(size, size, { prof: round, rows: 4, cols: 2, cup: 0.4 });
      leaf.translate(0, -size * 0.4, 0);
      leaf.applyMatrix4(orient(end, dirAt(a, -0.1 + rand() * 0.3), v(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6)));
      b.batch(leaf, greens[i % 3]);
    }
  },
  peace_lily: (b, w, d, h, f) => {
    // Spathiphyllum: arching glossy dark leaves, white hooded flowers on taller stalks
    const rand = random(181);
    const k = Math.min(w, d);
    const ph = Math.min(0.24, h * 0.32);
    const soil = planter(b, k * 0.3, ph, f, "cone");
    const greens = ["#1f4426", "#285230", "#2f5c34"].map((c) => leafMat(c));
    const stemM = mat("#3d6b36");
    for (let i = 0; i < 16; i++) {
      const a = i * 2.4 + rand() * 0.3;
      const reach = (k / 2) * (0.25 + rand() * 0.35);
      const top = v(Math.cos(a) * reach * 0.6, soil + (h - soil) * (0.3 + rand() * 0.28), Math.sin(a) * reach * 0.6);
      stalk(b, bow(v(Math.cos(a) * 0.015, soil - 0.01, Math.sin(a) * 0.015), top, 0.12), 0.004, 0.003, stemM, 4, 4);
      const len = (0.2 + rand() * 0.08) * Math.min(1.3, k / 0.55);
      const leaf = leafOf(len, len * 0.38, { prof: lance, rows: 6, cols: 2, fold: 0.28, bend: 0.25 + rand() * 0.1, wave: [0.05, 2] });
      leaf.applyMatrix4(orient(top, dirAt(a, 0.5 - rand() * 0.5), v(0, 1, 0).addScaledVector(dirAt(a, 0), -0.5)));
      b.batch(leaf, greens[i % 3]);
    }
    const spathe = leafMat("#f4f3ec");
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.6;
      const top = v(Math.cos(a) * k * 0.12, h - 0.13 - rand() * 0.08 * h, Math.sin(a) * k * 0.12);
      stalk(b, bow(v(0, soil - 0.01, 0), top, 0.05), 0.0035, 0.003, stemM, 4, 4);
      // the hood stands behind the spadix, its face turned outwards
      const out = dirAt(a, 0);
      const hood = leafOf(0.12, 0.065, { prof: (t) => Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)) ** 0.7, rows: 4, cols: 2, cup: 0.5, bend: -0.12 });
      hood.applyMatrix4(orient(top.clone().addScaledVector(out, -0.008), v(0, 1, 0).addScaledVector(out, 0.25), out));
      b.batch(hood, spathe);
      b.batch(tube([top.clone().addScaledVector(out, 0.004), top.clone().add(v(0, 0.05, 0)).addScaledVector(out, 0.012)], () => 0.0055, 1, 6), mat("#e6dca2"));
    }
  },
  rubber_tree: (b, w, d, h, f) => {
    // Ficus elastica: upright stems densely set with big glossy oval leaves, red sheaths at the tips
    const rand = random(191);
    const k = Math.min(w, d);
    const ph = Math.min(0.32, h * 0.22);
    const soil = planter(b, k * 0.3, ph, f, "cylinder");
    const stemM = mat("#5a4a36");
    const greens = ["#1d2f22", "#243a29", "#2c4630", "#4a2f33"].map((c) => leafMat(c));
    const oval = (t: number) => (t >= 1 ? 0 : Math.sin(Math.PI * (0.1 + 0.9 * t)) ** 0.6 * (t > 0.85 ? 1 - ((t - 0.85) / 0.15) * 0.6 : 1));
    const ls = Math.min(1.3, Math.max(0.6, k / 0.6));
    let i = 0;
    for (const [ox, oz, top] of [[-0.025, 0.01, h - 0.1], [0.035, -0.02, soil + (h - soil) * 0.75], [0.0, 0.04, soil + (h - soil) * 0.52]] as const) {
      const pts = [v(ox * 0.5, soil - 0.03, oz * 0.5), v(ox * 1.2, (soil + top) / 2, oz * 1.2), v(ox * 1.5, top, oz * 1.5)];
      b.batch(tube(pts, (t) => 0.014 - t * 0.007, 4, 6), stemM);
      const c = new THREE.CatmullRomCurve3(pts);
      const n = Math.max(4, Math.round((top - soil) / 0.075));
      for (let j = 0; j < n; j++, i++) {
        const t = 0.18 + (0.8 * j) / n;
        const p = c.getPointAt(t);
        const a = i * 2.3 + rand() * 0.3;
        const len = (0.25 + rand() * 0.08) * ls * (1 - t * 0.25);
        const e = -0.45 + t * 0.75;
        const leaf = leafOf(len, len * 0.52, { prof: oval, rows: 5, cols: 2, fold: 0.15, cup: 0.12, bend: 0.06 });
        const at = p.clone().addScaledVector(dirAt(a, e), 0.025);
        leaf.applyMatrix4(orient(at, dirAt(a, e), v(0, 1, 0).addScaledVector(dirAt(a, 0), -0.4)));
        b.batch(leaf, greens[j === n - 1 ? 3 : i % 3]);
        stalk(b, [p, at], 0.003, 0.0025, stemM, 1, 4);
      }
      const tip = c.getPointAt(1);
      b.batch(new THREE.ConeGeometry(0.007, 0.05, 6), mat("#9a3b33", { roughness: 0.5 }), new THREE.Matrix4().setPosition(tip.x, tip.y + 0.022, tip.z));
    }
  },
  palm_kentia: (b, w, d, h, f) => {
    // Howea: a clump of slender bare stalks rising from the pot, each opening into a long,
    // broadly arching frond whose narrow leaflets spread from the rachis and hang at their tips
    const rand = random(193);
    const k = Math.min(w, d);
    const ph = Math.min(0.36, h * 0.2);
    const soil = planter(b, k * 0.22, ph, f, "tall");
    const H = h - soil;
    const stalk = mat("#4f6534");
    // three tiers: tall inner fronds, middle ones, low wide outer ones; each a bare stalk up
    // to `stem`, then the rachis arching up to `peak` and out and down to its tip
    const tiers = [
      { n: 3, reach: 0.66, stem: 0.55, peak: 0.98, tip: 0.72 },
      { n: 3, reach: 0.85, stem: 0.42, peak: 0.8, tip: 0.42 },
      { n: 3, reach: 1, stem: 0.3, peak: 0.6, tip: 0.18 },
    ];
    let s = 0;
    for (const t of tiers)
      for (let i = 0; i < t.n; i++, s++) {
        const a = (i / t.n) * TAU + s * 0.7 + rand() * 0.3;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // the stalks come up as a clump of four
        const c = (s % 4) * (TAU / 4) + 0.4;
        const base = v(Math.cos(c) * 0.035, soil - 0.03, Math.sin(c) * 0.035);
        const reach = (k / 2 - 0.06) * t.reach * (0.92 + rand() * 0.08);
        const y = (u: number) => soil + H * u * (0.96 + rand() * 0.04);
        const at = (r: number, yy: number) => v(base.x * (1 - r / reach) + ca * r, yy, base.z * (1 - r / reach) + sa * r);
        const peak = y(t.peak);
        const pts = [base, at(reach * 0.1, y(t.stem)), at(reach * 0.3, peak - (peak - y(t.stem)) * 0.22), at(reach * 0.56, peak), at(reach * 0.78, peak - (peak - y(t.tip)) * 0.4), at(reach, y(t.tip))];
        const curve = new THREE.CatmullRomCurve3(pts);
        const from = Math.min(0.5, pts[0].distanceTo(pts[1]) / curve.getLength());
        // the bare stalk a little thicker than the rachis it carries
        b.batch(tube([base, curve.getPointAt(from * 0.5), curve.getPointAt(from)], (u) => 0.011 - u * 0.003, 3, 5, false), stalk);
        frond(b, curve, { from, pairs: 14, len: 0.3 * Math.min(1.25, k / 1.1 + 0.15), wid: 0.03, droop: 0.95, forward: 0.3, colors: ["#2b5a2c", "#356a33", "#2f612f"], rachis: "#46672f", r: 0.007, rand });
      }
  },
  fern: (b, w, d, h, f) => {
    // Boston fern: a fountain of arching fronds, toothed with leaflets, spilling over the pot
    const rand = random(197);
    const k = Math.min(w, d);
    const ph = Math.min(0.24, h * 0.42);
    const soil = planter(b, k * 0.27, ph, f, "cone");
    const greens = ["#4a8a34", "#5c9a3d", "#3f7a2e", "#6aa346"].map((c) => leafMat(c));
    const np = 13;
    const at: number[] = [0];
    for (let i = 0; i < np; i++) at.push((i + 0.15) / np + 0.02, (i + 0.95) / np);
    at.push(1);
    const tooth = (t: number) => {
      const env = Math.min(1, t * 6) * (1 - t) ** 0.5 + 0.08;
      const fr = (t * np) % 1;
      return env * (fr > 0.5 ? 1 : 0.18);
    };
    const fronds = 20;
    for (let s = 0; s < fronds; s++) {
      const a = (s / fronds) * TAU + rand() * 0.3;
      const inner = s % 3 === 0;
      const len = (inner ? 0.9 : 0.55 + rand() * 0.35) * Math.min(h - soil + 0.15, k * 0.62);
      const leaf = leafOf(len, 0.11 * Math.min(1.3, k / 0.7), { prof: tooth, at, cols: 1, fold: 0.25, bend: inner ? 0.35 : 0.6 + rand() * 0.2, slant: 0.6 });
      const p = v(Math.cos(a) * 0.02, soil - 0.01, Math.sin(a) * 0.02);
      leaf.applyMatrix4(orient(p, dirAt(a, inner ? 1.1 : 0.6 + rand() * 0.3), v(0, 1, 0).addScaledVector(dirAt(a, 0), -0.6).applyAxisAngle(dirAt(a, 0), (rand() - 0.5) * 0.6)));
      b.batch(leaf, greens[s % 4]);
    }
  },
  dracaena: (b, w, d, h, f) => {
    // Dracaena marginata: slender curving bare canes, starbursts of thin red-edged leaves
    const rand = random(199);
    const k = Math.min(w, d);
    const ph = Math.min(0.3, h * 0.2);
    const soil = planter(b, k * 0.32, ph, f, "tall");
    const cane = mat("#857560", { roughness: 1 });
    const colors = ["#3f6d38", "#2f5a2f", "#4a7a3e", "#7a3b3b"].map((c) => leafMat(c));
    const crowns = [[0.2, h - 0.17], [2.4, soil + (h - soil) * 0.68], [4.3, soil + (h - soil) * 0.45]] as const;
    for (const [a, top] of crowns) {
      const out = k * 0.16;
      const end = v(Math.cos(a) * out, top, Math.sin(a) * out);
      const pts = [v(Math.cos(a) * 0.02, soil - 0.03, Math.sin(a) * 0.02), v(Math.cos(a) * out * 0.2 + 0.02, (soil + top) * 0.5, Math.sin(a) * out * 0.2), end];
      b.batch(tube(pts, (t) => 0.014 - t * 0.006, 6, 6), cane);
      for (let i = 0; i < 30; i++) {
        const la = i * 2.4 + rand() * 0.3;
        const e = 1.3 - (i / 30) * 1.8 + (rand() - 0.5) * 0.3;
        const len = (0.23 + rand() * 0.12) * Math.min(1.2, h / 1.5 + 0.2);
        const leaf = leafOf(len, 0.016, { prof: strap, rows: 4, cols: 1, fold: 0.6, bend: 0.1 + Math.max(0, -e) * 0.25 });
        leaf.applyMatrix4(orient(end, dirAt(la, e), v(0, 1, 0)));
        b.batch(leaf, colors[i % 7 === 3 ? 3 : i % 3]);
      }
    }
  },
  yucca: (b, w, d, h, f) => {
    // thick rough canes, rosettes of stiff sword leaves (older ones hang down, yellowing)
    const rand = random(211);
    const k = Math.min(w, d);
    const ph = Math.min(0.32, h * 0.21);
    const soil = planter(b, k * 0.32, ph, f, "classic");
    const bark = mat("#8a7a62", { roughness: 1 });
    const colors = ["#4d7a3a", "#5f8c45", "#3f6d34", "#a39a5c"].map((c) => leafMat(c));
    for (const [ox, oz, top, r] of [[-0.03, 0.01, soil + (h - soil) * 0.62, 0.042], [0.05, -0.03, soil + (h - soil) * 0.42, 0.036], [0.0, 0.05, soil + (h - soil) * 0.25, 0.03]] as const) {
      const end = v(ox * 1.8, top, oz * 1.8);
      b.batch(tube([v(ox, soil - 0.03, oz), v(ox * 1.4, (soil + top) / 2, oz * 1.4), end], (t, th) => r * (1 - t * 0.25) * (1 + 0.05 * Math.cos(th * 7 + t * 20)), 6, 8), bark);
      const n = 30;
      for (let i = 0; i < n; i++) {
        const la = i * 2.4 + rand() * 0.3;
        const e = 1.45 - (i / n) * 1.75 + (rand() - 0.5) * 0.2;
        const len = (0.26 + rand() * 0.12) * Math.min(1.2, h / 1.5 + 0.2);
        const leaf = leafOf(len, 0.035, { prof: (t) => (t < 0.55 ? 0.6 + t * 0.7 : Math.max(0, 1 - ((t - 0.55) / 0.45) ** 1.3)), rows: 4, cols: 1, fold: 0.5, bend: e < 0 ? 0.25 : 0.04 });
        leaf.applyMatrix4(orient(end.clone().add(v(0, 0.02 - (i / n) * 0.05, 0)), dirAt(la, e), UP));
        b.batch(leaf, colors[i > n - 4 ? 3 : i % 3]);
      }
    }
  },
  zz_plant: (b, w, d, h, f) => {
    // Zamioculcas: thick upright stalks with paired glossy oval leaflets
    const rand = random(223);
    const k = Math.min(w, d);
    const ph = Math.min(0.22, h * 0.3);
    const soil = planter(b, k * 0.3, ph, f, "cone");
    const stemM = mat("#3d5a2a", { roughness: 0.5 });
    const greens = ["#1c3a1f", "#24462a", "#2c5230"].map((c) => leafMat(c));
    const oval = (t: number) => Math.sin(Math.PI * t) ** 0.6;
    const n = 9;
    for (let s = 0; s < n; s++) {
      const a = (s / n) * TAU + rand() * 0.3;
      const len = (h - soil) * (0.7 + rand() * 0.3);
      const lean = 0.35 + rand() * 0.25;
      const base = v(Math.cos(a) * 0.025, soil - 0.02, Math.sin(a) * 0.025);
      const top = base.clone().add(dirAt(a, Math.PI / 2 - lean).multiplyScalar(len));
      const midp = base.clone().lerp(top, 0.5).add(v(0, 0.02, 0)).addScaledVector(dirAt(a, 0), -0.02);
      b.batch(tube([base, midp, top], (t) => 0.011 * (1 - t * 0.7), 5, 5), stemM);
      const c = new THREE.CatmullRomCurve3([base, midp, top]);
      const out = dirAt(a, 0);
      const pairs = 6;
      for (let j = 0; j <= pairs; j++) {
        const t = j === pairs ? 1 : 0.32 + (0.64 * j) / pairs;
        const p = c.getPointAt(t);
        const T = c.getTangentAt(t);
        const side = T.clone().cross(out).normalize();
        const size = (0.065 + rand() * 0.015) * Math.min(1.3, k / 0.5) * (j === pairs ? 0.9 : 1);
        for (const sd of j === pairs ? [0] : [-1, 1]) {
          const dir = sd ? side.clone().multiplyScalar(sd).addScaledVector(T, 0.9) : T.clone();
          const leaf = leafOf(size, size * 0.5, { prof: oval, rows: 3, cols: 1, fold: 0.15, cup: 0.15 });
          leaf.applyMatrix4(orient(p, dir, out.clone().add(v(0, 0.5, 0))));
          b.batch(leaf, greens[(j + s) % 3]);
        }
      }
    }
  },
  pothos_stand: (b, w, d, h, f) => {
    // golden pothos on a round oak stand with splayed legs: a mound of leaves, vines trailing down
    const rand = random(227);
    const k = Math.min(w, d);
    const ph = Math.min(0.2, h * 0.22);
    const top = h - ph - 0.12;
    const oak = surface("oak", 0.7);
    const tr = k * 0.32;
    b.cyl(tr, tr, 0.022, 0, top - 0.022, 0, oak, 24);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 2;
      b.batch(tube([v(Math.cos(a) * tr * 0.7, top - 0.02, Math.sin(a) * tr * 0.7), v(Math.cos(a) * (k / 2 - 0.02), 0, Math.sin(a) * (k / 2 - 0.02))].reverse(), (t) => 0.009 + t * 0.005, 1, 6), mat("#b98d5a", { roughness: 0.7 }));
    }
    b.add(new THREE.TorusGeometry(tr * 1.02, 0.006, 4, 24), mat("#b98d5a", { roughness: 0.7 }), 0, top * 0.35, 0).rotation.x = Math.PI / 2;
    const pr = k * 0.24;
    const soil = planter(b, pr, ph, f, "cylinder", top);
    const greens = ["#4f8f38", "#6ba646", "#a8bf55", "#3f7a30"].map((c) => leafMat(c));
    const stem = mat("#6d8a3c");
    for (let i = 0; i < 18; i++) {
      const a = rand() * TAU;
      const p = v(Math.cos(a) * pr * 0.5 * rand(), soil, Math.sin(a) * pr * 0.5 * rand());
      const leaf = leafOf(0.075 + rand() * 0.03, 0.06, { prof: heart, rows: 3, cols: 1, fold: 0.3, lobe: 0.1, bend: 0.2 });
      leaf.applyMatrix4(orient(p.add(v(0, rand() * 0.05, 0)), dirAt(a, 0.2 + rand() * 0.7), UP));
      b.batch(leaf, greens[i % 4]);
    }
    const vines = 8;
    for (let s = 0; s < vines; s++) {
      const a = (s / vines) * TAU + rand() * 0.5;
      const out = dirAt(a, 0);
      const drop = (top + ph) * (0.25 + rand() * 0.6);
      const r0 = pr * 1.05;
      const pts = [v(out.x * pr * 0.5, soil, out.z * pr * 0.5), v(out.x * r0 * 0.95, soil + 0.025, out.z * r0 * 0.95), v(out.x * (r0 + 0.025), soil - 0.015, out.z * (r0 + 0.025)), v(out.x * (r0 + 0.035), soil - ph * 0.5, out.z * (r0 + 0.035)), v(out.x * (tr + 0.03), Math.max(0.03, soil - drop * 0.6), out.z * (tr + 0.03)), v(out.x * (tr + 0.05) + (rand() - 0.5) * 0.06, Math.max(0.02, soil - drop), out.z * (tr + 0.05) + (rand() - 0.5) * 0.06)];
      const curve = new THREE.CatmullRomCurve3(pts);
      b.batch(tube(pts, () => 0.0025, 16, 3), stem);
      const n = Math.round(5 + drop * 16);
      for (let j = 1; j < n; j++) {
        const t = j / n;
        const p = curve.getPointAt(t);
        const sd = j % 2 ? 1 : -1;
        const sdir = curve.getTangentAt(t).cross(UP);
        if (sdir.lengthSq() < 1e-4) sdir.copy(out);
        const dir = sdir.normalize().multiplyScalar(sd).add(v(0, -0.5, 0)).addScaledVector(out, 0.6);
        const size = (0.07 - t * 0.025) * (0.85 + rand() * 0.3);
        const leaf = leafOf(size, size * 0.8, { prof: heart, rows: 3, cols: 1, fold: 0.3, lobe: 0.1, bend: 0.1 });
        leaf.applyMatrix4(orient(p, dir, out));
        b.batch(leaf, greens[(j + s) % 4]);
      }
    }
  },
  cactus_column: (b, w, d, h, f) => {
    // a saguaro-like column: deep ribs, a rounded top, two arms bending upwards, pale spines
    const rand = random(31);
    const k = Math.min(w, d);
    const ph = Math.min(0.26, h * 0.24);
    const soil = planter(b, k * 0.34, ph, f, "cylinder", 0, "#b5a68a");
    pebbles(b, rand, k * 0.28, soil - 0.004, 10, ["#d8d2c4", "#9a9184", "#c7bba5"]);
    const green = mat("#4c7442", { roughness: 0.85 });
    const spine = mat("#e9e2c8", { roughness: 0.8 });
    const R = k * 0.12;
    const dome = (t: number, start: number) => (t < start ? 1 : Math.sqrt(Math.max(0.03, 1 - ((t - start) / (1 - start)) ** 2)));
    const ribsR = (n: number, r: number, start: number) => (t: number, th: number) => r * dome(t, start) * (1 + 0.09 * Math.cos(th * n));
    const tops: [THREE.Curve<V3>, number, number][] = [];
    const mainPts = [v(0, soil - 0.04, 0), v(0.005, soil + (h - soil) * 0.5, 0), v(0, h - 0.004, 0)];
    b.batch(tube(mainPts, ribsR(9, R, 0.92), 12, 27, true, 1.6), green);
    tops.push([new THREE.CatmullRomCurve3(mainPts), 9, R]);
    for (const [a, y, up] of [[0.3, 0.42, 0.3], [0.3 + Math.PI, 0.56, 0.22]] as const) {
      const out = dirAt(a, 0);
      const y0 = soil + (h - soil) * y;
      const r = R * 0.62;
      const pts = [v(0, y0, 0), out.clone().multiplyScalar(R * 1.6).add(v(0, y0 + 0.02, 0)), out.clone().multiplyScalar(R * 2.2).add(v(0, y0 + 0.08, 0)), out.clone().multiplyScalar(R * 2.3).add(v(0, y0 + (h - soil) * up, 0))];
      b.batch(tube(pts, ribsR(7, r, 0.86), 10, 21, true, 1.5), green);
      tops.push([new THREE.CatmullRomCurve3(pts), 7, r]);
    }
    // spines along the rib crests
    for (const [c, n, r] of tops) {
      for (let j = 0; j < 6; j++) {
        const t = 0.3 + (j / 6) * 0.55;
        const p = c.getPointAt(t);
        const T = c.getTangentAt(t);
        const N = T.clone().cross(UP).lengthSq() > 1e-4 ? T.clone().cross(UP).normalize() : v(1, 0, 0);
        const B = T.clone().cross(N).normalize();
        for (let i = j % 2; i < n; i += 2) {
          const th = (i / n) * TAU + j * 0.3;
          const dir = N.clone().multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
          const q = p.clone().addScaledVector(dir, r * 1.06);
          b.batch(new THREE.ConeGeometry(0.003, 0.012, 3, 1, true), spine, orient(q, dir).multiply(new THREE.Matrix4().makeTranslation(0, 0.005, 0)));
        }
      }
    }
  },
  cactus_round: (b, w, d, h, f) => {
    // a ribbed barrel cactus with rows of spines and a pink flower on top
    const rand = random(37);
    const k = Math.min(w, d);
    const ph = h * 0.42;
    const soil = planter(b, k * 0.42, ph, f, "classic", 0, "#b5a68a", 20);
    pebbles(b, rand, k * 0.34, soil - 0.003, 5, ["#d8d2c4", "#9a9184"]);
    const r = k * 0.32;
    const sy = Math.min(1, (h - soil) / (r * 1.7));
    const ball = new THREE.SphereGeometry(r, 36, 10);
    const ribsN = 12;
    const p = ball.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const kk = 1 + 0.08 * Math.cos(Math.atan2(p.getZ(i), p.getX(i)) * ribsN);
      p.setXYZ(i, p.getX(i) * kk, p.getY(i) * sy, p.getZ(i) * kk);
    }
    ball.computeVertexNormals();
    const cy = soil + r * sy * 0.8;
    b.add(ball, mat("#4f7a45", { roughness: 0.85 }), 0, cy, 0);
    const spine = mat("#efe6c6", { roughness: 0.8 });
    for (let i = 0; i < ribsN; i++) {
      const a = (i / ribsN) * TAU;
      for (const lat of [0.35, 0.75, 1.15]) {
        const dir = v(Math.cos(a) * Math.sin(lat), Math.cos(lat) * sy, Math.sin(a) * Math.sin(lat));
        const q = v(Math.cos(a) * Math.sin(lat) * r * 1.08, cy + Math.cos(lat) * r * sy, Math.sin(a) * Math.sin(lat) * r * 1.08);
        b.batch(new THREE.ConeGeometry(0.0025, 0.01, 3, 1, true), spine, orient(q, dir).multiply(new THREE.Matrix4().makeTranslation(0, 0.004, 0)));
      }
    }
    const top = v(0, cy + r * sy - 0.004, 0);
    const petal = leafMat("#e8638f");
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const leaf = leafOf(0.03, 0.014, { prof: ellipse, rows: 3, cols: 1, cup: 0.4 });
      leaf.applyMatrix4(orient(top, dirAt(a, 0.75 + (i % 2) * 0.25), v(-Math.cos(a), 0.6, -Math.sin(a))));
      b.batch(leaf, petal);
    }
    b.batch(new THREE.IcosahedronGeometry(0.006, 0), mat("#f2d25a"), new THREE.Matrix4().setPosition(top.x, top.y + 0.01, top.z));
  },
  succulent_bowl: (b, w, d, h, f) => {
    // a low bowl of rosettes (echeveria in blue-grey, pink and jade), a spiky haworthia, pebbles
    const rand = random(229);
    const k = Math.min(w, d);
    const r = k / 2 - 0.005;
    const soil = planter(b, r, h * 0.62, f, "bowl", 0, "#8a7560", 28);
    pebbles(b, rand, r * 0.75, soil - 0.002, 14, ["#e6e1d6", "#b9b2a4", "#8d877c"]);
    const kinds = [["#8fa9a3", "#a3bab3"], ["#b49aa6", "#c8b0b5"], ["#6f9a5a", "#86ad6a"], ["#8fa9a3", "#a6b58a"], ["#7a6a8c", "#9a8aa8"]];
    const spots: [number, number, number][] = [[0, 0, 0.065], [0.6, 0.55, 0.05], [2.0, 0.6, 0.055], [3.3, 0.55, 0.045], [4.5, 0.6, 0.05]];
    spots.forEach(([a, rr, s], j) => {
      const c = v(Math.cos(a) * rr * r, soil - 0.005, Math.sin(a) * rr * r);
      const size = s * Math.min(1.3, k / 0.36);
      const m = kinds[j].map((col) => mat(col, { roughness: 0.6 }));
      for (let ring = 0; ring < 4; ring++) {
        const count = [9, 8, 6, 4][ring];
        const len = size * [1, 0.8, 0.58, 0.38][ring];
        for (let i = 0; i < count; i++) {
          const la = (i / count) * TAU + ring * 0.4 + rand() * 0.15;
          const leaf = lens(len, len * 0.55, len * 0.22);
          leaf.applyMatrix4(orient(c.clone().add(v(0, ring * size * 0.07, 0)), dirAt(la, 0.2 + ring * 0.35), UP));
          b.batch(leaf, m[(ring + i) % 2]);
        }
      }
    });
    // a haworthia: upright pointed leaves
    const hc = v(Math.cos(5.6) * r * 0.55, soil - 0.005, Math.sin(5.6) * r * 0.55);
    for (let i = 0; i < 12; i++) {
      const la = i * 2.4;
      const leaf = lens(0.05 + rand() * 0.015, 0.016, 0.009);
      leaf.applyMatrix4(orient(hc, dirAt(la, 1.0 + (i / 12) * 0.4), UP));
      b.batch(leaf, mat(i % 2 ? "#3e5f3a" : "#4b6f44", { roughness: 0.6 }));
    }
  },
  aloe: (b, w, d, h, f) => {
    // aloe vera: a rosette of thick, keeled, grey-green leaves arching out of the pot
    const rand = random(233);
    const k = Math.min(w, d);
    const ph = Math.min(0.2, h * 0.38);
    const soil = planter(b, k * 0.38, ph, f, "classic", 0, C.soil, 20);
    const colors = [mat("#6f9a6a", { roughness: 0.6 }), mat("#7fa877", { roughness: 0.6 }), mat("#5f8a5c", { roughness: 0.6 })];
    const n = 13;
    const ws = Math.min(1.3, k / 0.32);
    for (let i = 0; i < n; i++) {
      const a = i * 2.4;
      const inner = i / n;
      const len = (h - soil) * (1.2 - inner * 0.45) * (0.9 + rand() * 0.15);
      const e = 0.7 + inner * 0.65;
      const leaf = fleshy(len, 0.06 * ws * (1 - inner * 0.35), 0.02 * ws, 0.1 + (1 - inner) * 0.2, 5);
      leaf.applyMatrix4(orient(v(Math.cos(a) * 0.012, soil - 0.012, Math.sin(a) * 0.012), dirAt(a, e), v(0, 1, 0).addScaledVector(dirAt(a, 0), -0.6)));
      b.batch(leaf, colors[i % 3]);
    }
  },
  bird_of_paradise: (b, w, d, h, f) => {
    // Strelitzia: big torn paddle leaves fanned out on long upright stalks, one orange-blue flower
    const rand = random(239);
    const k = Math.min(w, d);
    const ph = Math.min(0.36, h * 0.21);
    const soil = planter(b, k * 0.27, ph, f, "tall");
    const stemM = mat("#56764a");
    const greens = ["#2f5a32", "#3a6a3a", "#2a5230"].map((c) => leafMat(c));
    const paddle = (t: number) => (t >= 1 ? 0 : Math.sin(Math.PI * Math.min(1, 0.06 + t)) ** 0.45 * (t > 0.85 ? Math.sqrt(1 - ((t - 0.85) / 0.15) ** 2) * 0.6 + 0.4 : 1));
    const ls = Math.min(1.25, Math.max(0.6, Math.min(h / 1.7, k / 0.9)));
    let i = 0;
    for (const [fa, cnt] of [[0.3, 6], [0.3 + Math.PI / 2 + 0.3, 5]] as const) {
      const plane = dirAt(fa, 0);
      const normal = dirAt(fa + Math.PI / 2, 0);
      for (let j = 0; j < cnt; j++, i++) {
        const spread = (j / (cnt - 1) - 0.5) * 1.6 + (rand() - 0.5) * 0.15;
        const len = (0.44 + rand() * 0.12) * ls;
        const stemLen = Math.max(0.1, (h - soil - len * 0.9) * (0.75 + rand() * 0.25) - Math.abs(spread) * 0.15);
        const dir = v(0, Math.cos(spread), 0).addScaledVector(plane, Math.sin(spread));
        const base = v(plane.x * 0.02 * (j - cnt / 2), soil - 0.02, plane.z * 0.02 * (j - cnt / 2)).addScaledVector(normal, (i % 2) * 0.03 - 0.015);
        const top = base.clone().addScaledVector(dir, stemLen);
        stalk(b, [base, base.clone().lerp(top, 0.5).addScaledVector(dir, 0.01), top], 0.009, 0.006, stemM, 3, 5);
        const tears: [number, number, number][] = [];
        for (let q = 0; q < 2 + (i % 3); q++) tears.push([0.25 + rand() * 0.6, 1, rand() > 0.5 ? 1 : -1]);
        const leaf = leafOf(len, len * 0.4, { prof: paddle, rows: 7, cols: 2, fold: 0.12, bend: 0.1 + Math.abs(spread) * 0.15, slits: tears, slant: 0.5 });
        const lean = dir.clone().addScaledVector(dir.clone().setY(0), 0.5);
        leaf.applyMatrix4(orient(top, lean, normal.clone().multiplyScalar(i % 2 ? 1 : -1).add(v(0, 0.8, 0))));
        b.batch(leaf, greens[i % 3]);
      }
    }
    // the flower: a beak-like bract held sideways, orange petals and a blue tongue on top
    const fb = v(0.03, soil + (h - soil) * 0.6, 0.06);
    stalk(b, [v(0.01, soil - 0.02, 0.02), fb], 0.006, 0.005, stemM, 1, 5);
    const beak = dirAt(0.9, 0.15);
    const bract = leafOf(0.18, 0.045, { prof: (t) => (t >= 1 ? 0 : Math.sin(Math.PI * (0.15 + t * 0.85)) ** 0.6), rows: 4, cols: 1, cup: 0.8, bend: -0.06 });
    bract.applyMatrix4(orient(fb, beak, v(0, 1, 0)));
    b.batch(bract, leafMat("#4a6a52"));
    const crest = fb.clone().addScaledVector(beak, 0.06).add(v(0, 0.01, 0));
    for (let q = 0; q < 4; q++) {
      const petal = leafOf(0.1, 0.022, { prof: lance, rows: 2, cols: 1, fold: 0.4 });
      petal.applyMatrix4(orient(crest.clone().addScaledVector(beak, q * 0.014), v(0, 1, 0).addScaledVector(beak, -0.4 + q * 0.2).applyAxisAngle(beak, (q - 1.5) * 0.3), beak.clone().negate()));
      b.batch(petal, leafMat("#f08a2a"));
    }
    const tongue = leafOf(0.07, 0.014, { prof: lance, rows: 2, cols: 1, fold: 0.4 });
    tongue.applyMatrix4(orient(crest.clone().addScaledVector(beak, 0.025), v(0, 1, 0).addScaledVector(beak, 0.7), beak.clone().negate()));
    b.batch(tongue, leafMat("#3f5fb0"));
  },
  money_tree: (b, w, d, h, f) => {
    // Pachira: a braided trunk on a swollen base, a crown of hand-shaped leaves
    const rand = random(241);
    const k = Math.min(w, d);
    const ph = Math.min(0.26, h * 0.22);
    const soil = planter(b, k * 0.3, ph, f, "ribbed");
    const top = soil + (h - soil) * 0.45;
    const bark = mat("#8a7658", { roughness: 0.9 });
    b.add(new THREE.SphereGeometry(0.045, 12, 6, 0, TAU, 0, Math.PI / 2), bark, 0, soil - 0.02, 0).scale.set(1, 0.8, 1);
    const ends: V3[] = [];
    for (let s = 0; s < 4; s++) {
      const pts: V3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const ang = (s / 4) * TAU + t * Math.PI * 2.5;
        const rr = 0.022 * (1 - t * 0.3);
        pts.push(v(Math.cos(ang) * rr, soil - 0.02 + t * (top - soil), Math.sin(ang) * rr));
      }
      b.batch(tube(pts, (t) => 0.014 - t * 0.005, 14, 6), bark);
      ends.push(pts[8]);
    }
    const greens = ["#3f7a34", "#4c8a3a", "#5c9a45", "#356b2e"].map((c) => leafMat(c));
    const stemM = mat("#557a3a");
    const ls = Math.min(1.3, Math.max(0.6, k / 0.65));
    const n = 19;
    for (let s = 0; s < n; s++) {
      const from = ends[s % 4];
      const a = s * 2.4 + rand() * 0.4;
      const reach = (k / 2) * (0.2 + rand() * 0.45);
      const tip = v(Math.cos(a) * reach, from.y + (h - from.y - 0.05) * (0.25 + (s / n) * 0.75 * (0.75 + rand() * 0.25)), Math.sin(a) * reach);
      stalk(b, bow(from, tip, 0.15), 0.0035, 0.0025, stemM, 4, 4);
      const out = tip.clone().sub(from).setY(0).normalize();
      for (let l = 0; l < 5; l++) {
        const la = Math.atan2(out.z, out.x) + (l - 2) * 0.6;
        const leaf = leafOf((0.13 + rand() * 0.03) * ls * (l === 2 ? 1.1 : 0.88), 0.05 * ls, { prof: lance, rows: 3, cols: 1, fold: 0.25, bend: 0.18 });
        leaf.applyMatrix4(orient(tip, dirAt(la, -0.1 - rand() * 0.2), UP));
        b.batch(leaf, greens[(l + s) % 4]);
      }
    }
  },
};
