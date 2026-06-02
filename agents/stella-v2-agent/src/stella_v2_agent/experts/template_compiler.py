"""Backwards-compatible shim.

The {{placeholder}} compiler now lives in the shared SDK
(`stella_agent_sdk.prompts`) so v2, stella-light, and future agents share one
implementation. This module re-exports it so existing imports keep working.

New code should import from `stella_agent_sdk.prompts` directly.
"""

from stella_agent_sdk.prompts.placeholder_compiler import (  # noqa: F401
    PLACEHOLDER_PATTERN,
    HISTORY_PATTERN,
    PLACEHOLDER_REGISTRY,
    compile_prompt,
    has_user_message_placeholder,
    validate_template,
    PlaceholderPromptCompiler,
    COMPILER_VERSION,
    KNOWN_PLACEHOLDERS,
)
