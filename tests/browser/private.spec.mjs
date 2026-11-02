// private
import { test } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, assert, browser, labelNames, open, root, setBrowser, shot } from "./helpers.mjs";

const privateDir = join(root, "dev/fixtures/private");
for (const file of existsSync(privateDir) ? readdirSync(privateDir).filter((f) => f.endsWith(".json")) : []) {
  test.describe.serial(`private: ${file}`, () => {
    let page, errors;
    test.beforeAll(async ({ browser: b }) => {
      setBrowser(b);
      ({ page, errors } = await open(`dev/fixtures/private/${file}`, { view: { azimuth: 250, elevation: 38, explode: 2.6 } }, { width: 1888, height: 1050 }));
    });
    test.afterAll(async () => {
      await page?.close();
    });

    test("renders with a label per room and no errors", async () => {
      const names = await labelNames(page);
      assert(names.length > 3, `only ${names.length} labels`);
      assert(errors.length === 0, errors.join(" | "));
      await shot(page, `private-${file.replace(".json", "")}`);
    });
    test("every floor can be focused", async () => {
      const buttons = page.locator("homeslice-card nav.levels button");
      const n = await buttons.count();
      for (let i = 0; i < n - 1; i++) {
        await act(page, () => buttons.nth(i).click());
        const name = (await buttons.nth(i).textContent()).trim();
        assert((await labelNames(page)).length > 0, `no labels on ${name}`);
        await shot(page, `private-${file.replace(".json", "")}-${name.toLowerCase().replace(/\s+/g, "-")}`);
        await act(page, () => buttons.nth(i).click());
      }
      assert(errors.length === 0, errors.join(" | "));
    });
  });
}
