"""Backwards-compatible shim for placeholder detection helpers.

The {{placeholder}} compiler now lives in the shared SDK
(`stella_agent_sdk.prompts`) so v2, stella-light, and future agents share one
implementation. This module re-exports the detection/validation helpers so
existing imports keep working.

To COMPILE a prompt, do not use this module — call the versioned entry point
``stella_agent_sdk.prompts.compile(template, version=...)`` directly, so prompt
compilation is always pinned to an explicit compiler version.
"""

from stella_agent_sdk.prompts.placeholder_compiler import (  # noqa: F401
    PLACEHOLDER_PATTERN,
    HISTORY_PATTERN,
    PLACEHOLDER_REGISTRY,
    has_user_message_placeholder,
    validate_template,
    PlaceholderPromptCompiler,
    COMPILER_VERSION,
    KNOWN_PLACEHOLDERS,
)
