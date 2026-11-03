// More detailed built-in pieces: bathroom. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { FINISHES } from "../../model/modern";
import { back, C, fronts, glass, mat, random, roundedRect, surface, tileMaterial, v, warmMat, wickerMat } from "../modern";
import type { Build, Builder } from "../modern";

// ----- lofted shapes: superellipse rings stacked into one smooth surface -----

/**
 * One cross-section of a loft, lying at height y: a superellipse around (0, z) with
 * half-width rx, reaching rz to the front and rzb (default rz) to the back; n is its
 * squareness (2 an ellipse, 6 a soft rectangle), nb that of the back half.
 */
interface Ring {
  y: number;
  rx: number;
  rz: number;
  z: number;
  rzb?: number;
  n?: number;
  nb?: number;
}

/** A ring by its back and front z and its width, optionally shrunk (s) about its middle. */
function ring(y: number, w: number, zb: number, zf: number, n = 2, nb = n, s = 1): Ring {
  return { y, rx: (w / 2) * s, rz: ((zf - zb) / 2) * s, z: (zb + zf) / 2, n, nb };
}

/** The point at angle t (0 = +x, π/2 = front) of a ring. */
function ringPoint(r: Ring, t: number): [number, number] {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const n = s >= 0 ? (r.n ?? 2) : (r.nb ?? r.n ?? 2);
  const e = 2 / n;
  const x = r.rx * Math.sign(c) * Math.pow(Math.abs(c), e);
  const z = (s >= 0 ? r.rz : (r.rzb ?? r.rz)) * Math.sign(s) * Math.pow(Math.abs(s), e);
  return [x, r.z + z];
}

/**
 * Rings joined into a smooth surface, like a lathe but with oval and squared sections:
 * up the outside, over a rim and down the inside makes a bowl. `closed` joins the last
 * ring back to the first (a seat's ring).
 */
function loft(rings: Ring[], seg = 40, closed = false): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const r of rings)
    for (let j = 0; j < seg; j++) {
      const [x, z] = ringPoint(r, (j / seg) * Math.PI * 2);
      pos.push(x, r.y, z);
    }
  const idx: number[] = [];
  const n = rings.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const a = i * seg + j;
      const b = i * seg + j2;
      const c = i2 * seg + j2;
      const d = i2 * seg + j;
      idx.push(a, d, c, a, c, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Smooth normals that keep their creases: each corner of a triangle averages the faces
 * meeting there that turn less than `angle` from its own (an extruded outline's flat sides).
 */
function creased(geo: THREE.BufferGeometry, angle = Math.PI / 5): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const faces: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, 3 * t);
    e1.fromBufferAttribute(pos, 3 * t + 1).sub(a);
    e2.fromBufferAttribute(pos, 3 * t + 2).sub(a);
    faces.push(e1.clone().cross(e2));
  }
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const cos = Math.cos(angle);
  const nor = new Float32Array(pos.count * 3);
  const sum = new THREE.Vector3();
  for (const ids of groups.values())
    for (const i of ids) {
      const own = faces[Math.floor(i / 3)].clone().normalize();
      sum.set(0, 0, 0);
      for (const j of ids) {
        const f = faces[Math.floor(j / 3)];
        if (f.lengthSq() > 1e-16 && own.dot(f.clone().normalize()) >= cos) sum.add(f);
      }
      if (sum.lengthSq() < 1e-16) sum.copy(own);
      sum.normalize();
      nor.set([sum.x, sum.y, sum.z], 3 * i);
    }
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** A pole: the ring shrunk to (almost) a point, closing a loft. */
const pole = (r: Ring, y = r.y): Ring => ({ ...r, y, rx: 1e-4, rz: 1e-4, rzb: 1e-4 });

// ----- materials -----

/** Glazed ceramic in the finish: glossier than the plain finish where it is a colour. */
function ceramic(f: THREE.MeshStandardMaterial, color: string): THREE.MeshStandardMaterial {
  if (color === "white" || color === "black" || color === "green") return mat(FINISHES[color], { roughness: 0.22 });
  return f;
}
/** The seat and lid: a satin plastic in the toilet's colour. */
const seatMat = (color: string) => mat(color === "black" ? "#242528" : "#f6f6f4", { roughness: 0.35 });
const drainMat = () => mat(C.steel, { metalness: 0.75, roughness: 0.25 });
const darkGap = () => mat("#1d1e20", { roughness: 1 });

// ----- taps -----

/** A single-lever basin mixer standing at (x, y, z) with its spout towards +z. */
function mixer(b: Builder, x: number, y: number, z: number, m: THREE.Material, h = 0.16, reach = 0.13) {
  b.above(() => mixerParts(b, x, y, z, m, h, reach));
}
function mixerParts(b: Builder, x: number, y: number, z: number, m: THREE.Material, h: number, reach: number) {
  b.cyl(0.026, 0.028, 0.008, x, y, z, m, 18);
  b.cyl(0.017, 0.019, h, x, y + 0.008, z, m, 18);
  b.sphere(0.017, x, y + h + 0.008, z, m, 1, 0.5, 1, 14);
  const top = y + h - 0.004;
  const curve = new THREE.CatmullRomCurve3([v(x, top, z), v(x, top + 0.008, z + reach * 0.35), v(x, top + 0.002, z + reach * 0.8), v(x, top - 0.02, z + reach)]);
  pipe(b, curve, 10, 0.0095, m);
  b.cyl(0.011, 0.011, 0.014, x, top - 0.032, z + reach, m, 10);
  // the lever, tilted back
  b.rod(v(x, y + h + 0.012, z - 0.004), v(x, y + h + 0.026, z - 0.055), 0.0055, m, 6);
  b.sphere(0.0075, x, y + h + 0.026, z - 0.055, m, 1, 1, 1, 8);
}

/**
 * A tall vessel mixer standing on a top at y: a slim column rising to height h, its spout
 * reaching forward over the bowl by `reach`, a small lever at the side.
 */
function tallMixer(b: Builder, x: number, y: number, z: number, m: THREE.Material, h = 0.3, reach = 0.15) {
  b.above(() => tallMixerParts(b, x, y, z, m, h, reach));
}
function tallMixerParts(b: Builder, x: number, y: number, z: number, m: THREE.Material, h: number, reach: number) {
  b.cyl(0.028, 0.03, 0.01, x, y, z, m, 18);
  b.cyl(0.016, 0.018, h - 0.03, x, y + 0.01, z, m, 16);
  const r = Math.max(0.06, reach);
  const top = y + h - 0.02;
  const curve = new THREE.CatmullRomCurve3([v(x, top - 0.02, z), v(x, top + 0.012, z + 0.03), v(x, top + 0.016, z + r * 0.55), v(x, top - 0.004, z + r)]);
  pipe(b, curve, 14, 0.011, m);
  b.cyl(0.012, 0.012, 0.02, x, top - 0.02, z + r, m, 10);
  b.rod(v(x + 0.016, y + h * 0.72, z), v(x + 0.06, y + h * 0.72 + 0.012, z), 0.006, m, 6);
}

/** A tube along a curve with rounded ends, so its open ends never show. */
function pipe(b: Builder, curve: THREE.Curve<THREE.Vector3>, seg: number, r: number, m: THREE.Material, radial = 8) {
  b.add(new THREE.TubeGeometry(curve, seg, r, radial), m);
  for (const t of [0, 1]) {
    const p = curve.getPoint(t);
    b.sphere(r, p.x, p.y, p.z, m, 1, 1, 1, radial);
  }
}

/** A round chrome drain set into a bowl's bottom. */
function drain(b: Builder, x: number, y: number, z: number, r = 0.02) {
  b.cyl(r, r, 0.004, x, y, z, drainMat(), 16);
}

/** A bottle trap below a basin, its pipe into the wall. */
function trap(b: Builder, y: number, z: number, zWall: number, m: THREE.Material, square = false) {
  if (square) b.box(0.05, 0.13, 0.05, 0, y - 0.13, z, m, 0.012);
  else {
    b.cyl(0.016, 0.016, 0.06, 0, y - 0.06, z, m, 12);
    b.add(new THREE.CapsuleGeometry(0.03, 0.06, 4, 14), m, 0, y - 0.11, z);
  }
  b.rod(v(0, y - 0.1, z), v(0, y - 0.1, zWall), 0.014, m, 10);
  b.cyl(0.03, 0.03, 0.01, 0, y - 0.1, zWall + 0.005, m, 14).rotation.x = Math.PI / 2;
}

// ----- toilets and bidets -----

interface BowlStyle {
  square?: boolean;
  floor?: boolean;
  /** A bidet: open, no seat, a tap on the deck. */
  open?: boolean;
}

/**
 * A ceramic bowl from the wall at zBack, its length L, its rim at y = 0.39: hung on the
 * wall (a body tucked up under it) or standing on a pedestal to the floor.
 */
function bowl(b: Builder, w: number, zBack: number, L: number, f: THREE.Material, s: BowlStyle) {
  const n = s.square ? 5 : 2.2;
  const nb = s.square ? 8 : 3.2;
  const rim = 0.39;
  const at = (y: number, wf: number, b0: number, f0: number) => ring(y, w * wf, zBack + L * b0, zBack + L * f0, n, nb);
  const outer: Ring[] = s.floor
    ? [at(0, 0.48, 0.07, 0.69), at(0, 0.5, 0.06, 0.7), at(0.006, 0.502, 0.06, 0.7), at(0.06, 0.52, 0.06, 0.7), at(0.16, 0.6, 0.04, 0.76), at(0.24, 0.78, 0.02, 0.87), at(0.31, 0.93, 0.01, 0.96), at(0.36, 0.995, 0, 0.995), at(rim - 0.01, 1, 0, 1)]
    : [at(0.2, 0.6, 0, 0.55), at(0.22, 0.74, 0, 0.72), at(0.26, 0.86, 0, 0.85), at(0.31, 0.95, 0, 0.95), at(0.36, 1, 0, 0.995), at(rim - 0.01, 1, 0, 1)];
  const open = s.open ? 0.3 : 0.08; // a bidet's deck at the back
  const inner: Ring[] = [
    at(rim, 0.97, 0.015, 0.985),
    at(rim - 0.004, 0.84, open, 0.94),
    at(rim - 0.05, 0.7, open + 0.04, 0.86),
    at(rim - 0.12, 0.45, open + 0.12, 0.74),
    at(rim - 0.16, 0.2, open + 0.2, 0.62),
  ];
  b.add(loft([pole(outer[0]), ...outer, ...inner, pole(inner[inner.length - 1])], 44), f);
  if (s.open) {
    const last = inner[inner.length - 1];
    drain(b, 0, last.y + 0.005, last.z, 0.018);
  }
  return { rim, zf: zBack + L, n, nb, open: zBack + L * open };
}

/** A closed seat and lid on a bowl's rim, two hinges at the back. */
function seatAndLid(b: Builder, w: number, zb: number, zf: number, n: number, nb: number, y: number, m: THREE.Material, hinge: THREE.Material) {
  const at = (yy: number, s: number) => ring(yy, w, zb, zf, n, nb, s);
  // the seat: a soft ring
  b.add(loft([at(y, 0.985), at(y, 1), at(y + 0.004, 1.002), at(y + 0.012, 1.005), at(y + 0.018, 0.97), at(y + 0.016, 0.72), at(y + 0.004, 0.7)], 44, true), m);
  // the lid, slightly smaller, a gentle dome
  const ly = y + 0.02;
  const lid = (yy: number, s: number) => ring(yy, w * 0.985, zb + 0.015, zf - 0.005, n, nb, s);
  b.add(loft([pole(lid(ly, 0.985)), lid(ly, 0.985), lid(ly, 1), lid(ly + 0.004, 1.002), lid(ly + 0.012, 0.995), lid(ly + 0.02, 0.93), lid(ly + 0.026, 0.6), pole(lid(ly + 0.028, 0.6))], 44), m);
  for (const sx of [-1, 1]) {
    b.cyl(0.014, 0.016, 0.022, sx * w * 0.24, y - 0.004, zb + 0.03, hinge, 12);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12).rotateZ(Math.PI / 2), hinge, sx * w * 0.24, y + 0.03, zb + 0.03);
  }
}

/** A close-coupled cistern against the wall: a soft box, its lid and a dual flush button. */
function cistern(b: Builder, w: number, zBack: number, depth: number, y0: number, h: number, f: THREE.Material, a: THREE.Material, square: boolean) {
  const cw = w * 0.9;
  b.box(cw, h - y0 - 0.03, depth, 0, y0, zBack + depth / 2, f, square ? 0.02 : 0.05);
  b.box(cw + 0.01, 0.03, depth + 0.012, 0, h - 0.03, zBack + depth / 2 + 0.002, f, square ? 0.008 : 0.014);
  b.cyl(0.03, 0.03, 0.006, 0, h, zBack + depth / 2, a, 20);
  b.box(0.003, 0.004, 0.05, 0, h + 0.004, zBack + depth / 2, darkGap());
}

function toilet(b: Builder, w: number, d: number, h: number, f: THREE.MeshStandardMaterial, color: string, a: THREE.Material, s: BowlStyle, zBack = back(d)) {
  const cer = ceramic(f, color);
  const cd = s.floor && !s.open ? 0.17 : 0;
  const bw = Math.min(w, 0.38);
  const depth = d / 2 - zBack;
  if (cd) cistern(b, w, zBack, cd, 0.4, Math.min(h, 0.84), cer, a, !!s.square);
  // the bowl starts at the wall (standing ones reach back under the cistern)
  const z0 = zBack;
  const bl = bowl(b, bw, z0, d / 2 - z0, cer, s);
  if (!s.open) seatAndLid(b, bw, zBack + cd + 0.02, bl.zf, bl.n, bl.nb, bl.rim, seatMat(color), a);
  else mixer(b, 0, bl.rim, (z0 + bl.open) / 2 + 0.01, a, 0.08, Math.min(0.09, depth * 0.2));
}

// ----- basins -----

interface BasinOpts {
  /** Thickness of the ceramic below its top at y. */
  depth: number;
  /** How deep the bowl sinks. */
  bowl: number;
  square?: boolean;
  /** The flat rim round the bowl, and the deck behind it for the tap. */
  rim?: number;
  deck?: number;
  /** A countertop: crisp outline, flat underside (else a soft wall basin). */
  top?: boolean;
}

/**
 * A ceramic basin of w × d whose top is at y, its back at zBack: a soft slab (or a crisp
 * top) with a bowl sunk into it towards the front, all one smooth surface.
 */
function basinGeo(w: number, d: number, y: number, zBack: number, o: BasinOpts): THREE.BufferGeometry {
  const zf = zBack + d;
  const rim = o.rim ?? 0.04;
  const deck = o.deck ?? 0.11;
  const no = o.top ? 20 : o.square ? 10 : 4;
  const nob = o.top ? 20 : 12;
  const ni = o.square ? 6 : 2.3;
  const out = (yy: number, s: number, ins = 0) => ring(yy, w - 2 * ins, zBack + ins, zf - ins, no, nob, s);
  const bw = w - 2 * rim;
  const inn = (yy: number, s: number) => ring(yy, bw, zBack + deck, zf - rim, ni, o.square ? ni : Math.max(ni, 3), s);
  const bottom = y - o.depth;
  // a top whose bowl sinks below it: the bowl's outside hangs under the slab
  const t = 0.012;
  const shell = (yy: number, sc: number) => ring(yy, bw + 2 * t, zBack + deck - t, zf - rim + t, ni, o.square ? ni : Math.max(ni, 3), sc);
  const hanging = o.top && o.bowl > o.depth - 0.01;
  const under: Ring[] = hanging
    ? [pole(shell(y - o.bowl - t, 0.3)), shell(y - o.bowl - t, 0.3), shell(y - o.bowl * 0.85 - t, 0.62), shell(y - o.bowl * 0.45 - t, 0.9), shell(bottom, 0.97), out(bottom, 1), out(bottom + 0.004, 1)]
    : o.top
    ? [pole(out(bottom, 1)), out(bottom, 1), out(bottom + 0.004, 1)]
    : [pole(out(bottom, 0.78)), out(bottom, 0.78), out(bottom + Math.min(0.025, o.depth * 0.2), 0.94), out(bottom + o.depth * 0.5, 1)];
  const rings = [
    ...under,
    out(y - 0.007, 1),
    out(y, 1, 0.005),
    inn(y, 1),
    inn(y - 0.008, 0.985),
    inn(y - o.bowl * 0.45, 0.9),
    inn(y - o.bowl * 0.85, 0.62),
    inn(y - o.bowl, 0.3),
  ];
  rings.push(pole(rings[rings.length - 1]));
  return loft(rings, 40);
}

/** Where the bowl of a basinGeo lies: its middle z. */
const bowlZ = (d: number, zBack: number, o: BasinOpts) => zBack + (o.deck ?? 0.11) + (d - (o.deck ?? 0.11) - (o.rim ?? 0.04)) / 2;

/** A wall-hung basin: the ceramic, the drain, a mixer on its deck and a trap below. */
function wallBasin(b: Builder, w: number, d: number, h: number, f: THREE.MeshStandardMaterial, color: string, a: THREE.Material, o: BasinOpts & { tapX?: number; trap?: boolean }) {
  const cer = ceramic(f, color);
  const opts = { ...o, deck: o.deck ?? Math.min(0.12, d * 0.28) };
  b.add(basinGeo(w, d, h, back(d), opts), cer);
  const bz = bowlZ(d, back(d), opts);
  drain(b, 0, h - o.bowl + 0.003, bz + (o.bowl > 0.1 ? 0 : 0), 0.018);
  mixer(b, o.tapX ?? 0, h, back(d) + opts.deck * 0.45, a, 0.14, Math.min(0.12, opts.deck * 0.45 + 0.07));
  if (o.trap !== false) trap(b, h - o.depth, Math.min(bz, back(d) + 0.15), back(d), a, o.square);
}

/** A vessel bowl standing on a top at y: a foot, thin walls flaring to its rim. */
function vesselGeo(w: number, d: number, y: number, z: number, h: number, square: boolean): THREE.BufferGeometry {
  const n = square ? 8 : 2.15;
  const r = (yy: number, s: number) => ring(yy, w, z - d / 2, z + d / 2, n, n, s);
  // a rounded lip, its thickness k (as a share of the half-width), over from outside to inside
  const k = (2 * 0.012) / w;
  const lip = [r(y + h - 0.006, 1), r(y + h - 0.0015, 1 - 0.15 * k), r(y + h, 1 - 0.5 * k), r(y + h - 0.0015, 1 - 0.85 * k), r(y + h - 0.006, 1 - k)];
  const rings = square
    ? [r(y, 0.96), r(y, 0.97), r(y + 0.01, 0.985), r(y + h - 0.02, 1), ...lip, r(y + 0.03, 0.94), r(y + 0.022, 0.9)]
    : [r(y, 0.5), r(y, 0.56), r(y + h * 0.12, 0.72), r(y + h * 0.45, 0.9), r(y + h * 0.85, 0.985), ...lip, r(y + h * 0.8, 0.94), r(y + h * 0.4, 0.8), r(y + 0.03, 0.45)];
  return loft([pole(rings[0]), ...rings, pole(rings[rings.length - 1])], 40);
}

/** A slim wall shelf (a top) of w × d at y, its thickness t. */
function wallTop(b: Builder, w: number, d: number, y: number, t: number, m: THREE.Material) {
  b.box(w, t, d, 0, y - t, 0, m, 0.004);
}

/** A small soap pump. */
function soap(b: Builder, x: number, y: number, z: number, m: THREE.Material) {
  b.cyl(0.03, 0.032, 0.11, x, y, z, mat("#e9e6df", { roughness: 0.4 }), 14);
  b.cyl(0.008, 0.008, 0.03, x, y + 0.11, z, m, 8);
  b.box(0.012, 0.01, 0.04, x, y + 0.13, z + 0.012, m, 0.003);
}

/** A wall-hung vanity: drawers in the finish, a ceramic top with one bowl per unit. */
function vanityUnit(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, n: number, square: boolean) {
  const top = 0.05;
  const ch = Math.min(0.48, h - top - 0.05);
  const y0 = h - top - ch;
  const cd = d - 0.025;
  // a hollow carcass (sides, back, bottom) so the bowl hangs into it, the fronts close it
  const bd = cd - 0.02;
  const t = 0.016;
  for (const sx of [-1, 1]) b.box(t, ch, bd, sx * (w / 2 - 0.002 - t / 2), y0, back(d) + bd / 2, f);
  b.box(w - 0.004, t, bd, 0, y0, back(d) + bd / 2, f);
  b.box(w - 0.004, ch, t, 0, y0, back(d) + t / 2, f);
  fronts(b, -w / 2 + 0.002, w - 0.004, y0, ch, back(d) + cd - 0.02, n, f, 2, "bar", a);
  const cer = mat(C.ceramic, { roughness: 0.22 });
  const uw = w / n;
  const o: BasinOpts = { depth: top, bowl: 0.12, square, top: true, rim: Math.min(0.07, uw * 0.1), deck: 0.13 };
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + uw * (i + 0.5);
    b.add(basinGeo(uw + 0.002, d, h, back(d), o), cer, x, 0, 0);
    drain(b, x, h - 0.12 + 0.003, bowlZ(d, back(d), o), 0.018);
    mixer(b, x, h, back(d) + 0.06, a, 0.16, 0.12);
  }
}

/** A towel folded over: a soft slab doubled over a rail at (y, z), hanging dh down. */
function foldedTowel(b: Builder, w: number, y: number, z: number, dh: number, m: THREE.Material, band?: THREE.Material, x = 0) {
  const t = 0.012;
  b.box(w, dh, t, x, y - dh, z - 0.018, m, 0.005);
  b.box(w, dh * 0.82, t, x, y - dh * 0.82, z + 0.018, m, 0.005);
  // the fold over the rail: a half tube, its open side down inside the towel
  b.add(new THREE.CylinderGeometry(0.024, 0.024, w, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), m, x, y, z);
  // a woven band across the front near its hem
  if (band) b.box(w + 0.002, 0.03, t + 0.002, x, y - dh * 0.82 + 0.05, z + 0.018, band, 0.004);
}

// ----- bath taps -----

/** Glossy white acrylic, the inside of a tub or a shower tray. */
const enamel = () => mat(C.ceramic, { roughness: 0.18 });

/**
 * A deck-mounted bath spout at (x, y, z) pointing along angle a (0 = +x, π/2 = +z): a
 * curved spout and a handle either side.
 */
function bathSpout(b: Builder, x: number, y: number, z: number, a: number, m: THREE.Material) {
  b.above(() => {
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    b.cyl(0.03, 0.032, 0.01, x, y, z, m, 18);
    const at = (up: number, fw: number) => v(x + ux * fw, y + up, z + uz * fw);
    const curve = new THREE.CatmullRomCurve3([at(0.005, 0), at(0.07, 0.01), at(0.1, 0.07), at(0.075, 0.15)]);
    pipe(b, curve, 14, 0.016, m, 10);
    b.cyl(0.017, 0.017, 0.02, x + ux * 0.15, y + 0.055, z + uz * 0.15, m, 12);
    for (const s of [-1, 1]) {
      const hx = x - uz * s * 0.1;
      const hz = z + ux * s * 0.1;
      b.cyl(0.022, 0.024, 0.01, hx, y, hz, m, 14);
      b.cyl(0.013, 0.015, 0.05, hx, y + 0.01, hz, m, 12);
      b.sphere(0.02, hx, y + 0.065, hz, m, 1, 0.55, 1, 12);
    }
  });
}

/**
 * A floor-standing bath mixer at (x, z): a column up to `top`, its spout reaching `reach`
 * along angle a over the tub's rim, the lever and a hand shower in its holder.
 */
function floorMixer(b: Builder, x: number, z: number, top: number, a: number, reach: number, m: THREE.Material) {
  b.above(() => {
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    b.cyl(0.05, 0.055, 0.012, x, 0, z, m, 20);
    b.cyl(0.02, 0.022, top - 0.03, x, 0.012, z, m, 14);
    const at = (up: number, fw: number) => v(x + ux * fw, up, z + uz * fw);
    const curve = new THREE.CatmullRomCurve3([at(top - 0.04, 0), at(top + 0.01, 0.02), at(top + 0.02, reach * 0.55), at(top - 0.02, reach)]);
    pipe(b, curve, 16, 0.014, m, 10);
    b.cyl(0.015, 0.015, 0.025, x + ux * reach, top - 0.045, z + uz * reach, m, 12);
    // the lever, sideways at hand height
    b.rod(at(top - 0.12, 0), v(x - uz * 0.06, top - 0.11, z + ux * 0.06), 0.006, m, 6);
    // the hand shower on the column's back
    const hx = x - ux * 0.035;
    const hz = z - uz * 0.035;
    b.cyl(0.016, 0.012, 0.2, hx, top - 0.38, hz, m, 12);
    b.cyl(0.03, 0.022, 0.035, hx, top - 0.18, hz, m, 16);
  });
}

// ----- bathtubs -----

/** A loft ring by its half-widths, centred on z (zc), optionally reaching less far back. */
const R = (y: number, rx: number, rz: number, n: number, zc = 0, rzb = rz): Ring => ({ y, rx, rz, z: zc, rzb, n, nb: n });

interface TubOpts {
  /** Squareness of the outside and of the basin. */
  n: number;
  ni: number;
  /** The rim's width, and how much wider it is at the back (a deck for the taps). */
  t: number;
  deck?: number;
  /** The outside's shape from the foot up: [height share, scale]. */
  out: [number, number][];
  /** The basin's from its rim down: [height share, scale]. */
  inn: [number, number][];
  /** How high the basin's floor is. */
  floor: number;
}

/**
 * A freestanding tub of w × d × h centred at x: the shell in the finish up to the crown of
 * its rounded rim, the basin glossy white from there down to its floor, the drain in it.
 */
function freeTub(b: Builder, w: number, d: number, h: number, x: number, shell: THREE.Material, o: TubOpts) {
  const W = w / 2;
  const D = d / 2;
  const t = o.t;
  const e = o.deck ?? 0;
  const outer = o.out.map(([fy, s]) => R(fy * h, W * s, D * s, o.n));
  // the foot: a narrow flat ring under it and a short upright edge keep the sides' normals level
  const s0 = o.out[0][1];
  outer.unshift(R(0, W * s0 - 0.012, D * s0 - 0.012, o.n));
  outer.splice(2, 0, R(0.006, W * s0 + 0.0005, D * s0 + 0.0005, o.n));
  const lip = (y: number, k: number) => R(y, W - k * t, D - k * t, o.n);
  outer.push(lip(h - 0.014, 0), lip(h - 0.004, 0.12), lip(h, 0.5));
  const crown = outer[outer.length - 1];
  const bw = W - t;
  const bd = D - t - e / 2;
  const basin = (y: number, s: number) => R(y, bw * s, bd * s, o.ni, e / 2);
  // over the crown, a flat strip to the basin's edge, then down in the basin's squareness
  const inner = [crown, lip(h - 0.002, 0.8), basin(h - 0.004, 1), basin(h - 0.014, 0.995)];
  inner.push(...o.inn.map(([fy, s]) => basin(o.floor + fy * (h - 0.016 - o.floor), s)), basin(o.floor, o.inn[o.inn.length - 1][1] * 0.9));
  b.add(loft([pole(outer[0]), ...outer], 64), shell, x, 0, 0);
  b.add(loft([...inner, pole(inner[inner.length - 1])], 64), enamel(), x, 0, 0);
  drain(b, x - bw * 0.55 * o.inn[o.inn.length - 1][1], o.floor + 0.002, e / 2, 0.026);
}

/** The finish of a tub's shell: glossy where it is a colour, as it is where it is concrete. */
const shellMat = (f: THREE.MeshStandardMaterial, color: string) => (color === "concrete" ? f : ceramic(f, color));

// ----- showers -----

/** The profiles of a shower's glass: the finish, metallic where it is chrome. */
function profileMat(f: THREE.MeshStandardMaterial, color: string): THREE.MeshStandardMaterial {
  if (color === "chrome") return mat(FINISHES.chrome, { metalness: 0.8, roughness: 0.25 });
  if (color === "black") return mat("#1f2023", { metalness: 0.3, roughness: 0.45 });
  return f;
}

/**
 * A glass pane standing from (x0, z0) to (x1, z1) between y0 and y1, with the profiles
 * asked for: a U-channel at the bottom, a rail at the top, uprights at either end.
 */
function pane(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, prof: THREE.Material, e: { top?: boolean; bottom?: boolean; start?: boolean; end?: boolean } = {}) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ux = (x1 - x0) / len;
  const uz = (z1 - z0) / len;
  const ang = -Math.atan2(uz, ux);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const turn = (m: THREE.Mesh | null) => m && (m.rotation.y = ang);
  const p = 0.02;
  turn(b.box(len - 0.004, y1 - y0, 0.008, cx, y0, cz, glass()));
  if (e.bottom) turn(b.box(len, p, 0.024, cx, y0, cz, prof));
  if (e.top) turn(b.box(len, p, 0.024, cx, y1 - p, cz, prof));
  if (e.start) turn(b.box(p, y1 - y0, 0.026, x0 + (ux * p) / 2, y0, z0 + (uz * p) / 2, prof));
  if (e.end) turn(b.box(p, y1 - y0, 0.026, x1 - (ux * p) / 2, y0, z1 - (uz * p) / 2, prof));
}

/** An upright pull handle on both faces of a door at (x, z), facing along the normal (nx, nz). */
function doorHandle(b: Builder, x: number, y: number, z: number, nx: number, nz: number, m: THREE.Material) {
  for (const s of [-1, 1]) {
    const hx = x + nx * s * 0.035;
    const hz = z + nz * s * 0.035;
    b.cyl(0.009, 0.009, 0.32, hx, y, hz, m, 10);
    for (const yy of [y + 0.03, y + 0.29]) b.rod(v(x + nx * s * 0.004, yy, z + nz * s * 0.004), v(hx, yy, hz), 0.006, m, 6);
  }
}

/** A low ceramic tray of w × d with a softly dished floor and a round drain at (dx, dz). */
function tray(b: Builder, w: number, d: number, dx = 0, dz = 0) {
  const th = 0.035;
  b.box(w, th, d, 0, 0, 0, enamel(), 0.01);
  b.box(w - 0.07, 0.002, d - 0.07, 0, th, 0, mat("#e9e9e6", { roughness: 0.3 }), 0);
  b.cyl(0.05, 0.05, 0.004, dx, th, dz, drainMat(), 24);
  b.cyl(0.035, 0.035, 0.002, dx, th + 0.004, dz, darkGap(), 20);
}

/**
 * The shower fittings on the back wall at x: a thermostat bar, the riser up to an arm with
 * a rain head, optionally a hand shower on its hose hanging on the riser.
 */
function showerSet(b: Builder, x: number, h: number, zWall: number, m: THREE.Material, hand: boolean, square = false) {
  const zr = zWall + 0.045;
  const top = Math.min(h - 0.1, 2.05);
  // thermostat bar and its two knobs
  b.add(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 18).rotateZ(Math.PI / 2), m, x, 1.0, zr);
  for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 18).rotateZ(Math.PI / 2), m, x + s * 0.17, 1.0, zr);
  for (const s of [-1, 1]) b.rod(v(x + s * 0.11, 1.0, zWall), v(x + s * 0.11, 1.0, zr), 0.012, m, 8);
  // the riser and the arm out to the head
  b.cyl(0.013, 0.013, top - 1.02, x, 1.02, zr, m, 10);
  b.rod(v(x, top, zr), v(x, top, zr + 0.28), 0.011, m, 8);
  b.rod(v(x, top, zWall), v(x, top, zr), 0.012, m, 8);
  const hz = zr + 0.28;
  if (square) {
    b.box(0.26, 0.012, 0.26, x, top - 0.026, hz, m, 0.004);
    b.box(0.23, 0.002, 0.23, x, top - 0.028, hz, mat("#5a5d61", { roughness: 0.6 }));
  } else {
    b.cyl(0.13, 0.13, 0.012, x, top - 0.026, hz, m, 32);
    b.cyl(0.115, 0.115, 0.002, x, top - 0.028, hz, mat("#5a5d61", { roughness: 0.6 }), 32);
  }
  b.cyl(0.02, 0.02, 0.016, x, top - 0.014, hz, m, 10);
  if (!hand) return;
  // the hand shower in a holder on the riser, its hose looping down to the bar
  const y = 1.42;
  b.box(0.04, 0.03, 0.03, x, y - 0.015, zr + 0.02, m, 0.006);
  const hx = x + 0.035;
  b.cyl(0.013, 0.018, 0.17, hx, y - 0.13, zr + 0.035, m, 12);
  b.cyl(0.036, 0.024, 0.04, hx, y + 0.04, zr + 0.035, m, 16);
  // the hose: down from the handle, a round loop at the bottom, up to the bar
  const lx = (hx + x + 0.1) / 2;
  const lr = (x + 0.1 - hx) / 2;
  const pts = [v(hx, y - 0.13, zr + 0.035), v(hx, 1.0, zr + 0.05)];
  for (let i = 0; i <= 8; i++) {
    const t = Math.PI * (1 - i / 8);
    pts.push(v(lx + Math.cos(t) * lr, 0.72 - Math.sin(t) * lr * 1.4, zr + 0.055 - i * 0.002));
  }
  pts.push(v(x + 0.1, 0.86, zr + 0.025), v(x + 0.1, 0.972, zr + 0.01));
  pipe(b, new THREE.CatmullRomCurve3(pts, false, "centripetal"), 48, 0.007, mat("#9ea3a8", { metalness: 0.6, roughness: 0.35 }), 6);
}

/** A slatted teak bench of w × d with its back at x0. */
function bench(b: Builder, x: number, w: number, d: number, h: number) {
  const wood = surface("oak", 0.7);
  for (const sz of [-1, 1]) b.box(w - 0.04, h - 0.03, 0.03, x, 0, sz * (d / 2 - 0.05), wood);
  const n = 5;
  for (let i = 0; i < n; i++) b.box((w - 0.01 * (n - 1)) / n, 0.028, d, x - w / 2 + (w / n) * (i + 0.5), h - 0.028, 0, wood);
}

/** A linear drain along a wall: its steel frame and slotted cover. */
function linearDrain(b: Builder, len: number, y: number, z: number) {
  b.box(len, 0.004, 0.07, 0, y, z, drainMat());
  const slot = darkGap();
  for (let i = -2; i <= 2; i++) b.box(len - 0.04, 0.001, 0.004, 0, y + 0.004, z + i * 0.011, slot);
}

/** A walk-in shower: a flush tiled floor, a linear drain, one glass pane braced to the wall. */
function walkIn(b: Builder, w: number, d: number, h: number, prof: THREE.Material, a: THREE.Material, large: boolean) {
  b.box(w, 0.02, d, 0, 0, 0, tileMaterial(), 0);
  linearDrain(b, w - 0.24, 0.02, back(d) + 0.08);
  const gw = w * (large ? 0.5 : 0.62);
  const gx = -w / 2;
  pane(b, gx, d / 2 - 0.03, gx + gw, d / 2 - 0.03, 0.02, h - 0.02, prof, { bottom: true, start: true });
  // the stabiliser bar from the pane's top corner back to the wall
  const sy = h - 0.12;
  b.box(0.03, 0.03, 0.03, gx + gw - 0.04, sy - 0.015, d / 2 - 0.03, prof, 0.006);
  b.rod(v(gx + gw - 0.04, sy, d / 2 - 0.03), v(gx + gw - 0.04, sy, back(d)), 0.009, prof, 8);
  b.box(0.04, 0.04, 0.01, gx + gw - 0.04, sy - 0.02, back(d) + 0.005, prof, 0.004);
  showerSet(b, large ? -w / 4 : -w / 6, h, back(d), a, true);
  if (large) {
    showerSet(b, w / 6, h, back(d), a, false, true);
    bench(b, w / 2 - 0.22, 0.4, d - 0.2, 0.45);
  }
}

// ----- radiators, ladders and the rest -----

const towelMats = () => [mat("#f2efe8", { roughness: 1 }), mat("#9fb3c8", { roughness: 1 }), mat("#c9b9a0", { roughness: 1 })];

/** A rolled towel lying along z at (x, y), its radius r. */
function rolledTowel(b: Builder, x: number, y: number, z: number, r: number, len: number, m: THREE.Material) {
  b.add(new THREE.CylinderGeometry(r, r, len, 16).rotateX(Math.PI / 2), m, x, y + r, z);
  b.add(new THREE.TorusGeometry(r * 0.55, r * 0.12, 6, 16), mat("#d9d4ca", { roughness: 1 }), x, y + r, z + len / 2);
}

/** A bottle standing at (x, y, z): a soft body, a shoulder and a pump or cap. */
function bottle(b: Builder, x: number, y: number, z: number, r: number, h: number, m: THREE.Material, top: THREE.Material, pump: boolean) {
  b.cyl(r, r, h - r * 0.6, x, y, z, m, 14);
  b.sphere(r, x, y + h - r * 0.6, z, m, 1, 0.6, 1, 14);
  if (pump) {
    b.cyl(0.007, 0.007, 0.035, x, y + h - 0.01, z, top, 8);
    b.box(0.012, 0.01, 0.035, x, y + h + 0.025, z + 0.01, top, 0.003);
  } else b.cyl(r * 0.45, r * 0.5, 0.025, x, y + h - 0.004, z, top, 12);
}

/** A rounded-rectangle slab of w × h × t lying in the wall plane at z, from its bottom y. */
function plate(b: Builder, w: number, h: number, t: number, y: number, z: number, r: number, m: THREE.Material) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth: t, bevelEnabled: false, curveSegments: 6 });
  return b.add(geo, m, 0, y + h / 2, z);
}

const mirrorMat = () => mat(C.mirror, { metalness: 0.9, roughness: 0.05 });
const lightMat = () => mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.8 });

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  toilet_wall: (b, w, d, h, f, c, a) => toilet(b, w, d, h, f, c, a, {}),
  toilet_wall_square: (b, w, d, h, f, c, a) => toilet(b, w, d, h, f, c, a, { square: true }),
  toilet_floor: (b, w, d, h, f, c, a) => toilet(b, w, d, h, f, c, a, { floor: true }),
  toilet_floor_square: (b, w, d, h, f, c, a) => toilet(b, w, d, h, f, c, a, { floor: true, square: true }),
  bidet: (b, w, d, h, f, c, a) => toilet(b, w, d, h, f, c, a, { open: true }),
  bidet_square: (b, w, d, h, f, c, a) => toilet(b, w, d, h, f, c, a, { open: true, square: true }),
  bidet_floor: (b, w, d, h, f, c, a) => toilet(b, w, d, h, f, c, a, { open: true, floor: true }),
  sink_wall: (b, w, d, h, f, c, a) => wallBasin(b, w, d, h, f, c, a, { depth: 0.15, bowl: 0.12 }),
  sink_wall_square: (b, w, d, h, f, c, a) => wallBasin(b, w, d, h, f, c, a, { depth: 0.12, bowl: 0.1, square: true }),
  sink_wall_small: (b, w, d, h, f, c, a) => wallBasin(b, w, d, h, f, c, a, { depth: 0.13, bowl: 0.1, tapX: -w * 0.27, deck: 0.06, rim: 0.03 }),
  sink_pedestal: (b, w, d, h, f, c, a) => {
    // standing: a rounded basin on a column that swells out to the floor
    wallBasin(b, w, d, h, f, c, a, { depth: 0.16, bowl: 0.12, trap: false });
    const ph = h - 0.15;
    const pr = (y: number, s: number) => ring(y, 0.2 * s, back(d) - 0.001, back(d) + 0.16 * s, 2.4, 12);
    const col = [pr(0, 1.15), pr(0.01, 1.15), pr(0.05, 1.0), pr(ph * 0.4, 0.82), pr(ph * 0.85, 0.85), pr(ph, 1.05)];
    b.add(loft([pole(col[0]), ...col, pole(col[col.length - 1])], 32), ceramic(f, c));
  },
  vanity: (b, w, d, h, f, _c, a) => vanityUnit(b, w, d, h, f, a, Math.max(1, Math.round(w / 0.75)), false),
  vanity_square: (b, w, d, h, f, _c, a) => vanityUnit(b, w, d, h, f, a, Math.max(1, Math.round(w / 0.75)), true),
  vanity_double: (b, w, d, h, f, _c, a) => vanityUnit(b, w, d, h, f, a, Math.max(2, Math.round(w / 0.7)), false),
  sink_large: (b, w, d, h, f, c, a) => {
    // one or two oval bowls on a slim oak top on the wall, a tall mixer behind each
    const vh = 0.14;
    const top = h - vh;
    wallTop(b, w, d, top, 0.04, surface("oak", 0.7));
    const n = w > 0.9 ? 2 : 1;
    const cer = ceramic(f, c);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const bw = Math.min(0.5, w / n - 0.08);
      const bd = Math.min(0.38, d - 0.12);
      const bz = d / 2 - 0.02 - bd / 2;
      b.add(vesselGeo(bw, bd, top, bz, vh, false), cer, x, 0, 0);
      drain(b, x, top + 0.031, bz, 0.018);
      tallMixer(b, x, top, back(d) + 0.04, a, 0.3, bz - back(d) - 0.04);
    }
    soap(b, w / 2 - 0.06, top, back(d) + 0.05, a);
  },
  sink_counter_square: (b, w, d, h, f, c, a) => {
    // a rectangular bowl on a slim oak top, the tall mixer beside it
    const vh = 0.13;
    const top = h - vh;
    wallTop(b, w, d, top, 0.04, surface("oak", 0.7));
    const bw = Math.min(0.55, w - 0.1);
    const bd = Math.min(0.38, d - 0.06);
    const bz = d / 2 - 0.02 - bd / 2;
    b.add(vesselGeo(bw, bd, top, bz, vh, true), ceramic(f, c));
    drain(b, 0, top + 0.023, bz, 0.018);
    const tx = bw / 2 + 0.08 > w / 2 ? 0 : bw / 2 + 0.06;
    tallMixer(b, tx, top, back(d) + 0.05, a, 0.28, tx ? 0.12 : bz - back(d) - 0.05);
  },
  vanity_floor: (b, w, d, h, f, _c, a) => {
    // a standing washstand: a metal frame, a top and a shelf in the finish, towels, a bowl
    const vh = 0.14;
    const top = h - vh;
    const t = 0.03;
    const r = 0.012;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b.box(r * 2, top - t, r * 2, sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02), a);
    for (const sx of [-1, 1]) b.box(r * 2, r * 2, d - 0.04, sx * (w / 2 - 0.02), 0.16, 0, a);
    b.box(w - 0.04, 0.02, d - 0.06, 0, 0.18, 0, f, 0.004);
    b.box(w, t, d, 0, top - t, 0, f, 0.006);
    const towels = [C.linen, "#cfd8dc", "#f4f2ed"];
    for (let i = 0; i < 3; i++) b.box(0.3, 0.055, d * 0.62, -w / 4, 0.2 + i * 0.057, 0.01, mat(towels[i], { roughness: 1 }), 0.022);
    b.box(0.2, 0.1, 0.12, w / 4, 0.2, 0, wickerMat("sand"), 0.02);
    const bw = Math.min(0.46, w * 0.55);
    const bd = Math.min(0.38, d * 0.78);
    const bz = d / 2 - 0.03 - bd / 2;
    b.add(vesselGeo(bw, bd, top, bz, vh, false), mat(C.ceramic, { roughness: 0.22 }));
    drain(b, 0, top + 0.031, bz, 0.018);
    tallMixer(b, 0, top, back(d) + 0.04, a, 0.3, bz - back(d) - 0.04);
  },
  toilet_prewall: (b, w, d, h, f, c, a) => {
    // a pre-wall box across the niche with a ledge, the flush plate, the bowl hung in front
    const pd = 0.2;
    const wall = mat("#e9e7e2", { roughness: 0.7 });
    b.box(w, h - 0.02, pd, 0, 0, back(d) + pd / 2, wall, 0.004);
    b.box(w + 0.01, 0.025, pd + 0.02, 0, h - 0.025, back(d) + pd / 2 + 0.005, mat("#f3f1ec", { roughness: 0.5 }), 0.004);
    const fy = Math.min(h - 0.08, 1.0);
    const z = back(d) + pd;
    b.box(0.25, 0.165, 0.008, 0, fy - 0.1, z + 0.004, a, 0.004);
    b.box(0.13, 0.15, 0.006, -0.058, fy - 0.093, z + 0.008, a, 0.004);
    b.box(0.09, 0.15, 0.006, 0.07, fy - 0.093, z + 0.008, a, 0.004);
    b.box(0.003, 0.15, 0.004, 0.0115, fy - 0.093, z + 0.011, darkGap());
    toilet(b, Math.min(0.37, w), d, h, f, c, a, {}, z);
  },
  // ----- bathtubs -----
  bathtub: (b, w, d, h, f, c, a) => {
    // freestanding, a soft block: near-upright sides, a broad rim, a deck at the back for the spout
    freeTub(b, w, d, h, 0, shellMat(f, c), {
      n: 4.5,
      ni: 3.2,
      t: 0.06,
      deck: 0.07,
      out: [[0, 0.965], [0.01, 0.975], [0.06, 0.99], [0.5, 1]],
      inn: [[0.9, 0.99], [0.55, 0.95], [0.2, 0.86], [0.04, 0.76]],
      floor: 0.08,
    });
    bathSpout(b, w * 0.12, h, back(d) + 0.065, Math.PI / 2, a);
  },
  bathtub_oval: (b, w, d, h, f, c, a) => {
    // an oval tub flaring out from a small foot, the mixer standing on the floor at its end
    const tw = w - 0.18;
    freeTub(b, tw, d, h, -0.09, shellMat(f, c), {
      n: 2.3,
      ni: 2.3,
      t: 0.035,
      out: [[0, 0.74], [0.012, 0.76], [0.2, 0.84], [0.55, 0.94], [0.85, 0.99]],
      inn: [[0.85, 0.985], [0.5, 0.92], [0.2, 0.8], [0.05, 0.68]],
      floor: 0.1,
    });
    floorMixer(b, w / 2 - 0.06, 0, h + 0.22, Math.PI, 0.22, a);
  },
  bathtub_round: (b, w, d, h, f, c, a) => {
    // a round tub, its floor mixer in the back corner leaning over the rim
    freeTub(b, w, d, h, 0, shellMat(f, c), {
      n: 2,
      ni: 2,
      t: 0.035,
      out: [[0, 0.78], [0.012, 0.8], [0.2, 0.87], [0.55, 0.95], [0.85, 0.99]],
      inn: [[0.85, 0.985], [0.5, 0.92], [0.2, 0.8], [0.05, 0.66]],
      floor: 0.1,
    });
    const r = Math.min(w, d) / 2;
    floorMixer(b, w / 2 - r * 0.15, -d / 2 + r * 0.15, h + 0.22, (3 * Math.PI) / 4, r * 0.36, a);
  },
  bathtub_square: (b, w, d, h, f, c, a) => {
    // crisp and rectangular, a softly squared basin, the spout on a deck at the back
    freeTub(b, w, d, h, 0, shellMat(f, c), {
      n: 14,
      ni: 5,
      t: 0.05,
      deck: 0.07,
      out: [[0, 0.995], [0.5, 1]],
      inn: [[0.9, 0.995], [0.5, 0.97], [0.15, 0.9], [0.03, 0.82]],
      floor: 0.08,
    });
    bathSpout(b, 0, h, back(d) + 0.06, Math.PI / 2, a);
  },
  bathtub_built_in: (b, w, d, h, f, c, a) => {
    // a tiled apron, the tub dropped into its deck: one surface from the deck's edge down into the basin
    // the apron: four tiled walls round the tub's body
    const tile = tileMaterial();
    const at = h - 0.03;
    for (const sz of [-1, 1]) b.box(w, at, 0.03, 0, 0, sz * (d / 2 - 0.015), tile);
    for (const sx of [-1, 1]) b.box(0.03, at, d - 0.06, sx * (w / 2 - 0.015), 0, 0, tile);
    const cer = ceramic(f, c);
    const W = w / 2;
    const D = d / 2;
    const deck = 0.07;
    const bw = W - 0.09;
    const bd = D - 0.08 - deck / 2;
    const top = (y: number, k: number) => R(y, W - k, D - k, 24);
    const basin = (y: number, s: number) => R(y, bw * s, bd * s, 4, deck / 2);
    const rings = [top(h - 0.03, 0), top(h - 0.006, 0), top(h, 0.006), top(h, 0.04), basin(h + 0.004, 1.03), basin(h + 0.006, 1.01), basin(h, 0.99), basin(h - 0.1, 0.97), basin(h * 0.45, 0.9), basin(0.14, 0.78), basin(0.12, 0.7)];
    b.add(loft([...rings, pole(rings[rings.length - 1])], 64), cer);
    drain(b, -bw * 0.6, 0.122, deck / 2, 0.026);
    bathSpout(b, 0, h, back(d) + 0.055, Math.PI / 2, a);
    // a pull-out hand shower on the deck beside the taps
    b.above(() => {
      b.cyl(0.026, 0.028, 0.012, w * 0.22, h, back(d) + 0.055, a, 16);
      b.cyl(0.018, 0.024, 0.12, w * 0.22, h + 0.012, back(d) + 0.055, a, 14);
      b.cyl(0.032, 0.026, 0.03, w * 0.22, h + 0.13, back(d) + 0.055, a, 16);
    });
  },
  bathtub_corner: (b, w, d, h, f, c, a) => {
    // a quarter-round front against two walls, the oval basin turned across the corner
    const bs = 0.015;
    const W = w / 2 - bs;
    const D = d / 2 - bs;
    const s = new THREE.Shape();
    s.moveTo(-W, -D);
    s.lineTo(W, -D);
    s.lineTo(W, -D + d * 0.35);
    s.quadraticCurveTo(W - w * 0.1, D - d * 0.1, -W + w * 0.35, D);
    s.lineTo(-W, D);
    s.lineTo(-W, -D);
    const diag = Math.hypot(w, d);
    const cx = -w * 0.08;
    const cz = -d * 0.08;
    const rim = R(0, diag * 0.31, diag * 0.18, 2.4);
    const hole = new THREE.Path();
    const c4 = Math.cos(Math.PI / 4);
    for (let j = 0; j <= 48; j++) {
      const [px, pz] = ringPoint(rim, (j / 48) * Math.PI * 2);
      const x = cx + (px + pz) * c4;
      const z = cz + (pz - px) * c4;
      if (j) hole.lineTo(x, z);
      else hole.moveTo(x, z);
    }
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bs, bevelEnabled: true, bevelSize: bs, bevelThickness: bs, bevelSegments: 3, curveSegments: 32 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, h - bs, 0);
    const cer = ceramic(f, c);
    b.add(creased(geo, Math.PI / 5), cer);
    const basin = (y: number, k: number) => R(y, rim.rx - k * 0.85, rim.rz - k, 2.4);
    const rings = [basin(h, 0), basin(h - 0.03, 0.03), basin(h - 0.15, 0.06), basin(h * 0.45, 0.11), basin(0.14, 0.17), basin(0.12, 0.2)];
    const inside = loft([...rings, pole(rings[rings.length - 1])], 56).rotateY(Math.PI / 4);
    b.add(inside, cer, cx, 0, cz);
    drain(b, cx - 0.2, 0.122, cz + 0.2, 0.026);
    bathSpout(b, -w / 2 + 0.17, h, -d / 2 + 0.17, Math.PI / 4, a);
  },
  whirlpool: (b, w, d, h, f, _c, a) => {
    // a square spa: clad sides, a white shell with a rounded rim, a seat ledge, jets and
    // headrests, the water in it
    const ch = h - 0.06;
    // the cladding: upright boards round the shell's body, dark gaps between them
    const ct = 0.03;
    const dark = mat("#26272a", { roughness: 1 });
    for (const sz of [-1, 1]) b.box(w - 0.02, ch - 0.05, 0.01, 0, 0.05, sz * (d / 2 - ct - 0.005), dark);
    for (const sx of [-1, 1]) b.box(0.01, ch - 0.05, d - 0.02, sx * (w / 2 - ct - 0.005), 0.05, 0, dark);
    const gap = 0.005;
    const boards = (len: number, along: "x" | "z") => {
      const n = Math.max(3, Math.round(len / 0.25));
      const bw = (len - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const c0 = -len / 2 + bw / 2 + i * (bw + gap);
        for (const s2 of [-1, 1])
          if (along === "x") b.box(bw, ch, ct, c0, 0, s2 * (d / 2 - ct / 2), f);
          else b.box(ct, ch, bw, s2 * (w / 2 - ct / 2), 0, c0, f);
      }
    };
    boards(w, "x");
    boards(d - 2 * ct, "z");
    b.box(w - 0.02, 0.05, d - 0.02, 0, 0, 0, mat("#26272a", { roughness: 1 }), 0.01);
    const W = w / 2;
    const D = d / 2;
    const t = 0.16;
    const lip = (y: number, k: number) => R(y, W - k, D - k, 10);
    const basin = (y: number, k: number) => R(y, W - t - k, D - t - k, 6);
    const seat = h - 0.5;
    const rings = [lip(0.05, 0.01), lip(h - 0.02, 0), lip(h - 0.004, 0.01), lip(h, 0.04), lip(h - 0.004, t - 0.03), lip(h - 0.02, t), basin(h - 0.1, 0.01), basin(seat + 0.02, 0.04), basin(seat, 0.08), basin(seat, 0.3), basin(seat - 0.03, 0.33), basin(0.2, 0.37), basin(0.17, 0.42)];
    b.add(loft([...rings, pole(rings[rings.length - 1])], 60), enamel());
    // the water, a little below the rim
    const wl = basin(h - 0.16, 0.022);
    b.add(loft([wl, pole(wl)], 60), mat("#4fb3d4", { transparent: true, opacity: 0.8, roughness: 0.05 }));
    // jets round the walls above the seat and in the footwell
    const jet = mat(C.chrome, { metalness: 0.8, roughness: 0.2 });
    const upper = (y: number) => 0.01 + (0.03 * (h - 0.1 - y)) / (h - 0.1 - (seat + 0.02));
    const yWell = (seat - 0.03 + 0.2) / 2;
    for (const [y, k, count] of [[seat + 0.16, upper(seat + 0.16), 12], [yWell, 0.35, 8]] as const) {
      const r = basin(y, k);
      for (let i = 0; i < count; i++) {
        const [x, z] = ringPoint(r, ((i + 0.5) / count) * Math.PI * 2);
        b.sphere(0.02, x, y, z, jet, 1, 1, 1, 6);
      }
    }
    // headrests on the rim's corners at the back, the control buttons beside them
    const pad = mat("#3a3c40", { roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const hr = b.box(0.3, 0.06, 0.12, sx * (W - 0.27), h - 0.03, -D + 0.11, pad, 0.03);
      if (hr) hr.rotation.y = sx * 0.6;
    }
    for (let i = 0; i < 3; i++) b.cyl(0.016, 0.016, 0.006, -0.05 + i * 0.05, h, -D + 0.07, jet, 14);
    bathSpout(b, W - 0.08, h, 0, Math.PI, a);
  },
  // ----- showers -----
  shower_glass: (b, w, d, h, f, c, a) => {
    // a tray, one framed pane along its right side, the fittings on the back wall
    const prof = profileMat(f, c);
    tray(b, w, d, -w * 0.25, 0);
    pane(b, w / 2 - 0.02, -d / 2, w / 2 - 0.02, d / 2 - 0.01, 0.035, h - 0.02, prof, { bottom: true, top: true, start: true, end: true });
    showerSet(b, -w / 2 + 0.35, h, back(d), a, true);
  },
  shower_walk_in: (b, w, d, h, f, c, a) => walkIn(b, w, d, h, profileMat(f, c), a, false),
  shower_large: (b, w, d, h, f, c, a) => walkIn(b, w, d, h, profileMat(f, c), a, true),
  shower_niche: (b, w, d, h, f, c, a) => {
    // between three walls: a tray, a framed hinged door across the front with a fixed side light
    const prof = profileMat(f, c);
    tray(b, w, d, 0, back(d) + 0.18);
    const z = d / 2 - 0.02;
    const fixed = Math.min(0.3, w * 0.3);
    pane(b, -w / 2, z, -w / 2 + fixed, z, 0.035, h - 0.02, prof, { bottom: true, top: true, start: true });
    pane(b, -w / 2 + fixed + 0.006, z, w / 2, z, 0.04, h - 0.02, prof, { bottom: true, top: true, start: true, end: true });
    for (const y of [0.25, h - 0.3]) b.box(0.05, 0.07, 0.03, -w / 2 + fixed + 0.004, y, z, prof, 0.006);
    doorHandle(b, w / 2 - 0.1, h * 0.42, z, 0, 1, prof);
    showerSet(b, 0, h, back(d), a, true);
  },
  shower_corner: (b, w, d, h, f, c, a) => {
    // two walls of framed glass on a square tray: a fixed side, a fixed front light and a door
    const prof = profileMat(f, c);
    tray(b, w, d);
    const x = w / 2 - 0.02;
    const z = d / 2 - 0.02;
    pane(b, x, -d / 2, x, z, 0.035, h - 0.02, prof, { bottom: true, top: true, start: true });
    const light = w * 0.35;
    pane(b, x, z, x - light, z, 0.035, h - 0.02, prof, { bottom: true, top: true, start: true });
    pane(b, x - light - 0.006, z, -w / 2, z, 0.04, h - 0.02, prof, { bottom: true, top: true, start: true, end: true });
    doorHandle(b, x - light - 0.08, h * 0.42, z, 0, 1, prof);
    showerSet(b, -w / 2 + 0.3, h, back(d), a, true);
  },
  shower_quadrant: (b, w, d, h, f, c, a) => {
    // a quarter round into the room from the back left corner: a tray of that shape,
    // short straight panes at the walls, two curved sliding doors meeting in the middle
    const prof = profileMat(f, c);
    const e = 0.22;
    const cx = -w / 2 + e;
    const cz = -d / 2 + e;
    const rx = w - e;
    const rz = d - e;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2);
    s.lineTo(-w / 2, d / 2);
    s.lineTo(w / 2, d / 2);
    s.lineTo(w / 2, -cz);
    s.absellipse(cx, -cz, rx, rz, 0, -Math.PI / 2, true, 0);
    s.lineTo(-w / 2, -d / 2);
    // the shape's y is -z: lie it down so that it rises from the floor
    const t = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2);
    b.add(t, enamel());
    b.cyl(0.05, 0.05, 0.004, cx + 0.15, 0.035, cz + 0.15, drainMat(), 24);
    // the straight panes at the walls
    pane(b, w / 2 - 0.012, -d / 2, w / 2 - 0.012, cz, 0.035, h - 0.02, prof, { bottom: true, top: true, start: true });
    pane(b, -w / 2, d / 2 - 0.012, cx, d / 2 - 0.012, 0.035, h - 0.02, prof, { bottom: true, top: true, start: true });
    // the curved glass and its rails
    const r = (k: number) => [rx - k, rz - k] as const;
    const [gx, gz] = r(0.012);
    const curved = new THREE.CylinderGeometry(1, 1, h - 0.06, 32, 1, true, 0, Math.PI / 2).scale(gx, 1, gz);
    b.add(curved, mat("#cfe3ea", { transparent: true, opacity: 0.3, roughness: 0.1, side: THREE.DoubleSide }), cx, 0.04 + (h - 0.06) / 2, cz);
    for (const y of [0.045, h - 0.03]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const th = (i / 24) * (Math.PI / 2);
        pts.push(v(cx + Math.sin(th) * gx, y, cz + Math.cos(th) * gz));
      }
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.013, 6), prof);
    }
    // the handles where the doors meet
    const th = Math.PI / 4;
    for (const dt of [-0.06, 0.06]) {
      const nx = Math.sin(th + dt);
      const nz = Math.cos(th + dt);
      doorHandle(b, cx + nx * gx, h * 0.42, cz + nz * gz, nx, nz, prof);
    }
    showerSet(b, -w / 2 + 0.3, h, back(d), a, true);
  },
  // ----- radiators, cabinets, shelves, mirrors -----
  towel_radiator: (b, w, d, h, f) => {
    // two round collectors, bars in three groups, wall brackets, the valves, a towel over a bar
    const m = warmMat(f);
    const z = back(d) + 0.032;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.018);
      b.cyl(0.016, 0.016, h - 0.02, x, 0.01, z, m, 14);
      b.sphere(0.016, x, h - 0.01, z, m, 1, 0.6, 1, 12);
      b.sphere(0.016, x, 0.01, z, m, 1, 0.6, 1, 12);
      for (const y of [h * 0.2, h * 0.85]) b.rod(v(x, y, back(d)), v(x, y, z), 0.007, m, 8);
      b.cyl(0.02, 0.02, 0.006, x, 0.015, back(d) + 0.003, m, 12).rotation.x = Math.PI / 2;
    }
    const groups = 3;
    const per = Math.max(3, Math.round(h / 0.22));
    const gap = 0.042;
    const span = h - 0.08;
    const gh = (per - 1) * gap;
    const free = (span - groups * gh) / (groups - 1);
    const bar = new THREE.CylinderGeometry(0.0105, 0.0105, w - 0.036, 10).rotateZ(Math.PI / 2);
    let towelY = h * 0.7;
    for (let g = 0; g < groups; g++)
      for (let i = 0; i < per; i++) {
        const y = 0.04 + g * (gh + free) + i * gap;
        b.add(bar.clone(), m, 0, y, z);
        if (g === groups - 2 && i === per - 1) towelY = y;
      }
    const [white, , sand] = towelMats();
    foldedTowel(b, w * 0.6, towelY + 0.012, z, Math.min(0.42, h * 0.32), white, sand);
  },
  towel_ladder: (b, w, d, h, f) => {
    // a ladder leaning on the wall: round rails with feet and caps, rungs, two towels over them
    const zAt = (y: number) => d / 2 - 0.03 - (y / h) * (d - 0.06);
    const rail = (sx: number) => sx * (w / 2 - 0.022);
    for (const sx of [-1, 1]) {
      b.rod(v(rail(sx), 0.012, zAt(0.012)), v(rail(sx), h - 0.01, zAt(h - 0.01)), 0.019, f, 12);
      b.cyl(0.02, 0.022, 0.014, rail(sx), 0, zAt(0), mat("#2a2b2d", { roughness: 1 }), 12);
      b.sphere(0.019, rail(sx), h - 0.01, zAt(h - 0.01), f, 1, 0.7, 1, 12);
    }
    const rungs = 5;
    const towels = towelMats();
    for (let i = 1; i <= rungs; i++) {
      const y = (i * h) / (rungs + 1);
      b.add(new THREE.CylinderGeometry(0.013, 0.013, w - 0.05, 10).rotateZ(Math.PI / 2), f, 0, y, zAt(y));
      if (i === 2) foldedTowel(b, w * 0.66, y + 0.013, zAt(y), 0.34, towels[0], towels[2]);
      if (i === 4) foldedTowel(b, w * 0.56, y + 0.013, zAt(y), 0.28, towels[1]);
    }
  },
  bath_tall_cabinet: (b, w, d, h, f, _c, a) => {
    // a hollow carcass on a recessed plinth: a door below, an open niche with towels and
    // bottles, a door above
    const t = 0.018;
    const cd = d - 0.02;
    const zc = back(d) + cd / 2;
    const plinth = 0.06;
    b.box(w - 0.06, plinth, cd - 0.06, 0, 0, zc - 0.02, mat("#2a2b2e", { roughness: 1 }));
    for (const sx of [-1, 1]) b.box(t, h - plinth, cd, sx * (w / 2 - t / 2), plinth, zc, f, 0.002);
    const iw = w - 2 * t;
    const n0 = plinth + h * 0.56;
    const n1 = n0 + Math.min(0.42, h * 0.24);
    for (const y of [plinth, n0 - t, n1, h - t]) b.box(iw, t, cd, 0, y, zc, f);
    b.box(iw, h - plinth, 0.008, 0, plinth, back(d) + 0.004, f);
    // the niche, lined in a pale tone, a shelf halfway
    b.box(iw, n1 - n0, 0.004, 0, n0, back(d) + 0.01, mat("#e7e3dc", { roughness: 0.8 }));
    const shelfY = n0 + (n1 - n0) * 0.48;
    b.box(iw, 0.012, cd - 0.03, 0, shelfY, zc - 0.015, mat("#d9e3e6", { transparent: true, opacity: 0.6, roughness: 0.1 }));
    const towels = towelMats();
    const rr = Math.min(0.045, (shelfY - n0) / 2 - 0.004);
    for (let i = 0; i < 2; i++) rolledTowel(b, -iw / 2 + rr + 0.01 + i * (2 * rr + 0.008), n0, zc, rr, cd * 0.75, towels[i]);
    bottle(b, iw / 2 - 0.05, n0, zc, 0.024, Math.min(0.14, shelfY - n0 - 0.04), mat("#f1ede6", { roughness: 0.4 }), a, true);
    bottle(b, -iw / 2 + 0.06, shelfY + 0.012, zc, 0.022, Math.min(0.15, n1 - shelfY - 0.05), mat("#c9a47c", { roughness: 0.35 }), mat("#2a2b2d"), false);
    bottle(b, -iw / 2 + 0.12, shelfY + 0.012, zc + 0.02, 0.018, Math.min(0.11, n1 - shelfY - 0.05), mat("#7f9a8c", { roughness: 0.35 }), mat("#f2f2f2"), false);
    // the doors flush between the sides
    fronts(b, -iw / 2, iw, plinth + t, n0 - t - plinth - t, back(d) + cd - 0.018, 1, f, 1, "bar", a);
    fronts(b, -iw / 2, iw, n1 + t, h - t - n1 - t, back(d) + cd - 0.018, 1, f, 1, "bar", a);
  },
  bath_shelf: (b, w, d, h, f) => {
    // an open wall box: rolled towels on one side, bottles and a small plant on the other
    const t = 0.018;
    for (const y of [0, h - t]) b.box(w, t, d, 0, y, 0, f, 0.003);
    for (const sx of [-1, 1]) b.box(t, h - 2 * t, d, sx * (w / 2 - t / 2), t, 0, f);
    b.box(w - 2 * t, h - 2 * t, 0.006, 0, t, back(d) + 0.003, f);
    const towels = towelMats();
    const r = Math.min(0.055, (h - 2 * t) / 2 - 0.01, d / 2 - 0.01);
    for (let i = 0; i < 2; i++) rolledTowel(b, -w / 2 + t + r + 0.01 + i * (2 * r + 0.006), t, 0, r, d * 0.82, towels[i]);
    rolledTowel(b, -w / 2 + t + r * 2 + 0.013, t + 2 * r - 0.006, 0, r, d * 0.82, towels[2]);
    const ih = h - 2 * t - 0.02;
    bottle(b, w * 0.1, t, 0, 0.026, Math.min(0.17, ih), mat("#dfe6ea", { roughness: 0.3 }), mat(C.chrome, { metalness: 0.7, roughness: 0.3 }), true);
    bottle(b, w * 0.2, t, -0.01, 0.022, Math.min(0.13, ih), mat("#c9a47c", { roughness: 0.35 }), mat("#2a2b2d"), false);
    // a little potted plant
    const px = w / 2 - t - 0.05;
    b.cyl(0.035, 0.028, 0.07, px, t, 0, mat(C.ceramic, { roughness: 0.4 }), 14);
    const rand = random(37);
    const leaf = mat(C.leaf, { roughness: 0.8 });
    for (let i = 0; i < 7; i++) {
      const an = (i / 7) * Math.PI * 2;
      const lh = Math.min(0.1, ih - 0.08) * (0.7 + rand() * 0.3);
      b.rod(v(px, t + 0.06, 0), v(px + Math.cos(an) * 0.035, t + 0.06 + lh, Math.sin(an) * 0.025), 0.007, leaf, 4);
    }
  },
  mirror_lit: (b, w, d, h, f) => {
    // a rounded mirror on a slim back plate, a frosted band of light round its edge, a touch switch
    const r = Math.min(0.06, w * 0.08, h * 0.08);
    plate(b, w - 0.03, h - 0.03, d * 0.55, 0.015, back(d), r, f);
    plate(b, w, h, 0.005, 0, back(d) + d * 0.55, r, lightMat());
    plate(b, w - 0.06, h - 0.06, 0.006, 0.03, back(d) + d * 0.55 + 0.003, Math.max(0.005, r - 0.03), mirrorMat());
    b.cyl(0.01, 0.01, 0.002, w / 2 - 0.07, 0.055, back(d) + d * 0.55 + 0.009, mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.5 }), 16).rotation.x = Math.PI / 2;
  },
  mirror_cabinet: (b, w, d, h, f) => {
    // a carcass in the finish, mirrored doors with polished edges, a light strip below
    const dd = d - 0.025;
    b.box(w, h - 0.012, dd, 0, 0.012, back(d) + dd / 2, f, 0.004);
    const n = Math.max(1, Math.round(w / 0.4));
    const dw = w / n;
    const edge = mat("#9fb0b5", { metalness: 0.4, roughness: 0.2 });
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      b.box(dw - 0.006, h - 0.016, 0.02, x, 0.014, back(d) + dd + 0.01, edge, 0.002);
      b.box(dw - 0.016, h - 0.026, 0.004, x, 0.019, back(d) + dd + 0.019, mirrorMat());
    }
    // the light under it, set back in a recess
    b.box(w - 0.04, 0.012, dd - 0.04, 0, 0, back(d) + dd / 2 - 0.01, mat("#2a2b2e", { roughness: 1 }));
    b.box(w - 0.08, 0.008, 0.02, 0, 0.002, back(d) + dd - 0.045, lightMat());
  },
  laundry_hamper: (b, w, d, h, f) => {
    // a woven basket tapering to its foot, a braided rim, a linen liner showing under the
    // lid, rope handles, the lid in the finish with a knob
    const wick = wickerMat("sand");
    const bh = h - 0.05;
    const body = b.box(w - 0.02, bh, d - 0.02, 0, 0, 0, wick, 0.03);
    if (body) {
      // narrowing to its foot
      const p = body.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 - 0.07 * (0.5 - p.getY(i) / bh);
        p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
      }
    }
    b.box(w - 0.004, 0.035, d - 0.004, 0, bh - 0.05, 0, wickerMat("brown"), 0.012);
    b.box(w * 0.88, 0.02, d * 0.88, 0, 0.003, 0, wickerMat("brown"), 0.006);
    b.box(w - 0.03, 0.03, d - 0.03, 0, bh - 0.015, 0, mat(C.linen, { roughness: 1 }), 0.01);
    b.box(w, 0.035, d, 0, h - 0.035, 0, f, 0.015);
    b.sphere(0.022, 0, h, 0, f, 1, 0.55, 1, 12);
    for (const sx of [-1, 1]) {
      const handle = new THREE.TorusGeometry(0.04, 0.007, 6, 12, Math.PI).rotateY(Math.PI / 2);
      b.add(handle, mat("#8a6f4e", { roughness: 1 }), sx * ((w - 0.02) / 2 + 0.002), bh - 0.12, 0);
    }
  },
};
