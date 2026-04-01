"""Tests for the Response Generator stage (Stage 4 of the stella-v2 pipeline).

All testable logic here is pure Python — no LLM calls, no I/O.
We test:
- ResponseDirective.to_prompt_section(): directive → prompt text
- build_response_system_prompt(): persona/guideline/context composition
- build_response_user_message(): history + user input formatting
- ResponseGenerator.apply_config(): runtime config overrides
"""

from stella_v2_agent.models.arbitration_result import ResponseDirective
from stella_v2_agent.pipeline.response_generator import ResponseGenerator
from stella_v2_agent.prompts.response_prompt import (
    build_response_system_prompt,
    build_response_user_message,
)


# ---------------------------------------------------------------------------
# ResponseDirective.to_prompt_section()
# ---------------------------------------------------------------------------

def test_empty_directive_returns_empty_string():
    # A default directive with no meaningful content should produce no prompt section.
    assert ResponseDirective().to_prompt_section() == ""


def test_neutral_tone_is_not_included_in_prompt():
    # "neutral" is the default — no point telling the LLM to be neutral explicitly.
    result = ResponseDirective(tone="neutral").to_prompt_section()
    assert "Tone:" not in result


def test_non_neutral_tone_is_included():
    result = ResponseDirective(tone="cautious", primary_action="x").to_prompt_section()
    assert "Tone: cautious" in result


def test_must_avoid_items_emitted_as_avoid_lines():
    result = ResponseDirective(must_avoid=["medical advice", "legal advice"]).to_prompt_section()
    assert "Avoid: medical advice" in result
    assert "Avoid: legal advice" in result


def test_followup_question_takes_priority_over_primary_action():
    # When both are set, follow-up wins — the LLM must never receive two directions.
    result = ResponseDirective(
        ask_followup=True,
        followup_question="How long have you had this?",
        primary_action="Refer to a doctor",
    ).to_prompt_section()

    assert "How long have you had this?" in result
    assert "Refer to a doctor" not in result


def test_followup_question_emitted_with_correct_prefix():
    result = ResponseDirective(
        ask_followup=True,
        followup_question="What does a typical session look like?",
    ).to_prompt_section()
    assert "Your response should lead to: What does a typical session look like?" in result


def test_primary_action_emitted_when_no_followup():
    result = ResponseDirective(primary_action="Refer to a specialist").to_prompt_section()
    assert "Focus: Refer to a specialist" in result


def test_deliverable_signals_produce_acknowledgment_line():
    result = ResponseDirective(deliverable_signals=["user_name", "user_age"]).to_prompt_section()
    assert "user_name" in result
    assert "user_age" in result
    assert "Acknowledge" in result


# ---------------------------------------------------------------------------
# build_response_system_prompt()
# ---------------------------------------------------------------------------

def test_no_plan_no_persona_uses_default_persona():
    result = build_response_system_prompt({}, ResponseDirective())
    assert "STELLA" in result


def test_plan_system_prompt_replaces_default_persona():
    result = build_response_system_prompt({}, ResponseDirective(), plan_system_prompt="You are Max.")
    assert "You are Max." in result
    assert "STELLA" not in result


def test_custom_persona_replaces_default_when_no_plan():
    result = build_response_system_prompt({}, ResponseDirective(), custom_persona="You are a nurse.")
    assert "You are a nurse." in result
    assert "STELLA" not in result


def test_plan_and_custom_persona_both_included():
    result = build_response_system_prompt(
        {}, ResponseDirective(),
        plan_system_prompt="You are Max.",
        custom_persona="Extra rules here.",
    )
    assert "You are Max." in result
    assert "Extra rules here." in result


def test_custom_guidelines_replace_default_guidelines():
    result = build_response_system_prompt(
        {}, ResponseDirective(), custom_guidelines="Be very brief."
    )
    assert "Be very brief." in result
    # Default guidelines header should not be present
    assert "CONVERSATIONAL STYLE" not in result


def test_directive_section_included_when_directive_has_content():
    directive = ResponseDirective(primary_action="Ask about symptoms")
    result = build_response_system_prompt({}, directive)
    assert "GUIDANCE:" in result
    assert "Ask about symptoms" in result


# ---------------------------------------------------------------------------
# build_response_user_message()
# ---------------------------------------------------------------------------

def test_no_history_returns_only_user_message():
    result = build_response_user_message("Hello there", [])
    assert result == "[USER]: Hello there"


def test_with_history_prepends_formatted_lines():
    history = [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello"},
    ]
    result = build_response_user_message("How are you?", history)
    assert "[USER]: Hi" in result
    assert "[ASSISTANT]: Hello" in result
    assert "[USER]: How are you?" in result


def test_history_limit_truncates_older_messages():
    history = [
        {"role": "user", "content": "msg1"},
        {"role": "assistant", "content": "msg2"},
        {"role": "user", "content": "msg3"},
    ]
    result = build_response_user_message("latest", history, history_limit=1)
    assert "msg3" in result
    assert "msg1" not in result


# ---------------------------------------------------------------------------
# ResponseGenerator.apply_config()
# ---------------------------------------------------------------------------

def test_apply_config_overrides_model_tokens_temperature():
    gen = ResponseGenerator(llm_service=None)
    gen.apply_config({"model": "gpt-4o", "max_tokens": 300, "temperature": 0.3})
    assert gen.response_model == "gpt-4o"
    assert gen.response_max_tokens == 300
    assert gen.response_temperature == 0.3


def test_apply_config_overrides_persona_and_history_limit():
    gen = ResponseGenerator(llm_service=None)
    gen.apply_config({"persona": "You are a coach.", "history_limit": 5})
    assert gen.custom_persona == "You are a coach."
    assert gen.history_limit == 5
