"""
Generic progress tracking types for conversational AI agents.

This module provides a flexible schema for tracking agent progress through
tasks, goals, or conversation flows. It's designed to be agent-agnostic
while supporting common patterns like:

- Sequential task flows (must complete in order)
- Flexible task flows (agent decides order based on conversation)
- Nested task groups with different execution modes
- Deliverable/data collection tracking
- Time machine / history replay support

Example usage:

    from grace_agent_sdk.progress import (
        ProgressState, ProgressGroup, ProgressItem,
        ExecutionMode, ItemStatus, GroupStatus
    )

    # Create a flexible group where agent can ask questions in any order
    intake_group = ProgressGroup(
        id="intake",
        label="Patient Intake",
        execution_mode=ExecutionMode.FLEXIBLE,
        items=[
            ProgressItem(id="name", label="Patient Name", status=ItemStatus.PENDING),
            ProgressItem(id="dob", label="Date of Birth", status=ItemStatus.PENDING),
            ProgressItem(id="symptoms", label="Current Symptoms", status=ItemStatus.PENDING),
        ]
    )

    # Create a sequential group for compliance
    consent_group = ProgressGroup(
        id="consent",
        label="Consent & Disclosures",
        execution_mode=ExecutionMode.SEQUENTIAL,
        items=[
            ProgressItem(id="privacy", label="Privacy Notice", status=ItemStatus.PENDING),
            ProgressItem(id="consent", label="Treatment Consent", status=ItemStatus.PENDING),
        ]
    )

    # Build complete state
    state = ProgressState(
        groups=[intake_group, consent_group],
        current_group_id="intake",
    )

    # Send to frontend
    yield AgentOutput.progress_update(session_id, state)
"""

from grace_agent_sdk.progress.types import (
    ExecutionMode,
    ItemStatus,
    GroupStatus,
    ProgressItem,
    ProgressGroup,
    ProgressState,
)

__all__ = [
    "ExecutionMode",
    "ItemStatus",
    "GroupStatus",
    "ProgressItem",
    "ProgressGroup",
    "ProgressState",
]
