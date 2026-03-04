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


class ProgressAdapter:
    """Converts gRPC state machine state to generic SDK ProgressState."""

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
    ) -> ProgressState:
        """Build ProgressState from a gRPC get_full_state() response dict.

        Used when state is managed by the external gRPC state machine service.
        Mirrors stella-light's _build_progress_from_full_state().
        """
        groups: List[ProgressGroup] = []
        current_group_id: Optional[str] = None
        current_item_id: Optional[str] = None

        for state in full_state.get("states", []):
            items: List[ProgressItem] = []
            is_active = state.get("status") == "active"

            for task in state.get("tasks", []):
                for d in task.get("deliverables", []):
                    status_str = d.get("status", "pending")
                    item = ProgressItem(
                        id=d.get("key"),
                        label=d.get("description"),
                        status=cls.deliverable_status_to_item_status(status_str),
                        description=f"Task: {task.get('description', '')}",
                        required=d.get("required", True),
                        value=d.get("value"),
                        confidence=d.get("confidence"),
                        collected_at=d.get("collected_at"),
                        metadata={
                            "task_id": task.get("id"),
                            "task_description": task.get("description"),
                            "deliverable_type": d.get("type", "string"),
                            "acceptance_criteria": d.get("acceptance_criteria"),
                            "reasoning": d.get("reasoning"),
                        },
                    )
                    items.append(item)

                    # Track first pending item in the active state
                    if is_active and status_str == "pending" and not current_item_id:
                        current_item_id = d.get("key")

            # Determine group status
            all_completed = items and all(
                i.status == ItemStatus.COMPLETED for i in items
            )
            group_status_str = state.get("status", "pending")
            if all_completed:
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

            group = ProgressGroup(
                id=state.get("id"),
                label=state.get("title"),
                execution_mode=exec_mode,
                status=group_status,
                items=items,
                is_current=is_active,
                description=state.get("description"),
                metadata={},
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
            progress_percentage=full_state.get("progress", 0) * 100,
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
            },
        )
