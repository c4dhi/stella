"""Prompt builder for Grace Agent.

Composes modular prompt components into complete system and user prompts.
"""

from typing import Dict, Any, List, Optional
from grace_agent.prompts.base import PromptComponent
from grace_agent.prompts.components import (
    BaseInstructionsComponent,
    StrictnessComponent,
    DeliverableRulesComponent,
    DeliverableExamplesComponent,
    SafetyGuidelinesComponent,
    ConversationFlowComponent,
    StateTransitionWarningComponent,
)


# Greeting patterns for detection
GREETING_PATTERNS = [
    'hi', 'hello', 'hey', 'howdy', 'greetings', 'good morning',
    'good afternoon', 'good evening', 'hiya', 'yo', 'sup', "what's up",
    'hallo', 'guten tag', 'guten morgen', 'guten abend',  # German
]


class PromptBuilder:
    """
    Builds prompts by composing modular components.

    Supports dynamic component inclusion based on context.
    """

    def __init__(self):
        self.components: List[PromptComponent] = []
        self._setup_default_components()

    def _setup_default_components(self):
        """Set up the default component order."""
        self.components = [
            BaseInstructionsComponent(),
            StateTransitionWarningComponent(),
            StrictnessComponent(),
            SafetyGuidelinesComponent(),
            DeliverableRulesComponent(),
            DeliverableExamplesComponent(),
            ConversationFlowComponent(),
        ]

    def add_component(self, component: PromptComponent, index: Optional[int] = None):
        """Add a component to the builder."""
        if index is not None:
            self.components.insert(index, component)
        else:
            self.components.append(component)

    def remove_component(self, name: str):
        """Remove a component by name."""
        self.components = [c for c in self.components if c.name != name]

    def get_component(self, name: str) -> Optional[PromptComponent]:
        """Get a component by name."""
        for c in self.components:
            if c.name == name:
                return c
        return None

    def build_system_prompt(self, context: Dict[str, Any]) -> str:
        """
        Build the complete system prompt from components.

        Args:
            context: State machine context and other information

        Returns:
            Complete system prompt string
        """
        parts = []

        for component in self.components:
            if component.should_include(context):
                rendered = component.render(context)
                if rendered and rendered.strip():
                    parts.append(rendered)

        return "\n".join(parts)

    def build_user_message(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        context: Dict[str, Any],
        is_greeting: Optional[bool] = None
    ) -> str:
        """
        Build the user message with context.

        Args:
            user_input: The current user message
            conversation_history: Recent conversation messages
            context: State machine context
            is_greeting: Override for greeting detection (auto-detect if None)

        Returns:
            Formatted user message string
        """
        parts = []

        # Auto-detect greeting if not specified
        if is_greeting is None:
            is_greeting = self._is_greeting(user_input)

        # Add greeting warning if applicable
        if is_greeting:
            parts.append("*** WARNING: USER MESSAGE IS A GREETING ***")
            parts.append("DO NOT interpret greetings like 'hi' or 'hello' as deliverable values!")
            parts.append("*** END WARNING ***\n")

        # Add conversation history with recency markers
        if conversation_history:
            parts.append("Recent conversation:")
            history_len = len(conversation_history)

            # Take last 8 messages
            recent_history = conversation_history[-8:]

            for i, msg in enumerate(recent_history):
                role = msg.get("role", "user").upper()
                content = msg.get("content", "")

                # Calculate position from end
                position_from_end = len(recent_history) - i

                # Mark recency
                if position_from_end <= 2:
                    parts.append(f"[MOST RECENT] {role}: {content}")
                elif position_from_end <= 4:
                    parts.append(f"[RECENT] {role}: {content}")
                else:
                    parts.append(f"{role}: {content}")

            parts.append("")  # Empty line after history

        # Add current input
        parts.append(f"Current user message: {user_input}")
        parts.append("")
        parts.append("Analyze this input and respond using the REQUIRED OUTPUT FORMAT.")

        return "\n".join(parts)

    def _is_greeting(self, text: str) -> bool:
        """Check if text is a greeting."""
        normalized = text.strip().lower()
        # Remove punctuation for comparison
        normalized = ''.join(c for c in normalized if c.isalnum() or c.isspace())
        return normalized in GREETING_PATTERNS

    @staticmethod
    def is_greeting(text: str) -> bool:
        """Static method to check if text is a greeting."""
        normalized = text.strip().lower()
        normalized = ''.join(c for c in normalized if c.isalnum() or c.isspace())
        return normalized in GREETING_PATTERNS
