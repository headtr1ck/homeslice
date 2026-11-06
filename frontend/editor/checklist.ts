// What is left to do in a house, with a one-click fix where the fix is clear: rooms for
// HA areas, blinds and contact sensors linked to their windows, walls that almost line up.

import type { Hass } from "../ha/hass";
import { areaEntities } from "../ha/hass";
import { expandHouse } from "../model/expand";
import { misalignedWalls, piecesInWalls, unreachableRooms } from "../model/checks";
import type { HouseInput, OpeningSource, Side } from "../model/types";
import { deriveWalls } from "../model/walls";
import { besideOutline, updateOpening } from "./ops";

export type CheckItem =
  | { kind: "area"; level: string; area: string; name: string }
  | { kind: "cover" | "contact"; entity: string; level?: string; room?: string; target?: { level: string; source: OpeningSource; room: string; side: Side }; fix?: HouseInput }
  | { kind: "wall" | "model"; level?: string; message: string }
  | { kind: "beside"; level: string; rooms: string[]; off: number; fix: HouseInput };

/** Words for the sides of a house in entity names (English and German). */
const SIDE_WORDS: Record<Side, RegExp> = {
  north: /north|nord/i,
  south: /south|süd|sued/i,
  east: /east|\bost/i,
  west: /west/i,
};

const BLINDS = ["blind", "shutter", "curtain", "shade", "awning"];
/** Door sensors of appliances aren't doors of the house. */
const APPLIANCES = /fridge|refrigerator|freezer|k(ü|ue)hl|gefrier|dishwasher|sp(ü|ue)l|oven|ofen|washer|wasch|dryer|trockner|mailbox|briefkasten|car\b|auto\b/i;
const CONTACTS = ["window", "door", "opening", "garage_door"];

/**
 * The checklist. `levelAreas` gives each level's HA areas (its floor's and those of the
 * floors it includes).
 */
export function checklist(model: HouseInput, hass: Hass, levelAreas: (levelId: string) => { area_id: string; name: string }[]): CheckItem[] {
  const items: CheckItem[] = [];
  const { house, issues } = expandHouse(model);
  if (!house) return issues.map((i) => ({ kind: "model" as const, message: i.message }));

  // 1. areas of a level's floors without a room…
  for (const l of model.levels) {
    const placed = new Set(l.rooms.map((r) => r.area_id));
    for (const a of levelAreas(l.id)) if (!placed.has(a.area_id)) items.push({ kind: "area", level: l.id, area: a.area_id, name: a.name });
  }
  // …and areas on no floor (all of them, in a Home Assistant without floors) without a room
  // anywhere: on the level without a floor, else the first
  const inHouse = new Set(model.levels.flatMap((l) => l.rooms.map((r) => r.area_id)));
  const home = model.levels.find((l) => !l.floor_id) ?? model.levels[0];
  if (home)
    for (const a of Object.values(hass.areas ?? {}).sort((x, y) => x.name.localeCompare(y.name)))
      if (!a.floor_id && !inHouse.has(a.area_id)) items.push({ kind: "area", level: home.id, area: a.area_id, name: a.name });

  // 2. blinds and contacts not linked: suggest a free window of a room in their area
  const openings = house.levels.flatMap((level) => level.openings.map((o) => ({ level: level.id, o, areaId: level.rooms.find((r) => r.id === o.room)?.areaId })));
  // (inside blinds and roof windows' shutters and contacts are linked too)
  const roofWindows = [...house.roof.windows, ...house.levels.flatMap((l) => l.roofs.flatMap((p) => p.windows))];
  const usedCovers = new Set([...openings.flatMap((x) => [x.o.cover, x.o.blind]), ...house.levels.flatMap((l) => l.rooms.map((r) => r.awning)), ...roofWindows.map((w) => w.cover)].filter(Boolean));
  const usedContacts = new Set([...openings.map((x) => x.o.contact), ...roofWindows.map((w) => w.contact)].filter(Boolean));
  const taken = new Set<string>();
  const link = (kind: "cover" | "contact", entity: string) => {
    const name = String(hass.states[entity]?.attributes.friendly_name ?? entity);
    const deviceClass = String(hass.states[entity]?.attributes.device_class ?? "");
    const areaId = Object.keys(hass.areas ?? {}).find((a) => areaEntities(hass, a, entity.split(".")[0]).includes(entity));
    const free = openings.filter(
      (x) =>
        x.areaId === areaId &&
        !(kind === "cover" ? x.o.cover : x.o.contact) &&
        !taken.has(`${kind}:${x.level}:${x.o.id}`) &&
        // door sensors on doors, window sensors on windows
        (kind === "cover" || deviceClass === "opening" || (deviceClass === "window" ? x.o.type === "window" : x.o.type !== "window")),
    );
    // a name that says a side ("Studio north") only fits a window on that side
    const named = (Object.keys(SIDE_WORDS) as Side[]).some((side) => SIDE_WORDS[side].test(name));
    const bySide = free.filter((x) => SIDE_WORDS[x.o.side].test(name));
    const pick = bySide.length === 1 ? bySide[0] : !named && free.length === 1 ? free[0] : null;
    const room = areaId ? house.levels.flatMap((l) => l.rooms.map((r) => ({ level: l.id, r }))).find((x) => x.r.areaId === areaId) : undefined;
    if (!pick) {
      items.push({ kind, entity, level: room?.level, room: room?.r.id });
      return;
    }
    taken.add(`${kind}:${pick.level}:${pick.o.id}`);
    items.push({ kind, entity, level: pick.level, room: pick.o.room, target: { level: pick.level, source: pick.o.source, room: pick.o.room, side: pick.o.side }, fix: updateOpening(model, pick.level, pick.o.source, kind === "cover" ? { cover: entity } : { contact: entity }) });
  };
  const states = Object.values(hass.states ?? {});
  for (const s of states)
    if (s.entity_id.startsWith("cover.") && BLINDS.includes(String(s.attributes.device_class)) && !usedCovers.has(s.entity_id)) link("cover", s.entity_id);
  for (const s of states)
    if (
      s.entity_id.startsWith("binary_sensor.") &&
      CONTACTS.includes(String(s.attributes.device_class)) &&
      !usedContacts.has(s.entity_id) &&
      !APPLIANCES.test(`${s.entity_id} ${s.attributes.friendly_name ?? ""}`)
    )
      link("contact", s.entity_id);

  // 3. room sides just inside an outside wall: two walls side by side
  for (const l of model.levels) {
    const b = besideOutline(model, l.id);
    if (b) items.push({ kind: "beside", level: l.id, rooms: b.rooms, off: b.off, fix: b.fixed });
  }

  // 4. walls that almost line up with the wall below, and the model's own warnings
  const walls = new Map(house.levels.map((l) => [l.id, deriveWalls(l, house.walls, [])]));
  for (const i of misalignedWalls(house, walls)) items.push({ kind: "wall", level: i.path.split(".")[1], message: i.message });
  const roomName = (l: string, r: string) => house.levels.find((x) => x.id === l)?.rooms.find((x) => x.id === r)?.name ?? r;
  for (const i of unreachableRooms(house, walls, roomName)) items.push({ kind: "wall", level: i.path.startsWith("levels.") ? i.path.split(".")[1] : undefined, message: i.message });
  for (const i of piecesInWalls(house, walls, roomName)) items.push({ kind: "wall", level: i.path.split(".")[1], message: i.message });
  for (const i of issues) items.push({ kind: "model", level: i.path.startsWith("levels.") ? i.path.split(".")[1] : undefined, message: i.message });
  return items;
}

/** Every suggested link at once. */
export function applyAll(model: HouseInput, items: CheckItem[]): HouseInput {
  let m = model;
  for (const i of items) if ((i.kind === "cover" || i.kind === "contact") && i.target) m = updateOpening(m, i.target.level, i.target.source, i.kind === "cover" ? { cover: i.entity } : { contact: i.entity });
  return m;
}
