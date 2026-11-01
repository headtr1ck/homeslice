// Small stand-ins for Home Assistant's own elements, enough for the demo: icons, a card
// frame, and simple tiles (name, state, a toggle) where the room panel shows HA's cards.
const icons = await (await fetch("icons.json")).json();
customElements.define("ha-card", class extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
  }
});
customElements.define("ha-icon", class extends HTMLElement {
  static observedAttributes = ["icon"];
  attributeChangedCallback() {
    const path = icons[(this.getAttribute("icon") || "").replace("mdi:", "")];
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = path ? `<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block;fill:currentColor"><path d="${path}"/></svg>` : "";
    this.style.cssText = "display:inline-block;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)";
  }
});
const TOGGLE = ["light", "switch", "fan", "cover", "media_player", "input_boolean"];
window.loadCardHelpers = async () => ({
  createCardElement(config) {
    const el = document.createElement("div");
    el.className = "demo-tile";
    let hass;
    el.addEventListener("click", () => {
      const domain = (config.entity ?? "").split(".")[0];
      if (hass && TOGGLE.includes(domain)) hass.callService("homeassistant", "toggle", {}, { entity_id: config.entity });
    });
    Object.defineProperty(el, "hass", {
      set(h) {
        hass = h;
        const s = h.states[config.entity];
        const name = s?.attributes.friendly_name ?? config.entity ?? config.type;
        el.innerHTML = `<b></b><span></span>`;
        el.querySelector("b").textContent = name;
        el.querySelector("span").textContent = s ? `${s.state}${s.attributes.unit_of_measurement ? ` ${s.attributes.unit_of_measurement}` : ""}` : "";
        el.classList.toggle("on", s?.state === "on" || s?.state === "open" || s?.state === "playing");
      },
    });
    return el;
  },
});
