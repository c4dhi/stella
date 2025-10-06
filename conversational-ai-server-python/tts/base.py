"""
Abstract base class for TTS providers.

Defines the interface that all TTS providers must implement to ensure
consistent behavior across different TTS engines.
"""

from abc import ABC, abstractmethod
from typing import Optional, Callable, Dict, Any, List, Tuple
from enum import Enum
import asyncio
import numpy as np
from livekit import rtc


class TTSCapabilities:
    """Represents the capabilities of a TTS provider."""

    def __init__(
        self,
        supports_streaming: bool = True,
        supports_pause_resume: bool = True,
        supports_barge_in: bool = True,
        supports_voice_selection: bool = False,
        supports_ssml: bool = False,
        max_text_length: int = 5000
    ):
        self.supports_streaming = supports_streaming
        self.supports_pause_resume = supports_pause_resume
        self.supports_barge_in = supports_barge_in
        self.supports_voice_selection = supports_voice_selection
        self.supports_ssml = supports_ssml
        self.max_text_length = max_text_length


class TTSState(Enum):
    """TTS provider states."""
    IDLE = "idle"
    INITIALIZING = "initializing"
    SYNTHESIZING = "synthesizing"
    STREAMING = "streaming"
    PAUSED = "paused"
    STOPPING = "stopping"
    ERROR = "error"


class AbstractTTSProvider(ABC):
    """
    Abstract base class for TTS providers.

    All TTS providers must implement this interface to ensure consistent
    behavior and feature support.
    """

    def __init__(
        self,
        room: rtc.Room,
        stream_service,
        on_speaking_state_change: Optional[Callable] = None
    ):
        self.room = room
        self.stream_service = stream_service
        self.on_speaking_state_change = on_speaking_state_change

        # State tracking
        self.state = TTSState.IDLE
        self.is_speaking = False
        self.current_message_id: Optional[str] = None

        # Audio infrastructure
        self.audio_source: Optional[rtc.AudioSource] = None
        self.audio_track: Optional[rtc.LocalAudioTrack] = None

        # Sentence processing
        self.sentence_buffer = ""
        self.sentence_queue = asyncio.Queue()
        self.processing_task: Optional[asyncio.Task] = None

        # Pause/resume state
        self.is_paused = False
        self.pause_event = asyncio.Event()
        self.pause_event.set()  # Start unpaused
        self.pause_state: Dict[str, Any] = {}

    @property
    @abstractmethod
    def capabilities(self) -> TTSCapabilities:
        """Get the capabilities of this TTS provider."""
        pass

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Get the name of this TTS provider."""
        pass

    @abstractmethod
    async def initialize(self) -> bool:
        """
        Initialize the TTS provider.

        Returns:
            bool: True if initialization successful, False otherwise
        """
        pass

    @abstractmethod
    async def synthesize_sentence(self, sentence: str, voice: Optional[str] = None) -> Optional[np.ndarray]:
        """
        Synthesize a single sentence to audio data.

        Args:
            sentence: Text to synthesize
            voice: Optional voice identifier

        Returns:
            Audio data as numpy array (float32, 16kHz, mono) or None if failed
        """
        pass

    @abstractmethod
    async def stream_audio_data(self, audio_data: np.ndarray) -> bool:
        """
        Stream audio data to LiveKit with pause checking.

        Args:
            audio_data: Float32 audio data at 16kHz

        Returns:
            bool: True if streaming completed, False if paused or failed
        """
        pass

    async def process_text_chunk(self, text_chunk: str, message_id: str = None, stream_id: str = None):
        """
        Process incoming text chunk, extracting and queuing complete sentences.

        Args:
            text_chunk: The text content to process
            message_id: Unique identifier for the complete message/response
            stream_id: Unique identifier for the streaming session
        """
        try:
            # Handle new message detection (barge-in)
            if message_id and message_id != self.current_message_id:
                print(f"[{self.provider_name}] New message detected: {message_id}")
                await self._handle_new_message(message_id)
                self.current_message_id = message_id

            # Extract complete sentences
            sentences, remaining = self._extract_complete_sentences(text_chunk)

            # Queue complete sentences
            for sentence in sentences:
                if sentence.strip():
                    await self.sentence_queue.put(sentence.strip())

            # print(f"[{self.provider_name}] Processed chunk: {len(sentences)} sentences, remaining: '{remaining}'")

        except Exception as e:
            print(f"[{self.provider_name}] Error processing text chunk: {e}")

    async def flush_remaining_text(self):
        """Process any remaining text in buffer as final sentence."""
        try:
            if self.sentence_buffer.strip():
                final_text = self.sentence_buffer.strip()
                print(f"[{self.provider_name}] Flushing remaining text: '{final_text}'")
                await self.sentence_queue.put(final_text)
                self.sentence_buffer = ""
        except Exception as e:
            print(f"[{self.provider_name}] Error flushing remaining text: {e}")

    async def clear_buffer(self):
        """Clear the sentence buffer without speaking its contents.

        This is used when we detect structural markers (DELIVERABLES, STATE_TRANSITION, etc.)
        and want to stop TTS immediately without vocalizing any buffered text.
        """
        try:
            if self.sentence_buffer.strip():
                print(f"[{self.provider_name}] Clearing buffer silently: '{self.sentence_buffer.strip()}'")
                self.sentence_buffer = ""
        except Exception as e:
            print(f"[{self.provider_name}] Error clearing buffer: {e}")

    async def pause(self):
        """Pause TTS synthesis and streaming immediately."""
        try:
            if not self.is_paused:
                self.is_paused = True
                self.pause_event.clear()
                self.state = TTSState.PAUSED
                print(f"[{self.provider_name}] ⏸️ TTS paused")
                await self._send_pause_confirmation()
        except Exception as e:
            print(f"[{self.provider_name}] Error pausing TTS: {e}")

    async def resume(self):
        """Resume TTS synthesis and streaming from exact pause point."""
        try:
            if self.is_paused:
                self.is_paused = False
                self.pause_event.set()
                self.state = TTSState.STREAMING
                print(f"[{self.provider_name}] ▶️ TTS resumed")
                await self._resume_from_pause_state()
                await self._send_resume_confirmation()
        except Exception as e:
            print(f"[{self.provider_name}] Error resuming TTS: {e}")

    async def abandon_current(self):
        """Abandon current TTS synthesis for new message."""
        try:
            print(f"[{self.provider_name}] Abandoning current synthesis for new message")

            # Clear pause state
            self.pause_state.clear()

            # Clear sentence queue
            while not self.sentence_queue.empty():
                try:
                    await self.sentence_queue.get()
                    self.sentence_queue.task_done()
                except:
                    break

            # Auto-resume if paused
            if self.is_paused:
                self.is_paused = False
                self.pause_event.set()
                await self._send_resume_confirmation()

            self.state = TTSState.IDLE

        except Exception as e:
            print(f"[{self.provider_name}] Error abandoning current synthesis: {e}")

    def get_speaking_state(self) -> bool:
        """Get current speaking state."""
        return self.is_speaking

    async def setup_audio_track(self):
        """Set up LiveKit audio track for streaming TTS output."""
        try:
            print(f"[{self.provider_name}] Setting up audio track...")

            # Create audio source (16kHz, 1 channel)
            self.audio_source = rtc.AudioSource(16000, 1)

            # Create track
            track = rtc.LocalAudioTrack.create_audio_track("assistant-speech", self.audio_source)
            self.audio_track = track

            # Publish track
            options = rtc.TrackPublishOptions()
            try:
                options.source = rtc.TrackSource.SCREEN_SHARE_AUDIO
            except AttributeError:
                try:
                    options.source = rtc.TrackSource.UNKNOWN
                except AttributeError:
                    pass  # Use default

            publication = await self.room.local_participant.publish_track(track, options)
            print(f"[{self.provider_name}] Audio track published successfully")

        except Exception as e:
            print(f"[{self.provider_name}] Failed to setup audio track: {e}")
            self.audio_source = None
            self.audio_track = None

    async def cleanup(self):
        """Clean up TTS resources."""
        try:
            print(f"[{self.provider_name}] Cleaning up...")

            # Stop processing
            if self.processing_task and not self.processing_task.done():
                self.processing_task.cancel()
                try:
                    await self.processing_task
                except asyncio.CancelledError:
                    pass

            # Clean up provider-specific resources
            await self._cleanup_provider()

            self.state = TTSState.IDLE

        except Exception as e:
            print(f"[{self.provider_name}] Error during cleanup: {e}")

    @abstractmethod
    async def _cleanup_provider(self):
        """Provider-specific cleanup implementation."""
        pass

    def _extract_complete_sentences(self, text_chunk: str) -> Tuple[List[str], str]:
        """Extract complete sentences from text chunk."""
        import re

        # Add new text to buffer
        self.sentence_buffer += text_chunk

        # Define sentence endings - improved to handle quotes properly
        # This pattern captures sentences ending with .!? and optionally followed by closing quotes
        sentence_pattern = r'([^.!?]*[.!?]+["\'\)]*(?:\s|$))'

        # Find all complete sentences
        sentences = re.findall(sentence_pattern, self.sentence_buffer)
        complete_sentences = [s.strip() for s in sentences if s.strip()]

        # Calculate remaining text after sentences
        if complete_sentences:
            # Find the position after the last complete sentence
            last_sentence_end = 0
            for sentence in complete_sentences:
                pos = self.sentence_buffer.find(sentence, last_sentence_end)
                if pos != -1:
                    last_sentence_end = pos + len(sentence)

            remaining = self.sentence_buffer[last_sentence_end:].strip()
        else:
            remaining = self.sentence_buffer

        # Update buffer with remaining fragment
        self.sentence_buffer = remaining

        return complete_sentences, remaining

    async def _handle_new_message(self, new_message_id: str):
        """Handle detection of new message (barge-in scenario)."""
        if self.is_paused or not self.sentence_queue.empty():
            await self.abandon_current()

    async def _on_audio_start(self):
        """Callback when audio playback starts."""
        self.is_speaking = True
        self.state = TTSState.STREAMING
        if self.on_speaking_state_change:
            try:
                await self.on_speaking_state_change(True)
            except Exception as e:
                print(f"[{self.provider_name}] Error in speaking state callback: {e}")

    async def _on_audio_stop(self):
        """Callback when audio playback stops."""
        self.is_speaking = False
        self.state = TTSState.IDLE
        if self.on_speaking_state_change:
            try:
                await self.on_speaking_state_change(False)
            except Exception as e:
                print(f"[{self.provider_name}] Error in speaking state callback: {e}")

    async def _resume_from_pause_state(self):
        """Resume from stored pause state - to be implemented by providers."""
        # Default implementation - providers should override if they support advanced pause/resume
        pass

    async def _send_pause_confirmation(self):
        """Send pause confirmation to frontend."""
        try:
            import time
            import json
            message = {
                "type": "tts_paused",
                "data": {
                    "provider": self.provider_name,
                    "status": "paused",
                    "timestamp": time.time()
                }
            }
            message_json = json.dumps(message)
            message_bytes = message_json.encode("utf-8")
            await self.room.local_participant.publish_data(message_bytes, reliable=True)
        except Exception as e:
            print(f"[{self.provider_name}] Error sending pause confirmation: {e}")

    async def _send_resume_confirmation(self):
        """Send resume confirmation to frontend."""
        try:
            import time
            import json
            message = {
                "type": "tts_resumed",
                "data": {
                    "provider": self.provider_name,
                    "status": "resumed",
                    "timestamp": time.time()
                }
            }
            message_json = json.dumps(message)
            message_bytes = message_json.encode("utf-8")
            await self.room.local_participant.publish_data(message_bytes, reliable=True)
        except Exception as e:
            print(f"[{self.provider_name}] Error sending resume confirmation: {e}")