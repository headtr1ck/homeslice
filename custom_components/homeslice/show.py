"""The homeslice.show action: which area, floor or entity open cards should fly to.

Assist passes what people said ("the living room"), so names and aliases count as much as
ids; nothing found is an error the speaker hears.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import area_registry as ar, floor_registry as fr

from .const import DOMAIN


def _norm(text: str) -> str:
    text = text.strip().lower()
    for article in ("the ", "die ", "der ", "das ", "den ", "le ", "la ", "les ", "el ", "de ", "het "):
        if text.startswith(article):
            text = text[len(article):]
    return text


def resolve_show(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """The event's data: area_id, floor_id or entity_id (and seconds), from ids or names."""
    out: dict[str, Any] = {}
    if area := data.get("area"):
        areas = ar.async_get(hass)
        found = areas.async_get_area(area) or next(
            (a for a in areas.async_list_areas() if _norm(area) in {_norm(a.name), *(_norm(x) for x in a.aliases)}), None
        )
        if not found:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="unknown_area", translation_placeholders={"area": area})
        out["area_id"] = found.id
    if floor := data.get("floor"):
        floors = fr.async_get(hass)
        found_floor = floors.async_get_floor(floor) or next(
            (f for f in floors.async_list_floors() if _norm(floor) in {_norm(f.name), *(_norm(x) for x in f.aliases)}), None
        )
        if not found_floor:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="unknown_floor", translation_placeholders={"floor": floor})
        out["floor_id"] = found_floor.floor_id
    if entity := data.get("entity_id"):
        out["entity_id"] = entity
    if not out:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="show_nothing")
    if "seconds" in data:
        out["seconds"] = data["seconds"]
    return out
