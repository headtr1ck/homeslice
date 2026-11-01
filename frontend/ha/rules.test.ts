import { describe, expect, it } from "vitest";
import type { Hass } from "./hass";
import { ruleMatches, ruleText } from "./rules";

const hass = {
  locale: { language: "de" },
  states: {
    "binary_sensor.doorbell": { entity_id: "binary_sensor.doorbell", state: "on", attributes: { friendly_name: "Doorbell" } },
    "sensor.attic": { entity_id: "sensor.attic", state: "27.456", attributes: { unit_of_measurement: "°C", friendly_name: "Attic" } },
    "light.desk": { entity_id: "light.desk", state: "on", attributes: { brightness: 128 } },
    "sensor.gone": { entity_id: "sensor.gone", state: "unavailable", attributes: {} },
  },
} as unknown as Hass;

describe("state rules", () => {
  it("match states, numbers and attributes", () => {
    expect(ruleMatches(hass, { entity: "binary_sensor.doorbell", state: "on" })).toBe(true);
    expect(ruleMatches(hass, { entity: "binary_sensor.doorbell", state: ["off", "idle"] })).toBe(false);
    expect(ruleMatches(hass, { entity: "sensor.attic", above: 26 })).toBe(true);
    expect(ruleMatches(hass, { entity: "sensor.attic", above: 20, below: 25 })).toBe(false);
    expect(ruleMatches(hass, { entity: "light.desk", attribute: "brightness", below: 200 })).toBe(true);
    // no condition: any state but unavailable
    expect(ruleMatches(hass, { entity: "sensor.attic" })).toBe(true);
    expect(ruleMatches(hass, { entity: "sensor.gone" })).toBe(false);
    expect(ruleMatches(hass, { entity: "sensor.missing" })).toBe(false);
  });

  it("fill text templates with rounding in the HA language", () => {
    expect(ruleText(hass, { entity: "sensor.attic", text: "{name}: {state:1} {unit}" })).toBe("Attic: 27,5 °C");
    expect(ruleText(hass, { entity: "light.desk", text: "{attr:brightness:0}" })).toBe("128");
    expect(ruleText(hass, { entity: "binary_sensor.doorbell", text: "{state}" })).toBe("on");
  });
});
