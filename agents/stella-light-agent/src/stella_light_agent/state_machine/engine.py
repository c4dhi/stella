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

    # Turns-without-progress before an all-optional state releases on its own. The
    # agent "tries" the optional work for this many turns, then advances rather
    # than persisting the way it would for required work (#291, mirrors NestJS #172).
    DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD = 3
    # Guard against circular transition loops within a single turn (e.g. A -> B -> A,
    # or a cascade of already-satisfied states). Bounds chained advancement per turn.
    MAX_TRANSITIONS_PER_TURN = 10

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

    @classmethod
    def _build_turn_fallback_transition(cls, next_state_id: str) -> StateTransition:
        """Build the turn-based fallback used to release an all-optional state.

        Low urgency (high ``priority`` number) so any explicit author condition —
        e.g. a ``deliverable_value`` route — wins when the user actually provides
        the optional information; this only fires when nothing else matched for
        ``DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD`` turns without progress (#291).
        """
        return StateTransition(
            target_state_id=next_state_id,
            condition_type="turn_count_exceeded",
            priority=1000,
            condition_config={
                "turns": cls.DEFAULT_OPTIONAL_STATE_TURN_THRESHOLD,
                "scope": "without_progress",
            },
        )

    def ensure_transitions(self, plan: Plan) -> Plan:
        """Normalize a plan's transitions in place so every state can advance.

        Two responsibilities (ported from the NestJS ``ensureTransitions``, #172):

        1. A state with no explicit transitions gets a default transition to the
           next state in the plan — ``all_tasks_complete`` for states with required
           work, or a ``turn_count_exceeded`` fallback for all-optional states
           (which can never satisfy ``all_tasks_complete`` after the #291 guard).
        2. An all-optional, non-last state additionally gets a ``turn_count_exceeded``
           fallback appended (unless it already has one), so it is attempted for a
           few turns and then released instead of getting stuck forever.

        The last state never receives a fallback (nowhere to advance to) — it is the
        natural terminal state.
        """
        states = plan.states
        last_index = len(states) - 1

        for index, state in enumerate(states):
            is_last_state = index == last_index
            next_state_id = None if is_last_state else states[index + 1].id

            has_required_work = state.has_required_work()
            has_turn_fallback = any(
                t.condition_type == "turn_count_exceeded" for t in state.transitions
            )
            needs_turn_fallback = (
                not is_last_state
                and not has_required_work
                and not has_turn_fallback
            )

            if state.transitions:
                # Keep authored transitions; only add the fallback for all-optional
                # states so they can't persist indefinitely.
                if needs_turn_fallback and next_state_id:
                    print(
                        f"[StateMachine] Adding turn-based fallback for all-optional "
                        f"state '{state.id}' -> '{next_state_id}'"
                    )
                    state.transitions.append(
                        self._build_turn_fallback_transition(next_state_id)
                    )
                continue

            if is_last_state:
                # Terminal state: nothing to advance to.
                continue

            # No authored transitions: generate a sensible default.
            print(
                f"[StateMachine] Auto-generating transition for state "
                f"'{state.id}' -> '{next_state_id}'"
            )
            if needs_turn_fallback:
                state.transitions.append(
                    self._build_turn_fallback_transition(next_state_id)
                )
            else:
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
    ) -> TaskProcessingResult:
        """Apply one conversation turn and evaluate transitions.

        This is the single per-turn entry point. It:
        1. marks any explicitly-completed tasks (tasks without deliverables),
        2. records collected deliverables,
        3. accounts exactly one turn (progress vs no-progress),
        4. evaluates transitions and advances the state machine.

        All transition logic — including the turn-based fallback that releases
        all-optional states (#291) — lives here, so the agent only has to call
        this once per turn and the state machine changes correctly on its own.

        Args:
            extracted: Dict of {key: {value: X, reasoning: Y}} or {key: value}.
            completed_task_ids: IDs of tasks the agent explicitly completed.
        """
        result = TaskProcessingResult()

        if not self.execution_state:
            return result

        es = self.execution_state
        extracted = extracted or {}
        completed_task_ids = completed_task_ids or []

        # Snapshot what was already done BEFORE this turn, so we only count work
        # done *this* turn as progress. Otherwise a task completed — or a
        # deliverable collected — on an earlier turn would keep resetting the
        # no-progress counter, and the turn-based fallback would never fire (the
        # all-optional state would get stuck) (#291).
        already_completed = (
            {t.id for t in es.current_state.tasks if t.status == TaskStatus.COMPLETED}
            if es.current_state
            else set()
        )
        previous_values = es.get_all_deliverable_values()

        # 1. Explicitly completed tasks (e.g. deliverable-less "tell a joke" tasks).
        for task_id in completed_task_ids:
            es.mark_task_completed(task_id)

        # 2. Collected deliverables (supports {key: value} and {key: {value, reasoning}}).
        #    Only a *changed* value counts as progress — re-submitting the same
        #    optional deliverable every turn must not keep the state alive forever.
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

        # 3. Report tasks that became complete THIS turn (explicit marks + side
        #    effects of setting deliverables).
        if es.current_state:
            for task in es.current_state.tasks:
                if task.status == TaskStatus.COMPLETED and task.id not in already_completed:
                    result.completed_tasks.append(task.id)
                    print(f"[StateMachine] Task completed: {task.id}")

        made_progress = bool(result.updated_deliverables or result.completed_tasks)

        # 4. Account exactly one turn BEFORE evaluating transitions, so a
        #    turn_count_exceeded fallback sees the up-to-date counter.
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
            if not transition:
                break

            old_state = es.current_state_id
            if not es.advance_to_state(transition.target_state_id):
                print(
                    f"[StateMachine] Transition target '{transition.target_state_id}' "
                    f"not found; skipping"
                )
                break

            result.transitioned = True
            result.should_advance = True
            result.next_state_id = transition.target_state_id
            result.transition_reason = self._transition_reason(transition)
            print(
                f"[StateMachine] State transition: {old_state} -> "
                f"{transition.target_state_id} ({result.transition_reason})"
            )
        else:
            print(
                f"[StateMachine] Max transitions per turn "
                f"({self.MAX_TRANSITIONS_PER_TURN}) reached; stopping to avoid a loop"
            )

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
