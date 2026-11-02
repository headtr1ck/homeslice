// demo house, phone
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, phone", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", {}, { width: 390, height: 800 }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("on a phone the popup is a bottom sheet that closes when swiped down", async () => {
    await shot(page, "phone-card");
    await page.locator("homeslice-card .label button.name", { hasText: "Kitchen" }).click();
    await page.waitForSelector("homeslice-card .popup .fake-card");
    await page.waitForTimeout(300);
    const box = await page.locator("homeslice-card .popup").boundingBox();
    assert(Math.abs(box.y + box.height - 800) < 2 && box.width === 390, `sheet at ${JSON.stringify(box)}`);
    await shot(page, "phone-sheet");
    const grab = await page.locator("homeslice-card .popup .grabber").boundingBox();
    await page.mouse.move(grab.x + 100, grab.y + 10);
    await page.mouse.down();
    await page.mouse.move(grab.x + 100, grab.y + 60, { steps: 4 });
    await page.mouse.up();
    assert(await page.locator("homeslice-card .popup").count(), "a small pull closed the sheet");
    await page.mouse.move(grab.x + 100, grab.y + 10);
    await page.mouse.down();
    await page.mouse.move(grab.x + 100, grab.y + 200, { steps: 6 });
    await page.mouse.up();
    assert(!(await page.locator("homeslice-card .popup").count()), "swiping down didn't close the sheet");
    assert(errors.length === 0, errors.join(" | "));
  });
});
