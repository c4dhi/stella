"""Bridge Generator — ultra-short conversational bridge for early TTS synthesis.

Generates a 1-6 word "bridge" phrase that buys time while the main pipeline
(gate → experts → arbitration → response) completes. Runs in parallel with
the Input Gate via asyncio.gather().

On failure: returns "" silently. The bridge is optional and never blocks the pipeline.
"""

import time
from typing import Dict, Any, List, Optional

from stella_v2_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider
import logging

logger = logging.getLogger(__name__)

BRIDGE_SYSTEM_PROMPT = """You are producing a real-time spoken filler — the kind of thing a warm, emotionally attuned person says while they gather their thoughts. This will be read aloud by a TTS engine, so it must sound completely natural when spoken. No written-language artifacts.

MATCH THE ENERGY of what the user just said:
- Unclear or garbled input: neutral, no content claims. "Okay, one moment." / "Let me think about that."
- Very short (yes/no/okay): equally short. "Okay." / "Got it." / "Alright."
- Conversational: react to the FEELING, not just the words. If they sound tired, reflect tiredness. If they're excited, match that warmth.
- Emotional or vulnerable: show you felt it. Don't just acknowledge — resonate.

CRITICAL CONSTRAINTS:
1. This is ONLY a filler. NEVER answer, inform, advise, or complete any task.
2. NEVER ask a question. No question marks.
3. NEVER use the same bridge twice in a conversation.
4. Must end with a period or exclamation mark.
5. Only use words and phrases that sound natural when spoken aloud by a TTS model. Avoid sounds like "mhm", "hmm", "uh-huh", "ah" — these do not render well in TTS. Use real words instead.

WHAT MAKES IT FEEL REAL:
Think about how a good listener actually responds. They don't say "Great point." They say things like "Oh wow, yeah." or "That's actually really cool." or "I can totally see that." The bridge should feel like a genuine human micro-reaction, not a customer service acknowledgment.

A few examples to calibrate (don't copy these, find your own):
- "Oh nice, okay." / "Yeah, that makes sense." / "Oh I love that." / "That sounds really tough actually."

LANGUAGE: Always match the user's language. If German, use natural spoken German, not translated English.

Output ONLY the bridge. No quotes, no labels, no explanation."""


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
            A validated bridge phrase (1-8 words), or "" on failure.
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

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            logger.error(f"Failed in {latency_ms:.0f}ms: {e}")
            return ""

    @staticmethod
    def _validate_bridge(raw: str) -> str:
        """Validate the bridge phrase. Returns "" if invalid.

        The bridge must be a short spoken acknowledgment ending with . or !
        Questions are always rejected — bridges must never ask the user anything.
        Multi-sentence bridges are allowed if they don't contain questions.
        Max 15 words to allow complexity-scaled bridges.
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

        # Max 15 words (prompt scales 1-15 based on complexity)
        if len(bridge.split()) > 15:
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
