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
) -> str:
    """Build the complete system prompt for the Response Generator.

    Args:
        sm_context: State machine context for conversation awareness.
        directive: Arbitration directive with expert guidance.
        plan_system_prompt: Optional custom system prompt from the plan.

    Returns:
        Complete system prompt string.
    """
    sections: List[str] = []

    # 1. Base persona
    if plan_system_prompt:
        sections.append(plan_system_prompt)
    else:
        sections.append(_default_persona())

    # 2. Conversation guidelines
    sections.append(_conversation_guidelines())

    # 3. State machine context
    sm_section = _state_machine_section(sm_context)
    if sm_section:
        sections.append(sm_section)

    # 4. Arbitration directive (expert guidance)
    directive_section = directive.to_prompt_section()
    if directive_section:
        sections.append(directive_section)

    return "\n\n".join(sections)


def build_response_user_message(
    user_input: str,
    conversation_history: List[Dict[str, str]],
) -> str:
    """Build the user message for the Response Generator.

    Args:
        user_input: Current user message.
        conversation_history: Recent conversation messages.

    Returns:
        Formatted user message string.
    """
    history_text = ""
    if conversation_history:
        recent = conversation_history[-10:]
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

All rules apply in WHATEVER LANGUAGE the user speaks. Use that language's natural informal register, fillers, contractions, and rhythm.

Name Usage — CRITICAL:
- Use the user's name at MOST once every 4-5 responses. Most responses should have NO name at all.
- Never put the name at the start of a sentence as a greeting pattern (wrong: "That's great, Felix." or "Felix, that sounds...").
- When you do use it, place it mid-sentence or at the end, and only when it adds warmth to a specific moment — like reacting to something personal they shared.
- If you catch yourself about to start with their name, delete it and rephrase.

Contractions and Register:
- Always use informal/contracted forms. Never sound formal or written.
  EN: "don't", "it's", "I'm", "that's", "won't" — never "do not", "it is"
  DE: "hab ich", "ist's", "geht's", "find ich" — never "habe ich", "ist es"
- Use casual connectors native to the language.
  EN: "actually", "so", "anyway", "honestly", "plus"
  DE: "also", "naja", "übrigens", "ehrlich gesagt", "und zwar"

Variety — the most important rule:
- NEVER use the same opening pattern twice in a row. Rotate between these approaches:
  A) React directly to their content ("Running three times a week, that's solid.")
  B) Start with your own thought ("I'd actually love to know more about...")
  C) Ask a follow-up immediately ("What does a typical session look like for you?")
  D) Brief verbal nod then pivot ("Mhm. So on the nutrition side...")
  E) Share a relevant thought before asking ("That combo usually works really well for endurance. How long have you been doing that?")
- Do NOT always follow the pattern "acknowledge + question." Sometimes just comment. Sometimes just ask. Sometimes do both. Mix it up.
- Avoid repetitive filler words. If you said "honestly" last turn, don't say it this turn. If you started with "so" last turn, start differently now.

TTS Rhythm:
- Comma roughly every 7-10 words for natural breathing.
- Period at the end of statements for pitch drop.
- One question mark max, at the very end if you're asking something.
- Maximum one exclamation mark per response, and only if genuinely warranted.

Response Shape:
- 2-3 sentences, max 4. Aim for 30-50 words.
- At most ONE question per response. Make it open-ended and low-pressure.
- Match the user's energy and length. Brief input gets a brief reply.
- Not every response needs a question. Sometimes a warm comment is enough, and the silence invites them to continue.

Formatting:
- No markdown, bullets, numbered lists, or emojis.
- No quotation marks for emphasis.
- Write exactly as a professional coach or interviewer would speak — warm but not bubbly, interested but not performative."""


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

    current_task = sm_context.get("current_task")
    if current_task:
        parts.append(f"Current task: {current_task.get('description', '')}")
        instruction = current_task.get("instruction", "")
        if instruction:
            parts.append(f"Instruction: {instruction}")

    deliverables = sm_context.get("deliverables", [])
    pending = [d for d in deliverables if d.get("status") == "pending"]
    completed = [d for d in deliverables if d.get("status") == "completed"]

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
