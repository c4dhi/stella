"""SDK prompt-compiler library.

Primary entry point — one call, given a prompt + compiler version, returns the
final prompt for the LLM:

    from stella_agent_sdk import prompts
    final = prompts.compile(raw_prompt, version="1.0.0", sm_context=ctx,
                            conversation_history=h, user_input=t)

Also exposed:
  - PromptCompiler / PlaceholderPromptCompiler  classes (advanced use)
  - get_compiler / register_compiler / available_versions / latest_version  registry
  - compile_prompt                              functional one-shot resolver
  - COMPILER_VERSION, KNOWN_PLACEHOLDERS, validate_template  versioning primitives
"""

from stella_agent_sdk.prompts.base import PromptCompiler
from stella_agent_sdk.prompts.placeholder_compiler import (
    PlaceholderPromptCompiler,
    compile_prompt,
    has_user_message_placeholder,
    validate_template,
    COMPILER_VERSION,
    KNOWN_PLACEHOLDERS,
)
from stella_agent_sdk.prompts.registry import (
    compile,
    get_compiler,
    register_compiler,
    available_versions,
    latest_version,
)

__all__ = [
    "compile",
    "PromptCompiler",
    "PlaceholderPromptCompiler",
    "compile_prompt",
    "has_user_message_placeholder",
    "validate_template",
    "COMPILER_VERSION",
    "KNOWN_PLACEHOLDERS",
    "get_compiler",
    "register_compiler",
    "available_versions",
    "latest_version",
]
