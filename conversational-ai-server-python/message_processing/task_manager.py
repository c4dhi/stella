"""
Task Management System for tracking conversation states and tasks.
State machine architecture only - all legacy code removed.
"""
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
import json
import os

from .plan_models import DeliverableStatus, StateMachinePlan, StateMachineExecutionState
from .plan_loader import load_plan_auto
from .deliverable_detector import DeliverableDetector
from .state_machine import StateMachine


class TaskManager:
    """Manages state machine-based conversation execution with structured deliverables."""

    def __init__(self, plan_name: str = None):
        self.state_machine: StateMachine = None
        self.deliverable_detector = DeliverableDetector()
        self.created_at = datetime.now(timezone.utc)
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
        from .plan_models import StateMachinePlan, State, Task, StateType

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

    def is_legacy_mode(self) -> bool:
        """Check if running in legacy plan mode (always False in this version)."""
        return False

    def get_conversation_context(self) -> Dict[str, Any]:
        """Get conversation context."""
        return self.conversation_context.copy()

    @property
    def plan_execution(self):
        """Legacy compatibility - always None in state machine version."""
        return None

    # State machine methods
    def get_current_state_id(self) -> Optional[str]:
        """Get current state ID."""
        if self.state_machine:
            return self.state_machine.execution_state.current_state_id
        return None

    def get_current_task_id(self) -> Optional[str]:
        """Get current task ID."""
        if self.state_machine:
            return self.state_machine.execution_state.current_task_id
        return None

    def update_conversation_context(self, key: str, value: Any):
        """Update conversation context."""
        self.conversation_context[key] = value

    # NEW: Turn counter methods for timekeeper trigger
    def increment_turn_counter(self) -> int:
        """Increment turn counter for consecutive turns without deliverable progress.

        Returns the new counter value.
        """
        if self.is_state_machine_mode():
            return self.state_machine.execution_state.increment_turn_counter()
        return 0

    def reset_turn_counter(self) -> None:
        """Reset turn counter when deliverable progress made."""
        if self.is_state_machine_mode():
            self.state_machine.execution_state.reset_turn_counter()

    def get_turn_counter(self) -> int:
        """Get current turn counter value."""
        if self.is_state_machine_mode():
            return self.state_machine.execution_state.get_turn_counter()
        return 0

    def get_progress_summary(self) -> Dict[str, Any]:
        """Get overall progress summary."""
        if self.state_machine:
            return self.state_machine.execution_state.get_progress_summary()
        return {
            "plan_id": "none",
            "plan_title": "No Plan",
            "is_started": False,
            "is_completed": False,
            "current_state": {"id": None, "title": None},
            "current_task": {"id": None, "description": None},
            "progress": {"total_states": 0, "completed_states": 0, "percentage": 0},
            "tasks": {"total": 0, "completed": 0, "pending": 0},
            "deliverables": {"total": 0, "completed": 0, "pending": 0}
        }

    def is_first_interaction(self) -> bool:
        """Check if this is the first user interaction."""
        if self.is_state_machine_mode():
            return not self.state_machine.execution_state.is_started
        return True

    def initialize_first_step(self) -> bool:
        """Initialize the first step/state of the execution."""
        if not self.is_state_machine_mode():
            print(f"[TaskManager] No state machine loaded for initialization")
            return False

        if self.state_machine.execution_state.is_started:
            print(f"[TaskManager] State machine already started")
            return False

        print(f"[TaskManager] Starting state machine execution...")

        # Start state machine execution
        success = self.state_machine.start()
        if not success:
            print(f"[TaskManager] Failed to start state machine")
            return False

        # Verify state machine started properly
        current_state = self.state_machine.execution_state.current_state
        current_state_id = self.state_machine.execution_state.current_state_id

        print(f"[TaskManager] State machine startup verification:")
        print(f"  - Is started: {self.state_machine.execution_state.is_started}")
        print(f"  - Current state ID: {current_state_id}")
        print(f"  - Current state object: {current_state.title if current_state else 'None'}")

        if not current_state:
            print(f"[TaskManager] ERROR: State machine started but no current state set")
            return False

        # Update conversation context to mark initialization
        self.update_conversation_context("todo_list_initialized", True)
        self.update_conversation_context("first_state_activated_at", datetime.now(timezone.utc).isoformat())
        self.update_conversation_context("plan_started_at", self.state_machine.execution_state.started_at.isoformat())

        print(f"[TaskManager] ✅ Successfully initialized first state: '{current_state.title}' (type: {current_state.type.value})")
        return True

    async def process_user_message(self, user_message: str) -> Dict[str, Any]:
        """Process user message for deliverable detection and plan progression."""
        if self.is_state_machine_mode():
            return await self._process_user_message_state_machine(user_message)
        else:
            return {"success": False, "error": "No state machine loaded"}

    async def _process_user_message_state_machine(self, user_message: str) -> Dict[str, Any]:
        """Process user message in state machine mode."""
        if not self.state_machine:
            return {"success": False, "error": "No state machine loaded"}

        result = {
            "success": True,
            "deliverables_detected": [],
            "tasks_completed": [],
            "state_completed": False,
            "state_advanced": False,
            "next_state": None
        }

        # Process message through state machine
        processing_result = await self.state_machine.process_user_message(user_message)

        # Update result with state machine processing results
        result["deliverables_detected"] = processing_result.updated_deliverables
        result["tasks_completed"] = processing_result.completed_tasks
        result["state_completed"] = processing_result.state_complete
        result["state_advanced"] = processing_result.should_advance

        if processing_result.should_advance:
            # Advance to next state
            success = self.state_machine.execution_state.advance_to_next_state()
            if success:
                result["next_state"] = self.state_machine.execution_state.current_state_id
                print(f"[TaskManager] Advanced to next state: {result['next_state']}")

        return result

    def get_current_instruction(self) -> str:
        """Get instruction for current state/task."""
        if self.is_state_machine_mode():
            current_task = self.state_machine.execution_state.current_task
            if current_task:
                return current_task.instruction

            current_state = self.state_machine.execution_state.current_state
            if current_state:
                return current_state.description

        return "Continue the conversation naturally."

    def get_state_machine_context(self) -> Optional[Dict[str, Any]]:
        """Get state machine context for input gate processing."""
        if not self.is_state_machine_mode():
            return None

        return self.state_machine.get_current_context()

    def get_current_plan_step(self):
        """Get current state as a legacy-compatible step object."""
        if not self.is_state_machine_mode():
            return None

        current_state = self.state_machine.execution_state.current_state
        if not current_state:
            return None

        # Create a legacy-compatible step object
        class CompatibleStep:
            def __init__(self, state):
                self.id = state.id
                self.title = state.title
                self.instruction = state.description
                self.description = state.description
                self.type = state.type
                self.deliverables = state.tasks[0].deliverables if state.tasks else []

        return CompatibleStep(current_state)

    def get_current_step(self):
        """Alias for get_current_plan_step() for compatibility."""
        return self.get_current_plan_step()

    def get_remaining_steps(self):
        """Get remaining states as legacy-compatible step objects."""
        if not self.is_state_machine_mode():
            return []

        remaining = []
        for state in self.state_machine.execution_state.plan.states:
            # Include states that are not completed
            if state.id not in self.state_machine.execution_state.state_completion_times:
                if state.id != self.state_machine.execution_state.current_state_id:
                    # Create legacy-compatible step object
                    class CompatibleStep:
                        def __init__(self, state):
                            self.id = state.id
                            self.title = state.title
                            self.instruction = state.description
                            self.description = state.description
                            self.type = state.type
                            self.deliverables = []
                            # Aggregate deliverables from all tasks in this state
                            for task in state.tasks:
                                self.deliverables.extend(task.deliverables)

                    remaining.append(CompatibleStep(state))

        return remaining

    def get_all_deliverable_states(self) -> Dict[str, Any]:
        """Get the state of all deliverables across all states."""
        if not self.is_state_machine_mode():
            return {}

        all_states = {}

        for state in self.state_machine.execution_state.plan.states:
            state_deliverables = {}

            for task in state.tasks:
                for deliverable in task.deliverables:
                    deliverable_state = self.state_machine.execution_state.deliverable_states.get(deliverable.key)

                    state_deliverables[deliverable.key] = {
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

            if state_deliverables:  # Only add states that have deliverables
                all_states[state.id] = {
                    "state_title": state.title,
                    "deliverables": state_deliverables
                }

        return all_states

    def get_step_progression_context(self) -> str:
        """Get formatted context about progression for LLM."""
        if not self.is_state_machine_mode():
            return "No state machine loaded"

        progress = self.state_machine.execution_state.get_progress_summary()
        current_index = progress["progress"]["current_state_index"]
        total_states = progress["progress"]["total_states"]
        completed_count = progress["progress"]["completed_states"]

        context = f"Progress: State {current_index} of {total_states} ({completed_count} completed)\\n"

        # Add current state info
        if progress["current_state"]["id"]:
            context += f"Current: {progress['current_state']['title']}\\n"

        # Add remaining states
        remaining_states = [
            state for state in self.state_machine.execution_state.plan.states
            if state.id not in self.state_machine.execution_state.state_completion_times
            and state.id != self.state_machine.execution_state.current_state_id
        ]

        if remaining_states:
            context += "Next states:\\n"
            for i, state in enumerate(remaining_states[:3], 1):
                context += f"  {i}. {state.title}\\n"

        return context

    def get_complete_todo_list(self) -> Dict[str, Any]:
        """Get complete todo list with all fields for frontend state management."""
        if self.is_state_machine_mode():
            return self._get_state_machine_todo_list()
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
                    "last_updated": datetime.now(timezone.utc).isoformat()
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

                # Determine task status
                if task.status.value == "skipped":
                    task_status = "skipped"
                elif task_is_completed:
                    task_status = "completed"
                elif task_is_current:
                    task_status = "in_progress"
                else:
                    task_status = "pending"

                task_data = {
                    "id": task.id,
                    "description": task.description,
                    "instruction": task.instruction,
                    "required": task.required,
                    "status": task_status,
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
            age_delta = datetime.now(timezone.utc) - self.state_machine.execution_state.started_at
            conversation_age_minutes = age_delta.total_seconds() / 60

        todo_list_data = {
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
                    "id": progress_summary["current_state"].get("id"),
                    "title": progress_summary["current_state"].get("title", "Unknown State"),
                    "type": progress_summary["current_state"].get("type", "unknown"),
                    "description": progress_summary["current_state"].get("description", ""),
                    "status": "in_progress" if progress_summary["current_state"].get("id") else None,
                    "state_number": progress_summary["progress"].get("current_state_index", 0),
                    "is_complete": progress_summary["current_state"].get("is_complete", False),
                    "processing_mode": progress_summary["current_state"].get("type", "unknown")  # Add processing mode for frontend
                },
                "current_task": {
                    "id": progress_summary["current_task"].get("id"),
                    "description": progress_summary["current_task"].get("description", "No current task"),
                    "instruction": progress_summary["current_task"].get("instruction", ""),
                    "required": progress_summary["current_task"].get("required", False),
                    "status": "in_progress" if progress_summary["current_task"].get("id") else None
                },
                "states": detailed_states,
                "tasks_summary": progress_summary["tasks"],
                "conversation_age_minutes": conversation_age_minutes,
                "last_updated": datetime.now(timezone.utc).isoformat()
            },
            "all_deliverable_states": all_deliverable_states,
            "remaining_states_count": progress_summary["progress"]["total_states"] - progress_summary["progress"]["completed_states"],
            "context": {
                **self.conversation_context.copy(),
                "plan_id": progress_summary["plan_id"],
                "plan_title": progress_summary["plan_title"],
                "todo_list_initialized": self.conversation_context.get("todo_list_initialized", False),
                "first_state_activated_at": self.conversation_context.get("first_state_activated_at"),
                "current_processing_mode": progress_summary["current_state"].get("type", "unknown")
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

        print(f"[TaskManager] Complete todo list generated:")
        print(f"  - States count: {len(detailed_states)}")
        print(f"  - Current state: {todo_list_data['todo_list']['current_state']['title']} ({todo_list_data['todo_list']['current_state']['type']})")
        print(f"  - Processing mode: {todo_list_data['todo_list']['current_state']['processing_mode']}")
        print(f"  - Progress: {todo_list_data['todo_list']['progress_percentage']:.1f}%")

        return todo_list_data

    def advance_to_next_state(self, force: bool = False) -> bool:
        """Advance to the next state in the conversation flow."""
        if not self.is_state_machine_mode():
            return False

        success = self.state_machine.execution_state.advance_to_next_state()

        if success:
            current_state_id = self.state_machine.execution_state.current_state_id
            print(f"[TaskManager] Advanced to state: {current_state_id}")
        else:
            print(f"[TaskManager] Plan completed or cannot advance")

        return success