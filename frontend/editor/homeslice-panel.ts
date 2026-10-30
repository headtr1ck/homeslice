// The Homeslice editor: a full-screen sidebar panel with the 2D plan of one level, a live
// 3D preview and an inspector. Edits work on the short-form model and are saved to
// Homeslice's storage, where every card picks them up at once.

import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { areaEntities, type Hass } from "../ha/hass";
import { localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { labelPoint } from "../model/geometry";
import type { HouseInput, Issue, OpeningInput, OpeningSource, OpeningType, RoomInput, Side, Vec2 } from "../model/types";
import { deriveWalls, sideOfRoom, type Wall } from "../model/walls";
import { HouseRenderer } from "../render/scene";
import {
  History,
  addOpening,
  addRoom,
  deleteOpening,
  readOpening,
  updateOpening,
  area,
  clone,
  cornerAngle,
  deleteRoom,
  moveEdge,
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

type Tool = "select" | "rect";
/** The editor's phases: shape the house, then doors and windows, then objects and entities. */
type Mode = "rooms" | "openings" | "objects";

type Drag =
  | { kind: "pan"; start: Vec2; offset: Vec2 }
  | { kind: "vertex"; origin: HouseInput; from: Vec2; ctx: SnapContext }
  | { kind: "edge"; origin: HouseInput; a: Vec2; b: Vec2; startWorld: Vec2; normal: Vec2; ctx: SnapContext }
  | { kind: "rect"; start: Vec2; ctx: SnapContext }
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
    this._level = model.levels.find((l) => l.floor_id === "ground_floor")?.id ?? model.levels[0]?.id ?? "";
    this._room = null;
    this.fitted = "";
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
    } else if ((e.key === "Delete" || e.key === "Backspace") && this._room && this._model && this._mode === "rooms") {
      this.commit(deleteRoom(this._model, this._level, this._room));
      this._room = null;
    } else if (e.key === "Escape") {
      this._room = null;
      this._wall = null;
      this._opening = null;
      this._tool = "select";
      this._drag = null;
      this._rectPreview = null;
    } else if (e.key === "r" && !mod) this._tool = "rect";
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
    if (this._mode === "objects") {
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
    if (this._tool === "rect") {
      const ctx = this.snapContext();
      this._drag = { kind: "rect", start: snap(world, ctx).p, ctx };
      return;
    }
    const wallHit = target.closest("[data-wall]") as SVGElement | null;
    this._wall = wallHit ? JSON.parse(wallHit.dataset.wall!) : null;
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
      this._hint = { x: screen[0], y: screen[1], lines: [`${snappedAlong >= 0 ? "+" : ""}${snappedAlong.toFixed(2)} m`, ...this.roomReadout()] };
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
    if (drag.kind === "vertex" || drag.kind === "edge" || drag.kind === "opening") {
      if (JSON.stringify(drag.origin) !== JSON.stringify(this._model)) this.commit(this._model, drag.origin);
    } else if (drag.kind === "rect" && this._rectPreview) {
      const [[x0, y0], , [x1, y1]] = this._rectPreview;
      this._rectPreview = null;
      if (Math.abs(x1 - x0) >= 0.3 && Math.abs(y1 - y0) >= 0.3) {
        const { model, id } = addRoom(this._model, this._level, [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]]);
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
      const prev = poly[(i - 1 + poly.length) % poly.length];
      const next = poly[(i + 1) % poly.length];
      lines.push(`${fmtM(Math.hypot(at[0] - prev[0], at[1] - prev[1]))} · ${fmtM(Math.hypot(at[0] - next[0], at[1] - next[1]))} · ${Math.round(cornerAngle(poly, i))}°`);
      lines.push(`${this.roomName(r)}: ${area(poly).toFixed(2)} m²`);
      break;
    }
    return lines;
  }

  private roomReadout(): string[] {
    const r = this.levelInput?.rooms.find((x) => x.id === this._room);
    return r ? [`${this.roomName(r)}: ${area(roomPolygon(this._model!, r)).toFixed(2)} m²`] : [];
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
    if (!this._model) {
      return html`<div class="empty">${this._error || (this._houses.length ? this.t("card.loading") : this.t("editor.no_houses"))}</div>`;
    }
    const levels = [...this._model.levels].reverse();
    const issues = this.issues();
    return html`
      <header>
        <ha-menu-button .hass=${this._hass} .narrow=${this.narrow}></ha-menu-button>
        <h1>Homeslice</h1>
        <select class="house" aria-label=${this.t("editor.house")} @change=${(e: Event) => this.openHouse((e.target as HTMLSelectElement).value)}>
          ${this._houses.map((h) => html`<option value=${h.id} ?selected=${h.id === this._house}>${h.name}</option>`)}
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
              <span>${(l.floor_id && this._hass?.floors?.[l.floor_id]?.name) || l.name || l.id}</span>
            </button>`;
          })}
        </aside>
        <section class="plan-wrap">
          ${this.renderPlan()}
          ${this._hint
            ? html`<div class="hint" style="left:${this._hint.x + 16}px;top:${this._hint.y + 16}px">${this._hint.lines.map((l) => html`<div>${l}</div>`)}</div>`
            : nothing}
          <div class="help">${this.t(this._mode === "openings" ? "editor.openings_hint" : this._mode === "objects" ? "editor.objects_soon" : this._tool === "rect" ? "editor.help_rect" : "editor.help_select")}</div>
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
      class="plan tool-${this._tool} mode-${this._mode}"
      @pointerdown=${this.onPlanDown}
      @pointermove=${this.onPlanMove}
      @pointerup=${this.onPlanUp}
      @pointercancel=${this.onPlanUp}
      @dblclick=${this.onPlanDoubleClick}
      @wheel=${this.onPlanWheel}
    >
      <defs>
        <pattern id="grid" width=${grid * this._view.scale} height=${grid * this._view.scale} patternUnits="userSpaceOnUse" x=${this._view.ox} y=${this._view.oy}>
          <path d="M ${grid * this._view.scale} 0 L 0 0 0 ${grid * this._view.scale}" fill="none" class="gridline"></path>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)"></rect>
      ${below ? below.rooms.map((r) => svg`<polygon class="ghost" points=${pts(roomPolygon(m, r))}></polygon>`) : nothing}
      ${l?.rooms.map((r) => {
        const poly = roomPolygon(m, r);
        const at = this.toScreen(labelPoint(poly));
        return svg`<g data-room=${r.id}>
          <polygon class="room ${r.kind ?? "room"} ${r.id === this._room ? "selected" : ""}" points=${pts(poly)} fill=${PLAN_COLORS[r.floor ?? (r.kind === "outdoor" ? "lawn" : "wood")] ?? PLAN_COLORS.wood}></polygon>
          <text class="room-name" x=${at[0]} y=${at[1] - 2} text-anchor="middle">${this.roomName(r)}</text>
          <text class="room-area" x=${at[0]} y=${at[1] + 13} text-anchor="middle">${area(poly).toFixed(1)} m²</text>
        </g>`;
      })}
      ${[...walls]
        // inner walls first, so their ends disappear under the outer walls
        .sort((a, b) => Number(a.type === "exterior" || a.type === "party") - Number(b.type === "exterior" || b.type === "party"))
        .map((w) => this.renderWall(w))}
      ${(house?.vertical ?? [])
        .filter((v) => idx >= v.from && idx <= v.to)
        .map((v) => svg`<polygon class="stairwell" points=${pts(v.polygon)}></polygon>`)}
      ${selPoly.length && this._mode === "rooms" ? this.renderHandles(selPoly) : nothing}
      ${this._rectPreview ? svg`<polygon class="rect-preview" points=${pts(this._rectPreview)}></polygon>` : nothing}
      ${this.renderGuides()}
    </svg>`;
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
      if (side) hit = svg`<line class="wall-hit" data-wall=${JSON.stringify({ a, b, side })} x1=${ax} y1=${ay} x2=${bx} y2=${by} stroke-width="14"></line>`;
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

  private renderHandles(poly: Vec2[]) {
    return svg`${poly.map((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const [ax, ay] = this.toScreen(p);
      const [bx, by] = this.toScreen(q);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
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
    if (this._mode === "objects") return html`<h2>${this.t("editor.mode_objects")}</h2><p class="muted">${this.t("editor.objects_soon")}</p>`;
    if (this._mode === "openings") {
      if (this._opening) return this.renderOpeningInspector(this._opening);
      return html`<h2>${this.t("editor.mode_openings")}</h2><p class="muted">${this.t("editor.openings_hint")}</p>`;
    }
    if (this._room === OUTLINE) return this.renderOutlineInspector();
    if (this._wall) return this.renderWallInspector(this._wall);
    const r = l.rooms.find((x) => x.id === this._room);
    const set = (patch: Partial<RoomInput>) => r && this.commit(updateRoom(m, this._level, r.id, patch));
    if (!r) {
      const floors = Object.values(this._hass?.floors ?? {});
      return html`<h2>${this.t("editor.level")}</h2>
        <label>${this.t("editor.ha_floor")}
          <select @change=${(e: Event) => {
            const next = clone(m);
            const lv = next.levels.find((x) => x.id === this._level)!;
            const v = (e.target as HTMLSelectElement).value;
            if (v) lv.floor_id = v;
            else delete lv.floor_id;
            this.commit(next);
          }}>
            <option value="">—</option>
            ${floors.map((f) => html`<option value=${f.floor_id} ?selected=${f.floor_id === l.floor_id}>${f.name}</option>`)}
          </select>
        </label>
        <p class="muted">${this.t("editor.rooms_count", { count: l.rooms.length })}</p>
        <p class="muted">${this.t("editor.select_hint")}</p>`;
    }
    const poly = roomPolygon(m, r);
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
    const hass = this._hass;
    const states = hass?.states ?? {};
    const name = (id: string) => (states[id]?.attributes.friendly_name as string | undefined) ?? id;
    const options = (domain: string, filter: (id: string) => boolean = () => true) => {
      const all = Object.keys(states).filter((id) => id.startsWith(`${domain}.`) && filter(id));
      const own = new Set(areaId && hass ? areaEntities(hass, areaId, domain) : []);
      return [...all.filter((id) => own.has(id)), ...all.filter((id) => !own.has(id)).sort((a, b) => name(a).localeCompare(name(b)))];
    };
    const contacts = options("binary_sensor", (id) => ["door", "window", "opening", "garage_door"].includes(String(states[id]?.attributes.device_class)));
    const covers = options("cover");
    const shared = sel.src.kind === "facade" ? m.facade_openings?.[sel.src.index]?.levels ?? [] : [];
    const label = (id: string) => (areaId && hass && areaEntities(hass, areaId, id.split(".")[0]).includes(id) ? `★ ${name(id)}` : name(id));
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
      <label>${this.t("editor.opening_cover")}
        <select @change=${(e: Event) => set({ cover: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">—</option>
          ${covers.map((id) => html`<option value=${id} ?selected=${o.cover === id}>${label(id)}</option>`)}
        </select>
      </label>
      <label>${this.t("editor.opening_contact")}
        <select @change=${(e: Event) => set({ contact: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">—</option>
          ${contacts.map((id) => html`<option value=${id} ?selected=${o.contact === id}>${label(id)}</option>`)}
        </select>
      </label>
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
      </button>`;
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
    .empty {
      padding: 32px;
      color: var(--secondary-text-color);
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
