#!/usr/bin/env node
// Writes test-results/library.html: every piece of the furniture library with its picture,
// its top-down plan picture, name, type and size, one page to review (CI uploads it with
// the screenshots, so a pull request's new pieces can be looked at without installing).
// Run after scripts/thumbnails.mjs: node scripts/library-sheet.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
// the catalogues are TypeScript: bundle a tiny entry that exports them
const out = join(root, "node_modules/.cache/library-sheet");
await build({
  root,
  logLevel: "warn",
  configFile: false,
  publicDir: false,
  build: {
    outDir: out,
    emptyOutDir: true,
    ssr: true,
    rollupOptions: { input: join(root, "dev/library-entry.ts"), output: { entryFileNames: "entry.mjs", format: "es" } },
  },
});
const { MODERN_GROUPS, KENNEY_GROUPS, FURNITURE_GROUPS, FURNITURE, SIZES, en } = await import(join(out, "entry.mjs"));

const img = (path) => {
  const file = join(root, "assets", `${path}.png`);
  return existsSync(file) ? `data:image/png;base64,${readFileSync(file).toString("base64")}` : "";
};
const m = (v) => (Math.round(v * 100) / 100).toFixed(2);
const card = ({ name, type, size, thumb, plan, note }) => `<figure>
  ${thumb ? `<img src="${thumb}" alt="">` : `<div class="missing">no picture</div>`}
  ${plan ? `<img class="plan" src="${plan}" alt="" title="from above">` : `<div class="missing small">no plan</div>`}
  <figcaption><b>${name}</b><br>${type} · ${size}${note ? `<br><small>${note}</small>` : ""}</figcaption>
</figure>`;
const section = (title, groups) =>
  `<h2>${title}</h2>` + groups.map((g) => `<h3>${en[`furniture.group_${g.id}`] ?? g.id}</h3><div class="grid">${g.items.map(card).join("")}</div>`).join("");

const modern = MODERN_GROUPS.map((g) => ({
  id: g.id,
  items: g.kinds.map((k) => ({
    name: en[`modern.${k.id}`] ?? `⚠ ${k.id}`,
    type: k.type,
    size: `${m(k.size[0])} × ${m(k.size[1])} × ${m(k.size[2])} m`,
    thumb: img(`thumbs/modern/${k.id}`),
    plan: img(`plan/modern/${k.id}`),
    note: `${k.id}${k.mount ? ` · ${k.mount}` : ""} · ${k.finishes.join(", ")}`,
  })),
}));
const kenney = KENNEY_GROUPS.map((g) => ({
  id: g.id,
  items: g.items.map((i) => {
    const s = SIZES[i.file];
    return { name: i.file, type: i.type, size: s ? `${m(s[0])} × ${m(s[1])} × ${m(s[2])} m` : "⚠ no size", thumb: img(`thumbs/kenney/${i.file}`), plan: img(`plan/kenney/${i.file}`) };
  }),
}));
const builtin = FURNITURE_GROUPS.map((g) => ({
  id: g.id,
  items: g.types.map((t) => ({ name: en[`furniture.${t}`] ?? t, type: t, size: `${m(FURNITURE[t].size[0])} × ${m(FURNITURE[t].size[1])} × ${m(FURNITURE[t].height)} m`, thumb: img(`thumbs/builtin/${t}`), plan: img(`plan/builtin/${t}`) })),
}));

const html = `<!doctype html><meta charset="utf-8"><title>Homeslice furniture library</title>
<style>
  body { font: 13px system-ui, sans-serif; margin: 16px; background: #1d1f23; color: #e6e6e6; }
  h2 { margin-top: 32px; } h3 { color: #9aa0a6; text-transform: uppercase; font-size: 12px; letter-spacing: .05em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  figure { margin: 0; padding: 8px; background: #2a2d32; border-radius: 8px; display: grid; grid-template-columns: 1fr 60px; gap: 6px; align-items: center; }
  figure img { width: 100%; image-rendering: auto; } figure img.plan { background: #fff; border-radius: 3px; max-height: 80px; object-fit: contain; }
  figcaption { grid-column: 1 / -1; line-height: 1.35; } small { color: #9aa0a6; }
  .missing { color: #ff8a80; font-weight: bold; } .missing.small { font-size: 11px; }
</style>
<h1>Homeslice furniture library</h1>
<p>Every piece with its picture and its plan picture (from above, at its size). Built by <code>scripts/library-sheet.mjs</code>.</p>
${section("Modern (drawn in code)", modern)}${section("Kenney (bundled models)", kenney)}${section("Built-in shapes", builtin)}`;
mkdirSync(join(root, "test-results"), { recursive: true });
writeFileSync(join(root, "test-results/library.html"), html);
console.log(`test-results/library.html: ${modern.flatMap((g) => g.items).length} modern, ${kenney.flatMap((g) => g.items).length} Kenney, ${builtin.flatMap((g) => g.items).length} built-in pieces`);
