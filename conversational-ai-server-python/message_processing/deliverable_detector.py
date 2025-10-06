"""
Simplified deliverable detection that primarily trusts LLM intelligence.
The LLM now handles the main detection logic, this is just a lightweight fallback validator.
"""
from typing import Dict, List, Any, Optional, Tuple
from .plan_models import Deliverable, DeliverableType, DeliverableStatus


class DeliverableDetector:
    """Simplified deliverable detector that trusts LLM detection primarily."""

    def __init__(self):
        """Initialize simplified deliverable detector."""
        pass  # No complex patterns needed anymore

    def detect_deliverables(self, user_message: str, deliverables: List[Deliverable]) -> List[Tuple[str, Any, float]]:
        """
        Legacy method kept for compatibility - now returns empty list.
        LLM handles detection directly in InputGate.

        Args:
            user_message: The user's message text
            deliverables: List of deliverables to check

        Returns:
            Empty list - detection happens in LLM now
        """
        # LLM handles detection now, this is just a fallback
        return []

    def validate_deliverable(self, key: str, value: Any, deliverable: Deliverable) -> bool:
        """
        Basic validation for deliverable values.
        Trusts LLM judgment primarily, just checks for empty values.

        Args:
            key: Deliverable key
            value: Value to validate
            deliverable: Deliverable definition

        Returns:
            True if value is non-empty and reasonable
        """
        # Just check it's not empty
        if not value:
            return False

        if isinstance(value, str):
            # Check string is not empty after stripping
            if not value.strip():
                return False
            # Very basic length check
            if len(value) > 1000:  # Unreasonably long
                return False

        # Trust the LLM's evaluation for everything else
        return True

    def should_accept_deliverable(self, deliverable: Deliverable, value: Any, confidence: float) -> bool:
        """
        Determine if a detected deliverable value should be accepted.
        Now mainly trusts confidence scores from LLM detection.

        Args:
            deliverable: The deliverable
            value: Detected value
            confidence: Detection confidence (0.95 for LLM detection)

        Returns:
            True if the deliverable should be accepted
        """
        # High confidence from LLM detection (0.95) always accepted
        if confidence >= 0.9:
            return self.validate_deliverable(deliverable.key, value, deliverable)

        # Lower confidence might come from legacy pattern matching (if any)
        # Still validate but with lower threshold
        if confidence >= 0.5:
            return self.validate_deliverable(deliverable.key, value, deliverable)

        return False

    def get_deliverable_confidence_threshold(self, deliverable: Deliverable) -> float:
        """
        Get the minimum confidence threshold for a deliverable.
        Lower thresholds now since LLM detection is more reliable.

        Args:
            deliverable: The deliverable to check

        Returns:
            Confidence threshold (0.0 to 1.0)
        """
        # Lower thresholds since LLM is doing the heavy lifting
        if deliverable.required:
            return 0.5  # Was 0.7
        else:
            return 0.3  # Was 0.5