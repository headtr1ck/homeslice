// More detailed built-in pieces: hobby. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, mat, matrix, part, random, v } from "../modern";
import type { Build, Builder } from "../modern";

// ----- small helpers (only called inside builders) -----

const V2 = (pts: [number, number][]) => pts.map(([x, y]) => new THREE.Vector2(x, y));
/**
 * A lathe whose sharp corners stay sharp: three averages a corner's normal weighted by the
 * segments' lengths, so a short side next to a wide base would shade as if facing down.
 * Each corner is split into two points a hair apart (sharp = false keeps them smooth).
 */
function lathe(pts: [number, number][], seg: number, sharp = true) {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!sharp || i === 0 || i === pts.length - 1) {
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
  return new THREE.LatheGeometry(V2(out), seg);
}
/** A box, its edges rounded with r (one segment for small radii: a bevel reads the same). */
const boxGeo = (w: number, h: number, d: number, r = 0) => {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  return rr > 0.0045 ? new RoundedBoxGeometry(w, h, d, rr >= 0.02 ? 2 : 1, rr) : new THREE.BoxGeometry(w, h, d);
};
const hex = (c: THREE.Color) => "#" + c.getHexString();

/** Draws merged geometry in a local frame (moved and turned), so tilted parts stay simple. */
class Frame {
  constructor(
    private b: Builder,
    readonly m: THREE.Matrix4,
  ) {}
  static at(b: Builder, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    return new Frame(b, matrix(x, y, z, rx, ry, rz));
  }
  geo(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this.put(geo, m, this.m.clone().multiply(matrix(x, y, z, rx, ry, rz)));
  }
  /** Merged with the rest of its material, or a mesh of its own where the material is textured (wood grain, fabric need their uvs). */
  private put(geo: THREE.BufferGeometry, m: THREE.Material, at: THREE.Matrix4) {
    if ((m as THREE.MeshStandardMaterial).map) this.b.add(geo, m).applyMatrix4(at);
    else this.b.batch(geo, m, at);
  }
  /** A box from its bottom centre. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0, rx = 0, ry = 0, rz = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.geo(boxGeo(w, h, d, r), m, x, y + h / 2, z, rx, ry, rz);
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 16, open = false) {
    this.geo(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m, x, y + h / 2, z);
  }
  /** A rod (or a taper: r at a, r1 at c) between two local points. */
  rod(a: THREE.Vector3, c: THREE.Vector3, r: number, m: THREE.Material, seg = 6, r1 = r) {
    const len = a.distanceTo(c);
    if (len < 1e-4) return;
    let geo: THREE.BufferGeometry = new THREE.CylinderGeometry(r1, r, len, seg, 1);
    // three or four sides: a flat-sided tube (smooth normals would shade its edges wrong)
    if (seg <= 4) {
      geo = geo.rotateY(Math.PI / seg).toNonIndexed();
      geo.computeVertexNormals();
    }
    const q = new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), c.clone().sub(a).normalize());
    const mid = a.clone().add(c).multiplyScalar(0.5);
    geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, v(1, 1, 1)));
    this.put(geo, m, this.m.clone());
  }
  sphere(r: number, x: number, y: number, z: number, m: THREE.Material, sx = 1, sy = 1, sz = 1, seg = 10) {
    this.geo(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg / 2))).scale(sx, sy, sz), m, x, y, z);
  }
  /** A flat disc facing up (+y) at local y. */
  disc(r: number, x: number, y: number, z: number, m: THREE.Material, seg = 20) {
    this.geo(new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2), m, x, y, z);
  }
}
const world = (b: Builder) => new Frame(b, new THREE.Matrix4());

const metal = (color: string, rough = 0.3) => mat(color, { metalness: 0.7, roughness: rough });
const brassCymbal = () => mat("#caa75a", { metalness: 0.55, roughness: 0.32, side: THREE.DoubleSide });

/** Three splayed legs from (x, top, z) down to the floor, as on stands and stools. */
function tripod(F: Frame, x: number, z: number, top: number, spread: number, m: THREE.Material, r = 0.006, turn = 0) {
  for (let i = 0; i < 3; i++) {
    const ang = turn + (i / 3) * Math.PI * 2;
    F.rod(v(x, top, z), v(x + Math.cos(ang) * spread, 0.01, z + Math.sin(ang) * spread), r, m, 5);
    F.sphere(r * 1.8, x + Math.cos(ang) * spread, 0.008, z + Math.sin(ang) * spread, mat(C.black), 1, 0.6, 1, 6);
  }
}

/** A rounded rectangle (w × l, corners r) centred on 0, for extruding. */
function roundedRect(w: number, l: number, r: number) {
  const s = new THREE.Shape();
  const x = w / 2;
  const y = l / 2;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}
/** A flat slab from a shape lying on y = 0 (the shape's +y towards -z), t thick. */
const slab = (shape: THREE.Shape, t: number, curve = 6) => new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: curve }).rotateX(-Math.PI / 2);

/** A chain of oval links from a to c, the links turned alternately. */
function chain(b: Builder, a: THREE.Vector3, c: THREE.Vector3, m: THREE.Material, size = 0.011) {
  const dir = c.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const pitch = size * 2.2;
  const n = Math.max(1, Math.round(len / pitch));
  const q = new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), dir);
  for (let i = 0; i < n; i++) {
    const at = a.clone().addScaledVector(dir, ((i + 0.5) * len) / n);
    const turn = new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), (i % 2) * (Math.PI / 2));
    const geo = new THREE.TorusGeometry(size * 0.75, size * 0.2, 3, 8).scale(1, 1.5, 1);
    b.batch(geo, m, new THREE.Matrix4().compose(at, q.clone().multiply(turn), v(1, 1, 1)));
  }
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  billiard_table: (b, w, d, h, f, _c, a) => {
    const F = world(b);
    const rail = Math.min(0.12, Math.min(w, d) * 0.085);
    const felt = mat("#2f6b45", { roughness: 1 });
    const cushionM = mat("#295f3d", { roughness: 1 });
    const black = mat("#151515", { roughness: 0.55 });
    const hole = mat("#030303", { roughness: 1 });
    const bed = h - 0.045; // the playing surface
    const apronH = Math.min(0.2, h * 0.25);
    // body: a deep apron under the rails with mouldings
    F.box(w - 0.03, apronH - 0.012, d - 0.03, 0, bed - apronH, 0, f, 0.015);
    F.box(w - 0.06, 0.03, d - 0.06, 0, bed - apronH - 0.025, 0, f, 0.01);
    F.box(w - 0.01, 0.025, d - 0.01, 0, bed - apronH + 0.02, 0, f, 0.008);
    // the cloth
    const iw = w - 2 * rail;
    const id = d - 2 * rail;
    F.box(iw + 0.02, 0.012, id + 0.02, 0, bed - 0.012, 0, felt);
    // rails (the accent wood)
    const rh = h - bed + 0.012;
    for (const s of [-1, 1]) {
      F.box(w, rh, rail, 0, bed - 0.012, s * (d / 2 - rail / 2), a, 0.012);
      F.box(rail, rh, d - 2 * rail + 0.002, s * (w / 2 - rail / 2), bed - 0.012, 0, a, 0.012);
    }
    // pockets: four in the corners, two in the middle of the long sides
    const pr = 0.056;
    const pockets: [number, number][] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) pockets.push([sx * (iw / 2 + 0.012), sz * (id / 2 + 0.012)]);
      pockets.push([sx * (iw / 2 + 0.022), 0]);
    }
    for (const [x, z] of pockets) {
      F.cyl(pr + 0.014, pr + 0.01, h + 0.004 - (bed - 0.03), x, bed - 0.03, z, black, 20);
      F.disc(pr, x, h + 0.0045, z, hole, 18);
    }
    // cushions: felt noses along the rails, cut back at the pockets
    const ch = 0.036;
    const cd = 0.04;
    const cushion = (x: number, z: number, len: number, ang: number) => {
      const s = new THREE.Shape();
      s.moveTo(-len / 2, 0);
      s.lineTo(len / 2, 0);
      s.lineTo(len / 2 - cd * 0.9, -cd);
      s.lineTo(-len / 2 + cd * 0.9, -cd);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: ch, bevelEnabled: false }).rotateX(-Math.PI / 2);
      F.geo(geo, cushionM, x, bed - 0.002, z, 0, ang);
    };
    const gapC = pr * 1.25;
    const gapS = pr * 0.95;
    const longLen = id / 2 - gapC - gapS;
    for (const s of [-1, 1]) {
      cushion(0, s * (id / 2), iw - 2 * gapC, s > 0 ? 0 : Math.PI);
      for (const sz of [-1, 1]) cushion(s * (iw / 2), sz * (gapS + longLen / 2), longLen, s > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    // sights: mother-of-pearl diamonds on the rail tops
    const pearl = mat("#efe9dc", { roughness: 0.3 });
    const dia = new THREE.CylinderGeometry(0.009, 0.009, 0.003, 4);
    for (const s of [-1, 1]) {
      for (const k of [1, 2, 3, 5, 6, 7]) F.geo(dia.clone(), pearl, s * (w / 2 - rail / 2), h + 0.001, -id / 2 + (k * id) / 8);
      for (const k of [1, 2, 3]) F.geo(dia.clone(), pearl, -iw / 2 + (k * iw) / 4, h + 0.001, s * (d / 2 - rail / 2));
    }
    // turned legs under square blocks, on broad feet
    const legH = bed - apronH - 0.025;
    const lr = Math.min(1, w / 1.4) * 0.075;
    const turned = lathe(
      [
        [0.001, 0],
        [lr * 0.95, 0],
        [lr * 0.95, 0.03],
        [lr * 0.7, 0.07],
        [lr * 0.8, 0.12],
        [lr * 1.05, legH * 0.32],
        [lr * 0.95, legH * 0.42],
        [lr * 0.62, legH * 0.62],
        [lr * 0.7, legH * 0.68],
        [lr * 0.7, legH * 0.72],
        [0.001, legH * 0.72],
      ],
      12,
    );
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.05 - lr * 1.3);
        const z = sz * (d / 2 - 0.08 - lr * 1.6);
        F.geo(turned.clone(), f, x, 0.05, z);
        F.box(lr * 2.3, legH * 0.3, lr * 2.3, x, legH * 0.7, z, f, 0.01);
        F.box(lr * 2.6, 0.05, lr * 2.6, x, 0, z, f, 0.012);
      }
    // balls: the rack of fifteen at the foot spot, the cue ball at the head
    const R = 0.0286;
    const colors = ["#f4f4f0", "#f2c53a", "#2a5fbf", "#d0352a", "#6a3a8f", "#e8862e", "#2f7a45", "#8a2f2a", "#111111"];
    const ballM = colors.map((c) => mat(c, { roughness: 0.25 }));
    const rand = random(359);
    const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
    const foot = -id / 4;
    let n = 0;
    const ball = (num: number, x: number, z: number) => {
      const y = bed + R;
      if (num <= 8) F.geo(new THREE.SphereGeometry(R, 10, 6), ballM[num], x, y, z);
      else {
        F.geo(new THREE.SphereGeometry(R, 10, 6), ballM[0], x, y, z);
        F.geo(new THREE.SphereGeometry(R * 1.01, 10, 2, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.4), ballM[num - 8], x, y, z, rand() * 3, rand() * 3, 0);
      }
    };
    for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) ball(order[n++], (i - row / 2) * R * 2.02, foot - row * R * 1.75);
    ball(0, iw * 0.08, id / 4);
    // a cue lying across the cloth, and the chalk on the rail
    const cueLen = Math.min(1.45, id * 0.5);
    const t0 = v(iw * 0.32, bed + 0.012, id * 0.38);
    const dir = v(-0.3, 0, -1).normalize();
    const joint = t0.clone().addScaledVector(dir, cueLen * 0.55);
    const butt = t0.clone().addScaledVector(dir, cueLen);
    butt.y = joint.y = bed + 0.014;
    F.rod(t0, joint, 0.0055, mat("#e6d3a6", { roughness: 0.5 }), 6, 0.008);
    F.rod(joint, butt, 0.008, mat("#2a1c14", { roughness: 0.4 }), 8, 0.0145);
    F.sphere(0.006, t0.x, t0.y, t0.z, mat("#3b6fb0"), 1, 1, 1, 6);
    F.box(0.022, 0.022, 0.022, w / 2 - rail / 2, h, d / 2 - rail / 2 - 0.04, mat("#3b6fb0", { roughness: 1 }));
  },

  table_tennis: (b, w, d, h, f) => {
    const F = world(b);
    const top = h - 0.025;
    F.box(w, 0.025, d, 0, top, 0, f, 0.004);
    const line = mat("#f4f4f0", { roughness: 0.6 });
    for (const sx of [-1, 1]) F.box(0.02, 0.001, d, sx * (w / 2 - 0.01), h, 0, line);
    for (const sz of [-1, 1]) F.box(w - 0.04, 0.001, 0.02, 0, h, sz * (d / 2 - 0.01), line);
    F.box(0.003, 0.001, d - 0.04, 0, h, 0, line);
    // the steel frame under the top, folding halves on legs, wheels at the middle
    const frame = metal("#2f3236", 0.5);
    for (const sx of [-1, 1]) F.box(0.04, 0.05, d - 0.2, sx * (w / 2 - 0.12), top - 0.053, 0, frame);
    for (const z of [-d / 2 + 0.12, -0.06, 0.06, d / 2 - 0.12]) F.box(w - 0.24, 0.05, 0.03, 0, top - 0.053, z, frame);
    const lx = w / 2 - 0.16;
    for (const sz of [-1, 1]) {
      const zo = sz * (d / 2 - 0.3);
      const zi = sz * 0.35;
      for (const sx of [-1, 1]) {
        F.box(0.04, top - 0.05, 0.04, sx * lx, 0, zo, frame);
        F.box(0.04, top - 0.05, 0.04, sx * lx, 0, zi, frame);
        F.rod(v(sx * lx, 0.15, zo), v(sx * lx, 0.15, zi), 0.012, frame, 6);
        F.rod(v(sx * lx, top - 0.08, zo), v(sx * lx, 0.18, zi), 0.01, frame, 6);
        F.box(0.06, 0.02, 0.06, sx * lx, 0, zo, mat(C.black), 0.006);
        F.geo(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14).rotateZ(Math.PI / 2), mat(C.black, { roughness: 0.6 }), sx * lx, 0.045, zi + sz * 0.02);
      }
      F.rod(v(-lx, 0.15, zi), v(lx, 0.15, zi), 0.012, frame, 6);
      F.rod(v(-lx, 0.15, zo), v(lx, 0.15, zo), 0.012, frame, 6);
    }
    // the net: dark mesh with a white tape, on two posts clamped to the edge
    const over = Math.min(0.05, w * 0.03);
    const nh = 0.1525;
    F.box(w + 2 * over - 0.01, nh - 0.016, 0.003, 0, h + 0.003, 0, mat("#1b2a3a", { transparent: true, opacity: 0.55, roughness: 1 }));
    F.box(w + 2 * over - 0.01, 0.016, 0.006, 0, h + nh - 0.016, 0, line);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 + over - 0.01);
      F.rod(v(x, h - 0.01, 0), v(x, h + nh, 0), 0.007, frame, 6);
      F.box(0.03, 0.05, 0.05, sx * (w / 2 + 0.005), top - 0.03, 0, frame, 0.005);
    }
    // two bats and a ball on one half
    const wood = mat("#c9a47c", { roughness: 0.6 });
    const bat = (x: number, z: number, ang: number, face: string) => {
      F.geo(new THREE.CylinderGeometry(0.075, 0.075, 0.006, 20).scale(1, 1, 1.05), wood, x, h + 0.003, z);
      F.geo(new THREE.CylinderGeometry(0.073, 0.073, 0.003, 20).scale(1, 1, 1.05), mat(face, { roughness: 0.7 }), x, h + 0.0075, z);
      F.box(0.028, 0.02, 0.1, x + Math.sin(ang) * 0.12, h, z + Math.cos(ang) * 0.12, wood, 0.006, 0, ang);
    };
    bat(-w * 0.15, d * 0.25, 0.6, "#c23a2e");
    bat(w * 0.12, d * 0.32, -0.9, "#1c1c1c");
    F.sphere(0.02, w * 0.02, h + 0.02, d * 0.2, mat("#f6f6f2", { roughness: 0.4 }), 1, 1, 1, 10);
  },

  foosball: (b, w, d, h, f, _c, a) => {
    const F = world(b);
    const ow = Math.min(0.12, w * 0.16); // the rods and handles stick out this far each side
    const cw = w - 2 * ow; // the cabinet
    const top = h - 0.03;
    const wallH = Math.min(0.24, h * 0.27);
    const field = top - wallH + 0.04;
    const t = 0.025;
    // cabinet: four walls and a floor, on four square legs with braces and levelling feet
    for (const s of [-1, 1]) {
      F.box(t, wallH, d, s * (cw / 2 - t / 2), top - wallH, 0, f, 0.006);
      F.box(cw - 2 * t, wallH, t, 0, top - wallH, s * (d / 2 - t / 2), f, 0.004);
      // the goal mouths in the end walls
      F.box(cw * 0.3, 0.06, 0.004, 0, field, s * (d / 2 - t - 0.002), mat("#0c0c0c", { roughness: 1 }));
    }
    F.box(cw - 0.01, 0.03, d - 0.01, 0, top - wallH, 0, f, 0.006);
    F.box(cw - 2 * t, 0.008, d - 2 * t, 0, field - 0.008, 0, mat("#2f7a45", { roughness: 1 }));
    // field markings
    const white = mat("#f2f2ee", { roughness: 0.8 });
    F.box(cw - 2 * t - 0.02, 0.001, 0.006, 0, field, 0, white);
    F.geo(new THREE.RingGeometry(cw * 0.12, cw * 0.12 + 0.006, 28).rotateX(-Math.PI / 2), white, 0, field + 0.001, 0);
    for (const s of [-1, 1]) {
      const zb = s * (d / 2 - t - 0.09);
      F.box(cw * 0.45, 0.001, 0.006, 0, field, zb, white);
      for (const sx of [-1, 1]) F.box(0.006, 0.001, 0.09, sx * cw * 0.225, field, s * (d / 2 - t - 0.045), white);
    }
    const legTop = top - wallH;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        F.box(0.07, legTop, 0.07, sx * (cw / 2 - 0.05), 0, sz * (d / 2 - 0.06), f, 0.008);
        F.cyl(0.03, 0.03, 0.02, sx * (cw / 2 - 0.05), 0, sz * (d / 2 - 0.06), mat(C.black), 10);
      }
      F.box(0.04, 0.06, d - 0.18, sx * (cw / 2 - 0.05), 0.15, 0, f, 0.006);
    }
    F.box(cw - 0.14, 0.06, 0.04, 0, 0.15, 0, f, 0.006);
    // eight rods with their players; the two teams' handles on opposite sides
    const steel = metal(C.chrome, 0.25);
    const teamA = mat("#c8372d", { roughness: 0.5 });
    const teamB = mat("#2f5fb3", { roughness: 0.5 });
    const skin = mat("#e7c39b", { roughness: 0.6 });
    const rodY = top - 0.075;
    const lineup: [number, boolean][] = [
      [1, true],
      [2, true],
      [3, false],
      [5, true],
      [5, false],
      [3, true],
      [2, false],
      [1, false],
    ];
    const inner = cw - 2 * t;
    for (let i = 0; i < 8; i++) {
      const z = -d / 2 + t + 0.07 + (i * (d - 2 * t - 0.14)) / 7;
      const [players, home] = lineup[i];
      const side = home ? 1 : -1;
      // the rod pushed out towards its handle
      F.rod(v(-side * (cw / 2 + 0.03), rodY, z), v(side * (w / 2 - 0.07), rodY, z), 0.0075, steel, 8);
      F.geo(new THREE.CylinderGeometry(0.017, 0.016, 0.075, 10).rotateZ(Math.PI / 2), a, side * (w / 2 - 0.0375), rodY, z);
      F.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10).rotateZ(Math.PI / 2), mat(C.black), side * (cw / 2 + 0.008), rodY, z);
      const body = home ? teamA : teamB;
      const spacing = players === 1 ? 0 : Math.min(0.16, (inner - 0.08) / (players - 1));
      for (let p = 0; p < players; p++) {
        const x = (p - (players - 1) / 2) * spacing;
        F.sphere(0.013, x, rodY + 0.03, z, skin, 1, 1.1, 1, 7);
        F.box(0.03, 0.045, 0.02, x, rodY - 0.02, z, body);
        F.box(0.022, rodY - 0.02 - (field + 0.012), 0.014, x, field + 0.012, z, body);
        F.box(0.026, 0.012, 0.03, x, field + 0.004, z + side * 0.004, body, 0.004);
      }
    }
    F.sphere(0.017, 0.05, field + 0.017, 0.12, white, 1, 1, 1, 10);
    // score counters: beads on a wire over each end wall
    for (const s of [-1, 1]) {
      const z = s * (d / 2 - t / 2);
      F.rod(v(-cw * 0.3, top + 0.025, z), v(cw * 0.3, top + 0.025, z), 0.002, steel, 4);
      for (const sx of [-1, 1]) F.rod(v(sx * cw * 0.3, top, z), v(sx * cw * 0.3, top + 0.025, z), 0.002, steel, 4);
      for (let k = 0; k < 10; k++) F.sphere(0.008, -cw * 0.27 + k * 0.018 + (k > 6 ? cw * 0.2 : 0), top + 0.025, z, s > 0 ? teamB : teamA, 1, 1, 1, 6);
    }
  },

  treadmill: (b, w, d, h, f, _c, a) => {
    const F = world(b);
    const rubber = mat("#1b1c1f", { roughness: 1 });
    const grey = mat("#55585e", { roughness: 0.7 });
    const deck = Math.min(0.2, h * 0.14);
    const hood = Math.min(0.42, d * 0.22);
    const zb = -d / 2 + hood; // where the belt starts
    const len = d / 2 - zb;
    const zc = (zb + d / 2) / 2;
    // side frames with grey foot rails, the belt between them, rear roller caps
    for (const s of [-1, 1]) {
      F.box(0.09, deck - 0.02, len, s * (w / 2 - 0.045), 0.0, zc, f, 0.025);
      F.box(0.075, 0.012, len - 0.05, s * (w / 2 - 0.045), deck - 0.025, zc, grey, 0.005);
      for (let k = 0; k < 3; k++) F.box(0.004, 0.003, len - 0.08, s * (w / 2 - 0.045) + (k - 1) * 0.02, deck - 0.013, zc, rubber);
      F.box(0.1, deck - 0.03, 0.08, s * (w / 2 - 0.05), 0, d / 2 - 0.04, mat(C.black), 0.03);
    }
    F.box(w - 0.18, deck - 0.06, len - 0.02, 0, 0.02, zc, mat("#2c2e31", { roughness: 0.9 }));
    F.box(w - 0.19, 0.012, len - 0.04, 0, deck - 0.05, zc, rubber, 0.004);
    F.geo(new THREE.CylinderGeometry(0.035, 0.035, w - 0.19, 12).rotateZ(Math.PI / 2), rubber, 0, deck - 0.075, d / 2 - 0.04);
    // the motor hood at the front, with a vent
    F.box(w, deck + 0.08, hood + 0.02, 0, 0, -d / 2 + hood / 2, f, 0.06);
    for (let k = 0; k < 4; k++) F.box(w * 0.4, 0.006, 0.012, 0, deck + 0.075, -d / 2 + hood * 0.35 + k * 0.03, rubber);
    F.box(w * 0.75, 0.04, 0.05, 0, 0, -d / 2 + 0.025, mat(C.black), 0.015);
    // uprights leaning away from the runner up to the console
    const conY = h - 0.16;
    const conZ = -d / 2 + 0.16;
    for (const s of [-1, 1]) F.rod(v(s * (w / 2 - 0.06), deck + 0.05, -d / 2 + hood * 0.7), v(s * (w / 2 - 0.07), conY, conZ - 0.04), 0.035, a, 10);
    // console: a tilted slab facing the runner, its screen, buttons, bottle holders
    const con = Frame.at(b, 0, conY, conZ, 0.75);
    con.box(w * 0.92, 0.06, 0.3, 0, -0.03, 0, f, 0.025);
    con.box(w * 0.36, 0.006, 0.14, 0, 0.03, 0.01, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }));
    con.box(w * 0.4, 0.004, 0.17, 0, 0.028, 0.01, mat(C.black), 0.002);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) con.cyl(0.012, 0.012, 0.006, s * (w * 0.26 + (k % 2) * 0.035), 0.03, -0.06 + k * 0.05, mat(k === 1 ? "#d23a2a" : "#7a7f86", { roughness: 0.5 }), 10);
      con.cyl(0.035, 0.03, 0.05, s * (w * 0.4), -0.01, 0.1, mat(C.black), 12);
      con.disc(0.029, s * (w * 0.4), 0.0405, 0.1, mat("#0b0b0b", { roughness: 1 }), 12);
    }
    con.box(0.025, 0.012, 0.02, w * 0.15, 0.03, 0.11, mat("#d23a2a"));
    // handrails along both sides with foam grips, and the front grip bar with pulse pads
    const railY = h - 0.4;
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.065);
      F.rod(v(x, conY - 0.18, conZ - 0.02), v(x, railY, conZ + 0.12), 0.02, a, 8);
      F.rod(v(x, railY, conZ + 0.12), v(x, railY, conZ + 0.5), 0.02, a, 8);
      F.rod(v(x, railY, conZ + 0.2), v(x, railY, conZ + 0.46), 0.025, rubber, 8);
      F.sphere(0.02, x, railY, conZ + 0.5, a, 1, 1, 1, 8);
    }
    F.rod(v(-w * 0.25, railY + 0.03, conZ + 0.1), v(w * 0.25, railY + 0.03, conZ + 0.1), 0.018, a, 8);
    for (const s of [-1, 1]) {
      F.rod(v(s * w * 0.25, railY + 0.03, conZ + 0.1), v(s * (w / 2 - 0.065), conY - 0.15, conZ), 0.018, a, 8);
      F.box(0.07, 0.03, 0.03, s * w * 0.14, railY + 0.015, conZ + 0.1, metal(C.steel, 0.3), 0.01);
    }
  },

  drum_kit: (b, w, d, h, f, _c, a) => {
    const F = world(b);
    const sx = w / 1.6;
    const sz = d / 1.3;
    const sy = h / 1.1;
    const k = Math.min(sx, sz, sy);
    const X = (x: number) => x * sx;
    const Z = (z: number) => z * sz;
    const Y = (y: number) => y * sy;
    const head = mat("#f3f1ea", { roughness: 0.75 });
    const black = mat(C.black);
    /** A drum: open shell along the local y axis, heads at both ends, hoops and lugs. */
    const drum = (x: number, y: number, z: number, r: number, depth: number, rx: number, rz: number, front = head, wooden = false) => {
      r *= k;
      depth *= k;
      const D = Frame.at(b, x, y, z, rx, 0, rz);
      D.geo(new THREE.CylinderGeometry(r, r, depth, 24, 1, true), f);
      D.disc(r * 0.99, 0, depth / 2 + 0.004, 0, front, 24);
      D.geo(new THREE.CircleGeometry(r * 0.99, 24).rotateX(Math.PI / 2), head, 0, -depth / 2 - 0.004, 0);
      // hoops: closed rings (outside, rim, inside) over the shell's ends
      const hh = 0.011 * k;
      const hoop = lathe(
        [
          [r * 1.025, -hh],
          [r * 1.025, hh],
          [r * 0.995, hh],
          [r * 0.995, -hh],
          [r * 1.025, -hh],
        ],
        24,
        false,
      );
      for (const s of [-1, 1]) D.geo(hoop.clone(), wooden ? f : a, 0, s * (depth / 2 - 0.006), 0);
      const lugs = r > 0.2 ? 10 : r > 0.14 ? 8 : 6;
      for (let i = 0; i < lugs; i++) {
        const ang = ((i + 0.5) / lugs) * Math.PI * 2;
        const ld = depth * (wooden ? 0.86 : 0.5);
        D.box(0.014, ld, 0.012, Math.cos(ang) * (r + 0.006), -ld / 2, Math.sin(ang) * (r + 0.006), a, 0, 0, Math.PI / 2 - ang);
      }
      return D;
    };
    // the bass drum faces the audience (+z): its front head with a port
    const br = 0.28 * k;
    const bz = Z(0.15);
    const B = drum(0, br + 0.01, bz, 0.28, 0.4, Math.PI / 2, 0, mat("#1f1f22", { roughness: 0.7 }), true);
    B.disc(br * 0.55, 0, (0.4 * k) / 2 + 0.006, 0, head, 28);
    B.disc(0.055 * k, br * 0.45, (0.4 * k) / 2 + 0.008, -br * 0.4, mat("#0a0a0a"), 16);
    for (const s of [-1, 1]) F.rod(v(s * br * 0.8, br * 0.6, bz + 0.12 * k), v(s * (br + 0.1), 0.01, bz + 0.22 * k), 0.007, a, 5);
    // the pedal and beater on the drummer's side
    const back = bz - 0.2 * k;
    F.box(0.08, 0.02, 0.24, 0, 0, back - 0.16, black, 0.006);
    F.rod(v(0, 0.02, back - 0.05), v(0, br * 0.85, back - 0.07), 0.005, a, 5);
    F.sphere(0.025, 0, br * 0.85, back - 0.04, mat("#d8d4c8"), 1, 1, 1, 8);
    // two rack toms on the bass drum, leaning towards the drummer
    const mount = v(0, 2 * br + 0.02, bz);
    for (const [x, r, dp] of [
      [0.15, 0.127, 0.2],
      [-0.16, 0.152, 0.22],
    ] as const) {
      const ty = 2 * br + 0.18 * sy;
      drum(X(x), ty, bz - 0.06 * k, r, dp, -0.45, x > 0 ? -0.18 : 0.18);
      F.rod(mount, v(X(x) * 0.6, ty - 0.08, bz - 0.04 * k), 0.008, a, 5);
    }
    F.cyl(0.02, 0.025, 0.04, 0, 2 * br - 0.01, bz, a, 8);
    // floor tom on three legs at the drummer's right (-x)
    const ft = v(X(-0.47), Y(0.4), Z(-0.12));
    drum(ft.x, ft.y, ft.z, 0.2, 0.38, -0.05, 0);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + 0.5;
      const r = 0.2 * k + 0.02;
      F.rod(v(ft.x + Math.cos(ang) * r, ft.y + 0.08, ft.z + Math.sin(ang) * r), v(ft.x + Math.cos(ang) * (r + 0.06), 0.01, ft.z + Math.sin(ang) * (r + 0.06)), 0.006, a, 5);
    }
    // the snare on its stand between the drummer's knees, sticks across it
    const sn = v(X(0.2), Y(0.62), Z(-0.24));
    drum(sn.x, sn.y, sn.z, 0.178, 0.14, -0.12, 0);
    F.rod(v(sn.x, 0.3, sn.z), v(sn.x, sn.y - 0.08, sn.z), 0.01, a, 6);
    tripod(F, sn.x, sn.z, 0.3, 0.16, a, 0.006);
    const stick = mat("#d9c193", { roughness: 0.6 });
    F.rod(v(sn.x - 0.12, sn.y + 0.09, sn.z + 0.02), v(sn.x + 0.18, sn.y + 0.06, sn.z - 0.12), 0.006, stick, 5);
    F.rod(v(sn.x - 0.1, sn.y + 0.095, sn.z - 0.04), v(sn.x + 0.16, sn.y + 0.07, sn.z + 0.12), 0.006, stick, 5);
    // cymbals: a hi-hat at the drummer's left, a crash high up, a ride over the floor tom
    const cym = (r: number) =>
      lathe(
        [
          [0.004, 0.035 * k],
          [0.03 * k, 0.03 * k],
          [0.05 * k, 0.014 * k],
          [r * k, 0],
        ],
        28,
      );
    const brass = brassCymbal();
    const hh = v(X(0.55), Y(0.88), Z(-0.25));
    F.rod(v(hh.x, 0, hh.z), v(hh.x, hh.y + 0.08, hh.z), 0.009, a, 6);
    tripod(F, hh.x, hh.z, 0.28, 0.14, a, 0.006, 0.4);
    F.box(0.08, 0.02, 0.22, hh.x, 0, hh.z - 0.16, black, 0.006);
    F.geo(cym(0.18).scale(1, -1, 1), brass, hh.x, hh.y, hh.z);
    F.geo(cym(0.18), brass, hh.x, hh.y + 0.022, hh.z);
    for (const [px, pz, cx, cy, cz, r, tilt] of [
      [0.62, 0.25, 0.4, 1.04, 0.12, 0.2, -0.3],
      [-0.66, 0.2, -0.42, 0.95, 0.02, 0.25, -0.15],
    ] as const) {
      const stand = v(X(px), Y(cy) - 0.12, Z(pz));
      F.rod(v(stand.x, 0, stand.z), stand, 0.009, a, 6);
      tripod(F, stand.x, stand.z, 0.3, 0.14, a, 0.006, 1);
      const c = v(X(cx), Y(cy) - 0.03, Z(cz));
      F.rod(stand, c, 0.007, a, 5);
      F.geo(cym(r), brass, c.x, c.y, c.z, tilt, 0, px > 0 ? -0.12 : 0.12);
    }
    // the throne behind it all
    const th = v(0, Y(0.5), Z(-0.47));
    F.cyl(0.16 * k, 0.15 * k, 0.08, th.x, th.y, th.z, mat("#1c1c1e", { roughness: 0.9 }), 20);
    F.rod(v(th.x, 0.25, th.z), v(th.x, th.y, th.z), 0.016, a, 8);
    tripod(F, th.x, th.z, 0.25, 0.16 * k, a, 0.009, Math.PI / 2);
  },

  cat_tree: (b, w, d, h, f) => {
    const F = world(b);
    const s = Math.min(w, d) / 0.6;
    const sisal = mat("#c9ad80", { roughness: 1 });
    const hole = mat("#141414", { roughness: 1 });
    /** A post wrapped in sisal rope: ridged turns every 3 cm. */
    const post = (x: number, z: number, y0: number, y1: number, r = 0.045 * s) => {
      const turns = Math.max(2, Math.round((y1 - y0) / 0.04));
      const step = (y1 - y0) / turns;
      const pts: [number, number][] = [[r * 0.9, 0]];
      for (let i = 0; i < turns; i++) pts.push([r, (i + 0.5) * step], [r * 0.92, (i + 1) * step]);
      F.geo(lathe(pts, 8), sisal, x, y0, z);
    };
    // a plush base
    F.box(w, 0.05, d, 0, 0, 0, f, 0.02);
    // the cubby: a plush box with a round door, its roof a platform
    const cw = Math.min(0.36, w * 0.58);
    const cx = -w / 2 + cw / 2 + 0.01;
    const cz = -d / 2 + cw / 2 + 0.01;
    const ch = Math.min(0.32, h * 0.2);
    F.box(cw, ch, cw, cx, 0.05, cz, f, 0.03);
    F.geo(new THREE.CircleGeometry(cw * 0.3, 20), hole, cx, 0.05 + ch * 0.48, cz + cw / 2 + 0.002);
    F.geo(new THREE.RingGeometry(cw * 0.3, cw * 0.35, 20), mat(hex(f.color.clone().multiplyScalar(0.8)), { roughness: 1 }), cx, 0.05 + ch * 0.48, cz + cw / 2 + 0.003);
    // platforms on sisal posts
    const p1 = h * 0.47;
    const p2 = h * 0.72;
    const top = h - 0.1;
    const plat = (x: number, z: number, y: number, pw: number, pd: number) => F.box(pw, 0.04, pd, x, y, z, f, 0.018);
    const ax = w / 2 - 0.1 * s;
    const az = d / 2 - 0.1 * s;
    const p1w = Math.min(0.36, w * 0.6);
    post(ax, az, 0.05, p1);
    plat(ax - 0.04 * s, az - 0.06 * s, p1, p1w, Math.min(0.34, d * 0.56));
    post(cx, cz, 0.05 + ch, p2);
    plat(cx + 0.03 * s, cz + 0.04 * s, p2, Math.min(0.36, w * 0.6), Math.min(0.32, d * 0.53));
    post(ax - 0.02 * s, -d / 2 + 0.12 * s, 0.05, top);
    // the top perch: a round bed with a raised rim
    const pr = Math.min(w, d) * 0.4;
    const px = w * 0.1;
    const pz = -d * 0.02;
    F.cyl(pr, pr, 0.04, px, top, pz, f, 24);
    F.geo(new THREE.TorusGeometry(pr * 0.88, 0.035, 6, 24).rotateX(Math.PI / 2), f, px, top + 0.055, pz);
    F.cyl(pr * 0.86, pr * 0.86, 0.02, px, top + 0.04, pz, mat(hex(f.color.clone().lerp(new THREE.Color("#ffffff"), 0.25)), { roughness: 1 }), 24);
    // a pompom toy on a string under the first platform
    const tx = ax - 0.04 * s + p1w / 2 - 0.04;
    const tz = az - 0.06 * s + 0.08;
    F.rod(v(tx, p1, tz), v(tx, p1 - 0.18, tz), 0.0015, mat("#e8e2d6"), 3);
    F.sphere(0.03, tx, p1 - 0.2, tz, mat("#d23a2a", { roughness: 1 }), 1, 1, 1, 8);
    // a sisal scratching mat on the base front
    F.box(w * 0.4, 0.006, d * 0.25, -w * 0.15, 0.05, d / 2 - d * 0.15, sisal, 0.002);
  },

  bird_cage: (b, w, d, h, f) => {
    const F = world(b);
    const R = Math.min(w, d) / 2;
    const r = R * 0.88;
    const trayH = Math.min(0.08, h * 0.1);
    const wallTop = h * 0.66;
    const domeTop = h - 0.07;
    // the tray: a dish with a lip, a sandy floor
    F.geo(
      lathe(
        [
          [0.001, 0],
          [R * 0.92, 0],
          [R, 0.012],
          [R * 0.98, trayH * 0.8],
          [R, trayH],
          [r * 0.98, trayH],
          [0.001, trayH],
        ],
        32,
      ),
      f,
    );
    F.disc(r * 0.97, 0, trayH + 0.001, 0, mat("#d8c9a4", { roughness: 1 }), 24);
    // bars rising and curving over into a dome
    const bars = 24;
    const bar = 0.0028;
    for (let i = 0; i < bars; i++) {
      const ang = (i / bars) * Math.PI * 2;
      const cx = Math.cos(ang) * r;
      const cz = Math.sin(ang) * r;
      F.rod(v(cx, trayH, cz), v(cx, wallTop, cz), bar, f, 6);
      const dome = new THREE.QuadraticBezierCurve3(v(cx, wallTop, cz), v(cx, domeTop + (domeTop - wallTop) * 0.2, cz), v(0, domeTop, 0));
      F.geo(new THREE.TubeGeometry(dome, 6, bar, 6), f);
    }
    for (const y of [trayH + 0.01, trayH + (wallTop - trayH) * 0.5, wallTop]) F.geo(new THREE.TorusGeometry(r, 0.0045, 5, 32).rotateX(Math.PI / 2), f, 0, y, 0);
    // the door: a framed panel in the front
    const dz = r + 0.004;
    const dy0 = trayH + 0.03;
    const dy1 = dy0 + (wallTop - trayH) * 0.45;
    for (const s of [-1, 1]) F.rod(v(s * 0.065, dy0, dz), v(s * 0.065, dy1, dz), 0.004, f, 4);
    for (const y of [dy0, dy1]) F.rod(v(-0.065, y, dz), v(0.065, y, dz), 0.004, f, 4);
    F.sphere(0.008, 0.07, (dy0 + dy1) / 2, dz + 0.005, f, 1, 1, 1, 6);
    // the hanging ring on a finial
    F.sphere(0.022, 0, domeTop + 0.005, 0, f, 1, 0.7, 1, 10);
    F.geo(new THREE.TorusGeometry(0.03, 0.004, 5, 16), f, 0, h - 0.032, 0);
    // perches, a swing, food cups and a budgie
    const wood = mat(C.trunk, { roughness: 0.9 });
    F.rod(v(-r, trayH + 0.14, -0.04), v(r * 0.6, trayH + 0.14, 0.06), 0.006, wood, 6);
    F.rod(v(-r * 0.4, wallTop - 0.1, -r * 0.92), v(r * 0.5, wallTop - 0.08, r * 0.86), 0.006, wood, 6);
    const sy = wallTop + 0.04;
    for (const s of [-1, 1]) F.rod(v(0, sy + 0.08, 0), v(s * 0.06, sy - 0.08, 0), 0.0018, f, 5);
    F.rod(v(-0.065, sy - 0.08, 0), v(0.065, sy - 0.08, 0), 0.005, wood, 6);
    for (const s of [-1, 1]) F.box(0.06, 0.035, 0.04, s * (r - 0.03), trayH + 0.16, 0.08 * s, mat("#e8e2d6", { roughness: 0.5 }), 0.006);
    const green = mat("#5fbf4a", { roughness: 0.7 });
    const bx = 0.03;
    const by = trayH + 0.14 + 0.006;
    F.sphere(0.026, bx, by + 0.035, 0.0, green, 0.85, 1.25, 0.85, 10);
    F.sphere(0.018, bx + 0.004, by + 0.075, 0.01, mat("#e7d84a", { roughness: 0.7 }), 1, 1, 1, 10);
    F.sphere(0.005, bx + 0.004, by + 0.072, 0.026, mat("#e8a64a"), 1, 1, 1, 6);
    F.rod(v(bx, by + 0.02, -0.012), v(bx - 0.01, by - 0.04, -0.035), 0.007, mat("#2f5fb3"), 4, 0.002);
  },

  exercise_bike: (b, w, d, h, f, _c, a) => {
    // an upright bike: the rider sits at the back (-z) facing the console at the front
    const sx = w / 0.55;
    const sz = d / 1.15;
    const sy = h / 1.25;
    const P = (x: number, y: number, z: number) => v(x * sx, y * sy, z * sz);
    const F = world(b);
    const black = mat(C.black, { roughness: 0.6 });
    const rubber = mat("#1b1c1f", { roughness: 1 });
    // stabilisers on the floor with end caps, wheels at the front, and the beam between them
    for (const z of [-0.47, 0.47]) {
      F.geo(new THREE.CylinderGeometry(0.03, 0.03, w - 0.06, 12).rotateZ(Math.PI / 2), a, 0, 0.035, z * sz);
      for (const s of [-1, 1]) F.geo(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 12).rotateZ(Math.PI / 2), z > 0 ? rubber : black, s * (w / 2 - 0.015), 0.035, z * sz);
    }
    F.box(0.07, 0.05, (0.94 - 0.06) * sz, 0, 0.02, 0, a, 0.012);
    // the seat tube (leaning back) and the saddle
    const seatTop = P(0, 0.84, -0.3);
    F.rod(P(0, 0.06, -0.12), seatTop, 0.032, a, 10);
    F.rod(P(0, 0.62, -0.25), P(0, 0.88, -0.32), 0.022, black, 8);
    F.cyl(0.03, 0.03, 0.03, seatTop.x, seatTop.y - 0.02, seatTop.z, black, 10);
    const saddle = new THREE.Shape();
    saddle.moveTo(0, -0.15);
    saddle.bezierCurveTo(0.035, -0.15, 0.035, -0.05, 0.06, 0.0);
    saddle.bezierCurveTo(0.11, 0.06, 0.1, 0.12, 0.0, 0.12);
    saddle.bezierCurveTo(-0.1, 0.12, -0.11, 0.06, -0.06, 0.0);
    saddle.bezierCurveTo(-0.035, -0.05, -0.035, -0.15, 0, -0.15);
    const sg = new THREE.ExtrudeGeometry(saddle, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 6 }).rotateX(-Math.PI / 2);
    F.geo(sg, mat("#1d1e21", { roughness: 0.55 }), 0, 0.88 * sy + 0.015, -0.32 * sz);
    // the front post leaning back to the handlebars
    const bar = P(0, 1.0, 0.24);
    F.rod(P(0, 0.06, 0.36), bar, 0.035, a, 10);
    F.rod(P(0, 0.06, 0.36), P(0, 0.06, 0.1), 0.03, a, 8);
    // the flywheel shroud between the posts, the crank in its middle, pedals on both sides
    const fw = P(0, 0.38, 0.06);
    const fr = Math.min(0.26 * Math.min(sy, sz), 0.3);
    F.geo(new THREE.CylinderGeometry(fr, fr, 0.11, 32).rotateZ(Math.PI / 2), f, fw.x, fw.y, fw.z);
    for (const s of [-1, 1]) {
      F.geo(new THREE.CircleGeometry(fr * 0.62, 24).rotateY((s * Math.PI) / 2), mat("#2b2d31", { roughness: 0.5 }), s * 0.0555, fw.y, fw.z);
      F.geo(new THREE.CircleGeometry(fr * 0.22, 16).rotateY((s * Math.PI) / 2), a, s * 0.056, fw.y, fw.z);
    }
    const ck = P(0, 0.38, -0.02);
    F.geo(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12).rotateZ(Math.PI / 2), black, ck.x, ck.y, ck.z);
    const steel = mat(C.steel, { metalness: 0.7, roughness: 0.3 });
    for (const s of [-1, 1]) {
      const ang = s > 0 ? 0.6 : 0.6 + Math.PI;
      const px = s * 0.1;
      const p = v(px, ck.y + Math.sin(ang) * 0.17, ck.z + Math.cos(ang) * 0.17);
      F.rod(v(s * 0.085, ck.y, ck.z), v(s * 0.085, p.y, p.z), 0.012, steel, 6);
      F.box(0.1, 0.025, 0.07, px + s * 0.045, p.y - 0.0125, p.z, black, 0.006);
      F.box(0.012, 0.03, 0.075, px + s * 0.095, p.y - 0.015, p.z, black);
    }
    // handlebars: a cross bar, the grips swept back to the rider, a top bar
    const grip = mat("#151517", { roughness: 0.95 });
    F.rod(v(-0.2 * sx, bar.y, bar.z), v(0.2 * sx, bar.y, bar.z), 0.016, a, 8);
    for (const s of [-1, 1]) {
      const e = v(s * 0.2 * sx, bar.y, bar.z);
      const t = v(s * 0.22 * sx, bar.y + 0.04, bar.z - 0.2 * sz);
      F.rod(e, t, 0.02, grip, 8);
      F.sphere(0.02, t.x, t.y, t.z, grip, 1, 1, 1, 8);
      F.sphere(0.016, e.x, e.y, e.z, a, 1, 1, 1, 8);
      F.box(0.04, 0.012, 0.05, s * 0.12 * sx, bar.y + 0.012, bar.z, mat("#8b9097", { metalness: 0.5, roughness: 0.4 }), 0.004);
    }
    // the console facing the rider: a tilted slab with its screen and buttons
    const con = Frame.at(b, 0, h - 0.11, bar.z + 0.06, -0.6);
    F.rod(v(0, bar.y, bar.z), v(0, h - 0.13, bar.z + 0.05), 0.018, a, 8);
    con.box(0.26, 0.05, 0.17, 0, -0.025, 0, black, 0.02);
    con.box(0.13, 0.004, 0.08, 0, 0.025, 0.01, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }));
    for (const s of [-1, 1]) for (let k = 0; k < 2; k++) con.cyl(0.01, 0.01, 0.006, s * 0.095, 0.025, -0.025 + k * 0.045, mat(k ? "#7a7f86" : "#d23a2a", { roughness: 0.5 }), 10);
    con.box(0.08, 0.006, 0.02, 0, 0.025, -0.06, mat("#7a7f86", { roughness: 0.5 }), 0.003);
    // the resistance knob on the front post
    const kn = P(0, 0.72, 0.29);
    F.rod(kn, v(0, kn.y + 0.04, kn.z - 0.02), 0.008, steel, 6);
    F.cyl(0.025, 0.028, 0.03, 0, kn.y + 0.035, kn.z - 0.02, mat("#d23a2a", { roughness: 0.5 }), 12);
  },

  rowing_machine: (b, w, d, h, f, _c, a) => {
    // the rower sits at the back (-z) and pulls towards the flywheel at the front (+z)
    const F = world(b);
    const k = Math.min(1, h / 0.6, w / 0.55);
    const black = mat(C.black, { roughness: 0.6 });
    const rubber = mat("#1b1c1f", { roughness: 1 });
    const railY = 0.25 * k;
    const z0 = -d / 2 + 0.06;
    const z1 = d / 2 - 0.62 * k;
    // the monorail with a top track, on a T-foot at the back
    F.box(0.1, 0.07, z1 - z0, 0, railY - 0.07, (z0 + z1) / 2, a, 0.012);
    F.box(0.06, 0.006, z1 - z0 - 0.06, 0, railY, (z0 + z1) / 2, mat("#8b9097", { metalness: 0.6, roughness: 0.35 }), 0.002);
    F.box(0.06, railY - 0.07, 0.06, 0, 0, z0 + 0.04, a, 0.01);
    F.box(w * 0.62, 0.035, 0.07, 0, 0, z0 + 0.04, a, 0.01);
    for (const s of [-1, 1]) F.box(0.05, 0.02, 0.08, s * (w * 0.31 - 0.02), 0, z0 + 0.04, rubber, 0.006);
    // the front frame: a sloping beam up to the flywheel, on a wide front foot
    const fr = 0.22 * k;
    const fz = d / 2 - fr - 0.02;
    const fy = fr + 0.1 * k;
    F.rod(v(0, railY - 0.035, z1 - 0.03), v(0, fy - fr * 0.5, fz - fr * 0.6), 0.045, f, 10);
    F.box(w, 0.04, 0.08, 0, 0, fz - 0.02, f, 0.012);
    for (const s of [-1, 1]) {
      F.rod(v(s * 0.06, 0.04, fz - 0.02), v(s * 0.075, fy, fz), 0.022, f, 8);
      F.geo(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14).rotateZ(Math.PI / 2), rubber, s * (w / 2 - 0.02), 0.04, fz + 0.03);
    }
    // the flywheel in its cage: a drum with vented side covers and a hub
    F.geo(new THREE.CylinderGeometry(fr, fr, 0.14, 32).rotateZ(Math.PI / 2), f, 0, fy, fz);
    const vent = mat("#151517", { roughness: 0.9 });
    for (const s of [-1, 1]) {
      F.geo(new THREE.CircleGeometry(fr * 0.86, 28).rotateY((s * Math.PI) / 2), mat("#2b2d31", { roughness: 0.6 }), s * 0.0705, fy, fz);
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        F.box(0.004, fr * 0.42, 0.018, s * 0.071, fy + Math.sin(ang) * fr * 0.5 - fr * 0.21, fz + Math.cos(ang) * fr * 0.5, vent, 0, Math.PI / 2 - ang);
      }
      F.geo(new THREE.CylinderGeometry(fr * 0.18, fr * 0.18, 0.02, 16).rotateZ(Math.PI / 2), a, s * 0.075, fy, fz);
    }
    // the monitor on its arm, facing the rower
    const mz = fz - fr - 0.04;
    F.rod(v(0, fy + fr * 0.7, fz - fr * 0.5), v(0, h - 0.12, mz), 0.014, a, 8);
    const mon = Frame.at(b, 0, h - 0.08, mz - 0.01, -1.15);
    mon.box(0.16, 0.03, 0.12, 0, -0.015, 0, black, 0.01);
    mon.box(0.11, 0.003, 0.07, 0, 0.015, 0.008, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.4 }));
    // the footrests: two tilted plates with straps and heel cups
    const fz2 = z1 - 0.12;
    for (const s of [-1, 1]) {
      const foot = Frame.at(b, s * 0.085, railY - 0.02, fz2, -0.75);
      foot.box(0.1, 0.012, 0.28, 0, 0, 0, black, 0.005);
      foot.box(0.11, 0.02, 0.05, 0, 0.012, 0.03, mat("#3a3c40", { roughness: 0.9 }), 0.006);
      foot.box(0.1, 0.03, 0.03, 0, 0.012, -0.12, black, 0.008);
    }
    F.box(0.05, 0.08, 0.05, 0, railY - 0.07, fz2, a, 0.01);
    // the seat on its rollers
    const sz = z0 + (z1 - z0) * 0.32;
    F.box(0.12, 0.03, 0.18, 0, railY, sz, black, 0.008);
    for (const s of [-1, 1]) F.geo(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 10).rotateZ(Math.PI / 2), rubber, 0, railY + 0.01, sz + s * 0.06);
    const seat = new THREE.Shape();
    seat.moveTo(-0.15, -0.12);
    seat.bezierCurveTo(-0.17, 0.0, -0.13, 0.13, 0, 0.13);
    seat.bezierCurveTo(0.13, 0.13, 0.17, 0.0, 0.15, -0.12);
    seat.bezierCurveTo(0.05, -0.08, -0.05, -0.08, -0.15, -0.12);
    const sg = new THREE.ExtrudeGeometry(seat, { depth: 0.025, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 6 }).rotateX(-Math.PI / 2);
    F.geo(sg, mat("#1d1e21", { roughness: 0.55 }), 0, railY + 0.042, sz);
    // the handle resting in its hook, its chain running into the flywheel cage
    const hz = fz - fr - 0.02;
    const hy = fy + 0.02;
    F.rod(v(-0.2 * k, hy, hz), v(0.2 * k, hy, hz), 0.012, a, 8);
    for (const s of [-1, 1]) F.rod(v(s * 0.08 * k, hy, hz), v(s * 0.24 * k, hy, hz - 0.04), 0.018, mat("#151517", { roughness: 0.95 }), 8);
    F.rod(v(0, hy, hz), v(0, hy, fz - fr * 0.6), 0.004, mat(C.steel, { metalness: 0.7, roughness: 0.35 }), 4);
  },

  weight_bench: (b, w, d, h, f, _c, a) => {
    const F = world(b);
    const pw = Math.min(0.3, w * 0.5);
    const padT = Math.min(0.07, h * 0.16);
    const board = 0.015;
    const top = h - padT - board;
    const rubber = mat("#1b1c1f", { roughness: 1 });
    // the frame: a spine under the pads, a vertical post at the front, a raked one at the back
    const zf = d / 2 - 0.2;
    const zb = -d / 2 + 0.12;
    F.box(0.06, 0.06, d - 0.24, 0, top - 0.06, -0.02, a, 0.008);
    F.box(0.06, top - 0.09, 0.06, 0, 0.05, zf, a, 0.008);
    F.rod(v(0, top - 0.04, zb + 0.22), v(0, 0.06, zb), 0.03, a, 4);
    for (const z of [zf, zb]) {
      F.box(w - 0.06, 0.05, 0.07, 0, 0, z, a, 0.01);
      for (const s of [-1, 1]) F.box(0.04, 0.055, 0.075, s * (w / 2 - 0.02), 0, z, rubber, 0.012);
    }
    // the adjuster pin and a cross brace
    F.cyl(0.018, 0.018, 0.03, 0, top - 0.14, zf + 0.045, mat(C.black), 10);
    F.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 8).rotateX(Math.PI / 2), mat(C.steel, { metalness: 0.7, roughness: 0.3 }), 0, top - 0.125, zf + 0.03);
    // pads: seat and back on boards, with a seam round each
    const seam = mat(hex(f.color.clone().multiplyScalar(0.55)), { roughness: 0.8 });
    const seatL = Math.min(0.38, d * 0.3);
    const backL = d - seatL - 0.03;
    for (const [len, z] of [
      [seatL, d / 2 - seatL / 2],
      [backL, -d / 2 + backL / 2],
    ] as const) {
      F.box(pw - 0.02, board, len - 0.02, 0, top, z, mat("#1a1a1a", { roughness: 0.8 }));
      F.box(pw, padT, len, 0, top + board, z, f, Math.min(0.03, padT * 0.45));
      F.box(pw + 0.002, 0.004, len + 0.002, 0, top + board + padT * 0.42, z, seam, 0.002);
    }
  },

  dumbbell_rack: (b, w, d, h, f, _c, a) => {
    const F = world(b);
    const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.22 });
    const knurl = mat("#9aa0a6", { metalness: 0.7, roughness: 0.55 });
    const tiers = [
      { y: Math.min(0.36, h * 0.45), z: d * 0.08, tilt: 0.2 },
      { y: h - 0.1, z: -d * 0.08, tilt: 0.3 },
    ];
    const tray = d * 0.62;
    // A-frame sides: a raked front leg, a straight back leg, feet and the tier arms
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.025);
      F.rod(v(x, 0.03, d / 2 - 0.04), v(x, h - 0.06, -d * 0.12), 0.022, a, 4);
      F.rod(v(x, 0.03, -d / 2 + 0.04), v(x, h - 0.06, -d * 0.18), 0.022, a, 4);
      F.box(0.05, 0.04, d, x, 0, 0, a, 0.008);
      for (const sz of [-1, 1]) F.box(0.055, 0.015, 0.06, x, 0, sz * (d / 2 - 0.03), mat("#1b1c1f", { roughness: 1 }), 0.004);
      for (const t of tiers) {
        const T = Frame.at(b, x, t.y, t.z, t.tilt);
        T.box(0.05, 0.05, tray + 0.02, 0, -0.06, 0, a, 0.006);
      }
    }
    // each tier: two rails along it with saddles, dumbbells lying front to back
    for (const [ti, t] of tiers.entries()) {
      const T = Frame.at(b, 0, t.y, t.z, t.tilt);
      for (const sz of [-1, 1]) T.box(w - 0.05, 0.03, 0.05, 0, -0.04, sz * tray * 0.36, a, 0.006);
      const n = Math.max(3, Math.round((w - 0.12) / (ti ? 0.15 : 0.18)));
      const step = (w - 0.12) / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.06 + step * (i + 0.5);
        // lighter ones at the top and to the left
        const g = (ti ? 0 : 0.5) + (i / n) * 0.5;
        const r = Math.min(step * 0.45, 0.04 + g * 0.035);
        const len = 0.04 + g * 0.05;
        const hy = r - 0.01;
        for (const sz of [-1, 1]) {
          const hz = sz * (0.065 + len / 2);
          T.geo(new THREE.CylinderGeometry(r, r, len, 6).rotateX(Math.PI / 2), f, x, hy, hz);
          T.geo(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.012, 10).rotateX(Math.PI / 2), chrome, x, hy, sz * (0.065 + len + 0.006));
          T.geo(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.008, 10).rotateX(Math.PI / 2), chrome, x, hy, sz * 0.061);
        }
        T.geo(new THREE.CylinderGeometry(0.0145, 0.0145, 0.12, 8).rotateX(Math.PI / 2), knurl, x, hy, 0);
      }
    }
  },

  yoga_mat: (b, w, d, h, f) => {
    // a mat unrolled to the front, the last turn still curled at the back
    const F = world(b);
    const t = Math.max(0.004, h);
    const rr = 0.018;
    const flat = d - rr;
    const s = new THREE.Shape();
    const c = Math.min(0.03, w * 0.08);
    s.moveTo(-w / 2, flat / 2);
    s.lineTo(-w / 2, -flat / 2 + c);
    s.quadraticCurveTo(-w / 2, -flat / 2, -w / 2 + c, -flat / 2);
    s.lineTo(w / 2 - c, -flat / 2);
    s.quadraticCurveTo(w / 2, -flat / 2, w / 2, -flat / 2 + c);
    s.lineTo(w / 2, flat / 2);
    s.closePath();
    F.geo(slab(s, t), f, 0, 0, rr / 2);
    F.geo(new THREE.CylinderGeometry(rr, rr, w, 20).rotateZ(Math.PI / 2), f, 0, rr, -d / 2 + rr);
    // the curled end shows the mat's turns as darker rings
    const edge = mat(hex(f.color.clone().multiplyScalar(0.6)), { roughness: 1 });
    for (const sx of [-1, 1]) {
      const ring = new THREE.RingGeometry(rr * 0.45, rr * 0.6, 16).rotateY((sx * Math.PI) / 2);
      F.geo(ring, edge, sx * (w / 2 + 0.0005), rr, -d / 2 + rr);
    }
  },

  punching_bag: (b, w, d, h, f) => {
    // hangs from the ceiling (y = h): bracket, swivel, chain, a ring and four chains to the bag
    const F = world(b);
    const R = (Math.min(w, d) / 2) * 0.92;
    const L = Math.min(1.2, h * 0.65);
    const yTop = h - Math.min(0.32, h * 0.18);
    const y0 = yTop - L;
    const steel = mat(C.steel, { metalness: 0.75, roughness: 0.3 });
    F.box(0.1, 0.012, 0.1, 0, h - 0.012, 0, steel, 0.003);
    F.geo(new THREE.TorusGeometry(0.014, 0.004, 4, 10), steel, 0, h - 0.03, 0);
    F.cyl(0.012, 0.012, 0.04, 0, h - 0.085, 0, steel, 10);
    const ring = yTop + Math.min(0.15, (h - yTop) * 0.5);
    chain(b, v(0, h - 0.09, 0), v(0, ring + 0.02, 0), steel);
    F.geo(new THREE.TorusGeometry(0.024, 0.004, 4, 14).rotateX(Math.PI / 2), steel, 0, ring, 0);
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + (i / 4) * Math.PI * 2;
      const e = v(Math.cos(ang) * R * 0.62, yTop + 0.012, Math.sin(ang) * R * 0.62);
      chain(b, v(Math.cos(ang) * 0.02, ring - 0.004, Math.sin(ang) * 0.02), e, steel, 0.009);
    }
    // the bag: a long leather drum with rounded ends
    F.geo(
      lathe(
        [
          [0.001, 0],
          [R * 0.55, 0.004],
          [R * 0.86, 0.025],
          [R * 0.98, 0.07],
          [R, 0.12],
          [R, L - 0.09],
          [R * 0.97, L - 0.04],
          [R * 0.84, L - 0.012],
          [R * 0.5, L],
          [0.001, L],
        ],
        24,
      ),
      f,
      0,
      y0,
      0,
    );
    // seams, a label panel on the front, the top straps with their D-rings, a ring at the bottom
    const dark = f.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.2;
    const seam = mat(dark ? "#3a3a3d" : hex(f.color.clone().multiplyScalar(0.55)), { roughness: 0.8 });
    for (const y of [0.13, L * 0.5, L - 0.1]) F.geo(new THREE.TorusGeometry(R + 0.001, 0.004, 4, 24).rotateX(Math.PI / 2), seam, 0, y0 + y, 0);
    const label = mat(dark ? "#b8322a" : "#1f1f22", { roughness: 0.7 });
    F.geo(new THREE.CylinderGeometry(R + 0.002, R + 0.002, L * 0.26, 8, 1, true, -0.42, 0.84), label, 0, y0 + L * 0.68, 0);
    F.geo(new THREE.CylinderGeometry(R + 0.003, R + 0.003, L * 0.04, 8, 1, true, -0.36, 0.72), mat("#f2f0ea", { roughness: 0.7 }), 0, y0 + L * 0.68, 0);
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + (i / 4) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      F.box(0.035, 0.12, 0.006, c * (R + 0.001), yTop - 0.12, s * (R + 0.001), seam, 0, 0, Math.PI / 2 - ang);
      F.geo(new THREE.TorusGeometry(0.014, 0.003, 4, 10).rotateY(Math.PI / 2 - ang), steel, c * R * 0.62, yTop + 0.012, s * R * 0.62);
    }
    F.geo(new THREE.TorusGeometry(0.018, 0.004, 4, 10), steel, 0, y0 - 0.01, 0);
  },

  dartboard: (b, w, d, h) => {
    // on the wall (back at -z): a sisal board in its black surround, wire spider, number ring
    const F = world(b);
    const r = Math.min(w, h) / 2;
    const cy = h / 2;
    const zf = -d / 2 + d * 0.85;
    F.geo(
      lathe(
        [
          [0.001, 0],
          [r, 0],
          [r, d * 0.85 - 0.006],
          [r - 0.006, d * 0.85],
          [0.001, d * 0.85],
        ],
        48,
      ).rotateX(Math.PI / 2),
      mat("#1c1c1c", { roughness: 0.9 }),
      0,
      cy,
      zf - d * 0.85,
    );
    const ra = r * 0.76;
    const dark = mat("#2b2b2b", { roughness: 1 });
    const light = mat("#e8dcc0", { roughness: 1 });
    const red = mat("#c8382c", { roughness: 0.9 });
    const green = mat("#2f7a45", { roughness: 0.9 });
    const bands: [number, number, boolean][] = [
      [0.0935, 0.582, false],
      [0.582, 0.629, true],
      [0.629, 0.953, false],
      [0.953, 1, true],
    ];
    for (let i = 0; i < 20; i++) {
      const a0 = Math.PI / 2 - Math.PI / 20 + (i * Math.PI) / 10;
      const even = i % 2 === 0;
      for (const [r0, r1, scoring] of bands) {
        const m = scoring ? (even ? red : green) : even ? dark : light;
        F.geo(new THREE.RingGeometry(ra * r0, ra * r1, 3, 1, a0, Math.PI / 10), m, 0, cy, zf + 0.0005);
      }
    }
    F.geo(new THREE.CircleGeometry(ra * 0.0935, 20), green, 0, cy, zf + 0.0005);
    F.geo(new THREE.CircleGeometry(ra * 0.0374, 14), red, 0, cy, zf + 0.0008);
    // the spider: wire rings and radial wires
    const wire = mat("#c9cdd1", { metalness: 0.7, roughness: 0.35 });
    for (const k of [0.0935, 0.582, 0.629, 0.953, 1]) F.geo(new THREE.RingGeometry(ra * k - 0.0007, ra * k + 0.0007, 64), wire, 0, cy, zf + 0.0012);
    for (let i = 0; i < 20; i++) {
      const ang = Math.PI / 2 - Math.PI / 20 + (i * Math.PI) / 10;
      const len = ra * (1 - 0.0935);
      const mid = ra * (0.0935 + 1) * 0.5;
      F.box(0.0014, len, 0.0012, Math.cos(ang) * mid, cy + Math.sin(ang) * mid - len / 2, zf + 0.0006, wire, 0, 0, 0, ang - Math.PI / 2);
    }
    // the number ring and the twenty numbers (as small white marks)
    F.geo(new THREE.TorusGeometry(ra * 1.12, 0.0025, 4, 48), wire, 0, cy, zf + 0.002);
    const white = mat("#f2f0ea", { roughness: 0.6 });
    for (let i = 0; i < 20; i++) {
      const ang = Math.PI / 2 + (i * Math.PI) / 10;
      const rr = ra * 1.12 + (r - ra * 1.12) * 0.5;
      F.box(r * 0.07, r * 0.055, 0.002, Math.cos(ang) * rr, cy + Math.sin(ang) * rr - r * 0.0275, zf, white, 0, 0, 0, ang - Math.PI / 2);
    }
    // three darts in the board (they stick out of its 4 cm, not counted in its size)
    b.above(() => {
      const barrel = mat("#9aa0a6", { metalness: 0.8, roughness: 0.3 });
      const shaft = mat("#1f1f22", { roughness: 0.5 });
      const flight = mat("#2f5fb3", { roughness: 0.7, side: THREE.DoubleSide });
      for (const [x, y, tilt, turn] of [
        [0.0, ra * 0.6, 0.08, 0.3],
        [-ra * 0.12, ra * 0.5, 0.12, -0.2],
        [ra * 0.55, -ra * 0.2, 0.05, 0.6],
      ] as const) {
        const at = matrix(x, cy + y, zf, Math.PI / 2 - tilt, 0, turn * 0.2);
        const put = (g: THREE.BufferGeometry, m: THREE.Material) => b.add(g.applyMatrix4(at), m);
        put(new THREE.CylinderGeometry(0.0012, 0.0004, 0.02, 5).translate(0, 0.01, 0), barrel);
        put(new THREE.CylinderGeometry(0.0035, 0.003, 0.04, 8).translate(0, 0.04, 0), barrel);
        put(new THREE.CylinderGeometry(0.0018, 0.0022, 0.035, 6).translate(0, 0.0775, 0), shaft);
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(0.016, 0.012);
        s.lineTo(0.016, 0.03);
        s.lineTo(0, 0.034);
        s.closePath();
        for (let k = 0; k < 4; k++) put(new THREE.ShapeGeometry(s).translate(0, 0.068, 0).rotateY(turn + (k * Math.PI) / 2), flight);
      }
    });
  },

  projector_screen: (b, w, d, h, f) => {
    // a roll-up screen on the wall: the case at the top, the screen with a black border, the weighted bar
    const F = world(b);
    const ch = Math.min(0.085, h * 0.08);
    const black = mat("#1b1b1d", { roughness: 0.9 });
    F.box(w - 0.03, ch, d, 0, h - ch, 0, f, Math.min(0.03, d * 0.4));
    for (const s of [-1, 1]) F.box(0.016, ch + 0.004, d + 0.004, s * (w / 2 - 0.008), h - ch - 0.002, 0, black, 0.006);
    F.box(w - 0.08, 0.004, 0.012, 0, h - ch - 0.002, d * 0.18, black);
    // the screen: its picture surface (the card's screen) framed by black edges
    const sz = d * 0.18;
    const sw = w - 0.12;
    const sh = h - ch - 0.07;
    b.box(sw, sh, 0.003, 0, 0.065, sz, part(mat("#f6f6f4", { roughness: 1 }), "screen"));
    const edge = Math.min(0.035, sw * 0.02);
    const drop = Math.min(0.15, sh * 0.1);
    F.box(sw, drop, 0.005, 0, 0.065 + sh - drop, sz, black);
    F.box(sw, edge, 0.005, 0, 0.065, sz, black);
    for (const s of [-1, 1]) F.box(edge, sh, 0.005, s * (sw / 2 - edge / 2), 0.065, sz, black);
    // the weighted bottom bar with end caps and a pull loop
    F.box(sw + 0.02, 0.03, 0.022, 0, 0.035, sz, f, 0.01);
    for (const s of [-1, 1]) F.box(0.012, 0.034, 0.026, s * (sw / 2 + 0.016), 0.033, sz, black, 0.004);
    F.box(0.04, 0.012, 0.008, 0, 0.024, sz, black, 0.003);
    F.geo(new THREE.TorusGeometry(0.012, 0.0025, 4, 12), black, 0, 0.012, sz);
  },

  guitar_stand: (b, w, d, h, f, _c, a) => {
    // an acoustic guitar leaning back in an A-frame stand
    const F = world(b);
    const s = Math.min((h - 0.08) / 1.14, w / 0.4 + 0.2, 1.2);
    const G = new Frame(b, matrix(0, 0.07, 0.04, -0.2, 0, 0, s));
    const at = (x: number, y: number, z: number) => v(x, y, z).applyMatrix4(G.m);
    // the body: outline extruded, sides and back in the finish
    const body = new THREE.Shape();
    body.moveTo(0, 0);
    body.bezierCurveTo(0.2, 0, 0.215, 0.2, 0.12, 0.27);
    body.bezierCurveTo(0.165, 0.33, 0.155, 0.48, 0, 0.5);
    body.bezierCurveTo(-0.155, 0.48, -0.165, 0.33, -0.12, 0.27);
    body.bezierCurveTo(-0.215, 0.2, -0.2, 0, 0, 0);
    G.geo(new THREE.ExtrudeGeometry(body, { depth: 0.09, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 10 }), f, 0, 0, -0.045);
    const top = 0.053;
    const dark = mat("#1a1612", { roughness: 0.7 });
    const cream = mat("#efe6d2", { roughness: 0.5 });
    G.geo(new THREE.CircleGeometry(0.043, 20), mat("#0d0b09", { roughness: 1 }), 0, 0.33, top + 0.0005);
    G.geo(new THREE.RingGeometry(0.047, 0.056, 24), cream, 0, 0.33, top + 0.0005);
    const guard = new THREE.Shape();
    guard.moveTo(0.04, 0.3);
    guard.bezierCurveTo(0.09, 0.28, 0.11, 0.22, 0.08, 0.2);
    guard.bezierCurveTo(0.06, 0.19, 0.05, 0.25, 0.04, 0.3);
    G.geo(new THREE.ShapeGeometry(guard, 6), dark, 0, 0, top + 0.0007);
    G.box(0.13, 0.028, 0.01, 0, 0.11, top, dark, 0.004);
    G.box(0.07, 0.004, 0.006, 0, 0.128, top + 0.006, cream);
    // the neck, fretboard with frets and dots, the headstock bent back with its tuners
    const neckM = mat("#5a3a24", { roughness: 0.6 });
    const nut = 0.95;
    G.box(0.046, nut - 0.47, 0.024, 0, 0.47, top - 0.014, neckM, 0.008);
    G.box(0.052, nut - 0.41, 0.006, 0, 0.41, top + 0.001, mat("#241812", { roughness: 0.7 }));
    const fret = mat("#c9cdd1", { metalness: 0.7, roughness: 0.3 });
    const scale = nut - 0.13;
    for (let n = 1; n <= 19; n++) {
      const y = nut - scale * (1 - Math.pow(2, -n / 12));
      if (y < 0.42) break;
      G.box(0.052, 0.0015, 0.0012, 0, y, top + 0.0045, fret);
      if ([3, 5, 7, 9, 12, 15].includes(n)) G.geo(new THREE.CircleGeometry(0.0035, 8), cream, 0, y + scale * 0.02, top + 0.0042);
    }
    G.box(0.054, 0.006, 0.008, 0, nut, top, cream);
    const head = new Frame(b, G.m.clone().multiply(matrix(0, nut, top - 0.012, -0.22)));
    head.box(0.085, 0.18, 0.018, 0, 0.004, 0, neckM, 0.008);
    head.box(0.08, 0.17, 0.002, 0, 0.008, 0.009, dark);
    for (const sx of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const y = 0.05 + i * 0.045;
        head.geo(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6).rotateZ(Math.PI / 2), fret, sx * 0.055, y, -0.004);
        head.box(0.012, 0.016, 0.006, sx * 0.075, y - 0.008, -0.004, cream, 0.002);
        head.geo(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 8).rotateX(Math.PI / 2), fret, sx * 0.025, y, 0.011);
      }
    // six strings from the bridge to the nut
    for (let i = 0; i < 6; i++) {
      const x0 = (i - 2.5) * 0.0095;
      const x1 = (i - 2.5) * 0.0072;
      G.rod(v(x0, 0.128, top + 0.01), v(x1, nut, top + 0.0095), 0.0006, fret, 3);
    }
    // the stand: three legs from a hub, padded arms under the body, a post up to the neck yoke
    const hub = v(0, 0.26, -0.1);
    const rubber = mat("#1b1c1f", { roughness: 1 });
    const feet = [v(-w * 0.4, 0.012, d * 0.36), v(w * 0.4, 0.012, d * 0.36), v(0, 0.012, -d * 0.45)];
    for (const p of feet) {
      F.rod(hub, p, 0.009, a, 6);
      F.sphere(0.014, p.x, 0.01, p.z, rubber, 1, 0.7, 1, 8);
    }
    const rest = at(0.1, 0.0, 0.0);
    for (const sx of [-1, 1]) {
      const e = v(sx * rest.x, rest.y - 0.012, rest.z + 0.02);
      F.rod(hub, e, 0.008, a, 6);
      F.rod(e, v(e.x, e.y + 0.05, e.z + 0.04), 0.008, a, 6);
      F.rod(v(e.x, e.y - 0.003, e.z - 0.02), v(e.x, e.y + 0.03, e.z + 0.03), 0.013, rubber, 8);
    }
    const yoke = at(0, 0.8, top - 0.04);
    F.rod(hub, yoke, 0.01, a, 8);
    F.rod(v(-0.035, yoke.y, yoke.z), v(0.035, yoke.y, yoke.z), 0.008, a, 6);
    for (const sx of [-1, 1]) F.rod(v(sx * 0.035, yoke.y, yoke.z), v(sx * 0.035, yoke.y + 0.01, yoke.z + 0.06), 0.011, rubber, 8);
  },

  keyboard_stand: (b, w, d, h, f, _c, a) => {
    // a stage piano on a double-braced X stand
    const F = world(b);
    const kd = Math.min(0.34, d * 0.85);
    const y0 = h - 0.1;
    const panelD = kd - 0.16;
    const keyD = 0.15;
    F.box(w, 0.065, kd, 0, y0, 0, f, 0.012);
    F.box(w, 0.1, panelD, 0, y0, -kd / 2 + panelD / 2, f, 0.015);
    for (const s of [-1, 1]) F.box(0.05, 0.088, kd - panelD, s * (w / 2 - 0.025), y0, kd / 2 - (kd - panelD) / 2, f, 0.012);
    F.box(w - 0.1, 0.03, 0.012, 0, y0 + 0.06, kd / 2 - 0.16 + 0.006, mat("#141414", { roughness: 1 }));
    // the keys: white ones with gaps, black ones in twos and threes
    const kw = w - 0.1;
    const white = Math.max(14, Math.round(kw / 0.0235));
    const kx = kw / white;
    const kz = kd / 2 - 0.004 - keyD / 2;
    F.box(kw, 0.022, keyD, 0, y0 + 0.065, kz, mat("#f6f4ee", { roughness: 0.4 }));
    const gap = mat("#9d9a93", { roughness: 0.6 });
    const ebony = mat("#141414", { roughness: 0.35 });
    for (let i = 0; i < white - 1; i++) {
      const x = -kw / 2 + kx * (i + 1);
      F.box(0.0012, 0.0225, keyD, x, y0 + 0.065, kz, gap);
      if ([0, 1, 3, 4, 5].includes(i % 7)) F.box(kx * 0.55, 0.014, 0.095, x, y0 + 0.087, kz - (keyD - 0.095) / 2, ebony, 0);
    }
    // the panel: a screen, knobs, buttons and speaker grilles
    const pz = -kd / 2 + panelD / 2;
    F.box(w * 0.16, 0.003, panelD * 0.5, -w * 0.12, h, pz, mat(C.screen, { emissive: "#2a4a6a", emissiveIntensity: 0.3 }));
    const knob = mat("#2a2b2e", { roughness: 0.5 });
    for (let i = 0; i < 5; i++) F.cyl(0.011, 0.012, 0.014, -w * 0.32 + i * 0.035, h, pz, knob, 12);
    for (let i = 0; i < 8; i++) F.box(0.02, 0.006, 0.014, w * 0.04 + i * 0.03, h, pz + (i % 2 ? 0.012 : -0.012), mat(i === 3 ? "#d23a2a" : "#6f7378", { roughness: 0.5 }), 0);
    const grille = mat("#1a1a1c", { roughness: 1 });
    for (const s of [-1, 1]) F.box(0.13, 0.002, panelD * 0.62, s * (w / 2 - 0.12), h, pz, grille, 0);
    // the X stand: two crossed pairs of tubes, arms under the piano, feet on the floor, the pivot knob
    const xs = Math.min(0.36, w * 0.27);
    const yT = y0 - 0.017;
    const rubber = mat("#1b1c1f", { roughness: 1 });
    for (const [from, zz] of [
      [-1, 0.035],
      [1, 0.065],
    ] as const)
      for (const sz of [-1, 1]) F.rod(v(from * xs, 0.025, sz * zz), v(-from * xs, yT, sz * zz), 0.0135, a, 8);
    for (const s of [-1, 1]) {
      const arm = Math.min(kd, d) * 0.92;
      F.rod(v(s * xs, yT, -arm / 2), v(s * xs, yT, arm / 2), 0.0125, a, 8);
      F.rod(v(s * xs, 0.016, -d / 2 + 0.01), v(s * xs, 0.016, d / 2 - 0.01), 0.014, a, 8);
      for (const sz of [-1, 1]) {
        F.geo(new THREE.CylinderGeometry(0.016, 0.016, 0.035, 10).rotateX(Math.PI / 2), rubber, s * xs, yT, sz * (arm / 2 - 0.015));
        F.geo(new THREE.CylinderGeometry(0.017, 0.017, 0.035, 10).rotateX(Math.PI / 2), rubber, s * xs, 0.017, sz * (d / 2 - 0.025));
      }
    }
    const pivotY = (0.025 + yT) / 2;
    F.geo(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 8).rotateX(Math.PI / 2), mat(C.steel, { metalness: 0.7, roughness: 0.3 }), 0, pivotY, 0);
    F.geo(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 12).rotateX(Math.PI / 2), mat(C.black, { roughness: 0.5 }), 0, pivotY, 0.09);
  },

  dog_bed: (b, w, d, h, f) => {
    // an oval bed: a soft base, a round bolster dipping low at the front, a loose cushion
    const F = world(b);
    const A = w / 2;
    const B = d / 2;
    const baseH = Math.min(0.05, h * 0.22);
    const rb = Math.min(0.11, (h - baseH) * 0.62, d * 0.17);
    F.geo(
      lathe(
        [
          [0.001, 0],
          [0.97, 0],
          [1, 0.25],
          [0.99, 0.75],
          [0.95, 1],
          [0.001, 1],
        ],
        40,
      ).scale(A - rb * 0.6, baseH, B - rb * 0.6),
      f,
    );
    // the bolster: a tube round an ellipse, lower and thinner at the front entry
    const ax = A - rb;
    const bz = B - rb;
    const U = 56;
    const V = 12;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= U; i++) {
      const u = -Math.PI / 2 + (i / U) * Math.PI * 2;
      const dip = Math.pow(Math.max(0, Math.sin(u)), 2);
      const r = rb * (1 - 0.5 * dip);
      const yc = h - rb - dip * (h - rb - r - baseH * 0.3);
      const n = v(Math.cos(u) / ax, 0, Math.sin(u) / bz).normalize();
      for (let j = 0; j <= V; j++) {
        const t = (j / V) * Math.PI * 2;
        const dir = n.clone().multiplyScalar(Math.cos(t)).add(v(0, Math.sin(t), 0));
        pos.push(ax * Math.cos(u) + dir.x * r, yc + dir.y * r, bz * Math.sin(u) + dir.z * r);
        nor.push(dir.x, dir.y, dir.z);
        uv.push((i / U) * (A + B) * 3.2, (j / V) * rb * 6.3);
      }
    }
    for (let i = 0; i < U; i++)
      for (let j = 0; j < V; j++) {
        const p = i * (V + 1) + j;
        const q = (i + 1) * (V + 1) + j;
        idx.push(p, p + 1, q, q, p + 1, q + 1);
      }
    const tube = new THREE.BufferGeometry();
    tube.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    tube.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    tube.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    tube.setIndex(idx);
    F.geo(tube, f);
    // the cushion inside, in a light linen, and a toy bone on it
    const cushion = mat(C.linen, { roughness: 1 });
    const cy = baseH;
    const ch = Math.max(0.03, Math.min(0.07, (h - baseH) * 0.45));
    F.geo(
      lathe(
        [
          [0.001, 0],
          [0.92, 0],
          [1, 0.3],
          [0.96, 0.75],
          [0.82, 1],
          [0.001, 1],
        ],
        32,
      ).scale(ax - rb * 0.55, ch, bz - rb * 0.55),
      cushion,
      0,
      cy,
      0,
    );
    const bone = mat("#efe6d2", { roughness: 0.8 });
    const bx = A * 0.25;
    const bzp = B * 0.15;
    const by = cy + ch + 0.012;
    F.rod(v(bx - 0.05, by, bzp - 0.02), v(bx + 0.05, by, bzp + 0.02), 0.009, bone, 8);
    for (const s of [-1, 1])
      for (const t of [-1, 1]) F.sphere(0.012, bx + s * 0.055 + t * 0.006, by, bzp + s * 0.022 - t * 0.012, bone, 1, 1, 1, 8);
  },

  pet_bowls: (b, w, d, h, f) => {
    // two bowls on a rubber mat: dry food in one, water in the other
    const F = world(b);
    const t = 0.004;
    F.geo(slab(roundedRect(w, d, Math.min(0.04, d * 0.25)), t, 4), mat("#5d636b", { roughness: 1 }));
    const r = Math.min(0.085, d * 0.47, w * 0.24);
    const hb = h - t;
    const inner = (y: number) => r * 0.76 + ((r * 0.94 - r * 0.76) * (y - 0.012)) / (hb * 0.96 - 0.012);
    const bowl = lathe(
      [
        [0.001, 0],
        [r * 0.78, 0],
        [r * 0.8, 0.006],
        [r * 0.97, hb * 0.85],
        [r * 1.02, hb * 0.97],
        [r, hb],
        [r * 0.94, hb * 0.96],
        [r * 0.76, 0.012],
        [r * 0.6, 0.008],
        [0.001, 0.008],
      ],
      24,
    );
    const rand = random(17);
    const food = [mat("#8a5a3a", { roughness: 1 }), mat("#6e4429", { roughness: 1 }), mat("#a0703f", { roughness: 1 })];
    for (const sx of [-1, 1]) {
      const x = sx * w * 0.25;
      F.geo(bowl.clone(), f, x, t, 0);
      if (sx < 0) {
        const y = hb * 0.5;
        F.disc(inner(y), x, t + y, 0, food[1], 20);
        for (let i = 0; i < 11; i++) {
          const a = rand() * Math.PI * 2;
          const rr = Math.sqrt(rand()) * inner(y) * 0.8;
          F.sphere(0.008, x + Math.cos(a) * rr, t + y + 0.002, Math.sin(a) * rr, food[i % 3], 1, 0.7, 1, 5);
        }
      } else F.disc(inner(hb * 0.7), x, t + hb * 0.7, 0, mat("#7fc7f0", { roughness: 0.1 }), 24);
    }
  },
};
