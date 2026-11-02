// Browser tests (tests/browser): the built card and editor in headless Chromium against a
// pretend Home Assistant. `npm run test:browser` builds first. Tests in one file build on
// each other (serial); files run side by side (`--workers`), CI splits them (`--shard i/n`).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/** The Chromium Playwright installed (playwright-core's, as CI installs it). */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = join(process.env.HOME ?? "", ".cache/ms-playwright");
  const latest = existsSync(dir) && readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return latest ? join(dir, latest, "chrome-linux64/chrome") : undefined;
}

const port = Number(process.env.BT_PORT ?? 4317);

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "*.spec.mjs",
  // software rendering is heavy: one browser per core is plenty
  workers: process.env.CI ? 2 : "50%",
  fullyParallel: false,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results/playwright",
  use: {
    launchOptions: { executablePath: chromePath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    trace: "retain-on-failure",
  },
  webServer: { command: `node tests/browser/serve.mjs`, port, reuseExistingServer: true, env: { BT_PORT: String(port) } },
});
