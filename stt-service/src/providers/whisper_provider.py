"""faster-whisper STT provider with Silero VAD - Simplified implementation.

Follows industry best practices:
- Single VAD signal (Silero probability threshold)
- Simple 2-state machine (IDLE/SPEAKING)
- Single safety timeout
- No spectral analysis overhead
"""

import os
import time
import uuid
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
    """faster-whisper session with simplified VAD-based streaming.

    Architecture:
    1. Buffer incoming audio in 512-sample VAD windows (32ms @ 16kHz)
    2. Check speech probability per window using Silero VAD (single signal)
    3. Simple 2-state machine: IDLE -> SPEAKING -> IDLE
    4. Emit partials every N ms while speaking
    5. Emit final when silence exceeds threshold
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

        # Core state (2-state machine: IDLE or SPEAKING)
        self.state = "IDLE"
        self.speech_buffer = []
        self.audio_buffer = []

        # VAD config (5 core parameters)
        self.vad_threshold = config.get('vad_threshold', 0.5)
        self.silence_duration_ms = config.get('silence_duration_ms', 500)
        self.min_speech_samples = config.get('min_speech_samples', 8000)  # 0.5s @ 16kHz
        self.max_speech_duration_ms = config.get('max_speech_duration_ms', 30000)
        self.partial_interval_ms = config.get('partial_interval_ms', 1000)

        # Tracking
        self.silence_start_time = None
        self.speech_start_time = None
        self.last_partial_time = 0
        self.transcript_id = None
        self.last_final_text = ""
        self.last_final_time = 0

        # Pre-buffer for speech onset (captures audio before VAD triggers)
        self.pre_buffer_samples = config.get('pre_buffer_samples', 3200)  # 200ms
        self.pre_buffer = []

        # Language detection caching
        self.detected_language = None

        # Precompute high-pass filter coefficients (80Hz cutoff for noise removal)
        from scipy import signal
        self.highpass_sos = signal.butter(5, 80, btype='highpass', fs=16000, output='sos')

        # Processing state
        self.chunk_count = 0

    def _preprocess_audio(self, audio_float: np.ndarray) -> np.ndarray:
        """Simple preprocessing: high-pass filter + normalize."""
        from scipy import signal

        # High-pass filter to remove low-frequency noise/hum
        audio_float = signal.sosfilt(self.highpass_sos, audio_float)

        # Normalize audio to 0.95 peak
        peak = np.abs(audio_float).max()
        if peak > 0.01:
            audio_float = audio_float / peak * 0.95

        return audio_float

    def process_audio(self, audio_data: bytes, sample_rate: int = 16000) -> List[stt_pb2.TranscriptEvent]:
        """Process audio chunk through VAD and return transcript events."""
        events = []
        current_time = time.time()
        self.chunk_count += 1

        # Safety timeout (only timeout mechanism)
        if self.state == "SPEAKING" and self.speech_start_time:
            speech_duration_ms = (current_time - self.speech_start_time) * 1000
            if speech_duration_ms >= self.max_speech_duration_ms:
                print(f"[WhisperSession] TIMEOUT: Speech exceeded {self.max_speech_duration_ms}ms")
                final_event = self._generate_final(current_time)
                if final_event:
                    events.append(final_event)
                self._reset()
                return events

        try:
            # Convert bytes to numpy array (16-bit PCM)
            audio_int16 = np.frombuffer(audio_data, dtype=np.int16)
            if len(audio_int16) == 0:
                return events

            # Resample if needed (Whisper expects 16kHz)
            target_rate = 16000
            if sample_rate != target_rate and sample_rate > 0:
                if self.chunk_count == 1:
                    print(f"[WhisperSession] Resampling from {sample_rate}Hz to {target_rate}Hz")
                from scipy import signal
                num_samples = int(len(audio_int16) * target_rate / sample_rate)
                audio_int16 = signal.resample(audio_int16, num_samples).astype(np.int16)

            # Add to audio buffer
            self.audio_buffer.extend(audio_int16.tolist())

            # Process all available VAD windows (512 samples = 32ms)
            vad_window_samples = 512
            while len(self.audio_buffer) >= vad_window_samples:
                window = self.audio_buffer[:vad_window_samples]
                self.audio_buffer = self.audio_buffer[vad_window_samples:]

                window_float = np.array(window, dtype=np.float32) / 32768.0
                window_int16 = np.array(window, dtype=np.int16)

                vad_events = self._check_speech_activity(window_float, window_int16, current_time)
                events.extend(vad_events)

            # Emit partials periodically while speaking
            if self.state == "SPEAKING" and len(self.speech_buffer) >= self.min_speech_samples:
                time_since_partial = (current_time - self.last_partial_time) * 1000
                if time_since_partial >= self.partial_interval_ms:
                    partial = self._transcribe_partial(current_time)
                    if partial:
                        events.append(partial)
                        self.last_partial_time = current_time

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
        """Check for speech activity using Silero VAD (single signal)."""
        events = []

        try:
            # Get VAD probability (single signal)
            audio_tensor = torch.from_numpy(audio_float)
            speech_prob = self.vad_model(audio_tensor, 16000).item()

            if speech_prob > self.vad_threshold:
                # Speech detected
                self.silence_start_time = None

                if self.state == "IDLE":
                    # Transition: IDLE -> SPEAKING
                    self.state = "SPEAKING"
                    self.speech_start_time = current_time
                    self.transcript_id = f"whisper_{uuid.uuid4().hex[:8]}"
                    self.speech_buffer = self.pre_buffer.copy()
                    self.pre_buffer = []
                    print(f"[WhisperSession] Speech started (prob={speech_prob:.2f})")

                    # Emit speech_started event for barge-in detection
                    events.append(stt_pb2.TranscriptEvent(
                        text="",
                        is_final=False,
                        transcript_id=self.transcript_id,
                        participant_id=self.participant_id,
                        confidence=0.0,
                        timestamp_ms=int(current_time * 1000),
                        speech_started=True
                    ))

                # Accumulate audio
                self.speech_buffer.extend(audio_int16.tolist())

            else:
                # Silence detected
                self.pre_buffer.extend(audio_int16.tolist())
                if len(self.pre_buffer) > self.pre_buffer_samples:
                    self.pre_buffer = self.pre_buffer[-self.pre_buffer_samples:]

                if self.state == "SPEAKING":
                    # Track silence duration
                    if self.silence_start_time is None:
                        self.silence_start_time = current_time

                    # Continue accumulating during silence (might resume)
                    self.speech_buffer.extend(audio_int16.tolist())

                    # Check if silence threshold reached
                    silence_ms = (current_time - self.silence_start_time) * 1000
                    if silence_ms >= self.silence_duration_ms:
                        # Transition: SPEAKING -> IDLE, emit final
                        print(f"[WhisperSession] Speech ended ({silence_ms:.0f}ms silence)")
                        final_event = self._generate_final(current_time)
                        if final_event:
                            events.append(final_event)
                        self._reset()

        except Exception as e:
            print(f"[WhisperSession] VAD error: {e}")

        return events

    def _transcribe_partial(self, current_time: float) -> Optional[stt_pb2.TranscriptEvent]:
        """Transcribe accumulated speech buffer for partial result."""
        if len(self.speech_buffer) < self.min_speech_samples:
            return None

        try:
            # Use last 10 seconds for partials (context window)
            max_partial_samples = 10 * 16000
            audio_for_partial = self.speech_buffer[-max_partial_samples:] if len(self.speech_buffer) > max_partial_samples else self.speech_buffer

            audio_samples = np.array(audio_for_partial, dtype=np.int16)
            audio_float = audio_samples.astype(np.float32) / 32768.0
            audio_duration_sec = len(audio_samples) / 16000

            # Apply preprocessing
            audio_float = self._preprocess_audio(audio_float)

            # Use cached or configured language
            config_lang = self.config.get('language')
            language = self.detected_language or (config_lang if config_lang else None)

            # Transcribe with faster-whisper
            segments, info = self.whisper_model.transcribe(
                audio_float,
                language=language,
                beam_size=self.config.get('beam_size', 5),
                vad_filter=False,
                word_timestamps=False,
                condition_on_previous_text=False,
                initial_prompt=self.config.get('initial_prompt'),
                temperature=0.0,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
            )

            # Cache detected language
            if not self.detected_language and hasattr(info, 'language') and info.language:
                self.detected_language = info.language
                print(f"[WhisperSession] Detected language: {self.detected_language}")

            # Process segments
            transcribed_text = ""
            for segment in segments:
                transcribed_text += segment.text + " "
            transcribed_text = transcribed_text.strip()

            if transcribed_text:
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

    def _generate_final(self, current_time: float) -> Optional[stt_pb2.TranscriptEvent]:
        """Generate final transcript event."""
        if len(self.speech_buffer) < self.min_speech_samples:
            print(f"[WhisperSession] Audio too short: {len(self.speech_buffer)} < {self.min_speech_samples}")
            return None

        try:
            audio_samples = np.array(self.speech_buffer, dtype=np.int16)
            audio_float = audio_samples.astype(np.float32) / 32768.0
            audio_duration_sec = len(audio_samples) / 16000

            # Apply preprocessing
            audio_float = self._preprocess_audio(audio_float)

            # Use cached or configured language
            config_lang = self.config.get('language')
            language = self.detected_language or (config_lang if config_lang else None)

            # Final transcription
            segments, info = self.whisper_model.transcribe(
                audio_float,
                language=language,
                beam_size=self.config.get('beam_size', 5),
                vad_filter=False,
                word_timestamps=False,
                condition_on_previous_text=False,
                initial_prompt=self.config.get('initial_prompt'),
                temperature=0.0,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
            )

            # Cache detected language
            if not self.detected_language and hasattr(info, 'language') and info.language:
                self.detected_language = info.language
                print(f"[WhisperSession] Detected language: {self.detected_language}")

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

            return stt_pb2.TranscriptEvent(
                text=final_text,
                is_final=True,
                transcript_id=self.transcript_id,
                participant_id=self.participant_id,
                confidence=0.95,
                timestamp_ms=int(current_time * 1000)
            )

        except Exception as e:
            print(f"[WhisperSession] Final transcription error: {e}")
            return None

    def _reset(self) -> None:
        """Reset state for next utterance."""
        self.state = "IDLE"
        self.speech_buffer = []
        self.silence_start_time = None
        self.speech_start_time = None
        self.transcript_id = None

    def reset(self) -> None:
        """Public reset method."""
        self._reset()


class WhisperProvider(STTProvider):
    """faster-whisper STT provider with Silero VAD.

    GPU-accelerated production model (~3GB for large-v3).
    Simplified configuration with <10 parameters.
    """

    def __init__(self):
        self.whisper_model = None
        self.vad_model = None
        self.model_ready = False

        # Whisper model configuration (4 parameters)
        self.model_size = os.getenv("WHISPER_MODEL", "large-v3")
        self.device = os.getenv("WHISPER_DEVICE", "cuda")
        self.compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "float16")
        self.language = os.getenv("WHISPER_LANGUAGE", None) or None

        # Beam size and initial prompt
        self.beam_size = int(os.getenv("WHISPER_BEAM_SIZE", "5"))
        self.initial_prompt = os.getenv("WHISPER_INITIAL_PROMPT", None) or None

        # VAD configuration (5 parameters)
        self.vad_threshold = float(os.getenv("VAD_THRESHOLD", "0.5"))
        self.silence_duration_ms = int(os.getenv("VAD_SILENCE_DURATION_MS", "500"))
        self.min_speech_ms = int(os.getenv("VAD_MIN_SPEECH_MS", "500"))
        self.max_speech_duration_ms = int(os.getenv("VAD_MAX_SPEECH_DURATION_MS", "30000"))
        self.partial_interval_ms = int(os.getenv("PARTIAL_INTERVAL_MS", "1000"))

        print(f"[WhisperProvider] Config: model={self.model_size}, device={self.device}, "
              f"compute_type={self.compute_type}, language={self.language or 'auto'}")
        print(f"[WhisperProvider] VAD: threshold={self.vad_threshold}, "
              f"silence_ms={self.silence_duration_ms}, min_speech_ms={self.min_speech_ms}, "
              f"max_duration_ms={self.max_speech_duration_ms}")

    @property
    def name(self) -> str:
        return "whisper"

    @property
    def is_available(self) -> bool:
        return FASTER_WHISPER_AVAILABLE and TORCH_AVAILABLE

    async def initialize(self) -> bool:
        """Initialize faster-whisper model and Silero VAD."""
        if not self.is_available:
            print("[WhisperProvider] Dependencies not available")
            return False

        try:
            # Load faster-whisper model from cache
            print(f"[WhisperProvider] Loading Whisper model: {self.model_size} "
                  f"(device={self.device}, compute_type={self.compute_type})...")

            cache_dir = os.getenv("WHISPER_CACHE_DIR", "/root/.cache/whisper")

            self.whisper_model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
                download_root=cache_dir,
                local_files_only=True,
            )
            print(f"[WhisperProvider] Whisper model loaded from cache: {cache_dir}")

            # Load Silero VAD model
            print(f"[WhisperProvider] Loading Silero VAD...")

            silero_cache_dir = os.getenv("SILERO_VAD_CACHE_DIR", "/root/.cache/silero-vad")
            silero_local_repo = os.path.join(silero_cache_dir, "snakers4_silero-vad")

            if os.path.exists(silero_local_repo):
                print(f"[WhisperProvider] Loading Silero VAD from local: {silero_local_repo}")
                self.vad_model, _ = torch.hub.load(
                    repo_or_dir=silero_local_repo,
                    model='silero_vad',
                    source='local',
                    onnx=True
                )
            else:
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
            'initial_prompt': self.initial_prompt,
            'vad_threshold': self.vad_threshold,
            'silence_duration_ms': self.silence_duration_ms,
            'min_speech_samples': int(self.min_speech_ms * 16),  # ms to samples @ 16kHz
            'max_speech_duration_ms': self.max_speech_duration_ms,
            'partial_interval_ms': self.partial_interval_ms,
            'pre_buffer_samples': 3200,  # 200ms fixed
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
            "supports_auto_detect": True,
            "model": f"faster-whisper-{self.model_size}",
            "device": self.device,
            "compute_type": self.compute_type,
            "language": self.language or "auto",
            "supported_languages": ["auto", "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy", "id", "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "yi", "yo", "zh", "yue"],
            "model_size_mb": 3000 if "large" in self.model_size else 1500,
            "latency_ms": "300-600 (VAD-chunked)",
        }
