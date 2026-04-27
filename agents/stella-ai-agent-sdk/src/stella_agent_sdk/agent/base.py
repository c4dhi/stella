"""BaseAgent abstract class - the interface agents must implement."""

from abc import ABC, abstractmethod
import asyncio
import logging
import re
import time
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional, TYPE_CHECKING

from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.messages.types import AgentState, ChatMessage, MetadataSubtype, OutputType

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from stella_agent_sdk.audio.pipeline import AudioPipeline
    from stella_agent_sdk.services.history_client import HistoryClient


class BaseAgent(ABC):
    """
    Abstract base class for STELLA agents.

    Implement this class to create your own agent. The SDK only cares about
    the communication interface - your internal implementation (LLM choice,
    RAG, multi-agent systems, etc.) is entirely up to you.

    Example:
        ```python
        from stella_agent_sdk import BaseAgent, AgentInput, AgentOutput

        class MyAgent(BaseAgent):
            async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
                # Initialize your agent with the session configuration
                self.model = config.get("model", "gpt-4")

            async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
                # Process the input and yield responses
                response = await self.call_your_llm(input.text)
                yield AgentOutput.text_final(input.session_id, response)

            async def on_interrupt(self, session_id: str) -> None:
                # Stop any ongoing generation
                self.cancel_current_task()

            async def on_session_end(self, session_id: str) -> Dict[str, Any]:
                # Cleanup and return any final data
                return {"messages_processed": self.message_count}
        ```

    The session lifecycle:
        1. on_session_start() - Agent receives configuration, initializes state
        2. process() - Called for each user input, yields streaming responses
        3. on_interrupt() - Called if user interrupts (barge-in)
        4. on_session_end() - Called when session ends, cleanup
    """

    def __init__(self) -> None:
        """Initialize the agent. Override to add your own initialization."""
        self._session_id: Optional[str] = None
        self._is_processing: bool = False
        # State tracking for health checks
        self._state: AgentState = AgentState.INITIALIZING
        self._start_time: float = time.time()
        self._messages_processed: int = 0
        self._last_error: Optional[str] = None
        self._agent_type: str = self.__class__.__name__
        self._agent_version: str = "1.0.0"
        # Audio pipeline (set by run_agent when using direct LiveKit mode)
        self._audio_pipeline: Optional["AudioPipeline"] = None
        # History client (set by run_agent for chat history access)
        self._history_client: Optional["HistoryClient"] = None
        # Last progress payload (for re-sending to new participants)
        self._last_progress_payload: Optional[Dict[str, Any]] = None
        # Sentence buffer for TTS dispatch (accumulates text between sentence boundaries)
        self._sentence_buffer: str = ""
        # Current sentence source for analytics ("bridge" or "response")
        self._current_sentence_source: str = "response"
        # Set to True by the agent when the plan reaches __end__.
        # run_audio_loop checks this after each turn and exits cleanly.
        self._session_completed: bool = False
        # Agent identity (set by run_agent from environment variables)
        self._agent_name: str = "Agent"
        self._agent_id: str = ""
        self._agent_icon: str = "🤖"

    @property
    def session_id(self) -> Optional[str]:
        """The current session ID, if in a session."""
        return self._session_id

    @property
    def is_processing(self) -> bool:
        """Whether the agent is currently processing input."""
        return self._is_processing

    @property
    def state(self) -> AgentState:
        """The current agent state for health monitoring."""
        return self._state

    @property
    def agent_type(self) -> str:
        """The type of agent (class name by default)."""
        return self._agent_type

    @property
    def agent_version(self) -> str:
        """The agent version string."""
        return self._agent_version

    @agent_version.setter
    def agent_version(self, value: str) -> None:
        """Set the agent version."""
        self._agent_version = value

    @property
    def agent_name(self) -> str:
        """The deployed agent name (from AGENT_NAME env var)."""
        return self._agent_name

    @property
    def agent_id(self) -> str:
        """The deployed agent ID (from AGENT_ID env var)."""
        return self._agent_id

    @property
    def uptime_seconds(self) -> int:
        """How long the agent has been running in seconds."""
        return int(time.time() - self._start_time)

    @property
    def messages_processed(self) -> int:
        """Number of messages processed by this agent."""
        return self._messages_processed

    @property
    def audio(self) -> "AudioPipeline":
        """
        Access the audio pipeline for direct audio I/O.

        This property is available when the agent is running in direct LiveKit
        mode (via run_agent). It provides high-level audio abstractions:

        INPUT:
        - audio.audio_in() - Async iterator yielding final transcripts

        OUTPUT (decoupled):
        - audio.publish_text(text, is_final, transcript_id) - Stream text to frontend
        - audio.speak(text) - Send text to TTS for audio synthesis

        CONTROL:
        - audio.on_speech_started(callback) - Register barge-in handler
        - audio.stop_speaking() - Interrupt current TTS
        - audio.has_tts - Check if TTS is available

        Raises:
            RuntimeError: If not running in direct LiveKit mode.

        Example:
            ```python
            async def run_audio_loop(self) -> None:
                async for event in self.audio.audio_in():
                    if event.is_final:
                        transcript_id = f"response_{uuid.uuid4().hex[:8]}"
                        response = await self.get_response(event.text)
                        await self.audio.publish_text(response, is_final=True, transcript_id=transcript_id)
                        await self.audio.speak(response)
            ```
        """
        if self._audio_pipeline is None:
            raise RuntimeError(
                "Audio pipeline not available. "
                "Are you running the agent with run_agent()? "
                "The audio pipeline is only available in direct LiveKit mode."
            )
        return self._audio_pipeline

    @property
    def has_audio(self) -> bool:
        """Whether the audio pipeline is available."""
        return self._audio_pipeline is not None

    @property
    def has_history(self) -> bool:
        """Whether the chat history client is available."""
        return self._history_client is not None

    async def get_chat_history(
        self,
        include_debug: bool = False,
        limit: int = 100,
    ) -> List[ChatMessage]:
        """
        Fetch chat history for the current session.

        This method retrieves recorded messages from the session's conversation
        history. It's useful for:
        - Building context for LLM prompts
        - Resuming conversations after agent restart
        - Analyzing conversation patterns

        The messages are returned in chronological order (oldest first) and
        use the same envelope format as live messages for consistency.

        Args:
            include_debug: Whether to include debug/processing messages.
                          Default is False (only chat messages: user_text,
                          transcript, agent_text).
            limit: Maximum number of messages to return (default: 100, max: 500).

        Returns:
            List of ChatMessage objects in chronological order.

        Raises:
            RuntimeError: If not in an active session or history client not available.

        Example:
            ```python
            async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
                # Get recent conversation history for context
                history = await self.get_chat_history(limit=20)

                # Build context string
                context = "\\n".join([
                    f"{msg.role}: {msg.content}"
                    for msg in history
                ])

                # Use in LLM prompt
                response = await self.llm.chat([
                    {"role": "system", "content": f"Previous conversation:\\n{context}"},
                    {"role": "user", "content": input.text}
                ])

                yield AgentOutput.text_final(input.session_id, response)
            ```
        """
        if self._history_client is None:
            raise RuntimeError(
                "Chat history not available. "
                "Are you running the agent with run_agent()? "
                "The history client is only available in direct LiveKit mode."
            )

        return await self._history_client.get_chat_history(
            include_debug=include_debug,
            limit=limit,
        )

    def set_state(self, state: AgentState) -> None:
        """
        Set the agent state.

        Call this to update the agent state for health monitoring.
        The SDK will call this automatically for common transitions,
        but you can also call it manually for custom states.

        Args:
            state: The new agent state.
        """
        self._state = state

    def record_error(self, error: str) -> None:
        """
        Record an error for health reporting.

        Args:
            error: The error message.
        """
        self._last_error = error
        self._state = AgentState.ERROR

    def get_health_status(self) -> Dict[str, Any]:
        """
        Get the current health status of the agent.

        This is called by the SDK when session-management sends a health check request.
        Override this method to add custom health metrics.

        Returns:
            Dictionary with health status information.
        """
        return {
            "state": self._state.value,
            "session_id": self._session_id,
            "agent_type": self._agent_type,
            "agent_version": self._agent_version,
            "uptime_seconds": self.uptime_seconds,
            "messages_processed": self._messages_processed,
            "last_error": self._last_error,
        }

    @abstractmethod
    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """
        Process user input and yield agent outputs.

        This is the main entry point for your agent logic. You receive
        transcribed text (or other input types) and yield response messages.

        For streaming responses, yield multiple TEXT_CHUNK outputs followed
        by a final TEXT_CHUNK with is_final=True (or use TEXT_FINAL).

        Args:
            input: The input message from session-management.

        Yields:
            AgentOutput messages (text chunks, status updates, etc.).

        Example (streaming):
            ```python
            async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
                transcript_id = str(uuid.uuid4())

                # Show thinking status
                yield AgentOutput.thinking(input.session_id)

                # Stream the response
                async for chunk in self.stream_from_llm(input.text):
                    yield AgentOutput.text_chunk(
                        input.session_id,
                        chunk,
                        transcript_id=transcript_id,
                    )

                # Mark stream as complete
                yield AgentOutput.text_chunk(
                    input.session_id,
                    "",
                    transcript_id=transcript_id,
                    is_final=True,
                )
            ```

        Example (non-streaming):
            ```python
            async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
                response = await self.get_response(input.text)
                yield AgentOutput.text_final(input.session_id, response)
            ```
        """
        # This is abstract, implementations must override
        yield  # type: ignore

    @abstractmethod
    async def on_interrupt(self, session_id: str) -> None:
        """
        Handle interrupt signal (user barge-in).

        Called when the user starts speaking while the agent is responding.
        You should stop any ongoing generation immediately.

        This is called BEFORE the INTERRUPT input type arrives in process().

        Args:
            session_id: The session being interrupted.

        Example:
            ```python
            async def on_interrupt(self, session_id: str) -> None:
                # Cancel any ongoing async tasks
                if self._current_task:
                    self._current_task.cancel()
                # Reset streaming state
                self._is_streaming = False
            ```
        """
        pass

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """
        Called when a new session starts.

        Override this to initialize your agent with session-specific configuration.
        The config contains plan information, user preferences, LLM settings, etc.

        Args:
            session_id: Unique identifier for this session.
            config: Configuration dictionary from session-management.
                   May include: plan_id, plan_data, user_preferences,
                   llm_model, temperature, etc.

        Example:
            ```python
            async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
                self._session_id = session_id
                self.plan_data = config.get("plan_data")
                self.model = config.get("llm_model", "gpt-4")
                self.temperature = config.get("temperature", 0.7)
                self.conversation_history = []
            ```
        """
        self._session_id = session_id
        self._state = AgentState.READY

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """
        Called when a session ends.

        Override this to cleanup resources and return any final data
        (collected deliverables, conversation summary, etc.).

        Args:
            session_id: The session that is ending.

        Returns:
            Dictionary with any final data to send back to session-management.
            This might include collected deliverables, conversation metrics, etc.

        Example:
            ```python
            async def on_session_end(self, session_id: str) -> Dict[str, Any]:
                # Cleanup
                await self.cleanup_resources()

                # Return collected data
                return {
                    "deliverables": self.collected_deliverables,
                    "messages_processed": len(self.conversation_history),
                    "session_duration_seconds": self.get_duration(),
                }
            ```
        """
        self._state = AgentState.SHUTTING_DOWN
        self._session_id = None
        return {}

    async def on_config_update(self, session_id: str, config: Dict[str, Any]) -> None:
        """
        Called when configuration is updated during a session.

        Override this to handle runtime configuration changes.

        Args:
            session_id: The session being updated.
            config: The new/updated configuration values.
        """
        pass

    async def on_ready(self, session_id: str) -> AsyncIterator[AgentOutput]:
        """
        Called after session start, before the audio loop begins.

        Override this to send initial outputs to the frontend, such as:
        - Initial progress/todo list state
        - Welcome messages
        - Configuration confirmations

        This is the right place to send the initial state of any progress
        tracking or todo lists that the frontend should display immediately
        when the agent joins the room.

        Args:
            session_id: The session that just started.

        Yields:
            AgentOutput messages to send before the audio loop starts.

        Example:
            ```python
            async def on_ready(self, session_id: str) -> AsyncIterator[AgentOutput]:
                # Send initial progress state
                if self.has_todo_list:
                    progress = self.build_progress_state()
                    yield AgentOutput.progress_update(
                        session_id,
                        progress,
                        update_trigger="session_start"
                    )
            ```
        """
        # Default implementation yields nothing
        return
        yield  # Make this a generator

    async def run_audio_loop(self) -> None:
        """
        Main audio processing loop for direct LiveKit mode.

        Override this method for custom audio handling. The default
        implementation routes transcripts through process() for
        backwards compatibility.

        This method is called by run_agent() after:
        1. LiveKit room connection established
        2. STT/TTS services connected
        3. AudioPipeline initialized
        4. on_session_start() called

        The default implementation:
        - Receives final transcripts from audio.audio_in()
        - Routes through process() for agent handling
        - Streams TEXT_CHUNKs to frontend via audio.publish_text()
        - Sends final text to TTS via audio.speak()

        Example (custom implementation):
            ```python
            async def run_audio_loop(self) -> None:
                # Register barge-in handler
                self.audio.on_speech_started(self._handle_barge_in)

                async for event in self.audio.audio_in():
                    if event.is_final:
                        transcript_id = f"response_{uuid.uuid4().hex[:8]}"
                        accumulated = ""

                        async for chunk in self.llm.stream(event.text):
                            accumulated += chunk
                            await self.audio.publish_text(accumulated, is_final=False, transcript_id=transcript_id)

                        await self.audio.publish_text(accumulated, is_final=True, transcript_id=transcript_id)
                        await self.audio.speak(accumulated)

            async def _handle_barge_in(self) -> None:
                await self.audio.stop_speaking()
            ```

        Example (using process() for compatibility):
            The default implementation below routes through process(),
            allowing existing agents to work with minimal changes.
        """
        if not self.has_audio:
            raise RuntimeError(
                "run_audio_loop requires audio pipeline. "
                "Use run_agent() to start the agent in direct LiveKit mode."
            )

        async for event in self.audio.audio_in():
            if event.is_final and event.text.strip():
                # Create AgentInput and route through process()
                input_msg = AgentInput.text_input(self._session_id or "", event.text)

                # Process and stream response
                self._is_processing = True
                self._messages_processed += 1

                try:
                    current_transcript_id = None
                    tts_buffer = ""  # Tracks last accumulated text for diffing

                    async for output in self.process(input_msg):
                        logger.info(f"[AGENT OUTPUT] type={output.type}, content={output.content[:50] if output.content else 'None'}...")
                        if output.type == OutputType.TEXT_CHUNK:
                            # Get or create transcript_id for this response stream
                            if current_transcript_id is None:
                                current_transcript_id = output.transcript_id or f"response_{uuid.uuid4().hex[:8]}"
                                # Capture first-text timestamp for TTFT measurement
                                self.audio._turn_first_text_ts = time.perf_counter()
                                # Detect bridge vs response from transcript_id prefix
                                tid = current_transcript_id
                                self._current_sentence_source = "bridge" if (tid.startswith("gate_ack_") or tid.startswith("gate_fallback_")) else "response"

                            # Stream text to frontend (agent sends accumulated text)
                            await self.audio.publish_text(
                                output.content,
                                is_final=output.is_final,
                                transcript_id=current_transcript_id
                            )

                            # Sentence-level TTS: extract new text from accumulated content.
                            # output.content is the full accumulated text so far.
                            # Safety: if content doesn't extend tts_buffer (e.g. new
                            # transcript), reset and treat full content as new.
                            if output.content.startswith(tts_buffer):
                                new_text = output.content[len(tts_buffer):]
                            else:
                                new_text = output.content
                                self._sentence_buffer = ""
                            tts_buffer = output.content

                            # Check for sentence boundaries in the new text and dispatch
                            self._dispatch_sentences(new_text)

                            # If the buffer is a complete sentence (ends with
                            # punctuation) and this is NOT the final chunk,
                            # dispatch immediately. This handles the bridge:
                            # "Good question." is a complete sentence that
                            # should be synthesized right away, without
                            # waiting for the next output event.
                            if (
                                not output.is_final
                                and self._sentence_buffer
                                and self._sentence_buffer.rstrip()[-1:] in ".!?"
                            ):
                                remaining = self._flush_sentence_buffer()
                                if remaining:
                                    self.audio.enqueue_sentence(remaining, source=self._current_sentence_source)

                            if output.is_final:
                                # Flush any remaining partial sentence to TTS
                                remaining = self._flush_sentence_buffer()
                                if remaining:
                                    self.audio.enqueue_sentence(remaining, source=self._current_sentence_source)
                                tts_buffer = ""
                                current_transcript_id = None
                                self._current_sentence_source = "response"

                        elif output.type == OutputType.TEXT_FINAL:
                            # Direct final response - publish and speak
                            if output.content.strip():
                                transcript_id = f"final_{uuid.uuid4().hex[:8]}"

                                # Publish to frontend as final
                                await self.audio.publish_text(
                                    output.content,
                                    is_final=True,
                                    transcript_id=transcript_id
                                )

                                # Send to TTS via sentence queue
                                self.audio.enqueue_sentence(output.content)

                        elif output.type == OutputType.DEBUG:
                            # Forward debug messages to frontend via LiveKit
                            debug_payload = {
                                "type": "debug",
                                "data": {
                                    "content": output.content,
                                    "component": output.metadata.get("component", "agent") if output.metadata else "agent",
                                    "level": output.metadata.get("level", "info") if output.metadata else "info",
                                    "metadata": output.metadata or {}
                                }
                            }
                            logger.info(f"[DEBUG MESSAGE] Publishing: {debug_payload}")
                            await self.audio._room.publish_data(debug_payload)

                        elif output.type == OutputType.STATUS:
                            # Forward status messages to frontend as debug messages
                            status_payload = {
                                "type": "debug",
                                "data": {
                                    "content": output.content,
                                    "component": output.metadata.get("component", "status") if output.metadata else "status",
                                    "level": "info",
                                    "metadata": output.metadata or {}
                                }
                            }
                            logger.info(f"[STATUS MESSAGE] Publishing: {status_payload}")
                            await self.audio._room.publish_data(status_payload)

                        elif output.type == OutputType.ERROR:
                            # Forward error messages to frontend as debug messages
                            error_payload = {
                                "type": "debug",
                                "data": {
                                    "content": output.content,
                                    "component": output.metadata.get("component", "error") if output.metadata else "error",
                                    "level": "error",
                                    "metadata": output.metadata or {}
                                }
                            }
                            logger.info(f"[ERROR MESSAGE] Publishing: {error_payload}")
                            await self.audio._room.publish_data(error_payload)

                        elif output.type == OutputType.METADATA:
                            # Handle different metadata subtypes
                            subtype = output.metadata_subtype
                            metadata = output.metadata or {}

                            if subtype == MetadataSubtype.DELIVERABLE:
                                # Send as plan_deliverable_update for frontend
                                deliverable_payload = {
                                    "type": "plan_deliverable_update",
                                    "data": {
                                        "deliverable_key": metadata.get("key"),
                                        "deliverable_value": metadata.get("value"),
                                        "confidence": metadata.get("confidence", 1.0),
                                        "reasoning": metadata.get("reasoning"),
                                        "state_id": metadata.get("state_id"),
                                        "task_id": metadata.get("task_id"),
                                    }
                                }
                                logger.info(f"[DELIVERABLE] Publishing: {deliverable_payload}")
                                await self.audio._room.publish_data(deliverable_payload)
                            else:
                                # Forward other metadata messages as debug
                                subtype_value = subtype.value if subtype else "metadata"
                                metadata_payload = {
                                    "type": "debug",
                                    "data": {
                                        "content": f"[{subtype_value}] {output.content}",
                                        "component": "metadata",
                                        "level": "info",
                                        "metadata": metadata
                                    }
                                }
                                logger.info(f"[METADATA MESSAGE] Publishing: {metadata_payload}")
                                await self.audio._room.publish_data(metadata_payload)

                        elif output.type == OutputType.PROGRESS_UPDATE:
                            # Forward progress updates to frontend for task panel display
                            # Include agent identity metadata for proper display
                            progress_data = output.metadata.get("progress_state", {}) if output.metadata else {}
                            # Ensure metadata dict exists
                            if "metadata" not in progress_data:
                                progress_data["metadata"] = {}
                            # Always include agent identity for proper frontend attribution
                            progress_data["metadata"]["agent_id"] = self._agent_id
                            progress_data["metadata"]["agent_name"] = self._agent_name
                            progress_data["metadata"]["agent_icon"] = self._agent_icon
                            progress_payload = {
                                "type": "progress_update",
                                "data": progress_data
                            }
                            # Store for re-sending to new participants
                            self._last_progress_payload = progress_payload
                            logger.info(f"[PROGRESS UPDATE] Publishing: {progress_payload}")
                            await self.audio._room.publish_data(progress_payload)

                        elif output.type == OutputType.ANALYTICS:
                            # Forward analytics timing measurements for storage
                            analytics_payload = {
                                "type": "analytics",
                                "data": {
                                    "stage": output.metadata.get("stage", "unknown"),
                                    "timing_ms": output.metadata.get("timing_ms", 0),
                                    **{k: v for k, v in (output.metadata or {}).items()
                                       if k not in ("stage", "timing_ms")},
                                }
                            }
                            await self.audio._room.publish_data(analytics_payload)

                finally:
                    # Ensure all queued TTS sentences finish before accepting next input
                    await self.audio.flush_speech_queue()
                    self._sentence_buffer = ""
                    self._is_processing = False

                # If the plan reached __end__ during this turn, stop accepting new input.
                # The farewell has already been spoken; exit the loop cleanly.
                if self._session_completed:
                    logger.info("Session completed — exiting audio loop")
                    break

    # ─────────────────────────────────────────────────────────────────────
    # Sentence-level TTS dispatch helpers
    # ─────────────────────────────────────────────────────────────────────

    # Sentence-ending pattern: ". " or "! " or "? " or "..." followed by
    # whitespace. We split on these boundaries so each TTS call gets a
    # natural sentence.
    _SENTENCE_END = re.compile(r'(?<=[.!?])\s+|(?<=\.\.\.)\s+')

    def _dispatch_sentences(self, new_text: str) -> None:
        """Detect sentence boundaries in new_text and enqueue complete sentences.

        Accumulates text in self._sentence_buffer. When a sentence boundary
        is found (punctuation followed by whitespace), the complete sentence
        is dispatched to the TTS queue immediately.
        """
        self._sentence_buffer += new_text

        # Split on sentence boundaries
        parts = self._SENTENCE_END.split(self._sentence_buffer)

        if len(parts) <= 1:
            # No complete sentence yet — keep buffering
            return

        # All parts except the last are complete sentences
        for sentence in parts[:-1]:
            sentence = sentence.strip()
            if sentence:
                self.audio.enqueue_sentence(sentence, source=self._current_sentence_source)

        # Keep the last (incomplete) part in the buffer
        self._sentence_buffer = parts[-1]

    def _flush_sentence_buffer(self) -> str:
        """Flush and return any remaining text in the sentence buffer."""
        remaining = self._sentence_buffer.strip()
        self._sentence_buffer = ""
        return remaining
