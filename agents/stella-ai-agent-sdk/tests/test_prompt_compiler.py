"""Tests for the shared SDK prompt-compiler library and the single compile entry point."""

import pytest

from stella_agent_sdk import prompts
from stella_agent_sdk.prompts import (
    PromptCompiler,
    PlaceholderPromptCompiler,
    compile_prompt,
    validate_template,
    get_compiler,
    register_compiler,
    available_versions,
    latest_version,
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


# --- single compile() entry point -------------------------------------------------

def test_compile_resolves_against_runtime_context():
    out = prompts.compile(
        "State {{current_state}} / {{progress_percentage}} / "
        "{{collected_deliverables}} / {{history_1}} / {{user_message}}",
        version=COMPILER_VERSION,
        sm_context=_ctx(),
        conversation_history=[{"role": "user", "content": "hi"}],
        user_input="My name is Sam",
    )
    assert "Intake" in out
    assert "50%" in out
    assert "age" in out
    assert "[USER]: hi" in out
    assert "My name is Sam" in out


def test_compile_requires_an_explicit_version():
    # No implicit "latest": calling without a version is an error, so an SDK
    # upgrade can never silently change how an agent's prompts compile.
    with pytest.raises(TypeError):
        prompts.compile("{{current_state}}", sm_context=_ctx())  # type: ignore[call-arg]
    with pytest.raises(ValueError):
        prompts.compile("{{current_state}}", None, sm_context=_ctx())  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        prompts.compile("{{current_state}}", "", sm_context=_ctx())


def test_compile_leaves_unknown_tokens_and_is_noop_without_tokens():
    assert "{{nope}}" in prompts.compile("x {{nope}} y", COMPILER_VERSION, sm_context=_ctx())
    assert prompts.compile("plain", COMPILER_VERSION, sm_context=_ctx()) == "plain"
    assert prompts.compile("", COMPILER_VERSION, sm_context=_ctx()) == ""
    assert prompts.compile(None, COMPILER_VERSION, sm_context=_ctx()) is None


def test_compile_unknown_version_raises():
    with pytest.raises(KeyError):
        prompts.compile("{{current_state}}", "99.0.0", sm_context=_ctx())


# --- registry / versioning --------------------------------------------------------

def test_registry_has_builtin_version():
    assert COMPILER_VERSION in available_versions()
    assert latest_version() == COMPILER_VERSION
    assert get_compiler(COMPILER_VERSION) is PlaceholderPromptCompiler
    assert issubclass(PlaceholderPromptCompiler, PromptCompiler)


def test_get_compiler_requires_explicit_version():
    with pytest.raises(ValueError):
        get_compiler(None)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        get_compiler("")


def test_register_compiler_adds_a_selectable_version():
    class V2(PlaceholderPromptCompiler):
        VERSION = "2.0.0-test"

    try:
        register_compiler(V2)
        assert "2.0.0-test" in available_versions()
        assert get_compiler("2.0.0-test") is V2
        assert latest_version() == "2.0.0-test"  # sorts above 1.0.0
        # The single entry point can target the new version explicitly.
        assert prompts.compile("{{current_state}}", version="2.0.0-test", sm_context=_ctx())
    finally:
        # Keep the registry clean for other tests.
        from stella_agent_sdk.prompts import registry
        registry._REGISTRY.pop("2.0.0-test", None)


def test_register_compiler_rejects_placeholder_version():
    class Bad(PromptCompiler):
        VERSION = "0.0.0"

        def compile(self, template):
            return template

    with pytest.raises(ValueError):
        register_compiler(Bad)


# --- versioning primitives --------------------------------------------------------

def test_validate_template_reports_only_unknown():
    assert validate_template("{{plan}} {{history_8}} {{user_message}}") == []
    assert validate_template("{{plan}} {{bogus}} {{nope}}") == ["bogus", "nope"]
    assert validate_template(None) == []


def test_known_placeholders_and_version():
    assert COMPILER_VERSION == PlaceholderPromptCompiler.VERSION
    assert "plan" in KNOWN_PLACEHOLDERS
    assert "history_N" in KNOWN_PLACEHOLDERS
    assert PlaceholderPromptCompiler.known_placeholders() == KNOWN_PLACEHOLDERS


def test_functional_helper_matches_facade():
    ctx = _ctx()
    expected = compile_prompt("{{current_state}}", {**ctx, "_conversation_history": [], "_user_input": ""})
    assert prompts.compile("{{current_state}}", COMPILER_VERSION, sm_context=ctx) == expected
