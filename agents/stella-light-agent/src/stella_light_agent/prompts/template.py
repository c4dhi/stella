"""Lightweight prompt template rendering with variable substitution.

Configurable prompts (response, barge-in, …) may reference runtime variables
so a single edited prompt can adapt to context — most importantly whether the
current turn is a user barge-in.

Supported syntax (Handlebars-ish, intentionally minimal):

- ``{{var}}``                      → substituted with the variable's value
                                      (booleans render as "yes"/"no", missing
                                      variables render as an empty string).
- ``{{#if var}}…{{/if}}``          → kept only when ``var`` is truthy.
- ``{{#if var}}…{{else}}…{{/if}}`` → if/else.
- ``{{#unless var}}…{{/unless}}``  → kept only when ``var`` is falsy.

Blocks may be nested. Unknown variables are treated as falsy/empty rather than
raising, so a prompt is never broken by a typo at runtime.
"""

import re
from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass(frozen=True)
class PromptVariable:
    """A template variable that prompts may reference."""

    name: str
    type: str  # "boolean" | "string"
    description: str


# Registry of variables available to configurable prompts. Surfaced to the
# Agent Configurator so editors know what they can reference. Keep this in sync
# with the context dicts built in agent.py.
PROMPT_VARIABLES: List[PromptVariable] = [
    PromptVariable(
        name="isBargeIn",
        type="boolean",
        description="True when this turn was triggered by the user interrupting "
        "(barging in) while the agent was speaking.",
    ),
    PromptVariable(
        name="bargeInTranscript",
        type="string",
        description="What the user said when they barged in (only set on a "
        "barge-in turn).",
    ),
    PromptVariable(
        name="userInput",
        type="string",
        description="The current user message being processed.",
    ),
]

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")

# Innermost if/unless block: a block whose body contains no further block
# openers (``{{#``), so iterating resolves nested blocks from the inside out.
_IF_BLOCK_RE = re.compile(
    r"\{\{#if\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}"
    r"((?:(?!\{\{#).)*?)"
    r"(?:\{\{else\}\}((?:(?!\{\{#).)*?))?"
    r"\{\{/if\}\}",
    re.DOTALL,
)
_UNLESS_BLOCK_RE = re.compile(
    r"\{\{#unless\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}"
    r"((?:(?!\{\{#).)*?)"
    r"\{\{/unless\}\}",
    re.DOTALL,
)


def _is_truthy(value: Any) -> bool:
    """Truthiness for template conditionals. Strings like "false"/"no"/"0"
    are treated as falsy so values that arrive as text behave intuitively."""
    if isinstance(value, str):
        return value.strip().lower() not in ("", "false", "no", "0", "none")
    return bool(value)


def _render_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


def render_prompt(template: str, variables: Dict[str, Any]) -> str:
    """Render ``template`` against ``variables``.

    Resolves conditional blocks first (inside-out for nesting), then substitutes
    remaining ``{{var}}`` references. Never raises on unknown variables.
    """
    if not template or "{{" not in template:
        return template

    text = template

    # Resolve conditional blocks repeatedly until none remain. Each pass only
    # matches innermost blocks (no nested openers in the body), so nesting is
    # resolved from the inside out.
    for _ in range(50):  # generous bound; guards against pathological input
        changed = False

        def _if_sub(m: "re.Match") -> str:
            var, if_body, else_body = m.group(1), m.group(2), m.group(3)
            return if_body if _is_truthy(variables.get(var)) else (else_body or "")

        def _unless_sub(m: "re.Match") -> str:
            var, body = m.group(1), m.group(2)
            return "" if _is_truthy(variables.get(var)) else body

        text, n1 = _IF_BLOCK_RE.subn(_if_sub, text)
        text, n2 = _UNLESS_BLOCK_RE.subn(_unless_sub, text)
        changed = bool(n1 or n2)
        if not changed:
            break

    # Substitute plain variable references.
    text = _VAR_RE.sub(lambda m: _render_value(variables.get(m.group(1))), text)
    return text
