// editor, unsaved changes
import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, base, browser, loadFixture, root, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("editor, unsaved changes", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/dev/harness.html`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate((f) => window.setupPanel(f), loadFixture("dev/fixtures/demo-hass.json"));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("paint a room: floor and walls from the finish pickers, an accent wall", async () => {
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
  test("unsaved changes survive a reload and can be restored", async () => {
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
});
