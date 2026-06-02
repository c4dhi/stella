"""SDK prompt-compiler library.

Public surface:
  - PromptCompiler            base class / interface for compilers
  - PlaceholderPromptCompiler the built-in {{placeholder}} resolver
  - get_compiler/register_compiler/available_compilers  registry access
  - compile_prompt            functional one-shot {{placeholder}} resolver
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
    get_compiler,
    register_compiler,
    available_compilers,
)

__all__ = [
    "PromptCompiler",
    "PlaceholderPromptCompiler",
    "compile_prompt",
    "has_user_message_placeholder",
    "validate_template",
    "COMPILER_VERSION",
    "KNOWN_PLACEHOLDERS",
    "get_compiler",
    "register_compiler",
    "available_compilers",
]
