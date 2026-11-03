// More detailed built-in pieces: car sports. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINISHES } from "../../model/modern";
import { mat, type Build, type Builder } from "../modern";

type P2 = [number, number];

/** A smooth curve through keys [t, value] that never overshoots them (monotone cubic). */
function curve(keys: P2[]): (t: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const dl: number[] = [];
  for (let i = 0; i < n - 1; i++) dl.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = [dl[0]];
  for (let i = 1; i < n - 1; i++) m.push(dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2);
  m.push(dl[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (dl[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / dl[i];
    const b = m[i + 1] / dl[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * dl[i];
      m[i + 1] = tau * b * dl[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const u = (x - xs[i]) / hh;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * hh * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * hh * m[i + 1];
  };
}

/** An open shell turned to face inwards (wheel wells, rim barrels): one-sided, seen from inside. */
function inward(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array as Float32Array;
  for (let i = 0; i < p.length; i += 9)
    for (let k = 0; k < 3; k++) {
      const t = p[i + 3 + k];
      p[i + 3 + k] = p[i + 6 + k];
      p[i + 6 + k] = t;
    }
  g.deleteAttribute("normal");
  g.computeVertexNormals();
  return g;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/** Triangles collected per material, then given creased normals and batched. */
class Mesher {
  private tris = new Map<THREE.Material, number[]>();
  tri(m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    if (ab.cross(ac).lengthSq() < 1e-12) return;
    let list = this.tris.get(m);
    if (!list) this.tris.set(m, (list = []));
    list.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  /** a quad a-b-c-d, counter-clockwise seen from outside */
  quad(m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    this.tri(m, a, b, c);
    this.tri(m, a, c, d);
  }
  flush(b: Builder, crease: number) {
    for (const [m, list] of this.tris) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(list, 3));
      b.batch(toCreasedNormals(geo, crease), m);
    }
    this.tris.clear();
  }
}

/**
 * A modern sports coupé (911 / R8 / MX-5 hardtop): a body lofted from rounded cross
 * sections along its length, so the long bonnet, the fenders over the wheels, the
 * glasshouse with its tumblehome and the fastback flow into one another; wheel arches cut
 * out of it with flared lips; big multi-spoke wheels with brake discs; slim lights, a
 * rear light bar, intakes, splitter, diffuser, exhausts, spoiler, mirrors and plates.
 */
function sportsCar(b: Builder, w: number, d: number, h: number, color: string) {
  const paint = mat(FINISHES[color] ?? FINISHES.red, { roughness: 0.3, metalness: 0.35 });
  const glassM = mat("#1c242d", { roughness: 0.08, metalness: 0.7 });
  const black = mat("#17181b", { roughness: 0.55 });
  const under = mat("#101113", { roughness: 0.9, side: THREE.DoubleSide });
  const gloss = mat("#121316", { roughness: 0.25, metalness: 0.4 });
  const head = mat("#eef2f5", { emissive: "#fff5dc", emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.3 });
  const tail = mat("#c0151b", { emissive: "#a00d12", emissiveIntensity: 0.7, roughness: 0.3 });
  const chrome = mat("#d4d7db", { metalness: 0.85, roughness: 0.2 });
  const rimM = mat("#c3c7cc", { metalness: 0.75, roughness: 0.28 });
  const barrel = mat("#2a2c2f", { metalness: 0.5, roughness: 0.5 });
  const tyreM = mat("#1d1e20", { roughness: 0.92 });
  const discM = mat("#8a8e93", { metalness: 0.6, roughness: 0.45 });
  const caliperM = mat("#c7a12a", { roughness: 0.45, metalness: 0.2 });
  const plateM = mat("#f2f2ee", { roughness: 0.5 });
  const euM = mat("#1f4fa3", { roughness: 0.5 });
  const liner = mat("#0c0d0f", { roughness: 0.95 });

  const zOf = (t: number) => -d / 2 + t * d;
  // wheels: big and low-profile, a short rear and a long front overhang
  const r = Math.min(0.36, h * 0.27, d * 0.08);
  const ra = r * 1.14;
  const tWheels = [0.205, 0.79];
  const zWheels = tWheels.map(zOf);

  // the body's lines along its length (t: 0 tail, 1 nose; widths of w, heights of h)
  const P = {
    hw: curve([[0, 0.405], [0.025, 0.45], [0.08, 0.476], [0.2, 0.492], [0.32, 0.474], [0.45, 0.462], [0.6, 0.463], [0.79, 0.478], [0.9, 0.47], [0.96, 0.448], [0.99, 0.41], [1, 0.38]]),
    ys: curve([[0, 0.4], [0.1, 0.4], [0.3, 0.37], [0.7, 0.35], [1, 0.3]]),
    yb: curve([[0, 0.17], [0.04, 0.12], [0.1, 0.105], [0.9, 0.1], [0.97, 0.11], [1, 0.13]]),
    belt: curve([[0, 0.53], [0.05, 0.575], [0.2, 0.628], [0.32, 0.615], [0.5, 0.6], [0.66, 0.596], [0.79, 0.605], [0.88, 0.58], [0.95, 0.5], [1, 0.41]]),
    roof: curve([[0, 0.56], [0.04, 0.6], [0.12, 0.675], [0.22, 0.785], [0.32, 0.9], [0.42, 0.985], [0.47, 1], [0.52, 0.985], [0.6, 0.84], [0.685, 0.645], [0.75, 0.625], [0.88, 0.585], [0.95, 0.5], [1, 0.4]]),
    cab: curve([[0, 0], [0.06, 0.05], [0.2, 0.75], [0.3, 1], [0.55, 1], [0.62, 0.6], [0.7, 0]]),
  };

  /** The right half of the cross-section at t, from the floor's centre round to the roof's. */
  const section = (t: number): P2[] => {
    const z = zOf(t);
    const hw = P.hw(t) * w;
    const ys = P.ys(t) * h;
    const yb = P.yb(t) * h;
    const belt = P.belt(t) * h;
    const roof = P.roof(t) * h;
    const c = P.cab(t);
    const hwB = hw * 0.955;
    const xs = lerp(hwB * 0.88, 0.355 * w, c);
    const ysd = lerp(belt + 0.012 * h, roof - 0.06 * h, c);
    let floor = yb;
    for (const zc of zWheels) {
      const dz = z - zc;
      if (Math.abs(dz) <= ra) floor = Math.max(floor, r + Math.sqrt(ra * ra - dz * dz));
    }
    const pts: P2[] = [[0, yb], [hw * 0.78, yb]];
    for (let k = 1; k <= 3; k++) {
      const f = (k / 4) * (Math.PI / 2);
      pts.push([hw * 0.78 + hw * 0.22 * Math.sin(f), yb + (ys - yb) * (1 - Math.cos(f))]);
    }
    pts.push([hw, ys]);
    for (const s of [1 / 3, 2 / 3]) pts.push([hw - (hw - hwB) * s * s, ys + (belt - ys) * s]);
    pts.push([hwB, belt]);
    for (const f of [0.1, 0.9, 1]) pts.push([lerp(hwB, xs, f), lerp(belt, ysd, f)]);
    for (const u of [0.8, 0.6, 0.4, 0.2, 0]) pts.push([xs * u, roof + (ysd - roof) * Math.pow(u, 2.2)]);
    floor = Math.min(floor, roof - 0.05 * h);
    return pts.map(([x, y]) => [x, Math.max(y, floor)]);
  };
  // the material of each right-half ring segment k (0 floor … 15 roof centre)
  const inT = (t: number, a: number, c: number) => t > a && t < c;
  const material = (t: number, k: number): THREE.Material => {
    if (k === 0) return under;
    if (k <= 7) return paint;
    if (k <= 10) {
      if (inT(t, 0.2, 0.665)) {
        if (inT(t, 0.2, 0.21) || inT(t, 0.655, 0.665) || inT(t, 0.355, 0.37)) return black;
        return k === 9 ? glassM : black;
      }
      return paint;
    }
    if (inT(t, 0.56, 0.685)) return k === 11 ? black : glassM;
    if (inT(t, 0.545, 0.56) || inT(t, 0.685, 0.7)) return black;
    if (inT(t, 0.17, 0.35)) return k === 11 ? paint : glassM;
    if (inT(t, 0.16, 0.17) || inT(t, 0.35, 0.36)) return k === 11 ? paint : black;
    return paint;
  };

  // stations along the car: even steps, every material edge, and close round the arches
  const ts = new Set<number>();
  for (let i = 0; i <= 34; i++) ts.add(i / 34);
  for (const t of [0.16, 0.17, 0.2, 0.21, 0.35, 0.355, 0.36, 0.37, 0.545, 0.56, 0.655, 0.665, 0.685, 0.7, 0.008, 0.992]) ts.add(t);
  for (const tc of tWheels) {
    const n = 10;
    for (let k = 0; k <= n; k++) ts.add(tc + (Math.cos((k / n) * Math.PI) * ra) / d);
    ts.add(tc + (ra + 0.004) / d);
    ts.add(tc - (ra + 0.004) / d);
  }
  const sorted = [...ts].filter((t) => t >= 0 && t <= 1).sort((a, c) => a - c);
  const list: number[] = [];
  for (const t of sorted) if (!list.length || t - list[list.length - 1] > 0.0006) list.push(t);

  const ringOf = (t: number) => {
    const half = section(t);
    const z = zOf(t);
    const ring: THREE.Vector3[] = half.map(([x, y]) => new THREE.Vector3(x, y, z));
    for (let k = half.length - 2; k >= 1; k--) ring.push(new THREE.Vector3(-half[k][0], half[k][1], z));
    return ring;
  };
  const segK = (j: number, n: number) => (j < n / 2 ? j : n - 1 - j);
  const mesh = new Mesher();
  let prev = ringOf(list[0]);
  const n = prev.length;
  for (let i = 1; i < list.length; i++) {
    const cur = ringOf(list[i]);
    const tm = (list[i - 1] + list[i]) / 2;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      mesh.quad(material(tm, segK(j, n)), prev[j], prev[j1], cur[j1], cur[j]);
    }
    prev = cur;
  }
  // nose and tail faces
  const cap = (t: number, front: boolean) => {
    const ring = ringOf(t);
    const c = ring.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ring.length);
    for (let j = 0; j < n; j++) {
      const a = ring[j];
      const q = ring[(j + 1) % n];
      if (front) mesh.tri(paint, c, a, q);
      else mesh.tri(paint, c, q, a);
    }
  };
  cap(0, false);
  cap(1, true);
  mesh.flush(b, 0.55);

  // ----- surface helpers for the details -----
  /** the body's side x at height y (the right side) */
  const sideX = (t: number, y: number) => {
    const s = section(t);
    for (let k = 1; k < 11; k++) {
      const [x0, y0] = s[k];
      const [x1, y1] = s[k + 1];
      if (y >= y0 && y <= y1 && y1 > y0) return lerp(x0, x1, (y - y0) / (y1 - y0));
    }
    return P.hw(t) * w;
  };
  /** a patch of the body's surface (t0 … t1, right-half ring points k0 … k1), lifted off it, on both sides */
  const patch = (t0: number, t1: number, k0: number, k1: number, m: THREE.Material, lift = 0.004, steps = 4) => {
    const grid: THREE.Vector3[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = lerp(t0, t1, i / steps);
      const s = section(t);
      const row: THREE.Vector3[] = [];
      for (let k = k0; k <= k1; k++) {
        const a = s[Math.max(0, k - 1)];
        const c = s[Math.min(s.length - 1, k + 1)];
        const nx = c[1] - a[1];
        const ny = -(c[0] - a[0]);
        const l = Math.hypot(nx, ny) || 1;
        row.push(new THREE.Vector3(s[k][0] + (nx / l) * lift, s[k][1] + (ny / l) * lift, zOf(t)));
      }
      grid.push(row);
    }
    for (const sx of [1, -1]) {
      const M = (p: THREE.Vector3) => new THREE.Vector3(p.x * sx, p.y, p.z);
      for (let i = 0; i < steps; i++)
        for (let k = 0; k < k1 - k0; k++) {
          const a = M(grid[i][k]);
          const q = M(grid[i][k + 1]);
          const c = M(grid[i + 1][k + 1]);
          const e = M(grid[i + 1][k]);
          if (sx > 0) mesh.quad(m, a, q, c, e);
          else mesh.quad(m, a, e, c, q);
        }
    }
  };

  // door shut lines, the side intake ahead of the rear wheel, the black sill
  patch(0.663, 0.668, 1, 8, black, 0.002, 1);
  patch(0.36, 0.365, 1, 8, black, 0.002, 1);
  patch(0.3, 0.352, 3, 6, black, 0.003, 3);
  patch(0.31, 0.345, 4, 5, gloss, 0.006, 2);
  patch(0.3, 0.7, 1, 3, black, 0.003, 6);
  // slim headlights swept over the front corners, wrapped tail lights
  patch(0.95, 0.993, 6, 9, head, 0.004, 5);
  patch(0.945, 0.952, 6, 9, black, 0.005, 1);
  patch(0.004, 0.03, 6, 8, tail, 0.004, 3);
  mesh.flush(b, 0.7);

  const zF = d / 2;
  const zR = -d / 2;
  const capOf = (t: number) => {
    const s = section(t);
    return { yb: s[0][1], top: s[s.length - 1][1], hw: P.hw(t) * w };
  };
  const plateW = Math.min(0.52, w * 0.27);
  const plate = (y: number, z: number, dir: number) => {
    b.box(plateW + 0.016, 0.126, 0.012, 0, y - 0.008, z, black);
    b.box(plateW, 0.11, 0.012, 0, y, z + dir * 0.004, plateM);
    b.box(0.04, 0.1, 0.012, dir * -(plateW / 2 - 0.022), y + 0.005, z + dir * 0.006, euM);
  };

  // ----- front: splitter, intakes, plate -----
  const nose = capOf(1);
  b.box(nose.hw * 2 * 1.08, 0.018, 0.12, 0, nose.yb - 0.025, zF - 0.06, black);
  const intakeH = (nose.top - nose.yb) * 0.42;
  for (const sx of [-1, 1]) {
    b.box(nose.hw * 0.58, intakeH, 0.03, sx * nose.hw * 0.6, nose.yb + 0.02, zF - 0.012, black);
    for (let k = 1; k <= 2; k++) b.box(nose.hw * 0.56, 0.008, 0.02, sx * nose.hw * 0.6, nose.yb + 0.02 + (intakeH * k) / 3, zF + 0.002, gloss);
  }
  b.box(nose.hw * 0.6, intakeH * 0.5, 0.03, 0, nose.yb + 0.02, zF - 0.012, black);
  plate(nose.yb + 0.02 + intakeH + 0.025, zF - 0.002, 1);

  // ----- rear: light bar, plate, diffuser, exhausts, ducktail, louvres -----
  const tailS = capOf(0);
  const barY = P.belt(0) * h - 0.035 * h;
  const barW = sideX(0, barY) * 2 * 0.96;
  b.box(barW, 0.022, 0.02, 0, barY, zR - 0.004, tail);
  b.box(barW, 0.05, 0.016, 0, barY - 0.012, zR - 0.001, gloss);
  plate(tailS.yb + (barY - tailS.yb) * 0.42, zR + 0.002, -1);
  const dfW = tailS.hw * 1.7;
  b.box(dfW, 0.09, 0.3, 0, tailS.yb - 0.06, zR + 0.15, black);
  for (let k = -2; k <= 2; k++) b.box(0.012, 0.08, 0.26, k * dfW * 0.18, tailS.yb - 0.065, zR + 0.13, gloss);
  for (const sx of [-1, 1]) {
    const ex = sx * dfW * 0.38;
    const ey = tailS.yb;
    b.batch(new THREE.CylinderGeometry(0.042, 0.042, 0.1, 16, 1, true).rotateX(Math.PI / 2), chrome, at(ex, ey, zR - 0.01));
    b.batch(new THREE.CircleGeometry(0.036, 14).rotateY(Math.PI), under, at(ex, ey, zR + 0.01));
  }
  const lipY = P.roof(0.02) * h;
  b.box(P.hw(0.02) * w * 1.65, 0.022, 0.16, 0, lipY - 0.004, zOf(0.02) + 0.02, paint, 0.01);
  b.box(P.hw(0.02) * w * 1.65, 0.01, 0.05, 0, lipY + 0.012, zR + 0.02, black);
  for (let k = 0; k < 5; k++) {
    const t = 0.06 + k * 0.016;
    b.box(w * 0.36, 0.012, 0.03, 0, P.roof(t) * h - 0.004, zOf(t), black);
  }

  // ----- mirrors and door handles -----
  for (const sx of [-1, 1]) {
    const tM = 0.64;
    const yM = P.belt(tM) * h + 0.05 * h;
    const xIn = sideX(tM, P.belt(tM) * h - 0.01);
    const xOut = w / 2 - 0.005;
    const mw = 0.13;
    b.box(xOut - mw - xIn + 0.03, 0.025, 0.05, sx * ((xIn + xOut - mw) / 2), yM - 0.035, zOf(tM), black);
    b.box(mw, 0.08, 0.12, sx * (xOut - mw / 2), yM - 0.03, zOf(tM) - 0.01, paint, 0.03);
    b.box(mw * 0.82, 0.06, 0.01, sx * (xOut - mw / 2), yM - 0.02, zOf(tM) - 0.07, glassM);
    const tH = 0.395;
    const yH = P.belt(tH) * h - 0.07 * h;
    b.box(0.012, 0.022, 0.15, sx * (sideX(tH, yH) + 0.002), yH, zOf(tH), gloss);
  }

  // ----- wheels: low-profile tyres, multi-spoke rims, discs and calipers -----
  const tw = Math.min(0.3, w * 0.15);
  const ri = r * 0.74;
  const tyreGeo = () =>
    new THREE.LatheGeometry(
      [
        [ri, -tw / 2],
        [r - 0.03, -tw / 2],
        [r - 0.008, -tw / 2 + 0.02],
        [r, -tw / 2 + 0.055],
        [r, tw / 2 - 0.055],
        [r - 0.008, tw / 2 - 0.02],
        [r - 0.03, tw / 2],
        [ri, tw / 2],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      22,
    ).rotateZ(-Math.PI / 2);
  for (const [i, zc] of zWheels.entries()) {
    const tc = tWheels[i];
    const hwA = P.hw(tc) * w;
    // the dark wheel well and the flared lip round each arch
    b.batch(inward(new THREE.CylinderGeometry(ra - 0.012, ra - 0.012, hwA * 2 - 0.06, 22, 1, true, 0, Math.PI).rotateZ(Math.PI / 2)), liner, at(0, r, zc));
    for (const sx of [-1, 1]) {
      const xf = sx * (sideX(tc, r + ra * 0.7) - 0.012);
      b.batch(new THREE.TorusGeometry(ra + 0.004, 0.022, 5, 20, Math.PI).rotateY(Math.PI / 2), paint, at(xf, r, zc));
      // close the flare's two ends
      for (const sz of [-1, 1]) b.batch(new THREE.SphereGeometry(0.022, 6, 4), paint, at(xf, r, zc + sz * (ra + 0.004)));
      const x = sx * (hwA - tw / 2 - 0.02);
      b.batch(tyreGeo(), tyreM, at(x, r, zc));
      // rim barrel and the dark inside behind the spokes
      b.batch(inward(new THREE.CylinderGeometry(ri * 0.995, ri * 0.995, tw, 24, 1, true).rotateZ(Math.PI / 2)), barrel, at(x, r, zc));
      b.batch(new THREE.CircleGeometry(ri, 20).rotateY((sx * Math.PI) / 2), under, at(x - sx * tw * 0.3, r, zc));
      // brake disc and caliper
      b.batch(new THREE.CylinderGeometry(ri * 0.82, ri * 0.82, 0.03, 20).rotateZ(Math.PI / 2), discM, at(x - sx * tw * 0.05, r, zc));
      b.batch(new THREE.BoxGeometry(0.06, ri * 0.55, ri * 0.32).translate(0, ri * 0.66, 0).rotateX(i === 1 ? -0.7 : 0.7), caliperM, at(x, r, zc));
      // rim lip and ten spokes in five pairs, the centre cap
      b.batch(new THREE.RingGeometry(ri * 0.9, ri * 1.02, 26).rotateY((sx * Math.PI) / 2), rimM, at(x + sx * (tw / 2 - 0.012), r, zc));
      const xs = x + sx * (tw / 2 - 0.035);
      for (let k = 0; k < 5; k++)
        for (const off of [-0.13, 0.13]) {
          const len = ri * 0.78;
          const sp = new THREE.BoxGeometry(0.022, len, ri * 0.11).translate(0, ri * 0.14 + len / 2, 0).rotateX((k / 5) * Math.PI * 2 + off);
          b.batch(sp, rimM, at(xs, r, zc));
        }
      b.batch(new THREE.CylinderGeometry(ri * 0.22, ri * 0.26, 0.04, 14).rotateZ(Math.PI / 2), rimM, at(xs - sx * 0.005, r, zc));
      b.batch(new THREE.CylinderGeometry(ri * 0.1, ri * 0.1, 0.012, 10).rotateZ(Math.PI / 2), black, at(xs + sx * 0.018, r, zc));
    }
  }
}

export const BUILDERS: Record<string, Build> = {
  car_sports: (b, w, d, h, _f, color) => sportsCar(b, w, d, h, color),
};
