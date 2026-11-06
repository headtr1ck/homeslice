// Built-in pieces added later: outdoor new. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINISHES } from "../../model/modern";
import { C, glowing, ledMat, mat, matrix, part, random, roundedRect, wickerMat, type Build, type Builder } from "../modern";

type P = [number, number];
type M = THREE.Material;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Smooth normals across a sphere's seam: its doubled vertices merged first. */
function smooth(geo: THREE.BufferGeometry) {
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  const g = mergeVertices(geo, 1e-5);
  g.computeVertexNormals();
  return g;
}

// ----- helpers -----

/** A box from its bottom centre; small roundings are cut to save triangles. */
function box(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, r = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const geo = rr >= 0.012 ? new RoundedBoxGeometry(w, h, d, rr >= 0.05 ? 2 : 1, rr) : new THREE.BoxGeometry(w, h, d);
  return b.add(geo, m, x, y + h / 2, z);
}

/** A closed outline through corners (z, y), each rounded by its radius (0: sharp). */
function rounded(shape: THREE.Shape, pts: P[], radii: number[]) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    const r = radii[i];
    if (r <= 0) {
      if (i === 0) shape.moveTo(c[0], c[1]);
      else shape.lineTo(c[0], c[1]);
      continue;
    }
    const toward = (q: P): P => {
      const dz = q[0] - c[0];
      const dy = q[1] - c[1];
      const len = Math.hypot(dz, dy) || 1;
      const rr = Math.min(r, len * 0.45);
      return [c[0] + (dz / len) * rr, c[1] + (dy / len) * rr];
    };
    const a = toward(pts[(i + n - 1) % n]);
    const e = toward(pts[(i + 1) % n]);
    if (i === 0) shape.moveTo(a[0], a[1]);
    else shape.lineTo(a[0], a[1]);
    shape.quadraticCurveTo(c[0], c[1], e[0], e[1]);
  }
  return shape;
}
const outline = (pts: P[], radii: number[]) => rounded(new THREE.Shape(), pts, radii);
/** A rounded rectangle in (z, y). */
const rrect = (z0: number, y0: number, z1: number, y1: number, r: number) =>
  outline(
    [
      [z0, y0],
      [z1, y0],
      [z1, y1],
      [z0, y1],
    ],
    [r, r, r, r],
  );

/**
 * Cuts wheel arches into an outline that runs along its bottom (at yB) from the front to
 * the back after its last corner: each arch a circle of radius R around (zc, yc).
 */
function arches(shape: THREE.Shape, yB: number, list: { zc: number; yc: number; R: number }[], zEnd: number) {
  for (const { zc, yc, R } of [...list].sort((a, c) => c.zc - a.zc)) {
    const phi = Math.asin(Math.max(-1, Math.min(1, (yc - yB) / R)));
    shape.lineTo(zc + R * Math.cos(phi), yB);
    shape.absarc(zc, yc, R, -phi, Math.PI + phi, false);
  }
  shape.lineTo(zEnd, yB);
  return shape;
}

/** A (z, y) outline extruded across x, centred, `width` wide, its edges rounded by `bev` (outline inset by bev). */
function across(shape: THREE.Shape, width: number, bev: number, curve = 6, segs = 3) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, width - 2 * bev),
    bevelEnabled: bev > 0,
    bevelSize: bev,
    bevelThickness: bev,
    bevelSegments: segs,
    curveSegments: curve,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2 - bev, 0, 0);
  return geo;
}

/** A flat panel from a (z, y) outline, `t` thick, out of the sides at |x| = x0 (which: 1 right, −1 left, 0 both). */
function sides(b: Builder, shape: THREE.Shape, x0: number, t: number, m: M, which: 0 | 1 | -1 = 0, fx: (g: THREE.BufferGeometry) => THREE.BufferGeometry = (g) => g, curve = 4) {
  // sunk a little into what it lies on: no faces in one plane with it
  const sink = 0.004;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t + sink, bevelEnabled: false, curveSegments: curve });
  geo.rotateY(-Math.PI / 2);
  if (which >= 0) b.add(fx(geo.clone().translate(x0 + t, 0, 0)), m);
  if (which <= 0) b.add(fx(geo.translate(-x0 + sink, 0, 0)), m);
}

/** A square bar from a to c. */
function beam(b: Builder, a: THREE.Vector3, c: THREE.Vector3, s: number, m: M, s2 = s) {
  const mesh = b.add(new THREE.BoxGeometry(s, a.distanceTo(c), s2), m);
  mesh.position.copy(a).add(c).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), c.clone().sub(a).normalize());
  return mesh;
}

/** A box geometry w (x) × t (along n) × len (across), centred at c; n in the z-y plane as (z, y). */
function slab(w: number, t: number, len: number, c: THREE.Vector3, n: P) {
  const ax = V(1, 0, 0);
  const ay = V(0, n[1], n[0]);
  return new THREE.BoxGeometry(w, t, len).applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, new THREE.Vector3().crossVectors(ax, ay)).setPosition(c));
}

interface WheelLook {
  tyre: M;
  rim: M;
  dark: M;
}
/** A wheel with its axle along x at (x, y, z): a rounded tyre, a rim with spokes, a cap; sx: the side facing out. */
function wheel(b: Builder, x: number, y: number, z: number, r: number, tw: number, sx: number, look: WheelLook, spokes = 6, rimF = 0.64) {
  const prof: P[] = [
    [rimF - 0.02, -0.42],
    [0.8, -0.5],
    [0.93, -0.48],
    [0.985, -0.42],
    [1, -0.3],
    [1, 0.3],
    [0.985, 0.42],
    [0.93, 0.48],
    [0.8, 0.5],
    [rimF - 0.02, 0.42],
  ];
  b.add(new THREE.LatheGeometry(prof.map(([q, a]) => new THREE.Vector2(q * r, a * tw)), 24).rotateZ(Math.PI / 2), look.tyre, x, y, z);
  const rr = r * rimF;
  b.add(new THREE.CylinderGeometry(rr, rr, tw * 0.86, 18).rotateZ(Math.PI / 2), look.dark, x, y, z);
  const face = x + sx * tw * 0.43;
  b.add(new THREE.TorusGeometry(rr * 0.95, Math.max(0.01, r * 0.04), 4, 24).rotateY(Math.PI / 2), look.rim, face + sx * 0.004, y, z);
  const spoke = new THREE.BoxGeometry(0.024, rr * 0.78, rr * 0.24);
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    b.add(spoke, look.rim, face + sx * 0.008, y + Math.cos(a) * rr * 0.5, z + Math.sin(a) * rr * 0.5).rotation.x = a;
  }
  b.add(new THREE.CylinderGeometry(rr * 0.26, rr * 0.3, 0.04, 14).rotateZ(Math.PI / 2), look.rim, face + sx * 0.014, y, z);
}

/** A white EU number plate with its blue band, from its bottom, facing +z (dir 1) or −z (dir −1). */
function plate(b: Builder, pw: number, y: number, z: number, dir: 1 | -1) {
  const ph = pw * 0.21;
  box(b, pw, ph, 0.012, 0, y, z, mat("#f1f1ec", { roughness: 0.5 }));
  box(b, pw * 0.08, ph * 0.88, 0.004, -dir * (pw / 2 - pw * 0.05), y + ph * 0.06, z + dir * 0.007, mat("#2a4c9c", { roughness: 0.5 }));
  box(b, pw * 0.66, ph * 0.45, 0.003, dir * pw * 0.05, y + ph * 0.28, z + dir * 0.007, mat("#141517", { roughness: 0.9 }));
}

/** Lights shared by the vehicles. */
function lamps() {
  return {
    head: mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.35, roughness: 0.2 }),
    drl: mat("#ffffff", { emissive: "#eef6ff", emissiveIntensity: 0.8, roughness: 0.2 }),
    amber: mat("#d98a1e", { emissive: "#8a4a00", emissiveIntensity: 0.3, roughness: 0.3 }),
    tail: mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.45, roughness: 0.3 }),
    reverse: mat("#e9e6e0", { roughness: 0.25 }),
  };
}

// ----- vehicles -----

/**
 * A modern crew-cab pickup along z (front at +z): a tall cab with a tumblehome glasshouse,
 * four doors, a long flat bonnet with a big chrome-framed grille, black wheel-arch flares,
 * side steps, an open load bed with lined floor, wheel tubs and a tailgate, tall rear lights.
 */
function pickup(b: Builder, w: number, d: number, h: number, color: string) {
  const paint = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.35, metalness: 0.3 });
  const trim = mat("#1d1f22", { roughness: 0.85 });
  const gloss = mat("#0c0d0f", { roughness: 0.2, metalness: 0.3 });
  const band = mat("#111214", { roughness: 0.35, metalness: 0.2 });
  const glassM = mat("#2b3944", { roughness: 0.06, metalness: 0.6 });
  const seam = mat("#141517", { roughness: 0.9 });
  const chrome = mat(C.chrome, { metalness: 0.85, roughness: 0.2 });
  const satin = mat(C.steel, { metalness: 0.6, roughness: 0.35 });
  const liner = mat("#121315", { roughness: 0.95, side: THREE.DoubleSide });
  const bedLiner = mat("#26272a", { roughness: 0.95 });
  const L = lamps();

  const Z = (t: number) => -d / 2 + t * d;
  const BW = w * 0.9;
  const hw = BW / 2;
  const bev = Math.min(0.05, h * 0.03, BW * 0.03);
  const r = Math.min(0.42, h * 0.215, d * 0.078);
  const ra = r * 1.1 + 0.04;
  const wz = [Z(0.2), Z(0.815)];
  const y0 = h * 0.24;
  const roofY = h;
  const belt = h * 0.645;
  const zCB = Z(0.43);
  const zB = Z(0.585);
  const zWF = Z(0.745);
  const zWT = Z(0.64);
  const zN = d / 2 - Math.min(0.1, d * 0.02);
  const yNose = belt - h * 0.015;
  // the glasshouse leans in (tumblehome): x shrinks above the belt
  const lean = 0.1;
  const taper = (geo: THREE.BufferGeometry) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > belt) p.setX(i, p.getX(i) * (1 - lean * Math.min(1, (y - belt) / (roofY - belt))));
    }
    return geo;
  };

  // ----- the cab: a side profile across, rounded edges, the front arch cut -----
  const cab = outline(
    [
      [zCB + bev, y0 + bev],
      [zCB + bev, roofY - bev],
      [zWT, roofY - bev],
      [zWF, belt],
      [zN - bev, yNose - bev],
      [zN - bev, y0 + bev],
    ],
    [0, 0.07, 0.16, 0.08, 0.07, 0],
  );
  arches(cab, y0 + bev, [{ zc: wz[1], yc: r, R: ra + bev }], zCB + bev);
  b.add(taper(across(cab, BW, bev, 6, 3)), paint);

  // ----- the load bed: side walls with the rear arch, rail caps, lined floor, tubs, tailgate -----
  const t = Math.min(0.07, BW * 0.04);
  const zBR = -d / 2 + Math.min(0.1, d * 0.02);
  const zBF = zCB - 0.03;
  const yFloor = h * 0.45;
  const wall = new THREE.Shape();
  wall.moveTo(zBR, y0);
  wall.lineTo(zBR, belt);
  wall.lineTo(zBF, belt);
  wall.lineTo(zBF, y0);
  arches(wall, y0, [{ zc: wz[0], yc: r, R: ra }], zBR);
  sides(b, wall, hw - t, t, paint, 0, undefined, 8);
  const bm = (zBR + zBF) / 2;
  const bl = zBF - zBR;
  for (const sx of [-1, 1]) {
    box(b, t + 0.03, 0.035, bl, sx * (hw - t / 2), belt, bm, trim, 0.012);
    box(b, 0.01, belt - yFloor - 0.01, bl - 0.02, sx * (hw - t - 0.005), yFloor, bm, bedLiner);
    const tubH = r + ra + 0.04 - yFloor;
    box(b, 0.24, tubH, 2 * ra * 0.9, sx * (hw - t - 0.12), yFloor, wz[0], bedLiner, 0.05);
  }
  box(b, BW - 2 * t, 0.03, bl, 0, yFloor - 0.03, bm, bedLiner);
  // ribs in the floor
  for (let i = -3; i <= 3; i++) box(b, 0.035, 0.012, bl - 0.06, i * (BW - 2 * t) * 0.13, yFloor, bm, trim);
  box(b, BW - 2 * t, belt - yFloor, 0.04, 0, yFloor, zBF - 0.02, paint);
  box(b, BW - 2 * t - 0.4, yFloor - y0 - 0.06, bl - 0.2, 0, y0 + 0.02, bm, trim);
  // the tailgate: a recessed handle, a cap along its top
  const tgY = y0 + 0.08;
  box(b, BW - 2 * t - 0.01, belt - tgY, 0.06, 0, tgY, zBR + 0.03, paint, 0.012);
  box(b, BW - 2 * t, 0.025, 0.07, 0, belt, zBR + 0.03, trim, 0.008);
  box(b, 0.26, 0.06, 0.012, 0, belt - 0.13, zBR - 0.002, trim, 0.006);
  box(b, BW * 0.5, 0.012, 0.006, 0, belt - 0.24, zBR - 0.001, seam);
  for (const sx of [-1, 1]) {
    // tall rear lights in the walls' ends
    const lh = h * 0.21;
    box(b, t + 0.012, lh * 0.7, 0.03, sx * (hw - t / 2), belt - 0.04 - lh * 0.7, zBR - 0.008, L.tail, 0.008);
    box(b, t + 0.012, lh * 0.18, 0.03, sx * (hw - t / 2), belt - 0.05 - lh, zBR - 0.008, L.reverse, 0.006);
    box(b, t + 0.012, lh * 0.1, 0.03, sx * (hw - t / 2), belt - 0.045 - lh * 0.8, zBR - 0.008, L.amber, 0.004);
  }
  // the rear step bumper, the plate, the hitch
  const rbH = h * 0.1;
  box(b, BW + 0.02, rbH, 0.17, 0, y0 - h * 0.05, -d / 2 + 0.085, satin, 0.03);
  box(b, BW * 0.5, 0.008, 0.11, 0, y0 - h * 0.05 + rbH, -d / 2 + 0.09, trim);
  plate(b, Math.min(0.52, w * 0.26), y0 - h * 0.05 + 0.012, -d / 2 + 0.002, -1);
  box(b, 0.07, 0.07, 0.2, 0, y0 - h * 0.05 - 0.06, -d / 2 + 0.12, trim);

  // ----- arches: dark liners, black flares -----
  for (const zc of wz) {
    const pl = Math.asin(Math.max(-1, Math.min(1, (r - y0) / (ra - 0.01))));
    b.add(new THREE.CylinderGeometry(ra - 0.01, ra - 0.01, BW - 0.08, 16, 1, true, -pl, Math.PI + 2 * pl).rotateZ(Math.PI / 2), liner, 0, r, zc);
    const p2 = Math.asin(Math.max(-1, Math.min(1, (r - y0 + 0.02) / ra)));
    const flare = new THREE.TorusGeometry(ra + 0.02, 0.04, 5, 20, Math.PI + 2 * p2).rotateZ(-p2).rotateY(Math.PI / 2);
    for (const sx of [-1, 1]) b.add(flare, mat("#1d1f22", { roughness: 0.85, side: THREE.DoubleSide }), sx * (hw - 0.008), r, zc);
  }

  // ----- the glasshouse: a black band, separate door windows, the windscreen, the rear window -----
  const g0 = belt + 0.045;
  const g1 = roofY - Math.min(0.12, h * 0.065);
  const slope = (zWT - zWF) / (roofY - bev - belt);
  const aLine = (y: number, back: number) => zWF + (y - belt) * slope - back;
  const gp = 0.035;
  sides(b, outline([[zCB + 0.07, g0 - 0.012], [zCB + 0.07, g1 + 0.012], [aLine(g1 + 0.012, 0.07), g1 + 0.012], [aLine(g0 - 0.012, 0.07), g0 - 0.012]], [0.02, 0.04, 0.04, 0.02]), hw - 0.002, 0.008, band, 0, taper);
  for (const pane of [
    [[zCB + 0.1, g0], [zCB + 0.1, g1], [zB - gp, g1], [zB - gp, g0]],
    [[zB + gp, g0], [zB + gp, g1], [aLine(g1, 0.11), g1], [aLine(g0, 0.11), g0]],
  ] as P[][])
    sides(b, outline(pane, [0.02, 0.03, 0.03, 0.02]), hw + 0.006, 0.004, glassM, 0, taper);
  // the windscreen along its slope
  const foot: P = [zWF, belt];
  const tip: P = [zWT, roofY - bev];
  const ul = Math.hypot(tip[0] - foot[0], tip[1] - foot[1]);
  const u: P = [(tip[0] - foot[0]) / ul, (tip[1] - foot[1]) / ul];
  const n: P = [u[1], -u[0]];
  const at = (s: number, out: number) => V(0, foot[1] + u[1] * s + n[1] * out, foot[0] + u[0] * s + n[0] * out);
  b.add(taper(slab(BW - 0.05, 0.012, ul - 0.04, at(ul / 2, bev - 0.002), n)), band);
  b.add(taper(slab(BW - 0.2, 0.01, ul - 0.16, at(ul / 2 + 0.01, bev + 0.004), n)), glassM);
  for (const x of [-0.42, 0.02]) b.rod(at(0.06, bev + 0.016).setX(x * BW), at(0.12, bev + 0.016).setX((x + 0.36) * BW), 0.008, trim, 5);
  // the rear window with its sliding middle pane
  b.add(taper(new THREE.BoxGeometry(BW - 0.28, g1 - g0, 0.012).translate(0, (g0 + g1) / 2, zCB - 0.004)), band);
  b.add(taper(new THREE.BoxGeometry(BW - 0.36, g1 - g0 - 0.06, 0.01).translate(0, (g0 + g1) / 2, zCB - 0.01)), glassM);
  for (const sx of [-1, 1]) b.add(taper(new THREE.BoxGeometry(0.02, g1 - g0 - 0.06, 0.006).translate(sx * BW * 0.13, (g0 + g1) / 2, zCB - 0.016)), band);
  // the third brake light, roof marker lights
  box(b, 0.3, 0.025, 0.012, 0, g1 + 0.02, zCB - 0.006, L.tail, 0.006);
  for (const x of [-0.25, 0, 0.25]) box(b, 0.07, 0.02, 0.035, x * BW * 0.9, roofY - 0.012, zWT - 0.05, L.amber, 0.008);

  // ----- the front: grille, headlights, bumper, skid plate, plate -----
  const gw = BW * 0.6;
  const yG0 = y0 + h * 0.1;
  const gh = yNose - 0.05 - yG0;
  box(b, gw + 0.05, gh + 0.05, 0.04, 0, yG0 - 0.025, zN - 0.025, chrome, 0.03);
  box(b, gw, gh, 0.05, 0, yG0, zN - 0.022, gloss, 0.02);
  for (let i = 1; i <= 3; i++) box(b, gw - 0.04, 0.032, 0.02, 0, yG0 + (gh * i) / 4 - 0.016, zN + 0.008, chrome, 0.01);
  box(b, 0.04, gh - 0.04, 0.02, 0, yG0 + 0.02, zN + 0.008, chrome, 0.01);
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 20).rotateX(Math.PI / 2), chrome, 0, yG0 + gh * 0.5, zN + 0.022);
  const lw = hw - gw / 2 - 0.07;
  const lh = h * 0.08;
  for (const sx of [-1, 1]) {
    const lx = sx * (gw / 2 + 0.035 + lw / 2);
    box(b, lw, lh, 0.05, lx, yNose - 0.045 - lh, zN - 0.025, gloss, 0.015);
    box(b, lw * 0.55, lh * 0.55, 0.02, lx - sx * lw * 0.12, yNose - 0.045 - lh * 0.8, zN + 0.002, L.head, 0.008);
    box(b, lw - 0.03, 0.018, 0.02, lx, yNose - 0.045 - lh + 0.012, zN + 0.004, L.drl, 0.006);
    box(b, 0.018, lh - 0.03, 0.02, lx + sx * (lw / 2 - 0.02), yNose - 0.045 - lh + 0.012, zN + 0.004, L.drl, 0.006);
    box(b, lw * 0.22, lh * 0.3, 0.02, lx + sx * lw * 0.28, yNose - 0.045 - lh * 0.55, zN + 0.002, L.amber, 0.006);
  }
  const bd = d / 2 - zN + 0.08;
  box(b, BW + 0.03, h * 0.12, bd, 0, y0 - h * 0.03, d / 2 - bd / 2, paint, 0.04);
  box(b, BW - 0.06, h * 0.075, bd - 0.05, 0, y0 - h * 0.1, d / 2 - bd / 2 - 0.02, trim, 0.025);
  box(b, BW * 0.5, h * 0.03, bd - 0.02, 0, y0 - h * 0.11, d / 2 - bd / 2 - 0.01, satin, 0.01);
  for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 14).rotateX(Math.PI / 2), L.head, sx * BW * 0.36, y0 - h * 0.065, d / 2 - 0.02);
    box(b, 0.05, 0.06, 0.03, sx * BW * 0.22, y0 - h * 0.09, d / 2 - 0.012, mat("#a8322d", { roughness: 0.5 }), 0.01);
  }
  plate(b, Math.min(0.52, w * 0.26), y0 - h * 0.015, d / 2 + 0.004, 1);

  // ----- the sides: door seams and handles, side steps, mirrors -----
  const zFD = wz[1] - ra - 0.05;
  const zRD = zCB + 0.09;
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.001);
    for (const z of [zB, zFD, zRD]) box(b, 0.004, belt - y0 - 0.06, 0.008, x, y0 + 0.06, z, seam);
    box(b, 0.004, 0.008, zFD - zRD, x, y0 + 0.06, (zFD + zRD) / 2, seam);
    for (const z of [zB - 0.14, zCB + 0.24]) {
      box(b, 0.012, 0.045, 0.17, sx * (hw + 0.004), belt - 0.15, z, seam, 0.004);
      box(b, 0.02, 0.03, 0.15, sx * (hw + 0.008), belt - 0.143, z, chrome, 0.008);
    }
    // a running board between the arches on two brackets
    const s0 = wz[0] + ra + 0.06;
    const s1 = wz[1] - ra - 0.04;
    box(b, 0.12, 0.04, s1 - s0, sx * hw, y0 - 0.12, (s0 + s1) / 2, trim, 0.012);
    for (const z of [s0 + 0.3, s1 - 0.3]) box(b, 0.04, 0.09, 0.05, sx * (hw - 0.04), y0 - 0.09, z, trim);
    // the mirror on its arm, the glass facing back, the indicator
    const mz = zWF - 0.14;
    const reach = w / 2 - hw;
    const mw = Math.min(0.12, reach + 0.04);
    box(b, reach + 0.02, 0.04, 0.07, sx * (hw + reach / 2 - 0.01), belt + 0.03, mz, trim, 0.012);
    box(b, mw, 0.24, 0.11, sx * (w / 2 - mw / 2), belt + 0.04, mz, trim, 0.035);
    box(b, mw - 0.02, 0.2, 0.01, sx * (w / 2 - mw / 2), belt + 0.06, mz - 0.056, glassM, 0.004);
    box(b, mw * 0.7, 0.025, 0.02, sx * (w / 2 - mw / 2 - 0.005), belt + 0.2, mz + 0.05, L.amber, 0.008);
  }
  // a shoulder crease along the cab and the bed
  sides(b, rrect(zBR + 0.01, belt - 0.16, zWF - 0.25, belt - 0.13, 0.012), hw, 0.006, paint);
  // the dark underside, so the body doesn't float
  box(b, BW - 0.3, y0 - r * 0.55, d * 0.82, 0, r * 0.55, 0, trim);

  // ----- wheels: chunky tyres, six-spoke rims -----
  const tw = Math.min(0.27, w * 0.13);
  const look = { tyre: mat("#1b1c1e", { roughness: 0.92 }), rim: mat("#9a9ea3", { metalness: 0.65, roughness: 0.3 }), dark: mat("#2a2c30", { roughness: 0.6 }) };
  for (const zc of wz) for (const sx of [-1, 1]) wheel(b, sx * (hw - tw / 2 + 0.01), r, zc, r, tw, sx, look, 6, 0.6);
}

/**
 * A touring caravan along z, drawbar at +z: a rounded body with a sloped front window,
 * framed tinted windows, a door with its own window on the kerb side, decor stripes, a
 * roof with vents, one axle under a wheel arch, corner steadies, an A-frame drawbar with
 * its cover, coupling head and jockey wheel, lights at both ends.
 */
function caravan(b: Builder, w: number, d: number, h: number, color: string) {
  const paint = mat(FINISHES[color] ?? FINISHES.white, { roughness: 0.4, metalness: color === "silver" ? 0.35 : 0.05 });
  const frame = mat("#2a2c30", { roughness: 0.6 });
  const win = mat("#2f363c", { roughness: 0.08, metalness: 0.4 });
  const steel = mat("#9aa0a6", { metalness: 0.55, roughness: 0.45 });
  const dark = mat("#1d1f22", { roughness: 0.85 });
  const decor = mat("#5b6470", { roughness: 0.5 });
  const decor2 = mat("#9aa6b4", { roughness: 0.5 });
  const vent = mat("#dfe2e4", { roughness: 0.5 });
  const liner = mat("#121315", { roughness: 0.95, side: THREE.DoubleSide });
  const L = lamps();

  const Lb = d - Math.min(1.25, d * 0.19);
  const zR = -d / 2 + 0.02;
  const zF = zR + Lb;
  const yb = h * 0.13;
  const yt = h - Math.min(0.1, h * 0.04);
  const BW = w - 0.02;
  const hw = BW / 2;
  const bev = Math.min(0.07, h * 0.03);
  const r = Math.min(0.32, h * 0.12);
  const ra = r + 0.07;
  const za = zR + Lb * 0.5;
  const yBreak = yb + (yt - yb) * 0.45;
  const zTop = zF - Math.min(0.5, Lb * 0.09);
  const Zb = (t: number) => zR + t * Lb;

  // ----- the body -----
  const shape = outline(
    [
      [zR + bev, yb + bev],
      [zR + bev, yt - bev],
      [zTop, yt - bev],
      [zF - bev, yBreak],
      [zF - bev, yb + bev],
    ],
    [0, 0.3, 0.3, 0.2, 0.12],
  );
  arches(shape, yb + bev, [{ zc: za, yc: r, R: ra + bev }], zR + bev);
  b.add(across(shape, BW, bev, 8, 3), paint);
  const pl = Math.asin(Math.max(-1, Math.min(1, (r - yb) / ra)));
  b.add(new THREE.CylinderGeometry(ra, ra, BW - 0.08, 16, 1, true, -pl, Math.PI + 2 * pl).rotateZ(Math.PI / 2), liner, 0, r, za);

  // decor stripes along both sides
  sides(b, rrect(Zb(0.03), yb + 0.5, Zb(0.97), yb + 0.58, 0.02), hw, 0.004, decor);
  sides(b, rrect(Zb(0.03), yb + 0.62, Zb(0.9), yb + 0.645, 0.01), hw, 0.004, decor2);
  sides(b, rrect(Zb(0.02), yt - 0.18, Zb(0.95), yt - 0.15, 0.01), hw, 0.004, decor);

  // ----- windows: framed tinted panes; the door on the kerb side (−x) -----
  const wy0 = yb + (yt - yb) * 0.45;
  const wy1 = yb + (yt - yb) * 0.76;
  const window = (z0: number, z1: number, y0: number, y1: number, which: 1 | -1) => {
    sides(b, rrect(z0, y0, z1, y1, 0.07), hw, 0.012, frame, which);
    sides(b, rrect(z0 + 0.035, y0 + 0.035, z1 - 0.035, y1 - 0.035, 0.05), hw + 0.012, 0.004, win, which);
  };
  for (const [a, c] of [[0.04, 0.22], [0.32, 0.43], [0.7, 0.9]]) window(Zb(a), Zb(c), wy0, wy1, 1);
  for (const [a, c] of [[0.04, 0.22], [0.66, 0.74], [0.8, 0.92]]) window(Zb(a), Zb(c), wy0, wy1, -1);
  const zd0 = Zb(0.52);
  const zd1 = Math.min(Zb(0.64), zd0 + 0.62);
  const dTop = yt - 0.3;
  sides(b, rrect(zd0 - 0.012, yb + 0.1, zd1 + 0.012, dTop + 0.012, 0.06), hw, 0.004, frame, -1);
  sides(b, rrect(zd0, yb + 0.112, zd1, dTop, 0.05), hw + 0.004, 0.008, paint, -1);
  sides(b, rrect(zd0 + 0.08, wy0 + 0.1, zd1 - 0.08, dTop - 0.1, 0.05), hw + 0.012, 0.004, win, -1);
  box(b, 0.025, 0.035, 0.12, -(hw + 0.02), yb + (dTop - yb) * 0.47, zd0 + 0.08, steel, 0.01);
  box(b, 0.5, 0.04, 0.22, -(hw - 0.2), yb - 0.17, (zd0 + zd1) / 2, steel, 0.01);
  // awning rail on the door side
  box(b, 0.03, 0.03, Lb * 0.86, -(hw + 0.005), yt - 0.13, Zb(0.48), steel, 0.01);

  // ----- the front: a sloped window, the gas locker, marker lights -----
  const P0: P = [zF, yBreak + 0.02];
  const P1: P = [zTop + 0.04, yt];
  const ul = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
  const u: P = [(P1[0] - P0[0]) / ul, (P1[1] - P0[1]) / ul];
  const n: P = [u[1], -u[0]];
  const at = (s: number, out: number) => V(0, P0[1] + u[1] * s + n[1] * out, P0[0] + u[0] * s + n[0] * out);
  const fl = ul * 0.42;
  b.add(slab(BW * 0.72, 0.012, fl, at(ul * 0.36, -0.004), n), frame);
  b.add(slab(BW * 0.68, 0.01, fl - 0.05, at(ul * 0.36, 0.004), n), win);
  const lockW = BW * 0.5;
  box(b, lockW + 0.024, 0.48, 0.008, 0, yb + 0.1, zF + 0.002, frame, 0.01);
  box(b, lockW, 0.456, 0.008, 0, yb + 0.112, zF + 0.006, paint, 0.01);
  box(b, 0.12, 0.03, 0.012, 0, yb + 0.48, zF + 0.012, steel, 0.006);
  for (const sx of [-1, 1]) {
    box(b, 0.1, 0.04, 0.02, sx * (hw - 0.12), yt - 0.22, zF - 0.06, L.head, 0.008);
    for (const t of [0.2, 0.8]) box(b, 0.012, 0.03, 0.06, sx * (hw + 0.004), yb + 0.3, Zb(t), L.amber, 0.006);
  }

  // ----- the rear: window, light bar with lamps, plate, third brake light -----
  box(b, BW * 0.5, (wy1 - wy0) * 0.8, 0.012, 0, wy0 + 0.05, zR - 0.004, frame, 0.04);
  box(b, BW * 0.5 - 0.06, (wy1 - wy0) * 0.8 - 0.06, 0.01, 0, wy0 + 0.08, zR - 0.01, win, 0.03);
  box(b, BW - 0.04, 0.24, 0.06, 0, yb + 0.04, zR + 0.015, frame, 0.03);
  for (const sx of [-1, 1]) {
    box(b, 0.16, 0.13, 0.02, sx * (hw - 0.16), yb + 0.09, zR - 0.02, L.tail, 0.008);
    box(b, 0.07, 0.13, 0.02, sx * (hw - 0.3), yb + 0.09, zR - 0.02, L.amber, 0.008);
    box(b, 0.05, 0.13, 0.02, sx * (hw - 0.37), yb + 0.09, zR - 0.02, L.reverse, 0.008);
  }
  plate(b, 0.48, yb + 0.07, zR - 0.02, -1);
  box(b, 0.3, 0.03, 0.012, 0, yt - 0.1, zR - 0.004, L.tail, 0.006);

  // ----- the roof: vents and a skylight -----
  box(b, 0.42, Math.min(0.08, h - yt), 0.42, 0, yt - 0.01, za + 0.4, vent, 0.03);
  box(b, 0.32, Math.min(0.06, h - yt), 0.32, 0, yt - 0.01, Zb(0.15), vent, 0.03);
  box(b, 0.7, Math.min(0.07, h - yt), 0.5, 0, yt - 0.01, Zb(0.78), mat("#5d6a74", { roughness: 0.15, metalness: 0.3 }), 0.04);

  // ----- underneath: chassis rails, the axle, corner steadies -----
  for (const sx of [-1, 1]) box(b, 0.08, 0.14, Lb - 0.3, sx * (hw - 0.45), yb - 0.13, (zR + zF) / 2 + 0.1, steel);
  for (const z of [zR + 0.3, zF - 0.35])
    for (const sx of [-1, 1]) {
      b.rod(V(sx * (hw - 0.2), yb, z), V(sx * (hw - 0.25), 0.06, z), 0.02, steel, 6);
      box(b, 0.12, 0.02, 0.12, sx * (hw - 0.25), 0, z, dark);
    }
  const tw = Math.min(0.2, w * 0.09);
  box(b, BW - 0.3, 0.07, 0.07, 0, r - 0.035, za, dark);
  const look = { tyre: mat("#1b1c1e", { roughness: 0.92 }), rim: mat("#c4c8cd", { metalness: 0.7, roughness: 0.3 }), dark: mat("#2a2c30", { roughness: 0.6 }) };
  for (const sx of [-1, 1]) wheel(b, sx * (hw - tw / 2 - 0.05), r, za, r, tw, sx, look, 5, 0.6);

  // ----- the drawbar: A-frame, cover, coupling head with stabiliser, jockey wheel -----
  const yC = Math.min(0.45, h * 0.18);
  const zC = d / 2 - 0.05;
  for (const sx of [-1, 1]) beam(b, V(sx * 0.5, yb - 0.08, zF - 0.6), V(sx * 0.05, yC - 0.06, zC - 0.3), 0.07, steel);
  const cw = Math.min(0.62, BW * 0.3);
  box(b, cw, 0.2, Math.min(0.6, d / 2 - zF - 0.25), 0, yC - 0.1, (zF + zC - 0.3) / 2 + 0.05, paint, 0.08);
  box(b, 0.12, 0.1, 0.28, 0, yC - 0.06, zC - 0.17, frame, 0.02);
  b.sphere(0.055, 0, yC - 0.02, zC - 0.04, frame, 1, 0.8, 1, 12);
  b.rod(V(0, yC + 0.04, zC - 0.2), V(0, yC + 0.12, zC - 0.04), 0.015, mat("#a8322d", { roughness: 0.5 }), 6);
  const jx = 0.16;
  const jz = zC - 0.5;
  b.cyl(0.03, 0.03, yC + 0.2 - 0.12, jx, 0.12, jz, steel, 10);
  b.rod(V(jx, yC + 0.2, jz), V(jx + 0.08, yC + 0.24, jz), 0.01, steel, 6);
  b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14).rotateZ(Math.PI / 2), dark, jx, 0.08, jz + 0.04);
}

/**
 * A semi-integrated motorhome along z (front at +z): the van cab with its bonnet, steep
 * windscreen and doors, a wider box body with a roof cap swept down onto the cab roof and
 * a panoramic skylight in it, framed windows, an entry door, garage hatches, decor, a
 * solar panel and vents on the roof, an awning, rear lights and a bike rack with two bikes.
 */
function motorhome(b: Builder, w: number, d: number, h: number, color: string) {
  const paint = mat(FINISHES[color] ?? FINISHES.white, { roughness: 0.4, metalness: color === "white" ? 0.05 : 0.35 });
  const body = mat(FINISHES[color] ?? FINISHES.white, { roughness: 0.45, metalness: color === "silver" ? 0.35 : 0.05 });
  const frame = mat("#2a2c30", { roughness: 0.6 });
  const win = mat("#2f363c", { roughness: 0.08, metalness: 0.4 });
  const band = mat("#111214", { roughness: 0.35, metalness: 0.2 });
  const glassM = mat("#2b3944", { roughness: 0.06, metalness: 0.6 });
  const trim = mat("#1d1f22", { roughness: 0.85 });
  const gloss = mat("#0c0d0f", { roughness: 0.2, metalness: 0.3 });
  const seam = mat("#141517", { roughness: 0.9 });
  const steel = mat("#9aa0a6", { metalness: 0.55, roughness: 0.45 });
  const decor = mat(color === "anthracite" ? "#b9bdc2" : "#5b6470", { roughness: 0.5 });
  const vent = mat("#dfe2e4", { roughness: 0.5 });
  const liner = mat("#121315", { roughness: 0.95, side: THREE.DoubleSide });
  const L = lamps();

  const Z = (t: number) => -d / 2 + t * d;
  const BW = w - 0.02;
  const hw = BW / 2;
  const CW = Math.min(BW - 0.12, w * 0.89);
  const cw = CW / 2;
  const bev = Math.min(0.07, h * 0.025);
  const r = Math.min(0.37, h * 0.12);
  const ra = r * 1.12 + 0.04;
  const wF = Z(0.86);
  const wR = Z(0.3);
  const yb = h * 0.19;
  const yc0 = h * 0.15;
  const yt = h - Math.min(0.07, h * 0.025);
  const cabRoof = h * 0.73;
  const zBF = Z(0.715);
  const zWT = Z(0.8);
  const zWF = Z(0.9);
  const yWF = h * 0.43;
  const zN = d / 2 - Math.min(0.08, d * 0.012);
  const yNose = h * 0.37;
  const zR = -d / 2 + Math.min(0.3, d * 0.045);

  // ----- the cab -----
  const cab = outline(
    [
      [zBF - 0.12 + bev, yc0 + bev],
      [zBF - 0.12 + bev, cabRoof - bev],
      [zWT, cabRoof - bev],
      [zWF, yWF],
      [zN - bev, yNose - bev],
      [zN - bev, yc0 + bev],
    ],
    [0, 0.05, 0.14, 0.06, 0.12, 0],
  );
  arches(cab, yc0 + bev, [{ zc: wF, yc: r, R: ra + bev }], zBF - 0.12 + bev);
  b.add(across(cab, CW, bev, 6, 3), paint);

  // ----- the box body with the roof cap over the cab -----
  const capFront = zWT + 0.02;
  const shape = outline(
    [
      [zR + bev, yb + bev],
      [zR + bev, yt - bev],
      [Z(0.6), yt - bev],
      [capFront, cabRoof + 0.02 + bev],
      [zBF + bev, cabRoof + bev],
      [zBF + bev, yb + bev],
    ],
    [0, 0.12, 0.9, 0.12, 0, 0],
  );
  arches(shape, yb + bev, [{ zc: wR, yc: r, R: ra + bev }], zR + bev);
  b.add(across(shape, BW, bev, 8, 3), body);
  for (const [zc, y] of [[wF, yc0], [wR, yb]]) {
    const pl = Math.asin(Math.max(-1, Math.min(1, (r - y) / ra)));
    b.add(new THREE.CylinderGeometry(ra, ra, (zc === wF ? CW : BW) - 0.08, 16, 1, true, -pl, Math.PI + 2 * pl).rotateZ(Math.PI / 2), liner, 0, r, zc);
  }
  // the skylight in the cap's slope
  const P0: P = [capFront, cabRoof + 0.02];
  const P1: P = [Z(0.6), yt];
  const ul = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
  const u: P = [(P1[0] - P0[0]) / ul, (P1[1] - P0[1]) / ul];
  const n: P = [u[1], -u[0]];
  const cap = (s: number, out: number) => V(0, P0[1] + u[1] * s + n[1] * out, P0[0] + u[0] * s + n[0] * out);
  b.add(slab(BW * 0.55, 0.012, ul * 0.36, cap(ul * 0.45, bev - 0.002), n), frame);
  b.add(slab(BW * 0.5, 0.01, ul * 0.32, cap(ul * 0.45, bev + 0.006), n), win);

  // ----- body windows, the entry door (−x), garage hatches, decor -----
  const Lb = zBF - zR;
  const Zb = (t: number) => zR + t * Lb;
  const wy0 = yb + (yt - yb) * 0.33;
  const wy1 = yb + (yt - yb) * 0.56;
  const window = (z0: number, z1: number, y0: number, y1: number, which: 1 | -1) => {
    sides(b, rrect(z0, y0, z1, y1, 0.06), hw, 0.012, frame, which);
    sides(b, rrect(z0 + 0.035, y0 + 0.035, z1 - 0.035, y1 - 0.035, 0.04), hw + 0.012, 0.004, win, which);
  };
  for (const [a, c] of [[0.1, 0.26], [0.5, 0.66], [0.78, 0.92]]) window(Zb(a), Zb(c), wy0, wy1, 1);
  for (const [a, c] of [[0.1, 0.26], [0.62, 0.72], [0.82, 0.94]]) window(Zb(a), Zb(c), wy0, wy1, -1);
  const zd0 = Zb(0.36);
  const zd1 = zd0 + Math.min(0.62, Lb * 0.15);
  const dTop = yb + (yt - yb) * 0.66;
  sides(b, rrect(zd0 - 0.012, yb + 0.08, zd1 + 0.012, dTop + 0.012, 0.05), hw, 0.004, frame, -1);
  sides(b, rrect(zd0, yb + 0.092, zd1, dTop, 0.04), hw + 0.004, 0.008, body, -1);
  sides(b, rrect(zd0 + 0.08, wy0 + 0.05, zd1 - 0.08, dTop - 0.08, 0.04), hw + 0.012, 0.004, win, -1);
  box(b, 0.025, 0.035, 0.12, -(hw + 0.02), yb + (dTop - yb) * 0.45, zd0 + 0.08, steel, 0.01);
  box(b, 0.5, 0.04, 0.22, -(hw - 0.2), yb - 0.12, (zd0 + zd1) / 2, steel, 0.01);
  const hatchTop = wy0 - 0.12;
  sides(b, rrect(Zb(0.03), yb + 0.14, Zb(0.24), hatchTop, 0.05), hw, 0.004, frame);
  sides(b, rrect(Zb(0.03) + 0.012, yb + 0.152, Zb(0.24) - 0.012, hatchTop - 0.012, 0.04), hw + 0.004, 0.006, body);
  for (const sx of [-1, 1]) box(b, 0.02, 0.03, 0.1, sx * (hw + 0.014), hatchTop - 0.1, Zb(0.135), steel, 0.008);
  sides(b, rrect(zR + 0.05, yb + 0.06, zBF - 0.05, yb + 0.1, 0.02), hw, 0.004, decor);
  sides(b, rrect(Zb(0.27), wy0 - 0.08, zBF - 0.05, wy0 - 0.05, 0.015), hw, 0.004, decor);
  // the awning cassette along the door side's top
  box(b, 0.1, 0.11, Lb * 0.7, -(hw + 0.0), yt - 0.24, Zb(0.5), mat("#c9ccd0", { roughness: 0.5 }), 0.03);

  // ----- the roof: a solar panel, vents -----
  box(b, 1.0, Math.min(0.04, h - yt), 0.66, 0, yt - 0.005, Zb(0.22), mat("#1f2a44", { roughness: 0.15, metalness: 0.4 }), 0.01);
  for (const t of [0.48, 0.7]) box(b, 0.42, Math.min(0.07, h - yt), 0.42, 0, yt - 0.01, Zb(t), vent, 0.03);

  // ----- the cab's glass, doors and mirrors -----
  const belt = h * 0.45;
  const slope = (zWT - zWF) / (cabRoof - bev - yWF);
  const aLine = (y: number, back: number) => zWF + (y - yWF) * slope - back;
  const g0 = belt + 0.04;
  const g1 = cabRoof - 0.12;
  const zCabBack = zBF - 0.12;
  sides(b, outline([[zCabBack + 0.08, g0 - 0.012], [zCabBack + 0.08, g1 + 0.012], [aLine(g1, 0.06), g1 + 0.012], [aLine(g0, 0.06), g0 - 0.012]], [0.02, 0.04, 0.04, 0.02]), cw - 0.002, 0.008, band);
  sides(b, outline([[zCabBack + 0.12, g0], [zCabBack + 0.12, g1], [aLine(g1, 0.12), g1], [aLine(g0, 0.12), g0]], [0.03, 0.04, 0.04, 0.03]), cw + 0.006, 0.004, glassM);
  const foot: P = [zWF, yWF];
  const tip: P = [zWT, cabRoof - bev];
  const wl = Math.hypot(tip[0] - foot[0], tip[1] - foot[1]);
  const wu: P = [(tip[0] - foot[0]) / wl, (tip[1] - foot[1]) / wl];
  const wn: P = [wu[1], -wu[0]];
  const at = (s: number, out: number) => V(0, foot[1] + wu[1] * s + wn[1] * out, foot[0] + wu[0] * s + wn[0] * out);
  b.add(slab(CW - 0.05, 0.012, wl - 0.04, at(wl / 2, bev - 0.002), wn), band);
  b.add(slab(CW - 0.18, 0.01, wl - 0.14, at(wl / 2 + 0.01, bev + 0.004), wn), glassM);
  for (const x of [-0.42, 0.02]) b.rod(at(0.06, bev + 0.016).setX(x * CW), at(0.12, bev + 0.016).setX((x + 0.36) * CW), 0.008, trim, 5);
  const zFD = wF - ra - 0.04;
  for (const sx of [-1, 1]) {
    const x = sx * (cw + 0.001);
    box(b, 0.004, belt - yc0 - 0.08, 0.008, x, yc0 + 0.08, zFD, seam);
    box(b, 0.004, g1 - yc0 - 0.08, 0.008, x, yc0 + 0.08, zCabBack + 0.06, seam);
    box(b, 0.012, 0.04, 0.16, sx * (cw + 0.004), belt - 0.12, zCabBack + 0.2, seam, 0.004);
    box(b, 0.02, 0.028, 0.14, sx * (cw + 0.008), belt - 0.114, zCabBack + 0.2, paint, 0.008);
    box(b, 0.02, 0.1, wF - ra - zCabBack - 0.1, sx * (cw - 0.002), yc0 - 0.005, (wF - ra + zCabBack) / 2, trim, 0.008);
    // a large mirror on its arm
    const mz = aLine(belt + 0.06, 0.14);
    const reach = w / 2 - cw;
    const mw = Math.min(0.12, reach * 0.7);
    box(b, reach * 0.7, 0.035, 0.06, sx * (cw + reach * 0.35), belt + 0.02, mz, trim, 0.012);
    box(b, mw, 0.3, 0.11, sx * (w / 2 - mw / 2), belt + 0.02, mz, trim, 0.035);
    box(b, mw - 0.02, 0.26, 0.01, sx * (w / 2 - mw / 2), belt + 0.04, mz - 0.056, glassM, 0.004);
  }

  // ----- the front: lamps, grille, bumper, plate -----
  const lh = h * 0.06;
  const ly = yNose - lh - 0.04;
  const lw = Math.min(0.42, CW * 0.24);
  for (const sx of [-1, 1]) {
    const lx = sx * (cw - lw / 2 - 0.04);
    box(b, lw, lh, 0.05, lx, ly, zN - 0.03, gloss, 0.015);
    b.add(new THREE.CylinderGeometry(lh * 0.3, lh * 0.3, 0.02, 14).rotateX(Math.PI / 2), L.head, lx - sx * lw * 0.15, ly + lh * 0.55, zN + 0.002);
    box(b, lw * 0.9, 0.018, 0.02, lx, ly + 0.01, zN + 0.004, L.drl, 0.006);
    box(b, lw * 0.18, lh * 0.35, 0.02, lx + sx * lw * 0.32, ly + lh * 0.4, zN + 0.002, L.amber, 0.006);
  }
  const gw = 2 * (cw - lw - 0.06);
  box(b, gw, lh * 1.4, 0.05, 0, ly - lh * 0.4, zN - 0.025, gloss, 0.015);
  for (let i = 1; i <= 3; i++) box(b, gw - 0.04, 0.012, 0.02, 0, ly - lh * 0.4 + (lh * 1.4 * i) / 4, zN + 0.004, trim);
  b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16).rotateX(Math.PI / 2), mat(C.chrome, { metalness: 0.85, roughness: 0.2 }), 0, ly + lh * 0.3, zN + 0.012);
  const bd = 0.22;
  box(b, CW + 0.03, ly - lh * 0.4 - yc0 + 0.04, bd, 0, yc0 - 0.05, d / 2 - bd / 2, mat("#5b6068", { roughness: 0.7 }), 0.05);
  box(b, CW * 0.6, 0.1, 0.02, 0, yc0 + 0.02, d / 2 - 0.004, trim, 0.01);
  plate(b, 0.5, yc0 + 0.13, d / 2 + 0.002, 1);

  // ----- the rear: light bar, lamps, plate, third brake light, bike rack with two bikes -----
  box(b, BW - 0.04, 0.28, 0.08, 0, yb - 0.08, zR + 0.02, mat("#5b6068", { roughness: 0.7 }), 0.03);
  for (const sx of [-1, 1]) {
    box(b, 0.2, 0.16, 0.02, sx * (hw - 0.18), yb - 0.02, zR - 0.025, L.tail, 0.008);
    box(b, 0.07, 0.16, 0.02, sx * (hw - 0.33), yb - 0.02, zR - 0.025, L.amber, 0.008);
  }
  plate(b, 0.48, yb - 0.04, zR - 0.025, -1);
  box(b, 0.35, 0.03, 0.012, 0, yt - 0.1, zR - 0.004, L.tail, 0.006);
  box(b, BW * 0.4, (wy1 - wy0) * 0.7, 0.012, 0, wy1 + 0.1, zR - 0.004, frame, 0.04);
  box(b, BW * 0.4 - 0.06, (wy1 - wy0) * 0.7 - 0.06, 0.01, 0, wy1 + 0.13, zR - 0.01, win, 0.03);
  const rackY = yb + 0.36;
  const zb0 = zR - 0.04;
  const bar = mat("#3a3d42", { roughness: 0.5, metalness: 0.4 });
  for (const sx of [-1, 1]) b.rod(V(sx * 0.55, yb + 0.2, zR - 0.01), V(sx * 0.55, rackY + 0.95, zR - 0.01), 0.018, bar, 6);
  for (const z of [zb0, zb0 - 0.12]) box(b, 1.5, 0.03, 0.05, 0, rackY, z, bar);
  const tyreB = mat("#1b1c1e", { roughness: 0.9 });
  [mat("#a8322d", { roughness: 0.45 }), mat("#2f4f7f", { roughness: 0.45 })].forEach((fm, i) => {
    const z = zb0 - 0.12 * i;
    const wr = 0.3;
    const yw = rackY + 0.03 + wr;
    const xr = -0.52;
    const xf = 0.52;
    for (const x of [xr, xf]) b.add(new THREE.TorusGeometry(wr, 0.02, 4, 24), tyreB, x, yw, z);
    const crank = V(-0.05, yw - 0.02, z);
    const seatTop = V(-0.2, yw + 0.42, z);
    const head = V(0.33, yw + 0.4, z);
    for (const [a, c] of [
      [V(xr, yw, z), crank],
      [V(xr, yw, z), seatTop],
      [crank, seatTop],
      [crank, head],
      [seatTop.clone().setY(yw + 0.36), head.clone().setY(yw + 0.36)],
      [head, V(xf, yw, z)],
    ])
      b.rod(a, c, 0.016, fm, 5);
    box(b, 0.2, 0.04, 0.07, -0.22, yw + 0.44, z, trim, 0.015);
    box(b, 0.05, 0.03, 0.4, 0.3, yw + 0.49, z, trim, 0.01);
  });

  // ----- underneath and the wheels -----
  box(b, BW - 0.5, yb - r * 0.6, d * 0.8, 0, r * 0.6, 0, trim);
  const tw = Math.min(0.22, w * 0.1);
  const look = { tyre: mat("#1b1c1e", { roughness: 0.92 }), rim: mat("#c4c8cd", { metalness: 0.7, roughness: 0.3 }), dark: mat("#2a2c30", { roughness: 0.6 }) };
  for (const sx of [-1, 1]) {
    wheel(b, sx * (cw - tw / 2 - 0.02), r, wF, r, tw, sx, look, 5, 0.62);
    wheel(b, sx * (hw - tw / 2 - 0.12), r, wR, r, tw, sx, look, 5, 0.62);
  }
}

/**
 * A car trailer along z, drawbar at +z: a flat bed with low aluminium sides and corner
 * posts, one axle with the wheels beside the bed under mudguards, a V drawbar with the
 * coupling head and jockey wheel, rear light units with the plate, props at the back.
 */
function trailer(b: Builder, w: number, d: number, h: number, color: string) {
  const metal = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.4, metalness: color === "silver" ? 0.6 : 0.3 });
  const galv = mat("#a3a8ac", { metalness: 0.55, roughness: 0.5 });
  const rib = mat(color === "silver" ? "#8c9196" : "#2a2c30", { roughness: 0.5, metalness: 0.3 });
  const floorM = mat("#5a4632", { roughness: 0.8 });
  const dark = mat("#1d1f22", { roughness: 0.85 });
  const fender = mat("#2a2c30", { roughness: 0.45, side: THREE.DoubleSide });
  const L = lamps();

  // wheels of a road trailer: 13–14 inch, smaller only on a low or short one
  const r = Math.min(0.29, h * 0.3, d * 0.1);
  const tw = Math.min(0.165, w * 0.11);
  const BW = w - 2 * (tw + 0.06);
  const Lb = d - Math.min(1.0, d * 0.32);
  const zR = -d / 2;
  const zF = zR + Lb;
  const mid = (zR + zF) / 2;
  const yF = Math.min(2 * r + 0.07, h * 0.68);
  const sideH = h - yF - 0.02;
  const za = mid;

  // frame, floor, sides with ribs, top rails and corner posts
  for (const sx of [-1, 1]) box(b, 0.06, 0.08, Lb - 0.04, sx * (BW / 2 - 0.12), yF - 0.11, mid, galv);
  for (let i = 0; i < 4; i++) box(b, BW - 0.06, 0.05, 0.05, 0, yF - 0.08, zR + 0.1 + (i * (Lb - 0.2)) / 3, galv);
  box(b, BW - 0.02, 0.025, Lb - 0.02, 0, yF - 0.025, mid, floorM);
  for (const sx of [-1, 1]) {
    box(b, 0.022, sideH + 0.03, Lb - 0.06, sx * (BW / 2 - 0.011), yF - 0.03, mid, metal);
    box(b, 0.035, 0.025, Lb, sx * (BW / 2 - 0.0175), yF + sideH, mid, galv);
    for (const f of [0.33, 0.66]) box(b, 0.006, 0.012, Lb - 0.1, sx * (BW / 2 + 0.002), yF + sideH * f, mid, rib);
  }
  for (const [z, s] of [[zR + 0.011, -1], [zF - 0.011, 1]]) {
    box(b, BW - 0.06, sideH + 0.03, 0.022, 0, yF - 0.03, z, metal);
    box(b, BW, 0.025, 0.035, 0, yF + sideH, z, galv);
    for (const f of [0.33, 0.66]) box(b, BW - 0.14, 0.012, 0.006, 0, yF + sideH * f, z + s * 0.012, rib);
  }
  for (const sx of [-1, 1])
    for (const z of [zR + 0.025, zF - 0.025]) {
      box(b, 0.05, sideH + 0.06, 0.05, sx * (BW / 2 - 0.025), yF - 0.06, z, galv);
      box(b, 0.03, 0.05, 0.03, sx * (BW / 2 + 0.01), yF + sideH * 0.55, z, dark);
    }

  // the axle (two, close together, under a long trailer), wheels and mudguards
  const xw = BW / 2 + 0.03 + tw / 2;
  const look = { tyre: mat("#1b1c1e", { roughness: 0.92 }), rim: galv, dark: mat("#3a3d42", { roughness: 0.6 }) };
  const gr = r + 0.055;
  const guard = new THREE.CylinderGeometry(gr, gr, tw + 0.07, 18, 1, true, 0.2, Math.PI - 0.4).rotateZ(Math.PI / 2);
  const pitch = 2 * gr + 0.06;
  const axles = d > 3.5 ? [za - pitch / 2, za + pitch / 2] : [za];
  for (const z of axles) {
    box(b, 2 * xw, 0.06, 0.06, 0, r - 0.03, z, galv);
    for (const sx of [-1, 1]) {
      wheel(b, sx * xw, r, z, r, tw, sx, look, 5, 0.58);
      b.add(guard, fender, sx * xw, r, z);
      box(b, 0.03, 0.04, 2 * gr * 0.9, sx * (BW / 2 + 0.015), yF - 0.06, z, galv);
    }
  }

  // the drawbar, coupling, jockey wheel, cable
  const yC = Math.min(0.45, h * 0.5);
  const zC = d / 2 - 0.04;
  for (const sx of [-1, 1]) beam(b, V(sx * (BW / 2 - 0.12), yF - 0.09, zF - 0.3), V(sx * 0.04, yC - 0.05, zC - 0.32), 0.06, galv);
  box(b, 0.08, 0.08, 0.2, 0, yC - 0.09, zC - 0.32, galv);
  box(b, 0.1, 0.09, 0.26, 0, yC - 0.06, zC - 0.15, metal, 0.02);
  b.sphere(0.045, 0, yC - 0.02, zC - 0.04, dark, 1, 0.8, 1, 12);
  b.rod(V(0, yC + 0.03, zC - 0.22), V(0, yC + 0.06, zC - 0.06), 0.012, dark, 6);
  const jx = 0.12;
  const jz = zC - 0.42;
  b.cyl(0.028, 0.028, yC + 0.16 - 0.12, jx, 0.12, jz, galv, 10);
  b.rod(V(jx, yC + 0.16, jz), V(jx + 0.07, yC + 0.2, jz), 0.01, galv, 6);
  b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.045, 14).rotateZ(Math.PI / 2), dark, jx, 0.07, jz + 0.03);
  b.rod(V(-0.1, yF - 0.05, zF), V(-0.03, yC - 0.02, zC - 0.12), 0.007, dark, 4);

  // rear lights hanging under the bed, the plate between, front reflectors, props
  for (const sx of [-1, 1]) {
    const lx = sx * (BW / 2 - 0.13);
    box(b, 0.22, 0.1, 0.05, lx, yF - 0.2, zR + 0.03, dark, 0.012);
    box(b, 0.1, 0.07, 0.02, lx - sx * 0.04, yF - 0.185, zR - 0.002, L.tail, 0.006);
    box(b, 0.05, 0.07, 0.02, lx + sx * 0.04, yF - 0.185, zR - 0.002, L.amber, 0.006);
    box(b, 0.03, 0.07, 0.02, lx + sx * 0.085, yF - 0.185, zR - 0.002, L.reverse, 0.006);
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.008, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), L.tail, lx, yF + sideH * 0.5, zR - 0.006);
    box(b, 0.05, 0.04, 0.01, sx * (BW / 2 - 0.1), yF - 0.1, zF + 0.004, L.reverse);
    b.rod(V(sx * (BW / 2 - 0.12), yF - 0.12, zR + 0.12), V(sx * (BW / 2 - 0.12), 0.03, zR + 0.12), 0.015, galv, 6);
    box(b, 0.08, 0.015, 0.08, sx * (BW / 2 - 0.12), 0, zR + 0.12, galv);
  }
  plate(b, Math.min(0.48, BW * 0.42), yF - 0.24, zR + 0.006, -1);
}

// ----- garden and wellness -----

/** The cladding's board joints on the four faces of a w × d box from y0 to y1. */
function joints(b: Builder, w: number, d: number, y0: number, y1: number, m: M, step = 0.13, inset = 0, front = true) {
  // flat dark strips just off the faces (no thin boxes: their far sides show through as specks)
  const nx = Math.max(2, Math.round((w - 2 * inset) / step));
  const nz = Math.max(2, Math.round((d - 2 * inset) / step));
  const strip = (x: number, z: number, ry: number) => b.batch(new THREE.PlaneGeometry(0.006, y1 - y0), m, matrix(x, (y0 + y1) / 2, z, 0, ry, 0));
  for (let i = 1; i < nx; i++) {
    const x = -w / 2 + inset + ((w - 2 * inset) * i) / nx;
    for (const sz of front ? [-1, 1] : [-1]) strip(x, sz * (d / 2 + 0.0015), sz > 0 ? 0 : Math.PI);
  }
  for (let i = 1; i < nz; i++) {
    const z = -d / 2 + inset + ((d - 2 * inset) * i) / nz;
    for (const sx of [-1, 1]) strip(sx * (w / 2 + 0.0015), z, (sx * Math.PI) / 2);
  }
}

/** A flat ring between two rounded rectangles lying from y up `t`. */
function ringPlate(b: Builder, ow: number, od: number, or: number, iw: number, id: number, ir: number, y: number, t: number, m: M) {
  const s = roundedRect(ow, od, or);
  s.holes.push(roundedRect(iw, id, ir));
  b.add(new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 5 }).rotateX(-Math.PI / 2), m, 0, y, 0);
}

const hotTub: Build = (b, w, d, h, f, color) => {
  const shell = mat("#e9ecee", { roughness: 0.25 });
  const pillow = mat("#3a3d42", { roughness: 0.7 });
  const groove = mat(["anthracite", "grey"].includes(color) ? "#26282b" : "#3e3024", { roughness: 1 });
  const dark = mat("#2b2c2e", { roughness: 0.9 });
  const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
  const water = glowing(part(mat("#3fa4c8", { transparent: true, opacity: 0.7, roughness: 0.05 }), "water"));
  const rim = Math.min(0.2, w * 0.09, d * 0.09);
  const rr = Math.min(0.14, w * 0.07, d * 0.07);
  const yRim = h - Math.min(0.06, h * 0.07);
  const top = 0.05;
  const cabTop = yRim - top;
  // the cabinet: rounded corners, cladding boards with dark joints, a dark plinth
  b.box(w - 0.08, 0.06, d - 0.08, 0, 0, 0, dark);
  const iw = w - 2 * rim;
  const id = d - 2 * rim;
  const ir = Math.min(0.25, iw * 0.15);
  ringPlate(b, w - 0.02, d - 0.02, rr, iw, id, ir, 0.06, cabTop - 0.12, f);
  joints(b, w - 0.02, d - 0.02, 0.08, cabTop - 0.06, groove, 0.13, rr);
  ringPlate(b, w, d, rr + 0.01, iw, id, ir, cabTop - 0.06, 0.06, f);
  // the acrylic shell: the rim, the well's walls, seats under the water, the floor
  ringPlate(b, w, d, rr + 0.01, iw, id, ir, cabTop, top, shell);
  const floorY = Math.max(0.15, yRim - 0.8);
  ringPlate(b, iw + 0.004, id + 0.004, ir, iw - 0.03, id - 0.03, ir - 0.015, floorY, cabTop - floorY, shell);
  box(b, iw - 0.02, 0.02, id - 0.02, 0, floorY, 0, shell);
  const seatY = yRim - 0.42;
  const sd = Math.min(0.45, id * 0.28);
  box(b, iw - 0.04, seatY - floorY, sd, 0, floorY, -id / 2 + sd / 2 + 0.015, shell, 0.05);
  box(b, sd, seatY - floorY, id - sd - 0.04, -iw / 2 + sd / 2 + 0.015, floorY, sd / 2, shell, 0.05);
  box(b, iw * 0.42, seatY - floorY - 0.12, sd * 1.3, iw / 2 - iw * 0.21 - 0.015, floorY, id / 2 - sd * 0.65 - 0.015, shell, 0.05);
  // jets in the walls
  for (const x of [-0.25, 0, 0.25]) b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 10).rotateX(Math.PI / 2), chrome, x * iw, seatY + 0.18, -(id / 2 - 0.016));
  for (const t of [-0.15, 0.15]) b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 10).rotateZ(Math.PI / 2), chrome, -iw / 2 + 0.016, seatY + 0.18, t * id);
  // the water
  b.add(new THREE.ShapeGeometry(roundedRect(iw - 0.03, id - 0.03, ir - 0.015), 5).rotateX(-Math.PI / 2), water, 0, yRim - 0.12, 0);
  // headrests on the rim at the corner seats, the control panel
  const hh = Math.max(0.02, h - yRim - 0.002);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1]] as P[]) {
    const mesh = box(b, 0.3, hh, 0.13, sx * (iw / 2 - ir * 0.3), yRim, sz * (id / 2 - ir * 0.3), pillow, Math.min(0.03, hh / 2));
    if (mesh) mesh.rotation.y = sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4;
  }
  box(b, 0.18, 0.012, 0.09, iw / 2 - 0.3, yRim, d / 2 - rim / 2, dark, 0.004);
  box(b, 0.08, 0.004, 0.03, iw / 2 - 0.3, yRim + 0.012, d / 2 - rim / 2, ledMat("#3fa8ff"));
};

const sauna: Build = (b, w, d, h, f, color) => {
  const infrared = b.options.heat === "infrared";
  const t = 0.07;
  const bench = mat("#dcc095", { roughness: 0.8 });
  const benchDark = mat("#b8996c", { roughness: 0.8 });
  const groove = mat(color === "black" ? "#141414" : color === "sand" ? "#8f7d62" : "#4a3a2c", { roughness: 1 });
  const tinted = mat("#a88a68", { transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1 });
  const steel = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
  const black = mat("#232427", { roughness: 0.6 });
  const roofH = 0.08;
  const yTop = h - roofH;
  const y0 = 0.04;
  const zi = -d / 2 + t;
  const iw = w - 2 * t;
  const zf = d / 2 - t / 2;
  // the floor, walls with board joints, the roof
  b.box(w, y0, d, 0, 0, 0, f);
  box(b, iw, 0.012, d - 2 * t, 0, y0, 0, benchDark);
  b.box(w, yTop - y0, t, 0, y0, -d / 2 + t / 2, f);
  for (const sx of [-1, 1]) b.box(t, yTop - y0, d - t, sx * (w / 2 - t / 2), y0, t / 2, f);
  b.box(w + 0.02, roofH - 0.02, d + 0.02, 0, yTop, 0, f);
  box(b, w + 0.03, 0.02, d + 0.03, 0, h - 0.02, 0, mat("#2b2c2e", { roughness: 0.8 }));
  joints(b, w, d, y0, yTop, groove, 0.12, 0.06, false);
  // light wood lining inside, whatever the outside
  const lining = mat("#cfae80", { roughness: 0.8 });
  box(b, iw, yTop - y0 - 0.01, 0.01, 0, y0, zi + 0.005, lining);
  for (const sx of [-1, 1]) box(b, 0.01, yTop - y0 - 0.01, d - 2 * t, sx * (iw / 2 - 0.005), y0, 0, lining);
  box(b, iw, 0.01, d - 2 * t, 0, yTop - 0.012, 0, lining);
  // the front: a wooden panel, a glass window, a post, the all-glass door, the header
  const header = Math.min(0.24, h * 0.12);
  const doorW = Math.min(0.66, w * 0.34);
  const xD1 = w / 2 - t;
  const xD0 = xD1 - doorW;
  const xW0 = -w / 2 + t + Math.min(0.3, w * 0.15);
  const sill = Math.min(0.5, h * 0.25);
  b.box(xW0 + w / 2, yTop - y0, t, (-w / 2 + xW0) / 2, y0, zf, f);
  b.box(0.06, yTop - y0, t, xD0 - 0.03, y0, zf, f);
  b.box(w - 2 * t, header, t, 0, yTop - header, zf, f);
  b.box(xD0 - 0.06 - xW0, sill - y0, t, (xW0 + xD0 - 0.06) / 2, y0, zf, f);
  b.box(xD0 - 0.06 - xW0, yTop - header - sill, 0.012, (xW0 + xD0 - 0.06) / 2, sill, zf, tinted);
  const doorH = yTop - header - y0 - 0.02;
  b.box(doorW - 0.016, doorH, 0.012, (xD0 + xD1) / 2, y0 + 0.01, zf + t / 2 - 0.01, tinted);
  const hx = xD0 + 0.08;
  const hl = Math.min(0.5, doorH * 0.3);
  box(b, 0.035, hl, 0.03, hx, y0 + doorH * 0.42, zf + t / 2 + 0.03, benchDark, 0.012);
  for (const y of [y0 + doorH * 0.42 + 0.03, y0 + doorH * 0.42 + hl - 0.045]) box(b, 0.015, 0.015, 0.035, hx, y, zf + t / 2 + 0.008, steel);
  for (const y of [y0 + 0.2, y0 + doorH - 0.25]) box(b, 0.025, 0.08, 0.02, xD1 - 0.03, y, zf + t / 2, steel);
  // the control panel next to the door
  const cx = (-w / 2 + xW0) / 2;
  box(b, 0.11, 0.17, 0.02, cx, Math.min(1.2, h * 0.58), zf + t / 2 + 0.01, black, 0.008);
  box(b, 0.07, 0.04, 0.004, cx, Math.min(1.2, h * 0.58) + 0.09, zf + t / 2 + 0.02, ledMat("#ff8a3a"));

  // benches: slats on aprons along the back wall
  const slats = (x0: number, x1: number, y: number, z0: number, depth: number, n: number) => {
    const sw = depth / n;
    for (let i = 0; i < n; i++) box(b, x1 - x0, 0.028, sw - 0.014, (x0 + x1) / 2, y - 0.028, z0 + sw * (i + 0.5), bench, 0.006);
    box(b, x1 - x0, 0.12, 0.022, (x0 + x1) / 2, y - 0.148, z0 + depth - 0.011, benchDark);
    for (const x of [x0 + 0.04, x1 - 0.04]) box(b, 0.04, y - 0.03 - y0, 0.04, x, y0, z0 + depth - 0.06, benchDark);
  };
  const backrest = (yb0: number, yb1: number, n: number) => {
    for (let i = 0; i < n; i++) box(b, iw - 0.04, 0.06, 0.022, 0, yb0 + ((yb1 - yb0) * i) / Math.max(1, n - 1), zi + 0.03, bench, 0.006);
  };
  const glowM = part(mat("#4a2a20", { emissive: "#ff5a20", emissiveIntensity: 0.3, roughness: 0.6 }), "warm");
  if (infrared) {
    const seat = Math.min(0.46, h * 0.23);
    const sd = Math.min(0.6, (d - 2 * t) * 0.45);
    slats(-iw / 2, iw / 2, seat, zi, sd, 5);
    // emitter panels behind the backrest and low on the sides
    const pw = (iw - 0.2) / 2;
    for (const sx of [-1, 1]) {
      box(b, pw, Math.min(0.8, yTop - seat - 0.35), 0.012, sx * (pw / 2 + 0.04), seat + 0.1, zi + 0.006, glowM, 0.004);
      box(b, 0.012, Math.min(0.5, seat + 0.1), Math.min(0.4, d * 0.25), sx * (iw / 2 - 0.006), seat + 0.14, zi + sd + 0.25, glowM, 0.004);
    }
    backrest(seat + 0.2, seat + 0.62, 2);
  } else {
    const upper = Math.min(1.0, h * 0.49);
    const lower = Math.min(0.52, h * 0.25);
    const ud = Math.min(0.55, (d - 2 * t) * 0.38);
    const ld = Math.min(0.45, (d - 2 * t) * 0.3);
    const stoveW = Math.min(0.42, iw * 0.24);
    slats(-iw / 2, iw / 2, upper, zi, ud, 5);
    slats(-iw / 2 + stoveW + 0.14, iw / 2, lower, zi + ud, ld, 4);
    backrest(upper + 0.18, upper + 0.5, 3);
    // the stove in the front left corner, in front of the upper bench and beside the lower one,
    // sized with the cabin: a black body, a basket of stones, a guard round its front and side
    const k = stoveW / 0.42;
    const zs0 = zi + ud + 0.04;
    const sdp = Math.min(0.34, Math.max(0.12, (d / 2 - t - 0.1 - zs0) * 0.7));
    const sx0 = -iw / 2 + stoveW / 2 + 0.06;
    const sz = zs0 + sdp / 2;
    const foot = 0.08 * Math.min(1, k * 1.2);
    const sh = Math.min(0.62, (upper - y0) * 0.72);
    box(b, stoveW, sh, sdp, sx0, y0 + foot, sz, black, 0.02);
    for (const sx of [-1, 1]) for (const dz of [-1, 1]) box(b, 0.03, foot, 0.03, sx0 + sx * (stoveW / 2 - 0.03), y0, sz + dz * (sdp / 2 - 0.03), black);
    box(b, stoveW - 0.06, 0.012, sdp * 0.76, sx0, y0 + foot + sh * 0.35, sz + sdp / 2 + 0.001 - sdp * 0.38, mat("#3a3c40", { roughness: 0.5 }));
    const yS = y0 + foot + sh;
    const grey = mat("#77716b", { roughness: 0.9 });
    const rand = random(5151);
    for (let i = 0; i < 26; i++) {
      const sr = (0.03 + rand() * 0.02) * Math.min(1, k * 1.1);
      const geo = new THREE.IcosahedronGeometry(sr, 0);
      b.add(geo, i % 3 === 0 ? glowM : grey, sx0 + (rand() - 0.5) * (stoveW - 2.2 * sr), yS + sr * 0.6 + (i > 16 ? 0.035 * k : 0), sz + (rand() - 0.5) * (sdp - 2.2 * sr)).rotation.set(rand() * 3, rand() * 3, 0);
    }
    const gz = sz + sdp / 2 + 0.07;
    const gx = sx0 + stoveW / 2 + 0.06;
    for (const y of [y0 + (foot + sh) * 0.45, y0 + (foot + sh) * 0.95]) {
      box(b, gx - (-iw / 2) + 0.01, 0.06, 0.02, (gx + -iw / 2) / 2, y, gz, benchDark);
      box(b, 0.02, 0.06, gz - zs0 + 0.01, gx, y, (gz + zs0) / 2, benchDark);
    }
    // a bucket and ladle on the lower bench
    b.cyl(0.08, 0.07, 0.14, iw / 2 - 0.25, lower, zi + ud + ld / 2, benchDark, 14);
    b.rod(V(iw / 2 - 0.25, lower + 0.08, zi + ud + ld / 2), V(iw / 2 - 0.12, lower + 0.3, zi + ud + ld / 2 + 0.05), 0.008, bench, 5);
  }
  // a thermometer on the back wall, a light
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16).rotateX(Math.PI / 2), benchDark, iw / 2 - 0.25, yTop - 0.35, zi + 0.01);
  b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16).rotateX(Math.PI / 2), mat(C.ceramic), iw / 2 - 0.25, yTop - 0.35, zi + 0.014);
  box(b, 0.3, 0.05, 0.05, 0, yTop - 0.12, zi + 0.04, benchDark, 0.01);
};

/** A German roofed wicker beach chair: basket base with footrests, hood with striped lining. */
const beachChair: Build = (b, w, d, h, f, color) => {
  const wick = wickerMat("beige");
  const wood = mat("#f2f0ea", { roughness: 0.6 });
  const stripeB = mat(color === "white" ? "#3d5a80" : "#f4f2ec", { roughness: 0.95 });
  const zb = -d / 2;
  const db = d - Math.min(0.12, d * 0.14);
  const zbf = zb + db;
  const yS = h * 0.28;
  const yA = h * 0.5;
  const st = Math.min(0.07, w * 0.06);
  const th = 0.05;
  const a = Math.min(0.32, d * 0.38);
  const yG = h - Math.min(0.4, h * 0.25);
  const zE = zb + d * 0.72;
  const yE = h - Math.min(0.13, h * 0.08);
  const zD = zb + d * 0.6;
  const arc = (k: number, off: number): P[] => {
    const pts: P[] = [];
    for (let i = 0; i <= k; i++) {
      const s = (i / k) * (Math.PI / 2);
      pts.push([zb + off + (a - off) * (1 - Math.cos(s)), yG + (h - yG - off) * Math.sin(s)]);
    }
    return pts;
  };
  // the base: wicker on a white frame
  box(b, w, 0.06, db, 0, 0, zb + db / 2, wood);
  box(b, w - 0.02, yS - 0.1, db - 0.02, 0, 0.06, zb + db / 2, wick);
  box(b, w, 0.04, db, 0, yS - 0.04, zb + db / 2, wood);
  for (const sx of [-1, 1]) for (const z of [zb + 0.025, zbf - 0.025]) box(b, 0.05, yS, 0.05, sx * (w / 2 - 0.025), 0, z, wood);
  // two footrests pulled out a little
  const fw = (w - 0.2) / 2 - 0.03;
  for (const sx of [-1, 1]) {
    const x = sx * (fw / 2 + 0.05);
    box(b, fw, yS * 0.5, d - db + 0.04, x, yS * 0.25, d / 2 - (d - db + 0.04) / 2, wick);
    box(b, fw + 0.02, 0.025, d - db + 0.05, x, yS * 0.75, d / 2 - (d - db + 0.05) / 2, wood);
  }
  // the side walls: armrest low at the front, up the front edge to the hood
  const side = new THREE.Shape();
  side.moveTo(zb, yS);
  side.lineTo(zbf, yS);
  side.lineTo(zbf, yA);
  side.lineTo(zD, yA);
  side.quadraticCurveTo(zD + 0.02, (yA + yE) / 2, zE - 0.02, yE - 0.06);
  side.lineTo(zE, yE);
  side.lineTo(zb + a, h);
  for (const [z, y] of arc(8, 0).reverse().slice(1)) side.lineTo(z, y);
  sides(b, side, w / 2 - st, st, wick, 0, undefined, 6);
  // the hood: back and roof in one curved shell between the sides
  const shell = new THREE.Shape();
  shell.moveTo(zb, yS);
  for (const [z, y] of arc(8, 0)) shell.lineTo(z, y);
  shell.lineTo(zE, yE);
  shell.lineTo(zE, yE - th);
  shell.lineTo(zb + a, h - th);
  for (const [z, y] of arc(8, th).reverse().slice(1)) shell.lineTo(z, y);
  shell.lineTo(zb + th, yS);
  b.add(across(shell, w - 2 * st + 0.004, 0, 6), wick);
  // white trims: the roof's front edge, the front edges of the sides, the armrests
  box(b, w, th + 0.03, 0.035, 0, yE - th - 0.015, zE, wood, 0.01);
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - st / 2);
    b.rod(V(x, yA, zD), V(x, (yA + yE) / 2, zD + 0.04), 0.02, wood, 6);
    b.rod(V(x, (yA + yE) / 2, zD + 0.04), V(x, yE - 0.03, zE - 0.01), 0.02, wood, 6);
    box(b, st + 0.04, 0.03, zbf - zD + 0.06, x, yA, (zD + zbf) / 2, wood, 0.01);
    box(b, 0.006, yE - 0.2 - yA, zD - zb - th - 0.04, sx * (w / 2 - st - 0.003), yA + 0.04, (zb + th + zD) / 2, f);
  }
  // the striped lining inside the hood and the striped cushions
  const n = 9;
  const iw = w - 2 * st;
  for (let i = 0; i < n; i++) {
    const x = -iw / 2 + (iw * (i + 0.5)) / n;
    const m = i % 2 ? stripeB : f;
    box(b, iw / n, yG - yS - 0.02, 0.008, x, yS + 0.02, zb + th + 0.004, m);
    box(b, iw / n, 0.08, db - th - 0.05, x, yS, zb + th + (db - th - 0.05) / 2 + 0.01, m, 0.01);
    const back = box(b, iw / n, Math.min(0.5, yG - yS - 0.2), 0.08, x, yS + 0.08, zb + th + 0.06, m, 0.01);
    if (back) back.rotation.x = -0.1;
  }
};

/** An egg-shaped ceramic grill on a nest stand with two slatted side shelves. */
const kamado: Build = (b, w, d, h, _f, color) => {
  const glaze = mat(FINISHES[color] ?? FINISHES.green, { roughness: 0.3, metalness: 0.05 });
  const steel = mat(C.steel, { metalness: 0.7, roughness: 0.3 });
  const iron = mat("#2a2b2e", { roughness: 0.55, metalness: 0.4 });
  const wood = mat("#9b6b45", { roughness: 0.7 });
  const R = Math.min(w * 0.3, d * 0.33, h * 0.21);
  const H = R * 2.8;
  // the fittings (hinge, handle, thermometer, draft door) keep to the egg's size
  const k = Math.min(1.15, R / 0.225);
  const ventH = Math.min(0.07, h * 0.06);
  const yb = h - ventH - H + 0.02;
  // the egg's radius at y: fuller below the middle
  const eggR = (y: number) => {
    const s = Math.max(-1, Math.min(1, ((y - yb) / H) * 2 - 1));
    return R * Math.sqrt(Math.max(0, 1 - s * s)) * (1 - 0.1 * s);
  };
  const ys = yb + H * 0.53;
  const lathe = (y0: number, y1: number, k: number, m: M, closeTop: boolean, closeBottom: boolean) => {
    const pts: THREE.Vector2[] = [];
    if (closeBottom) pts.push(new THREE.Vector2(0.001, y0));
    for (let i = 0; i <= k; i++) {
      const y = y0 + ((y1 - y0) * i) / k;
      pts.push(new THREE.Vector2(Math.max(0.001, eggR(y)), y));
    }
    if (closeTop) pts.push(new THREE.Vector2(0.001, y1));
    b.add(new THREE.LatheGeometry(pts, 32), m);
  };
  const yFoot = yb + H * 0.06;
  const yTop = yb + H * 0.96;
  lathe(yFoot, ys - 0.006, 8, glaze, true, true);
  lathe(ys + 0.006, yTop, 9, glaze, true, true);
  b.cyl(eggR(ys) - 0.004, eggR(ys) - 0.004, 0.014, 0, ys - 0.007, 0, mat("#1d1f22", { roughness: 0.9 }), 32);
  // the steel bands at the seam, the hinge at the back
  const rs = eggR(ys);
  const band = mat(C.steel, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide });
  for (const y of [ys - 0.045, ys + 0.008]) b.add(new THREE.CylinderGeometry(rs + 0.012, rs + 0.012, 0.035, 32, 1, true), band, 0, y + 0.0175, 0);
  box(b, 0.09 * k, 0.15 * k, 0.06 * k, 0, ys - 0.09 * k, -rs - 0.02 * k, steel, 0.01 * k);
  b.cyl(0.02 * k, 0.02 * k, 0.16 * k, 0, ys - 0.2 * k, -rs - 0.04 * k, iron, 8);
  // the handle in front, the thermometer, the top vent, the draft door
  for (const sx of [-1, 1]) box(b, 0.02 * k, 0.02 * k, 0.1 * k, sx * 0.08 * k, ys + 0.01 * k, rs + 0.05 * k, steel);
  b.add(new THREE.CylinderGeometry(0.018 * k, 0.018 * k, 0.24 * k, 10).rotateZ(Math.PI / 2), wood, 0, ys + 0.02 * k, rs + 0.1 * k);
  const yT = ys + H * 0.22;
  const zT = eggR(yT);
  b.add(new THREE.CylinderGeometry(0.04 * k, 0.04 * k, 0.025, 18).rotateX(Math.PI / 2), steel, 0, yT, zT + 0.005);
  b.add(new THREE.CylinderGeometry(0.033 * k, 0.033 * k, 0.01, 18).rotateX(Math.PI / 2), mat(C.ceramic), 0, yT, zT + 0.016);
  const needle = box(b, 0.004, 0.028 * k, 0.004, 0.006 * k, yT - 0.004 * k, zT + 0.022, mat("#a8322d"));
  if (needle) needle.rotation.z = -0.6;
  const rt = eggR(yTop) + 0.012;
  b.cyl(rt, rt + 0.006, ventH, 0, yTop - 0.02, 0, iron, 18);
  b.cyl(rt * 0.6, rt * 0.6, 0.015, 0, yTop - 0.02 + ventH, 0, iron, 14);
  const yD = yb + H * 0.16;
  const zD = eggR(yD + 0.05);
  box(b, 0.12 * k, 0.1 * k, 0.02, 0, yD, zD - 0.005, steel, 0.008);
  box(b, 0.08 * k, 0.06 * k, 0.012, 0, yD + 0.02 * k, zD + 0.003, iron);
  // the nest stand on casters
  const rn = eggR(yFoot + 0.04) * 0.95;
  const torus = new THREE.TorusGeometry(rn, 0.012, 5, 28).rotateX(Math.PI / 2);
  b.add(torus, iron, 0, yFoot + 0.03, 0);
  b.add(torus, iron, 0, 0.12, 0);
  for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.cos(ang) * rn;
    const z = Math.sin(ang) * rn;
    b.rod(V(x, 0.07, z), V(x, yFoot + 0.04, z), 0.014, iron, 6);
    b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 12).rotateZ(Math.PI / 2), iron, x, 0.035, z);
  }
  // slatted side shelves on brackets at the seam
  const yS = ys - 0.06;
  const sd = Math.min(0.34, d * 0.5);
  for (const sx of [-1, 1]) {
    const x0 = rs + 0.02;
    const x1 = w / 2;
    if (x1 - x0 < 0.05) continue;
    for (let i = 0; i < 4; i++) box(b, x1 - x0, 0.02, sd / 4 - 0.012, (sx * (x0 + x1)) / 2, yS, -sd / 2 + (sd * (i + 0.5)) / 4, wood, 0.004);
    for (const z of [-sd / 2 + 0.03, sd / 2 - 0.03]) box(b, x1 - x0 + 0.02, 0.02, 0.02, sx * ((x0 + x1) / 2 - 0.01), yS - 0.02, z, steel);
  }
};

/** A push lawn mower along z: deck at the front, grass box behind, the handle up to the back. */
const lawnMower: Build = (b, w, d, h, _f, color) => {
  const body = mat(FINISHES[color] ?? FINISHES.green, { roughness: 0.4 });
  const dark = mat("#1d1f22", { roughness: 0.8 });
  const grey = mat("#3f4246", { roughness: 0.6 });
  const tyre = mat("#202124", { roughness: 0.9 });
  const hub = mat("#b9bdc2", { roughness: 0.4, metalness: 0.4 });
  const tube = mat("#2a2b2e", { roughness: 0.4, metalness: 0.5 });
  const dw = w - 0.11;
  const zD1 = d / 2 - 0.02;
  // the deck, grass box and wheels grow with the mower (a bigger one is not a small deck on a
  // long handle)
  const zD0 = d / 2 - d * 0.42;
  const zm = (zD0 + zD1) / 2;
  const dh = h * 0.17;
  // the deck: a black skirt, the coloured shell, the motor hood, a bumper
  box(b, dw + 0.01, 0.05, zD1 - zD0 + 0.01, 0, 0.03, zm, dark, 0.015);
  box(b, dw, dh, zD1 - zD0, 0, 0.06, zm, body, 0.06);
  b.sphere(dw * 0.3, 0, 0.06 + dh - 0.01, zm + 0.02, body, 1, 0.55, 1.1, 20);
  b.sphere(dw * 0.16, 0, 0.06 + dh + dw * 0.12, zm + 0.02, dark, 1, 0.5, 1, 14);
  box(b, dw * 0.7, 0.05, 0.03, 0, 0.08, zD1, dark, 0.012);
  box(b, dw * 0.5, 0.012, 0.08, 0, 0.06 + dh - 0.004, zD1 - 0.08, grey, 0.004);
  // wheels, the height levers
  const rr = h * 0.11;
  const rf = rr * 0.82;
  for (const [z, r] of [[zD0 + 0.08, rr], [zD1 - 0.1, rf]] as P[])
    for (const sx of [-1, 1]) {
      const x = sx * (dw / 2 + 0.025);
      b.add(new THREE.CylinderGeometry(r, r, 0.045, 18).rotateZ(Math.PI / 2), tyre, x, r, z);
      b.add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.05, 14).rotateZ(Math.PI / 2), hub, x, r, z);
      b.add(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.054, 10).rotateZ(Math.PI / 2), body, x, r, z);
      box(b, 0.015, 0.09, 0.02, sx * (dw / 2 - 0.005), 0.06 + dh * 0.5, z, dark, 0.006);
    }
  // the grass box: a grey tub, a dark lid with a carrying handle
  const gw = dw - 0.1;
  const zG0 = zD0 + 0.03;
  const zG1 = Math.max(-d / 2 + 0.2, zG0 - d * 0.3);
  const gh = h * 0.32;
  box(b, gw, gh, zG0 - zG1, 0, 0.07, (zG0 + zG1) / 2, grey, 0.04);
  box(b, gw + 0.01, 0.05, zG0 - zG1 + 0.01, 0, 0.07 + gh - 0.02, (zG0 + zG1) / 2, dark, 0.02);
  box(b, gw * 0.5, 0.08, 0.02, 0, 0.07 + gh + 0.01, (zG0 + zG1) / 2, dark, 0.008);
  box(b, gw * 0.3, 0.012, 0.03, 0, 0.07 + gh + 0.08, (zG0 + zG1) / 2, dark, 0.004);
  // the handle: two tubes up to the back, a cross bar, the grip and the bail lever
  // the tubes rise from the deck's back corners, well clear of the grass box between them
  const hx = gw / 2 + 0.045;
  const yH = h - 0.025;
  const zH = -d / 2 + 0.03;
  for (const sx of [-1, 1]) {
    b.rod(V(sx * hx, 0.12, zD0 + 0.02), V(sx * hx, yH, zH), 0.012, tube, 8);
    b.sphere(0.025, sx * (hx + 0.02), 0.12 + (yH - 0.12) * 0.45, zD0 + 0.02 + (zH - zD0 - 0.02) * 0.45, dark, 1, 1, 1, 10);
  }
  const yMid = 0.12 + (yH - 0.12) * 0.55;
  const zMid = zD0 + 0.02 + (zH - zD0 - 0.02) * 0.55;
  b.add(new THREE.CylinderGeometry(0.01, 0.01, 2 * hx, 8).rotateZ(Math.PI / 2), tube, 0, yMid, zMid);
  b.add(new THREE.CylinderGeometry(0.018, 0.018, 2 * hx + 0.04, 10).rotateZ(Math.PI / 2), dark, 0, yH, zH);
  b.add(new THREE.CylinderGeometry(0.007, 0.007, 2 * hx - 0.06, 6).rotateZ(Math.PI / 2), body, 0, yH - 0.03, zH + 0.06);
  for (const sx of [-1, 1]) b.rod(V(sx * (hx - 0.03), yH - 0.03, zH + 0.06), V(sx * (hx - 0.01), yH - 0.005, zH + 0.01), 0.007, body, 6);
  box(b, 0.06, 0.08, 0.05, hx - 0.06, yH - 0.1, zH + 0.06, body, 0.015);
  b.rod(V(hx - 0.06, yH - 0.1, zH + 0.08), V(hx - 0.01, 0.2, zD0 + 0.03), 0.004, dark, 4);
};

/** A driveway sliding gate: a frame with bars (or, in oak, horizontal boards), a post at one end. */
const slidingGate: Build = (b, w, d, h, f, color) => {
  const oak = color === "oak";
  // powder-coated steel: matt and hardly metallic, the dark ones a touch lighter than their
  // finish so the bars read against shade and grass (metal with no surroundings to mirror
  // looks black)
  const tone = color === "black" ? "#404348" : color === "anthracite" || oak ? "#666b72" : (FINISHES[color] ?? FINISHES.anthracite);
  const metal = mat(tone, { roughness: color === "silver" ? 0.45 : 0.55, metalness: color === "silver" ? 0.5 : 0.1 });
  const dark = mat("#1d1f22", { roughness: 0.8 });
  const steel = mat(C.steel, { metalness: 0.6, roughness: 0.4 });
  const pw = Math.min(0.12, w * 0.04);
  const pd = Math.min(d, 0.12);
  // the post with its cap and a warning light
  box(b, pw, h - 0.04, pd, w / 2 - pw / 2, 0, 0, metal);
  box(b, pw + 0.01, 0.02, pd, w / 2 - pw / 2, h - 0.04, 0, dark);
  b.sphere(Math.min(0.03, pd * 0.3), w / 2 - pw / 2, h - 0.02, 0, mat("#e08a1e", { emissive: "#8a4a00", emissiveIntensity: 0.3, roughness: 0.3 }), 1, 0.8, 1, 10);
  // the leaf: a frame of square tubes on rollers
  const x0 = -w / 2;
  const x1 = w / 2 - pw - 0.03;
  const lw = x1 - x0;
  const xm = (x0 + x1) / 2;
  const yb = 0.07;
  const yt = h - 0.06;
  const tb = Math.min(0.07, h * 0.06);
  const td = Math.min(d * 0.7, 0.06);
  box(b, lw, tb, td, xm, yb, 0, metal);
  box(b, lw, tb * 0.7, td, xm, yt - tb * 0.7, 0, metal);
  for (const x of [x0 + tb / 2, x1 - tb / 2]) box(b, tb, yt - yb, td, x, yb, 0, metal);
  const ix0 = x0 + tb;
  const ix1 = x1 - tb;
  const iy0 = yb + tb;
  const iy1 = yt - tb * 0.7;
  if (oak) {
    const n = Math.max(3, Math.round((iy1 - iy0) / 0.12));
    const bh = (iy1 - iy0) / n;
    for (let i = 0; i < n; i++) box(b, ix1 - ix0, bh - 0.018, td * 0.6, (ix0 + ix1) / 2, iy0 + bh * i + 0.009, 0, f);
    for (const x of [ix0 + (ix1 - ix0) / 3, ix0 + (2 * (ix1 - ix0)) / 3]) box(b, 0.04, iy1 - iy0, td * 0.4, x, iy0, -td * 0.25, metal);
  } else {
    const n = Math.max(4, Math.round((ix1 - ix0) / 0.11));
    const s = (ix1 - ix0) / n;
    const bar = Math.min(0.035, s * 0.35);
    for (let i = 0; i < n - 1; i++) box(b, bar, iy1 - iy0, Math.min(0.03, td), ix0 + s * (i + 1), iy0, 0, metal);
    box(b, ix1 - ix0, 0.03, td * 0.6, (ix0 + ix1) / 2, iy0 + (iy1 - iy0) * 0.22, 0, metal);
  }
  // rollers on a ground rail, the gear rack along the bottom
  box(b, w - pw, 0.012, 0.035, (x0 + w / 2 - pw) / 2, 0, 0, steel);
  for (const x of [x0 + 0.3, x1 - 0.3]) {
    b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16).rotateX(Math.PI / 2), dark, x, 0.055, 0);
    box(b, 0.1, 0.03, 0.04, x, yb - 0.02, 0, metal);
  }
  box(b, lw - 0.1, 0.025, 0.012, xm, yb + 0.005, -td / 2 - 0.006, dark);
};

const snowman: Build = (b, w, d, h) => {
  const snow = mat("#f4f6f8", { roughness: 0.95 });
  const coal = mat("#1a1a1c", { roughness: 0.7 });
  const carrot = mat("#e0701e", { roughness: 0.6 });
  const stick = mat("#5a3e2a", { roughness: 0.9 });
  const scarfM = mat("#b02a2a", { roughness: 0.95 });
  const hatM = mat("#1f2023", { roughness: 0.6 });
  // three balls sunk into each other, a top hat: scaled to the height
  const R = Math.min(w, d) / 2;
  const k2 = 0.72;
  const k3 = 0.52;
  const hatK = 0.75;
  const tall = 0.9 + 0.8 + k2 * 1.6 + k3 * (0.85 + 0.55 + hatK);
  const r1 = Math.min(R * 0.95, h / tall);
  const r2 = r1 * k2;
  const r3 = r1 * k3;
  const y1 = r1 * 0.9;
  const y2 = y1 + r1 * 0.8 + r2 * 0.8;
  const y3 = y2 + r2 * 0.8 + r3 * 0.85;
  const lumpy = (r: number, y: number, seed: number) => {
    const geo = new THREE.SphereGeometry(r, 22, 13);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / r;
      const yy = p.getY(i) / r;
      const z = p.getZ(i) / r;
      const n = 1 + 0.025 * Math.sin(5 * x + seed) * Math.sin(4 * yy + 0.7 * seed) * Math.sin(6 * z + 2.1) + 0.015 * Math.sin(9 * yy + 3 * x);
      p.setXYZ(i, x * r * n, yy * r * n * (yy < -0.6 ? 0.96 : 1), z * r * n);
    }
    b.add(smooth(geo), snow, 0, y, 0);
  };
  lumpy(r1, y1, 1.3);
  lumpy(r2, y2, 2.7);
  lumpy(r3, y3, 4.1);
  // coal eyes and mouth, the carrot nose, buttons
  const onFront = (r: number, yc: number, ax: number, ay: number) => V(r * Math.sin(ax) * Math.cos(ay), yc + r * Math.sin(ay), r * Math.cos(ax) * Math.cos(ay));
  for (const sx of [-1, 1]) {
    const p = onFront(r3, y3, sx * 0.35, 0.25);
    b.add(new THREE.IcosahedronGeometry(r3 * 0.1, 0), coal, p.x, p.y, p.z);
  }
  for (let i = 0; i < 5; i++) {
    const p = onFront(r3 * 0.98, y3, (i - 2) * 0.18, -0.32 - 0.07 * Math.cos(((i - 2) / 2) * 1.2));
    b.add(new THREE.IcosahedronGeometry(r3 * 0.06, 0), coal, p.x, p.y, p.z);
  }
  b.add(new THREE.ConeGeometry(r3 * 0.12, r3 * 0.8, 10).rotateX(Math.PI / 2), carrot, 0, y3, r3 + r3 * 0.35);
  for (const ay of [0.35, 0.05, -0.25]) {
    const p = onFront(r2 * 0.98, y2, 0, ay);
    b.add(new THREE.IcosahedronGeometry(r2 * 0.08, 0), coal, p.x, p.y, p.z);
  }
  // the scarf round the neck, one end hanging down
  const yn = y2 + r2 * 0.8;
  b.add(new THREE.TorusGeometry(r3 * 0.82, r3 * 0.2, 8, 22).rotateX(Math.PI / 2), scarfM, 0, yn, 0);
  const tail = box(b, r3 * 0.35, r2 * 0.75, r3 * 0.1, r3 * 0.45, yn - r2 * 0.72, r2 * 0.62, scarfM, 0.01);
  if (tail) tail.rotation.set(-0.35, 0, 0.15);
  // the top hat with a band
  const yh = y3 + r3 * 0.6;
  b.cyl(r3 * 0.95, r3 * 0.95, r3 * 0.08, 0, yh, 0, hatM, 20);
  b.cyl(r3 * 0.62, r3 * 0.66, r3 * hatK, 0, yh, 0, hatM, 20);
  b.cyl(r3 * 0.67, r3 * 0.67, r3 * 0.14, 0, yh + r3 * 0.1, 0, scarfM, 20);
  // stick arms with twigs
  for (const sx of [-1, 1]) {
    const a = V(sx * r2 * 0.75, y2 + r2 * 0.25, 0);
    const c = V(sx * Math.min(w / 2 - 0.02, r2 * 2.1), y2 + r2 * 1.0, 0.03);
    b.rod(a, c, 0.012, stick, 5);
    const m = a.clone().lerp(c, 0.75);
    b.rod(m, m.clone().add(V(sx * 0.07, 0.08, 0)), 0.007, stick, 4);
    b.rod(c, c.clone().add(V(sx * 0.05, -0.04, 0.02)), 0.006, stick, 4);
    b.rod(c, c.clone().add(V(sx * 0.03, 0.06, -0.02)), 0.006, stick, 4);
  }
};

const christmasTree: Build = (b, w, d, h, _f, _c, _a, accentColor) => {
  const rand = random(1225);
  const needles = [mat("#2c5a32", { roughness: 0.9, side: THREE.DoubleSide }), mat("#3a6d3d", { roughness: 0.9, side: THREE.DoubleSide })];
  const bauble = mat(FINISHES[accentColor] ?? FINISHES.red, { metalness: 0.5, roughness: 0.22 });
  const lights = glowing(mat("#fff3c8", { emissive: "#ffd27a", emissiveIntensity: 0.9 }));
  const starM = glowing(mat("#ffd54a", { emissive: "#ffc93a", emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.3 }));
  const R = Math.min(w, d) / 2;
  // the stand and trunk
  const sr = Math.min(0.2, R * 0.33);
  const sh = Math.min(0.14, h * 0.07);
  b.cyl(sr * 0.8, sr, sh, 0, 0, 0, mat("#8a2420", { roughness: 0.5, metalness: 0.3 }), 20);
  for (let i = 0; i < 3; i++) {
    const ang = (i * Math.PI * 2) / 3;
    const foot = box(b, 0.04, 0.03, sr * 0.9, Math.sin(ang) * sr * 1.1, 0, Math.cos(ang) * sr * 1.1, mat("#2a2b2e"));
    if (foot) foot.rotation.y = ang;
  }
  const y0 = sh + Math.min(0.12, h * 0.05);
  b.cyl(0.035, 0.045, y0 + 0.2, 0, sh - 0.02, 0, mat(C.trunk, { roughness: 0.9 }), 8);
  // the fir: tiers of jagged cones, their tips drooping
  const starR = Math.min(0.1, h * 0.05);
  const yTop = h - starR * 2;
  const tiers = 7;
  const seg = 24;
  const span = yTop - y0;
  const env = (y: number) => Math.max(0, R * 0.96 * (1 - (y - y0) / span));
  const tierInfo: { yb: number; th: number; r: number }[] = [];
  for (let i = 0; i < tiers; i++) {
    const yb = y0 + span * (i / tiers) * 0.88;
    const th = i === tiers - 1 ? yTop - yb : span * 0.3;
    const r = env(yb) * (1 - 0.08 * (i % 2)) + 0.04;
    tierInfo.push({ yb, th, r });
    const geo = new THREE.ConeGeometry(r, th, seg, 3, true);
    const p = geo.attributes.position;
    const jit = Array.from({ length: seg }, () => rand());
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const z = p.getZ(k);
      const y = p.getY(k);
      if (Math.hypot(x, z) < 1e-4) continue;
      const j = Math.round((Math.atan2(z, x) / (Math.PI * 2)) * seg + seg) % seg;
      const low = (th / 2 - y) / th;
      const s = 1 + (j % 2 ? 0.16 : -0.1) * low + (jit[j] - 0.5) * 0.12 * low;
      p.setXYZ(k, x * s, y - (j % 2 ? 0.05 : 0) * low * low, z * s);
    }
    geo.computeVertexNormals();
    b.add(geo, needles[i % 2], 0, yb + th / 2, 0).rotation.y = i * 0.7;
  }
  // baubles on the tiers' lower parts
  const ball = new THREE.IcosahedronGeometry(Math.min(0.045, R * 0.075), 1);
  for (let i = 0; i < 26; i++) {
    const t = tierInfo[i % (tiers - 1)];
    const s = 0.12 + rand() * 0.3;
    const y = t.yb + s * t.th;
    const rr = t.r * (1 - s) + 0.01;
    const ang = rand() * Math.PI * 2;
    b.batch(ball.clone(), bauble, new THREE.Matrix4().makeTranslation(Math.cos(ang) * rr, y - 0.03, Math.sin(ang) * rr));
  }
  // fairy lights in a spiral round the tree
  const led = new THREE.OctahedronGeometry(0.014, 0);
  const count = 80;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const y = y0 + 0.05 + t * (span - 0.15);
    const ang = t * Math.PI * 2 * 6.5;
    const ti = tierInfo.filter((q) => y >= q.yb && y <= q.yb + q.th).pop() ?? tierInfo[0];
    const rr = ti.r * (1 - (y - ti.yb) / ti.th) * 0.96 + 0.01;
    b.batch(led.clone(), lights, new THREE.Matrix4().makeTranslation(Math.cos(ang) * rr, y, Math.sin(ang) * rr));
  }
  // the star on top, two crossed
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? starR * 0.45 : starR;
    if (i === 0) star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.016, bevelEnabled: false }).translate(0, 0, -0.008);
  b.add(sg, starM, 0, h - starR, 0);
  b.add(sg.clone().rotateY(Math.PI / 2), starM, 0, h - starR, 0);
};

/** Skin colours: the finishes made pumpkin-like. */
const PUMPKIN: Record<string, string> = { terracotta: "#d8782c", white: "#ece6d6", green: "#5f7a4a" };

/** Splits each triangle of a geometry into four, `times` over (non-indexed result). */
function subdivide(geo: THREE.BufferGeometry, times: number) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (let t = 0; t < times; t++) {
    const p = g.attributes.position;
    const out: number[] = [];
    const a = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i);
      c.fromBufferAttribute(p, i + 1);
      e.fromBufferAttribute(p, i + 2);
      const ac = a.clone().lerp(c, 0.5);
      const ce = c.clone().lerp(e, 0.5);
      const ea = e.clone().lerp(a, 0.5);
      for (const tri of [[a, ac, ea], [ac, c, ce], [ea, ce, e], [ac, ce, ea]]) for (const q of tri) out.push(q.x, q.y, q.z);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  }
  return g;
}

const pumpkin: Build = (b, w, d, h, _f, color) => {
  const skin = mat(PUMPKIN[color] ?? FINISHES[color] ?? PUMPKIN.terracotta, { roughness: 0.55 });
  const stemM = mat("#6b6a3a", { roughness: 0.85 });
  const lantern = b.options.carved !== "plain";
  const sh = h * 0.16;
  const Rx = (Math.min(w, d) / 2) * 0.98;
  // the dimples at top and bottom leave the body 0.8186·Ry below its centre: it stands on the
  // ground; a little taller than before (more makes the dimples fold), the stem reaching the top
  const Ry = (h - sh * 0.55) / (2 * 0.9);
  const yc = Ry * 0.8186;
  const lobes = 8;
  // a unit-sphere direction to the ribbed, dimpled surface
  const surface = (u: THREE.Vector3, out = 0, ribs = true) => {
    const phi = Math.atan2(u.z, u.x);
    const rib = ribs ? 1 - 0.09 * Math.pow(1 - Math.abs(Math.sin((phi * lobes) / 2)), 3) : 1;
    const rho = Math.hypot(u.x, u.z);
    const y = u.y * Ry - Math.sign(u.y) * Ry * 0.28 * (1 - rho) ** 2;
    const k = 1 + out;
    return V(u.x * Rx * rib * k, yc + y * k, u.z * Rx * rib * k);
  };
  const geo = new THREE.SphereGeometry(1, 40, 14);
  const p = geo.attributes.position;
  const u = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    u.fromBufferAttribute(p, i);
    const s = surface(u);
    p.setXYZ(i, s.x, s.y, s.z);
  }
  b.add(smooth(geo), skin);
  // the stem, curving out of the top's dimple
  const yS = yc + Ry * 0.72;
  const sr = Math.max(0.008, Rx * 0.09);
  const curve = new THREE.CatmullRomCurve3([V(0, yS - 0.01, 0), V(0.002, yS + sh * 0.5, 0.004), V(sr * 1.2, h - sr, sr * 0.8)]);
  b.add(new THREE.TubeGeometry(curve, 8, sr, 7), stemM);
  b.sphere(sr, sr * 1.2, h - sr, sr * 0.8, stemM, 1, 1, 1, 8);
  b.cyl(sr * 1.6, sr * 2.2, sr, 0, yS - sr * 0.6, 0, stemM, 8);
  if (!lantern) return;
  // the carved face, lit from inside: eyes, nose and a toothy grin on the skin
  const glow = glowing(mat("#ffc25a", { emissive: "#ffa030", emissiveIntensity: 1.1, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const faces: P[][] = [
    [[-0.44, 0.1], [-0.13, 0.1], [-0.29, 0.38]],
    [[0.13, 0.1], [0.44, 0.1], [0.29, 0.38]],
    [[-0.07, -0.04], [0.07, -0.04], [0, 0.1]],
    [[-0.52, -0.12], [-0.36, -0.36], [0, -0.47], [0.36, -0.36], [0.52, -0.12], [0.3, -0.24], [0.2, -0.14], [0.1, -0.26], [-0.1, -0.26], [-0.2, -0.14], [-0.3, -0.24]],
  ];
  for (const pts of faces) {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = subdivide(new THREE.ShapeGeometry(s), 3);
    const q = g.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i);
      const y = q.getY(i);
      // laid on the ribbed skin itself (into its grooves too), a hair above it: nothing stands
      // out of the round body's outline
      const sp = surface(V(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))), 0.003);
      q.setXYZ(i, sp.x, sp.y, sp.z);
    }
    b.add(smooth(g), glow);
  }
};

export const BUILDERS: Record<string, Build> = {
  car_pickup: (b, w, d, h, _f, color) => pickup(b, w, d, h, color),
  caravan: (b, w, d, h, _f, color) => caravan(b, w, d, h, color),
  motorhome: (b, w, d, h, _f, color) => motorhome(b, w, d, h, color),
  trailer: (b, w, d, h, _f, color) => trailer(b, w, d, h, color),
  hot_tub: hotTub,
  sauna_cabin: sauna,
  beach_chair: beachChair,
  kamado_grill: kamado,
  lawn_mower: lawnMower,
  sliding_gate: slidingGate,
  snowman,
  christmas_tree: christmasTree,
  pumpkin,
};
