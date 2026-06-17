"""Shared environment-variable parsers.

A declared optional env var can reach the pod as an empty string (e.g. a
template that carries the key but no value). ``os.getenv(name, default)`` returns
that ``""`` instead of the default, so ``int("")`` / ``float("")`` would crash the
agent at startup. These helpers treat empty/whitespace/unparseable as "unset" and
fall back to the default, and were previously copy-pasted into bridge_generator,
barge_in_evaluator and the audio pipeline (#304 review).
"""

import logging
import os

logger = logging.getLogger(__name__)

_TRUTHY = ("true", "1", "yes", "on")


def env_int(name: str, default: int) -> int:
    """Read an int env var, tolerating empty/blank/invalid → default."""
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, raw, default)
        return default


def env_float(name: str, default: float) -> float:
    """Read a float env var, tolerating empty/blank/invalid → default."""
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, raw, default)
        return default


def env_bool(name: str, default: bool) -> bool:
    """Read a bool env var ("true"/"1"/"yes"/"on" → True), tolerating empty → default."""
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in _TRUTHY
