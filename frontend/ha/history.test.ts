import { describe, expect, it } from "vitest";
import type { Hass } from "./hass";
import { fromRaw, statesAt } from "./history";

const hass = { states: { "light.a": { entity_id: "light.a", state: "off", attributes: { friendly_name: "A" } }, "sensor.t": { entity_id: "sensor.t", state: "21", attributes: {} } } } as unknown as Hass;

describe("time travel", () => {
  const h = fromRaw(
    {
      "light.a": [
        { s: "off", a: { friendly_name: "A" }, lu: 1000 },
        { s: "on", a: { friendly_name: "A", brightness: 200 }, lu: 2000 },
        { s: "off", lu: 3000 },
      ],
      "binary_sensor.door": [{ s: "off", a: {}, lu: 1500 }, { s: "on", lu: 2500 }],
    },
    1000_000,
    4000_000,
  );

  it("knows each entity's state at a moment, attributes carried along", () => {
    expect(statesAt(hass, h, 2_200_000)["light.a"]).toMatchObject({ state: "on", attributes: { brightness: 200 } });
    expect(statesAt(hass, h, 3_500_000)["light.a"].state).toBe("off");
    // before its first change: as it is now
    expect(statesAt(hass, h, 500_000)["light.a"].state).toBe("off");
    expect(statesAt(hass, h, 2_200_000)["sensor.t"].state).toBe("21");
  });

  it("lists the moments things changed", () => {
    expect(h.events.map((e) => [e.entity, e.state])).toEqual([
      ["light.a", "on"],
      ["binary_sensor.door", "on"],
      ["light.a", "off"],
    ]);
  });
});
