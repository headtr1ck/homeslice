// Built-in pieces added later: media smart. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0; wall pieces
// from their bottom with the back against the wall, ceiling pieces hanging from y = h).
//
// What reacts: screens are `part(…, "screen")`, status and RGB lights `part(…, "led")`, the
// lamps' light-emitting parts `glowing(…)` like the lamps in lighting.ts, the fountain's water
// `part(…, "water")`; fans turn (b.spinner), the subwoofer's cone pulses (b.pulser).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, back, glass, glowing, ledMat, mat, matrix, part, screenMat, v } from "../modern";
import type { Build, Builder } from "../modern";

// ----- helpers -----

/** A box from its bottom centre with rounded edges of few segments (small devices). */
function rb(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r: number, seg = 1) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const geo = rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  return b.add(geo, m, x, y + h / 2, z);
}

/** A plain box from its bottom centre, merged with the others of its material (turned about its centre). */
function bx(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.batch(new THREE.BoxGeometry(w, h, d), m, matrix(x, y + h / 2, z, rx, ry, rz));
}

/** A cylinder lying along z, centred at (x, y, z). */
function zcyl(b: Builder, rFront: number, rBack: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 20, open = false) {
  return b.add(new THREE.CylinderGeometry(rFront, rBack, len, seg, 1, open).rotateX(Math.PI / 2), m, x, y, z);
}

/** A cylinder lying along x, centred at (x, y, z). */
function xcyl(b: Builder, r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 16) {
  return b.add(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2), m, x, y, z);
}

/** A flat circle on a face looking at +z. */
function dot(b: Builder, r: number, x: number, y: number, z: number, m: THREE.Material, seg = 12) {
  return b.add(new THREE.CircleGeometry(r, seg), m, x, y, z);
}

/** A thin flat ring on a face looking at +z (or up, `up`), its back at z (its bottom at y). */
function ring(b: Builder, r0: number, r1: number, x: number, y: number, z: number, m: THREE.Material, seg = 24, t = 0.001, up = false) {
  // a very thin one: a flat ring on top of the face
  if (t <= 0.0012) {
    const flat = new THREE.RingGeometry(r0, r1, seg);
    if (up) flat.rotateX(-Math.PI / 2);
    return b.add(flat, m, x, y + (up ? t : 0), z + (up ? 0 : t));
  }
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, r0, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: Math.max(3, Math.round(seg / 2)) });
  if (up) geo.rotateX(-Math.PI / 2);
  return b.add(geo, m, x, y, z);
}

/** A turned part from [r, y] points (normals to the right of the path: up the outside, down the inside). */
function lathe(b: Builder, pts: number[][], m: THREE.Material, seg = 24, x = 0, y = 0, z = 0) {
  return b.add(new THREE.LatheGeometry(pts.map(([r, yy]) => new THREE.Vector2(Math.max(r, 1e-4), yy)), seg), m, x, y, z);
}

/** A horizontal round rim (a torus lying flat) of radius r at height y. */
function ring3(b: Builder, r: number, tube: number, y: number, z: number, m: THREE.Material, seg = 40) {
  return b.add(new THREE.TorusGeometry(r, tube, 5, seg).rotateX(Math.PI / 2), m, 0, y, z);
}

/** Turns a mesh about a horizontal x axis through (py, pz): a backrest leaning back, a screen tilted. */
function tiltX<T extends THREE.Object3D | null>(o: T, py: number, pz: number, a: number): T {
  if (!o) return o;
  const p = new THREE.Vector3(0, py, pz);
  o.position.sub(p).applyAxisAngle(new THREE.Vector3(1, 0, 0), a).add(p);
  o.rotation.x += a;
  return o;
}

/** Seven-segment digits on a face looking at +z, `x` the left edge, `y` the bottom. */
const SEGMENTS: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g" };
function digits(b: Builder, text: string, x: number, y: number, z: number, ch: number, m: THREE.Material) {
  const cw = ch * 0.52;
  const t = ch * 0.14;
  let cx = x;
  for (const c of text) {
    const s = SEGMENTS[c] ?? "";
    const hz = (yy: number) => bx(b, cw - t, t, 0.0008, cx + cw / 2, yy, z, m);
    const vt = (xx: number, yy: number) => bx(b, t, ch / 2 - t * 0.5, 0.0008, xx, yy, z, m);
    if (s.includes("a")) hz(y + ch - t);
    if (s.includes("g")) hz(y + ch / 2 - t / 2);
    if (s.includes("d")) hz(y);
    if (s.includes("f")) vt(cx + t / 2, y + ch / 2);
    if (s.includes("b")) vt(cx + cw - t / 2, y + ch / 2);
    if (s.includes("e")) vt(cx + t / 2, y + t * 0.25);
    if (s.includes("c")) vt(cx + cw - t / 2, y + t * 0.25);
    cx += cw + t * 1.2;
  }
}

/** A colour of RGB light lit by its lamp (lamps): the card gives it the lamp's light. */
const lampGlow = (color: string, k = 0.85) => glowing(mat(color, { emissive: color, emissiveIntensity: k, roughness: 0.45 }));
/** A lit, coloured part of a device (RGB fans, a marquee): follows the device's state. */
const rgb = (color: string, k = 0.8) => part(mat(color, { emissive: color, emissiveIntensity: k, roughness: 0.4, name: "led" }), "led");
/** Lit characters on a display (always lit, not driven). */
const litText = (color: string) => mat(color, { emissive: color, emissiveIntensity: 0.8 });
const dark = (color = "#1c1d20", roughness = 0.6) => mat(color, { roughness });
const steel = () => mat(C.steel, { metalness: 0.7, roughness: 0.3 });
const chrome = () => mat(C.chrome, { metalness: 0.8, roughness: 0.3 });
/** Small rubber feet under the corners. */
function feet(b: Builder, w: number, d: number, inset: number, r: number, t: number) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(r, r, t, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), dark("#141416", 0.9), 8);
}

/** How many switches or sockets a wall plate has (options.gangs). */
function gangs(b: Builder) {
  const g = Number(b.options.gangs ?? "1");
  return g === 2 || g === 3 ? g : 1;
}
/** Switch and socket modules sit 71 mm apart on a plate 86 mm high (and 86 mm wide for one). */
const MODULE = 0.071;
/** How much the modules must shrink to fit g of them on a w × h plate (1: full size). */
const moduleScale = (w: number, h: number, g: number) => Math.min(1, w / (0.086 + (g - 1) * MODULE), h / 0.086);
/** The recessed parts of a wall plate, a shade darker than it. */
const insetColor = (color: string) => ({ white: "#cfcfca", black: "#121214", anthracite: "#2b2d30", brass: "#7d6538" })[color] ?? "#cfcfca";

export const BUILDERS: Record<string, Build> = {
  // ----- home cinema -----
  projector: (b, w, d, h, f, color) => {
    // a ceiling mount (plate, pole, a four-armed spider) holding the projector body: the lens
    // off to one side in a ringed barrel, vents on the other, a status light on top
    const bh = Math.min(h * 0.42, w * 0.38, 0.16);
    const lensLen = Math.min(0.03, d * 0.1);
    const bd = d - lensLen;
    const bz = back(d) + bd / 2;
    rb(b, w, bh, bd, 0, 0, bz, f, Math.min(0.03, bh * 0.32), 2);
    const light = color !== "black";
    const trim = mat(light ? "#c4c6c9" : "#3d3f43", { roughness: 0.4, metalness: 0.3 });
    const metal = mat(light ? "#d9dadc" : "#2a2b2e", { metalness: 0.5, roughness: 0.4 });
    const slot = dark("#16171a", 0.8);
    const fz = back(d) + bd;
    // a darker band round the front
    bx(b, w * 0.94, bh * 0.66, 0.002, 0, bh * 0.17, fz, light ? mat("#dcdcd9", { roughness: 0.5 }) : dark("#202124", 0.5));
    // the lens
    const lr = Math.min(bh * 0.33, w * 0.13);
    const lx = -w * 0.24;
    const ly = bh * 0.5;
    ring(b, lr * 1.12, lr * 1.38, lx, ly, fz + 0.001, trim, 20, 0.003);
    // the barrel: up its outside, over its lip and back down its inside (no open, one-sided tube)
    const barrel = [[lr * 1.12, 0], [lr * 1.08, lensLen], [lr * 0.98, lensLen], [lr * 0.98, 0]].map(([r, y]) => new THREE.Vector2(r, y));
    b.add(new THREE.LatheGeometry(barrel, 20).rotateX(Math.PI / 2), dark("#202226", 0.4), lx, ly, fz);
    ring(b, lr * 0.9, lr * 1.09, lx, ly, fz + lensLen - 0.0005, trim, 20, 0.002);
    const lens = part(mat("#1b2a3e", { roughness: 0.05, metalness: 0.4, name: "screen" }), "screen");
    const cap = Math.PI * 0.32;
    b.add(new THREE.SphereGeometry(lr * 0.92, 18, 3, 0, Math.PI * 2, 0, cap).rotateX(Math.PI / 2), lens, lx, ly, fz + lensLen - lr * 0.92 * Math.cos(cap) - 0.002);
    // vents on the front's other side and along both flanks
    for (let i = 0; i < 6; i++) bx(b, w * 0.38, bh * 0.045, 0.002, w * 0.17, bh * (0.27 + i * 0.085), fz + 0.0008, slot);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) bx(b, 0.002, bh * 0.045, bd * 0.32, s * (w / 2 + 0.0005), bh * (0.3 + i * 0.09), bz + bd * 0.2, slot);
    // on top: a status light, a focus wheel, the spider and pole up to the ceiling plate
    bx(b, 0.006, 0.002, 0.006, w * 0.32, bh, fz - 0.03, ledMat("#3fa8ff"));
    b.cyl(lr * 0.45, lr * 0.45, 0.004, lx, bh - 0.001, fz - lr * 1.6, trim, 16);
    const top = bh + 0.004;
    bx(b, w * 0.5, 0.006, bd * 0.5, 0, bh - 0.002, bz, metal);
    const hubY = Math.min(top + Math.min(0.05, (h - bh) * 0.35), h - 0.03);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * w * 0.2, top, bz + sz * bd * 0.2), v(0, hubY, bz), 0.006, metal, 6);
    b.cyl(0.02, 0.024, 0.018, 0, hubY - 0.009, bz, metal, 16);
    const plateT = Math.min(0.012, (h - bh) * 0.1);
    if (h - plateT > hubY + 0.009) b.cyl(0.012, 0.012, h - plateT - hubY - 0.009, 0, hubY + 0.009, bz, metal, 12);
    b.cyl(Math.min(0.06, w * 0.2), Math.min(0.06, w * 0.2), plateT, 0, h - plateT, bz, metal, 20);
  },
  speaker_subwoofer: (b, w, d, h, f) => {
    // a cube on small feet: a black baffle with one big front-firing driver (its cone pulses
    // while it plays), a ring and screws round it, a slot port below, a standby light
    const ft = Math.min(0.018, h * 0.05);
    const ch = h - ft;
    const R = Math.min(w, ch) * 0.4;
    const recess = R * 0.22;
    const cd = d - recess;
    rb(b, w, ch, cd, 0, ft, back(d) + cd / 2, f, 0.008, 2);
    feet(b, w, d, 0.04, 0.02, ft);
    const fz = back(d) + cd;
    bx(b, w - 0.024, ch - 0.024, 0.003, 0, ft + 0.012, fz + 0.0015, dark("#1c1d20", 0.75));
    const cy = ft + ch * 0.56;
    const rubber = dark("#2a2b2e", 0.95);
    const cone = dark("#343538", 0.8);
    ring(b, R * 1.0, R * 1.1, 0, cy, fz + 0.003, dark("#26272a", 0.4), 24, 0.004);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      dot(b, R * 0.025, Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05, fz + 0.0075, steel(), 6);
    }
    const zf = fz + 0.003 + recess * 0.85;
    b.pulser(0, cy, zf, () => {
      b.add(new THREE.TorusGeometry(R * 0.9, R * 0.085, 5, 24), rubber, 0, cy, zf - R * 0.06);
      b.add(new THREE.LatheGeometry([[R * 0.86, 0], [R * 0.62, -R * 0.1], [R * 0.36, -R * 0.17], [R * 0.3, -R * 0.18]].map(([r, y]) => new THREE.Vector2(r, y)), 24).rotateX(Math.PI / 2), cone, 0, cy, zf - R * 0.05);
      b.sphere(R * 0.3, 0, cy, zf - R * 0.23, rubber, 1, 1, 0.45, 12);
    });
    // the port: a slot with a rounded lip
    rb(b, w * 0.56, ch * 0.07, 0.006, 0, ft + ch * 0.1, fz + 0.002, dark("#26272a", 0.5), ch * 0.03);
    bx(b, w * 0.52, ch * 0.045, 0.002, 0, ft + ch * 0.112, fz + 0.005, dark("#050506", 1));
    bx(b, 0.006, 0.006, 0.002, w * 0.38, ft + ch * 0.92, fz + 0.003, ledMat("#3fd27a"));
  },
  av_receiver: (b, w, d, h, f, color) => {
    // a wide chassis: a brushed front with the display in the middle, a big volume knob and an
    // input knob, a row of small buttons, vents on top, feet underneath
    const ft = Math.min(0.012, h * 0.08);
    const bh = h - ft;
    const kn = Math.min(0.022, d * 0.06);
    const pd = 0.012;
    const cd = d - kn - pd;
    rb(b, w * 0.985, bh * 0.98, cd, 0, ft, back(d) + cd / 2, f, 0.003);
    feet(b, w, d - kn, 0.04, 0.018, ft);
    const light = color === "silver";
    const panel = mat(light ? "#c4c8cc" : "#202124", { metalness: light ? 0.6 : 0.3, roughness: 0.35 });
    const fz0 = back(d) + cd;
    rb(b, w, bh, pd, 0, ft, fz0 + pd / 2, panel, 0.004);
    const fz = fz0 + pd;
    // the display: a black glass window, the screen and its lit text
    const dw = w * 0.42;
    const dh = bh * 0.24;
    const dy = ft + bh * 0.5;
    bx(b, dw, dh, 0.002, 0, dy, fz, mat("#08090b", { roughness: 0.1 }));
    bx(b, dw * 0.94, dh * 0.8, 0.001, 0, dy + dh * 0.1, fz + 0.0015, screenMat());
    const txt = litText("#5fd3ff");
    bx(b, dw * 0.5, dh * 0.22, 0.0008, -dw * 0.14, dy + dh * 0.55, fz + 0.0022, txt);
    digits(b, "-35", dw * 0.16, dy + dh * 0.2, fz + 0.0022, dh * 0.56, txt);
    for (let i = 0; i < 4; i++) bx(b, dw * 0.06, dh * 0.12, 0.0008, -dw * 0.4 + i * dw * 0.08, dy + dh * 0.2, fz + 0.0022, txt);
    // knobs: volume (right), input (left), with their rings
    const knob = mat(light ? "#d6d9dc" : "#2c2d30", { metalness: 0.7, roughness: 0.3 });
    const ky = ft + bh * 0.52;
    const kr = Math.min(bh * 0.3, w * 0.08);
    for (const [x, r] of [[w * 0.36, kr], [-w * 0.37, kr * 0.62]] as const) {
      ring(b, r * 1.02, r * 1.16, x, ky, fz, dark("#0d0d0f", 0.6), 20, 0.001);
      zcyl(b, r, r * 1.03, kn, x, ky, fz + kn / 2, knob, 20);
      ring(b, r * 0.25, r * 0.85, x, ky, fz + kn, mat(light ? "#e3e5e7" : "#3a3b3f", { metalness: 0.8, roughness: 0.2 }), 20, 0.0006);
    }
    // a row of small buttons under the display, a power button with its light, a headphone jack
    const btn = mat(light ? "#9fa3a8" : "#3b3d41", { roughness: 0.5 });
    for (let i = 0; i < 7; i++) bx(b, dw * 0.1, bh * 0.05, 0.003, -dw * 0.45 + dw * 0.075 + i * dw * 0.135, ft + bh * 0.2, fz, btn);
    zcyl(b, bh * 0.06, bh * 0.06, 0.004, -w * 0.43, ft + bh * 0.2, fz + 0.002, btn, 12);
    bx(b, 0.004, 0.004, 0.001, -w * 0.43, ft + bh * 0.33, fz, ledMat("#3fa8ff"));
    dot(b, bh * 0.03, -w * 0.3, ft + bh * 0.2, fz + 0.0005, dark("#050506", 1), 10);
    // vents on top
    const vent = dark("#0f1012", 0.9);
    for (let i = 0; i < 9; i++) bx(b, w * 0.6, 0.001, cd * 0.025, 0, ft + bh * 0.98, back(d) + cd * (0.2 + i * 0.05), vent);
  },
  cinema_seats: (b, w, d, h, f) => {
    // a row of recliners, one per ~0.8 m: padded armrests between with cup holders, tall
    // backs with lumbar and head cushions, closed leg rests, a dark plinth
    const s = h / 1.05;
    const arm = Math.min(0.15, w * 0.09);
    const n = Math.max(1, Math.round((w - arm) / 0.8));
    const sw = (w - arm * (n + 1)) / n;
    const zb = back(d);
    bx(b, w - 0.06, 0.07 * s, d * 0.7, 0, 0, zb + d * 0.42, dark("#18191b", 0.9));
    const cup = dark("#0e0e10", 0.7);
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + arm / 2 + i * (arm + sw);
      const ah = 0.6 * s;
      rb(b, arm, ah - 0.11 * s, d * 0.88, x, 0.05 * s, zb + d * 0.44, f, 0.03);
      rb(b, arm + 0.006, 0.07 * s, d * 0.8, x, ah - 0.07 * s, zb + d * 0.45, f, 0.03);
      if (i > 0 && i < n) {
        const cr = Math.min(0.04, arm * 0.32);
        const cz = zb + d * 0.72;
        b.cyl(cr, cr * 0.9, 0.004, x, ah - 0.0035, cz, cup, 16);
        ring(b, cr, cr * 1.18, x, ah - 0.001, cz, chrome(), 16, 0.0015, true);
      }
    }
    for (let j = 0; j < n; j++) {
      const x = -w / 2 + arm + sw / 2 + j * (arm + sw);
      // seat frame, cushion, the folded leg rest at the front
      bx(b, sw, 0.3 * s, d * 0.6, x, 0.06 * s, zb + d * 0.5, f);
      rb(b, sw - 0.012, 0.16 * s, d * 0.6, x, 0.34 * s, zb + 0.2 + d * 0.3, f, 0.06, 2);
      rb(b, sw - 0.02, 0.36 * s, 0.09, x, 0.07 * s, zb + d * 0.8 + 0.045, f, 0.04);
      // the back, leaning back a little, with its cushions
      const py = 0.34 * s;
      const pz = zb + 0.24;
      const lean = -0.13;
      const bh = h - py - 0.02;
      tiltX(rb(b, sw - 0.012, bh, 0.22, x, py, pz - 0.09, f, 0.06), py, pz, lean);
      tiltX(rb(b, sw - 0.07, 0.3 * s, 0.08, x, py + 0.1 * s, pz + 0.04, f, 0.035), py, pz, lean);
      tiltX(rb(b, sw * 0.7, 0.17 * s, 0.07, x, py + bh - 0.24 * s, pz + 0.03, f, 0.035), py, pz, lean);
    }
  },

  // ----- lights -----
  light_bar: (b, w, d, h, f) => {
    // a pair of slim light bars on flat feet at the two ends, their frosted fronts glowing
    const fw = Math.min(0.07, w * 0.2);
    const bw = Math.min(0.036, fw * 0.6);
    const bd = Math.min(0.03, d * 0.45);
    const ft = Math.min(0.012, h * 0.06);
    const colours = ["#b07bff", "#3fc4ff"];
    [-1, 1].forEach((sx, i) => {
      const x = sx * (w / 2 - fw / 2);
      rb(b, fw, ft, d, x, 0, 0, f, 0.006);
      rb(b, bw * 0.7, 0.012, bd * 0.7, x, ft, -bd * 0.1, f, 0.003);
      const y0 = ft + 0.01;
      const bh = h - y0;
      rb(b, bw, bh, bd * 0.5, x, y0, -bd * 0.25, f, 0.004);
      rb(b, bw * 0.92, bh - 0.008, bd * 0.56, x, y0 + 0.004, bd * 0.2, lampGlow(colours[i]), 0.008, 2);
    });
  },
  light_pillar: (b, w, d, h, f) => {
    // a round base, a slim column of light fading through its colours, a spine at the back, end caps
    const R = Math.min(w, d) / 2;
    lathe(b, [[0, 0], [R * 0.97, 0], [R, 0.008], [R * 0.95, 0.022], [R * 0.82, 0.028], [0, 0.028]], f, 40);
    const cr = Math.min(0.035, R * 0.3);
    const y0 = 0.028 + 0.03;
    const y1 = h - 0.025;
    b.cyl(cr * 1.15, cr * 1.3, 0.03, 0, 0.028, 0, f, 20);
    b.cyl(cr * 1.15, cr * 1.15, h - y1, 0, y1, 0, f, 20);
    const n = 14;
    const a = new THREE.Color("#ff4fa3");
    const m = new THREE.Color("#7b5cff");
    const c = new THREE.Color("#36c8ff");
    const bandH = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const col = t < 0.5 ? a.clone().lerp(m, t * 2) : m.clone().lerp(c, t * 2 - 1);
      b.cyl(cr, cr, bandH, 0, y0 + i * bandH, 0, lampGlow(`#${col.getHexString()}`), 20, true);
    }
    // the spine: a thick half shell round the back of the column
    const s = new THREE.Shape();
    s.absarc(0, 0, cr * 1.18, Math.PI * 0.15, Math.PI * 0.85, false);
    s.absarc(0, 0, cr * 1.01, Math.PI * 0.85, Math.PI * 0.15, true);
    b.add(new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 8 }).rotateX(-Math.PI / 2), f, 0, y0, 0);
  },
  orb_lamp: (b, w, d, h, f) => {
    // a small glass orb glowing from inside, set in a turned base with a metal ring
    const bh = h * 0.22;
    const r = Math.min(Math.min(w, d) / 2, (h - bh * 0.45) / 2);
    // the base keeps to the orb's size (a wide, low box: a small base, not a flat dish)
    const R0 = Math.min(Math.min(w, d) / 2, r * 1.18);
    lathe(b, [[0, 0], [R0 * 0.72, 0], [R0 * 0.72, 0], [R0 * 0.76, bh * 0.15], [R0 * 0.7, bh * 0.8], [R0 * 0.6, bh], [0, bh]], f, 32);
    ring(b, r * 0.5, R0 * 0.62, 0, bh - 0.0005, 0, chrome(), 28, 0.0015, true);
    b.sphere(r, 0, h - r, 0, glowing(mat("#fbf3e9", { emissive: "#ffe2b8", emissiveIntensity: 0.6, roughness: 0.25 })), 1, 1, 1, 28);
  },

  // ----- computers and network -----
  tower_pc: (b, w, d, h, f, color) => {
    // a case on feet: a glass side panel showing the board, graphics card, cooler and memory
    // with their lights, three RGB fans behind the glass front and one at the back (they turn)
    const ft = 0.014;
    const H = h - ft;
    const t = 0.006;
    feet(b, w, d, 0.03, 0.012, ft);
    const zb = back(d);
    const zf = d / 2;
    bx(b, t, H, d, -w / 2 + t / 2, ft, 0, f);
    bx(b, w, t, d, 0, ft + H - t, 0, f);
    bx(b, w, t * 2, d, 0, ft, 0, f);
    bx(b, w - t, H - 3 * t, t, t / 2, ft + 2 * t, zb + t / 2, dark("#121316", 0.8));
    // the front: a frame round a smoked glass
    const fr = 0.014;
    for (const s of [-1, 1]) bx(b, fr, H, 0.01, s * (w / 2 - fr / 2), ft, zf - 0.005, f);
    bx(b, w - 2 * fr, fr, 0.01, 0, ft + H - fr, zf - 0.005, f);
    bx(b, w - 2 * fr, 0.03, 0.01, 0, ft, zf - 0.005, f);
    bx(b, w - 2 * fr, H - fr - 0.03, 0.003, 0, ft + 0.03, zf - 0.0015, mat("#2a2d33", { transparent: true, opacity: 0.35, roughness: 0.1 }));
    // the side: a frame round the glass
    const sf = 0.012;
    const sx = w / 2 - 0.003;
    bx(b, 0.006, sf, d, sx, ft + H - sf, 0, f);
    bx(b, 0.006, sf * 2, d, sx, ft, 0, f);
    bx(b, 0.006, H, sf, sx, ft, zb + sf / 2, f);
    bx(b, 0.006, H, sf, sx, ft, zf - 0.01 - sf / 2, f);
    bx(b, 0.003, H - 3 * sf, d - 0.01 - 2 * sf, sx + 0.0015, ft + 2 * sf, -0.005, glass());
    // inside: the shroud below, the board on the far wall, the graphics card with its light strip
    const sh = H * 0.24;
    bx(b, w - 2 * t, sh, d - 0.03, 0, ft + 2 * t, -0.012, color === "white" ? mat("#dcdcd8", { roughness: 0.6 }) : dark("#1d1e21", 0.7));
    const bz = zb + 0.04 + (d - 0.2) / 2;
    bx(b, 0.003, H - sh - 0.04, d - 0.2, -w / 2 + t + 0.0015, ft + 2 * t + sh + 0.012, bz, dark("#1a1d22", 0.7));
    const gy = ft + 2 * t + sh + (H - sh) * 0.22;
    const gw = w * 0.56;
    bx(b, gw, 0.045, d * 0.6, -w / 2 + t + gw / 2, gy, zb + 0.03 + d * 0.3, dark("#2a2c30", 0.5));
    bx(b, 0.002, 0.008, d * 0.5, -w / 2 + t + gw + 0.001, gy + 0.03, zb + 0.03 + d * 0.3, rgb("#ff3da8"));
    // the cooler's pump with its light ring, the memory sticks lit along their tops
    const cy = ft + H * 0.72;
    const cz = zb + 0.04 + (d - 0.2) * 0.45;
    xcyl(b, 0.032, 0.03, -w / 2 + t + 0.018, cy, cz, dark("#25272b", 0.4), 20);
    b.add(new THREE.TorusGeometry(0.03, 0.004, 6, 20).rotateY(Math.PI / 2), rgb("#36c8ff"), -w / 2 + t + 0.034, cy, cz);
    for (let i = 0; i < 4; i++) {
      const z = cz + 0.06 + i * 0.012;
      bx(b, 0.03, 0.09, 0.005, -w / 2 + t + 0.015, cy - 0.045, z, dark("#2a2c30", 0.5));
      bx(b, 0.026, 0.006, 0.006, -w / 2 + t + 0.015, cy + 0.045, z, rgb("#8a5cff"));
    }
    // fans: three behind the front glass, one at the back
    const fs = Math.min(w - 2 * fr - 0.004, (H - 0.05) / 3);
    const blade = dark("#26282c", 0.5);
    const hub = dark("#1a1b1e", 0.5);
    const fan = (x: number, y: number, z: number, s: number, light: THREE.Material) => {
      b.add(new THREE.TorusGeometry(s * 0.43, s * 0.035, 6, 24), light, x, y, z);
      ring(b, s * 0.46, s * 0.5, x, y, z - 0.004, dark("#16171a", 0.7), 24, 0.008);
      b.spinner(x, y, z, "z", () => {
        zcyl(b, s * 0.13, s * 0.13, 0.012, x, y, z, hub, 16);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          b.add(new THREE.BoxGeometry(s * 0.27, s * 0.12, 0.002).rotateX(0.35).translate(s * 0.27, 0, 0).rotateZ(a), blade, x, y, z);
        }
      });
    };
    const colours = ["#ff3da8", "#8a5cff", "#36c8ff"];
    for (let i = 0; i < 3; i++) fan(0, ft + 0.03 + fs * (i + 0.5) + 0.004, zf - 0.024, fs, rgb(colours[i]));
    fan(-0.004, ft + H * 0.74, zb + 0.02, Math.min(fs, 0.12), rgb("#36c8ff"));
    // on top at the front: the power button with its light and two ports
    const ty = ft + H;
    b.cyl(0.008, 0.008, 0.002, w * 0.2, ty, zf - 0.03, dark("#2c2e31", 0.4), 16);
    ring(b, 0.0085, 0.0105, w * 0.2, ty, zf - 0.03, ledMat("#ffffff"), 16, 0.0012, true);
    for (const x of [-w * 0.15, -w * 0.05]) bx(b, 0.013, 0.0012, 0.005, x, ty, zf - 0.03, dark("#050506", 1));
  },
  wifi_router: (b, w, d, h, f, color) => {
    // a flat box on feet: vent slots on top, a row of lights on the front, four antennas at the back
    const ft = 0.005;
    const bh = Math.min(0.045, h * 0.24);
    const bd = d * 0.84;
    const zc = d / 2 - bd / 2;
    rb(b, w, bh, bd, 0, ft, zc, f, Math.min(0.012, bh * 0.3), 2);
    feet(b, w, bd, 0.02, 0.008, ft);
    const vent = dark(color === "white" ? "#b9bab7" : "#101113", 0.9);
    for (let i = 0; i < 6; i++) bx(b, w * 0.6, 0.001, 0.004, 0, ft + bh, zc - bd * 0.25 + i * bd * 0.08, vent);
    const fz = d / 2;
    const green = ledMat("#3fd27a");
    for (let i = 0; i < 6; i++) bx(b, 0.007, 0.003, 0.002, -w * 0.3 + i * w * 0.07, ft + bh * 0.5, fz, i === 0 ? ledMat("#ffffff") : green);
    // antennas on hinges along the back edge, splayed a little
    const hy = ft + bh * 0.6;
    const az = zc - bd / 2 - 0.006;
    const ah = h - hy - 0.004;
    const aw = Math.min(0.02, w * 0.08);
    const ant = dark(color === "white" ? "#e9e8e4" : "#232427", 0.6);
    [-1.5, -0.5, 0.5, 1.5].forEach((k) => {
      const x = k * w * 0.27;
      xcyl(b, 0.007, 0.018, x, hy, az, ant, 10);
      const geo = new RoundedBoxGeometry(aw, ah, 0.007, 1, 0.003).translate(0, ah / 2, 0);
      b.add(geo, ant, x, hy, az).rotation.z = -k * 0.09;
    });
  },
  access_point: (b, w, d, h, f) => {
    // a flat disc on the ceiling: a soft rounded edge, a light ring and a mark on its face
    const R = Math.min(w, d) / 2;
    lathe(b, [[0, 0], [R * 0.6, 0.0015], [R * 0.86, h * 0.14], [R * 0.98, h * 0.4], [R, h * 0.62], [R * 0.95, h * 0.82], [R * 0.7, h * 0.9], [0, h * 0.9]], f, 40);
    b.cyl(R * 0.6, R * 0.62, h * 0.1, 0, h * 0.9, 0, mat("#dddcd8", { roughness: 0.8 }), 32);
    const led = ledMat("#3fa8ff");
    b.add(new THREE.RingGeometry(R * 0.5, R * 0.56, 40).rotateX(Math.PI / 2), led, 0, 0.0006, 0);
    b.cyl(R * 1.004, R * 1.004, h * 0.07, 0, h * 0.55, 0, led, 40, true);
    b.add(new THREE.CircleGeometry(R * 0.07, 16).rotateX(Math.PI / 2), mat("#b8bbbf", { roughness: 0.5 }), 0, -0.0004, 0);
  },
  nas: (b, w, d, h, f, color) => {
    // a cube on feet: 2–4 drive trays across the front (each with its lights), a strip with the
    // power button, status lights and a port, vents on the sides
    const ft = 0.008;
    const H = h - ft;
    rb(b, w, H, d, 0, ft, 0, f, 0.008, 2);
    feet(b, w, d, 0.025, 0.012, ft);
    const fz = d / 2;
    const n = Math.max(2, Math.min(4, Math.round((w - 0.05) / 0.042)));
    const strip = Math.min(0.04, w * 0.18);
    const x0 = -w / 2 + 0.012;
    const x1 = w / 2 - strip;
    const tw = (x1 - x0) / n;
    bx(b, x1 - x0 + 0.004, H - 0.026, 0.002, (x0 + x1) / 2, ft + 0.013, fz, dark("#0e0f11", 0.8));
    const tray = mat(color === "white" ? "#d3d4d2" : "#2a2c2f", { roughness: 0.5 });
    const handle = mat(color === "white" ? "#b3b5b5" : "#3f4246", { roughness: 0.4 });
    const slot = dark("#0b0b0c", 1);
    const green = ledMat("#3fd27a");
    const blue = ledMat("#3fa8ff");
    for (let i = 0; i < n; i++) {
      const x = x0 + tw * (i + 0.5);
      bx(b, tw - 0.004, H - 0.04, 0.004, x, ft + 0.02, fz + 0.002, tray);
      bx(b, tw * 0.55, 0.012, 0.004, x, ft + 0.03, fz + 0.005, handle);
      for (let k = 0; k < 6; k++) bx(b, tw * 0.5, 0.0025, 0.001, x, ft + 0.07 + (k * (H - 0.14)) / 6, fz + 0.0045, slot);
      bx(b, 0.0035, 0.0035, 0.001, x - tw * 0.15, ft + H - 0.035, fz + 0.0045, green);
      bx(b, 0.0035, 0.0035, 0.001, x + tw * 0.15, ft + H - 0.035, fz + 0.0045, blue);
    }
    const sxm = w / 2 - strip / 2 - 0.002;
    zcyl(b, 0.008, 0.008, 0.004, sxm, ft + H - 0.035, fz + 0.002, handle, 16);
    ring(b, 0.0085, 0.0105, sxm, ft + H - 0.035, fz, blue, 16, 0.001);
    for (let k = 0; k < 3; k++) bx(b, 0.004, 0.004, 0.001, sxm, ft + H - 0.07 - k * 0.016, fz, green);
    bx(b, 0.012, 0.005, 0.001, sxm, ft + 0.04, fz, slot);
    for (const s of [-1, 1]) for (let k = 0; k < 7; k++) bx(b, 0.001, 0.003, d * 0.5, s * (w / 2 + 0.0002), ft + H * 0.3 + k * H * 0.06, 0, slot);
  },

  // ----- smart home -----
  smart_display: (b, w, d, h, f, color) => {
    // a fabric speaker base, the screen leaning back on it: a bezel with a camera, the screen
    const bh = h * 0.36;
    rb(b, w * 0.86, bh, d * 0.78, 0, 0, -d * 0.1, f, Math.min(bh * 0.45, 0.025), 2);
    const lean = -0.32;
    const pz = d / 2 - 0.012;
    const py = h * 0.06;
    const ph = (h - py - 0.004) / Math.cos(lean);
    const bezel = mat(color === "anthracite" ? "#232427" : "#f1f0ec", { roughness: 0.4 });
    tiltX(rb(b, w, ph, 0.01, 0, py, pz - 0.005, bezel, 0.006), py, pz, lean);
    tiltX(b.add(new THREE.PlaneGeometry(w * 0.88, ph * 0.84), screenMat(), 0, py + ph * 0.53, pz + 0.0003), py, pz, lean);
    tiltX(b.add(new THREE.CircleGeometry(0.0022, 8), dark("#0a0a0b", 0.2), 0, py + ph * 0.975, pz + 0.0003), py, pz, lean);
  },
  siren: (b, w, d, h, f) => {
    // a wall siren: a back plate, a rounded housing with horn slots, a strobe lens across the top
    const pt = 0.012;
    const zb = back(d);
    rb(b, w, h, pt, 0, 0, zb + pt / 2, f, 0.012);
    const hd = Math.max(0.02, d - pt - 0.02);
    rb(b, w * 0.9, h * 0.9, hd, 0, h * 0.05, zb + pt + hd / 2 - 0.004, f, Math.min(0.02, hd * 0.4), 2);
    const fz = zb + pt + hd - 0.004;
    const slot = dark("#1b1c1f", 0.8);
    for (let i = 0; i < 6; i++) bx(b, w * 0.62, h * 0.028, 0.004, 0, h * (0.12 + i * 0.058), fz - 0.001, slot);
    const ld = d / 2 - fz + 0.012;
    const strobe = part(mat("#ff4a3a", { emissive: "#ff2a1f", emissiveIntensity: 0.5, roughness: 0.25, transparent: true, opacity: 0.92, name: "led" }), "led");
    rb(b, w * 0.74, h * 0.24, ld, 0, h * 0.6, fz - 0.012 + ld / 2, strobe, Math.min(0.01, ld * 0.45), 2);
    rb(b, w * 0.78, h * 0.28, 0.006, 0, h * 0.58, fz - 0.002, dark("#3a3c40", 0.5), 0.006);
    bx(b, 0.005, 0.005, 0.002, -w * 0.3, h * 0.5, fz, ledMat("#3fd27a"));
  },
  air_quality_monitor: (b, w, d, h, f) => {
    // a small upright block: a dark display with the reading, a colour bar for the air, vents below
    rb(b, w, h, d, 0, 0, 0, f, Math.min(0.014, w * 0.15), 2);
    const fz = d / 2;
    const dw = w * 0.76;
    const dh = h * 0.36;
    const dy = h * 0.5;
    bx(b, dw, dh, 0.002, 0, dy, fz - 0.0005, mat("#0b0c0e", { roughness: 0.15 }));
    bx(b, dw * 0.9, dh * 0.86, 0.001, 0, dy + dh * 0.07, fz + 0.0008, screenMat());
    const txt = litText("#e8f4ff");
    const ch = dh * 0.42;
    digits(b, "412", -dw * 0.36, dy + dh * 0.35, fz + 0.0016, ch, txt);
    bx(b, dw * 0.3, dh * 0.07, 0.0008, -dw * 0.2, dy + dh * 0.16, fz + 0.0016, litText("#8fb8cc"));
    bx(b, dw * 0.66, h * 0.022, 0.002, 0, h * 0.38, fz - 0.0003, ledMat("#3fd27a"));
    const vent = dark("#3b3d40", 0.9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) bx(b, w * 0.045, w * 0.045, 0.001, (c - 2.5) * w * 0.11, h * (0.1 + r * 0.06), fz, vent);
  },
  wall_switch: (b, w, d, h, f, color) => {
    // a frame on the wall, 1–3 rockers side by side in its middle, each a standard module
    // (71 mm apart) with a small light; they shrink only when the plate is too small for them
    const g = gangs(b);
    const pd = d * 0.55;
    const zb = back(d);
    rb(b, w, h, pd, 0, 0, zb + pd / 2, f, Math.min(w, h) * 0.09);
    const k = moduleScale(w, h, g);
    const pitch = MODULE * k;
    const win = 0.056 * k;
    const gap = 0.0018 * k;
    const rw = win - 2 * gap;
    const inset = mat(insetColor(color), { roughness: 0.7 });
    const rd = d - pd - 0.0012;
    const led = ledMat("#ff9a2a");
    const y0 = h / 2 - win / 2;
    for (let i = 0; i < g; i++) {
      const x = (i - (g - 1) / 2) * pitch;
      bx(b, win, win, 0.0012, x, y0, zb + pd, inset);
      bx(b, rw, rw, rd, x, y0 + gap, zb + pd + 0.0006 + rd / 2, f, 0.05);
      bx(b, Math.min(0.006, rw * 0.3), 0.0016, 0.001, x, y0 + gap + rw * 0.12, zb + pd + 0.0006 + rd - rw * 0.38 * 0.05 + 0.0003, led, 0.05);
    }
  },
  wall_socket: (b, w, d, h, f, color) => {
    // a surface box with 1–3 round sockets side by side, each a standard module (71 mm apart)
    // with its two holes and earth clips; they shrink only when the box is too small for them
    const g = gangs(b);
    const zb = back(d);
    rb(b, w, h, d - 0.001, 0, 0, zb + (d - 0.001) / 2, f, Math.min(w, h) * 0.08);
    const fz = zb + d - 0.001 + 0.0004;
    const k = moduleScale(w, h, g);
    const pitch = MODULE * k;
    const r = 0.023 * k;
    const recess = mat(insetColor(color), { roughness: 0.6 });
    const hole = dark("#0a0a0b", 1);
    const shade = mat(color === "white" ? "#a9a9a4" : "#0b0b0c", { roughness: 0.6 });
    const clip = chrome();
    for (let i = 0; i < g; i++) {
      const x = (i - (g - 1) / 2) * pitch;
      ring(b, r, r * 1.08, x, h / 2, fz - 0.0003, shade, 16, 0.0006);
      dot(b, r, x, h / 2, fz, recess, 16);
      for (const s of [-1, 1]) bx(b, r * 0.2, r * 0.2, 0.0006, x + s * r * 0.4, h / 2 - r * 0.1, fz, hole);
      for (const s of [-1, 1]) bx(b, r * 0.3, r * 0.1, 0.0008, x, h / 2 + s * r * 0.88 - r * 0.05, fz, clip);
    }
  },

  // ----- games and pets -----
  arcade_cabinet: (b, w, d, h, f) => {
    // an upright cabinet: side panels with the classic profile, a kick panel with a coin door,
    // a control panel with a stick and buttons, the screen leaning back, a lit marquee on top
    const P = (z: number, y: number) => new THREE.Vector2(z * d, y * h);
    const profile = [P(-0.5, 0), P(0.22, 0), P(0.22, 0.5), P(0.5, 0.52), P(0.5, 0.555), P(0.2, 0.585), P(0.2, 0.6), P(-0.02, 0.84), P(0.17, 0.86), P(0.2, 0.975), P(0.17, 1), P(-0.3, 1), P(-0.5, 0.78)];
    const extrude = (pts: THREE.Vector2[], t: number, x: number, m: THREE.Material) => {
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: t, bevelEnabled: false }).rotateY(-Math.PI / 2);
      b.add(geo, m, x, 0, 0);
    };
    const st = Math.min(0.02, w * 0.04);
    for (const s of [-1, 1]) extrude(profile, st, s < 0 ? -w / 2 + st : w / 2, f);
    // the body between them, set back a little from the side panels' edges
    const inset = profile.map((p) => (p.x > -0.5 * d + 1e-6 ? new THREE.Vector2(p.x - 0.012, p.y) : p.clone()));
    extrude(inset, w - 2 * st, w / 2 - st, dark("#141416", 0.6));
    const iw = w - 2 * st;
    // kick panel: the coin door with its lit slots and return buttons
    const kz = 0.22 * d - 0.012;
    rb(b, iw * 0.42, h * 0.16, 0.012, 0, h * 0.2, kz + 0.006, dark("#2b2c2f", 0.35), 0.006);
    for (const sx of [-1, 1]) {
      bx(b, 0.018, 0.034, 0.004, sx * iw * 0.09, h * 0.29, kz + 0.013, rgb("#ff8a2a", 0.9));
      bx(b, 0.02, 0.012, 0.004, sx * iw * 0.09, h * 0.24, kz + 0.013, chrome());
    }
    // control panel: a plate on its slope, the stick and buttons
    const cz0 = 0.5 * d - 0.012;
    const cz1 = 0.2 * d - 0.012;
    const cy0 = 0.555 * h;
    const cy1 = 0.585 * h;
    const ca = Math.atan2(cy1 - cy0, cz0 - cz1);
    const cl = Math.hypot(cz0 - cz1, cy1 - cy0);
    bx(b, iw, 0.006, cl, 0, (cy0 + cy1) / 2 - 0.001, (cz0 + cz1) / 2, mat("#1f2a44", { roughness: 0.5 }), ca);
    const at = (u: number) => [cz0 - u * (cz0 - cz1), cy0 + 0.005 + u * (cy1 - cy0)] as const;
    const [jz, jy] = at(0.45);
    b.cyl(0.018, 0.018, 0.003, -iw * 0.24, jy, jz, dark("#0d0d0f", 0.5), 16);
    b.rod(v(-iw * 0.24, jy, jz), v(-iw * 0.24, jy + 0.06, jz), 0.005, chrome(), 8);
    b.sphere(0.02, -iw * 0.24, jy + 0.065, jz, mat("#c7282c", { roughness: 0.3 }), 1, 1, 1, 14);
    const colours = ["#d8342c", "#e8c23a", "#2f7fd8", "#3fae4f", "#e8e8e8", "#8a4fd8"];
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++) {
        const [z, y] = at(0.3 + r * 0.3);
        b.cyl(0.014, 0.014, 0.01, iw * (0.02 + c * 0.11) + r * 0.012, y - 0.003, z, mat(colours[r * 3 + c], { roughness: 0.35 }), 12);
      }
    for (const s of [-1, 1]) {
      const [z, y] = at(0.85);
      b.cyl(0.009, 0.009, 0.006, s * iw * 0.08, y - 0.002, z, mat("#f2f2f0", { roughness: 0.4 }), 10);
    }
    // the screen: a bezel and the tube leaning back
    const sz0 = 0.2 * d - 0.012;
    const sz1 = -0.02 * d - 0.012;
    const sy0 = 0.6 * h;
    const sy1 = 0.84 * h;
    const sl = Math.hypot(sz0 - sz1, sy1 - sy0);
    const sa = -Math.atan2(sz0 - sz1, sy1 - sy0);
    const scz = (sz0 + sz1) / 2;
    const scy = (sy0 + sy1) / 2;
    const nz = Math.cos(sa);
    const ny = -Math.sin(sa);
    bx(b, iw - 0.01, sl - 0.01, 0.004, 0, scy - (sl - 0.01) / 2 + ny * 0.002, scz + nz * 0.002, mat("#08090a", { roughness: 0.2 }), sa);
    bx(b, iw * 0.74, sl * 0.72, 0.002, 0, scy - (sl * 0.72) / 2 + ny * 0.0045, scz + nz * 0.0045, screenMat(), sa);
    // the marquee: a lit panel with stripes
    const mz0 = 0.17 * d - 0.012;
    const mz1 = 0.2 * d - 0.012;
    const my0 = 0.86 * h;
    const my1 = 0.975 * h;
    const ma = -Math.atan2(mz1 - mz0, my1 - my0);
    const ml = Math.hypot(mz1 - mz0, my1 - my0);
    const mcz = (mz0 + mz1) / 2;
    const mcy = (my0 + my1) / 2;
    const mn = [-Math.sin(ma), Math.cos(ma)] as const;
    const onM = (o: number) => [mcy + mn[0] * o, mcz + mn[1] * o] as const;
    const [m1y, m1z] = onM(0.003);
    bx(b, iw - 0.01, ml - 0.012, 0.006, 0, m1y - (ml - 0.012) / 2, m1z, rgb("#ffcf6b", 0.55), ma);
    const [m2y, m2z] = onM(0.0065);
    bx(b, iw * 0.7, ml * 0.12, 0.002, 0, m2y - ml * 0.26, m2z, rgb("#ff3da8", 0.9), ma);
    bx(b, iw * 0.5, ml * 0.1, 0.002, 0, m2y + ml * 0.08, m2z, rgb("#36c8ff", 0.9), ma);
    // levelling feet
    for (const sx of [-1, 1]) for (const z of [-0.5 * d + 0.06, 0.22 * d - 0.06]) b.cyl(0.02, 0.02, 0.006, sx * (w / 2 - 0.05), 0, z, dark("#141416", 0.9), 8);
  },
  pet_feeder: (b, w, d, h, f, color) => {
    // a food hopper with a window and a lid at the back, a steel bowl with kibble in front
    const bh = h * 0.18;
    rb(b, w, bh, d, 0, 0, 0, f, Math.min(0.025, bh * 0.4), 2);
    const hd = d * 0.56;
    const lidH = h * 0.08;
    const hz = back(d) + hd / 2;
    rb(b, w * 0.96, h - bh - lidH + 0.01, hd, 0, bh - 0.005, hz, f, 0.025, 2);
    const lid = mat(color === "black" ? "#8d9299" : "#3b3e43", { roughness: 0.35 });
    rb(b, w * 0.98, lidH, hd * 1.02, 0, h - lidH, hz, lid, Math.min(0.025, lidH * 0.45));
    const fz = back(d) + hd;
    const kibble = mat("#8a5a32", { roughness: 0.9 });
    rb(b, w * 0.4, h * 0.3, 0.003, 0, h * 0.45, fz, mat("#2c2e31", { roughness: 0.5 }), 0.008);
    bx(b, w * 0.34, h * 0.2, 0.002, 0, h * 0.46, fz + 0.002, kibble);
    bx(b, w * 0.36, h * 0.27, 0.002, 0, h * 0.465, fz + 0.0035, glass());
    // the chute above the bowl, a button with its light
    bx(b, w * 0.3, 0.03, 0.012, 0, bh + 0.01, fz + 0.004, dark("#121315", 0.8));
    zcyl(b, 0.008, 0.008, 0.004, w * 0.32, h * 0.82, fz + 0.002, lid, 12);
    bx(b, 0.005, 0.003, 0.001, w * 0.32, h * 0.86, fz, ledMat("#3fd27a"));
    // the bowl in the tray, kibble inside
    const br = Math.min(w * 0.42, (d - hd) * 0.46);
    const bz = fz + (d - hd) / 2;
    const bowlH = Math.min(0.035, h * 0.1);
    const bowl = mat("#c9ccd0", { metalness: 0.45, roughness: 0.3 });
    lathe(b, [[0, 0], [br * 0.7, 0], [br, bowlH]], bowl, 20, 0, bh - 0.004, bz);
    lathe(b, [[br * 0.995, bowlH], [br * 0.66, 0.004], [0, 0.004]], bowl, 20, 0, bh - 0.004, bz);
    b.cyl(br * 0.75, br * 0.66, 0.006, 0, bh, bz, kibble, 16);
    [0.3, 1.6, 2.4, 3.3, 4.6, 5.7].forEach((a, i) => {
      const rr = br * (0.25 + (i % 3) * 0.18);
      b.sphere(0.007, Math.cos(a) * rr, bh + 0.007, bz + Math.sin(a) * rr, kibble, 1, 0.7, 1, 4);
    });
  },
  pet_fountain: (b, w, d, h, f) => {
    // a round basin of water with the pump tower in its middle, water welling over its cap
    const R = Math.min(w, d) / 2;
    // one closed shell: the bottom (its edge sharp: a repeated point), up the outside, over the
    // rim and down the inside to a floor under the water (no hole showing the light from behind)
    lathe(b, [[0, 0], [R * 0.84, 0], [R * 0.84, 0], [R * 0.96, h * 0.12], [R, h * 0.38], [R * 0.99, h * 0.55], [R * 0.93, h * 0.58], [R * 0.93, h * 0.58], [R * 0.9, h * 0.5], [R * 0.84, h * 0.1], [R * 0.84, h * 0.1], [0, h * 0.1]], f, 40);
    const water = glowing(part(mat("#6fb8d8", { transparent: true, opacity: 0.75, roughness: 0.05 }), "water"));
    const wy = h * 0.52;
    b.add(new THREE.RingGeometry(R * 0.36, R * 0.92, 40).rotateX(-Math.PI / 2), water, 0, wy, 0);
    const tr = R * 0.36;
    const ty = h * 0.84;
    lathe(b, [[tr * 1.05, wy - 0.01], [tr, wy + 0.02], [tr * 0.82, ty - 0.02], [tr * 0.95, ty - 0.01], [tr, ty], [tr * 0.6, ty + 0.004]], f, 28);
    b.cyl(tr * 0.85, tr * 0.85, ty - wy, 0, wy, 0, water, 24, true);
    b.sphere(tr * 0.7, 0, ty, 0, water, 1, (h - ty) / (tr * 0.7), 1, 16);
    zcyl(b, 0.004, 0.004, 0.002, 0, h * 0.2, R * 0.99, ledMat("#3fa8ff"), 8);
  },
  litter_box: (b, w, d, h, f, color) => {
    // a self-cleaning globe on a base: a tinted hood, a round entrance with a lip, a landing
    // step in front, the waste drawer with its light below
    const base = mat(color === "anthracite" ? "#c9c9c6" : "#45484d", { roughness: 0.6 });
    const bh = h * 0.16;
    rb(b, w, bh, d, 0, 0, 0, base, 0.04, 2);
    // the globe follows the box: as wide and deep as the base (a little inside it) and as high
    // as there is room, drawn round and then stretched to that (not more than 1.3 : 1)
    let rx = w * 0.47;
    let rz = d * 0.46;
    let R = (h - bh * 0.6) / 2;
    R = Math.min(R, 1.3 * Math.min(rx, rz));
    rx = Math.min(rx, 1.3 * R);
    rz = Math.min(rz, 1.3 * R);
    const cy = bh * 0.6 + R;
    const cz = back(d) + rz + 0.005;
    const first = b.g.children.length;
    b.sphere(R, 0, cy, cz, f, 1, 1, 1, 28);
    const ha = 0.78;
    b.add(new THREE.SphereGeometry(R * 1.012, 28, 6, 0, Math.PI * 2, 0, ha), mat("#3a3d42", { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }), 0, cy, cz);
    ring3(b, R * Math.sin(ha) * 1.012, 0.007, cy + R * Math.cos(ha) * 1.012, cz, base);
    // the entrance
    const ea = 0.62;
    const tilt = 0.16; // looking a little down
    b.add(new THREE.SphereGeometry(R * 1.004, 24, 5, 0, Math.PI * 2, 0, ea).rotateX(Math.PI / 2 + tilt), dark("#141416", 0.9), 0, cy, cz);
    const rc = R * Math.cos(ea);
    b.add(new THREE.TorusGeometry(R * Math.sin(ea), 0.014, 6, 32).rotateX(tilt), base, 0, cy - Math.sin(tilt) * rc, cz + Math.cos(tilt) * rc);
    b.cyl(0.014, 0.014, 0.004, 0, cy + R * 0.952, cz + R * 0.33, dark("#232427", 0.4), 16).rotation.x = 0.35;
    for (const o of b.g.children.slice(first)) {
      o.position.x *= rx / R;
      o.position.z = cz + (o.position.z - cz) * (rz / R);
      o.scale.multiply(new THREE.Vector3(rx / R, 1, rz / R));
    }
    // the step and its mat
    const step = dark("#2a2b2e", 0.9);
    for (let i = 0; i < 5; i++) bx(b, w * 0.5, 0.004, 0.008, 0, bh, cz + rz * 0.55 + i * 0.022, step);
    // the drawer at the base front, its handle, a light; a button on top
    const fz = d / 2;
    bx(b, w * 0.6, bh * 0.55, 0.004, 0, bh * 0.22, fz, mat(color === "anthracite" ? "#b5b5b2" : "#3a3c40", { roughness: 0.5 }));
    bx(b, w * 0.2, 0.01, 0.006, 0, bh * 0.58, fz + 0.003, dark("#141416", 0.7));
    bx(b, w * 0.12, 0.004, 0.002, w * 0.38, bh * 0.6, fz - 0.0005, ledMat("#3fd27a"));
  },
};
