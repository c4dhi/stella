"""State Machine engine for Stella Agent.

Main orchestration engine that manages plan execution including:
- Plan loading and initialization
- State transitions
- Task/deliverable processing modes (STRICT/LOOSE)
- Timekeeper coordination
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
from stella_agent.models.todo_list import TodoListState
from stella_agent.state_machine.execution_state import ExecutionState


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
    - Timekeeper coordination
    """

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
            self.execution_state = ExecutionState(plan=self.plan)
            self._initialized = True
            return True
        except Exception as e:
            print(f"[StateMachine] Initialization failed: {e}")
            return False

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
                    "required": t.required
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

    def process_deliverables(
        self,
        extracted: Dict[str, Any]
    ) -> TaskProcessingResult:
        """
        Process extracted deliverables from LLM output.

        Args:
            extracted: Dict of {key: {value: X, reasoning: Y}} or {key: value}

        Returns:
            TaskProcessingResult with what was updated
        """
        result = TaskProcessingResult()

        if not self.execution_state:
            return result

        for key, data in extracted.items():
            # Handle both formats: {key: {value: X, reasoning: Y}} and {key: value}
            if isinstance(data, dict):
                value = data.get("value")
                reasoning = data.get("reasoning", "")
            else:
                value = data
                reasoning = ""

            if self.execution_state.set_deliverable_value(key, value, reasoning):
                result.updated_deliverables.append(key)
                print(f"[StateMachine] Set deliverable: {key} = {value}")

        # Check for completed tasks
        if self.execution_state.current_state:
            for task in self.execution_state.current_state.tasks:
                if task.status == TaskStatus.COMPLETED and task.id not in result.completed_tasks:
                    result.completed_tasks.append(task.id)
                    print(f"[StateMachine] Task completed: {task.id}")

        # Check if state is complete and should advance
        result.state_complete = self.execution_state.is_current_state_complete()

        if result.state_complete:
            result.next_state_id = self.execution_state.evaluate_transitions()
            result.should_advance = result.next_state_id is not None
            if result.should_advance:
                result.transition_reason = "all_required_tasks_complete"

        return result

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
        Force a state transition (used by timekeeper in STRICT mode).

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
        """Increment turn counter and return current count."""
        if not self.execution_state:
            return 0
        count = self.execution_state.increment_turn_counter()
        print(f"[StateMachine] Turns without deliverable: {count}")
        return count

    def get_todo_list(self) -> Optional[TodoListState]:
        """Get the current todo list state for debug output."""
        if not self.execution_state:
            return None
        return self.execution_state.build_todo_list()

    def should_invoke_timekeeper(self, threshold: int = 2) -> bool:
        """
        Check if timekeeper should be invoked based on turn count.

        Args:
            threshold: Number of turns without deliverable to trigger
        """
        if not self.execution_state:
            return False
        return self.execution_state.turns_without_deliverable >= threshold

    def clear_state_changed_flag(self):
        """Clear the state changed flag after it's been processed."""
        if self.execution_state:
            self.execution_state.clear_state_changed_flag()

    def get_status_summary(self) -> Dict[str, Any]:
        """Get a summary of state machine status for logging."""
        if not self.execution_state:
            return {"initialized": False}

        return {
            "initialized": True,
            "plan_id": self.plan.id if self.plan else None,
            **self.execution_state.get_context_summary()
        }

    def apply_timekeeper_deliverables(
        self,
        suggested: Dict[str, Any]
    ) -> List[str]:
        """
        Apply deliverables suggested by timekeeper.

        Args:
            suggested: Dict of {key: {value: X, reasoning: Y}}

        Returns:
            List of deliverable keys that were applied
        """
        if not self.execution_state or not suggested:
            return []

        applied = []
        for key, data in suggested.items():
            if isinstance(data, dict):
                value = data.get("value")
                reasoning = data.get("reasoning", "Suggested by timekeeper")
            else:
                value = data
                reasoning = "Suggested by timekeeper"

            if self.execution_state.set_deliverable_value(key, value, reasoning):
                applied.append(key)
                print(f"[StateMachine] Timekeeper applied deliverable: {key} = {value}")

        return applied
