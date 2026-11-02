// demo house, lux
import { test } from "@playwright/test";
import { join } from "node:path";
import { act, assert, browser, open, setBrowser, state } from "./helpers.mjs";

test.describe.serial("demo house, lux", () => {
  let withLux, page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    withLux = (f) => ({
      ...f,
      states: { ...f.states, "sensor.living_lux": { entity_id: "sensor.living_lux", state: "3", attributes: { device_class: "illuminance", unit_of_measurement: "lx" } } },
      entities: { ...f.entities, "sensor.living_lux": { entity_id: "sensor.living_lux", area_id: "living_room" } },
    });
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { lux: true }, undefined, withLux));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("lux: a dark room looks dark and shows its reading", async () => {
    const floor = () => page.evaluate(() => window.card.renderer.floors.get("ground/living").material.color.getHexString());
    const label = page.locator("homeslice-card .label", { has: page.locator("button.name", { hasText: "Living Room" }) });
    assert((await label.textContent()).includes("3 lx"), `label: ${await label.textContent()}`);
    const dark = await floor();
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "sensor.living_lux": { ...h.states["sensor.living_lux"], state: "800" } } };
      }),
    );
    const bright = await floor();
    assert(parseInt(bright.slice(0, 2), 16) > parseInt(dark.slice(0, 2), 16) + 40, `floor ${dark} → ${bright}`);
    assert(errors.length === 0, errors.join(" | "));
  });
});
