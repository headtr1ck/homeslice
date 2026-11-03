// More detailed built-in pieces: bedroom kids. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { FINISHES } from "../../model/modern";
import type { Build, Builder } from "../modern";
import { C, mat, matrix, random, v } from "../modern";

// ----- small helpers -----

/** A finish's colour, darker or lighter (k < 1 darker): textured finishes have a white material colour. */
const shade = (color: string, k: number) => {
  const c = new THREE.Color(FINISHES[color] ?? color);
  if (k > 1) c.lerp(new THREE.Color("#ffffff"), k - 1);
  else c.multiplyScalar(k);
  return "#" + c.getHexString();
};
const mirrorMat = () => mat("#cfdbe1", { metalness: 0.75, roughness: 0.08 });
const joint = () => mat("#1d1e21", { roughness: 1 });
const sheetMat = () => mat(C.mattress, { roughness: 1 });
const clothMat = (color: string) => mat(color, { roughness: 1, side: THREE.DoubleSide });

/** A box from its bottom centre with softly rounded edges (cheap: one segment per edge). */
function rbox(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, r = 0.004, seg = 1) {
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const geo = rr > 0.001 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  return b.add(geo, m, x, y + h / 2, z);
}

/** A horizontal cylinder along x (axis "x") or z. */
function hcyl(b: Builder, r: number, len: number, x: number, y: number, z: number, m: THREE.Material, axis: "x" | "z", seg = 10) {
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === "x") geo.rotateZ(Math.PI / 2);
  else geo.rotateX(Math.PI / 2);
  return b.add(geo, m, x, y, z);
}

/** A bar handle on standoffs on a front facing +z (or ±x with `side`). */
function barHandle(b: Builder, x: number, y: number, z: number, len: number, m: THREE.Material, vertical: boolean, side = 0) {
  const out = 0.022;
  if (side) {
    // on a front facing ±x: the bar runs along z
    hcyl(b, 0.006, len, x + side * out, y, z, m, "z", 12);
    for (const s of [-1, 1]) hcyl(b, 0.004, out, x + (side * out) / 2, y, z + s * (len / 2 - 0.02), m, "x", 6);
    return;
  }
  if (vertical) b.cyl(0.006, 0.006, len, x, y - len / 2, z + out, m, 12);
  else hcyl(b, 0.006, len, x, y, z + out, m, "x", 12);
  for (const s of [-1, 1]) {
    const px = vertical ? x : x + s * (len / 2 - 0.02);
    const py = vertical ? y + s * (len / 2 - 0.02) : y;
    hcyl(b, 0.004, out, px, py, z + out / 2, m, "z", 6);
  }
}
/** How fronts open: the piece's own handle, or the one chosen for it (options.handle). */
type Handle = "bar" | "knob" | "handleless" | "push";
function handleOf(b: Builder, own: Handle): Handle {
  const chosen = b.options.handle as Handle | undefined;
  return chosen && ["bar", "knob", "handleless", "push"].includes(chosen) ? chosen : own;
}
/** A handleless front's grip: a dark recess with a metal lip along its top (or its opening side). */
function gripRail(b: Builder, x: number, y: number, z: number, len: number, vertical: boolean) {
  const lip = mat("#a9adb2", { metalness: 0.7, roughness: 0.35 });
  if (vertical) {
    b.box(0.022, len, 0.004, x, y - len, z + 0.002, joint());
    b.box(0.005, len, 0.007, x + 0.008, y - len, z + 0.0035, lip);
  } else {
    b.box(len, 0.022, 0.004, x, y - 0.022, z + 0.002, joint());
    b.box(len, 0.005, 0.007, x, y - 0.027, z + 0.0035, lip);
  }
}
function knob(b: Builder, x: number, y: number, z: number, m: THREE.Material, r = 0.014) {
  hcyl(b, r * 0.45, 0.014, x, y, z + 0.007, m, "z", 8);
  b.sphere(r, x, y, z + 0.014 + r * 0.6, m, 1, 1, 0.75, 10);
}

/** Tapered round legs, slightly splayed outwards. */
function taperLegs(b: Builder, w: number, d: number, h: number, inset: number, r: number, m: THREE.Material, splay = 0.015, zc = 0) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset);
      const z = zc + sz * (d / 2 - inset);
      const geo = new THREE.CylinderGeometry(r, r * 0.6, 1, 10);
      const top = v(x, h, z);
      const foot = v(x + sx * splay, 0, z + sz * splay);
      const mesh = b.add(geo, m);
      mesh.position.copy(top).add(foot).multiplyScalar(0.5);
      mesh.scale.y = top.distanceTo(foot);
      mesh.quaternion.setFromUnitVectors(v(0, 1, 0), top.clone().sub(foot).normalize());
    }
}

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * A cloth lying on a flat top (x in ±hw, z from z0 to z1, at height y) that rolls over the
 * long sides (and the foot at z1) with edge radius r and hangs down by `drop`, in soft
 * folds that grow towards the hem. Duvets, throws, bedspreads.
 */
function cloth(b: Builder, hw: number, z0: number, z1: number, y: number, m: THREE.Material, o: { r: number; drop: number; foot?: boolean; puff?: number; fold?: number; seed?: number; step?: number; floor?: number }) {
  const r = o.r;
  const drop = Math.max(0.005, o.drop);
  const arc = (r * Math.PI) / 2;
  const fold = o.fold ?? 0.016;
  const step = o.step ?? 0.11;
  const edge = [arc / 3, (2 * arc) / 3, arc, arc + drop * 0.34, arc + drop * 0.67, arc + drop];
  const lin = (a: number, c: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((c - a) * i) / n);
  const xs = [...edge.slice().reverse().map((s) => -hw - s), ...lin(-hw, hw, Math.max(3, Math.round((2 * hw) / step))), ...edge.map((s) => hw + s)];
  const zs = [...lin(z0, z1, Math.max(2, Math.round((z1 - z0) / step))), ...(o.foot ? edge.map((s) => z1 + s) : [])];
  const rand = random(o.seed ?? 7);
  const ph = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
  const puff = o.puff ?? 0;
  const pos: number[] = [];
  for (const pz of zs)
    for (const px of xs) {
      const cx = Math.max(-hw, Math.min(hw, px));
      const cz = Math.min(z1, pz);
      const dx = px - cx;
      const dz = pz - cz;
      const s0 = Math.hypot(dx, dz);
      const inside = Math.min(hw - Math.abs(cx), o.foot ? z1 - cz : 9);
      let X = cx;
      let Y = y + puff * smooth(inside / 0.22) + 0.005 * Math.sin(cx * 7 + ph[0]) * Math.sin(cz * 5 + ph[1]) * smooth(inside / 0.2);
      let Z = cz;
      if (s0 > 1e-6) {
        const s = Math.min(s0, arc + drop * 1.12);
        const ux = dx / s0;
        const uz = dz / s0;
        // along the edge: z on the sides, x at the foot
        const t = cz * Math.abs(ux) + cx * Math.abs(uz);
        let out: number;
        let down: number;
        if (s < arc) {
          const a = s / r;
          out = r * Math.sin(a);
          down = r * (1 - Math.cos(a));
        } else {
          const k = (s - arc) / drop;
          const wave = Math.sin(t * 15 + ph[2]) * 0.7 + Math.sin(t * 27 + ph[3]) * 0.3;
          out = r + k * 0.012 + fold * k * wave;
          down = r + (s - arc) - 0.012 * k * Math.sin(t * 11 + ph[1]);
        }
        X += ux * out;
        Z += uz * out;
        Y -= down;
      }
      pos.push(X, Math.max(o.floor ?? 0.01, Y), Z);
    }
  const nx = xs.length;
  const index: number[] = [];
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return b.add(geo, m);
}

/** A soft pillow: thick in the middle, thin at the seams, (w, t, d) its size. */
function pillow(b: Builder, w: number, t: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, seg = 14) {
  const geo = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.6));
  const p = geo.attributes.position;
  const sq = (a: number) => Math.sign(a) * Math.pow(Math.abs(a), 0.3);
  for (let i = 0; i < p.count; i++) {
    const X = sq(p.getX(i));
    const Z = sq(p.getZ(i));
    // the corners stick out a little
    const corner = Math.abs(X * Z);
    p.setXYZ(i, X * (w / 2) * (1 + 0.04 * corner), p.getY(i) * (t / 2) * (1 - 0.3 * corner), Z * (d / 2) * (1 + 0.04 * corner));
  }
  geo.computeVertexNormals();
  const mesh = b.add(geo, m, x, y, z);
  mesh.rotation.set(rx, ry, 0, "YXZ");
  return mesh;
}

/** A throw's colour that goes with the bed's finish. */
const THROW: Record<string, string> = {
  beige: "#a8603f",
  grey: "#c9a24a",
  anthracite: "#b98e6a",
  green: "#e2d6bd",
  blue: "#d9c7a6",
  pink: "#8d9a83",
  oak: "#5d7a60",
  white: "#4d6a88",
  walnut: "#d1bc94",
  black: "#a8433a",
  terracotta: "#e2d6bd",
};

/**
 * The bed linen on a mattress: the mattress (top at y + mh), a duvet that rolls over the
 * sides and the foot with its top folded back, pillows against the head end, a throw.
 */
function bedLinen(b: Builder, o: { w: number; zBack: number; zFront: number; y: number; mh?: number; drop: number; color: string; pillows?: number; throwOn?: boolean; seed?: number; step?: number; duvet?: string }) {
  const mh = o.mh ?? 0.2;
  const md = o.zFront - o.zBack;
  rbox(b, o.w, mh, md, 0, o.y, (o.zBack + o.zFront) / 2, sheetMat(), 0.05, 2);
  const top = o.y + mh;
  const r = 0.06;
  const hw = o.w / 2 - r + 0.012;
  const yTop = top + 0.012;
  const drop = Math.max(0.02, o.drop - r);
  const z0 = o.zBack + Math.min(0.62, md * 0.3);
  const z1 = o.zFront - r + 0.012;
  const duvet = clothMat(o.duvet ?? "#ebe6dc");
  const opts = { r, drop, foot: true, puff: 0.035, fold: 0.016, seed: o.seed ?? 3, step: o.step };
  cloth(b, hw, z0, z1, yTop, duvet, opts);
  // the top folded back over the duvet, the crease rolled at the head end
  const fold = Math.min(0.3, md * 0.16);
  cloth(b, hw, z0, z0 + fold, yTop + 0.018, duvet, { ...opts, r: r + 0.018, drop: drop * 0.85, foot: false });
  b.add(new THREE.CapsuleGeometry(0.024, hw * 2 + 0.02, 3, 10).rotateZ(Math.PI / 2), duvet, 0, yTop + 0.012 + 0.035 * 0.6, z0);
  // pillows lean against the head end
  const n = o.pillows ?? (o.w > 1.2 ? 2 : 1);
  const pw = Math.min(0.72, o.w / n - 0.08);
  const pm = mat(C.pillow, { roughness: 1 });
  for (let i = 0; i < n; i++) {
    const x = -o.w / 2 + (o.w / n) * (i + 0.5);
    pillow(b, pw, 0.15, 0.44, x, top + 0.1, o.zBack + 0.27, pm, 0.5, (i - (n - 1) / 2) * 0.05);
  }
  // a throw across the foot
  if (o.throwOn !== false && md > 1) {
    const tz = z1 - Math.min(0.62, md * 0.3);
    cloth(b, hw, tz, tz + Math.min(0.42, md * 0.2), yTop + 0.014, clothMat(THROW[o.color] ?? "#a8603f"), { ...opts, r: r + 0.014, drop: drop * 0.8, foot: false });
  }
}

// ----- beds -----

function bedUpholstered(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, color: string, single: boolean) {
  // a padded frame on short legs, a headboard in vertical channels
  const legH = 0.07;
  const hd = 0.1;
  const zb = -d / 2;
  taperLegs(b, w - 0.02, d - hd, legH + 0.01, 0.07, 0.018, a, 0.004, hd / 2);
  rbox(b, w, 0.26, d - hd + 0.01, 0, legH, hd / 2 - 0.005, f, 0.035, 2);
  rbox(b, w + 0.02, h - 0.03, hd, 0, 0.03, zb + hd / 2, f, 0.04, 2);
  const groove = mat(shade(color, 0.62), { roughness: 1 });
  const n = Math.max(2, Math.round(w / (single ? 0.22 : 0.26)));
  const y0 = legH + 0.33;
  for (let i = 1; i < n; i++) b.box(0.009, h - y0 - 0.06, 0.006, -w / 2 + (w / n) * i, y0, zb + hd, groove);
  bedLinen(b, { w: w - 0.06, zBack: zb + hd + 0.01, zFront: d / 2 - 0.03, y: legH + 0.26, drop: 0.24, color, seed: single ? 5 : 3 });
}

function bedStorage(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, color: string) {
  // a box bed: two drawers on each long side, a wooden headboard with a capping shelf
  const hd = 0.05;
  const zb = -d / 2;
  const bh = 0.36;
  b.box(w - 0.06, 0.04, d - hd - 0.06, 0, 0, hd / 2, mat(shade(color, 0.45)));
  rbox(b, w, bh - 0.04, d - hd, 0, 0.04, hd / 2, f, 0.006, 1);
  const len = (d - hd - 0.16) / 2;
  const handle = handleOf(b, "bar");
  for (const sx of [-1, 1])
    for (let i = 0; i < 2; i++) {
      const z = zb + hd + 0.06 + len * (i + 0.5) + (i ? 0.04 : 0);
      b.box(0.004, bh - 0.12, len + 0.006, sx * (w / 2 + 0.001), 0.07, z, joint());
      rbox(b, 0.018, bh - 0.124, len, sx * (w / 2 + 0.009), 0.072, z, f, 0.003);
      const hy = 0.07 + (bh - 0.12) / 2;
      if (handle === "bar") barHandle(b, sx * (w / 2 + 0.018), hy, z, Math.min(0.3, len * 0.4), a, false, sx);
      else if (handle === "knob") b.sphere(0.016, sx * (w / 2 + 0.032), hy, z, a, 0.75, 1, 1, 10);
      else if (handle === "handleless") {
        b.box(0.004, 0.022, len - 0.02, sx * (w / 2 + 0.019), bh - 0.075, z, joint());
        b.box(0.007, 0.005, len - 0.02, sx * (w / 2 + 0.0205), bh - 0.08, z, mat("#a9adb2", { metalness: 0.7, roughness: 0.35 }));
      }
    }
  rbox(b, w + 0.04, h - 0.02, hd, 0, 0, zb + hd / 2, f, 0.006, 1);
  rbox(b, w + 0.08, 0.025, 0.16, 0, h - 0.025, zb + 0.08, f, 0.006, 1);
  bedLinen(b, { w: w - 0.04, zBack: zb + hd + 0.01, zFront: d / 2 - 0.02, y: bh, mh: 0.2, drop: 0.13, color });
}

// ----- cupboards -----

interface Cupboard {
  doors?: number;
  drawers?: number;
  columns?: number;
  mirror?: number[];
  top?: boolean;
  legs?: boolean;
  /** The piece's own handle on drawers: bars (default) or knobs; options.handle overrides it. */
  knobs?: boolean;
  /** A top slab overhanging the carcass instead of a cornice. */
  slab?: boolean;
  legH?: number;
}

/**
 * A cabinet: carcass on a recessed plinth (or legs), a cornice, doors and drawers with
 * dark gaps between them, bar handles on standoffs, mirrors set into doors.
 */
function cabinet(b: Builder, w: number, d: number, h: number, f: THREE.Material, a: THREE.Material, color: string, o: Cupboard) {
  const legH = o.legs ? (o.legH ?? Math.min(0.16, h * 0.12)) : 0;
  const plinth = o.legs ? 0 : Math.min(0.08, h * 0.08);
  const capH = o.slab ? 0.028 : Math.min(0.035, h * 0.03);
  const zf = d / 2 - 0.022;
  const zc = (-d / 2 + zf) / 2;
  if (o.legs) taperLegs(b, w - 0.02, d - 0.04, legH + 0.01, 0.045, 0.017, a, 0.012, -0.011);
  else b.box(w - 0.04, plinth, d - 0.07, 0, 0, zc - 0.02, mat(shade(color, 0.42), { roughness: 0.9 }));
  const y0 = legH + plinth;
  const y1 = h - capH;
  rbox(b, w, y1 - y0, zf + d / 2, 0, y0, zc, f, o.legs ? 0.008 : 0.002, 1);
  if (o.slab) rbox(b, w + 0.02, capH, d + 0.01, 0, y1, 0.005, f, 0.006, 1);
  else {
    rbox(b, w + 0.012, capH, d + 0.006, 0, y1, 0.003, f, 0.004, 1);
    b.box(w - 0.004, 0.004, 0.004, 0, y1 - 0.004, d / 2 - 0.001, joint());
  }
  // the fronts: dark behind, so the gaps between them read
  const g = 0.004;
  const fy0 = y0 + (o.legs ? 0.02 : 0.003);
  const fy1 = y1 - 0.003;
  b.box(w - 0.006, fy1 - fy0, 0.004, 0, fy0, zf + 0.002, joint());
  const doors = o.doors ?? Math.max(1, Math.round(w / 0.5));
  const drawers = o.drawers ?? 0;
  const topH = o.top ? Math.min(0.45, h * 0.18) : 0;
  const z = zf + 0.004;
  const handle = handleOf(b, o.knobs ? "knob" : "bar");
  const panel = (x0: number, x1: number, ya: number, yb: number) => rbox(b, x1 - x0 - g, yb - ya - g, 0.018, (x0 + x1) / 2, ya + g / 2, z + 0.009, f, 0.003, 1);
  let y = fy0;
  if (drawers) {
    const dh = doors ? Math.min(drawers * 0.2, (fy1 - fy0) * 0.4) : fy1 - fy0;
    const cols = o.columns ?? (doors ? Math.max(1, Math.min(doors, Math.round(w / 0.8))) : 1);
    const cw = w / cols;
    // drawers from the bottom, the top ones a little shallower
    const weights = Array.from({ length: drawers }, (_, i) => (doors ? 1 : 1 + (drawers - 1 - i) * 0.08));
    const sum = weights.reduce((s, x) => s + x, 0);
    let ry = y;
    for (let r = 0; r < drawers; r++) {
      const rh = (dh * weights[r]) / sum;
      for (let c = 0; c < cols; c++) {
        const x0 = -w / 2 + cw * c;
        panel(x0, x0 + cw, ry, ry + rh);
        if (handle === "knob") knob(b, x0 + cw / 2, ry + rh / 2, z + 0.018, a);
        else if (handle === "bar") barHandle(b, x0 + cw / 2, ry + rh * 0.55, z + 0.018, Math.min(0.24, cw * 0.4), a, false);
        else if (handle === "handleless") gripRail(b, x0 + cw / 2, ry + rh - g, z + 0.018, cw - g - 0.02, false);
      }
      ry += rh;
    }
    y += dh;
  }
  if (doors) {
    const dh = fy1 - y - topH;
    const cw = w / doors;
    const hy = Math.max(y + 0.3, Math.min(y + dh - 0.25, 1.05));
    const hl = Math.min(0.32, dh * 0.22);
    for (let i = 0; i < doors; i++) {
      const x0 = -w / 2 + cw * i;
      panel(x0, x0 + cw, y, y + dh);
      // handles meet in pairs; a single door opens from its right, the odd last from its left
      const right = doors === 1 || (i % 2 === 0 && i < doors - 1);
      const hx = right ? x0 + cw - 0.045 : x0 + 0.045;
      if (handle === "knob") knob(b, hx, hy - hl / 2, z + 0.018, a);
      else if (handle === "bar") barHandle(b, hx, hy, z + 0.018, hl, a, true);
      else if (handle === "handleless") gripRail(b, right ? x0 + cw - g / 2 - 0.013 : x0 + g / 2 + 0.013, y + dh - 0.05, z + 0.018, dh - 0.1, true);
      if (o.mirror?.includes(i)) {
        const mw = cw - 0.11;
        b.box(mw + 0.012, dh - 0.2 + 0.012, 0.003, x0 + cw / 2 + (right ? -0.012 : 0.012), y + 0.094, z + 0.0185, mat(shade(color, 0.75)));
        b.box(mw, dh - 0.2, 0.004, x0 + cw / 2 + (right ? -0.012 : 0.012), y + 0.1, z + 0.019, mirrorMat());
      }
    }
    y += dh;
  }
  if (topH) {
    const cw = w / doors;
    for (let i = 0; i < doors; i++) {
      const x0 = -w / 2 + cw * i;
      panel(x0, x0 + cw, y, fy1);
      if (handle === "knob") knob(b, x0 + cw / 2, y + 0.05, z + 0.018, a);
      else if (handle === "bar") barHandle(b, x0 + cw / 2, y + 0.05, z + 0.018, Math.min(0.14, cw * 0.3), a, false);
      else if (handle === "handleless") gripRail(b, x0 + cw / 2, fy1 - g, z + 0.018, cw - g - 0.02, false);
    }
  }
}


// ----- more helpers -----

/** A capsule from p to q (limbs, necks, rolls). */
function limb(b: Builder, p: THREE.Vector3, q: THREE.Vector3, r: number, m: THREE.Material, seg = 10) {
  const len = Math.max(0.001, p.distanceTo(q));
  const mesh = b.add(new THREE.CapsuleGeometry(r, len, 3, seg), m);
  mesh.position.copy(p).add(q).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(v(0, 1, 0), q.clone().sub(p).normalize());
  return mesh;
}

/** A rounded rectangle (w along x, d along z) as a slab t thick from y, with rounded plan corners and softened edges. */
function slab(b: Builder, w: number, d: number, t: number, x: number, y: number, z: number, m: THREE.Material, r: number, holes: THREE.Path[] = []) {
  const s = new THREE.Shape();
  const rr = Math.min(r, w / 2 - 0.001, d / 2 - 0.001);
  s.moveTo(-w / 2 + rr, -d / 2);
  s.lineTo(w / 2 - rr, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + rr);
  s.lineTo(w / 2, d / 2 - rr);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - rr, d / 2);
  s.lineTo(-w / 2 + rr, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - rr);
  s.lineTo(-w / 2, -d / 2 + rr);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + rr, -d / 2);
  s.holes.push(...holes);
  const bt = Math.min(0.004, t / 4);
  const geo = new THREE.ExtrudeGeometry(s, { depth: t - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 1, curveSegments: 4 });
  // the shape's y becomes z, the extrusion goes up
  geo.rotateX(Math.PI / 2);
  geo.translate(0, t - bt, 0);
  return b.add(geo, m, x, y, z);
}

/** A board standing upright in the yz plane (a chair back seen from the side), from an outline in (-z, y). */
function boardX(b: Builder, shape: THREE.Shape, t: number, x: number, m: THREE.Material) {
  const bt = Math.min(0.003, t / 4);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 1, curveSegments: 8 });
  geo.translate(0, 0, -(t - 2 * bt) / 2);
  geo.rotateY(Math.PI / 2);
  return b.add(geo, m, x, 0, 0);
}
/** The same, standing in the xy plane (a cot's end, a headboard). */
function boardZ(b: Builder, shape: THREE.Shape, t: number, z: number, m: THREE.Material) {
  const bt = Math.min(0.003, t / 4);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 1, curveSegments: 8 });
  geo.translate(0, 0, -(t - 2 * bt) / 2);
  return b.add(geo, m, 0, 0, z);
}
const circlePath = (x: number, y: number, r: number) => {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, true);
  return p;
};
const heartPath = (x: number, y: number, s: number) => {
  const p = new THREE.Path();
  p.moveTo(x, y - s);
  p.bezierCurveTo(x + s * 0.2, y - s * 0.7, x + s * 1.1, y - s * 0.15, x + s * 0.95, y + s * 0.35);
  p.bezierCurveTo(x + s * 0.8, y + s * 0.85, x + s * 0.2, y + s * 0.8, x, y + s * 0.35);
  p.bezierCurveTo(x - s * 0.2, y + s * 0.8, x - s * 0.8, y + s * 0.85, x - s * 0.95, y + s * 0.35);
  p.bezierCurveTo(x - s * 1.1, y - s * 0.15, x - s * 0.2, y - s * 0.7, x, y - s);
  return p;
};
const starShape = (r: number) => {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return s;
};

/** A grid of points (rows × cols, row-major) as a surface; front faces up when rows run +z and columns +x. */
function grid(b: Builder, pos: number[], cols: number, m: THREE.Material) {
  const rows = pos.length / 3 / cols;
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return b.add(geo, m);
}

/** Toy colours. */
const TOY = ["#e0533d", "#f2c84b", "#3f8fd2", "#5bb36a", "#e98bb0", "#8a63c7"];
/** A pastel that goes with a kids' piece's finish (linen, mats, appliqués). */
const PASTEL: Record<string, string> = { white: "#bcd7ea", oak: "#cfe3d2", green: "#f3e3b5", pink: "#d3eadf", blue: "#f3e3b5", walnut: "#e8d9bd", black: "#d8d2c6", beige: "#c98a6b", grey: "#e3b8b0" };

/** A teddy bear sitting at (x, y, z), s its height, facing +z turned by ry. */
function teddy(b: Builder, x: number, y: number, z: number, s: number, ry = 0) {
  const fur = mat("#b3835a", { roughness: 1 });
  const light = mat("#e6cfae", { roughness: 1 });
  const dark = mat("#2a201a", { roughness: 0.5 });
  const c = Math.cos(ry);
  const n = Math.sin(ry);
  const at = (dx: number, dy: number, dz: number) => v(x + dx * c + dz * n, y + dy * s, z - dx * n + dz * c);
  const S = (dx: number, dy: number, dz: number, r: number, m: THREE.Material, sy = 1) => {
    const p = at(dx * s, dy, dz * s);
    return b.sphere(r * s, p.x, p.y, p.z, m, 1, sy, 1, r > 0.05 ? 9 : 6);
  };
  S(0, 0.27, 0, 0.27, fur, 1.1);
  S(0, 0.28, 0.12, 0.17, light, 1.1);
  S(0, 0.72, 0.02, 0.22, fur);
  S(0, 0.67, 0.19, 0.09, light);
  S(0, 0.7, 0.275, 0.03, dark);
  for (const sx of [-1, 1]) {
    S(sx * 0.16, 0.9, -0.01, 0.08, fur);
    S(sx * 0.08, 0.77, 0.19, 0.022, dark);
    S(sx * 0.26, 0.38, 0.06, 0.09, fur, 1.4);
    S(sx * 0.14, 0.07, 0.2, 0.09, fur);
  }
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  bed: (b, w, d, h, f, c, a) => bedUpholstered(b, w, d, h, f, a, c, false),
  bed_single: (b, w, d, h, f, c, a) => bedUpholstered(b, w, d, h, f, a, c, true),
  bed_storage: (b, w, d, h, f, c, a) => bedStorage(b, w, d, h, f, a, c),
  bed_platform: (b, w, d, h, f, c) => {
    // a low platform wider and longer than the mattress, on a recessed dark base, a low headboard
    const zb = -d / 2;
    const hd = 0.06;
    b.box(w - 0.16, 0.06, d - 0.2, 0, 0, hd / 2, mat(C.black));
    rbox(b, w, 0.16, d - hd, 0, 0.06, hd / 2, f, 0.012, 1);
    rbox(b, w, h - 0.02, hd, 0, 0, zb + hd / 2, f, 0.01, 1);
    for (const y of [0.4, 0.52]) if (y < h - 0.06) b.box(w - 0.06, 0.006, 0.004, 0, y, zb + hd + 0.001, mat(shade(c, 0.55)));
    const mw = Math.min(w - 0.24, w * 0.9);
    bedLinen(b, { w: mw, zBack: zb + hd + 0.04, zFront: d / 2 - 0.14, y: 0.22, mh: 0.2, drop: 0.16, color: c });
  },
  bed_canopy: (b, w, d, h, f, c) => {
    // turned posts at the corners, rails on top with a pleated valance, curtains tied to the posts
    const zb = -d / 2;
    const p = 0.065;
    rbox(b, w - 0.04, 0.26, d - 0.04, 0, 0.1, 0, f, 0.01, 1);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - p / 2);
        const z = sz * (d / 2 - p / 2);
        b.cyl(p * 0.42, p * 0.5, h - 0.02, x, 0, z, f, 12);
        b.cyl(p * 0.55, p * 0.55, 0.06, x, 0.02, z, f, 12);
        b.sphere(p * 0.5, x, h - 0.03, z, f, 1, 0.8, 1, 10);
      }
    for (const sz of [-1, 1]) rbox(b, w - p, 0.05, 0.04, 0, h - 0.11, sz * (d / 2 - p / 2), f, 0.006, 1);
    for (const sx of [-1, 1]) rbox(b, 0.04, 0.05, d - p, sx * (w / 2 - p / 2), h - 0.11, 0, f, 0.006, 1);
    rbox(b, w - p, Math.min(1.05, h * 0.5), 0.045, 0, 0.12, zb + p / 2 + 0.015, f, 0.01, 1);
    bedLinen(b, { w: w - 0.16, zBack: zb + p + 0.02, zFront: d / 2 - 0.08, y: 0.36, drop: 0.24, color: c });
    const linen = clothMat("#efebe3");
    // the valance: pleats all around under the rails
    const valance = (len: number, x: number, z: number, along: "x" | "z") => {
      const n = Math.round(len / 0.05) * 2;
      const geo = new THREE.PlaneGeometry(len, 0.16, n, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, (i % 2 ? 1 : -1) * 0.008);
      geo.computeVertexNormals();
      if (along === "z") geo.rotateY(Math.PI / 2);
      b.add(geo, linen, x, h - 0.17, z);
    };
    for (const sz of [-1, 1]) valance(w - p * 2, 0, sz * (d / 2 - p / 2 + 0.025), "x");
    for (const sx of [-1, 1]) valance(d - p * 2, sx * (w / 2 - p / 2 + 0.025), 0, "z");
    // curtains on the long sides, gathered by a tie at each post
    const ch = h - 0.18;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const cw = 0.42;
        const geo = new THREE.PlaneGeometry(cw, ch, 10, 8);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const t = pos.getY(i) / ch + 0.5; // 0 at the hem, 1 at the top
          const tie = 0.5;
          const gather = t > tie ? 0.35 + 0.65 * smooth((t - tie) / (1 - tie)) : 0.35 + 0.4 * smooth((tie - t) / tie);
          const u = pos.getX(i) / cw + 0.5; // 0 at the post
          pos.setX(i, u * cw * gather);
          pos.setZ(i, Math.sin(u * Math.PI * 5) * 0.025 * (0.5 + gather));
        }
        geo.computeVertexNormals();
        geo.rotateY(sz > 0 ? Math.PI / 2 : -Math.PI / 2);
        b.add(geo, linen, sx * (w / 2 + 0.012), 0.02 + ch / 2, sz * (d / 2 - p * 0.6));
        b.add(new THREE.TorusGeometry(0.05, 0.008, 4, 12).rotateX(Math.PI / 2), mat(THROW[c] ?? "#a8603f"), sx * (w / 2 + 0.012), 0.02 + ch * 0.5, sz * (d / 2 - p * 0.6 - 0.06));
      }
  },
  bed_upholstered: (b, w, d, h, f, c, a) => {
    // a padded frame, a tall rounded headboard with a piped edge and buttons
    const zb = -d / 2;
    const hd = 0.13;
    taperLegs(b, w - 0.02, d - hd, 0.09, 0.07, 0.02, a, 0.004, hd / 2);
    rbox(b, w, 0.3, d - hd + 0.02, 0, 0.08, hd / 2 - 0.01, f, 0.05, 2);
    rbox(b, w + 0.08, h - 0.02, hd, 0, 0.02, zb + hd / 2, f, 0.06, 2);
    rbox(b, w - 0.04, h - 0.5, 0.03, 0, 0.44, zb + hd, f, 0.03, 2);
    const button = mat(shade(c, 0.6), { roughness: 0.9 });
    const cols = Math.max(3, Math.round(w / 0.22));
    const rows = Math.max(2, Math.round((h - 0.62) / 0.18));
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < cols - (r % 2); i++) {
        const x = -w / 2 + 0.06 + ((w - 0.12) / (cols - 1)) * (i + (r % 2) * 0.5);
        b.add(new THREE.SphereGeometry(0.011, 6, 4), button, x, 0.62 + r * ((h - 0.74) / Math.max(1, rows - 1)), zb + hd + 0.03);
      }
    bedLinen(b, { w: w - 0.08, zBack: zb + hd + 0.04, zFront: d / 2 - 0.04, y: 0.38, drop: 0.26, color: c });
  },
  wardrobe: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, {}),
  wardrobe_1door: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 1 }),
  wardrobe_2door: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 2 }),
  wardrobe_3door: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 3, mirror: [1] }),
  wardrobe_4door: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 4 }),
  wardrobe_drawers: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 2, drawers: 2 }),
  wardrobe_mirror: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 2, mirror: [0, 1] }),
  wardrobe_top: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { top: true }),
  wardrobe_legs: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 2, legs: true, drawers: 1 }),
  chest_tall: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 0, drawers: Math.max(3, Math.round(h / 0.2)), legs: true, slab: true }),
  chest_low: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 0, drawers: 3, columns: Math.max(1, Math.round(w / 0.8)), slab: true }),
  dresser: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 0, drawers: 3, columns: Math.max(1, Math.round(w / 0.6)), legs: true, slab: true, legH: Math.min(0.14, h * 0.17) }),
  nightstand: (b, w, d, h, f, c, a) => cabinet(b, w, d, h, f, a, c, { doors: 0, drawers: 2, legs: true, slab: true, knobs: true, legH: Math.min(0.16, h * 0.3) }),
  nightstand_wall: (b, w, d, h, f, _c, a) => {
    // a floating drawer box: the drawer front with a gap all round, a bar handle
    rbox(b, w, h, d - 0.02, 0, 0, -0.01, f, 0.004, 1);
    b.box(w - 0.03, h - 0.03, 0.004, 0, 0.015, d / 2 - 0.018, joint());
    rbox(b, w - 0.024, h - 0.024, 0.018, 0, 0.012, d / 2 - 0.009, f, 0.003, 1);
    barHandle(b, 0, h * 0.55, d / 2, Math.min(0.2, w * 0.4), a, false);
  },
  dressing_table: (b, w, d, h, f, _c, a) => {
    // a slim table on splayed legs, two drawers in its apron, a round tilting mirror on a stand
    const top = 0.028;
    const apron = Math.min(0.13, h * 0.18);
    const ya = h - top - apron;
    taperLegs(b, w - 0.03, d - 0.03, ya + 0.01, 0.04, 0.02, f, 0.025);
    rbox(b, w, top, d, 0, h - top, 0, f, 0.008, 1);
    rbox(b, w - 0.05, apron, d - 0.06, 0, ya, -0.01, f, 0.003, 1);
    const zf = (d - 0.06) / 2 - 0.01;
    b.box(w - 0.07, apron - 0.012, 0.004, 0, ya + 0.006, zf + 0.002, joint());
    const handle = handleOf(b, "knob");
    const dw = (w - 0.05) / 2;
    for (const sx of [-1, 1]) {
      const cx = (sx * dw) / 2;
      rbox(b, dw - 0.012, apron - 0.016, 0.016, cx, ya + 0.008, zf + 0.008, f, 0.003, 1);
      const fz = zf + 0.016;
      if (handle === "knob") knob(b, cx, ya + apron / 2, fz, a);
      else if (handle === "bar") barHandle(b, cx, ya + apron / 2, fz, Math.min(0.16, dw * 0.4), a, false);
      else if (handle === "handleless") gripRail(b, cx, ya + apron - 0.008, fz, dw - 0.04, false);
    }
    // the mirror stands on the table, above its height
    b.above(() => {
      const r = Math.min(0.19, w * 0.2);
      const zm = -d / 2 + 0.07;
      const cy = h + 0.06 + r;
      rbox(b, r * 2 + 0.12, 0.018, 0.1, 0, h, zm, a, 0.006, 1);
      for (const sx of [-1, 1]) {
        b.cyl(0.009, 0.011, cy - h, sx * (r + 0.035), h + 0.01, zm, a, 10);
        b.sphere(0.014, sx * (r + 0.035), cy + 0.012, zm, a, 1, 1, 1, 10);
        hcyl(b, 0.006, 0.03, sx * (r + 0.02), cy, zm, a, "x", 8);
      }
      b.add(new THREE.TorusGeometry(r, 0.013, 8, 48), a, 0, cy, zm);
      b.add(new THREE.CircleGeometry(r, 40), mirrorMat(), 0, cy, zm + 0.0055);
      b.cyl(r, r, 0.008, 0, cy - 0.004, zm, f, 40).rotation.x = Math.PI / 2;
      // a perfume bottle and a little dish
      const x = w / 2 - 0.14;
      b.cyl(0.022, 0.022, 0.07, x, h, 0.02, mat("#e9c7c9", { roughness: 0.15, metalness: 0.1 }), 12);
      b.cyl(0.008, 0.01, 0.025, x, h + 0.07, 0.02, a, 8);
      b.cyl(0.045, 0.03, 0.015, x - 0.1, h, 0.06, mat(C.ceramic, { roughness: 0.3 }), 16);
    });
  },
  wardrobe_sliding: (b, w, d, h, f, c, a) => {
    // a carcass on a plinth, two tracks, panels that overlap, framed in profiles of the accent;
    // every other panel a mirror, the wood ones split in three by thin profiles
    const plinth = 0.06;
    const cap = 0.035;
    const st = 0.02;
    rbox(b, w - 2 * st, h - plinth - cap, d - 0.09, 0, plinth, -0.045, f, 0.002, 1);
    b.box(w - 0.06, plinth, d - 0.1, 0, 0, -0.04, mat(shade(c, 0.42), { roughness: 0.9 }));
    for (const sx of [-1, 1]) rbox(b, st, h - cap, d, sx * (w / 2 - st / 2), 0, 0, f, 0.003, 1);
    rbox(b, w + 0.01, cap, d + 0.006, 0, h - cap, 0.003, f, 0.004, 1);
    b.box(w - 0.004, 0.004, 0.004, 0, h - cap - 0.004, d / 2 + 0.002, joint());
    const wi = w - 2 * st;
    const yt = h - cap - 0.03;
    b.box(wi, 0.03, 0.085, 0, yt, d / 2 - 0.0425, a);
    b.box(wi, 0.02, 0.085, 0, plinth - 0.02, d / 2 - 0.0425, a);
    const n = Math.max(2, Math.round(wi / 1));
    const pw = wi / n + 0.03;
    const ph = yt - plinth - 0.004;
    const prof = 0.026;
    for (let i = 0; i < n; i++) {
      const x = -wi / 2 + pw / 2 + (i * (wi - pw)) / (n - 1);
      const z = d / 2 - (i % 2 ? 0.062 : 0.022);
      const y0 = plinth + 0.002;
      // the profiles all round
      for (const sx of [-1, 1]) rbox(b, prof, ph, 0.03, x + sx * (pw / 2 - prof / 2), y0, z, a, 0.004, 1);
      for (const y of [y0, y0 + ph - prof]) b.box(pw - 2 * prof, prof, 0.026, x, y, z, a);
      const iw = pw - 2 * prof;
      const ih = ph - 2 * prof;
      if (i % 2 === 1) {
        b.box(iw, ih, 0.012, x, y0 + prof, z, f);
        b.box(iw - 0.002, ih - 0.002, 0.004, x, y0 + prof + 0.001, z + 0.007, mirrorMat());
      } else {
        b.box(iw, ih, 0.016, x, y0 + prof, z, f);
        for (const k of [1, 2]) b.box(iw, 0.012, 0.02, x, y0 + prof + (ih * k) / 3 - 0.006, z, a);
      }
    }
  },
  wardrobe_open: (b, w, d, h, f) => {
    // an open rack: square posts, a hat shelf with boxes, a rail with clothes on hangers,
    // a shoe shelf with pairs of shoes
    const t = 0.03;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) rbox(b, t, h, t, sx * (w / 2 - t / 2), 0, sz * (d / 2 - t / 2), f, 0.004, 1);
    for (const sz of [-1, 1]) for (const y of [h - t, 0.04]) b.box(w - 2 * t, t, t, 0, y, sz * (d / 2 - t / 2), f);
    for (const sx of [-1, 1]) for (const y of [h - t, 0.04]) b.box(t, t, d - 2 * t, sx * (w / 2 - t / 2), y, 0, f);
    const ys = h - 0.34;
    b.box(w - 2 * t, 0.022, d - 0.01, 0, ys, 0, f);
    b.box(w - 2 * t, 0.022, d - 0.01, 0, 0.14, 0, f);
    const chrome = mat(C.chrome, { metalness: 0.75, roughness: 0.25 });
    const yr = ys - 0.07;
    hcyl(b, 0.012, w - 2 * t, 0, yr, 0, chrome, "x", 12);
    for (const sx of [-1, 1]) b.box(0.03, 0.07, 0.02, sx * (w / 2 - t - 0.015), yr - 0.01, 0, chrome);
    // clothes: shirts, jackets, dresses, each on a hanger
    const rand = random(Math.round(w * 100) + 11);
    const wire = mat("#8e9398", { metalness: 0.6, roughness: 0.35 });
    const hangerWood = mat("#b68b5e", { roughness: 0.7 });
    let x = -w / 2 + t + 0.07;
    const gd = Math.min(0.46, d - 0.08);
    while (x < w / 2 - t - 0.06) {
      const kind = rand();
      const len = kind < 0.3 ? 0.62 + rand() * 0.12 : kind < 0.7 ? 0.85 + rand() * 0.15 : 1.0 + rand() * 0.25;
      const len2 = Math.min(len, yr - 0.2 - 0.14);
      const th = 0.025 + rand() * 0.03;
      const geo = new THREE.BoxGeometry(th, len2, gd, 1, 2, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / len2 + 0.5; // 0 at the hem
        const z = pos.getZ(i);
        // sloping shoulders, a dress flares towards the hem
        if (y > 0.99) pos.setY(i, pos.getY(i) - Math.abs(z) * 0.32);
        const flare = kind > 0.7 ? 1 + 0.12 * (1 - y) : 1;
        pos.setZ(i, z * (y > 0.99 ? 0.92 : flare));
      }
      geo.computeVertexNormals();
      const yTop = yr - 0.045;
      const ry = (rand() - 0.5) * 0.12;
      b.batch(geo, mat(C.clothes[Math.floor(rand() * C.clothes.length)], { roughness: 1 }), matrix(x, yTop - len2 / 2, 0, 0, ry, 0));
      // the hanger: a hook over the rail, a bar across the shoulders
      const hook = new THREE.TorusGeometry(0.016, 0.0025, 3, 6, Math.PI * 1.3);
      hook.rotateY(Math.PI / 2);
      b.batch(hook, wire, matrix(x, yr, 0, 0, 0, 0));
      b.batch(new THREE.CylinderGeometry(0.0025, 0.0025, 0.04, 4), wire, matrix(x, yr - 0.03, 0));
      b.batch(new THREE.BoxGeometry(0.012, 0.02, gd * 0.9), hangerWood, matrix(x, yTop + 0.005, 0, 0, ry, 0));
      x += th + 0.03 + rand() * 0.03;
    }
    // shoes in pairs
    const pairs = Math.max(1, Math.floor((w - 2 * t - 0.04) / 0.24));
    for (let i = 0; i < pairs; i++) {
      const sm = mat(["#3b2a20", "#e8e4dc", "#2f3e55", "#8a3b3b", "#5b6b58"][i % 5], { roughness: 0.6 });
      const cx = -w / 2 + t + 0.02 + ((w - 2 * t - 0.04) / pairs) * (i + 0.5);
      const boot = i % 3 === 1;
      for (const dx of [-0.045, 0.045]) {
        b.batch(new RoundedBoxGeometry(0.08, 0.06, 0.26, 1, 0.025), sm, matrix(cx + dx, 0.162 + 0.03, 0.02, 0, dx * 0.6, 0));
        if (boot) b.batch(new RoundedBoxGeometry(0.075, 0.14, 0.1, 1, 0.025), sm, matrix(cx + dx, 0.162 + 0.1, -0.06, 0, dx * 0.6, 0));
      }
    }
    // boxes on the hat shelf
    const boxes = Math.max(1, Math.floor((w - 2 * t) / 0.42));
    for (let i = 0; i < boxes; i++) {
      const cx = -w / 2 + t + ((w - 2 * t) / boxes) * (i + 0.5);
      const bm = mat(["#d9d4c7", "#c9a47c", "#8d9299", "#b9c4b0"][i % 4], { roughness: 0.9 });
      const bh = Math.min(0.2, h - t - ys - 0.06);
      rbox(b, 0.34, bh - 0.02, d * 0.72, cx, ys + 0.022, 0, bm, 0.008, 1);
      rbox(b, 0.35, 0.03, d * 0.72 + 0.01, cx, ys + 0.022 + bh - 0.03, 0, bm, 0.008, 1);
      b.box(0.08, 0.025, 0.004, cx, ys + 0.022 + bh * 0.45, d * 0.36 + 0.001, joint());
    }
  },
  slide: (b, w, d, h, f, c, a) => {
    // a ladder with flat steps up the back, a platform with side guards and handrails,
    // a chute with raised, rolled edges curving down to a flat run-out
    const zb = -d / 2;
    const top = Math.min(h * 0.62, 1.0);
    const hx = w / 2 - 0.03;
    const zl = zb + 0.03;
    const lean = 0.2;
    const zp = zb + 0.6;
    const tube = 0.022;
    // the ladder rails go on up as handrails, the front posts likewise
    for (const sx of [-1, 1]) {
      b.rod(v(sx * hx, 0, zl), v(sx * hx, h - 0.03, zl + lean), tube, a, 10);
      b.rod(v(sx * hx, 0, zp), v(sx * hx, h - 0.03, zp), tube, a, 10);
      b.rod(v(sx * hx, h - 0.03, zl + lean), v(sx * hx, h - 0.03, zp), tube, a, 10);
      b.sphere(tube, sx * hx, h - 0.03, zl + lean, a, 1, 1, 1, 10);
      b.sphere(tube, sx * hx, h - 0.03, zp, a, 1, 1, 1, 10);
      // a guard panel between the handrail and the platform
      rbox(b, 0.018, h - 0.07 - top - 0.06, zp - zl - lean - 0.04, sx * (hx - 0.01), top + 0.05, (zl + lean + zp) / 2 + 0.01, f, 0.008, 1);
    }
    const steps = Math.max(3, Math.round(top / 0.25));
    for (let i = 1; i < steps; i++) {
      const y = (top * i) / steps;
      rbox(b, 2 * hx - 0.02, 0.025, 0.09, 0, y - 0.0125, zl + (lean * y) / (h - 0.03) + 0.03, f, 0.006, 1);
    }
    rbox(b, 2 * hx + 0.02, 0.035, zp - zl + 0.02, 0, top - 0.035, (zl + zp) / 2 + 0.02, f, 0.008, 1);
    // the chute
    const hw = w / 2 - 0.04;
    const z0 = zp + 0.02;
    const z1 = d / 2 - 0.02;
    const run = Math.min(0.4, (z1 - z0) * 0.22);
    const curve = new THREE.CubicBezierCurve3(v(0, top - 0.02, z0), v(0, top * 0.72, z0 + (z1 - z0) * 0.3), v(0, 0.14, z1 - run - (z1 - z0) * 0.3), v(0, 0.12, z1 - run));
    const path = [...curve.getPoints(22), v(0, 0.12, z1 - run * 0.5), v(0, 0.12, z1)];
    const profile: [number, number][] = [[-hw, 0.13], [-hw, 0.06], [-hw + 0.02, 0.012], [-hw + 0.05, 0], [hw - 0.05, 0], [hw - 0.02, 0.012], [hw, 0.06], [hw, 0.13]];
    const pos: number[] = [];
    const lips: THREE.Vector3[][] = [[], []];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const tg = path[Math.min(path.length - 1, i + 1)].clone().sub(path[Math.max(0, i - 1)]).normalize();
      const n = v(0, tg.z, -tg.y);
      for (const [px, pu] of profile) pos.push(px, p.y + n.y * pu, p.z + n.z * pu);
      lips[0].push(v(-hw, p.y + n.y * 0.13, p.z + n.z * 0.13));
      lips[1].push(v(hw, p.y + n.y * 0.13, p.z + n.z * 0.13));
    }
    const chute = mat(FINISHES[c] ?? "#4d6a88", { side: THREE.DoubleSide, roughness: 0.35 });
    grid(b, pos, profile.length, chute);
    const rim = mat(FINISHES[c] ?? "#4d6a88", { roughness: 0.35 });
    for (const lip of lips) {
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lip), 40, 0.018, 8), rim);
      for (const e of [lip[0], lip[lip.length - 1]]) b.sphere(0.018, e.x, e.y, e.z, rim, 1, 1, 1, 10);
    }
    // feet under the run-out and the middle of the chute
    for (const sx of [-1, 1]) {
      b.rod(v(sx * (hw - 0.06), 0, z1 - 0.08), v(sx * (hw - 0.06), 0.12, z1 - 0.08), 0.018, a, 8);
      const m = curve.getPoint(0.55);
      b.rod(v(sx * (hw - 0.06), 0, m.z), v(sx * (hw - 0.06), m.y, m.z), 0.018, a, 8);
    }
  },
  play_kitchen: (b, w, d, h, f, c, a) => {
    // a little kitchen: an oven with a window, knobs, a cupboard, a hob and a sink in the
    // worktop, a back panel with a shelf of jars, a clock and a rail of pans
    const zb = -d / 2;
    const top = Math.min(h * 0.55, 0.55);
    const wt = 0.025;
    const bt = 0.025;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.018, 0.015, 0.03, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), mat(shade(c, 0.5)), 10);
    rbox(b, w, top - wt - 0.03, d - bt, 0, 0.03, bt / 2, f, 0.012, 2);
    slab(b, w + 0.02, d + 0.005, wt, 0, top - wt, 0.0025, a, 0.02);
    const panelH = h - top;
    rbox(b, w, panelH + 0.01, bt, 0, top - 0.01, zb + bt / 2, f, 0.012, 2);
    const zf = d / 2;
    const ow = w * 0.5;
    const ox = -w / 2 + ow / 2 + 0.02;
    const yb = 0.06;
    const oh = top - wt - 0.03 - yb - 0.08;
    // the oven door: a frame with a dark window and a bar
    rbox(b, ow - 0.02, oh, 0.016, ox, yb, zf + 0.004, f, 0.006, 1);
    rbox(b, ow - 0.1, oh - 0.12, 0.006, ox, yb + 0.04, zf + 0.013, mat("#2f3a40", { roughness: 0.08, metalness: 0.2 }), 0.004, 1);
    const chrome = mat(C.chrome, { metalness: 0.8, roughness: 0.25 });
    hcyl(b, 0.008, ow * 0.6, ox, yb + oh - 0.035, zf + 0.035, chrome, "x", 10);
    for (const sx of [-1, 1]) hcyl(b, 0.005, 0.025, ox + sx * ow * 0.27, yb + oh - 0.035, zf + 0.022, chrome, "z", 6);
    // knobs above the oven
    for (let i = 0; i < 3; i++) {
      const kx = ox + (i - 1) * 0.075;
      hcyl(b, 0.02, 0.016, kx, top - wt - 0.045, zf + 0.008, mat(TOY[i]), "z", 14);
      b.box(0.006, 0.022, 0.004, kx, top - wt - 0.056, zf + 0.017, mat(C.ceramic));
    }
    // the cupboard under the sink
    const cx = (ox + ow / 2 + w / 2) / 2;
    const cw = w / 2 - (ox + ow / 2) - 0.01;
    rbox(b, cw - 0.01, oh + 0.06, 0.016, cx + 0.005, yb, zf + 0.004, f, 0.006, 1);
    knob(b, cx - cw / 2 + 0.05, yb + oh * 0.6, zf + 0.012, mat(TOY[3]), 0.018);
    // the hob: two plates with rings
    const ring = mat(C.black, { roughness: 0.6 });
    for (const [dx, dz, r] of [[-0.08, 0.04, 0.06], [0.06, -0.04, 0.05]] as const) {
      b.cyl(r, r, 0.008, ox + dx * (w / 0.85), top, dz * (d / 0.32), mat("#3a3c40", { roughness: 0.5 }), 20);
      b.add(new THREE.TorusGeometry(r * 0.7, 0.005, 4, 20).rotateX(Math.PI / 2), mat("#d9563f", { roughness: 0.6 }), ox + dx * (w / 0.85), top + 0.009, dz * (d / 0.32));
    }
    void ring;
    // the sink: a steel bowl and a tap
    const sxp = cx;
    const steel = mat(C.steel, { metalness: 0.75, roughness: 0.25 });
    const r = Math.min(0.1, cw * 0.4, d * 0.3);
    const bowl = new THREE.LatheGeometry([[0.0001, 0], [r * 0.86, 0], [r, 0.05], [r * 0.9, 0.05], [r * 0.72, 0.012], [0.0001, 0.012]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
    bowl.computeVertexNormals();
    b.add(bowl, steel, sxp, top, 0.02);
    b.cyl(0.012, 0.014, 0.06, sxp, top, zb + bt + 0.03, steel, 10);
    const spout = new THREE.CatmullRomCurve3([v(0, 0.06, 0), v(0, 0.12, 0.01), v(0, 0.13, 0.06), v(0, 0.1, 0.09)]);
    b.add(new THREE.TubeGeometry(spout, 10, 0.009, 8), steel, sxp, top, zb + bt + 0.03);
    b.sphere(0.0095, sxp, top + 0.1, zb + bt + 0.12, steel, 1, 1, 1, 8);
    for (const sx of [-1, 1]) b.cyl(0.012, 0.012, 0.02, sxp + sx * 0.05, top, zb + bt + 0.03, mat(sx < 0 ? "#3f8fd2" : "#e0533d"), 10);
    // the back panel: a shelf with jars, a clock, a rail with a pan and a spatula
    const ysh = h - 0.14;
    const zp = zb + bt;
    const shL = -w / 2 + 0.04;
    const shR = Math.max(shL + 0.36, w / 2 - 0.26);
    b.box(shR - shL, 0.018, 0.08, (shL + shR) / 2, ysh, zp + 0.04, f);
    for (const x of [shL + 0.04, shR - 0.04]) b.box(0.015, 0.05, 0.07, x, ysh - 0.05, zp + 0.035, f);
    for (let i = 0; i < 4; i++) {
      const jx = -w / 2 + 0.12 + i * 0.075;
      b.cyl(0.022, 0.022, 0.06, jx, ysh + 0.018, zp + 0.04, mat(TOY[(i + 1) % TOY.length], { roughness: 0.4 }), 12);
      b.cyl(0.024, 0.024, 0.014, jx, ysh + 0.078, zp + 0.04, mat(C.ceramic), 12);
    }
    const cr = Math.min(0.07, w * 0.08);
    const clockX = w / 2 - 0.15;
    const clockY = ysh + 0.02;
    b.cyl(cr, cr, 0.015, clockX, clockY - 0.0075, zp + 0.0075, mat(C.ceramic), 24).rotation.x = Math.PI / 2;
    b.add(new THREE.TorusGeometry(cr, 0.008, 6, 24), mat(TOY[0]), clockX, clockY, zp + 0.015);
    b.box(0.006, cr * 0.6, 0.004, clockX, clockY, zp + 0.017, mat(C.black));
    b.box(cr * 0.45, 0.006, 0.004, clockX + cr * 0.22, clockY, zp + 0.017, mat(C.black));
    const yRail = top + panelH * 0.45;
    hcyl(b, 0.007, w * 0.6, 0, yRail, zp + 0.03, chrome, "x", 10);
    for (const sx of [-1, 1]) hcyl(b, 0.005, 0.03, sx * w * 0.28, yRail, zp + 0.015, chrome, "z", 6);
    // a pan hanging by its handle, a spatula, a ladle
    const px = -w * 0.15;
    b.box(0.014, 0.12, 0.008, px, yRail - 0.12, zp + 0.035, mat("#3a3c40"));
    b.cyl(0.07, 0.065, 0.03, px, yRail - 0.19, zp + 0.035, mat("#d9563f", { roughness: 0.5 }), 20).rotation.x = Math.PI / 2;
    b.box(0.012, 0.13, 0.006, w * 0.05, yRail - 0.13, zp + 0.035, mat(TOY[1]));
    b.box(0.045, 0.06, 0.008, w * 0.05, yRail - 0.19, zp + 0.035, mat(TOY[1]));
    b.box(0.01, 0.13, 0.006, w * 0.18, yRail - 0.13, zp + 0.035, chrome);
    b.sphere(0.03, w * 0.18, yRail - 0.15, zp + 0.035, chrome, 1, 0.7, 1, 12);
  },
  crib: (b, w, d, h, f, c) => {
    // a cot: turned posts, solid ends with an arched top and a heart, slatted sides,
    // a mattress in a fitted sheet, a pillow, a folded blanket and a teddy bear
    const p = 0.045;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - p / 2);
        const z = sz * (d / 2 - p / 2);
        rbox(b, p, h - 0.045, p, x, 0, z, f, 0.008, 1);
        b.cyl(p * 0.3, p * 0.4, 0.02, x, h - 0.05, z, f, 10);
        b.sphere(p * 0.5, x, h - p * 0.5, z, f, 1, 1, 1, 10);
      }
    const inner = w - 2 * p;
    const yb = 0.16;
    const yt = h - 0.11;
    for (const sz of [-1, 1]) {
      const s = new THREE.Shape();
      s.moveTo(-inner / 2 - 0.004, yb);
      s.lineTo(inner / 2 + 0.004, yb);
      s.lineTo(inner / 2 + 0.004, yt);
      s.quadraticCurveTo(0, h + 0.03, -inner / 2 - 0.004, yt);
      s.lineTo(-inner / 2 - 0.004, yb);
      s.holes.push(heartPath(0, yt - 0.06, Math.min(0.05, inner * 0.09)));
      boardZ(b, s, 0.018, sz * (d / 2 - p / 2), f);
    }
    // the long sides: rails top and bottom, round slats
    const zs = d - 2 * p;
    const ylo = 0.2;
    const yhi = h - 0.07;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - p / 2);
      rbox(b, 0.032, 0.04, zs + 0.01, x, ylo - 0.04, 0, f, 0.008, 1);
      rbox(b, 0.036, 0.04, zs + 0.01, x, yhi, 0, f, 0.012, 1);
      const n = Math.max(4, Math.round(zs / 0.075));
      for (let i = 1; i < n; i++) b.cyl(0.011, 0.011, yhi - ylo + 0.02, x, ylo - 0.01, -zs / 2 + (zs * i) / n, f, 7);
    }
    // the bed: base, mattress with a fitted sheet, a pillow, a blanket, a bear
    b.box(inner, 0.02, zs, 0, ylo - 0.06, 0, f);
    const ym = ylo - 0.04;
    const mw = inner - 0.012;
    rbox(b, mw, 0.1, zs - 0.012, 0, ym, 0, mat(PASTEL[c] === "#bcd7ea" ? "#f4f1ea" : "#f6f3ec", { roughness: 1 }), 0.03, 1);
    const linen = mat(PASTEL[c] ?? "#bcd7ea", { roughness: 1 });
    pillow(b, mw * 0.6, 0.06, 0.24, 0, ym + 0.12, -zs / 2 + 0.17, mat(C.pillow, { roughness: 1 }), 0, 0, 12);
    pillow(b, mw - 0.03, 0.05, zs * 0.42, 0, ym + 0.115, zs * 0.22, linen, 0, 0, 14);
    teddy(b, inner * 0.18, ym + 0.13, zs / 2 - 0.14, Math.min(0.2, h * 0.22), -0.5);
  },
  bunk_bed: (b, w, d, h, f, c) => {
    // two beds between square posts, panelled ends, a guard rail round the top bunk and a
    // ladder on the open side at the foot end
    const p = 0.07;
    const xp = w / 2 - p / 2;
    const zp = d / 2 - p / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbox(b, p, h, p, sx * xp, 0, sz * zp, f, 0.012, 1);
    const lower = 0.24;
    const upper = Math.max(lower + 0.8, Math.min(h * 0.62, h - 0.5));
    const inner = d - 2 * p;
    const zl0 = d / 2 - p - 0.46;
    const zl1 = d / 2 - p - 0.04;
    for (const [y, duvet, seed] of [[lower, "#b9d3e6", 3], [upper, "#f2c9a6", 5]] as const) {
      // side rails, end rails, the slatted base
      for (const sx of [-1, 1]) b.box(0.028, 0.15, inner + 0.01, sx * (xp - 0.005), y - 0.12, 0, f);
      for (const sz of [-1, 1]) b.box(w - 2 * p + 0.01, 0.15, 0.028, 0, y - 0.12, sz * (zp - 0.005), f);
      b.box(w - 2 * p, 0.02, inner, 0, y - 0.06, 0, mat(shade(c, 0.6)));
      bedLinen(b, { w: w - 2 * p - 0.02, zBack: -d / 2 + p + 0.01, zFront: d / 2 - p - 0.01, y: y - 0.04, mh: 0.15, drop: 0.07, color: c, pillows: 1, duvet, seed, step: 0.17 });
    }
    // the ends: panels between the posts below each bed's head and foot
    for (const sz of [-1, 1]) {
      b.box(w - 2 * p + 0.01, 0.22, 0.022, 0, lower + 0.08, sz * zp, f);
      b.box(w - 2 * p + 0.01, Math.min(0.26, h - upper - 0.12), 0.022, 0, upper + 0.08, sz * zp, f);
    }
    // guard rails on the long sides of the top bunk; the ladder side leaves an opening
    const yg = h - 0.06;
    for (const sx of [-1, 1]) {
      const z0 = -d / 2 + p;
      const z1 = sx > 0 ? zl0 : d / 2 - p;
      for (const y of [yg, (yg + upper + 0.03) / 2]) rbox(b, 0.03, 0.05, z1 - z0, sx * xp, y - 0.025, (z0 + z1) / 2, f, 0.008, 1);
      if (sx > 0) rbox(b, 0.03, yg - upper + 0.03, 0.04, xp, upper - 0.03, z1 - 0.02, f, 0.008, 1);
    }
    // the ladder: two rails in front of the side rails, round rungs
    const xl = w / 2 - 0.016;
    for (const z of [zl0, zl1]) rbox(b, 0.032, h - 0.02, 0.05, xl, 0, z, f, 0.008, 1);
    for (let y = 0.3; y < upper + 0.1; y += 0.27) hcyl(b, 0.016, zl1 - zl0, xl, y, (zl0 + zl1) / 2, f, "z", 10);
  },
  changing_table: (b, w, d, h, f, c, a) => {
    // a chest of three drawers, on top a tray with raised sides: a padded mat with rolled
    // edges on one side, a compartment with nappies, wipes and a lotion on the other
    const tray = Math.min(0.12, h * 0.12);
    cabinet(b, w, d, h - tray, f, a, c, { doors: 0, drawers: 3, slab: true, knobs: true });
    const y = h - tray;
    const t = 0.018;
    rbox(b, w + 0.02, tray, t, 0, y, -d / 2 + t / 2 - 0.0, f, 0.006, 1);
    for (const sx of [-1, 1]) rbox(b, t, tray, d + 0.01, sx * (w / 2 + 0.01 - t / 2), y, 0.005, f, 0.006, 1);
    rbox(b, w + 0.02 - 2 * t, tray * 0.4, t, 0, y, d / 2 + 0.005 - t / 2, f, 0.006, 1);
    const cw = Math.min(0.2, w * 0.25);
    const xd = w / 2 + 0.01 - t - cw;
    rbox(b, t * 0.8, tray * 0.7, d - t, xd, y, 0.005, f, 0.005, 1);
    // the mat
    const mw = xd - (-w / 2 + 0.01 + t) - 0.01;
    const mx = (xd + (-w / 2 + 0.01 + t)) / 2;
    const md = d - 2 * t - 0.01;
    const pad = mat(PASTEL[c] ?? "#bcd7ea", { roughness: 1 });
    pillow(b, mw - 0.02, 0.045, md - 0.04, mx, y + 0.03, 0, pad, 0, 0, 16);
    for (const sz of [-1, 1]) limb(b, v(mx - mw / 2 + 0.04, y + 0.045, sz * (md / 2 - 0.035)), v(mx + mw / 2 - 0.04, y + 0.045, sz * (md / 2 - 0.035)), 0.035, pad, 10);
    // nappies, wipes, a lotion bottle
    const cxp = xd + cw / 2;
    const white = mat("#f4f2ee", { roughness: 0.9 });
    for (let i = 0; i < 3; i++) rbox(b, cw - 0.05, 0.025, 0.13, cxp, y + i * 0.026, -d / 2 + 0.11, white, 0.008, 1);
    rbox(b, cw - 0.06, 0.05, 0.1, cxp, y, 0.02, mat("#8fc1d9", { roughness: 0.5 }), 0.012, 1);
    b.cyl(0.025, 0.025, Math.min(0.13, tray + 0.04), cxp, y, d / 2 - 0.09, mat("#f2c84b", { roughness: 0.4 }), 12);
    b.cyl(0.012, 0.016, 0.025, cxp, y + Math.min(0.13, tray + 0.04), d / 2 - 0.09, white, 10);
  },
  toy_box: (b, w, d, h, f, c) => {
    // a chest with a rounded lid, cut-out grips at the sides, stars on the front, toys on the lid
    const bh = h * 0.76;
    const lid = 0.045;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sphere(0.02, sx * (w / 2 - 0.05), 0.02, sz * (d / 2 - 0.05), mat(shade(c, 0.55)), 1, 1, 1, 10);
    rbox(b, w - 0.01, bh - lid - 0.02, d - 0.01, 0, 0.02, 0, f, 0.025, 2);
    rbox(b, w + 0.01, lid, d + 0.01, 0, bh - lid, 0, f, 0.02, 2);
    b.box(w - 0.04, 0.006, 0.004, 0, bh - lid - 0.003, d / 2 - 0.004, joint());
    const deco = mat(PASTEL[c] === "#bcd7ea" ? "#f2c84b" : "#f4f2ee", { roughness: 0.7 });
    rbox(b, w - 0.008, 0.03, d - 0.008, 0, 0.06, 0, deco, 0.012, 1);
    for (const sx of [-1, 1]) rbox(b, 0.008, 0.035, 0.12, sx * (w / 2 - 0.007), bh - lid - 0.09, 0, joint(), 0.004, 1);
    // stars and dots on the front
    const n = Math.max(1, Math.round(w / 0.25));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const geo = new THREE.ExtrudeGeometry(starShape(Math.min(0.06, (bh - lid) * 0.2)), { depth: 0.008, bevelEnabled: false });
      geo.rotateZ((i - (n - 1) / 2) * 0.25);
      b.add(geo, mat(TOY[(i * 2) % TOY.length], { roughness: 0.6 }), x, (bh - lid) * 0.58, d / 2 - 0.007);
      if (i < n - 1) b.add(new THREE.CircleGeometry(0.018, 14), mat(TOY[(i * 2 + 1) % TOY.length]), x + w / n / 2, (bh - lid) * 0.38, d / 2 - 0.004);
    }
    // a ball and two blocks on the lid
    const br = Math.min(0.06, (h - bh) * 0.5);
    b.sphere(br, -w * 0.28, bh + br, d * 0.06, mat("#e0533d", { roughness: 0.4 }), 1, 1, 1, 16);
    b.add(new THREE.TorusGeometry(br * 1.0, br * 0.12, 6, 20), mat("#f4f2ee", { roughness: 0.4 }), -w * 0.28, bh + br, d * 0.06).rotation.y = 0.6;
    const bs = Math.min(0.06, (h - bh) * 0.5);
    rbox(b, bs, bs, bs, w * 0.12, bh, -d * 0.1, mat(TOY[2], { roughness: 0.5 }), 0.006, 1)?.rotation.set(0, 0.4, 0);
    rbox(b, bs, bs, bs, w * 0.22, bh, d * 0.12, mat(TOY[1], { roughness: 0.5 }), 0.006, 1)?.rotation.set(0, -0.3, 0);
    rbox(b, bs * 0.9, bs * 0.9, bs * 0.9, w * 0.17, bh + bs, 0.0, mat(TOY[3], { roughness: 0.5 }), 0.006, 1)?.rotation.set(0, 0.9, 0);
  },
  rocking_horse: (b, w, d, h, f, c) => {
    // a wooden horse: body, neck and head with ears, eyes and a mane, a saddle on a blanket,
    // stirrups, a handle through the head, splayed legs on two curved rockers with crossbars
    const k = h / 0.72;
    const kz = d / 0.85;
    const kx = w / 0.32;
    const P = (x: number, y: number, z: number) => v(x * kx, y * k, z * kz);
    const wood = f;
    const dark = mat(c === "walnut" ? "#2a1c14" : "#4a2f1e", { roughness: 1 });
    const kk = Math.min(k, kz);
    // the rockers: arcs with a flat top edge
    const th = 0.04 * k;
    const sag = 0.07 * k;
    const half = d / 2 - 0.01;
    const R = (half * half + sag * sag) / (2 * sag);
    const yr = (z: number) => R - Math.sqrt(R * R - z * z);
    const shape = new THREE.Shape();
    const steps = 20;
    const a0 = Math.asin(half / R);
    for (let i = 0; i <= steps; i++) {
      const t = -a0 + (2 * a0 * i) / steps;
      const z = R * Math.sin(t);
      const y = R - R * Math.cos(t);
      if (i === 0) shape.moveTo(z, y);
      else shape.lineTo(z, y);
    }
    for (let i = steps; i >= 0; i--) {
      const t = -a0 + (2 * a0 * i) / steps;
      shape.lineTo((R - th) * Math.sin(t), R - (R - th) * Math.cos(t) + th * 0.0 + th);
    }
    const rt = 0.024;
    for (const sx of [-1, 1]) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: rt - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
      geo.translate(0, 0, -(rt - 0.006) / 2);
      geo.rotateY(Math.PI / 2);
      b.add(geo, wood, sx * (w / 2 - rt / 2 - 0.004), 0, 0);
    }
    for (const z of [-0.3, 0.3]) hcyl(b, 0.014 * kk, w - 0.04, 0, yr(z * kz) + th * 0.6, z * kz, wood, "x", 10);
    // legs to the rockers
    for (const sx of [-1, 1])
      for (const [zb, zr] of [[0.1, 0.24], [-0.13, -0.24]]) {
        const top = P(sx * 0.035, 0.37, zb);
        const foot = v(sx * (w / 2 - rt / 2 - 0.004), yr(zr * kz) + th - 0.005, zr * kz);
        limb(b, top, foot, 0.018 * kk, wood, 8);
      }
    // body, neck, head
    limb(b, P(0, 0.42, -0.16), P(0, 0.42, 0.12), 0.085 * kk, wood, 14).scale.x = 0.82;
    limb(b, P(0, 0.46, 0.13), P(0, 0.6, 0.22), 0.058 * kk, wood, 12).scale.x = 0.8;
    limb(b, P(0, 0.63, 0.22), P(0, 0.58, 0.33), 0.048 * kk, wood, 12).scale.x = 0.85;
    b.sphere(0.042 * kk, P(0, 0.572, 0.335).x, P(0, 0.572, 0.335).y, P(0, 0.572, 0.335).z, wood, 0.9, 0.9, 1, 12);
    const eye = mat("#1d1e21", { roughness: 0.3 });
    for (const sx of [-1, 1]) {
      const e = P(sx * 0.036, 0.645, 0.255);
      b.sphere(0.008 * kk, e.x, e.y, e.z, eye, 1, 1, 1, 8);
      const ear = b.add(new THREE.ConeGeometry(0.014 * kk, 0.05 * k, 8), wood, P(sx * 0.022, 0.69, 0.205).x, P(0, 0.69, 0).y, P(0, 0, 0.205).z);
      ear.rotation.set(-0.25, 0, sx * -0.15);
      const n = P(sx * 0.014, 0.585, 0.37);
      b.sphere(0.006 * kk, n.x, n.y, n.z, eye, 1, 1, 1, 6);
    }
    // the mane: tufts down the neck, a forelock; the tail
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const p = P(0, 0.67 - t * 0.2, 0.19 - t * 0.12);
      limb(b, p, p.clone().add(v(0, 0.02 * k, -0.035 * kz)), 0.016 * kk, dark, 6).scale.x = 0.7;
    }
    limb(b, P(0, 0.67, 0.23), P(0, 0.64, 0.27), 0.012 * kk, dark, 6);
    limb(b, P(0, 0.45, -0.24), P(0, 0.33, -0.3), 0.022 * kk, dark, 8);
    limb(b, P(0, 0.33, -0.3), P(0, 0.24, -0.29), 0.018 * kk, dark, 8);
    // the blanket and the saddle
    const rb = 0.085 * kk;
    const blanket = new THREE.CylinderGeometry(rb + 0.004, rb + 0.004, 0.17 * kz, 16, 1, true, -1.25, 2.5);
    blanket.rotateX(Math.PI / 2);
    b.add(blanket, mat("#e8c35a", { roughness: 1, side: THREE.DoubleSide }), 0, P(0, 0.42, 0).y, -0.01 * kz).scale.x = 0.84;
    const saddle = new THREE.CylinderGeometry(rb + 0.012, rb + 0.012, 0.12 * kz, 16, 1, true, -0.9, 1.8);
    saddle.rotateX(Math.PI / 2);
    const red = mat("#c8382c", { roughness: 0.6, side: THREE.DoubleSide });
    b.add(saddle, red, 0, P(0, 0.42, 0).y, -0.01 * kz).scale.x = 0.86;
    const cantle = P(0, 0.42, -0.07);
    b.sphere(0.03 * kk, cantle.x, cantle.y + rb + 0.006, cantle.z, mat("#c8382c", { roughness: 0.6 }), 1.4, 0.8, 0.7, 12);
    for (const sx of [-1, 1]) {
      b.box(0.004, 0.11 * k, 0.014, sx * (rb * 0.86 + 0.012), P(0, 0.3, 0).y, 0, dark);
      b.add(new THREE.TorusGeometry(0.018 * kk, 0.004, 4, 12).rotateY(Math.PI / 2), mat(C.chrome, { metalness: 0.7, roughness: 0.3 }), sx * (rb * 0.86 + 0.014), P(0, 0.29, 0).y, 0);
    }
    // the handle through the head
    const hp = P(0, 0.62, 0.245);
    hcyl(b, 0.01 * kk, w * 0.62, hp.x, hp.y, hp.z, mat(shade(c, 0.7)), "x", 10);
    for (const sx of [-1, 1]) b.sphere(0.016 * kk, sx * w * 0.31, hp.y, hp.z, mat(shade(c, 0.7)), 1, 1, 1, 10);
  },
  teepee: (b, w, d, h, f, c) => {
    // poles crossing at the top, cloth panels sagging a little between them, a door with its
    // flaps rolled back and tied, a band near the hem; a round mat and cushions inside
    const N = 6;
    const R = Math.min(w, d) / 2 - 0.03;
    const ha = h * 0.84;
    const yc = ha * 0.86;
    const pole = mat("#b48a5e", { roughness: 0.8 });
    const cloth = mat((f as THREE.MeshStandardMaterial).color.getStyle(), { side: THREE.DoubleSide, roughness: 1 });
    const band = mat(PASTEL[c] ?? "#c98a6b", { side: THREE.DoubleSide, roughness: 1 });
    const ang = (j: number) => Math.PI / 2 - Math.PI / N + (j * 2 * Math.PI) / N;
    const rAt = (y: number) => R * (1 - y / ha);
    const td = 0.62;
    // a point on panel j at (u across, y up), off pushed outwards
    const at = (j: number, u: number, y: number, off = 0) => {
      const r = rAt(y);
      const a0 = ang(j);
      const a1 = ang(j + 1);
      const A = v(r * Math.cos(a0), y, r * Math.sin(a0));
      const B = v(r * Math.cos(a1), y, r * Math.sin(a1));
      const p = A.lerp(B, u);
      const mid = (a0 + a1) / 2;
      const sag = 0.035 * Math.sin(Math.PI * u) * (r / R) - off;
      p.x -= Math.cos(mid) * sag;
      p.z -= Math.sin(mid) * sag;
      return p;
    };
    const panel = (j: number, y0: number, y1: number, m: THREE.Material, off: number, rows: number) => {
      const door = j === 0;
      const parts: [number, number][] = door ? [[0, -1], [1, 1]] : [[0, 0]];
      for (const [start, dir] of parts) {
        const pos: number[] = [];
        const cols = door ? 5 : 9;
        for (let r = 0; r <= rows; r++) {
          const y = y0 + ((y1 - y0) * r) / rows;
          const t = y / yc;
          const hd = t < td ? 0.4 * (1 - t / td) : 0;
          for (let i = 0; i <= cols; i++) {
            const s = i / cols;
            // the door's halves: from the pole to the opening
            const u = door ? start + dir * s * (0.5 - hd) : s;
            const p = at(j, u, y, off);
            pos.push(p.x, p.y, p.z);
          }
        }
        grid(b, pos, cols + 1, m);
      }
    };
    for (let j = 0; j < N; j++) {
      panel(j, 0.01, yc, cloth, 0, 8);
      panel(j, 0.14, 0.22, band, 0.006, 1);
      panel(j, 0.25, 0.27, band, 0.006, 1);
    }
    // the poles, through the crossing and out at the top, lashed with a rope
    for (let j = 0; j < N; j++) {
      const a0 = ang(j);
      const foot = v((R + 0.01) * Math.cos(a0), 0, (R + 0.01) * Math.sin(a0));
      const dir = v(0, ha, 0).sub(foot);
      const tip = foot.clone().add(dir.multiplyScalar(h / ha));
      b.rod(foot, tip, 0.016, pole, 8);
    }
    b.cyl(0.05, 0.05, 0.06, 0, ha - 0.03, 0, mat("#d9c7a6", { roughness: 1 }), 12);
    // the door flaps rolled back along the opening's edges, tied
    for (const side of [-1, 1]) {
      const u0 = side < 0 ? 0.1 : 0.9;
      const lo = at(0, u0, 0.03, 0.02);
      const hi = at(0, 0.5, td * yc, 0.02);
      limb(b, lo, hi, 0.032, cloth, 10);
      const tie = lo.clone().lerp(hi, 0.45);
      b.add(new THREE.TorusGeometry(0.038, 0.007, 4, 12), band, tie.x, tie.y, tie.z).lookAt(hi.x, hi.y, hi.z);
    }
    // inside: a round mat and two cushions
    b.cyl(R * 0.72, R * 0.72, 0.02, 0, 0, -0.02, mat("#efe9df", { roughness: 1 }), 32);
    pillow(b, 0.38, 0.12, 0.38, -R * 0.25, 0.08, -R * 0.3, mat(PASTEL[c] ?? "#c98a6b", { roughness: 1 }), -0.3, 0.4);
    pillow(b, 0.34, 0.11, 0.34, R * 0.25, 0.075, -R * 0.2, mat(TOY[1], { roughness: 1 }), -0.25, -0.5);
  },
  kids_table: (b, w, d, h, f, _c, a) => {
    // a small table with rounded corners, two little chairs with round holes in their backs,
    // paper and crayons on the table
    const tw = w * 0.58;
    const tt = 0.03;
    slab(b, tw, d, tt, 0, h - tt, 0, f, 0.07);
    taperLegs(b, tw - 0.04, d - 0.04, h - tt + 0.005, 0.05, 0.022, a, 0.015);
    b.box(tw - 0.14, 0.05, 0.016, 0, h - tt - 0.05, d / 2 - 0.08, f);
    b.box(tw - 0.14, 0.05, 0.016, 0, h - tt - 0.05, -d / 2 + 0.08, f);
    const sh = h * 0.58;
    const sw = Math.min(0.28, d * 0.46);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - sw / 2 - 0.01);
      slab(b, sw, sw, 0.022, x, sh - 0.022, 0, f, 0.04);
      taperLegs(b, sw - 0.02, sw - 0.02, sh - 0.02, 0.03, 0.014, a, 0.01, 0);
      // the back: two posts and a board with a hole
      const bx = x + sx * (sw / 2 - 0.015);
      const top = sh + Math.min(0.28, h * 0.55);
      for (const sz of [-1, 1]) b.cyl(0.012, 0.012, top - sh - 0.02, bx, sh - 0.005, sz * (sw / 2 - 0.03), a, 8);
      const s = new THREE.Shape();
      const bw = sw - 0.02;
      const y0 = top - 0.13;
      s.moveTo(-bw / 2, y0);
      s.lineTo(bw / 2, y0);
      s.lineTo(bw / 2, top - 0.03);
      s.quadraticCurveTo(0, top + 0.015, -bw / 2, top - 0.03);
      s.lineTo(-bw / 2, y0);
      s.holes.push(circlePath(0, y0 + 0.055, 0.025));
      boardX(b, s, 0.02, bx, f);
    }
    // paper and crayons
    const paper = mat("#fbfaf6", { roughness: 0.9 });
    b.box(0.21, 0.002, 0.297, -tw * 0.18, h, 0.0, paper)?.rotation.set(0, 0.2, 0);
    b.box(0.21, 0.002, 0.297, tw * 0.12, h, -0.03, paper)?.rotation.set(0, -0.35, 0);
    const rand = random(41);
    for (let i = 0; i < 5; i++) {
      const cm = mat(TOY[i % TOY.length], { roughness: 0.5 });
      const cr = b.add(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 6).rotateZ(Math.PI / 2), cm, tw * 0.25 + (rand() - 0.5) * 0.08, h + 0.005, d * 0.2 + (rand() - 0.5) * 0.1);
      cr.rotation.y = rand() * Math.PI;
    }
    b.cyl(0.035, 0.03, 0.09, -tw * 0.36, h, -d * 0.3, mat(TOY[2], { roughness: 0.5 }), 14);
    for (let i = 0; i < 4; i++) b.rod(v(-tw * 0.36 + (i - 1.5) * 0.012, h + 0.02, -d * 0.3), v(-tw * 0.36 + (i - 1.5) * 0.025, h + 0.15, -d * 0.3 + (i % 2 ? 0.015 : -0.015)), 0.005, mat(TOY[(i + 3) % TOY.length]), 6);
  },
};
