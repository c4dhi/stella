"""Shared context formatters for the prompt-template interface.

Every stage exposes runtime context to its (configurable) prompt the same way:
build a dict of named string variables and render the prompt with
``render_prompt``. The configured prompt — living in agent.yaml — decides WHERE
each piece goes via ``{{conversationHistory}}``, ``{{stateContext}}``, etc., and
the current user input is sent as the bare API user message.

These helpers produce those variable strings, so the formatting lives in one
place and is identical across stages. Code carries only the formatting logic and
a minimal fallback prompt; the real prompt text is in the template.
"""

from typing import Any, Dict, List, Optional


def format_history(
    conversation_history: Optional[List[Dict[str, str]]],
    limit: int,
) -> str:
    """Recent turns as ``[ROLE]: text`` lines (most recent last), trimmed to
    ``limit``. Returns "" when there's nothing to show, so the template's
    ``{{#if conversationHistory}}`` drops the whole block."""
    if not conversation_history or limit <= 0:
        return ""
    recent = conversation_history[-limit:]
    return "\n".join(
        f"[{(msg.get('role') or 'user').upper()}]: {msg.get('content', '')}"
        for msg in recent
    )
