"""Adapter for converting state machine state to SDK ProgressState.

Mapping:
    gRPC Full State              ->  SDK Progress Types
    ─────────────────────────────────────────────────────
    Plan                        ->  ProgressState
    State (strict/loose)        ->  ProgressGroup (sequential/flexible)
    Deliverable                 ->  ProgressItem (with value capture)
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from stella_agent_sdk.progress import (
    ExecutionMode,
    ItemStatus,
    GroupStatus,
    ProgressItem,
    ProgressGroup,
    ProgressState,
)
from stella_v2_agent.utils import normalize_transition_priority


class ProgressAdapter:
    """Converts gRPC state machine state to generic SDK ProgressState."""

    @staticmethod
    def _priority_value(value: Any) -> int:
        """Normalize transition priority (supports int-like strings)."""
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            try:
                return int(value.strip())
            except (ValueError, TypeError):
                return 100
        return 100

    @staticmethod
    def deliverable_status_to_item_status(status: str) -> ItemStatus:
        mapping = {
            "pending": ItemStatus.PENDING,
            "partial": ItemStatus.IN_PROGRESS,
            "completed": ItemStatus.COMPLETED,
            "skipped": ItemStatus.SKIPPED,
        }
        return mapping.get(status, ItemStatus.PENDING)

    @classmethod
    def from_full_state_dict(
        cls,
        full_state: Dict[str, Any],
        started_at: Optional[str] = None,
        plan: Optional[Dict[str, Any]] = None,
        last_transition: Optional[Dict[str, Any]] = None,
    ) -> ProgressState:
        """Build ProgressState from a gRPC get_full_state() response dict.

        Used when state is managed by the external gRPC state machine service.
        Mirrors stella-light's _build_progress_from_full_state().
        """
        groups: List[ProgressGroup] = []
        current_group_id: Optional[str] = None
        current_item_id: Optional[str] = None

        transitions_by_state: Dict[str, List[Dict[str, Any]]] = {}
        if plan and isinstance(plan.get("states"), list):
            for plan_state in plan.get("states", []):
                state_id = plan_state.get("id")
                if not state_id:
                    continue
                transitions_by_state[state_id] = []
                for transition in plan_state.get("transitions", []) or []:
                    target = transition.get("target_state_id")
                    if not target:
                        continue
                    transitions_by_state[state_id].append({
                        "target_state_id": target,
                        "condition_type": transition.get("condition_type", "all_tasks_complete"),
                        "priority": transition.get("priority"),
                        "condition_config": transition.get("condition_config", {}),
                    })

                transitions_by_state[state_id].sort(
                    key=lambda t: normalize_transition_priority(t.get("priority"))
                )

        for state in full_state.get("states", []):
            items: List[ProgressItem] = []
            is_active = state.get("status") == "active"

            for task in state.get("tasks", []):
                task_deliverables = task.get("deliverables", [])
                # Real task status from the state machine (#291 hybrid model).
                # Shipped on each item so the frontend renders backend truth
                # rather than inferring "done" from deliverable fill.
                task_status = task.get("status", "pending")
                if task_deliverables:
                    for d in task_deliverables:
                        status_str = d.get("status", "pending")
                        is_discovered = d.get("discovered", False)
                        item = ProgressItem(
                            id=d.get("key"),
                            label=d.get("description"),
                            status=cls.deliverable_status_to_item_status(status_str),
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
                        )
                        items.append(item)

                        # Track first pending item in the active state
                        if is_active and status_str == "pending" and not current_item_id:
                            current_item_id = d.get("key")
                else:
                    # Task with no deliverables: emit one task-level item
                    # so frontend state groups are never empty.
                    task_status = task.get("status", "pending")
                    task_item_id = f"task_{task.get('id', 'unknown')}"
                    item = ProgressItem(
                        id=task_item_id,
                        label=task.get("description", "Task"),
                        status=cls.deliverable_status_to_item_status(task_status),
                        description=task.get("instruction", ""),
                        required=task.get("required", True),
                        metadata={
                            "task_id": task.get("id"),
                            "task_description": task.get("description"),
                            "is_task_item": True,
                        },
                    )
                    items.append(item)

                    # Track first pending item in the active state
                    if is_active and task_status == "pending" and not current_item_id:
                        current_item_id = task_item_id

            # Determine group status — trust the state machine's authoritative
            # state.status (getFullState already accounts for completed AND skipped
            # tasks via isPlanStateComplete). This MUST mirror stella-light's
            # _build_progress_from_full_state: a prior all-items-COMPLETED heuristic
            # here ignored state.status and treated SKIPPED items as non-completing,
            # so a state whose last task was skipped collapsed to PENDING and the
            # frontend dropped it from the route ("the whole state disappeared").
            group_status_str = state.get("status", "pending")
            if group_status_str == "completed":
                group_status = GroupStatus.COMPLETED
            elif group_status_str == "active" or is_active:
                group_status = GroupStatus.IN_PROGRESS
            else:
                group_status = GroupStatus.PENDING

            state_type = state.get("type", "loose")
            exec_mode = (
                ExecutionMode.SEQUENTIAL if state_type == "strict"
                else ExecutionMode.FLEXIBLE
            )

            group_metadata: Dict[str, Any] = {
                "state_type": state_type,
                "transitions": transitions_by_state.get(state.get("id"), []),
            }
            if state_type == "goal":
                group_metadata["goal_objective"] = state.get("goal_objective", "")
                group_metadata["goal_context"] = state.get("goal_context", "")
                group_metadata["goal_boundaries"] = state.get("goal_boundaries", "")
                group_metadata["goal_success_description"] = state.get("goal_success_description", "")

            group = ProgressGroup(
                id=state.get("id"),
                label=state.get("title"),
                execution_mode=exec_mode,
                status=group_status,
                items=items,
                is_current=is_active,
                description=state.get("description"),
                metadata=group_metadata,
            )
            groups.append(group)

            if is_active:
                current_group_id = state.get("id")

        elapsed_minutes = 0.0
        if started_at:
            try:
                start_time = datetime.fromisoformat(
                    started_at.replace("Z", "+00:00")
                )
                elapsed_minutes = (
                    (datetime.now(start_time.tzinfo) - start_time).total_seconds()
                    / 60
                )
            except (ValueError, TypeError):
                pass

        return ProgressState(
            groups=groups,
            current_group_id=current_group_id or full_state.get("current_state_id"),
            current_item_id=current_item_id,
            # getFullState already returns progress as a 0-100 percentage (the light
            # agent uses it raw). Multiplying here produced 8000%. Keep parity.
            progress_percentage=full_state.get("progress", 0),
            elapsed_minutes=elapsed_minutes,
            started_at=started_at,
            last_updated=datetime.utcnow().isoformat() + "Z",
            metadata={
                "plan_id": full_state.get("plan_id"),
                "plan_title": full_state.get("plan_title"),
                "current_state_id": full_state.get("current_state_id"),
                "total_turns": full_state.get("total_turns", 0),
                "turns_without_progress": full_state.get(
                    "turns_without_progress", 0
                ),
                "architecture": "stella_v2_pipeline",
                "last_transition": last_transition,
            },
        )
