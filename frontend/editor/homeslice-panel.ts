// The Homeslice editor: a full-screen sidebar panel with the 2D plan of one level, a live
// 3D preview and an inspector. Edits work on the short-form model and are saved to
// Homeslice's storage, where every card picks them up at once.

import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { areaEntities, type Hass } from "../ha/hass";
import { localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { bbox, labelPoint, pointInPolygon } from "../model/geometry";
import type { EnergyInput, HouseInput, Issue, OpeningInput, OpeningSource, OpeningType, RoomInput, Side, Vec2, Vertical } from "../model/types";
import { deriveWalls, innerPolygon, sideOfRoom, type Wall } from "../model/walls";
import { HouseRenderer } from "../render/scene";
import { stairFrame, stairHole } from "../model/stairs";
import { listedLights, placeLights, type PlacedLight } from "../model/lights";
import type { EnergyPrefs } from "../ha/energy";
import { ENERGY_COLORS } from "../render/scene";
import {
  History,
  addOpening,
  addRoom,
  addEnergy,
  deleteEnergy,
  updateEnergy,
  setRoof,
  placeLight,
  removeLight,
  setLightHidden,
  addStairs,
  deleteStairs,
  setStairsRect,
  stairsRect,
  updateStairs,
  addLevel,
  deleteLevel,
  newHouse,
  slug,
  uniqueId,
  updateLevel,
  type AreaSeed,
  deleteOpening,
  readOpening,
  updateOpening,
  area,
  clone,
  cornerAngle,
  deleteRoom,
  moveEdge,
  moveWallPiece,
  moveLevel,
  moveVertex,
  openSides,
  outlineScope,
  setBoundaryOpen,
  setOwnOutline,
  removeVertex,
  roomPolygon,
  snap,
  splitEdge,
  updateRoom,
  type SnapContext,
  type Snapped,
} from "./ops";

type Tool = "select" | "rect" | "stairs";
/** The editor's phases: shape the house, then doors and windows, then objects and entities. */
type Mode = "rooms" | "openings" | "objects";

/** Natural size of an image (data URL). */
function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("not an image"));
    img.src = src;
  });
}

/** Reads an image file and shrinks it to at most `max` pixels on its longer side (JPEG). */
async function shrinkImage(file: File, max: number): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const { width, height } = await imageSize(src);
  const k = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  img.src = src;
  await img.decode();
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** A level's floor plan image: where its top-left corner sits, metres per pixel, degrees. */
interface Underlay {
  level: string;
  image: string;
  width: number;
  height: number;
  place: { origin: Vec2; scale: number; rotation: number };
  opacity: number;
}

type Drag =
  | { kind: "pan"; start: Vec2; offset: Vec2 }
  | { kind: "underlay"; start: Vec2; origin: Vec2 }
  | { kind: "vertex"; origin: HouseInput; from: Vec2; ctx: SnapContext }
  | { kind: "edge"; origin: HouseInput; a: Vec2; b: Vec2; startWorld: Vec2; normal: Vec2; ctx: SnapContext }
  | { kind: "rect"; start: Vec2; ctx: SnapContext }
  | { kind: "stair-move"; origin: HouseInput; id: string; rect: [number, number, number, number]; startWorld: Vec2; ctx: SnapContext; moved: boolean }
  | { kind: "stair-resize"; origin: HouseInput; id: string; fixed: Vec2; ctx: SnapContext }
  | { kind: "energy"; origin: HouseInput; index: number; startWorld: Vec2; at: Vec2; moved: boolean }
  | { kind: "light"; origin: HouseInput; entity: string; room: string; startWorld: Vec2; ctx: SnapContext; moved: boolean }
  | { kind: "wall"; origin: HouseInput; a: Vec2; b: Vec2; startWorld: Vec2; normal: Vec2; thickness: number; faces: number[] }
  | { kind: "opening"; origin: HouseInput; src: OpeningSource; axis: 0 | 1; startWorld: Vec2; at: number; snaps: OpeningSnaps };

/** Where a dragged door or window can snap to, as positions along its wall. */
interface OpeningSnaps {
  /** The room's position along the wall axis (the opening's `at` is measured from here). */
  origin: number;
  width: number;
  /** Positions the opening's start or end can line up with. */
  edges: number[];
  /** Positions its centre can line up with. */
  centres: number[];
}

const PLAN_COLORS: Record<string, string> = {
  wood: "#e3c49f",
  tile: "#d3d7db",
  concrete: "#c9cbce",
  carpet: "#d6cec6",
  lawn: "#b9d7a8",
  paving: "#ddd6cb",
  gravel: "#d9d2c7",
};

const fmtM = (v: number) => `${v.toFixed(2)} m`;

/** Selection id for the level's outline (its outside walls). */
const OUTLINE = "__outline__";

export class HomeslicePanel extends LitElement {
  static override properties = {
    narrow: { type: Boolean },
    _houses: { state: true },
    _house: { state: true },
    _model: { state: true },
    _level: { state: true },
    _room: { state: true },
    _tool: { state: true },
    _drag: { state: true },
    _hint: { state: true },
    _view: { state: true },
    _saved: { state: true },
    _error: { state: true },
    _rectPreview: { state: true },
    _levelDrag: { state: true },
    _wall: { state: true },
    _mode: { state: true },
    _opening: { state: true },
    _guides: { state: true },
    _create: { state: true },
    _pendingArea: { state: true },
    _stair: { state: true },
    _energyPlace: { state: true },
    _energySel: { state: true },
    _energyPrefs: { state: true },
    _underlay: { state: true },
    _underlayHidden: { state: true },
    _calib: { state: true },
    _underlayMove: { state: true },
  };

  narrow = false;
  private _hass?: Hass;
  private _houses: { id: string; name: string }[] = [];
  private _house = "";
  private _model: HouseInput | null = null;
  private _level = "";
  private _room: string | null = null;
  private _tool: Tool = "select";
  private _drag: Drag | null = null;
  /** Readout next to the cursor while dragging. */
  private _hint: { x: number; y: number; lines: string[] } | null = null;
  /** Screen transform: px per metre and offset. */
  private _view = { scale: 40, ox: 40, oy: 40 };
  /** JSON of the last saved model, for the unsaved-changes indicator. */
  private _saved = "";
  private _error = "";
  private _rectPreview: Vec2[] | null = null;
  /** Level being dragged in the level list (display indexes, top first). */
  private _levelDrag: { id: string; from: number; over: number; startY: number; dy: number; step: number; moved: boolean } | null = null;
  /** Selected wall between two rooms: the rooms and its side as seen from `a`. */
  private _wall: { a: string; b: string; side: Side } | null = null;
  private _mode: Mode = "rooms";
  /** Selected opening (doors & windows mode) and the room it belongs to on this level. */
  private _opening: { src: OpeningSource; room: string } | null = null;
  /** Snap feedback drawn on the plan: guide lines and the corner snapped to. */
  private _guides: { x?: number; y?: number; ring?: Vec2 } | null = null;
  /** The "new house" form while it is open. */
  private _create: { name: string; width: number; depth: number; floors: string[]; rooms: boolean } | null = null;
  /** The current level's floor plan image (loaded from HA), if any. */
  private _underlay: Underlay | null = null;
  private _underlayHidden = false;
  /** Setting the image's scale: two clicked points (image pixels), then their distance. */
  private _calib: { a?: Vec2; b?: Vec2; distance?: string } | null = null;
  /** Dragging moves the image instead of editing the plan. */
  private _underlayMove = false;
  private underlayRequest = "";
  private underlaySaveTimer = 0;
  /** Energy item waiting for a click on the plan to be placed. */
  private _energyPlace: EnergyInput | null = null;
  private _energySel: number | null = null;
  private _energyPrefs: EnergyPrefs | null = null;
  /** Selected stair or shaft (id in `vertical`). */
  private _stair: string | null = null;
  /** Area to link to the next room drawn with the rectangle tool. */
  private _pendingArea: string | null = null;
  private history = new History<HouseInput>();
  private renderer?: HouseRenderer;
  private previewTimer = 0;
  private fitted = "";
  private onKey = (e: KeyboardEvent) => this.handleKey(e);

  get hass() {
    return this._hass;
  }

  set hass(hass: Hass | undefined) {
    const first = !this._hass && hass;
    this._hass = hass;
    if (first) void this.loadHouses();
  }

  private t(key: StringKey, vars?: Record<string, string | number>) {
    return localize(this._hass?.locale?.language, key, vars);
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKey);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKey);
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  // ----- loading and saving -----

  private async loadHouses() {
    this._hass!.callWS<EnergyPrefs>({ type: "energy/get_prefs" })
      .then((p) => (this._energyPrefs = p))
      .catch(() => (this._energyPrefs = { energy_sources: [], device_consumption: [] }));
    try {
      this._houses = await this._hass!.callWS<{ id: string; name: string }[]>({ type: "homeslice/houses" });
      if (this._houses.length) await this.openHouse(this._houses[0].id);
    } catch (e) {
      this._error = String((e as { message?: string }).message ?? e);
    }
  }

  private async openHouse(id: string) {
    if (this.dirty && !confirm(this.t("editor.discard"))) return;
    const model = await this._hass!.callWS<HouseInput>({ type: "homeslice/model", house: id });
    this._house = id;
    this._model = model;
    this._saved = JSON.stringify(model);
    this.history = new History();
    this._level = this.entranceLevel(model);
    this._room = null;
    this.fitted = "";
  }

  /** The level to open first: the one on HA's entrance floor (level 0), else the lowest indoor one. */
  private entranceLevel(model: HouseInput): string {
    const floors = this._hass?.floors ?? {};
    return (
      model.levels.find((l) => l.floor_id && floors[l.floor_id]?.level === 0)?.id ??
      model.levels.find((l) => l.floor_id && (floors[l.floor_id]?.level ?? -1) >= 0)?.id ??
      model.levels[0]?.id ??
      ""
    );
  }

  /** HA floors, top first (as HA lists them). */
  private haFloors() {
    return Object.values(this._hass?.floors ?? {}).sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
  }

  private floorAreas(floorId: string | undefined): AreaSeed[] {
    if (!floorId) return [];
    return Object.values(this._hass?.areas ?? {})
      .filter((a) => a.floor_id === floorId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ area_id: a.area_id, name: a.name }));
  }

  private startCreate() {
    if (this.dirty && !confirm(this.t("editor.discard"))) return;
    const floors = this.haFloors();
    this._create = { name: this._houses.length ? "" : this.t("editor.new_house_default_name"), width: 10, depth: 8, floors: floors.map((f) => f.floor_id), rooms: true };
  }

  private async createHouse() {
    const c = this._create;
    if (!c) return;
    const name = c.name.trim() || this.t("editor.new_house_default_name");
    const id = uniqueId(
      this._houses.map((h) => h.id),
      slug(name, "home"),
    );
    // HA lists floors top first; the model goes bottom to top
    const seeds = this.haFloors()
      .filter((f) => c.floors.includes(f.floor_id))
      .reverse()
      .map((f) => ({ floor_id: f.floor_id, areas: c.rooms ? this.floorAreas(f.floor_id) : [] }));
    const model = newHouse(id, name, [Math.max(1, c.width), Math.max(1, c.depth)], seeds);
    try {
      await this._hass!.callWS({ type: "homeslice/model/save", house: id, model });
      this._create = null;
      this._houses = await this._hass!.callWS<{ id: string; name: string }[]>({ type: "homeslice/houses" });
      this._saved = "";
      this._model = null;
      await this.openHouse(id);
    } catch (e) {
      this._error = this.t("editor.save_failed", { message: String((e as { message?: string }).message ?? e) });
    }
  }

  private renderCreate() {
    const c = this._create!;
    const set = (patch: Partial<typeof c>) => (this._create = { ...c, ...patch });
    const floors = this.haFloors();
    return html`<div class="create" role="dialog" aria-label=${this.t("editor.new_house")}>
      <h2>${this.t("editor.new_house")}</h2>
      <label>${this.t("editor.house_name")}
        <input .value=${c.name} @input=${(e: Event) => set({ name: (e.target as HTMLInputElement).value })} />
      </label>
      <div class="row">
        <label>${this.t("editor.width_ew")}
          <input type="number" min="1" step="0.1" .value=${String(c.width)} @change=${(e: Event) => set({ width: Number((e.target as HTMLInputElement).value) || 10 })} />
        </label>
        <label>${this.t("editor.depth_ns")}
          <input type="number" min="1" step="0.1" .value=${String(c.depth)} @change=${(e: Event) => set({ depth: Number((e.target as HTMLInputElement).value) || 8 })} />
        </label>
      </div>
      <p class="muted">${this.t("editor.size_hint")}</p>
      <fieldset>
        <legend>${this.t("editor.new_house_floors")}</legend>
        ${floors.length
          ? floors.map(
              (f) => html`<label class="check"><input type="checkbox" .checked=${c.floors.includes(f.floor_id)} @change=${(e: Event) =>
                set({ floors: (e.target as HTMLInputElement).checked ? [...c.floors, f.floor_id] : c.floors.filter((x) => x !== f.floor_id) })} />
                ${f.name} <span class="muted">${this.t("editor.areas_count", { count: this.floorAreas(f.floor_id).length })}</span></label>`,
            )
          : html`<p class="muted">${this.t("editor.no_ha_floors")}</p>`}
      </fieldset>
      <label class="check"><input type="checkbox" .checked=${c.rooms} @change=${(e: Event) => set({ rooms: (e.target as HTMLInputElement).checked })} />
        ${this.t("editor.new_house_rooms")}</label>
      <div class="row end">
        ${this._model ? html`<button @click=${() => (this._create = null)}>${this.t("editor.cancel")}</button>` : nothing}
        <button class="primary" @click=${() => this.createHouse()}>${this.t("editor.create")}</button>
      </div>
    </div>`;
  }

  get dirty() {
    return !!this._model && JSON.stringify(this._model) !== this._saved;
  }

  private async save() {
    if (!this._model || !this.dirty) return;
    try {
      await this._hass!.callWS({ type: "homeslice/model/save", house: this._house, model: this._model });
      this._saved = JSON.stringify(this._model);
      this._error = "";
    } catch (e) {
      this._error = this.t("editor.save_failed", { message: String((e as { message?: string }).message ?? e) });
    }
  }

  /** Every edit goes through here: one undo step per call. */
  private commit(next: HouseInput, previous: HouseInput = this._model!) {
    this.history.push(previous);
    this._model = next;
  }

  private undo() {
    const prev = this._model && this.history.undo(this._model);
    if (prev) this._model = prev;
  }

  private redo() {
    const next = this._model && this.history.redo(this._model);
    if (next) this._model = next;
  }

  private handleKey(e: KeyboardEvent) {
    const target = e.composedPath()[0] as HTMLElement | undefined;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void this.save();
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._opening && this._model) {
      this.commit(deleteOpening(this._model, this._level, this._opening.src));
      this._opening = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._stair && this._model && this._mode === "rooms") {
      this.commit(deleteStairs(this._model, this._stair));
      this._stair = null;
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._room && this._model && this._mode === "rooms") {
      this.commit(deleteRoom(this._model, this._level, this._room));
      this._room = null;
    } else if (e.key === "Escape") {
      this._room = null;
      this._wall = null;
      this._opening = null;
      this._tool = "select";
      this._stair = null;
      this._pendingArea = null;
      this._calib = null;
      this._underlayMove = false;
      this._energyPlace = null;
      this._drag = null;
      this._rectPreview = null;
    } else if (e.key === "r" && !mod) this._tool = "rect";
    else if (e.key === "s" && !mod && this._mode === "rooms") this._tool = "stairs";
    else if (e.key === "v" && !mod) this._tool = "select";
  }

  // ----- geometry helpers -----

  private get levelInput() {
    return this._model?.levels.find((l) => l.id === this._level);
  }

  private toScreen = ([x, y]: Vec2): Vec2 => [x * this._view.scale + this._view.ox, y * this._view.scale + this._view.oy];
  private toWorld = ([x, y]: Vec2): Vec2 => [(x - this._view.ox) / this._view.scale, (y - this._view.oy) / this._view.scale];

  private eventWorld(e: PointerEvent | WheelEvent): Vec2 {
    const svgEl = this.renderRoot.querySelector("svg.plan") as SVGSVGElement;
    const r = svgEl.getBoundingClientRect();
    return this.toWorld([e.clientX - r.left, e.clientY - r.top]);
  }

  private eventScreen(e: PointerEvent): Vec2 {
    const r = (this.renderRoot.querySelector("svg.plan") as SVGSVGElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** "0.50 m east": how far a wall moved, with the compass direction (x east, y south). */
  private moveReadout(delta: Vec2): string {
    const d = Math.hypot(delta[0], delta[1]);
    if (d < 0.005) return "0.00 m";
    const side = Math.abs(delta[0]) >= Math.abs(delta[1]) ? (delta[0] > 0 ? "east" : "west") : delta[1] > 0 ? "south" : "north";
    return `${d.toFixed(2)} m ${this.t(`editor.side_${side}` as StringKey)}`;
  }

  /** Faces (and centres) of the walls parallel to `line`, as offsets along `normal`. */
  private parallelFaces(line: [Vec2, Vec2], normal: Vec2): number[] {
    const out: number[] = [];
    for (const w of this.levelWalls()) {
      if (Math.abs(w.normal[0] * normal[1] - w.normal[1] * normal[0]) > 0.01) continue;
      const same = [line[0], line[1]].every((p) => [w.line[0], w.line[1]].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01));
      if (same) continue;
      const c = w.a[0] * normal[0] + w.a[1] * normal[1];
      out.push(c - w.thickness / 2, c, c + w.thickness / 2);
    }
    return out;
  }

  /** Corners to snap to: this level's rooms (minus `except`) and the level below. */
  private snapContext(except?: Vec2): SnapContext {
    const m = this._model!;
    const idx = m.levels.findIndex((l) => l.id === this._level);
    const levels = [m.levels[idx], m.levels[idx - 1]].filter(Boolean);
    const points: Vec2[] = [];
    for (const l of levels) for (const r of l.rooms) for (const p of roomPolygon(m, r)) if (!except || Math.hypot(p[0] - except[0], p[1] - except[1]) > 0.01) points.push(p);
    return {
      grid: 0.05,
      points,
      align: { x: points.map((p) => p[0]), y: points.map((p) => p[1]) },
      tolerance: 10 / this._view.scale,
    };
  }

  private fitView() {
    const m = this._model;
    const l = this.levelInput;
    const svgEl = this.renderRoot.querySelector("svg.plan") as SVGSVGElement | null;
    if (!m || !l || !svgEl) return;
    // fit the building; gardens and terraces may run off the edge
    const indoor = l.rooms.filter((r) => (r.kind ?? "room") === "room");
    const pts = (indoor.length ? indoor : l.rooms).flatMap((r) => roomPolygon(m, r));
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const { width, height } = svgEl.getBoundingClientRect();
    if (!width || !height) return;
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const scale = Math.min((width - 80) / (w || 1), (height - 80) / (h || 1));
    this._view = {
      scale,
      ox: (width - w * scale) / 2 - Math.min(...xs) * scale,
      oy: (height - h * scale) / 2 - Math.min(...ys) * scale,
    };
  }

  // ----- pointer handling on the plan -----

  private onPlanDown(e: PointerEvent) {
    if (!this._model) return;
    const target = e.target as Element;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const world = this.eventWorld(e);
    const u = this._underlay?.level === this._level ? this._underlay : null;
    if (u && this._calib && !(this._calib.a && this._calib.b)) {
      const p = this.planToUnderlay(u, world);
      this._calib = this._calib.a ? { ...this._calib, b: p } : { a: p };
      return;
    }
    if (u && this._underlayMove) {
      this._drag = { kind: "underlay", start: world, origin: u.place.origin };
      return;
    }
    if (this._mode === "openings") {
      const hitOpening = target.closest("[data-opening]") as SVGElement | null;
      if (hitOpening) {
        const sel = JSON.parse(hitOpening.dataset.opening!) as { src: OpeningSource; room: string };
        const o = readOpening(this._model, this._level, sel.src);
        if (o) {
          this._opening = sel;
          const axis = o.side === "north" || o.side === "south" ? 0 : 1;
          this._drag = { kind: "opening", origin: clone(this._model), src: sel.src, axis, startWorld: world, at: o.at, snaps: this.openingSnaps(sel, o, axis) };
          return;
        }
      }
      const hitWall = target.closest("[data-addwall]") as SVGElement | null;
      if (hitWall) {
        this.addOpeningAt(JSON.parse(hitWall.dataset.addwall!), world);
        return;
      }
      this._opening = null;
      this._drag = { kind: "pan", start: this.eventScreen(e), offset: [this._view.ox, this._view.oy] };
      return;
    }
    if (this._mode === "objects" && this._energyPlace) {
      const at = snap(world, { ...this.snapContext(), points: [], align: { x: [], y: [] } }).p;
      const { model, index } = addEnergy(this._model, { ...this._energyPlace, level: this._level, at });
      this.commit(model);
      this._energyPlace = null;
      this._energySel = index;
      this._room = null;
      return;
    }
    const hitEnergy = this._mode === "objects" ? (target.closest("[data-energy]") as SVGElement | null) : null;
    if (hitEnergy) {
      const index = Number(hitEnergy.dataset.energy);
      const e = this._model.energy?.[index];
      if (e?.at) {
        this._energySel = index;
        this._room = null;
        this._drag = { kind: "energy", origin: clone(this._model), index, startWorld: world, at: e.at, moved: false };
        return;
      }
    }
    if (this._mode === "objects") {
      this._energySel = null;
      const hitLight = target.closest("[data-light]") as SVGElement | null;
      if (hitLight) {
        const { entity, room } = JSON.parse(hitLight.dataset.light!) as { entity: string; room: string };
        const lamps = this.levelLamps();
        const ctx = this.snapContext();
        // line up with the other lamps and the rooms' centres
        const extra = [...lamps.filter((x) => x.entity !== entity).map((x) => x.at), ...(this.levelInput?.rooms ?? []).map((r) => labelPoint(this.inner(r)))];
        ctx.points = extra;
        ctx.align = { x: extra.map((p) => p[0]), y: extra.map((p) => p[1]) };
        this._room = room;
        this._drag = { kind: "light", origin: clone(this._model), entity, room, startWorld: world, ctx, moved: false };
        return;
      }
      const roomId = (target.closest("[data-room]") as SVGElement | null)?.dataset.room;
      this._room = roomId ?? null;
      this._drag = { kind: "pan", start: this.eventScreen(e), offset: [this._view.ox, this._view.oy] };
      return;
    }
    const handle = target.closest("[data-handle]") as SVGElement | null;
    if (handle?.dataset.handle === "vertex") {
      const from: Vec2 = JSON.parse(handle.dataset.at!);
      this._drag = { kind: "vertex", origin: clone(this._model), from, ctx: this.snapContext(from) };
      return;
    }
    if (handle?.dataset.handle === "edge") {
      const [a, b]: [Vec2, Vec2] = JSON.parse(handle.dataset.at!);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const normal: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      this._drag = { kind: "edge", origin: clone(this._model), a, b, startWorld: world, normal, ctx: this.snapContext() };
      return;
    }
    const stairHandle = target.closest("[data-stairhandle]") as SVGElement | null;
    if (stairHandle && this._stair) {
      const fixed: Vec2 = JSON.parse(stairHandle.dataset.stairhandle!);
      this._drag = { kind: "stair-resize", origin: clone(this._model), id: this._stair, fixed, ctx: this.snapContext() };
      return;
    }
    if (this._tool === "rect" || this._tool === "stairs") {
      const ctx = this.snapContext();
      this._drag = { kind: "rect", start: snap(world, ctx).p, ctx };
      return;
    }
    const stairHit = target.closest("[data-stair]") as SVGElement | null;
    if (stairHit) {
      const id = stairHit.dataset.stair!;
      const v = this._model.vertical?.find((x) => x.id === id);
      if (v) {
        this._stair = id;
        this._room = null;
        this._wall = null;
        this._drag = { kind: "stair-move", origin: clone(this._model), id, rect: stairsRect(this._model, v), startWorld: world, ctx: this.snapContext(), moved: false };
        return;
      }
    }
    this._stair = null;
    const wallHit = target.closest("[data-wall]") as SVGElement | null;
    this._wall = wallHit ? JSON.parse(wallHit.dataset.wall!) : null;
    if (wallHit) {
      // drag just this piece of wall, e.g. to line its face up with another wall
      const { line, thickness } = JSON.parse(wallHit.dataset.wall!) as { line: [Vec2, Vec2]; thickness: number };
      const [a, b] = line;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const normal: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      this._room = null;
      this._drag = { kind: "wall", origin: clone(this._model), a, b, startWorld: world, normal, thickness, faces: this.parallelFaces(line, normal) };
      return;
    }
    const roomId = wallHit ? null : target.closest("[data-outline]") ? OUTLINE : (target.closest("[data-room]") as SVGElement | null)?.dataset.room;
    this._room = roomId ?? null;
    this._drag = { kind: "pan", start: this.eventScreen(e), offset: [this._view.ox, this._view.oy] };
  }

  private onPlanMove(e: PointerEvent) {
    const drag = this._drag;
    if (!drag || !this._model) return;
    const world = this.eventWorld(e);
    const screen = this.eventScreen(e);
    const free = e.altKey;
    const snapped = (p: Vec2, ctx: SnapContext): Snapped => (free ? { p, kind: "free" } : snap(p, ctx));
    if (drag.kind === "underlay") {
      const u = this._underlay;
      if (u) this._underlay = { ...u, place: { ...u.place, origin: [drag.origin[0] + world[0] - drag.start[0], drag.origin[1] + world[1] - drag.start[1]] } };
      return;
    }
    if (drag.kind === "pan") {
      this._view = { ...this._view, ox: drag.offset[0] + screen[0] - drag.start[0], oy: drag.offset[1] + screen[1] - drag.start[1] };
      return;
    }
    if (drag.kind === "vertex") {
      const s = snapped(world, drag.ctx);
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
      this._model = moveVertex(drag.origin, this._level, drag.from, s.p);
      this._hint = { x: screen[0], y: screen[1], lines: [...this.cornerReadout(s.p), this.t(`editor.snap_${s.kind}` as StringKey)] };
      return;
    }
    if (drag.kind === "edge") {
      // walls move along their normal only, so right angles stay right
      const along = (world[0] - drag.startWorld[0]) * drag.normal[0] + (world[1] - drag.startWorld[1]) * drag.normal[1];
      const moved: Vec2 = [drag.a[0] + drag.normal[0] * along, drag.a[1] + drag.normal[1] * along];
      const s = snapped(moved, { ...drag.ctx, points: [] });
      this._guides = { x: s.alignX, y: s.alignY };
      const snappedAlong = (s.p[0] - drag.a[0]) * drag.normal[0] + (s.p[1] - drag.a[1]) * drag.normal[1];
      const delta: Vec2 = [drag.normal[0] * snappedAlong, drag.normal[1] * snappedAlong];
      this._model = moveEdge(drag.origin, this._level, drag.a, drag.b, delta);
      this._hint = { x: screen[0], y: screen[1], lines: [this.moveReadout(delta), ...this.roomReadout()] };
      return;
    }
    if (drag.kind === "energy") {
      const p: Vec2 = [drag.at[0] + world[0] - drag.startWorld[0], drag.at[1] + world[1] - drag.startWorld[1]];
      if (!drag.moved && Math.hypot(p[0] - drag.at[0], p[1] - drag.at[1]) * this._view.scale < 4) return;
      drag.moved = true;
      const s = snapped(p, { ...this.snapContext(), points: [] });
      this._guides = { x: s.alignX, y: s.alignY };
      this._model = updateEnergy(drag.origin, drag.index, { at: s.p });
      return;
    }
    if (drag.kind === "light") {
      if (!drag.moved && Math.hypot(world[0] - drag.startWorld[0], world[1] - drag.startWorld[1]) * this._view.scale < 4) return;
      drag.moved = true;
      const s = snapped(world, drag.ctx);
      const rooms = (this.levelInput?.rooms ?? []).filter((r) => r.kind !== "void");
      const room = rooms.find((r) => pointInPolygon(s.p, roomPolygon(this._model!, r))) ?? rooms.find((r) => r.id === drag.room);
      if (!room) return;
      const { min } = bbox(roomPolygon(this._model!, room));
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
      this._model = placeLight(drag.origin, this._level, room.id, drag.entity, [s.p[0] - min[0], s.p[1] - min[1]]);
      this._room = room.id;
      this._hint = { x: screen[0], y: screen[1], lines: [this.entityName(drag.entity), `→ ${this.roomName(room)}`] };
      return;
    }
    if (drag.kind === "stair-move") {
      const [x, y, w, d] = drag.rect;
      const corner: Vec2 = [x + world[0] - drag.startWorld[0], y + world[1] - drag.startWorld[1]];
      if (!drag.moved && Math.hypot(corner[0] - x, corner[1] - y) * this._view.scale < 4) return;
      drag.moved = true;
      // snap the corner nearest the cursor's direction: try all four, keep the closest snap
      const offsets: Vec2[] = [[0, 0], [w, 0], [0, d], [w, d]];
      const snaps = offsets.map((o) => {
        const s = snapped([corner[0] + o[0], corner[1] + o[1]], drag.ctx);
        return { s, o, dist: Math.hypot(s.p[0] - corner[0] - o[0], s.p[1] - corner[1] - o[1]) + (s.kind === "grid" || s.kind === "free" ? 1 : 0) };
      });
      const best = snaps.sort((a, b) => a.dist - b.dist)[0];
      const nx = best.s.p[0] - best.o[0];
      const ny = best.s.p[1] - best.o[1];
      this._guides = { x: best.s.alignX, y: best.s.alignY, ring: best.s.target };
      this._model = setStairsRect(drag.origin, drag.id, [nx, ny, w, d]);
      this._hint = { x: screen[0], y: screen[1], lines: [`${nx.toFixed(2)}, ${ny.toFixed(2)} m`] };
      return;
    }
    if (drag.kind === "stair-resize") {
      const s = snapped(world, drag.ctx);
      const [fx, fy] = drag.fixed;
      const w = Math.max(0.6, Math.abs(s.p[0] - fx));
      const d = Math.max(0.6, Math.abs(s.p[1] - fy));
      const x = s.p[0] < fx ? fx - w : fx;
      const y = s.p[1] < fy ? fy - d : fy;
      this._guides = { x: s.alignX, y: s.alignY, ring: s.target };
      this._model = setStairsRect(drag.origin, drag.id, [x, y, w, d]);
      this._hint = { x: screen[0], y: screen[1], lines: [`${w.toFixed(2)} × ${d.toFixed(2)} m`] };
      return;
    }
    if (drag.kind === "wall") {
      const raw = (world[0] - drag.startWorld[0]) * drag.normal[0] + (world[1] - drag.startWorld[1]) * drag.normal[1];
      const base = drag.a[0] * drag.normal[0] + drag.a[1] * drag.normal[1];
      // line either face (or the centre) up with a face of a parallel wall
      const tol = free ? 0 : 10 / this._view.scale;
      const half = drag.thickness / 2;
      const best = drag.faces
        .flatMap((f) => [-half, 0, half].map((o) => ({ along: f - base - o, guide: f })))
        .filter((c) => Math.abs(c.along - raw) < tol)
        .sort((u, v) => Math.abs(u.along - raw) - Math.abs(v.along - raw))[0];
      const along = Math.round((best ? best.along : Math.round(raw / 0.05) * 0.05) * 1000) / 1000;
      const vertical = Math.abs(drag.normal[0]) > 0.999;
      const horizontal = Math.abs(drag.normal[1]) > 0.999;
      this._guides = best && vertical ? { x: best.guide * Math.sign(drag.normal[0]) } : best && horizontal ? { y: best.guide * Math.sign(drag.normal[1]) } : null;
      this._model = Math.abs(along) < 1e-6 ? drag.origin : moveWallPiece(drag.origin, this._level, drag.a, drag.b, [drag.normal[0] * along, drag.normal[1] * along]);
      this._hint = { x: screen[0], y: screen[1], lines: [this.moveReadout([drag.normal[0] * along, drag.normal[1] * along])] };
      return;
    }
    if (drag.kind === "opening") {
      const delta = world[drag.axis] - drag.startWorld[drag.axis];
      const { origin, width, edges, centres } = drag.snaps;
      const start = origin + drag.at + delta;
      // line up the start, end or centre with room edges, the room's centre and the
      // doors and windows on the levels above and below
      const tol = free ? 0 : 10 / this._view.scale;
      const options = [
        ...edges.map((t) => ({ d: t - start, guide: t })),
        ...edges.map((t) => ({ d: t - (start + width), guide: t })),
        ...centres.map((t) => ({ d: t - (start + width / 2), guide: t })),
      ].filter((c) => Math.abs(c.d) < tol);
      const best = options.sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
      const raw = best ? start + best.d - origin : Math.round((start - origin) / 0.05) * 0.05;
      const at = Math.max(0, raw);
      this._guides = best ? (drag.axis === 0 ? { x: best.guide } : { y: best.guide }) : null;
      this._model = updateOpening(drag.origin, this._level, drag.src, { at: Math.round(at * 100) / 100 });
      const o = readOpening(this._model, this._level, drag.src);
      this._hint = { x: screen[0], y: screen[1], lines: [this.t("editor.opening_at", { at: (o?.at ?? 0).toFixed(2), width: (o?.width ?? 0).toFixed(2) })] };
      return;
    }
    if (drag.kind === "rect") {
      const endSnap = snapped(world, drag.ctx);
      const end = endSnap.p;
      this._guides = { x: endSnap.alignX, y: endSnap.alignY, ring: endSnap.target };
      const [x0, y0] = drag.start;
      this._rectPreview = [[x0, y0], [end[0], y0], [end[0], end[1]], [x0, end[1]]];
      const w = Math.abs(end[0] - x0);
      const d = Math.abs(end[1] - y0);
      this._hint = { x: screen[0], y: screen[1], lines: [`${w.toFixed(2)} × ${d.toFixed(2)} m`, `${(w * d).toFixed(2)} m²`] };
    }
  }

  private onPlanUp() {
    const drag = this._drag;
    this._drag = null;
    this._hint = null;
    this._guides = null;
    if (!drag || !this._model) return;
    if (drag.kind === "underlay" && this._underlay) {
      this.saveUnderlay({ place: this._underlay.place });
      return;
    }
    if (drag.kind === "vertex" || drag.kind === "edge" || drag.kind === "opening" || drag.kind === "wall" || drag.kind === "stair-move" || drag.kind === "stair-resize" || drag.kind === "light" || drag.kind === "energy") {
      if (JSON.stringify(drag.origin) !== JSON.stringify(this._model)) this.commit(this._model, drag.origin);
    } else if (drag.kind === "rect" && this._rectPreview && this._tool === "stairs") {
      const [[x0, y0], , [x1, y1]] = this._rectPreview;
      this._rectPreview = null;
      const idx = this._model.levels.findIndex((l) => l.id === this._level);
      const above = this._model.levels[idx + 1];
      if (above && Math.abs(x1 - x0) >= 0.6 && Math.abs(y1 - y0) >= 0.6) {
        const { model, id } = addStairs(this._model, [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)], this._level, above.id);
        this.commit(model);
        this._stair = id;
        this._room = null;
        this._tool = "select";
      }
    } else if (drag.kind === "rect" && this._rectPreview) {
      const [[x0, y0], , [x1, y1]] = this._rectPreview;
      this._rectPreview = null;
      if (Math.abs(x1 - x0) >= 0.3 && Math.abs(y1 - y0) >= 0.3) {
        const pending = this._pendingArea;
        const props = pending ? { id: uniqueId(this.levelInput!.rooms.map((r) => r.id), slug(pending, "room")), area_id: pending } : {};
        this._pendingArea = null;
        const { model, id } = addRoom(this._model, this._level, [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]], props);
        this.commit(model);
        this._room = id;
        this._tool = "select";
      }
    }
  }

  private onPlanDoubleClick(e: MouseEvent) {
    if (!this._model) return;
    const handle = (e.target as Element).closest("[data-handle]") as SVGElement | null;
    if (handle?.dataset.handle === "vertex") {
      this.commit(removeVertex(this._model, this._level, JSON.parse(handle.dataset.at!)));
    } else if (handle?.dataset.handle === "edge") {
      const [a, b]: [Vec2, Vec2] = JSON.parse(handle.dataset.at!);
      this.commit(splitEdge(this._model, this._level, a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
    }
  }

  private onPlanWheel(e: WheelEvent) {
    e.preventDefault();
    const r = (this.renderRoot.querySelector("svg.plan") as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const [wx, wy] = this.toWorld([sx, sy]);
    const scale = Math.min(400, Math.max(5, this._view.scale * Math.exp(-e.deltaY * 0.0015)));
    this._view = { scale, ox: sx - wx * scale, oy: sy - wy * scale };
  }

  /** Lengths and angle at a dragged corner, plus the selected room's area. */
  private cornerReadout(at: Vec2): string[] {
    const m = this._model!;
    const lines: string[] = [];
    for (const r of this.levelInput?.rooms ?? []) {
      const poly = roomPolygon(m, r);
      const i = poly.findIndex((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < 0.01);
      if (i < 0 || (this._room && r.id !== this._room)) continue;
      // inside dimensions of the two sides at this corner
      const inner = this.inner(r);
      const sides = this.innerSides(poly, inner);
      lines.push(`${fmtM(sides[(i - 1 + poly.length) % poly.length])} · ${fmtM(sides[i])} · ${Math.round(cornerAngle(poly, i))}°`);
      lines.push(`${this.roomName(r)}: ${area(inner).toFixed(2)} m²`);
      break;
    }
    return lines;
  }

  private roomReadout(): string[] {
    const r = this.levelInput?.rooms.find((x) => x.id === this._room);
    return r ? [`${this.roomName(r)}: ${area(this.inner(r)).toFixed(2)} m²`] : [];
  }

  /** Walls of the level being edited (derived from the current model). */
  private levelWalls(): Wall[] {
    const { house } = expandHouse(this._model!);
    const level = house?.levels.find((x) => x.id === this._level);
    return level && house ? deriveWalls(level, house.walls, []) : [];
  }

  /**
   * Inside length of each side of a room: the stretch of the inner outline that lies
   * along that side (the inner outline may have extra corners where walls change).
   */
  private innerSides(poly: Vec2[], inner: Vec2[]): number[] {
    return poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const ts = inner
        .filter((p) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]) < 0.45)
        .map((p) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1])
        .filter((t) => t > -0.45 && t < length + 0.45);
      return ts.length >= 2 ? Math.max(...ts) - Math.min(...ts) : length;
    });
  }

  /** A room as it really is: to the inside of its walls (outdoor areas as drawn). */
  private inner(r: RoomInput, walls = this.levelWalls()): Vec2[] {
    const poly = roomPolygon(this._model!, r);
    return (r.kind ?? "room") === "room" ? innerPolygon(poly, walls) : poly;
  }

  private alongWall(w: Wall, t: number): Vec2 {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    return this.toScreen([w.a[0] + ((w.b[0] - w.a[0]) * t) / len, w.a[1] + ((w.b[1] - w.a[1]) * t) / len]);
  }

  private levelInputRoomPolygon(id: string): Vec2[] | null {
    const r = this.levelInput?.rooms.find((x) => x.id === id);
    return r ? roomPolygon(this._model!, r) : null;
  }

  private roomName(r: RoomInput) {
    return (r.area_id && this._hass?.areas?.[r.area_id]?.name) || r.name || r.id;
  }

  // ----- 3D preview -----

  protected override updated(changed: PropertyValues) {
    if ((changed.has("_level") || changed.has("_house")) && this._model) void this.loadUnderlay();
    if (changed.has("_model") || changed.has("_level")) {
      if (this._model && this.fitted !== `${this._house}/${this._level}`) {
        this.fitted = `${this._house}/${this._level}`;
        this.fitView();
      }
      clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => this.updatePreview(), 120);
    }
  }

  private updatePreview() {
    const canvas = this.renderRoot.querySelector("canvas.preview") as HTMLCanvasElement | null;
    if (!canvas || !this._model) return;
    if (!this.renderer) {
      try {
        this.renderer = new HouseRenderer(canvas);
      } catch {
        return;
      }
    }
    const { house, issues } = expandHouse(this._model);
    if (!house) return;
    const walls = new Map<string, Wall[]>();
    for (const l of house.levels) walls.set(l.id, deriveWalls(l, house.walls, issues));
    const keep = this.renderer.orientation.fov ? { ...this.renderer.orientation } : null;
    const zoom = this.renderer.zoom;
    this.renderer.setModel(house, walls, { focus: { azimuth: 200, elevation: 50, projection: "perspective" } });
    const index = house.levels.findIndex((l) => l.id === this._level);
    void this.renderer.setFocus(index >= 0 ? index : null, false);
    if (keep && this.previewTouched) {
      this.renderer.orientation = keep;
      this.renderer.zoom = zoom;
    }
    const { width, height } = canvas.getBoundingClientRect();
    if (width && height) this.renderer.render(width, height);
  }

  // ----- floor plan image -----

  private async loadUnderlay() {
    const key = `${this._house}/${this._level}`;
    if (this.underlayRequest === key) return;
    this.underlayRequest = key;
    this._underlay = null;
    this._calib = null;
    this._underlayMove = false;
    try {
      const got = await this._hass!.callWS<{ image: string; place?: Underlay["place"]; opacity?: number } | null>({
        type: "homeslice/underlay/get",
        house: this._house,
        level: this._level,
      });
      if (!got || this.underlayRequest !== key) return;
      const { width, height } = await imageSize(got.image);
      this._underlay = { level: this._level, image: got.image, width, height, place: got.place ?? { origin: [0, 0], scale: 0.01, rotation: 0 }, opacity: got.opacity ?? 0.5 };
    } catch {
      // no image (or an older backend): nothing to show
    }
  }

  /** Image pixels → plan metres, and back. */
  private underlayToPlan(u: Underlay, [px, py]: Vec2): Vec2 {
    const r = (u.place.rotation * Math.PI) / 180;
    const x = px * u.place.scale;
    const y = py * u.place.scale;
    return [u.place.origin[0] + x * Math.cos(r) - y * Math.sin(r), u.place.origin[1] + x * Math.sin(r) + y * Math.cos(r)];
  }

  private planToUnderlay(u: Underlay, [x, y]: Vec2): Vec2 {
    const r = (-u.place.rotation * Math.PI) / 180;
    const dx = x - u.place.origin[0];
    const dy = y - u.place.origin[1];
    return [(dx * Math.cos(r) - dy * Math.sin(r)) / u.place.scale, (dx * Math.sin(r) + dy * Math.cos(r)) / u.place.scale];
  }

  private saveUnderlay(patch: { place?: Underlay["place"]; opacity?: number }, delay = 0) {
    const u = this._underlay;
    if (!u) return;
    this._underlay = { ...u, ...patch };
    clearTimeout(this.underlaySaveTimer);
    const send = () =>
      this._hass!.callWS({ type: "homeslice/underlay/set", house: this._house, level: u.level, ...patch }).catch((e) => {
        this._error = this.t("editor.save_failed", { message: String((e as { message?: string }).message ?? e) });
      });
    if (delay) this.underlaySaveTimer = window.setTimeout(send, delay);
    else void send();
  }

  private async uploadUnderlay(file: File) {
    const level = this._level;
    try {
      const image = await shrinkImage(file, 2400);
      const { width, height } = await imageSize(image);
      // start by fitting the image to the house's width
      const outline = outlineScope(this._model!, level).poly;
      const { min, max } = outline.length ? bbox(outline) : { min: [0, 0] as Vec2, max: [10, 8] as Vec2 };
      const scale = Math.max(0.001, (max[0] - min[0]) / width);
      const place = { origin: [min[0], min[1]] as Vec2, scale, rotation: 0 };
      await this._hass!.callWS({ type: "homeslice/underlay/set", house: this._house, level, image, place, opacity: 0.5 });
      this._underlay = { level, image, width, height, place, opacity: 0.5 };
      this._underlayHidden = false;
      this._calib = {};
    } catch (e) {
      this._error = this.t("editor.underlay_failed", { message: String((e as { message?: string }).message ?? e) });
    }
  }

  private rotateUnderlay(by: number) {
    const u = this._underlay;
    if (!u) return;
    // turn around the image's centre
    const centre = this.underlayToPlan(u, [u.width / 2, u.height / 2]);
    const rotation = (((u.place.rotation + by) % 360) + 360) % 360;
    const r = (rotation * Math.PI) / 180;
    const hx = (u.width / 2) * u.place.scale;
    const hy = (u.height / 2) * u.place.scale;
    const origin: Vec2 = [centre[0] - (hx * Math.cos(r) - hy * Math.sin(r)), centre[1] - (hx * Math.sin(r) + hy * Math.cos(r))];
    this.saveUnderlay({ place: { ...u.place, origin, rotation } });
  }

  private applyCalibration() {
    const u = this._underlay;
    const c = this._calib;
    const d = parseFloat((c?.distance ?? "").replace(",", "."));
    if (!u || !c?.a || !c.b || !(d > 0)) return;
    const px = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
    if (px < 1) return;
    // keep the first point where it is on the plan
    const anchor = this.underlayToPlan(u, c.a);
    const scale = d / px;
    const r = (u.place.rotation * Math.PI) / 180;
    const x = c.a[0] * scale;
    const y = c.a[1] * scale;
    const origin: Vec2 = [anchor[0] - (x * Math.cos(r) - y * Math.sin(r)), anchor[1] - (x * Math.sin(r) + y * Math.cos(r))];
    this.saveUnderlay({ place: { ...u.place, origin, scale } });
    this._calib = null;
    this._underlayMove = true;
  }

  private renderUnderlay() {
    const u = this._underlay;
    if (!u || u.level !== this._level || this._underlayHidden) return nothing;
    const [sx, sy] = this.toScreen(u.place.origin);
    const k = u.place.scale * this._view.scale;
    const c = this._calib;
    const mark = (p: Vec2 | undefined) => {
      if (!p) return nothing;
      const [x, y] = this.toScreen(this.underlayToPlan(u, p));
      return svg`<circle class="calib-point" cx=${x} cy=${y} r="6"></circle>`;
    };
    const line =
      c?.a && c.b
        ? (() => {
            const [x1, y1] = this.toScreen(this.underlayToPlan(u, c.a!));
            const [x2, y2] = this.toScreen(this.underlayToPlan(u, c.b!));
            return svg`<line class="calib-line" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>`;
          })()
        : nothing;
    return svg`<image class="underlay" href=${u.image} x="0" y="0" width=${u.width} height=${u.height} opacity=${u.opacity}
        transform="translate(${sx} ${sy}) rotate(${u.place.rotation}) scale(${k})" preserveAspectRatio="none"></image>
      ${line}${mark(c?.a)}${mark(c?.b)}`;
  }

  private renderUnderlayInspector() {
    const u = this._underlay?.level === this._level ? this._underlay : null;
    const c = this._calib;
    const fileInput = html`<label class="file">
      <input type="file" accept="image/png,image/jpeg,image/webp" @change=${(e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) void this.uploadUnderlay(f);
        (e.target as HTMLInputElement).value = "";
      }} />
      <span>${u ? this.t("editor.underlay_replace") : this.t("editor.underlay_upload")}</span>
    </label>`;
    if (!u) return html`<h3>${this.t("editor.underlay")}</h3><p class="muted">${this.t("editor.underlay_hint")}</p>${fileInput}`;
    return html`<h3>${this.t("editor.underlay")}</h3>
      ${c
        ? html`<div class="calib">
            <p>${!c.a ? this.t("editor.calib_first") : !c.b ? this.t("editor.calib_second") : this.t("editor.calib_distance")}</p>
            ${c.a && c.b
              ? html`<div class="row">
                  <label>${this.t("editor.calib_metres")}
                    <input class="calib-distance" inputmode="decimal" .value=${c.distance ?? ""} @input=${(e: Event) => (this._calib = { ...c, distance: (e.target as HTMLInputElement).value })}
                      @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.applyCalibration()} />
                  </label>
                </div>
                <button class="primary" @click=${() => this.applyCalibration()}>${this.t("editor.calib_apply")}</button>`
              : nothing}
            <button @click=${() => (this._calib = null)}>${this.t("editor.cancel")}</button>
          </div>`
        : html`<div class="row">
            <button @click=${() => {
              this._calib = {};
              this._underlayMove = false;
            }}>${this.t("editor.underlay_scale")}</button>
            <button class=${this._underlayMove ? "active" : ""} @click=${() => (this._underlayMove = !this._underlayMove)}>${this.t("editor.underlay_move")}</button>
            <button title=${this.t("editor.underlay_rotate_left")} aria-label=${this.t("editor.underlay_rotate_left")} @click=${() => this.rotateUnderlay(-90)}>⟲</button>
            <button title=${this.t("editor.underlay_rotate_right")} aria-label=${this.t("editor.underlay_rotate_right")} @click=${() => this.rotateUnderlay(90)}>⟳</button>
          </div>`}
      <label>${this.t("editor.underlay_opacity")}
        <input type="range" min="0.1" max="1" step="0.05" .value=${String(u.opacity)} @input=${(e: Event) => this.saveUnderlay({ opacity: Number((e.target as HTMLInputElement).value) }, 400)} />
      </label>
      <div class="row">
        <label class="check"><input type="checkbox" .checked=${!this._underlayHidden} @change=${(e: Event) => (this._underlayHidden = !(e.target as HTMLInputElement).checked)} />
          ${this.t("editor.underlay_show")}</label>
      </div>
      <div class="row">
        ${fileInput}
        <button class="danger" @click=${async () => {
          if (!confirm(this.t("editor.underlay_remove_confirm"))) return;
          await this._hass!.callWS({ type: "homeslice/underlay/delete", house: this._house, level: this._level });
          this._underlay = null;
          this._calib = null;
          this._underlayMove = false;
        }}>${this.t("editor.underlay_remove")}</button>
      </div>`;
  }

  private previewTouched = false;
  private previewDrag: Vec2 | null = null;

  private onPreviewDown(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.previewDrag = [e.clientX, e.clientY];
  }

  private onPreviewMove(e: PointerEvent) {
    if (!this.previewDrag || !this.renderer) return;
    this.renderer.orbit(-(e.clientX - this.previewDrag[0]) * 0.35, (e.clientY - this.previewDrag[1]) * 0.25);
    this.previewDrag = [e.clientX, e.clientY];
    this.previewTouched = true;
  }

  private onPreviewWheel(e: WheelEvent) {
    e.preventDefault();
    this.renderer?.zoomBy(Math.exp(-e.deltaY * 0.0015));
    this.previewTouched = true;
  }

  // ----- rendering -----

  private issues(): Issue[] {
    if (!this._model) return [];
    const { house, issues } = expandHouse(this._model);
    if (house) for (const l of house.levels) deriveWalls(l, house.walls, issues);
    return issues;
  }

  protected override render() {
    if (this._create) return html`<div class="empty">${this._error ? html`<div class="error">${this._error}</div>` : nothing}${this.renderCreate()}</div>`;
    if (!this._model) {
      return html`<div class="empty">
        ${this._error || (this._houses.length || !this._hass ? this.t("card.loading") : html`<p>${this.t("editor.no_houses")}</p>
          <button class="primary" @click=${() => this.startCreate()}>${this.t("editor.new_house")}</button>`)}
      </div>`;
    }
    const levels = [...this._model.levels].reverse();
    const issues = this.issues();
    return html`
      <header>
        <ha-menu-button .hass=${this._hass} .narrow=${this.narrow}></ha-menu-button>
        <h1>Homeslice</h1>
        <select class="house" aria-label=${this.t("editor.house")} @change=${(e: Event) => {
          const sel = e.target as HTMLSelectElement;
          if (sel.value === "__new__") {
            sel.value = this._house;
            this.startCreate();
          } else void this.openHouse(sel.value);
        }}>
          ${this._houses.map((h) => html`<option value=${h.id} ?selected=${h.id === this._house}>${h.name}</option>`)}
          <option value="__new__">${this.t("editor.new_house")}…</option>
        </select>
        <div class="segmented modes" role="tablist">
          ${(["rooms", "openings", "objects"] as Mode[]).map(
            (mode, i) => html`<button role="tab" aria-selected=${this._mode === mode} class=${this._mode === mode ? "active" : ""} @click=${() => {
              this._mode = mode;
              this._room = null;
              this._wall = null;
              this._opening = null;
              this._tool = "select";
            }}>${i + 1}. ${this.t(`editor.mode_${mode}` as StringKey)}</button>`,
          )}
        </div>
        <span class="spacer"></span>
        <button class="icon" title=${this.t("editor.undo")} aria-label=${this.t("editor.undo")} ?disabled=${!this.history.canUndo} @click=${() => this.undo()}>↶</button>
        <button class="icon" title=${this.t("editor.redo")} aria-label=${this.t("editor.redo")} ?disabled=${!this.history.canRedo} @click=${() => this.redo()}>↷</button>
        <button class="save ${this.dirty ? "dirty" : ""}" ?disabled=${!this.dirty} @click=${() => this.save()}>
          ${this.dirty ? this.t("editor.save") : this.t("editor.saved")}
        </button>
      </header>
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      <main>
        <aside class="tools">
          <button class=${this._tool === "select" ? "active" : ""} title=${this.t("editor.tool_select")} aria-label=${this.t("editor.tool_select")} @click=${() => (this._tool = "select")}>
            <ha-icon icon="mdi:cursor-default-outline"></ha-icon>
          </button>
          ${this._mode === "rooms"
            ? html`<button class=${this._tool === "rect" ? "active" : ""} title=${this.t("editor.tool_rect")} aria-label=${this.t("editor.tool_rect")} @click=${() => (this._tool = "rect")}>
                <ha-icon icon="mdi:vector-square-plus"></ha-icon>
              </button>
              <button class=${this._tool === "stairs" ? "active" : ""} title=${this.t("editor.tool_stairs")} aria-label=${this.t("editor.tool_stairs")}
                ?disabled=${this._model!.levels.findIndex((l) => l.id === this._level) >= this._model!.levels.length - 1}
                @click=${() => (this._tool = "stairs")}>
                <ha-icon icon="mdi:stairs"></ha-icon>
              </button>`
            : nothing}
          <button title=${this.t("editor.fit")} aria-label=${this.t("editor.fit")} @click=${() => this.fitView()}>
            <ha-icon icon="mdi:fit-to-screen-outline"></ha-icon>
          </button>
        </aside>
        <aside class="levels" aria-label=${this.t("editor.levels")}>
          ${levels.map((l, i) => {
            const d = this._levelDrag;
            let shift = 0;
            if (d && d.moved && l.id !== d.id) {
              // the others slide aside to make room for the dragged level
              if (d.from < i && i <= d.over) shift = -d.step;
              if (d.over <= i && i < d.from) shift = d.step;
            }
            const dragging = d?.moved && l.id === d.id;
            return html`<button
              class="level ${l.id === this._level ? "active" : ""} ${dragging ? "dragging" : ""}"
              style=${dragging ? `transform: translateY(${d!.dy}px); transition: none` : `transform: translateY(${shift}px)`}
              title=${this.t("editor.level_drag")}
              @pointerdown=${(e: PointerEvent) => this.onLevelDown(e, l.id, i)}
              @pointermove=${(e: PointerEvent) => this.onLevelMove(e, levels.length)}
              @pointerup=${() => this.onLevelUp(l.id, levels.length)}
              @pointercancel=${() => (this._levelDrag = null)}
              @keydown=${(e: KeyboardEvent) => this.onLevelKey(e, l.id)}
            >
              <ha-icon icon="mdi:drag-vertical"></ha-icon>
              <span>${this.levelName(l)}</span>
            </button>`;
          })}
          <button class="add-level" title=${this.t("editor.add_level_above")} @click=${() => this.addLevelAt(this._model!.levels.length)}>+ ${this.t("editor.add_level")}</button>
        </aside>
        <section class="plan-wrap">
          ${this.renderPlan()}
          ${this._hint
            ? html`<div class="hint" style="left:${this._hint.x + 16}px;top:${this._hint.y + 16}px">${this._hint.lines.map((l) => html`<div>${l}</div>`)}</div>`
            : nothing}
          <div class="help">${this._calib ? html`<b>${this.t(!this._calib.a ? "editor.calib_first" : !this._calib.b ? "editor.calib_second" : "editor.calib_distance")}</b> ` : this._underlayMove ? html`<b>${this.t("editor.underlay_move_hint")}</b> ` : this._energyPlace ? html`<b>${this.t("editor.energy_click", { name: this.energyName(this._energyPlace) })}</b> ` : nothing}${this.t(this._mode === "openings" ? "editor.openings_hint" : this._mode === "objects" ? "editor.help_objects" : this._tool === "rect" ? "editor.help_rect" : this._tool === "stairs" ? "editor.help_stairs" : "editor.help_select")}${this._pendingArea && this._tool === "rect" ? html` <b>${this.t("editor.drawing_for", { area: this._hass?.areas?.[this._pendingArea]?.name ?? this._pendingArea })}</b>` : nothing}</div>
        </section>
        <section class="side">
          <canvas
            class="preview"
            @pointerdown=${this.onPreviewDown}
            @pointermove=${this.onPreviewMove}
            @pointerup=${() => (this.previewDrag = null)}
            @wheel=${this.onPreviewWheel}
          ></canvas>
          <div class="inspector">${this.renderInspector()}</div>
          ${issues.length
            ? html`<details class="issues" open>
                <summary>${this.t("card.issues", { count: issues.length })}</summary>
                <ul>${issues.map((i) => html`<li class=${i.severity}><code>${i.path}</code> ${i.message}</li>`)}</ul>
              </details>`
            : nothing}
        </section>
      </main>
    `;
  }

  private renderPlan() {
    const m = this._model!;
    const idx = m.levels.findIndex((l) => l.id === this._level);
    const below = m.levels[idx - 1];
    const l = m.levels[idx];
    const pts = (poly: Vec2[]) => poly.map((p) => this.toScreen(p).join(",")).join(" ");
    const { house } = expandHouse(m);
    const level = house?.levels.find((x) => x.id === this._level);
    const walls = level && house ? deriveWalls(level, house.walls, []) : [];
    const selected = l?.rooms.find((r) => r.id === this._room);
    const selPoly = this._room === OUTLINE ? outlineScope(m, this._level).poly : selected ? roomPolygon(m, selected) : [];
    const grid = this._view.scale >= 20 ? 1 : 5;
    return html`<svg
      class="plan tool-${this._tool} mode-${this._mode} ${this._underlayMove ? "underlay-move" : ""} ${this._underlay?.level === this._level && !this._underlayHidden ? "has-underlay" : ""}"
      @pointerdown=${this.onPlanDown}
      @pointermove=${this.onPlanMove}
      @pointerup=${this.onPlanUp}
      @pointercancel=${this.onPlanUp}
      @dblclick=${this.onPlanDoubleClick}
      @wheel=${this.onPlanWheel}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead"></path>
        </marker>
        <pattern id="grid" width=${grid * this._view.scale} height=${grid * this._view.scale} patternUnits="userSpaceOnUse" x=${this._view.ox} y=${this._view.oy}>
          <path d="M ${grid * this._view.scale} 0 L 0 0 0 ${grid * this._view.scale}" fill="none" class="gridline"></path>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)"></rect>
      ${this.renderUnderlay()}
      ${below ? below.rooms.map((r) => svg`<polygon class="ghost" points=${pts(roomPolygon(m, r))}></polygon>`) : nothing}
      ${l?.rooms.map((r) => {
        const poly = this.inner(r, walls);
        const at = this.toScreen(labelPoint(poly));
        return svg`<g data-room=${r.id}>
          <polygon class="room ${r.kind ?? "room"} ${r.id === this._room ? "selected" : ""}" points=${pts(poly)} fill=${PLAN_COLORS[r.floor ?? (r.kind === "outdoor" ? "lawn" : "wood")] ?? PLAN_COLORS.wood}></polygon>
          ${this._mode === "objects"
            ? // lamps sit at the room's centre: the name goes below them
              svg`<text class="room-name" x=${at[0]} y=${at[1] + 26} text-anchor="middle">${this.roomName(r)}</text>`
            : svg`<text class="room-name" x=${at[0]} y=${at[1] - 2} text-anchor="middle">${this.roomName(r)}</text>
                <text class="room-area" x=${at[0]} y=${at[1] + 13} text-anchor="middle">${area(poly).toFixed(1)} m²</text>`}
        </g>`;
      })}
      ${[...walls]
        // inner walls first, so their ends disappear under the outer walls
        .sort((a, b) => Number(a.type === "exterior" || a.type === "party") - Number(b.type === "exterior" || b.type === "party"))
        .map((w) => this.renderWall(w))}
      ${(house?.vertical ?? [])
        // the hole where a stair arrives; where a flight starts, its footprint and the way up
        .filter((v) => idx >= v.from && idx <= v.to)
        .map((v) => {
          const sel = v.id === this._stair;
          const flight = v.kind === "stairs" && idx < v.to;
          return svg`<g data-stair=${v.id} class="stair ${sel ? "selected" : ""}">
            ${idx > v.from ? svg`<polygon class="stairwell" points=${pts(stairHole(v))}></polygon>` : nothing}
            <polygon class="stair-hit" points=${pts(v.polygon)}></polygon>
            ${flight ? svg`<polyline class="stair-path" marker-end="url(#arrow)" points=${pts(this.stairPath(v))}></polyline>` : nothing}
          </g>`;
        })}
      ${this._stair && this._mode === "rooms" ? this.renderStairHandles() : nothing}
      ${this._mode === "objects" ? this.renderLamps() : nothing}
      ${this._mode === "objects" ? this.renderEnergyMarkers() : nothing}
      ${selPoly.length && this._mode === "rooms" ? this.renderHandles(selPoly, selected ? this.inner(selected, walls) : selPoly) : nothing}
      ${this._rectPreview ? svg`<polygon class="rect-preview" points=${pts(this._rectPreview)}></polygon>` : nothing}
      ${this.renderGuides()}
    </svg>`;
  }

  /** Lamps on this level: placed ones and the area lights spread automatically. */
  private levelLamps(): PlacedLight[] {
    const m = this._model;
    if (!m) return [];
    const { house } = expandHouse(m);
    const level = house?.levels.find((l) => l.id === this._level);
    if (!house || !level) return [];
    const walls = deriveWalls(level, house.walls, []);
    const listed = listedLights(house);
    const hass = this._hass;
    return level.rooms
      .filter((r) => r.kind !== "void")
      .flatMap((r) =>
        placeLights(level.id, r, r.kind === "room" ? innerPolygon(r.polygon, walls) : r.polygon, r.areaId && hass ? areaEntities(hass, r.areaId, "light") : [], listed),
      );
  }

  private entityName(id: string) {
    return (this._hass?.states[id]?.attributes.friendly_name as string | undefined) ?? id;
  }

  private renderLamps() {
    return svg`${this.levelLamps().map((l) => {
      const [x, y] = this.toScreen(l.at);
      const on = this._hass?.states[l.entity]?.state === "on";
      const sel = this._room === l.roomId;
      return svg`<g class="lamp-marker ${l.auto ? "auto" : "placed"} ${on ? "on" : ""} ${sel ? "selected" : ""}" data-light=${JSON.stringify({ entity: l.entity, room: l.roomId })}>
        <circle cx=${x} cy=${y} r="10"></circle>
        <path d="M ${x - 3.5} ${y + 5} h 7 M ${x - 2.5} ${y + 7.5} h 5" class="base"></path>
        <circle cx=${x} cy=${y - 1.5} r="4.5" class="bulb"></circle>
        <title>${this.entityName(l.entity)}${l.auto ? ` (${this.t("editor.light_auto")})` : ""}</title>
      </g>`;
    })}`;
  }

  private renderEnergyMarkers() {
    const m = this._model!;
    return svg`${(m.energy ?? []).map((e, i) => {
      if (e.kind === "solar" || e.level !== this._level || !e.at) return nothing;
      const [x, y] = this.toScreen(e.at);
      const letter = { battery: "B", grid: "G", inverter: "I", device: "⚡" }[e.kind as string] ?? "?";
      return svg`<g class="energy-marker ${this._energySel === i ? "selected" : ""}" data-energy=${i} style="--energy:${ENERGY_COLORS[e.kind]}">
        <rect x=${x - 11} y=${y - 11} width="22" height="22" rx="6"></rect>
        <text x=${x} y=${y + 4} text-anchor="middle">${letter}</text>
        <title>${this.energyName(e)}</title>
      </g>`;
    })}`;
  }

  private energyName(e: EnergyInput): string {
    if (e.name) return e.name;
    if (e.kind === "device") return (e.power && this.entityName(e.power)) || this.t("card.energy_device");
    return this.t(`card.energy_${e.kind}` as StringKey);
  }

  /** The energy items to offer: HA's energy settings, then what is already placed. */
  private renderEnergySection() {
    const m = this._model!;
    const prefs = this._energyPrefs;
    const placed = m.energy ?? [];
    const hasSource = (type: string) => !!prefs?.energy_sources.some((x) => x.type === type);
    const offers: EnergyInput[] = [
      ...(hasSource("solar") ? [{ kind: "solar" as const }] : []),
      ...(hasSource("battery") ? [{ kind: "battery" as const }] : []),
      ...(hasSource("grid") ? [{ kind: "grid" as const }] : []),
      { kind: "inverter" as const },
      ...(prefs?.device_consumption ?? []).filter((d) => d.stat_rate).map((d) => ({ kind: "device" as const, power: d.stat_rate, name: d.name })),
    ].filter((o) => !placed.some((p) => p.kind === o.kind && (o.kind !== "device" || p.power === o.power)));
    const levelName = (id?: string) => {
      const l = m.levels.find((x) => x.id === id);
      return l ? this.levelName(l) : "";
    };
    const place = (o: EnergyInput) => {
      if (o.kind === "solar") {
        this.commit(addEnergy(m, { kind: "solar" }).model);
        return;
      }
      this._energyPlace = o;
      this._room = null;
    };
    return html`<h3>${this.t("editor.energy")}</h3>
      <p class="muted">${this.t("editor.energy_hint")}</p>
      ${placed.length
        ? html`<ul class="lights energy">
            ${placed.map(
              (e, i) => html`<li class=${this._energySel === i ? "selected" : ""} style="--energy:${ENERGY_COLORS[e.kind]}">
                <span class="name">${this.energyName(e)}<small class="muted">${e.kind === "solar" ? this.t("editor.energy_on_roof") : levelName(e.level)}</small></span>
                ${e.kind === "solar"
                  ? html`<select aria-label=${this.t("editor.energy_roof_side")} @change=${(ev: Event) => this.commit(updateEnergy(m, i, { roof: (ev.target as HTMLSelectElement).value as Side }))}>
                      ${(["south", "north", "east", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${(e.roof ?? "south") === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
                    </select>`
                  : nothing}
                <button @click=${() => {
                  this.commit(deleteEnergy(m, i));
                  this._energySel = null;
                }}>${this.t("editor.light_remove")}</button>
              </li>`,
            )}
          </ul>`
        : nothing}
      ${offers.length
        ? html`<ul class="lights offers">
            ${offers.map(
              (o) => html`<li>
                <span class="name">${this.energyName(o)}</span>
                <button class=${this._energyPlace && this._energyPlace.kind === o.kind && this._energyPlace.power === o.power ? "active" : ""} @click=${() => place(o)}>
                  ${o.kind === "solar" ? this.t("editor.energy_add") : this.t("editor.energy_place")}
                </button>
              </li>`,
            )}
          </ul>`
        : nothing}
      ${this.entitySelect(this.t("editor.energy_other"), "sensor", undefined, undefined, (power) => power && place({ kind: "device", power }), (id) =>
        this._hass?.states[id]?.attributes.device_class === "power" && !placed.some((p) => p.power === id),
      )}`;
  }

  /** The walking line of a stair, from its first step up (for the arrow on the plan). */
  private stairPath(v: Vertical): Vec2[] {
    const { L, W, plan } = stairFrame(v);
    const E = Math.min(v.entry, L - 0.3);
    if (v.shape !== "u_turn") return [[E + 0.1, W / 2], [L - 0.1, W / 2]].map((p) => plan(p as Vec2));
    const q = W / 4;
    return ([[E + 0.1, q], [L - q, q], [L - q, W - q], [0.15, W - q]] as Vec2[]).map(plan);
  }

  private renderStairHandles() {
    const v = this._model?.vertical?.find((x) => x.id === this._stair);
    if (!v) return nothing;
    const [x, y, w, d] = stairsRect(this._model!, v);
    const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
    return svg`${corners.map((c, i) => {
      const [sx, sy] = this.toScreen(c);
      return svg`<circle class="vertex" data-stairhandle=${JSON.stringify(corners[(i + 2) % 4])} cx=${sx} cy=${sy} r="6"></circle>`;
    })}`;
  }

  private renderGuides() {
    const g = this._guides;
    if (!g) return nothing;
    const x = g.x !== undefined ? this.toScreen([g.x, 0])[0] : null;
    const y = g.y !== undefined ? this.toScreen([0, g.y])[1] : null;
    const ring = g.ring ? this.toScreen(g.ring) : null;
    return svg`${x !== null ? svg`<line class="guide" x1=${x} y1="0" x2=${x} y2="100%"></line>` : nothing}
      ${y !== null ? svg`<line class="guide" x1="0" y1=${y} x2="100%" y2=${y}></line>` : nothing}
      ${ring ? svg`<circle class="snap-ring" cx=${ring[0]} cy=${ring[1]} r="11"></circle>` : nothing}`;
  }

  private renderWall(w: Wall) {
    const [ax, ay] = this.alongWall(w, -w.extendStart);
    const [bx, by] = this.alongWall(w, Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) + w.extendEnd);
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const along = (t: number): Vec2 => this.toScreen([w.a[0] + ((w.b[0] - w.a[0]) * t) / len, w.a[1] + ((w.b[1] - w.a[1]) * t) / len]);
    if (this._mode === "openings" && w.type !== "open") {
      const width = Math.max(2, w.thickness * this._view.scale);
      return svg`<line class="wall ${w.type}" x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${width}></line>
        ${w.rooms.length ? svg`<line class="wall-hit add" data-addwall=${JSON.stringify({ line: w.line, rooms: w.rooms })} x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${Math.max(14, width)}></line>` : nothing}
        ${w.openings.map((o) => {
          const [x1, y1] = this.alongWall(w, o.start);
          const [x2, y2] = this.alongWall(w, o.end);
          const selected = !!this._opening && JSON.stringify(this._opening.src) === JSON.stringify(o.source);
          return svg`<line class="opening-gap" x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke-width=${width + 1}></line>
            <line class="opening type-${o.type} ${selected ? "selected" : ""}" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>
            <line class="opening-hit" data-opening=${JSON.stringify({ src: o.source, room: o.room })} x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke-width=${Math.max(16, width + 6)}></line>`;
        })}`;
    }
    const sel = this._wall;
    const room = sel && w.rooms.includes(sel.a) && w.rooms.includes(sel.b) ? this.levelInputRoomPolygon(sel.a) : null;
    const selected = !!sel && !!room && sideOfRoom(room, w.line[0], w.line[1]) === sel.side;
    let hit: unknown = nothing;
    if ((w.type === "interior" || w.type === "open") && w.rooms.length === 2) {
      const [a, b] = w.rooms;
      const own = this.levelInputRoomPolygon(a);
      const side = own ? sideOfRoom(own, w.line[0], w.line[1]) : null;
      if (side) hit = svg`<line class="wall-hit" data-wall=${JSON.stringify({ a, b, side, line: w.line, thickness: w.thickness })} x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width="14"></line>`;
    }
    if (w.type === "open") return svg`<line class="wall open ${selected ? "selected" : ""}" x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>${hit}`;
    const width = Math.max(2, w.thickness * this._view.scale);
    const outside = w.type !== "interior";
    return svg`<line class="wall ${w.type} ${(outside && this._room === OUTLINE) || selected ? "selected" : ""}" x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${width}></line>${hit}
      ${outside ? svg`<line class="wall-hit" data-outline="1" x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width=${Math.max(12, width)}></line>` : nothing}
      ${w.openings.map((o) => {
        const [x1, y1] = along(o.start);
        const [x2, y2] = along(o.end);
        return svg`<line class="opening-gap" x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke-width=${width + 1}></line>
          <line class="opening type-${o.type}" x1=${x1} y1=${y1} x2=${x2} y2=${y2}></line>`;
      })}`;
  }

  /** Handles sit on the wall centre lines; the lengths shown are inside dimensions. */
  private renderHandles(poly: Vec2[], inner: Vec2[]) {
    const sides = this.innerSides(poly, inner);
    return svg`${poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const [ax, ay] = this.toScreen(p);
      const [bx, by] = this.toScreen(q);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const len = sides[i];
      // label outside the edge (positive orientation: outside is to the right of a→b in screen terms)
      const nx = (by - ay) / (Math.hypot(bx - ax, by - ay) || 1);
      const ny = -(bx - ax) / (Math.hypot(bx - ax, by - ay) || 1);
      return svg`<g>
        <line class="edge-hit" data-handle="edge" data-at=${JSON.stringify([p, q])} x1=${ax} y1=${ay} x2=${bx} y2=${by}></line>
        <rect class="edge-handle" data-handle="edge" data-at=${JSON.stringify([p, q])} x=${mx - 5} y=${my - 5} width="10" height="10" rx="2"></rect>
        <text class="dim" x=${mx + nx * 16} y=${my + ny * 16 + 4} text-anchor="middle">${len.toFixed(2)}</text>
      </g>`;
    })}
    ${poly.map((p) => {
      const [x, y] = this.toScreen(p);
      return svg`<circle class="vertex" data-handle="vertex" data-at=${JSON.stringify(p)} cx=${x} cy=${y} r="7"></circle>`;
    })}`;
  }

  private renderInspector() {
    const m = this._model!;
    const l = this.levelInput;
    if (!l) return nothing;
    if (this._mode === "objects") return this.renderObjectsInspector();
    if (this._mode === "openings") {
      if (this._opening) return this.renderOpeningInspector(this._opening);
      return html`<h2>${this.t("editor.mode_openings")}</h2><p class="muted">${this.t("editor.openings_hint")}</p>`;
    }
    if (this._stair) return this.renderStairInspector(this._stair);
    if (this._room === OUTLINE) return this.renderOutlineInspector();
    if (this._wall) return this.renderWallInspector(this._wall);
    const r = l.rooms.find((x) => x.id === this._room);
    const set = (patch: Partial<RoomInput>) => r && this.commit(updateRoom(m, this._level, r.id, patch));
    if (!r) return this.renderLevelInspector();
    const poly = this.inner(r);
    const areas = Object.values(this._hass?.areas ?? {}).sort((a, b) => {
      // the level's own floor first
      const fa = a.floor_id === l.floor_id ? 0 : 1;
      const fb = b.floor_id === l.floor_id ? 0 : 1;
      return fa - fb || a.name.localeCompare(b.name);
    });
    return html`<h2>${this.roomName(r)}</h2>
      <p class="muted">${area(poly).toFixed(2)} m² · ${this.t("editor.perimeter")} ${poly.reduce((s, p, i) => s + Math.hypot(poly[(i + 1) % poly.length][0] - p[0], poly[(i + 1) % poly.length][1] - p[1]), 0).toFixed(2)} m</p>
      <label>${this.t("editor.ha_area")}
        <select @change=${(e: Event) => set({ area_id: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">—</option>
          ${areas.map((a) => html`<option value=${a.area_id} ?selected=${a.area_id === r.area_id}>${a.name}</option>`)}
        </select>
      </label>
      <label>${this.t("editor.room_id")}
        <input .value=${r.id} @change=${(e: Event) => {
          const id = (e.target as HTMLInputElement).value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
          if (id && id !== r.id && !l.rooms.some((x) => x.id === id)) {
            set({ id });
            this._room = id;
          }
        }} />
      </label>
      <label>${this.t("editor.kind")}
        <select @change=${(e: Event) => set({ kind: (e.target as HTMLSelectElement).value as RoomInput["kind"] })}>
          ${(["room", "outdoor", "void"] as const).map((k) => html`<option value=${k} ?selected=${(r.kind ?? "room") === k}>${this.t(`editor.kind_${k}` as StringKey)}</option>`)}
        </select>
      </label>
      <label>${this.t("editor.floor")}
        <select @change=${(e: Event) => set({ floor: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">${this.t("editor.default")}</option>
          ${Object.keys(PLAN_COLORS).map((k) => html`<option value=${k} ?selected=${r.floor === k}>${k}</option>`)}
        </select>
      </label>
      ${(r.kind ?? "room") === "outdoor"
        ? html`${this.entitySelect(this.t("editor.awning"), "cover", r.area_id, r.awning, (awning) => set({ awning }))}
            <p class="muted">${this.t("editor.awning_hint")}</p>`
        : nothing}
      <button class="danger" @click=${() => {
        this.commit(deleteRoom(m, this._level, r.id));
        this._room = null;
      }}>${this.t("editor.delete_room")}</button>`;
  }

  // ----- level list: pointer-based sorting (works with mouse and touch) -----

  private onLevelDown(e: PointerEvent, id: string, index: number) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const step = el.getBoundingClientRect().height + 6; // button height + gap
    this._levelDrag = { id, from: index, over: index, startY: e.clientY, dy: 0, step, moved: false };
  }

  private onLevelMove(e: PointerEvent, count: number) {
    const d = this._levelDrag;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const moved = d.moved || Math.abs(dy) > 4;
    const over = Math.max(0, Math.min(count - 1, d.from + Math.round(dy / d.step)));
    this._levelDrag = { ...d, dy, moved, over };
  }

  private onLevelUp(id: string, count: number) {
    const d = this._levelDrag;
    this._levelDrag = null;
    if (!d || !this._model) return;
    if (!d.moved) {
      this._level = id;
      this._room = null;
      this._wall = null;
      this._opening = null;
      return;
    }
    // the list shows the top level first; the model stores the bottom level first
    if (d.over !== d.from) this.commit(moveLevel(this._model, id, count - 1 - d.over));
  }

  private onLevelKey(e: KeyboardEvent, id: string) {
    if (!e.altKey || !this._model || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const index = this._model.levels.findIndex((l) => l.id === id);
    const target = index + (e.key === "ArrowUp" ? 1 : -1);
    if (target < 0 || target >= this._model.levels.length) return;
    this.commit(moveLevel(this._model, id, target));
  }

  /** Room edges and centre, and the doors and windows stacked above and below, along the wall. */
  private openingSnaps(sel: { src: OpeningSource; room: string }, o: OpeningInput, axis: 0 | 1): OpeningSnaps {
    const poly = this.levelInputRoomPolygon(sel.room) ?? [];
    const along = poly.map((p) => p[axis]);
    const across = poly.map((p) => p[1 - axis]);
    const origin = Math.min(...along);
    const end = Math.max(...along);
    const line = o.side === "north" || o.side === "west" ? Math.min(...across) : Math.max(...across);
    const edges = [origin, end];
    const centres = [(origin + end) / 2];
    const { house } = expandHouse(this._model!);
    for (const level of house?.levels ?? []) {
      for (const w of deriveWalls(level, house!.walls, [])) {
        if (w.type === "open" || Math.abs(w.line[0][1 - axis] - line) > 0.6 || Math.abs(w.line[1][1 - axis] - line) > 0.6) continue;
        const len = Math.hypot(w.line[1][0] - w.line[0][0], w.line[1][1] - w.line[0][1]) || 1;
        const at = (t: number) => w.line[0][axis] + ((w.line[1][axis] - w.line[0][axis]) * t) / len;
        for (const x of w.openings) {
          if (level.id === this._level && JSON.stringify(x.source) === JSON.stringify(sel.src)) continue;
          const [a, b] = [at(x.start), at(x.end)].sort((p, q) => p - q);
          edges.push(a, b);
          centres.push((a + b) / 2);
        }
      }
    }
    return { origin, width: o.width, edges, centres };
  }

  /** Adds a 1 m window centred on the clicked spot of a wall. */
  private addOpeningAt(hit: { line: [Vec2, Vec2]; rooms: string[] }, world: Vec2) {
    const room = hit.rooms[0];
    const poly = room ? this.levelInputRoomPolygon(room) : null;
    const side = poly ? sideOfRoom(poly, hit.line[0], hit.line[1]) : null;
    if (!poly || !side) return;
    const axis = side === "north" || side === "south" ? 0 : 1;
    const width = 1;
    const min = Math.min(...poly.map((p) => p[axis]));
    const at = Math.max(0, Math.round((world[axis] - min - width / 2) / 0.05) * 0.05);
    const { model, source } = addOpening(this._model!, this._level, { room, side, at: Math.round(at * 100) / 100, width });
    this.commit(model);
    this._opening = { src: source, room };
  }

  private renderOpeningInspector(sel: { src: OpeningSource; room: string }) {
    const m = this._model!;
    const o = readOpening(m, this._level, sel.src);
    if (!o) return nothing;
    const set = (patch: Partial<OpeningInput>) => this.commit(updateOpening(m, this._level, sel.src, patch));
    const num = (key: "width" | "sill" | "height" | "at") => (e: Event) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(v) && v >= 0) set({ [key]: Math.round(v * 100) / 100 });
    };
    const roomInput = this.levelInput?.rooms.find((r) => r.id === sel.room);
    const areaId = roomInput?.area_id;
    const states = this._hass?.states ?? {};
    const shared = sel.src.kind === "facade" ? m.facade_openings?.[sel.src.index]?.levels ?? [] : [];
    const types: OpeningType[] = ["window", "door", "garage_door", "opening"];
    return html`<h2>${this.t(`editor.type_${o.type ?? "window"}` as StringKey)}</h2>
      <p class="muted">${roomInput ? this.roomName(roomInput) : ""} · ${this.t(`editor.side_${o.side}` as StringKey)}</p>
      ${shared.length ? html`<p class="muted">${this.t("editor.opening_shared", { levels: shared.join(", ") })}</p>` : nothing}
      <label>${this.t("editor.opening_type")}
        <select @change=${(e: Event) => set({ type: (e.target as HTMLSelectElement).value as OpeningType })}>
          ${types.map((t) => html`<option value=${t} ?selected=${(o.type ?? "window") === t}>${this.t(`editor.type_${t}` as StringKey)}</option>`)}
        </select>
      </label>
      <div class="row">
        <label>${this.t("editor.opening_at_label")}<input type="number" step="0.05" .value=${String(o.at)} @change=${num("at")} /></label>
        <label>${this.t("editor.opening_width")}<input type="number" step="0.05" .value=${String(o.width)} @change=${num("width")} /></label>
      </div>
      <div class="row">
        <label>${this.t("editor.opening_sill")}<input type="number" step="0.05" placeholder=${this.t("editor.default")} .value=${o.sill === undefined ? "" : String(o.sill)} @change=${num("sill")} /></label>
        <label>${this.t("editor.opening_height")}<input type="number" step="0.05" placeholder=${this.t("editor.default")} .value=${o.height === undefined ? "" : String(o.height)} @change=${num("height")} /></label>
      </div>
      ${this.entitySelect(this.t("editor.opening_cover"), "cover", areaId, o.cover, (cover) => set({ cover }))}
      ${this.entitySelect(this.t("editor.opening_contact"), "binary_sensor", areaId, o.contact, (contact) => set({ contact }), (id) =>
        ["door", "window", "opening", "garage_door"].includes(String(states[id]?.attributes.device_class)),
      )}
      <button class="danger" @click=${() => {
        this.commit(deleteOpening(m, this._level, sel.src));
        this._opening = null;
      }}>${shared.length > 1 ? this.t("editor.opening_delete_here") : this.t("editor.opening_delete")}</button>`;
  }

  /** Pieces of the boundary between two rooms, with their side as seen from `a`. */
  private boundary(a: string, b: string): { side: Side; wall: Wall }[] {
    const m = this._model!;
    const { house } = expandHouse(m);
    const level = house?.levels.find((x) => x.id === this._level);
    const room = level?.rooms.find((r) => r.id === a);
    if (!level || !house || !room) return [];
    return deriveWalls(level, house.walls, [])
      .filter((w) => (w.type === "interior" || w.type === "open") && w.rooms.includes(a) && w.rooms.includes(b))
      .map((wall) => ({ wall, side: sideOfRoom(room.polygon, wall.line[0], wall.line[1]) }))
      .filter((x): x is { side: Side; wall: Wall } => !!x.side);
  }

  private renderWallInspector(sel: { a: string; b: string; side: Side }) {
    const m = this._model!;
    const l = this.levelInput!;
    const name = (id: string) => {
      const r = l.rooms.find((x) => x.id === id);
      return r ? this.roomName(r) : id;
    };
    const all = [...new Set(this.boundary(sel.a, sel.b).map((x) => x.side))];
    const open = openSides(m, this._level, sel.a, sel.b, all).includes(sel.side);
    const set = (o: boolean) => this.commit(setBoundaryOpen(m, this._level, sel.a, sel.b, sel.side, o, all));
    return html`<h2>${this.t("editor.wall")}</h2>
      <p class="muted">${this.t("editor.wall_between", { a: name(sel.a), b: name(sel.b), side: this.t(`editor.side_${sel.side}` as StringKey) })}</p>
      <div class="segmented" role="radiogroup">
        <button role="radio" aria-checked=${!open} class=${!open ? "active" : ""} @click=${() => set(false)}>${this.t("editor.wall_solid")}</button>
        <button role="radio" aria-checked=${open} class=${open ? "active" : ""} @click=${() => set(true)}>${this.t("editor.wall_open")}</button>
      </div>
      <p class="muted">${this.t("editor.wall_hint")}</p>`;
  }

  private levelName(l: { floor_id?: string; name?: string; id: string }) {
    return (l.floor_id && this._hass?.floors?.[l.floor_id]?.name) || l.name || l.id;
  }

  /** Adds a level at `index` (0 = bottom), on the next HA floor in that direction that has no level yet. */
  private addLevelAt(index: number) {
    const m = this._model!;
    const used = new Set(m.levels.map((l) => l.floor_id).filter(Boolean));
    const free = this.haFloors().filter((f) => !used.has(f.floor_id));
    // an HA floor that fits between the neighbours, closest to the one it's added next to
    const lvl = (l?: { floor_id?: string }) => (l?.floor_id ? this._hass?.floors?.[l.floor_id]?.level : undefined) ?? undefined;
    const lo = lvl(m.levels[index - 1]) ?? -Infinity;
    const hi = lvl(m.levels[index]) ?? Infinity;
    const fits = free.filter((f) => (f.level ?? 0) > lo && (f.level ?? 0) < hi).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    const floor = index >= m.levels.length ? fits[0] : fits[fits.length - 1];
    const seed = floor ? { floor_id: floor.floor_id, areas: this.floorAreas(floor.floor_id) } : { name: this.t("editor.new_level_name"), areas: [] };
    const { model, id } = addLevel(m, index, seed);
    this.commit(model);
    this._level = id;
    this._room = null;
    this._wall = null;
  }

  private renderLevelInspector() {
    const m = this._model!;
    const l = this.levelInput!;
    const index = m.levels.findIndex((x) => x.id === l.id);
    const used = new Set(m.levels.filter((x) => x.id !== l.id).map((x) => x.floor_id));
    const set = (patch: Parameters<typeof updateLevel>[2]) => this.commit(updateLevel(m, l.id, patch));
    const placed = new Set(l.rooms.map((r) => r.area_id));
    const unplaced = this.floorAreas(l.floor_id).filter((a) => !placed.has(a.area_id));
    return html`<h2>${this.levelName(l)}</h2>
      <label>${this.t("editor.ha_floor")}
        <select @change=${(e: Event) => set({ floor_id: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">—</option>
          ${this.haFloors().map((f) => html`<option value=${f.floor_id} ?selected=${f.floor_id === l.floor_id} ?disabled=${used.has(f.floor_id)}>${f.name}</option>`)}
        </select>
      </label>
      ${l.floor_id
        ? nothing
        : html`<label>${this.t("editor.level_name")}
            <input .value=${l.name ?? ""} @change=${(e: Event) => set({ name: (e.target as HTMLInputElement).value.trim() || undefined })} />
          </label>`}
      <div class="row">
        <label>${this.t("editor.level_height")}
          <input type="number" min="1" max="10" step="0.05" .value=${String(l.height ?? 2.6)} @change=${(e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            set({ height: v > 0 && v !== 2.6 ? v : undefined });
          }} />
        </label>
      </div>
      <p class="muted">${this.t("editor.rooms_count", { count: l.rooms.length })} · ${this.t("editor.select_hint")}</p>
      ${unplaced.length
        ? html`<h3>${this.t("editor.unplaced_areas")}</h3>
            <p class="muted">${this.t("editor.unplaced_hint")}</p>
            <ul class="unplaced">
              ${unplaced.map(
                (a) => html`<li>
                  <span>${a.name}</span>
                  <button class=${this._pendingArea === a.area_id ? "active" : ""} @click=${() => {
                    this._pendingArea = a.area_id;
                    this._tool = "rect";
                  }}>${this.t("editor.draw_room")}</button>
                </li>`,
              )}
            </ul>`
        : nothing}
      ${this.renderUnderlayInspector()}
      <div class="row">
        <button @click=${() => this.addLevelAt(index + 1)}>${this.t("editor.add_level_above")}</button>
        <button @click=${() => this.addLevelAt(index)}>${this.t("editor.add_level_below")}</button>
      </div>
      <button class="danger" ?disabled=${m.levels.length <= 1} @click=${() => {
        if (!confirm(this.t("editor.delete_level_confirm", { name: this.levelName(l) }))) return;
        const next = deleteLevel(m, l.id);
        this.commit(next);
        this._level = next.levels[Math.max(0, index - 1)].id;
      }}>${this.t("editor.delete_level")}</button>`;
  }

  /**
   * A dropdown of entities of one domain; the area's own entities come first, marked ★,
   * then all others by name.
   */
  private entitySelect(label: string, domain: string, areaId: string | undefined, value: string | undefined, onChange: (id: string | undefined) => void, filter: (id: string) => boolean = () => true) {
    const hass = this._hass;
    const states = hass?.states ?? {};
    const name = (id: string) => (states[id]?.attributes.friendly_name as string | undefined) ?? id;
    const all = Object.keys(states).filter((id) => id.startsWith(`${domain}.`) && filter(id));
    const own = new Set(areaId && hass ? areaEntities(hass, areaId, domain) : []);
    const ids = [...all.filter((id) => own.has(id)), ...all.filter((id) => !own.has(id)).sort((a, b) => name(a).localeCompare(name(b)))];
    return html`<label>${label}
      <select @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value || undefined)}>
        <option value="">—</option>
        ${ids.map((id) => html`<option value=${id} ?selected=${value === id}>${own.has(id) ? `★ ${name(id)}` : name(id)}</option>`)}
      </select>
    </label>`;
  }

  private renderObjectsInspector() {
    const m = this._model!;
    const lamps = this.levelLamps();
    const r = this.levelInput?.rooms.find((x) => x.id === this._room);
    if (!r) {
      const auto = lamps.filter((l) => l.auto).length;
      return html`<h2>${this.t("editor.mode_objects")}</h2>
        <p class="muted">${this.t("editor.objects_hint")}</p>
        <p class="muted">${this.t("editor.lights_count", { count: lamps.length, auto })}</p>
        ${this.renderEnergySection()}`;
    }
    const own = lamps.filter((l) => l.roomId === r.id);
    const hidden = (r.lights ?? []).filter((l) => l.hidden);
    const areaLights = new Set(r.area_id && this._hass ? areaEntities(this._hass, r.area_id, "light") : []);
    const shown = new Set([...own.map((l) => l.entity), ...hidden.map((l) => l.entity)]);
    return html`<h2>${this.roomName(r)}</h2>
      <h3>${this.t("editor.lights")}</h3>
      ${own.length || hidden.length
        ? html`<ul class="lights">
            ${own.map(
              (l) => html`<li>
                <span class="name">${this.entityName(l.entity)}<small class="muted">${l.auto ? this.t("editor.light_auto") : this.t("editor.light_placed")}</small></span>
                ${l.auto ? nothing : html`<button title=${this.t("editor.light_reset_hint")} @click=${() => this.commit(placeLight(m, this._level, r.id, l.entity))}>${this.t("editor.light_reset")}</button>`}
                ${areaLights.has(l.entity)
                  ? html`<button @click=${() => this.commit(setLightHidden(m, this._level, r.id, l.entity, true))}>${this.t("editor.light_hide")}</button>`
                  : html`<button @click=${() => this.commit(removeLight(m, this._level, r.id, l.entity))}>${this.t("editor.light_remove")}</button>`}
              </li>`,
            )}
            ${hidden.map(
              (l) => html`<li class="hidden">
                <span class="name">${this.entityName(l.entity)}<small class="muted">${this.t("editor.light_hidden")}</small></span>
                <button @click=${() => this.commit(removeLight(m, this._level, r.id, l.entity))}>${this.t("editor.light_show")}</button>
              </li>`,
            )}
          </ul>`
        : html`<p class="muted">${this.t("editor.no_lights")}</p>`}
      ${this.entitySelect(this.t("editor.light_add"), "light", r.area_id, undefined, (entity) => entity && this.commit(placeLight(m, this._level, r.id, entity)), (id) => !shown.has(id))}
      <p class="muted">${this.t("editor.lights_hint")}</p>`;
  }

  private renderStairInspector(id: string) {
    const m = this._model!;
    const v = m.vertical?.find((x) => x.id === id);
    if (!v) return nothing;
    const set = (patch: Parameters<typeof updateStairs>[2]) => this.commit(updateStairs(m, id, patch));
    const [, , w, d] = stairsRect(m, v);
    const up = v.up ?? (w >= d ? "east" : "south");
    const across: Side[] = up === "north" || up === "south" ? ["east", "west"] : ["north", "south"];
    const length = up === "east" || up === "west" ? w : d;
    const levelOptions = (value: string, ok: (i: number) => boolean) =>
      m.levels.map((l, i) => html`<option value=${l.id} ?selected=${l.id === value} ?disabled=${!ok(i)}>${this.levelName(l)}</option>`);
    const fromIndex = m.levels.findIndex((l) => l.id === v.from);
    const toIndex = m.levels.findIndex((l) => l.id === v.to);
    return html`<h2>${this.t(v.kind === "shaft" ? "editor.shaft" : "editor.stairs")}</h2>
      <p class="muted">${w.toFixed(2)} × ${d.toFixed(2)} m · ${this.t("editor.stairs_hint")}</p>
      <div class="row">
        <label>${this.t("editor.stairs_from")}
          <select @change=${(e: Event) => set({ from: (e.target as HTMLSelectElement).value })}>${levelOptions(v.from, (i) => i < toIndex)}</select>
        </label>
        <label>${this.t("editor.stairs_to")}
          <select @change=${(e: Event) => set({ to: (e.target as HTMLSelectElement).value })}>${levelOptions(v.to, (i) => i > fromIndex)}</select>
        </label>
      </div>
      <label>${this.t("editor.kind")}
        <select @change=${(e: Event) => set({ kind: (e.target as HTMLSelectElement).value as "stairs" | "shaft" })}>
          <option value="stairs" ?selected=${v.kind !== "shaft"}>${this.t("editor.stairs")}</option>
          <option value="shaft" ?selected=${v.kind === "shaft"}>${this.t("editor.shaft")}</option>
        </select>
      </label>
      ${v.kind === "shaft"
        ? nothing
        : html`<div class="row">
              <label>${this.t("editor.stairs_shape")}
                <select @change=${(e: Event) => set({ shape: (e.target as HTMLSelectElement).value as "straight" | "u_turn" })}>
                  <option value="straight" ?selected=${(v.shape ?? "straight") === "straight"}>${this.t("editor.stairs_straight")}</option>
                  <option value="u_turn" ?selected=${v.shape === "u_turn"}>${this.t("editor.stairs_u_turn")}</option>
                </select>
              </label>
              <label>${this.t("editor.stairs_up")}
                <select @change=${(e: Event) => set({ up: (e.target as HTMLSelectElement).value as Side })}>
                  ${(["north", "east", "south", "west"] as Side[]).map((sd) => html`<option value=${sd} ?selected=${up === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
                </select>
              </label>
            </div>
            ${v.shape === "u_turn"
              ? html`<label>${this.t("editor.stairs_start")}
                  <select @change=${(e: Event) => set({ start: (e.target as HTMLSelectElement).value as Side })}>
                    ${across.map((sd) => html`<option value=${sd} ?selected=${(v.start ?? across[1]) === sd}>${this.t(`editor.side_${sd}` as StringKey)}</option>`)}
                  </select>
                </label>`
              : nothing}
            <label>${this.t("editor.stairs_entry")}
              <input type="number" min="0" max=${Math.max(0, length - 0.5).toFixed(2)} step="0.05" .value=${String(v.entry ?? 0)} @change=${(e: Event) => {
                const val = Number((e.target as HTMLInputElement).value);
                if (val >= 0 && val <= length - 0.5) set({ entry: Math.round(val * 100) / 100 });
              }} />
            </label>
            <p class="muted">${this.t("editor.stairs_entry_hint")}</p>`}
      <button class="danger" @click=${() => {
        this.commit(deleteStairs(m, id));
        this._stair = null;
      }}>${this.t("editor.stairs_delete")}</button>`;
  }

  private renderOutlineInspector() {
    const m = this._model!;
    const scope = outlineScope(m, this._level);
    const names = scope.levels.map((id) => {
      const lv = m.levels.find((x) => x.id === id)!;
      return (lv.floor_id && this._hass?.floors?.[lv.floor_id]?.name) || lv.name || lv.id;
    });
    const poly = scope.poly;
    return html`<h2>${this.t("editor.outline")}</h2>
      <p class="muted">${area(poly).toFixed(2)} m² ${this.t("editor.outline_area")}</p>
      <p class="muted">${scope.owner === "house" ? this.t("editor.outline_shared", { levels: names.join(", ") }) : this.t("editor.outline_own")}</p>
      <p class="muted">${this.t("editor.outline_hint")}</p>
      <button @click=${() => this.commit(setOwnOutline(m, this._level, scope.owner === "house"))}>
        ${scope.owner === "house" ? this.t("editor.outline_make_own") : this.t("editor.outline_use_house")}
      </button>
      <h3>${this.t("editor.roof")}</h3>
      <p class="muted">${this.t("editor.roof_hint")}</p>
      <div class="row">
        <label>${this.t("editor.roof_ridge")}
          <select @change=${(e: Event) => this.commit(setRoof(m, { ridge: ((e.target as HTMLSelectElement).value || undefined) as "east_west" | "north_south" | undefined }))}>
            <option value="" ?selected=${!m.roof?.ridge}>${this.t("editor.roof_ridge_auto")}</option>
            <option value="east_west" ?selected=${m.roof?.ridge === "east_west"}>${this.t("editor.roof_east_west")}</option>
            <option value="north_south" ?selected=${m.roof?.ridge === "north_south"}>${this.t("editor.roof_north_south")}</option>
          </select>
        </label>
        <label>${this.t("editor.roof_pitch")}
          <input type="number" min="5" max="70" step="1" .value=${String(m.roof?.pitch ?? 35)} @change=${(e: Event) => {
            const val = Number((e.target as HTMLInputElement).value);
            if (val > 0 && val < 75) this.commit(setRoof(m, { pitch: val === 35 ? undefined : val }));
          }} />
        </label>
      </div>`;
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      /* HA gives custom panels no fixed height */
      height: 100vh;
      background: var(--primary-background-color, #111);
      color: var(--primary-text-color, #eee);
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
      --accent: var(--primary-color, #03a9f4);
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      min-height: 48px;
      border-bottom: 1px solid var(--divider-color, #333);
      background: var(--app-header-background-color, var(--card-background-color, #1c1c1c));
      flex-wrap: wrap;
    }
    h1 {
      font-size: 18px;
      font-weight: 500;
      margin: 0 8px 0 0;
    }
    .spacer {
      flex: 1;
    }
    button,
    select,
    input {
      font: inherit;
      color: inherit;
      background: var(--card-background-color, #1c1c1c);
      border: 1px solid var(--divider-color, #444);
      border-radius: 8px;
      min-height: 36px;
      padding: 0 10px;
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    button.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    button.icon {
      min-width: 36px;
      font-size: 18px;
    }
    button.save.dirty {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--text-primary-color, #fff);
    }
    button.danger {
      color: var(--error-color, #e57373);
      margin-top: 8px;
    }
    aside.levels {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      width: 150px;
      border-right: 1px solid var(--divider-color, #333);
    }
    button.level {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px 0 2px;
      min-height: 44px;
      text-align: left;
      cursor: grab;
      touch-action: none;
      user-select: none;
      position: relative;
      transition: transform 0.18s ease;
      --mdc-icon-size: 18px;
    }
    button.level ha-icon {
      color: var(--secondary-text-color);
    }
    button.level.dragging {
      z-index: 1;
      cursor: grabbing;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
      border-color: var(--accent);
    }
    @media (prefers-reduced-motion: reduce) {
      button.level {
        transition: none;
      }
    }
    .wall-hit {
      stroke: transparent;
      cursor: pointer;
    }
    .wall.selected {
      stroke: var(--accent);
    }
    .wall.open {
      stroke: #848b92;
      stroke-width: 1.5;
      stroke-dasharray: 6 5;
      pointer-events: none;
    }
    .wall.open.selected {
      stroke: var(--accent);
      stroke-width: 3;
    }
    .segmented {
      display: flex;
    }
    .segmented.modes button {
      white-space: nowrap;
    }
    .wall-hit.add {
      cursor: copy;
    }
    .opening-hit {
      stroke: transparent;
      cursor: ew-resize;
    }
    .opening.selected {
      stroke: #ffb347;
      stroke-width: 5;
    }
    svg.plan.mode-openings .room,
    svg.plan.mode-objects .room {
      cursor: grab;
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .row label {
      flex: 1;
      min-width: 0;
    }
    .row input {
      width: 100%;
      box-sizing: border-box;
    }
    .segmented button {
      flex: 1;
      border-radius: 0;
    }
    .segmented button:first-child {
      border-radius: 8px 0 0 8px;
    }
    .segmented button:last-child {
      border-radius: 0 8px 8px 0;
    }
    fieldset.open-to {
      border: 1px solid var(--divider-color, #444);
      border-radius: 8px;
      padding: 6px 10px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    fieldset.open-to legend {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    label.check {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      color: var(--primary-text-color);
      font-size: 14px;
    }
    label.check input {
      min-height: 0;
      width: 18px;
      height: 18px;
    }
    .error {
      padding: 8px 16px;
      color: var(--error-color);
    }
    main {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .tools {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      border-right: 1px solid var(--divider-color, #333);
    }
    .tools button {
      width: 44px;
      height: 44px;
      padding: 0;
      display: grid;
      place-items: center;
    }
    .plan-wrap {
      position: relative;
      flex: 1;
      min-width: 0;
    }
    svg.plan {
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      user-select: none;
      cursor: grab;
    }
    svg.plan.tool-rect {
      cursor: crosshair;
    }
    .gridline {
      stroke: var(--divider-color, #333);
      stroke-width: 1;
    }
    .ghost {
      fill: none;
      stroke: var(--secondary-text-color, #888);
      stroke-dasharray: 4 4;
      opacity: 0.6;
    }
    .room {
      stroke: rgba(0, 0, 0, 0.25);
      stroke-width: 1;
      opacity: 0.85;
      cursor: pointer;
    }
    .room.outdoor {
      opacity: 0.55;
    }
    .room.selected {
      stroke: var(--accent);
      stroke-width: 2.5;
    }
    .room-name {
      font-size: 13px;
      font-weight: 500;
      fill: #222;
      pointer-events: none;
    }
    .room-area {
      font-size: 11px;
      fill: #444;
      pointer-events: none;
    }
    .wall {
      stroke: #5d646b;
      /* flat ends: outer walls meet exactly at the corners */
      stroke-linecap: butt;
      pointer-events: none;
    }
    /* shared with the neighbours: solid, a bit darker (dashes mean "open") */
    .wall.party {
      stroke: #4b5157;
    }
    .wall.interior {
      stroke: #848b92;
    }
    .opening-gap {
      stroke: #f4f4f4;
      pointer-events: none;
    }
    .opening {
      stroke: #3d8bfd;
      stroke-width: 3;
      pointer-events: none;
    }
    .opening.type-door,
    .opening.type-garage_door,
    .opening.type-opening {
      stroke: #b07c49;
    }
    .stairwell {
      fill: rgba(80, 90, 100, 0.25);
      stroke: #6b747c;
      stroke-dasharray: 3 3;
      pointer-events: none;
    }
    .has-underlay .room {
      fill-opacity: 0.3;
    }
    image.underlay {
      pointer-events: none;
      filter: grayscale(1);
    }
    .tool-select.underlay-move {
      cursor: move;
    }
    .calib-point {
      fill: #ff6b6b;
      stroke: #fff;
      stroke-width: 2;
      pointer-events: none;
    }
    .calib-line {
      stroke: #ff6b6b;
      stroke-width: 2;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    .calib {
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .calib p {
      margin: 0;
    }
    label.file {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      border: 1px solid var(--divider-color, #444);
      border-radius: 8px;
      cursor: pointer;
      color: var(--primary-text-color, #eee);
      font-size: 14px;
    }
    label.file input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .lamp-marker {
      cursor: grab;
    }
    .mode-objects .wall-hit {
      pointer-events: none;
    }
    .lamp-marker circle:first-child {
      fill: rgba(20, 24, 28, 0.85);
      stroke: #c9d1d9;
      stroke-width: 1.5;
    }
    .lamp-marker.auto circle:first-child {
      stroke-dasharray: 3 2;
    }
    .lamp-marker.selected circle:first-child {
      stroke: var(--accent);
      stroke-width: 2.5;
    }
    .lamp-marker .bulb {
      fill: #8d949b;
    }
    .lamp-marker .base {
      stroke: #8d949b;
      stroke-width: 1.5;
    }
    .lamp-marker.on .bulb {
      fill: #ffcf6b;
    }
    .energy-marker {
      cursor: grab;
    }
    .energy-marker rect {
      fill: rgba(20, 24, 28, 0.9);
      stroke: var(--energy);
      stroke-width: 2;
    }
    .energy-marker.selected rect {
      stroke-width: 3.5;
    }
    .energy-marker text {
      fill: var(--energy);
      font-size: 12px;
      font-weight: 700;
      pointer-events: none;
    }
    ul.energy li {
      border-left: 3px solid var(--energy);
      padding-left: 6px;
    }
    ul.energy li.selected {
      background: rgba(255, 255, 255, 0.05);
    }
    ul.lights {
      list-style: none;
      padding: 0;
      margin: 0 0 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    ul.lights li {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    ul.lights li .name {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    ul.lights li.hidden .name {
      opacity: 0.6;
    }
    .stair-hit {
      fill: transparent;
      stroke: #8a8f94;
      stroke-width: 1;
      cursor: move;
    }
    .mode-openings .stair-hit,
    .mode-objects .stair-hit {
      pointer-events: none;
    }
    .stair.selected .stair-hit {
      stroke: var(--accent);
      stroke-width: 2;
    }
    .stair-path {
      fill: none;
      stroke: #b8bdc2;
      stroke-width: 1.5;
      pointer-events: none;
    }
    .arrowhead {
      fill: #b8bdc2;
    }
    .edge-hit {
      stroke: transparent;
      stroke-width: 14;
      cursor: move;
    }
    .edge-handle {
      fill: #fff;
      stroke: var(--accent);
      stroke-width: 2;
      cursor: move;
    }
    .vertex {
      fill: var(--accent);
      stroke: #fff;
      stroke-width: 2;
      cursor: move;
    }
    .dim {
      font-size: 11px;
      fill: var(--primary-text-color, #eee);
      paint-order: stroke;
      stroke: var(--primary-background-color, #111);
      stroke-width: 3px;
      pointer-events: none;
    }
    .guide {
      stroke: #ff4fa3;
      stroke-width: 1;
      stroke-dasharray: 5 4;
      pointer-events: none;
    }
    .snap-ring {
      fill: none;
      stroke: #ff4fa3;
      stroke-width: 2;
      pointer-events: none;
    }
    .rect-preview {
      fill: rgba(3, 169, 244, 0.15);
      stroke: var(--accent);
      stroke-width: 2;
      stroke-dasharray: 5 4;
      pointer-events: none;
    }
    .hint {
      position: absolute;
      pointer-events: none;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--card-background-color, #222);
      border: 1px solid var(--divider-color, #444);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .help {
      position: absolute;
      left: 12px;
      bottom: 10px;
      font-size: 12px;
      color: var(--secondary-text-color, #999);
      pointer-events: none;
    }
    .side {
      width: min(420px, 40%);
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--divider-color, #333);
      min-height: 0;
      overflow: auto;
    }
    canvas.preview {
      width: 100%;
      height: 300px;
      flex: none;
      display: block;
      cursor: grab;
      touch-action: none;
      border-bottom: 1px solid var(--divider-color, #333);
    }
    .inspector {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .inspector h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 500;
    }
    .inspector label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color, #aaa);
    }
    .muted {
      margin: 0;
      font-size: 12px;
      color: var(--secondary-text-color, #aaa);
    }
    .issues {
      padding: 8px 16px 16px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .issues li.error {
      color: var(--error-color);
    }
    .create {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: min(440px, calc(100vw - 32px));
      text-align: left;
      background: var(--card-background-color, #1c1c1c);
      border-radius: 12px;
      padding: 20px;
    }
    .create h2 {
      margin: 0;
    }
    .create label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color, #aaa);
    }
    .create label.check,
    .inspector label.check {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .create fieldset {
      border: 1px solid var(--divider-color, #333);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .row > label {
      flex: 1;
    }
    .row.end {
      justify-content: flex-end;
    }
    button.primary {
      background: var(--accent);
      color: var(--text-primary-color, #fff);
      border-color: var(--accent);
    }
    .add-level {
      font-size: 13px;
      opacity: 0.8;
    }
    ul.unplaced {
      list-style: none;
      padding: 0;
      margin: 0 0 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    ul.unplaced li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .inspector h3 {
      font-size: 14px;
      margin: 12px 0 2px;
    }
    .empty {
      padding: 32px;
      color: var(--secondary-text-color);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    @media (max-width: 900px) {
      main {
        flex-direction: column;
      }
      aside.levels {
        flex-direction: row;
        width: auto;
        overflow-x: auto;
        border-right: none;
      }
      .tools {
        flex-direction: row;
        border-right: none;
        border-bottom: 1px solid var(--divider-color, #333);
      }
      .side {
        width: 100%;
        max-height: 45%;
        border-left: none;
        border-top: 1px solid var(--divider-color, #333);
      }
    }
  `;
}
