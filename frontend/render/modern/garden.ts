// More detailed built-in pieces: garden. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import type { Build, Builder } from "../modern";
import { C, foliage, glass, glowing, mat, matrix, part, random, roundedRect, v } from "../modern";
import { FINISHES } from "../../model/modern";

type Std = THREE.MeshStandardMaterial;

// ----- helpers -----

const tints = new Map<string, Std>();
/** The finish a shade darker (k < 1) or lighter, keeping a wood texture. */
function tint(f: THREE.Material, k: number): Std {
  const key = `${f.uuid}/${k}`;
  let m = tints.get(key);
  if (!m) {
    m = (f as Std).clone();
    m.color.multiplyScalar(k);
    tints.set(key, m);
  }
  return m;
}
/** The finish's colour as a hex string (wood finishes carry a texture and a white colour). */
const hex = (color: string, f: THREE.Material) => FINISHES[color] ?? `#${(f as Std).color.getHexString()}`;
const metal = (color: string, rough = 0.35) => mat(color, { metalness: 0.6, roughness: rough });

/**
 * A board of len along x lying on the line from (z0, y0) to (z1, y1) in the yz plane, its
 * upper face on the line and t thick: roof slopes, barge boards, rafters.
 */
function plank(b: Builder, x: number, len: number, z0: number, y0: number, z1: number, y1: number, t: number, m: THREE.Material) {
  const dz = z1 - z0;
  const dy = y1 - y0;
  const l = Math.hypot(dz, dy);
  const phi = Math.atan2(-dy, dz);
  let ny = Math.cos(phi);
  let nz = Math.sin(phi);
  if (ny < 0) (ny = -ny), (nz = -nz);
  const mesh = b.add(new THREE.BoxGeometry(len, t, l), m, x, (y0 + y1) / 2 - (ny * t) / 2, (z0 + z1) / 2 - (nz * t) / 2);
  mesh.rotation.x = phi;
  return mesh;
}

/** A triangle (a gable) in the yz plane at x: base from -half to half at y, apex at y + rise, t thick. */
function gable(b: Builder, x: number, half: number, y: number, rise: number, t: number, m: THREE.Material) {
  const shape = new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, rise)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2).rotateY(Math.PI / 2);
  return b.add(geo, m, x, y, 0);
}

/** A window in a wall facing +z (rot 0) or +x (rot = π/2), centred at (x, y, z): dark glass, a frame, glazing bars, a sill. */
function shedWindow(b: Builder, x: number, y: number, z: number, ww: number, wh: number, frame: THREE.Material, rot = 0, bars = true) {
  const g = new THREE.Group();
  const into = (mesh: THREE.Mesh | null) => mesh && (b.g.remove(mesh), g.add(mesh));
  const pane = mat("#27343b", { roughness: 0.15, metalness: 0.4 });
  const f = 0.045;
  into(b.box(ww, wh, 0.012, 0, -wh / 2, 0.006, pane));
  into(b.box(ww + 2 * f, f, 0.035, 0, wh / 2, 0.017, frame));
  into(b.box(ww + 2 * f, f, 0.035, 0, -wh / 2 - f, 0.017, frame));
  for (const s of [-1, 1]) into(b.box(f, wh, 0.035, s * (ww / 2 + f / 2), -wh / 2, 0.017, frame));
  if (bars) {
    into(b.box(0.022, wh, 0.025, 0, -wh / 2, 0.015, frame));
    into(b.box(ww, 0.022, 0.025, 0, -0.011, 0.015, frame));
  }
  into(b.box(ww + 2 * f + 0.06, 0.03, 0.08, 0, -wh / 2 - f - 0.03, 0.04, frame));
  g.position.set(x, y, z);
  g.rotation.y = rot;
  b.g.add(g);
}

/** Thin dark lines on a face (board joints) facing +z, batched. */
function grooves(b: Builder, xs: number[], y: number, hh: number, z: number, m: THREE.Material) {
  for (const x of xs) b.batch(new THREE.BoxGeometry(0.006, hh, 0.004), m, matrix(x, y + hh / 2, z));
}

/** A rod's geometry from a to c, for batching (springs, chains, wires). */
function rodGeo(a: THREE.Vector3, c: THREE.Vector3, r: number, seg = 6) {
  const geo = new THREE.CylinderGeometry(r, r, a.distanceTo(c), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
  return geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

/**
 * A rounded rectangle standing up from y = 0 to hh, wb × db at the bottom and wt × dt at
 * the top: bin bodies, mower shells. Its back can stay upright (lean = 1: only the front slopes).
 */
function taper(wb: number, db: number, wt: number, dt: number, hh: number, r: number, lean = 0) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(wb, db, r), { depth: hh, bevelEnabled: false, curveSegments: 3 });
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getZ(i) / hh;
    const sy = 1 + (dt / db - 1) * t;
    // shape y becomes -z: the back is at +y here
    pos.setX(i, pos.getX(i) * (1 + (wt / wb - 1) * t));
    pos.setY(i, pos.getY(i) * sy + ((db - dt) / 2) * t * lean);
  }
  geo.computeVertexNormals();
  return geo.rotateX(-Math.PI / 2);
}

/** A board of len along z on the line from (x0, y0) to (x1, y1) in the xy plane, its upper face on the line: roofs with the ridge along z. */
function plankZ(b: Builder, z: number, len: number, x0: number, y0: number, x1: number, y1: number, t: number, m: THREE.Material) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy);
  let nx = -dy / l;
  let ny = dx / l;
  if (ny < 0) (nx = -nx), (ny = -ny);
  const mesh = b.add(new THREE.BoxGeometry(l, t, len), m, (x0 + x1) / 2 - (nx * t) / 2, (y0 + y1) / 2 - (ny * t) / 2, z);
  mesh.rotation.z = Math.atan2(dy, dx);
  return mesh;
}

/** A wheel turning about x at (x, y, z): a tyre, a rim in m and a hub. */
function wheel(b: Builder, x: number, y: number, z: number, r: number, width: number, m: THREE.Material, seg = 18) {
  const tyre = mat("#1e1f22", { roughness: 0.95 });
  b.add(new THREE.CylinderGeometry(r, r, width, seg).rotateZ(Math.PI / 2), tyre, x, y, z);
  const side = Math.sign(x) || 1;
  b.add(new THREE.CylinderGeometry(r * 0.62, r * 0.62, width + 0.006, seg).rotateZ(Math.PI / 2), m, x, y, z);
  b.add(new THREE.CylinderGeometry(r * 0.2, r * 0.24, 0.012, 10).rotateZ((-side * Math.PI) / 2), mat("#5c6066", { metalness: 0.4 }), x + side * (width / 2 + 0.006), y, z);
}

/** A wheelie bin at x: a tapering body with a rim, the lid in its own colour, a handle, wheels at the back. */
function bin(b: Builder, x: number, bw: number, d: number, h: number, body: THREE.Material, lid: THREE.Material) {
  const top = h - 0.075;
  const y0 = 0.05;
  const db = d - 0.27;
  const dt = d - 0.17;
  const zb = -d / 2 + 0.13; // the body's back
  const zt = zb + dt / 2; // the top's centre
  const flatRR = (ww: number, dd: number, t: number) => new THREE.ExtrudeGeometry(roundedRect(ww, dd, 0.05), { depth: t, bevelEnabled: false, curveSegments: 3 }).rotateX(-Math.PI / 2);
  b.add(taper(bw * 0.84, db, bw - 0.02, dt, top - y0, 0.05, 1), body, x, y0, zb + db / 2);
  // the rim under the lid, the lid with its front grip, the hinge and the back handle
  b.add(flatRR(bw + 0.01, dt + 0.02, 0.035), body, x, top - 0.035, zt);
  b.add(flatRR(bw + 0.03, dt + 0.045, 0.03), lid, x, top + 0.004, zt + 0.01);
  b.box(bw * 0.5, 0.03, 0.03, x, top - 0.012, zt + dt / 2 + 0.025, lid);
  b.box(bw * 0.95, 0.04, 0.05, x, top - 0.035, zb - 0.02, body);
  b.add(new THREE.CylinderGeometry(0.016, 0.016, bw * 0.8, 8).rotateZ(Math.PI / 2), body, x, h - 0.03, -d / 2 + 0.035);
  for (const s of [-1, 1]) b.box(0.03, 0.05, 0.07, x + s * bw * 0.4, h - 0.07, -d / 2 + 0.055, body);
  // a raised panel on the front, following its slope
  const tilt = Math.atan2(dt - db, top - y0);
  const zf = (y: number) => zb + db + ((dt - db) * (y - y0)) / (top - y0);
  const ph = (top - y0) * 0.5;
  const py = y0 + (top - y0) * 0.38 + ph / 2;
  b.add(new THREE.BoxGeometry(bw * 0.52, ph, 0.012), body, x, py, zf(py) + 0.003).rotation.x = tilt;
  // wheels and axle at the back, a foot bar low on the back
  const wz = -d / 2 + 0.1;
  b.add(new THREE.CylinderGeometry(0.014, 0.014, bw + 0.02, 8).rotateZ(Math.PI / 2), mat(C.steel, { metalness: 0.5 }), x, 0.1, wz);
  for (const s of [-1, 1]) wheel(b, x + s * (bw / 2 - 0.02), 0.1, wz, 0.1, 0.045, mat("#3a3c40"), 16);
  b.box(bw * 0.5, 0.035, 0.07, x, 0.2, zb - 0.02, body);
}

export const BUILDERS: Record<string, Build> = {
  garden_shed: (b, w, d, h, f, color) => {
    // an apex shed of shiplap boards on bearers, corner trims, a felt roof with overhangs,
    // barge and fascia boards, a ledged and braced door with strap hinges, two windows
    const base = 0.08;
    const wall = h * 0.7;
    const rise = h - wall;
    const ov = Math.min(0.16, w * 0.06);
    const theta = Math.atan2(rise, d / 2);
    const painted = color !== "oak";
    const trim = painted ? mat("#ecebe6", { roughness: 0.7 }) : tint(f, 0.72);
    const felt = mat("#2c2e31", { roughness: 1 });
    const feltEdge = mat("#3a3c40", { roughness: 1 });
    const core = mat("#2a2420", { roughness: 1 });
    const alt = tint(f, 0.92);
    b.box(w - 0.06, base, d - 0.06, 0, 0, 0, mat("#3b3631", { roughness: 1 }));
    b.box(w - 0.05, wall - base, d - 0.05, 0, base, 0, core);
    gable(b, 0, d / 2 - 0.03, wall, rise - 0.03, w - 0.05, core);
    // shiplap: each board tilted so its lower edge stands proud
    const rows = Math.max(5, Math.round((wall - base) / 0.13));
    const bh = (wall - base) / rows;
    const tilt = 0.07;
    for (let r = 0; r < rows; r++) {
      const y = base + r * bh + bh / 2;
      const m = r % 2 ? f : alt;
      for (const s of [-1, 1]) {
        b.add(new THREE.BoxGeometry(w - 0.03, bh + 0.006, 0.02), m, 0, y, s * (d / 2 - 0.015)).rotation.x = -s * tilt;
        b.add(new THREE.BoxGeometry(0.02, bh + 0.006, d - 0.05), m, s * (w / 2 - 0.015), y, 0).rotation.z = s * tilt;
      }
    }
    // the gables above the eaves, boards getting shorter
    const grows = Math.max(2, Math.round(rise / bh));
    const gh = rise / grows;
    for (let r = 0; r < grows; r++) {
      const yc = wall + r * gh + gh / 2;
      const len = (d - 0.05) * (1 - (yc + gh / 2 - wall) / rise) - 0.02;
      if (len < 0.08) continue;
      for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.02, gh + 0.006, len), r % 2 ? alt : f, s * (w / 2 - 0.015), yc, 0).rotation.z = s * tilt;
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.07, wall - base - 0.04, 0.07, sx * (w / 2 - 0.02), base, sz * (d / 2 - 0.02), trim);
    // the roof: felt on two slopes, overlap strips, a ridge cap, fascia and barge boards
    const yEave = wall - ov * Math.tan(theta);
    for (const s of [-1, 1]) {
      const ze = s * (d / 2 + ov);
      plank(b, 0, w + 2 * ov, 0, h, ze, yEave, 0.05, felt);
      for (const k of [0.3, 0.62]) {
        const z0 = ze * k;
        const y0 = h + (yEave - h) * k;
        plank(b, 0, w + 2 * ov + 0.01, z0, y0 + 0.006, z0 + s * 0.04, y0 + 0.006 + ((yEave - h) / Math.abs(ze)) * 0.04, 0.008, feltEdge);
      }
      b.box(w + 2 * ov, 0.12, 0.025, 0, yEave - 0.1, ze + s * 0.012, trim);
      for (const sx of [-1, 1]) plank(b, sx * (w / 2 + ov + 0.012), 0.025, 0, h + 0.03, ze + s * 0.012, yEave + 0.02, 0.13, trim);
    }
    b.box(w + 2 * ov + 0.02, 0.03, 0.14, 0, h - 0.015, 0, feltEdge);
    // a ledged and braced door with strap hinges and a latch
    const dw = Math.min(0.82, w * 0.36);
    const dh = Math.min(wall - base - 0.12, 1.8);
    const dx = -w * 0.2;
    const zf = d / 2;
    const door = painted ? f : tint(f, 0.85);
    const iron = mat(C.black, { metalness: 0.4 });
    b.box(dw, dh, 0.03, dx, base + 0.02, zf + 0.012, door);
    grooves(b, [1, 2, 3, 4].map((i) => dx - dw / 2 + (i * dw) / 5), base + 0.04, dh - 0.04, zf + 0.028, core);
    for (const y of [0.22, 0.78]) b.box(dw - 0.08, 0.09, 0.02, dx, base + dh * y - 0.045, zf + 0.035, door);
    const brace = b.add(new THREE.BoxGeometry(0.08, Math.hypot(dw - 0.14, dh * 0.56), 0.02), door, dx, base + dh * 0.5, zf + 0.035);
    brace.rotation.z = Math.atan2(dw - 0.14, dh * 0.56);
    for (const y of [0.22, 0.78]) b.box(0.3, 0.025, 0.01, dx - dw / 2 + 0.15, base + dh * y - 0.012, zf + 0.048, iron);
    b.box(0.03, 0.12, 0.02, dx + dw / 2 - 0.08, base + dh * 0.48, zf + 0.04, iron, 0.006);
    b.box(0.05, 0.05, 0.02, dx + dw / 2 - 0.08, base + dh * 0.42, zf + 0.04, iron, 0.006);
    for (const s of [-1, 1]) b.box(0.06, dh + 0.06, 0.04, dx + s * (dw / 2 + 0.03), base, zf + 0.01, trim);
    b.box(dw + 0.18, 0.06, 0.04, dx, base + dh + 0.02, zf + 0.01, trim);
    // windows: one in the front, one in the right gable wall
    const ww = Math.min(0.62, w * 0.26);
    const wh = Math.min(0.5, (wall - base) * 0.34);
    shedWindow(b, w * 0.25, base + (wall - base) * 0.66, zf + 0.012, ww, wh, trim);
    if (d > 1.2) shedWindow(b, w / 2 + 0.012, base + (wall - base) * 0.66, -d * 0.1, Math.min(0.5, d * 0.25), wh * 0.85, trim, Math.PI / 2);
  },

  greenhouse: (b, w, d, h, f, color) => {
    // an aluminium greenhouse: base rail, glazing bars, glass walls and roof, a roof vent,
    // sliding double doors at the front, staging with pots at the back, tomatoes on the side
    const fr = color === "silver" ? metal(FINISHES.silver) : f;
    const pane = glass();
    const wall = h * 0.66;
    const rise = h - wall;
    const s = 0.035;
    const base = 0.07;
    const roofY = (z: number) => wall + rise * (1 - Math.abs(z) / (d / 2));
    // glass
    for (const sz of [-1, 1]) b.box(w - s, wall - base, 0.006, 0, base, sz * (d / 2 - s / 2), pane);
    for (const sx of [-1, 1]) {
      b.box(0.006, wall - base, d - s, sx * (w / 2 - s / 2), base, 0, pane);
      gable(b, sx * (w / 2 - s / 2), d / 2 - s, wall, rise - s, 0.006, pane);
    }
    for (const sz of [-1, 1]) plank(b, 0, w - s, 0, h - 0.01, sz * (d / 2), wall, 0.006, pane);
    // the frame
    for (const sz of [-1, 1]) {
      b.box(w, base, s, 0, 0, sz * (d / 2 - s / 2), fr);
      b.box(w + 0.04, s * 1.4, s * 1.8, 0, wall - s * 0.7, sz * (d / 2 + 0.005), fr);
      b.box(w, s * 0.6, s * 0.8, 0, wall * 0.42, sz * (d / 2 - s / 2), fr);
    }
    for (const sx of [-1, 1]) {
      b.box(s, base, d, sx * (w / 2 - s / 2), 0, 0, fr);
      b.box(s * 0.8, s * 0.6, d, sx * (w / 2 - s / 2), wall * 0.42, 0, fr);
      for (const sz of [-1, 1]) b.box(s * 1.2, wall, s * 1.2, sx * (w / 2 - s * 0.6), 0, sz * (d / 2 - s * 0.6), fr);
      // gable bars up to the roof line
      const n = Math.max(2, Math.round(d / 0.6));
      for (let i = 1; i < n; i++) {
        const z = -d / 2 + (i * d) / n;
        b.box(s * 0.8, roofY(z) - base - 0.01, s * 0.8, sx * (w / 2 - s / 2), base, z, fr);
      }
      for (const sz of [-1, 1]) plank(b, sx * (w / 2 - s / 2), s, 0, h + 0.005, (sz * d) / 2, wall + 0.005, s * 1.2, fr);
    }
    b.box(w + 0.04, s * 1.3, s * 1.3, 0, h - s * 1.1, 0, fr);
    // bays: wall and roof glazing bars
    const bays = Math.max(2, Math.round(w / 0.62));
    const dw = Math.min(0.78, w * 0.34);
    for (let i = 1; i < bays; i++) {
      const x = -w / 2 + (i * w) / bays;
      for (const sz of [-1, 1]) {
        if (sz === 1 && Math.abs(x) < dw / 2 + 0.05) continue;
        b.box(s * 0.8, wall - base, s * 0.8, x, base, sz * (d / 2 - s / 2), fr);
      }
      for (const sz of [-1, 1]) plank(b, x, s * 0.8, 0, h, (sz * d) / 2, wall + 0.01, s, fr);
    }
    // a roof vent, propped open, on the front slope
    const vx = -w / 2 + (w / bays) * 0.5;
    const vw = w / bays - s;
    const vz = (d / 2) * 0.45;
    const vy = roofY(vz) + 0.13;
    plank(b, vx, vw, 0.04, h + 0.015, vz, vy, 0.006, pane);
    for (const sx of [-1, 1]) plank(b, vx + (sx * vw) / 2, s * 0.6, 0.04, h + 0.02, vz, vy + 0.005, s * 0.8, fr);
    b.box(vw, s * 0.8, s * 0.6, vx, vy - s * 0.4, vz, fr);
    b.rod(v(vx, roofY(vz) - 0.02, vz - 0.05), v(vx, vy - 0.01, vz), 0.006, fr, 4);
    // sliding doors in the front wall: two framed panes, the right one slid open a little
    for (const sx of [-1, 1]) b.box(s * 1.2, wall - base, s * 1.2, sx * (dw / 2 + s * 0.6), base, d / 2 - s / 2, fr);
    b.box(dw + 2 * s, s * 1.4, s * 1.4, 0, wall - s * 2.4, d / 2 - s / 2, fr);
    const ph = wall - base - s * 2.6;
    for (const [i, off] of [[0, 0], [1, 0.16]]) {
      const pw = dw / 2 + 0.03;
      const x = -dw / 4 + i * (dw / 2) - off;
      const z = d / 2 + 0.012 + i * 0.022;
      b.box(pw - s, ph - s, 0.006, x, base + s / 2, z, pane);
      for (const y of [base, base + ph * 0.45, base + ph - s]) b.box(pw, s * (y === base ? 1.4 : 0.8), s * 0.6, x, y, z, fr);
      for (const sx of [-1, 1]) b.box(s * 0.8, ph, s * 0.6, x + (sx * (pw - s * 0.8)) / 2, base, z, fr);
    }
    b.box(0.02, 0.12, 0.03, 0.06 - 0.16, base + ph * 0.5, d / 2 + 0.06, mat(C.black), 0.006);
    // staging at the back with pots
    const sw = Math.min(w - 0.3, w * 0.75);
    const sd = Math.min(0.45, d * 0.25);
    const sz0 = -d / 2 + 0.06 + sd / 2;
    const sy = Math.min(0.78, wall * 0.55);
    for (let i = 0; i < 4; i++) b.box(sw, 0.02, sd / 4 - 0.01, 0, sy, sz0 - sd / 2 + ((i + 0.5) * sd) / 4, mat(FINISHES.oak));
    for (const sx of [-1, 1]) for (const dz of [-1, 1]) b.box(0.03, sy, 0.03, sx * (sw / 2 - 0.04), 0, sz0 + (dz * (sd - 0.06)) / 2, fr);
    b.box(sw - 0.06, 0.025, 0.025, 0, sy * 0.3, sz0, fr);
    const rand = random(113);
    const terracotta = mat(FINISHES.terracotta, { roughness: 0.9 });
    const np = Math.max(3, Math.round(sw / 0.32));
    for (let i = 0; i < np; i++) {
      const x = -sw / 2 + ((i + 0.5) * sw) / np;
      b.cyl(0.075, 0.055, 0.12, x, sy + 0.02, sz0, terracotta, 10);
      foliage(b, rand, x, sy + 0.24, sz0, 0.1, 0.11, 0.1, 18, 0.07, [C.leaf, C.leafLight], true);
    }
    // tomatoes on canes along the left wall
    const red = mat("#c8372a", { roughness: 0.5 });
    const nt = Math.max(2, Math.round((d - sd - 0.3) / 0.45));
    for (let i = 0; i < nt; i++) {
      const z = sz0 + sd / 2 + 0.25 + i * 0.42;
      if (z > d / 2 - 0.2) break;
      const x = -w / 2 + 0.25;
      b.box(0.36, 0.1, 0.3, x, 0, z, mat("#3a2f26", { roughness: 1 }), 0.02);
      const th = Math.min(1.25, wall - 0.15);
      b.rod(v(x, 0.05, z), v(x, th + 0.05, z), 0.008, mat("#a88a5a"), 4);
      foliage(b, rand, x, 0.1 + th * 0.55, z, 0.16, th * 0.45, 0.16, 45, 0.09, [C.leafDark, C.leaf], false);
      for (let k = 0; k < 4; k++) b.sphere(0.03, x + (rand() - 0.5) * 0.24, 0.35 + rand() * th * 0.7, z + 0.1 + rand() * 0.06, red, 1, 1, 1, 8);
    }
  },

  pool: (b, w, d, h, f, color) => {
    // an above-ground pool: clad walls with uprights, a stone coping, a mosaic band and a
    // light blue liner inside, the water, steps down at one end with a handrail, a skimmer
    const wood = color === "oak";
    const t = 0.1;
    const lip = 0.03;
    const cw = 0.16;
    const ow = w - 2 * lip;
    const od = d - 2 * lip;
    const top = h - 0.045;
    const coping = mat("#e4e0d6", { roughness: 0.8 });
    const liner = mat("#a6d8e6", { roughness: 0.6 });
    const band = mat("#2d6f8f", { roughness: 0.4 });
    const dark = mat("#1d2023", { roughness: 1 });
    // the walls
    for (const s of [-1, 1]) {
      b.box(ow, top, t, 0, 0, s * (od / 2 - t / 2), f);
      b.box(t, top, od - 2 * t, s * (ow / 2 - t / 2), 0, 0, f);
    }
    if (wood) {
      // vertical boards: their joints, a plinth board
      const nx = Math.round(ow / 0.14);
      grooves(b, Array.from({ length: nx - 1 }, (_, i) => -ow / 2 + ((i + 1) * ow) / nx), 0, top, od / 2 + 0.002, dark);
      const nz = Math.round(od / 0.14);
      for (let i = 1; i < nz; i++) b.batch(new THREE.BoxGeometry(0.004, top, 0.006), dark, matrix(ow / 2 + 0.002, top / 2, -od / 2 + (i * od) / nz));
      for (const s of [-1, 1]) b.box(ow + 0.02, 0.08, 0.02, 0, 0, s * (od / 2 + 0.005), tint(f, 0.75));
    } else {
      // the steel frame: uprights and a foot rail
      const up = tint(f, 0.72);
      const nx = Math.max(2, Math.round(ow / 1.0));
      for (let i = 0; i <= nx; i++) for (const s of [-1, 1]) b.box(0.07, top, 0.03, -ow / 2 + 0.035 + (i * (ow - 0.07)) / nx, 0, s * (od / 2 + 0.01), up, 0.01);
      const nz = Math.max(1, Math.round(od / 1.0));
      for (let i = 1; i < nz; i++) for (const s of [-1, 1]) b.box(0.03, top, 0.07, s * (ow / 2 + 0.01), 0, -od / 2 + (i * od) / nz, up, 0.01);
      for (const s of [-1, 1]) b.box(ow + 0.02, 0.05, 0.03, 0, 0, s * (od / 2 + 0.01), up);
    }
    // the coping around the top
    for (const s of [-1, 1]) {
      b.box(w, 0.045, cw, 0, top, s * (d / 2 - cw / 2), coping, 0.012);
      b.box(cw, 0.045, d - 2 * cw, s * (w / 2 - cw / 2), top, 0, coping, 0.012);
    }
    // liner and mosaic band inside
    const iw = ow - 2 * t;
    const id = od - 2 * t;
    b.box(iw, 0.02, id, 0, 0.02, 0, liner);
    for (const s of [-1, 1]) {
      b.box(iw, top - 0.04, 0.01, 0, 0.04, s * (id / 2 - 0.005), liner);
      b.box(0.01, top - 0.04, id, s * (iw / 2 - 0.005), 0.04, 0, liner);
      b.box(iw, 0.14, 0.012, 0, top - 0.14, s * (id / 2 - 0.006), band);
      b.box(0.012, 0.14, id, s * (iw / 2 - 0.006), top - 0.14, 0, band);
    }
    // the skimmer
    b.box(0.22, 0.1, 0.012, -iw * 0.3, top - 0.24, -id / 2 + 0.012, mat(C.ceramic), 0.004);
    b.box(0.18, 0.05, 0.014, -iw * 0.3, top - 0.22, -id / 2 + 0.014, dark);
    // steps down at the right end, under water
    const stepW = Math.min(1.0, id * 0.6);
    const n = 3;
    const sDepth = 0.32;
    const waterY = h - 0.2;
    for (let i = 0; i < n; i++) {
      const sh = waterY - 0.2 - (i * (waterY - 0.25)) / n;
      b.box(sDepth * (i + 1), 0.04, stepW, iw / 2 - (sDepth * (i + 1)) / 2, sh - 0.04, 0, mat("#e8f4f6", { roughness: 0.6 }));
      b.box(0.02, sh - 0.04, stepW, iw / 2 - sDepth * (i + 1) + 0.01, 0, 0, liner);
    }
    // a stainless handrail over the coping beside the steps
    const steel = metal(C.chrome, 0.25);
    const rz = stepW / 2 + 0.05;
    const hx0 = iw / 2 - sDepth * 2.4;
    const pts = [v(hx0, waterY - 0.35, rz), v(hx0, h + 0.4, rz), v(ow / 2 - 0.05, h + 0.55, rz), v(w / 2 + 0.02, h + 0.35, rz), v(w / 2 + 0.03, h - 0.02, rz)];
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.022, 6, false), steel);
    // the water lights up with the pool's light (in its colour) or pump linked
    b.box(iw - 0.02, 0.02, id - 0.02, 0, waterY, 0, glowing(part(mat("#3fa4c8", { transparent: true, opacity: 0.7, roughness: 0.05 }), "water")));
  },

  barrel_sauna: (b, w, d, h, f) => {
    // a barrel of staves on two cradles with steel bands, a porch under the barrel's end,
    // a front wall of upright boards with a glass door, a bench inside, the stove's chimney
    const r = Math.min(w / 2, (h - 0.08) / 2 - 0.06);
    const cy = r + 0.08;
    const len = d - 0.04;
    const staves = 30;
    const sw = ((2 * Math.PI * r) / staves) * 1.04;
    const alt = tint(f, 0.86);
    for (let i = 0; i < staves; i++) {
      const a = (i / staves) * Math.PI * 2;
      const stave = b.add(new THREE.BoxGeometry(sw, 0.045, len), i % 3 === 1 ? alt : f, Math.cos(a) * (r - 0.022), cy + Math.sin(a) * (r - 0.022), 0);
      stave.rotation.z = a + Math.PI / 2;
    }
    // the stave ends show darker at both ends
    for (const s of [-1, 1]) b.add(new THREE.RingGeometry(r - 0.045, r, staves, 1), tint(f, 0.6), 0, cy, s * (len / 2 + 0.001)).rotation.y = s > 0 ? 0 : Math.PI;
    const band = mat(C.black, { metalness: 0.5, roughness: 0.4 });
    const bands = [-len / 2 + 0.3, len / 2 - 0.3];
    for (const z of bands) b.add(new THREE.TorusGeometry(r + 0.004, 0.014, 4, 48), band, 0, cy, z);
    // cradles: a block with an arc cut out
    for (const z of bands) {
      const cwid = Math.min(w * 0.92, 2 * r * 0.95);
      const shape = new THREE.Shape();
      shape.moveTo(-cwid / 2, 0);
      shape.lineTo(cwid / 2, 0);
      const steps = 16;
      for (let k = 0; k <= steps; k++) {
        const x = cwid / 2 - (k * cwid) / steps;
        shape.lineTo(x, cy - Math.sqrt(Math.max(0, r * r - x * x)));
      }
      shape.lineTo(-cwid / 2, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -0.05);
      b.add(geo, tint(f, 0.7), 0, 0, z - Math.sign(z) * 0.16);
    }
    // the front wall set back under a porch, upright boards cut to the circle
    const porch = Math.min(0.4, len * 0.17);
    const zf = len / 2 - porch;
    const boards = Math.max(8, Math.round((2 * r) / 0.12));
    const bw = (2 * (r - 0.04)) / boards;
    const joint = mat("#4a3826", { roughness: 1 });
    const endWall = (z: number, s: number) => {
      b.add(new THREE.CylinderGeometry(r - 0.03, r - 0.03, 0.04, 40).rotateX(Math.PI / 2), alt, 0, cy, z);
      for (let i = 1; i < boards; i++) {
        const x = -r + 0.04 + i * bw;
        const half = Math.sqrt(Math.max(0, (r - 0.035) ** 2 - x * x));
        if (half > 0.02) b.batch(new THREE.BoxGeometry(0.008, 2 * half, 0.004), joint, matrix(x, cy, z + s * 0.021));
      }
    };
    endWall(zf, 1);
    endWall(-len / 2 + 0.05, -1);
    // the porch floor and the glass door
    const dh = Math.min(1.75, 2 * r * 0.84);
    const dwid = Math.min(0.66, r * 0.7);
    const dy = cy - r + 0.12;
    const frame = tint(f, 0.65);
    b.box(Math.min(1.4, r * 1.5), 0.04, porch, 0, cy - r + 0.04, zf + porch / 2 + 0.02, alt);
    b.box(dwid + 0.12, dh + 0.06, 0.05, 0, dy, zf + 0.005, frame);
    b.box(dwid, dh, 0.004, 0, dy + 0.03, zf + 0.03, mat("#1e1a17", { roughness: 1 }));
    b.box(dwid, dh, 0.02, 0, dy + 0.03, zf + 0.036, mat("#6f8f9e", { transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.3 }));
    b.box(0.03, 0.32, 0.04, dwid / 2 - 0.08, dy + dh * 0.45, zf + 0.06, mat(C.trunk), 0.01);
    // a small round window either side
    for (const s of [-1, 1]) {
      const wx = s * (dwid / 2 + (r - dwid / 2) * 0.5);
      if (Math.abs(wx) + 0.16 > r * 0.8) continue;
      b.add(new THREE.CircleGeometry(0.14, 20), mat("#3d4f58", { roughness: 0.1, metalness: 0.4 }), wx, cy + r * 0.3, zf + 0.022);
      b.add(new THREE.TorusGeometry(0.15, 0.02, 4, 20), frame, wx, cy + r * 0.3, zf + 0.025);
    }
    // a bench inside, seen through the door
    b.box(2 * r * 0.75, 0.05, 0.45, 0, cy - r * 0.35, -len / 2 + 0.4, alt);
    // the stove's chimney with its rain cap
    const chx = r * 0.45;
    const surf = cy + Math.sqrt(r * r - chx * chx);
    const top = Math.max(surf + 0.12, h + 0.05);
    const steel = metal(C.steel, 0.4);
    b.cyl(0.065, 0.065, top - surf + 0.05, chx, surf - 0.06, -len * 0.3, steel, 14);
    b.cyl(0.11, 0.11, 0.015, chx, surf - 0.005, -len * 0.3, steel, 14);
    b.add(new THREE.ConeGeometry(0.12, 0.06, 14), steel, chx, top + 0.04, -len * 0.3);
  },

  gazebo: (b, w, d, h, f, _c, a, ac) => {
    // four posts on foot plates with corner braces, eave beams, a two-tier canopy in the
    // accent with a scalloped valance, and curtains tied back at each post
    const post = 0.08;
    const eaves = h * 0.72;
    const canopy = mat(hex(ac, a), { side: THREE.DoubleSide, roughness: 1 });
    const curtain = mat(new THREE.Color(hex(ac, a)).multiplyScalar(0.94).getStyle(), { side: THREE.DoubleSide, roughness: 1 });
    const px = w / 2 - post;
    const pz = d / 2 - post;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.box(post, eaves, post, sx * px, 0, sz * pz, f, 0.01);
      b.box(0.2, 0.012, 0.2, sx * px, 0, sz * pz, f, 0.004);
      // braces into both beams
      b.rod(v(sx * px, eaves - 0.45, sz * pz), v(sx * (px - 0.4), eaves - 0.09, sz * pz), 0.018, f, 6);
      b.rod(v(sx * px, eaves - 0.45, sz * pz), v(sx * px, eaves - 0.09, sz * (pz - 0.4)), 0.018, f, 6);
    }
    for (const sz of [-1, 1]) b.box(w - 0.04, 0.12, 0.06, 0, eaves - 0.12, sz * pz, f, 0.01);
    for (const sx of [-1, 1]) b.box(0.06, 0.12, d - 0.04, sx * px, eaves - 0.12, 0, f, 0.01);
    // the canopy: a lower hipped tier, a gap, a raised top tier
    const rise = h - eaves;
    const lowTop = eaves + rise * 0.62;
    const k = 0.24; // the lower tier's opening, as a share of the size
    const ow = w + 0.12;
    const od = d + 0.12;
    const frustum = (wb: number, db: number, wt: number, dt: number, y0: number, y1: number) => {
      const geo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1, true, Math.PI / 4);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const up = pos.getY(i) > 0;
        pos.setX(i, pos.getX(i) * (up ? wt : wb));
        pos.setZ(i, pos.getZ(i) * (up ? dt : db));
        pos.setY(i, up ? y1 : y0);
      }
      geo.computeVertexNormals();
      return b.add(geo, canopy);
    };
    frustum(ow, od, w * k, d * k, eaves - 0.02, lowTop);
    frustum(w * (k + 0.16), d * (k + 0.16), 0.001, 0.001, lowTop + 0.07, h - 0.03);
    // the top tier's short posts and the finial
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v((sx * w * k) / 2, lowTop - 0.02, (sz * d * k) / 2), v((sx * w * k) / 2, lowTop + 0.1, (sz * d * k) / 2), 0.015, f, 4);
    b.cyl(0.02, 0.035, 0.08, 0, h - 0.08, 0, f, 8);
    b.sphere(0.03, 0, h - 0.01, 0, f, 1, 1, 1, 8);
    // hip rafters under the canopy
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v(sx * px, eaves, sz * pz), v((sx * w * k) / 2, lowTop - 0.04, (sz * d * k) / 2), 0.02, f, 6);
    // the valance: scalloped flaps hanging from the eaves
    const flap = (len: number, x: number, z: number, rot: number) => {
      const n = Math.max(3, Math.round(len / 0.32));
      const shape = new THREE.Shape();
      shape.moveTo(-len / 2, 0);
      for (let i = 0; i < n; i++) {
        const x0 = -len / 2 + (i * len) / n;
        shape.lineTo(x0, -0.14);
        shape.quadraticCurveTo(x0 + len / n / 2, -0.24, x0 + len / n, -0.14);
      }
      shape.lineTo(len / 2, 0);
      b.add(new THREE.ShapeGeometry(shape, 4), canopy, x, eaves - 0.02, z).rotation.y = rot;
    };
    flap(ow, 0, od / 2, 0);
    flap(ow, 0, -od / 2, 0);
    flap(od, ow / 2, 0, Math.PI / 2);
    flap(od, -ow / 2, 0, Math.PI / 2);
    // curtains gathered at each post, tied at the middle
    const ch = eaves - 0.2;
    const prof = [0.16, 0.1, 0.05, 0.11, 0.15, 0.03].map((x, i) => new THREE.Vector2(x, (i / 5) * ch));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const geo = new THREE.LatheGeometry(prof, 18);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const ang = Math.atan2(pos.getZ(i), pos.getX(i));
        const kk = 1 + 0.18 * Math.cos(ang * 7);
        pos.setX(i, pos.getX(i) * kk);
        pos.setZ(i, pos.getZ(i) * kk);
      }
      geo.computeVertexNormals();
      const cx = sx * (px - 0.1);
      const cz = sz * (pz - 0.04);
      b.add(geo, curtain, cx, 0.06, cz);
      b.add(new THREE.TorusGeometry(0.06, 0.012, 4, 12), mat(C.trunk), cx, ch * 0.4 + 0.06, cz).rotation.x = Math.PI / 2;
    }
  },

  trampoline: (b, w, d, h, f) => {
    // a round trampoline: four W-legs, the frame ring, springs under a padded cover, the
    // black mat, eight padded net poles with a sagging top rope and the net, a ladder
    const r = Math.min(w, d) / 2 - 0.02;
    const top = Math.min(0.9, h * 0.35);
    const steel = metal(C.steel, 0.4);
    const rf = r * 0.97;
    const poles = 8;
    const pa = (k: number) => Math.PI / poles + (k * 2 * Math.PI) / poles;
    const at = (a: number, rr: number, y: number) => v(Math.cos(a) * rr, y, Math.sin(a) * rr);
    b.add(new THREE.TorusGeometry(rf, 0.024, 6, 40), steel, 0, top - 0.03, 0).rotation.x = Math.PI / 2;
    for (let k = 0; k < poles; k++) {
      b.batch(rodGeo(at(pa(k), rf, 0.02), at(pa(k), rf, top - 0.03), 0.022, 8), steel);
      // the ground bars join the uprights in pairs
      if (k % 2 === 0) b.batch(rodGeo(at(pa(k), rf, 0.022), at(pa(k + 1), rf, 0.022), 0.022, 8), steel);
    }
    // springs from the frame to the mat, the mat, the pad over the springs
    const springs = 60;
    const spring = mat("#c9ced3", { metalness: 0.7, roughness: 0.3 });
    for (let i = 0; i < springs; i++) {
      const a = (i / springs) * Math.PI * 2;
      b.batch(rodGeo(at(a, rf - 0.01, top - 0.02), at(a, r * 0.8, top - 0.012), 0.007, 3), spring);
    }
    b.cyl(r * 0.81, r * 0.81, 0.012, 0, top - 0.02, 0, mat("#1c1d20", { roughness: 0.9 }), 48);
    const pad = b.add(new THREE.TorusGeometry(r * 0.9, r * 0.1, 6, 40), f, 0, top + 0.005, 0);
    pad.rotation.x = Math.PI / 2;
    pad.scale.z = 0.03 / (r * 0.1);
    // poles in foam sleeves up to the top rope
    const ptop = h - 0.03;
    for (let k = 0; k < poles; k++) {
      b.batch(rodGeo(at(pa(k), rf, top - 0.03), at(pa(k), rf, ptop), 0.022, 8), steel);
      b.batch(rodGeo(at(pa(k), rf, top + 0.03), at(pa(k), rf, ptop - 0.04), 0.038, 10), f);
      b.batch(new THREE.SphereGeometry(0.04, 8, 4).translate(Math.cos(pa(k)) * rf, ptop - 0.01, Math.sin(pa(k)) * rf), f);
    }
    const sag = 0.16;
    const sagAt = (a: number) => sag * Math.sin(((a - Math.PI / poles) * poles) / 2) ** 2;
    const rope: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      rope.push(at(a, rf, ptop - 0.02 - sagAt(a)));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rope, true), 64, 0.012, 4, true), f);
    // the net: a sheet with a fine mesh look, its top following the rope, a zipped door at the front
    const net = new THREE.CylinderGeometry(rf - 0.01, rf - 0.01, 1, 64, 1, true);
    const pos = net.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, pos.getY(i) > 0 ? ptop - 0.03 - sagAt(a) : top + 0.02);
    }
    net.computeVertexNormals();
    b.add(net, mat("#1b1d20", { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
    for (let k = 1; k <= 3; k++) {
      const y = top + ((ptop - 0.1 - top) * k) / 4;
      b.add(new THREE.TorusGeometry(rf - 0.005, 0.004, 3, 48), mat("#2a2c30"), 0, y, 0).rotation.x = Math.PI / 2;
    }
    const za = Math.PI / 2;
    b.batch(rodGeo(at(za, rf - 0.004, top + 0.04), at(za, rf - 0.004, ptop - 0.06 - sag), 0.01, 4), f);
    // a ladder at the front right, where the square leaves room
    const la = Math.PI / 4;
    const dir = v(Math.cos(la), 0, Math.sin(la));
    const side = v(-Math.sin(la), 0, Math.cos(la));
    for (const s of [-1, 1]) {
      const o = side.clone().multiplyScalar(s * 0.24);
      b.batch(rodGeo(dir.clone().multiplyScalar(r + 0.38).add(o), dir.clone().multiplyScalar(r + 0.02).add(o).setY(top - 0.02), 0.02, 6), steel);
    }
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const c = dir.clone().multiplyScalar(r + 0.38 - 0.36 * t).setY((top - 0.02) * t);
      const rung = b.add(new THREE.BoxGeometry(0.48, 0.025, 0.09), mat("#2a2c30", { roughness: 0.6 }), c.x, c.y, c.z);
      rung.rotation.y = -la + Math.PI / 2;
    }
  },

  swing: (b, w, d, h, f, color) => {
    // an A-frame swing: log legs splayed at both ends with cross bars and knee braces, a top
    // beam on steel brackets, two board seats on chains with sleeves, ground anchors
    const wood = mat(FINISHES.oak, { roughness: 0.85 });
    const endWood = mat("#a07b52", { roughness: 0.9 });
    const iron = mat("#3a3d42", { metalness: 0.5, roughness: 0.45 });
    const beamY = h - 0.12;
    const lx = w / 2 - 0.08;
    const foot = d / 2 - 0.07;
    for (const sx of [-1, 1]) {
      const x = sx * lx;
      for (const sz of [-1, 1]) {
        b.rod(v(x, 0, sz * foot), v(x, beamY + 0.02, sz * 0.05), 0.055, wood, 10);
        b.box(0.05, 0.04, 0.3, x, 0, sz * (foot - 0.05), iron);
      }
      // the cross bar and the bracket holding the beam
      const yb = beamY * 0.4;
      const half = foot * (1 - yb / (beamY + 0.02)) + 0.05 * (yb / (beamY + 0.02));
      b.box(0.07, 0.09, 2 * half + 0.1, x + sx * 0.06, yb, 0, wood);
      b.box(0.14, 0.2, 0.16, x, beamY - 0.06, 0, iron);
      for (const sz of [-1, 1]) {
        const y = beamY - 0.5;
        const z = sz * (foot + ((0.05 - foot) * y) / (beamY + 0.02));
        b.rod(v(x, y, z), v(x - sx * 0.42, beamY - 0.02, sz * 0.035), 0.03, wood, 8);
      }
    }
    b.box(w, 0.13, 0.11, 0, beamY - 0.03, 0, wood, 0.01);
    for (const sx of [-1, 1]) b.box(0.012, 0.125, 0.105, sx * (w / 2 + 0.001), beamY - 0.027, 0, endWood);
    // two seats on chains, the left one swung out a little
    const chain = mat("#9aa0a6", { metalness: 0.7, roughness: 0.35 });
    const sleeve = color === "oak" ? mat("#2f3237", { roughness: 0.6 }) : f;
    const seats: [number, number][] = [[-w * 0.22, 0.12], [w * 0.22, 0]];
    for (const [x, swing] of seats) {
      const sy = 0.42;
      const len = beamY - 0.03 - sy;
      const dz = Math.sin(swing) * len;
      const yy = beamY - 0.03 - Math.cos(swing) * len;
      for (const ox of [-0.2, 0.2]) {
        b.add(new THREE.TorusGeometry(0.025, 0.007, 4, 10), iron, x + ox, beamY - 0.04, 0);
        b.batch(rodGeo(v(x + ox, beamY - 0.05, 0), v(x + ox, yy + 0.02, dz), 0.006, 4), chain);
        const sl = v(x + ox, yy + 0.02, dz).lerp(v(x + ox, beamY - 0.05, 0), 0.25);
        b.batch(rodGeo(v(x + ox, yy + 0.03, dz), sl, 0.013, 6), sleeve);
      }
      const seat = b.box(0.46, 0.035, 0.17, x, yy, dz, f, 0.012)!;
      seat.rotation.x = swing;
    }
  },

  playhouse: (b, w, d, h, f, color) => {
    // a children's playhouse with its gable to the front: board walls on a deck, a shingled
    // roof with barge boards, an arched door with a porthole, a window with shutters and a
    // flower box, a round gable window and a side window
    const ov = Math.min(0.14, w * 0.09);
    const bw = w - 2 * ov;
    const bd = d - 0.14;
    const wall = h * 0.56;
    const apex = h - 0.03; // the roof line at the ridge
    const rise = apex - wall; // the gable above the walls
    const k = rise / (bw / 2);
    const yEave = apex - (k * w) / 2;
    const deck = 0.07;
    const trim = color === "white" ? mat("#7d9bb5", { roughness: 0.7 }) : mat("#f3f1ea", { roughness: 0.7 });
    const roof = color === "red" ? mat("#4a4e55", { roughness: 0.9 }) : mat("#a5503a", { roughness: 0.9 });
    const roofEdge = color === "red" ? mat("#3c4046", { roughness: 0.9 }) : mat("#8c4331", { roughness: 0.9 });
    const joint = mat(new THREE.Color(hex(color, f)).multiplyScalar(0.62).getStyle(), { roughness: 1 });
    // the deck and the walls
    for (let i = 0; i < 5; i++) b.box(w - 0.04, deck, d / 5 - 0.012, 0, 0, -d / 2 + ((i + 0.5) * d) / 5, mat(FINISHES.oak, { roughness: 0.9 }));
    b.box(bw, wall - deck, bd, 0, deck, 0, f);
    const tri = new THREE.Shape([new THREE.Vector2(-bw / 2, 0), new THREE.Vector2(bw / 2, 0), new THREE.Vector2(0, rise - 0.03)]);
    b.add(new THREE.ExtrudeGeometry(tri, { depth: bd, bevelEnabled: false }).translate(0, 0, -bd / 2), f, 0, wall, 0);
    // board joints on the front and the sides
    const rows = Math.max(4, Math.round((wall - deck) / 0.1));
    const bh = (wall - deck) / rows;
    for (let r = 1; r < rows; r++) {
      const y = deck + r * bh;
      for (const s of [-1, 1]) {
        b.batch(new THREE.BoxGeometry(bw + 0.004, 0.008, 0.006), joint, matrix(0, y, s * (bd / 2)));
        b.batch(new THREE.BoxGeometry(0.006, 0.008, bd + 0.004), joint, matrix(s * (bw / 2), y, 0));
      }
    }
    for (let r = 1; r * bh < rise * 0.8; r++) {
      const y = wall + r * bh;
      const half = (bw / 2) * (1 - (r * bh) / rise) - 0.02;
      if (half > 0.05) b.batch(new THREE.BoxGeometry(2 * half, 0.008, 0.006), joint, matrix(0, y, bd / 2));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.05, wall - deck - 0.02, 0.05, sx * (bw / 2 - 0.015), deck, sz * (bd / 2 - 0.015), trim);
    // the roof: shingle courses on both slopes, a ridge, barge boards on both gables
    const courses = Math.max(4, Math.round(Math.hypot(w / 2, rise) / 0.13));
    for (const s of [-1, 1]) {
      plankZ(b, 0, d, 0, apex, s * (w / 2), yEave, 0.025, roofEdge);
      for (let i = 0; i < courses; i++) {
        const t0 = i / courses;
        const t1 = (i + 1.25) / courses;
        const x0 = (s * w * Math.min(1, t1)) / 2;
        const x1 = (s * w * t0) / 2;
        const y0 = apex - (k * Math.abs(x0));
        const y1 = apex - (k * Math.abs(x1));
        const m = plankZ(b, 0, d + 0.01, x0, y0 + 0.022, x1, y1 + 0.022, 0.02, i % 2 ? roof : roofEdge);
        m.rotation.z += s * 0.04;
      }
    }
    b.box(0.09, 0.05, d, 0, h - 0.05, 0, roofEdge, 0.012);
    for (const sz of [-1, 1]) for (const s of [-1, 1]) plankZ(b, sz * (d / 2 - 0.0125), 0.025, 0, apex + 0.03, s * (w / 2), yEave + 0.03, 0.11, trim);
    // the door: arched top, a porthole, a knob
    const dw = Math.min(0.46, bw * 0.36);
    const dh = Math.min(wall - deck - 0.08, 1.05);
    const dx = -bw * 0.22;
    const zf = bd / 2;
    const door = new THREE.Shape();
    door.moveTo(-dw / 2, 0);
    door.lineTo(dw / 2, 0);
    door.lineTo(dw / 2, dh - dw / 2);
    door.absarc(0, dh - dw / 2, dw / 2, 0, Math.PI, false);
    door.lineTo(-dw / 2, 0);
    const doorM = color === "white" ? mat("#c96f5a", { roughness: 0.7 }) : trim;
    b.add(new THREE.ExtrudeGeometry(door, { depth: 0.03, bevelEnabled: false, curveSegments: 10 }), color === "white" ? trim : roofEdge, dx, deck, zf - 0.005).scale.set((dw + 0.08) / dw, (dh + 0.04) / dh, 1);
    b.add(new THREE.ExtrudeGeometry(door, { depth: 0.02, bevelEnabled: false, curveSegments: 10 }), doorM, dx, deck, zf + 0.02);
    for (const k of [1, 2]) b.batch(new THREE.BoxGeometry(0.006, dh * 0.62, 0.004), joint, matrix(dx - dw / 2 + (k * dw) / 3, deck + dh * 0.31, zf + 0.041));
    const glassDark = mat("#2c3a42", { roughness: 0.15, metalness: 0.4 });
    b.add(new THREE.CircleGeometry(0.075, 18), glassDark, dx, deck + dh - dw / 2, zf + 0.042);
    b.add(new THREE.TorusGeometry(0.08, 0.012, 4, 18), trim, dx, deck + dh - dw / 2, zf + 0.042);
    b.sphere(0.022, dx + dw / 2 - 0.07, deck + dh * 0.48, zf + 0.05, mat(C.chrome, { metalness: 0.7, roughness: 0.3 }), 1, 1, 1, 10);
    // the front window with shutters and a flower box
    const ww = Math.min(0.34, bw * 0.22);
    const sw = ww * 0.36; // a shutter
    const wx = (dx + dw / 2 + 0.04 + bw / 2 - 0.04) / 2;
    const wy = deck + (wall - deck) * 0.66;
    shedWindow(b, wx, wy, zf, ww, ww, trim);
    for (const s of [-1, 1]) {
      const sx = wx + s * (ww / 2 + 0.07 + sw / 2);
      b.box(sw, ww + 0.04, 0.018, sx, wy - ww - 0.02, zf + 0.01, roofEdge);
      for (let k = 1; k < 5; k++) b.batch(new THREE.BoxGeometry(sw * 0.85, 0.006, 0.004), joint, matrix(sx, wy - ww - 0.02 + (k * (ww + 0.04)) / 5, zf + 0.021));
    }
    const boxY = wy - ww - 0.15;
    b.box(ww + 0.12, 0.09, 0.1, wx, boxY, zf + 0.06, roofEdge, 0.01);
    const rand = random(151);
    foliage(b, rand, wx, boxY + 0.12, zf + 0.06, ww / 2 + 0.04, 0.04, 0.04, 22, 0.04, [C.leaf, C.leafLight], true);
    const petals = [mat("#e8505b", { roughness: 0.7 }), mat("#f2c84b", { roughness: 0.7 }), mat("#f4f1ec", { roughness: 0.7 })];
    for (let i = 0; i < 9; i++) b.batch(new THREE.SphereGeometry(0.022, 6, 4).translate(wx - ww / 2 - 0.02 + ((i + 0.5) * (ww + 0.04)) / 9, boxY + 0.13 + rand() * 0.04, zf + 0.05 + rand() * 0.04), petals[i % 3]);
    // a round window in the gable, a window in the right wall
    const gy = wall + rise * 0.35;
    b.add(new THREE.CircleGeometry(0.09, 20), glassDark, 0, gy, zf + 0.003);
    b.add(new THREE.TorusGeometry(0.1, 0.018, 4, 20), trim, 0, gy, zf + 0.008);
    if (bd > 0.9) shedWindow(b, bw / 2, wy, -bd * 0.05, ww * 0.9, ww * 0.9, trim, Math.PI / 2);
  },

  bbq_kettle: (b, w, d, h, f, color) => {
    // a kettle grill: an enamelled bowl and domed lid with a steel band, a top vent, a lid
    // handle on brackets, side handles, a thermometer, three legs with a rack and an ash
    // catcher, two wheels at the back
    const r = Math.min(w, d) / 2 - 0.045;
    const enamel = mat(hex(color, f), { roughness: 0.3, metalness: 0.25 });
    const steel = metal(C.steel, 0.3);
    const black = mat("#1f2023", { roughness: 0.6 });
    const y = h - 0.075 - r * 0.86;
    b.add(new THREE.SphereGeometry(r, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2), enamel, 0, y + 0.012, 0).scale.y = 0.86;
    b.add(new THREE.SphereGeometry(r, 32, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), enamel, 0, y, 0).scale.y = 0.82;
    b.cyl(r + 0.004, r + 0.004, 0.022, 0, y - 0.006, 0, steel, 32);
    // the top vent and the lid handle
    const ty = y + 0.012 + r * 0.86;
    b.cyl(0.055, 0.06, 0.012, 0, ty - 0.008, 0, steel, 16);
    b.box(0.04, 0.012, 0.015, 0.045, ty - 0.002, 0, steel);
    for (const s of [-1, 1]) b.box(0.016, 0.05, 0.022, s * 0.08, ty - 0.035, r * 0.36, steel);
    b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10).rotateZ(Math.PI / 2), black, 0, ty + 0.012, r * 0.36);
    // the thermometer on the lid
    const ta = 0.75;
    const tz = r * Math.cos(ta);
    const tyy = y + 0.012 + r * 0.86 * Math.sin(ta);
    const dial = b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16), steel, 0, tyy, tz + 0.004);
    dial.rotation.x = Math.PI / 2 - ta + 0.3;
    const face = b.add(new THREE.CircleGeometry(0.024, 16), mat("#f2f0ea", { roughness: 0.5 }), 0, tyy + 0.002, tz + 0.011);
    face.rotation.x = -ta + 0.3;
    // side handles on the bowl and a heat shield
    for (const s of [-1, 1]) {
      b.box(0.02, 0.025, 0.08, s * (r + 0.02), y - 0.045, 0, steel);
      b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 8).rotateX(Math.PI / 2), black, s * (r + 0.035), y - 0.04, 0);
    }
    // legs: one at the front, two at the back with wheels; a rack between them; the ash catcher
    const legA = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3];
    const legTop = (a: number) => v(Math.cos(a) * r * 0.55, y - r * 0.62, Math.sin(a) * r * 0.55);
    const legFoot = (a: number) => v(Math.cos(a) * r * 1.02, 0.02, Math.sin(a) * r * 1.02);
    const rackY = 0.22;
    const rack: THREE.Vector3[] = [];
    for (const a of legA) {
      b.rod(legTop(a), legFoot(a), 0.014, steel, 8);
      b.add(new THREE.CylinderGeometry(0.03, 0.026, 0.06, 10), black, legTop(a).x, legTop(a).y + 0.02, legTop(a).z);
      const t = (legTop(a).y - rackY) / (legTop(a).y - legFoot(a).y);
      rack.push(legTop(a).lerp(legFoot(a), t));
    }
    for (let i = 0; i < 3; i++) b.rod(rack[i], rack[(i + 1) % 3], 0.008, steel, 6);
    b.cyl(r * 0.3, r * 0.4, 0.008, 0, y - r * 0.82 - 0.005, 0, steel, 16);
    b.cyl(r * 0.42, r * 0.32, 0.07, 0, y - r * 0.82 - 0.12, 0, steel, 18);
    b.cyl(0.035, 0.035, 0.012, 0, y - r * 0.82 - 0.012, 0, steel, 12);
    b.add(new THREE.CylinderGeometry(0.008, 0.008, r * 0.9, 6).rotateX(Math.PI / 2), steel, 0, y - r * 0.82 - 0.06, 0);
    const front = legFoot(legA[0]);
    b.cyl(0.022, 0.026, 0.025, front.x, 0, front.z, black, 10);
    for (const a of legA.slice(1)) {
      const p = legFoot(a);
      const out = Math.sign(p.x);
      wheel(b, p.x + out * 0.02, 0.075, p.z, 0.075, 0.03, mat("#8a8f94", { metalness: 0.5 }), 16);
    }
    b.add(new THREE.CylinderGeometry(0.008, 0.008, Math.abs(legFoot(legA[1]).x - legFoot(legA[2]).x) + 0.04, 6).rotateZ(Math.PI / 2), steel, 0, 0.075, legFoot(legA[1]).z);
  },

  bbq_gas: (b, w, d, h, f, color) => {
    // a gas grill on a cart: a cabinet with two doors on casters, the firebox with a sloping
    // control panel and knobs, a round hood with a thermometer and a handle on standoffs,
    // side shelves (a side burner on the left, tool hooks on the right)
    const steel = metal(C.steel, 0.3);
    const silver = color === "silver";
    const body = silver ? steel : mat(hex(color, f), { roughness: 0.45, metalness: 0.3 });
    const black = mat("#1f2023", { roughness: 0.6 });
    const cw = Math.min(w * 0.62, w - 0.3);
    const ch = h * 0.76; // the cooking surface
    const cd = d * 0.82;
    const zc = -d / 2 + cd / 2 + 0.01;
    // the cart
    const legH = 0.1;
    b.box(cw, ch - 0.25 - legH, cd, 0, legH, zc, body, 0.008);
    for (const s of [-1, 1]) {
      b.box(cw / 2 - 0.02, ch - 0.33 - legH, 0.018, (s * cw) / 4, legH + 0.04, zc + cd / 2 + 0.006, body);
      b.rod(v((s * cw) / 4 - s * (cw / 4 - 0.08), legH + 0.12, zc + cd / 2 + 0.04), v((s * cw) / 4 - s * (cw / 4 - 0.08), ch - 0.33, zc + cd / 2 + 0.04), 0.009, steel, 6);
      for (const y of [legH + 0.12, ch - 0.33]) b.rod(v((s * cw) / 4 - s * (cw / 4 - 0.08), y, zc + cd / 2 + 0.015), v((s * cw) / 4 - s * (cw / 4 - 0.08), y, zc + cd / 2 + 0.045), 0.007, steel, 6);
      for (const sz of [-1, 1]) {
        b.cyl(0.012, 0.012, 0.04, s * (cw / 2 - 0.05), legH - 0.05, zc + sz * (cd / 2 - 0.05), steel, 6);
        b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14).rotateZ(Math.PI / 2), black, s * (cw / 2 - 0.05), 0.045, zc + sz * (cd / 2 - 0.05));
      }
    }
    // the firebox and the control panel
    const fy = ch - 0.25;
    b.box(cw + 0.02, 0.22, cd, 0, fy, zc, body, 0.01);
    const panel = b.box(cw - 0.04, 0.17, 0.02, 0, fy + 0.025, zc + cd / 2 + 0.02, steel)!;
    panel.rotation.x = -0.25;
    const knobs = 4;
    for (let i = 0; i < knobs; i++) {
      const x = -cw * 0.33 + (i * cw * 0.66) / (knobs - 1);
      const k = b.add(new THREE.CylinderGeometry(0.026, 0.03, 0.035, 14).rotateX(Math.PI / 2), black, x, fy + 0.115, zc + cd / 2 + 0.05);
      k.rotation.x = -0.25;
      b.box(0.008, 0.045, 0.012, x, fy + 0.093, zc + cd / 2 + 0.072, black)!.rotation.x = -0.25;
    }
    b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10).rotateX(Math.PI / 2), mat("#c8372a", { roughness: 0.5 }), cw * 0.45, fy + 0.11, zc + cd / 2 + 0.045);
    // the hood: a half cylinder hinged at the back, its end caps black
    const R = cd / 2;
    const hood = b.add(new THREE.CylinderGeometry(R, R, cw, 28, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), body, 0, ch - 0.03, zc);
    hood.scale.y = (h - ch + 0.02) / R;
    for (const s of [-1, 1]) {
      const cap = b.add(new THREE.CylinderGeometry(R + 0.01, R + 0.01, 0.025, 28, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), black, s * (cw / 2 + 0.0125), ch - 0.03, zc);
      cap.scale.y = (h - ch + 0.03) / (R + 0.01);
    }
    const hk = (h - ch + 0.02) / R;
    const ha = 0.85; // where the thermometer sits, from the front
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 18).rotateX(Math.PI / 2), steel, 0, ch - 0.03 + R * Math.sin(ha) * hk, zc + R * Math.cos(ha) + 0.005).rotation.x = -0.6;
    b.add(new THREE.CircleGeometry(0.032, 18), mat("#f2f0ea", { roughness: 0.5 }), 0, ch - 0.03 + R * Math.sin(ha) * hk + 0.006, zc + R * Math.cos(ha) + 0.013).rotation.x = -0.6;
    const hy = ch - 0.03 + R * Math.sin(0.45) * hk;
    const hz = zc + R * Math.cos(0.45);
    for (const s of [-1, 1]) b.rod(v(s * cw * 0.36, hy, hz - 0.01), v(s * cw * 0.36, hy + 0.01, hz + 0.06), 0.01, steel, 6);
    b.add(new THREE.CylinderGeometry(0.014, 0.014, cw * 0.82, 10).rotateZ(Math.PI / 2), steel, 0, hy + 0.012, hz + 0.065);
    // side shelves on brackets
    const sw = (w - cw) / 2 - 0.02;
    for (const s of [-1, 1]) {
      const sx = s * (cw / 2 + 0.02 + sw / 2);
      b.box(sw, 0.03, cd, sx, ch - 0.06, zc, steel, 0.006);
      b.rod(v(s * (cw / 2 + 0.01), ch - 0.22, zc), v(s * (cw / 2 + sw * 0.7), ch - 0.065, zc), 0.01, steel, 6);
    }
    const bx = -(cw / 2 + 0.02 + sw / 2);
    b.cyl(0.09, 0.09, 0.012, bx, ch - 0.03, zc, black, 18);
    b.add(new THREE.TorusGeometry(0.05, 0.008, 4, 16), mat("#3a3c40", { metalness: 0.5 }), bx, ch - 0.015, zc).rotation.x = Math.PI / 2;
    for (const k of [-1, 1]) b.box(0.18, 0.012, 0.012, bx, ch - 0.012, zc + k * 0.04, black);
    b.add(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 12).rotateX(Math.PI / 2), black, bx, ch - 0.075, zc + cd / 2 + 0.01);
    const tx = cw / 2 + 0.02 + sw / 2;
    for (const [i, len] of [[-1, 0.3], [0, 0.34], [1, 0.28]] as const) {
      const x = tx + i * 0.07;
      b.rod(v(x, ch - 0.08, zc + cd / 2 + 0.008), v(x, ch - 0.08 - len, zc + cd / 2 + 0.008), 0.006, steel, 4);
      b.box(0.012, 0.11, 0.025, x, ch - 0.08 - 0.11, zc + cd / 2 + 0.01, black, 0.004);
    }
  },

  wheelie_bin: (b, w, d, h, f, _c, a) => bin(b, 0, w - 0.04, d, h, f, a),

  wheelie_bins: (b, w, d, h) => {
    // a row of bins: general waste, paper, garden waste, recycling
    const colors = ["#3a3d41", "#2f5fa8", "#6b4a35", "#e2c33a"];
    const n = Math.max(1, Math.round(w / 0.62));
    for (let i = 0; i < n; i++) {
      const c = colors[i % colors.length];
      const body = mat(new THREE.Color(c).multiplyScalar(0.9).getStyle(), { roughness: 0.6 });
      bin(b, -w / 2 + (w / n) * (i + 0.5), w / n - 0.06, d, h, body, mat(c, { roughness: 0.55 }));
    }
  },

  robot_mower: (b, w, d, h, f) => {
    // a robot mower: a dark chassis, a sculpted shell in the finish with a bumper seam, a
    // control panel with a display and the red stop knob, big treaded rear wheels, a front
    // castor, charging contacts at the nose
    const dark = mat("#26282c", { roughness: 0.7 });
    const black = mat("#1b1c1f", { roughness: 0.9 });
    const wr = h * 0.42;
    const ww = 0.055;
    const wz = -d * 0.2;
    b.add(taper(w - 2 * ww - 0.01, d * 0.92, w - 2 * ww - 0.01, d * 0.92, h * 0.28, 0.12), dark, 0, h * 0.08, 0);
    // the shell: a skirt and a softer upper part
    const sw = w - 0.03;
    b.add(taper(sw, d - 0.01, sw - 0.03, d - 0.05, h * 0.2, 0.14), f, 0, h * 0.2, 0);
    b.add(new THREE.ExtrudeGeometry(roundedRect(sw + 0.006, d - 0.004, 0.14), { depth: 0.012, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2), black, 0, h * 0.35, 0);
    b.add(taper(sw - 0.03, d - 0.05, sw * 0.62, d * 0.6, h * 0.36, 0.12), f, 0, h * 0.4, -d * 0.02);
    const capY = h * 0.76;
    b.box(sw * 0.62, h * 0.08, d * 0.6, 0, capY - 0.012, -d * 0.02, f, 0.04);
    // the control panel: a dark plate, a display, the stop knob and two buttons
    b.box(sw * 0.42, 0.012, d * 0.28, 0, capY + h * 0.06, -d * 0.12, dark, 0.008);
    b.box(sw * 0.22, 0.004, d * 0.09, -sw * 0.05, capY + h * 0.06 + 0.012, -d * 0.18, mat("#121417", { roughness: 0.15, metalness: 0.3 }));
    b.cyl(0.032, 0.036, h - (capY + h * 0.06 + 0.012), sw * 0.1, capY + h * 0.06 + 0.012, -d * 0.06, mat("#d23a2a", { roughness: 0.45 }), 20);
    for (const s of [-1, 1]) b.cyl(0.009, 0.009, 0.006, -sw * 0.08 + s * 0.03, capY + h * 0.06 + 0.012, -d * 0.03, mat("#8a8f94"), 10);
    // a rain sensor and a grip at the back
    b.cyl(0.012, 0.012, 0.004, -sw * 0.15, capY + h * 0.06, d * 0.12, mat(C.chrome, { metalness: 0.7, roughness: 0.25 }), 10);
    b.box(sw * 0.3, 0.025, 0.02, 0, h * 0.36, -d / 2 + 0.008, black, 0.008);
    // big rear wheels with tread lugs, a front castor, the charging contacts
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - ww / 2);
      wheel(b, x, wr, wz, wr, ww, mat("#6e7378"), 20);
      const lugs = 18;
      for (let i = 0; i < lugs; i++) {
        const a = (i / lugs) * Math.PI * 2;
        b.batch(new THREE.BoxGeometry(ww * 0.9, 0.012, 0.016), black, matrix(x, wr + Math.sin(a) * wr, wz + Math.cos(a) * wr, a + Math.PI / 2, 0, 0));
      }
    }
    b.box(0.03, 0.04, 0.03, 0, 0.055, d * 0.36, dark);
    b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 14).rotateZ(Math.PI / 2), black, 0, 0.035, d * 0.36);
    for (const s of [-1, 1]) b.box(0.03, 0.012, 0.006, s * 0.05, h * 0.12, d / 2 - 0.006, mat(C.chrome, { metalness: 0.8, roughness: 0.25 }));
  },

  solar_panel: (b, w, d, h, f, color) => {
    // lying flat: an aluminium frame round a backsheet, cells in a grid (6 × 10 for a full
    // panel) with silver bus bars; mono black cells with clipped corners, blue poly cells
    // in a few shades
    const mono = color === "black";
    const frame = mono ? mat("#2a2c30", { metalness: 0.5, roughness: 0.4 }) : mat(C.steel, { metalness: 0.5, roughness: 0.4 });
    const fw = 0.03;
    b.box(w - 2 * fw, h - 0.012, d - 2 * fw, 0, 0, 0, mat(mono ? "#e9eaec" : "#e6e8eb", { roughness: 0.6 }));
    for (const s of [-1, 1]) {
      b.box(w, h, fw, 0, 0, s * (d / 2 - fw / 2), frame, 0.004);
      b.box(fw, h, d - 2 * fw + 0.002, s * (w / 2 - fw / 2), 0, 0, frame, 0.004);
    }
    const cols = Math.max(2, Math.round(w / 0.18));
    const rows = Math.max(2, Math.round(d / 0.17));
    const iw = w - 2 * fw - 0.02;
    const id = d - 2 * fw - 0.02;
    const cw = iw / cols;
    const rd = id / rows;
    const gap = 0.004;
    const cy = h - 0.011;
    const cellM = (k: number) => mat(hex(color, f), { roughness: 0.3, metalness: 0.3, ...(k ? { color: new THREE.Color(hex(color, f)).multiplyScalar(k).getStyle() } : {}) });
    const shades = mono ? [cellM(0)] : [cellM(0), cellM(0.88), cellM(1.12)];
    const rand = random(161);
    const cell = (sw: number, sd: number) => {
      const c = mono ? Math.min(sw, sd) * 0.12 : 0;
      const pts = c ? [[-sw / 2 + c, -sd / 2], [sw / 2 - c, -sd / 2], [sw / 2, -sd / 2 + c], [sw / 2, sd / 2 - c], [sw / 2 - c, sd / 2], [-sw / 2 + c, sd / 2], [-sw / 2, sd / 2 - c], [-sw / 2, -sd / 2 + c]] : [[-sw / 2, -sd / 2], [sw / 2, -sd / 2], [sw / 2, sd / 2], [-sw / 2, sd / 2]];
      return new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))).rotateX(-Math.PI / 2);
    };
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const x = -iw / 2 + (i + 0.5) * cw;
        const z = -id / 2 + (j + 0.5) * rd;
        b.batch(cell(cw - gap, rd - gap).translate(x, cy, z), shades[Math.floor(rand() * shades.length)]);
      }
    // bus bars along each column, and the cross ribbons at both ends
    const bus = mat("#c9ced3", { metalness: 0.7, roughness: 0.3 });
    for (let i = 0; i < cols; i++) for (const k of [-1, 0, 1]) b.batch(new THREE.BoxGeometry(0.003, 0.0012, id - gap), bus, matrix(-iw / 2 + (i + 0.5) * cw + k * cw * 0.3, cy + 0.0006, 0));
    for (const s of [-1, 1]) b.batch(new THREE.BoxGeometry(iw, 0.0012, 0.006), bus, matrix(0, cy + 0.0006, s * (id / 2 + 0.006)));
  },
};
