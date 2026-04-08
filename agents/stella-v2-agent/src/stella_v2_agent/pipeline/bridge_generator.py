"""Bridge Generator — natural conversational bridge for early TTS synthesis.

Generates a brief, human-sounding acknowledgment (1-15 words, scaled to
the user's energy) that buys time while the main pipeline
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

BRIDGE_SYSTEM_PROMPT = """You are a person in a conversation. You just heard what the user said and you're about to give your full answer, but first you naturally acknowledge them — the way a real human would before continuing their thought. This will be spoken aloud by TTS.

Think of how people actually talk. When someone tells you something, you don't just launch into your answer — you react briefly first. The bridge is that brief, human moment.

LENGTH RULE — match the user's energy:
- One word from user ("yes", "no", "okay") → one-two words from you. "Sure." / "Yeah." / "Okay."
- A greeting ("hi", "hello") → greet back casually. "Hey." / "Hi there." / "Hello."
- A short sentence → a short acknowledgment, up to 5-6 words. "Yeah, I get that." / "Okay, gotcha."
- A longer thought or story → you can reflect back briefly, up to 12 words. "Right, yeah, that sounds like it's been on your mind." / "Okay, so you've been dealing with that for a while."
- Something emotional or vulnerable → warm but grounded. "Yeah, I hear you." / "Right, that makes total sense."

WHAT MAKES A GOOD BRIDGE:
- It sounds like something a real person would say mid-conversation
- It can reference what the user said WITHOUT answering, advising, or completing any task
- It feels like a natural lead-in to whatever comes next
- It uses casual spoken language (contractions, "yeah" instead of "yes", etc.)

WHAT TO AVOID:
- NEVER answer the user's question or give advice — you're just acknowledging before your real answer
- NEVER ask a question. No question marks.
- NEVER be a cheerleader — no "Oh that's wonderful!", "That's amazing!", "Great question!"
- NEVER evaluate what they said — no "That's interesting", "That's a good point"
- NEVER use filler sounds that render poorly in TTS: "mhm", "hmm", "uh-huh", "ah"
- NEVER use the same bridge twice in a conversation

EXAMPLES (user → bridge):
- "I've been running three times a week" → "Oh nice, okay."
- "Not really, I've been pretty lazy" → "Yeah, no worries."
- "I hurt my knee last month so I can't really exercise" → "Oh okay, yeah, that's tough."
- "hello" → "Hey."
- "yes" → "Okay."
- "I don't know, I guess I just haven't had the motivation lately and work has been really stressful" → "Yeah, okay, I get that, it's been a lot."

LANGUAGE: Always match the user's language.

Output ONLY the bridge. No quotes, no labels, no explanation."""

# Short fallback bridges used when LLM generation fails or is rejected.
# Ensures every turn gets a bridge for consistent perceived latency.
FALLBACK_BRIDGES = [
    "Okay, yeah.",
    "Right, okay.",
    "Got it.",
    "Sure, okay.",
    "Yeah, I hear you.",
    "Alright.",
    "Okay, let me think.",
    "Yeah, gotcha.",
]

# Greeting-specific fallbacks for when user says hello/hi/hey.
GREETING_FALLBACKS = [
    "Hey.",
    "Hi there.",
    "Hello.",
    "Hey, hi.",
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
        self.bridge_max_tokens = 50
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
            A validated bridge phrase (1-15 words, scaled to user energy). Always returns a bridge (fallback on failure).
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

        The bridge must be a natural spoken acknowledgment ending with . or !
        Questions are always rejected — bridges must never ask the user anything.
        Evaluative commentary is rejected — bridges must not judge the user's input.
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

        # Max 15 words — allows longer bridges that reference user input
        if len(bridge.split()) > 15:
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
