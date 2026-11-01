// Editor checks that aren't errors: things that are probably drawing slips.

import type { House, Issue, Vec2 } from "./types";
import type { Wall } from "./walls";

/** Walls closer than this to a parallel wall on the level below, but not on it, are flagged. */
const NEAR = 0.15;
const SAME = 0.005;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

/**
 * Walls that almost line up with a wall on the level below (within 15 cm, overlapping
 * along their length): stacked walls should sit exactly on top of each other.
 */
export function misalignedWalls(house: House, walls: Map<string, Wall[]>, roomName: (levelId: string, roomId: string) => string = (_, r) => r): Issue[] {
  const issues: Issue[] = [];
  house.levels.forEach((level, i) => {
    if (i === 0) return;
    const below = house.levels[i - 1];
    const lower = (walls.get(below.id) ?? []).filter((w) => w.type !== "open");
    for (const w of walls.get(level.id) ?? []) {
      if (w.type === "open") continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (len < 0.3) continue;
      const dir: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const normal: Vec2 = [-dir[1], dir[0]];
      let best: number | null = null;
      for (const o of lower) {
        const olen = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
        if (olen < 0.3) continue;
        const odir: Vec2 = [(o.b[0] - o.a[0]) / olen, (o.b[1] - o.a[1]) / olen];
        if (Math.abs(Math.abs(dot(dir, odir)) - 1) > 1e-3) continue;
        // overlapping along the wall?
        const t0 = dot(sub(o.a, w.a), dir);
        const t1 = dot(sub(o.b, w.a), dir);
        if (Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) < 0.3) continue;
        const off = Math.abs(dot(sub(o.a, w.a), normal));
        if (off < SAME) {
          best = null;
          break; // it does sit on a wall below
        }
        if (off < NEAR && (best === null || off < best)) best = off;
      }
      if (best === null) continue;
      const where = w.rooms.length ? w.rooms.map((r) => roomName(level.id, r)).join(" / ") : (w.side ?? "outside");
      issues.push({
        severity: "warning",
        path: `levels.${level.id}`,
        message: `The wall ${where} is ${Math.round(best * 100)} cm off the wall below. Drag it onto the wall below (it snaps to it) if they should line up.`,
      });
    }
  });
  return issues;
}

/**
 * Whether every room can be reached: the house needs an entrance (a door or an opening on
 * an outside wall, or onto a garden or terrace), and each room a way to it through doors,
 * openings, open walls and stairs. Rooms nobody can walk into are probably a missing door.
 */
export function unreachableRooms(house: House, walls: Map<string, Wall[]>, roomName: (levelId: string, roomId: string) => string = (_, r) => r): Issue[] {
  const key = (l: string, r: string) => `${l}/${r}`;
  const next = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (next.get(a) ?? next.set(a, new Set()).get(a)!).add(b);
    (next.get(b) ?? next.set(b, new Set()).get(b)!).add(a);
  };
  const entrances = new Set<string>();
  const rooms: { level: string; id: string; polygon: Vec2[] }[] = [];
  for (const level of house.levels) {
    if (level.kind === "roof") continue;
    const kind = new Map(level.rooms.map((r) => [r.id, r.kind]));
    for (const r of level.rooms) if (r.kind === "room") rooms.push({ level: level.id, id: r.id, polygon: r.polygon });
    for (const w of walls.get(level.id) ?? []) {
      const passable = w.type === "open" || w.openings.some((o) => o.type !== "window" || o.sill < 0.1);
      if (!passable) continue;
      const inside = w.rooms.filter((r) => kind.get(r) === "room");
      // outside: a wall with a room on one side only, or onto a garden or terrace
      const outside = w.rooms.length < 2 || w.rooms.some((r) => kind.get(r) === "outdoor");
      if (inside.length === 2) link(key(level.id, inside[0]), key(level.id, inside[1]));
      if (outside && w.type !== "party") for (const r of inside) entrances.add(key(level.id, r));
    }
  }
  // stairs join the rooms they start and end in (or that touch them)
  const near = (poly: Vec2[], hole: Vec2[]) => {
    const xs = hole.map((p) => p[0]);
    const ys = hole.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3, Math.min(...ys) - 0.3, Math.max(...ys) + 0.3];
    return poly.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1) || [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].some((p) => inside(p as Vec2, poly));
  };
  for (const v of house.vertical) {
    if (v.kind !== "stairs") continue;
    const ends = [house.levels[v.from], house.levels[v.to]].filter(Boolean);
    const touched = ends.flatMap((l) => rooms.filter((r) => r.level === l.id && near(r.polygon, v.polygon)).map((r) => key(r.level, r.id)));
    for (let i = 1; i < touched.length; i++) link(touched[0], touched[i]);
  }
  if (!rooms.length) return [];
  if (!entrances.size) return [{ severity: "warning", path: "levels", message: "The house has no entrance: put a door on an outside wall (or onto a garden or terrace)." }];
  const seen = new Set(entrances);
  const queue = [...entrances];
  while (queue.length) for (const n of next.get(queue.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
  return rooms
    .filter((r) => !seen.has(key(r.level, r.id)))
    .map((r) => ({ severity: "warning" as const, path: `levels.${r.level}.rooms.${r.id}`, message: `${roomName(r.level, r.id)} can't be reached from an entrance: add a door (or open the wall) to a room next to it.` }));
}

function inside([x, y]: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Pieces that reach more than 5 cm into a wall (often placed from the room's outline, not
 * the wall's inside face): they look flat or half gone.
 */
export function piecesInWalls(house: House, walls: Map<string, Wall[]>, roomName: (levelId: string, roomId: string) => string = (_, r) => r): Issue[] {
  const issues: Issue[] = [];
  for (const level of house.levels) {
    const bodies = (walls.get(level.id) ?? [])
      .filter((w) => w.type !== "open")
      .map((w) => {
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
        const u: Vec2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
        return { w, u, len };
      });
    for (const room of level.rooms) {
      if (room.kind !== "room") continue;
      room.furniture.forEach((f, i) => {
        // (pieces on a wall hang on its face; ceiling pieces are above it all)
        if (f.mount !== "floor") return;
        // the footprint 5 cm smaller all round, at its corners and edge middles
        const th = (f.rotation * Math.PI) / 180;
        const [c, s] = [Math.cos(th), Math.sin(th)];
        const hw = Math.max(0, f.size[0] / 2 - 0.05);
        const hd = Math.max(0, f.size[1] / 2 - 0.05);
        const pts: Vec2[] = [[-hw, -hd], [0, -hd], [hw, -hd], [hw, 0], [hw, hd], [0, hd], [-hw, hd], [-hw, 0]].map(([x, y]) => [f.at[0] + x * c - y * s, f.at[1] + x * s + y * c]);
        const hit = bodies.some(({ w, u, len }) =>
          pts.some((p) => {
            const d = sub(p, w.a);
            const along = dot(d, u);
            const across = Math.abs(d[0] * -u[1] + d[1] * u[0]);
            return along > -w.extendStart && along < len + w.extendEnd && across < w.thickness / 2;
          }),
        );
        if (hit) issues.push({ severity: "warning", path: `levels.${level.id}.rooms.${room.id}.furniture.${i}`, message: `A ${f.type.replace(/_/g, " ")} in ${roomName(level.id, room.id)} reaches into a wall: move it out to the wall's inside face.` });
      });
    }
  }
  return issues;
}
