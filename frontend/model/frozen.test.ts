// The beta's promise: a house saved by a release (tests/frozen/<version>/) opens in every
// later one, as it was: no errors, and every built-in piece and choice it names still known.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { expandHouse } from "./expand";
import { MODERN, resolveKind } from "./modern";
import type { HouseInput } from "./types";

const files = readdirSync("tests/frozen").flatMap((v) => readdirSync(`tests/frozen/${v}`).filter((f) => f.endsWith(".yaml")).map((f) => `${v}/${f}`));

describe("houses saved by earlier releases", () => {
  it("there are some", () => expect(files.length).toBeGreaterThan(5));
  it.each(files)("%s opens", (file) => {
    const model = parse(readFileSync(`tests/frozen/${file}`, "utf8")) as HouseInput;
    const { house, issues } = expandHouse(model);
    expect(issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`)).toEqual([]);
    for (const f of house!.levels.flatMap((l) => l.rooms.flatMap((r) => r.furniture))) {
      if (!f.model?.startsWith("modern:")) continue;
      const { id, options } = resolveKind(f.model.slice(7), f.options);
      expect(MODERN[id], f.model).toBeDefined();
      for (const [k, v] of Object.entries(options)) expect(MODERN[id].options?.[k], `${f.model} ${k}: ${v}`).toContain(v);
    }
  });
});
