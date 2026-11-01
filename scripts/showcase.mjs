// Pictures of the demo house for the README (docs/images/) and for looking at the
// rendering while working on it: the 3D card by day and at night, one floor, the 2D plan
// and the editor. Run `npm run build` first; `node scripts/showcase.mjs [out-dir]`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { base, browser, fixture, icons, root, server, showcase } from "./demo-house.mjs";

const out = process.argv[2] ?? join(root, "docs/images");
mkdirSync(out, { recursive: true });

async function card(name, config, { night = false, focus = null, viewport = { width: 1400, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.addInitScript((i) => (window.__icons = i), icons);
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  const f = showcase(fixture());
  if (night) f.states["sun.sun"] = { entity_id: "sun.sun", state: "below_horizon", attributes: { azimuth: 300, elevation: -20 } };
  await page.evaluate((m) => (window.__demoModel = m), f.model);
  await page.evaluate(([fx, c]) => window.setup(fx, c), [f, config]);
  await page.waitForTimeout(400);
  await page.evaluate(() => window.card.renderer.modelsReady());
  if (focus) await page.locator("homeslice-card nav.levels button", { hasText: focus }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${name}.jpg`), type: "jpeg", quality: 85 });
  await page.close();
}

await card("card-3d", { view: { azimuth: 200, elevation: 40, furniture: "detailed" } });
await card("card-3d-night", { view: { azimuth: 200, elevation: 40, furniture: "detailed" } }, { night: true });
await card("card-floor", { view: { azimuth: 200, elevation: 50, furniture: "detailed" } }, { focus: "Ground Floor" });
await card("card-floor-night", { view: { azimuth: 200, elevation: 50, furniture: "detailed" } }, { night: true, focus: "Ground Floor" });
await card("card-plan", { mode: "plan" });
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("editor error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("editor console:", m.text()));
  await page.addInitScript((i) => (window.__icons = i), icons);
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate((f) => window.setupPanel(f), showcase(fixture()));
  await page.waitForTimeout(800);
  await page.locator("homeslice-panel .hint-bar .close").click().catch(() => {});
  await page.evaluate(() => {
    window.panel._room = "living";
    window.panel.requestUpdate();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "editor.jpg"), type: "jpeg", quality: 85 });
  await page.close();
}
await browser.close();
server.close();
console.log(`pictures in ${out}`);
