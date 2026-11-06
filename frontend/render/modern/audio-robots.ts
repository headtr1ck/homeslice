// Built-in pieces added later: audio robots. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0; wall pieces
// from their bottom with the back against the wall, ceiling pieces hanging from y = h).
//
// What reacts: the speakers' drivers pulse (b.pulser) while they play, docks and mowers show
// their status lights as `part(…, "led")` and displays as `part(…, "screen")`, the wash
// station's clean water is `part(…, "water")`.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { FINISHES } from "../../model/modern";
import { C, glass, ledMat, mat, matrix, part, roundedRect, screenMat, v } from "../modern";
import type { Build, Builder } from "../modern";

type M = THREE.Material;
const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
const hex = (color: string) => FINISHES[color] ?? FINISHES.white;
/** The finish colour mixed towards another (darker trim, perforations). */
const mix = (color: string, to: string, k: number) => new THREE.Color(hex(color)).lerp(new THREE.Color(to), k).getStyle();

// ----- helpers -----

/** A box from its bottom centre with rounded edges of few segments (small devices). */
function rb(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, r: number, seg = 1) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const geo = rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  return b.add(geo, m, x, y + h / 2, z);
}

/** A plain box from its bottom centre, merged with the others of its material (turned about its centre). */
function bx(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, rx = 0, ry = 0, rz = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.batch(new THREE.BoxGeometry(w, h, d), m, matrix(x, y + h / 2, z, rx, ry, rz));
}

/** A cylinder lying along x, centred at (x, y, z). */
function xcyl(b: Builder, r: number, len: number, x: number, y: number, z: number, m: M, seg = 16) {
  return b.add(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2), m, x, y, z);
}

/** A cylinder lying along z, centred at (x, y, z). */
function zcyl(b: Builder, r: number, len: number, x: number, y: number, z: number, m: M, seg = 16) {
  return b.add(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), m, x, y, z);
}

/** A side profile (z, y points) extruded across the width, centred on x. */
function profileX(pts: [number, number][], width: number, curve = 3): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => V2(z, y))), { depth: width, bevelEnabled: false, curveSegments: curve });
  return geo.rotateY(-Math.PI / 2).translate(width / 2, 0, 0);
}

/** A flat rounded rectangle lying from y = 0 to t. */
const slab = (w: number, d: number, r: number, t: number) =>
  new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth: t, bevelEnabled: false, curveSegments: 3 }).rotateX(-Math.PI / 2);

/**
 * A rounded rectangle standing up from y = 0 to hh, wb × db at the bottom and wt × dt at
 * the top (mower shells, dock towers). Its back can stay upright (lean = 1).
 */
function taper(wb: number, db: number, wt: number, dt: number, hh: number, r: number, lean = 0) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(wb, db, r), { depth: hh, bevelEnabled: false, curveSegments: 3 });
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getZ(i) / hh;
    pos.setX(i, pos.getX(i) * (1 + (wt / wb - 1) * t));
    pos.setY(i, pos.getY(i) * (1 + (dt / db - 1) * t) + ((db - dt) / 2) * t * lean);
  }
  geo.computeVertexNormals();
  return geo.rotateX(-Math.PI / 2);
}

/** A band of an arc (x, y) extruded along z from 0 by len: fenders, curved roofs. */
function arcBand(r0: number, r1: number, a0: number, a1: number, len: number, seg = 12) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pts.push(V2(Math.cos(a) * r1, Math.sin(a) * r1));
  }
  for (let i = seg; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pts.push(V2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: len, bevelEnabled: false });
}

/** A fender over a wheel turning about x: an arc band across the tyre. */
function fender(b: Builder, x: number, y: number, z: number, r: number, t: number, width: number, m: M, a0 = 0.15, a1 = Math.PI - 0.15) {
  // the arc is drawn in z (along the piece) and y, then laid across x
  b.add(arcBand(r, r + t, a0, a1, width, 10).rotateY(Math.PI / 2).translate(-width / 2, 0, 0), m, x, y, z);
}

/**
 * A wheel turning about x at (x, y, z): a tyre with a bulging sidewall, a rim and a hub;
 * `lugs` tread blocks round it (off-road tyres), alternating from side to side.
 */
function wheel(b: Builder, x: number, y: number, z: number, r: number, width: number, rim: M, lugs = 0, seg = 20) {
  const tyre = mat("#1e1f22", { roughness: 0.95 });
  const side = Math.sign(x) || 1;
  const t = lugs ? Math.min(0.018, r * 0.12) : 0;
  b.add(new THREE.CylinderGeometry(r - t, r - t, width, seg).rotateZ(Math.PI / 2), tyre, x, y, z);
  b.add(new THREE.TorusGeometry(r * 0.78, r * 0.12, 4, seg).rotateY(Math.PI / 2), tyre, x + side * (width / 2 - r * 0.07), y, z);
  b.add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, width + 0.004, seg).rotateZ(Math.PI / 2), rim, x, y, z);
  b.add(new THREE.CylinderGeometry(r * 0.2, r * 0.26, 0.012, 10).rotateZ((-side * Math.PI) / 2), mat("#5c6066", { metalness: 0.4 }), x + side * (width / 2 + 0.008), y, z);
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    const off = (i % 2 ? 1 : -1) * width * 0.18;
    const len = Math.max(0.012, (Math.PI * 2 * r) / lugs / 2.2);
    b.batch(new THREE.BoxGeometry(width * 0.62, t * 1.6, len), tyre, matrix(x + off, y + Math.sin(a) * (r - t * 0.7), z + Math.cos(a) * (r - t * 0.7), -a, 0, 0));
  }
}

// ----- speakers: flush grilles on the wall or the ceiling -----

/** Where a speaker's face goes: its own frame (facing +z, back at z = 0) into the piece. */
type Face = { m: THREE.Matrix4; rot: number };
const wallFace = (d: number, h: number): Face => ({ m: new THREE.Matrix4().makeTranslation(0, h / 2, -d / 2), rot: 0 });
const ceilingFace = (h: number): Face => ({ m: new THREE.Matrix4().makeTranslation(0, h, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), rot: Math.PI / 2 });

type Driver = { x: number; y: number; r: number; tweeter?: boolean; coax?: boolean };

/**
 * A flush speaker W × H on a face: a thin rounded frame in the finish, a perforated grille
 * (a little see-through) and behind it the woofers and tweeters, which pulse while it plays.
 */
function speaker(b: Builder, o: Face, W: number, H: number, f: M, color: string, round: boolean, drivers: Driver[]) {
  const put = (geo: THREE.BufferGeometry, m: M) => b.add(geo.applyMatrix4(o.m), m);
  const fw = Math.min(W, H) * 0.055;
  const ft = 0.007;
  const bev = 0.0022;
  const R = Math.min(W, H) / 2;
  const rc = Math.min(W, H) * 0.06;
  const outline = (inset: number): THREE.Shape =>
    round ? new THREE.Shape().absarc(0, 0, R - inset, 0, Math.PI * 2, false) : roundedRect(W - 2 * inset, H - 2 * inset, Math.max(0.003, rc - inset * 0.5));
  // the frame: a ring with a soft front edge
  const frame = outline(0);
  frame.holes.push(outline(fw));
  put(new THREE.ExtrudeGeometry(frame, { depth: ft - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 1, curveSegments: round ? 14 : 3 }).translate(0, 0, bev), f);
  // the dark cavity behind the grille
  put(new THREE.ExtrudeGeometry(outline(fw - 0.0025), { depth: 0.0006, bevelEnabled: false, curveSegments: round ? 14 : 3 }), mat("#141517", { roughness: 1 }));
  // the drivers: woofer cones in their surrounds (a tweeter on a bridge when coaxial), tweeter domes
  const rubber = mat("#1c1d20", { roughness: 0.95 });
  const cone = mat("#2c2d31", { roughness: 0.75 });
  const dome = mat("#5a5d62", { roughness: 0.35, metalness: 0.5 });
  const cap0 = mat("#4a4b50", { roughness: 0.6 });
  const cap = (r: number) => new THREE.SphereGeometry(r, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  const zp = 0.0018;
  // the drivers stay behind the grille whatever their size: domes and surrounds flattened to
  // the room between the driver plane and the grille (scale z of a part of radius rad rising from base)
  const room = ft - bev - 0.0008 - zp - 0.0004;
  const sz = (rad: number, base: number, k: number) => Math.max(0.05, Math.min(k, (room - base) / rad));
  for (const dr of drivers) {
    const p = v(dr.x, dr.y, zp).applyMatrix4(o.m);
    const add = (geo: THREE.BufferGeometry, m: M) => b.add(geo, m, p.x, p.y, p.z);
    const r = dr.r;
    const pulse = b.pulser(p.x, p.y, p.z, () => {
      if (dr.tweeter) {
        add(new THREE.TorusGeometry(r * 0.9, r * 0.14, 4, 16).scale(1, 1, sz(r * 0.14, 0, 0.4)), rubber);
        add(cap(r * 0.62).scale(1, 1, sz(r * 0.62, 0, 0.5)), dome);
        return;
      }
      add(new THREE.TorusGeometry(r * 0.92, r * 0.06, 4, 24).scale(1, 1, sz(r * 0.06, 0, 0.3)), rubber);
      add(new THREE.LatheGeometry([V2(r * 0.86, 0.0004), V2(r * 0.55, -0.0004), V2(r * 0.3, -0.0009)], 20).rotateX(Math.PI / 2), cone);
      if (dr.coax) {
        add(new THREE.BoxGeometry(r * 1.6, r * 0.08, 0.001).translate(0, 0, 0.0004), rubber);
        add(new THREE.CylinderGeometry(r * 0.24, r * 0.26, 0.0012, 16).rotateX(Math.PI / 2).translate(0, 0, 0.0004), rubber);
        add(cap(r * 0.16).scale(1, 1, sz(r * 0.16, 0.001, 0.5)).translate(0, 0, 0.001), dome);
      } else add(cap(r * 0.28).scale(1, 1, sz(r * 0.28, -0.0008, 0.3)).translate(0, 0, -0.0008), cap0);
    });
    pulse.rotation.x = o.rot;
  }
  // the grille: the finish, a little see-through, with its perforations
  const sheen = color === "silver" ? { metalness: 0.5, roughness: 0.4 } : { roughness: 0.6 };
  const gz = ft - bev - 0.0008;
  put(new THREE.ShapeGeometry(outline(fw - 0.0015), round ? 14 : 3).translate(0, 0, gz), mat(hex(color), { transparent: true, opacity: 0.72, ...sheen }));
  const hole = mat(mix(color, "#000000", color === "black" ? 0.6 : 0.42), { roughness: 0.9 });
  const gw = W - 2 * fw;
  const gh = H - 2 * fw;
  const pitch = Math.sqrt((gw * gh) / (round ? 300 : 210));
  const ds = pitch * 0.42;
  const cols = Math.floor(gw / pitch);
  const rows = Math.floor(gh / pitch);
  const rIn = R - fw - pitch * 0.6;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x = (i - (cols - 1) / 2) * pitch;
      const y = (j - (rows - 1) / 2) * pitch;
      if (round && Math.hypot(x, y) > rIn) continue;
      b.batch(new THREE.PlaneGeometry(ds, ds).rotateZ(Math.PI / 4).translate(x, y, gz + 0.0004), hole, o.m);
    }
}

// ----- robot docks -----

/** A dock's ramp: a wedge across the width from z0 (height y0) down to the floor at z1. */
function ramp(b: Builder, width: number, z0: number, z1: number, y0: number, m: M) {
  const lip = Math.min(0.004, y0 * 0.3);
  b.add(profileX([[z0, 0], [z1, 0], [z1, lip], [z1 - (z1 - z0) * 0.08, lip + (y0 - lip) * 0.2], [z0, y0]], width), m);
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  speaker_inwall_round: (b, w, d, h, f, color) => {
    // one coaxial driver behind a round grille
    const R = Math.min(w, h) / 2;
    speaker(b, wallFace(d, h), w, h, f, color, true, [{ x: 0, y: 0, r: R * 0.74, coax: true }]);
  },
  speaker_inwall_square: (b, w, d, h, f, color) => {
    // a woofer low and a tweeter above it, behind a square grille
    const s = Math.min(w, h);
    speaker(b, wallFace(d, h), w, h, f, color, false, [
      { x: 0, y: -s * 0.1, r: s * 0.3 },
      { x: 0, y: s * 0.3, r: s * 0.075, tweeter: true },
    ]);
  },
  speaker_inwall_rect: (b, w, d, h, f, color) => {
    // two woofers with the tweeter between them, behind a tall grille
    const r = Math.min(w * 0.34, h * 0.17);
    speaker(b, wallFace(d, h), w, h, f, color, false, [
      { x: 0, y: h * 0.27, r },
      { x: 0, y: -h * 0.27, r },
      { x: 0, y: 0, r: Math.min(w, h) * 0.075, tweeter: true },
    ]);
  },
  speaker_ceiling_round: (b, w, d, h, f, color) => {
    const R = Math.min(w, d) / 2;
    speaker(b, ceilingFace(h), w, d, f, color, true, [{ x: 0, y: 0, r: R * 0.74, coax: true }]);
  },
  speaker_ceiling_square: (b, w, d, h, f, color) => {
    const s = Math.min(w, d);
    speaker(b, ceilingFace(h), w, d, f, color, false, [{ x: 0, y: 0, r: s * 0.36, coax: true }]);
  },

  robot_dock: (b, w, d, h, f, color) => {
    // a small charging dock: an upright back with a dark sensor window and a status light,
    // a low ramp in front with the two charging contacts, a cable out of the back
    const dark = mat("#1d1e21", { roughness: 0.8 });
    const metal = mat(C.chrome, { metalness: 0.85, roughness: 0.25 });
    const bd = d * 0.42;
    const zb = -d / 2 + bd / 2;
    const rh = Math.min(0.012, h * 0.12);
    ramp(b, w * 0.86, -d / 2 + bd * 0.5, d / 2, rh, color === "white" ? mat("#d9d8d4", { roughness: 0.6 }) : dark);
    b.add(taper(w, bd, w * 0.94, bd * 0.7, h, Math.min(0.02, bd * 0.4), 1), f, 0, 0, zb);
    b.add(slab(w * 0.94 - 0.002, bd * 0.7 - 0.002, Math.min(0.02, bd * 0.4), 0.003), dark, 0, h - 0.0015, zb - bd * 0.15);
    // the sloping front: a dark window across it, the light above
    const fz = -d / 2 + bd;
    const slope = Math.atan2(bd * 0.3, h);
    bx(b, w * 0.6, h * 0.32, 0.002, 0, h * 0.34, fz - bd * 0.3 * 0.5 + 0.0005, mat("#0b0c0e", { roughness: 0.15, metalness: 0.3 }), -slope);
    bx(b, w * 0.1, h * 0.04, 0.002, 0, h * 0.8, fz - bd * 0.3 * 0.82 + 0.0012, ledMat("#3fd27a"), -slope);
    // the contacts on the ramp
    for (const s of [-1, 1]) rb(b, w * 0.16, 0.004, d * 0.2, s * w * 0.22, rh * 0.55, fz + d * 0.16, metal, 0.0015);
    // the cable
    b.rod(v(w * 0.3, 0.008, -d / 2 + 0.004), v(w / 2, 0.006, -d / 2 + 0.004), 0.003, dark, 6);
  },

  robot_dock_empty: (b, w, d, h, f, color) => {
    // a self-emptying dock: a tall tower with the dust-bag lid on top (a smoked window shows
    // the bag), a light bar, a wide ramp at its foot with the suction port and contacts
    const white = color === "white";
    const dark = mat("#1d1e21", { roughness: 0.8 });
    const trim = mat(white ? "#d6d5d1" : "#33353a", { roughness: 0.6 });
    const metal = mat(C.chrome, { metalness: 0.85, roughness: 0.25 });
    const td = Math.min(d * 0.48, 0.22);
    const zb = -d / 2 + td / 2;
    const fz = -d / 2 + td;
    const rh = Math.min(0.03, h * 0.07);
    // the ramp, with the port, the contacts and grip ribs for the wheels
    const z0 = -d / 2 + td * 0.6;
    // the ramp's top line (see ramp): from rh at z0 down to a fifth above its lip near the front
    const lip = Math.min(0.004, rh * 0.3);
    const zk = d / 2 - (d / 2 - z0) * 0.08;
    const drop = rh - (lip + (rh - lip) * 0.2);
    const slope = Math.atan2(drop, zk - z0);
    const yAt = (z: number) => rh - (drop * (z - z0)) / (zk - z0);
    ramp(b, w * 0.92, z0, d / 2, rh, trim);
    // laid out along the ramp's open length, so it reads the same at any size
    const Lr = d / 2 - fz;
    const on = (u: number) => fz + Lr * u;
    bx(b, w * 0.42, 0.003, Lr * 0.24, 0, yAt(on(0.17)) - 0.002, on(0.17), dark, slope);
    for (const s of [-1, 1]) {
      bx(b, w * 0.12, 0.003, Lr * 0.08, s * w * 0.33, yAt(on(0.3)) - 0.002, on(0.3), metal, slope);
      for (let i = 0; i < 4; i++) {
        const z = on(0.48 + i * 0.13);
        bx(b, w * 0.15, 0.003, Lr * 0.045, s * w * 0.3, yAt(z) - 0.002, z, dark, slope);
      }
    }
    // the tower: a rounded body, a dark seam, the lid with its grip and window
    const lh = Math.min(0.06, h * 0.14);
    const bh = h - lh - 0.004;
    const rr = Math.min(0.04, w * 0.12);
    b.add(taper(w, td, w * 0.96, td * 0.96, bh, rr, 1), f, 0, 0, zb);
    b.add(slab(w * 0.95, td * 0.95, rr, 0.006), dark, 0, bh - 0.001, zb - td * 0.02);
    b.add(taper(w * 0.96, td * 0.96, w * 0.93, td * 0.9, lh, rr, 1), f, 0, bh + 0.004, zb - td * 0.02);
    b.add(slab(w * 0.5, td * 0.42, 0.02, 0.002), mat("#2a2c30", { roughness: 0.1, transparent: true, opacity: 0.85 }), 0, h - 0.001, zb - td * 0.06);
    b.add(slab(w * 0.4, td * 0.32, 0.015, 0.001), mat("#b8ae98", { roughness: 1 }), 0, h - 0.0025, zb - td * 0.06);
    bx(b, w * 0.28, 0.01, 0.01, 0, h - lh * 0.6, fz - td * 0.045 + 0.002, dark);
    // the front: a light bar, a button, the opening where the robot docks
    const front = fz - td * 0.02;
    bx(b, w * 0.36, 0.006, 0.003, 0, bh * 0.82, front + 0.001, ledMat("#7fd0ff"));
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.003, 14).rotateX(Math.PI / 2), trim, 0, bh * 0.72, front + 0.001);
    rb(b, w * 0.7, Math.min(0.08, h * 0.2), 0.006, 0, rh, fz - 0.002, dark, 0.012);
    // vents on the sides
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) bx(b, 0.003, 0.006, td * 0.5, s * (w / 2 - 0.001), bh * 0.25 + i * 0.016, zb, dark);
  },

  robot_dock_wash: (b, w, d, h, f, color) => {
    // a mop wash station: a tall body the robot drives into, two water tanks side by side on
    // top (clean water showing through, dirty smoked), a display and light on the front, a
    // ramp with the ribbed wash tray at its foot
    const white = color === "white";
    const dark = mat("#1d1e21", { roughness: 0.8 });
    const trim = mat(white ? "#d6d5d1" : "#33353a", { roughness: 0.6 });
    const td = Math.min(d * 0.55, 0.26);
    const zb = -d / 2 + td / 2;
    const fz = -d / 2 + td;
    const rh = Math.min(0.03, h * 0.06);
    const th = Math.min(0.2, h * 0.38);
    const bh = h - th;
    const rr = Math.min(0.03, w * 0.08);
    // the ramp and the wash tray, reaching into the opening
    const tz0 = -d / 2 + td * 0.35;
    ramp(b, w * 0.9, tz0, d / 2, rh, trim);
    const trayD = fz - tz0 + (d / 2 - fz) * 0.35;
    b.add(slab(w * 0.7, trayD, 0.02, 0.004), dark, 0, rh - 0.002, tz0 + trayD / 2 + 0.005);
    const ribs = mat(white ? "#9aa0a6" : "#4a4d52", { roughness: 0.5 });
    for (let i = 0; i < 9; i++) bx(b, w * 0.62, 0.004, 0.006, 0, rh + 0.001, tz0 + 0.02 + (i * (trayD - 0.04)) / 8, ribs);
    b.add(slab(w * 0.5, trayD * 0.3, 0.01, 0.001), part(mat("#9cc9e0", { transparent: true, opacity: 0.6, roughness: 0.1 }), "water"), 0, rh + 0.0025, tz0 + trayD * 0.4);
    // the body: the back and both sides round the opening, the front panel above it
    const oh = Math.min(0.13, bh * 0.45);
    const sw = Math.min(0.04, w * 0.1);
    b.box(w, bh, td * 0.35, 0, 0, -d / 2 + td * 0.175, f, rr);
    for (const s of [-1, 1]) b.box(sw, bh, td, s * (w / 2 - sw / 2), 0, zb, f, Math.min(rr, sw * 0.4));
    b.box(w - 2 * sw + 0.01, bh - oh - rh, td, 0, rh + oh, zb, f, Math.min(rr, 0.02));
    b.box(w - 2 * sw, oh, td * 0.65, 0, rh, zb + td * 0.175, mat("#0f1012", { roughness: 1 }));
    // the front: a display, a light bar, two buttons
    const ph = bh - oh - rh;
    const yd = rh + oh + ph * 0.5;
    rb(b, w * 0.3, ph * 0.34, 0.004, 0, yd - ph * 0.17, fz + 0.001, mat("#0b0c0e", { roughness: 0.15 }), 0.006);
    bx(b, w * 0.26, ph * 0.24, 0.002, 0, yd - ph * 0.12, fz + 0.0035, screenMat());
    bx(b, w * 0.5, 0.005, 0.003, 0, rh + oh + 0.012, fz + 0.001, ledMat("#7fd0ff"));
    for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.01, 0.01, 0.004, 12).rotateX(Math.PI / 2), trim, s * w * 0.27, yd, fz + 0.002);
    // the tanks: clean (left, water inside) and dirty (right, smoked), each with a lid and handle
    const gap = 0.012;
    const tw = (w - 3 * gap) / 2;
    const tdp = td - 2 * gap;
    const lid = mat(white ? "#e4e3df" : "#2c2e32", { roughness: 0.55 });
    for (const s of [-1, 1]) {
      const x = s * (tw / 2 + gap / 2);
      const clean = s < 0;
      const shell = clean ? glass() : mat("#4a4d52", { transparent: true, opacity: 0.88, roughness: 0.2 });
      const sh = th - 0.036;
      b.box(tw, sh, tdp, x, bh, zb, shell, 0.012);
      if (clean) b.box(tw - 0.012, sh * 0.62, tdp - 0.012, x, bh + 0.004, zb, part(mat("#6fb6e0", { transparent: true, opacity: 0.75, roughness: 0.1 }), "water"), 0.008);
      else b.box(tw - 0.012, sh * 0.3, tdp - 0.012, x, bh + 0.004, zb, mat("#5b5442", { roughness: 0.3 }), 0.008);
      b.box(tw + 0.004, 0.03, tdp + 0.004, x, h - 0.036, zb, lid, 0.012);
      bx(b, tw * 0.5, 0.008, 0.012, x, h - 0.008, zb + tdp * 0.25, dark);
      // a mark on the front: a drop for clean water, a bar for dirty
      if (clean) b.sphere(0.012, x, bh + sh * 0.8, zb + tdp / 2 + 0.001, mat("#3f8fd6", { roughness: 0.4 }), 1, 1.3, 0.2, 10);
      else bx(b, 0.03, 0.008, 0.002, x, bh + sh * 0.8, zb + tdp / 2 + 0.001, mat("#8a6a3a", { roughness: 0.4 }));
    }
  },

  robot_mower_awd: (b, w, d, h, f) => {
    // a bigger, articulated all-wheel-drive robot mower: four big off-road wheels under
    // fenders, a front and a rear body joined by a rubber-booted pivot, a bumper with lights,
    // the red stop button and a display on the rear body
    const dark = mat("#26282c", { roughness: 0.7 });
    const black = mat("#17181b", { roughness: 0.9 });
    const rim = mat("#8a8f94", { metalness: 0.3, roughness: 0.5 });
    // the small parts (lights, button, keys, grip) keep to the mower's size
    const k = Math.min(w / 0.6, d / 0.8);
    const wr = Math.min(h * 0.37, d * 0.16);
    const ww = Math.min(0.09 * k, w * 0.15);
    const wx = w / 2 - ww / 2;
    const wz = d / 2 - wr - Math.min(0.03, d * 0.04);
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) wheel(b, sx * wx, wr, sz * wz, wr, ww, rim, 16, 18);
    // both bodies: a dark chassis, a shell in the finish, fenders over the wheels
    const bw = w - 2 * ww - 0.02;
    const gapZ = Math.min(0.06, d * 0.08);
    const hd = d / 2 - gapZ / 2 - 0.02;
    const sh = h * 0.84;
    for (const sz of [-1, 1]) {
      const zc = sz * (gapZ / 2 + hd / 2);
      b.add(taper(bw, hd, bw, hd, h * 0.3, 0.06), dark, 0, h * 0.14, zc);
      b.add(taper(bw, hd, bw * 0.84, hd * 0.82, sh - h * 0.44, 0.09), f, 0, h * 0.44, zc);
      b.add(slab(bw + 0.008, hd + 0.008, 0.06, 0.012), black, 0, h * 0.43, zc);
      for (const sx of [-1, 1]) {
        bx(b, w / 2 - bw / 2 - ww / 2 + 0.01, 0.03, 0.05, sx * (bw / 2 + (w / 2 - bw / 2 - ww / 2) / 2), wr - 0.015, sz * wz, dark);
        fender(b, sx * wx, wr, sz * wz, wr + 0.012, 0.012, ww + 0.014, f, 0.35, Math.PI - 0.35);
      }
    }
    // the joint: a pivot under a ribbed rubber boot
    xcyl(b, 0.03 * k, bw * 0.5, 0, h * 0.3, 0, dark, 12);
    for (let i = 0; i < 4; i++) rb(b, bw * 0.46, h * 0.36, 0.012, 0, h * 0.2, -gapZ / 2 + 0.006 + (i * (gapZ - 0.012)) / 3, black, 0.01);
    // the bumper round the nose and the headlights
    const br = bw * 0.7;
    b.add(arcBand(br, br + 0.025, Math.PI * 0.3, Math.PI * 0.7, h * 0.12, 10).rotateX(Math.PI / 2).translate(0, h * 0.24, d / 2 - 0.006 - br - 0.025), black);
    for (const s of [-1, 1]) rb(b, 0.05 * k, 0.016 * k, 0.006, s * bw * 0.25, h * 0.3, d / 2 - 0.02, ledMat("#f4f3e8"), 0.004);
    // the stop button with its yellow ring, the display and two keys on the rear body
    const ty = sh;
    const rz = -(gapZ / 2 + hd / 2);
    b.cyl(0.05 * k, 0.05 * k, 0.006, 0, ty, rz + hd * 0.12, mat("#e2c33a", { roughness: 0.5 }), 20);
    b.cyl(0.036 * k, 0.04 * k, h - ty - 0.006, 0, ty + 0.006, rz + hd * 0.12, mat("#d23a2a", { roughness: 0.45 }), 20);
    rb(b, bw * 0.4, 0.006, hd * 0.24, 0, ty - 0.003, rz - hd * 0.2, dark, 0.002);
    bx(b, bw * 0.26, 0.002, hd * 0.13, -bw * 0.04, ty + 0.002, rz - hd * 0.22, screenMat());
    for (const s of [-1, 1]) b.cyl(0.008 * k, 0.008 * k, 0.004, bw * 0.14, ty + 0.002, rz - hd * 0.2 + s * 0.022 * k, mat("#8a8f94"), 10);
    // a carry grip at the back
    rb(b, bw * 0.3, 0.03 * k, 0.025 * k, 0, h * 0.5, -d / 2 + 0.03 * k, black, 0.01);
  },

  robot_mower_vision: (b, w, d, h, f) => {
    // a wire-free robot mower: a smooth domed shell over two big rear wheels and two front
    // castors, a black bumper, and up front a mast with the camera and lidar head
    const dark = mat("#26282c", { roughness: 0.7 });
    const black = mat("#17181b", { roughness: 0.9 });
    const rim = mat("#6e7378", { roughness: 0.5 });
    // the small parts (castors, mast, head, button) keep to the mower's size
    const k = Math.min(w / 0.5, d / 0.62);
    const wr = Math.min(h * 0.3, d * 0.16);
    const ww = Math.min(0.06 * k, w * 0.12);
    const wx = w / 2 - ww / 2;
    const wz = -d / 2 + wr + 0.01;
    for (const s of [-1, 1]) wheel(b, s * wx, wr, wz, wr, ww, rim, 14);
    // the castors in their forks
    const cr = Math.min(0.035 * k, h * 0.12);
    for (const s of [-1, 1]) {
      const x = s * w * 0.22;
      const z = d / 2 - 0.09 * k;
      xcyl(b, cr, 0.026 * k, x, cr, z, black, 14);
      xcyl(b, cr * 0.5, 0.028 * k, x, cr, z, rim, 10);
      for (const q of [-1, 1]) bx(b, 0.006 * k, cr * 1.4, cr * 0.8, x + q * 0.017 * k, cr * 0.7, z - cr * 0.2, dark);
      bx(b, 0.04 * k, 0.012 * k, cr * 0.9, x, cr * 2.05, z - cr * 0.2, dark);
    }
    // the shell: a chassis, the skirt in the finish, a domed top
    const bw = w - 2 * ww - 0.016;
    const sd = d - 0.02;
    const sh = h * 0.6;
    b.add(taper(bw, sd * 0.9, bw, sd * 0.9, h * 0.2, 0.1), dark, 0, h * 0.08, 0);
    b.add(taper(bw, sd, bw - 0.02, sd - 0.02, h * 0.16, 0.14), f, 0, h * 0.22, 0);
    b.add(slab(bw + 0.006, sd + 0.006, 0.14, 0.008), black, 0, h * 0.36, 0);
    b.add(taper(bw - 0.02, sd - 0.02, bw * 0.8, sd * 0.78, sh - h * 0.36 - h * 0.08, 0.13), f, 0, h * 0.368, 0);
    // the dome, and where its surface is (for the parts sitting on it): height and slopes at (x, z)
    const dA = bw * 0.4;
    const dB = h * 0.08;
    const dC = sd * 0.39;
    const dY = sh - dB;
    b.sphere(1, 0, dY, 0, f, dA, dB, dC, 24);
    const onDome = (x: number, z: number) => {
      const q = Math.sqrt(Math.max(0.05, 1 - (x / dA) ** 2 - (z / dC) ** 2));
      return { y: dY + dB * q, rx: Math.atan((dB * z) / (dC * dC * q)), rz: Math.atan((-dB * x) / (dA * dA * q)) };
    };
    // the bumper across the nose, fenders over the wheels' shoulders
    const br = bw * 0.9;
    b.add(arcBand(br, br + 0.02, Math.PI * 0.32, Math.PI * 0.68, h * 0.12, 10).rotateX(Math.PI / 2).translate(0, h * 0.28, d / 2 - 0.004 - br - 0.02), black);
    for (const s of [-1, 1]) fender(b, s * wx, wr, wz, wr + 0.01, 0.01, ww + 0.01, f, 0.5, Math.PI - 0.6);
    // the mast with the camera and lidar head, a light ring at its foot
    const mz = d * 0.16;
    const my = onDome(0, mz).y - h * 0.012;
    const mh = h - my;
    b.cyl(0.035 * k, 0.035 * k, 0.006, 0, my, mz, ledMat("#7fd0ff"), 20);
    b.cyl(0.02 * k, 0.028 * k, mh * 0.55, 0, my + 0.004, mz, f, 16);
    const hy = my + mh * 0.55;
    b.cyl(0.042 * k, 0.042 * k, mh * 0.2, 0, hy, mz, dark, 20);
    b.cyl(0.045 * k, 0.045 * k, mh * 0.08, 0, hy + mh * 0.2, mz, mat("#0b0c0e", { roughness: 0.1, metalness: 0.4 }), 20);
    b.cyl(0.042 * k, 0.038 * k, h - hy - mh * 0.28, 0, hy + mh * 0.28, mz, f, 20);
    rb(b, 0.05 * k, mh * 0.18, 0.02 * k, 0, hy + mh * 0.02, mz + 0.034 * k, dark, 0.006);
    for (const s of [-1, 1]) zcyl(b, 0.007 * k, 0.004, s * 0.012 * k, hy + mh * 0.11, mz + 0.045 * k, mat("#0b0c0e", { roughness: 0.05, metalness: 0.6 }), 12);
    // the stop button and a display at the back, both sitting on the dome (tilted with it)
    const zb = -d * 0.18;
    const sb = onDome(bw * 0.12, zb);
    b.cyl(0.026 * k, 0.03 * k, 0.025 * k, bw * 0.12, sb.y - 0.006 * k, zb, mat("#d23a2a", { roughness: 0.45 }), 16);
    const sd2 = onDome(-bw * 0.1, zb);
    const n = v(0, 1, 0).applyEuler(new THREE.Euler(sd2.rx, 0, sd2.rz));
    const at = (o: number) => v(-bw * 0.1, sd2.y, zb).addScaledVector(n, o);
    const p0 = at(0);
    bx(b, bw * 0.24, 0.006, d * 0.08, p0.x, p0.y - 0.003, p0.z, dark, sd2.rx, 0, sd2.rz);
    const p1 = at(0.0035);
    bx(b, bw * 0.17, 0.002, d * 0.05, p1.x, p1.y - 0.001, p1.z, screenMat(), sd2.rx, 0, sd2.rz);
  },

  robot_mower_dock: (b, w, d, h, f) => {
    // a robot mower's charging station: a ribbed plate the mower drives up onto, the tower
    // at the back with its contacts reaching forward and a status light, ground pegs, and the
    // boundary wire leaving through the guides at both sides
    const dark = mat("#26282c", { roughness: 0.7 });
    const black = mat("#17181b", { roughness: 0.9 });
    const metal = mat(C.chrome, { metalness: 0.85, roughness: 0.25 });
    const ph = Math.min(0.03, h * 0.18);
    const zr = d / 2 - (d - 0.01) * 0.3; // where the ramp starts
    const yAt = (z: number) => (z < zr ? ph * 0.7 + (ph * 0.3 * (zr - z)) / (zr + d / 2) : (ph * 0.7 * (d / 2 - z)) / (d / 2 - zr));
    // the plate: thick at the back, a ramp at the front, dark rails along both sides
    b.add(profileX([[-d / 2, 0], [d / 2 - 0.01, 0], [d / 2, 0.003], [zr, ph * 0.7], [-d / 2 + 0.02, ph], [-d / 2, ph * 0.9]], w - 0.04), f);
    for (const s of [-1, 1]) b.add(profileX([[-d / 2 + 0.01, 0], [d / 2 - 0.02, 0], [zr, ph * 0.74], [-d / 2 + 0.01, ph * 1.04]], 0.02), dark, s * (w / 2 - 0.01), 0, 0);
    // grip ribs in two wheel tracks
    for (const s of [-1, 1])
      for (let i = 0; i < 8; i++) {
        const z = -d / 2 + 0.18 + (i * (d - 0.26)) / 7;
        bx(b, w * 0.22, 0.004, 0.012, s * w * 0.27, yAt(z) - 0.002, z, dark, z > zr ? Math.atan2(ph * 0.7, d / 2 - zr) : 0);
      }
    // ground pegs at the corners
    for (const sx of [-1, 1]) for (const z of [-d * 0.38, d * 0.18]) b.cyl(0.012, 0.012, 0.005, sx * (w / 2 - 0.06), yAt(z) - 0.001, z, black, 10);
    // the tower: a rounded body, a dark top with the light, the contact block and two prongs
    const tw = Math.min(0.26, w * 0.52);
    const tdp = Math.min(0.14, d * 0.2);
    const tz = -d / 2 + tdp / 2 + 0.01;
    b.add(taper(tw, tdp, tw * 0.9, tdp * 0.75, h - ph, 0.03, 1), f, 0, ph - 0.002, tz);
    b.add(slab(tw * 0.9 - 0.004, tdp * 0.75 - 0.004, 0.028, 0.004), dark, 0, h - 0.003, tz - tdp * 0.125);
    b.cyl(0.01, 0.01, 0.003, tw * 0.25, h - 0.001, tz - tdp * 0.1, ledMat("#3fd27a"), 12);
    const ch = Math.min(0.04, (h - ph) * 0.3);
    const cy = ph + Math.min(0.04, (h - ph) * 0.3);
    rb(b, tw * 0.6, ch, 0.03, 0, cy - ch / 2, tz + tdp / 2 - 0.005, black, 0.006);
    for (const s of [-1, 1]) zcyl(b, 0.005, 0.06, s * tw * 0.16, cy, tz + tdp / 2 + 0.03, metal, 8);
    // the wire guides at the back corners and the boundary wire out to both sides
    const wire = mat("#4f8f3a", { roughness: 0.6 });
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.05);
      const gz = -d / 2 + 0.06;
      rb(b, 0.05, 0.02, 0.07, x, ph * 0.9, gz, black, 0.006);
      bx(b, 0.012, 0.004, 0.072, x, ph * 0.9 + 0.018, gz, dark);
      b.rod(v(x - s * 0.025, ph * 0.9 + 0.006, gz), v(s * tw * 0.5, ph * 0.9 + 0.006, gz), 0.003, wire, 5);
      b.rod(v(x + s * 0.025, ph * 0.9 + 0.006, gz), v(s * (w / 2 - 0.004), 0.003, gz), 0.003, wire, 5);
    }
  },

  rtk_antenna: (b, w, d, h, f, color) => {
    // a reference antenna: a round base plate with screws and a collar, an aluminium mast
    // with its cable, the dome on top with a status light
    const black = color === "black";
    const base = mat("#2a2b2e", { roughness: 0.7 });
    const pole = mat(black ? "#3a3c40" : "#c4c7cb", { metalness: 0.6, roughness: 0.35 });
    const dark = mat("#1b1c1f", { roughness: 0.9 });
    const r = Math.min(w, d) / 2;
    b.cyl(r * 0.8, r * 0.86, 0.01, 0, 0, 0, base, 20);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      b.cyl(0.006, 0.006, 0.004, Math.cos(a) * r * 0.62, 0.01, Math.sin(a) * r * 0.62, mat(C.steel, { metalness: 0.7, roughness: 0.3 }), 8);
    }
    b.cyl(0.024, 0.03, 0.05, 0, 0.01, 0, base, 16);
    const dh = Math.min(0.07, h * 0.08);
    const top = h - dh;
    b.cyl(0.013, 0.013, top - 0.07, 0, 0.06, 0, pole, 12);
    b.cyl(0.02, 0.016, 0.03, 0, top - 0.03, 0, base, 14);
    // the dome: a lathe from the rim up over a flat crown
    const R = r * 0.95;
    const pts = [V2(0.0001, 0), V2(R * 0.9, 0), V2(R, dh * 0.12), V2(R * 0.98, dh * 0.4), V2(R * 0.86, dh * 0.75), V2(R * 0.6, dh * 0.95), V2(0.0001, dh)];
    b.add(new THREE.LatheGeometry(pts, 28), f, 0, top, 0);
    b.add(new THREE.TorusGeometry(R * 0.995, 0.003, 4, 28).rotateX(Math.PI / 2), black ? mat("#56595e") : base, 0, top + dh * 0.12, 0);
    b.add(new THREE.CylinderGeometry(0.004, 0.004, 0.003, 10).rotateX(Math.PI / 2), ledMat("#3fd27a"), 0, top + dh * 0.3, R * 0.985);
    // the cable down the mast into the ground
    b.rod(v(0.018, top - 0.02, 0), v(0.018, 0.08, 0), 0.0035, dark, 5);
    b.rod(v(0.018, 0.08, 0), v(r * 0.7, 0.012, 0), 0.0035, dark, 5);
  },

  robot_mower_garage: (b, w, d, h, f, color) => {
    // a shelter over the mower's dock: four posts, open at the front and the sides; a curved
    // roof sheet (in oak a pitched roof of boards on a ridge), a low back rail, ground feet
    const oak = color === "oak";
    const frame = oak ? f : mat(color === "white" ? "#d9d8d4" : "#2f3135", { roughness: 0.5, metalness: 0.3 });
    const dark = mat("#26282c", { roughness: 0.7 });
    const pr = Math.min(0.02, w * 0.025);
    const rise = Math.min(0.1, h * 0.22);
    const t = 0.012;
    const ph = h - rise - t;
    const px = w / 2 - 0.05;
    const pz = d / 2 - 0.06;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        if (oak) bx(b, pr * 2.2, ph, pr * 2.2, sx * px, 0, sz * pz, frame);
        else b.cyl(pr, pr, ph, sx * px, 0, sz * pz, frame, 10);
        bx(b, 0.08, 0.006, 0.08, sx * px, 0, sz * pz, dark);
      }
    // beams along both sides, a rail at the back
    for (const sx of [-1, 1]) bx(b, pr * 2, 0.04, 2 * pz + pr * 2, sx * px, ph - 0.04, 0, frame);
    bx(b, 2 * px, 0.035, pr * 2, 0, ph * 0.35, -pz, frame);
    if (oak) {
      // a pitched roof of boards on a ridge along z, rafters over the posts
      const half = w / 2;
      const ang = Math.atan2(rise, half);
      const len = Math.hypot(half, rise);
      const n = 4;
      for (const sx of [-1, 1])
        for (let i = 0; i < n; i++) {
          const s = (len * (i + 0.5)) / n;
          bx(b, len / n - 0.004, t, d, sx * s * Math.cos(ang), ph + rise - s * Math.sin(ang) - t / 2, 0, f, 0, 0, -sx * ang);
        }
      for (const sx of [-1, 1]) bx(b, 0.035, 0.008, d + 0.01, sx * 0.015, h - 0.016, 0, mat(mix("oak", "#000000", 0.3), { roughness: 0.7 }), 0, 0, -sx * Math.atan2(rise, w / 2));
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) b.rod(v(sx * px, ph - 0.01, sz * pz), v(0, ph + rise - 0.03, sz * pz), pr * 0.8, f, 6);
    } else {
      // the curved sheet: an arc from side to side, dark edge strips, rolled eaves, two ribs under it
      const half = w / 2;
      const R = (half * half + rise * rise) / (2 * rise);
      const a = Math.asin(Math.min(1, half / R));
      const yc = h - R - t;
      b.add(arcBand(R, R + t, Math.PI / 2 - a, Math.PI / 2 + a, d, 24).translate(0, yc, -d / 2), f);
      for (const sz of [-1, 1]) b.add(arcBand(R - 0.004, R + t + 0.003, Math.PI / 2 - a, Math.PI / 2 + a, 0.012, 24).translate(0, yc, sz * (d / 2 - 0.006) - 0.006), dark);
      for (const sx of [-1, 1]) zcyl(b, 0.008, d, sx * half * 0.985, ph + 0.006, 0, dark, 8);
      for (const sz of [-1, 1]) b.add(arcBand(R - 0.025, R, Math.PI / 2 - a * 0.95, Math.PI / 2 + a * 0.95, 0.03, 20).translate(0, yc, sz * pz - 0.015), frame);
    }
  },

  lawn_tractor: (b, w, d, h, _f, color) => {
    // a ride-on mower, driving to +z: a sloped bonnet with a grille and headlights, the
    // dash and steering wheel, a seat over the big rear wheels and their fenders, foot
    // boards, the cutting deck under the middle and the grass bag at the back
    const body = mat(hex(color), { roughness: 0.4 });
    const dark = mat("#232427", { roughness: 0.7 });
    const black = mat("#141517", { roughness: 0.85 });
    const rim = mat(color === "yellow" ? "#2b2c2e" : "#e2dfd5", { roughness: 0.5 });
    const X = w / 1.1;
    const Y = h / 1.15;
    const Z = d / 1.9;
    // wheels: big turf tyres at the back, small ones at the front
    const rr = Math.min(0.3 * Y, 0.17 * d);
    const rw = 0.22 * X;
    const zr = -d / 2 + 0.45 * Z;
    const rf = Math.min(0.19 * Y, rr * 0.66);
    const fw = 0.14 * X;
    const zf = d / 2 - 0.27 * Z;
    for (const s of [-1, 1]) {
      wheel(b, s * (w / 2 - rw / 2), rr, zr, rr, rw, rim, 20, 20);
      wheel(b, s * 0.4 * X, rf, zf, rf, fw, rim, 14, 16);
    }
    // the frame, the front axle, the deck with its skirt and anti-scalp rollers
    bx(b, 0.42 * X, 0.12 * Y, zf - zr + 0.3 * Z, 0, 0.2 * Y, (zf + zr) / 2, dark);
    xcyl(b, 0.025 * X, 0.8 * X - fw, 0, rf, zf, dark, 8);
    const dz0 = zr + rr + 0.02 * Z;
    const dz1 = zf - rf - 0.03 * Z;
    const dw = 0.98 * X;
    b.add(taper(dw, dz1 - dz0, dw - 0.04 * X, dz1 - dz0 - 0.06 * Z, 0.11 * Y, 0.14 * Z), body, 0, 0.07 * Y, (dz0 + dz1) / 2);
    bx(b, dw + 0.01, 0.025 * Y, dz1 - dz0 + 0.01, 0, 0.055 * Y, (dz0 + dz1) / 2, dark);
    for (const s of [-1, 1]) xcyl(b, 0.035 * Y, 0.03, s * (dw / 2 + 0.01), 0.04 * Y, dz1 - 0.02 * Z, black, 12);
    // the discharge chute out of the deck to the bag
    b.rod(v(-dw * 0.3, 0.14 * Y, dz0 + 0.05 * Z), v(-0.16 * X, 0.42 * Y, -d / 2 + 0.42 * Z), 0.06 * X, black, 10);
    // foot boards along both sides
    for (const s of [-1, 1]) {
      bx(b, 0.26 * X, 0.025 * Y, zf - rf - (zr + rr) - 0.08 * Z, s * 0.34 * X, 0.28 * Y, (zf - rf + zr + rr) / 2, black);
      for (let i = 0; i < 5; i++) bx(b, 0.22 * X, 0.006, 0.012, s * 0.34 * X, 0.305 * Y, zr + rr + 0.08 * Z + i * 0.07 * Z, dark);
    }
    // the bonnet: a side profile extruded across, a grille in the nose, headlights
    const zb = zf - 0.55 * Z;
    const nose = d / 2;
    const bonnet: [number, number][] = [
      [zb, 0.3 * Y], [nose - 0.06 * Z, 0.27 * Y], [nose - 0.01 * Z, 0.34 * Y], [nose, 0.44 * Y], [nose - 0.04 * Z, 0.53 * Y],
      [nose - 0.14 * Z, 0.59 * Y], [zb + 0.12 * Z, 0.66 * Y], [zb, 0.68 * Y],
    ];
    const bw = 0.5 * X;
    b.add(profileX(bonnet, bw), body);
    for (let i = 0; i < 4; i++) bx(b, bw * 0.6, 0.012 * Y, 0.012, 0, 0.3 * Y + i * 0.028 * Y, nose - 0.03 * Z + i * 0.006 * Z, black);
    const lamp = mat("#f3f1e4", { roughness: 0.2, emissive: "#6b6650", emissiveIntensity: 0.4 });
    for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.035 * X, 0.035 * X, 0.012, 14).rotateX(Math.PI / 2 - 0.75), lamp, s * bw * 0.3, 0.535 * Y, nose - 0.06 * Z);
    // a front bumper bar
    bx(b, bw + 0.08 * X, 0.04 * Y, 0.04 * Z, 0, 0.2 * Y, nose - 0.025 * Z, dark);
    // the dash, the steering column and wheel
    const dashZ = zb - 0.02 * Z;
    b.add(profileX([[dashZ - 0.16 * Z, 0.3 * Y], [dashZ + 0.04 * Z, 0.3 * Y], [dashZ + 0.04 * Z, 0.7 * Y], [dashZ - 0.04 * Z, 0.78 * Y], [dashZ - 0.16 * Z, 0.72 * Y]], 0.4 * X), dark);
    bx(b, 0.1 * X, 0.004, 0.04 * Z, 0.09 * X, 0.735 * Y, dashZ - 0.03 * Z, screenMat(), Math.atan2(0.08, 0.08));
    b.cyl(0.012, 0.012, 0.03, -0.1 * X, 0.72 * Y, dashZ - 0.1 * Z, mat("#d23a2a", { roughness: 0.4 }), 10);
    const sw = v(0, 0.98 * Y, dashZ - 0.2 * Z);
    b.rod(v(0, 0.74 * Y, dashZ - 0.04 * Z), sw, 0.025 * X, dark, 10);
    const tilt = -0.5;
    const swR = 0.17 * X;
    b.add(new THREE.TorusGeometry(swR, 0.018 * X, 6, 24).rotateX(Math.PI / 2 + tilt), black, sw.x, sw.y, sw.z);
    for (const a of [Math.PI / 2, Math.PI * 1.2, -Math.PI * 0.2]) {
      const e = v(Math.cos(a) * swR, 0, Math.sin(a) * swR).applyAxisAngle(v(1, 0, 0), tilt);
      b.rod(sw, sw.clone().add(e), 0.012 * X, black, 6);
    }
    // the rear body with its fenders and the cutting-height lever
    const rz0 = zr - rr * 0.6;
    const rz1 = zb - 0.18 * Z;
    bx(b, 0.5 * X, 0.24 * Y, rz1 - rz0, 0, 0.3 * Y, (rz0 + rz1) / 2, body);
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - rw / 2);
      fender(b, x, rr, zr, rr + 0.04 * Y, 0.02 * Y, rw + 0.04 * X, body, 0.05, Math.PI - 0.15);
      bx(b, w / 2 - 0.25 * X, 0.02 * Y, 2 * rr * 0.9, s * (0.25 * X + (w / 2 - 0.25 * X) / 2), 0.52 * Y, zr, body);
    }
    b.rod(v(-0.3 * X, 0.54 * Y, zr + 0.1 * Z), v(-0.33 * X, 0.7 * Y, zr + 0.16 * Z), 0.01, dark, 6);
    b.sphere(0.022, -0.33 * X, 0.7 * Y, zr + 0.16 * Z, black, 1, 1, 1, 10);
    // the seat
    const seat = mat("#1d1e21", { roughness: 0.75 });
    const sz = zr + 0.08 * Z;
    rb(b, 0.46 * X, 0.04 * Y, 0.42 * Z, 0, 0.54 * Y, sz, dark, 0.01);
    rb(b, 0.44 * X, 0.08 * Y, 0.4 * Z, 0, 0.58 * Y, sz + 0.02 * Z, seat, 0.035, 2);
    const back0 = v(0, 0.64 * Y, sz - 0.18 * Z);
    const back1 = v(0, 0.98 * Y, sz - 0.27 * Z);
    const bk = b.add(new RoundedBoxGeometry(0.42 * X, back0.distanceTo(back1), 0.07 * Z, 2, 0.03), seat);
    bk.position.copy(back0).add(back1).multiplyScalar(0.5);
    bk.rotation.x = -Math.atan2(back0.z - back1.z, back1.y - back0.y);
    // the grass bag behind: a fabric bag on a frame under a hard top in the finish
    const gz0 = -d / 2;
    const gz1 = sz - 0.3 * Z;
    const gb = Math.min(0.62 * X, w - 2 * rw - 0.04 * X);
    const fabric = mat("#3b4038", { roughness: 1 });
    b.add(taper(gb * 0.9, gz1 - gz0 - 0.04 * Z, gb, gz1 - gz0, 0.42 * Y, 0.06), fabric, 0, 0.36 * Y, (gz0 + gz1) / 2 + 0.01 * Z);
    b.box(gb + 0.1 * X, 0.12 * Y, gz1 - gz0, 0, 0.78 * Y, (gz0 + gz1) / 2, body, 0.04);
    rb(b, 0.2 * X, 0.03, 0.04 * Z, 0, 0.9 * Y, gz0 + 0.03 * Z, black, 0.012);
    for (const s of [-1, 1]) bx(b, 0.02 * X, 0.5 * Y, 0.02 * Z, s * gb * 0.46, 0.32 * Y, gz0 + 0.02 * Z, dark);
  },
};
