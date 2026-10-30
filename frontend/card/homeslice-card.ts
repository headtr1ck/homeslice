import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { expandHouse } from "../model/expand";
import type { House, Issue } from "../model/types";
import { deriveWalls, type Wall } from "../model/walls";
import { HouseRenderer, type ViewOptions } from "../render/scene";
import { localize, type StringKey } from "../i18n/localize";

/** The parts of Home Assistant's `hass` object the card uses. */
interface Hass {
  locale?: { language: string };
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
}

export interface HomesliceCardConfig {
  type: string;
  house?: string;
  view?: Partial<ViewOptions>;
  /** Fixed height in px; by default the card follows the house's shape. */
  height?: number;
}

export class HomesliceCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _issues: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  hass?: Hass;
  private config!: HomesliceCardConfig;
  private _issues: Issue[] = [];
  private _error = "";
  private _loading = true;
  private renderer?: HouseRenderer;
  private resizeObserver?: ResizeObserver;
  private loadedFor?: string;
  private frame = 0;

  setConfig(config: HomesliceCardConfig) {
    this.config = { house: "home", ...config };
    this.loadedFor = undefined;
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  private t(key: StringKey, vars?: Record<string, string | number>) {
    return localize(this.hass?.locale?.language, key, vars);
  }

  protected override updated(changed: PropertyValues) {
    // `hass` changes several times a second; only the first one (or a new house) loads
    if (changed.has("hass") && this.hass && this.loadedFor !== this.config.house) {
      this.loadedFor = this.config.house;
      void this.load();
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
    this.updateComplete.then(() => {
      const wrap = this.renderRoot.querySelector(".wrap");
      if (wrap) this.resizeObserver?.observe(wrap);
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    this.renderer?.dispose();
    this.renderer = undefined;
    this.loadedFor = undefined;
  }

  private async load() {
    this._loading = true;
    this._error = "";
    try {
      const raw = await this.hass!.callWS<unknown>({ type: "homeslice/model", house: this.config.house });
      const { house, issues } = expandHouse(raw);
      const walls = new Map<string, Wall[]>();
      if (house) for (const level of house.levels) walls.set(level.id, deriveWalls(level, house.walls, issues));
      this._issues = issues;
      if (house) await this.show(house, walls);
    } catch (e) {
      this._error = this.t("card.load_failed", { message: (e as { message?: string }).message ?? String(e) });
    } finally {
      this._loading = false;
    }
  }

  private async show(house: House, walls: Map<string, Wall[]>) {
    await this.updateComplete;
    const canvas = this.renderRoot.querySelector("canvas");
    if (!canvas) return;
    if (!this.renderer) {
      try {
        this.renderer = new HouseRenderer(canvas);
      } catch {
        this._error = this.t("card.no_webgl");
        return;
      }
    }
    this.renderer.setModel(house, walls, this.config.view);
    this.scheduleDraw();
  }

  /** Renders at most once per animation frame, and only when asked to. */
  private scheduleDraw() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const wrap = this.renderRoot.querySelector<HTMLElement>(".wrap");
      if (!wrap || !this.renderer) return;
      const width = wrap.clientWidth;
      if (!width) return;
      // follow the house's shape, but never taller than the space left below the card's top
      const available = window.innerHeight - Math.max(0, wrap.getBoundingClientRect().top) - 16;
      const height = this.config.height ?? Math.max(200, Math.min(Math.round(width / this.renderer.aspect), available));
      wrap.style.height = `${height}px`;
      this.renderer.render(width, height);
    });
  }

  protected override render() {
    return html`
      <ha-card>
        <div class="wrap">
          <canvas></canvas>
          ${this._loading ? html`<div class="overlay">${this.t("card.loading")}</div>` : nothing}
          ${this._error ? html`<div class="overlay error">${this._error}</div>` : nothing}
        </div>
        ${this._issues.length
          ? html`<details class="issues">
              <summary>${this.t("card.issues", { count: this._issues.length })}</summary>
              <ul>
                ${this._issues.map(
                  (i) =>
                    html`<li class=${i.severity}>
                      <b>${this.t(i.severity === "error" ? "card.issue_error" : "card.issue_warning")}</b>
                      <code>${i.path}</code> ${i.message}
                    </li>`,
                )}
              </ul>
            </details>`
          : nothing}
      </ha-card>
    `;
  }

  static override styles = css`
    ha-card {
      overflow: hidden;
      background: none;
      box-shadow: none;
      border: none;
    }
    .wrap {
      position: relative;
      width: 100%;
      min-height: 200px;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--secondary-text-color);
    }
    .overlay.error {
      color: var(--error-color);
      padding: 16px;
      text-align: center;
    }
    .issues {
      padding: 8px 16px 12px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .issues li.error b {
      color: var(--error-color);
    }
    .issues li.warning b {
      color: var(--warning-color);
    }
  `;
}
