"""validate.py must say what the editor (expand.ts) says: same errors, paths and messages.

tests/validation_cases.json is written by frontend/model/validation.test.ts from the
TypeScript rules; regenerate it there after changing a rule.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from custom_components.homeslice.validate import errors

CASES = json.loads((Path(__file__).parent / "validation_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_same_errors_as_the_editor(case) -> None:
    got = [{"path": i["path"], "message": i["message"]} for i in errors(case["house"])]
    assert got == case["errors"]
