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

BRIDGE_SYSTEM_PROMPT = """You are a professional interviewer's real-time speech reflex. When the user finishes speaking, you produce a natural spoken acknowledgment that holds the conversational floor while the full response is being prepared.

SCALING RULE — match your bridge length and tone to the user's input complexity:
- Very short input (yes, no, ok, nah, sure, maybe, nope): 1-2 words ONLY. Use minimal acknowledgments like "Mhm." / "Okay." / "Alright." / "Got it." / "I see." — NEVER react as if they said something substantial. "No" does NOT deserve "That's an interesting point."
- Simple input (greeting, short answer, a single fact): 1-3 words. ("Sure." / "Got it." / "Right.")
- Moderate input (a statement, a preference, a fact): 4-8 words. ("That makes a lot of sense.")
- Complex input (emotional, multi-part, detailed story): 8-15 words. Reflect or paraphrase ONE element. ("It sounds like that's been weighing on you.")

ABSOLUTE RULES:
1. NEVER answer the user's question, provide information, or complete a task.
2. NEVER answer social questions ("How are you?" → "Hey, nice to meet you." NOT "I'm doing well.")
3. NEVER ask the user a question. No question marks.
4. NEVER repeat a bridge you used in the previous turn (check the conversation context).
5. Must be a complete sentence ending with a period or exclamation mark.
6. Must sound like something a real person would say mid-conversation, not a canned response.

WHAT MAKES A GOOD BRIDGE:
- For very short inputs (yes/no/ok): the SMALLEST possible acknowledgment. "Mhm." "Okay." "Alright." "I see." — nothing more. Do NOT inflate a one-word answer into a compliment or commentary.
- For simple inputs: a warm, varied micro-acknowledgment. Rotate between different phrasings — avoid defaulting to the same 3-4 phrases.
- For moderate inputs: react to WHAT they said, not just THAT they said it. ("Running three times a week, that's solid." not "Great.")
- For complex/emotional inputs: paraphrase or reflect one specific element to show you heard them. ("Dealing with that on top of everything else." not "I understand.")

VARIETY IS CRITICAL:
You must never produce the same bridge twice in a conversation. Draw from natural spoken language:
- Micro-reactions: "Right." / "Sure thing." / "Absolutely."
- Content echoes: "Three times a week, nice." / "So mainly running."
- Empathic reflections: "That really does take a toll." / "I can see why that's frustrating."
- Engaged acknowledgments: "That's a really interesting way to put it."
Do NOT rely on: "Great question." / "Good point." / "I hear you." / "I appreciate that." — these are overused.

LANGUAGE MATCHING — CRITICAL:
- ALWAYS respond in the SAME LANGUAGE the user is speaking.
- If German, use natural German idiom — not translated English.
  Good: "Ja, das ergibt Sinn." / "Verstehe, das ist nicht einfach."
  Bad: "Gute Frage." (overused) / "Das schätze ich." (translated English)

Output ONLY the bridge sentence. No quotes, no explanations, no question marks."""


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
