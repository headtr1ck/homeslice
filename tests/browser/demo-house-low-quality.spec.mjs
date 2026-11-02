// demo house, low quality
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, low quality", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { quality: "low" }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("quality low: no shadows, plain colours, simple furniture", async () => {
    const r = await page.evaluate(() => {
      const card = window.card;
      let textured = 0;
      let detailed = 0;
      card.renderer.object.traverse((o) => {
        if (o.userData.detailed) detailed++;
        if (o.isMesh) for (const m of [o.material].flat()) if (m.map && m.type === "MeshLambertMaterial") textured++;
      });
      return { quality: card.renderer.quality, shadows: card.renderer.renderer.shadowMap.enabled, lights: card.renderer.lightPool.length, textured, detailed, ratio: card.renderer.renderer.getPixelRatio() };
    });
    assert(r.quality === "low" && !r.shadows && r.lights === 2 && r.textured === 0 && r.detailed === 0 && r.ratio === 1, JSON.stringify(r));
    await shot(page, "demo-quality-low");
    assert(errors.length === 0, errors.join(" | "));
  });
});
