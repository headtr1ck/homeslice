#!/usr/bin/env node
// Copies the registries and states of a real Home Assistant into a private test
// fixture (dev/fixtures/private/, git-ignored) for the browser tests.
// Usage: HOMESLICE_HA_URL=ws://host:8123/api/websocket node scripts/snapshot-hass.mjs houses/home.yaml
// The access token is read from HOMESLICE_HA_TOKEN or ~/.ha_token.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const model = process.argv[2];
const url = process.env.HOMESLICE_HA_URL;
if (!model || !url) {
  console.error("usage: HOMESLICE_HA_URL=ws://host:8123/api/websocket node scripts/snapshot-hass.mjs houses/<house>.yaml");
  process.exit(2);
}
const token = process.env.HOMESLICE_HA_TOKEN ?? readFileSync(join(homedir(), ".ha_token"), "utf8").trim();

const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
const call = (msg) => new Promise((res, rej) => {
  pending.set(++id, { res, rej });
  ws.send(JSON.stringify({ ...msg, id }));
});
await new Promise((ready, fail) => {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: token }));
    else if (msg.type === "auth_ok") ready();
    else if (msg.type === "auth_invalid") fail(new Error(msg.message));
    else if (msg.type === "result") {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.success ? p.res(msg.result) : p.rej(new Error(msg.error?.message));
    }
  };
  ws.onerror = () => fail(new Error(`cannot connect to ${url}`));
});

const [floors, areas, devices, entities, states] = await Promise.all([
  call({ type: "config/floor_registry/list" }),
  call({ type: "config/area_registry/list" }),
  call({ type: "config/device_registry/list" }),
  call({ type: "config/entity_registry/list" }),
  call({ type: "get_states" }),
]);
ws.close();

const byKey = (list, key, pick) => Object.fromEntries(list.map((x) => [x[key], pick(x)]));
const fixture = {
  model,
  floors: byKey(floors, "floor_id", ({ floor_id, name, level }) => ({ floor_id, name, level })),
  areas: byKey(areas, "area_id", ({ area_id, name, floor_id, temperature_entity_id, humidity_entity_id }) => ({ area_id, name, floor_id, temperature_entity_id, humidity_entity_id })),
  devices: byKey(devices, "id", ({ id, area_id }) => ({ id, area_id })),
  entities: byKey(entities.filter((e) => !e.disabled_by), "entity_id", (e) => ({
    entity_id: e.entity_id, area_id: e.area_id, device_id: e.device_id, hidden: !!e.hidden_by, entity_category: e.entity_category,
  })),
  states: byKey(states, "entity_id", ({ entity_id, state, attributes }) => ({ entity_id, state, attributes })),
};
const dir = resolve(import.meta.dirname, "../dev/fixtures/private");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${basename(model, ".yaml")}-hass.json`);
writeFileSync(file, JSON.stringify(fixture));
console.log(`wrote ${file}: ${Object.keys(fixture.areas).length} areas, ${Object.keys(fixture.entities).length} entities, ${Object.keys(fixture.states).length} states`);
