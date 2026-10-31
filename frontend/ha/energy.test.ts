import { describe, expect, it } from "vitest";
import type { Energy } from "../model/types";
import { batterySoc, formatPower, readEnergy, type EnergyPrefs } from "./energy";
import type { Hass } from "./hass";

const hass = {
  states: {
    "sensor.pv1": { entity_id: "sensor.pv1", state: "1.5", attributes: { unit_of_measurement: "kW" } },
    "sensor.pv2": { entity_id: "sensor.pv2", state: "500", attributes: { unit_of_measurement: "W" } },
    "sensor.bat_power": { entity_id: "sensor.bat_power", state: "-800", attributes: { unit_of_measurement: "W" } },
    "sensor.bat_soc": { entity_id: "sensor.bat_soc", state: "64", attributes: { unit_of_measurement: "%", device_class: "battery" } },
    "sensor.bat_cut_off_soc": { entity_id: "sensor.bat_cut_off_soc", state: "5", attributes: { unit_of_measurement: "%", device_class: "battery" } },
    "sensor.grid": { entity_id: "sensor.grid", state: "300", attributes: { unit_of_measurement: "W" } },
    "sensor.hp": { entity_id: "sensor.hp", state: "1200", attributes: { unit_of_measurement: "W" } },
  },
  entities: {
    "sensor.bat_power": { entity_id: "sensor.bat_power", device_id: "bat" },
    "sensor.bat_cut_off_soc": { entity_id: "sensor.bat_cut_off_soc", device_id: "bat" },
    "sensor.bat_soc": { entity_id: "sensor.bat_soc", device_id: "bat" },
  },
} as unknown as Hass;

const prefs: EnergyPrefs = {
  energy_sources: [
    { type: "solar", stat_rate: "sensor.pv1" },
    { type: "solar", stat_rate: "sensor.pv2" },
    { type: "battery", stat_rate: "sensor.bat_power" },
    { type: "grid", power_config: { stat_rate: "sensor.grid" } },
  ],
  device_consumption: [{ name: "Heat pump", stat_rate: "sensor.hp", stat_consumption: "sensor.hp_energy" }],
};

const item = (kind: Energy["kind"], extra: Partial<Energy> = {}): Energy => ({ kind, id: kind, to: null, index: 0, levelIndex: 0, at: [0, 0], roof: "south", ...extra });

describe("energy readings", () => {
  it("reads solar, battery and grid from HA's energy settings", () => {
    expect(readEnergy(hass, item("solar"), prefs)).toEqual({ flow: 2000, power: 2000, soc: null });
    expect(readEnergy(hass, item("battery"), prefs)).toEqual({ flow: -800, power: -800, soc: 64 });
    expect(readEnergy(hass, item("grid"), prefs)).toEqual({ flow: 300, power: 300, soc: null });
  });
  it("devices draw power from the hub", () => {
    expect(readEnergy(hass, item("device", { power: "sensor.hp" }), prefs).flow).toBe(-1200);
  });
  it("finds the battery charge, not its limits", () => {
    expect(batterySoc(hass, "sensor.bat_power")).toBe("sensor.bat_soc");
  });
  it("formats power", () => {
    expect(formatPower(350.4)).toBe("350 W");
    expect(formatPower(1234)).toBe("1.2 kW");
    expect(formatPower(null)).toBe("–");
    expect(formatPower(1234, { language: "de" })).toBe("1,2 kW");
  });
});
