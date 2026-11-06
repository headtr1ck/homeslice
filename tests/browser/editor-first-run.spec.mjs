// editor, the first run on a fresh Home Assistant: areas but no floors (Living Room, Kitchen, Bedroom)
import { test } from "@playwright/test";
import { assert, base, browser, loadFixture, librarySource, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("editor, first run without floors", () => {
  let page, errors, model;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/dev/harness.html`);
    await page.waitForFunction(() => window.ready);
    const fixture = loadFixture("dev/fixtures/demo-hass.json");
    fixture.model = null;
    fixture.floors = {};
    fixture.areas = {
      living_room: { area_id: "living_room", name: "Living Room", floor_id: null },
      kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: null },
      bedroom: { area_id: "bedroom", name: "Bedroom", floor_id: null },
    };
    await page.evaluate((f) => window.setupPanel(f), fixture);
    model = () => page.evaluate(() => window.panel._model);
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("tracing offers one image for the whole house", async () => {
    const start = page.locator("homeslice-panel .start");
    await start.waitFor({ timeout: 5000 });
    const trace = start.locator('section[data-start="trace"]');
    await trace.locator("button.start-head").click();
    const rows = trace.locator("[data-start-floor]");
    await rows.first().waitFor({ timeout: 3000 });
    assert((await rows.count()) === 1, `rows: ${await rows.count()}`);
    assert((await rows.first().locator(".start-floor-name").textContent()) === "Your home", "row name");
    assert((await trace.locator("input[data-start-plan]").count()) === 1, "no way to pick an image");
    const text = await trace.locator(".start-body").textContent();
    assert(text.includes("No floors in Home Assistant") && text.includes("one empty floor") && !text.includes("For each floor"), `text: ${text}`);
    await shot(page, "editor-first-run-trace");
    // kept in Home Assistant (the start goes on where it was left)
    await page.waitForFunction(() => window.panel.hass.callWS({ type: "homeslice/start" }).then((s) => (window.__kept = !!s.state)) && window.__kept, null, { timeout: 3000 });
  });

  test("from the areas: one level of the size given with a room per area; the welcome doesn't come back", async () => {
    const start = page.locator("homeslice-panel .start");
    await start.locator('section[data-start="floors"] button.start-head').click();
    const dialog = page.locator("homeslice-panel .create");
    await dialog.locator("input[type=number]").nth(0).fill("10");
    await dialog.locator("input[type=number]").nth(0).dispatchEvent("change");
    await dialog.locator("button.primary").click();
    await page.waitForFunction(() => window.panel.shadowRoot.querySelector("svg.plan .room"));
    const m = await model();
    assert(m.levels.length === 1 && !m.levels[0].floor_id, `levels: ${JSON.stringify(m.levels.map((l) => l.id))}`);
    const rooms = m.levels[0].rooms;
    assert(JSON.stringify(rooms.map((r) => r.area_id).sort()) === '["bedroom","kitchen","living_room"]', `rooms: ${JSON.stringify(rooms)}`);
    const right = Math.max(...rooms.map((r) => r.rect[0] + r.rect[2]));
    const bottom = Math.max(...rooms.map((r) => r.rect[1] + r.rect[3]));
    assert(right === 10 && bottom === 8, `size ${right} × ${bottom}`);
    assert(!(await page.locator("homeslice-panel .start").count()), "the start is still shown");
    const kept = await page.evaluate(() => window.panel.hass.callWS({ type: "homeslice/start" }));
    assert(kept.state === null, `start still kept: ${JSON.stringify(kept.state)}`);
    // the editor opened again: the house, no welcome over it
    await page.evaluate(async () => {
      const hass = window.panel.hass;
      window.panel.remove();
      const panel = document.createElement("homeslice-panel");
      panel.style.cssText = "display:flex;height:100vh";
      document.getElementById("root").append(panel);
      panel.hass = hass;
      window.panel = panel;
    });
    await page.waitForFunction(() => window.panel.shadowRoot?.querySelector("svg.plan .room"), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    assert(!(await page.locator("homeslice-panel .start").count()), "welcome shown over the house");
    await shot(page, "editor-first-run-house");
  });

  test("the checklist counts areas on no floor", async () => {
    await page.locator('homeslice-panel svg.plan g[data-room="bedroom"] polygon').click({ force: true });
    await page.keyboard.press("Delete");
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button.checklist-button").click();
    const item = page.locator("homeslice-panel .inspector ul.checklist li", { hasText: "Bedroom" });
    await item.waitFor({ timeout: 3000 });
    // with the way to fix it: draw its room
    await item.locator("button").click();
    assert((await page.evaluate(() => window.panel._pendingArea)) === "bedroom", "not drawing the bedroom");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    assert((await model()).levels[0].rooms.some((r) => r.area_id === "bedroom"), "bedroom not back");
  });

  test("library: a fridge for 'fridge'; clicked pieces go to free spots, not on each other", async () => {
    // the kitchen's library (a placed piece is selected: the room again for the next)
    const library = async () => {
      await page.keyboard.press("Escape");
      await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
      const kb = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
      await page.mouse.click(kb.x + kb.width * 0.15, kb.y + kb.height * 0.85);
      await page.locator("homeslice-panel .inspector button", { hasText: "Add furniture" }).click();
      await librarySource(page, "builtin");
    };
    await library();
    await page.locator('homeslice-panel .inspector .library button[data-key="modern:dining_table"]').click();
    await library();
    await page.locator("homeslice-panel .inspector input.library-search").fill("fridge");
    const first = await page.locator("homeslice-panel .inspector .library button.piece").first().getAttribute("data-key");
    assert(first === "modern:fridge_freestanding", `first for fridge: ${first}`);
    await page.locator("homeslice-panel .inspector .library button.piece").first().click();
    const kitchen = (await model()).levels[0].rooms.find((r) => r.id === "kitchen");
    const [table, fridge] = kitchen.furniture;
    assert(table.type === "table" && fridge.type === "fridge", `pieces: ${JSON.stringify(kitchen.furniture)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Fridge", "the fridge isn't selected");
    // apart: their footprints don't overlap
    const half = (f, size) => (((f.rotation ?? 0) / 90) % 2 ? [size[1] / 2, size[0] / 2] : [size[0] / 2, size[1] / 2]);
    const [ht, hf] = [half(table, table.size ?? [1.6, 0.9]), half(fridge, fridge.size ?? [0.6, 0.66])];
    const apart = Math.abs(table.at[0] - fridge.at[0]) >= ht[0] + hf[0] - 0.01 || Math.abs(table.at[1] - fridge.at[1]) >= ht[1] + hf[1] - 0.01;
    assert(apart, `table ${JSON.stringify(table)} and fridge ${JSON.stringify(fridge)} overlap`);
    // the fridge with its back to a wall: within its depth plus the wall of the room's edge
    const [w, d] = kitchen.rect.slice(2);
    const gap = Math.min(fridge.at[0] - hf[0], fridge.at[1] - hf[1], w - fridge.at[0] - hf[0], d - fridge.at[1] - hf[1]);
    assert(gap < 0.2, `fridge not against a wall: ${JSON.stringify(fridge)} in ${w} × ${d}`);
    await shot(page, "editor-first-run-furnished");
    assert(!errors.length, errors.join("\n"));
  });
});
