"""Stage 1: Input Gate — fast JSON classification.

Classifies user input and selects which experts to activate.
Non-streaming LLM call with JSON mode for structured output.
Target latency: ~100-200ms.

On failure: returns a predefined error result. The agent sends a hardcoded
clarification message to narration. No expert/response generation.
"""

import json
import time
from typing import Dict, Any, List, Optional

from stella_v2_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider
from stella_v2_agent.models.gate_result import GateResult
from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.prompts.input_gate_prompt import (
    build_input_gate_system_prompt,
    build_input_gate_user_message,
)


class InputGate:
    """Input Gate: classifies input and selects experts to activate.

    Uses a fast, non-streaming JSON-mode LLM call to determine
    which experts should analyze the current user message.
    """

    # LLM config optimized for fast classification
    GATE_MODEL = "gpt-4o-mini"
    GATE_MAX_TOKENS = 60
    GATE_TEMPERATURE = 0.0

    def __init__(self, llm_service: LLMService, expert_registry: ExpertRegistry):
        self._llm_service = llm_service
        self._registry = expert_registry

    async def classify(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
    ) -> GateResult:
        """Classify the user input and select experts to run.

        Args:
            user_input: The current user message.
            conversation_history: Recent conversation messages.
            sm_context: State machine context (current state, tasks, deliverables).

        Returns:
            GateResult with selected experts.
        """
        start_time = time.time()

        try:
            system_prompt = build_input_gate_system_prompt(
                available_experts=self._registry.get_summaries(),
                sm_context=sm_context,
            )
            user_message = build_input_gate_user_message(user_input, conversation_history)

            messages = [
                LLMMessage(role="system", content=system_prompt),
                LLMMessage(role="user", content=user_message),
            ]

            config = LLMConfig(
                model=self.GATE_MODEL,
                temperature=self.GATE_TEMPERATURE,
                max_tokens=self.GATE_MAX_TOKENS,
                provider=LLMProvider.OPENAI_LANGCHAIN,
                streaming=False,
                json_mode=True,
            )

            response = await self._llm_service.generate(
                messages=messages,
                config=config,
                component_name="input_gate",
            )

            latency_ms = (time.time() - start_time) * 1000
            return self._parse_response(response.content, user_input, latency_ms)

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            print(f"[InputGate] Classification failed: {e}")
            return GateResult(
                failed=True,
                cleaned_input=user_input,
                latency_ms=latency_ms,
            )

    def _parse_response(self, raw_content: str, user_input: str, latency_ms: float) -> GateResult:
        """Parse the LLM's JSON response into a GateResult."""
        try:
            data = json.loads(raw_content)
        except json.JSONDecodeError:
            print(f"[InputGate] Invalid JSON response: {raw_content[:200]}")
            return GateResult(
                failed=True,
                cleaned_input=user_input,
                latency_ms=latency_ms,
            )

        raw_experts = data.get("experts", [])
        if not isinstance(raw_experts, list):
            raw_experts = []

        # Filter to only valid, enabled experts
        valid_experts = self._registry.filter_valid_names(raw_experts)

        return GateResult(
            experts=valid_experts,
            cleaned_input=user_input,
            latency_ms=latency_ms,
        )
