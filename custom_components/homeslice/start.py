"""The editor's start screen, kept in Home Assistant: its choices, and robot maps caught live.

Some robots show their map only while they work. "Map it live" asks Home Assistant to watch
the robot's map picture for a floor: every new picture is kept, until the robot is back at
its dock (or after a few hours). This runs with the editor closed; the editor shows what
was caught whenever it is opened again, on any device.
"""

from __future__ import annotations

import base64
from datetime import timedelta
import logging
import time
from typing import Any

from homeassistant.core import CALLBACK_TYPE, Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

STORE_KEY = "homeslice.start"
# the start screen's choices (with its pictures) at most
MAX_STATE_CHARS = 20_000_000
# a watch ends by itself after this long
WATCH_HOURS = 6
# the robot is home: the map is complete
HOME_STATES = {"docked", "charging", "idle"}
WORKING_STATES = {"cleaning", "returning", "paused"}


class StartError(ValueError):
    """Not a map, or too much to keep."""


class Start:
    """The start screen's state and its live map captures."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, 1, STORE_KEY)
        self._data: dict[str, Any] | None = None
        self._unsubs: dict[str, list[CALLBACK_TYPE]] = {}
        self._pending: dict[str, CALLBACK_TYPE] = {}

    async def _load(self) -> dict[str, Any]:
        if self._data is None:
            self._data = await self._store.async_load() or {}
            self._data.setdefault("state", None)
            self._data.setdefault("captures", {})
            self._data.setdefault("watches", {})
        return self._data

    async def async_setup(self) -> None:
        """Watches running before a restart go on."""
        data = await self._load()
        for floor, w in list(data["watches"].items()):
            if time.time() - w.get("since", 0) > WATCH_HOURS * 3600:
                del data["watches"][floor]
            else:
                self._follow(floor, w["map"], w.get("robot"))

    def async_unload(self) -> None:
        for floor in list(self._unsubs):
            self._unfollow(floor)

    async def async_get(self) -> dict[str, Any]:
        """The start screen as it was left, the maps caught, the watches running."""
        data = await self._load()
        return {"state": data["state"], "captures": data["captures"], "watches": data["watches"]}

    async def async_set_state(self, state: dict[str, Any] | None) -> None:
        data = await self._load()
        if state is not None and len(str(state)) > MAX_STATE_CHARS:
            raise StartError("Too many pictures to keep: remove some")
        data["state"] = state
        self._store.async_delay_save(lambda: data, 2)

    async def async_clear(self) -> None:
        """Done with the start (the house made, or the start cancelled): all of it goes."""
        data = await self._load()
        for floor in list(data["watches"]):
            self._unfollow(floor)
        data.update({"state": None, "captures": {}, "watches": {}})
        await self._store.async_save(data)

    def _robot_of(self, map_entity: str) -> str | None:
        reg = er.async_get(self.hass)
        entry = reg.async_get(map_entity)
        if not entry or not entry.device_id:
            return None
        return next((e.entity_id for e in er.async_entries_for_device(reg, entry.device_id) if e.domain in ("vacuum", "lawn_mower")), None)

    async def async_watch(self, floor: str, map_entity: str) -> dict[str, Any]:
        """Keeps every new picture of the map for `floor` until the robot is home again."""
        if not map_entity.startswith("image."):
            raise StartError("Not a map picture")
        data = await self._load()
        robot = self._robot_of(map_entity)
        data["watches"][floor] = {"map": map_entity, "robot": robot, "since": time.time(), "worked": False}
        self._unfollow(floor)
        self._follow(floor, map_entity, robot)
        await self._store.async_save(data)
        # a picture showing already: kept at once
        state = self.hass.states.get(map_entity)
        if state and state.state not in ("unknown", "unavailable"):
            await self._grab(floor, map_entity)
        return await self.async_get()

    async def async_stop(self, floor: str, drop: bool = False) -> None:
        """Stops watching a floor's map (`drop`: and forgets what was caught)."""
        data = await self._load()
        self._unfollow(floor)
        data["watches"].pop(floor, None)
        if drop:
            data["captures"].pop(floor, None)
        await self._store.async_save(data)

    async def async_capture(self, floor: str, map_entity: str) -> dict[str, Any]:
        """Keeps the map's picture as it is now, for `floor`."""
        if not map_entity.startswith("image."):
            raise StartError("Not a map picture")
        if not await self._grab(floor, map_entity, done=True):
            raise StartError("The robot's map isn't showing right now")
        return await self.async_get()

    def _follow(self, floor: str, map_entity: str, robot: str | None) -> None:
        @callback
        def changed(event: Event[EventStateChangedData]) -> None:
            new = event.data["new_state"]
            if new is None:
                return
            if event.data["entity_id"] == map_entity:
                if new.state in ("unknown", "unavailable"):
                    return
                # a new picture: fetched a moment later (it changes often while the robot drives)
                if floor not in self._pending:
                    self._pending[floor] = async_call_later(self.hass, timedelta(seconds=5), fetch)
            elif new.state in WORKING_STATES:
                self._mark_worked(floor)
            elif new.state in HOME_STATES and self._worked(floor):
                # home again after working: the last picture is the floor's map
                self.hass.async_create_background_task(self._finish(floor, map_entity), f"homeslice map {floor}")

        @callback
        def fetch(_now: Any) -> None:
            self._fetch_later(floor, map_entity)

        @callback
        def give_up(_now: Any) -> None:
            self.hass.async_create_background_task(self.async_stop(floor), "homeslice watch end")

        entities = [map_entity, *([robot] if robot else [])]
        self._unsubs[floor] = [async_track_state_change_event(self.hass, entities, changed)]
        self._unsubs[floor].append(async_call_later(self.hass, timedelta(hours=WATCH_HOURS), give_up))

    def _unfollow(self, floor: str) -> None:
        for unsub in self._unsubs.pop(floor, []):
            unsub()
        if pending := self._pending.pop(floor, None):
            pending()

    def _worked(self, floor: str) -> bool:
        return bool((self._data or {}).get("watches", {}).get(floor, {}).get("worked"))

    def _mark_worked(self, floor: str) -> None:
        w = (self._data or {}).get("watches", {}).get(floor)
        if w and not w.get("worked"):
            w["worked"] = True
            self._store.async_delay_save(lambda: self._data or {}, 5)

    def _fetch_later(self, floor: str, map_entity: str) -> None:
        self._pending.pop(floor, None)
        self.hass.async_create_background_task(self._grab(floor, map_entity), f"homeslice map {floor}")

    async def _finish(self, floor: str, map_entity: str) -> None:
        await self._grab(floor, map_entity, done=True)
        await self.async_stop(floor)

    async def _grab(self, floor: str, map_entity: str, done: bool = False) -> bool:
        from homeassistant.components.image import async_get_image

        try:
            image = await async_get_image(self.hass, map_entity)
        except Exception as err:  # noqa: BLE001 - the picture may be gone again
            _LOGGER.debug("No picture of %s: %s", map_entity, err)
            return False
        data = await self._load()
        data["captures"][floor] = {
            "source": map_entity,
            "data": f"data:{image.content_type};base64,{base64.b64encode(image.content).decode()}",
            "at": time.time(),
            "done": done,
        }
        self._store.async_delay_save(lambda: data, 5)
        return True
