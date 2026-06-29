"""Tests for the Barge-in Evaluator stage."""

import asyncio
from types import SimpleNamespace

import pytest

from stella_agent_sdk.messages.types import BargeInDecision
from stella_agent_sdk.llm import LLMProvider
from stella_agent_sdk.agent.barge_in_evaluator import BargeInEvaluator


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
async def test_conversation_history_is_rendered_into_the_prompt():
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    history = [
        {"role": "assistant", "content": "Was möchtest du gerne genannt werden?"},
        {"role": "user", "content": "(thinking)"},
    ]
    decision = await ev.evaluate("My name is felix", conversation_history=history)
    assert decision == BargeInDecision.COMMIT
    # Context flows through the template (system prompt); the interruption itself
    # is the bare user message.
    assert "Was möchtest du gerne genannt werden?" in llm.last_system_prompt
    assert llm.last_user_message == "My name is felix"


@pytest.mark.asyncio
async def test_history_limit_trims_context():
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    ev.apply_config({"history_limit": 2})
    history = [{"role": "user", "content": f"msg{i}"} for i in range(10)]
    await ev.evaluate("hello there", conversation_history=history)
    # Only the last 2 messages are rendered into the prompt.
    assert "msg9" in llm.last_system_prompt
    assert "msg8" in llm.last_system_prompt
    assert "msg7" not in llm.last_system_prompt


@pytest.mark.asyncio
async def test_works_without_history():
    llm = FakeLLM("RESUME")
    ev = BargeInEvaluator(llm)
    assert await ev.evaluate("mhm") == BargeInDecision.RESUME
    # No history → the {{#if conversationHistory}} context block is dropped.
    assert llm.last_user_message == "mhm"
    assert "Conversation so far" not in llm.last_system_prompt


@pytest.mark.asyncio
async def test_interrupted_reply_variable_is_rendered():
    """The half-committed reply (still in flight, not in history) reaches the
    prompt via {{interruptedReply}} so the interruption is judged against it."""
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    await ev.evaluate(
        "no wait",
        variables={"interruptedReply": "So your preferred name is Felix, and"},
    )
    assert "So your preferred name is Felix, and" in llm.last_system_prompt
    assert llm.last_user_message == "no wait"


@pytest.mark.asyncio
async def test_interrupted_reply_omitted_when_empty():
    llm = FakeLLM("RESUME")
    ev = BargeInEvaluator(llm)
    await ev.evaluate("mhm", variables={"interruptedReply": ""})
    assert "mid-sentence" not in llm.last_system_prompt


@pytest.mark.asyncio
async def test_context_placement_is_template_controlled():
    """The template, not the code, owns context layout: a custom prompt that
    doesn't reference {{conversationHistory}} gets no history at all."""
    llm = FakeLLM("COMMIT")
    ev = BargeInEvaluator(llm)
    ev.apply_config({"system_prompt": "Decide: COMMIT or RESUME."})
    history = [{"role": "assistant", "content": "secret-context-line"}]
    await ev.evaluate("hi", conversation_history=history)
    assert llm.last_system_prompt == "Decide: COMMIT or RESUME."
    assert "secret-context-line" not in llm.last_system_prompt
    assert llm.last_user_message == "hi"


@pytest.mark.asyncio
async def test_llm_failure_defaults_to_commit():
    class BoomLLM:
        async def generate(self, *a, **k):
            raise RuntimeError("llm down")

    ev = BargeInEvaluator(BoomLLM())
    assert await ev.evaluate("anything") == BargeInDecision.COMMIT


@pytest.mark.asyncio
async def test_slow_llm_times_out_to_commit():
    """A slow classifier must not stall the suspended turn — it defaults to
    COMMIT once the tight timeout elapses, regardless of what it would say."""
    class SlowLLM:
        async def generate(self, *a, **k):
            await asyncio.sleep(1.0)
            return SimpleNamespace(content="RESUME")

    ev = BargeInEvaluator(SlowLLM())
    ev.apply_config({"timeout_ms": 20})  # 20ms ceiling
    decision = await ev.evaluate("this would resume if we waited")
    assert decision == BargeInDecision.COMMIT


def test_apply_config_provider_override():
    ev = BargeInEvaluator(FakeLLM())
    assert ev.provider == LLMProvider.OPENAI_LANGCHAIN  # default
    ev.apply_config({"provider": "ollama"})
    assert ev.provider == LLMProvider.OLLAMA
    # An enum value passes through unchanged.
    ev.apply_config({"provider": LLMProvider.OPENAI_DIRECT})
    assert ev.provider == LLMProvider.OPENAI_DIRECT
    # An unknown provider falls back to the OpenAI default rather than crashing.
    ev.apply_config({"provider": "nope"})
    assert ev.provider == LLMProvider.OPENAI_LANGCHAIN


@pytest.mark.asyncio
async def test_configured_provider_reaches_llm_call():
    """The override actually drives the LLM config, not just the attribute."""
    captured = {}

    class CapturingLLM:
        async def generate(self, messages, config, component_name=""):
            captured["provider"] = config.provider
            return SimpleNamespace(content="COMMIT")

    ev = BargeInEvaluator(CapturingLLM())
    ev.apply_config({"provider": "ollama"})
    await ev.evaluate("stop")
    assert captured["provider"] == LLMProvider.OLLAMA
