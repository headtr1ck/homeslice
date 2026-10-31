// The editor's furniture library and its sources: the built-in shapes, Kenney's models
// in the bundle, Poly Haven's (downloaded into Home Assistant when placed) and models
// uploaded to Home Assistant. Every item is placed as a furniture type (its plan symbol,
// lights and defaults) with the model that shows it.

import { FURNITURE, FURNITURE_GROUPS } from "../model/furniture";
import { MODERN_GROUPS } from "../model/modern";
import type { FurnitureMount, FurnitureType } from "../model/types";
import { KENNEY_GROUPS, kenneySize } from "./kenney";

export type LibrarySource = "builtin" | "kenney" | "polyhaven" | "custom";
export const LIBRARY_SOURCES: LibrarySource[] = ["builtin", "kenney", "polyhaven", "custom"];

export interface LibraryItem {
  /** Unique within the library, e.g. `kenney:loungeSofa`. */
  key: string;
  type: FurnitureType;
  /** FurnitureInput.model */
  model: string;
  /** The item's own name (models), else the type's. */
  name?: string;
  /** A translated name instead (Modern pieces: `modern.<kind>`). */
  nameKey?: string;
  /** Where it hangs, if not where its type does. */
  mount?: FurnitureMount;
  elevation?: number;
  thumb: string;
  /** Its own size (models), else the type's. */
  size?: [number, number];
  height?: number;
  /** Words to search for besides the name. */
  tags?: string[];
}

export interface LibraryGroup {
  /** `furniture.group_<id>` names it. */
  id: string;
  items: LibraryItem[];
}

/** Poly Haven's catalogue entry, as the integration sends it. */
export interface PolyhavenAsset {
  id: string;
  name: string;
  categories: string[];
  tags: string[];
  /** Metres: width, depth, height. */
  dimensions: [number, number, number] | null;
  thumbnail: string | null;
}

/** An uploaded model, as the integration sends it. */
export interface CustomAsset {
  id: string;
  name: string;
  url: string;
  bytes: number;
}

/** A file next to the bundle (Home Assistant serves the whole folder). */
const asset = (path: string) => new URL(/* @vite-ignore */ path, import.meta.url).href;

/** "loungeDesignSofa" → "Lounge design sofa", "tree_pineRoundC" → "Tree pine round c". */
export function humanize(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Homeslice's own pieces: the ones drawn to size (Modern), and the simple shape of every
 * furniture type no drawn piece covers yet, in its group.
 */
export function builtinGroups(): LibraryGroup[] {
  const groups = modernGroups();
  const covered = new Set(groups.flatMap((g) => g.items.map((i) => i.type)));
  for (const g of FURNITURE_GROUPS) {
    const missing = g.types.filter((t) => !covered.has(t));
    if (!missing.length) continue;
    let group = groups.find((x) => x.id === g.id);
    if (!group) groups.push((group = { id: g.id, items: [] }));
    group.items.push(...missing.map((type) => ({ key: `builtin:${type}`, type, model: "builtin", thumb: asset(`thumbs/builtin/${type}.png`) })));
  }
  return groups;
}

export function modernGroups(): LibraryGroup[] {
  return MODERN_GROUPS.map((g) => ({
    id: g.id,
    items: g.kinds.map((k) => ({
      key: `modern:${k.id}`,
      type: k.type,
      model: `modern:${k.id}`,
      nameKey: `modern.${k.id}`,
      thumb: asset(`thumbs/modern/${k.id}.png`),
      size: [k.size[0], k.size[1]] as [number, number],
      height: k.size[2],
      tags: [k.id.replace(/_/g, " ")],
      ...(k.mount ? { mount: k.mount } : {}),
      ...(k.elevation !== undefined ? { elevation: k.elevation } : {}),
    })),
  }));
}

export function kenneyGroups(): LibraryGroup[] {
  return KENNEY_GROUPS.map((g) => ({
    id: g.id,
    items: g.items.map((i) => {
      const s = kenneySize(i.file);
      return { key: `kenney:${i.file}`, type: i.type, model: `kenney:${i.file}`, name: humanize(i.file), thumb: asset(`thumbs/kenney/${i.file}.png`), ...(s ? { size: s.size, height: s.height } : {}) };
    }),
  }));
}

const has = (a: PolyhavenAsset, re: RegExp) => re.test(`${a.id} ${a.name} ${a.tags.join(" ")}`.toLowerCase());

/** The furniture type a Poly Haven model is (from its categories, name and tags). */
export function polyhavenType(a: PolyhavenAsset): FurnitureType {
  const c = new Set(a.categories);
  if (c.has("lighting")) {
    if (has(a, /street|security|searchlight|torch|flashlight|bulb|socket|candle|lantern|fluorescent/)) return "item";
    if (has(a, /chandelier|ceiling|hanging|pendant/)) return "ceiling_lamp";
    if (has(a, /wall|sconce/)) return "wall_lamp";
    if (has(a, /desk|table/)) return "table_lamp";
    return "floor_lamp";
  }
  if (c.has("bed")) return "bed";
  if (c.has("seating")) {
    if (has(a, /sofa|couch|day.?bed/)) return "sofa";
    if (has(a, /bench|picnic/)) return "bench";
    if (has(a, /stool|ottoman/)) return "stool";
    if (has(a, /arm.?chair|lounge|rocking/)) return "armchair";
    return "chair";
  }
  if (c.has("table")) {
    if (has(a, /coffee|tea table/)) return "coffee_table";
    if (has(a, /nightstand|night stand/)) return "nightstand";
    if (has(a, /desk/)) return "desk";
    if (has(a, /side|console|drawer|cabinet|cart/)) return "side_table";
    return "table";
  }
  if (c.has("shelves") || has(a, /cabinet|commode|shelf|shelves|bookcase|bookshelf|drawer/)) return "shelf";
  if (c.has("trees")) return has(a, /pine|fir/) ? "pine" : has(a, /sapling|small/) ? "tree_small" : "tree";
  if (c.has("potted plants") || has(a, /potted|planter/)) return "plant";
  if (c.has("flowers")) return "flower_bed";
  if (c.has("plants")) return has(a, /shrub|bush/) ? "bush" : "plant";
  if (has(a, /ceiling.?fan/)) return "ceiling_fan";
  if (has(a, /television|\btv\b/)) return "tv";
  return "item";
}

/** The library group of a Poly Haven model. */
function polyhavenGroup(type: FurnitureType, a: PolyhavenAsset): string {
  if (["sofa", "sofa_corner", "armchair", "stool", "chair", "bench"].includes(type)) return type === "bench" ? "outside" : "seating";
  if (["table", "coffee_table", "side_table", "desk", "nightstand"].includes(type)) return "tables";
  if (type === "bed") return "bedroom";
  if (type === "shelf") return "storage";
  if (["floor_lamp", "table_lamp", "wall_lamp", "ceiling_lamp", "ceiling_fan"].includes(type)) return "lighting";
  if (type === "plant") return "plants";
  if (["tree", "tree_small", "pine", "bush", "flower_bed"].includes(type)) return "outside";
  if (a.categories.some((c) => ["appliances", "electronics", "office"].includes(c))) return "appliances";
  return "decoration";
}

const POLYHAVEN_GROUPS = ["seating", "tables", "storage", "bedroom", "lighting", "plants", "decoration", "appliances", "outside"];

export function polyhavenGroups(catalog: PolyhavenAsset[]): LibraryGroup[] {
  const groups = new Map<string, LibraryItem[]>(POLYHAVEN_GROUPS.map((g) => [g, []]));
  for (const a of catalog) {
    const type = polyhavenType(a);
    const d = a.dimensions;
    // Poly Haven's thumbnails come in any size; small ones for the library
    const thumb = (a.thumbnail ?? `https://cdn.polyhaven.com/asset_img/thumbs/${a.id}.png?format=webp`).replace(/width=\d+/, "width=128").replace(/height=\d+/, "height=128");
    groups.get(polyhavenGroup(type, a))!.push({
      key: `polyhaven:${a.id}`,
      type,
      model: `polyhaven:${a.id}`,
      name: a.name,
      thumb,
      tags: [...a.tags, ...a.categories],
      ...(d && d[0] > 0 && d[1] > 0 && d[2] > 0 ? { size: [d[0], d[1]] as [number, number], height: d[2] } : {}),
    });
  }
  return [...groups].filter(([, items]) => items.length).map(([id, items]) => ({ id, items }));
}

export function customGroups(models: CustomAsset[]): LibraryGroup[] {
  return models.length ? [{ id: "uploaded", items: models.map((m) => ({ key: `custom:${m.id}`, type: "item" as const, model: `custom:${m.id}`, name: m.name, thumb: "" })) }] : [];
}

/** Items matching a search (name, type, tags). */
export function filterGroups(groups: LibraryGroup[], query: string, typeName: (t: FurnitureType) => string): LibraryGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  // every word somewhere: "black lamp", "dusche glas"
  const words = q.split(/\s+/);
  const matches = (i: LibraryItem) => {
    const text = [i.name ?? "", typeName(i.type), i.type, ...(i.tags ?? [])].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  };
  return groups.map((g) => ({ ...g, items: g.items.filter(matches) })).filter((g) => g.items.length);
}

/** A placed piece seen from straight above (assets/plan): its Kenney model's, else its type's. */
export function planPicture(f: { type: FurnitureType; model?: string }): string {
  if (f.model?.startsWith("kenney:")) return asset(`plan/kenney/${f.model.slice(7)}.png`);
  if (f.model === "builtin") return asset(`plan/builtin/${f.type}.png`);
  if (f.model?.startsWith("modern:")) return asset(`plan/modern/${f.model.slice(7)}.png`);
  return asset(`plan/${FURNITURE[f.type] ? f.type : "item"}.png`);
}
