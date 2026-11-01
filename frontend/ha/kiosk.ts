// Wall tablets: when it is night for the card, and the clock's text.

import type { Hass } from "./hass";

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Night by `sun` (sun.sun below the horizon) or a time range like `22:00-06:00` (may pass midnight). */
export function isNight(night: string | undefined, hass: Hass | undefined, now: Date): boolean {
  if (!night || night === "off") return false;
  if (night === "sun") return hass?.states["sun.sun"]?.state === "below_horizon";
  const range = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(night.trim());
  if (!range) return false;
  const from = minutes(range[1]);
  const to = minutes(range[2]);
  const m = now.getHours() * 60 + now.getMinutes();
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

/** The time as HA's settings say (language, 12 or 24 hours). */
export function clockText(hass: Hass | undefined, now: Date): string {
  const format = (hass?.locale as { time_format?: string } | undefined)?.time_format;
  const hour12 = format === "12" ? true : format === "24" ? false : undefined;
  try {
    return new Intl.DateTimeFormat(hass?.locale?.language, { hour: "2-digit", minute: "2-digit", hour12 }).format(now);
  } catch {
    return now.toTimeString().slice(0, 5);
  }
}
