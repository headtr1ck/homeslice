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

async function open(fixtureFile, config = {}, viewport = { width: 1632, height: 1000 }, edit = (fixture) => fixture) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  const fixture = edit(loadFixture(fixtureFile));
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

  await test("lamp button turns the room's lights on", async () => {
    await act(page, () => lamp(page, "Kitchen").click());
    const last = (await calls(page)).at(-1);
    assert(last.domain === "light" && last.service === "turn_on" && JSON.stringify(last.target.entity_id) === '["light.kitchen"]', `unexpected call ${JSON.stringify(last)}`);
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

  await test("lamps glow where they are and follow their light", async () => {
    const lampState = (e) => page.evaluate((e) => window.card.renderer.lampState(e), e);
    assert(JSON.stringify(await lampState("light.kitchen")) === '{"count":1,"on":true}', `kitchen lamp: ${JSON.stringify(await lampState("light.kitchen"))}`);
    assert(JSON.stringify(await lampState("light.reading_lamp")) === '{"count":1,"on":false}', "reading lamp");
    assert((await lampState("light.tablet_screen")) === null, "hidden light got a lamp");
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

  await test("a focused floor shows a toggle per lamp in rooms with several lights", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const buttons = page.locator("homeslice-card button.lamp.single");
    assert((await buttons.count()) === 2, `lamp toggles: ${await buttons.count()}`);
    await act(page, () => page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click());
    assert((await state(page, "light.reading_lamp")) === "on", "reading lamp not switched on");
    assert((await page.evaluate(() => window.card.renderer.lampState("light.reading_lamp"))).on, "reading lamp not drawn lit");
    await shot(page, "demo-lamps");
    await act(page, () => page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click());
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
    await page.waitForFunction(() => Math.abs(window.card.renderer.levels[1].hoverOpacity - 0.18) < 1e-6, null, { timeout: 10000 });
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
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { interactive: true });
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
  const { page } = await open("dev/fixtures/demo-hass.json");
  await test("the camera is locked unless interactive is on", async () => {
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
console.log("demo house, roof");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { view: { azimuth: 200, elevation: 45, roof: true } });
  await test("furniture is drawn", async () => {
    const before = await page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [
          { type: "sofa", at: [2, 4] },
          { type: "table", at: [3, 2], rotation: 90 },
          { type: "plant", at: [0.5, 0.5] },
        ];
        window.card.hass.pushModel(m);
      }),
    );
    const after = await page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
    assert(after > before + 50, `triangles ${before} → ${after}`);
  });
  await test("detailed furniture: every type gets its model, long pieces repeat units", async () => {
    const types = ["sofa", "armchair", "table", "chair", "bed", "bed_single", "desk", "wardrobe", "shelf", "kitchen", "tv", "bathtub", "shower", "toilet", "sink", "plant", "car", "washer", "dryer", "fridge"];
    await act(page, async () => {
      await page.evaluate((types) => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = types.map((type, i) => ({ type, at: [0.8 + (i % 5) * 1.2, 0.8 + Math.floor(i / 5) * 1.8] }));
        window.card.hass.pushModel(m);
      }, types);
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const pieces = await page.evaluate(() => {
      const out = [];
      const level = window.card.renderer.object.getObjectByName("ground");
      for (const g of level.children) {
        let shared = 0;
        g.traverse((o) => o.isMesh && o.userData.shared && shared++);
        if (shared) out.push({ shared, holders: g.children[0]?.children.length ?? 0 });
      }
      return out;
    });
    assert(pieces.length === types.length, `${pieces.length} of ${types.length} pieces detailed`);
    // the 2.4 m kitchen counter is a row of cabinets, not one stretched cabinet
    assert(pieces[types.indexOf("kitchen")].holders >= 4, `kitchen units: ${pieces[types.indexOf("kitchen")].holders}`);
    await shot(page, "demo-furniture-detailed");
  });
  await test("simple furniture when the card asks for it", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, view: { ...window.card.config.view, furniture: "simple" } });
      window.card.hass = window.card.hass; // HA sends states all the time; the card reloads on the next
    });
    await page.waitForFunction(
      () => {
        let n = 0;
        window.card.renderer.object.traverse((o) => o.isMesh && o.userData.shared && n++);
        return n === 0;
      },
      null,
      { timeout: 10000 },
    );
  });
  await test("the roof shows in the overview only", async () => {
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.azimuth === 200 && o.elevation === 45, `camera ${JSON.stringify(o)}`);
    assert(await page.evaluate(() => window.card.renderer.roofVisible()), "roof not shown");
    await shot(page, "demo-roof");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    assert(!(await page.evaluate(() => window.card.renderer.roofVisible())), "roof still shown with a floor picked");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate((f) => window.setupCardEditor(f, { type: "custom:homeslice-card", house: "demo" }), loadFixture("dev/fixtures/demo-hass.json"));
  const last = () => page.evaluate(() => window.editorConfigs.at(-1));
  await test("card editor: turning the preview sets the angle; look options", async () => {
    const box = await page.locator("homeslice-card-editor canvas").boundingBox();
    await page.waitForFunction(() => window.cardEditor.renderer?.renderer.info.render.triangles > 100, null, { timeout: 10000 });
    await page.mouse.move(box.x + 200, box.y + 130);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 170, { steps: 5 });
    await page.mouse.up();
    const c = await last();
    assert(c?.view?.azimuth === 215 && c.view.elevation === 48, `angle: ${JSON.stringify(c)}`);
    await page.locator("homeslice-card-editor label.check", { hasText: "roof" }).locator("input").check();
    assert((await last()).view.roof === true, "roof not set");
    await page.locator("homeslice-card-editor label.check", { hasText: "turning and zooming" }).locator("input").check();
    assert((await last()).interactive === true, "interactive not set");
    await page.locator("homeslice-card-editor select").first().selectOption("perspective");
    assert((await last()).view.projection === "perspective", "projection not set");
    await shot(page, "card-editor");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, energy");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { energy: true }, undefined, (f) => {
    f.model.energy = [
      { kind: "solar" },
      { kind: "battery", level: "ground", at: [1, 1] },
      { kind: "grid", level: "ground", at: [2, 1] },
      { kind: "device", power: "sensor.heat_pump_power", level: "ground", at: [6, 8] },
    ];
    f.energy_prefs = {
      energy_sources: [
        { type: "solar", stat_rate: "sensor.pv_power" },
        { type: "battery", stat_rate: "sensor.battery_power" },
        { type: "grid", stat_rate: "sensor.grid_power" },
      ],
      device_consumption: [],
    };
    const st = (id, state, unit, extra = {}) => (f.states[id] = { entity_id: id, state, attributes: { unit_of_measurement: unit, ...extra } });
    st("sensor.pv_power", "2.4", "kW");
    st("sensor.battery_power", "-900", "W");
    st("sensor.battery_soc", "64", "%", { device_class: "battery" });
    st("sensor.grid_power", "-300", "W");
    st("sensor.heat_pump_power", "1200", "W", { friendly_name: "Heat pump" });
    f.entities["sensor.battery_power"] = { entity_id: "sensor.battery_power", device_id: "battery" };
    f.entities["sensor.battery_soc"] = { entity_id: "sensor.battery_soc", device_id: "battery" };
    return f;
  });
  await test("energy overlay: panels on the roof, labels with power, flows to the battery", async () => {
    await page.waitForFunction(() => window.card.renderer.energyState().flows.some((f) => f.watts !== 0));
    const state = await page.evaluate(() => window.card.renderer.energyState());
    assert(state.hub === "energy-1" && state.flows.length === 3, `energy: ${JSON.stringify(state)}`);
    const w = Object.fromEntries(state.flows.map((f) => [f.key, f.watts]));
    assert(w["energy-0"] === 2400 && w["energy-2"] === -300 && w["energy-3"] === -1200, `flows: ${JSON.stringify(w)}`);
    assert(state.flows.every((f) => f.visible && f.dots), "flows not drawn");
    assert(await page.evaluate(() => window.card.renderer.roofVisible()), "the overlay should show the roof");
    const labels = await page.locator("homeslice-card .energy-label").allTextContents();
    const text = labels.map((l) => l.replace(/\s+/g, " ").trim()).join(" | ");
    assert(text.includes("2.4 kW") && text.includes("64 %") && text.includes("Heat pump") && text.includes("1.2 kW"), `labels: ${text}`);
    await page.waitForTimeout(200);
    await shot(page, "demo-energy");
    // a floor picked: only its items; no roof, no solar
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const focused = await page.locator("homeslice-card .energy-label").count();
    assert(focused === 3, `labels on the ground floor: ${focused}`);
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, phone");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", {}, { width: 390, height: 800 });
  await test("on a phone the popup is a bottom sheet that closes when swiped down", async () => {
    await shot(page, "phone-card");
    await page.locator("homeslice-card .label button.name", { hasText: "Kitchen" }).click();
    await page.waitForSelector("homeslice-card .popup .fake-card");
    await page.waitForTimeout(300);
    const box = await page.locator("homeslice-card .popup").boundingBox();
    assert(Math.abs(box.y + box.height - 800) < 2 && box.width === 390, `sheet at ${JSON.stringify(box)}`);
    await shot(page, "phone-sheet");
    const grab = await page.locator("homeslice-card .popup .grabber").boundingBox();
    await page.mouse.move(grab.x + 100, grab.y + 10);
    await page.mouse.down();
    await page.mouse.move(grab.x + 100, grab.y + 60, { steps: 4 });
    await page.mouse.up();
    assert(await page.locator("homeslice-card .popup").count(), "a small pull closed the sheet");
    await page.mouse.move(grab.x + 100, grab.y + 10);
    await page.mouse.down();
    await page.mouse.move(grab.x + 100, grab.y + 200, { steps: 6 });
    await page.mouse.up();
    assert(!(await page.locator("homeslice-card .popup").count()), "swiping down didn't close the sheet");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

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

  await test("a rectangular room's size can be typed; the temperature sensor goes to the HA area", async () => {
    const before = await room("kitchen");
    const width = page.locator("homeslice-panel .inspector label", { hasText: "Width west–east" }).locator("input");
    await width.fill(String(before.rect[2] - 0.5));
    await width.dispatchEvent("change");
    assert(JSON.stringify((await room("kitchen")).rect) === JSON.stringify([before.rect[0], before.rect[1], before.rect[2] - 0.5, before.rect[3]]), `kitchen: ${JSON.stringify(await room("kitchen"))}`);
    await width.evaluate((el) => el.blur());
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await room("kitchen")) === JSON.stringify(before), "undo");
    const temp = page.locator("homeslice-panel .inspector label", { hasText: "Temperature sensor" }).locator("select");
    const options = await temp.locator("option").allTextContents();
    assert(options.length >= 2, `temperature options: ${options}`);
    await temp.selectOption({ index: 1 });
    const updates = await page.evaluate(() => window.panel.hass.areaUpdates);
    assert(updates.at(-1)?.area_id === "kitchen" && updates.at(-1).temperature_entity_id, `area update: ${JSON.stringify(updates)}`);
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

  const toPage = (p) =>
    page.evaluate(([x, y]) => {
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      const v = window.panel._view;
      return { x: r.left + x * v.scale + v.ox, y: r.top + y * v.scale + v.oy };
    }, p);
  const typeInto = async (label, value) => {
    const input = page.locator("homeslice-panel .inspector label", { hasText: label }).locator("input");
    await input.fill(String(value));
    await input.dispatchEvent("change");
  };

  await test("lengths: every room shows its inside lengths; typing one moves the wall", async () => {
    await page.keyboard.press("Escape");
    const dims = await page.locator("homeslice-panel svg.plan text.room-dim").allTextContents();
    // the hall inside its walls: 0.36 m outside wall, half of a 0.12 m inside wall
    const hallWidth = (await room("hall")).rect[2];
    const inside = (hallWidth - 0.42).toFixed(2);
    assert(dims.length > 8 && dims.includes(inside), `lengths: ${dims.join(", ")} (hall ${inside})`);
    const toggle = page.locator('homeslice-panel aside.tools button[aria-label="Show lengths"]');
    await toggle.click();
    assert((await page.locator("homeslice-panel svg.plan text.room-dim").count()) === 0, "lengths not hidden");
    await toggle.click();
    const hb = await page.locator('homeslice-panel svg.plan g[data-room="hall"] polygon').boundingBox();
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height * 0.75);
    const kitchen = await room("kitchen");
    await page.locator("homeslice-panel svg.plan text.dim.editable", { hasText: inside }).first().click();
    const input = page.locator("homeslice-panel svg.plan input.dim-input");
    assert(await input.isVisible(), "no field to type the length");
    await input.fill((Number(inside) + 0.2).toFixed(2));
    await input.press("Enter");
    const hall = await room("hall");
    assert(Math.abs(hall.rect[2] - (hallWidth + 0.2)) < 1e-6, `hall: ${JSON.stringify(hall)}`);
    assert(Math.abs((await room("kitchen")).rect[2] - (kitchen.rect[2] - 0.2)) < 1e-6, "the kitchen did not follow the wall");
    await shot(page, "editor-lengths");
    await page.keyboard.press("Control+z");
  });

  await test("doors & windows: the distances to the corners and the width can be typed", async () => {
    await page.locator("homeslice-panel .segmented.modes button", { hasText: "Doors & windows" }).click();
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.opening-hit")].find((x) => JSON.parse(x.dataset.opening).room === "hall");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    const dims = await page.locator("homeslice-panel svg.plan g.opening-dims text").allTextContents();
    // the hall door: 1 m from the room's west end (0.36 m of it is the outside wall), 1 m wide
    const rest = ((await room("hall")).rect[2] - 0.06 - 2).toFixed(2);
    assert(JSON.stringify(dims) === JSON.stringify(["0.64", "1.00", rest]), `door distances: ${dims.join(", ")} (expected …, ${rest})`);
    await page.locator("homeslice-panel svg.plan g.opening-dims text", { hasText: rest }).click();
    const input = page.locator("homeslice-panel svg.plan input.dim-input");
    await input.fill("0.5");
    await input.press("Enter");
    const door = (await model()).levels[0].openings.find((o) => o.room === "hall");
    assert(Math.abs(door.at - (1 + Number(rest) - 0.5)) < 1e-6 && door.width === 1, `door: ${JSON.stringify(door)}`);
    await shot(page, "editor-opening-lengths");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  await test("doors & windows: house-wide defaults for sill and height", async () => {
    const sill = page.locator('homeslice-panel .inspector input[aria-label="Window Sill (m)"]');
    await sill.fill("0");
    await sill.dispatchEvent("change");
    assert((await model()).opening_defaults?.window?.sill === 0, `defaults: ${JSON.stringify((await model()).opening_defaults)}`);
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel .segmented.modes button", { hasText: "Rooms & walls" }).click();
  });

  await test("measuring between two points", async () => {
    await page.keyboard.press("m");
    const a = await toPage([1, 7]);
    const b = await toPage([4, 7]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    const label = await page.locator("homeslice-panel svg.plan g.measure text").textContent();
    assert(label === "3.00 m", `measured: ${label}`);
    await shot(page, "editor-measure");
    await page.keyboard.press("Escape");
    assert((await page.locator("homeslice-panel svg.plan g.measure").count()) === 0, "measurement not cleared");
  });

  await test("a free-standing wall: draw, change its thickness, delete", async () => {
    await page.keyboard.press("w");
    const a = await toPage([1, 8]);
    const b = await toPage([3.5, 8.05]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    const walls = () => model().then((m) => m.levels[0].walls ?? []);
    const drawn = (await walls()).find((w) => w.line);
    // nearly horizontal becomes horizontal
    assert(drawn && drawn.line[0][1] === drawn.line[1][1] && Math.abs(drawn.line[1][0] - drawn.line[0][0] - 2.5) < 0.06, `wall: ${JSON.stringify(drawn)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Free-standing wall", "free wall not selected");
    await typeInto("Thickness (cm)", 8);
    assert((await walls()).find((w) => w.line)?.thickness === 0.08, `thickness: ${JSON.stringify(await walls())}`);
    await shot(page, "editor-free-wall");
    await page.locator("homeslice-panel .inspector button", { hasText: "Delete wall" }).click();
    assert(!(await walls()).some((w) => w.line), "free wall not deleted");
  });

  await test("building settings: wall thickness, neighbours, floor slab, one wall's own thickness", async () => {
    await page.keyboard.press("Escape");
    const outer = await page.evaluate(() => {
      const r = window.panel.shadowRoot.querySelector("svg.plan line.wall-hit[data-outline]").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(outer.x, outer.y);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Outside walls", "outline not selected");
    await typeInto("Outside (cm)", 42);
    assert((await model()).walls?.exterior === 0.42, `walls: ${JSON.stringify((await model()).walls)}`);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "west" }).locator("input").check();
    assert(JSON.stringify((await model()).party_walls) === JSON.stringify(["east", "west"]), `party: ${JSON.stringify((await model()).party_walls)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    assert(!(await model()).walls && JSON.stringify((await model()).party_walls) === JSON.stringify(["east"]), `undo did not restore the walls: ${JSON.stringify((await model()).walls)} ${JSON.stringify((await model()).party_walls)}`);
    await page.keyboard.press("Escape");
    await typeInto("Floor slab (cm)", 30);
    assert((await model()).levels[0].slab === 0.3, `slab: ${(await model()).levels[0].slab}`);
    await page.keyboard.press("Control+z");
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-wall]")].find((x) => {
        const w = JSON.parse(x.dataset.wall);
        return [w.a, w.b].sort().join() === "hall,kitchen";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    await typeInto("Thickness (cm)", 24);
    const own = (await model()).levels[0].walls?.find((w) => w.thickness);
    assert(own?.thickness === 0.24 && own.type === "wall", `wall: ${JSON.stringify((await model()).levels[0].walls)}`);
    const dims = await page.locator("homeslice-panel svg.plan text.room-dim").allTextContents();
    // the hall loses another 6 cm to the thicker wall
    const thinner = ((await room("hall")).rect[2] - 0.36 - 0.12).toFixed(2);
    assert(dims.includes(thinner), `hall after the thicker wall: ${dims.join(", ")} (expected ${thinner})`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    assert(errors.length === 0, errors.join(" | "));
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

  await test("stairs: select, move, change shape, draw new ones and delete them", async () => {
    await page.keyboard.press("Escape");
    const stair = () => page.evaluate(() => window.panel._model.vertical.find((v) => v.id === "stairs"));
    const before = await stair();
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    const { scale, ox, oy } = await page.evaluate(() => window.panel._view);
    const at = (x, y) => [plan.x + ox + x * scale, plan.y + oy + y * scale];
    const [cx, cy] = [before.rect[0] + before.rect[2] / 2, before.rect[1] + before.rect[3] / 2];
    await page.mouse.move(...at(cx, cy));
    await page.mouse.down();
    await page.mouse.move(...at(cx - 0.5, cy), { steps: 6 });
    await page.mouse.up();
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Stairs", "stairs not selected");
    const moved = await stair();
    assert(Math.abs(moved.rect[0] - (before.rect[0] - 0.5)) < 0.06 && moved.rect[1] === before.rect[1], `moved: ${JSON.stringify(moved.rect)}`);
    await page.locator("homeslice-panel .inspector select").nth(3).selectOption("u_turn");
    assert((await stair()).shape === "u_turn" && (await stair()).start, `shape: ${JSON.stringify(await stair())}`);
    await shot(page, "editor-stairs");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await stair()) === JSON.stringify(before), "undo didn't restore the stairs");

    await page.keyboard.press("Escape");
    await page.keyboard.press("s");
    await page.mouse.move(...at(0.5, 5));
    await page.mouse.down();
    await page.mouse.move(...at(1.5, 8), { steps: 5 });
    await page.mouse.up();
    const added = await page.evaluate(() => window.panel._model.vertical.at(-1));
    assert(added.id === "stairs_2" && added.from === "ground" && added.to === "first" && added.up === "south", `added: ${JSON.stringify(added)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Stairs", "new stairs not selected");
    await page.keyboard.press("Delete");
    assert((await page.evaluate(() => window.panel._model.vertical.length)) === 1, "stairs not deleted");
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("objects mode: lights are placed automatically and can be dragged into another room", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel .modes button", { hasText: "Objects" }).click();
    const markers = page.locator("homeslice-panel svg.plan g.lamp-marker");
    assert((await markers.count()) >= 3, `lamp markers: ${await markers.count()}`);
    assert((await page.locator("homeslice-panel svg.plan g.lamp-marker.placed").count()) === 0, "nothing is placed yet");
    const reading = page.locator('homeslice-panel svg.plan g.lamp-marker[data-light*="reading_lamp"] circle').first();
    const box = await reading.boundingBox();
    const kitchen = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(kitchen.x + kitchen.width * 0.3, kitchen.y + kitchen.height * 0.4, { steps: 8 });
    const hint = await page.locator("homeslice-panel .hint").textContent();
    await page.mouse.up();
    assert(hint.includes("Reading lamp") && hint.includes("Kitchen"), `hint: ${hint}`);
    const k = await room("kitchen");
    assert(k.lights?.[0]?.entity === "light.reading_lamp" && k.lights[0].at, `kitchen lights: ${JSON.stringify(k.lights)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Kitchen", "kitchen not selected");
    await shot(page, "editor-lights");
    // back to automatic: it stays in the kitchen, spread with the kitchen's own light
    await page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Reading lamp" }).locator("button", { hasText: "Auto" }).click();
    assert(JSON.stringify((await room("kitchen")).lights) === '[{"entity":"light.reading_lamp"}]', `after auto: ${JSON.stringify((await room("kitchen")).lights)}`);
    // removing it sends it back to its own area's room
    await page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Reading lamp" }).locator("button", { hasText: "Remove" }).click();
    assert(!(await room("kitchen")).lights, "kitchen still lists the lamp");
    // hiding an area light
    await page.locator("homeslice-panel .inspector ul.lights li").first().locator("button", { hasText: "Hide" }).click();
    assert((await room("kitchen")).lights?.[0]?.hidden === true, "not hidden");
    await page.locator("homeslice-panel .inspector ul.lights li.hidden button").click();
    assert(!(await room("kitchen")).lights, "hidden entry not removed by Show");
    await page.locator("homeslice-panel .modes button", { hasText: "Rooms" }).click();
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("objects mode: add furniture, drag it into another room, turn and delete it", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel .modes button", { hasText: "Objects" }).click();
    const kb = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.click(kb.x + kb.width * 0.8, kb.y + kb.height * 0.85);
    await page.locator("homeslice-panel .inspector label", { hasText: "Add furniture" }).locator("select").selectOption("table");
    assert((await room("kitchen")).furniture?.[0]?.type === "table", `kitchen: ${JSON.stringify((await room("kitchen")).furniture)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Table", "new table not selected");
    const piece = await page.locator("homeslice-panel svg.plan g.furniture.selected rect").boundingBox();
    const living = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    // grab it off-centre: the room's lamp hangs over the middle
    await page.mouse.move(piece.x + 6, piece.y + 6);
    await page.mouse.down();
    await page.mouse.move(living.x + living.width * 0.3, living.y + living.height * 0.8, { steps: 8 });
    await page.mouse.up();
    assert(!(await room("kitchen")).furniture && (await room("living")).furniture?.[0]?.type === "table", "table not moved into the living room");
    await page.keyboard.press("r");
    assert((await room("living")).furniture[0].rotation === 90, "not turned");
    await shot(page, "editor-furniture");
    await page.keyboard.press("Delete");
    assert(!(await room("living")).furniture, "not deleted");
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel .modes button", { hasText: "Rooms" }).click();
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("objects mode: place energy items from HA's energy settings", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel .modes button", { hasText: "Objects" }).click();
    const offers = await page.locator("homeslice-panel .inspector ul.offers li .name").allTextContents();
    assert(["Solar", "Battery", "Grid", "Inverter", "Heat pump"].every((n) => offers.includes(n)), `offers: ${offers}`);
    await page.locator("homeslice-panel .inspector ul.offers li", { hasText: "Battery" }).locator("button").click();
    assert((await page.locator("homeslice-panel .help").textContent()).includes("Click where Battery is"), "no placing hint");
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    const { scale, ox, oy } = await page.evaluate(() => window.panel._view);
    await page.mouse.click(plan.x + ox + 1 * scale, plan.y + oy + 1 * scale);
    let energy = (await model()).energy;
    assert(energy?.length === 1 && energy[0].kind === "battery" && energy[0].level === "ground" && Math.abs(energy[0].at[0] - 1) < 0.06, `energy: ${JSON.stringify(energy)}`);
    // drag it 1 m east
    const marker = await page.locator("homeslice-panel svg.plan g.energy-marker rect").boundingBox();
    await page.mouse.move(marker.x + 11, marker.y + 11);
    await page.mouse.down();
    await page.mouse.move(marker.x + 11 + scale, marker.y + 11, { steps: 5 });
    await page.mouse.up();
    energy = (await model()).energy;
    assert(Math.abs(energy[0].at[0] - 2) < 0.06, `moved: ${JSON.stringify(energy[0].at)}`);
    await page.locator("homeslice-panel .inspector ul.offers li", { hasText: "Solar" }).locator("button").click();
    assert((await model()).energy[1].kind === "solar", "solar not added");
    await shot(page, "editor-energy");
    await page.locator("homeslice-panel .inspector ul.energy li", { hasText: "Battery" }).locator("button").click();
    assert((await model()).energy.length === 1, "battery not removed");
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel .modes button", { hasText: "Rooms" }).click();
    assert(errors.length === 0, errors.join(" | "));
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

console.log("editor, unsaved changes");
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate((f) => window.setupPanel(f), loadFixture("dev/fixtures/demo-hass.json"));
  await test("unsaved changes survive a reload and can be restored", async () => {
    await page.evaluate(() => {
      const p = window.panel;
      const m = structuredClone(p._model);
      m.levels[0].rooms[0].name = "Draft name";
      p.commit(m);
    });
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForFunction(() => window.ready);
    await page.evaluate((f) => window.setupPanel(f), loadFixture("dev/fixtures/demo-hass.json"));
    await page.waitForSelector("homeslice-panel .draft");
    await page.locator("homeslice-panel .draft button", { hasText: "Restore" }).click();
    assert((await page.evaluate(() => window.panel._model.levels[0].rooms[0].name)) === "Draft name", "draft not restored");
    assert(await page.locator("homeslice-panel button.save.dirty").count(), "restored draft should be unsaved");
    await page.locator("homeslice-panel button.save").click();
    await page.waitForTimeout(700);
    assert((await page.evaluate(() => localStorage.getItem("homeslice-draft:demo"))) === null, "draft kept after saving");
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

  await test("floor plan image: upload, scale from two points, move, turn, remove", async () => {
    await page.keyboard.press("Escape");
    // a 400 × 200 test image
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 200;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 400, 200);
      ctx.fillStyle = "#000";
      ctx.fillRect(100, 98, 200, 4);
      return c.toDataURL("image/png");
    });
    await page.locator("homeslice-panel .inspector label.file input").setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") });
    await page.waitForSelector("homeslice-panel svg.plan image.underlay");
    assert((await page.locator("homeslice-panel .calib").textContent()).includes("Click the start"), "calibration not started");
    const screenOf = (px) =>
      page.evaluate((px) => {
        const p = window.panel;
        const [x, y] = p.toScreen(p.underlayToPlan(p._underlay, px));
        const r = p.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
        return [r.left + x, r.top + y];
      }, px);
    await page.mouse.click(...(await screenOf([100, 100])));
    await page.mouse.click(...(await screenOf([300, 100])));
    await page.locator("homeslice-panel .calib input.calib-distance").fill("4");
    await page.locator("homeslice-panel .calib button.primary").click();
    const placed = await page.evaluate(() => window.panel._underlay.place);
    assert(Math.abs(placed.scale - 0.02) < 1e-6, `scale: ${placed.scale}`);
    // moving is on after scaling
    const scale = await page.evaluate(() => window.panel._view.scale);
    const from = await screenOf([200, 150]);
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(from[0] + scale, from[1], { steps: 4 });
    await page.mouse.up();
    const moved = await page.evaluate(() => window.panel._underlay.place.origin);
    assert(Math.abs(moved[0] - placed.origin[0] - 1) < 0.02, `moved: ${JSON.stringify(moved)} from ${JSON.stringify(placed.origin)}`);
    await shot(page, "editor-underlay");
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel .inspector button[aria-label='Turn right 90°']").click();
    assert((await page.evaluate(() => window.panel._underlay.place.rotation)) === 90, "not turned");
    const stored = await page.evaluate(() => window.panel.hass.callWS({ type: "homeslice/underlay/get", house: "test_house", level: "ground_floor" }));
    assert(stored?.place?.rotation === 90 && Math.abs(stored.place.scale - 0.02) < 1e-6, `stored: ${JSON.stringify(stored?.place)}`);
    await page.locator("homeslice-panel .inspector button", { hasText: "Remove image" }).click();
    assert(!(await page.locator("homeslice-panel svg.plan image.underlay").count()), "image still shown");
  });

  await test("house settings: YAML in and out, invalid YAML is explained", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "House settings", "settings not shown");
    const yaml = await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      m.levels[1].rooms[0].name = "Renamed";
      return JSON.stringify(m); // JSON is YAML too
    });
    await page.locator("homeslice-panel textarea.yaml").fill("levels: [oops");
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    assert(await page.locator("homeslice-panel ul.problems li").count(), "no problem shown for broken YAML");
    await page.locator("homeslice-panel textarea.yaml").fill("schema: 1\nid: x\nlevels:\n  - id: g\n    rooms:\n      - { id: a }");
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    const problems = await page.locator("homeslice-panel ul.problems").textContent();
    assert(problems.includes("rect"), `expected a fix-it message: ${problems}`);
    await page.locator("homeslice-panel textarea.yaml").fill(yaml);
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    assert((await model()).levels[1].rooms[0].name === "Renamed", "pasted YAML not applied");
    assert((await model()).id === "test_house", "id must stay");
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    const download = page.waitForEvent("download");
    await page.locator("homeslice-panel .inspector button", { hasText: "Download .glb" }).click();
    const file = await download;
    assert(file.suggestedFilename() === "test_house.glb", `file: ${file.suggestedFilename()}`);
    const bytes = readFileSync(await file.path());
    assert(bytes.subarray(0, 4).toString() === "glTF" && bytes.length > 10000, `glb: ${bytes.length} bytes`);
    await page.keyboard.press("Escape");
  });

  await test("a level can start from the one below", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel button.level", { hasText: "First Floor" }).click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Start from the level below" }).click();
    const ground = (await lvl("ground_floor")).rooms.filter((r) => r.kind !== "outdoor");
    const first = (await lvl("first_floor")).rooms;
    assert(first.length === ground.length && first.every((r) => !r.area_id), `copied: ${JSON.stringify(first)}`);
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel button.level", { hasText: "Ground Floor" }).click();
  });

  await test("levels: height, add above, delete", async () => {
    await page.keyboard.press("Escape");
    const height = page.locator("homeslice-panel .inspector label", { hasText: "Storey height" }).locator("input");
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

  await test("deleting the house goes back to the start", async () => {
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Delete house" }).click();
    await page.waitForSelector("homeslice-panel .empty button.primary");
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
