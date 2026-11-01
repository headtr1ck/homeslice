import { describe, expect, it } from "vitest";
import { activation } from "./follow";

describe("following events", () => {
  it("fires when something becomes active, once", () => {
    expect(activation("binary_sensor.door", "off", "on")).toBe(true);
    expect(activation("binary_sensor.door", "on", "on")).toBe(false);
    expect(activation("binary_sensor.door", undefined, "on")).toBe(false); // the first look is no event
    expect(activation("lock.front", "locked", "unlocked")).toBe(true);
    expect(activation("sensor.washer", "running", "unavailable")).toBe(false);
  });
  it("fires on every press of an event entity", () => {
    expect(activation("event.doorbell", "2026-11-01T10:00:00Z", "2026-11-01T10:05:00Z")).toBe(true);
    expect(activation("event.doorbell", "2026-11-01T10:05:00Z", "2026-11-01T10:05:00Z")).toBe(false);
  });
});
