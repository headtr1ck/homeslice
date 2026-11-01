// The demo house as the README shows it: a static server for the repository, a browser,
// and the house furnished, painted and lit. Used by showcase.mjs and showreel.mjs.
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import * as mdi from "@mdi/js";

// Home Assistant's icons for the harness (mdiLightbulbOn → lightbulb-on)
export const icons = Object.fromEntries(Object.entries(mdi).map(([k, v]) => [k.slice(3).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase(), v]));

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
export const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(root) || !existsSync(path)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
export const base = `http://127.0.0.1:${server.address().port}`;
const dir = join(process.env.HOME, ".cache/ms-playwright");
const latest = existsSync(dir) && readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
export const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (latest ? join(dir, latest, "chrome-linux64/chrome") : undefined), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

export { fixture, showcase } from "./demo-model.mjs";
