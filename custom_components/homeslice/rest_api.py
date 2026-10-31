"""HTTP API for assistants without websockets or MCP (curl with a long-lived token).

GET  /api/homeslice/guide[?house=home]   the guide with this Home Assistant's context
POST /api/homeslice/validate             body: a house as YAML or JSON → its issues
GET  /api/homeslice/houses/<id>          the house as YAML
PUT  /api/homeslice/houses/<id>          body: YAML or JSON; validated, saved (admins)
POST /api/homeslice/houses/<id>/restore  back to the version before the last save (admins)
"""

from __future__ import annotations

from http import HTTPStatus

from aiohttp import web

from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .llm import async_save_text, guide, parse, to_yaml
from .store import ModelError
from .validate import validate


class GuideView(HomeAssistantView):
    url = "/api/homeslice/guide"
    name = "api:homeslice:guide"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        return web.Response(text=guide(hass, request.query.get("house")), content_type="text/markdown")


class ValidateView(HomeAssistantView):
    url = "/api/homeslice/validate"
    name = "api:homeslice:validate"

    async def post(self, request: web.Request) -> web.Response:
        try:
            issues = validate(parse(await request.text()))
        except ModelError as err:
            return self.json({"valid": False, "issues": [{"severity": "error", "path": "", "message": str(err)}]})
        return self.json({"valid": not any(i["severity"] == "error" for i in issues), "issues": issues})


class HouseView(HomeAssistantView):
    url = "/api/homeslice/houses/{house_id}"
    name = "api:homeslice:house"

    async def get(self, request: web.Request, house_id: str) -> web.Response:
        model = request.app[KEY_HASS].data[DOMAIN]["store"].get(house_id)
        if model is None:
            return self.json_message(f"No house {house_id!r}", HTTPStatus.NOT_FOUND)
        return web.Response(text=to_yaml(model), content_type="text/yaml")

    async def put(self, request: web.Request, house_id: str) -> web.Response:
        if not request["hass_user"].is_admin:
            return self.json_message("Only an administrator can save a house", HTTPStatus.FORBIDDEN)
        result = await async_save_text(request.app[KEY_HASS], await request.text(), house_id, "assistant:http")
        return self.json(result, HTTPStatus.OK if result["saved"] else HTTPStatus.BAD_REQUEST)


class RestoreView(HomeAssistantView):
    url = "/api/homeslice/houses/{house_id}/restore"
    name = "api:homeslice:restore"

    async def post(self, request: web.Request, house_id: str) -> web.Response:
        if not request["hass_user"].is_admin:
            return self.json_message("Only an administrator can restore a house", HTTPStatus.FORBIDDEN)
        try:
            await request.app[KEY_HASS].data[DOMAIN]["store"].async_restore(house_id)
        except ModelError as err:
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)
        return self.json({"restored": house_id})


def async_register_views(hass: HomeAssistant) -> None:
    for view in (GuideView, ValidateView, HouseView, RestoreView):
        hass.http.register_view(view())
