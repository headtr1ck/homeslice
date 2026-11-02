// demo house, German
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, open, setBrowser } from "./helpers.mjs";

test.describe.serial("demo house, German", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", {}, undefined, (f) => ({ ...f, language: "de" })));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("in German: the card speaks the user's language", async () => {
    const buttons = await page.locator("homeslice-card nav.levels button").allTextContents();
    assert(buttons.some((b) => b.includes("Alle Etagen")), `floor buttons: ${buttons}`);
    assert(errors.length === 0, errors.join(" | "));
  });
});
