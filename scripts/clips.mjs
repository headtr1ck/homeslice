// Short loops of the editor's main gestures (docs/images/clips/<name>.webp), for the editor
// guide and the README: drawing and reshaping a room, doors and windows, furniture, floors
// and stairs, a balcony and the roof, a lamp linked to its light. The demo house on a
// pretend Home Assistant, with a pointer drawn into the page (headless has none).
// Run `npm run build` first; `node scripts/clips.mjs [name…]` (default: all of them).
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { base, browser, fixture, icons, root, server, showcase } from "./demo-house.mjs";

const outDir = join(root, "docs/images/clips");
mkdirSync(outDir, { recursive: true });
// recorded at 1000 × 625, scaled to 800 × 500: the editor's texts stay readable
const VIEW = { width: 1000, height: 625 };
const OUT_WIDTH = 800;
const FPS = 12;

// ----- the page: the editor (or the card) with a pointer and a caption drawn in -----

/** The pointer, a ring where it presses, a key when one is pressed, and a caption in the header's free space. */
function overlay() {
  const add = () => {
    const css = document.createElement("style");
    css.textContent = `
      #clip-pointer { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none; transform: translate(-100px, -100px); }
      #clip-pointer svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
      .clip-ring { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #ffb300; z-index: 2147483646; pointer-events: none; animation: clip-ring .5s ease-out forwards; }
      @keyframes clip-ring { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.3); opacity: 0 } }
      #clip-key { position: fixed; z-index: 2147483647; pointer-events: none; padding: 4px 12px; border-radius: 8px; background: #fafafa; color: #222; font: 700 20px system-ui, sans-serif; box-shadow: 0 2px 0 #999, 0 3px 8px rgba(0,0,0,.5); opacity: 0; transition: opacity .15s; }
      #clip-caption { position: fixed; top: 15px; left: 665px; transform: translateX(-50%); white-space: nowrap; z-index: 2147483645; pointer-events: none; padding: 7px 16px; border-radius: 18px; background: #ffb300; color: #1a1a1a; font: 600 16px system-ui, sans-serif; opacity: 0; transition: opacity .2s; }`;
    document.head.append(css);
    const p = document.createElement("div");
    p.id = "clip-pointer";
    // a plain arrow, white with a dark edge, tip at the top left
    p.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.5 15 L18 15 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const key = document.createElement("div");
    key.id = "clip-key";
    const caption = document.createElement("div");
    caption.id = "clip-caption";
    document.body.append(p, key, caption);
    const at = (e) => e.clientX !== undefined && (e.clientX || e.clientY) && (p.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`);
    for (const t of ["mousemove", "pointermove", "dragover", "drag"]) window.addEventListener(t, at, true);
    // a piece dragged from a library: its picture goes along (the browser's own drag image isn't in screenshots)
    window.addEventListener(
      "dragstart",
      (e) => {
        const img = e.composedPath().find((el) => el.querySelector?.("img"))?.querySelector("img");
        if (!img) return;
        const ghost = img.cloneNode();
        ghost.id = "clip-ghost";
        Object.assign(ghost.style, { position: "absolute", left: "14px", top: "14px", width: "56px", height: "56px", opacity: 0.75, background: "rgba(255,255,255,.5)", borderRadius: "6px" });
        p.append(ghost);
      },
      true,
    );
    for (const t of ["drop", "dragend"]) window.addEventListener(t, () => document.getElementById("clip-ghost")?.remove(), true);
    window.addEventListener(
      "mousedown",
      (e) => {
        const r = document.createElement("div");
        r.className = "clip-ring";
        Object.assign(r.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
        document.body.append(r);
        setTimeout(() => r.remove(), 600);
      },
      true,
    );
  };
  if (document.body) add();
  else addEventListener("DOMContentLoaded", add);
}

async function newPage() {
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.warn(`  page error: ${e.message}`));
  // the tour stays shut: these are for people who have seen the editor once
  await page.addInitScript((i) => {
    window.__icons = i;
    try {
      localStorage.setItem("homeslice-tour", "done");
      // a narrower side panel: more room for the plan
      localStorage.setItem("homeslice-side-width", "350");
    } catch {}
  }, icons);
  await page.addInitScript(overlay);
  await page.goto(`${base}/dev/harness.html`);
  await page.waitForFunction(() => window.ready);
  return page;
}

/** The editor on the demo house (furnished, lights on); `edit` changes the house first. */
async function editor(edit = () => {}) {
  const page = await newPage();
  const f = showcase(fixture());
  edit(f);
  await page.evaluate((f) => window.setupPanel(f), f);
  await page.waitForFunction(() => window.panel.renderer?.renderer.info.render.triangles > 100, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  return page;
}

// ----- recording: a screenshot for every step, so a slow machine still makes a smooth clip -----

function hand(first) {
  let page = first;
  const dir = mkdtempSync(join(tmpdir(), "clip-"));
  let n = 0;
  let at = [VIEW.width * 0.55, VIEW.height * 0.6];
  let recording = false;
  const snap = async () => recording && (await page.screenshot({ path: join(dir, `f${String(n++).padStart(4, "0")}.png`) }));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const h = {
    /** Goes on on another page (the card after the editor). */
    use: (p) => (page = p),
    start: async () => {
      recording = true;
      await page.mouse.move(...at);
    },
    /** Ends the clip: the frames become an animated WebP. */
    async stop(name) {
      recording = false;
      const out = join(outDir, `${name}.webp`);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"), "-vf", `scale=${OUT_WIDTH}:-1:flags=lanczos`, "-loop", "0", "-c:v", "libwebp_anim", "-quality", "70", "-compression_level", "6", out]);
      if (process.env.KEEP_FRAMES) console.log(`  frames kept in ${dir}`);
      else rmSync(dir, { recursive: true, force: true });
      console.log(`${name}: ${(n / FPS).toFixed(1)} s, ${(statSync(out).size / 1024).toFixed(0)} kB`);
    },
    /** Holds still for `ms` of the clip (the page goes on: the 3D preview catches up). */
    async wait(ms) {
      for (let i = 0; i < Math.round((ms * FPS) / 1000); i++) {
        await page.waitForTimeout(30);
        await snap();
      }
    },
    /** Moves the pointer to (x, y) over `ms`, eased as a hand does. */
    async move(x, y, ms = 600) {
      const [x0, y0] = at;
      const steps = Math.max(2, Math.round((ms * FPS) / 1000));
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps);
        await page.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k);
        await snap();
      }
      at = [x, y];
    },
    async click(x, y, ms) {
      await h.move(x, y, ms);
      await h.wait(80);
      await page.mouse.down();
      await page.mouse.up();
      await h.wait(160);
    },
    async dblclick(x, y, ms) {
      await h.move(x, y, ms);
      await h.wait(80);
      await page.mouse.dblclick(x, y, { delay: 40 });
      await h.wait(160);
    },
    async drag(x0, y0, x1, y1, ms = 900) {
      await h.move(x0, y0);
      await h.wait(80);
      await page.mouse.down();
      await h.wait(80);
      await h.move(x1, y1, ms);
      await h.wait(160);
      await page.mouse.up();
      await h.wait(80);
    },
    /** A control in the panel, by its CSS selector: its middle (or a point given as fractions of its box). */
    async box(selector, fx = 0.5, fy = 0.5) {
      const loc = page.locator(`homeslice-panel ${selector}`).first();
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.boundingBox();
      if (!b) throw new Error(`not shown: ${selector}`);
      return [b.x + b.width * fx, b.y + b.height * fy];
    },
    async press(selector, ms) {
      const [x, y] = await h.box(selector);
      await h.click(x, y, ms);
    },
    /** The side panel scrolled back to its top (the 3D preview), over a few frames. */
    async scrollSide(ms = 400) {
      const from = await page.evaluate(() => window.panel.renderRoot.querySelector("section.side").scrollTop);
      const steps = Math.max(1, Math.round((ms * FPS) / 1000));
      for (let i = 1; i <= steps; i++) {
        await page.evaluate((top) => (window.panel.renderRoot.querySelector("section.side").scrollTop = top), from * (1 - ease(i / steps)));
        await snap();
      }
    },
    /** A point of the plan (metres) on the screen. */
    plan: ([x, y]) =>
      page.evaluate(([x, y]) => {
        const [sx, sy] = window.panel.toScreen([x, y]);
        const r = window.panel.renderRoot.querySelector("svg.plan").getBoundingClientRect();
        return [r.left + sx, r.top + sy];
      }, [x, y]),
    /** A key pressed, shown beside the pointer. */
    async key(key, label = key) {
      await page.evaluate(([label, x, y]) => {
        const k = document.getElementById("clip-key");
        k.textContent = label;
        Object.assign(k.style, { left: `${x + 22}px`, top: `${y + 22}px`, opacity: 1 });
      }, [label, ...at]);
      await h.wait(250);
      await page.keyboard.press(key);
      await h.wait(650);
      await page.evaluate(() => (document.getElementById("clip-key").style.opacity = 0));
    },
    caption: (text) =>
      page.evaluate((t) => {
        const c = document.getElementById("clip-caption");
        if (t) c.textContent = t;
        c.style.opacity = t ? 1 : 0;
      }, text),
    /** The plan zoomed so that the box [x0, y0, x1, y1] (metres) fills it. */
    frame: (box) =>
      page.evaluate(([x0, y0, x1, y1]) => {
        const p = window.panel;
        const r = p.renderRoot.querySelector("svg.plan").getBoundingClientRect();
        const scale = Math.min(r.width / (x1 - x0), r.height / (y1 - y0));
        p._view = { scale, ox: r.width / 2 - ((x0 + x1) / 2) * scale, oy: r.height / 2 - ((y0 + y1) / 2) * scale };
      }, box),
  };
  return h;
}

// ----- the clips -----

const clips = {
  /** A room drawn with the room tool, then a corner added on a wall and dragged out. */
  async room() {
    const page = await editor();
    const h = hand(page);
    await h.frame([-1, 6, 9, 16]);
    await page.waitForTimeout(400);
    await h.start();
    await h.wait(500);
    await h.press('aside.tools button[data-group="build"]');
    await h.wait(300);
    await h.press('.sub-tools button[data-sub-tool="rect"]');
    await h.caption("Drag a room");
    const [ax, ay] = await h.plan([1, 11]);
    const [bx, by] = await h.plan([4, 13.5]);
    await h.drag(ax, ay, bx, by, 1300);
    await h.wait(700);
    await h.caption("Double-click a wall: a corner");
    const [cx, cy] = await h.plan([2.5, 13.5]);
    await h.dblclick(cx, cy, 700);
    await h.wait(500);
    await h.caption("Drag the corner");
    const [dx, dy] = await h.plan([2.5, 14.6]);
    await h.drag(cx, cy, dx, dy, 900);
    await h.wait(1300);
    await h.stop("room");
    await page.close();
  },

  /** A window and a door from the doors & windows library, each put on a wall with a click. */
  async openings() {
    const page = await editor();
    const h = hand(page);
    await h.frame([-4, -0.5, 9, 6.5]);
    await h.wait(300);
    await h.start();
    await h.wait(500);
    await h.press('aside.tools button[data-group="openings"]');
    await h.press('.sub-tools button[data-sub-tool="opening"]');
    await h.caption("Pick a window…");
    await h.press('.inspector .library button[data-preset="window"]', 800);
    await h.wait(300);
    await h.caption("…click a wall");
    const [wx, wy] = await h.plan([6.9, 0.18]);
    await h.click(wx, wy, 900);
    await h.wait(600);
    await h.key("Escape", "Esc");
    await h.caption("Pick a door…");
    await h.press('.inspector .library button[data-preset="door"]', 900);
    await h.wait(300);
    await h.caption("…click a wall");
    const [dx, dy] = await h.plan([-3.22, 2.9]);
    await h.click(dx, dy, 1000);
    await h.wait(1200);
    await h.stop("openings");
    await page.close();
  },

  /** A piece found in the furniture library, dragged onto a room and turned. */
  async furniture() {
    const page = await editor();
    const h = hand(page);
    await h.frame([-0.5, 7.5, 8.5, 15]);
    await h.wait(300);
    await h.start();
    await h.wait(500);
    await h.press('aside.tools button[data-tool="furniture"]');
    await h.press('.flyout button[data-source="builtin"]');
    await h.caption("Find a piece");
    await h.press(".inspector input.library-search", 800);
    for (const c of "lounger") {
      await page.keyboard.type(c);
      await h.wait(90);
    }
    await page.waitForFunction(() => [...window.panel.renderRoot.querySelectorAll(".library img")].every((i) => i.complete), null, { timeout: 10000 });
    await h.wait(400);
    await h.caption("Drag it onto a room");
    const [px, py] = await h.box('.inspector .library button[data-key="modern:sun_lounger"]');
    const [tx, ty] = await h.plan([2.6, 11.6]);
    await h.drag(px, py, tx, ty, 1300);
    await page.evaluate(() => window.panel.shadowRoot.activeElement?.blur());
    await h.wait(700);
    await h.caption("R turns it");
    await h.key("r", "R");
    await h.wait(400);
    await h.key("r", "R");
    await h.wait(1200);
    await h.stop("furniture");
    await page.close();
  },

  /** A floor added on top (started from the one below), and stairs up to it. */
  async floors() {
    // (the kids' room's east end cleared for the stairs)
    const page = await editor((f) => {
      const kids = f.model.levels[1].rooms.find((r) => r.id === "kids");
      kids.furniture = kids.furniture?.filter((p) => p.at[0] < 6);
    });
    const h = hand(page);
    await h.frame([-0.5, -0.5, 8.5, 10.5]);
    await h.wait(300);
    await h.start();
    await h.wait(300);
    await h.caption("Add a floor");
    await h.press("aside.levels button.add-level:not([data-add-roof])", 800);
    await h.wait(400);
    await h.press('.inspector button:has-text("Start from the level below")', 900);
    await h.wait(300);
    await h.scrollSide();
    await h.wait(500);
    await h.caption("Stairs up to it");
    await h.press('aside.levels button.level:has-text("First Floor")', 900);
    await h.scrollSide(250);
    await h.wait(300);
    await h.press('aside.tools button[data-group="openings"]');
    await h.press('.sub-tools button[data-sub-tool="stairs"]');
    const [ax, ay] = await h.plan([6.5, 6.3]);
    const [bx, by] = await h.plan([7.7, 9.5]);
    await h.drag(ax, ay, bx, by, 1000);
    await h.wait(400);
    // the tip over the new stairs, closed
    await h.press("[data-tip] button.close", 600);
    await h.wait(900);
    await h.stop("floors");
    await page.close();
  },

  /** A balcony drawn outside the house on the first floor (it gets a railing), then + Roof. */
  async balcony() {
    const page = await editor();
    const h = hand(page);
    await h.press('aside.levels button.level:has-text("First Floor")', 1);
    await h.frame([-1, -0.5, 9, 12.5]);
    await h.wait(300);
    await h.start();
    await h.wait(500);
    await h.press('aside.tools button[data-group="build"]');
    await h.press('.sub-tools button[data-sub-tool="balcony"]');
    await h.caption("A balcony: drag outside the house");
    const [ax, ay] = await h.plan([1.2, 9.9]);
    const [bx, by] = await h.plan([5.2, 11.6]);
    await h.drag(ax, ay, bx, by, 1200);
    await h.wait(1000);
    await h.caption("+ Roof");
    await h.press("aside.levels button[data-add-roof]", 1000);
    await h.wait(1000);
    await h.press('button[data-roof-preset="tuscan"]', 900);
    await h.wait(1600);
    await h.stop("balcony");
    await page.close();
  },

  /** The floor lamp linked to its light in the editor; on the card a tap lights it up. */
  async lamp() {
    const unlinked = (f) => {
      const living = f.model.levels[0].rooms.find((r) => r.id === "living");
      delete living.furniture.find((p) => p.entity === "light.reading_lamp").entity;
    };
    const page = await editor(unlinked);
    const h = hand(page);
    await h.frame([-0.5, 3.8, 6.5, 10]);
    await h.wait(300);
    await h.start();
    await h.wait(500);
    await h.caption("Click a lamp…");
    const [lx, ly] = await h.plan([1.0, 6.6]);
    await h.click(lx, ly, 900);
    await h.wait(500);
    await h.caption("…link it to its light");
    await h.press(".inspector details.entity-picker summary", 900);
    await h.wait(200);
    await h.press(".inspector input.entity-search", 500);
    for (const c of "reading") {
      await page.keyboard.type(c);
      await h.wait(80);
    }
    await h.wait(300);
    await h.press('.inspector button.entity-option[data-entity="light.reading_lamp"]', 800);
    await h.wait(900);

    // the card, at night, the lights off
    const card = await newPage();
    const f = showcase(fixture());
    for (const id of Object.keys(f.states)) if (id.startsWith("light.")) f.states[id] = { ...f.states[id], state: "off" };
    f.states["sun.sun"] = { entity_id: "sun.sun", state: "below_horizon", attributes: { azimuth: 300, elevation: -15 } };
    await card.evaluate((m) => (window.__demoModel = m), f.model);
    await card.evaluate((f) => window.setup(f, { height: 625, look: "night", view: { azimuth: 200, elevation: 38, furniture: "detailed" } }), f);
    await card.locator("homeslice-card nav.levels button", { hasText: "Ground Floor" }).click();
    await card.evaluate(() => window.card.renderer.modelsReady());
    await card.waitForTimeout(2000);
    await card.evaluate((at) => (document.getElementById("clip-pointer").style.transform = `translate(${at[0] - 3}px, ${at[1] - 2}px)`), [lx, ly]);
    h.use(card);
    await h.caption("On the card: tap it");
    const lamp = await card.evaluate(() => {
      const r = window.card.renderer;
      const p = r.project("ground", [1.0, 6.6], 1.4);
      const c = r.renderer.domElement.getBoundingClientRect();
      return [c.left + p.x, c.top + p.y];
    });
    await h.wait(400);
    await h.click(lamp[0], lamp[1], 1000);
    await h.wait(1800);
    if ((await card.evaluate(() => window.card.hass.states["light.reading_lamp"].state)) !== "on") console.warn("  the tap missed the lamp");
    await h.stop("lamp");
    await page.close();
    await card.close();
  },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(clips);
for (const name of names) {
  if (!clips[name]) throw new Error(`no clip ${name}: ${Object.keys(clips).join(", ")}`);
  await clips[name]();
}
await browser.close();
server.close();
console.log(readdirSync(outDir).join(", "));
