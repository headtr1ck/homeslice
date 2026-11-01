import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaEntities, areaLight, areaPopup, areaValues, areaSensors, areaTemperature, coverOpen, daylight, HEATMAP_STEPS, stepColor, type Hass } from "./hass";

const fixture = JSON.parse(readFileSync("dev/fixtures/demo-hass.json", "utf8"));
const hass = (): Hass => ({ ...fixture, callWS: async () => null, callService: async () => null });

describe("HA helpers", () => {
  it("finds area entities directly and through devices, skipping hidden and diagnostic ones", () => {
    const h = hass();
    expect(areaEntities(h, "kitchen", "light")).toEqual(["light.kitchen"]);
    expect(areaEntities(h, "living_room", "light")).toEqual(["light.living_room", "light.reading_lamp"]);
    expect(areaEntities(h, "bedroom", "sensor")).toEqual(["sensor.bedroom_temperature"]);
  });

  it("combines an area's lights", () => {
    const h = hass();
    expect(areaLight(h, "kitchen")).toBeNull();
    expect(areaLight(h, "living_room")).toEqual({ rgb: [255, 180, 110], brightness: 200 / 255 });
  });

  it("reads cover positions", () => {
    const h = hass();
    expect(coverOpen(h, "cover.kitchen")).toBe(0.5);
    expect(coverOpen(h, "cover.bedroom")).toBe(0);
    expect(coverOpen(h, "cover.missing")).toBeNull();
  });

  it("uses the area's temperature sensor, else the first one in the area", () => {
    const h = hass();
    expect(areaTemperature(h, "living_room")).toBe("21.4 °C");
    expect(areaTemperature(h, "bedroom")).toBe("19.2 °C");
    expect(areaTemperature(h, "hall")).toBeNull();
  });

  it("reads presence and alarms of an area", () => {
    const h = hass();
    expect(areaSensors(h, "kitchen")).toEqual({ presence: true, alerts: [] });
    expect(areaSensors(h, "kids_room")).toEqual({ presence: false, alerts: [] });
    h.states = { ...h.states, "binary_sensor.kids_room_leak": { ...h.states["binary_sensor.kids_room_leak"], state: "on" } };
    expect(areaSensors(h, "kids_room")).toEqual({ presence: false, alerts: ["moisture"] });
  });

  it("groups popup cards like HA's area views", () => {
    const sections = areaPopup(hass(), "living_room");
    expect(sections.map((s) => s.title)).toEqual(["lights", "covers", "climate", "media", "sensors"]);
    expect(sections[0].cards).toEqual([
      { type: "tile", entity: "light.living_room", features: [{ type: "light-brightness" }] },
      { type: "tile", entity: "light.reading_lamp", features: [{ type: "light-brightness" }] },
    ]);
  });
});

describe("room popup", () => {
  it("adds cameras, scenes and air quality, also for entities placed in the room but in no area", () => {
    const h = hass();
    h.states = {
      ...h.states,
      "camera.terrace": { entity_id: "camera.terrace", state: "idle", attributes: {} },
      "scene.movie": { entity_id: "scene.movie", state: "unknown", attributes: {} },
      "sensor.pm": { entity_id: "sensor.pm", state: "8", attributes: { device_class: "pm25" } },
      "sensor.energy": { entity_id: "sensor.energy", state: "8", attributes: { device_class: "energy" } },
    } as Hass["states"];
    const sections = areaPopup(h, undefined, ["camera.terrace", "scene.movie", "sensor.pm", "sensor.energy"]);
    expect(sections.map((s) => s.title)).toEqual(["cameras", "scenes", "sensors"]);
    expect(sections[0].cards[0]).toMatchObject({ type: "picture-entity", entity: "camera.terrace" });
    expect(sections[2].cards).toEqual([{ type: "tile", entity: "sensor.pm" }]);
  });
});

describe("room values", () => {
  it("writes readings with their units and colours the ones outside the comfortable range", () => {
    expect(areaValues(hass(), "living_room", ["temperature", "humidity", "carbon_dioxide", "pm25"])).toEqual([
      { kind: "temperature", text: "21.4 °C", color: null },
      { kind: "humidity", text: "48%", color: null },
      { kind: "carbon_dioxide", text: "1240 ppm", color: "#f0a33c" },
    ]);
  });

  it("takes the card's own steps", () => {
    const [co2] = areaValues(hass(), "living_room", ["carbon_dioxide"], { carbon_dioxide: [{ value: 1200, color: "red" }] });
    expect(co2.color).toBe("red");
  });
});

describe("inverted covers", () => {
  const hass = { states: { "cover.a": { entity_id: "cover.a", state: "open", attributes: { current_position: 70 } } } } as unknown as Hass;
  it("reads the position the other way round", () => {
    expect(coverOpen(hass, "cover.a")).toBeCloseTo(0.7);
    expect(coverOpen(hass, "cover.a", true)).toBeCloseTo(0.3);
  });
});

describe("daylight from lux", () => {
  it("is 0 in the dark, 1 from 300 lx, on a log scale", () => {
    expect(daylight(0)).toBe(0);
    expect(daylight(300)).toBeCloseTo(1);
    expect(daylight(5000)).toBe(1);
    expect(daylight(17)).toBeCloseTo(0.5, 1);
  });
});

describe("heatmap steps", () => {
  it("colours cold, comfortable and hot rooms", () => {
    expect(stepColor(15, HEATMAP_STEPS.temperature)).toBe("#3d7be0");
    expect(stepColor(21, HEATMAP_STEPS.temperature)).toBeNull();
    expect(stepColor(25, HEATMAP_STEPS.temperature)).toBe("#f0a33c");
    expect(stepColor(1600, HEATMAP_STEPS.carbon_dioxide)).toBe("#e8483c");
  });
});
