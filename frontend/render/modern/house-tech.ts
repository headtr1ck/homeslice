// Built-in pieces added later: house tech. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, back, glass, ledMat, mat, matrix, part, random, screenMat, tapGooseneck, v } from "../modern";
import type { Build, Builder } from "../modern";

// ----- small helpers (only called inside builders) -----

/** A box merged with others of its material (bottom centre at x, y, z, turned rx, ry, rz). */
function bx(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.batch(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), m, matrix(x, y, z, rx, ry, rz));
}
/** A box with its edges bevelled by r (one segment: light), merged; bottom centre at x, y, z. */
function soft(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0.004) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  b.batch(rr > 0.001 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d), m, matrix(x, y + h / 2, z));
}
/** A cylinder standing on (x, y, z), merged (r at its top, r1 at its foot). */
function cylY(b: Builder, r: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 12, r1 = r) {
  if (h <= 0) return;
  b.batch(new THREE.CylinderGeometry(r, r1, h, seg), m, matrix(x, y + h / 2, z));
}
/** A cylinder lying along x, centred on (x, y, z), merged. */
function cylX(b: Builder, r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 12) {
  if (len <= 0) return;
  b.batch(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2), m, matrix(x, y, z));
}
/** A cylinder lying along z, centred on (x, y, z), merged. */
function cylZ(b: Builder, r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 12) {
  if (len <= 0) return;
  b.batch(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), m, matrix(x, y, z));
}
function ball(b: Builder, r: number, x: number, y: number, z: number, m: THREE.Material, seg = 8) {
  b.batch(new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2)), m, matrix(x, y, z));
}
const turnTo = (a: THREE.Vector3, c: THREE.Vector3) =>
  new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), c.clone().sub(a).normalize()), v(1, 1, 1));
/** A round rod from a to c, merged. */
function rodB(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r: number, m: THREE.Material, seg = 8) {
  const len = a.distanceTo(c);
  if (len > 1e-5) b.batch(new THREE.CylinderGeometry(r, r, len, seg), m, turnTo(a, c));
}
/** A square bar of section sw × sd from a to c, merged. */
function beam(b: Builder, a: THREE.Vector3, c: THREE.Vector3, sw: number, sd: number, m: THREE.Material) {
  const len = a.distanceTo(c);
  if (len > 1e-5) b.batch(new THREE.BoxGeometry(sw, len, sd), m, turnTo(a, c));
}
/** A pipe through the points, a ball in each bend. */
function pipe(b: Builder, pts: THREE.Vector3[], r: number, m: THREE.Material, seg = 8) {
  for (let i = 0; i < pts.length - 1; i++) rodB(b, pts[i], pts[i + 1], r, m, seg);
  for (let i = 1; i < pts.length - 1; i++) ball(b, r, pts[i].x, pts[i].y, pts[i].z, m, seg);
}
/** A flat disc facing +z (or up), merged. */
function disc(b: Builder, r: number, x: number, y: number, z: number, m: THREE.Material, up = false, seg = 16) {
  const g = new THREE.CircleGeometry(r, seg);
  if (up) g.rotateX(-Math.PI / 2);
  b.batch(g, m, matrix(x, y, z));
}
/** A ring lying flat (axis y) at height y, merged. */
function ringY(b: Builder, r: number, tube: number, x: number, y: number, z: number, m: THREE.Material, seg = 24) {
  b.batch(new THREE.TorusGeometry(r, tube, 4, seg).rotateX(Math.PI / 2), m, matrix(x, y, z));
}

/**
 * A lathe whose sharp corners stay sharp (three averages a corner's normal with its long
 * neighbours otherwise): each corner is split into two points a hair apart.
 */
function lathe(pts: [number, number][], seg: number) {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0 || i === pts.length - 1) {
      out.push(p);
      continue;
    }
    const a = pts[i - 1];
    const c = pts[i + 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const lc = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const cos = ((p[0] - a[0]) * (c[0] - p[0]) + (p[1] - a[1]) * (c[1] - p[1])) / (la * lc || 1);
    if (cos > 0.8) {
      out.push(p);
      continue;
    }
    const e = Math.min(0.0004, la * 0.1, lc * 0.1);
    out.push([p[0] - ((p[0] - a[0]) / la) * e, p[1] - ((p[1] - a[1]) / la) * e], [p[0] + ((c[0] - p[0]) / lc) * e, p[1] + ((c[1] - p[1]) / lc) * e]);
  }
  return new THREE.LatheGeometry(
    out.map(([x, y]) => new THREE.Vector2(x, y)),
    seg,
  );
}
/** Points along an arc around (cx, cy) from angle a0 to a1. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, seg = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
/** A rectangle (counter-clockwise) with its bottom corners rounded by rb and its top ones by rt. */
function rrect(x0: number, y0: number, x1: number, y1: number, rb: number, rt = rb): [number, number][] {
  const lim = (r: number) => Math.max(0, Math.min(r, (x1 - x0) / 2 - 1e-4, (y1 - y0) / 2 - 1e-4));
  const [b0, t0] = [lim(rb), lim(rt)];
  const pt = (x: number, y: number): [number, number][] => [[x, y]];
  return [
    ...(b0 > 0 ? arc(x1 - b0, y0 + b0, b0, -Math.PI / 2, 0) : pt(x1, y0)),
    ...(t0 > 0 ? arc(x1 - t0, y1 - t0, t0, 0, Math.PI / 2) : pt(x1, y1)),
    ...(t0 > 0 ? arc(x0 + t0, y1 - t0, t0, Math.PI / 2, Math.PI) : pt(x0, y1)),
    ...(b0 > 0 ? arc(x0 + b0, y0 + b0, b0, Math.PI, (Math.PI * 3) / 2) : pt(x0, y0)),
  ];
}
const shapeOf = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
/** A front outline in (x, y) extruded from z0 forward by depth (its edges bevelled). */
function profileZ(pts: [number, number][], depth: number, z0: number, bevel = 0): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts), {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, z0 + bevel);
  return geo;
}
/** A side profile in (z, y) extruded across the width w along x, centred. */
function profileX(pts: [number, number][], w: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: w, bevelEnabled: false, curveSegments: 4 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(w / 2, 0, 0);
  return geo;
}

const metals = () => ({
  copper: mat("#b87333", { metalness: 0.6, roughness: 0.35 }),
  brass: mat("#c9a646", { metalness: 0.7, roughness: 0.3 }),
  steel: mat(C.steel, { metalness: 0.6, roughness: 0.35 }),
  chrome: mat(C.chrome, { metalness: 0.85, roughness: 0.2 }),
  dark: mat("#2b2c2e", { roughness: 0.7 }),
  rubber: mat("#1b1c1f", { roughness: 1 }),
});
const joint = () => mat("#26272a", { roughness: 1 });
const flame = () => part(mat("#ff8a3a", { emissive: "#ff5a1a", emissiveIntensity: 0.9 }), "fire");
/** Valve handle colours: heating flow and hot water, cold water and return, gas. */
const RED = "#c0392b";
const BLUE = "#2f6fb0";
const YELLOW = "#d9b43a";

/** A front cover sitting in its casing with a dark joint all round (wall boilers, ventilation units). */
function cover(b: Builder, w: number, h: number, y: number, zFront: number, f: THREE.Material) {
  bx(b, w - 0.012, h - 0.012, 0.004, 0, y + 0.006, zFront - 0.01, joint());
  b.box(w - 0.02, h - 0.02, 0.012, 0, y + 0.01, zFront - 0.006, f, 0.005);
}

/** A round dial (pressure gauge, thermometer) facing +z, turned ry about y. */
function dial(b: Builder, r: number, x: number, y: number, z: number, ry = 0) {
  const at = (dz: number) => matrix(x + Math.sin(ry) * dz, y, z + Math.cos(ry) * dz, 0, ry);
  b.batch(new THREE.CylinderGeometry(r, r, 0.016, 18).rotateX(Math.PI / 2), mat(C.chrome, { metalness: 0.85, roughness: 0.2 }), at(0));
  b.batch(new THREE.CircleGeometry(r * 0.82, 18), mat("#f4f3ef", { roughness: 0.4 }), at(0.0085));
  b.batch(new THREE.BoxGeometry(r * 0.08 + 0.001, r * 0.65, 0.001).translate(0, r * 0.25, 0).rotateZ(-0.7), mat(RED), at(0.009));
}

/** A drawer front (with its pull along the top), lying in front of z. */
function drawerFront(b: Builder, x: number, w: number, y: number, h: number, z: number, f: THREE.Material, pull: THREE.Material) {
  soft(b, w - 0.004, h - 0.004, 0.012, x, y + 0.002, z + 0.006, f, 0.003);
  bx(b, w - 0.03, Math.min(0.016, h * 0.25), 0.012, x, y + h - Math.min(0.03, h * 0.35), z + 0.016, pull);
}

/** A tilted panel (control panels, consoles): a slab turned about x by tilt, its face on top. */
function tilted(b: Builder, w: number, t: number, d: number, x: number, y: number, z: number, m: THREE.Material, tilt: number, r = 0) {
  const slab = b.box(w, t, d, x, y, z, m, r)!;
  slab.rotation.x = tilt;
  const n = v(0, Math.cos(tilt), Math.sin(tilt));
  /** A point on the face, moved along it by (dx, dz). */
  return (dx: number, dz: number, lift = 0) => slab.position.clone().addScaledVector(n, t / 2 + lift).add(v(dx, -Math.sin(tilt) * dz, Math.cos(tilt) * dz));
}
/** A part lying on a tilted face (from tilted). */
function onFace(b: Builder, geo: THREE.BufferGeometry, m: THREE.Material, p: THREE.Vector3, tilt: number) {
  b.add(geo, m, p.x, p.y, p.z).rotation.x = tilt;
}

export const BUILDERS: Record<string, Build> = {
  // ----- heating -----
  boiler: (b, w, d, h, f) => {
    // a wall-hung condensing boiler: a casing with its front cover and the control strip
    // (display, buttons, pressure gauge), the white flue up out of the top and back into the
    // wall, the pipes with their valves underneath and the condensate drain
    const { copper, brass, steel } = metals();
    const z0 = back(d);
    const below = Math.min(0.16, h * 0.22);
    const fr = Math.min(0.05, w * 0.12, d * 0.2);
    const top = h - Math.max(2 * fr + 0.02, Math.min(0.12, h * 0.16));
    const ch = top - below;
    b.box(w, ch, d - 0.012, 0, below, -0.006, f, 0.025);
    cover(b, w, ch, below, d / 2, f);
    // the control strip at the foot of the cover
    const py = below + Math.min(0.075, ch * 0.13);
    const pw = Math.min(w * 0.8, 0.34);
    b.box(pw, 0.07, 0.006, 0, py - 0.035, d / 2 - 0.001, mat("#3a3d41", { roughness: 0.5 }), 0.003);
    bx(b, Math.min(0.08, pw * 0.3), 0.032, 0.004, -pw * 0.08, py - 0.016, d / 2 + 0.002, screenMat());
    for (let i = 0; i < 3; i++) cylZ(b, 0.006, 0.006, pw * 0.14 + i * 0.022, py, d / 2 + 0.003, mat("#9aa0a6", { roughness: 0.5 }), 10);
    bx(b, 0.008, 0.008, 0.004, pw * 0.14 + 3 * 0.022, py - 0.004, d / 2 + 0.002, ledMat());
    dial(b, 0.02, -pw * 0.36, py, d / 2 + 0.006);
    // the flue: a collar, up, an elbow and back into the wall with a rosette
    const white = mat("#ecebe7", { roughness: 0.55 });
    const ey = h - fr;
    cylY(b, fr * 1.25, 0.02, 0, top, 0, white, 24);
    cylY(b, fr, ey - top, 0, top, 0, white, 24);
    ball(b, fr, 0, ey, 0, white, 24);
    cylZ(b, fr, -z0, 0, ey, z0 / 2, white, 24);
    ringY(b, fr + 0.002, 0.004, 0, top + 0.02 + (ey - top - 0.02) * 0.5, 0, steel, 24);
    cylZ(b, fr * 1.5, 0.01, 0, ey, z0 + 0.005, white, 24);
    // the pipes underneath: heating flow, hot water, gas, cold water, heating return
    const cols = [RED, RED, YELLOW, BLUE, BLUE];
    const pz = z0 + d * 0.42;
    const gas = mat("#c9a646", { metalness: 0.5, roughness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * Math.min(0.075, w * 0.16);
      pipe(b, [v(x, below + 0.005, pz), v(x, 0.03, pz), v(x, 0.03, z0)], 0.009, i === 2 ? gas : copper);
      cylY(b, 0.016, 0.035, x, below - 0.065, pz, brass, 10);
      bx(b, 0.012, 0.01, 0.05, x, below - 0.05, pz + 0.025, mat(cols[i], { roughness: 0.5 }));
    }
    // the condensate drain (grey plastic) at the side
    pipe(b, [v(w * 0.4, below + 0.005, z0 + d * 0.3), v(w * 0.4, 0.012, z0 + d * 0.3)], 0.011, mat("#8e9398", { roughness: 0.6 }));
  },

  boiler_floor: (b, w, d, h, f, color) => {
    const { copper, brass, steel, dark, rubber } = metals();
    const pellet = b.options.fuel === "pellet";
    const z0 = back(d);
    const fr = Math.min(0.075, w * 0.11, d * 0.09);
    const flue = mat("#55585d", { metalness: 0.5, roughness: 0.45 });
    const ctrl = mat("#33363a", { roughness: 0.5 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylY(b, 0.02, 0.03, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.08), rubber, 10);
    if (!pellet) {
      // an oil boiler: a cabinet with a bay low in its front where the burner sits on the
      // cast boiler door (a sight glass above it), oil hoses to a filter; the control panel
      // up top, the flue and the heating pipes rising from its back
      const cabH = h - Math.max(0.18, h * 0.17);
      const bayD = Math.min(0.24, d * 0.3);
      const bayBot = 0.1;
      const bayTop = 0.03 + (cabH - 0.03) * 0.5;
      const fz = d / 2 - bayD;
      soft(b, w, cabH - 0.03, d - bayD, 0, 0.03, z0 + (d - bayD) / 2, f, 0.01);
      soft(b, w, cabH - bayTop, bayD, 0, bayTop, fz + bayD / 2, f, 0.01);
      soft(b, w, bayBot - 0.03, bayD, 0, 0.03, fz + bayD / 2, f, 0.006);
      for (const sx of [-1, 1]) soft(b, 0.035, bayTop - bayBot, bayD, sx * (w / 2 - 0.0175), bayBot, fz + bayD / 2, f, 0.004);
      bx(b, w - 0.07, bayTop - bayBot, 0.004, 0, bayBot, fz + 0.002, mat("#1e1f22", { roughness: 1 }));
      // the boiler door, its hinges and the sight glass
      const bh = bayTop - bayBot;
      const iron = mat("#4a4d52", { metalness: 0.4, roughness: 0.55 });
      const dw = Math.min(0.4, w * 0.6);
      soft(b, dw, bh * 0.84, 0.04, 0, bayBot + bh * 0.08, fz + 0.024, iron, 0.012);
      for (const y of [0.25, 0.7]) cylY(b, 0.012, 0.04, -dw / 2 - 0.005, bayBot + bh * y, fz + 0.04, steel, 8);
      const sg = bayBot + bh * 0.8;
      cylZ(b, 0.022, 0.012, dw * 0.25, sg, fz + 0.048, steel, 14);
      disc(b, 0.015, dw * 0.25, sg, fz + 0.0545, mat("#2a1d18", { roughness: 0.3 }), false, 14);
      disc(b, 0.012, dw * 0.25, sg, fz + 0.0555, flame(), false, 14);
      // the burner: blast tube, housing, motor with its fan cover, the air intake
      const burnerM = color === "red" ? mat("#3a3d41", { roughness: 0.45 }) : mat("#b8322a", { roughness: 0.45 });
      const bw = Math.min(0.24, w * 0.36);
      const bH = Math.min(0.2, bh * 0.5);
      const bd = bayD - 0.07;
      const by = bayBot + bh * 0.18;
      const bz = fz + 0.065;
      cylZ(b, 0.045, 0.04, 0, by + bH * 0.5, fz + 0.064, steel, 16);
      soft(b, bw, bH, bd, 0, by, bz + bd / 2, burnerM, 0.025);
      cylX(b, bH * 0.3, 0.1, bw / 2 + 0.045, by + bH * 0.45, bz + bd * 0.45, mat("#3a3d41", { roughness: 0.5 }), 16);
      cylX(b, bH * 0.33, 0.02, bw / 2 + 0.1, by + bH * 0.45, bz + bd * 0.45, dark, 16);
      disc(b, bH * 0.25, 0, by + bH * 0.55, bz + bd + 0.0005, mat("#222326", { roughness: 0.9 }), false, 16);
      bx(b, bw * 0.4, 0.01, 0.004, 0, by + bH * 0.15, bz + bd - 0.001, mat("#9aa0a6"));
      // the oil hoses to the filter on the left cheek
      const fx = -w / 2 + 0.07;
      const fy = bayBot + bh * 0.25;
      cylY(b, 0.025, 0.06, fx, fy, fz + 0.1, mat("#d8dde0", { transparent: true, opacity: 0.55, roughness: 0.1 }), 14);
      cylY(b, 0.028, 0.025, fx, fy + 0.06, fz + 0.1, brass, 14);
      for (const k of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([v(-bw / 2 + 0.02, by + 0.02, bz + 0.04 + k * 0.02), v(-bw / 2 - 0.03, by - 0.02, bz + 0.05 + k * 0.02), v(fx + 0.03, fy + 0.07, fz + 0.1 + k * 0.012)]);
        b.batch(new THREE.TubeGeometry(curve, 8, 0.006, 6), rubber);
      }
      // the control panel up top: display, dials, switches, a thermometer, a status light
      const py = cabH - Math.min(0.15, (cabH - bayTop) * 0.4);
      const pz = d / 2;
      bx(b, w * 0.86, 0.1, 0.006, 0, py, pz - 0.002, ctrl);
      bx(b, 0.09, 0.04, 0.004, -w * 0.24, py + 0.035, pz + 0.002, screenMat());
      for (let i = 0; i < 3; i++) cylZ(b, 0.018, 0.02, w * (-0.05 + i * 0.12), py + 0.05, pz + 0.009, mat("#d9dadc", { roughness: 0.4 }), 12);
      for (let i = 0; i < 3; i++) bx(b, 0.016, 0.022, 0.006, -w * 0.36 + i * 0.03, py + 0.02, pz + 0.002, mat(i === 0 ? RED : "#2f3134", { roughness: 0.5 }));
      dial(b, 0.022, w * 0.32, py + 0.05, pz + 0.006);
      bx(b, 0.01, 0.01, 0.004, w * 0.32, py + 0.012, pz + 0.002, ledMat());
      // a seam across the cabinet front and the grip of its upper door
      bx(b, w - 0.01, 0.004, 0.004, 0, py - 0.03, pz - 0.001, joint());
      bx(b, w * 0.3, 0.012, 0.006, 0, bayTop + 0.04, pz - 0.001, joint());
      // the flue out of the back of the top, the pipes with their valves and a gauge
      const fz2 = z0 + fr + 0.03;
      cylY(b, fr + 0.015, 0.03, 0, cabH, fz2, flue, 20);
      cylY(b, fr, h - cabH, 0, cabH, fz2, flue, 20);
      ringY(b, fr + 0.002, 0.005, 0, cabH + (h - cabH) * 0.6, fz2, steel, 20);
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.08);
        pipe(b, [v(x, cabH - 0.01, z0 + 0.06), v(x, h - 0.02, z0 + 0.06), v(x, h - 0.02, z0)], 0.014, copper);
        cylY(b, 0.02, 0.04, x, cabH + 0.04, z0 + 0.06, brass, 10);
        bx(b, 0.012, 0.012, 0.06, x, cabH + 0.055, z0 + 0.09, mat(sx < 0 ? BLUE : RED, { roughness: 0.5 }));
      }
      dial(b, 0.025, w / 2 - 0.08, h - 0.08, z0 + 0.085);
      return;
    }
    // a pellet boiler: the boiler body with its control panel, combustion door with a sight
    // glass, ash door; the pellet hopper on top behind the panel with its lid and a level
    // window; the flue rising from the back
    const bodyH = h * 0.6;
    const bz0 = z0 + 2 * fr + 0.03;
    const bd = d / 2 - bz0;
    const bzc = bz0 + bd / 2;
    soft(b, w, bodyH - 0.03, bd, 0, 0.03, bzc, f, 0.015);
    const dw = w * 0.72;
    const dH = (bodyH - 0.16) * 0.55;
    const dy = bodyH - 0.05 - dH;
    const doorM = mat("#3a3d41", { metalness: 0.3, roughness: 0.5 });
    soft(b, dw, dH, 0.025, 0, dy, d / 2 - 0.005, doorM, 0.008);
    soft(b, dw, dy - 0.1, 0.025, 0, 0.08, d / 2 - 0.005, doorM, 0.008);
    disc(b, 0.04, -dw * 0.12, dy + dH * 0.5, d / 2 + 0.0081, mat("#2a1d18", { roughness: 0.2 }), false, 20);
    disc(b, 0.034, -dw * 0.12, dy + dH * 0.5, d / 2 + 0.009, flame(), false, 20);
    b.add(new THREE.TorusGeometry(0.042, 0.006, 6, 20), steel, -dw * 0.12, dy + dH * 0.5, d / 2 + 0.008);
    for (const [y, len] of [
      [dy + dH * 0.5, 0.12],
      [0.08 + (dy - 0.1) * 0.5, 0.09],
    ] as const) {
      cylZ(b, 0.012, 0.03, dw * 0.38, y, d / 2 + 0.02, steel, 10);
      bx(b, 0.02, len, 0.014, dw * 0.38, y - len * 0.8, d / 2 + 0.03, steel);
    }
    // the control panel, tilted, along the front of the top
    const tilt = 0.6;
    const pd = Math.min(0.16, bd * 0.3);
    const at = tilted(b, w - 0.02, 0.05, pd, 0, bodyH - 0.035, d / 2 - pd / 2 - 0.01, ctrl, tilt, 0.01);
    onFace(b, new THREE.BoxGeometry(0.11, 0.004, pd * 0.5), screenMat(), at(-w * 0.15, 0), tilt);
    for (let i = 0; i < 3; i++) onFace(b, new THREE.CylinderGeometry(0.012, 0.012, 0.008, 12), mat("#d9dadc", { roughness: 0.4 }), at(w * 0.08 + i * 0.04, 0), tilt);
    onFace(b, new THREE.BoxGeometry(0.01, 0.004, 0.01), ledMat(), at(w * 0.36, 0), tilt);
    // the hopper on the top behind the panel: a lid with a grip, a level window
    const hz0 = bz0 + 0.01;
    const hz1 = d / 2 - pd - 0.04;
    const hH = h - bodyH - 0.035;
    const hd = hz1 - hz0;
    b.add(
      profileX(
        [
          [hz0, bodyH - 0.01],
          [hz1, bodyH - 0.01],
          [hz1, bodyH + hH],
          [hz0, bodyH + hH],
        ],
        w - 0.02,
      ),
      f,
    );
    soft(b, w, 0.035, hd + 0.03, 0, h - 0.035, hz0 + hd / 2 + 0.01, f, 0.012);
    bx(b, w - 0.03, 0.004, hd + 0.01, 0, h - 0.037, hz0 + hd / 2 + 0.005, joint());
    bx(b, w * 0.3, 0.014, 0.02, 0, h - 0.03, hz1 + 0.03, ctrl);
    bx(b, 0.05, hH * 0.6, 0.004, w * 0.3, bodyH + hH * 0.2, hz1 + 0.001, mat("#2a2b2e", { roughness: 0.2 }));
    bx(b, 0.038, hH * 0.32, 0.004, w * 0.3, bodyH + hH * 0.22, hz1 + 0.002, mat("#8a6a45", { roughness: 1 }));
    // the flue: out of the body's back, up past the hopper, a clean-out cap below the bend
    const fx = w / 2 - fr - 0.04;
    const fz = z0 + fr + 0.01;
    const fy = bodyH * 0.6;
    cylZ(b, fr * 0.85, bz0 - fz, fx, fy, (fz + bz0) / 2, flue, 20);
    cylY(b, fr, h - fy + fr * 0.3, fx, fy - fr * 0.3, fz, flue, 20);
    cylY(b, fr + 0.01, 0.03, fx, fy - fr * 0.3 - 0.03, fz, flue, 20);
    ringY(b, fr + 0.002, 0.005, fx, h - 0.12, fz, steel, 24);
    // the heating pipes from the back of the body
    for (const [k, c] of [
      [0, RED],
      [1, BLUE],
    ] as const) {
      const x = -w / 2 + 0.1 + k * 0.08;
      pipe(b, [v(x, bodyH * 0.85, bz0), v(x, bodyH * 0.85, z0 + 0.05), v(x, 0.05, z0 + 0.05)], 0.014, copper);
      cylY(b, 0.02, 0.04, x, bodyH * 0.5, z0 + 0.05, brass, 10);
      bx(b, 0.012, 0.012, 0.05, x, bodyH * 0.5 + 0.015, z0 + 0.075, mat(c, { roughness: 0.5 }));
    }
  },

  ufh_manifold: (b, w, d, h, f, color) => {
    // an underfloor heating manifold: the flow bar with a flow meter on each circuit, the
    // return bar with a valve actuator on each, both on wall brackets; ball valves and the
    // supply pipes at the left, end pieces with air vents at the right; the circuits' pipes
    // run down to the floor
    const { brass, copper } = metals();
    const barM = color === "white" ? brass : mat("#c3c7cc", { metalness: 0.75, roughness: 0.25 });
    const z0 = back(d);
    const rb = Math.min(0.016, h * 0.035, d * 0.11);
    const zR = z0 + Math.min(0.045, d * 0.32);
    const zF = zR + Math.min(0.04, d * 0.28);
    const yR = h * 0.36;
    const yF = h * 0.62;
    const xa = -w / 2 + 0.07;
    const xb = w / 2 - 0.03;
    const bars: [number, number][] = [
      [yF, zF],
      [yR, zR],
    ];
    for (const [y, z] of bars) {
      cylX(b, rb, xb - xa, (xa + xb) / 2, y, z, barM, 16);
      cylX(b, rb * 1.15, 0.02, xb + 0.01, y, z, barM, 6);
      cylY(b, 0.006, 0.025, xb + 0.008, y + rb, z, brass, 8);
      cylY(b, 0.009, 0.006, xb + 0.008, y + rb + 0.025, z, mat(RED, { roughness: 0.5 }), 10);
    }
    // brackets: a plate on the wall, arms to the bars and clamps round them
    for (const x of [xa + 0.015, xb - 0.015]) {
      bx(b, 0.03, yF - yR + 0.1, 0.004, x, yR - 0.05, z0 + 0.002, f);
      for (const [y, z] of bars) {
        bx(b, 0.026, 0.008, z - z0, x, y - rb - 0.008, (z0 + z) / 2, f);
        b.batch(new THREE.TorusGeometry(rb + 0.003, 0.004, 4, 16).rotateY(Math.PI / 2), f, matrix(x, y, z));
      }
    }
    // the circuits
    const span = xb - xa - 0.06;
    const n = Math.max(2, Math.floor(span / 0.05));
    const pitch = span / n;
    const pex = mat("#e7e3da", { roughness: 0.6 });
    const glassM = mat("#d8eef5", { transparent: true, opacity: 0.45, roughness: 0.1 });
    const fh = Math.max(0.03, Math.min(0.085, (h - yF - rb) * 0.85));
    const ah = Math.max(0.02, Math.min(0.05, (yF - yR - 2 * rb) * 0.6));
    for (let i = 0; i < n; i++) {
      const x = xa + 0.03 + pitch * (i + 0.25);
      // flow: a meter on top, a nut and the pipe below
      cylY(b, 0.011, 0.012, x, yF + rb - 0.002, zF, brass, 6);
      cylY(b, 0.008, fh * 0.6, x, yF + rb + 0.01, zF, glassM, 8);
      cylY(b, 0.004, fh * 0.3, x, yF + rb + 0.02, zF, mat("#e05a2a", { roughness: 0.5 }), 6);
      cylY(b, 0.01, fh * 0.3, x, yF + rb + 0.01 + fh * 0.6, zF, mat(RED, { roughness: 0.5 }), 8);
      cylY(b, 0.011, 0.016, x, yF - rb - 0.014, zF, brass, 6);
      cylY(b, 0.008, yF - rb - 0.014, x, 0, zF, pex, 6);
      // return: an actuator on top, a nut and the pipe below
      const xr = x + pitch / 2;
      cylY(b, 0.011, 0.012, xr, yR + rb - 0.002, zR, brass, 6);
      cylY(b, 0.013, ah, xr, yR + rb + 0.008, zR, mat("#f2f1ed", { roughness: 0.5 }), 10);
      cylY(b, 0.005, 0.004, xr, yR + rb + 0.008 + ah, zR, mat(BLUE, { roughness: 0.5 }), 6);
      cylY(b, 0.011, 0.016, xr, yR - rb - 0.014, zR, brass, 6);
      cylY(b, 0.008, yR - rb - 0.014, xr, 0, zR, pex, 6);
    }
    // ball valves at the left ends, a thermometer each, the supply pipes down to the floor
    for (const [[y, z], c] of [
      [bars[0], RED],
      [bars[1], BLUE],
    ] as const) {
      cylX(b, rb * 1.2, 0.04, xa - 0.02, y, z, brass, 6);
      bx(b, 0.035, 0.008, 0.012, xa - 0.035, y + rb * 1.2, z, mat(c, { roughness: 0.5 }));
      dial(b, 0.014, xa - 0.02, y, z + rb * 1.2 + 0.006);
      pipe(b, [v(xa - 0.04, y, z), v(-w / 2 + 0.018, y, z), v(-w / 2 + 0.018, 0, z)], 0.011, copper);
    }
  },

  ventilation_unit: (b, w, d, h, f) => {
    // a heat-recovery ventilation unit on the wall: the casing with its front cover, a small
    // display and status light, a grip at the foot, latches; four duct spigots on top with
    // colour bands and seals; the condensate drain with its trap underneath
    const { steel, rubber } = metals();
    const sr = Math.min(0.075, w / 10, d * 0.28);
    const sh = Math.min(0.12, h * 0.16);
    const y0 = Math.min(0.05, h * 0.07);
    const top = h - sh;
    const ch = top - y0;
    b.box(w, ch, d - 0.012, 0, y0, -0.006, f, 0.02);
    cover(b, w, ch, y0, d / 2, f);
    const py = top - Math.min(0.09, ch * 0.15);
    bx(b, 0.13, 0.05, 0.004, w / 2 - 0.12, py, d / 2 + 0.001, mat("#3a3d41", { roughness: 0.5 }));
    bx(b, 0.06, 0.03, 0.003, w / 2 - 0.14, py + 0.01, d / 2 + 0.003, screenMat());
    cylZ(b, 0.007, 0.004, w / 2 - 0.085, py + 0.032, d / 2 + 0.004, mat("#9aa0a6"), 10);
    bx(b, 0.008, 0.008, 0.003, w / 2 - 0.085, py + 0.008, d / 2 + 0.003, ledMat());
    bx(b, w * 0.4, 0.012, 0.004, 0, y0 + 0.03, d / 2 + 0.001, joint());
    for (const sx of [-1, 1]) for (const y of [0.3, 0.7]) bx(b, 0.006, 0.04, 0.03, sx * (w / 2 + 0.002), y0 + ch * y, d / 2 - 0.05, joint());
    // spigots: outdoor air, supply, extract, exhaust
    const cols = ["#4c8c4a", BLUE, YELLOW, "#7a5a3c"];
    const pitch = Math.max(2 * sr + 0.006, Math.min((w - 2 * sr - 0.04) / 3, 0.16));
    const galv = mat("#b6babf", { metalness: 0.55, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * pitch;
      cylY(b, sr + 0.006, 0.012, x, top, 0, mat("#5a5d61", { roughness: 0.6 }), 24);
      cylY(b, sr, sh - 0.018, x, top + 0.012, 0, galv, 24);
      cylY(b, sr + 0.0015, 0.016, x, top + 0.012 + (sh - 0.03) * 0.35, 0, mat(cols[i], { roughness: 0.5 }), 24);
      ringY(b, sr - 0.001, 0.006, x, h - 0.006, 0, rubber, 24);
      disc(b, sr * 0.9, x, h - 0.0055, 0, mat("#121314", { roughness: 1 }), true, 24);
    }
    // the condensate drain with its trap, a cable gland
    const grey = mat("#8e9398", { roughness: 0.6 });
    cylY(b, 0.012, y0, -w / 2 + 0.08, 0, 0.02, grey, 10);
    cylY(b, 0.02, 0.03, -w / 2 + 0.08, 0, 0.02, grey, 12);
    cylY(b, 0.01, 0.012, w / 2 - 0.06, y0 - 0.012, 0, steel, 10);
  },

  humidifier: (b, w, d, h, f) => {
    // a round humidifier: a base with its display and a light ring, the clear water tank,
    // a cap with the mist nozzle and a plume of mist (shown while it runs)
    const r = Math.min(w, d) / 2;
    const yb = h * 0.3;
    const yt = h * 0.68;
    const yc = h * 0.75;
    b.add(
      lathe(
        [
          [0.001, 0],
          [r * 0.85, 0],
          [r * 0.95, 0.012],
          [r, 0.04],
          [r, yb],
          [0.001, yb],
        ],
        36,
      ),
      f,
    );
    ringY(b, r * 0.99, 0.004, 0, yb - 0.004, 0, ledMat("#3f8fe0"), 36);
    bx(b, r * 0.5, 0.028, 0.006, 0, yb * 0.5, r - 0.002, screenMat());
    for (const sx of [-1, 1]) cylZ(b, 0.008, 0.008, sx * r * 0.42, yb * 0.5 + 0.014, r * 0.92, mat("#9aa0a6"), 10);
    // the tank and its water
    cylY(b, r * 0.96, yt - yb, 0, yb, 0, glass(), 36);
    cylY(b, r * 0.9, (yt - yb) * 0.65, 0, yb + 0.004, 0, part(mat("#7fc4e0", { transparent: true, opacity: 0.6, roughness: 0.1 }), "water"), 36);
    // the cap and the nozzle
    b.add(
      lathe(
        [
          [0.001, yt],
          [r * 0.97, yt],
          [r * 0.97, yt + (yc - yt) * 0.55],
          [r * 0.82, yc],
          [0.001, yc],
        ],
        36,
      ),
      f,
    );
    const nr = r * 0.28;
    cylY(b, nr, 0.02, r * 0.15, yc, 0, f, 20, nr * 1.2);
    disc(b, nr * 0.75, r * 0.15, yc + 0.0205, 0, mat("#16181b", { roughness: 1 }), true, 20);
    // the mist: puffs growing as they rise (a flame-like part: shown unlinked and while on)
    const mist = part(mat("#ffffff", { transparent: true, opacity: 0.35, roughness: 1, depthWrite: false, emissive: "#ffffff", emissiveIntensity: 0.35 }), "fire");
    const room = h - yc - 0.02;
    for (let i = 0; i < 4; i++) {
      const pr = Math.min(nr * (0.7 + i * 0.35), room * 0.4);
      const y = Math.min(yc + 0.02 + room * ((i + 0.5) / 4), h - pr * 0.7);
      b.add(new THREE.SphereGeometry(pr, 12, 8), mist, r * 0.15 + i * 0.006, y, i * 0.004).scale.set(1, 0.7, 1);
    }
  },

  buffer_tank: (b, w, d, h, f) => {
    // a buffer tank: an insulated jacket with a rounded shoulder, a top cover and a vent, a
    // plinth ring, the jacket's zip; pipe stubs with flanges and ball valves on the front,
    // thermometers and sensor pockets
    const { brass, steel, copper } = metals();
    const r = Math.min(w, d) / 2 - 0.07;
    const y0 = 0.04;
    const top = h - 0.06;
    const sh = Math.min(r * 0.35, 0.12);
    const H = top - y0;
    const pts: [number, number][] = [
      [0.001, 0],
      [r - 0.02, 0],
      [r, 0.025],
      [r, H - sh],
    ];
    for (let i = 1; i <= 5; i++) {
      const a = (i / 5) * (Math.PI / 2);
      pts.push([r - sh + Math.cos(a) * sh, H - sh + Math.sin(a) * sh]);
    }
    pts.push([0.001, H]);
    b.add(lathe(pts, 40), f, 0, y0, 0);
    const grey = mat("#5a5d61", { roughness: 0.6 });
    cylY(b, r * 0.9, y0, 0, 0, 0, grey, 32);
    cylY(b, (r - sh) * 0.9, 0.012, 0, top, 0, grey, 32);
    for (const y of [y0 + 0.12, top - sh - 0.08]) ringY(b, r + 0.001, 0.005, 0, y, 0, grey, 40);
    const za = -2.4;
    bx(b, 0.008, H - sh - 0.04, 0.006, Math.sin(za) * r, y0 + 0.03, Math.cos(za) * r, grey, 0, za);
    // on top: the vent and a connection rising and going back to the wall
    cylY(b, 0.012, 0.03, 0, top + 0.012, 0, brass, 10);
    cylY(b, 0.018, 0.012, 0, top + 0.042, 0, brass, 6);
    pipe(b, [v(r * 0.45, top - 0.01, 0), v(r * 0.45, h - 0.015, 0), v(r * 0.45, h - 0.015, -d / 2)], 0.014, copper);
    // pipe stubs on the front: high ones hot, low ones cool
    const stubs: [number, number, string][] = [
      [0.88, 0.32, RED],
      [0.7, -0.32, RED],
      [0.5, 0.32, RED],
      [0.3, -0.32, BLUE],
      [0.1, 0.32, BLUE],
    ];
    for (const [fy, fx, c] of stubs) {
      const x = fx * r;
      const y = y0 + 0.05 + (H - sh - 0.1) * fy;
      const zs = Math.sqrt(r * r - x * x);
      const ze = d / 2 - 0.02;
      cylZ(b, 0.045, 0.012, x, y, zs + 0.002, steel, 16);
      cylZ(b, 0.022, ze - zs, x, y, (zs + ze) / 2, steel, 12);
      ball(b, 0.032, x, y, zs + (ze - zs) * 0.5, brass, 12);
      bx(b, 0.014, 0.012, 0.07, x, y + 0.03, zs + (ze - zs) * 0.5 + 0.025, mat(c, { roughness: 0.5 }), 0, 0.5);
      cylZ(b, 0.028, 0.02, x, y, ze - 0.01, mat("#3a3d41"), 6);
    }
    // thermometers and sensor pockets on the left of the front
    const a = -0.75;
    for (const fy of [0.8, 0.25]) dial(b, 0.035, Math.sin(a) * (r + 0.008), y0 + (H - sh) * fy, Math.cos(a) * (r + 0.008), a);
    for (const fy of [0.6, 0.42]) b.batch(new THREE.CylinderGeometry(0.01, 0.01, 0.03, 8).rotateX(Math.PI / 2), brass, matrix(Math.sin(a) * (r + 0.012), y0 + (H - sh) * fy, Math.cos(a) * (r + 0.012), 0, a));
  },

  water_softener: (b, w, d, h, f) => {
    // a twin water softener: two resin vessels side by side at the back, a control head over
    // both with its display, hoses to the wall; the salt cabinet in front with its lid, the
    // brine line and the drain hose
    const { copper, rubber } = metals();
    const z0 = back(d);
    const vr = Math.min(w / 4 - 0.006, 0.1, d * 0.22);
    const vz = z0 + vr + 0.012;
    const headH = Math.min(0.13, h * 0.13);
    const vH = h - headH + 0.02;
    for (const sx of [-1, 1]) {
      const pts: [number, number][] = [
        [0.001, 0],
        [vr * 0.92, 0],
        [vr, 0.02],
        [vr, vH - vr * 0.5],
      ];
      for (let i = 1; i <= 4; i++) pts.push([Math.max(0.001, Math.cos((i / 4) * (Math.PI / 2)) * vr), vH - vr * 0.5 + Math.sin((i / 4) * (Math.PI / 2)) * vr * 0.5]);
      b.add(lathe(pts, 28), f, sx * (w / 4), 0, vz);
      ringY(b, vr + 0.001, 0.004, sx * (w / 4), vH * 0.15, vz, mat("#5a5d61"), 28);
    }
    // the control head across both
    b.box(w - 0.01, headH, 2 * vr + 0.01, 0, h - headH, vz, mat("#3a3d41", { roughness: 0.45 }), 0.02);
    bx(b, 0.07, 0.035, 0.004, -0.04, h - headH * 0.62, vz + vr + 0.006, screenMat());
    for (let i = 0; i < 2; i++) cylZ(b, 0.008, 0.006, 0.03 + i * 0.026, h - headH * 0.45, vz + vr + 0.007, mat("#9aa0a6"), 10);
    bx(b, 0.008, 0.008, 0.004, 0.08, h - headH * 0.45, vz + vr + 0.006, ledMat());
    // hoses in and out to the wall, the brine line into the cabinet, the drain hose
    for (const sx of [-1, 1]) cylZ(b, 0.014, vz - z0 - vr + 0.02, sx * w * 0.2, h - headH * 0.5, (z0 + vz - vr) / 2, copper, 10);
    const hs = h * 0.62;
    const sz0 = vz + vr + 0.008;
    const sd = d / 2 - sz0;
    pipe(b, [v(-w * 0.32, h - headH, vz + vr * 0.7), v(-w * 0.32, hs + 0.05, vz + vr * 0.7), v(-w * 0.32, hs + 0.05, sz0 + 0.04), v(-w * 0.32, hs + 0.03, sz0 + 0.04)], 0.005, mat("#e6e4de", { roughness: 0.6 }), 6);
    const curve = new THREE.CatmullRomCurve3([v(w / 2 - 0.012, h - headH * 0.5, vz), v(w / 2 - 0.004, h * 0.6, vz - vr * 0.6), v(w / 2 - 0.01, 0.1, z0 + 0.02), v(w / 2 - 0.03, 0.01, z0 + 0.01)]);
    b.batch(new THREE.TubeGeometry(curve, 12, 0.007, 6), rubber);
    // the salt cabinet with its lid, a grip and a dark foot
    b.box(w, hs, sd, 0, 0, sz0 + sd / 2, f, 0.02);
    b.box(w, 0.03, sd, 0, hs, sz0 + sd / 2, f, 0.012);
    bx(b, w - 0.012, 0.004, sd - 0.012, 0, hs - 0.002, sz0 + sd / 2, joint());
    bx(b, w * 0.45, 0.012, 0.006, 0, hs + 0.008, d / 2 - 0.001, joint());
    bx(b, w - 0.02, 0.04, 0.004, 0, 0, d / 2, mat("#2b2c2e", { roughness: 0.8 }));
  },

  utility_sink: (b, w, d, h, f, color) => {
    // a deep utility basin on a tube frame: rolled rim, drain and overflow, a slatted shelf
    // below, the trap, a tall tap on the back rim
    const { chrome } = metals();
    const legM = color === "silver" ? f : mat(C.steel, { metalness: 0.55, roughness: 0.4 });
    const bh = Math.min(0.36, h * 0.42);
    const yb = h - bh;
    const t = 0.022;
    const z0 = back(d);
    b.box(w, bh, t, 0, yb, z0 + t / 2, f, 0.008);
    b.box(w, bh, t, 0, yb, d / 2 - t / 2, f, 0.008);
    for (const sx of [-1, 1]) b.box(t, bh, d - 0.01, sx * (w / 2 - t / 2), yb, 0, f, 0.008);
    b.box(w - 0.01, t, d - 0.01, 0, yb, 0, f, 0.008);
    const rim = 0.034;
    for (const sz of [-1, 1]) b.box(w, 0.022, rim, 0, h - 0.022, sz * (d / 2 - rim / 2), f, 0.01);
    for (const sx of [-1, 1]) b.box(rim, 0.022, d - 0.002, sx * (w / 2 - rim / 2), h - 0.022, 0, f, 0.01);
    disc(b, 0.035, 0, yb + t + 0.0008, 0.02, mat(C.steel, { metalness: 0.7, roughness: 0.3 }), true, 20);
    disc(b, 0.024, 0, yb + t + 0.0012, 0.02, mat("#2b2c2e"), true, 16);
    bx(b, 0.05, 0.012, 0.002, 0, h - 0.07, z0 + t + 0.001, mat("#2b2c2e"));
    // the frame: square legs with feet, rails, a slatted shelf
    const s = 0.035;
    const lx = w / 2 - 0.035;
    const lz = d / 2 - 0.035;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        bx(b, s, yb - 0.012, s, sx * lx, 0.012, sz * lz, legM);
        cylY(b, 0.02, 0.012, sx * lx, 0, sz * lz, mat("#1b1c1f", { roughness: 1 }), 10);
      }
    for (const y of [0.15, yb - 0.04]) {
      for (const sx of [-1, 1]) bx(b, s * 0.7, s * 0.7, 2 * lz, sx * lx, y, 0, legM);
      for (const sz of [-1, 1]) bx(b, 2 * lx, s * 0.7, s * 0.7, 0, y, sz * lz, legM);
    }
    const slats = Math.max(3, Math.round((2 * lx - s) / 0.07));
    const sp = (2 * lx - s) / slats;
    for (let i = 0; i < slats; i++) bx(b, sp * 0.75, 0.012, 2 * lz - s * 0.7, -lx + s / 2 + sp * (i + 0.5), 0.15 + s * 0.7, 0, legM);
    // the trap under the drain, back to the wall
    const pvc = mat("#9aa0a6", { roughness: 0.6 });
    cylY(b, 0.02, 0.12, 0, yb - 0.12, 0.02, pvc, 12);
    cylY(b, 0.035, 0.09, 0, yb - 0.21, 0.02, pvc, 16);
    pipe(b, [v(0, yb - 0.13, 0.02), v(0, yb - 0.13, z0)], 0.018, pvc, 12);
    b.above(() => {
      tapGooseneck(b, 0, h, z0 + 0.03, chrome);
      b.sphere(0.0125, 0, h + 0.28, z0 + 0.21, chrome, 1, 1, 1, 10);
    });
  },

  // ----- kitchen -----
  air_fryer: (b, w, d, h, f, color) => {
    // an air fryer: a rounded body, the basket drawer in its lower front with a big handle
    // and a window, the control fascia above it (display, dial, touch icons), vents at the
    // back, feet
    const dark = joint();
    const trim = color === "black" ? mat("#55585d", { roughness: 0.4 }) : mat("#2f3134", { roughness: 0.45 });
    const z0 = back(d);
    const yf = 0.012;
    const yd = h * 0.6;
    const r = Math.min(0.06, w * 0.2, h * 0.2);
    const zb = d / 2 - 0.075;
    const zf = zb + 0.035;
    b.add(profileZ(rrect(-w / 2, yf, w / 2, h, r), zb - z0, z0, 0.014), f);
    b.add(profileZ(rrect(-w / 2, yd, w / 2, h, 0.004, r), 0.035, zb, 0.008), f);
    // the drawer: the joint above it, its face, the handle with its release button, a window
    bx(b, w - 0.03, 0.012, 0.004, 0, yd - 0.01, zb + 0.002, dark);
    b.add(profileZ(rrect(-w / 2 + 0.004, yf + 0.006, w / 2 - 0.004, yd - 0.006, r, 0.012), 0.035, zb, 0.008), f);
    const hw = Math.min(0.14, w * 0.45);
    const hy = yf + (yd - yf) * 0.25;
    b.box(hw, 0.045, 0.04, 0, hy, d / 2 - 0.02, trim, 0.015);
    b.box(hw * 0.7, 0.03, 0.03, 0, hy + 0.035, zf + 0.012, trim, 0.008);
    bx(b, 0.026, 0.005, 0.014, 0, hy + 0.045, d / 2 - 0.02, mat("#9aa0a6", { roughness: 0.4 }));
    b.add(new THREE.ShapeGeometry(shapeOf(rrect(-w * 0.22, 0, w * 0.22, (yd - yf) * 0.22, 0.012)), 3), mat("#1c1e21", { roughness: 0.1, metalness: 0.3 }), 0, yf + (yd - yf) * 0.66, zf + 0.0004);
    // the fascia: a black panel with the display, a dial and touch icons
    const fy = yd + (h - yd) * 0.45;
    const fh = (h - yd) * 0.22;
    b.add(new THREE.ShapeGeometry(shapeOf(rrect(-w * 0.3, -fh, w * 0.3, fh, 0.01)), 3), mat("#16181b", { roughness: 0.15 }), 0, fy, zf + 0.0004);
    bx(b, w * 0.18, fh * 0.8, 0.002, -w * 0.12, fy - fh * 0.4, zf + 0.001, screenMat());
    cylZ(b, Math.min(0.022, fh * 0.9), 0.016, w * 0.16, fy, zf + 0.008, trim, 18);
    for (let i = 0; i < 3; i++) disc(b, 0.004, w * 0.02 + i * 0.012, fy - fh * 0.5, zf + 0.0008, mat("#c9cdd1", { emissive: "#c9cdd1", emissiveIntensity: 0.3 }), false, 8);
    for (let i = 0; i < 6; i++) bx(b, w * 0.5, 0.008, 0.003, 0, h * 0.55 + i * Math.min(0.018, h * 0.05), z0 - 0.0005, dark);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylY(b, 0.012, yf, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.08), dark, 10);
  },

  food_processor: (b, w, d, h, f, color) => {
    // a cooking machine: the base with a tilted display panel and a dial with a light ring,
    // the steel jug with its handle on a seat, the lid with the measuring cup, locking arms
    const dark = mat("#3a3c40", { roughness: 0.5 });
    const jugM = mat("#d3d7db", { metalness: 0.45, roughness: 0.3 });
    const hb = h * 0.34;
    const r0 = Math.min(w, d) * 0.27;
    const jz = -d * 0.1;
    const lidH = Math.min(0.03, h * 0.09);
    const jh = h - hb - 0.012 - lidH - 0.012;
    b.box(w, hb, d - 0.012, 0, 0, -0.006, f, 0.035);
    // the display panel along the front of the top, tilted towards the cook
    const tilt = 0.45;
    const pd = Math.max(0.03, Math.min(0.08, d / 2 - (jz + r0) - 0.02));
    const at = tilted(b, w * 0.66, 0.012, pd, 0, hb - 0.008, d / 2 - pd / 2 - 0.014, dark, tilt, 0.005);
    onFace(b, new THREE.BoxGeometry(w * 0.3, 0.002, pd * 0.7), screenMat(), at(0, 0), tilt);
    // the dial on the front with its light ring
    const kr = Math.min(0.032, hb * 0.28);
    cylZ(b, kr, 0.02, 0, hb * 0.45, d / 2 - 0.012 + 0.006, dark, 24);
    b.add(new THREE.TorusGeometry(kr + 0.004, 0.0025, 4, 24), ledMat("#3fd27a"), 0, hb * 0.45, d / 2 - 0.012);
    // the seat and the jug, its handle on the right
    cylY(b, r0 * 0.95, 0.012, 0, hb, jz, dark, 28);
    b.add(
      lathe(
        [
          [0.001, 0],
          [r0 * 0.8, 0],
          [r0 * 0.84, jh * 0.08],
          [r0 * 0.93, jh * 0.6],
          [r0, jh],
          [0.001, jh],
        ],
        32,
      ),
      jugM,
      0,
      hb + 0.012,
      jz,
    );
    const handleM = color === "black" ? dark : mat("#e6e5e1", { roughness: 0.5 });
    b.add(new THREE.TorusGeometry(jh * 0.3, 0.013, 6, 12, Math.PI).rotateZ(-Math.PI / 2), handleM, r0 * 0.88, hb + 0.012 + jh * 0.55, jz);
    // the lid, the measuring cup
    cylY(b, r0 * 1.06, lidH, 0, hb + 0.012 + jh, jz, f, 32);
    cylY(b, r0 * 1.08, 0.006, 0, hb + 0.012 + jh, jz, dark, 32);
    cylY(b, r0 * 0.32, 0.012, 0, hb + 0.012 + jh + lidH, jz, mat("#a9adb2", { roughness: 0.3 }), 20);
    // the locking arms either side of the lid
    for (const sx of [-1, 1]) {
      const x = sx * (r0 * 1.08 + 0.01);
      bx(b, 0.016, jh + lidH * 0.6 + 0.012, 0.035, x, hb, jz, dark);
      bx(b, 0.026, 0.012, 0.035, x - sx * 0.006, hb + jh + lidH * 0.6, jz, dark);
    }
  },

  range_cooker: (b, w, d, h, f, _c, a) => {
    // a wide freestanding range cooker: a gas hob of five burners under cast grates, a low
    // upstand, the control fascia with knobs and a clock, two oven doors with windows under a
    // full-width handle rail, a storage drawer and a dark plinth. Accent: handles and knobs.
    const enamel = mat("#202124", { roughness: 0.4 });
    const iron = mat("#1b1c1f", { roughness: 0.6 });
    const z0 = back(d);
    const hp = Math.min(0.08, h * 0.09);
    const fz = d / 2 - 0.07;
    const hobY = h - 0.055;
    bx(b, w - 0.04, hp, d - 0.12, 0, 0, -0.04, mat("#1b1c1f", { roughness: 0.9 }));
    soft(b, w, hobY - hp, fz - z0, 0, hp, (z0 + fz) / 2, f, 0.01);
    // the hob plate with its front trim, the upstand
    soft(b, w, 0.01, fz - z0 + 0.022, 0, hobY - 0.002, (z0 + fz + 0.022) / 2, enamel, 0.003);
    bx(b, w - 0.01, 0.008, 0.006, 0, hobY - 0.006, fz + 0.022, a);
    soft(b, w, h - hobY, 0.03, 0, hobY, z0 + 0.015, f, 0.006);
    // five burners
    const pw = w - 0.08;
    const zc = (z0 + 0.03 + fz + 0.02) / 2;
    const pd = fz + 0.02 - (z0 + 0.03);
    const y = hobY + 0.008;
    const burners: [number, number, number][] = [
      [-0.36, -0.25, 0.04],
      [-0.36, 0.25, 0.033],
      [0, 0, 0.06],
      [0.36, -0.25, 0.033],
      [0.36, 0.25, 0.04],
    ];
    for (const [dx, dz, r] of burners) {
      const x = dx * pw;
      const z = zc + dz * pd;
      cylY(b, r * 1.45, 0.006, x, y, z, mat("#3a3c40", { metalness: 0.5, roughness: 0.4 }), 18);
      cylY(b, r, 0.012, x, y + 0.006, z, iron, 18, r * 1.06);
      cylY(b, r * 0.6, 0.006, x, y + 0.018, z, mat("#2b2c2f", { roughness: 0.35 }), 16);
    }
    // three cast grates: a frame each, bars across through the burners, feet
    const gy = y + 0.026;
    const g = 0.011;
    const gz0 = z0 + 0.04;
    const gz1 = fz + 0.01;
    for (const [x0, x1] of [
      [-pw / 2, -pw * 0.19],
      [-pw * 0.18, pw * 0.18],
      [pw * 0.19, pw / 2],
    ]) {
      const cx = (x0 + x1) / 2;
      for (const z of [gz0 + g / 2, gz1 - g / 2]) bx(b, x1 - x0, g, g, cx, gy, z, iron);
      for (const x of [x0 + g / 2, x1 - g / 2]) bx(b, g, g, gz1 - gz0, x, gy, (gz0 + gz1) / 2, iron);
      bx(b, x1 - x0, g, g, cx, gy, zc, iron);
      bx(b, g, g, gz1 - gz0, cx, gy, (gz0 + gz1) / 2, iron);
      for (const x of [x0 + g / 2, x1 - g / 2]) for (const z of [gz0 + g / 2, gz1 - g / 2]) bx(b, g, gy - y, g, x, y, z, iron);
    }
    // the fascia: eight knobs and the clock in the middle
    const fy0 = hobY - Math.min(0.1, h * 0.11);
    const ky = (fy0 + hobY) / 2;
    bx(b, w - 0.01, 0.004, 0.004, 0, fy0, fz + 0.001, joint());
    const kr = Math.min(0.021, w / 50);
    for (let i = 0; i < 9; i++) {
      const x = -w / 2 + (i + 0.5) * (w / 9);
      if (i === 4) {
        bx(b, Math.min(0.07, w / 11), 0.028, 0.006, x, ky - 0.014, fz + 0.002, mat("#16181b", { roughness: 0.15 }));
        bx(b, Math.min(0.05, w / 15), 0.016, 0.002, x, ky - 0.008, fz + 0.006, screenMat());
        continue;
      }
      disc(b, kr * 1.35, x, ky, fz + 0.0008, mat("#2b2c2e", { roughness: 0.5 }), false, 14);
      cylZ(b, kr, 0.024, x, ky, fz + 0.012, a, 14);
      bx(b, 0.005, kr * 1.4, 0.006, x, ky - kr * 0.7, fz + 0.025, a);
    }
    // the oven doors with their windows, the handle rail across both
    const yd0 = hp + Math.min(0.13, h * 0.15) + 0.006;
    const yd1 = fy0 - 0.008;
    const inner = w - 0.02;
    const lw = inner * 0.6 - 0.004;
    const rw = inner - lw - 0.008;
    const winM = mat("#1e2327", { roughness: 0.08, metalness: 0.3 });
    for (const [x, dw] of [
      [-w / 2 + 0.01 + lw / 2, lw],
      [w / 2 - 0.01 - rw / 2, rw],
    ]) {
      soft(b, dw, yd1 - yd0, 0.025, x, yd0, fz + 0.0125, f, 0.006);
      b.add(new THREE.ShapeGeometry(shapeOf(rrect(-dw * 0.36, 0, dw * 0.36, (yd1 - yd0) * 0.48, 0.02)), 3), winM, x, yd0 + (yd1 - yd0) * 0.14, fz + 0.0252);
    }
    const ry = yd1 - Math.min(0.055, (yd1 - yd0) * 0.15);
    const rz = fz + 0.055;
    cylX(b, 0.011, w - 0.06, 0, ry, rz, a, 14);
    for (const x of [-w / 2 + 0.05, -w / 2 + 0.01 + lw + 0.004, w / 2 - 0.05]) {
      cylZ(b, 0.007, 0.03, x, ry, rz - 0.015, a, 10);
      cylZ(b, 0.013, 0.006, x, ry, fz + 0.028, a, 12);
    }
    // the storage drawer and its handle
    soft(b, inner, yd0 - hp - 0.012, 0.025, 0, hp + 0.004, fz + 0.0125, f, 0.006);
    const dy = hp + (yd0 - hp) * 0.6;
    cylX(b, 0.008, Math.min(0.3, w * 0.35), 0, dy, fz + 0.045, a, 12);
    for (const sx of [-1, 1]) cylZ(b, 0.006, 0.02, sx * Math.min(0.13, w * 0.15), dy, fz + 0.035, a, 8);
  },

  // ----- bedroom, workshop, gym -----
  loft_bed: (b, w, d, h, f) => {
    // a loft bed: four posts, the frame with slats and a mattress up high, guard rails round
    // it with a gap where the ladder on the right side comes up, a headboard panel; a desk
    // with a drawer and a shelf of books underneath on the left
    const p = 0.06;
    const deckY = h - Math.min(0.42, h * 0.24);
    const fh = 0.13;
    const px = w / 2 - p / 2;
    const pz = d / 2 - p / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) soft(b, p, h, p, sx * px, 0, sz * pz, f, 0.006);
    for (const sx of [-1, 1]) soft(b, 0.025, fh, d - 2 * p, sx * (w / 2 - 0.0125), deckY - fh, 0, f, 0.004);
    for (const sz of [-1, 1]) soft(b, w - 2 * p, fh, 0.025, 0, deckY - fh, sz * (d / 2 - 0.0125), f, 0.004);
    const slats = Math.max(6, Math.round((d - 2 * p) / 0.12));
    const slatM = mat("#d8c19a", { roughness: 0.8 });
    for (let i = 0; i < slats; i++) bx(b, w - 0.05, 0.015, 0.06, 0, deckY - 0.06, -d / 2 + p + ((d - 2 * p) / slats) * (i + 0.5), slatM);
    const mw = w - 0.06;
    const md = d - 0.06;
    b.box(mw, 0.14, md, 0, deckY - 0.045, 0, mat(C.mattress), 0.03);
    b.box(mw + 0.004, 0.05, md * 0.62, 0, deckY + 0.085, md * 0.19, mat("#9fb3c4", { roughness: 1 }), 0.025);
    b.box(mw * 0.62, 0.09, 0.32, 0, deckY + 0.09, -d / 2 + 0.25, mat(C.pillow), 0.04);
    // guard rails: top and middle on both sides and the foot, a gap for the ladder; the headboard
    const rh = 0.06;
    const lz = d / 2 - p - 0.32;
    const gap = 0.24;
    for (const y of [h - rh, deckY + 0.13]) {
      bx(b, 0.025, rh, d - 2 * p, -px, y, 0, f);
      bx(b, 0.025, rh, lz - gap - (-d / 2 + p), px, y, (-d / 2 + p + lz - gap) / 2, f);
      bx(b, 0.025, rh, d / 2 - p - (lz + gap), px, y, (lz + gap + d / 2 - p) / 2, f);
      bx(b, w - 2 * p, rh, 0.025, 0, y, pz, f);
    }
    soft(b, w - 2 * p, h - deckY - 0.01, 0.022, 0, deckY, -pz, f, 0.004);
    // the ladder on the right side, its rails up to the guard top
    for (const sz of [-1, 1]) soft(b, 0.03, h - 0.02, 0.038, px + 0.004, 0, lz + sz * gap, f, 0.006);
    for (let y = 0.28; y < deckY - 0.1; y += 0.26) cylZ(b, 0.015, 2 * gap, px + 0.004, y, lz, f, 10);
    // the desk on the left: a top on a cleat at the back and a side panel, a drawer, a shelf
    const dd = Math.min(0.55, w - 2 * p - 0.1);
    const L = Math.min(1.2, d - 2 * p - 0.3);
    const dz0 = -d / 2 + p;
    const dy = Math.min(0.74, deckY - 0.55);
    const dx = -w / 2 + p / 2 + dd / 2;
    soft(b, dd, 0.025, L, dx, dy, dz0 + L / 2, f, 0.004);
    soft(b, dd - 0.02, dy, 0.022, dx, 0, dz0 + L - 0.011, f, 0.004);
    bx(b, dd - 0.06, 0.03, 0.02, dx, dy - 0.03, dz0 + 0.01, f);
    soft(b, dd * 0.8, 0.11, 0.4, dx, dy - 0.112, dz0 + L - 0.25, f, 0.004);
    bx(b, 0.012, 0.012, 0.12, dx + dd * 0.4 + 0.006, dy - 0.06, dz0 + L - 0.25, mat(C.black));
    const sy = Math.min(dy + 0.42, deckY - fh - 0.3);
    soft(b, 0.2, 0.02, L * 0.8, -w / 2 + p / 2 + 0.1, sy, dz0 + L * 0.45, f, 0.003);
    const rand = random(41);
    let z = dz0 + L * 0.1;
    while (z < dz0 + L * 0.45) {
      const bw = 0.025 + rand() * 0.02;
      bx(b, 0.15, Math.min(0.2, deckY - fh - sy - 0.04) * (0.8 + rand() * 0.2), bw, -w / 2 + p / 2 + 0.09, sy + 0.02, z + bw / 2, mat(C.book[Math.floor(rand() * C.book.length)]));
      z += bw + 0.003;
    }
  },

  tool_chest: (b, w, d, h, f) => {
    // a rolling tool chest: a cabinet of deep drawers on castors with a push handle at the
    // side, a top chest of slim drawers under a lid with a lock; full-width pulls
    const { steel, chrome, rubber } = metals();
    const pull = mat("#c4c8cc", { metalness: 0.7, roughness: 0.3 });
    const cw = w - 0.05;
    const cx = -0.025;
    const ch = Math.min(0.12, h * 0.13);
    const y1 = ch + (h - ch) * 0.58;
    const wr = (ch - 0.02) / 2;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = cx + sx * (cw / 2 - 0.06);
        const z = sz * (d / 2 - 0.06);
        bx(b, 0.07, 0.008, 0.07, x, ch - 0.008, z, steel);
        cylY(b, 0.012, 0.02, x, ch - 0.028, z, steel, 8);
        for (const k of [-1, 1]) bx(b, 0.005, wr + 0.012, 0.045, x + k * 0.02, wr, z, steel);
        cylX(b, wr, 0.032, x, wr, z, rubber, 16);
        cylX(b, wr * 0.4, 0.036, x, wr, z, steel, 10);
      }
    // the cabinet and its drawers
    const fz = d / 2 - 0.02;
    b.box(cw, y1 - ch, d - 0.02, cx, ch, -0.01, f, 0.008);
    bx(b, cw - 0.03, y1 - ch - 0.04, 0.002, cx, ch + 0.02, fz + 0.001, joint());
    let y = ch + 0.02;
    for (const k of [0.4, 0.22, 0.14, 0.12, 0.12]) {
      const dh = k * (y1 - ch - 0.04);
      drawerFront(b, cx, cw - 0.03, y, dh, fz, f, pull);
      y += dh;
    }
    // the top chest: drawers under a lid with its lock
    const y2 = y1 + 0.004;
    const lidH = Math.min(0.08, (h - y2) * 0.2);
    b.box(cw, h - y2 - lidH, d - 0.06, cx, y2, -0.03, f, 0.008);
    const tz = d / 2 - 0.06;
    bx(b, cw - 0.03, h - y2 - lidH - 0.03, 0.002, cx, y2 + 0.015, tz + 0.001, joint());
    y = y2 + 0.015;
    for (const k of [0.24, 0.2, 0.16, 0.14, 0.13, 0.13]) {
      const dh = k * (h - y2 - lidH - 0.03);
      drawerFront(b, cx, cw - 0.03, y, dh, tz, f, pull);
      y += dh;
    }
    b.box(cw + 0.006, lidH, d - 0.05, cx, h - lidH, -0.025, f, 0.012);
    bx(b, cw - 0.004, 0.004, d - 0.064, cx, h - lidH - 0.002, -0.03, joint());
    cylZ(b, 0.012, 0.012, cx, h - lidH * 0.5, d / 2 - 0.02, chrome, 14);
    // the cabinet's lock, the push handle on the right, vents in the side
    cylZ(b, 0.01, 0.01, cx + cw / 2 - 0.04, y1 - 0.012, fz + 0.005, chrome, 12);
    const hx = w / 2 - 0.016;
    const hy = y1 - 0.06;
    rodB(b, v(hx, hy, -d / 2 + 0.07), v(hx, hy, d / 2 - 0.07), 0.014, steel, 12);
    for (const sz of [-1, 1]) pipe(b, [v(cx + cw / 2, hy, sz * (d / 2 - 0.07)), v(hx, hy, sz * (d / 2 - 0.07))], 0.012, steel, 10);
    for (let i = 0; i < 5; i++) bx(b, 0.002, 0.008, d * 0.4, cx - cw / 2 - 0.0005, y1 + 0.05 + i * 0.02, 0, joint());
  },

  power_rack: (b, w, d, h, f) => {
    // a power rack: four punched uprights on floor rails, top beams and a pull-up bar, safety
    // arms along the sides, J-hooks holding a loaded barbell, a flat bench in the middle
    const { steel, chrome, rubber } = metals();
    const s = 0.075;
    const ux = Math.max(0.24, w / 2 - 0.2);
    const uz = Math.min(d / 2 - 0.12, d * 0.32);
    const k = Math.min(1, h / 2.2, w / 1.3);
    const yb = 0.062;
    for (const sx of [-1, 1]) {
      bx(b, s, 0.05, d, sx * ux, 0.012, 0, f);
      for (const sz of [-1, 1]) bx(b, s + 0.01, 0.012, 0.08, sx * ux, 0, sz * (d / 2 - 0.04), rubber);
    }
    bx(b, 2 * ux - s, 0.05, s, 0, 0.012, -uz, f);
    // uprights and their holes (front and outer faces)
    const hole = mat("#0d0e10", { roughness: 1 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * ux;
        const z = sz * uz;
        bx(b, s, h - s - yb, s, x, yb, z, f);
        for (let y = 0.25; y < h - s - 0.08; y += 0.0508) {
          b.batch(new THREE.PlaneGeometry(0.017, 0.026), hole, matrix(x, y, z + s / 2 + 0.0008));
          b.batch(new THREE.PlaneGeometry(0.017, 0.026), hole, matrix(x + sx * (s / 2 + 0.0008), y, z, 0, (sx * Math.PI) / 2));
        }
      }
    // top beams, cross members, the pull-up bar on brackets with its grips
    for (const sx of [-1, 1]) bx(b, s, s, 2 * uz + s, sx * ux, h - s, 0, f);
    for (const sz of [-1, 1]) bx(b, 2 * ux - s, s, s * 0.9, 0, h - s, sz * uz, f);
    const pzz = uz + s / 2 + 0.12;
    for (const sx of [-1, 1]) bx(b, s * 0.8, s * 0.8, 0.14, sx * ux, h - s * 1.9, uz + s / 2 + 0.07, f);
    cylX(b, 0.016, 2 * ux + s, 0, h - s * 1.5, pzz, steel, 14);
    for (const sx of [-1, 1]) cylX(b, 0.0175, 0.2, sx * (ux - 0.15), h - s * 1.5, pzz, mat("#5a5d61", { metalness: 0.5, roughness: 0.6 }), 14);
    // the barbell on J-hooks, its sleeves, plates and collars
    const barY = Math.max(0.24 * k + 0.1, h * 0.6);
    const bz = uz + s / 2 + 0.035;
    const hookM = mat("#2a2b2e", { roughness: 0.6 });
    for (const sx of [-1, 1]) {
      bx(b, s * 0.9, 0.08, 0.06, sx * ux, barY - 0.094, uz + s / 2 + 0.03, hookM);
      bx(b, s * 0.9, 0.05, 0.012, sx * ux, barY - 0.04, uz + s / 2 + 0.066, hookM);
    }
    cylX(b, 0.014, 2 * (ux + s / 2 + 0.01), 0, barY, bz, steel, 12);
    for (const sx of [-1, 1]) {
      const x0 = ux + s / 2 + 0.01;
      cylX(b, 0.025, w / 2 - x0, sx * (x0 + (w / 2 - x0) / 2), barY, bz, chrome, 14);
      cylX(b, 0.03, 0.01, sx * (x0 + 0.005), barY, bz, steel, 14);
      let x = x0 + 0.02;
      for (const pr of [0.225 * k, 0.19 * k]) {
        cylX(b, pr, 0.05, sx * (x + 0.025), barY, bz, rubber, 32);
        cylX(b, 0.04, 0.052, sx * (x + 0.025), barY, bz, steel, 16);
        x += 0.052;
      }
      cylX(b, 0.035, 0.025, sx * (x + 0.0125), barY, bz, mat("#3a3d41", { roughness: 0.5 }), 14);
    }
    // safety arms along the inside with their pins
    const safY = Math.max(0.3, barY - 0.5 * k);
    for (const sx of [-1, 1]) {
      bx(b, 0.05, 0.05, 2 * uz + s + 0.15, sx * (ux - s / 2 - 0.028), safY, 0.075, f);
      for (const sz of [-1, 1]) cylX(b, 0.01, s + 0.07, sx * (ux - 0.02), safY + 0.025, sz * uz, steel, 8);
    }
    // the flat bench
    const bl = Math.min(1.1, d * 0.8);
    const benchZ = 0.05;
    const padY = 0.37 * Math.min(1, h / 2.2 + 0.3);
    b.box(0.28, 0.075, bl, 0, padY, benchZ, mat("#1d1e21", { roughness: 0.65 }), 0.025);
    bx(b, 0.2, 0.02, bl * 0.92, 0, padY - 0.02, benchZ, mat("#2a2b2e"));
    bx(b, 0.06, 0.06, bl * 0.7, 0, padY - 0.15, benchZ, f);
    for (const sz of [-1, 1]) {
      const z = benchZ + sz * bl * 0.38;
      bx(b, Math.min(0.44, 2 * ux - s - 0.02), 0.05, 0.06, 0, 0, z, f);
      bx(b, 0.06, padY - 0.07, 0.06, 0, 0.05, z, f);
      for (const sx of [-1, 1]) cylY(b, 0.02, 0.01, sx * Math.min(0.2, ux - s / 2 - 0.03), 0, z, rubber, 8);
    }
  },

  elliptical: (b, w, d, h, f) => {
    // a cross trainer (the user faces +z): the main beam with stabilisers, the flywheel
    // shroud at the front, pedal arms from the cranks to rollers on rear ramps with wide foot
    // pedals, the mast with its console and fixed grips, swing arms from the mast pivot up to
    // the handles and down to the pedal arms
    const sx = w / 0.7;
    const sy = h / 1.6;
    const sz = d / 1.75;
    const P = (x: number, y: number, z: number) => v(x * sx, y * sy, z * sz);
    const dark = mat("#2a2b2e", { roughness: 0.55 });
    const rubber = mat("#1b1c1f", { roughness: 1 });
    const grip = mat("#151517", { roughness: 0.95 });
    const arm = mat("#5a5d61", { metalness: 0.4, roughness: 0.45 });
    bx(b, 0.08 * sx, 0.07, 1.5 * sz, 0, 0.03, -0.05 * sz, f);
    for (const z of [-0.8, 0.76]) {
      cylX(b, 0.03, w - 0.06, 0, 0.035, z * sz, f, 12);
      for (const s of [-1, 1]) cylX(b, 0.035, 0.03, s * (w / 2 - 0.015), 0.035, z * sz, rubber, 14);
    }
    // the rear ramps the rollers run on
    const ramp = (s: number) => [P(s * 0.13, 0.07, -0.8), P(s * 0.13, 0.16, -0.42)];
    for (const s of [-1, 1]) beam(b, ramp(s)[0], ramp(s)[1], 0.06, 0.02, f);
    // the flywheel shroud and its side covers
    const fw = P(0, 0.36, 0.5);
    const fr = Math.min(0.29 * Math.min(sy, sz), 0.33);
    cylX(b, fr, 0.2 * sx, fw.x, fw.y, fw.z, f, 36);
    for (const s of [-1, 1]) {
      b.batch(new THREE.CircleGeometry(fr * 0.72, 28).rotateY((s * Math.PI) / 2), mat("#3a3c40", { roughness: 0.5 }), matrix(s * (0.1 * sx + 0.0008), fw.y, fw.z));
      b.batch(new THREE.CircleGeometry(fr * 0.2, 16).rotateY((s * Math.PI) / 2), arm, matrix(s * (0.1 * sx + 0.0016), fw.y, fw.z));
    }
    bx(b, 0.2 * sx, fw.y - 0.06, 0.12 * sz, 0, 0.06, fw.z, f);
    // the cranks (one forward, one back), pedal arms, pedals, rollers and swing arms
    const cl = 0.13 * Math.min(sy, sz);
    for (const s of [-1, 1]) {
      const ang = s > 0 ? 0.5 : 0.5 + Math.PI;
      const cx = s * (0.1 * sx + 0.02);
      const pin = v(cx, fw.y + Math.sin(ang) * cl, fw.z + Math.cos(ang) * cl);
      beam(b, v(cx, fw.y, fw.z), pin, 0.03, 0.02, arm);
      const [r0, r1] = ramp(s);
      const roller = r0.clone().lerp(r1, s > 0 ? 0.45 : 0.3).add(v(0, 0.045, 0));
      const ax = s * 0.13 * sx;
      const a = v(ax, pin.y, pin.z);
      beam(b, a, roller, 0.035, 0.05, arm);
      cylX(b, 0.012, Math.abs(cx - ax) + 0.02, (cx + ax) / 2, pin.y, pin.z, arm, 8);
      cylX(b, 0.035, 0.04, ax, roller.y, roller.z, dark, 14);
      // the pedal: a wide plate a third of the way along from the roller
      const pc = roller.clone().lerp(a, 0.35);
      const dir = a.clone().sub(roller).normalize();
      const tilt = Math.atan2(dir.y, dir.z);
      b.batch(new THREE.BoxGeometry(0.14, 0.035, 0.36 * sz), rubber, matrix(ax + s * 0.02, pc.y + 0.035, pc.z, -tilt));
      b.batch(new THREE.BoxGeometry(0.012, 0.03, 0.36 * sz), dark, matrix(ax + s * 0.09, pc.y + 0.05, pc.z, -tilt));
      // the swing arm: from the pedal arm's front up to the pivot and on to the handle
      const piv = P(s * 0.1, 1.02, 0.44);
      const low = P(s * 0.13, 0.62, 0.46 + s * 0.03);
      const hand = v(s * 0.26 * sx, h - 0.03, (0.2 - s * 0.05) * sz);
      rodB(b, a.clone().lerp(roller, 0.05), low, 0.016, arm, 8);
      rodB(b, low, piv, 0.02, f, 10);
      rodB(b, piv, hand, 0.02, f, 10);
      rodB(b, piv.clone().lerp(hand, 0.55), hand, 0.025, grip, 10);
      ball(b, 0.025, hand.x, hand.y, hand.z, grip, 10);
      ball(b, 0.03, piv.x, piv.y, piv.z, dark, 12);
    }
    // the mast, the pivot axle, the console facing the user, the fixed grips
    const top = P(0, 1.3, 0.42);
    beam(b, P(0, 0.1, 0.62), top, 0.08, 0.06, f);
    cylX(b, 0.018, 0.24 * sx, 0, 1.02 * sy, 0.44 * sz, arm, 10);
    const tilt = -0.75;
    const at = tilted(b, 0.32 * Math.min(1, sx), 0.05, 0.2, 0, top.y - 0.005, top.z - 0.04, dark, tilt, 0.02);
    onFace(b, new THREE.BoxGeometry(0.15, 0.004, 0.1), screenMat(), at(0, 0.01), tilt);
    for (const s of [-1, 1]) onFace(b, new THREE.CylinderGeometry(0.011, 0.011, 0.006, 10), mat(s > 0 ? "#d23a2a" : "#7a7f86", { roughness: 0.5 }), at(s * 0.11, 0.01), tilt);
    for (const s of [-1, 1]) {
      const g0 = P(s * 0.04, 1.18, 0.4);
      const g1 = P(s * 0.12, 1.12, 0.26);
      rodB(b, g0, g1, 0.016, arm, 8);
      rodB(b, g1.clone().lerp(g0, 0.1), g1.clone().add(v(0, -0.06, -0.06)), 0.02, grip, 8);
    }
  },

  // ----- building parts -----
  column: (b, w, d, h, f) => {
    // a column filling the height: a shaft with a slight taper, a subtle base and capital
    const bH = Math.min(0.07, h * 0.03);
    const cH = Math.min(0.09, h * 0.035);
    if (b.options.shape === "square") {
      bx(b, w, bH * 0.6, d, 0, 0, 0, f);
      bx(b, w * 0.94, bH * 0.4, d * 0.94, 0, bH * 0.6, 0, f);
      bx(b, w * 0.86, h - bH - cH, d * 0.86, 0, bH, 0, f);
      bx(b, w * 0.93, cH * 0.4, d * 0.93, 0, h - cH, 0, f);
      bx(b, w, cH * 0.6, d, 0, h - cH * 0.6, 0, f);
      return;
    }
    const r = Math.min(w, d) / 2;
    const s = h - bH - cH;
    const geo = lathe(
      [
        [0.001, 0],
        [r, 0],
        [r, bH * 0.35],
        [r * 0.96, bH * 0.5],
        [r * 0.95, bH * 0.7],
        [r * 0.9, bH * 0.85],
        [r * 0.87, bH],
        [r * 0.865, bH + s * 0.33],
        [r * 0.845, bH + s * 0.75],
        [r * 0.83, h - cH],
        [r * 0.86, h - cH * 0.8],
        [r * 0.92, h - cH * 0.6],
        [r * 0.92, h - cH * 0.45],
        [r, h - cH * 0.4],
        [r, h],
        [0.001, h],
      ],
      40,
    );
    geo.deleteAttribute("uv");
    b.add(geo, f);
  },

  ceiling_beam: (b, w, d, h, f, color) => {
    // a beam hung under the ceiling, spanning the width: chamfered lower edges; a timber one
    // shows a few drying cracks along its sides and underside
    const c = Math.min(0.012, d * 0.08, h * 0.08);
    const geo = profileX(
      [
        [-d / 2 + c, 0],
        [d / 2 - c, 0],
        [d / 2, c],
        [d / 2, h],
        [-d / 2, h],
        [-d / 2, c],
      ],
      w,
    );
    geo.deleteAttribute("uv");
    b.add(geo, f);
    if (color === "oak" || color === "walnut") {
      const crack = mat(color === "oak" ? "#5e4630" : "#2e2018", { roughness: 1 });
      const rand = random(83);
      for (let i = 0; i < 7; i++) {
        const len = w * (0.15 + rand() * 0.3);
        const x = -w / 2 + len / 2 + rand() * (w - len);
        const side = i % 3;
        if (side === 2) bx(b, len, 0.0015, 0.003, x, -0.0005, (rand() - 0.5) * (d - 4 * c), crack, 0, (rand() - 0.5) * 0.02);
        else bx(b, len, 0.003, 0.0015, x, c + 0.01 + rand() * (h - 2 * c - 0.02), (side ? 1 : -1) * (d / 2 + 0.0005), crack, (rand() - 0.5) * 0.004);
      }
    }
  },

  room_divider_slats: (b, w, d, h, f) => {
    // a slatted divider: vertical slats from a floor rail to a ceiling rail, as many as the
    // width takes at about 9 cm apart
    const sd = Math.min(d, 0.06);
    const rail = Math.min(0.025, h * 0.012);
    bx(b, w, rail, sd * 0.7, 0, 0, 0, f);
    bx(b, w, rail, sd * 0.7, 0, h - rail, 0, f);
    const n = Math.max(2, Math.round(w / 0.09));
    const sw = Math.min(0.045, (w / n) * 0.55);
    for (let i = 0; i < n; i++) bx(b, sw, h - 2 * rail, sd, -w / 2 + (i + 0.5) * (w / n), rail, 0, f);
  },

  glass_partition: (b, w, d, h, f) => {
    // a steel-framed glass wall: a frame all round, mullions between panels about 90 cm wide,
    // transoms dividing each panel into panes, the glass in the middle
    const fd = Math.min(d, 0.05);
    const fw = 0.045;
    const mw = 0.03;
    const n = Math.max(1, Math.round(w / 0.9));
    const rows = Math.max(2, Math.round(h / 0.6));
    bx(b, w - 2 * fw, h - 2 * fw, 0.008, 0, fw, 0, glass());
    bx(b, fw, h, fd, -w / 2 + fw / 2, 0, 0, f);
    bx(b, fw, h, fd, w / 2 - fw / 2, 0, 0, f);
    bx(b, w - 2 * fw, fw, fd, 0, 0, 0, f);
    bx(b, w - 2 * fw, fw, fd, 0, h - fw, 0, f);
    const pw = (w - 2 * fw) / n;
    for (let i = 1; i < n; i++) bx(b, mw, h - 2 * fw, fd, -w / 2 + fw + pw * i, fw, 0, f);
    const ph = (h - 2 * fw) / rows;
    for (let r = 1; r < rows; r++) bx(b, w - 2 * fw, mw * 0.7, fd * 0.7, 0, fw + ph * r - mw * 0.35, 0, f);
  },
};
