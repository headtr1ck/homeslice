"""Furniture models from outside the bundle: Poly Haven's and the user's own.

Both live in <config>/homeslice/assets (so they are part of backups) and are served at
ASSETS_URL to every device. Poly Haven models are downloaded once, the first time a house
uses one (https://polyhaven.com, CC0); custom ones are uploaded in the editor as .glb.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import secrets
import time
from pathlib import Path, PurePosixPath
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import MODEL_DIR

_LOGGER = logging.getLogger(__name__)

ASSETS_URL = "/homeslice_assets"
ASSETS_DIR = "assets"

POLYHAVEN_API = "https://api.polyhaven.com"
POLYHAVEN_FILES = "https://dl.polyhaven.org/"
# Poly Haven asks every API client for its own User-Agent
USER_AGENT = "Homeslice (Home Assistant integration; https://github.com/headtr1ck/homeslice)"
# the categories a home has: furniture, lamps, plants, decoration
POLYHAVEN_CATEGORIES = {
    "furniture", "seating", "table", "lighting", "shelves", "bed", "potted plants", "plants", "trees",
    "flowers", "appliances", "decorative", "vases", "wall decoration", "electronics", "office", "books",
}
CATALOG_TTL = 24 * 3600
MAX_POLYHAVEN_BYTES = 40_000_000
RESOLUTION = "1k"

# a data: URL of a .glb (the editor reads the file); 12 MB of model at most
MAX_UPLOAD_CHARS = 16_000_000
GLB_PREFIXES = ("data:model/gltf-binary;base64,", "data:application/octet-stream;base64,", "data:;base64,")
ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class AssetError(ValueError):
    """A model that can't be fetched or stored."""


class Assets:
    """Downloaded and uploaded models."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.root = Path(hass.config.path(MODEL_DIR, ASSETS_DIR))
        self._catalog: tuple[float, list[dict[str, Any]]] | None = None
        self._fetching: dict[str, asyncio.Task[None]] = {}

    def ensure_dirs(self) -> None:
        """Create the folders (blocking)."""
        (self.root / "polyhaven").mkdir(parents=True, exist_ok=True)
        (self.root / "custom").mkdir(parents=True, exist_ok=True)

    # ----- Poly Haven -----

    async def _get_json(self, url: str) -> Any:
        session = async_get_clientsession(self.hass)
        async with session.get(url, headers={"User-Agent": USER_AGENT}, timeout=30) as resp:
            if resp.status != 200:
                raise AssetError(f"Poly Haven answered {resp.status}")
            return await resp.json(content_type=None)

    async def async_catalog(self) -> list[dict[str, Any]]:
        """Poly Haven's models for homes (cached for a day)."""
        if self._catalog and time.monotonic() - self._catalog[0] < CATALOG_TTL:
            return self._catalog[1]
        data = await self._get_json(f"{POLYHAVEN_API}/assets?t=models")
        items = []
        for asset_id, a in data.items():
            categories = [c for c in a.get("categories", []) if not c.startswith("collection:")]
            if not ID.match(asset_id) or not POLYHAVEN_CATEGORIES.intersection(categories):
                continue
            dims = a.get("dimensions") or []
            items.append(
                {
                    "id": asset_id,
                    "name": a.get("name", asset_id),
                    "categories": categories,
                    "tags": a.get("tags", []),
                    # millimetres: width, depth, height
                    "dimensions": [round(float(v) / 1000, 3) for v in dims[:3]] if len(dims) >= 3 else None,
                    "thumbnail": a.get("thumbnail_url"),
                    "downloads": a.get("download_count", 0),
                }
            )
        items.sort(key=lambda i: -i["downloads"])
        self._catalog = (time.monotonic(), items)
        return items

    def polyhaven_url(self, asset_id: str) -> str:
        return f"{ASSETS_URL}/polyhaven/{asset_id}/{asset_id}_{RESOLUTION}.gltf"

    def _polyhaven_ready(self, asset_id: str) -> bool:
        return (self.root / "polyhaven" / asset_id / f"{asset_id}_{RESOLUTION}.gltf").exists()

    async def async_polyhaven(self, asset_id: str) -> str:
        """Downloads a model (once) and returns where it is served."""
        if not ID.match(asset_id):
            raise AssetError("Not a Poly Haven model id")
        if await self.hass.async_add_executor_job(self._polyhaven_ready, asset_id):
            return self.polyhaven_url(asset_id)
        # one download per model, however many ask at once
        task = self._fetching.get(asset_id)
        if task is None:
            task = self.hass.async_create_task(self._download(asset_id), f"homeslice download {asset_id}")
            self._fetching[asset_id] = task
            task.add_done_callback(lambda _: self._fetching.pop(asset_id, None))
        try:
            await asyncio.shield(task)
        except AssetError:
            raise
        except Exception as err:  # noqa: BLE001 - network errors and the like
            raise AssetError(f"Download failed: {err}") from err
        return self.polyhaven_url(asset_id)

    async def _download(self, asset_id: str) -> None:
        files = await self._get_json(f"{POLYHAVEN_API}/files/{asset_id}")
        entry = (files.get("gltf") or {}).get(RESOLUTION, {}).get("gltf")
        if not entry:
            raise AssetError("Poly Haven has no glTF of this model")
        wanted = {f"{asset_id}_{RESOLUTION}.gltf": entry["url"]}
        for rel, inc in (entry.get("include") or {}).items():
            wanted[rel] = inc["url"]
        total = entry.get("size", 0) + sum(i.get("size", 0) for i in (entry.get("include") or {}).values())
        if total > MAX_POLYHAVEN_BYTES:
            raise AssetError("This model is too large")
        target = self.root / "polyhaven" / asset_id
        session = async_get_clientsession(self.hass)
        blobs: dict[Path, bytes] = {}
        for rel, url in wanted.items():
            path = PurePosixPath(rel)
            if path.is_absolute() or ".." in path.parts or not url.startswith(POLYHAVEN_FILES):
                raise AssetError("Unexpected file in the model")
            async with session.get(url, headers={"User-Agent": USER_AGENT}, timeout=120) as resp:
                if resp.status != 200:
                    raise AssetError(f"Poly Haven answered {resp.status}")
                blobs[target / path] = await resp.read()

        def write() -> None:
            # the .gltf last: it marks the model as complete
            for path, blob in sorted(blobs.items(), key=lambda kv: kv[0].suffix == ".gltf"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(blob)

        await self.hass.async_add_executor_job(write)
        _LOGGER.info("Downloaded Poly Haven model %s", asset_id)

    async def async_ensure_models(self, model: dict[str, Any]) -> None:
        """Downloads the Poly Haven models a house uses (e.g. one imported from a file)."""
        for asset_id in sorted(polyhaven_refs(model)):
            try:
                await self.async_polyhaven(asset_id)
            except AssetError as err:
                _LOGGER.warning("Could not fetch Poly Haven model %s: %s", asset_id, err)

    # ----- custom models -----

    def _custom_index(self) -> dict[str, Any]:
        index = self.root / "custom" / "index.json"
        return json.loads(index.read_text()) if index.exists() else {}

    async def async_custom_list(self) -> list[dict[str, Any]]:
        """The uploaded models: id, name, url, size."""
        index = await self.hass.async_add_executor_job(self._custom_index)
        return [{"id": i, "url": f"{ASSETS_URL}/custom/{i}.glb", **meta} for i, meta in sorted(index.items(), key=lambda kv: kv[1]["name"].lower())]

    async def async_custom_upload(self, name: str, data: str) -> dict[str, Any]:
        """Stores an uploaded .glb under a new, unguessable id."""
        if not isinstance(data, str) or not data.startswith(GLB_PREFIXES):
            raise AssetError("Upload a .glb file (binary glTF)")
        if len(data) > MAX_UPLOAD_CHARS:
            raise AssetError("The model is too large (12 MB at most)")
        blob = base64.b64decode(data.split(",", 1)[1])
        if blob[:4] != b"glTF":
            raise AssetError("This is not a .glb file")
        asset_id = secrets.token_hex(12)
        name = (name or "Model").strip()[:80] or "Model"

        def write() -> dict[str, Any]:
            (self.root / "custom" / f"{asset_id}.glb").write_bytes(blob)
            index = self._custom_index()
            index[asset_id] = {"name": name, "bytes": len(blob)}
            (self.root / "custom" / "index.json").write_text(json.dumps(index, indent=1))
            return index[asset_id]

        meta = await self.hass.async_add_executor_job(write)
        return {"id": asset_id, "url": f"{ASSETS_URL}/custom/{asset_id}.glb", **meta}

    async def async_custom_delete(self, asset_id: str) -> None:
        if not ID.match(asset_id):
            raise AssetError("Not a model id")

        def remove() -> None:
            (self.root / "custom" / f"{asset_id}.glb").unlink(missing_ok=True)
            index = self._custom_index()
            if index.pop(asset_id, None) is not None:
                (self.root / "custom" / "index.json").write_text(json.dumps(index, indent=1))

        await self.hass.async_add_executor_job(remove)


def polyhaven_refs(model: dict[str, Any]) -> set[str]:
    """The Poly Haven models a house model uses."""
    refs = set()
    for level in model.get("levels", []) if isinstance(model, dict) else []:
        for room in level.get("rooms", []):
            for piece in room.get("furniture", []) or []:
                ref = piece.get("model") if isinstance(piece, dict) else None
                if isinstance(ref, str) and ref.startswith("polyhaven:") and ID.match(ref[10:]):
                    refs.add(ref[10:])
    return refs
