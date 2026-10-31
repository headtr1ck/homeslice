#!/usr/bin/env node
// Renders assets/thumbs/<type>.png (the editor's furniture library) and assets/plan/<type>.png
// (the pieces seen from above, drawn on the plan at their size).
// Run after adding a furniture type or changing its model: node scripts/thumbnails.mjs
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "homeslice-thumbs-"));
await build({
  root,
  logLevel: "warn",
  configFile: false,
  publicDir: false,
  build: { outDir: out, emptyOutDir: true, lib: { entry: join(root, "dev/thumbnails.ts"), formats: ["es"], fileName: () => "thumbnails.js" } },
});

const dir = join(homedir(), ".cache/ms-playwright");
const chrome = process.env.CHROME_PATH ?? join(dir, readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop(), "chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error(e.message));
// a fake origin serving the bundle
await page.route("http://thumbs.local/**", (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = path === "/" ? null : join(out, path);
  if (!file) return route.fulfill({ contentType: "text/html", body: '<script type="module" src="/thumbnails.js"></script>' });
  if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
  const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".png") ? "image/png" : "application/octet-stream";
  route.fulfill({ contentType: type, body: readFileSync(file) });
});
await page.goto("http://thumbs.local/");
await page.waitForFunction(() => window.thumbnails, null, { timeout: 300000 });
const images = await page.evaluate(() => window.thumbnails);
await browser.close();
rmSync(out, { recursive: true });

// library pictures, and top-down pictures for the editor's plan
for (const [folder, set] of [["thumbs", images.thumbs], ["plan", images.plans]]) {
  const target = join(root, "assets", folder);
  for (const [key, url] of Object.entries(set)) {
    const file = join(target, `${key}.png`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  }
  console.log(`${Object.keys(set).length} pictures in assets/${folder}/`);
}
