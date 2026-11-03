// More detailed built-in pieces: car estate. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINISHES } from "../../model/modern";
import { type Build, type Builder, C, mat } from "../modern";

type P = [number, number];

/** A smooth curve through (t, y) points without overshoot (monotone cubic Hermite). */
function smooth(pts: P[]): (t: number) => number {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) s.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / s[i];
    const c = m[i + 1] / s[i];
    const q = a * a + c * c;
    if (q > 9) {
      const k = 3 / Math.sqrt(q);
      m[i] = k * a * s[i];
      m[i + 1] = k * c * s[i];
    }
  }
  return (t) => {
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (t > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const u = (t - xs[i]) / hh;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * hh * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * hh * m[i + 1];
  };
}

const smoothstep = (a: number, c: number, x: number) => {
  const u = Math.max(0, Math.min(1, (x - a) / (c - a)));
  return u * u * (3 - 2 * u);
};

type Tris = Map<THREE.Material, number[]>;

/** The collected triangles, per material, with creased normals, into the builder's batches. */
function emit(b: Builder, tris: Tris) {
  for (const [m, pos] of tris) {
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    b.batch(toCreasedNormals(geo, 0.75), m);
  }
}
function tri(list: Tris, m: THREE.Material, a: THREE.Vector3, c: THREE.Vector3, e: THREE.Vector3) {
  // skip slivers (collapsed sections)
  if (c.clone().sub(a).cross(e.clone().sub(a)).lengthSq() < 1e-12) return;
  let arr = list.get(m);
  if (!arr) list.set(m, (arr = []));
  arr.push(a.x, a.y, a.z, c.x, c.y, c.z, e.x, e.y, e.z);
}

/** Rings of points (each counter-clockwise seen from +z, at rising z) joined into a skin. */
function loft(list: Tris, rings: THREE.Vector3[][], closed: boolean, pick: (i: number, j: number) => THREE.Material | null) {
  const n = rings[0].length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < segs; j++) {
      const m = pick(i, j);
      if (!m) continue;
      const j2 = (j + 1) % n;
      const a = rings[i][j];
      const c = rings[i][j2];
      const e = rings[i + 1][j2];
      const f = rings[i + 1][j];
      tri(list, m, a, c, e);
      tri(list, m, a, e, f);
    }
}

/** A flat cap over a ring (a fan from its centre), facing +z (front) or −z. */
function cap(list: Tris, ring: THREE.Vector3[], m: THREE.Material, front: boolean) {
  const c = ring.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / ring.length);
  for (let j = 0; j < ring.length; j++) {
    const p = ring[j];
    const q = ring[(j + 1) % ring.length];
    if (front) tri(list, m, c, p, q);
    else tri(list, m, c, q, p);
  }
}

/** A thin box from a to c (points (z, y) in the plane at x), for seams and trim lines. */
function strip(b: Builder, m: THREE.Material, x: number, a: P, c: P, tx: number, ty: number) {
  const dz = c[0] - a[0];
  const dy = c[1] - a[1];
  const len = Math.hypot(dz, dy);
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(tx, ty, len);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.atan2(-dy, dz)));
  g.translate(x, (a[1] + c[1]) / 2, (a[0] + c[0]) / 2);
  b.batch(g, m);
}

/**
 * A modern estate (VW Passat Variant, Volvo V60): a lofted body with curved panels and
 * wheel arches, a tapered glasshouse with black frames and three side windows a side,
 * the long roof with rails ending in an almost upright tailgate, lights, grille, plates.
 */
function estate(b: Builder, w: number, d: number, h: number, color: string) {
  const paint = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.3, metalness: 0.35 });
  const glassM = mat("#34434e", { roughness: 0.08, metalness: 0.55 });
  const frame = mat("#0e0f11", { roughness: 0.45 });
  const plastic = mat("#1c1d20", { roughness: 0.8 });
  const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
  const seam = mat("#0b0b0c", { roughness: 0.9 });
  const tyreM = mat("#1a1b1d", { roughness: 0.92 });
  const rimM = mat("#c3c7cc", { metalness: 0.75, roughness: 0.28 });
  const dishM = mat("#2c2e32", { metalness: 0.4, roughness: 0.5 });
  const head = mat("#eef1f4", { emissive: "#fff4d6", emissiveIntensity: 0.35, roughness: 0.15, side: THREE.DoubleSide });
  const headInner = mat("#9aa3ab", { metalness: 0.7, roughness: 0.2 });
  const tail = mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.45, roughness: 0.2, side: THREE.DoubleSide });
  const plate = mat("#f1f1ec", { roughness: 0.5 });
  const euro = mat("#24409a", { roughness: 0.6 });

  const tris: Tris = new Map();
  const e = Math.min(0.015, d * 0.004);
  const zR = -d / 2 + e;
  const zF = d / 2 - e;
  const L = zF - zR;
  const Z = (t: number) => zR + t * L;
  const T = (z: number) => (z - zR) / L;

  // wheels and arches
  const r = Math.min(0.232 * h, 0.075 * d, 0.19 * w);
  const ra = r * 1.2;
  const acy = r * 0.88;
  const wheels = [Z(0.215), Z(0.795)];
  const tw = Math.min(0.235, w * 0.125);

  // the body's half width along z: a slightly narrower nose, rounded corners in plan,
  // a hint of flare over the wheels
  const hw0 = w * 0.465;
  const rn = Math.min(0.24, hw0 * 0.32, L * 0.06);
  const rr = Math.min(0.22, hw0 * 0.3, L * 0.06);
  const HW = (z: number) => {
    const t = T(z);
    let hw = hw0 * (1 - 0.03 * smoothstep(0.75, 1, t) - 0.012 * smoothstep(0.2, 0, t));
    const df = zF - z;
    if (df < rn) hw -= rn - Math.sqrt(Math.max(0, rn * rn - (rn - df) ** 2));
    const dr = z - zR;
    if (dr < rr) hw -= rr - Math.sqrt(Math.max(0, rr * rr - (rr - dr) ** 2));
    for (const zc of wheels) hw += 0.016 * Math.exp(-(((z - zc) / (ra * 1.1)) ** 2));
    return hw;
  };
  const scaled = (pts: P[]) => smooth(pts.map(([t, y]) => [t, y * h] as P));
  // the lower body's top (bonnet, shoulder, tail) and bottom (sill, bumpers, arches)
  const top = scaled([
    [0, 0.6],
    [0.006, 0.612],
    [0.018, 0.626],
    [0.1, 0.632],
    [0.45, 0.622],
    [0.7, 0.608],
    [0.75, 0.603],
    [0.85, 0.594],
    [0.93, 0.582],
    [0.965, 0.568],
    [0.985, 0.548],
    [0.997, 0.518],
    [1, 0.49],
  ]);
  const bottomEnds = scaled([
    [0, 0.2],
    [0.05, 0.13],
    [0.1, 0.12],
    [0.9, 0.12],
    [0.96, 0.13],
    [1, 0.165],
  ]);
  const bottom = (z: number) => {
    let y = bottomEnds(T(z));
    for (const zc of wheels) {
      const dz = Math.abs(z - zc);
      if (dz <= ra) y = Math.max(y, acy + Math.sqrt(ra * ra - dz * dz));
    }
    return y;
  };

  /** Half a cross-section of the lower body, from the bottom centre up to the top centre. */
  const RB = 0.06;
  const RT = 0.1;
  const section = (z: number): P[] => {
    const hw = HW(z);
    const yb = bottom(z);
    const yt = top(T(z));
    const span = Math.max(0.001, yt - yb);
    const k = Math.min(1, (span * 0.9) / (RB + RT));
    const rb = RB * k;
    const rt = RT * k;
    const tuck = 0.02;
    const pts: P[] = [[0, yb]];
    for (let a = 0; a <= 3; a++) {
      const ang = -Math.PI / 2 + (a / 3) * (Math.PI / 2);
      pts.push([hw - tuck - rb + Math.cos(ang) * (rb + (a === 3 ? tuck : 0)), yb + rb + Math.sin(ang) * rb]);
    }
    pts.push([hw, yb + rb + (yt - rt - yb - rb) * 0.55]);
    for (let a = 0; a <= 4; a++) {
      const ang = (a / 4) * (Math.PI / 2);
      pts.push([hw - rt + Math.cos(ang) * rt, yt - rt + Math.sin(ang) * rt]);
    }
    pts.push([0, yt + 0.012]);
    return pts;
  };
  // segment kinds of the half section: underside and sill dark, the rest paint
  const lowerKinds = [plastic, plastic, plastic, plastic, paint, paint, paint, paint, paint, paint, paint];
  const ringOf = (half: P[], z: number) => {
    const ring = half.map(([x, y]) => new THREE.Vector3(x, y, z));
    for (let j = half.length - 2; j >= 1; j--) ring.push(new THREE.Vector3(-half[j][0], half[j][1], z));
    return ring;
  };
  /** The lower body's surface x at height y (right side), at z. */
  const sideX = (z: number, y: number) => {
    const s = section(z);
    for (let j = 0; j < s.length - 1; j++) {
      const [x0, y0] = s[j];
      const [x1, y1] = s[j + 1];
      if (y >= y0 && y <= y1 && y1 > y0) return x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
    }
    return y < s[0][1] ? s[1][0] : 0;
  };

  // stations along the body: even spacing, dense round the ends and the arches
  const zs: number[] = [];
  for (let t = 0; t <= 1.0001; t += 0.028) zs.push(Z(Math.min(1, t)));
  for (let k = 1; k < 6; k++) {
    const f = 1 - Math.cos(((k / 6) * Math.PI) / 2);
    zs.push(zF - rn * f, zR + rr * f);
  }
  zs.push(zF - 0.004, zR + 0.004);
  for (const zc of wheels) {
    for (let a = -90; a <= 90; a += 15) zs.push(zc + ra * Math.sin((a * Math.PI) / 180));
    zs.push(zc - ra - 0.003, zc + ra + 0.003);
  }
  zs.sort((a, c) => a - c);
  const stations = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.002);
  const lowerRings = stations.map((z) => ringOf(section(z), z));
  const nHalf = section(0).length - 1;
  loft(tris, lowerRings, true, (_i, j) => lowerKinds[j < nHalf ? j : 2 * nHalf - 1 - j]);
  cap(tris, lowerRings[0], paint, false);
  cap(tris, lowerRings[lowerRings.length - 1], paint, true);

  // ----- the glasshouse: windscreen, side windows, roof, tailgate window -----
  const tG0 = 0.018;
  const tG1 = 0.7;
  const roofH = 0.962 * h;
  const roofPts: P[] = [
    [0.03, 0.75],
    [0.05, 0.86],
    [0.07, 0.925],
    [0.09, 0.948],
    [0.12, 0.957],
    [0.3, 0.962],
    [0.45, 0.96],
    [0.505, 0.952],
    [0.53, 0.932],
    [0.56, 0.888],
    [0.62, 0.78],
    [0.68, 0.66],
  ];
  const roof = smooth([[tG0, top(tG0)], ...roofPts.map(([t, y]) => [t, y * h] as P), [tG1, top(tG1)]]);
  const belt = (t: number) => top(t) - 0.004;
  const tumble = Math.min(0.15, w * 0.08);
  const hwB = (t: number) => HW(Z(t)) - 0.045;
  const gSection = (t: number): P[] => {
    const yb = belt(t);
    const yt = Math.max(yb, roof(t));
    const span = yt - yb;
    const full = roofH - yb;
    const xb = hwB(t);
    const xs = (y: number) => xb - (tumble * (y - yb)) / Math.max(0.01, full);
    const rc = Math.min(0.1, span * 0.35);
    const fr = Math.min(0.035, span * 0.12);
    const tr = Math.min(0.028, span * 0.1);
    const yw = yt - rc - fr; // the side windows' top
    const pts: P[] = [
      [xb + 0.004, yb - 0.025],
      [xs(yb + tr), yb + tr],
      [xs((yb + tr + yw) / 2), (yb + tr + yw) / 2],
      [xs(yw), yw],
      [xs(yt - rc), yt - rc],
    ];
    const cx = xs(yt - rc) - rc;
    for (let a = 1; a <= 4; a++) {
      const ang = (a / 4) * (Math.PI / 2);
      pts.push([cx + Math.cos(ang) * rc, yt - rc + Math.sin(ang) * rc]);
    }
    pts.push([0, yt + 0.014 * Math.min(1, span / 0.3)]);
    return pts;
  };
  const tg = [
    tG0, 0.022, 0.028, 0.036, 0.046, 0.058, 0.07, 0.08, 0.088, 0.096, 0.1, 0.13, 0.17, 0.21, 0.245, 0.265, 0.3, 0.34, 0.38, 0.42, 0.445, 0.47, 0.49, 0.505, 0.522, 0.54,
    0.56, 0.585, 0.61, 0.635, 0.655, 0.67, 0.685, tG1,
  ];
  const gRings = tg.map((t) => ringOf(gSection(t), Z(t)));
  // side windows: front door, rear door, rear quarter (between B, C and D pillars)
  const windows: P[] = [
    [0.47, 0.66],
    [0.265, 0.445],
    [0.1, 0.245],
  ];
  const inWin = (t: number) => windows.some(([a, c]) => t > a && t < c);
  const inRoof = (t: number) => t > 0.096 && t < 0.505;
  const gHalf = gSection(0.3).length - 1;
  loft(tris, gRings, false, (i, j) => {
    const t = (tg[i] + tg[i + 1]) / 2;
    const k = j < gHalf ? j : 2 * gHalf - 1 - j;
    if (k === 0) return chrome;
    if (k === 1 || k === 2) return inWin(t) ? glassM : frame;
    if (k === 3 || k === 4) return frame;
    if (k < 8) return inRoof(t) ? paint : frame;
    if (inRoof(t)) return paint;
    if ((t > 0.522 && t < tG1) || t < 0.08) return glassM;
    return frame;
  });

  emit(b, tris);

  // ----- details along the sides -----
  for (const sx of [-1, 1]) {
    const onSide = (path: P[], m: THREE.Material, t = 0.007) => {
      for (let k = 0; k < path.length - 1; k++) {
        const zm = (path[k][0] + path[k + 1][0]) / 2;
        const ym = (path[k][1] + path[k + 1][1]) / 2;
        strip(b, m, sx * (sideX(zm, ym) + 0.001), path[k], path[k + 1], 0.006, t);
      }
    };
    const vertical = (t: number, y0: number, y1: number) => {
      const pts: P[] = [];
      for (let k = 0; k <= 6; k++) pts.push([Z(t), y0 + ((y1 - y0) * k) / 6]);
      return pts;
    };
    // door shut lines: front door, B pillar, rear door round the rear arch
    const tA = 0.7;
    const tB = 0.458;
    const tC = 0.272;
    const ySill = bottom(Z(0.45)) + 0.075;
    onSide(vertical(tA, ySill, belt(tA) - 0.01), seam);
    onSide(vertical(tB, ySill, belt(tB) - 0.01), seam);
    const zr = wheels[0];
    const ro = ra + 0.06;
    const path: P[] = vertical(tC, acy + ro + 0.03, belt(tC) - 0.01).reverse();
    for (let a = 75; a >= 0; a -= 15) {
      const ang = (a * Math.PI) / 180;
      path.push([zr + Math.cos(ang) * ro, acy + Math.sin(ang) * ro]);
    }
    path.push([zr + ro, ySill]);
    onSide(path, seam);
    onSide([[zr + ro, ySill], [Z(tA), ySill]], seam, 0.006);
    // handles
    for (const t of [0.505, 0.31]) {
      const z = Z(t);
      const y = belt(t) - 0.135;
      const g = new THREE.BoxGeometry(0.025, 0.028, 0.13);
      g.translate(sx * (sideX(z, y) + 0.008), y, z);
      b.batch(g, chrome);
      const g2 = new THREE.BoxGeometry(0.01, 0.045, 0.16);
      g2.translate(sx * (sideX(z, y) + 0.001), y, z + 0.01);
      b.batch(g2, seam);
    }
    // the mirror: a painted cap on a black arm at the front of the front window
    const tm = 0.655;
    const zm = Z(tm);
    const ym = belt(tm) + 0.07;
    const xIn = hwB(tm) - 0.02;
    const xOut = w / 2 - 0.004;
    const arm = new THREE.BoxGeometry(xOut - xIn - 0.1, 0.05, 0.08);
    arm.translate(sx * (xIn + (xOut - xIn - 0.1) / 2), ym - 0.03, zm - 0.04);
    b.batch(arm, frame);
    const shell = new THREE.SphereGeometry(1, 12, 8);
    shell.scale(0.12, 0.07, 0.065);
    shell.translate(sx * (xOut - 0.12), ym + 0.02, zm - 0.03);
    b.batch(shell, paint);
    const glassFace = new THREE.BoxGeometry(0.2, 0.1, 0.01);
    glassFace.translate(sx * (xOut - 0.12), ym + 0.02, zm - 0.075);
    b.batch(glassFace, frame);
    // roof rails on feet
    const xr = gSection(0.3)[6][0];
    const railPts: THREE.Vector3[] = [];
    // the tube's open ends go down into the feet
    for (let k = 0; k <= 10; k++) {
      const t = 0.13 + (k / 10) * 0.35;
      const lift = k === 0 || k === 10 ? 0.012 : 0.04;
      railPts.push(new THREE.Vector3(sx * xr, Math.min(h - 0.016, roof(t) + lift), Z(t)));
    }
    b.batch(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 16, 0.014, 6), chrome);
    for (const t of [0.13, 0.48]) {
      const g = new THREE.BoxGeometry(0.035, 0.05, 0.12);
      g.translate(sx * xr, roof(t) + 0.012, Z(t));
      b.batch(g, frame);
    }
  }

  // ----- wheels: tyres with sidewalls, a dish and five double spokes, the hub -----
  const ri = r * 0.7;
  const lathe = [
    [ri, -tw * 0.45],
    [r * 0.86, -tw * 0.5],
    [r * 0.97, -tw * 0.44],
    [r, -tw * 0.3],
    [r, tw * 0.3],
    [r * 0.97, tw * 0.44],
    [r * 0.86, tw * 0.5],
    [ri, tw * 0.45],
    [ri * 0.99, tw * 0.44],
    [ri * 0.99, -tw * 0.44],
    [ri, -tw * 0.45],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  for (const zc of wheels)
    for (const sx of [-1, 1]) {
      const xo = HW(zc) - 0.014; // the tyre's outer face, just inside the body
      const xc = xo - tw / 2;
      const place = (g: THREE.BufferGeometry, m: THREE.Material, x: number) => {
        g.translate(sx * x, r, zc);
        b.batch(g, m);
      };
      // closed on the inside too, so no hole shows past the rim
      const tyre = toCreasedNormals(new THREE.LatheGeometry(lathe, 20), 0.6);
      tyre.rotateZ(Math.PI / 2);
      place(tyre, tyreM, xc);
      const dish = new THREE.CylinderGeometry(ri * 0.98, ri * 0.98, 0.02, 20);
      dish.rotateZ(Math.PI / 2);
      place(dish, dishM, xo - 0.06);
      const lip = new THREE.TorusGeometry(ri * 0.97, 0.013, 4, 20);
      lip.rotateY(Math.PI / 2);
      place(lip, rimM, xo - 0.035);
      for (let k = 0; k < 5; k++)
        for (const off of [-0.11, 0.11]) {
          const len = ri * 0.82;
          const g = new THREE.BoxGeometry(0.022, len, ri * 0.11);
          g.translate(0, ri * 0.14 + len / 2, 0);
          g.applyMatrix4(new THREE.Matrix4().makeRotationX((k / 5) * Math.PI * 2 + off));
          place(g, rimM, xo - 0.035);
        }
      const hub = new THREE.CylinderGeometry(r * 0.15, r * 0.17, 0.04, 12);
      hub.rotateZ(Math.PI / 2);
      place(hub, rimM, xo - 0.035);
      const badge = new THREE.CylinderGeometry(r * 0.07, r * 0.07, 0.044, 10);
      badge.rotateZ(Math.PI / 2);
      place(badge, frame, xo - 0.035);
    }

  // ----- front: headlights wrapping round the corners, grille, bumper intake, plate -----
  /** A thin band at heights y0..y1 following the body's outline in plan, from x0 on the end face round the corner to z = zTo. */
  const wrapBand = (front: boolean, x0: number, zTo: number, y0: number, y1: number, m: THREE.Material, out = 0.006) => {
    const zEnd = front ? zF : zR;
    const ym = (y0 + y1) / 2;
    const pts: P[] = [[x0, zEnd]];
    const xe = sideX(zEnd, ym);
    if (xe > x0) pts.push([xe, zEnd]);
    const list = front ? [...stations].reverse() : stations;
    for (const z of list) {
      if (front ? z >= zEnd || z < zTo : z <= zEnd || z > zTo) continue;
      pts.push([sideX(z, ym), z]);
    }
    for (const sx of [-1, 1]) {
      const pos: number[] = [];
      const off = pts.map((p, k) => {
        const q = pts[Math.min(pts.length - 1, k + 1)];
        const o = pts[Math.max(0, k - 1)];
        // outward normal in plan: the outline runs from the end face back round the corner
        let nx = front ? -(q[1] - o[1]) : q[1] - o[1];
        let nz = front ? q[0] - o[0] : -(q[0] - o[0]);
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        return [p[0] + nx * out, p[1] + nz * out] as P;
      });
      for (let k = 0; k < off.length - 1; k++) {
        const a = off[k];
        const c = off[k + 1];
        const A0 = new THREE.Vector3(sx * a[0], y0, a[1]);
        const A1 = new THREE.Vector3(sx * a[0], y1, a[1]);
        const B0 = new THREE.Vector3(sx * c[0], y0, c[1]);
        const B1 = new THREE.Vector3(sx * c[0], y1, c[1]);
        const quad = (sx > 0) === front ? [A0, B1, A1, A0, B0, B1] : [A0, A1, B1, A0, B1, B0];
        for (const p of quad) pos.push(p.x, p.y, p.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      b.batch(g, m);
    }
  };
  const yNose = top(1);
  const yFb = bottomEnds(1);
  const capHw = sideX(zF, (yNose + yFb) / 2);
  // headlights: a slim band under the bonnet edge, wrapping back round the corners
  // headlights right under the bonnet's edge, the grille between them at the same height
  const hl0 = yNose - 0.13;
  const hl1 = yNose - 0.035;
  wrapBand(true, capHw * 0.5, zF - rn * 0.75, hl0, hl1, headInner, 0.004);
  wrapBand(true, capHw * 0.52, zF - rn * 0.7, hl0 + 0.012, hl1 - 0.012, head, 0.008);
  wrapBand(true, capHw * 0.55, zF - rn * 0.65, hl0 - 0.012, hl0 - 0.002, head, 0.009); // daytime running strip
  // grille between the headlights, with chrome bars
  const gw = capHw * 0.98;
  b.box(gw, hl1 - hl0 + 0.02, 0.03, 0, hl0 - 0.01, zF - 0.003, plastic, 0.008);
  for (const y of [hl0 + 0.008, hl0 + 0.036, hl0 + 0.064]) b.box(gw * 0.96, 0.009, 0.01, 0, y, zF + 0.013, chrome);
  // bumper: a wide intake low down, the plate above it
  const yInt = yFb + 0.03;
  b.box(capHw * 2.15, 0.12, 0.03, 0, yInt, zF - 0.004, plastic, 0.012);
  for (const sx of [-1, 1]) b.box(0.16, 0.022, 0.012, sx * capHw * 0.92, yInt + 0.05, zF + 0.012, chrome);
  const pw = Math.min(0.52, w * 0.28);
  b.box(pw, 0.11, 0.012, 0, yInt + 0.14, zF + 0.002, plate, 0.004);
  b.box(0.04, 0.1, 0.004, -pw / 2 + 0.025, yInt + 0.145, zF + 0.009, euro);
  const badge = b.cyl(0.045, 0.045, 0.012, 0, 0, 0, chrome, 16);
  badge.rotation.x = Math.PI / 2;
  badge.position.set(0, hl0 + 0.05, zF + 0.012);

  // ----- rear: wrap-round tail lights, light bar, spoiler, bumper, plate -----
  const yTail = top(0);
  const rcap = sideX(zR, 0.6 * h);
  const tl0 = yTail - 0.15;
  const tl1 = yTail - 0.065;
  wrapBand(false, rcap * 0.55, zR + rr * 1.6, tl0, tl1, tail, 0.007);
  b.box(rcap * 1.12, 0.022, 0.012, 0, tl0 + 0.05, zR - 0.006, tail);
  // tailgate shut lines and the bumper's top edge
  const yBump = 0.36 * h;
  b.box(rcap * 2, 0.007, 0.006, 0, yBump, zR - 0.003, seam);
  for (const sx of [-1, 1]) b.box(0.007, tl0 - yBump - 0.02, 0.006, sx * rcap * 0.53, yBump + 0.01, zR - 0.003, seam);
  // plate, handle strip, diffuser
  const ybRear = bottomEnds(0);
  b.box(pw, 0.11, 0.012, 0, yBump + 0.05, zR - 0.002, plate, 0.004);
  b.box(0.04, 0.1, 0.004, -pw / 2 + 0.025, yBump + 0.055, zR - 0.009, euro);
  b.box(pw * 0.9, 0.02, 0.012, 0, yBump + 0.18, zR - 0.004, chrome);
  b.box(rcap * 2.1, 0.1, 0.03, 0, ybRear, zR + 0.006, plastic, 0.012);
  for (const sx of [-1, 1]) b.box(0.08, 0.025, 0.012, sx * rcap * 0.75, ybRear + 0.04, zR - 0.006, frame);
  // roof spoiler over the tailgate window, with the third brake light
  const ts = 0.09;
  const ysp = roof(ts) - 0.01;
  const swp = (gSection(ts)[5][0] + 0.02) * 2;
  b.box(swp, 0.035, 0.17, 0, ysp, Z(ts) - 0.04, paint, 0.015);
  b.box(0.3, 0.012, 0.01, 0, ysp + 0.008, Z(ts) - 0.126, tail);
  // shark-fin aerial
  const fin = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  fin.scale(0.03, 0.05, 0.12);
  fin.translate(0, roof(0.14) + 0.01, Z(0.14));
  b.batch(fin, frame);
}

export const BUILDERS: Record<string, Build> = {
  car_estate: (b, w, d, h, _f, color) => estate(b, w, d, h, color),
};
