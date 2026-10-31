// The textures of the surface finishes (model/finishes.ts), drawn once in code at their
// real size: planks about 18 cm wide, tiles 60 cm, bricks 21.5 × 6.5 cm, acoustic slats
// 2.7 cm. Texture coordinates are metres (floors: the plan; walls: along and up), so a
// pattern runs on across rooms and wall pieces.

import * as THREE from "three";
import { FINISHES_BY_ID } from "../model/finishes";

const SIZE = 512;

/** Metres one texture covers, by finish (default 2). */
const SPAN: Record<string, number> = {
  acoustic_oak: 1,
  acoustic_walnut: 1,
  acoustic_black: 1,
  tile_subway: 1,
  tile_zellige: 1,
  tile_hex: 1,
  tile_cement: 1.2,
  brick_red: 2,
  brick_white: 2,
  brick_grey: 2,
  beadboard: 1,
  wallpaper_stripes: 1,
  wallpaper_leaves: 1,
  tile_checker: 1.2,
  terrazzo: 1,
  oak_herringbone: 1.2,
  oak_chevron: 1.2,
  parquet_squares: 1.2,
  sisal: 0.5,
  carpet: 1,
  carpet_grey: 1,
  gravel: 1,
  cobbles: 1,
};

function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;
type Painter = (c: Ctx, px: (m: number) => number, base: THREE.Color, rnd: () => number) => void;

/** The base colour lighter (k > 0) or darker (k < 0). */
const tone = (base: THREE.Color, k: number) => base.clone().lerp(new THREE.Color(k > 0 ? "#ffffff" : "#000000"), Math.min(1, Math.abs(k))).getStyle();

function speckle(c: Ctx, base: THREE.Color, rnd: () => number, count: number, spread: number, size = 2) {
  for (let i = 0; i < count; i++) {
    c.fillStyle = tone(base, (rnd() - 0.5) * spread);
    c.fillRect(rnd() * SIZE, rnd() * SIZE, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}

function grainLines(c: Ctx, base: THREE.Color, rnd: () => number, x: number, y: number, w: number, h: number, horizontal: boolean) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  for (let i = 0; i < (horizontal ? h : w) / 2.2; i++) {
    c.strokeStyle = tone(base, (rnd() - 0.6) * 0.25);
    c.lineWidth = 0.6 + rnd();
    c.beginPath();
    const off = rnd() * (horizontal ? h : w);
    const wave = rnd() * 3;
    for (let t = 0; t <= 1.001; t += 0.1) {
      const along = (horizontal ? x : y) + t * (horizontal ? w : h);
      const across = (horizontal ? y : x) + off + Math.sin(t * 6 + i) * wave;
      if (horizontal) c.lineTo(along, across);
      else c.lineTo(across, along);
    }
    c.stroke();
  }
  c.restore();
}

/** Planks along x: rows of boards of random lengths, each a little different. */
function planks(c: Ctx, px: (m: number) => number, base: THREE.Color, rnd: () => number, width = 0.18, gap = 1.2) {
  const rows = Math.round(SIZE / px(width));
  const rh = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * px(1.2);
    while (x < SIZE) {
      const len = px(0.8 + rnd() * 1.2);
      const t = base.clone().lerp(new THREE.Color(rnd() > 0.5 ? "#ffffff" : "#000000"), rnd() * 0.12);
      c.fillStyle = t.getStyle();
      c.fillRect(x, r * rh, len, rh);
      grainLines(c, t, rnd, x, r * rh, len, rh, true);
      c.fillStyle = tone(base, -0.45);
      c.fillRect(x, r * rh, gap, rh);
      // both ends of the texture: boards wrap around
      if (x + len > SIZE) {
        c.fillStyle = t.getStyle();
        c.fillRect(x - SIZE, r * rh, len, rh);
        grainLines(c, t, rnd, x - SIZE, r * rh, len, rh, true);
      }
      x += len;
    }
    c.fillStyle = tone(base, -0.4);
    c.fillRect(0, r * rh, SIZE, gap);
  }
}

/** A grid of tiles with grout, each tile a little different. */
function tiles(c: Ctx, px: (m: number) => number, base: THREE.Color, rnd: () => number, w: number, h: number, grout: string, bond = 0, vary = 0.06, inner?: (x: number, y: number, tw: number, th: number) => void) {
  const cols = Math.max(1, Math.round(SIZE / px(w)));
  const rows = Math.max(1, Math.round(SIZE / px(h)));
  const tw = SIZE / cols;
  const th = SIZE / rows;
  c.fillStyle = grout;
  c.fillRect(0, 0, SIZE, SIZE);
  const g = Math.max(1.2, px(0.004));
  for (let r = 0; r < rows; r++)
    for (let i = -1; i < cols; i++) {
      const x = i * tw + (r % 2 ? bond * tw : 0);
      const y = r * th;
      c.fillStyle = tone(base, (rnd() - 0.5) * vary * 2);
      c.fillRect(x + g / 2, y + g / 2, tw - g, th - g);
      inner?.(x + g / 2, y + g / 2, tw - g, th - g);
    }
}

const PAINTERS: Record<string, Painter> = {
  wood: (c, px, b, rnd) => planks(c, px, b, rnd),
  oak_light: (c, px, b, rnd) => planks(c, px, b, rnd, 0.2),
  walnut: (c, px, b, rnd) => planks(c, px, b, rnd, 0.16),
  oak_grey: (c, px, b, rnd) => planks(c, px, b, rnd, 0.22),
  oak_herringbone: (c, px, b, rnd) => blocks(c, px, b, rnd, true),
  oak_chevron: (c, px, b, rnd) => blocks(c, px, b, rnd, false),
  parquet_squares: (c, px, b, rnd) => {
    // basket weave: squares of three strips, turned every other square
    const n = Math.round(SIZE / px(0.3));
    const s = SIZE / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < 3; k++) {
          const t = b.clone().lerp(new THREE.Color(rnd() > 0.5 ? "#ffffff" : "#000000"), rnd() * 0.12);
          c.fillStyle = t.getStyle();
          const horizontal = (i + j) % 2 === 0;
          const [x, y, w, h] = horizontal ? [i * s, j * s + (k * s) / 3, s, s / 3] : [i * s + (k * s) / 3, j * s, s / 3, s];
          c.fillRect(x, y, w, h);
          grainLines(c, t, rnd, x, y, w, h, horizontal);
          c.strokeStyle = tone(b, -0.4);
          c.lineWidth = 1;
          c.strokeRect(x, y, w, h);
        }
  },
  tile: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.6, 0.6, tone(b, -0.25)),
  tile_white: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.6, 0.6, tone(b, -0.15), 0, 0.03),
  tile_black: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.6, 0.6, tone(b, 0.15), 0, 0.05),
  tile_subway: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.15, 0.075, tone(b, -0.2), 0.5, 0.03),
  tile_zellige: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.1, 0.1, tone(b, 0.45), 0, 0.22, (x, y, w, h) => {
    // glaze pooling at the edges
    c.fillStyle = tone(b, 0.2);
    c.globalAlpha = 0.35;
    c.fillRect(x + w * 0.2, y + h * 0.15, w * 0.4, h * 0.3);
    c.globalAlpha = 1;
  }),
  tile_checker: (c, px, b, rnd) => {
    const n = Math.round(SIZE / px(0.3));
    const s = SIZE / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        c.fillStyle = (i + j) % 2 ? tone(new THREE.Color("#2b2c2e"), (rnd() - 0.5) * 0.1) : tone(new THREE.Color("#ecebe6"), (rnd() - 0.5) * 0.05);
        c.fillRect(i * s, j * s, s, s);
      }
    c.strokeStyle = "#8d8b86";
    c.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      c.beginPath();
      c.moveTo(i * s, 0);
      c.lineTo(i * s, SIZE);
      c.moveTo(0, i * s);
      c.lineTo(SIZE, i * s);
      c.stroke();
    }
    void b;
  },
  tile_hex: (c, px, b, rnd) => {
    c.fillStyle = tone(b, -0.25);
    c.fillRect(0, 0, SIZE, SIZE);
    const r = px(0.1);
    const h = Math.sqrt(3) * r;
    const cols = Math.round(SIZE / (r * 3));
    const rr = SIZE / (cols * 3);
    const hh = Math.sqrt(3) * rr;
    const rows = Math.round(SIZE / hh);
    for (let i = -1; i <= cols * 2; i++)
      for (let j = -1; j <= rows; j++) {
        const cx = i * rr * 1.5;
        const cy = j * (SIZE / rows) + (i % 2 ? SIZE / rows / 2 : 0);
        c.fillStyle = tone(b, (rnd() - 0.5) * 0.1);
        c.beginPath();
        for (let k = 0; k < 6; k++) c.lineTo(cx + Math.cos((k * Math.PI) / 3) * (rr - 1.2), cy + Math.sin((k * Math.PI) / 3) * (rr - 1.2));
        c.fill();
      }
    void h;
  },
  tile_cement: (c, px, b, rnd) =>
    tiles(c, px, b, rnd, 0.2, 0.2, tone(b, -0.2), 0, 0.02, (x, y, w, h) => {
      // an encaustic motif: a diamond with a ring, quarter circles in the corners
      c.fillStyle = "#3f5a6a";
      c.beginPath();
      c.moveTo(x + w / 2, y + h * 0.15);
      c.lineTo(x + w * 0.85, y + h / 2);
      c.lineTo(x + w / 2, y + h * 0.85);
      c.lineTo(x + w * 0.15, y + h / 2);
      c.fill();
      c.fillStyle = tone(b, 0.1);
      c.beginPath();
      c.arc(x + w / 2, y + h / 2, w * 0.14, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#b5683f";
      for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        c.beginPath();
        c.arc(cx, cy, w * 0.18, 0, Math.PI * 2);
        c.fill();
      }
    }),
  terrazzo: (c, px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    const chips = ["#8d8f92", "#b5683f", "#5d7a60", "#2b2c2e", "#f4f2ec", "#c9a47c"];
    for (let i = 0; i < 900; i++) {
      c.fillStyle = chips[Math.floor(rnd() * chips.length)];
      c.beginPath();
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      const s = px(0.004 + rnd() * 0.014);
      for (let k = 0; k < 5; k++) c.lineTo(x + Math.cos(k * 1.3 + rnd()) * s, y + Math.sin(k * 1.3 + rnd()) * s);
      c.fill();
    }
  },
  concrete: (c, px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = tone(b, (rnd() - 0.5) * 0.12);
      c.globalAlpha = 0.25;
      c.beginPath();
      c.arc(rnd() * SIZE, rnd() * SIZE, px(0.1 + rnd() * 0.3), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    speckle(c, b, rnd, 4000, 0.25, 1.5);
  },
  concrete_polished: (c, px, b, rnd) => {
    PAINTERS.concrete(c, px, b, rnd);
    c.strokeStyle = tone(b, -0.2);
    c.lineWidth = 1;
    c.strokeRect(0, 0, SIZE, SIZE);
  },
  marble: (c, _px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 14; i++) {
      c.strokeStyle = tone(b, -(0.15 + rnd() * 0.25));
      c.lineWidth = 0.6 + rnd() * 2;
      c.beginPath();
      let x = rnd() * SIZE;
      let y = -10;
      c.moveTo(x, y);
      while (y < SIZE + 10) {
        x += (rnd() - 0.5) * 50;
        y += 15 + rnd() * 40;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    c.strokeStyle = tone(b, -0.12);
    c.lineWidth = 1;
    c.strokeRect(0, 0, SIZE, SIZE);
  },
  slate: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.4, 0.4, tone(b, -0.35), 0, 0.12, (x, y, w, h) => speckle2(c, b, rnd, x, y, w, h)),
  travertine: (c, px, b, rnd) =>
    tiles(c, px, b, rnd, 0.6, 0.4, tone(b, -0.12), 0.5, 0.06, (x, y, w, h) => {
      for (let i = 0; i < 18; i++) {
        c.fillStyle = tone(b, -0.15 - rnd() * 0.1);
        c.fillRect(x + rnd() * w, y + rnd() * h, 2 + rnd() * 10, 1.2);
      }
    }),
  stone_flags: (c, px, b, rnd) => {
    // random-sized flags in rows
    c.fillStyle = tone(b, -0.35);
    c.fillRect(0, 0, SIZE, SIZE);
    let y = 0;
    while (y < SIZE) {
      const rh = px(0.25 + rnd() * 0.25);
      let x = -rnd() * px(0.3);
      while (x < SIZE) {
        const w = px(0.3 + rnd() * 0.5);
        c.fillStyle = tone(b, (rnd() - 0.5) * 0.25);
        c.fillRect(x + 2, y + 2, w - 4, Math.min(rh, SIZE - y) - 4);
        x += w;
      }
      y += rh;
    }
  },
  carpet: (c, _px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    speckle(c, b, rnd, 14000, 0.2, 1.2);
  },
  carpet_grey: (c, px, b, rnd) => PAINTERS.carpet(c, px, b, rnd),
  sisal: (c, _px, b, rnd) => {
    const n = 32;
    const s = SIZE / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        c.fillStyle = tone(b, ((i + j) % 2 ? 0.08 : -0.1) + (rnd() - 0.5) * 0.05);
        c.fillRect(i * s, j * s, s, s);
      }
  },
  limewash: (c, px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 160; i++) {
      c.fillStyle = tone(b, (rnd() - 0.5) * 0.16);
      c.globalAlpha = 0.18;
      c.beginPath();
      c.ellipse(rnd() * SIZE, rnd() * SIZE, px(0.05 + rnd() * 0.25), px(0.03 + rnd() * 0.12), rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  },
  wallpaper_stripes: (c, px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    const n = Math.round(SIZE / px(0.1));
    for (let i = 0; i < n; i += 2) {
      c.fillStyle = tone(b, -0.12);
      c.fillRect((i * SIZE) / n, 0, SIZE / n / 2, SIZE);
    }
    void rnd;
  },
  wallpaper_leaves: (c, px, b, rnd) => {
    c.fillStyle = tone(b, 0.35);
    c.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      const s = px(0.05 + rnd() * 0.06);
      c.save();
      c.translate(x, y);
      c.rotate(rnd() * Math.PI * 2);
      c.fillStyle = tone(b, (rnd() - 0.6) * 0.5);
      c.beginPath();
      c.ellipse(0, 0, s, s * 0.38, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = tone(b, 0.3);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(-s, 0);
      c.lineTo(s, 0);
      c.stroke();
      c.restore();
    }
  },
  acoustic_oak: (c, px, b, rnd) => slats(c, px, b, rnd, "#1d1d1f"),
  acoustic_walnut: (c, px, b, rnd) => slats(c, px, b, rnd, "#1d1d1f"),
  acoustic_black: (c, px, b, rnd) => slats(c, px, b, rnd, "#47494d"),
  // veneer: a fine continuous grain (also the furniture's oak and walnut)
  veneer_oak: (c, _px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    grainLines(c, b, rnd, 0, 0, SIZE, SIZE, true);
    grainLines(c, b, rnd, 0, 0, SIZE, SIZE, true);
  },
  veneer_walnut: (c, px, b, rnd) => PAINTERS.veneer_oak(c, px, b, rnd),
  beadboard: (c, px, b, rnd) => {
    const n = Math.round(SIZE / px(0.1));
    for (let i = 0; i < n; i++) {
      c.fillStyle = tone(b, (rnd() - 0.5) * 0.03);
      c.fillRect((i * SIZE) / n, 0, SIZE / n, SIZE);
      c.fillStyle = tone(b, -0.25);
      c.fillRect((i * SIZE) / n, 0, 1.5, SIZE);
    }
  },
  wood_cladding: (c, px, b, rnd) => {
    // horizontal boards, each throwing a shadow on the next
    const n = Math.round(SIZE / px(0.15));
    for (let i = 0; i < n; i++) {
      const t = b.clone().lerp(new THREE.Color(rnd() > 0.5 ? "#ffffff" : "#000000"), rnd() * 0.12);
      c.fillStyle = t.getStyle();
      c.fillRect(0, (i * SIZE) / n, SIZE, SIZE / n);
      grainLines(c, t, rnd, 0, (i * SIZE) / n, SIZE, SIZE / n, true);
      c.fillStyle = tone(b, -0.45);
      c.fillRect(0, ((i + 1) * SIZE) / n - 3, SIZE, 3);
    }
  },
  brick_red: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.225, 0.075, "#cfc8bc", 0.5, 0.14),
  brick_white: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.225, 0.075, "#bdb8ae", 0.5, 0.05),
  brick_grey: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.225, 0.075, "#a9a49c", 0.5, 0.12),
  lawn: (c, _px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      c.strokeStyle = tone(b, (rnd() - 0.45) * 0.4);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 5);
      c.stroke();
    }
  },
  paving: (c, px, b, rnd) => tiles(c, px, b, rnd, 0.4, 0.4, tone(b, -0.3), 0, 0.1, (x, y, w, h) => speckle2(c, b, rnd, x, y, w, h)),
  gravel: (c, px, b, rnd) => {
    c.fillStyle = tone(b, -0.3);
    c.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 3000; i++) {
      c.fillStyle = tone(b, (rnd() - 0.4) * 0.5);
      c.beginPath();
      c.ellipse(rnd() * SIZE, rnd() * SIZE, px(0.006 + rnd() * 0.01), px(0.005 + rnd() * 0.008), rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
  },
  decking: (c, px, b, rnd) => {
    planks(c, px, b, rnd, 0.14, 4);
  },
  cobbles: (c, px, b, rnd) => {
    c.fillStyle = tone(b, -0.4);
    c.fillRect(0, 0, SIZE, SIZE);
    const n = Math.round(SIZE / px(0.1));
    const s = SIZE / n;
    for (let i = 0; i < n; i++)
      for (let j = -1; j <= n; j++) {
        c.fillStyle = tone(b, (rnd() - 0.5) * 0.3);
        c.beginPath();
        c.ellipse(j * s + (i % 2 ? s / 2 : 0) + s / 2, i * s + s / 2, s * 0.44, s * 0.42, 0, 0, Math.PI * 2);
        c.fill();
      }
  },
  render_white: (c, _px, b, rnd) => {
    c.fillStyle = b.getStyle();
    c.fillRect(0, 0, SIZE, SIZE);
    speckle(c, b, rnd, 9000, 0.08, 1.2);
  },
  render_grey: (c, px, b, rnd) => PAINTERS.render_white(c, px, b, rnd),
};

function speckle2(c: Ctx, b: THREE.Color, rnd: () => number, x: number, y: number, w: number, h: number) {
  for (let i = 0; i < (w * h) / 60; i++) {
    c.fillStyle = tone(b, (rnd() - 0.5) * 0.18);
    c.fillRect(x + rnd() * w, y + rnd() * h, 1.5, 1.5);
  }
}

/** Herringbone (two halves offset) or chevron (halves meeting in a point). */
function blocks(c: Ctx, px: (m: number) => number, b: THREE.Color, rnd: () => number, herringbone: boolean) {
  const cols = Math.round(SIZE / px(0.3));
  const cw = SIZE / cols;
  const rh = px(0.08);
  const rows = Math.ceil(SIZE / rh) + 4;
  const rise = cw / 2;
  c.fillStyle = tone(b, -0.4);
  c.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < cols; i++)
    for (let j = -4; j < rows; j++)
      for (const half of [0, 1]) {
        const x0 = i * cw + half * (cw / 2);
        const x1 = x0 + cw / 2;
        const y = j * rh + (herringbone && half ? rh / 2 : 0);
        // left half rises to the middle, right half falls from it
        const [ya, yb] = half ? [y - rise, y] : [y, y - rise];
        const t = b.clone().lerp(new THREE.Color(rnd() > 0.5 ? "#ffffff" : "#000000"), rnd() * 0.14);
        c.fillStyle = t.getStyle();
        c.beginPath();
        c.moveTo(x0 + 0.7, ya + 0.7);
        c.lineTo(x1 - 0.7, yb + 0.7);
        c.lineTo(x1 - 0.7, yb + rh - 0.7);
        c.lineTo(x0 + 0.7, ya + rh - 0.7);
        c.fill();
      }
}

/** Acoustic panels: wooden slats on felt. */
function slats(c: Ctx, px: (m: number) => number, b: THREE.Color, rnd: () => number, felt: string) {
  c.fillStyle = felt;
  c.fillRect(0, 0, SIZE, SIZE);
  const n = Math.round(SIZE / px(0.04));
  const s = SIZE / n;
  for (let i = 0; i < n; i++) {
    const t = b.clone().lerp(new THREE.Color(rnd() > 0.5 ? "#ffffff" : "#000000"), rnd() * 0.1);
    c.fillStyle = t.getStyle();
    c.fillRect(i * s, 0, s * 0.68, SIZE);
    grainLines(c, t, rnd, i * s, 0, s * 0.68, SIZE, false);
    c.fillStyle = tone(t, 0.12);
    c.fillRect(i * s, 0, 1, SIZE);
  }
}

const materials = new Map<string, { map: THREE.Texture | null; color: string }>();

/**
 * How a finish looks: a texture in metres (null for plain paint or without a canvas) and
 * the colour to draw it with (white under a texture, the paint's colour without one).
 */
export function finishLook(id: string): { map: THREE.Texture | null; color: string } {
  let look = materials.get(id);
  if (look) return look;
  const finish = FINISHES_BY_ID[id];
  const color = finish?.color ?? "#eeeae3";
  const paint = PAINTERS[id];
  if (!paint || typeof document === "undefined") look = { map: null, color };
  else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const c = canvas.getContext("2d")!;
    const span = SPAN[id] ?? 2;
    paint(c, (m) => (m / span) * SIZE, new THREE.Color(color), random(id.length * 7919 + id.charCodeAt(0)));
    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    // texture coordinates are metres
    map.repeat.set(1 / span, 1 / span);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    look = { map, color: "#ffffff" };
  }
  materials.set(id, look);
  return look;
}

const previews = new Map<string, string | null>();
/** A small picture of a finish for the editor (null for plain paint or without a canvas). */
export function finishPreview(id: string): string | null {
  if (previews.has(id)) return previews.get(id)!;
  const look = finishLook(id);
  let url: string | null = null;
  const image = look.map?.image as HTMLCanvasElement | undefined;
  if (image?.getContext) {
    // about a metre square of it, at its real size
    const span = SPAN[id] ?? 2;
    const crop = Math.min(SIZE, SIZE / span);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    c.getContext("2d")!.drawImage(image, 0, 0, crop, crop, 0, 0, 64, 64);
    url = c.toDataURL("image/png");
  }
  previews.set(id, url);
  return url;
}
