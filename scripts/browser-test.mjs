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

  await test("the awning follows its cover position", async () => {
    const state = () => page.evaluate(() => window.card.renderer.awningState("ground", "garden"));
    assert(Math.abs((await state()) - 0.6) < 0.01, `awning at 60 %: ${await state()}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "close_cover", {}, { entity_id: "cover.awning" })));
    assert((await state()) === 0, `closed awning still drawn: ${await state()}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.awning" })));
    assert((await state()) === 1, `open awning: ${await state()}`);
    await shot(page, "awning");
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

  await test("a room's popup includes its awning even without an area", async () => {
    await page.locator("homeslice-card .label button.name", { hasText: "Garden" }).click();
    await page.waitForSelector("homeslice-card .popup .fake-card", { timeout: 5000 });
    const cards = await page.locator("homeslice-card .popup .fake-card").allTextContents();
    assert(cards.some((c) => c.startsWith("tile cover.awning")), `cards: ${cards.join(" | ")}`);
    await page.keyboard.press("Escape");
  });

  await test("a room without devices shows a hint", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    await page.locator("homeslice-card .label button.name", { hasText: "Bathroom" }).click();
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

console.log(results.splice(0).join("\n"));
console.log("editor");
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate((f) => window.setupPanel(f), loadFixture("dev/fixtures/demo-hass.json"));
  const model = () => page.evaluate(() => window.panel._model);
  const room = async (id) => (await model()).levels[0].rooms.find((r) => r.id === id);

  await test("opens the house on the ground floor with names, areas and a 3D preview", async () => {
    const names = await page.locator("homeslice-panel svg.plan text.room-name").allTextContents();
    assert(names.includes("Living Room") && names.includes("Kitchen") && !names.includes("Bedroom"), `plan labels: ${names.join(", ")}`);
    const areas = await page.locator("homeslice-panel svg.plan text.room-area").allTextContents();
    // inside dimensions: the 5 × 4 m kitchen minus its walls
    assert(areas.includes("16.8 m²"), `kitchen area missing: ${areas.join(", ")}`);
    await page.waitForFunction(() => window.panel.renderer?.renderer.info.render.triangles > 100, null, { timeout: 10000 });
    await shot(page, "editor-open");
  });

  await test("selecting a room shows its handles and inspector", async () => {
    const kb = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height * 0.7);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Kitchen", "inspector does not show the kitchen");
    assert((await page.locator("homeslice-panel svg.plan circle.vertex").count()) === 4, "kitchen should have 4 corner handles");
  });

  await test("dragging a shared wall moves both rooms; undo and redo", async () => {
    // the wall between hall (x 0–3) and kitchen (x 3–8)
    const handle = page.locator('homeslice-panel svg.plan rect.edge-handle[data-at="[[3,4],[3,0]]"], homeslice-panel svg.plan rect.edge-handle[data-at="[[3,0],[3,4]]"]');
    const box = await handle.boundingBox();
    assert(box, "no handle on the hall/kitchen wall");
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 5 + scale * 0.5, box.y + 5, { steps: 6 });
    const hint = await page.locator("homeslice-panel .hint").textContent();
    await page.mouse.up();
    assert(hint.includes("0.50 m east"), `drag readout: ${hint}`);
    assert(JSON.stringify((await room("kitchen")).rect) === "[3.5,0,4.5,4]", `kitchen: ${JSON.stringify(await room("kitchen"))}`);
    assert(JSON.stringify((await room("hall")).rect) === "[0,0,3.5,4]", `hall: ${JSON.stringify(await room("hall"))}`);
    assert(await page.locator("homeslice-panel button.save.dirty").count(), "not marked as unsaved");
    await shot(page, "editor-wall-moved");
    await page.keyboard.press("Control+z");
    assert(JSON.stringify((await room("kitchen")).rect) === "[3,0,5,4]", "undo did not restore the kitchen");
    await page.keyboard.press("Control+Shift+z");
    assert(JSON.stringify((await room("kitchen")).rect) === "[3.5,0,4.5,4]", "redo did not reapply the move");
  });

  await test("drawing a room and linking it to an area", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("r");
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const [x0, y0] = await toScreen([0.5, 5]);
    const [x1, y1] = await toScreen([2.5, 7]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    const added = await room("room");
    assert(JSON.stringify(added?.rect) === "[0.5,5,2,2]", `new room: ${JSON.stringify(added)}`);
    await page.locator("homeslice-panel .inspector select").first().selectOption("garden");
    assert((await room("room")).area_id === "garden", "area not linked");
  });

  await test("saving stores the model in HA", async () => {
    await page.locator("homeslice-panel button.save").click();
    const saved = await page.evaluate(() => window.panel.hass.saved.length);
    assert(saved === 1, `${saved} saves`);
    assert((await page.locator("homeslice-panel button.save").textContent()).trim() === "Saved", "save button doesn't say Saved");
  });

  await test("outside walls: select the outline, moving the façade moves every floor", async () => {
    await page.keyboard.press("Escape");
    // the west wall's click zone
    const west = await page.evaluate(() => {
      const lines = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-outline]")];
      const r = lines.map((l) => l.getBoundingClientRect()).sort((a, b) => a.left - b.left)[0];
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(west.x, west.y);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Outside walls", "outline not selected");
    const handle = page.locator('homeslice-panel svg.plan rect.edge-handle[data-at="[[8,10],[0,10]]"]');
    const box = await handle.boundingBox();
    assert(box, "no handle on the south façade");
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 5, box.y + 5 + scale * 0.5, { steps: 6 });
    await page.mouse.up();
    const m = await model();
    assert(JSON.stringify(m.outline) === '{"rect":[0,0,8,10.5]}', `outline: ${JSON.stringify(m.outline)}`);
    const kids = m.levels[1].rooms.find((r) => r.id === "kids");
    assert(JSON.stringify(kids.rect) === "[0,6,8,4.5]", `first floor didn't follow: ${JSON.stringify(kids)}`);
    await page.keyboard.press("Control+z");
  });

  await test("a wall between two rooms can be opened on one side", async () => {
    await page.keyboard.press("Escape");
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-wall]")].find((x) => {
        const w = JSON.parse(x.dataset.wall);
        return [w.a, w.b].sort().join() === "kitchen,living";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, wall: JSON.parse(l.dataset.wall) };
    });
    await page.mouse.click(hit.x, hit.y);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Wall", "wall not selected");
    await page.locator("homeslice-panel .segmented button", { hasText: "Open" }).click();
    const walls = (await model()).levels[0].walls;
    assert(JSON.stringify(walls) === JSON.stringify([{ between: [hit.wall.a, hit.wall.b] }]) || walls?.length === 1, `walls: ${JSON.stringify(walls)}`);
    await page.waitForTimeout(300);
    assert(await page.locator("homeslice-panel svg.plan line.wall.open").count(), "open boundary not drawn dashed");
    await shot(page, "editor-open-wall");
    await page.keyboard.press("Control+z");
  });

  await test("dragging one wall piece moves only that piece; the longer room side gets a step", async () => {
    await page.keyboard.press("Escape");
    // hall | living runs along y = 4 from x 0 to the hall's width; living's side goes on to x 5
    const hallBefore = await room("hall");
    const kitchenBefore = await room("kitchen");
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-wall]")].find((x) => {
        const w = JSON.parse(x.dataset.wall);
        return [w.a, w.b].sort().join() === "hall,living";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(hit.x, hit.y);
    await page.mouse.down();
    await page.mouse.move(hit.x, hit.y + scale * 0.5, { steps: 6 });
    const hint = await page.locator("homeslice-panel .hint").textContent();
    await page.mouse.up();
    assert(hint.includes("0.50 m south"), `drag readout: ${hint}`);
    const [, , hw] = hallBefore.rect;
    assert(JSON.stringify((await room("hall")).rect) === JSON.stringify([0, 0, hw, 4.5]), `hall: ${JSON.stringify(await room("hall"))}`);
    assert(JSON.stringify(await room("kitchen")) === JSON.stringify(kitchenBefore), `kitchen moved: ${JSON.stringify(await room("kitchen"))}`);
    const living = (await room("living")).polygon;
    assert(JSON.stringify(living) === JSON.stringify([[0, 4.5], [hw, 4.5], [hw, 4], [5, 4], [5, 6], [8, 6], [8, 10], [0, 10]]), `living: ${JSON.stringify(living)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Wall", "the dragged wall is not selected");
    await shot(page, "editor-wall-piece");
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await room("hall")) === JSON.stringify(hallBefore), "undo did not restore the hall");
  });

  await test("levels can be reordered by drag and drop", async () => {
    const first = await page.locator("homeslice-panel button.level", { hasText: "First Floor" }).boundingBox();
    const ground = await page.locator("homeslice-panel button.level", { hasText: "Ground Floor" }).boundingBox();
    await page.mouse.move(first.x + 20, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 20, ground.y + ground.height / 2, { steps: 8 });
    // mid-drag: the ground floor has slid up to make room
    const slid = await page.locator("homeslice-panel button.level", { hasText: "Ground Floor" }).evaluate((b) => b.style.transform);
    assert(slid.includes("-"), `ground floor didn't slide aside: ${slid}`);
    await page.mouse.up();
    assert(JSON.stringify((await model()).levels.map((l) => l.id)) === '["first","ground"]', `order: ${JSON.stringify((await model()).levels.map((l) => l.id))}`);
    await page.keyboard.press("Control+z");
    assert(JSON.stringify((await model()).levels.map((l) => l.id)) === '["ground","first"]', "undo didn't restore the order");
  });

  await test("assigning a level's HA floor is an edit that can be saved", async () => {
    await page.keyboard.press("Escape");
    const select = page.locator("homeslice-panel .inspector select").first();
    await select.selectOption("first_floor");
    assert((await model()).levels[0].floor_id === "first_floor", "floor not assigned");
    await page.locator("homeslice-panel button.save").click();
    const saved = await page.evaluate(() => window.panel.hass.saved.at(-1).levels[0].floor_id);
    assert(saved === "first_floor", `saved floor: ${saved}`);
    await select.selectOption("ground_floor");
  });

  await test("doors & windows: click a wall to add a window, drag it, link a blind, delete it", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel .segmented.modes button", { hasText: "Doors & windows" }).click();
    const before = (await model()).levels[0].openings.length;
    // a free stretch of the kitchen's north wall (x = 6.8; an earlier step moved the kitchen to x = 3.5 … 8)
    const at = await page.evaluate(() => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return { x: r.left + 6.8 * v.scale + v.ox, y: r.top + 0.12 * v.scale + v.oy };
    });
    await page.mouse.click(at.x, at.y);
    let openings = (await model()).levels[0].openings;
    assert(openings.length === before + 1, `no window added (${openings.length})`);
    const added = openings.at(-1);
    assert(added.room === "kitchen" && added.side === "north" && added.at === 2.8 && added.width === 1, `added: ${JSON.stringify(added)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Window", "opening inspector not shown");

    const hit = await page.locator("homeslice-panel svg.plan line.opening.selected").boundingBox();
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit.x + hit.width / 2 + scale * 0.5, hit.y + hit.height / 2, { steps: 6 });
    await page.mouse.up();
    assert((await model()).levels[0].openings.at(-1).at === 3.3, `after dragging: ${JSON.stringify((await model()).levels[0].openings.at(-1))}`);

    // pulled close to the kitchen's centre (x 3.5 … 8 → 5.75), it snaps there and shows a guide
    const hit2 = await page.locator("homeslice-panel svg.plan line.opening.selected").boundingBox();
    await page.mouse.move(hit2.x + hit2.width / 2, hit2.y + hit2.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit2.x + hit2.width / 2 - scale * 1.53, hit2.y + hit2.height / 2, { steps: 8 });
    const guides = await page.locator("homeslice-panel svg.plan line.guide").count();
    await shot(page, "editor-snap-guide");
    await page.mouse.up();
    assert(guides === 1, `${guides} guide lines while snapped`);
    assert((await model()).levels[0].openings.at(-1).at === 1.75, `not centred: ${JSON.stringify((await model()).levels[0].openings.at(-1))}`);

    const coverSelect = page.locator("homeslice-panel .inspector label", { hasText: "Blind" }).locator("select");
    const options = await coverSelect.locator("option").allTextContents();
    assert(options[1].startsWith("★"), `the kitchen's own blind should come first: ${options.join(" | ")}`);
    await coverSelect.selectOption("cover.kitchen");
    assert((await model()).levels[0].openings.at(-1).cover === "cover.kitchen", "blind not linked");
    await shot(page, "editor-opening");

    await page.keyboard.press("Delete");
    assert((await model()).levels[0].openings.length === before, "window not deleted");
    await page.locator("homeslice-panel .segmented.modes button", { hasText: "Rooms & walls" }).click();
  });

  await test("Delete removes the selected room", async () => {
    await page.locator('homeslice-panel svg.plan g[data-room="room"] polygon').click({ force: true });
    await page.keyboard.press("Delete");
    assert(!(await room("room")), "room still there");
    assert(await page.locator("homeslice-panel button.save.dirty").count(), "delete not marked as unsaved");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("editor, starting from scratch");
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  const fixture = loadFixture("dev/fixtures/demo-hass.json");
  fixture.model = null;
  fixture.floors.basement = { floor_id: "basement", name: "Basement", level: -1 };
  fixture.areas.cellar = { area_id: "cellar", name: "Cellar", floor_id: "basement" };
  await page.evaluate((f) => window.setupPanel(f), fixture);
  const model = () => page.evaluate(() => window.panel._model);
  const lvl = async (id) => (await model()).levels.find((l) => l.id === id);

  await test("with no house, a new one is made from HA's floors and areas", async () => {
    await page.locator("homeslice-panel .empty button.primary").click();
    const dialog = page.locator("homeslice-panel .create");
    assert((await dialog.locator("input[type=checkbox]").count()) === 4, "expected three floors and the rooms option");
    await dialog.locator("input").first().fill("Test house");
    await dialog.locator("input[type=number]").nth(0).fill("9");
    await dialog.locator("input[type=number]").nth(0).dispatchEvent("change");
    await shot(page, "editor-new-house");
    await dialog.locator("button.primary").click();
    await page.waitForFunction(() => window.panel.shadowRoot.querySelector("svg.plan .room"));
    const m = await model();
    assert(m.id === "test_house" && m.name === "Test house", `id/name: ${m.id} ${m.name}`);
    assert(JSON.stringify(m.outline) === '{"rect":[0,0,9,8]}', `outline: ${JSON.stringify(m.outline)}`);
    assert(JSON.stringify(m.levels.map((l) => l.id)) === '["basement","ground_floor","first_floor"]', `levels: ${m.levels.map((l) => l.id)}`);
    // opens on the entrance floor with a room per area
    assert((await page.locator("homeslice-panel button.level.active").textContent()).includes("Ground Floor"), "not on the ground floor");
    const names = await page.locator("homeslice-panel svg.plan text.room-name").allTextContents();
    for (const n of ["Hall", "Kitchen", "Living Room", "Garden"]) assert(names.includes(n), `missing ${n}: ${names}`);
    const garden = m.levels[1].rooms.find((r) => r.area_id === "garden");
    assert(garden.kind === "outdoor" && garden.rect[1] === 8, `garden: ${JSON.stringify(garden)}`);
    assert(!(await page.locator("homeslice-panel button.save.dirty").count()), "a new house should be saved right away");
    await page.waitForFunction(() => window.panel.renderer?.renderer.info.render.triangles > 100, null, { timeout: 10000 });
    await shot(page, "editor-new-house-created");
  });

  await test("an area without a room can be drawn from the level inspector", async () => {
    await page.locator('homeslice-panel svg.plan g[data-room="hall"] polygon').click({ force: true });
    await page.keyboard.press("Delete");
    await page.keyboard.press("Escape");
    const item = page.locator("homeslice-panel ul.unplaced li", { hasText: "Hall" });
    await item.locator("button").click();
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    const { scale, ox, oy } = await page.evaluate(() => window.panel._view);
    const at = (x, y) => [plan.x + ox + x * scale, plan.y + oy + y * scale];
    await page.mouse.move(...at(0.5, 0.5));
    await page.mouse.down();
    await page.mouse.move(...at(3, 3), { steps: 5 });
    await page.mouse.up();
    const hall = (await lvl("ground_floor")).rooms.find((r) => r.area_id === "hall");
    assert(hall?.id === "hall", `hall: ${JSON.stringify(hall)}`);
    assert(!(await page.locator("homeslice-panel ul.unplaced li", { hasText: "Hall" }).count()), "hall still listed as unplaced");
  });

  await test("levels: height, add above, delete", async () => {
    await page.keyboard.press("Escape");
    const height = page.locator("homeslice-panel .inspector input[type=number]");
    await height.fill("2.8");
    await height.dispatchEvent("change");
    assert((await lvl("ground_floor")).height === 2.8, "height not stored");
    await page.locator("homeslice-panel button.add-level").click();
    const m = await model();
    assert(m.levels.length === 4 && m.levels[3].name === "New level", `levels: ${JSON.stringify(m.levels.map((l) => l.id))}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "New level", "new level not selected");
    await page.locator("homeslice-panel .inspector button.danger").click();
    assert((await model()).levels.length === 3, "level not deleted");
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
