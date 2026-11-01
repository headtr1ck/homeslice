// The README's animation (docs/images/showreel.webp): the demo house going through its
// looks and views — 3D by day, lights coming on, shutters and a door, night, the white
// model and the blueprint, one floor, the tilted and the flat plan, all floors, weather.
// Run `npm run build` first; `node scripts/showreel.mjs [out-file]`.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { base, browser, fixture, icons, root, server, showcase } from "./demo-house.mjs";

const out = process.argv[2] ?? join(root, "docs/images/showreel.webp");
const frames = mkdtempSync(join(tmpdir(), "showreel-"));
const FPS = 8;
let n = 0;

const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
await page.addInitScript((i) => (window.__icons = i), icons);
await page.goto(`${base}/dev/harness.html`);
await page.waitForFunction(() => window.ready);
const f = showcase(fixture());
// start dark inside: the lights come on in the reel
for (const id of Object.keys(f.states)) if (id.startsWith("light.")) f.states[id] = { ...f.states[id], state: "off" };
f.states["sun.sun"] = { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 200, elevation: 35 } };
f.states["binary_sensor.terrace_door"] = { entity_id: "binary_sensor.terrace_door", state: "off", attributes: { device_class: "door", friendly_name: "Terrace door" } };
f.states["weather.home"] = { entity_id: "weather.home", state: "sunny", attributes: { temperature: 18, temperature_unit: "°C", friendly_name: "Home" } };
f.config = { latitude: 48.4, longitude: 10.9 };
// the living room's garden door opens with its contact
const living = f.model.levels[0];
for (const o of living.openings ?? []) if (o.room === "living" && o.type === "door") o.contact = "binary_sensor.terrace_door";
await page.evaluate((m) => (window.__demoModel = m), f.model);
const base3d = { height: 560, view: { azimuth: 200, elevation: 38, furniture: "detailed" } };
await page.evaluate(([fx, c]) => window.setup(fx, c), [f, base3d]);
await page.waitForTimeout(500);
await page.evaluate(() => window.card.renderer.modelsReady());
await page.waitForTimeout(1200);
// a caption over the card
await page.evaluate(() => {
  const c = document.createElement("div");
  c.id = "caption";
  Object.assign(c.style, { position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)", padding: "6px 16px", borderRadius: "16px", background: "rgba(20,24,28,.78)", color: "#fff", font: "600 17px system-ui, sans-serif", zIndex: 99, letterSpacing: ".02em" });
  document.body.appendChild(c);
});

const caption = (text) => page.evaluate((t) => (document.getElementById("caption").textContent = t), text);
const config = (patch) => page.evaluate((p) => window.card.setConfig({ ...window.card.config, ...p }), patch);
/** A new mode or floors: the card builds the house again. */
const rebuild = (patch) =>
  page.evaluate((p) => {
    window.card.setConfig({ ...window.card.config, ...p });
    window.card.loadedFor = undefined;
    window.card._level = null;
    window.card.hass = window.card.hass;
  }, patch);
const call = (domain, service, entity) => page.evaluate(([d, s, e]) => window.card.hass.callService(d, s, {}, { entity_id: e }), [domain, service, entity]);
const state = (id, s, attributes) =>
  page.evaluate(([id, s, a]) => {
    const h = window.card.hass;
    h.states = { ...h.states, [id]: { ...h.states[id], state: s, attributes: { ...h.states[id]?.attributes, ...a } } };
    window.card.hass = h;
  }, [id, s, attributes ?? {}]);
async function shoot(count, each = async () => {}) {
  for (let i = 0; i < count; i++) {
    await each(i);
    await page.waitForTimeout(1000 / FPS);
    await page.screenshot({ path: join(frames, `f${String(n++).padStart(4, "0")}.png`) });
  }
}
const orbit = (deg) => page.evaluate((d) => window.card.renderer.orbit(d, 0), deg);

await caption("3D — your home, live");
await shoot(18, () => orbit(1.2));
await caption("Lights in their colours");
const lights = await page.evaluate(() => Object.keys(window.card.hass.states).filter((id) => id.startsWith("light.")));
await shoot(16, async (i) => i % 3 === 0 && lights[i / 3] && call("light", "turn_on", lights[i / 3]));
await caption("Shutters and doors follow their sensors");
await call("cover", "close_cover", "cover.living_room");
await state("binary_sensor.terrace_door", "on");
await shoot(16, () => orbit(0.6));
await caption("Night");
await page.evaluate(() => {
  const h = window.card.hass;
  h.states = { ...h.states, "sun.sun": { entity_id: "sun.sun", state: "below_horizon", attributes: { azimuth: 300, elevation: -15 } } };
  window.card.hass = h;
});
await config({ look: "night" });
await shoot(18, () => orbit(0.8));
await caption("White model");
await config({ look: "white" });
await shoot(12, () => orbit(0.6));
await caption("Blueprint");
await config({ look: "blueprint" });
await shoot(12, () => orbit(0.6));
await config({ look: "day" });
await state("sun.sun", "above_horizon", { azimuth: 200, elevation: 35 });
await caption("One floor at a time");
await page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click();
await shoot(16);
await caption("2.5D — a tilted plan");
await rebuild({ mode: "tilted" });
await page.waitForTimeout(1500);
await shoot(14);
await caption("2D — a floor plan");
await rebuild({ mode: "plan" });
await page.waitForTimeout(1500);
await shoot(14);
await caption("All floors side by side");
await rebuild({ mode: "plan", floors: "all" });
await page.waitForTimeout(1500);
await shoot(14);
await caption("Weather and today's sun");
await rebuild({ mode: undefined, floors: undefined, weather: "weather.home", sun_path: true, view: { azimuth: 200, elevation: 38, furniture: "detailed" } });
await page.waitForTimeout(1500);
await state("weather.home", "pouring");
await page.waitForTimeout(800);
await shoot(20, () => orbit(0.8));

await browser.close();
server.close();
// an animated WebP: small, sharp, loops
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"), "-vf", "scale=860:-1:flags=lanczos", "-loop", "0", "-c:v", "libwebp_anim", "-quality", "62", "-compression_level", "6", out]);
console.log(`${readdirSync(frames).length} frames → ${out}`);
rmSync(frames, { recursive: true, force: true });
