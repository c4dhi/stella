"""System prompt for the Input Gate stage.

The Input Gate classifies user input and selects which experts to activate.
Returns structured JSON — no SAFE/UNSAFE routing in V2.
"""

from typing import Dict, Any, List, Optional


def build_input_gate_system_prompt(
    available_experts: List[Dict[str, str]],
    sm_context: Dict[str, Any],
    custom_system_prompt: Optional[str] = None,
) -> str:
    """Build the Input Gate system prompt.

    Args:
        available_experts: List of dicts with "name" and "description" for each expert.
        sm_context: State machine context (current state, tasks, deliverables).
        custom_system_prompt: Optional custom system prompt from Agent Configurator.

    Returns:
        Complete system prompt string for the Input Gate LLM call.
    """
    # Exclude always-run experts (task_extraction runs every turn regardless)
    # Also exclude always_triggered experts (they bypass the gate entirely)
    gate_experts = [
        e for e in available_experts
        if e["name"] != "task_extraction" and not e.get("always_triggered", False)
    ]
    expert_list = "\n".join(
        f"  - {e['name']}: {e['description']}" for e in gate_experts
    )

    # Build rules from per-expert trigger_criteria if available
    rules_section = _build_rules_from_criteria(gate_experts)

    state_info = _build_state_info(sm_context)

    if custom_system_prompt:
        return f"""{custom_system_prompt}

EXPERTS:
{expert_list}

{rules_section}
{state_info}

Respond with JSON only: {{"experts": ["name1", "name2"]}}"""

    return f"""You are a routing classifier. Select which expert modules to activate for this message.

EXPERTS:
{expert_list}

{rules_section}
{state_info}

Respond with JSON only: {{"experts": ["name1", "name2"]}}"""


def _build_rules_from_criteria(gate_experts: List[Dict[str, str]]) -> str:
    """Build RULES section from per-expert trigger_criteria.

    If experts have trigger_criteria, auto-generate rules from them.
    Falls back to hardcoded rules for backward compatibility.
    """
    # Check if any experts have trigger_criteria set
    has_criteria = any(e.get("trigger_criteria") for e in gate_experts)

    if has_criteria:
        rules = []
        for i, e in enumerate(gate_experts, 1):
            criteria = e.get("trigger_criteria") or e.get("description", "")
            rules.append(f'{i}. Include "{e["name"]}" if: {criteria}')
        rules.append(f"{len(gate_experts) + 1}. Select multiple experts if needed — they run in parallel.")
        return "RULES:\n" + "\n".join(rules)

    # Fallback: hardcoded rules for backward compatibility
    return """RULES:
1. Include "noise_detection" if the message seems garbled or inaudible.
2. Include "medical" if health topics are mentioned.
3. Include "legal" if legal topics are mentioned.
4. Include "probing" if clarification might be needed.
5. Include "timekeeper" if the conversation seems stuck (many turns without progress).
6. Select multiple experts if needed — they run in parallel."""


def _build_state_info(sm_context: Dict[str, Any]) -> str:
    """Build state context section from state machine context."""
    if not sm_context:
        return ""

    state_info = ""
    state = sm_context.get("state", {})
    if state:
        state_info = f"\nCurrent conversation state: {state.get('title', 'Unknown')}"
        state_info += f"\nState description: {state.get('description', '')}"
    mode = sm_context.get("processing_mode", "")
    if mode:
        state_info += f"\nProcessing mode: {mode}"

    deliverables = sm_context.get("deliverables", [])
    pending = [d for d in deliverables if d.get("status") == "pending"]
    if pending:
        state_info += "\nPending deliverables to collect:"
        for d in pending:
            state_info += f"\n  - {d['key']} ({d['type']}): {d['description']}"

    progress = sm_context.get("progress", {})
    turns_stuck = progress.get("turns_without_deliverable", 0)
    if turns_stuck > 0:
        state_info += f"\nConversation progress: {turns_stuck} turn(s) without collecting any deliverable"

    return state_info


def build_input_gate_user_message(
    user_input: str,
    conversation_history: List[Dict[str, str]],
    history_limit: int = 2,
) -> str:
    """Build the user message for the Input Gate.

    Args:
        user_input: The current user message.
        conversation_history: Recent conversation messages.
        history_limit: Number of recent messages to include (default: 2).

    Returns:
        Formatted user message string.
    """
    history_text = ""
    if conversation_history:
        recent = conversation_history[-history_limit:]
        lines = [f"[{msg['role'].upper()}]: {msg['content']}" for msg in recent]
        history_text = "CONTEXT:\n" + "\n".join(lines) + "\n\n"

    return f"""{history_text}MESSAGE: {user_input}"""
