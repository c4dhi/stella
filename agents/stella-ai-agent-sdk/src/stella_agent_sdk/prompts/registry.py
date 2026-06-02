"""Versioned registry + single compile entry point for SDK prompt compilers.

Agents don't construct a compiler directly — they call one method with the raw
prompt and the compiler version they want, and get back the final prompt:

    from stella_agent_sdk import prompts
    final = prompts.compile(
        raw_prompt,
        version="1.0.0",                 # omit for the latest
        sm_context=sm_context,
        conversation_history=history,
        user_input=text,
    )

Each compiler implementation registers itself under its ``VERSION``; new behavior
ships as a new version so old prompts keep compiling against the version they were
authored for. Custom agents can add versions with :func:`register_compiler`.
"""

from typing import Dict, List, Optional, Type, Any

from stella_agent_sdk.prompts.base import PromptCompiler
from stella_agent_sdk.prompts.placeholder_compiler import PlaceholderPromptCompiler

# version string -> compiler class
_REGISTRY: Dict[str, Type[PromptCompiler]] = {}


def _version_key(version: str):
    """Sort key for semantic-ish versions; non-numeric parts sort last."""
    parts = []
    for piece in str(version).split("."):
        parts.append((0, int(piece)) if piece.isdigit() else (1, piece))
    return tuple(parts)


def register_compiler(compiler_cls: Type[PromptCompiler]) -> Type[PromptCompiler]:
    """Register a compiler class under its ``VERSION`` (usable as a decorator)."""
    version = getattr(compiler_cls, "VERSION", None)
    if not version or version == "0.0.0":
        raise ValueError(f"Compiler {compiler_cls!r} must define a real VERSION")
    _REGISTRY[version] = compiler_cls
    return compiler_cls


def latest_version() -> str:
    """The highest registered compiler version."""
    if not _REGISTRY:
        raise LookupError("No prompt compilers are registered")
    return max(_REGISTRY, key=_version_key)


def available_versions() -> List[str]:
    """All registered compiler versions, oldest first."""
    return sorted(_REGISTRY, key=_version_key)


def get_compiler(version: Optional[str] = None) -> Type[PromptCompiler]:
    """Return the compiler class for ``version`` (or the latest when omitted)."""
    if version is None:
        return _REGISTRY[latest_version()]
    try:
        return _REGISTRY[version]
    except KeyError:
        avail = ", ".join(available_versions()) or "(none)"
        raise KeyError(
            f"No prompt compiler registered for version '{version}'. Available: {avail}"
        )


def compile(
    template: Optional[str],
    version: Optional[str] = None,
    *,
    sm_context: Optional[Dict[str, Any]] = None,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    user_input: str = "",
) -> Optional[str]:
    """Compile a prompt with the requested compiler version and return the final text.

    This is the single entry point agents use: pass the raw prompt (with
    placeholders) and the compiler version, plus the runtime context the
    placeholders resolve against, and get back the prompt to hand to the LLM.
    Returns the input unchanged for falsy/token-free prompts.
    """
    compiler = get_compiler(version)(
        sm_context,
        conversation_history=conversation_history,
        user_input=user_input,
    )
    return compiler.compile(template)


# Register the built-in compiler version(s) shipped with the SDK.
register_compiler(PlaceholderPromptCompiler)
