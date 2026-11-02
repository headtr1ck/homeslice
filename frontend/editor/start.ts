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

const key = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The floor a robot's map shows, by name ("Saros 10 Ground floor" ↔ floor "Ground Floor"); undefined when none matches. */
export function mapFloor(mapName: string, floors: { floor_id: string; name: string }[]): string | undefined {
  const m = ` ${key(mapName)} `;
  // longest names first: "Upper ground floor" before "Ground floor"
  return [...floors].sort((a, b) => b.name.length - a.name.length).find((f) => m.includes(` ${key(f.name)} `) || m.includes(` ${key(f.floor_id.replace(/_/g, " "))} `))?.floor_id;
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
