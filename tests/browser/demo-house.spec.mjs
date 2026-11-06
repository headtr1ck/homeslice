// demo house
import { test } from "@playwright/test";
import { parse } from "yaml";
import { join } from "node:path";
import { act, assert, browser, calls, labelNames, lamp, open, out, setBrowser, shot, state, triangles } from "./helpers.mjs";

test.describe.serial("demo house (1)", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json"));

  });
  test.afterAll(async () => {
    await page?.close();
  });


  test("renders walls, floors and every room label", async () => {
    assert((await triangles(page)) > 500, `only ${await triangles(page)} triangles drawn`);
    const names = await labelNames(page);
    for (const n of ["Hall", "Kitchen", "Living Room", "Garden", "Bedroom", "Bathroom", "Kids Room"])
      assert(names.includes(n), `label "${n}" missing (got ${names.join(", ")})`);
    await shot(page, "demo-overview");
  });

  test("finds lights through their device's area", async () => {
    assert((await lamp(page, "Kitchen").count()) === 1, "no lamp button for the kitchen (light only has a device area)");
  });

  test("lamp button turns the room's lights on", async () => {
    await act(page, () => lamp(page, "Kitchen").click());
    const last = (await calls(page)).at(-1);
    assert(last.domain === "light" && last.service === "turn_on" && JSON.stringify(last.target.entity_id) === '["light.kitchen"]', `unexpected call ${JSON.stringify(last)}`);
    assert((await state(page, "light.kitchen")) === "on", "kitchen light still off");
    assert(await lamp(page, "Kitchen").evaluate((b) => b.classList.contains("on")), "kitchen lamp button not shown as on");
    await shot(page, "demo-kitchen-on");
  });

  test("a short note says what a tap did; feedback: false hides it", async () => {
    const note = () => page.evaluate(() => document.querySelector("homeslice-card").shadowRoot.querySelector(".note")?.textContent ?? null);
    assert((await note()) === "Kitchen: lights on", `note ${await note()}`);
    await page.evaluate(() => window.card.setConfig({ ...window.card.config, feedback: false }));
    await act(page, () => lamp(page, "Kitchen").click());
    await act(page, () => lamp(page, "Kitchen").click());
    await page.waitForFunction(() => !document.querySelector("homeslice-card").shadowRoot.querySelector(".note"), null, { timeout: 4000 });
    await page.evaluate(() => {
      const { feedback, ...config } = window.card.config;
      window.card.setConfig(config);
    });
  });

  test("a tap on a TV opens its media panel: play, sources, volume, details", async () => {
    await page.evaluate(() => window.card.hass.setState("media_player.living_room_tv", "idle", { media_title: "News" }));
    await page.evaluate(() => window.card.useEntity("media_player.living_room_tv"));
    const panel = page.locator("homeslice-card .popup .media");
    await panel.waitFor();
    assert((await panel.locator(".what strong").textContent()) === "News", "not showing what plays");
    await panel.locator("button[aria-label='Play']").click();
    await page.waitForFunction(() => window.card.hass.states["media_player.living_room_tv"].state === "playing");
    await panel.locator("button[aria-label='Pause']").waitFor();
    await panel.locator(".sources button", { hasText: "Netflix" }).click();
    await page.waitForFunction(() => window.card.hass.states["media_player.living_room_tv"].attributes.source === "Netflix");
    await panel.locator(".sources button.on", { hasText: "Netflix" }).waitFor();
    await shot(page, "demo-media");
    await panel.locator(".volume input").fill("60");
    await page.waitForFunction(() => window.card.hass.states["media_player.living_room_tv"].attributes.volume_level === 0.6);
    await page.evaluate(() => {
      window.moreInfo = [];
      window.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId));
    });
    await panel.locator("button.details").click();
    assert((await page.evaluate(() => window.moreInfo)).includes("media_player.living_room_tv"), "details didn't open");
    assert(!(await page.locator("homeslice-card .popup").count()), "panel still open");
    await page.evaluate(() => window.card.hass.setState("media_player.living_room_tv", "off", { media_title: undefined, source: "Live TV", volume_level: 0.3 }));
  });

  test("doors: a smart lock to tap, a silent contact, what is open while the alarm goes off", async () => {
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        h.setState("lock.front_door", "unlocked", { friendly_name: "Front door lock" });
        h.setState("binary_sensor.patio_door", "unavailable", { friendly_name: "Patio door", device_class: "door" });
        h.setState("alarm_control_panel.home", "armed_away", {});
        const m = structuredClone(window.__demoModel);
        const ops = m.levels[0].openings;
        ops[0].lock = "lock.front_door";
        ops[3].contact = "binary_sensor.patio_door";
        h.pushModel(m);
      }),
    );
    const badges = () => page.evaluate(() => [...document.querySelector("homeslice-card").shadowRoot.querySelectorAll(".opening-badge")].map((b) => ({ icon: b.querySelector("ha-icon").getAttribute("icon"), text: b.title, urgent: b.classList.contains("urgent") })));
    await page.waitForFunction(() => document.querySelector("homeslice-card").shadowRoot.querySelectorAll(".opening-badge").length === 2);
    let list = await badges();
    assert(list.some((b) => b.icon === "mdi:lock-open-variant" && b.text === "Unlocked"), `no unlocked lock: ${JSON.stringify(list)}`);
    assert(list.some((b) => b.icon === "mdi:access-point-off" && b.text === "Patio door not reporting"), `no silent contact: ${JSON.stringify(list)}`);
    await act(page, () => page.locator("homeslice-card .opening-badge.lock").click());
    const last = (await calls(page)).at(-1);
    assert(last.domain === "lock" && last.service === "lock", `lock call ${JSON.stringify(last)}`);
    await page.waitForFunction(() => document.querySelector("homeslice-card").shadowRoot.querySelector(".opening-badge.lock ha-icon")?.getAttribute("icon") === "mdi:lock");
    // the patio door opens, then the alarm goes off: it is the suspect
    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("binary_sensor.patio_door", "on");
        window.card.hass.setState("alarm_control_panel.home", "triggered");
      }),
    );
    await page.waitForFunction(() => [...document.querySelector("homeslice-card").shadowRoot.querySelectorAll(".opening-badge")].some((b) => b.classList.contains("urgent")));
    list = await badges();
    assert(list.some((b) => b.icon === "mdi:alarm-light" && b.urgent && b.text.startsWith("Patio door")), `no alarm note: ${JSON.stringify(list)}`);
    await shot(page, "demo-door-notes");
    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("alarm_control_panel.home", "disarmed");
        window.card.hass.pushModel(window.__demoModel);
      }),
    );
    await page.waitForFunction(() => !document.querySelector("homeslice-card").shadowRoot.querySelector(".opening-badge"));
  });

  test("climate hints: a humid room is a note (air it, mould risk), not an alarm", async () => {
    const label = () =>
      page.evaluate(() => {
        const l = [...document.querySelector("homeslice-card").shadowRoot.querySelectorAll(".label")].find((x) => x.textContent.includes("Living Room"));
        return { cls: l.className, icons: [...l.querySelectorAll(".alert-icon")].map((i) => i.getAttribute("icon")) };
      });
    // (nothing to redraw without the hints)
    await page.evaluate(() => window.card.hass.setState("sensor.living_room_humidity", "74"));
    await page.waitForTimeout(300);
    assert(!(await label()).icons.length, "a hint without climate_hints");
    await act(page, () => page.evaluate(() => window.card.setConfig({ ...window.card.config, climate_hints: true })));
    let l = await label();
    assert(l.icons.includes("mdi:water-percent-alert") && l.cls.includes("note") && !l.cls.includes("alert"), `mould: ${JSON.stringify(l)}`);
    await act(page, () => page.evaluate(() => window.card.hass.setState("sensor.living_room_humidity", "63")));
    l = await label();
    assert(l.icons.includes("mdi:window-open-variant"), `air: ${JSON.stringify(l)}`);
    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("sensor.living_room_humidity", "48");
        const { climate_hints, ...config } = window.card.config;
        window.card.setConfig(config);
      }),
    );
  });

  test("warnings: a strip of what needs attention; a tap shows where", async () => {
    await page.evaluate(() => window.card.setConfig({ ...window.card.config, warnings: true }));
    await act(page, () => page.evaluate(() => window.card.hass.setState("binary_sensor.kids_room_leak", "on")));
    const strip = page.locator("homeslice-card .warnings button");
    await strip.first().waitFor();
    const text = await strip.first().textContent();
    assert(text.includes("Leak") && text.includes("Kids Room") && (await strip.first().getAttribute("class")).includes("urgent"), `strip: ${text}`);
    await strip.first().click();
    await page.waitForFunction(() => window.card._level === "first" && window.card._event?.includes("Kids Room"));
    await act(page, () =>
      page.evaluate(() => {
        window.card.hass.setState("binary_sensor.kids_room_leak", "off");
        const { warnings, ...config } = window.card.config;
        window.card.setConfig(config);
        clearTimeout(window.card.eventTimer);
        window.card._event = null;
        window.card.eventReturn = undefined;
      }),
    );
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    await page.waitForFunction(() => !window.card.transitioning);
  });

  test("hidden entities don't count and aren't switched", async () => {
    await act(page, () => lamp(page, "Living Room").click());
    assert((await calls(page)).at(-1).service === "turn_off", "living room lamp should have turned lights off");
    assert((await state(page, "light.tablet_screen")) === "on", "hidden tablet screen light was switched off");
    assert(!(await lamp(page, "Living Room").evaluate((b) => b.classList.contains("on"))), "living room still shown as on (hidden light counted?)");
  });

  test("lamps glow where they are and follow their light", async () => {
    const lampState = (e) => page.evaluate((e) => window.card.renderer.lampState(e), e);
    assert(JSON.stringify(await lampState("light.kitchen")) === '{"count":1,"on":true}', `kitchen lamp: ${JSON.stringify(await lampState("light.kitchen"))}`);
    assert(JSON.stringify(await lampState("light.reading_lamp")) === '{"count":1,"on":false}', "reading lamp");
    assert((await lampState("light.tablet_screen")) === null, "hidden light got a lamp");
  });

  test("floor picker hides the floors above", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    let names = await labelNames(page);
    assert(!names.includes("Bedroom") && names.includes("Kitchen"), `labels after selecting ground floor: ${names.join(", ")}`);
    await shot(page, "demo-ground-floor");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    names = await labelNames(page);
    assert(names.includes("Bedroom"), "bedroom label not back after 'All floors'");
  });

  test("a saved model change shows up at once and keeps the focused floor", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        const model = JSON.parse(JSON.stringify(window.__demoModel));
        model.levels[0].rooms.find((r) => r.id === "kitchen").area_id = "garden";
        h.pushModel(model);
      }),
    );
    const names = await labelNames(page);
    assert(names.filter((n) => n === "Garden").length === 2, `kitchen should now be labelled Garden: ${names.join(", ")}`);
    assert((await page.evaluate(() => window.card.renderer.focusedIndex)) === 0, "focused floor lost after the update");
    await act(page, () => page.evaluate(() => window.card.hass.pushModel(window.__demoModel)));
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
  });

  test("unrelated state changes don't redraw anything", async () => {
    // first let the card settle (pieces still being drawn redraw it once)
    await page.evaluate(async () => {
      await window.card.renderer.modelsReady();
      let last = performance.now();
      const seen = () => (last = performance.now());
      window.card.addEventListener("homeslice-rendered", seen);
      while (performance.now() - last < 600) await new Promise((r) => setTimeout(r, 100));
      window.card.removeEventListener("homeslice-rendered", seen);
    });
    const draws = await page.evaluate(async () => {
      let n = 0;
      const count = () => n++;
      window.card.addEventListener("homeslice-rendered", count);
      for (let i = 0; i < 5; i++) {
        await window.card.hass.callService("media_player", i % 2 ? "turn_off" : "turn_on", {}, { entity_id: "media_player.living_room_tv" });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      window.card.removeEventListener("homeslice-rendered", count);
      return n;
    });
    // five changes: not one redraw each (one stray frame on a slow machine is no harm)
    assert(draws <= 1, `${draws} redraws for a media player the card doesn't show`);
  });

});

test.describe.serial("demo house (2)", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json"));

  });
  test.afterAll(async () => {
    await page?.close();
  });


  test("labels show the area temperature", async () => {
    const temp = await page.locator("homeslice-card .label button.name", { hasText: "Living Room" }).locator(".temp").textContent();
    assert(temp === "21.4 °C", `living room temperature label: ${temp}`);
  });

  test("rooms show presence, and alarms in red", async () => {
    const label = (name) => page.locator("homeslice-card .label", { has: page.locator("button.name", { hasText: name }) });
    assert((await label("Kitchen").locator("ha-icon.presence").count()) === 1, "no presence mark in the kitchen");
    assert((await label("Kids Room").locator("ha-icon.presence").count()) === 0, "presence mark without motion");
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "binary_sensor.kids_room_leak": { ...h.states["binary_sensor.kids_room_leak"], state: "on" } } };
      }),
    );
    assert(await label("Kids Room").evaluate((el) => el.classList.contains("alert")), "leak not shown on the kids room");
    await shot(page, "demo-alarm");
    await act(page, () =>
      page.evaluate(() => {
        const h = window.card.hass;
        window.card.hass = { ...h, states: { ...h.states, "binary_sensor.kids_room_leak": { ...h.states["binary_sensor.kids_room_leak"], state: "off" } } };
      }),
    );
    assert(!(await label("Kids Room").evaluate((el) => el.classList.contains("alert"))), "alarm stays after the leak is gone");
  });

  test("shutters follow the cover position", async () => {
    const shutter = () => page.evaluate(() => window.card.renderer.coverState("bedroom_north_0"));
    let s = await shutter();
    assert(s.shutterVisible && !s.stripVisible && Math.abs(s.shutterHeight - 1.3) < 1e-6, `closed bedroom shutter: ${JSON.stringify(s)}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "set_cover_position", { position: 50 }, { entity_id: "cover.bedroom" })));
    s = await shutter();
    assert(s.shutterVisible && Math.abs(s.shutterHeight - 0.65) < 1e-6, `half-open bedroom shutter: ${JSON.stringify(s)}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.bedroom" })));
    s = await shutter();
    assert(!s.shutterVisible, `open bedroom shutter still shown: ${JSON.stringify(s)}`);
    await shot(page, "demo-shutter-open");
  });

  test("the awning follows its cover position", async () => {
    const state = () => page.evaluate(() => window.card.renderer.awningState("ground", "garden"));
    assert(Math.abs((await state()) - 0.6) < 0.01, `awning at 60 %: ${await state()}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "close_cover", {}, { entity_id: "cover.awning" })));
    assert((await state()) === 0, `closed awning still drawn: ${await state()}`);
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "open_cover", {}, { entity_id: "cover.awning" })));
    assert((await state()) === 1, `open awning: ${await state()}`);
    await shot(page, "awning");
  });

  test("cut walls show the cover state as a strip", async () => {
    const strip = await page.evaluate(() => window.card.renderer.coverState("living_south_2"));
    assert(strip?.stripVisible && !strip.shutterVisible, `living room south window should be a strip on the cut wall: ${JSON.stringify(strip)}`);
    assert(strip.stripColor === "7fb0ff", `fully open cover should be blue, got #${strip.stripColor}`);
  });

  test("picking a floor shows it from above in perspective, only its labels", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 65 && o.azimuth === 180 && o.fov === 40, `focus camera ${JSON.stringify(o)}`);
    const names = await labelNames(page);
    assert(names.includes("Kitchen") && !names.includes("Bedroom") && !names.includes("Kids Room"), `labels: ${names.join(", ")}`);
    await shot(page, "demo-ground-top");
  });

  test("steep floor views show full walls with shutters instead of strips", async () => {
    await act(page, () => page.evaluate(() => window.card.hass.callService("cover", "set_cover_position", { position: 30 }, { entity_id: "cover.living_room" })));
    const c = await page.evaluate(() => window.card.renderer.coverState("living_south_2"));
    assert(c.shutterVisible && !c.stripVisible, `living room cover in the floor view: ${JSON.stringify(c)}`);
    await shot(page, "demo-ground-shutter");
  });

  test("tapping a room on the plan opens its popup with HA cards", async () => {
    const label = await page.locator("homeslice-card .label button.name", { hasText: "Living Room" }).boundingBox();
    // tap the floor a bit away from the label, so the canvas gets the click
    await page.mouse.click(label.x + label.width / 2 + 60, label.y + label.height / 2 + 40);
    await page.waitForSelector("homeslice-card .popup .fake-card", { timeout: 5000 });
    await page.waitForTimeout(300); // fade-in
    const title = await page.locator("homeslice-card .popup h2").textContent();
    assert(title === "Living Room", `popup title ${title}`);
    const sections = await page.locator("homeslice-card .popup h3").allTextContents();
    assert(sections.join(",") === "Lights,Blinds,Climate,Media,Sensors", `sections: ${sections.join(",")}`);
    const cards = await page.locator("homeslice-card .popup .fake-card").allTextContents();
    assert(cards.some((c) => c.startsWith("tile light.living_room")), `cards: ${cards.join(" | ")}`);
    assert(!cards.some((c) => c.includes("tablet_screen")), "hidden entity in popup");
    await shot(page, "demo-popup");
  });

  test("popup cards follow state changes and the popup closes with Escape", async () => {
    await page.evaluate(() => window.card.hass.callService("light", "turn_on", {}, { entity_id: "light.living_room" }));
    await page.evaluate(() => window.card.hass.callService("light", "turn_off", {}, { entity_id: "light.living_room" }));
    const card = await page.locator("homeslice-card .popup .fake-card", { hasText: "light.living_room" }).textContent();
    assert(card.endsWith("off"), `popup card not updated: ${card}`);
    await page.keyboard.press("Escape");
    assert((await page.locator("homeslice-card .popup").count()) === 0, "popup still open after Escape");
  });

  test("a room's popup includes its awning even without an area", async () => {
    await page.locator("homeslice-card .label button.name", { hasText: "Garden" }).click();
    await page.waitForSelector("homeslice-card .popup .fake-card", { timeout: 5000 });
    const cards = await page.locator("homeslice-card .popup .fake-card").allTextContents();
    assert(cards.some((c) => c.startsWith("tile cover.awning")), `cards: ${cards.join(" | ")}`);
    await page.keyboard.press("Escape");
  });

  test("room labels show the chosen readings, stale air with a dot", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, values: ["temperature", "humidity", "carbon_dioxide"] });
      window.card.hass = window.card.hass;
    });
    const label = page.locator("homeslice-card .label", { hasText: "Living Room" }).first();
    await page.waitForFunction(() => document.querySelector("homeslice-card").shadowRoot.textContent.includes("1240 ppm"), null, { timeout: 5000 });
    const text = (await label.locator("span.temp").textContent()).replace(/\s+/g, " ");
    assert(text.includes("21.4 °C · 48% · 1240 ppm"), `label: ${text}`);
    assert((await label.locator("i.dot").count()) === 1, "no dot for the stale air");
    await shot(page, "demo-values");
    await page.evaluate(() => {
      const { values, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.hass = window.card.hass;
    });
  });

  test("lamp buttons are bare bulbs, or bulbs in a circle with lamp_style: circle", async () => {
    const background = () => page.evaluate(() => getComputedStyle(document.querySelector("homeslice-card").shadowRoot.querySelector(".lamp")).backgroundColor);
    assert((await background()) === "rgba(0, 0, 0, 0)", `bare lamp background ${await background()}`);
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, lamp_style: "circle" });
      window.card.requestUpdate();
    });
    await page.waitForFunction(() => document.querySelector("homeslice-card").shadowRoot.querySelector("ha-card:not(.bare-lamps)"));
    assert((await background()) !== "rgba(0, 0, 0, 0)", "no circle");
    await page.evaluate(() => {
      const { lamp_style, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  test("wall tablet: back to the start view when idle, a clock, dimmed at night", async () => {
    const now = new Date();
    const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const night = `${hhmm(new Date(now - 3600e3))}-${hhmm(new Date(+now + 3600e3))}`;
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    await page.evaluate((night) => window.card.setConfig({ ...window.card.config, idle_return: 1, clock: true, night }), night);
    // a touch starts the idle time
    await page.evaluate(() => window.card.dispatchEvent(new PointerEvent("pointerdown")));
    await page.waitForFunction(() => window.card._level === null, null, { timeout: 5000 });
    const clock = await page.locator("homeslice-card .clock").textContent();
    assert(/\d\d:\d\d/.test(clock), `clock: ${clock}`);
    assert(await page.locator("homeslice-card ha-card.night-dim").count(), "not dimmed at night");
    await page.evaluate(() => {
      const { idle_return, clock, night, ...config } = window.card.config;
      window.card.setConfig(config);
    });
    await page.waitForFunction(() => !window.card.shadowRoot.querySelector("ha-card.night-dim"));
  });

});

test.describe.serial("demo house (3)", () => {
  let page, errors;
  test.beforeAll(async ({ browser: b }) => {
    setBrowser(b);
    ({ page, errors } = await open("dev/fixtures/demo-hass.json"));

  });
  test.afterAll(async () => {
    await page?.close();
  });


  test("room_panel: false keeps rooms from opening their panel", async () => {
    await page.evaluate(() => (window.card.config.room_panel = false));
    await page.locator("homeslice-card .label button.name", { hasText: "Garden" }).click();
    await page.waitForTimeout(300);
    const open = await page.locator("homeslice-card .popup").count();
    await page.evaluate(() => delete window.card.config.room_panel);
    assert(open === 0, "a room opened its panel");
  });

  test("a stairwell is a dark shaft while the floor below is hidden", async () => {
    const wells = () => page.evaluate(() => window.card.renderer.levels.map((l) => l.group.children.filter((c) => c.userData.well).map((c) => c.visible)));
    const all = await wells();
    assert(all[1].length > 0 && all[1].every((v) => !v), `overview wells: ${JSON.stringify(all)}`);
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    await page.waitForFunction(() => !window.card.renderer.levels[0].group.visible, null, { timeout: 5000 });
    const focused = await wells();
    assert(focused[1].every((v) => v), `first floor wells: ${JSON.stringify(focused)}`);
    await shot(page, "demo-well");
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
  });

  test("a room without devices shows a hint", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).click());
    // one floor on its own: the ground floor has sunk away and is not drawn at all
    await page.waitForFunction(() => !window.card.renderer.levels[0].group.visible, null, { timeout: 5000 });
    assert(await page.evaluate(() => window.card.renderer.levels[0].lift < -1), "the floor below did not sink away");
    await page.locator("homeslice-card .label button.name", { hasText: "Bathroom" }).click();
    const text = await page.locator("homeslice-card .popup .empty").textContent();
    assert(text.includes("Nothing in this room"), `empty popup text: ${text}`);
    await page.locator("homeslice-card .backdrop").click({ position: { x: 5, y: 5 } });
    assert((await page.locator("homeslice-card .popup").count()) === 0, "popup still open after tapping outside");
  });

  test("a focused floor shows a toggle per lamp in rooms with several lights", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click());
    const buttons = page.locator("homeslice-card button.lamp.single");
    assert((await buttons.count()) === 2, `lamp toggles: ${await buttons.count()}`);
    await act(page, () => page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click());
    assert((await state(page, "light.reading_lamp")) === "on", "reading lamp not switched on");
    assert((await page.evaluate(() => window.card.renderer.lampState("light.reading_lamp"))).on, "reading lamp not drawn lit");
    await shot(page, "demo-lamps");
    await act(page, () => page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click());
  });

  test("lamp groups: pieces on one light share a button, a lamp's group switches all", async () => {
    // still on the ground floor: two pendants on the living room light, the reading lamp in its group
    const before = { living: await state(page, "light.living_room"), reading: await state(page, "light.reading_lamp") };
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        const living = m.levels[0].rooms.find((r) => r.id === "living");
        living.furniture = [
          { type: "ceiling_lamp", at: [2, 2], entity: "light.living_room" },
          { type: "ceiling_lamp", at: [4, 2], entity: "light.living_room" },
          { type: "floor_lamp", at: [1, 4], entity: "light.reading_lamp" },
        ];
        window.card.hass.pushModel(m);
      }),
    );
    let buttons = page.locator("homeslice-card button.lamp.single");
    assert((await buttons.count()) === 2, `one button per light: ${await buttons.count()}`);
    assert((await page.evaluate(() => window.card.renderer.lampState("light.living_room")?.parts ?? window.card.lamps.filter((l) => l.entity === "light.living_room").length)) >= 2, "both pendants not lit by the light");
    await act(page, () =>
      page.evaluate(() => {
        const m = structuredClone(window.__demoModel);
        m.levels[0].rooms.find((r) => r.id === "living").lights = [{ entity: "light.living_room", at: [3, 2], with: ["light.reading_lamp"] }, { entity: "light.reading_lamp", at: [1, 4] }];
        window.card.hass.pushModel(m);
      }),
    );
    buttons = page.locator("homeslice-card button.lamp.single");
    await page.waitForFunction(() => document.querySelector("homeslice-card").shadowRoot.querySelectorAll("button.lamp.single").length === 1);
    const was = await state(page, "light.living_room");
    await act(page, () => buttons.first().click());
    const now = [await state(page, "light.living_room"), await state(page, "light.reading_lamp")];
    assert(now[0] !== was && now[0] === now[1], `group switched: ${was} → ${now}`);
    await act(page, () =>
      page.evaluate((before) => {
        window.card.hass.setState("light.living_room", before.living);
        window.card.hass.setState("light.reading_lamp", before.reading);
        window.card.hass.pushModel(window.__demoModel);
      }, before),
    );
  });

  test("a right click on a lamp opens its details", async () => {
    await page.evaluate(() => {
      window.moreInfo = [];
      window.addEventListener("hass-more-info", (e) => window.moreInfo.push(e.detail.entityId));
    });
    await page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click({ button: "right" });
    assert((await page.evaluate(() => window.moreInfo)).includes("light.reading_lamp"), "no details on right click");
    assert((await state(page, "light.reading_lamp")) === "off", "right click toggled the lamp");
  });

  test("own tap and hold actions go to HA's action handler instead of toggling", async () => {
    await page.evaluate(() => {
      window.actions = [];
      window.addEventListener("hass-action", (e) => window.actions.push(e.detail));
      window.card.setConfig({ ...window.card.config, actions: { "light.reading_lamp": { tap_action: { action: "more-info" } } } });
    });
    await page.locator('homeslice-card button.lamp.single[title="Reading lamp"]').click();
    await page.waitForTimeout(400);
    const actions = await page.evaluate(() => window.actions);
    assert(actions.length === 1 && actions[0].action === "tap" && actions[0].config.entity === "light.reading_lamp" && actions[0].config.tap_action.action === "more-info", `actions: ${JSON.stringify(actions)}`);
    assert((await state(page, "light.reading_lamp")) === "off", "the lamp toggled anyway");
    await page.evaluate(() => {
      const { actions, ...config } = window.card.config;
      window.card.setConfig(config);
    });
  });

  test("shortcut buttons toggle, run scripts, and show only on their floor", async () => {
    await page.evaluate(() => {
      window.card.setConfig({ ...window.card.config, buttons: [{ entity: "light.kitchen", name: "Kitchen" }, { entity: "script.night", name: "Night" }, { entity: "light.living_room", level: "first" }] });
      window.card.requestUpdate();
    });
    const buttons = page.locator("homeslice-card .shortcuts button");
    await page.waitForFunction(() => window.card.shadowRoot.querySelectorAll(".shortcuts button").length === 2);
    const before = await state(page, "light.kitchen");
    await act(page, () => buttons.filter({ hasText: "Kitchen" }).click());
    assert((await state(page, "light.kitchen")) !== before, "kitchen light not toggled");
    await buttons.filter({ hasText: "Night" }).click();
    await page.waitForTimeout(100);
    const ran = await page.evaluate(() => window.card.hass.calls.filter((c) => c.domain === "script").map((c) => c.target?.entity_id ?? c.data?.entity_id));
    assert(ran.includes("script.night"), `script not run: ${JSON.stringify(ran)}`);
    await act(page, () => buttons.filter({ hasText: "Kitchen" }).click());
    await page.evaluate(() => {
      const { buttons, ...config } = window.card.config;
      window.card.setConfig(config);
      window.card.requestUpdate();
    });
  });

  test("'All floors' returns to the overview camera", async () => {
    await act(page, () => page.locator("homeslice-card nav.levels button", { hasText: "All floors" }).click());
    const o = await page.evaluate(() => window.card.renderer.orientation);
    assert(o.elevation === 38 && o.azimuth === 250 && o.fov === 3, `overview camera ${JSON.stringify(o)}`);
  });

  test("hovering a floor highlights it; the floors above slide away and fade out", async () => {
    // find a canvas spot where the ground floor is the first thing hit
    const spot = await page.evaluate(() => {
      const canvas = window.card.shadowRoot.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      for (let y = r.height - 20; y > 20; y -= 15)
        for (let x = 20; x < r.width - 20; x += 15)
          if (window.card.renderer.levelAt(x, y) === 0) return { x: r.left + x, y: r.top + y };
      return null;
    });
    assert(spot, "no visible spot on the ground floor");
    // and one where only the first floor is (above the ground floor on screen)
    const above = await page.evaluate(() => {
      const canvas = window.card.shadowRoot.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      for (let y = 20; y < r.height - 20; y += 15)
        for (let x = 20; x < r.width - 20; x += 15)
          if (window.card.renderer.levelAt(x, y) === 1) return { x: r.left + x, y: r.top + y };
      return null;
    });
    await page.mouse.move(spot.x, spot.y);
    await page.waitForFunction(() => window.card.renderer.levels[1].hoverOpacity === 0, null, { timeout: 10000 });
    const state = await page.evaluate(() => ({
      hover: window.card.renderer.hoveredIndex,
      above: window.card.renderer.levels[1].hoverOpacity,
      below: window.card.renderer.levels[0].hoverOpacity,
    }));
    assert(state.hover === 0 && state.above === 0 && state.below === 1, `hover state ${JSON.stringify(state)}`);
    assert(await page.evaluate(() => !window.card.renderer.levels[1].group.visible && window.card.renderer.levels[1].hoverLift > 0.5), "the floor above is not lifted away and hidden");
    // what the GPU drew, not just the settings: a pixel of the faded floor must be darker
    const pixel = await page.evaluate(() => {
      const r = window.card.renderer;
      const gl = r.renderer.getContext();
      // top of the far (north-east) wall: nothing but background behind it
      const p = r.project("first", [7.8, 0.2], 2.4);
      const dpr = r.renderer.getPixelRatio();
      r.draw();
      const out = new Uint8Array(4);
      gl.readPixels(Math.round(p.x * dpr), Math.round(gl.drawingBufferHeight - p.y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [...out];
    });
    assert(pixel[3] < 200, `faded first floor still drawn opaque (rgba ${pixel.join(",")})`);
    const faded = await page.locator("homeslice-card .label.faded span.name").allTextContents();
    assert(faded.includes("Bedroom") && !faded.includes("Kitchen"), `faded labels: ${faded.join(", ")}`);
    await shot(page, "demo-hover-ground");
    // over where the floor above stood: still the ground floor, it doesn't come back under the pointer
    await page.mouse.move(above.x, above.y, { steps: 6 });
    await page.waitForTimeout(500);
    assert((await page.evaluate(() => window.card.renderer.hoveredIndex)) === 0, "the floor above came back under the pointer");
  });

  test("hovering a floor button does the same; leaving clears it", async () => {
    await page.locator("homeslice-card nav.levels button", { hasText: "First Floor" }).hover();
    await page.waitForFunction(() => window.card.renderer.hoveredIndex === 1, null, { timeout: 10000 });
    assert((await page.evaluate(() => window.card.renderer.hoveredIndex)) === 1, "first floor not hovered via its button");
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => window.card.renderer.levels[1].hoverOpacity === 1, null, { timeout: 10000 });
    const state = await page.evaluate(() => ({ hover: window.card.renderer.hoveredIndex, above: window.card.renderer.levels[1].hoverOpacity }));
    assert(state.hover === null && state.above === 1, `hover not cleared: ${JSON.stringify(state)}`);
    assert((await page.locator("homeslice-card .label.faded").count()) === 0, "labels still faded");
  });

  test("no house yet: the card says where to draw one, and a button opens the editor", async () => {
    await page.evaluate(() => window.card.applyModel(null));
    await page.waitForSelector("homeslice-card .overlay.empty button");
    const text = await page.locator("homeslice-card .overlay.empty").textContent();
    assert(/sidebar/.test(text), `no hint: ${text}`);
    await page.evaluate(() => {
      window.__went = null;
      window.addEventListener("location-changed", () => (window.__went = location.pathname), { once: true });
    });
    await page.locator("homeslice-card .overlay.empty button").click();
    assert((await page.evaluate(() => window.__went)) === "/homeslice", "the button doesn't open the editor");
    await page.evaluate(() => history.back());
    await page.evaluate(() => window.card.applyModel(window.__demoModel));
  });

  test("no errors in the console", async () => {
    assert(errors.length === 0, errors.join(" | "));
  });

});
