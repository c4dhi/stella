"""Canonical ``full_state -> ProgressState`` builder for every STELLA agent.

This is the **single source of truth** for turning a gRPC ``get_full_state()``
response into the :class:`ProgressState` the frontend renders. Every agent MUST
call :func:`progress_from_full_state`; no agent may re-derive group/task/
percentage status on its own.

Why this exists (issue #310): the transform used to be copy-pasted into each
agent. The copies drifted twice and each drift shipped a user-visible bug the
state machine itself never had:

* v2's ``all_completed`` heuristic ignored the authoritative ``state.status``
  and treated ``SKIPPED`` items as non-completing, so a just-skipped state
  collapsed to ``PENDING`` and disappeared from the route view.
* v2 multiplied ``progress`` by 100, emitting ``8000%`` where the value is
  already a 0-100 percentage.

The builder is a pure, deterministic function (clock is injectable) so it can be
covered by one golden-fixture suite instead of being re-tested per agent.

Wire contract consumed (snake_case, from ``proto/state_machine.proto``):

* top level: ``plan_id``, ``plan_title``, ``current_state_id``,
  ``progress`` (int, already 0-100), ``total_turns``,
  ``turns_without_progress``, ``states[]``.
* state: ``id``, ``title``, ``type`` (strict/loose/goal),
  ``status`` (pending/active/completed), ``tasks[]`` and flat
  ``goal_objective`` / ``goal_context`` / ``goal_depth_guidance`` /
  ``goal_boundaries`` / ``goal_success_description`` (goal states only).
* task: ``id``, ``description``, ``instruction``, ``required``,
  ``status`` (pending/in_progress/completed/skipped), ``deliverables[]``.
* deliverable: ``key``, ``description``, ``type``, ``required``,
  ``status`` (pending/completed/partial/skipped), ``value``, ``confidence``,
  ``collected_at``, ``acceptance_criteria``, ``reasoning``, ``discovered``.

Transitions are NOT on the wire — pass the raw ``plan`` config so the builder
can attach (and priority-sort) each state's "possible next states".
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from stella_agent_sdk.progress.types import (
    ExecutionMode,
    GroupStatus,
    ItemStatus,
    ProgressGroup,
    ProgressItem,
    ProgressState,
)


def normalize_transition_priority(value: Any, default: int = 100) -> int:
    """Normalize a transition priority to an int (tolerates int-like strings)."""
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except (ValueError, TypeError):
            return default
    return default


_DELIVERABLE_STATUS_TO_ITEM_STATUS = {
    "pending": ItemStatus.PENDING,
    "partial": ItemStatus.IN_PROGRESS,
    "completed": ItemStatus.COMPLETED,
    "skipped": ItemStatus.SKIPPED,
}


def _to_item_status(status: Optional[str]) -> ItemStatus:
    """Map a state-machine deliverable/task status string to an ``ItemStatus``.

    ``ItemStatus`` has no ``partial`` member, so ``partial`` collapses to
    ``IN_PROGRESS``. Unknown values default to ``PENDING``.
    """
    return _DELIVERABLE_STATUS_TO_ITEM_STATUS.get(status or "pending", ItemStatus.PENDING)


def _transitions_by_state(plan: Optional[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Build a {state_id: [transition, ...]} map from the raw plan config.

    Transitions are static plan data (not carried in the live full_state), and
    are priority-sorted so the frontend renders "Possible Next States" in the
    order the state machine would evaluate them.
    """
    result: Dict[str, List[Dict[str, Any]]] = {}
    if not plan or not isinstance(plan.get("states"), list):
        return result

    for plan_state in plan.get("states", []):
        state_id = plan_state.get("id")
        if not state_id:
            continue
        mapped: List[Dict[str, Any]] = []
        for transition in plan_state.get("transitions", []) or []:
            target = transition.get("target_state_id")
            if not target:
                continue
            mapped.append({
                "target_state_id": target,
                "condition_type": transition.get("condition_type", "all_tasks_complete"),
                "priority": transition.get("priority"),
                "condition_config": transition.get("condition_config", {}),
            })
        mapped.sort(key=lambda t: normalize_transition_priority(t.get("priority")))
        result[state_id] = mapped

    return result


def build_last_transition(
    plan: Optional[Dict[str, Any]],
    from_state_id: Optional[str],
    to_state_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Describe the transition the session just took (the UI "branch chosen").

    Shared by every agent so the "branch chosen" explanation is computed
    identically (#310). Returns ``None`` when there was no state change, or when
    no single plan transition directly connects ``from -> to`` (e.g. a multi-state
    skip in one turn), to avoid emitting misleading branch metadata. When the
    plan/source state is unavailable, returns the bare from/to pair so the UI can
    still show the hop without a condition.
    """
    if not from_state_id or not to_state_id or from_state_id == to_state_id:
        return None

    states = (plan or {}).get("states", [])
    if not isinstance(states, list):
        return {"from_state_id": from_state_id, "to_state_id": to_state_id}

    source_state = next((s for s in states if s.get("id") == from_state_id), None)
    if not source_state:
        return {"from_state_id": from_state_id, "to_state_id": to_state_id}

    matching = [
        t for t in (source_state.get("transitions", []) or [])
        if t.get("target_state_id") == to_state_id
    ]
    if not matching:
        return None

    matching.sort(key=lambda t: normalize_transition_priority(t.get("priority")))
    winner = matching[0]
    return {
        "from_state_id": from_state_id,
        "to_state_id": to_state_id,
        "condition_type": winner.get("condition_type"),
        "condition_config": winner.get("condition_config", {}),
        "priority": winner.get("priority"),
    }


def _elapsed_minutes(session_started_at: Optional[str], now: datetime) -> float:
    """Minutes between ``session_started_at`` (ISO 8601) and ``now``.

    ``now`` is expected to be naive UTC (the default ``datetime.utcnow()``); the
    start timestamp may carry a ``Z``/offset. Both are reconciled to the same
    awareness before subtracting so the result is deterministic regardless.
    """
    if not session_started_at:
        return 0.0
    try:
        start_time = datetime.fromisoformat(session_started_at.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return 0.0
    reference = now
    if start_time.tzinfo is not None and reference.tzinfo is None:
        reference = reference.replace(tzinfo=start_time.tzinfo)
    elif start_time.tzinfo is None and reference.tzinfo is not None:
        start_time = start_time.replace(tzinfo=reference.tzinfo)
    return (reference - start_time).total_seconds() / 60


def progress_from_full_state(
    full_state: Dict[str, Any],
    *,
    plan: Optional[Dict[str, Any]] = None,
    session_started_at: Optional[str] = None,
    extra_metadata: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
) -> ProgressState:
    """Single source of truth: gRPC ``get_full_state()`` dict -> ``ProgressState``.

    Every agent MUST use this; do not re-derive group/task/percentage status.

    Args:
        full_state: The ``get_full_state()`` response dict (snake_case wire shape).
        plan: Raw plan config, used to attach priority-sorted transitions.
        session_started_at: ISO timestamp the session started (for ``started_at``
            and ``elapsed_minutes``).
        extra_metadata: Agent-specific top-level metadata merged into the result
            (e.g. ``architecture``, ``last_transition``). The builder hardcodes
            no agent identity of its own.
        now: Clock override for deterministic ``last_updated`` / ``elapsed_minutes``
            (used by tests). Defaults to the current UTC time.
    """
    now = now or datetime.utcnow()
    transitions_by_state = _transitions_by_state(plan)

    groups: List[ProgressGroup] = []
    current_group_id: Optional[str] = None
    current_item_id: Optional[str] = None

    for state in full_state.get("states", []):
        is_active = state.get("status") == "active"
        items: List[ProgressItem] = []

        for task in state.get("tasks", []):
            # The state machine is the single source of truth for whether a task
            # is done (#291 hybrid model). Ship the real task status on each item
            # so the frontend renders backend truth instead of inferring "done"
            # from deliverable fill.
            task_status = task.get("status", "pending")
            task_deliverables = task.get("deliverables", [])

            if task_deliverables:
                for d in task_deliverables:
                    status_str = d.get("status", "pending")
                    is_discovered = d.get("discovered", False)
                    items.append(ProgressItem(
                        id=d.get("key"),
                        label=d.get("description"),
                        status=_to_item_status(status_str),
                        description=f"Task: {task.get('description', '')}",
                        required=False if is_discovered else d.get("required", True),
                        value=d.get("value"),
                        confidence=d.get("confidence"),
                        collected_at=d.get("collected_at"),
                        metadata={
                            "task_id": task.get("id"),
                            "task_description": task.get("description"),
                            "task_status": task_status,
                            "deliverable_type": d.get("type", "string"),
                            "acceptance_criteria": d.get("acceptance_criteria"),
                            "reasoning": d.get("reasoning"),
                            "discovered": is_discovered,
                        },
                    ))
                    # Current item = first pending deliverable in the active state.
                    if is_active and status_str == "pending" and not current_item_id:
                        current_item_id = d.get("key")
            else:
                # Deliverable-less task: emit one task-level item so the task is
                # visible and carries its real completed/skipped status.
                task_item_id = f"task_{task.get('id', 'unknown')}"
                items.append(ProgressItem(
                    id=task_item_id,
                    label=task.get("description", "Task"),
                    status=_to_item_status(task_status),
                    description=task.get("instruction", ""),
                    required=task.get("required", True),
                    metadata={
                        "task_id": task.get("id"),
                        "task_description": task.get("description"),
                        "task_status": task_status,
                        "is_task_item": True,
                    },
                ))
                if is_active and task_status == "pending" and not current_item_id:
                    current_item_id = task_item_id

        # Group status comes ONLY from the authoritative state.status. getFullState
        # already accounts for completed AND skipped tasks via isPlanStateComplete.
        # The old all-items-COMPLETED heuristic treated SKIPPED as non-completing,
        # so a state whose last task was skipped collapsed to PENDING and the
        # frontend dropped it from the route ("the whole state disappeared").
        state_status = state.get("status", "pending")
        if state_status == "completed":
            group_status = GroupStatus.COMPLETED
        elif is_active:
            group_status = GroupStatus.IN_PROGRESS
        else:
            group_status = GroupStatus.PENDING

        state_type = state.get("type", "loose")
        exec_mode = (
            ExecutionMode.SEQUENTIAL if state_type == "strict" else ExecutionMode.FLEXIBLE
        )

        group_metadata: Dict[str, Any] = {
            "state_type": state_type,
            "transitions": transitions_by_state.get(state.get("id"), []),
        }
        if state_type == "goal":
            group_metadata["goal_objective"] = state.get("goal_objective", "")
            group_metadata["goal_context"] = state.get("goal_context", "")
            group_metadata["goal_depth_guidance"] = state.get("goal_depth_guidance", "")
            group_metadata["goal_boundaries"] = state.get("goal_boundaries", "")
            group_metadata["goal_success_description"] = state.get("goal_success_description", "")

        groups.append(ProgressGroup(
            id=state.get("id"),
            label=state.get("title"),
            execution_mode=exec_mode,
            status=group_status,
            items=items,
            is_current=is_active,
            description=state.get("description"),
            metadata=group_metadata,
        ))

        if is_active:
            current_group_id = state.get("id")

    metadata: Dict[str, Any] = {
        "plan_id": full_state.get("plan_id"),
        "plan_title": full_state.get("plan_title"),
        "current_state_id": full_state.get("current_state_id"),
        "total_turns": full_state.get("total_turns", 0),
        "turns_without_progress": full_state.get("turns_without_progress", 0),
    }
    if extra_metadata:
        metadata.update(extra_metadata)

    return ProgressState(
        groups=groups,
        current_group_id=current_group_id or full_state.get("current_state_id"),
        current_item_id=current_item_id,
        # getFullState already returns progress as a 0-100 percentage; use it raw.
        # (Multiplying here previously produced 8000%.)
        progress_percentage=full_state.get("progress", 0),
        elapsed_minutes=_elapsed_minutes(session_started_at, now),
        started_at=session_started_at,
        last_updated=now.isoformat() + "Z",
        metadata=metadata,
    )
