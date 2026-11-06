// Built-in pieces added later: pools halloween. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
// Water is `part(…, "water")` (lit by a linked pump or light), the ghost, the cauldron's brew
// and fire glow with their linked light (`glowing`).
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINISHES } from "../../model/modern";
import { C, glowing, leafMat, mat, part, random, roundedRect, type Build, type Builder } from "../modern";

type M = THREE.Material;
type P = [number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ----- helpers -----

const waterMat = () => glowing(part(mat("#3fa4c8", { transparent: true, opacity: 0.7, roughness: 0.05 }), "water"));
/** A colour mixed towards another (black: darker, white: lighter). */
const mix = (hex: string, k: number, to = "#000000") => "#" + new THREE.Color(hex).lerp(new THREE.Color(to), k).getHexString();

/** Smooth normals across a seam: doubled vertices merged first. */
function smooth(geo: THREE.BufferGeometry) {
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  const g = mergeVertices(geo, 1e-5);
  g.computeVertexNormals();
  return g;
}

/** A box from its bottom centre (rounded only where it shows). */
function box(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: M, r = 0) {
  return b.box(w, h, d, x, y, z, m, r >= 0.008 ? r : 0);
}

/** A slab between an outline and its hole, lying from y up `t` (shape y is world −z). */
function plate(b: Builder, outer: THREE.Shape, hole: THREE.Path | null, y: number, t: number, m: M, z = 0, seg = 6) {
  if (hole) outer.holes.push(hole);
  return b.add(new THREE.ExtrudeGeometry(outer, { depth: t, bevelEnabled: false, curveSegments: seg }).rotateX(-Math.PI / 2), m, 0, y, z);
}
const circle = (r: number) => new THREE.Shape().absarc(0, 0, r, 0, Math.PI * 2, false);
const circlePath = (r: number) => new THREE.Path().absarc(0, 0, r, 0, Math.PI * 2, true);
const rect = (w: number, d: number) => {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -d / 2);
  s.lineTo(w / 2, -d / 2);
  s.lineTo(w / 2, d / 2);
  s.lineTo(-w / 2, d / 2);
  s.closePath();
  return s;
};
/** A flat outline lying at y, facing up. */
function sheet(b: Builder, s: THREE.Shape, y: number, m: M, x = 0, z = 0, seg = 6) {
  return b.add(new THREE.ShapeGeometry(s, seg).rotateX(-Math.PI / 2), m, x, y, z);
}
/** A turned surface through (radius, y) points: faces out while the points climb. */
function lathe(pts: P[], seg: number) {
  return new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}
/** A rod's geometry from a to c, for batching. */
function rodGeo(a: THREE.Vector3, c: THREE.Vector3, r: number, seg = 6, r2 = r) {
  const len = a.distanceTo(c);
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), c.clone().sub(a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, V(1, 1, 1)));
}
const ball = (r: number, p: THREE.Vector3, seg = 6) => new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)).translate(p.x, p.y, p.z);
/** A tube along points (CatmullRom). */
function tube(pts: THREE.Vector3[], r: number, seg = 20, radial = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), seg, r, radial, false);
}
/** A flat quad with its front towards `toward` (both windings checked). */
function quad(pts: THREE.Vector3[], toward: THREE.Vector3) {
  const [a, c, e] = pts;
  const n = c.clone().sub(a).cross(e.clone().sub(a));
  const p = n.dot(toward) >= 0 ? pts : [pts[0], pts[3], pts[2], pts[1]];
  const g = new THREE.BufferGeometry();
  const arr: number[] = [];
  for (const i of [0, 1, 2, 0, 2, 3]) arr.push(p[i].x, p[i].y, p[i].z);
  g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// ----- pools -----

const LINER = "#8fcbe0";

const poolFrame: Build = (b, w, d, h, f, color) => {
  const dark = color === "anthracite";
  const steel = mat(dark ? "#5b5f65" : color === "grey" ? "#c3c7cc" : "#dde1e5", { metalness: 0.55, roughness: 0.35 });
  const joint = mat(dark ? "#2e3034" : "#8d939a", { roughness: 0.5 });
  const sleeve = mat(mix(FINISHES[color] ?? FINISHES.blue, 0.18), { roughness: 0.7 });
  const linerIn = mat(LINER, { roughness: 0.55 });
  const plastic = mat("#e4e7ea", { roughness: 0.5 });
  // the ladder stands out in front: the pool keeps the back of the box
  const lo = Math.min(0.42, d * 0.2);
  const zc = -lo / 2;
  const lw = w - 0.07;
  const ld = d - lo - 0.07;
  const rr = 0.022;
  const yR = h - rr - 0.006;
  const t = 0.012;
  const cr = Math.min(0.12, lw * 0.05);
  // the liner: walls in the finish, light blue inside, a floor
  plate(b, roundedRect(lw, ld, cr), roundedRect(lw - 2 * t, ld - 2 * t, cr - t), 0, yR, f, zc);
  plate(b, roundedRect(lw - 2 * t - 0.002, ld - 2 * t - 0.002, cr - t - 0.001), roundedRect(lw - 2 * t - 0.008, ld - 2 * t - 0.008, cr - t - 0.004), 0.01, yR - 0.012, linerIn, zc);
  box(b, lw - 0.03, 0.01, ld - 0.03, 0, 0, zc, linerIn);
  // the sleeve round the top rail
  plate(b, roundedRect(lw + 0.05, ld + 0.05, cr + 0.025), roundedRect(lw - 0.03, ld - 0.03, cr - 0.015), yR - 0.07, h - (yR - 0.07), sleeve, zc);
  // legs with their T-joints and feet, outside the walls
  const legs: P[] = [];
  const nx = Math.max(2, Math.round((lw - 0.3) / 0.8));
  for (let i = 0; i <= nx; i++) for (const s of [-1, 1]) legs.push([-lw / 2 + 0.15 + (i * (lw - 0.3)) / nx, zc + s * (ld / 2 + 0.03)]);
  const nz = Math.max(1, Math.round(ld / 0.8));
  for (let i = 1; i < nz; i++) for (const s of [-1, 1]) legs.push([s * (lw / 2 + 0.03), zc - ld / 2 + (i * ld) / nz]);
  for (const s of [-1, 1]) for (const u of [-1, 1]) legs.push([s * (lw / 2 - cr * 0.3 + 0.022), zc + u * (ld / 2 - cr * 0.3 + 0.022)]);
  for (const [x, z] of legs) {
    b.batch(new THREE.CylinderGeometry(0.019, 0.019, yR - 0.08, 8), steel, new THREE.Matrix4().makeTranslation(x, 0.03 + (yR - 0.08) / 2, z));
    b.batch(new THREE.BoxGeometry(0.055, 0.09, 0.055), joint, new THREE.Matrix4().makeTranslation(x, yR - 0.035, z));
    b.batch(new THREE.BoxGeometry(0.06, 0.035, 0.09), joint, new THREE.Matrix4().makeTranslation(x, 0.0175, z));
  }
  // the hose fittings and drain valve at the back
  for (const [x, y] of [[-lw * 0.3, 0.12], [-lw * 0.3 + 0.35, yR - 0.22], [lw * 0.35, 0.06]] as P[]) {
    b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateX(Math.PI / 2), joint, x, y, zc - ld / 2 - 0.012);
    b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 10).rotateX(Math.PI / 2), plastic, x, y, zc - ld / 2 - 0.035);
  }
  // the water
  sheet(b, roundedRect(lw - 2 * t - 0.01, ld - 2 * t - 0.01, cr - t), yR - 0.13, waterMat(), 0, zc);
  // an A-frame ladder over the front wall (it reaches above the pool's edge)
  b.above(() => {
    const zE = zc + ld / 2;
    const L = lo - 0.02;
    const top = h + 0.24;
    const x0 = lw * 0.22;
    for (const sx of [-0.23, 0.23]) {
      const x = x0 + sx;
      b.batch(tube([V(x, 0.02, zE + L), V(x, h * 0.6, zE + L * 0.45), V(x, top - 0.05, zE + 0.07), V(x, top, zE), V(x, top - 0.05, zE - 0.07), V(x, h * 0.6, zE - L * 0.45), V(x, 0.02, zE - L)], rr * 0.9, 20, 6), steel);
      for (const s of [-1, 1]) b.batch(new THREE.BoxGeometry(0.05, 0.03, 0.08), joint, new THREE.Matrix4().makeTranslation(x, 0.015, zE + s * L));
    }
    for (let k = 1; k <= 3; k++) {
      const y = (k / 4) * (top - 0.05);
      const zz = 0.07 + (L - 0.07) * (1 - y / (top - 0.05)) * 0.92;
      for (const s of [-1, 1]) box(b, 0.46, 0.025, 0.1, x0, y - 0.0125, zE + s * zz, plastic, 0.008);
    }
    box(b, 0.5, 0.025, 0.16, x0, h + 0.02, zE, plastic, 0.008);
  });
};

const poolQuickUp: Build = (b, w, d, h, f, color) => {
  const R = Math.min(w, d) / 2;
  const rt = Math.min(0.13, h * 0.17);
  const Rt = R * 0.8;
  const yRing = h - rt;
  const top = yRing - rt * 0.2;
  const rTop = Rt + rt * 0.15;
  const ringM = mat(mix(FINISHES[color] ?? FINISHES.blue, 0.12, color === "white" ? "#000000" : "#ffffff"), { roughness: 0.3 });
  const linerIn = mat(LINER, { roughness: 0.5 });
  const dark = mat("#3a3d42", { roughness: 0.5 });
  // the walls slope out towards the ground (the weight of the water)
  const r = (y: number) => rTop + (R - rTop) * Math.pow(1 - y / top, 1.5);
  const n = 10;
  const out: P[] = [];
  for (let i = 0; i <= n; i++) out.push([r((i / n) * top), (i / n) * top]);
  b.add(lathe(out, 48), f);
  const inner: P[] = [];
  for (let i = n; i >= 0; i--) inner.push([r((i / n) * top) - 0.012, (i / n) * top]);
  b.add(lathe(inner, 48), linerIn);
  b.add(new THREE.CircleGeometry(R - 0.012, 48).rotateX(-Math.PI / 2), linerIn, 0, 0.004, 0);
  // the inflated ring on top
  b.add(new THREE.TorusGeometry(Rt, rt, 10, 48).rotateX(Math.PI / 2), ringM, 0, yRing, 0);
  b.add(new THREE.CylinderGeometry(0.012, 0.014, 0.025, 8), dark, Rt * Math.sin(0.6), h - 0.004, Rt * Math.cos(0.6));
  // hose fittings and the drain valve on the wall
  for (const [ang, y] of [[0.9, top * 0.18], [0.9, top * 0.62], [-1.2, 0.05]] as P[]) {
    const rr = r(y);
    for (const [len, rad, m] of [[0.04, 0.04, dark], [0.07, 0.022, mat("#d9dcdf")]] as [number, number, M][]) {
      const mesh = b.add(new THREE.CylinderGeometry(rad, rad, len, 12).rotateX(Math.PI / 2), m, Math.sin(ang) * (rr + len / 2 - 0.01), y + 0.02, Math.cos(ang) * (rr + len / 2 - 0.01));
      mesh.rotation.y = ang;
    }
  }
  // the water just under the ring
  const yW = yRing - rt - 0.05;
  b.add(new THREE.CircleGeometry(r(yW) - 0.014, 56).rotateX(-Math.PI / 2), waterMat(), 0, yW, 0);
};

/** Pool liner colours for the finishes (deeper water reads darker). */
const POOL: Record<string, string> = { blue: "#5fb0d6", white: "#d9edf2", anthracite: "#45535c", sand: "#d6c7a2" };
const MOSAIC: Record<string, [string, string]> = { blue: ["#1f5f8a", "#2f7fae"], white: ["#2f7fae", "#5aa2c9"], anthracite: ["#1d2328", "#2c353c"], sand: ["#2f6f8a", "#4a8fa8"] };

const poolInground: Build = (b, w, d, h, _f, color, a, accentColor) => {
  const base = POOL[color] ?? POOL.blue;
  const floorM = mat(base, { roughness: 0.6 });
  const wallM = mat(mix(base, 0.3), { roughness: 0.6 });
  const deepM = mat(mix(base, 0.22), { roughness: 0.6 });
  const midM = mat(mix(base, 0.11), { roughness: 0.6 });
  const stepM = mat(mix(base, 0.35, "#ffffff"), { roughness: 0.6 });
  const lineM = mat(mix(base, 0.6), { roughness: 0.6 });
  const tiles = (MOSAIC[color] ?? MOSAIC.blue).map((c) => mat(c, { roughness: 0.3 }));
  const jointM = mat(mix(FINISHES[accentColor] ?? FINISHES.concrete, 0.35), { roughness: 1 });
  const steel = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
  const cw = Math.min(0.32, w * 0.06, d * 0.08);
  const iw = w - 2 * cw;
  const id = d - 2 * cw;
  // the coping round the edge: the only raised part, with joints between its stones
  plate(b, roundedRect(w, d, 0.05), rect(iw, id), 0, h, a);
  const stone = 0.6;
  for (const s of [-1, 1]) {
    const n = Math.max(2, Math.round(w / stone));
    for (let i = 1; i < n; i++) b.batch(new THREE.BoxGeometry(0.008, 0.002, cw), jointM, new THREE.Matrix4().makeTranslation(-w / 2 + (i * w) / n, h, s * (d / 2 - cw / 2)));
    const m = Math.max(2, Math.round(id / stone));
    for (let i = 1; i < m; i++) b.batch(new THREE.BoxGeometry(cw, 0.002, 0.008), jointM, new THREE.Matrix4().makeTranslation(s * (w / 2 - cw / 2), h, -id / 2 + (i * id) / m));
  }
  // inside: the walls fall away as a sloping band (fake depth), the waterline tiles at
  // their top, the floor deepening towards one end, lane marks
  const yTop = h * 0.85;
  const yB = 0.002;
  const bw = Math.min(0.45, id * 0.1, iw * 0.1);
  const up = V(0, 1, 0);
  const corners = (inset: number, y: number) => [V(-iw / 2 + inset, y, -id / 2 + inset), V(iw / 2 - inset, y, -id / 2 + inset), V(iw / 2 - inset, y, id / 2 - inset), V(-iw / 2 + inset, y, id / 2 - inset)];
  const tileT = 0.25;
  const o = corners(0, yTop);
  const tl = corners(bw * tileT, yTop - (yTop - yB) * tileT);
  const inn = corners(bw, yB);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.batch(quad([tl[i], tl[j], inn[j], inn[i]], up), wallM);
    // the tiles: alternating colours along the side
    const len = o[i].distanceTo(o[j]);
    const n = Math.max(4, Math.round(len / 0.1));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      b.batch(quad([o[i].clone().lerp(o[j], t0), o[i].clone().lerp(o[j], t1), tl[i].clone().lerp(tl[j], t1), tl[i].clone().lerp(tl[j], t0)], up), tiles[k % 2]);
    }
  }
  const fx0 = -iw / 2 + bw;
  const fx1 = iw / 2 - bw;
  const fz = id / 2 - bw;
  const xs = fx0 + (fx1 - fx0) * 0.5;
  const xd = fx0 + (fx1 - fx0) * 0.62;
  b.batch(quad([V(fx0, yB, -fz), V(xs, yB, -fz), V(xs, yB, fz), V(fx0, yB, fz)], up), floorM);
  b.batch(quad([V(xs, yB, -fz), V(xd, yB, -fz), V(xd, yB, fz), V(xs, yB, fz)], up), midM);
  b.batch(quad([V(xd, yB, -fz), V(fx1, yB, -fz), V(fx1, yB, fz), V(xd, yB, fz)], up), deepM);
  const lane = Math.min(0.22, id * 0.05);
  for (const z of id > 2.4 ? [-id / 4, id / 4] : [0]) {
    b.batch(quad([V(fx0 + 0.6, yB + 0.001, z - lane / 2), V(fx1 - 0.6, yB + 0.001, z - lane / 2), V(fx1 - 0.6, yB + 0.001, z + lane / 2), V(fx0 + 0.6, yB + 0.001, z + lane / 2)], up), lineM);
    for (const x of [fx0 + 0.6, fx1 - 0.6]) b.batch(quad([V(x - lane / 2, yB + 0.0012, z - lane * 2.5), V(x + lane / 2, yB + 0.0012, z - lane * 2.5), V(x + lane / 2, yB + 0.0012, z + lane * 2.5), V(x - lane / 2, yB + 0.0012, z + lane * 2.5)], up), lineM);
  }
  // corner steps in the front right, white-edged
  const sMax = Math.min(1.4, iw * 0.2, id * 0.36);
  const yW = h * 0.6;
  for (let k = 0; k < 3; k++) {
    const s = (sMax * (3 - k)) / 3;
    const top = yW * (0.38 + 0.2 * k);
    box(b, s, top, s, iw / 2 - s / 2, 0, id / 2 - s / 2, stepM);
    box(b, s, 0.001, 0.04, iw / 2 - s / 2, top, id / 2 - s + 0.02, lineM);
    box(b, 0.04, 0.001, s - 0.04, iw / 2 - s + 0.02, top, id / 2 - s / 2 + 0.02, lineM);
  }
  // the skimmer lid in the coping, two lights in the back wall
  box(b, 0.24, 0.002, 0.24, -iw * 0.25, h, -d / 2 + cw / 2, mat("#e9ecee", { roughness: 0.5 }));
  const lamp = glowing(mat("#e8f6ff", { emissive: "#bfe9ff", emissiveIntensity: 0.8, roughness: 0.2 }));
  const slope = Math.atan2(yTop - yB, bw);
  for (const x of [-iw * 0.2, iw * 0.2]) b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.004, 16).rotateX(slope), lamp, x, yB + (yTop - yB) * 0.55, -id / 2 + bw * 0.45);
  // the water, just below the coping
  sheet(b, rect(iw, id), yW, waterMat());
  // a ladder at the back left and a handrail by the steps (they reach above the edge)
  b.above(() => {
    const lx = -iw / 2 + Math.min(1.0, iw * 0.15);
    const zDeck = -d / 2 + cw * 0.5;
    const zIn = -id / 2 + 0.1;
    for (const sx of [-0.24, 0.24]) {
      const x = lx + sx;
      b.batch(tube([V(x, h, zDeck), V(x, h + 0.3, zDeck), V(x, h + 0.42, (zDeck + zIn) / 2), V(x, h + 0.32, zIn), V(x, h * 0.6, zIn + 0.03), V(x, 0.004, zIn + 0.06)], 0.02, 24, 6), steel);
      b.batch(new THREE.CylinderGeometry(0.04, 0.04, 0.004, 12), steel, new THREE.Matrix4().makeTranslation(x, h + 0.002, zDeck));
    }
    for (const y of [h * 0.2, h * 0.45]) box(b, 0.46, 0.003, 0.08, lx, y, zIn + 0.06, steel);
    // the handrail beside the steps
    const hx = iw / 2 - sMax - 0.12;
    b.batch(tube([V(hx, h, d / 2 - cw * 0.5), V(hx, h + 0.3, d / 2 - cw * 0.5), V(hx, h + 0.4, id / 2 - 0.2), V(hx, h + 0.3, id / 2 - sMax * 0.6), V(hx, yW * 0.6, id / 2 - sMax + 0.05)], 0.02, 24, 6), steel);
    b.batch(new THREE.CylinderGeometry(0.04, 0.04, 0.004, 12), steel, new THREE.Matrix4().makeTranslation(hx, h + 0.002, d / 2 - cw * 0.5));
  });
};

const poolSteelWall: Build = (b, w, d, h, f, color) => {
  const so = Math.min(0.62, d * 0.14);
  const R = (d - so) / 2 - 0.02;
  const kx = (w / 2 - 0.02) / R;
  const zc = -so / 2;
  const groove = mat(color === "oak" ? "#5a4330" : "#1c1d20", { roughness: 1, side: THREE.DoubleSide });
  const dark = mat("#2b2c2e", { roughness: 0.9 });
  const linerIn = mat(LINER, { roughness: 0.5 });
  const band = mat("#2f6f96", { roughness: 0.4 });
  const steel = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
  const yRim = h - 0.045;
  const y0 = 0.07;
  const sc = (g: THREE.BufferGeometry) => g.scale(kx, 1, 1);
  // the cladding: one facet per board, joints between them, a dark plinth
  const boards = Math.max(24, Math.round((2 * Math.PI * R * (1 + kx)) / 2 / 0.14));
  const clad = new THREE.CylinderGeometry(R, R, yRim - y0, boards, 1, true).toNonIndexed();
  clad.computeVertexNormals();
  b.add(sc(clad), f, 0, y0 + (yRim - y0) / 2, zc);
  b.add(sc(new THREE.CylinderGeometry(R - 0.01, R - 0.01, y0, 48, 1, true)), dark, 0, y0 / 2, zc);
  for (let j = 0; j < boards; j++) {
    const th = (j / boards) * Math.PI * 2;
    const t = V(Math.cos(th) * 0.005 * kx, 0, -Math.sin(th) * 0.005);
    const c = V(Math.sin(th) * (R + 0.002) * kx, 0, zc + Math.cos(th) * (R + 0.002));
    const g = quad([c.clone().sub(t).setY(y0), c.clone().add(t).setY(y0), c.clone().add(t).setY(yRim), c.clone().sub(t).setY(yRim)], V(Math.sin(th) / kx, 0, Math.cos(th)));
    b.batch(g, groove);
  }
  // a rail board low down
  b.add(sc(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.1, boards, 1, true)), f, 0, y0 + 0.08, zc);
  // the top rim, a dark shadow line under it
  const ring = circle(R + 0.07);
  ring.holes.push(circlePath(R - 0.1));
  b.add(sc(new THREE.ExtrudeGeometry(ring, { depth: h - yRim, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2)), f, 0, yRim, zc);
  b.add(sc(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.012, 48, 1, true)), groove, 0, yRim - 0.012, zc);
  // inside: the liner (inward faces), its printed band, the floor
  const yIn = yRim - 0.002;
  b.add(sc(lathe([[R - 0.09, yIn], [R - 0.09, yIn - 0.16]], 48)), band, 0, 0, zc);
  b.add(sc(lathe([[R - 0.09, yIn - 0.16], [R - 0.09, 0.01], [0.001, 0.01]], 48)), linerIn, 0, 0, zc);
  // the water
  const yW = h - 0.2;
  b.add(sc(new THREE.CircleGeometry(R - 0.095, 48).rotateX(-Math.PI / 2)), waterMat(), 0, yW, zc);
  // a wooden stair up to the rim at the front, a steel ladder down into the water
  const zf = zc + R - 0.04;
  const run = d / 2 - zf;
  const sw = Math.min(0.7, w * 0.18);
  const n = 4;
  for (let k = 1; k <= n; k++) {
    const y = (yRim - 0.03) * (k / n);
    const zt = d / 2 - (k - 0.5) * (run / n);
    box(b, sw, 0.035, run / n + 0.03, 0, y - 0.035, Math.min(zt, d / 2 - (run / n + 0.03) / 2), f, 0.008);
  }
  for (const sx of [-1, 1]) {
    const a0 = V(sx * (sw / 2 + 0.02), 0.06, d / 2 - 0.05);
    const a1 = V(sx * (sw / 2 + 0.02), yRim - 0.08, zf);
    const len = a0.distanceTo(a1);
    const g = new THREE.BoxGeometry(0.035, 0.14, len + 0.1).rotateX(Math.atan2(a1.y - a0.y, a0.z - a1.z));
    b.add(g, f, a0.x, (a0.y + a1.y) / 2, (a0.z + a1.z) / 2);
  }
  for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.012, 0.012, yRim - 0.2, 8), steel, sx * 0.22, 0.15 + (yRim - 0.2) / 2, zc + R - 0.16);
  for (const y of [0.35, 0.6].map((t) => t * yRim)) box(b, 0.44, 0.02, 0.07, 0, y, zc + R - 0.16, steel);
  // the handrails (they reach above the rim)
  b.above(() => {
    for (const sx of [-1, 1]) {
      const x = sx * (sw / 2 + 0.02);
      const p0 = V(x, (yRim - 0.03) / n + 0.75, d / 2 - run / n / 2);
      const p1 = V(x, h + 0.35, zf + 0.05);
      box(b, 0.045, p0.y - 0.06, 0.045, x, 0.06, p0.z, f);
      box(b, 0.045, p1.y - yRim, 0.045, x, yRim, p1.z, f);
      const g = new THREE.BoxGeometry(0.05, 0.04, p0.distanceTo(p1) + 0.05).rotateX(Math.atan2(p1.y - p0.y, p0.z - p1.z));
      b.add(g, f, x, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
    }
  });
};

const paddlingPool: Build = (b, w, d, h, _f, color) => {
  const R = Math.min(w, d) / 2;
  const rt = h / 6;
  const Rc = R - rt;
  // toy colours: the finishes made brighter
  const hex = ({ blue: "#3f8fd8", pink: "#ee8ab0", green: "#56b865", yellow: "#f2c72a" } as Record<string, string>)[color] ?? FINISHES[color] ?? "#3f8fd8";
  const shiny = mat(hex, { roughness: 0.3 });
  const white = mat("#f3f2ee", { roughness: 0.3 });
  const floorM = mat(mix(hex, 0.45, "#ffffff"), { roughness: 0.5 });
  const valve = mat("#f3f2ee", { roughness: 0.4 });
  // three stacked air rings, a floor between them
  [shiny, white, shiny].forEach((m, i) => {
    b.add(new THREE.TorusGeometry(Rc, rt * 1.02, 8, 36).rotateX(Math.PI / 2), m, 0, rt * (1 + 2 * i), 0);
    const ang = 0.8 + i * 2.1;
    b.add(new THREE.CylinderGeometry(rt * 0.18, rt * 0.22, rt * 0.3, 8).rotateX(Math.PI / 2), i === 1 ? shiny : valve, Math.sin(ang) * (Rc + rt * 0.95), rt * (1 + 2 * i), Math.cos(ang) * (Rc + rt * 0.95)).rotation.y = ang;
  });
  b.add(new THREE.CircleGeometry(Rc, 36).rotateX(-Math.PI / 2), floorM, 0, 0.004, 0);
  // the water
  const yW = rt * 3.6;
  b.add(new THREE.CircleGeometry(Rc - rt * 0.55, 36).rotateX(-Math.PI / 2), waterMat(), 0, yW, 0);
  // a rubber duck afloat
  const duck = mat("#f2cf2a", { roughness: 0.4 });
  const s = Math.min(0.07, R * 0.1);
  const dx = Rc * 0.35;
  const dz = Rc * 0.2;
  b.sphere(s, dx, yW + s * 0.35, dz, duck, 1.25, 0.8, 1, 12);
  b.sphere(s * 0.6, dx + s * 0.75, yW + s * 1.15, dz, duck, 1, 1, 1, 10);
  b.add(new THREE.ConeGeometry(s * 0.22, s * 0.45, 8).rotateZ(-Math.PI / 2), mat("#e8792a", { roughness: 0.5 }), dx + s * 1.45, yW + s * 1.08, dz);
  for (const z of [-1, 1]) b.sphere(s * 0.08, dx + s * 1.1, yW + s * 1.3, dz + z * s * 0.27, mat(C.black), 1, 1, 1, 6);
};

// ----- halloween and autumn -----

const skeleton: Build = (b, w, d, h) => {
  const bone = mat("#e9e3d0", { roughness: 0.55 });
  const hole = mat("#1b1a1a", { roughness: 0.9 });
  const metal = mat("#2b2c2e", { metalness: 0.5, roughness: 0.5 });
  const k = h / 1.75;
  const kx = Math.min(k, w / 0.5);
  const kz = Math.min(k, d / 0.4);
  const P = (x: number, y: number, z: number) => V(x * kx, y * k, z * kz);
  const B = (g: THREE.BufferGeometry) => b.batch(g, bone);
  /** A long bone: a shaft with knobby ends. */
  const long = (a: THREE.Vector3, c: THREE.Vector3, r: number) => {
    B(rodGeo(a, c, r * k, 6));
    B(ball(r * 1.55 * k, a));
    B(ball(r * 1.45 * k, c));
  };
  const thin = (a: THREE.Vector3, c: THREE.Vector3, r: number) => B(rodGeo(a, c, r * k, 5));
  // the hidden stand: a plate and a stake behind the spine
  b.cyl(0.1 * kz, 0.11 * kz, 0.012, 0, 0, -0.1 * kz, metal, 16);
  b.add(rodGeo(P(0, 0.01, -0.1), P(0, 1.0, -0.06), 0.008, 6), metal);
  // legs: femur, kneecap, shin bones, the foot's heel and toes (the right knee a little bent)
  for (const [s, knee, ankle] of [
    [-1, P(-0.1, 0.5, 0.02), P(-0.1, 0.08, -0.01)],
    [1, P(0.1, 0.5, 0.07), P(0.11, 0.085, 0.0)],
  ] as [number, THREE.Vector3, THREE.Vector3][]) {
    const hip = P(s * 0.085, 0.93, 0);
    long(hip, knee, 0.021);
    B(ball(0.022 * k, knee.clone().add(V(0, 0.005, 0.03 * k)), 7));
    long(knee, ankle, 0.017);
    thin(knee.clone().add(V(s * 0.025 * kx, -0.03, -0.01)), ankle.clone().add(V(s * 0.02 * kx, 0.02, -0.01)), 0.007);
    B(ball(0.028 * k, ankle.clone().add(V(0, -0.045 * k, -0.015 * kz)), 7));
    for (let t = -1; t <= 1; t++) thin(ankle.clone().add(V(t * 0.012 * kx, -0.05 * k, 0)), ankle.clone().add(V(s * 0.01 * kx + t * 0.022 * kx, -0.07 * k, 0.15 * kz)), 0.009);
  }
  // the pelvis: two flared hip blades, the sacrum, the pubic arch
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(0.075 * k, 10, 6).scale((0.9 * kx) / k, 0.85, 0.22).rotateZ(-s * 0.35).rotateY(s * 0.7);
    B(g.translate(s * 0.085 * kx, 1.0 * k, -0.01 * kz));
  }
  B(new THREE.BoxGeometry(0.07 * kx, 0.09 * k, 0.03 * kz).translate(0, 0.98 * k, -0.05 * kz));
  B(new THREE.TorusGeometry(0.06 * kx, 0.014 * k, 5, 12, Math.PI).rotateX(Math.PI / 2).rotateX(0.5).translate(0, 0.92 * k, -0.005 * kz));
  // the spine: vertebrae up an S-curve
  const spine = (t: number) => P(0, 1.0 + t * 0.53, -0.04 - 0.045 * Math.sin(t * Math.PI * 0.95) + 0.02 * t);
  const nv = 16;
  for (let i = 0; i < nv; i++) {
    const p = spine(i / (nv - 1));
    const r = (0.022 - 0.008 * (i / nv)) * k;
    B(new THREE.CylinderGeometry(r, r, 0.022 * k, 6).translate(p.x, p.y, p.z));
  }
  // the ribcage: ribs curving round from the spine and down to the breastbone
  const back = spine(0.72).z;
  for (let i = 0; i < 7; i++) {
    const y = (1.44 - i * 0.042) * k;
    const rx = [0.075, 0.1, 0.115, 0.125, 0.128, 0.125, 0.118][i] * kx;
    const rz = rx * 0.78 * (kz / kx);
    const zc = back + rz;
    const end = i < 5 ? Math.PI / 2 - 0.25 : Math.PI / 2 - 0.9;
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 6; j++) {
        const th = -Math.PI / 2 + ((end + Math.PI / 2) * j) / 6;
        pts.push(V(s * rx * Math.cos(th), y - 0.05 * k * ((Math.sin(th) + 1) / 2), zc + rz * Math.sin(th)));
      }
      B(tube(pts, 0.008 * k, 7, 4));
      B(ball(0.009 * k, pts[6], 5));
    }
    if (i === 0) {
      // the breastbone and collarbones
      const top = V(0, y + 0.01 * k, zc + rz - 0.004);
      B(rodGeo(top, V(0, y - 0.19 * k, zc + rz - 0.01), 0.013 * k, 5));
      for (const s of [-1, 1]) thin(top, P(s * 0.165, 1.465, -0.02), 0.009);
    }
  }
  // shoulder blades
  for (const s of [-1, 1]) B(new THREE.SphereGeometry(0.07 * k, 8, 5).scale(0.65, 0.85, 0.18).rotateZ(s * 0.25).translate(s * 0.085 * kx, 1.37 * k, back - 0.02 * k));
  // arms: the left hanging, the right raised in a wave
  for (const [s, elbow, wrist, tip] of [
    [-1, P(-0.2, 1.16, 0.0), P(-0.205, 0.92, 0.05), P(-0.195, 0.82, 0.07)],
    [1, P(0.225, 1.2, 0.06), P(0.215, 1.44, 0.13), P(0.2, 1.55, 0.15)],
  ] as [number, THREE.Vector3, THREE.Vector3, THREE.Vector3][]) {
    const sh = P(s * 0.175, 1.44, -0.02);
    long(sh, elbow, 0.018);
    thin(elbow, wrist.clone().add(V(-s * 0.008 * kx, 0, 0)), 0.008);
    thin(elbow.clone().add(V(0, 0, 0.01 * kz)), wrist.clone().add(V(s * 0.008 * kx, 0, 0.008 * kz)), 0.007);
    // the hand: a palm, four fingers and a thumb, spread a little
    const dir = tip.clone().sub(wrist).normalize();
    const palm = wrist.clone().add(dir.clone().multiplyScalar(0.04 * k));
    B(rodGeo(wrist, palm, 0.016 * k, 5, 0.019 * k));
    const side = V(1, 0, 0).cross(dir).normalize().cross(dir).normalize();
    for (let f = 0; f < 4; f++) {
      const o = side.clone().multiplyScalar((f - 1.5) * 0.009 * k);
      thin(palm.clone().add(o), tip.clone().add(o.clone().multiplyScalar(1.6)), 0.004);
    }
    thin(wrist.clone().add(V(0, 0, 0.012 * kz)), palm.clone().add(V(0, 0, 0.04 * kz)), 0.005);
  }
  // the neck and the skull, turned a little: cranium, cheekbones, eye sockets, nose, teeth, jaw
  for (let i = 0; i < 3; i++) {
    const y = (1.535 + i * 0.022) * k;
    B(new THREE.CylinderGeometry(0.014 * k, 0.014 * k, 0.016 * k, 7).translate(0, y, -0.025 * kz));
  }
  const turn = new THREE.Matrix4().makeRotationY(0.3).premultiply(new THREE.Matrix4().makeTranslation(0, 0, -0.01 * kz));
  const head = (g: THREE.BufferGeometry, m: M) => b.batch(g, m, turn.clone());
  head(new THREE.SphereGeometry(0.095 * k, 12, 8).scale(0.82, 0.95, 1.05).translate(0, 1.655 * k, 0), bone);
  head(new THREE.SphereGeometry(1, 12, 8).scale(0.06 * k, 0.04 * k, 0.05 * k).translate(0, 1.592 * k, 0.035 * k), bone);
  head(new THREE.BoxGeometry(0.066 * k, 0.026 * k, 0.03 * k).translate(0, 1.556 * k, 0.066 * k), bone);
  head(new THREE.SphereGeometry(1, 12, 6).scale(0.048 * k, 0.022 * k, 0.05 * k).rotateX(0.12).translate(0, 1.532 * k, 0.04 * k), bone);
  for (const s of [-1, 1]) head(new THREE.SphereGeometry(0.023 * k, 8, 6).scale(1, 0.9, 0.5).translate(s * 0.034 * k, 1.638 * k, 0.083 * k), hole);
  head(new THREE.ConeGeometry(0.011 * k, 0.026 * k, 3).rotateZ(Math.PI).translate(0, 1.6 * k, 0.081 * k), hole);
  head(new THREE.BoxGeometry(0.07 * k, 0.006 * k, 0.006 * k).translate(0, 1.556 * k, 0.081 * k), hole);
  for (let i = -3; i <= 3; i++) head(new THREE.BoxGeometry(0.002 * k, 0.02 * k, 0.004 * k).translate(i * 0.01 * k, 1.556 * k, 0.083 * k), hole);
};

const tombstones: Build = (b, w, d, h, f, color) => {
  const rand = random(1031);
  const base = FINISHES[color] ?? FINISHES.grey;
  const stones = [f, mat(mix(base, 0.12), { roughness: 0.9 }), mat(mix(base, 0.1, "#ffffff"), { roughness: 0.9 }), mat(mix(base, 0.2, "#6b6a55"), { roughness: 0.9 })];
  const cut = mat(mix(base, 0.55), { roughness: 1 });
  const moss = mat("#5d6b3a", { roughness: 1 });
  const soil = mat("#4f3d2c", { roughness: 1 });
  const blades = [leafMat("#4f6e36"), leafMat("#6f7d3e"), leafMat("#8a7f4a")];
  // outlines (x across, y up from the ground) of an arch, a cross, a shouldered stone, a broken slab
  const arch = (sw: number, sh: number) => {
    const s = new THREE.Shape();
    s.moveTo(-sw / 2, 0);
    s.lineTo(sw / 2, 0);
    s.lineTo(sw / 2, sh - sw / 2);
    s.absarc(0, sh - sw / 2, sw / 2, 0, Math.PI, false);
    s.closePath();
    return s;
  };
  const cross = (sw: number, sh: number) => {
    const a = sw * 0.17;
    const yArm = sh * 0.68;
    const pts: P[] = [[-a * 1.6, 0], [a * 1.6, 0], [a * 1.6, sh * 0.14], [a, sh * 0.14], [a, yArm - a], [sw / 2, yArm - a], [sw / 2, yArm + a], [a, yArm + a], [a, sh], [-a, sh], [-a, yArm + a], [-sw / 2, yArm + a], [-sw / 2, yArm - a], [-a, yArm - a], [-a, sh * 0.14], [-a * 1.6, sh * 0.14]];
    return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  };
  const shoulder = (sw: number, sh: number) => {
    const s = new THREE.Shape();
    s.moveTo(-sw / 2, 0);
    s.lineTo(sw / 2, 0);
    s.lineTo(sw / 2, sh * 0.78);
    s.lineTo(sw * 0.36, sh * 0.78);
    s.quadraticCurveTo(sw * 0.3, sh, 0, sh);
    s.quadraticCurveTo(-sw * 0.3, sh, -sw * 0.36, sh * 0.78);
    s.lineTo(-sw / 2, sh * 0.78);
    s.closePath();
    return s;
  };
  const broken = (sw: number, sh: number) => {
    const pts: P[] = [[-sw / 2, 0], [sw / 2, 0], [sw / 2, sh * 0.72], [sw * 0.2, sh * 0.9], [sw * 0.05, sh * 0.78], [-sw * 0.15, sh], [-sw * 0.32, sh * 0.86], [-sw / 2, sh * 0.93]];
    return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  };
  const plan = [
    { make: arch, w: 0.3, h: 0.8 },
    { make: cross, w: 0.3, h: 1.0 },
    { make: shoulder, w: 0.3, h: 0.66 },
    { make: broken, w: 0.24, h: 0.5 },
  ];
  const gap = 0.06;
  const total = plan.reduce((s, p) => s + p.w, 0) + gap * (plan.length - 1);
  const ks = Math.min(1, (w - 0.08) / total);
  const t = Math.min(0.08, d * 0.16);
  const zS = -d / 2 + t / 2 + 0.04;
  let x = -(total * ks) / 2;
  plan.forEach((p, i) => {
    const sw = p.w * ks;
    const sh = (h - 0.03) * p.h;
    const cx = x + sw / 2;
    x += sw + gap * ks;
    // the stone, tilted, its lowest corner on the ground
    const tiltZ = (rand() - 0.5) * 0.14;
    const tiltX = -0.03 - rand() * 0.07;
    const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tiltX, 0, tiltZ));
    const geo = new THREE.ExtrudeGeometry(p.make(sw, sh), { depth: t, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 10 }).translate(0, 0, -t / 2).applyMatrix4(rot);
    geo.computeBoundingBox();
    const lift = -geo.boundingBox!.min.y;
    const place = new THREE.Matrix4().makeTranslation(cx, lift, zS).multiply(rot);
    b.add(geo.translate(cx, lift, zS), stones[i]);
    // engraving lines on the front, moss low down
    const face = t / 2 + 0.007;
    const lines: [number, number, number][] = i === 1 ? [[0.3, 0.07, 0.008]] : [[0.45, 0.62, 0.012], [0.6, 0.48, 0.008], [0.5, 0.4, 0.008]];
    for (const [lw, ly, lh] of lines) {
      const len = sw * lw;
      b.batch(new THREE.BoxGeometry(len, lh * 1.4, 0.004), cut, place.clone().multiply(new THREE.Matrix4().makeTranslation(0, sh * ly, face)));
    }
    for (let m = 0; m < 3; m++) {
      const g = new THREE.SphereGeometry(0.018, 6, 4).scale(1 + rand(), 0.5 + rand() * 0.5, 0.2);
      b.batch(g, moss, place.clone().multiply(new THREE.Matrix4().makeTranslation((rand() - 0.5) * sw * 0.6, 0.02 + rand() * sh * 0.25, face - 0.003)));
    }
    // the grave's mound in front, grass round it
    const ml = Math.min(0.42, d - t - 0.06);
    const mz = zS + t / 2 + ml / 2 - 0.01;
    b.add(new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(sw * 0.48, Math.min(0.06, h * 0.09), ml / 2), soil, cx, 0, mz);
    for (let g = 0; g < 34; g++) {
      const a = rand() * Math.PI * 2;
      const rr = 0.85 + rand() * 0.3;
      const gx = cx + Math.cos(a) * sw * 0.5 * rr;
      const gz = Math.min(d / 2 - 0.02, Math.max(-d / 2 + 0.02, mz + Math.sin(a) * (ml / 2) * rr));
      const len = 0.05 + rand() * 0.07;
      const bl = new THREE.BufferGeometry();
      const lean = (rand() - 0.5) * 0.04;
      bl.setAttribute("position", new THREE.Float32BufferAttribute([-0.008, 0, 0, 0.008, 0, 0, lean, len, lean * 0.5], 3));
      bl.computeVertexNormals();
      b.batch(bl, blades[g % 3], new THREE.Matrix4().makeRotationY(rand() * Math.PI).premultiply(new THREE.Matrix4().makeTranslation(gx, 0, gz)));
    }
  });
};

const ghost: Build = (b, w, d, h) => {
  const sheetM = glowing(mat("#f2f4f7", { emissive: "#d8e4ff", emissiveIntensity: 0.25, roughness: 0.9, side: THREE.DoubleSide }));
  const eyeM = mat("#141416", { roughness: 1 });
  const metal = mat("#2b2c2e", { metalness: 0.5, roughness: 0.5 });
  const R = (Math.min(w, d) / 2) * 0.96;
  const rh = Math.min(R * 0.42, h * 0.11);
  const yHead = h - rh;
  const hem = h * 0.16;
  const seg = 48;
  const rows = 22;
  const headRows = 7;
  const r0 = rh * Math.sin(Math.PI * 0.6);
  const at = (i: number, j: number) => {
    const th = (j / seg) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    let r: number;
    let y: number;
    if (i <= headRows) {
      const phi = (i / headRows) * Math.PI * 0.6;
      r = rh * Math.sin(phi);
      y = yHead + rh * Math.cos(phi);
    } else {
      const u = (i - headRows) / (rows - headRows);
      const y0 = yHead + rh * Math.cos(Math.PI * 0.6);
      r = r0 + (R - r0) * Math.pow(u, 1.15);
      y = y0 - u * (y0 - hem);
      // the stand's arms spread the sheet sideways under the head
      const arm = Math.exp(-(((u - 0.2) / 0.12) ** 2)) * Math.pow(Math.abs(c), 4);
      r += Math.max(0, R * 0.82 - r) * arm;
      // folds deepen towards the hem, which rises and falls
      r *= 1 + 0.15 * Math.pow(u, 1.3) * Math.sin(7 * th + 1.3) + 0.06 * u * Math.sin(3 * th + 0.5);
      y += u * u * 0.05 * Math.sin(7 * th + 1.3) * (h / 1.5);
    }
    return V(c * r, y, s * r);
  };
  const pos: number[] = [];
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < seg; j++) {
      const a = at(i, j);
      const c = at(i + 1, j);
      const e = at(i + 1, j + 1);
      const g = at(i, j + 1);
      if (i > 0) pos.push(a.x, a.y, a.z, g.x, g.y, g.z, e.x, e.y, e.z);
      pos.push(a.x, a.y, a.z, e.x, e.y, e.z, c.x, c.y, c.z);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  b.add(smooth(geo), sheetM);
  // the eye holes and a round mouth on the face
  const face = (ax: number, ay: number) => V(rh * Math.sin(ax) * Math.cos(ay), yHead + rh * Math.sin(ay), rh * Math.cos(ax) * Math.cos(ay));
  for (const s of [-1, 1]) {
    const p = face(s * 0.36, 0.05);
    b.sphere(rh * 0.2, p.x, p.y, p.z - rh * 0.05, eyeM, 0.8, 1.5, 0.5, 12).rotation.y = s * 0.36;
  }
  const m = face(0, -0.42);
  b.sphere(rh * 0.13, m.x, m.y, m.z - rh * 0.04, eyeM, 1, 1.4, 0.5, 10);
  // the stand: a base and a pole under the hem
  b.cyl(R * 0.4, R * 0.45, 0.015, 0, 0, 0, metal, 20);
  b.cyl(0.012, 0.012, hem + h * 0.2, 0, 0.015, 0, metal, 8);
};

const cauldron: Build = (b, w, d, h) => {
  const iron = mat("#1e1f22", { metalness: 0.45, roughness: 0.55 });
  const brew = glowing(mat("#76e04a", { emissive: "#4cff2a", emissiveIntensity: 0.8, roughness: 0.3 }));
  const fireM = glowing(mat("#ff8a2a", { emissive: "#ff6a10", emissiveIntensity: 1, roughness: 1 }));
  const bark = mat("#4a3524", { roughness: 1 });
  const wood = mat("#b48a5c", { roughness: 0.9 });
  const R = (Math.min(w, d) / 2) * 0.76;
  const yb = Math.min(0.12, h * 0.22);
  const top = h - Math.min(0.06, h * 0.1);
  const ht = top - yb;
  // the pot: round belly, a neck, a rolled lip, then down inside to the brew
  const yBrew = top - ht * 0.14;
  const belly = new THREE.SplineCurve(
    ([[0.001, yb], [R * 0.5, yb + ht * 0.025], [R * 0.86, yb + ht * 0.16], [R, yb + ht * 0.42], [R * 0.95, yb + ht * 0.68], [R * 0.82, yb + ht * 0.88], [R * 0.79, top - 0.014]] as P[]).map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const pot: P[] = [...belly.getPoints(22).map((q): P => [q.x, q.y]), [R * 0.84, top], [R * 0.78, top], [R * 0.74, top - 0.02], [R * 0.72, yBrew - 0.02]];
  b.add(smooth(lathe(pot, 32)), iron);
  b.add(new THREE.TorusGeometry(R * 0.81, 0.012, 6, 32).rotateX(Math.PI / 2), iron, 0, top - 0.006, 0);
  // lug handles on the sides, three short legs
  for (const s of [-1, 1]) b.add(new THREE.TorusGeometry(R * 0.12, R * 0.025, 6, 12), iron, s * R * 0.86, top - ht * 0.14, 0).rotation.y = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
    b.add(rodGeo(V(Math.cos(a) * R * 0.5, yb + ht * 0.08, Math.sin(a) * R * 0.5), V(Math.cos(a) * R * 0.62, 0.005, Math.sin(a) * R * 0.62), R * 0.06, 8, R * 0.05), iron);
  }
  // the bubbling brew, glowing
  b.add(new THREE.CircleGeometry(R * 0.73, 32).rotateX(-Math.PI / 2), brew, 0, yBrew, 0);
  const rand = random(1313);
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const rr = rand() * R * 0.55;
    const s = R * (0.06 + rand() * 0.08);
    b.batch(new THREE.SphereGeometry(s, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), brew, new THREE.Matrix4().makeTranslation(Math.cos(a) * rr, yBrew - s * 0.15, Math.sin(a) * rr));
  }
  for (const [x, y, s] of [[0.15, 0.45, 0.05], [-0.2, 0.75, 0.035]] as [number, number, number][]) b.sphere(R * s, R * x, yBrew + (h - yBrew) * y, R * 0.1, brew, 1, 1, 1, 10);
  // the fire under it: logs in a star, embers and flames between them
  const lr = Math.min(0.035, yb * 0.3);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.4;
    const p0 = V(Math.cos(a) * R * 0.95, lr, Math.sin(a) * R * 0.95);
    const p1 = V(Math.cos(a) * R * 0.12, lr + 0.01, Math.sin(a) * R * 0.12);
    b.batch(rodGeo(p0, p1, lr, 8), bark);
    const out = p0.clone().sub(p1).normalize();
    b.batch(new THREE.CircleGeometry(lr * 0.92, 8).lookAt(out).translate(p0.x + out.x * 0.0008, p0.y + out.y * 0.0008, p0.z + out.z * 0.0008), wood);
  }
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const rr = R * (0.15 + rand() * 0.35);
    const fh = yb * (0.6 + rand() * 0.5);
    b.batch(new THREE.ConeGeometry(lr * (0.8 + rand() * 0.5), fh, 6), fireM, new THREE.Matrix4().makeTranslation(Math.cos(a) * rr, fh / 2, Math.sin(a) * rr));
  }
};

const spiderWeb: Build = (b, w, d, h) => {
  const silk = mat("#e9edf0", { roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const black = mat("#141416", { roughness: 0.35, metalness: 0.1 });
  const red = mat("#b02a2a", { roughness: 0.35 });
  const rand = random(666);
  const z = -d / 2 + Math.min(0.02, d * 0.4);
  const cx = w * 0.04;
  const cy = h * 0.54;
  const tw = Math.max(0.003, Math.min(w, h) * 0.0035);
  const pos: number[] = [];
  /** A thread from p to q: a thin strip facing the room. */
  const thread = (p: THREE.Vector2, q: THREE.Vector2, t = tw) => {
    const n = new THREE.Vector2(-(q.y - p.y), q.x - p.x).normalize().multiplyScalar(t / 2);
    const a = [p.x - n.x, p.y - n.y];
    const c = [q.x - n.x, q.y - n.y];
    const e = [q.x + n.x, q.y + n.y];
    const g = [p.x + n.x, p.y + n.y];
    for (const pt of [a, c, e, a, e, g]) pos.push(pt[0], pt[1], z);
  };
  // radial threads out to the edges of the box
  const n = 11;
  const dirs: { a: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tx = dx > 1e-6 ? (w / 2 - 0.01 - cx) / dx : dx < -1e-6 ? (-w / 2 + 0.01 - cx) / dx : Infinity;
    const ty = dy > 1e-6 ? (h - 0.01 - cy) / dy : dy < -1e-6 ? (0.01 - cy) / dy : Infinity;
    dirs.push({ a, len: Math.min(tx, ty) });
  }
  const c0 = new THREE.Vector2(cx, cy);
  const at = (i: number, r: number) => {
    const { a, len } = dirs[i % n];
    const rr = Math.min(r, len);
    return new THREE.Vector2(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  };
  for (let i = 0; i < n; i++) thread(c0, at(i, Infinity));
  // the spiral: rings sagging between the radials
  const rMax = Math.min(w, h) * 0.46;
  const rings = 9;
  for (let k = 1; k <= rings; k++) {
    for (let i = 0; i < n; i++) {
      const r0 = rMax * Math.pow((k + i / n) / (rings + 1), 0.95);
      const r1 = rMax * Math.pow((k + (i + 1) / n) / (rings + 1), 0.95);
      const p = at(i, r0);
      const q = at(i + 1, r1);
      const mid = p.clone().add(q).multiplyScalar(0.5).lerp(c0, 0.06);
      thread(p, mid, tw * 0.8);
      thread(mid, q, tw * 0.8);
    }
  }
  // anchor threads across two corners
  thread(at(1, Infinity), at(2, Infinity));
  thread(at(6, Infinity), at(7, Infinity));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  b.add(geo, silk);
  // the spider, down and right of the centre on the web
  const s = Math.min(0.05, Math.min(w, h) * 0.045);
  const sx = cx + rMax * 0.42;
  const sy = cy - rMax * 0.3;
  const sz = z + s * 0.6;
  b.sphere(s, sx, sy - s * 0.6, sz, black, 0.9, 1.15, 0.75, 12);
  b.sphere(s * 0.6, sx, sy + s * 0.75, sz, black, 1, 1, 0.8, 10);
  for (const e of [-1, 1]) b.sphere(s * 0.1, sx + e * s * 0.2, sy + s * 1.15, sz + s * 0.35, red, 1, 1, 1, 6);
  b.sphere(s * 0.35, sx, sy - s * 0.5, sz + s * 0.66, red, 1, 1.3, 0.3, 8);
  for (const e of [-1, 1])
    for (let l = 0; l < 4; l++) {
      const a = (l - 1.5) * 0.45;
      const root = V(sx + e * s * 0.4, sy + s * 0.75 + a * s * 0.3, sz);
      const knee = V(sx + e * s * (1.4 + 0.2 * Math.cos(a)), sy + s * 0.75 + Math.sin(a) * s * 1.6 + s * 0.5, sz + s * 0.45);
      const foot = V(sx + e * s * (2.0 + 0.4 * Math.cos(a)), sy + s * 0.75 + Math.sin(a) * s * 2.6 - s * 0.3, z + 0.002);
      b.batch(rodGeo(root, knee, s * 0.07, 4), black);
      b.batch(rodGeo(knee, foot, s * 0.055, 4), black);
    }
};

/** A small plaid texture (the scarecrow's shirt), made once. */
let plaidTex: THREE.DataTexture | null = null;
function plaid() {
  if (plaidTex) return plaidTex;
  const n = 16;
  const data = new Uint8Array(n * n * 4);
  const red = [176, 44, 38];
  const dim = red.map((v) => Math.round(v * 0.72));
  const dark = [70, 22, 24];
  const line = [214, 190, 120];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const bx = x < 6;
      const by = y < 6;
      const c = x === 11 || y === 11 ? line : bx && by ? dark : bx || by ? dim : red;
      data.set([c[0], c[1], c[2], 255], (y * n + x) * 4);
    }
  plaidTex = new THREE.DataTexture(data, n, n);
  plaidTex.wrapS = plaidTex.wrapT = THREE.RepeatWrapping;
  plaidTex.magFilter = THREE.NearestFilter;
  plaidTex.colorSpace = THREE.SRGBColorSpace;
  plaidTex.repeat.set(4, 4);
  plaidTex.needsUpdate = true;
  return plaidTex;
}

const scarecrow: Build = (b, w, d, h, f) => {
  const rand = random(1031);
  const shirt = mat("#ffffff", { map: plaid(), roughness: 0.95, side: THREE.DoubleSide, name: "plaid" });
  const burlap = mat("#c4a271", { roughness: 1 });
  const straw = mat("#d9b65a", { roughness: 0.9 });
  const pole = mat("#7a5a3c", { roughness: 0.95 });
  const stitch = mat("#2a201a", { roughness: 1 });
  const twine = mat("#8f7448", { roughness: 1 });
  const patch = mat("#3f5f7a", { roughness: 1 });
  const k = h / 1.8;
  const kx = Math.min(k, w / 0.7);
  // the poles: an upright and a cross bar for the arms
  const yArm = 1.32 * k;
  b.cyl(0.025 * k, 0.03 * k, 1.5 * k, 0, 0, -0.02, pole, 8);
  const reach = w / 2 - 0.03;
  b.add(new THREE.CylinderGeometry(0.02 * k, 0.02 * k, 2 * reach - 0.04, 8).rotateZ(Math.PI / 2), pole, 0, yArm, -0.02);
  // the shirt: a body hanging from the bar, sleeves along it widening to the cuffs
  const yHem = 0.8 * k;
  const bodyR = 0.17 * kx;
  const zS = Math.min(0.62, (d / 2 - 0.02) / bodyR);
  const body = lathe([[bodyR * 1.02, yHem], [bodyR * 0.95, yHem + 0.05 * k], [bodyR * 0.92, yArm - 0.25 * k], [bodyR * 0.98, yArm - 0.03 * k], [bodyR * 0.7, yArm + 0.03 * k], [0.001, yArm + 0.04 * k]], 16);
  b.add(body.scale(1, 1, zS), shirt);
  const len = reach - bodyR * 0.6 - 0.04 * k;
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.06 * k, 0.075 * k, len, 12, 1, true).rotateZ(s * Math.PI / 2);
    b.add(g, shirt, s * (bodyR * 0.6 + len / 2), yArm - 0.02 * k, -0.02).rotation.z = s * -0.05;
    // straw out of the cuffs
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      const l2 = 0.06 + rand() * 0.05;
      const tilt = new THREE.Euler(Math.sin(a) * 0.6, 0, -s * (Math.PI / 2) + Math.cos(a) * 0.6);
      const m = new THREE.Matrix4().makeRotationFromEuler(tilt).premultiply(new THREE.Matrix4().makeTranslation(s * (reach - 0.05 * k), yArm - 0.02 * k + Math.cos(a) * 0.03 * k, -0.02 + Math.sin(a) * 0.03 * k));
      b.batch(new THREE.ConeGeometry(0.006, l2, 3).translate(0, l2 / 2, 0), straw, m);
    }
  }
  // straw at the hem and the neck
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rand() * 0.2;
    const l2 = 0.07 + rand() * 0.07;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.sin(a) * 0.3 + Math.PI, 0, Math.cos(a) * 0.3)).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * bodyR * 0.9, yHem + 0.02, Math.sin(a) * bodyR * 0.9 * zS));
    b.batch(new THREE.ConeGeometry(0.007, l2, 3).translate(0, l2 / 2, 0), straw, m);
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const l2 = 0.05 + rand() * 0.04;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9)).premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.05 * k, yArm + 0.04 * k, Math.sin(a) * 0.05 * k));
    b.batch(new THREE.ConeGeometry(0.006, l2, 3).translate(0, l2 / 2, 0), straw, m);
  }
  // a patch, buttons and a rope belt
  box(b, 0.07 * kx, 0.07 * k, 0.006, -bodyR * 0.35, yHem + 0.18 * k, bodyR * zS * 0.94, patch);
  for (let i = 0; i < 4; i++) b.sphere(0.009 * k, 0, yArm - 0.08 * k - i * 0.1 * k, bodyR * zS * 0.93 + 0.004, mat("#e8e0cc"), 1, 1, 0.5, 6);
  b.add(new THREE.TorusGeometry(bodyR * 0.95, 0.01 * k, 5, 20).rotateX(Math.PI / 2).scale(1, 1, zS), twine, 0, yHem + 0.12 * k, 0);
  // the head: a stuffed burlap sack tied at the neck, a stitched face
  const hr = Math.min(0.135 * k, d / 2 - 0.02);
  const yH = yArm + 0.07 * k + hr * 0.9;
  b.sphere(hr, 0, yH, 0, burlap, 0.95, 1.05, 0.92, 16);
  b.add(new THREE.TorusGeometry(0.045 * k, 0.012 * k, 5, 14).rotateX(Math.PI / 2), twine, 0, yH - hr * 0.95, 0);
  const onFace = (ax: number, ay: number) => V(hr * 0.95 * Math.sin(ax) * Math.cos(ay), yH + hr * 1.05 * Math.sin(ay), hr * 0.92 * Math.cos(ax) * Math.cos(ay));
  for (const s of [-1, 1]) {
    // X-stitched eyes
    const p = onFace(s * 0.38, 0.18);
    for (const r of [0.8, -0.8]) b.add(new THREE.BoxGeometry(hr * 0.26, hr * 0.045, 0.004), stitch, p.x, p.y, p.z + 0.002).rotation.set(0, s * 0.38, r);
  }
  const nose = onFace(0, -0.05);
  b.add(new THREE.ConeGeometry(hr * 0.09, hr * 0.12, 3).rotateZ(Math.PI).rotateX(-Math.PI / 2 + 0.3), mat("#c2621e", { roughness: 0.9 }), nose.x, nose.y, nose.z + 0.004);
  // the mouth: a stitched line with cross stitches
  for (let i = -3; i <= 3; i++) {
    const p = onFace(i * 0.12, -0.38 + 0.008 * i * i);
    b.add(new THREE.BoxGeometry(hr * 0.14, hr * 0.035, 0.004), stitch, p.x, p.y, p.z + 0.001).rotation.set(0.38, i * 0.12, 0.25 * Math.sign(i));
    b.add(new THREE.BoxGeometry(hr * 0.03, hr * 0.12, 0.004), stitch, p.x, p.y, p.z + 0.002).rotation.set(0.38, i * 0.12, 0);
  }
  // the straw hat: a wide brim, a crown with a band, tipped back a little
  const brimR = Math.min(0.22 * k, d / 2 - 0.005, w / 2 - 0.005);
  const yHat = yH + hr * 0.6;
  const hatTop = Math.min(h - yHat - 0.02, 0.15 * k);
  const hat = (g: THREE.BufferGeometry, m: M) => b.add(g.rotateX(-0.12).rotateZ(0.08), m, 0, yHat, 0);
  hat(new THREE.CylinderGeometry(brimR, brimR, 0.012 * k, 24).translate(0, 0.006 * k, 0), f);
  hat(new THREE.CylinderGeometry(hr * 0.62, hr * 0.85, hatTop * 0.85, 16).translate(0, (hatTop * 0.85) / 2, 0), f);
  hat(new THREE.CylinderGeometry(hr * 0.86, hr * 0.86, hatTop * 0.18, 16).translate(0, 0.012 * k + (hatTop * 0.18) / 2, 0), mat("#7a3a24", { roughness: 0.9 }));
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + rand() * 0.3;
    const l2 = 0.03 + rand() * 0.04;
    const m = new THREE.Matrix4()
      .makeRotationFromEuler(new THREE.Euler(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3))
      .premultiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * brimR * 0.95, yHat - 0.005, Math.sin(a) * brimR * 0.95));
    b.batch(new THREE.ConeGeometry(0.004, l2, 3).translate(0, l2 / 2, 0), straw, m);
  }
};

export const BUILDERS: Record<string, Build> = {
  pool_frame: poolFrame,
  pool_quickup: poolQuickUp,
  pool_inground: poolInground,
  pool_steel_wall: poolSteelWall,
  paddling_pool: paddlingPool,
  halloween_skeleton: skeleton,
  halloween_tombstones: tombstones,
  halloween_ghost: ghost,
  halloween_cauldron: cauldron,
  halloween_spider_web: spiderWeb,
  scarecrow,
};
