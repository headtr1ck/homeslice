// demo house, following events
import { test } from "@playwright/test";
import { join } from "node:path";
import { assert, browser, open, setBrowser, shot, state } from "./helpers.mjs";

test.describe.serial("demo house, following events", () => {
  let page, errors, setMotion;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { follow: ["binary_sensor.kitchen_motion"], follow_seconds: 1.5 }));
    setMotion = (state) =>
      page.evaluate((state) => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "binary_sensor.kitchen_motion": { ...h.states["binary_sensor.kitchen_motion"], state } } };
      }, state);
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("follow: the card turns to where something happens, says what, and goes back", async () => {
    await setMotion("off");
    await page.waitForTimeout(200);
    assert((await page.evaluate(() => window.card._level)) === null, "moved without an event");
    await setMotion("on");
    await page.waitForFunction(() => window.card._level === "ground", null, { timeout: 5000 });
    const note = await page.locator("homeslice-card .event").textContent();
    assert(note.includes("Kitchen"), `note: ${note}`);
    await shot(page, "demo-follow");
    await page.waitForFunction(() => window.card._level === null && !window.card._event, null, { timeout: 8000 });
    // someone using the card: it stays put
    const box = await page.locator("homeslice-card canvas").boundingBox();
    await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10);
    await setMotion("off");
    await setMotion("on");
    await page.waitForTimeout(800);
    assert((await page.evaluate(() => window.card._level)) === null, "moved while someone used the card");
    assert(errors.length === 0, errors.join(" | "));
  });
});
