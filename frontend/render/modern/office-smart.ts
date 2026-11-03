// More detailed built-in pieces: office smart. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { C, back, ledMat, mat, matrix, part, random, screenMat, v } from "../modern";
import type { Build, Builder } from "../modern";

// ----- helpers -----

/** A box from its bottom centre with rounded edges of few segments (small devices). */
function rb(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r: number, seg = 1) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const geo = rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  return b.add(geo, m, x, y + h / 2, z);
}

/** A plain box from its bottom centre, merged with the others of its material. */
function bx(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  b.batch(new THREE.BoxGeometry(w, h, d), m, matrix(x, y + h / 2, z, rx, ry, rz));
}

/** Turns a mesh about a horizontal x axis through (py, pz): a backrest leaning back, a camera looking down. */
function tiltX<T extends THREE.Object3D | null>(o: T, py: number, pz: number, a: number): T {
  if (!o) return o;
  const p = new THREE.Vector3(0, py, pz);
  o.position.sub(p).applyAxisAngle(new THREE.Vector3(1, 0, 0), a).add(p);
  o.rotation.x += a;
  return o;
}

/** Draws parts and lays them back (or forward) by `a` about (py, pz). */
function tilted(a: number, py: number, pz: number, draw: () => (THREE.Object3D | null)[]) {
  for (const o of draw()) tiltX(o, py, pz, a);
}

/** A cylinder lying along z (its +y end towards +z), centred at (x, y, z). */
function zcyl(b: Builder, rFront: number, rBack: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 20, open = false) {
  return b.add(new THREE.CylinderGeometry(rFront, rBack, len, seg, 1, open).rotateX(Math.PI / 2), m, x, y, z);
}

/** A thin closed disc on a face looking at +z, its back at z (a flat circle would show its back edge-on). */
function disc(b: Builder, r: number, x: number, y: number, z: number, m: THREE.Material, seg = 16, t = 0.001) {
  return zcyl(b, r, r, t, x, y, z + t / 2, m, seg);
}

/** A thin flat ring (or an arc of one from `start` over `len`) on a face looking at +z, its back at z;
 * `up` lays it on a face looking up instead, its bottom at y. */
function ring(b: Builder, r0: number, r1: number, x: number, y: number, z: number, m: THREE.Material, seg = 24, t = 0.001, up = false, start = 0, len = Math.PI * 2) {
  const s = new THREE.Shape();
  if (len >= Math.PI * 2 - 1e-6) {
    s.absarc(0, 0, r1, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r0, 0, Math.PI * 2, true);
    s.holes.push(hole);
  } else {
    s.absarc(0, 0, r1, start, start + len, false);
    s.absarc(0, 0, r0, start + len, start, true);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: Math.max(3, Math.round(seg / 2)) }); // arcs take twice the curve segments
  if (up) geo.rotateX(-Math.PI / 2);
  return b.add(geo, m, x, y, z);
}

/** Seven-segment digits on a face looking at +z, `x` the left edge, `y` the bottom. */
const SEGMENTS: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g" };
function digits(b: Builder, text: string, x: number, y: number, z: number, ch: number, m: THREE.Material) {
  const cw = ch * 0.52;
  const t = ch * 0.14;
  let cx = x;
  for (const c of text) {
    if (c === ".") {
      bx(b, t, t, 0.0008, cx + t / 2, y, z, m);
      cx += t * 2;
      continue;
    }
    const s = SEGMENTS[c] ?? "";
    const hz = (yy: number) => bx(b, cw - t, t, 0.0008, cx + cw / 2, yy, z, m);
    const vt = (xx: number, yy: number) => bx(b, t, ch / 2 - t * 0.5, 0.0008, xx, yy, z, m);
    if (s.includes("a")) hz(y + ch - t);
    if (s.includes("g")) hz(y + ch / 2 - t / 2);
    if (s.includes("d")) hz(y);
    if (s.includes("f")) vt(cx + t / 2, y + ch / 2);
    if (s.includes("b")) vt(cx + cw - t / 2, y + ch / 2);
    if (s.includes("e")) vt(cx + t / 2, y + t * 0.25);
    if (s.includes("c")) vt(cx + cw - t / 2, y + t * 0.25);
    cx += cw + t * 1.2;
  }
}

/** A five-star base of radius R with twin-wheel castors, the hub at hubY. */
function starBase(b: Builder, R: number, hubY: number, arm: THREE.Material, wheel: THREE.Material, armR = 0.02) {
  const tipY = 0.07;
  b.cyl(0.045, 0.05, 0.05, 0, hubY - 0.035, 0, arm, 16);
  const tip = R - 0.03;
  const chrome = mat(C.chrome, { metalness: 0.7, roughness: 0.3 });
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const cx = Math.cos(ang);
    const cz = Math.sin(ang);
    // a tapered, flattened arm from the hub down to the castor
    const len = Math.hypot(tip - 0.03, hubY - 0.02 - tipY);
    const geo = new THREE.CylinderGeometry(armR * 1.3, armR * 0.85, len, 6).rotateZ(Math.PI / 2);
    geo.scale(1, 0.75, 1);
    const mid = (tip + 0.03) / 2;
    const mesh = b.add(geo, arm, cx * mid, (hubY - 0.02 + tipY) / 2, cz * mid);
    mesh.rotation.set(0, -ang, -Math.atan2(hubY - 0.02 - tipY, tip - 0.03));
    // the castor: a stem, a hood and two wheels rolling outwards
    const wx = cx * (tip + 0.012);
    const wz = cz * (tip + 0.012);
    b.cyl(0.007, 0.007, 0.03, cx * tip, tipY - 0.025, cz * tip, chrome, 6);
    const hood = b.add(new THREE.BoxGeometry(0.03, 0.026, 0.046), wheel, wx, 0.04, wz);
    hood.rotation.y = -ang + Math.PI / 2;
    for (const s of [-1, 1]) {
      const w = b.add(new THREE.CylinderGeometry(0.023, 0.023, 0.012, 12).rotateZ(Math.PI / 2), wheel, wx - cz * s * 0.012, 0.023, wz + cx * s * 0.012);
      w.rotation.y = -ang;
    }
  }
}

/** A keyboard and a mouse on a desk top at y, centred at (x, z). */
function keyboard(b: Builder, x: number, y: number, z: number, light: boolean) {
  const body = mat(light ? "#dcdddf" : "#2b2c2e", { roughness: 0.6 });
  const keys = mat(light ? "#f4f4f2" : "#1b1c1e", { roughness: 0.7 });
  rb(b, 0.42, 0.014, 0.13, x, y, z, body, 0.005);
  for (let r = 0; r < 4; r++) bx(b, 0.39, 0.005, 0.022, x, y + 0.012, z - 0.045 + r * 0.03, keys);
  b.sphere(0.03, x + 0.3, y + 0.004, z + 0.01, body, 0.65, 0.4, 1, 10);
}

/** A slim monitor standing on a desk top at y, centred at (x, z), turned by ry about y. */
function deskMonitor(b: Builder, x: number, y: number, z: number, mw: number, ry = 0) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const at = (w: number, h: number, d: number, lx: number, ly: number, lz: number, m: THREE.Material) => bx(b, w, h, d, x + lx * c + lz * s, y + ly, z - lx * s + lz * c, m, 0, ry);
  const body = mat("#1d1e20", { roughness: 0.5 });
  const mh = mw * 0.58;
  const py = 0.09;
  at(mw, mh, 0.016, 0, py, 0, body);
  at(mw - 0.012, mh - 0.03, 0.001, 0, py + 0.022, 0.0085, mat(C.screen, { roughness: 0.3 }));
  at(mw * 0.4, mh * 0.45, 0.025, 0, py + mh * 0.25, -0.02, body);
  at(0.045, py + mh * 0.3, 0.02, 0, 0.008, -0.045, body);
  at(Math.min(0.24, mw * 0.4), 0.008, 0.17, 0, 0, -0.03, body);
}

const lightKeys = (color: string) => ["black", "walnut", "anthracite"].includes(color);

/** A desk top with a slim rounded edge, its top at y. */
function deskTop(b: Builder, w: number, d: number, y: number, m: THREE.Material, t = 0.025) {
  rb(b, w, t, d, 0, y - t, 0, m, 0.006, 2);
}

/** A sled leg: a closed rectangular frame of square tube across the depth at x. */
function sledLeg(b: Builder, x: number, z: number, d: number, h: number, m: THREE.Material, t = 0.04) {
  bx(b, t, h, t, x, 0, z - d / 2 + t / 2, m);
  bx(b, t, h, t, x, 0, z + d / 2 - t / 2, m);
  bx(b, t, t * 0.8, d, x, 0, z, m);
  bx(b, t, t, d, x, h - t, z, m);
  for (const s of [-1, 1]) b.cyl(t * 0.35, t * 0.35, 0.006, x, -0.002, z + s * (d / 2 - t * 1.5), mat(C.black), 8);
}

/** Drawer fronts stacked from the top: `shares` of the height, with the handle chosen for
 * the piece (options.handle: bar by default, knob, handleless grip rail, push). */
function drawerStack(b: Builder, x: number, w: number, y0: number, h: number, z: number, shares: number[], f: THREE.Material, handle: THREE.Material) {
  const total = shares.reduce((s, a) => s + a, 0);
  const joint = mat("#26272a", { roughness: 1 });
  const chosen = b.options.handle;
  const kind = chosen === "knob" || chosen === "handleless" || chosen === "push" ? chosen : "bar";
  let top = y0 + h;
  for (const s of shares) {
    const dh = (h * s) / total;
    const rail = kind === "handleless" ? Math.min(0.03, dh * 0.2) : 0;
    bx(b, w - 0.004, dh - 0.005 - rail, 0.018, x, top - dh + 0.0025, z + 0.009, f);
    bx(b, w, 0.004, 0.017, x, top - dh, z + 0.0085, joint);
    // handleless: a dark recessed grip above the front, the accent as its lip
    if (rail) {
      bx(b, w, rail, 0.008, x, top - rail - 0.0025, z + 0.004, joint);
      bx(b, w - 0.004, 0.003, 0.012, x, top - 0.0055, z + 0.006, handle);
    }
    const hy = top - Math.min(0.05, dh * 0.3);
    if (kind === "bar") {
      bx(b, Math.min(0.16, w * 0.45), 0.011, 0.012, x, hy, z + 0.024, handle);
      for (const sx of [-1, 1]) bx(b, 0.008, 0.008, 0.008, x + sx * Math.min(0.07, w * 0.2), hy + 0.0015, z + 0.019, handle);
    } else if (kind === "knob") b.sphere(0.014, x, hy, z + 0.03, handle, 1, 1, 1, 10);
    top -= dh;
  }
}

export const BUILDERS: Record<string, Build> = {
  // ----- desks -----
  desk: (b, w, d, h, f, color, a) => {
    deskTop(b, w, d, h, f);
    // a slim metal frame: four square legs and an apron under the top
    const t = 0.04;
    const ix = w / 2 - 0.05;
    const iz = d / 2 - 0.05;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        bx(b, t, h - 0.025, t, sx * ix, 0, sz * iz, a);
        b.cyl(0.012, 0.012, 0.006, sx * ix, -0.002, sz * iz, mat(C.black), 8);
      }
    for (const sz of [-1, 1]) bx(b, 2 * ix, 0.06, 0.02, 0, h - 0.085, sz * iz, a);
    for (const sx of [-1, 1]) bx(b, 0.02, 0.06, 2 * iz, sx * ix, h - 0.085, 0, a);
    deskMonitor(b, -0.05, h, back(d) + 0.14, Math.min(0.6, w * 0.45));
    keyboard(b, -0.05, h, d * 0.12, lightKeys(color));
  },
  desk_drawers: (b, w, d, h, f, color, a) => {
    deskTop(b, w, d, h, f);
    // a drawer pedestal on the right, a sled leg on the left, a modesty panel between
    const pw = Math.min(0.42, w * 0.32);
    const px = w / 2 - pw / 2 - 0.01;
    const pd = d - 0.06;
    b.box(pw, h - 0.025, pd, px, 0, -0.03, f, 0.004);
    const fz = -0.03 + pd / 2;
    bx(b, pw - 0.02, 0.04, 0.01, px, 0, fz + 0.002, mat("#26272a", { roughness: 1 }));
    drawerStack(b, px, pw - 0.02, 0.045, h - 0.09, fz, [1, 1, 2], f, a);
    sledLeg(b, -w / 2 + 0.06, 0, d - 0.06, h - 0.025, a);
    bx(b, w - pw - 0.12, h * 0.38, 0.018, -pw / 2 - 0.02, h * 0.55, -d / 2 + 0.06, f);
    deskMonitor(b, -w * 0.12, h, back(d) + 0.14, Math.min(0.6, w * 0.45));
    keyboard(b, -w * 0.12, h, d * 0.12, lightKeys(color));
  },
  desk_standing: (b, w, d, h, f, color, a) => {
    deskTop(b, w, d, h, f);
    const col = Math.max(0.3, h - 0.08);
    const lx = w / 2 - Math.min(0.16, w * 0.12);
    for (const sx of [-1, 1]) {
      const x = sx * lx;
      // a foot with rounded ends and pads, a two-stage column, a bracket under the top
      rb(b, 0.075, 0.045, d - 0.06, x, 0.008, 0, a, 0.015);
      for (const sz of [-1, 1]) b.cyl(0.016, 0.016, 0.008, x, 0, sz * (d / 2 - 0.08), mat(C.black), 10);
      rb(b, 0.09, col * 0.5, 0.065, x, 0.05, -0.02, a, 0.006);
      rb(b, 0.075, h - 0.075 - (0.05 + col * 0.5) + 0.02, 0.052, x, 0.05 + col * 0.5 - 0.02, -0.02, a, 0.006);
      bx(b, 0.05, 0.03, d - 0.12, x, h - 0.055, 0, a);
    }
    // the crossbar with its motor housing
    bx(b, 2 * lx, 0.05, 0.05, 0, h - 0.08, -0.02, a);
    rb(b, 0.2, 0.06, 0.08, 0, h - 0.085, -0.02, a, 0.01);
    // a wire cable tray under the back edge, a power strip and cables in it
    const tw = Math.min(w * 0.62, 2 * lx - 0.16);
    const tz = -d / 2 + 0.1;
    const ty = h - 0.13;
    const wire = mat(color === "black" ? C.steel : "#3a3b3e", { metalness: 0.5, roughness: 0.4 });
    for (const [dz, dy] of [[-0.06, 0.06], [0.06, 0.06], [-0.06, 0.0], [0.06, 0.0], [-0.02, 0], [0.02, 0]] as const) bx(b, tw, 0.004, 0.004, 0, ty + dy, tz + dz, wire);
    const n = Math.max(4, Math.round(tw / 0.08));
    for (let i = 0; i <= n; i++) {
      const x = -tw / 2 + (tw * i) / n;
      bx(b, 0.004, 0.004, 0.124, x, ty, tz, wire);
      for (const s of [-1, 1]) bx(b, 0.004, 0.064, 0.004, x, ty, tz + s * 0.06, wire);
    }
    for (const s of [-1, 1]) bx(b, 0.02, h - 0.025 - ty - 0.06, 0.02, s * tw * 0.4, ty + 0.06, tz - 0.06, wire);
    rb(b, Math.min(0.32, tw * 0.6), 0.035, 0.05, -tw * 0.15, ty + 0.004, tz, mat("#e9e9e6"), 0.008);
    const cable = mat("#1d1e20");
    for (const [x0, x1] of [[-tw * 0.3, -lx], [-tw * 0.05, -lx + 0.02]] as const) {
      const curve = new THREE.CubicBezierCurve3(v(x0, ty + 0.02, tz), v(x0, ty - 0.25, tz), v(x1 + 0.04, h * 0.45, -0.06), v(x1 + 0.05, 0.06, -0.06));
      b.add(new THREE.TubeGeometry(curve, 12, 0.004, 5), cable);
    }
    // the handset under the front right edge, its display lit
    rb(b, 0.11, 0.025, 0.05, w / 2 - 0.2, h - 0.05, d / 2 - 0.035, mat(C.black), 0.006);
    bx(b, 0.03, 0.01, 0.002, w / 2 - 0.2, h - 0.043, d / 2 - 0.009, mat("#9fe0ff", { emissive: "#6fc8ff", emissiveIntensity: 0.6 }));
    deskMonitor(b, -0.05, h, back(d) + 0.16, Math.min(0.7, w * 0.45));
    keyboard(b, -0.05, h, d * 0.15, lightKeys(color));
  },
  desk_corner: (b, w, d, h, f, color, a) => {
    // an L: the long arm along the back, the short arm down the left, a rounded inner corner
    const arm = Math.min(0.7, d * 0.5, w * 0.45);
    const t = 0.025;
    const s = new THREE.Shape();
    const r = 0.1;
    const x0 = -w / 2;
    const z0 = -d / 2;
    s.moveTo(x0, z0);
    s.lineTo(x0, d / 2);
    s.lineTo(x0 + arm, d / 2);
    s.lineTo(x0 + arm, z0 + arm + r);
    s.quadraticCurveTo(x0 + arm, z0 + arm, x0 + arm + r, z0 + arm);
    s.lineTo(w / 2, z0 + arm);
    s.lineTo(w / 2, z0);
    s.lineTo(x0, z0);
    const top = new THREE.ExtrudeGeometry(s, { depth: t - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 6 });
    top.rotateX(Math.PI / 2);
    b.add(top, f, 0, h - 0.003, 0);
    // square legs at the ends and the corners, aprons under the edges
    const lt = 0.04;
    const e = 0.04;
    const pts: [number, number][] = [
      [w / 2 - e, z0 + e],
      [w / 2 - e, z0 + arm - e],
      [x0 + e, z0 + e],
      [x0 + e, d / 2 - e],
      [x0 + arm - e, d / 2 - e],
    ];
    for (const [x, z] of pts) {
      bx(b, lt, h - t, lt, x, 0, z, a);
      b.cyl(0.012, 0.012, 0.006, x, -0.002, z, mat(C.black), 8);
    }
    const ay = h - t - 0.06;
    bx(b, w - 2 * e, 0.06, 0.02, 0, ay, z0 + e, a);
    bx(b, w - arm, 0.06, 0.02, x0 + arm + (w - arm) / 2 - e, ay, z0 + arm - e, a);
    bx(b, 0.02, 0.06, d - 2 * e, x0 + e, ay, 0, a);
    bx(b, 0.02, 0.06, d - arm, x0 + arm - e, ay, z0 + arm + (d - arm) / 2 - e, a);
    bx(b, 0.02, 0.06, arm - 2 * e, w / 2 - e, ay, z0 + arm / 2, a);
    bx(b, arm - 2 * e, 0.06, 0.02, x0 + arm / 2, ay, d / 2 - e, a);
    const kx = x0 + arm + Math.min(0.45, (w - arm) * 0.4);
    deskMonitor(b, kx, h, z0 + 0.14, Math.min(0.55, (w - arm) * 0.55));
    keyboard(b, kx, h, z0 + arm * 0.62, lightKeys(color));
  },
  drawer_unit: (b, w, d, h, f, _c, a) => {
    // a pedestal on castors: a pencil drawer, a drawer and a deep file drawer
    const base = 0.055;
    b.box(w, h - base, d - 0.02, 0, base, -0.01, f, 0.006);
    drawerStack(b, 0, w - 0.02, base + 0.012, h - base - 0.03, d / 2 - 0.02, [0.6, 1, 1.6], f, a);
    bx(b, w - 0.04, 0.012, d - 0.06, 0, base - 0.012, -0.01, mat(C.black));
    const wheel = mat(C.black, { roughness: 0.5 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.05);
        const z = sz * (d / 2 - 0.07);
        bx(b, 0.03, 0.015, 0.035, x, 0.03, z, wheel);
        for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.019, 0.019, 0.009, 10).rotateZ(Math.PI / 2), wheel, x + s * 0.009, 0.019, z + 0.006);
      }
  },
  filing_cabinet: (b, w, d, h, f) => {
    // a steel cabinet on a recessed plinth: four drawers with recessed pulls, label holders, a lock
    const plinth = 0.05;
    const cd = d - 0.02;
    const cz = -0.01;
    const fz = cz + cd / 2;
    b.box(w, h - plinth, cd, 0, plinth, cz, f, 0.006);
    bx(b, w - 0.03, plinth, cd - 0.04, 0, 0, cz - 0.01, mat("#26272a", { roughness: 1 }));
    const n = 4;
    const y0 = plinth + 0.012;
    const dh = (h - plinth - 0.03) / n;
    const chrome = mat(C.chrome, { metalness: 0.75, roughness: 0.3 });
    const slot = mat("#1c1d20", { roughness: 1 });
    const card = mat("#f4f1ea");
    for (let i = 0; i < n; i++) {
      const y = y0 + i * dh;
      bx(b, w - 0.016, dh - 0.008, 0.012, 0, y + 0.004, fz + 0.006, f);
      // the pull: a dark recess with a chrome lip
      bx(b, w * 0.5, 0.022, 0.004, 0, y + dh * 0.6, fz + 0.0125, slot);
      bx(b, w * 0.5, 0.006, 0.014, 0, y + dh * 0.6 + 0.02, fz + 0.014, chrome);
      // a label holder with its card
      bx(b, w * 0.2, 0.04, 0.003, 0, y + dh * 0.78, fz + 0.013, chrome);
      bx(b, w * 0.17, 0.032, 0.003, 0, y + dh * 0.78 + 0.004, fz + 0.014, card);
    }
    b.add(new THREE.CylinderGeometry(0.01, 0.01, 0.01, 12).rotateX(Math.PI / 2), chrome, w / 2 - 0.05, h - 0.035, fz + 0.017);
    bx(b, 0.002, 0.009, 0.002, w / 2 - 0.05, h - 0.0395, fz + 0.022, slot);
  },
  whiteboard: (b, w, d, h, _f, _c, a) => {
    // an aluminium frame with corner caps, the white board, a pen tray with markers and an eraser
    const fz = back(d) + d * 0.5;
    const t = 0.022;
    b.box(w - 0.01, h - 0.01, d * 0.35, 0, 0.005, back(d) + d * 0.175, mat("#d9d9d4"));
    bx(b, w - 2 * t, h - 2 * t, 0.004, 0, t, fz - 0.002, mat("#fbfbf8", { roughness: 0.2 }));
    for (const sy of [0, 1]) bx(b, w - 0.02, t, d * 0.55, 0, sy * (h - t), back(d) + d * 0.275, a);
    for (const sx of [-1, 1]) bx(b, t, h - 0.02, d * 0.55, sx * (w / 2 - t / 2), 0.01, back(d) + d * 0.275, a);
    const cap = mat("#3a3b3e", { roughness: 0.6 });
    for (const sx of [-1, 1]) for (const sy of [0, 1]) b.box(0.035, 0.035, d * 0.6, sx * (w / 2 - 0.0175), sy * (h - 0.035), back(d) + d * 0.3, cap, 0.008);
    // the tray: a lip in front of the bottom rail
    const tw = Math.min(w * 0.6, 0.75);
    const tx = -w * 0.1;
    bx(b, tw, 0.006, 0.05, tx, 0, fz + 0.025, a);
    bx(b, tw, 0.022, 0.006, tx, 0, fz + 0.05, a);
    // markers lying along the tray, each with its coloured cap, and the eraser at the right end
    const barrel = mat("#f2f2ee");
    const pens = Math.max(1, Math.min(4, Math.floor((tw - 0.15) / 0.125)));
    ["#2b2c2e", "#c0392b", "#2e6fb5", "#2f8a4c"].slice(0, pens).forEach((c, i) => {
      const x = tx - tw / 2 + 0.065 + i * 0.125;
      b.add(new THREE.CylinderGeometry(0.0085, 0.0085, 0.09, 8).rotateZ(Math.PI / 2), barrel, x - 0.01, 0.0145, fz + 0.025);
      b.add(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 8).rotateZ(Math.PI / 2), mat(c), x + 0.045, 0.0145, fz + 0.025);
    });
    bx(b, 0.12, 0.025, 0.04, tx + tw / 2 - 0.075, 0.006, fz + 0.025, mat("#2b2c2e"));
    bx(b, 0.12, 0.012, 0.04, tx + tw / 2 - 0.075, 0.031, fz + 0.025, mat("#b5683f"));
    // things drawn on it: a few lines of writing, a bar chart, a sticky note
    const ink = mat("#3a5f9f", { roughness: 1 });
    const red = mat("#c0392b", { roughness: 1 });
    const bw = w - 2 * t;
    const bh = h - 2 * t;
    bx(b, bw * 0.3, 0.008, 0.002, -bw * 0.22, t + bh * 0.85, fz + 0.001, red);
    for (let i = 0; i < 5; i++) bx(b, bw * (0.22 + ((i * 37) % 5) * 0.035), 0.005, 0.002, -bw * 0.26 + ((i * 13) % 3) * 0.01, t + bh * (0.74 - i * 0.09), fz + 0.001, ink);
    const cx = bw * 0.18;
    const cy = t + bh * 0.25;
    bx(b, 0.006, bh * 0.4, 0.002, cx - bw * 0.12, cy, fz + 0.001, ink);
    bx(b, bw * 0.28, 0.006, 0.002, cx + bw * 0.02, cy, fz + 0.001, ink);
    [0.4, 0.65, 0.5, 0.85].forEach((k, i) => bx(b, bw * 0.035, bh * 0.35 * k, 0.002, cx - bw * 0.07 + i * bw * 0.06, cy + 0.006, fz + 0.001, i === 3 ? red : ink));
    const note = Math.min(0.08, bw * 0.12);
    b.box(note, note, 0.002, bw * 0.38, t + bh * 0.7, fz + 0.001, mat("#f2d34f", { roughness: 1 }))?.rotation.set(0, 0, 0.06);
  },

  // ----- chairs -----
  chair_office: (b, w, d, h, f, _c, a) => {
    const plastic = mat(C.black, { roughness: 0.55 });
    const chrome = mat(C.chrome, { metalness: 0.75, roughness: 0.25 });
    const seatY = Math.min(0.47, h * 0.45);
    starBase(b, Math.min(w, d) / 2, 0.11, a, plastic, 0.02);
    // the gas lift: a plastic shroud and the chrome piston
    b.cyl(0.024, 0.03, seatY - 0.24, 0, 0.11, 0, plastic, 14);
    b.cyl(0.014, 0.014, 0.12, 0, seatY - 0.15, 0, chrome, 12);
    // the mechanism, its lever, the seat cushion on a shell
    rb(b, 0.2, 0.05, 0.22, 0, seatY - 0.09, 0, plastic, 0.01);
    b.rod(v(0.09, seatY - 0.07, 0.04), v(0.17, seatY - 0.08, 0.1), 0.006, plastic, 6);
    const sw = Math.min(0.5, w * 0.84);
    const sd = Math.min(0.48, d * 0.8);
    rb(b, sw - 0.02, 0.025, sd - 0.03, 0, seatY - 0.045, 0.03, plastic, 0.01);
    rb(b, sw, 0.075, sd, 0, seatY - 0.03, 0.03, f, 0.032, 2);
    // the backrest on a curved spine
    const bz = -d / 2 + 0.07;
    const by = seatY + 0.09;
    const bh = Math.max(0.3, h - by - 0.02);
    const spine = new THREE.CubicBezierCurve3(v(0, seatY - 0.07, -0.08), v(0, seatY - 0.07, bz - 0.04), v(0, seatY, bz - 0.06), v(0, by + bh * 0.3, bz - 0.04));
    b.add(new THREE.TubeGeometry(spine, 10, 0.022, 6), a);
    tilted(-0.13, by, bz, () => [
      rb(b, sw * 0.92, bh, 0.07, 0, by, bz, f, 0.03, 2),
      rb(b, sw * 0.86, bh * 0.92, 0.02, 0, by + bh * 0.04, bz - 0.04, plastic, 0.008),
      rb(b, sw * 0.7, bh * 0.2, 0.03, 0, by + bh * 0.12, bz + 0.03, f, 0.014),
    ]);
    // armrests: an arm under the seat, a post, a pad
    for (const sx of [-1, 1]) {
      const x = sx * Math.min(w / 2 - 0.04, sw / 2 + 0.03);
      bx(b, Math.abs(x) - 0.08, 0.02, 0.05, sx * (Math.abs(x) / 2 + 0.04), seatY - 0.08, -0.03, plastic);
      rb(b, 0.03, 0.27, 0.05, x, seatY - 0.08, -0.03, plastic, 0.008);
      rb(b, 0.065, 0.025, 0.24, x, seatY + 0.18, 0.0, plastic, 0.012);
    }
  },
  gaming_chair: (b, w, d, h, f, _c, a) => {
    const plastic = mat(C.black, { roughness: 0.55 });
    const chrome = mat(C.chrome, { metalness: 0.75, roughness: 0.25 });
    const seatY = Math.min(0.5, h * 0.37);
    starBase(b, Math.min(w, d) / 2, 0.12, mat("#1d1e20", { metalness: 0.5, roughness: 0.4 }), plastic, 0.024);
    b.cyl(0.026, 0.034, seatY - 0.27, 0, 0.12, 0, plastic, 14);
    b.cyl(0.016, 0.016, 0.12, 0, seatY - 0.17, 0, chrome, 12);
    rb(b, 0.24, 0.05, 0.26, 0, seatY - 0.11, 0, plastic, 0.01);
    // the bucket seat: a cushion between raised side bolsters
    const sw = Math.min(0.56, w * 0.8);
    const sd = Math.min(0.52, d * 0.76);
    const sz = 0.03;
    rb(b, sw - 0.04, 0.04, sd, 0, seatY - 0.07, sz, plastic, 0.012);
    rb(b, sw * 0.62, 0.085, sd - 0.04, 0, seatY - 0.04, sz + 0.01, f, 0.035, 2);
    for (const sx of [-1, 1]) {
      rb(b, sw * 0.22, 0.12, sd, sx * sw * 0.38, seatY - 0.06, sz, a, 0.045)?.rotation.set(0, 0, sx * 0.28);
      bx(b, 0.012, 0.012, sd - 0.06, sx * sw * 0.29, seatY + 0.035, sz, f);
    }
    // the tall backrest, laid back: centre panel, bolsters, shoulder wings, harness slots, pillows
    const by = seatY + 0.02;
    const bz = -d / 2 + 0.12;
    const bh = Math.max(0.4, h - by - 0.05);
    const bw = sw * 0.6;
    tilted(-0.15, by, bz, () => {
      const parts: (THREE.Object3D | null)[] = [
        rb(b, sw * 0.86, bh * 0.92, 0.07, 0, by, bz - 0.03, a, 0.03, 2),
        rb(b, bw, bh * 0.8, 0.07, 0, by, bz + 0.02, f, 0.03, 2),
        rb(b, bw * 0.95, bh * 0.2, 0.08, 0, by + bh * 0.8, bz - 0.005, a, 0.035),
        rb(b, bw * 0.55, bh * 0.14, 0.05, 0, by + bh * 0.76, bz + 0.065, plastic, 0.025),
        rb(b, bw * 0.65, bh * 0.14, 0.06, 0, by + bh * 0.16, bz + 0.07, plastic, 0.03),
      ];
      for (const sx of [-1, 1]) {
        const bol = rb(b, 0.1, bh * 0.68, 0.13, sx * (bw / 2 + 0.035), by, bz + 0.01, a, 0.045);
        bol?.rotation.set(0, -sx * 0.3, 0);
        parts.push(bol);
        // a stripe of the main colour along each bolster, a slot for a harness at the shoulders
        parts.push(rb(b, 0.016, bh * 0.6, 0.012, sx * (bw / 2 + 0.005), by + bh * 0.04, bz + 0.07, f, 0.004));
        parts.push(rb(b, 0.035, bh * 0.07, 0.03, sx * bw * 0.28, by + bh * 0.88, bz + 0.035, mat("#151517"), 0.01));
        parts.push(rb(b, 0.08, bh * 0.14, 0.08, sx * (bw / 2 + 0.02), by + bh * 0.66, bz - 0.01, a, 0.035));
      }
      return parts;
    });
    // armrests on posts
    for (const sx of [-1, 1]) {
      const x = sx * Math.min(w / 2 - 0.05, sw / 2 + 0.04);
      bx(b, Math.abs(x) - 0.1, 0.025, 0.06, sx * (Math.abs(x) / 2 + 0.05), seatY - 0.1, -0.02, plastic);
      rb(b, 0.04, 0.32, 0.06, x, seatY - 0.1, -0.02, plastic, 0.01);
      rb(b, 0.08, 0.03, 0.26, x, seatY + 0.2, 0.0, plastic, 0.013);
    }
  },

  // ----- computers, printers, books -----
  laptop: (b, w, d, h, f) => {
    // a thin base with a keyboard and trackpad, the lid open past upright with a thin-bezel screen
    const t = 0.016;
    const bd = Math.min(d / 1.36, (h - t) / 0.95);
    const bz = d / 2 - bd / 2;
    const hz = d / 2 - bd;
    b.box(w, t, bd, 0, 0, bz, f, 0.005);
    const deck = mat("#1d1e21", { roughness: 0.7 });
    const kw = w * 0.86;
    const kz = hz + bd * 0.08;
    const kd = bd * 0.46;
    bx(b, kw, 0.0008, kd, 0, t, kz + kd / 2, mat("#3a3c40"));
    const cols = 14;
    const rows = 6;
    const kp = kw / cols;
    const rp = kd / rows;
    for (let r = 0; r < rows; r++) {
      const z = kz + rp * (r + 0.5);
      if (r === rows - 1) {
        // the space row
        bx(b, kp * 1.8, 0.0012, rp * 0.78, -kw / 2 + kp * 0.95, t, z, deck);
        bx(b, kp * 5.6, 0.0012, rp * 0.78, -kp * 0.9, t, z, deck);
        for (let c = 0; c < 4; c++) bx(b, kp * 0.8, 0.0012, rp * 0.78, kw / 2 - kp * (0.5 + c), t, z, deck);
        continue;
      }
      for (let c = 0; c < cols; c++) bx(b, kp * 0.8, 0.0012, rp * (r === 0 ? 0.5 : 0.78), -kw / 2 + kp * (c + 0.5), t, z, deck);
    }
    bx(b, w * 0.4, 0.0008, bd * 0.3, 0, t, d / 2 - bd * 0.2, mat("#9a9da2", { roughness: 0.35, metalness: 0.2 }));
    // the lid, built upright then opened back about the hinge
    const screen = part(mat(C.screen, { emissive: "#24303c", emissiveIntensity: 0.4 }), "screen");
    tilted(-0.32, t, hz, () => [
      b.box(w, bd, 0.006, 0, t, hz - 0.003, f, 0.003),
      b.box(w - 0.004, bd - 0.004, 0.001, 0, t + 0.002, hz + 0.0005, mat("#0f1012", { roughness: 0.3 })),
      b.box(w - 0.016, bd - 0.032, 0.001, 0, t + 0.02, hz + 0.0012, screen),
      b.box(0.004, 0.004, 0.001, 0, t + bd - 0.008, hz + 0.0012, mat("#2e3238")),
    ]);
    b.add(new THREE.CylinderGeometry(0.005, 0.005, w * 0.7, 10).rotateZ(Math.PI / 2), f, 0, t * 0.7, hz + 0.003);
  },
  monitor: (b, w, d, h, f) => {
    // a thin panel with slim bezels and a chin, a housing on its back, an angled neck, a flat foot
    const screen = part(mat(C.screen, { emissive: "#24303c", emissiveIntensity: 0.4 }), "screen");
    const ph = Math.min(h * 0.78, w * 0.6);
    const py = h - ph;
    const pz = -d * 0.05;
    const pt = 0.012;
    b.box(w, ph, pt, 0, py, pz, f, 0.004);
    bx(b, w - 0.008, ph - 0.008, 0.001, 0, py + 0.004, pz + pt / 2, mat("#0e0f11", { roughness: 0.3 }));
    b.box(w - 0.014, ph - 0.03, 0.001, 0, py + 0.022, pz + pt / 2 + 0.0006, screen);
    b.box(w * 0.55, ph * 0.55, 0.03, 0, py + ph * 0.2, pz - pt / 2 - 0.012, f, 0.012);
    bx(b, 0.006, 0.003, 0.001, w / 2 - 0.03, py + 0.008, pz + pt / 2 + 0.0008, mat("#e8f4ff", { emissive: "#cfe8ff", emissiveIntensity: 0.6 }));
    // the stand: a foot, a neck leaning back to the hinge block
    const fd = d * 0.85;
    b.add(new RoundedBoxGeometry(Math.min(w * 0.38, 0.26), 0.01, fd, 2, 0.004), f, 0, 0.005, -d * 0.05);
    const hingeY = py + ph * 0.38;
    const hingeZ = pz - pt / 2 - 0.03;
    const footZ = -d * 0.05 - fd * 0.25;
    const neckLen = Math.hypot(hingeY, hingeZ - footZ);
    const neck = b.box(0.05, neckLen, 0.018, 0, 0, 0, f, 0.006);
    neck?.position.set(0, hingeY / 2, (hingeZ + footZ) / 2);
    neck?.rotation.set(Math.atan2(hingeZ - footZ, hingeY), 0, 0);
    b.box(0.07, 0.03, 0.03, 0, hingeY, hingeZ, f, 0.008);
  },
  printer: (b, w, d, h, f) => {
    // an all-in-one: the body, the scanner lid with its seam, an output slot and tray, the paper cassette, a tilted panel
    const bd = d * 0.9;
    const bz = -d / 2 + bd / 2;
    const body = h * 0.78;
    b.box(w, body, bd, 0, 0, bz, f, 0.012);
    const dark = mat("#1c1d20", { roughness: 1 });
    const seam = mat("#3a3b3e", { roughness: 1 });
    // the scanner and its lid
    bx(b, w - 0.006, 0.004, bd - 0.006, 0, body - 0.002, bz, seam);
    b.box(w - 0.004, h - body - 0.004, bd - 0.01, 0, body + 0.002, bz - 0.003, f, 0.01);
    bx(b, w * 0.2, 0.006, 0.006, 0, h - 0.016, bz + bd / 2 - 0.006, seam);
    // the output slot, the tray pulled out with a printed page
    const fz = bz + bd / 2;
    bx(b, w * 0.76, h * 0.07, 0.006, 0, body * 0.5, fz - 0.002, dark);
    const tl = d - bd + 0.06;
    b.box(w * 0.66, 0.006, tl, 0, body * 0.38, d / 2 - tl / 2, f, 0.002)?.rotation.set(-0.06, 0, 0);
    b.box(w * 0.5, 0.002, tl - 0.01, 0, body * 0.38 + 0.007, d / 2 - tl / 2, mat("#fbfbf6"))?.rotation.set(-0.06, 0, 0);
    // the paper cassette
    bx(b, w - 0.02, 0.003, 0.002, 0, body * 0.3, fz + 0.0005, seam);
    bx(b, w * 0.3, 0.012, 0.004, 0, body * 0.12, fz + 0.001, dark);
    // the control panel on the right, tilted up, with its display and a light
    const py = body - 0.035;
    const pzc = fz - 0.03;
    tilted(0.5, py, pzc, () => [
      b.box(w * 0.34, 0.016, 0.07, w * 0.28, py, pzc, mat(C.black, { roughness: 0.4 }), 0.004),
      b.box(w * 0.15, 0.001, 0.04, w * 0.24, py + 0.016, pzc, mat("#7fb8e6", { emissive: "#3a7ab0", emissiveIntensity: 0.6 })),
      b.sphere(0.004, w * 0.4, py + 0.016, pzc + 0.015, mat("#3fd27a", { emissive: "#3fd27a", emissiveIntensity: 0.6 }), 1, 0.5, 1, 8),
    ]);
  },
  printer_3d: (b, w, d, h, f) => {
    // an enclosed 3D printer: frame, glass panels and door, the bed with a print, the head on its gantry,
    // a spool on the side, a display and a status light
    const fw = w - 0.09;
    const fx = -0.045;
    const steel = mat(C.steel, { metalness: 0.7, roughness: 0.3 });
    const dark = mat(C.black, { roughness: 0.5 });
    b.box(fw, 0.08, d, fx, 0, 0, f, 0.008);
    b.box(fw, 0.05, d, fx, h - 0.05, 0, f, 0.008);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, 0.025, h - 0.13, 0.025, fx + sx * (fw / 2 - 0.0125), 0.08, sz * (d / 2 - 0.0125), f);
    const pane = mat("#cfe6ef", { transparent: true, opacity: 0.22, roughness: 0.05 });
    bx(b, fw - 0.05, h - 0.13, 0.004, fx, 0.08, d / 2 - 0.004, pane);
    for (const sx of [-1, 1]) bx(b, 0.004, h - 0.13, d - 0.05, fx + sx * (fw / 2 - 0.004), 0.08, 0, pane);
    bx(b, fw - 0.05, h - 0.13, 0.004, fx, 0.08, -d / 2 + 0.004, mat("#2b2c2e"));
    b.box(0.012, h * 0.3, 0.012, fx + fw / 2 - 0.05, h * 0.35, d / 2 + 0.004, steel, 0.004);
    // the bed, a half-printed vase on it
    const bedY = 0.08 + (h - 0.13) * 0.22;
    bx(b, fw * 0.72, 0.012, d * 0.68, fx, bedY, 0, mat("#3a3b3e"));
    bx(b, fw * 0.7, 0.002, d * 0.66, fx, bedY + 0.012, 0, mat("#1d2025", { roughness: 0.4 }));
    bx(b, 0.015, bedY - 0.08, 0.015, fx, 0.08, -d * 0.3, steel);
    const vh = Math.min(0.09, (h - 0.13) * 0.25);
    const vr = Math.min(0.045, fw * 0.14);
    const vase = Array.from({ length: 7 }, (_, i) => new THREE.Vector2(vr * (0.75 + 0.35 * Math.sin((i / 6) * Math.PI)), (i / 6) * vh));
    vase.unshift(new THREE.Vector2(0, 0));
    b.add(new THREE.LatheGeometry(vase, 16), mat("#e8752a", { roughness: 0.6 }), fx, bedY + 0.014, 0.01);
    // the gantry: rods on both sides, a crossbar, the head with its fan
    const gy = 0.08 + (h - 0.13) * 0.78;
    for (const sx of [-1, 1]) bx(b, 0.012, 0.012, d - 0.05, fx + sx * (fw / 2 - 0.03), gy, 0, steel);
    bx(b, fw - 0.06, 0.01, 0.01, fx, gy - 0.005, 0.03, steel);
    const hx = fx + fw * 0.08;
    b.box(0.055, 0.06, 0.05, hx, gy - 0.04, 0.03, dark, 0.008);
    b.add(new THREE.CircleGeometry(0.018, 12), mat("#3a3b3e"), hx, gy - 0.01, 0.0555);
    b.cyl(0.001, 0.004, 0.014, hx, gy - 0.054, 0.03, mat(C.chrome, { metalness: 0.8 }), 8);
    // the spool on its holder on the right side
    const sr = Math.min(0.085, h * 0.18, d * 0.25);
    const spx = fx + fw / 2 + 0.024;
    const spy = h * 0.58;
    const spz = -d * 0.1;
    b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.045, 8).rotateZ(Math.PI / 2), steel, fx + fw / 2 + 0.02, spy, spz);
    for (const o of [-0.017, 0.017]) b.add(new THREE.CylinderGeometry(sr, sr, 0.004, 24).rotateZ(Math.PI / 2), mat("#e9e9e6"), spx + o, spy, spz);
    b.add(new THREE.CylinderGeometry(sr * 0.85, sr * 0.85, 0.03, 24).rotateZ(Math.PI / 2), mat("#e8752a", { roughness: 0.6 }), spx, spy, spz);
    b.add(new THREE.CylinderGeometry(sr * 0.3, sr * 0.3, 0.036, 16).rotateZ(Math.PI / 2), dark, spx, spy, spz);
    // the display and the status light on the base
    bx(b, 0.07, 0.04, 0.003, fx - fw * 0.25, 0.02, d / 2, mat("#1d1e21"));
    bx(b, 0.058, 0.03, 0.002, fx - fw * 0.25, 0.025, d / 2 + 0.002, mat("#7fb8e6", { emissive: "#3a7ab0", emissiveIntensity: 0.6 }));
    b.box(0.03, 0.012, 0.004, fx + fw / 2 - 0.05, 0.03, d / 2 + 0.001, part(mat("#3fd27a"), "led"));
  },
  books: (b, w, d, h) => {
    // a row of books by a bookend and a stack lying flat: covers, spines with bands, page edges
    const rand = random(251);
    const pages = mat("#efe8d6", { roughness: 1 });
    const band = mat("#e0c068", { metalness: 0.3, roughness: 0.5 });
    const steel = mat(C.black, { roughness: 0.5 });
    bx(b, 0.004, Math.min(h, 0.16), d * 0.7, -w / 2 + 0.002, 0, 0, steel);
    bx(b, 0.08, 0.003, d * 0.7, -w / 2 + 0.04, 0, 0, steel);
    let x = -w / 2 + 0.006;
    const end = w * 0.1;
    while (x < end) {
      const bw = 0.02 + rand() * 0.028;
      const bh = Math.max(0.05, Math.min(h, 0.16 + rand() * 0.09));
      const bd = d * (0.82 + rand() * 0.15);
      const cover = mat(C.book[Math.floor(rand() * C.book.length)], { roughness: 0.7 });
      const z = d / 2 - bd / 2;
      for (const s of [-1, 1]) bx(b, 0.0025, bh, bd - 0.004, x + bw / 2 + s * (bw / 2 - 0.00125), 0, z - 0.002, cover);
      bx(b, bw, bh, 0.004, x + bw / 2, 0, d / 2 - 0.002, cover);
      bx(b, bw - 0.005, bh - 0.006, bd - 0.006, x + bw / 2, 0.003, z - 0.002, pages);
      if (rand() > 0.35) bx(b, bw + 0.0004, 0.006, 0.0042, x + bw / 2, bh * (0.7 + rand() * 0.15), d / 2 - 0.002, band);
      x += bw + 0.0015;
    }
    let y = 0;
    while (y < h * 0.5) {
      const bh = 0.025 + rand() * 0.02;
      const bw = w * 0.36 * (0.85 + rand() * 0.15);
      const bd = d * (0.75 + rand() * 0.2);
      const cover = mat(C.book[Math.floor(rand() * C.book.length)], { roughness: 0.7 });
      const ry = (rand() - 0.5) * 0.25;
      const cx = w * 0.3;
      const ox = 0.002 * Math.cos(ry);
      const oz = -0.002 * Math.sin(ry);
      bx(b, bw - 0.004, 0.003, bd, cx + ox, y, oz, cover, 0, ry);
      bx(b, bw - 0.004, 0.003, bd, cx + ox, y + bh - 0.003, oz, cover, 0, ry);
      bx(b, 0.004, bh, bd, cx - (bw / 2) * Math.cos(ry), y, (bw / 2) * Math.sin(ry), cover, 0, ry);
      bx(b, bw - 0.008, bh - 0.006, bd - 0.006, cx + 0.002 * Math.cos(ry), y + 0.003, 0, pages, 0, ry);
      y += bh;
    }
  },

  // ----- smart home devices -----
  smoke_detector: (b, w, d, h, f) => {
    // a ceiling dome on a mounting base: a dark vent band with ribs all round, a test button with its light
    const r = Math.min(w, d) / 2;
    const prof = [
      [r * 0.42, 0],
      [r * 0.62, h * 0.06],
      [r * 0.74, h * 0.18],
      [r * 0.78, h * 0.3],
      [r * 0.78, h * 0.62],
      [r * 0.96, h * 0.7],
      [r, h * 0.82],
      [r, h],
      [0, h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    b.add(new THREE.LatheGeometry(prof, 20), f);
    b.add(new THREE.CircleGeometry(r * 0.42, 20).rotateX(Math.PI / 2), f);
    const vent = mat("#4a4e54", { roughness: 1 });
    b.cyl(r * 0.785, r * 0.785, h * 0.3, 0, h * 0.31, 0, vent, 20, true);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      bx(b, 0.003, h * 0.3, 0.008, Math.cos(a) * r * 0.79, h * 0.31, Math.sin(a) * r * 0.79, f, 0, -a + Math.PI / 2);
    }
    b.cyl(r * 0.3, r * 0.32, 0.004, 0, -0.003, 0, mat("#e3e3df", { roughness: 0.5 }), 20);
    b.cyl(0.004, 0.004, 0.003, r * 0.48, -0.001, 0, ledMat("#ff3b30"), 8);
  },
  leak_sensor: (b, w, d, h, f) => {
    // a puck on the floor: a rounded body, a glossy top with its light, a seam, metal contacts underneath
    const r = Math.min(w, d) / 2;
    const prof = [
      [r * 0.92, 0],
      [r, h * 0.12],
      [r, h * 0.45],
      [r * 0.97, h * 0.75],
      [r * 0.88, h * 0.95],
      [r * 0.78, h],
      [0, h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    b.add(new THREE.LatheGeometry(prof, 24), f);
    b.add(new THREE.CircleGeometry(r * 0.92, 24).rotateX(Math.PI / 2), f);
    b.cyl(r * 1.003, r * 1.003, 0.0012, 0, h * 0.4, 0, mat("#6b7077"), 24, true);
    b.add(new THREE.CircleGeometry(r * 0.55, 24).rotateX(-Math.PI / 2), mat("#9aa0a6", { roughness: 0.2, metalness: 0.2 }), 0, h + 0.0004, 0);
    for (const a of [0, 2.1, 4.2]) b.cyl(0.004, 0.004, 0.003, Math.cos(a) * r * 0.6, -0.001, Math.sin(a) * r * 0.6, mat(C.chrome, { metalness: 0.8 }), 8);
    b.cyl(0.003, 0.003, 0.002, 0, h - 0.0005, r * 0.68, ledMat("#3fa8ff"), 8);
  },
  motion_sensor: (b, w, d, h, f) => {
    // a wall block with a faceted Fresnel dome and a small status light
    const bd = d * 0.55;
    rb(b, w, h, bd, 0, 0, back(d) + bd / 2, f, Math.min(w, h) * 0.18, 2);
    const r = Math.min(w, h) * 0.36;
    const lens = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
    lens.scale(1, 1, Math.min(1, ((d - bd) / r) * 0.95));
    b.add(lens, mat("#f4f3ef", { flatShading: true, roughness: 0.35 }), 0, h * 0.56, back(d) + bd);
    ring(b, r * 0.98, r * 1.08, 0, h * 0.56, back(d) + bd, mat("#9aa0a6"), 20);
    zcyl(b, 0.0025, 0.0025, 0.002, w * 0.28, h * 0.14, back(d) + bd + 0.001, ledMat("#3fd27a"), 8);
  },
  contact_sensor: (b, w, d, h, f) => {
    // the sensor on the frame and its magnet on the leaf, a gap between, marks lining them up
    const sw = w * 0.6;
    const mw = w * 0.3;
    rb(b, sw, h, d, -w / 2 + sw / 2, 0, 0, f, 0.005);
    rb(b, mw, h * 0.7, d * 0.8, w / 2 - mw / 2, h * 0.15, -d * 0.1, f, 0.004);
    const mark = mat("#9aa0a6", { roughness: 1 });
    bx(b, 0.006, 0.0015, 0.001, -w / 2 + sw - 0.006, h * 0.5, d / 2, mark);
    bx(b, 0.006, 0.0015, 0.001, w / 2 - mw + 0.006, h * 0.5, d / 2 - d * 0.2, mark);
    bx(b, sw * 0.5, 0.0015, 0.001, -w / 2 + sw / 2, h * 0.14, d / 2, mark);
    zcyl(b, 0.002, 0.002, 0.002, -w / 2 + sw / 2, h * 0.78, d / 2, ledMat("#ff9a2a"), 8);
  },
  thermostat: (b, w, d, h, f) => {
    // a square plate, a metal ring around a round display showing the temperature and its arc
    rb(b, w, h, d * 0.45, 0, 0, back(d) + d * 0.225, f, 0.008, 2);
    const rim = mat(C.chrome, { metalness: 0.75, roughness: 0.3 });
    const r = Math.min(w, h) * 0.34;
    const front = back(d) + d;
    zcyl(b, r, r * 1.02, d * 0.55, 0, h / 2, front - d * 0.275, rim, 28, true);
    ring(b, r * 0.9, r, 0, h / 2, front, rim, 24, 0.002);
    b.add(new THREE.CircleGeometry(r * 0.92, 28), mat("#0b0c0e", { roughness: 0.2 }), 0, h / 2, front + 0.0004);
    b.add(new THREE.CircleGeometry(r * 0.8, 28), screenMat(), 0, h / 2, front + 0.0008);
    const lit = mat("#ffb36b", { emissive: "#ff9a3a", emissiveIntensity: 0.8 });
    const ch = r * 0.55;
    digits(b, "21", -ch * 0.6, h / 2 - ch * 0.4, front + 0.0012, ch, lit);
    b.add(new THREE.RingGeometry(r * 0.68, r * 0.72, 24, 1, -Math.PI * 0.1, Math.PI * 1.2), lit, 0, h / 2, front + 0.0012);
    b.box(0.008, 0.003, 0.002, 0, h * 0.06, back(d) + d * 0.45, ledMat("#ff8a3a"));
  },
  climate_sensor: (b, w, d, h, f) => {
    // a small square with an e-ink face: the temperature large, the humidity small, vents underneath
    rb(b, w, h, d, 0, 0, 0, f, 0.008, 2);
    const ink = mat("#2a2b2d", { roughness: 1 });
    bx(b, w * 0.8, h * 0.72, 0.002, 0, h * 0.16, d / 2 - 0.0005, mat("#d7d9d3", { roughness: 1 }));
    const ch = h * 0.3;
    digits(b, "21.5", -w * 0.33, h * 0.45, d / 2 + 0.0012, ch, ink);
    digits(b, "48", w * 0.08, h * 0.22, d / 2 + 0.0012, ch * 0.45, ink);
    bx(b, w * 0.12, h * 0.018, 0.0008, -w * 0.18, h * 0.26, d / 2 + 0.0012, ink);
    for (let i = 0; i < 5; i++) bx(b, w * 0.06, 0.002, d * 0.5, (i - 2) * w * 0.12, -0.0005, 0, mat("#5a5f66"));
  },
  smart_plug: (b, w, d, h, f) => {
    // a plug on the wall socket: its own socket on the front, a button with its ring light
    rb(b, w * 1.25, h * 1.25, 0.01, 0, -h * 0.125, back(d) + 0.005, mat(C.ceramic), 0.006);
    const bd = d - 0.01;
    rb(b, w, h, bd, 0, 0, back(d) + 0.01 + bd / 2, f, Math.min(w, h) * 0.2, 2);
    const fz = back(d) + 0.01 + bd;
    ring(b, w * 0.26, w * 0.29, 0, h * 0.44, fz - 0.0005, mat("#8a8d91", { roughness: 1 }), 16, 0.0015);
    disc(b, w * 0.26, 0, h * 0.44, fz - 0.0005, mat("#d9dad6"), 16);
    for (const s of [-1, 1]) disc(b, 0.0028, s * w * 0.11, h * 0.44, fz, mat("#26272a"), 6);
    disc(b, w * 0.08, w * 0.28, h * 0.8, fz - 0.0005, mat("#d9dad6"), 12, 0.0015);
    ring(b, w * 0.085, w * 0.11, w * 0.28, h * 0.8, fz - 0.0005, ledMat("#3fa8ff"), 12, 0.0013);
  },
  doorbell_camera: (b, w, d, h, f) => {
    // a slim upright: a glossy black face, the lens with its ring, sensors, the ring button, a speaker grille
    rb(b, w, h, d, 0, 0, 0, f, Math.min(w * 0.4, 0.015), 2);
    const fz = d / 2;
    bx(b, w * 0.84, h * 0.42, 0.002, 0, h * 0.53, fz - 0.0005, mat("#121316", { roughness: 0.15, metalness: 0.2 }));
    disc(b, w * 0.2, 0, h * 0.8, fz, mat("#2e3238", { metalness: 0.5, roughness: 0.3 }), 16);
    zcyl(b, w * 0.12, w * 0.12, 0.003, 0, h * 0.8, fz + 0.002, mat("#05070a", { roughness: 0.05 }), 16);
    b.sphere(w * 0.05, 0, h * 0.8, fz + 0.0035, mat("#2a4a7a", { roughness: 0.05, metalness: 0.4 }), 1, 1, 0.4, 8);
    for (const s of [-1, 1]) bx(b, 0.0034, 0.0034, 0.001, s * w * 0.28, h * 0.66, fz, mat("#3a1a1a", { roughness: 0.1 }));
    zcyl(b, w * 0.27, w * 0.27, 0.004, 0, h * 0.28, fz + 0.001, mat("#2b2c2e", { roughness: 0.4 }), 16);
    ring(b, w * 0.27, w * 0.32, 0, h * 0.28, fz - 0.0005, ledMat("#3fa8ff"), 16, 0.0025);
    for (let i = 0; i < 4; i++) bx(b, w * 0.5, 0.0015, 0.001, 0, h * (0.06 + i * 0.022), fz, mat("#4a4d52"));
  },
  security_camera: (b, w, d, h, f) => {
    // a round wall plate, an arm with a ball joint, a bullet camera with a sun hood, lens and IR lights, looking down
    zcyl(b, w * 0.42, w * 0.46, 0.014, 0, h * 0.5, back(d) + 0.007, f, 16);
    b.rod(v(0, h * 0.5, back(d) + 0.012), v(0, h * 0.6, back(d) + d * 0.28), 0.009, f, 8);
    b.sphere(0.016, 0, h * 0.6, back(d) + d * 0.28, f, 1, 1, 1, 10);
    const cy = h * 0.66;
    const len = d * 0.62;
    const cz = back(d) + d * 0.32 + len / 2;
    const r = w * 0.32;
    const front = cz + len / 2;
    const ir = mat("#3a1a1a", { roughness: 0.2 });
    tilted(0.33, cy, back(d) + d * 0.28, () => {
      const parts: (THREE.Object3D | null)[] = [
        zcyl(b, r, r, len, 0, cy, cz, f, 20),
        b.sphere(r, 0, cy, cz - len / 2, f, 1, 1, 0.5, 12),
        disc(b, r * 0.86, 0, cy, front, mat("#16181b", { roughness: 0.1 }), 20),
        zcyl(b, r * 0.4, r * 0.4, 0.004, 0, cy, front + 0.002, mat("#06080b", { roughness: 0.05 }), 12),
      ];
      // the hood: a curved shield over the top, reaching past the front
      const hood = new THREE.Shape();
      const a0 = -0.08 * Math.PI;
      const a1 = 1.08 * Math.PI;
      hood.absarc(0, 0, r * 1.18, a0, a1, false);
      hood.absarc(0, 0, r * 1.08, a1, a0, true);
      const hl = len * 0.8;
      parts.push(b.add(new THREE.ExtrudeGeometry(hood, { depth: hl, bevelEnabled: false, curveSegments: 10 }), f, 0, cy, front + len * 0.1 - hl));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(b.add(new THREE.BoxGeometry(0.005, 0.005, 0.002), ir, Math.cos(a) * r * 0.64, cy + Math.sin(a) * r * 0.64, front + 0.001));
      }
      parts.push(zcyl(b, 0.003, 0.003, 0.003, r * 0.55, cy - r * 0.8, cz + len * 0.2, ledMat("#ff3b30"), 8));
      return parts;
    });
  },
  smart_hub: (b, w, d, h, f) => {
    // a soft square box with a chamfered top, a logo, a light strip, rubber feet
    rb(b, w, h * 0.7, d, 0, 0.002, 0, f, Math.min(w, d) * 0.12, 2);
    rb(b, w * 0.94, h * 0.32, d * 0.94, 0, h * 0.66, 0, f, Math.min(w, d) * 0.1);
    b.cyl(w * 0.09, w * 0.09, 0.0008, 0, h - 0.0002, 0, mat("#c9cdd1", { metalness: 0.5, roughness: 0.3 }), 20);
    b.box(w * 0.5, 0.003, 0.004, 0, h * 0.4, d / 2, ledMat("#3fd27a"));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.006, 0.006, 0.003, sx * w * 0.36, 0, sz * d * 0.36, mat(C.black), 8);
  },
  smart_speaker: (b, w, d, h, f) => {
    // a fabric cylinder rounded at both ends, a top with touch buttons and the light ring
    const r = Math.min(w, d) / 2;
    const prof = [
      [r * 0.82, 0],
      [r * 0.97, h * 0.03],
      [r, h * 0.1],
      [r, h * 0.88],
      [r * 0.97, h * 0.94],
      [r * 0.9, h * 0.96],
      [r * 0.84, h * 0.96],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    b.add(new THREE.LatheGeometry(prof, 24), f);
    b.add(new THREE.CircleGeometry(r * 0.82, 24).rotateX(Math.PI / 2), f);
    b.cyl(r * 0.88, r * 0.9, h * 0.04, 0, h * 0.96, 0, mat(C.black, { roughness: 0.35 }), 24);
    ring(b, r * 0.78, r * 0.86, 0, h - 0.0005, 0, ledMat("#3fa8ff"), 24, 0.0015, true);
    const btn = mat("#5a5f66", { roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.cyl(r * 0.07, r * 0.07, 0.0012, Math.cos(a) * r * 0.4, h - 0.0004, Math.sin(a) * r * 0.4, btn, 8);
    }
    b.cyl(r * 1.002, r * 1.002, 0.0015, 0, h * 0.1, 0, btn, 24, true);
  },
  keypad: (b, w, d, h, f, color) => {
    // an alarm keypad: a display, twelve keys, function keys and a status light
    rb(b, w, h, d, 0, 0, 0, f, 0.008, 2);
    const fz = d / 2;
    bx(b, w * 0.72, h * 0.15, 0.002, 0, h * 0.72, fz - 0.0005, mat("#1d1e21"));
    bx(b, w * 0.62, h * 0.1, 0.001, 0, h * 0.745, fz + 0.0008, mat("#8fb8a0", { emissive: "#4f8a6a", emissiveIntensity: 0.4 }));
    const key = mat(color === "black" ? "#4a4d52" : "#d9dcdf", { roughness: 0.5 });
    const rim = mat(color === "black" ? "#2a2b2e" : "#a9adb2", { roughness: 0.8 });
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 3; c++) {
        bx(b, w * 0.22, h * 0.11, 0.002, (c - 1) * w * 0.26, h * (0.075 + r * 0.14), fz - 0.0005, rim);
        bx(b, w * 0.2, h * 0.1, 0.004, (c - 1) * w * 0.26, h * (0.08 + r * 0.14), fz, key);
      }
    for (let c = 0; c < 3; c++) bx(b, w * 0.16, h * 0.035, 0.003, (c - 1) * w * 0.26, h * 0.64, fz, mat(["#c0392b", "#e8a53c", "#3f6c8f"][c]));
    b.box(w * 0.5, 0.005, 0.002, 0, h * 0.92, fz + 0.001, ledMat("#3fd27a"));
  },
};
