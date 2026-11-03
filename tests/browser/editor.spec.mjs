// editor
import { test } from "@playwright/test";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, base, browser, lamp, loadFixture, open, out, root, setBrowser, librarySource, shot, state, triangles } from "./helpers.mjs";

test.describe.serial("editor", () => {
  let page, errors, model, room;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}/dev/harness.html`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate((f) => window.setupPanel(f), loadFixture("dev/fixtures/demo-hass.json"));
    model = () => page.evaluate(() => window.panel._model);
    room = async (id) => (await model()).levels[0].rooms.find((r) => r.id === id);

  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("opens the house on the ground floor with names, areas and a 3D preview", async () => {
    const names = await page.locator("homeslice-panel svg.plan text.room-name").allTextContents();
    assert(names.includes("Living Room") && names.includes("Kitchen") && !names.includes("Bedroom"), `plan labels: ${names.join(", ")}`);
    const areas = await page.locator("homeslice-panel svg.plan text.room-area").allTextContents();
    // inside dimensions: the 5 × 4 m kitchen (on wall centre lines) minus half of each wall
    assert(areas.includes("18.1 m²"), `kitchen area missing: ${areas.join(", ")}`);
    await page.waitForFunction(() => window.panel.renderer?.renderer.info.render.triangles > 100, null, { timeout: 10000 });
    await shot(page, "editor-open");
  });

  test("the side panel: its edge dragged wider, kept in this browser; a double-click resets it", async () => {
    const side = () => page.locator("homeslice-panel section.side").evaluate((el) => el.getBoundingClientRect().width);
    const before = await side();
    const handle = await page.locator("homeslice-panel .side-handle").boundingBox();
    await page.mouse.move(handle.x + 3, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(handle.x - 150, handle.y + 200, { steps: 6 });
    await page.mouse.up();
    const wider = await side();
    assert(Math.abs(wider - before - 150) < 8, `width ${before} → ${wider}`);
    // (the panel's width plus its border)
    assert(Math.abs(Number(await page.evaluate(() => localStorage.getItem("homeslice-side-width"))) - wider) <= 2, "width not kept");
    await page.locator("homeslice-panel .side-handle").dblclick();
    assert(Math.abs((await side()) - before) < 2 && !(await page.evaluate(() => localStorage.getItem("homeslice-side-width"))), "double-click did not reset");
  });

  test("selecting a room shows its handles and inspector", async () => {
    const kb = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height * 0.7);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Kitchen", "inspector does not show the kitchen");
    assert((await page.locator("homeslice-panel svg.plan circle.vertex").count()) === 4, "kitchen should have 4 corner handles");
  });

  test("a rectangular room's size can be typed; the temperature sensor goes to the HA area", async () => {
    const before = await room("kitchen");
    const width = page.locator("homeslice-panel .inspector label", { hasText: "Width left–right" }).locator("input");
    await width.fill(String(before.rect[2] - 0.5));
    await width.dispatchEvent("change");
    assert(JSON.stringify((await room("kitchen")).rect) === JSON.stringify([before.rect[0], before.rect[1], before.rect[2] - 0.5, before.rect[3]]), `kitchen: ${JSON.stringify(await room("kitchen"))}`);
    await width.evaluate((el) => el.blur());
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await room("kitchen")) === JSON.stringify(before), "undo");
    const temp = page.locator("homeslice-panel .inspector label", { hasText: "Temperature sensor" }).locator("select");
    const options = await temp.locator("option").allTextContents();
    assert(options.length >= 2, `temperature options: ${options}`);
    await temp.selectOption({ index: 1 });
    const updates = await page.evaluate(() => window.panel.hass.areaUpdates);
    assert(updates.at(-1)?.area_id === "kitchen" && updates.at(-1).temperature_entity_id, `area update: ${JSON.stringify(updates)}`);
  });

  test("a shed apart from the house: its building's roof and walls in the room panel", async () => {
    const before = await model();
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      m.levels[0].rooms.push({ id: "shed", name: "Shed", rect: [12, 1, 3, 2] });
      window.panel.commit(m);
      window.panel._room = "shed";
    });
    await page.locator("homeslice-panel .inspector h4[data-building]").waitFor();
    await page.locator("homeslice-panel .inspector select[data-building-roof]").selectOption("gable");
    assert(JSON.stringify((await room("shed")).building) === JSON.stringify({ roof: "gable" }), `building: ${JSON.stringify((await room("shed")).building)}`);
    const thick = page.locator("homeslice-panel .inspector label", { hasText: "Wall thickness" }).locator("input");
    await thick.fill("0.12");
    await thick.dispatchEvent("change");
    assert((await room("shed")).building.thickness === 0.12, "thickness");
    // a carport: no walls, so no thickness to set
    await page.locator("homeslice-panel .inspector input[data-building-open]").check();
    assert((await room("shed")).building.open === true, "open");
    assert((await thick.count()) === 0, "thickness still shown for an open building");
    // a room of the house has no building section
    await page.evaluate(() => (window.panel._room = "kitchen"));
    await page.locator("homeslice-panel .inspector h2", { hasText: "Kitchen" }).waitFor();
    assert((await page.locator("homeslice-panel .inspector h4[data-building]").count()) === 0, "the kitchen is part of the house");
    await page.evaluate((m) => window.panel.commit(m), before);
  });

  test("with a room selected, a click on its inside wall selects the wall (a drag still moves the side)", async () => {
    await page.evaluate(() => (window.panel._room = "kitchen"));
    await page.waitForTimeout(150);
    const handle = page.locator('homeslice-panel svg.plan rect.edge-handle[data-at="[[3,4],[3,0]]"], homeslice-panel svg.plan rect.edge-handle[data-at="[[3,0],[3,4]]"]');
    const box = await handle.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const sel = await page.evaluate(() => ({ room: window.panel._room, wall: window.panel._wall }));
    assert(!sel.room && sel.wall && [sel.wall.a, sel.wall.b].sort().join() === "hall,kitchen", `selected: ${JSON.stringify(sel)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Wall", "no wall panel");
    assert((await page.locator("homeslice-panel svg.plan .wall-halo").count()) >= 1, "the selected wall isn't highlighted");
    await shot(page, "editor-wall-selected");
    // (the kitchen selected again for the next test)
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.panel._room = "kitchen"));
    await page.waitForTimeout(150);
  });

  test("a slanted inside wall is selected by a click and opened all along", async () => {
    const before = await model();
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      const rooms = m.levels[0].rooms;
      // the hall/kitchen wall slanted: from (3, 0) to (2.5, 4)
      rooms.find((r) => r.id === "hall").polygon = [[0, 0], [3, 0], [2.5, 4], [0, 4]];
      delete rooms.find((r) => r.id === "hall").rect;
      rooms.find((r) => r.id === "kitchen").polygon = [[3, 0], [8, 0], [8, 4], [2.5, 4]];
      delete rooms.find((r) => r.id === "kitchen").rect;
      window.panel.commit(m);
      window.panel.clearSelection();
    });
    await page.waitForTimeout(200);
    const [x, y] = await page.evaluate(() => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + 2.75 * v.scale + v.ox, r.top + 2 * v.scale + v.oy];
    });
    await page.mouse.click(x, y);
    const sel = await page.evaluate(() => window.panel._wall);
    assert(sel && [sel.a, sel.b].sort().join() === "hall,kitchen" && sel.side === null, `selected: ${JSON.stringify(sel)}`);
    await page.locator("homeslice-panel .inspector .segmented button", { hasText: "Open" }).click();
    const walls = (await model()).levels[0].walls ?? [];
    assert(walls.some((w) => w.between && w.between.includes("hall") && w.between.includes("kitchen") && !w.side && !w.type), `walls: ${JSON.stringify(walls)}`);
    await page.evaluate((m) => window.panel.commit(m), before);
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.panel._room = "kitchen"));
    await page.waitForTimeout(150);
  });

  test("a wall split by a corner: one half opened, the other stays", async () => {
    const before = await model();
    const toPage = (p) => page.evaluate(([x, y]) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return { x: r.left + x * v.scale + v.ox, y: r.top + y * v.scale + v.oy };
    }, p);
    // the hall/kitchen wall (x 3) split at y 2, as a double-click on it does
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      const k = m.levels[0].rooms.find((r) => r.id === "kitchen");
      k.polygon = [[3, 0], [8, 0], [8, 4], [3, 4], [3, 2]];
      delete k.rect;
      window.panel.commit(m);
      window.panel.clearSelection();
    });
    await page.waitForTimeout(150);
    const p = await toPage([3, 1]);
    await page.mouse.click(p.x, p.y);
    const sel = await page.evaluate(() => window.panel._wall);
    assert(sel && JSON.stringify(sel.line.map((q) => q.map((v) => Math.round(v * 100) / 100)).sort()) === "[[3,0],[3,2]]", `picked: ${JSON.stringify(sel)}`);
    await page.locator("homeslice-panel .inspector .segmented button", { hasText: "Open" }).click();
    const types = await page.evaluate(() => window.panel.levelWalls().filter((w) => w.rooms.includes("hall") && w.rooms.includes("kitchen")).map((w) => `${w.type}:${Math.round(Math.min(w.a[1], w.b[1]))}-${Math.round(Math.max(w.a[1], w.b[1]))}`).sort());
    assert(JSON.stringify(types) === '["interior:2-4","open:0-2"]', `walls: ${JSON.stringify(types)}`);
    await page.evaluate((m) => window.panel.commit(m), before);
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.panel._room = "kitchen"));
    await page.waitForTimeout(150);
  });

  test("dragging a shared wall moves both rooms; undo and redo", async () => {
    // the wall between hall (x 0–3) and kitchen (x 3–8)
    const handle = page.locator('homeslice-panel svg.plan rect.edge-handle[data-at="[[3,4],[3,0]]"], homeslice-panel svg.plan rect.edge-handle[data-at="[[3,0],[3,4]]"]');
    const box = await handle.boundingBox();
    assert(box, "no handle on the hall/kitchen wall");
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 5 + scale * 0.5, box.y + 5, { steps: 6 });
    const hint = await page.locator("homeslice-panel .hint").textContent();
    await page.mouse.up();
    assert(hint.includes("0.50 m right"), `drag readout: ${hint}`);
    assert(JSON.stringify((await room("kitchen")).rect) === "[3.5,0,4.5,4]", `kitchen: ${JSON.stringify(await room("kitchen"))}`);
    assert(JSON.stringify((await room("hall")).rect) === "[0,0,3.5,4]", `hall: ${JSON.stringify(await room("hall"))}`);
    assert(await page.locator("homeslice-panel button.save.dirty").count(), "not marked as unsaved");
    await shot(page, "editor-wall-moved");
    await page.keyboard.press("Control+z");
    assert(JSON.stringify((await room("kitchen")).rect) === "[3,0,5,4]", "undo did not restore the kitchen");
    await page.keyboard.press("Control+Shift+z");
    assert(JSON.stringify((await room("kitchen")).rect) === "[3.5,0,4.5,4]", "redo did not reapply the move");
  });

  test("double-click a wall: a corner where it was clicked; double-click the corner: gone again", async () => {
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const before = JSON.stringify(await room("kitchen"));
    // the kitchen selected, then its south wall (y 4) double-clicked at x 6
    const [cx, cy] = await toScreen([6, 2]);
    await page.mouse.click(cx, cy);
    const [x, y] = await toScreen([6, 4]);
    await page.mouse.dblclick(x, y);
    const points = (await room("kitchen")).polygon ?? [];
    assert(points.some(([px, py]) => Math.abs(px - 6) < 0.06 && Math.abs(py - 4) < 0.01), `kitchen: ${JSON.stringify(await room("kitchen"))}`);
    const [vx, vy] = await toScreen(points.find(([px, py]) => Math.abs(px - 6) < 0.06 && Math.abs(py - 4) < 0.01));
    await page.mouse.dblclick(vx, vy);
    const after = await room("kitchen");
    assert(!(after.polygon ?? []).some(([px, py]) => Math.abs(px - 6) < 0.06 && Math.abs(py - 4) < 0.01), `corner not removed: ${JSON.stringify(after)}`);
    // or: a corner clicked (selected), then Delete: its neighbours joined
    await page.mouse.dblclick(x, y);
    const again = ((await room("kitchen")).polygon ?? []).find(([px, py]) => Math.abs(px - 6) < 0.06 && Math.abs(py - 4) < 0.01);
    assert(again, "no corner added the second time");
    const [kx, ky] = await toScreen(again);
    await page.mouse.click(kx, ky);
    assert(await page.locator("homeslice-panel circle.vertex.selected").count(), "the corner is not selected");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Delete");
    const shape = (r) => JSON.stringify(r.rect ?? r.polygon);
    assert(shape(await room("kitchen")) === shape(JSON.parse(before)), `Delete did not remove the corner: ${JSON.stringify(await room("kitchen"))}`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await room("kitchen")) === before, `undo: ${JSON.stringify(await room("kitchen"))}`);
  });

  test("pressed again on the same spot: what lies under the selection is selected, round again", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // the hall's door, in its wall, in the hall
    const door = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan [data-opening]")].find((x) => JSON.parse(x.dataset.opening).room === "hall");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const picked = () => page.evaluate(() => window.panel.selectedKey());
    await page.mouse.click(door.x, door.y);
    const first = await picked();
    assert(first.startsWith("data-opening="), `first: ${first}`);
    await page.mouse.click(door.x, door.y);
    const second = await picked();
    assert(second && second !== first, `second: ${second}`);
    // round again, back to the top in the end
    const seen = new Set([first, second]);
    for (let i = 0; i < 4 && (await picked()) !== first; i++) {
      await page.mouse.click(door.x, door.y);
      seen.add(await picked());
    }
    assert((await picked()) === first && seen.size >= 2, `round: ${[...seen]}`);
    await page.keyboard.press("Escape");
  });

  test("a door dragged off its wall onto another one moves there, with its settings", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const before = JSON.stringify(await model());
    // clear of the hint bar at the plan's top
    await page.evaluate(() => (window.panel._view = { ...window.panel._view, oy: window.panel._view.oy + 160 }));
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const door = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan [data-opening]")].find((x) => JSON.parse(x.dataset.opening).room === "hall");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const hallDoor = (m) => m.levels[0].openings.find((o) => o.room === "hall" && o.type === "door");
    const was = hallDoor(await model());
    assert(was?.side === "north", `the hall's door: ${JSON.stringify(was)}`);
    // down onto the hall's south wall (to the living room), 1.5 m along
    const [tx, ty] = await toScreen([1.5, 4]);
    await page.mouse.move(door.x, door.y);
    await page.mouse.down();
    await page.mouse.move(door.x, (door.y + ty) / 2, { steps: 4 });
    await page.mouse.move(tx, ty, { steps: 6 });
    await page.mouse.up();
    const moved = (await model()).levels[0].openings.find((o) => o.type === "door" && (o.room === "hall" ? o.side === "south" : o.room === "living" && o.side === "north"));
    assert(moved && moved.width === was.width && Math.abs(moved.at + moved.width / 2 - 1.5) < 0.1, `moved: ${JSON.stringify((await model()).levels[0].openings)}`);
    assert(!(await model()).levels[0].openings.some((o) => o.room === "hall" && o.side === "north" && o.type === "door"), "the door is still on the north wall");
    // one step to undo
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await model()) === before, "undo did not put the door back");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.panel.fitView());
  });

  test("an inside wall with nothing on its other side can be selected too", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // the living room's wall along the empty space where the stairs are (x 5, y 4–6)
    const at = await page.evaluate(() => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + 4.95 * v.scale + v.ox, r.top + 5 * v.scale + v.oy];
    });
    await page.mouse.click(at[0], at[1]);
    const sel = await page.evaluate(() => window.panel._wall);
    assert(sel && sel.a === "living" && sel.b === "", `wall: ${JSON.stringify(sel)}`);
    assert((await page.locator("homeslice-panel .inspector").textContent()).includes("with nothing beside it"), "wall panel");
    await page.keyboard.press("Escape");
  });

  test("drawing a room and linking it to an area", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("r");
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const [x0, y0] = await toScreen([0.5, 5]);
    const [x1, y1] = await toScreen([2.5, 7]);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    const added = await room("room");
    assert(JSON.stringify(added?.rect) === "[0.5,5,2,2]", `new room: ${JSON.stringify(added)}`);
    await page.locator("homeslice-panel .inspector select").first().selectOption("garden");
    assert((await room("room")).area_id === "garden", "area not linked");
  });

  test("balconies come from the balcony tool; the room tool makes rooms, outside the house too", async () => {
    await page.keyboard.press("Escape");
    const level = await page.evaluate(() => window.panel._level);
    await page.evaluate(() => (window.panel._level = window.panel._model.levels[1].id));
    await page.keyboard.press("r");
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    // south of the house (its outline ends at 10 m): zoomed out so it shows, clear of the wall
    await page.evaluate(() => (window.panel._view = { ...window.panel._view, scale: window.panel._view.scale * 0.6 }));
    const [x0, y0] = await toScreen([1, 10.4]);
    const [x1, y1] = await toScreen([4, 11.8]);
    const roomsBefore = await page.evaluate(() => window.panel._model.levels[1].rooms.length);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    // the room tool, outside the house on an upper floor: still a room
    const roomOutside = await page.evaluate(() => window.panel._model.levels[1].rooms.at(-1));
    assert((await page.evaluate(() => window.panel._model.levels[1].rooms.length)) === roomsBefore + 1, "no room drawn");
    assert(roomOutside && (roomOutside.kind ?? "room") === "room" && !roomOutside.railing, `room outside: ${JSON.stringify(roomOutside)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("b");
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    const added = await page.evaluate(() => window.panel._model.levels[1].rooms.find((r) => r.id.startsWith("balcony")));
    assert(added?.kind === "outdoor" && added.railing === "metal", `balcony: ${JSON.stringify(added)}`);
    // no area yet: it says so instead of a made-up name
    assert(!added.name, `balcony named: ${JSON.stringify(added)}`);
    assert(await page.locator(`homeslice-panel g.unassigned[data-unassigned="${added.id}"]`).count(), "the balcony is not marked unassigned");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    // the balcony tool: a balcony wherever it is drawn (here inside the outline, as on a loggia)
    // one toolbar button for rooms, walls, railings and balconies: its sub-tools named over the plan
    await page.locator('homeslice-panel aside.tools button[data-group="build"]').click();
    const subs = await page.locator("homeslice-panel .sub-tools button").evaluateAll((els) => els.map((e) => `${e.querySelector("span").textContent} ${e.querySelector("kbd").textContent}`));
    assert(JSON.stringify(subs) === JSON.stringify(["Room R", "Wall W", "Railing G", "Balcony B", "Divider X", "Assign A"]), `sub-tools: ${JSON.stringify(subs)}`);
    await page.locator('homeslice-panel .sub-tools button[data-sub-tool="balcony"]').click();
    const hint = await page.locator("homeslice-panel .hint-bar").textContent();
    assert(hint.includes("Drag a rectangle for a balcony") && !hint.includes("editor."), `hint: ${hint}`);
    await shot(page, "editor-sub-tools");
    // the toolbar button now stands for the balcony
    assert((await page.locator('homeslice-panel aside.tools button[data-group="build"]').getAttribute("data-tool")) === "balcony", "group button");
    const drag = async (a, b) => {
      const [ax, ay] = await toScreen(a);
      const [bx, by] = await toScreen(b);
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      await page.mouse.move(bx, by, { steps: 8 });
      await page.mouse.up();
    };
    await drag([1.3, 1.3], [2.6, 2.6]);
    const loggia = await page.evaluate(() => window.panel._model.levels[1].rooms.at(-1));
    assert(loggia?.kind === "outdoor" && loggia.railing === "metal" && loggia.id.startsWith("balcony"), `loggia: ${JSON.stringify(loggia)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    // the railing sub-tool (G): a railing, not a wall
    await page.keyboard.press("g");
    await drag([1, 3], [3, 3]);
    const railing = await page.evaluate(() => window.panel._model.levels[1].walls?.at(-1));
    assert(railing?.type === "railing" && railing.thickness === undefined, `railing: ${JSON.stringify(railing)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    // the railing tool stays until Esc
    assert(await page.evaluate(() => window.panel._tool === "railing"), "the railing tool did not stay");
    await page.keyboard.press("Escape");
    await page.evaluate((id) => (window.panel._level = id), level);
  });

  test("the divider: a room cut in two with no wall between, the new part selected", async () => {
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const drag = async (a, b) => {
      const [ax, ay] = await toScreen(a);
      const [bx, by] = await toScreen(b);
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      await page.mouse.move(bx, by, { steps: 8 });
      await page.mouse.up();
    };
    const before = JSON.stringify(await model());
    await page.keyboard.press("Escape");
    await page.keyboard.press("x");
    // outside every room: nothing, and a word why
    await drag([8.8, 1], [8.8, 3]);
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("right across one room"), "no word on a missed divider");
    assert(JSON.stringify(await model()) === before, "a missed divider changed the house");
    await drag([6, 1], [6, 3]);
    const l = (await model()).levels[0];
    const parts = l.rooms.filter((r) => r.id === "kitchen" || r.id === "kitchen_2");
    assert(parts.length === 2 && parts.every((r) => r.rect), `parts: ${JSON.stringify(parts)}`);
    assert(l.walls.some((w) => JSON.stringify(w.between) === JSON.stringify(["kitchen", "kitchen_2"]) && !w.type), `walls: ${JSON.stringify(l.walls)}`);
    assert(await page.evaluate(() => window.panel._room === "kitchen_2"), "the new part is not selected");
    assert(await page.locator('homeslice-panel g.unassigned[data-unassigned="kitchen_2"]').count(), "the new part has no unassigned badge");
    // no wall is built between them
    const walls = await page.evaluate(() => window.panel.levelWalls().filter((w) => w.rooms?.includes?.("kitchen_2") && w.rooms?.includes?.("kitchen")).map((w) => w.type));
    assert(walls.length && walls.every((t) => t === "open"), `built walls: ${JSON.stringify(walls)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await model()) === before, "undo did not join the kitchen again");
    await page.keyboard.press("Escape");
    assert(await page.evaluate(() => window.panel._tool === "select"), "Esc did not leave the divider");
  });

  test("assign: an area dragged onto a room (lit up first), and tapped into a shape closed by walls", async () => {
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const before = JSON.stringify(await model());
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.panel._view = { ...window.panel._view, scale: window.panel._view.scale * 0.6 }));
    // four walls in the garden, east of the house, one after the other
    await page.keyboard.press("w");
    const corners = [[9.5, 1], [12, 1], [12, 3.5], [9.5, 3.5]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = await toScreen(corners[i]);
      const [bx, by] = await toScreen(corners[(i + 1) % 4]);
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      await page.mouse.move(bx, by, { steps: 6 });
      await page.mouse.up();
    }
    // the fourth wall closes the shape: it is a room at once, its walls the room's; it says it has no area
    const closed = (await model()).levels[0];
    const auto = closed.rooms.find((r) => JSON.stringify(r.rect) === "[9.5,1,2.5,2.5]");
    assert(auto && !auto.area_id, `no room completed: ${JSON.stringify(closed.rooms.map((r) => [r.id, r.rect]))}`);
    assert(!(closed.walls ?? []).some((w) => w.line), `the drawn walls stayed: ${JSON.stringify(closed.walls)}`);
    const badge = page.locator(`homeslice-panel g.unassigned[data-unassigned="${auto.id}"]`);
    await badge.waitFor({ timeout: 2000 });
    assert((await badge.textContent()).includes("Unassigned room!"), "badge text");
    await shot(page, "editor-unassigned-shape");
    const button = await badge.locator("[data-assign-open]").boundingBox();
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    assert(await page.evaluate(() => window.panel._tool === "assign"), "the badge did not open the assign tool");
    await page.keyboard.press("Escape");
    await page.keyboard.press("a");
    const areas = await page.locator("homeslice-panel .assign-areas button[data-area]").evaluateAll((els) => els.map((e) => [e.dataset.area, e.querySelector(".where").textContent]));
    assert(areas.length > 2, `areas: ${JSON.stringify(areas)}`);
    // this floor's areas first; the ones already placed greyed out, after the others
    const groups = await page.locator("homeslice-panel h4[data-assign-group]").evaluateAll((els) => els.map((e) => e.dataset.assignGroup));
    assert(groups[0] === "here", `groups: ${JSON.stringify(groups)}`);
    const here = await page.evaluate(() => {
      const floor = window.panel._model.levels.find((l) => l.id === window.panel._level).floor_id;
      return Object.values(window.panel._hass.areas).filter((a) => a.floor_id === floor).map((a) => a.area_id);
    });
    const firstBlock = await page.locator("homeslice-panel .assign-areas").first().locator("button[data-area]").evaluateAll((els) => els.map((e) => [e.dataset.area, e.classList.contains("placed")]));
    assert(firstBlock.every(([a]) => here.includes(a)), `first block: ${JSON.stringify(firstBlock)} vs ${JSON.stringify(here)}`);
    assert(JSON.stringify(firstBlock.map(([, p]) => p)) === JSON.stringify([...firstBlock.map(([, p]) => p)].sort()), `placed ones not last: ${JSON.stringify(firstBlock)}`);
    assert(!(await page.locator("homeslice-panel [data-assign-unlinked]").count()), "warned about a linked floor");
    // a level not linked to a Home Assistant floor: a warning, and the way to link it
    const linked = await page.evaluate(() => {
      const l = window.panel._model.levels.find((x) => x.id === window.panel._level);
      const id = l.floor_id;
      delete l.floor_id;
      l.name = "Annex";
      window.panel.requestUpdate();
      return id;
    });
    await page.locator("homeslice-panel [data-assign-unlinked]").waitFor({ timeout: 2000 });
    assert((await page.locator("homeslice-panel [data-assign-unlinked]").textContent()).includes("“Annex” isn't linked"), "warning text");
    await page.evaluate((id) => {
      const l = window.panel._model.levels.find((x) => x.id === window.panel._level);
      l.floor_id = id;
      delete l.name;
      window.panel.requestUpdate();
    }, linked);
    const unplaced = areas.filter(([, w]) => w === "not placed yet").map(([a]) => a);
    // dragged onto the hall: it lights up with the area's name, then the hall is that area
    const area = unplaced[0] ?? areas.at(-1)[0];
    const [hx, hy] = await toScreen([1.5, 2]);
    const over = await page.evaluate(([area, x, y]) => {
      const root = window.panel.shadowRoot;
      const dt = new DataTransfer();
      root.querySelector(`button[data-area="${area}"]`).dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
      const plan = root.querySelector("svg.plan");
      const ev = new DragEvent("dragover", { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y });
      plan.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, [area, hx, hy]);
    assert(over, "the plan refused the area");
    await page.locator('homeslice-panel g.assign-hover[data-assign-hover="hall"]').waitFor({ timeout: 2000 });
    await shot(page, "editor-assign-hover");
    await page.evaluate(([x, y]) => {
      const plan = window.panel.shadowRoot.querySelector("svg.plan");
      plan.dispatchEvent(new DragEvent("drop", { bubbles: true, composed: true, cancelable: true, dataTransfer: new DataTransfer(), clientX: x, clientY: y }));
    }, [hx, hy]);
    assert((await room("hall")).area_id === area, `hall: ${JSON.stringify(await room("hall"))}`);
    assert(!(await page.locator("homeslice-panel g.assign-hover").count()), "the highlight stays");
    // tapped: an area, then the room the four walls made
    const second = unplaced[1] ?? areas.at(-2)[0];
    await page.locator(`homeslice-panel .assign-areas button[data-area="${second}"]`).click();
    const [sx, sy] = await toScreen([10.7, 2.2]);
    await page.mouse.move(sx, sy);
    await page.locator(`homeslice-panel g.assign-hover[data-assign-hover="${auto.id}"]`).waitFor({ timeout: 2000 });
    await page.mouse.down();
    await page.mouse.up();
    const l = (await model()).levels[0];
    const made = l.rooms.find((r) => r.area_id === second);
    assert(made && JSON.stringify(made.rect) === "[9.5,1,2.5,2.5]", `new room: ${JSON.stringify(made)}`);
    assert(!(l.walls ?? []).some((w) => w.line), `the walls stayed: ${JSON.stringify(l.walls)}`);
    assert(!(await badge.count()), "the room is still unassigned");
    // a tap outside any shape: nothing, and why
    await page.locator(`homeslice-panel .assign-areas button[data-area="${second}"]`).click();
    const [ox, oy] = await toScreen([14, 8]);
    await page.mouse.click(ox, oy);
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("close it with walls first"), "no word on a missed tap");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // four walls, the room they completed, two areas given
    for (let i = 0; i < 7; i++) await page.keyboard.press("Control+z");
    assert(JSON.stringify(await model()) === before, `undo: ${JSON.stringify((await model()).levels[0])}`);
    await page.evaluate(() => window.panel.fitView());
  });

  test("walls drawn inside a room: the part they cut off is an unassigned room; an area carves it out", async () => {
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const before = JSON.stringify(await model());
    await page.keyboard.press("Escape");
    // clear of the hint bar at the plan's top
    await page.evaluate(() => (window.panel._view = { ...window.panel._view, oy: window.panel._view.oy + 160 }));
    await page.keyboard.press("w");
    // the kitchen's north-east corner (x 6–8, y 0–2) walled off
    for (const [a, b] of [[[6, 0], [6, 2]], [[6, 2], [8, 2]]]) {
      const [ax, ay] = await toScreen(a);
      const [bx, by] = await toScreen(b);
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      await page.mouse.move(bx, by, { steps: 6 });
      await page.mouse.up();
    }
    await page.keyboard.press("Escape");
    // the corner is a room at once, carved out of the kitchen, still without an area
    let l = (await model()).levels[0];
    const corner = l.rooms.find((r) => JSON.stringify(r.rect) === "[6,0,2,2]");
    assert(corner && !corner.area_id, `corner: ${JSON.stringify(l.rooms.map((r) => [r.id, r.rect ?? r.polygon]))}`);
    const badge = page.locator(`homeslice-panel g.unassigned[data-unassigned="${corner.id}"]`);
    await badge.waitFor({ timeout: 2000 });
    await shot(page, "editor-unassigned-in-room");
    const button = await badge.locator("[data-assign-open]").boundingBox();
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    const area = await page.evaluate(() => Object.keys(window.panel._hass.areas).find((a) => !window.panel._model.levels[0].rooms.some((r) => r.area_id === a)) ?? Object.keys(window.panel._hass.areas)[0]);
    await page.locator(`homeslice-panel .assign-areas button[data-area="${area}"]`).click();
    const [sx, sy] = await toScreen([7, 1]);
    await page.mouse.move(sx, sy);
    await page.locator(`homeslice-panel g.assign-hover[data-assign-hover="${corner.id}"]`).waitFor({ timeout: 2000 });
    await page.mouse.down();
    await page.mouse.up();
    l = (await model()).levels[0];
    const carved = l.rooms.find((r) => r.area_id === area && r.id !== "kitchen");
    const kitchen = l.rooms.find((r) => r.id === "kitchen");
    assert(carved && JSON.stringify(carved.rect) === "[6,0,2,2]", `carved: ${JSON.stringify(carved)}`);
    assert(kitchen.polygon?.some(([x, y]) => x === 6 && y === 2) && !kitchen.polygon.some(([x, y]) => x === 8 && y === 0), `kitchen: ${JSON.stringify(kitchen)}`);
    assert(!(l.walls ?? []).some((w) => w.line), `drawn walls stayed: ${JSON.stringify(l.walls)}`);
    assert(!(await badge.count()), "the corner is still unassigned");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
    assert(JSON.stringify(await model()) === before, "undo did not put the kitchen back");
    await page.evaluate(() => window.panel.fitView());
  });

  test("a closet walled off inside a room: a room of its own (a hole in the other), or the same room to Home Assistant", async () => {
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const before = JSON.stringify(await model());
    const living = JSON.stringify(await room("living"));
    await page.keyboard.press("Escape");
    await page.keyboard.press("w");
    const corners = [[1, 7], [2.5, 7], [2.5, 8.5], [1, 8.5]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = await toScreen(corners[i]);
      const [bx, by] = await toScreen(corners[(i + 1) % 4]);
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      await page.mouse.move(bx, by, { steps: 6 });
      await page.mouse.up();
    }
    await page.keyboard.press("Escape");
    const l = (await model()).levels[0];
    const closet = l.rooms.find((r) => JSON.stringify(r.rect) === "[1,7,1.5,1.5]");
    assert(closet && !closet.area_id, `closet: ${JSON.stringify(l.rooms.map((r) => [r.id, r.rect ?? r.polygon, r.area_id]))}`);
    assert(JSON.stringify(await room("living")) === living, `the living room changed: ${JSON.stringify(await room("living"))}`);
    assert(!(l.walls ?? []).some((w) => w.line), "the drawn walls stayed");
    // drawn over the living room, whose area leaves it out
    const order = await page.locator("homeslice-panel svg.plan g[data-room]").evaluateAll((els) => els.map((e) => e.dataset.room));
    assert(order.indexOf(closet.id) > order.indexOf("living"), `drawing order: ${order}`);
    // the same room to Home Assistant: one click
    await page.evaluate((id) => (window.panel._room = id), closet.id);
    const same = page.locator("homeslice-panel [data-same-room] button[data-same-as=living]");
    assert((await same.textContent()).includes("Same room as Living Room"), "no same-room button");
    await same.click();
    assert((await model()).levels[0].rooms.find((r) => r.id === closet.id).area_id === "living_room", "the closet did not get the living room's area");
    assert(!(await page.locator(`homeslice-panel g.unassigned[data-unassigned="${closet.id}"]`).count()), "still unassigned");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Escape");
    // the walls (one fewer where a wall was there already), the room they completed, the area
    for (let i = 0; i < 6 && JSON.stringify(await model()) !== before; i++) await page.keyboard.press("Control+z");
    assert(JSON.stringify(await model()) === before, "undo did not take the closet away");
  });

  test("a room drawn over others takes its space: the walls on its sides stay, the ones it covers go", async () => {
    const toScreen = (p) => page.evaluate((p) => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return [r.left + p[0] * v.scale + v.ox, r.top + p[1] * v.scale + v.oy];
    }, p);
    const before = JSON.stringify(await model());
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.panel._view = { ...window.panel._view, oy: window.panel._view.oy + 160 }));
    await page.keyboard.press("r");
    // over the meeting corner of hall and kitchen, its north side on the outside wall
    const [ax, ay] = await toScreen([2, 0]);
    const [bx, by] = await toScreen([5, 2]);
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(bx, by, { steps: 8 });
    await page.mouse.up();
    const l = (await model()).levels[0];
    const added = l.rooms.at(-1);
    assert(JSON.stringify(added.rect) === "[2,0,3,2]", `new room: ${JSON.stringify(added)}`);
    const hall = l.rooms.find((r) => r.id === "hall");
    const kitchen = l.rooms.find((r) => r.id === "kitchen");
    assert(hall.polygon && kitchen.polygon, `hall ${JSON.stringify(hall)}, kitchen ${JSON.stringify(kitchen)}`);
    // the hall's door on the north side, inside the new room's stretch, went with it
    const doors = l.openings.filter((o) => o.side === "north").map((o) => o.room);
    assert(doors.length >= 1, `openings: ${JSON.stringify(l.openings)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await model()) === before, "undo did not put the rooms back");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.panel.fitView());
  });

  test("saving stores the model in HA", async () => {
    await page.locator("homeslice-panel button.save").click();
    const saved = await page.evaluate(() => window.panel.hass.saved.length);
    assert(saved === 1, `${saved} saves`);
    assert((await page.locator("homeslice-panel button.save").textContent()).trim() === "Saved", "save button doesn't say Saved");
  });

  /** A spot on an outside wall that nothing else covers (doors and windows are clickable too). */
  const freeOutlineSpot = (westmost) =>
    page.evaluate((westmost) => {
      const root = window.panel.shadowRoot;
      const spots = [];
      for (const l of root.querySelectorAll("svg.plan line.wall-hit[data-outline]")) {
        const r = l.getBoundingClientRect();
        for (let t = 0.1; t < 0.95; t += 0.05) {
          const x = r.left + r.width * t;
          const y = r.top + r.height * t;
          const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => l[k].baseVal.value);
          const svg = root.querySelector("svg.plan").getBoundingClientRect();
          const px = svg.left + x1 + (x2 - x1) * t;
          const py = svg.top + y1 + (y2 - y1) * t;
          if (root.elementFromPoint(px, py) === l) spots.push({ x: px, y: py });
          void x;
          void y;
        }
      }
      return westmost ? spots.sort((a, b) => a.x - b.x)[0] : spots[0];
    }, westmost);

  test("outside walls: select the outline, moving the façade moves every floor", async () => {
    await page.keyboard.press("Escape");
    // the west wall's click zone
    const west = await freeOutlineSpot(true);
    await page.mouse.click(west.x, west.y);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Outside walls", "outline not selected");
    const handle = page.locator('homeslice-panel svg.plan rect.edge-handle[data-at="[[8,10],[0,10]]"]');
    const box = await handle.boundingBox();
    assert(box, "no handle on the south façade");
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 5, box.y + 5 + scale * 0.5, { steps: 6 });
    await page.mouse.up();
    const m = await model();
    assert(JSON.stringify(m.outline) === '{"rect":[0,0,8,10.5]}', `outline: ${JSON.stringify(m.outline)}`);
    const kids = m.levels[1].rooms.find((r) => r.id === "kids");
    assert(JSON.stringify(kids.rect) === "[0,6,8,4.5]", `first floor didn't follow: ${JSON.stringify(kids)}`);
    await page.keyboard.press("Control+z");
  });

  test("a wall between two rooms can be opened on one side", async () => {
    await page.keyboard.press("Escape");
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-wall]")].find((x) => {
        const w = JSON.parse(x.dataset.wall);
        return [w.a, w.b].sort().join() === "kitchen,living";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, wall: JSON.parse(l.dataset.wall) };
    });
    await page.mouse.click(hit.x, hit.y);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Wall", "wall not selected");
    await page.locator("homeslice-panel .segmented button", { hasText: "Open" }).click();
    const walls = (await model()).levels[0].walls;
    assert(JSON.stringify(walls) === JSON.stringify([{ between: [hit.wall.a, hit.wall.b] }]) || walls?.length === 1, `walls: ${JSON.stringify(walls)}`);
    await page.waitForTimeout(300);
    assert(await page.locator("homeslice-panel svg.plan line.wall.open").count(), "open boundary not drawn dashed");
    await shot(page, "editor-open-wall");
    await page.keyboard.press("Control+z");
  });

  const toPage = (p) =>
    page.evaluate(([x, y]) => {
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      const v = window.panel._view;
      return { x: r.left + x * v.scale + v.ox, y: r.top + y * v.scale + v.oy };
    }, p);
  const typeInto = async (label, value) => {
    const input = page.locator("homeslice-panel .inspector label", { hasText: label }).locator("input");
    await input.fill(String(value));
    await input.dispatchEvent("change");
  };

  test("lengths: every room shows its inside lengths; typing one moves the wall", async () => {
    await page.keyboard.press("Escape");
    const dims = await page.locator("homeslice-panel svg.plan text.room-dim").allTextContents();
    // the hall inside its walls: half the 0.36 m outside wall, half the 0.12 m inside wall
    const hallWidth = (await room("hall")).rect[2];
    const inside = (hallWidth - 0.24).toFixed(2);
    assert(dims.length > 8 && dims.includes(inside), `lengths: ${dims.join(", ")} (hall ${inside})`);
    // the house's outside size along its north and west sides: 8 × 10 m on the wall centres,
    // plus half of each wall (the party wall east 0.24 m, the others 0.36 m)
    const overall = await page.locator("homeslice-panel svg.plan .overall-dims text").allTextContents();
    assert(JSON.stringify(overall) === '["8.30 m","10.36 m"]', `overall: ${overall}`);
    const toggle = page.locator('homeslice-panel aside.tools button[aria-label="Show lengths"]');
    await toggle.click();
    assert((await page.locator("homeslice-panel svg.plan text.room-dim").count()) === 0, "lengths not hidden");
    await toggle.click();
    const hb = await page.locator('homeslice-panel svg.plan g[data-room="hall"] polygon').boundingBox();
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height * 0.75);
    const kitchen = await room("kitchen");
    await page.locator("homeslice-panel svg.plan text.dim.editable", { hasText: inside }).first().click();
    const input = page.locator("homeslice-panel svg.plan input.dim-input");
    assert(await input.isVisible(), "no field to type the length");
    await input.fill((Number(inside) + 0.2).toFixed(2));
    await input.press("Enter");
    const hall = await room("hall");
    assert(Math.abs(hall.rect[2] - (hallWidth + 0.2)) < 1e-6, `hall: ${JSON.stringify(hall)}`);
    assert(Math.abs((await room("kitchen")).rect[2] - (kitchen.rect[2] - 0.2)) < 1e-6, "the kitchen did not follow the wall");
    await shot(page, "editor-lengths");
    await page.keyboard.press("Control+z");
  });

  test("doors & windows: the distances to the corners and the width can be typed", async () => {
    await page.locator('homeslice-panel aside.tools button[data-group="openings"]').click();
    await page.locator('homeslice-panel .sub-tools button[data-sub-tool="opening"]').click();
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.opening-hit")].find((x) => JSON.parse(x.dataset.opening).room === "hall");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    const dims = await page.locator("homeslice-panel svg.plan g.opening-dims text").allTextContents();
    // the hall door: 1 m from the room's west end (0.18 m of it is half the outside wall), 1 m wide
    const rest = ((await room("hall")).rect[2] - 0.06 - 2).toFixed(2);
    assert(JSON.stringify(dims) === JSON.stringify(["0.82", "1.00", rest]), `door distances: ${dims.join(", ")} (expected …, ${rest})`);
    await page.locator("homeslice-panel svg.plan g.opening-dims text", { hasText: rest }).click();
    const input = page.locator("homeslice-panel svg.plan input.dim-input");
    await input.fill("0.5");
    await input.press("Enter");
    const door = (await model()).levels[0].openings.find((o) => o.room === "hall");
    assert(Math.abs(door.at - (1 + Number(rest) - 0.5)) < 1e-6 && door.width === 1, `door: ${JSON.stringify(door)}`);
    await shot(page, "editor-opening-lengths");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  test("doors & windows: a blind that reports the other way round can be marked inverted", async () => {
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.opening-hit")].find((x) => JSON.parse(x.dataset.opening).room === "kitchen");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "Inverted" }).locator("input").check();
    assert(JSON.stringify((await model()).inverted_covers) === '["cover.kitchen"]', `inverted: ${JSON.stringify((await model()).inverted_covers)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(!(await model()).inverted_covers, "undo did not clear it");
    await page.keyboard.press("Escape");
  });

  test("doors & windows: an outside window can be repeated on the floor above", async () => {
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.opening-hit")].find((x) => {
        const o = JSON.parse(x.dataset.opening);
        return o.room === "kitchen";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "First Floor" }).locator("input").check();
    const m = await model();
    // the kitchen's north window at 1.5 m from its west end, counted from the house's corner now
    const at = (await room("kitchen")).rect[0] + 1.5;
    assert(m.facade_openings?.some((f) => f.side === "north" && f.at === at && JSON.stringify(f.levels) === '["ground","first"]' && f.covers?.ground === "cover.kitchen"), `facade: ${JSON.stringify(m.facade_openings)}`);
    assert((await page.locator("homeslice-panel .inspector").textContent()).includes("Stacked on several levels"), "not shown as stacked");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(!(await model()).facade_openings?.some((f) => f.at === at), "undo did not restore it");
    await page.keyboard.press("Escape");
  });

  test("checklist: a new blind is offered for the right window and linked in one click", async () => {
    await page.evaluate(() => {
      const h = window.panel.hass;
      window.panel.hass = {
        ...h,
        entities: { ...h.entities, "cover.living_west": { entity_id: "cover.living_west", area_id: "living_room" } },
        states: { ...h.states, "cover.living_west": { entity_id: "cover.living_west", state: "open", attributes: { device_class: "blind", friendly_name: "Living West" } } },
      };
    });
    await page.waitForTimeout(1200); // the editor follows HA once a second
    await page.locator("homeslice-panel header button.checklist-button").click();
    const item = page.locator("homeslice-panel .inspector ul.checklist li", { hasText: "Living West" });
    assert((await item.textContent()).includes("left window of Living Room"), `item: ${await item.textContent()}`);
    await shot(page, "editor-checklist");
    await item.locator("button", { hasText: "Link" }).click();
    const west = (await model()).levels[0].openings.find((o) => o.room === "living" && o.side === "west");
    assert(west?.cover === "cover.living_west", `west window: ${JSON.stringify(west)}`);
    assert(!(await page.locator("homeslice-panel .inspector ul.checklist li", { hasText: "Living West" }).count()), "still listed");
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel header button.checklist-button").click();
    await page.keyboard.press("Escape");
  });

  test("doors & windows library: pick a double door, add it to a wall, see how it opens; change its kind", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="openings"]').click();
    await page.locator('homeslice-panel .sub-tools button[data-sub-tool="opening"]').click();
    await page.locator('homeslice-panel .inspector .library button[data-preset="door_double"]').click();
    // the wall between hall and kitchen
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-addwall]")].find((x) => JSON.parse(x.dataset.addwall).rooms.sort().join() === "hall,kitchen");
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    const added = () => model().then((m) => m.levels[0].openings.at(-1));
    let o = await added();
    assert(o.type === "door" && o.style === "double" && o.width === 1.6, `added: ${JSON.stringify(o)}`);
    // a double door swings with two leaves
    assert((await page.locator("homeslice-panel svg.plan polyline.swing").count()) >= 2, "no swing arcs");
    await shot(page, "editor-door-double");
    await page.locator("homeslice-panel .inspector button", { hasText: "Opens inwards" }).click();
    assert((await added()).swing === "out", "swing not changed");
    await page.locator('homeslice-panel .inspector .opening-kinds button[data-preset="opening_arch"]').click();
    o = await added();
    assert(o.type === "opening" && o.style === "arch" && o.width === 1.2, `arch: ${JSON.stringify(o)}`);
    // dragging a sliding door onto a wall (the library shows when nothing is selected)
    await page.keyboard.press("Escape");
    const drop = await page.evaluate((hit) => {
      const root = window.panel.shadowRoot;
      const dt = new DataTransfer();
      root.querySelector('.library button[data-preset="door_sliding"]').dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
      const plan = root.querySelector("svg.plan");
      const at = { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: hit.x, clientY: hit.y + 50 };
      const over = new DragEvent("dragover", at);
      plan.dispatchEvent(over);
      plan.dispatchEvent(new DragEvent("drop", at));
      return over.defaultPrevented;
    }, hit);
    assert(drop, "drop refused");
    o = await added();
    assert(o.type === "door" && o.style === "sliding", `dropped: ${JSON.stringify(o)}`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  test("doors & windows: house-wide defaults for sill and height", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="openings"]').click();
    await page.locator('homeslice-panel .sub-tools button[data-sub-tool="opening"]').click();
    const sill = page.locator('homeslice-panel .inspector input[aria-label="Window Sill (m)"]');
    await sill.fill("0");
    await sill.dispatchEvent("change");
    assert((await model()).opening_defaults?.window?.sill === 0, `defaults: ${JSON.stringify((await model()).opening_defaults)}`);
    await page.keyboard.press("Control+z");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
  });

  test("measuring between two points", async () => {
    await page.keyboard.press("m");
    const a = await toPage([1, 7]);
    const b = await toPage([4, 7]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    const label = await page.locator("homeslice-panel svg.plan g.measure text").textContent();
    assert(label === "3.00 m", `measured: ${label}`);
    await shot(page, "editor-measure");
    await page.keyboard.press("Escape");
    assert((await page.locator("homeslice-panel svg.plan g.measure").count()) === 0, "measurement not cleared");
  });

  test("a section: drawn across the house, its view turned, deleted", async () => {
    await page.keyboard.press("c");
    const a = await toPage([-1, 5]);
    const b = await toPage([9, 5]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    const drawn = (await model()).sections;
    assert(drawn?.length === 1 && drawn[0].look === "north" && drawn[0].line[0][1] === drawn[0].line[1][1], `sections: ${JSON.stringify(drawn)}`);
    assert((await page.locator("homeslice-panel svg.plan g.section-line").count()) === 1, "not on the plan");
    // its end dragged further east (snapping to the grid)
    const end = await page.locator("homeslice-panel circle.section-end[data-section-end='1']").boundingBox();
    const to = await toPage([10, 5]);
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const moved = (await model()).sections[0].line;
    assert(Math.abs(moved[1][0] - 10) < 0.15 && moved[0][0] === drawn[0].line[0][0], `line: ${JSON.stringify(moved)}`);
    await page.locator("homeslice-panel .inspector select[data-section-look]").selectOption("south");
    assert((await model()).sections[0].look === "south", "look");
    // the 3D preview shows the cut while the section is selected
    await page.waitForFunction(() => window.panel.renderer.renderer.clippingPlanes.length === 1);
    await page.waitForTimeout(300);
    await shot(page, "editor-section");
    await page.locator("homeslice-panel .inspector button[data-section-delete]").click();
    assert(!(await model()).sections, "not deleted");
    await page.waitForFunction(() => window.panel.renderer.renderer.clippingPlanes.length === 0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("a free-standing wall: draw, change its thickness, delete", async () => {
    await page.keyboard.press("w");
    const a = await toPage([1, 8]);
    const b = await toPage([3.5, 8.05]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    const walls = () => model().then((m) => m.levels[0].walls ?? []);
    const drawn = (await walls()).find((w) => w.line);
    // nearly horizontal becomes horizontal
    assert(drawn && drawn.line[0][1] === drawn.line[1][1] && Math.abs(drawn.line[1][0] - drawn.line[0][0] - 2.5) < 0.06, `wall: ${JSON.stringify(drawn)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Free-standing wall", "free wall not selected");
    // the tool stays: the next wall starts on this one's end (pressed a little off it, snapped onto it)
    assert(await page.evaluate(() => window.panel._tool === "wall"), "the wall tool did not stay");
    const end = await toPage(drawn.line[1]);
    // ending 4 cm short of the outside wall: it lands on the wall (the grid alone would give 9.95)
    const c = await toPage([drawn.line[1][0], 9.96]);
    await page.mouse.move(end.x + 4, end.y + 3);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y, { steps: 6 });
    await page.mouse.up();
    const second = (await walls()).filter((w) => w.line)[1];
    assert(second && JSON.stringify(second.line[0]) === JSON.stringify(drawn.line[1]), `second wall: ${JSON.stringify(await walls())}`);
    assert(second.line[1][1] === 10, `second wall's end not on the outside wall: ${JSON.stringify(second.line)}`);
    assert(JSON.stringify((await walls()).find((w) => w.line).line) === JSON.stringify(drawn.line), "the first wall moved");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    assert(await page.evaluate(() => window.panel._tool === "select"), "Esc did not leave the wall tool");
    // with Select: dragged by its middle, the whole wall moves (in 5 cm steps), same length
    const mid = await toPage([(drawn.line[0][0] + drawn.line[1][0]) / 2, drawn.line[0][1]]);
    const to = await toPage([(drawn.line[0][0] + drawn.line[1][0]) / 2 + 0.52, drawn.line[0][1] + 1.01]);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const movedLine = (await walls()).find((w) => w.line).line;
    const off = (i, k) => Math.round((movedLine[i][k] - drawn.line[i][k]) * 100) / 100;
    assert(off(0, 0) === 0.5 && off(1, 0) === 0.5 && off(0, 1) === 1 && off(1, 1) === 1, `moved: ${JSON.stringify(movedLine)} from ${JSON.stringify(drawn.line)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    assert(JSON.stringify((await walls()).find((w) => w.line).line) === JSON.stringify(drawn.line), "undo did not put the wall back");
    await page.evaluate(() => (window.panel._freeWall = window.panel._model.levels[0].walls.findIndex((w) => w.line)));
    await typeInto("Thickness (cm)", 8);
    assert((await walls()).find((w) => w.line)?.thickness === 0.08, `thickness: ${JSON.stringify(await walls())}`);
    await shot(page, "editor-free-wall");
    // the same line as a glass railing: no thickness, still selected
    await page.locator("homeslice-panel .inspector select[data-free-kind]").selectOption("railing");
    await page.locator("homeslice-panel .inspector label", { hasText: "Railing (balcony)" }).locator("select").selectOption("glass");
    const railing = (await walls()).find((w) => w.line);
    assert(railing.type === "railing" && railing.railing === "glass" && railing.thickness === undefined, `railing: ${JSON.stringify(railing)}`);
    assert(await page.locator("homeslice-panel svg.plan line.railing-line").count(), "railing not drawn on the plan");
    await page.locator("homeslice-panel .inspector button", { hasText: "Delete wall" }).click();
    assert(!(await walls()).some((w) => w.line), "free wall not deleted");
  });

  test("a wall drawn by finger snaps to 45°, with a magnifier while dragging", async () => {
    await page.keyboard.press("w");
    const a = await toPage([1, 8]);
    const b = await toPage([2.97, 9.93]);
    const touch = (type, p) =>
      page.evaluate(
        ([type, x, y]) => {
          const svg = document.querySelector("homeslice-panel").shadowRoot.querySelector("svg.plan");
          const target = document.querySelector("homeslice-panel").shadowRoot.elementFromPoint(x, y) ?? svg;
          target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, composed: true }));
        },
        [type, p.x, p.y],
      );
    await touch("pointerdown", a);
    for (let i = 1; i <= 6; i++) await touch("pointermove", { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
    assert((await page.locator("homeslice-panel .loupe").count()) === 1, "no magnifier while dragging");
    await shot(page, "editor-loupe");
    await touch("pointerup", b);
    assert((await page.locator("homeslice-panel .loupe").count()) === 0, "magnifier not hidden");
    const drawn = (await model()).levels[0].walls?.find((w) => w.line);
    const [[x0, y0], [x1, y1]] = drawn.line;
    assert(Math.abs(x1 - x0 - (y1 - y0)) < 1e-6 && Math.abs(x1 - x0 - 2) < 0.06, `wall: ${JSON.stringify(drawn)}`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  test("the compass points to real north and opens the building settings", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const needle = () => page.locator("homeslice-panel .compass g").getAttribute("style");
    assert((await needle()).includes("rotate(0deg)"), `needle: ${await needle()}`);
    await page.locator("homeslice-panel .compass").click();
    const north = page.locator("homeslice-panel .inspector label", { hasText: "Real north" }).locator("input");
    await north.fill("30");
    await north.dispatchEvent("change");
    assert((await needle()).includes("rotate(-30deg)"), `turned needle: ${await needle()}`);
    assert((await page.evaluate(() => window.panel._model.north)) === 30, "north not saved in the house");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  test("building settings: wall thickness, neighbours, floor slab, one wall's own thickness", async () => {
    await page.keyboard.press("Escape");
    const outer = await freeOutlineSpot(false);
    await page.mouse.click(outer.x, outer.y);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Outside walls", "outline not selected");
    await typeInto("Outside (cm)", 42);
    assert((await model()).walls?.exterior === 0.42, `walls: ${JSON.stringify((await model()).walls)}`);
    await page.locator("homeslice-panel .inspector label.check", { hasText: "left" }).locator("input").check();
    assert(JSON.stringify((await model()).party_walls) === JSON.stringify(["east", "west"]), `party: ${JSON.stringify((await model()).party_walls)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    assert(!(await model()).walls && JSON.stringify((await model()).party_walls) === JSON.stringify(["east"]), `undo did not restore the walls: ${JSON.stringify((await model()).walls)} ${JSON.stringify((await model()).party_walls)}`);
    await page.keyboard.press("Escape");
    await typeInto("Floor slab (cm)", 30);
    assert((await model()).levels[0].slab === 0.3, `slab: ${(await model()).levels[0].slab}`);
    await page.keyboard.press("Control+z");
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-wall]")].find((x) => {
        const w = JSON.parse(x.dataset.wall);
        return [w.a, w.b].sort().join() === "hall,kitchen";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(hit.x, hit.y);
    await typeInto("Thickness (cm)", 24);
    const own = (await model()).levels[0].walls?.find((w) => w.thickness);
    assert(own?.thickness === 0.24 && own.type === "wall", `wall: ${JSON.stringify((await model()).levels[0].walls)}`);
    const dims = await page.locator("homeslice-panel svg.plan text.room-dim").allTextContents();
    // the hall loses another 6 cm to the thicker wall
    const thinner = ((await room("hall")).rect[2] - 0.18 - 0.12).toFixed(2);
    assert(dims.includes(thinner), `hall after the thicker wall: ${dims.join(", ")} (expected ${thinner})`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    assert(errors.length === 0, errors.join(" | "));
  });

  test("dragging one wall piece moves only that piece; the longer room side gets a step", async () => {
    await page.keyboard.press("Escape");
    // hall | living runs along y = 4 from x 0 to the hall's width; living's side goes on to x 5
    const hallBefore = await room("hall");
    const kitchenBefore = await room("kitchen");
    const hit = await page.evaluate(() => {
      const l = [...window.panel.shadowRoot.querySelectorAll("svg.plan line.wall-hit[data-wall]")].find((x) => {
        const w = JSON.parse(x.dataset.wall);
        return [w.a, w.b].sort().join() === "hall,living";
      });
      const r = l.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(hit.x, hit.y);
    await page.mouse.down();
    await page.mouse.move(hit.x, hit.y + scale * 0.5, { steps: 6 });
    const hint = await page.locator("homeslice-panel .hint").textContent();
    await page.mouse.up();
    assert(hint.includes("0.50 m down"), `drag readout: ${hint}`);
    const [, , hw] = hallBefore.rect;
    assert(JSON.stringify((await room("hall")).rect) === JSON.stringify([0, 0, hw, 4.5]), `hall: ${JSON.stringify(await room("hall"))}`);
    assert(JSON.stringify(await room("kitchen")) === JSON.stringify(kitchenBefore), `kitchen moved: ${JSON.stringify(await room("kitchen"))}`);
    const living = (await room("living")).polygon;
    assert(JSON.stringify(living) === JSON.stringify([[0, 4.5], [hw, 4.5], [hw, 4], [5, 4], [5, 6], [8, 6], [8, 10], [0, 10]]), `living: ${JSON.stringify(living)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Wall", "the dragged wall is not selected");
    await shot(page, "editor-wall-piece");
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await room("hall")) === JSON.stringify(hallBefore), "undo did not restore the hall");
  });

  test("levels can be reordered by drag and drop", async () => {
    const first = await page.locator("homeslice-panel button.level", { hasText: "First Floor" }).boundingBox();
    const ground = await page.locator("homeslice-panel button.level", { hasText: "Ground Floor" }).boundingBox();
    await page.mouse.move(first.x + 20, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 20, ground.y + ground.height / 2, { steps: 8 });
    // mid-drag: the ground floor has slid up to make room
    const slid = await page.locator("homeslice-panel button.level", { hasText: "Ground Floor" }).evaluate((b) => b.style.transform);
    assert(slid.includes("-"), `ground floor didn't slide aside: ${slid}`);
    await page.mouse.up();
    assert(JSON.stringify((await model()).levels.map((l) => l.id)) === '["first","ground"]', `order: ${JSON.stringify((await model()).levels.map((l) => l.id))}`);
    await page.keyboard.press("Control+z");
    assert(JSON.stringify((await model()).levels.map((l) => l.id)) === '["ground","first"]', "undo didn't restore the order");
  });

  test("assigning a level's HA floor is an edit that can be saved", async () => {
    await page.keyboard.press("Escape");
    const select = page.locator("homeslice-panel .inspector select").first();
    await select.selectOption("first_floor");
    assert((await model()).levels[0].floor_id === "first_floor", "floor not assigned");
    await page.locator("homeslice-panel button.save").click();
    const saved = await page.evaluate(() => window.panel.hass.saved.at(-1).levels[0].floor_id);
    assert(saved === "first_floor", `saved floor: ${saved}`);
    await select.selectOption("ground_floor");
  });

  test("doors & windows: click a wall to add a window, drag it, link a blind, delete it", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="openings"]').click();
    await page.locator('homeslice-panel .sub-tools button[data-sub-tool="opening"]').click();
    await page.locator('homeslice-panel .inspector .library button[data-preset="window"]').click();
    const before = (await model()).levels[0].openings.length;
    // a free stretch of the kitchen's north wall (x = 6.8; an earlier step moved the kitchen to x = 3.5 … 8)
    const at = await page.evaluate(() => {
      const v = window.panel._view;
      const r = window.panel.shadowRoot.querySelector("svg.plan").getBoundingClientRect();
      return { x: r.left + 6.8 * v.scale + v.ox, y: r.top + 0.12 * v.scale + v.oy };
    });
    await page.mouse.click(at.x, at.y);
    let openings = (await model()).levels[0].openings;
    assert(openings.length === before + 1, `no window added (${openings.length})`);
    const added = openings.at(-1);
    assert(added.room === "kitchen" && added.side === "north" && added.at === 2.8 && added.width === 1, `added: ${JSON.stringify(added)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Window", "opening inspector not shown");

    const hit = await page.locator("homeslice-panel svg.plan line.opening.selected").boundingBox();
    const scale = await page.evaluate(() => window.panel._view.scale);
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit.x + hit.width / 2 + scale * 0.5, hit.y + hit.height / 2, { steps: 6 });
    await page.mouse.up();
    assert((await model()).levels[0].openings.at(-1).at === 3.3, `after dragging: ${JSON.stringify((await model()).levels[0].openings.at(-1))}`);

    // pulled close to the kitchen's centre (x 3.5 … 8 → 5.75), it snaps there and shows a guide
    const hit2 = await page.locator("homeslice-panel svg.plan line.opening.selected").boundingBox();
    await page.mouse.move(hit2.x + hit2.width / 2, hit2.y + hit2.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit2.x + hit2.width / 2 - scale * 1.53, hit2.y + hit2.height / 2, { steps: 8 });
    const guides = await page.locator("homeslice-panel svg.plan line.guide").count();
    await shot(page, "editor-snap-guide");
    await page.mouse.up();
    assert(guides === 1, `${guides} guide lines while snapped`);
    assert((await model()).levels[0].openings.at(-1).at === 1.75, `not centred: ${JSON.stringify((await model()).levels[0].openings.at(-1))}`);

    const coverSelect = page.locator("homeslice-panel .inspector label", { hasText: /^\s*Blind/ }).locator("select");
    const options = await coverSelect.locator("option").allTextContents();
    assert(options[1].startsWith("★"), `the kitchen's own blind should come first: ${options.join(" | ")}`);
    await coverSelect.selectOption("cover.kitchen");
    assert((await model()).levels[0].openings.at(-1).cover === "cover.kitchen", "blind not linked");
    await shot(page, "editor-opening");

    await page.keyboard.press("Delete");
    assert((await model()).levels[0].openings.length === before, "window not deleted");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
  });

  test("stairs: select, move, change shape, draw new ones and delete them", async () => {
    await page.keyboard.press("Escape");
    const stair = () => page.evaluate(() => window.panel._model.vertical.find((v) => v.id === "stairs"));
    const before = await stair();
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    const { scale, ox, oy } = await page.evaluate(() => window.panel._view);
    const at = (x, y) => [plan.x + ox + x * scale, plan.y + oy + y * scale];
    const [cx, cy] = [before.rect[0] + before.rect[2] / 2, before.rect[1] + before.rect[3] / 2];
    await page.mouse.move(...at(cx, cy));
    await page.mouse.down();
    await page.mouse.move(...at(cx - 0.5, cy), { steps: 6 });
    await page.mouse.up();
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Stairs", "stairs not selected");
    const moved = await stair();
    assert(Math.abs(moved.rect[0] - (before.rect[0] - 0.5)) < 0.06 && moved.rect[1] === before.rect[1], `moved: ${JSON.stringify(moved.rect)}`);
    // two quarter turns: a U, its start side set; winders instead of a landing
    await page.locator("homeslice-panel .inspector select[data-stair-turns]").selectOption("2");
    assert((await stair()).turns === 2 && (await stair()).start, `turns: ${JSON.stringify(await stair())}`);
    await page.locator("homeslice-panel .inspector select[data-stair-turn]").selectOption("winders");
    assert((await stair()).turn === "winders", `turn: ${JSON.stringify(await stair())}`);
    await shot(page, "editor-stairs");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    assert(JSON.stringify(await stair()) === JSON.stringify(before), "undo didn't restore the stairs");

    await page.keyboard.press("Escape");
    await page.keyboard.press("s");
    await page.mouse.move(...at(0.5, 5));
    await page.mouse.down();
    await page.mouse.move(...at(1.5, 8), { steps: 5 });
    await page.mouse.up();
    const added = await page.evaluate(() => window.panel._model.vertical.at(-1));
    assert(added.id === "stairs_2" && added.from === "ground" && added.to === "first" && added.up === "south", `added: ${JSON.stringify(added)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Stairs", "new stairs not selected");
    await page.keyboard.press("Delete");
    assert((await page.evaluate(() => window.panel._model.vertical.length)) === 1, "stairs not deleted");
    assert(errors.length === 0, errors.join(" | "));
  });

  test("objects mode: lights are placed automatically and can be dragged into another room", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    const markers = page.locator("homeslice-panel svg.plan g.lamp-marker");
    assert((await markers.count()) >= 3, `lamp markers: ${await markers.count()}`);
    assert((await page.locator("homeslice-panel svg.plan g.lamp-marker.placed").count()) === 0, "nothing is placed yet");
    const reading = page.locator('homeslice-panel svg.plan g.lamp-marker[data-light*="reading_lamp"] circle').first();
    const box = await reading.boundingBox();
    const kitchen = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(kitchen.x + kitchen.width * 0.3, kitchen.y + kitchen.height * 0.4, { steps: 8 });
    const hint = await page.locator("homeslice-panel .hint").textContent();
    await page.mouse.up();
    assert(hint.includes("Reading lamp") && hint.includes("Kitchen"), `hint: ${hint}`);
    const k = await room("kitchen");
    assert(k.lights?.[0]?.entity === "light.reading_lamp" && k.lights[0].at, `kitchen lights: ${JSON.stringify(k.lights)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Kitchen", "kitchen not selected");
    await shot(page, "editor-lights");
    // back to automatic: it stays in the kitchen, spread with the kitchen's own light
    await page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Reading lamp" }).locator("button", { hasText: "Auto" }).click();
    assert(JSON.stringify((await room("kitchen")).lights) === '[{"entity":"light.reading_lamp"}]', `after auto: ${JSON.stringify((await room("kitchen")).lights)}`);
    // removing it sends it back to its own area's room
    await page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Reading lamp" }).locator("button", { hasText: "Remove" }).click();
    assert(!(await room("kitchen")).lights, "kitchen still lists the lamp");
    // hiding an area light
    await page.locator("homeslice-panel .inspector ul.lights li").first().locator("button", { hasText: "Hide" }).click();
    assert((await room("kitchen")).lights?.[0]?.hidden === true, "not hidden");
    await page.locator("homeslice-panel .inspector ul.lights li.hidden button").click();
    assert(!(await room("kitchen")).lights, "hidden entry not removed by Show");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  test("objects mode: add furniture, drag it into another room, turn and delete it", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    const kb = await page.locator('homeslice-panel svg.plan g[data-room="kitchen"] polygon').boundingBox();
    await page.mouse.click(kb.x + kb.width * 0.8, kb.y + kb.height * 0.85);
    // the room's inspector offers furniture: the furniture tool's library, for this room
    await page.locator("homeslice-panel .inspector button", { hasText: "Add furniture" }).click();
    await librarySource(page, "builtin");
    // a group folds shut and open again
    const head = page.locator("homeslice-panel .inspector h4.group-head button").first();
    const shown = async () => page.locator("homeslice-panel .inspector .library").count();
    const before = await shown();
    await head.click();
    assert((await shown()) === before - 1 && (await head.getAttribute("aria-expanded")) === "false", "group not folded");
    await head.click();
    assert((await shown()) === before, "group not unfolded");
    await page.locator('homeslice-panel .inspector .library button[data-key="modern:dining_table"]').click();
    assert((await room("kitchen")).furniture?.[0]?.type === "table", `kitchen: ${JSON.stringify((await room("kitchen")).furniture)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Table", "new table not selected");
    const piece = await page.locator("homeslice-panel svg.plan g.furniture.selected rect").boundingBox();
    const living = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    // grab it off-centre: the room's lamp hangs over the middle
    await page.mouse.move(piece.x + 6, piece.y + 6);
    await page.mouse.down();
    await page.mouse.move(living.x + living.width * 0.3, living.y + living.height * 0.8, { steps: 8 });
    await page.mouse.up();
    assert(!(await room("kitchen")).furniture && (await room("living")).furniture?.[0]?.type === "table", "table not moved into the living room");
    await page.keyboard.press("r");
    assert((await room("living")).furniture[0].rotation === 90, "not turned");
    // its front is marked with an arrow, turned with it
    assert((await page.locator("homeslice-panel svg.plan g.furniture.selected path.front").count()) === 1, "no front arrow");
    // Ctrl+D: a second one right next to it (turned: to the south), selected
    await page.keyboard.press("Control+d");
    const pair = (await room("living")).furniture;
    assert(pair.length === 2 && pair[1].rotation === 90 && Math.abs(pair[1].at[1] - pair[0].at[1] - 1.8) < 1e-6, `duplicate: ${JSON.stringify(pair)}`);
    // Ctrl+C, Ctrl+V: the piece as it was (turn, size, colours) under the pointer, in another room; Ctrl+X takes it out
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      Object.assign(m.levels.find((l) => l.id === window.panel._level).rooms.find((r) => r.id === "living").furniture[1], { size: [1.4, 0.9], finish: "walnut" });
      window.panel.commit(m);
    });
    await page.keyboard.press("Control+c");
    await page.mouse.move(kb.x + kb.width * 0.5, kb.y + kb.height * 0.5);
    await page.keyboard.press("Control+v");
    const pasted = (await room("kitchen")).furniture;
    assert(pasted?.length === 1 && pasted[0].rotation === 90 && pasted[0].finish === "walnut" && pasted[0].size?.[0] === 1.4, `pasted: ${JSON.stringify(pasted)}`);
    assert((await room("living")).furniture.length === 2, "the copy moved the original");
    await page.keyboard.press("Control+x");
    assert(!(await room("kitchen")).furniture, "not cut");
    await page.keyboard.press("Control+v");
    assert((await room("kitchen")).furniture?.length === 1, "cut piece not pasted");
    await page.keyboard.press("Delete");
    await page.evaluate(() => (window.panel._furn = { room: "living", index: 1 }));
    await page.keyboard.press("Delete");
    await page.evaluate(() => (window.panel._furn = { room: "living", index: 0 }));
    await shot(page, "editor-furniture");
    await page.keyboard.press("Delete");
    assert(!(await room("living")).furniture, "not deleted");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  test("furniture: a kitchen unit's widths to pick; a piece without a model still has its colours", async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      const kitchen = m.levels.find((l) => l.id === window.panel._level).rooms.find((r) => r.id === "kitchen");
      kitchen.furniture = [{ type: "kitchen", model: "modern:kitchen_base", at: [1, 1], size: [0.6, 0.62] }, { type: "sofa_corner", at: [2, 2] }];
      window.panel.commit(m);
      window.panel._furn = { room: "kitchen", index: 0 };
    });
    const widths = page.locator("homeslice-panel .inspector .widths button");
    assert((await widths.allTextContents()).join(",") === "30,45,50,60,80,90,100,120", `widths: ${await widths.allTextContents()}`);
    await page.locator('homeslice-panel .inspector .widths button[data-width="0.8"]').click();
    const unit = (await room("kitchen")).furniture[0];
    assert(unit.size?.[0] === 0.8 && unit.size[1] === 0.62, `size: ${JSON.stringify(unit.size)}`);
    assert((await page.locator('homeslice-panel .inspector .widths button[data-width="0.8"]').getAttribute("aria-checked")) === "true", "80 not shown as picked");
    // its options from the catalogue: handles, its own (bar) first and not written down
    const handles = page.locator('homeslice-panel .inspector [data-option="handle"] button');
    assert((await handles.count()) === 4, `handle choices: ${await handles.count()}`);
    await page.locator('homeslice-panel .inspector [data-option="handle"] button[data-value="handleless"]').click();
    assert((await room("kitchen")).furniture[0].options?.handle === "handleless", `options: ${JSON.stringify((await room("kitchen")).furniture[0].options)}`);
    await page.locator('homeslice-panel .inspector [data-option="handle"] button[data-value="bar"]').click();
    assert(!(await room("kitchen")).furniture[0].options, "the piece's own handle written down");
    // an older name: shown as the base unit with three drawers; a change writes the base unit
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      m.levels.find((l) => l.id === window.panel._level).rooms.find((r) => r.id === "kitchen").furniture[0].model = "modern:kitchen_drawers";
      window.panel.commit(m);
    });
    assert((await page.locator('homeslice-panel .inspector [data-option="fronts"] button[aria-checked="true"]').getAttribute("data-value")) === "drawers_3", "old drawer unit not shown as three drawers");
    await page.locator('homeslice-panel .inspector [data-option="fronts"] button[data-value="shelves"]').click();
    const folded = (await room("kitchen")).furniture[0];
    assert(folded.model === "modern:kitchen_base" && folded.options?.fronts === "shelves", `folded: ${JSON.stringify(folded)}`);
    await page.evaluate(() => (window.panel._furn = { room: "kitchen", index: 1 }));
    await page.locator("homeslice-panel .inspector button[data-finish]").nth(1).click();
    assert((await room("kitchen")).furniture[1].finish, "no colour for a piece without a model");
    await page.evaluate(() => {
      const m = structuredClone(window.panel._model);
      delete m.levels.find((l) => l.id === window.panel._level).rooms.find((r) => r.id === "kitchen").furniture;
      window.panel.commit(m);
      window.panel._furn = null;
    });
    assert(errors.length === 0, errors.join(" | "));
  });

  test("furniture library: grouped with pictures; drag pieces onto rooms, wall pieces go against a wall", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="furniture"]').click();
    await librarySource(page, "builtin");
    const groups = await page.locator("homeslice-panel .inspector h4").allTextContents();
    assert(groups[0] === "Living" && groups.includes("Bathroom") && groups.includes("Lighting") && groups.includes("Cars & bikes"), `groups: ${groups.join(", ")}`);
    // searching narrows the library down
    await page.locator("homeslice-panel .inspector input.library-search").fill("birch");
    const found = await page.locator("homeslice-panel .inspector .library button").evaluateAll((b) => b.map((x) => x.dataset.key));
    assert(JSON.stringify(found) === '["modern:tree_birch"]', `search: ${found}`);
    // aliases, in German too, every word somewhere
    await page.locator("homeslice-panel .inspector input.library-search").fill("spülmaschine");
    const dishwasher = await page.locator("homeslice-panel .inspector .library button").evaluateAll((b) => b.map((x) => x.dataset.key));
    assert(JSON.stringify(dishwasher) === '["modern:kitchen_dishwasher"]', `alias search: ${dishwasher}`);
    await page.locator("homeslice-panel .inspector input.library-search").fill("shower glass");
    const showers = await page.locator("homeslice-panel .inspector .library button").evaluateAll((b) => b.map((x) => x.dataset.key));
    assert(showers.includes("modern:shower_walk_in") && !showers.includes("modern:bathtub"), `two words: ${showers}`);
    await page.locator("homeslice-panel .inspector input.library-search").fill("");
    // the pictures load (lazily, as they scroll into view) and none is missing
    for (const lib of await page.locator("homeslice-panel .inspector .library").all()) await lib.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const imgs = [...window.panel.shadowRoot.querySelectorAll(".library img")];
      return imgs.filter((i) => i.complete && i.naturalWidth > 0).length >= 20 && imgs.every((i) => !i.complete || i.naturalWidth > 0);
    }, null, { timeout: 10000 });
    await page.locator("homeslice-panel .inspector input.library-search").scrollIntoViewIfNeeded();
    await shot(page, "editor-library-panel");
    // HTML drag and drop from the library onto the plan, as the browser does it
    const dropPiece = (key, x, y) =>
      page.evaluate(({ key, x, y }) => {
        const root = window.panel.shadowRoot;
        const dt = new DataTransfer();
        root.querySelector(`.library button[data-key="${key}"]`).dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
        const plan = root.querySelector("svg.plan");
        const at = { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
        const over = new DragEvent("dragover", at);
        plan.dispatchEvent(over);
        if (!over.defaultPrevented) return "the plan refused the drop";
        plan.dispatchEvent(new DragEvent("drop", at));
        return "ok";
      }, { key, x, y });
    const living = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    assert((await dropPiece("modern:sofa", living.x + living.width * 0.3, living.y + living.height * 0.75)) === "ok", "drop refused");
    assert((await room("living")).furniture?.some((f) => f.type === "sofa"), `living: ${JSON.stringify((await room("living")).furniture)}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Sofa", "dropped sofa not selected");
    // dragged close to the south wall, the sofa snaps flush against it (inside face: 10 − 0.18 m)
    const sofaBox = await page.locator("homeslice-panel svg.plan g.furniture.selected rect").boundingBox();
    const near = await toPage([3, 9.25]);
    await page.mouse.move(sofaBox.x + 8, sofaBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(near.x + 8 - sofaBox.width / 2, near.y + 8 - sofaBox.height / 2, { steps: 8 });
    await page.mouse.up();
    const sofa = (await room("living")).furniture.find((f) => f.type === "sofa");
    assert(Math.abs(sofa.at[1] + 4 - (9.82 - 0.475)) < 0.011, `sofa not against the wall: ${JSON.stringify(sofa)}`);
    // a mirror dropped near the hall's west wall hangs on it, facing east
    await page.keyboard.press("Escape");
    const hall = await page.locator('homeslice-panel svg.plan g[data-room="hall"] polygon').boundingBox();
    await dropPiece("modern:mirror_round", hall.x + 12, hall.y + hall.height * 0.6);
    const mirror = (await room("hall")).furniture?.find((f) => f.type === "mirror");
    // the hall's inside face of the west wall is 0.18 m from the room's corner; a 3 cm mirror sits 1.5 cm in front
    assert(mirror && mirror.rotation === 270 && Math.abs(mirror.at[0] - 0.2) < 0.011, `mirror: ${JSON.stringify(mirror)}`);
    assert((await page.locator("homeslice-panel .inspector label", { hasText: "Above the floor" }).count()) === 1, "a wall piece's height above the floor is not offered");
    // with snapping off, the mirror goes where it is dropped, not onto the wall
    const snapBox = page.locator("homeslice-panel .inspector label.snap-pieces input");
    await snapBox.uncheck();
    const mirrorBox = await page.locator("homeslice-panel svg.plan g.furniture.selected rect").boundingBox();
    await page.mouse.move(mirrorBox.x + mirrorBox.width / 2, mirrorBox.y + mirrorBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(mirrorBox.x + 60, mirrorBox.y + mirrorBox.height / 2, { steps: 6 });
    await page.mouse.up();
    const loose = (await room("hall")).furniture.find((f) => f.type === "mirror");
    assert(loose.rotation === 270 && loose.at[0] > 0.6, `mirror should move freely: ${JSON.stringify(loose)}`);
    await snapBox.check();
    await page.keyboard.press("Control+z");
    const sofaIndex = (await room("living")).furniture.findIndex((f) => f.type === "sofa");
    await page.evaluate((i) => (window.panel._furn = { room: "living", index: i }), sofaIndex);
    // mirrored left–right, then top–bottom (that one also turns it half way)
    await page.locator("homeslice-panel .inspector button", { hasText: "left–right" }).click();
    assert((await room("living")).furniture[sofaIndex].mirror === true, "not mirrored");
    assert((await page.locator("homeslice-panel svg.plan g.furniture.selected image").getAttribute("transform")) === "scale(-1 1)", "plan picture not flipped");
    await page.locator("homeslice-panel .inspector button", { hasText: "top–bottom" }).click();
    const flipped = (await room("living")).furniture[sofaIndex];
    assert(flipped.mirror === undefined && flipped.rotation === 180, `top–bottom: ${JSON.stringify(flipped)}`);
    await shot(page, "editor-library");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  test("library sources: built-in pieces with finishes, Poly Haven's fetched into HA, uploaded models", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Home Assistant serves downloaded and uploaded models; here any model is a chair
    await page.route("**/homeslice_assets/**", (route) => route.fulfill({ contentType: "model/gltf-binary", body: readFileSync(join(root, "dev/fixtures/chair.glb")) }));
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="furniture"]').click();
    const dropKey = (key, x, y) =>
      page.evaluate(({ key, x, y }) => {
        const root = window.panel.shadowRoot;
        const dt = new DataTransfer();
        root.querySelector(`.library button[data-key="${key}"]`).dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
        const plan = root.querySelector("svg.plan");
        const at = { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
        plan.dispatchEvent(new DragEvent("dragover", at));
        plan.dispatchEvent(new DragEvent("drop", at));
      }, { key, x, y });
    const living = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    const spot = [living.x + living.width * 0.5, living.y + living.height * 0.4];
    const count = async () => (await room("living")).furniture?.length ?? 0;
    const last = async () => (await room("living")).furniture.at(-1);
    const source = (s) => librarySource(page, s);
    const start = await count();

    await source("builtin");
    assert((await page.locator("homeslice-panel .inspector h4").allTextContents()).includes("Hall"), "no hall group");
    await dropKey("modern:wardrobe_sliding", ...spot);
    let w = await last();
    assert(w.model === "modern:wardrobe_sliding" && w.type === "wardrobe" && JSON.stringify(w.size) === "[2,0.65]" && w.height === 2.2, `modern: ${JSON.stringify(w)}`);
    await page.locator('homeslice-panel .inspector .finishes button[data-finish="walnut"]').click();
    w = await last();
    assert(w.finish === "walnut", `finish: ${JSON.stringify(w)}`);
    await page.locator('homeslice-panel .inspector .finishes button[data-accent="brass"]').click();
    w = await last();
    assert(w.accent === "brass", `accent: ${JSON.stringify(w)}`);
    // the 3D preview draws it (its module loads with the first Modern piece)
    await page.waitForFunction(() => window.panel.shadowRoot.querySelector("homeslice-card, .preview") !== null);
    await page.waitForTimeout(800);
    await shot(page, "editor-library-modern");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");

    let f;
    await source("polyhaven");
    await page.locator('homeslice-panel .inspector .library button[data-key="polyhaven:Sofa_01"]').waitFor();
    assert((await page.locator("homeslice-panel .inspector .credit").textContent()).includes("Poly Haven"), "no credit for Poly Haven");
    const groups = await page.locator("homeslice-panel .inspector h4").allTextContents();
    assert(JSON.stringify(groups) === '["Seating","Lighting","Plants"]', `groups: ${groups}`);
    await shot(page, "editor-library-polyhaven");
    await dropKey("polyhaven:Sofa_01", ...spot);
    await page.waitForFunction((n) => window.panel._model.levels[0].rooms.find((r) => r.id === "living").furniture?.length === n, start + 1);
    f = await last();
    assert(f.model === "polyhaven:Sofa_01" && f.type === "sofa" && JSON.stringify(f.size) === "[1.571,0.658]" && f.height === 0.796, `polyhaven: ${JSON.stringify(f)}`);
    assert(JSON.stringify(await page.evaluate(() => window.panel.hass.fetched)) === '["Sofa_01"]', "not fetched into HA first");
    await page.keyboard.press("Escape");

    await source("custom");
    assert((await page.locator("homeslice-panel .inspector p", { hasText: "No models uploaded yet" }).count()) === 1, "no empty note");
    await page.locator("homeslice-panel .inspector label.upload-model input").setInputFiles({ name: "Our chair.glb", mimeType: "model/gltf-binary", buffer: readFileSync(join(root, "dev/fixtures/chair.glb")) });
    await page.locator('homeslice-panel .inspector .library button[data-key="custom:m1"]').waitFor();
    await dropKey("custom:m1", ...spot);
    await page.waitForFunction((n) => window.panel._model.levels[0].rooms.find((r) => r.id === "living").furniture?.length === n, start + 2);
    f = await last();
    assert(f.model === "custom:m1" && f.type === "item" && f.size?.[0] > 0 && f.height > 0, `custom: ${JSON.stringify(f)}`);
    await shot(page, "editor-library-custom");
    for (let i = 0; i < 2; i++) await page.keyboard.press("Control+z");
    assert((await count()) === start, "not undone");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  test("Sketchfab: a token, a search, a model placed with its author and licence; a backup says what is for this home only", async () => {
    await page.route("**/homeslice_assets/**", (route) => route.fulfill({ contentType: "model/gltf-binary", body: readFileSync(join(root, "dev/fixtures/chair.glb")) }));
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");
    await librarySource(page, "sketchfab");
    const token = page.locator("homeslice-panel input[data-sketchfab-token]");
    await token.fill("wrong");
    await token.locator("xpath=..").locator("xpath=following-sibling::button").click();
    await page.locator("homeslice-panel .sketchfab-token .error").waitFor();
    await token.fill("good-token");
    await token.locator("xpath=..").locator("xpath=following-sibling::button").click();
    const search = page.locator("homeslice-panel input.sketchfab-search");
    await search.fill("sofa");
    await search.press("Enter");
    await page.locator('homeslice-panel button[data-sketchfab="free1"]').waitFor();
    const title = await page.locator('homeslice-panel button[data-sketchfab="free1"]').getAttribute("title");
    assert(title.includes("Ann") && title.includes("NonCommercial"), `credit: ${title}`);
    await shot(page, "editor-sketchfab");
    // a room picked: the bought one goes into it
    const room = await page.evaluate(() => window.panel._model.levels.find((l) => l.id === window.panel._level).rooms[0].id);
    await page.evaluate((room) => (window.panel._room = room), room);
    await page.locator('homeslice-panel button[data-sketchfab="bought1"]').click();
    await page.waitForFunction(() => window.panel._model.levels.some((l) => l.rooms.some((r) => (r.furniture ?? []).some((f) => f.model === "custom:" + window.panel._customModels.find((m) => m.uid === "bought1")?.id))), null, { timeout: 10000 });
    // dragged from the results onto a room: downloaded, then placed where it was dropped
    // (the placed piece is selected: back to the library first)
    await page.evaluate(() => {
      window.panel._furn = null;
      window.panel._room = null;
    });
    await page.locator('homeslice-panel button[data-sketchfab="free1"]').waitFor();
    const target = await page.locator("homeslice-panel svg.plan g[data-room] polygon").first().boundingBox();
    const dropped = await page.evaluate(({ x, y }) => {
      const root = window.panel.shadowRoot;
      const dt = new DataTransfer();
      root.querySelector('button[data-sketchfab="free1"]').dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
      const plan = root.querySelector("svg.plan");
      const at = { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
      const over = new DragEvent("dragover", at);
      plan.dispatchEvent(over);
      if (!over.defaultPrevented) return "refused";
      plan.dispatchEvent(new DragEvent("drop", at));
      return "ok";
    }, { x: target.x + target.width / 2, y: target.y + target.height / 2 });
    assert(dropped === "ok", "the plan refused the drop");
    // on its way: a placeholder where it was dropped, with the download size, until it is placed
    const arriving = await page.locator("homeslice-panel g[data-arriving] text").textContent({ timeout: 2000 });
    assert(arriving.includes("2.5 MB"), `placeholder: ${arriving}`);
    await page.waitForFunction(() => {
      const id = window.panel._customModels?.find((m) => m.uid === "free1")?.id;
      return id && window.panel._model.levels.some((l) => l.rooms.some((r) => (r.furniture ?? []).some((f) => f.model === "custom:" + id)));
    }, null, { timeout: 10000 });
    assert((await page.locator("homeslice-panel g[data-arriving]").count()) === 0, "the placeholder stays");
    // both are in Home Assistant now: listed under the search, their results ticked
    await page.evaluate(() => {
      window.panel._furn = null;
      window.panel._room = null;
    });
    await page.locator("homeslice-panel .sketchfab-downloaded button.piece").first().waitFor({ timeout: 3000 });
    assert((await page.locator("homeslice-panel .sketchfab-downloaded button.piece").count()) === 2, "downloaded list");
    const ticks = await page.locator("homeslice-panel button[data-sketchfab-download]").evaluateAll((els) => els.map((e) => e.classList.contains("have")));
    assert(ticks.length === 2 && ticks.every(Boolean), `download buttons: ${JSON.stringify(ticks)}`);
    // the backup still downloads, and says the bought model is for this home only
    await page.evaluate(() => (window.panel._room = null));
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    const download = page.waitForEvent("download");
    await page.locator("homeslice-panel button[data-backup]").click();
    await download;
    const notice = await page.locator("homeslice-panel .notice").textContent();
    assert(notice.includes("For your own backup only") && notice.includes("Bought sofa"), `notice: ${notice}`);
    await page.locator("homeslice-panel header button[aria-label='House settings']").click();
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    // the two pieces placed
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
  });

  test("a floor lamp linked to a light: the lamp marker goes, the piece is the lamp", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const lb = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    await page.mouse.click(lb.x + lb.width * 0.85, lb.y + lb.height * 0.9);
    await page.locator("homeslice-panel .inspector button", { hasText: "Add furniture" }).click();
    await librarySource(page, "builtin");
    await page.locator('homeslice-panel .inspector .library button[data-key="modern:floor_lamp_tripod"]').click();
    const lampMarkers = () => page.locator('homeslice-panel svg.plan [data-light*="light.reading_lamp"]').count();
    assert((await lampMarkers()) === 1, "the reading lamp should have its marker before linking");
    const link = page.locator("homeslice-panel .inspector details.entity-picker");
    await link.locator("summary").click();
    await link.locator("input.entity-search").fill("reading");
    assert((await link.locator("button.entity-option").count()) === 2, "search should leave 'not linked' and the reading lamp");
    await link.locator('button.entity-option[data-entity="light.reading_lamp"]').click();
    const piece = (await room("living")).furniture.find((f) => f.type === "floor_lamp");
    assert(piece?.entity === "light.reading_lamp", `piece: ${JSON.stringify(piece)}`);
    assert((await lampMarkers()) === 0, "the lamp marker should give way to the piece");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("wall view: a room's side from inside, drag a window along and up", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const lb = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    await page.mouse.click(lb.x + lb.width * 0.85, lb.y + lb.height * 0.9);
    await page.locator('homeslice-panel .inspector button[data-wall-view="south"]').click();
    const items = page.locator("homeslice-panel .wall-view [data-wv]");
    assert((await items.count()) === 2, `items on the bottom wall: ${await items.count()}`);
    const win = page.locator("homeslice-panel .wall-view .wv-item.wv-window");
    const before = (await model()).levels[0].openings[2];
    const b = await win.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 - 30, { steps: 6 });
    await page.mouse.up();
    const after = (await model()).levels[0].openings[2];
    // seen from inside, the bottom wall runs right to left: dragging right moves it towards the start
    // (a full-height window: its sill starts on the floor)
    assert(after.at < before.at && after.sill >= 0.2, `window ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    assert((await page.locator("homeslice-panel .wall-view .wv-dims text").count()) >= 2, "no measurements for the selected window");
    await shot(page, "editor-wall-view");
    await page.keyboard.press("Control+z");
    await page.locator("homeslice-panel .wall-view .close").click();
    assert((await page.locator("homeslice-panel .wall-view").count()) === 0, "wall view still open");
    await page.keyboard.press("Escape");
  });

  test("cameras: shown with what they see on the plan, dragged to their wall", async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const p = window.panel;
      const m = structuredClone(p._model);
      m.levels[0].rooms.find((r) => r.id === "hall").cameras = [{ entity: "camera.door", at: [1.5, 2], direction: 0, fov: 80 }];
      p.commit(m);
    });
    const cam = page.locator('homeslice-panel svg.plan [data-camera]');
    assert((await cam.count()) === 1 && (await page.locator("homeslice-panel svg.plan polygon.camera-view").count()) === 1, "no camera on the plan");
    const b = await cam.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    const c = (await room("hall")).cameras[0];
    assert(c.at[1] > 2.3, `camera not moved: ${JSON.stringify(c)}`);
    assert((await page.locator("homeslice-panel .inspector h3", { hasText: "Cameras" }).count()) === 1, "no cameras in the room panel");
    await shot(page, "editor-camera");
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
  });

  test("lights: turn one into a row of spots, add a spot and drag it", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const lb = await page.locator('homeslice-panel svg.plan g[data-room="living"] polygon').boundingBox();
    await page.mouse.click(lb.x + lb.width * 0.85, lb.y + lb.height * 0.9);
    const item = page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Sofa lamp" }).first();
    await item.locator("select").selectOption("spot");
    const light = async () => (await room("living")).lights.find((l) => l.entity === "light.living_room");
    assert((await light())?.type === "spot" && (await light()).at, `spot light: ${JSON.stringify(await light())}`);
    await item.locator("button", { hasText: "+" }).click();
    await item.locator("button", { hasText: "+" }).click();
    let l = await light();
    assert(l.spots?.length === 2 && Math.abs(l.spots[1][0] - l.spots[0][0] - 0.8) < 1e-6, `spots: ${JSON.stringify(l.spots)}`);
    // drag the last spot
    const spot = page.locator('homeslice-panel svg.plan circle.lamp-part[data-light*="light.living_room"]').last();
    const b = await spot.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    l = await light();
    assert(l.spots[1][1] > l.spots[0][1] + 0.3, `dragged spot: ${JSON.stringify(l.spots)}`);
    await shot(page, "editor-spots");
    // back to a lamp: the spots go
    await item.locator("select").selectOption("lamp");
    l = await light();
    assert(!l.type && !l.spots, `back to a lamp: ${JSON.stringify(l)}`);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    for (let i = 0; i < 5; i++) await page.keyboard.press("Control+z");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("robots: place a mower's dock, show it live from GPS after two calibration spots", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="devices"]').click();
    await page.locator('homeslice-panel .flyout button[data-sub-tool="robots"]').click();
    await page.locator("homeslice-panel .inspector ul.lights li", { hasText: "Mower" }).locator("button").click();
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("Click where the dock of Mower is"), "no placing hint");
    const dockAt = await toPage([6, 9.3]);
    await page.mouse.click(dockAt.x, dockAt.y);
    const mower = () => model().then((m) => m.robots?.find((r) => r.entity === "lawn_mower.mower"));
    assert((await mower())?.level === "ground", `mower: ${JSON.stringify(await mower())}`);
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Mower", "mower not selected");
    await page.locator("homeslice-panel .inspector label.check", { hasText: "live position" }).locator("input").check();
    assert((await page.locator("homeslice-panel .inspector label", { hasText: "Attribute" }).locator("select").inputValue()) === "", "GPS should be offered for a mower with latitude/longitude");
    // spot 1: where it is now
    const record = async (lat, lon, plan) => {
      await page.evaluate(([lat, lon]) => {
        const h = window.panel.hass;
        window.panel.hass = { ...h, states: { ...h.states, "lawn_mower.mower": { ...h.states["lawn_mower.mower"], attributes: { ...h.states["lawn_mower.mower"].attributes, latitude: lat, longitude: lon } } } };
      }, [lat, lon]);
      await page.locator("homeslice-panel .inspector button", { hasText: "Record a spot" }).click();
      const at = await toPage(plan);
      await page.mouse.click(at.x, at.y);
    };
    await record(48.0, 10.0, [1, 9.5]);
    await record(48.0, 10.0001, [7, 9.5]);
    assert((await mower()).position.points.length === 2, `points: ${JSON.stringify((await mower()).position)}`);
    assert((await page.locator("homeslice-panel .inspector").textContent()).includes("Calibrated"), "not shown as calibrated");
    // it is where the second spot was recorded
    const live = await page.locator("homeslice-panel svg.plan circle.robot-live").last().boundingBox();
    const spot = await toPage([7, 9.5]);
    assert(Math.hypot(live.x + live.width / 2 - spot.x, live.y + live.height / 2 - spot.y) < 3, `live dot at ${JSON.stringify(live)}, expected ${JSON.stringify(spot)}`);
    await shot(page, "editor-robot");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  test("objects mode: place energy items from HA's energy settings", async () => {
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="devices"]').click();
    await page.locator('homeslice-panel .flyout button[data-sub-tool="devices"]').click();
    const offers = await page.locator("homeslice-panel .inspector ul.offers li .name").allTextContents();
    assert(["Solar", "Battery", "Grid", "Inverter", "Heat pump"].every((n) => offers.includes(n)), `offers: ${offers}`);
    await page.locator("homeslice-panel .inspector ul.offers li", { hasText: "Battery" }).locator("button").click();
    assert((await page.locator("homeslice-panel .hint-bar").textContent()).includes("Click where Battery is"), "no placing hint");
    const plan = await page.locator("homeslice-panel svg.plan").boundingBox();
    const { scale, ox, oy } = await page.evaluate(() => window.panel._view);
    await page.mouse.click(plan.x + ox + 1 * scale, plan.y + oy + 1 * scale);
    let energy = (await model()).energy;
    assert(energy?.length === 1 && energy[0].kind === "battery" && energy[0].level === "ground" && Math.abs(energy[0].at[0] - 1) < 0.06, `energy: ${JSON.stringify(energy)}`);
    // drag it 1 m east
    const marker = await page.locator("homeslice-panel svg.plan g.energy-marker rect").boundingBox();
    await page.mouse.move(marker.x + 11, marker.y + 11);
    await page.mouse.down();
    await page.mouse.move(marker.x + 11 + scale, marker.y + 11, { steps: 5 });
    await page.mouse.up();
    energy = (await model()).energy;
    assert(Math.abs(energy[0].at[0] - 2) < 0.06, `moved: ${JSON.stringify(energy[0].at)}`);
    // the placed item has its own inspector
    assert((await page.locator("homeslice-panel .inspector h2").textContent()) === "Battery", "battery not selected");
    assert(await page.locator("homeslice-panel .inspector label", { hasText: "Charge sensor" }).count(), "no charge sensor for the battery");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="devices"]').click();
    await page.locator('homeslice-panel .flyout button[data-sub-tool="devices"]').click();
    await page.locator("homeslice-panel .inspector ul.offers li", { hasText: "Solar" }).locator("button").click();
    assert((await model()).energy[1].kind === "solar", "solar not added");
    // a heat pump and a grid meter; the heat pump's line goes to the battery (the hub) by itself
    const placeAt = async (name, x, y) => {
      await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="devices"]').click();
    await page.locator('homeslice-panel .flyout button[data-sub-tool="devices"]').click();
      await page.locator("homeslice-panel .inspector ul.offers li", { hasText: name }).locator("button").click();
      await page.mouse.click(plan.x + ox + x * scale, plan.y + oy + y * scale);
    };
    await placeAt("Grid", 1, 7);
    await placeAt("Heat pump", 4, 7);
    const hp = (await model()).energy.findIndex((e) => e.name === "Heat pump");
    const connects = page.locator("homeslice-panel .inspector label", { hasText: "Line connects to" }).locator("select");
    assert((await connects.locator("option:checked").textContent()) === "Automatic: Battery", `default: ${await connects.locator("option:checked").textContent()}`);
    // connect it to the grid meter
    const grid = (await model()).energy.findIndex((e) => e.kind === "grid");
    await connects.selectOption(String(grid));
    assert((await model()).energy[hp].to === "grid" && (await model()).energy[grid].id === "grid", `connected: ${JSON.stringify((await model()).energy)}`);
    // …or drag from its ring onto the battery
    const ring = await page.locator("homeslice-panel svg.plan g.link-handle circle").boundingBox();
    const battery = await page.locator('homeslice-panel svg.plan g.energy-marker[data-energy="0"] rect').boundingBox();
    await page.mouse.move(ring.x + ring.width / 2, ring.y + ring.height / 2);
    await page.mouse.down();
    await page.mouse.move(battery.x + 11, battery.y + 11, { steps: 8 });
    assert(await page.locator("homeslice-panel svg.plan line.energy-link.drawing").count(), "no line while connecting");
    await page.mouse.up();
    assert((await model()).energy[hp].to === "battery", `dragged: ${JSON.stringify((await model()).energy[hp])}`);
    assert((await page.locator("homeslice-panel svg.plan line.energy-link").count()) >= 2, "lines not drawn on the plan");
    await shot(page, "editor-energy");
    await page.keyboard.press("Escape");
    await page.locator('homeslice-panel aside.tools button[data-group="devices"]').click();
    await page.locator('homeslice-panel .flyout button[data-sub-tool="devices"]').click();
    await page.locator("homeslice-panel .inspector ul.energy li", { hasText: "Battery" }).locator("button:not(.link)").click();
    assert((await model()).energy.length === 3, "battery not removed");
    assert((await model()).energy.every((e) => e.to === undefined), "lines to the removed battery should go back to the hub");
    await page.keyboard.press("Control+z");
    await page.locator('homeslice-panel aside.tools button.tool[data-tool="select"]').click();
    assert(errors.length === 0, errors.join(" | "));
  });

  test("command search (Ctrl+K): a tool by another word for it, a room on another floor", async () => {
    await page.keyboard.press("Escape");
    await page.locator("homeslice-panel svg.plan").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("Control+k");
    const input = page.locator("homeslice-panel input.palette-input");
    await input.waitFor({ timeout: 3000 });
    await input.fill("terrace");
    assert((await page.locator("homeslice-panel .palette-list li").first().getAttribute("data-command")) === "tool:balcony", "terrace does not find the balcony tool");
    await input.press("Enter");
    assert(await page.evaluate(() => window.panel._tool === "balcony"), "balcony tool not chosen");
    assert(!(await page.locator("homeslice-panel .palette").count()), "the search stays open");
    // a room on the floor above: the floor shown, the room selected
    await page.locator("homeslice-panel header button[data-palette-open]").click();
    await input.fill("kids");
    await input.press("Enter");
    const at = await page.evaluate(() => ({ level: window.panel._level, room: window.panel._room, tool: window.panel._tool }));
    assert(at.level === "first" && at.room === "kids" && at.tool === "select", `went to ${JSON.stringify(at)}`);
    // nothing for gibberish; Escape closes
    await page.keyboard.press("Control+k");
    await input.fill("qqqzzz");
    assert((await page.locator("homeslice-panel .palette-list li").textContent()).includes("Nothing found"), "found something for gibberish");
    await input.press("Escape");
    assert(!(await page.locator("homeslice-panel .palette").count()), "Escape did not close");
    await shot(page, "editor-search");
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window.panel._level = "ground"));
    assert(errors.length === 0, errors.join(" | "));
  });

  test("a robot's map as a backdrop: shown on the card while it cleans, placed where the backdrop lies", async () => {
    await page.keyboard.press("Escape");
    await page.route("**/api/image_proxy/image.robo_map**", (route) => route.fulfill({ contentType: "image/png", body: readFileSync("dev/fixtures/robot-map.png") }));
    await page.evaluate(() => {
      const p = window.panel;
      const h = p.hass;
      p.hass = {
        ...h,
        entities: { ...h.entities, "vacuum.robo": { ...(h.entities["vacuum.robo"] ?? { entity_id: "vacuum.robo" }), device_id: "robo_device" }, "image.robo_map": { entity_id: "image.robo_map", device_id: "robo_device" } },
        states: { ...h.states, "image.robo_map": { entity_id: "image.robo_map", state: "2026-11-03", attributes: { friendly_name: "Robo Ground Floor", entity_picture: "/api/image_proxy/image.robo_map?token=x" } } },
      };
      p._level = "ground";
    });
    const b = await page.locator("homeslice-panel svg.plan").boundingBox();
    await page.mouse.click(b.x + 5, b.y + b.height - 5);
    await page.locator("homeslice-panel .inspector button[data-robot-map='image.robo_map']").click();
    await page.waitForFunction(() => window.panel._underlay?.source === "image.robo_map", null, { timeout: 5000 });
    await page.evaluate(() => {
      window.panel._calib = null;
      window.panel._straighten = null;
    });
    const box = page.locator("homeslice-panel .inspector input[data-robot-map-card]");
    await box.check();
    await page.waitForFunction(() => !!window.panel._model.robots[0].map, null, { timeout: 5000 });
    const map = await page.evaluate(() => window.panel._model.robots[0].map);
    assert(map.entity === "image.robo_map" && map.size.join() === "240,160" && map.scale === 0.0125, `map: ${JSON.stringify(map)}`);
    // the backdrop moved: the card's map goes along
    await page.evaluate(() => window.panel.saveUnderlay({ place: { ...window.panel._underlay.place, origin: [1, 2] } }));
    assert((await page.evaluate(() => window.panel._model.robots[0].map.origin)).join() === "1,2", "the card's map did not follow the backdrop");
    await box.uncheck();
    assert(!(await page.evaluate(() => window.panel._model.robots[0].map)), "still on the card");
    page.once("dialog", (d) => d.accept());
    await page.locator("homeslice-panel .inspector button", { hasText: "Remove image" }).click();
    await page.waitForFunction(() => !window.panel._underlay, null, { timeout: 5000 });
    await page.keyboard.press("Escape");
  });

  test("Delete removes the selected room", async () => {
    await page.locator('homeslice-panel svg.plan g[data-room="room"] polygon').click({ force: true });
    await page.keyboard.press("Delete");
    assert(!(await room("room")), "room still there");
    assert(await page.locator("homeslice-panel button.save.dirty").count(), "delete not marked as unsaved");
    assert(errors.length === 0, errors.join(" | "));
  });
});
