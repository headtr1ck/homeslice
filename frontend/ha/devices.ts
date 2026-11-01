// Pieces linked to a device other than a light: what their state looks like in the house
// (a TV's screen, a fire, a fan turning, a washer running, curtains with their cover), and
// which kind of entity a piece is usually linked to.
import type { DeviceLook } from "../render/scene";
import { coverOpen, type Hass } from "./hass";

const OFF = new Set(["off", "standby", "idle", "unavailable", "unknown", "closed", "docked", "none", "0", "false", "not_charging", "disconnected", "finished", "complete", "ready"]);
const RUNNING = new Set(["on", "playing", "running", "heating", "cooling", "drying", "charging", "washing", "rinsing", "spinning", "fan", "heat", "cool", "dry", "heat_cool", "auto", "fan_only", "open", "home"]);

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
    case "media_player":
      return { on: !OFF.has(state), active: state === "playing" };
    case "climate":
    case "water_heater": {
      // what it does right now (hvac_action), else what it is set to
      const action = String(s.attributes.hvac_action ?? state);
      const tone = action.startsWith("heat") || action === "preheating" ? "heat" : action.startsWith("cool") ? "cool" : null;
      const on = state !== "off";
      return { on, active: on && !["idle", "off"].includes(action), tone };
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

/** The domain a built-in piece is usually linked to, for the editor's entity picker. */
export function linkDomain(type: string, kind: string | undefined): string | undefined {
  if (["floor_lamp", "table_lamp", "wall_lamp", "ceiling_lamp"].includes(type)) return "light";
  if (type === "tv") return "media_player";
  if (type === "ceiling_fan") return "fan";
  if (type === "washer") return "sensor";
  if (!kind) return undefined;
  if (/^(ac_|heat_pump|radiator|towel_radiator)/.test(kind)) return "climate";
  if (/^(fan_|air_purifier)/.test(kind)) return "fan";
  if (kind === "dehumidifier") return "humidifier";
  if (/^(curtains|blind)/.test(kind)) return "cover";
  if (/^(tv_|monitor|projector|speaker)/.test(kind)) return "media_player";
  if (/^(fireplace|fire_pit)/.test(kind)) return "switch";
  if (/^(garden_light|string_lights|lantern|aquarium)/.test(kind)) return "light";
  if (/^(smoke_detector|leak_sensor|motion_sensor|contact_sensor)/.test(kind)) return "binary_sensor";
  if (kind === "thermostat") return "climate";
  if (kind === "climate_sensor") return "sensor";
  if (kind === "smart_plug") return "switch";
  if (/^(doorbell_camera|security_camera)/.test(kind)) return "camera";
  if (kind === "smart_speaker") return "media_player";
  if (kind === "keypad") return "alarm_control_panel";
  if (/^(washer|dryer|kitchen_dishwasher|wallbox|water_heater)/.test(kind)) return "sensor";
  return undefined;
}
