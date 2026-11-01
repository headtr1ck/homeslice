"""One file with everything Homeslice keeps: houses, plan images, uploaded models.

Home Assistant's own backups include all of it already; this one moves a home to another
installation, or keeps a copy before big changes. Downloaded Poly Haven files are left out
(they come back by themselves). Restoring checks every file like an upload.
"""

from __future__ import annotations

import io
import json
import re
from datetime import UTC, datetime
from typing import Any
import zipfile

from homeassistant.core import HomeAssistant

from .assets import ID, AssetError, check_links, glb_json
from .const import DOMAIN
from .store import ModelError
from .underlay import UnderlayError

FORMAT = "homeslice-backup"
MAX_FILES = 500
MAX_TOTAL = 300_000_000
MAX_MODEL = 12_000_000
NAME = re.compile(r"^(manifest\.json|houses/[A-Za-z0-9_-]{1,80}\.json|underlays/[A-Za-z0-9_-]{1,80}\.json|models/index\.json|models/[A-Za-z0-9_-]{1,80}\.glb)$")


class BackupError(Exception):
    """Not a Homeslice backup, or something in it is not allowed."""


async def async_backup(hass: HomeAssistant) -> bytes:
    """The zip: manifest, houses, underlays per house, uploaded models with their index."""
    data = hass.data[DOMAIN]
    store, underlays, assets = data["store"], data["underlays"], data["assets"]
    houses = {h["id"]: store.get(h["id"]) for h in store.summary()}
    plans = {}
    for house_id in houses:
        levels = {level: await underlays.async_get(house_id, level) for level in await underlays.async_list(house_id)}
        if levels:
            plans[house_id] = {"levels": levels}
    index = await hass.async_add_executor_job(assets._custom_index)

    def build() -> bytes:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps({"format": FORMAT, "version": 1, "created": datetime.now(UTC).isoformat(), "houses": sorted(houses)}, indent=1))
            for house_id, model in houses.items():
                z.writestr(f"houses/{house_id}.json", json.dumps(model, indent=1, ensure_ascii=False))
            for house_id, plan in plans.items():
                z.writestr(f"underlays/{house_id}.json", json.dumps(plan))
            z.writestr("models/index.json", json.dumps(index, indent=1))
            for asset_id in index:
                path = assets.root / "custom" / f"{asset_id}.glb"
                if path.exists():
                    z.write(path, f"models/{asset_id}.glb")
        return out.getvalue()

    return await hass.async_add_executor_job(build)


def _read(blob: bytes) -> dict[str, bytes]:
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as err:
        raise BackupError("Not a zip file") from err
    infos = z.infolist()
    if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_TOTAL:
        raise BackupError("The backup is too large")
    files: dict[str, bytes] = {}
    for info in infos:
        if info.is_dir():
            continue
        if not NAME.match(info.filename):
            raise BackupError(f"Unexpected file in the backup: {info.filename}")
        files[info.filename] = z.read(info)
    try:
        manifest = json.loads(files.get("manifest.json", b"{}"))
    except ValueError as err:
        raise BackupError("The backup's manifest is broken") from err
    if manifest.get("format") != FORMAT:
        raise BackupError("Not a Homeslice backup")
    return files


async def async_restore(hass: HomeAssistant, blob: bytes) -> dict[str, Any]:
    """Puts everything back; houses keep their ids, models theirs (houses refer to them)."""
    data = hass.data[DOMAIN]
    store, underlays, assets = data["store"], data["underlays"], data["assets"]
    files = await hass.async_add_executor_job(_read, blob)
    # models first: the houses use them
    index = json.loads(files.get("models/index.json", b"{}"))
    models: dict[str, tuple[dict[str, Any], bytes]] = {}
    for name, content in files.items():
        if not name.startswith("models/") or not name.endswith(".glb"):
            continue
        asset_id = name[len("models/") : -len(".glb")]
        if not ID.match(asset_id) or len(content) > MAX_MODEL:
            raise BackupError(f"Model {asset_id} is not allowed")
        try:
            check_links(glb_json(content))
        except AssetError as err:
            raise BackupError(f"Model {asset_id}: {err}") from err
        meta = index.get(asset_id) if isinstance(index.get(asset_id), dict) else {}
        models[asset_id] = ({"name": str(meta.get("name", "Model"))[:80], "size": len(content)}, content)

    def write_models() -> None:
        current = assets._custom_index()
        for asset_id, (meta, content) in models.items():
            (assets.root / "custom" / f"{asset_id}.glb").write_bytes(content)
            current[asset_id] = {**current.get(asset_id, {}), **meta}
        assets._index_path.write_text(json.dumps(current, indent=1))

    await hass.async_add_executor_job(write_models)
    houses = []
    for name, content in files.items():
        if not name.startswith("houses/"):
            continue
        house_id = name[len("houses/") : -len(".json")]
        try:
            await store.async_save(house_id, json.loads(content), "backup")
        except (ModelError, ValueError) as err:
            raise BackupError(f"House {house_id}: {err}") from err
        houses.append(house_id)
    plans = 0
    for name, content in files.items():
        if not name.startswith("underlays/"):
            continue
        house_id = name[len("underlays/") : -len(".json")]
        for level_id, plan in (json.loads(content).get("levels") or {}).items():
            if isinstance(plan, dict) and isinstance(level_id, str) and ID.match(level_id) and ID.match(house_id):
                try:
                    await underlays.async_set(house_id, level_id, plan)
                except UnderlayError:
                    continue
                plans += 1
    return {"houses": sorted(houses), "plans": plans, "models": len(models)}
