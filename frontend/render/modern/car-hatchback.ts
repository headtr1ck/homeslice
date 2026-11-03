// More detailed built-in pieces: car hatchback. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { FINISHES } from "../../model/modern";
import { C, mat, type Build, type Builder } from "../modern";

type P2 = [number, number];
/** A smooth curve through (t, y) points (cubic Hermite, Catmull-Rom tangents). */
function curve(pts: P2[]) {
  const n = pts.length;
  const m = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(n - 1, i + 1)];
    return (c[1] - a[1]) / (c[0] - a[0]);
  });
  return (t: number) => {
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (t > pts[i + 1][0]) i++;
    const [t0, y0] = pts[i];
    const [t1, y1] = pts[i + 1];
    const dt = t1 - t0;
    const s = (t - t0) / dt;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * dt * m[i] + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * dt * m[i + 1];
  };
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const k = (v: number) => () => v;

/** A point of a half cross-section (the +x side) at u: 0 the bottom centre, 1 the top centre. */
type Half = (z: number, u: number) => P2;

/** Triangles (positions and normals) per material, batched at the end. */
class Tris {
  pos: number[] = [];
  nor: number[] = [];
  push(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.nor.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
  }
}
class Sink {
  private lists = new Map<THREE.Material, Tris>();
  get(m: THREE.Material) {
    let t = this.lists.get(m);
    if (!t) this.lists.set(m, (t = new Tris()));
    return t;
  }
  /** Adds a ready geometry (with normals) in material m. */
  geo(geo: THREE.BufferGeometry, m: THREE.Material, mx?: THREE.Matrix4) {
    if (mx) geo.applyMatrix4(mx);
    const g = geo.index ? geo.toNonIndexed() : geo;
    const t = this.get(m);
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) {
      t.pos.push(p[i]);
      t.nor.push(n[i]);
    }
  }
  flush(b: Builder) {
    for (const [m, t] of this.lists) {
      if (!t.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(t.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(t.nor, 3));
      b.batch(g, m);
    }
  }
}

const V = THREE.Vector3;
const tmpA = new V();
const tmpB = new V();
/** Adds triangle a b c, wound to face `out`. */
function tri(t: Tris, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, out: THREE.Vector3) {
  const n = tmpA.subVectors(b, a).cross(tmpB.subVectors(c, a));
  if (n.dot(out) < 0) t.push(a, c, b, na, nc, nb);
  else t.push(a, b, c, na, nb, nc);
}

/**
 * A closed loft: the half section mirrored to both sides at each z, smooth normals, each
 * quad in the material `pick(zMid, uMid)` gives, flat caps at both ends.
 */
function loft(sink: Sink, zs: number[], us: number[], half: Half, pick: (z: number, u: number) => THREE.Material, cap: THREE.Material) {
  const M = us.length - 1;
  const R = 2 * M;
  const hi = (j: number) => (j <= M ? j : R - j);
  const grid: THREE.Vector3[][] = zs.map((z) =>
    Array.from({ length: R }, (_, j) => {
      const [x, y] = half(z, us[hi(j)]);
      return new V(j <= M ? x : -x, y, z);
    }),
  );
  // each ring runs anticlockwise seen from +z and the rings go along +z, so (c - a) × (d - b)
  // of a quad points out; the vertex normals are the sums of the quads around them
  const normals = grid.map((ring) => ring.map(() => new V()));
  const fn = new V();
  for (let i = 0; i + 1 < zs.length; i++)
    for (let j = 0; j < R; j++) {
      const q = (j + 1) % R;
      const a = grid[i][j], b = grid[i][q], c = grid[i + 1][q], d = grid[i + 1][j];
      fn.subVectors(c, a).cross(tmpB.subVectors(d, b));
      for (const [ii, jj] of [[i, j], [i, q], [i + 1, q], [i + 1, j]]) normals[ii][jj].add(fn);
    }
  for (const ring of normals) for (const n of ring) n.normalize();
  for (let i = 0; i + 1 < zs.length; i++) {
    const zm = (zs[i] + zs[i + 1]) / 2;
    for (let j = 0; j < R; j++) {
      const q = (j + 1) % R;
      const t = sink.get(pick(zm, (us[hi(j)] + us[hi(q)]) / 2));
      const a = grid[i][j], b = grid[i][q], c = grid[i + 1][q], d = grid[i + 1][j];
      const out = new V().subVectors(c, a).cross(tmpB.subVectors(d, b));
      tri(t, a, b, c, normals[i][j], normals[i][q], normals[i + 1][q], out);
      tri(t, a, c, d, normals[i][j], normals[i + 1][q], normals[i + 1][j], out);
    }
  }
  for (const [i, dir] of [[0, -1], [zs.length - 1, 1]] as const) {
    const ring = grid[i];
    const centre = ring.reduce((s, p) => s.add(p), new V()).multiplyScalar(1 / R);
    const n = new V(0, 0, dir);
    const t = sink.get(cap);
    for (let j = 0; j < R; j++) tri(t, centre, ring[j], ring[(j + 1) % R], n, n, n, n);
  }
}

/**
 * A patch lying on a loft's surface, lifted by `lift` along its normal: u from u0 to u1,
 * z from z0(u) to z1(u), on the +x side (sx = 1) or mirrored (sx = -1).
 */
function patch(t: Tris, half: Half, z0: (u: number) => number, z1: (u: number) => number, u0: number, u1: number, nz: number, nu: number, lift: number, sx: number) {
  const e = 1e-3;
  const at = (s: number, r: number) => {
    const u = lerp(u0, u1, r);
    const z = lerp(z0(u), z1(u), s);
    const [x, y] = half(z, u);
    const [xa, ya] = half(z, Math.min(1, u + e));
    const [xb, yb] = half(z, Math.max(0, u - e));
    const [xc, yc] = half(z + e, u);
    const [xd, yd] = half(z - e, u);
    // the half section runs anticlockwise (bottom centre, out to +x, up, top centre), so
    // du × dz points out of the surface
    const n = new V().crossVectors(new V(xa - xb, ya - yb, 0), new V(xc - xd, yc - yd, 2 * e)).normalize();
    const p = new V(x, y, z).addScaledVector(n, lift);
    p.x *= sx;
    n.x *= sx;
    return [p, n] as const;
  };
  const rows = Array.from({ length: nz + 1 }, (_, i) => Array.from({ length: nu + 1 }, (_, j) => at(i / nz, j / nu)));
  for (let i = 0; i < nz; i++)
    for (let j = 0; j < nu; j++) {
      const [a, na] = rows[i][j];
      const [b, nb] = rows[i][j + 1];
      const [c, nc] = rows[i + 1][j + 1];
      const [d, nd] = rows[i + 1][j];
      const out = new V().addVectors(na, nc);
      tri(t, a, b, c, na, nb, nc, out);
      tri(t, a, c, d, na, nc, nd, out);
    }
}

type WheelMats = { tyre: THREE.Material; rim: THREE.Material; dish: THREE.Material; hub: THREE.Material };
/** A wheel at (x, y, z), its outer face towards sx: rounded tyre, rim lip, twin spokes, hub. */
function wheel(sink: Sink, r: number, tw: number, x: number, y: number, z: number, sx: number, m: WheelMats) {
  // drawn around y (outer face at +y), then turned so y points to sx
  const mx = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationZ((-sx * Math.PI) / 2));
  const ri = r * 0.68;
  const e = Math.min(0.035, tw * 0.2);
  const o = tw / 2;
  const tyre = [
    [ri, -o + 0.01], [r - e * 1.4, -o], [r - e * 0.35, -o + e * 0.35], [r, -o + e * 1.4],
    [r, o - e * 1.4], [r - e * 0.35, o - e * 0.35], [r - e * 1.4, o], [ri, o - 0.01],
  ].map(([a, c]) => new THREE.Vector2(a, c));
  sink.geo(new THREE.LatheGeometry(tyre, 24), m.tyre, mx);
  // a closed ring (a one-sided funnel would show its back from some angles)
  // (each face its own lathe, so the corners stay sharp instead of averaging the normals)
  const lip = [[ri * 1.05, o - 0.002], [ri * 0.99, o - 0.006], [ri * 0.92, o - 0.045], [ri * 1.05, o - 0.045], [ri * 1.05, o - 0.002]].map(([a, c]) => new THREE.Vector2(a, c));
  for (let i = 0; i + 1 < lip.length; i++) sink.geo(new THREE.LatheGeometry([lip[i], lip[i + 1]], 24), m.rim, mx);
  sink.geo(new THREE.CircleGeometry(ri * 0.95, 18).rotateX(-Math.PI / 2).translate(0, o - 0.045, 0), m.dish, mx);
  // the inboard side closed too (seen through the far arch from the other side of the car)
  sink.geo(new THREE.CircleGeometry(ri * 1.01, 18).rotateX(Math.PI / 2).translate(0, -o + 0.01, 0), m.dish, mx);
  const len = ri * 0.8;
  for (let s = 0; s < 5; s++)
    for (const off of [-0.16, 0.16]) {
      const geo = new THREE.BoxGeometry(r * 0.07, 0.02, len).translate(0, 0, ri * 0.18 + len / 2);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationX(0.09));
      geo.translate(0, o - 0.018, 0);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY((s / 5) * Math.PI * 2 + off));
      sink.geo(geo, m.rim, mx);
    }
  sink.geo(new THREE.CylinderGeometry(ri * 0.24, ri * 0.28, 0.04, 10).translate(0, o - 0.02, 0), m.rim, mx);
  sink.geo(new THREE.CylinderGeometry(ri * 0.11, ri * 0.11, 0.012, 10).translate(0, o + 0.004, 0), m.hub, mx);
}

/** A compact hatchback (Golf / Yaris proportions) fitted to w × d × h, front at +z. */
function hatchback(b: Builder, w: number, d: number, h: number, color: string) {
  const sink = new Sink();
  const paint = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.32, metalness: 0.35 });
  const trim = mat("#151619", { roughness: 0.5 });
  const plastic = mat("#222427", { roughness: 0.85 });
  const liner = mat("#0d0e10", { roughness: 0.95 });
  const glassM = mat("#2e3d4a", { roughness: 0.06, metalness: 0.75 });
  const tyreM = mat("#1c1d1f", { roughness: 0.92 });
  const rimM = mat("#c3c7cb", { metalness: 0.75, roughness: 0.25 });
  const dishM = mat("#2c2f33", { metalness: 0.4, roughness: 0.5 });
  const lampM = mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.3 });
  const lampHousing = mat("#39414a", { metalness: 0.7, roughness: 0.15 });
  const tailM = mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.4 });
  const tailDark = mat("#5a0e0b", { roughness: 0.2, metalness: 0.3 });
  const plateM = mat(C.ceramic);
  const euM = mat("#2a4c9a");

  const zR = -d / 2;
  const zF = d / 2;
  const T = (z: number) => (z - zR) / d;
  const Z = (t: number) => zR + t * d;

  // ----- wheels -----
  const r = Math.min(0.33, h * 0.215, d * 0.08);
  const ra = r + Math.min(0.07, r * 0.2);
  const wheelZ = [Z(0.192), Z(0.795)];
  const tw = Math.min(0.215, w * 0.12);

  // ----- body: sills, arches, bonnet and the belt line -----
  const W = w * 0.478;
  const hwPlan = (z: number) => {
    const t = T(z);
    return W * (1 - 0.075 * clamp01((t - 0.78) / 0.22) ** 2 - 0.05 * clamp01((0.14 - t) / 0.14) ** 2);
  };
  const top = curve(([[0, 0.655], [0.05, 0.672], [0.4, 0.66], [0.7, 0.632], [0.8, 0.608], [0.92, 0.575], [1, 0.55]] as P2[]).map(([t, y]) => [t, y * h] as P2));
  const base = Math.min(0.15 * h, 0.22);
  const ends = {
    front: { z: Math.min(0.2, d * 0.05), x: Math.min(0.17, w * 0.1), t: Math.min(0.11, h * 0.075), b: Math.min(0.08, h * 0.055) },
    back: { z: Math.min(0.11, d * 0.028), x: Math.min(0.12, w * 0.07), t: Math.min(0.08, h * 0.055), b: Math.min(0.07, h * 0.05) },
  };
  /** The rounding of nose and tail: how far each side of the section is pulled in at z. */
  const shrink = (z: number) => {
    const isFront = zF - z < ends.front.z;
    const f = isFront ? ends.front : z - zR < ends.back.z ? ends.back : null;
    if (!f) return { x: 0, t: 0, b: 0 };
    const s = clamp01(1 - (isFront ? zF - z : z - zR) / f.z);
    const c = 1 - Math.sqrt(Math.max(0, 1 - s * s));
    return { x: f.x * c, t: f.t * c, b: f.b * c };
  };
  // the underside follows a circle over each wheel
  const archIn = (z: number) => {
    let y = 0;
    for (const zc of wheelZ) {
      const dz = Math.abs(z - zc);
      if (dz < ra) y = Math.max(y, r + Math.sqrt(ra * ra - dz * dz));
    }
    return y;
  };
  const bodySec = (z: number) => {
    const s = shrink(z);
    const hw = hwPlan(z) - s.x;
    const yt = top(T(z)) - s.t;
    const y0 = Math.max(base + s.b, archIn(z));
    const rb = Math.min(0.045, (yt - y0) * 0.2);
    const rt = Math.min(0.11, (yt - y0) * 0.45, hw * 0.3);
    const crown = T(z) > 0.68 ? 0.025 : 0.012;
    return { hw, yt, y0, rb, rt, crown };
  };
  const SH = 0.92 * (Math.PI / 2);
  const bodyHalf: Half = (z, u) => {
    const { hw, yt, y0, rb, rt, crown } = bodySec(z);
    if (u < 0.08) return [lerp(0, hw - rb - 0.015, u / 0.08), y0];
    if (u < 0.2) {
      const a = -Math.PI / 2 + ((u - 0.08) / 0.12) * (Math.PI / 2);
      return [hw - 0.015 - rb + Math.cos(a) * rb, y0 + rb + Math.sin(a) * rb];
    }
    if (u < 0.55) {
      const s = (u - 0.2) / 0.35;
      // tucked in towards the sill (never leaning in, so the side can't face up)
      return [hw - 0.015 * (1 - s) ** 2, lerp(y0 + rb, yt - rt, s)];
    }
    if (u < 0.8) {
      const a = ((u - 0.55) / 0.25) * SH;
      return [hw - rt + Math.cos(a) * rt, yt - rt + Math.sin(a) * rt];
    }
    const s = (u - 0.8) / 0.2;
    return [lerp(hw - rt + Math.cos(SH) * rt, 0, s), lerp(yt - rt + Math.sin(SH) * rt, yt + crown, Math.sin((s * Math.PI) / 2))];
  };
  const bodyU = [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.29, 0.37, 0.46, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.87, 0.94, 1];
  const zs: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const c = 1 - Math.cos((i / 5) * (Math.PI / 2));
    zs.push(zR + ends.back.z * c, zF - ends.front.z * c);
  }
  const inner0 = zR + ends.back.z;
  const inner1 = zF - ends.front.z;
  const nMid = Math.ceil((inner1 - inner0) / 0.2);
  for (let i = 1; i < nMid; i++) zs.push(lerp(inner0, inner1, i / nMid));
  for (const zc of wheelZ) {
    for (let i = 1; i < 9; i++) zs.push(zc - ra * Math.cos((i / 9) * Math.PI));
  }
  zs.sort((a, c) => a - c);
  const bodyZ = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 5e-5);
  const inArch = (z: number) => wheelZ.some((zc) => Math.abs(z - zc) < ra);
  // one loft per stretch between the arch edges, so the smooth normals never blend across
  // the step up into an arch (the outer stretch's end cap is the step's face)
  const ranges: P2[] = [];
  let lo = zR;
  for (const zc of wheelZ) {
    ranges.push([lo, zc - ra - 1e-7], [zc - ra + 1e-6, zc + ra - 1e-6]);
    lo = zc + ra + 1e-7;
  }
  ranges.push([lo, zF]);
  for (const [z0, z1] of ranges) {
    const part = [z0, ...bodyZ.filter((z) => z > z0 + 5e-5 && z < z1 - 5e-5), z1];
    loft(sink, part, bodyU, bodyHalf, (z, u) => (u < 0.08 || (u < 0.2 && inArch(z)) ? liner : paint), paint);
  }

  // ----- glasshouse: black frames and pillars, tinted glass, a painted roof -----
  const tA = 0.69;
  const tRF = 0.505;
  const tRR = 0.125;
  const tC = 0.045;
  const roof = curve(([[tC, 0.69], [0.075, 0.845], [0.11, 0.94], [0.16, 0.982], [0.3, 0.998], [0.44, 0.993], [0.51, 0.968], [0.6, 0.8], [tA, 0.626]] as P2[]).map(([t, y]) => [t, y * h] as P2));
  const glassSec = (z: number) => {
    const t = T(z);
    const hwB = hwPlan(z) - shrink(z).x - 0.07;
    const yB = top(t) - 0.025;
    const yT = Math.max(yB + 0.004, roof(t));
    const ht = yT - yB;
    const hwT = hwB - Math.min(0.16, ht * 0.27);
    const rc = Math.min(0.085, ht * 0.4);
    return { hwB, yB, yT, hwT, rc, ht };
  };
  const RC = 0.85 * (Math.PI / 2);
  const glassHalf: Half = (z, u) => {
    const { hwB, yB, yT, hwT, rc, ht } = glassSec(z);
    if (u < 0.1) return [lerp(0, hwB, u / 0.1), yB];
    if (u < 0.5) {
      const s = (u - 0.1) / 0.4;
      return [lerp(hwB, hwT, s), lerp(yB, yT - rc, s)];
    }
    if (u < 0.78) {
      const a = ((u - 0.5) / 0.28) * RC;
      return [hwT - rc + Math.cos(a) * rc, yT - rc + Math.sin(a) * rc];
    }
    const s = (u - 0.78) / 0.22;
    return [lerp(hwT - rc + Math.cos(RC) * rc, 0, s), lerp(yT - rc + Math.sin(RC) * rc, yT + 0.02 * Math.min(1, ht / 0.3), Math.sin((s * Math.PI) / 2))];
  };
  const zA = Z(tA), zRF = Z(tRF), zRR = Z(tRR), zC = Z(tC);
  const glassZ: number[] = [];
  const nG = Math.ceil((zA - zC) / 0.1);
  for (let i = 0; i <= nG; i++) glassZ.push(lerp(zC, zA, i / nG));
  const glassU = [0, 0.1, 0.101, 0.23, 0.36, 0.5, 0.57, 0.64, 0.71, 0.78, 0.86, 0.93, 1];
  loft(sink, glassZ, glassU, glassHalf, (z, u) => (u > 0.6 && z < zRF - 0.02 && z > zRR + 0.02 ? paint : trim), trim);

  // windows on the frame
  const gl = sink.get(glassM);
  const zB = Z(0.47);
  const zQ = Z(0.225);
  for (const sx of [-1, 1]) {
    // front door window (its front edge follows the A-pillar), rear door window, quarter light
    patch(gl, glassHalf, k(zB + 0.04), k(zA - 0.02), 0.14, 0.47, 12, 3, 0.004, sx);
    patch(gl, glassHalf, (u) => lerp(zQ, zQ + 0.09, (u - 0.14) / 0.33), k(zB - 0.04), 0.14, 0.47, 6, 3, 0.004, sx);
    patch(gl, glassHalf, (u) => lerp(Z(0.14), Z(0.175), (u - 0.18) / 0.24), (u) => lerp(zQ - 0.045, zQ + 0.03, (u - 0.18) / 0.24), 0.18, 0.42, 3, 2, 0.004, sx);
    // windscreen and rear window
    patch(gl, glassHalf, k(zRF + 0.03), k(zA - 0.025), 0.8, 1, 12, 4, 0.004, sx);
    patch(gl, glassHalf, k(zC + 0.025), k(zRR - 0.045), 0.81, 1, 8, 4, 0.004, sx);
  }

  // ----- wheels in the arches -----
  const wm = { tyre: tyreM, rim: rimM, dish: dishM, hub: trim };
  for (const zc of wheelZ) for (const sx of [-1, 1]) wheel(sink, r, tw, sx * (hwPlan(zc) - 0.02 - tw / 2), r, zc, sx, wm);

  // ----- sides: door seams, handles, sill trim -----
  const seams = sink.get(trim);
  const seam = (z: number, u0: number, u1: number, sx: number) => patch(seams, bodyHalf, k(z - 0.004), k(z + 0.004), u0, u1, 1, 4, 0.002, sx);
  const zDf = wheelZ[1] - ra - 0.04;
  const zDr = wheelZ[0] + ra + 0.02;
  for (const sx of [-1, 1]) {
    seam(zDf, 0.2, 0.75, sx);
    seam(zB, 0.18, 0.75, sx);
    seam(zDr, 0.2, 0.75, sx);
    patch(sink.get(plastic), bodyHalf, k(wheelZ[0] + ra + 0.005), k(wheelZ[1] - ra - 0.005), 0.09, 0.24, 8, 2, 0.003, sx);
    for (const zz of [zB - 0.23, zDr + 0.17]) {
      patch(seams, bodyHalf, k(zz - 0.075), k(zz + 0.075), 0.5, 0.535, 2, 1, 0.003, sx);
      patch(sink.get(paint), bodyHalf, k(zz - 0.07), k(zz + 0.07), 0.505, 0.53, 2, 1, 0.012, sx);
    }
    // bonnet shut line across the nose
    patch(seams, bodyHalf, k(Z(0.935)), k(Z(0.935) + 0.006), 0.62, 1, 1, 6, 0.002, sx);
  }

  // ----- mirrors: a painted cap on a black arm, the glass facing back -----
  const zM = zA - 0.12;
  const yBelt = top(T(zM));
  for (const sx of [-1, 1]) {
    const xm = sx * (w / 2 - 0.09);
    b.box(0.1, 0.05, 0.07, sx * (glassSec(zM).hwB + 0.03), yBelt - 0.01, zM + 0.02, trim);
    b.box(0.18, 0.1, 0.09, xm, yBelt + 0.03, zM, paint, 0.035);
    b.box(0.15, 0.075, 0.006, xm, yBelt + 0.042, zM - 0.045, glassM);
    b.box(0.17, 0.012, 0.08, xm, yBelt + 0.03, zM, trim);
  }

  // ----- front: headlights, grille, badge, plate, lower intake -----
  const fs = bodySec(zF);
  const front = zF;
  const fw = fs.hw;
  const hl = Math.min(0.09, (fs.yt - fs.y0) * 0.22);
  const yH = fs.yt - 0.04 - hl;
  for (const sx of [-1, 1]) {
    // a slim lamp in a dark chrome housing, wrapping round the corner
    b.box(fw * 0.5, hl, 0.03, sx * fw * 0.66, yH, front - 0.005, lampHousing);
    b.box(fw * 0.46, 0.012, 0.032, sx * fw * 0.67, yH + hl - 0.022, front - 0.005, lampM);
    for (const xx of [0.5, 0.64]) b.cyl(0.026, 0.026, 0.02, sx * fw * xx, yH + 0.03, front + 0.01, lampM, 12).rotation.x = Math.PI / 2;
    patch(sink.get(lampHousing), bodyHalf, k(zF - ends.front.z * 0.95), k(zF - 0.004), 0.52, 0.66, 5, 2, 0.003, sx);
    patch(sink.get(lampM), bodyHalf, k(zF - ends.front.z * 0.9), k(zF - 0.004), 0.625, 0.65, 5, 1, 0.005, sx);
    // fog lamps in black pods either side of the intake
    b.box(fw * 0.2, 0.06, 0.022, sx * fw * 0.74, fs.y0 + 0.05, front - 0.006, plastic);
    b.box(fw * 0.12, 0.02, 0.024, sx * fw * 0.74, fs.y0 + 0.07, front - 0.006, lampM);
  }
  // the grille between the lamps, a chrome strip joining them, the badge
  b.box(fw * 0.8, hl - 0.012, 0.026, 0, yH + 0.006, front - 0.006, trim);
  b.box(fw * 0.8, 0.008, 0.03, 0, yH + hl - 0.02, front - 0.006, rimM);
  b.cyl(0.042, 0.042, 0.02, 0, yH + hl * 0.45, front + 0.004, rimM, 16).rotation.x = Math.PI / 2;
  // lower intake with two bars
  const yI = fs.y0 + 0.02;
  const hI = Math.min(0.11, (fs.yt - fs.y0) * 0.26);
  b.box(fw * 1.0, hI, 0.024, 0, yI, front - 0.008, trim);
  for (const f of [0.33, 0.66]) b.box(fw * 0.98, 0.012, 0.028, 0, yI + hI * f, front - 0.008, plastic);
  // number plates (EU size, smaller on small cars): a white plate, the blue band, the lettering
  const letters = mat("#2a2b2e");
  const plate = (z: number, y: number, dir: number) => {
    const pw = Math.min(0.52, w * 0.29);
    b.box(pw, 0.11, 0.012, 0, y, z, plateM);
    b.box(0.04, 0.1, 0.012, -pw / 2 + 0.025, y + 0.005, z + dir * 0.002, euM);
    b.box(pw * 0.7, 0.045, 0.012, pw * 0.05, y + 0.032, z + dir * 0.003, letters);
  };
  plate(front + 0.004, yI + hI + 0.015, 1);

  // ----- back: tail lights, tailgate, badge, plate, bumper, spoiler -----
  const bs = bodySec(zR);
  const back = zR;
  const bw = bs.hw;
  const yT = bs.yt - 0.15;
  const yG = yT - 0.21;
  for (const sx of [-1, 1]) {
    // tail lights at the corners, running round onto the sides
    b.box(bw * 0.42, 0.1, 0.03, sx * bw * 0.72, yT, back + 0.005, tailM);
    b.box(bw * 0.34, 0.025, 0.034, sx * bw * 0.7, yT + 0.04, back + 0.005, tailDark);
    patch(sink.get(tailM), bodyHalf, k(zR + 0.004), k(zR + ends.back.z + 0.13), 0.5, 0.64, 5, 2, 0.003, sx);
    // reflectors in the bumper, the tailgate's side seams
    b.box(0.1, 0.025, 0.02, sx * bw * 0.78, bs.y0 + 0.1, back - 0.004, tailDark);
    b.box(0.008, bs.yt - yG - 0.02, 0.012, sx * bw * 0.505, yG, back - 0.002, trim);
  }
  b.box(bw * 1.01, 0.008, 0.012, 0, yG, back - 0.002, trim);
  b.cyl(0.04, 0.04, 0.02, 0, yT + 0.05, back - 0.004, rimM, 16).rotation.x = Math.PI / 2;
  plate(back - 0.004, yG + 0.035, -1);
  // the black lower bumper with a diffuser
  b.box(bw * 1.9, 0.09, 0.03, 0, bs.y0, back + 0.008, plastic);
  for (let i = -2; i <= 2; i++) b.box(0.012, 0.06, 0.034, i * bw * 0.16, bs.y0, back + 0.008, trim);
  // roof spoiler over the rear window, a shark-fin aerial
  const gr = glassSec(zRR);
  b.box(gr.hwT * 2 + 0.04, 0.03, 0.2, 0, gr.yT - 0.015, zRR - 0.05, trim, 0.012);
  b.sphere(0.06, 0, gr.yT + 0.02, zRR + 0.12, trim, 0.35, 0.6, 1.4, 10);

  sink.flush(b);
}

export const BUILDERS: Record<string, Build> = {
  car_hatchback: (b, w, d, h, _f, color) => hatchback(b, w, d, h, color),
};
