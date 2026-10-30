#!/usr/bin/env node
// Browser tests: renders the built card in headless Chromium against a fake hass
// (dev/fake-hass.js), clicks through it, checks the outcome and saves screenshots to
// test-results/. Run `npm run test:browser` (builds first).
// Private fixtures in dev/fixtures/private/*.json (git-ignored) are rendered too.

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "test-results");
mkdirSync(out, { recursive: true });

// --- static server for the repository ---
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".map": "application/json" };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(root) || !existsSync(path)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = join(process.env.HOME, ".cache/ms-playwright");
  const latest = existsSync(dir) && readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return latest ? join(dir, latest, "chrome-linux64/chrome") : undefined;
}

const loadFixture = (file) => {
  const f = JSON.parse(readFileSync(join(root, file), "utf8"));
  f.model = parse(readFileSync(join(root, f.model), "utf8"));
  return f;
};

// --- tiny test framework ---
const results = [];
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}\n      ${e.message.split("\n")[0]}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ executablePath: chromePath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function open(fixtureFile, config = {}, viewport = { width: 1632, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  const fixture = loadFixture(fixtureFile);
  await page.evaluate((m) => (window.__demoModel = m), fixture.model);
  await page.evaluate(([f, c]) => window.setup(f, c), [fixture, config]);
  // the first size measurement triggers one more redraw; let it pass before acting
  await page.waitForTimeout(250);
  return { page, errors };
}

const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const calls = (page) => page.evaluate(() => window.card.hass.calls);
const state = (page, id) => page.evaluate((id) => window.card.hass.states[id]?.state, id);
const labelNames = (page) => page.locator("homeslice-card .label span.name").allTextContents();
const triangles = (page) => page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
/** Resolves after the card's next redraw; start it before the action that triggers it. */
const nextRender = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        window.card.addEventListener("homeslice-rendered", resolve, { once: true });
        setTimeout(() => reject(new Error("the card did not redraw within 10 s")), 10000);
      }),
  );
async function act(page, action) {
  const rendered = nextRender(page);
  await action();
  await rendered;
}
const lamp = (page, label) => page.locator(`homeslice-card button.lamp[aria-label$="lights in ${label}"]`);

// --- demo house ---
console.log("demo house");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json");

  await test("renders walls, floors and every room label", async () => {
    assert((await triangles(page)) > 500, `only ${await triangles(page)} triangles drawn`);
    const names = await labelNames(page);
    for (const n of ["Hall", "Kitchen", "Living Room", "Garden", "Bedroom", "Bathroom", "Kids Room"])
      assert(names.includes(n), `label "${n}" missing (got ${names.join(", ")})`);
    await shot(page, "demo-overview");
  });

  await test("finds lights through their device's area", async () => {
    assert((await lamp(page, "Kitchen").count()) === 1, "no lamp button for the kitchen (light only has a device area)");
  });

  await test("lamp button turns an area's lights on via the area target", async () => {
    await act(page, () => lamp(page, "Kitchen").click());
    const last = (await calls(page)).at(-1);
    assert(last.domain === "light" && last.service === "turn_on" && last.target.area_id === "kitchen", `unexpected call ${JSON.stringify(last)}`);
    assert((await state(page, "light.kitchen")) === "on", "kitchen light still off");
    assert(await lamp(page, "Kitchen").evaluate((b) => b.classList.contains("on")), "kitchen lamp button not shown as on");
    await shot(page, "demo-kitchen-on");
  });

  await test("hidden entities don't count and aren't switched", async () => {
    await act(page, () => lamp(page, "Living Room").click());
    assert((await calls(page)).at(-1).service === "turn_off", "living room lamp should have turned lights off");
    assert((await state(page, "light.tablet_screen")) === "on", "hidden tablet screen light was switched off");
    assert(!(await lamp(page, "Living Room").evaluate((b) => b.classList.contains("on"))), "living room still shown as on (hidden light counted?)");
  });

  await test("floor picker hides the floors above", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    let names = await labelNames(page);
    assert(!names.includes("Bedroom") && names.includes("Kitchen"), `labels after selecting ground floor: ${names.join(", ")}`);
    await shot(page, "demo-ground-floor");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    names = await labelNames(page);
    assert(names.includes("Bedroom"), "bedroom label not back after 'All floors'");
  });

  await test("a saved model change shows up at once and keeps the focused floor", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        const model = JSON.parse(JSON.stringify(window.__demoModel));
        model.levels[0].rooms.find((r) => r.id === "kitchen").area_id = "garden";
        h.pushModel(model);
      }),
    );
    const names = await labelNames(page);
    assert(names.filter((n) => n === "Garden").length === 2, `kitchen should now be labelled Garden: ${names.join(", ")}`);
    assert((await page.evaluate(() => window.card.renderer.focusedIndex)) === 0, "focused floor lost after the update");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
  });

  await test("unrelated state changes don't redraw anything", async () => {
    const draws = await page.evaluate(async () => {
      let n = 0;
      const count = () => n++;
      window.card.addEventListener("homeslice-rendered", count);
      for (let i = 0; i < 5; i++) {
        await window.card.hass.callService("media_player", i % 2 ? "turn_off" : "turn_on", {}, { entity_id: "media_player.living_room_tv" });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      window.card.removeEventListener("homeslice-rendered", count);
      return n;
    });
    assert(draws === 0, `${draws} redraws for a media player the card doesn't show`);
  });

  await test("labels show the area temperature", async () => {
    const temp = await page.locator("homeslice-card .label button.name", { hasText: "Living Room" }).locator(".temp").textContent();
    assert(temp === "21.4 °C", `living room temperature label: ${temp}`);
  });

  await test("shutters follow the cover position", async () => {
    const shutter = () => page.evaluate(() => window.card.renderer.coverState("bedroom_north_0"));
    let s = await shutter();
    assert(s.shutterVisible && !s.stripVisible && Math.abs(s.shutterHeight - 1.3) < 1e-6, `closed bedroom shutter: ${JSON.stringify(s)}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "set_cover_position", { position: 50 }, { entity_id: "cover.bedroom" })));
    s = await shutter();
    assert(s.shutterVisible && Math.abs(s.shutterHeight - 0.65) < 1e-6, `half-open bedroom shutter: ${JSON.stringify(s)}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.bedroom" })));
    s = await shutter();
    assert(!s.shutterVisible, `open bedroom shutter still shown: ${JSON.stringify(s)}`);
    await shot(page, "demo-shutter-open");
  });

  await test("cut walls show the cover state as a strip", async () => {
    const strip = await page.evaluate(() => window.card.renderer.coverState("living_south_2"));
    assert(strip?.stripVisible && !strip.shutterVisible, `living room south window should be a strip on the cut wall: ${JSON.stringify(strip)}`);
    assert(strip.stripColor === "7fb0ff", `fully open cover should be blue, got #${strip.stripColor}`);
  });

  await test("picking a floor shows it from above in perspective, only its labels", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 65 && o.azimuth === 180 && o.fov === 40, `focus camera ${JSON.stringify(o)}`);
    const names = await labelNames(page);
    assert(names.includes("Kitchen") && !names.includes("Bedroom") && !names.includes("Kids Room"), `labels: ${names.join(", ")}`);
    await shot(page, "demo-ground-top");
  });

  await test("steep floor views show full walls with shutters instead of strips", async () => {
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "set_cover_position", { position: 30 }, { entity_id: "cover.living_room" })));
    const c = await page.evaluate(() => window.card.renderer.coverState("living_south_2"));
    assert(c.shutterVisible && !c.stripVisible, `living room cover in the floor view: ${JSON.stringify(c)}`);
    await shot(page, "demo-ground-shutter");
  });

  await test("tapping a room on the plan opens its popup with HA cards", async () => {
    const label = await page.locator("homeslice-card .label button.name", { hasText: "Living Room" }).boundingBox();
    // tap the floor a bit away from the label, so the canvas gets the click
    await page.mouse.click(label.x + label.width / 2 + 60, label.y + label.height / 2 + 40);
    await page.waitForSelector("homeslice-card .popup .fake-card", { timeout: 5000 });
    await page.waitForTimeout(300); // fade-in
    const title = await page.locator("homeslice-card .popup h2").textContent();
    assert(title === "Living Room", `popup title ${title}`);
    const sections = await page.locator("homeslice-card .popup h3").allTextContents();
    assert(sections.join(",") === "Lights,Blinds,Climate,Media,Sensors", `sections: ${sections.join(",")}`);
    const cards = await page.locator("homeslice-card .popup .fake-card").allTextContents();
    assert(cards.some((c) => c.startsWith("tile light.living_room")), `cards: ${cards.join(" | ")}`);
    assert(!cards.some((c) => c.includes("tablet_screen")), "hidden entity in popup");
    await shot(page, "demo-popup");
  });

  await test("popup cards follow state changes and the popup closes with Escape", async () => {
    await page.evaluate(() => window.card.hass.callService("light", "turn_on", {}, { entity_id: "light.living_room" }));
    await page.evaluate(() => window.card.hass.callService("light", "turn_off", {}, { entity_id: "light.living_room" }));
    const card = await page.locator("homeslice-card .popup .fake-card", { hasText: "light.living_room" }).textContent();
    assert(card.endsWith("off"), `popup card not updated: ${card}`);
    await page.keyboard.press("Escape");
    assert((await page.locator("homeslice-card .popup").count()) === 0, "popup still open after Escape");
  });

  await test("a room without area devices shows a hint", async () => {
    await page.locator("homeslice-card .label button.name", { hasText: "Garden" }).click();
    const text = await page.locator("homeslice-card .popup .empty").textContent();
    assert(text.includes("Nothing in this room"), `empty popup text: ${text}`);
    await page.locator("homeslice-card .backdrop").click({ position: { x: 5, y: 5 } });
    assert((await page.locator("homeslice-card .popup").count()) === 0, "popup still open after tapping outside");
  });

  await test("'All floors' returns to the overview camera", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 38 && o.azimuth === 250 && o.fov === 3, `overview camera ${JSON.stringify(o)}`);
  });

  await test("hovering a floor highlights it and fades the floors above", async () => {
    // find a canvas spot where the ground floor is the first thing hit
    const spot = await page.evaluate(() => {
      const canvas = window.card.shadowRoot.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      for (let y = r.height - 20; y > 20; y -= 15)
        for (let x = 20; x < r.width - 20; x += 15)
          if (window.card.renderer.levelAt(x, y) === 0) return { x: r.left + x, y: r.top + y };
      return null;
    });
    assert(spot, "no visible spot on the ground floor");
    await page.mouse.move(spot.x, spot.y);
    await page.waitForFunction(() => window.card.renderer.levels[1].hoverOpacity < 0.2, null, { timeout: 10000 });
    const state = await page.evaluate(() => ({
      hover: window.card.renderer.hoveredIndex,
      above: window.card.renderer.levels[1].hoverOpacity,
      below: window.card.renderer.levels[0].hoverOpacity,
    }));
    assert(state.hover === 0 && Math.abs(state.above - 0.18) < 1e-6 && state.below === 1, `hover state ${JSON.stringify(state)}`);
    // what the GPU drew, not just the settings: a pixel of the faded floor must be darker
    const pixel = await page.evaluate(() => {
      const r = window.card.renderer;
      const gl = r.renderer.getContext();
      // top of the far (north-east) wall: nothing but background behind it
      const p = r.project("first", [7.8, 0.2], 2.4);
      const dpr = r.renderer.getPixelRatio();
      r.draw();
      const out = new Uint8Array(4);
      gl.readPixels(Math.round(p.x * dpr), Math.round(gl.drawingBufferHeight - p.y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [...out];
    });
    assert(pixel[3] < 200, `faded first floor still drawn opaque (rgba ${pixel.join(",")})`);
    const faded = await page.locator("homeslice-card .label.faded span.name").allTextContents();
    assert(faded.includes("Bedroom") && !faded.includes("Kitchen"), `faded labels: ${faded.join(", ")}`);
    await shot(page, "demo-hover-ground");
  });

  await test("hovering a floor button does the same; leaving clears it", async () => {
    await page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).hover();
    await page.waitForFunction(() => window.card.renderer.hoveredIndex === 1, null, { timeout: 10000 });
    assert((await page.evaluate(() => window.card.renderer.hoveredIndex)) === 1, "first floor not hovered via its button");
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => window.card.renderer.levels[1].hoverOpacity === 1, null, { timeout: 10000 });
    const state = await page.evaluate(() => ({ hover: window.card.renderer.hoveredIndex, above: window.card.renderer.levels[1].hoverOpacity }));
    assert(state.hover === null && state.above === 1, `hover not cleared: ${JSON.stringify(state)}`);
    assert((await page.locator("homeslice-card .label.faded").count()) === 0, "labels still faded");
  });

  await test("no errors in the console", async () => {
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log(results.splice(0).join("\n"));
console.log("demo house, camera controls");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json");
  const canvasBox = await page.locator("homeslice-card canvas").boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  const camera = () => page.evaluate(() => ({ ...window.card.renderer.orientation, zoom: window.card.renderer.zoom }));

  await test("dragging turns the house, shows the angle and doesn't open a popup", async () => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 20, cy - i * 4);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const c = await camera();
    assert(Math.abs(c.azimuth - 180) < 1 && Math.abs(c.elevation - 28) < 1, `camera after drag ${JSON.stringify(c)}`);
    const readout = await page.locator("homeslice-card .readout").textContent();
    assert(readout === "180° · 28°", `readout: ${readout}`);
    assert((await page.locator("homeslice-card .popup").count()) === 0, "a popup opened after dragging");
    await shot(page, "demo-orbit");
  });

  await test("the wheel zooms", async () => {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
    const c = await camera();
    assert(c.zoom > 1.4 && c.zoom < 1.8, `zoom after wheel ${c.zoom}`);
  });

  await test("double-click goes back to the configured view", async () => {
    await act(page, () => page.mouse.dblclick(cx, cy));
    const c = await camera();
    assert(c.azimuth === 250 && c.elevation === 38 && c.zoom === 1, `camera after reset ${JSON.stringify(c)}`);
    await page.waitForTimeout(400);
    assert((await page.locator("homeslice-card .popup").count()) === 0, "the double-click also opened a popup");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}
{
  const { page } = await open("dev/fixtures/demo-hass.json", { interactive: false });
  await test("interactive: false locks the camera", async () => {
    const b = await page.locator("homeslice-card canvas").boundingBox();
    await page.mouse.move(b.x + 400, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + 600, b.y + 300, { steps: 5 });
    await page.mouse.up();
    const c = await page.evaluate(() => window.card.renderer.orientation);
    assert(c.azimuth === 250, `camera moved: ${JSON.stringify(c)}`);
  });
  await page.close();
}

console.log(results.splice(0).join("\n"));
console.log("demo house, outdoor areas hidden");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { view: { show_outdoor: false } });
  await test("show_outdoor: false leaves out gardens and their labels", async () => {
    const names = await labelNames(page);
    assert(!names.includes("Garden") && names.includes("Living Room"), `labels: ${names.join(", ")}`);
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log(results.splice(0).join("\n"));
console.log("demo house, per-level camera");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", {
    view: { focus: { azimuth: 160, elevation: 70 }, levels: { first: { azimuth: 200, elevation: 90, projection: "isometric" } } },
  });
  await test("uses the per-level camera, else the view's focus camera", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    let o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.azimuth === 200 && o.elevation === 90 && o.fov === 3, `first floor camera ${JSON.stringify(o)}`);
    await shot(page, "demo-first-custom-camera");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.azimuth === 160 && o.elevation === 70 && o.fov === 40, `ground floor camera ${JSON.stringify(o)}`);
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

// --- private fixtures (real houses, not in git) ---
const privateDir = join(root, "dev/fixtures/private");
for (const file of existsSync(privateDir) ? readdirSync(privateDir).filter((f) => f.endsWith(".json")) : []) {
  console.log(results.splice(0).join("\n"));
  console.log(`private: ${file}`);
  const { page, errors } = await open(`dev/fixtures/private/${file}`, { view: { azimuth: 250, elevation: 38, explode: 2.6 } }, { width: 1888, height: 1050 });
  await test("renders with a label per room and no errors", async () => {
    const names = await labelNames(page);
    assert(names.length > 3, `only ${names.length} labels`);
    assert(errors.length === 0, errors.join(" | "));
    await shot(page, `private-${file.replace(".json", "")}`);
  });
  await test("every floor can be focused", async () => {
    const buttons = page.locator("homeslice-card nav.levels button");
    const n = await buttons.count();
    for (let i = 0; i < n - 1; i++) {
      await act(page, () => buttons.nth(i).click());
      const name = (await buttons.nth(i).textContent()).trim();
      assert((await labelNames(page)).length > 0, `no labels on ${name}`);
      await shot(page, `private-${file.replace(".json", "")}-${name.toLowerCase().replace(/\s+/g, "-")}`);
      await act(page, () => buttons.nth(i).click());
    }
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log(results.join("\n"));
await browser.close();
server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
