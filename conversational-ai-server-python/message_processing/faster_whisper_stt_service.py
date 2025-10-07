"""Container-compatible local STT using faster-whisper + Silero VAD (no pvporcupine dependency)."""
import asyncio
import time
import os
import numpy as np
from typing import Optional, Callable
from livekit import rtc

try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError as e:
    print(f"[FasterWhisper] ERROR: faster-whisper not available: {e}")
    print(f"[FasterWhisper] Please install: pip install faster-whisper")
    WhisperModel = None
    FASTER_WHISPER_AVAILABLE = False

try:
    import torch
    torch_hub = torch.hub
    SILERO_VAD_AVAILABLE = True
except ImportError as e:
    print(f"[FasterWhisper] ERROR: torch not available for Silero VAD: {e}")
    print(f"[FasterWhisper] Please install: pip install torch torchaudio")
    SILERO_VAD_AVAILABLE = False

from .stream_service import StreamService


class FasterWhisperSTTService:
    """
    Container-compatible local STT service.

    Features:
    - 100% local processing with faster-whisper
    - Silero VAD for speech detection (no pvporcupine!)
    - Chunk-based partial results
    - Container/Kubernetes friendly
    - 300-600ms latency (chunk-based)
    """

    def __init__(
        self,
        room: rtc.Room,
        stream_service: StreamService,
        on_final_transcript: Optional[Callable] = None,
        language: str = "en"
    ):
        if not FASTER_WHISPER_AVAILABLE:
            raise RuntimeError("faster-whisper not available. Install with: pip install faster-whisper")
        if not SILERO_VAD_AVAILABLE:
            raise RuntimeError("torch not available for Silero VAD. Install with: pip install torch torchaudio")

        self.room = room
        self.stream_service = stream_service
        self.on_final_transcript = on_final_transcript
        self.language = language

        # Configuration from environment
        self.model_size = os.getenv("WHISPER_MODEL", "small.en")
        self.device = os.getenv("WHISPER_DEVICE", "cpu")
        self.compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")  # int8 for CPU, float16 for GPU

        # Audio configuration (must be defined before streaming config)
        self.sample_rate = 16000  # LiveKit uses 16kHz

        # VAD Configuration
        self.vad_threshold = float(os.getenv("VAD_THRESHOLD", "0.5"))
        self.vad_min_speech_ms = int(os.getenv("VAD_MIN_SPEECH_MS", "250"))
        self.vad_min_silence_ms = int(os.getenv("VAD_MIN_SILENCE_MS", "500"))

        # Streaming configuration
        self.enable_streaming = os.getenv("ENABLE_STREAMING_CHUNKS", "true").lower() == "true"
        self.chunk_length_ms = int(os.getenv("CHUNK_LENGTH_MS", "1000"))  # Process every 1 second

        # Partial transcript interval (how often to send partial results while speaking)
        self.partial_interval_ms = int(os.getenv("PARTIAL_TRANSCRIPT_INTERVAL_MS", "1000"))  # 1 second default
        self.partial_interval_samples = int(self.sample_rate * self.partial_interval_ms / 1000)

        print(f"[FasterWhisper] Initializing with model={self.model_size}, device={self.device}, language={language}")
        print(f"[FasterWhisper] VAD threshold={self.vad_threshold}, min_speech={self.vad_min_speech_ms}ms")
        print(f"[FasterWhisper] Streaming={self.enable_streaming}, partial_interval={self.partial_interval_ms}ms")

        # Whisper model and VAD - will be initialized in initialize()
        self.whisper_model = None
        self.vad_model = None
        self.initialized = False

        # Audio buffer for chunk-based processing
        self.audio_buffer = []
        self.samples_per_chunk = int(self.sample_rate * self.chunk_length_ms / 1000)

        # VAD window size (Silero VAD requires exactly 512 samples for 16kHz)
        self.vad_samples_per_window = 512  # 32ms windows at 16kHz

        # Speech accumulation buffer (separate from main buffer)
        self.speech_audio_buffer = []  # Accumulates audio during detected speech

        # Transcription state
        self.current_text = ""
        self.transcript_id = f"faster_whisper_{int(time.time())}"
        self.segment_count = 0
        self.last_final_text = ""
        self.last_final_time = 0
        self.last_partial_time = 0  # Track when we last sent a partial transcript

        # Speech detection state
        self.speech_detected = False
        self.speech_start_time = None
        self.silence_start_time = None
        self.last_speech_time = 0

        # TTS coordination
        self.assistant_speaking = False
        self.tts_service = None

        # Processing flags
        self.processing_endpoint = False
        self.ai_pipeline_running = False

        # Background processing
        self._processing_task = None
        self._shutdown_event = asyncio.Event()

    async def initialize(self):
        """Initialize faster-whisper model and Silero VAD."""
        try:
            print(f"[FasterWhisper] Loading Whisper model: {self.model_size}...")

            # Load faster-whisper model
            self.whisper_model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
                download_root=os.getenv("WHISPER_CACHE_DIR", None),  # Use default cache
            )

            print(f"[FasterWhisper] ✅ Whisper model loaded")

            # Load Silero VAD model
            print(f"[FasterWhisper] Loading Silero VAD...")
            self.vad_model, utils = torch_hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=True  # Use ONNX for better container compatibility
            )

            # Extract VAD utilities
            (get_speech_timestamps, _, read_audio, *_) = utils
            self.get_speech_timestamps = get_speech_timestamps

            print(f"[FasterWhisper] ✅ Silero VAD loaded (ONNX)")

            self.initialized = True
            print(f"[FasterWhisper] ✅ Initialization complete")
            return True

        except Exception as e:
            print(f"[FasterWhisper] ❌ Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def start_transcription(self):
        """Start audio processing task."""
        if not self.initialized:
            print(f"[FasterWhisper] ERROR: Not initialized, call initialize() first")
            return

        try:
            print(f"[FasterWhisper] 🎤 Starting transcription...")

            # Start background processing task
            self._processing_task = asyncio.create_task(self._audio_processing_loop())

            print(f"[FasterWhisper] ✅ Transcription started")

        except Exception as e:
            print(f"[FasterWhisper] Error starting transcription: {e}")

    async def stop_transcription(self):
        """Stop transcription and clean up."""
        try:
            print(f"[FasterWhisper] Stopping transcription...")
            self._shutdown_event.set()

            if self._processing_task and not self._processing_task.done():
                self._processing_task.cancel()
                try:
                    await self._processing_task
                except asyncio.CancelledError:
                    pass

            print(f"[FasterWhisper] ✅ Transcription stopped")

        except Exception as e:
            print(f"[FasterWhisper] Error stopping transcription: {e}")

    async def process_audio_chunk(self, audio_data, room_id: str = "room"):
        """
        Process audio chunk from LiveKit.

        Args:
            audio_data: Raw audio as int16 numpy array OR bytes (16kHz, int16)
            room_id: Room identifier (participant identity for proper message attribution)
        """
        # Block audio processing during AI response generation or TTS playback
        if self.assistant_speaking or self.ai_pipeline_running:
            # Log periodically to avoid spam (every 100 chunks)
            if not hasattr(self, '_skip_count'):
                self._skip_count = 0
            self._skip_count += 1
            if self._skip_count % 100 == 0:
                print(f"[FasterWhisper] Blocking audio - AI processing: {self.ai_pipeline_running}, TTS playing: {self.assistant_speaking}")
            return

        # Reset skip counter when processing resumes
        self._skip_count = 0

        if not self.initialized:
            return

        try:
            if len(audio_data) == 0:
                return

            # Handle both numpy arrays (from AudioStream) and bytes (legacy data channel)
            if isinstance(audio_data, np.ndarray):
                # Already int16 samples from AudioStream.frame.data
                audio_int16 = audio_data
            elif isinstance(audio_data, (list, bytes, bytearray)):
                # Legacy: convert bytes/list to int16
                if isinstance(audio_data, list):
                    # Data channel sends as list of integers
                    audio_data = bytes(audio_data)

                byte_array = np.frombuffer(audio_data, dtype=np.uint8)

                # Ensure even number of bytes
                if len(byte_array) % 2 != 0:
                    byte_array = np.append(byte_array, 0)

                # Convert to int16
                audio_int16 = byte_array.view(np.int16)
            else:
                print(f"[FasterWhisper] Unknown audio data type: {type(audio_data)}")
                return

            if len(audio_int16) > 0:
                # Add to buffer
                self.audio_buffer.extend(audio_int16.tolist())

        except Exception as e:
            print(f"[FasterWhisper] Error processing audio chunk: {e}")
            import traceback
            traceback.print_exc()

    async def _audio_processing_loop(self):
        """Background task to process buffered audio in VAD-sized windows."""
        try:
            print(f"[FasterWhisper] Audio processing loop started (VAD window size: {self.vad_samples_per_window} samples)")

            loop_count = 0
            while not self._shutdown_event.is_set():
                try:
                    # Process audio buffer frequently (every 32ms = VAD window size)
                    await asyncio.sleep(0.032)  # 32ms = 512 samples at 16kHz

                    loop_count += 1

                    # Log buffer status every 300 loops (~10 seconds)
                    if loop_count % 300 == 0:
                        buffer_duration_sec = len(self.audio_buffer) / self.sample_rate
                        speech_duration_sec = len(self.speech_audio_buffer) / self.sample_rate
                        print(f"[FasterWhisper] Buffer: {len(self.audio_buffer)} samples ({buffer_duration_sec:.2f}s), Speech buffer: {len(self.speech_audio_buffer)} samples ({speech_duration_sec:.2f}s), Speech active: {self.speech_detected}")

                    # Process all available VAD windows in the buffer
                    while len(self.audio_buffer) >= self.vad_samples_per_window:
                        # Extract exactly 512 samples for VAD
                        vad_window = self.audio_buffer[:self.vad_samples_per_window]
                        self.audio_buffer = self.audio_buffer[self.vad_samples_per_window:]

                        # Convert to float32 for VAD
                        window_array = np.array(vad_window, dtype=np.int16)
                        window_float = window_array.astype(np.float32) / 32768.0

                        # Check for speech with Silero VAD
                        await self._check_speech_activity(window_float, window_array)

                    # Trigger partial transcription while speaking for real-time feedback
                    current_time = time.time()
                    time_since_last_partial = (current_time - self.last_partial_time) * 1000  # Convert to ms

                    # Transcribe if:
                    # 1. Speech is detected
                    # 2. We have enough audio (based on configured interval)
                    # 3. Enough time has passed since last partial (avoid over-transcribing)
                    if (self.speech_detected and
                        len(self.speech_audio_buffer) >= self.partial_interval_samples and
                        time_since_last_partial >= self.partial_interval_ms):
                        self.last_partial_time = current_time
                        await self._transcribe_accumulated_audio()

                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    print(f"[FasterWhisper] Error in processing loop: {e}")
                    await asyncio.sleep(0.1)

        except asyncio.CancelledError:
            print(f"[FasterWhisper] Audio processing loop cancelled")
        except Exception as e:
            print(f"[FasterWhisper] Fatal error in processing loop: {e}")
            import traceback
            traceback.print_exc()

    async def _check_speech_activity(self, audio_chunk_float32: np.ndarray, audio_chunk_int16: np.ndarray):
        """Check for speech activity using Silero VAD and accumulate speech audio.

        Args:
            audio_chunk_float32: Float32 audio for VAD (512 samples)
            audio_chunk_int16: Int16 audio to accumulate (512 samples)
        """
        try:
            # Convert to torch tensor
            audio_tensor = torch.from_numpy(audio_chunk_float32)

            # Get speech probability
            speech_prob = self.vad_model(audio_tensor, self.sample_rate).item()

            current_time = time.time()

            if speech_prob > self.vad_threshold:
                # Speech detected
                if not self.speech_detected:
                    self.speech_detected = True
                    self.speech_start_time = current_time
                    print(f"[FasterWhisper] 🗣️  Speech started (prob: {speech_prob:.2f})")

                    # Generate new transcript ID
                    self.transcript_id = f"faster_whisper_{int(current_time)}_{self.segment_count}"

                    # Clear speech buffer for new utterance
                    self.speech_audio_buffer = []

                # Accumulate speech audio
                self.speech_audio_buffer.extend(audio_chunk_int16.tolist())

                self.last_speech_time = current_time
                self.silence_start_time = None

            else:
                # Silence detected
                if self.speech_detected:
                    # Continue accumulating during short silence (might be mid-sentence pause)
                    self.speech_audio_buffer.extend(audio_chunk_int16.tolist())

                    if self.silence_start_time is None:
                        self.silence_start_time = current_time

                    # Check if silence duration exceeds threshold
                    silence_duration_ms = (current_time - self.silence_start_time) * 1000
                    if silence_duration_ms >= self.vad_min_silence_ms:
                        print(f"[FasterWhisper] 🔇 Speech ended ({silence_duration_ms:.0f}ms silence)")
                        await self._handle_speech_end()

        except Exception as e:
            print(f"[FasterWhisper] Error in VAD: {e}")

    async def _transcribe_accumulated_audio(self):
        """Transcribe accumulated speech audio buffer."""
        try:
            if len(self.speech_audio_buffer) < self.sample_rate // 2:  # At least 0.5s of audio
                return

            # Get all accumulated speech audio
            audio_samples = np.array(self.speech_audio_buffer, dtype=np.int16)
            audio_float = audio_samples.astype(np.float32) / 32768.0
            audio_duration_sec = len(audio_samples) / self.sample_rate

            print(f"[FasterWhisper] 🎯 Transcribing {len(audio_samples)} samples ({audio_duration_sec:.2f}s)...")

            # Transcribe with faster-whisper
            segments, info = self.whisper_model.transcribe(
                audio_float,
                language=self.language,
                beam_size=5,
                vad_filter=False,  # We use Silero VAD externally
                word_timestamps=True,
                condition_on_previous_text=False,
            )

            # Process segments
            transcribed_text = ""
            for segment in segments:
                transcribed_text += segment.text + " "

            transcribed_text = transcribed_text.strip()

            if transcribed_text and transcribed_text != self.current_text:
                self.current_text = transcribed_text

                # Send as partial result
                if self.enable_streaming:
                    await self.stream_service.send_transcript_chunk(
                        text=transcribed_text,
                        is_final=False,
                        participant_id="room",
                        transcript_id=self.transcript_id,
                        confidence=0.8
                    )

                    print(f"[FasterWhisper] 📝 Partial: '{transcribed_text[:50]}{'...' if len(transcribed_text) > 50 else ''}'")

        except Exception as e:
            print(f"[FasterWhisper] Error transcribing: {e}")

    async def _handle_speech_end(self):
        """Handle end of speech - send final transcript."""
        try:
            if self.processing_endpoint:
                return

            self.processing_endpoint = True
            self.speech_detected = False

            # Final transcription of all accumulated speech audio
            if len(self.speech_audio_buffer) > 0:
                audio_samples = np.array(self.speech_audio_buffer, dtype=np.int16)
                audio_float = audio_samples.astype(np.float32) / 32768.0
                audio_duration_sec = len(audio_samples) / self.sample_rate

                print(f"[FasterWhisper] 🎯 Final transcription: {len(audio_samples)} samples ({audio_duration_sec:.2f}s)")

                segments, info = self.whisper_model.transcribe(
                    audio_float,
                    language=self.language,
                    beam_size=5,
                    vad_filter=False,
                )

                final_text = ""
                for segment in segments:
                    final_text += segment.text + " "

                final_text = final_text.strip()
            else:
                final_text = self.current_text.strip()

            if not final_text:
                self.processing_endpoint = False
                self.speech_audio_buffer = []
                return

            current_time = time.time()

            # Duplicate prevention
            if (final_text == self.last_final_text and
                current_time - self.last_final_time < 5.0):
                print(f"[FasterWhisper] Skipping duplicate final text")
                self.processing_endpoint = False
                self.speech_audio_buffer = []
                return

            # Check if AI pipeline is already processing
            if self.ai_pipeline_running:
                print(f"[FasterWhisper] AI pipeline already processing, skipping new transcript")
                self.processing_endpoint = False
                self.speech_audio_buffer = []
                return

            print(f"[FasterWhisper] ✅ Final: '{final_text}'")

            # Send final transcript to frontend
            await self.stream_service.send_transcript_chunk(
                text=final_text,
                is_final=True,
                participant_id="room",
                transcript_id=self.transcript_id,
                confidence=0.95
            )

            # Update tracking
            self.last_final_text = final_text
            self.last_final_time = current_time

            # Clear buffers and state
            self.speech_audio_buffer = []
            self.current_text = ""
            self.segment_count += 1

            # Trigger AI pipeline (set flag BEFORE calling to block new audio)
            if self.on_final_transcript:
                print(f"[FasterWhisper] Starting AI pipeline - blocking audio input")
                self.ai_pipeline_running = True
                try:
                    await self.on_final_transcript(final_text, "room")
                except Exception as e:
                    print(f"[FasterWhisper] AI pipeline error: {e}")
                finally:
                    # Note: ai_pipeline_running will be reset by on_assistant_speaking_change
                    # when TTS ends, not here
                    pass

        except Exception as e:
            print(f"[FasterWhisper] Error handling speech end: {e}")
        finally:
            self.processing_endpoint = False

    # Compatibility methods with existing STT interface

    def set_tts_service(self, tts_service):
        """Set TTS service reference."""
        self.tts_service = tts_service
        print("[FasterWhisper] TTS service reference set")

    async def on_assistant_speaking_change(self, is_speaking: bool):
        """Handle assistant speaking state change - blocks/unblocks audio processing."""
        try:
            self.assistant_speaking = is_speaking

            if is_speaking:
                print("[FasterWhisper] 🔊 TTS started - blocking audio input")
            else:
                print("[FasterWhisper] 🔇 TTS ended - unblocking audio input")
                # When TTS ends, also clear AI pipeline flag to fully unblock
                self.ai_pipeline_running = False

        except Exception as e:
            print(f"[FasterWhisper] Error handling speaking state change: {e}")

    async def handle_mute_signal(self, room_id: str = "room"):
        """Handle explicit mute signal - trigger final transcript."""
        try:
            print(f"[FasterWhisper] Received mute signal - triggering final transcript")

            if self.speech_detected:
                await self._handle_speech_end()

        except Exception as e:
            print(f"[FasterWhisper] Error handling mute signal: {e}")

    async def cleanup(self):
        """Clean up resources."""
        await self.stop_transcription()
        print("[FasterWhisper] Cleanup completed")
