// The door & window library: presets of an opening's type and size, each with a small
// front view. Sizes the preset leaves out come from the house's defaults.

import type { OpeningInput, OpeningStyle, OpeningType } from "../model/types";

export interface OpeningPreset {
  id: string;
  type: OpeningType;
  style?: OpeningStyle;
  width: number;
  sill?: number;
  height?: number;
  /** Front view, SVG content in a 0 0 64 64 box (the wall is the background). */
  icon: string;
}

const frame = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="frame"/>`;
const glass = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="glass"/>`;
const leaf = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="leaf"/>`;
const knob = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.6" class="handle"/>`;
const floor = `<line x1="2" y1="60" x2="62" y2="60" class="floor"/>`;

export const OPENING_PRESETS: OpeningPreset[] = [
  { id: "window", type: "window", width: 1.0, icon: `${floor}${frame(21, 16, 22, 26)}${glass(24, 19, 16, 20)}${knob(37, 29)}` },
  { id: "window_double", type: "window", style: "double", width: 1.4, icon: `${floor}${frame(14, 16, 36, 26)}${glass(17, 19, 14, 20)}${glass(33, 19, 14, 20)}${knob(29, 29)}${knob(35, 29)}` },
  { id: "window_fixed", type: "window", style: "fixed", width: 1.2, icon: `${floor}${frame(16, 16, 32, 26)}${glass(19, 19, 26, 20)}` },
  { id: "window_small", type: "window", width: 0.6, sill: 1.5, height: 0.6, icon: `${floor}${frame(24, 12, 16, 14)}${glass(27, 15, 10, 8)}` },
  { id: "window_floor", type: "window", style: "double", width: 1.4, sill: 0, height: 2.2, icon: `${floor}${frame(16, 6, 32, 54)}${glass(19, 9, 12, 48)}${glass(33, 9, 12, 48)}` },
  { id: "door", type: "door", width: 0.9, icon: `${floor}${frame(22, 8, 20, 52)}${leaf(24, 10, 16, 50)}${knob(37, 36)}` },
  { id: "door_double", type: "door", style: "double", width: 1.6, icon: `${floor}${frame(12, 8, 40, 52)}${leaf(14, 10, 17.5, 50)}${leaf(32.5, 10, 17.5, 50)}${knob(29, 36)}${knob(35, 36)}` },
  { id: "door_glass", type: "door", style: "glass", width: 1.0, icon: `${floor}${frame(20, 6, 24, 54)}${glass(23, 9, 18, 48)}${knob(38, 34)}` },
  { id: "door_glass_double", type: "door", style: "glass_double", width: 1.6, icon: `${floor}${frame(12, 6, 40, 54)}${glass(15, 9, 16, 48)}${glass(33, 9, 16, 48)}${knob(29, 34)}${knob(35, 34)}` },
  { id: "door_sliding", type: "door", style: "sliding", width: 2.4, icon: `${floor}${frame(4, 6, 56, 54)}${glass(7, 9, 24, 48)}${glass(33, 9, 24, 48)}<path d="M14 33h10M50 33h-10" class="handle"/>` },
  { id: "garage_door", type: "garage_door", width: 2.5, icon: `${floor}${frame(4, 14, 56, 46)}${[0, 1, 2, 3, 4].map((i) => leaf(6, 16 + i * 8.8, 52, 7.6)).join("")}` },
  { id: "opening", type: "opening", width: 1.0, icon: `${floor}${frame(20, 10, 24, 50)}` },
  { id: "opening_arch", type: "opening", style: "arch", width: 1.2, icon: `${floor}<path d="M18 60V24a14 14 0 0 1 28 0v36" class="frame" fill="none"/>` },
];

/** The preset an opening looks like (type and kind first, then the closest width and sill). */
export function presetOf(o: Pick<OpeningInput, "type" | "style" | "width" | "sill" | "height">): OpeningPreset | undefined {
  const kind = (p: OpeningPreset) => p.style ?? (p.type === "opening" ? "square" : "single");
  const type = o.type ?? "window";
  const style = o.style ?? (type === "opening" ? "square" : (type === "window" && o.width > 1.3) || (type === "door" && o.width > 1.4) ? "double" : "single");
  const same = OPENING_PRESETS.filter((p) => p.type === (o.type ?? "window") && kind(p) === style);
  const score = (p: OpeningPreset) => Math.abs(p.width - o.width) + Math.abs((p.sill ?? -1) - (o.sill ?? -1)) * 2;
  return same.sort((a, b) => score(a) - score(b))[0];
}

/** What choosing a preset changes on an opening (its own sill and height, or back to the defaults). */
export function applyPreset(p: OpeningPreset): Partial<OpeningInput> {
  return { type: p.type === "window" ? undefined : p.type, style: p.style, width: p.width, sill: p.sill, height: p.height };
}

/** An opening's kind, like the library's presets name it (e.g. "window_double"). */
export function kindOf(o: Pick<OpeningInput, "type" | "style" | "width">): string {
  const type = o.type ?? "window";
  const style = o.style ?? (type === "opening" ? "square" : (type === "window" && o.width > 1.3) || (type === "door" && o.width > 1.4) ? "double" : "single");
  if (type === "garage_door") return "garage_door";
  if (type === "opening") return style === "arch" ? "opening_arch" : "opening";
  return style === "single" ? type : `${type}_${style}`;
}

/** The library's groups: windows, doors (and garage doors), openings. */
export const OPENING_GROUPS: { id: "windows" | "doors" | "openings"; presets: OpeningPreset[] }[] = [
  { id: "windows", presets: OPENING_PRESETS.filter((p) => p.type === "window") },
  { id: "doors", presets: OPENING_PRESETS.filter((p) => p.type === "door" || p.type === "garage_door") },
  { id: "openings", presets: OPENING_PRESETS.filter((p) => p.type === "opening") },
];
