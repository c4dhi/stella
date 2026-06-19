"""System prompt builder for the Response Generator stage.

Composes the final system prompt from:
- Base persona and conversation guidelines
- State machine context (current state, tasks, deliverables)
- Arbitration directive (injected expert guidance)
- Optional custom system prompt from the plan
"""

from typing import Dict, Any, List, Optional

from stella_v2_agent.models.arbitration_result import ResponseDirective
from stella_v2_agent.pipeline.language_resolver import LANGUAGE_NAMES
from stella_v2_agent.prompts.template import render_prompt
from stella_v2_agent.prompts.context import format_history


def build_response_system_prompt(
    sm_context: Dict[str, Any],
    directive: ResponseDirective,
    plan_system_prompt: Optional[str] = None,
    custom_persona: Optional[str] = None,
    custom_guidelines: Optional[str] = None,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    history_limit: int = 10,
) -> str:
    """Build the complete system prompt for the Response Generator.

    The persona is used verbatim (so a plan-authored persona is never
    reinterpreted), and the conversation guidelines are rendered through the
    template interface: the editable guidelines decide WHERE the turn's runtime
    context goes via {{conversationHistory}}, {{stateContext}}, {{directive}} and
    {{language}}. Nothing is appended in code — the template owns the layout.

    Args:
        sm_context: State machine context for conversation awareness.
        directive: Arbitration directive with expert guidance.
        plan_system_prompt: Optional custom system prompt from the plan.
        custom_persona: Optional custom persona from Agent Configurator.
        custom_guidelines: Optional custom guidelines from Agent Configurator.
        conversation_history: Recent turns, exposed as {{conversationHistory}}.
        history_limit: How many recent turns to include.

    Returns:
        Complete system prompt string.
    """
    sections: List[str] = []

    # 1. Persona — verbatim, NOT rendered, so any {{...}} in a plan persona is
    #    left untouched. Plan persona + configurator persona stack; else default.
    if plan_system_prompt and custom_persona:
        sections.append(plan_system_prompt)
        sections.append(custom_persona)
    elif plan_system_prompt:
        sections.append(plan_system_prompt)
    elif custom_persona:
        sections.append(custom_persona)
    else:
        sections.append(_default_persona())

    # 2. Guidelines — rendered with the turn's context as template variables, so
    #    the configured prompt places state / directive / history / language
    #    wherever it wants instead of code bolting them on after the fact.
    guidelines = custom_guidelines or _conversation_guidelines()
    ctx = {
        "conversationHistory": format_history(conversation_history, history_limit),
        "stateContext": _state_machine_section(sm_context),
        "directive": directive.to_prompt_section() if directive else "",
        "language": _language_directive(sm_context.get("language")) or "",
    }
    sections.append(render_prompt(guidelines, ctx))

    return "\n\n".join(s for s in sections if s)


def _language_directive(language: Optional[str]) -> Optional[str]:
    """Build a deterministic 'respond in <language>' instruction.

    Returns None for unknown/auto so the existing heuristic language rules stand.
    """
    if not language or language == "auto":
        return None
    name = LANGUAGE_NAMES.get(language, language)
    return (
        f"LANGUAGE (highest priority — overrides everything above):\n"
        f"- Respond ENTIRELY in {name}. Every single word, including any examples, must be in {name}.\n"
        f"- This is the language detected for this conversation; do not switch languages on your own."
    )


def build_response_user_message(user_input: str) -> str:
    """The current user turn — the data being responded to. All prior context is
    placed by the system prompt via {{conversationHistory}}, so the user message
    is just the bare input."""
    return user_input


def _default_persona() -> str:
    """Minimal fallback persona. The production persona comes from the plan and/or
    the agent.yaml ``persona`` slot; this is used only when neither is set."""
    return """You are STELLA — a warm, genuinely curious conversation partner with a personality of your own, working toward collecting specific information through real conversation, not a form.

- Respond in the SAME LANGUAGE the user speaks (German if they speak German, English if English).
- Keep responses to 30-50 words (this is a voice conversation).
- NEVER mention internal systems, experts, deliverables, or technical metadata.
- React to the specific thing the user said; never re-ask something they already answered.
- Ask for missing information naturally, one thing at a time."""


def _conversation_guidelines() -> str:
    """Minimal fallback guidelines. The full, editable conversation style lives in
    agent.yaml (response_generator → conversation_guidelines) and is what runs in
    production; this is used only when no configured guidelines are provided."""
    return """CONVERSATIONAL STYLE (spoken aloud via TTS), in the user's language and its natural spoken register:
- React to the SPECIFIC thing the user said — never praise the mere act of answering ("solid routine!", "helpful to know!"), and never re-ask something they already told you.
- Offer a thought as often as you ask; not every turn needs a question. Don't run "acknowledge + question" every turn — that's what makes you a questionnaire.
- Natural contractions and the occasional light filler. Reuse the user's own words.
- 1-3 sentences, ~25-45 words. At most one question per turn. No markdown, bullets, or emojis.
{{#if directive}}

{{directive}}
{{/if}}
{{#if stateContext}}

{{stateContext}}
{{/if}}
{{#if conversationHistory}}

Conversation so far:
{{conversationHistory}}
{{/if}}
{{#if language}}

{{language}}
{{/if}}"""


def _state_machine_section(sm_context: Dict[str, Any]) -> str:
    if not sm_context:
        return ""

    parts: List[str] = ["CURRENT CONVERSATION CONTEXT (internal — never mention these labels to the user):"]

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
            all_pending_keys = {
                d["key"] for d in sm_context.get("deliverables", [])
                if d.get("status") == "pending"
            }
            state_completing = all_pending_keys.issubset(collected_keys)

            if state_completing:
                next_hint, _, _ = _get_next_state_hint(sm_context)
                note = (
                    "NOTE: The user just provided all the information needed for this phase. "
                    "Do NOT re-ask what they said. Acknowledge what they shared, then naturally "
                    "transition to the next topic — connect what they just told you to where "
                    "you're heading next so it feels like a conversation, not a checklist."
                )
                if next_hint:
                    note += f" Next topic: {next_hint}"
                parts.append(note)
            else:
                parts.append(
                    "NOTE: The user just provided information for this task. "
                    "Do NOT re-ask what they said. Acknowledge it naturally, and when "
                    "you move to the next topic, connect it to what they just shared "
                    "so the transition feels smooth."
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
        parts.append("NOTE: We just moved into a new conversation phase. Ease into it — connect it to what you were just talking about rather than announcing a topic change.")

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
