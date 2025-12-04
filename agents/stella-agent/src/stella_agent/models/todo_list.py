"""Todo list data models for Stella Agent.

Defines structures for outputting the current state of tasks
and deliverables as a todo list via debug messages.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime


@dataclass
class TodoItem:
    """A single todo item for the todo list output.

    Represents either a task or a deliverable in a flat list format
    suitable for display or transmission.
    """
    id: str
    title: str
    status: str  # "pending", "in_progress", "completed", "skipped"
    type: str  # "task", "deliverable"
    parent_id: Optional[str] = None  # task_id for deliverables
    value: Optional[Any] = None
    reasoning: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "type": self.type,
            "parent_id": self.parent_id,
            "value": self.value,
            "reasoning": self.reasoning
        }


@dataclass
class TodoListState:
    """Complete todo list state for debug output.

    Provides a snapshot of the current plan execution state,
    including all tasks, deliverables, and progress information.
    """
    plan_id: str
    plan_title: str
    current_state_id: str
    current_state_title: str
    processing_mode: str  # "strict" or "loose"
    progress_percentage: float
    turns_without_deliverable: int
    items: List[TodoItem] = field(default_factory=list)
    completed_deliverables: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for debug metadata."""
        return {
            "plan_id": self.plan_id,
            "plan_title": self.plan_title,
            "current_state_id": self.current_state_id,
            "current_state_title": self.current_state_title,
            "processing_mode": self.processing_mode,
            "progress_percentage": self.progress_percentage,
            "turns_without_deliverable": self.turns_without_deliverable,
            "items": [item.to_dict() for item in self.items],
            "completed_deliverables": self.completed_deliverables,
            "timestamp": self.timestamp
        }

    @property
    def total_items(self) -> int:
        """Get total number of items."""
        return len(self.items)

    @property
    def completed_items(self) -> int:
        """Get number of completed items."""
        return sum(1 for item in self.items if item.status == "completed")

    @property
    def pending_items(self) -> int:
        """Get number of pending items."""
        return sum(1 for item in self.items if item.status == "pending")

    def get_items_by_type(self, item_type: str) -> List[TodoItem]:
        """Get items filtered by type."""
        return [item for item in self.items if item.type == item_type]

    def get_items_by_status(self, status: str) -> List[TodoItem]:
        """Get items filtered by status."""
        return [item for item in self.items if item.status == status]
