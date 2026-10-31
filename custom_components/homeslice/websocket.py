"""Websocket API used by the card (and later the editor)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .assets import AssetError, Assets
from .const import DEFAULT_HOUSE, DOMAIN
from .store import HomesliceStore, ModelError
from .underlay import UnderlayError, Underlays


def _store(hass: HomeAssistant) -> HomesliceStore:
    return hass.data[DOMAIN]["store"]


def _underlays(hass: HomeAssistant) -> Underlays:
    return hass.data[DOMAIN]["underlays"]


def _assets(hass: HomeAssistant) -> Assets:
    return hass.data[DOMAIN]["assets"]


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the websocket commands."""
    for command in (ws_list, ws_get_model, ws_subscribe, ws_save, ws_delete, ws_import_files, ws_underlay_get, ws_underlay_set, ws_underlay_delete, ws_polyhaven_catalog, ws_polyhaven_fetch, ws_custom_list, ws_custom_upload, ws_custom_delete):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): "homeslice/houses"})
@callback
def ws_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """List the stored houses."""
    connection.send_result(msg["id"], _store(hass).summary())


@websocket_api.websocket_command(
    {vol.Required("type"): "homeslice/model", vol.Optional("house", default=DEFAULT_HOUSE): str}
)
@callback
def ws_get_model(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Return a house's model; the frontend expands and validates it."""
    model = _store(hass).get(msg["house"])
    if model is None:
        connection.send_error(msg["id"], "not_found", f"No house {msg['house']!r}")
        return
    connection.send_result(msg["id"], model)


@websocket_api.websocket_command(
    {vol.Required("type"): "homeslice/subscribe", vol.Optional("house", default=DEFAULT_HOUSE): str}
)
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Send the model now and again whenever it changes."""
    house_id = msg["house"]
    store = _store(hass)

    @callback
    def changed(changed_id: str, model: dict[str, Any] | None) -> None:
        if changed_id == house_id:
            connection.send_message(websocket_api.event_message(msg["id"], {"model": model}))

    connection.subscriptions[msg["id"]] = store.async_listen(changed)
    connection.send_result(msg["id"])
    connection.send_message(websocket_api.event_message(msg["id"], {"model": store.get(house_id)}))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homeslice/model/save",
        vol.Required("house"): str,
        vol.Required("model"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Store a house model (admins only)."""
    try:
        await _store(hass).async_save(msg["house"], msg["model"], "api")
    except ModelError as err:
        connection.send_error(msg["id"], "invalid_model", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "homeslice/model/delete", vol.Required("house"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Delete a house and its floor plan images (admins only)."""
    await _store(hass).async_delete(msg["house"])
    await _underlays(hass).async_delete(msg["house"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "homeslice/import_files", vol.Optional("force", default=False): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_files(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Import <config>/homeslice/*.yaml into storage (admins only)."""
    connection.send_result(msg["id"], {"imported": await _store(hass).async_import_files(force=msg["force"])})


PLACE = vol.Schema(
    {
        # plan position (metres) of the image's top-left corner, metres per pixel, degrees
        vol.Required("origin"): vol.All([vol.Coerce(float)], vol.Length(min=2, max=2)),
        vol.Required("scale"): vol.All(vol.Coerce(float), vol.Range(min=1e-5, max=10)),
        vol.Optional("rotation", default=0): vol.Coerce(float),
    }
)


@websocket_api.websocket_command(
    {vol.Required("type"): "homeslice/underlay/get", vol.Required("house"): str, vol.Optional("level"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_underlay_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A level's floor plan image and placement; without a level, the levels that have one."""
    if "level" not in msg:
        connection.send_result(msg["id"], {"levels": await _underlays(hass).async_list(msg["house"])})
        return
    connection.send_result(msg["id"], await _underlays(hass).async_get(msg["house"], msg["level"]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homeslice/underlay/set",
        vol.Required("house"): str,
        vol.Required("level"): str,
        vol.Optional("image"): str,
        vol.Optional("place"): PLACE,
        vol.Optional("opacity"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_underlay_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Store a level's floor plan image and/or its placement (admins only)."""
    patch = {k: msg[k] for k in ("image", "place", "opacity") if k in msg}
    try:
        stored = await _underlays(hass).async_set(msg["house"], msg["level"], patch)
    except UnderlayError as err:
        connection.send_error(msg["id"], "invalid_underlay", str(err))
        return
    connection.send_result(msg["id"], {k: v for k, v in stored.items() if k != "image"})


@websocket_api.websocket_command(
    {vol.Required("type"): "homeslice/underlay/delete", vol.Required("house"): str, vol.Required("level"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_underlay_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Remove a level's floor plan image (admins only)."""
    await _underlays(hass).async_delete(msg["house"], msg["level"])
    connection.send_result(msg["id"])


# ----- models from Poly Haven and uploaded ones -----


@websocket_api.websocket_command({vol.Required("type"): "homeslice/assets/polyhaven"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_polyhaven_catalog(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Poly Haven's models for homes (admins only: the editor's library)."""
    try:
        connection.send_result(msg["id"], await _assets(hass).async_catalog())
    except (AssetError, OSError, TimeoutError) as err:
        connection.send_error(msg["id"], "unavailable", f"Poly Haven is not reachable: {err}")


@websocket_api.websocket_command({vol.Required("type"): "homeslice/assets/polyhaven/fetch", vol.Required("asset"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_polyhaven_fetch(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Downloads a Poly Haven model into Home Assistant (once) and returns its URL."""
    try:
        connection.send_result(msg["id"], {"url": await _assets(hass).async_polyhaven(msg["asset"])})
    except AssetError as err:
        connection.send_error(msg["id"], "unavailable", str(err))


@websocket_api.websocket_command({vol.Required("type"): "homeslice/assets/custom"})
@websocket_api.async_response
async def ws_custom_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The uploaded models."""
    connection.send_result(msg["id"], await _assets(hass).async_custom_list())


@websocket_api.websocket_command(
    {vol.Required("type"): "homeslice/assets/custom/upload", vol.Required("name"): str, vol.Required("data"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_custom_upload(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Stores an uploaded .glb (admins only)."""
    try:
        connection.send_result(msg["id"], await _assets(hass).async_custom_upload(msg["name"], msg["data"]))
    except AssetError as err:
        connection.send_error(msg["id"], "invalid_model", str(err))


@websocket_api.websocket_command({vol.Required("type"): "homeslice/assets/custom/delete", vol.Required("asset"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_custom_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Removes an uploaded model (admins only)."""
    try:
        await _assets(hass).async_custom_delete(msg["asset"])
    except AssetError as err:
        connection.send_error(msg["id"], "invalid_id", str(err))
        return
    connection.send_result(msg["id"])
