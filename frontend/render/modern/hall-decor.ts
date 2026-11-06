// More detailed built-in pieces: hall decor. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Builder, C, art, back, fronts, glass, mat, matrix, random, roundedRect, v, wickerMat, type Build, type Handle } from "../modern";

// ----- helpers -----

/**
 * A lathe from a profile of [radius, height] points. Sharp corners split it into runs, so
 * each run gets its own normals (one lathe averages them across a rim and turns them
 * against the faces there). Profiles go counter-clockwise: out along the bottom, up the
 * outside, in over a rim and down the inside.
 */
function lathe(pts: [number, number][], seg: number, corner = 0.8): THREE.BufferGeometry {
  const runs: [number, number][][] = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    runs[runs.length - 1].push(pts[i]);
    if (i < pts.length - 1) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const c = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      let t = Math.abs(c - a);
      if (t > Math.PI) t = Math.PI * 2 - t;
      if (t > corner) runs.push([pts[i]]);
    }
  }
  const geos = runs.map((r) => new THREE.LatheGeometry(r.map(([x, y]) => new THREE.Vector2(x, y)), seg));
  return geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
}

/**
 * Places local geometry into the piece through a placement matrix: merged per material, or
 * as meshes of their own (inside b.above, whose parts must stay meshes).
 */
function placer(b: Builder, place: THREE.Matrix4, own = false) {
  return (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    geo.translate(x, y, z);
    if (!own) return b.batch(geo, m, place);
    b.add(geo.applyMatrix4(place), m);
  };
}

const dark = () => mat("#1d1e20", { roughness: 1 });
const steel = () => mat(C.chrome, { metalness: 0.7, roughness: 0.3 });
const SHOES = ["#2a2a2c", "#6b4a33", "#e8e4dc", "#2f3e55", "#8a3b3b", "#c9b9a0", "#5b6b58", "#3f6c8f"];

/** A shoe on its sole (toe at +z), placed by a matrix: 0 a trainer, 1 an ankle boot, 2 a loafer. */
function shoe(b: Builder, place: THREE.Matrix4, len: number, kind: number, upper: THREE.Material) {
  const put = placer(b, place);
  const w = 0.084;
  const sh = kind === 0 ? 0.022 : 0.012;
  const sole = kind === 0 ? mat("#f2f0eb") : mat("#2a2420");
  put(new THREE.CylinderGeometry(1, 1, sh, 12).scale(w / 2, 1, len / 2), sole, 0, sh / 2, 0);
  // the upper: a long dome over the sole, its opening a dark oval towards the heel
  const H = kind === 2 ? 0.05 : 0.068;
  const zc = -len * 0.01;
  put(new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(w * 0.49, H, len * 0.49), upper, 0, sh, zc);
  const oz = -len * 0.24;
  const t = (oz - zc) / (len * 0.49);
  if (kind === 1) {
    put(new THREE.CylinderGeometry(w * 0.42, w * 0.46, Math.min(0.14, len * 0.5), 10).scale(1, 1, 1.25), upper, 0, sh + Math.min(0.14, len * 0.5) / 2, oz);
    put(new THREE.CylinderGeometry(w * 0.32, w * 0.32, 0.004, 10).scale(1, 1, 1.25), dark(), 0, sh + Math.min(0.14, len * 0.5), oz);
  } else put(new THREE.SphereGeometry(1, 8, 3).scale(w * 0.3, 0.006, len * 0.17), dark(), 0, sh + H * Math.sqrt(1 - t * t) - 0.003, oz);
}

/** A pair of shoes side by side at x on a placement (the plane they stand on). */
function shoePair(b: Builder, base: THREE.Matrix4, x: number, len: number, kind: number, color: string, turn = 0) {
  const upper = mat(color, { roughness: kind === 0 ? 0.9 : 0.55 });
  for (const dx of [-0.046, 0.046]) shoe(b, base.clone().multiply(matrix(x + dx, 0, 0, 0, turn + dx * 0.6, 0)), len, kind, upper);
}

/** A coat hanging from (x, y, z) by its loop, its front at +z, turned by ry. */
function coat(b: Builder, x: number, y: number, z: number, len: number, wid: number, color: string, ry = 0, hood = false) {
  const put = placer(b, matrix(x, y, z, 0, ry, 0));
  const m = mat(color, { roughness: 1 });
  const flat = 0.36;
  const sh = wid * 0.27;
  put(new THREE.TorusGeometry(0.012, 0.003, 4, 8), m, 0, -0.012, 0);
  put(new THREE.CapsuleGeometry(0.045, sh * 2, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.85), m, 0, -0.07, 0);
  const bl = len - 0.08;
  put(new THREE.CylinderGeometry(sh + 0.03, wid * 0.44, bl, 12).scale(1, 1, flat), m, 0, -0.07 - bl / 2, 0);
  for (const sx of [-1, 1]) {
    const sl = len * 0.55;
    put(new THREE.CapsuleGeometry(0.036, sl, 3, 6).rotateZ(sx * 0.07), m, sx * (sh + 0.035), -0.08 - sl / 2, 0.004);
  }
  if (hood) put(new THREE.SphereGeometry(1, 10, 6).scale(0.085, 0.07, 0.045), m, 0, -0.06, -0.035);
  else put(new THREE.CylinderGeometry(0.06, 0.075, 0.05, 12).scale(1, 1, 0.75), m, 0, -0.045, 0);
  // a placket line, buttons and pocket flaps down the front
  const fz = (t: number) => (sh + 0.03 + (wid * 0.44 - sh - 0.03) * t) * flat;
  const line = mat("#141414", { roughness: 1 });
  for (let k = 0; k < 4; k++) {
    const t = 0.1 + k * 0.17;
    put(new THREE.SphereGeometry(0.008, 6, 3), mat("#2a2622", { roughness: 0.5 }), 0.012, -0.07 - bl * t, fz(t) + 0.002);
  }
  put(new THREE.BoxGeometry(0.004, bl * 0.9, 0.004), line, 0, -0.07 - bl * 0.52, fz(0.52));
  for (const sx of [-1, 1]) put(new THREE.BoxGeometry(wid * 0.18, 0.006, 0.006), line, sx * wid * 0.2, -0.07 - bl * 0.62, fz(0.62) - 0.008);
}

/** A scarf hanging over a hook at (x, y, z): the fold over it, two tails with fringes. */
function scarf(b: Builder, x: number, y: number, z: number, len: number, color: string) {
  const m = mat(color, { roughness: 1 });
  b.box(0.08, 0.025, 0.05, x, y - 0.008, z, m, 0.01);
  b.box(0.075, len, 0.012, x - 0.012, y - len, z + 0.018, m, 0.005)?.rotation.set(0, 0, 0.03);
  b.box(0.07, len * 0.8, 0.012, x + 0.015, y - len * 0.8, z - 0.006, m, 0.005)?.rotation.set(0, 0, -0.04);
  for (let k = 0; k < 4; k++) b.box(0.006, 0.03, 0.006, x - 0.03 + k * 0.018, y - len - 0.028, z + 0.018, m);
}

/** A tote bag with its handles over a hook at (x, y, z). */
function tote(b: Builder, x: number, y: number, z: number, bw: number, bh: number, color: string) {
  const m = mat(color, { roughness: 0.9 });
  b.add(new THREE.TorusGeometry(0.055, 0.006, 4, 12, Math.PI), m, x, y - 0.07, z);
  b.box(bw, bh, 0.06, x, y - 0.06 - bh, z, m, 0.012);
  b.box(bw * 0.5, bh * 0.35, 0.004, x, y - 0.06 - bh * 0.7, z + 0.031, mat("#d9d4c7", { roughness: 1 }));
}

/** A cap on a hook at (x, y, z): its crown towards the room, the peak down. */
function cap(b: Builder, x: number, y: number, z: number, color: string) {
  const m = mat(color, { roughness: 1 });
  b.add(new THREE.SphereGeometry(0.075, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1).rotateX(Math.PI / 2), m, x, y - 0.06, z);
  b.box(0.11, 0.006, 0.06, x, y - 0.14, z + 0.03, m, 0.002)?.rotation.set(0.5, 0, 0);
}

/** A hat: crown, band and brim, its brim at y. */
function hat(b: Builder, x: number, y: number, z: number, color: string, tilt = 0) {
  const m = mat(color, { roughness: 1 });
  b.add(lathe([[0.001, 0], [0.13, 0], [0.13, 0.008], [0.08, 0.01], [0.075, 0.1], [0.055, 0.11], [0.001, 0.105]], 16), m, x, y, z).rotation.z = tilt;
  b.add(new THREE.CylinderGeometry(0.0805, 0.0795, 0.022, 16), mat("#1d1d1f", { roughness: 0.8 }), x, y + 0.023, z).rotation.z = tilt;
}

/** A wall letter box: a lid over the slot, door seams, name plate and lock. */
function mailbox(b: Builder, w: number, d: number, h: number, y: number, f: THREE.Material) {
  const fz = d / 2;
  b.box(w, h - 0.015, d, 0, y, 0, f, 0.008);
  // a cap overhanging a little
  b.box(w + 0.012, 0.016, d + 0.012, 0, y + h - 0.016, 0.003, f, 0.005);
  // the slot and the lid hinged over it, tipped out at the bottom
  const sw = w * 0.72;
  const sy = y + h * 0.8;
  b.box(sw, 0.02, 0.004, 0, sy - 0.012, fz, dark());
  b.box(sw + 0.02, 0.05, 0.008, 0, sy - 0.006, fz + 0.007, f, 0.003)?.rotation.set(-0.22, 0, 0);
  // the door below: a seam around it
  const dy0 = y + 0.03;
  const dh = h * 0.62 - 0.03;
  const seam = mat("#151617", { roughness: 1 });
  for (const sx of [-1, 1]) b.box(0.003, dh, 0.002, sx * (w / 2 - 0.025), dy0, fz + 0.001, seam);
  for (const yy of [dy0, dy0 + dh]) b.box(w - 0.05, 0.003, 0.002, 0, yy, fz + 0.001, seam);
  // a name plate in a frame, viewing slits, the lock
  b.box(w * 0.32 + 0.01, 0.045, 0.004, 0, dy0 + dh * 0.62, fz + 0.001, steel());
  b.box(w * 0.32, 0.035, 0.004, 0, dy0 + dh * 0.62 + 0.005, fz + 0.003, mat("#ece8df"));
  for (let k = 0; k < 3; k++) b.box(w * 0.3, 0.005, 0.002, 0, dy0 + dh * 0.22 + k * 0.014, fz + 0.001, seam);
  b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 12).rotateX(Math.PI / 2), steel(), w * 0.32, dy0 + dh * 0.45, fz + 0.004);
  b.box(0.002, 0.012, 0.002, w * 0.32, dy0 + dh * 0.45 - 0.006, fz + 0.009, dark());
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  shoe_shelf: (b, w, d, h, f) => {
    // two side panels, a flat top, slanted shelves with a toe rail and pairs of shoes
    const t = 0.018;
    for (const sx of [-1, 1]) b.box(t, h, d, sx * (w / 2 - t / 2), 0, 0, f, 0.003);
    b.box(w, t, d, 0, h - t, 0, f, 0.003);
    const inner = w - 2 * t;
    const slant = 0.28;
    const drop = (d / 2) * Math.tan(slant);
    const y0 = 0.03 + drop;
    const levels = Math.max(2, Math.round((h - 0.1) / 0.28));
    const gap = (h - t - y0) / levels;
    const len = Math.min(0.27, d * 0.86);
    const rand = random(811);
    const pairs = Math.max(1, Math.floor(inner / 0.2));
    for (let i = 0; i < levels; i++) {
      const y = y0 + i * gap;
      b.box(inner, 0.012, d / Math.cos(slant) - 0.02, 0, y, 0, f)?.rotation.set(slant, 0, 0);
      b.box(inner, 0.024, 0.016, 0, y - drop, d / 2 - 0.01, f);
      b.box(inner, 0.016, 0.016, 0, y + drop - 0.004, -d / 2 + 0.01, f);
      // the shelf's top surface
      const base = matrix(0, y + 0.006 + 0.006 / Math.cos(slant), 0, slant, 0, 0);
      for (let k = 0; k < pairs; k++) {
        const r = rand();
        if (r < 0.12) continue;
        const kind = i === 0 && gap > 0.22 && k === 0 ? 1 : r < 0.6 ? 0 : 2;
        const x = -inner / 2 + (inner / pairs) * (k + 0.5) + (rand() - 0.5) * 0.02;
        shoePair(b, base, x, len, kind, SHOES[Math.floor(rand() * SHOES.length)], (rand() - 0.5) * 0.1);
      }
    }
  },
  shoe_cabinet: (b, w, d, h, f) => {
    // a slim cabinet of tip-out flaps on a recessed plinth, the top overhanging; a key bowl on it
    const plinth = 0.05;
    b.box(w - 0.04, plinth, d - 0.04, 0, 0, -0.01, mat("#2a2b2d", { roughness: 1 }));
    b.box(w, h - plinth - 0.022, d - 0.02, 0, plinth, -0.01, f, 0.004);
    b.box(w + 0.01, 0.022, d + 0.006, 0, h - 0.022, 0, f, 0.004);
    const rows = Math.max(2, Math.round((h - plinth) / 0.33));
    fronts(b, -w / 2 + 0.003, w - 0.006, plinth + 0.004, h - plinth - 0.03, d / 2 - 0.02, 1, f, rows, "bar", mat(C.black), true);
    b.above(() => b.add(lathe([[0.001, 0], [0.035, 0], [0.06, 0.03], [0.055, 0.03], [0.032, 0.006], [0.001, 0.006]], 18), mat(C.ceramic, { roughness: 0.4 }), w * 0.28, h, 0));
  },
  hall_bench: (b, w, d, h, f) => {
    // four legs, aprons, a slatted shoe shelf, a seat pad; shoes and a basket below
    const lg = 0.04;
    const top = 0.035;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(lg, h - top, lg, sx * (w / 2 - lg / 2 - 0.01), 0, sz * (d / 2 - lg / 2 - 0.01), f, 0.004);
    b.box(w, top, d, 0, h - top, 0, f, 0.006);
    for (const sz of [-1, 1]) b.box(w - 0.04, 0.05, 0.018, 0, h - top - 0.05, sz * (d / 2 - 0.02), f);
    for (const sx of [-1, 1]) b.box(0.018, 0.03, d - 0.04, sx * (w / 2 - 0.03), 0.1, 0, f);
    const slats = 4;
    for (let i = 0; i < slats; i++) b.box(w - 0.08, 0.016, (d - 0.08) / slats - 0.012, 0, 0.13, -d / 2 + 0.04 + ((d - 0.08) / slats) * (i + 0.5), f);
    b.above(() => b.box(w * 0.62, 0.05, d - 0.06, -w * 0.15, h, 0, mat(C.linen, { roughness: 1 }), 0.02));
    const base = matrix(0, 0.146, 0.01, 0, 0, 0);
    const len = Math.min(0.27, d * 0.8);
    const rand = random(830);
    const room = w - 0.1;
    const basket = room > 0.6 ? 0.3 : 0;
    const pairs = Math.max(1, Math.floor((room - basket) / 0.21));
    const space = h - top - 0.05 - 0.146;
    for (let k = 0; k < pairs; k++) {
      const kind = [0, 2, 1, 0][k % 4];
      shoePair(b, base, -w / 2 + 0.155 + k * 0.21, len, kind === 1 && space < 0.17 ? 0 : kind, SHOES[Math.floor(rand() * SHOES.length)], (rand() - 0.5) * 0.12);
    }
    if (basket && space > 0.1) b.box(basket, Math.min(0.2, space - 0.03), d * 0.7, w / 2 - 0.05 - basket / 2, 0.146, 0, wickerMat("sand"), 0.02);
  },
  coat_hooks: (b, w, d, h, f, _c, a) => {
    // a board on the wall with hooks; coats, a scarf, a bag and a cap on them
    const z0 = back(d);
    b.box(w, 0.09, 0.022, 0, h - 0.11, z0 + 0.011, f, 0.004);
    const n = Math.max(2, Math.round(w / 0.16));
    const rand = random(n + 837);
    const things = ["coat", "", "scarf", "coat", "bag", "cap"];
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const yb = h - 0.065;
      b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 12).rotateX(Math.PI / 2), a, x, yb, z0 + 0.026);
      b.rod(v(x, yb, z0 + 0.026), v(x, yb + 0.012, z0 + 0.07), 0.006, a, 6);
      b.rod(v(x, yb + 0.012, z0 + 0.07), v(x, yb + 0.04, z0 + 0.078), 0.006, a, 6);
      b.sphere(0.009, x, yb + 0.042, z0 + 0.078, a, 1, 1, 1, 8);
      const thing = n === 2 ? "coat" : things[i % things.length];
      const hy = yb + 0.014;
      const hz = z0 + 0.07;
      const color = ["#2f3e55", "#c9b9a0", "#5b6b58", "#8a3b3b", "#3a3a3a"][(i + Math.floor(rand() * 2)) % 5];
      if (thing === "coat") coat(b, x, hy, hz, Math.min(0.85, h - 0.12), 0.32, color, 0, i % 2 === 1);
      else if (thing === "scarf") scarf(b, x, hy + 0.01, hz, Math.min(0.32, h * 0.55), ["#b5523b", "#e3c46b", "#7a5a8c"][i % 3]);
      else if (thing === "bag") tote(b, x, hy, hz - 0.012, 0.2, Math.min(0.24, h * 0.4), "#c9b9a0");
      else if (thing === "cap") cap(b, x, hy + 0.01, hz - 0.03, "#3f6c8f");
    }
  },
  coat_stand: (b, w, _d, h, f) => {
    // a pole on three splayed legs, hooks around its top; a coat, a hat on top, a bag
    const r = 0.017;
    b.cyl(r, r * 1.15, h - 0.02, 0, 0, 0, f, 12);
    b.sphere(0.03, 0, h - 0.13, 0, f, 1, 0.9, 1, 12);
    const sy = Math.min(0.32, h * 0.2);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const foot = v(Math.cos(ang) * w * 0.44, 0.012, Math.sin(ang) * w * 0.44);
      b.rod(v(0, sy, 0), foot, 0.012, f, 8);
      b.sphere(0.016, foot.x, 0.012, foot.z, mat("#2a2b2d"), 1, 0.75, 1, 8);
    }
    b.cyl(0.024, 0.024, 0.03, 0, sy - 0.02, 0, f, 12);
    const hooks = 6;
    const hookEnd: THREE.Vector3[] = [];
    for (let i = 0; i < hooks; i++) {
      const ang = (i / hooks) * Math.PI * 2 + Math.PI / 2;
      const y0 = h - 0.25 - (i % 2) * 0.1;
      const out = 0.11 + (i % 2) * 0.02;
      const p1 = v(Math.cos(ang) * out, y0 + 0.05, Math.sin(ang) * out);
      const p2 = v(Math.cos(ang) * (out + 0.015), y0 + 0.1, Math.sin(ang) * (out + 0.015));
      b.rod(v(0, y0, 0), p1, 0.009, f, 6);
      b.rod(p1, p2, 0.009, f, 6);
      b.sphere(0.014, p2.x, p2.y, p2.z, f, 1, 1, 1, 8);
      hookEnd.push(p1);
    }
    const len = Math.min(1.0, h * 0.55);
    coat(b, hookEnd[0].x, hookEnd[0].y + 0.01, hookEnd[0].z - 0.01, len, 0.36, C.clothes[1]);
    hat(b, 0, h - 0.115, 0, "#3a3a3a", 0.12);
    tote(b, hookEnd[4].x, hookEnd[4].y + 0.01, hookEnd[4].z, 0.17, 0.2, "#8a3b3b");
  },
  letter_box: (b, w, d, h, f) => mailbox(b, w, d, h, 0, f),
  letter_box_post: (b, w, d, h, f) => {
    // a post on a foot plate at the back, a holder for the paper under the box
    const bh = Math.min(0.42, h * 0.34);
    const ps = 0.06;
    const pz = -d / 2 + ps / 2 + 0.01;
    b.box(Math.min(0.3, w), 0.012, Math.min(0.24, d), 0, 0, pz + 0.05, f, 0.004);
    b.box(ps, h - bh - 0.012, ps, 0, 0.012, pz, f, 0.006);
    const tl = d - ps - 0.03;
    const ty = h - bh - 0.06;
    b.add(lathe([[0.04, 0], [0.045, 0], [0.045, tl], [0.04, tl], [0.04, 0]], 16).rotateX(Math.PI / 2), f, 0, ty, pz + ps / 2);
    b.box(0.012, 0.02, 0.03, 0, ty + 0.04, pz + ps / 2 + 0.03, f);
    b.add(new THREE.CylinderGeometry(0.035, 0.035, tl * 0.8, 12).rotateX(Math.PI / 2), mat("#e9e4d8", { roughness: 1 }), 0, ty - 0.004, pz + ps / 2 + tl * 0.55);
    mailbox(b, w, d, bh, h - bh, f);
  },
  console_table: (b, w, d, h, f, _c, a) => {
    // a slim top over an apron with two drawers, tapered legs, a shelf; decor on top
    const top = 0.03;
    const apron = 0.1;
    b.box(w, top, d, 0, h - top, 0, f, 0.006);
    b.box(w - 0.06, apron, d - 0.05, 0, h - top - apron, -0.005, f, 0.003);
    const dw = (w - 0.1) / 2;
    for (const sx of [-1, 1]) {
      b.box(dw - 0.01, apron - 0.016, 0.012, sx * (dw / 2 + 0.01), h - top - apron + 0.008, d / 2 - 0.028, f, 0.003);
      b.sphere(0.012, sx * (dw / 2 + 0.01), h - top - apron / 2, d / 2 - 0.016, a, 1, 1, 1, 10);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.024, 0.015, h - top - 0.005, sx * (w / 2 - 0.035), 0, sz * (d / 2 - 0.035), a, 4).rotation.y = Math.PI / 4;
    b.box(w - 0.07, 0.022, d - 0.07, 0, 0.16, 0, f, 0.004);
    if (w > 0.7) b.box(Math.min(0.32, w * 0.3), Math.min(0.2, h - top - apron - 0.2), d - 0.12, w * 0.2, 0.182, 0, wickerMat("sand"), 0.02);
    // decor: a vase with twigs, books with a brass bowl
    b.above(() => {
      const vx = -w * 0.32;
      b.add(lathe([[0.001, 0], [0.05, 0], [0.065, 0.08], [0.04, 0.2], [0.03, 0.22], [0.034, 0.23], [0.026, 0.23], [0.001, 0.2]], 16), mat(C.ceramic, { roughness: 0.45 }), vx, h, -0.02);
      for (let i = 0; i < 3; i++) {
        const ang = i * 2.1;
        b.rod(v(vx, h + 0.2, -0.02), v(vx + Math.cos(ang) * 0.08, h + 0.42 + i * 0.03, -0.02 + Math.sin(ang) * 0.04), 0.003, mat(C.trunk), 4);
      }
      const bx = w * 0.22;
      b.box(0.22, 0.03, 0.15, bx, h, -0.01, mat(C.book[1]), 0.003);
      b.box(0.19, 0.025, 0.13, bx + 0.005, h + 0.03, -0.01, mat(C.book[5]), 0.003)?.rotation.set(0, 0.08, 0);
      b.add(lathe([[0.001, 0], [0.04, 0], [0.065, 0.035], [0.06, 0.035], [0.037, 0.005], [0.001, 0.005]], 18), mat("#b8935a", { metalness: 0.7, roughness: 0.3 }), bx, h + 0.055, -0.01);
    });
  },
  umbrella_stand: (b, w, d, h, f) => {
    // a tall pot with a rolled rim and a dark inside; folded umbrellas stand in it above
    const r = Math.min(w, d) / 2;
    b.add(lathe([[0.001, 0], [r * 0.86, 0], [r * 0.9, 0.01], [r * 0.98, h * 0.94], [r, h - 0.012], [r * 0.97, h], [r * 0.9, h - 0.004], [r * 0.88, h * 0.5], [r * 0.84, 0.03], [0.001, 0.03]], 24), f);
    b.add(new THREE.CircleGeometry(r * 0.85, 20).rotateX(-Math.PI / 2), dark(), 0, 0.032, 0);
    b.above(() => {
      const colors = ["#2b2c2e", "#8a3a32", "#2f5fa8"];
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + 0.6;
        const foot = v(-Math.cos(ang) * r * 0.4, 0.032, -Math.sin(ang) * r * 0.4);
        const len = h + 0.34 + i * 0.04;
        const dir = v(Math.cos(ang) * 0.15, 1, Math.sin(ang) * 0.15).normalize();
        const put = placer(b, new THREE.Matrix4().compose(foot, new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), dir), v(1, 1, 1)), true);
        const cm = mat(colors[i], { roughness: 0.8 });
        const cl = len - 0.2;
        put(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4), steel(), 0, 0.015, 0);
        put(lathe([[0.001, 0], [0.01, 0.01], [0.026, cl * 0.45], [0.034, cl * 0.78], [0.012, cl], [0.001, cl]], 8), cm, 0, 0.03, 0);
        put(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 8), cm, 0, 0.03 + cl * 0.62, 0);
        put(new THREE.CylinderGeometry(0.005, 0.005, len - cl - 0.03, 6), steel(), 0, 0.03 + cl + (len - cl - 0.03) / 2, 0);
        const wood = mat("#5a3a24", { roughness: 0.5 });
        put(new THREE.TorusGeometry(0.03, 0.009, 6, 10, Math.PI), wood, -0.03, len, 0);
        for (const x of [0, -0.06]) put(new THREE.SphereGeometry(0.0095, 6, 4), wood, x, len, 0);
      }
    });
  },
  hall_wardrobe: (b, w, d, h, f, _c, a) => {
    // an open coat bay with a hat shelf, a rail with coats, a bench with a pad and drawers
    // beneath; a cupboard with a mirror on its door beside it
    const cw = w * 0.45;
    const bw = w - cw;
    const bx = -w / 2 + bw / 2;
    const t = 0.02;
    b.box(cw, h, d, w / 2 - cw / 2, 0, 0, f, 0.006);
    fronts(b, w / 2 - cw, cw, 0.05, h - 0.1, d / 2 - 0.018, 1, f, 1, "bar", a);
    b.box(cw * 0.5, Math.min(1.1, h * 0.55), 0.006, w / 2 - cw / 2 - cw * 0.12, h * 0.38, d / 2 + 0.003, mat(C.mirror, { metalness: 0.9, roughness: 0.05 }), 0.004);
    b.box(bw, t, d, bx, h - t, 0, f);
    b.box(t, h, d, -w / 2 + t / 2, 0, 0, f);
    b.box(bw, h - t, 0.012, bx, 0, -d / 2 + 0.006, f);
    b.box(bw, t, d - 0.012, bx, h - 0.32, 0.006, f);
    // bench and drawers
    b.box(bw - t, 0.04, d, bx + t / 2, 0.42, 0, f, 0.006);
    b.box(bw - t - 0.04, 0.38, d - 0.04, bx + t / 2, 0.02, 0, f, 0.006);
    fronts(b, -w / 2 + t, bw - t, 0.04, 0.36, d / 2 - 0.018, 2, f, 1, "bar", a);
    b.box(bw - t - 0.06, 0.045, d - 0.08, bx + t / 2, 0.46, 0.01, mat(C.linen, { roughness: 1 }), 0.018);
    // a hat and a box on the shelf, the rail and what hangs on it
    hat(b, bx - bw * 0.2, h - 0.3, 0, "#6b4a33");
    b.box(0.24, 0.16, d * 0.6, bx + bw * 0.22, h - 0.3, -0.02, mat("#d9d4c7"), 0.006);
    const ry = h - 0.38;
    b.rod(v(-w / 2 + t, ry, 0), v(w / 2 - cw, ry, 0), 0.012, steel(), 10);
    const n = Math.max(1, Math.floor((bw - 0.06) / 0.27));
    const len = Math.min(0.95, ry - 0.55);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + t + 0.03 + ((bw - t - 0.06) / n) * (i + 0.5);
      coat(b, x, ry + 0.012, (i % 2) * 0.03 - 0.015, len, 0.34, C.clothes[[0, 4, 1, 2][i % 4]], (i % 2 ? 1 : -1) * 0.12, i === 1);
    }
  },
  key_cabinet: (b, w, d, h, f, _c, a) => {
    // a box with a glazed door: rows of hooks with keys and coloured tags behind the glass
    const t = 0.012;
    b.box(w, h, d - 0.02, 0, 0, -0.01, f, 0.004);
    const fz = d / 2 - 0.02;
    b.box(w - 2 * t, h - 2 * t, 0.002, 0, t, fz + 0.001, mat("#e9e5dc", { roughness: 0.9 }));
    const rows = Math.max(2, Math.round((h - 0.08) / 0.12));
    const per = Math.max(2, Math.round((w - 0.08) / 0.05));
    const rand = random(364);
    const tags = ["#b5523b", "#3f6c8f", "#e3c46b", "#5f8a5c", "#7a5a8c"];
    const ring = mat(C.chrome, { metalness: 0.8, roughness: 0.3 });
    const brass = mat("#b8935a", { metalness: 0.7, roughness: 0.35 });
    for (let r = 0; r < rows; r++) {
      const y = h - 0.05 - r * ((h - 0.06) / rows);
      b.box(w - 0.06, 0.012, 0.006, 0, y, fz + 0.004, f);
      for (let k = 0; k < per; k++) {
        const x = -w / 2 + 0.04 + ((w - 0.08) / (per - 1)) * k;
        b.rod(v(x, y + 0.006, fz + 0.006), v(x, y + 0.01, fz + 0.016), 0.0018, ring, 4);
        if (rand() < 0.3) continue;
        b.add(new THREE.TorusGeometry(0.008, 0.0015, 3, 8), ring, x, y - 0.002, fz + 0.012);
        b.box(0.008, 0.032, 0.002, x, y - 0.042, fz + 0.012, rand() < 0.6 ? ring : brass);
        b.box(0.016, 0.022, 0.003, x + 0.006, y - 0.036, fz + 0.015, mat(tags[Math.floor(rand() * tags.length)]))?.rotation.set(0, 0, 0.2);
      }
    }
    // the door: a frame with glass, its knob (or the handle chosen)
    const dz = d / 2 - 0.009;
    const fw = 0.028;
    for (const sx of [-1, 1]) b.box(fw, h - 0.006, 0.018, sx * (w / 2 - fw / 2 - 0.003), 0.003, dz, f);
    for (const y of [0.003, h - 0.003 - fw]) b.box(w - 2 * fw - 0.006, fw, 0.018, 0, y, dz, f);
    b.box(w - 2 * fw - 0.006, h - 2 * fw - 0.006, 0.004, 0, fw + 0.003, dz + 0.004, glass());
    const handle = (b.options.handle as Handle | undefined) ?? "knob";
    const hx = w / 2 - fw / 2 - 0.003;
    if (handle === "knob") b.sphere(0.012, hx, h * 0.5, dz + 0.02, a, 1, 1, 1, 10);
    else if (handle === "bar") b.box(0.01, Math.min(0.12, h * 0.3), 0.012, hx, h * 0.5 - Math.min(0.06, h * 0.15), dz + 0.018, a, 0.003);
    else if (handle === "handleless") b.box(0.008, h * 0.3, 0.004, w / 2 - 0.001, h * 0.35, dz, mat("#2c2e31"));
  },
  fruit_bowl: (b, w, d, h, f) => {
    // a footed bowl with a rolled rim; apples, oranges, a pear, bananas and grapes
    const r = Math.min(w, d) / 2;
    const bh = h * 0.62;
    b.add(lathe([[0.001, 0], [r * 0.34, 0], [r * 0.4, 0.014], [r * 0.82, bh * 0.6], [r, bh - 0.004], [r * 0.95, bh], [r * 0.78, bh * 0.62], [r * 0.4, 0.024], [0.001, 0.024]], 20), f);
    const rand = random(379);
    const fr = Math.min(0.042, r * 0.28);
    const kinds: [string, boolean][] = [["#c8352a", true], ["#f2a53a", false], ["#9cc04a", true], ["#e88a2a", false], ["#b52d24", true]];
    const stemM = mat("#5a3e26");
    const apple = lathe([[0.001, fr * 0.12], [fr * 0.5, 0], [fr * 0.92, fr * 0.35], [fr * 1.02, fr * 0.85], [fr * 0.85, fr * 1.38], [fr * 0.45, fr * 1.62], [fr * 0.12, fr * 1.5], [0.001, fr * 1.42]], 8, 1.4);
    kinds.forEach(([c, isApple], i) => {
      const ang = (i / kinds.length) * Math.PI * 2 + rand() * 0.3;
      const x = Math.cos(ang) * r * 0.5;
      const z = Math.sin(ang) * r * 0.5;
      const y = 0.03 + (i % 2) * 0.006;
      const m = mat(c, { roughness: isApple ? 0.45 : 0.7 });
      if (isApple) {
        b.add(apple.clone(), m, x, y, z).rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
        b.rod(v(x, y + fr * 1.4, z), v(x + 0.004, y + fr * 1.75, z), 0.0025, stemM, 4);
      } else b.sphere(fr * 1.05, x, y + fr, z, m, 1, 0.95, 1, 9);
    });
    b.add(lathe([[0.001, 0], [fr * 0.75, fr * 0.1], [fr * 0.9, fr * 0.7], [fr * 0.45, fr * 1.5], [fr * 0.4, fr * 1.9], [0.001, fr * 2.1]], 10, 1.2), mat("#c9c24a", { roughness: 0.6 }), 0, 0.03 + fr * 0.3, 0).rotation.z = 0.35;
    // bananas lying over the fruit, curving across the bowl
    const banana = mat("#f2d14b", { roughness: 0.6 });
    const R = r * 0.55;
    const tip = mat("#4a3a24");
    for (let k = 0; k < 3; k++) {
      const cx = -R * Math.cos(0.7) - r * 0.05 + k * 0.008;
      const cy = 0.03 + fr * 2 + k * 0.004;
      const cz = R * Math.sin(0.7) - r * 0.2 + k * fr * 0.62;
      b.add(new THREE.TorusGeometry(R, fr * 0.34, 5, 7, 1.4).rotateX(-Math.PI / 2), banana, cx, cy, cz);
      for (const a of [0, 1.4]) b.add(new THREE.SphereGeometry(fr * 0.4, 6, 3), a ? tip : banana, cx + R * Math.cos(a), cy, cz - R * Math.sin(a));
    }
    const grape = mat("#5b2f5a", { roughness: 0.4 });
    for (let k = 0; k < 7; k++) b.add(new THREE.SphereGeometry(0.014, 6, 4), grape, r * 0.45 + (rand() - 0.5) * 0.05, 0.03 + fr * 1.6 + (k % 3) * 0.012, -r * 0.1 + (rand() - 0.5) * 0.06);
  },
  bowl_decor: (b, w, d, h, f) => {
    // a wide bowl on a foot ring, its rim rolled, three decorative orbs in it
    const r = Math.min(w, d) / 2;
    b.add(lathe([[0.001, 0], [r * 0.3, 0], [r * 0.3, h * 0.08], [r * 0.36, h * 0.1], [r * 0.85, h * 0.6], [r, h - 0.005], [r * 0.985, h], [r * 0.95, h - 0.002], [r * 0.8, h * 0.62], [r * 0.35, h * 0.2], [0.001, h * 0.2]], 40), f);
    const orb = [mat("#c9b9a0", { roughness: 1 }), mat("#6a4e39", { roughness: 0.7 }), mat("#d9d4c7", { roughness: 1 })];
    const or = Math.min(h * 0.4, r * 0.24);
    [[-0.3, -0.1], [0.28, -0.16], [0.02, 0.3]].forEach(([x, z], i) => {
      const s = or * (1 - i * 0.08);
      b.sphere(s, x * r, h * 0.2 + s + Math.hypot(x, z) * r * 0.2, z * r, orb[i], 1, 1, 1, 14);
    });
  },
  globe: (b, w, d, h, _f, _c, a) => {
    // a tilted globe with land caps on the sea, held at its poles by a half meridian on a stem and foot
    const tilt = 0.41;
    const r = Math.min(w, d, h * 0.7) / 2 - 0.012;
    const R1 = r + 0.012;
    const cy = h - R1 - 0.008;
    const u = v(-Math.sin(tilt), Math.cos(tilt), 0);
    const low = u.clone().multiplyScalar(-R1).add(v(0, cy, 0));
    const sx = -low.x / 2;
    b.add(lathe([[0.001, 0], [r * 0.62, 0], [r * 0.6, 0.012], [r * 0.4, 0.03], [0.001, 0.034]], 24, 1.2), a, sx + low.x, 0, 0);
    b.cyl(0.01, 0.012, low.y - 0.03, sx + low.x, 0.03, 0, a, 8);
    b.add(new THREE.SphereGeometry(r, 22, 12), mat("#4d7fa8", { roughness: 0.6 }), sx, cy, 0);
    const land = mat("#c9b27e", { roughness: 0.9, side: THREE.DoubleSide });
    const rand = random(383);
    const places: [number, number, number][] = [[0.3, 0.9, 0.5], [0.15, 1.5, 0.45], [-0.4, 1.0, 0.4], [0.5, -1.4, 0.55], [-0.2, -1.2, 0.35], [-0.55, 2.4, 0.4], [0.2, 2.9, 0.45], [0.75, 2.2, 0.35], [-0.9, 0.3, 0.3]];
    for (const [lat, lon, size] of places)
      for (let k = 0; k < 4; k++) {
        const la = lat + (rand() - 0.5) * size * 1.1;
        const lo = lon + (rand() - 0.5) * size * 1.1;
        const dir = v(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)).applyAxisAngle(v(0, 0, 1), tilt);
        const cap = new THREE.SphereGeometry(r * (1.003 + k * 0.0004), 7, 2, rand() * 6, Math.PI * 2, 0, size * (0.2 + rand() * 0.25));
        cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), dir));
        b.batch(cap, land, matrix(sx, cy, 0));
      }
    const arm = new THREE.TorusGeometry(R1, 0.006, 6, 28, Math.PI).rotateZ(-Math.PI / 2 + tilt);
    b.add(arm, a, sx, cy, 0);
    for (const s of [1, -1]) b.sphere(0.011, sx + u.x * R1 * s, cy + u.y * R1 * s, 0, a, 1, 1, 1, 10);
  },
  magazine_rack: (b, w, d, h, f) => {
    // two end frames with a carrying bar, a divider, slats front and back; magazines in both halves
    const t = 0.02;
    for (const sx of [-1, 1]) {
      b.box(t, h * 0.55, d, sx * (w / 2 - t / 2), 0, 0, f, 0.004);
      b.box(t, h - 0.03, 0.04, sx * (w / 2 - t / 2), 0, 0, f);
    }
    b.add(new THREE.CylinderGeometry(0.014, 0.014, w - 0.01, 12).rotateZ(Math.PI / 2), f, 0, h - 0.03, 0);
    b.box(w - 2 * t, t, d, 0, 0.03, 0, f);
    b.box(w - 2 * t, h * 0.45, 0.012, 0, 0.05, 0, f);
    for (const sz of [-1, 1]) for (const y of [0.12, h * 0.4]) b.box(w - 2 * t, 0.035, 0.014, 0, y, sz * (d / 2 - 0.007), f);
    const rand = random(4307);
    const mw = Math.min(0.24, w - 2 * t - 0.03);
    const mh = Math.min(0.3, h * 0.78);
    const pages = mat("#f1eee6");
    const title = mat("#f6f4ef", { roughness: 0.6 });
    for (const side of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const g = new Builder();
        g.box(mw, mh, 0.008, 0, 0, 0, pages);
        g.box(mw + 0.002, mh + 0.002, 0.002, 0, -0.001, side * 0.005, mat(C.book[Math.floor(rand() * C.book.length)], { roughness: 0.5 }));
        g.box(mw * 0.8, mh * 0.12, 0.002, 0, mh * 0.8, side * 0.0065, title);
        g.box(mw * 0.5, mh * 0.3, 0.002, -mw * 0.12, mh * 0.3, side * 0.0065, mat(C.book[Math.floor(rand() * C.book.length)], { roughness: 0.6 }));
        const grp = g.done();
        grp.position.set((rand() - 0.5) * (w - 2 * t - mw - 0.01), 0.05, side * (0.02 + i * 0.022));
        grp.rotation.x = side * (0.12 + i * 0.07);
        b.g.add(grp);
      }
  },
  terrarium: (b, w, d, h, f) => {
    // a faceted glass case in a metal frame: a hexagonal prism and a pyramid roof; sand,
    // pebbles, moss and plants inside
    const r = Math.min(w, d) / 2 - 0.006;
    const y1 = h * 0.45;
    const y2 = h - 0.01;
    const sides = 6;
    const corner = (i: number, rr: number, y: number) => v(Math.sin((i / sides) * Math.PI * 2) * rr, y, Math.cos((i / sides) * Math.PI * 2) * rr);
    b.add(new THREE.CylinderGeometry(r, r, y1 - 0.012, sides, 1, true), glass(), 0, 0.012 + (y1 - 0.012) / 2, 0);
    b.add(new THREE.ConeGeometry(r, y2 - y1, sides, 1, true), glass(), 0, y1 + (y2 - y1) / 2, 0);
    b.add(new THREE.CylinderGeometry(r + 0.004, r + 0.004, 0.012, sides), f, 0, 0.006, 0);
    const apex = v(0, y2, 0);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      b.rod(corner(i, r, 0.012), corner(i, r, y1), 0.003, f, 4);
      b.rod(corner(i, r, y1), corner(j, r, y1), 0.003, f, 4);
      b.rod(corner(i, r, y1), apex, 0.003, f, 4);
    }
    b.sphere(0.008, 0, y2, 0, f, 1, 1, 1, 8);
    // inside: sand, pebbles, a moss mound, a succulent, a little cactus
    const ri = r * 0.84;
    b.add(new THREE.CylinderGeometry(ri, ri, 0.035, sides), mat("#d8c39a", { roughness: 1 }), 0, 0.03, 0);
    const top = 0.047;
    const rand = random(389);
    const peb = [mat("#9a948a", { roughness: 0.8 }), mat("#f0ece4", { roughness: 0.8 }), mat("#5f5a54", { roughness: 0.8 })];
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2;
      const rr = ri * (0.4 + rand() * 0.45);
      b.add(new THREE.SphereGeometry(0.009 + rand() * 0.006, 6, 4).scale(1, 0.6, 1), peb[i % 3], Math.cos(a) * rr, top, Math.sin(a) * rr);
    }
    b.sphere(r * 0.38, r * 0.25, top - 0.01, -r * 0.2, mat("#5f8a3a", { roughness: 1 }), 1, 0.45, 1, 14);
    const sr = Math.min(0.045, r * 0.4);
    const succ = mat("#8fb39a", { roughness: 0.6 });
    for (let ring = 0; ring < 2; ring++)
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.SphereGeometry(sr * (0.55 - ring * 0.15), 6, 4).scale(0.6, 0.35, 1.2).translate(0, 0, sr * (0.5 - ring * 0.15));
        b.batch(leaf, succ, matrix(-r * 0.3, top + ring * sr * 0.3, r * 0.05, -0.3 - ring * 0.45, (i / 7) * Math.PI * 2 + ring * 0.45, 0));
      }
    b.add(new THREE.SphereGeometry(sr * 0.2, 6, 4), succ, -r * 0.3, top + sr * 0.45, r * 0.05);
    const cactus = mat("#4f7a45", { roughness: 0.8 });
    const ch = Math.min(0.08, y1 * 0.5);
    b.add(new THREE.CapsuleGeometry(0.016, ch, 4, 10), cactus, r * 0.22, top + ch / 2 + 0.01, r * 0.32);
    b.add(new THREE.CapsuleGeometry(0.009, 0.025, 3, 8).rotateZ(-0.9), cactus, r * 0.22 + 0.025, top + ch * 0.6, r * 0.32);
  },
  photo_frames: (b, w, _d, h, f, c) => {
    // three framed photos, each with a mount and an easel strut behind, leaning back a little
    const sizes: [number, number, number][] = [[-w * 0.32, Math.min(0.13, w * 0.26), h], [-w * 0.02, Math.min(0.1, w * 0.2), h * 0.72], [w * 0.29, Math.min(0.17, w * 0.34), h * 0.78]];
    const mount = mat("#f4f1ea", { roughness: 1 });
    sizes.forEach(([x, fw, fh], i) => {
      const g = new Builder();
      const bd = Math.min(0.016, fw * 0.12);
      g.box(fw, fh, 0.014, 0, 0, 0, f, 0.003);
      g.box(fw - 2 * bd, fh - 2 * bd, 0.002, 0, bd, 0.007, mount);
      art(g, fw - 2 * bd - 0.03, fh - 2 * bd - 0.03, bd + 0.015, 0.0085, ["blue", "terracotta", "green"][(i + c.length) % 3]);
      g.box(fw * 0.25, fh * 0.75, 0.006, 0, 0, -0.03, f)?.rotation.set(0.35, 0, 0);
      const grp = g.done();
      grp.position.set(x, 0, 0.01);
      grp.rotation.set(-0.1, (i - 1) * 0.12, 0);
      b.g.add(grp);
    });
  },
  stand_mixer: (b, w, d, h, f) => {
    // a tilt-head stand mixer: base, column, a rounded head with a trim band, steel bowl, beater
    const zb = -d / 2;
    const bwid = Math.min(w * 0.5, 0.17);
    const base = new THREE.ExtrudeGeometry(roundedRect(bwid, d - 0.02, 0.05), { depth: 0.04, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 6 }).rotateX(-Math.PI / 2);
    b.add(base, f, 0, 0.006, 0);
    const colH = h * 0.66;
    const cwid = Math.min(bwid * 0.75, 0.12);
    const col = new THREE.ExtrudeGeometry(roundedRect(cwid, 0.1, 0.04), { depth: colH, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
    b.add(col, f, 0, 0.04, zb + 0.055);
    const R = Math.min(0.075, w * 0.22, h * 0.21);
    const lh = d - 0.015;
    const hy = h - R;
    b.add(lathe([[0.001, 0], [R * 0.7, 0.004], [R * 0.92, 0.025], [R, 0.06], [R * 0.97, lh * 0.5], [R * 0.82, lh * 0.8], [R * 0.6, lh * 0.95], [R * 0.4, lh], [0.001, lh]], 24, 1.2).rotateX(Math.PI / 2), f, 0, hy, zb + 0.005);
    const chrome = mat("#d5d8db", { metalness: 0.5, roughness: 0.3 });
    b.add(new THREE.CylinderGeometry(R * 0.99, R * 0.99, 0.012, 24).rotateX(Math.PI / 2), chrome, 0, hy, zb + 0.005 + lh * 0.3);
    b.add(new THREE.CylinderGeometry(R * 0.36, R * 0.38, 0.012, 16).rotateX(Math.PI / 2), chrome, 0, hy, zb + 0.005 + lh + 0.004);
    // speed lever and tilt knob
    b.box(0.006, 0.01, 0.04, cwid / 2 + 0.003, 0.04 + colH * 0.85, zb + 0.06, chrome);
    b.sphere(0.012, -cwid / 2 - 0.004, 0.04 + colH * 0.5, zb + 0.06, chrome, 1, 1, 1, 10);
    // the bowl on its clamp plate, a handle, the beater
    const bz = zb + 0.005 + lh * 0.68;
    const rb = Math.min(0.085, bwid * 0.6, bz - (zb + 0.105) - 0.004);
    const bh = Math.min(0.15, hy - R - 0.07);
    b.cyl(rb * 0.62, rb * 0.62, 0.008, 0, 0.05, bz, chrome, 20);
    b.add(lathe([[0.001, 0], [rb * 0.55, 0], [rb * 0.62, 0.012], [rb * 0.94, bh * 0.55], [rb, bh - 0.004], [rb * 1.02, bh], [rb * 0.98, bh], [rb * 0.92, bh * 0.55], [rb * 0.58, 0.016], [0.001, 0.016]], 24), chrome, 0, 0.058, bz);
    b.add(new THREE.TorusGeometry(0.022, 0.005, 6, 10, Math.PI).rotateZ(-Math.PI / 2), chrome, rb * 0.9, 0.058 + bh * 0.6, bz);
    const al = mat("#d8dadc", { metalness: 0.5, roughness: 0.4 });
    // the beater turns while a linked mixer runs
    b.spinner(0, 0, bz, "y", () => {
      b.cyl(0.006, 0.006, hy - R - 0.058 - bh * 0.4, 0, 0.058 + bh * 0.4, bz, al, 8);
      const paddle = new THREE.Shape([new THREE.Vector2(-0.008, 0), new THREE.Vector2(0.008, 0), new THREE.Vector2(rb * 0.45, bh * 0.4), new THREE.Vector2(rb * 0.3, bh * 0.5), new THREE.Vector2(-rb * 0.3, bh * 0.5), new THREE.Vector2(-rb * 0.45, bh * 0.4)]);
      paddle.holes.push(new THREE.Path([new THREE.Vector2(-0.004, bh * 0.08), new THREE.Vector2(-rb * 0.32, bh * 0.4), new THREE.Vector2(rb * 0.32, bh * 0.4), new THREE.Vector2(0.004, bh * 0.08)]));
      b.add(new THREE.ExtrudeGeometry(paddle, { depth: 0.005, bevelEnabled: false }).rotateX(Math.PI).translate(0, bh * 0.5, 0.0025), al, 0, 0.058 + bh * 0.1 - bh * 0.0, bz);
    });
  },
  knife_block: (b, w, d, h, f) => {
    // a block leaning back, slots in its top, knife handles with steel bolsters and rivets
    const hb = h * 0.6;
    const bev = 0.005;
    const zb = -d / 2 + bev;
    const zf = d / 2 - bev;
    const lean = 0.3;
    const zt = zf - hb * Math.tan(lean);
    const s = new THREE.Shape();
    s.moveTo(zb, 0);
    s.lineTo(zf, 0);
    s.lineTo(zt, hb);
    s.lineTo(zb, hb * 0.72);
    s.lineTo(zb, 0);
    const block = new THREE.ExtrudeGeometry(s, { depth: w - 2 * bev - 0.004, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2 }).rotateY(-Math.PI / 2);
    b.add(block, f, w / 2 - bev - 0.002, bev, 0);
    // knives along the top face, standing out along the lean
    const q = new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), v(0, Math.cos(lean), -Math.sin(lean)));
    const handle = mat("#1c1c1c", { roughness: 0.6 });
    const bol = steel();
    const knives: [number, number, number, number][] = [[-0.3, 0.68, 0.012, 0.1], [-0.1, 0.68, 0.011, 0.095], [0.12, 0.68, 0.012, 0.1], [0.32, 0.68, 0.01, 0.085], [-0.22, 0.3, 0.009, 0.08], [0.05, 0.3, 0.009, 0.08], [0.28, 0.3, 0.008, 0.07]];
    for (const [fx, t, r, len] of knives) {
      const y = hb * 0.72 + bev + (hb - hb * 0.72) * t;
      const z = zb + (zt - zb) * t;
      const put = placer(b, new THREE.Matrix4().compose(v(fx * w, y, z), q, v(1, 1, 1)));
      put(new THREE.BoxGeometry(0.02, 0.004, 0.005), dark(), 0, 0, 0);
      put(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.012, 8).scale(0.75, 1, 1), bol, 0, 0.008, 0);
      put(new THREE.CapsuleGeometry(r, len, 3, 8).scale(0.75, 1, 1), handle, 0, 0.014 + r + len / 2, 0);
      for (const k of [0.25, 0.7]) put(new THREE.CylinderGeometry(r * 0.3, r * 0.3, r * 1.6, 6).rotateZ(Math.PI / 2), bol, 0, 0.014 + r + len * k, 0);
    }
  },
  bread_bin: (b, w, d, h, f) => {
    // a roll-top bin: a flat back, the lid curving down to the front, its seams and a handle
    const bev = 0.008;
    const R = Math.min(h * 0.6, d * 0.6);
    const zf = d / 2 - bev;
    const zb = -d / 2 + bev;
    const top = h - 2 * bev;
    const s = new THREE.Shape();
    s.moveTo(zb, 0);
    s.lineTo(zf, 0);
    s.lineTo(zf, top - R);
    s.absarc(zf - R, top - R, R, 0, Math.PI / 2, false);
    s.lineTo(zb, top);
    s.lineTo(zb, 0);
    const body = new THREE.ExtrudeGeometry(s, { depth: w - 2 * bev, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 14 }).rotateY(-Math.PI / 2);
    b.add(body, f, w / 2 - bev, bev, 0);
    const seam = mat("#1d1e20", { roughness: 1 });
    const sy = top - R + bev;
    b.box(w - 0.004, 0.004, 0.003, 0, sy - 0.002, d / 2 - 0.0005, seam);
    for (const sx of [-1, 1]) b.add(new THREE.TorusGeometry(R * 0.92, 0.0018, 3, 14, Math.PI / 2).rotateY(-Math.PI / 2), seam, sx * (w / 2 + 0.0004), sy, zf - R);
    // a handle on the lid's curve
    const hy = sy + Math.min(0.03, R * 0.35);
    const hz = zf - R + Math.sqrt(R * R - (hy - sy) ** 2) + bev;
    const wood = mat("#6e4b33", { roughness: 0.6 });
    b.box(Math.min(0.12, w * 0.3), 0.016, 0.014, 0, hy, hz + 0.008, wood, 0.006);
    for (const sx of [-1, 1]) b.box(0.012, 0.012, 0.012, sx * Math.min(0.05, w * 0.12), hy + 0.002, hz, wood);
  },
  pots_pans: (b, w, d, h, f) => {
    // a casserole with its lid, knob and loop handles; a frying pan with a dark inside and a long handle
    const pr = Math.min(0.105, w * 0.2, d * 0.28);
    const fr = Math.min(0.115, w * 0.21, d * 0.3);
    const ph = h * 0.72;
    const px = -w / 2 + pr + 0.035;
    const pz = -d / 2 + pr + 0.005;
    b.add(lathe([[0.001, 0], [pr * 0.92, 0], [pr, 0.012], [pr, ph], [pr * 0.96, ph], [pr * 0.96, 0.012], [0.001, 0.012]], 28), f, px, 0, pz);
    b.add(lathe([[0.001, 0], [pr * 1.02, 0], [pr * 0.98, 0.012], [pr * 0.6, (h - ph) * 0.6], [0.001, (h - ph) * 0.7]], 28, 1.2), f, px, ph - 0.004, pz);
    b.add(lathe([[0.001, 0], [0.012, 0], [0.01, 0.012], [0.02, 0.016], [0.018, 0.024], [0.001, 0.024]], 12, 1.2), mat(C.black, { roughness: 0.5 }), px, ph - 0.008 + (h - ph) * 0.7, pz);
    for (const sx of [-1, 1]) b.add(new THREE.TorusGeometry(0.026, 0.007, 6, 10, Math.PI).rotateX(Math.PI / 2).rotateY((sx * Math.PI) / 2), f, px + sx * pr * 0.9, ph * 0.84, pz);
    // the pan in front, beside the pot, its handle towards the back right
    const fh = Math.min(0.05, h * 0.3);
    const fz = d / 2 - fr - 0.005;
    const dz = fz - pz;
    const fx = px + Math.sqrt(Math.max(0, (pr + fr + 0.015) ** 2 - dz * dz));
    const panIn = mat("#2b2b2b", { roughness: 0.5 });
    b.add(lathe([[0.001, 0], [fr * 0.82, 0], [fr * 0.86, 0.006], [fr, fh], [fr - 0.005, fh]], 32), f, fx, 0, fz);
    b.add(lathe([[fr - 0.005, fh], [fr * 0.84, 0.01], [0.001, 0.01]], 32), panIn, fx, 0, fz);
    const ang = 0.4;
    const dir = v(Math.cos(ang), 0.12, -Math.sin(ang)).normalize();
    const a0 = v(fx + Math.cos(ang) * fr * 0.97, fh * 0.75, fz - Math.sin(ang) * fr * 0.97);
    const reach = Math.max(0.08, Math.min(0.2, (w / 2 - 0.015 - a0.x) / dir.x));
    const a1 = a0.clone().addScaledVector(dir, reach);
    const stub = a0.clone().lerp(a1, 0.2);
    b.rod(a0, stub, 0.007, steel(), 8);
    const grip = b.add(new THREE.CapsuleGeometry(0.011, reach * 0.72, 3, 8).scale(1, 1, 0.65), mat(C.black, { roughness: 0.6 }));
    grip.position.copy(stub.clone().lerp(a1, 0.5));
    grip.quaternion.setFromUnitVectors(v(0, 1, 0), dir);
  },
  dish_rack: (b, w, d, h, f) => {
    // a drip tray, a wire basket with tines, plates standing up, mugs and a glass, a cutlery cup
    const wire = mat(C.chrome, { metalness: 0.6, roughness: 0.3 });
    b.box(w, 0.012, d, 0, 0, 0, f, 0.004);
    for (const sz of [-1, 1]) b.box(w, 0.016, 0.006, 0, 0.012, sz * (d / 2 - 0.003), f);
    for (const sx of [-1, 1]) b.box(0.006, 0.016, d - 0.012, sx * (w / 2 - 0.003), 0.012, 0, f);
    const ww = w - 0.03;
    const wd = d - 0.03;
    const wy = 0.03;
    const top = Math.min(0.12, h * 0.5);
    for (const y of [wy, wy + top]) {
      for (const sz of [-1, 1]) b.rod(v(-ww / 2, y, (sz * wd) / 2), v(ww / 2, y, (sz * wd) / 2), 0.0025, wire, 4);
      for (const sx of [-1, 1]) b.rod(v((sx * ww) / 2, y, -wd / 2), v((sx * ww) / 2, y, wd / 2), 0.0025, wire, 4);
    }
    for (let i = 1; i < 4; i++) b.rod(v(-ww / 2 + (ww / 4) * i, wy, -wd / 2), v(-ww / 2 + (ww / 4) * i, wy, wd / 2), 0.002, wire, 4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(v((sx * ww) / 2, 0.012, (sz * wd) / 2), v((sx * ww) / 2, wy + top, (sz * wd) / 2), 0.0025, wire, 4);
    // plates on the left half between tines
    const pr = Math.min(0.11, h * 0.46, wd * 0.42);
    const step = 0.038;
    const plates = Math.max(3, Math.floor((ww * 0.55) / step));
    const pm = mat(C.ceramic, { roughness: 0.35 });
    const plate = lathe([[0.001, 0], [pr * 0.55, 0], [pr, 0.016], [pr * 0.96, 0.019], [pr * 0.55, 0.006], [0.001, 0.006]], 14);
    for (let i = 0; i < plates; i++) {
      const x = -ww / 2 + 0.03 + i * step;
      b.batch(plate.clone().rotateZ(Math.PI / 2), pm, matrix(x, wy + pr + 0.002, 0, 0, 0, -0.12));
      for (const sz of [-1, 1]) b.rod(v(x + step / 2, wy, sz * pr * 0.55), v(x + step / 2, wy + 0.07, sz * pr * 0.5), 0.0018, wire, 4);
    }
    // right half: two mugs one behind the other, a cutlery cup at the front
    const rx = -ww / 2 + 0.03 + plates * step;
    const room = ww / 2 - rx;
    if (room > 0.08) {
      const cx = rx + room / 2;
      const mr = Math.min(0.034, room * 0.3);
      const mh = Math.min(0.09, h * 0.38);
      for (let k = 0; k < 2; k++) {
        const m = mat(k ? "#e3c46b" : "#3f6c8f", { roughness: 0.4 });
        const z = -wd / 2 + mr + 0.015 + k * (mr * 2 + 0.012);
        b.cyl(mr, mr * 0.95, mh, cx - 0.008, wy + 0.003, z, m, 16);
        b.add(new THREE.TorusGeometry(mh * 0.28, 0.006, 6, 10, Math.PI).rotateZ(-Math.PI / 2), m, cx - 0.008 + mr * 0.9, wy + 0.003 + mh * 0.5, z);
      }
      const cz = wd / 2 - 0.04;
      const cwid = Math.min(0.1, room - 0.02);
      b.box(cwid, 0.1, 0.06, cx, wy, cz, mat(C.chrome, { metalness: 0.5, roughness: 0.35 }));
      const cut = mat(C.steel, { metalness: 0.7, roughness: 0.3 });
      for (let k = 0; k < 5; k++) {
        const x = cx - cwid * 0.35 + k * cwid * 0.175;
        b.rod(v(x, wy + 0.06, cz - 0.01 + (k % 2) * 0.02), v(x + (k - 2) * 0.006, wy + 0.16, cz - 0.015 + (k % 2) * 0.03), 0.0035, cut, 4);
      }
    }
  },
};
