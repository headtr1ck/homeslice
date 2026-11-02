// editor, starting from scratch
import { test } from "@playwright/test";
import { parse } from "yaml";
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, base, browser, loadFixture, open, out, setBrowser, shot, state, triangles } from "./helpers.mjs";

test.describe.serial("editor, starting from scratch", () => {
  let page, errors, fixture, model, lvl;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("dialog", (d) => d.accept());
    await page.goto(`${base}/dev/harness.html`);
    await page.waitForFunction(() => window.ready);
    fixture = loadFixture("dev/fixtures/demo-hass.json");
    fixture.model = null;
    fixture.floors.basement = { floor_id: "basement", name: "Basement", level: -1 };
    fixture.areas.cellar = { area_id: "cellar", name: "Cellar", floor_id: "basement" };
    await page.evaluate((f) => window.setupPanel(f), fixture);
    model = () => page.evaluate(() => window.panel._model);
    lvl = async (id) => (await model()).levels.find((l) => l.id === id);

  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("with no house, a new one is made from HA's floors and areas; an Outside floor joins the ground floor", async () => {
    // the garden on its own HA floor, as many people set it up
    await page.evaluate(() => {
      const h = window.panel.hass;
      window.panel.hass = {
        ...h,
        floors: { ...h.floors, outside: { floor_id: "outside", name: "Outside", level: null } },
        areas: { ...h.areas, garden: { ...h.areas.garden, floor_id: "outside" } },
      };
    });
    await page.locator("homeslice-panel .empty button.primary").click();
    const dialog = page.locator("homeslice-panel .create");
    assert((await dialog.locator("input[type=checkbox]").count()) === 5, "expected four floors and the rooms option");
    const outsideLevel = dialog.locator('select[aria-label="Level for Outside"]');
    assert((await outsideLevel.inputValue()) === "ground_floor", `outside goes to: ${await outsideLevel.inputValue()}`);
    await dialog.locator("input").first().fill("Test house");
    await dialog.locator("input[type=number]").nth(0).fill("9");
    await dialog.locator("input[type=number]").nth(0).dispatchEvent("change");
    await shot(page, "editor-new-house");
    await dialog.locator("button.primary").click();
    await page.waitForFunction(() => window.panel.shadowRoot.querySelector("svg.plan .room"));
    const m = await model();
    assert(m.id === "test_house" && m.name === "Test house", `id/name: ${m.id} ${m.name}`);
    assert(JSON.stringify(m.outline) === '{"rect":[0,0,9,8]}', `outline: ${JSON.stringify(m.outline)}`);
    assert(JSON.stringify(m.levels.map((l) => l.id)) === '["basement","ground_floor","first_floor"]', `levels: ${m.levels.map((l) => l.id)}`);
    assert(JSON.stringify(m.levels[1].include_floors) === '["outside"]', `ground floor includes: ${JSON.stringify(m.levels[1].include_floors)}`);
    // opens on the entrance floor with a room per area
    assert((await page.locator("homeslice-panel button.level.active").textContent()).includes("Ground Floor"), "not on the ground floor");
    const names = await page.locator("homeslice-panel svg.plan text.room-name").allTextContents();
    for (const n of ["Hall", "Kitchen", "Living Room", "Garden"]) assert(names.includes(n), `missing ${n}: ${names}`);
    const garden = m.levels[1].rooms.find((r) => r.area_id === "garden");
    assert(garden.kind === "outdoor" && garden.rect[1] === 8, `garden: ${JSON.stringify(garden)}`);
    assert(!(await page.locator("homeslice-panel button.save.dirty").count()), "a new house should be saved right away");
    await page.waitForFunction(() => window.panel.renderer?.renderer.info.render.triangles > 100, null, { timeout: 10000 });
    await shot(page, "editor-new-house-created");
  });

  test("an area without a room can be drawn from the level inspector", async () => {
    await page.locator('homeslice-panel svg.plan g[data-room="hall"] polygon').click({ force: true });
    await page.keyboard.press("Delete");
    await page.keyboard.press("Escape");
    const item = page.locator("homeslice-panel ul.unplaced li", { hasText: "Hall" });
    await item.locator("button").click();
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    const { scale, ox, oy } = await page.evaluate(() => window.panel._view);
    const at = (x, y) => [plan.x + ox + x * scale, plan.y + oy + y * scale];
    await page.mouse.move(...at(0.5, 0.5));
    await page.mouse.down();
    await page.mouse.move(...at(3, 3), { steps: 5 });
    await page.mouse.up();
    const hall = (await lvl("ground_floor")).rooms.find((r) => r.area_id === "hall");
    assert(hall?.id === "hall", `hall: ${JSON.stringify(hall)}`);
    assert(!(await page.locator("homeslice-panel ul.unplaced li", { hasText: "Hall" }).count()), "hall still listed as unplaced");
  });

  test("floor plan image: upload, straighten, scale from two points with a ruler, move, turn, remove", async () => {
    await page.keyboard.press("Escape");
    // a 400 × 200 test image
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 200;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 400, 200);
      ctx.fillStyle = "#000";
      ctx.fillRect(100, 98, 200, 4);
      return c.toDataURL("image/png");
    });
    await page.locator("homeslice-panel .inspector label.file input").setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") });
    await page.waitForSelector("homeslice-panel svg.plan image.underlay");
    assert((await page.locator("homeslice-panel .calib").textContent()).includes("askew"), "straightening not offered first");
    const screenOf = (px) =>
      page.evaluate((px) => {
        const p = window.panel;
        const [x, y] = p.toScreen(p.underlayToPlan(p._underlay, px));
        const r = p.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
        return [r.left + x, r.top + y];
      }, px);
    // a wall drawn 4 px askew over 200 px: the image turns back by atan(4/200)
    await page.mouse.click(...(await screenOf([100, 100])));
    await page.mouse.click(...(await screenOf([300, 104])));
    const tilt = (Math.atan2(4, 200) * 180) / Math.PI;
    const turned = await page.evaluate(() => window.panel._underlay.place.rotation);
    assert(Math.abs(turned - (360 - tilt)) < 0.05, `straightened to ${turned}, expected ${360 - tilt}`);
    assert((await page.locator("homeslice-panel .calib").textContent()).includes("Click the start"), "calibration not started after straightening");
    await page.mouse.click(...(await screenOf([100, 100])));
    await page.mouse.click(...(await screenOf([300, 100])));
    await page.locator("homeslice-panel .calib input.calib-distance").fill("4");
    await page.locator("homeslice-panel .calib button.primary").click();
    const placed = await page.evaluate(() => window.panel._underlay.place);
    assert(Math.abs(placed.scale - 0.02) < 1e-6, `scale: ${placed.scale}`);
    // the line stays as a ruler with its length
    const ruler = await page.locator("homeslice-panel svg.plan g.ruler text").textContent();
    assert(/^4([.,]00?)? ?m$/.test(ruler.trim()), `ruler label ${ruler}`);
    // moving is on after scaling
    const scale = await page.evaluate(() => window.panel._view.scale);
    const from = await screenOf([200, 150]);
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(from[0] + scale, from[1], { steps: 4 });
    await page.mouse.up();
    const moved = await page.evaluate(() => window.panel._underlay.place.origin);
    assert(Math.abs(moved[0] - placed.origin[0] - 1) < 0.02, `moved: ${JSON.stringify(moved)} from ${JSON.stringify(placed.origin)}`);
    await shot(page, "editor-underlay");
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel .inspector input.underlay-rotation").fill("0");
    await page.locator("homeslice-panel .inspector input.underlay-rotation").press("Enter");
    assert((await page.evaluate(() => window.panel._underlay.place.rotation)) === 0, "rotation field ignored");
    await page.locator("homeslice-panel .inspector button[aria-label='Turn right 90°']").click();
    assert((await page.evaluate(() => window.panel._underlay.place.rotation)) === 90, "not turned");
    const stored = await page.evaluate(() => window.panel.hass.callWS({ type: "homeslice/underlay/get", house: "test_house", level: "ground_floor" }));
    assert(stored?.place?.rotation === 90 && Math.abs(stored.place.scale - 0.02) < 1e-6 && stored.place.ruler, `stored: ${JSON.stringify(stored?.place)}`);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "Show the ruler" }).locator("input").uncheck();
    assert(!(await page.locator("homeslice-panel svg.plan g.ruler").count()), "ruler still shown");
    await page.locator("homeslice-panel .inspector button", { hasText: "Remove image" }).click();
    assert(!(await page.locator("homeslice-panel svg.plan image.underlay").count()), "image still shown");
  });

  test("floor plan image: a robot vacuum's map, true to scale", async () => {
    await page.keyboard.press("Escape");
    // a vacuum with a map picture on its device
    await page.route("**/api/image_proxy/image.robo_map**", (route) => route.fulfill({ contentType: "image/jpeg", body: readFileSync("dev/fixtures/texture.jpg") }));
    await page.evaluate(() => {
      const p = window.panel;
      const h = p.hass;
      p.hass = {
        ...h,
        entities: { ...h.entities, "vacuum.robo": { ...(h.entities["vacuum.robo"] ?? { entity_id: "vacuum.robo" }), device_id: "robo_device" }, "image.robo_map": { entity_id: "image.robo_map", device_id: "robo_device" } },
        states: { ...h.states, "image.robo_map": { entity_id: "image.robo_map", state: "2026-11-01", attributes: { friendly_name: "Robo Ground Floor", entity_picture: "/api/image_proxy/image.robo_map?token=x" } } },
      };
    });
    const b = await page.locator("homeslice-panel svg.plan").boundingBox();
    await page.mouse.click(b.x + 5, b.y + b.height - 5); // empty space: the level inspector
    const button = page.locator("homeslice-panel .inspector button[data-robot-map='image.robo_map']");
    await button.waitFor({ timeout: 5000 });
    await button.click();
    await page.waitForSelector("homeslice-panel svg.plan image.underlay");
    const scale = await page.evaluate(() => window.panel._underlay.place.scale);
    assert(scale === 0.0125, `scale ${scale}`);
    await page.locator("homeslice-panel .inspector button", { hasText: "Remove image" }).click();
    await page.keyboard.press("Escape");
  });

  test("a roof window added to a room, with its place on the plan", async () => {
    await page.keyboard.press("Escape");
    const room = await page.evaluate(() => window.panel._model.levels.find((l) => l.id === window.panel._level).rooms[0].id);
    await page.evaluate((room) => (window.panel._room = room), room);
    await page.locator("homeslice-panel details.roof-windows summary").click();
    await page.locator("homeslice-panel button[data-room-roof-window-add]").click();
    const w = await page.evaluate((room) => window.panel._model.levels.find((l) => l.id === window.panel._level).rooms.find((r) => r.id === room).roof_windows, room);
    assert(w?.length === 1 && w[0].at.length === 2, `roof windows: ${JSON.stringify(w)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.evaluate(() => (window.panel._room = null));
  });

  test("curved walls: bow the outside wall, the room along it follows; undo", async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.panel._settings = null;
      window.panel._tool = "select";
      window.panel._room = "__outline__";
    });
    const curves = page.locator("homeslice-panel details.curves");
    await curves.locator("summary").click();
    await curves.locator("select[data-curve-edge]").selectOption("2");
    await curves.locator("input[data-curve-bulge]").fill("1.5");
    await curves.locator("input[data-curve-bulge]").press("Enter");
    const m = await page.evaluate(() => ({ outline: window.panel._model.outline.curves, rooms: window.panel._model.levels[0].rooms.filter((r) => r.curves).map((r) => r.id) }));
    assert(JSON.stringify(m.outline) === JSON.stringify([{ edge: 2, bulge: 1.5 }]) && m.rooms.length, `curved: ${JSON.stringify(m)}`);
    await shot(page, "editor-curved");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(!(await page.evaluate(() => window.panel._model.outline.curves)), "undo kept the curve");
    await page.evaluate(() => (window.panel._room = null));
  });

  test("floors: duplicate one, move a room to another floor, undo both", async () => {
    await page.keyboard.press("Escape");
    const before = await page.evaluate(() => ({ levels: window.panel._model.levels.map((l) => l.id), level: window.panel._level }));
    await page.evaluate(() => {
      window.panel._settings = null;
      window.panel._tool = "select";
      window.panel._room = null;
    });
    await page.locator("homeslice-panel button[data-duplicate-level]").click();
    let m = await page.evaluate(() => ({ levels: window.panel._model.levels.map((l) => l.id), level: window.panel._level }));
    assert(m.levels.length === before.levels.length + 1 && m.level === `${before.level}_copy`, `after duplicating: ${JSON.stringify(m)}`);
    await page.keyboard.press("Control+z");
    await page.evaluate((id) => (window.panel._level = id), before.level);
    // a room to the next floor
    const room = await page.evaluate(() => window.panel._model.levels.find((l) => l.id === window.panel._level).rooms[0].id);
    await page.evaluate((room) => (window.panel._room = room), room);
    const other = before.levels.find((l) => l !== before.level);
    await page.locator("homeslice-panel label.move-floor select").selectOption(other);
    m = await page.evaluate(([from, to]) => ({ here: window.panel._model.levels.find((l) => l.id === from).rooms.map((r) => r.id), there: window.panel._model.levels.find((l) => l.id === to).rooms.map((r) => r.id), level: window.panel._level }), [before.level, other]);
    assert(!m.here.includes(room) && m.there.some((r) => r.startsWith(room)) && m.level === other, `after moving: ${JSON.stringify(m)}`);
    await page.keyboard.press("Control+z");
    m = await page.evaluate(() => window.panel._model.levels.map((l) => l.id));
    assert(JSON.stringify(m) === JSON.stringify(before.levels), `undo: ${JSON.stringify(m)}`);
    await page.evaluate((id) => {
      window.panel._level = id;
      window.panel._room = null;
    }, before.level);
  });

  test("roof level: add it, pick a preset, a second part at an angle, solar panels", async () => {
    await page.keyboard.press("Escape");
    const click = (sel) => page.locator(sel).first().click({ timeout: 5000 }).catch((e) => assert(false, `${sel}: ${e.message.split("\n")[0]}`));
    // the roof is set up with the house's outline
    await page.evaluate(() => {
      window.panel._settings = null;
      window.panel._tool = "select";
      window.panel._room = "__outline__";
    });
    // right in the level list, next to "+ Floor"
    await click("homeslice-panel aside.levels button[data-add-roof]");
    const model = () => page.evaluate(() => window.panel._model);
    let m = await model();
    const roof = m.levels.at(-1);
    assert(roof.kind === "roof" && roof.roofs.length === 1 && !m.roof, `roof level: ${JSON.stringify(roof)}`);
    await click('homeslice-panel button[data-roof-preset="tuscan"]');
    m = await model();
    assert(m.levels.at(-1).roofs[0].shape === "hip" && m.levels.at(-1).roofs[0].pitch === 22, `tuscan: ${JSON.stringify(m.levels.at(-1).roofs[0])}`);
    await click("homeslice-panel button[data-add-roof-part]");
    m = await model();
    assert(m.levels.at(-1).roofs.length === 2, "no second part");
    await click("homeslice-panel button[data-add-solar=far]");
    m = await model();
    assert(m.levels.at(-1).roofs[1].furniture?.length === 8, `panels: ${JSON.stringify(m.levels.at(-1).roofs[1].furniture)}`);
    assert(await page.locator("homeslice-panel svg.plan polygon.roof-part").count() === 2, "roof parts not on the plan");
    await shot(page, "editor-roof-level");
    await page.evaluate(() => {
      for (let i = 0; i < 4; i++) window.panel.undo();
      // back on a floor that still exists, nothing picked
      window.panel._level = window.panel._model.levels[0].id;
      window.panel._room = null;
    });
  });

  test("backup: download one file, restore it", async () => {
    await page.keyboard.press("Escape");
    if (!(await page.evaluate(() => !!window.panel._settings))) await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.locator("homeslice-panel button[data-backup]").click({ timeout: 10000 })]);
    assert(download.suggestedFilename().endsWith("homeslice-backup.zip"), "no backup file");
    const zip = Buffer.from(zipSync({ "manifest.json": strToU8('{"format":"homeslice-backup","version":1}') }));
    await page.locator("homeslice-panel input[type=file][accept='.zip']").setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer: zip });
    await page.waitForSelector("homeslice-panel p.notice", { timeout: 5000 });
    assert((await page.locator("homeslice-panel p.notice").textContent()).includes("Restored"), "no note after restoring");
    assert(await page.evaluate(() => window.panel._hass.restored?.startsWith("data:")), "the backup was not sent");
  });

  test("import from Sweet Home 3D: rooms on the wall centres, doors, windows, furniture", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    // two rooms inside 20 cm walls, a door between them, a window, a sofa and a bed
    const xml = `<?xml version="1.0"?><home name="Flat">
      <level id="l0" name="Ground" elevation="0" height="250" floorThickness="12"/>
      <wall level="l0" xStart="0" yStart="0" xEnd="820" yEnd="0" thickness="20"/>
      <room level="l0" name="Living"><point x="10" y="10"/><point x="490" y="10"/><point x="490" y="390"/><point x="10" y="390"/></room>
      <room level="l0" name="Bedroom"><point x="510" y="10"/><point x="810" y="10"/><point x="810" y="390"/><point x="510" y="390"/></room>
      <doorOrWindow level="l0" name="Door" x="500" y="200" angle="1.5708" width="90" depth="20" height="210" elevation="0"/>
      <doorOrWindow level="l0" name="Window" x="250" y="0" angle="0" width="150" depth="20" height="130" elevation="90"/>
      <pieceOfFurniture level="l0" name="Sofa" x="250" y="300" angle="3.14159" width="220" depth="90" height="80"/>
      <pieceOfFurniture level="l0" name="Double bed" x="660" y="200" angle="0" width="160" depth="200" height="50"/>
    </home>`;
    const sh3d = Buffer.from(zipSync({ "Home.xml": strToU8(xml) }));
    await page.locator("homeslice-panel input[type=file][accept='.sh3d']").setInputFiles({ name: "flat.sh3d", mimeType: "application/octet-stream", buffer: sh3d });
    await page.waitForFunction(() => window.panel._settings?.paste?.includes("Bedroom"), null, { timeout: 5000 });
    const house = parse(await page.evaluate(() => window.panel._settings.paste));
    const [living, bedroom] = house.levels[0].rooms;
    assert(living.name === "Living" && JSON.stringify(living.polygon[0]) === "[0,0]", `living: ${JSON.stringify(living)}`);
    assert(bedroom.polygon.some(([x]) => x === 8.2), `bedroom: ${JSON.stringify(bedroom)}`);
    const types = house.levels[0].openings.map((o) => `${o.type}:${o.room}:${o.side}`).sort();
    assert(JSON.stringify(types) === JSON.stringify(["door:bedroom:west", "window:living:north"].sort()) || JSON.stringify(types) === JSON.stringify(["door:living:east", "window:living:north"].sort()), `openings: ${types}`);
    assert(living.furniture[0].type === "sofa" && living.furniture[0].rotation === 180 && bedroom.furniture[0].type === "bed", `furniture: ${JSON.stringify([living.furniture, bedroom.furniture])}`);
    // an outline around the rooms, so it can be used as it is
    assert(house.outline?.polygon?.length === 4, `outline: ${JSON.stringify(house.outline)}`);
    await page.locator("homeslice-panel textarea.yaml").fill("");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    assert(!(await page.evaluate(() => window.panel._settings)), "settings still open");
  });

  test("import an SVG floor plan: rooms from closed shapes, entities from their ids", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    // a frame, two rooms (one inside a moved group, one a path), a light and a sensor named by their ids
    // the width it asks for: 12 m
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 1200 800">
      <rect x="0" y="0" width="1200" height="800" fill="none" stroke="#000"/>
      <g transform="translate(0 0)"><rect id="Kitchen" x="0" y="0" width="600" height="800"/></g>
      <path inkscape:label="Living room" d="M600 0 H1200 V800 H600 Z"/>
      <circle id="light.kitchen" cx="300" cy="400" r="20"/>
      <rect id="sensor.living_temperature" x="890" y="390" width="20" height="20"/>
    </svg>`;
    await page.evaluate(() => {
      window.__prompt = window.prompt;
      window.prompt = () => "12";
    });
    await page.locator("homeslice-panel input[data-import-svg]").setInputFiles({ name: "plan.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    await page.waitForFunction(() => window.panel._settings?.paste?.includes("living_room") || window.panel._settings?.problems, null, { timeout: 5000 }).catch(() => undefined);
    const st = await page.evaluate(() => window.panel._settings);
    await page.evaluate(() => (window.prompt = window.__prompt));
    assert(st?.paste, `nothing imported: ${JSON.stringify(st)}`);
    const house = parse(st.paste);
    const [kitchen, living] = house.levels[0].rooms;
    assert(kitchen.id === "kitchen" && JSON.stringify(kitchen.polygon.flat().filter((v) => v === 6).length) === "2", `kitchen: ${JSON.stringify(kitchen)}`);
    assert(living.name === "Living room" && living.polygon.some(([x]) => x === 12), `living: ${JSON.stringify(living)}`);
    assert(JSON.stringify(kitchen.lights) === JSON.stringify([{ entity: "light.kitchen", at: [3, 4] }]), `light: ${JSON.stringify(kitchen.lights)}`);
    const sensor = living.furniture?.[0];
    assert(sensor?.entity === "sensor.living_temperature" && sensor.mount === "wall", `sensor: ${JSON.stringify(sensor)}`);
    const corners = (house.outline?.polygon ?? []).map((p) => p.join()).sort();
    assert(JSON.stringify(corners) === JSON.stringify(["0,0", "0,8", "12,0", "12,8"]), `outline: ${JSON.stringify(house.outline)}`);
    await page.locator("homeslice-panel textarea.yaml").fill("");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
  });

  test("import a plan from another 3D floor-plan card and use it", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    const plan = {
      version: 1,
      settings: { wall_exterior: 0.24, wall_interior: 0.12 },
      floors: [
        {
          id: "f0",
          name: "Ground floor",
          elevation: 0,
          height: 2.5,
          rooms: [
            { id: "a", name: "Living", points: [[0, 0], [5, 0], [5, 4], [0, 4]] },
            { id: "b", name: "Kitchen", points: [[5, 0], [8, 0], [8, 4], [5, 4]] },
          ],
          openings: [{ id: "o", room_id: "a", edge: 2, offset: 2.5, type: "door", width: 0.9, height: 2.05, sill: 0 }],
          furniture: [{ id: "s", type: "sofa", x: 2.5, z: 3, rotation: 180, w: 2.2, d: 0.9, h: 0.8 }],
          placements: [],
        },
      ],
    };
    await page.locator("homeslice-panel input[data-import-plan]").setInputFiles({ name: "plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "export", version: 1, building: plan })) });
    await page.waitForFunction(() => window.panel._settings?.paste?.includes("kitchen"), null, { timeout: 5000 });
    const before = await page.evaluate(() => window.panel._model.levels.length);
    await page.locator("homeslice-panel .inspector button.primary", { hasText: "Apply" }).click();
    const m = await page.evaluate(() => window.panel._model);
    assert(m.levels[0].rooms.map((r) => r.id).join() === "living,kitchen" && m.levels[0].openings?.[0]?.side === "south", `applied: ${JSON.stringify(m.levels[0])}`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    assert((await page.evaluate(() => window.panel._model.levels.length)) === before, "undo did not bring the house back");
  });

  test("own pieces: add a pack from a file, a broken one is refused", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    const pack = "pieces:\n  - id: stool\n    size: [0.4, 0.4, 0.45]\n    parts:\n      - {shape: cylinder, size: [0.4, 0.4, 0.05], at: [0, 0, 0.4], finish: oak}\n      - {shape: taper, size: [0.3, 0.3, 0.4], top: 0.4, finish: black}\n";
    await page.locator("homeslice-panel input[data-pieces-add]").setInputFiles({ name: "stool.yaml", mimeType: "text/yaml", buffer: Buffer.from(pack) });
    await page.waitForFunction(() => window.panel._model.pieces?.some((p) => p.id === "stool"), null, { timeout: 5000 });
    assert(await page.locator("homeslice-panel button[data-pieces-download]").isEnabled(), "download stays off");
    const broken = "pieces:\n  - id: bad\n    size: [1, 1, 1]\n    parts: [{shape: star, size: [1, 1, 1]}]\n";
    await page.locator("homeslice-panel input[data-pieces-add]").setInputFiles({ name: "bad.yaml", mimeType: "text/yaml", buffer: Buffer.from(broken) });
    await page.waitForFunction(() => window.panel._settings?.problems?.some((p) => p.includes("shape must be")), null, { timeout: 5000 });
    assert(!(await page.evaluate(() => window.panel._model.pieces.some((p) => p.id === "bad"))), "a broken piece was taken");
    // a new one from the builder: a part more, its height changed
    await page.locator("homeslice-panel button[data-piece-new]").click();
    const editor = page.locator('homeslice-panel details.piece-editor[data-piece="piece"]');
    await editor.locator("summary").click();
    await editor.locator("button[data-part-add]").click();
    await editor.locator('.piece-part[data-part="1"] select').selectOption("sphere");
    const height = editor.locator('label .triple input').nth(2);
    await height.fill("1.2");
    await height.press("Enter");
    const built = await page.evaluate(() => window.panel._model.pieces.find((p) => p.id === "piece"));
    assert(built.parts.length === 2 && built.parts[1].shape === "sphere" && built.size[2] === 1.2, `built: ${JSON.stringify(built)}`);
    await shot(page, "editor-piece-builder");
    await page.keyboard.press("Escape");
    // back to before the pack (each change is a step; a focused field would take the keys)
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    for (let i = 0; i < 8 && (await page.evaluate(() => window.panel._model.pieces?.length)); i++) await page.keyboard.press("Control+z");
    assert(!(await page.evaluate(() => window.panel._model.pieces?.length)), "pieces left after undo");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
  });

  test("house settings: YAML in and out, invalid YAML is explained", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "House settings", "settings not shown");
    const yaml = await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      m.levels[1].rooms[0].name = "Renamed";
      return JSON.stringify(m); // JSON is YAML too
    });
    await page.locator("homeslice-panel textarea.yaml").fill("levels: [oops");
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    assert(await page.locator("homeslice-panel ul.problems li").count(), "no problem shown for broken YAML");
    await page.locator("homeslice-panel textarea.yaml").fill("schema: 1\nid: x\nlevels:\n  - id: g\n    rooms:\n      - { id: a }");
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    const problems = await page.locator("homeslice-panel ul.problems").textContent();
    assert(problems.includes("rect"), `expected a fix-it message: ${problems}`);
    await page.locator("homeslice-panel textarea.yaml").fill(yaml);
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    assert((await model()).levels[1].rooms[0].name === "Renamed", "pasted YAML not applied");
    assert((await model()).id === "test_house", "id must stay");
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    const download = page.waitForEvent("download");
    await page.locator("homeslice-panel .inspector button", { hasText: "Download .glb" }).click();
    const file = await download;
    assert(file.suggestedFilename() === "test_house.glb", `file: ${file.suggestedFilename()}`);
    const bytes = readFileSync(await file.path());
    assert(bytes.subarray(0, 4).toString() === "glTF" && bytes.length > 10000, `glb: ${bytes.length} bytes`);
    await page.keyboard.press("Escape");
  });

  test("house settings: a prompt for an AI assistant, its errors, restoring the previous version", async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      // the page's clipboard, readable by the test
      window.copied = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => void window.copied.push(t) } });
    });
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Copy prompt for an AI assistant" }).click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Copied" }).first().waitFor();
    const prompt = await page.evaluate(() => window.copied.at(-1));
    assert(prompt.startsWith("Please draw my home for Homeslice") && prompt.includes("guide for AI assistants") && prompt.includes("House: test_house"), `prompt: ${prompt.slice(0, 200)}`);
    // an assistant's answer with a mistake: the errors can go straight back to it
    await page.locator("homeslice-panel textarea.yaml").fill("schema: 1\nid: x\nlevels:\n  - id: g\n    rooms:\n      - { id: a }");
    await page.locator("homeslice-panel .inspector button", { hasText: "Check and apply" }).click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Copy errors for the assistant" }).click();
    const errorsText = await page.evaluate(() => window.copied.at(-1));
    assert(errorsText.startsWith("Homeslice found these errors") && errorsText.includes("- levels.g.rooms.a: A room needs rect"), `errors: ${errorsText}`);
    // save twice: the first version can be restored
    await page.keyboard.press("Escape");
    const before = (await model()).levels[0].rooms[0].name;
    await page.evaluate(() => window.panel.save());
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      m.levels[0].rooms[0].name = "Changed by an assistant";
      return window.panel.hass.callWS({ type: "homeslice/model/save", house: "test_house", model: m });
    });
    await page.evaluate(() => window.panel.hass.callWS({ type: "homeslice/houses" }).then((h) => (window.panel._houses = h)));
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Restore the version from" }).click();
    await page.waitForFunction((name) => window.panel._model?.levels[0].rooms[0].name === name, before);
    await page.keyboard.press("Escape");
  });

  test("a level can start from the one below", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel button.level", { hasText: "First Floor" }).click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Start from the level below" }).click();
    const ground = (await lvl("ground_floor")).rooms.filter((r) => r.kind !== "outdoor");
    const first = (await lvl("first_floor")).rooms;
    assert(first.length === ground.length && first.every((r) => !r.area_id), `copied: ${JSON.stringify(first)}`);
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel button.level", { hasText: "Ground Floor" }).click();
  });

  test("levels: height, add above, delete", async () => {
    await page.keyboard.press("Escape");
    const height = page.locator("homeslice-panel .inspector label", { hasText: "Storey height" }).locator("input");
    await height.fill("2.8");
    await height.dispatchEvent("change");
    assert((await lvl("ground_floor")).height === 2.8, "height not stored");
    await page.locator("homeslice-panel button.add-level:not([data-add-roof])").click();
    const m = await model();
    assert(m.levels.length === 4 && m.levels[3].name === "New level", `levels: ${JSON.stringify(m.levels.map((l) => l.id))}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "New level", "new level not selected");
    await page.locator("homeslice-panel .inspector button.danger").click();
    assert((await model()).levels.length === 3, "level not deleted");
    assert(errors.length === 0, errors.join(" | "));
  });

  test("deleting the house goes back to the start", async () => {
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.locator("homeslice-panel .inspector button", { hasText: "Delete house" }).click();
    await page.waitForSelector("homeslice-panel .empty button.primary");
    assert(errors.length === 0, errors.join(" | "));
  });
});
