"""Tests for the deferred-tool registry + session-end drain (#198/#303)."""

import asyncio

import pytest

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput


class _Agent(BaseAgent):
    async def process(self, input: AgentInput):  # pragma: no cover - unused
        yield AgentOutput.text_final(input.session_id, "ok")

    async def on_interrupt(self, session_id: str) -> None:  # pragma: no cover
        pass

    async def on_session_end(self, session_id: str):  # pragma: no cover
        return {}


@pytest.mark.asyncio
class TestDeferredToolDrain:
    async def test_no_pending_tools_drains_clean(self):
        agent = _Agent()
        result = await agent.drain_pending_tools(1000)
        assert result == {"delivered": [], "cancelled": []}

    async def test_tool_that_finishes_in_time_is_delivered(self):
        agent = _Agent()

        async def quick():
            await asyncio.sleep(0.01)
            return "answer"

        agent.defer_tool("lookup", quick())
        result = await agent.drain_pending_tools(1000)  # 1s budget, tool takes 10ms

        assert result == {"delivered": ["lookup"], "cancelled": []}
        # Registry emptied — nothing can be processed after teardown.
        assert agent._pending_tools == {}

    async def test_tool_that_overruns_is_cancelled(self):
        agent = _Agent()
        started = asyncio.Event()

        async def slow():
            started.set()
            await asyncio.sleep(10)  # far longer than the drain budget

        task = agent.defer_tool("slow_lookup", slow())
        await started.wait()
        result = await agent.drain_pending_tools(20)  # 20ms budget

        assert result == {"delivered": [], "cancelled": ["slow_lookup"]}
        assert task.cancelled()
        assert agent._pending_tools == {}

    async def test_errored_tool_counts_as_cancelled(self):
        agent = _Agent()

        async def boom():
            raise RuntimeError("tool failed")

        agent.defer_tool("broken", boom())
        result = await agent.drain_pending_tools(1000)

        assert result == {"delivered": [], "cancelled": ["broken"]}

    async def test_mixed_delivered_and_cancelled(self):
        agent = _Agent()

        async def quick():
            await asyncio.sleep(0.01)

        async def slow():
            await asyncio.sleep(10)

        agent.defer_tool("fast", quick())
        agent.defer_tool("slow", slow())
        result = await agent.drain_pending_tools(100)  # 100ms: fast lands, slow doesn't

        assert result["delivered"] == ["fast"]
        assert result["cancelled"] == ["slow"]

    async def test_completed_tool_auto_removed_from_registry(self):
        agent = _Agent()

        async def quick():
            return 1

        task = agent.defer_tool("done", quick())
        await task
        await asyncio.sleep(0)  # let the done-callback run
        assert "done" not in agent._pending_tools
