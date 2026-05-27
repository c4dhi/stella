import asyncio
import json
import os
import time
import statistics
from typing import Any, Awaitable, Callable

PHASE_REPEATS = 5


def parse_idle_windows(env_value: str) -> list[int]:
    if not env_value:
        return [10, 30, 60, 120, 300, 600]

    windows: list[int] = []
    for part in env_value.split(','):
        token = part.strip()
        if not token:
            continue
        try:
            value = int(token)
            if value > 0:
                windows.append(value)
        except ValueError:
            continue

    return windows or [10, 30, 60, 120, 300, 600]


def _log(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


async def run_latency_probe(
    provider: str,
    provider_type: str,
    inference_fn: Callable[[], Awaitable[None]],
    metadata: dict[str, Any],
) -> None:
    if os.getenv("MODEL_LATENCY_PROBE_ENABLED", "false").lower() != "true":
        return

    windows = parse_idle_windows(os.getenv("MODEL_LATENCY_IDLE_WINDOWS", "10,30,60,120,300,600"))
    base = {
        "event": "model_latency_probe",
        "provider": provider,
        "provider_type": provider_type,
        **metadata,
    }

    async def measure(phase: str) -> float:
        samples: list[float] = []
        for idx in range(PHASE_REPEATS):
            start = time.perf_counter()
            await inference_fn()
            latency_ms = (time.perf_counter() - start) * 1000.0
            samples.append(latency_ms)
            _log({
                **base,
                "phase": phase,
                "latency_ms": round(latency_ms, 2),
                "repeat_index": idx + 1,
                "repeat_count": PHASE_REPEATS,
            })
        median_ms = statistics.median(samples)
        _log({
            "event": "model_latency_probe_summary",
            "provider": provider,
            "provider_type": provider_type,
            "phase": f"{phase}_median",
            "latency_ms": round(median_ms, 2),
            "min_ms": round(min(samples), 2),
            "max_ms": round(max(samples), 2),
            "samples_ms": [round(s, 2) for s in samples],
            "repeat_count": PHASE_REPEATS,
            **metadata,
        })
        return median_ms

    try:
        first_after_initialize = await measure("first_after_initialize")
        second_immediate = await measure("second_immediate")

        _log({
            "event": "model_latency_probe_summary",
            "provider": provider,
            "provider_type": provider_type,
            "phase": "deploy_cold_penalty",
            "first_after_initialize_ms": round(first_after_initialize, 2),
            "second_immediate_ms": round(second_immediate, 2),
            "penalty_ms": round(first_after_initialize - second_immediate, 2),
            **metadata,
        })

        for idle_s in windows:
            await asyncio.sleep(idle_s)
            first_after_idle = await measure("first_after_idle")
            second_after_idle = await measure("second_after_idle")
            _log({
                "event": "model_latency_probe_summary",
                "provider": provider,
                "provider_type": provider_type,
                "phase": "idle_penalty",
                "idle_s": idle_s,
                "first_after_idle_ms": round(first_after_idle, 2),
                "second_after_idle_ms": round(second_after_idle, 2),
                "penalty_ms": round(first_after_idle - second_after_idle, 2),
                **metadata,
            })
    except Exception as exc:
        _log({
            "event": "model_latency_probe_error",
            "provider": provider,
            "provider_type": provider_type,
            "error": str(exc),
            **metadata,
        })
