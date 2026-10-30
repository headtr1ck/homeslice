"""Homeslice: your house as an interactive, exploded 3D view."""

from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import panel_custom
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, ServiceCall, callback
from homeassistant.helpers import area_registry as ar, entity_registry as er, floor_registry as fr
from homeassistant.helpers.debounce import Debouncer

from .const import DOMAIN, FRONTEND_FILE, FRONTEND_URL
from .repairs import async_check_house
from .store import HomesliceStore
from .underlay import Underlays
from .websocket import async_register_websocket

_LOGGER = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the houses, serve the frontend and register the API."""
    data = hass.data.setdefault(DOMAIN, {})

    store = HomesliceStore(hass)
    await store.async_load()
    data["store"] = store
    data["underlays"] = Underlays(hass)
    # Phase 1 kept houses as YAML files; import them on first start.
    if not store.houses:
        imported = await store.async_import_files()
        if imported:
            _LOGGER.info("Imported house files: %s", ", ".join(imported))

    # Static paths, extra JS and websocket commands can't be unregistered: once per run.
    if not data.get("registered"):
        bundle = FRONTEND_DIR / FRONTEND_FILE
        version = await hass.async_add_executor_job(_bundle_version, bundle)
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL, str(FRONTEND_DIR), cache_headers=False)]
        )
        add_extra_js_url(hass, f"{FRONTEND_URL}/{FRONTEND_FILE}?v={version}")
        # the editor: a sidebar page for admins
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=DOMAIN,
            webcomponent_name="homeslice-panel",
            sidebar_title="Homeslice",
            sidebar_icon="mdi:home-floor-3",
            module_url=f"{FRONTEND_URL}/{FRONTEND_FILE}?v={version}",
            require_admin=True,
        )
        async_register_websocket(hass)

        async def import_files(call: ServiceCall) -> None:
            await hass.data[DOMAIN]["store"].async_import_files(force=call.data.get("force", False))

        hass.services.async_register(
            DOMAIN, "import_files", import_files, schema=vol.Schema({vol.Optional("force", default=False): bool})
        )
        data["registered"] = True

    # Repairs: check every house now, after each change, and when registries change.
    @callback
    def check_all() -> None:
        for house_id in list(store.houses):
            async_check_house(hass, house_id, store.get(house_id))

    debouncer = Debouncer(hass, _LOGGER, cooldown=2, immediate=False, function=check_all)

    @callback
    def registry_changed(event: Event) -> None:
        hass.async_create_task(debouncer.async_call())

    check_all()
    entry.async_on_unload(store.async_listen(lambda house_id, model: async_check_house(hass, house_id, model)))
    for event_type in (
        ar.EVENT_AREA_REGISTRY_UPDATED,
        fr.EVENT_FLOOR_REGISTRY_UPDATED,
        er.EVENT_ENTITY_REGISTRY_UPDATED,
    ):
        entry.async_on_unload(hass.bus.async_listen(event_type, registry_changed))
    entry.async_on_unload(debouncer.async_shutdown)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """The frontend and API stay registered until restart."""
    return True


def _bundle_version(bundle: Path) -> str:
    """Cache-busting token: the bundle's modification time."""
    try:
        return str(int(bundle.stat().st_mtime))
    except OSError:
        _LOGGER.error("Frontend bundle %s is missing; build the frontend first", bundle)
        return "missing"
