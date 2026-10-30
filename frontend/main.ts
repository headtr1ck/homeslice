// The card bundle: loaded on every dashboard page, so it holds only the card and its
// small visual editor. The sidebar editor is a bundle of its own (editor-main.ts).
import { HomesliceCard } from "./card/homeslice-card";
import { HomesliceCardEditor } from "./card/homeslice-card-editor";
import { localize } from "./i18n/localize";

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean }[];
  }
}

if (!customElements.get("homeslice-card")) {
  customElements.define("homeslice-card", HomesliceCard);
  const language = document.documentElement.lang || navigator.language;
  (window.customCards ??= []).push({
    type: "homeslice-card",
    name: localize(language, "card.name"),
    description: localize(language, "card.description"),
    preview: true,
  });
}


if (!customElements.get("homeslice-card-editor")) customElements.define("homeslice-card-editor", HomesliceCardEditor);
