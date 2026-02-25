"""Execution state tracking for the state machine.

Tracks the runtime state of plan execution including:
- Current state in the plan
- Task completion status
- Deliverable values and status
- Turn counter for timekeeper
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional

from stella_v2_agent.models.state_machine import (
    Plan,
    State,
    Task,
    Deliverable,
    DeliverableStatus,
    TaskStatus,
    StateType,
)
from stella_v2_agent.models.todo_list import TodoItem, TodoListState


@dataclass
class ExecutionState:
    """Tracks the runtime state of plan execution.

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
        return self.plan.get_state(self.current_state_id)

    @property
    def processing_mode(self) -> StateType:
        state = self.current_state
        return state.type if state else StateType.LOOSE

    @property
    def state_just_changed(self) -> bool:
        return self._state_just_changed

    def clear_state_changed_flag(self):
        self._state_just_changed = False

    def get_available_tasks(self) -> List[Task]:
        """Get tasks available for processing based on mode.

        STRICT: Only the first non-completed task.
        LOOSE: All non-completed tasks.
        """
        state = self.current_state
        if not state:
            return []

        non_completed = [
            t for t in state.tasks
            if t.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
        ]

        if self.processing_mode == StateType.STRICT:
            return non_completed[:1]
        return non_completed

    def get_current_task(self) -> Optional[Task]:
        tasks = self.get_available_tasks()
        return tasks[0] if tasks else None

    def set_deliverable_value(self, key: str, value: Any, reasoning: str = "") -> bool:
        """Set a deliverable value and update task/deliverable status.

        Searches ALL states in the plan, not just the current state.
        This allows the extractor to overwrite previously collected values
        and set deliverables in any state.

        Returns True if the deliverable was found and updated.
        """
        for state in self.plan.states:
            for task in state.tasks:
                for deliverable in task.deliverables:
                    if deliverable.key == key:
                        deliverable.value = value
                        deliverable.reasoning = reasoning
                        deliverable.status = DeliverableStatus.COMPLETED
                        self._deliverable_values[key] = value
                        self._deliverable_reasoning[key] = reasoning

                        self.turns_without_deliverable = 0

                        if task.status == TaskStatus.PENDING:
                            task.status = TaskStatus.IN_PROGRESS
                        if task.is_complete():
                            task.status = TaskStatus.COMPLETED

                        return True
        return False

    def get_deliverable_value(self, key: str) -> Optional[Any]:
        return self._deliverable_values.get(key)

    def get_all_deliverable_values(self) -> Dict[str, Any]:
        return dict(self._deliverable_values)

    def increment_turn_counter(self) -> int:
        self.turns_without_deliverable += 1
        return self.turns_without_deliverable

    def reset_turn_counter(self):
        self.turns_without_deliverable = 0

    def is_current_state_complete(self) -> bool:
        state = self.current_state
        if not state:
            return True
        return state.is_complete()

    def evaluate_transitions(self) -> Optional[str]:
        """Evaluate state transitions and return target state ID if any match."""
        state = self.current_state
        if not state:
            return None

        sorted_transitions = sorted(state.transitions, key=lambda t: t.priority)

        for transition in sorted_transitions:
            if self._evaluate_condition(transition):
                return transition.target_state_id
        return None

    def _evaluate_condition(self, transition) -> bool:
        if transition.condition_type == "all_tasks_complete":
            return self.is_current_state_complete()
        if transition.condition_type == "deliverable_value":
            key = transition.condition_config.get("key")
            expected = transition.condition_config.get("value")
            return self.get_deliverable_value(key) == expected
        if transition.condition_type == "deliverable_exists":
            key = transition.condition_config.get("key")
            return self.get_deliverable_value(key) is not None
        return False

    def advance_to_state(self, state_id: str) -> bool:
        if self.plan.get_state(state_id):
            self.current_state_id = state_id
            self.turns_without_deliverable = 0
            self._state_just_changed = True
            return True
        return False

    def calculate_progress(self) -> float:
        total = self.plan.count_required_deliverables()
        completed = self.plan.count_completed_deliverables()
        if total == 0:
            return 100.0
        return (completed / total) * 100

    def build_todo_list(self) -> TodoListState:
        state = self.current_state
        items: List[TodoItem] = []

        if state:
            for task in state.tasks:
                items.append(TodoItem(
                    id=task.id,
                    title=task.description,
                    status=task.status.value,
                    type="task",
                ))
                for d in task.deliverables:
                    items.append(TodoItem(
                        id=d.key,
                        title=d.description,
                        status=d.status.value,
                        type="deliverable",
                        parent_id=task.id,
                        value=d.value,
                        reasoning=d.reasoning,
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
            completed_deliverables=dict(self._deliverable_values),
        )

    def mark_task_completed(self, task_id: str) -> bool:
        """Mark a task as completed by ID (for tasks without deliverables).

        Searches ALL states in the plan, not just the current state.
        """
        for state in self.plan.states:
            for task in state.tasks:
                if task.id == task_id:
                    task.status = TaskStatus.COMPLETED
                    self.turns_without_deliverable = 0
                    return True
        return False

    def skip_optional_pending(self) -> List[str]:
        """Skip all optional pending deliverables/tasks in the current state."""
        state = self.current_state
        if not state:
            return []

        skipped_keys: List[str] = []

        for task in state.tasks:
            # Skip optional pending deliverables
            for deliverable in task.deliverables:
                if (deliverable.status == DeliverableStatus.PENDING
                        and not deliverable.required):
                    deliverable.status = DeliverableStatus.SKIPPED
                    deliverable.value = "skipped (optional)"
                    deliverable.reasoning = "Auto-skipped: optional deliverable after stagnation"
                    skipped_keys.append(deliverable.key)

            # Update task status after deliverable changes
            if task.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED):
                if not task.required and task.is_complete():
                    task.status = TaskStatus.SKIPPED
                elif task.required and task.is_complete():
                    task.status = TaskStatus.COMPLETED

        if skipped_keys:
            self.turns_without_deliverable = 0

        return skipped_keys

    def get_context_summary(self) -> Dict[str, Any]:
        state = self.current_state
        return {
            "current_state_id": self.current_state_id,
            "current_state_title": state.title if state else None,
            "processing_mode": self.processing_mode.value,
            "progress_percentage": self.calculate_progress(),
            "turns_without_deliverable": self.turns_without_deliverable,
            "available_tasks": len(self.get_available_tasks()),
            "state_complete": self.is_current_state_complete(),
        }
