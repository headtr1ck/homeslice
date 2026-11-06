// editor, guided tour
import { test } from "@playwright/test";
import { assert, base, browser, loadFixture, setBrowser, shot } from "./helpers.mjs";

test.describe.serial("editor, guided tour", () => {
  let page;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    // ?tour: as someone who has never seen it
    await page.goto(`${base}/dev/harness.html?tour`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate((f) => window.setupPanel(f), loadFixture("dev/fixtures/demo-hass.json"));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  const step = () => page.locator("homeslice-panel .tour").getAttribute("data-tour");
  const plan = async ([x, y]) =>
    page.evaluate(([x, y]) => {
      const [sx, sy] = window.panel.toScreen([x, y]);
      const r = window.panel.renderRoot.querySelector("svg.plan").getBoundingClientRect();
      return { x: r.left + sx, y: r.top + sy };
    }, [x, y]);

  test("offered once to someone new; each step ends when it is done", async () => {
    await page.locator("homeslice-panel .tour[data-tour=offer]").waitFor();
    await shot(page, "editor-tour-offer");
    await page.locator("homeslice-panel [data-tour-start]").click();
    assert((await step()) === "floors", `step: ${await step()}`);
    assert((await page.locator("homeslice-panel aside.levels.tour-target").count()) === 1, "the floors don't glow");
    await page.locator("homeslice-panel aside.levels button.level", { hasText: "First Floor" }).click();
    await page.waitForFunction(() => window.panel.renderRoot.querySelector(".tour")?.dataset.tour === "room");
    // a room drawn into the bedroom (it takes its space)
    await page.keyboard.press("r");
    const a = await plan([1, 1]);
    const b = await plan([3, 3]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => window.panel.renderRoot.querySelector(".tour")?.dataset.tour === "reshape");
    await shot(page, "editor-tour-step");
    // Next skips a step; End closes it for good
    await page.locator("homeslice-panel [data-tour-next]").click();
    assert((await step()) === "opening", `step: ${await step()}`);
    await page.locator("homeslice-panel [data-tour-skip]").click();
    assert((await page.locator("homeslice-panel .tour").count()) === 0, "still shown");
    assert((await page.evaluate(() => localStorage.getItem("homeslice-tour"))) === "done", "not remembered");
  });

  test("restarted from the keys overlay, which shows the gestures as clips", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("?");
    const clips = page.locator("homeslice-panel .shortcuts .clips img");
    assert((await clips.count()) === 6, `clips: ${await clips.count()}`);
    await page.waitForFunction(() => [...window.panel.shadowRoot.querySelectorAll(".shortcuts .clips img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
    await page.locator("homeslice-panel [data-tour-restart]").click();
    assert((await step()) === "floors", `step: ${await step()}`);
    await page.locator("homeslice-panel [data-tour-skip]").click();
  });
});
