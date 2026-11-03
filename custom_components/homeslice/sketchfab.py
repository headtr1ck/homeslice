"""Sketchfab models, with the user's own API token (https://sketchfab.com/settings/password).

Search lists the models the user may download: free ones of any licence and the ones they
bought (the download API says which: it hands out files only for those). A fetched model
becomes one of the house's own models (custom), with where it came from, its author and its
licence, so the editor can credit it and a backup can say what may not be passed on.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from .assets import USER_AGENT, AssetError, Assets, check_links, glb_json

_LOGGER = logging.getLogger(__name__)

API = "https://api.sketchfab.com/v3"
# where the download API's files live (the token is never sent there)
FILE_HOSTS = ("sketchfab-prod-media.s3.amazonaws.com", "media.sketchfab.com")
MAX_BYTES = 40_000_000
STORE_KEY = "homeslice.sketchfab"
# licences that let a file be passed on (with credit where they ask); the rest, and models
# bought in the store, are for this home only
SHAREABLE = {"cc0", "by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"}


# search results name a licence by its label only (a model's own page has the slug too)
SLUGS = {
    "cc0 public domain": "cc0",
    "cc attribution": "by",
    "cc attribution-sharealike": "by-sa",
    "cc attribution-noderivs": "by-nd",
    "cc attribution-noncommercial": "by-nc",
    "cc attribution-noncommercial-sharealike": "by-nc-sa",
    "cc attribution-noncommercial-noderivs": "by-nc-nd",
    "free standard": "free-st",
    "standard": "st",
    "editorial": "ed",
}


def licence_of(model: dict[str, Any]) -> dict[str, Any]:
    """The licence of a model as the API gives it: slug, label, link; a model with none was bought in the store."""
    lic = model.get("license") or {}
    label = str(lic.get("label") or "") if isinstance(lic, dict) else ""
    slug = (lic.get("slug") if isinstance(lic, dict) else None) or SLUGS.get(label.lower())
    if not slug and not label:
        return {"slug": "store", "label": "Bought on Sketchfab", "url": None}
    return {"slug": str(slug or "other"), "label": label or str(slug), "url": lic.get("url") if isinstance(lic, dict) else None}


class Sketchfab:
    """The user's Sketchfab token, search and downloads."""

    def __init__(self, hass: HomeAssistant, assets: Assets) -> None:
        self.hass = hass
        self.assets = assets
        self._store: Store[dict[str, Any]] = Store(hass, 1, STORE_KEY)
        self._data: dict[str, Any] | None = None

    async def _load(self) -> dict[str, Any]:
        if self._data is None:
            self._data = await self._store.async_load() or {}
        return self._data

    async def async_status(self) -> dict[str, Any]:
        """Whether a token is set, and whose (never the token itself)."""
        data = await self._load()
        return {"configured": bool(data.get("token")), "username": data.get("username")}

    async def _get(self, path: str, token: str, params: dict[str, Any] | None = None) -> Any:
        session = async_get_clientsession(self.hass)
        async with session.get(f"{API}{path}", params=params, headers={"Authorization": f"Token {token}", "User-Agent": USER_AGENT}, timeout=30) as resp:
            if resp.status in (401, 403):
                raise AssetError("Sketchfab refused: check the API token" if path == "/me" else "Sketchfab does not let this account download this model")
            if resp.status != 200:
                raise AssetError(f"Sketchfab answered {resp.status}")
            return await resp.json(content_type=None)

    async def async_set_token(self, token: str | None) -> dict[str, Any]:
        """Checks a token with Sketchfab and keeps it (None forgets it)."""
        data = await self._load()
        if not token:
            data.clear()
        else:
            token = token.strip()
            me = await self._get("/me", token)
            data.update({"token": token, "username": me.get("username")})
        await self._store.async_save(data)
        return await self.async_status()

    async def _token(self) -> str:
        token = (await self._load()).get("token")
        if not token:
            raise AssetError("Add a Sketchfab API token first")
        return token

    async def async_repair(self) -> int:
        """Downloads again the models stored cut off; how many. Needs the token (else later)."""
        broken = await self.hass.async_add_executor_job(self.assets.incomplete)
        if not broken:
            return 0
        if not (await self._load()).get("token"):
            _LOGGER.warning("%d Sketchfab models were stored incomplete; add the Sketchfab token in the editor to download them again", len(broken))
            return 0
        fixed = 0
        for asset_id, meta in broken:
            try:
                await self.async_fetch(meta["uid"], asset_id)
                fixed += 1
            except AssetError as err:
                _LOGGER.warning("Sketchfab model %s could not be downloaded again: %s", meta.get("name"), err)
        if fixed:
            _LOGGER.info("Downloaded %d incomplete Sketchfab models again", fixed)
        return fixed

    async def async_search(self, query: str, cursor: str | None = None) -> dict[str, Any]:
        """Downloadable models for a query, smallest download first in each page; the next page's cursor."""
        params: dict[str, Any] = {"type": "models", "downloadable": "true", "q": query[:100], "count": 24}
        if cursor:
            params["cursor"] = cursor
        data = await self._get("/search", await self._token(), params)
        items = []
        for m in data.get("results", []):
            glb = (m.get("archives") or {}).get("glb") or {}
            thumbs = sorted((m.get("thumbnails") or {}).get("images", []), key=lambda t: abs(t.get("width", 0) - 256))
            items.append(
                {
                    "uid": m.get("uid"),
                    "name": m.get("name"),
                    "author": (m.get("user") or {}).get("displayName"),
                    "licence": licence_of(m),
                    "faces": m.get("faceCount"),
                    "bytes": glb.get("size"),
                    "thumbnail": thumbs[0]["url"] if thumbs else None,
                    "url": m.get("viewerUrl"),
                }
            )
        nxt = data.get("cursors", {}).get("next")
        return {"results": items, "next": nxt}

    async def async_fetch(self, uid: str, asset_id: str | None = None) -> dict[str, Any]:
        """Downloads a model's .glb into the house's own models, with its author and licence
        (under its own id again, when given: a model downloaded again)."""
        if not isinstance(uid, str) or not uid.isalnum() or len(uid) > 64:
            raise AssetError("Not a Sketchfab model id")
        token = await self._token()
        model = await self._get(f"/models/{uid}", token)
        files = await self._get(f"/models/{uid}/download", token)
        glb = files.get("glb") or {}
        url = glb.get("url", "")
        if urlparse(url).scheme != "https" or urlparse(url).hostname not in FILE_HOSTS:
            raise AssetError("Sketchfab has no .glb of this model")
        if glb.get("size", 0) > MAX_BYTES:
            raise AssetError("This model is too large (40 MB at most)")
        session = async_get_clientsession(self.hass)
        async with session.get(url, headers={"User-Agent": USER_AGENT}, timeout=300) as resp:
            if resp.status != 200:
                raise AssetError(f"Sketchfab answered {resp.status}")
            # all of it (a single read gives what has arrived so far), not more than the limit
            data = bytearray()
            async for chunk in resp.content.iter_chunked(1 << 16):
                data += chunk
                if len(data) > MAX_BYTES:
                    raise AssetError("This model is too large (40 MB at most)")
            blob = bytes(data)
        check_links(glb_json(blob))
        lic = licence_of(model)
        user = model.get("user") or {}
        thumbs = sorted((model.get("thumbnails") or {}).get("images", []), key=lambda t: abs(t.get("width", 0) - 256))
        meta = {
            "source": "sketchfab",
            "uid": uid,
            "author": user.get("displayName") or user.get("username"),
            "author_url": user.get("profileUrl"),
            # its page on Sketchfab (url is where Home Assistant serves the file)
            "page": model.get("viewerUrl"),
            # its picture in the editor's list (from Sketchfab, like the search results')
            "thumbnail": thumbs[0].get("url") if thumbs else None,
            "licence": lic,
            # bought ones are for this home only; CC ones may be passed on as their licence says
            "shareable": lic["slug"] in SHAREABLE,
        }
        stored = await self.assets.async_custom_store(model.get("name") or "Sketchfab model", blob, meta, asset_id)
        _LOGGER.info("Downloaded Sketchfab model %s", uid)
        return stored
