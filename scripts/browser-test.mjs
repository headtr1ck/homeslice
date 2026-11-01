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
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";

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
    // first let the card settle (pieces still being drawn redraw it once)
    await page.evaluate(async () => {
      await window.card.renderer.modelsReady();
      let last = performance.now();
      const seen = () => (last = performance.now());
      window.card.addEventListener("homeslice-rendered", seen);
      while (performance.now() - last < 600) await new Promise((r) => setTimeout(r, 100));
      window.card.removeEventListener("homeslice-rendered", seen);
    });
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
    // five changes: not one redraw each (one stray frame on a slow machine is no harm)
    assert(draws <= 1, `${draws} redraws for a media player the card doesn't show`);
  });

  await test("labels show the area temperature", async () => {
    const temp = await page.locator("homeslice-card .label button.name", { hasText: "Living Room" }).locator(".temp").textContent();
    assert(temp === "21.4 °C", `living room temperature label: ${temp}`);
  });

  await test("rooms show presence, and alarms in red", async () => {
    const label = (name) => page.locator("homeslice-card .label", { has: page.locator("button.name", { hasText: name }) });
    assert((await label("Kitchen").locator("ha-icon.presence").count()) === 1, "no presence mark in the kitchen");
    assert((await label("Kids Room").locator("ha-icon.presence").count()) === 0, "presence mark without motion");
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "binary_sensor.kids_room_leak": { ...h.states["binary_sensor.kids_room_leak"], state: "on" } } };
      }),
    );
    assert(await label("Kids Room").evaluate((el) => el.classList.contains("alert")), "leak not shown on the kids room");
    await shot(page, "demo-alarm");
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "binary_sensor.kids_room_leak": { ...h.states["binary_sensor.kids_room_leak"], state: "off" } } };
      }),
    );
    assert(!(await label("Kids Room").evaluate((el) => el.classList.contains("alert"))), "alarm stays after the leak is gone");
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

  await test("room labels show the chosen readings, stale air with a dot", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, values: ["temperature", "humidity", "carbon_dioxide"] });
      window.card.hass = window.card.hass;
    });
    const label = page.locator("homeslice-card .label", { hasText: "Living Room" }).first();
    await page.waitForFunction(() => document.querySelector("homeslice-card").shadowRoot.textContent.includes("1240 ppm"), null, { timeout: 5000 });
    const text = (await label.locator("span.temp").textContent()).replace(/\s+/g, " ");
    assert(text.includes("21.4 °C · 48% · 1240 ppm"), `label: ${text}`);
    assert((await label.locator("i.dot").count()) === 1, "no dot for the stale air");
    await shot(page, "demo-values");
    await page.evaluate(() => {
      const { values, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
  });

  await test("lamp buttons are bare bulbs, or bulbs in a circle with lamp_style: circle", async () => {
    const background = () => page.evaluate(() => getComputedStyle(document.querySelector("homeslice-card").shadowRoot.querySelector(".lamp")).backgroundColor);
    assert((await background()) === "rgba(0, 0, 0, 0)", `bare lamp background ${await background()}`);
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, lamp_style: "circle" });
      window.card.requestUpdate();
    });
    await page.waitForFunction(() => document.querySelector("homeslice-card").shadowRoot.querySelector("ha-card:not(.bare-lamps)"));
    assert((await background()) !== "rgba(0, 0, 0, 0)", "no circle");
    await page.evaluate(() => {
      const { lamp_style, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  await test("wall tablet: back to the start view when idle, a clock, dimmed at night", async () => {
    const now = new Date();
    const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const night = `${hhmm(new Date(now - 3600e3))}-${hhmm(new Date(+now + 3600e3))}`;
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await page.evaluate((night) => window.card.setConfig({ ...window.card.config, idle_return: 1, clock: true, night }), night);
    // a touch starts the idle time
    await page.evaluate(() => window.card.dispatchEvent(new PointerEvent("pointerdown")));
    await page.waitForFunction(() => window.card._level === null, null, { timeout: 5000 });
    const clock = await page.locator("homeslice-card .clock").textContent();
    assert(/\d\d:\d\d/.test(clock), `clock: ${clock}`);
    assert(await page.locator("homeslice-card ha-card.night-dim").count(), "not dimmed at night");
    await page.evaluate(() => {
      const { idle_return, clock, night, ...config } = window.card.config;
      window.card.setConfig(config);
    });
    await page.waitForFunction(() => !window.card.shadowRoot.querySelector("ha-card.night-dim"));
  });

  await test("room_panel: false keeps rooms from opening their panel", async () => {
    await page.evaluate(() => (window.card.config.room_panel = false));
    await page.locator("homeslice-card .label button.name", { hasText: "Garden" }).click();
    await page.waitForTimeout(300);
    const open = await page.locator("homeslice-card .popup").count();
    await page.evaluate(() => delete window.card.config.room_panel);
    assert(open === 0, "a room opened its panel");
  });

  await test("a stairwell is a dark shaft while the floor below is hidden", async () => {
    const wells = () => page.evaluate(() => window.card.renderer.levels.map((l) => l.group.children.filter((c) => c.userData.well).map((c) => c.visible)));
    const all = await wells();
    assert(all[1].length > 0 && all[1].every((v) => !v), `overview wells: ${JSON.stringify(all)}`);
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    await page.waitForFunction(() => !window.card.renderer.levels[0].group.visible, null, { timeout: 5000 });
    const focused = await wells();
    assert(focused[1].every((v) => v), `first floor wells: ${JSON.stringify(focused)}`);
    await shot(page, "demo-well");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
  });

  await test("a room without devices shows a hint", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    // one floor on its own: the ground floor has sunk away and is not drawn at all
    await page.waitForFunction(() => !window.card.renderer.levels[0].group.visible, null, { timeout: 5000 });
    assert(await page.evaluate(() => window.card.renderer.levels[0].lift < -1), "the floor below did not sink away");
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

  await test("a right click on a lamp opens its details", async () => {
    await page.evaluate(() => {
      window.moreInfo = [];
      window.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId));
    });
    await page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click({ button: "right" });
    assert((await page.evaluate(() => window.moreInfo)).includes("light.reading_lamp"), "no details on right click");
    assert((await state(page, "light.reading_lamp")) === "off", "right click toggled the lamp");
  });

  await test("own tap and hold actions go to HA's action handler instead of toggling", async () => {
    await page.evaluate(() => {
      window.actions = [];
      window.addEventListener("hass-action", (e) => window.actions.push(e.detail));
      window.card.setConfig({ ...window.card.config, actions: { "light.reading_lamp": { tap_action: { action: "more-info" } } } });
    });
    await page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click();
    await page.waitForTimeout(400);
    const actions = await page.evaluate(() => window.actions);
    assert(actions.length === 1 && actions[0].action === "tap" && actions[0].config.entity === "light.reading_lamp" && actions[0].config.tap_action.action === "more-info", `actions: ${JSON.stringify(actions)}`);
    assert((await state(page, "light.reading_lamp")) === "off", "the lamp toggled anyway");
    await page.evaluate(() => {
      const { actions, ...config } = window.card.config;
      window.card.setConfig(config);
    });
  });

  await test("shortcut buttons toggle, run scripts, and show only on their floor", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, buttons: [{ entity: "light.kitchen", name: "Kitchen" }, { entity: "script.night", name: "Night" }, { entity: "light.living_room", level: "first" }] });
      window.card.requestUpdate();
    });
    const buttons = page.locator("homeslice-card .shortcuts button");
    await page.waitForFunction(() => window.card.shadowRoot.querySelectorAll(".shortcuts button").length === 2);
    const before = await state(page, "light.kitchen");
    await act(page, () => buttons.filter({ hasText: "Kitchen" }).click());
    assert((await state(page, "light.kitchen")) !== before, "kitchen light not toggled");
    await buttons.filter({ hasText: "Night" }).click();
    await page.waitForTimeout(100);
    const ran = await page.evaluate(() => window.card.hass.calls.filter((c) => c.domain === "script").map((c) => c.target?.entity_id ?? c.data?.entity_id));
    assert(ran.includes("script.night"), `script not run: ${JSON.stringify(ran)}`);
    await act(page, () => buttons.filter({ hasText: "Kitchen" }).click());
    await page.evaluate(() => {
      const { buttons, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  await test("'All floors' returns to the overview camera", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 38 && o.azimuth === 250 && o.fov === 3, `overview camera ${JSON.stringify(o)}`);
  });

  await test("hovering a floor highlights it; the floors above slide away and fade out", async () => {
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
    await page.waitForFunction(() => window.card.renderer.levels[1].hoverOpacity === 0, null, { timeout: 10000 });
    const state = await page.evaluate(() => ({
      hover: window.card.renderer.hoveredIndex,
      above: window.card.renderer.levels[1].hoverOpacity,
      below: window.card.renderer.levels[0].hoverOpacity,
    }));
    assert(state.hover === 0 && state.above === 0 && state.below === 1, `hover state ${JSON.stringify(state)}`);
    assert(await page.evaluate(() => !window.card.renderer.levels[1].group.visible && window.card.renderer.levels[1].hoverLift > 0.5), "the floor above is not lifted away and hidden");
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
  });
  await test("view buttons turn and tilt; a kept view is the start view on this device", async () => {
    const views = page.locator("homeslice-card .views button");
    assert((await views.count()) === 5, `view buttons: ${await views.count()}`);
    await views.nth(3).click(); // turn right
    await page.waitForFunction(() => Math.abs(window.card.renderer.orientation.azimuth - 340) < 0.5, null, { timeout: 5000 });
    await views.nth(1).click(); // from above
    await page.waitForFunction(() => Math.abs(window.card.renderer.orientation.elevation - 89) < 0.5, null, { timeout: 5000 });
    await views.nth(2).click(); // tilted
    await page.waitForFunction(() => Math.abs(window.card.renderer.orientation.elevation - 35) < 0.5, null, { timeout: 5000 });
    await views.nth(4).click(); // keep
    assert((await page.locator("homeslice-card .readout").textContent()).includes("Start view kept"), "no confirmation");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("homeslice-view:demo") ?? localStorage.getItem("homeslice-view:home") ?? "null"));
    assert(saved?.all?.azimuth === 340 && saved.all.elevation === 35, `saved: ${JSON.stringify(saved)}`);
    // reset goes to the kept view now, and so does a new card
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 5 });
    await page.mouse.up();
    await act(page, () => page.mouse.dblclick(cx, cy));
    const c = await camera();
    assert(c.azimuth === 340 && c.elevation === 35, `reset to the kept view: ${JSON.stringify(c)}`);
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("homeslice-view")).forEach((k) => localStorage.removeItem(k)));
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
    // counted once every piece is drawn in detail, before and after
    await page.evaluate(() => window.card.renderer.modelsReady());
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [
          { type: "sofa", at: [2, 4] },
          { type: "table", at: [3, 2], rotation: 90 },
          { type: "plant", at: [0.5, 0.5] },
        ];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
    assert(after > before + 50, `triangles ${before} → ${after}`);
  });
  await test("detailed furniture: every type gets its built-in piece, drawn to its size", async () => {
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
      for (const g of level.children)
        if (g.children[0]?.userData.detailed) {
          let meshes = 0;
          g.children[0].traverse((o) => o.isMesh && meshes++);
          out.push({ meshes });
        }
      return out;
    });
    // the demo garden has four pieces of its own
    assert(pieces.length === types.length + 4, `${pieces.length} of ${types.length} + 4 pieces detailed`);
    // the 2.4 m kitchen counter is a row of units with fronts, a sink and a hob
    assert(pieces[types.indexOf("kitchen")].meshes >= 12, `kitchen parts: ${pieces[types.indexOf("kitchen")].meshes}`);
    await shot(page, "demo-furniture-detailed");
  });
  await test("painted floors and walls: finishes per room, an accent wall, the facade", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        const rooms = m.levels[0].rooms;
        const living = rooms.find((r) => r.id === "living");
        Object.assign(living, { floor: "oak_herringbone", wall: "paint_sage", wall_sides: { north: "acoustic_oak" } });
        const kitchen = rooms.find((r) => r.id === "kitchen");
        if (kitchen) Object.assign(kitchen, { floor: "terrazzo", wall: "tile_subway" });
        m.facade = "brick_red";
        window.card.hass.pushModel(m);
      }),
    );
    const looks = await page.evaluate(() => {
      const found = new Set();
      window.card.renderer.object.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.map?.image?.width === 512) found.add(m.map.uuid);
      });
      return found.size;
    });
    // herringbone, terrazzo, sage paint (no texture), oak slats, subway tiles, brick
    assert(looks >= 5, `${looks} finish textures in the scene`);
    await shot(page, "demo-painted");
  });
  await test("linked devices: a TV's screen, curtains with their cover, an outdoor unit's fan", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [
          { type: "tv", model: "modern:tv_wall", at: [2, 0.3], entity: "media_player.living_room_tv" },
          { type: "item", model: "modern:curtains", at: [3, 0.2], entity: "cover.living_room" },
          { type: "item", model: "modern:ac_outdoor", at: [1, 2], entity: "climate.living_room" },
          { type: "item", model: "modern:radiator_panel", at: [0.6, 0.1], entity: "climate.living_room" },
          { type: "item", model: "modern:speaker_floor", at: [3.2, 0.3], entity: "media_player.living_room_tv" },
        ];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const state = (e) => page.evaluate((e) => window.card.renderer.deviceState(e), e);
    // the TV is off: a dark screen; on: lit
    assert((await state("media_player.living_room_tv"))?.lit === false, `tv off: ${JSON.stringify(await state("media_player.living_room_tv"))}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("media_player", "turn_on", {}, { entity_id: "media_player.living_room_tv" })));
    assert((await state("media_player.living_room_tv")).lit, "tv on but its screen is dark");
    // playing: the cover art on the screen, the speaker's woofers move
    await page.evaluate(() => {
      const h = window.card.hass;
      const tv = h.states["media_player.living_room_tv"];
      const art = document.createElement("canvas");
      art.width = art.height = 8;
      const g = art.getContext("2d");
      g.fillStyle = "#d33";
      g.fillRect(0, 0, 8, 8);
      h.states = { ...h.states, "media_player.living_room_tv": { ...tv, state: "playing", attributes: { ...tv.attributes, entity_picture: art.toDataURL() } } };
      window.card.hass = h;
    });
    await page.waitForFunction(() => window.card.renderer.deviceState("media_player.living_room_tv").picture, null, { timeout: 5000 });
    await page.waitForFunction(() => window.card.renderer.deviceState("media_player.living_room_tv").pulse.some((x) => x > 1.01), null, { timeout: 5000 });
    await shot(page, "demo-playing");
    // curtains: open as the blind is open, drawn closed when it closes
    assert((await state("cover.living_room")).curtains.every((x) => x === 1), `curtains open: ${(await state("cover.living_room")).curtains}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "close_cover", {}, { entity_id: "cover.living_room" })));
    assert((await state("cover.living_room")).curtains.every((x) => x > 1.5), `curtains closed: ${(await state("cover.living_room")).curtains}`);
    // the heat pump heats: its fan turns (the card animates), and stops when it is off
    const unit = await state("climate.living_room");
    assert(unit.turn.length === 1 && unit.lit, `outdoor unit: ${JSON.stringify(unit)}`);
    assert(await page.evaluate(() => window.card.renderer.spinning), "not spinning while heating");
    const warm = () => page.evaluate(() => window.card.renderer.devices.get("climate.living_room").flatMap((p) => p.materials).filter((m) => m.userData.part === "warm").map((m) => m.emissiveIntensity));
    assert((await warm()).length && (await warm()).every((x) => x > 0.2), `radiator not warm while heating: ${await warm()}`);
    await page.waitForFunction((t) => window.card.renderer.deviceState("climate.living_room").turn[0] !== t, unit.turn[0], { timeout: 8000 }).catch(() => {});
    assert((await state("climate.living_room")).turn[0] !== unit.turn[0], "the fan did not turn");
    await shot(page, "demo-devices");
    await act(page, () => page.evaluate(() => window.card.hass.callService("climate", "turn_off", {}, { entity_id: "climate.living_room" })));
    assert(!(await page.evaluate(() => window.card.renderer.spinning)), "still spinning when off");
    assert(!(await state("climate.living_room")).lit, "status light on when off");
    assert((await warm()).every((x) => x === 0), "radiator warm when off");
    await act(page, () =>
      page.evaluate(async () => {
        await window.card.hass.callService("media_player", "turn_off", {}, { entity_id: "media_player.living_room_tv" });
        await window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.living_room" });
        await window.card.hass.callService("climate", "turn_on", {}, { entity_id: "climate.living_room" });
      }),
    );
  });
  await test("a garage door rolls up with its cover, or opens with its contact alone", async () => {
    const garage = async (edit) => {
      await act(page, async () => {
        await page.evaluate((edit) => {
          const m = structuredClone(window.__demoModel);
          m.levels[0].openings[1] = { room: "kitchen", side: "north", at: 1.3, width: 2.4, type: "garage_door", ...edit };
          window.card.hass.pushModel(m);
        }, edit);
      });
      return () => page.evaluate(() => window.card.renderer.coverState("kitchen_north_1"));
    };
    const door = await garage({ cover: "cover.kitchen" });
    const height = (await door()).shutterHeight;
    // the kitchen cover is half open: half the door rolled up
    assert((await door()).shutterVisible && height > 0.5 && height < 1.5, `half-open garage door: ${JSON.stringify(await door())}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "close_cover", {}, { entity_id: "cover.kitchen" })));
    assert(Math.abs((await door()).shutterHeight - 2 * height) < 0.01, `closed garage door: ${JSON.stringify(await door())}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.kitchen" })));
    assert(!(await door()).shutterVisible, "open garage door still shown");
    await shot(page, "demo-garage-open");
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "set_cover_position", { position: 50 }, { entity_id: "cover.kitchen" })));
    // only a contact: closed while it is off
    const byContact = await garage({ contact: "binary_sensor.kids_room_leak" });
    assert((await byContact()).shutterVisible, `garage door with a closed contact: ${JSON.stringify(await byContact())}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" })));
    assert(!(await byContact()).shutterVisible, "garage door shown with its contact open");
    await act(page, () => page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" })));
  });
  await test("doors swing and windows tilt with their contacts", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        Object.assign(m.levels[0].openings[3], { contact: "binary_sensor.kids_room_leak" });
        Object.assign(m.levels[0].openings[4], { contact: "binary_sensor.kids_room_leak" });
        window.card.hass.pushModel(m);
      });
    });
    const leaves = () => page.evaluate(() => [window.card.renderer.leafState("living_south_3"), window.card.renderer.leafState("living_west_4")]);
    let [door, win] = await leaves();
    assert(door?.length === 1 && door[0].how === "swing" && door[0].open === 0, `closed door: ${JSON.stringify(door)}`);
    assert(win?.length === 1 && win[0].how === "tilt" && win[0].open === 0, `closed window: ${JSON.stringify(win)}`);
    await page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" }));
    // it opens over a moment, not at once
    await page.waitForFunction(() => window.card.renderer.leafState("living_south_3")[0].open > 0, null, { timeout: 10000 });
    [door] = await leaves();
    assert(door[0].open < 1, `door should open over a moment, not at once: ${JSON.stringify(door)}`);
    await page.waitForFunction(() => window.card.renderer.leafState("living_south_3")[0].open === 1, null, { timeout: 10000 });
    [door, win] = await leaves();
    assert(win[0].open === 1, `window not tilted: ${JSON.stringify(win)}`);
    await page.waitForTimeout(200);
    await shot(page, "demo-door-open");
    await page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" }));
    await page.waitForFunction(() => window.card.renderer.leafState("living_south_3")[0].open === 0, null, { timeout: 10000 });
  });
  await test("a window open in the rain is a note on its room; a power outage a warning", async () => {
    // (one sensor plays the rain, the window's contact and the outage)
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, rain: "binary_sensor.kids_room_leak", power_outage: "binary_sensor.kids_room_leak" });
      window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" });
    });
    await page.waitForSelector("homeslice-card .label.note", { timeout: 5000 });
    const note = await page.locator("homeslice-card .label.note button.name").textContent();
    assert(note.includes("Living Room"), `note on ${note}`);
    assert(await page.locator('homeslice-card .label.note ha-icon[icon="mdi:weather-pouring"]').count(), "no rain icon");
    assert((await page.locator("homeslice-card .outage").textContent()).includes("Power outage"), "no outage warning");
    await shot(page, "demo-rain");
    await page.evaluate(() => {
      window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" });
      const { rain, power_outage, ...config } = window.card.config;
      window.card.setConfig(config);
    });
    await page.waitForFunction(() => !window.card.shadowRoot.querySelector(".outage"));
  });
  await test("underfloor heating glows while it heats, only on cards that show heating", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").underfloor = "climate.living_room";
        window.card.hass.pushModel(m);
      });
    });
    const loops = () => page.evaluate(() => window.card.renderer.underfloorState("climate.living_room"));
    assert((await loops()).length === 1 && !(await loops())[0], `hidden without heating: ${await loops()}`);
    await act(page, () =>
      page.evaluate(() => {
        // the thermostat heats right now
        const h = window.card.hass;
        const c = h.states["climate.living_room"];
        h.states = { ...h.states, "climate.living_room": { ...c, state: "heat", attributes: { ...c.attributes, hvac_action: "heating" } } };
        window.card.setConfig({ ...window.card.config, heating: true });
        window.card.hass = h;
      }),
    );
    assert((await loops())[0], "no loops while heating");
    await shot(page, "demo-underfloor");
    await act(page, () => page.evaluate(() => window.card.hass.callService("climate", "turn_off", {}, { entity_id: "climate.living_room" })));
    assert(!(await loops())[0], "loops while off");
    await act(page, () =>
      page.evaluate(async () => {
        await window.card.hass.callService("climate", "turn_on", {}, { entity_id: "climate.living_room" });
        const { heating, ...config } = window.card.config;
        window.card.setConfig(config);
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
  });

  await test("a car is there only while it is home, with its charge and range above it", async () => {
    const set = (where) =>
      page.evaluate((where) => {
        const h = window.card.hass;
        const st = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
        h.states = { ...h.states, "device_tracker.car": st("device_tracker.car", where), "sensor.car_battery": st("sensor.car_battery", "82", { unit_of_measurement: "%" }), "sensor.car_range": st("sensor.car_range", "340", { unit_of_measurement: "km" }) };
        window.card.hass = h;
      }, where);
    await set("not_home");
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "car", model: "modern:car_hatchback", at: [3, 3], entity: "device_tracker.car", readings: ["sensor.car_battery", "sensor.car_range"] }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const shown = () => page.evaluate(() => window.card.renderer.devices.get("device_tracker.car").every((p) => p.piece.visible));
    assert(!(await shown()), "the car is drawn while away");
    assert(!(await page.locator("homeslice-card .piece-badge").count()), "a note for a car that is away");
    await set("home");
    await page.waitForFunction(() => window.card.renderer.devices.get("device_tracker.car").every((p) => p.piece.visible), null, { timeout: 5000 });
    await page.waitForSelector("homeslice-card .piece-badge", { timeout: 5000 });
    const note = await page.locator("homeslice-card .piece-badge").textContent();
    assert(note.includes("82%") && note.includes("340 km"), `car note: ${note}`);
    await shot(page, "demo-car");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  await test("weather: its badge, rain falling around the house, nothing when it clears", async () => {
    const set = (condition) =>
      page.evaluate((condition) => {
        const h = window.card.hass;
        h.states = { ...h.states, "weather.home": { entity_id: "weather.home", state: condition, attributes: { temperature: 7.5, temperature_unit: "°C", friendly_name: "Home" } } };
        window.card.setConfig({ ...window.card.config, weather: "weather.home" });
        window.card.hass = h;
      }, condition);
    await set("pouring");
    await page.waitForFunction(() => window.card.renderer.weatherFalling, null, { timeout: 5000 });
    const badge = await page.locator("homeslice-card .weather").textContent();
    assert(badge.includes("7.5 °C"), `weather badge: ${badge}`);
    assert(await page.locator('homeslice-card .weather ha-icon[icon="mdi:weather-pouring"]').count(), "no pouring icon");
    await page.waitForTimeout(300);
    await shot(page, "demo-rain-weather");
    await set("sunny");
    await page.waitForFunction(() => !window.card.renderer.weatherFalling, null, { timeout: 5000 });
    await page.evaluate(() => {
      const { weather, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
  });

  await test("sun path: an arc around the house with sunrise and sunset", async () => {
    if (await page.evaluate(() => window.card._level !== null)) await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    await page.evaluate(() => {
      const h = window.card.hass;
      h.config = { ...(h.config ?? {}), latitude: 48.4, longitude: 10.9 };
      window.card.setConfig({ ...window.card.config, sun_path: true, look: "night" });
      window.card.hass = h;
    });
    const sunState = () => page.evaluate(() => ({ group: !!window.card.renderer.sunPathGroup, key: window.card.sunPathKey, times: window.card.sunTimes.length, labels: window.card._sunTimes.length, level: window.card._level, conf: window.card.hass.config }));
    await page.waitForFunction(() => window.card.shadowRoot.querySelectorAll(".sun-time").length === 2, null, { timeout: 5000 }).catch(async () => assert(false, `sun path: ${JSON.stringify(await sunState())}`));
    const times = await page.locator("homeslice-card .sun-time").allTextContents();
    assert(times.every((t) => /\d\d:\d\d/.test(t)), `sun times: ${times}`);
    await shot(page, "demo-sun-path");
    await page.evaluate(() => {
      const { sun_path, look, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
    await page.waitForFunction(() => !window.card.renderer.sunPathGroup, null, { timeout: 5000 });
  });

  await test("at night a lit room's light falls out of its windows onto the garden", async () => {
    const keys = await page.evaluate(() => [...window.card.renderer.spills.keys()]);
    assert(keys.length > 0, "no windows onto an outdoor area in the demo house");
    const [levelId, roomId] = keys[0].split("/");
    const spill = () => page.evaluate(([l, r]) => window.card.renderer.spillState(l, r), [levelId, roomId]);
    await page.evaluate(([l, r]) => {
      window.card.renderer.setLook("day");
      window.card.renderer.setSun(180, 40);
      window.card.renderer.setRoomLight(l, r, { rgb: [255, 200, 140], brightness: 1 });
    }, [levelId, roomId]);
    assert((await spill()).every((x) => x < 0.05), `window light by day: ${await spill()}`);
    await page.evaluate(() => window.card.renderer.setLook("night"));
    assert((await spill()).every((x) => x > 0.3), `no window light at night: ${await spill()}`);
    await page.evaluate(() => window.card.renderer.draw());
    await shot(page, "demo-window-light");
    // back as the card says
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config });
      window.card.hass = window.card.hass;
    });
  });

  await test("time travel: replay the day, the house as it was, then back to now", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, time_travel: true });
      window.card.requestUpdate();
    });
    await page.locator("homeslice-card .time-travel-open").click();
    await page.waitForSelector("homeslice-card .time-travel input[type=range]", { timeout: 5000 });
    await page.waitForFunction(() => window.card._replay && !window.card._replay.loading);
    // the light was on in the second half's first quarter
    const lit = (fraction) =>
      page.evaluate((fraction) => {
        const r = window.card._replay;
        window.card.seekReplay(r.history.start + (r.history.end - r.history.start) * fraction);
        return window.card.renderer.roomLightState?.("ground", "living") ?? window.card.renderer.floors.get("ground/living").material.emissive.getHex() !== 0;
      }, fraction);
    assert(await lit(0.6), "the living room is not lit at the time its light was on");
    assert(!(await lit(0.2)), "lit before its light went on");
    assert((await page.locator("homeslice-card .time-travel .tick").count()) >= 2, "no event marks on the timeline");
    await shot(page, "demo-time-travel");
    await page.locator("homeslice-card .time-travel button", { has: page.locator('ha-icon[icon="mdi:close"]') }).click();
    assert(!(await page.locator("homeslice-card .time-travel").count()), "the timeline stays open");
    await page.evaluate(() => {
      const { time_travel, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  await test("homeslice.show (Assist: show the kitchen): the card flies there, then back", async () => {
    if (await page.evaluate(() => window.card._level !== null)) await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    await act(page, () => page.evaluate(() => window.card.hass.show({ area_id: "kids_room", seconds: 5 })));
    await page.waitForFunction(() => window.card._level === "first", null, { timeout: 5000 });
    const banner = await page.locator("homeslice-card .event").textContent();
    assert(banner.includes("Kids Room"), `banner: ${banner}`);
    await page.evaluate(() => {
      window.card.lastTouch = 0;
      return window.card.endEvent();
    });
    await page.waitForFunction(() => window.card._level === null, null, { timeout: 5000 });
  });

  await test("walking: eye level in a room, walls stop you, then back to the house", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, walk: true });
      window.card.requestUpdate();
    });
    await page.locator("homeslice-card .walk-open").click();
    await page.waitForFunction(() => !!window.card.renderer.walking, null, { timeout: 5000 });
    const eye = await page.evaluate(() => window.card.renderer.camera.position.y - window.card.renderer.levels[window.card.renderer.levelIds.indexOf(window.card.renderer.walking.levelId)].group.position.y);
    assert(Math.abs(eye - 1.6) < 0.01, `eye height ${eye}`);
    assert(!(await page.locator("homeslice-card .label").count()), "labels at eye level");
    // walk on until a wall stops it
    const at = () => page.evaluate(() => window.card.renderer.walking.at);
    const start = await at();
    for (let i = 0; i < 60; i++) await page.evaluate(() => window.card.walkStep(0.25, 0));
    const end = await at();
    assert(Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.2, `did not move: ${start} → ${end}`);
    const level = await page.evaluate(() => window.card.renderer.walking.levelId);
    const inside = await page.evaluate(([l, p]) => window.card.house.levels.find((x) => x.id === l).rooms.some((r) => {
      let c = false;
      const poly = r.polygon;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
      return c;
    }), [level, end]);
    assert(inside, `walked out of the house: ${end}`);
    // keys work too
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowRight");
    await shot(page, "demo-walk");
    await page.locator("homeslice-card .walk-close").click();
    await page.waitForFunction(() => !window.card.renderer.walking && !window.card.transitioning, null, { timeout: 5000 });
    await page.evaluate(() => {
      const { walk, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  await test("people stand in the room their sensor names, and leave when they are away", async () => {
    const set = (where, room) =>
      page.evaluate(([where, room]) => {
        const h = window.card.hass;
        h.states = { ...h.states, "person.alex": { entity_id: "person.alex", state: where, attributes: { friendly_name: "Alex" } }, "sensor.alex_area": { entity_id: "sensor.alex_area", state: room, attributes: {} } };
        window.card.setConfig({ ...window.card.config, people: [{ person: "person.alex", room: "sensor.alex_area" }] });
        window.card.hass = h;
      }, [where, room]);
    await set("home", "Kitchen");
    await page.waitForFunction(() => window.card.renderer.peopleState().length === 1, null, { timeout: 5000 });
    const [p] = await page.evaluate(() => window.card.renderer.peopleState());
    assert(p.level === "ground", `Alex on ${p.level}`);
    await set("home", "bedroom");
    await page.waitForFunction(() => window.card.renderer.peopleState()[0]?.level === "first", null, { timeout: 5000 });
    await set("not_home", "bedroom");
    await page.waitForFunction(() => window.card.renderer.peopleState().length === 0, null, { timeout: 5000 });
    await page.evaluate(() => {
      const { people, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
  });

  await test("other cards on the card: in front and behind, only on their floors", async () => {
    await page.evaluate(() => {
      window.card.setConfig({
        ...window.card.config,
        overlays: [
          { card: { type: "tile", entity: "light.kitchen" }, top: "10px", right: "10px", width: "200px" },
          { card: { type: "tile", entity: "light.living_room" }, bottom: "10px", left: "10px", layer: "behind", levels: ["first"] },
        ],
      });
      window.card.requestUpdate();
    });
    await page.waitForSelector("homeslice-card .card-overlay.front .fake-card", { timeout: 5000 });
    const front = await page.locator("homeslice-card .card-overlay.front").boundingBox();
    const card = await page.locator("homeslice-card .wrap").boundingBox();
    assert(Math.abs(front.x + front.width - (card.x + card.width - 10)) < 2 && Math.abs(front.y - (card.y + 10)) < 2, `front card at ${JSON.stringify(front)}`);
    const behindShown = () => page.evaluate(() => !window.card.shadowRoot.querySelector(".card-overlay.behind").classList.contains("hidden"));
    assert(!(await behindShown()) || (await page.evaluate(() => window.card._level)) === "first", "the behind card shows on another floor");
    await shot(page, "demo-overlays");
    await page.evaluate(() => {
      const { overlays, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  await test("layers: the viewer switches the heatmap on, and this device keeps it", async () => {
    await page.evaluate(() => {
      localStorage.removeItem("homeslice-layers:home");
      window.card.setConfig({ ...window.card.config, layers: ["heatmap", "values"] });
      window.card.requestUpdate();
    });
    await page.locator("homeslice-card .layers-open").click();
    await page.locator("homeslice-card .layers select").selectOption("temperature");
    await page.waitForFunction(() => window.card.config.heatmap === "temperature");
    // the card's own config again (a reload): the device's choice stays
    await page.evaluate(() => window.card.setConfig({ ...window.card.baseConfig }));
    assert((await page.evaluate(() => window.card.config.heatmap)) === "temperature", "the choice was not kept");
    await page.evaluate(() => {
      localStorage.removeItem("homeslice-layers:home");
      const { layers, heatmap, ...config } = window.card.baseConfig;
      window.card.setConfig(config);
      window.card._layersOpen = false;
      window.card.hass = window.card.hass;
    });
  });

  await test("dormers on the roof, a railing round a balcony", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.roof = { ...(m.roof ?? {}), dormers: [{ side: "south", at: 3 }, { side: "north", at: 5, shape: "shed" }, { side: "east", at: 3 }, { side: "west", at: 4, shape: "shed" }] };
        const garden = m.levels[0].rooms.find((r) => r.id === "garden");
        if (garden) garden.railing = "glass";
        window.viewBefore = window.card.config.view;
        window.card.setConfig({ ...window.card.config, view: { ...window.card.config.view, roof: true } });
        window.card.hass.pushModel(m);
      });
    });
    const roofParts = await page.evaluate(() => window.card.renderer.roof?.children.length ?? 0);
    assert(roofParts >= 3, `roof parts: ${roofParts}`);
    await shot(page, "demo-dormers");
    await act(page, () =>
      page.evaluate(() => {
        window.card.setConfig({ ...window.card.config, view: window.viewBefore });
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
  });

  await test("lamp gestures: drag to dim, hold for the room, tap toggles", async () => {
    const lamp = page.locator("homeslice-card .label", { has: page.locator("button.name", { hasText: "Living Room" }) }).locator("button.lamp");
    const box = await lamp.boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    const calls = () => page.evaluate(() => window.card.hass.calls.length);
    // drag up: brighter, the level shown while dragging, one call at the end
    const before = await calls();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 5 });
    await page.mouse.move(x, y - 75, { steps: 5 });
    assert((await page.locator("homeslice-card .dim").count()) === 1, "no brightness shown while dragging");
    await page.mouse.up();
    const call = await page.evaluate(() => window.card.hass.calls.at(-1));
    assert((await calls()) === before + 1 && call.domain === "light" && call.service === "turn_on" && call.data.brightness_pct >= 50, `dim call: ${JSON.stringify(call)}`);
    assert((await page.locator("homeslice-card .dim").count()) === 0, "brightness still shown");
    await page.waitForTimeout(100);
    assert((await calls()) === before + 1, "the drag also toggled");
    // drag all the way down: off
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 200, { steps: 8 });
    await page.mouse.up();
    assert((await page.evaluate(() => window.card.hass.calls.at(-1).service)) === "turn_off", "dragging down did not turn off");
    // hold: the room's popup with its lights
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForSelector("homeslice-card .popup", { timeout: 3000 });
    await page.keyboard.press("Escape");
    // a tap still toggles
    const n = await calls();
    await lamp.click();
    assert((await calls()) === n + 1, "tap did not toggle");
  });
  await test("light types: spots with their cones, an LED strip, indirect light on the walls", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        const rooms = m.levels[0].rooms;
        rooms.find((r) => r.id === "living").lights = [{ entity: "light.living_room", type: "spot", at: [1.5, 3], spots: [[2.5, 3], [3.5, 3]] }];
        rooms.find((r) => r.id === "kitchen").lights = [{ entity: "light.kitchen", type: "strip", at: [0.5, 0.4], to: [4.5, 0.4], height: 1.4 }];
        rooms.find((r) => r.id === "hall").lights = [{ entity: "light.hall", type: "indirect" }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(async () => {
        window.__wasOff = ["light.living_room", "light.kitchen", "light.hall"].filter((e) => window.card.hass.states[e].state !== "on");
        for (const e of window.__wasOff) await window.card.hass.callService("light", "turn_on", {}, { entity_id: e });
      });
    });
    const st = (e) => page.evaluate((e) => window.card.renderer.lampState(e), e);
    assert((await st("light.living_room")).count === 6 && (await st("light.living_room")).on, `spots: ${JSON.stringify(await st("light.living_room"))}`);
    assert((await st("light.kitchen")).count === 2, `strip: ${JSON.stringify(await st("light.kitchen"))}`);
    assert((await st("light.hall")).count >= 5, `indirect: ${JSON.stringify(await st("light.hall"))}`);
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await page.waitForTimeout(700);
    await shot(page, "demo-light-types");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await page.waitForTimeout(700);
    await act(page, () => page.evaluate(async () => {
      for (const e of window.__wasOff) await window.card.hass.callService("light", "turn_off", {}, { entity_id: e });
    }));
  });
  await test("cameras: what they see on the floor, red while their motion sensor is on", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "kitchen").cameras = [{ entity: "camera.kitchen", at: [4.5, 0.3], direction: 225, motion: "binary_sensor.kitchen_motion" }];
        window.card.hass.pushModel(m);
      });
    });
    const st = await page.evaluate(() => window.card.renderer.cameraState("camera.kitchen"));
    const on = await page.evaluate(() => window.card.hass.states["binary_sensor.kitchen_motion"].state === "on");
    assert(st?.views === 1 && st.color === (on ? "ff4d4d" : "4fa3ff"), `camera: ${JSON.stringify(st)} (motion ${on})`);
    await shot(page, "demo-camera");
  });
  await test("a lamp linked to a light glows with it, and a tap on it toggles the light", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "floor_lamp", model: "modern:floor_lamp_drum", at: [2, 2], entity: "light.reading_lamp" }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const glow = () => page.evaluate(() => (window.card.renderer.pieceGlows.get("light.reading_lamp") ?? []).map((m) => m.emissiveIntensity));
    const state = () => page.evaluate(() => window.card.hass.states["light.reading_lamp"].state);
    const before = await state();
    assert((await glow()).length > 0, "the lamp's shade and bulb are not linked");
    assert((await glow()).every((i) => (before === "on" ? i > 0.2 : i === 0)), `glow ${await glow()} for a light that is ${before}`);
    // tap on the lamp: where its shade is on screen
    const at = await page.evaluate(() => {
      const r = window.card.renderer;
      const piece = r.linked.find((g) => g.userData.entity === "light.reading_lamp");
      const p = new piece.position.constructor();
      piece.getWorldPosition(p);
      p.y += 1.3;
      p.project(r.camera);
      const canvas = window.card.shadowRoot.querySelector("canvas").getBoundingClientRect();
      return { x: canvas.left + ((p.x + 1) / 2) * canvas.width, y: canvas.top + ((1 - p.y) / 2) * canvas.height };
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction((b) => window.card.hass.states["light.reading_lamp"].state !== b, before, { timeout: 3000 });
    await page.waitForTimeout(300);
    const after = await state();
    assert((await glow()).every((i) => (after === "on" ? i > 0.2 : i === 0)), `glow ${await glow()} after the tap (${after})`);
    await shot(page, "demo-lamp-linked");
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction((b) => window.card.hass.states["light.reading_lamp"].state === b, before, { timeout: 3000 });
    // a long press opens its details (colour, temperature) instead
    await page.evaluate(() => (window.__moreInfo = null, window.card.addEventListener("hass-more-info", (e) => (window.__moreInfo = e.detail.entityId))));
    const n = await page.evaluate(() => window.card.hass.calls.length);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert((await page.evaluate(() => window.__moreInfo)) === "light.reading_lamp", "a long press did not open the lamp's details");
    assert((await page.evaluate(() => window.card.hass.calls.length)) === n, "a long press also toggled");
    // the pointer off the house again (hovering a level hides the roof)
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
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
  await test("robots: the vacuum at its live position, with its status and battery", async () => {
    const robots = await page.evaluate(() => window.card.renderer.robotState());
    assert(robots.length === 1 && robots[0].visible && robots[0].at[0] === 2.5 && robots[0].at[1] === 2.5 && robots[0].color === "#4caf50", `robots: ${JSON.stringify(robots)}`);
    const label = await page.locator("homeslice-card .robot-label").getAttribute("aria-label");
    assert(label.includes("Robo") && label.includes("cleaning") && label.includes("64 %"), `label: ${label}`);
    assert((await page.locator("homeslice-card .robot-label").textContent()).includes("64 %"), "battery not shown");
    // docked: back at the dock, grey
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "vacuum.robo": { ...h.states["vacuum.robo"], state: "docked", attributes: { ...h.states["vacuum.robo"].attributes, vacuum_position: { x: 24800, y: 27300 } } } } };
      }),
    );
    const docked = await page.evaluate(() => window.card.renderer.robotState()[0]);
    assert(docked.color === "#9e9e9e" && Math.abs(docked.at[0] - 0.8) < 1e-6 && Math.abs(docked.at[1] - 3.3) < 1e-6, `docked: ${JSON.stringify(docked)}`);
  });

  await test("robots: a Roborock answers its position when asked (a service, not an attribute)", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        window.card.hass.robotPositions["vacuum.robo"] = [26500, 25500];
        const m = structuredClone(window.__demoModel);
        m.robots[0].position = { service: "roborock.get_vacuum_current_position", points: m.robots[0].position.points };
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "vacuum.robo": { ...h.states["vacuum.robo"], state: "cleaning" } } };
        window.card.hass.pushModel(m);
      });
    });
    await page.waitForFunction(() => window.card.renderer.robotState()[0]?.at[0] === 2.5, null, { timeout: 5000 });
    const at = await page.evaluate(() => window.card.renderer.robotState()[0].at);
    // map (26500, 25500) with the demo's calibration: plan (2.5, 1.5)
    assert(Math.abs(at[0] - 2.5) < 1e-6 && Math.abs(at[1] - 1.5) < 1e-6, `robot at ${at}`);
    // it moves: the next answer
    await page.evaluate(() => (window.card.hass.robotPositions["vacuum.robo"] = [25500, 25500]));
    await page.waitForFunction(() => Math.abs(window.card.renderer.robotState()[0].at[0] - 1.5) < 1e-6, null, { timeout: 6000 });
    // a robot that never says where it is while cleaning: faded at its dock, the label says so
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.robots[0].position = { entity: "vacuum.silent", service: "roborock.get_vacuum_current_position", points: m.robots[0].position.points };
        window.card.hass.pushModel(m);
      });
    });
    await page.waitForFunction(() => window.card.renderer.robotState()[0]?.unsure, null, { timeout: 5000 });
    const unsure = await page.evaluate(() => window.card.renderer.robotState()[0]);
    assert(Math.abs(unsure.at[0] - 0.8) < 1e-6 && Math.abs(unsure.at[1] - 3.3) < 1e-6, `unsure robot: ${JSON.stringify(unsure)}`);
    assert((await page.locator("homeslice-card .robot-label").getAttribute("aria-label")).includes("position not reported") || (await page.locator("homeslice-card .robot-label").textContent()).includes("position not reported"), "the label doesn't say the position is missing");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(structuredClone(window.__demoModel))));
  });

  await test("robots: a warning at the dock when it needs something (water, bag, maintenance)", async () => {
    const needs = (on) =>
      act(page, () =>
        page.evaluate((on) => {
          const h = window.card.hass;
          window.card.hass = {
            ...h,
            devices: { ...h.devices, robo_dev: { id: "robo_dev", name: "Robo" }, robo_dock: { id: "robo_dock", name: "Robo Dock" } },
            entities: {
              ...h.entities,
              "vacuum.robo": { ...(h.entities["vacuum.robo"] ?? { entity_id: "vacuum.robo" }), device_id: "robo_dev" },
              "binary_sensor.robo_water_shortage": { entity_id: "binary_sensor.robo_water_shortage", device_id: "robo_dev" },
              "sensor.robo_dock_brush_time_left": { entity_id: "sensor.robo_dock_brush_time_left", device_id: "robo_dock" },
            },
            states: {
              ...h.states,
              "binary_sensor.robo_water_shortage": { entity_id: "binary_sensor.robo_water_shortage", state: on ? "on" : "off", attributes: { device_class: "problem", friendly_name: "Robo Water shortage" } },
              "sensor.robo_dock_brush_time_left": { entity_id: "sensor.robo_dock_brush_time_left", state: on ? "-5" : "40", attributes: { device_class: "duration", friendly_name: "Robo Dock Brush time left" } },
            },
          };
        }, on),
      );
    await needs(true);
    const alert = page.locator("homeslice-card .dock-alert");
    assert((await alert.count()) === 1, "no warning at the dock");
    const label = await alert.getAttribute("aria-label");
    assert(label.includes("Water shortage") && label.includes("Brush time left"), `warning: ${label}`);
    await shot(page, "demo-dock-alert");
    await needs(false);
    assert((await alert.count()) === 0, "warning stays when all is well");
  });

  await test("the real sun lights the house; at night it is dark", async () => {
    const setSun = (azimuth, elevation) =>
      act(page, () =>
        page.evaluate(([azimuth, elevation]) => {
          const h = window.card.hass;
          window.card.hass = { ...h, states: { ...h.states, "sun.sun": { entity_id: "sun.sun", state: elevation > 0 ? "above_horizon" : "below_horizon", attributes: { azimuth, elevation } } } };
        }, [azimuth, elevation]),
      );
    await setSun(180, 30);
    let sun = await page.evaluate(() => window.card.renderer.sunState());
    // from the south: +z in the scene
    assert(sun.at.azimuth === 180 && sun.position[2] > 0.5 && sun.intensity > 2, `noon: ${JSON.stringify(sun)}`);
    await setSun(300, -20);
    sun = await page.evaluate(() => window.card.renderer.sunState());
    assert(sun.intensity === 0, `night: ${JSON.stringify(sun)}`);
    await shot(page, "demo-night");
    await setSun(180, 30);
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
    await page.locator("homeslice-card-editor label", { hasText: "Projection" }).locator("select").selectOption("perspective");
    assert((await last()).view.projection === "perspective", "projection not set");
    await shot(page, "card-editor");
    // a floor plan has no camera angle or roof to set
    await page.locator("homeslice-card-editor label", { hasText: "Look" }).locator("select").selectOption("plan");
    assert((await last()).mode === "plan", "plan mode not set");
    assert(!(await page.locator("homeslice-card-editor .three-d").isVisible()), "3D settings still shown for a plan");
    await page.locator("homeslice-card-editor label", { hasText: "Look" }).locator("select").selectOption("3d");
    assert((await last()).mode === undefined, "3D is the default and not written");
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
      { kind: "device", power: "sensor.heat_pump_power", level: "ground", at: [6, 8], details: ["sensor.heat_pump_cop", { entity: "sensor.hot_water", name: "Hot water" }] },
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
    st("sensor.heat_pump_cop", "3.8", "", { friendly_name: "Heat pump COP" });
    st("sensor.hot_water", "48.5", "°C", { friendly_name: "Domestic hot water temperature" });
    f.entities["sensor.battery_power"] = { entity_id: "sensor.battery_power", device_id: "battery" };
    f.entities["sensor.battery_soc"] = { entity_id: "sensor.battery_soc", device_id: "battery" };
    return f;
  });
  await test("energy overlay: panels on the roof, labels with power, flows to the battery", async () => {
    await page.waitForFunction(() => window.card.renderer.energyState().flows.some((f) => f.watts !== 0));
    const state = await page.evaluate(() => window.card.renderer.energyState());
    // no inverter: every line goes to the battery
    assert(state.flows.length === 3 && state.flows.every((f) => f.to === "energy-1"), `energy: ${JSON.stringify(state)}`);
    const w = Object.fromEntries(state.flows.map((f) => [f.key, f.watts]));
    assert(w["energy-0"] === 2400 && w["energy-2"] === -300 && w["energy-3"] === -1200, `flows: ${JSON.stringify(w)}`);
    assert(state.flows.every((f) => f.visible && f.dots), "flows not drawn");
    assert(await page.evaluate(() => window.card.renderer.roofVisible()), "the overlay should show the roof");
    const labels = await page.locator("homeslice-card .energy-label").allTextContents();
    const text = labels.map((l) => l.replace(/\s+/g, " ").trim()).join(" | ");
    assert(text.includes("2.4 kW") && text.includes("64 %") && text.includes("Heat pump") && text.includes("1.2 kW"), `labels: ${text}`);
    // more readings after the power, the device's name taken off the sensor's
    assert(text.includes("1.2 kW · COP 3.8 · Hot water 48.5 °C"), `heat pump details: ${text}`);
    // the whole house: callouts beside it with leader lines, not stacked over the floors
    const places = await page.locator("homeslice-card .energy-label").evaluateAll((els) => els.map((e) => e.classList.contains("left") || e.classList.contains("right")));
    assert(places.length && places.every(Boolean), "labels are not callouts in the overview");
    assert((await page.locator("homeslice-card svg.leaders line").count()) === places.length, "no leader lines");
    const boxes = await page.locator("homeslice-card .energy-label").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `labels ${i} and ${j} overlap`);
      }
    await page.waitForTimeout(200);
    await shot(page, "demo-energy");
    // a floor picked: only its items; no roof, no solar
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const focused = await page.locator("homeslice-card .energy-label").count();
    assert(focused === 3, `labels on the ground floor: ${focused}`);
    assert((await page.locator("homeslice-card .energy-label.above").count()) === 3, "labels on a picked floor should sit at their markers");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, looks");
{
  // auto: night once the sun is down
  const sunSet = (f) => ({ ...f, states: { ...f.states, "sun.sun": { entity_id: "sun.sun", state: "below_horizon", attributes: { azimuth: 300, elevation: -12 } } } });
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { look: "auto" }, undefined, sunSet);
  await test("look auto: the night look after sunset, glowing outlines in the accent colour", async () => {
    const outlines = () => page.evaluate(() => window.card.renderer.outlines.map((l) => l.visible));
    assert((await outlines()).length === 2 && (await outlines()).every(Boolean), `outlines: ${await outlines()}`);
    await shot(page, "demo-look-night");
    // sunrise: back to day
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 120, elevation: 20 } } } };
      }),
    );
    assert(!(await outlines()).some(Boolean), "outlines by day");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, white model and blueprint");
for (const look of ["white", "blueprint"]) {
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { look });
  await test(`look ${look}: every surface in the look's colour, textures off`, async () => {
    await page.evaluate(() => window.card.renderer.modelsReady());
    await page.waitForTimeout(300);
    const colours = await page.evaluate(() => {
      const found = new Set();
      let textured = 0;
      window.card.renderer.object.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [o.material].flat()) {
          if (m.type !== "MeshLambertMaterial") continue;
          found.add(m.color.getHexString());
          if (m.map) textured++;
        }
      });
      return { colours: [...found], textured };
    });
    // the look's colours (plus state colours: blind strips, robots), no textures
    assert(colours.textured === 0, `textured materials: ${colours.textured}`);
    assert(colours.colours.includes(look === "white" ? "f1f0ec" : "2f5c9e") && colours.colours.length <= 8, `colours: ${colours.colours.join(",")}`);
    await shot(page, `demo-look-${look}`);
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, following events");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { follow: ["binary_sensor.kitchen_motion"], follow_seconds: 1.5 });
  const setMotion = (state) =>
    page.evaluate((state) => {
      const h = window.card.hass;
      window.card.hass = { ...h, states: { ...h.states, "binary_sensor.kitchen_motion": { ...h.states["binary_sensor.kitchen_motion"], state } } };
    }, state);
  await test("follow: the card turns to where something happens, says what, and goes back", async () => {
    await setMotion("off");
    await page.waitForTimeout(200);
    assert((await page.evaluate(() => window.card._level)) === null, "moved without an event");
    await setMotion("on");
    await page.waitForFunction(() => window.card._level === "ground", null, { timeout: 5000 });
    const note = await page.locator("homeslice-card .event").textContent();
    assert(note.includes("Kitchen"), `note: ${note}`);
    await shot(page, "demo-follow");
    await page.waitForFunction(() => window.card._level === null && !window.card._event, null, { timeout: 8000 });
    // someone using the card: it stays put
    const box = await page.locator("homeslice-card canvas").boundingBox();
    await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10);
    await setMotion("off");
    await setMotion("on");
    await page.waitForTimeout(800);
    assert((await page.evaluate(() => window.card._level)) === null, "moved while someone used the card");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, low quality");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { quality: "low" });
  await test("quality low: no shadows, plain colours, simple furniture", async () => {
    const r = await page.evaluate(() => {
      const card = window.card;
      let textured = 0;
      let detailed = 0;
      card.renderer.object.traverse((o) => {
        if (o.userData.detailed) detailed++;
        if (o.isMesh) for (const m of [o.material].flat()) if (m.map && m.type === "MeshLambertMaterial") textured++;
      });
      return { quality: card.renderer.quality, shadows: card.renderer.renderer.shadowMap.enabled, lights: card.renderer.lightPool.length, textured, detailed, ratio: card.renderer.renderer.getPixelRatio() };
    });
    assert(r.quality === "low" && !r.shadows && r.lights === 2 && r.textured === 0 && r.detailed === 0 && r.ratio === 1, JSON.stringify(r));
    await shot(page, "demo-quality-low");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, heatmap");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { heatmap: "temperature" });
  await test("heatmap: cool rooms blue, comfortable rooms as they are", async () => {
    const tint = (k) => page.evaluate((k) => window.card.renderer.floors.get(k)?.material.userData.tint ?? null, k);
    assert((await tint("first/bedroom")) === "#6fb7e8", `bedroom (19.2 °C): ${await tint("first/bedroom")}`);
    assert((await tint("ground/living")) === null, `living room (21.4 °C): ${await tint("ground/living")}`);
    await shot(page, "demo-heatmap");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, all floors side by side");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { mode: "plan", floors: "all" });
  await test("plan with all floors: side by side from above, labels on each", async () => {
    const r = await page.evaluate(() => ({ level: window.card._level, xs: window.card.renderer.levels.map((l) => l.group.position.x), o: window.card.renderer.orientation }));
    assert(r.level === null && r.xs[1] > r.xs[0] + 7 && r.o.elevation === 90, JSON.stringify(r));
    // the ground floor's labels on the left, the first floor's on the right
    const xOf = async (name) => (await page.locator("homeslice-card .label button.name", { hasText: name }).boundingBox()).x;
    assert((await xOf("Kitchen")) < (await xOf("Bedroom")), "first floor labels not to the right");
    await shot(page, "demo-plan-all");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, lux");
{
  const withLux = (f) => ({
    ...f,
    states: { ...f.states, "sensor.living_lux": { entity_id: "sensor.living_lux", state: "3", attributes: { device_class: "illuminance", unit_of_measurement: "lx" } } },
    entities: { ...f.entities, "sensor.living_lux": { entity_id: "sensor.living_lux", area_id: "living_room" } },
  });
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { lux: true }, undefined, withLux);
  await test("lux: a dark room looks dark and shows its reading", async () => {
    const floor = () => page.evaluate(() => window.card.renderer.floors.get("ground/living").material.color.getHexString());
    const label = page.locator("homeslice-card .label", { has: page.locator("button.name", { hasText: "Living Room" }) });
    assert((await label.textContent()).includes("3 lx"), `label: ${await label.textContent()}`);
    const dark = await floor();
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "sensor.living_lux": { ...h.states["sensor.living_lux"], state: "800" } } };
      }),
    );
    const bright = await floor();
    assert(parseInt(bright.slice(0, 2), 16) > parseInt(dark.slice(0, 2), 16) + 40, `floor ${dark} → ${bright}`);
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, tilted plan");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { mode: "tilted" });
  await test("tilted plan: one floor at an angle, walls cut low", async () => {
    await page.waitForFunction(() => window.card.renderer.focusedIndex !== null, null, { timeout: 5000 });
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(Math.abs(o.elevation - 52) < 0.5 && o.azimuth === 180, `camera ${JSON.stringify(o)}`);
    // the highest wall of the ground floor ends at 1.1 m
    const top = await page.evaluate(() => {
      const level = window.card.renderer.levels[0].group;
      let max = 0;
      level.traverse((m) => {
        if (!m.isMesh || m.userData.outdoor || m.geometry.type !== "BoxGeometry") return;
        m.geometry.computeBoundingBox();
        max = Math.max(max, m.position.y + m.geometry.boundingBox.max.y);
      });
      return max;
    });
    assert(top <= 1.11, `walls up to ${top} m`);
    const floors = await page.locator("homeslice-card nav.levels button").allTextContents();
    assert(!floors.some((f) => f.includes("All floors")), `floor buttons: ${floors}`);
    await shot(page, "demo-tilted");
    // a sideways swipe: the next floor
    const before = await page.evaluate(() => window.card._level);
    const box = await page.locator("homeslice-card canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction((b) => window.card._level !== b, before, { timeout: 5000 });
    assert((await page.evaluate(() => window.card._level)) === "first", `after the swipe: ${await page.evaluate(() => window.card._level)}`);
    assert((await page.locator("homeslice-card .popup").count()) === 0, "the swipe opened a popup");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, floor plan");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", { mode: "plan" });
  await test("plan mode: one floor at a time from straight above, starting on the entrance floor", async () => {
    await page.waitForFunction(() => window.card.renderer.orientation.elevation === 90, null, { timeout: 5000 }).catch(() => {});
    let o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 90 && o.azimuth === 180 && o.fov === 3, `camera ${JSON.stringify(o)}`);
    const floors = await page.locator("homeslice-card nav.levels button").allTextContents();
    assert(!floors.some((f) => f.includes("All floors")), `floor buttons: ${floors}`);
    assert((await page.locator("homeslice-card nav.levels button.active").textContent()).includes("Ground Floor"), "not on the entrance floor");
    assert(!(await page.evaluate(() => window.card.renderer.roofVisible())), "a plan has no roof");
    assert((await page.evaluate(() => window.card.renderer.planLines.length)) === 2, "a door swing per door on the plan");
    await shot(page, "demo-plan");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    await page.waitForFunction(() => window.card.renderer.focusedIndex === 1, null, { timeout: 5000 });
    // clicking the shown floor again keeps it
    await page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click();
    await page.waitForTimeout(300);
    assert((await page.evaluate(() => window.card.renderer.focusedIndex)) === 1, "the plan left its floor");
    const names = await page.locator("homeslice-card .label button.name").allTextContents();
    assert(names.some((n) => n.includes("Bedroom")) && !names.some((n) => n.includes("Kitchen")), `labels: ${names}`);
    o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 90 && o.azimuth === 180, `camera on the first floor ${JSON.stringify(o)}`);
    await shot(page, "demo-plan-first");
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();
}

console.log("demo house, German");
{
  const { page, errors } = await open("dev/fixtures/demo-hass.json", {}, undefined, (f) => ({ ...f, language: "de" }));
  await test("in German: the card speaks the user's language", async () => {
    const buttons = await page.locator("homeslice-card nav.levels button").allTextContents();
    assert(buttons.some((b) => b.includes("Alle Etagen")), `floor buttons: ${buttons}`);
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
    // (a model finishing its load also redraws: wait for the camera, not the first frame)
    const settle = (az) => page.waitForFunction((az) => window.card.renderer.orientation.azimuth === az, az, { timeout: 5000 }).catch(() => {});
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    await settle(200);
    let o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.azimuth === 200 && o.elevation === 90 && o.fov === 3, `first floor camera ${JSON.stringify(o)}`);
    await shot(page, "demo-first-custom-camera");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await settle(160);
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
    const width = page.locator("homeslice-panel .inspector label", { hasText: "Width left–right" }).locator("input");
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
    assert(hint.includes("0.50 m right"), `drag readout: ${hint}`);
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

  /** A spot on an outside wall that nothing else covers (doors and windows are clickable too). */
  const freeOutlineSpot = (westmost) =>
    page.evaluate((westmost) => {
      const root = window.panel.shadowRoot;
      const spots = [];
      for (const l of root.querySelectorAll("svg.plan line.wall-hit[data-outline]")) {
        const r = l.getBoundingClientRect();
        for (let t = 0.1; t < 0.95; t += 0.05) {
          const x = r.left + r.width * t;
          const y = r.top + r.height * t;
          const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => l[k].baseVal.value);
          const svg = root.querySelector("svg.plan").getBoundingClientRect();
          const px = svg.left + x1 + (x2 - x1) * t;
          const py = svg.top + y1 + (y2 - y1) * t;
          if (root.elementFromPoint(px, py) === l) spots.push({ x: px, y: py });
          void x;
          void y;
        }
      }
      return westmost ? spots.sort((a, b) => a.x - b.x)[0] : spots[0];
    }, westmost);

  await test("outside walls: select the outline, moving the façade moves every floor", async () => {
    await page.keyboard.press("Escape");
    // the west wall's click zone
    const west = await freeOutlineSpot(true);
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
    // the house's outside size along its north and west sides
    const overall = await page.locator("homeslice-panel svg.plan .overall-dims text").allTextContents();
    assert(JSON.stringify(overall) === '["8.00 m","10.00 m"]', `overall: ${overall}`);
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
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="opening"]').click();
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

  await test("doors & windows: a blind that reports the other way round can be marked inverted", async () => {
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.opening-hit")].find((x) => JSON.parse(x.dataset.opening).room === "kitchen");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "Inverted" }).locator("input").check();
    assert(JSON.stringify((await model()).inverted_covers) === '["cover.kitchen"]', `inverted: ${JSON.stringify((await model()).inverted_covers)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(!(await model()).inverted_covers, "undo did not clear it");
    await page.keyboard.press("Escape");
  });

  await test("doors & windows: an outside window can be repeated on the floor above", async () => {
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.opening-hit")].find((x) => {
        const o = JSON.parse(x.dataset.opening);
        return o.room === "kitchen";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "First Floor" }).locator("input").check();
    const m = await model();
    // the kitchen's north window at 1.5 m from its west end, counted from the house's corner now
    const at = (await room("kitchen")).rect[0] + 1.5;
    assert(m.facade_openings?.some((f) => f.side === "north" && f.at === at && JSON.stringify(f.levels) === '["ground","first"]' && f.covers?.ground === "cover.kitchen"), `facade: ${JSON.stringify(m.facade_openings)}`);
    assert((await page.locator("homeslice-panel .inspector").textContent()).includes("Stacked on several levels"), "not shown as stacked");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(!(await model()).facade_openings?.some((f) => f.at === at), "undo did not restore it");
    await page.keyboard.press("Escape");
  });

  await test("checklist: a new blind is offered for the right window and linked in one click", async () => {
    await page.evaluate(() => {
      const h = window.panel.hass;
      window.panel.hass = {
        ...h,
        entities: { ...h.entities, "cover.living_west": { entity_id: "cover.living_west", area_id: "living_room" } },
        states: { ...h.states, "cover.living_west": { entity_id: "cover.living_west", state: "open", attributes: { device_class: "blind", friendly_name: "Living West" } } },
      };
    });
    await page.waitForTimeout(1200); // the editor follows HA once a second
    await page.locator("homeslice-panel header button.checklist-button").click();
    const item = page.locator("homeslice-panel .inspector ul.checklist li", { hasText: "Living West" });
    assert((await item.textContent()).includes("left window of Living Room"), `item: ${await item.textContent()}`);
    await shot(page, "editor-checklist");
    await item.locator("button", { hasText: "Link" }).click();
    const west = (await model()).levels[0].openings.find((o) => o.room === "living" && o.side === "west");
    assert(west?.cover === "cover.living_west", `west window: ${JSON.stringify(west)}`);
    assert(!(await page.locator("homeslice-panel .inspector ul.checklist li", { hasText: "Living West" }).count()), "still listed");
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel header button.checklist-button").click();
    await page.keyboard.press("Escape");
  });

  await test("doors & windows library: pick a double door, add it to a wall, see how it opens; change its kind", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="opening"]').click();
    await page.locator('homeslice-panel .inspector .library button[data-preset="door_double"]').click();
    // the wall between hall and kitchen
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-addwall]")].find((x) => JSON.parse(x.dataset.addwall).rooms.sort().join() === "hall,kitchen");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    const added = () => model().then((m) => m.levels[0].openings.at(-1));
    let o = await added();
    assert(o.type === "door" && o.style === "double" && o.width === 1.6, `added: ${JSON.stringify(o)}`);
    // a double door swings with two leaves
    assert((await page.locator("homeslice-panel svg.plan polyline.swing").count()) >= 2, "no swing arcs");
    await shot(page, "editor-door-double");
    await page.locator("homeslice-panel .inspector button", { hasText: "Opens inwards" }).click();
    assert((await added()).swing === "out", "swing not changed");
    await page.locator('homeslice-panel .inspector .opening-kinds button[data-preset="opening_arch"]').click();
    o = await added();
    assert(o.type === "opening" && o.style === "arch" && o.width === 1.2, `arch: ${JSON.stringify(o)}`);
    // dragging a sliding door onto a wall (the library shows when nothing is selected)
    await page.keyboard.press("Escape");
    const drop = await page.evaluate((hit) => {
      const root = window.panel.shadowRoot;
      const dt = new DataTransfer();
      root.querySelector('.library button[data-preset="door_sliding"]').dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
      const plan = root.querySelector("svg.plan");
      const at = { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: hit.x, clientY: hit.y + 50 };
      const over = new DragEvent("dragover", at);
      plan.dispatchEvent(over);
      plan.dispatchEvent(new DragEvent("drop", at));
      return over.defaultPrevented;
    }, hit);
    assert(drop, "drop refused");
    o = await added();
    assert(o.type === "door" && o.style === "sliding", `dropped: ${JSON.stringify(o)}`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  await test("doors & windows: house-wide defaults for sill and height", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="opening"]').click();
    const sill = page.locator('homeslice-panel .inspector input[aria-label="Window Sill (m)"]');
    await sill.fill("0");
    await sill.dispatchEvent("change");
    assert((await model()).opening_defaults?.window?.sill === 0, `defaults: ${JSON.stringify((await model()).opening_defaults)}`);
    await page.keyboard.press("Control+z");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
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

  await test("a wall drawn by finger snaps to 45°, with a magnifier while dragging", async () => {
    await page.keyboard.press("w");
    const a = await toPage([1, 8]);
    const b = await toPage([2.97, 9.93]);
    const touch = (type, p) =>
      page.evaluate(
        ([type, x, y]) => {
          const svg = document.querySelector("homeslice-panel").shadowRoot.querySelector("svg.plan");
          const target = document.querySelector("homeslice-panel").shadowRoot.elementFromPoint(x, y) ?? svg;
          target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, composed: true }));
        },
        [type, p.x, p.y],
      );
    await touch("pointerdown", a);
    for (let i = 1; i <= 6; i++) await touch("pointermove", { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
    assert((await page.locator("homeslice-panel .loupe").count()) === 1, "no magnifier while dragging");
    await shot(page, "editor-loupe");
    await touch("pointerup", b);
    assert((await page.locator("homeslice-panel .loupe").count()) === 0, "magnifier not hidden");
    const drawn = (await model()).levels[0].walls?.find((w) => w.line);
    const [[x0, y0], [x1, y1]] = drawn.line;
    assert(Math.abs(x1 - x0 - (y1 - y0)) < 1e-6 && Math.abs(x1 - x0 - 2) < 0.06, `wall: ${JSON.stringify(drawn)}`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  await test("the compass points to real north and opens the building settings", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const needle = () => page.locator("homeslice-panel .compass g").getAttribute("style");
    assert((await needle()).includes("rotate(0deg)"), `needle: ${await needle()}`);
    await page.locator("homeslice-panel .compass").click();
    const north = page.locator("homeslice-panel .inspector label", { hasText: "Real north" }).locator("input");
    await north.fill("30");
    await north.dispatchEvent("change");
    assert((await needle()).includes("rotate(-30deg)"), `turned needle: ${await needle()}`);
    assert((await page.evaluate(() => window.panel._model.north)) === 30, "north not saved in the house");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  await test("building settings: wall thickness, neighbours, floor slab, one wall's own thickness", async () => {
    await page.keyboard.press("Escape");
    const outer = await freeOutlineSpot(false);
    await page.mouse.click(outer.x, outer.y);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Outside walls", "outline not selected");
    await typeInto("Outside (cm)", 42);
    assert((await model()).walls?.exterior === 0.42, `walls: ${JSON.stringify((await model()).walls)}`);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "left" }).locator("input").check();
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
    assert(hint.includes("0.50 m down"), `drag readout: ${hint}`);
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
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="opening"]').click();
    await page.locator('homeslice-panel .inspector .library button[data-preset="window"]').click();
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
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
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
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
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
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("objects mode: add furniture, drag it into another room, turn and delete it", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    const kb = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.click(kb.x + kb.width * 0.8, kb.y + kb.height * 0.85);
    // the room's inspector offers furniture: the furniture tool's library, for this room
    await page.locator("homeslice-panel .inspector button", { hasText: "Add furniture" }).click();
    await page.locator('homeslice-panel .inspector .library-sources button[data-source="builtin"]').click();
    await page.locator('homeslice-panel .inspector .library button[data-key="modern:dining_table"]').click();
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
    // Ctrl+D: a second one right next to it (turned: to the south), selected
    await page.keyboard.press("Control+d");
    const pair = (await room("living")).furniture;
    assert(pair.length === 2 && pair[1].rotation === 90 && Math.abs(pair[1].at[1] - pair[0].at[1] - 1.8) < 1e-6, `duplicate: ${JSON.stringify(pair)}`);
    await page.keyboard.press("Delete");
    await page.evaluate(() => (window.panel._furn = { room: "living", index: 0 }));
    await shot(page, "editor-furniture");
    await page.keyboard.press("Delete");
    assert(!(await room("living")).furniture, "not deleted");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("furniture library: grouped with pictures; drag pieces onto rooms, wall pieces go against a wall", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="furniture"]').click();
    await page.locator('homeslice-panel .inspector .library-sources button[data-source="builtin"]').click();
    const groups = await page.locator("homeslice-panel .inspector h4").allTextContents();
    assert(groups[0] === "Living" && groups.includes("Bathroom") && groups.includes("Lighting") && groups.includes("Cars & bikes"), `groups: ${groups.join(", ")}`);
    // searching narrows the library down
    await page.locator("homeslice-panel .inspector input.library-search").fill("birch");
    const found = await page.locator("homeslice-panel .inspector .library button").evaluateAll((b) => b.map((x) => x.dataset.key));
    assert(JSON.stringify(found) === '["modern:tree_birch"]', `search: ${found}`);
    // aliases, in German too, every word somewhere
    await page.locator("homeslice-panel .inspector input.library-search").fill("spülmaschine");
    const dishwasher = await page.locator("homeslice-panel .inspector .library button").evaluateAll((b) => b.map((x) => x.dataset.key));
    assert(JSON.stringify(dishwasher) === '["modern:kitchen_dishwasher"]', `alias search: ${dishwasher}`);
    await page.locator("homeslice-panel .inspector input.library-search").fill("shower glass");
    const showers = await page.locator("homeslice-panel .inspector .library button").evaluateAll((b) => b.map((x) => x.dataset.key));
    assert(showers.includes("modern:shower_walk_in") && !showers.includes("modern:bathtub"), `two words: ${showers}`);
    await page.locator("homeslice-panel .inspector input.library-search").fill("");
    // the pictures load (lazily, as they scroll into view) and none is missing
    for (const lib of await page.locator("homeslice-panel .inspector .library").all()) await lib.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const imgs = [...window.panel.shadowRoot.querySelectorAll(".library img")];
      return imgs.filter((i) => i.complete && i.naturalWidth > 0).length >= 20 && imgs.every((i) => !i.complete || i.naturalWidth > 0);
    }, null, { timeout: 10000 });
    await page.locator("homeslice-panel .inspector input.library-search").scrollIntoViewIfNeeded();
    await shot(page, "editor-library-panel");
    // HTML drag and drop from the library onto the plan, as the browser does it
    const dropPiece = (key, x, y) =>
      page.evaluate(({ key, x, y }) => {
        const root = window.panel.shadowRoot;
        const dt = new DataTransfer();
        root.querySelector(`.library button[data-key="${key}"]`).dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
        const plan = root.querySelector("svg.plan");
        const at = { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
        const over = new DragEvent("dragover", at);
        plan.dispatchEvent(over);
        if (!over.defaultPrevented) return "the plan refused the drop";
        plan.dispatchEvent(new DragEvent("drop", at));
        return "ok";
      }, { key, x, y });
    const living = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    assert((await dropPiece("modern:sofa", living.x + living.width * 0.3, living.y + living.height * 0.75)) === "ok", "drop refused");
    assert((await room("living")).furniture?.some((f) => f.type === "sofa"), `living: ${JSON.stringify((await room("living")).furniture)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Sofa", "dropped sofa not selected");
    // dragged close to the south wall, the sofa snaps flush against it (inside face: 10 − 0.36 m)
    const sofaBox = await page.locator("homeslice-panel svg.plan g.furniture.selected rect").boundingBox();
    const near = await toPage([3, 9.1]);
    await page.mouse.move(sofaBox.x + 8, sofaBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(near.x + 8 - sofaBox.width / 2, near.y + 8 - sofaBox.height / 2, { steps: 8 });
    await page.mouse.up();
    const sofa = (await room("living")).furniture.find((f) => f.type === "sofa");
    assert(Math.abs(sofa.at[1] + 4 - (9.64 - 0.475)) < 0.011, `sofa not against the wall: ${JSON.stringify(sofa)}`);
    // a mirror dropped near the hall's west wall hangs on it, facing east
    await page.keyboard.press("Escape");
    const hall = await page.locator('homeslice-panel svg.plan g[data-room="hall"] polygon').boundingBox();
    await dropPiece("modern:mirror_round", hall.x + 12, hall.y + hall.height * 0.6);
    const mirror = (await room("hall")).furniture?.find((f) => f.type === "mirror");
    // the hall's inside face of the west wall is 0.36 m from the room's corner; a 3 cm mirror sits 1.5 cm in front
    assert(mirror && mirror.rotation === 270 && Math.abs(mirror.at[0] - 0.38) < 0.011, `mirror: ${JSON.stringify(mirror)}`);
    assert((await page.locator("homeslice-panel .inspector label", { hasText: "Above the floor" }).count()) === 1, "a wall piece's height above the floor is not offered");
    // with snapping off, the mirror goes where it is dropped, not onto the wall
    const snapBox = page.locator("homeslice-panel .inspector label.snap-pieces input");
    await snapBox.uncheck();
    const mirrorBox = await page.locator("homeslice-panel svg.plan g.furniture.selected rect").boundingBox();
    await page.mouse.move(mirrorBox.x + mirrorBox.width / 2, mirrorBox.y + mirrorBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(mirrorBox.x + 60, mirrorBox.y + mirrorBox.height / 2, { steps: 6 });
    await page.mouse.up();
    const loose = (await room("hall")).furniture.find((f) => f.type === "mirror");
    assert(loose.rotation === 270 && loose.at[0] > 0.6, `mirror should move freely: ${JSON.stringify(loose)}`);
    await snapBox.check();
    await page.keyboard.press("Control+z");
    const sofaIndex = (await room("living")).furniture.findIndex((f) => f.type === "sofa");
    await page.evaluate((i) => (window.panel._furn = { room: "living", index: i }), sofaIndex);
    // mirrored left–right, then top–bottom (that one also turns it half way)
    await page.locator("homeslice-panel .inspector button", { hasText: "left–right" }).click();
    assert((await room("living")).furniture[sofaIndex].mirror === true, "not mirrored");
    assert((await page.locator("homeslice-panel svg.plan g.furniture.selected image").getAttribute("transform")) === "scale(-1 1)", "plan picture not flipped");
    await page.locator("homeslice-panel .inspector button", { hasText: "top–bottom" }).click();
    const flipped = (await room("living")).furniture[sofaIndex];
    assert(flipped.mirror === undefined && flipped.rotation === 180, `top–bottom: ${JSON.stringify(flipped)}`);
    await shot(page, "editor-library");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("library sources: built-in pieces with finishes, Poly Haven's fetched into HA, uploaded models", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Home Assistant serves downloaded and uploaded models; here any model is a chair
    await page.route("**/homeslice_assets/**", (route) => route.fulfill({ contentType: "model/gltf-binary", body: readFileSync(join(root, "dev/fixtures/chair.glb")) }));
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="furniture"]').click();
    const dropKey = (key, x, y) =>
      page.evaluate(({ key, x, y }) => {
        const root = window.panel.shadowRoot;
        const dt = new DataTransfer();
        root.querySelector(`.library button[data-key="${key}"]`).dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
        const plan = root.querySelector("svg.plan");
        const at = { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
        plan.dispatchEvent(new DragEvent("dragover", at));
        plan.dispatchEvent(new DragEvent("drop", at));
      }, { key, x, y });
    const living = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    const spot = [living.x + living.width * 0.5, living.y + living.height * 0.4];
    const count = async () => (await room("living")).furniture?.length ?? 0;
    const last = async () => (await room("living")).furniture.at(-1);
    const source = (s) => page.locator(`homeslice-panel .inspector .library-sources button[data-source="${s}"]`).click();
    const start = await count();

    await source("builtin");
    assert((await page.locator("homeslice-panel .inspector h4").allTextContents()).includes("Hall"), "no hall group");
    await dropKey("modern:wardrobe_sliding", ...spot);
    let w = await last();
    assert(w.model === "modern:wardrobe_sliding" && w.type === "wardrobe" && JSON.stringify(w.size) === "[2,0.65]" && w.height === 2.2, `modern: ${JSON.stringify(w)}`);
    await page.locator('homeslice-panel .inspector .finishes button[data-finish="walnut"]').click();
    w = await last();
    assert(w.finish === "walnut", `finish: ${JSON.stringify(w)}`);
    await page.locator('homeslice-panel .inspector .finishes button[data-accent="brass"]').click();
    w = await last();
    assert(w.accent === "brass", `accent: ${JSON.stringify(w)}`);
    // the 3D preview draws it (its module loads with the first Modern piece)
    await page.waitForFunction(() => window.panel.shadowRoot.querySelector("homeslice-card, .preview") !== null);
    await page.waitForTimeout(800);
    await shot(page, "editor-library-modern");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");

    let f;
    await source("polyhaven");
    await page.locator('homeslice-panel .inspector .library button[data-key="polyhaven:Sofa_01"]').waitFor();
    assert((await page.locator("homeslice-panel .inspector .credit").textContent()).includes("Poly Haven"), "no credit for Poly Haven");
    const groups = await page.locator("homeslice-panel .inspector h4").allTextContents();
    assert(JSON.stringify(groups) === '["Seating","Lighting","Plants"]', `groups: ${groups}`);
    await shot(page, "editor-library-polyhaven");
    await dropKey("polyhaven:Sofa_01", ...spot);
    await page.waitForFunction((n) => window.panel._model.levels[0].rooms.find((r) => r.id === "living").furniture?.length === n, start + 1);
    f = await last();
    assert(f.model === "polyhaven:Sofa_01" && f.type === "sofa" && JSON.stringify(f.size) === "[1.571,0.658]" && f.height === 0.796, `polyhaven: ${JSON.stringify(f)}`);
    assert(JSON.stringify(await page.evaluate(() => window.panel.hass.fetched)) === '["Sofa_01"]', "not fetched into HA first");
    await page.keyboard.press("Escape");

    await source("custom");
    assert((await page.locator("homeslice-panel .inspector p", { hasText: "No models uploaded yet" }).count()) === 1, "no empty note");
    await page.locator("homeslice-panel .inspector label.upload-model input").setInputFiles({ name: "Our chair.glb", mimeType: "model/gltf-binary", buffer: readFileSync(join(root, "dev/fixtures/chair.glb")) });
    await page.locator('homeslice-panel .inspector .library button[data-key="custom:m1"]').waitFor();
    await dropKey("custom:m1", ...spot);
    await page.waitForFunction((n) => window.panel._model.levels[0].rooms.find((r) => r.id === "living").furniture?.length === n, start + 2);
    f = await last();
    assert(f.model === "custom:m1" && f.type === "item" && f.size?.[0] > 0 && f.height > 0, `custom: ${JSON.stringify(f)}`);
    await shot(page, "editor-library-custom");
    for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
    assert((await count()) === start, "not undone");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("a floor lamp linked to a light: the lamp marker goes, the piece is the lamp", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const lb = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    await page.mouse.click(lb.x + lb.width * 0.85, lb.y + lb.height * 0.9);
    await page.locator("homeslice-panel .inspector button", { hasText: "Add furniture" }).click();
    await page.locator('homeslice-panel .inspector .library-sources button[data-source="builtin"]').click();
    await page.locator('homeslice-panel .inspector .library button[data-key="modern:floor_lamp_tripod"]').click();
    const lampMarkers = () => page.locator('homeslice-panel svg.plan [data-light*="light.reading_lamp"]').count();
    assert((await lampMarkers()) === 1, "the reading lamp should have its marker before linking");
    const link = page.locator("homeslice-panel .inspector details.entity-picker");
    await link.locator("summary").click();
    await link.locator("input.entity-search").fill("reading");
    assert((await link.locator("button.entity-option").count()) === 2, "search should leave 'not linked' and the reading lamp");
    await link.locator('button.entity-option[data-entity="light.reading_lamp"]').click();
    const piece = (await room("living")).furniture.find((f) => f.type === "floor_lamp");
    assert(piece?.entity === "light.reading_lamp", `piece: ${JSON.stringify(piece)}`);
    assert((await lampMarkers()) === 0, "the lamp marker should give way to the piece");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  await test("wall view: a room's side from inside, drag a window along and up", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const lb = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    await page.mouse.click(lb.x + lb.width * 0.85, lb.y + lb.height * 0.9);
    await page.locator('homeslice-panel .inspector button[data-wall-view="south"]').click();
    const items = page.locator("homeslice-panel .wall-view [data-wv]");
    assert((await items.count()) === 2, `items on the bottom wall: ${await items.count()}`);
    const win = page.locator("homeslice-panel .wall-view .wv-item.wv-window");
    const before = (await model()).levels[0].openings[2];
    const b = await win.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 - 30, { steps: 6 });
    await page.mouse.up();
    const after = (await model()).levels[0].openings[2];
    // seen from inside, the bottom wall runs right to left: dragging right moves it towards the start
    // (a full-height window: its sill starts on the floor)
    assert(after.at < before.at && after.sill >= 0.2, `window ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    assert((await page.locator("homeslice-panel .wall-view .wv-dims text").count()) >= 2, "no measurements for the selected window");
    await shot(page, "editor-wall-view");
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel .wall-view .close").click();
    assert((await page.locator("homeslice-panel .wall-view").count()) === 0, "wall view still open");
    await page.keyboard.press("Escape");
  });

  await test("cameras: shown with what they see on the plan, dragged to their wall", async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const p = window.panel;
      const m = structuredClone(p._model);
      m.levels[0].rooms.find((r) => r.id === "hall").cameras = [{ entity: "camera.door", at: [1.5, 2], direction: 0, fov: 80 }];
      p.commit(m);
    });
    const cam = page.locator('homeslice-panel svg.plan [data-camera]');
    assert((await cam.count()) === 1 && (await page.locator("homeslice-panel svg.plan polygon.camera-view").count()) === 1, "no camera on the plan");
    const b = await cam.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    const c = (await room("hall")).cameras[0];
    assert(c.at[1] > 2.3, `camera not moved: ${JSON.stringify(c)}`);
    assert((await page.locator("homeslice-panel .inspector h3", { hasText: "Cameras" }).count()) === 1, "no cameras in the room panel");
    await shot(page, "editor-camera");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  await test("lights: turn one into a row of spots, add a spot and drag it", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const lb = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    await page.mouse.click(lb.x + lb.width * 0.85, lb.y + lb.height * 0.9);
    const item = page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Sofa lamp" }).first();
    await item.locator("select").selectOption("spot");
    const light = async () => (await room("living")).lights.find((l) => l.entity === "light.living_room");
    assert((await light())?.type === "spot" && (await light()).at, `spot light: ${JSON.stringify(await light())}`);
    await item.locator("button", { hasText: "+" }).click();
    await item.locator("button", { hasText: "+" }).click();
    let l = await light();
    assert(l.spots?.length === 2 && Math.abs(l.spots[1][0] - l.spots[0][0] - 0.8) < 1e-6, `spots: ${JSON.stringify(l.spots)}`);
    // drag the last spot
    const spot = page.locator('homeslice-panel svg.plan circle.lamp-part[data-light*="light.living_room"]').last();
    const b = await spot.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    l = await light();
    assert(l.spots[1][1] > l.spots[0][1] + 0.3, `dragged spot: ${JSON.stringify(l.spots)}`);
    await shot(page, "editor-spots");
    // back to a lamp: the spots go
    await item.locator("select").selectOption("lamp");
    l = await light();
    assert(!l.type && !l.spots, `back to a lamp: ${JSON.stringify(l)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    for (let i = 0; i < 5; i++) await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  await test("robots: place a mower's dock, show it live from GPS after two calibration spots", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="devices"]').click();
    await page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Mower" }).locator("button").click();
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("Click where the dock of Mower is"), "no placing hint");
    const dockAt = await toPage([6, 9.3]);
    await page.mouse.click(dockAt.x, dockAt.y);
    const mower = () => model().then((m) => m.robots?.find((r) => r.entity === "lawn_mower.mower"));
    assert((await mower())?.level === "ground", `mower: ${JSON.stringify(await mower())}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Mower", "mower not selected");
    await page.locator("homeslice-panel .inspector label.check", { hasText: "live position" }).locator("input").check();
    assert((await page.locator("homeslice-panel .inspector label", { hasText: "Attribute" }).locator("select").inputValue()) === "", "GPS should be offered for a mower with latitude/longitude");
    // spot 1: where it is now
    const record = async (lat, lon, plan) => {
      await page.evaluate(([lat, lon]) => {
        const h = window.panel.hass;
        window.panel.hass = { ...h, states: { ...h.states, "lawn_mower.mower": { ...h.states["lawn_mower.mower"], attributes: { ...h.states["lawn_mower.mower"].attributes, latitude: lat, longitude: lon } } } };
      }, [lat, lon]);
      await page.locator("homeslice-panel .inspector button", { hasText: "Record a spot" }).click();
      const at = await toPage(plan);
      await page.mouse.click(at.x, at.y);
    };
    await record(48.0, 10.0, [1, 9.5]);
    await record(48.0, 10.0001, [7, 9.5]);
    assert((await mower()).position.points.length === 2, `points: ${JSON.stringify((await mower()).position)}`);
    assert((await page.locator("homeslice-panel .inspector").textContent()).includes("Calibrated"), "not shown as calibrated");
    // it is where the second spot was recorded
    const live = await page.locator("homeslice-panel svg.plan circle.robot-live").last().boundingBox();
    const spot = await toPage([7, 9.5]);
    assert(Math.hypot(live.x + live.width / 2 - spot.x, live.y + live.height / 2 - spot.y) < 3, `live dot at ${JSON.stringify(live)}, expected ${JSON.stringify(spot)}`);
    await shot(page, "editor-robot");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  await test("objects mode: place energy items from HA's energy settings", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="devices"]').click();
    const offers = await page.locator("homeslice-panel .inspector ul.offers li .name").allTextContents();
    assert(["Solar", "Battery", "Grid", "Inverter", "Heat pump"].every((n) => offers.includes(n)), `offers: ${offers}`);
    await page.locator("homeslice-panel .inspector ul.offers li", { hasText: "Battery" }).locator("button").click();
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("Click where Battery is"), "no placing hint");
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
    // the placed item has its own inspector
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Battery", "battery not selected");
    assert(await page.locator("homeslice-panel .inspector label", { hasText: "Charge sensor" }).count(), "no charge sensor for the battery");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="devices"]').click();
    await page.locator("homeslice-panel .inspector ul.offers li", { hasText: "Solar" }).locator("button").click();
    assert((await model()).energy[1].kind === "solar", "solar not added");
    // a heat pump and a grid meter; the heat pump's line goes to the battery (the hub) by itself
    const placeAt = async (name, x, y) => {
      await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="devices"]').click();
      await page.locator("homeslice-panel .inspector ul.offers li", { hasText: name }).locator("button").click();
      await page.mouse.click(plan.x + ox + x * scale, plan.y + oy + y * scale);
    };
    await placeAt("Grid", 1, 7);
    await placeAt("Heat pump", 4, 7);
    const hp = (await model()).energy.findIndex((e) => e.name === "Heat pump");
    const connects = page.locator("homeslice-panel .inspector label", { hasText: "Line connects to" }).locator("select");
    assert((await connects.locator("option:checked").textContent()) === "Automatic: Battery", `default: ${await connects.locator("option:checked").textContent()}`);
    // connect it to the grid meter
    const grid = (await model()).energy.findIndex((e) => e.kind === "grid");
    await connects.selectOption(String(grid));
    assert((await model()).energy[hp].to === "grid" && (await model()).energy[grid].id === "grid", `connected: ${JSON.stringify((await model()).energy)}`);
    // …or drag from its ring onto the battery
    const ring = await page.locator("homeslice-panel svg.plan g.link-handle circle").boundingBox();
    const battery = await page.locator('homeslice-panel svg.plan g.energy-marker[data-energy="0"] rect').boundingBox();
    await page.mouse.move(ring.x + ring.width / 2, ring.y + ring.height / 2);
    await page.mouse.down();
    await page.mouse.move(battery.x + 11, battery.y + 11, { steps: 8 });
    assert(await page.locator("homeslice-panel svg.plan line.energy-link.drawing").count(), "no line while connecting");
    await page.mouse.up();
    assert((await model()).energy[hp].to === "battery", `dragged: ${JSON.stringify((await model()).energy[hp])}`);
    assert((await page.locator("homeslice-panel svg.plan line.energy-link").count()) >= 2, "lines not drawn on the plan");
    await shot(page, "editor-energy");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="devices"]').click();
    await page.locator("homeslice-panel .inspector ul.energy li", { hasText: "Battery" }).locator("button:not(.link)").click();
    assert((await model()).energy.length === 3, "battery not removed");
    assert((await model()).energy.every((e) => e.to === undefined), "lines to the removed battery should go back to the hub");
    await page.keyboard.press("Control+z");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
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

console.log("editor, phone");
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate((f) => window.setupPanel(f, { narrow: true }), loadFixture("dev/fixtures/demo-hass.json"));
  await test("on a phone the plan gets most of the screen; the inspector is a sheet below", async () => {
    await page.waitForTimeout(500);
    await shot(page, "editor-phone");
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    assert(plan.height > 360 && plan.width > 370, `plan ${JSON.stringify(plan)}`);
    // tools explain themselves on a phone too; the stairs tool says why it can't work on the top floor
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="stairs"]').click();
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("Drag a rectangle where the stairwell is"), "no stairs hint");
    await page.locator("homeslice-panel aside.levels button.level", { hasText: "First Floor" }).click();
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("this is the top floor"), "no top-floor explanation");
    await shot(page, "editor-phone-hint");
    await page.locator("homeslice-panel aside.levels button.level", { hasText: "Ground Floor" }).click();
    await page.locator("homeslice-panel .hint-bar button.close").click();
    assert(!(await page.locator("homeslice-panel .hint-bar").count()), "hint not hidden");
    await page.evaluate(() => localStorage.removeItem("homeslice-hints-hidden"));
    await page.keyboard.press("Escape");
    // the inspector still works: select a room
    const kb = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height * 0.75);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Kitchen", "room not selected on a phone");
    await shot(page, "editor-phone-room");
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
  await test("paint a room: floor and walls from the finish pickers, an accent wall", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    const lb = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    await page.mouse.click(lb.x + lb.width * 0.5, lb.y + lb.height * 0.6);
    const living = () => page.evaluate(() => window.panel._model.levels[0].rooms.find((r) => r.id === "living"));
    const picker = (surface, n = 0) => page.locator(`homeslice-panel .inspector details.finish-picker[data-surface="${surface}"]`).nth(n);
    await picker("floor").locator("summary").click();
    await picker("floor").locator('button.finish[data-finish="oak_herringbone"]').click();
    assert((await living()).floor === "oak_herringbone", `floor: ${(await living()).floor}`);
    await picker("wall").locator("summary").click();
    await picker("wall").locator('button.finish[data-finish="paint_sage"]').click();
    await page.locator("homeslice-panel .inspector select.add-wall-side").selectOption("north");
    let r = await living();
    assert(r.wall === "paint_sage" && r.wall_sides?.north === "acoustic_oak", `walls: ${JSON.stringify(r)}`);
    await picker("wall", 1).locator("summary").click();
    await picker("wall", 1).locator('button.finish[data-finish="brick_white"]').click();
    r = await living();
    assert(r.wall_sides?.north === "brick_white", `accent: ${JSON.stringify(r.wall_sides)}`);
    // a Poly Haven texture: downloaded into Home Assistant first, then drawn at its size
    await page.route("**/homeslice_assets/textures/**", (route) =>
      route.request().url().endsWith("info.json")
        ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ size: [2, 2] }) })
        : route.fulfill({ contentType: "image/jpeg", body: readFileSync(join(root, "dev/fixtures/texture.jpg")) }),
    );
    await picker("floor").locator("summary").click();
    await picker("floor").locator('button[data-finish-source="polyhaven"]').click();
    await picker("floor").locator('button.finish[data-finish="polyhaven:wood_floor"]').click();
    await page.waitForFunction(() => window.panel._model.levels[0].rooms.find((r) => r.id === "living").floor === "polyhaven:wood_floor");
    assert((await page.evaluate(() => window.panel.hass.fetched)).includes("texture:wood_floor"), "texture not fetched into HA first");
    assert((await picker("floor").locator("summary").textContent()).includes("Wood Floor"), "picked texture not named");
    await page.evaluate(() => (window.panel._finishSource = "builtin"));
    await page.waitForTimeout(500);
    await shot(page, "editor-paint");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Control+z");
    r = await living();
    assert(!r.floor && !r.wall && !r.wall_sides, `not undone: ${JSON.stringify(r)}`);
    await page.keyboard.press("Escape");
    assert(errors.length === 0, errors.join(" | "));
  });
  await test("unsaved changes survive a reload and can be restored", async () => {
    await page.evaluate(() => {
      const p = window.panel;
      const m = structuredClone(p._model);
      m.levels[0].rooms[0].name = "Draft name";
      p.commit(m);
    });
    // the draft is stored a moment after the change (slower machines take longer)
    await page.waitForFunction(() => localStorage.getItem("homeslice-draft:demo")?.includes("Draft name"), null, { timeout: 15000 });
    await page.reload();
    await page.waitForFunction(() => window.ready);
    await page.evaluate((f) => window.setupPanel(f), loadFixture("dev/fixtures/demo-hass.json"));
    await page.waitForSelector("homeslice-panel .draft");
    await page.locator("homeslice-panel .draft button", { hasText: "Restore" }).click();
    assert((await page.evaluate(() => window.panel._model.levels[0].rooms[0].name)) === "Draft name", "draft not restored");
    assert(await page.locator("homeslice-panel button.save.dirty").count(), "restored draft should be unsaved");
    await page.locator("homeslice-panel button.save").click();
    await page.waitForFunction(() => localStorage.getItem("homeslice-draft:demo") === null, null, { timeout: 15000 }).catch(() => {});
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

  await test("with no house, a new one is made from HA's floors and areas; an Outside floor joins the ground floor", async () => {
    // the garden on its own HA floor, as many people set it up
    await page.evaluate(() => {
      const h = window.panel.hass;
      window.panel.hass = {
        ...h,
        floors: { ...h.floors, outside: { floor_id: "outside", name: "Outside", level: null } },
        areas: { ...h.areas, garden: { ...h.areas.garden, floor_id: "outside" } },
      };
    });
    await page.locator("homeslice-panel .empty button.primary").click();
    const dialog = page.locator("homeslice-panel .create");
    assert((await dialog.locator("input[type=checkbox]").count()) === 5, "expected four floors and the rooms option");
    const outsideLevel = dialog.locator('select[aria-label="Level for Outside"]');
    assert((await outsideLevel.inputValue()) === "ground_floor", `outside goes to: ${await outsideLevel.inputValue()}`);
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
    assert(JSON.stringify(m.levels[1].include_floors) === '["outside"]', `ground floor includes: ${JSON.stringify(m.levels[1].include_floors)}`);
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

  await test("floor plan image: a robot vacuum's map, true to scale", async () => {
    await page.keyboard.press("Escape");
    // a vacuum with a map picture on its device
    await page.route("**/api/image_proxy/image.robo_map**", (route) => route.fulfill({ contentType: "image/jpeg", body: readFileSync("dev/fixtures/texture.jpg") }));
    await page.evaluate(() => {
      const p = window.panel;
      const h = p.hass;
      p.hass = {
        ...h,
        entities: { ...h.entities, "vacuum.robo": { ...(h.entities["vacuum.robo"] ?? { entity_id: "vacuum.robo" }), device_id: "robo_device" }, "image.robo_map": { entity_id: "image.robo_map", device_id: "robo_device" } },
        states: { ...h.states, "image.robo_map": { entity_id: "image.robo_map", state: "2026-11-01", attributes: { friendly_name: "Robo Ground Floor", entity_picture: "/api/image_proxy/image.robo_map?token=x" } } },
      };
    });
    const b = await page.locator("homeslice-panel svg.plan").boundingBox();
    await page.mouse.click(b.x + 5, b.y + b.height - 5); // empty space: the level inspector
    const button = page.locator("homeslice-panel .inspector button[data-robot-map='image.robo_map']");
    await button.waitFor({ timeout: 5000 });
    await button.click();
    await page.waitForSelector("homeslice-panel svg.plan image.underlay");
    const scale = await page.evaluate(() => window.panel._underlay.place.scale);
    assert(scale === 0.0125, `scale ${scale}`);
    await page.locator("homeslice-panel .inspector button", { hasText: "Remove image" }).click();
    await page.keyboard.press("Escape");
  });

  await test("backup: download one file, restore it", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    const download = page.waitForEvent("download");
    await page.locator("homeslice-panel button[data-backup]").click();
    assert((await download).suggestedFilename().endsWith("homeslice-backup.zip"), "no backup file");
    const zip = Buffer.from(zipSync({ "manifest.json": strToU8('{"format":"homeslice-backup","version":1}') }));
    await page.locator("homeslice-panel input[type=file][accept='.zip']").setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer: zip });
    await page.waitForSelector("homeslice-panel p.notice", { timeout: 5000 });
    assert((await page.locator("homeslice-panel p.notice").textContent()).includes("Restored"), "no note after restoring");
    assert(await page.evaluate(() => window.panel._hass.restored?.startsWith("data:")), "the backup was not sent");
  });

  await test("import from Sweet Home 3D: rooms on the wall centres, doors, windows, furniture", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    // two rooms inside 20 cm walls, a door between them, a window, a sofa and a bed
    const xml = `<?xml version="1.0"?><home name="Flat">
      <level id="l0" name="Ground" elevation="0" height="250" floorThickness="12"/>
      <wall level="l0" xStart="0" yStart="0" xEnd="820" yEnd="0" thickness="20"/>
      <room level="l0" name="Living"><point x="10" y="10"/><point x="490" y="10"/><point x="490" y="390"/><point x="10" y="390"/></room>
      <room level="l0" name="Bedroom"><point x="510" y="10"/><point x="810" y="10"/><point x="810" y="390"/><point x="510" y="390"/></room>
      <doorOrWindow level="l0" name="Door" x="500" y="200" angle="1.5708" width="90" depth="20" height="210" elevation="0"/>
      <doorOrWindow level="l0" name="Window" x="250" y="0" angle="0" width="150" depth="20" height="130" elevation="90"/>
      <pieceOfFurniture level="l0" name="Sofa" x="250" y="300" angle="3.14159" width="220" depth="90" height="80"/>
      <pieceOfFurniture level="l0" name="Double bed" x="660" y="200" angle="0" width="160" depth="200" height="50"/>
    </home>`;
    const sh3d = Buffer.from(zipSync({ "Home.xml": strToU8(xml) }));
    await page.locator("homeslice-panel input[type=file][accept='.sh3d']").setInputFiles({ name: "flat.sh3d", mimeType: "application/octet-stream", buffer: sh3d });
    await page.waitForFunction(() => window.panel._settings?.paste?.includes("Bedroom"), null, { timeout: 5000 });
    const house = parse(await page.evaluate(() => window.panel._settings.paste));
    const [living, bedroom] = house.levels[0].rooms;
    assert(living.name === "Living" && JSON.stringify(living.polygon[0]) === "[0,0]", `living: ${JSON.stringify(living)}`);
    assert(bedroom.polygon.some(([x]) => x === 8.2), `bedroom: ${JSON.stringify(bedroom)}`);
    const types = house.levels[0].openings.map((o) => `${o.type}:${o.room}:${o.side}`).sort();
    assert(JSON.stringify(types) === JSON.stringify(["door:bedroom:west", "window:living:north"].sort()) || JSON.stringify(types) === JSON.stringify(["door:living:east", "window:living:north"].sort()), `openings: ${types}`);
    assert(living.furniture[0].type === "sofa" && living.furniture[0].rotation === 180 && bedroom.furniture[0].type === "bed", `furniture: ${JSON.stringify([living.furniture, bedroom.furniture])}`);
    await page.locator("homeslice-panel textarea.yaml").fill("");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    assert(!(await page.evaluate(() => window.panel._settings)), "settings still open");
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

  await test("house settings: a prompt for an AI assistant, its errors, restoring the previous version", async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      // the page's clipboard, readable by the test
      window.copied = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => void window.copied.push(t) } });
    });
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Copy prompt for an AI assistant" }).click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Copied" }).first().waitFor();
    const prompt = await page.evaluate(() => window.copied.at(-1));
    assert(prompt.startsWith("Please draw my home for Homeslice") && prompt.includes("guide for AI assistants") && prompt.includes("House: test_house"), `prompt: ${prompt.slice(0, 200)}`);
    // an assistant's answer with a mistake: the errors can go straight back to it
    await page.locator("homeslice-panel textarea.yaml").fill("schema: 1\nid: x\nlevels:\n  - id: g\n    rooms:\n      - { id: a }");
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Copy errors for the assistant" }).click();
    const errorsText = await page.evaluate(() => window.copied.at(-1));
    assert(errorsText.startsWith("Homeslice found these errors") && errorsText.includes("- levels.g.rooms.a: A room needs rect"), `errors: ${errorsText}`);
    // save twice: the first version can be restored
    await page.keyboard.press("Escape");
    const before = (await model()).levels[0].rooms[0].name;
    await page.evaluate(() => window.panel.save());
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      m.levels[0].rooms[0].name = "Changed by an assistant";
      return window.panel.hass.callWS({ type: "homeslice/model/save", house: "test_house", model: m });
    });
    await page.evaluate(() => window.panel.hass.callWS({ type: "homeslice/houses" }).then((h) => (window.panel._houses = h)));
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Restore the version from" }).click();
    await page.waitForFunction((name) => window.panel._model?.levels[0].rooms[0].name === name, before);
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
