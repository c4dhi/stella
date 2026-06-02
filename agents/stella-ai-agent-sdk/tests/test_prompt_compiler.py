"""Tests for the shared SDK prompt-compiler library."""

import pytest

from stella_agent_sdk.prompts import (
    PromptCompiler,
    PlaceholderPromptCompiler,
    compile_prompt,
    validate_template,
    get_compiler,
    register_compiler,
    available_compilers,
    COMPILER_VERSION,
    KNOWN_PLACEHOLDERS,
)


def _ctx():
    return {
        "state": {"id": "s1", "title": "Intake", "description": "Collect basics"},
        "processing_mode": "loose",
        "current_task": {"id": "t1", "description": "Ask for name"},
        "deliverables": [
            {"key": "user_name", "description": "the name", "type": "string", "required": True, "status": "pending"},
            {"key": "age", "value": 42, "status": "completed"},
        ],
        "progress": {"percentage": 50, "turns_without_deliverable": 2},
    }


def test_registry_exposes_placeholder_compiler():
    assert "placeholder" in available_compilers()
    assert get_compiler("placeholder") is PlaceholderPromptCompiler
    assert issubclass(PlaceholderPromptCompiler, PromptCompiler)


def test_get_compiler_unknown_name_raises():
    with pytest.raises(KeyError):
        get_compiler("does-not-exist")


def test_compile_resolves_known_placeholders():
    compiler = PlaceholderPromptCompiler(
        _ctx(),
        conversation_history=[{"role": "user", "content": "hi"}],
        user_input="My name is Sam",
    )
    out = compiler.compile(
        "State {{current_state}} / {{progress_percentage}} / "
        "{{collected_deliverables}} / {{history_1}} / {{user_message}}"
    )
    assert "Intake" in out
    assert "50%" in out
    assert "age" in out
    assert "[USER]: hi" in out
    assert "My name is Sam" in out


def test_unknown_placeholder_is_left_as_is():
    compiler = PlaceholderPromptCompiler(_ctx())
    assert "{{not_a_var}}" in compiler.compile("x {{not_a_var}} y")


def test_compile_is_noop_without_tokens():
    compiler = PlaceholderPromptCompiler(_ctx())
    assert compiler.compile("plain text") == "plain text"
    assert compiler.compile("") == ""
    assert compiler.compile(None) is None


def test_validate_template_reports_only_unknown():
    assert validate_template("{{plan}} {{history_8}} {{user_message}}") == []
    assert validate_template("{{plan}} {{bogus}} {{nope}}") == ["bogus", "nope"]
    assert validate_template(None) == []


def test_versioning_primitives():
    assert COMPILER_VERSION == PlaceholderPromptCompiler.VERSION
    assert "plan" in KNOWN_PLACEHOLDERS
    assert "history_N" in KNOWN_PLACEHOLDERS
    assert PlaceholderPromptCompiler.known_placeholders() == KNOWN_PLACEHOLDERS


def test_functional_compile_prompt_matches_class():
    ctx = _ctx()
    tpl = "{{current_state}}"
    compiler = PlaceholderPromptCompiler(ctx)
    assert compiler.compile(tpl) == compile_prompt(tpl, {**ctx, "_conversation_history": [], "_user_input": ""})


def test_register_compiler_rejects_base_name():
    class Bad(PromptCompiler):
        NAME = "base"

        def compile(self, template):
            return template

    with pytest.raises(ValueError):
        register_compiler(Bad)
