from stella_light_agent.models.state_machine import Plan
from stella_light_agent.state_machine.execution_state import ExecutionState
from stella_light_agent.state_machine.engine import StateMachine


def _build_plan() -> Plan:
    # Minimal 3-state plan used to verify non-linear transitions:
    # A (start), B (middle), C (non-adjacent target).
    return Plan.from_dict(
        {
            "id": "plan",
            "title": "Plan",
            "initial_state_id": "state-a",
            "states": [
                {"id": "state-a", "title": "A", "type": "loose", "tasks": []},
                {"id": "state-b", "title": "B", "type": "loose", "tasks": []},
                {"id": "state-c", "title": "C", "type": "loose", "tasks": []},
            ],
        }
    )


def test_advance_to_non_adjacent_state_id():
    # Start in A and simulate that we already had some no-progress turns.
    state = ExecutionState(plan=_build_plan())
    state.turns_without_deliverable = 3

    # Jump directly from A -> C (skip B).
    changed = state.advance_to_state("state-c")

    # Transition should succeed and update runtime transition metadata.
    assert changed is True
    assert state.current_state_id == "state-c"
    # Any state transition resets the turn counter.
    assert state.turns_without_deliverable == 0
    # Agent uses this flag to know a transition just happened.
    assert state.state_just_changed is True


def test_advance_to_backward_state_id():
    # Start in C to verify backward transition support (C -> A).
    state = ExecutionState(plan=_build_plan(), current_state_id="state-c")
    state.turns_without_deliverable = 2

    # Move backward to A.
    changed = state.advance_to_state("state-a")

    # Backward jump should behave exactly like forward jump.
    assert changed is True
    assert state.current_state_id == "state-a"
    assert state.turns_without_deliverable == 0
    assert state.state_just_changed is True


def test_engine_advance_state_uses_transition_target_state_id_non_linear():
    # Engine-level check:
    # evaluate_transitions() + advance_state() must follow target_state_id directly,
    # not assume "next index" sequencing.
    #
    # NOTE: state-a is given a *required* task so that all_tasks_complete is a
    # legitimate completion signal. An all-optional/empty state no longer
    # auto-completes (#291), so it could never fire all_tasks_complete on its own.
    machine = StateMachine()
    ok = machine.initialize(
        {
            "id": "plan",
            "title": "Plan",
            "initial_state_id": "state-a",
            "states": [
                {
                    "id": "state-a",
                    "title": "A",
                    "type": "loose",
                    "tasks": [
                        {"id": "t1", "description": "do it", "required": True},
                    ],
                    "transitions": [
                        {
                            # Non-linear transition: A points directly to C.
                            "target_state_id": "state-c",
                            "condition_type": "all_tasks_complete",
                            "priority": 1,
                        }
                    ],
                },
                {"id": "state-b", "title": "B", "type": "loose", "tasks": []},
                {"id": "state-c", "title": "C", "type": "loose", "tasks": []},
            ],
        }
    )

    # Initialization must succeed before transition checks.
    assert ok is True
    assert machine.execution_state is not None

    # Before the required task is done, A must NOT be complete -> no transition.
    assert machine.execution_state.evaluate_transitions() is None

    # Complete the required task; now all_tasks_complete should fire.
    machine.execution_state.mark_task_completed("t1")
    # Transition evaluation should return the explicit target.
    assert machine.execution_state.evaluate_transitions() == "state-c"

    # Engine applies the evaluated transition.
    changed = machine.advance_state()

    assert changed is True
    # Final state must be C (B skipped).
    assert machine.execution_state.current_state_id == "state-c"
