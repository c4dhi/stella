"""Adapter for converting state machine state to SDK ProgressState.

Mapping:
    State Machine                ->  SDK Progress Types
    ─────────────────────────────────────────────────────
    Plan                        ->  ProgressState
    State (strict/loose)        ->  ProgressGroup (sequential/flexible)
    Task                        ->  ProgressItem (within group)
    Deliverable                 ->  ProgressItem (with value capture)
"""

from datetime import datetime
from typing import Optional

from stella_agent_sdk.progress import (
    ExecutionMode,
    ItemStatus,
    GroupStatus,
    ProgressItem,
    ProgressGroup,
    ProgressState,
)

from stella_v2_agent.state_machine.execution_state import ExecutionState
from stella_v2_agent.models.state_machine import (
    Plan, State, StateType, Task, TaskStatus, DeliverableStatus,
)


class ProgressAdapter:
    """Converts state machine state to generic SDK ProgressState."""

    @staticmethod
    def state_type_to_execution_mode(state_type: StateType) -> ExecutionMode:
        if state_type == StateType.STRICT:
            return ExecutionMode.SEQUENTIAL
        return ExecutionMode.FLEXIBLE

    @staticmethod
    def task_status_to_item_status(status: TaskStatus) -> ItemStatus:
        mapping = {
            TaskStatus.PENDING: ItemStatus.PENDING,
            TaskStatus.IN_PROGRESS: ItemStatus.IN_PROGRESS,
            TaskStatus.COMPLETED: ItemStatus.COMPLETED,
            TaskStatus.SKIPPED: ItemStatus.SKIPPED,
        }
        return mapping.get(status, ItemStatus.PENDING)

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
    def from_execution_state(
        cls,
        execution_state: ExecutionState,
        started_at: Optional[str] = None,
    ) -> ProgressState:
        """Convert an ExecutionState to a generic ProgressState."""
        plan = execution_state.plan
        groups = []

        for state in plan.states:
            group = cls._state_to_group(
                state, is_current=(state.id == execution_state.current_state_id)
            )
            groups.append(group)

        elapsed_minutes = 0.0
        if started_at:
            try:
                start_time = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                elapsed_minutes = (datetime.now(start_time.tzinfo) - start_time).total_seconds() / 60
            except (ValueError, TypeError):
                pass

        metadata = {
            "plan_id": plan.id,
            "plan_title": plan.title,
            "turns_without_deliverable": execution_state.turns_without_deliverable,
            "architecture": "stella_v2_pipeline",
        }

        current_item_id = None
        current_state = execution_state.current_state
        if current_state and current_state.type == StateType.STRICT:
            for task in current_state.tasks:
                for deliverable in task.deliverables:
                    if deliverable.status == DeliverableStatus.PENDING:
                        current_item_id = deliverable.key
                        break
                if current_item_id:
                    break

        return ProgressState(
            groups=groups,
            current_group_id=execution_state.current_state_id,
            current_item_id=current_item_id,
            progress_percentage=execution_state.calculate_progress(),
            elapsed_minutes=elapsed_minutes,
            started_at=started_at,
            last_updated=datetime.utcnow().isoformat() + "Z",
            metadata=metadata,
        )

    @classmethod
    def _state_to_group(cls, state: State, is_current: bool = False) -> ProgressGroup:
        items = []

        for task in state.tasks:
            for deliverable in task.deliverables:
                status_value = deliverable.status.value if hasattr(deliverable.status, 'value') else str(deliverable.status)
                item = ProgressItem(
                    id=deliverable.key,
                    label=deliverable.description,
                    status=cls.deliverable_status_to_item_status(status_value),
                    description=f"Task: {task.description}",
                    required=deliverable.required,
                    value=deliverable.value if deliverable.value else None,
                    confidence=getattr(deliverable, 'confidence', None),
                    collected_at=getattr(deliverable, 'collected_at', None),
                    metadata={
                        "task_id": task.id,
                        "task_description": task.description,
                        "deliverable_type": deliverable.type,
                        "acceptance_criteria": getattr(deliverable, 'acceptance_criteria', None),
                        "reasoning": getattr(deliverable, 'reasoning', None),
                    },
                )
                items.append(item)

        all_completed = all(item.status == ItemStatus.COMPLETED for item in items)
        any_in_progress = any(item.status == ItemStatus.IN_PROGRESS for item in items)

        if all_completed and items:
            group_status = GroupStatus.COMPLETED
        elif is_current or any_in_progress:
            group_status = GroupStatus.IN_PROGRESS
        else:
            group_status = GroupStatus.PENDING

        return ProgressGroup(
            id=state.id,
            label=state.title,
            execution_mode=cls.state_type_to_execution_mode(state.type),
            status=group_status,
            items=items,
            is_current=is_current,
            description=state.description,
            metadata={
                "state_type": state.type.value,
                "transitions": [
                    {"target": t.target_state_id, "condition": t.condition_type, "priority": t.priority}
                    for t in state.transitions
                ] if state.transitions else [],
            },
        )

    @classmethod
    def from_plan(cls, plan: Plan, current_state_id: Optional[str] = None) -> ProgressState:
        """Create a ProgressState from a Plan definition (before execution starts)."""
        groups = []
        for state in plan.states:
            is_current = (state.id == current_state_id) if current_state_id else (state.id == plan.initial_state_id)
            group = cls._state_to_group(state, is_current=is_current)
            groups.append(group)

        return ProgressState(
            groups=groups,
            current_group_id=current_state_id or plan.initial_state_id,
            progress_percentage=0.0,
            metadata={
                "plan_id": plan.id,
                "plan_title": plan.title,
                "architecture": "stella_v2_pipeline",
            },
        )
