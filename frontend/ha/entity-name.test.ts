import { describe, expect, it } from "vitest";
import { entityName, type HassEntityState } from "./hass";

const lamp: HassEntityState = { entity_id: "light.lamp", state: "on", attributes: { friendly_name: "Living room Lamp" } };

describe("an entity's name", () => {
  it("is Home Assistant's own when it formats names", () => {
    expect(entityName({ formatEntityName: (s) => `Formatted ${s.entity_id}` }, lamp)).toBe("Formatted light.lamp");
  });
  it("falls back to friendly_name on an older Home Assistant, or when the formatter fails", () => {
    expect(entityName({}, lamp)).toBe("Living room Lamp");
    expect(entityName({ formatEntityName: () => { throw new Error("no registry yet"); } }, lamp)).toBe("Living room Lamp");
    expect(entityName({ formatEntityName: () => "" }, lamp)).toBe("Living room Lamp");
  });
  it("is undefined without a state or a name, so callers can use the entity id", () => {
    expect(entityName({}, undefined)).toBeUndefined();
    expect(entityName({}, { entity_id: "light.x", state: "on", attributes: {} })).toBeUndefined();
  });
});
