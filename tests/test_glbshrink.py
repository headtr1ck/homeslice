"""Scaling down the pictures inside downloaded models."""

from __future__ import annotations

import io
import json
import struct

from PIL import Image

from custom_components.homeslice.glbshrink import shrink_glb


def _png(w: int, h: int, alpha: bool = False) -> bytes:
    img = Image.new("RGBA" if alpha else "RGB", (w, h))
    # a gradient, so it doesn't compress to nothing
    img.putdata([((x * 7) % 256, (y * 5) % 256, (x * y) % 256, 128 if alpha else 255)[: 4 if alpha else 3] for y in range(h) for x in range(w)])
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def _glb(images: list[bytes], mesh: bytes) -> bytes:
    """A .glb: a mesh's bytes first, then the pictures, all in the binary part."""
    views, binary = [], bytearray()
    for data in [mesh, *images]:
        binary += b"\0" * ((4 - len(binary) % 4) % 4)
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
        binary += data
    gltf = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(mesh) // 12, "type": "VEC3"}],
        "images": [{"bufferView": i + 1, "mimeType": "image/png"} for i in range(len(images))],
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


def test_big_pictures_are_scaled_down_the_rest_stays() -> None:
    mesh = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    blob = _glb([_png(2048, 1024), _png(64, 64, alpha=True)], mesh)
    small = shrink_glb(blob)
    assert len(small) < len(blob)
    gltf, binary = _parts(small)
    views = gltf["bufferViews"]
    assert gltf["buffers"][0]["byteLength"] <= len(binary) < gltf["buffers"][0]["byteLength"] + 4
    # the mesh's bytes as they were
    v = views[0]
    assert binary[v["byteOffset"] : v["byteOffset"] + v["byteLength"]] == mesh
    # the big picture: 1024 px wide now, a JPEG (no see-through)
    big = views[gltf["images"][0]["bufferView"]]
    with Image.open(io.BytesIO(binary[big["byteOffset"] : big["byteOffset"] + big["byteLength"]])) as img:
        assert img.size == (1024, 512) and img.format == "JPEG"
    assert gltf["images"][0]["mimeType"] == "image/jpeg"
    # every view starts 4-byte aligned
    assert all(x["byteOffset"] % 4 == 0 for x in views)


def test_see_through_pictures_stay_png_and_small_models_stay_as_they_are() -> None:
    blob = _glb([_png(2048, 2048, alpha=True)], b"\0" * 12)
    gltf, _ = _parts(shrink_glb(blob))
    assert gltf["images"][0]["mimeType"] == "image/png"
    # nothing to gain: the same bytes back
    tiny = _glb([_png(8, 8)], b"\0" * 12)
    assert shrink_glb(tiny) == tiny
    assert shrink_glb(b"not a model") == b"not a model"

