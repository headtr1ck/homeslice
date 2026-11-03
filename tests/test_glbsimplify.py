"""Simplifying the meshes of heavy downloaded models."""

from __future__ import annotations

import json
import struct

import numpy as np

from custom_components.homeslice.glbshrink import shrink_glb
from custom_components.homeslice.glbsimplify import simplify_glb


def _grid(n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """A wavy n × n grid of quads (2·n² triangles): positions, normals, texture coordinates, indices."""
    u, v = np.meshgrid(np.linspace(0, 1, n + 1), np.linspace(0, 1, n + 1))
    pos = np.stack([u.ravel(), 0.1 * np.sin(6 * u.ravel()), v.ravel()], axis=1).astype("<f4")
    nor = np.tile(np.array([0, 1, 0], dtype="<f4"), (len(pos), 1))
    uv = np.stack([u.ravel(), v.ravel()], axis=1).astype("<f4")
    idx = []
    for y in range(n):
        for x in range(n):
            a = y * (n + 1) + x
            idx += [a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1]
    return pos, nor, uv, np.array(idx, dtype="<u4")


def _glb(pos, nor, uv, idx, *, mode: int = 4, extra: dict | None = None, image: bytes | None = None) -> bytes:
    datas = [pos.tobytes(), nor.tobytes(), uv.tobytes(), idx.tobytes()] + ([image] if image else [])
    views, binary = [], bytearray()
    for d in datas:
        binary += b"\0" * ((4 - len(binary) % 4) % 4)
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(d)})
        binary += d
    gltf = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(uv), "type": "VEC2"},
            {"bufferView": 3, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "mode": mode}]}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        **({"images": [{"bufferView": 4, "mimeType": "image/png"}]} if image else {}),
        **(extra or {}),
    }
    j = json.dumps(gltf).encode()
    j += b" " * ((4 - len(j) % 4) % 4)
    b = bytes(binary) + b"\0" * ((4 - len(binary) % 4) % 4)
    return struct.pack("<4sII", b"glTF", 2, 28 + len(j) + len(b)) + struct.pack("<II", len(j), 0x4E4F534A) + j + struct.pack("<II", len(b), 0x004E4942) + b


def _parts(blob: bytes) -> tuple[dict, bytes]:
    magic, version, total = struct.unpack_from("<4sII", blob, 0)
    assert magic == b"glTF" and version == 2 and total == len(blob)
    jl, _ = struct.unpack_from("<II", blob, 12)
    gltf = json.loads(blob[20 : 20 + jl])
    bl, _ = struct.unpack_from("<II", blob, 20 + jl)
    return gltf, blob[28 + jl : 28 + jl + bl]


def _read(gltf: dict, binary: bytes, index: int) -> np.ndarray:
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    dtype = {5126: "<f4", 5125: "<u4", 5123: "<u2"}[acc["componentType"]]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[acc["type"]]
    return np.frombuffer(binary, dtype=dtype, count=acc["count"] * comps, offset=view["byteOffset"]).reshape(acc["count"], comps)


def test_a_heavy_mesh_gets_under_the_budget_keeping_its_shape() -> None:
    pos, nor, uv, idx = _grid(120)  # 28 800 triangles
    blob = _glb(pos, nor, uv, idx)
    light = simplify_glb(blob, max_triangles=3000)
    assert len(light) < len(blob) / 4
    gltf, binary = _parts(light)
    prim = gltf["meshes"][0]["primitives"][0]
    tris = _read(gltf, binary, prim["indices"]).reshape(-1, 3)
    p = _read(gltf, binary, prim["attributes"]["POSITION"])
    # under the budget, but not a handful of triangles
    assert 300 < len(tris) <= 3000
    assert tris.max() < len(p)
    # the same size and place; the bounds written for the new positions
    assert np.allclose(p.min(0), pos.min(0), atol=0.02) and np.allclose(p.max(0), pos.max(0), atol=0.02)
    acc = gltf["accessors"][prim["attributes"]["POSITION"]]
    assert np.allclose(acc["min"], p.min(0)) and np.allclose(acc["max"], p.max(0))
    # normals still unit length, texture coordinates still where they were
    n = _read(gltf, binary, prim["attributes"]["NORMAL"])
    assert np.allclose(np.linalg.norm(n, axis=1), 1, atol=1e-4)
    t = _read(gltf, binary, prim["attributes"]["TEXCOORD_0"])
    assert np.allclose(t[:, 0], p[:, 0], atol=0.05) and np.allclose(t[:, 1], p[:, 2], atol=0.05)
    # the old mesh's data is gone: one buffer view per attribute and the indices
    assert len(gltf["bufferViews"]) == 4 and len(gltf["accessors"]) == 4


def test_light_models_and_unusual_ones_stay_as_they_are() -> None:
    pos, nor, uv, idx = _grid(20)  # 800 triangles
    small = _glb(pos, nor, uv, idx)
    assert simplify_glb(small, max_triangles=3000) == small
    pos, nor, uv, idx = _grid(60)
    # lines, a skinned model, instancing on a node: kept
    for blob in (
        _glb(pos, nor, uv, idx, mode=1),
        _glb(pos, nor, uv, idx, extra={"skins": [{"joints": [0]}]}),
        _glb(pos, nor, uv, idx, extra={"nodes": [{"mesh": 0, "extensions": {"EXT_mesh_gpu_instancing": {}}}]}),
        _glb(pos, nor, uv, idx, extra={"extensionsRequired": ["KHR_draco_mesh_compression"]}),
    ):
        assert simplify_glb(blob, max_triangles=500) == blob
    assert simplify_glb(b"not a model", max_triangles=10) == b"not a model"


def test_pictures_survive_the_simplifying_and_still_shrink() -> None:
    import io

    from PIL import Image

    img = Image.new("RGB", (2048, 2048))
    img.putdata([((x * 7) % 256, (y * 5) % 256, (x * y) % 256) for y in range(2048) for x in range(2048)])
    out = io.BytesIO()
    img.save(out, "PNG")
    pos, nor, uv, idx = _grid(80)
    blob = _glb(pos, nor, uv, idx, image=out.getvalue())
    light = shrink_glb(simplify_glb(blob, max_triangles=2000))
    gltf, binary = _parts(light)
    view = gltf["bufferViews"][gltf["images"][0]["bufferView"]]
    picture = binary[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
    with Image.open(io.BytesIO(picture)) as im:
        assert max(im.size) == 1024
