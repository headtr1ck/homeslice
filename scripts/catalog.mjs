#!/usr/bin/env node
// Writes custom_components/homeslice/catalog.json from frontend/model/catalog.ts, so the
// integration's validator and AI guide know the same furniture, models and kinds as the
// editor. Run after changing the library: node scripts/catalog.mjs
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "node_modules/.cache/catalog");
await build({
  root,
  logLevel: "warn",
  configFile: false,
  publicDir: false,
  build: { outDir: out, emptyOutDir: true, ssr: true, rollupOptions: { input: join(root, "dev/catalog-entry.ts"), output: { entryFileNames: "entry.mjs", format: "es" } } },
});
const { catalog } = await import(join(out, "entry.mjs"));
writeFileSync(join(root, "custom_components/homeslice/catalog.json"), JSON.stringify(catalog(), null, 1) + "\n");
console.log("custom_components/homeslice/catalog.json written");
