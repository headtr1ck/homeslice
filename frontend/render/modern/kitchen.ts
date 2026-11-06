// More detailed built-in pieces: kitchen. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
//
// The units keep the old ones' measures exactly, so they still line up in a run: a 10 cm
// plinth set back 5 cm, the carcass 3 cm behind the worktop's front, 18 mm fronts, a 4 cm
// worktop. Fronts are plain boxes (rounded ones cost 300 triangles each and their rounding
// is far below a pixel); what shows is in the joints, the handles, the worktop's edge and
// the appliances.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { C, back, glass, mat, random, roundedRect, surface, v, type Build, type Builder, type Handle } from "../modern";

// ----- geometry -----

type P2 = [number, number];

function area(p: P2[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [a, b] = p[i];
    const [c, d] = p[(i + 1) % p.length];
    s += a * d - c * b;
  }
  return s / 2;
}

/** Texture coordinates like a box's: each face projected on its main plane, 0..1 across the part. */
function boxUV(geo: THREE.BufferGeometry) {
  const p = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t);
    b.fromBufferAttribute(p, t + 1);
    c.fromBufferAttribute(p, t + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const x = (p.getX(t + k) - bb.min.x) / Math.max(size.x, 1e-6);
      const y = (p.getY(t + k) - bb.min.y) / Math.max(size.y, 1e-6);
      const z = (p.getZ(t + k) - bb.min.z) / Math.max(size.z, 1e-6);
      uv[(t + k) * 2] = ax === 0 ? z : x;
      uv[(t + k) * 2 + 1] = ax === 1 ? z : y;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * Rings of points (all with the same count, convex) stacked along an axis at `s`, joined
 * by quads, the ends capped. Points are (x, y) for the z axis, (x, z) for y, (z, y) for x.
 * `inward` turns the faces to the inside (a basin seen from within).
 */
function loft(rings: { pts: P2[]; s: number }[], axis: "x" | "y" | "z" = "z", caps: [boolean, boolean] = [true, true], inward = false) {
  const conv = axis === "z" ? (p: P2): P2 => p : axis === "y" ? ([x, z]: P2): P2 => [x, -z] : ([z, y]: P2): P2 => [-z, y];
  const to = axis === "z" ? (u: number, w: number, s: number) => [u, w, s] : axis === "y" ? (u: number, w: number, s: number) => [u, s, -w] : (u: number, w: number, s: number) => [s, w, -u];
  const rs = rings.map((r) => ({ s: r.s, pts: r.pts.map(conv) })).sort((a, b) => a.s - b.s);
  if (area(rs[0].pts) < 0) for (const r of rs) r.pts.reverse();
  const n = rs[0].pts.length;
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => (inward ? pos.push(...a, ...c, ...b) : pos.push(...a, ...b, ...c));
  const P = (r: number, j: number) => {
    const [u, w] = rs[r].pts[j % n];
    return to(u, w, rs[r].s);
  };
  for (let i = 0; i + 1 < rs.length; i++)
    for (let j = 0; j < n; j++) {
      tri(P(i, j), P(i, j + 1), P(i + 1, j + 1));
      tri(P(i, j), P(i + 1, j + 1), P(i + 1, j));
    }
  const last = rs.length - 1;
  for (let j = 1; j + 1 < n; j++) {
    if (caps[1]) tri(P(last, 0), P(last, j), P(last, j + 1));
    if (caps[0]) tri(P(0, 0), P(0, j + 1), P(0, j));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  boxUV(geo);
  geo.computeVertexNormals();
  return geo;
}

/** A rounded rectangle's outline, counter-clockwise, `seg` steps a corner. */
function rrect(w: number, h: number, r: number, seg = 2, cx = 0, cy = 0): P2[] {
  const rr = Math.max(0, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
  if (rr <= 0) return [[cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2]];
  const out: P2[] = [];
  const corners: [number, number, number][] = [[w / 2 - rr, -h / 2 + rr, -Math.PI / 2], [w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI]];
  for (const [x, y, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([cx + x + Math.cos(a) * rr, cy + y + Math.sin(a) * rr]);
    }
  return out;
}

/** A slab along an axis with rounded edges round it and its ends chamfered by `c`, from s = 0 to len. */
function slab(w: number, h: number, len: number, r: number, c: number, axis: "x" | "y" | "z" = "z", seg = 2) {
  const ring = (k: number, s: number) => ({ pts: rrect(w - 2 * k, h - 2 * k, r - k, seg), s });
  return loft(c > 0 ? [ring(c, 0), ring(0, c), ring(0, len - c), ring(c, len)] : [ring(0, 0), ring(0, len)], axis);
}

/**
 * A box like Builder.box (from its bottom centre) with its edges round the z axis rounded
 * and its front and back chamfered: about 90 triangles where a RoundedBoxGeometry has 300.
 */
function rbox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r: number) {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
  const c = Math.min(rr * 0.6, d / 4);
  return b.add(slab(w, h, d, rr, c, "z").translate(0, 0, -d / 2), m, x, y + h / 2, z);
}

/** A flat frame round a hole (a sink's rim): outer and inner rounded rectangles, `t` thick, lying on y. */
function frame(w: number, d: number, r: number, hw: number, hd: number, hr: number, t: number) {
  const s = roundedRect(w, d, r);
  s.holes.push(roundedRect(hw, hd, hr));
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 3 }).rotateX(-Math.PI / 2);
}

/**
 * A lathe drawn segment by segment: smooth round, sharp along the profile, so its normals
 * always agree with its faces (three's own fold wrong where a profile turns back, as at a rim).
 */
function lathe(pts: THREE.Vector2[], seg: number, phiStart?: number, phiLength?: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 1 < pts.length; i++) if (pts[i].distanceTo(pts[i + 1]) > 1e-6) parts.push(new THREE.LatheGeometry([pts[i], pts[i + 1]], seg, phiStart, phiLength).toNonIndexed());
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}

/**
 * A tube along a curve lying in a plane (`axis` its normal): its rings keep their turn, so
 * it never twists (three's TubeGeometry flips its frame where a curve bends the other way).
 * The ends are open: they go into the parts they join.
 */
function tube(curve: THREE.Curve<THREE.Vector3>, seg: number, r: number, radial: number, axis = v(0, 0, 1)) {
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const p = curve.getPointAt(i / seg);
    const n = axis.clone().cross(curve.getTangentAt(i / seg)).normalize();
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(p.x + r * (Math.cos(a) * n.x + Math.sin(a) * axis.x), p.y + r * (Math.cos(a) * n.y + Math.sin(a) * axis.y), p.z + r * (Math.cos(a) * n.z + Math.sin(a) * axis.z));
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      index.push(a, d, c, a, b, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// ----- materials (made on use: this file and modern.ts import each other) -----

const steel = () => mat(C.steel, { metalness: 0.6, roughness: 0.32 });
const chrome = () => mat(C.chrome, { metalness: 0.85, roughness: 0.2 });
const blackGlass = () => mat(C.screen, { roughness: 0.12, metalness: 0.2 });
const rubber = () => mat("#1b1c1e", { roughness: 0.9 });
const joint = () => mat("#232427", { roughness: 1 });
const handleBlack = () => mat(C.black, { roughness: 0.45, metalness: 0.3 });
const display = (color = "#7fb6ff") => mat(C.screen, { emissive: color, emissiveIntensity: 0.3, roughness: 0.1 });
const frameGrey = () => mat("#3a3d42", { roughness: 0.3, metalness: 0.3 });
const pane = () => mat("#2a363d", { roughness: 0.05, metalness: 0.3 });

// ----- unit parts -----

const PLINTH = 0.1;
const TOP = 0.04;

/** A round bar on two posts, `off` in front of z. */
function barHandle(b: Builder, x: number, y: number, z: number, len: number, vertical: boolean, m: THREE.Material, off = 0.022, r = 0.0055) {
  const d = vertical ? v(0, 1, 0) : v(1, 0, 0);
  const c = v(x, y, z + off);
  // flat-shaded: a thin smooth cylinder's normals turn away from the eye along its silhouette
  const geo = new THREE.CylinderGeometry(r, r, len, 8).rotateY(Math.PI / 8).toNonIndexed();
  geo.computeVertexNormals();
  const bar = b.add(geo, m, c.x, c.y, c.z);
  bar.quaternion.setFromUnitVectors(v(0, 1, 0), d);
  for (const s of [-1, 1]) {
    const p = c.clone().addScaledVector(d, s * (len / 2 - Math.min(0.015, len * 0.15)));
    b.rod(v(p.x, p.y, z), v(p.x, p.y, z + off), r * 0.65, m, 5);
  }
}

/** A mushroom knob on a front at z. */
function knob(b: Builder, x: number, y: number, z: number, m: THREE.Material, r = 0.015) {
  const pts = [[0, 0], [r * 0.35, 0], [r * 0.35, r * 0.6], [r * 0.9, r * 0.8], [r, r * 1.15], [r * 0.75, r * 1.55], [0, r * 1.6]].map(([a, c]) => new THREE.Vector2(a, c));
  b.add(lathe(pts, 8).rotateX(Math.PI / 2), m, x, y, z);
}

/**
 * Doors or drawer fronts in a grid at z (their back), with dark joints and the handle:
 * the same rules as modern.ts fronts (`own` handle, or the one chosen if the piece has one).
 */
function kFronts(b: Builder, x0: number, w: number, y0: number, h: number, z: number, n: number, m: THREE.Material, rows = 1, own?: Handle, handleM: THREE.Material = handleBlack(), drawers = rows > 1) {
  const chosen = b.options.handle as Handle | undefined;
  const handle: Handle | undefined = own && chosen && ["bar", "knob", "handleless", "push"].includes(chosen) ? chosen : own;
  const cw = w / n;
  const rh = h / rows;
  const rail = handle === "handleless" ? Math.min(0.035, rh * 0.2) : 0;
  if (rail)
    for (let r = 0; r < rows; r++) {
      b.box(w, rail, 0.008, x0 + w / 2, y0 + rh * (r + 1) - rail, z + 0.004, mat("#2c2e31", { roughness: 0.9 }));
      b.box(w, 0.006, 0.016, x0 + w / 2, y0 + rh * (r + 1) - rail * 0.55, z + 0.006, mat("#a9adb2", { metalness: 0.7, roughness: 0.35 }));
    }
  const j = joint();
  for (let i = 1; i < n; i++) b.box(0.005, h, 0.02, x0 + cw * i, y0, z + 0.0105, j);
  for (let r = 1; r < rows; r++) b.box(w, 0.005, 0.02, x0 + w / 2, y0 + rh * r - 0.0025, z + 0.0105, j);
  for (let i = 0; i < n; i++)
    for (let r = 0; r < rows; r++) {
      const x = x0 + cw * (i + 0.5);
      b.box(cw - 0.004, rh - 0.004 - rail, 0.018, x, y0 + rh * r + 0.002, z + 0.009, m);
      if (handle === "bar") {
        if (drawers) barHandle(b, x, y0 + rh * r + rh - Math.min(0.06, rh * 0.3), z + 0.018, Math.min(0.2, cw * 0.4), false, handleM);
        else barHandle(b, x + (i % 2 ? -1 : 1) * (cw / 2 - 0.05), y0 + rh * (r + 0.5), z + 0.018, Math.min(0.3, rh * 0.25), true, handleM);
      }
      if (handle === "knob") knob(b, x, y0 + rh * (r + 0.5), z + 0.018, handleM);
    }
}

/** The recessed plinth under a unit, from its back. */
function plinth(b: Builder, w: number, d: number) {
  b.box(w - 0.02, PLINTH, d - 0.08, 0, 0, back(d) + (d - 0.08) / 2, mat("#202124", { roughness: 0.7 }));
}

/** A worktop's cross-section (z, y): its front edge eased, so it catches the light. */
function worktopSection(z0: number, z1: number, y: number, front: boolean): P2[] {
  const e = 0.003;
  return front ? [[z0, y], [z1 - e, y], [z1, y + e], [z1, y + TOP - e], [z1 - e, y + TOP], [z0, y + TOP]] : [[z0, y], [z1, y], [z1, y + TOP], [z0, y + TOP]];
}

/** A worktop from x0 to x1, its top at h, optionally with a hole (a sink's bowl) cut out. */
function worktop(b: Builder, x0: number, x1: number, d: number, h: number, a: THREE.Material, hole?: { x0: number; x1: number; z0: number; z1: number }) {
  const y = h - TOP;
  const piece = (from: number, to: number, z0: number, z1: number, front: boolean) => {
    if (to - from > 1e-4 && z1 - z0 > 1e-4) b.add(loft([{ pts: worktopSection(z0, z1, y, front), s: from }, { pts: worktopSection(z0, z1, y, front), s: to }], "x"), a);
  };
  if (!hole) return piece(x0, x1, -d / 2, d / 2, true);
  piece(x0, hole.x0, -d / 2, d / 2, true);
  piece(hole.x1, x1, -d / 2, d / 2, true);
  piece(hole.x0, hole.x1, -d / 2, hole.z0, false);
  piece(hole.x0, hole.x1, hole.z1, d / 2, true);
}

interface Sink {
  x: number;
  /** The bowl's width and depth, its centre's z. */
  bw: number;
  bd: number;
  z: number;
  /** A gooseneck tap (base units) or the run's tall upright one. */
  goose: boolean;
  /** The tap stands above the piece's height (b.above). */
  above: boolean;
}
const BOWL = 0.17;
const holeOf = (s?: Sink) => s && { x0: s.x - s.bw / 2, x1: s.x + s.bw / 2, z0: s.z - s.bd / 2, z1: s.z + s.bd / 2 };

/**
 * Plinth, carcass (its sides in the fronts' colour) and worktop; where the fronts go. With
 * a sink the carcass stops below the bowl and the worktop has its hole.
 */
function body(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, sink?: Sink) {
  plinth(b, w, d);
  const cd = d - 0.03;
  const cz = back(d) + cd / 2;
  const tall = h - TOP - PLINTH;
  if (!sink) b.box(w, tall, cd, 0, PLINTH, cz, f);
  else {
    const t = 0.018;
    const low = Math.max(0.05, tall - BOWL - 0.02);
    b.box(w - 2 * t, low, cd, 0, PLINTH, cz, f);
    for (const sx of [-1, 1]) b.box(t, tall, cd, sx * (w / 2 - t / 2), PLINTH, cz, f);
    b.box(w - 2 * t, tall - low, t, 0, PLINTH + low, back(d) + t / 2, f);
    b.box(w - 2 * t, tall - low, t, 0, PLINTH + low, d / 2 - 0.03 - t / 2, f);
  }
  worktop(b, -w / 2, w / 2, d, h, a, holeOf(sink));
  if (sink) drawSink(b, sink, d, h);
  return { y0: PLINTH, y1: h - TOP, fz: d / 2 - 0.03 };
}

/** A steel inset sink: rim, a real bowl sunk into the worktop, drain, tap. */
function drawSink(b: Builder, s: Sink, d: number, h: number) {
  const st = mat(C.steel, { metalness: 0.65, roughness: 0.3 });
  const r = Math.min(0.03, s.bw / 4);
  b.add(frame(s.bw + 0.04, s.bd + 0.06, r + 0.01, s.bw, s.bd, r, 0.004), st, s.x, h, s.z);
  // the bowl: its inside (seen from above) and its outside (seen in an open unit)
  const ring = (y: number, k: number) => ({ pts: rrect(s.bw - k, s.bd - k, r - k / 2, 2, s.x, s.z), s: y });
  const inner = mat("#8d9298", { metalness: 0.55, roughness: 0.38 });
  b.add(loft([ring(h - BOWL, 0.012), ring(h - BOWL + 0.012, 0), ring(h + 0.002, 0)], "y", [true, false], true), inner);
  b.add(loft([ring(h - BOWL - 0.002, 0.008), ring(h - BOWL + 0.012, -0.002), ring(h - TOP, -0.002)], "y", [true, false]), st);
  const dz = s.z + s.bd * 0.15;
  b.cyl(0.03, 0.03, 0.003, s.x, h - BOWL, dz, st, 16);
  b.cyl(0.021, 0.021, 0.004, s.x, h - BOWL, dz, mat("#3a3d41", { metalness: 0.4, roughness: 0.5 }), 16);
  const tap = () => kitchenTap(b, s.x, h, back(d) + 0.07, s.goose, mat(C.chrome, { metalness: 0.85, roughness: 0.18 }));
  if (s.above) b.above(tap);
  else tap();
}

/** A kitchen tap: a gooseneck (curved spout, lever at the side) or a tall upright with a short spout. */
function kitchenTap(b: Builder, x: number, y: number, z: number, goose: boolean, m: THREE.Material) {
  b.cyl(0.026, 0.028, 0.008, x, y, z, m, 16);
  b.cyl(0.02, 0.022, 0.06, x, y + 0.008, z, m, 14);
  if (goose) {
    const curve = new THREE.CatmullRomCurve3([v(x, y + 0.05, z), v(x, y + 0.27, z), v(x, y + 0.355, z + 0.07), v(x, y + 0.3, z + 0.17), v(x, y + 0.26, z + 0.19)]);
    b.add(tube(curve, 14, 0.011, 8, v(1, 0, 0)), m);
    b.rod(v(x, y + 0.245, z + 0.19), v(x, y + 0.268, z + 0.19), 0.013, m, 10);
    b.rod(v(x + 0.018, y + 0.045, z), v(x + 0.06, y + 0.085, z + 0.012), 0.005, m, 6);
  } else {
    b.cyl(0.016, 0.019, 0.3, x, y + 0.04, z, m, 14);
    b.sphere(0.016, x, y + 0.34, z, m, 1, 1, 1, 10);
    b.rod(v(x, y + 0.335, z), v(x, y + 0.3, z + 0.19), 0.012, m, 8);
    b.cyl(0.013, 0.013, 0.02, x, y + 0.285, z + 0.19, m, 10);
    b.rod(v(x, y + 0.08, z + 0.018), v(x, y + 0.08, z + 0.07), 0.006, m, 6);
  }
}

/** A gas hob: steel plate, burners with caps, cast-iron grates over them. */
function hobGas(b: Builder, x: number, w: number, d: number, h: number) {
  const iron = mat("#1f2023", { roughness: 0.6 });
  b.box(w - 0.06, 0.008, d - 0.1, x, h, 0, mat(C.steel, { metalness: 0.6, roughness: 0.35 }));
  const pw = w - 0.12;
  const pd = d - 0.1;
  const y = h + 0.008;
  for (const [dx, dz, r] of [[-0.25, -0.22, 0.05], [0.25, -0.22, 0.04], [-0.25, 0.22, 0.04], [0.25, 0.22, 0.06]] as const) {
    const bx = x + dx * pw;
    const bz = dz * pd;
    b.cyl(r * 1.35, r * 1.5, 0.008, bx, y, bz, mat("#3a3c40", { metalness: 0.5, roughness: 0.4 }), 18);
    b.cyl(r, r * 1.05, 0.012, bx, y + 0.008, bz, iron, 18);
    b.cyl(r * 0.55, r * 0.6, 0.006, bx, y + 0.02, bz, mat("#2b2c2f", { roughness: 0.4 }), 14);
  }
  // two grates, each over a pair of burners: a frame, a bar between, fingers to the burners, feet
  const gy = y + 0.026;
  const bar = 0.01;
  // a cast bar, narrower at its foot (so its top covers it from above), from (x0, z0) to (x1, z1) along x or z
  const cast = (x0: number, x1: number, z0: number, z1: number) => {
    const alongX = x1 - x0 > z1 - z0;
    const c = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
    const sec: P2[] = [[c - bar * 0.3, gy], [c + bar * 0.3, gy], [c + bar / 2, gy + bar], [c - bar / 2, gy + bar]];
    b.batch(alongX ? loft([{ pts: sec, s: x0 }, { pts: sec, s: x1 }], "x") : loft([{ pts: sec, s: z0 }, { pts: sec, s: z1 }], "z"), iron);
  };
  for (const sx of [-1, 1]) {
    const gx = x + sx * pw * 0.25;
    const gw = pw * 0.5 - 0.01;
    const gd = pd - 0.04;
    const [x0, x1, z0, z1] = [gx - gw / 2, gx + gw / 2, -gd / 2, gd / 2];
    for (const z of [z0 + bar / 2, 0, z1 - bar / 2]) cast(x0 + bar, x1 - bar, z - bar / 2, z + bar / 2);
    for (const x of [x0 + bar / 2, x1 - bar / 2]) cast(x - bar / 2, x + bar / 2, z0, z1);
    cast(gx - bar / 2, gx + bar / 2, z0 + bar, -bar / 2);
    cast(gx - bar / 2, gx + bar / 2, bar / 2, z1 - bar);
    for (const ex of [-1, 1]) for (const sz of [-1, 1]) b.box(bar * 0.8, gy - y, bar * 0.8, gx + ex * (gw / 2 - bar / 2), y, sz * (gd / 2 - bar / 2), iron);
  }
}

/** Glass-ceramic: a black glass top, zones as rings, touch controls at the front. */
function hobCeran(b: Builder, x: number, w: number, d: number, h: number, gw = w - 0.04, gd = d - 0.06) {
  b.box(gw, 0.006, gd, x, h, 0, mat(C.screen, { roughness: 0.08, metalness: 0.2 }));
  const pw = w - 0.12;
  const line = mat("#6a6d72", { roughness: 0.5 });
  const top = h + 0.0065;
  for (const [dx, dz, r] of [[-0.25, -0.22, 0.09], [0.25, -0.22, 0.075], [-0.25, 0.22, 0.075], [0.25, 0.22, 0.1]] as const)
    for (const k of [1, 0.6]) b.add(new THREE.RingGeometry(r * k - 0.003, r * k, 32), line, x + dx * pw, top, dz * (d - 0.1)).rotation.x = -Math.PI / 2;
  const lit = mat("#c9cdd1", { emissive: "#c9cdd1", emissiveIntensity: 0.3 });
  const cz = gd / 2 - 0.03;
  b.box(Math.min(0.14, pw * 0.35), 0.001, 0.005, x, top - 0.0005, cz, lit);
  for (let i = 0; i < 4; i++) b.add(new THREE.CircleGeometry(0.0045, 8), lit, x - Math.min(0.11, pw * 0.27) - 0.012 + (i % 2) * 0.016, top, cz - 0.008 + Math.floor(i / 2) * 0.016).rotation.x = -Math.PI / 2;
  b.add(new THREE.CircleGeometry(0.006, 10), mat("#d23a2a", { emissive: "#d23a2a", emissiveIntensity: 0.4 }), x + Math.min(0.11, pw * 0.27) + 0.01, top, cz).rotation.x = -Math.PI / 2;
}

/** What sits in a base unit's worktop (options.top), drawn on its top at h. The sink is cut in by body(). */
const TOPS: Record<string, (b: Builder, w: number, d: number, h: number) => void> = {
  hob_gas: (b, w, d, h) => hobGas(b, 0, w, d, h),
  hob_ceran: (b, w, d, h) => hobCeran(b, 0, w, d, h),
  hob_electric: (b, w, d, h) => {
    // the old kind: four cast-iron plates with chrome rims (knobs on the oven below)
    b.box(w - 0.06, 0.012, d - 0.1, 0, h, 0, mat(C.ceramic, { roughness: 0.4 }), 0.006);
    const pw = w - 0.12;
    const plate = mat("#2a2b2e", { roughness: 0.7 });
    const groove = mat("#3d3f43", { roughness: 0.6 });
    for (const [dx, dz, r] of [[-0.25, -0.22, 0.09], [0.25, -0.22, 0.072], [-0.25, 0.22, 0.072], [0.25, 0.22, 0.09]] as const) {
      const x = dx * pw;
      const z = dz * (d - 0.1);
      b.cyl(r, r, 0.016, x, h + 0.012, z, plate, 24);
      for (const k of [0.45, 0.72]) b.add(new THREE.RingGeometry(r * k - 0.003, r * k, 24), groove, x, h + 0.0285, z).rotation.x = -Math.PI / 2;
      b.add(new THREE.TorusGeometry(r, 0.005, 4, 24), mat(C.chrome, { metalness: 0.8, roughness: 0.25 }), x, h + 0.026, z).rotation.x = Math.PI / 2;
      b.cyl(0.012, 0.012, 0.004, x, h + 0.028, z, mat("#d23a2a"), 8);
    }
  },
  hob_downdraft: (b, w, d, h) => {
    // induction with the extractor sunk in its middle
    const gw = Math.min(w - 0.04, 0.8);
    const gd = Math.min(d - 0.1, 0.52);
    const top = h + 0.0065;
    b.box(gw, 0.006, gd, 0, h, 0, mat(C.screen, { roughness: 0.08, metalness: 0.2 }), 0.004);
    const line = mat("#6a6d72");
    const ring = (x: number, z: number, r: number) => (b.add(new THREE.RingGeometry(r - 0.003, r, 40), line, x, top, z).rotation.x = -Math.PI / 2);
    ring(-gw * 0.3, gd * 0.12, Math.min(0.11, gw * 0.14));
    ring(-gw * 0.15, -gd * 0.25, Math.min(0.07, gw * 0.09));
    const fx = gw * 0.3;
    const fw = Math.min(0.22, gw * 0.28);
    for (const z of [-gd * 0.21, gd * 0.21]) {
      for (const sz of [-1, 1]) b.box(fw, 0.001, 0.003, fx, top, z + sz * gd * 0.2, line);
      for (const sx of [-1, 1]) b.box(0.003, 0.001, gd * 0.4, fx + (sx * fw) / 2, top, z, line);
    }
    const gx = gw * 0.02;
    const gr = Math.min(0.075, gw * 0.1);
    b.cyl(gr, gr, 0.002, gx, top, 0, mat("#0d0e10", { roughness: 0.9 }), 32);
    const grille = mat("#4a4d52", { metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 7; i++) b.box(gr * 1.7 * Math.sqrt(1 - ((i - 3) / 3.6) ** 2), 0.002, 0.005, gx, top + 0.002, (i - 3) * gr * 0.26, grille);
    b.add(new THREE.TorusGeometry(gr, 0.004, 4, 32), grille, gx, top + 0.002, 0).rotation.x = Math.PI / 2;
    b.cyl(gr * 0.3, gr * 0.3, 0.008, gx, top, 0, mat("#2a2b2e", { roughness: 0.5 }), 20);
    for (let i = 0; i < 5; i++)
      b.add(new THREE.CircleGeometry(0.005, 8), mat("#c9cdd1", { emissive: "#c9cdd1", emissiveIntensity: 0.3 }), -gw * 0.05 + i * 0.022, top, gd / 2 - 0.05).rotation.x = -Math.PI / 2;
  },
};

// ----- appliance fronts -----

/** An oven's front at z, x centred (black glass door with a framed window, steel control strip, bar handle). */
function ovenDoor(b: Builder, x: number, w: number, y: number, h: number, z: number, knobs: boolean) {
  const zf = z + 0.02;
  b.box(w - 0.006, h - 0.004, 0.02, x, y + 0.002, z + 0.01, blackGlass());
  const ph = Math.min(0.09, h * 0.2);
  b.box(w - 0.006, ph, 0.022, x, y + h - ph - 0.002, z + 0.011, steel());
  const py = y + h - ph / 2 - 0.002;
  if (knobs) for (let i = 0; i < 5; i++) knob(b, x - w * 0.36 + (i * w * 0.72) / 4, py, z + 0.022, mat(C.black, { roughness: 0.4 }), 0.015);
  else {
    for (const sx of [-1, 1]) {
      b.cyl(0.019, 0.019, 0.016, x + sx * w * 0.36, py, z + 0.03, chrome(), 14).rotation.x = Math.PI / 2;
      b.box(0.003, 0.012, 0.002, x + sx * w * 0.36, py + 0.002, z + 0.038, mat(C.black));
    }
    b.box(w * 0.24, Math.min(0.03, ph * 0.4), 0.003, x, py - Math.min(0.015, ph * 0.2), z + 0.021, display());
  }
  const dh = h - ph - 0.004;
  barHandle(b, x, y + dh - Math.min(0.045, dh * 0.12), zf, w * 0.76, false, chrome(), 0.03, 0.007);
  const wh = dh * 0.5;
  b.box(w * 0.72, wh + 0.05, 0.002, x, y + dh * 0.16 - 0.025, zf, frameGrey());
  b.box(w * 0.62, wh, 0.003, x, y + dh * 0.16, zf, pane());
}

/** An oven or a built-in microwave in a tall unit. */
function applianceFront(b: Builder, w: number, y: number, h: number, z: number, kind: "oven" | "microwave") {
  if (kind === "oven") return ovenDoor(b, 0, w, y, h, z, false);
  const zf = z + 0.02;
  b.box(w - 0.006, h - 0.004, 0.02, 0, y + 0.002, z + 0.01, blackGlass());
  b.box(w * 0.62, h * 0.76, 0.002, -w * 0.12, y + h * 0.12, zf, frameGrey());
  b.box(w * 0.54, h * 0.6, 0.003, -w * 0.12, y + h * 0.2, zf, pane());
  b.box(w * 0.16, 0.025, 0.003, w * 0.33, y + h * 0.7, zf, display("#7fe0a0"));
  for (let i = 0; i < 2; i++) b.cyl(0.011, 0.011, 0.006, w * 0.33, y + h * (0.46 - i * 0.18), zf, frameGrey(), 12).rotation.x = Math.PI / 2;
  barHandle(b, w * 0.22, y + h * 0.5, zf, h * 0.5, true, chrome(), 0.02, 0.006);
}

/** The oven under a hob or worktop, with a drawer below. */
function oven(b: Builder, w: number, u: { y0: number; y1: number; fz: number }, f: THREE.Material, knobs = false) {
  const oh = Math.min(0.6, u.y1 - u.y0 - 0.12);
  ovenDoor(b, 0, w, u.y1 - oh - 0.01, oh, u.fz, knobs);
  kFronts(b, -w / 2, w, u.y0, u.y1 - oh - 0.01 - u.y0, u.fz, 1, f, 1, "bar", undefined, true);
}

/** A built-in coffee machine in a tall unit: a steel strip with its display, the dark bay with spout, grille and cup. */
function builtInCoffee(b: Builder, w: number, y: number, h: number, z: number) {
  const st = steel();
  b.box(w - 0.006, h - 0.004, 0.02, 0, y + 0.002, z + 0.01, blackGlass());
  b.box(w - 0.006, 0.08, 0.022, 0, y + h - 0.08, z + 0.011, st);
  b.box(w * 0.3, 0.04, 0.003, -w * 0.15, y + h - 0.06, z + 0.021, display());
  for (let i = 0; i < 3; i++) b.cyl(0.008, 0.008, 0.004, w * 0.12 + i * 0.03, y + h - 0.04, z + 0.022, mat("#c9cdd1"), 10).rotation.x = Math.PI / 2;
  const bw = w * 0.36;
  const bh = h * 0.62;
  b.box(bw + 0.016, bh + 0.016, 0.002, 0, y + 0.022, z + 0.02, st);
  b.box(bw, bh, 0.003, 0, y + 0.03, z + 0.0205, mat(C.black, { roughness: 0.5 }));
  b.box(w * 0.14, 0.03, 0.05, 0, y + 0.03 + bh - 0.045, z + 0.035, st, 0.006);
  for (const sx of [-1, 1]) b.cyl(0.004, 0.003, 0.012, sx * 0.012, y + 0.03 + bh - 0.057, z + 0.045, st, 8);
  b.box(bw - 0.01, 0.006, 0.05, 0, y + 0.03, z + 0.045, mat("#9aa0a6", { metalness: 0.7, roughness: 0.3 }));
  b.cyl(0.028, 0.023, 0.07, 0, y + 0.036, z + 0.045, mat(C.ceramic), 14);
}

/** An open niche in a tall unit (for a microwave or the coffee machine one brings along). */
function niche(b: Builder, w: number, y: number, h: number, z: number) {
  b.box(w - 0.04, h - 0.03, 0.004, 0, y + 0.015, z + 0.002, mat("#3a3c40", { roughness: 0.9 }));
  b.box(w - 0.04, 0.018, 0.006, 0, y + 0.015, z + 0.004, mat("#d9d6d0", { roughness: 0.8 }));
}

/** A base unit without fronts: a box open to the front with two shelves, under the worktop. */
function openBase(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, sink?: Sink) {
  const t = 0.018;
  const inner = h - TOP - PLINTH;
  plinth(b, w, d);
  b.box(w, t, d - 0.03, 0, PLINTH, back(d) + (d - 0.03) / 2, f);
  b.box(w, inner, t, 0, PLINTH, back(d) + t / 2, f);
  for (const sx of [-1, 1]) b.box(t, inner, d - 0.03, sx * (w / 2 - t / 2), PLINTH, back(d) + (d - 0.03) / 2, f);
  for (let s = 1; s <= 2; s++) b.box(w - 2 * t, t, d - 0.06, 0, PLINTH + (inner * s) / 3, back(d) + (d - 0.06) / 2, f);
  worktop(b, -w / 2, w / 2, d, h, a, holeOf(sink));
  if (sink) drawSink(b, sink, d, h);
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  kitchen: (b, w, d, h, f, _c, a) => {
    const n = Math.max(1, Math.round(w / 0.6));
    const uw = w / n;
    const sinkAt = n > 1 ? Math.floor(n / 3) : -1;
    const hob = n > 2 ? Math.min(n - 1, sinkAt + 2) : -1;
    const sx = -w / 2 + uw * (sinkAt + 0.5);
    const u = body(b, w, d, h, f, a, sinkAt < 0 ? undefined : { x: sx, bw: uw - 0.16, bd: d - 0.26, z: 0.02, goose: false, above: false });
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + uw * (i + 0.5);
      if (i === hob) {
        // an oven under the glass hob, a panel over it
        kFronts(b, x - uw / 2, uw, h - TOP - 0.14, 0.12, u.fz, 1, f, 1, "push", undefined, true);
        ovenDoor(b, x, uw, 0.12, 0.6, u.fz, false);
        hobCeran(b, x, uw, d, h, uw - 0.1, d - 0.12);
      } else kFronts(b, x - uw / 2, uw, PLINTH, h - TOP - PLINTH, u.fz, 1, f, i % 2 ? 3 : 1, "push");
      if (i) b.box(0.005, h - TOP - PLINTH, 0.02, x - uw / 2, PLINTH, u.fz + 0.0105, joint());
    }
  },
  kitchen_island: (b, w, d, h, f, _c, a) => {
    const over = Math.min(0.3, d * 0.3);
    const bd = d - over;
    b.box(w - 0.1, PLINTH, bd - 0.08, 0, 0, back(d) + bd / 2, mat("#202124", { roughness: 0.7 }));
    b.box(w - 0.08, h - TOP - PLINTH, bd, 0, PLINTH, back(d) + bd / 2, f);
    // fronts towards the kitchen (the back), seats under the overhang
    kFronts(b, -w / 2 + 0.04, w - 0.08, PLINTH, h - TOP - PLINTH, back(d) - 0.018, Math.max(1, Math.round((w - 0.08) / 0.6)), f, 3);
    // a worktop folding down at both ends (waterfall), its outer edges eased
    const sec: P2[] = [[-d / 2, h - TOP], [d / 2, h - TOP], [d / 2, h], [-d / 2, h]];
    b.add(loft([{ pts: sec, s: -w / 2 + TOP }, { pts: sec, s: w / 2 - TOP }], "x"), a);
    const e = 0.004;
    for (const sx of [-1, 1]) {
      const x0 = sx > 0 ? w / 2 - TOP : -w / 2;
      const side: P2[] = (sx > 0 ? [[0, 0], [TOP, 0], [TOP, h - e], [TOP - e, h], [0, h]] : [[0, 0], [TOP, 0], [TOP, h], [e, h], [0, h - e]]).map(([x, y]): P2 => [x0 + x, y]);
      b.add(loft([{ pts: side, s: -d / 2 }, { pts: side, s: d / 2 }], "z"), a);
    }
  },
  kitchen_upper: (b, w, d, h, f) => {
    const n = Math.max(1, Math.round(w / 0.6));
    b.box(w, h, d - 0.02, 0, 0, back(d) + (d - 0.02) / 2, f);
    kFronts(b, -w / 2, w, 0, h, d / 2 - 0.02, n, f, 1, "bar");
    // light under the cabinets: a slim profile with its diffuser
    b.box(w - 0.04, 0.008, 0.035, 0, -0.008, d / 2 - 0.06, mat("#a9adb2", { metalness: 0.6, roughness: 0.35 }));
    b.box(w - 0.05, 0.002, 0.024, 0, -0.0095, d / 2 - 0.06, mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.6 }));
  },
  kitchen_tall: (b, w, d, h, f) => {
    // what is behind the fronts (options.fronts): model/modern.ts TALL_FRONTS
    plinth(b, w, d);
    b.box(w, h - PLINTH, d - 0.03, 0, PLINTH, back(d) + (d - 0.03) / 2, f);
    const z = d / 2 - 0.03;
    const doors = Math.max(1, Math.round(w / 0.6));
    const drawers = Math.max(1, Math.round(w / 0.9));
    // from the plinth up: fixed parts, then doors to the top (shrunk to fit a low unit)
    type Part = { h: number; draw: (y: number, ph: number) => void };
    const door = (n = doors): Part["draw"] => (y, ph) => kFronts(b, -w / 2, w, y, ph, z, n, f, 1, "bar");
    const drawerRows = (rows: number): Part["draw"] => (y, ph) => kFronts(b, -w / 2, w, y, ph, z, drawers, f, rows, "bar", undefined, true);
    const appliance = (kind: "oven" | "microwave"): Part["draw"] => (y, ph) => applianceFront(b, Math.min(w, 0.6), y, ph, z, kind);
    const one: Part["draw"] = (y, ph) => kFronts(b, -w / 2, w, y, ph, z, 1, f, 1, "bar", undefined, true);
    const parts: Part[] = (
      {
        doors: [{ h: (h - 0.1) * 0.45, draw: door() }],
        drawers_doors: [{ h: 0.72, draw: drawerRows(3) }],
        // a dishwasher at working height: a drawer under it
        dishwasher: [{ h: 0.3, draw: drawerRows(1) }, { h: 0.82, draw: one }],
        oven: [{ h: 0.6, draw: drawerRows(2) }, { h: 0.6, draw: appliance("oven") }],
        oven_microwave: [{ h: 0.6, draw: drawerRows(2) }, { h: 0.6, draw: appliance("oven") }, { h: 0.38, draw: appliance("microwave") }],
        oven_steam: [{ h: 0.45, draw: drawerRows(1) }, { h: 0.6, draw: appliance("oven") }, { h: 0.45, draw: appliance("oven") }],
        coffee: [{ h: 0.72, draw: drawerRows(3) }, { h: 0.45, draw: (y, ph) => builtInCoffee(b, Math.min(w, 0.6), y, ph, z) }],
        fridge: [{ h: 1.22, draw: door(1) }],
        fridge_freezer: [{ h: 0.72, draw: door(1) }, { h: 1.0, draw: door(1) }],
        // a pull-out larder: one front, its handle across the top
        apothecary: [],
        niche: [{ h: 0.6, draw: drawerRows(2) }, { h: 0.45, draw: (y, ph) => niche(b, w, y, ph, z) }],
      } as Record<string, Part[]>
    )[b.options.fronts ?? "doors"] ?? [];
    const room = h - 0.1;
    const fixed = parts.reduce((t, p) => t + p.h, 0);
    // a low unit: the parts share what there is, leaving a door's worth on top
    const k = fixed > room - 0.25 ? Math.max(0, room - 0.25) / fixed : 1;
    let y = 0.1;
    for (const p of parts) {
      p.draw(y, p.h * k);
      y += p.h * k;
    }
    if (b.options.fronts === "apothecary") one(y, h - y);
    else door()(y, h - y);
  },
  kitchen_base: (b, w, d, h, f, _c, a) => {
    // what is behind the fronts and in the worktop (options.fronts, options.top): model/modern.ts
    const layout = b.options.fronts ?? "drawer_door";
    const top = b.options.top ?? "none";
    const sink: Sink | undefined = top === "sink" ? { x: 0, bw: Math.min(w - 0.16, 0.7), bd: d - 0.26, z: 0.03, goose: true, above: true } : undefined;
    if (layout === "shelves") {
      openBase(b, w, d, h, f, a, sink);
      TOPS[top]?.(b, w, d, h);
      return;
    }
    const u = body(b, w, d, h, f, a, sink);
    const doors = Math.max(1, Math.round(w / 0.5));
    const drawers = Math.max(1, Math.round(w / 0.9));
    const tall = u.y1 - u.y0;
    // a sink leaves no room for a top drawer: its front is a fixed panel
    const panel = (handled: boolean, n: number) => kFronts(b, -w / 2, w, u.y1 - 0.17, 0.17, u.fz, n, f, 1, handled ? "bar" : undefined, undefined, true);
    const stack = (rows: number[], from = u.y1) => {
      let y = from;
      for (const rh of rows) {
        y -= rh;
        kFronts(b, -w / 2, w, y, rh, u.fz, drawers, f, 1, "bar", undefined, true);
      }
    };
    if (layout === "door") kFronts(b, -w / 2, w, u.y0, tall, u.fz, doors, f, 1, "bar");
    else if (layout === "drawers_2") stack([tall / 2, tall / 2]);
    else if (layout === "drawers_3") {
      panel(top !== "sink", drawers);
      stack([0.27, tall - 0.44], u.y1 - 0.17);
    } else if (layout === "panel_drawer") {
      panel(false, 1);
      kFronts(b, -w / 2, w, u.y0, tall - 0.17, u.fz, drawers, f, 1, "bar", undefined, true);
    } else if (layout === "oven") oven(b, w, u, f, top === "hob_electric" || top === "hob_gas");
    else {
      panel(top !== "sink", doors);
      kFronts(b, -w / 2, w, u.y0, tall - 0.17, u.fz, doors, f, 1, "bar");
    }
    TOPS[top]?.(b, w, d, h);
  },
  kitchen_dishwasher: (b, w, d, h, f, _c, a) => {
    const u = body(b, w, d, h, f, a);
    kFronts(b, -w / 2, w, u.y0, u.y1 - u.y0, u.fz, 1, f, 1, "bar");
    // its control strip and a status light show in the gap under the worktop
    b.box(w - 0.04, 0.004, 0.012, 0, u.y1 - 0.004, u.fz + 0.004, mat("#3a3d42", { metalness: 0.5, roughness: 0.4 }));
    b.box(0.006, 0.003, 0.002, w / 2 - 0.06, u.y1 - 0.0035, u.fz + 0.011, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.6 }));
  },
  kitchen_corner: (b, w, d, h, f, _c, a) => {
    // the blind corner of an L: the worktop runs on, a door on the open part
    b.box(w - 0.05, PLINTH, d - 0.05, -0.025, 0, -0.025, mat("#202124", { roughness: 0.7 }));
    b.box(w - 0.02, h - TOP - PLINTH, d - 0.02, -0.01, PLINTH, -0.01, f);
    worktop(b, -w / 2, w / 2, d, h, a);
    const open = Math.max(0.3, w - 0.62);
    kFronts(b, -w / 2, open, PLINTH, h - TOP - PLINTH, d / 2 - 0.02, 1, f, 1, "bar");
    const sd = Math.max(0.3, d - 0.62);
    const side = b.box(sd, h - TOP - PLINTH, 0.018, 0, PLINTH, 0, f);
    side?.position.set(w / 2 - 0.009 + 0.001, PLINTH + (h - TOP - PLINTH) / 2, -d / 2 + sd / 2);
    side?.rotation.set(0, Math.PI / 2, 0);
  },
  kitchen_upper_glass: (b, w, d, h, f) => {
    const n = Math.max(1, Math.round(w / 0.5));
    const t = 0.018;
    const id = d - 0.02;
    const iz = back(d) + id / 2;
    b.box(w, h, t, 0, 0, back(d) + t / 2, f);
    for (const sx of [-1, 1]) b.box(t, h, id, sx * (w / 2 - t / 2), 0, iz, f);
    b.box(w, t, id, 0, 0, iz, f);
    b.box(w, t, id, 0, h - t, iz, f);
    // glass shelves on the inside, a light strip under the top
    const shelf = mat("#dfe9ec", { transparent: true, opacity: 0.55, roughness: 0.1 });
    for (let s = 1; s < 3; s++) b.box(w - 2 * t, 0.008, id - 0.03, 0, (h * s) / 3, back(d) + (id - 0.01) / 2, shelf);
    b.box(w - 0.08, 0.004, 0.02, 0, h - t - 0.004, d / 2 - 0.06, mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.6 }));
    // dishes: stacked plates, bowls, glasses, cups
    const rand = random(211);
    const ceramic = mat(C.ceramic, { roughness: 0.4 });
    const tumbler = glass();
    for (let s = 0; s < 3; s++) {
      const y = s ? (h * s) / 3 + 0.008 : t;
      const room = h / 3 - 0.03;
      let x = -w / 2 + t + 0.02;
      while (x < w / 2 - t - 0.09) {
        const kind = rand();
        const z = back(d) + id * 0.45;
        if (kind < 0.35) {
          const r = 0.1;
          if (x + 2 * r > w / 2 - t - 0.01) break;
          for (let k = 0; k < 4 + Math.floor(rand() * 3); k++) b.batch(new THREE.CylinderGeometry(r, r * 0.8, 0.012, 14), ceramic, new THREE.Matrix4().makeTranslation(x + r, y + 0.006 + k * 0.014, z));
          x += 2 * r + 0.02;
        } else if (kind < 0.6) {
          const r = 0.065;
          for (let k = 0; k < 3; k++) {
            const bowl = lathe([[0.001, 0], [r * 0.5, 0], [r * 0.85, 0.025], [r, 0.05], [r * 0.95, 0.05], [r * 0.8, 0.026], [0.001, 0.008]].map(([a, c]) => new THREE.Vector2(a, c)), 12);
            b.batch(bowl, ceramic, new THREE.Matrix4().makeTranslation(x + r, y + k * 0.018, z));
          }
          x += 2 * r + 0.02;
        } else {
          for (let k = 0; k < 2; k++) b.cyl(0.035, 0.03, Math.min(room, 0.11), x + 0.035 + k * 0.08, y, z + (k ? 0.05 : -0.02), tumbler, 10);
          x += 0.18;
        }
      }
    }
    // the doors: framed glass, a slim bar each
    const cw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + cw * (i + 0.5);
      const fw = 0.05;
      const fz = d / 2 - 0.02 + 0.009;
      b.box(cw - 0.004, fw, 0.018, x, 0.002, fz, f);
      b.box(cw - 0.004, fw, 0.018, x, h - fw - 0.002, fz, f);
      for (const sx of [-1, 1]) b.box(fw, h - 2 * fw - 0.004, 0.018, x + sx * (cw / 2 - 0.002 - fw / 2), fw + 0.002, fz, f);
      b.box(cw - 2 * fw, h - 2 * fw, 0.006, x, fw, fz, glass());
      barHandle(b, x + (i % 2 ? 1 : -1) * (cw / 2 - 0.025), fw * 2.2, d / 2 - 0.002, 0.12, true, handleBlack(), 0.018, 0.004);
    }
  },
  kitchen_hood: (b, w, d, h, f) => {
    // a chimney hood: a canopy with a straight lip, sloping to the duct up to the ceiling
    const canopy = Math.min(0.25, h * 0.3);
    const lip = Math.min(0.05, canopy * 0.3);
    const cw = w * 0.42;
    const cd = d * 0.42;
    const top = rrect(cw + 0.03, cd + 0.015, 0, 1, 0, back(d) + (cd + 0.015) / 2);
    b.add(loft([{ pts: rrect(w, d, 0, 1), s: 0 }, { pts: rrect(w, d, 0, 1), s: lip }, { pts: top, s: canopy }], "y"), f);
    // the duct: two telescoping parts, the upper one a little larger
    const dz = back(d) + cd / 2;
    const mid = canopy + (h - canopy) * 0.45;
    b.box(cw, mid - canopy, cd, 0, canopy, dz, f);
    b.box(cw + 0.006, h - mid, cd + 0.003, 0, mid, dz + 0.0015, f);
    // underneath: two grease filters with their slats, two lights
    const under = mat("#4d5156", { metalness: 0.5, roughness: 0.5 });
    b.box(w - 0.02, 0.003, d - 0.02, 0, -0.003, 0, under);
    const mesh = mat("#9ba1a7", { metalness: 0.7, roughness: 0.35 });
    const slat = mat("#6d7278", { metalness: 0.6, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const fx = sx * w * 0.21;
      const fw = w * 0.38;
      const fd = d * 0.62;
      b.box(fw, 0.003, fd, fx, -0.006, -d * 0.06, mesh);
      for (let k = 1; k < 6; k++) b.box(0.004, 0.002, fd - 0.01, fx - fw / 2 + (fw * k) / 6, -0.0075, -d * 0.06, slat);
      b.add(new THREE.CircleGeometry(0.025, 14), mat("#fff3d6", { emissive: "#ffe8b8", emissiveIntensity: 0.8 }), sx * w * 0.3, -0.0065, d * 0.36).rotation.x = Math.PI / 2;
    }
    // controls on the lip: buttons and a light
    for (let i = 0; i < 4; i++) b.box(0.016, 0.01, 0.003, w * 0.18 + i * 0.026, lip * 0.5 - 0.005, d / 2, mat("#2a2c30", { roughness: 0.4 }));
    b.box(0.004, 0.004, 0.002, w * 0.18 - 0.02, lip * 0.5 - 0.002, d / 2, mat("#7fd0ff", { emissive: "#7fd0ff", emissiveIntensity: 0.8 }));
  },
  fridge_freestanding: (b, w, d, h, f) => {
    const bd = d - 0.05;
    const bz = -0.025;
    b.box(w - 0.06, 0.03, bd - 0.08, 0, 0, bz - 0.02, rubber());
    b.add(loft([{ pts: rrect(w, bd, 0.025, 2, 0, bz), s: 0.03 }, { pts: rrect(w, bd, 0.025, 2, 0, bz), s: h - 0.012 }, { pts: rrect(w - 0.024, bd - 0.024, 0.013, 2, 0, bz), s: h }], "y"), f);
    const split = h * 0.62;
    const zb = d / 2 - 0.052;
    const door = (y0: number, y1: number) => {
      b.box(w - 0.03, y1 - y0 - 0.03, 0.006, 0, y0 + 0.015, zb - 0.003, rubber());
      const g = slab(w - 0.004, y1 - y0, 0.048, 0.02, 0.006, "z");
      b.add(g, f, 0, (y0 + y1) / 2, zb);
    };
    door(h - split, h - 0.04);
    door(0.03, h - split - 0.03);
    const handle = chrome();
    const zf = d / 2 - 0.004;
    barHandle(b, w / 2 - 0.06, h - split + 0.25, zf, 0.4, true, handle, 0.03, 0.009);
    barHandle(b, w / 2 - 0.06, h - split - 0.25, zf, 0.3, true, handle, 0.03, 0.009);
    // hinge covers, a small display on the door
    rbox(b, 0.05, 0.02, 0.05, -w / 2 + 0.05, h - 0.04, zb + 0.004, f, 0.005);
    b.box(0.09, 0.035, 0.003, -w / 2 + 0.12, h - 0.15, zf, blackGlass(), 0.002);
    b.box(0.03, 0.01, 0.002, -w / 2 + 0.12, h - 0.14, zf + 0.002, display());
  },
  fridge_double: (b, w, d, h, f) => {
    // side by side, with ice and water in the left door
    const bd = d - 0.06;
    const bz = -0.03;
    b.box(w - 0.06, 0.03, bd - 0.08, 0, 0, bz - 0.02, rubber());
    b.add(loft([{ pts: rrect(w, bd, 0.025, 2, 0, bz), s: 0.03 }, { pts: rrect(w, bd, 0.025, 2, 0, bz), s: h - 0.012 }, { pts: rrect(w - 0.024, bd - 0.024, 0.013, 2, 0, bz), s: h }], "y"), f);
    const zb = d / 2 - 0.065;
    const zf = zb + 0.058;
    const handle = chrome();
    for (const sx of [-1, 1]) {
      const dw = sx < 0 ? w * 0.42 : w * 0.58;
      const x = sx < 0 ? -w / 2 + dw / 2 : w / 2 - dw / 2;
      b.box(dw - 0.03, h - 0.1, 0.006, x, 0.06, zb - 0.003, rubber());
      b.add(slab(dw - 0.006, h - 0.05, 0.058, 0.02, 0.006, "z"), f, x, 0.04 + (h - 0.05) / 2, zb);
      barHandle(b, sx < 0 ? -w / 2 + dw - 0.04 : w / 2 - dw + 0.04, h * 0.52, zf, h * 0.55, true, handle, 0.035, 0.011);
      rbox(b, 0.06, 0.02, 0.05, x - sx * (dw / 2 - 0.05), h - 0.01, zb + 0.004, f, 0.005);
    }
    // the dispenser: a dark recess with a lit display over it and a paddle
    const dx = -w / 2 + w * 0.21;
    const dy = h * 0.55;
    b.add(slab(w * 0.2, 0.3, 0.004, 0.02, 0, "z"), mat("#2b2d31", { roughness: 0.5 }), dx, dy + 0.15, zf);
    b.add(slab(w * 0.16, 0.2, 0.004, 0.015, 0, "z"), mat("#141517", { roughness: 0.7 }), dx, dy + 0.12, zf + 0.002);
    b.box(w * 0.08, 0.02, 0.004, dx, dy + 0.255, zf + 0.002, mat("#7fc7f0", { emissive: "#7fc7f0", emissiveIntensity: 0.5 }));
    rbox(b, w * 0.06, 0.07, 0.012, dx, dy + 0.11, zf + 0.004, mat("#3a3c40", { roughness: 0.5 }), 0.004);
    b.box(w * 0.14, 0.01, 0.03, dx, dy + 0.025, zf + 0.01, mat("#55595e", { metalness: 0.5, roughness: 0.4 }));
    // the kick grille
    for (let i = 0; i < 4; i++) b.box(w * 0.7, 0.004, 0.004, 0, 0.008 + i * 0.006, bz + bd / 2 - 0.035, mat("#3a3c40"));
  },
  microwave: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.012, 0.012, 0.008, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.05), rubber(), 8);
    rbox(b, w, h - 0.008, d, 0, 0.008, 0, f, 0.015);
    const zf = d / 2;
    const y = 0.008;
    const fh = h - 0.008;
    // the door: a dark framed window, its edge a slim handle recess
    b.box(w * 0.72, fh * 0.86, 0.004, -w * 0.13, y + fh * 0.07, zf, frameGrey(), 0.002);
    b.box(w * 0.6, fh * 0.66, 0.004, -w * 0.15, y + fh * 0.17, zf + 0.001, mat("#14191c", { roughness: 0.08, metalness: 0.3 }));
    rbox(b, 0.012, fh * 0.6, 0.012, w * 0.215, y + fh * 0.2, zf + 0.004, mat("#2a2c30", { roughness: 0.4 }), 0.004);
    // controls: display, dial, buttons, the door button
    b.box(w * 0.16, fh * 0.12, 0.003, w * 0.36, y + fh * 0.76, zf, display("#5fe08f"));
    b.cyl(0.02, 0.021, 0.014, w * 0.36, y + fh * 0.48, zf, chrome(), 16).rotation.x = Math.PI / 2;
    b.box(0.003, 0.012, 0.002, w * 0.36, y + fh * 0.48 + 0.006, zf + 0.015, mat(C.black));
    for (let i = 0; i < 2; i++) b.box(0.025, 0.012, 0.004, w * 0.33 + i * 0.03, y + fh * 0.3, zf, frameGrey(), 0.002);
    rbox(b, w * 0.16, 0.02, 0.005, w * 0.36, y + fh * 0.12, zf, frameGrey(), 0.003);
    // vents on the right side
    for (let i = 0; i < 6; i++) b.box(0.002, fh * 0.35, 0.006, w / 2, y + fh * 0.45, -d * 0.3 + i * 0.012, mat("#2a2c30"));
  },
  coffee_capsule: (b, w, d, h, f) => {
    // a slim capsule machine: the water tank at the back, a column, the head with its lever over the cup
    const dark = mat("#26272a", { roughness: 0.5 });
    rbox(b, w, 0.012, d * 0.96, 0, 0, 0, dark, 0.004);
    // the tank: glass with water in it
    const tz = -d / 2 + d * 0.16;
    rbox(b, w * 0.88, h * 0.72, d * 0.3, 0, 0.012, tz, glass(), 0.012);
    b.box(w * 0.8, h * 0.48, d * 0.26, 0, 0.016, tz, mat("#a9d3e6", { transparent: true, opacity: 0.45, roughness: 0.1 }));
    rbox(b, w * 0.88, 0.02, d * 0.3, 0, 0.012 + h * 0.72, tz, f, 0.006);
    // the column and the head
    rbox(b, w, h * 0.84, d * 0.34, 0, 0.012, -d * 0.03, f, 0.02);
    rbox(b, w, h * 0.3, d * 0.42, 0, h * 0.54, d * 0.26, f, 0.025);
    b.box(w * 0.6, 0.004, d * 0.36, 0, h * 0.84 - 0.001, d * 0.24, mat("#1d1e20", { roughness: 0.6 }), 0.002);
    // lever on top
    const lever = rbox(b, w * 0.66, 0.018, d * 0.4, 0, 0, 0, chrome(), 0.008);
    lever?.position.set(0, h * 0.86 + 0.012, d * 0.18);
    lever?.rotation.set(-0.12, 0, 0);
    // spout, the drip tray with its grille, the cup
    b.cyl(0.012, 0.009, 0.015, 0, h * 0.54 - 0.015, d * 0.3, dark, 10);
    rbox(b, w * 0.92, 0.03, d * 0.4, 0, 0.012, d * 0.27, dark, 0.006);
    b.box(w * 0.82, 0.003, d * 0.34, 0, 0.042, d * 0.27, mat("#9aa0a6", { metalness: 0.7, roughness: 0.3 }));
    for (let i = 0; i < 5; i++) b.box(w * 0.78, 0.001, 0.003, 0, 0.0445, d * 0.13 + i * d * 0.07, dark);
    b.add(lathe([[0.001, 0], [0.022, 0], [0.026, 0.01], [0.03, 0.055], [0.027, 0.055], [0.024, 0.012], [0.001, 0.01]].map(([a, c]) => new THREE.Vector2(a, c)), 16), mat(C.ceramic, { roughness: 0.3 }), 0, 0.045, d * 0.3);
    b.add(new THREE.TorusGeometry(0.014, 0.004, 5, 10, Math.PI).rotateZ(-Math.PI / 2), mat(C.ceramic, { roughness: 0.3 }), 0.03, 0.073, d * 0.3);
    // two buttons on the head
    for (const sx of [-1, 1]) b.cyl(0.008, 0.008, 0.006, sx * w * 0.18, h * 0.82, d * 0.42, mat("#e8e6e1", { emissive: "#ffffff", emissiveIntensity: 0.15 }), 12);
  },
  coffee_automatic: (b, w, d, h, f, _c, a) => {
    // a bean-to-cup machine: the body, a head with the display over a recess with the
    // spout and a cup on the drip tray, the bean container's lid on top
    const dark = mat(C.black, { roughness: 0.35 });
    const bayZ = d * 0.1;
    rbox(b, w, h * 0.92, d / 2 + bayZ, 0, 0, -d / 2 + (d / 2 + bayZ) / 2, f, 0.02);
    rbox(b, w, h * 0.4, d * 0.36, 0, h * 0.52, d * 0.3 - 0.0, f, 0.02);
    b.box(w * 0.04, h * 0.48, d * 0.38, -w / 2 + w * 0.02, 0.04, d * 0.29, f);
    b.box(w * 0.04, h * 0.48, d * 0.38, w / 2 - w * 0.02, 0.04, d * 0.29, f);
    b.box(w * 0.94, h * 0.47, 0.004, 0, 0.045, bayZ + 0.002, mat("#1a1b1d", { roughness: 0.6 }));
    // spout block with two nozzles
    rbox(b, w * 0.34, h * 0.06, d * 0.14, 0, h * 0.46, d * 0.3, a, 0.008);
    for (const s of [-1, 1]) b.cyl(0.006, 0.004, 0.02, s * w * 0.06, h * 0.44, d * 0.32, a, 8);
    // drip tray with a grille and its front, a cup
    rbox(b, w * 0.9, 0.045, d * 0.38, 0, 0, d * 0.3, dark, 0.006);
    b.box(w * 0.8, 0.004, d * 0.3, 0, 0.045, d * 0.3, mat(C.chrome, { metalness: 0.8, roughness: 0.25 }));
    for (let i = 0; i < 5; i++) b.box(w * 0.76, 0.001, 0.003, 0, 0.049, d * 0.17 + i * d * 0.06, dark);
    b.box(w * 0.9, 0.03, 0.004, 0, 0.008, d / 2 - 0.002, a);
    b.add(lathe([[0.001, 0], [0.024, 0], [0.028, 0.01], [0.033, 0.08], [0.03, 0.08], [0.026, 0.012], [0.001, 0.01]].map(([x, y]) => new THREE.Vector2(x, y)), 16), mat(C.ceramic, { roughness: 0.3 }), 0, 0.049, d * 0.31);
    // the panel: a screen with buttons on the head's front
    const pz = d * 0.48;
    rbox(b, w * 0.86, h * 0.17, 0.006, 0, h * 0.66, pz, dark, 0.003);
    b.box(w * 0.46, h * 0.1, 0.003, 0, h * 0.695, pz + 0.004, mat(C.screen, { emissive: "#7fb6ff", emissiveIntensity: 0.3, roughness: 0.1 }));
    for (const s of [-1, 1]) b.cyl(0.011, 0.011, 0.006, s * w * 0.35, h * 0.745, pz + 0.004, a, 12).rotation.x = Math.PI / 2;
    // the bean container's lid and the water tank's lid on top
    rbox(b, w * 0.5, 0.012, d * 0.3, -w * 0.12, h * 0.92, -d * 0.18, dark, 0.006);
    rbox(b, w * 0.3, 0.008, d * 0.2, w * 0.25, h * 0.92, -d * 0.3, dark, 0.004);
  },
  coffee_portafilter: (b, w, d, h, f) => {
    // a dual-boiler espresso machine: body on feet, gauges, group head with portafilter,
    // steam wand, drip tray, cups on the warmer behind a rail
    const st = mat(C.chrome, { metalness: 0.85, roughness: 0.2 });
    const black = mat(C.black, { roughness: 0.4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.012, 0.014, 0.04, sx * w * 0.42, 0, sz * d * 0.32 - d * 0.05, black, 8);
    const fz = d * 0.3;
    rbox(b, w, h * 0.82, d * 0.8, 0, 0.04, -d * 0.1, f, 0.015);
    b.box(w * 0.96, 0.004, d * 0.76, 0, 0.04 + h * 0.82, -d * 0.1, mat("#9aa0a6", { metalness: 0.7, roughness: 0.35 }));
    // the drip tray with its grille
    b.box(w * 0.9, 0.03, d * 0.22, 0, 0.04, d * 0.39, st);
    for (let i = 0; i < 6; i++) b.box(w * 0.86, 0.002, 0.004, 0, 0.0701, d * 0.3 + i * d * 0.032, black);
    // gauges: chrome bezels, white faces, needles
    for (const sx of [-1, 1]) {
      const gx = sx * w * 0.28;
      const gy = h * 0.72;
      b.cyl(0.034, 0.034, 0.012, gx, gy, fz + 0.006, st, 16).rotation.x = Math.PI / 2;
      b.cyl(0.028, 0.028, 0.002, gx, gy, fz + 0.013, mat("#f4f4f2", { roughness: 0.3 }), 16).rotation.x = Math.PI / 2;
      const needle = b.box(0.003, 0.022, 0.002, gx, gy, fz + 0.015, mat("#c0392b"));
      needle?.rotation.set(0, 0, sx * 0.6);
    }
    // the group head: a chrome block, the group, the portafilter and its handle
    const gx = -w * 0.04;
    const gy = h * 0.52;
    rbox(b, w * 0.2, 0.05, 0.05, gx, gy, fz + 0.025, st, 0.008);
    b.cyl(0.04, 0.044, 0.035, gx, gy - 0.035, fz + 0.05, st, 14);
    b.cyl(0.037, 0.034, 0.025, gx, gy - 0.06, fz + 0.05, st, 14);
    b.rod(v(gx, gy - 0.05, fz + 0.08), v(gx, gy - 0.065, d / 2 + 0.03), 0.011, black, 8);
    for (const s of [-1, 1]) b.cyl(0.004, 0.003, 0.015, gx + s * 0.012, gy - 0.075, fz + 0.05, st, 6);
    b.add(lathe([[0.001, 0], [0.02, 0], [0.023, 0.008], [0.026, 0.055], [0.023, 0.055], [0.02, 0.01], [0.001, 0.008]].map(([x, y]) => new THREE.Vector2(x, y)), 14), mat(C.ceramic, { roughness: 0.3 }), gx, 0.072, fz + 0.05);
    // steam wand on the right, hot water on the left, their knobs
    b.rod(v(w * 0.36, h * 0.6, fz + 0.012), v(w * 0.38, h * 0.6, fz + 0.04), 0.008, st, 8);
    b.rod(v(w * 0.38, h * 0.6, fz + 0.04), v(w * 0.4, h * 0.25, fz + 0.07), 0.005, st, 6);
    b.rod(v(w * 0.38, h * 0.55, fz + 0.045), v(w * 0.385, h * 0.45, fz + 0.05), 0.009, black, 8);
    b.rod(v(-w * 0.36, h * 0.6, fz + 0.012), v(-w * 0.37, h * 0.42, fz + 0.04), 0.006, st, 6);
    for (const sx of [-1, 1]) b.cyl(0.016, 0.016, 0.03, sx * w * 0.36, h * 0.72, fz, black, 12).rotation.x = Math.PI / 2;
    b.box(0.014, 0.022, 0.006, w * 0.1, h * 0.86, fz, black, 0.002);
    b.box(0.006, 0.006, 0.004, w * 0.16, h * 0.86 + 0.008, fz, mat("#ff9b3d", { emissive: "#ff9b3d", emissiveIntensity: 0.6 }));
    // the cup warmer: a rail round three sides, cups upside down
    const top = 0.04 + h * 0.82;
    const rx = w / 2 - 0.02;
    const rz0 = -d / 2 + 0.03;
    const rz1 = fz - 0.03;
    for (const sx of [-1, 1]) b.rod(v(sx * rx, top + 0.035, rz0), v(sx * rx, top + 0.035, rz1), 0.004, st, 6);
    b.rod(v(-rx, top + 0.035, rz0), v(rx, top + 0.035, rz0), 0.004, st, 6);
    for (const [x, z] of [[-rx, rz0], [rx, rz0], [-rx, rz1], [rx, rz1]]) b.rod(v(x, top, z), v(x, top + 0.035, z), 0.004, st, 6);
    for (let i = 0; i < 3; i++) b.cyl(0.025, 0.03, 0.05, -w * 0.25 + i * w * 0.25, top + 0.004, -d * 0.12, mat(C.ceramic, { roughness: 0.3 }), 14);
  },
  toaster: (b, w, d, h, f) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.01, 0.01, 0.008, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.035), rubber(), 8);
    b.box(w, h - 0.008, d, 0, 0.008, 0, f, Math.min(0.04, d / 3));
    // two slots with chrome surrounds
    const trim = mat(C.chrome, { metalness: 0.85, roughness: 0.2 });
    for (const sz of [-1, 1]) {
      b.box(w * 0.66, 0.002, 0.036, 0, h - 0.001, sz * d * 0.18, trim);
      b.box(w * 0.6, 0.002, 0.024, 0, h, sz * d * 0.18, mat("#151618", { roughness: 0.9 }));
    }
    // the lever in its slot, the browning dial, buttons, the crumb tray
    b.box(0.012, h * 0.55, 0.004, w / 2 - 0.05, h * 0.25, d / 2 - 0.001, mat("#151618"));
    rbox(b, 0.03, 0.016, 0.03, w / 2 - 0.05, h * 0.62, d / 2 + 0.01, mat(C.black, { roughness: 0.4 }), 0.005);
    b.cyl(0.016, 0.017, 0.012, -w / 2 + 0.06, h * 0.45, d / 2, trim, 16).rotation.x = Math.PI / 2;
    b.box(0.003, 0.012, 0.002, -w / 2 + 0.06, h * 0.45 + 0.005, d / 2 + 0.013, mat(C.black));
    for (let i = 0; i < 2; i++) b.box(0.016, 0.008, 0.004, -w / 2 + 0.115 + i * 0.022, h * 0.45, d / 2 - 0.001, mat("#2a2c30"), 0.002);
    rbox(b, w * 0.5, 0.01, 0.01, 0, 0.012, d / 2 - 0.004, trim, 0.003);
  },
  kettle: (b, w, d, h, f) => {
    // body along the width: the handle at the left, the spout at the right
    const r = Math.min(w * 0.31, d * 0.4);
    const base = mat(C.black, { roughness: 0.5 });
    b.cyl(r * 1.04, r * 1.08, 0.022, 0, 0, 0, base, 24);
    b.cyl(r * 1.05, r * 1.05, 0.003, 0, 0.014, 0, mat("#55595e", { metalness: 0.5, roughness: 0.4 }), 24);
    const H = h - 0.03;
    const prof = [[0.001, 0], [r * 0.96, 0], [r, H * 0.05], [r * 1.02, H * 0.45], [r * 0.95, H * 0.78], [r * 0.8, H * 0.92], [r * 0.66, H * 0.96], [r * 0.62, H * 0.965], [r * 0.6, H * 0.985], [r * 0.4, H * 1.0], [0.001, H * 1.0]];
    b.add(lathe(prof.map(([x, y]) => new THREE.Vector2(x, y)), 28), f, 0, 0.022, 0);
    b.cyl(0.012, 0.016, 0.012, 0, 0.022 + H, 0, base, 12);
    // the handle: a loop from the shoulder to the lower back
    const y0 = 0.022;
    const curve = new THREE.CatmullRomCurve3([v(-r * 0.7, y0 + H * 0.84, 0), v(-r * 1.05, y0 + H * 0.95, 0), v(-r * 1.4, y0 + H * 0.88, 0), v(-r * 1.55, y0 + H * 0.6, 0), v(-r * 1.45, y0 + H * 0.32, 0), v(-r * 1.2, y0 + H * 0.17, 0), v(-r * 0.85, y0 + H * 0.12, 0)], false, "centripetal");
    b.add(tube(curve, 18, 0.011, 8), f);
    rbox(b, 0.012, 0.016, 0.012, -r * 1.36, y0 + H * 0.24, 0, base, 0.003)?.rotation.set(0, 0, -0.6);
    b.box(0.004, 0.004, 0.004, -r * 1.25, y0 + H * 0.16, 0.009, mat("#ff6a3d", { emissive: "#ff6a3d", emissiveIntensity: 0.6 }));
    // the spout: a tapering cone up and out
    const sa = v(r * 0.75, y0 + H * 0.55, 0);
    const sb = v(r * 1.42, y0 + H * 0.86, 0);
    const spout = b.add(new THREE.CylinderGeometry(0.009, 0.022, sa.distanceTo(sb), 12), f);
    spout.position.copy(sa).add(sb).multiplyScalar(0.5);
    spout.quaternion.setFromUnitVectors(v(0, 1, 0), sb.clone().sub(sa).normalize());
    // a water window
    b.box(0.012, H * 0.4, 0.004, 0, y0 + H * 0.17, r * 1.005, mat("#4f626c", { roughness: 0.15, metalness: 0.2 }), 0.0015);
  },
  kitchen_bin: (b, w, d, h, f) => {
    // a pedal bin: a base ring, the body, the lid with its seam and hinge, the pedal
    const r = Math.min(w, d) / 2;
    const dark = mat("#26272a", { roughness: 0.6 });
    b.cyl(r * 0.96, r * 0.96, 0.03, 0, 0, 0, dark, 28);
    b.cyl(r * 0.995, r * 0.97, h - 0.11, 0, 0.03, 0, f, 28);
    b.cyl(r, r, 0.03, 0, h - 0.078, 0, f, 28);
    b.cyl(r * 0.998, r * 0.998, 0.004, 0, h - 0.082, 0, dark, 28);
    b.add(new THREE.SphereGeometry(r, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2), f, 0, h - 0.048, 0).scale.y = 0.048 / r;
    rbox(b, 0.08, 0.025, 0.03, 0, h - 0.07, -r + 0.008, dark, 0.006);
    // the pedal on its bracket
    rbox(b, 0.07, 0.03, 0.03, 0, 0.012, r - 0.005, dark, 0.005);
    const pedal = rbox(b, 0.1, 0.012, 0.06, 0, 0, 0, mat(C.black, { roughness: 0.4 }), 0.005);
    pedal?.position.set(0, 0.03, r + 0.03);
    pedal?.rotation.set(0.12, 0, 0);
  },
  bar_cart: (b, w, d, h, f, _c, a) => {
    const wr = 0.075;
    // two trays with galleries round them
    for (const y of [0.15, h - 0.08]) {
      b.box(w - 0.02, 0.012, d - 0.02, 0, y, 0, f);
      const gy = y + 0.045;
      for (const sz of [-1, 1]) b.rod(v(-w / 2 + 0.01, gy, sz * (d / 2 - 0.01)), v(w / 2 - 0.01, gy, sz * (d / 2 - 0.01)), 0.005, a, 6);
      for (const sx of [-1, 1]) b.rod(v(sx * (w / 2 - 0.01), gy, -d / 2 + 0.01), v(sx * (w / 2 - 0.01), gy, d / 2 - 0.01), 0.005, a, 6);
      b.box(w - 0.02, 0.006, 0.006, 0, y - 0.006, 0, a);
    }
    // the posts, the handle at the left, two wheels at the right
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.01, 0.01, h - (sx > 0 ? wr : 0.02), sx * (w / 2 - 0.01), sx > 0 ? wr : 0.02, sz * (d / 2 - 0.01), a, 8);
    for (const sz of [-1, 1]) b.cyl(0.014, 0.016, 0.02, -(w / 2 - 0.01), 0, sz * (d / 2 - 0.01), mat(C.black), 8);
    for (const sz of [-1, 1]) b.rod(v(-w / 2 + 0.01, h - 0.02, sz * (d / 2 - 0.04)), v(-w / 2 - 0.03, h - 0.02, sz * (d / 2 - 0.04)), 0.006, a, 6);
    b.rod(v(-w / 2 - 0.03, h - 0.02, -d / 2 + 0.03), v(-w / 2 - 0.03, h - 0.02, d / 2 - 0.03), 0.01, a, 8);
    for (const sz of [-1, 1]) {
      const z = sz * (d / 2 + 0.006);
      b.add(new THREE.TorusGeometry(wr - 0.008, 0.009, 8, 24), mat(C.black, { roughness: 0.7 }), w / 2 - 0.01, wr, z);
      b.cyl(0.015, 0.015, 0.016, w / 2 - 0.01, wr, z, a, 10).rotation.x = Math.PI / 2;
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        b.rod(v(w / 2 - 0.01, wr, z), v(w / 2 - 0.01 + Math.cos(ang) * (wr - 0.012), wr + Math.sin(ang) * (wr - 0.012), z), 0.003, a, 4);
      }
    }
    // bottles on the top (may stand over the cart's height), glasses and a shaker below
    const colors = ["#2f6b45", "#8a3a32", "#c9a47c", "#e6e1d6"];
    const shapes = [
      [[0.001, 0], [0.036, 0], [0.037, 0.2], [0.03, 0.235], [0.013, 0.26], [0.013, 0.31], [0.001, 0.31]],
      [[0.001, 0], [0.034, 0], [0.034, 0.17], [0.02, 0.2], [0.012, 0.215], [0.012, 0.25], [0.001, 0.25]],
      [[0.001, 0], [0.042, 0], [0.042, 0.14], [0.036, 0.16], [0.012, 0.175], [0.012, 0.2], [0.001, 0.2]],
      [[0.001, 0], [0.03, 0], [0.032, 0.18], [0.024, 0.21], [0.011, 0.24], [0.011, 0.28], [0.001, 0.28]],
    ];
    const y1 = h - 0.068;
    b.above(() => {
      for (let i = 0; i < 4; i++) {
        const x = -w / 2 + 0.1 + i * Math.min(0.13, (w - 0.2) / 3);
        b.add(lathe(shapes[i].map(([px, py]) => new THREE.Vector2(px, py)), 12), mat(colors[i], { transparent: true, opacity: 0.85, roughness: 0.1 }), x, y1, -0.05);
        b.cyl(shapes[i][1][0] + 0.002, shapes[i][1][0] + 0.002, 0.06, x, y1 + 0.06, -0.05, mat(i % 2 ? "#efe9dc" : "#2b2b2b", { roughness: 0.6 }), 12);
      }
    });
    for (let i = 0; i < 2; i++) b.cyl(0.032, 0.028, 0.09, w * 0.2 + i * 0.08, y1, d * 0.2, glass(), 12);
    b.cyl(0.035, 0.035, 0.13, -w * 0.25, 0.162, 0.03, mat(C.chrome, { metalness: 0.85, roughness: 0.2 }), 14);
    b.cyl(0.02, 0.03, 0.04, -w * 0.25, 0.292, 0.03, mat(C.chrome, { metalness: 0.85, roughness: 0.2 }), 14);
    for (let i = 0; i < 4; i++) b.cyl(0.03, 0.03, 0.08, -0.02 + (i % 2) * 0.075, 0.162, (Math.floor(i / 2) - 0.5) * 0.09, glass(), 12);
  },
  wine_fridge: (b, w, d, h, f) => {
    const t = 0.03;
    const dd = d - 0.02;
    const z0 = -0.01;
    // the cabinet, a dark inside, a vent grille at the foot
    b.box(w, h, t, 0, 0, z0 - dd / 2 + t / 2, f);
    for (const sx of [-1, 1]) b.box(t, h, dd, sx * (w / 2 - t / 2), 0, z0, f);
    b.box(w, t + 0.05, dd, 0, 0, z0, f);
    b.box(w, t, dd, 0, h - t, z0, f);
    b.box(w - 2 * t, h - 2 * t - 0.05, 0.004, 0, t + 0.05, z0 - dd / 2 + t + 0.002, mat("#15171a", { roughness: 0.8 }));
    for (let i = 0; i < 4; i++) b.box(w * 0.7, 0.004, 0.004, 0, 0.02 + i * 0.012, d / 2 - 0.004, mat("#15171a"));
    // shelves with oak fronts, bottles lying with their necks to the door
    const rows = 6;
    const cols = Math.max(2, Math.floor((w - 2 * t - 0.02) / 0.08));
    const span = (h - 2 * t - 0.1) / rows;
    const oak = surface("oak", 0.7);
    const wine = [mat("#3a1f24", { roughness: 0.25 }), mat("#2f4a35", { roughness: 0.25 })];
    const foil = [mat("#8a2a2a", { metalness: 0.5, roughness: 0.4 }), mat("#c9a65a", { metalness: 0.6, roughness: 0.35 })];
    for (let r = 0; r < rows; r++) {
      const y = t + 0.06 + r * span;
      b.box(w - 2 * t, 0.006, dd - 0.06, 0, y, z0, mat("#6d7176", { metalness: 0.5, roughness: 0.5 }));
      b.box(w - 2 * t - 0.004, 0.022, 0.016, 0, y - 0.008, d / 2 - 0.07, oak);
      for (let i = 0; i < cols; i++) {
        const x = -w / 2 + t + 0.05 + (i * (w - 2 * t - 0.1)) / (cols - 1);
        const k = (i + r) % 3 ? 0 : 1;
        const by = y + 0.042;
        b.batch(new THREE.CylinderGeometry(0.036, 0.036, 0.14, 9).rotateX(Math.PI / 2), wine[k], new THREE.Matrix4().makeTranslation(x, by, d / 2 - 0.16));
        b.batch(new THREE.CylinderGeometry(0.013, 0.03, 0.05, 7, 1, true).rotateX(Math.PI / 2), wine[k], new THREE.Matrix4().makeTranslation(x, by, d / 2 - 0.065));
        b.batch(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 7).rotateX(Math.PI / 2), foil[k], new THREE.Matrix4().makeTranslation(x, by, d / 2 - 0.035));
      }
    }
    // the door: a frame round tinted glass, the display, the handle
    const fz = d / 2 - 0.012;
    const fw = 0.04;
    b.box(w, fw, 0.024, 0, 0, fz, f);
    b.box(w, fw * 1.6, 0.024, 0, h - fw * 1.6, fz, f);
    for (const sx of [-1, 1]) b.box(fw, h - fw * 2.6, 0.024, sx * (w / 2 - fw / 2), fw, fz, f);
    b.box(w - 2 * fw, h - fw * 2.6, 0.008, 0, fw, fz, mat("#1c2024", { transparent: true, opacity: 0.35, roughness: 0.05 }));
    b.box(0.07, 0.022, 0.003, 0, h - fw * 0.8 - 0.011, d / 2, display("#ff8a5c"));
    barHandle(b, w / 2 - fw / 2, h * 0.5, d / 2, h * 0.55, true, chrome(), 0.025, 0.007);
  },
  kitchen_trolley: (b, w, d, h, f, _c, a) => {
    const lh = 0.05;
    // the butcher-block top, its edges eased
    const tt = 0.035;
    const sec: P2[] = [[-d / 2, h - tt], [d / 2, h - tt], [d / 2, h - 0.004], [d / 2 - 0.004, h], [-d / 2 + 0.004, h], [-d / 2, h - 0.004]];
    b.add(loft([{ pts: sec, s: -w / 2 }, { pts: sec, s: w / 2 }], "x"), surface("oak", 0.7));
    // a drawer under it
    const dh = 0.1;
    b.box(w - 0.06, dh, d - 0.06, 0, h - tt - dh, 0, f);
    b.box(w - 0.07, dh - 0.008, 0.018, 0, h - tt - dh + 0.004, d / 2 - 0.03 + 0.009, f);
    barHandle(b, 0, h - tt - dh / 2, d / 2 - 0.03 + 0.018, Math.min(0.16, w * 0.3), false, a, 0.02, 0.005);
    // shelves with a lip, legs on castors
    for (const y of [0.12, h * 0.5]) {
      b.box(w - 0.04, 0.015, d - 0.04, 0, y, 0, f);
      for (const sz of [-1, 1]) b.box(w - 0.06, 0.03, 0.01, 0, y + 0.015, sz * (d / 2 - 0.025), f);
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.02);
        const z = sz * (d / 2 - 0.02);
        b.box(0.025, h - tt - lh, 0.025, x, lh, z, f);
        b.box(0.026, 0.01, 0.026, x, lh - 0.01, z, mat(C.black, { roughness: 0.4 }));
        b.box(0.008, 0.024, 0.024, x - 0.012, 0.016, z, mat(C.black, { roughness: 0.4 }));
        b.cyl(0.018, 0.018, 0.016, x, 0.018, z, rubber(), 12).rotation.x = Math.PI / 2;
      }
    // a towel rail at the side
    for (const sz of [-1, 1]) b.rod(v(w / 2, h - 0.08, sz * (d / 2 - 0.05)), v(w / 2 + 0.03, h - 0.08, sz * (d / 2 - 0.05)), 0.006, a, 6);
    b.rod(v(w / 2 + 0.03, h - 0.08, -d / 2 + 0.05), v(w / 2 + 0.03, h - 0.08, d / 2 - 0.05), 0.01, a, 6);
    // jars with lids on the middle shelf, bowls below
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + 0.1 + i * Math.min(0.13, (w - 0.2) / 3);
      b.cyl(0.04, 0.04, 0.1, x, h * 0.5 + 0.015, 0, glass(), 12);
      b.cyl(0.032, 0.032, 0.06, x, h * 0.5 + 0.017, 0, mat(["#d9c49a", "#f1ece0", "#8a5a3a", "#c9a24a"][i], { roughness: 0.9 }), 12);
      b.cyl(0.041, 0.041, 0.015, x, h * 0.5 + 0.115, 0, a, 12);
    }
    const ceramic = mat(C.ceramic, { roughness: 0.4 });
    for (let k = 0; k < 3; k++) b.add(lathe([[0.001, 0], [0.05, 0], [0.09, 0.04], [0.1, 0.07], [0.095, 0.07], [0.085, 0.042], [0.001, 0.008]].map(([x, y]) => new THREE.Vector2(x, y)), 18), ceramic, -w * 0.15, 0.135 + k * 0.02, 0);
  },
};
