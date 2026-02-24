"""Base class for prompt components.

Defines the interface for modular prompt components that can be
composed to build dynamic system prompts.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any


class PromptComponent(ABC):
    """Base class for prompt components.

    Each component renders a portion of the system prompt
    based on the provided context.
    """

    @abstractmethod
    def render(self, context: Dict[str, Any]) -> str:
        """Render this component to a string.

        Args:
            context: Dictionary with state machine context and other info.

        Returns:
            Rendered prompt component string.
        """

    @property
    @abstractmethod
    def name(self) -> str:
        """Component name for identification."""

    def should_include(self, context: Dict[str, Any]) -> bool:
        """Check if this component should be included.

        Override in subclasses for conditional inclusion.
        Default is to always include.
        """
        return True
