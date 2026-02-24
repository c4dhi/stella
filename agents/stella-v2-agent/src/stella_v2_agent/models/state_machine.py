"""State Machine data models.

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

try:
    from stella_agent_sdk.plan import StateType
except ImportError:
    class StateType(str, Enum):
        """Processing mode for a state."""
        STRICT = "strict"
        LOOSE = "loose"


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
    status: DeliverableStatus = DeliverableStatus.PENDING
    value: Optional[Any] = None
    reasoning: str = ""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Deliverable":
        return cls(
            key=data["key"],
            type=data.get("type", "string"),
            description=data.get("description", ""),
            required=data.get("required", True),
            acceptance_criteria=data.get("acceptance_criteria", ""),
            examples=data.get("examples", []),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "type": self.type,
            "description": self.description,
            "required": self.required,
            "acceptance_criteria": self.acceptance_criteria,
            "examples": self.examples,
            "status": self.status.value,
            "value": self.value,
            "reasoning": self.reasoning,
        }


@dataclass
class Task:
    """A task within a state, containing deliverables."""
    id: str
    description: str
    instruction: str
    required: bool = True
    deliverables: List[Deliverable] = field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        deliverables = [Deliverable.from_dict(d) for d in data.get("deliverables", [])]
        return cls(
            id=data["id"],
            description=data.get("description", ""),
            instruction=data.get("instruction", ""),
            required=data.get("required", True),
            deliverables=deliverables,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "description": self.description,
            "instruction": self.instruction,
            "required": self.required,
            "deliverables": [d.to_dict() for d in self.deliverables],
            "status": self.status.value,
        }

    def is_complete(self) -> bool:
        """Check if all deliverables are in a terminal state (completed or skipped).

        Every deliverable must be resolved before the task is considered done.
        The 'required' flag controls whether the timekeeper can skip an item,
        NOT whether it blocks completion.
        """
        if not self.deliverables:
            # Tasks without deliverables need explicit completion
            return self.status == TaskStatus.COMPLETED
        for d in self.deliverables:
            if d.status == DeliverableStatus.PENDING:
                return False
        return True

    def get_pending_deliverables(self) -> List[Deliverable]:
        return [d for d in self.deliverables if d.status == DeliverableStatus.PENDING]


@dataclass
class StateTransition:
    """Transition definition between states."""
    target_state_id: str
    condition_type: str  # "all_tasks_complete", "deliverable_value", etc.
    priority: int = 1
    condition_config: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StateTransition":
        return cls(
            target_state_id=data["target_state_id"],
            condition_type=data.get("condition_type", "all_tasks_complete"),
            priority=data.get("priority", 1),
            condition_config=data.get("condition_config", {}),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "target_state_id": self.target_state_id,
            "condition_type": self.condition_type,
            "priority": self.priority,
            "condition_config": self.condition_config,
        }


@dataclass
class State:
    """A state in the state machine, containing tasks."""
    id: str
    title: str
    type: StateType
    description: str = ""
    tasks: List[Task] = field(default_factory=list)
    transitions: List[StateTransition] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "State":
        tasks = [Task.from_dict(t) for t in data.get("tasks", [])]
        transitions = [StateTransition.from_dict(t) for t in data.get("transitions", [])]
        return cls(
            id=data["id"],
            title=data.get("title", data["id"]),
            type=StateType(data.get("type", "loose")),
            description=data.get("description", ""),
            tasks=tasks,
            transitions=transitions,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "type": self.type.value,
            "description": self.description,
            "tasks": [t.to_dict() for t in self.tasks],
            "transitions": [t.to_dict() for t in self.transitions],
        }

    def is_complete(self) -> bool:
        """Check if all tasks have reached a terminal state (completed or skipped).

        A state is complete when every task is either COMPLETED or SKIPPED.
        The 'required' flag controls whether the timekeeper can skip a task,
        NOT whether it blocks state transitions.
        """
        for task in self.tasks:
            if task.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED):
                return False
        return True

    def get_pending_tasks(self) -> List[Task]:
        return [
            t for t in self.tasks
            if t.status not in (TaskStatus.COMPLETED, TaskStatus.SKIPPED)
        ]


@dataclass
class Plan:
    """Complete plan with states and metadata."""
    id: str
    title: str
    description: str = ""
    initial_state_id: str = ""
    states: List[State] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Plan":
        states = [State.from_dict(s) for s in data.get("states", [])]
        initial_state_id = data.get("initial_state_id", "")
        if not initial_state_id and states:
            initial_state_id = states[0].id

        plan_id = data.get("id", data.get("name", "plan"))
        plan_title = data.get("title", data.get("name", "Conversation Plan"))

        return cls(
            id=plan_id,
            title=plan_title,
            description=data.get("description", ""),
            initial_state_id=initial_state_id,
            states=states,
            metadata=data.get("metadata", {}),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "initial_state_id": self.initial_state_id,
            "states": [s.to_dict() for s in self.states],
            "metadata": self.metadata,
        }

    def get_state(self, state_id: str) -> Optional[State]:
        for state in self.states:
            if state.id == state_id:
                return state
        return None

    def get_all_deliverables(self) -> List[Deliverable]:
        deliverables = []
        for state in self.states:
            for task in state.tasks:
                deliverables.extend(task.deliverables)
        return deliverables

    def count_completed_deliverables(self) -> int:
        return sum(
            1 for state in self.states
            for task in state.tasks
            for d in task.deliverables
            if d.status == DeliverableStatus.COMPLETED
        )

    def count_required_deliverables(self) -> int:
        return sum(
            1 for state in self.states
            for task in state.tasks
            for d in task.deliverables
            if d.required
        )
