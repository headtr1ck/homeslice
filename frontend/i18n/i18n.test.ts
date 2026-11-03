import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatNumber, loadLanguage, localize } from "./localize";

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
  it("every editor tool has its name and its hint", () => {
    // keys built from a tool's name (`editor.help_${tool}`) are not checked by the compiler
    const panel = readFileSync("frontend/editor/homeslice-panel.ts", "utf8");
    const tools = [...panel.matchAll(/\{ tool: "(\w+)", icon:/g)].map((m) => m[1]);
    expect(tools).toContain("balcony");
    for (const tool of tools) expect([tool, `editor.tool_${tool}` in en, `editor.help_${tool}` in en]).toEqual([tool, true, true]);
  });
  it("every English string is used somewhere (keys built from a prefix count as used)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [`${dir}/${e.name}`] : []));
    const src = files("frontend").map((f) => readFileSync(f, "utf8")).join("\n");
    // `editor.tool_${tool}` and the like: every key starting so may be meant
    const prefixes = [...src.matchAll(/`([a-z_]+\.[A-Za-z0-9_.]*?)\$\{/g)].map((m) => m[1]);
    // (the stairs' shapes are built from their names, but only these are left)
    const built = (k: string) => prefixes.some((p) => k.startsWith(p) && !(p === "editor.stairs_" && !["editor.stairs_spiral", "editor.stairs_curved"].includes(k) && !/^editor\.stairs_[a-z]+_/.test(k)));
    const unused = Object.keys(en).filter((k) => !src.includes(`"${k}"`) && !src.includes(`\`${k}\``) && !built(k));
    expect(unused).toEqual([]);
  });
  it("picks the language, falls back to English", () => {
    expect(localize("de", "card.all_floors")).not.toBe(localize("en", "card.all_floors"));
    expect(localize("de-AT", "card.all_floors")).toBe(localize("de", "card.all_floors"));
    expect(localize("xx", "card.all_floors")).toBe(en["card.all_floors"]);
  });
  it("loads other languages when first needed", async () => {
    expect(localize("fr", "card.all_floors")).toBe(en["card.all_floors"]);
    expect(await loadLanguage("fr-CA")).toBe(true);
    expect(localize("fr-CA", "card.all_floors")).toBe(load("fr.json")["card.all_floors"]);
    expect(await loadLanguage("fr")).toBe(false);
    expect(await loadLanguage("de")).toBe(false);
    expect(await loadLanguage("xx")).toBe(false);
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
