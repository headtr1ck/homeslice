import { describe, expect, it } from "vitest";
import type { Hass } from "./hass";
import { pieceBadge } from "./household";

const hass = (states: Record<string, { state: string; attributes?: Record<string, unknown> }>) =>
  ({ states: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, { entity_id: id, attributes: {}, ...s }])) }) as unknown as Hass;

describe("piece notes", () => {
  it("bins: pickup today (urgent) and tomorrow, nothing later", () => {
    const h = hass({
      "sensor.bio": { state: "0", attributes: { unit_of_measurement: "d", device_class: "duration" } },
      "sensor.paper": { state: "1", attributes: { unit_of_measurement: "d" } },
      "sensor.rest": { state: "Rest", attributes: { daysTo: 6 } },
    });
    expect(pieceBadge(h, "sensor.bio")).toMatchObject({ key: "pickup_today", urgent: true });
    expect(pieceBadge(h, "sensor.paper")).toMatchObject({ key: "pickup_tomorrow", urgent: false });
    expect(pieceBadge(h, "sensor.rest")).toBeNull();
  });

  it("plants: what is off, thirsty is urgent", () => {
    const h = hass({
      "plant.a": { state: "problem", attributes: { moisture_status: "Low", temperature_status: "ok" } },
      "plant.b": { state: "problem", attributes: { moisture_status: "High" } },
      "plant.c": { state: "ok", attributes: { moisture_status: "ok" } },
    });
    expect(pieceBadge(h, "plant.a")).toMatchObject({ icon: "mdi:water-alert", vars: { what: "moisture low" }, urgent: true });
    expect(pieceBadge(h, "plant.b")).toMatchObject({ vars: { what: "moisture high" }, urgent: false });
    expect(pieceBadge(h, "plant.c")).toBeNull();
  });

  it("appliances: time left; mailboxes: post", () => {
    const h = hass({
      "sensor.washer_left": { state: "75", attributes: { unit_of_measurement: "min", device_class: "duration" } },
      "sensor.dryer_left": { state: "0", attributes: { unit_of_measurement: "min", device_class: "duration" } },
      "binary_sensor.mailbox": { state: "on" },
      "binary_sensor.door": { state: "on" },
    });
    expect(pieceBadge(h, "sensor.washer_left")).toMatchObject({ key: "time_left", vars: { time: "1 h 15 min" } });
    expect(pieceBadge(h, "sensor.dryer_left")).toBeNull();
    expect(pieceBadge(h, "binary_sensor.mailbox", ["mailbox"])).toMatchObject({ key: "post" });
    expect(pieceBadge(h, "binary_sensor.door", [])).toBeNull();
  });
});
