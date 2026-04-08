"""Bridge Generator — ultra-short conversational bridge for early TTS synthesis.

Generates a 1-6 word "bridge" phrase that buys time while the main pipeline
(gate → experts → arbitration → response) completes. Runs in parallel with
the Input Gate via asyncio.gather().

On failure: returns a short fallback bridge. Every turn always gets a bridge.
"""

import random
import time
from typing import Dict, Any, List, Optional

from stella_v2_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider
import logging

logger = logging.getLogger(__name__)

BRIDGE_SYSTEM_PROMPT = """You are producing a brief spoken filler while gathering your thoughts. This will be read aloud by a TTS engine.

ENERGY RULE: Your bridge must NEVER exceed the user's energy level.
- Greeting (hello/hi/hey) → greet back briefly. "Hey there." / "Hi." / "Hello."
- Neutral statement → neutral bridge. "Okay." / "Right." / "Got it."
- Short input (yes/no/okay) → equally short. "Okay." / "Sure." / "Right."
- Unclear or garbled → no content claims. "Let me think about that."
- Emotional or vulnerable → calm acknowledgment. "I hear you." / "That makes sense."

CRITICAL CONSTRAINTS:
1. This is ONLY a filler. NEVER answer, inform, advise, or complete any task.
2. NEVER ask a question. No question marks.
3. NEVER use the same bridge twice in a conversation.
4. Must end with a period or exclamation mark.
5. Only use words that render well in TTS. Avoid "mhm", "hmm", "uh-huh", "ah".
6. Maximum 8 words. Shorter is better.
7. NEVER use exclamations like "Oh!", "Wow!", "Great!", "That's amazing!" for mundane input. Save enthusiasm for genuinely exciting statements.
8. NEVER evaluate or comment on what the user said. No "That's a great question", "That's interesting", "What a nice thought", "That's a warm greeting", etc. A bridge is a PAUSE FILLER, not a reaction.

GOOD bridges: "Okay." / "Right." / "Got it." / "Sure, let me think." / "I see." / "Yeah, that makes sense." / "Let me think." / "Alright."
BAD bridges: "Oh that's wonderful!" / "I completely understand!" / "That's really interesting!" / "Oh I love that." / "That's a great question!" / "That's an interesting thought!" / "That's a warm greeting!" / "What a nice idea!"

LANGUAGE: Always match the user's language.

Output ONLY the bridge. No quotes, no labels, no explanation."""

# Short fallback bridges used when LLM generation fails or is rejected.
# Ensures every turn gets a bridge for consistent perceived latency.
FALLBACK_BRIDGES = [
    "Okay.",
    "Right.",
    "Got it.",
    "Sure.",
    "I see.",
    "Alright.",
    "Okay, let me think.",
    "One moment.",
]

# Greeting-specific fallbacks for when user says hello/hi/hey.
GREETING_FALLBACKS = [
    "Hey there.",
    "Hi.",
    "Hello.",
    "Hey.",
]

_GREETING_WORDS = {"hello", "hi", "hey", "hallo", "hei", "greetings", "good morning", "good evening", "good afternoon"}


class BridgeGenerator:
    """Generates a short conversational bridge for early TTS synthesis.

    Uses a dedicated LLM call with higher temperature for natural variety.
    Runs in parallel with InputGate.classify() — whichever finishes first
    is used immediately.
    """

    def __init__(self, llm_service: LLMService):
        self._llm_service = llm_service

        # LLM config (overridable via apply_config)
        self.bridge_model = "gpt-4o-mini"
        self.bridge_max_tokens = 30
        self.bridge_temperature = 0.7
        self.custom_system_prompt: Optional[str] = None
        self.history_limit: int = 0  # 0 = default (2)

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from Agent Configurator."""
        if "model" in config:
            self.bridge_model = config["model"]
        if "max_tokens" in config:
            self.bridge_max_tokens = int(config["max_tokens"])
        if "temperature" in config:
            self.bridge_temperature = float(config["temperature"])
        if "system_prompt" in config:
            self.custom_system_prompt = config["system_prompt"]
        if "history_limit" in config:
            self.history_limit = int(config["history_limit"])

    async def generate(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
    ) -> str:
        """Generate a bridge phrase for the given user input.

        Args:
            user_input: The current user message.
            conversation_history: Recent conversation messages.

        Returns:
            A validated bridge phrase (1-8 words). Always returns a bridge (fallback on failure).
        """
        start_time = time.time()

        try:
            user_message = self._build_user_message(user_input, conversation_history)

            system_prompt = self.custom_system_prompt or BRIDGE_SYSTEM_PROMPT
            messages = [
                LLMMessage(role="system", content=system_prompt),
                LLMMessage(role="user", content=user_message),
            ]

            config = LLMConfig(
                model=self.bridge_model,
                temperature=self.bridge_temperature,
                max_tokens=self.bridge_max_tokens,
                provider=LLMProvider.OPENAI_LANGCHAIN,
                streaming=False,
                json_mode=False,
            )

            response = await self._llm_service.generate(
                messages=messages,
                config=config,
                component_name="bridge_generator",
            )

            latency_ms = (time.time() - start_time) * 1000
            bridge = self._validate_bridge(response.content)
            if bridge:
                logger.info(f"'{bridge}' in {latency_ms:.0f}ms")
                return bridge

            # Validation failed — use context-appropriate fallback
            fallback = self._pick_fallback(user_input)
            logger.info(f"Validation failed, fallback '{fallback}' in {latency_ms:.0f}ms")
            return fallback

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            fallback = self._pick_fallback(user_input)
            logger.error(f"Failed in {latency_ms:.0f}ms: {e}, fallback '{fallback}'")
            return fallback

    @staticmethod
    def _pick_fallback(user_input: str) -> str:
        """Pick a context-appropriate fallback bridge."""
        if user_input.strip().lower().rstrip("!.,") in _GREETING_WORDS:
            return random.choice(GREETING_FALLBACKS)
        return random.choice(FALLBACK_BRIDGES)

    @staticmethod
    def _validate_bridge(raw: str) -> str:
        """Validate the bridge phrase. Returns "" if invalid.

        The bridge must be a short spoken acknowledgment ending with . or !
        Questions are always rejected — bridges must never ask the user anything.
        Evaluative commentary is rejected — bridges must not react to the user's input.
        Multi-sentence bridges are allowed if they don't contain questions.
        """
        if not isinstance(raw, str) or not raw.strip():
            return ""

        bridge = raw.strip().strip('"').strip("'").strip()

        # Strip trailing ellipsis and re-check
        if bridge.endswith("..."):
            bridge = bridge[:-3].strip()

        if not bridge:
            return ""

        # Reject any bridge containing a question mark — bridges must never ask questions
        if "?" in bridge:
            return ""

        # Max 8 words — enough variety without becoming a turn
        if len(bridge.split()) > 8:
            return ""

        # Reject evaluative commentary ("That's a great question!", "What a nice thought!")
        lower = bridge.lower()
        if lower.startswith(("that's a", "that's an", "what a", "what an")):
            return ""

        # Must end with sentence-ending punctuation (no questions)
        if bridge[-1] not in ".!":
            bridge += "."

        return bridge

    def _build_user_message(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
    ) -> str:
        """Build the user message with minimal context."""
        limit = self.history_limit or 2
        parts = []
        if conversation_history:
            recent = conversation_history[-limit:]
            lines = [f"[{msg['role'].upper()}]: {msg['content']}" for msg in recent]
            parts.append("CONTEXT:\n" + "\n".join(lines))

        parts.append(f"USER: {user_input}")
        return "\n\n".join(parts)
