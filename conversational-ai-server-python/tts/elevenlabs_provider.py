"""
ElevenLabs TTS Provider implementation.

Simple and reliable ElevenLabs TTS integration with pause/resume capabilities
and barge-in support.
"""

import asyncio
import os
import time
from typing import Optional, Dict, Any
import numpy as np

from .base import AbstractTTSProvider, TTSCapabilities, TTSState
from livekit import rtc

try:
    from elevenlabs import ElevenLabs, Voice, VoiceSettings
    ELEVENLABS_AVAILABLE = True
except ImportError:
    ELEVENLABS_AVAILABLE = False


class ElevenLabsTTSProvider(AbstractTTSProvider):
    """ElevenLabs TTS provider with streaming support."""

    def __init__(self, room: rtc.Room, stream_service, on_speaking_state_change=None):
        super().__init__(room, stream_service, on_speaking_state_change)

        # ElevenLabs configuration
        self.api_key = os.getenv("ELEVENLABS_API_KEY")
        self.voice_id = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # Default Rachel voice
        self.model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")  # Fast model for streaming

        # Voice settings
        self.stability = float(os.getenv("ELEVENLABS_STABILITY", "0.5"))
        self.similarity_boost = float(os.getenv("ELEVENLABS_SIMILARITY_BOOST", "0.8"))
        self.style = float(os.getenv("ELEVENLABS_STYLE", "0.0"))
        self.use_speaker_boost = os.getenv("ELEVENLABS_USE_SPEAKER_BOOST", "true").lower() == "true"

        # Client
        self.client = None

        # Audio streaming
        self.audio_buffer = []
        self.buffer_lock = asyncio.Lock()
        self.stream_task = None

        # Enhanced pause/resume state
        self.pause_state = {
            "current_sentence": "",
            "sentence_text_position": 0,
            "audio_buffer_position": 0,
            "remaining_audio_chunks": [],
            "paused_during_synthesis": False,
            "pause_timestamp": None,
            "synthesis_complete": False,
            "ws_synthesis_id": None
        }

        # Processing control
        self.stop_processing = False
        self.resume_lock = asyncio.Lock()
        self.resume_in_progress = False

    @property
    def capabilities(self) -> TTSCapabilities:
        """Get the capabilities of this TTS provider."""
        return TTSCapabilities(
            supports_streaming=True,
            supports_pause_resume=True,
            supports_barge_in=True,
            supports_voice_selection=True,
            supports_ssml=True,
            max_text_length=5000
        )

    @property
    def provider_name(self) -> str:
        """Get the name of this TTS provider."""
        return "elevenlabs"

    async def initialize(self) -> bool:
        """Initialize the ElevenLabs TTS provider."""
        try:
            self.state = TTSState.INITIALIZING

            if not ELEVENLABS_AVAILABLE:
                print("[ElevenLabs] ElevenLabs library not available")
                return False

            if not self.api_key:
                print("[ElevenLabs] API key not found in environment variables")
                return False

            # Initialize ElevenLabs client
            self.client = ElevenLabs(api_key=self.api_key)

            # Test API connection by getting voice info
            try:
                voice = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: self.client.voices.get(self.voice_id)
                )
                print(f"[ElevenLabs] Using voice: {voice.name} ({self.voice_id})")
            except Exception as e:
                print(f"[ElevenLabs] Warning: Could not verify voice {self.voice_id}: {e}")

            # Setup audio track
            await self.setup_audio_track()

            # Start sentence processing
            self._start_sentence_processing()

            self.state = TTSState.IDLE
            print("[ElevenLabs] Provider initialized successfully")
            return True

        except Exception as e:
            print(f"[ElevenLabs] Initialization error: {e}")
            self.state = TTSState.ERROR
            return False

    async def synthesize_sentence(self, sentence: str, voice: Optional[str] = None) -> Optional[np.ndarray]:
        """
        Synthesize a sentence using ElevenLabs streaming API.

        Note: This method collects all audio chunks before returning.
        For real streaming, use the websocket approach in _process_single_sentence.
        """
        try:
            self.state = TTSState.SYNTHESIZING

            # Use provided voice or default
            voice_id = voice or self.voice_id

            # Collect audio chunks
            audio_chunks = []

            # Use correct ElevenLabs API method
            audio_generator = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.client.text_to_speech.convert(
                    voice_id=voice_id,
                    text=sentence,
                    model_id=self.model_id,
                    voice_settings={
                        'stability': self.stability,
                        'similarity_boost': self.similarity_boost,
                        'style': self.style,
                        'use_speaker_boost': self.use_speaker_boost
                    }
                )
            )

            # Convert response to audio data
            if hasattr(audio_generator, 'content'):
                audio_data = audio_generator.content
            elif isinstance(audio_generator, bytes):
                audio_data = audio_generator
            else:
                # Generator case - collect all chunks
                audio_data = b''.join(audio_generator)

            # Convert to numpy array
            audio_array = self._convert_audio_to_numpy(audio_data)

            print(f"[ElevenLabs] Synthesized sentence: {len(audio_array) if audio_array is not None else 0} samples")
            return audio_array

        except Exception as e:
            print(f"[ElevenLabs] Error synthesizing sentence: {e}")
            return None

    async def stream_audio_data(self, audio_data: np.ndarray) -> bool:
        """Stream audio data to LiveKit with pause checking."""
        try:
            if not self.audio_source or len(audio_data) == 0:
                return False

            # Use small chunks for responsive pausing (30ms)
            chunk_size = 480  # 30ms at 16kHz
            chunks_sent = 0

            for i in range(0, len(audio_data), chunk_size):
                chunk = audio_data[i:i + chunk_size]
                if len(chunk) < chunk_size:
                    chunk = np.pad(chunk, (0, chunk_size - len(chunk)))

                # Convert and send chunk
                chunk_clipped = np.clip(chunk, -1.0, 1.0)
                chunk_int16 = (chunk_clipped * 32767).astype(np.int16)

                frame = rtc.AudioFrame(
                    data=chunk_int16.tobytes(),
                    sample_rate=16000,
                    num_channels=1,
                    samples_per_channel=len(chunk)
                )

                # Send with retry logic
                success = await self._send_audio_frame_with_retry(frame)
                if not success:
                    # Store pause state for potential resume
                    await self._store_pause_state_at_position(
                        self.pause_state.get("current_sentence", ""),
                        i, audio_data[i:]
                    )
                    return False

                chunks_sent += 1

                # Check for pause after sending chunk
                if self.is_paused:
                    next_audio_position = i + chunk_size
                    remaining_audio = audio_data[next_audio_position:] if next_audio_position < len(audio_data) else None
                    await self._store_pause_state_at_position(
                        self.pause_state.get("current_sentence", ""),
                        next_audio_position, remaining_audio
                    )
                    return False  # Paused mid-stream

                # Minimal delay for responsiveness
                await asyncio.sleep(0.001)

            print(f"[ElevenLabs] Completed streaming {chunks_sent} chunks")
            return True

        except Exception as e:
            print(f"[ElevenLabs] Error streaming audio data: {e}")
            return False

    async def _send_audio_frame_with_retry(self, frame: rtc.AudioFrame) -> bool:
        """Send audio frame with retry logic."""
        retry_count = 0
        max_retries = 3

        while retry_count < max_retries:
            try:
                await self.audio_source.capture_frame(frame)
                return True
            except Exception as e:
                error_msg = str(e)
                if "InvalidState" in error_msg and retry_count < max_retries - 1:
                    retry_count += 1
                    await asyncio.sleep(0.05)
                else:
                    print(f"[ElevenLabs] Audio capture failed: {error_msg}")
                    return False

        return False

    def _convert_audio_to_numpy(self, audio_data: bytes) -> Optional[np.ndarray]:
        """Convert ElevenLabs audio data to numpy array - simple and clean approach."""
        try:
            if not audio_data or len(audio_data) == 0:
                print("[ElevenLabs] Empty audio data received")
                return None

            # Simple MP3 decode using pydub
            try:
                from pydub import AudioSegment
                import io

                # Decode MP3 and convert to 16kHz mono
                audio = AudioSegment.from_file(io.BytesIO(audio_data), format="mp3")
                audio = audio.set_frame_rate(16000).set_channels(1)

                # Simple conversion to numpy array
                audio_array = np.array(audio.get_array_of_samples(), dtype=np.float32)

                if len(audio_array) == 0:
                    print("[ElevenLabs] No audio samples after conversion")
                    return None

                # Simple normalization based on bit depth
                if audio.sample_width == 2:  # 16-bit
                    audio_array = audio_array / 32768.0
                else:
                    # Default assumption
                    audio_array = audio_array / 32768.0

                # Simple clipping to prevent distortion
                audio_array = np.clip(audio_array, -0.95, 0.95)

                print(f"[ElevenLabs] Successfully converted MP3: {len(audio_array)} samples")
                return audio_array.astype(np.float32)

            except ImportError:
                print("[ElevenLabs] pydub not available")
                return None
            except Exception as e:
                print(f"[ElevenLabs] MP3 conversion failed: {e}")
                return None

        except Exception as e:
            print(f"[ElevenLabs] Audio conversion error: {e}")
            return None


    def _start_sentence_processing(self):
        """Start async sentence processing task."""
        if self.processing_task is None:
            self.stop_processing = False
            self.processing_task = asyncio.create_task(self._process_sentence_queue())

    async def _process_sentence_queue(self):
        """Process sentence queue with pause support."""
        while not self.stop_processing:
            try:
                # Wait for pause to be lifted
                if self.is_paused:
                    await self.pause_event.wait()
                    if self.stop_processing:
                        break

                # Wait if resume is in progress
                while self.resume_in_progress and not self.stop_processing:
                    await asyncio.sleep(0.1)

                # Get sentence from queue
                try:
                    sentence = await asyncio.wait_for(self.sentence_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if sentence is None:  # Shutdown signal
                    break

                # Process sentence
                await self._process_single_sentence(sentence)
                self.sentence_queue.task_done()

            except Exception as e:
                print(f"[ElevenLabs] Error in sentence processing: {e}")

    async def _process_single_sentence(self, sentence: str):
        """Process a single sentence through synthesis and streaming."""
        try:
            # Check pause before processing
            if self.is_paused:
                self.pause_state["current_sentence"] = sentence
                return

            print(f"[ElevenLabs] Processing sentence: '{sentence}'")
            await self._on_audio_start()

            # Use simple synthesis approach (no websocket complexity)
            audio_data = await self.synthesize_sentence(sentence)
            if audio_data is not None:
                success = await self.stream_audio_data(audio_data)
            else:
                success = False

            # Handle completion
            if success and not self.is_paused:
                self.pause_state["synthesis_complete"] = True
                await self._on_audio_stop()
                self._clear_pause_state()
            elif self.is_paused:
                print(f"[ElevenLabs] Sentence paused: '{sentence}'")

        except Exception as e:
            print(f"[ElevenLabs] Error processing sentence: {e}")
            if not self.is_paused:
                await self._on_audio_stop()

    async def _store_pause_state_at_position(self, sentence: str, audio_position: int, remaining_audio: Optional[np.ndarray]):
        """Store pause state at specific position."""
        # Calculate text position based on audio progress
        if len(sentence) > 0 and remaining_audio is not None:
            total_audio_length = audio_position + len(remaining_audio)
            if total_audio_length > 0:
                progress_ratio = audio_position / total_audio_length
                text_position = int(progress_ratio * len(sentence))
            else:
                text_position = 0
        else:
            text_position = len(sentence)

        self.pause_state.update({
            "current_sentence": sentence,
            "sentence_text_position": text_position,
            "audio_buffer_position": audio_position,
            "remaining_audio_chunks": [remaining_audio] if remaining_audio is not None else [],
            "paused_during_synthesis": True,
            "pause_timestamp": time.time(),
            "synthesis_complete": remaining_audio is None
        })

        print(f"[ElevenLabs] Stored pause state: audio_pos={audio_position}, text_pos={text_position}")

    async def _resume_from_pause_state(self):
        """Resume from stored pause state."""
        try:
            async with self.resume_lock:
                self.resume_in_progress = True

                try:
                    current_sentence = self.pause_state.get("current_sentence", "")
                    remaining_chunks = self.pause_state.get("remaining_audio_chunks", [])
                    text_position = self.pause_state.get("sentence_text_position", 0)

                    if not current_sentence:
                        return

                    print(f"[ElevenLabs] Resuming from pause: '{current_sentence[:30]}...'")

                    # Strategy 1: Resume from remaining audio chunks
                    if remaining_chunks:
                        for chunk in remaining_chunks:
                            if chunk is not None and len(chunk) > 0:
                                completed = await self.stream_audio_data(chunk)
                                if not completed:
                                    return  # Paused again

                        self._clear_pause_state()
                        await self._on_audio_stop()
                        return

                    # Strategy 2: Re-synthesize remaining text
                    if text_position < len(current_sentence):
                        remaining_text = current_sentence[text_position:].strip()
                        if remaining_text:
                            print(f"[ElevenLabs] Re-synthesizing remaining text: '{remaining_text[:30]}...'")
                            self._clear_pause_state()
                            await self._process_single_sentence(remaining_text)
                            return

                    # Strategy 3: Nothing to resume
                    print("[ElevenLabs] Nothing to resume, synthesis was complete")
                    self._clear_pause_state()

                finally:
                    self.resume_in_progress = False

        except Exception as e:
            print(f"[ElevenLabs] Error resuming from pause: {e}")
            self._clear_pause_state()
            self.resume_in_progress = False

    def _clear_pause_state(self):
        """Clear pause state."""
        self.pause_state = {
            "current_sentence": "",
            "sentence_text_position": 0,
            "audio_buffer_position": 0,
            "remaining_audio_chunks": [],
            "paused_during_synthesis": False,
            "pause_timestamp": None,
            "synthesis_complete": False,
            "ws_synthesis_id": None
        }

    async def _cleanup_provider(self):
        """Provider-specific cleanup."""
        try:
            # Stop processing
            self.stop_processing = True

            # Cancel processing task
            if self.processing_task and not self.processing_task.done():
                self.processing_task.cancel()
                try:
                    await self.processing_task
                except asyncio.CancelledError:
                    pass

            # Clean up client
            self.client = None

            print("[ElevenLabs] Provider cleanup completed")

        except Exception as e:
            print(f"[ElevenLabs] Error during provider cleanup: {e}")