// The visual editor of the house card (in the dashboard's card dialog): pick the house,
// turn the little preview into the angle the card should show, and set the look.

import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import type { Hass } from "../ha/hass";
import { loadLanguage, localize, type StringKey } from "../i18n/localize";
import { expandHouse } from "../model/expand";
import { deriveWalls, type Wall } from "../model/walls";
import { DEFAULT_ACCENT, DEFAULT_VIEW, HouseRenderer, viewOptions } from "../render/scene";
import type { HomesliceCardConfig } from "./homeslice-card";

type View = NonNullable<HomesliceCardConfig["view"]>;

export class HomesliceCardEditor extends LitElement {
  static override properties = {
    _config: { state: true },
    _houses: { state: true },
    _error: { state: true },
  };

  private _hass?: Hass;
  private _config: HomesliceCardConfig = { type: "custom:homeslice-card" };
  private _houses: { id: string; name: string }[] = [];
  private _error = "";
  private renderer?: HouseRenderer;
  private loaded = "";
  private drag: [number, number] | null = null;

  set hass(hass: Hass) {
    const first = !this._hass;
    this._hass = hass;
    void loadLanguage(hass?.locale?.language).then((loaded) => loaded && this.requestUpdate());
    if (first) void this.loadHouses();
  }

  setConfig(config: HomesliceCardConfig) {
    this._config = config;
  }

  private t(key: StringKey, vars?: Record<string, string | number>) {
    return localize(this._hass?.locale?.language, key, vars);
  }

  private get view(): View {
    return this._config.view ?? {};
  }

  /** Tells the dashboard about the new config (that's how card editors save). */
  private change(patch: Partial<HomesliceCardConfig>, view?: Partial<View>) {
    const config: HomesliceCardConfig = { ...this._config, ...patch };
    if (view) {
      const next: Record<string, unknown> = { ...this.view, ...view };
      for (const [k, v] of Object.entries(view)) if (v === undefined) delete next[k];
      config.view = next as View;
    }
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (config as unknown as Record<string, unknown>)[k];
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  private async loadHouses() {
    try {
      this._houses = await this._hass!.callWS<{ id: string; name: string }[]>({ type: "homeslice/houses" });
    } catch (e) {
      this._error = String((e as { message?: string }).message ?? e);
    }
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has("_config") || changed.has("_houses")) void this.updatePreview();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.loaded = "";
  }

  private async updatePreview() {
    const canvas = this.renderRoot.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas || !this._hass) return;
    if (!this.renderer) {
      try {
        this.renderer = new HouseRenderer(canvas);
        this.renderer.onChange = () => this.draw();
      } catch {
        return;
      }
    }
    const house = this._config.house ?? "home";
    const key = `${house}|${JSON.stringify({ ...this.view, azimuth: 0, elevation: 0 })}`;
    if (this.loaded !== key) {
      this.loaded = key;
      try {
        const raw = await this._hass.callWS<unknown>({ type: "homeslice/model", house });
        const { house: h, issues } = expandHouse(raw);
        if (!h) return;
        const walls = new Map<string, Wall[]>();
        for (const l of h.levels) walls.set(l.id, deriveWalls(l, h.walls, issues));
        this.renderer.setModel(h, walls, viewOptions(this.view));
        this._error = "";
      } catch (e) {
        this._error = String((e as { message?: string }).message ?? e);
        return;
      }
    }
    this.draw();
  }

  private draw() {
    const canvas = this.renderRoot.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas || !this.renderer) return;
    const v = this.view;
    this.renderer.orientation = {
      azimuth: v.azimuth ?? DEFAULT_VIEW.azimuth,
      elevation: v.elevation ?? DEFAULT_VIEW.elevation,
      fov: (v.projection ?? DEFAULT_VIEW.projection) === "isometric" ? 3 : 40,
    };
    const { width, height } = canvas.getBoundingClientRect();
    if (width && height) this.renderer.render(width, height);
  }

  private onDown(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.drag = [e.clientX, e.clientY];
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) return;
    const v = this.view;
    const azimuth = ((((v.azimuth ?? DEFAULT_VIEW.azimuth) - (e.clientX - this.drag[0]) * 0.35) % 360) + 360) % 360;
    const elevation = Math.max(5, Math.min(89, (v.elevation ?? DEFAULT_VIEW.elevation) + (e.clientY - this.drag[1]) * 0.25));
    this.drag = [e.clientX, e.clientY];
    // live in the little preview; the dashboard hears about it when the drag ends
    this._config = { ...this._config, view: { ...v, azimuth: Math.round(azimuth), elevation: Math.round(elevation) } };
  }

  private onUp() {
    if (!this.drag) return;
    this.drag = null;
    this.change({}, { azimuth: this.view.azimuth, elevation: this.view.elevation });
  }

  protected override render() {
    const v = this.view;
    const houses = this._houses;
    return html`
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
      ${houses.length > 1 || !houses.some((h) => h.id === (this._config.house ?? "home"))
        ? html`<label
            >${this.t("cardeditor.house")}
            <select @change=${(e: Event) => this.change({ house: (e.target as HTMLSelectElement).value })}>
              ${houses.map((h) => html`<option value=${h.id} ?selected=${h.id === (this._config.house ?? "home")}>${h.name}</option>`)}
            </select>
          </label>`
        : nothing}
      <label
        >${this.t("cardeditor.mode")}
        <select @change=${(e: Event) => {
          const mode = (e.target as HTMLSelectElement).value;
          this.change({ mode: mode === "plan" || mode === "tilted" ? mode : undefined });
        }}>
          <option value="3d" ?selected=${!this._config.mode || this._config.mode === "3d"}>${this.t("cardeditor.mode_3d")}</option>
          <option value="tilted" ?selected=${this._config.mode === "tilted"}>${this.t("cardeditor.mode_tilted")}</option>
          <option value="plan" ?selected=${this._config.mode === "plan"}>${this.t("cardeditor.mode_plan")}</option>
        </select>
      </label>
      <label class="check" ?hidden=${this._config.mode !== "plan"}
        ><input type="checkbox" .checked=${this._config.floors === "all"} @change=${(e: Event) => this.change({ floors: (e.target as HTMLInputElement).checked ? "all" : undefined })} />
        ${this.t("cardeditor.floors_all")}</label
      >
      <!-- a plan has no camera angle, floor gap or roof (kept in the page: the preview needs its canvas) -->
      <div class="three-d" ?hidden=${this._config.mode === "plan"}>
      <div class="preview">
        <canvas @pointerdown=${this.onDown} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onUp}></canvas>
        <div class="readout">
          ${this.t("cardeditor.angle", { azimuth: v.azimuth ?? DEFAULT_VIEW.azimuth, elevation: v.elevation ?? DEFAULT_VIEW.elevation })}
        </div>
      </div>
      <p class="hint">${this.t("cardeditor.turn_hint")}</p>
      <div class="row">
        <label
          >${this.t("cardeditor.projection")}
          <select @change=${(e: Event) => this.change({}, { projection: (e.target as HTMLSelectElement).value as View["projection"] })}>
            <option value="isometric" ?selected=${(v.projection ?? "isometric") === "isometric"}>${this.t("cardeditor.isometric")}</option>
            <option value="perspective" ?selected=${v.projection === "perspective"}>${this.t("cardeditor.perspective")}</option>
          </select>
        </label>
        <label
          >${this.t("cardeditor.explode")}
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            .value=${String(v.explode ?? DEFAULT_VIEW.explode)}
            @change=${(e: Event) => {
              const n = Number((e.target as HTMLInputElement).value);
              if (n >= 0) this.change({}, { explode: n === DEFAULT_VIEW.explode ? undefined : n });
            }}
          />
        </label>
      </div>
      </div>
      <label class="check"
        ><input type="checkbox" .checked=${v.show_outdoor !== false} @change=${(e: Event) => this.change({}, { show_outdoor: (e.target as HTMLInputElement).checked ? undefined : false })} />
        ${this.t("cardeditor.outdoor")}</label
      >
      <label class="check" ?hidden=${this._config.mode === "plan"}
        ><input type="checkbox" .checked=${!!v.roof} @change=${(e: Event) => this.change({}, { roof: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.roof")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${v.furniture !== "simple"} @change=${(e: Event) => this.change({}, { furniture: (e.target as HTMLInputElement).checked ? undefined : "simple" })} />
        ${this.t("cardeditor.furniture")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.energy === true} @change=${(e: Event) => this.change({ energy: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.energy")}</label
      >
      <label
        >${this.t("cardeditor.look")}
        <select @change=${(e: Event) => {
          const look = (e.target as HTMLSelectElement).value;
          this.change({ look: look === "day" ? undefined : (look as HomesliceCardConfig["look"]) });
        }}>
          ${(["day", "night", "auto", "white", "blueprint"] as const).map((l) => html`<option value=${l} ?selected=${(this._config.look ?? "day") === l}>${this.t(`cardeditor.look_${l}`)}</option>`)}
        </select>
      </label>
      <label
        >${this.t("cardeditor.heatmap")}
        <select @change=${(e: Event) => {
          const h = (e.target as HTMLSelectElement).value;
          this.change({ heatmap: h ? (h as HomesliceCardConfig["heatmap"]) : undefined });
        }}>
          ${(["", "temperature", "humidity", "carbon_dioxide", "pm25"] as const).map((h) => html`<option value=${h} ?selected=${(this._config.heatmap ?? "") === h}>${this.t(`cardeditor.heatmap_${h || "none"}`)}</option>`)}
        </select>
      </label>
      <label
        >${this.t("cardeditor.lamp_style")}
        <select @change=${(e: Event) => this.change({ lamp_style: (e.target as HTMLSelectElement).value === "circle" ? "circle" : undefined })}>
          ${(["icon", "circle"] as const).map((v) => html`<option value=${v} ?selected=${(this._config.lamp_style ?? "icon") === v}>${this.t(`cardeditor.lamp_style_${v}`)}</option>`)}
        </select>
      </label>
      <label class="check"
        ><input type="checkbox" .checked=${this._config.feedback !== false} @change=${(e: Event) => this.change({ feedback: (e.target as HTMLInputElement).checked ? undefined : false })} />
        ${this.t("cardeditor.feedback")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${!!this._config.climate_hints} @change=${(e: Event) => this.change({ climate_hints: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.climate_hints")}</label
      >
      <label
        >${this.t("cardeditor.sensor_timeout")}
        <input
          type="number"
          min="0"
          step="1"
          .value=${String(this._config.sensor_timeout ?? "")}
          @change=${(e: Event) => {
            const n = Number((e.target as HTMLInputElement).value);
            this.change({ sensor_timeout: n > 0 ? n : undefined });
          }}
        />
      </label>
      <fieldset class="values">
        <legend>${this.t("cardeditor.values")}</legend>
        ${(["temperature", "humidity", "carbon_dioxide", "pm25", "volatile_organic_compounds"] as const).map((kind) => {
          const values = this._config.values ?? ["temperature"];
          return html`<label class="check"
            ><input
              type="checkbox"
              .checked=${values.includes(kind)}
              @change=${(e: Event) => {
                const next = (e.target as HTMLInputElement).checked ? [...values, kind] : values.filter((v) => v !== kind);
                this.change({ values: next.length === 1 && next[0] === "temperature" ? undefined : next });
              }}
            />
            ${this.t(`cardeditor.heatmap_${kind}`)}</label
          >`;
        })}
      </fieldset>
      <label
        >${this.t("cardeditor.quality")}
        <select @change=${(e: Event) => {
          const q = (e.target as HTMLSelectElement).value;
          this.change({ quality: q === "auto" ? undefined : (q as "high" | "low") });
        }}>
          ${(["auto", "high", "low"] as const).map((q) => html`<option value=${q} ?selected=${(this._config.quality ?? "auto") === q}>${this.t(`cardeditor.quality_${q}`)}</option>`)}
        </select>
      </label>
      <label ?hidden=${["day", "white"].includes(this._config.look ?? "day")}
        >${this.t("cardeditor.accent")}
        <input type="color" .value=${this._config.accent ?? DEFAULT_ACCENT} @change=${(e: Event) => {
          const accent = (e.target as HTMLInputElement).value;
          this.change({ accent: accent === DEFAULT_ACCENT ? undefined : accent });
        }} />
      </label>
      <label class="check"
        ><input type="checkbox" .checked=${this._config.sun !== false} @change=${(e: Event) => this.change({ sun: (e.target as HTMLInputElement).checked ? undefined : false })} />
        ${this.t("cardeditor.sun")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.lux === true} @change=${(e: Event) => this.change({ lux: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.lux")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.presence !== false} @change=${(e: Event) => this.change({ presence: (e.target as HTMLInputElement).checked ? undefined : false })} />
        ${this.t("cardeditor.presence")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.badges !== false} @change=${(e: Event) => this.change({ badges: (e.target as HTMLInputElement).checked ? undefined : false })} />
        ${this.t("cardeditor.badges")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.heating === true} @change=${(e: Event) => this.change({ heating: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.heating")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.room_panel !== false} @change=${(e: Event) => this.change({ room_panel: (e.target as HTMLInputElement).checked ? undefined : false })} />
        ${this.t("cardeditor.room_panel")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.interactive === true} @change=${(e: Event) => this.change({ interactive: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.interactive")}</label
      >
      <label
        >${this.t("cardeditor.weather")}
        <select @change=${(e: Event) => this.change({ weather: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="" ?selected=${!this._config.weather}>${this.t("cardeditor.heatmap_none")}</option>
          ${Object.keys(this._hass?.states ?? {})
            .filter((id) => id.startsWith("weather."))
            .map((id) => html`<option value=${id} ?selected=${this._config.weather === id}>${(this._hass!.states[id].attributes.friendly_name as string | undefined) ?? id}</option>`)}
        </select>
      </label>
      ${this._config.weather
        ? html`<label class="check"
            ><input type="checkbox" .checked=${this._config.weather_effects !== false} @change=${(e: Event) => this.change({ weather_effects: (e.target as HTMLInputElement).checked ? undefined : false })} />
            ${this.t("cardeditor.weather_effects")}</label
          >`
        : nothing}
      <label class="check"
        ><input type="checkbox" .checked=${this._config.sun_path === true} @change=${(e: Event) => this.change({ sun_path: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.sun_path")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.time_travel === true} @change=${(e: Event) => this.change({ time_travel: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.time_travel")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.walk === true} @change=${(e: Event) => this.change({ walk: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.walk")}</label
      >
      <fieldset class="values">
        <legend>${this.t("cardeditor.layers")}</legend>
        ${(["energy", "heating", "heatmap", "values", "presence", "climate"] as const).map((layer) => {
          const layers = this._config.layers ?? [];
          return html`<label class="check"
            ><input
              type="checkbox"
              .checked=${layers.includes(layer)}
              @change=${(e: Event) => {
                const next = (e.target as HTMLInputElement).checked ? [...layers, layer] : layers.filter((l) => l !== layer);
                this.change({ layers: next.length ? next : undefined });
              }}
            />
            ${this.t(`card.layer_${layer}`)}</label
          >`;
        })}
      </fieldset>
      <h3>${this.t("cardeditor.kiosk")}</h3>
      <label
        >${this.t("cardeditor.idle_return")}
        <input
          type="number"
          min="0"
          step="10"
          .value=${String(this._config.idle_return ?? "")}
          @change=${(e: Event) => {
            const n = Number((e.target as HTMLInputElement).value);
            this.change({ idle_return: n > 0 ? n : undefined });
          }}
        />
      </label>
      <label
        >${this.t("cardeditor.night")}
        <select
          @change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            this.change({ night: v === "off" ? undefined : v === "time" ? "22:00-06:00" : v });
          }}
        >
          ${(["off", "sun", "time"] as const).map((v) => {
            const current = !this._config.night ? "off" : this._config.night === "sun" ? "sun" : "time";
            return html`<option value=${v} ?selected=${current === v}>${this.t(`cardeditor.night_${v}`)}</option>`;
          })}
        </select>
      </label>
      ${this._config.night && this._config.night !== "sun"
        ? html`<label
            >${this.t("cardeditor.night_range")}
            <input .value=${this._config.night} placeholder="22:00-06:00" @change=${(e: Event) => this.change({ night: (e.target as HTMLInputElement).value.trim() || undefined })} />
          </label>`
        : nothing}
      <label class="check"
        ><input type="checkbox" .checked=${this._config.idle_orbit === true} @change=${(e: Event) => this.change({ idle_orbit: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.idle_orbit")}</label
      >
      <label class="check"
        ><input type="checkbox" .checked=${this._config.clock === true} @change=${(e: Event) => this.change({ clock: (e.target as HTMLInputElement).checked || undefined })} />
        ${this.t("cardeditor.clock")}</label
      >
      <p class="hint">${this.t("cardeditor.more")}</p>
    `;
  }

  static override styles = css`
    fieldset.values {
      border: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0 16px;
    }
    fieldset.values legend {
      padding: 0;
      margin-bottom: 4px;
    }
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    [hidden] {
      display: none !important;
    }
    .three-d {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    label.check {
      flex-direction: row;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--primary-text-color);
    }
    select,
    input[type="number"] {
      font: inherit;
      font-size: 14px;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, #444);
      background: var(--card-background-color, transparent);
      color: var(--primary-text-color);
    }
    .row {
      display: flex;
      gap: 12px;
    }
    .row > label {
      flex: 1;
    }
    .preview {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      background: var(--secondary-background-color, #1c1c1c);
    }
    canvas {
      display: block;
      width: 100%;
      height: 260px;
      cursor: grab;
      touch-action: none;
    }
    .readout {
      position: absolute;
      left: 8px;
      top: 8px;
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.45);
      color: #fff;
    }
    .hint {
      margin: 0;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .error {
      color: var(--error-color, #db4437);
    }
  `;
}
