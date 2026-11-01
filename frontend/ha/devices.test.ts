import { describe, expect, it } from "vitest";
import { deviceLook, linkDomain } from "./devices";
import type { Hass } from "./hass";

const hass = (states: Record<string, [string, Record<string, unknown>?]>) =>
  ({ states: Object.fromEntries(Object.entries(states).map(([id, [state, attributes]]) => [id, { entity_id: id, state, attributes: attributes ?? {} }])) }) as unknown as Hass;

describe("linked devices", () => {
  it("reads TVs, fans and covers", () => {
    const h = hass({ "media_player.tv": ["playing"], "media_player.off": ["standby"], "fan.f": ["on", { percentage: 50 }], "cover.c": ["open", { current_position: 30 }] });
    expect(deviceLook(h, "media_player.tv")).toEqual({ on: true, active: true, picture: null });
    expect(deviceLook(h, "media_player.off")).toEqual({ on: false, active: false, picture: null });
    expect(deviceLook(h, "fan.f")).toEqual({ on: true, active: true, speed: 0.5 });
    expect(deviceLook(h, "cover.c")).toMatchObject({ open: 0.3 });
    expect(deviceLook(h, "cover.c", true)?.open).toBeCloseTo(0.7);
    expect(deviceLook(h, "light.missing")).toBeNull();
  });
  it("reads climate's action as heating or cooling", () => {
    const h = hass({ "climate.a": ["cool", { hvac_action: "cooling" }], "climate.b": ["heat", { hvac_action: "idle" }], "climate.c": ["off"] });
    expect(deviceLook(h, "climate.a")).toEqual({ on: true, active: true, tone: "cool" });
    expect(deviceLook(h, "climate.b")).toEqual({ on: true, active: false, tone: null });
    expect(deviceLook(h, "climate.c")?.on).toBe(false);
  });
  it("reads power sensors and appliance states", () => {
    const h = hass({ "sensor.w": ["412.5"], "sensor.idle": ["0.4"], "sensor.state": ["running"], "sensor.done": ["finished"], "switch.fire": ["on"] });
    expect(deviceLook(h, "sensor.w")).toEqual({ on: true, active: true });
    expect(deviceLook(h, "sensor.idle")?.active).toBe(false);
    expect(deviceLook(h, "sensor.state")?.active).toBe(true);
    expect(deviceLook(h, "sensor.done")?.active).toBe(false);
    expect(deviceLook(h, "switch.fire")?.on).toBe(true);
  });
  it("lights alarms red", () => {
    const h = hass({ "binary_sensor.smoke": ["on", { device_class: "smoke" }], "binary_sensor.motion": ["on", { device_class: "motion" }], "binary_sensor.leak": ["off", { device_class: "moisture" }] });
    expect(deviceLook(h, "binary_sensor.smoke")).toEqual({ on: true, active: true, tone: "alarm" });
    expect(deviceLook(h, "binary_sensor.motion")?.tone).toBeNull();
    expect(deviceLook(h, "binary_sensor.leak")).toEqual({ on: false, active: false, tone: null });
    expect(linkDomain("item", "smoke_detector")).toBe("binary_sensor");
  });
  it("suggests what to link", () => {
    expect(linkDomain("table_lamp", "lamp_table_globe")).toBe("light");
    expect(linkDomain("item", "ac_split")).toBe("climate");
    expect(linkDomain("item", "heat_pump")).toBe("climate");
    expect(linkDomain("item", "curtains")).toBe("cover");
    expect(linkDomain("item", "fireplace_glass")).toBe("switch");
    expect(linkDomain("washer", "washer")).toBe("sensor");
    expect(linkDomain("ceiling_fan", "ceiling_fan")).toBe("fan");
    expect(linkDomain("item", "vase")).toBeUndefined();
    // by their tags: a car to its tracker, a bin to its pickup sensor, a plant to its plant
    expect(linkDomain("car", "car_estate")).toBe("device_tracker");
    expect(linkDomain("item", "wheelie_bin")).toBe("sensor");
    expect(linkDomain("item", "monstera")).toBe("plant");
    expect(linkDomain("item", "mailbox_post")).toBe("binary_sensor");
  });
});
