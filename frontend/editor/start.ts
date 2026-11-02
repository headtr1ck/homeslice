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

const ORDINALS: Record<string, string> = { "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth" };

/** A name as plain words: lower case, accents off (ß as ss), ordinals spelled out. */
const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ORDINALS[w] ?? w)
    .join(" ");

/**
 * The floor a robot's map shows, by name ("Saros 10 Ground floor" ↔ floor "Ground Floor"; spaces
 * and dashes don't matter: "Groundfloor", "ground-floor"; "1st floor" is "First floor");
 * undefined when none matches.
 */
export function mapFloor(mapName: string, floors: { floor_id: string; name: string }[]): string | undefined {
  const m = words(mapName);
  const joined = m.replace(/ /g, "");
  // longest names first: "Upper ground floor" before "Ground floor"
  return [...floors]
    .sort((a, b) => b.name.length - a.name.length)
    .find((f) =>
      [f.name, f.floor_id.replace(/_/g, " ")].some((n) => {
        const w = words(n);
        // as whole words, or written together (short names only as words: "eg" is in "legs")
        return ` ${m} `.includes(` ${w} `) || (w.length >= 6 && joined.includes(w.replace(/ /g, "")));
      }),
    )?.floor_id;
}

/**
 * A robot map picture's own name, without the robot's in front of it ("Saros 10 Ground Floor"
 * of the robot "Saros 10" is "Ground Floor"; `image.saros_10_ground_floor` likewise): only that
 * is compared with floors, so a robot named after a floor doesn't match every floor's map.
 */
export function mapOwnName(name: string, entityId: string, robot: string | undefined): string {
  if (!robot) return `${name} ${entityId.replace(/^image\./, "").replace(/_/g, " ")}`;
  const r = words(robot);
  const strip = (t: string) => {
    const w = words(t);
    return w.startsWith(`${r} `) ? w.slice(r.length + 1) : w === r ? "" : w;
  };
  return `${strip(name)} ${strip(entityId.replace(/^image\./, "").replace(/_/g, " "))}`.trim();
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
