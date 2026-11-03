"""Furniture models from outside the bundle: Poly Haven's and the user's own.

Uploads live in <config>/homeslice/assets (so they are part of backups); what Poly Haven
gives again any time lives in <config>/.cache/homeslice, which Home Assistant's backups leave
out. All are served at ASSETS_URL to every device. Poly Haven models are downloaded once, the first time a house
uses one (https://polyhaven.com, CC0); custom ones are uploaded in the editor as .glb.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import secrets
import shutil
import struct
import time
from pathlib import Path, PurePosixPath
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from .const import MODEL_DIR
from .glbshrink import MAX_PX, shrink_glb
from .glbsimplify import MAX_TRIANGLES, simplify_glb

# what a stored model was made light for: pictures at most MAX_PX, meshes at most MAX_TRIANGLES
LIGHT = f"{MAX_PX}px/{MAX_TRIANGLES}tri"

_LOGGER = logging.getLogger(__name__)

ASSETS_URL = "/homeslice_assets"
ASSETS_DIR = "assets"
# what Poly Haven gives again any time, kept in CACHE_DIR
CACHE_DIR = ".cache"
DOWNLOADED = ("polyhaven", "textures")

POLYHAVEN_API = "https://api.polyhaven.com"
POLYHAVEN_FILES = "https://dl.polyhaven.org/"
# Poly Haven asks every API client for its own User-Agent
USER_AGENT = "Homeslice (Home Assistant integration; https://github.com/headtr1ck/homeslice)"
# the categories a home and its garden have: furniture, lamps, plants, decoration, things on
# shelves and in the kitchen, garden stones (not buildings, ships or industrial plant)
POLYHAVEN_CATEGORIES = {
    "furniture", "seating", "table", "lighting", "shelves", "bed", "potted plants", "plants", "trees",
    "flowers", "appliances", "decorative", "vases", "wall decoration", "electronics", "office", "books",
    "props", "containers", "dishes", "food", "tools", "instrument", "rocks", "ground cover", "grass",
}
# textures for floors, walls and facades (not roads, terrain or aerial scans)
TEXTURE_CATEGORIES = {
    "floor", "wall", "wood", "brick", "plaster-concrete", "concrete", "tiles", "fabric", "cobblestone",
    "gravel", "plaster", "raw wood", "roofing", "sandstone",
}
TEXTURE_EXCLUDE = {"aerial", "road", "asphalt", "terrain", "snow"}
MAX_TEXTURE_BYTES = 5_000_000
CATALOG_TTL = 24 * 3600
MAX_POLYHAVEN_BYTES = 40_000_000
RESOLUTION = "1k"

# a data: URL of a .glb (the editor reads the file); 12 MB of model at most
MAX_UPLOAD_CHARS = 16_000_000
GLB_PREFIXES = ("data:model/gltf-binary;base64,", "data:application/octet-stream;base64,", "data:;base64,")
ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class AssetError(ValueError):
    """A model that can't be fetched or stored."""


# the only files a Poly Haven model may bring: they are served from Home Assistant's own
# address, so nothing a browser would run (HTML, SVG, scripts)
POLYHAVEN_SUFFIXES = {".gltf", ".bin", ".jpg", ".jpeg", ".png", ".webp"}
# where the names of uploaded models are kept: outside the served folder
CUSTOM_INDEX = "custom_models.json"
# downloads no house uses are removed after a week; what was fetched within the hour is left alone
UNUSED_GRACE = 3600
UNUSED_KEEP = 7 * 24 * 3600


def glb_json(blob: bytes) -> Any:
    """The JSON part of a .glb; AssetError if it isn't one."""
    if len(blob) < 20 or blob[:4] != b"glTF":
        raise AssetError("This is not a .glb file")
    length, kind = struct.unpack_from("<I4s", blob, 12)
    if kind != b"JSON" or 20 + length > len(blob):
        raise AssetError("This is not a .glb file")
    # its header says how long it is: shorter is a download cut off
    if struct.unpack_from("<I", blob, 8)[0] != len(blob):
        raise AssetError("The .glb file is incomplete")
    try:
        return json.loads(blob[20 : 20 + length])
    except ValueError as err:
        raise AssetError("This is not a .glb file") from err


def check_links(gltf: Any, files: bool = False) -> None:
    """Refuse models that load files from elsewhere.

    A glTF's buffers and images may name any URL; the browser of every screen showing the
    house would fetch it (telling a stranger's server when and where the house is shown).
    Only embedded data is allowed, and with `files` files next to the model.
    """
    if not isinstance(gltf, dict):
        raise AssetError("This is not a glTF model")
    for key in ("buffers", "images"):
        for item in gltf.get(key) or []:
            uri = item.get("uri") if isinstance(item, dict) else None
            if uri is None or (isinstance(uri, str) and uri.startswith("data:")):
                continue
            path = PurePosixPath(uri) if isinstance(uri, str) else None
            if not files or path is None or ":" in uri or uri.startswith(("/", "\\")) or "\\" in uri or ".." in path.parts:
                raise AssetError("The model loads files from elsewhere; only self-contained models are allowed")


class Assets:
    """Downloaded and uploaded models."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.root = Path(hass.config.path(MODEL_DIR, ASSETS_DIR))
        # downloads that come back by themselves: out of backups
        self.cache = Path(hass.config.path(CACHE_DIR, "homeslice"))
        self._catalog: tuple[float, list[dict[str, Any]]] | None = None
        self._textures: tuple[float, list[dict[str, Any]]] | None = None
        self._fetching: dict[str, asyncio.Task[None]] = {}
        self._unused_store: Store[dict[str, float]] = Store(hass, 1, "homeslice.unused_assets")

    def ensure_dirs(self) -> None:
        """Create the folders (blocking)."""
        for kind in DOWNLOADED:
            # they used to be next to the uploads, in backups
            old, new = self.root / kind, self.folder(kind)
            new.mkdir(parents=True, exist_ok=True)
            if old.is_dir():
                for item in old.iterdir():
                    if not (new / item.name).exists():
                        shutil.move(item, new / item.name)
                shutil.rmtree(old, ignore_errors=True)
        (self.root / "custom").mkdir(parents=True, exist_ok=True)
        # the index used to live in the served folder, where anyone could read it
        old = self.root / "custom" / "index.json"
        if old.exists() and not self._index_path.exists():
            old.replace(self._index_path)
        old.unlink(missing_ok=True)

    def folder(self, kind: str) -> Path:
        """Where a kind of model is kept: "polyhaven", "textures" or "custom"."""
        return (self.cache if kind in DOWNLOADED else self.root) / kind

    @property
    def _index_path(self) -> Path:
        return self.root.parent / CUSTOM_INDEX

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
        return (self.folder("polyhaven") / asset_id / f"{asset_id}_{RESOLUTION}.gltf").exists()

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
        target = self.folder("polyhaven") / asset_id
        session = async_get_clientsession(self.hass)
        blobs: dict[Path, bytes] = {}
        for rel, url in wanted.items():
            path = PurePosixPath(rel)
            if path.is_absolute() or ".." in path.parts or path.suffix.lower() not in POLYHAVEN_SUFFIXES or not url.startswith(POLYHAVEN_FILES):
                raise AssetError("Unexpected file in the model")
            async with session.get(url, headers={"User-Agent": USER_AGENT}, timeout=120) as resp:
                if resp.status != 200:
                    raise AssetError(f"Poly Haven answered {resp.status}")
                blobs[target / path] = await resp.read()
        try:
            check_links(json.loads(blobs[target / f"{asset_id}_{RESOLUTION}.gltf"]), files=True)
        except ValueError as err:
            raise AssetError(f"Unusable model: {err}") from err

        def write() -> None:
            # the .gltf last: it marks the model as complete
            for path, blob in sorted(blobs.items(), key=lambda kv: kv[0].suffix == ".gltf"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(blob)

        await self.hass.async_add_executor_job(write)
        _LOGGER.info("Downloaded Poly Haven model %s", asset_id)

    async def async_ensure_models(self, model: dict[str, Any]) -> None:
        """Downloads the Poly Haven models and textures a house uses (e.g. one imported from a file)."""
        for asset_id in sorted(polyhaven_refs(model)):
            try:
                await self.async_polyhaven(asset_id)
            except AssetError as err:
                _LOGGER.warning("Could not fetch Poly Haven model %s: %s", asset_id, err)
        for asset_id in sorted(texture_refs(model)):
            try:
                await self.async_texture(asset_id)
            except AssetError as err:
                _LOGGER.warning("Could not fetch Poly Haven texture %s: %s", asset_id, err)

    # ----- Poly Haven textures -----

    async def async_texture_catalog(self) -> list[dict[str, Any]]:
        """Poly Haven's textures for floors, walls and facades (cached for a day)."""
        if self._textures and time.monotonic() - self._textures[0] < CATALOG_TTL:
            return self._textures[1]
        data = await self._get_json(f"{POLYHAVEN_API}/assets?t=textures")
        items = []
        for asset_id, a in data.items():
            categories = [c for c in a.get("categories", []) if not c.startswith("collection:")]
            if not ID.match(asset_id) or not TEXTURE_CATEGORIES.intersection(categories) or TEXTURE_EXCLUDE.intersection(categories):
                continue
            dims = a.get("dimensions") or []
            floor = "floor" in categories or "cobblestone" in categories or "gravel" in categories
            wall = bool({"wall", "brick", "plaster"}.intersection(categories)) or "roofing" in categories
            items.append(
                {
                    "id": asset_id,
                    "name": a.get("name", asset_id),
                    "categories": categories,
                    "tags": a.get("tags", []),
                    # millimetres: what one copy of the texture covers
                    "size": [round(float(v) / 1000, 3) for v in dims[:2]] if len(dims) >= 2 else [2.0, 2.0],
                    "on": ["floor", "wall"] if floor == wall else ["floor"] if floor else ["wall"],
                    "thumbnail": a.get("thumbnail_url"),
                    "downloads": a.get("download_count", 0),
                }
            )
        items.sort(key=lambda i: -i["downloads"])
        self._textures = (time.monotonic(), items)
        return items

    def texture_url(self, asset_id: str) -> str:
        return f"{ASSETS_URL}/textures/{asset_id}/{asset_id}_diff_{RESOLUTION}.jpg"

    async def async_texture(self, asset_id: str) -> dict[str, Any]:
        """Downloads a texture's colour map (once); where it is served and the metres it covers."""
        if not ID.match(asset_id):
            raise AssetError("Not a Poly Haven texture id")
        folder = self.folder("textures") / asset_id
        info = folder / "info.json"

        def read() -> Any:
            return json.loads(info.read_text()) if info.exists() else None

        known = await self.hass.async_add_executor_job(read)
        if known:
            return {"url": self.texture_url(asset_id), "size": known["size"]}
        catalog = {t["id"]: t for t in await self.async_texture_catalog()}
        if asset_id not in catalog:
            raise AssetError("Poly Haven has no such texture")
        files = await self._get_json(f"{POLYHAVEN_API}/files/{asset_id}")
        entry = (files.get("Diffuse") or {}).get(RESOLUTION, {}).get("jpg")
        if not entry or not str(entry.get("url", "")).startswith(POLYHAVEN_FILES):
            raise AssetError("Poly Haven has no colour map of this texture")
        if entry.get("size", 0) > MAX_TEXTURE_BYTES:
            raise AssetError("This texture is too large")
        session = async_get_clientsession(self.hass)
        async with session.get(entry["url"], headers={"User-Agent": USER_AGENT}, timeout=120) as resp:
            if resp.status != 200:
                raise AssetError(f"Poly Haven answered {resp.status}")
            blob = await resp.read()
        if blob[:3] != b"\xff\xd8\xff":
            raise AssetError("This is not a JPEG image")
        size = catalog[asset_id]["size"]

        def write() -> None:
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{asset_id}_diff_{RESOLUTION}.jpg").write_bytes(blob)
            # last: it marks the texture as complete
            info.write_text(json.dumps({"size": size, "name": catalog[asset_id]["name"]}))

        await self.hass.async_add_executor_job(write)
        _LOGGER.info("Downloaded Poly Haven texture %s", asset_id)
        return {"url": self.texture_url(asset_id), "size": size}

    # ----- custom models -----

    def _custom_index(self) -> dict[str, Any]:
        index = self._index_path
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
        check_links(glb_json(blob))
        return await self.async_custom_store(name, blob)

    async def async_custom_store(self, name: str, blob: bytes, meta: dict[str, Any] | None = None, asset_id: str | None = None) -> dict[str, Any]:
        """Keeps a checked .glb under a new, unguessable id (with where it came from, if anywhere);
        or again under its own id (a model downloaded again)."""
        asset_id = asset_id or secrets.token_hex(12)
        name = (name or "Model").strip()[:80] or "Model"

        def write() -> dict[str, Any]:
            # its pictures scaled down first (a 4K texture on a chair is never seen)
            small = _shrunk(blob)
            (self.root / "custom" / f"{asset_id}.glb").write_bytes(small)
            index = self._custom_index()
            index[asset_id] = {"name": name, "bytes": len(small), **(meta or {}), "shrunk": LIGHT}
            index[asset_id].pop("original_bytes", None)
            if len(small) < len(blob):
                index[asset_id]["original_bytes"] = len(blob)
            self._index_path.write_text(json.dumps(index, indent=1))
            return index[asset_id]

        stored = await self.hass.async_add_executor_job(write)
        return {"id": asset_id, "url": f"{ASSETS_URL}/custom/{asset_id}.glb", **stored}

    def incomplete(self) -> list[tuple[str, dict[str, Any]]]:
        """Sketchfab models stored cut off (a download read only partly, before 0.0.21) (blocking)."""
        out = []
        for asset_id, meta in self._custom_index().items():
            path = self.root / "custom" / f"{asset_id}.glb"
            if meta.get("source") != "sketchfab" or not meta.get("uid") or not path.exists():
                continue
            head = path.read_bytes()[:12]
            if len(head) < 12 or struct.unpack_from("<I", head, 8)[0] != path.stat().st_size:
                out.append((asset_id, meta))
        return out

    async def async_shrink_all(self) -> int:
        """Makes models kept before light (fewer triangles, smaller pictures), once; the bytes saved."""

        def shrink() -> int:
            index = self._custom_index()
            saved = 0
            for asset_id, meta in index.items():
                if meta.get("shrunk") == LIGHT:
                    continue
                path = self.root / "custom" / f"{asset_id}.glb"
                if path.exists():
                    blob = path.read_bytes()
                    small = _shrunk(blob)
                    if len(small) < len(blob):
                        path.write_bytes(small)
                        meta.update(bytes=len(small), original_bytes=meta.get("original_bytes", len(blob)))
                        saved += len(blob) - len(small)
                meta["shrunk"] = LIGHT
                # (written after each, so a restart halfway keeps what is done)
                self._index_path.write_text(json.dumps(index, indent=1))
            return saved

        saved = await self.hass.async_add_executor_job(shrink)
        if saved:
            _LOGGER.info("Made downloaded models lighter (fewer triangles, smaller pictures): %.1f MB saved", saved / 1e6)
        return saved

    async def async_custom_delete(self, asset_id: str) -> None:
        if not ID.match(asset_id):
            raise AssetError("Not a model id")

        def remove() -> None:
            (self.root / "custom" / f"{asset_id}.glb").unlink(missing_ok=True)
            index = self._custom_index()
            if index.pop(asset_id, None) is not None:
                self._index_path.write_text(json.dumps(index, indent=1))

        await self.hass.async_add_executor_job(remove)

    # ----- clean-up: by itself -----

    def _unused(self, used: dict[str, set[str]]) -> list[dict[str, Any]]:
        """What was downloaded but no house uses (blocking): Poly Haven models and textures, and
        Sketchfab models. Own uploads are never on it (they cannot be downloaded again), nor
        what was fetched just now (an editor may be about to save it)."""
        out: list[dict[str, Any]] = []
        fresh = time.time() - UNUSED_GRACE
        for kind in ("polyhaven", "textures"):
            base = self.folder(kind)
            for path in sorted(base.iterdir()) if base.is_dir() else []:
                if path.is_dir() and ID.match(path.name) and path.name not in used[kind] and path.stat().st_mtime < fresh:
                    out.append({"kind": kind, "id": path.name})
        for asset_id, meta in self._custom_index().items():
            path = self.root / "custom" / f"{asset_id}.glb"
            if meta.get("source") != "sketchfab" or asset_id in used["custom"] or (path.exists() and path.stat().st_mtime >= fresh):
                continue
            out.append({"kind": "custom", "id": asset_id})
        return out

    async def async_sweep(self, models: list[Any]) -> list[dict[str, Any]]:
        """Notes what no house uses, and removes what has stayed unused for a week (so an undo
        or an unsaved draft still finds it); what was removed."""
        used: dict[str, set[str]] = {"polyhaven": set(), "textures": set(), "custom": set()}
        for model in models:
            for kind, ids in asset_refs(model).items():
                used[kind] |= ids
        unused = await self.hass.async_add_executor_job(self._unused, used)
        marks = await self._unused_store.async_load() or {}
        now = time.time()
        # the marks of what is used again go; new ones start now
        marks = {f"{a['kind']}:{a['id']}": marks.get(f"{a['kind']}:{a['id']}", now) for a in unused}
        gone = [a for a in unused if now - marks[f"{a['kind']}:{a['id']}"] >= UNUSED_KEEP]

        def remove() -> None:
            for a in gone:
                if a["kind"] != "custom":
                    shutil.rmtree(self.folder(a["kind"]) / a["id"], ignore_errors=True)

        await self.hass.async_add_executor_job(remove)
        for a in gone:
            if a["kind"] == "custom":
                await self.async_custom_delete(a["id"])
            marks.pop(f"{a['kind']}:{a['id']}", None)
        await self._unused_store.async_save(marks)
        if gone:
            _LOGGER.info("Removed %d downloaded models and textures no house has used for a week", len(gone))
        return gone


REF = re.compile(r"^(polyhaven|custom):([A-Za-z0-9_-]{1,80})$")


def asset_refs(model: Any) -> dict[str, set[str]]:
    """Every downloaded or uploaded asset a house model names, wherever it does: Poly Haven
    models (furniture `model:`), Poly Haven textures (any finish: floors, walls, roofs, pieces…)
    and the house's own models (`custom:`)."""
    found: dict[str, set[str]] = {"polyhaven": set(), "textures": set(), "custom": set()}

    def walk(value: Any, key: str | None) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                walk(v, k)
        elif isinstance(value, list):
            for v in value:
                walk(v, key)
        elif isinstance(value, str) and (m := REF.match(value)):
            kind, asset_id = m.groups()
            found["custom" if kind == "custom" else "polyhaven" if key == "model" else "textures"].add(asset_id)

    walk(model, None)
    return found


def polyhaven_refs(model: dict[str, Any]) -> set[str]:
    """The Poly Haven models a house model uses."""
    return asset_refs(model)["polyhaven"]


def texture_refs(model: dict[str, Any]) -> set[str]:
    """The Poly Haven textures a house model uses (any finish)."""
    return asset_refs(model)["textures"]


def _shrunk(blob: bytes) -> bytes:
    """The .glb with fewer triangles and its pictures scaled down, still a valid model; else as it was."""
    try:
        small = shrink_glb(simplify_glb(blob, MAX_TRIANGLES), MAX_PX)
        check_links(glb_json(small))
    except Exception as err:  # noqa: BLE001 - a model that can't be shrunk is kept as it is
        _LOGGER.debug("Model kept as it is: %s", err)
        return blob
    return small
