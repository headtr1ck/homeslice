"""The models the repository ships pass the same checks as uploaded ones, and stay light.

They are served to every screen that shows a house, so a model added in a pull request
must not load files from elsewhere, need decoders we don't bundle or weigh down a tablet.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath
import struct

import pytest

from custom_components.homeslice.assets import POLYHAVEN_SUFFIXES, AssetError, check_links, glb_json

ROOT = Path(__file__).parent.parent
MODELS = sorted(p for p in ROOT.glob("assets/**/*") if p.suffix.lower() in {".glb", ".gltf"})

MAX_BYTES = 1_000_000
MAX_TRIANGLES = 20_000
# extensions three.js's GLTFLoader reads without extra decoders
KNOWN_EXTENSIONS = {"KHR_materials_emissive_strength", "KHR_texture_transform", "KHR_materials_unlit", "KHR_mesh_quantization"}


def triangles(gltf: dict) -> int:
    total = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            accessor = prim.get("indices", prim.get("attributes", {}).get("POSITION"))
            if accessor is not None:
                total += gltf["accessors"][accessor]["count"] // 3
    return total


def test_there_are_models() -> None:
    assert len(MODELS) > 100


@pytest.mark.parametrize("path", MODELS, ids=lambda p: str(p.relative_to(ROOT)))
def test_shipped_model(path: Path) -> None:
    assert path.suffix == ".glb", "ship models as binary glTF (.glb)"
    assert path.stat().st_size <= MAX_BYTES, f"{path.stat().st_size} bytes, at most {MAX_BYTES}"
    gltf = glb_json(path.read_bytes())
    check_links(gltf, files=True)
    for key in ("buffers", "images"):
        for item in gltf.get(key) or []:
            uri = item.get("uri")
            if uri and not uri.startswith("data:"):
                assert PurePosixPath(uri).suffix.lower() in POLYHAVEN_SUFFIXES, uri
                assert (path.parent / uri).is_file(), f"{uri} is missing"
    required = set(gltf.get("extensionsRequired") or [])
    assert required <= KNOWN_EXTENSIONS, f"needs {required - KNOWN_EXTENSIONS}"
    assert triangles(gltf) <= MAX_TRIANGLES, f"{triangles(gltf)} triangles, at most {MAX_TRIANGLES}"


def _glb(gltf: bytes) -> bytes:
    gltf += b" " * (-len(gltf) % 4)
    return b"glTF" + struct.pack("<II", 2, 20 + len(gltf)) + struct.pack("<I4s", len(gltf), b"JSON") + gltf


@pytest.mark.parametrize(
    "uri",
    ["https://example.com/t.png", "//example.com/t.png", "/local/t.png", "../polyhaven/x.bin", "file:///etc/passwd", "C:\\t.png"],
)
def test_links_elsewhere_are_refused(uri: str) -> None:
    blob = _glb(b'{"asset":{"version":"2.0"},"images":[{"uri":"%s"}]}' % uri.replace("\\", "\\\\").encode())
    with pytest.raises(AssetError):
        check_links(glb_json(blob), files=True)


def test_embedded_and_neighbouring_files_are_fine() -> None:
    gltf = glb_json(_glb(b'{"asset":{"version":"2.0"},"buffers":[{"byteLength":4}],"images":[{"uri":"data:image/png;base64,AA"},{"bufferView":0}]}'))
    check_links(gltf)
    check_links({"images": [{"uri": "textures/a.jpg"}]}, files=True)
    with pytest.raises(AssetError):
        check_links({"images": [{"uri": "textures/a.jpg"}]})  # an upload has nothing next to it


@pytest.mark.parametrize("blob", [b"", b"glTF", b"glTF\x02\x00\x00\x00\x0c\x00\x00\x00", _glb(b"not json")])
def test_not_a_glb(blob: bytes) -> None:
    with pytest.raises(AssetError):
        glb_json(blob)
