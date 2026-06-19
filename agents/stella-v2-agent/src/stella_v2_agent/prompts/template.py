"""Lightweight prompt template rendering with variable substitution.

Configurable prompts (bridge, response, barge-in, …) may reference runtime
variables so a single edited prompt can adapt to context — most importantly
whether the current turn is a user barge-in.

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
from stella_agent_sdk.prompts.template import render_prompt, PromptVariable

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
    PromptVariable(
        name="allowAppraisal",
        type="boolean",
        description="Bridge prompt only: true when a light appraisal of the user's "
        "turn is permitted (the Bridge Appraisal toggle is on AND a safety screen "
        "cleared). Use {{#if allowAppraisal}}…{{/if}} / {{#unless allowAppraisal}}…"
        "{{/unless}} to allow or forbid evaluative phrasing.",
    ),
    PromptVariable(
        name="conversationHistory",
        type="string",
        description="The recent conversation turns (most recent last), already "
        "formatted as [ROLE]: text lines and trimmed to the stage's history "
        "limit. Empty when there's no prior context. Wrap in "
        "{{#if conversationHistory}}…{{/if}} so the header only shows when there "
        "is history to show.",
    ),
    PromptVariable(
        name="interruptedReply",
        type="string",
        description="Barge-in evaluator only: the assistant reply that was being "
        "spoken when the user interrupted — the half-committed message, not yet in "
        "the recorded history. Lets the evaluator judge the interruption against "
        "what the assistant was actually saying. Empty if nothing was in flight. "
        "Wrap in {{#if interruptedReply}}…{{/if}}.",
    ),
    PromptVariable(
        name="stateContext",
        type="string",
        description="Response generator: the current state-machine context "
        "(phase, goal, task instruction, deliverables still to collect / already "
        "collected, progress). Pre-formatted; place it with {{stateContext}} and "
        "wrap in {{#if stateContext}}…{{/if}}.",
    ),
    PromptVariable(
        name="directive",
        type="string",
        description="Response generator: the arbitration directive for this turn "
        "(tone, must-avoid, follow-up guidance synthesised from the experts). "
        "Pre-formatted; place with {{directive}}, wrap in {{#if directive}}…{{/if}}.",
    ),
    PromptVariable(
        name="taskJustCollected",
        type="boolean",
        description="Response generator: true when the user just provided a "
        "deliverable for the current task this turn. Wrap acknowledge-don't-re-ask "
        "guidance in {{#if taskJustCollected}}…{{/if}}.",
    ),
    PromptVariable(
        name="stateCompleting",
        type="boolean",
        description="Response generator: true when the just-collected answer "
        "completed every pending deliverable in the current phase (use inside "
        "{{#if taskJustCollected}} to tell the reply to transition to the next "
        "topic). Pairs with {{nextTopicHint}}.",
    ),
    PromptVariable(
        name="stateJustChanged",
        type="boolean",
        description="Response generator: true on the first turn after moving into "
        "a new conversation phase. Wrap 'ease into the new phase' guidance in "
        "{{#if stateJustChanged}}…{{/if}}.",
    ),
    PromptVariable(
        name="nextTopicHint",
        type="string",
        description="Response generator: a short hint about the next phase/task, "
        "set only when {{stateCompleting}} is true. Place with {{nextTopicHint}}.",
    ),
    PromptVariable(
        name="bridge",
        type="string",
        description="Response generator ONLY: the short acknowledgment already "
        "spoken aloud this turn by the Bridge stage. The reply is appended to it "
        "and spoken as one seamless utterance, so use {{#if bridge}}…{{bridge}}…"
        "{{/if}} to tell the reply to continue from it (don't re-greet, don't "
        "restate or define what the opener already said). Not available to "
        "experts — only the final response stage sees the bridge. Empty when no "
        "bridge was spoken.",
    ),
]
