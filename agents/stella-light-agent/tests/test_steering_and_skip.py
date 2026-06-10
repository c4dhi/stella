"""Tests for #306: deliverable-driven steering + precise skip semantics.

Two layers:
1. Prompt-builder unit tests (pure, no I/O) — assert the steering block and skip
   intent-mapping render correctly from context.
2. Agent wiring tests — assert turns_without_progress and the "state just changed"
   signal actually flow from the state machine into the prompt across turns.
"""

import asyncio
from typing import Any, AsyncIterator, Dict, List, Optional

import pytest

from stella_light_agent.agent import StellaLightAgent
from stella_light_agent.prompts import LightPromptBuilder
from stella_light_agent.tool_processor import ToolProcessorResult


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1: prompt-builder steering (#306 requirement 1)
# ─────────────────────────────────────────────────────────────────────────────

def _context_with_pending(turns_without_progress: int = 0) -> Dict[str, Any]:
    return {
        "processing_mode": "loose",
        "state": {"title": "Goals and Challenges", "description": "Discuss goals"},
        "progress": {"percentage": 20.0},
        "state_just_changed": False,
        "turns_without_progress": turns_without_progress,
        "current_task": {"id": "t1", "description": "Discuss fitness goals"},
        "available_tasks": [
            {"id": "t1", "description": "Discuss fitness goals", "has_deliverables": True}
        ],
        "deliverables": [
            {
                "key": "fitness_goal",
                "description": "The user's fitness goal",
                "type": "string",
                "required": True,
                "status": "pending",
            }
        ],
        "collected_deliverables": {},
    }


def test_steering_block_lists_pending_and_demands_recall() -> None:
    prompt = LightPromptBuilder().build_system_prompt(_context_with_pending())

    assert "## Steering This Turn" in prompt
    # Anchors to the actual remaining deliverable key.
    assert "fitness_goal" in prompt
    # Warns against the open-ended-coaching failure mode from the ticket.
    assert "open-ended" in prompt.lower()
    # Demands retroactive recall of already-stated answers.
    assert "already" in prompt.lower()
    assert "set_deliverable" in prompt


def test_steering_escalates_when_stuck() -> None:
    stuck = LightPromptBuilder().build_system_prompt(_context_with_pending(turns_without_progress=4))
    assert "4 turns" in stuck
    assert "skip_task" in stuck

    # Below threshold: no escalation warning.
    fresh = LightPromptBuilder().build_system_prompt(_context_with_pending(turns_without_progress=1))
    assert "turns in this phase" not in fresh


def test_steering_when_all_collected_says_complete_and_move_on() -> None:
    ctx = _context_with_pending()
    ctx["deliverables"] = []  # nothing pending
    prompt = LightPromptBuilder().build_system_prompt(ctx)
    assert "## Steering This Turn" in prompt
    assert "already collected" in prompt.lower()
    assert "complete_task" in prompt


def test_no_steering_block_without_state() -> None:
    # Startup / no state machine context: steering must not appear.
    prompt = LightPromptBuilder().build_system_prompt({"processing_mode": "loose"})
    assert "## Steering This Turn" not in prompt


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1: skip intent-mapping (#306 requirement 2)
# ─────────────────────────────────────────────────────────────────────────────

def test_skip_intent_mapping_present() -> None:
    prompt = LightPromptBuilder().build_system_prompt(_context_with_pending())

    # The disambiguation block exists and maps a bare "skip this" to skip_task.
    assert 'Interpreting a "skip" request' in prompt
    assert '"skip this"' in prompt
    # Explicit guidance that a bare skip is the current task, not the whole state.
    lower = prompt.lower()
    assert "does not mean skip the whole phase" in lower
    assert "when in doubt, prefer" in lower
    # skip_state reserved for whole-section intent.
    assert "entire section" in lower or "whole part" in lower


def test_transition_warning_fires_when_state_just_changed() -> None:
    ctx = _context_with_pending()
    ctx["state_just_changed"] = True
    prompt = LightPromptBuilder().build_system_prompt(ctx)
    assert "State Transition Notice" in prompt
    assert "Do NOT continue collecting information from the previous state" in prompt


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2: agent wiring — the signals reach the prompt across turns
# ─────────────────────────────────────────────────────────────────────────────

class _FakeSMClient:
    """Minimal async stand-in for StateMachineClient used by _process_with_tools."""

    def __init__(self, turns_without_progress: int = 0) -> None:
        self._twp = turns_without_progress

    async def get_current_state(self) -> Dict[str, Any]:
        return {
            "state_id": "s1",
            "state_title": "Goals and Challenges",
            "state_type": "loose",
            "progress": 0.2,
            "turns_without_progress": self._twp,
            "total_turns": 5,
        }

    async def get_pending_tasks(self) -> List[Dict[str, Any]]:
        return [{"id": "t1", "description": "Discuss goals", "is_preview": False, "has_deliverables": True}]

    async def get_pending_deliverables(self) -> List[Dict[str, Any]]:
        return [{"key": "fitness_goal", "description": "The goal", "type": "string", "required": True}]

    async def get_collected_deliverables(self) -> Dict[str, Any]:
        return {}

    async def get_full_state(self) -> Dict[str, Any]:
        return {"states": [], "progress": 0.2, "current_state_id": "s1", "turns_without_progress": self._twp}

    async def increment_turn(self) -> None:
        return None


class _FakeToolProcessor:
    """Yields a single ToolProcessorResult so _process_with_tools can finish."""

    def __init__(self, result: ToolProcessorResult) -> None:
        self._result = result

    async def process(self, session_id, system_prompt, user_message) -> AsyncIterator[Any]:
        # Mimic the real processor: yields outputs then the result sentinel.
        yield self._result


def _make_agent(monkeypatch: pytest.MonkeyPatch) -> StellaLightAgent:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    agent = StellaLightAgent()

    async def _no_history(limit: int = 20) -> List[Dict[str, str]]:
        return []

    agent._fetch_conversation_history = _no_history  # type: ignore[assignment]
    return agent


def _run_turn(agent: StellaLightAgent) -> Dict[str, Any]:
    """Drive one _process_with_tools turn, capturing the built system prompt."""

    class _Inp:
        session_id = "sess-1"
        text = "Like I said, I want to be more consistent."

    captured: Dict[str, Any] = {}
    real_build = agent.prompt_builder.build_system_prompt

    def _capture(context: Dict[str, Any]) -> str:
        captured["context"] = context
        out = real_build(context)
        captured["prompt"] = out
        return out

    agent.prompt_builder.build_system_prompt = _capture  # type: ignore[assignment]

    async def _drive() -> None:
        async for _ in agent._process_with_tools(_Inp()):
            pass

    asyncio.run(_drive())
    return captured


def test_turns_without_progress_reaches_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    agent = _make_agent(monkeypatch)
    agent.sm_client = _FakeSMClient(turns_without_progress=3)  # type: ignore[assignment]
    agent.tool_processor = _FakeToolProcessor(  # type: ignore[assignment]
        ToolProcessorResult(message="hi", transitioned=False)
    )

    captured = _run_turn(agent)
    assert captured["context"]["turns_without_progress"] == 3
    # Escalation actually rendered in the prompt.
    assert "3 turns" in captured["prompt"]


def test_transition_signal_propagates_to_next_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    agent = _make_agent(monkeypatch)
    agent.sm_client = _FakeSMClient()  # type: ignore[assignment]

    # Turn 1 transitions (e.g. user skipped the section).
    agent.tool_processor = _FakeToolProcessor(  # type: ignore[assignment]
        ToolProcessorResult(message="ok", transitioned=True)
    )
    first = _run_turn(agent)
    # This turn started before the transition, so the warning is NOT shown yet.
    assert first["context"]["state_just_changed"] is False
    # But the agent now remembers the transition for next turn.
    assert agent._state_just_changed is True

    # Turn 2: no transition, but the prompt must acknowledge the change.
    agent.tool_processor = _FakeToolProcessor(  # type: ignore[assignment]
        ToolProcessorResult(message="ok", transitioned=False)
    )
    second = _run_turn(agent)
    assert second["context"]["state_just_changed"] is True
    assert "State Transition Notice" in second["prompt"]
    # Flag cleared after being consumed.
    assert agent._state_just_changed is False
