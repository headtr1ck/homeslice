// Pieces linked to a device other than a light: what their state looks like in the house
// (a TV's screen, a fire, a fan turning, a washer running, curtains with their cover), and
// which kind of entity a piece is usually linked to.
import type { DeviceLook } from "../render/scene";
import { kindTags, TAG_DOMAINS } from "../model/modern";
import type { FurnitureType } from "../model/types";
import { coverOpen, type Hass } from "./hass";

const OFF = new Set(["off", "standby", "idle", "unavailable", "unknown", "closed", "docked", "none", "0", "false", "not_charging", "disconnected", "finished", "complete", "ready"]);
const RUNNING = new Set(["on", "playing", "running", "heating", "cooling", "drying", "charging", "washing", "rinsing", "spinning", "fan", "heat", "cool", "dry", "heat_cool", "auto", "fan_only", "open", "home", "printing"]);

/**
 * A linked entity's look: on and active (playing, running, heating), a cover's position,
 * the heating or cooling colour, a fan's speed; null when the entity is missing.
 */
export function deviceLook(hass: Hass, entityId: string, inverted = false): DeviceLook | null {
  const s = hass.states[entityId];
  if (!s || s.state === "unavailable" || s.state === "unknown") return null;
  const domain = entityId.split(".")[0];
  const state = s.state.toLowerCase();
  switch (domain) {
    case "cover": {
      const open = coverOpen(hass, entityId, inverted);
      return { on: (open ?? 1) > 0, active: false, open };
    }
    case "media_player": {
      // the cover art of what plays or is paused
      const picture = ["playing", "paused"].includes(state) ? ((s.attributes.entity_picture as string | undefined) ?? null) : null;
      return { on: !OFF.has(state), active: state === "playing", picture };
    }
    case "climate":
    case "water_heater": {
      // what it does right now (hvac_action), else what it is set to
      const action = String(s.attributes.hvac_action ?? state);
      const tone = action.startsWith("heat") || action === "preheating" ? "heat" : action.startsWith("cool") ? "cool" : null;
      const on = state !== "off";
      return { on, active: on && !["idle", "off"].includes(action), tone };
    }
    case "device_tracker":
    case "person": {
      // a car or bike on its spot while it is home
      const home = state === "home";
      return { on: home, active: false, present: home };
    }
    case "image": {
      // a picture frame: the image entity's picture
      return { on: true, active: false, picture: (s.attributes.entity_picture as string | undefined) ?? null };
    }
    case "fan": {
      const pct = s.attributes.percentage;
      return { on: state === "on", active: state === "on", speed: typeof pct === "number" ? pct / 100 : null };
    }
    case "sensor": {
      // a power sensor: running above a few watts; otherwise a state like "running"
      const n = Number(state);
      if (!Number.isNaN(n)) return { on: n > 2, active: n > 2 };
      return { on: !OFF.has(state), active: RUNNING.has(state) || !OFF.has(state) };
    }
    case "binary_sensor": {
      // alarms (smoke, water, gas…) light up red, other sensors green while on
      const alarm = ["smoke", "moisture", "gas", "carbon_monoxide", "safety", "problem", "tamper"].includes(String(s.attributes.device_class));
      return { on: state === "on", active: state === "on", tone: alarm && state === "on" ? "alarm" : null };
    }
    default:
      return { on: !OFF.has(state), active: RUNNING.has(state) || !OFF.has(state) };
  }
}

/** The domain a built-in piece is usually linked to, for the editor's entity picker: by its tags. */
export function linkDomain(type: string, kind: string | undefined): string | undefined {
  for (const tag of kindTags(kind, type as FurnitureType)) if (TAG_DOMAINS[tag]) return TAG_DOMAINS[tag];
  return undefined;
}
