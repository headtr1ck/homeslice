// Little notes above linked pieces: bins on pickup day, thirsty plants, post in the
// mailbox, an appliance's time left. Nothing shows while nothing needs attention.

import type { Hass } from "./hass";

export interface Badge {
  icon: string;
  /** A text key (card.badge_*) and its values, or a ready text. */
  key?: "pickup_today" | "pickup_tomorrow" | "plant" | "post" | "time_left";
  vars?: Record<string, string | number>;
  /** Needs doing now (stronger colour). */
  urgent: boolean;
}

const minutes = (value: number, unit: string) => (unit === "h" ? value * 60 : unit === "s" ? value / 60 : unit === "d" ? value * 1440 : value);

/** The note for a piece linked to an entity, or null. `kind` is the piece's model kind. */
export function pieceBadge(hass: Hass, entity: string, kind = ""): Badge | null {
  const s = hass.states[entity];
  if (!s || s.state === "unavailable" || s.state === "unknown") return null;
  const domain = entity.split(".")[0];
  const a = s.attributes;
  if (domain === "plant") {
    if (s.state !== "problem") return null;
    // which reading is off: moisture first (water it), else whatever the plant says
    const off = Object.entries(a).filter(([k, v]) => k.endsWith("_status") && typeof v === "string" && v.toLowerCase() !== "ok");
    const moisture = String(a.moisture_status ?? "").toLowerCase();
    return { icon: moisture === "low" ? "mdi:water-alert" : "mdi:flower-pollen-outline", key: "plant", vars: { what: off.map(([k, v]) => `${k.replace(/_status$/, "")} ${String(v).toLowerCase()}`).join(", ") || "problem" }, urgent: moisture === "low" };
  }
  if (domain === "binary_sensor") {
    // a mailbox: post in it
    return /mail|letter|post/.test(kind + entity) && s.state === "on" ? { icon: "mdi:email-alert", key: "post", urgent: false } : null;
  }
  if (domain === "sensor" || domain === "calendar") {
    const unit = String(a.unit_of_measurement ?? "");
    const n = Number(s.state);
    // a waste collection: days until pickup (Waste Collection Schedule's daysTo, or a duration in days)
    const days = typeof a.daysTo === "number" ? a.daysTo : unit === "d" && Number.isFinite(n) ? n : null;
    if (days !== null) return days === 0 ? { icon: "mdi:delete-alert", key: "pickup_today", urgent: true } : days === 1 ? { icon: "mdi:delete-clock", key: "pickup_tomorrow", urgent: false } : null;
    // an appliance's time left
    if (a.device_class === "duration" && Number.isFinite(n) && n > 0 && ["min", "h", "s"].includes(unit)) {
      const m = Math.round(minutes(n, unit));
      return m > 0 ? { icon: "mdi:timer-sand", key: "time_left", vars: { time: m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }, urgent: false } : null;
    }
  }
  return null;
}
