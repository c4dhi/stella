"""faster-whisper STT provider with Silero VAD - GPU-accelerated production model."""

import os
import time
import uuid
import asyncio
from typing import List, Optional
import numpy as np

from .base import STTProvider, STTSession
import stt_pb2

# Try to import faster-whisper
try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError as e:
    print(f"[WhisperProvider] faster-whisper not available: {e}")
    WhisperModel = None
    FASTER_WHISPER_AVAILABLE = False

# Try to import torch for Silero VAD
try:
    import torch
    TORCH_AVAILABLE = True
except ImportError as e:
    print(f"[WhisperProvider] torch not available for Silero VAD: {e}")
    TORCH_AVAILABLE = False


class WhisperSession(STTSession):
    """faster-whisper session with VAD-based streaming.

    Strategy:
    1. Buffer incoming audio in 32ms VAD windows (512 samples @ 16kHz)
    2. Check speech probability per window using Silero VAD
    3. Accumulate speech audio in speech_buffer
    4. Send partial transcripts at configurable intervals (e.g., 1s)
    5. Send final transcript when VAD detects end-of-speech (silence >= threshold)
    """

    def __init__(
        self,
        session_id: str,
        participant_id: str,
        whisper_model: 'WhisperModel',
        vad_model,
        config: dict
    ):
        self.session_id = session_id
        self.participant_id = participant_id
        self.whisper_model = whisper_model
        self.vad_model = vad_model
        self.config = config

        # Audio buffers
        self.audio_buffer = []           # Raw incoming audio (any size chunks)
        self.speech_buffer = []          # Accumulated speech audio

        # VAD state
        self.speech_detected = False
        self.silence_start_time = None
        self.last_speech_time = 0

        # Transcript state
        self.transcript_id = f"whisper_{uuid.uuid4().hex[:8]}"
        self.accumulated_text = ""
        self.last_partial_time = 0
        self.last_final_text = ""
        self.last_final_time = 0

        # Configuration from provider
        self.vad_window_samples = 512    # 32ms @ 16kHz (required by Silero)
        self.vad_threshold = config.get('vad_threshold', 0.5)
        self.vad_min_silence_ms = config.get('vad_min_silence_ms', 500)
        self.partial_interval_ms = config.get('partial_interval_ms', 1000)
        self.min_speech_samples = config.get('min_speech_samples', 8000)  # 0.5s

        # Processing state
        self.processing_endpoint = False
        self.chunk_count = 0

    def process_audio(self, audio_data: bytes) -> List[stt_pb2.TranscriptEvent]:
        """Process audio chunk through VAD and return transcript events."""
        events = []
        current_time = time.time()
        self.chunk_count += 1

        try:
            # Convert bytes to numpy array (16-bit PCM)
            audio_int16 = np.frombuffer(audio_data, dtype=np.int16)
            if len(audio_int16) == 0:
                return events

            # Add to audio buffer
            self.audio_buffer.extend(audio_int16.tolist())

            # Process all available VAD windows in the buffer
            while len(self.audio_buffer) >= self.vad_window_samples:
                # Extract exactly 512 samples for VAD
                vad_window = self.audio_buffer[:self.vad_window_samples]
                self.audio_buffer = self.audio_buffer[self.vad_window_samples:]

                # Convert to float32 for VAD
                window_array = np.array(vad_window, dtype=np.int16)
                window_float = window_array.astype(np.float32) / 32768.0

                # Check for speech activity
                vad_events = self._check_speech_activity(window_float, window_array, current_time)
                events.extend(vad_events)

            # Trigger partial transcription while speaking
            time_since_last_partial = (current_time - self.last_partial_time) * 1000

            if (self.speech_detected and
                len(self.speech_buffer) >= self.min_speech_samples and
                time_since_last_partial >= self.partial_interval_ms):
                self.last_partial_time = current_time
                partial_event = self._transcribe_partial(current_time)
                if partial_event:
                    events.append(partial_event)

        except Exception as e:
            print(f"[WhisperSession] Audio processing error: {e}")
            import traceback
            traceback.print_exc()

        return events

    def _check_speech_activity(
        self,
        audio_float: np.ndarray,
        audio_int16: np.ndarray,
        current_time: float
    ) -> List[stt_pb2.TranscriptEvent]:
        """Check for speech activity using Silero VAD."""
        events = []

        try:
            # Get speech probability from VAD
            audio_tensor = torch.from_numpy(audio_float)
            speech_prob = self.vad_model(audio_tensor, 16000).item()

            if speech_prob > self.vad_threshold:
                # Speech detected
                if not self.speech_detected:
                    self.speech_detected = True
                    print(f"[WhisperSession] Speech started (prob: {speech_prob:.2f})")

                    # Generate new transcript ID for new utterance
                    self.transcript_id = f"whisper_{uuid.uuid4().hex[:8]}"
                    self.speech_buffer = []
                    self.accumulated_text = ""

                # Accumulate speech audio
                self.speech_buffer.extend(audio_int16.tolist())
                self.last_speech_time = current_time
                self.silence_start_time = None

            else:
                # Silence detected
                if self.speech_detected:
                    # Continue accumulating during short silence (might be mid-sentence)
                    self.speech_buffer.extend(audio_int16.tolist())

                    if self.silence_start_time is None:
                        self.silence_start_time = current_time

                    # Check if silence duration exceeds threshold
                    silence_duration_ms = (current_time - self.silence_start_time) * 1000
                    if silence_duration_ms >= self.vad_min_silence_ms:
                        print(f"[WhisperSession] Speech ended ({silence_duration_ms:.0f}ms silence)")
                        final_event = self._handle_speech_end(current_time)
                        if final_event:
                            events.append(final_event)

        except Exception as e:
            print(f"[WhisperSession] VAD error: {e}")

        return events

    def _transcribe_partial(self, current_time: float) -> Optional[stt_pb2.TranscriptEvent]:
        """Transcribe accumulated speech buffer for partial result."""
        if len(self.speech_buffer) < self.min_speech_samples:
            return None

        try:
            audio_samples = np.array(self.speech_buffer, dtype=np.int16)
            audio_float = audio_samples.astype(np.float32) / 32768.0
            audio_duration_sec = len(audio_samples) / 16000

            # Transcribe with faster-whisper
            segments, info = self.whisper_model.transcribe(
                audio_float,
                language=self.config.get('language'),
                beam_size=self.config.get('beam_size', 5),
                vad_filter=False,  # We use external Silero VAD
                word_timestamps=False,
                condition_on_previous_text=False,
            )

            # Process segments
            transcribed_text = ""
            for segment in segments:
                transcribed_text += segment.text + " "
            transcribed_text = transcribed_text.strip()

            if transcribed_text and transcribed_text != self.accumulated_text:
                self.accumulated_text = transcribed_text
                print(f"[WhisperSession] Partial ({audio_duration_sec:.2f}s): '{transcribed_text[:50]}...'")

                return stt_pb2.TranscriptEvent(
                    text=transcribed_text,
                    is_final=False,
                    transcript_id=self.transcript_id,
                    participant_id=self.participant_id,
                    confidence=0.8,
                    timestamp_ms=int(current_time * 1000)
                )

        except Exception as e:
            print(f"[WhisperSession] Partial transcription error: {e}")

        return None

    def _handle_speech_end(self, current_time: float) -> Optional[stt_pb2.TranscriptEvent]:
        """Handle end of speech - return final transcript."""
        if self.processing_endpoint:
            return None

        self.processing_endpoint = True
        self.speech_detected = False

        try:
            if len(self.speech_buffer) < self.min_speech_samples // 2:
                return None

            audio_samples = np.array(self.speech_buffer, dtype=np.int16)
            audio_float = audio_samples.astype(np.float32) / 32768.0
            audio_duration_sec = len(audio_samples) / 16000

            # Final transcription
            segments, info = self.whisper_model.transcribe(
                audio_float,
                language=self.config.get('language'),
                beam_size=self.config.get('beam_size', 5),
                vad_filter=False,
                word_timestamps=False,
                condition_on_previous_text=False,
            )

            final_text = ""
            for segment in segments:
                final_text += segment.text + " "
            final_text = final_text.strip()

            if not final_text or len(final_text) < 2:
                return None

            # Check for duplicate
            if (final_text == self.last_final_text and
                current_time - self.last_final_time < 5.0):
                print(f"[WhisperSession] Skipping duplicate")
                return None

            print(f"[WhisperSession] Final ({audio_duration_sec:.2f}s): '{final_text}'")

            self.last_final_text = final_text
            self.last_final_time = current_time

            event = stt_pb2.TranscriptEvent(
                text=final_text,
                is_final=True,
                transcript_id=self.transcript_id,
                participant_id=self.participant_id,
                confidence=0.95,
                timestamp_ms=int(current_time * 1000)
            )

            # Reset for next utterance
            self.reset()

            return event

        except Exception as e:
            print(f"[WhisperSession] Final transcription error: {e}")
            return None

        finally:
            self.processing_endpoint = False

    def reset(self) -> None:
        """Reset state for next utterance."""
        self.speech_buffer = []
        self.accumulated_text = ""
        self.transcript_id = f"whisper_{uuid.uuid4().hex[:8]}"
        self.silence_start_time = None
        self.speech_detected = False


class WhisperProvider(STTProvider):
    """faster-whisper STT provider with Silero VAD.

    GPU-accelerated production model (~3GB for large-v3).
    Optimized for Tesla T4 with float16 compute.
    """

    def __init__(self):
        self.whisper_model = None
        self.vad_model = None
        self.model_ready = False

        # Configuration from environment
        self.model_size = os.getenv("WHISPER_MODEL", "large-v3")
        self.device = os.getenv("WHISPER_DEVICE", "cuda")
        self.compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "float16")
        self.language = os.getenv("WHISPER_LANGUAGE", None)  # None = auto-detect
        self.beam_size = int(os.getenv("WHISPER_BEAM_SIZE", "5"))

        # VAD configuration
        self.vad_threshold = float(os.getenv("VAD_THRESHOLD", "0.5"))
        self.vad_min_silence_ms = int(os.getenv("VAD_MIN_SILENCE_MS", "500"))
        self.partial_interval_ms = int(os.getenv("PARTIAL_INTERVAL_MS", "1000"))

        print(f"[WhisperProvider] Config: model={self.model_size}, device={self.device}, "
              f"compute_type={self.compute_type}, language={self.language or 'auto'}")

    @property
    def name(self) -> str:
        return "whisper"

    @property
    def is_available(self) -> bool:
        return FASTER_WHISPER_AVAILABLE and TORCH_AVAILABLE

    async def initialize(self) -> bool:
        """Initialize faster-whisper model and Silero VAD.

        Models must be pre-downloaded during Docker build - no network access at runtime.
        """
        if not self.is_available:
            print("[WhisperProvider] Dependencies not available")
            return False

        try:
            # Load faster-whisper model from cache (pre-downloaded during build)
            print(f"[WhisperProvider] Loading Whisper model: {self.model_size} "
                  f"(device={self.device}, compute_type={self.compute_type})...")

            cache_dir = os.getenv("WHISPER_CACHE_DIR", "/root/.cache/whisper")

            # local_files_only=True ensures no network download at runtime
            self.whisper_model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
                download_root=cache_dir,
                local_files_only=True,  # IMPORTANT: Load from cache only, no network
            )
            print(f"[WhisperProvider] Whisper model loaded from cache: {cache_dir}")

            # Load Silero VAD model from cache (pre-downloaded during build)
            print(f"[WhisperProvider] Loading Silero VAD...")

            # Check for pre-downloaded local repo first
            silero_cache_dir = os.getenv("SILERO_VAD_CACHE_DIR", "/root/.cache/silero-vad")
            silero_local_repo = os.path.join(silero_cache_dir, "snakers4_silero-vad")

            if os.path.exists(silero_local_repo):
                # Load from local directory (no network access)
                print(f"[WhisperProvider] Loading Silero VAD from local: {silero_local_repo}")
                self.vad_model, _ = torch.hub.load(
                    repo_or_dir=silero_local_repo,
                    model='silero_vad',
                    source='local',
                    onnx=True
                )
            else:
                # Fallback to torch hub cache (may need network on first run)
                print(f"[WhisperProvider] Loading Silero VAD from torch hub cache...")
                self.vad_model, _ = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    trust_repo=True,
                    onnx=True
                )
            print(f"[WhisperProvider] Silero VAD loaded (ONNX)")

            self.model_ready = True
            print(f"[WhisperProvider] Initialization complete")
            return True

        except Exception as e:
            print(f"[WhisperProvider] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    def create_session(self, session_id: str, participant_id: str) -> Optional[WhisperSession]:
        """Create a new transcription session."""
        if not self.model_ready:
            return None

        config = {
            'language': self.language,
            'beam_size': self.beam_size,
            'vad_threshold': self.vad_threshold,
            'vad_min_silence_ms': self.vad_min_silence_ms,
            'partial_interval_ms': self.partial_interval_ms,
            'min_speech_samples': 8000,  # 0.5s minimum
        }

        return WhisperSession(
            session_id=session_id,
            participant_id=participant_id,
            whisper_model=self.whisper_model,
            vad_model=self.vad_model,
            config=config
        )

    async def cleanup(self) -> None:
        """Clean up resources."""
        self.whisper_model = None
        self.vad_model = None
        self.model_ready = False
        print("[WhisperProvider] Cleanup completed")

    def get_capabilities(self) -> dict:
        return {
            "supports_streaming": True,
            "supports_gpu": True,
            "supported_languages": ["en", "de", "fr", "es", "it", "pt", "nl", "pl", "ru", "zh", "ja", "ko"],
            "model_size_mb": 3000 if "large" in self.model_size else 1500,
            "latency_ms": "300-600 (VAD-chunked)",
        }
