// demo house, per-level camera
import { test } from "@playwright/test";
import { join } from "node:path";
import { act, assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, per-level camera", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", {
      view: { focus: { azimuth: 160, elevation: 70 }, levels: { first: { azimuth: 200, elevation: 90, projection: "isometric" } } },
    }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("uses the per-level camera, else the view's focus camera", async () => {
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
});
