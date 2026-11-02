// demo house, energy
import { test } from "@playwright/test";
import { join } from "node:path";
import { act, assert, browser, open, setBrowser, shot, state } from "./helpers.mjs";

test.describe.serial("demo house, energy", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { energy: true }, undefined, (f) => {
      f.model.energy = [
        { kind: "solar" },
        { kind: "battery", level: "ground", at: [1, 1] },
        { kind: "grid", level: "ground", at: [2, 1] },
        { kind: "device", power: "sensor.heat_pump_power", level: "ground", at: [6, 8], details: ["sensor.heat_pump_cop", { entity: "sensor.hot_water", name: "Hot water" }] },
      ];
      f.energy_prefs = {
        energy_sources: [
          { type: "solar", stat_rate: "sensor.pv_power" },
          { type: "battery", stat_rate: "sensor.battery_power" },
          { type: "grid", stat_rate: "sensor.grid_power" },
        ],
        device_consumption: [],
      };
      const st = (id, state, unit, extra = {}) => (f.states[id] = { entity_id: id, state, attributes: { unit_of_measurement: unit, ...extra } });
      st("sensor.pv_power", "2.4", "kW");
      st("sensor.battery_power", "-900", "W");
      st("sensor.battery_soc", "64", "%", { device_class: "battery" });
      st("sensor.grid_power", "-300", "W");
      st("sensor.heat_pump_power", "1200", "W", { friendly_name: "Heat pump" });
      st("sensor.heat_pump_cop", "3.8", "", { friendly_name: "Heat pump COP" });
      st("sensor.hot_water", "48.5", "°C", { friendly_name: "Domestic hot water temperature" });
      f.entities["sensor.battery_power"] = { entity_id: "sensor.battery_power", device_id: "battery" };
      f.entities["sensor.battery_soc"] = { entity_id: "sensor.battery_soc", device_id: "battery" };
      return f;
    }));
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("energy overlay: panels on the roof, labels with power, flows to the battery", async () => {
    await page.waitForFunction(() => window.card.renderer.energyState().flows.some((f) => f.watts !== 0));
    const state = await page.evaluate(() => window.card.renderer.energyState());
    // no inverter: every line goes to the battery
    assert(state.flows.length === 3 && state.flows.every((f) => f.to === "energy-1"), `energy: ${JSON.stringify(state)}`);
    const w = Object.fromEntries(state.flows.map((f) => [f.key, f.watts]));
    assert(w["energy-0"] === 2400 && w["energy-2"] === -300 && w["energy-3"] === -1200, `flows: ${JSON.stringify(w)}`);
    assert(state.flows.every((f) => f.visible && f.dots), "flows not drawn");
    assert(await page.evaluate(() => window.card.renderer.roofVisible()), "the overlay should show the roof");
    const labels = await page.locator("homeslice-card .energy-label").allTextContents();
    const text = labels.map((l) => l.replace(/\s+/g, " ").trim()).join(" | ");
    assert(text.includes("2.4 kW") && text.includes("64 %") && text.includes("Heat pump") && text.includes("1.2 kW"), `labels: ${text}`);
    // more readings after the power, the device's name taken off the sensor's
    assert(text.includes("1.2 kW · COP 3.8 · Hot water 48.5 °C"), `heat pump details: ${text}`);
    // the whole house: callouts beside it with leader lines, not stacked over the floors
    const places = await page.locator("homeslice-card .energy-label").evaluateAll((els) => els.map((e) => e.classList.contains("left") || e.classList.contains("right")));
    assert(places.length && places.every(Boolean), "labels are not callouts in the overview");
    assert((await page.locator("homeslice-card svg.leaders line").count()) === places.length, "no leader lines");
    const boxes = await page.locator("homeslice-card .energy-label").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `labels ${i} and ${j} overlap`);
      }
    await page.waitForTimeout(200);
    await shot(page, "demo-energy");
    // a floor picked: only its items; no roof, no solar
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const focused = await page.locator("homeslice-card .energy-label").count();
    assert(focused === 3, `labels on the ground floor: ${focused}`);
    assert((await page.locator("homeslice-card .energy-label.above").count()) === 3, "labels on a picked floor should sit at their markers");
    assert(errors.length === 0, errors.join(" | "));
  });
});
