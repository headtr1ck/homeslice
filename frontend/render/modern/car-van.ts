// More detailed built-in pieces: car van. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { FINISHES } from "../../model/modern";
import { C, mat, type Build, type Builder } from "../modern";

type P = [number, number];

/** A box from its bottom centre; small roundings are cut to save triangles. */
function box(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0) {
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

/** Where line p + s·u meets line q + t·v (both in z, y). */
function meet(p: P, u: P, q: P, v: P): P {
  const den = u[0] * v[1] - u[1] * v[0];
  const s = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
  return [p[0] + s * u[0], p[1] + s * u[1]];
}

/** A flat panel from an outline in (z, y), `t` thick, standing out of both sides at |x| = x0. */
function sidePanel(b: Builder, pts: P[], radii: number[], x0: number, t: number, m: THREE.Material) {
  const geo = new THREE.ExtrudeGeometry(rounded(new THREE.Shape(), pts, radii), { depth: t, bevelEnabled: false, curveSegments: 3 });
  // shape x → z, depth → -x
  geo.rotateY(-Math.PI / 2);
  b.add(geo.clone().translate(x0 + t, 0, 0), m);
  b.add(geo.translate(-x0, 0, 0), m);
}

/** A box w (x) × t (along n) × len (along the slope) centred at c; n is in the z-y plane. */
function slanted(b: Builder, w: number, t: number, len: number, c: THREE.Vector3, n: P, m: THREE.Material) {
  const mesh = b.add(new THREE.BoxGeometry(w, t, len), m, c.x, c.y, c.z);
  const ax = new THREE.Vector3(1, 0, 0);
  const ay = new THREE.Vector3(0, n[1], n[0]);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, new THREE.Vector3().crossVectors(ax, ay)));
  return mesh;
}

/** A flat plate from an outline in (x, y) (counter-clockwise), `t` deep from z0 forward. */
function front(b: Builder, pts: P[], z0: number, t: number, m: THREE.Material, r = 0) {
  const geo = new THREE.ExtrudeGeometry(rounded(new THREE.Shape(), pts, pts.map(() => r)), { depth: t, bevelEnabled: false, curveSegments: 2 });
  return b.add(geo, m, 0, 0, z0);
}

/** A round lens or badge facing +z. */
function lensGeo(r: number) {
  return new THREE.CylinderGeometry(r, r, 0.02, 16).rotateX(Math.PI / 2);
}

/**
 * A modern van / minibus (Transporter, Transit Custom): a one-box body with rounded roof
 * edges, a short sloping bonnet and a long steep windscreen, a black glass band with
 * separate side windows, sliding doors with their rail, an upright tailgate with tall
 * taillights, bumpers, mirrors on arms, flared arches, alloy wheels and number plates.
 */
function van(b: Builder, w: number, d: number, h: number, color: string) {
  const paint = mat(FINISHES[color] ?? FINISHES.silver, { roughness: 0.32, metalness: 0.3 });
  const band = mat("#111214", { roughness: 0.35, metalness: 0.2 });
  const glassM = mat("#2b3944", { roughness: 0.06, metalness: 0.6 });
  const trim = mat("#1d1f22", { roughness: 0.85 });
  const gloss = mat("#0c0d0f", { roughness: 0.2, metalness: 0.3 });
  const seam = mat("#141517", { roughness: 0.9 });
  const chrome = mat(C.chrome, { metalness: 0.85, roughness: 0.2 });
  const rimM = mat("#c4c8cd", { metalness: 0.75, roughness: 0.25 });
  const rimDark = mat("#2a2c30", { metalness: 0.4, roughness: 0.5 });
  const tyreM = mat("#1b1c1e", { roughness: 0.92 });
  const plateM = mat("#f1f1ec", { roughness: 0.5 });
  const euro = mat("#2a4c9c", { roughness: 0.5 });
  const head = mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.35, roughness: 0.2 });
  const lensM = mat("#d9d6cc", { emissive: "#fff1d0", emissiveIntensity: 0.2, roughness: 0.15, metalness: 0.2 });
  const drl = mat("#ffffff", { emissive: "#eef6ff", emissiveIntensity: 0.8, roughness: 0.2 });
  const amber = mat("#d98a1e", { emissive: "#8a4a00", emissiveIntensity: 0.3, roughness: 0.3 });
  const tail = mat("#b3261e", { emissive: "#7a120d", emissiveIntensity: 0.45, roughness: 0.3 });
  const tailDark = mat("#5a1310", { roughness: 0.25, metalness: 0.2 });
  const reverse = mat("#e9e6e0", { roughness: 0.25 });
  const liner = mat("#121315", { roughness: 0.95, side: THREE.DoubleSide });

  const Z = (t: number) => -d / 2 + t * d;
  const BW = w * 0.87;
  const hw = BW / 2;
  const railH = Math.min(0.04, h * 0.02);
  const top = h - railH;
  const zF = d / 2 - Math.min(0.06, d * 0.012); // the body's nose (the bumper stands out to d/2)
  const zR = -d / 2 + Math.min(0.07, d * 0.014);
  const y0 = h * 0.14;
  const r = Math.min(0.37, h * 0.182, d * 0.075);
  const ra = r * 1.2;
  const wheels = [Z(0.19), Z(0.805)];
  const bev = Math.min(0.09, BW * 0.05, h * 0.045);

  // ----- the body: a side profile extruded across, its edges rounded by the bevel -----
  const base: P = [Z(0.862), h * 0.575]; // the windscreen's foot
  const wsTop: P = [Z(0.752), top];
  const ul = Math.hypot(wsTop[0] - base[0], wsTop[1] - base[1]);
  const u: P = [(wsTop[0] - base[0]) / ul, (wsTop[1] - base[1]) / ul]; // up the windscreen
  const n: P = [u[1], -u[0]]; // out of it
  const noseY = h * 0.5;
  const vl = Math.hypot(zF - base[0], noseY - base[1]);
  const vb: P = [(zF - base[0]) / vl, (noseY - base[1]) / vl]; // along the bonnet
  const nb: P = [-vb[1], vb[0]];
  const ws0: P = [base[0] - n[0] * bev, base[1] - n[1] * bev];
  const bn0: P = [base[0] - nb[0] * bev, base[1] - nb[1] * bev];
  const lean = Math.min(0.07, d * 0.014); // the front leans back a little
  const fl = Math.hypot(lean, noseY - y0);
  const fdir: P = [-lean / fl, (noseY - y0) / fl];
  const faceZ = (y: number) => zF - (lean * (y - y0)) / (noseY - y0);
  const yT = top - bev;
  const yB = y0 + bev;
  const corners: P[] = [
    [zR + bev, yB],
    [zR + bev, yT],
    meet([0, yT], [1, 0], ws0, u),
    meet(ws0, u, bn0, vb),
    meet(bn0, vb, [zF - bev, yB], fdir),
    [zF - bev, yB],
  ];
  const shape = rounded(new THREE.Shape(), corners, [0, Math.min(0.16, h * 0.08), Math.min(0.26, h * 0.13), 0.06, Math.min(0.13, h * 0.07), 0]);
  const R = ra + bev;
  const phi = Math.asin(Math.max(-1, Math.min(1, (r - yB) / R)));
  for (const zc of [...wheels].sort((a, c) => c - a)) {
    shape.lineTo(zc + R * Math.cos(phi), yB);
    shape.absarc(zc, r, R, -phi, Math.PI + phi, false);
  }
  shape.lineTo(zR + bev, yB);
  const body = new THREE.ExtrudeGeometry(shape, { depth: BW - 2 * bev, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 4, curveSegments: 7 });
  body.rotateY(-Math.PI / 2);
  body.translate(hw - bev, 0, 0);
  // rounder in plan towards the nose (and a touch at the back)
  const taper = 0.05;
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const tf = Math.max(0, (z - (zF - 0.55)) / 0.55);
    const tr = Math.max(0, (zR + 0.3 - z) / 0.3);
    pos.setX(i, pos.getX(i) * (1 - taper * tf * tf - 0.015 * tr * tr));
  }
  b.add(body, paint);

  // dark liners in the arches and a slight painted flare around each
  for (const zc of wheels) {
    // only the arc inside the arch, not a whole drum below the floor
    const pl = Math.asin(Math.max(-1, Math.min(1, (r - y0) / (ra - 0.01))));
    b.add(new THREE.CylinderGeometry(ra - 0.01, ra - 0.01, BW - 0.06, 16, 1, true, -pl, Math.PI + 2 * pl).rotateZ(Math.PI / 2), liner, 0, r, zc);
    const p2 = Math.asin(Math.max(-1, Math.min(1, (r - y0 - 0.03) / ra)));
    const flare = new THREE.TorusGeometry(ra + 0.012, 0.028, 5, 22, Math.PI + 2 * p2).rotateZ(-p2).rotateY(Math.PI / 2);
    for (const sx of [-1, 1]) b.add(flare, paint, sx * (hw - 0.012), r, zc);
  }

  // ----- the windscreen: black surround, glass, wipers -----
  const wsLen = (top - h * 0.085 - base[1]) / u[1];
  const wc = (along: number, out: number, x = 0) => new THREE.Vector3(x, base[1] + u[1] * along + n[1] * out, base[0] + u[0] * along + n[0] * out);
  slanted(b, BW - 0.05, 0.012, wsLen, wc(wsLen / 2 + 0.01, 0.002), n, band);
  slanted(b, BW - 0.2, 0.012, wsLen - 0.1, wc(wsLen / 2 + 0.03, 0.006), n, glassM);
  for (const x of [-0.4, 0.04]) b.rod(wc(0.07, 0.018, x * BW), wc(0.13, 0.018, (x + 0.36) * BW), 0.008, trim, 5);

  // ----- the side: black glass band, windows with black pillars, doors, rail -----
  const belt = h * 0.555;
  const yWin = top - Math.min(0.13, h * 0.065);
  const aLine = (y: number, back: number) => base[0] + ((y - base[1]) * u[0]) / u[1] - back;
  const zBand = zR + Math.min(0.17, d * 0.034);
  sidePanel(b, [[zBand, belt], [zBand, yWin], [aLine(yWin, bev + 0.05), yWin], [aLine(belt, bev + 0.05), belt]], [0, 0.04, 0.05, 0], hw, 0.008, band);
  const zB = Z(0.6);
  const zS = Z(0.37);
  const g0 = belt + 0.035;
  const g1 = yWin - 0.03;
  const gp = Math.min(0.045, d * 0.009);
  const panes: P[][] = [
    [[zB + gp, g0], [zB + gp, g1], [aLine(g1, bev + 0.09), g1], [aLine(g0, bev + 0.09), g0]],
    [[zS + gp, g0], [zS + gp, g1], [zB - gp, g1], [zB - gp, g0]],
    [[zBand + 0.03, g0], [zBand + 0.03, g1], [zS - gp, g1], [zS - gp, g0]],
  ];
  for (const pane of panes) sidePanel(b, pane, [0.02, 0.03, 0.03, 0.02], hw + 0.008, 0.004, glassM);
  // the sliding door's rail under the rear side window
  sidePanel(b, [[zBand + 0.02, belt - 0.05], [zBand + 0.02, belt - 0.022], [zS, belt - 0.022], [zS, belt - 0.05]], [0.012, 0.012, 0, 0], hw, 0.014, gloss);
  // a shoulder line along the side
  const zShoulder = aLine(belt, bev + 0.15);
  sidePanel(b, [[zBand + 0.02, belt - 0.11], [zBand + 0.02, belt - 0.098], [zShoulder, belt - 0.098], [zShoulder, belt - 0.11]], [0, 0, 0, 0], hw, 0.006, paint);
  // door seams
  const zFD = wheels[1] + 0.06;
  const archTop = r + Math.sqrt(Math.max(0, ra * ra - (zFD - wheels[1]) ** 2)) + 0.04;
  const sw = 0.008;
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.001);
    box(b, 0.004, belt - archTop, sw, x, archTop, zFD, seam);
    for (const z of [zB + 0.012, zB - 0.012, zS]) box(b, 0.004, belt - y0 - 0.12, sw, x, y0 + 0.12, z, seam);
    box(b, 0.004, sw, zB - zS, x, y0 + 0.12, (zB + zS) / 2, seam);
    // handles: the front door's at its back edge, the sliding door's at its front edge
    for (const z of [zB + 0.16, zB - 0.17]) {
      box(b, 0.012, 0.045, 0.18, sx * (hw + 0.004), belt - 0.16, z, seam, 0.004);
      box(b, 0.02, 0.03, 0.16, sx * (hw + 0.008), belt - 0.152, z, paint, 0.008);
    }
    // black cladding along the sill between the arches
    box(b, 0.02, 0.1, wheels[1] - wheels[0] - 2 * ra - 0.06, sx * (hw - 0.002), y0 - 0.005, (wheels[0] + wheels[1]) / 2, trim, 0.008);
  }

  // ----- mirrors on arms at the A-pillars' feet -----
  const mz = aLine(belt + 0.06, 0.14);
  for (const sx of [-1, 1]) {
    const reach = w / 2 - hw;
    box(b, reach * 0.55, 0.035, 0.06, sx * (hw + reach * 0.27), belt + 0.02, mz, trim, 0.012);
    const mw = Math.min(0.11, reach * 0.8);
    box(b, mw, 0.24, 0.11, sx * (w / 2 - mw / 2), belt + 0.02, mz, paint, 0.035);
    box(b, mw - 0.02, 0.2, 0.01, sx * (w / 2 - mw / 2), belt + 0.04, mz - 0.055, glassM, 0.004);
    box(b, mw * 0.7, 0.025, 0.02, sx * (w / 2 - mw / 2 - 0.005), belt + 0.13, mz + 0.05, amber, 0.008);
  }

  // ----- the front: big lamps with L-shaped day lights, a grille band with a chrome bar
  // running through the lamps, a tall bumper with a wide lower grille holding the plate -----
  const hh = h * 0.105;
  const hy0 = noseY - hh - h * 0.012;
  const lw = Math.min(0.46, BW * 0.27);
  const lx = hw * (1 - taper) - lw / 2 + 0.01;
  const zl = faceZ(hy0 + hh / 2);
  for (const sx of [-1, 1]) {
    // the housing: its inner end cut at a slant towards the grille
    const outline: P[] = [[lw / 2, 0], [lw / 2, hh], [-lw / 2 + lw * 0.1, hh], [-lw / 2, hh * 0.55], [-lw / 2, 0]];
    front(b, outline.map(([x, y]) => [sx * (lx + x), hy0 + y] as P), zl - 0.05, 0.065, gloss);
    // two projector lenses, the day light along the bottom and up the outer end
    for (const f of [0.22, -0.08]) {
      b.add(lensGeo(hh * 0.22), lensM, sx * (lx + lw * f), hy0 + hh * 0.56, zl + 0.016);
    }
    box(b, lw * 0.92, 0.022, 0.02, sx * (lx - lw * 0.02), hy0 + hh * 0.1, zl + 0.008, drl, 0.006);
    box(b, 0.022, hh * 0.72, 0.02, sx * (lx + lw * 0.44), hy0 + hh * 0.1, zl + 0.008, drl, 0.006);
    box(b, lw * 0.2, hh * 0.16, 0.02, sx * (lx - lw * 0.3), hy0 + hh * 0.68, zl + 0.008, amber, 0.006);
  }
  const gw = 2 * (lx - lw / 2) + 0.04;
  box(b, gw, hh * 0.86, 0.06, 0, hy0 + hh * 0.07, zl - 0.03, gloss, 0.012);
  box(b, gw + lw * 0.5, 0.026, 0.025, 0, hy0 + hh * 0.5, zl + 0.004, chrome, 0.008);
  box(b, gw - 0.04, 0.012, 0.02, 0, hy0 + hh * 0.24, zl + 0.001, trim, 0.004);
  b.add(lensGeo(hh * 0.3), chrome, 0, hy0 + hh * 0.51, zl + 0.012);
  b.add(lensGeo(hh * 0.23), gloss, 0, hy0 + hh * 0.51, zl + 0.016);
  // the bumper: painted and tall, a black lip, a wide trapezoid lower grille, corner lights
  const bumpFront = d / 2 - 0.012;
  const bd = Math.min(0.32, d * 0.07);
  const bTop = hy0 - h * 0.035;
  box(b, BW + 0.02, bTop - h * 0.11, bd, 0, h * 0.11, bumpFront - bd / 2, paint, 0.07);
  box(b, BW - 0.04, h * 0.06, bd - 0.04, 0, h * 0.075, bumpFront - bd / 2 - 0.01, trim, 0.025);
  const gTop = bTop - h * 0.05;
  const gBot = h * 0.125;
  front(b, [[-BW * 0.37, gBot], [BW * 0.37, gBot], [BW * 0.3, gTop], [-BW * 0.3, gTop]], bumpFront - 0.03, 0.034, trim, 0.025);
  for (const f of [0.33, 0.66]) box(b, BW * (0.66 - f * 0.08), 0.014, 0.02, 0, gBot + (gTop - gBot) * f, bumpFront + 0.004, gloss, 0.004);
  for (const sx of [-1, 1]) {
    front(b, [[sx * BW * 0.4, gBot], [sx * BW * 0.47, gBot], [sx * BW * 0.47, gBot + h * 0.05], [sx * BW * 0.43, gBot + h * 0.08]].map((q, _i, arr) => (sx < 0 ? arr[arr.length - 1 - _i] : q)) as P[], bumpFront - 0.03, 0.03, trim, 0.012);
    box(b, BW * 0.05, h * 0.016, 0.012, sx * BW * 0.445, gBot + h * 0.02, bumpFront + 0.002, head, 0.004);
  }
  const plate = (z: number, y: number, dir: 1 | -1) => {
    box(b, 0.52, 0.115, 0.012, 0, y, z, plateM, 0.006);
    box(b, 0.045, 0.1, 0.004, -0.23 * dir, y + 0.0075, z + dir * 0.007, euro);
    box(b, 0.34, 0.05, 0.003, 0.025 * dir, y + 0.032, z + dir * 0.007, seam);
  };
  plate(bumpFront + 0.012, (gBot + gTop) / 2 - 0.06, 1);

  // ----- the back: tailgate with its window, tall taillights, plate, bumper -----
  const rwTop = top - Math.min(0.2, h * 0.1);
  const rw0 = h * 0.58;
  box(b, BW - 0.24, rwTop - rw0, 0.012, 0, rw0, zR - 0.004, band, 0.04);
  box(b, BW - 0.34, rwTop - rw0 - 0.07, 0.01, 0, rw0 + 0.035, zR - 0.01, glassM, 0.03);
  box(b, BW * 0.28, 0.025, 0.012, 0, rwTop - 0.025, zR - 0.016, tail, 0.006); // third brake light
  b.rod(new THREE.Vector3(0, rw0 + 0.07, zR - 0.02), new THREE.Vector3(-BW * 0.28, rw0 + 0.26, zR - 0.02), 0.008, trim, 5);
  for (const sx of [-1, 1]) {
    // the tailgate's seams
    box(b, 0.008, rwTop - h * 0.3 + 0.04, 0.004, sx * (hw - 0.115), h * 0.3, zR - 0.001, seam);
    // the light wraps round the corner
    const tw = 0.12;
    const ty0 = h * 0.36;
    const th = h * 0.33;
    box(b, tw, th, 0.11, sx * (hw - tw / 2 + 0.006), ty0, zR + 0.04, tailDark, 0.03);
    box(b, tw - 0.03, th * 0.55, 0.02, sx * (hw - tw / 2 + 0.004), ty0 + th * 0.4, zR - 0.016, tail, 0.01);
    box(b, tw - 0.03, th * 0.18, 0.02, sx * (hw - tw / 2 + 0.004), ty0 + th * 0.12, zR - 0.016, reverse, 0.008);
    box(b, 0.02, th * 0.55, tw * 0.5, sx * (hw + 0.006), ty0 + th * 0.4, zR + 0.05, tail, 0.008);
  }
  // the handle bar, the plate in its black recess
  box(b, BW * 0.42, 0.04, 0.02, 0, h * 0.505, zR - 0.01, chrome, 0.01);
  box(b, 0.6, 0.17, 0.006, 0, h * 0.345, zR - 0.002, trim, 0.01);
  plate(zR - 0.009, h * 0.36, -1);
  const rb = -d / 2;
  box(b, BW + 0.02, h * 0.16, bd, 0, h * 0.12, rb + bd / 2, paint, 0.07);
  box(b, BW * 0.6, 0.014, bd * 0.6, 0, h * 0.28, rb + bd * 0.3 + 0.004, trim, 0.006);
  box(b, BW - 0.04, h * 0.055, bd - 0.04, 0, h * 0.08, rb + bd / 2 + 0.01, trim, 0.025);
  for (const sx of [-1, 1]) box(b, BW * 0.1, 0.02, 0.012, sx * BW * 0.38, h * 0.2, rb + 0.006, tail, 0.004);

  // ----- roof rails -----
  for (const sx of [-1, 1]) {
    const x = sx * (hw - Math.min(0.13, BW * 0.08));
    const z0 = Z(0.07);
    const z1 = Z(0.7);
    box(b, 0.035, railH * 0.55, z1 - z0, x, h - railH * 0.55, (z0 + z1) / 2, trim, 0.01);
    for (const z of [z0 + 0.06, (z0 + z1) / 2, z1 - 0.06]) box(b, 0.05, railH + 0.01, 0.1, x, top - 0.01, z, trim, 0.01);
  }

  // ----- wheels: rounded tyres, alloy rims with five double spokes -----
  const tw = Math.min(0.23, w * 0.11);
  const tyre = new THREE.LatheGeometry(
    ([[r * 0.66, -tw / 2], [r * 0.9, -tw / 2], [r * 0.98, -tw / 2 + 0.03], [r, -tw / 2 + 0.07], [r, tw / 2 - 0.07], [r * 0.98, tw / 2 - 0.03], [r * 0.9, tw / 2], [r * 0.66, tw / 2]] as P[]).map(
      ([a, c]) => new THREE.Vector2(a, c),
    ),
    30,
  ).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(r * 0.66, r * 0.66, tw - 0.02, 20).rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(r * 0.64, 0.014, 4, 28).rotateY(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.02, r * 0.46, r * 0.075);
  const cap = new THREE.CylinderGeometry(r * 0.17, r * 0.19, 0.03, 16).rotateZ(Math.PI / 2);
  const badge = new THREE.CylinderGeometry(r * 0.08, r * 0.08, 0.034, 12).rotateZ(Math.PI / 2);
  for (const zc of wheels)
    for (const sx of [-1, 1]) {
      const x = sx * (hw - tw / 2 - 0.012);
      const face = x + sx * (tw / 2);
      b.add(tyre, tyreM, x, r, zc);
      b.add(hub, rimDark, x, r, zc);
      b.add(lip, rimM, face - sx * 0.01, r, zc);
      for (let k = 0; k < 10; k++) {
        const a = (Math.floor(k / 2) / 5) * Math.PI * 2 + (k % 2 ? 0.17 : -0.17);
        b.add(spoke, rimM, face - sx * 0.018, r + Math.cos(a) * r * 0.36, zc + Math.sin(a) * r * 0.36).rotation.x = a;
      }
      b.add(cap, rimM, face - sx * 0.02, r, zc);
      b.add(badge, rimDark, face - sx * 0.02, r, zc);
    }
}

export const BUILDERS: Record<string, Build> = {
  car_van: (b, w, d, h, _f, color) => van(b, w, d, h, color),
};
