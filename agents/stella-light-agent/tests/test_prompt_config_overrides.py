"""Operator-editable prose blocks override the in-code defaults.

These guard that the safety guardrails and the phase-transition note can be
controlled from the config screen (response.safety_guidelines /
response.state_transition_note slots) without touching code, while the in-code
text remains the safe default when nothing is configured.
"""

from stella_light_agent.prompts import LightPromptBuilder


def _ctx(**over):
    ctx = {
        "processing_mode": "loose",
        "state": {"title": "Goals", "description": "Discuss goals"},
        "deliverables": [],
        "available_tasks": [],
        "collected_deliverables": {},
    }
    ctx.update(over)
    return ctx


def test_default_guardrails_present_when_unconfigured():
    prompt = LightPromptBuilder().build_system_prompt(_ctx())
    assert "## Safety Guidelines (IMPORTANT)" in prompt
    assert "not a replacement for professional advice" in prompt


def test_custom_safety_guidelines_replace_default():
    prompt = LightPromptBuilder().build_system_prompt(
        _ctx(custom_safety_guidelines="## House Rules\nBe brief and kind.")
    )
    assert "## House Rules" in prompt
    assert "Be brief and kind." in prompt
    # The default block must be gone — the developer's text replaces it entirely.
    assert "## Safety Guidelines (IMPORTANT)" not in prompt


def test_default_transition_note_present_when_unconfigured():
    prompt = LightPromptBuilder().build_system_prompt(
        _ctx(state_just_changed=True)
    )
    assert "## State Transition Notice" in prompt
    assert "acknowledge this transition naturally" in prompt


def test_resolved_language_emits_authoritative_directive():
    # The shared SDK language resolver's output flows into the prompt as an
    # authoritative directive (parity with stella-v2).
    de = LightPromptBuilder().build_system_prompt(_ctx(language="de"))
    assert "Respond ENTIRELY in German" in de
    en = LightPromptBuilder().build_system_prompt(_ctx(language="en"))
    assert "Respond ENTIRELY in English" in en


def test_no_resolved_language_omits_authoritative_directive():
    # Without a locked language, only the soft identity rule stands.
    prompt = LightPromptBuilder().build_system_prompt(_ctx())
    assert "Respond ENTIRELY in" not in prompt


def test_custom_transition_note_replaces_body_but_keeps_header_and_title():
    prompt = LightPromptBuilder().build_system_prompt(
        _ctx(
            state={"title": "Wrap Up"},
            state_just_changed=True,
            custom_state_transition_note="Just say a warm goodbye.",
        )
    )
    # Header + live phase title stay in code; only the guidance prose changes.
    assert "## State Transition Notice" in prompt
    assert "**Wrap Up**" in prompt
    assert "Just say a warm goodbye." in prompt
    assert "acknowledge this transition naturally" not in prompt
