"""
Plan Types Module

Canonical type definitions for STELLA conversation plans.
This is the single source of truth for plan structures across
the entire STELLA platform (SDK, agents, frontend, backend).

All consumers should import from this module:
- Python agents: from stella_agent_sdk.plan import Plan, PlanState, ...
- Frontend/Backend: Use corresponding TypeScript definitions that mirror these types
"""

from stella_agent_sdk.plan.types import (
    # Enums
    StateType,
    DeliverableType,
    # Plan structure types
    PlanDeliverable,
    PlanTask,
    StateTransition,
    StateGoal,
    PlanState,
    Plan,
    # Session context types
    SessionContextField,
    SessionContext,
)

from stella_agent_sdk.plan.migration import (
    detect_format,
    migrate_frontend_to_agent,
    normalize_plan,
)

__all__ = [
    # Enums
    "StateType",
    "DeliverableType",
    # Plan structure types
    "PlanDeliverable",
    "PlanTask",
    "StateTransition",
    "StateGoal",
    "PlanState",
    "Plan",
    # Session context types
    "SessionContextField",
    "SessionContext",
    # Migration utilities
    "detect_format",
    "migrate_frontend_to_agent",
    "normalize_plan",
]
