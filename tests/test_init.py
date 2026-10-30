"""Integration tests: storage, websocket API, file import and repairs."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
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
    assert issues.async_get_issue(DOMAIN, "home_missing_area_cellar").translation_placeholders["where"] == "room living"

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
