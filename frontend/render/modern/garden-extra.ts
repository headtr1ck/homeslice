// More detailed built-in pieces: the garden and outdoor pieces the first pass left as they
// were. Each entry replaces the piece of the same key in ../modern.ts (same size, finishes
// and frame: centred, front at +z, on y = 0).
//
// Fences and paths are repeated along long runs, so they stay lean: plain boxes and short
// extrusions, batched per material (≤ 1,500 triangles per 3 m of fence).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, glowMat, glowing, leafMat, mat, matrix, part, random, v } from "../modern";
import type { Build, Builder } from "../modern";

type M = THREE.Material;
type Std = THREE.MeshStandardMaterial;
type V3 = THREE.Vector3;
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

// ----- helpers -----

/** The colour of a material, as a CSS string. */
const colorOf = (m: M) => ((m as Std).color ?? new THREE.Color("#888")).getStyle();
/** A colour a shade lighter (k > 1) or darker (k < 1). */
const shade = (c: string, k: number) => {
  const col = new THREE.Color(c);
  return (k > 1 ? col.lerp(new THREE.Color("#ffffff"), k - 1) : col.multiplyScalar(k)).getStyle();
};
const tints = new Map<string, Std>();
/** The finish a shade darker (k < 1) or lighter, keeping its texture. */
function tint(f: M, k: number): Std {
  const key = `${f.uuid}/${k}`;
  let m = tints.get(key);
  if (!m) {
    m = (f as Std).clone();
    if (k < 1) m.color.multiplyScalar(k);
    else m.color.lerp(new THREE.Color("#ffffff"), k - 1);
    tints.set(key, m);
  }
  return m;
}
/** A metal in a colour. */
const metal = (c: string, rough = 0.35) => mat(c, { metalness: 0.6, roughness: rough });
/** A cloth (sails, slings) in a colour, seen from both sides. */
const cloth = (c: string) => mat(c, { side: THREE.DoubleSide, roughness: 1 });

/** A box (bottom centre at x, y, z), merged with others of its material; turned by rx, ry, rz. */
function bbox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, rx = 0, ry = 0, rz = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.batch(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), m, matrix(x, y, z, rx, ry, rz));
}
/** A rounded box, merged (bottom centre). */
function rbox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, r: number, rx = 0, ry = 0, seg = 1) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const geo = rr > 0.002 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  b.batch(geo.translate(0, h / 2, 0), m, matrix(x, y, z, rx, ry));
}
/** A box from a to c (its long side), w wide (across, kept level) and t thick, merged. */
function beam(b: Builder, a: V3, c: V3, w: number, t: number, m: M, round = 0, side?: V3) {
  const len = a.distanceTo(c);
  if (len < 1e-4) return;
  const geo = round > 0.002 ? new RoundedBoxGeometry(w, len, t, 1, Math.min(round, w / 2 - 1e-3, t / 2 - 1e-3)) : new THREE.BoxGeometry(w, len, t);
  const dir = c.clone().sub(a).normalize();
  const across = side ?? (Math.abs(dir.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
  const z = across.clone().cross(dir).normalize();
  const x = dir.clone().cross(z).normalize();
  b.batch(geo, m, new THREE.Matrix4().makeBasis(x, dir, z).setPosition(a.clone().add(c).multiplyScalar(0.5)));
}
/** A round rod from a to c (radius r0 at a, r1 at c), merged. */
function limb(b: Builder, a: V3, c: V3, r0: number, r1: number, m: M, seg = 8) {
  const len = a.distanceTo(c);
  if (len < 1e-4) return;
  const geo = new THREE.CylinderGeometry(r1, r0, len, seg);
  b.batch(geo, m, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, c.clone().sub(a).normalize()), v(1, 1, 1)));
}
/** A bent tube along points (closed at both ends by small spheres when `caps`), merged. */
function pipe(b: Builder, pts: V3[], r: number, m: M, seg = 12, radial = 6, caps = true) {
  const curve = new THREE.CatmullRomCurve3(pts);
  b.batch(new THREE.TubeGeometry(curve, seg, r, radial, false), m);
  if (caps) for (const p of [pts[0], pts[pts.length - 1]]) b.batch(new THREE.SphereGeometry(r, radial, 4), m, matrix(p.x, p.y, p.z));
}
/** A lathe (profile from the axis outwards and up, points as [r, y]), merged at (x, y, z). */
function lathe(b: Builder, profile: [number, number][], m: M, x = 0, y = 0, z = 0, seg = 32) {
  b.batch(new THREE.LatheGeometry(profile.map(([r, yy]) => new THREE.Vector2(Math.max(r, 0.0005), yy)), seg), m, matrix(x, y, z));
}
/** A flat shape in the xy plane extruded along z by t, its back at z = 0. */
const slab = (s: THREE.Shape, t: number, curve = 6) => new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: curve });
/** A pointed board outline (pickets): pw wide, ph tall, the point tip tall. */
function picketShape(pw: number, ph: number, tip: number) {
  return new THREE.Shape([new THREE.Vector2(-pw / 2, 0), new THREE.Vector2(pw / 2, 0), new THREE.Vector2(pw / 2, ph - tip), new THREE.Vector2(0, ph), new THREE.Vector2(-pw / 2, ph - tip)]);
}
/** A low pyramid cap on a post, its base at y. */
function postCap(b: Builder, x: number, y: number, z: number, s: number, m: M) {
  bbox(b, s, 0.02, s, x, y, z, m);
  b.batch(new THREE.ConeGeometry(s * 0.68, s * 0.35, 4, 1).rotateY(Math.PI / 4), m, matrix(x, y + 0.02 + s * 0.175, z));
}
/** Evenly spaced post positions along x for a fence run of width w (posts at both ends). */
function postsAlong(w: number, ps: number, bay: number) {
  const n = Math.max(1, Math.round((w - ps) / bay));
  return Array.from({ length: n + 1 }, (_, i) => -w / 2 + ps / 2 + (i * (w - ps)) / n);
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  // ----- fences and the gate -----
  fence_slats: (b, w, d, h, f, _c, a) => {
    // horizontal slats between metal posts, held in a channel at the top and the bottom
    const ps = 0.07;
    const xs = postsAlong(w, ps, 1.8);
    const t = Math.min(0.022, d * 0.4);
    const rows = Math.max(3, Math.round((h - 0.08) / 0.115));
    const pitch = (h - 0.08) / rows;
    for (const x of xs) {
      bbox(b, ps, h - 0.012, ps, x, 0, 0, a);
      bbox(b, ps + 0.012, 0.012, ps + 0.012, x, h - 0.012, 0, a);
    }
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i] + ps / 2;
      const x1 = xs[i + 1] - ps / 2;
      const cx = (x0 + x1) / 2;
      const len = x1 - x0;
      // channels: a lip each side of the slats
      for (const y of [0.02, h - 0.05]) bbox(b, len, 0.03, t + 0.016, cx, y, 0, a);
      for (let r = 0; r < rows; r++) bbox(b, len, pitch * 0.8, t, cx, 0.05 + r * pitch + pitch * 0.1, 0, f);
    }
  },
  fence_planks: (b, w, d, h, f) => {
    // a close-board fence: square posts with caps, a gravel board, overlapping vertical
    // boards on rails at the back, a capping rail along the top
    const ps = 0.09;
    const xs = postsAlong(w, ps, 1.8);
    const post = tint(f, 0.82);
    const zb = Math.min(0.03, d * 0.3);
    for (const x of xs) {
      bbox(b, ps, h - 0.05, ps, x, 0, -0.01, post);
      postCap(b, x, h - 0.05, -0.01, ps + 0.02, post);
    }
    const gravel = mat("#8e8a83", { roughness: 1 });
    const gb = Math.min(0.15, h * 0.1);
    bbox(b, w - 0.01, gb, 0.025, 0, 0, zb, gravel);
    for (const y of [h * 0.18, h * 0.5, h * 0.82]) bbox(b, w - 0.04, 0.07, 0.035, 0, y, -0.035, post);
    const n = Math.max(4, Math.round(w / 0.105));
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      // each board overlaps the next: alternately a little forward, a little turned
      const x = -w / 2 + bw * (i + 0.5);
      bbox(b, bw + 0.012, h - gb - 0.06, 0.016, x, gb, zb + (i % 2) * 0.006, f, 0, (i % 2 ? 1 : -1) * 0.05);
    }
    // the capping rail and its counter batten
    bbox(b, w, 0.025, 0.06, 0, h - 0.06, zb - 0.002, post);
    bbox(b, w, 0.02, 0.03, 0, h - 0.085, zb + 0.022, post);
  },
  fence_picket: (b, w, d, h, f) => {
    // pointed pickets on two rails, square posts with caps every bay
    const ps = 0.075;
    const xs = postsAlong(w, ps, 1.6);
    const rail = tint(f, 0.92);
    for (const x of xs) {
      bbox(b, ps, h - 0.06, ps, x, 0, -0.01, f);
      postCap(b, x, h - 0.06, -0.01, ps + 0.02, f);
    }
    const t = Math.min(0.018, d * 0.3);
    for (const y of [0.16, h - 0.3]) bbox(b, w - 0.02, 0.065, 0.022, 0, y, -0.012, rail);
    const pw = 0.07;
    const gap = 0.055;
    const ph = h - 0.1;
    const picket = slab(picketShape(pw, ph, 0.07), t);
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i] + ps / 2 + 0.02;
      const x1 = xs[i + 1] - ps / 2 - 0.02;
      const n = Math.max(1, Math.round((x1 - x0 + gap) / (pw + gap)));
      for (let k = 0; k < n; k++) {
        const x = x0 + ((x1 - x0) * (k + 0.5)) / n;
        b.batch(picket.clone(), f, matrix(x, 0.05, 0.002));
      }
    }
  },
  garden_gate: (b, w, d, h, f, _c, a) => {
    // a ledged and braced gate with a bowed top between two capped posts: strap hinges and a
    // ring latch in the accent
    const ps = 0.1;
    const post = tint(f, 0.8);
    for (const sx of [-1, 1]) {
      bbox(b, ps, h - 0.06, ps, sx * (w / 2 - ps / 2), 0, -0.005, post);
      postCap(b, sx * (w / 2 - ps / 2), h - 0.06, -0.005, ps + 0.02, post);
    }
    const gw = w - 2 * ps - 0.03;
    const y0 = 0.06;
    const top = h - 0.08;
    const bow = Math.min(0.12, (top - y0) * 0.12);
    const n = Math.max(5, Math.round(gw / 0.1));
    const bw = gw / n;
    const zf = 0.012;
    for (let i = 0; i < n; i++) {
      const x = -gw / 2 + bw * (i + 0.5);
      const u = x / (gw / 2);
      const bh = top - bow - y0 + bow * (1 - u * u);
      rbox(b, bw - 0.008, bh, 0.02, x, y0, zf, f, 0.004);
    }
    // ledges and the brace behind the boards (rising from the hinge side at the bottom)
    const ledge = tint(f, 0.9);
    const lb = y0 + 0.12;
    const lt = top - bow - 0.18;
    for (const y of [lb, lt]) bbox(b, gw - 0.04, 0.09, 0.025, 0, y, -0.012, ledge);
    beam(b, v(-gw / 2 + 0.1, lb + 0.09, -0.012), v(gw / 2 - 0.1, lt, -0.012), 0.08, 0.025, ledge);
    // strap hinges on the left post side, wrapping over the front
    const hw = a;
    for (const y of [lb + 0.045, lt + 0.045]) {
      bbox(b, gw * 0.42, 0.03, 0.006, -gw / 2 + gw * 0.21, y - 0.015, zf + 0.022, hw);
      b.batch(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8), hw, matrix(-gw / 2 - 0.012, y - 0.035, zf + 0.012));
    }
    // a ring latch and a keeper on the opening side
    const ly = (lb + lt) / 2 + 0.12;
    bbox(b, 0.05, 0.08, 0.006, gw / 2 - 0.06, ly - 0.04, zf + 0.022, hw);
    b.batch(new THREE.TorusGeometry(0.03, 0.006, 6, 16), hw, matrix(gw / 2 - 0.06, ly - 0.055, zf + 0.03));
    bbox(b, 0.07, 0.025, 0.02, gw / 2 + 0.005, ly + 0.01, zf + 0.01, hw);
    void d;
  },

  // ----- water -----
  fountain: (b, w, d, h, f) => {
    // a stone fountain: a round basin with a rolled rim, a baluster, two bowls one above the
    // other, water in each and falling in a thin veil from their rims, a finial on top
    const r = Math.min(w, d) / 2;
    const s = r / 0.6;
    const water = mat("#5fb4d8", { transparent: true, opacity: 0.75, roughness: 0.05 });
    const veil = mat("#a9dcf0", { transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide });
    const bh = Math.min(0.42, h * 0.34);
    const floor = 0.1 * s;
    lathe(b, [[0, 0], [r * 0.93, 0], [r * 0.95, 0.02], [r * 0.95, 0.05], [r * 0.92, 0.07], [r * 0.95, bh * 0.72], [r, bh * 0.78], [r, bh * 0.95], [r * 0.98, bh], [r * 0.9, bh], [r * 0.88, bh * 0.94], [r * 0.87, floor], [0, floor]], f, 0, 0, 0, 40);
    const wy = bh * 0.8;
    b.batch(new THREE.CircleGeometry(r * 0.877, 40).rotateX(-Math.PI / 2), water, matrix(0, wy, 0));
    // the baluster up to the first bowl
    const y1 = Math.max(bh + 0.1, h * 0.5);
    const ph = y1 - floor;
    const k = 0.12 * s;
    lathe(b, [[0, 0], [k * 1.4, 0], [k * 1.4, ph * 0.05], [k * 1.1, ph * 0.09], [k * 0.75, ph * 0.3], [k * 0.95, ph * 0.55], [k * 0.6, ph * 0.85], [k * 0.75, ph * 0.93], [k * 0.9, ph], [0, ph]], f, 0, floor, 0, 20);
    const bowl = (ru: number, bd: number, y: number) => {
      lathe(b, [[0, 0], [ru * 0.2, 0], [ru * 0.3, bd * 0.12], [ru * 0.62, bd * 0.4], [ru * 0.92, bd * 0.82], [ru, bd], [ru * 0.98, bd * 1.08], [ru * 0.93, bd * 1.04], [ru * 0.84, bd * 0.76], [0, bd * 0.55]], f, 0, y, 0, 32);
      b.batch(new THREE.CircleGeometry(ru * 0.9, 32).rotateX(-Math.PI / 2), water, matrix(0, y + bd * 0.86, 0));
    };
    const ru = r * 0.48;
    const bd = 0.13 * s;
    bowl(ru, bd, y1);
    // the veil from the first bowl down into the basin
    const v1 = y1 + bd * 1.02 - wy;
    b.batch(new THREE.CylinderGeometry(ru * 1.0, ru * 1.18, v1, 32, 1, true), veil, matrix(0, wy + v1 / 2, 0));
    // a stem up to the small bowl, its veil into the first one
    const y2 = y1 + bd + (h - y1 - bd) * 0.42;
    const r2 = r * 0.22;
    const bd2 = bd * 0.7;
    lathe(b, [[0, 0], [0.06 * s, 0], [0.04 * s, (y2 - y1) * 0.4], [0.05 * s, (y2 - y1) * 0.8], [0.06 * s, y2 - y1 - bd * 0.5 + 0.02], [0, y2 - y1 - bd * 0.5 + 0.02]], f, 0, y1 + bd * 0.5, 0, 16);
    bowl(r2, bd2, y2);
    const v2 = y2 + bd2 * 1.02 - (y1 + bd * 0.86);
    b.batch(new THREE.CylinderGeometry(r2 * 1.0, r2 * 1.2, v2, 24, 1, true), veil, matrix(0, y1 + bd * 0.86 + v2 / 2, 0));
    // the finial: a short neck, a ball and a point
    const fy = y2 + bd2 * 0.55;
    const fh = h - fy;
    lathe(b, [[0, 0], [0.035 * s, 0], [0.025 * s, fh * 0.3], [0.05 * s, fh * 0.45], [0.06 * s, fh * 0.6], [0.045 * s, fh * 0.78], [0.012 * s, fh * 0.95], [0, fh]], f, 0, fy, 0, 16);
  },
  pond: (b, w, d, h, f) => {
    // a pond in an irregular round: the water (lit by a linked pump or light), a ring of
    // flat stones in two sizes, lily pads with a flower
    const rand = random(313);
    const edge = (a: number) => 0.84 + 0.06 * Math.sin(2 * a + 1) + 0.04 * Math.sin(3 * a + 2.2) + 0.02 * Math.sin(5 * a);
    const s = new THREE.Shape();
    const N = 40;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const k = edge(a);
      const p = new THREE.Vector2((Math.cos(a) * w * k) / 2, (-Math.sin(a) * d * k) / 2);
      if (i === 0) s.moveTo(p.x, p.y);
      else s.lineTo(p.x, p.y);
    }
    const wy = h * 0.4;
    b.add(new THREE.ShapeGeometry(s, 4).rotateX(-Math.PI / 2), glowing(part(mat("#3f7f9a", { roughness: 0.05 }), "water")), 0, wy, 0);
    // a dark band under the water's edge (the liner seen through the shallows)
    const band = new THREE.Shape();
    const hole = new THREE.Path();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const k = edge(a);
      const po = new THREE.Vector2((Math.cos(a) * w * (k + 0.06)) / 2, (-Math.sin(a) * d * (k + 0.06)) / 2);
      const pi = new THREE.Vector2((Math.cos(a) * w * (k - 0.02)) / 2, (-Math.sin(a) * d * (k - 0.02)) / 2);
      if (i === 0) (band.moveTo(po.x, po.y), hole.moveTo(pi.x, pi.y));
      else (band.lineTo(po.x, po.y), hole.lineTo(pi.x, pi.y));
    }
    band.holes.push(hole);
    b.batch(new THREE.ShapeGeometry(band, 1).rotateX(-Math.PI / 2), mat("#3b3f3a", { roughness: 1 }), matrix(0, wy - 0.004, 0));
    // stones: big ones on the edge, smaller ones between and outside them
    const stones = [f, tint(f, 0.85), tint(f, 1.12)];
    const stone = (a: number, k: number, size: number, i: number) => {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const x = (Math.cos(a) * w * k) / 2;
      const z = (-Math.sin(a) * d * k) / 2;
      b.batch(g, stones[i % 3], new THREE.Matrix4().compose(v(x, size * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 0.3, rand() * TAU, rand() * 0.3)), v(size * (1.1 + rand() * 0.4), size * 0.5, size * (0.9 + rand() * 0.3))));
    };
    const ring = Math.max(14, Math.round((Math.PI * (w + d)) / 2 / 0.24));
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * TAU + rand() * 0.08;
      stone(a, edge(a) + 0.04, 0.1 + rand() * 0.05, i);
      if (i % 2) stone(a + Math.PI / ring, edge(a) + 0.1 + rand() * 0.04, 0.06 + rand() * 0.03, i + 1);
    }
    // lily pads (each with its notch), a flower on one
    const pad = leafMat("#4f8a3a");
    const pad2 = leafMat("#5f9a44");
    for (let i = 0; i < 7; i++) {
      const pr = 0.07 + rand() * 0.06;
      const x = (rand() - 0.2) * w * 0.4;
      const z = (rand() - 0.5) * d * 0.45;
      b.batch(new THREE.CircleGeometry(pr, 14, 0.25, TAU - 0.5).rotateX(-Math.PI / 2), i % 2 ? pad : pad2, matrix(x, wy + 0.004, z, 0, rand() * TAU));
      if (i === 1 || i === 4) {
        const petal = mat(i === 1 ? "#f4c6d6" : "#f6f2ea", { roughness: 0.7 });
        for (let p = 0; p < 8; p++) {
          const a = (p / 8) * TAU;
          b.batch(new THREE.ConeGeometry(0.014, 0.05, 4).translate(0, 0.025, 0), petal, matrix(x + Math.cos(a) * 0.012, wy + 0.008, z + Math.sin(a) * 0.012, 0, -a, -0.9 + (p % 2) * 0.35));
        }
        b.batch(new THREE.SphereGeometry(0.012, 8, 4), mat("#e8c24a"), matrix(x, wy + 0.016, z));
      }
    }
  },

  // ----- seating -----
  garden_sofa: (b, w, d, h, f, color, a) => {
    // a lounge sofa: a frame with slatted arms and back, thick seat and back cushions, two
    // scatter cushions
    const frame = a;
    const dark = mat("#26272a", { roughness: 0.8 });
    const aw = 0.075;
    const armH = Math.min(0.6, h * 0.84);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - aw / 2);
      for (const z of [d / 2 - 0.03, -d / 2 + 0.03]) {
        rbox(b, aw, armH - 0.05, 0.05, x, 0.03, z, frame, 0.006);
        bbox(b, aw * 0.8, 0.03, 0.045, x, 0, z, dark);
      }
      rbox(b, aw + 0.012, 0.035, d, x, armH - 0.035, 0, frame, 0.008);
      for (let i = 0; i < 4; i++) bbox(b, aw * 0.5, 0.05, d - 0.08, x, 0.14 + i * ((armH - 0.24) / 3.4), 0, frame);
    }
    // the base rails and a slatted back panel behind the cushions
    for (const z of [d / 2 - 0.03, -d / 2 + 0.03]) rbox(b, w - 2 * aw, 0.1, 0.04, 0, 0.12, z, frame, 0.006);
    const back = h - 0.06;
    for (let i = 0; i < 5; i++) bbox(b, w - 2 * aw, 0.06, 0.025, 0, 0.26 + i * ((back - 0.3) / 4.4), -d / 2 + 0.02, frame);
    rbox(b, w - 2 * aw, 0.035, 0.05, 0, back - 0.035, -d / 2 + 0.03, frame, 0.008);
    bbox(b, w - 2 * aw, 0.03, d - 0.08, 0, 0.19, 0, dark);
    // cushions
    const n = Math.max(1, Math.round((w - 2 * aw) / 0.75));
    const cw = (w - 2 * aw - 0.01) / n;
    const seatD = d - 0.2;
    const seatY = 0.22;
    const ct = Math.min(0.15, armH - seatY - 0.12);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + aw + 0.005 + cw * (i + 0.5);
      rbox(b, cw - 0.012, ct, seatD, x, seatY, d / 2 - 0.02 - seatD / 2, f, 0.04, 0, 0, 2);
      const bhgt = Math.min(0.42, back - seatY - ct + 0.02);
      rbox(b, cw - 0.02, bhgt, 0.15, x, seatY + ct - 0.02, -d / 2 + 0.12, f, 0.045, -0.16, 0, 2);
    }
    // scatter cushions in a contrasting colour, leaning in the corners
    const pillow = mat(color === "sand" ? "#5d7a60" : "#c9b38f", { roughness: 1 });
    for (const sx of [-1, 1]) {
      const geo = new RoundedBoxGeometry(0.4, 0.38, 0.12, 2, 0.05);
      b.batch(geo, pillow, matrix(sx * (w / 2 - aw - 0.26), seatY + ct + 0.18, -d / 2 + 0.27, -0.28, sx * 0.25, sx * 0.08));
    }
  },
  adirondack_chair: (b, w, d, h, f) => {
    // the classic: sloping seat on long stringers, a tall fan of back slats with a curved top,
    // broad flat arms on front legs with small brackets
    const fz = d / 2;
    const legZ = fz - 0.16;
    const legX = w / 2 - 0.1;
    const armY = Math.min(0.6, h * 0.64);
    const t = 0.022;
    // stringers: from the front edge down to the ground at the back
    const sf = v(0, 0.36, fz - 0.03);
    const sb = v(0, 0.02, -d / 2 + 0.16);
    for (const sx of [-1, 1]) {
      const x = sx * (legX - 0.035);
      beam(b, v(x, sf.y - 0.06, sf.z), v(x, sb.y, sb.z), 0.025, 0.1, f, 0.005);
      // front legs, outside the stringers
      rbox(b, 0.035, armY - 0.003, 0.085, sx * legX, 0, legZ, f, 0.005);
      // arms: broad boards, a bracket under the front
      rbox(b, 0.14, t, d * 0.7, sx * (legX + 0.01), armY, fz - 0.02 - d * 0.35, f, 0.006);
      bbox(b, 0.03, 0.087, 0.08, sx * legX, armY - 0.09, legZ + 0.085, f);
    }
    // the seat slats across, following the stringers' slope
    const slope = Math.atan2(sf.y - sb.y, sf.z - sb.z);
    const ns = 6;
    for (let i = 0; i < ns; i++) {
      const u = i / ns;
      const z = sf.z - 0.04 - u * 0.48;
      const y = sf.y - (sf.z - z) * Math.tan(slope);
      rbox(b, legX * 2 - 0.03, t, 0.07, 0, y, z, f, 0.005, slope);
    }
    // the back: slats fanning out a little, leaning back, the middle tallest
    const bb = v(0, 0.2, sf.z - 0.58);
    const lean = 0.42;
    const topY = h - 0.01;
    const len = (topY - bb.y) / Math.cos(lean);
    const nb = 7;
    const span = Math.min(w - 0.22, 0.6);
    for (let i = 0; i < nb; i++) {
      const u = (i / (nb - 1)) * 2 - 1;
      const l = len * (1 - 0.13 * u * u);
      const x0 = u * span * 0.38;
      const x1 = u * span * 0.48;
      const top = v(x1, bb.y + l * Math.cos(lean), bb.z - l * Math.sin(lean));
      // each turned a little, as on a curved back
      beam(b, v(x0, bb.y, bb.z), top, span / nb - 0.018, t, f, 0.005, v(1, 0, -0.12 * u));
    }
    // rails behind the back: a low one, one at arm height carrying the arms, one high
    for (const k of [0.12, 0.45, 0.72]) {
      const y = bb.y + len * k * Math.cos(lean);
      const z = bb.z - len * k * Math.sin(lean) - t;
      const rw = (span * (0.36 + 0.12 * k) + 0.04) * 2;
      rbox(b, k === 0.45 ? legX * 2 + 0.1 : rw, 0.06, 0.022, 0, y - 0.03, z - 0.01, f, 0.005, -lean);
    }
  },
  deck_chair: (b, w, d, h, f, color, a) => {
    // a folding deck chair: the long frame from the front foot to the top rail, the leg frame
    // crossing it, a support frame on notches, a striped sling between the two top rails
    const wood = a;
    const xo = w / 2 - 0.016;
    const xi = w / 2 - 0.045;
    const A0 = v(0, 0, d / 2 - 0.14);
    const A1 = v(0, h - 0.025, -d / 2 + 0.04);
    const B0 = v(0, 0, -d / 2 + 0.1);
    const B1 = v(0, 0.42 * (h / 0.9), d / 2 - 0.03);
    for (const sx of [-1, 1]) {
      beam(b, v(sx * xo, A0.y, A0.z), v(sx * xo, A1.y, A1.z), 0.022, 0.045, wood, 0.006);
      beam(b, v(sx * xi, B0.y, B0.z), v(sx * xi, B1.y, B1.z), 0.022, 0.04, wood, 0.006);
      // the support frame from the long frame to a notch on the leg frame
      const pA = A0.clone().lerp(A1, 0.62);
      const pB = B0.clone().lerp(B1, 0.18);
      beam(b, v(sx * (xi - 0.026), pA.y, pA.z), v(sx * (xi - 0.026), pB.y + 0.02, pB.z), 0.02, 0.035, wood, 0.005);
      for (let k = 0; k < 3; k++) {
        const p = B0.clone().lerp(B1, 0.1 + k * 0.07);
        bbox(b, 0.02, 0.025, 0.03, sx * (xi - 0.022), p.y + 0.015, p.z, wood, -0.45);
      }
    }
    const dowel = (p: V3, x: number, r = 0.013) => b.batch(new THREE.CylinderGeometry(r, r, 2 * x, 10).rotateZ(Math.PI / 2), wood, matrix(0, p.y, p.z));
    dowel(A1.clone().add(v(0, -0.01, 0.005)), xo + 0.005);
    dowel(A0.clone().lerp(A1, 0.06), xo);
    dowel(B1.clone().add(v(0, -0.005, 0)), xi + 0.01);
    dowel(B0.clone().lerp(B1, 0.05), xi);
    dowel(B0.clone().lerp(B1, 0.18).add(v(0, 0.035, 0)), xi - 0.015, 0.01);
    // the sling: a sagging sheet in stripes of the finish and cream
    const P0 = A1.clone().add(v(0, -0.005, 0.02));
    const P3 = B1.clone().add(v(0, 0.006, -0.012));
    const curve = new THREE.CubicBezierCurve3(P0, P0.clone().add(v(0, -0.36, 0.2)), P3.clone().add(v(0, -0.32, -0.22)), P3);
    const pts = curve.getPoints(16);
    const sw = w - 0.12;
    const ns = 7;
    const stripe = [cloth(colorOf(f)), cloth(color === "beige" ? "#8a6e52" : "#efe9dc")];
    for (let i = 0; i < ns; i++) {
      const x0 = -sw / 2 + (sw * i) / ns;
      const x1 = x0 + sw / ns;
      const pos: number[] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const [p, q] = [pts[k], pts[k + 1]];
        // a little lower in the middle across, as cloth sags
        const sag = (x: number) => -0.025 * (1 - ((2 * x) / sw) ** 2);
        pos.push(x0, p.y + sag(x0), p.z, x1, p.y + sag(x1), p.z, x1, q.y + sag(x1), q.z, x0, p.y + sag(x0), p.z, x1, q.y + sag(x1), q.z, x0, q.y + sag(x0), q.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      b.batch(g, stripe[i % 2]);
    }
  },
  bistro_set: (b, w, d, h, f, _c, a) => {
    // a round bistro table on a three-legged stand, two folding chairs facing it: slatted
    // seats, curved back bands, a tube frame in the accent
    const r = Math.min(0.35, d / 2, w / 2 - 0.42);
    const top = h - 0.026;
    lathe(b, [[0, 0], [r - 0.015, 0], [r, 0.008], [r, 0.02], [r - 0.006, 0.026], [0, 0.026]], f, 0, top, 0, 40);
    b.batch(new THREE.TorusGeometry(r * 0.8, 0.008, 6, 32).rotateX(Math.PI / 2), a, matrix(0, top - 0.008, 0));
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * TAU;
      limb(b, v(0, top - 0.12, 0), v(Math.cos(ang) * r * 0.8, top - 0.008, Math.sin(ang) * r * 0.8), 0.007, 0.007, a, 6);
    }
    lathe(b, [[0, 0], [0.05, 0], [0.05, 0.02], [0.022, 0.03], [0, 0.03]], a, 0, top - 0.03, 0, 16);
    limb(b, v(0, 0.16, 0), v(0, top - 0.02, 0), 0.018, 0.018, a, 12);
    lathe(b, [[0, 0], [0.032, 0], [0.032, 0.08], [0.02, 0.1], [0, 0.1]], a, 0, 0.12, 0, 12);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * TAU + Math.PI / 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      pipe(b, [v(c * 0.02, 0.2, s * 0.02), v(c * 0.12, 0.11, s * 0.12), v(c * 0.24, 0.025, s * 0.24), v(c * 0.29, 0.012, s * 0.29)], 0.011, a, 10, 6, false);
      b.batch(new THREE.CylinderGeometry(0.02, 0.022, 0.012, 10), mat("#2c2d30"), matrix(c * 0.29, 0.006, s * 0.29));
    }
    // the chairs, each drawn facing +z and turned towards the table
    for (const sx of [-1, 1]) {
      const T = matrix(sx * (w / 2 - 0.22), 0, 0, 0, -sx * Math.PI / 2);
      const put = (geo: THREE.BufferGeometry, m: M) => b.batch(geo, m, T);
      const tube = (pts: V3[], rr = 0.0105) => put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length === 2 ? 1 : pts.length * 2, rr, 5, false), a);
      const seat = 0.45;
      const sw = 0.38;
      for (const x of [-1, 1]) {
        const xx = (x * sw) / 2;
        // a front leg; a back leg rising into the back upright
        tube([v(xx * 1.06, 0, 0.21), v(xx, seat - 0.02, 0.17)]);
        tube([v(xx * 1.06, 0, -0.21), v(xx, seat - 0.02, -0.16), v(xx * 0.97, seat + 0.18, -0.2), v(xx * 0.93, 0.77, -0.235)]);
        put(new THREE.SphereGeometry(0.012, 6, 4).translate(xx * 0.93, 0.77, -0.235), a);
        // the seat's side rail, a stretcher
        tube([v(xx, seat - 0.02, 0.18), v(xx, seat - 0.02, -0.17)], 0.009);
      }
      for (const z of [0.17, -0.16]) tube([v(-sw / 2, seat - 0.02, z), v(sw / 2, seat - 0.02, z)], 0.009);
      tube([v(-sw / 2 * 1.04, 0.16, -0.19), v(sw / 2 * 1.04, 0.16, -0.19)], 0.007);
      tube([v(-sw / 2 * 1.04, 0.16, 0.19), v(sw / 2 * 1.04, 0.16, 0.19)], 0.007);
      // seat slats across, the front one rounded
      for (let i = 0; i < 6; i++) {
        const geo = new RoundedBoxGeometry(sw + 0.02, 0.016, 0.052, 1, 0.006).translate(0, seat - 0.002, 0.15 - i * 0.062);
        put(geo, f);
      }
      // two curved back bands, bowed back between the uprights
      for (const [y0, bh] of [[0.6, 0.045], [0.705, 0.06]]) {
        const R = 0.34;
        const half = Math.asin((sw * 0.47) / R);
        const zBack = -0.23 - (y0 - 0.6) * 0.3;
        const cz = zBack + R;
        const sh = new THREE.Shape();
        const steps = 10;
        for (let k = 0; k <= steps; k++) {
          const th = -half + (2 * half * k) / steps;
          const p = [R * Math.sin(th), cz - R * Math.cos(th)];
          if (k === 0) sh.moveTo(p[0], p[1]);
          else sh.lineTo(p[0], p[1]);
        }
        for (let k = steps; k >= 0; k--) {
          const th = -half + (2 * half * k) / steps;
          sh.lineTo((R - 0.012) * Math.sin(th), cz - (R - 0.012) * Math.cos(th));
        }
        put(slab(sh, bh, 1).rotateX(Math.PI / 2).translate(0, y0 + bh, 0), f);
      }
    }
  },

  // ----- garden things -----
  path_stepping: (b, w, d, h, f) => {
    // irregular flat stones with softened edges, each a little turned and tinted
    const n = Math.max(2, Math.round(d / 0.6));
    const rand = random(173);
    const tones = [f, tint(f, 0.9), tint(f, 1.08)];
    const bev = Math.min(0.012, h * 0.25);
    for (let i = 0; i < n; i++) {
      const sw = w * (0.78 + rand() * 0.18);
      const sd = (d / n) * (0.72 + rand() * 0.12);
      const s = new THREE.Shape();
      const k = 14;
      for (let j = 0; j < k; j++) {
        const a = (j / k) * TAU + rand() * 0.25;
        const rr = 0.9 + rand() * 0.1;
        const p = [Math.cos(a) * (sw / 2 - bev) * rr, Math.sin(a) * (sd / 2 - bev) * rr];
        if (j === 0) s.moveTo(p[0], p[1]);
        else s.lineTo(p[0], p[1]);
      }
      const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.005, h - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 1 });
      geo.rotateX(-Math.PI / 2).translate(0, bev, 0);
      b.batch(geo, tones[i % 3], matrix((rand() - 0.5) * w * 0.12, 0, -d / 2 + (d / n) * (i + 0.5), 0, (rand() - 0.5) * 0.5));
    }
  },
  wheelbarrow: (b, w, d, h, f) => {
    // a pressed steel tray with a rolled rim, tubular handles with grips, legs with a foot
    // bar, a pneumatic wheel with a rim and hub at the front
    const steel = metal(C.steel, 0.4);
    const rubber = mat("#1e1f22", { roughness: 0.95 });
    const R = Math.min(0.19, h * 0.3);
    const zw = d / 2 - R - 0.01;
    // the tray: outer and inner shells between a top and a bottom rounded outline
    const ring = (wid: number, len: number, rr: number, cz: number, y: number) => {
      const pts: V3[] = [];
      const cs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      cs.forEach(([sx, sz], c) => {
        for (let k = 0; k <= 3; k++) {
          const a = (c * Math.PI) / 2 + (k / 3) * (Math.PI / 2);
          pts.push(v(sx * (wid / 2 - rr) + Math.cos(a) * rr, y, cz + sz * (len / 2 - rr) + Math.sin(a) * rr));
        }
      });
      return pts;
    };
    const yt = h - 0.015;
    const yb = h - Math.min(0.28, h * 0.45);
    const zt = d * 0.06;
    const lt = d * 0.56;
    const OT = ring(w * 0.96, lt, 0.07, zt, yt);
    const OB = ring(w * 0.52, d * 0.3, 0.05, -d * 0.02, yb);
    const IT = ring(w * 0.96 - 0.02, lt - 0.02, 0.06, zt, yt);
    const IB = ring(w * 0.52 - 0.02, d * 0.3 - 0.02, 0.04, -d * 0.02, yb + 0.012);
    const pos: number[] = [];
    const tri = (a: V3, c: V3, e: V3) => pos.push(a.x, a.y, a.z, c.x, c.y, c.z, e.x, e.y, e.z);
    const n = OT.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(OB[i], OT[i], OB[j]);
      tri(OT[i], OT[j], OB[j]);
      tri(IB[i], IB[j], IT[i]);
      tri(IT[i], IB[j], IT[j]);
      tri(v(0, yb, -d * 0.02), OB[i], OB[j]);
      tri(v(0, yb + 0.012, -d * 0.02), IB[j], IB[i]);
    }
    const tray = new THREE.BufferGeometry();
    tray.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    tray.computeVertexNormals();
    b.batch(tray, f);
    b.batch(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(OT.map((p, i) => p.clone().lerp(IT[i], 0.5)), true), 48, 0.014, 6, true), f);
    // handles: from the axle under the tray, rising to the grips at the back
    for (const sx of [-1, 1]) {
      const pts = [v(sx * 0.055, R, zw), v(sx * 0.13, yb - 0.04, d * 0.14), v(sx * 0.2, yb - 0.05, -d * 0.16), v(sx * 0.25, h * 0.78, -d / 2 + 0.17)];
      pipe(b, pts, 0.016, steel, 16, 8, false);
      limb(b, v(sx * 0.25, h * 0.78, -d / 2 + 0.17), v(sx * 0.265, h * 0.86, -d / 2 + 0.015), 0.019, 0.019, rubber, 10);
      b.batch(new THREE.SphereGeometry(0.019, 8, 4), rubber, matrix(sx * 0.265, h * 0.86, -d / 2 + 0.015));
      // the leg and the stay to the tray's front
      const top = v(sx * 0.19, yb - 0.05, -d * 0.14);
      const foot = v(sx * 0.2, 0.012, -d * 0.2);
      limb(b, top, foot, 0.013, 0.013, steel, 8);
      limb(b, v(sx * 0.055, R, zw), v(sx * 0.14, yb + 0.06, d * 0.2), 0.009, 0.009, steel, 6);
    }
    limb(b, v(-0.21, 0.012, -d * 0.2), v(0.21, 0.012, -d * 0.2), 0.012, 0.012, steel, 8);
    for (const z of [d * 0.08, -d * 0.12]) limb(b, v(-0.2, yb - 0.04, z), v(0.2, yb - 0.04, z), 0.011, 0.011, steel, 6);
    // the wheel on its axle
    b.batch(new THREE.TorusGeometry(R - 0.045, 0.045, 10, 28).rotateY(Math.PI / 2), rubber, matrix(0, R, zw));
    b.batch(new THREE.CylinderGeometry(R - 0.06, R - 0.06, 0.05, 20).rotateZ(Math.PI / 2), metal("#b8bcc0", 0.4), matrix(0, R, zw));
    b.batch(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12).rotateZ(Math.PI / 2), metal("#6c7176", 0.4), matrix(0, R, zw));
    limb(b, v(-0.065, R, zw), v(0.065, R, zw), 0.008, 0.008, steel, 6);
  },
  hose_reel: (b, w, d, h, f, color) => {
    // a hose trolley: two tube side frames joined by a handle, a drum with the hose wound on it
    // in coils, a crank, two wheels at the back, the hose's end with a spray nozzle
    const hose = mat(color === "green" ? "#d9a32a" : "#5e9a3c", { roughness: 0.6 });
    const dark = mat("#2a2b2e", { roughness: 0.9 });
    const fx = w / 2 - 0.045;
    const yc = h * 0.46;
    const R = Math.min(0.2, yc - 0.06, d / 2 - 0.02);
    for (const sx of [-1, 1]) {
      const x = sx * fx;
      pipe(b, [v(x, 0.02, d / 2 - 0.03), v(x, yc * 0.6, d * 0.22), v(x, h - 0.12, 0.0), v(x, h - 0.03, -0.03)], 0.016, f, 14, 8);
      pipe(b, [v(x, 0.08, -d / 2 + 0.08), v(x, yc * 0.7, -d * 0.12), v(x, yc, 0)], 0.016, f, 8, 8);
      rbox(b, 0.03, 0.02, 0.07, x, 0, d / 2 - 0.04, dark, 0.006);
      // the drum's bearing
      b.batch(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateZ(Math.PI / 2), f, matrix(x, yc, 0));
      // wheels at the back
      b.batch(new THREE.CylinderGeometry(0.075, 0.075, 0.035, 16).rotateZ(Math.PI / 2), dark, matrix(sx * (fx + 0.035), 0.075, -d / 2 + 0.08));
      b.batch(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12).rotateZ(Math.PI / 2), f, matrix(sx * (fx + 0.036), 0.075, -d / 2 + 0.08));
    }
    limb(b, v(-fx, h - 0.03, -0.03), v(fx, h - 0.03, -0.03), 0.018, 0.018, f, 10);
    limb(b, v(-fx - 0.06, 0.075, -d / 2 + 0.08), v(fx + 0.06, 0.075, -d / 2 + 0.08), 0.008, 0.008, metal(C.steel), 6);
    limb(b, v(-fx, 0.05, d / 2 - 0.05), v(fx, 0.05, d / 2 - 0.05), 0.012, 0.012, f, 8);
    // the drum: flanges and the coiled hose between them
    const len = 2 * fx - 0.07;
    for (const sx of [-1, 1]) b.batch(new THREE.CylinderGeometry(R, R, 0.014, 28).rotateZ(Math.PI / 2), f, matrix(sx * (len / 2 + 0.007), yc, 0));
    const coils = Math.max(4, Math.round(len / 0.026));
    const coil = new THREE.CylinderGeometry(1, 1, len, 18, coils * 2, true);
    const p = coil.attributes.position;
    const Rc = R * 0.8;
    for (let i = 0; i < p.count; i++) {
      const ring = Math.round(((p.getY(i) + len / 2) / len) * coils * 2);
      const k = Rc + (ring % 2 ? 0.011 : 0);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    coil.computeVertexNormals();
    b.batch(coil.rotateZ(Math.PI / 2), hose, matrix(0, yc, 0));
    // the crank on the right
    limb(b, v(fx + 0.01, yc, 0), v(fx + 0.04, yc, 0), 0.012, 0.012, f, 8);
    beam(b, v(fx + 0.04, yc, 0), v(fx + 0.04, yc + 0.11, 0.03), 0.022, 0.016, f, 0.005);
    limb(b, v(fx + 0.04, yc + 0.11, 0.03), v(fx + 0.1, yc + 0.11, 0.03), 0.014, 0.012, dark, 10);
    // the hose leaving the drum, hanging down to its nozzle clipped on the front
    pipe(b, [v(-0.06, yc - Rc - 0.005, 0.02), v(-0.04, yc - Rc - 0.03, Rc * 0.7), v(0.02, 0.2, d / 2 - 0.05), v(0.1, 0.14, d / 2 - 0.035), v(0.16, 0.17, d / 2 - 0.035)], 0.011, hose, 18, 6, false);
    limb(b, v(0.16, 0.17, d / 2 - 0.035), v(0.24, 0.2, d / 2 - 0.035), 0.016, 0.011, mat("#e2832b", { roughness: 0.6 }), 10);
  },
  sun_sail: (b, w, d, h, f, color) => {
    // a triangular shade sail with curved, hemmed edges, slightly twisted (the corners at
    // different heights), tensioned by wires to three steel posts
    const steel = metal(C.steel, 0.35);
    const P = [v(-w / 2 + 0.2, h - 0.08, -d / 2 + 0.2), v(w / 2 - 0.2, h * 0.76, -d / 2 + 0.45), v(-w / 2 + 0.75, h * 0.82, d / 2 - 0.2)];
    const cen = P[0].clone().add(P[1]).add(P[2]).multiplyScalar(1 / 3);
    // corners pulled in from the posts by the wires
    const C3 = P.map((p) => p.clone().lerp(cen, 0.08));
    const n = 12;
    const at = (l0: number, l1: number, l2: number) => {
      const p = C3[0].clone().multiplyScalar(l0).addScaledVector(C3[1], l1).addScaledVector(C3[2], l2);
      // the edges curve inwards; the cloth sags a little in the middle
      const pull = 0.5 * (4 * l0 * l1 * (1 - l2) ** 6 + 4 * l1 * l2 * (1 - l0) ** 6 + 4 * l0 * l2 * (1 - l1) ** 6);
      p.lerp(cen, pull * 0.22);
      p.y -= 27 * l0 * l1 * l2 * 0.12;
      return p;
    };
    const idx = (i: number, j: number) => (i * (2 * n - i + 3)) / 2 + j;
    const pos: number[] = [];
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const p = at((n - i - j) / n, i / n, j / n);
        pos.push(p.x, p.y, p.z);
      }
    const index: number[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n - i; j++) {
        index.push(idx(i, j), idx(i, j + 1), idx(i + 1, j));
        if (j < n - i - 1) index.push(idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j));
      }
    const sail = new THREE.BufferGeometry();
    sail.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    sail.setIndex(index);
    sail.computeVertexNormals();
    b.batch(sail, cloth(colorOf(f)));
    // hems along the edges, rings at the corners
    const hem = mat(shade(colorOf(f), color === "anthracite" ? 1.25 : 0.82), { roughness: 1 });
    const corners = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let e = 0; e < 3; e++) {
      const [e0, e1] = [corners[e], corners[(e + 1) % 3]];
      const pts: V3[] = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        pts.push(at(e0[0] * (1 - t) + e1[0] * t, e0[1] * (1 - t) + e1[1] * t, e0[2] * (1 - t) + e1[2] * t));
      }
      b.batch(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 5, false), hem);
    }
    P.forEach((p, i) => {
      // the post a little beyond the corner, a wire to the ring
      const out = p.clone().sub(cen).setY(0).normalize().multiplyScalar(0.12);
      const base = v(p.x + out.x, 0, p.z + out.z);
      const top = p.y + 0.18;
      b.batch(new THREE.CylinderGeometry(0.045, 0.05, top, 12), steel, matrix(base.x, top / 2, base.z));
      b.batch(new THREE.SphereGeometry(0.05, 12, 6, 0, TAU, 0, Math.PI / 2), steel, matrix(base.x, top, base.z));
      b.batch(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 12), steel, matrix(base.x, 0.0075, base.z));
      const hook = v(base.x, p.y + 0.04, base.z);
      limb(b, hook, C3[i], 0.004, 0.004, steel, 4);
      b.batch(new THREE.TorusGeometry(0.025, 0.006, 4, 12), steel, matrix(C3[i].x, C3[i].y, C3[i].z, 0, Math.atan2(cen.x - p.x, cen.z - p.z)));
    });
  },
  fire_pit: (b, w, d, h, f) => {
    // a thick bowl on a foot with a flat lip, logs in a teepee, an ash bed with embers, and
    // flames (burning while the linked fire is on)
    const r = Math.min(w, d) / 2 - 0.02;
    lathe(b, [[0, 0], [r * 0.32, 0], [r * 0.34, 0.012], [r * 0.34, 0.05], [r * 0.6, h * 0.32], [r * 0.86, h * 0.62], [r * 0.98, h * 0.84], [r * 1.02, h * 0.86], [r * 1.02, h * 0.895], [r * 1.01, h * 0.9], [r * 0.92, h * 0.9], [r * 0.9, h * 0.893], [r * 0.82, h * 0.66], [r * 0.56, h * 0.4], [r * 0.3, h * 0.33], [0, h * 0.32]], f, 0, 0, 0, 40);
    const ash = h * 0.33;
    b.batch(new THREE.CircleGeometry(r * 0.42, 20).rotateX(-Math.PI / 2), mat("#3a3330", { roughness: 1 }), matrix(0, ash + 0.004, 0));
    const fireA = part(mat("#ffb347", { emissive: "#ff9a2a", emissiveIntensity: 0.9 }), "fire");
    const fireB = part(mat("#ff7a2e", { emissive: "#ff5a1a", emissiveIntensity: 0.9 }), "fire");
    const rand = random(107);
    for (let i = 0; i < 9; i++) {
      const a = rand() * TAU;
      const rr = rand() * r * 0.3;
      b.batch(new THREE.IcosahedronGeometry(0.018 + rand() * 0.012, 0), i % 2 ? fireB : mat("#2a2422", { roughness: 1 }), matrix(Math.cos(a) * rr, ash + 0.01, Math.sin(a) * rr));
    }
    const bark = mat("#5b4232", { roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const foot = v(Math.cos(a) * r * 0.42, ash + 0.02, Math.sin(a) * r * 0.42);
      const tip = v(Math.cos(a) * r * 0.06, ash + Math.min(0.22, h * 0.5), Math.sin(a) * r * 0.06);
      limb(b, foot, tip, 0.03, 0.022, bark, 7);
    }
    // flames: tall tongues in the middle, shorter ones around
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rand();
      const rr = i < 2 ? rand() * 0.03 : r * (0.1 + rand() * 0.12);
      const fh = (i < 2 ? 0.3 : 0.12 + rand() * 0.1) * Math.min(1, h / 0.4);
      const fr = i < 2 ? 0.05 : 0.03;
      // drawn above the piece's height: the flames rise over the rim
      const tilt = [(rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3];
      b.above(() => {
        const m = b.add(new THREE.ConeGeometry(fr, fh, 7).translate(0, fh / 2, 0), i % 2 ? fireA : fireB, Math.cos(a) * rr, ash + 0.03, Math.sin(a) * rr);
        m.rotation.set(tilt[0], 0, tilt[1]);
      });
    }
  },
  string_lights: (b, w, d, h, f) => {
    // two posts with pointed tops and hook arms, a sagging cable of festoon bulbs on drops
    const ps = 0.08;
    const arm = 0.18;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - ps / 2);
      bbox(b, ps, h - 0.06, ps, x, 0, 0, f);
      b.batch(new THREE.ConeGeometry(ps * 0.7, 0.06, 4).rotateY(Math.PI / 4), f, matrix(x, h - 0.03, 0));
      beam(b, v(x - (sx * ps) / 2, h - 0.2, 0), v(x - sx * (ps / 2 + arm), h - 0.2, 0), 0.02, 0.025, f);
      b.batch(new THREE.TorusGeometry(0.018, 0.004, 4, 10), metal(C.steel), matrix(x - sx * (ps / 2 + arm - 0.02), h - 0.225, 0));
    }
    const x0 = -w / 2 + ps + arm - 0.02;
    const x1 = -x0;
    const y0 = h - 0.24;
    const sag = Math.min(0.45, h * 0.15);
    const cable = (x: number) => y0 - sag * (1 - ((2 * (x - (x0 + x1) / 2)) / (x1 - x0)) ** 2);
    const pts: V3[] = [];
    for (let i = 0; i <= 24; i++) {
      const x = x0 + ((x1 - x0) * i) / 24;
      pts.push(v(x, cable(x), 0));
    }
    b.batch(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.004, 4, false), mat(C.black));
    const n = Math.max(3, Math.round((x1 - x0) / 0.38));
    const socket = mat("#1e1f22", { roughness: 0.6 });
    const glow = glowMat();
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      const y = cable(x);
      limb(b, v(x, y, 0), v(x, y - 0.05, 0), 0.003, 0.003, socket, 4);
      b.batch(new THREE.CylinderGeometry(0.012, 0.014, 0.035, 8), socket, matrix(x, y - 0.065, 0));
      b.batch(new THREE.SphereGeometry(0.03, 10, 7), glow, new THREE.Matrix4().compose(v(x, y - 0.11, 0), new THREE.Quaternion(), v(1, 1.25, 1)));
    }
    void d;
  },
  hammock: (b, w, d, h, f, color, a) => {
    // a hammock on its wooden stand: a ground beam, a leaning A-frame at each end with a hook,
    // cords fanning from a ring to the spreader bars, a sagging striped cloth, a pillow
    const wood = a;
    const top = h - 0.03;
    const ex = w / 2 - 0.06;
    const lean = Math.min(0.45, w * 0.13);
    bbox(b, w - 2 * lean, 0.08, 0.09, 0, 0, 0, wood);
    for (const sx of [-1, 1]) {
      const foot = sx * (ex - lean);
      bbox(b, 0.09, 0.07, d, foot, 0, 0, wood);
      for (const sz of [-1, 1]) beam(b, v(foot, 0.05, sz * (d / 2 - 0.06)), v(sx * ex, top, sz * 0.03), 0.07, 0.07, wood, 0.008);
      // a brace from the beam up to the apex
      beam(b, v(foot + sx * 0.02, 0.06, 0), v(sx * (ex - 0.02), top - 0.12, 0), 0.06, 0.06, wood, 0.008);
      bbox(b, 0.1, 0.06, 0.12, sx * ex, top - 0.03, 0, wood);
    }
    // the cloth between the spreader bars
    const L = w * 0.56;
    const W = Math.min(0.9, d * 0.8);
    const yEnd = Math.min(h * 0.82, top - 0.25);
    const sag = Math.min(h * 0.38, yEnd - 0.38);
    const ys = (x: number, z: number) => {
      const u = (2 * x) / L;
      const s = 1 - u * u;
      return yEnd - sag * s - 0.07 * s * (1 - ((2 * z) / W) ** 2);
    };
    const bands = [0.12, 0.2, 0.36, 0.2, 0.12];
    const stripe = [cloth(colorOf(f)), cloth(color === "beige" ? "#8a6e52" : "#efe9dc")];
    let z0 = -W / 2;
    bands.forEach((bw, i) => {
      const z1 = z0 + bw * W;
      const nx = 16;
      const nz = 2;
      const pos: number[] = [];
      const P = (ix: number, iz: number) => {
        const x = -L / 2 + (L * ix) / nx;
        const z = z0 + ((z1 - z0) * iz) / nz;
        // the long edges gather a little towards the ends
        const g = 1 - 0.18 * ((2 * x) / L) ** 4;
        return [x, ys(x, z), z * g];
      };
      for (let ix = 0; ix < nx; ix++)
        for (let iz = 0; iz < nz; iz++) {
          const [p, q, r, s] = [P(ix, iz), P(ix + 1, iz), P(ix + 1, iz + 1), P(ix, iz + 1)];
          pos.push(...p, ...s, ...q, ...q, ...s, ...r);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      b.batch(g, stripe[i % 2 ? 1 : 0]);
      z0 = z1;
    });
    // spreader bars, cords to a ring, a rope up to the hook
    const cord = mat("#e8e1d2", { roughness: 1 });
    for (const sx of [-1, 1]) {
      const x = (sx * L) / 2;
      limb(b, v(x, yEnd, -W / 2 - 0.04), v(x, yEnd, W / 2 + 0.04), 0.016, 0.016, wood, 8);
      const ring = v(sx * (L / 2 + Math.min(0.32, (ex - L / 2) * 0.45)), yEnd + 0.12, 0);
      for (let k = 0; k < 7; k++) limb(b, v(x, yEnd, -W / 2 + (W * k) / 6), ring, 0.003, 0.003, cord, 3);
      b.batch(new THREE.TorusGeometry(0.03, 0.006, 4, 12), metal(C.steel), matrix(ring.x, ring.y, 0));
      limb(b, ring, v(sx * (ex - 0.03), top - 0.07, 0), 0.007, 0.007, cord, 5);
    }
    // a pillow at one end
    const px = -L / 2 + 0.3;
    b.batch(new RoundedBoxGeometry(0.42, 0.1, 0.3, 2, 0.045), mat(color === "beige" ? "#5d7a60" : "#efe9dc", { roughness: 1 }), matrix(px, ys(px, 0) + 0.05, 0, 0, Math.PI / 2, -0.35));
  },
};
