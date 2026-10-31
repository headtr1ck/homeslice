"""The house file's rules, in Python: what the editor checks (frontend/model/expand.ts),
so a house saved through the API or by an AI assistant is checked the same way.

The rules, their order and their messages follow expand.ts exactly; a test runs both on
the same cases (tests/validation_cases.json) so they can't drift apart. Only geometry
the editor merely warns about (e.g. a façade window with no room behind it) is left out.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from functools import cache
from pathlib import Path
from typing import Any

MISSING: Any = object()
"""A key that isn't there (JavaScript's undefined), unlike an explicit null."""

TEXTURE_REF = re.compile(r"^polyhaven:[A-Za-z0-9_-]+$")
FLOOR_HINT = "a floor finish like wood, oak_herringbone or tile_white (see the catalogue) or polyhaven:<texture>"
WALL_HINT = "a wall finish like paint_white, acoustic_oak or brick_red (see the catalogue) or polyhaven:<texture>"
MODEL_REF = re.compile(r"^(builtin|(kenney|polyhaven|custom|modern):[A-Za-z0-9_-]+)$")
SIDES = ["north", "south", "east", "west"]
ENERGY_KINDS = ["solar", "battery", "grid", "inverter", "device"]


@cache
def catalog() -> dict[str, Any]:
    """Furniture types, models and kinds (written from the frontend by scripts/catalog.mjs)."""
    return json.loads((Path(__file__).parent / "catalog.json").read_text(encoding="utf-8"))


# ----- JavaScript's semantics, so values and messages come out the same -----


def get(obj: Any, key: Any) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, MISSING)
    if isinstance(obj, list) and isinstance(key, int) and 0 <= key < len(obj):
        return obj[key]
    return MISSING


def nullish(value: Any, default: Any) -> Any:
    """`value ?? default`"""
    return default if value is MISSING or value is None else value


def truthy(v: Any) -> bool:
    if v is MISSING or v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not math.isnan(v)
    if isinstance(v, str):
        return v != ""
    return True


def num(v: Any) -> float:
    """A value as JavaScript compares it with a number (NaN if it can't be one)."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if v is None:
        return 0.0
    if isinstance(v, str):
        try:
            return float(v.strip() or 0)
        except ValueError:
            return math.nan
    return math.nan


def is_num(v: Any) -> bool:
    """`typeof v === "number"`"""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def js_num(x: float) -> str:
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if float(x).is_integer() and abs(x) < 1e21:
        return str(int(x))
    return repr(float(x))


def text(v: Any) -> str:
    """`${v}` in a template string."""
    if v is MISSING:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if is_num(v):
        return js_num(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if x is None or x is MISSING else text(x) for x in v)
    return "[object Object]"


def stringify(v: Any) -> str:
    """`JSON.stringify(v)` (undefined becomes "undefined")."""
    if v is MISSING:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if is_num(v):
        return js_num(v) if math.isfinite(v) else "null"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join("null" if x is MISSING else stringify(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{json.dumps(str(k), ensure_ascii=False)}:{stringify(x)}" for k, x in v.items() if x is not MISSING) + "}"
    return "null"


def join(values: Any, sep: str = ", ") -> str:
    """`values.join(sep)`: missing values become empty text."""
    return sep.join("" if v is None or v is MISSING else text(v) for v in values)


def fixed(x: float, digits: int) -> str:
    """`x.toFixed(digits)`"""
    return f"{x:.{digits}f}"


def items(v: Any) -> list[Any]:
    """`(v ?? [])` for a forEach: a list, else nothing."""
    return v if isinstance(v, list) else []


def slug(t: str) -> str:
    s = unicodedata.normalize("NFKD", t.lower())
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s or "item"


# ----- the rules -----


def validate(house: Any) -> list[dict[str, str]]:
    """The house file's issues: [{severity: error|warning, path, message}]."""
    issues: list[dict[str, str]] = []

    def err(path: str, message: str) -> None:
        issues.append({"severity": "error", "path": path, "message": message})

    def warn(path: str, message: str) -> None:
        issues.append({"severity": "warning", "path": path, "message": message})

    if not isinstance(house, dict):
        err("", "The house file is empty or not a mapping.")
        return issues
    h = house
    if get(h, "schema") != 1 or isinstance(get(h, "schema"), bool):
        err("schema", f"Unsupported schema {stringify(get(h, 'schema'))}; expected 1.")
    levels_in = get(h, "levels")
    if not isinstance(levels_in, list) or not levels_in:
        err("levels", "A house needs at least one level.")
        return issues

    grid = get(h, "grid")

    def coord(c: Any, axis: str, path: str) -> float:
        if is_num(c):
            return float(c)
        axis_grid = get(grid, axis)
        v = get(axis_grid, c) if isinstance(c, str) else MISSING
        if v is MISSING:
            known = list(axis_grid.keys()) if isinstance(axis_grid, dict) else []
            err(path, f'Unknown grid {axis} axis "{text(c)}"' + (f" (known: {', '.join(known)})." if known else "; no grid defined."))
            return 0.0
        return num(v)

    def shape(s: Any, path: str) -> list[tuple[float, float]] | None:
        if not truthy(s):
            return None
        rect = get(s, "rect")
        polygon = get(s, "polygon")
        if truthy(rect) and truthy(polygon):
            warn(path, "Both rect and polygon given; using polygon.")
        if truthy(polygon):
            if not isinstance(polygon, list) or len(polygon) < 3:
                err(f"{path}.polygon", "A polygon needs at least 3 points.")
                return None
            pts = []
            for i, p in enumerate(polygon):
                x, y = get(p, 0), get(p, 1)
                pts.append((coord(x, "x", f"{path}.polygon[{i}]"), coord(y, "y", f"{path}.polygon[{i}]")))
            area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2
            if abs(area) < 1e-6:
                err(f"{path}.polygon", "The polygon has no area (points on one line?).")
                return None
            return pts
        if truthy(rect):
            x, y, w, d = (get(rect, i) for i in range(4))
            if not (num(w) > 0 and num(d) > 0):
                err(f"{path}.rect", f"Width and depth must be positive, got {text(w)} × {text(d)}.")
                return None
            x0, y0 = coord(x, "x", f"{path}.rect"), coord(y, "y", f"{path}.rect")
            return [(x0, y0), (x0 + num(w), y0), (x0 + num(w), y0 + num(d)), (x0, y0 + num(d))]
        return None

    def bbox(pts: list[tuple[float, float]]) -> tuple[tuple[float, float], tuple[float, float]]:
        xs = [p[0] for p in pts] or [0.0]
        ys = [p[1] for p in pts] or [0.0]
        return (min(xs), min(ys)), (max(xs), max(ys))

    furniture_types = catalog()["furniture_types"]
    opening_types = catalog()["opening_types"]
    house_outline = shape(get(h, "outline"), "outline")
    floor_finishes = catalog()["floor_finishes"]
    wall_finishes = catalog()["wall_finishes"]

    def finish_ok(v: Any, allowed: list[str]) -> bool:
        return isinstance(v, str) and (v in allowed or bool(TEXTURE_REF.match(v)))

    facade = get(h, "facade")
    if facade is not MISSING and not finish_ok(facade, wall_finishes):
        err("facade", f"facade must be {WALL_HINT}, got {stringify(facade)}.")

    level_ids: set[Any] = set()
    levels: list[dict[str, Any]] = []
    for index, li in enumerate(levels_in):
        lid = get(li, "id")
        lp = f"levels.{text(nullish(lid, index))}"
        if not truthy(lid):
            err(lp, "Every level needs an id.")
        if not isinstance(lid, (dict, list)) and lid in level_ids:
            err(lp, f'Duplicate level id "{text(lid)}".')
        if not isinstance(lid, (dict, list)):
            level_ids.add(lid)

        room_ids: list[Any] = []
        for i, ri in enumerate(items(get(li, "rooms"))):
            rid = get(ri, "id")
            rp = f"{lp}.rooms.{text(nullish(rid, i))}"
            if not truthy(rid):
                err(rp, "Every room needs an id.")
                continue
            if rid in room_ids:
                err(rp, f'Duplicate room id "{text(rid)}" on this level.')
            else:
                room_ids.append(rid)
            polygon = shape(ri, rp)
            if not polygon:
                if not truthy(get(ri, "rect")) and not truthy(get(ri, "polygon")):
                    err(rp, "A room needs rect: [x, y, width, depth] or polygon: [[x, y], …].")
                continue
            floor = get(ri, "floor")
            if floor is not MISSING and not finish_ok(floor, floor_finishes):
                err(f"{rp}.floor", f"floor must be {FLOOR_HINT}, got {stringify(floor)}.")
            wall = get(ri, "wall")
            if wall is not MISSING and not finish_ok(wall, wall_finishes):
                err(f"{rp}.wall", f"wall must be {WALL_HINT}, got {stringify(wall)}.")
            wall_sides = get(ri, "wall_sides")
            if wall_sides is not MISSING:
                if not isinstance(wall_sides, dict) or not wall_sides:
                    if not isinstance(wall_sides, dict):
                        err(f"{rp}.wall_sides", "wall_sides must map sides to finishes, e.g. {north: acoustic_oak}.")
                else:
                    for side, v in wall_sides.items():
                        if side not in SIDES:
                            err(f"{rp}.wall_sides", f'Unknown side "{text(side)}" (north, south, east or west).')
                        elif not finish_ok(v, wall_finishes):
                            err(f"{rp}.wall_sides.{text(side)}", f"A wall side must be {WALL_HINT}, got {stringify(v)}.")
            for j, light in enumerate(items(get(ri, "lights"))):
                entity = get(light, "entity")
                if not isinstance(entity, str) or not entity.startswith("light."):
                    err(f"{rp}.lights.{j}", f"A light needs entity: light.…, got {stringify(entity)}.")
                    continue
                at = get(light, "at")
                if at is not MISSING and not (isinstance(at, list) and len(at) == 2 and all(is_num(v) for v in at)):
                    err(f"{rp}.lights.{j}", "at must be [metres east, metres south] of the room's north-west corner.")
            for j, fi in enumerate(items(get(ri, "furniture"))):
                fp = f"{rp}.furniture.{j}"
                ftype = get(fi, "type")
                definition = furniture_types.get(ftype) if isinstance(ftype, str) else None
                if not definition:
                    err(fp, f"type must be one of {', '.join(furniture_types)}, got {stringify(ftype)}.")
                    continue
                at = get(fi, "at")
                if not isinstance(at, list) or len(at) != 2:
                    err(fp, "at must be [metres east, metres south] of the room's north-west corner (the piece's centre).")
                    continue
                size = nullish(get(fi, "size"), definition["size"])
                if not (num(get(size, 0)) > 0 and num(get(size, 1)) > 0):
                    err(fp, "size must be [width, depth] in metres.")
                    continue
                mount = nullish(get(fi, "mount"), definition.get("mount", "floor"))
                if mount not in ("floor", "wall", "ceiling"):
                    err(fp, f"mount must be floor, wall or ceiling, got {stringify(get(fi, 'mount'))}.")
                    continue
                height = get(fi, "height")
                if height is not MISSING and not (is_num(height) and height > 0):
                    err(fp, "height must be in metres.")
                    continue
                model = get(fi, "model")
                if model is not MISSING and not (isinstance(model, str) and MODEL_REF.match(model)):
                    err(fp, f"model must be modern:<kind>, polyhaven:<id>, custom:<id> or builtin, got {stringify(model)}.")
                    continue
                finish = get(fi, "finish")
                if finish is not MISSING and not isinstance(finish, str):
                    err(fp, "finish must be a name like oak, white or grey.")
                    continue
                accent = get(fi, "accent")
                if accent is not MISSING and not isinstance(accent, str):
                    err(fp, "accent must be a name like black, brass or oak.")
                    continue

        for i, oi in enumerate(items(get(li, "openings"))):
            op = f"{lp}.openings[{i}]"
            room = get(oi, "room")
            if room not in room_ids or isinstance(room, (dict, list)):
                err(op, f'Unknown room "{text(room)}" (rooms on this level: {join(room_ids)}).')
                continue
            side = get(oi, "side")
            if side not in SIDES:
                err(op, f'side must be one of {", ".join(SIDES)}, got "{text(side)}".')
                continue
            otype = nullish(get(oi, "type"), "window")
            if otype not in opening_types:
                err(op, f'type must be one of {", ".join(opening_types)}, got "{text(otype)}".')
                continue
            if not num(get(oi, "width")) > 0:
                err(op, "width must be positive.")
                continue

        for i, wi in enumerate(items(get(li, "walls"))):
            wp = f"{lp}.walls[{i}]"
            between = get(wi, "between")
            if truthy(between):
                pair = between if isinstance(between, list) else []
                unknown = [r for r in pair if r not in room_ids]
                if len(pair) != 2 or unknown:
                    err(wp, f"between needs two rooms of this level (unknown: {join(unknown) or 'none'}; rooms: {join(room_ids)}).")
                    continue
                wside = get(wi, "side")
                if truthy(wside) and wside not in SIDES:
                    err(wp, f'side must be one of {", ".join(SIDES)}, got "{text(wside)}".')
                    continue
                thickness = get(wi, "thickness")
                if nullish(get(wi, "type"), "open") != "open" and thickness is not MISSING and not (0 < num(thickness) < 2):
                    err(wp, f"thickness is in metres, e.g. 0.12; got {text(thickness)}.")
                continue
            line = get(wi, "line")
            if truthy(line):
                a, b = get(line, 0), get(line, 1)
                pa = (coord(get(a, 0), "x", wp), coord(get(a, 1), "y", wp))
                pb = (coord(get(b, 0), "x", wp), coord(get(b, 1), "y", wp))
                if math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 0.05:
                    err(wp, "A wall line needs two different points.")
                continue
            err(wp, "A wall entry needs between: [room, room] or line: [[x, y], [x, y]].")

        outline = shape(get(li, "outline"), f"{lp}.outline") or house_outline
        if not outline:
            err(lp, "No outline: set outline on the house (shared by all levels) or on this level.")
        include = get(li, "include_floors")
        if include is not MISSING and not (isinstance(include, list) and all(isinstance(f, str) for f in include)):
            err(f"{lp}.include_floors", "include_floors must be a list of Home Assistant floor ids.")
        levels.append({"id": lid, "index": index})

    level_index = {lvl["id"]: lvl["index"] for lvl in levels if not isinstance(lvl["id"], (dict, list))}

    for i, fi in enumerate(items(get(h, "facade_openings"))):
        fp = f"facade_openings[{text(nullish(get(fi, 'id'), i))}]"
        side = get(fi, "side")
        if side not in SIDES:
            err(fp, f'side must be one of {", ".join(SIDES)}, got "{text(side)}".')
            continue
        if not num(get(fi, "width")) > 0:
            err(fp, "width must be positive.")
            continue
        otype = nullish(get(fi, "type"), "window")
        if otype not in opening_types:
            err(fp, f'type must be one of {", ".join(opening_types)}, got "{text(otype)}".')
            continue
        for level_id in items(get(fi, "levels")):
            if isinstance(level_id, (dict, list)) or level_id not in level_index:
                err(fp, f'Unknown level "{text(level_id)}" (levels: {join(lvl["id"] for lvl in levels)}).')

    for i, vi in enumerate(items(get(h, "vertical"))):
        vp = f"vertical.{text(nullish(get(vi, 'id'), i))}"
        polygon = shape(vi, vp)
        vfrom, vto = get(vi, "from"), get(vi, "to")
        frm = level_index.get(vfrom) if not isinstance(vfrom, (dict, list)) else None
        to = level_index.get(vto) if not isinstance(vto, (dict, list)) else None
        if frm is None:
            err(vp, f'Unknown level "{text(vfrom)}" in from.')
        if to is None:
            err(vp, f'Unknown level "{text(vto)}" in to.')
        if not truthy(get(vi, "rect")) and not truthy(get(vi, "polygon")):
            err(vp, "Stairs need rect: [x, y, width, depth] or polygon: [[x, y], …].")
        if not polygon or frm is None or to is None:
            continue
        if to <= frm:
            err(vp, "to must be a level above from.")
            continue
        stair_shape = nullish(get(vi, "shape"), "straight")
        if stair_shape not in ("straight", "u_turn"):
            err(vp, f'shape must be straight or u_turn, got "{text(stair_shape)}".')
            continue
        (minx, miny), (maxx, maxy) = bbox(polygon)
        up = nullish(get(vi, "up"), "east" if maxx - minx >= maxy - miny else "south")
        if up not in SIDES:
            err(vp, f'up must be one of {", ".join(SIDES)}, got "{text(up)}".')
            continue
        across = ["north", "south"] if up in ("east", "west") else ["east", "west"]
        start = nullish(get(vi, "start"), across[1])
        if start not in across:
            err(vp, f'start must be {" or ".join(across)} for a stair climbing {up}, got "{text(start)}".')
            continue
        length = maxx - minx if up in ("east", "west") else maxy - miny
        entry = nullish(get(vi, "entry"), 0)
        if not is_num(entry) or entry < 0 or entry > length - 0.5:
            err(vp, f"entry must be between 0 and {fixed(length - 0.5, 2)} m (the stairwell is {fixed(length, 2)} m long), got {text(entry)}.")
            continue

    roof = nullish(get(h, "roof"), {})
    ridge = get(roof, "ridge")
    if truthy(ridge) and ridge not in ("east_west", "north_south"):
        err("roof", f'ridge must be east_west or north_south, got "{text(ridge)}".')
    pitch = nullish(get(roof, "pitch"), 35)
    if not (num(pitch) > 0 and num(pitch) < 75):
        err("roof", f"pitch must be between 0 and 75 degrees, got {text(pitch)}.")

    energy: list[dict[str, Any]] = []
    energy_in = items(get(h, "energy"))
    for index, e in enumerate(energy_in):
        ep = f"energy.{index}"
        kind = get(e, "kind")
        if not truthy(e) or kind not in ENERGY_KINDS:
            err(ep, f"kind must be one of {', '.join(ENERGY_KINDS)}, got {stringify(kind)}.")
            continue
        if kind != "solar":
            level = get(e, "level")
            known = level is not MISSING and not isinstance(level, (dict, list)) and level in level_index
            if not known:
                err(ep, f"A {kind} needs level: <level id> and at: [x, y]{f' (unknown level {chr(34)}{text(level)}{chr(34)})' if truthy(level) else ''}.")
                continue
            at = get(e, "at")
            if not isinstance(at, list) or len(at) != 2:
                err(ep, "at must be [x, y] in metres.")
                continue
        if kind == "device" and not truthy(get(e, "power")):
            err(ep, "A device needs power: <sensor>.")
            continue
        roof_side = get(e, "roof")
        if truthy(roof_side) and roof_side not in SIDES:
            err(ep, f"roof must be one of {', '.join(SIDES)}.")
            continue
        energy.append({"index": index, "kind": kind, "name": get(e, "name")})
    taken: set[str] = set()
    for item in energy:
        given = get(energy_in[item["index"]], "id")
        if truthy(given) and given in taken:
            err(f"energy.{item['index']}", f'id "{text(given)}" is used twice.')
        base = slug(text(nullish(item["name"], item["kind"])))
        eid = nullish(given, base)
        n = 2
        while not truthy(given) and eid in taken:
            eid = f"{base}_{n}"
            n += 1
        item["id"] = eid
        taken.add(eid)
    for item in energy:
        to = get(energy_in[item["index"]], "to")
        if to is not MISSING:
            target = next((x for x in energy if x["id"] == to), None)
            if target is None or target is item:
                others = join(x["id"] for x in energy if x is not item)
                err(f"energy.{item['index']}", f'to must be the id of another energy item ({others}), got "{text(to)}".')

    if any(i["severity"] == "error" for i in issues):
        return issues
    inverted = get(h, "inverted_covers")
    if inverted is not MISSING and not (isinstance(inverted, list) and all(isinstance(c, str) for c in inverted)):
        err("inverted_covers", "inverted_covers must be a list of cover entities.")
    for index, r in enumerate(items(get(h, "robots"))):
        rp = f"robots.{index}"
        entity = get(r, "entity")
        kind = entity.split(".")[0] if isinstance(entity, str) else None
        if kind not in ("vacuum", "lawn_mower"):
            err(rp, f"entity must be a vacuum.* or lawn_mower.* entity, got {stringify(entity)}.")
            continue
        level = get(r, "level")
        if isinstance(level, (dict, list)) or level not in level_index:
            err(rp, f"level must be one of {join(level_index)}, got {stringify(level)}.")
            continue
        dock = get(r, "dock")
        if not isinstance(dock, list) or len(dock) != 2:
            err(rp, "dock must be [x, y] in metres.")
            continue
    north = get(h, "north")
    if north is not MISSING and not is_num(north):
        err("north", f"north must be degrees (a number), got {stringify(north)}.")
    return issues


def errors(house: Any) -> list[dict[str, str]]:
    return [i for i in validate(house) if i["severity"] == "error"]


def describe(issues: list[dict[str, str]]) -> str:
    """Issues as lines for people and assistants: `path: message`."""
    return "\n".join(f"{i['severity']}: {i['path'] or '(house)'}: {i['message']}" for i in issues)
