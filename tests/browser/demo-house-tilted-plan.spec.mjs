// demo house, tilted plan
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, tilted plan", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { mode: "tilted" }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("tilted plan: one floor at an angle, walls cut low", async () => {
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
});
