"""Golden-fixture tests for the canonical ``progress_from_full_state`` builder (#310).

This is the single test suite that covers the ``get_full_state() dict ->
ProgressState`` transform for *every* agent. Each case is a representative
gRPC full_state dict mapped to an asserted ``ProgressState``. These fixtures
would have caught all three historical drifts before they shipped:

* the disappearing skipped-state regression (group must stay COMPLETED + the
  item SKIPPED + counted, never collapse to PENDING);
* the ``8000%`` double-scaling regression (percentage stays 0-100, raw);
* the ignored-task-status regression (real ``task_status`` rides on every item).
"""

import json
from datetime import datetime

import pytest

from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.progress import (
    ExecutionMode,
    GroupStatus,
    ItemStatus,
    ProgressState,
    build_last_transition,
    progress_from_full_state,
)

_BRANCHING_PLAN = {
    "states": [
        {
            "id": "greeting",
            "transitions": [
                {"target_state_id": "exercise", "condition_type": "all_tasks_complete",
                 "priority": 10},
                {"target_state_id": "wrapup", "condition_type": "turn_count_exceeded",
                 "priority": 5},
            ],
        },
        {"id": "exercise", "transitions": []},
    ],
}

# Fixed clock so last_updated / elapsed_minutes are deterministic.
NOW = datetime(2026, 6, 17, 12, 5, 0)
STARTED_AT = "2026-06-17T12:00:00+00:00"


def _build(full_state, **kwargs):
    kwargs.setdefault("session_started_at", STARTED_AT)
    kwargs.setdefault("now", NOW)
    return progress_from_full_state(full_state, **kwargs)


def _items_by_id(group):
    return {item.id: item for item in group.items}


# ---------------------------------------------------------------------------
# Mid-state with partial deliverables -> in_progress
# ---------------------------------------------------------------------------

def test_mid_state_partial_deliverables():
    full_state = {
        "plan_id": "p1",
        "plan_title": "Intake",
        "current_state_id": "intake",
        "progress": 40,
        "total_turns": 3,
        "turns_without_progress": 0,
        "states": [
            {
                "id": "intake",
                "title": "Patient Intake",
                "type": "loose",
                "status": "active",
                "tasks": [
                    {
                        "id": "t1",
                        "description": "Collect basics",
                        "status": "in_progress",
                        "deliverables": [
                            {"key": "name", "description": "Name", "status": "completed",
                             "required": True, "value": "Jane"},
                            {"key": "dob", "description": "DOB", "status": "pending",
                             "required": True},
                        ],
                    },
                ],
            },
        ],
    }

    state = _build(full_state)
    assert isinstance(state, ProgressState)
    assert state.progress_percentage == 40
    assert state.current_group_id == "intake"
    # First pending deliverable in the active state.
    assert state.current_item_id == "dob"

    group = state.groups[0]
    assert group.status == GroupStatus.IN_PROGRESS
    assert group.is_current is True
    assert group.execution_mode == ExecutionMode.FLEXIBLE
    assert group.metadata["state_type"] == "loose"

    items = _items_by_id(group)
    assert items["name"].status == ItemStatus.COMPLETED
    assert items["dob"].status == ItemStatus.PENDING
    # Real task status rides on every item (#291).
    assert items["name"].metadata["task_status"] == "in_progress"


# ---------------------------------------------------------------------------
# Last task skipped -> group COMPLETED + item SKIPPED + counted (the
# disappearing-state regression)
# ---------------------------------------------------------------------------

def test_last_task_skipped_state_stays_visible_and_completed():
    full_state = {
        "plan_id": "p1",
        "current_state_id": "next",
        "progress": 100,
        "states": [
            {
                "id": "done_state",
                "title": "Wrap up",
                "type": "loose",
                "status": "completed",  # authoritative: state IS complete
                "tasks": [
                    {
                        "id": "t1",
                        "description": "Optional follow-up",
                        "status": "skipped",
                        "deliverables": [
                            {"key": "followup", "description": "Follow-up", "status": "skipped",
                             "required": True},
                        ],
                    },
                ],
            },
        ],
    }

    state = _build(full_state)
    group = state.groups[0]

    # Must NOT collapse to PENDING (that dropped the state from the route view).
    assert group.status == GroupStatus.COMPLETED
    item = group.items[0]
    assert item.status == ItemStatus.SKIPPED
    assert item.metadata["task_status"] == "skipped"


# ---------------------------------------------------------------------------
# All-optional-deliverable task auto-completed (#291 variant C)
# ---------------------------------------------------------------------------

def test_all_optional_task_autocompleted():
    full_state = {
        "current_state_id": "s",
        "progress": 100,
        "states": [
            {
                "id": "s",
                "title": "Optional info",
                "type": "loose",
                "status": "completed",
                "tasks": [
                    {
                        "id": "t1",
                        "description": "Optional notes",
                        "status": "completed",
                        "deliverables": [
                            {"key": "note", "description": "Note", "status": "completed",
                             "required": False, "value": "hi"},
                        ],
                    },
                ],
            },
        ],
    }

    state = _build(full_state)
    group = state.groups[0]
    assert group.status == GroupStatus.COMPLETED
    assert group.items[0].status == ItemStatus.COMPLETED
    assert group.items[0].required is False


# ---------------------------------------------------------------------------
# Deliverable-less task -> synthetic is_task_item
# ---------------------------------------------------------------------------

def test_deliverable_less_task_emits_synthetic_item():
    full_state = {
        "current_state_id": "s",
        "progress": 0,
        "states": [
            {
                "id": "s",
                "title": "Greeting",
                "type": "strict",
                "status": "active",
                "tasks": [
                    {
                        "id": "greet",
                        "description": "Greet the patient",
                        "instruction": "Say hello warmly",
                        "status": "pending",
                        "required": True,
                        "deliverables": [],
                    },
                ],
            },
        ],
    }

    state = _build(full_state)
    group = state.groups[0]
    assert group.execution_mode == ExecutionMode.SEQUENTIAL  # strict -> sequential
    item = group.items[0]
    assert item.id == "task_greet"
    assert item.metadata["is_task_item"] is True
    assert item.description == "Say hello warmly"  # instruction carried through
    assert item.status == ItemStatus.PENDING
    assert state.current_item_id == "task_greet"


# ---------------------------------------------------------------------------
# Goal state with goal-level deliverables + discovered insights
# ---------------------------------------------------------------------------

def test_goal_state_deliverables_and_discovered():
    full_state = {
        "current_state_id": "explore",
        "progress": 50,
        "states": [
            {
                "id": "explore",
                "title": "Explore symptoms",
                "type": "goal",
                "status": "active",
                "goal_objective": "Understand the chief complaint",
                "goal_context": "open conversation",
                "goal_boundaries": "stay clinical",
                "goal_success_description": "complaint understood",
                "tasks": [
                    {
                        "id": "__goal_deliverables__",
                        "description": "Understand the chief complaint",
                        "status": "in_progress",
                        "deliverables": [
                            {"key": "complaint", "description": "Chief complaint",
                             "status": "completed", "required": True, "value": "cough"},
                            {"key": "onset", "description": "Onset", "status": "pending",
                             "required": True},
                            {"key": "smoker", "description": "smoker",
                             "status": "completed", "required": False, "value": True,
                             "discovered": True},
                        ],
                    },
                ],
            },
        ],
    }

    state = _build(full_state)
    group = state.groups[0]

    # Goal metadata is surfaced on the group (light agent used to drop this).
    assert group.metadata["state_type"] == "goal"
    assert group.metadata["goal_objective"] == "Understand the chief complaint"
    assert group.metadata["goal_success_description"] == "complaint understood"

    items = _items_by_id(group)
    # Discovered insight is marked and forced non-required.
    assert items["smoker"].metadata["discovered"] is True
    assert items["smoker"].required is False
    assert items["complaint"].metadata["discovered"] is False
    assert items["complaint"].required is True
    # current_item = first pending in active goal state.
    assert state.current_item_id == "onset"


# ---------------------------------------------------------------------------
# Goal state with regular tasks + goal deliverables coexisting (no double count)
# ---------------------------------------------------------------------------

def test_goal_state_with_regular_tasks_no_double_count():
    full_state = {
        "current_state_id": "g",
        "progress": 25,
        "states": [
            {
                "id": "g",
                "title": "Goal with tasks",
                "type": "goal",
                "status": "active",
                "goal_objective": "obj",
                "tasks": [
                    {
                        "id": "__goal_deliverables__",
                        "description": "obj",
                        "status": "pending",
                        "deliverables": [
                            {"key": "g1", "description": "Goal D1", "status": "pending",
                             "required": True},
                        ],
                    },
                    {
                        "id": "real",
                        "description": "Regular task",
                        "status": "completed",
                        "deliverables": [
                            {"key": "r1", "description": "Reg D1", "status": "completed",
                             "required": True, "value": "x"},
                        ],
                    },
                ],
            },
        ],
    }

    state = _build(full_state)
    group = state.groups[0]
    # Every item keys back to exactly one task — no duplicate deliverable keys.
    ids = [item.id for item in group.items]
    assert ids == ["g1", "r1"]
    assert len(ids) == len(set(ids))
    task_ids = {item.metadata["task_id"] for item in group.items}
    assert task_ids == {"__goal_deliverables__", "real"}


# ---------------------------------------------------------------------------
# Percentage is 0-100, raw (regression for the 8000% bug)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("progress", [0, 8, 50, 80, 100])
def test_percentage_is_raw_0_to_100(progress):
    full_state = {"current_state_id": "s", "progress": progress, "states": []}
    state = _build(full_state)
    assert state.progress_percentage == progress
    assert 0 <= state.progress_percentage <= 100


# ---------------------------------------------------------------------------
# Transitions are priority-sorted (from the plan, not the wire)
# ---------------------------------------------------------------------------

def test_transitions_sorted_by_priority():
    full_state = {
        "current_state_id": "a",
        "progress": 0,
        "states": [
            {"id": "a", "title": "A", "type": "loose", "status": "active", "tasks": []},
        ],
    }
    plan = {
        "states": [
            {
                "id": "a",
                "transitions": [
                    {"target_state_id": "c", "priority": 30},
                    {"target_state_id": "b", "priority": "10"},  # int-like string
                    {"target_state_id": "d", "priority": 20},
                ],
            },
        ],
    }
    state = _build(full_state, plan=plan)
    targets = [t["target_state_id"] for t in state.groups[0].metadata["transitions"]]
    assert targets == ["b", "d", "c"]


# ---------------------------------------------------------------------------
# Agent-identity metadata is parameterized, not hardcoded
# ---------------------------------------------------------------------------

def test_extra_metadata_is_merged():
    full_state = {"current_state_id": "s", "progress": 0, "states": []}
    state = _build(
        full_state,
        extra_metadata={"architecture": "stella_v2_pipeline", "last_transition": {"to": "x"}},
    )
    assert state.metadata["architecture"] == "stella_v2_pipeline"
    assert state.metadata["last_transition"] == {"to": "x"}
    # Builder still emits the canonical top-level keys.
    assert state.metadata["current_state_id"] == "s"


def test_no_extra_metadata_has_no_agent_identity():
    full_state = {"current_state_id": "s", "progress": 0, "states": []}
    state = _build(full_state)
    assert "architecture" not in state.metadata
    assert "last_transition" not in state.metadata


# ---------------------------------------------------------------------------
# Wire-parity: AgentOutput.progress_update emits exactly the keys
# progressConversion.ts reads, and the JSON round-trips.
# ---------------------------------------------------------------------------

def test_wire_parity_keys_match_frontend_contract():
    full_state = {
        "plan_id": "p1",
        "plan_title": "Intake",
        "current_state_id": "intake",
        "progress": 40,
        "total_turns": 2,
        "turns_without_progress": 1,
        "states": [
            {
                "id": "intake",
                "title": "Intake",
                "type": "goal",
                "status": "active",
                "goal_objective": "obj",
                "tasks": [
                    {
                        "id": "t1",
                        "description": "task",
                        "status": "in_progress",
                        "deliverables": [
                            {"key": "name", "description": "Name", "type": "string",
                             "status": "completed", "required": True, "value": "Jane",
                             "confidence": 0.9, "collected_at": "2026-06-17T12:01:00Z",
                             "acceptance_criteria": "non-empty", "reasoning": "stated"},
                        ],
                    },
                ],
            },
        ],
    }
    plan = {"states": [{"id": "intake", "transitions": [
        {"target_state_id": "next", "priority": 10},
    ]}]}

    state = _build(full_state, plan=plan, extra_metadata={"last_transition": None})
    output = AgentOutput.progress_update("sess-1", state)
    data = json.loads(output.content)

    # Top-level keys progressUpdateToTodoList reads.
    for key in ("groups", "current_group_id", "progress_percentage", "started_at",
                "last_updated", "metadata"):
        assert key in data, f"missing top-level key {key}"
    assert data["progress_percentage"] == 40

    group = data["groups"][0]
    for key in ("id", "label", "execution_mode", "status", "is_current", "metadata"):
        assert key in group, f"missing group key {key}"
    assert group["metadata"]["state_type"] == "goal"
    assert isinstance(group["metadata"]["transitions"], list)

    item = group["items"][0]
    for key in ("id", "label", "status", "required", "value", "collected_at",
                "confidence", "metadata"):
        assert key in item, f"missing item key {key}"
    meta = item["metadata"]
    for key in ("task_id", "task_description", "task_status", "deliverable_type"):
        assert key in meta, f"missing item.metadata key {key}"
    assert meta["task_status"] == "in_progress"


# ---------------------------------------------------------------------------
# build_last_transition: the "branch chosen" explanation, shared by every agent
# ---------------------------------------------------------------------------

def test_last_transition_identifies_winning_condition():
    result = build_last_transition(_BRANCHING_PLAN, "greeting", "exercise")
    assert result == {
        "from_state_id": "greeting",
        "to_state_id": "exercise",
        "condition_type": "all_tasks_complete",
        "condition_config": {},
        "priority": 10,
    }


def test_last_transition_none_when_no_state_change():
    assert build_last_transition(_BRANCHING_PLAN, "exercise", "exercise") is None
    assert build_last_transition(_BRANCHING_PLAN, None, "exercise") is None


def test_last_transition_none_for_indirect_hop():
    # No direct greeting->wrapup transition in this plan (multi-state skip).
    assert build_last_transition(_BRANCHING_PLAN, "greeting", "nowhere") is None


def test_last_transition_bare_pair_when_plan_unavailable():
    assert build_last_transition(None, "a", "b") == {"from_state_id": "a", "to_state_id": "b"}


def test_last_transition_flows_through_extra_metadata():
    """The agent computes the branch, the builder just carries it (#310)."""
    full_state = {"current_state_id": "exercise", "progress": 14, "states": []}
    lt = build_last_transition(_BRANCHING_PLAN, "greeting", "exercise")
    state = _build(full_state, extra_metadata={"last_transition": lt})
    assert state.metadata["last_transition"]["condition_type"] == "all_tasks_complete"


def test_progress_update_accepts_progress_state_object():
    """The light agent now passes a ProgressState (was a dict); confirm both work."""
    full_state = {"current_state_id": "s", "progress": 10, "states": []}
    state = _build(full_state)
    out_obj = AgentOutput.progress_update("sess", state)
    out_dict = AgentOutput.progress_update("sess", state.to_dict())
    assert json.loads(out_obj.content)["progress_percentage"] == 10
    assert json.loads(out_dict.content)["progress_percentage"] == 10
