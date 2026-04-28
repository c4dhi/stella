"""Shared utility helpers for STELLA V2 agent."""

from typing import Any


def normalize_transition_priority(value: Any, default: int = 100) -> int:
    """Normalize transition priority (supports int-like strings)."""
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except (ValueError, TypeError):
            return default
    return default
