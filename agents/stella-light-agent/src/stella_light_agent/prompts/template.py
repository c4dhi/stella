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

from typing import List

# The render engine + PromptVariable descriptor are shared, in the SDK (single
# source of truth). This module only declares THIS agent's variable registry and
# re-exports render_prompt so existing importers keep working.
from stella_agent_sdk.prompts import render_prompt, PromptVariable

__all__ = ["render_prompt", "PromptVariable", "PROMPT_VARIABLES"]


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
