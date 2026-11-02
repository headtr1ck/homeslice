/**
 * The start: what this Home Assistant already knows that a house can be started from (an
 * AI, robot maps, floors and areas), and the small pieces of logic the start screen needs.
 */

/** Metres per pixel of a robot's map picture, by the integration drawing it; null when it isn't known. */
export function mapScale(platform: string | undefined): number | null {
  // Roborock draws its maps at 50 mm a map pixel, four times enlarged
  if (platform === "roborock") return 0.0125;
  return null;
}

/** A name for comparing: lower case, accents off (ß as ss), letters and digits only. */
export function normal(t: string): string {
  return t
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Letter triples of a name, spaces left out ("Ground Floor" and "groundfloor" share them all). */
function trigrams(t: string): Map<string, number> {
  const s = `  ${normal(t).replace(/ /g, "")} `;
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= s.length; i++) out.set(s.slice(i, i + 3), (out.get(s.slice(i, i + 3)) ?? 0) + 1);
  return out;
}

/** How alike two names are, 0..1 (shared letter triples): spelling, spaces and small typos barely matter. */
export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  let shared = 0;
  let total = 0;
  for (const [k, n] of x) {
    shared += Math.min(n, y.get(k) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total ? (2 * shared) / total : 0;
}

/** How well a name is found in a longer one: its best match against any run of the other's words. */
function within(name: string, text: string): number {
  const w = normal(text).split(" ").filter(Boolean);
  let best = 0;
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= Math.min(w.length, i + 4); j++) best = Math.max(best, similarity(name, w.slice(i, j).join(" ")));
  return best;
}

/** The best match for `name` among `options` (by `label`), if it is alike enough. */
export function bestMatch<T>(name: string, options: T[], label: (o: T) => string, threshold = 0.72): T | undefined {
  let best: T | undefined;
  let score = threshold;
  for (const o of options) {
    const s = similarity(name, label(o));
    if (s >= score) [best, score] = [o, s];
  }
  return best;
}

/**
 * The maps' own names: what all of one robot's maps start with (its name: "Saros 10 …") taken
 * off; a robot with a single map loses its device name instead.
 */
export function ownNames(maps: { id: string; name: string; robot?: string; device?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const byRobot = new Map<string, typeof maps>();
  for (const m of maps) byRobot.set(m.robot ?? m.id, [...(byRobot.get(m.robot ?? m.id) ?? []), m]);
  for (const group of byRobot.values()) {
    const words = group.map((m) => normal(m.name).split(" "));
    let common = 0;
    if (group.length > 1) while (words.every((w) => w.length > common + 1 && w[common] === words[0][common])) common++;
    else if (group[0].device) {
      const d = normal(group[0].device).split(" ");
      if (d.every((x, i) => words[0][i] === x) && words[0].length > d.length) common = d.length;
    }
    group.forEach((m, i) => (out[m.id] = words[i].slice(common).join(" ")));
  }
  return out;
}

export interface MapEvidence {
  id: string;
  /** Its own name (see ownNames). */
  name: string;
  /** The robot's room names on it. */
  rooms: string[];
}

export interface FloorEvidence {
  floor_id: string;
  name: string;
  /** The names of its Home Assistant areas. */
  areas: string[];
}

/** How much a map looks like a floor, 0..1: by name, and by how many of its rooms are that floor's areas. */
export function mapFloorScore(map: MapEvidence, floor: FloorEvidence): number {
  const byName = Math.max(within(floor.name, map.name), within(floor.floor_id.replace(/_/g, " "), map.name));
  const matched = map.rooms.filter((r) => floor.areas.some((a) => similarity(r, a) >= 0.72)).length;
  const byRooms = map.rooms.length ? matched / map.rooms.length : 0;
  // either is enough on its own; both together are surer
  return Math.min(1, Math.max(byName, byRooms) + 0.25 * Math.min(byName, byRooms));
}

/**
 * Which map each floor takes: every map–floor pair scored, then the surest pairs first, each
 * floor and each map used once; a pair below `threshold` is no match.
 */
export function assignMaps(maps: MapEvidence[], floors: FloorEvidence[], threshold = 0.6): Record<string, string> {
  const pairs = maps.flatMap((m) => floors.map((f) => ({ m: m.id, f: f.floor_id, score: mapFloorScore(m, f) }))).filter((p) => p.score >= threshold);
  pairs.sort((a, b) => b.score - a.score);
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const p of pairs) {
    if (out[p.f] || used.has(p.m)) continue;
    out[p.f] = p.m;
    used.add(p.m);
  }
  return out;
}

/** The house YAML in an assistant's answer: inside a code block if there is one, else all of it. */
export function extractYaml(text: string): string {
  const fenced = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export interface MapNote {
  /** What the picture is called (the attachment's name). */
  name: string;
  /** The floor it belongs to. */
  floor?: string;
  /** Metres per pixel, if known. */
  scale: number | null;
  /** The robot's room names by room number. */
  rooms?: Record<number, string>;
}

/** Room colours by room number, as the robots' map pictures paint them (for the assistant). */
const COLOUR_NAMES = ["sand (240,178,122)", "light blue (133,193,233)", "salmon (217,136,128)", "blue (52,152,219)", "rust (205,97,85)", "orange (243,156,18)", "green (88,214,141)", "amber (245,176,65)", "yellow (252,212,81)", "teal (72,201,176)", "steel blue (84,153,199)"];

/** What an assistant needs to know about robot maps it is given (in English, like the guide). */
export function mapNotes(maps: MapNote[]): string {
  if (!maps.length) return "";
  const lines = [
    "## Robot vacuum maps",
    "Some of the pictures are maps a robot vacuum measured: use them for the true sizes and shapes of the rooms (a photo or sketch of a floor plan gives the layout and the labels). Each room is filled in one colour; the light blue lines over the rooms are the robot's cleaning path, dark grey is walls and furniture.",
  ];
  for (const m of maps) {
    lines.push("", `- **${m.name}**${m.floor ? ` (floor ${m.floor})` : ""}: ${m.scale ? `${(m.scale * 1000).toFixed(1)} mm per pixel, true to scale` : "scale unknown: take sizes from a floor plan or a typical door width (0.9 m)"}.`);
    if (m.rooms)
      for (const [n, name] of Object.entries(m.rooms))
        if (COLOUR_NAMES[Number(n) - 1]) lines.push(`  - room ${n}, "${name}": ${COLOUR_NAMES[Number(n) - 1]}`);
  }
  lines.push("", "The maps of different floors are not aligned to each other: place each floor's rooms within the house's outline.");
  return lines.join("\n");
}
