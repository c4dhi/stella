"""Template compiler: resolves {{placeholder}} tokens in expert system prompts.

Before an expert LLM call, the system prompt is scanned for {{name}} tokens.
Each token is replaced with the corresponding runtime value from the state machine
context. This allows any expert (built-in or custom) to opt into any context
by simply including the placeholder in its system prompt.

Available placeholders:
  {{plan}}                    Full plan (all states, tasks, deliverables)
  {{current_focus}}           Active task + pending deliverables with acceptance criteria
  {{pending_deliverables}}    Pending deliverables list with required/optional flags
  {{collected_deliverables}}  Already collected deliverable keys
  {{turns_without_progress}}  Counter since last deliverable was collected
  {{current_state}}           Current state name + description + processing mode
  {{progress_percentage}}     Overall progress percentage
  {{processing_mode}}         Processing mode (sequential/flexible)
  {{history_N}}               Last N messages from conversation (e.g. {{history_10}})
  {{user_message}}            The current user message

Unknown placeholders are left as-is to avoid silently breaking prompts.
"""

import re
from typing import Dict, Any, List, Optional


# Matches both simple {{name}} and parameterized {{history_10}} placeholders
PLACEHOLDER_PATTERN = re.compile(r"\{\{(\w+)\}\}")
HISTORY_PATTERN = re.compile(r"\{\{history_(\d+)\}\}")


# ---------------------------------------------------------------------------
# Placeholder resolvers — each takes sm_context and returns a string
# ---------------------------------------------------------------------------


def _resolve_plan(ctx: Dict[str, Any]) -> str:
    """Full plan: all states, tasks, deliverables with completion status."""
    full_plan = ctx.get("full_plan", [])
    if not full_plan:
        return _resolve_plan_legacy(ctx)

    parts: List[str] = ["=== FULL PLAN (extract deliverables from current state only) ==="]
    current_task_info = ctx.get("current_task")

    for state in full_plan:
        marker = " ← CURRENT" if state.get("is_current") else ""
        parts.append(f"\n## {state['title']}{marker}")

        for task in state.get("tasks", []):
            task_status = task.get("status", "pending")
            is_active = current_task_info and task.get("id") == current_task_info.get("id")
            task_marker = " ← ACTIVE TASK" if is_active else ""
            parts.append(f"  Task: {task['description']} ({task_status}){task_marker}")

            for d in task.get("deliverables", []):
                status = d.get("status", "pending")
                req = "required" if d.get("required") else "optional"
                dtype = d.get("type", "string")

                if status == "completed":
                    parts.append(f"    ✓ {d['key']} = {d.get('value', '?')}")
                else:
                    parts.append(f"    ○ {d['key']} [{dtype}, {req}]: {d.get('description', '')}")

            if not task.get("has_deliverables"):
                parts.append("    (no deliverables — mark completed when performed)")

    return "\n".join(parts)


def _resolve_plan_legacy(ctx: Dict[str, Any]) -> str:
    """Fallback plan using only current state deliverables."""
    parts: List[str] = []
    deliverables = ctx.get("deliverables", [])
    pending = [d for d in deliverables if d.get("status") == "pending"]
    completed = [d for d in deliverables if d.get("status") == "completed"]

    if pending:
        parts.append("PENDING DELIVERABLES:")
        for d in pending:
            line = f"- {d['key']} ({d.get('type', 'string')}, {'required' if d.get('required') else 'optional'}): {d.get('description', '')}"
            criteria = d.get("acceptance_criteria", "")
            if criteria:
                line += f"\n  Acceptance: {criteria}"
            examples = d.get("examples", [])
            if examples:
                line += f"\n  Examples: {', '.join(str(e) for e in examples)}"
            parts.append(line)

    if completed:
        parts.append("\nCOMPLETED DELIVERABLES:")
        for d in completed:
            parts.append(f"- {d['key']}: {d.get('value', '?')}")

    return "\n".join(parts) if parts else "No plan data available."


def _resolve_current_focus(ctx: Dict[str, Any]) -> str:
    """Active task + pending deliverables with acceptance criteria."""
    full_plan = ctx.get("full_plan", [])
    current_state_info = ctx.get("state", {})
    current_task_info = ctx.get("current_task")
    mode = ctx.get("processing_mode", "loose")

    parts: List[str] = ["=== CURRENT FOCUS ==="]
    parts.append(f"State: {current_state_info.get('title', '?')}")
    if current_state_info.get("description"):
        parts.append(f"Goal: {current_state_info['description']}")
    if mode == 'goal':
        parts.append("Mode: goal-oriented (natural conversation toward objective)")
    elif mode == 'strict':
        parts.append("Mode: sequential (one task at a time)")
    else:
        parts.append("Mode: flexible (any order)")

    # Render goal context when in goal mode
    if mode == 'goal':
        goal_obj = current_state_info.get("goal_objective")
        if goal_obj:
            parts.append(f"Objective: {goal_obj}")
        goal_ctx = current_state_info.get("goal_context")
        if goal_ctx:
            parts.append(f"Context: {goal_ctx}")
        goal_bounds = current_state_info.get("goal_boundaries")
        if goal_bounds:
            parts.append(f"Boundaries: {goal_bounds}")
        goal_success = current_state_info.get("goal_success_description")
        if goal_success:
            parts.append(f"Success looks like: {goal_success}")

    if current_task_info:
        parts.append(f"Active task: {current_task_info.get('description', '?')}")
        if current_task_info.get("instruction"):
            parts.append(f"Instruction: {current_task_info['instruction']}")

    # Show current state's pending deliverables with full detail
    current_state_id = current_state_info.get("id", "")
    current_plan_state = next((s for s in full_plan if s.get("id") == current_state_id), None)
    if current_plan_state:
        pending_in_current = []
        for task in current_plan_state.get("tasks", []):
            for d in task.get("deliverables", []):
                if d.get("status") == "pending":
                    pending_in_current.append(d)

        if pending_in_current:
            parts.append("")
            parts.append("PRIORITY — extract these if the user provided them:")
            for d in pending_in_current:
                req = "required" if d.get("required") else "optional"
                line = f"  ○ {d['key']} [{d.get('type', 'string')}, {req}]: {d.get('description', '')}"
                criteria = d.get("acceptance_criteria", "")
                if criteria:
                    line += f" (criteria: {criteria})"
                examples = d.get("examples", [])
                if examples:
                    line += f" (e.g. {', '.join(str(e) for e in examples)})"
                parts.append(line)

    return "\n".join(parts)


def _resolve_pending_deliverables(ctx: Dict[str, Any]) -> str:
    """Pending deliverables list with required/optional flags."""
    deliverables = ctx.get("deliverables", [])
    pending = [d for d in deliverables if d.get("status") == "pending"]

    if not pending:
        return "No pending deliverables."

    parts = ["PENDING DELIVERABLES (signal if user provided any):"]
    for d in pending:
        req_label = "REQUIRED" if d.get("required") else "OPTIONAL"
        parts.append(f"- {d['key']} [{req_label}]: {d.get('description', '')}")

    return "\n".join(parts)


def _resolve_collected_deliverables(ctx: Dict[str, Any]) -> str:
    """Already collected deliverable keys and values."""
    deliverables = ctx.get("deliverables", [])
    completed = [d for d in deliverables if d.get("status") == "completed"]

    if not completed:
        return "Already collected: nothing yet"
    return "Already collected: " + ", ".join(d["key"] for d in completed)


def _resolve_turns_without_progress(ctx: Dict[str, Any]) -> str:
    """Turns without deliverable progress counter."""
    turns = ctx.get("progress", {}).get("turns_without_deliverable", 0)
    return f"TURNS WITHOUT PROGRESS: {turns}"


def _resolve_current_state(ctx: Dict[str, Any]) -> str:
    """Current state name, description, and processing mode."""
    state = ctx.get("state", {})
    mode = ctx.get("processing_mode", "loose")

    parts = [f"Current state: {state.get('title', '?')}"]
    if state.get("description"):
        parts.append(f"Goal: {state['description']}")

    if mode == 'goal':
        parts.append("Mode: goal-oriented")
        goal_obj = state.get("goal_objective")
        if goal_obj:
            parts.append(f"Objective: {goal_obj}")
        goal_ctx = state.get("goal_context")
        if goal_ctx:
            parts.append(f"Context: {goal_ctx}")
        goal_bounds = state.get("goal_boundaries")
        if goal_bounds:
            parts.append(f"Boundaries: {goal_bounds}")
        goal_success = state.get("goal_success_description")
        if goal_success:
            parts.append(f"Success looks like: {goal_success}")
    elif mode == 'strict':
        parts.append("Mode: sequential")
    else:
        parts.append("Mode: flexible")

    return "\n".join(parts)


def _resolve_progress_percentage(ctx: Dict[str, Any]) -> str:
    """Overall progress percentage."""
    pct = ctx.get("progress", {}).get("percentage", 0)
    return f"Overall progress: {pct:.0f}%"


def _resolve_processing_mode(ctx: Dict[str, Any]) -> str:
    """Processing mode (sequential/flexible)."""
    mode = ctx.get("processing_mode", "loose")
    return "sequential (one task at a time)" if mode == "strict" else "flexible (any order)"


def _resolve_history(ctx: Dict[str, Any], count: int) -> str:
    """Last N messages from conversation history."""
    history = ctx.get("_conversation_history", [])
    if not history:
        return "CONVERSATION:\n(no messages yet)"

    recent = history[-count:]
    lines = [f"[{msg['role'].upper()}]: {msg['content']}" for msg in recent]
    return "CONVERSATION:\n" + "\n".join(lines)


def _resolve_user_message(ctx: Dict[str, Any]) -> str:
    """The current user message."""
    user_input = ctx.get("_user_input", "")
    return f"CURRENT USER MESSAGE: {user_input}"



# ---------------------------------------------------------------------------
# Registry (simple placeholders only — history_N is handled separately)
# ---------------------------------------------------------------------------

PLACEHOLDER_REGISTRY: Dict[str, Any] = {
    "plan": _resolve_plan,
    "current_focus": _resolve_current_focus,
    "pending_deliverables": _resolve_pending_deliverables,
    "collected_deliverables": _resolve_collected_deliverables,
    "turns_without_progress": _resolve_turns_without_progress,
    "current_state": _resolve_current_state,
    "progress_percentage": _resolve_progress_percentage,
    "processing_mode": _resolve_processing_mode,
    "user_message": _resolve_user_message,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compile_prompt(template: str, sm_context: Optional[Dict[str, Any]] = None) -> str:
    """Replace {{placeholder}} tokens in a prompt with resolved runtime values.

    Handles both simple {{name}} and parameterized {{history_N}} placeholders.

    Args:
        template: The system prompt template containing {{placeholder}} tokens.
        sm_context: State machine context providing runtime values.

    Returns:
        The compiled prompt with placeholders replaced.
    """
    if not template or "{{" not in template:
        return template

    if not sm_context:
        return PLACEHOLDER_PATTERN.sub("[no context available]", template)

    # First pass: resolve parameterized {{history_N}} placeholders
    def history_replacer(match: re.Match) -> str:
        count = int(match.group(1))
        return _resolve_history(sm_context, count)

    result = HISTORY_PATTERN.sub(history_replacer, template)

    # Second pass: resolve simple {{name}} placeholders
    def replacer(match: re.Match) -> str:
        name = match.group(1)
        resolver = PLACEHOLDER_REGISTRY.get(name)
        if resolver is None:
            return match.group(0)  # Unknown placeholder — leave as-is
        return resolver(sm_context)

    return PLACEHOLDER_PATTERN.sub(replacer, result)


def has_user_message_placeholder(template: str) -> bool:
    """Check if template contains {{user_message}}."""
    return "{{user_message}}" in template if template else False


