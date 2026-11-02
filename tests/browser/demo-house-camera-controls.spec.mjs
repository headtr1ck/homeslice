// demo house, camera controls
import { test } from "@playwright/test";
import { parse } from "yaml";
import { join } from "node:path";
import { act, assert, browser, open, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("demo house, camera controls", () => {
  let page, errors, canvasBox, cx, cy, camera;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { interactive: true }));
    canvasBox = await page.locator("homeslice-card canvas").boundingBox();
    cx = canvasBox.x + canvasBox.width / 2;
    cy = canvasBox.y + canvasBox.height / 2;
    camera = () => page.evaluate(() => ({ ...window.card.renderer.orientation, zoom: window.card.renderer.zoom }));

  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("dragging turns the house, shows the angle and doesn't open a popup", async () => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 20, cy - i * 4);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const c = await camera();
    assert(Math.abs(c.azimuth - 180) < 1 && Math.abs(c.elevation - 28) < 1, `camera after drag ${JSON.stringify(c)}`);
    const readout = await page.locator("homeslice-card .readout").textContent();
    assert(readout === "180° · 28°", `readout: ${readout}`);
    assert((await page.locator("homeslice-card .popup").count()) === 0, "a popup opened after dragging");
    await shot(page, "demo-orbit");
  });

  test("the wheel zooms", async () => {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
    const c = await camera();
    assert(c.zoom > 1.4 && c.zoom < 1.8, `zoom after wheel ${c.zoom}`);
  });

  test("a trackpad's two-finger scroll moves the view, a pinch zooms", async () => {
    const before = await camera();
    await page.mouse.wheel(30, 12.5);
    await page.waitForTimeout(100);
    const pan = await page.evaluate(() => window.card.renderer.pan);
    assert(pan.x > 0 && pan.y < 0, `pan after a trackpad scroll ${JSON.stringify(pan)}`);
    assert((await camera()).zoom === before.zoom, "a trackpad scroll zoomed");
    // a pinch arrives as ctrl + wheel
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -20);
    await page.keyboard.up("Control");
    await page.waitForTimeout(100);
    assert((await camera()).zoom > before.zoom, "a pinch didn't zoom");
  });

  test("double-click goes back to the configured view", async () => {
    await act(page, () => page.mouse.dblclick(cx, cy));
    const c = await camera();
    assert(c.azimuth === 250 && c.elevation === 38 && c.zoom === 1, `camera after reset ${JSON.stringify(c)}`);
    const pan = await page.evaluate(() => window.card.renderer.pan);
    assert(pan.x === 0 && pan.y === 0, `pan after reset ${JSON.stringify(pan)}`);
    await page.waitForTimeout(400);
    assert((await page.locator("homeslice-card .popup").count()) === 0, "the double-click also opened a popup");
  });
  test("view buttons turn and tilt; a kept view is the start view on this device", async () => {
    const views = page.locator("homeslice-card .views button");
    assert((await views.count()) === 5, `view buttons: ${await views.count()}`);
    await views.nth(3).click(); // turn right
    await page.waitForFunction(() => Math.abs(window.card.renderer.orientation.azimuth - 340) < 0.5, null, { timeout: 5000 });
    await views.nth(1).click(); // from above
    await page.waitForFunction(() => Math.abs(window.card.renderer.orientation.elevation - 89) < 0.5, null, { timeout: 5000 });
    await views.nth(2).click(); // tilted
    await page.waitForFunction(() => Math.abs(window.card.renderer.orientation.elevation - 35) < 0.5, null, { timeout: 5000 });
    await views.nth(4).click(); // keep
    assert((await page.locator("homeslice-card .readout").textContent()).includes("Start view kept"), "no confirmation");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("homeslice-view:demo") ?? localStorage.getItem("homeslice-view:home") ?? "null"));
    assert(saved?.all?.azimuth === 340 && saved.all.elevation === 35, `saved: ${JSON.stringify(saved)}`);
    // reset goes to the kept view now, and so does a new card
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 5 });
    await page.mouse.up();
    await act(page, () => page.mouse.dblclick(cx, cy));
    const c = await camera();
    assert(c.azimuth === 340 && c.elevation === 35, `reset to the kept view: ${JSON.stringify(c)}`);
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("homeslice-view")).forEach((k) => localStorage.removeItem(k)));
    assert(errors.length === 0, errors.join(" | "));
  });
});

test.describe.serial("demo house, camera controls (2)", () => {
  let page;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page } = await open("dev/fixtures/demo-hass.json"));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("the camera is locked unless interactive is on", async () => {
    const b = await page.locator("homeslice-card canvas").boundingBox();
    await page.mouse.move(b.x + 400, b.y + 300);
    await page.mouse.down();
    await page.mouse.move(b.x + 600, b.y + 300, { steps: 5 });
    await page.mouse.up();
    const c = await page.evaluate(() => window.card.renderer.orientation);
    assert(c.azimuth === 250, `camera moved: ${JSON.stringify(c)}`);
  });
});
