"""System prompt builder for the Response Generator stage.

Composes the final system prompt from:
- Base persona and conversation guidelines
- State machine context (current state, tasks, deliverables)
- Arbitration directive (injected expert guidance)
- Optional custom system prompt from the plan
"""

from typing import Dict, Any, List, Optional

from stella_v2_agent.models.arbitration_result import ResponseDirective


def build_response_system_prompt(
    sm_context: Dict[str, Any],
    directive: ResponseDirective,
    plan_system_prompt: Optional[str] = None,
    custom_persona: Optional[str] = None,
    custom_guidelines: Optional[str] = None,
) -> str:
    """Build the complete system prompt for the Response Generator.

    Args:
        sm_context: State machine context for conversation awareness.
        directive: Arbitration directive with expert guidance.
        plan_system_prompt: Optional custom system prompt from the plan.
        custom_persona: Optional custom persona from Agent Configurator.
        custom_guidelines: Optional custom guidelines from Agent Configurator.

    Returns:
        Complete system prompt string.
    """
    sections: List[str] = []

    # 1. Base persona
    # Plan provides the primary persona at runtime.
    # Configurator persona is APPENDED after the plan persona (additional instructions).
    # If no plan, configurator persona is the sole persona.
    # If neither, fall back to hardcoded default.
    if plan_system_prompt and custom_persona:
        sections.append(plan_system_prompt)
        sections.append(custom_persona)
    elif plan_system_prompt:
        sections.append(plan_system_prompt)
    elif custom_persona:
        sections.append(custom_persona)
    else:
        sections.append(_default_persona())

    # 2. Conversation guidelines (priority: configurator > default)
    if custom_guidelines:
        sections.append(custom_guidelines)
    else:
        sections.append(_conversation_guidelines())

    # 3. Arbitration directive (expert guidance) — placed BEFORE state context
    #    so the LLM reads it first and treats it as a priority instruction.
    directive_section = directive.to_prompt_section()
    if directive_section:
        sections.append(directive_section)

    # 4. State machine context
    sm_section = _state_machine_section(sm_context)
    if sm_section:
        sections.append(sm_section)

    return "\n\n".join(sections)


def build_response_user_message(
    user_input: str,
    conversation_history: List[Dict[str, str]],
    history_limit: int = 10,
) -> str:
    """Build the user message for the Response Generator.

    Args:
        user_input: Current user message.
        conversation_history: Recent conversation messages.
        history_limit: Number of recent messages to include (default: 10).

    Returns:
        Formatted user message string.
    """
    history_text = ""
    if conversation_history:
        recent = conversation_history[-history_limit:]
        lines = []
        for msg in recent:
            role = msg["role"].upper()
            lines.append(f"[{role}]: {msg['content']}")
        history_text = "\n".join(lines) + "\n\n"

    return f"""{history_text}[USER]: {user_input}"""


def _default_persona() -> str:
    return """You are STELLA, a warm and engaging AI companion.
You have natural spoken conversations while working toward collecting specific information and completing tasks.

CRITICAL RULES:
- Always respond in the SAME LANGUAGE the user is speaking (e.g. German if they speak German, English if they speak English)
- Keep responses to 30-50 words (this is a voice conversation, not a text chat)
- NEVER mention internal systems, experts, extraction, deliverables, or any technical metadata
- NEVER say things like "Extracted X" or "deliverables not provided" — that is internal data, not conversation
- If you collected information from what the user said, acknowledge it naturally before moving on
- Ask for missing information naturally, one thing at a time"""


def _conversation_guidelines() -> str:
    return """CONVERSATIONAL STYLE (spoken aloud via TTS — follow strictly):

All rules apply in WHATEVER LANGUAGE the user speaks. Use that language's natural spoken register.

Tone — Friendly Professional:
- Think of a skilled interviewer or consultant: warm, attentive, composed.
- Be genuinely interested without being overly enthusiastic or performative.
- Stay professional but never stiff. You can be personable without being casual.
- Adapt slightly to the user's energy — if they are relaxed, you can be a touch warmer. If they are formal, match that. But always stay on the professional side.

Name Usage — CRITICAL:
- Use the user's name at MOST once every 4-5 responses. Most responses should have NO name at all.
- Never put the name at the start of a sentence as a greeting pattern (wrong: "That's great, Felix." or "Felix, that sounds...").
- When you do use it, place it mid-sentence or at the end, and only when it adds warmth to a specific moment — like reacting to something personal they shared.
- If you catch yourself about to start with their name, delete it and rephrase.

Register:
- Use natural contractions — speak like a real person, not a document.
  EN: "don't", "it's", "I'm", "that's", "won't" — never "do not", "it is"
  DE: "hab ich", "ist's", "geht's" — never "habe ich", "ist es"
- Avoid slang, excessive fillers, and overly casual interjections (no "honestly", "like", "naja", "oh wow").
- Use clean, professional connectors.
  EN: "actually", "so", "in that case", "that said"
  DE: "also", "das heißt", "in dem Fall", "übrigens"

Variety — the most important rule:
- NEVER use the same opening pattern twice in a row. Rotate between these approaches:
  A) React directly to their content ("Three times a week is a solid routine.")
  B) Start with your own thought ("I'd be curious to hear more about...")
  C) Ask a follow-up immediately ("What does a typical session look like for you?")
  D) Brief acknowledgment then pivot ("Understood. On the nutrition side...")
  E) Share a relevant thought before asking ("That combination tends to work well for endurance. How long have you been doing that?")
- Do NOT always follow the pattern "acknowledge + question." Sometimes just comment. Sometimes just ask. Sometimes do both. Mix it up.

TTS Rhythm:
- Comma roughly every 7-10 words for natural breathing.
- Period at the end of statements for pitch drop.
- One question mark max, at the very end if you're asking something.
- Maximum one exclamation mark per response, and only if genuinely warranted.

Response Shape — STRICT LENGTH:
- 1-2 sentences, max 3. Aim for 20-35 words. Shorter is almost always better.
- ONE direction per response. Do not try to acknowledge, comment, AND ask a question all at once. Pick the most natural move and commit to it.
- At most ONE question per response. Never ask two questions. Never combine a question with "could you clarify."
- Match the user's energy and length. Brief input gets a brief reply.
- Not every response needs a question. Sometimes a thoughtful comment is enough, and the pause invites them to continue.
- If you can say it in fewer words, do. Cut filler, cut preamble, get to the point.

Formatting:
- No markdown, bullets, numbered lists, or emojis.
- No quotation marks for emphasis.
- Write exactly as a professional interviewer would speak — warm but composed, interested but never over the top."""


def _state_machine_section(sm_context: Dict[str, Any]) -> str:
    if not sm_context:
        return ""

    parts: List[str] = ["CURRENT CONVERSATION CONTEXT:"]

    state = sm_context.get("state", {})
    if state:
        parts.append(f"Phase: {state.get('title', 'Unknown')}")
        desc = state.get("description", "")
        if desc:
            parts.append(f"Goal: {desc}")

    mode = sm_context.get("processing_mode", "")
    if mode == "strict":
        parts.append("Mode: Sequential — complete current task before moving on")
    elif mode == "loose":
        parts.append("Mode: Flexible — collect information in natural order")

    # Determine which deliverables were just collected this turn
    collected_keys = set(sm_context.get("_collected_keys", []))

    # Always show the current task instruction — the agent may need to perform
    # an action (e.g. "introduce yourself") even if deliverables were collected.
    current_task = sm_context.get("current_task")
    if current_task:
        parts.append(f"Current task: {current_task.get('description', '')}")
        instruction = current_task.get("instruction", "")

        # If any deliverables for this task were just collected, suppress the
        # instruction (which typically says "ask the user...") to prevent
        # re-asking about information already provided.
        task_del_keys = set(current_task.get("deliverable_keys", []))
        task_keys_just_collected = task_del_keys & collected_keys

        if task_keys_just_collected:
            # Don't show the instruction — it would tell the LLM to ask for
            # something the user already provided this turn.
            # Check if the entire state is completing
            all_pending_keys = {
                d["key"] for d in sm_context.get("deliverables", [])
                if d.get("status") == "pending"
            }
            state_completing = all_pending_keys.issubset(collected_keys)

            if state_completing:
                # Look up next state from the plan to guide the transition
                next_hint, hinted_task_id, hinted_task_has_deliverables = _get_next_state_hint(sm_context)
                note = (
                    "NOTE: The user just provided all the information needed. "
                    "Do NOT re-ask or confirm what they said — simply acknowledge naturally and move on."
                )
                if next_hint:
                    note += f" Transition to: {next_hint}"
                parts.append(note)

                # Track if the transition hint included a no-deliverable task
                # so auto-complete can fire for it in _process_post_response.
                if hinted_task_id and not hinted_task_has_deliverables:
                    sm_context["_hinted_task_id"] = hinted_task_id
            else:
                parts.append(
                    "NOTE: The user just provided information for this task. "
                    "Do NOT re-ask or confirm what they said — acknowledge naturally and move to the next topic."
                )
        elif instruction:
            # No deliverables just collected — show the instruction normally
            parts.append(f"Instruction: {instruction}")

    # Filter out just-collected deliverables from the pending list.
    deliverables = sm_context.get("deliverables", [])
    pending = [d for d in deliverables if d.get("status") == "pending" and d["key"] not in collected_keys]
    completed = [d for d in deliverables if d.get("status") == "completed"]
    # Show just-collected keys as completed so the LLM knows they were provided
    for d in deliverables:
        if d.get("status") == "pending" and d["key"] in collected_keys:
            completed.append({"key": d["key"], "value": "(just provided)"})

    if pending:
        parts.append("Still need to collect:")
        for d in pending:
            line = f"  - {d['key']}: {d['description']}"
            if d.get("acceptance_criteria"):
                line += f" (criteria: {d['acceptance_criteria']})"
            parts.append(line)

    if completed:
        parts.append("Already collected:")
        for d in completed:
            parts.append(f"  - {d['key']}: {d.get('value', '?')}")

    progress = sm_context.get("progress", {})
    pct = progress.get("percentage", 0)
    if pct > 0:
        parts.append(f"Overall progress: {pct:.0f}%")

    if sm_context.get("state_just_changed"):
        parts.append("NOTE: We just transitioned to a new conversation phase. Acknowledge this naturally.")

    return "\n".join(parts)


def _get_next_state_hint(sm_context: Dict[str, Any]) -> tuple:
    """Look up the next state from the full plan to guide transitions.

    Includes the first task's full instruction so the agent can ask
    the right question immediately without waiting for the next turn.

    Returns:
        Tuple of (hint_text, first_task_id, first_task_has_deliverables).
    """
    full_plan = sm_context.get("full_plan", [])
    current_state = sm_context.get("state", {})
    current_id = current_state.get("id")

    if not full_plan or not current_id:
        return "", None, False

    for i, state in enumerate(full_plan):
        if state.get("id") == current_id and i + 1 < len(full_plan):
            next_state = full_plan[i + 1]
            title = next_state.get("title", "")
            if not title:
                return "", None, False
            tasks = next_state.get("tasks", [])
            if tasks:
                first_task = tasks[0]
                task_id = first_task.get("id")
                has_deliverables = first_task.get("has_deliverables", len(first_task.get("deliverables", [])) > 0)
                instruction = first_task.get("instruction", "")
                if instruction:
                    hint = f"{title}. Your first task: {first_task.get('description', '')} — {instruction}"
                else:
                    hint = f"{title}. First task: {first_task.get('description', '')}"
                return hint, task_id, has_deliverables
            return title, None, False
    return "", None, False
