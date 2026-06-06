"""State Machine engine for Stella Light Agent.

Main orchestration engine that manages plan execution including:
- Plan loading and initialization
- State transitions
- Task/deliverable processing modes (STRICT/LOOSE)
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
from stella_light_agent.models.todo_list import TodoListState
from stella_light_agent.state_machine.execution_state import ExecutionState


@dataclass
class TaskProcessingResult:
    """Result from processing tasks against user input."""
    completed_tasks: List[str] = field(default_factory=list)
    skipped_tasks: List[str] = field(default_factory=list)
    updated_deliverables: List[str] = field(default_factory=list)
    state_complete: bool = False
    should_advance: bool = False
    next_state_id: Optional[str] = None
    transition_reason: Optional[str] = None  # Reason for state transition
    transitioned: bool = False


class StateMachine:
    """
    Main state machine engine that orchestrates plan execution.

    Manages:
    - Plan loading and initialization
    - State transitions
    - Task/deliverable processing modes (STRICT/LOOSE)
    """

    # Guard against circular transition loops within a single turn (e.g. A -> B -> A,
    # or a cascade of already-satisfied states). Bounds chained advancement per turn.
    MAX_TRANSITIONS_PER_TURN = 10
    # Last-resort safety net (#291). Completion is agent-driven; if the agent never
    # completes/skips a state's tasks, the state would hang forever. After this many
    # no-progress turns in a single state, force the default forward transition so
    # the conversation can always recover. A floor, not the primary mechanism — set
    # high, and every firing is logged so stuck agents are visible.
    STUCK_STATE_TURN_LIMIT = 10

    def __init__(self):
        self.execution_state: Optional[ExecutionState] = None
        self.plan: Optional[Plan] = None
        self._initialized = False

    def initialize(self, plan_config: Dict[str, Any]) -> bool:
        """
        Initialize the state machine with a plan configuration.

        Args:
            plan_config: Plan dictionary from session config (canonical format)

        Returns:
            True if initialization successful
        """
        try:
            self.plan = Plan.from_dict(plan_config)
            self.ensure_transitions(self.plan)
            self.execution_state = ExecutionState(plan=self.plan)
            self._initialized = True
            return True
        except Exception as e:
            print(f"[StateMachine] Initialization failed: {e}")
            return False

    def ensure_transitions(self, plan: Plan) -> Plan:
        """Normalize a plan's transitions in place so every state can advance.

        A state with no explicit transitions gets a default ``all_tasks_complete``
        transition to the next state in plan order. #291 redesign: the engine no
        longer auto-injects a ``turn_count_exceeded`` fallback — advancement is
        agent-driven (the agent completes/skips every task, or skips the whole
        state). ``turn_count_exceeded`` remains a condition a plan author may add
        explicitly. The last state is terminal (no transition).
        """
        states = plan.states
        last_index = len(states) - 1

        for index, state in enumerate(states):
            is_last_state = index == last_index
            next_state_id = None if is_last_state else states[index + 1].id

            # Keep authored transitions as-is.
            if state.transitions:
                continue

            # Last state: terminal, nothing to advance to.
            if is_last_state:
                continue

            print(
                f"[StateMachine] Auto-generating transition for state "
                f"'{state.id}' -> '{next_state_id}'"
            )
            state.transitions.append(
                StateTransition(
                    target_state_id=next_state_id,
                    condition_type="all_tasks_complete",
                    priority=1,
                )
            )

        return plan

    @property
    def is_initialized(self) -> bool:
        """Check if state machine is initialized."""
        return self._initialized and self.execution_state is not None

    @property
    def current_mode(self) -> Optional[StateType]:
        """Get the current processing mode."""
        if not self.execution_state:
            return None
        return self.execution_state.processing_mode

    @property
    def current_state(self) -> Optional[State]:
        """Get the current state."""
        if not self.execution_state:
            return None
        return self.execution_state.current_state

    def get_context_for_prompt(self) -> Dict[str, Any]:
        """
        Get current state machine context for prompt building.

        Returns context including:
        - Current state info
        - Available tasks
        - Pending deliverables
        - Processing mode
        - Progress info
        """
        if not self.execution_state:
            return {}

        state = self.execution_state.current_state
        if not state:
            return {}

        available_tasks = self.execution_state.get_available_tasks()
        current_task = self.execution_state.get_current_task()

        # Build deliverables info for available tasks
        deliverables_info = []
        for task in available_tasks:
            for d in task.deliverables:
                deliverables_info.append({
                    "key": d.key,
                    "description": d.description,
                    "type": d.type,
                    "required": d.required,
                    "acceptance_criteria": d.acceptance_criteria,
                    # Only show examples for pending deliverables
                    "examples": d.examples if d.status == DeliverableStatus.PENDING else [],
                    "status": d.status.value,
                    "value": d.value if d.status == DeliverableStatus.COMPLETED else None
                })

        return {
            "state": {
                "id": state.id,
                "title": state.title,
                "type": state.type.value,
                "description": state.description
            },
            "processing_mode": self.execution_state.processing_mode.value,
            "available_tasks": [
                {
                    "id": t.id,
                    "description": t.description,
                    "instruction": t.instruction,
                    "required": t.required,
                    "has_deliverables": len(t.deliverables) > 0
                }
                for t in available_tasks
            ],
            "current_task": {
                "id": current_task.id,
                "description": current_task.description,
                "instruction": current_task.instruction
            } if current_task else None,
            "deliverables": deliverables_info,
            "progress": {
                "percentage": self.execution_state.calculate_progress(),
                "turns_without_deliverable": self.execution_state.turns_without_deliverable
            },
            "state_just_changed": self.execution_state.state_just_changed
        }

    def process_turn(
        self,
        extracted: Optional[Dict[str, Any]] = None,
        completed_task_ids: Optional[List[str]] = None,
        skipped_task_ids: Optional[List[str]] = None,
    ) -> TaskProcessingResult:
        """Apply one conversation turn and evaluate transitions.

        This is the single per-turn entry point. It:
        1. marks any explicitly-completed and explicitly-skipped tasks,
        2. records collected deliverables,
        3. accounts exactly one turn (progress vs no-progress),
        4. evaluates transitions and advances the state machine.

        #291 redesign: completion/skip are EXPLICIT agent actions. Setting a
        deliverable never completes a task on its own — the agent must list the
        task in completed_task_ids (or skipped_task_ids). The state advances once
        every task is completed or skipped.

        Args:
            extracted: Dict of {key: {value: X, reasoning: Y}} or {key: value}.
            completed_task_ids: IDs of tasks the agent explicitly completed.
            skipped_task_ids: IDs of tasks the agent explicitly skipped.
        """
        result = TaskProcessingResult()

        if not self.execution_state:
            return result

        es = self.execution_state
        extracted = extracted or {}
        completed_task_ids = completed_task_ids or []
        skipped_task_ids = skipped_task_ids or []

        # Snapshot tasks already addressed (completed or skipped) BEFORE this turn,
        # so only work done *this* turn counts as progress (the no-progress counter,
        # which feeds any author turn_count_exceeded route, must not be reset by
        # re-reporting prior completions) (#291).
        already_addressed = (
            {t.id for t in es.current_state.tasks
             if t.status in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)}
            if es.current_state
            else set()
        )
        previous_values = es.get_all_deliverable_values()

        # 1. Explicit task completions and skips.
        for task_id in completed_task_ids:
            es.mark_task_completed(task_id)
        for task_id in skipped_task_ids:
            es.mark_task_skipped(task_id)

        # 2. Collected deliverables (supports {key: value} and {key: {value, reasoning}}).
        #    Only a *changed* value counts as progress.
        for key, data in extracted.items():
            if isinstance(data, dict):
                value = data.get("value")
                reasoning = data.get("reasoning", "")
            else:
                value = data
                reasoning = ""

            value_changed = key not in previous_values or previous_values[key] != value
            if es.set_deliverable_value(key, value, reasoning) and value_changed:
                result.updated_deliverables.append(key)
                print(f"[StateMachine] Set deliverable: {key} = {value}")

        # 3. Report tasks addressed THIS turn (newly completed or skipped).
        if es.current_state:
            for task in es.current_state.tasks:
                if task.id in already_addressed:
                    continue
                if task.status == TaskStatus.COMPLETED:
                    result.completed_tasks.append(task.id)
                    print(f"[StateMachine] Task completed: {task.id}")
                elif task.status == TaskStatus.SKIPPED:
                    result.skipped_tasks.append(task.id)
                    print(f"[StateMachine] Task skipped: {task.id}")

        made_progress = bool(
            result.updated_deliverables or result.completed_tasks or result.skipped_tasks
        )

        # 4. Account exactly one turn BEFORE evaluating transitions (so an author
        #    turn_count_exceeded route sees the up-to-date counter).
        es.record_turn(made_progress=made_progress)

        # 5. Evaluate transitions and advance as far as conditions dictate.
        result.state_complete = es.is_current_state_complete()
        self._run_transitions(result)

        return result

    def process_deliverables(
        self,
        extracted: Dict[str, Any]
    ) -> TaskProcessingResult:
        """Backward-compatible wrapper around :meth:`process_turn`."""
        return self.process_turn(extracted=extracted)

    def _run_transitions(self, result: TaskProcessingResult) -> None:
        """Evaluate transitions and advance, with a per-turn loop guard.

        Advances repeatedly while a transition condition is met (so a cascade of
        already-satisfied states resolves in one turn), bounded by
        ``MAX_TRANSITIONS_PER_TURN`` to defend against circular plans. Mutates
        ``result`` to reflect the final transition taken.
        """
        es = self.execution_state
        if not es:
            return

        for _ in range(self.MAX_TRANSITIONS_PER_TURN):
            transition = es.find_matching_transition()
            target_id = transition.target_state_id if transition else None
            reason = self._transition_reason(transition) if transition else None

            # Safety net (#291): if no condition matched but the agent has left this
            # state stuck for too many no-progress turns, force the default forward
            # transition so the conversation can always recover.
            if not transition:
                target_id = self._stuck_state_release_target()
                if not target_id:
                    break
                reason = "safety_net_stuck"
                print(
                    f"[StateMachine] SAFETY NET: state '{es.current_state_id}' stuck for "
                    f"{es.turns_without_deliverable} turns without progress "
                    f"(limit {self.STUCK_STATE_TURN_LIMIT}); force-advancing to '{target_id}'."
                )

            old_state = es.current_state_id
            if not es.advance_to_state(target_id):
                print(
                    f"[StateMachine] Transition target '{target_id}' not found; skipping"
                )
                break

            result.transitioned = True
            result.should_advance = True
            result.next_state_id = target_id
            result.transition_reason = reason
            print(
                f"[StateMachine] State transition: {old_state} -> "
                f"{target_id} ({reason})"
            )
        else:
            print(
                f"[StateMachine] Max transitions per turn "
                f"({self.MAX_TRANSITIONS_PER_TURN}) reached; stopping to avoid a loop"
            )

    def _stuck_state_release_target(self) -> Optional[str]:
        """Return the next state in plan order if the current state is stuck.

        "Stuck" = ``turns_without_deliverable >= STUCK_STATE_TURN_LIMIT`` (the agent
        never completed/skipped this state's tasks). Returns None when the threshold
        is not reached or the current state is the last one (terminal, nowhere to go).
        """
        es = self.execution_state
        if not es or es.turns_without_deliverable < self.STUCK_STATE_TURN_LIMIT:
            return None
        states = es.plan.states
        for index, state in enumerate(states):
            if state.id == es.current_state_id:
                if index >= len(states) - 1:
                    return None  # last state: terminal
                return states[index + 1].id
        return None

    @staticmethod
    def _transition_reason(transition: StateTransition) -> str:
        """Human-readable reason string for a fired transition (for logs/telemetry)."""
        ct = transition.condition_type
        cfg = transition.condition_config or {}
        if ct == "all_tasks_complete":
            return "all_required_tasks_complete"
        if ct == "turn_count_exceeded":
            return f"turn_count_exceeded:{cfg.get('scope', 'without_progress')}"
        if ct == "deliverable_value":
            return f"deliverable_value:{cfg.get('key')}={cfg.get('value')}"
        if ct == "deliverable_exists":
            return f"deliverable_exists:{cfg.get('key')}"
        return ct

    def advance_state(self) -> bool:
        """
        Advance to the next state based on transitions.

        Returns:
            True if state was advanced
        """
        if not self.execution_state:
            return False

        next_state = self.execution_state.evaluate_transitions()
        if next_state:
            old_state = self.execution_state.current_state_id
            success = self.execution_state.advance_to_state(next_state)
            if success:
                print(f"[StateMachine] State transition: {old_state} -> {next_state}")
            return success
        return False

    def force_transition(self, target_state_id: Optional[str] = None) -> bool:
        """
        Force a state transition.

        Args:
            target_state_id: Optional specific state to transition to.
                           If None, uses first valid transition.

        Returns:
            True if transition occurred
        """
        if not self.execution_state:
            return False

        if target_state_id:
            old_state = self.execution_state.current_state_id
            success = self.execution_state.advance_to_state(target_state_id)
            if success:
                print(f"[StateMachine] Forced transition: {old_state} -> {target_state_id}")
            return success

        # Find first available transition
        state = self.execution_state.current_state
        if state and state.transitions:
            target = state.transitions[0].target_state_id
            old_state = self.execution_state.current_state_id
            success = self.execution_state.advance_to_state(target)
            if success:
                print(f"[StateMachine] Forced transition: {old_state} -> {target}")
            return success

        return False

    def increment_turn(self) -> int:
        """Record a no-progress turn, evaluate transitions, and return the counter.

        A no-progress turn is itself a transition trigger: ``turn_count_exceeded``
        (the fallback that releases all-optional states) can only fire if we
        re-evaluate here — nothing else does after a turn with no deliverables (#291).
        Returns the post-evaluation no-progress counter (0 if a transition fired,
        since advancing resets it).
        """
        if not self.execution_state:
            return 0
        self.process_turn()
        count = self.execution_state.turns_without_deliverable
        print(f"[StateMachine] Turns without deliverable: {count}")
        return count

    def get_todo_list(self) -> Optional[TodoListState]:
        """Get the current todo list state for debug output."""
        if not self.execution_state:
            return None
        return self.execution_state.build_todo_list()

    def clear_state_changed_flag(self):
        """Clear the state changed flag after it's been processed."""
        if self.execution_state:
            self.execution_state.clear_state_changed_flag()

    def mark_tasks_completed(self, task_ids: List[str]) -> List[str]:
        """
        Mark multiple tasks as completed by their IDs.

        This is used for tasks without deliverables that the agent
        explicitly marks as complete after performing them.

        Args:
            task_ids: List of task IDs to mark as completed

        Returns:
            List of task IDs that were successfully marked completed
        """
        if not self.execution_state:
            return []

        completed = []
        for task_id in task_ids:
            if self.execution_state.mark_task_completed(task_id):
                completed.append(task_id)
                print(f"[StateMachine] Task explicitly completed: {task_id}")

        return completed

    def get_status_summary(self) -> Dict[str, Any]:
        """Get a summary of state machine status for logging."""
        if not self.execution_state:
            return {"initialized": False}

        return {
            "initialized": True,
            "plan_id": self.plan.id if self.plan else None,
            **self.execution_state.get_context_summary()
        }
