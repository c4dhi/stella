import asyncio

from echo_agent.agent import EchoAgent


def test_echo_agent_on_session_start_accepts_effective_config() -> None:
    agent = EchoAgent()
    config = {
        "llm": {"model": "gpt-4o-mini"},
        "feature_flags": {"text_only": True},
    }

    asyncio.run(agent.on_session_start("session-echo", config))

    assert agent.session_id == "session-echo"
    assert agent._config == config

