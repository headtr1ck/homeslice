// demo house, outdoor areas hidden
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, labelNames, open, out, setBrowser } from "./helpers.mjs";

test.describe.serial("demo house, outdoor areas hidden", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { view: { show_outdoor: false } }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("show_outdoor: false leaves out gardens and their labels", async () => {
    const names = await labelNames(page);
    assert(!names.includes("Garden") && names.includes("Living Room"), `labels: ${names.join(", ")}`);
    assert(errors.length === 0, errors.join(" | "));
  });
});
