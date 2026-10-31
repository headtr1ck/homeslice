#!/usr/bin/env node
// Turns a "Library preview" artifact into a pull request comment (run by the trusted
// "Library preview comment" workflow, never with the pull request's code):
//   node scripts/library-comment.mjs <artifact dir> <published dir> <image base URL>
// It checks the artifact strictly (it comes from a pull request), copies the pictures
// into <published dir> (committed to the library-previews branch by the workflow) and
// prints the comment's Markdown.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir, publish, url] = process.argv.slice(2);
const MARKER = "<!-- homeslice-library-preview -->";
const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?$/;
const MAX_BYTES = 1_000_000;
const SHOWN = 40;

const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
const lists = ["added", "changed", "removed"].map((k) => summary[k]);
if (!lists.every((l) => Array.isArray(l) && l.every((k) => typeof k === "string" && KEY.test(k)))) throw new Error("bad summary");
const [added, changed, removed] = lists;
if (typeof summary.sha !== "string" || !/^[0-9a-f]{0,40}$/.test(summary.sha)) throw new Error("bad sha");
const file = (k) => `${k.replace(/\//g, "__")}.png`;

// only small PNGs with the expected names are published
for (const sub of ["after", "before"]) {
  const src = join(dir, sub);
  if (!existsSync(src)) continue;
  mkdirSync(join(publish, sub), { recursive: true });
  for (const name of readdirSync(src)) {
    const p = join(src, name);
    const head = readFileSync(p).subarray(0, 8);
    if (!/^[A-Za-z0-9_-]+\.png$/.test(name) || statSync(p).size > MAX_BYTES || head.toString("hex") !== "89504e470d0a1a0a") throw new Error(`unexpected file ${sub}/${name}`);
    copyFileSync(p, join(publish, sub, name));
  }
}

const img = (sub, k) => `<img src="${url}/${sub}/${file(k)}" width="120" alt="${k}">`;
const grid = (keys, cell) => {
  const rows = [];
  for (let i = 0; i < Math.min(keys.length, SHOWN); i += 4) rows.push(`| ${keys.slice(i, i + 4).map(cell).join(" | ")} |`);
  const head = `| ${Array(Math.min(4, keys.length)).fill(" ").join(" | ")} |\n|${Array(Math.min(4, keys.length)).fill("---").join("|")}|`;
  return `${head}\n${rows.join("\n")}${keys.length > SHOWN ? `\n\n…and ${keys.length - SHOWN} more.` : ""}`;
};

let body = `${MARKER}\n### Furniture library preview\n\n`;
if (!added.length && !changed.length && !removed.length) body += "No library pictures changed.\n";
if (added.length) body += `**Added (${added.length})**\n\n${grid(added, (k) => `${img("after", k)}<br><sub>${k}</sub>`)}\n\n`;
if (changed.length) body += `**Changed (${changed.length})**: before → after\n\n${grid(changed, (k) => `${img("before", k)} ${img("after", k)}<br><sub>${k}</sub>`)}\n\n`;
if (removed.length) body += `**Removed (${removed.length})**: ${removed.map((k) => `\`${k}\``).join(", ")}\n\n`;
body += `<sub>Rendered from ${summary.sha ? `\`${String(summary.sha).slice(0, 7)}\`` : "this pull request"} by the Library preview workflow; the full library is in the run's \`library-preview\` artifact (library.html).</sub>\n`;
process.stdout.write(body);
