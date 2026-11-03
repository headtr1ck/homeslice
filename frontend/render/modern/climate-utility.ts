// More detailed built-in pieces: climate utility. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import type { Build } from "../modern";
import { Builder, C, back, foliage, ledMat, mat, matrix, opal, part, radiatorValve, random, surface, v, warmMat, wickerMat } from "../modern";

// ----- small helpers -----

/** A box merged with others of its material (bottom centre at x, y, z, turned rx, ry, rz). */
function bx(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.batch(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), m, matrix(x, y, z, rx, ry, rz));
}

/** Points of a rounded rectangle (counter-clockwise) for shapes. */
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number, seg = 4): [number, number][] {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  const out: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  return out;
}

/** Points along an arc around (cx, cy) from angle a0 to a1. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, seg = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** The geometry with flat (face) normals: thin wires and faceted parts that must not shade dark. */
function flat(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

/** A bar of section sw × sd from a to c, merged with others of its material. */
function beam(b: Builder, a: THREE.Vector3, c: THREE.Vector3, sw: number, sd: number, m: THREE.Material) {
  b.batch(new THREE.BoxGeometry(sw, a.distanceTo(c), sd), m, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), c.clone().sub(a).normalize()), v(1, 1, 1)));
}

const shapeOf = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));

/**
 * A side profile in (z, y), extruded across the width w along x and centred: the bodies of
 * wall air conditioners, convectors.
 */
function profileX(pts: [number, number][], w: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: w, bevelEnabled: false, curveSegments: 4 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(w / 2, 0, 0);
  return geo;
}

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

/**
 * A plate seen from the front with vertical channels (a panel radiator's face): its cross
 * section in (x, z) is a wave of `n` channels, extruded up from y0 by h.
 */
function channelled(w: number, h: number, n: number, z0: number, depth: number, wave: number, y0: number): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  const steps = n * 6;
  for (let i = 0; i <= steps; i++) {
    const x = -w / 2 + (w * i) / steps;
    const s = Math.abs(Math.sin((i / 6) * Math.PI));
    pts.push([x, -(z0 + depth - wave + wave * s)]);
  }
  pts.push([w / 2, -z0], [-w / 2, -z0]);
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts.reverse()), { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  return geo;
}

/** A row of thin slats (grille bars) across x at height y, merged. */
function grilleX(b: Builder, x0: number, x1: number, pitch: number, bw: number, y: number, z: number, depth: number, m: THREE.Material, bh = 0.004) {
  const n = Math.max(1, Math.floor((x1 - x0) / pitch));
  const s = (x1 - x0 - (n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) bx(b, bw, bh, depth, x0 + s + i * pitch, y, z, m);
}

/** Horizontal slats stacked up between y0 and y1 (louvres), merged. */
function louvres(b: Builder, w: number, y0: number, y1: number, pitch: number, z: number, m: THREE.Material, tilt = 0, t = 0.006, depth = 0.01) {
  const n = Math.max(1, Math.floor((y1 - y0) / pitch));
  for (let i = 0; i < n; i++) bx(b, w, t, depth, 0, y0 + (i + 0.5) * ((y1 - y0) / n), z, m, tilt);
}

/** A thin rod from a to b, merged with others of its material. */
function rodB(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r: number, m: THREE.Material, seg = 6) {
  b.batch(flat(new THREE.CylinderGeometry(r, r, a.distanceTo(c), seg)), m, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), c.clone().sub(a).normalize()), v(1, 1, 1)));
}

// ----- outdoor units -----

/** A curved fan blade around +x, from the hub at r0 to r1, pitched about its length. */
function fanBlade(r0: number, r1: number, pitch = 0.18): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  const lead = (t: number) => 0.2 + 0.45 * t * t;
  const trail = (t: number) => -0.35 - 0.15 * t;
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = r0 + (r1 - r0) * t;
    pts.push([Math.cos(lead(t)) * r, Math.sin(lead(t)) * r]);
  }
  for (const p of arc(0, 0, r1, lead(1), trail(1), 5).slice(1)) pts.push(p);
  for (let i = N - 1; i >= 0; i--) {
    const t = i / N;
    const r = r0 + (r1 - r0) * t;
    pts.push([Math.cos(trail(t)) * r, Math.sin(trail(t)) * r]);
  }
  const geo = new THREE.ShapeGeometry(shapeOf(pts.reverse()));
  geo.rotateX(pitch);
  return geo;
}

/**
 * An outdoor unit (heat pump or air conditioner): a cabinet with a lid, a big round fan
 * behind a bell-mouth ring and a wire grille, finned coil on the side and back, a service
 * cover with pipe stubs, feet or wall brackets. The fan turns while its climate entity runs.
 */
function outdoor(b: Builder, w: number, d: number, h: number, f: THREE.Material, bracket: boolean, big = false) {
  const steel = mat(C.steel, { metalness: 0.5, roughness: 0.4 });
  const rubber = mat(C.black);
  const dark = mat("#1d1f22", { roughness: 0.9 });
  const coil = mat("#6d7176", { metalness: 0.5, roughness: 0.5 });
  const wire = mat("#a7acb1", { metalness: 0.5, roughness: 0.4 });
  let bd = d;
  let zc = 0;
  let y0: number;
  if (bracket) {
    // two L-brackets from the wall: an arm under the unit and an upright behind it
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.12);
      bx(b, 0.04, 0.04, d, x, 0, 0, steel);
      bx(b, 0.04, h * 0.6, 0.03, x, 0, back(d) + 0.015, steel);
      for (const z of [-0.08, d / 2 - 0.08]) bx(b, 0.06, 0.025, 0.06, x, 0.04, z, rubber);
      for (const y of [h * 0.25, h * 0.5]) b.box(0.016, 0.016, 0.01, x, y, back(d) + 0.032, mat("#6a6e72"));
    }
    bd = d - 0.08;
    zc = 0.04;
    y0 = 0.065;
  } else {
    // two rails with rubber pads
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.15);
      bx(b, 0.07, 0.065, d, x, 0, 0, mat("#3a3d41"));
      for (const sz of [-1, 1]) bx(b, 0.08, 0.02, 0.1, x, 0, sz * (d / 2 - 0.06), rubber);
    }
    y0 = 0.07;
  }
  const bh = h - y0;
  const zf = zc + bd / 2;
  b.box(w, bh - 0.02, bd, 0, y0, zc, f, big ? 0.03 : 0.015);
  // the lid, a little wider, a seam under it
  b.box(w + 0.008, 0.03, bd + 0.008, 0, h - 0.03, zc, f, 0.01);
  bx(b, w - 0.01, 0.004, bd - 0.01, 0, h - 0.034, zc, dark);
  // the fan opening on the left two thirds
  const r = Math.min(w * 0.3, bh * 0.41);
  const cx = -w / 2 + Math.max(r + 0.05, w * 0.37);
  const cy = y0 + bh / 2 - 0.01;
  b.add(new THREE.CircleGeometry(r, 40), dark, cx, cy, zf + 0.001);
  b.add(new THREE.TorusGeometry(r + 0.012, 0.016, 6, 32), f, cx, cy, zf);
  // the fan: a hub and swept blades behind the grille, turning while it runs
  const blade = mat("#3c3f43", { side: THREE.DoubleSide, roughness: 0.6 });
  b.spinner(cx, cy, zf + 0.012, "z", () => {
    b.add(new THREE.CylinderGeometry(r * 0.17, r * 0.19, 0.03, 18), blade, cx, cy, zf + 0.012).rotation.x = Math.PI / 2;
    const n = big ? 4 : 3;
    for (let i = 0; i < n; i++) b.add(fanBlade(r * 0.15, r * 0.92), blade, cx, cy, zf + 0.012).rotation.z = (i / n) * Math.PI * 2;
  });
  // the wire grille: rings and spokes, a badge in the middle
  const rings = big ? 6 : 5;
  for (let k = 1; k <= rings; k++) b.batch(flat(new THREE.TorusGeometry((r * k) / rings, 0.0035, 3, 28)), wire, matrix(cx, cy, zf + 0.03));
  for (let i = 0; i < 4; i++) b.batch(new THREE.BoxGeometry(0.006, r * 2, 0.006), wire, matrix(cx, cy, zf + 0.03, 0, 0, (i / 4) * Math.PI));
  b.add(new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.012, 20), wire, cx, cy, zf + 0.03).rotation.x = Math.PI / 2;
  // the right: a seam, nameplate, a status light, vent slots
  const rx0 = cx + r + 0.04;
  if (w / 2 - rx0 > 0.12) {
    bx(b, 0.004, bh - 0.08, 0.004, rx0, y0 + 0.04, zf, dark);
    const px = (rx0 + w / 2) / 2;
    bx(b, Math.min(w * 0.18, w / 2 - rx0 - 0.06), 0.06, 0.01, px, h * 0.8, zf - 0.004, mat(C.steel));
    b.box(0.03, 0.012, 0.004, px, h * 0.7, zf + 0.001, ledMat());
    for (let i = 0; i < 4; i++) bx(b, Math.min(0.14, w / 2 - rx0 - 0.08), 0.008, 0.004, px, y0 + 0.06 + i * 0.03, zf, dark);
  } else {
    b.box(0.03, 0.012, 0.004, w / 2 - 0.06, h * 0.75, zf + 0.001, ledMat());
  }
  // the finned coil on the left side and the back
  const fy0 = y0 + 0.04;
  const fy1 = h - 0.07;
  b.box(0.004, fy1 - fy0, bd - 0.08, -w / 2 - 0.001, fy0, zc, dark);
  b.box(w - 0.08, fy1 - fy0, 0.004, 0, fy0, zc - bd / 2 - 0.001, dark);
  const nf = Math.floor((fy1 - fy0) / 0.022);
  for (let i = 0; i < nf; i++) {
    const y = fy0 + (i + 0.5) * ((fy1 - fy0) / nf);
    bx(b, 0.006, 0.005, bd - 0.08, -w / 2 - 0.003, y, zc, coil);
    bx(b, w - 0.08, 0.005, 0.006, 0, y, zc - bd / 2 - 0.003, coil);
  }
  for (const z of [-1, 1]) bx(b, 0.008, fy1 - fy0, 0.008, -w / 2 - 0.003, fy0, zc + z * (bd / 2 - 0.08), coil);
  // the service cover on the right side, insulated pipes leaving it
  b.box(0.012, bh * 0.42, bd * 0.5, w / 2 + 0.002, y0 + bh * 0.08, zc + bd * 0.18, f, 0.004);
  bx(b, 0.006, 0.02, bd * 0.2, w / 2 + 0.009, y0 + bh * 0.42, zc + bd * 0.18, dark);
  const copper = mat("#b87333", { metalness: 0.6, roughness: 0.35 });
  for (const [i, y] of [y0 + bh * 0.14, y0 + bh * 0.24].entries()) {
    const pz = zc - bd * 0.12 - i * 0.06;
    b.cyl(0.012, 0.012, 0.03, w / 2 + 0.012, y, pz, copper, 10).rotation.z = Math.PI / 2;
    b.cyl(0.022, 0.022, 0.03, w / 2 + 0.035, y, pz, rubber, 12).rotation.z = Math.PI / 2;
  }
}

// ----- indoor air conditioning -----

/** A wall split unit's side profile in (z, y): flat back, rounded top, an outlet under the front. */
function splitProfile(d: number, h: number): [number, number][] {
  const r = Math.min(0.05, h * 0.2);
  return [
    [-d / 2 + 0.03, 0],
    [-d * 0.05, 0],
    ...arc(d / 2 - 0.05, h * 0.3, 0.05, -Math.PI / 2 + 0.3, 0.2, 4),
    [d / 2 - 0.004, h * 0.4],
    ...arc(d / 2 - r, h - r, r, 0, Math.PI / 2, 5),
    ...arc(-d / 2 + 0.02, h - 0.02, 0.02, Math.PI / 2, Math.PI, 2),
    [-d / 2, h * 0.1],
  ];
}

// ----- radiators -----

/** A radiator's top cover slots over its width, merged. */
function topSlots(b: Builder, w: number, y: number, z: number, depth: number, pitch = 0.025) {
  grilleX(b, -w / 2 + 0.03, w / 2 - 0.03, pitch, pitch * 0.4, y, z, depth, mat("#26282b"), 0.002);
}

// ----- washers and dryers -----

/**
 * A front-loading washer or dryer: a body with a top seam and plinth, a control panel with
 * the detergent drawer, a display and a program dial, a round door (a ring in the accent,
 * a glass porthole) over the drum whose paddles turn while it runs.
 */
function laundryUnit(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, kind: "washer" | "dryer") {
  const dark = mat("#26282b");
  const fz = d / 2;
  b.box(w, h - 0.02, d - 0.01, 0, 0.02, -0.005, f, 0.012);
  b.box(w - 0.04, 0.025, d - 0.06, 0, 0, 0, dark);
  // the top: a slightly proud lid, a seam
  b.box(w, 0.018, d, 0, h - 0.018, 0, f, 0.006);
  bx(b, w - 0.01, 0.003, 0.004, 0, h - 0.022, fz - 0.002, dark);
  // the control panel
  const ph = Math.min(0.12, h * 0.14);
  const py = h - 0.025 - ph;
  bx(b, w - 0.02, ph, 0.012, 0, py, fz - 0.002, mat(kind === "washer" ? C.ceramic : "#e3e6e9", { roughness: 0.4 }));
  bx(b, w - 0.02, 0.003, 0.004, 0, py - 0.004, fz, dark);
  // the detergent drawer (washer) or water tank (dryer) on the left, with a grip
  const dw = w * 0.32;
  bx(b, dw, ph - 0.025, 0.012, -w / 2 + 0.02 + dw / 2, py + 0.012, fz + 0.006, mat(kind === "washer" ? "#f1f1ef" : "#eef0f2", { roughness: 0.4 }));
  bx(b, dw * 0.5, 0.008, 0.004, -w / 2 + 0.02 + dw / 2, py + 0.02, fz + 0.012, dark);
  // display, buttons, dial
  bx(b, 0.11, 0.04, 0.004, w * 0.02, py + ph * 0.42, fz + 0.005, mat(C.screen, { roughness: 0.15, metalness: 0.2 }));
  for (let i = 0; i < 3; i++) bx(b, 0.018, 0.01, 0.006, w * 0.02 - 0.035 + i * 0.035, py + ph * 0.12, fz + 0.005, mat("#b9bdc1"));
  b.add(new THREE.CylinderGeometry(0.03, 0.032, 0.022, 24), a, w * 0.3, py + ph / 2, fz + 0.015).rotation.x = Math.PI / 2;
  b.add(new THREE.TorusGeometry(0.036, 0.004, 4, 24), mat("#b9bdc1"), w * 0.3, py + ph / 2, fz + 0.006);
  b.box(0.004, 0.018, 0.004, w * 0.3, py + ph / 2 + 0.008, fz + 0.026, dark);
  b.box(0.012, 0.012, 0.004, w * 0.16, py + ph * 0.6, fz + 0.007, ledMat());
  // the door: a grey bezel, the ring in the accent
  const r = Math.min(w * 0.34, (py - 0.08) * 0.45);
  const cy = 0.05 + (py - 0.05) * 0.5;
  b.add(new THREE.CircleGeometry(r + 0.035, 40), mat("#d5d8db", { roughness: 0.5 }), 0, cy, fz + 0.007);
  b.add(new THREE.TorusGeometry(r, 0.03, 8, 32), a, 0, cy, fz + 0.018);
  // the drum behind the glass: a dark seal, the steel drum, its paddles and laundry turning
  const drum = mat(kind === "washer" ? "#9aa0a6" : "#b9bec3", { metalness: 0.6, roughness: 0.35 });
  b.add(new THREE.CircleGeometry(r * 0.98, 36), mat("#202326"), 0, cy, fz + 0.009);
  b.add(new THREE.CircleGeometry(r * 0.78, 36), drum, 0, cy, fz + 0.01);
  b.add(new THREE.RingGeometry(r * 0.5, r * 0.53, 32), mat("#7e8389", { metalness: 0.6 }), 0, cy, fz + 0.011);
  b.spinner(0, cy, fz + 0.012, "z", () => {
    for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.035, r * 0.3, 0.012).translate(0, r * 0.55, 0), mat("#6c7176", { metalness: 0.5 }), 0, cy, fz + 0.012).rotation.z = (i / 3) * Math.PI * 2;
    const rand = random(kind === "washer" ? 41 : 43);
    for (let i = 0; i < 4; i++) {
      const a0 = -Math.PI / 2 + (rand() - 0.5) * 1.6;
      const rr = r * (0.4 + rand() * 0.25);
      b.sphere(r * 0.2, Math.cos(a0) * rr, cy + Math.sin(a0) * rr, fz + 0.014, mat(C.clothes[(i * 2) % C.clothes.length]), 1.3, 0.9, 0.25, 8);
    }
  });
  // the glass: a shallow tinted dome
  const glassM = mat(kind === "washer" ? "#5f7f8f" : "#6b7378", { transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.2 });
  const R = r * 1.6;
  const th = Math.asin(1 / 1.6);
  b.add(new THREE.SphereGeometry(R, 28, 3, 0, Math.PI * 2, 0, th), glassM, 0, cy, fz + 0.04 - R).rotation.x = Math.PI / 2;
  // a handle on the right of the ring, the hinge on the left
  bx(b, 0.02, 0.07, 0.02, r + 0.02, cy - 0.035, fz + 0.012, a);
  bx(b, 0.03, 0.08, 0.016, -r - 0.025, cy - 0.04, fz + 0.004, mat("#c3c7cb"));
  // a service flap low on the right; a dryer's condenser vents
  b.box(0.1, 0.05, 0.004, w / 2 - 0.08, 0.035, fz + 0.001, f, 0.002);
  bx(b, 0.1, 0.002, 0.003, w / 2 - 0.08, 0.087, fz + 0.002, dark);
  if (kind === "dryer") for (let i = 0; i < 8; i++) bx(b, 0.004, 0.03, 0.003, -w / 2 + 0.06 + i * 0.015, 0.045, fz + 0.002, dark);
}

// ----- tools on a pegboard -----

/** The holes of a pegboard between x0..x1 and y0..y1, on its face at z (batched). */
function pegHoles(b: Builder, x0: number, x1: number, y0: number, y1: number, z: number) {
  const holes = mat("#2f2a25");
  for (let x = x0 + 0.05; x < x1 - 0.02; x += 0.05) for (let y = y0 + 0.05; y < y1 - 0.02; y += 0.05) b.batch(new THREE.CircleGeometry(0.0045, 4), holes, matrix(x, y, z));
}

/**
 * Tools hung on a pegboard between x0..x1 and y0..y1, in front of z: a hammer, a saw,
 * screwdrivers, spanners, pliers, a tape measure, a spirit level and a drill.
 */
function pegTools(b: Builder, x0: number, x1: number, y0: number, y1: number, z: number) {
  const W = x1 - x0;
  const H = y1 - y0;
  const X = (t: number) => x0 + W * t;
  const Y = (t: number) => y0 + H * t;
  const red = mat("#c0392b");
  const yellow = mat("#f0c02b");
  const steel = mat(C.steel, { metalness: 0.7, roughness: 0.3 });
  const dark = mat("#2b2d31");
  const wood = mat("#a9784e");
  const hook = mat("#8d9196", { metalness: 0.6 });
  const peg = (x: number, y: number) => bx(b, 0.006, 0.006, 0.03, x, y, z + 0.015, hook);
  // a hammer, head up
  peg(X(0.06), Y(0.62));
  bx(b, 0.025, H * 0.38, 0.02, X(0.06), Y(0.3), z + 0.02, wood);
  bx(b, 0.11, 0.035, 0.028, X(0.06) + 0.015, Y(0.68), z + 0.02, steel);
  bx(b, 0.04, 0.012, 0.028, X(0.06) - 0.055, Y(0.68) + 0.016, z + 0.02, steel, 0, 0, 0.5);
  // a saw: the blade and its handle
  const sx = X(0.14);
  const blade = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.4, 0.035), new THREE.Vector2(0.4, 0.11), new THREE.Vector2(0, 0.12)]);
  b.add(new THREE.ExtrudeGeometry(blade, { depth: 0.002, bevelEnabled: false }), steel, sx + 0.08, Y(0.62), z + 0.012);
  b.box(0.1, 0.12, 0.022, sx + 0.04, Y(0.62), z + 0.02, red, 0.012);
  bx(b, 0.05, 0.04, 0.024, sx + 0.035, Y(0.62) + 0.045, z + 0.021, mat("#2f2a25"));
  peg(sx + 0.3, Y(0.62) + 0.12);
  // screwdrivers in a rack
  const rx = X(0.56);
  bx(b, 0.2, 0.02, 0.05, rx, Y(0.74), z + 0.025, dark);
  for (let i = 0; i < 5; i++) {
    const x = rx - 0.08 + i * 0.04;
    b.cyl(0.004, 0.004, 0.12, x, Y(0.74) - 0.12, z + 0.03, steel, 6);
    b.cyl(0.013, 0.011, 0.09, x, Y(0.74) + 0.02, z + 0.03, i % 2 ? red : yellow, 10);
  }
  // spanners from small to large
  for (let i = 0; i < 5; i++) {
    const x = X(0.42) + i * 0.03;
    const len = 0.12 + i * 0.025;
    peg(x, Y(0.5));
    bx(b, 0.012 + i * 0.002, len, 0.005, x, Y(0.5) - len, z + 0.012, steel);
    b.add(flat(new THREE.TorusGeometry(0.012 + i * 0.002, 0.004, 4, 10)), steel, x, Y(0.5) - len - 0.008, z + 0.012);
  }
  // pliers: two handles in red crossing at the joint
  const px = X(0.78);
  for (const s of [-1, 1]) bx(b, 0.016, 0.16, 0.01, px + s * 0.02, Y(0.32), z + 0.018, red, 0, 0, s * 0.15);
  bx(b, 0.026, 0.06, 0.012, px, Y(0.32) + 0.15, z + 0.02, steel);
  peg(px, Y(0.32) + 0.2);
  // a tape measure on a peg
  b.cyl(0.04, 0.04, 0.03, X(0.9), Y(0.62), z + 0.03, yellow, 18).rotation.x = Math.PI / 2;
  b.cyl(0.02, 0.02, 0.032, X(0.9), Y(0.62), z + 0.03, dark, 12).rotation.x = Math.PI / 2;
  // a spirit level along the bottom
  bx(b, Math.min(0.6, W * 0.5), 0.035, 0.022, X(0.3), Y(0.06), z + 0.018, yellow);
  for (const t of [-0.2, 0, 0.2]) bx(b, 0.03, 0.014, 0.004, X(0.3) + t * Math.min(0.6, W * 0.5), Y(0.06) + 0.011, z + 0.03, mat("#8fd06a", { transparent: true, opacity: 0.8 }));
  for (const sxx of [-1, 1]) peg(X(0.3) + sxx * 0.2, Y(0.06) - 0.012);
  // a drill on its holder
  const dx = X(0.92);
  bx(b, 0.1, 0.012, 0.08, dx, Y(0.2), z + 0.04, dark);
  bx(b, 0.05, 0.13, 0.05, dx, Y(0.2) + 0.012, z + 0.04, mat("#2a8a7a"));
  b.box(0.06, 0.05, 0.16, dx, Y(0.2) + 0.13, z + 0.06, mat("#2a8a7a"), 0.012);
  b.cyl(0.006, 0.006, 0.05, dx, Y(0.2) + 0.155, z + 0.16, steel, 8).rotation.x = Math.PI / 2;
  bx(b, 0.06, 0.05, 0.06, dx, Y(0.2) - 0.04, z + 0.04, dark);
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  ac_outdoor: (b, w, d, h, f) => outdoor(b, w, d, h, f, false),
  ac_outdoor_wall: (b, w, d, h, f) => outdoor(b, w, d, h, f, true),
  heat_pump: (b, w, d, h, f) => outdoor(b, w, d, h, f, false, true),

  ac_split: (b, w, d, h, f) => {
    // a classic wall unit: a curved body, a front panel seam, an intake grille on top,
    // the outlet underneath with its vanes and louvre flap, a display at the front right
    const dark = mat("#26282b");
    const grey = mat("#c9cdd1", { roughness: 0.5 });
    b.add(profileX(splitProfile(d, h), w - 0.02), f);
    for (const sx of [-1, 1]) {
      const cap = profileX(splitProfile(d - 0.002, h - 0.002), 0.012);
      cap.translate(sx * (w / 2 - 0.006), 0.001, 0);
      b.add(cap, grey);
    }
    bx(b, w - 0.03, 0.003, 0.004, 0, h * 0.42, d / 2 - 0.003, mat("#b9bdc1"));
    // intake grille on top
    grilleX(b, -w / 2 + 0.06, w / 2 - 0.06, 0.022, 0.01, h - 0.001, -d * 0.12, d * 0.45, mat("#aeb3b8"), 0.003);
    // the outlet: a dark mouth along the slanted bottom, vanes inside, the flap in front
    const z1 = d / 2 - 0.05;
    const z0 = -d * 0.05;
    const slope = Math.atan2(h * 0.25, z1 - z0);
    const mz = (z1 + z0) / 2;
    b.box(w - 0.06, 0.004, (z1 - z0) * 1.05, 0, h * 0.12, mz, dark)!.rotation.x = slope;
    for (let i = 0; i < Math.floor((w - 0.1) / 0.06); i++) bx(b, 0.004, 0.03, 0.05, -w / 2 + 0.07 + i * 0.06, h * 0.07, mz, mat("#3a3d41"), slope);
    const flap = b.box(w - 0.08, 0.008, 0.07, 0, h * 0.08, z1 - 0.01, mat("#e9ebed", { roughness: 0.5 }), 0.003)!;
    flap.rotation.x = 0.45;
    // the display: a dark window, the status light, a temperature readout
    bx(b, 0.09, 0.025, 0.004, w * 0.3, h * 0.55, d / 2 - 0.002, mat(C.screen, { roughness: 0.15 }));
    b.box(0.03, 0.01, 0.003, w * 0.3 - 0.02, h * 0.55 + 0.008, d / 2 + 0.001, ledMat());
    b.box(0.016, 0.01, 0.003, w * 0.3 + 0.022, h * 0.55 + 0.008, d / 2 + 0.001, mat("#9fd6f0", { emissive: "#6fc0f0", emissiveIntensity: 0.6 }));
  },

  ac_wall_design: (b, w, d, h, f) => {
    // a flat designer unit: a slim body behind a flat front panel in the finish with a
    // shadow gap, a thin outlet slot with its flap, a light line, side vents
    const dark = mat("#26282b");
    const body = mat("#dcdfe2", { roughness: 0.5 });
    const prof: [number, number][] = [[-d / 2 + 0.05, 0], [d / 2 - 0.07, 0], [d / 2 - 0.035, h * 0.15], [d / 2 - 0.04, h], [-d / 2 + 0.015, h], [-d / 2, h - 0.015], [-d / 2, h * 0.12]];
    b.add(profileX(prof, w - 0.03), body);
    b.add(profileZ(roundRect(-w / 2, 0.04, w / 2, h, 0.012), 0.025, d / 2 - 0.03, 0.004), f);
    bx(b, w - 0.06, 0.003, 0.004, 0, 0.034, d / 2 - 0.038, dark);
    // the outlet underneath: a dark slot, the flap
    bx(b, w - 0.08, 0.004, d * 0.4, 0, 0.012, d * 0.08, dark);
    b.box(w - 0.1, 0.008, 0.05, 0, 0.02, d / 2 - 0.07, mat("#e6e8ea", { roughness: 0.5 }), 0.003)!.rotation.x = 0.35;
    b.box(w * 0.18, 0.004, 0.002, 0, h * 0.25, d / 2 + 0.001, ledMat("#f2f2f2"));
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) bx(b, 0.004, 0.006, d * 0.4, sx * (w / 2 - 0.013), h * 0.35 + i * 0.03, -d * 0.12, dark);
  },

  ac_ceiling: (b, w, d, h, f) => {
    // an under-ceiling unit: a wide body with a rounded front, hangers, an intake grille
    // underneath at the back, the outlet and its long louvre at the front, end caps
    const dark = mat("#26282b");
    const grey = mat("#c9cdd1", { roughness: 0.5 });
    const bh = h - 0.03;
    const y0 = h - bh;
    const rf = Math.min(bh * 0.5, 0.08);
    const prof: [number, number][] = [
      ...arc(-d / 2 + 0.03, y0 + 0.03, 0.03, Math.PI, Math.PI * 1.5, 3),
      ...arc(d / 2 - rf, y0 + rf, rf, -Math.PI / 2, 0, 5),
      ...arc(d / 2 - 0.02, h - 0.02, 0.02, 0, Math.PI / 2, 2),
      [-d / 2, h],
    ];
    b.add(profileX(prof, w - 0.04), f);
    for (const sx of [-1, 1]) {
      const cap = profileX(prof, 0.02);
      cap.translate(sx * (w / 2 - 0.01), 0, 0);
      b.add(cap, grey);
      b.box(0.05, 0.02, d * 0.5, sx * (w / 2 - 0.12), h - 0.02, -d * 0.1, mat(C.steel));
    }
    // intake grille underneath (the back)
    const gy = y0 - 0.003;
    b.box(w - 0.12, 0.003, d * 0.5, 0, gy, -d * 0.15, mat("#d4d7da"));
    for (let i = 0; i < Math.floor((w - 0.16) / 0.03); i++) bx(b, 0.012, 0.004, d * 0.47, -w / 2 + 0.09 + i * 0.03, gy - 0.003, -d * 0.15, mat("#aeb3b8"));
    // outlet at the front bottom with the louvre
    bx(b, w - 0.12, 0.004, 0.1, 0, gy, d / 2 - 0.15, dark);
    b.box(w - 0.14, 0.008, 0.08, 0, gy - 0.025, d / 2 - 0.14, mat("#e6e8ea", { roughness: 0.5 }), 0.003)!.rotation.x = -0.5;
    bx(b, 0.08, 0.025, 0.004, w / 2 - 0.12, y0 + bh * 0.5, d / 2, mat(C.screen, { roughness: 0.15 }));
    b.box(0.03, 0.01, 0.004, w / 2 - 0.12, y0 + bh * 0.5 + 0.004, d / 2 + 0.003, ledMat());
  },

  ac_cassette: (b, w, d, h, f) => {
    // a ceiling cassette: the unit hidden above, its square panel showing: a central intake
    // grille, four outlets with their flaps round it, a status light
    const dark = mat("#26282b");
    const grey = mat("#c3c7cb");
    b.box(w * 0.9, h - 0.02, d * 0.9, 0, 0.02, 0, mat("#9aa0a6"));
    b.box(w, 0.022, d, 0, 0, 0, f, 0.008);
    const g = Math.min(w, d) * 0.5;
    bx(b, g, 0.004, g, 0, -0.002, 0, grey);
    for (let i = 0; i < 12; i++) bx(b, g - 0.02, 0.004, 0.005, 0, -0.005, -g / 2 + 0.01 + ((g - 0.02) * (i + 0.5)) / 12, mat("#aeb3b8"));
    for (const sx of [-1, 1]) bx(b, 0.012, 0.005, g, sx * (g / 2 - 0.006), -0.005, 0, grey);
    // the outlets: dark slots, flaps in the finish
    const ow = Math.min(w, d) * 0.62;
    const oo = (Math.min(w, d) / 2 + g / 2) / 2 + 0.005;
    for (const [x, z] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const across = x !== 0;
      bx(b, across ? 0.05 : ow, 0.004, across ? ow : 0.05, x * oo, -0.003, z * oo, dark);
      bx(b, across ? 0.035 : ow - 0.02, 0.006, across ? ow - 0.02 : 0.035, x * oo, -0.012, z * oo, f, z * 0.5, 0, -x * 0.5);
    }
    b.box(0.03, 0.006, 0.012, w / 2 - 0.05, -0.004, d / 2 - 0.035, ledMat());
  },

  ac_floor: (b, w, d, h, f) => {
    // a floor console: a cabinet with a front panel, the outlet flaps on top, an intake
    // grille low down, a display, a plinth
    const dark = mat("#26282b");
    b.box(w - 0.02, 0.03, d - 0.03, 0, 0, -0.01, dark);
    b.box(w, h - 0.03, d - 0.02, 0, 0.03, -0.01, f, 0.025);
    b.add(profileZ(roundRect(-w / 2 + 0.01, 0.06, w / 2 - 0.01, h - 0.03, 0.02), 0.012, d / 2 - 0.02, 0.003), f);
    // the outlet on top
    bx(b, w - 0.1, 0.006, d * 0.45, 0, h - 0.004, -0.01, dark);
    for (let i = 0; i < 4; i++) bx(b, w - 0.12, 0.004, 0.022, 0, h, -0.01 - d * 0.18 + i * d * 0.12, mat("#c9cdd1"), -0.5);
    // intake grille low on the front
    bx(b, w - 0.1, h * 0.28, 0.004, 0, 0.08, d / 2 - 0.006, dark);
    louvres(b, w - 0.12, 0.085, 0.075 + h * 0.28, 0.02, d / 2 - 0.004, mat("#c9cdd1"), -0.5, 0.006, 0.012);
    // display
    bx(b, 0.1, 0.03, 0.004, w * 0.25, h * 0.75, d / 2 - 0.006, mat(C.screen, { roughness: 0.15 }));
    b.box(0.04, 0.012, 0.004, w * 0.25, h * 0.75 + 0.009, d / 2 - 0.004, ledMat());
  },

  heat_pump_indoor: (b, w, d, h, f) => {
    // an indoor unit with its hot-water tank: a tall cabinet on a plinth, an upper door
    // with the controller, a lower door, insulated pipes with valves on top
    const dark = mat("#26282b");
    const grey = mat("#d9dcdf", { roughness: 0.5 });
    const top = h - 0.15;
    b.box(w - 0.04, 0.05, d - 0.04, 0, 0, -0.01, dark);
    b.box(w, top - 0.05, d - 0.01, 0, 0.05, -0.005, f, 0.025);
    const split = 0.05 + (top - 0.05) * 0.58;
    b.add(profileZ(roundRect(-w / 2 + 0.01, 0.06, w / 2 - 0.01, split - 0.006, 0.02), 0.012, d / 2 - 0.012, 0.004), f);
    b.add(profileZ(roundRect(-w / 2 + 0.01, split + 0.006, w / 2 - 0.01, top - 0.01, 0.02), 0.012, d / 2 - 0.012, 0.004), f);
    bx(b, w - 0.03, 0.01, 0.006, 0, split - 0.005, d / 2 - 0.012, dark);
    // the controller: a dark glass panel with a lit display and two buttons
    const cy = split + (top - split) * 0.55;
    bx(b, 0.22, 0.14, 0.006, 0, cy - 0.04, d / 2, mat("#1d1f22", { roughness: 0.15, metalness: 0.2 }));
    bx(b, 0.16, 0.08, 0.006, 0, cy, d / 2 + 0.002, part(mat(C.screen, { emissive: "#2a5a8a", emissiveIntensity: 0.4 }), "led"));
    for (const sx of [-1, 1]) b.cyl(0.01, 0.01, 0.006, sx * 0.03, cy - 0.025, d / 2 + 0.003, mat("#9aa0a6"), 10).rotation.x = Math.PI / 2;
    bx(b, w * 0.4, 0.004, 0.004, 0, top - 0.06, d / 2, mat("#9aa0a6"));
    bx(b, w * 0.3, 0.014, 0.014, 0, split - 0.04, d / 2, grey);
    // pipes on top: alternating white insulation and copper, with ball valves
    const copper = mat("#b87333", { metalness: 0.6, roughness: 0.35 });
    const brass = mat("#c9cdd1", { metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + 0.12 + (i * (w - 0.24)) / 3;
      b.cyl(0.02, 0.02, 0.15, x, top, -d * 0.2, i % 2 ? copper : mat(C.ceramic), 10);
      b.cyl(0.026, 0.026, 0.04, x, top + 0.05, -d * 0.2, brass, 10);
      bx(b, 0.012, 0.012, 0.05, x, top + 0.064, -d * 0.2 + 0.03, mat(i % 2 ? "#c0392b" : "#2f6fb0"));
    }
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) bx(b, 0.004, 0.008, d * 0.5, sx * (w / 2 + 0.001), 0.1 + i * 0.025, 0, dark);
  },

  radiator_panel: (b, w, d, h, f) => {
    // a double compact panel: two channelled plates, convector fins between them seen
    // through the top grille, side covers, the valve at the top right
    f = warmMat(f);
    const z0 = back(d) + 0.012;
    const dd = d - 0.024;
    const n = Math.max(4, Math.round(w / 0.05));
    const pd = dd * 0.3;
    b.add(channelled(w - 0.01, h - 0.012, n, z0, pd, 0.006, 0.006), f);
    b.add(channelled(w - 0.01, h - 0.012, n, z0 + dd - pd, pd, 0.008, 0.006), f);
    b.box(w - 0.02, h - 0.04, dd * 0.4, 0, 0.02, z0 + dd / 2, mat("#3a3d41"));
    // top grille and side covers
    b.box(w, 0.01, dd + 0.004, 0, h - 0.01, z0 + dd / 2, f, 0.003);
    topSlots(b, w, h, z0 + dd / 2, dd * 0.55);
    for (const sx of [-1, 1]) b.box(0.006, h - 0.006, dd + 0.004, sx * (w / 2 - 0.003), 0.003, z0 + dd / 2, f, 0.002);
    for (const sx of [-1, 1]) b.box(0.03, 0.04, 0.012, sx * w * 0.35, h * 0.7, back(d) + 0.006, mat("#9aa0a6"));
    radiatorValve(b, w / 2 + 0.035, h * 0.82, z0 + dd / 2);
    b.cyl(0.008, 0.008, 0.03, w / 2 + 0.012, h * 0.08, z0 + dd / 2, mat(C.chrome), 8).rotation.z = Math.PI / 2;
    b.cyl(0.014, 0.014, 0.03, w / 2 + 0.03, h * 0.08 - 0.015, z0 + dd / 2, mat(C.chrome), 8);
  },

  radiator_flat: (b, w, d, h, f) => {
    // a flat-front panel: a smooth face with rounded edges and a shadow gap, closed ends,
    // a fine grille on top, the valve at the side
    f = warmMat(f);
    const zb = back(d) + 0.015;
    b.box(w - 0.01, h - 0.01, d * 0.5, 0, 0.005, zb + d * 0.25, f, 0.006);
    b.add(profileZ(roundRect(-w / 2, 0, w / 2, h, 0.01), 0.014, zb + d * 0.53, 0.004), f);
    b.box(w - 0.016, h - 0.016, 0.004, 0, 0.008, zb + d * 0.51, mat("#26282b"));
    topSlots(b, w - 0.02, h - 0.004, zb + d * 0.25, d * 0.4, 0.02);
    for (const sx of [-1, 1]) b.box(0.03, 0.04, 0.012, sx * w * 0.35, h * 0.7, back(d) + 0.006, mat("#9aa0a6"));
    radiatorValve(b, w / 2 + 0.035, h * 0.75, zb + d * 0.25);
    b.cyl(0.008, 0.008, 0.03, w / 2 + 0.012, h * 0.1, zb + d * 0.25, mat(C.chrome), 8).rotation.z = Math.PI / 2;
  },

  radiator_vertical: (b, w, d, h, f) => {
    // a tall designer panel: a slim body with a front of rounded vertical channels, end
    // caps, standing off the wall on brackets, the valve and pipes below
    f = warmMat(f);
    const y0 = 0.08;
    const n = Math.max(3, Math.round(w / 0.075));
    const zb = back(d) + 0.02;
    b.box(w - 0.01, h - y0, d * 0.25, 0, y0, zb + d * 0.12, f, 0.004);
    b.add(channelled(w, h - y0 - 0.01, n, zb + d * 0.25, d * 0.45, d * 0.25, y0 + 0.005), f);
    for (const y of [y0, h - 0.012]) b.box(w, 0.012, d * 0.7, 0, y, zb + d * 0.35, f, 0.004);
    for (const y of [h * 0.2, h * 0.8]) for (const sx of [-1, 1]) b.box(0.03, 0.03, 0.02, sx * w * 0.3, y, back(d) + 0.01, mat("#3a3d41"));
    const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
    for (const sx of [-1, 1]) b.cyl(0.009, 0.009, y0, sx * (w / 2 - 0.05), 0, zb + d * 0.3, chrome, 8);
    b.cyl(0.018, 0.018, 0.04, w / 2 - 0.05, 0.02, zb + d * 0.3, chrome, 12);
    b.cyl(0.02, 0.02, 0.02, w / 2 - 0.05, 0.0, zb + d * 0.3, mat(C.ceramic), 12);
  },

  radiator_tube: (b, w, d, h, f) => {
    // steel column tubes, two deep, joined by rounded headers top and bottom, on brackets,
    // the valve and lockshield at the bottom corners
    f = warmMat(f);
    const n = Math.max(4, Math.round(w / 0.045));
    const zs = [back(d) + d * 0.35, back(d) + d * 0.7];
    const hy = 0.03;
    const tube = new THREE.CylinderGeometry(0.0125, 0.0125, h - hy * 2, 8, 1, true);
    for (let i = 0; i < n; i++) for (const z of zs) b.batch(tube.clone(), f, matrix(-w / 2 + (i + 0.5) * (w / n), h / 2, z));
    for (const y of [hy, h - hy]) {
      for (const z of zs) b.batch(new THREE.CapsuleGeometry(0.016, w - 0.04, 2, 8).rotateZ(Math.PI / 2), f, matrix(0, y, z));
      b.batch(new THREE.BoxGeometry(w - 0.04, 0.02, zs[1] - zs[0]), f, matrix(0, y, (zs[0] + zs[1]) / 2));
    }
    for (const sx of [-1, 1]) b.box(0.03, 0.03, d * 0.35, sx * w * 0.33, h * 0.75, back(d) + d * 0.175, mat("#9aa0a6"));
    radiatorValve(b, w / 2 + 0.035, h * 0.15, (zs[0] + zs[1]) / 2);
    b.cyl(0.012, 0.012, 0.03, -w / 2 - 0.02, hy - 0.015, (zs[0] + zs[1]) / 2, mat(C.chrome), 10);
    b.cyl(0.007, 0.007, 0.03, -w / 2 - 0.005, hy, (zs[0] + zs[1]) / 2, mat(C.chrome), 8).rotation.z = Math.PI / 2;
  },

  radiator_cast_iron: (b, w, d, h, f) => {
    // an old cast-iron radiator on feet: sections of three columns with rounded ends, a web
    // between them, hubs top and bottom, a valve with a black wheel
    f = warmMat(f);
    const n = Math.max(4, Math.round(w / 0.065));
    const pitch = w / n;
    const y0 = 0.09;
    const colH = h - y0 - 0.03;
    // (eight sides: a corner, not an edge-on face, on the outline seen from the front and side)
    const col = new THREE.CylinderGeometry(0.017, 0.017, colH, 8, 1, true);
    const capTop = new THREE.SphereGeometry(0.017, 8, 2, 0, Math.PI * 2, 0, Math.PI / 2);
    const capBot = new THREE.SphereGeometry(0.017, 8, 2, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * pitch;
      for (const z of [-d * 0.25, 0, d * 0.25]) {
        b.batch(col.clone(), f, matrix(x, y0 + colH / 2, z));
        b.batch(capTop.clone(), f, matrix(x, y0 + colH, z));
        b.batch(capBot.clone(), f, matrix(x, y0, z));
      }
      for (const y of [y0 + 0.03, h - 0.07]) b.batch(new THREE.CylinderGeometry(0.026, 0.026, pitch * 0.94, 8).rotateZ(Math.PI / 2), f, matrix(x, y, 0));
      b.batch(new THREE.BoxGeometry(0.01, colH * 0.9, d * 0.5), f, matrix(x, y0 + colH / 2, 0));
    }
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - pitch / 2);
      bx(b, 0.05, y0 - 0.02, d * 0.4, x, 0.02, 0, f);
      b.box(0.06, 0.02, d * 0.8, x, 0, 0, f, 0.008);
    }
    b.cyl(0.012, 0.012, 0.08, w / 2 + 0.03, h - 0.07, 0, mat(C.chrome), 10).rotation.z = Math.PI / 2;
    b.cyl(0.03, 0.03, 0.02, w / 2 + 0.06, h - 0.05, 0, mat("#2b2c2e"), 14);
    b.cyl(0.006, 0.006, 0.03, w / 2 + 0.06, h - 0.07, 0, mat(C.chrome), 6);
  },

  radiator_convector: (b, w, d, h, f) => {
    // a 1970s convector: a casing with a sloped top, a slotted outlet grille on top, an
    // intake grille low on the front, a temperature knob with its scale
    f = warmMat(f);
    const dark = mat("#26282b");
    const zb = back(d);
    const zf = zb + d * 0.9;
    const prof: [number, number][] = [[zb, 0], [zf - 0.01, 0], [zf, 0.01], [zf, h - d * 0.28], [zb + d * 0.55, h], [zb, h]];
    b.add(profileX(prof, w), f);
    b.box(w - 0.08, 0.002, d * 0.45, 0, h, zb + d * 0.29, dark);
    grilleX(b, -w / 2 + 0.05, w / 2 - 0.05, 0.03, 0.012, h + 0.001, zb + d * 0.29, d * 0.42, f, 0.004);
    const sl = Math.atan2(d * 0.28, d * 0.35);
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      bx(b, w - 0.12, 0.003, d * 0.08, 0, h - d * 0.28 * t - 0.001, zb + d * 0.55 + d * 0.35 * t, dark, sl);
    }
    b.box(w - 0.12, 0.14, 0.003, 0, 0.04, zf, dark);
    louvres(b, w - 0.12, 0.045, 0.175, 0.022, zf + 0.004, f, -0.4, 0.008, 0.008);
    const kx = w / 2 - 0.07;
    const ky = h * 0.55;
    b.cyl(0.022, 0.024, 0.025, kx, ky, zf + 0.012, mat("#e8e6e1"), 18).rotation.x = Math.PI / 2;
    bx(b, 0.004, 0.016, 0.004, kx, ky + 0.004, zf + 0.025, dark);
    for (let i = 0; i < 5; i++) {
      const a0 = Math.PI * 0.25 + (i * Math.PI) / 8;
      bx(b, 0.003, 0.008, 0.003, kx + Math.cos(a0) * 0.036, ky + Math.sin(a0) * 0.036 - 0.004, zf + 0.001, dark);
    }
  },

  fan_standing: (b, w, d, h, f, _c, a) => {
    // a pedestal fan: a weighted round base, a telescopic pole with a collar, the motor
    // housing behind a domed wire guard, three clear blades that turn while it runs
    const r = Math.min(w, d) * 0.45;
    const lathe = (pts: number[][], seg: number) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
    b.cyl(r * 0.85, r * 0.86, 0.02, 0, 0, 0, a, 32);
    b.cyl(0.04, r * 0.82, 0.035, 0, 0.02, 0, a, 32);
    b.cyl(0.012, 0.012, 0.012, r * 0.45, 0.047, r * 0.3, mat("#9aa0a6"), 10);
    const y = h - r;
    const poleTop = y - 0.07;
    const lower = (poleTop - 0.05) * 0.55;
    b.cyl(0.02, 0.022, lower, 0, 0.05, 0, a, 12);
    b.cyl(0.026, 0.026, 0.03, 0, 0.05 + lower, 0, a, 12);
    b.cyl(0.014, 0.014, poleTop - 0.05 - lower, 0, 0.05 + lower, 0, mat(C.chrome, { metalness: 0.8, roughness: 0.25 }), 10);
    // the joint and the motor housing
    b.box(0.05, 0.06, 0.05, 0, poleTop, -0.08, a, 0.015);
    const motor = lathe([[0.001, 0], [0.06, 0], [0.075, 0.05], [0.07, 0.11], [0.05, 0.14], [0.001, 0.15]], 20);
    motor.rotateX(-Math.PI / 2);
    b.add(motor, a, 0, y, -0.025);
    // the guard: a rim, domed front rings, flatter back rings, radial wires
    b.add(new THREE.TorusGeometry(r, 0.008, 6, 40), f, 0, y, 0);
    for (let k = 1; k <= 3; k++) {
      const rk = (r * k) / 3.4;
      b.batch(flat(new THREE.TorusGeometry(rk, 0.003, 3, 24)), f, matrix(0, y, 0.05 * (1 - (rk / r) ** 2) + 0.004));
      b.batch(flat(new THREE.TorusGeometry(rk, 0.003, 3, 24)), f, matrix(0, y, -0.025 * (1 - (rk / r) ** 2) - 0.004));
    }
    for (let k = 0; k < 18; k++) {
      const ang = (k / 18) * Math.PI * 2;
      const pt = (t: number, s: number) => v(Math.cos(ang) * r * t, y + Math.sin(ang) * r * t, s * (1 - t * t));
      for (let j = 0; j < 3; j++) {
        rodB(b, pt(0.15 + j * 0.283, 0.05), pt(0.15 + (j + 1) * 0.283, 0.05), 0.002, f, 3);
        rodB(b, pt(0.15 + j * 0.283, -0.025), pt(0.15 + (j + 1) * 0.283, -0.025), 0.002, f, 3);
      }
    }
    b.cyl(r * 0.16, r * 0.16, 0.012, 0, y, 0.052, a, 20).rotation.x = Math.PI / 2;
    b.spinner(0, y, 0.01, "z", () => {
      const blade = mat("#cfe3ea", { transparent: true, opacity: 0.7, side: THREE.DoubleSide });
      b.add(new THREE.CylinderGeometry(r * 0.13, r * 0.15, 0.04, 16), a, 0, y, 0.01).rotation.x = Math.PI / 2;
      for (let k = 0; k < 3; k++) b.add(fanBlade(r * 0.12, r * 0.86, 0.3), blade, 0, y, 0.01).rotation.z = (k / 3) * Math.PI * 2;
    });
  },

  air_purifier: (b, w, d, h, f) => {
    // a round air purifier: a solid upper body, a slotted intake band all round, the outlet
    // grille on top with a ring of light, a dark foot
    const r = Math.min(w, d) / 2;
    const dark = mat("#2b2c2e");
    b.cyl(r * 0.96, r * 0.96, 0.02, 0, 0, 0, dark, 32);
    b.cyl(r, r, h - 0.05, 0, 0.02, 0, f, 40);
    const bandH = h * 0.5;
    b.cyl(r + 0.001, r + 0.001, bandH, 0, 0.05, 0, mat("#8d9196"), 40, true);
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * Math.PI * 2;
      b.batch(new THREE.BoxGeometry(0.008, bandH - 0.03, 0.004), f, matrix(Math.sin(a0) * (r + 0.002), 0.05 + bandH / 2, Math.cos(a0) * (r + 0.002), 0, a0));
    }
    b.add(new THREE.TorusGeometry(r * 0.95, 0.012, 6, 40).rotateX(Math.PI / 2), f, 0, h - 0.03, 0);
    b.cyl(r * 0.92, r * 0.92, 0.025, 0, h - 0.04, 0, dark, 32);
    for (let k = 1; k < 5; k++) b.add(new THREE.RingGeometry(r * 0.18 * k, r * 0.18 * k + 0.005, 32), mat("#5a5d61"), 0, h - 0.014, 0).rotation.x = -Math.PI / 2;
    b.add(new THREE.RingGeometry(r * 0.1, r * 0.14, 24), ledMat("#3f8fe0"), 0, h - 0.013, 0).rotation.x = -Math.PI / 2;
    b.box(0.05, 0.02, 0.004, 0, h * 0.8, r + 0.001, ledMat("#3f8fe0"));
  },

  dehumidifier: (b, w, d, h, f) => {
    // a compact dehumidifier: a rounded body, an outlet grille with louvres and a handle
    // recess on top, the control strip, a water tank with a level window, castors
    const dark = mat("#2b2c2e");
    b.box(w, h - 0.03, d, 0, 0.03, 0, f, 0.035);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sphere(0.015, sx * (w / 2 - 0.05), 0.015, sz * (d / 2 - 0.05), dark, 1, 1, 1, 8);
    bx(b, w * 0.75, 0.004, d * 0.45, 0, h - 0.002, d * 0.08, dark);
    for (let i = 0; i < 6; i++) bx(b, w * 0.73, 0.004, 0.014, 0, h, d * 0.08 - d * 0.18 + i * d * 0.072, mat("#9aa0a6"), -0.4);
    bx(b, w * 0.4, 0.004, 0.03, 0, h - 0.002, -d * 0.32, dark);
    bx(b, w * 0.7, 0.04, 0.006, 0, h * 0.84, d / 2 - 0.002, mat(C.screen, { roughness: 0.15 }));
    b.box(0.05, 0.02, 0.004, 0, h * 0.84 + 0.01, d / 2 + 0.002, ledMat("#3f8fe0"));
    for (const sx of [-1, 1]) b.cyl(0.006, 0.006, 0.004, sx * w * 0.22, h * 0.84 + 0.02, d / 2 + 0.002, mat("#9aa0a6"), 10).rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) bx(b, 0.004, 0.008, d * 0.6, sx * (w / 2 + 0.001), h * 0.4 + i * 0.025, 0, dark);
    b.box(w * 0.82, h * 0.34, 0.012, 0, 0.06, d / 2 - 0.004, mat("#d9dcdf", { roughness: 0.5 }), 0.012);
    bx(b, 0.03, h * 0.2, 0.004, w * 0.3, 0.1, d / 2 + 0.003, mat("#8fb8d0", { transparent: true, opacity: 0.6, roughness: 0.1 }));
    bx(b, w * 0.4, 0.012, 0.004, 0, 0.06 + h * 0.34 - 0.03, d / 2 + 0.003, dark);
  },

  washer: (b, w, d, h, f, _c, a) => laundryUnit(b, w, d, h, f, a, "washer"),
  dryer: (b, w, d, h, f, _c, a) => laundryUnit(b, w, d, h, f, a, "dryer"),
  washer_dryer_stack: (b, w, d, h, f, _c, a) => {
    // a washer with the dryer on a stacking kit (with its pull-out shelf)
    const bottom = h / 2 - 0.015;
    laundryUnit(b, w, d, bottom, f, a, "washer");
    bx(b, w, 0.03, d, 0, bottom, 0, mat(C.steel, { metalness: 0.4, roughness: 0.5 }));
    bx(b, w * 0.5, 0.012, 0.012, 0, bottom + 0.008, d / 2 + 0.006, mat("#9aa0a6"));
    const top = new Builder();
    laundryUnit(top, w, d, h - bottom - 0.03, f, a, "dryer");
    const g = top.done();
    g.position.y = bottom + 0.03;
    b.g.add(g);
  },

  ceiling_fan: (b, w, d, h, f, _c, a) => {
    // a ceiling fan: a canopy, a downrod, the motor housing in the accent with a light bowl
    // under it and a pull chain, five shaped blades on their irons turning while it runs
    const r = Math.min(w, d) / 2;
    const lathe = (pts: number[][], seg: number) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
    b.add(lathe([[0.001, 0], [0.04, 0], [0.065, 0.04], [0.07, 0.06], [0.001, 0.06]], 24), a, 0, h - 0.06, 0);
    const my = h * 0.42;
    b.cyl(0.012, 0.012, h - 0.06 - my - 0.05, 0, my + 0.05, 0, a, 10);
    b.cyl(0.03, 0.035, 0.03, 0, my + 0.045, 0, a, 16);
    b.add(lathe([[0.001, -0.03], [0.08, -0.03], [0.11, -0.02], [0.125, 0], [0.125, 0.02], [0.11, 0.045], [0.06, 0.06], [0.001, 0.06]], 32), a, 0, my, 0);
    bx(b, 0.252, 0.004, 0.252, 0, my + 0.008, 0, mat("#26282b"));
    b.cyl(0.07, 0.085, 0.04, 0, my - 0.07, 0, a, 24);
    b.add(new THREE.SphereGeometry(0.075, 24, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), opal(), 0, my - 0.07, 0);
    b.cyl(0.002, 0.002, 0.08, 0.05, my - 0.15, 0, a, 4);
    b.sphere(0.008, 0.05, my - 0.152, 0, a, 1, 1.3, 1, 8);
    b.spinner(0, my, 0, "y", () => {
      const L = r - 0.17;
      const w0 = Math.min(0.1, L * 0.25);
      const w1 = Math.min(0.15, L * 0.33);
      const s = new THREE.Shape();
      s.moveTo(0, -w0 / 2);
      s.lineTo(L - w1 / 2, -w1 / 2);
      s.absarc(L - w1 / 2, 0, w1 / 2, -Math.PI / 2, Math.PI / 2, false);
      s.lineTo(0, w0 / 2);
      s.lineTo(0, -w0 / 2);
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8 });
      geo.translate(0, 0, -0.004);
      geo.rotateX(Math.PI / 2 + 0.16);
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        b.add(geo, f, Math.cos(ang) * 0.16, my - 0.012, Math.sin(ang) * 0.16).rotation.y = -ang;
        b.add(new THREE.BoxGeometry(0.12, 0.008, 0.03), a, Math.cos(ang) * 0.15, my - 0.006, Math.sin(ang) * 0.15).rotation.y = -ang;
      }
    });
  },

  vacuum_stick: (b, w, d, h, f, _c, a) => {
    // a cordless stick vacuum in its wall dock: the floor head with its brush roll and
    // wheels, a long wand, the cyclone bin, the motor in the accent, a pistol grip with the
    // battery under it
    const zb = back(d);
    const dark = mat("#26282b");
    const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
    // the dock on the wall
    bx(b, 0.09, 0.3, 0.014, 0, h * 0.5, zb + 0.007, dark);
    bx(b, 0.07, 0.03, 0.05, 0, h * 0.55, zb + 0.03, dark);
    bx(b, 0.12, 0.02, 0.06, 0, h * 0.74, zb + 0.03, dark);
    // the floor head
    const hz = d * 0.12;
    const hd = d * 0.42;
    b.box(w, 0.045, hd, 0, 0.012, hz, f, 0.016);
    bx(b, w - 0.03, 0.016, 0.03, 0, 0.004, hz + hd / 2 - 0.02, a);
    b.box(w * 0.55, 0.004, hd * 0.45, 0, 0.056, hz + hd * 0.08, mat("#8fb8d0", { transparent: true, opacity: 0.6, roughness: 0.1 }));
    b.cyl(0.018, 0.018, w - 0.06, 0, 0.022, hz + hd / 2 - 0.022, dark, 10).rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) b.cyl(0.012, 0.012, 0.01, sx * (w / 2 - 0.03), 0.012, hz - hd / 2 + 0.02, dark, 10).rotation.z = Math.PI / 2;
    b.box(w * 0.2, 0.004, 0.006, 0, 0.03, hz + hd / 2 + 0.001, mat("#f4f6f8", { emissive: "#f4f6f8", emissiveIntensity: 0.4 }));
    // the neck joint and the wand
    const neck = v(0, 0.07, hz - hd * 0.2);
    b.sphere(0.022, neck.x, neck.y, neck.z, dark, 1, 1, 1, 12);
    const top = v(0, h * 0.56, zb + 0.07);
    b.rod(neck, top, 0.014, chrome, 10);
    b.cyl(0.02, 0.02, 0.05, 0, top.y - 0.04, top.z, dark, 12);
    // the bin: clear, with the cyclone cone inside and the accent ring
    const by = top.y + 0.01;
    b.cyl(0.042, 0.042, 0.17, 0, by, zb + 0.075, mat("#cfe3ea", { transparent: true, opacity: 0.45, roughness: 0.1 }), 18);
    b.cyl(0.026, 0.012, 0.12, 0, by + 0.03, zb + 0.075, mat("#9aa0a6", { metalness: 0.5 }), 12);
    b.cyl(0.044, 0.044, 0.02, 0, by + 0.15, zb + 0.075, a, 18);
    // the motor and the filter cap
    b.cyl(0.04, 0.046, 0.09, 0, by + 0.17, zb + 0.08, a, 18);
    b.cyl(0.035, 0.035, 0.03, 0, by + 0.26, zb + 0.08, mat("#3a3d41"), 16);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      bx(b, 0.006, 0.024, 0.004, Math.cos(ang) * 0.036, by + 0.263, zb + 0.08 + Math.sin(ang) * 0.036, dark, 0, -ang + Math.PI / 2);
    }
    // the grip angled back down, the trigger and the battery
    const g0 = v(0, by + 0.25, zb + 0.13);
    const g1 = v(0, by + 0.1, zb + 0.18);
    b.rod(g0, g1, 0.016, f, 10);
    b.rod(v(0, by + 0.26, zb + 0.09), g0, 0.016, f, 10);
    bx(b, 0.012, 0.035, 0.02, 0, by + 0.17, zb + 0.15, dark);
    bx(b, 0.06, 0.1, 0.07, 0, by + 0.04, zb + 0.15, mat("#3a3d41"));
    b.box(0.02, 0.008, 0.004, 0, by + 0.11, zb + 0.186, ledMat("#3f8fe0"));
  },

  step_ladder: (b, w, d, h, f, _c, a) => {
    // an aluminium step ladder: rectangular front stiles running up into a hand rail,
    // ribbed treads, the platform in the accent, rear legs with a cross brace, spreader
    // links at the sides, rubber feet
    const dark = mat("#26282b");
    const rubber = mat(C.black);
    const py = h * 0.76;
    const fz0 = d * 0.42;
    const pz = -d * 0.05;
    const fx0 = w * 0.46;
    const fx1 = w * 0.38;
    const stileAt = (t: number, sx: number) => v(sx * (fx0 + (fx1 - fx0) * t), py * t, fz0 + (pz - fz0) * t);
    for (const sx of [-1, 1]) {
      // front stile, continuing up past the platform into the rail
      beam(b, stileAt(0, sx), stileAt(1, sx), 0.025, 0.06, f);
      const r0 = stileAt(1, sx);
      const r1 = v(sx * fx1 * 0.97, h - 0.03, pz - d * 0.08);
      beam(b, r0, r1, 0.025, 0.04, f);
      // rear leg from the hinge down
      const hinge = v(sx * fx1, py - 0.02, pz - 0.05);
      const foot = v(sx * w * 0.46, 0, -d * 0.45);
      beam(b, hinge, foot, 0.025, 0.045, f);
      // spreader link between front and back at the height of the second tread
      const t = 0.42;
      const fr = stileAt(t, sx);
      const bk = hinge.clone().lerp(foot, 1 - t);
      beam(b, v(fr.x + sx * 0.016, fr.y, fr.z - 0.02), v(bk.x + sx * 0.016, bk.y, bk.z + 0.01), 0.006, 0.02, mat(C.steel));
      // feet
      bx(b, 0.04, 0.025, 0.07, sx * fx0, 0, fz0, rubber);
      bx(b, 0.04, 0.025, 0.06, foot.x, 0, foot.z, rubber);
      b.cyl(0.012, 0.012, 0.012, sx * fx1, py - 0.02, pz - 0.03, dark, 10).rotation.z = Math.PI / 2;
    }
    // the hand rail grip across the top, in the accent
    b.box(fx1 * 2 * 0.97 + 0.03, 0.04, 0.045, 0, h - 0.04, pz - d * 0.08, a, 0.012);
    // cross braces between the rear legs
    for (const t of [0.3, 0.65]) {
      const yb = py * (1 - t) - 0.02 * (1 - t);
      const zb = pz - 0.05 + (-d * 0.45 - pz + 0.05) * t;
      bx(b, w * 0.46 * 2 * (0.82 + 0.18 * t), 0.02, 0.012, 0, yb, zb, f);
    }
    // treads with grooves
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const c = stileAt(t, 1);
      const tw = c.x * 2 - 0.03;
      bx(b, tw, 0.03, 0.09, 0, c.y - 0.03, c.z - 0.01, f);
      for (let g = 0; g < 4; g++) bx(b, tw - 0.02, 0.003, 0.006, 0, c.y, c.z - 0.045 + 0.012 + g * 0.022, dark);
    }
    // the platform in the accent with its ribs and a tool tray lip
    bx(b, fx1 * 2 - 0.02, 0.035, d * 0.28, 0, py - 0.035, pz - 0.03, a);
    for (let g = 0; g < 5; g++) bx(b, fx1 * 2 - 0.06, 0.003, 0.008, 0, py, pz - 0.03 - d * 0.12 + g * d * 0.06, dark);
  },

  tool_wall: (b, w, d, h, f) => {
    // a pegboard on battens with hooks and tools: hammer, saw, screwdrivers, spanners,
    // pliers, a tape measure, a spirit level and a drill on its holder
    const zb = back(d);
    for (const y of [0.05, h - 0.09]) bx(b, w - 0.06, 0.04, 0.015, 0, y, zb + 0.0075, mat(C.trunk));
    bx(b, w, h, 0.012, 0, 0, zb + 0.021, f);
    pegHoles(b, -w / 2, w / 2, 0, h, zb + 0.0271);
    pegTools(b, -w / 2 + 0.06, w / 2 - 0.06, 0.06, h - 0.04, zb + 0.027);
  },

  laundry_basket: (b, w, d, h, f) => {
    // a woven basket: a rolled rim, two hand holes, a base ring, laundry heaped up with a
    // shirt hanging over the edge
    const wick = wickerMat("sand");
    const geo = new THREE.CylinderGeometry(0.5, 0.42, 1, 24, 1, true);
    geo.scale(w - 0.02, h - 0.02, d - 0.02);
    b.add(geo, wick, 0, 0.01 + (h - 0.02) / 2, 0);
    b.add(new THREE.CircleGeometry(0.42, 24).scale(w - 0.02, d - 0.02, 1), wick, 0, 0.012, 0).rotation.x = -Math.PI / 2;
    const rimM = mat("#b49a6a", { roughness: 1 });
    b.add(flat(new THREE.TorusGeometry(0.5, 0.012 / Math.min(w, d), 6, 24)).rotateX(Math.PI / 2).scale(w - 0.02, 1, d - 0.02), rimM, 0, h - 0.012, 0);
    b.add(flat(new THREE.TorusGeometry(0.42, 0.01 / Math.min(w, d), 5, 20)).rotateX(Math.PI / 2).scale(w - 0.02, 1, d - 0.02), rimM, 0, 0.01, 0);
    // hand holes: dark slots with a rolled edge, on both ends
    for (const sx of [-1, 1]) {
      const x = sx * ((w - 0.02) * 0.5 * 0.97 - 0.002);
      bx(b, 0.012, 0.03, 0.09, x, h * 0.78, 0, mat("#3a3024"));
      b.add(new THREE.TorusGeometry(0.05, 0.007, 5, 16).scale(1, 0.4, 1).rotateY(Math.PI / 2), rimM, x + sx * 0.003, h * 0.78 + 0.015, 0);
    }
    // the laundry
    foliage(b, random(167), 0, h * 0.86, 0, w * 0.33, 0.07, d * 0.33, 12, 0.1, C.clothes.slice(0, 4), true);
    const shirt = mat(C.clothes[1], { roughness: 1 });
    b.box(0.16, 0.012, 0.1, w * 0.18, h - 0.01, d * 0.1, shirt, 0.005)!.rotation.z = -0.25;
    b.box(0.012, 0.16, 0.11, w * 0.5 - 0.004, h - 0.15, d * 0.08, shirt, 0.005)!.rotation.z = 0.12;
    void f;
  },

  ironing_board: (b, w, d, h, f) => {
    // an ironing board: a padded cover in the finish over a steel plate, a pointed nose,
    // the wire iron rest at the wide end with the iron standing on it, two crossed U-shaped
    // leg frames with foot bars
    const steel = mat(C.steel, { metalness: 0.6, roughness: 0.35 });
    const rubber = mat(C.black);
    const x1 = w / 2 - 0.12;
    const board = (inset: number) => {
      const s = new THREE.Shape();
      const hd = d / 2 - inset;
      s.moveTo(-w / 2 + 0.16 + inset, -hd);
      s.lineTo(x1 - d * 0.6, -hd);
      s.bezierCurveTo(x1 - d * 0.1, -hd, w / 2 - inset, -hd * 0.25, w / 2 - inset, 0);
      s.bezierCurveTo(w / 2 - inset, hd * 0.25, x1 - d * 0.1, hd, x1 - d * 0.6, hd);
      s.lineTo(-w / 2 + 0.16 + inset, hd);
      s.lineTo(-w / 2 + 0.16 + inset, -hd);
      return s;
    };
    const cover = new THREE.ExtrudeGeometry(board(0.008), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
    cover.rotateX(Math.PI / 2);
    b.add(cover, f, 0, h - 0.008, 0);
    const plate = new THREE.ExtrudeGeometry(board(0.004), { depth: 0.008, bevelEnabled: false, curveSegments: 10 });
    plate.rotateX(Math.PI / 2);
    b.add(plate, steel, 0, h - 0.026, 0);
    // the iron rest: a steel frame with wires
    const rx = -w / 2 + 0.08;
    bx(b, 0.012, 0.012, d * 0.86, rx - 0.07, h - 0.034, 0, steel);
    bx(b, 0.012, 0.012, d * 0.86, rx + 0.07, h - 0.034, 0, steel);
    for (let i = 0; i < 4; i++) bx(b, 0.15, 0.004, 0.004, rx, h - 0.024, -d * 0.36 + i * d * 0.24, steel);
    for (const sz of [-1, 1]) bx(b, 0.16, 0.012, 0.012, rx, h - 0.034, sz * d * 0.43, steel);
    // the iron, standing on its heel
    const iron = new THREE.Shape();
    iron.moveTo(-0.05, 0);
    iron.lineTo(0.05, 0);
    iron.quadraticCurveTo(0.05, 0.12, 0, 0.2);
    iron.quadraticCurveTo(-0.05, 0.12, -0.05, 0);
    b.add(new THREE.ExtrudeGeometry(iron, { depth: 0.012, bevelEnabled: false, curveSegments: 6 }), steel, rx, h - 0.02, 0.01).rotation.set(0, Math.PI / 2, 0);
    const body = new THREE.ExtrudeGeometry(iron, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
    b.add(body, mat(C.ceramic), rx - 0.02, h - 0.01, 0.02).rotation.set(0, Math.PI / 2, 0);
    bx(b, 0.03, 0.03, 0.1, rx - 0.065, h + 0.08, 0.0, mat("#5b8fb5"));
    bx(b, 0.03, 0.08, 0.02, rx - 0.065, h + 0.01, -0.04, mat("#5b8fb5"));
    b.rod(v(rx - 0.065, h + 0.04, 0.05), v(rx - 0.02, h - 0.01, d * 0.4), 0.004, mat("#3a3d41"), 5);
    // the legs: two U frames crossing under the board
    const pivot = h * 0.45;
    for (const [i, sx] of [[0, -1], [1, 1]] as const) {
      const xt = sx * w * 0.28;
      const xb = -sx * w * 0.3;
      const zs = d * 0.32 - i * 0.03;
      for (const sz of [-1, 1]) beam(b, v(xt, h - 0.03, sz * zs), v(xb, 0.02, sz * zs), 0.018, 0.012, steel);
      bx(b, 0.018, 0.018, zs * 2 + 0.03, xt, h - 0.04, 0, steel);
      b.cyl(0.012, 0.012, d * 0.8, xb, 0.012, 0, steel, 8).rotation.x = Math.PI / 2;
      for (const sz of [-1, 1]) b.cyl(0.016, 0.016, 0.04, xb, 0.012, sz * (d * 0.4 + 0.015), rubber, 10).rotation.x = Math.PI / 2;
    }
    b.cyl(0.008, 0.008, d * 0.72, 0, pivot, 0, steel, 8).rotation.x = Math.PI / 2;
  },

  drying_rack: (b, w, d, h, f) => {
    // a winged clothes airer: a flat top of rails, two hinged wings sloping down at the
    // sides, crossed legs with plastic feet, laundry hung over the rails
    const steel = mat(C.chrome, { metalness: 0.6, roughness: 0.3 });
    const plastic = mat("#d9dcdf", { roughness: 0.6 });
    const top = h - 0.02;
    const tz = d * 0.22;
    const wy = top - 0.16;
    const wz = d / 2 - 0.01;
    const xr = w / 2 - 0.02;
    // the frame: a top rectangle, the wings, the legs crossing at the middle
    for (const sz of [-1, 1]) {
      rodB(b, v(-xr, top, sz * tz), v(xr, top, sz * tz), 0.007, steel, 6);
      rodB(b, v(-xr, wy, sz * wz), v(xr, wy, sz * wz), 0.007, steel, 6);
      for (const sx of [-1, 1]) {
        rodB(b, v(sx * xr, top, sz * tz), v(sx * xr, wy, sz * wz), 0.007, steel, 6);
        rodB(b, v(sx * (xr - 0.04), 0.02, sz * (d / 2 - 0.04)), v(sx * (xr - 0.04), top, -sz * tz), 0.008, steel, 6);
        bx(b, 0.03, 0.02, 0.05, sx * (xr - 0.04), 0, sz * (d / 2 - 0.04), plastic);
      }
    }
    for (const sx of [-1, 1]) {
      rodB(b, v(sx * xr, top, -tz), v(sx * xr, top, tz), 0.007, steel, 6);
      bx(b, 0.03, 0.03, 0.03, sx * (xr - 0.04), (top + 0.02) / 2 - 0.015, 0, plastic);
    }
    // the rails
    const nTop = 7;
    for (let i = 1; i < nTop; i++) rodB(b, v(-xr, top, -tz + (2 * tz * i) / nTop), v(xr, top, -tz + (2 * tz * i) / nTop), 0.003, steel, 4);
    for (const sz of [-1, 1])
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        rodB(b, v(-xr, top + (wy - top) * t, sz * (tz + (wz - tz) * t)), v(xr, top + (wy - top) * t, sz * (tz + (wz - tz) * t)), 0.003, steel, 4);
      }
    // laundry: towels and shirts folded over the rails
    const rand = random(307);
    const hang = (x: number, y: number, z: number, cw: number, len: number, m: THREE.Material) => {
      bx(b, cw, 0.006, 0.03, x, y + 0.002, z, m);
      bx(b, cw, len, 0.006, x, y - len, z - 0.017, m);
      bx(b, cw, len * 0.8, 0.006, x, y - len * 0.8, z + 0.017, m);
    };
    let x = -xr + 0.08;
    let k = 0;
    while (x < xr - 0.25) {
      const cw = 0.18 + rand() * 0.2;
      const row = k % 3;
      const z = row === 0 ? -tz + (2 * tz) / nTop : row === 1 ? tz - (2 * tz) / nTop : (rand() > 0.5 ? 1 : -1) * (wz * 0.9);
      const y = row === 2 ? wy + 0.02 : top;
      hang(x + cw / 2, y, z, cw, Math.min(y - 0.15, 0.25 + rand() * 0.25), mat(C.clothes[k % C.clothes.length], { roughness: 1 }));
      x += cw + 0.05;
      k++;
    }
    void f;
  },

  water_heater: (b, w, d, h, f) => {
    // a hot-water tank: a cylinder with domed ends on three feet, seam bands, the control
    // panel with its display, a thermometer and a dial, cold and hot pipes with valves going
    // back to the wall, the safety valve with its drain
    const r = Math.min(w, d) / 2 - 0.02;
    const y0 = 0.06;
    const dome = r * 0.35;
    const body = h - y0 - 0.12;
    const pts: [number, number][] = [[0.001, 0]];
    for (let i = 0; i <= 5; i++) pts.push([Math.sin((i / 5) * (Math.PI / 2)) * r, dome - Math.cos((i / 5) * (Math.PI / 2)) * dome]);
    pts.push([r, body - dome]);
    for (let i = 1; i <= 6; i++) pts.push([Math.cos((i / 6) * (Math.PI / 2)) * r, body - dome + Math.sin((i / 6) * (Math.PI / 2)) * dome]);
    pts[pts.length - 1][0] = 0.001;
    b.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 32), f, 0, y0, 0);
    for (const y of [y0 + dome, y0 + body - dome]) b.add(new THREE.TorusGeometry(r, 0.006, 4, 32).rotateX(Math.PI / 2), mat("#9aa0a6"), 0, y, 0);
    const dark = mat("#3a3d41");
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + Math.PI / 6;
      b.cyl(0.02, 0.025, y0 + dome * 0.4, Math.sin(ang) * r * 0.6, 0, Math.cos(ang) * r * 0.6, dark, 10);
    }
    // the control panel on the front
    const py = y0 + body * 0.45;
    const panel = profileZ(roundRect(-r * 0.4, -0.12, r * 0.4, 0.12, 0.02), 0.03, 0, 0.005);
    b.add(panel, mat("#e6e8ea", { roughness: 0.5 }), 0, py, r - 0.02);
    bx(b, 0.12, 0.05, 0.006, 0, py + 0.02, r + 0.008, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }));
    b.cyl(0.022, 0.022, 0.012, -r * 0.2, py - 0.06, r + 0.012, mat("#3a3d41"), 18).rotation.x = Math.PI / 2;
    b.cyl(0.022, 0.022, 0.012, r * 0.2, py - 0.06, r + 0.012, mat(C.ceramic), 18).rotation.x = Math.PI / 2;
    bx(b, 0.004, 0.016, 0.004, r * 0.2, py - 0.058, r + 0.019, dark);
    b.box(0.006, 0.006, 0.004, 0, py - 0.06, r + 0.011, ledMat());
    b.add(new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.08, 6, 1, true, -0.3, 0.6), mat("#d4d7da"), 0, y0 + body * 0.72, 0);
    // the pipes: out of the top, along and back to the wall, with valves (blue cold, red hot)
    const copper = mat("#b87333", { metalness: 0.6, roughness: 0.35 });
    const topY = y0 + body;
    const brass = mat("#c9a646", { metalness: 0.7, roughness: 0.3 });
    for (const [i, sx] of [[0, -1], [1, 1]] as const) {
      const x = sx * r * 0.35;
      const yy = h - 0.03 - i * 0.04;
      b.cyl(0.012, 0.012, yy - topY + dome * 0.2, x, topY - dome * 0.2, 0, copper, 8);
      b.rod(v(x, yy, 0), v(x, yy, -d / 2), 0.012, copper, 8);
      b.sphere(0.016, x, yy, 0, copper, 1, 1, 1, 8);
      b.cyl(0.02, 0.02, 0.05, x, topY + 0.02, 0, brass, 10);
      bx(b, 0.012, 0.012, 0.06, x, topY + 0.045, 0.03, mat(i ? "#c0392b" : "#2f6fb0"));
    }
    // the safety valve with its drain pipe
    b.cyl(0.015, 0.015, 0.06, r + 0.02, y0 + body * 0.25, 0, brass, 10).rotation.z = Math.PI / 2;
    b.cyl(0.008, 0.008, y0 + body * 0.25 - 0.02, r + 0.05, 0.02, 0, mat(C.steel), 8);
  },

  fuse_box: (b, w, d, h, f) => {
    // a surface consumer unit: a body with a door, a window over the breaker rows, the
    // warning label, a lock, vents, cable glands on top
    const dark = mat("#26282b");
    const zb = back(d);
    const bd = d - 0.03;
    b.box(w, h - 0.02, bd, 0, 0.01, zb + bd / 2, f, 0.012);
    // inside, seen through the window: two DIN rails of breakers
    const rows = [0.62, 0.4];
    const zi = zb + bd + 0.004;
    bx(b, w - 0.06, h * 0.56, 0.003, 0, h * 0.18, zi - 0.0025, mat("#3a3d41"));
    for (const t of rows) {
      const y = h * t;
      const n = Math.max(6, Math.floor((w - 0.12) / 0.018));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.06 + (i + 0.5) * ((w - 0.12) / n);
        const rcd = i < 2;
        bx(b, (w - 0.12) / n - 0.002, 0.08, 0.012, x, y - 0.04, zi, mat(rcd ? "#e8e6e1" : "#f3f3f1"));
        bx(b, 0.006, 0.014, 0.008, x, y - 0.004, zi + 0.01, rcd ? mat("#2f6fb0") : dark);
      }
    }
    // the door: a frame and the window
    const dz = zb + bd;
    b.add(profileZ(roundRect(-w / 2 + 0.01, 0.02, w / 2 - 0.01, h * 0.18, 0.01), 0.012, dz, 0.003), f);
    b.add(profileZ(roundRect(-w / 2 + 0.01, h * 0.74, w / 2 - 0.01, h - 0.02, 0.01), 0.012, dz, 0.003), f);
    for (const sx of [-1, 1]) bx(b, 0.03, h * 0.56, 0.012, sx * (w / 2 - 0.025), h * 0.18, dz, f);
    b.box(w - 0.08, h * 0.56, 0.004, 0, h * 0.18, dz + 0.006, mat("#a9bcc6", { transparent: true, opacity: 0.25, roughness: 0.2 }));
    bx(b, w - 0.03, 0.003, 0.004, 0, 0.02, dz + 0.012, dark);
    // the lock and handle
    bx(b, 0.02, 0.08, 0.012, w / 2 - 0.035, h * 0.42, dz + 0.012, mat(C.black));
    b.cyl(0.008, 0.008, 0.004, w / 2 - 0.035, h * 0.48, dz + 0.019, mat(C.chrome), 10).rotation.x = Math.PI / 2;
    // the warning label: a yellow triangle with its bolt
    const tri = new THREE.Shape([new THREE.Vector2(-0.035, 0), new THREE.Vector2(0.035, 0), new THREE.Vector2(0, 0.06)]);
    b.add(new THREE.ShapeGeometry(tri), mat("#f2d14b"), 0, h * 0.8, dz + 0.0125);
    b.add(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0.004, 0.044), new THREE.Vector2(-0.008, 0.02), new THREE.Vector2(0.002, 0.022), new THREE.Vector2(-0.004, 0.008), new THREE.Vector2(0.01, 0.028), new THREE.Vector2(0, 0.026)])), dark, 0, h * 0.8, dz + 0.013);
    // vents at the bottom of the door and glands on top
    for (let i = 0; i < 6; i++) bx(b, 0.04, 0.005, 0.003, -w * 0.25 + i * 0.05 * (w / 0.55) * 0.5, h * 0.08, dz + 0.012, dark);
    for (let i = 0; i < 4; i++) b.cyl(0.012, 0.014, 0.02, -w * 0.3 + i * w * 0.2, h - 0.01, zb + bd * 0.4, mat("#3a3d41"), 10);
  },

  network_cabinet: (b, w, d, h, f) => {
    // a wall rack: a cabinet with vented sides and a glass door in a frame, inside a patch
    // panel, a switch and a router with their lights, patch cables, a power strip, a fan
    const zb = back(d);
    const t = 0.012;
    bx(b, w, t, d, 0, 0, 0, f);
    bx(b, w, t, d, 0, h - t, 0, f);
    for (const sx of [-1, 1]) bx(b, t, h - 2 * t, d, sx * (w / 2 - t / 2), t, 0, f);
    b.box(w - 2 * t, h - 2 * t, t, 0, t, zb + t / 2, f);
    const dark = mat("#1d1f22");
    for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) bx(b, 0.003, 0.006, d * 0.5, sx * (w / 2 + 0.0005), h * 0.3 + i * 0.03, 0, dark);
    // the rails
    const rail = mat(C.steel, { metalness: 0.6, roughness: 0.35 });
    const ux = (w - 2 * t) / 2 - 0.03;
    const zr = d / 2 - 0.06;
    for (const sx of [-1, 1]) bx(b, 0.02, h - 2 * t, 0.012, sx * ux, t, zr, rail);
    // a fan in the top
    b.add(new THREE.CircleGeometry(0.05, 20), dark, 0, h - t - 0.001, 0).rotation.x = Math.PI / 2;
    // the units
    const units = [0.18, 0.32, 0.46];
    const unit = mat("#2b2d31");
    for (const [i, y] of units.entries()) {
      bx(b, ux * 2 + 0.03, 0.045, d * 0.6, 0, h * y, zr - d * 0.3 + 0.01, unit);
      for (let k = 0; k < 8; k++) b.box(0.008, 0.008, 0.004, -w / 2 + 0.1 + k * 0.035, h * y + 0.02, d / 2 - 0.013, mat(k % 3 ? "#3fd27a" : "#f2a53a", { emissive: k % 3 ? "#3fd27a" : "#f2a53a", emissiveIntensity: 0.8 }));
      // ports
      for (let k = 0; k < 12; k++) bx(b, 0.012, 0.01, 0.004, -w / 2 + 0.1 + k * 0.026 + (i === 2 ? 0.2 : 0), h * y + 0.008, zr + 0.011, mat("#0e0f11"));
    }
    // patch cables looping from the patch panel down to the switch
    const cable = mat("#3f7fd0", { roughness: 0.7 });
    for (let k = 0; k < 6; k++) {
      const x = -w / 2 + 0.106 + k * 0.026;
      const c = new THREE.CatmullRomCurve3([v(x, h * units[2] + 0.013, zr + 0.015), v(x + 0.01, h * (units[1] + units[2]) / 2 + 0.03, zr + 0.05), v(x, h * units[1] + 0.013, zr + 0.015)]);
      b.batch(new THREE.TubeGeometry(c, 6, 0.003, 4, false), cable);
    }
    // a power strip at the bottom
    bx(b, ux * 2, 0.03, 0.05, 0, t + 0.02, zr - 0.03, mat("#2b2d31"));
    for (let k = 0; k < 5; k++) b.cyl(0.01, 0.01, 0.003, -ux * 0.7 + k * ux * 0.35, t + 0.035, zr - 0.004, mat("#d9dcdf"), 10).rotation.x = Math.PI / 2;
    b.box(0.012, 0.008, 0.004, ux - 0.03, t + 0.035, zr, mat("#e04a3a", { emissive: "#e04a3a", emissiveIntensity: 0.6 }));
    // the door: a frame in the finish, glass, a handle
    const dz = d / 2;
    for (const y of [0.0, h - 0.03]) bx(b, w, 0.03, 0.012, 0, y, dz, f);
    for (const sx of [-1, 1]) bx(b, 0.03, h - 0.06, 0.012, sx * (w / 2 - 0.015), 0.03, dz, f);
    b.box(w - 0.06, h - 0.06, 0.005, 0, 0.03, dz + 0.001, mat("#6a7680", { transparent: true, opacity: 0.25, roughness: 0.1 }));
    bx(b, 0.018, 0.1, 0.02, w / 2 - 0.015, h * 0.45, dz + 0.012, mat(C.chrome, { metalness: 0.7, roughness: 0.3 }));
  },

  home_battery: (b, w, d, h, f) => {
    // a wall battery: stacked modules with seams, a control head with the logo plate, the
    // green charge light strip, vents on the sides, a bracket and a cable duct
    const zb = back(d);
    const dark = mat("#3a3d41");
    b.box(w * 0.7, h * 0.8, 0.02, 0, h * 0.1, zb + 0.01, dark);
    const bd = d - 0.025;
    b.box(w, h, bd, 0, 0, zb + 0.025 + bd / 2, f, 0.03);
    const fz = zb + 0.025 + bd;
    const n = 3;
    const head = h * 0.22;
    for (let i = 1; i <= n; i++) bx(b, w - 0.01, 0.004, 0.004, 0, ((h - head) * i) / n - 0.002, fz - 0.0015, mat("#8d9196"));
    // a darker head band with the logo and the status light
    b.add(profileZ(roundRect(-w / 2 + 0.02, h - head + 0.02, w / 2 - 0.02, h - 0.03, 0.02), 0.006, fz - 0.003, 0.002), mat("#2b2d31", { roughness: 0.3, metalness: 0.2 }));
    b.box(w * 0.3, 0.04, 0.004, 0, h * 0.85, fz + 0.003, mat("#9aa0a6"));
    b.box(w * 0.04, h * 0.5, 0.004, -w * 0.35, h * 0.25, fz + 0.001, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.6 }));
    for (let i = 0; i < 4; i++) b.box(0.012, 0.012, 0.004, w * 0.2 + i * 0.03, h - head + 0.045, fz + 0.002, mat(i < 3 ? "#3fd27a" : "#5a5d61", i < 3 ? { emissive: "#3fd27a", emissiveIntensity: 0.6 } : {}));
    for (const sx of [-1, 1]) for (let i = 0; i < 10; i++) bx(b, 0.003, 0.006, bd * 0.5, sx * (w / 2 + 0.0005), h * 0.3 + i * 0.03, zb + 0.025 + bd / 2, mat("#26282b"));
    // the cable duct from the bottom
    bx(b, 0.08, 0.06, 0.05, w * 0.25, -0.03, zb + 0.04, mat(C.ceramic));
  },

  inverter: (b, w, d, h, f) => {
    // a solar inverter: a rounded body on a bracket, the display and light on the front,
    // a heat sink of fins behind, the DC isolator and cable glands underneath
    const zb = back(d);
    const dark = mat("#3a3d41");
    const sink = mat("#8d9196", { metalness: 0.5, roughness: 0.5 });
    b.box(w - 0.04, h - 0.04, 0.03, 0, 0.02, zb + 0.015, sink);
    for (let i = 0; i < 9; i++) bx(b, 0.006, h - 0.06, 0.04, -w / 2 + 0.04 + (i * (w - 0.08)) / 8, 0.03, zb + 0.02, sink);
    const bd = d - 0.045;
    const z0 = zb + 0.045;
    b.box(w, h - 0.03, bd, 0, 0.03, z0 + bd / 2, f, 0.025);
    const fz = z0 + bd;
    // a front cover in a slightly different tone with a seam
    b.add(profileZ(roundRect(-w / 2 + 0.03, h * 0.35, w / 2 - 0.03, h - 0.06, 0.03), 0.006, fz - 0.004, 0.002), mat("#2b2d31", { roughness: 0.3, metalness: 0.2 }));
    bx(b, w * 0.3, 0.06, 0.004, 0, h * 0.7, fz + 0.001, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }));
    b.box(0.02, 0.02, 0.004, w * 0.25, h * 0.7, fz + 0.001, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.8 }));
    for (let i = 0; i < 3; i++) b.cyl(0.008, 0.008, 0.004, -0.03 + i * 0.03, h * 0.55, fz + 0.002, mat("#9aa0a6"), 10).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) bx(b, w * 0.8, 0.006, 0.004, 0, 0.06 + i * 0.025, fz, mat("#9aa0a6"));
    // underneath: the DC isolator and cable glands with short cables
    bx(b, 0.07, 0.03, 0.06, w * 0.3, 0.0, z0 + bd * 0.55, dark);
    bx(b, 0.05, 0.014, 0.014, w * 0.3, 0.008, z0 + bd + 0.004, mat("#c0392b"));
    for (let i = 0; i < 4; i++) b.cyl(0.009, 0.011, 0.03, -w * 0.3 + i * 0.05, 0.0, z0 + bd * 0.5, dark, 10);
  },

  freezer_chest: (b, w, d, h, f) => {
    // a chest freezer: a body on a plinth, the lid with its gasket and a handle recess, the
    // control strip with its lights and the thermostat, hinges behind, vents at the side
    const dark = mat("#26282b");
    const lid = 0.07;
    bx(b, w - 0.02, 0.03, d - 0.04, 0, 0, 0, dark);
    b.box(w, h - lid - 0.03, d, 0, 0.03, 0, f, 0.03);
    bx(b, w - 0.01, 0.006, d - 0.01, 0, h - lid, 0, mat("#5a5d61"));
    b.box(w + 0.01, lid - 0.004, d + 0.01, 0, h - lid + 0.004, 0, f, 0.025);
    // the handle recess on the lid's front
    bx(b, w * 0.3, 0.035, 0.02, 0, h - lid + 0.01, d / 2 + 0.004, mat("#9aa0a6"));
    bx(b, w * 0.26, 0.006, 0.006, 0, h - lid + 0.008, d / 2 + 0.014, dark);
    bx(b, 0.02, 0.02, 0.006, w * 0.18, h - lid + 0.02, d / 2 + 0.006, mat(C.chrome));
    // the control strip with lights and the thermostat
    const cy = h - lid - 0.06;
    bx(b, w * 0.22, 0.04, 0.006, -w * 0.33, cy, d / 2 - 0.001, mat("#d9dcdf"));
    b.box(0.03, 0.02, 0.004, -w * 0.4, h * 0.85, d / 2 + 0.001, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.6 }));
    b.box(0.012, 0.012, 0.004, -w * 0.37, cy + 0.02, d / 2 + 0.003, mat("#e04a3a"));
    b.cyl(0.014, 0.014, 0.012, -w * 0.27, cy + 0.02, d / 2 + 0.004, mat(C.ceramic), 14).rotation.x = Math.PI / 2;
    bx(b, 0.003, 0.012, 0.004, -w * 0.27, cy + 0.016, d / 2 + 0.011, dark);
    // hinges at the back
    for (const sx of [-1, 1]) bx(b, 0.06, 0.05, 0.02, sx * w * 0.3, h - lid - 0.02, -d / 2 - 0.006, mat("#9aa0a6"));
    // the compressor vents at the right side
    for (let i = 0; i < 8; i++) bx(b, 0.004, 0.008, d * 0.4, w / 2 + 0.0005, 0.07 + i * 0.022, -d * 0.1, dark);
  },

  shelving_metal: (b, w, d, h, f) => {
    // a garage rack: slotted angle posts, four steel shelves with folded edges, crossed
    // braces at the back, boxes, storage bins and paint tins
    const slot = mat("#141517");
    const pw = 0.04;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - pw / 2);
        const z = sz * (d / 2 - pw / 2);
        // an L section: two flanges on the outer sides
        bx(b, pw, h, 0.003, x, 0, sz * (d / 2 - 0.0015), f);
        bx(b, 0.003, h, pw, sx * (w / 2 - 0.0015), 0, z, f);
        // the slots on both flanges
        for (let y = 0.06; y < h - 0.04; y += 0.05) {
          b.batch(new THREE.PlaneGeometry(0.008, 0.025), slot, matrix(x - sx * 0.004, y, sz * (d / 2 + 0.0006), sz > 0 ? 0 : 0, sz > 0 ? 0 : Math.PI));
          b.batch(new THREE.PlaneGeometry(0.008, 0.025), slot, matrix(sx * (w / 2 + 0.0006), y, z - sz * 0.004, 0, sx * Math.PI / 2));
        }
        bx(b, pw + 0.006, 0.012, pw + 0.006, x, 0, z, mat(C.black));
      }
    for (const sx of [-1, 1]) rodB(b, v(sx * (w / 2 - 0.03), 0.1, -d / 2 + 0.006), v(-sx * (w / 2 - 0.03), h * 0.5, -d / 2 + 0.006), 0.004, f, 4);
    const rand = random(311);
    const bins = ["#3a7de0", "#e04a3a", "#4f7a45", "#3a3d41"];
    for (let i = 0; i < 4; i++) {
      const y = 0.08 + (i * (h - 0.12)) / 3;
      b.box(w - 0.01, 0.006, d - 0.01, 0, y + 0.014, 0, f);
      for (const sz of [-1, 1]) bx(b, w - 0.006, 0.03, 0.004, 0, y - 0.01, sz * (d / 2 - 0.002), f);
      for (const sx of [-1, 1]) bx(b, 0.004, 0.03, d - 0.006, sx * (w / 2 - 0.002), y - 0.01, 0, f);
      if (i === 3) continue;
      const room = (h - 0.12) / 3 - 0.06;
      let x = -w / 2 + 0.06;
      while (x < w / 2 - 0.25) {
        const kind = rand();
        const sy = y + 0.02;
        if (kind < 0.4) {
          // a cardboard box with its tape and a label
          const bw = 0.2 + rand() * 0.18;
          const bh = Math.min(room, 0.15 + rand() * 0.18);
          const bd = d * (0.65 + rand() * 0.15);
          bx(b, bw, bh, bd, x + bw / 2, sy, 0, mat("#b8956a", { roughness: 0.9 }));
          bx(b, 0.05, 0.002, bd + 0.002, x + bw / 2, sy + bh, 0, mat("#cfb48a"));
          bx(b, bw * 0.4, bh * 0.25, 0.002, x + bw / 2, sy + bh * 0.5, bd / 2 + 0.001, mat("#f4f1ea"));
          x += bw + 0.03;
        } else if (kind < 0.75) {
          // a plastic bin with a lid
          const bw = 0.3 + rand() * 0.1;
          const bh = Math.min(room, 0.18 + rand() * 0.06);
          const c = bins[Math.floor(rand() * bins.length)];
          b.box(bw, bh - 0.02, d * 0.8, x + bw / 2, sy, 0, mat(c, { roughness: 0.5 }), 0.012);
          bx(b, bw + 0.01, 0.025, d * 0.8 + 0.01, x + bw / 2, sy + bh - 0.025, 0, mat(c === "#3a3d41" ? "#5a5d61" : "#3a3d41", { roughness: 0.5 }));
          x += bw + 0.03;
        } else {
          // a pair of paint tins
          const r = 0.06 + rand() * 0.02;
          for (let k = 0; k < 2; k++) {
            const tx = x + r + k * (2 * r + 0.01);
            const th = Math.min(room, 0.12 + rand() * 0.05);
            b.cyl(r, r, th, tx, sy, 0, mat(C.steel, { metalness: 0.6, roughness: 0.4 }), 16);
            b.cyl(r * 0.92, r * 0.92, 0.004, tx, sy + th, 0, mat(["#e8e6e1", "#c0392b", "#3a7de0"][Math.floor(rand() * 3)]), 16);
            b.cyl(r + 0.001, r + 0.001, th * 0.6, tx, sy + th * 0.2, 0, mat(["#f2d14b", "#f4f1ea", "#4f7a45"][Math.floor(rand() * 3)]), 16, true);
          }
          x += 4 * r + 0.04;
        }
      }
    }
  },

  workbench: (b, w, d, h, f, _c, a) => {
    // a workbench: a thick oak top on a steel frame in the accent, a drawer unit in the
    // finish, a lower shelf, a vice at the front left, a pegboard with tools above it
    const oak = surface("oak", 0.8);
    const tz = 0.06;
    bx(b, w, tz, d, 0, h - tz, 0, oak);
    const legS = 0.05;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, legS, h - tz, legS, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), a);
    for (const sx of [-1, 1]) bx(b, 0.04, 0.04, d - 0.12, sx * (w / 2 - 0.06), 0.12, 0, a);
    for (const sz of [-1, 1]) bx(b, w - 0.12, 0.05, 0.03, 0, h - tz - 0.05, sz * (d / 2 - 0.06), a);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, 0.07, 0.015, 0.07, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), mat(C.black));
    bx(b, w - 0.14, 0.025, d - 0.12, 0, 0.16, 0, oak);
    // a drawer unit under the right end
    const dw = Math.min(0.5, w * 0.32);
    const dx = w / 2 - 0.09 - dw / 2;
    const dy0 = 0.19;
    const dh = h - tz - 0.06 - dy0;
    bx(b, dw, dh, d - 0.14, dx, dy0, 0, f);
    for (let i = 0; i < 3; i++) {
      const y = dy0 + 0.006 + (i * dh) / 3;
      bx(b, dw - 0.02, dh / 3 - 0.012, 0.014, dx, y, (d - 0.14) / 2, f);
      bx(b, dw * 0.4, 0.016, 0.02, dx, y + dh / 3 - 0.045, (d - 0.14) / 2 + 0.014, mat(C.chrome, { metalness: 0.7, roughness: 0.3 }));
    }
    // the vice at the front left
    const vx = -w / 2 + 0.25;
    const steel = mat("#3a4f6a", { metalness: 0.4, roughness: 0.5 });
    bx(b, 0.14, 0.06, 0.16, vx, h, d / 2 - 0.1, steel);
    bx(b, 0.14, 0.07, 0.03, vx, h + 0.005, d / 2 + 0.005, steel);
    bx(b, 0.14, 0.05, 0.02, vx, h + 0.04, d / 2 - 0.04, steel);
    b.cyl(0.01, 0.01, 0.12, vx, h + 0.03, d / 2 + 0.06, mat(C.chrome), 8).rotation.x = Math.PI / 2;
    b.cyl(0.006, 0.006, 0.14, vx, h + 0.03, d / 2 + 0.115, mat(C.chrome), 8).rotation.z = Math.PI / 2;
    // a few things on the top: a block of wood, a tin
    bx(b, 0.25, 0.04, 0.08, w * 0.05, h, 0.05, mat("#d2b48c"));
    bx(b, 0.08, 0.06, 0.04, w * 0.05 + 0.2, h, -0.05, mat("#c8382c"));
    // the pegboard behind with its tools
    const pz = -d / 2 + 0.01;
    b.box(w, 0.8, 0.02, 0, h + 0.15, pz, f);
    pegHoles(b, -w / 2, w / 2, h + 0.15, h + 0.95, pz + 0.0101);
    pegTools(b, -w / 2 + 0.08, w / 2 - 0.08, h + 0.2, h + 0.92, pz + 0.016);
  },
};
