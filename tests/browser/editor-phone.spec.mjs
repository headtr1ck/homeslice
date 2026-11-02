// editor, phone
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, base, browser, loadFixture, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("editor, phone", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/dev/harness.html`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate((f) => window.setupPanel(f, { narrow: true }), loadFixture("dev/fixtures/demo-hass.json"));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("on a phone the plan gets most of the screen; the inspector is a sheet below", async () => {
    await page.waitForTimeout(500);
    await shot(page, "editor-phone");
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    assert(plan.height > 360 && plan.width > 370, `plan ${JSON.stringify(plan)}`);
    // tools explain themselves on a phone too; the stairs tool says why it can't work on the top floor
    await page.locator('homeslice-panel aside.tools button[data-group="openings"]').click();
    await page.locator('homeslice-panel .sub-tools button[data-sub-tool="stairs"]').click();
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
});
