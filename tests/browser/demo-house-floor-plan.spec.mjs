// demo house, floor plan
import { test } from "@playwright/test";
import { join } from "node:path";
import { act, assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, floor plan", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { mode: "plan" }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("plan mode: one floor at a time from straight above, starting on the entrance floor", async () => {
    await page.waitForFunction(() => window.card.renderer.orientation.elevation === 90, null, { timeout: 5000 }).catch(() => {});
    let o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 90 && o.azimuth === 180 && o.fov === 3, `camera ${JSON.stringify(o)}`);
    const floors = await page.locator("homeslice-card nav.levels button").allTextContents();
    assert(!floors.some((f) => f.includes("All floors")), `floor buttons: ${floors}`);
    assert((await page.locator("homeslice-card nav.levels button.active").textContent()).includes("Ground Floor"), "not on the entrance floor");
    assert(!(await page.evaluate(() => window.card.renderer.roofVisible())), "a plan has no roof");
    assert((await page.evaluate(() => window.card.renderer.swingMaterials.length)) === 2, "a door swing per door on the plan");
    // and every window its mark on the wall
    assert((await page.evaluate(() => [...window.card.renderer.openingLines.values()].filter((e) => e.marks.length).length)) >= 2, "window marks on the plan");
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
});
