"""
Plan-aware data models for structured conversation plans.
Supports JSON plan format with steps, deliverables, and execution state tracking.
"""
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, field
from enum import Enum


class DeliverableType(Enum):
    """Types of deliverables that can be collected."""
    STRING = "string"
    ENUM = "enum"
    BOOLEAN = "boolean"
    NUMBER = "number"


class StepType(Enum):
    """Types of plan steps."""
    QUESTION = "Question"
    STATEMENT = "Statement"


class StateType(Enum):
    """Types of states in the state machine."""
    STRICT = "strict"  # Tasks must be completed in order
    LOOSE = "loose"    # Tasks can be completed in any order


class TaskStatus(Enum):
    """Status of individual tasks within a state."""
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class DeliverableStatus(Enum):
    """Status of deliverable completion."""
    PENDING = "pending"
    PARTIAL = "partial"
    COMPLETED = "completed"
    SKIPPED = "skipped"


@dataclass
class Deliverable:
    """A deliverable that needs to be collected during a plan step."""
    key: str
    type: DeliverableType
    description: str
    required: bool = True
    enum_values: Optional[List[str]] = None
    default_value: Optional[Any] = None
    validation_pattern: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    validation_rules: Optional[Dict[str, Any]] = None
    examples: Optional[List[str]] = None

    def __post_init__(self):
        """Convert string type to enum if needed."""
        if isinstance(self.type, str):
            self.type = DeliverableType(self.type)


@dataclass
class DeliverableState:
    """Current state of a deliverable."""
    deliverable: Deliverable
    status: DeliverableStatus = DeliverableStatus.PENDING
    value: Optional[Any] = None
    collected_at: Optional[datetime] = None
    source_message: Optional[str] = None
    confidence: float = 0.0
    reasoning: Optional[str] = None  # LLM reasoning for why acceptance criteria was met

    def mark_completed(self, value: Any, source_message: str = None, confidence: float = 1.0, reasoning: str = None):
        """Mark deliverable as completed with a value and optional reasoning."""
        self.value = value
        self.status = DeliverableStatus.COMPLETED
        self.collected_at = datetime.now(timezone.utc)
        self.source_message = source_message
        self.confidence = confidence
        self.reasoning = reasoning


@dataclass
class Task:
    """A task within a state that needs to be completed."""
    id: str
    description: str
    instruction: str  # Instruction for the AI on how to complete this task
    required: bool = True  # Whether this task must be completed for state progression
    deliverables: List[Deliverable] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)  # Task IDs this depends on (for Loose states)
    status: TaskStatus = TaskStatus.NOT_STARTED
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def is_complete(self) -> bool:
        """Check if task is complete."""
        return self.status == TaskStatus.COMPLETED

    def can_start(self, completed_task_ids: List[str]) -> bool:
        """Check if task can start based on dependencies."""
        return all(dep_id in completed_task_ids for dep_id in self.dependencies)


@dataclass
class StateTransition:
    """Defines a transition from one state to another."""
    target_state_id: str
    condition_type: Optional[str] = None  # 'all_tasks_complete', 'deliverable_check', 'custom'
    condition_data: Optional[Dict[str, Any]] = None  # Additional data for condition evaluation
    priority: int = 0  # Higher priority transitions are evaluated first


@dataclass
class State:
    """A state in the conversation state machine."""
    id: str
    title: str
    type: StateType
    description: str
    tasks: List[Task] = field(default_factory=list)
    transitions: List[StateTransition] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        """Convert string type to enum if needed."""
        if isinstance(self.type, str):
            self.type = StateType(self.type)

    def get_task(self, task_id: str) -> Optional[Task]:
        """Get a task by ID."""
        return next((t for t in self.tasks if t.id == task_id), None)

    def get_required_tasks(self) -> List[Task]:
        """Get all required tasks."""
        return [t for t in self.tasks if t.required]

    def get_optional_tasks(self) -> List[Task]:
        """Get all optional tasks."""
        return [t for t in self.tasks if not t.required]

    def is_complete(self) -> bool:
        """Check if state is complete (all required tasks done)."""
        return all(t.status == TaskStatus.COMPLETED for t in self.get_required_tasks())

    def get_next_task(self) -> Optional[Task]:
        """Get next task to process (for STRICT states)."""
        if self.type != StateType.STRICT:
            return None

        for task in self.tasks:
            if task.status == TaskStatus.NOT_STARTED:
                return task
        return None

    def get_available_tasks(self, completed_task_ids: List[str]) -> List[Task]:
        """Get all tasks that can be started or re-evaluated (for LOOSE states)."""
        if self.type != StateType.LOOSE:
            return []

        available = []
        for task in self.tasks:
            # Include NOT_STARTED tasks that meet dependencies
            if task.status == TaskStatus.NOT_STARTED and task.can_start(completed_task_ids):
                available.append(task)
            # Include COMPLETED tasks for potential re-evaluation with new evidence
            elif task.status == TaskStatus.COMPLETED:
                available.append(task)
            # Exclude SKIPPED and IN_PROGRESS tasks
        return available


@dataclass
class ConditionalJump:
    """Defines a conditional jump to another step based on deliverable values."""
    condition_type: str  # 'equals', 'contains', 'age_range', 'not_equals'
    condition_deliverable: str  # key of the deliverable to check
    condition_value: Union[str, int, List[Any]]  # value to compare against
    target_step_id: str  # step to jump to if condition is met
    skip_intermediate: bool = True  # whether to mark skipped steps as completed

@dataclass
class PlanStep:
    """A single step in a conversation plan."""
    id: str
    type: StepType
    title: str
    instruction: str
    deliverables: List[Deliverable] = field(default_factory=list)
    auto_advance: bool = False  # Whether to automatically advance after completing deliverables
    conditional_jumps: List[ConditionalJump] = field(default_factory=list)  # Conditional jump rules

    def __post_init__(self):
        """Convert string type to enum if needed."""
        if isinstance(self.type, str):
            self.type = StepType(self.type)

    @property
    def has_deliverables(self) -> bool:
        """Check if this step has deliverables to collect."""
        return len(self.deliverables) > 0

    @property
    def required_deliverables(self) -> List[Deliverable]:
        """Get list of required deliverables."""
        return [d for d in self.deliverables if d.required]


@dataclass
class Plan:
    """A complete conversation plan."""
    id: str
    title: str
    description: str
    steps: List[PlanStep]
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)

    @property
    def step_ids(self) -> List[str]:
        """Get ordered list of step IDs."""
        return [step.id for step in self.steps]

    def get_step(self, step_id: str) -> Optional[PlanStep]:
        """Get step by ID."""
        for step in self.steps:
            if step.id == step_id:
                return step
        return None

    def get_step_index(self, step_id: str) -> int:
        """Get index of step by ID."""
        for i, step in enumerate(self.steps):
            if step.id == step_id:
                return i
        return -1

    def get_next_step_id(self, current_step_id: str) -> Optional[str]:
        """Get the next step ID after the current one."""
        current_index = self.get_step_index(current_step_id)
        if current_index >= 0 and current_index + 1 < len(self.steps):
            return self.steps[current_index + 1].id
        return None


@dataclass
class StateMachinePlan:
    """A conversation plan using state machine architecture."""
    id: str
    title: str
    description: str
    states: List[State]
    initial_state_id: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)

    @property
    def state_ids(self) -> List[str]:
        """Get ordered list of state IDs."""
        return [state.id for state in self.states]

    def get_state(self, state_id: str) -> Optional[State]:
        """Get state by ID."""
        return next((state for state in self.states if state.id == state_id), None)

    def get_state_index(self, state_id: str) -> int:
        """Get index of state by ID."""
        for i, state in enumerate(self.states):
            if state.id == state_id:
                return i
        return -1

    def get_all_tasks(self) -> List[Task]:
        """Get all tasks across all states."""
        tasks = []
        for state in self.states:
            tasks.extend(state.tasks)
        return tasks

    def get_task(self, task_id: str) -> Optional[Task]:
        """Get a task by ID from any state."""
        for state in self.states:
            task = state.get_task(task_id)
            if task:
                return task
        return None

    def get_all_deliverables(self) -> List[Deliverable]:
        """Get all deliverables from all tasks."""
        deliverables = []
        for task in self.get_all_tasks():
            deliverables.extend(task.deliverables)
        return deliverables


@dataclass
class PlanExecutionState:
    """Current execution state of a plan."""
    plan: Plan
    current_step_id: Optional[str] = None
    deliverable_states: Dict[str, DeliverableState] = field(default_factory=dict)
    step_completion_times: Dict[str, datetime] = field(default_factory=dict)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    conversation_context: Dict[str, Any] = field(default_factory=dict)
    _stream_service: Optional[Any] = field(default=None, init=False, repr=False)

    def __post_init__(self):
        """Initialize deliverable states for all deliverables in the plan."""
        for step in self.plan.steps:
            for deliverable in step.deliverables:
                if deliverable.key not in self.deliverable_states:
                    self.deliverable_states[deliverable.key] = DeliverableState(deliverable)

    @property
    def current_step(self) -> Optional[PlanStep]:
        """Get the current active step."""
        if self.current_step_id:
            return self.plan.get_step(self.current_step_id)
        return None

    @property
    def is_started(self) -> bool:
        """Check if plan execution has started."""
        return self.started_at is not None

    @property
    def is_completed(self) -> bool:
        """Check if plan execution is completed."""
        return self.completed_at is not None

    @property
    def progress_percentage(self) -> float:
        """Calculate completion percentage based on completed steps."""
        total_steps = len(self.plan.steps)
        completed_steps = len(self.step_completion_times)
        return (completed_steps / total_steps * 100) if total_steps > 0 else 0.0

    def start_execution(self):
        """Start plan execution."""
        if not self.is_started:
            self.started_at = datetime.now(timezone.utc)
            if self.plan.steps:
                self.current_step_id = self.plan.steps[0].id

    def complete_step(self, step_id: str):
        """Mark a step as completed."""
        if step_id not in self.step_completion_times:
            self.step_completion_times[step_id] = datetime.now(timezone.utc)

    def advance_to_next_step(self) -> bool:
        """Advance to the next step in the plan, checking for conditional jumps."""
        if not self.current_step_id:
            return False

        current_step = self.plan.get_step(self.current_step_id)
        if not current_step:
            return False

        # Mark current step as completed
        self.complete_step(self.current_step_id)

        # Check for conditional jumps first
        jump_target = self.evaluate_conditional_jumps(current_step)
        if jump_target:
            # Skip intermediate steps if requested
            self.skip_steps_to_target(self.current_step_id, jump_target)
            self.current_step_id = jump_target
            return True

        # Get next step normally
        next_step_id = self.plan.get_next_step_id(self.current_step_id)
        if next_step_id:
            self.current_step_id = next_step_id
            return True
        else:
            # Plan completed
            self.completed_at = datetime.now(timezone.utc)
            return False

    def get_deliverable_state(self, key: str) -> Optional[DeliverableState]:
        """Get state of a specific deliverable."""
        return self.deliverable_states.get(key)

    def evaluate_conditional_jumps(self, current_step: PlanStep) -> Optional[str]:
        """Evaluate conditional jumps for the current step."""
        if not current_step.conditional_jumps:
            return None

        for jump in current_step.conditional_jumps:
            deliverable_state = self.get_deliverable_state(jump.condition_deliverable)
            if not deliverable_state or not deliverable_state.value:
                continue

            if self._evaluate_condition(deliverable_state.value, jump):
                print(f"[PlanExecution] Conditional jump triggered: {current_step.id} -> {jump.target_step_id}")
                return jump.target_step_id

        return None

    def _evaluate_condition(self, value: Any, jump: ConditionalJump) -> bool:
        """Evaluate a specific condition."""
        if jump.condition_type == "equals":
            return str(value).lower() == str(jump.condition_value).lower()
        elif jump.condition_type == "not_equals":
            return str(value).lower() != str(jump.condition_value).lower()
        elif jump.condition_type == "contains":
            return str(jump.condition_value).lower() in str(value).lower()
        elif jump.condition_type == "not_contains":
            return str(jump.condition_value).lower() not in str(value).lower()
        elif jump.condition_type == "contains_all":
            # Check if all items in condition_value list are present in the value
            value_lower = str(value).lower()
            return all(str(item).lower() in value_lower for item in jump.condition_value)
        elif jump.condition_type == "not_contains_all":
            # Check if any item in condition_value list is missing from the value
            value_lower = str(value).lower()
            return not all(str(item).lower() in value_lower for item in jump.condition_value)
        elif jump.condition_type == "age_range":
            try:
                age = int(value)
                min_age, max_age = jump.condition_value
                return min_age <= age <= max_age
            except (ValueError, TypeError):
                return False
        return False

    def skip_steps_to_target(self, current_step_id: str, target_step_id: str):
        """Skip intermediate steps between current and target step."""
        current_index = self.plan.get_step_index(current_step_id)
        target_index = self.plan.get_step_index(target_step_id)

        if current_index >= 0 and target_index >= 0 and target_index > current_index:
            # Mark all intermediate steps as completed (skipped)
            for i in range(current_index + 1, target_index):
                step_id = self.plan.steps[i].id
                if step_id not in self.step_completion_times:
                    self.step_completion_times[step_id] = datetime.now(timezone.utc)
                    print(f"[PlanExecution] Skipped step: {step_id}")

    def set_stream_service(self, stream_service):
        """Set the stream service for real-time notifications."""
        self._stream_service = stream_service

    async def set_deliverable_value(self, key: str, value: Any, source_message: str = None, confidence: float = 1.0, reasoning: str = None):
        """Set value for a deliverable and send real-time notification."""
        if key in self.deliverable_states:
            # Store previous status to detect if this is a new collection
            previous_status = self.deliverable_states[key].status

            # Mark deliverable as completed
            self.deliverable_states[key].mark_completed(value, source_message, confidence, reasoning)

            # Send real-time notification if this is a new collection and we have stream service
            if previous_status != DeliverableStatus.COMPLETED and self._stream_service:
                try:
                    # Generate session ID from conversation context
                    session_id = f"session_{int(datetime.now(timezone.utc).timestamp())}"

                    await self._stream_service.send_plan_deliverable_update(
                        session_id=session_id,
                        deliverable_key=key,
                        deliverable_value=value,
                        step_id=self.current_step_id or "unknown_step",
                        reasoning=reasoning
                    )

                    print(f"[PlanExecution] Sent real-time deliverable update: {key} = {value}")
                except Exception as e:
                    print(f"[PlanExecution] Failed to send deliverable update: {e}")

    def set_deliverable_value_sync(self, key: str, value: Any, source_message: str = None, confidence: float = 1.0, reasoning: str = None):
        """Synchronous version for backward compatibility."""
        if key in self.deliverable_states:
            self.deliverable_states[key].mark_completed(value, source_message, confidence, reasoning)

    def is_current_step_completed(self) -> bool:
        """Check if current step's required deliverables are completed."""
        current_step = self.current_step
        if not current_step:
            return False

        # Statement type steps complete automatically
        if current_step.type == StepType.STATEMENT:
            return True

        # Question type steps require deliverable completion
        for deliverable in current_step.required_deliverables:
            deliverable_state = self.get_deliverable_state(deliverable.key)
            if not deliverable_state or deliverable_state.status != DeliverableStatus.COMPLETED:
                return False

        return True

    def get_progress_summary(self) -> Dict[str, Any]:
        """Get comprehensive progress summary."""
        current_step = self.current_step

        # Calculate deliverable completion
        total_deliverables = len(self.deliverable_states)
        completed_deliverables = sum(
            1 for state in self.deliverable_states.values()
            if state.status == DeliverableStatus.COMPLETED
        )

        return {
            "plan_id": self.plan.id,
            "plan_title": self.plan.title,
            "is_started": self.is_started,
            "is_completed": self.is_completed,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "current_step": {
                "id": current_step.id if current_step else None,
                "title": current_step.title if current_step else None,
                "type": current_step.type.value if current_step else None,
                "instruction": current_step.instruction if current_step else None,
                "has_deliverables": current_step.has_deliverables if current_step else False,
                "step_number": self.plan.get_step_index(self.current_step_id) + 1 if self.current_step_id else 0
            },
            "progress": {
                "total_steps": len(self.plan.steps),
                "completed_steps": len(self.step_completion_times),
                "current_step_index": self.plan.get_step_index(self.current_step_id) + 1 if self.current_step_id else 0,
                "percentage": self.progress_percentage
            },
            "deliverables": {
                "total": total_deliverables,
                "completed": completed_deliverables,
                "pending": total_deliverables - completed_deliverables,
                "states": {
                    key: {
                        "key": state.deliverable.key,
                        "description": state.deliverable.description,
                        "type": state.deliverable.type.value,
                        "required": state.deliverable.required,
                        "status": state.status.value,
                        "value": state.value,
                        "collected_at": state.collected_at.isoformat() if state.collected_at else None
                    }
                    for key, state in self.deliverable_states.items()
                }
            },
            "steps": [
                {
                    "id": step.id,
                    "title": step.title,
                    "type": step.type.value,
                    "instruction": step.instruction,
                    "is_current": step.id == self.current_step_id,
                    "is_completed": step.id in self.step_completion_times,
                    "completed_at": self.step_completion_times.get(step.id).isoformat() if step.id in self.step_completion_times else None,
                    "deliverables": [
                        {
                            "key": d.key,
                            "description": d.description,
                            "required": d.required,
                            "status": self.deliverable_states[d.key].status.value if d.key in self.deliverable_states else "pending"
                        }
                        for d in step.deliverables
                    ]
                }
                for step in self.plan.steps
            ]
        }


@dataclass
class StateMachineExecutionState:
    """Current execution state of a state machine plan."""
    plan: StateMachinePlan
    current_state_id: Optional[str] = None
    current_task_id: Optional[str] = None  # For STRICT states
    deliverable_states: Dict[str, DeliverableState] = field(default_factory=dict)
    task_completion_times: Dict[str, datetime] = field(default_factory=dict)
    state_completion_times: Dict[str, datetime] = field(default_factory=dict)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    conversation_context: Dict[str, Any] = field(default_factory=dict)
    turns_without_deliverable_progress: int = 0  # NEW: Turn counter for timekeeper trigger
    _stream_service: Optional[Any] = field(default=None, init=False, repr=False)

    def __post_init__(self):
        """Initialize deliverable states for all deliverables in the plan."""
        for task in self.plan.get_all_tasks():
            for deliverable in task.deliverables:
                if deliverable.key not in self.deliverable_states:
                    self.deliverable_states[deliverable.key] = DeliverableState(deliverable)

    @property
    def current_state(self) -> Optional[State]:
        """Get the current active state."""
        if self.current_state_id:
            return self.plan.get_state(self.current_state_id)
        return None

    @property
    def current_task(self) -> Optional[Task]:
        """Get the current active task."""
        if self.current_task_id:
            return self.plan.get_task(self.current_task_id)
        return None

    @property
    def is_started(self) -> bool:
        """Check if state machine execution has started."""
        return self.started_at is not None

    @property
    def is_completed(self) -> bool:
        """Check if state machine execution is completed."""
        return self.completed_at is not None

    def start_execution(self):
        """Start state machine execution."""
        if not self.is_started:
            self.started_at = datetime.now(timezone.utc)
            self.current_state_id = self.plan.initial_state_id
            self._initialize_current_state()

    def _initialize_current_state(self):
        """Initialize the current state for execution."""
        current_state = self.current_state
        if not current_state:
            return

        if current_state.type == StateType.STRICT:
            # For STRICT states, set the first task as current
            next_task = current_state.get_next_task()
            if next_task:
                self.current_task_id = next_task.id
                next_task.status = TaskStatus.IN_PROGRESS
        else:
            # For LOOSE states, all tasks are potentially available
            self.current_task_id = None

    def complete_task(self, task_id: str) -> bool:
        """Mark a task as completed."""
        task = self.plan.get_task(task_id)
        if not task:
            return False

        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.now(timezone.utc)
        self.task_completion_times[task_id] = datetime.now(timezone.utc)

        # Update current task for STRICT states
        current_state = self.current_state
        if current_state and current_state.type == StateType.STRICT:
            if self.current_task_id == task_id:
                # Move to next task
                next_task = current_state.get_next_task()
                if next_task:
                    self.current_task_id = next_task.id
                    next_task.status = TaskStatus.IN_PROGRESS
                else:
                    self.current_task_id = None

        return True

    def get_available_tasks(self) -> List[Task]:
        """Get tasks available for processing in current state."""
        current_state = self.current_state
        if not current_state:
            return []

        if current_state.type == StateType.STRICT:
            # For STRICT, return current task + next task (for transition preparation)
            tasks = []
            if self.current_task:
                tasks.append(self.current_task)

            # Add next task for transition preparation (but not for processing)
            next_task = current_state.get_next_task()
            if next_task and next_task not in tasks:
                tasks.append(next_task)

            return tasks
        else:
            # For LOOSE, all available tasks
            completed_task_ids = list(self.task_completion_times.keys())
            return current_state.get_available_tasks(completed_task_ids)

    def is_current_state_complete(self) -> bool:
        """Check if current state is complete."""
        current_state = self.current_state
        if not current_state:
            return False
        return current_state.is_complete()

    def evaluate_state_transitions(self) -> Optional[str]:
        """Evaluate if we should transition to a new state."""
        current_state = self.current_state
        if not current_state or not self.is_current_state_complete():
            return None

        # Sort transitions by priority (higher first)
        sorted_transitions = sorted(current_state.transitions, key=lambda t: t.priority, reverse=True)

        for transition in sorted_transitions:
            if self._evaluate_transition_condition(transition):
                return transition.target_state_id

        return None

    def _evaluate_transition_condition(self, transition: StateTransition) -> bool:
        """Evaluate if a transition condition is met."""
        if not transition.condition_type or transition.condition_type == "all_tasks_complete":
            return self.is_current_state_complete()

        if transition.condition_type == "deliverable_check":
            # Check specific deliverable conditions
            condition_data = transition.condition_data or {}
            deliverable_key = condition_data.get("deliverable_key")
            expected_value = condition_data.get("expected_value")

            if deliverable_key:
                deliverable_state = self.get_deliverable_state(deliverable_key)
                if deliverable_state and deliverable_state.value:
                    if expected_value:
                        return str(deliverable_state.value).lower() == str(expected_value).lower()
                    return True  # Just check if deliverable has a value

        return False

    def skip_remaining_tasks(self) -> List[str]:
        """Skip all remaining tasks in the current state. Returns list of skipped task IDs."""
        current_state = self.current_state
        if not current_state:
            return []

        skipped_task_ids = []
        for task in current_state.tasks:
            if task.status == TaskStatus.NOT_STARTED:
                task.status = TaskStatus.SKIPPED
                # Don't set completed_at for skipped tasks
                skipped_task_ids.append(task.id)
                print(f"[StateMachine] Skipped task: {task.id}")

        return skipped_task_ids

    def advance_to_next_state(self) -> bool:
        """Advance to the next state if transition conditions are met.

        NEW: Resets turn counter when transitioning to new state.
        """
        if not self.current_state_id:
            return False

        # Mark current state as completed
        self.state_completion_times[self.current_state_id] = datetime.now(timezone.utc)

        # Check for state transitions
        next_state_id = self.evaluate_state_transitions()
        if next_state_id:
            self.current_state_id = next_state_id
            self._initialize_current_state()

            # NEW: Reset turn counter for fresh start in new state
            self.reset_turn_counter()
            print(f"[StateMachine] Transitioned to new state: {next_state_id} - turn counter reset")

            return True
        else:
            # No valid transition found - execution complete
            self.completed_at = datetime.now(timezone.utc)
            self.current_state_id = None
            self.current_task_id = None
            return False

    def get_deliverable_state(self, key: str) -> Optional[DeliverableState]:
        """Get state of a specific deliverable."""
        return self.deliverable_states.get(key)

    def get_next_state(self) -> Optional[State]:
        """Get the next state that will be transitioned to based on current state's transitions."""
        current_state = self.current_state
        if not current_state or not current_state.transitions:
            return None

        # Get highest priority transition
        sorted_transitions = sorted(current_state.transitions,
                                   key=lambda t: t.priority, reverse=True)

        if sorted_transitions:
            next_state_id = sorted_transitions[0].target_state_id
            return self.plan.get_state(next_state_id)

        return None

    def get_conditional_task_info(self, task: Task) -> Optional[Dict[str, Any]]:
        """
        Check if a task has conditional deliverables and return info about both paths.
        Returns None if task is not conditional.
        """
        if not task or not task.deliverables:
            return None

        # Look for boolean deliverables that affect flow
        for deliverable in task.deliverables:
            if deliverable.type == DeliverableType.BOOLEAN:
                # Check if this is a continuation-type deliverable
                if "continue" in deliverable.key.lower() or "wants" in deliverable.key.lower():
                    return self._build_conditional_paths_info(task, deliverable)

        return None

    def _build_conditional_paths_info(self, task: Task, conditional_deliverable: Deliverable) -> Dict[str, Any]:
        """Build information about both conditional paths for a task."""
        current_state = self.current_state
        if not current_state:
            return None

        # Get remaining tasks in current state (for "continue" path)
        remaining_tasks = []
        task_found = False
        for t in current_state.tasks:
            if task_found and not t.required:
                # These are the optional tasks that come after the conditional
                remaining_tasks.append({
                    "id": t.id,
                    "description": t.description,
                    "instruction": t.instruction,
                    "required": t.required
                })
            if t.id == task.id:
                task_found = True

        # Get next state (for "skip" path)
        next_state = self.get_next_state()

        conditional_info = {
            "task_id": task.id,
            "task_description": task.description,
            "deliverable_key": conditional_deliverable.key,
            "deliverable_description": conditional_deliverable.description,
            "paths": {
                "continue": {
                    "description": "User wants to continue",
                    "action": "proceed_with_optional_tasks",
                    "tasks": remaining_tasks,
                    "task_count": len(remaining_tasks)
                },
                "skip": {
                    "description": "User wants to stop",
                    "action": "skip_to_next_state",
                    "next_state_id": next_state.id if next_state else None,
                    "next_state_title": next_state.title if next_state else None,
                    "next_state_description": next_state.description if next_state else None,
                    "tasks_to_skip": [t["id"] for t in remaining_tasks]
                }
            }
        }

        return conditional_info

    def set_stream_service(self, stream_service):
        """Set the stream service for real-time notifications."""
        self._stream_service = stream_service

    async def set_deliverable_value(self, key: str, value: Any, source_message: str = None, confidence: float = 1.0, reasoning: str = None):
        """Set value for a deliverable and send real-time notification.

        NEW: Resets turn counter when deliverable progress is made.
        """
        if key in self.deliverable_states:
            # Store previous status to detect if this is a new collection
            previous_status = self.deliverable_states[key].status

            # Mark deliverable as completed
            self.deliverable_states[key].mark_completed(value, source_message, confidence, reasoning)

            # NEW: Reset turn counter when deliverable progress is made
            if previous_status != DeliverableStatus.COMPLETED:
                self.reset_turn_counter()

            # Send real-time notification if this is a new collection and we have stream service
            if previous_status != DeliverableStatus.COMPLETED and self._stream_service:
                try:
                    # Generate session ID from conversation context
                    session_id = f"session_{int(datetime.now(timezone.utc).timestamp())}"

                    await self._stream_service.send_plan_deliverable_update(
                        session_id=session_id,
                        deliverable_key=key,
                        deliverable_value=value,
                        step_id=self.current_state_id or "unknown_state",
                        reasoning=reasoning
                    )

                    print(f"[StateMachine] Sent real-time deliverable update: {key} = {value}")
                except Exception as e:
                    print(f"[StateMachine] Failed to send deliverable update: {e}")

    def increment_turn_counter(self) -> int:
        """Increment turn counter when no deliverable progress made.

        Returns the new counter value.
        """
        self.turns_without_deliverable_progress += 1
        print(f"[StateMachine] Turn counter incremented to {self.turns_without_deliverable_progress}")
        return self.turns_without_deliverable_progress

    def reset_turn_counter(self) -> None:
        """Reset turn counter when deliverable progress detected."""
        if self.turns_without_deliverable_progress > 0:
            print(f"[StateMachine] Turn counter reset from {self.turns_without_deliverable_progress} to 0")
        self.turns_without_deliverable_progress = 0

    def get_turn_counter(self) -> int:
        """Get current turn counter value."""
        return self.turns_without_deliverable_progress

    def get_progress_summary(self) -> Dict[str, Any]:
        """Get comprehensive progress summary."""
        current_state = self.current_state
        current_task = self.current_task

        # Calculate task completion
        all_tasks = self.plan.get_all_tasks()
        total_tasks = len(all_tasks)
        completed_tasks = len(self.task_completion_times)

        # Calculate deliverable completion
        total_deliverables = len(self.deliverable_states)
        completed_deliverables = sum(
            1 for state in self.deliverable_states.values()
            if state.status == DeliverableStatus.COMPLETED
        )

        progress_summary = {
            "plan_id": self.plan.id,
            "plan_title": self.plan.title,
            "is_started": self.is_started,
            "is_completed": self.is_completed,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "current_state": {
                "id": current_state.id if current_state else None,
                "title": current_state.title if current_state else None,
                "type": current_state.type.value if current_state else None,
                "description": current_state.description if current_state else None,
                "is_complete": self.is_current_state_complete()
            },
            "current_task": {
                "id": current_task.id if current_task else None,
                "description": current_task.description if current_task else None,
                "instruction": current_task.instruction if current_task else None,
                "required": current_task.required if current_task else None
            },
            "progress": {
                "total_states": len(self.plan.states),
                "completed_states": len(self.state_completion_times),
                "current_state_index": self.plan.get_state_index(self.current_state_id) + 1 if self.current_state_id else 0,
                "percentage": (len(self.state_completion_times) / len(self.plan.states) * 100) if self.plan.states else 0
            },
            "tasks": {
                "total": total_tasks,
                "completed": completed_tasks,
                "pending": total_tasks - completed_tasks,
                "available": len(self.get_available_tasks())
            },
            "deliverables": {
                "total": total_deliverables,
                "completed": completed_deliverables,
                "pending": total_deliverables - completed_deliverables
            }
        }

        print(f"[StateMachineExecutionState] Progress summary generated:")
        print(f"  - Current state: {progress_summary['current_state']['title']} ({progress_summary['current_state']['type']})")
        print(f"  - Progress: {progress_summary['progress']['percentage']}% ({progress_summary['progress']['completed_states']}/{progress_summary['progress']['total_states']} states)")

        return progress_summary