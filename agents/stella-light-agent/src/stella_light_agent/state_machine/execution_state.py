"""Execution state tracking for Stella Light Agent state machine.

Tracks the runtime state of plan execution including:
- Current state in the plan
- Task completion status
- Deliverable values and status
- Turn counter
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional

from stella_light_agent.models.state_machine import (
    Plan,
    State,
    StateTransition,
    Task,
    Deliverable,
    DeliverableStatus,
    TaskStatus,
    StateType,
)
from stella_light_agent.models.todo_list import TodoItem, TodoListState


@dataclass
class ExecutionState:
    """
    Tracks the runtime state of plan execution.

    Maintains:
    - Current state in the plan
    - Task completion status
    - Deliverable values and status
    - Turn counter
    """
    plan: Plan
    current_state_id: str = ""
    # Consecutive turns in the current state without any deliverable/task progress.
    # Resets on progress and on a state change. Feeds turn_count_exceeded
    # (scope="without_progress"), the fallback that releases all-optional states (#291).
    turns_without_deliverable: int = 0
    # Total turns spent in the current state (progress or not). Resets on a state
    # change. Feeds turn_count_exceeded (scope="total").
    total_turns: int = 0
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

                    # NOTE: turn-counter accounting is intentionally NOT done here.
                    # record_turn() is the single source of truth.

                    # Setting a deliverable moves the task to IN_PROGRESS but never
                    # completes it — completion is an explicit agent action via
                    # mark_task_completed (#291: no completion is derived from data).
                    if task.status == TaskStatus.PENDING:
                        task.status = TaskStatus.IN_PROGRESS

                    return True
        return False

    def get_deliverable_value(self, key: str) -> Optional[Any]:
        """Get a collected deliverable value."""
        return self._deliverable_values.get(key)

    def get_all_deliverable_values(self) -> Dict[str, Any]:
        """Get all collected deliverable values."""
        return dict(self._deliverable_values)

    def record_turn(self, made_progress: bool) -> None:
        """Record exactly one conversation turn spent in the current state.

        This is the single source of truth for turn accounting and must be called
        once per user turn by the engine:
        - ``total_turns`` counts every turn in the current state (reset on a state
          change), feeding ``turn_count_exceeded`` with ``scope="total"``.
        - ``turns_without_deliverable`` counts only consecutive turns without
          progress (reset on progress), feeding ``scope="without_progress"`` — the
          fallback that releases all-optional states after a few attempts (#291).
        """
        self.total_turns += 1
        if made_progress:
            self.turns_without_deliverable = 0
        else:
            self.turns_without_deliverable += 1

    def increment_turn_counter(self) -> int:
        """Increment and return the no-progress turn counter.

        Low-level helper retained for backward compatibility; prefer
        :meth:`record_turn` which also tracks ``total_turns``.
        """
        self.record_turn(made_progress=False)
        return self.turns_without_deliverable

    def reset_turn_counter(self):
        """Reset the no-progress turn counter (e.g. when progress is made)."""
        self.turns_without_deliverable = 0

    def is_current_state_complete(self) -> bool:
        """Whether the current state is complete (for ``all_tasks_complete``).

        #291 redesign: a state is complete only once every task has been explicitly
        completed or skipped by the agent. ``required`` is informational and does not
        gate completion, so there is no vacuous-truth case — a state with tasks is
        never complete on entry because no task has been addressed yet.
        """
        state = self.current_state
        if not state:
            return True

        task_statuses = [(t.id, t.status.value) for t in state.tasks]
        is_complete = state.is_complete()
        print(f"[StateMachine] is_current_state_complete: {is_complete}")
        print(f"[StateMachine]   Task statuses: {task_statuses}")

        return is_complete

    def find_matching_transition(self) -> Optional[StateTransition]:
        """Return the highest-priority transition whose condition is met, or None.

        Transitions are evaluated in priority order (lower ``priority`` number =
        higher precedence). This is what lets an explicit ``deliverable_value`` /
        ``deliverable_exists`` route (low priority number) win over the auto-injected
        ``turn_count_exceeded`` fallback (priority 1000) when the user actually
        provides the optional information (#291).
        """
        state = self.current_state
        if not state:
            return None

        # Sort by priority (lower priority number = higher priority)
        sorted_transitions = sorted(
            state.transitions,
            key=lambda t: t.priority
        )

        print(f"[StateMachine] find_matching_transition: checking {len(sorted_transitions)} transitions")

        for transition in sorted_transitions:
            condition_met = self._evaluate_condition(transition)
            print(f"[StateMachine]   Transition to '{transition.target_state_id}' "
                  f"(condition: {transition.condition_type}, priority: {transition.priority}): {condition_met}")
            if condition_met:
                return transition

        print(f"[StateMachine]   No transition conditions met")
        return None

    def evaluate_transitions(self) -> Optional[str]:
        """Evaluate transitions and return the target state ID if any match."""
        transition = self.find_matching_transition()
        return transition.target_state_id if transition else None

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

        if transition.condition_type == "turn_count_exceeded":
            return self._evaluate_turn_count_exceeded(transition.condition_config or {})

        # Default: don't transition
        return False

    def _evaluate_turn_count_exceeded(self, config: Dict[str, Any]) -> bool:
        """Evaluate a ``turn_count_exceeded`` guardrail transition.

        Two scopes (mirrors the NestJS backend and docs):
        - ``without_progress`` (default): consecutive turns without progress.
        - ``total``: total turns spent in the current state.

        A misconfigured threshold (missing / non-numeric / negative / unknown scope)
        never fires the transition — the state machine fails safe rather than
        jumping unexpectedly.
        """
        raw_threshold = config.get("turns", config.get("value"))
        try:
            threshold = int(raw_threshold)
        except (TypeError, ValueError):
            print(f"[StateMachine]   turn_count_exceeded misconfigured: threshold '{raw_threshold}' is not a number")
            return False
        if threshold < 0:
            print(f"[StateMachine]   turn_count_exceeded misconfigured: negative threshold {threshold}")
            return False

        scope = str(config.get("scope", "without_progress")).lower()
        if scope == "without_progress":
            return self.turns_without_deliverable >= threshold
        if scope == "total":
            return self.total_turns >= threshold

        print(f"[StateMachine]   turn_count_exceeded misconfigured: unknown scope '{scope}'")
        return False

    def advance_to_state(self, state_id: str) -> bool:
        """Advance to a new state, resetting per-state turn counters."""
        if self.plan.get_state(state_id):
            self.current_state_id = state_id
            self.turns_without_deliverable = 0
            self.total_turns = 0
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
            print(f"[StateMachine] mark_task_completed('{task_id}'): FAILED - no current state")
            return False

        available_task_ids = [t.id for t in state.tasks]
        for task in state.tasks:
            if task.id == task_id:
                old_status = task.status
                task.status = TaskStatus.COMPLETED
                # Turn-counter accounting is left to record_turn() (single source of
                # truth); re-marking an already-complete task is not fresh progress
                # and must not reset the no-progress counter (#291).
                print(f"[StateMachine] mark_task_completed('{task_id}'): SUCCESS "
                      f"({old_status.value} -> {task.status.value})")
                return True

        print(f"[StateMachine] mark_task_completed('{task_id}'): FAILED - task not found")
        print(f"[StateMachine]   Available task IDs in current state: {available_task_ids}")
        return False

    def mark_task_skipped(self, task_id: str) -> bool:
        """Mark a task as skipped (the agent decided it is not needed).

        Skipping addresses a task just like completing it, so the state can advance
        once every task is completed or skipped (#291).
        """
        state = self.current_state
        if not state:
            print(f"[StateMachine] mark_task_skipped('{task_id}'): FAILED - no current state")
            return False

        for task in state.tasks:
            if task.id == task_id:
                old_status = task.status
                task.status = TaskStatus.SKIPPED
                print(f"[StateMachine] mark_task_skipped('{task_id}'): SUCCESS "
                      f"({old_status.value} -> {task.status.value})")
                return True

        available_task_ids = [t.id for t in state.tasks]
        print(f"[StateMachine] mark_task_skipped('{task_id}'): FAILED - task not found")
        print(f"[StateMachine]   Available task IDs in current state: {available_task_ids}")
        return False

    def skip_current_state(self) -> List[str]:
        """Skip every not-yet-addressed task in the current state.

        Returns the list of task IDs that were newly skipped, so the state becomes
        complete and advances on the next transition evaluation (#291).
        """
        state = self.current_state
        if not state:
            return []
        newly_skipped = []
        for task in state.tasks:
            if task.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED):
                task.status = TaskStatus.SKIPPED
                newly_skipped.append(task.id)
        if newly_skipped:
            print(f"[StateMachine] skip_current_state('{state.id}'): skipped {newly_skipped}")
        return newly_skipped

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
