// A small stand-in for Home Assistant's frontend `hass` object, used by the browser
// tests. It answers the model websocket call, records service calls and applies them to
// the states like HA would (area targets, toggles, cover positions).

export function makeHass(fixture, onChange) {
  const calls = [];
  const subscribers = new Set();
  const showListeners = new Set();
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

  // covers move like real ones: a tenth a step, reporting opening/closing on the way
  // (instant with `fixture.instantCovers`, which the browser tests use)
  const moving = new Map();
  const move = (id, to) => {
    clearInterval(moving.get(id));
    const from = states[id]?.attributes.current_position ?? (states[id]?.state === "open" ? 100 : 0);
    if (fixture.instantCovers !== false || from === to) {
      set(id, to > 0 ? "open" : "closed", { current_position: to });
      return;
    }
    let pos = from;
    set(id, to > from ? "opening" : "closing", { current_position: pos });
    moving.set(
      id,
      setInterval(() => {
        pos = to > pos ? Math.min(to, pos + 4) : Math.max(to, pos - 4);
        set(id, pos === to ? (to > 0 ? "open" : "closed") : to > from ? "opening" : "closing", { current_position: pos });
        onChange(snapshot());
        if (pos === to) clearInterval(moving.get(id));
      }, 120),
    );
  };

  const hass = {
    locale: { language: fixture.language ?? "en" },
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
        if (msg.type === "homeslice/show/subscribe") {
          showListeners.add(callback);
          return () => showListeners.delete(callback);
        }
        if (msg.type !== "homeslice/subscribe") throw new Error(`fake hass: unknown subscription ${msg.type}`);
        subscribers.add(callback);
        callback({ model: structuredClone(fixture.model) });
        return () => subscribers.delete(callback);
      },
    },
    /** Test helper: what the homeslice.show action does. */
    show(data) {
      for (const callback of showListeners) callback(data);
    },
    /** Test helper: what saving a new model in HA does. */
    pushModel(model) {
      fixture.model = model;
      for (const callback of subscribers) callback({ model: structuredClone(model) });
    },
    saved: [],
    fetched: [],
    areaUpdates: [],
    async callWS(msg) {
      // several houses: the fixture's model is the first; `houses` holds the rest
      const houses = (fixture.houses ??= fixture.model ? { [fixture.model.id]: fixture.model } : {});
      const underlays = (fixture.underlays ??= {});
      if (msg.type === "homeslice/backup") return { name: "homeslice-backup.zip", data: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==" };
      if (msg.type === "homeslice/backup/restore") {
        this.restored = msg.data;
        return { houses: Object.keys(houses), plans: 0, models: 0 };
      }
      // a day of history: the living room light on in the evening, the kitchen blind down at night
      if (msg.type === "history/history_during_period") {
        const start = Date.parse(msg.start_time) / 1000;
        const day = (Date.parse(msg.end_time) - Date.parse(msg.start_time)) / 1000;
        const out = {};
        if (msg.entity_ids.includes("light.living_room"))
          out["light.living_room"] = [
            { s: "off", a: { friendly_name: "Living Room" }, lu: start },
            { s: "on", a: { friendly_name: "Living Room", brightness: 255, rgb_color: [255, 180, 110] }, lu: start + day * 0.5 },
            { s: "off", a: { friendly_name: "Living Room" }, lu: start + day * 0.75 },
          ];
        return out;
      }
      if (msg.type === "homeslice/underlay/get") return msg.level ? structuredClone(underlays[`${msg.house}/${msg.level}`] ?? null) : { levels: [] };
      if (msg.type === "homeslice/underlay/set") {
        const key = `${msg.house}/${msg.level}`;
        const { type, house, level, id, ...patch } = msg;
        if (!patch.image && !underlays[key]) throw new Error("Upload an image first");
        underlays[key] = { ...underlays[key], ...patch };
        return null;
      }
      // models: a tiny Poly Haven catalogue, and uploads kept in memory
      if (msg.type === "homeslice/assets/polyhaven")
        return [
          { id: "Sofa_01", name: "Sofa 01", categories: ["furniture", "seating"], tags: ["couch"], dimensions: [1.571, 0.658, 0.796], thumbnail: null },
          { id: "potted_plant_01", name: "Potted Plant 01", categories: ["plants", "potted plants"], tags: [], dimensions: [0.5, 0.5, 1.2], thumbnail: null },
          { id: "modern_ceiling_lamp_01", name: "Modern Ceiling Lamp 01", categories: ["lighting"], tags: ["hanging"], dimensions: [0.4, 0.4, 0.6], thumbnail: null },
        ];
      // textures: a tiny catalogue, "downloaded" at once
      if (msg.type === "homeslice/assets/textures")
        return [
          { id: "wood_floor", name: "Wood Floor", categories: ["wood", "floor"], tags: ["planks"], size: [2, 2], on: ["floor"], thumbnail: null },
          { id: "red_brick", name: "Red Brick", categories: ["brick", "wall"], tags: [], size: [3, 3], on: ["wall"], thumbnail: null },
          { id: "plaster_grey", name: "Grey Plaster", categories: ["plaster-concrete"], tags: [], size: [2, 2], on: ["floor", "wall"], thumbnail: null },
        ];
      if (msg.type === "homeslice/assets/textures/fetch") {
        hass.fetched.push(`texture:${msg.asset}`);
        return { url: `/homeslice_assets/textures/${msg.asset}/${msg.asset}_diff_1k.jpg`, size: [2, 2] };
      }
      if (msg.type === "homeslice/assets/polyhaven/fetch") {
        hass.fetched.push(msg.asset);
        return { url: `/homeslice_assets/polyhaven/${msg.asset}/${msg.asset}_1k.gltf` };
      }
      const uploads = (fixture.uploads ??= []);
      if (msg.type === "homeslice/assets/custom") return structuredClone(uploads);
      if (msg.type === "homeslice/assets/custom/upload") {
        if (!msg.data.startsWith("data:")) throw new Error("Upload a .glb file (binary glTF)");
        const added = { id: `m${uploads.length + 1}`, name: msg.name, url: `/homeslice_assets/custom/m${uploads.length + 1}.glb`, bytes: msg.data.length };
        uploads.push(added);
        return structuredClone(added);
      }
      if (msg.type === "homeslice/assets/custom/delete") {
        fixture.uploads = uploads.filter((u) => u.id !== msg.asset);
        return null;
      }
      if (msg.type === "homeslice/underlay/delete") {
        delete underlays[`${msg.house}/${msg.level}`];
        return null;
      }
      if (msg.type === "config/area_registry/update") {
        hass.areaUpdates.push(structuredClone(msg));
        const { type, id, area_id, ...patch } = msg;
        Object.assign(fixture.areas[area_id], patch);
        return structuredClone(fixture.areas[area_id]);
      }
      if (msg.type === "energy/get_prefs") return structuredClone(fixture.energy_prefs ?? { energy_sources: [], device_consumption: [] });
      if (msg.type === "homeslice/model") {
        const m = houses[msg.house ?? fixture.model?.id];
        if (!m) throw new Error(`fake hass: no house ${msg.house}`);
        return structuredClone(m);
      }
      // the version before the last save, per house (for "Restore previous version")
      const previous = (fixture.previous ??= {});
      if (msg.type === "homeslice/houses")
        return Object.values(houses).map((m) => ({ id: m.id, name: m.name ?? m.id, source: "api", updated: "2026-10-31T12:00:00Z", ...(previous[m.id] ? { previous: { updated: "2026-10-31T11:00:00Z", source: "assistant:openai" } } : {}) }));
      if (msg.type === "homeslice/guide") return { guide: `# Writing a Homeslice house (guide for AI assistants)\n\nHouse: ${msg.house}\n` };
      if (msg.type === "homeslice/model/restore") {
        const before = previous[msg.house];
        if (!before) throw new Error("no previous version");
        previous[msg.house] = houses[msg.house];
        houses[msg.house] = before;
        if (msg.house === fixture.model?.id) {
          fixture.model = before;
          for (const callback of subscribers) callback({ model: structuredClone(before) });
        }
        return null;
      }
      if (msg.type === "homeslice/model/delete") {
        delete houses[msg.house];
        return null;
      }
      if (msg.type === "homeslice/model/save") {
        hass.saved.push(structuredClone(msg.model));
        if (houses[msg.house]) previous[msg.house] = houses[msg.house];
        houses[msg.house] = msg.model;
        if (!fixture.model || msg.house === fixture.model.id) {
          fixture.model = msg.model;
          for (const callback of subscribers) callback({ model: structuredClone(msg.model) });
        }
        return null;
      }
      throw new Error(`fake hass: unknown websocket command ${msg.type}`);
    },
    // services as Home Assistant lists them (a robot that answers its position)
    services: { roborock: { get_vacuum_current_position: {} } },
    /** Test helper: where robots say they are when asked (map units, by entity). */
    robotPositions: (fixture.robotPositions ??= {}),
    async callService(domain, service, data = {}, target = {}, _notify = true, returnResponse = false) {
      calls.push({ domain, service, data, target });
      if (returnResponse && domain === "roborock" && service === "get_vacuum_current_position") {
        const id = [target?.entity_id ?? data?.entity_id].flat()[0];
        const at = fixture.robotPositions[id];
        return { response: at ? { [id]: { x: at[0], y: at[1] } } : {} };
      }
      for (const id of targets(domain, data, target)) {
        const cur = states[id]?.state;
        if (service === "turn_on") set(id, "on", { brightness: data.brightness ?? 255 });
        else if (service === "turn_off") set(id, "off");
        else if (service === "toggle" && id.startsWith("cover.")) move(id, cur === "closed" || cur === "closing" ? 100 : 0);
        else if (service === "toggle") set(id, cur === "on" ? "off" : "on");
        else if (service === "open_cover") move(id, 100);
        else if (service === "close_cover") move(id, 0);
        else if (service === "lock") set(id, "locked");
        else if (service === "unlock") set(id, "unlocked");
        else if (service === "media_play_pause") set(id, cur === "playing" ? "paused" : "playing");
        else if (service === "volume_set") set(id, cur, { volume_level: data.volume_level });
        else if (service === "volume_mute") set(id, cur, { is_volume_muted: data.is_volume_muted });
        else if (service === "select_source") set(id, cur, { source: data.source });
        else if (service === "set_cover_position")
          set(id, data.position > 0 ? "open" : "closed", { current_position: data.position });
      }
      onChange(snapshot());
    },
    /** Demo and test helper: what an entity's state changing in HA does. */
    setState(id, state, attributes = {}) {
      states = { ...states, [id]: { entity_id: id, ...states[id], state, attributes: { ...states[id]?.attributes, ...attributes } } };
      onChange(snapshot());
    },
  };
  // HA hands cards a new object on every change; mimic that
  const snapshot = () => Object.assign(Object.create(Object.getPrototypeOf(hass)), hass, { states });
  return snapshot();
}
