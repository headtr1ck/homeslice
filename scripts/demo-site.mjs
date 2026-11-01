// The demo site (GitHub Pages): the card and the editor on a pretend Home Assistant with the
// demo house, furnished and lit. Nothing is saved. Run `npm run build` first;
// `node scripts/demo-site.mjs [out-dir]` (default: dist-site/).
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as mdi from "@mdi/js";
import { fixture, showcase } from "./demo-model.mjs";

const root = new URL("..", import.meta.url).pathname;
const out = process.argv[2] ?? join(root, "dist-site");
mkdirSync(out, { recursive: true });

// the built card and editor (with the library's pictures), the pretend HA, the pages
cpSync(join(root, "custom_components/homeslice/frontend"), join(out, "frontend"), { recursive: true, filter: (src) => !src.endsWith(".map") });
cpSync(join(root, "dev/fake-hass.js"), join(out, "fake-hass.js"));
for (const f of readdirSync(join(root, "site"))) cpSync(join(root, "site", f), join(out, f), { recursive: true });

// the house, with the sun up and a weather and a door to play with
const f = showcase(fixture());
f.states["sun.sun"] = { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 200, elevation: 35, friendly_name: "Sun" } };
f.states["weather.home"] = { entity_id: "weather.home", state: "partlycloudy", attributes: { temperature: 18, temperature_unit: "°C", friendly_name: "Home" } };
f.config = { latitude: 48.4, longitude: 10.9 };
writeFileSync(join(out, "demo.json"), JSON.stringify(f));

// only the icons the code names (all of them would be megabytes)
const names = new Set();
const scan = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (/\.(ts|js|html)$/.test(e.name)) for (const m of readFileSync(p, "utf8").matchAll(/mdi:([a-z0-9-]+)/g)) names.add(m[1]);
  }
};
scan(join(root, "frontend"));
scan(join(root, "site"));
const all = Object.fromEntries(Object.entries(mdi).map(([k, v]) => [k.slice(3).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase(), v]));
const icons = Object.fromEntries([...names].filter((n) => all[n]).map((n) => [n, all[n]]));
writeFileSync(join(out, "icons.json"), JSON.stringify(icons));
console.log(`demo site in ${out} (${Object.keys(icons).length} icons)`);
