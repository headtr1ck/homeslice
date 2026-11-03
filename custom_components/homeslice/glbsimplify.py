"""Lighter .glb files: meshes with fewer triangles.

A chair from Sketchfab can have half a million triangles; on a floor plan, a few thousand
look the same, and a wall tablet draws a whole house of them. A model with more than
MAX_TRIANGLES gets its meshes simplified by vertex clustering: nearby vertices (in a grid
cell, and close in their texture coordinates, so seams stay seams) become one, and triangles
that collapse go. The grid is as fine as the budget allows.

Animated or skinned meshes, morph targets, compressed meshes (Draco, meshopt) and anything
unusual are left as they are; so is the whole model when numpy is missing.
"""

from __future__ import annotations

import json
import logging
import struct
from typing import Any

_LOGGER = logging.getLogger(__name__)

MAX_TRIANGLES = 50_000
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
TRIANGLES = 4
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
# glTF component types numpy reads: float, and the index types
DTYPES = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}
# what clustering may average: floats only
ATTRIBUTES = ("POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1", "TANGENT", "COLOR_0")
# how far apart texture coordinates may be and still merge (a seam is further)
UV_CELL = 1 / 32


def _read(blob: bytes) -> tuple[dict[str, Any], bytes] | None:
    if len(blob) < 20 or blob[:4] != b"glTF":
        return None
    _magic, version, total = struct.unpack_from("<4sII", blob, 0)
    if version != 2 or total > len(blob):
        return None
    pos, gltf, binary = 12, None, b""
    while pos + 8 <= total:
        length, kind = struct.unpack_from("<II", blob, pos)
        chunk = blob[pos + 8 : pos + 8 + length]
        if kind == JSON_CHUNK:
            gltf = json.loads(chunk)
        elif kind == BIN_CHUNK and not binary:
            binary = chunk
        pos += 8 + length
    if not isinstance(gltf, dict) or not binary:
        return None
    return gltf, binary


def _write(gltf: dict[str, Any], datas: list[bytes]) -> bytes:
    """The .glb with these buffer views' bytes, in order, 4-byte aligned."""
    out = bytearray()
    for view, data in zip(gltf["bufferViews"], datas, strict=True):
        out += b"\0" * ((4 - len(out) % 4) % 4)
        view["byteOffset"] = len(out)
        view["byteLength"] = len(data)
        out += data
    gltf["buffers"] = [{"byteLength": len(out)}]
    json_part = json.dumps(gltf, separators=(",", ":")).encode()
    json_part += b" " * ((4 - len(json_part) % 4) % 4)
    bin_part = bytes(out) + b"\0" * ((4 - len(out) % 4) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_part) + 8 + len(bin_part))
        + struct.pack("<II", len(json_part), JSON_CHUNK)
        + json_part
        + struct.pack("<II", len(bin_part), BIN_CHUNK)
        + bin_part
    )


def _array(np: Any, gltf: dict[str, Any], binary: bytes, index: int) -> Any:
    """An accessor's values (count × components), read through its view's stride."""
    acc = gltf["accessors"][index]
    if "sparse" in acc or "bufferView" not in acc or acc.get("normalized"):
        raise ValueError("unusual accessor")
    dtype = np.dtype(DTYPES[acc["componentType"]])
    comps = COMPONENTS[acc["type"]]
    view = gltf["bufferViews"][acc["bufferView"]]
    if view.get("buffer", 0) != 0:
        raise ValueError("another buffer")
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or dtype.itemsize * comps
    count = acc["count"]
    if count and start + stride * (count - 1) + dtype.itemsize * comps > len(binary):
        raise ValueError("accessor past its data")
    values = np.ndarray(shape=(count, comps), dtype=dtype, buffer=binary, offset=start, strides=(stride, dtype.itemsize))
    return np.array(values)


def _triangles(gltf: dict[str, Any]) -> int:
    n = 0
    for mesh in gltf.get("meshes") or []:
        for prim in mesh.get("primitives") or []:
            if prim.get("mode", TRIANGLES) != TRIANGLES:
                continue
            acc = gltf["accessors"][prim["indices"]] if "indices" in prim else gltf["accessors"][prim["attributes"]["POSITION"]]
            n += acc["count"] // 3
    return n


def _cluster(np: Any, attrs: dict[str, Any], tris: Any, cells: int) -> tuple[dict[str, Any], Any]:
    """The mesh with its vertices clustered on a grid of `cells` along its longest side."""
    pos = attrs["POSITION"]
    lo = pos.min(axis=0)
    size = float((pos.max(axis=0) - lo).max()) or 1.0
    key = np.floor((pos - lo) / (size / cells)).astype(np.int64)
    if "TEXCOORD_0" in attrs:
        key = np.hstack([key, np.floor(attrs["TEXCOORD_0"] / UV_CELL).astype(np.int64)])
    _, cluster, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    cluster = cluster.reshape(-1)
    merged = {}
    for name, values in attrs.items():
        sums = np.zeros((len(counts), values.shape[1]), dtype=np.float64)
        np.add.at(sums, cluster, values)
        merged[name] = sums / counts[:, None]
    if "NORMAL" in merged:
        n = merged["NORMAL"]
        merged["NORMAL"] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    t = cluster[tris]
    # triangles that collapsed to a line or a point go; so do doubles
    keep = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    t = np.unique(t[keep], axis=0) if keep.any() else t[:0]
    return merged, t


def _simplify_primitive(np: Any, gltf: dict[str, Any], binary: bytes, prim: dict[str, Any], target: int) -> tuple[dict[str, Any], Any] | None:
    """The primitive's vertices and triangles with at most about `target` triangles; None to keep it."""
    if prim.get("mode", TRIANGLES) != TRIANGLES or prim.get("targets") or prim.get("extensions"):
        return None
    names = set(prim["attributes"])
    if not names <= set(ATTRIBUTES) or "POSITION" not in names:
        return None
    attrs = {}
    for name in names:
        acc = gltf["accessors"][prim["attributes"][name]]
        if acc["componentType"] != 5126:
            return None
        attrs[name] = _array(np, gltf, binary, prim["attributes"][name]).astype(np.float64)
    count = len(attrs["POSITION"])
    tris = (_array(np, gltf, binary, prim["indices"]).reshape(-1) if "indices" in prim else np.arange(count)).astype(np.int64)
    tris = tris[: len(tris) // 3 * 3].reshape(-1, 3)
    if len(tris) <= target or (tris >= count).any():
        return None
    # the finest grid that meets the budget: halving its steps
    lo_cells, hi_cells, best = 2, 1024, None
    while lo_cells <= hi_cells:
        cells = (lo_cells + hi_cells) // 2
        merged, t = _cluster(np, attrs, tris, cells)
        if len(t) <= target:
            best = (merged, t)
            lo_cells = cells + 1
        else:
            hi_cells = cells - 1
    if best is None or not len(best[1]):
        return None
    # only the vertices the triangles still use
    used, remap = np.unique(best[1], return_inverse=True)
    return {name: values[used] for name, values in best[0].items()}, remap.reshape(-1, 3)


def simplify_glb(blob: bytes, max_triangles: int = MAX_TRIANGLES) -> bytes:
    """The .glb with at most about `max_triangles` triangles; the same bytes when it has fewer
    or can't be simplified."""
    try:
        import numpy as np  # part of Home Assistant
    except ImportError:
        return blob
    parts = _read(blob)
    if not parts:
        return blob
    gltf, binary = parts
    if gltf.get("extensionsRequired") or gltf.get("skins") or len(gltf.get("buffers") or []) != 1 or "uri" in gltf["buffers"][0]:
        return blob
    # extensions on nodes (instancing) may point at accessors too
    if any(node.get("extensions") for node in gltf.get("nodes") or []):
        return blob
    total = _triangles(gltf)
    if total <= max_triangles:
        return blob
    ratio = max_triangles / total
    views: list[dict[str, Any]] = gltf.get("bufferViews") or []
    datas = [binary[v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]] for v in views]
    accessors: list[dict[str, Any]] = gltf["accessors"]
    changed = False
    for mesh in gltf.get("meshes") or []:
        for prim in mesh.get("primitives") or []:
            try:
                n = (accessors[prim["indices"]]["count"] if "indices" in prim else accessors[prim["attributes"]["POSITION"]]["count"]) // 3
                done = _simplify_primitive(np, gltf, binary, prim, max(12, int(n * ratio)))
            except (KeyError, ValueError, TypeError, IndexError) as err:
                _LOGGER.debug("Mesh kept as it is: %s", err)
                continue
            if not done:
                continue
            verts, tris = done
            for name, values in verts.items():
                data = values.astype("<f4")
                views.append({"buffer": 0, "byteLength": data.nbytes, "target": 34962})
                datas.append(data.tobytes())
                acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(data), "type": ["SCALAR", "VEC2", "VEC3", "VEC4"][data.shape[1] - 1]}
                if name == "POSITION":
                    acc["min"] = data.min(axis=0).tolist()
                    acc["max"] = data.max(axis=0).tolist()
                accessors.append(acc)
                prim["attributes"][name] = len(accessors) - 1
            index_type = "<u2" if len(verts["POSITION"]) < 65536 else "<u4"
            idx = tris.astype(index_type).reshape(-1)
            views.append({"buffer": 0, "byteLength": idx.nbytes, "target": 34963})
            datas.append(idx.tobytes())
            accessors.append({"bufferView": len(views) - 1, "componentType": 5123 if index_type == "<u2" else 5125, "count": len(idx), "type": "SCALAR"})
            prim["indices"] = len(accessors) - 1
            changed = True
    if not changed:
        return blob
    _compact(gltf, datas)
    return _write(gltf, datas)


def _compact(gltf: dict[str, Any], datas: list[bytes]) -> None:
    """Drops the accessors and buffer views nothing uses any more (the old meshes)."""
    used_acc: set[int] = set()
    for mesh in gltf.get("meshes") or []:
        for prim in mesh.get("primitives") or []:
            used_acc.update(prim.get("attributes", {}).values())
            if "indices" in prim:
                used_acc.add(prim["indices"])
            for target in prim.get("targets") or []:
                used_acc.update(target.values())
    for anim in gltf.get("animations") or []:
        for sampler in anim.get("samplers") or []:
            used_acc.update(v for k, v in sampler.items() if k in ("input", "output"))
    accessors = gltf.get("accessors") or []
    acc_map = {old: new for new, old in enumerate(sorted(used_acc))}
    gltf["accessors"] = [accessors[i] for i in sorted(used_acc)]
    for mesh in gltf.get("meshes") or []:
        for prim in mesh.get("primitives") or []:
            prim["attributes"] = {k: acc_map[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = acc_map[prim["indices"]]
            if prim.get("targets"):
                prim["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in prim["targets"]]
    for anim in gltf.get("animations") or []:
        for sampler in anim.get("samplers") or []:
            for k in ("input", "output"):
                if k in sampler:
                    sampler[k] = acc_map[sampler[k]]
    used_view = {a["bufferView"] for a in gltf["accessors"] if "bufferView" in a}
    used_view |= {img["bufferView"] for img in gltf.get("images") or [] if "bufferView" in img}
    view_map = {old: new for new, old in enumerate(sorted(used_view))}
    views = gltf["bufferViews"]
    gltf["bufferViews"] = [views[i] for i in sorted(used_view)]
    datas[:] = [datas[i] for i in sorted(used_view)]
    for a in gltf["accessors"]:
        if "bufferView" in a:
            a["bufferView"] = view_map[a["bufferView"]]
    for img in gltf.get("images") or []:
        if "bufferView" in img:
            img["bufferView"] = view_map[img["bufferView"]]
