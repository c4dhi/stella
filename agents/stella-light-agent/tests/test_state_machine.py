"""Comprehensive state-machine tests for the Stella Light Agent (#291).

Covers the all-optional / vacuous-truth bug ported from NestJS #172, plus the
surrounding state-machine behaviour: required-work detection, the turn-based
fallback, transition precedence, linear / non-linear / backward / terminal
transitions, required-vs-optional deliverables, goal-state downgrade, and the
turn-counter semantics that drive turn_count_exceeded.

The light agent has no native "goal" state at runtime — goal states are
downgraded to loose states with a synthetic required task in
``State.from_dict`` — so the goal tests exercise that downgrade path.
"""

import pytest

from stella_light_agent.models.state_machine import (
    Plan,
    State,
    Task,
    Deliverable,
    DeliverableStatus,
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
    """Build and initialize a StateMachine (runs ensure_transitions)."""
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
# State.has_required_work — the core required-work detector
# ===========================================================================

class TestHasRequiredWork:
    def test_no_tasks_has_no_required_work(self):
        state = State.from_dict({"id": "s", "type": "loose", "tasks": []})
        assert state.has_required_work() is False

    def test_optional_task_does_not_block(self):
        state = State.from_dict(
            {"id": "s", "type": "loose", "tasks": [_task("t", required=False)]}
        )
        assert state.has_required_work() is False

    def test_required_task_without_deliverables_blocks(self):
        # e.g. "tell a joke" — agent must explicitly mark it done.
        state = State.from_dict(
            {"id": "s", "type": "loose", "tasks": [_task("t", required=True)]}
        )
        assert state.has_required_work() is True

    def test_required_task_with_only_optional_deliverables_does_not_block(self):
        state = State.from_dict(
            {
                "id": "s",
                "type": "loose",
                "tasks": [
                    _task("t", required=True, deliverables=[_deliverable("d", required=False)])
                ],
            }
        )
        assert state.has_required_work() is False

    def test_required_task_with_a_required_deliverable_blocks(self):
        state = State.from_dict(
            {
                "id": "s",
                "type": "loose",
                "tasks": [
                    _task(
                        "t",
                        required=True,
                        deliverables=[
                            _deliverable("opt", required=False),
                            _deliverable("req", required=True),
                        ],
                    )
                ],
            }
        )
        assert state.has_required_work() is True

    def test_optional_task_with_required_deliverable_does_not_block(self):
        # An optional task never blocks, regardless of its deliverables.
        state = State.from_dict(
            {
                "id": "s",
                "type": "loose",
                "tasks": [
                    _task("t", required=False, deliverables=[_deliverable("req", required=True)])
                ],
            }
        )
        assert state.has_required_work() is False


# ===========================================================================
# is_complete vs has_required_work — vacuous truth is guarded, not removed
# ===========================================================================

class TestVacuousTruthGuard:
    def test_is_complete_is_still_vacuously_true(self):
        # is_complete() itself is documented as vacuously true; the guard lives
        # one level up in is_current_state_complete.
        state = State.from_dict({"id": "s", "type": "loose", "tasks": []})
        assert state.is_complete() is True

    def test_all_optional_state_is_not_current_state_complete(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        # The whole point of #291: entering an all-optional state must NOT report
        # complete, so all_tasks_complete cannot fire on entry.
        assert machine.execution_state.is_current_state_complete() is False

    def test_state_with_required_work_uses_real_completion(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t", required=True)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        assert machine.execution_state.is_current_state_complete() is False
        machine.execution_state.mark_task_completed("t")
        assert machine.execution_state.is_current_state_complete() is True

    def test_no_current_state_is_complete(self):
        # A dangling current_state_id is treated as complete (degenerate guard).
        plan = Plan.from_dict({"id": "p", "states": [{"id": "a", "type": "loose", "tasks": []}]})
        es = ExecutionState(plan=plan, current_state_id="does-not-exist")
        assert es.is_current_state_complete() is True


# ===========================================================================
# All-optional state does NOT auto-complete on entry (#291 acceptance)
# ===========================================================================

class TestAllOptionalNoAutoComplete:
    def test_does_not_advance_on_entry(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        # A single no-progress turn must not skip the state instantly.
        result = machine.process_turn()
        assert result.transitioned is False
        assert machine.execution_state.current_state_id == "a"

    def test_empty_state_does_not_advance_on_entry(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": []},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        result = machine.process_turn()
        assert result.transitioned is False
        assert machine.execution_state.current_state_id == "a"


# ===========================================================================
# All-optional state releases after the turn threshold
# ===========================================================================

class TestTurnFallbackRelease:
    def test_releases_after_default_threshold(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        threshold = StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD  # 3

        # Turns 1..threshold-1: counter increments, no transition yet.
        for expected in range(1, threshold):
            result = machine.process_turn()
            assert result.transitioned is False, f"advanced too early on turn {expected}"
            assert es.current_state_id == "a"
            assert es.turns_without_deliverable == expected

        # Turn == threshold: the fallback fires and releases the state.
        result = machine.process_turn()
        assert result.transitioned is True
        assert result.next_state_id == "b"
        assert result.transition_reason == "turn_count_exceeded:without_progress"
        assert es.current_state_id == "b"
        # Advancing resets the per-state counters.
        assert es.turns_without_deliverable == 0
        assert es.total_turns == 0

    def test_resubmitting_unchanged_optional_deliverable_still_releases(self):
        # Regression: set_deliverable_value() returns True whenever the key exists,
        # even if the value did not change. If that were counted as progress, the
        # no-progress counter would reset every turn and an all-optional state with
        # a re-extracted optional deliverable would never release (#291). Only a
        # genuinely changed value counts as progress.
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [
                        _task("t", required=False, deliverables=[_deliverable("mood", required=False)])
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        # First turn collects the value (genuine progress -> counter reset).
        machine.process_turn(extracted={"mood": "ok"})
        assert es.current_state_id == "a"
        assert es.turns_without_deliverable == 0

        # Re-submitting the SAME value must not count as progress; after the
        # threshold of unchanged turns the fallback releases the state.
        for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD):
            machine.process_turn(extracted={"mood": "ok"})
        assert es.current_state_id == "b"

    def test_changed_deliverable_value_resets_no_progress_counter(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [
                        _task("t", required=False, deliverables=[_deliverable("mood", required=False)])
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        machine.process_turn()  # no-progress: twd -> 1
        machine.process_turn()  # no-progress: twd -> 2
        assert es.turns_without_deliverable == 2
        machine.process_turn(extracted={"mood": "happy"})  # genuine change -> reset
        assert es.current_state_id == "a"
        assert es.turns_without_deliverable == 0

    def test_remarking_completed_task_does_not_reset_counter(self):
        # Re-marking an already-completed task is not fresh progress and must not
        # keep the no-progress counter pinned at zero.
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    # An optional task so the state stays all-optional after the
                    # task is marked, exercising the fallback path.
                    "tasks": [_task("greeted", required=False)],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        machine.process_turn(completed_task_ids=["greeted"])  # genuine: reset
        assert es.turns_without_deliverable == 0
        for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD):
            machine.process_turn(completed_task_ids=["greeted"])  # re-mark, no progress
        assert es.current_state_id == "b"

    def test_increment_turn_wrapper_also_releases(self):
        # The legacy increment_turn() entry point must drive the fallback too.
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD):
            machine.increment_turn()
        assert machine.execution_state.current_state_id == "b"

    def test_last_all_optional_state_is_terminal(self):
        # The last state never receives a fallback (nowhere to go) — it stays put.
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("req", required=True)]},
                {"id": "b", "type": "loose", "tasks": [_task("opt", required=False)]},
            ]
        )
        machine.process_turn(completed_task_ids=["req"])  # a -> b
        assert machine.execution_state.current_state_id == "b"
        # Many no-progress turns must NOT advance past the terminal state.
        for _ in range(10):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "b"


# ===========================================================================
# Explicit deliverable routes win over the turn fallback
# ===========================================================================

class TestRoutePrecedence:
    def _branching_machine(self):
        # state-a is all-optional with an explicit deliverable_value route to C
        # (priority 1) plus an auto-injected turn fallback to B (priority 1000).
        return _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [
                        _task(
                            "t",
                            required=False,
                            deliverables=[_deliverable("choice", required=False)],
                        )
                    ],
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

    def test_deliverable_value_route_wins_when_provided(self):
        machine = self._branching_machine()
        result = machine.process_turn(extracted={"choice": "go-c"})
        assert result.transitioned is True
        assert machine.execution_state.current_state_id == "c"
        assert result.transition_reason == "deliverable_value:choice=go-c"

    def test_explicit_route_wins_even_when_turn_threshold_exceeded(self):
        # Precedence is by priority number, independent of the turn counter:
        # a satisfied priority-1 route beats the priority-1000 fallback.
        machine = self._branching_machine()
        es = machine.execution_state
        es.set_deliverable_value("choice", "go-c")
        es.turns_without_deliverable = 99  # well past the fallback threshold

        transition = es.find_matching_transition()
        assert transition is not None
        assert transition.target_state_id == "c"
        assert transition.condition_type == "deliverable_value"

    def test_falls_back_to_turn_route_when_value_does_not_match(self):
        machine = self._branching_machine()
        # Provide a non-matching value: the explicit route never fires; after the
        # threshold of no-progress turns the fallback to B releases the state.
        machine.process_turn(extracted={"choice": "other"})  # progress, resets counter
        assert machine.execution_state.current_state_id == "a"
        for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "b"

    def test_deliverable_exists_route_wins(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [
                        _task("t", required=False, deliverables=[_deliverable("note", required=False)])
                    ],
                    "transitions": [
                        {
                            "target_state_id": "c",
                            "condition_type": "deliverable_exists",
                            "priority": 1,
                            "condition_config": {"key": "note"},
                        }
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        result = machine.process_turn(extracted={"note": "anything"})
        assert machine.execution_state.current_state_id == "c"
        assert result.transition_reason == "deliverable_exists:note"


# ===========================================================================
# Required tasks complete only when actually done
# ===========================================================================

class TestRequiredWorkCompletion:
    def test_required_deliverable_task_completes_on_value(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [
                        _task("t", required=True, deliverables=[_deliverable("name", required=True)])
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        # No progress: stays put and never times out (required work persists).
        for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD + 5):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "a"

        # Provide the required deliverable: task + state complete -> advance.
        result = machine.process_turn(extracted={"name": "Ada"})
        assert result.transitioned is True
        assert result.transition_reason == "all_required_tasks_complete"
        assert machine.execution_state.current_state_id == "b"

    def test_deliverable_less_required_task_completes_on_mark(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("joke", required=True)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        assert machine.execution_state.is_current_state_complete() is False
        result = machine.process_turn(completed_task_ids=["joke"])
        assert result.transitioned is True
        assert machine.execution_state.current_state_id == "b"

    def test_required_task_with_mixed_deliverables_completes_on_required_only(self):
        # The optional deliverable need not be provided for the task to complete.
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [
                        _task(
                            "t",
                            required=True,
                            deliverables=[
                                _deliverable("req", required=True),
                                _deliverable("opt", required=False),
                            ],
                        )
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        result = machine.process_turn(extracted={"req": "value"})
        assert machine.execution_state.current_state_id == "b"
        assert result.transition_reason == "all_required_tasks_complete"


# ===========================================================================
# Linear, non-linear, backward, terminal transitions
# ===========================================================================

class TestTransitionTopology:
    def test_linear_default_transition_generated(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t", required=True)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        # ensure_transitions should have auto-generated a -> b (all_tasks_complete).
        a = machine.plan.get_state("a")
        assert len(a.transitions) == 1
        assert a.transitions[0].target_state_id == "b"
        assert a.transitions[0].condition_type == "all_tasks_complete"

        machine.process_turn(completed_task_ids=["t"])
        assert machine.execution_state.current_state_id == "b"

    def test_non_linear_skips_middle_state(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t", required=True)],
                    "transitions": [
                        {"target_state_id": "c", "condition_type": "all_tasks_complete", "priority": 1}
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        machine.process_turn(completed_task_ids=["t"])
        assert machine.execution_state.current_state_id == "c"  # b skipped

    def test_backward_jump(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": []},
                {
                    "id": "b",
                    "type": "loose",
                    "tasks": [_task("t", required=True)],
                    "transitions": [
                        {"target_state_id": "a", "condition_type": "all_tasks_complete", "priority": 1}
                    ],
                },
            ],
            initial="b",
        )
        machine.process_turn(completed_task_ids=["t"])
        assert machine.execution_state.current_state_id == "a"

    def test_advance_to_unknown_state_is_rejected(self):
        machine = _machine([{"id": "a", "type": "loose", "tasks": []}])
        assert machine.execution_state.advance_to_state("nope") is False
        assert machine.execution_state.current_state_id == "a"

    def test_chained_transitions_resolve_in_one_turn(self):
        # Completing A via 'shared' lands in B, which has an explicit
        # deliverable_exists('shared') route. Deliverable values persist globally,
        # so B's route is already satisfied on entry and the machine cascades
        # A -> B -> C within a single turn (bounded by MAX_TRANSITIONS_PER_TURN).
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("ta", required=True, deliverables=[_deliverable("shared", required=True)])],
                },
                {
                    "id": "b",
                    "type": "loose",
                    "tasks": [_task("tb", required=False)],
                    "transitions": [
                        {
                            "target_state_id": "c",
                            "condition_type": "deliverable_exists",
                            "priority": 1,
                            "condition_config": {"key": "shared"},
                        }
                    ],
                },
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        machine.process_turn(extracted={"shared": "x"})
        assert machine.execution_state.current_state_id == "c"


# ===========================================================================
# Goal-state downgrade (light agent has no native goal type)
# ===========================================================================

class TestGoalDowngrade:
    def test_goal_with_required_deliverable_completes(self):
        machine = _machine(
            [
                {
                    "id": "g",
                    "type": "goal",
                    "title": "Goal",
                    "goal": {
                        "objective": "collect name",
                        "deliverables": [_deliverable("name", required=True)],
                    },
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        # Downgraded to a loose state with a required synthetic __goal__ task.
        g = machine.plan.get_state("g")
        assert g.type.value == "loose"
        assert g.has_required_work() is True

        assert machine.execution_state.is_current_state_complete() is False
        machine.process_turn(extracted={"name": "Ada"})
        assert machine.execution_state.current_state_id == "b"

    def test_goal_with_only_optional_deliverables_uses_turn_fallback(self):
        machine = _machine(
            [
                {
                    "id": "g",
                    "type": "goal",
                    "title": "Goal",
                    "goal": {
                        "objective": "chat",
                        "deliverables": [_deliverable("mood", required=False)],
                    },
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        g = machine.plan.get_state("g")
        assert g.has_required_work() is False
        # Does not auto-complete; releases via the turn fallback.
        assert machine.execution_state.is_current_state_complete() is False
        for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "b"

    def test_goal_with_no_deliverables_is_not_stuck(self):
        # Regression: a downgraded goal with no deliverables used to keep its
        # synthetic __goal__ task required, which (a) blocked is_current_state_complete
        # forever and (b) suppressed the turn fallback (required work => no fallback),
        # so the state could never advance. The synthetic task is now optional when
        # there is nothing to collect, so the state releases via the turn fallback.
        machine = _machine(
            [
                {
                    "id": "g",
                    "type": "goal",
                    "title": "Goal",
                    "goal": {"objective": "make the user feel welcome", "deliverables": []},
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        g = machine.plan.get_state("g")
        assert g.has_required_work() is False
        # A turn fallback must have been injected.
        assert any(t.condition_type == "turn_count_exceeded" for t in g.transitions)
        for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "b"

    def test_terminal_goal_with_no_deliverables_stays_put(self):
        # As the last state, a no-deliverable goal has nowhere to advance and is
        # the natural terminal state — it must not error or jump.
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t", required=True)]},
                {
                    "id": "g",
                    "type": "goal",
                    "title": "Goal",
                    "goal": {"objective": "wrap up", "deliverables": []},
                },
            ]
        )
        machine.process_turn(completed_task_ids=["t"])  # a -> g
        assert machine.execution_state.current_state_id == "g"
        for _ in range(10):
            machine.process_turn()
        assert machine.execution_state.current_state_id == "g"


# ===========================================================================
# Turn-counter semantics (drives turn_count_exceeded)
# ===========================================================================

class TestTurnCounters:
    def test_progress_resets_without_progress_but_increments_total(self):
        plan = Plan.from_dict(
            {"id": "p", "states": [{"id": "a", "type": "loose", "tasks": []}]}
        )
        es = ExecutionState(plan=plan)
        es.record_turn(made_progress=False)
        es.record_turn(made_progress=False)
        assert es.turns_without_deliverable == 2
        assert es.total_turns == 2

        es.record_turn(made_progress=True)
        assert es.turns_without_deliverable == 0  # reset on progress
        assert es.total_turns == 3  # still counts the turn

    def test_advance_resets_both_counters(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t", required=True)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        es = machine.execution_state
        es.record_turn(made_progress=False)
        es.total_turns = 5
        es.advance_to_state("b")
        assert es.turns_without_deliverable == 0
        assert es.total_turns == 0


# ===========================================================================
# turn_count_exceeded condition evaluation (scopes + misconfiguration)
# ===========================================================================

class TestTurnCountExceededCondition:
    def _es_with_transition(self, condition_config):
        plan = Plan.from_dict(
            {
                "id": "p",
                "states": [
                    {
                        "id": "a",
                        "type": "loose",
                        "tasks": [_task("opt", required=False)],
                        "transitions": [
                            {
                                "target_state_id": "b",
                                "condition_type": "turn_count_exceeded",
                                "priority": 1000,
                                "condition_config": condition_config,
                            }
                        ],
                    },
                    {"id": "b", "type": "loose", "tasks": []},
                ],
            }
        )
        return ExecutionState(plan=plan)

    def test_without_progress_scope(self):
        es = self._es_with_transition({"turns": 3, "scope": "without_progress"})
        es.turns_without_deliverable = 2
        assert es.find_matching_transition() is None
        es.turns_without_deliverable = 3
        assert es.find_matching_transition() is not None

    def test_total_scope(self):
        es = self._es_with_transition({"turns": 4, "scope": "total"})
        es.total_turns = 3
        es.turns_without_deliverable = 99  # must be ignored for total scope
        assert es.find_matching_transition() is None
        es.total_turns = 4
        assert es.find_matching_transition() is not None

    def test_default_scope_is_without_progress(self):
        es = self._es_with_transition({"turns": 2})  # no scope key
        es.total_turns = 99
        es.turns_without_deliverable = 1
        assert es.find_matching_transition() is None
        es.turns_without_deliverable = 2
        assert es.find_matching_transition() is not None

    def test_value_alias_for_threshold(self):
        es = self._es_with_transition({"value": 2, "scope": "without_progress"})
        es.turns_without_deliverable = 2
        assert es.find_matching_transition() is not None

    @pytest.mark.parametrize(
        "bad_config",
        [
            {"scope": "without_progress"},          # missing threshold
            {"turns": "abc"},                        # non-numeric
            {"turns": -1},                           # negative
            {"turns": 1, "scope": "sideways"},       # unknown scope
        ],
    )
    def test_misconfiguration_never_fires(self, bad_config):
        es = self._es_with_transition(bad_config)
        es.turns_without_deliverable = 1000
        es.total_turns = 1000
        # A misconfigured guardrail must fail safe (no surprise jump).
        assert es.find_matching_transition() is None


# ===========================================================================
# ensure_transitions normalization
# ===========================================================================

class TestEnsureTransitions:
    def test_all_optional_state_gets_turn_fallback(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("opt", required=False)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        assert len(a.transitions) == 1
        t = a.transitions[0]
        assert t.condition_type == "turn_count_exceeded"
        assert t.target_state_id == "b"
        assert t.priority == 1000
        assert t.condition_config == {
            "turns": StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD,
            "scope": "without_progress",
        }

    def test_required_state_gets_all_tasks_complete_default(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t", required=True)]},
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        assert a.transitions[0].condition_type == "all_tasks_complete"

    def test_last_state_gets_no_transitions(self):
        machine = _machine(
            [
                {"id": "a", "type": "loose", "tasks": [_task("t", required=True)]},
                {"id": "b", "type": "loose", "tasks": [_task("opt", required=False)]},
            ]
        )
        b = machine.plan.get_state("b")
        assert b.transitions == []

    def test_existing_fallback_not_duplicated(self):
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
                            "priority": 1000,
                            "condition_config": {"turns": 5, "scope": "without_progress"},
                        }
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        fallbacks = [t for t in a.transitions if t.condition_type == "turn_count_exceeded"]
        assert len(fallbacks) == 1
        # The author's threshold is preserved, not overwritten.
        assert fallbacks[0].condition_config["turns"] == 5

    def test_all_optional_state_with_explicit_route_gets_fallback_appended(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("opt", required=False, deliverables=[_deliverable("k", required=False)])],
                    "transitions": [
                        {
                            "target_state_id": "c",
                            "condition_type": "deliverable_exists",
                            "priority": 1,
                            "condition_config": {"key": "k"},
                        }
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        kinds = sorted(t.condition_type for t in a.transitions)
        assert kinds == ["deliverable_exists", "turn_count_exceeded"]
        fallback = next(t for t in a.transitions if t.condition_type == "turn_count_exceeded")
        assert fallback.target_state_id == "b"  # points to the next state in order

    def test_required_state_with_route_gets_no_fallback(self):
        machine = _machine(
            [
                {
                    "id": "a",
                    "type": "loose",
                    "tasks": [_task("t", required=True)],
                    "transitions": [
                        {"target_state_id": "c", "condition_type": "all_tasks_complete", "priority": 1}
                    ],
                },
                {"id": "b", "type": "loose", "tasks": []},
                {"id": "c", "type": "loose", "tasks": []},
            ]
        )
        a = machine.plan.get_state("a")
        assert all(t.condition_type != "turn_count_exceeded" for t in a.transitions)


# ===========================================================================
# Full multi-state walkthrough (integration)
# ===========================================================================

def test_full_plan_walkthrough():
    """A required state, an all-optional state, then a terminal state.

    Exercises: required completion -> advance, optional state held then released
    by the turn fallback, terminal state stays put.
    """
    machine = _machine(
        [
            {
                "id": "intro",
                "type": "loose",
                "tasks": [_task("name_task", required=True, deliverables=[_deliverable("name", required=True)])],
            },
            {
                "id": "smalltalk",
                "type": "loose",
                "tasks": [_task("chat", required=False, deliverables=[_deliverable("hobby", required=False)])],
            },
            {
                "id": "done",
                "type": "loose",
                "tasks": [],
            },
        ]
    )
    es = machine.execution_state

    # 1. intro requires a name; a no-progress turn does not advance.
    machine.process_turn()
    assert es.current_state_id == "intro"

    # 2. provide the name -> intro completes -> smalltalk.
    machine.process_turn(extracted={"name": "Ada"})
    assert es.current_state_id == "smalltalk"

    # 3. smalltalk is all-optional: held for the threshold, then released to done.
    for _ in range(StateMachine.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD - 1):
        machine.process_turn()
        assert es.current_state_id == "smalltalk"
    machine.process_turn()
    assert es.current_state_id == "done"

    # 4. done is terminal: stays put no matter how many turns pass.
    for _ in range(5):
        machine.process_turn()
    assert es.current_state_id == "done"
