"""
LightProcessor - Single LLM call with streaming and deliverable extraction.

Replaces the InputGate/ExpertPool/Aggregator pipeline with a simpler approach:
- One LLM call that streams the response
- Parses response for MESSAGE content (streamed to user)
- Extracts DELIVERABLES JSON at the end
"""

import asyncio
import json
import re
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator, Dict, Any, Optional, List

from stella_agent_sdk.messages.output import AgentOutput

from stella_light_agent.llm.service import (
    LLMService,
    LLMStreamingCallback,
    LLMMessage,
    LLMResponse,
)


@dataclass
class ProcessorResult:
    """Result from LightProcessor."""
    message: str
    deliverables: Dict[str, Any]
    completed_tasks: List[str] = field(default_factory=list)
    skipped_tasks: List[str] = field(default_factory=list)


# Markers that indicate the end of MESSAGE section
_MESSAGE_END_MARKERS = ["DELIVERABLES:", "COMPLETED_TASKS:", "SKIPPED_TASKS:"]
# Partial prefixes to buffer against
_MESSAGE_END_PREFIXES = [
    "D", "DE", "DEL", "DELI", "DELIV", "DELIVE", "DELIVER",
    "DELIVERA", "DELIVERAB", "DELIVERABL", "DELIVERABLE", "DELIVERABLES",
    "C", "CO", "COM", "COMP", "COMPL", "COMPLE", "COMPLET", "COMPLETE",
    "COMPLETED", "COMPLETED_", "COMPLETED_T", "COMPLETED_TA", "COMPLETED_TAS",
    "COMPLETED_TASK", "COMPLETED_TASKS",
    "S", "SK", "SKI", "SKIP", "SKIPP", "SKIPPE", "SKIPPED",
    "SKIPPED_", "SKIPPED_T", "SKIPPED_TA", "SKIPPED_TAS",
    "SKIPPED_TASK", "SKIPPED_TASKS"
]


class LightStreamingCallback(LLMStreamingCallback):
    """Callback for streaming responses with real-time token parsing.

    Implements token streaming by:
    1. Parsing MESSAGE: marker to start streaming
    2. Streaming MESSAGE content tokens to an async queue
    3. Detecting DELIVERABLES: marker to stop streaming
    4. Buffering potential markers to avoid partial streaming
    """

    def __init__(self, transcript_id: str, token_queue: asyncio.Queue):
        self.transcript_id = transcript_id
        self.token_queue = token_queue
        self.accumulated_text = ""

        # Parsing state
        self.message_started = False
        self.message_ended = False
        self.message_content = ""
        self._pending_buffer = ""

    def _check_for_end_marker(self, text: str) -> tuple:
        """Check if text contains an end marker.

        Returns:
            (has_marker, marker_position)
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
        """Handle each new token from the LLM with streaming support."""
        self.accumulated_text = accumulated_text

        # If message has ended, just accumulate for parsing
        if self.message_ended:
            return

        # Check if MESSAGE: has started
        if not self.message_started:
            if "MESSAGE:" in accumulated_text:
                self.message_started = True
                # Extract content after MESSAGE:
                start_idx = accumulated_text.find("MESSAGE:") + len("MESSAGE:")
                self.message_content = accumulated_text[start_idx:].lstrip()

                # Check if we already have an end marker
                has_marker, marker_pos = self._check_for_end_marker(self.message_content)
                if has_marker:
                    # MESSAGE section is complete in one chunk
                    self.message_content = self.message_content[:marker_pos].strip()
                    self.message_ended = True
                    await self.token_queue.put(("message_end", self.message_content))
                else:
                    # Stream what we have so far
                    if self.message_content:
                        await self.token_queue.put(("token", self.message_content))
            return

        # We're in the MESSAGE section - handle new token
        # Add to pending buffer
        self._pending_buffer += token

        # Check if pending buffer contains end marker
        has_marker, marker_pos = self._check_for_end_marker(self._pending_buffer)
        if has_marker:
            # Stream content before marker
            safe_content = self._pending_buffer[:marker_pos].rstrip()
            if safe_content:
                self.message_content += safe_content
                await self.token_queue.put(("token", safe_content))

            self.message_ended = True
            await self.token_queue.put(("message_end", self.message_content.strip()))
            self._pending_buffer = ""
            return

        # Check if pending buffer might be a partial marker
        if self._might_be_partial_marker(self._pending_buffer):
            # Keep buffering
            return

        # Safe to stream the pending buffer
        if self._pending_buffer:
            self.message_content += self._pending_buffer
            await self.token_queue.put(("token", self._pending_buffer))
            self._pending_buffer = ""

    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete."""
        # Flush any remaining buffer
        if self._pending_buffer and not self.message_ended:
            self.message_content += self._pending_buffer
            await self.token_queue.put(("token", self._pending_buffer))
            self._pending_buffer = ""

        if not self.message_ended:
            await self.token_queue.put(("message_end", self.message_content.strip()))

        await self.token_queue.put(("complete", None))

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        await self.token_queue.put(("error", str(error)))

    def get_parsed_content(self) -> tuple:
        """Get the parsed message, deliverables, completed tasks, and skipped tasks.

        Returns:
            (message, deliverables_dict, completed_tasks_list, skipped_tasks_list)
        """
        message = self.message_content.strip()
        deliverables = {}
        completed_tasks = []
        skipped_tasks = []

        # Parse DELIVERABLES section
        if "DELIVERABLES:" in self.accumulated_text:
            deliv_idx = self.accumulated_text.find("DELIVERABLES:") + len("DELIVERABLES:")
            deliv_section = self.accumulated_text[deliv_idx:].strip()

            # Cut off at next section marker if present
            for marker in ["COMPLETED_TASKS:", "SKIPPED_TASKS:"]:
                marker_pos = deliv_section.find(marker)
                if marker_pos != -1:
                    deliv_section = deliv_section[:marker_pos].strip()

            # Check for [NONE]
            if deliv_section.upper().startswith("[NONE]"):
                deliverables = {}
            else:
                # Try to parse JSON
                deliverables = self._extract_json(deliv_section)

        # Parse COMPLETED_TASKS section
        if "COMPLETED_TASKS:" in self.accumulated_text:
            tasks_idx = self.accumulated_text.find("COMPLETED_TASKS:") + len("COMPLETED_TASKS:")
            tasks_section = self.accumulated_text[tasks_idx:].strip()

            # Cut off at the SKIPPED_TASKS marker if it follows.
            skip_pos = tasks_section.find("SKIPPED_TASKS:")
            if skip_pos != -1:
                tasks_section = tasks_section[:skip_pos].strip()

            # Check for [NONE]
            if tasks_section.upper().startswith("[NONE]"):
                completed_tasks = []
            else:
                # Try to parse JSON array
                completed_tasks = self._extract_json_array(tasks_section)

        # Parse SKIPPED_TASKS section
        if "SKIPPED_TASKS:" in self.accumulated_text:
            skip_idx = self.accumulated_text.find("SKIPPED_TASKS:") + len("SKIPPED_TASKS:")
            skip_section = self.accumulated_text[skip_idx:].strip()

            if skip_section.upper().startswith("[NONE]"):
                skipped_tasks = []
            else:
                skipped_tasks = self._extract_json_array(skip_section)

        return message, deliverables, completed_tasks, skipped_tasks

    def _extract_json_array(self, text: str) -> List[str]:
        """Extract JSON array from text."""
        # Find JSON array boundaries
        start_idx = text.find("[")
        if start_idx == -1:
            return []

        # Find matching closing bracket
        bracket_count = 0
        end_idx = start_idx
        for i, char in enumerate(text[start_idx:], start_idx):
            if char == "[":
                bracket_count += 1
            elif char == "]":
                bracket_count -= 1
                if bracket_count == 0:
                    end_idx = i
                    break

        if bracket_count != 0:
            return []

        json_str = text[start_idx:end_idx + 1]

        try:
            result = json.loads(json_str)
            if isinstance(result, list):
                return [str(item) for item in result]
            return []
        except json.JSONDecodeError:
            # Try to fix common issues
            fixed = json_str.replace("'", '"')
            try:
                result = json.loads(fixed)
                if isinstance(result, list):
                    return [str(item) for item in result]
                return []
            except json.JSONDecodeError:
                print(f"[LightProcessor] Failed to parse completed_tasks JSON: {json_str[:100]}")
                return []

    def _extract_json(self, text: str) -> Dict[str, Any]:
        """Extract JSON from text, handling common issues."""
        # Find JSON object boundaries
        start_idx = text.find("{")
        if start_idx == -1:
            return {}

        # Find matching closing brace
        brace_count = 0
        end_idx = start_idx
        for i, char in enumerate(text[start_idx:], start_idx):
            if char == "{":
                brace_count += 1
            elif char == "}":
                brace_count -= 1
                if brace_count == 0:
                    end_idx = i
                    break

        if brace_count != 0:
            return {}

        json_str = text[start_idx:end_idx + 1]

        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            # Try to fix common issues
            # Replace single quotes with double quotes
            fixed = json_str.replace("'", '"')
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                print(f"[LightProcessor] Failed to parse deliverables JSON: {json_str[:100]}")
                return {}


class LightProcessor:
    """Single LLM processor with streaming response and deliverable extraction."""

    def __init__(self, llm_service: LLMService):
        self.llm_service = llm_service
        self.cancelled = False
        self._current_callback: Optional[LightStreamingCallback] = None

    def cancel(self):
        """Cancel current processing."""
        self.cancelled = True

    async def process(
        self,
        session_id: str,
        system_prompt: str,
        user_message: str
    ) -> AsyncIterator[AgentOutput]:
        """
        Process input through LLM and stream response.

        Args:
            session_id: Current session ID
            system_prompt: Complete system prompt with context
            user_message: User's input message

        Yields:
            AgentOutput messages (text chunks, final result)
        """
        self.cancelled = False
        transcript_id = f"light_{uuid.uuid4().hex[:8]}"
        token_queue: asyncio.Queue = asyncio.Queue()

        callback = LightStreamingCallback(transcript_id, token_queue)
        self._current_callback = callback

        messages = [
            LLMMessage(role="system", content=system_prompt),
            LLMMessage(role="user", content=user_message)
        ]

        # Start LLM generation in background
        llm_task = asyncio.create_task(
            self.llm_service.generate(
                messages=messages,
                callback=callback,
                component_name="light_processor"
            )
        )

        # Stream tokens as they arrive
        streamed_content = ""
        try:
            while True:
                if self.cancelled:
                    llm_task.cancel()
                    return

                try:
                    event_type, content = await asyncio.wait_for(
                        token_queue.get(), timeout=0.1
                    )

                    if event_type == "token":
                        streamed_content += content
                        yield AgentOutput.text_chunk(
                            session_id,
                            streamed_content.strip(),
                            transcript_id=transcript_id,
                            is_final=False
                        )

                    elif event_type == "message_end":
                        # Final message chunk
                        yield AgentOutput.text_chunk(
                            session_id,
                            content,
                            transcript_id=transcript_id,
                            is_final=True
                        )

                    elif event_type == "error":
                        yield AgentOutput.error(
                            session_id,
                            f"LLM error: {content}",
                            error_type="llm_error",
                            recoverable=True
                        )
                        return

                    elif event_type == "complete":
                        break

                except asyncio.TimeoutError:
                    if llm_task.done():
                        break

            # Wait for LLM task to complete
            await llm_task

        except asyncio.CancelledError:
            return
        except Exception as e:
            yield AgentOutput.error(
                session_id,
                str(e),
                error_type="processing_error",
                recoverable=True
            )
            return

        # Get parsed result
        message, deliverables, completed_tasks, skipped_tasks = callback.get_parsed_content()

        # Return result via a special output that the agent will catch
        yield ProcessorResult(
            message=message,
            deliverables=deliverables,
            completed_tasks=completed_tasks,
            skipped_tasks=skipped_tasks,
        )

        self._current_callback = None
