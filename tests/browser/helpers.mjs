// What the browser tests share: the card or editor opened on the harness page with a fixture
// house and a pretend Home Assistant, and small helpers. The harness is served by
// tests/browser/serve.mjs (playwright.config.mjs starts it); screenshots go to test-results/.
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

export const root = resolve(import.meta.dirname, "../..");
export const out = join(root, "test-results");
mkdirSync(out, { recursive: true });
export const base = process.env.BT_BASE ?? `http://127.0.0.1:${process.env.BT_PORT ?? 4317}`;

export const loadFixture = (file) => {
  const f = JSON.parse(readFileSync(join(root, file), "utf8"));
  f.model = parse(readFileSync(join(root, f.model), "utf8"));
  return f;
};

/** The worker's browser (each spec sets it in its beforeAll). */
export let browser = null;
export const setBrowser = (b) => (browser = b);

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function open(fixtureFile, config = {}, viewport = { width: 1632, height: 1000 }, edit = (fixture) => fixture) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  const fixture = edit(loadFixture(fixtureFile));
  await page.evaluate((m) => (window.__demoModel = m), fixture.model);
  await page.evaluate(([f, c]) => window.setup(f, c), [fixture, config]);
  // the first size measurement triggers one more redraw; let it pass before acting
  await page.waitForTimeout(250);
  return { page, errors };
}

export const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
export const calls = (page) => page.evaluate(() => window.card.hass.calls);
export const state = (page, id) => page.evaluate((id) => window.card.hass.states[id]?.state, id);
export const labelNames = (page) => page.locator("homeslice-card .label span.name").allTextContents();
export const triangles = (page) => page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
/** Resolves after the card's next redraw; start it before the action that triggers it. */
export const nextRender = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        window.card.addEventListener("homeslice-rendered", resolve, { once: true });
        setTimeout(() => reject(new Error("the card did not redraw within 10 s")), 10000);
      }),
  );
export async function act(page, action) {
  const rendered = nextRender(page);
  await action();
  await rendered;
  // a floor change animates: done when the card has arrived (on a busy machine that takes a while)
  await page.waitForFunction(() => !window.card?.transitioning, null, { timeout: 10000 });
}
export const lamp = (page, label) => page.locator(`homeslice-card button.lamp[aria-label$="lights in ${label}"]`);
