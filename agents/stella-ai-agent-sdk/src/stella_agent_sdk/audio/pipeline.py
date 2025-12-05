"""
AudioPipeline - High-level audio abstraction for STELLA agents.

This module provides the main audio interface that agents use. It orchestrates
the complete audio flow between LiveKit, STT service, TTS service, and the agent.

INPUT FLOW (user → agent):
1. Subscribe to LiveKit audio track
2. Stream audio to STT service (gRPC)
3. Publish partial transcripts to LiveKit (for frontend display)
4. Yield final transcripts to agent

OUTPUT FLOW (agent → user) - DECOUPLED:
1. publish_text() - Send text to frontend for display (independent of TTS)
2. speak() - Send text to TTS for audio synthesis (independent of frontend)

The SDK's run_audio_loop handles the coordination:
- Stream text chunks to frontend immediately via publish_text()
- Accumulate chunks and send final text to TTS via speak()

Usage:
    # In your agent's run_audio_loop:
    async for event in self.audio.audio_in():
        # Partials already published to LiveKit
        # event is guaranteed to be final

        # Agent yields text chunks
        accumulated = ""
        async for output in agent.process(input):
            accumulated += output.content
            await self.audio.publish_text(accumulated, output.is_final, transcript_id)

            if output.is_final:
                await self.audio.speak(accumulated)
"""

import asyncio
import json
import logging
import time
import uuid
from typing import AsyncIterator, Awaitable, Callable, List, Optional

from stella_agent_sdk.livekit.room import RoomManager
from stella_agent_sdk.services.stt_client import STTClient, TranscriptEvent
from stella_agent_sdk.services.tts_client import TTSClient

logger = logging.getLogger(__name__)


class AudioPipeline:
    """
    Orchestrates complete audio flow between LiveKit, STT, TTS, and agent.

    This is the main audio interface for agents. It handles:

    INPUT (user speech → agent):
    - Subscribes to LiveKit audio tracks
    - Streams audio to external STT service (via gRPC)
    - Publishes ALL transcripts (partial + final) to LiveKit for frontend
    - Yields ONLY final transcripts to agent

    OUTPUT (agent response → user):
    - Accepts streaming text from agent
    - Publishes partial text to LiveKit for frontend display
    - Buffers text into complete sentences
    - Sends sentences to external TTS service (via gRPC)
    - Publishes TTS audio to LiveKit

    BARGE-IN:
    - Detects speech_started from STT VAD
    - Fires registered callbacks for agent to handle interruption
    """

    def __init__(
        self,
        room_manager: RoomManager,
        stt_client: STTClient,
        tts_client: TTSClient,
        session_id: str,
        participant_id: str = "user",
        agent_name: str = "Agent",
        agent_id: Optional[str] = None,
    ):
        """
        Initialize the AudioPipeline.

        Args:
            room_manager: LiveKit room manager for audio I/O
            stt_client: gRPC client for external STT service
            tts_client: gRPC client for external TTS service
            session_id: Session identifier
            participant_id: Default participant ID for audio attribution
            agent_name: Display name for agent messages (from AGENT_NAME env)
            agent_id: Unique agent ID for attribution (from AGENT_ID env)
        """
        self._room = room_manager
        self._stt = stt_client
        self._tts = tts_client
        self._session_id = session_id
        self._participant_id = participant_id
        self._agent_name = agent_name
        self._agent_id = agent_id

        # State tracking
        self._is_speaking = False
        self._is_listening = False
        self._stop_speaking_event = asyncio.Event()
        self._tts_task: Optional[asyncio.Task] = None

        # Barge-in callbacks
        self._speech_started_callbacks: List[Callable[[], Awaitable[None]]] = []

        # Audio streaming
        self._audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._stt_stream_task: Optional[asyncio.Task] = None
        self._transcript_queue: asyncio.Queue[TranscriptEvent] = asyncio.Queue()

        # Register data message handler for text input from frontend
        self._room.on_data_received(self._handle_data_message)

    @property
    def is_speaking(self) -> bool:
        """Whether the agent is currently speaking (TTS playing)."""
        return self._is_speaking

    @property
    def is_listening(self) -> bool:
        """Whether the pipeline is actively listening for user audio."""
        return self._is_listening

    @property
    def session_id(self) -> str:
        """The current session ID."""
        return self._session_id

    async def start(self) -> None:
        """
        Start the audio pipeline.

        This begins:
        - Listening to LiveKit audio tracks
        - Streaming audio to STT service
        - Processing transcript events
        """
        if self._is_listening:
            logger.warning("Audio pipeline already started")
            return

        logger.info(f"Starting audio pipeline for session {self._session_id}")

        self._is_listening = True
        self._stop_speaking_event.clear()

        # Start the STT streaming task
        self._stt_stream_task = asyncio.create_task(self._run_stt_stream())

        logger.info("Audio pipeline started")

    async def stop(self) -> None:
        """Stop the audio pipeline and cleanup resources."""
        logger.info("Stopping audio pipeline")

        self._is_listening = False

        # Stop any ongoing TTS
        await self.stop_speaking()

        # Cancel STT stream task
        if self._stt_stream_task:
            self._stt_stream_task.cancel()
            try:
                await self._stt_stream_task
            except asyncio.CancelledError:
                pass
            self._stt_stream_task = None

        logger.info("Audio pipeline stopped")

    async def _run_stt_stream(self) -> None:
        """
        Run the STT streaming loop in the background.

        This method:
        1. Subscribes to LiveKit audio
        2. Streams to external STT service
        3. Publishes ALL transcripts to LiveKit (for frontend display)
        4. Queues ONLY final transcripts for agent consumption
        """
        logger.info("STT stream task started, waiting for audio...")
        chunk_count = 0

        try:
            async def audio_generator():
                """Generate audio chunks from LiveKit room."""
                nonlocal chunk_count
                logger.info("Audio generator started, subscribing to LiveKit audio...")
                async for audio_data in self._room.subscribe_to_audio():
                    if not self._is_listening:
                        logger.info("Pipeline stopped listening, ending audio generator")
                        break
                    chunk_count += 1
                    if chunk_count == 1:
                        logger.info(f"First audio chunk received ({len(audio_data)} bytes)")
                    elif chunk_count % 100 == 0:
                        logger.debug(f"Streamed {chunk_count} audio chunks to STT")
                    yield audio_data
                logger.info(f"Audio generator ended after {chunk_count} chunks")

            # Stream to STT service and process events
            # Pass sample_rate from LiveKit (STT service will resample if needed)
            sample_rate = self._room.audio_sample_rate
            logger.info(f"Starting STT stream_transcribe with sample_rate={sample_rate}Hz...")
            async for event in self._stt.stream_transcribe(
                audio_generator(),
                session_id=self._session_id,
                participant_id=self._participant_id,
                sample_rate=sample_rate,
            ):
                logger.debug(f"STT event: text='{event.text[:50] if event.text else ''}...', is_final={event.is_final}, speech_started={event.speech_started}")

                # 1. Publish ALL transcripts to LiveKit for frontend display
                # Include speaker attribution so frontend knows this is user speech
                # Use Envelope format: { type, data: { ... } }
                speaker_id = event.participant_id or self._participant_id
                await self._room.publish_data({
                    "type": "transcript",
                    "data": {
                        "text": event.text,
                        "is_final": event.is_final,
                        "transcript_id": event.transcript_id,
                        # Speaker attribution (who spoke)
                        "speaker_id": speaker_id,
                        "speaker_name": speaker_id,  # Frontend will map to display name
                        "source": "user_speech",
                        # Backwards compat
                        "participant_id": speaker_id,
                    },
                })

                # 2. Handle speech_started for barge-in
                if event.speech_started:
                    await self._handle_speech_started()

                # 3. Queue ONLY final transcripts for agent
                if event.is_final and event.text.strip():
                    logger.info(f"Final transcript: '{event.text}'")
                    await self._transcript_queue.put(event)

        except asyncio.CancelledError:
            logger.debug("STT stream task cancelled")
        except Exception as e:
            logger.error(f"STT stream error: {e}", exc_info=True)

    async def _handle_speech_started(self) -> None:
        """Handle VAD speech_started signal (potential barge-in)."""
        logger.debug("Speech started detected")

        # Fire all registered callbacks
        for callback in self._speech_started_callbacks:
            try:
                await callback()
            except Exception as e:
                logger.error(f"Error in speech_started callback: {e}")

    def _handle_data_message(self, participant_id: str, data: bytes) -> None:
        """
        Handle incoming data channel message from LiveKit.

        This processes text messages sent via the data channel (e.g., from
        the frontend chat input) and queues them as transcript events.

        Args:
            participant_id: Identity of the participant who sent the message (LiveKit identity)
            data: Raw bytes of the message (JSON encoded)
        """
        import json
        import uuid

        try:
            message = json.loads(data.decode("utf-8"))

            # Handle user_text messages from frontend
            if message.get("type") == "user_text":
                text = message.get("data", "").strip()
                if text:
                    # Use envelope's participant_id if available (actual username from frontend)
                    # Fall back to LiveKit callback participant_id ("human") if not present
                    envelope_participant_id = message.get("participant_id") or participant_id
                    # Also get the transcript_id from envelope if present (for deduplication)
                    envelope_transcript_id = message.get("transcript_id") or str(uuid.uuid4())

                    logger.info(f"Received text message from {envelope_participant_id}: {text[:50]}...")

                    # Create a transcript event for the text message
                    event = TranscriptEvent(
                        text=text,
                        is_final=True,
                        participant_id=envelope_participant_id,
                        transcript_id=envelope_transcript_id,
                        confidence=1.0,
                        timestamp_ms=int(time.time() * 1000),
                        speech_started=False,
                    )

                    # Queue it for processing (non-blocking)
                    try:
                        self._transcript_queue.put_nowait(event)
                    except asyncio.QueueFull:
                        logger.warning("Transcript queue full, dropping text message")

                    # Echo the received text back to LiveKit so frontend shows it
                    # Use envelope's participant_id for proper attribution
                    # This is done in a fire-and-forget manner
                    asyncio.create_task(self._echo_received_text(text, envelope_participant_id, envelope_transcript_id))

        except json.JSONDecodeError:
            logger.debug(f"Received non-JSON data message from {participant_id}")
        except Exception as e:
            logger.error(f"Error handling data message: {e}")

    async def _echo_received_text(self, text: str, participant_id: str, transcript_id: str) -> None:
        """
        Echo received text message back to LiveKit for frontend display.

        Args:
            text: The text message to echo
            participant_id: The actual username from envelope (not LiveKit identity)
            transcript_id: The original transcript_id for deduplication
        """
        try:
            # Use Envelope format: { type, data: { ... } }
            # Use the same transcript_id from the original message for deduplication
            await self._room.publish_data({
                "type": "transcript",
                "data": {
                    "text": text,
                    "is_final": True,
                    "transcript_id": transcript_id,
                    # Speaker attribution (user who typed - actual username)
                    "speaker_id": participant_id,
                    "speaker_name": participant_id,
                    "source": "user_text",
                    # Backwards compat
                    "participant_id": participant_id,
                },
            })
        except Exception as e:
            logger.error(f"Error echoing text message: {e}")

    async def audio_in(self) -> AsyncIterator[TranscriptEvent]:
        """
        Yield FINAL transcripts from user speech.

        This is the main input method for agents. Partial transcripts are
        automatically published to LiveKit for frontend display - agents
        only receive final transcripts ready for processing.

        Note: Barge-in (speech_started) is handled via callbacks registered
        with on_speech_started(), not through this iterator.

        Yields:
            TranscriptEvent with:
            - text: Final transcribed text
            - is_final: Always True (partials filtered out)
            - transcript_id: Groups related transcript events
            - confidence: Confidence score (0.0-1.0)

        Example:
            ```python
            async for event in self.audio.audio_in():
                # event.is_final is always True
                # Partials already sent to LiveKit for frontend

                transcript_id = f"response_{uuid.uuid4().hex[:8]}"
                accumulated = ""

                async for chunk in llm.stream(event.text):
                    accumulated += chunk
                    # Stream to frontend
                    await self.audio.publish_text(accumulated, is_final=False, transcript_id=transcript_id)

                # Mark final and speak
                await self.audio.publish_text(accumulated, is_final=True, transcript_id=transcript_id)
                await self.audio.speak(accumulated)
            ```
        """
        if not self._is_listening:
            raise RuntimeError(
                "Audio pipeline not started. Call start() first or use run_agent()."
            )

        while self._is_listening:
            try:
                # Get transcript event with timeout
                event = await asyncio.wait_for(
                    self._transcript_queue.get(),
                    timeout=1.0,
                )
                yield event

            except asyncio.TimeoutError:
                # No event available, continue waiting
                continue
            except asyncio.CancelledError:
                break

    # =========================================================================
    # OUTPUT METHODS - DECOUPLED
    # =========================================================================
    #
    # The SDK provides two independent output methods:
    #
    # 1. publish_text() - Send text to frontend for real-time display
    #    - Independent of TTS
    #    - Supports streaming chunks with transcript_id for grouping
    #    - Frontend accumulates chunks and replaces by transcript_id
    #
    # 2. speak() - Send text to TTS for audio synthesis
    #    - Independent of frontend display
    #    - Handles sentence buffering and streaming TTS
    #    - Only called when TTS is available and desired
    #
    # This decoupling allows:
    # - Text-only responses (no TTS)
    # - Audio-only responses (no frontend)
    # - Combined responses with independent control
    # =========================================================================

    async def publish_text(
        self,
        text: str,
        is_final: bool = False,
        transcript_id: Optional[str] = None,
    ) -> None:
        """
        Publish text to frontend for display (independent of TTS).

        This method sends text to the LiveKit data channel for frontend display.
        It does NOT trigger TTS synthesis - use speak() for that.

        Args:
            text: The text to display. For streaming, this should be accumulated
                  text (frontend replaces by transcript_id).
            is_final: Whether this is the final chunk for this transcript_id.
            transcript_id: Groups related chunks. Frontend replaces previous
                          chunks with the same ID.

        Example:
            ```python
            transcript_id = f"response_{uuid.uuid4().hex[:8]}"
            accumulated = ""

            async for chunk in llm.stream(prompt):
                accumulated += chunk
                await self.audio.publish_text(
                    accumulated,
                    is_final=False,
                    transcript_id=transcript_id
                )

            # Mark final
            await self.audio.publish_text(
                accumulated,
                is_final=True,
                transcript_id=transcript_id
            )
            ```
        """
        await self._room.publish_data({
            "type": "agent_text",
            "data": {
                "text": text,
                "is_final": is_final,
                "transcript_id": transcript_id or str(uuid.uuid4()),
                "agent_id": self._agent_id,
                "agent_name": self._agent_name,
                "source": "agent_response",
            },
        })

    async def speak(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> None:
        """
        Send text to TTS for audio synthesis (independent of frontend display).

        This method sends text to the TTS service and publishes the resulting
        audio to LiveKit. It does NOT publish text to the frontend - use
        publish_text() for that.

        Args:
            text: Complete text to synthesize. Should be the full final message,
                  not individual chunks.
            voice: Optional voice override (provider-specific)
            speed: Speech rate (0.5-2.0, default 1.0)

        Example:
            ```python
            # Stream text to frontend as chunks arrive
            accumulated = ""
            async for chunk in llm.stream(prompt):
                accumulated += chunk
                await self.audio.publish_text(accumulated, is_final=False, transcript_id=tid)

            # Mark as final
            await self.audio.publish_text(accumulated, is_final=True, transcript_id=tid)

            # Send final text to TTS (separately from frontend display)
            if accumulated.strip():
                await self.audio.speak(accumulated)
            ```
        """
        if not text.strip():
            return

        if self._tts is None:
            logger.debug("TTS not available, skipping speak()")
            return

        self._is_speaking = True
        self._stop_speaking_event.clear()

        try:
            await self._speak_sentence(text, voice, speed)
        finally:
            self._is_speaking = False

    @property
    def has_tts(self) -> bool:
        """Whether TTS is available for audio synthesis."""
        return self._tts is not None

    async def _speak_sentence(
        self,
        sentence: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> None:
        """
        Send a sentence to TTS and publish audio to LiveKit.

        Args:
            sentence: Complete sentence to speak
            voice: Optional voice override
            speed: Speech rate
        """
        if not sentence.strip():
            return

        logger.debug(f"Speaking sentence: {sentence[:50]}...")

        try:
            async for chunk in self._tts.synthesize_stream(
                text=sentence,
                session_id=self._session_id,
                voice=voice,
                speed=speed,
            ):
                if self._stop_speaking_event.is_set():
                    logger.info("TTS interrupted mid-sentence")
                    break

                await self._room.publish_audio(chunk.audio_data)

        except Exception as e:
            logger.error(f"Error speaking sentence: {e}")

    async def stop_speaking(self) -> None:
        """
        Interrupt current TTS playback.

        Call this when user starts speaking (barge-in) to immediately
        stop agent speech.
        """
        if not self._is_speaking:
            return

        logger.info("Stopping TTS playback")
        self._stop_speaking_event.set()

        # Wait briefly for TTS to notice interruption
        await asyncio.sleep(0.05)

    def on_speech_started(self, callback: Callable[[], Awaitable[None]]) -> None:
        """
        Register callback for when VAD detects user speech start.

        This is the primary mechanism for barge-in detection. When the
        STT service's VAD detects speech onset, all registered callbacks
        are fired.

        Args:
            callback: Async function to call on speech start

        Example:
            ```python
            async def handle_barge_in():
                await self.audio.stop_speaking()
                # Reset any agent state

            self.audio.on_speech_started(handle_barge_in)
            ```
        """
        self._speech_started_callbacks.append(callback)

    def clear_speech_started_callbacks(self) -> None:
        """Clear all registered speech_started callbacks."""
        self._speech_started_callbacks.clear()
