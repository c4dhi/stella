"""Shared context formatters for the prompt-template interface.

``format_history`` now lives in the SDK (single source of truth) so every agent
formats conversation history identically. Re-exported here so existing
``from stella_v2_agent.prompts.context import format_history`` imports keep
working.
"""

from stella_agent_sdk.prompts.template import format_history

__all__ = ["format_history"]
