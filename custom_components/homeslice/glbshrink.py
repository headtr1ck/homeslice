"""Smaller .glb files: the pictures inside a model scaled down.

Models from Sketchfab often carry 2K–8K textures (10–40 MB a chair); seen on a floor plan,
1024 px is plenty. Every picture embedded in the binary part is scaled down to at most
MAX_PX on its longer side and stored again (JPEG, or PNG where it is see-through), only
where that makes it smaller. The model itself (meshes, materials) is left as it is.
"""

from __future__ import annotations

import io
import json
import logging
import struct
from typing import Any

_LOGGER = logging.getLogger(__name__)

MAX_PX = 1024
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
MIME = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


def _pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def _smaller_image(data: bytes, mime: str, max_px: int) -> tuple[bytes, str] | None:
    """The picture scaled down (or just stored better), with its type; None if no smaller."""
    from PIL import Image  # part of Home Assistant

    with Image.open(io.BytesIO(data)) as img:
        img.load()
        w, h = img.size
        k = min(1.0, max_px / max(w, h))
        if k < 1:
            img = img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.Resampling.LANCZOS)
        alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        if alpha and img.mode != "RGBA":
            img = img.convert("RGBA")
        # see-through where it matters: PNG; else JPEG
        if alpha and img.getchannel("A").getextrema()[0] < 255:
            out, new_mime = io.BytesIO(), "image/png"
            img.save(out, "PNG", optimize=True)
        elif mime == "image/webp":
            out, new_mime = io.BytesIO(), "image/webp"
            img.convert("RGB").save(out, "WEBP", quality=85)
        else:
            out, new_mime = io.BytesIO(), "image/jpeg"
            img.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
    data_out = out.getvalue()
    return (data_out, new_mime) if len(data_out) < len(data) else None


def shrink_glb(blob: bytes, max_px: int = MAX_PX) -> bytes:
    """The .glb with its embedded pictures at most `max_px` big; the same bytes if nothing shrinks."""
    if len(blob) < 20 or blob[:4] != b"glTF":
        return blob
    _magic, version, total = struct.unpack_from("<4sII", blob, 0)
    if version != 2 or total > len(blob):
        return blob
    pos, gltf, bin_chunk = 12, None, b""
    while pos + 8 <= total:
        length, kind = struct.unpack_from("<II", blob, pos)
        chunk = blob[pos + 8 : pos + 8 + length]
        if kind == JSON_CHUNK:
            gltf = json.loads(chunk)
        elif kind == BIN_CHUNK and not bin_chunk:
            bin_chunk = chunk
        pos += 8 + length
    if not isinstance(gltf, dict) or not bin_chunk:
        return blob
    views: list[dict[str, Any]] = gltf.get("bufferViews") or []
    buffers: list[dict[str, Any]] = gltf.get("buffers") or []
    if not buffers or "uri" in buffers[0]:
        return blob

    # each picture in the binary part, scaled down where that makes it smaller
    replaced: dict[int, bytes] = {}
    for image in gltf.get("images") or []:
        index = image.get("bufferView")
        mime = image.get("mimeType", "")
        if not isinstance(index, int) or index >= len(views) or mime not in MIME:
            continue
        view = views[index]
        if view.get("buffer", 0) != 0 or index in replaced:
            continue
        start = view.get("byteOffset", 0)
        data = bin_chunk[start : start + view["byteLength"]]
        try:
            smaller = _smaller_image(data, mime, max_px)
        except Exception as err:  # noqa: BLE001 - a picture Pillow can't read stays as it is
            _LOGGER.debug("Picture %s left as it is: %s", index, err)
            continue
        if smaller:
            replaced[index] = smaller[0]
            image["mimeType"] = smaller[1]
    if not replaced:
        return blob

    # the binary part again, view by view (4-byte aligned), with the new pictures
    out = bytearray()
    for i, view in enumerate(views):
        if view.get("buffer", 0) != 0:
            continue
        start = view.get("byteOffset", 0)
        data = replaced.get(i, bin_chunk[start : start + view["byteLength"]])
        out += b"\0" * ((4 - len(out) % 4) % 4)
        view["byteOffset"] = len(out)
        view["byteLength"] = len(data)
        out += data
    buffers[0]["byteLength"] = len(out)
    json_part = _pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    bin_part = _pad(bytes(out), b"\0")
    length = 12 + 8 + len(json_part) + 8 + len(bin_part)
    return (
        struct.pack("<4sII", b"glTF", 2, length)
        + struct.pack("<II", len(json_part), JSON_CHUNK)
        + json_part
        + struct.pack("<II", len(bin_part), BIN_CHUNK)
        + bin_part
    )
