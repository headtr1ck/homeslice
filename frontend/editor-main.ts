// The editor bundle: the admin sidebar page, loaded only there.
import { HomeslicePanel } from "./editor/homeslice-panel";

if (!customElements.get("homeslice-panel")) customElements.define("homeslice-panel", HomeslicePanel);
