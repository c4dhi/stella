"""
Adapter for converting Grace Agent state machine to SDK ProgressState.

This adapter translates the Grace-specific state machine model into the
generic SDK progress types, enabling the frontend task panel to display
Grace agent progress using the standard schema.

Mapping:
    Grace State Machine          ->  SDK Progress Types
    ─────────────────────────────────────────────────────
    Plan                         ->  ProgressState
    State (strict/loose)         ->  ProgressGroup (sequential/flexible)
    Task                         ->  ProgressItem (within group)
    Deliverable                  ->  ProgressItem (with value capture)
"""

from datetime import datetime
from typing import Optional, Dict, Any

from grace_agent_sdk.progress import (
    ExecutionMode,
    ItemStatus,
    GroupStatus,
    ProgressItem,
    ProgressGroup,
    ProgressState,
)

from grace_agent.state_machine.execution_state import ExecutionState
from grace_agent.models.state_machine import Plan, State, StateType, Task, TaskStatus, DeliverableStatus


class ProgressAdapter:
    """
    Converts Grace Agent state machine state to generic SDK ProgressState.

    This allows the frontend to use the same task panel UI regardless of
    whether the agent uses Grace's state machine or a different approach.
    """

    @staticmethod
    def state_type_to_execution_mode(state_type: StateType) -> ExecutionMode:
        """Convert Grace StateType to SDK ExecutionMode."""
        if state_type == StateType.STRICT:
            return ExecutionMode.SEQUENTIAL
        else:
            return ExecutionMode.FLEXIBLE

    @staticmethod
    def task_status_to_item_status(status: TaskStatus) -> ItemStatus:
        """Convert Grace TaskStatus to SDK ItemStatus."""
        mapping = {
            TaskStatus.PENDING: ItemStatus.PENDING,
            TaskStatus.IN_PROGRESS: ItemStatus.IN_PROGRESS,
            TaskStatus.COMPLETED: ItemStatus.COMPLETED,
            TaskStatus.SKIPPED: ItemStatus.SKIPPED,
        }
        return mapping.get(status, ItemStatus.PENDING)

    @staticmethod
    def deliverable_status_to_item_status(status: str) -> ItemStatus:
        """Convert Grace deliverable status string to SDK ItemStatus."""
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
        """
        Convert a Grace ExecutionState to a generic ProgressState.

        Args:
            execution_state: The Grace agent's current execution state.
            started_at: Optional ISO timestamp when conversation started.

        Returns:
            A ProgressState suitable for sending via AgentOutput.progress_update()
        """
        plan = execution_state.plan
        groups = []

        # Convert each state to a ProgressGroup
        for state in plan.states:
            group = cls._state_to_group(
                state,
                is_current=(state.id == execution_state.current_state_id)
            )
            groups.append(group)

        # Calculate elapsed time
        elapsed_minutes = 0.0
        if started_at:
            try:
                start_time = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                elapsed_minutes = (datetime.now(start_time.tzinfo) - start_time).total_seconds() / 60
            except (ValueError, TypeError):
                pass

        # Build metadata with Grace-specific info
        metadata = {
            "plan_id": plan.id,
            "plan_title": plan.title,
            "turns_without_deliverable": execution_state.turns_without_deliverable,
            "architecture": "state_machine",
        }

        # Find current item (deliverable being worked on)
        current_item_id = None
        current_state = execution_state.current_state
        if current_state:
            # In sequential mode, find first pending deliverable
            # In flexible mode, current item is less meaningful
            if current_state.type == StateType.STRICT:
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
        """Convert a Grace State to a ProgressGroup."""
        items = []

        # Convert tasks and their deliverables to items
        for task in state.tasks:
            # Add deliverables as items (these are what we actually track)
            for deliverable in task.deliverables:
                # Convert enum status to string for the status converter
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
                        "enum_values": getattr(deliverable, 'enum_values', None),
                    }
                )
                items.append(item)

        # Determine group status
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
            completed_at=getattr(state, 'completed_at', None),
            metadata={
                "state_type": state.type.value,
                "transitions": [
                    {
                        "target": t.target_state_id,
                        "condition": t.condition_type,
                        "priority": t.priority,
                    }
                    for t in state.transitions
                ] if state.transitions else [],
            }
        )

    @classmethod
    def from_plan(cls, plan: Plan, current_state_id: Optional[str] = None) -> ProgressState:
        """
        Create a ProgressState from a Plan definition (before execution starts).

        Useful for showing the initial state/preview of a plan.

        Args:
            plan: The plan definition.
            current_state_id: Optional ID of the current state.

        Returns:
            A ProgressState with all items in pending status.
        """
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
                "architecture": "state_machine",
            }
        )
