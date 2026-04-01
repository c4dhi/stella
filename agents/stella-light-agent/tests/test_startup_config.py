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


def test_stella_light_legacy_startup_with_effective_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    agent = StellaLightAgent(use_tools=False)
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
    assert agent.state_machine is not None
    assert agent.state_machine.is_initialized is False


def test_stella_light_legacy_startup_initializes_state_machine_when_plan_inline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    agent = StellaLightAgent(use_tools=False)
    config = {
        "plan": _minimal_plan(),
        "llm": {"model": "gpt-4.1-nano"},
    }

    asyncio.run(agent.on_session_start("session-stella-light-plan", config))

    assert agent.state_machine is not None
    assert agent.state_machine.is_initialized is True
