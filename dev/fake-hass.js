// A small stand-in for Home Assistant's frontend `hass` object, used by the browser
// tests. It answers the model websocket call, records service calls and applies them to
// the states like HA would (area targets, toggles, cover positions).

export function makeHass(fixture, onChange) {
  const calls = [];
  const subscribers = new Set();
  let states = structuredClone(fixture.states);

  const entityArea = (id) => {
    const e = fixture.entities[id];
    if (!e) return null;
    return e.area_id ?? (e.device_id ? fixture.devices[e.device_id]?.area_id : null) ?? null;
  };
  const targets = (domain, data, target) => {
    const ids = [target?.entity_id ?? data?.entity_id ?? []].flat();
    const areas = [target?.area_id ?? data?.area_id ?? []].flat();
    for (const id of Object.keys(states)) {
      const e = fixture.entities[id];
      if (id.startsWith(`${domain}.`) && areas.includes(entityArea(id)) && !e?.hidden) ids.push(id);
    }
    return [...new Set(ids)];
  };
  const set = (id, state, attributes = {}) => {
    states = { ...states, [id]: { ...states[id], state, attributes: { ...states[id].attributes, ...attributes } } };
  };

  const hass = {
    locale: { language: "en" },
    areas: fixture.areas,
    floors: fixture.floors,
    devices: fixture.devices,
    entities: fixture.entities,
    get states() {
      return states;
    },
    calls,
    connection: {
      async subscribeMessage(callback, msg) {
        if (msg.type !== "homeslice/subscribe") throw new Error(`fake hass: unknown subscription ${msg.type}`);
        subscribers.add(callback);
        callback({ model: structuredClone(fixture.model) });
        return () => subscribers.delete(callback);
      },
    },
    /** Test helper: what saving a new model in HA does. */
    pushModel(model) {
      fixture.model = model;
      for (const callback of subscribers) callback({ model: structuredClone(model) });
    },
    async callWS(msg) {
      if (msg.type === "homeslice/model") return structuredClone(fixture.model);
      throw new Error(`fake hass: unknown websocket command ${msg.type}`);
    },
    async callService(domain, service, data = {}, target = {}) {
      calls.push({ domain, service, data, target });
      for (const id of targets(domain, data, target)) {
        const cur = states[id]?.state;
        if (service === "turn_on") set(id, "on", { brightness: data.brightness ?? 255 });
        else if (service === "turn_off") set(id, "off");
        else if (service === "toggle") set(id, cur === "on" ? "off" : "on");
        else if (service === "open_cover") set(id, "open", { current_position: 100 });
        else if (service === "close_cover") set(id, "closed", { current_position: 0 });
        else if (service === "set_cover_position")
          set(id, data.position > 0 ? "open" : "closed", { current_position: data.position });
      }
      onChange(snapshot());
    },
  };
  // HA hands cards a new object on every change; mimic that
  const snapshot = () => Object.assign(Object.create(Object.getPrototypeOf(hass)), hass, { states });
  return snapshot();
}
