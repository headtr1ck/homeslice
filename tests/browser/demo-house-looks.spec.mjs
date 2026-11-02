// demo house, looks
import { test } from "@playwright/test";
import { join } from "node:path";
import { act, assert, browser, open, setBrowser, shot, state } from "./helpers.mjs";

test.describe.serial("demo house, looks", () => {
  let sunSet, page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    // auto: night once the sun is down
    sunSet = (f) => ({ ...f, states: { ...f.states, "sun.sun": { entity_id: "sun.sun", state: "below_horizon", attributes: { azimuth: 300, elevation: -12 } } } });
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { look: "auto" }, undefined, sunSet));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("look auto: the night look after sunset, glowing outlines in the accent colour", async () => {
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
});
