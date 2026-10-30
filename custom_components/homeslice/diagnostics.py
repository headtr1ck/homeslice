"""Diagnostics: the stored house models and their broken links."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .repairs import missing


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    """Return everything needed to reproduce a rendering problem."""
    store = hass.data[DOMAIN]["store"]
    return {
        "houses": store.summary(),
        "models": {house["id"]: store.get(house["id"]) for house in store.summary()},
        "broken_links": {
            house["id"]: [{"kind": k, "ref": r, "where": w} for k, r, w in missing(hass, store.get(house["id"]))]
            for house in store.summary()
        },
    }
