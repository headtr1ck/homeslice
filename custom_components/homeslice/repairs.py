"""Repairs issues for links to floors, areas and entities that no longer exist."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    entity_registry as er,
    floor_registry as fr,
    issue_registry as ir,
)

from .const import DOMAIN


def references(model: dict[str, Any]) -> Iterator[tuple[str, str, str]]:
    """(kind, id, where) for every HA reference in a model."""
    for level in model.get("levels", []):
        lid = level.get("id", "?")
        if level.get("floor_id"):
            yield "floor", level["floor_id"], f"level {lid}"
        for room in level.get("rooms", []):
            if room.get("area_id"):
                yield "area", room["area_id"], f"room {room.get('id', '?')}"
        for opening in level.get("openings", []):
            for key in ("cover", "contact"):
                if opening.get(key):
                    yield "entity", opening[key], f"opening on {opening.get('room', '?')}"
    for opening in model.get("facade_openings", []):
        for key in ("covers", "contacts"):
            for entity_id in (opening.get(key) or {}).values():
                if entity_id:
                    yield "entity", entity_id, f"façade opening {opening.get('id', '?')}"


def missing(hass: HomeAssistant, model: dict[str, Any]) -> list[tuple[str, str, str]]:
    """References HA doesn't know (entities count as known if they have a state)."""
    floors = fr.async_get(hass)
    areas = ar.async_get(hass)
    entities = er.async_get(hass)
    known = {
        "floor": lambda i: floors.async_get_floor(i) is not None,
        "area": lambda i: areas.async_get_area(i) is not None,
        "entity": lambda i: entities.async_get(i) is not None or hass.states.get(i) is not None,
    }
    seen: set[tuple[str, str]] = set()
    out = []
    for kind, ref, where in references(model):
        if (kind, ref) not in seen and not known[kind](ref):
            seen.add((kind, ref))
            out.append((kind, ref, where))
    return out


def issue_id(house_id: str, kind: str, ref: str) -> str:
    return f"{house_id}_missing_{kind}_{ref}"


@callback
def async_check_house(hass: HomeAssistant, house_id: str, model: dict[str, Any] | None) -> None:
    """Create issues for broken links of one house and remove the fixed ones."""
    registry = ir.async_get(hass)
    wanted = {}
    if model is not None:
        for kind, ref, where in missing(hass, model):
            wanted[issue_id(house_id, kind, ref)] = (kind, ref, where)
    prefix = f"{house_id}_missing_"
    for (domain, existing), _ in list(registry.issues.items()):
        if domain == DOMAIN and existing.startswith(prefix) and existing not in wanted:
            ir.async_delete_issue(hass, DOMAIN, existing)
    for iid, (kind, ref, where) in wanted.items():
        ir.async_create_issue(
            hass,
            DOMAIN,
            iid,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=f"missing_{kind}",
            translation_placeholders={"house": house_id, "ref": ref, "where": where},
        )
