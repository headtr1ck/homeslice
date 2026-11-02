// demo house, white model and blueprint
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, open, setBrowser, shot, state } from "./helpers.mjs";

for (const look of ["white", "blueprint"]) {
  test.describe.serial(`demo house, white model and blueprint: ${look}`, () => {
    let page, errors;
    test.beforeAll(async ({ browser: b }) => {
      setBrowser(b);
      ({ page, errors } = await open("dev/fixtures/demo-hass.json", { look }));
    });
    test.afterAll(async () => {
      await page?.close();
    });

    test(`look ${look}: every surface in the look's colour, textures off`, async () => {
      await page.evaluate(() => window.card.renderer.modelsReady());
      await page.waitForTimeout(300);
      const colours = await page.evaluate(() => {
        const found = new Set();
        let textured = 0;
        window.card.renderer.object.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of [o.material].flat()) {
            if (m.type !== "MeshLambertMaterial") continue;
            found.add(m.color.getHexString());
            if (m.map) textured++;
          }
        });
        return { colours: [...found], textured };
      });
      // the look's colours (plus state colours: blind strips, robots), no textures
      assert(colours.textured === 0, `textured materials: ${colours.textured}`);
      assert(colours.colours.includes(look === "white" ? "f1f0ec" : "2f5c9e") && colours.colours.length <= 8, `colours: ${colours.colours.join(",")}`);
      await shot(page, `demo-look-${look}`);
      assert(errors.length === 0, errors.join(" | "));
    });
  });
}
