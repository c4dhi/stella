"""State Machine engine.

Main orchestration engine that manages plan execution including:
- Plan loading and initialization
- State transitions
- Task/deliverable processing modes (STRICT/LOOSE)
- Timekeeper coordination
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional

from stella_v2_agent.models.state_machine import (
    Plan, State, Task, Deliverable,
    DeliverableStatus, TaskStatus, StateType,
)
from stella_v2_agent.models.todo_list import TodoListState
from stella_v2_agent.state_machine.execution_state import ExecutionState


@dataclass
class TaskProcessingResult:
    """Result from processing tasks against user input."""
    completed_tasks: List[str] = field(default_factory=list)
    updated_deliverables: List[str] = field(default_factory=list)
    state_complete: bool = False
    should_advance: bool = False
    next_state_id: Optional[str] = None
    transition_reason: Optional[str] = None
    transitioned: bool = False


class StateMachine:
    """Main state machine engine that orchestrates plan execution.

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
        """Initialize the state machine with a plan configuration.

        Args:
            plan_config: Plan dictionary from session config (canonical format).

        Returns:
            True if initialization successful.
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
        return self._initialized and self.execution_state is not None

    @property
    def current_mode(self) -> Optional[StateType]:
        if not self.execution_state:
            return None
        return self.execution_state.processing_mode

    @property
    def current_state(self) -> Optional[State]:
        if not self.execution_state:
            return None
        return self.execution_state.current_state

    def get_context_for_prompt(self) -> Dict[str, Any]:
        """Get current state machine context for prompt building.

        Returns context including current state, available tasks,
        pending deliverables, processing mode, and progress info.
        """
        if not self.execution_state:
            return {}

        state = self.execution_state.current_state
        if not state:
            return {}

        available_tasks = self.execution_state.get_available_tasks()

        deliverables_info = []
        for task in available_tasks:
            for d in task.deliverables:
                deliverables_info.append({
                    "key": d.key,
                    "description": d.description,
                    "type": d.type,
                    "required": d.required,
                    "acceptance_criteria": d.acceptance_criteria,
                    "examples": d.examples if d.status == DeliverableStatus.PENDING else [],
                    "status": d.status.value,
                    "value": d.value if d.status == DeliverableStatus.COMPLETED else None,
                })

        return {
            "state": {
                "id": state.id,
                "title": state.title,
                "type": state.type.value,
                "description": state.description,
            },
            "processing_mode": self.execution_state.processing_mode.value,
            "available_tasks": [
                {
                    "id": t.id,
                    "description": t.description,
                    "instruction": t.instruction,
                    "required": t.required,
                    "has_deliverables": len(t.deliverables) > 0,
                }
                for t in available_tasks
            ],
            "current_task": {
                "id": available_tasks[0].id,
                "description": available_tasks[0].description,
                "instruction": available_tasks[0].instruction,
            } if available_tasks else None,
            "deliverables": deliverables_info,
            "progress": {
                "percentage": self.execution_state.calculate_progress(),
                "turns_without_deliverable": self.execution_state.turns_without_deliverable,
            },
            "state_just_changed": self.execution_state.state_just_changed,
        }

    def get_full_plan_context(self) -> List[Dict[str, Any]]:
        """Get the full plan with all states, tasks, and deliverables.

        Used by task_extraction to see the entire todo list, not just the current state.
        """
        if not self.plan:
            return []

        states_info = []
        for state in self.plan.states:
            is_current = state.id == self.execution_state.current_state_id if self.execution_state else False
            state_info: Dict[str, Any] = {
                "id": state.id,
                "title": state.title,
                "is_current": is_current,
                "tasks": [],
            }
            for task in state.tasks:
                task_info: Dict[str, Any] = {
                    "id": task.id,
                    "description": task.description,
                    "status": task.status.value,
                    "has_deliverables": len(task.deliverables) > 0,
                    "deliverables": [],
                }
                for d in task.deliverables:
                    task_info["deliverables"].append({
                        "key": d.key,
                        "type": d.type,
                        "description": d.description,
                        "required": d.required,
                        "acceptance_criteria": d.acceptance_criteria,
                        "examples": d.examples,
                        "status": d.status.value,
                        "value": d.value,
                    })
                state_info["tasks"].append(task_info)
            states_info.append(state_info)
        return states_info

    def process_deliverables(self, extracted: Dict[str, Any]) -> TaskProcessingResult:
        """Process extracted deliverables from LLM output.

        Args:
            extracted: Dict of {key: {value: X, reasoning: Y}} or {key: value}.

        Returns:
            TaskProcessingResult with what was updated.
        """
        result = TaskProcessingResult()

        if not self.execution_state:
            return result

        for key, data in extracted.items():
            if isinstance(data, dict):
                value = data.get("value")
                reasoning = data.get("reasoning", "")
            else:
                value = data
                reasoning = ""

            if self.execution_state.set_deliverable_value(key, value, reasoning):
                result.updated_deliverables.append(key)
                print(f"[StateMachine] Set deliverable: {key} = {value}")

        if self.execution_state.current_state:
            for task in self.execution_state.current_state.tasks:
                if task.status == TaskStatus.COMPLETED and task.id not in result.completed_tasks:
                    result.completed_tasks.append(task.id)

        result.state_complete = self.execution_state.is_current_state_complete()
        state = self.execution_state.current_state
        if result.state_complete:
            if state:
                print(f"[StateMachine] State '{state.title}' is complete. Tasks: "
                      + ", ".join(f"{t.description}(req={t.required},status={t.status.value},"
                                  f"deliverables=[{','.join(f'{d.key}(req={d.required})={d.status.value}' for d in t.deliverables)}])"
                                  for t in state.tasks))
        else:
            if state:
                pending = [(t.description, [d.key for d in t.deliverables if d.status == DeliverableStatus.PENDING])
                           for t in state.tasks if t.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)]
                if pending:
                    print(f"[StateMachine] State '{state.title}' NOT complete. Pending: "
                          + ", ".join(f"{desc}[{','.join(keys)}]" for desc, keys in pending if keys))

        # Always evaluate transitions — especially needed when state is complete
        result.next_state_id = self.execution_state.evaluate_transitions()
        result.should_advance = result.next_state_id is not None
        if result.should_advance:
            result.transition_reason = "all_tasks_complete" if result.state_complete else "transition_condition_met"

        return result

    def advance_state(self) -> bool:
        """Advance to the next state based on transitions."""
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
        """Force a state transition (used by timekeeper in STRICT mode)."""
        if not self.execution_state:
            return False

        if target_state_id:
            old_state = self.execution_state.current_state_id
            success = self.execution_state.advance_to_state(target_state_id)
            if success:
                print(f"[StateMachine] Forced transition: {old_state} -> {target_state_id}")
            return success

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
        if not self.execution_state:
            return 0
        return self.execution_state.increment_turn_counter()

    def get_todo_list(self) -> Optional[TodoListState]:
        if not self.execution_state:
            return None
        return self.execution_state.build_todo_list()

    def should_invoke_timekeeper(self, threshold: int = 2) -> bool:
        if not self.execution_state:
            return False
        return self.execution_state.turns_without_deliverable >= threshold

    def clear_state_changed_flag(self):
        if self.execution_state:
            self.execution_state.clear_state_changed_flag()

    def mark_tasks_completed(self, task_ids: List[str]) -> List[str]:
        """Mark multiple tasks as completed by their IDs."""
        if not self.execution_state:
            return []
        completed = []
        for task_id in task_ids:
            if self.execution_state.mark_task_completed(task_id):
                completed.append(task_id)
                print(f"[StateMachine] Task explicitly completed: {task_id}")
        return completed

    def handle_stagnation(self, threshold: int = 3) -> Optional[List[str]]:
        """Auto-skip optional items if stagnation threshold exceeded and no required items pending."""
        if not self.execution_state:
            return None
        if self.execution_state.turns_without_deliverable < threshold:
            return None

        state = self.execution_state.current_state
        if not state:
            return None

        # Don't auto-skip if required items are still pending
        for task in state.tasks:
            if task.status in (TaskStatus.COMPLETED, TaskStatus.SKIPPED):
                continue
            for d in task.deliverables:
                if d.required and d.status == DeliverableStatus.PENDING:
                    return None
            if task.required and not task.deliverables and task.status == TaskStatus.PENDING:
                return None

        skipped = self.execution_state.skip_optional_pending()
        if skipped:
            print(f"[StateMachine] Stagnation: auto-skipped optional: {skipped}")
        return skipped if skipped else None

    def get_status_summary(self) -> Dict[str, Any]:
        if not self.execution_state:
            return {"initialized": False}
        return {
            "initialized": True,
            "plan_id": self.plan.id if self.plan else None,
            **self.execution_state.get_context_summary(),
        }

    def apply_timekeeper_deliverables(self, suggested: Dict[str, Any]) -> List[str]:
        """Apply deliverables suggested by timekeeper."""
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
