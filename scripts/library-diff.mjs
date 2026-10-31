#!/usr/bin/env node
// Compares the furniture library's pictures of two checkouts (each rendered with
// scripts/thumbnails.mjs) and collects what a pull request adds, changes or removes:
//   node scripts/library-diff.mjs <base dir> <head dir> <out dir>
// Writes <out>/summary.json and the pictures (<out>/after/…, <out>/before/…) for the
// "Library preview" comment. PR and SHA come from the environment (PR_NUMBER, HEAD_SHA).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [base, head, out] = process.argv.slice(2);
if (!base || !head || !out) {
  console.error("usage: library-diff.mjs <base dir> <head dir> <out dir>");
  process.exit(2);
}

/** Library pictures of a checkout: key (e.g. "modern/sofa") → file. */
function pictures(dir) {
  const root = join(dir, "assets/thumbs");
  const found = new Map();
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".png")) found.set(relative(root, p).slice(0, -4), p);
    }
  };
  walk(root);
  return found;
}

const before = pictures(base);
const after = pictures(head);
const same = (a, b) => readFileSync(a).equals(readFileSync(b));
const added = [...after.keys()].filter((k) => !before.has(k)).sort();
const removed = [...before.keys()].filter((k) => !after.has(k)).sort();
const changed = [...after.keys()].filter((k) => before.has(k) && !same(before.get(k), after.get(k))).sort();

const file = (k) => `${k.replace(/\//g, "__")}.png`;
mkdirSync(join(out, "after"), { recursive: true });
mkdirSync(join(out, "before"), { recursive: true });
for (const k of [...added, ...changed]) copyFileSync(after.get(k), join(out, "after", file(k)));
for (const k of [...changed, ...removed]) copyFileSync(before.get(k), join(out, "before", file(k)));
writeFileSync(join(out, "summary.json"), JSON.stringify({ pr: Number(process.env.PR_NUMBER ?? 0), sha: process.env.HEAD_SHA ?? "", added, changed, removed }, null, 1));
console.log(`library pictures: ${added.length} added, ${changed.length} changed, ${removed.length} removed`);
