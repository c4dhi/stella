"""Bridge Generator — ultra-short conversational bridge for early TTS synthesis.

Generates a 1-6 word "bridge" phrase that buys time while the main pipeline
(gate → experts → arbitration → response) completes. Runs in parallel with
the Input Gate via asyncio.gather().

On failure: returns "" silently. The bridge is optional and never blocks the pipeline.
"""

import time
from typing import Dict, Any, List

from stella_v2_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider

BRIDGE_SYSTEM_PROMPT = """You are the real-time speech reflex for an advanced Voice AI. Your sole purpose is to generate an immediate, ultra-short conversational "bridge" (1 to 6 words) right after the user stops speaking. This bridge buys time for the main brain to compute the full answer.

Core Directives:

Maximum Length: You must output no more than 6 words.

Do Not Answer: Never attempt to answer the user's question, provide facts, or complete a task.

Syntactic Openness: Always end your phrase in a way that allows a new sentence to smoothly attach to it. Use words like "...so," "...well," "...alright," "...and," or just leave the thought trailing.

Tone Matching: Match the emotional state and intent of the user.

Factual/Complex: Sound thoughtful ("Hmm, let's see...")
Command/Action: Sound brisk and confirmative ("You got it, so...")
Empathetic/Sad: Sound gentle and supportive ("Oh, I hear you, and...")
Casual/Banter: Sound relaxed ("Oh, definitely. I think...")

Zero Robotics: Never say "Processing," "Checking my database," or "Thinking." Use natural human verbal ticks (Hmm, Ah, Gotcha, Yeah, Oh).

Examples of Correct Behavior:

[Context: Complex / Factual]
User: "Can you explain the difference between a Roth IRA and a traditional IRA?"
Response: "Hmm, IRAs, alright. Essentially..."

[Context: Casual / Banter]
User: "Do you think hotdogs are technically sandwiches?"
Response: "Oh, that's a classic. Well..."

[Context: Empathetic / Personal]
User: "I'm feeling really burnt out at work lately."
Response: "I'm so sorry to hear that. Listen..."

[Context: Transactional / Command]
User: "Remind me to buy milk tomorrow at 9 AM."
Response: "Got it, scheduled. So..."

[Context: Urgent / Fast]
User: "Wait, stop reading that!"
Response: "Whoops, stopping now. Anyway..."

[Context: Vague / Needs Clarification]
User: "Can you help me with this thing?"
Response: "Of course I can, let's..."

Output ONLY the bridge phrase. No quotes, no explanations."""


class BridgeGenerator:
    """Generates a short conversational bridge for early TTS synthesis.

    Uses a dedicated LLM call with higher temperature for natural variety.
    Runs in parallel with InputGate.classify() — whichever finishes first
    is used immediately.
    """

    BRIDGE_MODEL = "gpt-4o-mini"
    BRIDGE_MAX_TOKENS = 30
    BRIDGE_TEMPERATURE = 0.4

    def __init__(self, llm_service: LLMService):
        self._llm_service = llm_service

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

            messages = [
                LLMMessage(role="system", content=BRIDGE_SYSTEM_PROMPT),
                LLMMessage(role="user", content=user_message),
            ]

            config = LLMConfig(
                model=self.BRIDGE_MODEL,
                temperature=self.BRIDGE_TEMPERATURE,
                max_tokens=self.BRIDGE_MAX_TOKENS,
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
                print(f"[BridgeGenerator] '{bridge}' in {latency_ms:.0f}ms")
            return bridge

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            print(f"[BridgeGenerator] Failed in {latency_ms:.0f}ms: {e}")
            return ""

    @staticmethod
    def _validate_bridge(raw: str) -> str:
        """Validate the bridge phrase. Returns "" if invalid."""
        if not isinstance(raw, str) or not raw.strip():
            return ""

        bridge = raw.strip().strip('"').strip("'").strip()

        if not bridge:
            return ""

        # Max 8 words (prompt asks for 1-6, small buffer)
        if len(bridge.split()) > 8:
            return ""

        # Must end with sentence-ending char or trailing "..."
        if bridge.endswith("..."):
            return bridge
        if bridge[-1] in ".!?,":
            return bridge

        return ""

    @staticmethod
    def _build_user_message(
        user_input: str,
        conversation_history: List[Dict[str, str]],
    ) -> str:
        """Build the user message with minimal context."""
        parts = []
        if conversation_history:
            recent = conversation_history[-2:]
            lines = [f"[{msg['role'].upper()}]: {msg['content']}" for msg in recent]
            parts.append("CONTEXT:\n" + "\n".join(lines))

        parts.append(f"USER: {user_input}")
        return "\n\n".join(parts)
