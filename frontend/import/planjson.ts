// Plans from other 3D floor-plan cards for Home Assistant: their JSON plan exports and backups
// (a `building` with `floors`), their `.storage` files, and their simple hand-written format
// (floors with rooms, doors and windows by plain coordinates). All in metres with x east and
// z south, as in our plan. Their rooms run on the walls' centre lines inside, but outside
// walls grow outwards from the room edge: those edges move out by the wall, since our
// outline is the house's outer face.
import { bbox, normalizeOrientation, pointInPolygon } from "../model/geometry";
import type { FurnitureInput, FurnitureType, HouseInput, LevelInput, LightInput, LightType, OpeningInput, RoomInput, Side, Vec2, VerticalInput, WallInput } from "../model/types";
import { withOutlines } from "./outline";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

interface SourceOpening {
  room?: string;
  at: Vec2;
  width: number;
  height?: number;
  sill?: number;
  type: "door" | "window" | "garage_door" | "opening";
  style?: string;
  leaves?: number;
  hinge?: "left" | "right";
  swing?: "in" | "out";
  cover?: string;
  contact?: string;
  lock?: string;
}
interface SourcePiece {
  type: string;
  name?: string;
  at: Vec2;
  w?: number;
  d?: number;
  h?: number;
  rotation: number;
  lift?: number;
  entity?: string;
}
interface SourceFloor {
  name: string;
  elevation: number;
  height: number;
  haFloor?: string;
  rooms: { id: string; name: string; areaId?: string; points: Vec2[]; floor?: string; open: boolean[]; thick: (number | null)[] }[];
  openings: SourceOpening[];
  pieces: SourcePiece[];
  pins: { entity: string; at: Vec2; mount?: string; y?: number; rotation: number; fov?: number; reach?: number }[];
  walls: { a: Vec2; b: Vec2; thickness?: number; height?: number }[];
}
interface Source {
  floors: SourceFloor[];
  exterior: number;
  interior: number;
  /** Room edges on the walls' centre lines (else on their inner faces). */
  centre: boolean;
  roof?: { type?: string; pitch?: number; ridge?: string };
  /** What the source has that can't come along, said while reading it. */
  notes?: string[];
}

/** An entity link, or nothing ("none" and null mean pick one yourself or none). */
const entity = (v: unknown) => (typeof v === "string" && v.includes(".") && v !== "none" ? v : undefined);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const pt = (v: unknown): Vec2 | null => (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === "number") ? [v[0], v[1]] : null);

/** The building in whatever wrapper it came: an export, a backup, a `.storage` file. */
function findBuilding(j: Json): Json {
  if (j?.building?.floors) return j.building;
  if (j?.data?.building?.floors) return j.data.building;
  if (Array.isArray(j?.floors)) return j;
  throw new Error("No floors in this file: is it a plan export of a 3D floor-plan card?");
}

/** The full model: rooms with their edges, openings on room edges, furniture and entity pins. */
function fromBuilding(b: Json): Source {
  const settings = b.settings ?? {};
  const notes: string[] = [];
  const floors: SourceFloor[] = (b.floors ?? []).map((f: Json) => {
    const rooms = (f.rooms ?? []).flatMap((r: Json) => {
      const points = (r.points ?? []).map(pt).filter(Boolean) as Vec2[];
      if (points.length < 3) return [];
      const heights: unknown[] = r.wall_heights ?? [];
      return [{ id: String(r.id), name: String(r.name ?? r.id ?? "Room"), areaId: entity(r.area_id) ? undefined : (r.area_id ?? undefined), points, floor: r.floor_material, open: points.map((_, i) => heights[i] === 0), thick: points.map((_, i) => (typeof r.wall_thickness?.[i] === "number" ? r.wall_thickness[i] : null)) }];
    });
    const openings: SourceOpening[] = (f.openings ?? []).flatMap((o: Json) => {
      const room = rooms.find((r: { id: string }) => r.id === String(o.room_id));
      // a door in a free-standing wall: its edge is the wall's, not the room's
      if (o.wall) {
        notes.push(`${o.type ?? "door"} in a free-standing wall: openings go in room walls only`);
        return [];
      }
      if (!room || typeof o.edge !== "number") return [];
      const a = room.points[o.edge % room.points.length];
      const c = room.points[(o.edge + 1) % room.points.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const off = num(o.offset, len / 2);
      const type = o.type === "garage" ? "garage_door" : o.type === "window" ? "window" : o.style === "passage" ? "opening" : "door";
      return [{ room: room.id, at: [a[0] + ((c[0] - a[0]) * off) / len, a[1] + ((c[1] - a[1]) * off) / len] as Vec2, width: num(o.width, 0.9), height: o.height, sill: o.sill, type, style: o.style ?? undefined, leaves: o.leaves, hinge: o.hinge === "right" ? "right" : o.hinge === "left" ? "left" : undefined, swing: o.swing === "out" ? "out" : o.swing === "in" ? "in" : undefined, cover: entity(o.cover), contact: entity(o.contact), lock: entity(o.lock) }];
    });
    const pieces: SourcePiece[] = (f.furniture ?? []).map((p: Json) => ({ type: String(p.type ?? ""), name: p.name, at: [num(p.x, 0), num(p.z, 0)] as Vec2, w: p.w, d: p.d, h: p.h, rotation: num(p.rotation, 0), lift: p.mount_y ?? undefined, entity: entity(p.entity) }));
    const pins = (f.placements ?? []).flatMap((p: Json) => (entity(p.entity_id) ? [{ entity: p.entity_id, at: [num(p.x, 0), num(p.z, 0)] as Vec2, mount: p.mount ?? undefined, y: p.y ?? undefined, rotation: num(p.rotation, 0), fov: p.fov ?? undefined, reach: p.reach ?? undefined }] : []));
    const walls = (f.walls ?? []).flatMap((w: Json) => (pt(w.a) && pt(w.b) ? [{ a: pt(w.a)!, b: pt(w.b)!, thickness: w.thickness ?? undefined, height: w.height ?? undefined }] : []));
    return { name: String(f.name ?? "Floor"), elevation: num(f.elevation, 0), height: num(f.height, 2.5), haFloor: f.ha_floor ?? undefined, rooms, openings, pieces, pins, walls };
  });
  return { floors, exterior: num(settings.wall_exterior, 0.24), interior: num(settings.wall_interior, 0.12), centre: true, roof: settings.roof, notes };
}

/** The simple format: lengths in m, cm or mm, doors and windows by the point in their middle. */
function fromSimple(j: Json): Source {
  const k = j.units === "cm" ? 0.01 : j.units === "mm" ? 0.001 : 1;
  const p = (v: unknown): Vec2 | null => {
    const q = pt(v);
    return q ? [q[0] * k, q[1] * k] : null;
  };
  const len = (v: unknown) => (typeof v === "number" ? v * k : undefined);
  const floors: SourceFloor[] = (j.floors ?? []).map((f: Json, fi: number) => {
    const rooms = (f.rooms ?? []).flatMap((r: Json, i: number) => {
      const points = (r.points ?? []).map(p).filter(Boolean) as Vec2[];
      return points.length >= 3 ? [{ id: `r${fi}_${i}`, name: String(r.name ?? `Room ${i + 1}`), points, open: points.map(() => false), thick: points.map(() => null) }] : [];
    });
    const opening = (o: Json, type: "door" | "window"): SourceOpening[] => {
      const at = p(o.at);
      return at ? [{ at, width: len(o.width) ?? (type === "door" ? 0.9 : 1.2), height: len(o.height), sill: len(o.sill), type }] : [];
    };
    return {
      name: String(f.name ?? `Floor ${fi + 1}`),
      elevation: len(f.elevation) ?? 0,
      height: len(f.height) ?? 2.5,
      rooms,
      openings: [...(f.doors ?? []).flatMap((o: Json) => opening(o, "door")), ...(f.windows ?? []).flatMap((o: Json) => opening(o, "window"))],
      pieces: (f.furniture ?? []).flatMap((x: Json) => {
        const at = p(x.at);
        return at ? [{ type: String(x.type ?? ""), name: x.name, at, w: len(x.width), d: len(x.depth), h: len(x.height), rotation: num(x.rotation, 0), lift: len(x.elevation) }] : [];
      }),
      pins: [],
      walls: (f.walls ?? []).flatMap((w: Json) => (p(w.from) && p(w.to) ? [{ a: p(w.from)!, b: p(w.to)!, thickness: len(w.thickness), height: len(w.height) }] : [])),
    };
  });
  return { floors, exterior: 0.24, interior: 0.12, centre: j.rooms_at !== "inner" };
}

/** Their furniture kinds (and words in names) to ours. */
const KINDS: [RegExp, FurnitureType][] = [
  [/^(sofa_[lu]|corner_bench)$/, "sofa_corner"],
  [/sofa|couch/i, "sofa"],
  [/armchair/i, "armchair"],
  [/coffee_table/i, "coffee_table"],
  [/^tv|television/i, "tv"],
  [/sideboard|shelf|dresser|book/i, "shelf"],
  [/wardrobe|coat_rack|tall_cabinet|closet/i, "wardrobe"],
  [/plant/i, "plant"],
  [/rug|carpet/i, "rug"],
  [/office_chair|bar_stool|chair/i, "chair"],
  [/stool/i, "stool"],
  [/bench/i, "bench"],
  [/kitchen_wall/i, "kitchen_upper"],
  [/kitchen|island|worktop|stove|dishwasher|oven/i, "kitchen"],
  [/fridge/i, "fridge"],
  [/nightstand/i, "nightstand"],
  [/bunk_bed/i, "bed_single"],
  [/bed/i, "bed"],
  [/bathtub/i, "bathtub"],
  [/shower/i, "shower"],
  [/^wc$|toilet/i, "toilet"],
  [/washbasin|^sink$/i, "sink"],
  [/washer|washing/i, "washer"],
  [/dryer/i, "dryer"],
  [/desk/i, "desk"],
  [/table/i, "table"],
  [/lamp_floor/i, "floor_lamp"],
  [/lamp_table/i, "table_lamp"],
  [/lamp_wall/i, "wall_lamp"],
  [/lamp_fan|ceiling_fan/i, "ceiling_fan"],
  [/tree/i, "tree"],
  [/shrub|bush/i, "bush"],
  [/parking|car/i, "car"],
];
const LAMP: Record<string, LightType> = { lamp_ceiling: "lamp", lamp_panel: "lamp", lamp_pendant: "lamp", lamp_downlight: "spot", lamp_spot: "spot", led_strip: "strip", lamp_uplight: "indirect", lamp_bollard: "lamp", lamp_garden: "lamp" };
const FLOORS: Record<string, string> = { wood: "wood", oak: "oak_herringbone", tiles: "tile", carpet: "carpet", stone: "stone_flags", concrete: "concrete" };

const slug = (text: string, taken: Set<string>) => {
  const base = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "room";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Moves each edge of a room out by its own distance (0 keeps it): the corners where the
 * moved edges meet.
 */
function growEdges(poly: Vec2[], by: number[]): Vec2[] {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nrm = outward(poly, a, b);
    return { p: [a[0] + nrm[0] * by[i], a[1] + nrm[1] * by[i]] as Vec2, d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] as Vec2, nrm };
  });
  return poly.map((v, i) => {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
    if (Math.abs(den) < 1e-9) {
      // a corner on a straight run: moved by the larger of its two edges
      const k = Math.max(by[(i - 1 + n) % n], by[i]);
      return [v[0] + l2.nrm[0] * k, v[1] + l2.nrm[1] * k] as Vec2;
    }
    const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den;
    return [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t] as Vec2;
  });
}

export interface PlanImport {
  house: HouseInput;
  rooms: number;
  /** What could not come along. */
  skipped: string[];
}

/** A plan export (or backup, `.storage` file, simple plan) as a Homeslice house. */
export function planToHouse(text: string, id = "home"): PlanImport {
  let j: Json;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("Not a JSON file.");
  }
  const simple = Array.isArray(j?.floors) && j.floors.some((f: Json) => Array.isArray(f?.doors) || Array.isArray(f?.windows)) && !j.floors.some((f: Json) => Array.isArray(f?.openings));
  const src = simple ? fromSimple(j) : fromBuilding(findBuilding(j));
  const skipped: string[] = [...(src.notes ?? [])];
  const floors = [...src.floors].sort((a, b) => a.elevation - b.elevation).filter((f) => f.rooms.length);
  if (!floors.length) throw new Error("No rooms in this plan.");

  // rooms grown to the outer face (and, measured inside, to the walls' centre lines)
  const grown = floors.map((f) =>
    f.rooms.map((r) => {
      const poly = r.points;
      const by = poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length];
        const n = outward(poly, a, b);
        const m: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 0.06, (a[1] + b[1]) / 2 + n[1] * 0.06];
        const shared = f.rooms.some((o) => o !== r && pointInPolygon(m, o.points));
        if (shared) return src.centre ? 0 : src.interior / 2;
        return r.thick[i] ?? src.exterior;
      });
      return { room: r, poly: normalizeOrientation(growEdges(poly, by)) };
    }),
  );
  // the house's north-west corner at 0, 0
  const all = grown.flat().flatMap((g) => g.poly);
  const { min } = bbox(all);
  const shift = (p: Vec2): Vec2 => [r2(p[0] - min[0]), r2(p[1] - min[1])];

  const taken = new Set<string>();
  const levelIds = new Set<string>();
  const vertical: VerticalInput[] = [];
  const levels: LevelInput[] = floors.map((f, fi) => {
    const next = floors[fi + 1];
    const level: LevelInput = { id: slug(f.haFloor ?? f.name, levelIds), name: f.name, rooms: [] };
    if (f.haFloor) level.floor_id = f.haFloor;
    level.height = r2(next ? Math.max(2, next.elevation - f.elevation - 0.25) : f.height);
    const rooms = grown[fi].map(({ room, poly }) => {
      const out: RoomInput & { poly: Vec2[] } = { id: slug(room.name, taken), name: room.name, polygon: poly.map(shift), poly: poly.map(shift) };
      if (room.areaId) out.area_id = room.areaId;
      if (room.floor && FLOORS[room.floor]) out.floor = FLOORS[room.floor];
      return out;
    });
    const byId = new Map(grown[fi].map((g, i) => [g.room.id, rooms[i]]));
    const roomAt = (p: Vec2) => rooms.filter((r) => pointInPolygon(p, r.poly)).sort((a, b) => area(a.poly) - area(b.poly))[0];
    // open plan: edges without a wall
    const walls: WallInput[] = [];
    f.rooms.forEach((r) => {
      r.open.forEach((open, i) => {
        if (!open) return;
        const a = r.points[i];
        const b = r.points[(i + 1) % r.points.length];
        const m = shift([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        const mine = byId.get(r.id)!;
        const other = rooms.find((o) => o !== mine && edgeNear(o.poly, m));
        if (other && !walls.some((w) => w.between?.includes(mine.id) && w.between?.includes(other.id))) walls.push({ between: [mine.id, other.id] });
      });
    });
    for (const w of f.walls) {
      // a low wall is a railing
      const low = typeof w.height === "number" && w.height <= 1.2;
      walls.push({ line: [shift(w.a), shift(w.b)], ...(low ? { type: "railing" as const } : w.thickness ? { thickness: r2(w.thickness) } : {}) });
    }
    if (walls.length) level.walls = walls;
    // doors and windows: on the room edge they lie on, measured from the room's corner
    const openings: OpeningInput[] = [];
    for (const o of f.openings) {
      const c = shift(o.at);
      const candidates = o.room && byId.get(o.room) ? [byId.get(o.room)!, ...rooms] : rooms;
      const hit = candidates.map((r) => ({ r, e: nearestEdge(r.poly, c) })).find((x) => x.e && x.e.distance < 0.5);
      if (!hit?.e) {
        skipped.push(`${o.type} at ${o.at.map(r2).join(", ")}: on no room edge`);
        continue;
      }
      const side = hit.e.side;
      if (!side) {
        skipped.push(`${o.type} at ${o.at.map(r2).join(", ")}: on a slanted wall`);
        continue;
      }
      const corner = bbox(hit.r.poly).min;
      const along = side === "north" || side === "south" ? c[0] - corner[0] : c[1] - corner[1];
      const op: OpeningInput = { room: hit.r.id, side, at: r2(along - o.width / 2), width: r2(o.width), type: o.type };
      if (o.type !== "opening") {
        if (o.height) op.height = r2(o.height);
        if (o.type === "window" && o.sill !== undefined) op.sill = r2(o.sill);
      }
      const style = openingStyle(o);
      if (style) op.style = style as OpeningInput["style"];
      if (o.hinge === "right") op.hinge = "right";
      if (o.swing === "out") op.swing = "out";
      if (o.cover) op.cover = o.cover;
      if (o.contact) op.contact = o.contact;
      if (o.lock && o.type === "door") op.lock = o.lock;
      openings.push(op);
    }
    if (openings.length) level.openings = openings;
    // furniture, lamps and stairs
    const lights = new Map<RoomInput, LightInput[]>();
    for (const p of f.pieces) {
      const at = shift(p.at);
      const room = roomAt(at);
      if (/^stairs/.test(p.type)) {
        if (!next) continue;
        const turned = Math.round(((p.rotation % 180) + 180) % 180) === 90;
        const [w, d] = turned ? [p.d ?? 1, p.w ?? 1] : [p.w ?? 1, p.d ?? 1];
        // their front (the bottom step) faces the rotation from south: it climbs the other way
        const up = (["north", "east", "south", "west"] as Side[])[Math.round(((p.rotation % 360) + 360) % 360 / 90) % 4];
        vertical.push({ id: `stairs_${vertical.length + 1}`, rect: [r2(at[0] - w / 2), r2(at[1] - d / 2), r2(w), r2(d)], from: level.id, to: "", shape: p.type === "stairs_u" ? "u_turn" : "straight", up });
        continue;
      }
      if (!room) {
        skipped.push(`${p.name ?? p.type}: in no room`);
        continue;
      }
      const corner = bbox(room.poly).min;
      const rel: [number, number] = [r2(at[0] - corner[0]), r2(at[1] - corner[1])];
      if (LAMP[p.type] && p.entity?.startsWith("light.")) {
        const type = LAMP[p.type];
        const l: LightInput = { entity: p.entity, at: rel, ...(type !== "lamp" ? { type } : {}) };
        if (type === "strip") {
          const r = (p.rotation * Math.PI) / 180;
          const half = (p.w ?? 1) / 2;
          l.at = [r2(rel[0] - Math.cos(r) * half), r2(rel[1] - Math.sin(r) * half)];
          l.to = [r2(rel[0] + Math.cos(r) * half), r2(rel[1] + Math.sin(r) * half)];
          if (p.lift) l.height = r2(p.lift);
        }
        lights.set(room, [...(lights.get(room) ?? []), l]);
        continue;
      }
      const type = KINDS.find(([re]) => re.test(p.type) || (p.name ? re.test(p.name) : false))?.[1] ?? "item";
      const piece: FurnitureInput = { type, at: rel };
      if (p.rotation) piece.rotation = ((Math.round(p.rotation) % 360) + 360) % 360;
      if (p.w && p.d) piece.size = [r2(p.w), r2(p.d)];
      if (p.h) piece.height = r2(p.h);
      if (p.lift && p.lift > 0.05) Object.assign(piece, { mount: "wall", elevation: r2(p.lift) });
      if (p.entity) piece.entity = p.entity;
      (room.furniture ??= []).push(piece);
    }
    // entity pins: lights where they hang, cameras with their view; others have no place
    for (const pin of f.pins) {
      const at = shift(pin.at);
      const room = roomAt(at);
      if (!room) continue;
      const corner = bbox(room.poly).min;
      const rel: [number, number] = [r2(at[0] - corner[0]), r2(at[1] - corner[1])];
      if (pin.entity.startsWith("light.")) lights.set(room, [...(lights.get(room) ?? []), { entity: pin.entity, at: rel }]);
      else if (pin.entity.startsWith("camera.")) (room.cameras ??= []).push({ entity: pin.entity, at: rel, direction: (((Math.round(pin.rotation) + 180) % 360) + 360) % 360, ...(pin.fov ? { fov: pin.fov } : {}), ...(pin.reach ? { range: pin.reach } : {}), ...(pin.y ? { height: r2(pin.y) } : {}) });
    }
    for (const [room, list] of lights) room.lights = list;
    level.rooms = rooms.map(({ poly: _p, ...r }) => r);
    return level;
  });
  // stairs arrive on the floor above the one they start on
  for (const v of vertical) {
    const i = levels.findIndex((l) => l.id === v.from);
    v.to = levels[i + 1]?.id ?? "";
  }
  const house: HouseInput = { schema: 1, id, name: "Imported house", walls: { exterior: src.exterior, interior: src.interior }, levels };
  if (vertical.length) house.vertical = vertical.filter((v) => v.to);
  const roof = src.roof?.type;
  if (roof === "flat") house.roof = { shape: "flat" };
  else if (roof === "gable" || roof === "custom") {
    house.roof = { shape: "gable", ...(typeof src.roof?.pitch === "number" ? { pitch: src.roof.pitch } : {}) };
    if (roof === "custom") skipped.push("roof: its own sections came as a plain gable roof");
  }
  return { house: withOutlines(house, (l) => l.rooms.map((r) => (r.polygon ?? []) as Vec2[])), rooms: levels.reduce((n, l) => n + l.rooms.length, 0), skipped };
}

/** The unit normal of edge a–b pointing out of the polygon. */
function outward(poly: Vec2[], a: Vec2, b: Vec2): Vec2 {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n: Vec2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  const m: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 0.01, (a[1] + b[1]) / 2 + n[1] * 0.01];
  return pointInPolygon(m, poly) ? [-n[0], -n[1]] : n;
}

const area = (p: Vec2[]) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;

/** Whether a point lies on one of a polygon's edges. */
function edgeNear(poly: Vec2[], p: Vec2) {
  const e = nearestEdge(poly, p);
  return !!e && e.distance < 0.3;
}

/** The polygon's edge nearest a point, and which side of the room it is (null: slanted). */
function nearestEdge(poly: Vec2[], p: Vec2): { distance: number; side: Side | null } | null {
  let best: { distance: number; side: Side | null } | null = null;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    if (!len2) return;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2));
    const distance = Math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t));
    if (best && distance >= best.distance) return;
    const n = outward(poly, a, b);
    const side: Side | null = Math.abs(n[0]) < 1e-6 ? (n[1] < 0 ? "north" : "south") : Math.abs(n[1]) < 1e-6 ? (n[0] > 0 ? "east" : "west") : null;
    best = { distance, side };
  });
  return best;
}

/** Their door and window styles to ours. */
function openingStyle(o: SourceOpening): string | undefined {
  const two = o.leaves === 2;
  if (o.type === "window") return o.style === "glass_wall" ? "fixed" : two ? "double" : undefined;
  if (o.type !== "door") return undefined;
  switch (o.style) {
    case "front":
      return "entrance_strip";
    case "front_glass":
      return "entrance_panes";
    case "sidelight":
    case "sidelights":
      return "entrance_sidelight";
    case "glass":
      return two ? "glass_double" : "glass";
    case "sliding":
      return "sliding";
    default:
      return two ? "double" : undefined;
  }
}
