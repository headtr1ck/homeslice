// Time travel: the last hours from Home Assistant's history, and what every entity was at
// a moment in them. Nothing is stored; the card asks again each time it opens.

import type { Hass, HassEntityState } from "./hass";

/** Domains whose history the house shows: lights, blinds, doors and windows, devices. */
export const HISTORY_DOMAINS = ["light", "cover", "binary_sensor", "media_player", "climate", "fan", "switch", "vacuum", "lawn_mower", "lock", "device_tracker", "person"];

interface Change {
  t: number;
  s: string;
  a?: Record<string, unknown>;
}

export interface History {
  start: number;
  end: number;
  series: Map<string, Change[]>;
  /** Moments worth jumping to: doors, motion, lights switching (newest last). */
  events: { t: number; entity: string; state: string }[];
}

type Raw = Record<string, { s: string; a?: Record<string, unknown>; lu?: number; lc?: number }[]>;

/** Reads the history of these entities over the last `hours`. */
export async function loadHistory(hass: Hass, entityIds: string[], hours = 24, now = Date.now()): Promise<History> {
  const start = now - hours * 3600000;
  const raw = entityIds.length
    ? ((await hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(now).toISOString(),
        entity_ids: entityIds,
        minimal_response: false,
        no_attributes: false,
        significant_changes_only: false,
      })) as Raw | null)
    : null;
  return fromRaw(raw ?? {}, start, now);
}

/** The websocket's compressed answer as series per entity, and the events in it. */
export function fromRaw(raw: Raw, start: number, end: number): History {
  const series = new Map<string, Change[]>();
  const events: History["events"] = [];
  for (const [entity, list] of Object.entries(raw)) {
    let attributes: Record<string, unknown> | undefined;
    const changes: Change[] = [];
    for (const x of list) {
      attributes = x.a ?? attributes;
      const t = ((x.lu ?? x.lc ?? 0) as number) * 1000;
      changes.push({ t, s: x.s, a: attributes });
      const prev = changes.length > 1 ? changes[changes.length - 2].s : undefined;
      if (prev !== undefined && prev !== x.s && t >= start && /^(binary_sensor|light|cover|lock|media_player)\./.test(entity)) events.push({ t, entity, state: x.s });
    }
    series.set(entity, changes);
  }
  events.sort((a, b) => a.t - b.t);
  return { start, end, series, events };
}

/** Every state as it was at `t`: the history's where it has one, else today's. */
export function statesAt(hass: Hass, history: History, t: number): Record<string, HassEntityState> {
  const out = { ...hass.states };
  for (const [entity, changes] of history.series) {
    let last: Change | undefined;
    for (const c of changes) {
      if (c.t > t) break;
      last = c;
    }
    if (!last) continue;
    const now = hass.states[entity];
    out[entity] = { ...(now ?? { entity_id: entity }), entity_id: entity, state: last.s, attributes: last.a ?? now?.attributes ?? {} } as HassEntityState;
  }
  return out;
}
