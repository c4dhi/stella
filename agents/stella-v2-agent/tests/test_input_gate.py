"""Tests for the InputGate response parsing logic (Stage 1 of the stella-v2 pipeline).

InputGate.classify() makes an LLM call which we cannot unit test here.
Instead we test _parse_response() directly — this is the pure-Python logic
that converts the raw LLM JSON string into a GateResult.

What we test:
- Valid JSON with known experts produces the correct GateResult
- Unknown expert names are filtered out (not in registry)
- Disabled experts are filtered out even if the LLM selected them
- always_triggered experts are always added, even if the LLM omitted them
- always_triggered experts are not duplicated if the LLM already included them
- Invalid JSON produces a failed GateResult
- A non-list "experts" field is treated as empty
- Empty experts list in the response produces an empty GateResult

We build the ExpertRegistry directly in memory using ExpertConfig objects
so no filesystem access or LLM calls are needed.
"""

from stella_v2_agent.pipeline.input_gate import InputGate
from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.experts.base import ExpertConfig
from stella_v2_agent.llm.service import LLMService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_registry(*experts: ExpertConfig) -> ExpertRegistry:
    """Build an ExpertRegistry in memory without loading from disk.

    We create a bare registry and inject ExpertConfig objects directly
    so tests are fully isolated from the filesystem and environment.
    """
    registry = ExpertRegistry.__new__(ExpertRegistry)
    registry._experts = {e.name: e for e in experts}
    registry._overrides = {}
    return registry


def _make_gate(registry: ExpertRegistry) -> InputGate:
    """Build an InputGate with the given registry.

    LLMService is not called in _parse_response(), so we pass None.
    Any test that calls classify() directly would need a real LLMService.
    """
    gate = InputGate.__new__(InputGate)
    gate._registry = registry
    gate._llm_service = None  # not used by _parse_response()
    return gate


def _expert(name: str, enabled: bool = True, always_triggered: bool = False) -> ExpertConfig:
    """Build a minimal ExpertConfig for use in tests."""
    return ExpertConfig(name=name, enabled=enabled, always_triggered=always_triggered)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_valid_json_with_known_experts_returns_correct_gate_result():
    # The LLM returned valid JSON naming two known, enabled experts.
    # Both should appear in the result.
    registry = _make_registry(
        _expert("probing"),
        _expert("medical"),
    )
    gate = _make_gate(registry)

    result = gate._parse_response(
        '{"experts": ["probing", "medical"]}',
        user_input="I have chest pain",
        latency_ms=120.0,
    )

    assert result.failed is False
    assert "probing" in result.experts
    assert "medical" in result.experts
    assert result.cleaned_input == "I have chest pain"
    assert result.latency_ms == 120.0


# ---------------------------------------------------------------------------
# Unknown / disabled expert filtering
# ---------------------------------------------------------------------------

def test_unknown_expert_name_is_filtered_out():
    # The LLM hallucinated an expert name that doesn't exist in the registry.
    # It must be silently dropped — only known experts are allowed.
    registry = _make_registry(_expert("probing"))
    gate = _make_gate(registry)

    result = gate._parse_response(
        '{"experts": ["probing", "nonexistent_expert"]}',
        user_input="hello",
        latency_ms=100.0,
    )

    assert "probing" in result.experts
    assert "nonexistent_expert" not in result.experts


def test_disabled_expert_is_filtered_out():
    # A disabled expert should never be activated, even if the LLM selected it.
    # This is how operators turn off specific experts without changing prompts.
    registry = _make_registry(
        _expert("probing", enabled=True),
        _expert("medical", enabled=False),  # disabled
    )
    gate = _make_gate(registry)

    result = gate._parse_response(
        '{"experts": ["probing", "medical"]}',
        user_input="hello",
        latency_ms=100.0,
    )

    assert "probing" in result.experts
    assert "medical" not in result.experts


# ---------------------------------------------------------------------------
# always_triggered experts
# ---------------------------------------------------------------------------

def test_always_triggered_expert_is_added_even_if_llm_omitted_it():
    # always_triggered experts bypass the gate entirely — they run on every turn.
    # If the LLM didn't include them, they must be injected here.
    registry = _make_registry(
        _expert("probing"),
        _expert("task_extraction", always_triggered=True),
    )
    gate = _make_gate(registry)

    # LLM only selected probing — task_extraction should still appear
    result = gate._parse_response(
        '{"experts": ["probing"]}',
        user_input="hello",
        latency_ms=100.0,
    )

    assert "probing" in result.experts
    assert "task_extraction" in result.experts


def test_always_triggered_expert_is_not_duplicated_if_llm_included_it():
    # If the LLM already included an always_triggered expert, it must appear
    # exactly once — not twice.
    registry = _make_registry(
        _expert("task_extraction", always_triggered=True),
    )
    gate = _make_gate(registry)

    result = gate._parse_response(
        '{"experts": ["task_extraction"]}',
        user_input="hello",
        latency_ms=100.0,
    )

    assert result.experts.count("task_extraction") == 1


# ---------------------------------------------------------------------------
# Malformed LLM responses
# ---------------------------------------------------------------------------

def test_invalid_json_returns_failed_gate_result():
    # If the LLM returns something that isn't valid JSON (e.g. truncated output,
    # rate limit message), the gate must fail closed rather than crash.
    registry = _make_registry(_expert("probing"))
    gate = _make_gate(registry)

    result = gate._parse_response(
        "this is not json at all",
        user_input="hello",
        latency_ms=50.0,
    )

    assert result.failed is True
    assert result.cleaned_input == "hello"


def test_non_list_experts_field_is_treated_as_empty():
    # The LLM returned valid JSON but "experts" is a string instead of a list.
    # This must be handled gracefully — treated as no experts selected.
    registry = _make_registry(_expert("probing"))
    gate = _make_gate(registry)

    result = gate._parse_response(
        '{"experts": "probing"}',  # string instead of list
        user_input="hello",
        latency_ms=100.0,
    )

    assert result.failed is False
    # "probing" came in as a string, not a list — should not be activated
    assert "probing" not in result.experts


def test_empty_experts_list_returns_empty_result():
    # The LLM returned a valid response but selected no experts.
    # This is a valid outcome — no experts run for this turn.
    registry = _make_registry(_expert("probing"))
    gate = _make_gate(registry)

    result = gate._parse_response(
        '{"experts": []}',
        user_input="hello",
        latency_ms=100.0,
    )

    assert result.failed is False
    assert result.experts == []


def test_missing_experts_field_returns_empty_result():
    # The LLM returned valid JSON but with no "experts" key at all.
    # Should be treated the same as an empty list.
    registry = _make_registry(_expert("probing"))
    gate = _make_gate(registry)

    result = gate._parse_response(
        '{"intent": "greeting"}',  # no "experts" key
        user_input="hello",
        latency_ms=100.0,
    )

    assert result.failed is False
    assert result.experts == []
