// Built-in pieces added later: beds. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
// The double and single bed are drawn here too, with their choices (base, legs,
// headboard, top, cover, linen, kids' rails).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { FINISHES } from "../../model/modern";
import { fabricTexture } from "../finishes";
import type { Build, Builder } from "../modern";
import { C, mat, random, surface, v, wickerMat } from "../modern";

// ----- small helpers -----

/** A finish's colour, darker or lighter (k < 1 darker): textured finishes have a white material colour. */
const shade = (color: string, k: number) => {
  const c = new THREE.Color(FINISHES[color] ?? color);
  if (k > 1) c.lerp(new THREE.Color("#ffffff"), k - 1);
  else c.multiplyScalar(k);
  return "#" + c.getHexString();
};
const joint = () => mat("#1d1e21", { roughness: 1 });
const sheetMat = () => mat(C.mattress, { roughness: 1 });

/** Wooden finishes: drawn as wood (or painted wood), the others are upholstery. */
const WOODS = ["oak", "walnut", "white", "black"];
/** Natural wood for the wooden parts of a bed (futon frame, posts, rails): its finish, else its accent, else oak. */
const woodOf = (c: string, ac: string) => surface(WOODS.includes(c) ? c : ["black", "oak", "walnut"].includes(ac) ? ac : "oak", 0.6);

/** Bed linen colours: [duvet / sheet, pillows]. */
const LINEN: Record<string, [string, string]> = {
  white: ["#ebe6dc", "#f6f4ef"],
  grey: ["#b3b6b9", "#d5d7d9"],
  beige: ["#d8c8ad", "#e9e0cf"],
  green: ["#9daf97", "#c7d3c2"],
  blue: ["#9ab1c7", "#cad7e3"],
  pink: ["#e2b7b1", "#f1d8d3"],
  terracotta: ["#c47a56", "#e4b9a2"],
};
/** A throw that goes with a coloured linen (white linen takes one going with the frame, THROW). */
const THROW_ON: Record<string, string> = { grey: "#c9a24a", beige: "#5d7a60", green: "#e2d6bd", blue: "#d9c7a6", pink: "#8d9a83", terracotta: "#e2d6bd" };
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

/** Woven cotton in a colour (one material per colour and side). */
const linens = new Map<string, THREE.MeshStandardMaterial>();
function linenMat(color: string, side: THREE.Side = THREE.DoubleSide): THREE.MeshStandardMaterial {
  const key = `${color}/${side}`;
  let m = linens.get(key);
  if (!m) {
    const map = fabricTexture(color);
    linens.set(key, (m = map ? new THREE.MeshStandardMaterial({ map, roughness: 1, side }) : mat(color, { roughness: 1, side })));
  }
  return m;
}
/** A quilt: the linen colour stitched in diamonds. */
const quilts = new Map<string, THREE.MeshStandardMaterial>();
function quiltMat(color: string): THREE.MeshStandardMaterial {
  let m = quilts.get(color);
  if (m) return m;
  if (typeof document === "undefined") m = mat(color, { roughness: 1, side: THREE.DoubleSide });
  else {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const base = new THREE.Color(color);
    ctx.fillStyle = base.getStyle();
    ctx.fillRect(0, 0, 128, 128);
    // the stitching, darker, in diamonds
    ctx.strokeStyle = base.clone().multiplyScalar(0.72).getStyle();
    ctx.lineWidth = 2;
    for (let i = -128; i <= 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.moveTo(i, 128);
      ctx.lineTo(i + 128, 0);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide });
  }
  quilts.set(color, m);
  return m;
}

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

/** A square beam from p to q. */
function beam(b: Builder, p: THREE.Vector3, q: THREE.Vector3, t: number, m: THREE.Material) {
  const mesh = b.add(new THREE.BoxGeometry(t, Math.max(0.001, p.distanceTo(q)), t), m);
  mesh.position.copy(p).add(q).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(v(0, 1, 0), q.clone().sub(p).normalize());
  return mesh;
}

/** A bar handle on standoffs on a front facing +z (or ±x with `side`). */
function barHandle(b: Builder, x: number, y: number, z: number, len: number, m: THREE.Material, side = 0) {
  const out = 0.022;
  if (side) {
    hcyl(b, 0.006, len, x + side * out, y, z, m, "z", 8);
    for (const s of [-1, 1]) hcyl(b, 0.004, out, x + (side * out) / 2, y, z + s * (len / 2 - 0.02), m, "x", 6);
    return;
  }
  hcyl(b, 0.006, len, x, y, z + out, m, "x", 8);
  for (const s of [-1, 1]) hcyl(b, 0.004, out, x + s * (len / 2 - 0.02), y, z + out / 2, m, "z", 6);
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
    const corner = Math.abs(X * Z);
    p.setXYZ(i, X * (w / 2) * (1 + 0.04 * corner), p.getY(i) * (t / 2) * (1 - 0.3 * corner), Z * (d / 2) * (1 + 0.04 * corner));
  }
  geo.computeVertexNormals();
  const mesh = b.add(geo, m, x, y, z);
  mesh.rotation.set(rx, ry, 0, "YXZ");
  return mesh;
}

/** A surface through a grid of points (rows × cols, row-major). */
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

/** A board standing upright in the yz plane, from an outline in (-z, y), t thick, centred on x. */
function boardX(b: Builder, shape: THREE.Shape, t: number, x: number, m: THREE.Material, curve = 8) {
  const bt = Math.min(0.006, t / 4);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 1, curveSegments: curve });
  geo.translate(0, 0, -(t - 2 * bt) / 2);
  geo.rotateY(Math.PI / 2);
  return b.add(geo, m, x, 0, 0);
}

/** Draws with draw() and then turns what it drew by ry around y and moves it to (x, z). */
function turned(b: Builder, ry: number, x: number, z: number, draw: () => void) {
  const n0 = b.g.children.length;
  draw();
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
  for (const o of b.g.children.slice(n0)) o.applyMatrix4(m);
}

/** A curtain hanging from a post at (x, z) along ±z (dir), gathered by a tie halfway down. */
function tiedCurtain(b: Builder, x: number, z: number, top: number, cw: number, dir: number, m: THREE.Material, tie: THREE.Material) {
  const ch = top - 0.02;
  const geo = new THREE.PlaneGeometry(cw, ch, 8, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / ch + 0.5; // 0 at the hem, 1 at the top
    const k = 0.5;
    const gather = t > k ? 0.3 + 0.7 * smooth((t - k) / (1 - k)) : 0.3 + 0.4 * smooth((k - t) / k);
    const u = pos.getX(i) / cw + 0.5; // 0 at the post
    pos.setX(i, u * cw * gather);
    pos.setZ(i, Math.sin(u * Math.PI * 5) * 0.025 * (0.5 + gather));
  }
  geo.computeVertexNormals();
  geo.rotateY(dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  b.add(geo, m, x, 0.02 + ch / 2, z);
  b.add(new THREE.TorusGeometry(0.05, 0.008, 3, 8).rotateX(Math.PI / 2), tie, x, 0.02 + ch * 0.5, z + dir * 0.06);
}

/** A pleated frill (valance) of length len hanging from y, along x or z. */
function valance(b: Builder, len: number, hgt: number, x: number, y: number, z: number, along: "x" | "z", m: THREE.Material) {
  const n = Math.max(2, Math.round(len / 0.08) * 2);
  const geo = new THREE.PlaneGeometry(len, hgt, n, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, (i % 2 ? 1 : -1) * 0.008);
  geo.computeVertexNormals();
  if (along === "z") geo.rotateY(Math.PI / 2);
  b.add(geo, m, x, y - hgt / 2, z);
}

/** A curtain hanging straight in folds between (x0, z0) and (x1, z1), its top at y, h long. */
function hangingCurtain(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, m: THREE.Material, folds = 0.12) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(4, Math.round(len / (folds / 2)));
  const nx = -(z1 - z0) / len;
  const nz = (x1 - x0) / len;
  const pos: number[] = [];
  for (const t of [0, 0.5, 1])
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const wave = Math.sin(u * len * ((Math.PI * 2) / folds)) * 0.018 * (0.7 + t * 0.4);
      pos.push(x0 + (x1 - x0) * u + nx * wave, y - h * t, z0 + (z1 - z0) * u + nz * wave);
    }
  grid(b, pos, n + 1, m);
}

// ----- bed linen -----

interface Linen {
  w: number;
  zBack: number;
  zFront: number;
  y: number;
  mh?: number;
  drop: number;
  /** The frame's finish (the throw goes with it on white linen). */
  color: string;
  /** options.linen: the bedding's colour. */
  linen?: string;
  /** options.cover: duvet | quilt | throw | bare. */
  cover?: string;
  /** A duvet colour of its own (kids' beds). */
  duvet?: string;
  pillows?: number;
  throwOn?: boolean;
  seed?: number;
  step?: number;
}

/**
 * The bed linen on a mattress: the mattress (top at y + mh) and the chosen cover in the
 * linen colour: a duvet rolling over the sides and foot with its top folded back and a
 * throw across the foot; a flat stitched quilt; a sheet with a throw over the lower half;
 * or just the sheet. Pillows lean against the head end.
 */
function bedLinen(b: Builder, o: Linen) {
  const mh = o.mh ?? 0.2;
  const md = o.zFront - o.zBack;
  const name = o.linen && LINEN[o.linen] ? o.linen : "white";
  const [dc, pc] = LINEN[name];
  const duvetColor = o.duvet ?? dc;
  const cover = o.cover ?? "duvet";
  const dressed = cover === "duvet" || cover === "quilt";
  rbox(b, o.w, mh, md, 0, o.y, (o.zBack + o.zFront) / 2, dressed ? sheetMat() : linenMat(duvetColor, THREE.FrontSide), 0.05, 2);
  const top = o.y + mh;
  const r = 0.06;
  const hw = o.w / 2 - r + 0.012;
  const yTop = top + 0.012;
  const drop = Math.max(0.02, o.drop - r);
  const z0 = o.zBack + Math.min(0.62, md * 0.3);
  const z1 = o.zFront - r + 0.012;
  const opts = { r, drop, foot: true, puff: 0.035, fold: 0.016, seed: o.seed ?? 3, step: o.step };
  const throwColor = name === "white" || o.duvet ? (THROW[o.color] ?? "#a8603f") : THROW_ON[name];
  const fold = Math.min(0.3, md * 0.16);
  if (cover === "duvet") {
    const duvet = linenMat(duvetColor);
    cloth(b, hw, z0, z1, yTop, duvet, opts);
    // the top folded back over the duvet, the crease rolled at the head end
    cloth(b, hw, z0, z0 + fold, yTop + 0.018, duvet, { ...opts, r: r + 0.018, drop: drop * 0.85, foot: false });
    b.add(new THREE.CapsuleGeometry(0.024, hw * 2 + 0.02, 3, 10).rotateZ(Math.PI / 2), duvet, 0, yTop + 0.012 + 0.035 * 0.6, z0);
    if (o.throwOn !== false && md > 1) {
      const tz = z1 - Math.min(0.62, md * 0.3);
      cloth(b, hw, tz, tz + Math.min(0.42, md * 0.2), yTop + 0.014, linenMat(throwColor), { ...opts, r: r + 0.014, drop: drop * 0.8, foot: false });
    }
  } else if (cover === "quilt") {
    // thin and flat, hanging lower; its top turned back
    const q = quiltMat(duvetColor);
    const qd = drop;
    cloth(b, hw, z0, z1, yTop - 0.004, q, { ...opts, drop: qd, puff: 0.008, fold: 0.01 });
    cloth(b, hw, z0, z0 + fold * 0.8, yTop + 0.002, q, { ...opts, r: r + 0.006, drop: qd * 0.9, puff: 0.004, fold: 0.01, foot: false });
  } else if (cover === "throw") {
    // a knitted throw over the lower half of a made bed
    const tz = o.zBack + md * 0.48;
    cloth(b, hw, tz, z1, yTop + 0.002, linenMat(throwColor), { ...opts, drop: drop * 0.9, puff: 0.012, fold: 0.022 });
  }
  const n = o.pillows ?? (o.w > 1.2 ? 2 : 1);
  const pw = Math.min(0.72, o.w / n - 0.08);
  const pm = linenMat(dressed || name === "white" ? pc : dc, THREE.FrontSide);
  for (let i = 0; i < n; i++) {
    const x = -o.w / 2 + (o.w / n) * (i + 0.5);
    pillow(b, pw, 0.15, 0.44, x, top + 0.1, o.zBack + 0.27, pm, 0.5, (i - (n - 1) / 2) * 0.05);
  }
}

// ----- the configurable bed -----

/** Where the mattress lies on a base. */
interface Deck {
  y: number;
  mh: number;
  mw: number;
  zBack: number;
  zFront: number;
  drop: number;
}

/** A leg in its style, standing at (x, z), h tall. */
function leg(b: Builder, style: string, x: number, z: number, h: number, a: THREE.Material) {
  if (style === "block") rbox(b, 0.07, h, 0.07, x, 0, z, a, 0.008, 1);
  else if (style === "metal") {
    b.box(0.024, h, 0.024, x, 0, z, a);
    b.box(0.04, 0.006, 0.04, x, 0, z, a);
  } else {
    // turned
    const pts = [
      [0.017, 0],
      [0.021, 0.04],
      [0.03, 0.22],
      [0.032, 0.36],
      [0.02, 0.55],
      [0.016, 0.7],
      [0.027, 0.82],
      [0.026, 0.94],
      [0.024, 1],
    ].map(([r, y]) => new THREE.Vector2(r, y * h));
    b.add(new THREE.LatheGeometry(pts, 8), a, x, 0, z);
  }
}

const LEG_H: Record<string, number> = { tapered: 0.07, block: 0.09, metal: 0.13, turned: 0.13 };

function bedBase(b: Builder, base: string, legStyle: string, fw: number, d: number, hd: number, f: THREE.Material, a: THREE.Material, wood: THREE.Material, c: string): Deck {
  const zb = -d / 2;
  const dd = d - hd; // the base's depth in front of the headboard
  const zc = hd / 2;
  if (base === "platform") {
    // a wide low platform on a plinth set well back: it seems to float
    b.box(fw - 0.3, 0.1, dd - 0.3, 0, 0, zc, mat(shade(c, 0.32), { roughness: 0.9 }));
    rbox(b, fw, 0.1, dd, 0, 0.1, zc, f, 0.012, 1);
    return { y: 0.2, mh: 0.2, mw: fw - 0.2, zBack: zb + hd + 0.03, zFront: d / 2 - 0.12, drop: 0.15 };
  }
  if (base === "boxspring") {
    // a thick upholstered box on small feet, a mattress in the same cover, a topper
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbox(b, 0.06, 0.07, 0.06, sx * (fw / 2 - 0.08), 0, zc + sz * (dd / 2 - 0.08), a, 0.006, 1);
    // (a little narrower than the topper, so the duvet hangs clear of them)
    const bw = fw - 0.04;
    rbox(b, bw, 0.32, dd - 0.02, 0, 0.06, zc - 0.01, f, 0.03, 2);
    b.box(bw - 0.02, 0.014, dd - 0.04, 0, 0.375, zc - 0.01, mat(shade(c, 0.6), { roughness: 1 }));
    rbox(b, bw, 0.22, dd - 0.02, 0, 0.38, zc - 0.01, f, 0.045, 2);
    return { y: 0.6, mh: 0.075, mw: fw - 0.02, zBack: zb + hd + 0.01, zFront: d / 2 - 0.01, drop: 0.3 };
  }
  if (base === "storage") {
    // a box base with drawers on the long sides and at the foot, handles in the accent
    const bh = 0.36;
    b.box(fw - 0.06, 0.04, dd - 0.06, 0, 0, zc, joint());
    rbox(b, fw, bh - 0.04, dd, 0, 0.04, zc, f, 0.008, 1);
    const len = (dd - 0.5) / 2;
    const fh = bh - 0.13;
    const hy = 0.07 + fh / 2;
    for (const sx of [-1, 1])
      for (let i = 0; i < 2; i++) {
        const z = zb + hd + 0.06 + len * (i + 0.5) + (i ? 0.03 : 0);
        b.box(0.004, fh + 0.008, len + 0.006, sx * (fw / 2 + 0.001), 0.066, z, joint());
        b.box(0.018, fh, len, sx * (fw / 2 + 0.009), 0.07, z, f);
        barHandle(b, sx * (fw / 2 + 0.018), hy, z, Math.min(0.26, len * 0.4), a, sx);
      }
    const cw = (fw - 0.1) / 2;
    for (const sx of [-1, 1]) {
      const x = (sx * (cw + 0.01)) / 2;
      b.box(cw + 0.006, fh + 0.008, 0.004, x, 0.066, d / 2 + 0.001, joint());
      b.box(cw, fh, 0.018, x, 0.07, d / 2 + 0.009, f);
      barHandle(b, x, hy, d / 2 + 0.018, Math.min(0.26, cw * 0.4), a);
    }
    return { y: bh, mh: 0.2, mw: fw - 0.04, zBack: zb + hd + 0.01, zFront: d / 2 - 0.02, drop: 0.13 };
  }
  if (base === "floor") {
    // a Montessori floor bed: a low wooden frame round a mattress on the floor, open on one side
    const t = 0.035;
    const rh = 0.24;
    b.box(fw - 2 * t, 0.03, dd - 2 * t, 0, 0, zc, wood);
    const z0 = zb + hd;
    const z1 = d / 2;
    const g0 = z0 + dd * 0.38;
    const g1 = z0 + dd * 0.78;
    const side = (x: number, za: number, zz: number) => rbox(b, t, rh, zz - za, x, 0, (za + zz) / 2, wood, 0.012, 1);
    side(-(fw / 2 - t / 2), z0, z1);
    side(fw / 2 - t / 2, z0, g0);
    side(fw / 2 - t / 2, g1, z1);
    // a low sill across the way in
    rbox(b, t, 0.07, g1 - g0, fw / 2 - t / 2, 0, (g0 + g1) / 2, wood, 0.012, 1);
    rbox(b, fw, rh, t, 0, 0, z1 - t / 2, wood, 0.012, 1);
    const open = hd < 0.02;
    if (open) rbox(b, fw, rh, t, 0, 0, z0 + t / 2, wood, 0.012, 1);
    return { y: 0.03, mh: 0.16, mw: fw - 2 * t - 0.07, zBack: z0 + (open ? t : 0) + 0.01, zFront: z1 - t - 0.03, drop: 0.07 };
  }
  if (base === "futon") {
    // a low frame of beams on feet, slats across it, a thin mattress
    const t = 0.05;
    const foot = mat(shade(WOODS.includes(c) ? c : "walnut", 0.5));
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) b.box(0.08, 0.04, 0.08, sx * (fw / 2 - 0.08), 0, zc + sz * (dd / 2 - 0.08), foot);
    for (const sx of [-1, 1]) rbox(b, t, 0.1, dd, sx * (fw / 2 - t / 2), 0.04, zc, wood, 0.006, 1);
    for (const sz of [-1, 1]) rbox(b, fw - 2 * t, 0.08, t, 0, 0.05, zc + sz * (dd / 2 - t / 2), wood, 0.006, 1);
    const n = Math.max(6, Math.round(dd / 0.11));
    for (let i = 0; i < n; i++) b.box(fw - 0.03, 0.02, 0.075, 0, 0.13, zb + hd + 0.06 + ((dd - 0.12) * (i + 0.5)) / n, wood);
    return { y: 0.15, mh: 0.11, mw: fw - 0.16, zBack: zb + hd + 0.06, zFront: d / 2 - 0.08, drop: 0.08 };
  }
  // legs: a padded frame on short legs (the default)
  const legH = LEG_H[legStyle] ?? 0.07;
  const ft = Math.max(0.2, 0.33 - legH);
  if (legStyle === "tapered") taperLegs(b, fw - 0.02, dd, legH + 0.01, 0.07, 0.018, a, 0.004, zc);
  else for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(b, legStyle, sx * (fw / 2 - 0.08), zc + sz * (dd / 2 - 0.08), legH + 0.01, a);
  rbox(b, fw, ft, dd + 0.01, 0, legH, zc - 0.005, f, 0.035, 2);
  return { y: legH + ft, mh: 0.2, mw: fw - 0.06, zBack: zb + hd + 0.01, zFront: d / 2 - 0.03, drop: 0.24 };
}

const HEAD_DEPTH: Record<string, number> = { upholstered: 0.1, tufted: 0.12, wingback: 0.12, panel: 0.05, slatted: 0.06, rattan: 0.06, none: 0 };

function headboard(b: Builder, kind: string, w: number, d: number, h: number, hd: number, wing: number, mt: number, f: THREE.Material, wood: THREE.Material, solid: THREE.Material, c: string, single: boolean) {
  const zb = -d / 2;
  if (kind === "none") return;
  if (kind === "upholstered") {
    // padded, in vertical channels
    rbox(b, w + 0.02, h - 0.03, hd, 0, 0.03, zb + hd / 2, f, 0.04, 2);
    const groove = mat(shade(c, 0.62), { roughness: 1 });
    const n = Math.max(2, Math.round(w / (single ? 0.22 : 0.26)));
    const y0 = mt - 0.13;
    for (let i = 1; i < n; i++) b.box(0.009, h - y0 - 0.06, 0.006, -w / 2 + (w / n) * i, y0, zb + hd, groove);
    return;
  }
  if (kind === "tufted") {
    // a padded panel with a raised, buttoned middle (diamond pattern)
    rbox(b, w + 0.02, h - 0.03, hd - 0.03, 0, 0.03, zb + (hd - 0.03) / 2, f, 0.04, 1);
    const y0 = mt - 0.1;
    rbox(b, w - 0.06, h - y0 - 0.07, 0.04, 0, y0, zb + hd - 0.025, f, 0.02, 2);
    const button = mat(shade(c, 0.55), { roughness: 0.9 });
    const cols = Math.max(3, Math.round(w / 0.2));
    const rows = Math.max(2, Math.round((h - y0 - 0.2) / 0.15));
    const gy = (h - y0 - 0.22) / Math.max(1, rows - 1);
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < cols - (r % 2); i++) {
        const x = -w / 2 + 0.09 + ((w - 0.18) / (cols - 1)) * (i + (r % 2) * 0.5);
        b.add(new THREE.SphereGeometry(0.016, 5, 3), button, x, y0 + 0.11 + r * gy, zb + hd + 0.014);
      }
    return;
  }
  if (kind === "wingback") {
    // a tall padded back with wings coming forward round the pillows
    const iw = w - 2 * wing;
    rbox(b, iw + 0.02, h - 0.03, hd, 0, 0.03, zb + hd / 2, f, 0.05, 2);
    const groove = mat(shade(c, 0.62), { roughness: 1 });
    const n = Math.max(2, Math.round(iw / 0.3));
    for (let i = 1; i < n; i++) b.box(0.009, h - mt + 0.07, 0.006, -iw / 2 + (iw / n) * i, mt - 0.13, zb + hd, groove);
    for (const sx of [-1, 1]) {
      rbox(b, wing + 0.02, h - 0.03, 0.36, sx * (w / 2 - wing / 2 - 0.01), 0.03, zb + 0.18, f, 0.05, 2);
      b.box(0.006, h - 0.12, 0.012, sx * (w / 2 - wing - 0.002), 0.08, zb + 0.355, groove);
    }
    return;
  }
  if (kind === "panel") {
    // a board with a capping rail and raised panels
    rbox(b, w + 0.04, h - 0.03, hd, 0, 0, zb + hd / 2, solid, 0.006, 1);
    rbox(b, w + 0.08, 0.035, hd + 0.03, 0, h - 0.035, zb + (hd + 0.03) / 2, solid, 0.008, 1);
    const n = Math.max(2, Math.round(w / 0.55));
    const pw = (w - 0.1) / n;
    const y0 = Math.max(0.2, mt - 0.05);
    const ph = h - 0.1 - y0;
    const line = mat(shade(c, 0.55), { roughness: 0.8 });
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.05 + pw * (i + 0.5);
      b.box(pw - 0.05, ph, 0.004, x, y0, zb + hd + 0.001, line);
      rbox(b, pw - 0.07, ph - 0.03, 0.014, x, y0 + 0.015, zb + hd + 0.002, solid, 0.004, 1);
    }
    return;
  }
  // slatted and rattan: two posts, rails, and slats or a woven cane panel between
  const p = 0.06;
  for (const sx of [-1, 1]) {
    rbox(b, p, h - 0.02, p, sx * (w / 2 - p / 2), 0, zb + p / 2, wood, 0.008, 1);
    b.box(p + 0.012, 0.02, p + 0.012, sx * (w / 2 - p / 2), h - 0.02, zb + p / 2, wood, 0.004);
  }
  const yb = Math.max(0.12, mt - 0.12);
  rbox(b, w - 2 * p + 0.01, 0.06, 0.045, 0, h - 0.08, zb + p / 2, wood, 0.008, 1);
  rbox(b, w - 2 * p + 0.01, 0.05, 0.04, 0, yb, zb + p / 2, wood, 0.006, 1);
  const iw = w - 2 * p;
  if (kind === "rattan") {
    // cane in an inner frame of round rod, split into panels
    const ih = h - 0.08 - yb - 0.05;
    b.box(iw, ih, 0.006, 0, yb + 0.05, zb + p / 2, wickerMat("sand"));
    for (const y of [yb + 0.065, h - 0.095]) hcyl(b, 0.012, iw, 0, y, zb + p / 2 + 0.012, wood, "x", 8);
    const n = Math.max(2, Math.round(iw / 0.5));
    for (let i = 1; i < n; i++) b.box(0.02, ih, 0.025, -iw / 2 + (iw / n) * i, yb + 0.05, zb + p / 2, wood);
    return;
  }
  const n = Math.max(3, Math.round(iw / 0.1));
  for (let i = 0; i < n; i++) b.box(0.05, h - 0.08 - yb - 0.05, 0.024, -iw / 2 + (iw / n) * (i + 0.5), yb + 0.05, zb + p / 2, wood);
}

/** Kids' fall-out rails: a rail on posts with spindles, along z at x = at (or along x at z = at with `alongX`). */
function rail(b: Builder, at: number, a0: number, a1: number, y0: number, y1: number, m: THREE.Material, alongX = false) {
  const len = a1 - a0;
  if (len < 0.1) return;
  const mid = (a0 + a1) / 2;
  for (const s of [a0 + 0.02, a1 - 0.02]) {
    if (alongX) b.box(0.04, y1 - y0, 0.04, s, y0, at, m);
    else b.box(0.04, y1 - y0, 0.04, at, y0, s, m);
  }
  if (alongX) {
    b.box(len, 0.035, 0.035, mid, y1 - 0.035, at, m);
    b.box(len, 0.03, 0.03, mid, y0 + 0.02, at, m);
  } else {
    b.box(0.035, 0.035, len, at, y1 - 0.035, mid, m);
    b.box(0.03, 0.03, len, at, y0 + 0.02, mid, m);
  }
  const n = Math.max(2, Math.round(len / 0.1));
  for (let i = 1; i < n; i++) {
    const s = a0 + (len * i) / n;
    if (alongX) b.box(0.022, y1 - y0 - 0.06, 0.022, s, y0 + 0.04, at, m);
    else b.box(0.022, y1 - y0 - 0.06, 0.022, at, y0 + 0.04, s, m);
  }
}

/** The double or single bed, drawn as its options say. */
function bed(b: Builder, w: number, d: number, h: number, f: THREE.Material, c: string, a: THREE.Material, ac: string, single: boolean) {
  const o = b.options;
  const base = o.base ?? "legs";
  const head = o.headboard ?? "upholstered";
  const top = o.top ?? "none";
  const rails = single ? (o.rails ?? "none") : "none";
  const wood = woodOf(c, ac);
  const solid = WOODS.includes(c) ? surface(c, 0.6) : f;
  const zb = -d / 2;
  const hd = HEAD_DEPTH[head] ?? 0.1;
  const wing = head === "wingback" ? Math.min(0.1, w * 0.07) : 0;
  const fw = w - 2 * wing;
  const deck = bedBase(b, base, o.legs ?? "tapered", fw, d, hd, f, a, wood, c);
  const mt = deck.y + deck.mh;
  headboard(b, head, w, d, h, hd, wing, mt, f, wood, solid, c, single);
  bedLinen(b, { w: deck.mw, zBack: deck.zBack, zFront: deck.zFront, y: deck.y, mh: deck.mh, drop: deck.drop, color: c, linen: o.linen, cover: o.cover, seed: single ? 5 : 3 });
  // what rises above the bed: kids' rails, posts, a canopy, a crown, a house frame
  b.above(() => {
    if (rails !== "none") {
      const y0 = Math.max(0.02, deck.y - 0.08);
      const y1 = mt + 0.22;
      const x = fw / 2 + 0.005;
      const z0 = deck.zBack + 0.01;
      const z1 = deck.zFront + 0.02;
      if (rails === "half") {
        const zm = z0 + (z1 - z0) * 0.5;
        for (const sx of [-1, 1]) rail(b, sx * x, z0, zm, y0, y1, wood);
      } else {
        // all round, with a way in on the right
        const g0 = z0 + (z1 - z0) * 0.4;
        const g1 = z0 + (z1 - z0) * 0.78;
        rail(b, -x, z0, z1, y0, y1, wood);
        rail(b, x, z0, g0, y0, y1, wood);
        rail(b, x, g1, z1, y0, y1, wood);
        rail(b, z1 + 0.02, -x - 0.02, x + 0.02, y0, y1, wood, true);
        if (head === "none") rail(b, z0 - 0.02, -x - 0.02, x + 0.02, y0, y1, wood, true);
      }
    }
    if (top === "none") return;
    const [dc] = LINEN[o.linen && LINEN[o.linen] ? o.linen : "white"];
    const T = Math.max(h + 0.4, single ? 1.95 : 2.1);
    const postM = WOODS.includes(c) ? surface(c, 0.6) : a;
    const round = !WOODS.includes(c);
    const p = round ? 0.04 : 0.055;
    const px = w / 2 + p / 2 - 0.01;
    const zf = d / 2 + p / 2 - 0.02;
    const zr = zb + p / 2;
    if (top === "posts" || top === "canopy") {
      for (const sx of [-1, 1])
        for (const z of [zr, zf]) {
          if (round) {
            b.cyl(0.02, 0.022, T - 0.02, sx * px, 0, z, postM, 10);
            b.sphere(0.03, sx * px, T, z, postM, 1, 1, 1, 8);
          } else {
            rbox(b, p, T - 0.02, p, sx * px, 0, z, postM, 0.008, 1);
            b.cyl(0.018, 0.03, 0.05, sx * px, T - 0.02, z, postM, 10);
          }
        }
      const y = T - 0.08;
      if (round) {
        for (const z of [zr, zf]) hcyl(b, 0.014, 2 * px, 0, y, z, postM, "x", 8);
        for (const sx of [-1, 1]) hcyl(b, 0.014, zf - zr, sx * px, y, (zr + zf) / 2, postM, "z", 8);
      } else {
        for (const z of [zr, zf]) b.box(2 * px, 0.05, 0.035, 0, y - 0.025, z, postM);
        for (const sx of [-1, 1]) b.box(0.035, 0.05, zf - zr, sx * px, y - 0.025, (zr + zf) / 2, postM);
      }
      if (top === "canopy") {
        const linen = linenMat(dc);
        // a fabric roof sagging a little between the rails, a frill round it
        const geo = new THREE.PlaneGeometry(2 * px, zf - zr, 6, 8).rotateX(-Math.PI / 2);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const kx = (2 * pos.getX(i)) / (2 * px);
          const kz = (2 * pos.getZ(i)) / (zf - zr);
          pos.setY(i, -0.05 * (1 - kx * kx) * (1 - kz * kz));
        }
        geo.computeVertexNormals();
        b.add(geo, linen, 0, y + 0.02, (zr + zf) / 2);
        for (const z of [zr, zf]) valance(b, 2 * px - p, 0.18, 0, y + 0.02, z + (z > 0 ? 0.025 : -0.025), "x", linen);
        for (const sx of [-1, 1]) valance(b, zf - zr - p, 0.18, sx * (px + 0.025), y + 0.02, (zr + zf) / 2, "z", linen);
        // curtains tied back at each post, along the long sides
        const tie = linenMat(THROW[c] ?? "#a8603f");
        for (const sx of [-1, 1]) {
          tiedCurtain(b, sx * (px + 0.03), zr + 0.03, y - 0.15, 0.45, 1, linen, tie);
          tiedCurtain(b, sx * (px + 0.03), zf - 0.03, y - 0.15, 0.45, -1, linen, tie);
        }
      }
      return;
    }
    if (top === "crown") {
      // a half-round crown on the wall above the headboard, drapes falling to both sides
      const R = Math.min(0.32, w * 0.2);
      const zw = zb + 0.005;
      b.add(new THREE.CylinderGeometry(R, R, 0.04, 16, 1, false, -Math.PI / 2, Math.PI), postM, 0, T - 0.02, zw);
      b.add(new THREE.CylinderGeometry(R * 0.6, R * 0.95, 0.06, 16, 1, false, -Math.PI / 2, Math.PI), postM, 0, T + 0.03, zw);
      b.sphere(0.035, 0, T + 0.085, zw + 0.03, postM, 1, 1, 1, 10);
      const linen = linenMat(dc);
      // a frill round the crown's front
      const n = 32;
      const fr: number[] = [];
      for (const t of [0, 1])
        for (let i = 0; i <= n; i++) {
          const ang = -Math.PI / 2 + (Math.PI * i) / n;
          const rr = R + 0.012 + (i % 2 ? 0.012 : 0);
          fr.push(Math.sin(ang) * rr, T - 0.04 - t * 0.14, zw + Math.cos(ang) * rr);
        }
      grid(b, fr, n + 1, linen);
      // the drapes: their tops round the crown's half, their hems on the floor beside the bed
      const nu = 10;
      const nt = 12;
      for (const s of [-1, 1]) {
        const pos: number[] = [];
        for (let j = 0; j <= nt; j++) {
          const t = j / nt;
          const y = (T - 0.06) * (1 - t) + 0.01 * t;
          const out = Math.sin(Math.min(1, t * 2.1) * (Math.PI / 2));
          for (let i = 0; i <= nu; i++) {
            const u = i / nu;
            const ang = s * u * (Math.PI / 2);
            const tx = Math.sin(ang) * (R + 0.01);
            const tz = zw + Math.cos(ang) * (R + 0.01);
            // the hem: from beside the bed's head (u = 0) round to the wall (u = 1)
            const hx = s * (w / 2 + 0.05 + u * 0.22);
            const hz = zb + 0.42 - u * 0.4;
            const wave = Math.sin(u * Math.PI * 7) * 0.02 * (0.4 + t);
            pos.push(tx + (hx - tx) * out, y, tz + (hz - tz) * out + wave);
          }
        }
        grid(b, pos, nu + 1, linen);
      }
      return;
    }
    // house: four posts and a gable roof outline with a little chimney
    const hw = w / 2 + 0.02;
    const eave = Math.max(h + 0.25, T - Math.min(0.7, w * 0.55));
    const t = 0.055;
    for (const sx of [-1, 1]) for (const z of [zr, zf]) b.box(t, eave, t, sx * hw, 0, z, wood);
    for (const z of [zr, zf]) {
      for (const sx of [-1, 1]) beam(b, v(sx * (hw + 0.06), eave - 0.06, z), v(0, T, z), t, wood);
      b.box(2 * hw, 0.045, t, 0, eave - 0.045, z, wood);
    }
    b.box(t, t, zf - zr + 0.1, 0, T - t * 0.7, (zr + zf) / 2, wood);
    for (const sx of [-1, 1]) b.box(t * 0.8, t * 0.8, zf - zr, sx * hw, eave - t * 0.8, (zr + zf) / 2, wood);
    const cz = zr + (zf - zr) * 0.25;
    const cx = hw * 0.45;
    const cy = eave + ((T - eave) * (hw - cx)) / hw;
    b.box(0.1, 0.18, 0.1, cx, cy - 0.04, cz, wood);
  });
}

// ----- kids' bed parts -----

/** A duvet colour for a kids' bed in a finish. */
const KID_DUVET: Record<string, string> = { red: "#d6e1ea", blue: "#f2d47c", white: "#bcd7ea", green: "#f1e2b0", black: "#e7d9c3", oak: "#cfe3d2", grey: "#f0c9b8", pink: "#d3eadf", walnut: "#e8d9bd" };
const TOY = ["#e0533d", "#f2c84b", "#3f8fd2", "#5bb36a", "#e98bb0", "#8a63c7"];

/** A ladder of two rails and round rungs on the side at x, between z0 and z1, up to y1. */
function ladder(b: Builder, x: number, z0: number, z1: number, y1: number, m: THREE.Material) {
  for (const s of [z0, z1]) b.box(0.032, y1, 0.05, x, 0, s, m);
  for (let y = 0.28; y < y1 - 0.15; y += 0.27) hcyl(b, 0.016, Math.abs(z1 - z0), x, y, (z0 + z1) / 2, m, "z", 10);
}

/**
 * A raised bed (posts, side and end rails, slats, mattress and linen) over x0..x1 × z0..z1,
 * its deck at yd, guard rails up to yg; the right side open over the ladder between gz0 and
 * gz1, the foot end open in the middle by endGap.
 */
function raisedBed(b: Builder, x0: number, x1: number, z0: number, z1: number, yd: number, yg: number, f: THREE.Material, c: string, o: { gz0?: number; gz1?: number; endGap?: number; seed?: number; duvet?: string }) {
  const p = 0.065;
  const w = x1 - x0;
  const d = z1 - z0;
  const xc = (x0 + x1) / 2;
  const zc = (z0 + z1) / 2;
  for (const x of [x0 + p / 2, x1 - p / 2]) for (const z of [z0 + p / 2, z1 - p / 2]) rbox(b, p, yg + 0.02, p, x, 0, z, f, 0.012, 1);
  // the deck's rails and slats
  for (const x of [x0 + p / 2, x1 - p / 2]) b.box(0.03, 0.16, d - 2 * p + 0.01, x, yd - 0.13, zc, f);
  for (const z of [z0 + p / 2, z1 - p / 2]) b.box(w - 2 * p + 0.01, 0.16, 0.03, xc, yd - 0.13, z, f);
  b.box(w - 2 * p, 0.02, d - 2 * p, xc, yd - 0.06, zc, mat(shade(c, 0.55)));
  const n0 = b.g.children.length;
  bedLinen(b, { w: w - 2 * p - 0.03, zBack: z0 + p + 0.01, zFront: z1 - p - 0.01, y: yd - 0.04, mh: 0.14, drop: 0.06, color: c, pillows: 1, duvet: o.duvet ?? KID_DUVET[c], seed: o.seed ?? 5, step: 0.17 });
  if (Math.abs(xc) > 1e-6) for (const m of b.g.children.slice(n0)) m.position.x += xc;
  // guard rails: two rails on the long sides, a board at each end
  const yr = [yg - 0.03, (yg + yd) / 2 + 0.03];
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? x0 + p / 2 : x1 - p / 2;
    const parts: [number, number][] = sx > 0 && o.gz0 !== undefined && o.gz1 !== undefined ? [[z0 + p, o.gz0], [o.gz1, z1 - p]] : [[z0 + p, z1 - p]];
    for (const [a, e] of parts) {
      if (e - a < 0.05) continue;
      for (const y of yr) b.box(0.03, 0.05, e - a, x, y - 0.025, (a + e) / 2, f);
    }
  }
  for (const z of [z0 + p / 2, z1 - p / 2]) {
    const gap = z > zc ? (o.endGap ?? 0) : 0;
    if (gap) {
      const seg = (w - 2 * p - gap) / 2;
      for (const s of [-1, 1]) b.box(seg, yg - yd - 0.02, 0.022, xc + s * (gap / 2 + seg / 2), yd + 0.03, z, f);
    } else b.box(w - 2 * p + 0.01, yg - yd - 0.02, 0.022, xc, yd + 0.03, z, f);
  }
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  bed: (b, w, d, h, f, c, a, ac) => bed(b, w, d, h, f, c, a, ac, false),
  bed_single: (b, w, d, h, f, c, a, ac) => bed(b, w, d, h, f, c, a, ac, true),

  bed_car: (b, w, d, h, _f, c) => {
    // a race car: moulded side panels with wheels on them, a raised boot at the head
    // with a spoiler, a bonnet over the foot with headlights and a grille
    const paint = mat(FINISHES[c] ?? c, { roughness: 0.3, metalness: 0.15 });
    const trim = mat(c === "black" ? "#e9e6df" : "#1f2024", { roughness: 0.5 });
    const k = h / 0.62;
    const zb = -d / 2;
    const zf = d / 2;
    const P = (z: number, y: number): [number, number] => [-z, y * k];
    const side = new THREE.Shape();
    side.moveTo(...P(zb + 0.04, 0));
    side.lineTo(...P(zf - 0.08, 0));
    side.quadraticCurveTo(...P(zf, 0), ...P(zf, 0.07));
    side.lineTo(...P(zf, 0.2));
    side.quadraticCurveTo(...P(zf - 0.01, 0.33), ...P(zf - 0.2, 0.365));
    side.quadraticCurveTo(...P(zf - 0.55, 0.44), ...P(zf - 0.7, 0.43));
    side.quadraticCurveTo(...P(zf - 0.82, 0.43), ...P(zf - 0.9, 0.39));
    side.lineTo(...P(zb + 0.55, 0.39));
    side.quadraticCurveTo(...P(zb + 0.4, 0.39), ...P(zb + 0.32, 0.46));
    side.lineTo(...P(zb + 0.08, 0.48));
    side.quadraticCurveTo(...P(zb, 0.48), ...P(zb, 0.41));
    side.lineTo(...P(zb, 0.04));
    side.quadraticCurveTo(...P(zb, 0), ...P(zb + 0.04, 0));
    const t = 0.045;
    const xs = w / 2 - 0.02 - t / 2;
    for (const sx of [-1, 1]) boardX(b, side, t, sx * xs, paint);
    // the boot (head end) and bonnet (foot end) between the sides
    const boot = new THREE.Shape();
    boot.moveTo(...P(zb + 0.02, 0.05));
    boot.lineTo(...P(zb + 0.3, 0.05));
    boot.lineTo(...P(zb + 0.3, 0.45));
    boot.lineTo(...P(zb + 0.08, 0.47));
    boot.quadraticCurveTo(...P(zb + 0.02, 0.47), ...P(zb + 0.02, 0.41));
    boot.lineTo(...P(zb + 0.02, 0.05));
    boardX(b, boot, 2 * xs, 0, paint);
    const bonnet = new THREE.Shape();
    bonnet.moveTo(...P(zf - 0.16, 0.05));
    bonnet.lineTo(...P(zf - 0.02, 0.05));
    bonnet.lineTo(...P(zf - 0.02, 0.2));
    bonnet.quadraticCurveTo(...P(zf - 0.03, 0.32), ...P(zf - 0.2, 0.355));
    bonnet.quadraticCurveTo(...P(zf - 0.55, 0.43), ...P(zf - 0.7, 0.42));
    bonnet.quadraticCurveTo(...P(zf - 0.8, 0.42), ...P(zf - 0.86, 0.39));
    bonnet.lineTo(...P(zf - 0.86, 0.335));
    bonnet.lineTo(...P(zf - 0.2, 0.335));
    bonnet.lineTo(...P(zf - 0.2, 0.05));
    boardX(b, bonnet, 2 * xs, 0, paint);
    // wheels moulded on the sides: tyre, rim, hub and spokes, an arch over each
    const tyre = mat("#1b1c1e", { roughness: 0.85 });
    const rim = mat(C.chrome, { metalness: 0.7, roughness: 0.3 });
    const R = Math.min(0.19 * k, 0.2);
    for (const sx of [-1, 1])
      for (const wz of [zb + 0.42, zf - 0.48]) {
        const x = sx * (w / 2 - 0.02);
        hcyl(b, R, 0.03, x, R + 0.005, wz, tyre, "x", 22);
        hcyl(b, R * 0.62, 0.036, x, R + 0.005, wz, rim, "x", 18);
        hcyl(b, R * 0.18, 0.044, x, R + 0.005, wz, trim, "x", 10);
        for (let i = 0; i < 5; i++) {
          const an = (i / 5) * Math.PI * 2;
          const bar = b.box(0.04, R * 0.4, 0.03, x, 0, wz, trim);
          if (bar) {
            bar.position.set(x, R + 0.005 + Math.cos(an) * R * 0.36, wz + Math.sin(an) * R * 0.36);
            bar.rotation.x = an;
          }
        }
        b.add(new THREE.TorusGeometry(R + 0.03, 0.012, 4, 14, Math.PI).rotateY(Math.PI / 2), trim, x - sx * 0.002, R + 0.005, wz);
      }
    // a racing number disc on each side
    const white = mat("#f4f2ec", { roughness: 0.5 });
    for (const sx of [-1, 1]) {
      hcyl(b, 0.09 * k, 0.008, sx * (w / 2 - 0.017), 0.22 * k, 0, white, "x", 18);
      b.box(0.012, 0.1 * k, 0.025, sx * (w / 2 - 0.016), 0.17 * k, 0, trim);
    }
    // the nose: headlights, a grille
    const lamp = mat("#fff8df", { emissive: "#fff1c2", emissiveIntensity: 0.35, roughness: 0.2 });
    for (const sx of [-1, 1]) b.sphere(0.06, sx * (w / 2 - 0.17), 0.2 * k, zf - 0.02, lamp, 1, 0.55, 0.35, 12);
    rbox(b, w * 0.34, 0.07 * k, 0.012, 0, 0.1 * k, zf - 0.015, trim, 0.004, 1);
    // the spoiler on two struts over the boot, end plates
    for (const sx of [-1, 1]) b.box(0.035, h - 0.47 * k - 0.04, 0.08, sx * (w * 0.3), 0.46 * k, zb + 0.13, trim);
    const wing = new THREE.Shape();
    wing.moveTo(-(zb + 0.02), h - 0.035);
    wing.quadraticCurveTo(-(zb + 0.1), h + 0.002, -(zb + 0.25), h - 0.03);
    wing.lineTo(-(zb + 0.02), h - 0.06);
    wing.lineTo(-(zb + 0.02), h - 0.035);
    boardX(b, wing, w - 0.03, 0, paint, 6);
    const plate = new THREE.Shape();
    plate.moveTo(-zb, h - 0.1);
    plate.lineTo(-(zb + 0.27), h - 0.08);
    plate.lineTo(-(zb + 0.27), h - 0.02);
    plate.lineTo(-zb, h);
    plate.lineTo(-zb, h - 0.1);
    for (const sx of [-1, 1]) boardX(b, plate, 0.012, sx * (w / 2 - 0.016), trim, 2);
    // inside: a base, the mattress and linen
    b.box(2 * xs - t, 0.12, zf - 0.2 - (zb + 0.3), 0, 0.02, (zf - 0.2 + zb + 0.3) / 2, mat(shade(c, 0.5)));
    bedLinen(b, { w: w - 0.2, zBack: zb + 0.31, zFront: zf - 0.21, y: 0.14, mh: 0.12, drop: 0.05, color: c, pillows: 1, duvet: KID_DUVET[c], seed: 9, step: 0.16 });
  },

  bed_midsleeper: (b, w, d, h, f, c, a) => {
    // a raised bed with guard rails and a ladder at the foot of its right side; under it
    // drawers and shelves, or a den behind curtains
    const p = 0.065;
    const yd = Math.max(0.55, h - 0.43);
    const zl0 = d / 2 - p - 0.44;
    const zl1 = d / 2 - p - 0.04;
    raisedBed(b, -w / 2, w / 2, -d / 2, d / 2, yd, h - 0.02, f, c, { gz0: zl0 - 0.02, gz1: zl1 + 0.02, seed: 4 });
    ladder(b, w / 2 - 0.016, zl0, zl1, h - 0.06, f);
    const under = yd - 0.15;
    const inner = w - 2 * p - 0.02;
    if ((b.options.under ?? "storage") === "storage") {
      // a chest of three drawers under the head end, open shelves with bins beside it
      const cz0 = -d / 2 + p + 0.01;
      const cl = Math.min(0.8, (d - 2 * p) * 0.42);
      const ch = Math.min(0.7, under - 0.03);
      rbox(b, inner, ch, cl, 0, 0, cz0 + cl / 2, f, 0.004, 1);
      const fx = inner / 2;
      for (let i = 0; i < 3; i++) {
        const fh = (ch - 0.06) / 3;
        const y = 0.04 + fh * i;
        b.box(0.004, fh, cl - 0.03, fx + 0.001, y, cz0 + cl / 2, joint());
        rbox(b, 0.018, fh - 0.006, cl - 0.04, fx + 0.009, y + 0.003, cz0 + cl / 2, f, 0.004, 1);
        b.sphere(0.016, fx + 0.026, y + fh / 2, cz0 + cl / 2, a, 0.75, 1, 1, 10);
      }
      const sz0 = cz0 + cl + 0.02;
      const sl = Math.min(0.75, zl0 - 0.05 - sz0);
      if (sl > 0.2) {
        const sh = ch;
        const sd = inner * 0.8;
        const sx = inner / 2 - sd / 2;
        for (const z of [sz0 + 0.01, sz0 + sl - 0.01]) rbox(b, sd, sh, 0.02, sx, 0, z, f, 0.004, 1);
        const rows = 2;
        for (let r = 0; r <= rows; r++) rbox(b, sd, 0.02, sl, sx, r === 0 ? 0.02 : (sh - 0.02) * (r / rows), sz0 + sl / 2, f, 0.004, 1);
        b.box(0.01, sh, sl, sx - sd / 2 + 0.005, 0, sz0 + sl / 2, f);
        for (let r = 0; r < rows; r++) {
          const by = r === 0 ? 0.04 : (sh - 0.02) * (r / rows) + 0.02;
          rbox(b, sd * 0.85, Math.min(0.24, (sh - 0.06) / rows - 0.04), sl - 0.08, sx, by, sz0 + sl / 2, mat(TOY[(r * 2 + 1) % TOY.length], { roughness: 0.9 }), 0.02, 2);
        }
      }
    } else {
      // a den: curtains on the open side and the foot, a floor mat and cushions, bunting
      const fab = linenMat(TOY[c === "pink" ? 4 : c === "blue" ? 1 : 2]);
      const fab2 = linenMat("#f3ede1");
      const xc = w / 2 - p - 0.005;
      const top = under + 0.02;
      const z0 = -d / 2 + p;
      const z1 = d / 2 - p;
      const zo = z0 + (z1 - z0) * 0.55;
      hangingCurtain(b, xc, z0, xc, zo, top, top - 0.02, fab);
      hangingCurtain(b, xc, zo + 0.42, xc, z1, top, top - 0.02, fab);
      hangingCurtain(b, -w / 2 + p, z1 - 0.005, w / 2 - p, z1 - 0.005, top, top - 0.02, fab2);
      hcyl(b, 0.01, z1 - z0, xc, top, (z0 + z1) / 2, a, "z", 6);
      rbox(b, inner - 0.04, 0.08, (z1 - z0) * 0.6, -0.02, 0, z0 + (z1 - z0) * 0.35, linenMat(KID_DUVET[c] ?? "#bcd7ea", THREE.FrontSide), 0.03, 2);
      for (let i = 0; i < 2; i++) pillow(b, 0.36, 0.12, 0.36, -inner / 4, 0.2, z0 + 0.25 + i * 0.4, linenMat(TOY[i * 3], THREE.FrontSide), 0.3, 0.2 * i);
      // bunting along the inside of the open side
      const n = Math.max(4, Math.round((z1 - z0) / 0.14));
      for (let k = 0; k < 3; k++) {
        const pos: number[] = [];
        for (let i = k; i < n; i += 3) {
          const zc = z0 + 0.06 + ((z1 - z0 - 0.12) * (i + 0.5)) / n;
          pos.push(xc - 0.03, top - 0.03, zc - 0.05, xc - 0.03, top - 0.03, zc + 0.05, xc - 0.03, top - 0.15, zc);
        }
        if (!pos.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        b.add(geo, mat(TOY[k * 2], { side: THREE.DoubleSide, roughness: 0.9 }));
      }
    }
  },

  bunk_bed_l: (b, w, d, h, f, c) => {
    // two beds at right angles: the lower one along the back, the upper one along the left
    // side on posts, over the lower bed's end; a ladder at the upper bed's front
    const bw = Math.min(1.0, Math.min(w, d) * 0.46);
    const p = 0.065;
    const yu = Math.max(0.8, h - 0.55);
    const zl0 = d / 2 - p - 0.46;
    const zl1 = d / 2 - p - 0.04;
    raisedBed(b, -w / 2, -w / 2 + bw, -d / 2, d / 2, yu, h - 0.02, f, c, { gz0: zl0 - 0.02, gz1: zl1 + 0.02, seed: 6, duvet: "#f2c9a6" });
    ladder(b, -w / 2 + bw - 0.016, zl0, zl1, h - 0.06, f);
    // the lower bed, drawn along z and turned to run along x, its head on the right
    const L = w;
    turned(b, -Math.PI / 2, 0, -d / 2 + bw / 2, () => {
      const yl = 0.24;
      const hw = bw / 2;
      for (const sz of [-1, 1]) rbox(b, bw, sz < 0 ? 0.62 : 0.4, p, 0, 0, sz * (L / 2 - p / 2), f, 0.012, 1);
      for (const sx of [-1, 1]) rbox(b, 0.03, 0.16, L - 2 * p + 0.01, sx * (hw - 0.015), yl - 0.13, 0, f, 0.006, 1);
      b.box(bw - 0.06, 0.02, L - 2 * p, 0, yl - 0.06, 0, mat(shade(c, 0.55)));
      bedLinen(b, { w: bw - 0.08, zBack: -L / 2 + p + 0.01, zFront: L / 2 - p - 0.01, y: yl - 0.04, mh: 0.15, drop: 0.07, color: c, pillows: 1, duvet: "#b9d3e6", seed: 3, step: 0.17 });
    });
    // a post under the upper bed where the lower one meets it
    rbox(b, p, yu, p, -w / 2 + p / 2, 0, -d / 2 + bw - p / 2, f, 0.012, 1);
  },

  loft_bed_slide: (b, w, d, h, f, c, a) => {
    // a high bed with a ladder at its head end and a slide from its foot along the length
    const lb = Math.min(2.08, d * 0.69);
    const zb = -d / 2;
    const yd = Math.max(0.9, h - 0.55);
    const p = 0.065;
    const zl0 = zb + p + 0.08;
    const zl1 = zl0 + 0.4;
    const sw = Math.min(0.5, w - 0.3);
    raisedBed(b, -w / 2, w / 2, zb, zb + lb, yd, h - 0.02, f, c, { gz0: zl0 - 0.02, gz1: zl1 + 0.02, seed: 8, endGap: sw + 0.04 });
    ladder(b, w / 2 - 0.016, zl0, zl1, h - 0.06, f);
    // the chute, from the opening in the foot end down to a flat run-out
    const z0 = zb + lb;
    const z1 = d / 2 - 0.02;
    const top = yd + 0.02;
    const hw = sw / 2;
    const run = Math.min(0.22, (z1 - z0) * 0.25);
    const curve = new THREE.CubicBezierCurve3(v(0, top, z0), v(0, top * 0.55, z0 + (z1 - z0) * 0.25), v(0, 0.14, z1 - run - (z1 - z0) * 0.3), v(0, 0.12, z1 - run));
    const path = [...curve.getPoints(20), v(0, 0.12, z1 - run * 0.5), v(0, 0.12, z1)];
    const profile: [number, number][] = [[-hw, 0.13], [-hw, 0.06], [-hw + 0.02, 0.012], [-hw + 0.05, 0], [hw - 0.05, 0], [hw - 0.02, 0.012], [hw, 0.06], [hw, 0.13]];
    const pos: number[] = [];
    const lips: THREE.Vector3[][] = [[], []];
    for (let i = 0; i < path.length; i++) {
      const pt = path[i];
      const tg = path[Math.min(path.length - 1, i + 1)].clone().sub(path[Math.max(0, i - 1)]).normalize();
      const n = v(0, tg.z, -tg.y);
      for (const [px, pu] of profile) pos.push(px, pt.y + n.y * pu, pt.z + n.z * pu);
      lips[0].push(v(-hw, pt.y + n.y * 0.13, pt.z + n.z * 0.13));
      lips[1].push(v(hw, pt.y + n.y * 0.13, pt.z + n.z * 0.13));
    }
    const SLIDE: Record<string, string> = { white: "#3f8fd2", oak: "#5bb36a", blue: "#f2c84b", pink: "#8a63c7" };
    const col = SLIDE[c] ?? "#3f8fd2";
    grid(b, pos, profile.length, mat(col, { side: THREE.DoubleSide, roughness: 0.35 }));
    const rimM = mat(col, { roughness: 0.35 });
    for (const lip of lips) {
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lip), 36, 0.018, 8), rimM);
      for (const e of [lip[0], lip[lip.length - 1]]) b.sphere(0.018, e.x, e.y, e.z, rimM, 1, 1, 1, 10);
    }
    for (const sx of [-1, 1]) {
      // feet under the run-out and the chute's middle
      b.rod(v(sx * (hw - 0.06), 0, z1 - 0.08), v(sx * (hw - 0.06), 0.12, z1 - 0.08), 0.018, a, 8);
      const m = curve.getPoint(0.6);
      b.rod(v(sx * (hw - 0.06), 0, m.z), v(sx * (hw - 0.06), m.y, m.z), 0.018, a, 8);
      // grab bars either side of the way down
      b.rod(v(sx * (hw + 0.035), yd + 0.05, z0 - 0.035), v(sx * (hw + 0.035), h - 0.04, z0 - 0.035), 0.016, a, 8);
    }
  },

  bed_trundle: (b, w, d, h, f, c) => {
    // a single bed between a head- and a footboard, a second mattress on castors pulled
    // half out from underneath
    const zb = -d / 2;
    const t = 0.04;
    const endShape = (top: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(w / 2, top - 0.08);
      s.quadraticCurveTo(w / 2, top, w / 2 - 0.1, top - 0.02);
      s.quadraticCurveTo(0, top + 0.03, -w / 2 + 0.1, top - 0.02);
      s.quadraticCurveTo(-w / 2, top, -w / 2, top - 0.08);
      s.lineTo(-w / 2, 0);
      return s;
    };
    for (const [z, top] of [[zb + t / 2, h - 0.03], [d / 2 - t / 2, Math.min(h - 0.03, 0.62)]] as const) {
      const geo = new THREE.ExtrudeGeometry(endShape(top), { depth: t - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 8 });
      geo.translate(0, 0, -(t - 0.008) / 2);
      b.add(geo, f, 0, 0, z);
    }
    const yb = 0.38;
    for (const sx of [-1, 1]) rbox(b, 0.03, 0.15, d - 2 * t, sx * (w / 2 - 0.03), yb - 0.15, 0, f, 0.006, 1);
    b.box(w - 0.06, 0.02, d - 2 * t, 0, yb - 0.04, 0, mat(shade(c, 0.55)));
    bedLinen(b, { w: w - 0.08, zBack: zb + t + 0.01, zFront: d / 2 - t - 0.01, y: yb - 0.02, mh: 0.18, drop: 0.12, color: c, pillows: 1, duvet: KID_DUVET[c], seed: 11 });
    // the trundle, pulled out to the right (beyond the bed's width)
    b.above(() => {
      const xc = Math.min(0.45, w * 0.46);
      const tw = w - 0.1;
      const td = d - 2 * t - 0.06;
      const ty = 0.05;
      const castor = mat("#2a2b2e", { roughness: 0.7 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) hcyl(b, 0.022, 0.016, xc + sx * (tw / 2 - 0.06), 0.022, sz * (td / 2 - 0.06), castor, "x", 10);
      rbox(b, tw, 0.15, td, xc, ty, 0, f, 0.006, 1);
      rbox(b, 0.02, 0.15, td + 0.02, xc + tw / 2 + 0.01, ty, 0, f, 0.006, 1);
      b.box(0.006, 0.03, 0.22, xc + tw / 2 + 0.021, ty + 0.09, 0, joint());
      rbox(b, tw - 0.04, 0.1, td - 0.04, xc, ty + 0.12, 0, linenMat("#f1efe9", THREE.FrontSide), 0.03, 1);
      pillow(b, Math.min(0.55, tw - 0.2), 0.11, 0.36, xc, ty + 0.27, -td / 2 + 0.25, linenMat(C.pillow, THREE.FrontSide), 0.4);
      const blanket = cloth(b, tw / 2 - 0.07, -td / 2 + 0.6, td / 2 - 0.05, ty + 0.235, linenMat(LINEN.blue[0]), { r: 0.04, drop: 0.03, foot: true, puff: 0.02, fold: 0.01, seed: 4, step: 0.16 });
      blanket.position.x = xc;
    });
  },

  crib_bedside: (b, w, d, h, f, c) => {
    // a bedside crib: a frame on legs, a mattress at the parents' bed's height, slatted
    // sides, and the side towards the parents' bed (right) lowered and open
    const p = 0.04;
    const yb = Math.min(0.5, h * 0.6);
    const yt = h - 0.02;
    const yl = yb + 0.15;
    const castor = mat("#2a2b2e", { roughness: 0.6 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - p / 2);
        const z = sz * (d / 2 - p / 2);
        const ph = sx > 0 ? yl + 0.02 : yt;
        rbox(b, p, ph, p, x, 0.012, z, f, 0.008, 1);
        b.sphere(p * 0.55, x, ph + 0.012, z, f, 1, 0.7, 1, 10);
        b.cyl(0.018, 0.018, 0.012, x, 0, z, castor, 10);
      }
    // a shelf low down between the legs
    rbox(b, w - 2 * p, 0.018, d - 2 * p, 0, 0.14, 0, f, 0.004, 1);
    for (const sz of [-1, 1]) rbox(b, w - 2 * p, 0.04, 0.02, 0, 0.12, sz * (d / 2 - p / 2), f, 0.006, 1);
    // the basket's base, rails and slats
    const iw = w - 2 * p;
    const id = d - 2 * p;
    b.box(iw, 0.02, id, 0, yb - 0.04, 0, f);
    const side = (x0: number, z0: number, x1: number, z1: number, top: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const xm = (x0 + x1) / 2;
      const zm = (z0 + z1) / 2;
      for (const y of [yb - 0.06, top - 0.035]) b.box(alongX ? len : 0.026, 0.035, alongX ? 0.026 : len, xm, y, zm, f);
      const n = Math.max(3, Math.round(len / 0.065));
      for (let i = 1; i < n; i++) {
        const u = i / n;
        b.cyl(0.009, 0.009, top - yb, x0 + (x1 - x0) * u, yb - 0.03, z0 + (z1 - z0) * u, f, 6);
      }
    };
    side(-w / 2 + p / 2, -id / 2, -w / 2 + p / 2, id / 2, yt);
    for (const sz of [-1, 1]) side(-iw / 2, sz * (d / 2 - p / 2), iw / 2, sz * (d / 2 - p / 2), yt);
    side(w / 2 - p / 2, -id / 2, w / 2 - p / 2, id / 2, yl);
    // the mattress in a fitted sheet, a little blanket
    rbox(b, iw - 0.01, 0.08, id - 0.01, 0, yb - 0.02, 0, linenMat("#f6f3ec", THREE.FrontSide), 0.025, 1);
    pillow(b, iw - 0.06, 0.04, id * 0.45, 0, yb + 0.075, id * 0.18, linenMat(KID_DUVET[c] ?? "#bcd7ea", THREE.FrontSide), 0, 0, 12);
  },

  moses_basket: (b, w, d, h, _f, c) => {
    // a woven oval basket with a hood over the head end and a padded lining, on a
    // folding wooden stand
    const wick = wickerMat(c);
    const rim = wickerMat(c === "sand" ? "oak" : c === "white" ? "sand" : "anthracite");
    const stand = surface(c === "sand" ? "oak" : "white", 0.6);
    const rx = w / 2 - 0.03;
    const rz = d / 2 - 0.03;
    const bh = Math.min(0.24, h * 0.34);
    const hood = Math.min(0.13, h * 0.19);
    const ys = h - bh - hood - 0.03;
    // the stand: an X at each end, rails along the top, a stretcher between the crossings
    const sx0 = w / 2 - 0.03;
    for (const sz of [-1, 1]) {
      const z = sz * (rz - 0.1);
      for (const s of [-1, 1]) b.rod(v(-s * sx0, 0, z), v(s * (rx - 0.05), ys, z), 0.014, stand, 8);
      b.sphere(0.02, 0, ys / 2, z, stand, 1, 1, 1, 8);
    }
    hcyl(b, 0.012, (rz - 0.1) * 2, 0, ys / 2, 0, stand, "z", 8);
    for (const s of [-1, 1]) hcyl(b, 0.014, (rz - 0.1) * 2 + 0.06, s * (rx - 0.05), ys, 0, stand, "z", 8);
    // the basket: a woven tub, oval, a little narrower at the bottom
    const tub = (r0: number, hh: number) =>
      [
        [0.82, 0],
        [0.9, 0.12],
        [0.96, 0.4],
        [0.99, 0.75],
        [1, 1],
      ].map(([r, y]) => new THREE.Vector2(r * r0, y * hh));
    const shell = new THREE.LatheGeometry(tub(1, bh), 28);
    shell.scale(rx, 1, rz);
    b.add(shell, wick, 0, ys, 0);
    const floor = new THREE.CircleGeometry(0.82, 28).rotateX(-Math.PI / 2);
    floor.scale(rx, 1, rz);
    b.add(floor, wick, 0, ys + 0.002, 0);
    // woven bands round it
    const ring = (ax: number, az: number, y: number, r: number, m: THREE.Material) => {
      const pts = Array.from({ length: 32 }, (_, i) => {
        const an = (i / 32) * Math.PI * 2;
        return v(Math.sin(an) * ax, y, Math.cos(an) * az);
      });
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, r, 6, true), m);
    };
    ring(rx * 0.92, rz * 0.92, ys + bh * 0.25, 0.008, rim);
    ring(rx * 0.98, rz * 0.98, ys + bh * 0.62, 0.008, rim);
    // the lining: padded fabric inside, rolled over the rim
    const pastel = ({ sand: "#efe6d6", white: "#dfe8ef", grey: "#efe1dc" } as Record<string, string>)[c] ?? "#efe6d6";
    const lining = linenMat(pastel);
    const inner = new THREE.LatheGeometry(tub(0.95, bh * 0.98), 24);
    inner.scale(rx, 1, rz);
    b.add(inner, lining, 0, ys + 0.01, 0);
    ring(rx * 0.99, rz * 0.99, ys + bh + 0.012, 0.022, linenMat(pastel, THREE.FrontSide));
    // a little mattress and a blanket
    pillow(b, rx * 1.3, 0.05, rz * 1.25, 0, ys + 0.05, 0, linenMat("#f6f4ef", THREE.FrontSide), 0, 0, 14);
    pillow(b, rx * 1.2, 0.04, rz * 0.8, 0, ys + 0.085, rz * 0.25, linenMat(c === "white" ? "#c9d9e8" : "#e9cfc4", THREE.FrontSide), 0, 0, 12);
    // the hood over the head end: a cap of an ellipsoid, woven outside, lined inside
    const cap = 0.42;
    const hh = hood + 0.03;
    const hoodGeo = (k: number) => {
      const g = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI, 0, Math.acos(cap));
      g.rotateX(-Math.PI / 2);
      g.scale(rx * k, hh * k, rz * k);
      return g;
    };
    b.add(hoodGeo(1.0), wick, 0, ys + bh, 0);
    b.add(hoodGeo(0.96), lining, 0, ys + bh, 0);
    // the hood's front edge, rolled
    const edge: THREE.Vector3[] = [];
    const s = Math.sqrt(1 - cap * cap);
    for (let i = 0; i <= 16; i++) {
      const an = (i / 16) * Math.PI;
      edge.push(v(-Math.cos(an) * s * rx, ys + bh + Math.sin(an) * s * hh, -cap * rz));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 24, 0.012, 6), rim);
    // rope handles along the long sides
    for (const sd of [-1, 1]) {
      const pts = [v(sd * rx, ys + bh, -rz * 0.2), v(sd * rx * 1.02, ys + bh + 0.05, -rz * 0.05), v(sd * rx * 1.02, ys + bh + 0.05, rz * 0.15), v(sd * rx, ys + bh, rz * 0.3)];
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.008, 6), rim);
    }
  },

  bed_murphy: (b, w, d, h, _f, c, a) => {
    // a wall bed: a tall cabinet with the bed folded in (its underside the front, handles
    // near the top), or open: the bed down in front, feet on the floor
    const cab = surface(c, 0.6);
    const zb = -d / 2;
    const zf = d / 2;
    const t = 0.025;
    const open = b.options.position === "open";
    for (const sx of [-1, 1]) rbox(b, t, h, d, sx * (w / 2 - t / 2), 0, 0, cab, 0.004, 1);
    rbox(b, w, 0.03, d + 0.01, 0, h - 0.03, 0.005, cab, 0.004, 1);
    b.box(w - 2 * t, 0.06, d - 0.04, 0, 0, -0.02, mat(shade(c, 0.4)));
    // the header above the bed
    const head = 0.28;
    rbox(b, w - 2 * t, head, 0.02, 0, h - 0.03 - head, zf - 0.01, cab, 0.003, 1);
    const ih = h - 0.03 - head;
    if (!open) {
      // the folded bed's underside: a panel in two halves, a foot band at the top, handles
      const fz = zf - 0.012;
      b.box(w - 2 * t - 0.004, ih - 0.065, 0.004, 0, 0.062, fz - 0.004, joint());
      rbox(b, w - 2 * t - 0.008, ih - 0.072, 0.02, 0, 0.065, fz, cab, 0.003, 1);
      b.box(0.004, ih - 0.36, 0.004, 0, 0.07, fz + 0.011, joint());
      b.box(w - 2 * t - 0.03, 0.004, 0.004, 0, ih - 0.3, fz + 0.011, joint());
      b.box(w - 2 * t - 0.03, 0.004, 0.004, 0, ih - 0.003, fz + 0.012, joint());
      for (const sx of [-1, 1]) barHandle(b, sx * Math.min(0.35, w * 0.25), ih - 0.4, fz + 0.01, 0.3, a);
      return;
    }
    // open: the cabinet's back and its hinge show, the bed lies in front of it
    b.box(w - 2 * t, ih - 0.06, 0.012, 0, 0.06, zb + 0.006, mat(shade(c, 0.88), { roughness: 0.7 }));
    hcyl(b, 0.02, w - 2 * t - 0.02, 0, 0.2, zb + 0.06, mat("#3a3b3f", { metalness: 0.5, roughness: 0.4 }), "x", 10);
    b.above(() => {
      const len = ih - 0.06;
      const z0 = zb + 0.03;
      const z1 = z0 + len;
      const zc = (z0 + z1) / 2;
      const bw = w - 2 * t - 0.01;
      // the bed box: the underside panel, sides, the foot
      b.box(bw, 0.02, len, 0, 0.1, zc, cab);
      for (const sx of [-1, 1]) rbox(b, 0.025, 0.28, len, sx * (bw / 2 - 0.0125), 0.1, zc, cab, 0.004, 1);
      rbox(b, bw, 0.28, 0.025, 0, 0.1, z1 - 0.0125, cab, 0.004, 1);
      // the fold-out legs at the foot
      const legM = mat("#3a3b3f", { metalness: 0.5, roughness: 0.4 });
      for (const sx of [-1, 1]) b.box(0.03, 0.1, 0.03, sx * (bw / 2 - 0.1), 0, z1 - 0.12, legM);
      b.box(bw - 0.2, 0.025, 0.025, 0, 0.06, z1 - 0.12, legM);
      bedLinen(b, { w: bw - 0.16, zBack: z0 + 0.04, zFront: z1 - 0.05, y: 0.16, mh: 0.24, drop: 0.06, color: c });
    });
  },

  sofa_bed: (b, w, d, h, f, c, a) => {
    // closed: a sofa with arms, seat and back cushions; open: the seat pulled out into
    // a mattress (beyond the sofa's depth) with bedding, on a folding frame
    const arm = Math.min(0.2, w * 0.1);
    const legH = 0.07;
    const iw = w - 2 * arm;
    const bd = Math.min(0.22, d * 0.24);
    const zb = -d / 2;
    const open = b.options.position === "open";
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rbox(b, 0.05, legH + 0.01, 0.05, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), a, 0.006, 1);
    const ah = Math.min(0.62, h * 0.74);
    for (const sx of [-1, 1]) rbox(b, arm, ah - legH, d, sx * (w / 2 - arm / 2), legH, 0, f, 0.05, 2);
    rbox(b, iw + 0.02, h - legH, bd, 0, legH, zb + bd / 2, f, 0.05, 2);
    const seatY = Math.min(0.28, h * 0.33);
    rbox(b, iw, seatY - legH, d - bd, 0, legH, zb + bd + (d - bd) / 2, f, 0.02, 1);
    const n = Math.max(1, Math.round(iw / 0.8));
    const cw = iw / n;
    const bc = Math.min(0.2, d * 0.21);
    for (let i = 0; i < n; i++) {
      const x = -iw / 2 + cw * (i + 0.5);
      const cb = rbox(b, cw - 0.012, h - seatY - 0.17, bc, x, seatY + 0.13, zb + bd + bc / 2 - 0.01, f, 0.07, 2);
      if (cb) cb.rotation.x = -0.1;
      if (!open) rbox(b, cw - 0.01, 0.16, d - bd - bc + 0.02, x, seatY, zb + bd + bc + (d - bd - bc) / 2 - 0.01, f, 0.05, 2);
    }
    if (!open) return;
    b.above(() => {
      // the mattress pulled out from the seat, on a metal frame with U legs
      const z0 = zb + bd + bc + 0.01;
      const z1 = z0 + 1.9;
      const mw = iw - 0.03;
      const frame = mat("#2f3034", { metalness: 0.6, roughness: 0.4 });
      for (const sx of [-1, 1]) hcyl(b, 0.012, z1 - d / 2, sx * (mw / 2 - 0.02), seatY + 0.02, (d / 2 + z1) / 2, frame, "z", 8);
      for (const z of [d / 2 + (z1 - d / 2) * 0.45, z1 - 0.06]) {
        for (const sx of [-1, 1]) b.rod(v(sx * (mw / 2 - 0.08), 0.01, z), v(sx * (mw / 2 - 0.02), seatY + 0.02, z), 0.012, frame, 8);
        hcyl(b, 0.012, mw - 0.16, 0, 0.02, z, frame, "x", 8);
      }
      bedLinen(b, { w: mw, zBack: z0, zFront: z1, y: seatY + 0.02, mh: 0.14, drop: 0.12, color: c, pillows: mw > 1.2 ? 2 : 1, seed: 13 });
    });
  },
};
