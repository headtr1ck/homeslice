"""Floor plan images under the editor's plan, one per level.

They live in Home Assistant's storage (one file per house, loaded only when the editor
asks), so they are part of backups but never of the house model or any repository.
Only admins can read or change them.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1
# a data: URL; the editor shrinks images before uploading
MAX_IMAGE_CHARS = 8_000_000
IMAGE_PREFIXES = ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")


class UnderlayError(ValueError):
    """An image that can't be stored."""


class Underlays:
    """Underlay images and their placement, per house and level."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._stores: dict[str, Store[dict[str, Any]]] = {}
        self._data: dict[str, dict[str, Any]] = {}

    def _store(self, house_id: str) -> Store[dict[str, Any]]:
        if house_id not in self._stores:
            self._stores[house_id] = Store(self.hass, STORAGE_VERSION, f"{DOMAIN}.underlay.{house_id}")
        return self._stores[house_id]

    async def _levels(self, house_id: str) -> dict[str, Any]:
        if house_id not in self._data:
            data = await self._store(house_id).async_load() or {}
            self._data[house_id] = data.get("levels", {})
        return self._data[house_id]

    async def async_get(self, house_id: str, level_id: str) -> dict[str, Any] | None:
        """The level's image and placement, or None."""
        return (await self._levels(house_id)).get(level_id)

    async def async_list(self, house_id: str) -> list[str]:
        """Levels that have an image."""
        return sorted(await self._levels(house_id))

    async def async_set(self, house_id: str, level_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        """Store a new image and/or placement for a level."""
        levels = await self._levels(house_id)
        current = dict(levels.get(level_id, {}))
        if "image" in patch:
            image = patch["image"]
            if not isinstance(image, str) or not image.startswith(IMAGE_PREFIXES):
                raise UnderlayError("The image must be a PNG, JPEG or WebP data URL")
            if len(image) > MAX_IMAGE_CHARS:
                raise UnderlayError("The image is too large; use a smaller one")
        current.update(patch)
        if "image" not in current:
            raise UnderlayError("Upload an image first")
        levels[level_id] = current
        await self._store(house_id).async_save({"levels": levels})
        return current

    async def async_delete(self, house_id: str, level_id: str | None = None) -> None:
        """Remove one level's image, or all of a house's."""
        levels = await self._levels(house_id)
        if level_id is None:
            levels.clear()
            await self._store(house_id).async_remove()
            return
        if levels.pop(level_id, None) is not None:
            await self._store(house_id).async_save({"levels": levels})
