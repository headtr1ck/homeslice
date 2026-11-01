// State rules: the card's `rules` give any entity a look by its state, without code: a
// pulsing ring where it is, its piece tinted, an icon and a text (a template).
import { formatNumber } from "../i18n/localize";
import type { Hass } from "./hass";

export interface StateRule {
  entity: string;
  /** Matches this state (or one of these); with neither `above` nor `below`, any state but unavailable. */
  state?: string | string[];
  /** Matches when the number (the state, or `attribute`) is above / below. */
  above?: number;
  below?: number;
  /** Read this attribute instead of the state. */
  attribute?: string;
  /** A pulsing ring where the entity is: a colour, or true for the accent colour. */
  ring?: string | boolean;
  /** Tints the linked piece. */
  color?: string;
  /** An icon at the entity. */
  icon?: string;
  /**
   * A label at the entity: `{state}`, `{state:1}` (one decimal), `{unit}`, `{name}`,
   * `{attr:brightness}`.
   */
  text?: string;
}

/** The rule's value: its attribute or its state. */
function valueOf(hass: Hass, rule: StateRule): unknown {
  const s = hass.states[rule.entity];
  if (!s) return undefined;
  return rule.attribute ? s.attributes[rule.attribute] : s.state;
}

export function ruleMatches(hass: Hass, rule: StateRule): boolean {
  const s = hass.states[rule.entity];
  if (!s || s.state === "unavailable") return false;
  const v = valueOf(hass, rule);
  if (rule.state !== undefined) {
    const wanted = Array.isArray(rule.state) ? rule.state : [rule.state];
    if (!wanted.map(String).includes(String(v))) return false;
  }
  if (rule.above !== undefined || rule.below !== undefined) {
    const n = Number(v);
    if (!Number.isFinite(n)) return false;
    if (rule.above !== undefined && !(n > rule.above)) return false;
    if (rule.below !== undefined && !(n < rule.below)) return false;
  }
  return true;
}

/** The rule's text with its placeholders filled in. */
export function ruleText(hass: Hass, rule: StateRule): string {
  if (!rule.text) return "";
  const s = hass.states[rule.entity];
  if (!s) return "";
  const number = (v: unknown, digits?: string) => {
    const n = Number(v);
    if (digits === undefined || v === null || v === "" || !Number.isFinite(n)) return String(v ?? "");
    return formatNumber(hass.locale, n, Number(digits));
  };
  return rule.text.replace(/\{(state|unit|name|attr:[\w.]+)(?::(\d))?\}/g, (_, key: string, digits?: string) => {
    if (key === "state") return number(s.state, digits);
    if (key === "unit") return String(s.attributes.unit_of_measurement ?? "");
    if (key === "name") return String(s.attributes.friendly_name ?? rule.entity);
    return number(s.attributes[key.slice(5)], digits);
  });
}
