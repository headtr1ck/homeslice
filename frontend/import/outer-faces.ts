// Plans measured on the outside of the house, put on wall centre lines.
//
// The importers read plans whose outline is the outer face of the outside walls (they grow
// inwards from it), and whose rooms along the outside reach that face; everything else is
// on wall centre lines. A house file puts every line on a wall centre: the outline too,
// and the outside walls are centred on it like any other. The importers mark what they
// build `schema: 1` and hand it here, which returns the house file (schema 2).

import { bbox, dist, edgeNormal, labelPoint, offsetEdges, pointInPolygon, project } from "../model/geometry";
import type { Coord, HouseInput, LevelInput, RoomInput, ShapeInput, Side, Vec2, WallThickness } from "../model/types";
import { roomsOutline } from "../model/faces";
import { facadeHalves } from "../model/walls";

/** The schema files are written in. */
export const SCHEMA = 2;

const NEAR = 0.005;
// a room side starting on the outline, at most this far off it at its other end and this
// steep (about 6°), is meant to be on it
const SLIP = 0.3;
const SLANT = 0.1;
const DEFAULT_WALLS: WallThickness = { exterior: 0.36, interior: 0.12, party: 0.24 };
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * An imported plan (marked schema 1) as a house file, the house standing exactly where it stood: each outline
 * moves in by half its walls, with the corners of the rooms inside on it, and whatever is
 * measured from a room's or the outline's north-west corner (doors and windows, furniture,
 * façade openings) keeps its place. Anything else comes back as it is.
 */
export function onWallCentres<T>(input: T): T {
  const h = input as unknown as HouseInput;
  if (!h || typeof h !== "object" || (h as { schema?: unknown }).schema !== 1 || !Array.isArray(h.levels)) return input;
  try {
    return migrate(structuredClone(h)) as unknown as T;
  } catch {
    // (a broken file: the validation says what is wrong with it)
    return input;
  }
}

function migrate(h: HouseInput): HouseInput {
  const thickness: WallThickness = { ...DEFAULT_WALLS, ...(h.walls ?? {}) };
  const coord = (c: Coord, axis: "x" | "y"): number => {
    if (typeof c === "number") return c;
    const v = h.grid?.[axis]?.[c];
    if (typeof v !== "number") throw new Error(`grid ${axis} ${c}`);
    return v;
  };
  const corners = (s: ShapeInput | undefined): Vec2[] | null => {
    if (s?.rect) {
      const [x, y, w, d] = s.rect;
      const [x0, y0] = [coord(x, "x"), coord(y, "y")];
      return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]];
    }
    if (Array.isArray(s?.polygon)) return s.polygon.map(([x, y]) => [coord(x, "x"), coord(y, "y")]);
    return null;
  };
  // a rect stays a rect while it is one (corners in the rect's order)
  const write = <S extends ShapeInput>(s: S, pts: Vec2[]): S => {
    const p = pts.map(([x, y]) => [round(x), round(y)] as Vec2);
    const isRect = p.length === 4 && p[0][1] === p[1][1] && p[1][0] === p[2][0] && p[2][1] === p[3][1] && p[3][0] === p[0][0] && p[1][0] > p[0][0] && p[3][1] > p[0][1];
    const { rect: _rect, polygon: _polygon, ...rest } = s;
    return (isRect ? { ...rest, rect: [p[0][0], p[0][1], round(p[1][0] - p[0][0]), round(p[3][1] - p[0][1])] } : { ...rest, polygon: p }) as S;
  };

  const ownAuto = (l: LevelInput) => l.outline === "auto" || (h.outline === "auto" && !l.outline);
  const houseShape = h.outline && h.outline !== "auto" ? (h.outline as ShapeInput) : null;
  // the outline each level uses: its own, the house's, or its rooms' outer edge
  type Scope = { levels: LevelInput[]; poly: Vec2[]; write: ((pts: Vec2[]) => void) | null; party: Side[] };
  const scopes: Scope[] = [];
  const shared = h.levels.filter((l) => !l.outline && !ownAuto(l));
  if (houseShape && shared.length) {
    const poly = corners(houseShape);
    if (poly) scopes.push({ levels: shared, poly, party: h.party_walls ?? [], write: (pts) => (h.outline = write(houseShape, pts)) });
  }
  for (const l of h.levels) {
    if (l.outline && l.outline !== "auto") {
      const own = l.outline as ShapeInput;
      const poly = corners(own);
      if (poly) scopes.push({ levels: [l], poly, party: l.party_walls ?? h.party_walls ?? [], write: (pts) => (l.outline = write(own, pts)) });
    } else if (ownAuto(l)) {
      const poly = autoOutline(l, corners);
      if (poly.length) scopes.push({ levels: [l], poly, party: l.party_walls ?? h.party_walls ?? [], write: null });
    }
  }

  // façade openings are measured from the house outline's corner (else the first level's)
  const facadeScope = scopes.find((s) => houseShape && s.levels === shared) ?? scopes.find((s) => s.levels.includes(h.levels[0])) ?? scopes[0];
  let facadeShift: Vec2 = [0, 0];

  for (const scope of scopes) {
    const { poly } = scope;
    // no wall where every level of it has a terrace or a loggia behind the edge
    const outdoor = scope.levels.map((l) => (l.rooms ?? []).filter((r) => r.kind === "outdoor").map((r) => corners(r)).filter((p): p is Vec2[] => !!p));
    const open = (p: Vec2) => outdoor.every((rooms) => rooms.some((r) => pointInPolygon(p, r)));
    const halves = facadeHalves(poly, scope.party, thickness, open);
    const moved = offsetEdges(poly, halves.map((d) => -d));
    // a room side along an outline edge: on it, or (a slip) starting on it and leaning off
    // it a little, which moves in the same way
    const along = (p: Vec2, q: Vec2) =>
      poly.findIndex((a, i) => {
        const b = poly[(i + 1) % poly.length];
        const [pp, pq] = [project(p, a, b), project(q, a, b)];
        const within = (pr: typeof pp, d: number) => pr.distance < d && pr.t > -NEAR && pr.t < pr.length + NEAR;
        if (within(pp, NEAR) && within(pq, NEAR)) return true;
        const length = dist(p, q);
        const leaning = length > 0.5 && Math.abs(pp.distance - pq.distance) / length < SLANT;
        return leaning && (within(pp, NEAR) || within(pq, NEAR)) && within(pp, SLIP) && within(pq, SLIP);
      });
    /**
     * A room's corners with its sides along the outline moved in by half their wall: each
     * corner where its two sides' lines meet again; where a moved side meets one that stays
     * in line with it (an outside wall turning into an inside one), a small step.
     */
    const moveRoom = (pts: Vec2[], keepEdges: boolean): Vec2[] => {
      // the outline's corners lying on the room's sides become corners of the room
      let ring = pts;
      if (!keepEdges)
        ring = pts.flatMap((p, j) => {
          const q = pts[(j + 1) % pts.length];
          const on = poly
            .map((c) => ({ c, pr: project(c, p, q) }))
            .filter(({ pr }) => pr.distance < NEAR && pr.t > NEAR && pr.t < pr.length - NEAR)
            .sort((x, y) => x.pr.t - y.pr.t)
            .map(({ c }) => c);
          return [p, ...on];
        });
      const n = ring.length;
      const shift = ring.map((p, j): Vec2 => {
        const i = along(p, ring[(j + 1) % n]);
        if (i < 0) return [0, 0];
        const k = edgeNormal(poly, i);
        return [-k[0] * halves[i], -k[1] * halves[i]];
      });
      const out: Vec2[] = [];
      ring.forEach((p, j) => {
        const pj = (j - 1 + n) % n;
        const [a1, b1] = [ring[pj], p].map((x) => [x[0] + shift[pj][0], x[1] + shift[pj][1]] as Vec2);
        const [a2, b2] = [p, ring[(j + 1) % n]].map((x) => [x[0] + shift[j][0], x[1] + shift[j][1]] as Vec2);
        const d1: Vec2 = [b1[0] - a1[0], b1[1] - a1[1]];
        const d2: Vec2 = [b2[0] - a2[0], b2[1] - a2[1]];
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) > 1e-9) {
          const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
          out.push([a1[0] + d1[0] * t, a1[1] + d1[1] * t]);
        } else if (dist(b1, a2) < 1e-9) out.push(b1);
        else {
          // in line, one side moved: step where the outline's corner went
          const c = poly.findIndex((x) => dist(x, p) < NEAR);
          const q = c >= 0 ? moved[c] : b1;
          const foot = (x: Vec2, a: Vec2, d: Vec2): Vec2 => {
            const t = ((x[0] - a[0]) * d[0] + (x[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1);
            return [a[0] + d[0] * t, a[1] + d[1] * t];
          };
          out.push(foot(q, a1, d1), foot(q, a2, d2));
        }
      });
      if (keepEdges) return out;
      // corners added that ended up in a straight side again go
      const clean = out.filter((p, j) => dist(p, out[(j + 1) % out.length]) > 1e-6);
      return clean.filter((p, j) => {
        const a = clean[(j - 1 + clean.length) % clean.length];
        const b = clean[(j + 1) % clean.length];
        return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9;
      });
    };
    for (const l of scope.levels) {
      l.rooms = (l.rooms ?? []).map((r) => {
        const pts = corners(r);
        // gardens and balconies outside stay where they are
        if (!pts || !pointInPolygon(labelPoint(pts), poly)) return r;
        // (a curved room keeps its corners, so its curves stay on their edges)
        const next = moveRoom(pts, !!r.curves?.length);
        if (next.length === pts.length && next.every((p, i) => dist(p, pts[i]) < 1e-9)) return r;
        const before = bbox(pts).min;
        const after = bbox(next).min;
        const shift: Vec2 = [round(before[0] - after[0]), round(before[1] - after[1])];
        const room: RoomInput = write(r, next);
        // pieces are placed from the room's north-west corner
        const by = (p: Vec2): Vec2 => (Array.isArray(p) ? [round(p[0] + shift[0]), round(p[1] + shift[1])] : p);
        if (room.furniture && (shift[0] || shift[1])) room.furniture = room.furniture.map((f) => ({ ...f, at: by(f.at) }));
        // and its lights (a strip's end, a row's spots) and cameras
        if (room.lights && (shift[0] || shift[1]))
          room.lights = room.lights.map((x) => ({ ...x, ...(x.at ? { at: by(x.at) } : {}), ...(x.to ? { to: by(x.to) } : {}), ...(x.spots ? { spots: x.spots.map(by) } : {}) }));
        if (room.cameras && (shift[0] || shift[1])) room.cameras = room.cameras.map((c) => ({ ...c, at: by(c.at) }));
        // so are its doors and windows, along their side
        if (shift[0] || shift[1])
          l.openings = (l.openings ?? []).map((o) => (o.room === r.id && typeof o.at === "number" ? { ...o, at: round(o.at + shift[o.side === "north" || o.side === "south" ? 0 : 1]) } : o));
        return room;
      });
    }
    if (scope.write) scope.write(moved);
    if (scope === facadeScope) {
      const before = bbox(poly).min;
      const after = bbox(moved).min;
      facadeShift = [before[0] - after[0], before[1] - after[1]];
    }
  }
  if (h.facade_openings && (facadeShift[0] || facadeShift[1]))
    h.facade_openings = h.facade_openings.map((f) => (typeof f.at === "number" ? { ...f, at: round(f.at + facadeShift[f.side === "north" || f.side === "south" ? 0 : 1]) } : f));
  (h as { schema: number }).schema = SCHEMA;
  return h;
}

/** A level's rooms' outer edge (as `outline: auto` takes it), from their corners. */
function autoOutline(l: LevelInput, corners: (s: ShapeInput | undefined) => Vec2[] | null): Vec2[] {
  const polys = (l.rooms ?? []).filter((r) => r.kind !== "outdoor").map((r) => corners(r)).filter((p): p is Vec2[] => !!p);
  return polys.length ? roomsOutline(polys) : [];
}
