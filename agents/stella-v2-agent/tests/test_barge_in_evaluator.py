"""Tests for the Barge-in Evaluator stage."""

from types import SimpleNamespace

import pytest

from stella_agent_sdk.messages.types import BargeInDecision
from stella_v2_agent.pipeline.barge_in_evaluator import BargeInEvaluator


class FakeLLM:
    """Records the last prompt and returns a canned decision word."""

    def __init__(self, reply: str = "COMMIT"):
        self.reply = reply
        self.last_system_prompt = None
        self.last_user_message = None

    async def generate(self, messages, config, component_name=""):
        self.last_system_prompt = messages[0].content
        self.last_user_message = messages[1].content
        return SimpleNamespace(content=self.reply)


def test_parse_decision():
    assert BargeInEvaluator._parse_decision("COMMIT") == BargeInDecision.COMMIT
    assert BargeInEvaluator._parse_decision("resume") == BargeInDecision.RESUME
    assert BargeInEvaluator._parse_decision("  RESUME\n") == BargeInDecision.RESUME
    # Ambiguous / unexpected output defaults to COMMIT (don't drop real interrupts).
    assert BargeInEvaluator._parse_decision("maybe") == BargeInDecision.COMMIT
    assert BargeInEvaluator._parse_decision("") == BargeInDecision.COMMIT


def test_apply_config():
    ev = BargeInEvaluator(FakeLLM())
    ev.apply_config({
        "model": "gpt-4o",
        "temperature": 0.3,
        "max_tokens": 5,
        "system_prompt": "custom {{bargeInTranscript}}",
    })
    assert ev.model == "gpt-4o"
    assert ev.temperature == 0.3
    assert ev.max_tokens == 5
    assert ev.custom_system_prompt == "custom {{bargeInTranscript}}"


@pytest.mark.asyncio
async def test_empty_transcript_resumes_without_llm():
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    assert await ev.evaluate("") == BargeInDecision.RESUME
    assert await ev.evaluate("   ") == BargeInDecision.RESUME
    assert llm.last_system_prompt is None  # LLM never called


@pytest.mark.asyncio
async def test_evaluate_commit_and_resume():
    assert await BargeInEvaluator(FakeLLM("COMMIT")).evaluate("stop, that's wrong") == BargeInDecision.COMMIT
    assert await BargeInEvaluator(FakeLLM("RESUME")).evaluate("mhm") == BargeInDecision.RESUME


@pytest.mark.asyncio
async def test_custom_prompt_renders_transcript_variable():
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    ev.apply_config({"system_prompt": "They said: {{bargeInTranscript}}"})
    await ev.evaluate("wait a second")
    assert llm.last_system_prompt == "They said: wait a second"


@pytest.mark.asyncio
async def test_conversation_history_is_included_in_context():
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    history = [
        {"role": "assistant", "content": "Was möchtest du gerne genannt werden?"},
        {"role": "user", "content": "(thinking)"},
    ]
    decision = await ev.evaluate("My name is felix", conversation_history=history)
    assert decision == BargeInDecision.COMMIT
    # The user message must carry the conversation context + the interruption.
    assert "CONVERSATION SO FAR" in llm.last_user_message
    assert "Was möchtest du gerne genannt werden?" in llm.last_user_message
    assert "My name is felix" in llm.last_user_message


@pytest.mark.asyncio
async def test_history_limit_trims_context():
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    ev.apply_config({"history_limit": 2})
    history = [{"role": "user", "content": f"msg{i}"} for i in range(10)]
    await ev.evaluate("hello there", conversation_history=history)
    # Only the last 2 messages are included.
    assert "msg9" in llm.last_user_message
    assert "msg8" in llm.last_user_message
    assert "msg7" not in llm.last_user_message


@pytest.mark.asyncio
async def test_works_without_history():
    llm = FakeLLM("RESUME")
    ev = BargeInEvaluator(llm)
    assert await ev.evaluate("mhm") == BargeInDecision.RESUME
    assert "My name" not in (llm.last_user_message or "")
    assert "mhm" in llm.last_user_message


@pytest.mark.asyncio
async def test_llm_failure_defaults_to_commit():
    class BoomLLM:
        async def generate(self, *a, **k):
            raise RuntimeError("llm down")

    ev = BargeInEvaluator(BoomLLM())
    assert await ev.evaluate("anything") == BargeInDecision.COMMIT
