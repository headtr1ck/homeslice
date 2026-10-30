"""Websocket API used by the card (and later the editor)."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DEFAULT_HOUSE, DOMAIN
from .store import HomesliceStore, ModelError


def _store(hass: HomeAssistant) -> HomesliceStore:
    return hass.data[DOMAIN]["store"]


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the websocket commands."""
    for command in (ws_list, ws_get_model, ws_subscribe, ws_save, ws_delete, ws_import_files):
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
    """Delete a house (admins only)."""
    await _store(hass).async_delete(msg["house"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "homeslice/import_files", vol.Optional("force", default=False): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_files(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Import <config>/homeslice/*.yaml into storage (admins only)."""
    connection.send_result(msg["id"], {"imported": await _store(hass).async_import_files(force=msg["force"])})
