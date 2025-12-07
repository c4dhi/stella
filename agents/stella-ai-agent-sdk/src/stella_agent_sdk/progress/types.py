"""
Generic progress tracking types for the STELLA Agent SDK.

These types provide a flexible, agent-agnostic schema for tracking
conversation progress, task completion, and data collection.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ExecutionMode(str, Enum):
    """
    How items within a group should be executed/completed.

    This controls the agent's autonomy over task ordering within a group.
    """

    SEQUENTIAL = "sequential"
    """
    Items must be completed in order. The agent follows a strict sequence
    and cannot skip ahead or reorder items.

    Use cases:
    - Compliance disclosures that must be read in order
    - Step-by-step wizards
    - Escalation procedures
    - Legal/regulatory flows
    """

    FLEXIBLE = "flexible"
    """
    Agent decides order based on conversation flow. Items can be completed
    in any order, and the agent adapts to user responses.

    Use cases:
    - General information gathering
    - Discovery conversations
    - Troubleshooting (follow the user's lead)
    - Natural conversation flows
    """


class ItemStatus(str, Enum):
    """Status of a single progress item."""

    PENDING = "pending"
    """Item has not been started."""

    IN_PROGRESS = "in_progress"
    """Item is currently being worked on."""

    COMPLETED = "completed"
    """Item has been successfully completed."""

    SKIPPED = "skipped"
    """Item was skipped (optional item or user declined)."""


class GroupStatus(str, Enum):
    """Status of a progress group."""

    PENDING = "pending"
    """Group has not been started."""

    IN_PROGRESS = "in_progress"
    """Group is currently active."""

    COMPLETED = "completed"
    """All required items in group are completed."""


@dataclass
class ProgressItem:
    """
    A single trackable item within a progress group.

    Items represent individual tasks, questions, or data points that
    the agent needs to complete or collect.

    Attributes:
        id: Unique identifier for this item within its group.
        label: Human-readable label for display.
        status: Current completion status.
        description: Optional longer description or instruction.
        required: Whether this item must be completed (vs optional).
        value: Collected value if this item captures data.
        confidence: Confidence score for collected value (0.0 to 1.0).
        collected_at: ISO timestamp when value was collected.
        metadata: Additional item-specific data (e.g., acceptance_criteria, reasoning).
    """

    id: str
    label: str
    status: ItemStatus = ItemStatus.PENDING
    description: Optional[str] = None
    required: bool = True
    value: Optional[Any] = None
    confidence: Optional[float] = None
    collected_at: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = {
            "id": self.id,
            "label": self.label,
            "status": self.status.value,
            "required": self.required,
        }
        if self.description is not None:
            result["description"] = self.description
        if self.value is not None:
            result["value"] = self.value
        if self.confidence is not None:
            result["confidence"] = self.confidence
        if self.collected_at is not None:
            result["collected_at"] = self.collected_at
        if self.metadata:
            result["metadata"] = self.metadata
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProgressItem":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            label=data["label"],
            status=ItemStatus(data.get("status", "pending")),
            description=data.get("description"),
            required=data.get("required", True),
            value=data.get("value"),
            confidence=data.get("confidence"),
            collected_at=data.get("collected_at"),
            metadata=data.get("metadata", {}),
        )


@dataclass
class ProgressGroup:
    """
    A group of related progress items.

    Groups organize items into logical sections (phases, states, steps)
    and define how the agent should handle task ordering within the group.

    Attributes:
        id: Unique identifier for this group.
        label: Human-readable label for display.
        execution_mode: How items should be executed (SEQUENTIAL or FLEXIBLE).
        status: Current group status.
        items: List of progress items in this group.
        is_current: Whether this is the currently active group.
        description: Optional longer description of this group's purpose.
        completed_at: ISO timestamp when group was completed.
        metadata: Additional group-specific data.
    """

    id: str
    label: str
    execution_mode: ExecutionMode = ExecutionMode.FLEXIBLE
    status: GroupStatus = GroupStatus.PENDING
    items: List[ProgressItem] = field(default_factory=list)
    is_current: bool = False
    description: Optional[str] = None
    completed_at: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = {
            "id": self.id,
            "label": self.label,
            "execution_mode": self.execution_mode.value,
            "status": self.status.value,
            "items": [item.to_dict() for item in self.items],
            "is_current": self.is_current,
        }
        if self.description is not None:
            result["description"] = self.description
        if self.completed_at is not None:
            result["completed_at"] = self.completed_at
        if self.metadata:
            result["metadata"] = self.metadata
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProgressGroup":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            label=data["label"],
            execution_mode=ExecutionMode(data.get("execution_mode", "flexible")),
            status=GroupStatus(data.get("status", "pending")),
            items=[ProgressItem.from_dict(item) for item in data.get("items", [])],
            is_current=data.get("is_current", False),
            description=data.get("description"),
            completed_at=data.get("completed_at"),
            metadata=data.get("metadata", {}),
        )

    @property
    def completed_items(self) -> int:
        """Count of completed items."""
        return sum(1 for item in self.items if item.status == ItemStatus.COMPLETED)

    @property
    def total_items(self) -> int:
        """Total number of items."""
        return len(self.items)

    @property
    def required_items_completed(self) -> bool:
        """Whether all required items are completed."""
        return all(
            item.status in (ItemStatus.COMPLETED, ItemStatus.SKIPPED)
            for item in self.items
            if item.required
        )


@dataclass
class ProgressState:
    """
    Complete progress state for an agent conversation.

    This is the top-level container that holds all progress groups
    and provides summary information for UI display.

    Attributes:
        groups: List of progress groups.
        current_group_id: ID of the currently active group.
        current_item_id: ID of the currently active item (for sequential mode).
        progress_percentage: Overall completion percentage (0.0 to 100.0).
        elapsed_minutes: Time since progress tracking started.
        started_at: ISO timestamp when tracking started.
        last_updated: ISO timestamp of last update.
        metadata: Additional state-specific data (e.g., plan_id, agent-specific info).
    """

    groups: List[ProgressGroup] = field(default_factory=list)
    current_group_id: Optional[str] = None
    current_item_id: Optional[str] = None
    progress_percentage: float = 0.0
    elapsed_minutes: float = 0.0
    started_at: Optional[str] = None
    last_updated: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = {
            "groups": [group.to_dict() for group in self.groups],
            "progress_percentage": self.progress_percentage,
            "elapsed_minutes": self.elapsed_minutes,
        }
        if self.current_group_id is not None:
            result["current_group_id"] = self.current_group_id
        if self.current_item_id is not None:
            result["current_item_id"] = self.current_item_id
        if self.started_at is not None:
            result["started_at"] = self.started_at
        if self.last_updated is not None:
            result["last_updated"] = self.last_updated
        if self.metadata:
            result["metadata"] = self.metadata
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProgressState":
        """Create from dictionary."""
        return cls(
            groups=[ProgressGroup.from_dict(g) for g in data.get("groups", [])],
            current_group_id=data.get("current_group_id"),
            current_item_id=data.get("current_item_id"),
            progress_percentage=data.get("progress_percentage", 0.0),
            elapsed_minutes=data.get("elapsed_minutes", 0.0),
            started_at=data.get("started_at"),
            last_updated=data.get("last_updated"),
            metadata=data.get("metadata", {}),
        )

    @property
    def current_group(self) -> Optional[ProgressGroup]:
        """Get the currently active group."""
        if self.current_group_id is None:
            return None
        for group in self.groups:
            if group.id == self.current_group_id:
                return group
        return None

    @property
    def total_items(self) -> int:
        """Total number of items across all groups."""
        return sum(group.total_items for group in self.groups)

    @property
    def completed_items(self) -> int:
        """Total number of completed items across all groups."""
        return sum(group.completed_items for group in self.groups)

    @property
    def total_groups(self) -> int:
        """Total number of groups."""
        return len(self.groups)

    @property
    def completed_groups(self) -> int:
        """Number of completed groups."""
        return sum(1 for group in self.groups if group.status == GroupStatus.COMPLETED)

    def calculate_progress(self) -> float:
        """Calculate and update progress percentage based on completed items."""
        if self.total_items == 0:
            self.progress_percentage = 0.0
        else:
            self.progress_percentage = (self.completed_items / self.total_items) * 100.0
        return self.progress_percentage


# =============================================================================
# Plan Builder Terminology Aliases
# =============================================================================
# These aliases provide user-friendly naming that maps to the underlying
# progress tracking types. Use these when building plan templates.
#
# Mapping:
#   State -> ProgressGroup (a phase or stage in the conversation)
#   Task -> ProgressItem (an individual task within a state)
#   Deliverable -> ProgressItem with data collection focus
# =============================================================================

# Type aliases for Plan Builder terminology
PlanState = ProgressGroup
"""A state (phase) in a plan. Alias for ProgressGroup."""

PlanTask = ProgressItem
"""A task within a state. Alias for ProgressItem."""

PlanDeliverable = ProgressItem
"""A deliverable (data to collect) within a task. Alias for ProgressItem."""


def create_state(
    id: str,
    label: str,
    execution_mode: ExecutionMode = ExecutionMode.FLEXIBLE,
    tasks: Optional[List[ProgressItem]] = None,
    description: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> ProgressGroup:
    """
    Create a state (phase) for a plan template.

    A state represents a logical phase in the conversation, such as
    "Introduction", "Information Gathering", or "Wrap-up".

    Args:
        id: Unique identifier for this state.
        label: Human-readable label for display.
        execution_mode: How tasks should be executed (SEQUENTIAL or FLEXIBLE).
        tasks: List of tasks within this state.
        description: Optional description of this state's purpose.
        metadata: Additional state-specific data.

    Returns:
        A ProgressGroup configured as a plan state.

    Example:
        >>> intake_state = create_state(
        ...     id="intake",
        ...     label="Patient Intake",
        ...     execution_mode=ExecutionMode.FLEXIBLE,
        ...     tasks=[
        ...         create_task("name", "Patient Name"),
        ...         create_task("dob", "Date of Birth"),
        ...     ],
        ...     description="Collect basic patient information"
        ... )
    """
    return ProgressGroup(
        id=id,
        label=label,
        execution_mode=execution_mode,
        items=tasks or [],
        description=description,
        metadata=metadata or {},
    )


def create_task(
    id: str,
    label: str,
    description: Optional[str] = None,
    required: bool = True,
    metadata: Optional[Dict[str, Any]] = None,
) -> ProgressItem:
    """
    Create a task for a plan state.

    A task represents an individual action item within a state, such as
    "Collect patient name" or "Verify insurance information".

    Args:
        id: Unique identifier for this task.
        label: Human-readable label for display.
        description: Optional detailed description or instructions.
        required: Whether this task must be completed (default: True).
        metadata: Additional task-specific data.

    Returns:
        A ProgressItem configured as a plan task.

    Example:
        >>> name_task = create_task(
        ...     id="patient_name",
        ...     label="Patient Name",
        ...     description="Collect the patient's full legal name",
        ...     required=True
        ... )
    """
    return ProgressItem(
        id=id,
        label=label,
        description=description,
        required=required,
        metadata=metadata or {},
    )


def create_deliverable(
    id: str,
    label: str,
    data_type: str = "string",
    description: Optional[str] = None,
    required: bool = True,
    enum_values: Optional[List[str]] = None,
) -> ProgressItem:
    """
    Create a deliverable (data collection point) for a plan.

    A deliverable represents a specific piece of data to collect, such as
    a name, date, or selection from a list of options.

    Args:
        id: Unique identifier for this deliverable.
        label: Human-readable label for display.
        data_type: Type of data to collect ("string", "number", "boolean", "enum").
        description: Optional description of what data to collect.
        required: Whether this deliverable must be collected (default: True).
        enum_values: For enum type, the list of valid values.

    Returns:
        A ProgressItem configured as a plan deliverable.

    Example:
        >>> insurance_type = create_deliverable(
        ...     id="insurance_type",
        ...     label="Insurance Type",
        ...     data_type="enum",
        ...     enum_values=["Private", "Medicare", "Medicaid", "None"],
        ...     required=True
        ... )
    """
    metadata: Dict[str, Any] = {"data_type": data_type}
    if enum_values:
        metadata["enum_values"] = enum_values

    return ProgressItem(
        id=id,
        label=label,
        description=description,
        required=required,
        metadata=metadata,
    )
