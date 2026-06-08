"""Phase-1/Phase-2 alignment in the ToolProcessor.

The light agent answers in two LLM passes: Phase 1 streams the spoken reply
(no tools), Phase 2 separately decides which tools to call. Historically Phase 2
ran from the SAME [system, user] context as Phase 1 and never saw what Phase 1
actually said, so the two diverged — the agent could warmly acknowledge a goal
in speech while the tool phase failed to record it, leaving the deliverable
uncollected and the conversation looping (observed in prod session
978ad68c… "Like I said I want to be more consistent").

These tests pin the fix: Phase 2 now receives Phase 1's reply plus an explicit
extraction directive, so the model that SPEAKS informs the model that RECORDS.
"""

import asyncio
from types import SimpleNamespace

from stella_agent_sdk.tools import ToolResult
from stella_light_agent.llm.service import LLMResponse, LLMToolCall
from stella_light_agent.tool_processor import ToolProcessor, ToolProcessorResult


PHASE1_REPLY = "Consistency is such an important goal, Felix!"


class _FakeLLMService:
    """Records every generate() call and drives the streaming callback.

    Phase 1 (no tools, with callback) streams PHASE1_REPLY. Phase 2 (tools set)
    returns a single set_deliverable tool call. The messages each phase received
    are captured so the test can assert Phase 2 saw Phase 1's reply.
    """

    def __init__(self):
        self.default_config = SimpleNamespace(
            model="gpt-4o-mini", temperature=0.7, max_tokens=800
        )
        self.phase1_messages = None
        self.phase2_messages = None

    async def generate(self, messages, config, callback=None, component_name=None):
        if config.tools:  # Phase 2 — tool extraction
            self.phase2_messages = messages
            return LLMResponse(
                content="",
                model="fake",
                provider="fake",
                tool_calls=[
                    LLMToolCall(
                        id="call-1",
                        name="set_deliverable",
                        arguments={"key": "fitness_goal", "value": "more consistent"},
                    )
                ],
            )

        # Phase 1 — spoken reply, streamed through the callback.
        self.phase1_messages = messages
        if callback is not None:
            await callback.on_token(PHASE1_REPLY, PHASE1_REPLY)
            await callback.on_complete(
                LLMResponse(content=PHASE1_REPLY, model="fake", provider="fake")
            )
        return LLMResponse(content=PHASE1_REPLY, model="fake", provider="fake")


class _FakeTool:
    def __init__(self):
        self.executed_with = None

    async def execute(self, **kwargs):
        self.executed_with = kwargs
        return ToolResult(success=True, data={"transitioned": False})


class _FakeRegistry:
    def __init__(self, tool):
        self._tool = tool

    def get_openai_schemas(self):
        return [{"function": {"name": "set_deliverable"}}]

    def get(self, name):
        return self._tool


async def _run() -> tuple[_FakeLLMService, _FakeTool, ToolProcessorResult]:
    llm = _FakeLLMService()
    tool = _FakeTool()
    proc = ToolProcessor(llm_service=llm, tool_registry=_FakeRegistry(tool))

    result = None
    async for output in proc.process(
        session_id="s1",
        system_prompt="You are Grace.",
        user_message="I think I try to be more consistent with it",
    ):
        if isinstance(output, ToolProcessorResult):
            result = output
    return llm, tool, result


def test_phase2_receives_phase1_reply_and_extraction_directive():
    llm, _tool, _result = asyncio.run(_run())

    assert llm.phase2_messages is not None, "Phase 2 must have run"
    roles = [m.role for m in llm.phase2_messages]
    contents = [m.content for m in llm.phase2_messages]

    # Phase 2 must see what Phase 1 actually said (the alignment fix).
    assert "assistant" in roles, "Phase 2 must include the assistant's Phase 1 reply"
    assert any(PHASE1_REPLY in c for c in contents), (
        "Phase 2 context must contain Phase 1's spoken reply"
    )

    # And an explicit directive to record what was provided/acknowledged.
    directive = contents[-1].lower()
    assert "set_deliverable" in directive
    assert "record" in directive
    # It must stay silent (internal bookkeeping, no second spoken turn).
    assert "only tool calls" in directive or "do not produce" in directive


def test_phase2_extracts_the_acknowledged_deliverable():
    _llm, tool, result = asyncio.run(_run())

    # The deliverable the reply acknowledged is actually recorded now.
    assert tool.executed_with == {"key": "fitness_goal", "value": "more consistent"}
    assert result is not None
    assert "fitness_goal" in result.deliverables_set


def test_phase1_reply_is_still_the_spoken_message():
    # The text-first streaming contract is preserved: the user still gets the
    # Phase 1 reply as the spoken message, unaffected by the Phase 2 directive.
    _llm, _tool, result = asyncio.run(_run())
    assert result.message == PHASE1_REPLY
