// What is left to do in a house, with a one-click fix where the fix is clear: rooms for
// HA areas, blinds and contact sensors linked to their windows, walls that almost line up.

import type { Hass } from "../ha/hass";
import { areaEntities } from "../ha/hass";
import { expandHouse } from "../model/expand";
import { misalignedWalls } from "../model/checks";
import type { HouseInput, OpeningSource, Side } from "../model/types";
import { deriveWalls } from "../model/walls";
import { updateOpening } from "./ops";

export type CheckItem =
  | { kind: "area"; level: string; area: string; name: string }
  | { kind: "cover" | "contact"; entity: string; level?: string; room?: string; target?: { level: string; source: OpeningSource; room: string; side: Side }; fix?: HouseInput }
  | { kind: "wall" | "model"; level?: string; message: string };

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

  // 1. areas of a level's floors without a room
  for (const l of model.levels) {
    const placed = new Set(l.rooms.map((r) => r.area_id));
    for (const a of levelAreas(l.id)) if (!placed.has(a.area_id)) items.push({ kind: "area", level: l.id, area: a.area_id, name: a.name });
  }

  // 2. blinds and contacts not linked: suggest a free window of a room in their area
  const openings = house.levels.flatMap((level) => level.openings.map((o) => ({ level: level.id, o, areaId: level.rooms.find((r) => r.id === o.room)?.areaId })));
  const usedCovers = new Set([...openings.map((x) => x.o.cover), ...house.levels.flatMap((l) => l.rooms.map((r) => r.awning))].filter(Boolean));
  const usedContacts = new Set(openings.map((x) => x.o.contact).filter(Boolean));
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

  // 3. walls that almost line up with the wall below, and the model's own warnings
  const walls = new Map(house.levels.map((l) => [l.id, deriveWalls(l, house.walls, [])]));
  for (const i of misalignedWalls(house, walls)) items.push({ kind: "wall", level: i.path.split(".")[1], message: i.message });
  for (const i of issues) items.push({ kind: "model", level: i.path.startsWith("levels.") ? i.path.split(".")[1] : undefined, message: i.message });
  return items;
}

/** Every suggested link at once. */
export function applyAll(model: HouseInput, items: CheckItem[]): HouseInput {
  let m = model;
  for (const i of items) if ((i.kind === "cover" || i.kind === "contact") && i.target) m = updateOpening(m, i.target.level, i.target.source, i.kind === "cover" ? { cover: i.entity } : { contact: i.entity });
  return m;
}
