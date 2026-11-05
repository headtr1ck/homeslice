// More detailed built-in pieces: car suv. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { FINISHES } from "../../model/modern";
import { C, mat, type Build, type Builder } from "../modern";

type P2 = [number, number];
const rad = (a: number) => (a * Math.PI) / 180;

/** Eased interpolation through [t, value] keys (t ascending): a flowing line. */
function along(keys: P2[], t: number) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const s = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (s * s * (3 - 2 * s));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * A surface through rows of points (rows × columns), only the quads `pick` keeps:
 * one geometry per material from the same grid, smooth inside, a clean edge between.
 */
function grid(rows: THREE.Vector3[][], pick: (row: number, col: number) => boolean, flip: boolean) {
  const nc = rows[0].length;
  const pos = new Float32Array(rows.length * nc * 3);
  rows.forEach((r, i) => r.forEach((p, j) => pos.set([p.x, p.y, p.z], (i * nc + j) * 3)));
  const idx: number[] = [];
  for (let i = 0; i < rows.length - 1; i++)
    for (let j = 0; j < nc - 1; j++) {
      if (!pick(i, j)) continue;
      const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Flat triangles (front and rear faces, roof top). */
function tris(points: THREE.Vector3[]) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Half the body's cross-section (x ≥ 0), from the middle of the floor out, up the side
 * and over the shoulder to the middle of the top. The first CLAD_COLS segments are the
 * black sill cladding (up to y = clad), the rest the paint. `rt0` is the shoulder radius.
 */
function section(bot: number, top: number, hw: number, clad: number, rt0: number): P2[] {
  const H = top - bot;
  const rb = Math.min(0.06, H * 0.2);
  const rt = Math.max(0.02, Math.min(rt0, H - rb - 0.02));
  const tuck = 0.035;
  const yc = Math.min(Math.max(clad, bot + rb + 0.004), top - rt - 0.004);
  const pts: P2[] = [[0, bot], [hw - tuck - rb, bot]];
  for (const a of [-60, -30, 0]) pts.push([hw - tuck - rb + rb * Math.cos(rad(a)), bot + rb + rb * Math.sin(rad(a))]);
  pts.push([hw, yc], [hw + 0.012, (yc + top - rt) / 2]);
  for (const a of [0, 25, 50, 70, 90]) pts.push([hw - rt + rt * Math.cos(rad(a)), top - rt + rt * Math.sin(rad(a))]);
  pts.push([(hw - rt) * 0.5, top + 0.015], [0, top + 0.02]);
  return pts;
}
const CLAD_COLS = 5;

/** A box from its bottom centre with lightly rounded edges (few triangles). */
function rbox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r: number) {
  return b.add(new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), m, x, y + h / 2, z);
}

/**
 * A modern SUV along z (front at +z): a lofted body with rounded shoulders, bonnet and
 * corners, black cladding over sills and arches, a tapered glasshouse with black pillars
 * and separate side windows, big wheels on multi-spoke rims, roof rails, LED lights.
 */
function suv(b: Builder, w: number, d: number, h: number, color: string) {
  const paint = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.35, metalness: 0.3 });
  const clad = mat("#1d1e20", { roughness: 0.85 });
  const trim = mat("#111214", { roughness: 0.35 });
  const glassM = mat("#2c3b47", { roughness: 0.06, metalness: 0.55 });
  const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
  const satin = mat(C.steel, { metalness: 0.6, roughness: 0.35 });
  const seamM = mat("#0b0c0d", { roughness: 0.9 });
  const head = mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.3 });
  const tail = mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.4 });
  const fy = (k: number) => k * h; // heights as a share of the height

  // ----- proportions (all scale with the piece's size) -----
  const r = Math.min(0.4, h * 0.23, d * 0.085); // wheel radius
  const ra = r + 0.07; // arch radius
  const hw0 = w / 2 - 0.07; // body half width (the mirrors reach w / 2)
  const tw = Math.min(0.255, w * 0.13); // tyre width
  const zR = -d / 2 + 0.2 * d, zF = -d / 2 + 0.8 * d; // axles
  const zb = -d / 2 + 0.015, zf = d / 2 - 0.015; // the body's ends
  const bot0 = 0.18 * h; // sill bottom: high clearance
  const cladY = 0.29 * h;
  const rt0 = Math.min(0.15, h * 0.09);
  const T = (z: number) => (z + d / 2) / d;
  const topKeys: P2[] = [[0, 0.62], [0.04, 0.64], [0.7, 0.64], [0.76, 0.639], [0.9, 0.635], [1, 0.628]];
  const Lr = Math.min(0.22, d * 0.05), Lf = Math.min(0.3, d * 0.065);
  const end = (z: number) => {
    const tr = Math.min(1, Math.max(0, (z - zb) / Lr)), tf = Math.min(1, Math.max(0, (zf - z) / Lf));
    return [1 - Math.sqrt(1 - (1 - tr) ** 2), 1 - Math.sqrt(1 - (1 - tf) ** 2)];
  };
  const bodyAt = (z: number, bot: number) => {
    const [er, ef] = end(z);
    return { hw: hw0 - 0.12 * er - 0.22 * ef, top: along(topKeys, T(z)) * h - 0.06 * er - 0.045 * ef, bot: bot + 0.05 * er + 0.05 * ef };
  };

  // ----- body: sections along z, denser at the corners and around the arches -----
  const st: { z: number; bot: number }[] = [];
  const push = (z: number, bot: number) => {
    const last = st[st.length - 1];
    if (last && (z < last.z - 1e-6 || (Math.abs(z - last.z) < 1e-6 && bot === last.bot))) return;
    st.push({ z, bot });
  };
  const fill = (z0: number, z1: number, step: number) => {
    const n = Math.max(1, Math.round((z1 - z0) / step));
    for (let i = 1; i < n; i++) push(z0 + ((z1 - z0) * i) / n, bot0);
  };
  const arch = (zc: number) => {
    push(zc - ra, bot0);
    for (let a = 180; a >= 0; a -= 15) push(zc + ra * Math.cos(rad(a)), r + ra * Math.sin(rad(a)));
    push(zc + ra, bot0);
  };
  for (let i = 0; i <= 5; i++) push(zb + Lr * (1 - Math.cos((i / 5) * (Math.PI / 2))), bot0);
  fill(zb + Lr, zR - ra, 0.15);
  arch(zR);
  fill(zR + ra, zF - ra, 0.15);
  arch(zF);
  fill(zF + ra, zf - Lf, 0.15);
  for (let i = 5; i >= 0; i--) push(zf - Lf * (1 - Math.cos((i / 5) * (Math.PI / 2))), bot0);

  const rings = st.map(({ z, bot }) => {
    const s = bodyAt(z, bot);
    return section(s.bot, s.top, s.hw, cladY, rt0).map(([x, y]) => new THREE.Vector3(x, y, z));
  });
  for (const sx of [1, -1]) {
    const rows = sx > 0 ? rings : rings.map((row) => row.map((p) => new THREE.Vector3(-p.x, p.y, p.z)));
    const cg = grid(rows, (_i, j) => j < CLAD_COLS, sx < 0);
    const pg = grid(rows, (_i, j) => j >= CLAD_COLS, sx < 0);
    if (cg) b.add(cg, clad);
    if (pg) b.add(pg, paint);
  }
  // the front and rear faces, between each section point and its mirror
  for (const [row, front] of [[rings[rings.length - 1], true], [rings[0], false]] as const) {
    const cp: THREE.Vector3[] = [], pp: THREE.Vector3[] = [];
    for (let k = 0; k < row.length - 1; k++) {
      const R0 = row[k], R1 = row[k + 1];
      const L0 = new THREE.Vector3(-R0.x, R0.y, R0.z), L1 = new THREE.Vector3(-R1.x, R1.y, R1.z);
      const out = k < CLAD_COLS ? cp : pp;
      if (front) out.push(R0, R1, L0, L0, R1, L1);
      else out.push(R0, L0, R1, L0, L1, R1);
    }
    b.add(tris(cp), clad);
    b.add(tris(pp), paint);
  }

  // ----- the glasshouse: rounded plan sections stacked from the belt to the roof -----
  const yB = 0.64 * h + 0.012; // the belt line
  const roofTop = h - 0.05; // the rails stand on the roof, up to h
  const yG = roofTop - 0.13 * (h / 1.7) - 0.02; // top of the glass
  const yFr = yG + 0.025; // top of the black frame
  const hwB = hw0 - 0.1, hwT = hw0 - 0.24;
  const zW0 = -d / 2 + 0.7 * d, zW1 = -d / 2 + 0.57 * d; // windscreen foot and top
  const zR0 = -d / 2 + 0.018 * d, zR1 = -d / 2 + 0.06 * d; // rear window foot and top
  const rc = 0.13, Rr = 0.1;
  const zB = -d / 2 + 0.43 * d, zC = zR; // B and C pillars
  const sideTags = [true, false, true, false, true, false]; // between the side's breakpoints; true: pillar
  const plan = (hw: number, zr: number, zfr: number) => {
    const pts: P2[] = [], tags: boolean[] = [];
    // tags[k]: what the segment from point k to k + 1 is
    const add = (x: number, z: number, pillar: boolean) => (pts.push([x, z]), tags.push(pillar));
    const arc = (cx: number, cz: number, angles: number[]) => angles.forEach((a) => add(cx + rc * Math.cos(rad(a)), cz + rc * Math.sin(rad(a)), true));
    const ix = hw - rc;
    let prev = -Infinity;
    const zs = [zr + rc, zr + rc + 0.12, zC - 0.06, zC + 0.06, zB - 0.045, zB + 0.045, zfr - rc].map((z) => (prev = Math.max(prev, Math.min(zfr - rc, Math.max(zr + rc, z)))));
    add(0, zr, false);
    add(ix * 0.5, zr, false);
    add(ix, zr, true);
    arc(ix, zr + rc, [300, 330]);
    zs.forEach((z, i) => add(hw, z, i < sideTags.length ? sideTags[i] : true));
    arc(ix, zfr - rc, [30, 60]);
    for (const f of [1, 0.5, 0, -0.5]) add(ix * f, zfr, false);
    add(-ix, zfr, true);
    arc(-ix, zfr - rc, [120, 150]);
    for (let i = zs.length - 1; i >= 0; i--) add(-hw, zs[i], i > 0 ? sideTags[i - 1] : true);
    arc(-ix, zr + rc, [210, 240]);
    add(-ix, zr, false);
    add(-ix * 0.5, zr, false);
    add(0, zr, false);
    return { pts, tags };
  };
  type Band = "trim" | "glass" | "frame" | "roof";
  const levels: { y: number; f: number; shrink: number; band: Band }[] = [{ y: yB - 0.1, f: 0, shrink: 0, band: "trim" }];
  const yg0 = yB + 0.03;
  for (const s of [0, 0.35, 0.7, 1]) {
    const y = yg0 + (yG - yg0) * s;
    levels.push({ y, f: (y - yB) / (yFr - yB), shrink: 0, band: s === 0 ? "trim" : "glass" });
  }
  levels.push({ y: yFr, f: 1, shrink: 0, band: "frame" });
  for (const a of [30, 60, 90]) levels.push({ y: yFr + (roofTop - yFr) * Math.sin(rad(a)), f: 1, shrink: Rr * (1 - Math.cos(rad(a))), band: "roof" });
  let tags: boolean[] = [];
  const gRows = levels.map(({ y, f, shrink }) => {
    const fc = Math.max(0, Math.min(1, f));
    const p = plan(hwB - (hwB - hwT) * fc ** 1.4 - shrink, zR0 + (zR1 - zR0) * fc + shrink, zW0 + (zW1 - zW0) * fc ** 0.9 - shrink);
    tags = p.tags;
    return p.pts.map(([x, z]) => new THREE.Vector3(x, y, z));
  });
  const band = (i: number) => levels[i + 1].band;
  const glassG = grid(gRows, (i, j) => band(i) === "glass" && !tags[j], true);
  const trimG = grid(gRows, (i, j) => band(i) === "trim" || band(i) === "frame" || (band(i) === "glass" && tags[j]), true);
  const roofG = grid(gRows, (i) => band(i) === "roof", true);
  if (glassG) b.add(glassG, glassM);
  if (trimG) b.add(trimG, trim);
  if (roofG) b.add(roofG, paint);
  // the roof's flat middle
  const topRow = gRows[gRows.length - 1];
  const mid = new THREE.Vector3(0, roofTop, (topRow[0].z + topRow[Math.floor(topRow.length / 2)].z) / 2);
  const cap: THREE.Vector3[] = [];
  for (let j = 0; j < topRow.length - 1; j++) cap.push(mid, topRow[j + 1], topRow[j]);
  b.add(tris(cap), paint);
  const roofHw = hwT - Rr, roofZr = zR1 + Rr, roofZf = zW1 - Rr;

  // roof rails on feet, a shark-fin aerial, a spoiler with the third brake light
  for (const sx of [-1, 1]) {
    const x = sx * (roofHw - 0.07);
    const z0 = roofZr + 0.12, z1 = roofZf - 0.12;
    b.box(0.035, 0.022, z1 - z0, x, h - 0.024, (z0 + z1) / 2, satin);
    for (const z of [z0 + 0.05, (z0 + z1) / 2, z1 - 0.05]) b.box(0.03, h - 0.02 - (roofTop - 0.01), 0.07, x, roofTop - 0.01, z, clad);
  }
  rbox(b, 0.06, 0.045, 0.16, 0, roofTop - 0.005, roofZr + 0.3, trim, 0.025);
  rbox(b, 2 * (roofHw - 0.02), 0.035, 0.2, 0, roofTop - 0.045, roofZr - 0.06, paint, 0.015);
  b.box(0.3, 0.012, 0.01, 0, roofTop - 0.04, roofZr - 0.162, tail);

  // ----- wheel arches: dark wells, black flared lips -----
  const xw = hw0 + 0.012 - tw / 2; // wheel centre: the tyre about flush with the lips
  const a0 = Math.asin(Math.max(-1, Math.min(1, (bot0 - 0.02 - r) / ra)));
  const lip = new THREE.Shape();
  lip.absarc(0, 0, ra + 0.08, a0, Math.PI - a0, false);
  lip.absarc(0, 0, ra - 0.005, Math.PI - a0, a0, true);
  const lipGeo = new THREE.ExtrudeGeometry(lip, { depth: 0.04, bevelEnabled: false, curveSegments: 9 });
  lipGeo.rotateY(-Math.PI / 2);
  const well = mat("#0d0e0f", { roughness: 0.95 });
  for (const zc of [zR, zF]) {
    b.box(2 * (xw - tw / 2 - 0.02), r + ra - 0.12, 2 * ra, 0, 0.12, zc, well);
    for (const sx of [-1, 1]) b.add(lipGeo, clad, sx * hw0 + 0.02, r, zc);
  }

  // ----- wheels: chunky tyres, ten-spoke rims, brake discs and hubs -----
  // listed from the inner wall to the outer one, so the lathe's faces point outwards
  const prof: P2[] = [[0.66, -0.42], [0.8, -0.5], [0.93, -0.48], [0.985, -0.42], [1, -0.3], [1, 0.3], [0.985, 0.42], [0.93, 0.48], [0.8, 0.5], [0.66, 0.42]];
  const tyreGeo = new THREE.LatheGeometry(prof.map(([q, a]) => new THREE.Vector2(q * r, a * tw)), 28).rotateZ(Math.PI / 2);
  const tyre = mat("#1b1c1e", { roughness: 0.92 });
  const rr = r * 0.66;
  const face = new THREE.Shape();
  for (let i = 0; i <= 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    if (i === 0) face.moveTo(rr, 0);
    else face.lineTo(rr * Math.cos(t), rr * Math.sin(t));
  }
  const n = 10, rh0 = rr * 0.34, rh1 = rr * 0.84;
  const d1 = Math.PI / n - 0.016 / rh1, d0 = Math.max(0.02, Math.PI / n - 0.02 / rh0);
  for (let i = 0; i < n; i++) {
    const c = ((i + 0.5) / n) * Math.PI * 2;
    const hole = new THREE.Path();
    hole.moveTo(rh1 * Math.cos(c - d1), rh1 * Math.sin(c - d1));
    hole.lineTo(rh1 * Math.cos(c), rh1 * Math.sin(c));
    hole.lineTo(rh1 * Math.cos(c + d1), rh1 * Math.sin(c + d1));
    hole.lineTo(rh0 * Math.cos(c + d0), rh0 * Math.sin(c + d0));
    hole.lineTo(rh0 * Math.cos(c - d0), rh0 * Math.sin(c - d0));
    face.holes.push(hole);
  }
  const rimGeo = new THREE.ExtrudeGeometry(face, { depth: 0.022, bevelEnabled: false, curveSegments: 3 });
  const rimR = rimGeo.clone().rotateY(Math.PI / 2);
  const rimL = rimGeo.rotateY(-Math.PI / 2);
  const rim = mat("#c3c7cb", { metalness: 0.65, roughness: 0.3 });
  const barrel = mat("#2a2c30", { roughness: 0.6, side: THREE.DoubleSide });
  const disc = mat("#5d6166", { metalness: 0.5, roughness: 0.45 });
  const hub = mat("#3a3d41", { metalness: 0.5, roughness: 0.4 });
  const barrelGeo = new THREE.CylinderGeometry(rr * 0.99, rr * 0.99, tw * 0.75, 20, 1, true).rotateZ(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(rr * 0.75, rr * 0.75, 0.025, 20).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(rr * 0.22, rr * 0.24, 0.03, 14).rotateZ(Math.PI / 2);
  const badgeGeo = new THREE.CylinderGeometry(rr * 0.1, rr * 0.1, 0.01, 12).rotateZ(Math.PI / 2);
  for (const z of [zR, zF])
    for (const sx of [-1, 1]) {
      const x = sx * xw;
      b.add(tyreGeo, tyre, x, r, z);
      b.add(barrelGeo, barrel, x, r, z);
      b.add(discGeo, disc, x + sx * tw * 0.05, r, z);
      b.box(0.05, rr * 0.35, rr * 0.3, x + sx * tw * 0.12, r + rr * 0.35, z - rr * 0.35, hub);
      // the spoke face a little inside the tyre's wall
      b.add(sx > 0 ? rimR : rimL, rim, x + sx * (tw * 0.36 - 0.022), r, z);
      b.add(hubGeo, hub, x + sx * tw * 0.36, r, z);
      b.add(badgeGeo, chrome, x + sx * (tw * 0.36 + 0.016), r, z);
    }

  // ----- the front: tall grille, LED headlights and light bar, intake, skid plate, plate -----
  const fz = zf;
  const hwF = hw0 - 0.22; // half width of the flat front face
  // the tall upright grille: a chrome surround, black inside, chrome slats, the badge
  const gw = w * 0.36, gy = fy(0.31), gh = fy(0.205);
  rbox(b, gw, gh, 0.04, 0, gy, fz - 0.012, chrome, 0.02);
  b.box(gw - 0.03, gh - 0.03, 0.04, 0, gy + 0.015, fz - 0.006, trim);
  for (let i = 1; i <= 6; i++) b.box(gw - 0.05, 0.01, 0.012, 0, gy + (gh * i) / 7 - 0.005, fz + 0.012, chrome);
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 20).rotateX(Math.PI / 2), chrome, 0, gy + gh / 2, fz + 0.022);
  // slim LED headlights turned back with the corners, joined by a light bar
  const hlW = w * 0.18, hy = fy(0.51), hh = fy(0.052);
  for (const sx of [-1, 1]) {
    const xh = sx * (gw / 2 + 0.03 + hlW / 2), th = sx * 0.12;
    rbox(b, hlW, hh, 0.09, xh, hy, fz - 0.035, trim, 0.02).rotation.y = th;
    b.box(hlW - 0.02, 0.02, 0.094, xh, hy + hh - 0.028, fz - 0.035, head)!.rotation.y = th;
    for (const lx of [-0.06, 0.05]) {
      const lz = 0.045;
      const px = xh + lx * Math.cos(th) + lz * Math.sin(th), pz = fz - 0.035 - lx * Math.sin(th) + lz * Math.cos(th);
      b.add(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 12).rotateX(Math.PI / 2), head, px, hy + 0.024, pz);
    }
    // slim fog-light slots in the bumper corners
    b.box(w * 0.1, fy(0.04), 0.02, sx * (hwF - w * 0.06), fy(0.245), fz - 0.002, trim);
    b.box(w * 0.08, 0.016, 0.02, sx * (hwF - w * 0.06), fy(0.258), fz + 0.004, head);
  }
  b.box(gw + 0.08, 0.01, 0.012, 0, hy + hh - 0.021, fz + 0.004, head);
  b.box(w * 0.5, fy(0.055), 0.03, 0, fy(0.235), fz - 0.006, mat("#0b0c0d", { roughness: 0.7 }));
  b.box(w * 0.42, fy(0.022), 0.04, 0, fy(0.214), fz - 0.004, satin);
  plate(b, w, fy(0.237), fz + 0.012, 1);

  // ----- the rear: light bar and lamps, plate, bumper, skid plate -----
  const rz = zb;
  const hwR = hw0 - 0.12;
  b.box(2 * (hwR - 0.14), 0.03, 0.03, 0, fy(0.53), rz - 0.003, tail);
  for (const sx of [-1, 1]) {
    const tl = b.box(0.28, fy(0.052), 0.06, sx * (hwR - 0.17), fy(0.5), rz + 0.012, tail)!;
    tl.rotation.y = -sx * 0.1;
    b.box(0.08, 0.025, 0.02, sx * (hwR - 0.1), fy(0.25), rz - 0.004, mat("#7a1410", { roughness: 0.4 }));
  }
  b.box(0.45, 0.13, 0.02, 0, fy(0.36) - 0.01, rz + 0.002, trim);
  plate(b, w, fy(0.36), rz - 0.012, -1);
  b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20).rotateX(Math.PI / 2), chrome, 0, fy(0.465), rz - 0.004);
  b.box(w * 0.44, fy(0.022), 0.03, 0, fy(0.214), rz - 0.006, satin);

  // ----- the sides: door seams, handles, mirrors -----
  const xs = hw0 + 0.014;
  const archTop = (z: number) => Math.max(0, ...[zR, zF].map((zc) => (Math.abs(z - zc) < ra ? r + Math.sqrt(ra * ra - (z - zc) ** 2) : 0)));
  const amber = mat("#d98a1e", { emissive: "#7a4a0a", emissiveIntensity: 0.3 });
  for (const sx of [-1, 1]) {
    for (const z of [zW0 - 0.03, zB, zC]) {
      const y0 = Math.max(cladY + 0.01, archTop(z) + 0.02), y1 = yB - 0.02;
      b.box(0.008, y1 - y0, 0.006, sx * xs, y0, z, seamM);
    }
    for (const z of [zB + 0.25, zC + 0.26]) b.box(0.02, 0.026, 0.15, sx * (xs + 0.004), yB - 0.15, z, chrome);
    // the mirror: a black arm, a painted cap, the black glass facing back, the indicator
    const mz = zW0 - 0.17;
    b.box(w / 2 - 0.05 - hwB, 0.04, 0.06, sx * (hwB + (w / 2 - 0.05 - hwB) / 2), yB + 0.03, mz, trim);
    rbox(b, 0.19, 0.12, 0.1, sx * (w / 2 - 0.098), yB + 0.06, mz, paint, 0.035);
    b.box(0.16, 0.095, 0.01, sx * (w / 2 - 0.1), yB + 0.072, mz - 0.05, trim);
    b.box(0.1, 0.012, 0.01, sx * (w / 2 - 0.07), yB + 0.08, mz + 0.051, amber);
  }
}

/** A white EU number plate with its blue band, facing +z (dir 1) or −z (dir −1). */
function plate(b: Builder, w: number, y: number, z: number, dir: 1 | -1) {
  const pw = Math.min(0.52, w * 0.27), ph = 0.11;
  b.box(pw, ph, 0.012, 0, y, z, mat(C.ceramic, { roughness: 0.5 }));
  b.box(0.04, ph - 0.012, 0.004, -dir * (pw / 2 - 0.026), y + 0.006, z + dir * 0.006, mat("#2a4a9a"));
  for (let i = 0; i < 6; i++) b.box(0.035, 0.06, 0.003, -dir * (pw / 2 - 0.09 - i * 0.065), y + 0.025, z + dir * 0.006, mat(C.black));
}

export const BUILDERS: Record<string, Build> = {
  car_suv: (b, w, d, h, _f, color) => suv(b, w, d, h, color),
};
