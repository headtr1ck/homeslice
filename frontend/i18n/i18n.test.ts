import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatNumber, localize } from "./localize";

const load = (f: string) => JSON.parse(readFileSync(`frontend/i18n/${f}`, "utf8")) as Record<string, string>;
const en = load("en.json");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  for (const file of readdirSync("frontend/i18n").filter((f) => f.endsWith(".json") && f !== "en.json")) {
    it(`${file} has every key, with the same placeholders`, () => {
      const t = load(file);
      expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) expect([key, placeholders(t[key])]).toEqual([key, placeholders(en[key])]);
    });
  }
  it("picks the language, falls back to English", () => {
    expect(localize("de", "card.all_floors")).not.toBe(localize("en", "card.all_floors"));
    expect(localize("de-AT", "card.all_floors")).toBe(localize("de", "card.all_floors"));
    expect(localize("xx", "card.all_floors")).toBe(en["card.all_floors"]);
  });
  it("writes numbers like the user's settings", () => {
    expect(formatNumber({ language: "de" }, 1234.5, 2)).toBe("1234,50");
    expect(formatNumber({ language: "en" }, 3.14159, 2)).toBe("3.14");
    expect(formatNumber({ language: "de", number_format: "comma_decimal" }, 2.5, 1)).toBe("2.5");
    expect(formatNumber({ language: "en", number_format: "decimal_comma" }, 2.5, 1)).toBe("2,5");
    expect(formatNumber({ language: "de", number_format: "none" }, 2.5, 1)).toBe("2.5");
    expect(formatNumber(undefined, -0.5, 0)).toMatch(/^-?0$|^-1$/);
  });
});
