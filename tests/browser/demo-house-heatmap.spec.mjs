// demo house, heatmap
import { test } from "@playwright/test";
import { join } from "node:path";
import { act, assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, heatmap", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { heatmap: "temperature" }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("heatmap: cool rooms blue, comfortable rooms as they are", async () => {
    const tint = (k) => page.evaluate((k) => window.card.renderer.floors.get(k)?.material.userData.tint ?? null, k);
    assert((await tint("first/bedroom")) === "#6fb7e8", `bedroom (19.2 °C): ${await tint("first/bedroom")}`);
    assert((await tint("ground/living")) === null, `living room (21.4 °C): ${await tint("ground/living")}`);
    await shot(page, "demo-heatmap");
    assert(errors.length === 0, errors.join(" | "));
  });
  test("heatmap_style: smooth spreads the readings across each floor, no room tints", async () => {
    await act(page, () => page.evaluate(() => window.card.setConfig({ ...window.card.config, heatmap_style: "smooth" })));
    const r = await page.evaluate(() => ({ levels: window.card.renderer.heatFieldLevels, tint: window.card.renderer.floors.get("first/bedroom")?.material.userData.tint ?? null }));
    assert(r.levels.includes("first") && r.tint === null, JSON.stringify(r));
    await shot(page, "demo-heatmap-smooth");
    await act(page, () =>
      page.evaluate(() => {
        const { heatmap_style, ...config } = window.card.config;
        window.card.setConfig(config);
      }),
    );
    assert(!(await page.evaluate(() => window.card.renderer.heatFieldLevels.length)), "smooth field left behind");
    assert(errors.length === 0, errors.join(" | "));
  });
});
