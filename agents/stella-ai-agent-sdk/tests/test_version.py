"""Tests for package version metadata."""

from importlib.metadata import version

from stella_agent_sdk import __version__


def test_package_version_matches_metadata():
    """Expose the installed package version without a second hardcoded source."""
    assert __version__ == version("stella-ai-agent-sdk")
