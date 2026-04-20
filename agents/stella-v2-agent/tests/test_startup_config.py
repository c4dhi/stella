import asyncio

import pytest

from stella_v2_agent.agent import StellaV2Agent


def _minimal_pipeline_config() -> dict:
    return {
        "nodes": {},
        "thresholds": {"history_limit": 20},
    }


def test_stella_v2_startup_with_effective_config_and_pipeline_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    monkeypatch.delenv("STELLA_EXPERTS_DIR", raising=False)
    agent = StellaV2Agent()
    config = {
        "model": "gpt-4.1-mini",
        "temperature": 0.3,
        "expert_overrides": {},
        "pipeline_config": {
            "nodes": {
                "input_gate": {"max_tokens": 77},
                "response_generator": {"temperature": 0.2},
                "expert_pool": {
                    "always_run": ["task_extraction"],
                    "background_experts": ["task_extraction"],
                },
                "bridge_generator": {"max_tokens": 25},
            },
            "thresholds": {"history_limit": 25},
        },
    }

    asyncio.run(agent.on_session_start("session-stella-v2", config))

    assert agent.session_id == "session-stella-v2"
    assert agent.config == config
    assert agent.llm_service.default_config.model == "gpt-4.1-mini"
    assert agent.llm_service.default_config.temperature == 0.3
    assert agent.input_gate.gate_max_tokens == 77
    assert agent.response_generator.response_temperature == 0.2
    assert agent.bridge_generator.bridge_max_tokens == 25
    assert agent.expert_pool._background_experts == {"task_extraction"}
    assert agent._custom_history_limit == 25
    # Unspecified slot defaults remain intact (partial override behavior).
    assert agent.input_gate.gate_model == "gpt-4o-mini"
    assert agent.input_gate.gate_temperature == 0.0
    assert agent.response_generator.response_max_tokens == 150
    assert agent.bridge_generator.bridge_temperature == 0.4


def test_stella_v2_startup_requires_pipeline_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    monkeypatch.delenv("STELLA_EXPERTS_DIR", raising=False)

    agent = StellaV2Agent()
    config = {
        "model": "gpt-4.1-mini",
        "temperature": 0.3,
    }

    with pytest.raises(ValueError, match="pipeline_config is required"):
        asyncio.run(agent.on_session_start("session-stella-v2-missing-pipeline", config))


def test_stella_v2_startup_accepts_minimal_pipeline_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    monkeypatch.delenv("STELLA_EXPERTS_DIR", raising=False)

    agent = StellaV2Agent()
    config = {"pipeline_config": _minimal_pipeline_config()}

    asyncio.run(agent.on_session_start("session-stella-v2-minimal", config))

    assert agent.session_id == "session-stella-v2-minimal"
    assert agent.config == config


def test_stella_v2_pipeline_slot_overrides_merge_with_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("STELLA_PLANS_DIR", raising=False)
    monkeypatch.delenv("STELLA_EXPERTS_DIR", raising=False)

    agent = StellaV2Agent()
    config = {
        "pipeline_config": {
            "nodes": {
                "input_gate": {"model": "gpt-4o"},
                "expert_pool": {"always_run": ["task_extraction", "probing"]},
                "arbitration": {"tone_map": {"medical": "very_cautious"}},
            },
            "thresholds": {},
        }
    }

    asyncio.run(agent.on_session_start("session-stella-v2-merge", config))

    # Explicit overrides are applied.
    assert agent.input_gate.gate_model == "gpt-4o"
    assert agent.expert_pool._always_run == {"task_extraction", "probing"}
    assert agent.arbitration._tone_map["medical"] == "very_cautious"

    # Unspecified defaults remain intact (partial merge behavior).
    assert agent.input_gate.gate_max_tokens == 60
    assert agent.input_gate.gate_temperature == 0.0
    assert agent.expert_pool._background_experts == {"task_extraction"}
    assert agent.arbitration._tone_map["legal"] == "cautious"
    assert agent.arbitration._tone_map["noise_detection"] == "neutral"
