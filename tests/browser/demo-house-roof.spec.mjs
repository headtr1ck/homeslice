// demo house, roof
import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, assert, browser, calls, lamp, open, out, setBrowser, shot, state, triangles } from "./helpers.mjs";

test.describe.serial("demo house, roof (1)", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { view: { azimuth: 200, elevation: 45, roof: true } }));
  });
  test.afterAll(async () => {
    await page?.close();
  });


  test("furniture is drawn", async () => {
    // counted once every piece is drawn in detail, before and after
    await page.evaluate(() => window.card.renderer.modelsReady());
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [
          { type: "sofa", at: [2, 4] },
          { type: "table", at: [3, 2], rotation: 90 },
          { type: "plant", at: [0.5, 0.5] },
        ];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.card.renderer.renderer.info.render.triangles);
    assert(after > before + 50, `triangles ${before} → ${after}`);
  });

  test("detailed furniture: every type gets its built-in piece, drawn to its size", async () => {
    const types = ["sofa", "armchair", "table", "chair", "bed", "bed_single", "desk", "wardrobe", "shelf", "kitchen", "tv", "bathtub", "shower", "toilet", "sink", "plant", "car", "washer", "dryer", "fridge"];
    await act(page, async () => {
      await page.evaluate((types) => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = types.map((type, i) => ({ type, at: [0.8 + (i % 5) * 1.2, 0.8 + Math.floor(i / 5) * 1.8] }));
        window.card.hass.pushModel(m);
      }, types);
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const pieces = await page.evaluate(() => {
      const out = [];
      const level = window.card.renderer.object.getObjectByName("ground");
      for (const g of level.children)
        if (g.children[0]?.userData.detailed) {
          let meshes = 0;
          g.children[0].traverse((o) => o.isMesh && meshes++);
          out.push({ meshes });
        }
      return out;
    });
    // the demo garden has four pieces of its own
    assert(pieces.length === types.length + 4, `${pieces.length} of ${types.length} + 4 pieces detailed`);
    // the 2.4 m kitchen counter is a row of units with fronts, a sink and a hob
    assert(pieces[types.indexOf("kitchen")].meshes >= 12, `kitchen parts: ${pieces[types.indexOf("kitchen")].meshes}`);
    await shot(page, "demo-furniture-detailed");
  });

  test("painted floors and walls: finishes per room, an accent wall, the facade", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        const rooms = m.levels[0].rooms;
        const living = rooms.find((r) => r.id === "living");
        Object.assign(living, { floor: "oak_herringbone", wall: "paint_sage", wall_sides: { north: "acoustic_oak" } });
        const kitchen = rooms.find((r) => r.id === "kitchen");
        if (kitchen) Object.assign(kitchen, { floor: "terrazzo", wall: "tile_subway" });
        m.facade = "brick_red";
        window.card.hass.pushModel(m);
      }),
    );
    const looks = await page.evaluate(() => {
      const found = new Set();
      window.card.renderer.object.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.map?.image?.width === 512) found.add(m.map.uuid);
      });
      return found.size;
    });
    // herringbone, terrazzo, sage paint (no texture), oak slats, subway tiles, brick
    assert(looks >= 5, `${looks} finish textures in the scene`);
    await shot(page, "demo-painted");
  });

  test("tooltips: hovering a linked piece shows its name, state and since when", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "item", model: "modern:ac_outdoor", at: [1, 2], entity: "climate.living_room" }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const at = await page.evaluate(() => {
      const f = window.card.house.levels[0].rooms.find((r) => r.id === "living").furniture[0];
      const p = window.card.renderer.project("ground", f.at, 0.3);
      const r = window.card.renderer.renderer.domElement.getBoundingClientRect();
      return [r.left + p.x, r.top + p.y];
    });
    await page.mouse.move(at[0] - 3, at[1] - 3);
    await page.mouse.move(at[0], at[1], { steps: 2 });
    const tip = page.locator("homeslice-card .tip");
    await tip.waitFor({ timeout: 3000 });
    const text = await tip.textContent();
    assert(text.includes("Living room thermostat") && text.includes("heat"), `tooltip: ${text}`);
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => !document.querySelector("homeslice-card").shadowRoot.querySelector(".tip"));
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("rules: a ring and a label by a reading, a piece tinted by its state", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "item", model: "modern:ac_outdoor", at: [1, 2], entity: "climate.living_room" }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    await act(page, () =>
      page.evaluate(() =>
        window.card.setConfig({
          ...window.card.config,
          rules: [
            { entity: "sensor.living_room_co2", above: 1000, ring: "#ff3b30", icon: "mdi:molecule-co2", text: "{state:0} {unit}" },
            { entity: "climate.living_room", state: "heat", color: "#ff3b30" },
          ],
        }),
      ),
    );
    const mark = page.locator("homeslice-card .rule-mark");
    await mark.waitFor({ timeout: 3000 });
    assert((await mark.textContent()).trim() === "1240 ppm", `rule text: ${await mark.textContent()}`);
    assert(await page.locator("homeslice-card .rule-ring").count(), "no ring");
    const tint = () => page.evaluate(() => window.card.renderer.entityTints.get("climate.living_room") ?? null);
    assert((await tint()) === "#ff3b30", `tint ${await tint()}`);
    await shot(page, "demo-rules");
    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("sensor.living_room_co2", "800");
        window.card.hass.setState("climate.living_room", "off");
      }),
    );
    await page.waitForFunction(() => !document.querySelector("homeslice-card").shadowRoot.querySelector(".rule-mark"));
    assert((await tint()) === null, "tint stayed");
    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("sensor.living_room_co2", "1240");
        window.card.hass.setState("climate.living_room", "heat");
        const { rules, ...config } = window.card.config;
        window.card.setConfig(config);
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
  });

  test("pieces that do things: a sprinkler sprays, a pool's water lights up, a frame shows its picture", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const h = window.card.hass;
        h.setState("switch.sprinkler", "off", {});
        h.setState("light.pool", "off", {});
        const art = document.createElement("canvas");
        art.width = art.height = 8;
        art.getContext("2d").fillRect(0, 0, 8, 8);
        h.setState("image.photo", "2026-11-02T10:00:00", { entity_picture: art.toDataURL() });
        const m = structuredClone(window.__demoModel);
        const garden = m.levels[0].rooms.find((r) => r.kind === "outdoor");
        garden.furniture = [
          { type: "item", model: "modern:sprinkler", at: [1, 1], entity: "switch.sprinkler" },
          { type: "item", model: "modern:pool", at: [3, 2], entity: "light.pool" },
        ];
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "item", model: "modern:picture_frame", at: [2, 0.1], mount: "wall", entity: "image.photo" }];
        h.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const state = (e) => page.evaluate((e) => window.card.renderer.deviceState(e), e);
    assert((await state("switch.sprinkler")).spraying === false, "spraying while closed");

    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("switch.sprinkler", "on");
        window.card.hass.setState("light.pool", "on");
      }),
    );
    assert((await state("switch.sprinkler")).spraying, "not spraying while open");
    assert(await page.evaluate(() => (window.card.renderer.pieceGlows.get("light.pool") ?? []).some((m) => m.emissiveIntensity > 0.2)), "pool water dark while its light is on");
    await page.waitForFunction(() => window.card.renderer.deviceState("image.photo")?.picture, null, { timeout: 5000 });
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("trees in front of the house turn see-through, the others stay", async () => {
    const counts = await page.evaluate(() => {
      const r = window.card.renderer;
      const start = r.orientation.azimuth;
      const out = [];
      for (let a = 0; a < 360; a += 30) {
        r.orbit(30, 0);
        r.draw();
        out.push(r.fadedOccluders);
      }
      r.orientation = { ...r.orientation, azimuth: start };
      r.draw();
      return out;
    });
    assert(counts.some((n) => n > 0) && counts.some((n) => n === 0), `faded per view: ${JSON.stringify(counts)}`);
    // a picture from a view where it is see-through
    const turn = (counts.findIndex((n) => n > 0) + 1) * 30;
    await page.evaluate((turn) => {
      const r = window.card.renderer;
      const start = r.orientation.azimuth;
      r.orbit(turn, 0);
      r.draw();
      window.__azimuth = start;
    }, turn);
    await shot(page, "demo-tree-faded");
    await page.evaluate(() => {
      window.card.renderer.orientation = { ...window.card.renderer.orientation, azimuth: window.__azimuth };
      window.card.renderer.draw();
    });
  });

  test("under a roof that starts lower, the ceiling slopes: pendants hang from it", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        delete m.roof;
        m.levels.push({ id: "attic", kind: "roof", rooms: [], roofs: [{ rect: [0, 0, 8, 10], offset: -1.5, ridge: "left_right" }] });
        window.card.hass.pushModel(m);
      }),
    );
    const c = await page.evaluate(() => {
      const r = window.card.renderer;
      return { eave: r.ceilingAt("first", [4, 0.4]), middle: r.ceilingAt("first", [4, 5]), ground: r.ceilingAt("ground", [4, 0.4]) };
    });
    assert(c.eave < 1.5 && c.middle > c.eave + 0.8 && c.ground > 2.4, JSON.stringify(c));
    // the roof level picked on its own (it has no rooms): the roof is framed, and the floors after it
    for (const level of ["attic", "ground"]) {
      await act(page, () => page.evaluate((level) => window.card.selectLevel(level), level));
      await page.waitForFunction(() => !window.card.transitioning);
      const cam = await page.evaluate(() => window.card.renderer.camera.position.toArray());
      assert(cam.every(Number.isFinite), `camera after ${level}: ${JSON.stringify(cam)}`);
    }
    await act(page, () => page.evaluate(() => window.card.selectLevel(null)));
    await page.waitForFunction(() => !window.card.transitioning);
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("a house's own piece, built from its shapes and stretched to its place", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.pieces = [{ id: "tv_unit", size: [1.8, 0.4, 0.5], parts: [{ shape: "box", size: [1.8, 0.4, 0.45], finish: "oak" }, { shape: "cylinder", size: [0.06, 0.06, 0.05], at: [-0.8, 0.15, 0.45], finish: "#222222" }, { shape: "taper", size: [0.3, 0.3, 0.25], at: [0.6, 0, 0.45], top: 0.5, finish: "white", glow: true }] }];
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "item", model: "piece:tv_unit", at: [2, 0.4], size: [2.4, 0.4] }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const found = await page.evaluate(() => {
      let piece = null;
      window.card.renderer.object.traverse((o) => {
        if (o.userData.detailed && !piece) piece = o;
      });
      const meshes = [];
      piece?.traverse((o) => o.isMesh && meshes.push(o));
      return { meshes: meshes.length, scale: piece?.children[0]?.scale.x };
    });
    assert(found.meshes === 3 && Math.abs(found.scale - 2.4 / 1.8) < 1e-6, JSON.stringify(found));
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("stairs: a spiral with a glass railing, an L-shaped one with a metal handrail, a railing round the well upstairs", async () => {
    const rails = (style) =>
      page.evaluate((style) => {
        let n = 0;
        window.card.renderer.object.traverse((o) => o.userData.railing === style && n++);
        return n;
      }, style);
    const before = { glass: await rails("glass"), metal: await rails("metal"), wood: await rails("wood") };
    for (const [shape, railing, rect] of [["spiral", "glass", [6, 4, 2, 2]], ["l_turn", "metal", [5, 4, 3, 2]], ["curved", "wood", [5, 4, 3, 2]]]) {
      await act(page, () =>
        page.evaluate(
          ([shape, railing, rect]) => {
            const m = structuredClone(window.__demoModel);
            Object.assign(m.vertical[0], { shape, railing, rect });
            window.card.hass.pushModel(m);
          },
          [shape, railing, rect],
        ),
      );
      const problems = await page.evaluate(() => window.card._issues.map((i) => i.message));
      assert(!problems.length, `${shape}: ${JSON.stringify(problems)}`);
      // upstairs the spiral's well is open to the west; the L's is walled in all round
      const added = (await rails(railing)) - before[railing];
      assert(shape === "spiral" ? added > 0 : added === 0, `${shape}: ${added} railings round the well upstairs`);
      await act(page, () => page.locator("homeslice-card button", { hasText: "Ground Floor" }).click());
      await page.waitForTimeout(800);
      await shot(page, `demo-stairs-${shape}`);
      await act(page, () => page.locator("homeslice-card button", { hasText: "All floors" }).click());
    }
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("stairs on stringers: an L, a board each side of each flight", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        Object.assign(m.vertical[0], { turns: 1, stringers: "sides", railing: "metal" });
        window.card.hass.pushModel(m);
      }),
    );
    const boards = await page.evaluate(() => {
      let n = 0;
      window.card.renderer.object.traverse((o) => o.userData.stringer && n++);
      return n;
    });
    assert(boards === 4, `stringers: ${boards}`);
    await act(page, () => page.locator("homeslice-card button", { hasText: "Ground Floor" }).click());
    await page.waitForTimeout(800);
    await shot(page, "demo-stairs-stringers");
    await act(page, () => page.locator("homeslice-card button", { hasText: "All floors" }).click());
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("stairs with solid steps in concrete", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        Object.assign(m.vertical[0], { treads: "solid", finish: "concrete" });
        window.card.hass.pushModel(m);
      }),
    );
    const solid = await page.evaluate(() => {
      let n = 0;
      window.card.renderer.object.traverse((o) => o.userData.solidStep && n++);
      return n;
    });
    assert(solid > 10, `solid steps: ${solid}`);
    await act(page, () => page.locator("homeslice-card button", { hasText: "Ground Floor" }).click());
    await page.waitForTimeout(800);
    await shot(page, "demo-stairs-solid");
    await act(page, () => page.locator("homeslice-card button", { hasText: "All floors" }).click());
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("a section: all floors cut along a line, seen across it; labels only where the house stays", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.sections = [{ id: "stairs", name: "Through the stairs", line: [[-1, 5], [9, 5]], look: "north" }];
        window.card.hass.pushModel(m);
      }),
    );
    const button = page.locator("homeslice-card button[data-section=stairs]");
    assert((await button.textContent()).includes("Through the stairs"), "no section button");
    await act(page, () => button.click());
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      planes: window.card.renderer.renderer.clippingPlanes.length,
      azimuth: Math.round(window.card.renderer.orientation.azimuth),
      labels: window.card._labels.map((l) => l.key),
    }));
    assert(state.planes === 1 && state.azimuth === 180, JSON.stringify(state));
    // the kids' room (south of the cut) is gone; the bedroom, cut through, keeps its label
    assert(!state.labels.some((k) => k.endsWith("/kids")) && state.labels.some((k) => k.endsWith("/bedroom")), JSON.stringify(state.labels));
    await shot(page, "demo-section");
    // again: the whole house
    await act(page, () => button.click());
    await page.waitForTimeout(700);
    assert((await page.evaluate(() => window.card.renderer.renderer.clippingPlanes.length)) === 0, "still cut");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("the side view: a 2D drawing of every room at once, rows side by side, floors at their heights; turned; back", async () => {
    const button = page.locator("homeslice-card button[data-side-view]");
    await act(page, () => button.click());
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({ look: window.card._side, labels: window.card._labels.map((l) => l.key), rooms: window.card.shadowRoot.querySelectorAll("svg.side-view rect.room").length }));
    assert(state.look && state.rooms >= 5, `side view: ${JSON.stringify(state)}`);
    // every room of every floor has its label
    const rooms = await page.evaluate(() => window.card.house.levels.flatMap((l) => l.rooms.filter((r) => r.kind === "room").map((r) => `${l.id}/${r.id}`)));
    const missing = rooms.filter((k) => !state.labels.includes(k));
    assert(!missing.length, `rooms without a label: ${missing}`);
    await shot(page, "demo-side-view");
    await act(page, () => page.locator("homeslice-card button[data-side-turn]").click());
    await page.waitForTimeout(700);
    const turned = await page.evaluate(() => window.card._side);
    assert(turned && turned !== state.look, `turned: ${turned}`);
    await shot(page, "demo-side-view-turned");
    await act(page, () => button.click());
    await page.waitForTimeout(700);
    assert((await page.evaluate(() => window.card.shadowRoot.querySelector("svg.side-view"))) === null, "still in the side view");
  });

  test("a shed in the garden: a building of its own, with outside walls and a roof", async () => {
    const before = await triangles(page);
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.push({ id: "shed", name: "Shed", rect: [5, 12, 2.5, 2] });
        window.card.hass.pushModel(m);
      }),
    );
    const shed = await page.evaluate(() => ({ annexes: window.card.house.levels[0].annexes, walls: [...window.card.walls.get("ground")].filter((w) => w.rooms.includes("shed")).map((w) => w.type), issues: window.card._issues.map((i) => i.message) }));
    assert(shed.annexes.length === 1 && shed.walls.length === 4 && shed.walls.every((t) => t === "exterior") && !shed.issues.length, JSON.stringify(shed));
    assert((await triangles(page)) > before, "nothing more drawn");
    await shot(page, "demo-shed");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("a garage with a loft: a building of its own on two floors, stairs up, one roof on top", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.push({ id: "garage", name: "Garage", rect: [10, 0, 4, 6], building: { roof: "gable", pitch: 35, roof_finish: "roof_slate" } });
        m.levels[1].rooms.push({ id: "loft", name: "Loft", rect: [10, 0, 4, 6] });
        m.vertical.push({ id: "garage_stairs", rect: [10.3, 4.8, 3, 1], from: m.levels[0].id, to: m.levels[1].id, up: "east" });
        window.card.hass.pushModel(m);
      }),
    );
    const state = await page.evaluate(() => ({
      issues: window.card._issues.map((i) => i.message),
      roofs: window.card.renderer.annexRoofs.map((r) => r.levelIndex),
      buildings: window.card.house.levels.map((l) => l.annexBuildings.map((b) => b.roof)),
    }));
    assert(!state.issues.length, JSON.stringify(state.issues));
    // a roof over the loft only; both floors the gable building
    assert(JSON.stringify(state.roofs) === "[1]" && JSON.stringify(state.buildings) === '[["gable"],["gable"]]', JSON.stringify(state));
    await shot(page, "demo-garage-loft");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("curved walls: a bowed front, its rooms and walls following the arc", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.outline.curves = [{ edge: 2, bulge: 1.5 }];
        m.levels[0].rooms.find((r) => r.id === "living").curves = [{ edge: 4, bulge: 1.5 }];
        m.levels[1].rooms.find((r) => r.id === "kids").curves = [{ edge: 2, bulge: 1.5 }];
        window.card.hass.pushModel(m);
      }),
    );
    const living = await page.evaluate(() => window.card.house.levels[0].rooms.find((r) => r.id === "living").polygon);
    // the arc's middle 1.5 m south of the old front
    assert(living.length > 8 && Math.max(...living.map((p) => p[1])) > 11.4, `living: ${JSON.stringify(living)}`);
    // the front windows and the terrace door follow the arc, in parts
    const parts = await page.evaluate(() => [...window.card.walls.get("ground")].flatMap((w) => w.openings.map((o) => o.id)).filter((id) => id.includes("~")).length);
    assert(parts > 2, `arc parts: ${parts}`);
    const problems = await page.evaluate(() => window.card._issues.map((i) => i.message));
    assert(!problems.length, `problems: ${JSON.stringify(problems)}`);
    await shot(page, "demo-curved");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("a roof terrace: an outdoor room of the top floor, its floor, door and railing, the roof cut away above", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        const first = m.levels[1];
        // the kids' room gives its east end to a terrace under the east slope, a door out to it
        first.rooms.find((r) => r.id === "kids").rect = [0, 6, 5, 4];
        first.rooms.push({ id: "terrace", kind: "outdoor", railing: "glass", rect: [5, 6, 3, 4] });
        first.openings = [first.openings[0], first.openings[1], { room: "kids", side: "east", at: 1.5, width: 0.9, type: "door" }];
        window.card.hass.pushModel(m);
      }),
    );
    const found = await page.evaluate(() => {
      const r = window.card.renderer;
      const floor = r.floors.get("first/terrace");
      let rails = 0;
      r.object.traverse((o) => o.userData.railing && rails++);
      const walls = [...window.card.walls.get("first")].filter((w) => w.type === "exterior" && w.side === "east").map((w) => [w.a, w.b]);
      floor?.geometry.computeBoundingBox();
      return { floorY: floor?.geometry.boundingBox.min.y, rails, walls };
    });
    assert(Math.abs(found.floorY) < 0.01 && found.rails >= 2, JSON.stringify(found));
    // no outside wall along the terrace: the east wall ends where the kids' room does
    assert(found.walls.every(([a, b]) => Math.max(a[1], b[1]) <= 6.2), `east walls: ${JSON.stringify(found.walls)}`);
    await page.evaluate(() => window.card.renderer.turnTo(110, 35));
    await page.waitForTimeout(600);
    await shot(page, "demo-roof-terrace");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("a roof window of a room: in the slope above it, its shutter and contact, in the room's panel", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        h.setState("cover.skylight", "open", { current_position: 100, friendly_name: "Skylight blind" });
        h.setState("binary_sensor.skylight", "off", { device_class: "window", friendly_name: "Skylight" });
        const m = structuredClone(window.__demoModel);
        m.levels[1].rooms.find((r) => r.id === "kids").roof_windows = [{ at: [6, 2], cover: "cover.skylight", contact: "binary_sensor.skylight" }];
        h.pushModel(m);
      }),
    );
    const key = 10000;
    assert(await page.evaluate((key) => !!window.card.renderer.roofWindowState(key), key), "no roof window drawn");
    await act(page, () => page.evaluate(() => window.card.hass.setState("binary_sensor.skylight", "on")));
    const state = await page.evaluate((key) => window.card.renderer.roofWindowState(key), key);
    assert(state.open, `open: ${JSON.stringify(state)}`);
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

});

test.describe.serial("demo house, roof (2)", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { view: { azimuth: 200, elevation: 45, roof: true } }));
  });
  test.afterAll(async () => {
    await page?.close();
  });


  test("roof: a roof button for the viewer, remembered on this device", async () => {
    await page.evaluate(() => localStorage.removeItem("homeslice-roof:" + (window.card.config.house ?? "home")));
    await act(page, () => page.evaluate(() => window.card.setConfig({ ...window.card.baseConfig, roof: "toggle_hidden" })).then(() => page.evaluate(() => (window.card.hass = window.card.hass))));
    const shown = () => page.evaluate(() => window.card.renderer.roofVisible());
    assert((await shown()) === false, "roof shown though hidden at first");
    await act(page, () => page.locator("homeslice-card button.roof-toggle").click());
    await page.waitForFunction(() => window.card.renderer.roofVisible());
    // kept on this device: still there after the card is set up again
    await act(page, () => page.evaluate(() => window.card.setConfig({ ...window.card.baseConfig })).then(() => page.evaluate(() => (window.card.hass = window.card.hass))));
    assert(await shown(), "the choice was not kept");
    await act(page, () => page.evaluate(() => window.card.setConfig({ ...window.card.baseConfig, roof: "hide" })).then(() => page.evaluate(() => (window.card.hass = window.card.hass))));
    assert((await shown()) === false && !(await page.locator("homeslice-card button.roof-toggle").count()), "hide still shows the roof or its button");
    await page.evaluate(() => localStorage.removeItem("homeslice-roof:" + (window.card.config.house ?? "home")));
    await act(page, () =>
      page.evaluate(() => {
        const { roof, ...config } = window.card.baseConfig;
        window.card.setConfig(config);
        window.card.hass = window.card.hass;
      }),
    );
  });

  test("a gallery railing drawn along its line", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[1].walls = [...(m.levels[1].walls ?? []), { line: [[5, 4], [8, 4]], type: "railing", railing: "glass" }];
        window.card.hass.pushModel(m);
      }),
    );
    const found = await page.evaluate(() => {
      const out = [];
      window.card.renderer.object.traverse((o) => o.userData.railing && out.push(o.userData.railing));
      return out;
    });
    assert(found.includes("glass"), `railings: ${JSON.stringify(found)}`);
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("a piece shown only while its helper is on", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        window.card.hass.setState("input_boolean.guests", "off", {});
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "bed", at: [2, 2], visible_when: "input_boolean.guests" }];
        window.card.hass.pushModel(m);
      });
    });
    const shown = () => page.evaluate(() => window.card.renderer.shownPieces("input_boolean.guests"));
    assert((await shown()) === 0, "the guest bed shows while off");
    await act(page, () => page.evaluate(() => window.card.hass.setState("input_boolean.guests", "on")));
    assert((await shown()) === 1, "the guest bed is missing while on");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("a top-hung window and a lift-and-slide door open with their contacts", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        h.setState("binary_sensor.west_window", "off", { device_class: "window" });
        h.setState("binary_sensor.patio", "off", { device_class: "door" });
        const m = structuredClone(window.__demoModel);
        Object.assign(m.levels[0].openings[4], { style: "top_hung", contact: "binary_sensor.west_window" });
        Object.assign(m.levels[0].openings[3], { style: "lift_slide", contact: "binary_sensor.patio", width: 2.4 });
        h.pushModel(m);
      }),
    );
    await page.evaluate(() => {
      window.card.hass.setState("binary_sensor.west_window", "on");
      window.card.hass.setState("binary_sensor.patio", "on");
    });
    const ids = await page.evaluate(() => window.card.openings.filter((o) => o.contact).map((o) => o.id));
    await page.waitForFunction((ids) => ids.every((id) => window.card.renderer.leafState(id)?.every((l) => l.open === 1)), ids, { timeout: 5000 });
    const hows = await page.evaluate((ids) => ids.flatMap((id) => window.card.renderer.leafState(id).map((l) => l.how)), ids);
    assert(hows.includes("top") && hows.includes("lift"), `leaves: ${JSON.stringify(hows)}`);
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("an inside venetian blind beside the outside shutter: let down, slats turned", async () => {
    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("cover.kitchen_blind", "open", { current_position: 100, current_tilt_position: 100, friendly_name: "Kitchen blind" });
        const m = structuredClone(window.__demoModel);
        Object.assign(m.levels[0].openings[1], { blind: "cover.kitchen_blind", blind_style: "venetian" });
        window.card.hass.pushModel(m);
      }),
    );
    const id = await page.evaluate(() => window.card.openings.find((o) => o.blind)?.id);
    const blind = () => page.evaluate((id) => window.card.renderer.blindState(id), id);
    let b = await blind();
    assert(b.style === "venetian" && b.parts > 10 && b.closed === 0 && b.shown === 0, `up: ${JSON.stringify(b)}`);
    await act(page, () => page.evaluate(() => window.card.hass.setState("cover.kitchen_blind", "open", { current_position: 40, current_tilt_position: 30 })));
    b = await blind();
    assert(Math.abs(b.closed - 0.6) < 1e-6 && Math.abs(b.tilt - 0.3) < 1e-6 && b.shown === Math.round(0.6 * b.parts), `down: ${JSON.stringify(b)}`);
    // the outside shutter is still its own
    assert((await page.evaluate((id) => window.card.renderer.coverState(id), id)) !== null, "the shutter is gone");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await page.waitForFunction(() => !window.card.transitioning);
    await page.evaluate(() => window.card.renderer.turnTo(200, 30));
    await page.waitForTimeout(600);
    await shot(page, "demo-blind");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    await page.waitForFunction(() => !window.card.transitioning);
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("linked devices: a TV's screen, curtains with their cover, an outdoor unit's fan", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [
          { type: "tv", model: "modern:tv_wall", at: [2, 0.3], entity: "media_player.living_room_tv" },
          { type: "item", model: "modern:curtains", at: [3, 0.2], entity: "cover.living_room" },
          { type: "item", model: "modern:ac_outdoor", at: [1, 2], entity: "climate.living_room" },
          { type: "item", model: "modern:radiator_panel", at: [0.6, 0.1], entity: "climate.living_room" },
          { type: "item", model: "modern:speaker_floor", at: [3.2, 0.3], entity: "media_player.living_room_tv" },
        ];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const state = (e) => page.evaluate((e) => window.card.renderer.deviceState(e), e);
    // the TV is off: a dark screen; on: lit
    assert((await state("media_player.living_room_tv"))?.lit === false, `tv off: ${JSON.stringify(await state("media_player.living_room_tv"))}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("media_player", "turn_on", {}, { entity_id: "media_player.living_room_tv" })));
    assert((await state("media_player.living_room_tv")).lit, "tv on but its screen is dark");
    // playing: the cover art on the screen, the speaker's woofers move
    await page.evaluate(() => {
      const h = window.card.hass;
      const tv = h.states["media_player.living_room_tv"];
      const art = document.createElement("canvas");
      art.width = art.height = 8;
      const g = art.getContext("2d");
      g.fillStyle = "#d33";
      g.fillRect(0, 0, 8, 8);
      h.states = { ...h.states, "media_player.living_room_tv": { ...tv, state: "playing", attributes: { ...tv.attributes, entity_picture: art.toDataURL() } } };
      window.card.hass = h;
    });
    await page.waitForFunction(() => window.card.renderer.deviceState("media_player.living_room_tv").picture, null, { timeout: 5000 });
    await page.waitForFunction(() => window.card.renderer.deviceState("media_player.living_room_tv").pulse.some((x) => x > 1.01), null, { timeout: 5000 });
    await shot(page, "demo-playing");
    // curtains: open as the blind is open, drawn closed when it closes
    assert((await state("cover.living_room")).curtains.every((x) => x === 1), `curtains open: ${(await state("cover.living_room")).curtains}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "close_cover", {}, { entity_id: "cover.living_room" })));
    assert((await state("cover.living_room")).curtains.every((x) => x > 1.5), `curtains closed: ${(await state("cover.living_room")).curtains}`);
    // the heat pump heats: its fan turns (the card animates), and stops when it is off
    const unit = await state("climate.living_room");
    assert(unit.turn.length === 1 && unit.lit, `outdoor unit: ${JSON.stringify(unit)}`);
    assert(await page.evaluate(() => window.card.renderer.spinning), "not spinning while heating");
    const warm = () => page.evaluate(() => window.card.renderer.devices.get("climate.living_room").flatMap((p) => p.materials).filter((m) => m.userData.part === "warm").map((m) => m.emissiveIntensity));
    assert((await warm()).length && (await warm()).every((x) => x > 0.2), `radiator not warm while heating: ${await warm()}`);
    await page.waitForFunction((t) => window.card.renderer.deviceState("climate.living_room").turn[0] !== t, unit.turn[0], { timeout: 8000 }).catch(() => {});
    assert((await state("climate.living_room")).turn[0] !== unit.turn[0], "the fan did not turn");
    await shot(page, "demo-devices");
    await act(page, () => page.evaluate(() => window.card.hass.callService("climate", "turn_off", {}, { entity_id: "climate.living_room" })));
    assert(!(await page.evaluate(() => window.card.renderer.spinning)), "still spinning when off");
    assert(!(await state("climate.living_room")).lit, "status light on when off");
    assert((await warm()).every((x) => x === 0), "radiator warm when off");
    await act(page, () =>
      page.evaluate(async () => {
        await window.card.hass.callService("media_player", "turn_off", {}, { entity_id: "media_player.living_room_tv" });
        await window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.living_room" });
        await window.card.hass.callService("climate", "turn_on", {}, { entity_id: "climate.living_room" });
      }),
    );
  });

  test("a garage door rolls up with its cover, or opens with its contact alone", async () => {
    const garage = async (edit) => {
      await act(page, async () => {
        await page.evaluate((edit) => {
          const m = structuredClone(window.__demoModel);
          m.levels[0].openings[1] = { room: "kitchen", side: "north", at: 1.3, width: 2.4, type: "garage_door", ...edit };
          window.card.hass.pushModel(m);
        }, edit);
      });
      return () => page.evaluate(() => window.card.renderer.coverState("kitchen_north_1"));
    };
    const door = await garage({ cover: "cover.kitchen" });
    const height = (await door()).shutterHeight;
    // the kitchen cover is half open: half the door rolled up
    assert((await door()).shutterVisible && height > 0.5 && height < 1.5, `half-open garage door: ${JSON.stringify(await door())}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "close_cover", {}, { entity_id: "cover.kitchen" })));
    assert(Math.abs((await door()).shutterHeight - 2 * height) < 0.01, `closed garage door: ${JSON.stringify(await door())}`);
    // a tap on the closed door is a tap on its cover (the ground floor shown, nothing above it)
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const picked = await page.evaluate(() => {
      const r = window.card.renderer;
      const mesh = r.linked.find((o) => o.userData.entity === "cover.kitchen" && o.visible);
      if (!mesh) return "no door mesh";
      mesh.updateMatrixWorld(true);
      mesh.geometry.computeBoundingBox();
      const p = mesh.geometry.boundingBox.getCenter(mesh.position.clone()).applyMatrix4(mesh.matrixWorld).project(r.camera);
      return r.pickEntity(((p.x + 1) / 2) * r.size.width, ((1 - p.y) / 2) * r.size.height);
    });
    assert(picked === "cover.kitchen", `picked at the garage door: ${picked}`);
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.kitchen" })));
    assert(!(await door()).shutterVisible, "open garage door still shown");
    await shot(page, "demo-garage-open");
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "set_cover_position", { position: 50 }, { entity_id: "cover.kitchen" })));
    // only a contact: closed while it is off
    const byContact = await garage({ contact: "binary_sensor.kids_room_leak" });
    assert((await byContact()).shutterVisible, `garage door with a closed contact: ${JSON.stringify(await byContact())}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" })));
    assert(!(await byContact()).shutterVisible, "garage door shown with its contact open");
    await act(page, () => page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" })));
  });

  test("doors swing and windows tilt with their contacts", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        Object.assign(m.levels[0].openings[3], { contact: "binary_sensor.kids_room_leak" });
        Object.assign(m.levels[0].openings[4], { contact: "binary_sensor.kids_room_leak" });
        window.card.hass.pushModel(m);
      });
    });
    const leaves = () => page.evaluate(() => [window.card.renderer.leafState("living_south_3"), window.card.renderer.leafState("living_west_4")]);
    let [door, win] = await leaves();
    assert(door?.length === 1 && door[0].how === "swing" && door[0].open === 0, `closed door: ${JSON.stringify(door)}`);
    assert(win?.length === 1 && win[0].how === "tilt" && win[0].open === 0, `closed window: ${JSON.stringify(win)}`);
    await page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" }));
    // it opens over a moment, not at once
    await page.waitForFunction(() => window.card.renderer.leafState("living_south_3")[0].open > 0, null, { timeout: 10000 });
    [door] = await leaves();
    assert(door[0].open < 1, `door should open over a moment, not at once: ${JSON.stringify(door)}`);
    await page.waitForFunction(() => window.card.renderer.leafState("living_south_3")[0].open === 1, null, { timeout: 10000 });
    [door, win] = await leaves();
    assert(win[0].open === 1, `window not tilted: ${JSON.stringify(win)}`);
    await page.waitForTimeout(200);
    await shot(page, "demo-door-open");
    await page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" }));
    await page.waitForFunction(() => window.card.renderer.leafState("living_south_3")[0].open === 0, null, { timeout: 10000 });
  });

  test("doors and windows in every mode: a tap target, an outline where walls are cut low, a plan mark, orange while open", async () => {
    const look = (id) => page.evaluate((id) => window.card.renderer.openingLook(id), id);
    const toggle = () => act(page, () => page.evaluate(() => window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" })));
    const mode = (mode) =>
      act(page, () => page.evaluate((mode) => window.card.setConfig({ ...window.card.config, mode }), mode).then(() => page.evaluate(() => (window.card.hass = window.card.hass))));
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        Object.assign(m.levels[0].openings[3], { contact: "binary_sensor.kids_room_leak" });
        Object.assign(m.levels[0].openings[4], { contact: "binary_sensor.kids_room_leak" });
        window.card.hass.pushModel(m);
      });
    });
    // 3D: a tap target; open, an orange outline seen through everything
    let win = await look("living_west_4");
    assert(win.entity === "binary_sensor.kids_room_leak" && !win.xray, `3D, closed: ${JSON.stringify(win)}`);
    await toggle();
    win = await look("living_west_4");
    assert(win.xray && win.open, `3D, open: ${JSON.stringify(win)}`);
    // the tilted plan: walls cut low, the windows above the cut drawn as outlines (orange while open)
    await mode("tilted");
    win = await look("living_west_4");
    assert(win.marks >= 1 && win.color === "#ffb05c", `2.5D, open: ${JSON.stringify(win)}`);
    const front = await look("living_south_2");
    assert(front.marks >= 1, `2.5D, the front window: ${JSON.stringify(front)}`);
    await shot(page, "demo-openings-tilted");
    // the plan: the window's mark on the wall, tapped from above
    await mode("plan");
    win = await look("living_west_4");
    assert(win.marks >= 1 && win.color === "#ffb05c", `plan, open: ${JSON.stringify(win)}`);
    const picked = await page.evaluate(() => {
      const r = window.card.renderer;
      const hit = r.linked.find((o) => o.userData.opening === "living_west_4");
      hit.geometry.computeBoundingBox();
      const p = hit.geometry.boundingBox.getCenter(hit.position.clone()).applyMatrix4(hit.matrixWorld).project(r.camera);
      return r.pickEntity(((p.x + 1) / 2) * r.size.width, ((1 - p.y) / 2) * r.size.height);
    });
    assert(picked === "binary_sensor.kids_room_leak", `plan, tapped: ${picked}`);
    // the terrace door under the awning: a tap there means the door
    const underAwning = await page.evaluate(() => {
      const r = window.card.renderer;
      const hit = r.linked.find((o) => o.userData.opening === "living_south_3");
      hit.geometry.computeBoundingBox();
      const p = hit.geometry.boundingBox.getCenter(hit.position.clone()).applyMatrix4(hit.matrixWorld).project(r.camera);
      const awning = r.linked.some((o) => o.userData.yields);
      return [awning, r.pickEntity(((p.x + 1) / 2) * r.size.width, ((1 - p.y) / 2) * r.size.height)];
    });
    assert(underAwning[1] === "binary_sensor.kids_room_leak", `plan, the terrace door under the awning (${underAwning[0] ? "awning there" : "no awning"}): ${underAwning[1]}`);
    await shot(page, "demo-openings-plan");
    await toggle();
    win = await look("living_west_4");
    assert(win.color !== "#ffb05c" && !win.open, `plan, closed again: ${JSON.stringify(win)}`);
    await mode(undefined);
  });

  test("a window open in the rain is a note on its room; a power outage a warning", async () => {
    // (one sensor plays the rain, the window's contact and the outage)
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, rain: "binary_sensor.kids_room_leak", power_outage: "binary_sensor.kids_room_leak" });
      window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" });
    });
    await page.waitForSelector("homeslice-card .label.note", { timeout: 5000 });
    const note = await page.locator("homeslice-card .label.note button.name").textContent();
    assert(note.includes("Living Room"), `note on ${note}`);
    assert(await page.locator('homeslice-card .label.note ha-icon[icon="mdi:weather-pouring"]').count(), "no rain icon");
    assert((await page.locator("homeslice-card .outage").textContent()).includes("Power outage"), "no outage warning");
    await shot(page, "demo-rain");
    await page.evaluate(() => {
      window.card.hass.callService("homeassistant", "toggle", {}, { entity_id: "binary_sensor.kids_room_leak" });
      const { rain, power_outage, ...config } = window.card.config;
      window.card.setConfig(config);
    });
    await page.waitForFunction(() => !window.card.shadowRoot.querySelector(".outage"));
  });

  test("underfloor heating glows while it heats, only on cards that show heating", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").underfloor = "climate.living_room";
        window.card.hass.pushModel(m);
      });
    });
    const loops = () => page.evaluate(() => window.card.renderer.underfloorState("climate.living_room"));
    assert((await loops()).length === 1 && !(await loops())[0], `hidden without heating: ${await loops()}`);
    await act(page, () =>
      page.evaluate(() => {
        // the thermostat heats right now
        const h = window.card.hass;
        const c = h.states["climate.living_room"];
        h.states = { ...h.states, "climate.living_room": { ...c, state: "heat", attributes: { ...c.attributes, hvac_action: "heating" } } };
        window.card.setConfig({ ...window.card.config, heating: true });
        window.card.hass = h;
      }),
    );
    assert((await loops())[0], "no loops while heating");
    await shot(page, "demo-underfloor");
    await act(page, () => page.evaluate(() => window.card.hass.callService("climate", "turn_off", {}, { entity_id: "climate.living_room" })));
    assert(!(await loops())[0], "loops while off");
    await act(page, () =>
      page.evaluate(async () => {
        await window.card.hass.callService("climate", "turn_on", {}, { entity_id: "climate.living_room" });
        const { heating, ...config } = window.card.config;
        window.card.setConfig(config);
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
  });

  test("a car is there only while it is home, with its charge and range above it", async () => {
    const set = (where) =>
      page.evaluate((where) => {
        const h = window.card.hass;
        const st = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
        h.states = { ...h.states, "device_tracker.car": st("device_tracker.car", where), "sensor.car_battery": st("sensor.car_battery", "82", { unit_of_measurement: "%" }), "sensor.car_range": st("sensor.car_range", "340", { unit_of_measurement: "km" }) };
        window.card.hass = h;
      }, where);
    await set("not_home");
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "car", model: "modern:car_hatchback", at: [3, 3], entity: "device_tracker.car", readings: ["sensor.car_battery", "sensor.car_range"] }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const shown = () => page.evaluate(() => window.card.renderer.devices.get("device_tracker.car").every((p) => p.piece.visible));
    assert(!(await shown()), "the car is drawn while away");
    assert(!(await page.locator("homeslice-card .piece-badge").count()), "a note for a car that is away");
    await set("home");
    await page.waitForFunction(() => window.card.renderer.devices.get("device_tracker.car").every((p) => p.piece.visible), null, { timeout: 5000 });
    await page.waitForSelector("homeslice-card .piece-badge", { timeout: 5000 });
    const note = await page.locator("homeslice-card .piece-badge").textContent();
    assert(note.includes("82%") && note.includes("340 km"), `car note: ${note}`);
    await shot(page, "demo-car");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("weather: its badge, rain falling around the house, nothing when it clears", async () => {
    const set = (condition) =>
      page.evaluate((condition) => {
        const h = window.card.hass;
        h.states = { ...h.states, "weather.home": { entity_id: "weather.home", state: condition, attributes: { temperature: 7.5, temperature_unit: "°C", friendly_name: "Home" } } };
        window.card.setConfig({ ...window.card.config, weather: "weather.home" });
        window.card.hass = h;
      }, condition);
    await set("pouring");
    await page.waitForFunction(() => window.card.renderer.weatherFalling, null, { timeout: 5000 });
    const badge = await page.locator("homeslice-card .weather").textContent();
    assert(badge.includes("7.5 °C"), `weather badge: ${badge}`);
    assert(await page.locator('homeslice-card .weather ha-icon[icon="mdi:weather-pouring"]').count(), "no pouring icon");
    await page.waitForTimeout(300);
    await shot(page, "demo-rain-weather");
    await set("sunny");
    await page.waitForFunction(() => !window.card.renderer.weatherFalling, null, { timeout: 5000 });
    await page.evaluate(() => {
      const { weather, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
  });

});

test.describe.serial("demo house, roof (3)", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { view: { azimuth: 200, elevation: 45, roof: true } }));
  });
  test.afterAll(async () => {
    await page?.close();
  });


  test("sun path: an arc around the house with sunrise and sunset", async () => {
    if (await page.evaluate(() => window.card._level !== null)) await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    await page.evaluate(() => {
      const h = window.card.hass;
      h.config = { ...(h.config ?? {}), latitude: 48.4, longitude: 10.9 };
      window.card.setConfig({ ...window.card.config, sun_path: true, look: "night" });
      window.card.hass = h;
    });
    const sunState = () => page.evaluate(() => ({ group: !!window.card.renderer.sunPathGroup, key: window.card.sunPathKey, times: window.card.sunTimes.length, labels: window.card._sunTimes.length, level: window.card._level, conf: window.card.hass.config }));
    await page.waitForFunction(() => window.card.shadowRoot.querySelectorAll(".sun-time").length === 2, null, { timeout: 5000 }).catch(async () => assert(false, `sun path: ${JSON.stringify(await sunState())}`));
    const times = await page.locator("homeslice-card .sun-time").allTextContents();
    assert(times.every((t) => /\d\d:\d\d/.test(t)), `sun times: ${times}`);
    await shot(page, "demo-sun-path");
    await page.evaluate(() => {
      const { sun_path, look, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
    await page.waitForFunction(() => !window.card.renderer.sunPathGroup, null, { timeout: 5000 });
  });

  test("at night a lit room's light falls out of its windows onto the garden", async () => {
    const keys = await page.evaluate(() => [...window.card.renderer.spills.keys()]);
    assert(keys.length > 0, "no windows onto an outdoor area in the demo house");
    const [levelId, roomId] = keys[0].split("/");
    const spill = () => page.evaluate(([l, r]) => window.card.renderer.spillState(l, r), [levelId, roomId]);
    await page.evaluate(([l, r]) => {
      window.card.renderer.setLook("day");
      window.card.renderer.setSun(180, 40);
      window.card.renderer.setRoomLight(l, r, { rgb: [255, 200, 140], brightness: 1 });
    }, [levelId, roomId]);
    assert((await spill()).every((x) => x < 0.05), `window light by day: ${await spill()}`);
    await page.evaluate(() => window.card.renderer.setLook("night"));
    assert((await spill()).every((x) => x > 0.3), `no window light at night: ${await spill()}`);
    await page.evaluate(() => window.card.renderer.draw());
    await shot(page, "demo-window-light");
    // back as the card says
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config });
      window.card.hass = window.card.hass;
    });
  });

  test("time travel: replay the day, the house as it was, then back to now", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, time_travel: true });
      window.card.requestUpdate();
    });
    await page.locator("homeslice-card .time-travel-open").click();
    await page.waitForSelector("homeslice-card .time-travel input[type=range]", { timeout: 5000 });
    await page.waitForFunction(() => window.card._replay && !window.card._replay.loading);
    // the light was on in the second half's first quarter
    const lit = (fraction) =>
      page.evaluate((fraction) => {
        const r = window.card._replay;
        window.card.seekReplay(r.history.start + (r.history.end - r.history.start) * fraction);
        return window.card.renderer.roomLightState?.("ground", "living") ?? window.card.renderer.floors.get("ground/living").material.emissive.getHex() !== 0;
      }, fraction);
    assert(await lit(0.6), "the living room is not lit at the time its light was on");
    assert(!(await lit(0.2)), "lit before its light went on");
    assert((await page.locator("homeslice-card .time-travel .tick").count()) >= 2, "no event marks on the timeline");
    await shot(page, "demo-time-travel");
    await page.locator("homeslice-card .time-travel button", { has: page.locator('ha-icon[icon="mdi:close"]') }).click();
    assert(!(await page.locator("homeslice-card .time-travel").count()), "the timeline stays open");
    await page.evaluate(() => {
      const { time_travel, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  test("homeslice.show (Assist: show the kitchen): the card flies there, then back", async () => {
    if (await page.evaluate(() => window.card._level !== null)) await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    await act(page, () => page.evaluate(() => window.card.hass.show({ area_id: "kids_room", seconds: 5 })));
    await page.waitForFunction(() => window.card._level === "first", null, { timeout: 5000 });
    const banner = await page.locator("homeslice-card .event").textContent();
    assert(banner.includes("Kids Room"), `banner: ${banner}`);
    await page.evaluate(() => {
      window.card.lastTouch = 0;
      return window.card.endEvent();
    });
    await page.waitForFunction(() => window.card._level === null, null, { timeout: 5000 });
  });

  test("homeslice.announce: the message on the card, at its room or where the card is", async () => {
    await act(page, () => page.evaluate(() => window.card.hass.show({ area_id: "kitchen", message: "Dinner is ready", seconds: 5 })));
    await page.waitForFunction(() => window.card._level === "ground", null, { timeout: 5000 });
    const banner = await page.locator("homeslice-card .event").textContent();
    assert(banner.includes("Dinner is ready") && banner.includes("Kitchen"), `banner: ${banner}`);
    await page.evaluate(() => window.card.endEvent());
    await page.waitForFunction(() => window.card._level === null, null, { timeout: 5000 });
    await page.evaluate(() => window.card.hass.show({ message: "Storm coming", seconds: 5 }));
    await page.locator("homeslice-card .event", { hasText: "Storm coming" }).waitFor();
    assert((await page.evaluate(() => window.card._level)) === null, "a house-wide message moved the card");
    await page.evaluate(() => window.card.endEvent());
  });

  test("walking: eye level in a room, walls stop you, then back to the house", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, walk: true });
      window.card.requestUpdate();
    });
    await page.locator("homeslice-card .walk-open").click();
    await page.waitForFunction(() => !!window.card.renderer.walking, null, { timeout: 5000 });
    const eye = await page.evaluate(() => window.card.renderer.camera.position.y - window.card.renderer.levels[window.card.renderer.levelIds.indexOf(window.card.renderer.walking.levelId)].group.position.y);
    assert(Math.abs(eye - 1.6) < 0.01, `eye height ${eye}`);
    assert(!(await page.locator("homeslice-card .label").count()), "labels at eye level");
    // walk on until a wall stops it
    const at = () => page.evaluate(() => window.card.renderer.walking.at);
    const start = await at();
    for (let i = 0; i < 60; i++) await page.evaluate(() => window.card.walkStep(0.25, 0));
    const end = await at();
    assert(Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.2, `did not move: ${start} → ${end}`);
    const level = await page.evaluate(() => window.card.renderer.walking.levelId);
    const inside = await page.evaluate(([l, p]) => window.card.house.levels.find((x) => x.id === l).rooms.some((r) => {
      let c = false;
      const poly = r.polygon;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i][1] > p[1] !== poly[j][1] > p[1] && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
      return c;
    }), [level, end]);
    assert(inside, `walked out of the house: ${end}`);
    // keys work too
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowRight");
    await shot(page, "demo-walk");
    await page.locator("homeslice-card .walk-close").click();
    await page.waitForFunction(() => !window.card.renderer.walking && !window.card.transitioning, null, { timeout: 5000 });
    await page.evaluate(() => {
      const { walk, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  test("people stand in the room their sensor names, and leave when they are away", async () => {
    const set = (where, room) =>
      page.evaluate(([where, room]) => {
        const h = window.card.hass;
        h.states = { ...h.states, "person.alex": { entity_id: "person.alex", state: where, attributes: { friendly_name: "Alex" } }, "sensor.alex_area": { entity_id: "sensor.alex_area", state: room, attributes: {} } };
        window.card.setConfig({ ...window.card.config, people: [{ person: "person.alex", room: "sensor.alex_area" }] });
        window.card.hass = h;
      }, [where, room]);
    await set("home", "Kitchen");
    await page.waitForFunction(() => window.card.renderer.peopleState().length === 1, null, { timeout: 5000 });
    const [p] = await page.evaluate(() => window.card.renderer.peopleState());
    assert(p.level === "ground", `Alex on ${p.level}`);
    await set("home", "bedroom");
    await page.waitForFunction(() => window.card.renderer.peopleState()[0]?.level === "first", null, { timeout: 5000 });
    await set("not_home", "bedroom");
    await page.waitForFunction(() => window.card.renderer.peopleState().length === 0, null, { timeout: 5000 });
    await page.evaluate(() => {
      const { people, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
  });

  test("a pet roams the house and garden with its tracker, drawn small with a paw", async () => {
    await page.evaluate(() => {
      const h = window.card.hass;
      h.states = { ...h.states, "binary_sensor.bello": { entity_id: "binary_sensor.bello", state: "on", attributes: { friendly_name: "Bello" } }, "sensor.bello_area": { entity_id: "sensor.bello_area", state: "Garden", attributes: {} } };
      window.card.setConfig({ ...window.card.config, people: [{ person: "binary_sensor.bello", room: "sensor.bello_area", pet: true }] });
      window.card.hass = h;
    });
    await page.waitForFunction(() => window.card.renderer.peopleState().length === 1, null, { timeout: 5000 });
    const [p] = await page.evaluate(() => window.card.renderer.peopleState());
    assert(p.pet && p.level === "ground", JSON.stringify(p));
    await page.locator("homeslice-card .person ha-icon[icon='mdi:paw']").waitFor({ timeout: 3000 });
    await page.evaluate(() => {
      const { people, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
    await page.waitForFunction(() => window.card.renderer.peopleState().length === 0, null, { timeout: 5000 });
  });

  test("other cards on the card: in front and behind, only on their floors", async () => {
    await page.evaluate(() => {
      window.card.setConfig({
        ...window.card.config,
        overlays: [
          { card: { type: "tile", entity: "light.kitchen" }, top: "10px", right: "10px", width: "200px" },
          { card: { type: "tile", entity: "light.living_room" }, bottom: "10px", left: "10px", layer: "behind", levels: ["first"] },
        ],
      });
      window.card.requestUpdate();
    });
    await page.waitForSelector("homeslice-card .card-overlay.front .fake-card", { timeout: 5000 });
    const front = await page.locator("homeslice-card .card-overlay.front").boundingBox();
    const card = await page.locator("homeslice-card .wrap").boundingBox();
    assert(Math.abs(front.x + front.width - (card.x + card.width - 10)) < 2 && Math.abs(front.y - (card.y + 10)) < 2, `front card at ${JSON.stringify(front)}`);
    const behindShown = () => page.evaluate(() => !window.card.shadowRoot.querySelector(".card-overlay.behind").classList.contains("hidden"));
    assert(!(await behindShown()) || (await page.evaluate(() => window.card._level)) === "first", "the behind card shows on another floor");
    await shot(page, "demo-overlays");
    await page.evaluate(() => {
      const { overlays, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  test("layers: the viewer switches the heatmap on, and this device keeps it", async () => {
    await page.evaluate(() => {
      localStorage.removeItem("homeslice-layers:home");
      window.card.setConfig({ ...window.card.config, layers: ["heatmap", "values"] });
      window.card.requestUpdate();
    });
    await page.locator("homeslice-card .layers-open").click();
    await page.locator("homeslice-card .layers select").selectOption("temperature");
    await page.waitForFunction(() => window.card.config.heatmap === "temperature");
    // the card's own config again (a reload): the device's choice stays
    await page.evaluate(() => window.card.setConfig({ ...window.card.baseConfig }));
    assert((await page.evaluate(() => window.card.config.heatmap)) === "temperature", "the choice was not kept");
    await page.evaluate(() => {
      localStorage.removeItem("homeslice-layers:home");
      const { layers, heatmap, ...config } = window.card.baseConfig;
      window.card.setConfig(config);
      window.card._layersOpen = false;
      window.card.hass = window.card.hass;
    });
  });

  test("roofs: hip, shed and flat shapes, a covering, a roof window with its shutter", async () => {
    const build = (roof) =>
      act(page, async () => {
        await page.evaluate((roof) => {
          const m = structuredClone(window.__demoModel);
          m.roof = roof;
          window.viewBefore ??= window.card.config.view;
          window.card.setConfig({ ...window.card.config, view: { ...window.card.config.view, roof: true } });
          window.card.hass.pushModel(m);
        }, roof);
      });
    const triangles = () => page.evaluate(() => window.card.renderer.roof.children[0].geometry.attributes.position.count / 3);
    await build({ shape: "hip" });
    assert((await triangles()) === 6, `hip roof triangles: ${await triangles()}`);
    await build({ shape: "shed", high: "east", finish: "roof_metal" });
    assert((await triangles()) === 2, `shed roof triangles: ${await triangles()}`);
    await build({ shape: "flat", finish: "roof_green" });
    assert((await triangles()) === 2, `flat roof triangles: ${await triangles()}`);
    await build({ finish: "roof_slate", windows: [{ side: "east", at: 2, cover: "cover.living_room", contact: "binary_sensor.kids_room_leak" }, { side: "west", at: 3 }] });
    const win = () => page.evaluate(() => window.card.renderer.roofWindowState(0));
    await page.evaluate(() => window.card.hass.callService("cover", "close_cover", {}, { entity_id: "cover.living_room" }));
    await page.waitForFunction(() => window.card.renderer.roofWindowState(0)?.closed > 0.9, null, { timeout: 5000 });
    await page.evaluate(() => window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.living_room" }));
    await page.waitForFunction(() => window.card.renderer.roofWindowState(0)?.closed < 0.1, null, { timeout: 5000 });
    assert(!(await win()).open, "roof window open with its contact closed");
    await shot(page, "demo-roof-window");
    await act(page, () =>
      page.evaluate(() => {
        window.card.setConfig({ ...window.card.config, view: window.viewBefore });
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
  });

  test("a roof level: parts at any angle, one starting lower trims the walls below, solar panels on a slope", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        const top = m.levels.at(-1);
        m.levels.push({
          id: "roof",
          kind: "roof",
          name: "Roof",
          rooms: [],
          roofs: [
            { id: "main", rect: [0, 0, 10, 8], ridge: "left_right", shape: "gable", pitch: 40, offset: -1.2, finish: "roof_slate",
              furniture: [{ type: "item", model: "modern:solar_panel", at: [3, 6] }, { type: "item", model: "modern:solar_panel", at: [4.2, 6] }] },
            { id: "wing", rect: [10, 0, 3, 4], ridge: 30, shape: "shed", pitch: 12 },
          ],
        });
        window.viewBefore ??= window.card.config.view;
        window.card.setConfig({ ...window.card.config, view: { ...window.card.config.view, roof: true } });
        window.card.hass.pushModel(m);
      });
    });
    const state = await page.evaluate(() => {
      const r = window.card.renderer;
      const roofGroup = r.levels[r.levelIds.indexOf("roof")]?.group;
      let clipped = 0;
      r.levels[r.levelIds.length - 2].group.traverse((o) => {
        if (o.isMesh && o.userData.wallAt && [].concat(o.material).some((m) => m.clippingPlanes?.length)) clipped++;
      });
      // the main part: its roof, its gable ends and two panels
      const panels = (roofGroup?.children[0]?.children.length ?? 0) - 2;
      return { parts: roofGroup?.children.length ?? 0, clipped, panels, clipping: r.renderer.localClippingEnabled };
    });
    assert(state.parts === 2 && state.panels === 2, `roof parts drawn: ${JSON.stringify(state)}`);
    assert(state.clipped > 0 && state.clipping, `walls under the lowered roof not trimmed: ${JSON.stringify(state)}`);
    await shot(page, "demo-roof-level");
    await act(page, () =>
      page.evaluate(() => {
        window.card.setConfig({ ...window.card.config, view: window.viewBefore });
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
  });

});

test.describe.serial("demo house, roof (4)", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json", { view: { azimuth: 200, elevation: 45, roof: true } }));
  });
  test.afterAll(async () => {
    await page?.close();
  });


  test("dormers on the roof, a railing round a balcony", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.roof = { ...(m.roof ?? {}), dormers: [{ side: "south", at: 3 }, { side: "north", at: 5, shape: "shed" }, { side: "east", at: 3 }, { side: "west", at: 4, shape: "shed" }] };
        const garden = m.levels[0].rooms.find((r) => r.id === "garden");
        if (garden) garden.railing = "glass";
        window.viewBefore ??= window.card.config.view;
        window.card.setConfig({ ...window.card.config, view: { ...window.card.config.view, roof: true } });
        window.card.hass.pushModel(m);
      });
    });
    const roofParts = await page.evaluate(() => window.card.renderer.roof?.children.length ?? 0);
    assert(roofParts >= 3, `roof parts: ${roofParts}`);
    await shot(page, "demo-dormers");
    await act(page, () =>
      page.evaluate(() => {
        window.card.setConfig({ ...window.card.config, view: window.viewBefore });
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
  });

  test("lamp gestures: drag to dim, hold for the room, tap toggles", async () => {
    const lamp = page.locator("homeslice-card .label", { has: page.locator("button.name", { hasText: "Living Room" }) }).locator("button.lamp");
    const box = await lamp.boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    const calls = () => page.evaluate(() => window.card.hass.calls.length);
    // drag up: brighter, the level shown while dragging, one call at the end
    const before = await calls();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 5 });
    await page.mouse.move(x, y - 75, { steps: 5 });
    assert((await page.locator("homeslice-card .dim").count()) === 1, "no brightness shown while dragging");
    await page.mouse.up();
    const call = await page.evaluate(() => window.card.hass.calls.at(-1));
    assert((await calls()) === before + 1 && call.domain === "light" && call.service === "turn_on" && call.data.brightness_pct >= 50, `dim call: ${JSON.stringify(call)}`);
    assert((await page.locator("homeslice-card .dim").count()) === 0, "brightness still shown");
    await page.waitForTimeout(100);
    assert((await calls()) === before + 1, "the drag also toggled");
    // drag all the way down: off
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 200, { steps: 8 });
    await page.mouse.up();
    assert((await page.evaluate(() => window.card.hass.calls.at(-1).service)) === "turn_off", "dragging down did not turn off");
    // hold: the room's popup with its lights
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForSelector("homeslice-card .popup", { timeout: 3000 });
    await page.keyboard.press("Escape");
    // a tap still toggles
    const n = await calls();
    await lamp.click();
    assert((await calls()) === n + 1, "tap did not toggle");
  });

  test("light types: spots with their cones, an LED strip, indirect light on the walls", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        const rooms = m.levels[0].rooms;
        rooms.find((r) => r.id === "living").lights = [{ entity: "light.living_room", type: "spot", at: [1.5, 3], spots: [[2.5, 3], [3.5, 3]] }];
        rooms.find((r) => r.id === "kitchen").lights = [{ entity: "light.kitchen", type: "strip", at: [0.5, 0.4], to: [4.5, 0.4], height: 1.4 }];
        rooms.find((r) => r.id === "hall").lights = [{ entity: "light.hall", type: "indirect" }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(async () => {
        window.__wasOff = ["light.living_room", "light.kitchen", "light.hall"].filter((e) => window.card.hass.states[e].state !== "on");
        for (const e of window.__wasOff) await window.card.hass.callService("light", "turn_on", {}, { entity_id: e });
      });
    });
    const st = (e) => page.evaluate((e) => window.card.renderer.lampState(e), e);
    assert((await st("light.living_room")).count === 6 && (await st("light.living_room")).on, `spots: ${JSON.stringify(await st("light.living_room"))}`);
    assert((await st("light.kitchen")).count === 2, `strip: ${JSON.stringify(await st("light.kitchen"))}`);
    assert((await st("light.hall")).count >= 5, `indirect: ${JSON.stringify(await st("light.hall"))}`);
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await page.waitForTimeout(700);
    await shot(page, "demo-light-types");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await page.waitForTimeout(700);
    await act(page, () => page.evaluate(async () => {
      for (const e of window.__wasOff) await window.card.hass.callService("light", "turn_off", {}, { entity_id: e });
    }));
  });

  test("cameras: what they see on the floor, red while their motion sensor is on", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "kitchen").cameras = [{ entity: "camera.kitchen", at: [4.5, 0.3], direction: 225, motion: "binary_sensor.kitchen_motion" }];
        window.card.hass.pushModel(m);
      });
    });
    const st = await page.evaluate(() => window.card.renderer.cameraState("camera.kitchen"));
    const on = await page.evaluate(() => window.card.hass.states["binary_sensor.kitchen_motion"].state === "on");
    assert(st?.views === 1 && st.color === (on ? "ff4d4d" : "4fa3ff"), `camera: ${JSON.stringify(st)} (motion ${on})`);
    await shot(page, "demo-camera");
  });

  test("a lamp linked to a light glows with it, and a tap on it toggles the light", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").furniture = [{ type: "floor_lamp", model: "modern:floor_lamp_drum", at: [2, 2], entity: "light.reading_lamp" }];
        window.card.hass.pushModel(m);
      });
      await page.evaluate(() => window.card.renderer.modelsReady());
    });
    const glow = () => page.evaluate(() => (window.card.renderer.pieceGlows.get("light.reading_lamp") ?? []).map((m) => m.emissiveIntensity));
    const state = () => page.evaluate(() => window.card.hass.states["light.reading_lamp"].state);
    const before = await state();
    assert((await glow()).length > 0, "the lamp's shade and bulb are not linked");
    assert((await glow()).every((i) => (before === "on" ? i > 0.2 : i === 0)), `glow ${await glow()} for a light that is ${before}`);
    // tap on the lamp: where its shade is on screen
    const at = await page.evaluate(() => {
      const r = window.card.renderer;
      const piece = r.linked.find((g) => g.userData.entity === "light.reading_lamp");
      const p = new piece.position.constructor();
      piece.getWorldPosition(p);
      p.y += 1.3;
      p.project(r.camera);
      const canvas = window.card.shadowRoot.querySelector("canvas").getBoundingClientRect();
      return { x: canvas.left + ((p.x + 1) / 2) * canvas.width, y: canvas.top + ((1 - p.y) / 2) * canvas.height };
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction((b) => window.card.hass.states["light.reading_lamp"].state !== b, before, { timeout: 3000 });
    await page.waitForTimeout(300);
    const after = await state();
    assert((await glow()).every((i) => (after === "on" ? i > 0.2 : i === 0)), `glow ${await glow()} after the tap (${after})`);
    await shot(page, "demo-lamp-linked");
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction((b) => window.card.hass.states["light.reading_lamp"].state === b, before, { timeout: 3000 });
    // a long press opens its details (colour, temperature) instead
    await page.evaluate(() => (window.__moreInfo = null, window.card.addEventListener("hass-more-info", (e) => (window.__moreInfo = e.detail.entityId))));
    const n = await page.evaluate(() => window.card.hass.calls.length);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert((await page.evaluate(() => window.__moreInfo)) === "light.reading_lamp", "a long press did not open the lamp's details");
    assert((await page.evaluate(() => window.card.hass.calls.length)) === n, "a long press also toggled");
    // the pointer off the house again (hovering a level hides the roof)
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
  });

  test("simple furniture when the card asks for it", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, view: { ...window.card.config.view, furniture: "simple" } });
      window.card.hass = window.card.hass; // HA sends states all the time; the card reloads on the next
    });
    await page.waitForFunction(
      () => {
        let n = 0;
        window.card.renderer.object.traverse((o) => o.isMesh && o.userData.shared && n++);
        return n === 0;
      },
      null,
      { timeout: 10000 },
    );
  });

  test("robots: the vacuum at its live position, with its status and battery", async () => {
    const robots = await page.evaluate(() => window.card.renderer.robotState());
    assert(robots.length === 1 && robots[0].visible && robots[0].at[0] === 2.5 && robots[0].at[1] === 2.5 && robots[0].color === "#4caf50", `robots: ${JSON.stringify(robots)}`);
    const label = await page.locator("homeslice-card .robot-label").getAttribute("aria-label");
    assert(label.includes("Robo") && label.includes("cleaning") && label.includes("64 %"), `label: ${label}`);
    assert((await page.locator("homeslice-card .robot-label").textContent()).includes("64 %"), "battery not shown");
    // docked: back at the dock, grey
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "vacuum.robo": { ...h.states["vacuum.robo"], state: "docked", attributes: { ...h.states["vacuum.robo"].attributes, vacuum_position: { x: 24800, y: 27300 } } } } };
      }),
    );
    const docked = await page.evaluate(() => window.card.renderer.robotState()[0]);
    assert(docked.color === "#9e9e9e" && Math.abs(docked.at[0] - 0.8) < 1e-6 && Math.abs(docked.at[1] - 3.3) < 1e-6, `docked: ${JSON.stringify(docked)}`);
    // it drives there (about 0.3 m/s), it doesn't jump
    assert(Math.hypot(docked.drawn[0] - 0.8, docked.drawn[1] - 3.3) > 0.3, `jumped: ${JSON.stringify(docked)}`);
    await page.waitForFunction(() => {
      const r = window.card.renderer.robotState()[0];
      return Math.hypot(r.drawn[0] - 0.8, r.drawn[1] - 3.3) < 1e-3;
    }, null, { timeout: 8000 });
  });

  test("robots: a Roborock answers its position when asked (a service, not an attribute)", async () => {
    await act(page, async () => {
      await page.evaluate(() => {
        window.card.hass.robotPositions["vacuum.robo"] = [26500, 25500];
        const m = structuredClone(window.__demoModel);
        m.robots[0].position = { service: "roborock.get_vacuum_current_position", points: m.robots[0].position.points };
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "vacuum.robo": { ...h.states["vacuum.robo"], state: "cleaning" } } };
        window.card.hass.pushModel(m);
      });
    });
    await page.waitForFunction(() => window.card.renderer.robotState()[0]?.at[0] === 2.5, null, { timeout: 5000 });
    const at = await page.evaluate(() => window.card.renderer.robotState()[0].at);
    // map (26500, 25500) with the demo's calibration: plan (2.5, 1.5)
    assert(Math.abs(at[0] - 2.5) < 1e-6 && Math.abs(at[1] - 1.5) < 1e-6, `robot at ${at}`);
    // it moves: the next answer
    await page.evaluate(() => (window.card.hass.robotPositions["vacuum.robo"] = [25500, 25500]));
    await page.waitForFunction(() => Math.abs(window.card.renderer.robotState()[0].at[0] - 1.5) < 1e-6, null, { timeout: 6000 });
    // a robot that never says where it is while cleaning: faded at its dock, the label says so
    await act(page, async () => {
      await page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.robots[0].position = { entity: "vacuum.silent", service: "roborock.get_vacuum_current_position", points: m.robots[0].position.points };
        window.card.hass.pushModel(m);
      });
    });
    await page.waitForFunction(() => window.card.renderer.robotState()[0]?.unsure, null, { timeout: 5000 });
    const unsure = await page.evaluate(() => window.card.renderer.robotState()[0]);
    assert(Math.abs(unsure.at[0] - 0.8) < 1e-6 && Math.abs(unsure.at[1] - 3.3) < 1e-6, `unsure robot: ${JSON.stringify(unsure)}`);
    assert((await page.locator("homeslice-card .robot-label").getAttribute("aria-label")).includes("position not reported") || (await page.locator("homeslice-card .robot-label").textContent()).includes("position not reported"), "the label doesn't say the position is missing");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(structuredClone(window.__demoModel))));
  });

  test("robots: the map picture lies on the floor while the robot is out, not when docked", async () => {
    await page.route("**/api/image_proxy/image.robo_map**", (route) => route.fulfill({ contentType: "image/png", body: readFileSync("dev/fixtures/robot-map.png") }));
    const set = (robot, picture) =>
      act(page, () =>
        page.evaluate(
          ([robot, picture]) => {
            const h = window.card.hass;
            window.card.hass = {
              ...h,
              states: {
                ...h.states,
                "vacuum.robo": { ...h.states["vacuum.robo"], state: robot },
                "image.robo_map": { entity_id: "image.robo_map", state: picture, attributes: { entity_picture: "/api/image_proxy/image.robo_map?token=t" } },
              },
            };
          },
          [robot, picture],
        ),
      );
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        // the 240 × 160 px picture over the ground floor, 12.5 mm a pixel... drawn larger to see it
        m.robots[0].map = { entity: "image.robo_map", size: [240, 160], origin: [0.5, 0.5], scale: 0.03 };
        window.card.hass.pushModel(m);
      }),
    );
    await set("cleaning", "2026-11-03T10:00:00");
    await page.waitForFunction(() => window.card.renderer.robotMapsShown().length === 1, null, { timeout: 8000 });
    await shot(page, "demo-robot-map");
    await set("docked", "2026-11-03T10:20:00");
    await page.waitForFunction(() => window.card.renderer.robotMapsShown().length === 0, null, { timeout: 5000 });
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
  });

  test("robots: a warning at the dock when it needs something (water, bag, maintenance)", async () => {
    const needs = (on) =>
      act(page, () =>
        page.evaluate((on) => {
          const h = window.card.hass;
          window.card.hass = {
            ...h,
            devices: { ...h.devices, robo_dev: { id: "robo_dev", name: "Robo" }, robo_dock: { id: "robo_dock", name: "Robo Dock" } },
            entities: {
              ...h.entities,
              "vacuum.robo": { ...(h.entities["vacuum.robo"] ?? { entity_id: "vacuum.robo" }), device_id: "robo_dev" },
              "binary_sensor.robo_water_shortage": { entity_id: "binary_sensor.robo_water_shortage", device_id: "robo_dev" },
              "sensor.robo_dock_brush_time_left": { entity_id: "sensor.robo_dock_brush_time_left", device_id: "robo_dock" },
            },
            states: {
              ...h.states,
              "binary_sensor.robo_water_shortage": { entity_id: "binary_sensor.robo_water_shortage", state: on ? "on" : "off", attributes: { device_class: "problem", friendly_name: "Robo Water shortage" } },
              "sensor.robo_dock_brush_time_left": { entity_id: "sensor.robo_dock_brush_time_left", state: on ? "-5" : "40", attributes: { device_class: "duration", friendly_name: "Robo Dock Brush time left" } },
            },
          };
        }, on),
      );
    await needs(true);
    const alert = page.locator("homeslice-card .dock-alert");
    assert((await alert.count()) === 1, "no warning at the dock");
    const label = await alert.getAttribute("aria-label");
    assert(label.includes("Water shortage") && label.includes("Brush time left"), `warning: ${label}`);
    await shot(page, "demo-dock-alert");
    await needs(false);
    assert((await alert.count()) === 0, "warning stays when all is well");
  });

  test("the real sun lights the house; at night it is dark", async () => {
    const setSun = (azimuth, elevation) =>
      act(page, () =>
        page.evaluate(([azimuth, elevation]) => {
          const h = window.card.hass;
          window.card.hass = { ...h, states: { ...h.states, "sun.sun": { entity_id: "sun.sun", state: elevation > 0 ? "above_horizon" : "below_horizon", attributes: { azimuth, elevation } } } };
        }, [azimuth, elevation]),
      );
    await setSun(180, 30);
    let sun = await page.evaluate(() => window.card.renderer.sunState());
    // from the south: +z in the scene
    assert(sun.at.azimuth === 180 && sun.position[2] > 0.5 && sun.intensity > 2, `noon: ${JSON.stringify(sun)}`);
    await setSun(300, -20);
    sun = await page.evaluate(() => window.card.renderer.sunState());
    assert(sun.intensity === 0, `night: ${JSON.stringify(sun)}`);
    await shot(page, "demo-night");
    await setSun(180, 30);
  });

  test("the roof shows in the overview only", async () => {
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.azimuth === 200 && o.elevation === 45, `camera ${JSON.stringify(o)}`);
    assert(await page.evaluate(() => window.card.renderer.roofVisible()), "roof not shown");
    await shot(page, "demo-roof");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    assert(!(await page.evaluate(() => window.card.renderer.roofVisible())), "roof still shown with a floor picked");
    assert(errors.length === 0, errors.join(" | "));
  });

});
