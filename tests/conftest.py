"""Fixtures for Homeslice tests."""

from pathlib import Path

import pytest

# The test framework imports its own `custom_components` package (with test
# integrations) first; add this repository's folder to its search path.
import custom_components

custom_components.__path__.append(str(Path(__file__).parents[1] / "custom_components"))


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Load custom integrations, including this repository's."""
    yield
