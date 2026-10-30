"""Websocket API used by the card."""

from __future__ import annotations

import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util.yaml import load_yaml

from .const import DEFAULT_HOUSE, MODEL_DIR

HOUSE_ID = re.compile(r"^[a-z0-9_]+$")


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the websocket commands."""
    websocket_api.async_register_command(hass, ws_get_model)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "homeslice/model",
        vol.Optional("house", default=DEFAULT_HOUSE): str,
    }
)
@websocket_api.async_response
async def ws_get_model(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the raw house model; the frontend expands and validates it."""
    house = msg["house"]
    if not HOUSE_ID.match(house):
        connection.send_error(msg["id"], "invalid_house", f"Invalid house id {house!r}")
        return
    path = hass.config.path(MODEL_DIR, f"{house}.yaml")
    try:
        model = await hass.async_add_executor_job(load_yaml, path)
    except FileNotFoundError:
        connection.send_error(msg["id"], "not_found", f"No house file at {path}")
        return
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "invalid_yaml", str(err))
        return
    connection.send_result(msg["id"], model)
