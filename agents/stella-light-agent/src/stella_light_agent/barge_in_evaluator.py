"""Barge-in Evaluator — decides whether a user interruption is worth acting on.

When barge-in is enabled, the SDK suspends playback the instant the user starts
speaking, transcribes them, and hands the final transcript here. This stage uses
a dedicated, configurable LLM prompt to classify the interruption:

- COMMIT  → a real interruption (question/correction/stop/new request). The SDK
            discards the rest of the current reply and processes the transcript.
- RESUME  → backchannel/noise/filler. The SDK resumes playback from exactly
            where it was suspended; the transcript is discarded.

The prompt, model, provider, temperature, token budget and decision timeout are
all editable in the Agent Configurator (the "Barge-in Evaluator" node) and the
prompt supports template variables ({{bargeInTranscript}}, {{userInput}},
{{isBargeIn}}). The call is bounded by a tight wall-clock timeout
(BARGE_IN_EVAL_TIMEOUT_MS) defaulting to COMMIT, because the turn stays silent
until the decision resolves.
"""

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional

from stella_agent_sdk.messages.types import BargeInDecision

from stella_light_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider
from stella_light_agent.prompts.template import render_prompt

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
        self.provider = LLMProvider.OPENAI_LANGCHAIN
        self.max_tokens = 3
        self.temperature = 0.0
        self.custom_system_prompt: Optional[str] = None
        self.history_limit: int = 6  # recent turns of context for the decision
        # The decision sits on the user's barge-in latency: until it resolves,
        # playback is suspended and the user hears silence (base.py warns about
        # the RESUME path stalling). The 30s LLM request_timeout is far too loose
        # for that — bound the call tightly and default to COMMIT on timeout so a
        # slow classifier never leaves the user staring at a frozen agent.
        # Tunable via BARGE_IN_EVAL_TIMEOUT_MS.
        self.eval_timeout_s: float = float(
            os.getenv("BARGE_IN_EVAL_TIMEOUT_MS", "2000")
        ) / 1000

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from the Agent Configurator."""
        if "model" in config:
            self.model = config["model"]
        if "provider" in config:
            self.provider = self._parse_provider(config["provider"])
        if "max_tokens" in config:
            self.max_tokens = int(config["max_tokens"])
        if "temperature" in config:
            self.temperature = float(config["temperature"])
        if "system_prompt" in config:
            self.custom_system_prompt = config["system_prompt"]
        if "history_limit" in config:
            self.history_limit = int(config["history_limit"])
        if "timeout_ms" in config:
            self.eval_timeout_s = float(config["timeout_ms"]) / 1000

    @staticmethod
    def _parse_provider(provider: Any) -> LLMProvider:
        """Coerce a configured provider (enum or string) into an LLMProvider.

        Lets non-OpenAI deployments (e.g. Ollama) drive the evaluator from
        config instead of editing this file. Falls back to the OpenAI default
        on an unrecognised value rather than crashing the stage."""
        if isinstance(provider, LLMProvider):
            return provider
        try:
            return LLMProvider(str(provider).strip().lower())
        except ValueError:
            logger.warning(
                f"Unknown barge-in evaluator provider '{provider}'; "
                "falling back to openai_langchain"
            )
            return LLMProvider.OPENAI_LANGCHAIN

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

            # Bound the call on wall-clock: a suspended turn is silent until this
            # returns, so a slow LLM must not stall it. On timeout we fall through
            # to the except below and default to COMMIT (treat as a real turn).
            response = await asyncio.wait_for(
                self._llm_service.generate(
                    messages=[
                        LLMMessage(role="system", content=system_prompt),
                        LLMMessage(role="user", content=user_message),
                    ],
                    config=LLMConfig(
                        model=self.model,
                        temperature=self.temperature,
                        max_tokens=self.max_tokens,
                        provider=self.provider,
                        streaming=False,
                    ),
                    component_name="barge_in_evaluator",
                ),
                timeout=self.eval_timeout_s,
            )
            decision = self._parse_decision(response.content)
            latency_ms = (time.time() - start_time) * 1000
            logger.info(f"Barge-in '{transcript[:40]}' -> {decision.value} in {latency_ms:.0f}ms")
            return decision
        except asyncio.TimeoutError:
            latency_ms = (time.time() - start_time) * 1000
            logger.warning(
                f"Barge-in eval timed out after {latency_ms:.0f}ms "
                f"(limit {self.eval_timeout_s * 1000:.0f}ms) — defaulting to COMMIT"
            )
            return BargeInDecision.COMMIT
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
