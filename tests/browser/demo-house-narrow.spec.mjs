// demo house, roof
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, base, browser, loadFixture, setBrowser, shot, triangles } from "./helpers.mjs";

test.describe.serial("demo house, narrow card", () => {
  let page, errors, last;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}/dev/harness.html`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate((f) => window.setupCardEditor(f, { type: "custom:homeslice-card", house: "demo" }), loadFixture("dev/fixtures/demo-hass.json"));
    last = () => page.evaluate(() => window.editorConfigs.at(-1));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("card editor: turning the preview sets the angle; look options", async () => {
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
});
