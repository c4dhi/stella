"""Tests for BaseAgent abstract class."""

import pytest
from typing import Any, AsyncIterator, Dict

from grace_agent_sdk.agent.base import BaseAgent
from grace_agent_sdk.messages.input import AgentInput
from grace_agent_sdk.messages.output import AgentOutput


class SimpleTestAgent(BaseAgent):
    """Simple agent implementation for testing."""

    def __init__(self):
        super().__init__()
        self.session_started = False
        self.session_ended = False
        self.interrupted = False
        self.config_updated = False
        self.processed_inputs = []

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        self.processed_inputs.append(input)
        yield AgentOutput.text_final(input.session_id, f"Echo: {input.text}")

    async def on_interrupt(self, session_id: str) -> None:
        self.interrupted = True

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        await super().on_session_start(session_id, config)
        self.session_started = True
        self.start_config = config

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        result = await super().on_session_end(session_id)
        self.session_ended = True
        return {"processed": len(self.processed_inputs)}

    async def on_config_update(self, session_id: str, config: Dict[str, Any]) -> None:
        await super().on_config_update(session_id, config)
        self.config_updated = True


class TestBaseAgent:
    """Tests for BaseAgent."""

    @pytest.fixture
    def agent(self):
        """Create a test agent instance."""
        return SimpleTestAgent()

    @pytest.mark.asyncio
    async def test_session_start(self, agent):
        """Test session start lifecycle."""
        config = {"model": "test-model"}
        await agent.on_session_start("test-session", config)

        assert agent.session_started is True
        assert agent.session_id == "test-session"
        assert agent.start_config == config

    @pytest.mark.asyncio
    async def test_session_end(self, agent):
        """Test session end lifecycle."""
        await agent.on_session_start("test-session", {})
        result = await agent.on_session_end("test-session")

        assert agent.session_ended is True
        assert agent.session_id is None  # Cleared by parent
        assert "processed" in result

    @pytest.mark.asyncio
    async def test_process_yields_output(self, agent):
        """Test that process yields AgentOutput."""
        await agent.on_session_start("test-session", {})

        input_msg = AgentInput.text_input("test-session", "Hello")
        outputs = []
        async for output in agent.process(input_msg):
            outputs.append(output)

        assert len(outputs) == 1
        assert outputs[0].content == "Echo: Hello"
        assert len(agent.processed_inputs) == 1

    @pytest.mark.asyncio
    async def test_interrupt(self, agent):
        """Test interrupt handling."""
        await agent.on_session_start("test-session", {})
        await agent.on_interrupt("test-session")

        assert agent.interrupted is True

    @pytest.mark.asyncio
    async def test_config_update(self, agent):
        """Test config update handling."""
        await agent.on_session_start("test-session", {})
        await agent.on_config_update("test-session", {"new_setting": True})

        assert agent.config_updated is True

    def test_initial_state(self, agent):
        """Test agent initial state."""
        assert agent.session_id is None
        assert agent.is_processing is False


class TestStreamingAgent:
    """Tests for streaming behavior."""

    @pytest.mark.asyncio
    async def test_streaming_response(self):
        """Test agent that streams multiple chunks."""

        class StreamingAgent(BaseAgent):
            async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
                # Yield multiple chunks
                yield AgentOutput.thinking(input.session_id)
                yield AgentOutput.text_chunk(input.session_id, "Hello", "tx-1")
                yield AgentOutput.text_chunk(input.session_id, ", ", "tx-1")
                yield AgentOutput.text_chunk(input.session_id, "world!", "tx-1", is_final=True)

            async def on_interrupt(self, session_id: str) -> None:
                pass

        agent = StreamingAgent()
        input_msg = AgentInput.text_input("test-session", "Hi")

        outputs = []
        async for output in agent.process(input_msg):
            outputs.append(output)

        assert len(outputs) == 4
        assert outputs[0].type.value == "status"  # thinking
        assert outputs[1].content == "Hello"
        assert outputs[2].content == ", "
        assert outputs[3].content == "world!"
        assert outputs[3].is_final is True
