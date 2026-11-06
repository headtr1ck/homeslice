// When a piece is shown (`visible_during`): a festival or season by name, or a range of
// days in the year ("12-01/01-06"). Festivals that follow a lunar calendar (Ramadan,
// Hanukkah, Lunar New Year) are read from the browser's calendars (Intl), so they move
// with the year like the real thing.

/** The named seasons, in the order the editor lists them. */
export const SEASONS = [
  "christmas",
  "new_year",
  "lunar_new_year",
  "valentines",
  "carnival",
  "st_patricks",
  "holi",
  "easter",
  "passover",
  "ramadan",
  "eid_al_adha",
  "pride",
  "independence_day_us",
  "mid_autumn",
  "halloween",
  "day_of_the_dead",
  "diwali",
  "thanksgiving",
  "sinterklaas",
  "hanukkah",
  "spring",
  "summer",
  "autumn",
  "winter",
] as const;
export type Season = (typeof SEASONS)[number];

const RANGE = /^(\d\d)-(\d\d)\/(\d\d)-(\d\d)$/;
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A range of days "MM-DD/MM-DD" as [[month, day], [month, day]], or null. */
export function dayRange(spec: string): [[number, number], [number, number]] | null {
  const m = RANGE.exec(spec);
  if (!m) return null;
  const [a, b, c, d] = m.slice(1).map(Number);
  const ok = (mo: number, da: number) => mo >= 1 && mo <= 12 && da >= 1 && da <= DAYS[mo - 1];
  return ok(a, b) && ok(c, d) ? [[a, b], [c, d]] : null;
}

/** A valid `visible_during`: a season's name or a range of days. */
export function isSeasonSpec(spec: unknown): spec is string {
  return typeof spec === "string" && ((SEASONS as readonly string[]).includes(spec) || dayRange(spec) !== null);
}

// ----- dates: whole days, as UTC noon so no time zone moves them -----

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));
const addDays = (t: Date, n: number) => new Date(t.getTime() + n * 86400000);
const sameOrAfter = (t: Date, a: Date) => t.getTime() >= a.getTime();
const between = (t: Date, a: Date, b: Date) => sameOrAfter(t, a) && sameOrAfter(b, t);

/** Easter Sunday (Gregorian, the anonymous algorithm). */
export function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return day(y, month, ((h + l - 7 * m + 114) % 31) + 1);
}

/** The n-th given weekday (0 Sunday) of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): Date {
  const first = day(y, m, 1);
  return addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + 7 * (n - 1));
}

/** The first Sunday of Advent: the Sunday from 27 November to 3 December. */
const advent = (y: number) => addDays(day(y, 11, 27), (7 - day(y, 11, 27).getUTCDay()) % 7);

/** A day in another calendar: its month (number, or name for the Hebrew one) and day. */
function inCalendar(t: Date, calendar: string, month: "numeric" | "long" = "numeric"): { month: string; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { timeZone: "UTC", month, day: "numeric" }).formatToParts(t);
    const mo = parts.find((p) => p.type === "month")?.value;
    const da = Number(parts.find((p) => p.type === "day")?.value);
    return mo && da ? { month: mo, day: da } : null;
  } catch {
    return null;
  }
}

/** New moons near a date: mean lunations from 6 January 2000, 18:14 UTC (good to a day). */
function newMoonNear(t: Date): Date {
  const epoch = Date.UTC(2000, 0, 6, 18, 14);
  const month = 29.530588853 * 86400000;
  const n = Math.round((t.getTime() - epoch) / month);
  const at = new Date(epoch + n * month);
  return day(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** Diwali: the new moon from 17 October to 15 November (the main night), ± two days. */
function diwali(y: number): Date {
  const moon = newMoonNear(day(y, 11, 1));
  if (moon.getTime() < day(y, 10, 17).getTime()) return addDays(moon, 30);
  if (moon.getTime() > day(y, 11, 15).getTime()) return addDays(moon, -30);
  return moon;
}

/** Holi: the full moon from 25 February to 26 March (the day after it). */
function holi(y: number): Date {
  const full = addDays(newMoonNear(day(y, 3, 10)), 15);
  if (full.getTime() < day(y, 2, 25).getTime()) return addDays(full, 30);
  if (full.getTime() > day(y, 3, 26).getTime()) return addDays(full, -30);
  return full;
}

/** Whether a day of the year lies in a range that may run over New Year. */
function inDays(t: Date, [[m1, d1], [m2, d2]]: [[number, number], [number, number]]): boolean {
  const md = (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
  const a = m1 * 100 + d1;
  const b = m2 * 100 + d2;
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}

/**
 * Whether `spec` holds on this day (the viewer's local date). `south`: the house is in the
 * southern hemisphere, which turns spring, summer, autumn and winter round.
 */
export function inSeason(spec: string, now: Date, south = false): boolean {
  const t = day(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const y = t.getUTCFullYear();
  const range = dayRange(spec);
  if (range) return inDays(t, range);
  const flip = (north: [[number, number], [number, number]], other: [[number, number], [number, number]]) => inDays(t, south ? other : north);
  switch (spec as Season) {
    case "christmas":
      // from the first Sunday of Advent to Epiphany
      return sameOrAfter(t, advent(y)) || inDays(t, [[1, 1], [1, 6]]);
    case "new_year":
      return inDays(t, [[12, 31], [1, 1]]);
    case "lunar_new_year": {
      // from the Little New Year (23rd of the 12th month) to the Lantern Festival (15th of the 1st)
      const c = inCalendar(t, "chinese");
      return !!c && ((c.month === "12" && c.day >= 23) || (c.month === "1" && c.day <= 15));
    }
    case "valentines":
      return inDays(t, [[2, 7], [2, 14]]);
    case "carnival": {
      // from the Thursday before Lent to Ash Wednesday
      const e = easter(y);
      return between(t, addDays(e, -52), addDays(e, -46));
    }
    case "st_patricks":
      return inDays(t, [[3, 10], [3, 17]]);
    case "holi": {
      const h = holi(y);
      return between(t, addDays(h, -1), addDays(h, 1));
    }
    case "easter": {
      // from Palm Sunday to Easter Monday
      const e = easter(y);
      return between(t, addDays(e, -7), addDays(e, 1));
    }
    case "passover": {
      const c = inCalendar(t, "hebrew", "long");
      return !!c && c.month === "Nisan" && c.day >= 14 && c.day <= 22;
    }
    case "ramadan": {
      // the month of Ramadan and the three days of Eid al-Fitr
      const c = inCalendar(t, "islamic-umalqura");
      return !!c && (c.month === "9" || (c.month === "10" && c.day <= 3));
    }
    case "eid_al_adha": {
      const c = inCalendar(t, "islamic-umalqura");
      return !!c && c.month === "12" && c.day >= 9 && c.day <= 13;
    }
    case "pride":
      return inDays(t, [[6, 1], [6, 30]]);
    case "independence_day_us":
      return inDays(t, [[6, 28], [7, 4]]);
    case "mid_autumn": {
      const c = inCalendar(t, "chinese");
      return !!c && c.month === "8" && c.day >= 12 && c.day <= 16;
    }
    case "halloween":
      return inDays(t, [[10, 1], [11, 1]]);
    case "day_of_the_dead":
      return inDays(t, [[10, 28], [11, 2]]);
    case "diwali": {
      const d = diwali(y);
      return between(t, addDays(d, -2), addDays(d, 2));
    }
    case "thanksgiving": {
      // the week up to the fourth Thursday of November, and its weekend
      const th = nthWeekday(y, 11, 4, 4);
      return between(t, addDays(th, -6), addDays(th, 3));
    }
    case "sinterklaas":
      // from his arrival in mid-November to 5 December
      return inDays(t, [[11, 15], [12, 5]]);
    case "hanukkah": {
      // eight nights from 25 Kislev; the candles are out from the eve before
      const c = inCalendar(t, "hebrew", "long");
      return !!c && ((c.month === "Kislev" && c.day >= 24) || (c.month === "Tevet" && c.day <= 3));
    }
    case "spring":
      return flip([[3, 1], [5, 31]], [[9, 1], [11, 30]]);
    case "summer":
      return flip([[6, 1], [8, 31]], [[12, 1], [2, 29]]);
    case "autumn":
      return flip([[9, 1], [11, 30]], [[3, 1], [5, 31]]);
    case "winter":
      return flip([[12, 1], [2, 29]], [[6, 1], [8, 31]]);
  }
  return false;
}

/** What a conditional piece waits for, as one key: its entity, its season, or both. */
export const conditionKey = (f: { visibleWhen?: string; visibleDuring?: string }): string | null =>
  f.visibleWhen || f.visibleDuring ? [f.visibleWhen, f.visibleDuring].filter(Boolean).join(" & ") : null;
