"""State-machine tests for the Stella Light Agent (tools-only / agent-driven model, #291).

The state machine no longer derives completion from `required`/optional heuristics
or a turn-based fallback. Instead:
- A state is complete only once EVERY task is explicitly completed or skipped.
- `required` is informational; an optional task still must be addressed.
- Setting a deliverable records data but never completes its task.
- The agent advances by completing/skipping tasks (or skipping the whole state).
- `turn_count_exceeded` survives only as a condition a PLAN AUTHOR may add.
"""

import pytest

from stella_light_agent.models.state_machine import (
    Plan,
    State,
    TaskStatus,
)
from stella_light_agent.state_machine.engine import StateMachine
from stella_light_agent.state_machine.execution_state import ExecutionState


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------

def _task(task_id, required=True, deliverables=None):
    return {
        "id": task_id,
        "description": task_id,
        "instruction": "",
        "required": required,
        "deliverables": deliverables or [],
    }


def _deliverable(key, required=True):
    return {"key": key, "type": "string", "description": key, "required": required}


def _machine(states, initial=None):
    machine = StateMachine()
    ok = machine.initialize(
        {
            "id": "plan",
            "title": "Plan",
            "initial_state_id": initial or states[0]["id"],
            "states": states,
        }
    )
    assert ok is True
    return machine


# ===========================================================================
# State.is_complete — all tasks must be completed OR skipped
# ===========================================================================

class TestStateCompletion:
    def test_no_tasks_is_complete(self):
        state = State.from_dict({"id": "s", "type": "loose", "tasks": []})
        assert state.is_complete() is True

    def test_pending_task_blocks_regardless_of_required(self):
        for required in (True, False):
            state = State.from_dict(
                {"id": "s", "type": "loose", "tasks": [_task("t", required=required)]}
            )
            assert state.is_complete() is False, f"required={required}"

    def test_completed_task_satisfies(self):
        state = State.from_dict({"id": "s", "type": "loose", "tasks": [_task("t")]})
        state.tasks[0].status = TaskStatus.COMPLETED
        assert state.is_complete() is True

    def test_skipped_task_satisfies(self):
        state = State.from_dict({"id": "s", "type": "loose", "tasks": [_task("t")]})
        state.tasks[0].status = TaskStatus.SKIPPED
        assert state.is_complete() is True

    def test_mix_of_completed_and_skipped(self):
        state = State.from_dict(
            {"id": "s", "type": "loose", "tasks": [_task("a"), _task("b", required=False)]}
        )
        state.tasks[0].status = TaskStatus.COMPLETED
        assert state.is_complete() is False  # b still pending
        state.tasks[1].status = TaskStatus.SKIPPED
        assert state.is_complete() is True


# ===========================================================================
# No implicit completion (#291 core): all-optional state, deliverables
# ===========================================================================

class TestNoImplicitCompletion:
    def test_all_optional_state_does_not_auto_complete_on_entry(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        assert machine.execution_state.is_current_state_complete() is False
        # No-progress turns below the safety-net limit must NOT advance — there is no
        # eager turn fallback; the state holds until the agent completes/skips it.
        for _ in range(StateMachine.STUCK_STATE_TURN_LIMIT - 1):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "a"

    def test_setting_deliverable_does_not_complete_its_task(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t", deliverables=[_deliverable("name")])],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        machine.process_turn(extracted={"name": "Ada"})
        # Deliverable recorded, task moved to in_progress, but NOT completed.
        assert es.get_deliverable_value("name") == "Ada"
        assert es.current_state.tasks[0].status == TaskStatus.IN_PROGRESS
        assert es.current_state_id == "a"  # no advance — task not completed

    def test_complete_after_setting_deliverable_advances(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t", deliverables=[_deliverable("name")])],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        # Explicitly complete the task (after collecting its deliverable) -> advance.
        result = machine.process_turn(extracted={"name": "Ada"}, completed_task_ids=["t"])
        assert result.transitioned is True
        assert result.transition_reason == "all_required_tasks_complete"
        assert machine.execution_state.current_state_id == "b"


# ===========================================================================
# Explicit completion advances
# ===========================================================================

class TestExplicitCompletion:
    def test_deliverable_less_task_completes_on_mark(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("joke")]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        result = machine.process_turn(completed_task_ids=["joke"])
        assert result.transitioned is True
        assert machine.execution_state.current_state_id == "b"

    def test_all_tasks_must_be_addressed_before_advance(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("a1"), _task("a2", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        machine.process_turn(completed_task_ids=["a1"])  # a2 still pending
        assert machine.execution_state.current_state_id == "a"
        machine.process_turn(completed_task_ids=["a2"])
        assert machine.execution_state.current_state_id == "b"


# ===========================================================================
# Skip — single task and whole state
# ===========================================================================

class TestSkip:
    def test_skip_task_counts_as_addressed(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("a1"), _task("a2", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        machine.process_turn(completed_task_ids=["a1"])
        assert machine.execution_state.current_state_id == "a"
        # Skip the optional remaining task -> state complete -> advance.
        result = machine.process_turn(skipped_task_ids=["a2"])
        assert "a2" in result.skipped_tasks
        assert machine.execution_state.current_state_id == "b"
        assert machine.execution_state.plan.get_state("a").tasks[1].status == TaskStatus.SKIPPED

    def test_skip_a_required_task_is_allowed(self):
        # required is informational — a required task may still be skipped.
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("req", required=True)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        machine.process_turn(skipped_task_ids=["req"])
        assert machine.execution_state.current_state_id == "b"

    def test_skip_current_state_skips_all_remaining(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("a1"), _task("a2"), _task("a3")]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        es.mark_task_completed("a1")
        skipped = es.skip_current_state()
        assert sorted(skipped) == ["a2", "a3"]  # a1 already completed, not re-skipped
        assert es.is_current_state_complete() is True
        # Engine advances on next evaluation.
        machine.process_turn()
        assert es.current_state_id == "b"

    def test_skip_is_progress_not_a_no_progress_turn(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("a1"), _task("a2")]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        machine.process_turn(skipped_task_ids=["a1"])  # progress
        assert es.turns_without_deliverable == 0
        assert es.current_state_id == "a"  # a2 still pending


# ===========================================================================
# Safety net — a stuck state always eventually recovers (last resort)
# ===========================================================================

class TestSafetyNet:
    def test_force_advances_a_stuck_state(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        result = None
        # Agent never completes/skips: after STUCK_STATE_TURN_LIMIT no-progress
        # turns the state force-advances rather than hanging forever.
        for _ in range(StateMachine.STUCK_STATE_TURN_LIMIT):
            result = machine.process_turn()
        assert es.current_state_id == "b"
        assert result.transitioned is True
        assert result.transition_reason == "safety_net_stuck"
        # Counters reset on the forced advance.
        assert es.turns_without_deliverable == 0

    def test_does_not_fire_before_the_limit(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        for _ in range(StateMachine.STUCK_STATE_TURN_LIMIT - 1):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "a"

    def test_progress_resets_the_safety_net_counter(self):
        # Making progress (even without completing) defers the safety net, since it
        # keys off consecutive no-progress turns.
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t", required=False, deliverables=[_deliverable("note", required=False)])],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        for i in range(StateMachine.STUCK_STATE_TURN_LIMIT - 1):
            machine.process_turn()
        # One genuine progress turn resets the counter...
        machine.process_turn(extracted={"note": f"v"})
        assert es.turns_without_deliverable == 0
        assert es.current_state_id == "a"  # not force-advanced

    def test_terminal_stuck_state_stays_put(self):
        # The last state has nowhere to advance — the safety net must not fire.
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t")]},
                {"id": "b", "type": "loose", "tasks": [_task("opt", required=False)]},
            ]
        )
        machine.process_turn(completed_task_ids=["t"])  # a -> b (terminal)
        for _ in range(StateMachine.STUCK_STATE_TURN_LIMIT + 3):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "b"


# ===========================================================================
# ensure_transitions — default routing, NO turn fallback auto-injection
# ===========================================================================

class TestEnsureTransitions:
    def test_default_transition_is_all_tasks_complete(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t")]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        assert len(a.transitions) == 1
        assert a.transitions[0].condition_type == "all_tasks_complete"
        assert a.transitions[0].target_state_id == "b"

    def test_no_turn_fallback_injected_for_all_optional_state(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        assert all(t.condition_type != "turn_count_exceeded" for t in a.transitions)

    def test_last_state_has_no_transitions(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t")]},
                {"id": "b", "type": "loose", "tasks": [_task("opt", required=False)]},
            ]
        )
        assert machine.plan.get_state("b").transitions == []

    def test_authored_transitions_are_kept(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t")],
                    "transitions": [
                        {"target_state_id": "c", "condition_type": "all_tasks_complete", "priority": 1}
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        assert [t.target_state_id for t in a.transitions] == ["c"]


# ===========================================================================
# Transition topology: linear, non-linear, backward, terminal
# ===========================================================================

class TestTransitionTopology:
    def test_non_linear_skips_middle_state(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t")],
                    "transitions": [
                        {"target_state_id": "c", "condition_type": "all_tasks_complete", "priority": 1}
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        machine.process_turn(completed_task_ids=["t"])
        assert machine.execution_state.current_state_id == "c"

    def test_backward_jump(self):
        # 'a' has its own pending task so landing there does not immediately
        # re-advance (an empty state is vacuously complete and would chain onward).
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("ax")]},
                {
                    "id": "b",
                    "type": "loose",
                    "tasks": [_task("t")],
                    "transitions": [
                        {"target_state_id": "a", "condition_type": "all_tasks_complete", "priority": 1}
                    ],
                },
            ],
            initial="b",
        )
        machine.process_turn(completed_task_ids=["t"])
        assert machine.execution_state.current_state_id == "a"
        # 'a' still has a pending task, so it holds until that task is addressed.
        assert machine.execution_state.is_current_state_complete() is False

    def test_advance_to_state_resets_counters(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t")]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        es.record_turn(made_progress=False)
        es.total_turns = 5
        es.advance_to_state("b")
        assert es.turns_without_deliverable == 0
        assert es.total_turns == 0
        assert es.state_just_changed is True


# ===========================================================================
# deliverable_value / deliverable_exists author routes still work
# ===========================================================================

class TestAuthorRoutes:
    def test_deliverable_value_route(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t", deliverables=[_deliverable("choice")])],
                    "transitions": [
                        {
                            "target_state_id": "c",
                            "condition_type": "deliverable_value",
                            "priority": 1,
                            "condition_config": {"key": "choice", "value": "go-c"},
                        }
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        # The route fires on the deliverable value even though the task isn't completed.
        machine.process_turn(extracted={"choice": "go-c"})
        assert machine.execution_state.current_state_id == "c"

    def test_author_turn_count_exceeded_still_supported(self):
        # Plan author opts in to a turn-based escape hatch; the engine no longer
        # injects it, but it must still evaluate when authored explicitly.
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("opt", required=False)],
                    "transitions": [
                        {
                            "target_state_id": "b",
                            "condition_type": "turn_count_exceeded",
                            "priority": 1,
                            "condition_config": {"turns": 3, "scope": "without_progress"},
                        }
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        for _ in range(2):
            machine.process_turn()
            assert machine.execution_state.current_state_id == "a"
        machine.process_turn()  # third no-progress turn
        assert machine.execution_state.current_state_id == "b"


# ===========================================================================
# Goal-state downgrade (no native goal type at runtime)
# ===========================================================================

class TestGoalDowngrade:
    def test_goal_downgraded_to_loose_with_synthetic_task(self):
        machine = _machine(
            [
                {
                    "id": "g",
                    "type": "goal",
                    "title": "Goal",
                    "goal": {"objective": "collect name", "deliverables": [_deliverable("name")]},
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        g = machine.plan.get_state("g")
        assert g.type.value == "loose"
        assert g.tasks[0].id == "__goal__"
        # The synthetic goal task must be explicitly completed to advance.
        assert machine.execution_state.is_current_state_complete() is False
        machine.process_turn(extracted={"name": "Ada"}, completed_task_ids=["__goal__"])
        assert machine.execution_state.current_state_id == "b"

    def test_empty_goal_advances_when_skipped(self):
        machine = _machine(
            [
                {"id": "g", "type": "goal", "title": "Goal",
                 "goal": {"objective": "welcome", "deliverables": []}},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        # Nothing auto-advances; the agent skips the objective task to move on.
        machine.process_turn(skipped_task_ids=["__goal__"])
        assert machine.execution_state.current_state_id == "b"


# ===========================================================================
# Full walkthrough
# ===========================================================================

def test_full_plan_walkthrough():
    machine = _machine(
        [
            {"id": "intro", "type": "loose",
             "tasks": [_task("name_task", deliverables=[_deliverable("name")])]},
            {"id": "smalltalk", "type": "loose",
             "tasks": [_task("chat", required=False, deliverables=[_deliverable("hobby", required=False)])]},
            {"id": "done", "type": "loose", "tasks": []},
        ]
    )
    es = machine.execution_state

    # 1. intro: collecting the name does not advance until the task is completed.
    machine.process_turn(extracted={"name": "Ada"})
    assert es.current_state_id == "intro"
    machine.process_turn(completed_task_ids=["name_task"])
    assert es.current_state_id == "smalltalk"

    # 2. smalltalk is all-optional: it does NOT time out; the agent skips it to move on.
    for _ in range(5):
        machine.process_turn()
        assert es.current_state_id == "smalltalk"
    machine.process_turn(skipped_task_ids=["chat"])
    assert es.current_state_id == "done"

    # 3. done is the terminal state.
    for _ in range(3):
        machine.process_turn()
    assert es.current_state_id == "done"
