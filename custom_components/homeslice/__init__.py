"""Homeslice: your house as an interactive, exploded 3D view."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, FRONTEND_FILE, FRONTEND_URL
from .websocket import async_register_websocket

_LOGGER = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the frontend and register the websocket API."""
    # Static paths and extra JS can't be unregistered, so only do this once per run.
    if not hass.data.get(DOMAIN):
        bundle = FRONTEND_DIR / FRONTEND_FILE
        version = await hass.async_add_executor_job(_bundle_version, bundle)
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL, str(FRONTEND_DIR), cache_headers=False)]
        )
        add_extra_js_url(hass, f"{FRONTEND_URL}/{FRONTEND_FILE}?v={version}")
        async_register_websocket(hass)
        hass.data[DOMAIN] = True
        _LOGGER.debug("Homeslice frontend %s registered", version)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Nothing to tear down; the frontend stays registered until restart."""
    return True


def _bundle_version(bundle: Path) -> str:
    """Cache-busting token: the bundle's modification time."""
    try:
        return str(int(bundle.stat().st_mtime))
    except OSError:
        _LOGGER.error("Frontend bundle %s is missing; build the frontend first", bundle)
        return "missing"
