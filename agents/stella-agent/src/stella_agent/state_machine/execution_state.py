"""Execution state tracking for Stella Agent state machine.

Tracks the runtime state of plan execution including:
- Current state in the plan
- Task completion status
- Deliverable values and status
- Turn counter for timekeeper
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional

from stella_agent.models.state_machine import (
    Plan,
    State,
    Task,
    Deliverable,
    DeliverableStatus,
    TaskStatus,
    StateType,
)
from stella_agent.models.todo_list import TodoItem, TodoListState


@dataclass
class ExecutionState:
    """
    Tracks the runtime state of plan execution.

    Maintains:
    - Current state in the plan
    - Task completion status
    - Deliverable values and status
    - Turn counter for timekeeper
    """
    plan: Plan
    current_state_id: str = ""
    turns_without_deliverable: int = 0
    _deliverable_values: Dict[str, Any] = field(default_factory=dict)
    _deliverable_reasoning: Dict[str, str] = field(default_factory=dict)
    _state_just_changed: bool = False

    def __post_init__(self):
        if not self.current_state_id:
            self.current_state_id = self.plan.initial_state_id

    @property
    def current_state(self) -> Optional[State]:
        """Get the current state object."""
        return self.plan.get_state(self.current_state_id)

    @property
    def processing_mode(self) -> StateType:
        """Get the processing mode of the current state."""
        state = self.current_state
        return state.type if state else StateType.LOOSE

    @property
    def state_just_changed(self) -> bool:
        """Check if state just changed (for prompt warning)."""
        return self._state_just_changed

    def clear_state_changed_flag(self):
        """Clear the state changed flag after it's been used."""
        self._state_just_changed = False

    def get_available_tasks(self) -> List[Task]:
        """
        Get tasks available for processing based on mode.

        STRICT: Only the first non-completed task
        LOOSE: All non-completed tasks
        """
        state = self.current_state
        if not state:
            return []

        non_completed = [
            t for t in state.tasks
            if t.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
        ]

        if self.processing_mode == StateType.STRICT:
            return non_completed[:1]  # Only first task
        else:
            return non_completed  # All tasks

    def get_current_task(self) -> Optional[Task]:
        """Get the current task (first available)."""
        tasks = self.get_available_tasks()
        return tasks[0] if tasks else None

    def set_deliverable_value(
        self,
        key: str,
        value: Any,
        reasoning: str = ""
    ) -> bool:
        """
        Set a deliverable value and update status.

        Returns True if deliverable was found and updated.
        """
        state = self.current_state
        if not state:
            return False

        for task in state.tasks:
            for deliverable in task.deliverables:
                if deliverable.key == key:
                    deliverable.value = value
                    deliverable.reasoning = reasoning
                    deliverable.status = DeliverableStatus.COMPLETED
                    self._deliverable_values[key] = value
                    self._deliverable_reasoning[key] = reasoning

                    # Reset turn counter on deliverable collection
                    self.turns_without_deliverable = 0

                    # Update task status
                    if task.status == TaskStatus.PENDING:
                        task.status = TaskStatus.IN_PROGRESS

                    # Check if task is now complete
                    if task.is_complete():
                        task.status = TaskStatus.COMPLETED

                    return True
        return False

    def get_deliverable_value(self, key: str) -> Optional[Any]:
        """Get a collected deliverable value."""
        return self._deliverable_values.get(key)

    def get_all_deliverable_values(self) -> Dict[str, Any]:
        """Get all collected deliverable values."""
        return dict(self._deliverable_values)

    def increment_turn_counter(self) -> int:
        """Increment and return the turn counter."""
        self.turns_without_deliverable += 1
        return self.turns_without_deliverable

    def reset_turn_counter(self):
        """Reset the turn counter."""
        self.turns_without_deliverable = 0

    def is_current_state_complete(self) -> bool:
        """Check if the current state is complete."""
        state = self.current_state
        return state.is_complete() if state else True

    def evaluate_transitions(self) -> Optional[str]:
        """
        Evaluate state transitions and return target state ID if any match.
        """
        state = self.current_state
        if not state:
            return None

        # Sort by priority (lower priority number = higher priority)
        sorted_transitions = sorted(
            state.transitions,
            key=lambda t: t.priority
        )

        for transition in sorted_transitions:
            if self._evaluate_condition(transition):
                return transition.target_state_id

        return None

    def _evaluate_condition(self, transition) -> bool:
        """Evaluate a transition condition."""
        if transition.condition_type == "all_tasks_complete":
            return self.is_current_state_complete()

        if transition.condition_type == "deliverable_value":
            key = transition.condition_config.get("key")
            expected = transition.condition_config.get("value")
            actual = self.get_deliverable_value(key)
            return actual == expected

        if transition.condition_type == "deliverable_exists":
            key = transition.condition_config.get("key")
            return self.get_deliverable_value(key) is not None

        # Default: don't transition
        return False

    def advance_to_state(self, state_id: str) -> bool:
        """Advance to a new state."""
        if self.plan.get_state(state_id):
            self.current_state_id = state_id
            self.turns_without_deliverable = 0
            self._state_just_changed = True
            return True
        return False

    def calculate_progress(self) -> float:
        """Calculate overall plan progress as percentage."""
        total_deliverables = self.plan.count_required_deliverables()
        completed_deliverables = self.plan.count_completed_deliverables()

        if total_deliverables == 0:
            return 100.0

        return (completed_deliverables / total_deliverables) * 100

    def build_todo_list(self) -> TodoListState:
        """Build the current todo list state for debug output."""
        state = self.current_state
        items: List[TodoItem] = []

        if state:
            for task in state.tasks:
                # Add task item
                items.append(TodoItem(
                    id=task.id,
                    title=task.description,
                    status=task.status.value,
                    type="task"
                ))

                # Add deliverable items
                for d in task.deliverables:
                    items.append(TodoItem(
                        id=d.key,
                        title=d.description,
                        status=d.status.value,
                        type="deliverable",
                        parent_id=task.id,
                        value=d.value,
                        reasoning=d.reasoning
                    ))

        return TodoListState(
            plan_id=self.plan.id,
            plan_title=self.plan.title,
            current_state_id=self.current_state_id,
            current_state_title=state.title if state else "",
            processing_mode=self.processing_mode.value,
            progress_percentage=self.calculate_progress(),
            turns_without_deliverable=self.turns_without_deliverable,
            items=items,
            completed_deliverables=dict(self._deliverable_values)
        )

    def mark_task_completed(self, task_id: str) -> bool:
        """
        Mark a task as completed by ID (for tasks without deliverables).

        This allows the agent to explicitly complete tasks that don't require
        data collection, such as "State your name" or "Tell a joke".

        Args:
            task_id: The ID of the task to mark as completed

        Returns:
            True if task was found and marked completed
        """
        state = self.current_state
        if not state:
            return False

        for task in state.tasks:
            if task.id == task_id:
                task.status = TaskStatus.COMPLETED
                # Reset turn counter since progress was made
                self.turns_without_deliverable = 0
                return True
        return False

    def get_context_summary(self) -> Dict[str, Any]:
        """Get a summary of current execution state for logging."""
        state = self.current_state
        return {
            "current_state_id": self.current_state_id,
            "current_state_title": state.title if state else None,
            "processing_mode": self.processing_mode.value,
            "progress_percentage": self.calculate_progress(),
            "turns_without_deliverable": self.turns_without_deliverable,
            "available_tasks": len(self.get_available_tasks()),
            "state_complete": self.is_current_state_complete()
        }
