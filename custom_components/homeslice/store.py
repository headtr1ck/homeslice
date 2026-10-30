"""House models in Home Assistant's storage (included in HA backups)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
import logging
import re
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.yaml import load_yaml

from .const import DOMAIN, MODEL_DIR

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
HOUSE_ID = re.compile(r"^[a-z0-9_]+$")

Listener = Callable[[str, dict[str, Any] | None], None]


class ModelError(HomeAssistantError):
    """A model that can't be stored."""


def check_model(model: Any) -> dict[str, Any]:
    """Minimal structural check; the frontend validates the details with fix-it messages."""
    if not isinstance(model, dict):
        raise ModelError("The house model must be a mapping")
    if model.get("schema") != 1:
        raise ModelError(f"Unsupported schema {model.get('schema')!r}; expected 1")
    if not isinstance(model.get("levels"), list) or not model["levels"]:
        raise ModelError("A house needs at least one level")
    return model


@dataclass
class HomesliceStore:
    """All houses, keyed by house id."""

    hass: HomeAssistant
    store: Store[dict[str, Any]] = field(init=False)
    houses: dict[str, dict[str, Any]] = field(default_factory=dict)
    _listeners: list[Listener] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.store = Store(self.hass, STORAGE_VERSION, DOMAIN)

    async def async_load(self) -> None:
        """Load stored houses."""
        data = await self.store.async_load() or {}
        self.houses = data.get("houses", {})

    def _data(self) -> dict[str, Any]:
        return {"houses": self.houses}

    @callback
    def async_listen(self, listener: Listener) -> Callable[[], None]:
        """Call `listener(house_id, model_or_None)` on every change."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)

    def get(self, house_id: str) -> dict[str, Any] | None:
        """The stored model of a house."""
        house = self.houses.get(house_id)
        return house["model"] if house else None

    def summary(self) -> list[dict[str, Any]]:
        """Houses for listings."""
        return [
            {
                "id": house_id,
                "name": house["model"].get("name", house_id),
                "updated": house["updated"],
                "source": house["source"],
            }
            for house_id, house in sorted(self.houses.items())
        ]

    async def async_save(self, house_id: str, model: Any, source: str) -> None:
        """Store a model and notify listeners."""
        if not HOUSE_ID.match(house_id):
            raise ModelError(f"Invalid house id {house_id!r}: use lower-case letters, digits and _")
        check_model(model)
        self.houses[house_id] = {"model": model, "updated": dt_util.utcnow().isoformat(), "source": source}
        await self.store.async_save(self._data())
        for listener in list(self._listeners):
            listener(house_id, model)

    async def async_delete(self, house_id: str) -> None:
        """Remove a house."""
        if self.houses.pop(house_id, None) is None:
            return
        await self.store.async_save(self._data())
        for listener in list(self._listeners):
            listener(house_id, None)

    async def async_import_files(self, force: bool = False) -> list[str]:
        """Import every <config>/homeslice/*.yaml; the file name is the house id.

        Houses last saved in the editor are skipped unless `force`, so a file never
        silently overwrites editor changes.
        """
        directory = Path(self.hass.config.path(MODEL_DIR))
        files = await self.hass.async_add_executor_job(
            lambda: sorted(directory.glob("*.yaml")) if directory.is_dir() else []
        )
        imported = []
        for path in files:
            house_id = path.stem
            current = self.houses.get(house_id)
            if current and current["source"] == "api" and not force:
                _LOGGER.warning("Not importing %s: the house was edited in the editor (use force)", path.name)
                continue
            try:
                model = await self.hass.async_add_executor_job(load_yaml, str(path))
                await self.async_save(house_id, model, f"file:{path.name}")
            except (HomeAssistantError, ModelError) as err:
                _LOGGER.error("Could not import %s: %s", path, err)
                continue
            imported.append(house_id)
        return imported
