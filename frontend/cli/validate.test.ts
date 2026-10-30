// Validates every private house file in houses/ (skipped when there are none).
// Run: npx vitest run frontend/cli
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { expandHouse } from "../model/expand";
import { deriveWalls } from "../model/walls";
import type { Issue } from "../model/types";

const dir = "houses";
const files = existsSync(dir) ? readdirSync(dir).filter((f: string) => f.endsWith(".yaml")) : [];

describe.skipIf(files.length === 0)("house files", () => {
  it.each(files)("%s is valid", (file: string) => {
    const { house, issues } = expandHouse(parse(readFileSync(`${dir}/${file}`, "utf8")));
    const all: Issue[] = [...issues];
    for (const level of house?.levels ?? []) {
      const walls = deriveWalls(level, house!.walls, all);
      const count = (t: string) => walls.filter((w) => w.type === t).length;
      const openings = walls.reduce((n, w) => n + w.openings.length, 0);
      console.log(`${file} ${level.id}: ${count("exterior")} exterior, ${count("party")} party, ${count("interior")} interior walls, ${openings}/${level.openings.length} openings placed`);
    }
    for (const i of all) console.log(`${i.severity}: ${i.path}: ${i.message}`);
    expect(all.filter((i) => i.severity === "error")).toEqual([]);
  });
});
