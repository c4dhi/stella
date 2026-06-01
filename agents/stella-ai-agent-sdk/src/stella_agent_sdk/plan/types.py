"""
Plan Type Definitions

Canonical Pydantic models for STELLA conversation plans.
These are the single source of truth for plan structures.

Field naming follows the agent convention:
- State: id, title, type (strict/loose), description, tasks, transitions
- Task: id, description, instruction, required, deliverables
- Deliverable: key, type, description, required, acceptance_criteria, examples
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Any, Literal, Dict
from enum import Enum


class StateType(str, Enum):
    """Execution mode for a state.

    STRICT: Sequential task processing - one task at a time
    LOOSE: Flexible/parallel task processing - any order
    GOAL: Goal-oriented natural conversation - agent sees information gaps, not tasks
    """
    STRICT = "strict"
    LOOSE = "loose"
    GOAL = "goal"


class DeliverableType(str, Enum):
    """Data type of a deliverable value."""
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    ENUM = "enum"


class PlanDeliverable(BaseModel):
    """A single deliverable within a task.

    Represents a piece of information to collect from the user,
    with validation criteria and examples.

    Attributes:
        key: Unique identifier for this deliverable within the task
        type: Data type of the expected value
        description: Human-readable description of what to collect
        required: Whether this deliverable must be completed
        acceptance_criteria: Validation rules for the collected value
        examples: Example values to guide the agent
        enum_values: Valid options for enum type deliverables
    """
    key: str = Field(..., description="Unique identifier for this deliverable")
    type: DeliverableType = Field(default=DeliverableType.STRING, description="Data type")
    description: str = Field(default="", description="What information to collect")
    required: bool = Field(default=True, description="Must be completed")
    acceptance_criteria: str = Field(default="", description="Validation rules")
    examples: List[str] = Field(default_factory=list, description="Example values")
    enum_values: Optional[List[str]] = Field(default=None, description="Valid options for enum type")

    model_config = {"extra": "allow"}  # Allow additional fields for extensibility


class PlanTask(BaseModel):
    """A task within a state, containing deliverables.

    Tasks represent units of work that need to be completed,
    each potentially requiring multiple pieces of information.

    Attributes:
        id: Unique identifier for this task within the state
        description: Task title/name - what needs to be accomplished
        instruction: Detailed instructions for the agent on how to complete the task
        required: Whether this task must be completed before state transition
        deliverables: List of information to collect during this task
    """
    id: str = Field(..., description="Unique task identifier")
    description: str = Field(..., description="Task title/name")
    instruction: str = Field(default="", description="Instructions for the agent")
    required: bool = Field(default=True, description="Must be completed")
    deliverables: List[PlanDeliverable] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class StateGoal(BaseModel):
    """Goal-mode context for natural, goal-oriented conversation states.

    Only used when PlanState.type is GOAL. Defines the conversation objective
    and the information to gather, without the rigid task structure.

    Attributes:
        objective: What the conversation should achieve
        context: Background information for the agent
        depth_guidance: How deep to probe for information
        boundaries: What NOT to discuss
        success_description: What "done well" looks like
        deliverables: Information to gather during the goal conversation
    """
    objective: str = Field(..., description="What the conversation should achieve")
    context: str = Field(default="", description="Background information")
    depth_guidance: str = Field(default="", description="How deep to probe")
    boundaries: str = Field(default="", description="What NOT to discuss")
    success_description: str = Field(default="", description="What done well looks like")
    deliverables: List[PlanDeliverable] = Field(default_factory=list, description="Information to gather")

    model_config = {"extra": "allow"}


class StateTransition(BaseModel):
    """Transition definition between states.

    Defines when and how to move from one state to another.

    Attributes:
        target_state_id: The state to transition to
        condition_type: Type of condition to evaluate
            - "all_tasks_complete": All required tasks in current state completed
            - "deliverable_value": Check if a deliverable has a specific value
            - "deliverable_exists": Check if a deliverable has any value
        priority: Lower numbers = higher priority when multiple conditions match
        condition_config: Additional config for the condition type
    """
    target_state_id: str = Field(..., description="Target state ID")
    condition_type: str = Field(default="all_tasks_complete", description="Condition type")
    priority: int = Field(default=1, description="Transition priority (lower = higher)")
    condition_config: Dict[str, Any] = Field(default_factory=dict, description="Condition parameters")

    model_config = {"extra": "allow"}


class PlanState(BaseModel):
    """A state in the state machine, containing tasks.

    States represent phases of the conversation with different
    processing modes and transition rules.

    Attributes:
        id: Unique identifier for this state
        title: Display name for the state
        type: Processing mode (strict=sequential, loose=flexible)
        description: Optional description of this state's purpose
        tasks: List of tasks to complete in this state
        transitions: Rules for moving to other states
    """
    id: str = Field(..., description="Unique state identifier")
    title: str = Field(..., description="State display name")
    type: StateType = Field(default=StateType.LOOSE, description="Processing mode")
    description: str = Field(default="", description="State description")
    tasks: List[PlanTask] = Field(default_factory=list)
    transitions: List[StateTransition] = Field(default_factory=list)
    goal: Optional[StateGoal] = Field(default=None, description="Goal context (only for goal-type states)")

    model_config = {"extra": "allow"}


class SessionContextField(BaseModel):
    """A field for collecting session context information.

    Used to collect participant information at the start of a session.

    Attributes:
        id: Unique identifier for this field
        label: Display label for the field
        type: Input type for the field
        required: Whether this field must be filled
        description: Help text for the field
        options: Valid options for select type
        default_value: Default value if not provided
    """
    id: str = Field(..., description="Field identifier")
    label: str = Field(..., description="Display label")
    type: Literal["string", "number", "boolean", "select"] = Field(default="string")
    required: bool = Field(default=True)
    description: str = Field(default="")
    options: Optional[List[str]] = Field(default=None, description="Options for select type")
    default_value: Optional[Any] = Field(default=None)

    model_config = {"extra": "allow"}


class SessionContext(BaseModel):
    """Container for session context configuration.

    Defines fields to collect from the participant at session start.
    """
    fields: List[SessionContextField] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class Plan(BaseModel):
    """Complete conversation plan with states and metadata.

    The top-level container for a conversation plan,
    defining the flow through multiple states.

    Attributes:
        id: Unique identifier for this plan
        title: Display name for the plan
        description: Optional description of the plan's purpose
        initial_state_id: Starting state (defaults to first state)
        states: List of states in this plan
        metadata: Additional metadata (version, notes, etc.)
        system_prompt: Custom system prompt for the agent persona
        session_context: Fields to collect at session start
    """
    id: str = Field(..., description="Plan identifier")
    title: str = Field(..., description="Plan display name")
    description: str = Field(default="")
    initial_state_id: str = Field(default="", description="Starting state ID")
    states: List[PlanState] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    system_prompt: Optional[str] = Field(default=None, description="Custom agent persona")
    session_context: Optional[SessionContext] = Field(default=None)
    language: str = Field(
        default="auto",
        description=(
            "Declared conversation language seed (ISO 639-1, e.g. 'de'/'en') or "
            "'auto' to detect. A soft seed, not a cage: it seeds turn-1 resolution "
            "and aids accuracy, but a confidently-detected supported language "
            "wins (RFC §8.1)."
        ),
    )

    model_config = {"extra": "allow"}

    def model_post_init(self, __context: Any) -> None:
        """Set initial_state_id to first state if not provided."""
        if not self.initial_state_id and self.states:
            object.__setattr__(self, 'initial_state_id', self.states[0].id)
