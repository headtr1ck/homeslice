// Turns the short input form into the expanded model: resolves grid names, rectangles,
// defaults and elevations. Problems are collected as issues instead of thrown, so a
// partly broken file still renders and the user sees every problem at once.

import { bbox, edges, normalizeOrientation, outwardNormal, rectPolygon, sideOf, signedArea } from "./geometry";
import { FURNITURE } from "./furniture";
import { FLOOR_FINISHES, WALL_FINISHES } from "./finishes";

/** A furniture model reference (see FurnitureInput.model). */
// kenney:<name> was a bundled model; such pieces now show their type's built-in piece
const MODEL_REF = /^(builtin|(kenney|polyhaven|custom|modern):[A-Za-z0-9_-]+)$/;
/** How a light can look (see LightInput.type). */
export const LIGHT_TYPES: LightType[] = ["lamp", "spot", "strip", "indirect"];
import type {
  Coord,
  Energy,
  FurnitureType,
  House,
  HouseInput,
  Issue,
  Level,
  LightType,
  Opening,
  OpeningStyle,
  OpeningType,
  Robot,
  Room,
  ShapeInput,
  Side,
  Vec2,
  Vertical,
  WallThickness,
} from "./types";

export const DEFAULTS = {
  levelHeight: 2.6,
  slab: 0.25,
  walls: { exterior: 0.36, interior: 0.12, party: 0.24 } satisfies WallThickness,
  floor: { room: "wood", outdoor: "lawn", void: "none" },
  opening: {
    window: { sill: 0.9, height: 1.3 },
    door: { sill: 0, height: 2.1 },
    garage_door: { sill: 0, height: 2.1 },
    opening: { sill: 0, height: 2.1 },
  } satisfies Record<OpeningType, { sill: number; height: number }>,
};

const SIDES = ["north", "south", "east", "west"];
const TEXTURE_REF = /^polyhaven:[A-Za-z0-9_-]+$/;
/** A built-in finish of the list, or a Poly Haven texture. */
const finishOk = (v: unknown, list: string[]) => typeof v === "string" && (list.includes(v) || TEXTURE_REF.test(v));
const FLOOR_HINT = "a floor finish like wood, oak_herringbone or tile_white (see the catalogue) or polyhaven:<texture>";
const WALL_HINT = "a wall finish like paint_white, acoustic_oak or brick_red (see the catalogue) or polyhaven:<texture>";
const OPENING_TYPES = Object.keys(DEFAULTS.opening);

export interface ExpandResult {
  house: House | null;
  issues: Issue[];
}

/** An opening's kind and the way it opens, with the defaults per type. */
function look(o: { style?: OpeningStyle; hinge?: "left" | "right"; swing?: "in" | "out"; width: number; split?: number }, type: OpeningType, height: number): Pick<Opening, "style" | "hinge" | "swing" | "split"> {
  // wide windows and doors have two leaves unless they say otherwise
  const fallback: OpeningStyle = type === "opening" ? "square" : (type === "window" && o.width > 1.3) || (type === "door" && o.width > 1.4) ? "double" : "single";
  const styles: OpeningStyle[] = ["single", "double", "triple", "fixed", "split", "split_single", "sliding", "sliding_glass", "glass", "glass_double", "entrance_strip", "entrance_panes", "entrance_sidelight", "square", "arch"];
  const split = typeof o.split === "number" && o.split > 0 && o.split < height ? o.split : height / 2;
  return { style: o.style && styles.includes(o.style) ? o.style : fallback, hinge: o.hinge === "right" ? "right" : "left", swing: o.swing === "out" ? "out" : "in", split };
}

const energySlug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";

export function expandHouse(input: unknown): ExpandResult {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });

  if (!input || typeof input !== "object") {
    err("", "The house file is empty or not a mapping.");
    return { house: null, issues };
  }
  const h = input as HouseInput;
  if (h.schema !== 1) err("schema", `Unsupported schema ${JSON.stringify(h.schema)}; expected 1.`);
  if (!Array.isArray(h.levels) || h.levels.length === 0) {
    err("levels", "A house needs at least one level.");
    return { house: null, issues };
  }

  const coord = (c: Coord, axis: "x" | "y", path: string): number => {
    if (typeof c === "number") return c;
    const v = h.grid?.[axis]?.[c];
    if (v === undefined) {
      const known = Object.keys(h.grid?.[axis] ?? {});
      err(path, `Unknown grid ${axis} axis "${c}"` + (known.length ? ` (known: ${known.join(", ")}).` : "; no grid defined."));
      return 0;
    }
    return v;
  };

  const shape = (s: ShapeInput | undefined, path: string): Vec2[] | null => {
    if (!s) return null;
    if (s.rect && s.polygon) warn(path, "Both rect and polygon given; using polygon.");
    if (s.polygon) {
      if (!Array.isArray(s.polygon) || s.polygon.length < 3) {
        err(`${path}.polygon`, "A polygon needs at least 3 points.");
        return null;
      }
      const pts = s.polygon.map(([x, y], i): Vec2 => [coord(x, "x", `${path}.polygon[${i}]`), coord(y, "y", `${path}.polygon[${i}]`)]);
      if (Math.abs(signedArea(pts)) < 1e-6) {
        err(`${path}.polygon`, "The polygon has no area (points on one line?).");
        return null;
      }
      return normalizeOrientation(pts);
    }
    if (s.rect) {
      const [x, y, w, d] = s.rect;
      if (!(w > 0 && d > 0)) {
        err(`${path}.rect`, `Width and depth must be positive, got ${w} × ${d}.`);
        return null;
      }
      return rectPolygon(coord(x, "x", `${path}.rect`), coord(y, "y", `${path}.rect`), w, d);
    }
    return null;
  };

  const walls: WallThickness = { ...DEFAULTS.walls, ...(h.walls ?? {}) };
  const houseOutline = shape(h.outline, "outline");
  if (h.facade !== undefined && !finishOk(h.facade, WALL_FINISHES)) err("facade", `facade must be ${WALL_HINT}, got ${JSON.stringify(h.facade)}.`);

  const ids = new Set<string>();
  const levels: Level[] = [];
  let elevation = 0;
  h.levels.forEach((li, index) => {
    const lp = `levels.${li?.id ?? index}`;
    if (!li?.id) err(lp, "Every level needs an id.");
    if (ids.has(li.id)) err(lp, `Duplicate level id "${li.id}".`);
    ids.add(li.id);

    const roomIds = new Set<string>();
    const rooms: Room[] = [];
    (li.rooms ?? []).forEach((ri, i) => {
      const rp = `${lp}.rooms.${ri?.id ?? i}`;
      if (!ri?.id) return err(rp, "Every room needs an id.");
      if (roomIds.has(ri.id)) err(rp, `Duplicate room id "${ri.id}" on this level.`);
      roomIds.add(ri.id);
      const polygon = shape(ri, rp);
      if (!polygon) {
        if (!ri.rect && !ri.polygon) err(rp, "A room needs rect: [x, y, width, depth] or polygon: [[x, y], …].");
        return;
      }
      if (ri.floor !== undefined && !finishOk(ri.floor, FLOOR_FINISHES)) err(`${rp}.floor`, `floor must be ${FLOOR_HINT}, got ${JSON.stringify(ri.floor)}.`);
      if (ri.wall !== undefined && !finishOk(ri.wall, WALL_FINISHES)) err(`${rp}.wall`, `wall must be ${WALL_HINT}, got ${JSON.stringify(ri.wall)}.`);
      const wallSides: Partial<Record<Side, string>> = {};
      if (ri.wall_sides !== undefined) {
        if (!ri.wall_sides || typeof ri.wall_sides !== "object" || Array.isArray(ri.wall_sides)) err(`${rp}.wall_sides`, "wall_sides must map sides to finishes, e.g. {north: acoustic_oak}.");
        else
          for (const [side, v] of Object.entries(ri.wall_sides)) {
            if (!SIDES.includes(side)) err(`${rp}.wall_sides`, `Unknown side "${side}" (north, south, east or west).`);
            else if (!finishOk(v, WALL_FINISHES)) err(`${rp}.wall_sides.${side}`, `A wall side must be ${WALL_HINT}, got ${JSON.stringify(v)}.`);
            else wallSides[side as Side] = v as string;
          }
      }
      const kind = ri.kind ?? "room";
      const { min } = bbox(polygon);
      const lights: Room["lights"] = [];
      (ri.lights ?? []).forEach((li, j) => {
        if (typeof li?.entity !== "string" || !li.entity.startsWith("light.")) return err(`${rp}.lights.${j}`, `A light needs entity: light.…, got ${JSON.stringify(li?.entity)}.`);
        const point = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number");
        if (li.at !== undefined && !point(li.at)) return err(`${rp}.lights.${j}`, "at must be [metres east, metres south] of the room's north-west corner.");
        if (li.type !== undefined && !LIGHT_TYPES.includes(li.type)) return err(`${rp}.lights.${j}.type`, `type must be ${LIGHT_TYPES.join(", ")}, got ${JSON.stringify(li.type)}.`);
        if (li.spots !== undefined && !(Array.isArray(li.spots) && li.spots.every(point)))
          return err(`${rp}.lights.${j}.spots`, "spots must be a list of [metres east, metres south] of the room's north-west corner.");
        if (li.to !== undefined && !point(li.to)) return err(`${rp}.lights.${j}.to`, "to must be [metres east, metres south] of the room's north-west corner.");
        if (li.height !== undefined && !(typeof li.height === "number" && li.height >= 0 && li.height <= 6)) return err(`${rp}.lights.${j}.height`, "height must be metres above the floor (0–6).");
        if (li.type === "strip" && (li.at === undefined || li.to === undefined)) return err(`${rp}.lights.${j}`, "A strip needs at and to: its two ends.");
        const abs = (p: [number, number]): Vec2 => [min[0] + p[0], min[1] + p[1]];
        lights.push({
          entity: li.entity,
          at: li.at ? abs(li.at) : undefined,
          hidden: !!li.hidden,
          type: li.type ?? "lamp",
          spots: (li.spots ?? []).map(abs),
          ...(li.to ? { to: abs(li.to) } : {}),
          ...(li.height !== undefined ? { height: li.height } : {}),
        });
      });
      const furniture: Room["furniture"] = [];
      (ri.furniture ?? []).forEach((fi, j) => {
        const fp = `${rp}.furniture.${j}`;
        const def = FURNITURE[fi?.type as FurnitureType];
        if (!def) return err(fp, `type must be one of ${Object.keys(FURNITURE).join(", ")}, got ${JSON.stringify(fi?.type)}.`);
        if (!Array.isArray(fi.at) || fi.at.length !== 2) return err(fp, "at must be [metres east, metres south] of the room's north-west corner (the piece's centre).");
        const size = fi.size ?? def.size;
        if (!(size[0] > 0 && size[1] > 0)) return err(fp, "size must be [width, depth] in metres.");
        const mount = fi.mount ?? def.mount ?? "floor";
        if (!["floor", "wall", "ceiling"].includes(mount)) return err(fp, `mount must be floor, wall or ceiling, got ${JSON.stringify(fi.mount)}.`);
        const elevation = mount === "ceiling" ? null : mount === "wall" ? (fi.elevation ?? def.elevation ?? 1.2) : 0;
        if (fi.height !== undefined && !(typeof fi.height === "number" && fi.height > 0)) return err(fp, "height must be in metres.");
        if (fi.model !== undefined && !(typeof fi.model === "string" && MODEL_REF.test(fi.model)))
          return err(fp, `model must be modern:<kind>, polyhaven:<id>, custom:<id> or builtin, got ${JSON.stringify(fi.model)}.`);
        if (fi.finish !== undefined && typeof fi.finish !== "string") return err(fp, "finish must be a name like oak, white or grey.");
        if (fi.accent !== undefined && typeof fi.accent !== "string") return err(fp, "accent must be a name like black, brass or oak.");
        furniture.push({
          type: fi.type,
          at: [min[0] + fi.at[0], min[1] + fi.at[1]],
          rotation: (((fi.rotation ?? 0) % 360) + 360) % 360,
          size: [size[0], size[1]],
          height: fi.height ?? def.height,
          mount,
          elevation,
          mirror: !!fi.mirror,
          ...(fi.entity ? { entity: fi.entity } : {}),
          ...(fi.model ? { model: fi.model } : {}),
          ...(fi.finish ? { finish: fi.finish } : {}),
          ...(fi.accent ? { accent: fi.accent } : {}),
        });
      });
      // a piece's light is where the piece stands (it moves with it)
      for (const f of furniture) {
        if (!f.entity?.startsWith("light.")) continue;
        const listed = lights.find((x) => x.entity === f.entity);
        if (listed) Object.assign(listed, { at: f.at, piece: true });
        else lights.push({ entity: f.entity, at: f.at, hidden: false, piece: true, type: "lamp", spots: [] });
      }
      const room: Room = { id: ri.id, areaId: ri.area_id, name: ri.name, kind, floor: ri.floor ?? DEFAULTS.floor[kind], polygon, lights, furniture };
      if (ri.awning) room.awning = ri.awning;
      if (ri.wall) room.wall = ri.wall;
      if (Object.keys(wallSides).length) room.wallSides = wallSides;
      rooms.push(room);
    });

    const openings: Opening[] = [];
    (li.openings ?? []).forEach((oi, i) => {
      const op = `${lp}.openings[${i}]`;
      if (!roomIds.has(oi?.room)) return err(op, `Unknown room "${oi?.room}"` + ` (rooms on this level: ${[...roomIds].join(", ")}).`);
      if (!SIDES.includes(oi.side)) return err(op, `side must be one of ${SIDES.join(", ")}, got "${oi.side}".`);
      const type = oi.type ?? "window";
      if (!OPENING_TYPES.includes(type)) return err(op, `type must be one of ${OPENING_TYPES.join(", ")}, got "${type}".`);
      if (!(oi.width > 0)) return err(op, "width must be positive.");
      const d = { ...DEFAULTS.opening[type], ...h.opening_defaults?.[type] };
      openings.push({
        id: oi.id ?? `${oi.room}_${oi.side}_${i}`,
        source: { kind: "level", index: i },
        room: oi.room,
        side: oi.side,
        at: oi.at ?? 0,
        width: oi.width,
        type,
        sill: oi.sill ?? d.sill,
        height: oi.height ?? d.height,
        ...look(oi, type, oi.height ?? d.height),
        cover: oi.cover,
        contact: oi.contact,
      });
    });

    const openBoundaries: Level["openBoundaries"] = [];
    const freeWalls: Level["freeWalls"] = [];
    const thickBoundaries: Level["thickBoundaries"] = [];
    (li.walls ?? []).forEach((wi, i) => {
      const wp = `${lp}.walls[${i}]`;
      if (wi?.between) {
        const unknown = wi.between.filter((r) => !roomIds.has(r));
        if (wi.between.length !== 2 || unknown.length) return err(wp, `between needs two rooms of this level (unknown: ${unknown.join(", ") || "none"}; rooms: ${[...roomIds].join(", ")}).`);
        if (wi.side && !SIDES.includes(wi.side)) return err(wp, `side must be one of ${SIDES.join(", ")}, got "${wi.side}".`);
        if ((wi.type ?? "open") === "open") openBoundaries.push({ between: wi.between, side: wi.side });
        else if (wi.thickness !== undefined) {
          if (!(wi.thickness > 0 && wi.thickness < 2)) return err(wp, `thickness is in metres, e.g. 0.12; got ${wi.thickness}.`);
          thickBoundaries.push({ between: wi.between, side: wi.side, thickness: wi.thickness });
        }
        return;
      }
      if (wi?.line) {
        const [[x0, y0], [x1, y1]] = wi.line;
        const a: Vec2 = [coord(x0, "x", wp), coord(y0, "y", wp)];
        const b: Vec2 = [coord(x1, "x", wp), coord(y1, "y", wp)];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) return err(wp, "A wall line needs two different points.");
        if ((wi.type ?? "wall") === "wall") freeWalls.push({ a, b, thickness: wi.thickness });
        return;
      }
      err(wp, "A wall entry needs between: [room, room] or line: [[x, y], [x, y]].");
    });

    const outline = shape(li.outline, `${lp}.outline`) ?? houseOutline;
    if (!outline) err(lp, "No outline: set outline on the house (shared by all levels) or on this level.");

    if (li.include_floors !== undefined && !(Array.isArray(li.include_floors) && li.include_floors.every((f) => typeof f === "string")))
      err(`${lp}.include_floors`, "include_floors must be a list of Home Assistant floor ids.");
    const height = li.height ?? DEFAULTS.levelHeight;
    const slab = li.slab ?? DEFAULTS.slab;
    levels.push({
      id: li.id,
      floorId: li.floor_id,
      name: li.name ?? li.id,
      index,
      elevation,
      height,
      slab,
      outline: outline ?? [],
      partyWalls: li.party_walls ?? h.party_walls ?? [],
      rooms,
      openings,
      openBoundaries,
      freeWalls,
      thickBoundaries,
    });
    elevation += height + slab;
  });

  // façade openings: placed on each listed level in the room behind that stretch of wall
  (h.facade_openings ?? []).forEach((fi, i) => {
    const fp = `facade_openings[${fi?.id ?? i}]`;
    if (!SIDES.includes(fi?.side)) return err(fp, `side must be one of ${SIDES.join(", ")}, got "${fi?.side}".`);
    if (!(fi.width > 0)) return err(fp, "width must be positive.");
    const type = fi.type ?? "window";
    if (!OPENING_TYPES.includes(type)) return err(fp, `type must be one of ${OPENING_TYPES.join(", ")}, got "${type}".`);
    const d = { ...DEFAULTS.opening[type], ...h.opening_defaults?.[type] };
    for (const levelId of fi.levels ?? []) {
      const level = levels.find((l) => l.id === levelId);
      if (!level) {
        err(fp, `Unknown level "${levelId}" (levels: ${levels.map((l) => l.id).join(", ")}).`);
        continue;
      }
      const along = fi.side === "north" || fi.side === "south" ? 0 : 1;
      const across = 1 - along;
      const ob = bbox(level.outline);
      const line = fi.side === "north" || fi.side === "west" ? ob.min[across] : ob.max[across];
      // positions along the façade use the house's shared coordinates, so stacked windows
      // stay aligned even where a level's outline sticks out (e.g. a cantilevered floor)
      const from = bbox(houseOutline ?? level.outline).min[along] + fi.at;
      const mid = from + fi.width / 2;
      const room = level.rooms.find(
        (r) =>
          r.kind === "room" &&
          edges(r.polygon).some(([a, b]) => {
            if (sideOf(outwardNormal(a, b)) !== fi.side || Math.abs(a[across] - line) > 0.05) return false;
            return mid > Math.min(a[along], b[along]) && mid < Math.max(a[along], b[along]);
          }),
      );
      if (!room) {
        warn(fp, `No room on the ${fi.side} façade of level "${levelId}" at ${fi.at} m.`);
        continue;
      }
      level.openings.push({
        id: `${fi.id ?? `facade${i}`}_${levelId}`,
        source: { kind: "facade", index: i },
        room: room.id,
        side: fi.side,
        at: from - bbox(room.polygon).min[along],
        width: fi.width,
        type,
        sill: fi.sill ?? d.sill,
        height: fi.height ?? d.height,
        ...look(fi, type, fi.height ?? d.height),
        cover: fi.covers?.[levelId],
        contact: fi.contacts?.[levelId],
      });
    }
  });

  const levelIndex = new Map(levels.map((l) => [l.id, l.index]));
  const vertical: Vertical[] = [];
  (h.vertical ?? []).forEach((vi, i) => {
    const vp = `vertical.${vi?.id ?? i}`;
    const polygon = shape(vi, vp);
    const from = levelIndex.get(vi.from);
    const to = levelIndex.get(vi.to);
    if (from === undefined) err(vp, `Unknown level "${vi.from}" in from.`);
    if (to === undefined) err(vp, `Unknown level "${vi.to}" in to.`);
    if (!vi?.rect && !vi?.polygon) err(vp, "Stairs need rect: [x, y, width, depth] or polygon: [[x, y], …].");
    if (!polygon || from === undefined || to === undefined) return;
    if (to <= from) return err(vp, "to must be a level above from.");
    const stairShape = vi.shape ?? "straight";
    if (stairShape !== "straight" && stairShape !== "u_turn") return err(vp, `shape must be straight or u_turn, got "${stairShape}".`);
    const { min, max } = bbox(polygon);
    const up = vi.up ?? (max[0] - min[0] >= max[1] - min[1] ? "east" : "south");
    if (!SIDES.includes(up)) return err(vp, `up must be one of ${SIDES.join(", ")}, got "${up}".`);
    const across: Side[] = up === "east" || up === "west" ? ["north", "south"] : ["east", "west"];
    const start = vi.start ?? across[1];
    if (!across.includes(start)) return err(vp, `start must be ${across.join(" or ")} for a stair climbing ${up}, got "${start}".`);
    const length = up === "east" || up === "west" ? max[0] - min[0] : max[1] - min[1];
    const entry = vi.entry ?? 0;
    if (typeof entry !== "number" || entry < 0 || entry > length - 0.5) return err(vp, `entry must be between 0 and ${(length - 0.5).toFixed(2)} m (the stairwell is ${length.toFixed(2)} m long), got ${entry}.`);
    vertical.push({ id: vi.id, kind: vi.kind ?? "stairs", polygon, from, to, shape: stairShape, up, start, entry });
  });

  // every house has a roof (defaults unless set); cards decide whether it is drawn
  const r = h.roof ?? {};
  if (r.ridge && r.ridge !== "east_west" && r.ridge !== "north_south") err("roof", `ridge must be east_west or north_south, got "${r.ridge}".`);
  const pitch = r.pitch ?? 35;
  if (!(pitch > 0 && pitch < 75)) err("roof", `pitch must be between 0 and 75 degrees, got ${pitch}.`);
  const top = levels[levels.length - 1];
  const tb = bbox(top?.outline.length ? top.outline : [[0, 0], [1, 1]]);
  const roof: House["roof"] = {
    shape: "gable",
    ridge: r.ridge ?? (tb.max[0] - tb.min[0] >= tb.max[1] - tb.min[1] ? "east_west" : "north_south"),
    pitch,
    overhang: r.overhang ?? 0.3,
  };

  const energy: Energy[] = [];
  const KINDS = ["solar", "battery", "grid", "inverter", "device"];
  (h.energy ?? []).forEach((e, index) => {
    const ep = `energy.${index}`;
    if (!e || !KINDS.includes(e.kind)) return err(ep, `kind must be one of ${KINDS.join(", ")}, got ${JSON.stringify(e?.kind)}.`);
    let onLevel: number | null = null;
    if (e.kind !== "solar") {
      const li = e.level === undefined ? undefined : levelIndex.get(e.level);
      if (li === undefined) return err(ep, `A ${e.kind} needs level: <level id> and at: [x, y]${e.level ? ` (unknown level "${e.level}")` : ""}.`);
      if (!Array.isArray(e.at) || e.at.length !== 2) return err(ep, "at must be [x, y] in metres.");
      onLevel = li;
    }
    if (e.kind === "device" && !e.power) return err(ep, "A device needs power: <sensor>.");
    if (e.roof && !SIDES.includes(e.roof)) return err(ep, `roof must be one of ${SIDES.join(", ")}.`);
    energy.push({ kind: e.kind, id: "", to: null, index, levelIndex: onLevel, at: e.at ? [e.at[0], e.at[1]] : null, power: e.power, soc: e.soc, name: e.name, roof: e.roof ?? "south" });
  });
  // ids (given, else from the name or kind) and where each flow line goes
  const taken = new Set<string>();
  for (const e of energy) {
    const given = h.energy![e.index].id;
    if (given && taken.has(given)) err(`energy.${e.index}`, `id "${given}" is used twice.`);
    let id = given ?? energySlug(e.name ?? e.kind);
    for (let n = 2; !given && taken.has(id); n++) id = `${energySlug(e.name ?? e.kind)}_${n}`;
    e.id = id;
    taken.add(id);
  }
  const hub = energy.find((e) => e.kind === "inverter") ?? energy.find((e) => e.kind === "battery") ?? energy.find((e) => e.kind === "grid");
  for (const e of energy) {
    const to = h.energy![e.index].to;
    if (to !== undefined) {
      const target = energy.find((x) => x.id === to);
      if (!target || target === e) err(`energy.${e.index}`, `to must be the id of another energy item (${energy.filter((x) => x !== e).map((x) => x.id).join(", ")}), got "${to}".`);
      else e.to = target.index;
    } else if (hub && hub !== e) e.to = hub.index;
  }

  if (issues.some((i) => i.severity === "error")) return { house: null, issues };
  if (h.inverted_covers !== undefined && !(Array.isArray(h.inverted_covers) && h.inverted_covers.every((c) => typeof c === "string")))
    err("inverted_covers", "inverted_covers must be a list of cover entities.");
  const invertedCovers = Array.isArray(h.inverted_covers) ? h.inverted_covers.filter((c) => typeof c === "string") : [];
  const robots: Robot[] = [];
  (h.robots ?? []).forEach((r, index) => {
    const rp = `robots.${index}`;
    const kind = r?.entity?.split(".")[0];
    if (kind !== "vacuum" && kind !== "lawn_mower") return err(rp, `entity must be a vacuum.* or lawn_mower.* entity, got ${JSON.stringify(r?.entity)}.`);
    const li = levelIndex.get(r.level);
    if (li === undefined) return err(rp, `level must be one of ${[...levelIndex.keys()].join(", ")}, got ${JSON.stringify(r.level)}.`);
    if (!Array.isArray(r.dock) || r.dock.length !== 2) return err(rp, "dock must be [x, y] in metres.");
    const points = (r.position?.points ?? []).filter((p) => Array.isArray(p) && p.length === 2);
    robots.push({
      index,
      entity: r.entity,
      kind,
      name: r.name,
      levelIndex: li,
      dock: [r.dock[0], r.dock[1]],
      ...(r.position ? { position: { entity: r.position.entity ?? r.entity, attribute: r.position.attribute, points: points.map(([a, b]) => [[a[0], a[1]], [b[0], b[1]]] as [Vec2, Vec2]) } } : {}),
    });
  });
  if (h.north !== undefined && typeof h.north !== "number") err("north", `north must be degrees (a number), got ${JSON.stringify(h.north)}.`);
  const north = typeof h.north === "number" ? h.north : 0;
  return { house: { id: h.id, name: h.name ?? h.id, walls, levels, vertical, roof, energy, invertedCovers, robots, north, ...(h.facade ? { facade: h.facade } : {}) }, issues };
}
