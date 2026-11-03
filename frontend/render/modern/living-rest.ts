// More detailed built-in pieces: living rest. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import type { Build, Builder } from "../modern";
import { FINISHES } from "../../model/modern";
import { C, glass, glowing, mat, matrix, part, random, rugMaterial, screenMat, shadeMat, v, ledMat, foliage, fronts } from "../modern";

// ----- small helpers -----

type M = THREE.Material;

/** A lacquered (glossy) copy of a finish, shared per finish. */
const glossy = new Map<M, THREE.MeshStandardMaterial>();
function lacquer(f: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = glossy.get(f);
  if (!m) {
    m = f.clone();
    m.roughness = 0.22;
    m.metalness = 0.05;
    glossy.set(f, m);
  }
  return m;
}
const brass = () => mat(FINISHES.brass, { metalness: 0.75, roughness: 0.3 });
const iron = () => mat("#1d1e20", { metalness: 0.4, roughness: 0.6 });
const sootM = () => mat("#141210", { roughness: 1 });
const ivory = () => mat("#f4f1e8", { roughness: 0.35 });
const ebony = () => mat("#121214", { roughness: 0.3 });
const flameMats = () => [
  part(mat("#ff8a2a", { emissive: "#ff6a12", emissiveIntensity: 1 }), "fire"),
  part(mat("#ffc04a", { emissive: "#ffa524", emissiveIntensity: 1 }), "fire"),
  part(mat("#fff0a0", { emissive: "#ffd86a", emissiveIntensity: 1 }), "fire"),
];
const emberM = () => part(mat("#c2401c", { emissive: "#b8360f", emissiveIntensity: 0.8, roughness: 1 }), "fire");

/** A lathe from [radius, y] pairs. */
function lathe(pts: [number, number][], seg = 24): THREE.LatheGeometry {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), seg);
}

/** A tapered round rod from a (radius r0) to c (radius r1). */
function taper(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r0: number, r1: number, m: M, seg = 10) {
  const len = a.distanceTo(c);
  const mesh = b.add(new THREE.CylinderGeometry(r1, r0, len, seg), m);
  mesh.position.copy(a).add(c).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
  return mesh;
}

/** A tapered square leg from a (side s0) to c (side s1). */
function squareTaper(b: Builder, a: THREE.Vector3, c: THREE.Vector3, s0: number, s1: number, m: M) {
  const mesh = taper(b, a, c, s0 * Math.SQRT1_2, s1 * Math.SQRT1_2, m, 4);
  mesh.geometry.rotateY(Math.PI / 4);
  return mesh;
}

/** A split log: bark round, light end grain at both ends; along x, turned by ry around y. */
function log(b: Builder, x: number, y: number, z: number, len: number, r: number, ry = 0, rz = 0) {
  const geo = new THREE.CylinderGeometry(r, r * 0.92, len, 9);
  geo.rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, [mat("#4f3a2b", { roughness: 1 }), mat("#c9a77c", { roughness: 1 }), mat("#c9a77c", { roughness: 1 })]);
  mesh.position.set(x, y, z);
  mesh.rotation.set(0, ry, rz, "YXZ");
  b.g.add(mesh);
  return mesh;
}

/** Flames between x0 and x1 standing on y (glowing, the "fire" part). */
function flames(b: Builder, rand: () => number, x0: number, x1: number, y: number, z: number, h: number, depth = 0.08) {
  const ms = flameMats();
  const n = Math.max(4, Math.round((x1 - x0) / 0.055));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 0.02;
    // taller in the middle
    const fh = h * (0.45 + 0.55 * Math.sin(Math.PI * t) * (0.6 + rand() * 0.4));
    const r = Math.min(0.045, ((x1 - x0) / n) * 0.75) * (0.9 + rand() * 0.5);
    const lean = (rand() - 0.5) * 0.25;
    for (const [k, s] of (i % 2 ? [[0, 1], [2, 0.5]] : [[0, 1], [1, 0.62]]) as [number, number][]) {
      const geo = lathe([[0, 0], [r * s, fh * s * 0.12], [r * s * 0.85, fh * s * 0.35], [r * s * 0.4, fh * s * 0.7], [0, fh * s]], 6);
      b.batch(geo, ms[k], matrix(x, y, z + (rand() - 0.5) * depth + k * 0.008, 0, rand() * 3, lean));
    }
  }
}

/** An 88-key keyboard (A0..C8) w wide on y, its front edge at zFront. */
function keyboard(b: Builder, w: number, y: number, zFront: number, depth = 0.15) {
  const white = 52;
  const kw = w / white;
  for (let i = 0; i < white; i++) {
    b.batch(new THREE.BoxGeometry(kw - 0.0014, 0.022, depth), ivory(), matrix(-w / 2 + kw * (i + 0.5), y + 0.011, zFront - depth / 2));
    if (i < white - 1 && "ACDFG".includes("ABCDEFG"[i % 7]))
      b.batch(new THREE.BoxGeometry(kw * 0.56, 0.014, depth * 0.62), ebony(), matrix(-w / 2 + kw * (i + 1), y + 0.029, zFront - depth + (depth * 0.62) / 2));
  }
  // the felt strip behind the keys
  b.box(w, 0.012, 0.012, 0, y + 0.012, zFront - depth - 0.006, mat("#6b1f22", { roughness: 1 }));
}

// ----- books and things on shelves -----

const BOOK = ["#b5523b", "#3f6c8f", "#e3c46b", "#5f8a5c", "#7a5a8c", "#d9d4c7", "#2f3e55", "#8a3b3b", "#c9b9a0", "#3a3a3a", "#e8e4dc", "#9a6b3f", "#6f8fa6"];

function book(b: Builder, rand: () => number, bw: number, bh: number, bd: number, x: number, y: number, z: number, rz = 0, ry = 0) {
  b.batch(new THREE.BoxGeometry(bw, bh, bd), mat(BOOK[Math.floor(rand() * BOOK.length)], { roughness: 0.85 }), matrix(x, y, z, 0, ry, rz));
}

/** A small vase, bowl, plant or box standing at (x, y, z), at most maxH tall and maxW wide. */
function ornament(b: Builder, rand: () => number, x: number, y: number, z: number, maxH: number, maxW: number) {
  const k = rand();
  const tone = mat(["#f3f3f1", "#b5683f", "#5d7a60", "#2b2c2e", "#c4b08f", "#4d6a88"][Math.floor(rand() * 6)], { roughness: 0.5 });
  if (k < 0.45) {
    const r = Math.min(maxW / 2, 0.055);
    const hh = Math.min(maxH, r * (2.4 + rand() * 1.4));
    b.add(lathe([[0, 0], [r * 0.7, 0], [r, hh * 0.3], [r * 0.9, hh * 0.65], [r * 0.45, hh * 0.88], [r * 0.5, hh], [r * 0.4, hh], [0, hh * 0.9]], 14), tone, x, y, z);
  } else if (k < 0.7) {
    const r = Math.min(maxW / 2, 0.08);
    b.add(lathe([[0, 0], [r * 0.5, 0], [r * 0.9, r * 0.35], [r, r * 0.6], [r * 0.92, r * 0.6], [0, r * 0.12]], 16), tone, x, y, z);
  } else if (k < 0.85 && maxH > 0.12) {
    const r = Math.min(maxW / 2, 0.05);
    b.add(lathe([[0, 0], [r * 0.8, 0], [r, r * 1.6], [r * 0.9, r * 1.6], [0, r * 1.5]], 12), tone, x, y, z);
    const fr = Math.min(r * 1.2, (maxH - r * 1.6) / 2);
    foliage(b, rand, x, y + r * 1.6 + fr * 0.8, z, r * 1.3, fr, r * 1.3, 14, r * 0.8, [C.leaf, C.leafLight, C.leafDark], true);
  } else {
    const bw = Math.min(maxW, 0.14);
    b.box(bw, Math.min(maxH, 0.08), bw * 0.7, x, y, z, tone, 0.004);
  }
}

/**
 * Fills a shelf between x0 and x1 at y (clear height maxH, depth `depth` around z):
 * groups of books of mixed heights, one leaning on its group, lying stacks, ornaments, gaps.
 */
function fillShelf(b: Builder, rand: () => number, x0: number, x1: number, y: number, maxH: number, depth: number, z: number, decor = true) {
  const front = z + depth / 2 - 0.01;
  let x = x0 + 0.01;
  while (x < x1 - 0.04) {
    const room = x1 - x;
    const r = rand();
    if (r < 0.58 || !decor) {
      // a group of standing books
      const end = x + Math.min(room, 0.12 + rand() * 0.4);
      const tall = maxH * (0.65 + rand() * 0.3);
      let lastH = 0;
      while (x < end - 0.02) {
        const bw = 0.018 + rand() * 0.032;
        const bh = Math.max(0.06, Math.min(maxH - 0.01, tall * (0.78 + rand() * 0.22)));
        const bd = Math.min(depth - 0.02, bh * (0.62 + rand() * 0.15));
        book(b, rand, bw, bh, bd, x + bw / 2, y + bh / 2, front - bd / 2);
        x += bw + 0.0015;
        lastH = bh;
      }
      // the last one leans on the group
      if (rand() < 0.35 && x1 - x > 0.14 && lastH > 0) {
        const a = 0.22 + rand() * 0.2;
        const bw = 0.022 + rand() * 0.02;
        const bh = Math.min(lastH * 0.95, maxH - 0.01);
        const bd = Math.min(depth - 0.02, bh * 0.68);
        const xr = x + bw * Math.cos(a) + bh * Math.sin(a);
        book(b, rand, bw, bh, bd, xr - (bw / 2) * Math.cos(a) - (bh / 2) * Math.sin(a), y - (bw / 2) * Math.sin(a) + (bh / 2) * Math.cos(a), front - bd / 2, a);
        x = xr + 0.03;
      } else x += 0.015 + rand() * 0.04;
    } else if (r < 0.74 && room > 0.22) {
      // a lying stack, sometimes with an ornament on top
      const n = 2 + Math.floor(rand() * 4);
      const sw = 0.15 + rand() * 0.06;
      let sy = y;
      for (let i = 0; i < n && sy < y + maxH - 0.06; i++) {
        const t = 0.022 + rand() * 0.02;
        const bw = sw * (0.82 + rand() * 0.18);
        const bd = Math.min(depth - 0.03, bw * 0.75);
        book(b, rand, bw, t, bd, x + sw / 2, sy + t / 2, front - bd / 2, 0, (rand() - 0.5) * 0.15);
        sy += t;
      }
      if (rand() < 0.5 && y + maxH - sy > 0.08) ornament(b, rand, x + sw / 2, sy, z, y + maxH - sy - 0.01, sw * 0.6);
      x += sw + 0.03;
    } else if (r < 0.88 && room > 0.15) {
      ornament(b, rand, x + 0.06, y, z, maxH - 0.02, 0.12);
      x += 0.15;
    } else x += 0.06 + rand() * 0.1;
  }
}

/** A bookcase: sides, top, a plinth, a back panel and `rows` shelves; the shelves' tops returned. */
function bookcase(b: Builder, w: number, d: number, h: number, f: M, rows: number, plinth = 0.07, t = 0.022) {
  b.box(t, h, d, -w / 2 + t / 2, 0, 0, f);
  b.box(t, h, d, w / 2 - t / 2, 0, 0, f);
  b.box(w, t, d, 0, h - t, 0, f, 0.003);
  b.box(w - 2 * t, plinth, 0.02, 0, 0, d / 2 - 0.03, f);
  b.box(w - 2 * t, h - t, 0.008, 0, 0, -d / 2 + 0.004, f);
  // a little shade on the back panel so the shelves read as deep
  b.box(w - 2 * t, h - plinth - t, 0.002, 0, plinth, -d / 2 + 0.009, mat("#000000", { transparent: true, opacity: 0.18 }));
  const ys: number[] = [];
  for (let i = 0; i < rows; i++) {
    const y = plinth + (i * (h - t - plinth)) / rows;
    b.box(w - 2 * t, t, d - 0.012, 0, y, 0.006, f);
    ys.push(y + t);
  }
  return { ys, rowH: (h - t - plinth) / rows - t };
}

/** Is (x, y) inside the polygon? */
function pointIn(ps: THREE.Vector2[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const a = ps[i];
    const c = ps[j];
    if (a.y > y !== c.y > y && x < ((c.x - a.x) * (y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Where a vertical line at x crosses a polygon: the largest y. */
function topAt(ps: THREE.Vector2[], x: number) {
  let best = -Infinity;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const a = ps[i];
    const c = ps[j];
    if (a.x > x !== c.x > x) best = Math.max(best, a.y + ((x - a.x) * (c.y - a.y)) / (c.x - a.x));
  }
  return best;
}
/** Where a horizontal line at y crosses a polygon: the largest x. */
function rightAt(ps: THREE.Vector2[], y: number) {
  let best = -Infinity;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const a = ps[i];
    const c = ps[j];
    if (a.y > y !== c.y > y) best = Math.max(best, a.x + ((y - a.y) * (c.x - a.x)) / (c.y - a.y));
  }
  return best;
}

// ----- fireplaces -----

/**
 * A block w × h × d (bottom centre at x, y, z) with rectangular openings through it, each
 * [centre x, bottom y, width, height] relative to the block's bottom centre. One extruded piece:
 * no seams where parts would meet.
 */
function opened(b: Builder, w: number, h: number, d: number, x: number, y: number, z: number, holes: [number, number, number, number][], m: M) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.lineTo(-w / 2, 0);
  for (const [hx, hy, hw, hh] of holes) {
    const p = new THREE.Path();
    p.moveTo(hx - hw / 2, hy);
    p.lineTo(hx - hw / 2, hy + hh);
    p.lineTo(hx + hw / 2, hy + hh);
    p.lineTo(hx + hw / 2, hy);
    p.lineTo(hx - hw / 2, hy);
    s.holes.push(p);
  }
  return b.add(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }), m, x, y, z - d / 2);
}

/** Glowing embers: small chunks scattered over a bed between x0 and x1 at y. */
function embers(b: Builder, rand: () => number, x0: number, x1: number, y: number, z: number, depth: number, n: number) {
  const m = emberM();
  for (let i = 0; i < n; i++) {
    const s = 0.012 + rand() * 0.018;
    b.batch(new THREE.BoxGeometry(s, s * 0.6, s * 0.9), m, matrix(x0 + rand() * (x1 - x0), y + s * 0.25, z + (rand() - 0.5) * depth, rand(), rand() * 3, rand()));
  }
}

/**
 * The inside of a firebox behind an opening ow × oh whose front is at zFront: a firebrick
 * back with joints, sooty sides and top, an ash floor; logs on a grate, embers and flames.
 */
function firebox(b: Builder, rand: () => number, y: number, zFront: number, ow: number, oh: number, depth: number, fuel: "logs" | "pebbles" | "ceramic") {
  const soot = sootM();
  const zb = zFront - depth;
  b.box(ow, oh, 0.02, 0, y, zb + 0.01, mat("#5a3528", { roughness: 1 }));
  const joint = mat("#2a1d18", { roughness: 1 });
  const rows = Math.max(2, Math.floor(oh / 0.065));
  for (let r = 1; r < rows; r++) b.box(ow, 0.005, 0.004, 0, y + (r * oh) / rows, zb + 0.021, joint);
  for (let r = 0; r < rows; r++)
    for (let x = -ow / 2 + ((r % 2) + 1) * 0.11; x < ow / 2 - 0.03; x += 0.22) b.box(0.005, oh / rows, 0.004, x, y + (r * oh) / rows, zb + 0.021, joint);
  for (const sx of [-1, 1]) b.box(0.012, oh, depth, sx * (ow / 2 - 0.006), y, zFront - depth / 2, soot);
  b.box(ow, 0.012, depth, 0, y + oh - 0.012, zFront - depth / 2, soot);
  b.box(ow, 0.012, depth, 0, y, zFront - depth / 2, mat("#4a4542", { roughness: 1 }));
  const fy = y + 0.012;
  const zc = zFront - depth / 2;
  const fw = ow * 0.72;
  if (fuel === "pebbles") {
    // a gas fire: a bed of pale pebbles, a burner line of flames
    const peb = [mat("#e9e6e0", { roughness: 0.6 }), mat("#bdb8b0", { roughness: 0.6 })];
    for (let i = 0; i < Math.round(ow * 45); i++) {
      const r = 0.014 + rand() * 0.012;
      const g = new THREE.SphereGeometry(r, 5, 3);
      g.scale(1, 0.55, 1);
      b.batch(g, peb[i % 2], matrix(-ow / 2 + 0.02 + rand() * (ow - 0.04), fy + r * 0.4, zc + (rand() - 0.5) * (depth - 0.03)));
    }
    flames(b, rand, -fw / 2, fw / 2, fy + 0.01, zc, oh * 0.6, 0.04);
    return;
  }
  // a grate of iron bars
  if (fuel === "logs") {
    const gw = Math.min(fw, 0.6);
    for (const dz of [-0.06, 0.06]) b.box(gw, 0.015, 0.015, 0, fy + 0.04, zc + dz, iron());
    for (let i = 0; i < 6; i++) b.box(0.012, 0.015, 0.14, -gw / 2 + (gw * (i + 0.5)) / 6, fy + 0.055, zc, iron());
    for (const sx of [-1, 1]) for (const dz of [-0.06, 0.06]) b.box(0.015, 0.04, 0.015, sx * (gw / 2 - 0.01), fy, zc + dz, iron());
  }
  const ly = fuel === "logs" ? fy + 0.07 : fy + 0.03;
  const lr = Math.min(0.045, oh * 0.1);
  const lw = Math.min(fw, 0.55);
  if (fuel === "ceramic") b.box(ow - 0.03, 0.02, depth - 0.03, 0, fy, zc, mat("#3a3836", { roughness: 1 }));
  log(b, -lw * 0.18, ly + lr, zc - 0.03, lw * 0.75, lr, 0.12);
  log(b, lw * 0.2, ly + lr, zc + 0.02, lw * 0.7, lr * 0.9, -0.18);
  log(b, 0, ly + lr * 2.6, zc - 0.005, lw * 0.6, lr * 0.85, 0.05, 0.08);
  embers(b, rand, -lw / 2, lw / 2, ly - 0.005, zc, 0.12, 22);
  flames(b, rand, -lw * 0.45, lw * 0.45, ly + lr, zc, Math.min(oh - (ly - y) - lr - 0.03, oh * 0.62, 0.32), 0.07);
}

// ----- TV and media -----

/** A flat TV tw × th with its bottom at y, the screen's front at z: bezel, screen, a back housing. */
function tvSet(b: Builder, tw: number, th: number, y: number, z: number) {
  const body = mat("#1b1c1f", { roughness: 0.45, metalness: 0.2 });
  b.box(tw, th, 0.012, 0, y, z - 0.006, body, 0.003);
  b.box(tw - 0.012, th - 0.012, 0.002, 0, y + 0.006, z + 0.001, screenMat());
  // a thicker housing behind the lower half, a logo strip and a status light under the screen
  b.box(tw * 0.72, th * 0.55, 0.035, 0, y + th * 0.12, z - 0.012 - 0.0175, body, 0.01);
  b.box(0.05, 0.004, 0.002, 0, y + 0.002, z + 0.0005, mat("#8a8d92", { metalness: 0.6, roughness: 0.3 }));
  b.box(0.006, 0.004, 0.002, tw * 0.3, y + 0.002, z + 0.0005, ledMat("#e24a3a"));
}

/** A media unit: a carcass w × h × d on y, push fronts with grip slots and an open middle bay. */
function mediaUnit(b: Builder, w: number, d: number, y: number, h: number, f: M) {
  const t = 0.02;
  b.box(w, t, d, 0, y + h - t, 0, f, 0.004);
  b.box(w, t, d, 0, y, 0, f, 0.003);
  for (const sx of [-1, 1]) b.box(t, h - 2 * t, d, sx * (w / 2 - t / 2), y + t, 0, f);
  b.box(w - 2 * t, h - 2 * t, 0.01, 0, y + t, -d / 2 + 0.005, f);
  const n = Math.max(3, Math.round(w / 0.55)) | 1;
  const cw = (w - 2 * t) / n;
  const mid = (n - 1) / 2;
  const ch = h - 2 * t;
  const zf = d / 2 - 0.02;
  const slot = mat("#1e1f22", { roughness: 1 });
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + t + cw * (i + 0.5);
    if (i > 0) b.box(t * 0.8, ch, d - 0.03, -w / 2 + t + cw * i, y + t, -0.005, f);
    if (i === mid && n > 2) {
      // the open bay: a shelf, a receiver with its display, a console standing beside it
      const sy = y + t + ch * 0.48;
      b.box(cw - t, 0.016, d - 0.04, x, sy, -0.01, f);
      const box = mat("#202124", { roughness: 0.5 });
      const rw = Math.min(cw * 0.7, 0.43);
      const rh = Math.min(ch * 0.4, 0.08);
      b.box(rw, rh, d * 0.7, x - (cw - rw) / 2 + 0.03, y + t, -0.02, box, 0.004);
      b.box(rw * 0.35, rh * 0.25, 0.002, x - (cw - rw) / 2 + 0.03, y + t + rh * 0.55, -0.02 + d * 0.35 + 0.001, ledMat("#5fb3ff"));
      if (ch * 0.5 > 0.1) {
        const cwid = Math.min(0.26, cw * 0.55);
        b.box(cwid, Math.min(0.06, ch * 0.45), d * 0.6, x + (cw - cwid) / 2 - 0.04, sy + 0.016, -0.03, mat("#e9e9ea", { roughness: 0.4 }), 0.01);
        b.box(0.03, 0.04, 0.03, x - cw * 0.25, sy + 0.016, 0.02, mat("#2a2b2e"), 0.01);
      }
      continue;
    }
    b.box(cw - 0.006, ch - 0.006, 0.018, x, y + t + 0.003, zf + 0.009, f, 0.003);
    // a routed finger grip along the top edge
    b.box(Math.min(0.16, cw * 0.4), 0.012, 0.004, x, y + t + ch - 0.03, zf + 0.0185, slot);
  }
}

/** Tassels along both short ends (±x) of a rug w × d, each fl long. */
function fringe(b: Builder, w: number, d: number, fl: number, h: number) {
  const m = mat("#eee6d4", { roughness: 1 });
  const n = Math.max(4, Math.round(d / 0.035));
  for (const sx of [-1, 1])
    for (let i = 0; i < n; i++) {
      const z = -d / 2 + (d * (i + 0.5)) / n;
      b.batch(new THREE.BoxGeometry(fl, Math.max(0.003, h * 0.4), 0.012), m, matrix(sx * (w / 2 - fl / 2), Math.max(0.0015, h * 0.2), z, 0, sx * (((i * 7) % 5) - 2) * 0.05, 0));
    }
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  // ----- pianos -----
  piano_upright: (b, w, d, h, f) => {
    const lac = lacquer(f);
    const kh = Math.min(0.72, h * 0.58);
    const bd = Math.min(d * 0.6, 0.36);
    const zb = -d / 2 + bd; // the body's front
    const cheek = 0.055;
    // the tall body: sides, a lid with an overhang, an upper panel with a raised frame
    const full = h;
    h = full - 0.05;
    for (const sx of [-1, 1]) b.box(0.035, h - 0.03, bd, sx * (w / 2 - 0.0175), 0, -d / 2 + bd / 2, lac, 0.006);
    b.box(w, 0.03, bd + 0.025, 0, h - 0.03, -d / 2 + bd / 2 + 0.0125, lac, 0.01);
    const upY = kh + 0.15;
    b.box(w - 0.07, h - 0.03 - upY, 0.03, 0, upY, zb - 0.015, lac);
    const pw = w - 0.24;
    const ph = h - 0.03 - upY - 0.12;
    for (const sx of [-1, 1]) b.box(0.025, ph, 0.012, sx * (pw / 2 - 0.0125), upY + 0.06, zb + 0.006, lac, 0.004);
    for (const yy of [upY + 0.06, upY + 0.06 + ph - 0.025]) b.box(pw, 0.025, 0.012, 0, yy, zb + 0.006, lac, 0.004);
    // the music desk: a ledge with sheet music leaning on the panel
    b.box(w - 0.3, 0.025, 0.05, 0, upY + 0.04, zb + 0.02, lac, 0.006);
    const sheet = mat("#f6f3ea", { roughness: 1, side: THREE.DoubleSide });
    for (const [sx, ry] of [[-1, 0.06], [1, -0.06]] as const) {
      const p = b.add(new THREE.PlaneGeometry(0.2, 0.28), sheet, sx * 0.104, upY + 0.065 + 0.14, zb + 0.034 + (sx > 0 ? 0.004 : 0));
      p.rotation.set(-0.12, ry, 0, "YXZ");
    }
    // the fallboard, folded open above the keys, and the maker's name in brass
    b.box(w - 2 * cheek - 0.01, 0.1, 0.06, 0, kh + 0.05, zb + 0.025, lac, 0.012);
    b.box(0.08, 0.008, 0.002, 0, kh + 0.11, zb + 0.056, brass());
    // the keybed, the keys, the cheeks at both ends
    const zk = Math.min(d / 2 - 0.06, zb + 0.2);
    b.box(w - 0.04, 0.05, zk - zb + 0.02, 0, kh - 0.05, (zk + zb) / 2 + 0.01, lac, 0.006);
    keyboard(b, w - 2 * cheek - 0.01, kh, zk, 0.15);
    for (const sx of [-1, 1]) b.box(cheek, 0.11, zk - zb + 0.03, sx * (w / 2 - cheek / 2 - 0.01), kh - 0.05, (zk + zb) / 2 + 0.015, lac, 0.012);
    // the knee board under the keys, the toe blocks and legs to the front
    b.box(w - 0.07, kh - 0.11, 0.025, 0, 0.06, zb - 0.0125, lac, 0.004);
    b.box(w - 0.07, 0.06, 0.04, 0, 0, zb - 0.025, lac, 0.004);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - cheek / 2 - 0.02);
      b.box(cheek, 0.05, d / 2 - zb - 0.01, x, 0, (d / 2 + zb) / 2 - 0.005, lac, 0.01);
      b.box(cheek * 0.75, kh - 0.1, cheek * 0.75, x, 0.05, zk - 0.05, lac, 0.008);
    }
    // three pedals
    for (const px of [-0.07, 0, 0.07]) b.box(0.025, 0.014, 0.1, px, 0.06, zb + 0.04, brass(), 0.005);
    b.box(0.26, 0.04, 0.012, 0, 0.05, zb - 0.002, brass(), 0.004);
    // a metronome on the lid
    b.add(new THREE.CylinderGeometry(0.01, 0.05, 0.13, 4, 1).rotateY(Math.PI / 4), lacquer(mat("#5b3a26", { roughness: 0.5 })), w * 0.3, h + 0.065, -d / 2 + bd / 2);
    b.rod(v(w * 0.3, h + 0.03, -d / 2 + bd / 2 + 0.03), v(w * 0.3 + 0.03, h + 0.12, -d / 2 + bd / 2 + 0.034), 0.002, brass(), 4);
    void full;
  },
  piano_grand: (b, w, d, h, f) => {
    const lac = lacquer(f);
    // front to back: key slip, keys, the case; the curved side on the right (treble)
    const kd = 0.15;
    const zSlip = d / 2;
    const zKeys = zSlip - 0.025;
    const zCase = zKeys - kd - 0.05;
    const L = zCase + d / 2;
    const top = h * 0.7;
    const caseH = Math.min(0.3, top * 0.42);
    const yc = top - caseH;
    const ky = yc + caseH * 0.42;
    // the outline in shape coordinates (x, -z), from a path scaled to fill w × L
    const path = new THREE.Path();
    path.moveTo(-0.5, 0);
    path.lineTo(0.5, 0);
    path.lineTo(0.5, 0.2);
    path.bezierCurveTo(0.5, 0.48, 0.08, 0.55, 0.02, 0.8);
    path.bezierCurveTo(-0.04, 1.03, -0.5, 1.03, -0.5, 0.88);
    path.lineTo(-0.5, 0);
    const raw = path.getSpacedPoints(90);
    const maxT = Math.max(...raw.map((p) => p.y));
    const pts: THREE.Vector2[] = [];
    for (const p of raw) {
      const q = new THREE.Vector2(p.x * w, -(zCase - (p.y / maxT) * L));
      if (!pts.length || pts[pts.length - 1].distanceTo(q) > 1e-4) pts.push(q);
    }
    if (pts[0].distanceTo(pts[pts.length - 1]) < 1e-4) pts.pop();
    const sign = THREE.ShapeUtils.area(pts) > 0 ? 1 : -1;
    const inset = (ps: THREE.Vector2[], by: number) =>
      ps.map((p, i) => {
        const t = ps[(i + 1) % ps.length].clone().sub(ps[(i - 1 + ps.length) % ps.length]).normalize();
        // inwards is to the left of a counter-clockwise outline
        return p.clone().addScaledVector(new THREE.Vector2(-t.y, t.x).multiplyScalar(sign), by);
      });
    // shapes extruded upwards, standing on the floor plan
    const up = (geo: THREE.BufferGeometry) => geo.rotateX(-Math.PI / 2);
    // the rim: the outline with the inside cut out, a bottom
    const rim = 0.04;
    const innerPts = inset(pts, rim);
    const outer = new THREE.Shape(pts);
    outer.holes.push(new THREE.Path([...innerPts].reverse()));
    b.add(up(new THREE.ExtrudeGeometry(outer, { depth: caseH, bevelEnabled: false })), lac, 0, yc, 0);
    b.add(up(new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.02, bevelEnabled: false })), lac, 0, yc, 0);
    // inside: the soundboard, the golden plate with its holes, the strings, the dampers
    b.add(up(new THREE.ShapeGeometry(new THREE.Shape(innerPts))), mat("#d9b98c", { roughness: 0.7 }), 0, top - caseH * 0.55, 0);
    const plateShape = new THREE.Shape(inset(pts, rim + 0.05));
    for (const [u, t, r] of [[-0.3, 0.42, 0.07], [-0.02, 0.4, 0.07], [0.27, 0.3, 0.06], [-0.28, 0.66, 0.06], [-0.08, 0.7, 0.05]] as const) {
      const x = u * w;
      const y = -(zCase - t * L);
      if ([[0, 0], [r + 0.06, 0], [-r - 0.06, 0], [0, r * 1.3 + 0.06], [0, -r * 1.3 - 0.06]].every(([dx, dy]) => pointIn(innerPts, x + dx, y + dy))) {
        const hole = new THREE.Path();
        hole.absellipse(x, y, r, r * 1.3, 0, Math.PI * 2, true, 0);
        plateShape.holes.push(hole);
      }
    }
    const plateY = top - caseH * 0.35;
    b.add(up(new THREE.ExtrudeGeometry(plateShape, { depth: 0.012, bevelEnabled: false, curveSegments: 12 })), mat("#c09a4a", { metalness: 0.6, roughness: 0.35 }), 0, plateY, 0);
    const strings: number[] = [];
    const sz0 = zCase - 0.1;
    const n = 46;
    const sy = plateY + 0.016;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + rim + 0.04 + ((w - 2 * rim - 0.1) * i) / (n - 1);
      const zEnd = -topAt(innerPts, x) + 0.06;
      if (!(zEnd < sz0 - 0.1)) continue;
      strings.push(x - 0.0012, sy, sz0, x + 0.0012, sy, sz0, x + 0.0012, sy, zEnd, x - 0.0012, sy, sz0, x + 0.0012, sy, zEnd, x - 0.0012, sy, zEnd);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(strings, 3));
    sg.computeVertexNormals();
    b.add(sg, mat("#d8d4c8", { metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));
    b.box(w - 2 * rim - 0.08, 0.025, 0.05, 0, plateY + 0.014, zCase - 0.16, mat("#202022", { roughness: 1 }));
    // the lid, hinged on the straight left side and propped open on the right
    const lidPts = pts.map((p) => new THREE.Vector2(p.x, Math.max(p.y, -(zCase - 0.2))));
    const lidGeo = up(new THREE.ExtrudeGeometry(new THREE.Shape(lidPts), { depth: 0.018, bevelEnabled: false }));
    lidGeo.translate(w / 2, 0, 0);
    const rise = h * 1.03 + 0.02 - top - 0.02;
    const theta = Math.asin(Math.min(0.7, rise / w));
    const hinge = new THREE.Group();
    hinge.position.set(-w / 2, top, 0);
    hinge.rotation.z = theta;
    hinge.add(new THREE.Mesh(lidGeo, lac));
    // the front flap of the lid, folded back onto it
    const flap = new THREE.Mesh(new THREE.BoxGeometry(w - 0.03, 0.014, 0.17), lac);
    flap.position.set(w / 2, 0.025, zCase - 0.3);
    hinge.add(flap);
    b.g.add(hinge);
    // the prop stick from the rim to the lid
    const pz = zCase - L * 0.3;
    const px = rightAt(pts, -pz) - 0.03;
    const s = px + w / 2;
    b.rod(v(px, top, pz), v(-w / 2 + s * Math.cos(theta) - 0.01, top + s * Math.sin(theta) - 0.005, pz), 0.01, lac, 6);
    // the music desk
    b.box(w * 0.48, 0.24, 0.016, 0, top - 0.02, zCase - 0.12, lac, 0.004)?.rotation.set(-0.28, 0, 0);
    b.box(w * 0.48, 0.02, 0.04, 0, top, zCase - 0.08, lac);
    // the front: the name board behind the keys, the keybed, the cheeks, the key slip
    const cheek = 0.065;
    b.box(w - 2 * cheek, top - ky - 0.02, 0.03, 0, ky + 0.02, zCase + 0.015, lac);
    b.box(0.07, 0.008, 0.002, 0, top - 0.04, zCase + 0.031, brass());
    b.box(w, ky - yc + 0.005, zSlip - zCase, 0, yc - 0.005, (zSlip + zCase) / 2, lac, 0.004);
    keyboard(b, w - 2 * cheek - 0.01, ky, zKeys, kd);
    for (const sx of [-1, 1]) b.box(cheek, 0.085, zSlip - zCase, sx * (w / 2 - cheek / 2), ky - 0.03, (zSlip + zCase) / 2, lac, 0.012);
    b.box(w - 2 * cheek, 0.035, 0.02, 0, ky - 0.012, zSlip - 0.01, lac, 0.004);
    // three turned legs on brass casters
    const legAt = (x: number, z: number) => {
      const lh = yc - 0.1;
      b.box(0.13, 0.05, 0.13, x, yc - 0.05, z, lac, 0.01);
      b.add(lathe([[0.04, 0], [0.05, 0.05], [0.055, lh * 0.75], [0.07, lh * 0.88], [0.072, lh], [0, lh]], 14), lac, x, 0.05, z);
      b.add(lathe([[0, 0], [0.035, 0], [0.045, 0.03], [0.045, 0.05], [0, 0.05]], 12), brass(), x, 0, z);
    };
    legAt(-w / 2 + 0.11, zCase - 0.05);
    legAt(w / 2 - 0.11, zCase - 0.05);
    legAt(-w * 0.22, -d / 2 + L * 0.18);
    // the pedal lyre under the middle, braced to the case
    const lz = zCase - 0.12;
    for (const sx of [-1, 1]) {
      const curve = new THREE.QuadraticBezierCurve3(v(sx * 0.05, 0.06, lz), v(sx * 0.11, (yc - 0.04) * 0.55, lz), v(sx * 0.05, yc - 0.03, lz));
      b.add(new THREE.TubeGeometry(curve, 12, 0.013, 6), lac);
    }
    b.box(0.26, 0.06, 0.12, 0, 0, lz, lac, 0.012);
    b.box(0.2, 0.03, 0.06, 0, yc - 0.03, lz, lac, 0.008);
    for (const px of [-0.06, 0, 0.06]) b.box(0.024, 0.014, 0.1, px, 0.03, lz + 0.09, brass(), 0.005);
    b.rod(v(0, yc - 0.02, lz - 0.02), v(0, 0.06, lz - 0.32), 0.01, lac, 6);
  },
  // ----- fireplaces -----
  fireplace_stove: (b, w, d, h, f) => {
    // a wood stove on a stone plate: a firebox behind a glass door, an ash drawer, the flue up
    const rand = random(311);
    b.box(w, 0.025, d, 0, 0, 0, mat("#6e6a64", { roughness: 0.9 }), 0.006);
    const sw = w * 0.82;
    const sd = Math.min(d * 0.74, 0.42);
    const zc = -d / 2 + 0.02 + sd / 2;
    const zf = zc + sd / 2;
    const y0 = 0.025;
    // a pedestal, the body in pieces round the opening, a top plate
    b.box(sw * 0.75, 0.08, sd * 0.75, 0, y0, zc, iron());
    const by = y0 + 0.08;
    const bh = Math.min(h * 0.45, 1.0);
    const ow = sw - 0.11;
    const oy = 0.14;
    const oh = Math.min(bh * 0.45, 0.42);
    opened(b, sw, bh, sd, 0, by, zc, [[0, oy, ow, oh]], f);
    b.box(sw + 0.02, 0.025, sd + 0.02, 0, by + bh, zc, f, 0.008);
    firebox(b, rand, by + oy, zf, ow, oh, sd - 0.04, "logs");
    // the door: a frame round the glass, hinges on the left, a handle on the right
    const fm = iron();
    const fz = zf + 0.008;
    b.box(ow + 0.04, 0.03, 0.016, 0, by + oy - 0.02, fz, fm);
    b.box(ow + 0.04, 0.03, 0.016, 0, by + oy + oh - 0.01, fz, fm);
    for (const sx of [-1, 1]) b.box(0.03, oh + 0.04, 0.016, sx * (ow / 2 + 0.005), by + oy - 0.02, fz, fm);
    b.box(ow - 0.02, oh - 0.02, 0.004, 0, by + oy, fz, mat("#3a2e26", { transparent: true, opacity: 0.25, roughness: 0.05 }));
    for (const hy of [0.25, 0.75]) b.cyl(0.008, 0.008, 0.04, -ow / 2 - 0.018, by + oy + oh * hy - 0.02, fz + 0.01, fm, 8);
    b.box(0.014, oh * 0.45, 0.014, ow / 2 - 0.01, by + oy + oh * 0.28, fz + 0.022, mat(C.steel, { metalness: 0.7, roughness: 0.3 }));
    for (const hy of [0.32, 0.68]) b.box(0.012, 0.012, 0.014, ow / 2 - 0.01, by + oy + oh * hy, fz + 0.012, fm);
    // the ash drawer with a slot grip and the air slider
    b.box(ow, oy - 0.06, 0.012, 0, by + 0.025, zf + 0.006, fm);
    b.box(ow * 0.4, 0.012, 0.006, 0, by + oy - 0.065, zf + 0.012, mat("#0e0e0f"));
    b.box(0.04, 0.016, 0.012, ow * 0.25, by + 0.06, zf + 0.016, mat(C.steel, { metalness: 0.7, roughness: 0.3 }));
    // convection slots on the sides near the top
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) b.box(0.004, 0.012, sd * 0.6, sx * (sw / 2 + 0.001), by + bh - 0.1 - i * 0.03, zc, mat("#0e0e0f"));
    // the flue: a collar, the pipe in lengths with rings, to the ceiling
    const fx = 0;
    const fzc = zc - sd * 0.12;
    const fr = Math.min(0.075, sw * 0.2);
    const top = by + bh + 0.025;
    b.cyl(fr + 0.015, fr + 0.02, 0.05, fx, top, fzc, f, 20);
    b.cyl(fr, fr, h - top - 0.05, fx, top + 0.05, fzc, f, 20);
    for (let y = top + 0.5; y < h - 0.2; y += 0.6) b.cyl(fr + 0.006, fr + 0.006, 0.025, fx, y, fzc, f, 20);
    b.cyl(fr + 0.04, fr + 0.04, 0.02, fx, h - 0.02, fzc, f, 20);
    // the damper's knob on the pipe
    b.rod(v(fx - fr - 0.04, top + 0.3, fzc), v(fx + fr + 0.04, top + 0.3, fzc), 0.006, iron(), 6);
  },
  fireplace_wall: (b, w, d, h, f) => {
    // a built-in gas fire: a plaster surround, a long low opening in a black frame, a stone ledge
    const rand = random(313);
    const sd = d - 0.05;
    const ly = Math.min(0.22, h * 0.17);
    const ow = w * 0.72;
    const oh = Math.min(0.34, h * 0.27);
    const oy = ly + 0.06 + 0.12;
    const nw = Math.min(0.5, w * 0.3);
    const nh = ly - 0.05;
    const nx = -w / 2 + 0.08 + nw / 2;
    opened(b, w, h, sd, 0, 0, -0.025, nh > 0.1 ? [[0, oy, ow, oh], [nx, 0.05, nw, nh]] : [[0, oy, ow, oh]], f);
    // the shadow-gap frame, the firebox with pebbles and flames, toughened glass
    const fz = d / 2 - 0.05;
    for (const [fw, fh, x, y] of [[ow + 0.05, 0.025, 0, oy - 0.025], [ow + 0.05, 0.025, 0, oy + oh], [0.025, oh, -ow / 2 - 0.0125, oy], [0.025, oh, ow / 2 + 0.0125, oy]] as const)
      b.box(fw, fh, 0.008, x, y, fz + 0.004, mat("#18181a", { roughness: 0.4 }));
    firebox(b, rand, oy, fz, ow, oh, sd * 0.75, "pebbles");
    b.box(ow, oh, 0.004, 0, oy, fz - 0.006, mat("#cfd8da", { transparent: true, opacity: 0.12, roughness: 0.05 }));
    // the stone ledge across the full width, a recessed niche for logs below it on the left
    const stone = mat("#3b3b3d", { roughness: 0.55 });
    b.box(w, 0.06, d, 0, ly, 0, stone, 0.006);
    if (nh > 0.1) {
      b.box(nw, nh, 0.012, nx, 0.05, -d / 2 + 0.03, mat("#2a2a2c", { roughness: 1 }));
      for (let i = 0; i < Math.floor(nw / 0.07); i++)
        for (let j = 0; j < Math.floor(nh / 0.065); j++) {
          const lg = log(b, nx - nw / 2 + 0.035 + i * 0.07 + (j % 2) * 0.01, 0.05 + 0.032 + j * 0.06, -0.03, sd - 0.06, 0.03 + rand() * 0.004, Math.PI / 2);
          lg.rotation.x = rand();
        }
    }
  },
  fireplace_open: (b, w, d, h, f, _c, a) => {
    // a classic open fireplace: a surround with pilasters, a mantel shelf, an arched firebox
    // with logs burning on a grate, a stone hearth, things on the mantel
    const rand = random(317);
    const stone = mat("#5e5a54", { roughness: 0.9 });
    const hd = Math.min(0.22, d * 0.45);
    b.box(w, 0.04, d, 0, 0, 0, stone, 0.006);
    const sw = w - 0.08;
    const sh = h - 0.2;
    const sd = Math.min(0.14, d * 0.32);
    const zs = d / 2 - hd; // the surround's front
    const ow = sw * 0.52;
    const oh = Math.min(0.72, sh * 0.66);
    const s = new THREE.Shape();
    s.moveTo(-sw / 2, 0);
    s.lineTo(sw / 2, 0);
    s.lineTo(sw / 2, sh);
    s.lineTo(-sw / 2, sh);
    s.lineTo(-sw / 2, 0);
    const hole = new THREE.Path();
    hole.moveTo(-ow / 2, 0.002);
    hole.lineTo(ow / 2, 0.002);
    hole.lineTo(ow / 2, oh - ow * 0.18);
    hole.quadraticCurveTo(0, oh + ow * 0.1, -ow / 2, oh - ow * 0.18);
    hole.lineTo(-ow / 2, 0.002);
    s.holes.push(hole);
    b.add(new THREE.ExtrudeGeometry(s, { depth: sd, bevelEnabled: false, curveSegments: 14 }), f, 0, 0.04, zs - sd);
    // pilasters with plinth blocks and capitals, a frieze under the mantel
    const pw = Math.min(0.13, (sw - ow) / 4);
    for (const sx of [-1, 1]) {
      const px = sx * (sw / 2 - pw / 2 - 0.03);
      b.box(pw, sh - 0.12, 0.025, px, 0.04, zs + 0.0125, f);
      b.box(pw + 0.03, 0.1, 0.04, px, 0.04, zs + 0.02, f);
      b.box(pw + 0.03, 0.05, 0.04, px, 0.04 + sh - 0.12, zs + 0.02, f);
    }
    b.box(sw - 0.02, 0.03, 0.03, 0, 0.04 + sh - 0.07, zs + 0.015, f);
    // the keystone over the arch
    b.box(0.07, 0.09, 0.02, 0, 0.04 + oh + ow * 0.02 - 0.04, zs + 0.01, f);
    // the firebox behind the arch
    const fd = Math.min(0.32, zs - sd + d / 2 - 0.01);
    firebox(b, rand, 0.04, zs - sd + 0.001, ow + 0.02, oh + ow * 0.12, fd, "logs");
    // the mantel shelf (accent), the hearth stone in front
    const md = sd + 0.08;
    b.box(w, 0.06, md, 0, h - 0.2, zs - sd + md / 2 - 0.01, a, 0.01);
    b.box(ow + 0.3, 0.025, hd - 0.02, 0, 0.04, zs + (hd - 0.02) / 2, mat("#4c4945", { roughness: 0.6 }));
    // on the mantel: candlesticks and a vase
    const my = h - 0.14;
    const mz = zs - sd + md / 2 - 0.01;
    for (const sx of [-1, 1]) {
      const x = sx * w * 0.36;
      b.add(lathe([[0, 0], [0.035, 0], [0.03, 0.01], [0.01, 0.02], [0.008, 0.06], [0.018, 0.07], [0.015, 0.075], [0, 0.075]], 12), brass(), x, my, mz);
      b.cyl(0.011, 0.011, 0.065, x, my + 0.075, mz, mat("#f4efe3"), 10);
    }
    ornament(b, random(7), w * 0.18, my, mz, 0.14, 0.1);
    // a fire tool stand on the hearth
    const tx = w / 2 - 0.1;
    const tz = d / 2 - hd / 2 - 0.01;
    if (hd > 0.12) {
      b.cyl(0.05, 0.055, 0.015, tx, 0.04, tz, iron(), 14);
      b.cyl(0.01, 0.01, 0.55, tx, 0.055, tz, iron(), 8);
      b.cyl(0.03, 0.03, 0.006, tx, 0.56, tz, iron(), 12);
      for (let i = 0; i < 3; i++) {
        const an = (i / 3) * Math.PI * 2;
        b.rod(v(tx + Math.cos(an) * 0.025, 0.55, tz + Math.sin(an) * 0.025), v(tx + Math.cos(an) * 0.03, 0.12, tz + Math.sin(an) * 0.03), 0.009, iron(), 6);
        b.sphere(0.012, tx + Math.cos(an) * 0.03, 0.12, tz + Math.sin(an) * 0.03, iron(), 1, 1.5, 1, 8);
      }
    }
  },
  fireplace_glass: (b, w, d, h, f) => {
    // a modern fire seen through glass on three sides: a plinth with a log store, a black
    // frame, ceramic logs on a stone bed, the chimney breast above
    const rand = random(331);
    const base = Math.min(0.45, h * 0.2);
    const fh = Math.min(0.55, h - base - 0.1);
    // the plinth with an open log store
    const ow = w - 0.12;
    const oh = base - 0.1;
    opened(b, w, base, d, 0, 0, 0, [[0, 0.05, ow, oh]], f);
    b.box(ow, oh, 0.02, 0, 0.05, -d / 2 + 0.03, mat("#1c1c1d", { roughness: 1 }));
    const cols = Math.floor(ow / 0.09);
    const rows = Math.floor(oh / 0.08);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const lg = log(b, -ow / 2 + 0.045 + i * (ow / cols) + (j % 2 ? 0.02 : 0), 0.05 + 0.04 + j * 0.077, 0.02, d - 0.1, 0.036 + rand() * 0.006, Math.PI / 2);
        lg.rotation.x = rand() * 3;
        if (j % 2 && i === cols - 1) lg.visible = false;
      }
    // the frame: bottom and top plates, slim corner posts
    const y = base;
    const blk = mat(C.black, { roughness: 0.5 });
    b.box(w, 0.04, d, 0, y, 0, blk);
    b.box(w, 0.04, d, 0, y + fh - 0.04, 0, blk);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.025, fh - 0.08, 0.025, sx * (w / 2 - 0.0125), y + 0.04, sz * (d / 2 - 0.0125), blk);
    // inside: a back wall, the fire
    const iy = y + 0.04;
    const ih = fh - 0.08;
    b.box(w - 0.05, ih, 0.02, 0, iy, -d / 2 + 0.035, mat("#262423", { roughness: 1 }));
    b.box(w - 0.05, 0.02, d - 0.08, 0, iy, 0.005, mat("#3a3836", { roughness: 1 }));
    const peb = [mat("#9c968e", { roughness: 0.7 }), mat("#6f6a64", { roughness: 0.7 })];
    for (let i = 0; i < 50; i++) {
      const r = 0.014 + rand() * 0.01;
      const g = new THREE.SphereGeometry(r, 5, 3);
      g.scale(1, 0.55, 1);
      b.batch(g, peb[i % 2], matrix(-w / 2 + 0.05 + rand() * (w - 0.1), iy + 0.02 + r * 0.3, -d / 2 + 0.07 + rand() * (d - 0.14)));
    }
    const lw = Math.min(w * 0.7, 0.6);
    log(b, -lw * 0.15, iy + 0.06, -0.03, lw * 0.7, 0.04, 0.15);
    log(b, lw * 0.18, iy + 0.06, 0.04, lw * 0.65, 0.036, -0.2);
    log(b, 0, iy + 0.12, 0, lw * 0.55, 0.034, 0.05, 0.06);
    embers(b, rand, -lw / 2, lw / 2, iy + 0.02, 0, 0.2, 26);
    flames(b, rand, -lw * 0.45, lw * 0.45, iy + 0.06, 0, ih * 0.7, 0.14);
    // glass on three sides
    const gl = mat("#d8e4e6", { transparent: true, opacity: 0.14, roughness: 0.05 });
    b.box(w - 0.025, ih, 0.004, 0, iy, d / 2 - 0.0125, gl);
    for (const sx of [-1, 1]) b.box(0.004, ih, d - 0.025, sx * (w / 2 - 0.0125), iy, 0, gl);
    // the chimney breast: a shadow gap, the cladding, a vent grille near the top
    const cy = y + fh;
    b.box(w - 0.02, 0.02, d * 0.9 - 0.02, 0, cy, -d * 0.05, mat("#141414"));
    b.box(w, h - cy - 0.02, d * 0.9, 0, cy + 0.02, -d * 0.05, f, 0.006);
    const vy = h - 0.25;
    for (let i = 0; i < 5; i++) b.box(w * 0.5, 0.008, 0.004, 0, vy + i * 0.025, d * 0.4 + 0.001, mat("#141414"));
  },
  // ----- TV and media -----
  tv_board: (b, w, d, h, f, _c, a) => {
    // a low media unit on splayed legs: push fronts with grips, an open bay with a receiver
    const lh = Math.min(0.12, h * 0.3);
    mediaUnit(b, w, d, lh, h - lh, f);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.07);
        const z = sz * (d / 2 - 0.06);
        taper(b, v(x, lh + 0.002, z), v(x + sx * 0.02, 0, z + sz * 0.015), 0.016, 0.009, a, 10);
      }
  },
  tv_board_wall: (b, w, d, h, f) => {
    // a floating media unit: push fronts with grips, an open bay with a receiver
    mediaUnit(b, w, d, 0, h, f);
  },
  tv_stand: (b, w, d, h, f, c, a, ac) => {
    // a media unit with a TV on its pedestal stand, a soundbar in front of it
    const board = Math.min(0.45, h * 0.35);
    BUILDERS.tv_board(b, w, d, board, f, c, a, ac);
    const tw = Math.min(w * 0.85, 1.45);
    const th = Math.min(h - board - 0.07, tw * 0.58);
    const stand = mat("#2a2b2e", { metalness: 0.5, roughness: 0.35 });
    b.box(Math.min(0.32, tw * 0.25), 0.01, 0.2, 0, board, -0.04, stand, 0.004);
    b.box(0.07, 0.07, 0.025, 0, board + 0.01, -0.06, stand, 0.005);
    tvSet(b, tw, th, board + 0.07, -0.04);
    // a soundbar in front of the stand
    const sw = Math.min(tw * 0.6, 0.9);
    if (d > 0.3) {
      b.box(sw, 0.055, 0.09, 0, board, d / 2 - 0.07, mat("#222326", { roughness: 0.7 }), 0.02);
      b.box(sw - 0.03, 0.04, 0.002, 0, board + 0.008, d / 2 - 0.0245, mat("#38393d", { roughness: 1 }));
    }
  },
  tv_wall: (b, w, d, h) => {
    // a slim TV on a flat wall bracket
    tvSet(b, w, h, 0, d / 2);
    const brk = mat("#2a2b2e", { metalness: 0.5, roughness: 0.4 });
    const bd = Math.max(0.005, d / 2 - 0.047);
    for (const sx of [-1, 1]) b.box(0.04, h * 0.5, bd, sx * w * 0.15, h * 0.2, -d / 2 + bd / 2, brk);
    b.box(w * 0.36, 0.05, bd, 0, h * 0.4, -d / 2 + bd / 2, brk);
  },
  sideboard: (b, w, d, h, f) => {
    // a mid-century sideboard: a top with rounded edges, doors on the left, a column of drawers,
    // a recessed plinth line, tapered legs with brass caps
    const lh = Math.min(0.17, h * 0.22);
    const t = 0.022;
    const ch = h - lh - t;
    b.box(w, t, d, 0, h - t, 0, f, 0.008);
    b.box(w - 0.02, ch, d - 0.03, 0, lh, -0.015, f, 0.003);
    b.box(w - 0.04, 0.02, d - 0.06, 0, lh - 0.02, -0.02, f);
    const dw = Math.min(0.5, w * 0.32);
    const z = d / 2 - 0.035;
    fronts(b, -w / 2 + 0.01, w - 0.02 - dw, lh + 0.01, ch - 0.02, z, Math.max(2, Math.round((w - dw) / 0.45)), f, 1, "bar");
    fronts(b, w / 2 - 0.01 - dw, dw, lh + 0.01, ch - 0.02, z, 1, f, 3, "bar", undefined, true);
    b.box(0.005, ch - 0.02, 0.02, w / 2 - 0.01 - dw, lh + 0.01, z + 0.0105, mat("#26272a", { roughness: 1 }));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - 0.08);
        const zz = sz * (d / 2 - 0.07);
        squareTaper(b, v(x, lh - 0.02, zz), v(x + sx * 0.03, 0.02, zz + sz * 0.02), 0.04, 0.024, f);
        b.cyl(0.011, 0.012, 0.02, x + sx * 0.03, 0, zz + sz * 0.02, brass(), 10);
      }
  },
  // ----- shelves -----
  bookshelf: (b, w, d, h, f) => {
    // a bookcase with a plinth and a back: books in groups, leaning, lying, things between
    const rand = random(Math.round(w * 100 + h * 10));
    const t = 0.022;
    const { ys, rowH } = bookcase(b, w, d, h, f, Math.max(3, Math.round((h - 0.07) / 0.36)));
    for (const y of ys) fillShelf(b, rand, -w / 2 + t, w / 2 - t, y, rowH, d - 0.02, 0.004);
  },
  bookshelf_low: (b, w, d, h, f) => {
    const rand = random(89);
    const t = 0.022;
    const { ys, rowH } = bookcase(b, w, d, h, f, Math.max(1, Math.round((h - 0.07) / 0.34)));
    for (const y of ys) fillShelf(b, rand, -w / 2 + t, w / 2 - t, y, rowH, d - 0.02, 0.004);
  },
  bookshelf_wide: (b, w, d, h, f) => {
    // open shelves over a cupboard base with doors, columns between uprights, a top with a lip
    const rand = random(83);
    const n = Math.max(1, Math.round(w / 0.8));
    const t = 0.022;
    const base = Math.min(0.75, h * 0.35);
    b.box(w, t + 0.008, d, 0, h - t - 0.008, 0, f, 0.003);
    for (let i = 0; i <= n; i++) b.box(t, h - t, d, -w / 2 + t / 2 + (i * (w - t)) / n, 0, 0, f);
    b.box(w - 2 * t, h - t, 0.008, 0, 0, -d / 2 + 0.004, f);
    b.box(w - 2 * t, h - t - base, 0.002, 0, base, -d / 2 + 0.009, mat("#000000", { transparent: true, opacity: 0.18 }));
    // the base: a plinth, doors with knobs, a shelf over them
    b.box(w - 2 * t, 0.06, d - 0.04, 0, 0, -0.02, f);
    fronts(b, -w / 2 + t, w - 2 * t, 0.06, base - 0.06 - t, d / 2 - 0.02, n * 2, f, 1, "knob");
    const cw = (w - t) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + t + i * cw;
      const x1 = x0 + cw - t;
      b.box(cw - t, t, d - 0.005, (x0 + x1) / 2, base - t, 0.0025, f);
      const rows = Math.max(2, Math.round((h - base) / 0.36));
      const rh = (h - base - t) / rows;
      for (let r = 0; r < rows; r++) {
        const y = base + r * rh;
        if (r > 0) b.box(cw - t, t, d - 0.01, (x0 + x1) / 2, y - t, 0.005, f);
        fillShelf(b, rand, x0, x1, y, rh - t - 0.005, d - 0.02, 0.004);
      }
    }
  },
  bookshelf_grid: (b, w, d, h, f) => {
    // irregular cells, open front and back (a room divider): books, stacks, plants, vases
    const rand = random(97);
    const t = 0.025;
    const rows = Math.max(2, Math.round(h / 0.38));
    const rh = (h - t) / rows;
    for (const sx of [-1, 1]) b.box(t, h, d, sx * (w / 2 - t / 2), 0, 0, f);
    for (let r = 0; r <= rows; r++) b.box(w - 2 * t, t, d, 0, r * rh, 0, f);
    for (let r = 0; r < rows; r++) {
      const cuts = [-w / 2 + t / 2];
      let x = cuts[0];
      while (x < w / 2 - 0.45) {
        x += 0.3 + rand() * 0.35;
        if (x < w / 2 - 0.2) cuts.push(x);
      }
      cuts.push(w / 2 - t / 2);
      for (let i = 0; i < cuts.length - 1; i++) {
        if (i > 0) b.box(t, rh - t, d, cuts[i], r * rh + t, 0, f);
        const x0 = cuts[i] + t / 2;
        const x1 = cuts[i + 1] - t / 2;
        if (rand() < 0.12) continue;
        fillShelf(b, rand, x0, x1, r * rh + t, rh - t - 0.005, d - 0.02, 0);
      }
    }
  },
  bookshelf_ladder: (b, w, d, h, f) => {
    // leans against the wall: tapered rails from the floor in front to the wall at the top,
    // shelves getting deeper towards the floor, each with a lip at the back
    const rand = random(101);
    const zAt = (y: number) => d / 2 - 0.025 - (y / h) * (d - 0.05);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.02);
      squareTaper(b, v(x, 0, zAt(0)), v(x, h, zAt(h)), 0.04, 0.03, f);
    }
    const n = Math.max(3, Math.round(h / 0.38));
    for (let i = 0; i < n; i++) {
      const y = 0.1 + (i * (h - 0.32)) / (n - 1);
      const front = zAt(y) + 0.01;
      const sd = Math.max(0.12, front + d / 2 - 0.03);
      const z = front - sd / 2;
      b.box(w - 0.06, 0.02, sd, 0, y, z, f, 0.004);
      b.box(w - 0.06, 0.04, 0.015, 0, y + 0.02, front - sd + 0.0075, f);
      const room = i < n - 1 ? (h - 0.32) / (n - 1) - 0.04 : h - y - 0.04;
      fillShelf(b, rand, -w / 2 + 0.04, w / 2 - 0.04, y + 0.02, Math.min(0.3, room), sd - 0.02, z + 0.01);
    }
  },
  bookshelf_wall: (b, w, d, h, f) => {
    // floating shelves, alternately offset: books held by bookends, small things between
    const rand = random(103);
    const n = Math.max(2, Math.round(h / 0.4) + 1);
    const t = 0.03;
    for (let i = 0; i < n; i++) {
      const y = (i * (h - t)) / (n - 1);
      const sw = w * (i % 2 ? 0.8 : 1);
      const x = i % 2 ? w * 0.1 : 0;
      b.box(sw, t, d, x, y, 0, f, 0.004);
      if (i < n - 1) {
        const room = Math.min(0.28, (h - t) / (n - 1) - t - 0.02);
        fillShelf(b, rand, x - sw / 2 + 0.02, x + sw / 2 - 0.02, y + t, room, d - 0.02, 0);
      }
    }
  },
  cube_shelf: (b, w, d, h, f) => {
    // square cells of about 33 cm, a frame thicker than the dividers; fabric boxes with
    // grip holes, books, a plant
    const nx = Math.max(1, Math.round(w / 0.39));
    const ny = Math.max(1, Math.round(h / 0.39));
    const t = 0.04;
    const tt = 0.016;
    b.box(t, h, d, -w / 2 + t / 2, 0, 0, f);
    b.box(t, h, d, w / 2 - t / 2, 0, 0, f);
    b.box(w - 2 * t, t, d, 0, 0, 0, f);
    b.box(w - 2 * t, t, d, 0, h - t, 0, f);
    b.box(w - 2 * t, h - 2 * t, 0.006, 0, t, -d / 2 + 0.003, f);
    const cw = (w - 2 * t) / nx;
    const ch = (h - 2 * t) / ny;
    for (let i = 1; i < nx; i++) b.box(tt, h - 2 * t, d - 0.006, -w / 2 + t + cw * i, t, 0.003, f);
    for (let j = 1; j < ny; j++) b.box(w - 2 * t, tt, d - 0.006, 0, t + ch * j - tt / 2, 0.003, f);
    const rand = random(nx * 31 + ny * 7);
    const fabrics = ["#d9d4c7", "#8d9299", "#c9a47c", "#5d6b62"].map((c) => mat(c, { roughness: 1 }));
    const hole = mat("#2a2a2b", { roughness: 1 });
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const x0 = -w / 2 + t + cw * i + (i ? tt / 2 : 0);
        const x1 = -w / 2 + t + cw * (i + 1) - (i < nx - 1 ? tt / 2 : 0);
        const y = t + ch * j + (j ? tt / 2 : 0);
        const y1 = t + ch * (j + 1) - (j < ny - 1 ? tt / 2 : 0);
        const x = (x0 + x1) / 2;
        const r = rand();
        if (r < 0.35) {
          // a fabric box, its front a little soft, a grip hole
          const bw = x1 - x0 - 0.012;
          const bh = y1 - y - 0.01;
          b.box(bw, bh, d - 0.03, x, y, 0.005, fabrics[Math.floor(rand() * 4)], 0.01);
          b.box(0.09, 0.03, 0.004, x, y + bh - 0.07, d / 2 - 0.01 + 0.001, hole, 0.008);
        } else if (r < 0.85) fillShelf(b, rand, x0, x1, y, y1 - y - 0.01, d - 0.02, 0.003);
      }
  },
  // ----- tables -----
  coffee_table: (b, w, d, h, f, _c, a) => {
    // a top with eased edges on a frame of square legs and rails, a shelf with books below
    const t = 0.035;
    const s = 0.028;
    b.box(w, t, d, 0, h - t, 0, f, 0.008);
    const iw = w - 0.08;
    const id = d - 0.08;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(s, h - t, s, sx * (iw / 2 - s / 2), 0, sz * (id / 2 - s / 2), a);
    const sy = Math.min(0.12, h * 0.3);
    for (const y of [h - t - 0.035, sy - 0.02]) {
      for (const sz of [-1, 1]) b.box(iw - 2 * s, 0.035, 0.018, 0, y, sz * (id / 2 - s / 2), a);
      for (const sx of [-1, 1]) b.box(0.018, 0.035, id - 2 * s, sx * (iw / 2 - s / 2), y, 0, a);
    }
    b.box(iw - 2 * s + 0.01, 0.018, id - 2 * s + 0.01, 0, sy + 0.015, 0, f, 0.004);
    // on the shelf: a stack of books and magazines, a basket
    const rand = random(211);
    let y = sy + 0.033;
    for (let i = 0; i < 4; i++) {
      const bt = 0.015 + rand() * 0.02;
      book(b, rand, 0.3 - i * 0.02, bt, 0.22 - i * 0.012, -iw * 0.22, y + bt / 2, 0, 0, (rand() - 0.5) * 0.3);
      y += bt;
    }
    const room = h - t - 0.035 - (sy + 0.033) - 0.01;
    if (room > 0.08) {
      const br = Math.min(0.11, id / 2 - s - 0.02);
      b.add(lathe([[0, 0], [br * 0.85, 0], [br, room * 0.85], [br * 0.94, room * 0.85], [br * 0.8, 0.012], [0, 0.012]], 18), mat("#a68457", { roughness: 1 }), iw * 0.22, sy + 0.033, 0);
    }
  },
  coffee_table_round: (b, w, d, h, f) => {
    // a round top with a bevelled underside, an apron ring, four splayed tapered legs
    const r = Math.min(w, d) / 2;
    const t = 0.03;
    b.add(lathe([[0, 0], [r - 0.025, 0], [r, t * 0.55], [r, t], [0, t]], 48), f, 0, h - t, 0);
    const ar = r * 0.62;
    const ah = 0.06;
    b.add(lathe([[ar - 0.02, 0], [ar, 0], [ar, ah], [ar - 0.02, ah], [ar - 0.02, 0]], 40), f, 0, h - t - ah, 0);
    for (let i = 0; i < 4; i++) {
      const an = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const c = Math.cos(an);
      const s = Math.sin(an);
      taper(b, v(c * (ar - 0.02), h - t, s * (ar - 0.02)), v(c * r * 0.8, 0, s * r * 0.8), 0.022, 0.012, f, 10);
    }
  },
  coffee_tables_nested: (b, w, d, h, f, _c, a) => {
    // two round tables, one lower: tray tops with a raised rim on frames of rods and a foot ring
    const r1 = Math.min(d / 2, w * 0.33);
    const r2 = r1 * 0.75;
    for (const [x, z, r, hh] of [[-w / 2 + r1, 0, r1, h * 0.85], [w / 2 - r2, d / 2 - r2, r2, h]] as const) {
      const t = 0.02;
      b.cyl(r, r, t, x, hh - t - 0.012, z, f, 44);
      b.add(new THREE.TorusGeometry(r - 0.008, 0.008, 6, 44).rotateX(Math.PI / 2), f, x, hh - 0.012, z);
      // a ring under the top, one near the floor, legs between
      for (const ry of [hh - t - 0.02, 0.04]) b.add(new THREE.TorusGeometry(r * 0.9, 0.006, 6, 40).rotateX(Math.PI / 2), a, x, ry, z);
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * Math.PI * 2 + 0.3;
        b.cyl(0.007, 0.007, hh - t - 0.012, x + Math.cos(an) * (r * 0.9 - 0.004), 0, z + Math.sin(an) * (r * 0.9 - 0.004), a, 8);
      }
    }
  },
  coffee_table_block: (b, w, d, h, f) => {
    // a monolithic block: a slab over a recessed base with a shadow gap
    const gap = 0.025;
    b.box(w - 0.08, gap, d - 0.08, 0, 0, 0, mat("#1f1f21", { roughness: 1 }));
    b.box(w, h - gap - 0.05, d, 0, gap, 0, f, 0.012);
    b.box(w, 0.05, d, 0, h - 0.05, 0, f, 0.012);
    // the joint between the slab and the body
    b.box(w + 0.002, 0.004, d + 0.002, 0, h - 0.052, 0, mat("#000000", { transparent: true, opacity: 0.35 }));
  },
  side_table: (b, w, d, h, f, _c, a) => {
    // a round top with a soft edge on a slim stem and a trumpet foot
    const r = Math.min(w, d) / 2;
    const t = 0.022;
    b.add(lathe([[0, 0], [r - 0.01, 0], [r, t * 0.5], [r - 0.004, t], [0, t]], 40), f, 0, h - t, 0);
    const fr = r * 0.62;
    b.add(lathe([[0, 0], [fr - 0.006, 0], [fr, 0.004], [fr - 0.004, 0.012], [fr * 0.5, 0.03], [0.03, 0.09], [0.018, 0.16], [0.016, h - t - 0.03], [0.04, h - t - 0.005], [0.04, h - t], [0, h - t]], 28), a);
  },
  // ----- lamps -----
  floor_lamp_arc: (b, w, d, h, f, color, a) => {
    // a marble block base, a telescopic arc, a dome shade with the bulb and its glow inside
    const x0 = -w / 2 + 0.18;
    const marble = mat("#e8e6e1", { roughness: 0.35 });
    b.box(0.34, 0.12, Math.min(0.34, d), x0, 0, 0, marble, 0.012);
    b.cyl(0.03, 0.035, 0.03, x0, 0.12, 0, a, 16);
    const xs = w / 2 - Math.min(0.2, d / 2);
    const curve = new THREE.QuadraticBezierCurve3(v(x0, 0.15, 0), v(x0 + 0.1, h + 0.25, 0), v(xs, h - 0.12, 0));
    const pts = curve.getSpacedPoints(40);
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.slice(0, 22)), 22, 0.016, 8, false), a);
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.slice(21)), 20, 0.011, 8, false), a);
    b.sphere(0.02, pts[21].x, pts[21].y, pts[21].z, a, 1, 1, 1, 10);
    // the shade: a dome, its rim rolled, the bulb inside
    const sr = Math.min(0.2, d / 2);
    const sy = h - 0.12 - sr * 0.9;
    const dome: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      dome.push([Math.sin(t) * sr, Math.cos(t) * sr * 0.9]);
    }
    b.add(lathe(dome, 32), shadeMat(f, color), xs, sy, 0);
    b.add(new THREE.TorusGeometry(sr, 0.006, 6, 32).rotateX(Math.PI / 2), a, xs, sy, 0);
    b.cyl(0.03, 0.03, 0.06, xs, sy + sr * 0.9 - 0.06, 0, a, 12);
    b.sphere(0.05, xs, sy + sr * 0.9 - 0.11, 0, glowing(mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.8 })), 1, 1, 1, 14);
  },
  floor_lamp_tripod: (b, w, d, h, f, color, a) => {
    // three tapered legs meeting in a hub, a stem, a drum shade with rims and a diffuser
    const r = Math.min(w, d) / 2;
    const hub = v(0, h * 0.6, 0);
    for (let i = 0; i < 3; i++) {
      const an = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const foot = v(Math.cos(an) * r * 0.86, 0, Math.sin(an) * r * 0.86);
      taper(b, hub.clone().add(v(Math.cos(an) * 0.02, 0, Math.sin(an) * 0.02)), foot, 0.016, 0.01, f, 8);
      b.sphere(0.013, foot.x, 0.008, foot.z, a, 1, 0.6, 1, 8);
    }
    b.cyl(0.026, 0.03, 0.07, 0, hub.y - 0.05, 0, a, 14);
    b.cyl(0.009, 0.009, h - 0.3 - hub.y, 0, hub.y + 0.02, 0, a, 8);
    const sb = h - 0.32;
    const r0 = r * 0.8;
    const r1 = r * 0.74;
    b.cyl(r1, r0, 0.32, 0, sb, 0, shadeMat(f, color), 36, true);
    for (const [y, rr] of [[sb, r0], [h, r1]] as const) b.add(new THREE.TorusGeometry(rr, 0.004, 4, 36).rotateX(Math.PI / 2), a, 0, y, 0);
    b.add(new THREE.CircleGeometry(r0 - 0.01, 32).rotateX(Math.PI / 2), glowing(mat("#fff6e6", { emissive: "#fff1d6", emissiveIntensity: 0.4, side: THREE.DoubleSide })), 0, sb + 0.01, 0);
  },
  floor_lamp_globe: (b, w, _d, h, _f, _c, a) => {
    // a chamfered round foot, a slim stem, a collar holding an opal globe
    const R = w * 0.45;
    b.add(lathe([[0, 0], [R, 0], [R, 0.014], [R - 0.012, 0.026], [0.02, 0.03], [0, 0.03]], 32), a);
    b.cyl(0.01, 0.01, h - w - 0.03, 0, 0.03, 0, a, 8);
    const gy = h - w * 0.5;
    b.add(lathe([[0.009, 0], [0.03, 0.02], [0.045, 0.05], [0.04, 0.055], [0, 0.055]], 20), a, 0, gy - w * 0.5 + 0.005 - 0.05, 0);
    b.sphere(w * 0.5, 0, gy, 0, glowing(mat("#f6f1e6", { transparent: true, opacity: 0.92 })), 1, 1, 1, 24);
  },
  table_lamp: (b, w, _d, h, f, color, a) => {
    // a ginger-jar base, a collar and harp in the accent, a tapered shade with a finial
    const r = w * 0.3;
    const bh = h * 0.44;
    b.add(lathe([[0, 0], [r * 0.6, 0], [r * 0.62, bh * 0.05], [r * 0.95, bh * 0.35], [r, bh * 0.55], [r * 0.85, bh * 0.82], [r * 0.45, bh * 0.97], [r * 0.4, bh], [0, bh]], 28), f);
    b.cyl(0.025, 0.03, 0.03, 0, bh, 0, a, 14);
    b.cyl(0.008, 0.008, h * 0.2, 0, bh + 0.03, 0, a, 8);
    const sb = h * 0.66;
    const sh = h * 0.32;
    b.cyl(w * 0.36, w * 0.5, sh, 0, sb, 0, shadeMat(f, color), 32, true);
    for (const [y, rr] of [[sb, w * 0.5], [sb + sh, w * 0.36]] as const) b.add(new THREE.TorusGeometry(rr, 0.003, 4, 32).rotateX(Math.PI / 2), a, 0, y, 0);
    b.sphere(0.03, 0, sb + 0.04, 0, glowing(mat("#fff6df", { emissive: "#fff2cc", emissiveIntensity: 0.8 })), 1, 1, 1, 12);
    for (let i = 0; i < 2; i++) b.rod(v(0, bh + 0.03 + h * 0.2, 0), v((i ? 1 : -1) * w * 0.3, sb + sh - 0.01, 0), 0.002, a, 4);
    b.sphere(0.01, 0, h - 0.01, 0, a, 1, 1, 1, 8);
  },
  // ----- more -----
  display_cabinet: (b, w, d, h, f, _c, a) => {
    // a glass-fronted cabinet on legs: framed glass doors, glass shelves with plates, glasses,
    // bowls and vases, a drawer below
    const lh = 0.12;
    const t = 0.022;
    const top = h - t - 0.01;
    b.box(w, t + 0.01, d, 0, top, 0, f, 0.004);
    for (const sx of [-1, 1]) b.box(t, top - lh, d - 0.01, sx * (w / 2 - t / 2), lh, -0.005, f);
    b.box(w - 2 * t, top - lh, 0.01, 0, lh, -d / 2 + 0.005, f);
    b.box(w - 2 * t, t, d - 0.03, 0, lh, -0.015, f);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) taper(b, v(sx * (w / 2 - 0.05), lh, sz * (d / 2 - 0.05)), v(sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04)), 0.014, 0.009, a, 8);
    // a drawer under the doors
    const dy = lh + t;
    const dh = Math.min(0.16, h * 0.1);
    fronts(b, -w / 2 + t, w - 2 * t, dy, dh, d / 2 - 0.03, 1, f, 1, "bar", a, true);
    const sy0 = dy + dh + t;
    b.box(w - 2 * t, t, d - 0.03, 0, dy + dh, -0.015, f);
    // glass shelves and their contents
    const n = Math.max(1, Math.round(w / 0.5));
    const cw = (w - 2 * t) / n;
    const rows = 4;
    const rh = (top - sy0) / rows;
    const ceramic = mat(C.ceramic, { roughness: 0.3 });
    const glassM = mat("#dfeef2", { transparent: true, opacity: 0.35, roughness: 0.05 });
    const rand = random(127);
    for (let s = 0; s < rows; s++) {
      const y = sy0 + s * rh;
      if (s > 0) b.box(w - 2 * t, 0.008, d - 0.05, 0, y - 0.008, -0.01, glass());
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + t + cw * (i + 0.5);
        const kind = (s + i) % 3;
        if (kind === 0) {
          // stacked plates leaning on the back, a stack of bowls
          for (let k = 0; k < 2; k++) {
            const pr = Math.min(0.12, rh * 0.42, cw * 0.22);
            const p = b.add(new THREE.CylinderGeometry(pr, pr * 0.8, 0.012, 20), ceramic, x - cw * 0.2 + k * 0.02, y + pr, -d / 2 + 0.05 + k * 0.014);
            p.rotation.x = Math.PI / 2 - 0.18;
          }
          for (let k = 0; k < 2; k++) b.add(lathe([[0, 0], [0.032, 0], [0.058, 0.023], [0.065, 0.04], [0.06, 0.04], [0, 0.008]], 14), ceramic, x + cw * 0.2, y + k * 0.018, 0);
        } else if (kind === 1) {
          // a row of glasses
          for (let k = 0; k < 4; k++) {
            const gh = Math.min(0.16, rh - 0.04);
            const gx = x - cw * 0.3 + k * cw * 0.2;
            const gz = -0.03 + (k % 2) * 0.06;
            b.cyl(0.028, 0.03, 0.006, gx, y, gz, glassM, 8);
            b.cyl(0.004, 0.004, gh * 0.45, gx, y + 0.006, gz, glassM, 6);
            b.cyl(0.036, 0.01, gh * 0.55, gx, y + gh * 0.45, gz, glassM, 8);
          }
        } else ornament(b, rand, x - cw * 0.15, y, -0.01, rh - 0.04, 0.14), ornament(b, rand, x + cw * 0.2, y, 0.01, rh - 0.04, 0.12);
      }
    }
    // the doors: frames round the glass, handles in the accent
    const z = d / 2 - 0.012;
    const fy = sy0;
    const fh = top - sy0;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + t + cw * i;
      const fw = 0.035;
      b.box(fw, fh, 0.022, x0 + fw / 2 + 0.001, fy, z, f);
      b.box(fw, fh, 0.022, x0 + cw - fw / 2 - 0.001, fy, z, f);
      b.box(cw - 2 * fw, fw, 0.022, x0 + cw / 2, fy, z, f);
      b.box(cw - 2 * fw, fw, 0.022, x0 + cw / 2, fy + fh - fw, z, f);
      b.box(cw - 2 * fw, fh - 2 * fw, 0.004, x0 + cw / 2, fy + fw, z, glass());
      const hx = x0 + (i % 2 ? fw / 2 + 0.002 : cw - fw / 2 - 0.002);
      b.box(0.012, 0.14, 0.012, hx, fy + fh * 0.45, z + 0.017, a);
    }
  },
  speaker_floor: (b, w, d, h, f) => {
    // a tower: a cabinet with soft edges, a black baffle, a dome tweeter, three woofers with
    // rubber surrounds and dust caps, a bass port, a plinth on spikes
    b.box(w, 0.025, d, 0, 0.012, 0, mat(C.black, { roughness: 0.6 }));
    const by = 0.037;
    b.box(w, h - by, d - 0.01, 0, by, -0.005, f, 0.014);
    const baffle = mat("#1d1e21", { roughness: 0.75 });
    b.box(w - 0.016, h - by - 0.016, 0.01, 0, by + 0.008, d / 2 - 0.012, baffle);
    const zf = d / 2 - 0.002;
    const rubber = mat("#2b2d31", { roughness: 0.95 });
    const cone = mat("#3a3c40", { roughness: 0.8 });
    const metal = mat(C.steel, { metalness: 0.6, roughness: 0.3 });
    for (const [y, r] of [[0.9, 0.025], [0.72, 0.065], [0.52, 0.075], [0.32, 0.075]] as const) {
      const cy = by + (h - by) * y;
      const rr = Math.min(r, w * 0.4);
      const draw = () => {
        b.add(new THREE.TorusGeometry(rr + 0.004, 0.004, 4, 24), metal, 0, cy, zf);
        if (r > 0.05) {
          b.add(new THREE.TorusGeometry(rr - 0.006, 0.007, 5, 24), rubber, 0, cy, zf - 0.003);
          b.add(lathe([[0, -0.012], [rr * 0.35, -0.02], [rr - 0.01, -0.006], [rr - 0.01, -0.004], [0, -0.004]], 24).rotateX(Math.PI / 2), cone, 0, cy, zf);
          b.sphere(rr * 0.3, 0, cy, zf - 0.016, rubber, 1, 1, 0.5, 12);
        } else b.sphere(rr * 0.8, 0, cy, zf - 0.004, metal, 1, 1, 0.5, 14);
      };
      if (r > 0.05) b.pulser(0, cy, zf, draw);
      else draw();
    }
    // the bass port near the floor
    const pr = Math.min(0.03, w * 0.15);
    b.add(new THREE.TorusGeometry(pr, 0.006, 6, 20), mat("#111113"), 0, by + (h - by) * 0.12, zf - 0.002);
    b.add(new THREE.CircleGeometry(pr, 20), mat("#070708"), 0, by + (h - by) * 0.12, zf - 0.004);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new THREE.ConeGeometry(0.008, 0.012, 8).rotateX(Math.PI), metal, sx * (w / 2 - 0.025), 0.006, sz * (d / 2 - 0.03));
  },
  folding_screen: (b, w, d, h, f) => {
    // three framed panels in a zigzag, light woven inserts, brass hinges between, small feet
    const n = 3;
    const pw = w / n / Math.cos(0.35) - 0.01;
    const insert = mat("#e6dcc4", { roughness: 1, side: THREE.DoubleSide });
    const weave = mat("#cbbd9f", { roughness: 1 });
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const ph = h - 0.05;
      const fw = 0.035;
      const parts: [number, number, number, number, number, number, M][] = [
        [fw, ph, 0.025, -pw / 2 + fw / 2, 0, 0, f],
        [fw, ph, 0.025, pw / 2 - fw / 2, 0, 0, f],
        [pw - 2 * fw, fw, 0.025, 0, 0, 0, f],
        [pw - 2 * fw, fw, 0.025, 0, ph - fw, 0, f],
        [pw - 2 * fw, fw * 0.7, 0.02, 0, ph * 0.22, 0, f],
        [pw - 2 * fw, ph * 0.78 - fw - fw * 0.7, 0.006, 0, ph * 0.22 + fw * 0.7, 0, insert],
        [pw - 2 * fw, ph * 0.22 - fw, 0.006, 0, fw, 0, insert],
      ];
      for (const [bw, bh, bd, x, y, z, m] of parts) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
        mesh.position.set(x, y + bh / 2 + 0.05, z);
        g.add(mesh);
      }
      // a cane-like weave on the inserts: thin bars across
      for (let k = 1; k < 10; k++) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(pw - 2 * fw, 0.004, 0.008), weave);
        mesh.position.set(0, 0.05 + ph * 0.22 + fw * 0.7 + (k * (ph * 0.78 - fw - fw * 0.7)) / 10, 0);
        g.add(mesh);
      }
      for (const sx of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.05, 0.03), f);
        foot.position.set(sx * (pw / 2 - fw / 2), 0.025, 0);
        g.add(foot);
      }
      if (i < n - 1)
        for (const hy of [0.25, 0.75]) {
          const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8), brass());
          hinge.position.set(pw / 2 + 0.003, 0.05 + ph * hy, 0);
          g.add(hinge);
        }
      g.position.set(-w / 2 + (w / n) * (i + 0.5), 0, i % 2 ? d * 0.25 : -d * 0.25);
      g.rotation.y = i % 2 ? -0.35 : 0.35;
      b.g.add(g);
    }
  },
  rug_persian: (b, w, d, h, _f, color) => {
    // the patterned rug with a fringe of tassels at both ends
    const fl = Math.min(0.07, w * 0.04);
    b.box(w - 2 * fl, h, d, 0, 0, 0, rugMaterial("persian", color, mat(FINISHES[color] ?? FINISHES.terracotta)));
    fringe(b, w, d, fl, h);
  },
  rug_berber: (b, w, d, h, _f, color) => {
    const fl = Math.min(0.06, w * 0.04);
    b.box(w - 2 * fl, h, d, 0, 0, 0, rugMaterial("berber", color, mat(FINISHES[color] ?? FINISHES.beige)), Math.min(0.006, h / 2));
    fringe(b, w, d, fl, Math.min(h, 0.01));
  },
};
