"""Stage 4: Response Generator — streaming final answer with arbitration context.

Takes the arbitration directive and injects it into the system prompt,
then streams the LLM response token-by-token via AgentOutput.text_chunk().

The directive section tells the LLM:
- What tone to use
- What must be included/avoided
- What the primary/secondary focus should be
- Expert summary context
"""

import asyncio
import uuid
from typing import Dict, Any, List, AsyncIterator, Optional

from stella_agent_sdk.messages.output import AgentOutput

from stella_agent_sdk.llm import (
    LLMService, LLMConfig, LLMMessage, LLMResponse,
    LLMStreamingCallback, LLMProvider,
)
from stella_v2_agent.models.arbitration_result import ResponseDirective
from stella_v2_agent.prompts.response_prompt import (
    build_response_system_prompt,
    build_response_user_message,
)
import logging

logger = logging.getLogger(__name__)


class _StreamingResponseCallback(LLMStreamingCallback):
    """Callback that pushes streaming tokens into an asyncio.Queue."""

    def __init__(self, queue: asyncio.Queue):
        self._queue = queue
        self._accumulated = ""

    async def on_token(self, token: str, accumulated_text: str) -> None:
        self._accumulated = accumulated_text
        await self._queue.put(("token", token))

    async def on_complete(self, final_response: LLMResponse) -> None:
        await self._queue.put(("complete", final_response))

    async def on_error(self, error: Exception) -> None:
        await self._queue.put(("error", error))


class ResponseGenerator:
    """Generates the final streaming response with arbitration context injected.

    The response system prompt includes:
    - Persona and conversation guidelines
    - State machine context (current state, tasks, deliverables)
    - Arbitration directive (expert guidance for this specific response)
    """

    def __init__(self, llm_service: LLMService):
        self._llm_service = llm_service

        # LLM config (overridable via apply_config)
        self.response_model = "gpt-4o-mini"
        self.response_max_tokens = 200
        self.response_temperature = 0.7
        self.custom_persona: Optional[str] = None
        self.custom_guidelines: Optional[str] = None
        self.history_limit: int = 0  # 0 = default (10)

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from Agent Configurator."""
        if "model" in config:
            self.response_model = config["model"]
        if "max_tokens" in config:
            self.response_max_tokens = int(config["max_tokens"])
        if "temperature" in config:
            self.response_temperature = float(config["temperature"])
        if "persona" in config:
            self.custom_persona = config["persona"]
        if "conversation_guidelines" in config:
            self.custom_guidelines = config["conversation_guidelines"]
        if "history_limit" in config:
            self.history_limit = int(config["history_limit"])

    async def generate(
        self,
        session_id: str,
        user_input: str,
        directive: ResponseDirective,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
        plan_system_prompt: Optional[str] = None,
        bridge: str = "",
        prepend: str = "",
        transcript_id: Optional[str] = None,
    ) -> AsyncIterator[AgentOutput]:
        """Generate a streaming response with arbitration context.

        Args:
            session_id: Current session ID.
            user_input: Current user message.
            directive: Arbitration directive with expert guidance.
            conversation_history: Recent conversation messages.
            sm_context: State machine context.
            plan_system_prompt: Optional custom system prompt from the plan.
            bridge: Optional bridge phrase already emitted to TTS. The LLM
                    continues from this prefix so the response is coherent.
            prepend: Optional deterministic, literature-informed line (from a
                    "prepend" verdict directive) spoken verbatim before the
                    generated reply. The LLM continues from it without repeating it.
            transcript_id: Optional transcript ID to reuse (shared with bridge chunk).

        Yields:
            AgentOutput.text_chunk() for each token, with is_final=True on the last one.
        """
        system_prompt = build_response_system_prompt(
            sm_context, directive, plan_system_prompt,
            custom_persona=self.custom_persona,
            custom_guidelines=self.custom_guidelines,
            conversation_history=conversation_history,
            history_limit=self.history_limit or 10,
            bridge=bridge,
        )
        user_message = build_response_user_message(user_input)

        messages = [
            LLMMessage(role="system", content=system_prompt),
            LLMMessage(role="user", content=user_message),
        ]

        # Spoken prefix already emitted to TTS that the LLM must continue from
        # without repeating: the early acknowledgment "bridge" and/or a deterministic
        # "prepend" safety line. They share the response transcript, so the LLM
        # output is appended after them into one seamless utterance.
        if prepend:
            spoken_prefix = f"{bridge} {prepend}".strip() if bridge else prepend
            already_said = []
            if bridge:
                already_said.append(f'you said "{bridge}" as a natural acknowledgment')
            already_said.append(f'the user was told, verbatim: "{prepend}"')
            messages.insert(1, LLMMessage(
                role="system",
                content=(
                    "Before your reply, " + " and ".join(already_said) + ". "
                    "That text has ALREADY been spoken to the user. Now continue with your "
                    "actual response. The combined output will be spoken as one seamless "
                    "utterance, so it MUST flow naturally as a single conversation turn.\n\n"
                    "Rules:\n"
                    "- Do NOT repeat, rephrase, or contradict anything already spoken above\n"
                    "- Do NOT comment on it or add another greeting/acknowledgment\n"
                    "- Pick up right where it left off — your continuation should feel like the same person kept talking"
                ),
            ))
            messages.append(LLMMessage(role="assistant", content=spoken_prefix))
        elif bridge:
            # The "continue seamlessly from the bridge" guidance lives in the
            # configurable response prompt (rendered via {{#if bridge}} / {{bridge}}
            # in build_response_system_prompt) so operators own it. Here we only
            # apply the structural mechanism: replay the bridge as the assistant's
            # own in-progress turn so the model literally continues it rather than
            # re-greeting. The two share one transcript_id → one seamless utterance.
            messages.append(LLMMessage(role="assistant", content=bridge))

        config = LLMConfig(
            model=self.response_model,
            temperature=self.response_temperature,
            max_tokens=self.response_max_tokens,
            provider=LLMProvider.OPENAI_LANGCHAIN,
            streaming=True,
        )

        if not transcript_id:
            transcript_id = f"response_{uuid.uuid4().hex[:8]}"
        queue: asyncio.Queue = asyncio.Queue()
        callback = _StreamingResponseCallback(queue)

        # Start LLM generation in background
        generation_task = asyncio.create_task(
            self._llm_service.generate(
                messages=messages,
                config=config,
                callback=callback,
                component_name="response_generator",
            )
        )

        # Prepend already-spoken prefix (bridge and/or deterministic safety line)
        # so TTS speaks prefix + response as one seamless utterance.
        spoken_prefix = " ".join(p for p in (bridge, prepend) if p)
        accumulated = (spoken_prefix + " ") if spoken_prefix else ""
        try:
            while True:
                event = await queue.get()
                event_type = event[0]

                if event_type == "token":
                    token = event[1]
                    accumulated += token
                    yield AgentOutput.text_chunk(
                        session_id,
                        accumulated.strip(),
                        transcript_id=transcript_id,
                        is_final=False,
                    )

                elif event_type == "complete":
                    # Send final chunk
                    if accumulated.strip():
                        yield AgentOutput.text_chunk(
                            session_id,
                            accumulated.strip(),
                            transcript_id=transcript_id,
                            is_final=True,
                        )
                    break

                elif event_type == "error":
                    error = event[1]
                    logger.error(f"Streaming error: {error}")
                    # Send error as final text
                    error_msg = "I'm sorry, I encountered an issue. Could you try again?"
                    yield AgentOutput.text_chunk(
                        session_id,
                        error_msg,
                        transcript_id=transcript_id,
                        is_final=True,
                    )
                    break

        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            if not generation_task.done():
                generation_task.cancel()
            raise

        # Ensure generation task completes
        if not generation_task.done():
            await generation_task
