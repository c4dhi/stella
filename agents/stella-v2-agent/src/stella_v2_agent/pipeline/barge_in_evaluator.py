"""Barge-in Evaluator — decides whether a user interruption is worth acting on.

When barge-in is enabled, the SDK suspends playback the instant the user starts
speaking, transcribes them, and hands the final transcript here. This stage uses
a dedicated, configurable LLM prompt to classify the interruption:

- COMMIT  → a real interruption (question/correction/stop/new request). The SDK
            discards the rest of the current reply and processes the transcript.
- RESUME  → backchannel/noise/filler. The SDK resumes playback from exactly
            where it was suspended; the transcript is discarded.

The prompt, model, temperature and token budget are all editable in the Agent
Configurator (the "Barge-in Evaluator" node) and support template variables
({{bargeInTranscript}}, {{userInput}}, {{isBargeIn}}).
"""

import logging
import time
from typing import Any, Dict, List, Optional

from stella_agent_sdk.messages.types import BargeInDecision

from stella_v2_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider
from stella_v2_agent.prompts.template import render_prompt

logger = logging.getLogger(__name__)

BARGE_IN_SYSTEM_PROMPT = """You decide whether a user's interruption of the assistant's speech is a real interruption that should be acted on, or just a backchannel/noise that should be ignored so the assistant keeps talking.

You are given the conversation so far and what the user just said while the assistant was speaking. JUDGE IT IN CONTEXT.

Output COMMIT if the user's words are meaningful given the conversation — a relevant answer to what the assistant just asked, a question, a correction, a new request, a clear "stop"/"wait", or a change of topic. An on-topic answer (e.g. giving their name right after being asked for it) is a real turn and must COMMIT.

Output RESUME if it was just acknowledgement, agreement, thinking-aloud, or noise that does not require the assistant to stop — e.g. "mhm", "yeah", "right", "go on", a cough, or a few filler words.

When unsure, prefer COMMIT — ignoring a real interruption is worse than briefly pausing.

Output ONLY one word: COMMIT or RESUME."""


class BargeInEvaluator:
    """Classifies a user barge-in as COMMIT (act on it) or RESUME (ignore it)."""

    def __init__(self, llm_service: LLMService):
        self._llm_service = llm_service

        # LLM config (overridable via apply_config from the Agent Configurator).
        self.model = "gpt-4o-mini"
        self.max_tokens = 3
        self.temperature = 0.0
        self.custom_system_prompt: Optional[str] = None
        self.history_limit: int = 6  # recent turns of context for the decision

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from the Agent Configurator."""
        if "model" in config:
            self.model = config["model"]
        if "max_tokens" in config:
            self.max_tokens = int(config["max_tokens"])
        if "temperature" in config:
            self.temperature = float(config["temperature"])
        if "system_prompt" in config:
            self.custom_system_prompt = config["system_prompt"]
        if "history_limit" in config:
            self.history_limit = int(config["history_limit"])

    async def evaluate(
        self,
        transcript: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        variables: Optional[Dict[str, Any]] = None,
    ) -> BargeInDecision:
        """Decide whether to commit or resume given the barge-in transcript.

        The conversation history is included so the decision is made IN CONTEXT
        — e.g. an on-topic answer to the assistant's last question is a real
        turn (COMMIT), not noise. Falls back to COMMIT on any error — never
        silently swallow a real interruption because the classifier failed.
        """
        if not transcript or not transcript.strip():
            # Nothing intelligible was said — treat as noise, keep speaking.
            return BargeInDecision.RESUME

        ctx: Dict[str, Any] = {
            "bargeInTranscript": transcript,
            "userInput": transcript,
            "isBargeIn": True,
        }
        if variables:
            ctx.update(variables)

        start_time = time.time()
        try:
            raw_prompt = self.custom_system_prompt or BARGE_IN_SYSTEM_PROMPT
            system_prompt = render_prompt(raw_prompt, ctx)
            user_message = self._build_user_message(transcript, conversation_history)

            response = await self._llm_service.generate(
                messages=[
                    LLMMessage(role="system", content=system_prompt),
                    LLMMessage(role="user", content=user_message),
                ],
                config=LLMConfig(
                    model=self.model,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                    provider=LLMProvider.OPENAI_LANGCHAIN,
                    streaming=False,
                    json_mode=False,
                ),
                component_name="barge_in_evaluator",
            )
            decision = self._parse_decision(response.content)
            latency_ms = (time.time() - start_time) * 1000
            logger.info(f"Barge-in '{transcript[:40]}' -> {decision.value} in {latency_ms:.0f}ms")
            return decision
        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            logger.error(f"Barge-in eval failed in {latency_ms:.0f}ms: {e} — defaulting to COMMIT")
            return BargeInDecision.COMMIT

    def _build_user_message(
        self,
        transcript: str,
        conversation_history: Optional[List[Dict[str, str]]],
    ) -> str:
        """Build the user message with recent conversation context so the
        decision is made in context, not on the bare interruption alone."""
        parts = []
        if conversation_history:
            recent = conversation_history[-self.history_limit:]
            lines = [
                f"[{(msg.get('role') or 'user').upper()}]: {msg.get('content', '')}"
                for msg in recent
            ]
            parts.append("CONVERSATION SO FAR:\n" + "\n".join(lines))
        parts.append(f"USER (interrupting while assistant was speaking): {transcript}")
        return "\n\n".join(parts)

    @staticmethod
    def _parse_decision(raw: str) -> BargeInDecision:
        """Parse the LLM output into a decision. Defaults to COMMIT when the
        output does not clearly say RESUME."""
        text = (raw or "").strip().lower()
        if "resume" in text and "commit" not in text:
            return BargeInDecision.RESUME
        return BargeInDecision.COMMIT
