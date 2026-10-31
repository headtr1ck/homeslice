// Subtle floor textures, drawn once in code: grass, planks, tiles, paving and grain. They
// are light greys that the floor's colour tints, so floors keep their colour and glow.

import * as THREE from "three";

/** Metres one texture covers. */
const SPAN = 2;
const SIZE = 256;

const cache = new Map<string, THREE.Texture | null>();

/** A deterministic random sequence (the same floors every time). */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

type Painter = (c: CanvasRenderingContext2D, rnd: () => number) => void;

const px = (m: number) => (m / SPAN) * SIZE;
const grey = (v: number) => `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`;

const PAINTERS: Record<string, Painter> = {
  lawn: (c, rnd) => {
    // blades: short strokes in lighter and darker greens (as greys)
    for (let i = 0; i < 3200; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      c.strokeStyle = grey(0.72 + rnd() * 0.4);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 4);
      c.stroke();
    }
  },
  wood: (c, rnd) => {
    // planks 20 cm wide, each a little lighter or darker, with joints
    const w = px(0.2);
    for (let y = 0; y < SIZE; y += w) {
      c.fillStyle = grey(0.86 + rnd() * 0.14);
      c.fillRect(0, y, SIZE, w);
      c.fillStyle = grey(0.7);
      c.fillRect(0, y, SIZE, 1);
      const cut = rnd() * SIZE;
      c.fillRect(cut, y, 1, w);
    }
  },
  tile: (c) => {
    const s = px(0.6);
    c.fillStyle = grey(0.78);
    for (let i = 0; i <= SIZE; i += s) {
      c.fillRect(i, 0, 1.5, SIZE);
      c.fillRect(0, i, SIZE, 1.5);
    }
  },
  paving: (c, rnd) => {
    // 40 × 20 cm stones in a running bond
    const w = px(0.4);
    const h = px(0.2);
    for (let row = 0, y = 0; y < SIZE; row++, y += h)
      for (let x = row % 2 ? -w / 2 : 0; x < SIZE; x += w) {
        c.fillStyle = grey(0.85 + rnd() * 0.15);
        c.fillRect(x + 1, y + 1, w - 2, h - 2);
      }
  },
  gravel: (c, rnd) => grain(c, rnd, 9000, 0.6, 0.45),
  concrete: (c, rnd) => grain(c, rnd, 2500, 0.82, 0.18),
  carpet: (c, rnd) => grain(c, rnd, 6000, 0.84, 0.16),
};

function grain(c: CanvasRenderingContext2D, rnd: () => number, count: number, base: number, spread: number) {
  for (let i = 0; i < count; i++) {
    c.fillStyle = grey(base + rnd() * spread);
    c.fillRect(rnd() * SIZE, rnd() * SIZE, 1.5, 1.5);
  }
}

/** The texture for a floor, or null (no canvas, or a plain floor). */
export function floorTexture(floor: string): THREE.Texture | null {
  if (cache.has(floor)) return cache.get(floor)!;
  const paint = PAINTERS[floor];
  let texture: THREE.Texture | null = null;
  if (paint && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const c = canvas.getContext("2d");
    if (c) {
      c.fillStyle = "#fff";
      c.fillRect(0, 0, SIZE, SIZE);
      paint(c, random(floor.length * 7919));
      texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      // plan metres are the floors' texture coordinates
      texture.repeat.set(1 / SPAN, 1 / SPAN);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
    }
  }
  cache.set(floor, texture);
  return texture;
}
