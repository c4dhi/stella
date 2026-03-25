import asyncio

import pytest

from stella_agent.agent import StellaAgent


def _minimal_plan() -> dict:
    return {
        "id": "plan-stella-test",
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


def test_stella_agent_legacy_startup_with_effective_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    agent = StellaAgent(use_tools=False)
    config = {
        "model": "gpt-4.1-mini",
        "temperature": 0.25,
    }

    asyncio.run(agent.on_session_start("session-stella", config))

    assert agent.session_id == "session-stella"
    assert agent.config == config
    assert agent.llm_service.default_config.model == "gpt-4.1-mini"
    assert agent.llm_service.default_config.temperature == 0.25
    assert agent.state_machine is not None
    assert agent.state_machine.is_initialized is False


def test_stella_agent_legacy_startup_initializes_state_machine_when_plan_inline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    agent = StellaAgent(use_tools=False)
    config = {
        "plan": _minimal_plan(),
        "model": "gpt-4.1-mini",
    }

    asyncio.run(agent.on_session_start("session-stella-plan", config))

    assert agent.session_id == "session-stella-plan"
    assert agent.state_machine is not None
    assert agent.state_machine.is_initialized is True
