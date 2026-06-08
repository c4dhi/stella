import asyncio

import pytest

from stella_light_agent.agent import StellaLightAgent


def _minimal_plan() -> dict:
    return {
        "id": "plan-stella-light-test",
        "title": "Startup Plan",
        "initial_state_id": "intro",
        "states": [
            {
                "id": "intro",
                "title": "Intro",
                "type": "loose",
                "tasks": [],
                "transitions": [],
            }
        ],
    }


def _stub_tool_init(agent: StellaLightAgent) -> None:
    """Replace tool-mode init with a no-op.

    on_session_start connects to the external gRPC state machine (the single
    source of truth). That needs a running server, so for startup-config unit
    tests we stub it out and assert only the local config wiring.
    """

    async def _noop(session_id, plan_config):  # noqa: ANN001
        return None

    agent._init_tool_mode = _noop  # type: ignore[assignment]


def test_stella_light_startup_applies_effective_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    agent = StellaLightAgent()
    _stub_tool_init(agent)
    config = {
        "llm": {
            "model": "gpt-4.1-nano",
            "temperature": 0.15,
        },
    }

    asyncio.run(agent.on_session_start("session-stella-light", config))

    assert agent.config == config
    assert agent._session_started_at is not None
    assert agent.llm_service.default_config.model == "gpt-4.1-nano"
    assert agent.llm_service.default_config.temperature == 0.15


def test_stella_light_startup_retains_plan_for_progress_preview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    agent = StellaLightAgent()
    _stub_tool_init(agent)
    plan = _minimal_plan()
    config = {
        "plan": plan,
        "llm": {"model": "gpt-4.1-nano"},
    }

    asyncio.run(agent.on_session_start("session-stella-light-plan", config))

    # The raw plan is retained so progress updates can surface per-state
    # transitions (the "Possible Next States" preview on the frontend).
    assert agent._plan_config == plan
