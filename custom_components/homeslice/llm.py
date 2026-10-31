"""Homeslice for AI assistants.

One guide (guide.md, plus this Home Assistant's floors, areas and entities and the
catalogue of furniture and kinds) and four tools (get the guide, get a house, validate,
save). They are registered as the LLM API "Homeslice", so a conversation agent in Home
Assistant (OpenAI, Anthropic, Google, Ollama…) can use them, and Home Assistant's MCP
Server offers them to external assistants. The websocket and HTTP API serve the same.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

import yaml

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    floor_registry as fr,
    llm,
)

from .const import DEFAULT_HOUSE, DOMAIN
from .store import HomesliceStore, ModelError
from .validate import catalog, describe, validate

try:  # Home Assistant 2026.9+ validates with probatio
    import probatio as vol
except ImportError:  # pragma: no cover
    import voluptuous as vol  # type: ignore[no-redef]

LLM_API_ID = "homeslice"
LLM_API_NAME = "Homeslice"
API_PROMPT = (
    "You can draw the user's home as a Homeslice 3D house (levels = Home Assistant floors, "
    "rooms = areas, windows with their blinds and contacts). Before writing or changing a "
    "house, call homeslice_get_guide: it explains the format and lists the real floor, area "
    "and entity ids. Validate with homeslice_validate_house, fix every error, then save with "
    "homeslice_save_house; Home Assistant keeps the previous version for a restore."
)

# entities worth linking, with the device classes that matter
LINKABLE = {
    "light": None,
    "cover": None,
    "binary_sensor": {"door", "window", "opening", "garage_door", "motion", "occupancy", "presence", "moisture", "smoke", "gas"},
    "sensor": {"temperature", "power"},
    "vacuum": None,
    "lawn_mower": None,
    "media_player": None,
    "climate": None,
}


def _guide_text() -> str:
    return (Path(__file__).parent / "guide.md").read_text(encoding="utf-8")


def ha_context(hass: HomeAssistant) -> dict[str, Any]:
    """Floors, areas and the entities to link in each area, with their ids."""
    floors = fr.async_get(hass)
    areas = ar.async_get(hass)
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    by_area: dict[str, list[dict[str, Any]]] = {}
    for entry in entities.entities.values():
        domain = entry.domain
        if domain not in LINKABLE or entry.hidden_by or entry.entity_category or entry.disabled_by:
            continue
        area_id = entry.area_id or (devices.async_get(entry.device_id).area_id if entry.device_id and devices.async_get(entry.device_id) else None)
        if not area_id:
            continue
        state = hass.states.get(entry.entity_id)
        device_class = (state.attributes.get("device_class") if state else None) or entry.device_class or entry.original_device_class
        wanted = LINKABLE[domain]
        if wanted is not None and device_class not in wanted:
            continue
        item: dict[str, Any] = {"entity_id": entry.entity_id}
        name = state.attributes.get("friendly_name") if state else None
        if name:
            item["name"] = name
        if device_class:
            item["device_class"] = device_class
        by_area.setdefault(area_id, []).append(item)
    return {
        "floors": [
            {"floor_id": f.floor_id, "name": f.name, **({"level": f.level} if f.level is not None else {})}
            for f in sorted(floors.async_list_floors(), key=lambda f: (f.level is None, f.level or 0))
        ],
        "areas": [
            {
                "area_id": a.id,
                "name": a.name,
                **({"floor_id": a.floor_id} if a.floor_id else {}),
                **({"entities": sorted(by_area[a.id], key=lambda e: e["entity_id"])} if a.id in by_area else {}),
            }
            for a in sorted(areas.async_list_areas(), key=lambda a: a.name)
        ],
    }


def catalog_text() -> str:
    """The catalogue in short: what types, models, kinds and finishes exist."""
    c = catalog()
    lines = [
        "## Catalogue",
        "",
        f"Floors: {', '.join(c['floors'])}.",
        "Opening styles: " + "; ".join(f"{t}: {', '.join(s)}" for t, s in c["opening_styles"].items()) + ".",
        "",
        "Furniture types (default width × depth × height in metres, mount if not the floor):",
    ]
    for t, d in c["furniture_types"].items():
        mount = f", {d['mount']}" if d.get("mount") else ""
        lines.append(f"- {t}: {d['name']}, {d['size'][0]} × {d['size'][1]} × {d['height']}{mount}")
    lines += ["", "Modern models (model: modern:<kind>; type; size; finishes, the first is the default):"]
    for m in c["modern"]:
        mount = f", {m['mount']} at {m.get('elevation', 0)} m" if m.get("mount") else ""
        lines.append(f"- {m['model']} ({m['name']}): type {m['type']}, {m['size'][0]} × {m['size'][1]} × {m['size'][2]}{mount}; {', '.join(m['finishes'])}")
    lines += ["", "Kenney models (model: kenney:<name>): " + ", ".join(k["model"][7:] for k in c["kenney"]) + "."]
    return "\n".join(lines)


def guide(hass: HomeAssistant, house_id: str | None = None) -> str:
    """The whole guide for an assistant: format, this Home Assistant, the catalogue."""
    store: HomesliceStore = hass.data[DOMAIN]["store"]
    houses = store.summary()
    context = ha_context(hass)
    parts = [
        _guide_text(),
        "## Home Assistant context",
        "",
        "Houses: " + (", ".join(f"{h['id']} ({h['name']})" for h in houses) if houses else "none yet (create one, id e.g. home)") + ".",
        "",
        "```yaml",
        to_yaml(context).rstrip(),
        "```",
        "",
        catalog_text(),
    ]
    if house_id and store.get(house_id) is not None:
        parts += ["", f"## Current house `{house_id}`", "", "```yaml", to_yaml(store.get(house_id)).rstrip(), "```"]
    return "\n".join(parts) + "\n"


def to_yaml(model: Any) -> str:
    # houses loaded from files carry Home Assistant's YAML node types: plain data first
    return yaml.safe_dump(json.loads(json.dumps(model)), sort_keys=False, allow_unicode=True, width=120)


def parse(text_or_model: Any) -> Any:
    """A house from YAML or JSON text (or already parsed)."""
    if not isinstance(text_or_model, str):
        return text_or_model
    try:
        return yaml.safe_load(text_or_model)
    except yaml.YAMLError as err:
        raise ModelError(f"Not valid YAML: {err}") from err


async def async_save_text(hass: HomeAssistant, text_or_model: Any, house_id: str | None, source: str) -> dict[str, Any]:
    """Validate and save; the result says what happened (errors are not raised)."""
    try:
        model = parse(text_or_model)
    except ModelError as err:
        return {"saved": False, "errors": str(err)}
    issues = validate(model)
    problems = [i for i in issues if i["severity"] == "error"]
    if problems:
        return {"saved": False, "errors": describe(problems), "hint": "Fix these and save again."}
    target = house_id or (model.get("id") if isinstance(model, dict) else None) or DEFAULT_HOUSE
    try:
        await hass.data[DOMAIN]["store"].async_save(target, model, source)
    except ModelError as err:
        return {"saved": False, "errors": str(err)}
    warnings = [i for i in issues if i["severity"] == "warning"]
    return {
        "saved": True,
        "house": target,
        "note": "Saved; the previous version can be restored in the editor (⚙ → Restore previous version).",
        **({"warnings": describe(warnings)} if warnings else {}),
    }


# ----- the LLM API -----


async def _is_admin(hass: HomeAssistant, llm_context: llm.LLMContext) -> bool:
    user_id = llm_context.context.user_id if llm_context.context else None
    if not user_id:
        return False
    user = await hass.auth.async_get_user(user_id)
    return bool(user and user.is_admin)


class GuideTool(llm.Tool):
    name = "homeslice_get_guide"
    description = "How to write a Homeslice house (YAML format, rules, examples), this Home Assistant's floors, areas and entities with their ids, and the furniture catalogue. Call it before writing or changing a house."
    parameters = vol.Schema({vol.Optional("house", description="A house id to include (default: none)"): str})
    integration = DOMAIN

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput, llm_context: llm.LLMContext) -> dict[str, Any]:
        return {"guide": guide(hass, tool_input.tool_args.get("house"))}


class GetHouseTool(llm.Tool):
    name = "homeslice_get_house"
    description = "A Homeslice house as YAML (default: home), or the list of houses."
    parameters = vol.Schema({vol.Optional("house", description="House id (default: home)"): str})
    integration = DOMAIN

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput, llm_context: llm.LLMContext) -> dict[str, Any]:
        store: HomesliceStore = hass.data[DOMAIN]["store"]
        house_id = tool_input.tool_args.get("house", DEFAULT_HOUSE)
        model = store.get(house_id)
        if model is None:
            return {"houses": store.summary(), "note": f"No house {house_id!r}."}
        return {"house": house_id, "yaml": to_yaml(model)}


class ValidateTool(llm.Tool):
    name = "homeslice_validate_house"
    description = "Check a Homeslice house (YAML) against the format's rules without saving. Returns its errors and warnings with paths and how to fix them."
    parameters = vol.Schema({vol.Required("yaml", description="The whole house as YAML"): str})
    integration = DOMAIN

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput, llm_context: llm.LLMContext) -> dict[str, Any]:
        try:
            issues = validate(parse(tool_input.tool_args["yaml"]))
        except ModelError as err:
            return {"valid": False, "errors": str(err)}
        problems = [i for i in issues if i["severity"] == "error"]
        return {"valid": not problems, **({"issues": describe(issues)} if issues else {})}


class SaveTool(llm.Tool):
    name = "homeslice_save_house"
    description = "Validate and save a Homeslice house (YAML), replacing the stored one; the previous version is kept for a restore. Needs an administrator."
    parameters = vol.Schema(
        {
            vol.Required("yaml", description="The whole house as YAML"): str,
            vol.Optional("house", description="House id (default: the YAML's id, else home)"): str,
        }
    )
    integration = DOMAIN

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput, llm_context: llm.LLMContext) -> dict[str, Any]:
        if not await _is_admin(hass, llm_context):
            return {"saved": False, "errors": "Only an administrator can save a house."}
        return await async_save_text(hass, tool_input.tool_args["yaml"], tool_input.tool_args.get("house"), f"assistant:{llm_context.platform}")


@dataclass(kw_only=True)
class HomesliceAPI(llm.API):
    """The Homeslice tools for conversation agents and MCP clients."""

    def __post_init__(self) -> None:
        self._tools: list[llm.Tool] = [GuideTool(), GetHouseTool(), ValidateTool(), SaveTool()]

    async def async_get_api_instance(self, llm_context: llm.LLMContext) -> llm.APIInstance:
        return llm.APIInstance(api=self, api_prompt=API_PROMPT, llm_context=llm_context, tools=self._tools)


@callback
def async_register_llm_api(hass: HomeAssistant) -> Any:
    """Register the API; returns the callback that unregisters it."""
    return llm.async_register_api(hass, HomesliceAPI(hass=hass, id=LLM_API_ID, name=LLM_API_NAME))

