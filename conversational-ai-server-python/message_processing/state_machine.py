"""
State Machine implementation for conversation flow management.
Handles both Strict and Loose state execution modes.
"""
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass

from .plan_models import (
    StateMachinePlan, StateMachineExecutionState, State, Task, StateType, TaskStatus,
    DeliverableState, DeliverableStatus, StateTransition
)
from .deliverable_detector import DeliverableDetector


@dataclass
class TaskProcessingResult:
    """Result of processing tasks within a state."""
    completed_tasks: List[str]
    updated_deliverables: List[str]
    state_complete: bool
    should_advance: bool
    next_available_tasks: List[Task]


class StateMachine:
    """State machine for managing conversation flow with Strict and Loose states."""

    def __init__(self, plan: StateMachinePlan):
        self.execution_state = StateMachineExecutionState(plan)
        self.deliverable_detector = DeliverableDetector()

    def start(self) -> bool:
        """Start the state machine execution."""
        if self.execution_state.is_started:
            return False

        self.execution_state.start_execution()
        print(f"[StateMachine] Started execution with initial state: {self.execution_state.current_state_id}")
        return True

    def set_stream_service(self, stream_service):
        """Set stream service for real-time notifications."""
        self.execution_state.set_stream_service(stream_service)

    def get_current_context(self) -> Dict[str, Any]:
        """Get current context for input gate processing."""
        available_tasks = self.execution_state.get_available_tasks()
        current_state = self.execution_state.current_state

        context = {
            "available_tasks": available_tasks,
            "processing_mode": current_state.type.value if current_state else "unknown",
            "state": {
                "id": current_state.id if current_state else None,
                "type": current_state.type.value if current_state else None,
                "title": current_state.title if current_state else None,
                "description": current_state.description if current_state else None
            },
            "current_task": self.execution_state.current_task,
            "next_task": None,
            "next_state": None,
            "conditional_paths": None,
            "progress_summary": self.execution_state.get_progress_summary()
        }

        # Add next task for strict mode (for transition preparation)
        if current_state and current_state.type == StateType.STRICT:
            next_task = current_state.get_next_task()
            if next_task:
                context["next_task"] = next_task

        # Check for conditional task (decision point)
        current_task = self.execution_state.current_task
        if current_task:
            conditional_info = self.execution_state.get_conditional_task_info(current_task)
            if conditional_info:
                context["conditional_paths"] = conditional_info
                print(f"[StateMachine] Detected conditional task: {current_task.id}")
                print(f"[StateMachine] Conditional paths: {conditional_info}")

        # Add next state for transition awareness (both loose and strict)
        next_state = self.execution_state.get_next_state()
        if next_state:
            context["next_state"] = {
                "id": next_state.id,
                "title": next_state.title,
                "type": next_state.type.value,
                "description": next_state.description,
                "preview_tasks": [
                    {
                        "description": task.description,
                        "instruction": task.instruction
                    }
                    for task in next_state.tasks[:3]  # Show first 3 tasks as preview
                ]
            }

        return context

    async def process_user_message(self, user_message: str) -> TaskProcessingResult:
        """
        Process user message and update task/deliverable states.
        Handles both Strict and Loose state processing.
        """
        current_state = self.execution_state.current_state
        if not current_state:
            return TaskProcessingResult([], [], False, False, [])

        result = TaskProcessingResult([], [], False, False, [])

        # Get available tasks based on state type
        available_tasks = self.execution_state.get_available_tasks()

        if current_state.type == StateType.STRICT:
            # Process only the current task
            result = await self._process_strict_tasks(user_message, available_tasks)
        else:
            # Process all available tasks
            result = await self._process_loose_tasks(user_message, available_tasks)

        # Check if state is complete and should advance
        if self.execution_state.is_current_state_complete():
            result.state_complete = True

            # Check if we can advance to next state
            next_state_id = self.execution_state.evaluate_state_transitions()
            if next_state_id:
                result.should_advance = True

        # Update next available tasks
        result.next_available_tasks = self.execution_state.get_available_tasks()

        return result

    async def _process_strict_tasks(self, user_message: str, available_tasks: List[Task]) -> TaskProcessingResult:
        """Process tasks in STRICT mode (sequential)."""
        result = TaskProcessingResult([], [], False, False, [])

        if not available_tasks:
            return result

        # In STRICT mode, only process the current task
        current_task = available_tasks[0]

        # Check if any deliverables are completed for this task
        completed_deliverables = await self._detect_task_deliverables(user_message, current_task)
        result.updated_deliverables.extend(completed_deliverables)

        # Check if task is now complete (all required deliverables)
        if self._is_task_complete(current_task):
            success = self.execution_state.complete_task(current_task.id)
            if success:
                result.completed_tasks.append(current_task.id)
                print(f"[StateMachine] Completed STRICT task: {current_task.id}")

        return result

    async def _process_loose_tasks(self, user_message: str, available_tasks: List[Task]) -> TaskProcessingResult:
        """
        Process tasks in LOOSE mode (parallel/flexible).
        Allows re-evaluation of completed tasks - deliverables can be updated with new evidence.
        """
        result = TaskProcessingResult([], [], False, False, [])

        # Try to detect deliverables for all available tasks (including completed ones for updates)
        for task in available_tasks:
            completed_deliverables = await self._detect_task_deliverables(user_message, task)
            result.updated_deliverables.extend(completed_deliverables)

            # Check if task is now complete
            if self._is_task_complete(task):
                success = self.execution_state.complete_task(task.id)
                if success:
                    result.completed_tasks.append(task.id)
                    print(f"[StateMachine] Completed LOOSE task: {task.id}")

        return result

    async def _detect_task_deliverables(self, user_message: str, task: Task) -> List[str]:
        """Detect and update deliverables for a specific task."""
        completed_deliverables = []

        if not task.deliverables:
            return completed_deliverables

        # Detect deliverables in user message
        detected = self.deliverable_detector.detect_deliverables(
            user_message, task.deliverables
        )

        # Process detected deliverables
        for deliverable_key, value, confidence in detected:
            deliverable = next((d for d in task.deliverables if d.key == deliverable_key), None)
            if deliverable and self.deliverable_detector.should_accept_deliverable(deliverable, value, confidence):
                # Check if this is an update or new collection
                deliverable_state = self.execution_state.get_deliverable_state(deliverable_key)
                is_update = deliverable_state and deliverable_state.status == DeliverableStatus.COMPLETED
                previous_value = deliverable_state.value if is_update else None

                # Set deliverable value with real-time notification
                await self.execution_state.set_deliverable_value(
                    deliverable_key, value, user_message, confidence
                )
                completed_deliverables.append(deliverable_key)

                # Log with different message for updates vs new collections
                if is_update:
                    print(f"[StateMachine] 🔄 UPDATED deliverable {deliverable_key}: '{previous_value}' → '{value}' (confidence: {confidence:.2f}) for task {task.id}")
                else:
                    print(f"[StateMachine] Detected deliverable {deliverable_key}: {value} (confidence: {confidence:.2f}) for task {task.id}")

                # Check for continuation deliverable and handle skipping
                if deliverable_key == "wants_to_continue" and isinstance(value, bool):
                    # Determine path chosen
                    path_chosen = "continue" if value else "skip"

                    # Get conditional info for this task
                    conditional_info = self.execution_state.get_conditional_task_info(task)

                    if not value:
                        # User declined continuation
                        print(f"[StateMachine] User declined continuation, skipping remaining tasks")
                        skipped_tasks = self.execution_state.skip_remaining_tasks()
                        if skipped_tasks:
                            print(f"[StateMachine] Skipped {len(skipped_tasks)} tasks: {skipped_tasks}")

                        # Prepare next action info
                        next_state = self.execution_state.get_next_state()
                        next_action = {
                            "type": "skip_to_next_state",
                            "skipped_tasks": skipped_tasks,
                            "next_state_id": next_state.id if next_state else None,
                            "next_state_title": next_state.title if next_state else None
                        }
                    else:
                        # User wants to continue
                        print(f"[StateMachine] User chose to continue with optional tasks")

                        # Prepare next action info
                        remaining_tasks = []
                        if conditional_info:
                            remaining_tasks = conditional_info["paths"]["continue"]["tasks"]

                        next_action = {
                            "type": "continue_with_tasks",
                            "remaining_tasks": [t["id"] for t in remaining_tasks]
                        }

                    # Send decision message to frontend
                    if self.execution_state._stream_service:
                        try:
                            session_id = f"session_{int(datetime.now(timezone.utc).timestamp())}"
                            await self.execution_state._stream_service.send_decision_message(
                                session_id=session_id,
                                deliverable_key=deliverable_key,
                                deliverable_value=value,
                                path_chosen=path_chosen,
                                next_action=next_action,
                                task_id=task.id,
                                state_id=self.execution_state.current_state_id
                            )
                            print(f"[StateMachine] Sent decision message: {path_chosen} path chosen")
                        except Exception as e:
                            print(f"[StateMachine] Failed to send decision message: {e}")

        return completed_deliverables

    def _is_task_complete(self, task: Task) -> bool:
        """Check if a task is complete based on its deliverables."""
        if not task.deliverables:
            # Tasks without deliverables are completed manually or through other means
            return False

        # Check if all required deliverables are completed
        for deliverable in task.deliverables:
            if deliverable.required:
                deliverable_state = self.execution_state.get_deliverable_state(deliverable.key)
                if not deliverable_state or deliverable_state.status != DeliverableStatus.COMPLETED:
                    return False

        return True

    def advance_state(self) -> bool:
        """Manually advance to the next state."""
        return self.execution_state.advance_to_next_state()

    def get_current_context(self) -> Dict[str, Any]:
        """Get current context for prompt building."""
        current_state = self.execution_state.current_state
        current_task = self.execution_state.current_task
        available_tasks = self.execution_state.get_available_tasks()

        # Separate current task from next task in strict mode
        tasks_to_show = available_tasks
        next_task_obj = None

        if current_state and current_state.type == StateType.STRICT and len(available_tasks) > 1:
            # First task is current, second is next (for transition prep)
            tasks_to_show = [available_tasks[0]]
            next_task_obj = available_tasks[1]

        context = {
            "state": {
                "id": current_state.id if current_state else None,
                "title": current_state.title if current_state else None,
                "type": current_state.type.value if current_state else None,
                "description": current_state.description if current_state else None
            },
            "current_task": {
                "id": current_task.id if current_task else None,
                "description": current_task.description if current_task else None,
                "instruction": current_task.instruction if current_task else None,
                "deliverables": [
                    {
                        "key": d.key,
                        "description": d.description,
                        "type": d.type.value,
                        "required": d.required,
                        "status": self.execution_state.get_deliverable_state(d.key).status.value
                        if self.execution_state.get_deliverable_state(d.key) else "pending"
                    }
                    for d in current_task.deliverables
                ] if current_task else []
            } if current_task else None,
            "next_task": {
                "id": next_task_obj.id,
                "description": next_task_obj.description,
                "instruction": next_task_obj.instruction,
                "required": next_task_obj.required,
                "deliverables": [
                    {
                        "key": d.key,
                        "description": d.description,
                        "type": d.type.value,
                        "required": d.required,
                        "status": self.execution_state.get_deliverable_state(d.key).status.value
                        if self.execution_state.get_deliverable_state(d.key) else "pending"
                    }
                    for d in next_task_obj.deliverables
                ]
            } if next_task_obj else None,
            "available_tasks": [
                {
                    "id": task.id,
                    "description": task.description,
                    "instruction": task.instruction,
                    "required": task.required,
                    "deliverables": [
                        {
                            "key": d.key,
                            "description": d.description,
                            "type": d.type.value,
                            "required": d.required,
                            "status": self.execution_state.get_deliverable_state(d.key).status.value
                            if self.execution_state.get_deliverable_state(d.key) else "pending"
                        }
                        for d in task.deliverables
                    ]
                }
                for task in tasks_to_show
            ],
            "processing_mode": current_state.type.value if current_state else "unknown",
            "conditional_paths": None
        }

        # Check for conditional task (decision point)
        if current_task:
            conditional_info = self.execution_state.get_conditional_task_info(current_task)
            if conditional_info:
                context["conditional_paths"] = conditional_info
                print(f"[StateMachine] Detected conditional task in context: {current_task.id}")

        return context

    def get_execution_state(self) -> StateMachineExecutionState:
        """Get the current execution state."""
        return self.execution_state

    def get_progress_summary(self) -> Dict[str, Any]:
        """Get comprehensive progress summary."""
        return self.execution_state.get_progress_summary()

    def complete_task_manually(self, task_id: str) -> bool:
        """Manually mark a task as completed."""
        return self.execution_state.complete_task(task_id)

    def skip_task(self, task_id: str) -> bool:
        """Mark a task as skipped."""
        task = self.execution_state.plan.get_task(task_id)
        if not task:
            return False

        task.status = TaskStatus.SKIPPED
        print(f"[StateMachine] Skipped task: {task_id}")
        return True

    def skip_tasks(self, task_ids: List[str]) -> List[str]:
        """Mark multiple tasks as skipped. Returns list of successfully skipped task IDs."""
        skipped = []
        for task_id in task_ids:
            if self.skip_task(task_id):
                skipped.append(task_id)

        if skipped:
            print(f"[StateMachine] Skipped {len(skipped)} tasks: {skipped}")

        return skipped

    def update_task_evidence(self, task_id: str, user_message: str) -> bool:
        """
        Update evidence for a completed task (for LOOSE states).
        This allows re-evaluation of deliverables based on new information.
        """
        task = self.execution_state.plan.get_task(task_id)
        current_state = self.execution_state.current_state

        if not task or not current_state or current_state.type != StateType.LOOSE:
            return False

        if task.status != TaskStatus.COMPLETED:
            return False

        # Re-detect deliverables with new evidence
        # This could potentially update existing deliverable values
        print(f"[StateMachine] Updating evidence for completed task: {task_id}")

        # Note: Implementation would call _detect_task_deliverables again
        # For now, just log the attempt
        return True

    def is_execution_complete(self) -> bool:
        """Check if the entire state machine execution is complete."""
        return self.execution_state.is_completed

    def get_remaining_states(self) -> List[State]:
        """Get list of remaining (uncompleted) states."""
        remaining = []
        for state in self.execution_state.plan.states:
            if state.id not in self.execution_state.state_completion_times:
                remaining.append(state)
        return remaining