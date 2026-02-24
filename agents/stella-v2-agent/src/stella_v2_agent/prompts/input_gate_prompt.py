"""System prompt for the Input Gate stage.

The Input Gate classifies user input and selects which experts to activate.
Returns structured JSON — no SAFE/UNSAFE routing in V2.
"""

from typing import Dict, Any, List


def build_input_gate_system_prompt(
    available_experts: List[Dict[str, str]],
    sm_context: Dict[str, Any],
) -> str:
    """Build the Input Gate system prompt.

    Args:
        available_experts: List of dicts with "name" and "description" for each expert.
        sm_context: State machine context (current state, tasks, deliverables).

    Returns:
        Complete system prompt string for the Input Gate LLM call.
    """
    # Exclude always-run experts (task_extraction runs every turn regardless)
    gate_experts = [e for e in available_experts if e["name"] != "task_extraction"]
    expert_list = "\n".join(
        f"  - {e['name']}: {e['description']}" for e in gate_experts
    )

    state_info = ""
    if sm_context:
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

    return f"""You are a routing classifier. Select which expert modules to activate for this message.

EXPERTS:
{expert_list}

RULES:
1. Include "noise_detection" if the message seems garbled or inaudible.
2. Include "medical" if health topics are mentioned.
3. Include "legal" if legal topics are mentioned.
4. Include "probing" if clarification might be needed.
5. Include "timekeeper" if the conversation seems stuck (many turns without progress).
6. Select multiple experts if needed — they run in parallel.
{state_info}

Respond with JSON only: {{"experts": ["name1", "name2"]}}"""


def build_input_gate_user_message(
    user_input: str,
    conversation_history: List[Dict[str, str]],
) -> str:
    """Build the user message for the Input Gate.

    Args:
        user_input: The current user message.
        conversation_history: Recent conversation messages.

    Returns:
        Formatted user message string.
    """
    history_text = ""
    if conversation_history:
        # Only last 2 messages needed for routing context
        recent = conversation_history[-2:]
        lines = [f"[{msg['role'].upper()}]: {msg['content']}" for msg in recent]
        history_text = "CONTEXT:\n" + "\n".join(lines) + "\n\n"

    return f"""{history_text}MESSAGE: {user_input}"""
