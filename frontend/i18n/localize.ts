// Every user-visible string goes through localize(). A new language is one more JSON
// file with the same keys (i18n.test.ts checks keys and placeholders).

import de from "./de.json";
import en from "./en.json";

export type StringKey = keyof typeof en;

const LANGUAGES: Record<string, Partial<Record<StringKey, string>>> = { en, de };

export function localize(language: string | undefined, key: StringKey, vars: Record<string, string | number> = {}): string {
  const table = LANGUAGES[language ?? "en"] ?? LANGUAGES[(language ?? "").split("-")[0]] ?? en;
  const text = table[key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
