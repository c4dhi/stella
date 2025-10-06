"""
Task Management System for tracking conversation steps and tasks.
Now supports plan-based execution with structured deliverables and step progression.
"""
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, field
from enum import Enum
import json
import os

from .plan_models import DeliverableStatus, StateMachinePlan, StateMachineExecutionState
from .plan_loader import load_plan_auto
from .deliverable_detector import DeliverableDetector
from .state_machine import StateMachine


# Legacy classes removed - using state machine architecture only


class TaskManager:
    """Manages plan-based conversation execution with structured deliverables."""

    def __init__(self, plan_name: str = None):
        self.state_machine: StateMachine = None
        self.deliverable_detector = DeliverableDetector()
        self.created_at = datetime.now()
        self.plan_config = self._load_plan_config()
        self.conversation_context: Dict[str, Any] = {}

        # Load default plan or specified plan
        default_plan_name = plan_name or self.plan_config.get('default_plan', 'cognitive_stimulation_demo_sm')
        self._initialize_from_plan(default_plan_name)

    def _load_plan_config(self) -> Dict[str, Any]:
        """Load plan configuration from config file."""
        # Use absolute path based on this file's location instead of working directory
        current_file_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_file_dir)  # Go up one level from message_processing/
        config_path = os.path.join(project_root, 'config', 'plan_config.json')

        try:
            if os.path.exists(config_path):
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    print(f"[TaskManager] Loaded plan config - default plan: {config.get('default_plan')}")
                    return config
            else:
                print(f"[TaskManager] Config file not found at {config_path}")
        except Exception as e:
            print(f"[TaskManager] Error loading plan config: {e}")

        # Return default config
        print(f"[TaskManager] Using default config fallback")
        return {
            'default_plan': 'cognitive_stimulation_demo_sm',
            'plan_settings': {
                'auto_advance_statements': True,
                'confidence_threshold': {
                    'required_deliverables': 0.7,
                    'optional_deliverables': 0.5
                }
            }
        }

    def set_stream_service(self, stream_service):
        """Set stream service for real-time deliverable notifications."""
        if self.state_machine:
            self.state_machine.set_stream_service(stream_service)
            print(f"[TaskManager] Stream service set for state machine notifications")

    def _initialize_from_plan(self, plan_name: str):
        """Initialize TaskManager with a state machine plan."""
        try:
            # Load state machine plan
            state_machine_plan = load_plan_auto(plan_name)
            self.state_machine = StateMachine(state_machine_plan)

            print(f"[TaskManager] Initialized with state machine plan '{plan_name}': {state_machine_plan.title}")
            print(f"[TaskManager] State machine has {len(state_machine_plan.states)} states")

            # Set up conversation context
            self.conversation_context['plan_id'] = state_machine_plan.id
            self.conversation_context['plan_title'] = state_machine_plan.title
            self.conversation_context['plan_type'] = 'state_machine'

        except Exception as e:
            print(f"[TaskManager] Error loading plan '{plan_name}': {e}")
            print(f"[TaskManager] Falling back to minimal plan")
            self._initialize_fallback_plan()

    def _initialize_fallback_plan(self):
        """Initialize a minimal fallback plan when main plan loading fails."""
        from .plan_models import StateMachinePlan, State, Task, StateType, Deliverable, DeliverableType

        # Create a simple fallback state machine plan
        greeting_task = Task(
            id="greeting_task",
            description="Greet the user",
            instruction="Greet the user warmly and ask how you can help them today.",
            required=True,
            deliverables=[]
        )

        greeting_state = State(
            id="greeting",
            title="Initial Greeting",
            type=StateType.LOOSE,
            description="Greet the user and establish communication",
            tasks=[greeting_task],
            transitions=[]
        )

        fallback_plan = StateMachinePlan(
            id="fallback",
            title="Fallback Plan",
            description="Minimal fallback conversation plan",
            states=[greeting_state],
            initial_state_id="greeting"
        )

        self.state_machine = StateMachine(fallback_plan)

    def is_state_machine_mode(self) -> bool:
        """Check if running in state machine mode."""
        return self.state_machine is not None

    # Legacy compatibility methods that now work with plan execution
    @property
    def current_step_id(self) -> Optional[str]:
        """Get current step ID for legacy compatibility."""
        if self.plan_execution:
            return self.plan_execution.current_step_id
        return None

    @property
    def steps(self) -> Dict[str, Any]:
        """Get steps dict for legacy compatibility."""
        if self.plan_execution:
            # Convert plan steps to legacy format for compatibility
            steps_dict = {}
            for step in self.plan_execution.plan.steps:
                # Create a ConversationStep-like object
                legacy_step = ConversationStep(
                    id=step.id,
                    title=step.title,
                    description=step.instruction,
                    status=StepStatus.COMPLETED if step.id in self.plan_execution.step_completion_times
                           else (StepStatus.IN_PROGRESS if step.id == self.plan_execution.current_step_id
                           else StepStatus.NOT_STARTED),
                    tasks=[],  # Plan-based system doesn't use legacy tasks
                )
                steps_dict[step.id] = legacy_step
            return steps_dict
        return {}

    @property
    def step_order(self) -> List[str]:
        """Get step order for legacy compatibility."""
        if self.plan_execution:
            return self.plan_execution.plan.step_ids
        return []

    def get_current_step(self) -> Optional[ConversationStep]:
        """Get the current active step."""
        if self.current_step_id:
            return self.steps.get(self.current_step_id)
        return None

    # Plan-aware methods
    def get_current_plan_step(self) -> Optional[PlanStep]:
        """Get the current plan step (not legacy ConversationStep)."""
        if self.plan_execution:
            return self.plan_execution.current_step
        return None

    def get_plan_execution_state(self) -> Optional[PlanExecutionState]:
        """Get the full plan execution state."""
        return self.plan_execution

    def update_current_step(self, status: StepStatus, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Update the status of the current step."""
        if not self.plan_execution or not self.plan_execution.current_step_id:
            return False

        # Update the legacy step for compatibility
        current_step = self.get_current_step()
        if current_step:
            current_step.status = status
            current_step.updated_at = datetime.now()

            if status == StepStatus.COMPLETED:
                current_step.completed_at = datetime.now()
                # Mark plan step as completed
                self.plan_execution.complete_step(self.plan_execution.current_step_id)

            if metadata:
                current_step.metadata.update(metadata)

        return True

    def advance_to_next_step(self, force: bool = False) -> bool:
        """Advance to the next step in the conversation flow."""
        if not self.plan_execution:
            return False

        # Check if current step should be completed
        if not force and not self.plan_execution.is_current_step_completed():
            return False

        # Use plan execution to advance
        success = self.plan_execution.advance_to_next_step()

        if success:
            # Update legacy step statuses for compatibility
            current_step = self.get_current_step()
            if current_step:
                current_step.status = StepStatus.IN_PROGRESS
                current_step.updated_at = datetime.now()

            print(f"[TaskManager] Advanced to step: {self.plan_execution.current_step_id}")
        else:
            print(f"[TaskManager] Plan completed or cannot advance")

        return success

    def set_step_status(self, step_id: str, status: StepStatus, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Set the status of a specific step."""
        if step_id not in self.steps:
            return False

        step = self.steps[step_id]
        step.status = status
        step.updated_at = datetime.now()

        if status == StepStatus.COMPLETED:
            step.completed_at = datetime.now()

        if metadata:
            step.metadata.update(metadata)

        return True

    def add_task_to_current_step(self, task_id: str, description: str, details: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """Add a task to the current step."""
        current_step = self.get_current_step()
        if not current_step:
            return False

        task = Task(
            id=task_id,
            description=description,
            details=details,
            metadata=metadata or {}
        )

        current_step.tasks.append(task)
        current_step.updated_at = datetime.now()
        return True

    def update_task_status(self, task_id: str, status: TaskStatus, step_id: Optional[str] = None) -> bool:
        """Update the status of a task."""
        target_step = None

        if step_id:
            target_step = self.steps.get(step_id)
        else:
            target_step = self.get_current_step()

        if not target_step:
            return False

        for task in target_step.tasks:
            if task.id == task_id:
                task.status = status
                task.updated_at = datetime.now()

                if status == TaskStatus.COMPLETED:
                    task.completed_at = datetime.now()

                target_step.updated_at = datetime.now()
                return True

        return False

    def add_expert_findings_to_current_step(self, findings: List[Dict[str, Any]]) -> bool:
        """Add expert findings to the current step."""
        current_step = self.get_current_step()
        if not current_step:
            return False

        current_step.expert_findings.extend(findings)
        current_step.expert_analysis_needed = True
        current_step.updated_at = datetime.now()
        return True

    def determine_next_step_based_on_analysis(self, user_input: str, expert_findings: List[Dict[str, Any]], context: str = "") -> Dict[str, Any]:
        """Determine what the next step should be based on expert analysis."""
        current_step = self.get_current_step()
        if not current_step:
            return {"action": "error", "reason": "No current step"}

        # Analyze the conversation stage and expert findings
        analysis = {
            "current_step_id": self.current_step_id,
            "current_step_title": current_step.title,
            "action": "continue",  # continue, advance, complete, create_task
            "suggested_response_focus": "",
            "tasks_to_create": [],
            "step_status_update": None,
            "metadata": {}
        }

        # Analyze based on current step
        if current_step.id == "greeting":
            # In greeting phase - determine if we got enough info to proceed
            if any(keyword in user_input.lower() for keyword in ["help", "need", "problem", "question", "issue"]):
                analysis.update({
                    "action": "advance",
                    "suggested_response_focus": "acknowledge_need_and_gather_info",
                    "step_status_update": StepStatus.COMPLETED
                })
            else:
                analysis["suggested_response_focus"] = "continue_greeting_understand_needs"

        elif current_step.id == "information_gathering":
            # Check if we have enough information from expert analysis
            expert_recommendations = []
            info_gaps = []

            for finding in expert_findings:
                if finding.get("success"):
                    recommendation = finding.get("recommendation", "").lower()
                    if "more information" in recommendation or "clarify" in recommendation:
                        info_gaps.append(finding.get("agent_name", "expert"))
                    elif "proceed" in recommendation or "recommend" in recommendation:
                        expert_recommendations.append(finding.get("agent_name", "expert"))

            if info_gaps:
                analysis.update({
                    "action": "continue",
                    "suggested_response_focus": "ask_for_more_info",
                    "tasks_to_create": [f"Gather additional info requested by {expert}" for expert in info_gaps[:2]]
                })
            elif expert_recommendations:
                analysis.update({
                    "action": "advance",
                    "suggested_response_focus": "provide_guidance_from_experts",
                    "step_status_update": StepStatus.COMPLETED
                })
            else:
                analysis["suggested_response_focus"] = "continue_information_gathering"

        elif current_step.id == "analysis":
            # Providing guidance - check if we can wrap up or need follow-up
            if any(phrase in user_input.lower() for phrase in ["thank", "thanks", "that helps", "got it", "understand"]):
                analysis.update({
                    "action": "advance",
                    "suggested_response_focus": "offer_followup_and_wrap",
                    "step_status_update": StepStatus.COMPLETED
                })
            else:
                analysis["suggested_response_focus"] = "continue_providing_guidance"

        elif current_step.id == "follow_up":
            # Follow-up phase - usually wrapping up
            analysis.update({
                "action": "complete",
                "suggested_response_focus": "conclude_conversation",
                "step_status_update": StepStatus.COMPLETED
            })

        # Add expert analysis metadata
        analysis["metadata"] = {
            "expert_count": len(expert_findings),
            "successful_experts": len([f for f in expert_findings if f.get("success")]),
            "user_input_length": len(user_input),
            "context_available": bool(context)
        }

        return analysis

    def get_progress_summary(self) -> Dict[str, Any]:
        """Get a summary of conversation progress."""
        total_steps = len(self.step_order)
        completed_steps = sum(1 for step_id in self.step_order
                             if self.steps[step_id].status == StepStatus.COMPLETED)

        current_step = self.get_current_step()

        # Count tasks
        total_tasks = sum(len(step.tasks) for step in self.steps.values())
        completed_tasks = sum(
            len([task for task in step.tasks if task.status == TaskStatus.COMPLETED])
            for step in self.steps.values()
        )

        return {
            "current_step": {
                "id": current_step.id if current_step else None,
                "title": current_step.title if current_step else None,
                "status": current_step.status.value if current_step else None
            },
            "progress": {
                "total_steps": total_steps,
                "completed_steps": completed_steps,
                "current_step_index": self.step_order.index(self.current_step_id) + 1 if self.current_step_id else 0,
                "percentage": (completed_steps / total_steps * 100) if total_steps > 0 else 0
            },
            "tasks": {
                "total_tasks": total_tasks,
                "completed_tasks": completed_tasks,
                "pending_tasks": total_tasks - completed_tasks
            },
            "conversation_age_minutes": (datetime.now() - self.created_at).total_seconds() / 60,
            "steps": [
                {
                    "id": step_id,
                    "title": self.steps[step_id].title,
                    "status": self.steps[step_id].status.value,
                    "tasks": [
                        {
                            "id": task.id,
                            "description": task.description,
                            "status": task.status.value
                        } for task in self.steps[step_id].tasks
                    ]
                } for step_id in self.step_order
            ]
        }

    def update_conversation_context(self, key: str, value: Any) -> None:
        """Update conversation context information."""
        self.conversation_context[key] = value

    def get_conversation_context(self) -> Dict[str, Any]:
        """Get conversation context information."""
        return self.conversation_context.copy()

    def is_first_interaction(self) -> bool:
        """Check if this is the first user interaction."""
        if self.is_state_machine_mode():
            return not self.state_machine.execution_state.is_started
        elif self.is_legacy_mode():
            return not self.plan_execution.is_started
        else:
            return True

    def initialize_first_step(self) -> bool:
        """Initialize the first step/state of the execution."""
        if self.is_state_machine_mode():
            # Start state machine execution
            success = self.state_machine.start()

            # Update conversation context to mark initialization
            self.update_conversation_context("todo_list_initialized", True)
            self.update_conversation_context("first_step_activated_at", datetime.now().isoformat())
            self.update_conversation_context("state_machine_started_at", self.state_machine.execution_state.started_at.isoformat())

            current_state = self.state_machine.execution_state.current_state
            if current_state:
                print(f"[TaskManager] Initialized first state: {current_state.title}")
                return True

            return False

        elif self.is_legacy_mode():
            # Start plan execution
            self.plan_execution.start_execution()

            # Update legacy step status for compatibility
            if self.plan_execution.current_step_id:
                self.set_step_status(self.plan_execution.current_step_id, StepStatus.IN_PROGRESS)

            # Update conversation context to mark initialization
            self.update_conversation_context("todo_list_initialized", True)
            self.update_conversation_context("first_step_activated_at", datetime.now().isoformat())
            self.update_conversation_context("plan_started_at", self.plan_execution.started_at.isoformat())

            current_plan_step = self.plan_execution.current_step
            if current_plan_step:
                print(f"[TaskManager] Initialized first step: {current_plan_step.title}")
                return True

            return False

        else:
            return False

    # Plan-aware message processing methods
    async def process_user_message(self, user_message: str) -> Dict[str, Any]:
        """Process user message for deliverable detection and plan progression."""
        if self.is_state_machine_mode():
            return await self._process_user_message_state_machine(user_message)
        elif self.is_legacy_mode():
            return await self._process_user_message_legacy(user_message)
        else:
            return {"success": False, "error": "No plan loaded"}

    async def _process_user_message_state_machine(self, user_message: str) -> Dict[str, Any]:
        """Process user message in state machine mode."""
        if not self.state_machine:
            return {"success": False, "error": "No state machine loaded"}

        # Process message through state machine
        processing_result = await self.state_machine.process_user_message(user_message)

        result = {
            "success": True,
            "deliverables_detected": processing_result.updated_deliverables,
            "tasks_completed": processing_result.completed_tasks,
            "state_completed": processing_result.state_complete,
            "should_advance": processing_result.should_advance,
            "plan_completed": False,
            "available_tasks": [
                {
                    "id": task.id,
                    "description": task.description,
                    "instruction": task.instruction,
                    "required": task.required
                }
                for task in processing_result.next_available_tasks
            ]
        }

        # Handle state advancement
        if processing_result.should_advance:
            success = self.state_machine.advance_state()
            if not success:
                result["plan_completed"] = True
                print(f"[TaskManager] State machine execution completed")
            else:
                print(f"[TaskManager] Advanced to next state")

        return result

    async def _process_user_message_legacy(self, user_message: str) -> Dict[str, Any]:
        """Process user message in legacy plan mode."""
        if not self.plan_execution:
            return {"success": False, "error": "No plan loaded"}

        result = {
            "success": True,
            "deliverables_detected": [],
            "step_completed": False,
            "should_advance": False,
            "plan_completed": False
        }

        # Get current step deliverables
        current_step = self.plan_execution.current_step
        if not current_step:
            return {"success": False, "error": "No current step"}

        # Detect deliverables in user message
        if current_step.deliverables:
            detected = self.deliverable_detector.detect_deliverables(
                user_message, current_step.deliverables
            )

            # Process detected deliverables
            for deliverable_key, value, confidence in detected:
                deliverable = next((d for d in current_step.deliverables if d.key == deliverable_key), None)
                if deliverable and self.deliverable_detector.should_accept_deliverable(deliverable, value, confidence):
                    # Set deliverable value with real-time notification
                    await self.plan_execution.set_deliverable_value(
                        deliverable_key, value, user_message, confidence
                    )
                    result["deliverables_detected"].append({
                        "key": deliverable_key,
                        "value": value,
                        "confidence": confidence,
                        "description": deliverable.description
                    })
                    print(f"[TaskManager] Detected deliverable {deliverable_key}: {value} (confidence: {confidence:.2f})")

        # Check if current step is now completed
        if self.plan_execution.is_current_step_completed():
            result["step_completed"] = True

            # Check if we should auto-advance
            auto_advance_config = self.plan_config.get("plan_settings", {}).get("auto_advance_statements", True)
            should_advance = False

            if auto_advance_config:
                # Auto-advance Statement steps or steps with auto_advance=True
                if current_step.auto_advance or current_step.type.value == "Statement":
                    should_advance = True
                # Also auto-advance Question steps when all required deliverables are completed
                elif current_step.type.value == "Question" and current_step.deliverables:
                    # Check if all required deliverables are completed
                    required_completed = all(
                        self.plan_execution.get_deliverable_state(d.key).status.value == "completed"
                        for d in current_step.deliverables if d.required
                    )
                    if required_completed:
                        should_advance = True
                        print(f"[TaskManager] Question step completed - all required deliverables satisfied")

            if should_advance:
                result["should_advance"] = True

                # Advance to next step
                if self.advance_to_next_step():
                    print(f"[TaskManager] Auto-advanced to next step")
                else:
                    result["plan_completed"] = True
                    print(f"[TaskManager] Plan completed")

        return result

    def get_current_instruction(self) -> str:
        """Get the current step/task instruction for response generation."""
        if self.is_state_machine_mode():
            current_task = self.state_machine.execution_state.current_task
            if current_task:
                return current_task.instruction
            else:
                current_state = self.state_machine.execution_state.current_state
                if current_state:
                    return current_state.description
        elif self.is_legacy_mode():
            current_step = self.plan_execution.current_step
            if current_step:
                return current_step.instruction

        return "Continue the conversation naturally."

    def get_state_machine_context(self) -> Optional[Dict[str, Any]]:
        """Get state machine context for input gate processing."""
        if not self.is_state_machine_mode():
            return None

        return self.state_machine.get_current_context()

    def get_current_deliverables_status(self) -> Dict[str, Any]:
        """Get status of current step deliverables."""
        if not self.plan_execution:
            return {}

        current_step = self.plan_execution.current_step
        if not current_step or not current_step.deliverables:
            return {}

        status = {}
        for deliverable in current_step.deliverables:
            state = self.plan_execution.get_deliverable_state(deliverable.key)
            status[deliverable.key] = {
                "description": deliverable.description,
                "type": deliverable.type.value,
                "required": deliverable.required,
                "status": state.status.value if state else "pending",
                "value": state.value if state else None,
                "collected_at": state.collected_at.isoformat() if state and state.collected_at else None
            }

        return status

    def get_remaining_steps(self) -> List[PlanStep]:
        """Get list of remaining (uncompleted) steps in the plan."""
        if not self.plan_execution:
            return []

        remaining = []
        for step in self.plan_execution.plan.steps:
            # Include steps that are not yet completed
            if step.id not in self.plan_execution.step_completion_times:
                remaining.append(step)
        return remaining

    def get_all_deliverable_states(self) -> Dict[str, Any]:
        """Get the state of all deliverables across all steps."""
        if not self.plan_execution:
            return {}

        all_states = {}
        for step in self.plan_execution.plan.steps:
            step_deliverables = {}
            for deliverable in step.deliverables:
                state = self.plan_execution.get_deliverable_state(deliverable.key)
                step_deliverables[deliverable.key] = {
                    "description": deliverable.description,
                    "type": deliverable.type.value,
                    "required": deliverable.required,
                    "status": state.status.value if state else "pending",
                    "value": state.value if state else None,
                    "collected_at": state.collected_at.isoformat() if state and state.collected_at else None,
                    "confidence": state.confidence if state else 0.0,
                    "reasoning": state.reasoning if state else None,
                    "acceptance_criteria": getattr(deliverable, 'acceptance_criteria', None)
                }
            if step_deliverables:
                all_states[step.id] = {
                    "step_title": step.title,
                    "deliverables": step_deliverables
                }
        return all_states

    def get_step_progression_context(self) -> str:
        """Get formatted context about step progression for LLM."""
        if not self.plan_execution:
            return "No plan loaded"

        # Get current step index using the plan's method
        current_index = -1
        if self.plan_execution.current_step_id:
            current_index = self.plan_execution.plan.get_step_index(self.plan_execution.current_step_id)

        total_steps = len(self.plan_execution.plan.steps)
        completed_count = len(self.plan_execution.step_completion_times)

        context = f"Progress: Step {current_index + 1} of {total_steps} ({completed_count} completed)\n"

        # Add info about next few steps
        remaining = self.get_remaining_steps()
        if remaining:
            context += "\nNext steps:\n"
            for i, step in enumerate(remaining[:3], 1):
                context += f"  {i}. {step.title}\n"

        return context

    def get_complete_todo_list(self) -> Dict[str, Any]:
        """Get complete todo list with all fields for frontend state management."""
        if self.is_state_machine_mode():
            return self._get_state_machine_todo_list()
        elif self.is_legacy_mode():
            return self._get_legacy_todo_list()
        else:
            # Fallback for no plan loaded
            return {
                "conversation_id": f"conv_{int(self.created_at.timestamp())}",
                "todo_list": {
                    "initialized": False,
                    "total_states": 0,
                    "current_state_index": 0,
                    "completed_states": 0,
                    "remaining_states": 0,
                    "progress_percentage": 0,
                    "current_state": None,
                    "current_task": None,
                    "states": [],
                    "tasks_summary": {"total": 0, "completed": 0, "pending": 0},
                    "conversation_age_minutes": 0,
                    "last_updated": datetime.now().isoformat()
                },
                "context": self.conversation_context.copy(),
                "metadata": {
                    "created_at": self.created_at.isoformat(),
                    "architecture": "none",
                    "states_count": 0,
                    "tasks_count": 0,
                    "deliverables_count": 0
                }
            }

    def _get_state_machine_todo_list(self) -> Dict[str, Any]:
        """Get todo list data for state machine mode."""
        progress_summary = self.state_machine.execution_state.get_progress_summary()

        # Build states array with detailed information
        detailed_states = []
        all_deliverable_states = {}

        for state in self.state_machine.execution_state.plan.states:
            # Get state completion status
            is_completed = state.id in self.state_machine.execution_state.state_completion_times
            is_current = state.id == self.state_machine.execution_state.current_state_id

            # Build tasks array for this state
            tasks_array = []
            for task in state.tasks:
                # Get task completion status
                task_is_completed = task.id in self.state_machine.execution_state.task_completion_times
                task_is_current = task.id == self.state_machine.execution_state.current_task_id

                # Build deliverables array for this task
                deliverables_array = []
                for deliverable in task.deliverables:
                    deliverable_state = self.state_machine.execution_state.deliverable_states.get(deliverable.key)

                    deliverable_data = {
                        "key": deliverable.key,
                        "description": deliverable.description,
                        "type": deliverable.type.value,
                        "required": deliverable.required,
                        "status": deliverable_state.status.value if deliverable_state else "pending",
                        "value": deliverable_state.value if deliverable_state else None,
                        "collected_at": deliverable_state.collected_at.isoformat() if deliverable_state and deliverable_state.collected_at else None,
                        "confidence": deliverable_state.confidence if deliverable_state else 0.0,
                        "reasoning": deliverable_state.reasoning if deliverable_state else None,
                        "acceptance_criteria": deliverable.acceptance_criteria
                    }
                    deliverables_array.append(deliverable_data)

                task_data = {
                    "id": task.id,
                    "description": task.description,
                    "instruction": task.instruction,
                    "required": task.required,
                    "status": "completed" if task_is_completed else ("in_progress" if task_is_current else "pending"),
                    "deliverables": deliverables_array
                }
                tasks_array.append(task_data)

            # Add state to detailed states array
            state_data = {
                "id": state.id,
                "title": state.title,
                "type": state.type.value,
                "description": state.description,
                "status": "completed" if is_completed else ("in_progress" if is_current else "pending"),
                "is_current": is_current,
                "completed_at": self.state_machine.execution_state.state_completion_times.get(state.id).isoformat() if is_completed else None,
                "tasks": tasks_array
            }
            detailed_states.append(state_data)

            # Add to all_deliverable_states for compatibility
            if tasks_array:  # Only add if state has tasks with deliverables
                state_deliverables = {}
                for task in tasks_array:
                    for deliverable in task["deliverables"]:
                        state_deliverables[deliverable["key"]] = deliverable

                if state_deliverables:  # Only add if state has deliverables
                    all_deliverable_states[state.id] = {
                        "state_title": state.title,
                        "deliverables": state_deliverables
                    }

        # Calculate conversation age
        conversation_age_minutes = 0
        if self.state_machine.execution_state.started_at:
            age_delta = datetime.now() - self.state_machine.execution_state.started_at
            conversation_age_minutes = age_delta.total_seconds() / 60

        return {
            "conversation_id": f"conv_{int(self.created_at.timestamp())}",
            "todo_list": {
                "initialized": self.conversation_context.get("todo_list_initialized", False),
                "first_state_activated_at": self.conversation_context.get("first_state_activated_at"),
                "total_states": progress_summary["progress"]["total_states"],
                "current_state_index": progress_summary["progress"]["current_state_index"],
                "completed_states": progress_summary["progress"]["completed_states"],
                "remaining_states": progress_summary["progress"]["total_states"] - progress_summary["progress"]["completed_states"],
                "progress_percentage": progress_summary["progress"]["percentage"],
                "current_state": {
                    "id": progress_summary["current_state"]["id"],
                    "title": progress_summary["current_state"]["title"],
                    "type": progress_summary["current_state"]["type"],
                    "description": progress_summary["current_state"]["description"],
                    "status": "in_progress" if progress_summary["current_state"]["id"] else None,
                    "state_number": progress_summary["progress"]["current_state_index"],
                    "is_complete": progress_summary["current_state"]["is_complete"]
                },
                "current_task": {
                    "id": progress_summary["current_task"]["id"],
                    "description": progress_summary["current_task"]["description"],
                    "instruction": progress_summary["current_task"]["instruction"],
                    "required": progress_summary["current_task"]["required"],
                    "status": "in_progress" if progress_summary["current_task"]["id"] else None
                },
                "states": detailed_states,
                "tasks_summary": progress_summary["tasks"],
                "conversation_age_minutes": conversation_age_minutes,
                "last_updated": datetime.now().isoformat()
            },
            "all_deliverable_states": all_deliverable_states,
            "remaining_states_count": progress_summary["progress"]["total_states"] - progress_summary["progress"]["completed_states"],
            "context": {
                **self.conversation_context.copy(),
                "plan_id": progress_summary["plan_id"],
                "plan_title": progress_summary["plan_title"],
                "todo_list_initialized": self.conversation_context.get("todo_list_initialized", False),
                "first_state_activated_at": self.conversation_context.get("first_state_activated_at"),
                "current_processing_mode": progress_summary["current_state"]["type"]
            },
            "metadata": {
                "created_at": self.created_at.isoformat(),
                "state_order": [state.id for state in self.state_machine.execution_state.plan.states],
                "architecture": "state_machine",
                "states_count": len(self.state_machine.execution_state.plan.states),
                "tasks_count": progress_summary["tasks"]["total"],
                "deliverables_count": progress_summary["deliverables"]["total"]
            }
        }

    def _get_legacy_todo_list(self) -> Dict[str, Any]:
        """Get todo list data for legacy plan mode."""
        current_step = self.get_current_step()
        progress_summary = self.get_progress_summary()

        # Enhanced step details with full information including deliverables
        detailed_steps = []
        for step_id in self.step_order:
            step = self.steps[step_id]

            # Get deliverables for this step from plan execution if available
            step_deliverables = []
            if self.plan_execution:
                plan_step = self.plan_execution.plan.get_step(step_id)
                if plan_step and plan_step.deliverables:
                    for deliverable in plan_step.deliverables:
                        deliverable_state = self.plan_execution.get_deliverable_state(deliverable.key)
                        step_deliverables.append({
                            "key": deliverable.key,
                            "description": deliverable.description,
                            "type": deliverable.type.value,
                            "required": deliverable.required,
                            "status": deliverable_state.status.value if deliverable_state else "pending",
                            "value": deliverable_state.value if deliverable_state else None,
                            "collected_at": deliverable_state.collected_at.isoformat() if deliverable_state and deliverable_state.collected_at else None,
                            "confidence": deliverable_state.confidence if deliverable_state else 0.0
                        })

            step_detail = {
                "id": step.id,
                "title": step.title,
                "description": step.description,
                "status": step.status.value,
                "is_current": step.id == self.current_step_id,
                "created_at": step.created_at.isoformat(),
                "updated_at": step.updated_at.isoformat(),
                "completed_at": step.completed_at.isoformat() if step.completed_at else None,
                "expert_analysis_needed": step.expert_analysis_needed,
                "expert_findings_count": len(step.expert_findings),
                "deliverables": step_deliverables,  # Add deliverables to each step
                "tasks": [
                    {
                        "id": task.id,
                        "description": task.description,
                        "status": task.status.value,
                        "details": task.details,
                        "created_at": task.created_at.isoformat(),
                        "updated_at": task.updated_at.isoformat(),
                        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                        "metadata": task.metadata
                    } for task in step.tasks
                ],
                "metadata": step.metadata
            }
            detailed_steps.append(step_detail)

        # Calculate detailed progress information
        total_steps = len(self.step_order)
        current_step_index = self.step_order.index(self.current_step_id) if self.current_step_id else -1
        completed_steps = progress_summary["progress"]["completed_steps"]

        return {
            "conversation_id": f"conv_{int(self.created_at.timestamp())}",
            "todo_list": {
                "initialized": self.conversation_context.get("todo_list_initialized", False),
                "first_step_activated_at": self.conversation_context.get("first_step_activated_at"),
                "total_steps": total_steps,
                "current_step_index": current_step_index + 1 if current_step_index >= 0 else 0,
                "completed_steps": completed_steps,
                "remaining_steps": total_steps - completed_steps,
                "progress_percentage": progress_summary["progress"]["percentage"],
                "current_step": {
                    "id": current_step.id if current_step else None,
                    "title": current_step.title if current_step else None,
                    "description": current_step.description if current_step else None,
                    "status": current_step.status.value if current_step else None,
                    "step_number": current_step_index + 1 if current_step_index >= 0 else 0
                },
                "steps": detailed_steps,
                "tasks_summary": progress_summary["tasks"],
                "conversation_age_minutes": progress_summary["conversation_age_minutes"],
                "last_updated": datetime.now().isoformat()
            },
            "context": self.conversation_context.copy(),
            "metadata": {
                "created_at": self.created_at.isoformat(),
                "step_order": self.step_order,
                "architecture": "legacy",
                "has_expert_findings": any(len(step.expert_findings) > 0 for step in self.steps.values()),
                "total_tasks_created": sum(len(step.tasks) for step in self.steps.values())
            }
        }