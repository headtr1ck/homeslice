// Sweet Home 3D (.sh3d) to a Homeslice house: the file is a zip with Home.xml, where
// levels, rooms (polygons), walls, doors, windows and furniture are given in centimetres
// with x east and y south, as in our plan. Rooms there follow the inner faces of the walls;
// ours sit on the walls' centre lines, so each room grows by half a wall.
import { unzipSync, strFromU8 } from "three/examples/jsm/libs/fflate.module.js";
import { bbox, normalizeOrientation } from "../model/geometry";
import { offsetPolygon } from "../model/route";
import type { FurnitureInput, FurnitureType, HouseInput, LevelInput, OpeningInput, RoomInput, Side, Vec2 } from "../model/types";

/** Home.xml from a .sh3d file (a zip). */
export function sh3dXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const entry = files["Home.xml"];
  if (!entry) throw new Error("No Home.xml in this file: is it a Sweet Home 3D file (version 5.3 or later)?");
  return strFromU8(entry);
}

/** Furniture names to our types, by words in the name (English and German). */
const KINDS: [RegExp, FurnitureType][] = [
  [/corner sofa|ecksofa|l-sofa/i, "sofa_corner"],
  [/sofa|couch/i, "sofa"],
  [/armchair|sessel/i, "armchair"],
  [/coffee table|couchtisch/i, "coffee_table"],
  [/side table|beistelltisch/i, "side_table"],
  [/single bed|einzelbett|kids bed|kinderbett/i, "bed_single"],
  [/bed|bett/i, "bed"],
  [/night ?stand|bedside|nachttisch/i, "nightstand"],
  [/wardrobe|closet|kleiderschrank|schrank/i, "wardrobe"],
  [/desk|schreibtisch/i, "desk"],
  [/stool|hocker/i, "stool"],
  [/chair|stuhl/i, "chair"],
  [/table|tisch/i, "table"],
  [/book|shelf|regal/i, "shelf"],
  [/tv|television|fernseher/i, "tv"],
  [/fridge|refrigerator|kühlschrank/i, "fridge"],
  [/upper cabinet|hängeschrank|wall cabinet/i, "kitchen_upper"],
  [/kitchen|cooker|oven|stove|dishwasher|küche|herd|spüle/i, "kitchen"],
  [/bath ?tub|badewanne/i, "bathtub"],
  [/shower|dusche/i, "shower"],
  [/toilet|wc/i, "toilet"],
  [/sink|wash ?basin|waschbecken/i, "sink"],
  [/mirror|spiegel/i, "mirror"],
  [/washing machine|washer|waschmaschine/i, "washer"],
  [/dryer|trockner/i, "dryer"],
  [/rug|carpet|teppich/i, "rug"],
  [/plant|pflanze/i, "plant"],
  [/ceiling (lamp|light)|deckenlampe|deckenleuchte/i, "ceiling_lamp"],
  [/wall (lamp|light)|wandlampe/i, "wall_lamp"],
  [/table lamp|tischlampe/i, "table_lamp"],
  [/lamp|light|leuchte|lampe/i, "floor_lamp"],
  [/tree|baum/i, "tree"],
  [/bush|busch|strauch/i, "bush"],
  [/car|auto/i, "car"],
];

export function furnitureType(name: string): FurnitureType {
  return KINDS.find(([re]) => re.test(name))?.[1] ?? "item";
}

const num = (el: Element, name: string, fallback = 0) => {
  const v = parseFloat(el.getAttribute(name) ?? "");
  return Number.isFinite(v) ? v : fallback;
};
const m = (cm: number) => Math.round(cm) / 100;
const slug = (s: string, taken: Set<string>) => {
  const base =
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "room";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
};

/** The room side an opening sits on, and where along it, or null if it is on none. */
function placeOnRoom(rooms: { id: string; poly: Vec2[] }[], p: Vec2, angle: number): { room: string; side: Side; at: number } | null {
  // an opening's angle says which way its wall runs: along x (north/south sides) or along y
  const alongX = Math.abs(Math.cos(angle)) > 0.5;
  let best: { room: string; side: Side; at: number; dist: number } | null = null;
  for (const r of rooms) {
    const { min, max } = bbox(r.poly);
    const sides: [Side, number][] = alongX ? [["north", min[1]], ["south", max[1]]] : [["west", min[0]], ["east", max[0]]];
    for (const [side, line] of sides) {
      const dist = Math.abs((alongX ? p[1] : p[0]) - line);
      const along = alongX ? p[0] - min[0] : p[1] - min[1];
      const span = alongX ? max[0] - min[0] : max[1] - min[1];
      if (along < -0.05 || along > span + 0.05) continue;
      if (dist < 0.4 && (!best || dist < best.dist)) best = { room: r.id, side, at: along, dist };
    }
  }
  return best && { room: best.room, side: best.side, at: best.at };
}

/**
 * A house from Home.xml. Rooms keep their names; doors and windows go onto the side of
 * the room they sit on; furniture gets our type by its name (else a plain box) and its size.
 */
export function sweetHomeToHouse(xml: string, id = "home"): HouseInput {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const home = doc.querySelector("home");
  if (!home) throw new Error("Not a Sweet Home 3D Home.xml.");
  const levelEls = [...home.querySelectorAll(":scope > level")];
  const levelOf = (el: Element) => el.getAttribute("level") ?? (levelEls[0]?.getAttribute("id") ?? "");
  const walls = [...home.querySelectorAll(":scope > wall")];
  // half the usual wall: how much rooms grow to reach the walls' centre lines
  const thick = walls.map((w) => num(w, "thickness", 20)).sort((a, b) => a - b);
  const half = m(thick.length ? thick[Math.floor(thick.length / 2)] : 20) / 2;
  const levels: LevelInput[] = (levelEls.length ? levelEls : [null]).map((el, i) => ({
    id: el ? slug(el.getAttribute("name") ?? `level ${i}`, new Set()) : "ground",
    name: el?.getAttribute("name") ?? "Ground floor",
    ...(el ? { height: m(num(el, "height", 250)) } : {}),
    rooms: [],
  }));
  const levelIndex = (el: Element) => Math.max(0, levelEls.findIndex((l) => l.getAttribute("id") === levelOf(el)));
  const taken = new Set<string>();
  const placed: { id: string; poly: Vec2[] }[][] = levels.map(() => []);
  for (const el of home.querySelectorAll(":scope > room")) {
    const pts = [...el.querySelectorAll("point")].map((p) => [num(p, "x") / 100, num(p, "y") / 100] as Vec2);
    if (pts.length < 3) continue;
    const poly = normalizeOrientation(offsetPolygon(normalizeOrientation(pts), half)).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as [number, number]);
    const li = levelIndex(el);
    const name = el.getAttribute("name") ?? `Room ${placed[li].length + 1}`;
    const room: RoomInput = { id: slug(name, taken), name, polygon: poly };
    levels[li].rooms.push(room);
    placed[li].push({ id: room.id, poly });
  }
  for (const el of home.querySelectorAll(":scope > doorOrWindow, :scope > pieceOfFurniture, :scope > furnitureGroup > doorOrWindow, :scope > furnitureGroup > pieceOfFurniture")) {
    const li = levelIndex(el);
    const name = el.getAttribute("name") ?? "";
    const p: Vec2 = [num(el, "x") / 100, num(el, "y") / 100];
    const angle = num(el, "angle");
    if (el.tagName === "doorOrWindow") {
      const at = placeOnRoom(placed[li], p, angle);
      if (!at) continue;
      const width = m(num(el, "width", 90));
      const door = /door|tür/i.test(name) || (num(el, "elevation") < 5 && num(el, "height") > 180);
      const o: OpeningInput = { room: at.room, side: at.side, at: Math.max(0, Math.round((at.at - width / 2) * 100) / 100), width, type: door ? "door" : "window", height: m(num(el, "height", door ? 210 : 130)) };
      if (!door) o.sill = m(num(el, "elevation", 90));
      (levels[li].openings ??= []).push(o);
      continue;
    }
    // furniture: in the room it stands in, relative to the room's corner
    const room = placed[li].find((r) => {
      const { min, max } = bbox(r.poly);
      return p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1];
    });
    if (!room) continue;
    const { min } = bbox(room.poly);
    const piece: FurnitureInput = {
      type: furnitureType(name),
      at: [Math.round((p[0] - min[0]) * 100) / 100, Math.round((p[1] - min[1]) * 100) / 100],
      size: [m(num(el, "width", 50)), m(num(el, "depth", 50))],
      height: m(num(el, "height", 80)),
      ...(Math.round((angle * 180) / Math.PI) % 360 ? { rotation: ((Math.round((angle * 180) / Math.PI) % 360) + 360) % 360 } : {}),
      ...(num(el, "elevation") > 5 ? { elevation: m(num(el, "elevation")) } : {}),
    };
    const target = levels[li].rooms.find((r) => r.id === room.id)!;
    (target.furniture ??= []).push(piece);
  }
  return { schema: 1, id, name: home.getAttribute("name") ?? "Imported house", levels: levels.filter((l) => l.rooms.length) };
}
