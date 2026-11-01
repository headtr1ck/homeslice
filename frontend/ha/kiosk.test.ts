import { describe, expect, it } from "vitest";
import type { Hass } from "./hass";
import { clockText, isNight } from "./kiosk";

const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
const sun = (state: string) => ({ states: { "sun.sun": { state } } }) as unknown as Hass;

describe("night", () => {
  it("follows the sun", () => {
    expect(isNight("sun", sun("below_horizon"), at(12))).toBe(true);
    expect(isNight("sun", sun("above_horizon"), at(23))).toBe(false);
  });
  it("takes a time range, also over midnight", () => {
    expect(isNight("22:00-06:00", undefined, at(23))).toBe(true);
    expect(isNight("22:00-06:00", undefined, at(5, 59))).toBe(true);
    expect(isNight("22:00-06:00", undefined, at(6))).toBe(false);
    expect(isNight("13:00-14:30", undefined, at(14, 15))).toBe(true);
    expect(isNight("off", undefined, at(23))).toBe(false);
    expect(isNight("later", undefined, at(23))).toBe(false);
  });
});

describe("clock", () => {
  it("writes 24 or 12 hours as HA says", () => {
    expect(clockText({ locale: { language: "de", time_format: "24" } } as unknown as Hass, at(21, 5))).toBe("21:05");
    expect(clockText({ locale: { language: "en", time_format: "12" } } as unknown as Hass, at(21, 5))).toMatch(/09:05\sPM/);
  });
});
