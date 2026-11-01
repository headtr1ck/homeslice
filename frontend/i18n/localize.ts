// Every user-visible string goes through localize(). A new language is one more JSON
// file with the same keys (i18n.test.ts checks keys and placeholders).

import de from "./de.json";
import en from "./en.json";

export type StringKey = keyof typeof en;

type Table = Partial<Record<StringKey, string>>;

// English and German come with the bundle; the other languages load the first time a
// card or the editor needs them (wall tablets shouldn't download every language).
const LANGUAGES: Record<string, Table> = { en, de };
const MORE = import.meta.glob<Table>(["./*.json", "!./en.json", "!./de.json"], { import: "default" });
const pending = new Map<string, Promise<void>>();

const code = (language: string | undefined) =>
  [language ?? "en", (language ?? "").split("-")[0]].find((c) => LANGUAGES[c] || MORE[`./${c}.json`]);

/** Loads a language's texts; true when it wasn't there yet (the caller redraws). */
export async function loadLanguage(language: string | undefined): Promise<boolean> {
  const c = code(language);
  if (!c || LANGUAGES[c]) return false;
  if (!pending.has(c)) pending.set(c, MORE[`./${c}.json`]().then((t) => void (LANGUAGES[c] = t)));
  await pending.get(c);
  return true;
}

/** The texts of a language as far as loaded (English until then). */
export function texts(language: string | undefined): Table {
  const c = code(language);
  return (c && LANGUAGES[c]) || en;
}

export function localize(language: string | undefined, key: StringKey, vars: Record<string, string | number> = {}): string {
  const text = texts(language)[key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** HA's number format setting, as in `hass.locale`. */
export interface NumberLocale {
  language?: string;
  number_format?: string;
}

const NUMBER_FORMATS: Record<string, string | undefined> = { comma_decimal: "en-US", decimal_comma: "de-DE", space_comma: "fr-FR", system: undefined };

/**
 * A number with `digits` decimals, written like the user's HA settings say (a decimal
 * comma in German), without thousands separators.
 */
export function formatNumber(locale: NumberLocale | undefined, value: number, digits: number): string {
  const format = locale?.number_format ?? "language";
  if (format === "none" || !Number.isFinite(value)) return value.toFixed(digits);
  const tag = format === "language" ? locale?.language : NUMBER_FORMATS[format];
  try {
    return new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(value);
  } catch {
    return value.toFixed(digits);
  }
}
