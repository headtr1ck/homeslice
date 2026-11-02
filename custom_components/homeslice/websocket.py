"""Websocket API used by the card (and later the editor)."""

from __future__ import annotations

import base64
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback

from .assets import AssetError, Assets
from .sketchfab import Sketchfab
from .start import Start, StartError
from .backup import BackupError, async_backup, async_restore
from .const import DEFAULT_HOUSE, DOMAIN, SHOW_EVENT
from .store import HomesliceStore, ModelError
from .underlay import UnderlayError, Underlays


def _store(hass: HomeAssistant) -> HomesliceStore:
    return hass.data[DOMAIN]["store"]


def _underlays(hass: HomeAssistant) -> Underlays:
    return hass.data[DOMAIN]["underlays"]


def _assets(hass: HomeAssistant) -> Assets:
    return hass.data[DOMAIN]["assets"]


def _sketchfab(hass: HomeAssistant) -> Sketchfab:
    return hass.data[DOMAIN]["sketchfab"]


def _start(hass: HomeAssistant) -> Start:
    return hass.data[DOMAIN]["start"]


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the websocket commands."""
    for command in (ws_list, ws_get_model, ws_subscribe, ws_save, ws_delete, ws_import_files, ws_underlay_get, ws_underlay_set, ws_underlay_delete, ws_polyhaven_catalog, ws_polyhaven_fetch, ws_texture_catalog, ws_texture_fetch, ws_custom_list, ws_custom_upload, ws_custom_delete, ws_sketchfab_status, ws_sketchfab_token, ws_sketchfab_search, ws_sketchfab_fetch, ws_start_get, ws_start_set, ws_start_clear, ws_start_watch, ws_start_stop, ws_start_capture, ws_guide, ws_validate, ws_restore, ws_show_subscribe, ws_backup, ws_backup_restore):
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


@websocket_api.websocket_command({vol.Required("type"): "homeslice/backup"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_backup(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Everything in one zip, as a data URL (admins only)."""
    blob = await async_backup(hass)
    connection.send_result(msg["id"], {"name": "homeslice-backup.zip", "data": "data:application/zip;base64," + base64.b64encode(blob).decode()})


@websocket_api.websocket_command({vol.Required("type"): "homeslice/backup/restore", vol.Required("data"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_backup_restore(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Restore a backup zip (data URL; admins only)."""
    data = msg["data"]
    try:
        blob = base64.b64decode(data.split(",", 1)[1] if data.startswith("data:") else data, validate=False)
        result = await async_restore(hass, blob)
    except (BackupError, ValueError) as err:
        connection.send_error(msg["id"], "invalid_backup", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): "homeslice/show/subscribe"})
@callback
def ws_show_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Pass on the homeslice.show action (from Assist, automations): cards fly there."""

    @callback
    def shown(event: Event) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], dict(event.data)))

    connection.subscriptions[msg["id"]] = hass.bus.async_listen(SHOW_EVENT, shown)
    connection.send_result(msg["id"])


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
        # the line the scale was set on (image pixels), kept as a ruler
        vol.Optional("ruler"): {
            vol.Required("a"): vol.All([vol.Coerce(float)], vol.Length(min=2, max=2)),
            vol.Required("b"): vol.All([vol.Coerce(float)], vol.Length(min=2, max=2)),
        },
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
        # the robot's map picture it came from (rooms can be read off it later)
        vol.Optional("source"): vol.Any(None, vol.Match(r"^image\.[a-z0-9_]+$")),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_underlay_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Store a level's floor plan image and/or its placement (admins only)."""
    patch = {k: msg[k] for k in ("image", "place", "opacity", "source") if k in msg}
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


@websocket_api.websocket_command({vol.Required("type"): "homeslice/assets/textures"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_texture_catalog(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Poly Haven's textures for floors and walls (admins only: the editor's finish picker)."""
    try:
        connection.send_result(msg["id"], await _assets(hass).async_texture_catalog())
    except (AssetError, OSError, TimeoutError) as err:
        connection.send_error(msg["id"], "unavailable", f"Poly Haven is not reachable: {err}")


@websocket_api.websocket_command({vol.Required("type"): "homeslice/assets/textures/fetch", vol.Required("asset"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_texture_fetch(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Downloads a Poly Haven texture into Home Assistant (once): its URL and size in metres."""
    try:
        connection.send_result(msg["id"], await _assets(hass).async_texture(msg["asset"]))
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


# ----- the start screen (admins only): its choices, and robot maps caught live -----


@websocket_api.websocket_command({vol.Required("type"): "homeslice/start"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_start_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The start screen as it was left, the maps caught, the watches running."""
    connection.send_result(msg["id"], await _start(hass).async_get())


@websocket_api.websocket_command({vol.Required("type"): "homeslice/start/set", vol.Required("state"): vol.Any(dict, None)})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_start_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        await _start(hass).async_set_state(msg["state"])
    except StartError as err:
        connection.send_error(msg["id"], "too_large", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "homeslice/start/clear"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_start_clear(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    await _start(hass).async_clear()
    connection.send_result(msg["id"])


FLOOR = vol.All(str, vol.Length(min=1, max=100))
MAP = vol.Match(r"^image\.[a-z0-9_]+$")


@websocket_api.websocket_command({vol.Required("type"): "homeslice/start/watch", vol.Required("floor"): FLOOR, vol.Required("map"): MAP})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_start_watch(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Keeps every new picture of a robot's map for a floor, until the robot is home."""
    try:
        connection.send_result(msg["id"], await _start(hass).async_watch(msg["floor"], msg["map"]))
    except StartError as err:
        connection.send_error(msg["id"], "invalid_map", str(err))


@websocket_api.websocket_command({vol.Required("type"): "homeslice/start/stop", vol.Required("floor"): FLOOR, vol.Optional("drop", default=False): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_start_stop(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    await _start(hass).async_stop(msg["floor"], msg["drop"])
    connection.send_result(msg["id"], await _start(hass).async_get())


@websocket_api.websocket_command({vol.Required("type"): "homeslice/start/capture", vol.Required("floor"): FLOOR, vol.Required("map"): MAP})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_start_capture(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Keeps a robot's map picture as it is now, for a floor."""
    try:
        connection.send_result(msg["id"], await _start(hass).async_capture(msg["floor"], msg["map"]))
    except StartError as err:
        connection.send_error(msg["id"], "no_map", str(err))


# ----- Sketchfab, with the user's own token (admins only; the token never leaves Home Assistant) -----


@websocket_api.websocket_command({vol.Required("type"): "homeslice/sketchfab"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sketchfab_status(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Whether a Sketchfab token is set, and whose."""
    connection.send_result(msg["id"], await _sketchfab(hass).async_status())


@websocket_api.websocket_command({vol.Required("type"): "homeslice/sketchfab/token", vol.Required("token"): vol.Any(None, str)})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sketchfab_token(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Checks and keeps a Sketchfab API token (null forgets it)."""
    try:
        connection.send_result(msg["id"], await _sketchfab(hass).async_set_token(msg["token"]))
    except AssetError as err:
        connection.send_error(msg["id"], "invalid_token", str(err))


@websocket_api.websocket_command({vol.Required("type"): "homeslice/sketchfab/search", vol.Required("query"): str, vol.Optional("cursor"): vol.Any(None, str)})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sketchfab_search(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Models this account may download."""
    try:
        connection.send_result(msg["id"], await _sketchfab(hass).async_search(msg["query"], msg.get("cursor")))
    except AssetError as err:
        connection.send_error(msg["id"], "unavailable", str(err))


@websocket_api.websocket_command({vol.Required("type"): "homeslice/sketchfab/fetch", vol.Required("uid"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_sketchfab_fetch(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Downloads a model into the house's own models."""
    try:
        connection.send_result(msg["id"], await _sketchfab(hass).async_fetch(msg["uid"]))
    except AssetError as err:
        connection.send_error(msg["id"], "unavailable", str(err))


# ----- for assistants: the guide, validation and restoring the previous version -----


@websocket_api.websocket_command({vol.Required("type"): "homeslice/guide", vol.Optional("house"): str})
@callback
def ws_guide(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The guide for AI assistants, with this Home Assistant's floors, areas and entities."""
    from .llm import guide

    connection.send_result(msg["id"], {"guide": guide(hass, msg.get("house"))})


@websocket_api.websocket_command({vol.Required("type"): "homeslice/validate", vol.Required("model"): vol.Any(dict, str, list, None)})
@callback
def ws_validate(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A house's issues (YAML text or a parsed model), as the integration checks it."""
    from .llm import parse
    from .validate import validate

    try:
        issues = validate(parse(msg["model"]))
    except ModelError as err:
        issues = [{"severity": "error", "path": "", "message": str(err)}]
    connection.send_result(msg["id"], {"valid": not any(i["severity"] == "error" for i in issues), "issues": issues})


@websocket_api.websocket_command({vol.Required("type"): "homeslice/model/restore", vol.Required("house"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_restore(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Back to the version before the last save (a second restore swaps back)."""
    try:
        await _store(hass).async_restore(msg["house"])
    except ModelError as err:
        connection.send_error(msg["id"], "no_previous", str(err))
        return
    connection.send_result(msg["id"])
