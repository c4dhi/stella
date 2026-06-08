"""State Machine data models for Stella Agent.

Defines the core data structures for plan-based conversation flow:
- Plan: Complete conversation plan with states
- State: A phase with tasks and transitions (STRICT/LOOSE modes)
- Task: A unit of work containing deliverables
- Deliverable: A piece of information to collect from the user

NOTE: Field names follow the canonical SDK format defined in stella_agent_sdk.plan.
These runtime classes extend the SDK definitions with status tracking fields.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from enum import Enum

# Import canonical StateType from SDK for consistency
try:
    from stella_agent_sdk.plan import StateType
except ImportError:
    # Fallback for development without SDK installed
    class StateType(str, Enum):
        """Processing mode for a state."""
        STRICT = "strict"   # Sequential task processing - one at a time
        LOOSE = "loose"     # Parallel/flexible task processing


def _downgrade_goal_state(data: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a goal-type state dict into a loose state with synthetic tasks.

    Legacy compatibility: Goal-oriented states (introduced in STELLA v2) use a
    ``goal`` object with deliverables instead of the traditional task list.
    Legacy agents don't understand goal semantics, so we reshape the data into
    a single loose task whose deliverables mirror the goal's, preserving the
    ability to collect information without native goal-mode support.

    The original ``data`` dict is not mutated; a shallow copy is returned.
    """
    goal = data.get("goal", {})
    goal_deliverables = goal.get("deliverables", [])

    objective = goal.get("objective", data.get("title", "Goal"))
    context_parts = [objective]
    if goal.get("context"):
        context_parts.append(goal["context"])
    if goal.get("depth_guidance"):
        context_parts.append(f"Depth guidance: {goal['depth_guidance']}")
    if goal.get("boundaries"):
        context_parts.append(f"Boundaries: {goal['boundaries']}")

    synthetic_task = {
        "id": "__goal__",
        "description": objective,
        "instruction": "\n".join(context_parts),
        "required": True,
        "deliverables": list(goal_deliverables),
    }

    result = dict(data)
    result["type"] = "loose"
    result["tasks"] = [synthetic_task] + list(data.get("tasks", []))
    return result


class DeliverableStatus(str, Enum):
    """Status of a deliverable."""
    PENDING = "pending"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class TaskStatus(str, Enum):
    """Status of a task."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


@dataclass
class Deliverable:
    """A single deliverable within a task.

    Represents a piece of information to collect from the user,
    with validation criteria and examples.
    """
    key: str
    type: str  # "string", "number", "boolean"
    description: str
    required: bool = True
    acceptance_criteria: str = ""
    examples: List[str] = field(default_factory=list)
    # Runtime state
    status: DeliverableStatus = DeliverableStatus.PENDING
    value: Optional[Any] = None
    reasoning: str = ""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Deliverable":
        """Create a Deliverable from a dictionary."""
        return cls(
            key=data["key"],
            type=data.get("type", "string"),
            description=data.get("description", ""),
            required=data.get("required", True),
            acceptance_criteria=data.get("acceptance_criteria", ""),
            examples=data.get("examples", [])
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "key": self.key,
            "type": self.type,
            "description": self.description,
            "required": self.required,
            "acceptance_criteria": self.acceptance_criteria,
            "examples": self.examples,
            "status": self.status.value,
            "value": self.value,
            "reasoning": self.reasoning
        }


@dataclass
class Task:
    """A task within a state, containing deliverables.

    Tasks represent units of work that need to be completed,
    each potentially requiring multiple pieces of information.
    """
    id: str
    description: str
    instruction: str
    required: bool = True
    deliverables: List[Deliverable] = field(default_factory=list)
    # Runtime state
    status: TaskStatus = TaskStatus.PENDING

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        """Create a Task from a dictionary."""
        deliverables = [
            Deliverable.from_dict(d) for d in data.get("deliverables", [])
        ]
        return cls(
            id=data["id"],
            description=data.get("description", ""),
            instruction=data.get("instruction", ""),
            required=data.get("required", True),
            deliverables=deliverables
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "description": self.description,
            "instruction": self.instruction,
            "required": self.required,
            "deliverables": [d.to_dict() for d in self.deliverables],
            "status": self.status.value
        }

    def is_complete(self) -> bool:
        """Check if all required deliverables are completed."""
        for d in self.deliverables:
            if d.required and d.status != DeliverableStatus.COMPLETED:
                return False
        return True

    def get_pending_deliverables(self) -> List[Deliverable]:
        """Get list of pending deliverables."""
        return [d for d in self.deliverables if d.status == DeliverableStatus.PENDING]


@dataclass
class StateTransition:
    """Transition definition between states.

    Defines when and how to move from one state to another.
    """
    target_state_id: str
    condition_type: str  # "all_tasks_complete", "deliverable_value", etc.
    priority: int = 1
    condition_config: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StateTransition":
        """Create a StateTransition from a dictionary."""
        return cls(
            target_state_id=data["target_state_id"],
            condition_type=data.get("condition_type", "all_tasks_complete"),
            priority=data.get("priority", 1),
            condition_config=data.get("condition_config", {})
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "target_state_id": self.target_state_id,
            "condition_type": self.condition_type,
            "priority": self.priority,
            "condition_config": self.condition_config
        }


@dataclass
class State:
    """A state in the state machine, containing tasks.

    States represent phases of the conversation with different
    processing modes (STRICT vs LOOSE) and transition rules.
    """
    id: str
    title: str
    type: StateType
    description: str = ""
    tasks: List[Task] = field(default_factory=list)
    transitions: List[StateTransition] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "State":
        """Create a State from a dictionary.

        Goal-type states are not natively supported by legacy agents.
        They are downgraded to loose states with synthetic tasks derived
        from the goal's deliverables, so the agent can still collect the
        required information without crashing.
        """
        state_type_raw = data.get("type", "loose")
        if state_type_raw == "goal":
            data = _downgrade_goal_state(data)
            state_type_raw = "loose"

        tasks = [Task.from_dict(t) for t in data.get("tasks", [])]
        transitions = [StateTransition.from_dict(t) for t in data.get("transitions", [])]
        return cls(
            id=data["id"],
            title=data.get("title", data["id"]),
            type=StateType(state_type_raw),
            description=data.get("description", ""),
            tasks=tasks,
            transitions=transitions
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "type": self.type.value,
            "description": self.description,
            "tasks": [t.to_dict() for t in self.tasks],
            "transitions": [t.to_dict() for t in self.transitions]
        }

    def is_complete(self) -> bool:
        """Check if all required tasks are completed."""
        for task in self.tasks:
            if task.required and task.status != TaskStatus.COMPLETED:
                return False
        return True

    def get_pending_tasks(self) -> List[Task]:
        """Get list of pending/in-progress tasks."""
        return [
            t for t in self.tasks
            if t.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
        ]


@dataclass
class Plan:
    """Complete plan with states and metadata.

    The top-level container for a conversation plan,
    defining the flow through multiple states.
    """
    id: str
    title: str
    description: str = ""
    initial_state_id: str = ""
    states: List[State] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Plan":
        """Create a Plan from a dictionary."""
        states = [State.from_dict(s) for s in data.get("states", [])]
        initial_state_id = data.get("initial_state_id", "")
        if not initial_state_id and states:
            initial_state_id = states[0].id

        # Handle missing id/title fields (common when plan comes directly from frontend)
        plan_id = data.get("id", data.get("name", "plan"))
        plan_title = data.get("title", data.get("name", "Conversation Plan"))

        return cls(
            id=plan_id,
            title=plan_title,
            description=data.get("description", ""),
            initial_state_id=initial_state_id,
            states=states,
            metadata=data.get("metadata", {})
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "initial_state_id": self.initial_state_id,
            "states": [s.to_dict() for s in self.states],
            "metadata": self.metadata
        }

    def get_state(self, state_id: str) -> Optional[State]:
        """Get a state by ID."""
        for state in self.states:
            if state.id == state_id:
                return state
        return None

    def get_all_deliverables(self) -> List[Deliverable]:
        """Get all deliverables across all states."""
        deliverables = []
        for state in self.states:
            for task in state.tasks:
                deliverables.extend(task.deliverables)
        return deliverables

    def count_completed_deliverables(self) -> int:
        """Count completed deliverables across all states."""
        count = 0
        for state in self.states:
            for task in state.tasks:
                for d in task.deliverables:
                    if d.status == DeliverableStatus.COMPLETED:
                        count += 1
        return count

    def count_required_deliverables(self) -> int:
        """Count required deliverables across all states."""
        count = 0
        for state in self.states:
            for task in state.tasks:
                for d in task.deliverables:
                    if d.required:
                        count += 1
        return count
