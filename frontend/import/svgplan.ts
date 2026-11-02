// An SVG floor plan (as used by Lovelace floor-plan cards) to a Homeslice house: closed
// shapes become rooms (named by their label or id), shapes whose id names an entity
// (light.kitchen) become that entity at their middle. SVG units are scaled so the drawing
// is as wide as the person says; y points down in both, so north stays up.
import { wallSnap } from "../editor/ops";
import { bbox, normalizeOrientation } from "../model/geometry";
import type { FurnitureInput, HouseInput, LevelInput, RoomInput, Vec2 } from "../model/types";

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, [x, y]: Vec2): Vec2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** An element's transform attribute (translate, scale, rotate, matrix; several in a row). */
function transformOf(el: Element): Matrix {
  let m = IDENTITY;
  for (const [, fn, args] of (el.getAttribute("transform") ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Matrix = IDENTITY;
    if (fn === "translate") t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "matrix" && a.length === 6) t = a as Matrix;
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
    m = multiply(m, t);
  }
  return m;
}

/** The transform from an element's own units to the drawing's (its groups' transforms too). */
function ctm(el: Element): Matrix {
  const chain: Element[] = [];
  for (let e: Element | null = el; e && e.tagName.toLowerCase() !== "svg"; e = e.parentElement) chain.unshift(e);
  return chain.reduce((m, e) => multiply(m, transformOf(e)), IDENTITY);
}

/** A path's corners (straight segments; curves by their end points), if it is closed. */
function pathPoints(d: string): { points: Vec2[]; closed: boolean } {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points: Vec2[] = [];
  let i = 0;
  let cmd = "";
  let at: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let closed = false;
  const n = () => Number(tokens[i++]);
  // arguments per command, and which of them is the end point
  const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const c = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (c === "z") {
      closed = true;
      at = start;
      continue;
    }
    const count = ARGS[c];
    if (!count) break;
    const args = Array.from({ length: count }, n);
    if (args.some((v) => Number.isNaN(v))) break;
    let next: Vec2;
    if (c === "h") next = [rel ? at[0] + args[0] : args[0], at[1]];
    else if (c === "v") next = [at[0], rel ? at[1] + args[0] : args[0]];
    else {
      const [x, y] = args.slice(-2);
      next = rel ? [at[0] + x, at[1] + y] : [x, y];
    }
    if (c === "m") {
      start = next;
      // a second shape in the same path: only the first counts
      if (points.length) break;
      // after a move, more pairs are lines
      cmd = rel ? "l" : "L";
    }
    points.push(next);
    at = next;
  }
  return { points, closed };
}

/** An element's corners in drawing units, and whether it encloses an area. */
function shapeOf(el: Element): { points: Vec2[]; closed: boolean } | null {
  const tag = el.tagName.toLowerCase();
  const f = (name: string) => Number(el.getAttribute(name) ?? 0);
  let points: Vec2[] = [];
  let closed = true;
  if (tag === "rect") {
    const [x, y, w, h] = [f("x"), f("y"), f("width"), f("height")];
    if (!(w > 0 && h > 0)) return null;
    points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  } else if (tag === "polygon" || tag === "polyline") {
    const v = (el.getAttribute("points") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i], v[i + 1]]);
    closed = tag === "polygon";
  } else if (tag === "path") {
    ({ points, closed } = pathPoints(el.getAttribute("d") ?? ""));
  } else if (tag === "circle" || tag === "ellipse") {
    const [cx, cy] = [f("cx"), f("cy")];
    const [rx, ry] = tag === "circle" ? [f("r"), f("r")] : [f("rx"), f("ry")];
    points = [[cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry]];
    closed = false; // a marker, not a room
  } else return null;
  if (points.length < 2) return null;
  const m = ctm(el);
  return { points: points.map((p) => apply(m, p)), closed };
}

const ENTITY = /^(light|switch|binary_sensor|sensor|cover|climate|media_player|fan|lock|camera|vacuum)\.[a-z0-9_]+$/;

/** The entity an element stands for: its id, or one of its classes. */
function entityOf(el: Element): string | null {
  const id = el.getAttribute("id") ?? "";
  if (ENTITY.test(id)) return id;
  for (const c of (el.getAttribute("class") ?? "").split(/\s+/)) if (ENTITY.test(c)) return c;
  return null;
}

const area = (p: Vec2[]) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;

function slug(text: string, taken: Set<string>) {
  const base = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "room";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

export interface SvgImport {
  house: HouseInput;
  rooms: number;
  entities: number;
}

/**
 * The house in an SVG drawing that is `width` metres wide: one level, a room per closed
 * shape (bigger than a square metre, smaller than the whole drawing), lights and other
 * linked elements placed in the room under them.
 */
export function svgToHouse(svg: string, width: number, id = "home"): SvgImport {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.querySelector("svg");
  if (!root || doc.querySelector("parsererror")) throw new Error("Not an SVG drawing.");
  const shapes = [...root.querySelectorAll("rect, polygon, polyline, path, circle, ellipse")]
    .filter((el) => !el.closest("defs, clipPath, mask, symbol, pattern, marker"))
    .map((el) => ({ el, shape: shapeOf(el), entity: entityOf(el) ?? (el.parentElement ? entityOf(el.parentElement) : null) }))
    .filter((s): s is { el: Element; shape: { points: Vec2[]; closed: boolean }; entity: string | null } => !!s.shape);
  const all = shapes.flatMap((s) => s.shape.points);
  if (!all.length) throw new Error("No shapes in this drawing.");
  const { min, max } = bbox(all);
  const k = width / Math.max(1e-6, max[0] - min[0]);
  const toPlan = ([x, y]: Vec2): Vec2 => [Math.round((x - min[0]) * k * 100) / 100, Math.round((y - min[1]) * k * 100) / 100];
  const total = (max[0] - min[0]) * (max[1] - min[1]) * k * k;
  const taken = new Set<string>();
  const rooms: (RoomInput & { poly: Vec2[] })[] = [];
  for (const s of shapes) {
    if (s.entity || !s.shape.closed) continue;
    const poly = normalizeOrientation(s.shape.points.map(toPlan));
    const a = area(poly);
    // not specks, and not the frame around the whole drawing
    if (a < 1 || a > total * 0.85) continue;
    const label = s.el.getAttribute("inkscape:label") ?? s.el.querySelector("title")?.textContent ?? s.el.getAttribute("id") ?? "";
    const name = label && !/^(rect|path|polygon)\d*$/i.test(label) ? label : `Room ${rooms.length + 1}`;
    rooms.push({ id: slug(name, taken), name, polygon: poly, poly });
  }
  // inside first: a point in a room nested in another belongs to the smaller one
  const byArea = [...rooms].sort((a, b) => area(a.poly) - area(b.poly));
  const inside = ([x, y]: Vec2, p: Vec2[]) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  };
  let entities = 0;
  const seen = new Set<string>();
  for (const s of shapes) {
    if (!s.entity || seen.has(s.entity)) continue;
    seen.add(s.entity);
    const b = bbox(s.shape.points.map(toPlan));
    const at: Vec2 = [Math.round(((b.min[0] + b.max[0]) / 2) * 100) / 100, Math.round(((b.min[1] + b.max[1]) / 2) * 100) / 100];
    const room = byArea.find((r) => inside(at, r.poly));
    if (!room) continue;
    const corner = bbox(room.poly).min;
    const local = (p: Vec2): [number, number] => [Math.round((p[0] - corner[0]) * 100) / 100, Math.round((p[1] - corner[1]) * 100) / 100];
    entities++;
    if (s.entity.startsWith("light.")) (room.lights ??= []).push({ entity: s.entity, at: local(at) });
    else if (s.entity.startsWith("sensor.") || s.entity.startsWith("binary_sensor.")) {
      // a sensor hangs on the nearest wall
      const onWall = wallSnap(room.poly, at, 0.02);
      const piece: FurnitureInput = { type: "item", model: "modern:climate_sensor", at: local(onWall?.at ?? at), mount: "wall", size: [0.06, 0.02], height: 0.06, entity: s.entity, ...(onWall?.rotation ? { rotation: onWall.rotation } : {}) };
      (room.furniture ??= []).push(piece);
    } else (room.furniture ??= []).push({ type: s.entity.startsWith("media_player.") ? "tv" : "item", at: local(at), entity: s.entity });
  }
  const level: LevelInput = { id: "ground", name: "Ground floor", rooms: rooms.map(({ poly: _p, ...r }) => r) };
  const plan = bbox(rooms.flatMap((r) => r.poly).concat([[0, 0]]));
  const house: HouseInput = {
    schema: 1,
    id,
    outline: { rect: [0, 0, Math.round(plan.max[0] * 100) / 100, Math.round(plan.max[1] * 100) / 100] },
    levels: [level],
  };
  return { house, rooms: rooms.length, entities };
}
