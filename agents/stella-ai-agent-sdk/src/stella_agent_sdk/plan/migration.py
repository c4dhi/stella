"""
Plan Format Migration Utilities

Provides backward compatibility by detecting and converting
legacy frontend format plans to the canonical agent format.

Frontend format (legacy):
- State: label, execution_mode (sequential/flexible)
- Task: label, description
- Deliverable: id, label, description, enumValues

Agent format (canonical):
- State: title, type (strict/loose)
- Task: description, instruction
- Deliverable: key, description, acceptance_criteria, enum_values
"""

from typing import Dict, Any, Literal, List
from stella_agent_sdk.plan.types import Plan


def detect_format(plan_data: Dict[str, Any]) -> Literal["frontend", "agent", "unknown"]:
    """Detect if plan uses frontend or agent format.

    Examines state and task fields to determine the format version.

    Args:
        plan_data: Raw plan dictionary

    Returns:
        "frontend" - Legacy frontend format (label, execution_mode)
        "agent" - Canonical agent format (title, type)
        "unknown" - Cannot determine format
    """
    if not plan_data:
        return "unknown"

    states = plan_data.get("states", [])
    if not states:
        return "unknown"

    first_state = states[0] if isinstance(states, list) and len(states) > 0 else {}

    # Check for frontend-specific fields
    if "label" in first_state or "execution_mode" in first_state:
        return "frontend"

    # Check for agent-specific fields
    if "title" in first_state or "type" in first_state:
        return "agent"

    # Check task fields
    tasks = first_state.get("tasks", [])
    if tasks:
        first_task = tasks[0] if isinstance(tasks, list) and len(tasks) > 0 else {}
        # Frontend uses 'label' for task name, agent uses 'description'
        if "label" in first_task and "description" not in first_task:
            return "frontend"
        if "instruction" in first_task:
            return "agent"

    return "unknown"


def _migrate_deliverable(d: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a deliverable from frontend to agent format.

    Mapping:
    - id -> key
    - label -> description
    - description -> acceptance_criteria
    - enumValues -> enum_values
    """
    return {
        "key": d.get("id", d.get("key", "")),
        "type": d.get("type", "string"),
        "description": d.get("label", d.get("description", "")),
        "required": d.get("required", True),
        "acceptance_criteria": d.get("description", d.get("acceptance_criteria", "")),
        "examples": d.get("examples", []),
        "enum_values": d.get("enumValues", d.get("enum_values")),
    }


def _migrate_task(t: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a task from frontend to agent format.

    Mapping:
    - label -> description
    - description -> instruction
    """
    deliverables = t.get("deliverables", [])
    return {
        "id": t.get("id", ""),
        "description": t.get("label", t.get("description", "")),
        "instruction": t.get("description", t.get("instruction", "")),
        "required": t.get("required", True),
        "deliverables": [_migrate_deliverable(d) for d in deliverables],
    }


def _migrate_state(s: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a state from frontend to agent format.

    Mapping:
    - label -> title
    - execution_mode: sequential/flexible -> type: strict/loose
    """
    # Map execution_mode to type
    execution_mode = s.get("execution_mode", s.get("type", "loose"))
    type_map = {"sequential": "strict", "flexible": "loose", "goal": "goal"}
    state_type = type_map.get(execution_mode, execution_mode if execution_mode in ("strict", "loose", "goal") else "loose")

    tasks = s.get("tasks", [])
    transitions = s.get("transitions", [])

    result = {
        "id": s.get("id", ""),
        "title": s.get("label", s.get("title", "")),
        "type": state_type,
        "description": s.get("description", ""),
        "tasks": [_migrate_task(t) for t in tasks],
        "transitions": transitions,  # Transitions format is unchanged
    }

    # Preserve goal context for goal-type states
    if s.get("goal"):
        result["goal"] = s["goal"]

    return result


def migrate_frontend_to_agent(plan_data: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a complete plan from frontend to agent format.

    This is a pure data transformation that converts field names
    from the legacy frontend format to the canonical agent format.

    Args:
        plan_data: Plan in frontend format

    Returns:
        Plan data in canonical agent format
    """
    states = plan_data.get("states", [])
    migrated_states = [_migrate_state(s) for s in states]

    # Determine initial_state_id
    initial_state_id = plan_data.get("initial_state_id", "")
    if not initial_state_id and migrated_states:
        initial_state_id = migrated_states[0].get("id", "")

    return {
        "id": plan_data.get("id", plan_data.get("name", "plan")),
        "title": plan_data.get("name", plan_data.get("title", "Conversation Plan")),
        "description": plan_data.get("description", ""),
        "initial_state_id": initial_state_id,
        "states": migrated_states,
        "metadata": plan_data.get("metadata", {}),
        "system_prompt": plan_data.get("systemPrompt", plan_data.get("system_prompt")),
        "session_context": plan_data.get("sessionContext", plan_data.get("session_context")),
    }


def _ensure_required_fields(plan_data: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure required top-level fields exist with sensible defaults.

    The Plan model requires 'id' and 'title' fields. This function
    adds defaults if they're missing (common when plans come directly
    from frontend without a name wrapper).

    Args:
        plan_data: Plan dictionary that may be missing required fields

    Returns:
        Plan data with required fields guaranteed to exist
    """
    result = dict(plan_data)

    # Ensure 'id' exists
    if "id" not in result:
        result["id"] = result.get("name", "plan")

    # Ensure 'title' exists
    if "title" not in result:
        result["title"] = result.get("name", "Conversation Plan")

    # Ensure initial_state_id exists
    if "initial_state_id" not in result:
        states = result.get("states", [])
        if states and isinstance(states, list) and len(states) > 0:
            result["initial_state_id"] = states[0].get("id", "")

    return result


def normalize_plan(plan_data: Dict[str, Any]) -> Plan:
    """Load a plan from any format, returning a canonical Pydantic model.

    This function handles backward compatibility by:
    1. Detecting the format of the input data
    2. Migrating to agent format if necessary
    3. Ensuring required fields exist with defaults
    4. Validating and returning a Plan model

    Args:
        plan_data: Raw plan dictionary in any supported format

    Returns:
        Plan: Validated Plan Pydantic model

    Raises:
        ValidationError: If the plan data is invalid
    """
    format_type = detect_format(plan_data)

    if format_type == "frontend":
        plan_data = migrate_frontend_to_agent(plan_data)

    # Always ensure required fields exist (even for "agent" format)
    plan_data = _ensure_required_fields(plan_data)

    return Plan.model_validate(plan_data)
