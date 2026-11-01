"""Integration tests: storage, websocket API, file import and repairs."""

from __future__ import annotations

import base64
from datetime import timedelta
from pathlib import Path
import struct
from typing import Any

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, issue_registry as ir
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

DOMAIN = "homeslice"

HOUSE_YAML = """
schema: 1
id: home
outline: { rect: [0, 0, 8, 10] }
levels:
  - id: ground
    rooms:
      - { id: living, area_id: living_room, rect: [0, 0, 8, 10] }
"""


def model(area: str = "living_room", cover: str | None = None) -> dict[str, Any]:
    openings = [{"room": "living", "side": "south", "at": 1, "width": 2, "cover": cover}] if cover else []
    return {
        "schema": 1,
        "id": "home",
        "outline": {"rect": [0, 0, 8, 10]},
        "levels": [{"id": "ground", "rooms": [{"id": "living", "area_id": area, "rect": [0, 0, 8, 10]}], "openings": openings}],
    }


@pytest.fixture
async def setup(hass: HomeAssistant, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Set up Homeslice with a house-file folder holding one house."""
    # an absolute MODEL_DIR makes hass.config.path() return it unchanged
    monkeypatch.setattr("custom_components.homeslice.store.MODEL_DIR", str(tmp_path / "homeslice"))
    monkeypatch.setattr("custom_components.homeslice.assets.MODEL_DIR", str(tmp_path / "homeslice"))
    (tmp_path / "homeslice").mkdir()
    (tmp_path / "homeslice" / "home.yaml").write_text(HOUSE_YAML)
    ar.async_get(hass).async_create("Living Room")
    entry = MockConfigEntry(domain=DOMAIN, title="Homeslice")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_imports_house_files_on_first_start(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/houses"})
    msg = await client.receive_json()
    assert [h["id"] for h in msg["result"]] == ["home"]
    assert msg["result"][0]["source"] == "file:home.yaml"

    await client.send_json_auto_id({"type": "homeslice/model", "house": "home"})
    msg = await client.receive_json()
    assert msg["result"]["levels"][0]["rooms"][0]["area_id"] == "living_room"


async def test_save_validates_and_notifies_subscribers(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/subscribe", "house": "home"})
    assert (await client.receive_json())["success"]
    first = await client.receive_json()
    assert first["event"]["model"]["id"] == "home"

    await client.send_json_auto_id({"type": "homeslice/model/save", "house": "home", "model": {"schema": 2}})
    msg = await client.receive_json()
    assert msg["error"]["code"] == "invalid_model"
    assert "schema" in msg["error"]["message"]

    changed = model()
    changed["name"] = "Renamed"
    await client.send_json_auto_id({"type": "homeslice/model/save", "house": "home", "model": changed})
    # the subscription event and the save result may arrive in either order
    messages = [await client.receive_json(), await client.receive_json()]
    event = next(m for m in messages if m.get("type") == "event")
    assert event["event"]["model"]["name"] == "Renamed"
    assert any(m.get("type") == "result" and m["success"] for m in messages)


async def test_non_admins_cannot_save(hass: HomeAssistant, setup, hass_ws_client, hass_read_only_access_token) -> None:
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id({"type": "homeslice/model/save", "house": "home", "model": model()})
    msg = await client.receive_json()
    assert msg["error"]["code"] == "unauthorized"
    # reading is fine
    await client.send_json_auto_id({"type": "homeslice/model", "house": "home"})
    assert (await client.receive_json())["success"]


async def test_delete_and_unknown_house(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/model/delete", "house": "home"})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "homeslice/model", "house": "home"})
    assert (await client.receive_json())["error"]["code"] == "not_found"


async def test_repairs_follow_broken_links(hass: HomeAssistant, setup, hass_ws_client) -> None:
    issues = ir.async_get(hass)
    assert not [i for (d, i) in issues.issues if d == DOMAIN]

    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "homeslice/model/save", "house": "home", "model": model(area="cellar", cover="cover.gone")}
    )
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert sorted(i for (d, i) in issues.issues if d == DOMAIN) == [
        "home_missing_area_cellar",
        "home_missing_entity_cover.gone",
    ]
    assert issues.async_get_issue(DOMAIN, "home_missing_area_cellar").translation_placeholders["room"] == "living"

    # creating the area fixes that issue once the registry change is noticed
    ar.async_get(hass).async_create("Cellar")
    await hass.async_block_till_done()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=5))
    await hass.async_block_till_done()
    assert sorted(i for (d, i) in issues.issues if d == DOMAIN) == ["home_missing_entity_cover.gone"]


async def test_import_files_service_overwrites(hass: HomeAssistant, setup, hass_ws_client, tmp_path: Path) -> None:
    (tmp_path / "homeslice" / "home.yaml").write_text(HOUSE_YAML.replace("id: home", "id: home\nname: From file"))
    await hass.services.async_call(DOMAIN, "import_files", blocking=True)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/model", "house": "home"})
    assert (await client.receive_json())["result"]["name"] == "From file"


async def test_editor_panel_is_admin_only(hass: HomeAssistant, setup) -> None:
    panel = hass.data["frontend_panels"]["homeslice"]
    assert panel.require_admin
    assert panel.config["_panel_custom"]["name"] == "homeslice-panel"


async def test_import_skips_houses_edited_in_the_editor(hass: HomeAssistant, setup, hass_ws_client, tmp_path: Path) -> None:
    client = await hass_ws_client(hass)
    edited = model()
    edited["name"] = "Edited"
    await client.send_json_auto_id({"type": "homeslice/model/save", "house": "home", "model": edited})
    assert (await client.receive_json())["success"]

    await hass.services.async_call(DOMAIN, "import_files", blocking=True)
    await client.send_json_auto_id({"type": "homeslice/model", "house": "home"})
    assert (await client.receive_json())["result"]["name"] == "Edited"

    await hass.services.async_call(DOMAIN, "import_files", {"force": True}, blocking=True)
    await client.send_json_auto_id({"type": "homeslice/model", "house": "home"})
    assert "name" not in (await client.receive_json())["result"]


PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


async def test_underlays_are_stored_per_level_admin_only(
    hass: HomeAssistant, setup, hass_ws_client, hass_read_only_access_token
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/underlay/get", "house": "home", "level": "ground"})
    assert (await client.receive_json())["result"] is None
    await client.send_json_auto_id({"type": "homeslice/underlay/set", "house": "home", "level": "ground", "place": {"origin": [0, 0], "scale": 0.01}})
    assert (await client.receive_json())["error"]["code"] == "invalid_underlay"  # no image yet
    await client.send_json_auto_id({"type": "homeslice/underlay/set", "house": "home", "level": "ground", "image": "data:text/html,<b>"})
    assert (await client.receive_json())["error"]["code"] == "invalid_underlay"
    await client.send_json_auto_id({"type": "homeslice/underlay/set", "house": "home", "level": "ground", "image": PNG, "opacity": 0.5})
    assert (await client.receive_json())["result"] == {"opacity": 0.5}
    await client.send_json_auto_id(
        {"type": "homeslice/underlay/set", "house": "home", "level": "ground", "place": {"origin": [1, 2], "scale": 0.02}}
    )
    assert (await client.receive_json())["result"]["place"] == {"origin": [1.0, 2.0], "scale": 0.02, "rotation": 0}
    ruler = {"a": [10, 20], "b": [210, 20]}
    await client.send_json_auto_id(
        {"type": "homeslice/underlay/set", "house": "home", "level": "ground", "place": {"origin": [1, 2], "scale": 0.02, "rotation": 1.5, "ruler": ruler}}
    )
    assert (await client.receive_json())["result"]["place"]["ruler"] == {"a": [10.0, 20.0], "b": [210.0, 20.0]}
    await client.send_json_auto_id(
        {"type": "homeslice/underlay/set", "house": "home", "level": "ground", "place": {"origin": [1, 2], "scale": 0.02, "ruler": {"a": [1, 2]}}}
    )
    assert not (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "homeslice/underlay/get", "house": "home", "level": "ground"})
    got = (await client.receive_json())["result"]
    assert got["image"] == PNG and got["opacity"] == 0.5
    await client.send_json_auto_id({"type": "homeslice/underlay/get", "house": "home"})
    assert (await client.receive_json())["result"] == {"levels": ["ground"]}

    reader = await hass_ws_client(hass, hass_read_only_access_token)
    await reader.send_json_auto_id({"type": "homeslice/underlay/get", "house": "home", "level": "ground"})
    assert (await reader.receive_json())["error"]["code"] == "unauthorized"

    await client.send_json_auto_id({"type": "homeslice/underlay/delete", "house": "home", "level": "ground"})
    await client.receive_json()
    await client.send_json_auto_id({"type": "homeslice/underlay/get", "house": "home"})
    assert (await client.receive_json())["result"] == {"levels": []}


def _glb(gltf: str) -> str:
    """A .glb with just its JSON part, as the editor uploads it (a data: URL)."""
    data = gltf.encode() + b" " * (-len(gltf) % 4)
    blob = b"glTF" + struct.pack("<II", 2, 20 + len(data)) + struct.pack("<I4s", len(data), b"JSON") + data
    return "data:model/gltf-binary;base64," + base64.b64encode(blob).decode()


GLB = _glb('{"asset":{"version":"2.0"}}')


async def test_custom_models_upload_list_delete(hass: HomeAssistant, setup, hass_ws_client, tmp_path: Path) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/assets/custom/upload", "name": "Our sofa", "data": GLB})
    msg = await client.receive_json()
    assert msg["success"], msg
    asset_id = msg["result"]["id"]
    assert msg["result"]["url"] == f"/homeslice_assets/custom/{asset_id}.glb"
    assert (tmp_path / "homeslice" / "assets" / "custom" / f"{asset_id}.glb").read_bytes().startswith(b"glTF")
    # the names are kept outside the served folder
    assert not (tmp_path / "homeslice" / "assets" / "custom" / "index.json").exists()
    assert "Our sofa" in (tmp_path / "homeslice" / "custom_models.json").read_text()
    for bad in ("data:model/gltf-binary;base64,AAAA", _glb('{"images":[{"uri":"https://tracker.example/p.png"}]}')):
        await client.send_json_auto_id({"type": "homeslice/assets/custom/upload", "name": "x", "data": bad})
        assert not (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "homeslice/assets/custom"})
    assert [m["name"] for m in (await client.receive_json())["result"]] == ["Our sofa"]
    await client.send_json_auto_id({"type": "homeslice/assets/custom/delete", "asset": asset_id})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "homeslice/assets/custom"})
    assert (await client.receive_json())["result"] == []


async def test_polyhaven_models_are_downloaded_once(hass: HomeAssistant, setup, hass_ws_client, aioclient_mock, tmp_path: Path) -> None:
    aioclient_mock.get(
        "https://api.polyhaven.com/files/Sofa_01",
        json={"gltf": {"1k": {"gltf": {"url": "https://dl.polyhaven.org/m/Sofa_01_1k.gltf", "size": 10, "include": {
            "Sofa_01.bin": {"url": "https://dl.polyhaven.org/m/Sofa_01.bin", "size": 3},
            "textures/Sofa_01_diff_1k.jpg": {"url": "https://dl.polyhaven.org/m/diff.jpg", "size": 3},
        }}}}},
    )
    aioclient_mock.get("https://dl.polyhaven.org/m/Sofa_01_1k.gltf", text="{}")
    aioclient_mock.get("https://dl.polyhaven.org/m/Sofa_01.bin", text="bin")
    aioclient_mock.get("https://dl.polyhaven.org/m/diff.jpg", text="jpg")
    client = await hass_ws_client(hass)
    for _ in range(2):
        await client.send_json_auto_id({"type": "homeslice/assets/polyhaven/fetch", "asset": "Sofa_01"})
        msg = await client.receive_json()
        assert msg["result"] == {"url": "/homeslice_assets/polyhaven/Sofa_01/Sofa_01_1k.gltf"}, msg
    folder = tmp_path / "homeslice" / "assets" / "polyhaven" / "Sofa_01"
    assert (folder / "textures" / "Sofa_01_diff_1k.jpg").read_text() == "jpg"
    assert aioclient_mock.call_count == 4  # once: the file list and three files
    assert all(dict(call[3] or {}).get("User-Agent", "").startswith("Homeslice") for call in aioclient_mock.mock_calls)
    await client.send_json_auto_id({"type": "homeslice/assets/polyhaven/fetch", "asset": "../etc"})
    assert not (await client.receive_json())["success"]


@pytest.mark.parametrize(
    ("include", "gltf"),
    [
        ({"page.html": {"url": "https://dl.polyhaven.org/m/page.html", "size": 3}}, "{}"),  # served from HA's address
        ({}, '{"images":[{"uri":"https://elsewhere.example/t.jpg"}]}'),
    ],
)
async def test_polyhaven_models_with_odd_files_are_refused(hass: HomeAssistant, setup, hass_ws_client, aioclient_mock, tmp_path: Path, include, gltf) -> None:
    aioclient_mock.get(
        "https://api.polyhaven.com/files/Odd",
        json={"gltf": {"1k": {"gltf": {"url": "https://dl.polyhaven.org/m/Odd_1k.gltf", "size": 10, "include": include}}}},
    )
    aioclient_mock.get("https://dl.polyhaven.org/m/Odd_1k.gltf", text=gltf)
    aioclient_mock.get("https://dl.polyhaven.org/m/page.html", text="<script>")
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/assets/polyhaven/fetch", "asset": "Odd"})
    assert not (await client.receive_json())["success"]
    assert not (tmp_path / "homeslice" / "assets" / "polyhaven" / "Odd").exists()


async def test_old_custom_index_moves_out_of_the_served_folder(hass: HomeAssistant, tmp_path: Path, monkeypatch) -> None:
    from custom_components.homeslice.assets import Assets

    monkeypatch.setattr("custom_components.homeslice.assets.MODEL_DIR", str(tmp_path / "homeslice"))
    assets = Assets(hass)
    (assets.root / "custom").mkdir(parents=True)
    (assets.root / "custom" / "index.json").write_text('{"abc": {"name": "Old", "bytes": 1}}')
    await hass.async_add_executor_job(assets.ensure_dirs)
    assert not (assets.root / "custom" / "index.json").exists()
    assert [m["name"] for m in await assets.async_custom_list()] == ["Old"]


async def test_polyhaven_textures_catalog_and_download(hass: HomeAssistant, setup, hass_ws_client, aioclient_mock, tmp_path: Path) -> None:
    aioclient_mock.get(
        "https://api.polyhaven.com/assets?t=textures",
        json={
            "wood_floor": {"name": "Wood Floor", "categories": ["wood", "floor", "indoor"], "dimensions": [2000, 2000], "download_count": 9},
            "red_brick": {"name": "Red Brick", "categories": ["brick", "wall", "outdoor"], "dimensions": [3000, 3000], "download_count": 5},
            "aerial_road": {"name": "Road", "categories": ["floor", "road", "aerial"], "dimensions": [30000, 30000], "download_count": 7},
        },
    )
    aioclient_mock.get(
        "https://api.polyhaven.com/files/wood_floor",
        json={"Diffuse": {"1k": {"jpg": {"url": "https://dl.polyhaven.org/file/wood_floor_diff_1k.jpg", "size": 10}}}},
    )
    aioclient_mock.get("https://dl.polyhaven.org/file/wood_floor_diff_1k.jpg", content=b"\xff\xd8\xff\xe0jpeg")
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/assets/textures"})
    result = (await client.receive_json())["result"]
    assert [t["id"] for t in result] == ["wood_floor", "red_brick"]
    assert result[0]["on"] == ["floor"] and result[1]["on"] == ["wall"] and result[1]["size"] == [3.0, 3.0]
    for _ in range(2):
        await client.send_json_auto_id({"type": "homeslice/assets/textures/fetch", "asset": "wood_floor"})
        msg = await client.receive_json()
        assert msg["result"] == {"url": "/homeslice_assets/textures/wood_floor/wood_floor_diff_1k.jpg", "size": [2.0, 2.0]}, msg
    folder = tmp_path / "homeslice" / "assets" / "textures" / "wood_floor"
    assert (folder / "wood_floor_diff_1k.jpg").read_bytes().startswith(b"\xff\xd8")
    assert aioclient_mock.call_count == 3  # the catalogue once, the file list and the image once
    await client.send_json_auto_id({"type": "homeslice/assets/textures/fetch", "asset": "../etc"})
    assert not (await client.receive_json())["success"]


def test_texture_refs() -> None:
    from custom_components.homeslice.assets import texture_refs

    model = {"facade": "polyhaven:red_brick", "levels": [{"rooms": [{"floor": "polyhaven:wood_floor", "wall": "paint_white", "wall_sides": {"north": "polyhaven:../x", "east": "polyhaven:plaster"}}]}]}
    assert texture_refs(model) == {"red_brick", "wood_floor", "plaster"}


async def test_polyhaven_catalog_keeps_home_categories(hass: HomeAssistant, setup, hass_ws_client, aioclient_mock) -> None:
    aioclient_mock.get(
        "https://api.polyhaven.com/assets?t=models",
        json={
            "Sofa_01": {"name": "Sofa 01", "categories": ["furniture", "seating"], "dimensions": [1571, 658, 796], "download_count": 5},
            "rock_01": {"name": "Rock", "categories": ["rocks"], "download_count": 7},
            "boat_01": {"name": "Boat", "categories": ["ships"], "download_count": 9},
        },
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/assets/polyhaven"})
    result = (await client.receive_json())["result"]
    assert sorted(i["id"] for i in result) == ["Sofa_01", "rock_01"]
    assert next(i for i in result if i["id"] == "Sofa_01")["dimensions"] == [1.571, 0.658, 0.796]


# ----- for AI assistants -----

VALID_YAML = HOUSE_YAML


async def test_guide_lists_floors_areas_and_the_catalogue(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/guide", "house": "home"})
    guide = (await client.receive_json())["result"]["guide"]
    assert "Writing a Homeslice house" in guide
    assert "area_id: living_room" in guide  # this Home Assistant's area
    assert "modern:wardrobe_sliding" in guide  # the catalogue
    assert "## Current house `home`" in guide


async def test_validate_says_what_the_editor_says(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/validate", "model": VALID_YAML})
    assert (await client.receive_json())["result"] == {"valid": True, "issues": []}
    broken = VALID_YAML + "    openings: [{ room: kitchen, side: south, at: 1, width: 1 }]\n"
    await client.send_json_auto_id({"type": "homeslice/validate", "model": broken})
    result = (await client.receive_json())["result"]
    assert not result["valid"]
    assert result["issues"][0]["message"].startswith('Unknown room "kitchen"')


async def test_saving_keeps_the_previous_version(hass: HomeAssistant, setup, hass_ws_client) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/model/save", "house": "home", "model": model(area="kitchen")})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "homeslice/houses"})
    house = (await client.receive_json())["result"][0]
    assert house["source"] == "api" and house["previous"]["source"] == "file:home.yaml"
    await client.send_json_auto_id({"type": "homeslice/model/restore", "house": "home"})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": "homeslice/model", "house": "home"})
    assert (await client.receive_json())["result"]["levels"][0]["rooms"][0]["area_id"] == "living_room"
    # a broken house is refused with the editor's messages
    await client.send_json_auto_id({"type": "homeslice/model/save", "house": "home", "model": {**model(), "levels": [{"rooms": []}]}})
    msg = await client.receive_json()
    assert not msg["success"] and "Every level needs an id." in msg["error"]["message"]


async def test_llm_api_tools(hass: HomeAssistant, setup, hass_admin_user) -> None:
    from homeassistant.core import Context
    from homeassistant.helpers import llm

    from custom_components.homeslice.llm import HomesliceAPI

    context = llm.LLMContext(platform="test", context=Context(user_id=hass_admin_user.id), language="en", assistant="conversation", device_id=None)
    assert "homeslice" in {a.id for a in llm.async_get_apis(hass)}
    api = await HomesliceAPI(hass=hass, id="homeslice", name="Homeslice").async_get_api_instance(context)
    names = [t.name for t in api.tools]
    assert names == ["homeslice_get_guide", "homeslice_get_house", "homeslice_validate_house", "homeslice_save_house"]
    tools = {t.name: t for t in api.tools}
    # (APIInstance.async_call_tool needs the conversation integration; call the tools themselves)
    call = lambda name, args: tools[name].async_call(hass, llm.ToolInput(name, args), context)  # noqa: E731
    result = await call("homeslice_validate_house", {"yaml": "schema: 1\nlevels: []"})
    assert result["valid"] is False and "at least one level" in result["issues"]
    saved = await call("homeslice_save_house", {"yaml": VALID_YAML.replace("living_room", "kitchen")})
    assert saved["saved"] is True and saved["house"] == "home"
    store = hass.data[DOMAIN]["store"]
    assert store.houses["home"]["source"] == "assistant:test"
    got = await call("homeslice_get_house", {})
    assert "area_id: kitchen" in got["yaml"]


async def test_http_api(hass: HomeAssistant, setup, hass_client) -> None:
    client = await hass_client()
    resp = await client.get("/api/homeslice/guide")
    assert resp.status == 200 and "Home Assistant context" in await resp.text()
    resp = await client.post("/api/homeslice/validate", data="schema: 1\nlevels: [{id: g}]")
    body = await resp.json()
    assert body["valid"] is False and body["issues"][0]["path"] == "levels.g"
    resp = await client.put("/api/homeslice/houses/home", data=VALID_YAML.replace("living_room", "kitchen"))
    assert resp.status == 200 and (await resp.json())["saved"]
    resp = await client.get("/api/homeslice/houses/home")
    assert "area_id: kitchen" in await resp.text()
    resp = await client.post("/api/homeslice/houses/home/restore")
    assert resp.status == 200
    resp = await client.get("/api/homeslice/houses/home")
    assert "area_id: living_room" in await resp.text()


async def test_show_action_reaches_cards_by_name_or_id(hass: HomeAssistant, setup, hass_ws_client, hass_read_only_access_token) -> None:
    from homeassistant.exceptions import ServiceValidationError

    area = ar.async_get(hass).async_create("Snug", aliases={"lounge"})
    # wall tablets often log in as a plain user
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id({"type": "homeslice/show/subscribe"})
    assert (await client.receive_json())["success"]

    await hass.services.async_call(DOMAIN, "show", {"area": "the lounge", "seconds": 20}, blocking=True)
    event = await client.receive_json()
    assert event["event"] == {"area_id": area.id, "seconds": 20}

    await hass.services.async_call(DOMAIN, "show", {"entity_id": "camera.door"}, blocking=True)
    assert (await client.receive_json())["event"] == {"entity_id": "camera.door"}

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "show", {"area": "attic"}, blocking=True)
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "show", {}, blocking=True)


async def test_announce_shows_on_cards_and_speaks_in_the_area(hass: HomeAssistant, setup, hass_ws_client) -> None:
    from homeassistant.core import ServiceCall
    from homeassistant.helpers import entity_registry as er

    kitchen = ar.async_get(hass).async_create("Kitchen")
    entities = er.async_get(hass)
    speaker = entities.async_get_or_create("media_player", "test", "kitchen_speaker")
    entities.async_update_entity(speaker.entity_id, area_id=kitchen.id)
    entities.async_get_or_create("media_player", "test", "living_tv")
    hass.states.async_set("tts.engine", "unknown")
    spoken: list[ServiceCall] = []

    async def speak(call: ServiceCall) -> None:
        spoken.append(call)

    hass.services.async_register("tts", "speak", speak)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/show/subscribe"})
    assert (await client.receive_json())["success"]

    await hass.services.async_call(DOMAIN, "announce", {"message": "Dinner is ready", "area": "kitchen"}, blocking=True)
    assert (await client.receive_json())["event"] == {"area_id": kitchen.id, "message": "Dinner is ready"}
    await hass.async_block_till_done()
    assert len(spoken) == 1
    assert spoken[0].data["media_player_entity_id"] == [speaker.entity_id]
    assert spoken[0].data["message"] == "Dinner is ready"

    # the whole house: only shown, nobody named to speak
    await hass.services.async_call(DOMAIN, "announce", {"message": "Storm coming", "seconds": 60}, blocking=True)
    assert (await client.receive_json())["event"] == {"message": "Storm coming", "seconds": 60}
    await hass.async_block_till_done()
    assert len(spoken) == 1


async def test_backup_round_trip_keeps_ids(hass: HomeAssistant, setup, hass_ws_client, tmp_path: Path) -> None:
    import io
    import zipfile

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/assets/custom/upload", "name": "Chair", "data": GLB})
    uploaded = (await client.receive_json())["result"]
    m = model()
    m["levels"][0]["rooms"][0]["furniture"] = [{"type": "chair", "at": [1, 1], "model": f"custom:{uploaded['id']}"}]
    await client.send_json_auto_id({"type": "homeslice/model/save", "house": "home", "model": m})
    assert (await client.receive_json())["success"]

    await client.send_json_auto_id({"type": "homeslice/backup"})
    backup = (await client.receive_json())["result"]
    blob = base64.b64decode(backup["data"].split(",", 1)[1])
    names = zipfile.ZipFile(io.BytesIO(blob)).namelist()
    assert {"manifest.json", "houses/home.json", "models/index.json", f"models/{uploaded['id']}.glb"} <= set(names)

    # gone, then back with the same ids
    await client.send_json_auto_id({"type": "homeslice/assets/custom/delete", "asset": uploaded["id"]})
    await client.receive_json()
    await client.send_json_auto_id({"type": "homeslice/backup/restore", "data": backup["data"]})
    result = (await client.receive_json())["result"]
    assert result == {"houses": ["home"], "plans": 0, "models": 1}
    await client.send_json_auto_id({"type": "homeslice/assets/custom"})
    assert [x["id"] for x in (await client.receive_json())["result"]] == [uploaded["id"]]


@pytest.mark.parametrize("name", ["../evil.json", "houses/../../x.json", "scripts/run.sh"])
async def test_backup_with_odd_files_is_refused(hass: HomeAssistant, setup, hass_ws_client, name: str) -> None:
    import io
    import zipfile

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("manifest.json", '{"format": "homeslice-backup", "version": 1}')
        z.writestr(name, "x")
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "homeslice/backup/restore", "data": base64.b64encode(out.getvalue()).decode()})
    reply = await client.receive_json()
    assert not reply["success"] and reply["error"]["code"] == "invalid_backup"


async def test_backup_is_admin_only(hass: HomeAssistant, setup, hass_ws_client, hass_read_only_access_token) -> None:
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id({"type": "homeslice/backup"})
    assert not (await client.receive_json())["success"]
