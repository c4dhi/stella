"""Registry of prompt compilers exposed by the SDK.

Lets an agent fetch whichever compiler it wants by name instead of importing a
concrete class:

    from stella_agent_sdk.prompts import get_compiler
    Compiler = get_compiler("placeholder")
    compiler = Compiler(sm_context, conversation_history=h, user_input=t)
    text = compiler.compile(raw_prompt)

Third-party / custom agents can register their own compilers with
:func:`register_compiler`.
"""

from typing import Dict, Type

from stella_agent_sdk.prompts.base import PromptCompiler
from stella_agent_sdk.prompts.placeholder_compiler import PlaceholderPromptCompiler

_REGISTRY: Dict[str, Type[PromptCompiler]] = {}


def register_compiler(compiler_cls: Type[PromptCompiler]) -> Type[PromptCompiler]:
    """Register a compiler class under its ``NAME``. Returns the class (usable as a decorator)."""
    name = getattr(compiler_cls, "NAME", None)
    if not name or name == "base":
        raise ValueError(f"Compiler {compiler_cls!r} must define a non-empty, non-'base' NAME")
    _REGISTRY[name] = compiler_cls
    return compiler_cls


def get_compiler(name: str) -> Type[PromptCompiler]:
    """Return the registered compiler class for ``name``.

    Raises:
        KeyError: if no compiler is registered under that name.
    """
    try:
        return _REGISTRY[name]
    except KeyError:
        available = ", ".join(sorted(_REGISTRY)) or "(none)"
        raise KeyError(f"No prompt compiler registered as '{name}'. Available: {available}")


def available_compilers() -> Dict[str, Type[PromptCompiler]]:
    """A copy of the name -> compiler-class registry."""
    return dict(_REGISTRY)


# Register the built-in compilers shipped with the SDK.
register_compiler(PlaceholderPromptCompiler)
