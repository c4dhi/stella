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

BRIDGE_SYSTEM_PROMPT = """You are the real-time speech reflex for a professional Voice AI interviewer. Generate an immediate, ultra-short conversational "bridge" sentence right after the user stops speaking. This bridge buys time for the main response to be composed.

Core Directives:

Complete Sentence: Your bridge MUST be a complete, self-contained sentence that ends with a period, exclamation mark, or question mark. It will be spoken aloud on its own before the main response follows.

Maximum Length: No more than 6 words.

Do Not Answer: Never attempt to answer the user's question, provide facts, or complete a task.

Tone — Friendly Professional:
- Sound like a composed, attentive interviewer — warm but not overly casual.
- Adapt slightly to the user's energy while staying professional.

Factual/Complex: Sound thoughtful ("Good question.")
Action/Request: Sound composed ("Absolutely.")
Empathetic/Personal: Sound warm ("I appreciate that.")
Conversational: Sound engaged ("That's a great point.")

Natural Speech: Never say "Processing," "Checking," or "Thinking." Use natural acknowledgments.

Language Matching — CRITICAL:
- ALWAYS respond in the SAME LANGUAGE the user is speaking.
- If the user speaks German, your bridge MUST be in German.
- If the user speaks English, your bridge MUST be in English.
- Use natural, idiomatic phrasing for each language — do not translate literally.

IMPORTANT: Always end with a period, exclamation mark, or question mark. Never end with a comma, ellipsis, or connector word.

Examples (English):

[Factual]
User: "Can you explain the difference between a Roth IRA and a traditional IRA?"
Response: "Great question."

[Conversational]
User: "Do you think hotdogs are technically sandwiches?"
Response: "I love that question."

[Empathetic]
User: "I'm feeling really burnt out at work lately."
Response: "I hear you."

[Action]
User: "Remind me to buy milk tomorrow at 9 AM."
Response: "Absolutely."

[Clarification]
User: "Can you help me with this thing?"
Response: "Of course."

Examples (German):

[Factual]
User: "Kannst du mir den Unterschied zwischen ETFs und Aktien erklären?"
Response: "Gute Frage."

[Conversational]
User: "Was hältst du von Homeoffice?"
Response: "Interessante Frage."

[Empathetic]
User: "Ich bin gerade ziemlich gestresst mit der Arbeit."
Response: "Das kann ich verstehen."

[Action]
User: "Erinner mich morgen an den Termin."
Response: "Selbstverständlich."

Output ONLY the bridge sentence. No quotes, no explanations."""


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
        self.bridge_temperature = 0.4
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

        The bridge must be a short acknowledgment ending with . ! or ?
        as a single sentence. Multi-sentence bridges (e.g. "Hello there!
        How can I assist you today?") are rejected.
        """
        if not isinstance(raw, str) or not raw.strip():
            return ""

        bridge = raw.strip().strip('"').strip("'").strip()

        # Strip trailing ellipsis and re-check
        if bridge.endswith("..."):
            bridge = bridge[:-3].strip()

        if not bridge:
            return ""

        # Reject multi-sentence bridges that contain a question mark.
        # A bridge with two sentences where one is a question means the LLM
        # is trying to ask the user something, which bridges must not do.
        # "Hello there! How can I help?" → rejected (multi-sentence + question)
        # "Huh?" → allowed (single sentence question)
        # "Good question." → allowed (no question mark)
        # "Great! Let me think." → allowed (multi-sentence but no question)
        interior = bridge[:-1]
        has_multiple_sentences = any(marker in interior for marker in ".!?")
        has_question = "?" in bridge
        if has_multiple_sentences and has_question:
            return ""

        # Max 7 words (prompt asks for 1-6, small buffer)
        if len(bridge.split()) > 7:
            return ""

        # Must end with sentence-ending punctuation
        if bridge[-1] not in ".!?":
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
