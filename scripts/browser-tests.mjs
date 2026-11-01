// Runs the browser tests (scripts/browser-test.mjs) in several processes side by side, each
// with a share of the sections, and prints their results in order. Build first
// (`npm run test:browser` does). `node scripts/browser-tests.mjs [section ...]` runs only
// those sections (their names as the test file prints them).
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// the two big pages on their own, the rest in groups of about the same length
// (the CI job names in .github/workflows/ci.yml describe these groups: keep them in step)
const SHARDS = [
  ["demo house, roof"],
  ["editor"],
  ["demo house", "demo house, camera controls", "demo house, energy", "demo house, looks"],
  ["demo house, white model and blueprint", "demo house, following events", "demo house, low quality", "demo house, heatmap", "demo house, all floors side by side", "demo house, lux", "demo house, tilted plan", "demo house, floor plan", "demo house, German", "demo house, phone", "demo house, outdoor areas hidden", "demo house, per-level camera"],
  ["editor, phone", "editor, unsaved changes", "editor, starting from scratch", "private"],
];
// `--shard N`: just that group (CI runs each group as its own job); else sections by name, else all
const args = process.argv.slice(2);
const shardAt = args.indexOf("--shard");
const shards = shardAt >= 0 ? [SHARDS[Number(args[shardAt + 1])]] : args.length ? [args] : SHARDS;
if (shards.some((x) => !x)) throw new Error(`no such shard (0–${SHARDS.length - 1})`);
// one browser per core is plenty (software rendering is heavy)
const limit = Math.max(1, Math.min(shards.length, Math.floor(cpus().length / 2)));

const run = (sections) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, "browser-test.mjs")], { env: { ...process.env, BT_ONLY: sections.join("|") } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code, output }));
  });

const started = Date.now();
const results = new Array(shards.length);
let next = 0;
await Promise.all(
  Array.from({ length: limit }, async () => {
    while (next < shards.length) {
      const i = next++;
      results[i] = await run(shards[i]);
    }
  }),
);
let failed = 0;
for (const r of results) {
  // the sections' own lines, without each process's summary
  process.stdout.write(r.output.replace(/\n*(all passed|\d+ failed)\s*$/, "\n"));
  if (r.code !== 0) failed += Number(/(\d+) failed\s*$/.exec(r.output)?.[1] ?? 1);
}
console.log(`\n${failed ? `${failed} failed` : "all passed"} (${Math.round((Date.now() - started) / 1000)} s, ${limit} at a time)`);
process.exit(failed ? 1 : 0);
