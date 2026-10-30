import { HomesliceCard } from "./card/homeslice-card";
import { HomesliceCardEditor } from "./card/homeslice-card-editor";
import { HomeslicePanel } from "./editor/homeslice-panel";
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

if (!customElements.get("homeslice-panel")) customElements.define("homeslice-panel", HomeslicePanel);

if (!customElements.get("homeslice-card-editor")) customElements.define("homeslice-card-editor", HomesliceCardEditor);
