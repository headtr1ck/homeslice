import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaEntities, areaLight, areaPopup, areaTemperature, coverOpen, type Hass } from "./hass";

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

  it("groups popup cards like HA's area views", () => {
    const sections = areaPopup(hass(), "living_room");
    expect(sections.map((s) => s.title)).toEqual(["lights", "covers", "climate", "media", "sensors"]);
    expect(sections[0].cards).toEqual([
      { type: "tile", entity: "light.living_room", features: [{ type: "light-brightness" }] },
      { type: "tile", entity: "light.reading_lamp", features: [{ type: "light-brightness" }] },
    ]);
  });
});
