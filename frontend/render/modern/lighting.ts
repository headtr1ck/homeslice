// More detailed built-in pieces: lighting. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
//
// What lights up is unchanged from ../modern: the same parts use `glowing` materials
// (bulbs, opal glass, lenses, shadeMat shades), which the card swaps for the lamp's own
// copy so they follow its light; dark (black / anthracite) shades stay unlit.
import * as THREE from "three";
import { Builder, C, back, bulb, glass, glowMat, mat, opal, random, shadeMat, v, wickerMat } from "../modern";
import type { Build } from "../modern";
import { FINISHES } from "../../model/modern";

// ----- small helpers -----

const V2 = (x: number, y: number) => new THREE.Vector2(Math.max(x, 1e-4), y);
/** A smooth profile through [r, y] points (a Catmull-Rom spline), for lathes. */
function smooth(pts: number[][], n: number): THREE.Vector2[] {
  return new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(n).map((p) => V2(p.x, p.y));
}
/** A straight profile through [r, y] points. */
const poly = (pts: number[][]) => pts.map(([x, y]) => V2(x, y));
function lathe(b: Builder, pts: THREE.Vector2[], m: THREE.Material, seg = 32, x = 0, y = 0, z = 0) {
  return b.add(new THREE.LatheGeometry(pts, seg), m, x, y, z);
}
/**
 * A turned part from [r, y] points with a flat bottom (the first two points): the bottom is
 * drawn on its own so the edge stays crisp instead of smoothing its normals round the corner.
 */
function turned(b: Builder, pts: number[][], n: number, m: THREE.Material, seg = 32, x = 0, y = 0, z = 0) {
  lathe(b, poly(pts.slice(0, 2)), m, seg, x, y, z);
  return lathe(b, smooth(pts.slice(1), n), m, seg, x, y, z);
}
/** A horizontal ring (rolled rim, wire hoop) of radius r at height y. */
function ring(b: Builder, r: number, tube: number, y: number, m: THREE.Material, x = 0, z = 0, seg = 32, radial = 6) {
  const mesh = b.add(new THREE.TorusGeometry(r, tube, radial, seg), m, x, y, z);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}
/** A part drawn around its own origin, then placed and turned as a whole. */
function sub(b: Builder, x: number, y: number, z: number, rx: number, ry: number, rz: number, draw: (s: Builder) => void) {
  const s = new Builder();
  draw(s);
  s.g.position.set(x, y, z);
  s.g.rotation.set(rx, ry, rz, "YXZ");
  b.g.add(s.g);
  return s.g;
}
const cordMat = () => mat("#2a2a2c", { roughness: 0.9 });
/** A darker shade of a finish (woven ribs, seams). */
const darker = (color: string, k = 0.7) => mat(new THREE.Color(FINISHES[color] ?? FINISHES.sand).multiplyScalar(k).getStyle(), { roughness: 1 });

/** A ceiling canopy: a shallow rounded cap at the ceiling (y = h). */
function canopy(b: Builder, h: number, m: THREE.Material, r = 0.055, x = 0, z = 0) {
  lathe(b, smooth([[0, h - 0.03], [r * 0.45, h - 0.029], [r * 0.85, h - 0.022], [r, h - 0.01], [r, h]], 5).concat(V2(0, h)), m, 24, x, 0, z);
}
/** A canopy, a textile cord down to y and a cord grip below the canopy. */
function hang(b: Builder, h: number, y: number, m: THREE.Material) {
  canopy(b, h, m);
  b.rod(v(0, y, 0), v(0, h - 0.03, 0), 0.0032, cordMat(), 6);
  b.cyl(0.006, 0.008, 0.035, 0, h - 0.065, 0, m, 10);
}
/** A lamp socket with a collar ring, top at y (hanging down from it). */
function socket(b: Builder, y: number, m: THREE.Material, r = 0.022, len = 0.06) {
  lathe(b, smooth([[0, y - len], [r * 0.9, y - len], [r, y - len * 0.8], [r, y - len * 0.25], [r * 0.6, y - 0.004], [0, y]], 6), m, 16);
  ring(b, r * 1.08, 0.0025, y - len * 0.55, m, 0, 0, 16);
}
/** A round base for floor and table lamps: a bevelled disc with a soft top edge. */
function lampBase(b: Builder, r: number, t: number, m: THREE.Material, seg = 40, x = 0, z = 0) {
  turned(b, [[0, 0], [r * 0.97, 0], [r, t * 0.3], [r * 0.97, t * 0.85], [r * 0.85, t], [0, t]], 6, m, seg, x, 0, z);
}
/** A dome or bell shade from its outline [r, y] (bottom rim first) in a double-sided material, with a rolled rim. */
function shade(b: Builder, outline: THREE.Vector2[], m: THREE.Material, rim: THREE.Material, seg = 40) {
  lathe(b, outline, m, seg);
  ring(b, outline[0].x, 0.0045, outline[0].y, rim, 0, 0, seg);
}
/** An open drum shade with wire rims, a spider holding it and a finial. */
function drum(b: Builder, rTop: number, rBottom: number, sh: number, y: number, m: THREE.Material, rim: THREE.Material, seg = 40) {
  b.cyl(rTop, rBottom, sh, 0, y, 0, m, seg, true);
  ring(b, rBottom, 0.004, y + 0.002, rim, 0, 0, seg);
  ring(b, rTop, 0.004, y + sh - 0.002, rim, 0, 0, seg);
  const sy = y + sh * 0.78;
  const rs = rBottom + (rTop - rBottom) * 0.78 - 0.004;
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + Math.PI / 6;
    b.rod(v(Math.cos(ang) * 0.02, sy, Math.sin(ang) * 0.02), v(Math.cos(ang) * rs, sy, Math.sin(ang) * rs), 0.0018, rim, 4);
  }
  ring(b, 0.02, 0.003, sy, rim, 0, 0, 12, 4);
  b.cyl(0.006, 0.01, 0.025, 0, sy, 0, rim, 10);
}
/** A cord lying from (x0, z0) on the floor or table out to (x1, z1). */
function floorCord(b: Builder, x0: number, z0: number, x1: number, z1: number) {
  const c = new THREE.CatmullRomCurve3([v(x0, 0.006, z0), v((x0 + x1) / 2 + 0.015, 0.004, (z0 + z1) / 2), v(x1, 0.003, z1)]);
  b.add(new THREE.TubeGeometry(c, 8, 0.003, 4), cordMat());
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  pendant_dome: (b, w, d, h, f, c, a) => {
    // a metal dome: rolled rim, lit liner, a socket and a textile cord up to the canopy
    const r = Math.min(w, d) / 2 - 0.005;
    const sh = r * 0.78;
    const out = smooth([[r, 0], [r * 0.98, sh * 0.25], [r * 0.9, sh * 0.55], [r * 0.7, sh * 0.85], [r * 0.4, sh * 0.99], [r * 0.12, sh], [0.024, sh]], 10);
    const m = shadeMat(f, c);
    shade(b, out, m, m, 36);
    socket(b, sh + 0.05, a, 0.024, 0.06);
    hang(b, h, sh + 0.05, a);
    bulb(b, 0, sh * 0.45, 0, Math.min(0.045, r * 0.25));
  },
  pendant_globe: (b, w, d, h, _f, _c, a) => {
    // an opal glass globe on a metal gallery
    const r = Math.min(w, d) / 2 - 0.003;
    const top = r * 1.96;
    b.sphere(r, 0, r, 0, opal(), 1, 1, 1, 36);
    lathe(b, smooth([[r * 0.3, top - 0.012], [r * 0.32, top + 0.004], [r * 0.24, top + 0.03], [0.02, top + 0.04], [0.012, top + 0.07]], 10).concat(V2(0, top + 0.07)), a, 28);
    ring(b, r * 0.31, 0.004, top - 0.008, a, 0, 0, 28);
    hang(b, h, top + 0.07, a);
  },
  pendant_linear: (b, w, d, h, f, _c, a) => {
    // a slim bar over a table: rounded body, end caps, an opal strip below, two wires and a feed cord
    const bd = Math.min(d, 0.08);
    const bh = 0.055;
    b.box(w - 0.02, bh, bd, 0, 0.004, 0, f, 0.012);
    for (const sx of [-1, 1]) b.box(0.012, bh + 0.004, bd + 0.004, sx * (w / 2 - 0.006), 0.002, 0, a, 0.004);
    b.box(w - 0.05, 0.006, bd - 0.022, 0, 0, 0, opal(), 0.002);
    const steel = mat(C.steel, { metalness: 0.6, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const x = sx * w * 0.35;
      b.cyl(0.007, 0.009, 0.02, x, bh + 0.004, 0, a, 10);
      b.rod(v(x, bh + 0.02, 0), v(x, h - 0.02, 0), 0.0015, steel, 4);
      canopy(b, h, a, 0.035, x, 0);
    }
    b.rod(v(0, bh + 0.004, 0), v(0, h - 0.02, 0), 0.0028, cordMat(), 6);
    canopy(b, h, a, 0.045);
  },
  pendant_cluster: (b, w, d, h, _f, _c, a) => {
    // a round canopy plate with five opal globes on cords of different lengths
    const rand = random(163);
    const R = Math.min(w, d) / 2;
    lathe(b, smooth([[0, h - 0.025], [R * 0.6, h - 0.024], [R * 0.68, h - 0.015], [R * 0.7, h]], 5).concat(V2(0, h)), a, 32);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + 0.3;
      const rr = R * (i % 2 ? 0.5 : 0.36);
      const r = Math.min(R * 0.36, 0.065 + rand() * 0.05);
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr;
      const y = r + rand() * Math.max(0, h * 0.45 - r);
      b.sphere(r, x, y, z, opal(), 1, 1, 1, 18);
      lathe(b, smooth([[r * 0.32, y + r * 0.92], [r * 0.34, y + r * 1.02], [0.012, y + r + 0.02], [0.008, y + r + 0.035]], 4).concat(V2(0, y + r + 0.035)), a, 14, x, 0, z);
      b.rod(v(x, y + r + 0.03, z), v(x, h - 0.025, z), 0.0025, cordMat(), 5);
      b.cyl(0.006, 0.006, 0.02, x, h - 0.045, z, a, 8);
    }
  },
  pendant_rattan: (b, w, d, h, _f, c, a) => {
    // a woven basket shade: ribs following its curve, hoops around it, lit inside
    const r = Math.min(w, d) / 2 - 0.01;
    const sh = Math.min(h * 0.5, r * 1.1);
    const prof = [[r * 0.8, 0], [r * 0.98, sh * 0.25], [r, sh * 0.45], [r * 0.92, sh * 0.7], [r * 0.62, sh * 0.92], [r * 0.12, sh]];
    const pts = smooth(prof, 12);
    lathe(b, pts, wickerMat(c), 24);
    const rib = darker(c);
    const nRibs = 10;
    const ribPts = smooth(prof, 6);
    for (let i = 0; i < nRibs; i++) {
      const ang = (i / nRibs) * Math.PI * 2;
      const path = new THREE.CatmullRomCurve3(ribPts.map((p) => v(Math.cos(ang) * (p.x + 0.006), p.y, Math.sin(ang) * (p.x + 0.006))));
      b.add(new THREE.TubeGeometry(path, 6, 0.004, 4), rib);
    }
    ring(b, r * 0.8, 0.009, 0.004, rib, 0, 0, 28); // the thick bottom rim
    const hoops = smooth(prof, 30);
    for (const t of [0.35, 0.75]) {
      const p = hoops[Math.round(t * 30)];
      ring(b, p.x + 0.008, 0.003, p.y, rib, 0, 0, 20, 8);
    }
    socket(b, sh + 0.045, a, 0.022, 0.06);
    hang(b, h, sh + 0.045, a);
    bulb(b, 0, sh * 0.4, 0, 0.05);
  },
  chandelier: (b, w, d, h, f, _c, a) => {
    // a turned column, six S-curved arms with candle cups, sleeves and flame bulbs
    const r = Math.min(w, d) / 2 - 0.04;
    const yA = h * 0.38;
    const yCup = h * 0.46;
    lathe(
      b,
      smooth([[0, h * 0.12], [0.008, h * 0.15], [0.02, h * 0.2], [0.035, h * 0.27], [0.03, h * 0.33], [0.045, yA], [0.03, yA + 0.03], [0.016, h * 0.5], [0.024, h * 0.56], [0.012, h * 0.6], [0.012, h * 0.62]], 18),
      a,
      12,
    );
    b.rod(v(0, h * 0.62, 0), v(0, h - 0.02, 0), 0.006, a, 8);
    ring(b, 0.016, 0.004, h * 0.75, a, 0, 0, 14);
    canopy(b, h, a, 0.06);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const cx = Math.cos(ang);
      const cz = Math.sin(ang);
      const P = (rr: number, y: number) => v(cx * rr, y, cz * rr);
      const arm = new THREE.CatmullRomCurve3([P(0.03, yA), P(r * 0.35, yA - 0.07), P(r * 0.75, yA - 0.07), P(r * 0.97, yCup - 0.05), P(r, yCup - 0.005)]);
      b.add(new THREE.TubeGeometry(arm, 12, 0.0075, 5), a);
      const x = cx * r;
      const z = cz * r;
      lathe(b, poly([[0, yCup - 0.012], [0.006, yCup - 0.012], [0.018, yCup - 0.002], [0.038, yCup + 0.008], [0.036, yCup + 0.013], [0, yCup + 0.013]]), a, 10, x, 0, z);
      b.cyl(0.012, 0.012, 0.075, x, yCup + 0.004, z, f, 10);
      b.sphere(0.017, x, yCup + 0.1, z, glowMat(), 0.85, 1.55, 0.85, 8);
    }
  },
  ceiling_flush: (b, w, d, h, _f, _c, a) => {
    // a metal base ring with a trim band, a softly domed opal diffuser
    const r = Math.min(w, d) / 2;
    const bt = h * 0.38;
    lathe(b, smooth([[r * 0.93, h - bt], [r, h - bt * 0.7], [r, h - bt * 0.2], [r * 0.96, h]], 6).concat(V2(0, h)), a, 40);
    ring(b, r * 0.935, 0.0035, h - bt, a, 0, 0, 40);
    const dh = h - bt;
    lathe(b, smooth([[0, 0], [r * 0.45, dh * 0.08], [r * 0.78, dh * 0.35], [r * 0.92, dh * 0.8], [r * 0.93, dh + 0.002]], 8), opal(), 40);
  },
  ceiling_spots: (b, w, d, h, f) => {
    // a track with a feed canopy and adjustable spots: adapter, yoke, can, rim and lens
    const ty = h - 0.035;
    const td = Math.min(d, 0.036);
    b.box(w, 0.032, td, 0, ty, 0, f, 0.008);
    for (const sx of [-1, 1]) b.box(0.012, 0.034, td + 0.004, sx * (w / 2 - 0.006), ty - 0.001, 0, f, 0.004);
    b.box(0.09, 0.012, Math.min(d, 0.07), 0, h - 0.012, 0, f, 0.004);
    const n = Math.max(2, Math.round(w / 0.4));
    const lens = glowMat();
    const dark = mat("#1c1c1e", { roughness: 0.6 });
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      b.box(0.03, 0.02, 0.026, x, ty - 0.02, 0, f);
      b.cyl(0.006, 0.006, 0.03, x, ty - 0.05, 0, f, 8);
      const yy = ty - 0.085;
      b.box(0.084, 0.006, 0.014, x, yy + 0.034, 0, f);
      for (const sx of [-1, 1]) b.box(0.006, 0.04, 0.014, x + sx * 0.04, yy - 0.004, 0, f);
      const tilt = 0.45 * (i % 2 ? 1 : -1);
      sub(b, x, yy, 0, tilt, 0, 0, (s) => {
        lathe(s, smooth([[0.03, -0.06], [0.038, -0.06], [0.035, -0.035], [0.034, 0.036], [0.026, 0.048], [0, 0.05]], 8), f, 20);
        lathe(s, poly([[0, -0.05], [0.026, -0.05], [0.03, -0.06]]), dark, 20);
        s.add(new THREE.CircleGeometry(0.022, 20), lens, 0, -0.052, 0).rotation.x = Math.PI / 2;
        for (const sx of [-1, 1]) s.cyl(0.008, 0.008, 0.008, sx * 0.037, -0.004, 0, f, 10).rotation.z = Math.PI / 2;
      });
    }
  },
  wall_sconce: (b, w, d, h, f) => {
    // a rounded back plate, an arm and a tube casting light up and down
    const tr = Math.min(w, 0.12) / 2;
    const zc = d / 2 - tr;
    b.box(Math.min(w * 0.6, 0.07), h * 0.42, 0.012, 0, h * 0.29, back(d) + 0.006, f, 0.005);
    b.cyl(0.006, 0.006, 0.004, 0, h * 0.35, back(d) + 0.014, mat(C.chrome, { metalness: 0.8, roughness: 0.3 }), 10).rotation.x = Math.PI / 2;
    b.box(0.026, 0.026, zc - tr - back(d), 0, h / 2 - 0.013, (back(d) + zc - tr) / 2, f, 0.006);
    lathe(b, poly([[tr - 0.006, 0], [tr - 0.002, 0], [tr, 0.003], [tr, h - 0.003], [tr - 0.002, h], [tr - 0.006, h]]), f, 32, 0, 0, zc);
    // short sleeves inside the ends, down to the lenses
    lathe(b, poly([[tr - 0.006, 0.008], [tr - 0.006, 0]]), f, 32, 0, 0, zc);
    lathe(b, poly([[tr - 0.006, h], [tr - 0.006, h - 0.008]]), f, 32, 0, 0, zc);
    for (const [y, rx] of [[0.006, Math.PI / 2], [h - 0.006, -Math.PI / 2]]) b.add(new THREE.CircleGeometry(tr - 0.0055, 32), glowMat(), 0, y, zc).rotation.x = rx;
  },
  wall_swing_arm: (b, w, d, h, f, c, a) => {
    // a wall plate with a hinge, a jointed arm, a tilted shade with wire rims
    const z0 = back(d);
    const ya = h * 0.62;
    const sr = Math.min(w, 0.2) / 2 - 0.004;
    const zs = d / 2 - sr - 0.01;
    const yS = h * 0.3;
    lathe(b, smooth([[0, 0], [0.04, 0], [0.045, 0.006], [0.045, 0.014], [0.04, 0.018], [0, 0.018]], 8), a, 28, 0, ya - 0.03, z0).rotation.x = Math.PI / 2;
    b.cyl(0.011, 0.011, 0.05, 0, ya - 0.055, z0 + 0.03, a, 12);
    b.box(0.02, 0.012, 0.03, 0, ya - 0.036, z0 + 0.02, a, 0.003);
    const hinge = v(0, ya - 0.008, z0 + 0.03);
    const elbow = v(0, ya + 0.02, z0 + (zs - z0) * 0.5);
    b.rod(hinge, elbow, 0.0065, a, 8);
    b.sphere(0.012, elbow.x, elbow.y, elbow.z, a, 1, 1, 1, 10);
    const tip = v(0, yS + 0.19, zs - 0.03);
    b.rod(elbow, tip, 0.0065, a, 8);
    b.sphere(0.01, tip.x, tip.y, tip.z, a, 1, 1, 1, 10);
    // the cord dropping from the hinge down the wall
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v(0.012, ya - 0.06, z0 + 0.03), v(0.02, ya * 0.4, z0 + 0.06), v(0.015, 0.01, z0 + 0.02)]), 12, 0.003, 4), cordMat());
    sub(b, 0, yS, zs, -0.25, 0, 0, (s) => {
      const sh = 0.17;
      s.cyl(0.055, sr, sh, 0, 0, 0, shadeMat(f, c), 36, true);
      ring(s, sr, 0.0035, 0.002, a, 0, 0, 36);
      ring(s, 0.055, 0.0035, sh - 0.002, a, 0, 0, 24);
      s.cyl(0.018, 0.018, 0.05, 0, sh - 0.06, 0, mat(C.ceramic), 12);
      s.rod(v(0, sh, 0), v(0, sh + 0.02, -0.025), 0.006, a, 8);
      bulb(s, 0, sh - 0.09, 0, 0.03);
    });
  },
  wall_globe: (b, w, d, h, _f, _c, a) => {
    // a round wall rose, an arm, a gallery holding an opal globe
    const r = Math.min(w, h) / 2 - 0.008;
    const z0 = back(d);
    const zc = d / 2 - r;
    const yc = h / 2;
    lathe(b, smooth([[0.06, 0], [0.055, 0.012], [0.04, 0.021], [0, 0.022]], 8), a, 28, 0, yc, z0).rotation.x = Math.PI / 2;
    const yArm = yc + r * 0.55;
    const end = v(0, yArm, zc - r * 0.15);
    b.rod(v(0, yc, z0 + 0.02), end, 0.009, a, 10);
    b.sphere(0.013, end.x, end.y, end.z, a, 1, 1, 1, 10);
    b.rod(end, v(0, yc + r + 0.01, zc), 0.008, a, 8);
    lathe(b, smooth([[r * 0.42, yc + r * 0.8], [r * 0.46, yc + r * 0.95], [r * 0.3, yc + r * 1.0], [0.012, yc + r * 1.02]], 8).concat(V2(0, yc + r * 1.02)), a, 28, 0, 0, zc);
    ring(b, r * 0.43, 0.003, yc + r * 0.82, a, 0, zc, 28);
    b.sphere(r * 0.98, 0, yc, zc, opal(), 1, 1, 1, 32);
  },
  wall_updown: (b, w, d, h, f) => {
    // outdoor: a rounded square tube on a bracket, lenses lighting up and down behind a lip
    const bd = d - 0.025;
    const zc = back(d) + 0.025 + bd / 2;
    b.box(w * 0.55, h * 0.5, 0.012, 0, h * 0.25, back(d) + 0.006, f, 0.004);
    b.box(w * 0.3, h * 0.3, 0.015, 0, h * 0.35, back(d) + 0.018, f, 0.003);
    b.box(w, h - 0.008, bd, 0, 0.004, zc, f, 0.01);
    const t = 0.006;
    for (const y of [0, h - 0.004]) {
      b.box(w - 0.004, 0.004, t, 0, y, zc - bd / 2 + 0.002 + t / 2, f, 0.001);
      b.box(w - 0.004, 0.004, t, 0, y, zc + bd / 2 - 0.002 - t / 2, f, 0.001);
      for (const sx of [-1, 1]) b.box(t, 0.004, bd - 0.004, sx * (w / 2 - 0.002 - t / 2), y, zc, f, 0.001);
    }
    for (const [y, rx] of [[0.003, Math.PI / 2], [h - 0.003, -Math.PI / 2]]) b.add(new THREE.PlaneGeometry(w - 0.02, bd - 0.02), glowMat(), 0, y, zc).rotation.x = rx;
    b.box(w + 0.002, 0.003, bd + 0.002, 0, h * 0.5, zc, mat("#1c1c1e"));
    b.cyl(0.004, 0.004, 0.002, 0, h * 0.28, zc + bd / 2, mat(C.steel, { metalness: 0.6 }), 10).rotation.x = Math.PI / 2;
  },
  table_lamp_mushroom: (b, w, d, h, f) => {
    // a round foot flowing into a slim stem, a mushroom dome with a thick rim, lit underneath
    const r = Math.min(w, d) / 2 - 0.004;
    const dh = r * 0.62;
    const y0 = h - dh;
    lathe(b, poly([[0, 0], [r * 0.6, 0]]), f, 32);
    // the foot and stem; its top ends inside the dome
    lathe(b, smooth([[r * 0.6, 0], [r * 0.605, 0.007], [r * 0.5, 0.022], [r * 0.2, 0.034], [0.03, 0.06], [0.024, y0 * 0.5], [0.022, y0 - 0.01]], 14).concat(V2(0.022, y0 + 0.01), V2(0, y0 + 0.01)), f, 32);
    lathe(b, smooth([[r * 0.95, y0 - 0.006], [r, y0 + 0.004], [r * 0.97, y0 + dh * 0.3], [r * 0.82, y0 + dh * 0.68], [r * 0.5, y0 + dh * 0.94], [0, y0 + dh]], 12), f, 40);
    lathe(b, smooth([[0, y0 + dh * 0.55], [r * 0.45, y0 + dh * 0.45], [r * 0.8, y0 + dh * 0.18], [r * 0.93, y0 - 0.004]], 6), glowMat(), 36);
    floorCord(b, 0, -r * 0.55, 0.02, -r + 0.01);
  },
  table_lamp_ceramic: (b, w, d, h, f, _c, a) => {
    // a turned vase base with a foot ring, a metal neck, a harp and a pleated drum shade
    const k = Math.min(w, d);
    const bh = h * 0.5;
    turned(b, [[0, 0], [k * 0.2, 0], [k * 0.22, 0.012], [k * 0.27, bh * 0.15], [k * 0.31, bh * 0.4], [k * 0.28, bh * 0.66], [k * 0.15, bh * 0.86], [k * 0.08, bh * 0.94], [k * 0.09, bh], [0, bh]], 14, f, 28);
    ring(b, k * 0.205, 0.004, 0.006, f, 0, 0, 24);
    lathe(b, smooth([[0.026, bh - 0.004], [0.03, bh + 0.006], [0.018, bh + 0.02], [0.008, bh + 0.03]], 6), a, 20);
    const sy = h * 0.66;
    const sh = h * 0.34 - 0.005;
    b.cyl(0.006, 0.006, sy + sh * 0.6 - bh - 0.03, 0, bh + 0.03, 0, a, 8);
    const pleats = new THREE.CylinderGeometry(w * 0.36, w * 0.49, sh, 72, 1, true);
    const pos = pleats.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI;
      const s = 1 + 0.035 * Math.abs(((ang * 36) / Math.PI) % 2 - 1);
      pos.setX(i, pos.getX(i) * s);
      pos.setZ(i, pos.getZ(i) * s);
    }
    pleats.computeVertexNormals();
    b.add(pleats, mat(C.shade, { side: THREE.DoubleSide, roughness: 1 }), 0, sy + sh / 2, 0);
    ring(b, w * 0.49 * 1.035, 0.004, sy + 0.002, a, 0, 0, 32);
    ring(b, w * 0.36 * 1.035, 0.004, sy + sh - 0.002, a, 0, 0, 28);
    for (const sx of [-1, 1]) b.rod(v(sx * 0.03, bh + 0.05, 0), v(sx * 0.008, sy + sh * 0.9, 0), 0.0022, a, 4);
    b.cyl(0.006, 0.01, 0.022, 0, sy + sh * 0.9, 0, a, 10);
    b.sphere(0.012, 0, sy + sh * 0.9 + 0.028, 0, a, 1, 1, 1, 10);
    b.cyl(0.016, 0.016, 0.04, 0, bh + 0.03, 0, mat(C.ceramic), 12);
    bulb(b, 0, sy + sh * 0.4, 0, 0.03);
    floorCord(b, 0, -k * 0.2, 0.02, -k / 2 + 0.01);
  },
  desk_lamp: (b, w, d, h, f, _c, a) => {
    // an architect lamp: weighted foot, turret, twin-rod arms with knuckles, a spring and
    // a bell head with a lit liner
    const x0 = -w * 0.22;
    const rb = Math.min(0.085, d * 0.36, w * 0.25);
    lampBase(b, rb, 0.028, f, 32, x0);
    b.cyl(0.018, 0.022, 0.03, x0, 0.028, 0, a, 16);
    const pivot = v(x0, 0.064, 0);
    const elbow = v(x0 + 0.03, h * 0.82, 0);
    const head = v(Math.min(w / 2 - 0.08, w * 0.28), h * 0.76, 0);
    for (const sz of [-1, 1]) {
      b.rod(pivot.clone().setZ(sz * 0.011), elbow.clone().setZ(sz * 0.011), 0.0045, a, 6);
      b.rod(elbow.clone().setZ(sz * 0.011), head.clone().setZ(sz * 0.011), 0.0045, a, 6);
    }
    for (const p of [pivot, elbow, head]) {
      for (const [r, len, m] of [[0.011, 0.036, f], [0.004, 0.042, mat(C.steel, { metalness: 0.7 })]] as const) {
        const k = b.cyl(r, r, len, p.x, 0, p.z, m, 14);
        k.rotation.x = Math.PI / 2;
        k.position.y = p.y;
      }
    }
    // the spring beside the lower arm
    const dir = elbow.clone().sub(pivot);
    const len = dir.length() * 0.45;
    dir.normalize();
    const side = v(-dir.y, dir.x, 0);
    const start = pivot.clone().addScaledVector(dir, 0.06).addScaledVector(side, 0.02);
    const coil: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const ang = t * Math.PI * 2 * 12;
      coil.push(start.clone().addScaledVector(dir, t * len).addScaledVector(side, Math.cos(ang) * 0.006).add(v(0, 0, Math.sin(ang) * 0.006)));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 64, 0.0012, 3), mat(C.steel, { metalness: 0.7, roughness: 0.35 }));
    b.rod(start.clone().addScaledVector(dir, len), start.clone().addScaledVector(dir, len).addScaledVector(side, -0.02), 0.0015, a, 4);
    // the head: hangs from the arm, its mouth tilted down to the desk
    sub(b, head.x, head.y, head.z, 0, 0, 0.55, (s) => {
      const out = smooth([[0.075, -0.13], [0.07, -0.11], [0.05, -0.07], [0.035, -0.035], [0.03, -0.01], [0.02, 0.012], [0, 0.016]], 9);
      const outer = mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide });
      shade(s, out, outer, outer, 28);
      s.cyl(0.016, 0.016, 0.03, 0, -0.035, 0, mat(C.ceramic), 12);
      bulb(s, 0, -0.07, 0, 0.024);
    });
    floorCord(b, x0, -rb * 0.8, x0 - 0.03, -d / 2 + 0.01);
  },
  floor_lamp_drum: (b, w, d, h, f, c, a) => {
    // a heavy bevelled base, a jointed stem, a drum shade with wire rims and a spider
    const R = Math.min(w, d) / 2;
    lampBase(b, R * 0.8, 0.028, a, 44);
    b.cyl(0.02, 0.026, 0.02, 0, 0.028, 0, a, 16);
    b.cyl(0.011, 0.011, h - 0.32, 0, 0.048, 0, a, 10);
    b.cyl(0.015, 0.015, 0.03, 0, h * 0.45, 0, a, 14);
    b.cyl(0.018, 0.018, 0.05, 0, h - 0.27, 0, mat(C.ceramic), 12);
    drum(b, R - 0.006, R - 0.004, 0.34, h - 0.345, shadeMat(f, c), a, 44);
    bulb(b, 0, h - 0.19, 0, 0.035);
    floorCord(b, 0, -R * 0.75, 0.05, -R + 0.01);
  },
  floor_lamp_uplight: (b, w, d, h, f, _c, a) => {
    // a domed base, a slim stem with a dimmer, a wide bowl with a rolled lip, lit inside
    const R = Math.min(w, d) / 2;
    turned(b, [[0, 0], [R * 0.72, 0], [R * 0.74, 0.01], [R * 0.6, 0.03], [R * 0.25, 0.045], [0.02, 0.05], [0, 0.05]], 8, a, 36);
    b.cyl(0.012, 0.012, h - 0.17, 0, 0.05, 0, a, 10);
    b.cyl(0.018, 0.018, 0.05, 0, h * 0.55, 0, a, 16);
    b.cyl(0.01, 0.01, 0.025, 0.022, h * 0.55 + 0.012, 0, mat(C.black), 10).rotation.z = Math.PI / 2;
    const bh = 0.13;
    const y0 = h - bh;
    lathe(b, smooth([[0.018, y0 - 0.01], [0.03, y0], [R * 0.4, y0 + bh * 0.4], [R * 0.8, y0 + bh * 0.82], [R * 0.97, y0 + bh - 0.006], [R - 0.006, y0 + bh - 0.004]], 10), f, 40);
    ring(b, R - 0.007, 0.006, h - 0.007, f, 0, 0, 40);
    lathe(b, smooth([[R * 0.95, y0 + bh - 0.008], [R * 0.78, y0 + bh * 0.84], [R * 0.4, y0 + bh * 0.44], [0, y0 + 0.02]], 6), glowMat(), 36); // the lit side up
  },
  floor_lamp_paper: (b, w, d, h, _f, _c, a) => {
    // a ribbed paper lantern with end caps, on a slim four-legged frame
    const R = Math.min(w, d) / 2 - 0.004;
    const y0 = 0.16;
    const lh = h - y0 - 0.005;
    const ribs = 14;
    const pts: THREE.Vector2[] = [V2(0.02, y0)];
    for (let i = 0; i <= ribs * 2; i++) {
      const t = i / (ribs * 2);
      const bulge = Math.sin(t * Math.PI) ** 0.35;
      const groove = i % 2 ? 0.975 : 1;
      pts.push(V2(R * (0.72 + 0.28 * bulge) * groove, y0 + 0.01 + t * (lh - 0.02)));
    }
    pts.push(V2(0.02, y0 + lh));
    b.add(new THREE.LatheGeometry(pts, 28), opal());
    for (const y of [y0 - 0.002, y0 + lh - 0.012]) b.cyl(R * 0.7, R * 0.7, 0.014, 0, y, 0, a, 32);
    const rf = R * 0.6;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const cx = Math.cos(ang);
      const cz = Math.sin(ang);
      b.rod(v(cx * rf * 1.35, 0.008, cz * rf * 1.35), v(cx * rf, y0, cz * rf), 0.007, a, 6);
      b.cyl(0.011, 0.013, 0.008, cx * rf * 1.35, 0, cz * rf * 1.35, a, 10);
    }
    floorCord(b, 0, 0, 0.04, -R + 0.01);
  },
  floor_lamp_reading: (b, w, d, h, f, _c, a) => {
    // a weighted base, a stem with a knuckle, a curved arm and an adjustable cone head
    const R = Math.min(w, d) / 2;
    const xz = back(d) + R; // the base at the back, the head reaching forward
    lampBase(b, R * 0.82, 0.03, a, 32, 0, xz);
    b.cyl(0.018, 0.022, 0.02, 0, 0.03, xz, a, 14);
    b.cyl(0.01, 0.01, h - 0.18, 0, 0.05, xz, a, 10);
    b.cyl(0.015, 0.015, 0.03, 0, h - 0.17, xz, a, 14);
    const armEnd = v(0, h - 0.05, d / 2 - 0.1);
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v(0, h - 0.14, xz), v(0, h - 0.06, xz + 0.02), v(0, h - 0.03, xz + (armEnd.z - xz) * 0.55), armEnd]), 16, 0.007, 6), a);
    b.sphere(0.012, armEnd.x, armEnd.y, armEnd.z, a, 1, 1, 1, 10);
    sub(b, armEnd.x, armEnd.y, armEnd.z, 0.45, 0, 0, (s) => {
      const out = smooth([[0.075, -0.15], [0.07, -0.12], [0.055, -0.07], [0.04, -0.03], [0.028, 0], [0, 0.005]], 9);
      const outer = mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide });
      shade(s, out, outer, outer, 32);
      s.cyl(0.015, 0.015, 0.03, 0, -0.04, 0, mat(C.ceramic), 12);
      bulb(s, 0, -0.075, 0, 0.025);
    });
    floorCord(b, 0, xz - R * 0.75, 0.05, back(d) + 0.01);
  },
  table_lamp_glass: (b, w, d, h, f, c, a) => {
    // a clear glass ginger-jar base on a metal foot, a metal neck, a drum shade with rims
    const k = Math.min(w, d);
    const bh = h * 0.52;
    b.cyl(k * 0.24, k * 0.25, 0.015, 0, 0, 0, a, 36);
    turned(b, [[0, 0.015], [k * 0.2, 0.015], [k * 0.27, bh * 0.2], [k * 0.29, bh * 0.45], [k * 0.24, bh * 0.75], [k * 0.12, bh * 0.92], [k * 0.08, bh - 0.01], [0, bh - 0.01]], 12, glass(), 28);
    b.cyl(0.005, 0.005, bh - 0.03, 0, 0.02, 0, a, 6);
    lathe(b, smooth([[k * 0.09, bh - 0.015], [k * 0.095, bh], [0.02, bh + 0.015], [0.01, bh + 0.025]], 6), a, 24);
    const sy = h * 0.64;
    const sh = h * 0.35;
    b.cyl(0.006, 0.006, sy + sh * 0.78 - bh, 0, bh, 0, a, 6);
    b.cyl(0.016, 0.016, 0.04, 0, sy + 0.04, 0, mat(C.ceramic), 12);
    drum(b, w * 0.42 - 0.004, w * 0.5 - 0.004, sh, sy, shadeMat(f, c), a, 32);
    bulb(b, 0, sy + sh * 0.45, 0, 0.03);
    floorCord(b, 0, -k * 0.22, 0.02, -k / 2 + 0.01);
  },
  pendant_bell: (b, w, d, h, f, c, a) => {
    // a flared bell: a tall neck, a long S-curve to a rolled rim, lit inside
    const r = Math.min(w, d) / 2 - 0.006;
    const sh = r * 1.2;
    const out = smooth([[r, 0], [r * 0.92, sh * 0.06], [r * 0.6, sh * 0.2], [r * 0.38, sh * 0.42], [r * 0.27, sh * 0.72], [r * 0.2, sh * 0.92], [r * 0.12, sh], [0.02, sh]], 13);
    const m = shadeMat(f, c);
    shade(b, out, m, m, 36);
    ring(b, r * 0.205, 0.004, sh * 0.92, a, 0, 0, 24);
    socket(b, sh + 0.04, a, 0.02, 0.05);
    hang(b, h, sh + 0.04, a);
    bulb(b, 0, sh * 0.25, 0, Math.min(0.045, r * 0.24));
  },
};
