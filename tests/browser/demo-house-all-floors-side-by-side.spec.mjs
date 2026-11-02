// demo house, all floors side by side
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, all floors side by side", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { mode: "plan", floors: "all" }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("plan with all floors: side by side from above, labels on each", async () => {
    const r = await page.evaluate(() => ({ level: window.card._level, xs: window.card.renderer.levels.map((l) => l.group.position.x), o: window.card.renderer.orientation }));
    assert(r.level === null && r.xs[1] > r.xs[0] + 7 && r.o.elevation === 90, JSON.stringify(r));
    // the ground floor's labels on the left, the first floor's on the right
    const xOf = async (name) => (await page.locator("homeslice-card .label button.name", { hasText: name }).boundingBox()).x;
    assert((await xOf("Kitchen")) < (await xOf("Bedroom")), "first floor labels not to the right");
    await shot(page, "demo-plan-all");
    assert(errors.length === 0, errors.join(" | "));
  });
});
