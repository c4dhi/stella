"""Prompt compiler interface.

A prompt compiler takes a raw text prompt (authored in the Agent Configurator or a
plan) and resolves any dynamic tokens it contains against live runtime state,
returning a ready-to-send prompt. Compilers are versioned so agents and the
backend can reason about which token grammar a prompt was authored against.

Concrete compilers (e.g. the {{placeholder}} compiler) register themselves so an
agent can fetch whichever one it wants through the SDK registry.
"""

from abc import ABC, abstractmethod
from typing import Optional


class PromptCompiler(ABC):
    """Base class for SDK prompt compilers.

    Subclasses are typically "rung up" with the runtime context (e.g. state-machine
    context, conversation history, current user message) and then asked to compile
    one or more prompts:

        compiler = SomeCompiler(context...)
        text = compiler.compile(raw_prompt)

    Attributes:
        NAME: Stable identifier used to look the compiler up in the registry.
        VERSION: Semantic version of the compiler's token grammar/behavior.
    """

    NAME: str = "base"
    VERSION: str = "0.0.0"

    @abstractmethod
    def compile(self, template: Optional[str]) -> Optional[str]:
        """Resolve dynamic tokens in ``template`` and return the compiled prompt.

        Implementations must be a no-op for falsy input or templates that contain
        no tokens, returning the input unchanged.
        """
        raise NotImplementedError
