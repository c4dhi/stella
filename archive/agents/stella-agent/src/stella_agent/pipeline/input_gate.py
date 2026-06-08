"""
Streaming Input Gate that makes routing decisions while streaming responses.
Uses [SAFE] and [UNSAFE] decision markers to route messages appropriately.

This is a simplified version for the Stella Agent SDK that:
- Yields AgentOutput messages instead of using StreamService
- Focuses on core SAFE/UNSAFE routing
- Parses structured LLM responses for routing decisions
- Integrates with PromptBuilder for state machine context
- TRUE TOKEN STREAMING: Streams MESSAGE tokens to frontend as they arrive
"""

import asyncio
import re
import json
import uuid
from typing import AsyncIterator, Dict, Any, Optional, List, TYPE_CHECKING
from dataclasses import dataclass

from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.messages.types import StatusSubtype

from stella_agent.llm.service import (
    LLMService,
    LLMConfig,
    LLMStreamingCallback,
    LLMMessage,
    LLMResponse,
)
from stella_agent.models.gate_result import GateResult, GateRoute

if TYPE_CHECKING:
    from stella_agent.prompts.builder import PromptBuilder

# Markers that indicate the end of MESSAGE section
_MESSAGE_END_MARKERS = ["DELIVERABLES:", "COMPLETED_TASKS:", "STATE_TRANSITION:"]
# Partial prefixes to buffer against (avoid streaming partial markers)
_MESSAGE_END_PREFIXES = ["D", "DE", "DEL", "DELI", "DELIV", "DELIVE", "DELIVER", "DELIVERA", "DELIVERAB", "DELIVERABL", "DELIVERABLE", "DELIVERABLES",
                         "C", "CO", "COM", "COMP", "COMPL", "COMPLE", "COMPLET", "COMPLETE", "COMPLETED", "COMPLETED_", "COMPLETED_T", "COMPLETED_TA", "COMPLETED_TAS", "COMPLETED_TASK", "COMPLETED_TASKS",
                         "S", "ST", "STA", "STAT", "STATE", "STATE_", "STATE_T", "STATE_TR", "STATE_TRA", "STATE_TRAN", "STATE_TRANS", "STATE_TRANSI", "STATE_TRANSIT", "STATE_TRANSITI", "STATE_TRANSITIO", "STATE_TRANSITION"]


class StreamingInputGateCallback(LLMStreamingCallback):
    """Callback for streaming input gate responses with real-time token parsing.

    Implements TRUE token streaming by:
    1. Parsing structured markers (THOUGHT, VERDICT, EXPERTS, etc.) as they arrive
    2. Streaming only MESSAGE content tokens to an async queue for frontend delivery
    3. Detecting MESSAGE section boundaries - stops streaming immediately when next section starts
    4. Buffering potential end markers to avoid streaming partial "DELIVERABLES:" or "STATE_TRANSITION:"
    5. All tokens after MESSAGE ends are only used for internal parsing, never streamed
    """

    def __init__(self, transcript_id: str, token_queue: asyncio.Queue):
        self.transcript_id = transcript_id
        self.accumulated_text = ""
        self.token_queue = token_queue

        # Parsed fields
        self.thought_detected = False
        self.thought = None
        self.verdict_detected = False
        self.verdict = None
        self.experts = None
        self.completed_tasks = None
        self.state_transition = None
        self.message_started = False
        self.message_ended = False  # Once True, no more tokens are streamed
        self.last_streamed_message = ""

        # For true streaming: track what we've already streamed
        self._streamed_message_length = 0
        # Buffer for potential end markers (to avoid streaming partial "DELIVERABLES:")
        self._pending_buffer = ""

    def _check_for_end_marker(self, text: str) -> tuple[bool, int]:
        """Check if text contains or starts with an end marker.

        Returns:
            (has_marker, marker_position) - marker_position is -1 if no marker found
        """
        for marker in _MESSAGE_END_MARKERS:
            pos = text.find(marker)
            if pos != -1:
                return True, pos
        return False, -1

    def _might_be_partial_marker(self, text: str) -> bool:
        """Check if text might be the start of an end marker."""
        text_upper = text.upper().strip()
        if not text_upper:
            return False
        for prefix in _MESSAGE_END_PREFIXES:
            if prefix.startswith(text_upper) or text_upper.endswith(prefix):
                return True
        return False

    async def on_token(self, token: str, accumulated_text: str) -> None:
        """Handle each new token from the LLM with true streaming support.

        Only streams tokens that are part of the MESSAGE section.
        Immediately stops streaming once DELIVERABLES: or STATE_TRANSITION: is detected.
        Uses buffering to avoid streaming partial end markers.
        """
        self.accumulated_text = accumulated_text

        # Parse THOUGHT
        if not self.thought_detected:
            thought_match = re.search(r'THOUGHT: (.+?)(?=VERDICT:|$)', self.accumulated_text, re.DOTALL)
            if thought_match:
                self.thought = thought_match.group(1).strip()
                self.thought_detected = True

        # Parse VERDICT (critical for routing)
        if not self.verdict_detected:
            if "VERDICT: [SAFE]" in self.accumulated_text:
                self.verdict = "safe"
                self.verdict_detected = True
            elif "VERDICT: [UNSAFE]" in self.accumulated_text:
                self.verdict = "unsafe"
                self.verdict_detected = True

        # Parse EXPERTS
        if self.verdict_detected and self.experts is None:
            experts_match = re.search(r'EXPERTS: \[([^\]]+)\]', self.accumulated_text)
            if experts_match:
                experts_str = experts_match.group(1)
                if experts_str.upper() == "NONE":
                    self.experts = []
                else:
                    self.experts = [e.strip() for e in experts_str.split(',')]

        # Detect MESSAGE section start
        if not self.message_started and "MESSAGE:" in self.accumulated_text:
            self.message_started = True

        # Stream MESSAGE content in real-time (only for SAFE route, only while MESSAGE section is active)
        if self.message_started and not self.message_ended and self.verdict == "safe":
            # Extract current MESSAGE content (everything after MESSAGE:)
            message_start_pos = self.accumulated_text.find("MESSAGE:")
            if message_start_pos != -1:
                current_message_raw = self.accumulated_text[message_start_pos + len("MESSAGE:"):]

                # Check if we've hit an end marker
                has_marker, marker_pos = self._check_for_end_marker(current_message_raw)

                if has_marker:
                    # MESSAGE section has ended - extract final content and stop streaming
                    self.message_ended = True
                    final_message = current_message_raw[:marker_pos].strip()
                    self.last_streamed_message = final_message

                    # Stream any remaining content up to the marker (minus what we already streamed)
                    if len(final_message) > self._streamed_message_length:
                        # First flush any pending buffer that's safe
                        remaining = final_message[self._streamed_message_length:]
                        if remaining:
                            await self.token_queue.put(("token", remaining))
                        self._streamed_message_length = len(final_message)

                    # Signal message streaming is complete
                    await self.token_queue.put(("message_end", final_message))
                else:
                    # No end marker yet - stream new content with buffering
                    current_message = current_message_raw.strip()

                    # Add new token to pending buffer
                    self._pending_buffer += token

                    # Check if pending buffer might be a partial end marker
                    if self._might_be_partial_marker(self._pending_buffer):
                        # Hold in buffer, don't stream yet
                        pass
                    else:
                        # Safe to stream the buffer
                        if self._pending_buffer and len(current_message) > self._streamed_message_length:
                            new_content = current_message[self._streamed_message_length:]
                            # Only stream content that's not potentially a marker
                            safe_content = new_content
                            # Check last few chars for potential marker start
                            for i in range(min(len(safe_content), 17), 0, -1):  # 17 = len("STATE_TRANSITION")
                                tail = safe_content[-i:]
                                if self._might_be_partial_marker(tail):
                                    safe_content = safe_content[:-i]
                                    break

                            if safe_content:
                                await self.token_queue.put(("token", safe_content))
                                self._streamed_message_length += len(safe_content)

                        self._pending_buffer = ""

                    self.last_streamed_message = current_message

        # Parse STATE_TRANSITION (internal only, never streamed)
        if self.state_transition is None:
            state_transition_match = re.search(r'STATE_TRANSITION: \[([^\]]+)\]', self.accumulated_text)
            if state_transition_match:
                transition_str = state_transition_match.group(1).strip()
                if transition_str.upper() == "NONE":
                    self.state_transition = None
                elif transition_str == '"READY"' or transition_str == 'READY':
                    self.state_transition = "READY"
                else:
                    self.state_transition = transition_str

    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete. Signal end of stream."""
        # If MESSAGE never ended explicitly (no DELIVERABLES/STATE_TRANSITION), finalize now
        if self.message_started and not self.message_ended and self.verdict == "safe":
            # Flush any remaining buffer
            if self._pending_buffer:
                await self.token_queue.put(("token", self._pending_buffer))
            await self.token_queue.put(("message_end", self.last_streamed_message))
        await self.token_queue.put(("complete", None))

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        print(f"[InputGate] Streaming error: {error}")
        await self.token_queue.put(("error", str(error)))

    def get_parsed_content(self) -> tuple:
        """Extract parsed fields from accumulated text."""
        thought = self.thought or ""
        verdict = self.verdict or "unsafe"  # Default to unsafe for safety
        experts = self.experts or []
        state_transition = self.state_transition

        # Extract deliverables JSON
        deliverables = {}
        deliverables_str = self._extract_deliverables_json(self.accumulated_text)
        if deliverables_str and deliverables_str != "[NONE]":
            deliverables = self._parse_deliverables_json(deliverables_str)

        # Extract COMPLETED_TASKS
        completed_tasks = []
        completed_tasks_str = self._extract_completed_tasks(self.accumulated_text)
        if completed_tasks_str:
            completed_tasks = completed_tasks_str

        # Extract MESSAGE
        message_match = re.search(r'MESSAGE: (.+?)(?=DELIVERABLES:|COMPLETED_TASKS:|STATE_TRANSITION:|$)', self.accumulated_text, re.DOTALL)
        message = message_match.group(1).strip() if message_match else ""

        return thought, verdict, experts, deliverables, completed_tasks, state_transition, message

    def _extract_completed_tasks(self, text: str) -> List[str]:
        """Extract COMPLETED_TASKS array from text."""
        completed_tasks_start = text.find('COMPLETED_TASKS: ')
        if completed_tasks_start == -1:
            return []

        start_pos = completed_tasks_start + len('COMPLETED_TASKS: ')
        remaining_text = text[start_pos:].strip()

        # Check for [NONE]
        if remaining_text.upper().startswith('[NONE]'):
            return []

        # Find JSON array
        if remaining_text.startswith('['):
            # Find matching closing bracket
            bracket_count = 0
            end_pos = 0
            for i, char in enumerate(remaining_text):
                if char == '[':
                    bracket_count += 1
                elif char == ']':
                    bracket_count -= 1
                    if bracket_count == 0:
                        end_pos = i + 1
                        break

            if end_pos > 0:
                json_str = remaining_text[:end_pos]
                try:
                    result = json.loads(json_str)
                    if isinstance(result, list):
                        return [str(item) for item in result]
                except json.JSONDecodeError:
                    # Try to fix common issues
                    fixed = json_str.replace("'", '"')
                    try:
                        result = json.loads(fixed)
                        if isinstance(result, list):
                            return [str(item) for item in result]
                    except json.JSONDecodeError:
                        print(f"[InputGate] Failed to parse completed_tasks JSON: {json_str[:100]}")

        return []

    def _extract_deliverables_json(self, text: str) -> Optional[str]:
        """Extract deliverables JSON from text."""
        deliverables_start = text.find('DELIVERABLES: ')
        if deliverables_start == -1:
            return None

        start_pos = deliverables_start + len('DELIVERABLES: ')
        remaining_text = text[start_pos:]

        if remaining_text.startswith('[NONE]'):
            return '[NONE]'

        if remaining_text.startswith('{'):
            # Find balanced braces
            brace_count = 0
            in_string = False
            escape_next = False
            end_pos = 0

            for i, char in enumerate(remaining_text):
                if escape_next:
                    escape_next = False
                    continue
                if char == '\\' and in_string:
                    escape_next = True
                    continue
                if char == '"' and not escape_next:
                    in_string = not in_string
                    continue
                if not in_string:
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            end_pos = i + 1
                            break

            if end_pos > 0:
                return remaining_text[:end_pos]

        # Fallback regex
        simple_match = re.search(r'DELIVERABLES: (\{.*?\})(?=\s*STATE_TRANSITION:|$)', text, re.DOTALL)
        if simple_match:
            return simple_match.group(1)

        return None

    def _parse_deliverables_json(self, json_str: str) -> Dict[str, Any]:
        """Parse deliverables JSON with error handling."""
        try:
            if not json_str or json_str.strip() == "":
                return {}

            cleaned_json = json_str.strip()

            try:
                return json.loads(cleaned_json)
            except json.JSONDecodeError:
                pass

            # Try fixing single quotes
            if "'" in cleaned_json and '"' not in cleaned_json:
                fixed_json = cleaned_json.replace("'", '"')
                try:
                    return json.loads(fixed_json)
                except json.JSONDecodeError:
                    pass

            return {}

        except Exception as e:
            print(f"[InputGate] JSON parsing error: {e}")
            return {}

    def get_current_message(self) -> str:
        """Get the current parsed message content."""
        return self.last_streamed_message


@dataclass
class InputGate:
    """Streaming input gate with routing decisions that yields AgentOutput.

    With State Machine integration:
    - Accepts state_machine_context for dynamic prompt building
    - Uses PromptBuilder for modular prompt composition
    """

    llm_service: LLMService
    config: Optional[LLMConfig] = None
    prompt_builder: Optional["PromptBuilder"] = None
    cancelled: bool = False

    # Track the last gate result for external access
    last_result: Optional[GateResult] = None

    def __post_init__(self):
        if self.config is None:
            self.config = self.llm_service.default_config
        if self.prompt_builder is None:
            from stella_agent.prompts.builder import PromptBuilder
            self.prompt_builder = PromptBuilder()

    def cancel(self):
        """Cancel ongoing processing."""
        self.cancelled = True

    async def process(
        self,
        session_id: str,
        user_input: str,
        context: str = "",
        conversation_history: Optional[List[Dict[str, str]]] = None,
        state_machine_context: Optional[Dict[str, Any]] = None
    ) -> AsyncIterator[AgentOutput]:
        """
        Process input with TRUE streaming response and routing decision.

        Implements real-time token streaming:
        - Tokens from MESSAGE section are streamed to frontend as they arrive from LLM
        - THOUGHT, VERDICT, EXPERTS are parsed internally without streaming
        - DELIVERABLES and STATE_TRANSITION are parsed after MESSAGE ends, never streamed

        Args:
            session_id: Session identifier
            user_input: User's message text
            context: Conversation context string (legacy, kept for compatibility)
            conversation_history: List of previous messages
            state_machine_context: Context from state machine for prompt building

        Yields AgentOutput messages and sets self.last_result with the final GateResult.
        """
        self.cancelled = False
        transcript_id = f"gate_{uuid.uuid4().hex[:8]}"

        try:
            print(f"[InputGate] Processing: '{user_input}'")

            # Yield processing status
            yield AgentOutput.status(
                session_id,
                "Analyzing input...",
                StatusSubtype.PROCESSING,
                component="input_gate",
                stage="analyzing"
            )

            # Create async queue for true token streaming
            token_queue: asyncio.Queue = asyncio.Queue()

            # Create streaming callback with queue
            callback = StreamingInputGateCallback(transcript_id, token_queue)

            # Build prompts using PromptBuilder with state machine context
            sm_context = state_machine_context or {}
            system_prompt = self.prompt_builder.build_system_prompt(sm_context)
            user_message = self.prompt_builder.build_user_message(
                user_input=user_input,
                conversation_history=conversation_history or [],
                context=sm_context
            )

            # Prepare messages
            messages = [
                LLMMessage(role="system", content=system_prompt),
                LLMMessage(role="user", content=user_message)
            ]

            # Debug: Show full prompt being sent to LLM
            yield AgentOutput.debug(
                session_id,
                "Full LLM prompt constructed",
                component="input_gate",
                stage="prompt_construction",
                system_prompt=system_prompt,
                user_message=user_message,
                total_prompt_length=len(system_prompt) + len(user_message)
            )

            # Start LLM generation in background task
            async def run_llm():
                return await self.llm_service.generate(
                    messages=messages,
                    config=self.config,
                    callback=callback,
                    component_name="input_gate"
                )

            llm_task = asyncio.create_task(run_llm())

            # Stream tokens from queue as they arrive (TRUE STREAMING)
            accumulated_message = ""
            message_streaming_started = False
            final_message = ""

            while True:
                if self.cancelled:
                    llm_task.cancel()
                    return

                try:
                    # Wait for next token with timeout
                    event_type, content = await asyncio.wait_for(
                        token_queue.get(),
                        timeout=0.1
                    )

                    if event_type == "token":
                        # Stream token to frontend immediately
                        accumulated_message += content
                        message_streaming_started = True
                        yield AgentOutput.text_chunk(
                            session_id,
                            accumulated_message.strip(),
                            transcript_id=transcript_id,
                            is_final=False
                        )

                    elif event_type == "message_end":
                        # MESSAGE section complete - send final chunk
                        final_message = content
                        if message_streaming_started:
                            yield AgentOutput.text_chunk(
                                session_id,
                                final_message,
                                transcript_id=transcript_id,
                                is_final=True
                            )

                    elif event_type == "complete":
                        # LLM finished - break out of loop
                        break

                    elif event_type == "error":
                        # Error during streaming
                        raise Exception(content)

                except asyncio.TimeoutError:
                    # Check if LLM task is done
                    if llm_task.done():
                        # Drain any remaining items from queue
                        while not token_queue.empty():
                            event_type, content = token_queue.get_nowait()
                            if event_type == "token":
                                accumulated_message += content
                            elif event_type == "message_end":
                                final_message = content
                        break
                    continue

            # Wait for LLM task to complete and get response
            llm_response = await llm_task

            if self.cancelled:
                return

            # Parse the structured response (internal fields)
            thought, verdict, experts, deliverables, completed_tasks, state_transition, clean_response = callback.get_parsed_content()

            print(f"[InputGate] Verdict: {verdict}, Experts: {experts}, Completed tasks: {completed_tasks}")

            # Determine route based on LLM verdict
            route = GateRoute.SAFE if verdict == "safe" else GateRoute.UNSAFE
            confidence = 0.9 if verdict == "safe" else 0.7

            # Debug: Route decision (internal information)
            yield AgentOutput.debug(
                session_id,
                f"Gate verdict: {route.value}",
                component="input_gate",
                verdict=verdict,
                route=route.value,
                experts=experts,
                confidence=confidence,
                has_state_context=bool(sm_context)
            )

            # For SAFE route: if streaming didn't happen (e.g., verdict determined late),
            # fall back to sending the complete message
            if route == GateRoute.SAFE and clean_response and not message_streaming_started:
                yield AgentOutput.text_chunk(
                    session_id,
                    clean_response,
                    transcript_id=transcript_id,
                    is_final=True
                )

            # Build expert configuration
            expert_configuration = None
            if route == GateRoute.UNSAFE and experts:
                expert_configuration = {
                    "experts": experts,
                    "reason": "input_gate_decision"
                }

            # Store result for external access
            self.last_result = GateResult(
                route=route,
                confidence=confidence,
                message=clean_response,
                experts_to_consult=experts,
                deliverables=deliverables,
                completed_tasks=completed_tasks,
                state_transition=state_transition,
                reasoning=thought,
                expert_configuration=expert_configuration or {}
            )

        except Exception as e:
            print(f"[InputGate] Error: {e}")
            import traceback
            traceback.print_exc()

            # Yield error
            yield AgentOutput.error(
                session_id,
                f"Input gate processing error: {str(e)}",
                error_type="input_gate_error",
                recoverable=True
            )

            # Fallback result - default to safe on error
            self.last_result = GateResult(
                route=GateRoute.SAFE,
                confidence=0.1,
                message="I'm having some technical difficulties. Let me try to help you anyway!",
                experts_to_consult=[],
                deliverables={},
                completed_tasks=[],
                state_transition=None,
                reasoning="Error fallback",
                expert_configuration={}
            )
