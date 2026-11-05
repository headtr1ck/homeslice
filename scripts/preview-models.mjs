#!/usr/bin/env node
// Large pictures of built-in pieces from four sides (front right above, front, side, top),
// for working on their details: node scripts/preview-models.mjs car_estate car_suv:red
// (an optional ":finish" each, then ":option=value" pairs; ":accent=chrome" picks the accent). Writes test-results/preview/<piece>.png, the same views in a
// check shading as <piece>-normals.png (magenta: the back of a one-sided face is seen, i.e. it is
// inside out; yellow: normals point away from a face seen from the front; blue tint: the back
// of a double-sided sheet, fine), and prints each piece's triangle count and how many of its
// triangles have normals against their winding.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright-core";

const kinds = process.argv.slice(2);
if (!kinds.length) {
  console.error("usage: preview-models.mjs <piece>[:finish][:option=value][:accent=name] …");
  process.exit(2);
}
const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(join(tmpdir(), "homeslice-preview-"));
await build({
  root,
  logLevel: "warn",
  configFile: false,
  publicDir: false,
  build: { outDir: out, emptyOutDir: true, lib: { entry: join(root, "dev/preview.ts"), formats: ["es"], fileName: () => "preview.js" } },
});
const dir = join(homedir(), ".cache/ms-playwright");
const chrome = process.env.CHROME_PATH ?? join(dir, readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop(), "chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("http://preview.local/**", (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname);
  if (path === "/") return route.fulfill({ contentType: "text/html", body: '<script type="module" src="/preview.js"></script>' });
  const file = join(out, path);
  if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
  route.fulfill({ contentType: file.endsWith(".js") ? "text/javascript" : "application/octet-stream", body: readFileSync(file) });
});
await page.goto(`http://preview.local/#${encodeURIComponent(kinds.join(","))}`);
await page.waitForFunction(() => window.previews || document.title === "error", null, { timeout: 120000 }).catch(() => {});
const images = (await page.evaluate(() => window.previews)) ?? {};
await browser.close();
rmSync(out, { recursive: true });
if (errors.length) console.error(errors.join("\n"));
const target = join(root, "test-results/preview");
mkdirSync(target, { recursive: true });
for (const [key, { png, normals, triangles, against }] of Object.entries(images)) {
  const name = key.replace(/[:=]/g, "-");
  const file = join(target, `${name}.png`);
  writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
  writeFileSync(join(target, `${name}-normals.png`), Buffer.from(normals.split(",")[1], "base64"));
  const warn = against ? `, ${against} with normals against their winding` : "";
  console.log(`${file}  (${Math.round(triangles)} triangles${warn}; check shading: ${name}-normals.png)`);
}
if (!Object.keys(images).length) process.exit(1);
