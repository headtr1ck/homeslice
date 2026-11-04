// the start screen: tracing robot maps and floor plans, a floor without a map caught live
import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { assert, base, browser, loadFixture, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("editor, the start screen", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} (${m.location().url.split("/").pop()}:${m.location().lineNumber})`));
    page.on("dialog", (d) => d.accept());
    // both robots' map pictures: the synthetic test map (two rooms in the map's colours)
    await page.route("**/api/image_proxy/image.**", (route) => route.fulfill({ contentType: "image/png", body: readFileSync("dev/fixtures/robot-map.png") }));
    await page.goto(`${base}/dev/harness.html`);
    await page.waitForFunction(() => window.ready);
    const fixture = loadFixture("dev/fixtures/demo-hass.json");
    fixture.model = null;
    // a Roborock with a map of the ground floor; a second one that shows its map only while it works
    Object.assign(fixture.entities, {
      "vacuum.robo": { entity_id: "vacuum.robo", device_id: "robo" },
      "image.robo_ground_floor": { entity_id: "image.robo_ground_floor", device_id: "robo", platform: "roborock" },
      "vacuum.q10": { entity_id: "vacuum.q10", device_id: "q10" },
      "image.q10_map": { entity_id: "image.q10_map", device_id: "q10", platform: "roborock" },
    });
    Object.assign(fixture.states, {
      "image.robo_ground_floor": { entity_id: "image.robo_ground_floor", state: "2026-11-02T10:00:00", attributes: { friendly_name: "Robo Ground Floor", entity_picture: "/api/image_proxy/image.robo_ground_floor?token=a" } },
      "vacuum.q10": { entity_id: "vacuum.q10", state: "docked", attributes: { friendly_name: "Q10" } },
      "image.q10_map": { entity_id: "image.q10_map", state: "unknown", attributes: { friendly_name: "Q10 Map", entity_picture: "/api/image_proxy/image.q10_map?token=b" } },
    });
    fixture.robotMaps = [{ flag: 0, name: "Ground Floor", rooms: { 1: "Living room", 4: "Kitchen" } }];
    await page.evaluate((f) => window.setupPanel(f), fixture);
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("tracing: each floor its robot map and floor plan, a floor without a map mapped live", async () => {
    const start = page.locator("homeslice-panel .start");
    await start.waitFor({ timeout: 5000 });
    const robot = start.locator('section[data-start="trace"]');
    assert(!(await robot.evaluate((e) => e.classList.contains("grey"))), "the trace box is greyed out");
    assert((await robot.locator(".start-found").textContent()).includes("Robo Ground Floor"), "maps found");
    await robot.locator("button.start-head").click();
    // the ground floor took its map by name; the first floor has none yet: carry a robot there, or map it live
    assert((await robot.locator('select[data-start-map="ground_floor"]').inputValue()) === "image.robo_ground_floor", "ground floor's map");
    const first = robot.locator('[data-start-floor="first_floor"]');
    assert((await first.locator("select").inputValue()) === "", "first floor has a map");
    assert((await first.locator("[data-start-recommend]").textContent()).includes("Recommended:"), "the robot keeping maps is not recommended");
    // mapped live: Home Assistant watches the robot's map from now on
    await first.locator("button[data-start-capture]").click();
    let panel = robot.locator("[data-start-capture-panel]");
    assert((await panel.locator(".notice").textContent()).includes("Waiting"), "not waiting for the map");
    assert(await panel.locator("button[data-start-capture-keep]").isDisabled(), "can keep a map not showing");
    await shot(page, "editor-start-robot");
    // away to Settings (to reload the robot's integration, say) and back: everything where it was left
    await page.evaluate(async () => {
      const hass = window.panel.hass;
      window.panel.remove();
      const panel = document.createElement("homeslice-panel");
      panel.style.cssText = "display:flex;height:100vh";
      document.getElementById("root").append(panel);
      panel.hass = hass;
      window.panel = panel;
    });
    await page.locator("homeslice-panel .start").waitFor({ timeout: 5000 });
    assert(await robot.evaluate((e) => e.classList.contains("open")), "the robot box is closed again");
    assert(await first.locator(".start-floor-map", { hasText: "is catching" }).count(), "the watch is gone");
    // meanwhile the robot set off: its map shows, Home Assistant caught it
    await page.evaluate(() => window.panel.hass.setState("image.q10_map", "2026-11-02T10:05:00"));
    await first.locator("button.link", { hasText: "Show" }).click();
    panel = robot.locator("[data-start-capture-panel]");
    await panel.locator("img.start-live").waitFor({ timeout: 8000 });
    await panel.locator("button[data-start-capture-keep]").click();
    await first.locator(".start-floor-map", { hasText: "Caught live" }).waitFor({ timeout: 3000 });
    // the robot stops: its map goes, the one caught stays
    await page.evaluate(() => window.panel.hass.setState("image.q10_map", "unknown"));
    // a floor plan image for the ground floor too
    await robot.locator('input[data-start-plan="ground_floor"]').setInputFiles("dev/fixtures/robot-map.png");
    await robot.locator('[data-start-floor="ground_floor"] .start-plan img').waitFor({ timeout: 3000 });
    await robot.locator("button[data-start-trace-run]").click();
    await page.locator("homeslice-panel svg.plan").waitFor({ timeout: 10000 });
    const m = await page.evaluate(() => window.panel._model);
    // the floors start empty: the rooms are traced over the images
    assert(m.levels.every((l) => !l.rooms.length), `rooms: ${JSON.stringify(m.levels.map((l) => l.rooms.length))}`);
    const ground = m.levels.find((l) => l.floor_id === "ground_floor");
    const upper = m.levels.find((l) => l.floor_id === "first_floor");
    const list = await page.evaluate(() => window.panel.hass.callWS({ type: "homeslice/underlay/get", house: window.panel._house }));
    assert(list.slots.includes(ground.id) && list.slots.includes(`${ground.id}#1`) && list.slots.includes(upper.id), `backdrops: ${JSON.stringify(list)}`);
    // the ground floor: the floor plan first, then the robot's map (true to scale), switched with N
    await page.evaluate((id) => (window.panel._level = id), ground.id);
    const cycle = page.locator("homeslice-panel button[data-backdrop-cycle]");
    await cycle.waitFor({ timeout: 5000 });
    assert((await cycle.textContent()).includes("Floor plan"), `first backdrop: ${await cycle.textContent()}`);
    await page.locator("homeslice-panel svg.plan").click({ position: { x: 600, y: 600 } });
    await page.keyboard.press("n");
    await page.waitForFunction(() => window.panel._underlay?.slot === 1, null, { timeout: 5000 });
    const u = await page.evaluate(() => window.panel._underlay);
    assert(u.source === "image.robo_ground_floor" && u.place.scale === 0.0125, `ground floor's map: ${JSON.stringify({ source: u.source, place: u.place })}`);
    // and what to do next; nothing of the start is kept any more
    assert((await page.locator("homeslice-panel [data-start-next]").textContent()).includes("N switches"), "no next step");
    const left = await page.evaluate(() => window.panel.hass.callWS({ type: "homeslice/start" }));
    assert(left.state === null && !Object.keys(left.captures).length, `start kept: ${JSON.stringify(left).slice(0, 200)}`);
    await shot(page, "editor-start-robot-house");
    assert(errors.length === 0, errors.join(" | "));
  });

  test("starting over, with AI: the prompt carries the robot maps; a pasted answer is checked, then becomes the house", async () => {
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.locator("homeslice-panel button[data-start-over]").click();
    const start = page.locator("homeslice-panel .start");
    assert((await start.locator("h1").textContent()).includes("Start this house over"), "not starting over");
    const ai = start.locator('section[data-start="ai"]');
    await ai.locator("button.start-head").click();
    assert((await ai.locator(".start-found").textContent()).includes("No AI connected"), "AI box text");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await ai.locator("button[data-start-ai-copy]").click();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    assert(prompt.includes("Robot vacuum maps") && prompt.includes("12.5 mm per pixel") && prompt.includes('"Kitchen"'), `prompt: ${prompt.slice(-600)}`);
    // a broken answer: what is wrong, to send back
    await ai.locator("textarea[data-start-paste]").fill("```yaml\nschema: 2\nid: x\nlevels: []\n```");
    await ai.locator("button[data-start-paste-use]").click();
    await ai.locator("ul.problems li").first().waitFor({ timeout: 3000 });
    const good = "Sure:\n```yaml\nschema: 2\nid: x\nname: AI house\noutline: auto\nlevels:\n  - id: ground_floor\n    floor_id: ground_floor\n    rooms:\n      - { id: kitchen, area_id: kitchen, rect: [0, 0, 4, 4] }\n      - { id: living, area_id: living_room, rect: [4, 0, 5, 4] }\n```";
    await ai.locator("textarea[data-start-paste]").fill(good);
    await ai.locator("button[data-start-paste-use]").click();
    await page.waitForFunction(() => window.panel._model?.levels?.[0]?.rooms?.length === 2, null, { timeout: 5000 });
    const m = await page.evaluate(() => ({ id: window.panel._model.id, house: window.panel._house }));
    // the same house, started over (its last version restorable)
    assert(m.id === m.house, `house: ${JSON.stringify(m)}`);
    assert(errors.length === 0, errors.join(" | "));
  });
});
