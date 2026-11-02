// The demo house furnished, painted and lit (no browser needed): for the README's pictures
// and animation and for the demo site.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// the furniture types of the pieces used (the editor sets them from the library)
const MODERN_TYPES = {
  tv_board: "shelf", tv_wall: "tv", rug_berber: "rug", rug_runner: "rug", rug_shaggy: "rug", rug_round: "rug", sofa_corner: "sofa_corner", coffee_table_round: "coffee_table",
  floor_lamp_arc: "floor_lamp", monstera: "plant", fiddle_fig: "plant", olive_tree: "plant", dining_table_oval: "table", chair_wishbone: "chair", kitchen: "kitchen",
  fridge_freestanding: "fridge", kitchen_island: "kitchen", bar_stool_back: "stool", pendant_globe: "ceiling_lamp", hall_wardrobe: "wardrobe", bed_upholstered: "bed",
  nightstand: "nightstand", wardrobe_sliding: "wardrobe", armchair_wingback: "armchair", vanity: "sink", toilet_wall: "toilet", shower_walk_in: "shower",
  bunk_bed: "bed_single", car_hatchback: "car", wallbox: "item", bike_rack: "item", garden_light: "floor_lamp", ac_split: "item", desk: "desk", chair_office: "chair", kids_table: "table", towel_ladder: "item", teepee: "item", toy_box: "item", umbrella_stand: "item",
};

const CATALOG = JSON.parse(readFileSync(join(root, "custom_components/homeslice/catalog.json"), "utf8")).modern;

export const fixture = () => {
  const f = JSON.parse(readFileSync(join(root, "dev/fixtures/demo-hass.json"), "utf8"));
  // the showcase's own copy of the house (the tests keep theirs as it is)
  f.model = parse(readFileSync(join(root, "examples/showcase.yaml"), "utf8"));
  return f;
};

/** The demo house, furnished and painted, with its lights on. */
export function showcase(f) {
  const m = f.model;
  const rooms = Object.fromEntries(m.levels.flatMap((l) => l.rooms).map((r) => [r.id, r]));
  const set = (id, patch) => rooms[id] && Object.assign(rooms[id], patch);
  set("living", { floor: "oak_herringbone", wall: "paint_warm", wall_sides: { north: "acoustic_oak" } });
  set("kitchen", { floor: "terrazzo", wall: "tile_subway" });
  set("hall", { floor: "tile_cement" });
  m.facade = "render_white";
  const furnish = (id, pieces) => rooms[id] && (rooms[id].furniture = [...(rooms[id].furniture ?? []), ...pieces]);
  // each piece at its own size and mount from the catalogue (as the editor places them)
  const d = (model, at, more = {}) => {
    const k = CATALOG.find((x) => x.model === `modern:${model}`);
    const own = k ? { size: [k.size[0], k.size[1]], height: k.size[2], ...(k.mount ? { mount: k.mount, ...(k.elevation !== undefined ? { elevation: k.elevation } : {}) } : {}) } : {};
    return { type: k?.type ?? MODERN_TYPES[model] ?? "item", model: `modern:${model}`, at, ...own, ...more };
  };
  furnish("living", [
    d("tv_board", [2.5, 0.27], { size: [1.8, 0.4], height: 0.45 }),
    d("tv_wall", [2.5, 0.1], { mount: "wall", elevation: 1.0, entity: "media_player.living_room_tv" }),
    d("rug_berber", [2.5, 2.4], { size: [2.6, 1.9] }),
    d("sofa_corner", [2.4, 3.6], { rotation: 180, size: [2.8, 1.9] }),
    d("coffee_table_round", [2.6, 2.1]),
    d("floor_lamp_arc", [1.0, 2.6], { entity: "light.reading_lamp" }),
    d("monstera", [0.7, 1.2]),
    d("dining_table_oval", [6.5, 4.1], { rotation: 90, size: [1.9, 1.0] }),
    // facing the table: those on its left turned to the right, and the other way round
    ...[[5.85, 3.6, 270], [5.85, 4.6, 270], [7.15, 3.6, 90], [7.15, 4.6, 90]].map(([x, y, r]) => d("chair_wishbone", [x, y], { rotation: r })),
    d("fiddle_fig", [7.3, 5.2]),
  ]);
  furnish("kitchen", [
    d("kitchen", [2.2, 0.68], { size: [3.6, 0.62] }),
    d("fridge_freestanding", [4.4, 0.7]),
    d("kitchen_island", [2.8, 2.45], { size: [2.0, 0.95] }),
    d("bar_stool_back", [2.3, 3.3], { rotation: 180 }),
    d("bar_stool_back", [3.3, 3.3], { rotation: 180 }),
    d("pendant_globe", [2.3, 2.45], { mount: "ceiling" }),
    d("pendant_globe", [3.3, 2.45], { mount: "ceiling" }),
  ]);
  furnish("hall", [d("hall_wardrobe", [2.74, 0.97], { size: [1.1, 0.4], rotation: 90 }), d("rug_runner", [1.5, 2.3], { size: [0.8, 2.2] }), d("umbrella_stand", [0.7, 0.75])]);
  furnish("bedroom", [
    d("bed_upholstered", [2.15, 1.45], { size: [1.8, 2.15] }),
    d("nightstand", [0.85, 0.58]),
    d("nightstand", [3.45, 0.58]),
    d("wardrobe_sliding", [2.15, 5.6], { rotation: 180, size: [2.4, 0.65] }),
    d("rug_shaggy", [2.15, 3.1], { size: [2.4, 1.6] }),
    d("armchair_wingback", [3.3, 4.2], { rotation: 225 }),
    d("olive_tree", [0.75, 5.3]),
    // cooling the bedroom: a split unit high on the west wall
    d("ac_split", [0.5, 3.2], { mount: "wall", elevation: 2.05, rotation: 270, entity: "climate.bedroom_ac" }),
  ]);
  // the bathroom door is in its south-west corner: the shower in the south-east one
  furnish("bath", [d("vanity", [1.6, 0.6], { size: [1.0, 0.47] }), d("toilet_wall", [3.48, 1.6], { rotation: 90 }), d("shower_walk_in", [2.95, 3.49], { rotation: 180, size: [1.6, 0.9] }), d("towel_ladder", [0.42, 2.0], { rotation: 270 })]);
  // the garage: the car (there while it is home) behind its door, its wallbox
  furnish("garage", [
    d("car_hatchback", [1.75, 3.0], { finish: "blue", entity: "device_tracker.car", readings: ["sensor.car_battery"] }),
    d("wallbox", [3.27, 3.6], { mount: "wall", elevation: 1.0, rotation: 90, entity: "sensor.wallbox_power" }),
  ]);
  furnish("garden", [d("garden_light", [0.6, 0.6], { entity: "light.garden" }), d("garden_light", [4.0, 0.6], { entity: "light.garden" }), d("garden_light", [7.4, 0.6], { entity: "light.garden" })]);
  furnish("drive", [d("garden_light", [0.4, 1.0], { entity: "light.garden" }), d("garden_light", [0.4, 4.5], { entity: "light.garden" })]);
  furnish("kids", [
    d("bunk_bed", [0.85, 1.1]),
    d("desk", [3.5, 0.4], { size: [1.2, 0.6] }),
    d("chair_office", [3.5, 1.05], { rotation: 180 }),
    d("rug_round", [4.4, 2.5]),
    d("kids_table", [5.6, 2.6]),
    d("teepee", [7.0, 0.85]),
    d("toy_box", [7.1, 3.3], { rotation: 180 }),
  ]);
  // the garage, the garden lights, the bedroom's air conditioner, the car and its wallbox
  f.areas.garage = { area_id: "garage", name: "Garage", floor_id: "ground_floor" };
  const add = (id, area, state, attributes) => {
    f.states[id] = { entity_id: id, state, attributes, last_changed: new Date().toISOString() };
    if (area) f.entities[id] = { entity_id: id, area_id: area };
  };
  add("light.garden", "garden", "on", { friendly_name: "Garden lights", brightness: 200, rgb_color: [255, 196, 120], color_mode: "rgb" });
  add("climate.bedroom_ac", "bedroom", "cool", { friendly_name: "Bedroom AC", hvac_action: "cooling", current_temperature: 24.5, temperature: 22, hvac_modes: ["off", "cool", "heat", "auto"] });
  add("cover.garage", "garage", "closed", { friendly_name: "Garage door", device_class: "garage", current_position: 0 });
  add("device_tracker.car", null, "home", { friendly_name: "Car" });
  add("sensor.car_battery", null, "78", { friendly_name: "Car battery", unit_of_measurement: "%", device_class: "battery" });
  add("sensor.wallbox_power", "garage", "7.2", { friendly_name: "Wallbox", unit_of_measurement: "kW", device_class: "power" });
  for (const id of Object.keys(f.states)) if (id.startsWith("light.")) f.states[id] = { ...f.states[id], state: "on", attributes: { ...f.states[id].attributes, brightness: 220 } };
  return f;
}


// Pieces with a Modern model but no size get the catalogue's size, height and mount (as the
// editor places them), so the houses' YAML only gives what differs.
export function sized(model) {
  const fill = (f) => {
    const k = f.model && CATALOG.find((x) => x.model === f.model);
    if (!k) return f;
    return { size: [k.size[0], k.size[1]], height: k.size[2], ...(k.mount ? { mount: k.mount, ...(k.elevation !== undefined ? { elevation: k.elevation } : {}) } : {}), ...f };
  };
  for (const l of model.levels) {
    for (const r of l.rooms ?? []) if (r.furniture) r.furniture = r.furniture.map(fill);
    for (const p of l.roofs ?? []) if (p.furniture) p.furniture = p.furniture.map(fill);
  }
  return model;
}

// The other demo houses of the site's picker: each a YAML in examples/houses/ and a
// pretend Home Assistant with its floors, areas and entities (lights on, blinds half open).
const light = (name, rgb) => ["on", { friendly_name: name, brightness: 220, ...(rgb ? { rgb_color: rgb, color_mode: "rgb" } : {}) }];
const cover = (name, position, device_class = "shutter") => [position > 0 ? "open" : "closed", { friendly_name: name, device_class, current_position: position }];
const sensor = (name, value, unit, device_class) => [value, { friendly_name: name, unit_of_measurement: unit, device_class }];
const tv = (name) => ["playing", { friendly_name: name, supported_features: 149949, volume_level: 0.3, media_title: "Nature documentary", source_list: ["Live TV", "Netflix", "HDMI 1"], source: "Live TV" }];
const heating = (name, now, target, mode = "heat") => [mode, { friendly_name: name, current_temperature: now, temperature: target, hvac_action: mode === "cool" ? "cooling" : "heating", hvac_modes: ["off", "heat", "cool", "auto"] }];
const binary = (name, on, device_class) => [on ? "on" : "off", { friendly_name: name, device_class }];
const WARM = [255, 190, 120];

const HOUSES = {
  detached: {
    floors: { ground_floor: "Ground floor", first_floor: "First floor" },
    areas: {
      kitchen: ["Kitchen", "ground_floor"], hall: ["Hall", "ground_floor"], guest_wc: ["Guest WC", "ground_floor"], utility: ["Utility room", "ground_floor"],
      living_room: ["Living room", "ground_floor"], garage: ["Garage", "ground_floor"], terrace: ["Terrace", "ground_floor"], garden: ["Garden", "ground_floor"],
      front_garden: ["Front garden", "ground_floor"], ensuite: ["Ensuite", "first_floor"], bedroom: ["Bedroom", "first_floor"], landing: ["Landing", "first_floor"],
      office: ["Office", "first_floor"], bathroom: ["Bathroom", "first_floor"], kids_room: ["Kids room", "first_floor"], roof_terrace: ["Roof terrace", "first_floor"],
    },
    entities: {
      "light.kitchen": ["kitchen", ...light("Kitchen")], "light.kitchen_island": ["kitchen", ...light("Island pendants", WARM)], "light.hall": ["hall", ...light("Hall")],
      "light.guest_wc": ["guest_wc", "off", { friendly_name: "WC light" }], "light.utility": ["utility", "off", { friendly_name: "Utility light" }],
      "light.living_room": ["living_room", ...light("Living room")], "light.dining": ["living_room", ...light("Dining pendant", WARM)], "light.reading_lamp": ["living_room", ...light("Reading lamp", [255, 170, 100])],
      "light.garage": ["garage", "off", { friendly_name: "Garage light" }], "light.terrace": ["terrace", ...light("Terrace light", WARM)], "light.garden": ["garden", ...light("Garden lights", [255, 196, 120])],
      "light.front_garden": ["front_garden", ...light("Path lights", [255, 196, 120])], "light.ensuite": ["ensuite", ...light("Ensuite")], "light.bedroom": ["bedroom", ...light("Bedroom", [255, 160, 110])],
      "light.landing": ["landing", ...light("Landing")], "light.office": ["office", ...light("Office")], "light.bathroom": ["bathroom", ...light("Bathroom")],
      "light.kids_room": ["kids_room", ...light("Kids room", [140, 170, 255])], "light.roof_terrace": ["roof_terrace", ...light("Terrace lanterns", WARM)],
      "cover.kitchen": ["kitchen", ...cover("Kitchen blind", 100)], "cover.living_terrace": ["living_room", ...cover("Terrace door shutter", 100)], "cover.living_south": ["living_room", ...cover("Living room shutter", 60)],
      "cover.bedroom": ["bedroom", ...cover("Bedroom shutter", 20)], "cover.kids_room": ["kids_room", ...cover("Kids room shutter", 100)], "cover.office": ["office", ...cover("Office blind", 70)],
      "cover.terrace_awning": ["terrace", ...cover("Awning", 70, "awning")], "cover.garage_door": ["garage", ...cover("Garage door", 0, "garage")],
      "climate.living_room": ["living_room", ...heating("Living room", 21.2, 21.5)], "climate.bedroom_ac": ["bedroom", ...heating("Bedroom AC", 23.5, 21, "cool")],
      "media_player.living_room_tv": ["living_room", ...tv("TV")], "switch.fireplace": ["living_room", "on", { friendly_name: "Fireplace" }],
      "switch.sprinkler": ["garden", "on", { friendly_name: "Sprinkler" }], "switch.pool_pump": ["garden", "on", { friendly_name: "Pool pump" }],
      "lock.front_door": ["hall", "locked", { friendly_name: "Front door" }], "binary_sensor.front_door": ["hall", ...binary("Front door", false, "door")],
      "binary_sensor.terrace_door": ["living_room", ...binary("Terrace door", true, "door")], "binary_sensor.mailbox": ["front_garden", ...binary("Mailbox", true)],
      "device_tracker.car": [null, "home", { friendly_name: "Car" }], "sensor.car_battery": [null, ...sensor("Car battery", "64", "%", "battery")],
      "sensor.wallbox_power": ["garage", ...sensor("Wallbox", "11", "kW", "power")], "sensor.washer_remaining": ["utility", ...sensor("Washer", "35", "min", "duration")],
      "sensor.living_room_temperature": ["living_room", ...sensor("Living room temperature", "21.2", "°C", "temperature")],
      "sensor.bedroom_temperature": ["bedroom", ...sensor("Bedroom temperature", "23.5", "°C", "temperature")], "lawn_mower.mower": [null, "mowing", { friendly_name: "Mower" }],
    },
  },
  apartment: {
    floors: { third_floor: "Third floor" },
    areas: {
      hall: ["Hall", "third_floor"], bedroom: ["Bedroom", "third_floor"], bathroom: ["Bathroom", "third_floor"], office: ["Office", "third_floor"],
      living_room: ["Living room", "third_floor"], kitchen: ["Kitchen", "third_floor"], balcony: ["Balcony", "third_floor"],
    },
    entities: {
      "light.hall": ["hall", ...light("Hall")], "light.bedroom": ["bedroom", "off", { friendly_name: "Bedroom light" }], "light.bedside": ["bedroom", ...light("Bedside lamp", [255, 160, 110])],
      "light.bathroom": ["bathroom", ...light("Bathroom")], "light.office": ["office", ...light("Office")], "light.desk_lamp": ["office", ...light("Desk lamp")],
      "light.living_room": ["living_room", ...light("Living room", WARM)], "light.floor_lamp": ["living_room", ...light("Floor lamp", [255, 170, 100])], "light.dining": ["living_room", ...light("Dining pendant", WARM)],
      "light.kitchen": ["kitchen", ...light("Kitchen")], "light.kitchen_island": ["kitchen", ...light("Island pendants", WARM)], "light.balcony": ["balcony", ...light("Balcony lantern", WARM)],
      "cover.bedroom": ["bedroom", ...cover("Bedroom blind", 30)], "cover.office": ["office", ...cover("Office blind", 80, "blind")], "cover.living_room": ["living_room", ...cover("Living room blinds", 100)],
      "cover.balcony_door": ["living_room", ...cover("Balcony door blind", 100)], "cover.kitchen": ["kitchen", ...cover("Kitchen blind", 70)],
      "climate.living_room": ["living_room", ...heating("Living room", 21.0, 21.5)], "media_player.living_room_tv": ["living_room", ...tv("TV")],
      "lock.front_door": ["hall", "locked", { friendly_name: "Front door" }], "binary_sensor.front_door": ["hall", ...binary("Front door", false, "door")],
      "binary_sensor.balcony_door": ["living_room", ...binary("Balcony door", true, "door")], "sensor.washer_remaining": ["bathroom", ...sensor("Washer", "20", "min", "duration")],
      "sensor.living_room_temperature": ["living_room", ...sensor("Living room temperature", "21.0", "°C", "temperature")],
      "sensor.bedroom_temperature": ["bedroom", ...sensor("Bedroom temperature", "19.4", "°C", "temperature")], "vacuum.robo": [null, "cleaning", { friendly_name: "Robot vacuum" }],
    },
  },
  terraced: {
    floors: { ground_floor: "Ground floor", first_floor: "First floor", attic: "Loft" },
    areas: {
      living_room: ["Living room", "ground_floor"], hall: ["Hall", "ground_floor"], kitchen: ["Kitchen", "ground_floor"], garden: ["Garden", "ground_floor"],
      front_yard: ["Front yard", "ground_floor"], bedroom: ["Bedroom", "first_floor"], landing: ["Landing", "first_floor"], bathroom: ["Bathroom", "first_floor"],
      kids_room: ["Kids room", "first_floor"], studio: ["Studio", "attic"], shower_room: ["Shower room", "attic"],
    },
    entities: {
      "light.living_room": ["living_room", ...light("Living room", WARM)], "light.floor_lamp": ["living_room", ...light("Floor lamp", [255, 170, 100])], "light.hall": ["hall", ...light("Hall")],
      "light.kitchen": ["kitchen", ...light("Kitchen")], "light.dining": ["kitchen", ...light("Dining pendant", WARM)], "light.garden": ["garden", ...light("Patio lights", [255, 196, 120])],
      "light.front_yard": ["front_yard", ...light("Front light", WARM)], "light.bedroom": ["bedroom", ...light("Bedroom", [255, 160, 110])], "light.landing": ["landing", ...light("Landing")],
      "light.bathroom": ["bathroom", ...light("Bathroom")], "light.kids_room": ["kids_room", ...light("Kids room", [140, 170, 255])], "light.studio": ["studio", ...light("Studio")],
      "light.shower_room": ["shower_room", "off", { friendly_name: "Shower room light" }],
      "cover.living_room": ["living_room", ...cover("Living room blind", 100)], "cover.kitchen": ["kitchen", ...cover("Kitchen blind", 60)], "cover.bedroom": ["bedroom", ...cover("Bedroom blind", 20)],
      "cover.kids_room": ["kids_room", ...cover("Kids room blind", 100)], "cover.roof_window": ["studio", ...cover("Roof window shutter", 100)],
      "binary_sensor.roof_window": ["studio", ...binary("Roof window", true, "window")], "binary_sensor.garden_door": ["kitchen", ...binary("Garden door", false, "door")],
      "lock.front_door": ["hall", "unlocked", { friendly_name: "Front door" }], "binary_sensor.front_door": ["hall", ...binary("Front door", false, "door")],
      "climate.living_room": ["living_room", ...heating("Living room", 20.6, 21)], "media_player.living_room_tv": ["living_room", ...tv("TV")],
      "switch.sprinkler": ["garden", "off", { friendly_name: "Sprinkler" }], "sensor.bin_pickup": ["front_yard", ...sensor("Bin pickup", "1", "d")],
      "sensor.living_room_temperature": ["living_room", ...sensor("Living room temperature", "20.6", "°C", "temperature")],
    },
  },
};

const pretend = (id) => {
  const spec = HOUSES[id];
  const now = new Date().toISOString();
  const f = { floors: {}, areas: {}, devices: {}, entities: {}, states: {}, model: sized(parse(readFileSync(join(root, `examples/houses/${id}.yaml`), "utf8"))) };
  Object.entries(spec.floors).forEach(([floor_id, name], level) => (f.floors[floor_id] = { floor_id, name, level }));
  for (const [area_id, [name, floor_id]] of Object.entries(spec.areas)) f.areas[area_id] = { area_id, name, floor_id };
  for (const [entity_id, [area_id, state, attributes]] of Object.entries(spec.entities)) {
    f.entities[entity_id] = { entity_id, area_id };
    f.states[entity_id] = { entity_id, state, attributes, last_changed: now };
  }
  return f;
};

/** The other demo houses by id, each a fixture for the pretend Home Assistant. */
export const houses = Object.fromEntries(Object.keys(HOUSES).map((id) => [id, () => pretend(id)]));
