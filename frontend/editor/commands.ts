// The editor's command search (Ctrl+K): every tool, setting, floor and room by name or by
// what one would call it ("balcony", "fence", "curved wall"), in any of the languages.

import { normal, similarity } from "./start";

export interface Command {
  id: string;
  label: string;
  /** Where it is or what it does, shown under the label. */
  hint?: string;
  /** Its shortcut. */
  key?: string;
  /** More words it is found by (synonyms, English and the editor's language). */
  words?: string;
  run: () => void;
}

/**
 * The commands matching `query`, best first: every word of the query found at the start of
 * a word of the label or its words (the label counts more), else names close enough to the
 * query to be a typo of it. An empty query gives them all, in order.
 */
export function searchCommands(commands: Command[], query: string, max = 8): Command[] {
  const q = normal(query).split(" ").filter(Boolean);
  if (!q.length) return commands.slice(0, max);
  const scored = commands
    .map((c, i) => {
      const label = normal(c.label).split(" ");
      const words = normal(`${c.label} ${c.words ?? ""} ${c.hint ?? ""}`).split(" ");
      let score = 0;
      for (const t of q) {
        if (label.some((w) => w.startsWith(t))) score += 3;
        else if (words.some((w) => w.startsWith(t))) score += 2;
        else if (words.some((w) => w.includes(t) && t.length > 2)) score += 1;
        else {
          // a typo: the closest word
          const near = Math.max(0, ...words.map((w) => similarity(w, t)));
          if (near < 0.55) return { c, i, score: -1 };
          score += near;
        }
      }
      return { c, i, score };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, max).map((x) => x.c);
}
