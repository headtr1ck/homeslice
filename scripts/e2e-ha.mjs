#!/usr/bin/env node
// End-to-end check against a real Home Assistant: opens a dashboard with the card in
// headless Chromium, focuses each floor, opens a room popup with HA's real cards, and
// saves screenshots to test-results/e2e-*.png. Read-only: it never presses a lamp.
//
// HOMESLICE_HA_HTTP=http://host:8123 HOMESLICE_DASHBOARD=/dashboard-x/house \
//   HOMESLICE_ROOM="Living Room" node scripts/e2e-ha.mjs
// The token comes from HOMESLICE_HA_TOKEN or ~/.ha_token.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const base = process.env.HOMESLICE_HA_HTTP;
const dashboard = process.env.HOMESLICE_DASHBOARD;
const room = process.env.HOMESLICE_ROOM ?? "Living Room";
if (!base || !dashboard) {
  console.error("set HOMESLICE_HA_HTTP and HOMESLICE_DASHBOARD");
  process.exit(2);
}
const token = process.env.HOMESLICE_HA_TOKEN ?? readFileSync(join(homedir(), ".ha_token"), "utf8").trim();
const out = resolve(import.meta.dirname, "../test-results");
mkdirSync(out, { recursive: true });

const dir = join(homedir(), ".cache/ms-playwright");
const chrome = process.env.CHROME_PATH ?? join(dir, readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop(), "chrome-linux64/chrome");
const browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`${e.message} @ ${(e.stack ?? "").split("\n").slice(1, 3).join(" ").trim()}`));
page.on("console", (m) => m.type() === "error" && /homeslice/i.test(m.text()) && errors.push(m.text()));

// log in the way the HA frontend stores its tokens
await page.addInitScript(([url, token]) => {
  localStorage.setItem("hassTokens", JSON.stringify({
    access_token: token, token_type: "Bearer", expires_in: 1e9, hassUrl: url, clientId: `${url}/`, expires: Date.now() + 1e12, refresh_token: "",
  }));
}, [base, token]);

const shot = (name) => page.screenshot({ path: join(out, `e2e-${name}.png`) });
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}${errors.length ? ` (${errors.length} page errors so far)` : ""}`);
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message.split("\n")[0]}`);
    process.exitCode = 1;
  }
};

await step("dashboard renders the house with labels", async () => {
  await page.goto(`${base}${dashboard}`);
  await page.waitForSelector("homeslice-card >> .label button.name", { timeout: 30000 });
  await page.waitForTimeout(1000);
  await shot("overview");
});

await step(`popup for "${room}" contains HA's own cards`, async () => {
  await page.locator("homeslice-card .label button.name", { hasText: room }).first().click();
  await page.waitForSelector("homeslice-card .popup hui-tile-card, homeslice-card .popup hui-thermostat-card", { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot("popup");
  await page.keyboard.press("Escape");
});

await step("every floor can be focused", async () => {
  const buttons = page.locator("homeslice-card nav.levels button");
  const n = await buttons.count();
  for (let i = 0; i < n - 1; i++) {
    const name = (await buttons.nth(i).textContent()).trim();
    await buttons.nth(i).click();
    await page.waitForTimeout(900);
    await shot(`floor-${name.toLowerCase().replace(/\s+/g, "-")}`);
  }
  await buttons.nth(n - 1).click();
});

await step("the editor opens the house (read-only check, nothing is saved)", async () => {
  await page.goto(`${base}/homeslice`);
  await page.waitForSelector("homeslice-panel >> svg.plan .room", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("editor");
  const names = await page.locator("homeslice-panel svg.plan text.room-name").allTextContents();
  if (names.length < 3) throw new Error(`only ${names.length} rooms in the editor`);
  await page.locator("homeslice-panel nav.levels button").first().click();
  await page.waitForTimeout(800);
  await shot("editor-top-level");
});

await step("no Homeslice errors in the console", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});
await browser.close();
