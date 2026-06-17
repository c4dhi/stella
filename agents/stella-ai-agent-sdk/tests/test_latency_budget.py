"""Tests for the first-audible-token latency budget (#304 A1).

Pins the literature-grounded classification: a bridge ack must land inside the
~500 ms gap window; the substantive response is comfortable ≤1 s; both are
"unnatural" past 2 s and a "breakdown" past 4 s.
"""

from stella_agent_sdk.audio.pipeline import (
    _first_byte_target_ms,
    _latency_status,
    _BRIDGE_FIRST_BYTE_TARGET_MS,
    _RESPONSE_FIRST_BYTE_TARGET_MS,
)


def test_targets_per_source():
    assert _first_byte_target_ms("bridge") == _BRIDGE_FIRST_BYTE_TARGET_MS
    assert _first_byte_target_ms("response") == _RESPONSE_FIRST_BYTE_TARGET_MS
    # bridge target is tighter than response (must fit the gap window)
    assert _BRIDGE_FIRST_BYTE_TARGET_MS < _RESPONSE_FIRST_BYTE_TARGET_MS


def test_bridge_status_bands():
    assert _latency_status("bridge", 200) == "ok"        # inside gap window
    assert _latency_status("bridge", 800) == "over_target"  # past 500, under warn
    assert _latency_status("bridge", 2500) == "warn"     # unnatural
    assert _latency_status("bridge", 5000) == "alarm"    # perceived breakdown


def test_response_status_bands():
    assert _latency_status("response", 800) == "ok"          # ≤1 s comfortable
    assert _latency_status("response", 1500) == "over_target"
    assert _latency_status("response", 3000) == "warn"
    assert _latency_status("response", 4500) == "alarm"
