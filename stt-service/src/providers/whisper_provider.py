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

from collections import deque


class EndOfSpeechDetector:
    """Multi-signal detector for speech-to-silence transitions."""

    def __init__(self, config: dict):
        # Rolling history windows (~640ms at 32ms/frame)
        self.history_size = config.get('eos_history_frames', 20)
        self.speech_prob_history = deque(maxlen=self.history_size)
        self.energy_history = deque(maxlen=self.history_size)
        self.spectral_flux_history = deque(maxlen=self.history_size)

        # Delta thresholds (detect RELATIVE changes)
        self.prob_drop_threshold = config.get('eos_prob_drop', 0.15)      # 15% drop
        self.energy_drop_ratio = config.get('eos_energy_drop', 0.4)       # 40% drop
        self.flux_stable_threshold = config.get('eos_flux_stable', 0.05)  # Low flux = stable

        # Require N signals to agree
        self.min_signals = config.get('eos_min_signals', 2)

        # Previous frame for spectral flux
        self.prev_frame = None

    def update(self, speech_prob: float, rms_energy: float, audio_frame: np.ndarray):
        """Update history and compute spectral flux."""
        self.speech_prob_history.append(speech_prob)
        self.energy_history.append(rms_energy)

        # Compute spectral flux
        flux = self._compute_spectral_flux(audio_frame)
        self.spectral_flux_history.append(flux)
        self.prev_frame = audio_frame.copy()

    def _compute_spectral_flux(self, current_frame: np.ndarray) -> float:
        """Spectral flux: measures rate of spectral change."""
        if self.prev_frame is None or len(current_frame) != len(self.prev_frame):
            return 0.0

        # Compute magnitude spectra
        current_spec = np.abs(np.fft.rfft(current_frame))
        prev_spec = np.abs(np.fft.rfft(self.prev_frame))

        # Normalize
        current_spec = current_spec / (np.sum(current_spec) + 1e-10)
        prev_spec = prev_spec / (np.sum(prev_spec) + 1e-10)

        # Flux = sum of positive differences (onset-focused)
        diff = current_spec - prev_spec
        return float(np.sum(np.maximum(diff, 0)))

    def detect_end(self) -> tuple[bool, dict]:
        """Detect if speech just ended based on signal transitions."""
        if len(self.speech_prob_history) < 10:
            return False, {}

        # Signal 1: Speech probability DROP
        recent_peak = max(list(self.speech_prob_history)[-15:-5]) if len(self.speech_prob_history) >= 15 else max(self.speech_prob_history)
        current_avg = np.mean(list(self.speech_prob_history)[-3:])
        prob_drop = recent_peak - current_avg
        prob_dropped = prob_drop > self.prob_drop_threshold

        # Signal 2: Energy DROP
        recent_energy = np.mean(list(self.energy_history)[-15:-5]) if len(self.energy_history) >= 15 else np.mean(list(self.energy_history)[:-3])
        current_energy = np.mean(list(self.energy_history)[-3:])
        energy_ratio = current_energy / (recent_energy + 1e-10)
        energy_dropped = energy_ratio < (1 - self.energy_drop_ratio)

        # Signal 3: Spectral flux STABILIZED (speech varies, noise is static)
        recent_flux = np.mean(list(self.spectral_flux_history)[-5:])
        flux_stable = recent_flux < self.flux_stable_threshold

        signals = [prob_dropped, energy_dropped, flux_stable]
        triggered = sum(signals) >= self.min_signals

        metrics = {
            'prob_drop': prob_drop,
            'energy_ratio': energy_ratio,
            'flux': recent_flux,
            'signals': signals,
            'triggered': triggered
        }

        return triggered, metrics

    def reset(self):
        """Clear history for new utterance."""
        self.speech_prob_history.clear()
        self.energy_history.clear()
        self.spectral_flux_history.clear()
        self.prev_frame = None


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

        # Configuration from provider (with stricter defaults for better VAD)
        self.vad_window_samples = 512    # 32ms @ 16kHz (required by Silero)
        self.vad_threshold = config.get('vad_threshold', 0.6)  # CHANGED: 0.5 -> 0.6 (stricter VAD)
        self.vad_min_silence_ms = config.get('vad_min_silence_ms', 800)  # CHANGED: 500 -> 800
        self.partial_interval_ms = config.get('partial_interval_ms', 1000)
        self.min_speech_samples = config.get('min_speech_samples', 12800)  # CHANGED: 8000 -> 12800 (0.8s)

        # Post-endpoint continuation window (allows brief pauses to extend utterance)
        self.continuation_window_ms = config.get('continuation_window_ms', 400)
        self.min_final_samples = config.get('min_final_samples', 8000)  # 0.5s at 16kHz (stricter)

        # Continuation window state
        self.pending_final_event = None
        self.pending_final_time = 0
        self.in_continuation_window = False

        # Pre-buffering for initial speech (captures audio before VAD triggers)
        self.pre_buffer = []  # Circular buffer of recent audio before speech_started
        self.pre_buffer_samples = config.get('pre_buffer_samples', 8000)  # 0.5s of pre-speech audio

        # CRITICAL: Maximum speech duration timeout (prevents indefinite accumulation)
        self.max_speech_duration_ms = config.get('max_speech_duration_ms', 15000)  # 15 seconds max
        self.speech_start_time = None  # Track when current utterance started

        # Stale partial detection (forces endpoint if transcript unchanged for too long)
        self.last_partial_text = ""
        self.last_partial_change_time = 0
        self.stale_partial_timeout_ms = config.get('stale_partial_timeout_ms', 3000)  # 3 seconds

        # End-of-speech delta detector (multi-signal detection)
        self.eos_detector = EndOfSpeechDetector({
            'eos_history_frames': config.get('eos_history_frames', 20),
            'eos_prob_drop': config.get('eos_prob_drop', 0.15),
            'eos_energy_drop': config.get('eos_energy_drop', 0.4),
            'eos_flux_stable': config.get('eos_flux_stable', 0.05),
            'eos_min_signals': config.get('eos_min_signals', 2),
        })

        # Adaptive noise floor estimation
        self.noise_floor = 0.001  # Initial estimate
        self.noise_floor_alpha = 0.05  # Adaptation rate (slow)
        self.energy_snr_margin = config.get('energy_snr_margin', 2.5)  # Require 2.5x noise floor

        # Dual threshold for hysteresis
        self.start_threshold = config.get('vad_start_threshold', 0.7)  # Higher to START
        self.continue_threshold = self.vad_threshold  # Lower to CONTINUE (existing 0.6)

        # Consecutive frames for speech start confirmation
        self.consecutive_speech_frames = 0
        self.min_start_frames = config.get('min_start_frames', 4)  # ~128ms confirmation

        # Hallucination filtering
        self.hallucination_phrases = {
            "bye", "bye bye", "bye-bye", "goodbye", "good bye",
            "thank you", "thanks", "thank you for watching",
            "no", "no but", "no, but",
            "you", "um", "uh", "hmm",
            "...", ".", "",
        }
        self.last_finals: list = []  # Track recent finals for repetition detection
        self.max_final_history = 5

        # Processing state
        self.processing_endpoint = False
        self.chunk_count = 0

        # Language detection caching (detect-once per session)
        self.detected_language = None

        # Audio preprocessing settings
        # max_partial_seconds = context window (NOT delay). Partials still come every PARTIAL_INTERVAL_MS
        # More context = more stable transcription, but slower inference
        self.max_partial_seconds = 10  # 10s context window balances quality vs speed
        self.min_language_confidence = 0.5  # Filter low-confidence results

        # Precompute high-pass filter coefficients (80Hz cutoff for noise removal)
        from scipy import signal
        self.highpass_sos = signal.butter(5, 80, btype='highpass', fs=16000, output='sos')

        # Spectral gating configuration
        self.enable_spectral_gate = config.get('enable_spectral_gate', True)

    def _spectral_gate(self, audio_float: np.ndarray) -> np.ndarray:
        """Apply spectral gating to reduce stationary noise."""
        from scipy import signal as scipy_signal

        # STFT parameters
        nperseg = 512  # 32ms window
        noverlap = 256  # 50% overlap

        # Compute STFT
        f, t, stft = scipy_signal.stft(audio_float, fs=16000, nperseg=nperseg, noverlap=noverlap)

        magnitude = np.abs(stft)
        phase = np.angle(stft)

        # Estimate noise floor per frequency bin (use bottom 20th percentile)
        noise_estimate = np.percentile(magnitude, 20, axis=1, keepdims=True)

        # Compute gain: suppress bins close to noise floor
        # gain = 1 where signal >> noise, gain → 0 where signal ≈ noise
        snr = magnitude / (noise_estimate + 1e-10)
        gain = np.clip((snr - 1) / (snr + 1e-10), 0.1, 1.0)  # Soft knee, min gain 0.1

        # Apply gain
        stft_clean = magnitude * gain * np.exp(1j * phase)

        # Inverse STFT
        _, audio_clean = scipy_signal.istft(stft_clean, fs=16000, nperseg=nperseg, noverlap=noverlap)

        # Match original length
        if len(audio_clean) > len(audio_float):
            audio_clean = audio_clean[:len(audio_float)]
        elif len(audio_clean) < len(audio_float):
            audio_clean = np.pad(audio_clean, (0, len(audio_float) - len(audio_clean)))

        return audio_clean.astype(np.float32)

    def _preprocess_audio(self, audio_float: np.ndarray) -> np.ndarray:
        """Preprocess audio for better transcription quality."""
        from scipy import signal

        # 1. Spectral gating (noise reduction)
        if self.enable_spectral_gate:
            audio_float = self._spectral_gate(audio_float)

        # 2. High-pass filter to remove low-frequency noise/hum
        audio_float = signal.sosfilt(self.highpass_sos, audio_float)

        # 3. Normalize audio to 0.95 peak (improves consistency)
        peak = np.abs(audio_float).max()
        if peak > 0.01:
            audio_float = audio_float / peak * 0.95

        return audio_float

    def _is_hallucination(self, text: str) -> bool:
        """Check if transcribed text is likely a Whisper hallucination."""
        if not text:
            return True

        text_lower = text.lower().strip().rstrip('.!?')

        # Check against known hallucination phrases
        if text_lower in self.hallucination_phrases:
            print(f"[WhisperSession] Filtered hallucination: '{text}'")
            return True

        # Check for very short text (likely noise)
        if len(text_lower) < 3:
            print(f"[WhisperSession] Filtered short text: '{text}'")
            return True

        # Check for repetition (same text as recent finals)
        if text_lower in [f.lower().strip() for f in self.last_finals]:
            print(f"[WhisperSession] Filtered repetition: '{text}'")
            return True

        return False

    def _record_final(self, text: str) -> None:
        """Record a final transcript for repetition detection."""
        self.last_finals.append(text)
        if len(self.last_finals) > self.max_final_history:
            self.last_finals.pop(0)

    def process_audio(self, audio_data: bytes, sample_rate: int = 16000) -> List[stt_pb2.TranscriptEvent]:
        """Process audio chunk through VAD and return transcript events.

        Args:
            audio_data: Raw PCM audio bytes (16-bit signed)
            sample_rate: Sample rate of the input audio (default 16000)
        """
        events = []
        current_time = time.time()
        self.chunk_count += 1

        # Check for continuation window expiry (emit pending final if no speech resumed)
        if self.pending_final_event and self.in_continuation_window:
            elapsed_ms = (current_time - self.pending_final_time) * 1000
            if elapsed_ms >= self.continuation_window_ms:
                print(f"[WhisperSession] Continuation window expired ({elapsed_ms:.0f}ms), emitting final")
                events.append(self.pending_final_event)
                self.pending_final_event = None
                self.in_continuation_window = False
                self.reset()

        # CRITICAL: Check for maximum speech duration timeout
        if self.speech_detected and self.speech_start_time:
            speech_duration_ms = (current_time - self.speech_start_time) * 1000
            if speech_duration_ms >= self.max_speech_duration_ms:
                print(f"[WhisperSession] TIMEOUT: Speech exceeded {self.max_speech_duration_ms}ms, forcing endpoint")
                final_event = self._generate_final_event(current_time)
                if final_event:
                    events.append(final_event)
                self.reset()
                return events

        # Check for stale partial (transcript unchanged for too long while in speech)
        if self.speech_detected and self.last_partial_text:
            time_since_change_ms = (current_time - self.last_partial_change_time) * 1000
            if time_since_change_ms >= self.stale_partial_timeout_ms:
                print(f"[WhisperSession] STALE: Transcript unchanged for {time_since_change_ms:.0f}ms, forcing endpoint")
                final_event = self._generate_final_event(current_time)
                if final_event:
                    events.append(final_event)
                self.reset()
                return events

        try:
            # Convert bytes to numpy array (16-bit PCM)
            audio_int16 = np.frombuffer(audio_data, dtype=np.int16)
            if len(audio_int16) == 0:
                return events

            # Resample if needed (Whisper expects 16kHz)
            target_rate = 16000
            if sample_rate != target_rate and sample_rate > 0:
                # Log resampling on first chunk
                if self.chunk_count == 1:
                    print(f"[WhisperSession] Resampling from {sample_rate}Hz to {target_rate}Hz")
                # Use scipy for high-quality resampling
                from scipy import signal
                num_samples = int(len(audio_int16) * target_rate / sample_rate)
                audio_int16 = signal.resample(audio_int16, num_samples).astype(np.int16)

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
        """Check for speech activity using Silero VAD with multi-signal detection."""
        events = []

        try:
            # Get speech probability from VAD
            audio_tensor = torch.from_numpy(audio_float)
            speech_prob = self.vad_model(audio_tensor, 16000).item()

            # Compute RMS energy for this window
            rms_energy = float(np.sqrt(np.mean(audio_float ** 2)))

            # Update end-of-speech detector with all signals
            self.eos_detector.update(speech_prob, rms_energy, audio_float)

            if speech_prob > self.vad_threshold:
                # Speech detected - check if we're in continuation window
                if self.in_continuation_window and self.pending_final_event:
                    # Cancel pending final - speech is continuing
                    print(f"[WhisperSession] Speech continued, extending utterance")
                    self.pending_final_event = None
                    self.in_continuation_window = False
                    self.speech_detected = True
                    self.consecutive_speech_frames = 0
                    # Keep same transcript_id and speech_buffer - don't reset
                elif not self.speech_detected:
                    # Energy gating: require energy above noise floor
                    energy_ok = rms_energy > (self.noise_floor * self.energy_snr_margin)

                    # Use HIGHER threshold for starting speech (hysteresis)
                    vad_ok = speech_prob > self.start_threshold

                    if vad_ok and energy_ok:
                        self.consecutive_speech_frames += 1
                    else:
                        self.consecutive_speech_frames = 0

                    # Require consecutive frames for confirmation
                    if self.consecutive_speech_frames >= self.min_start_frames:
                        # Fresh speech start confirmed
                        self.speech_detected = True
                        self.speech_start_time = current_time  # Track when speech started
                        self.consecutive_speech_frames = 0
                        print(f"[WhisperSession] Speech started (prob={speech_prob:.2f}, energy={rms_energy:.4f}, noise_floor={self.noise_floor:.4f})")

                        # Generate new transcript ID for new utterance
                        self.transcript_id = f"whisper_{uuid.uuid4().hex[:8]}"

                        # Include pre-buffered audio to capture beginning of utterance
                        self.speech_buffer = self.pre_buffer.copy()  # Start with pre-buffer
                        self.pre_buffer = []  # Clear pre-buffer
                        self.accumulated_text = ""

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

                # Accumulate speech audio (when speech is detected or during confirmation)
                if self.speech_detected:
                    self.speech_buffer.extend(audio_int16.tolist())
                    self.last_speech_time = current_time
                    self.silence_start_time = None

            else:
                # Silence detected - update noise floor estimate
                self.noise_floor = (1 - self.noise_floor_alpha) * self.noise_floor + self.noise_floor_alpha * rms_energy

                # Reset consecutive speech frames
                self.consecutive_speech_frames = 0

                # Add to pre-buffer (for next speech start)
                self.pre_buffer.extend(audio_int16.tolist())
                if len(self.pre_buffer) > self.pre_buffer_samples:
                    self.pre_buffer = self.pre_buffer[-self.pre_buffer_samples:]

                if self.speech_detected:
                    # Continue accumulating during short silence (might be mid-sentence)
                    self.speech_buffer.extend(audio_int16.tolist())

                    if self.silence_start_time is None:
                        self.silence_start_time = current_time

                    # Check if silence duration exceeds threshold
                    silence_duration_ms = (current_time - self.silence_start_time) * 1000
                    if silence_duration_ms >= self.vad_min_silence_ms:
                        print(f"[WhisperSession] Speech ended ({silence_duration_ms:.0f}ms silence)")

                        # Generate final but don't emit yet - enter continuation window
                        final_event = self._generate_final_event(current_time)
                        if final_event:
                            self.pending_final_event = final_event
                            self.pending_final_time = current_time
                            self.in_continuation_window = True
                            self.speech_detected = False
                            # DON'T reset yet - wait for continuation window
                        else:
                            self.reset()

            # Delta-based end detection (catches transitions even when VAD stays high)
            if self.speech_detected and len(self.speech_buffer) >= self.min_final_samples:
                end_detected, metrics = self.eos_detector.detect_end()
                if end_detected:
                    print(f"[WhisperSession] DELTA END: prob_drop={metrics['prob_drop']:.2f}, "
                          f"energy_ratio={metrics['energy_ratio']:.2f}, flux={metrics['flux']:.3f}")
                    final_event = self._generate_final_event(current_time)
                    if final_event:
                        self.pending_final_event = final_event
                        self.pending_final_time = current_time
                        self.in_continuation_window = True
                        self.speech_detected = False

        except Exception as e:
            print(f"[WhisperSession] VAD error: {e}")

        return events

    def _transcribe_partial(self, current_time: float) -> Optional[stt_pb2.TranscriptEvent]:
        """Transcribe accumulated speech buffer for partial result."""
        if len(self.speech_buffer) < self.min_speech_samples:
            return None

        try:
            # For partials, only use last N seconds to reduce compute
            max_partial_samples = int(self.max_partial_seconds * 16000)
            audio_for_partial = self.speech_buffer[-max_partial_samples:] if len(self.speech_buffer) > max_partial_samples else self.speech_buffer

            audio_samples = np.array(audio_for_partial, dtype=np.int16)
            audio_float = audio_samples.astype(np.float32) / 32768.0
            audio_duration_sec = len(audio_samples) / 16000

            # Apply audio preprocessing (noise removal + normalization)
            audio_float = self._preprocess_audio(audio_float)

            # Use cached detected language or configured language
            # Ensure empty string is treated as None (auto-detect)
            config_lang = self.config.get('language')
            language = self.detected_language or (config_lang if config_lang else None)

            # Transcribe with faster-whisper
            # temperature=0 for deterministic output (critical for stability)
            # compression_ratio_threshold filters hallucinations
            segments, info = self.whisper_model.transcribe(
                audio_float,
                language=language,
                beam_size=self.config.get('beam_size', 5),
                vad_filter=False,  # We use external Silero VAD
                word_timestamps=False,
                condition_on_previous_text=False,
                initial_prompt=self.config.get('initial_prompt'),
                temperature=0.0,  # Deterministic output - prevents flickering
                compression_ratio_threshold=2.4,  # Filter hallucinations
                log_prob_threshold=-1.0,  # Filter low-confidence outputs
                no_speech_threshold=0.6,  # Better silence detection
            )

            # Cache detected language for future transcriptions in this session
            if not self.detected_language and hasattr(info, 'language') and info.language:
                self.detected_language = info.language
                print(f"[WhisperSession] Detected language: {self.detected_language}")

            # Filter low-confidence results (likely noise)
            if hasattr(info, 'language_probability') and info.language_probability < self.min_language_confidence:
                return None

            # Process segments
            transcribed_text = ""
            for segment in segments:
                transcribed_text += segment.text + " "
            transcribed_text = transcribed_text.strip()

            if transcribed_text and transcribed_text != self.accumulated_text:
                self.accumulated_text = transcribed_text
                # Track partial changes for stale detection
                if transcribed_text != self.last_partial_text:
                    self.last_partial_text = transcribed_text
                    self.last_partial_change_time = current_time
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

    def _generate_final_event(self, current_time: float) -> Optional[stt_pb2.TranscriptEvent]:
        """Generate final transcript event with hallucination filtering.

        This method does NOT reset state or emit the event - that's handled by caller
        to support the continuation window feature.
        """
        if self.processing_endpoint:
            return None

        self.processing_endpoint = True

        try:
            # More stringent minimum for finals (uses min_final_samples, not min_speech_samples)
            if len(self.speech_buffer) < self.min_final_samples:
                print(f"[WhisperSession] Audio too short: {len(self.speech_buffer)} < {self.min_final_samples}")
                return None

            audio_samples = np.array(self.speech_buffer, dtype=np.int16)
            audio_float = audio_samples.astype(np.float32) / 32768.0
            audio_duration_sec = len(audio_samples) / 16000

            # Apply audio preprocessing (noise removal + normalization)
            audio_float = self._preprocess_audio(audio_float)

            # Use cached detected language or configured language
            # Ensure empty string is treated as None (auto-detect)
            config_lang = self.config.get('language')
            language = self.detected_language or (config_lang if config_lang else None)

            # Final transcription with STRICTER thresholds to filter hallucinations
            segments, info = self.whisper_model.transcribe(
                audio_float,
                language=language,
                beam_size=self.config.get('beam_size', 5),
                vad_filter=False,
                word_timestamps=False,
                condition_on_previous_text=False,
                initial_prompt=self.config.get('initial_prompt'),
                temperature=0.0,  # Deterministic output
                compression_ratio_threshold=2.4,  # Filter hallucinations
                log_prob_threshold=-0.5,  # CHANGED: -1.0 -> -0.5 (stricter)
                no_speech_threshold=0.4,  # CHANGED: 0.6 -> 0.4 (stricter - higher = more filtering)
            )

            # Cache detected language for future transcriptions in this session
            if not self.detected_language and hasattr(info, 'language') and info.language:
                self.detected_language = info.language
                print(f"[WhisperSession] Detected language: {self.detected_language}")

            # Filter low-confidence results (likely noise)
            if hasattr(info, 'language_probability') and info.language_probability < self.min_language_confidence:
                return None

            final_text = ""
            for segment in segments:
                final_text += segment.text + " "
            final_text = final_text.strip()

            if not final_text or len(final_text) < 2:
                return None

            # Hallucination filtering - check against known phrases
            if self._is_hallucination(final_text):
                return None

            # Check for duplicate
            if (final_text == self.last_final_text and
                current_time - self.last_final_time < 5.0):
                print(f"[WhisperSession] Skipping duplicate")
                return None

            print(f"[WhisperSession] Final ({audio_duration_sec:.2f}s): '{final_text}'")

            # Record this final for repetition detection
            self._record_final(final_text)
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

        finally:
            self.processing_endpoint = False

    def reset(self) -> None:
        """Reset state for next utterance."""
        self.speech_buffer = []
        self.accumulated_text = ""
        self.transcript_id = f"whisper_{uuid.uuid4().hex[:8]}"
        self.silence_start_time = None
        self.speech_detected = False
        # Clear continuation window state
        self.pending_final_event = None
        self.in_continuation_window = False
        self.pending_final_time = 0
        # Reset timeout tracking state
        self.speech_start_time = None
        self.last_partial_text = ""
        self.last_partial_change_time = 0
        # Reset delta detector (but KEEP noise_floor - it should persist)
        self.eos_detector.reset()
        self.consecutive_speech_frames = 0


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
        self.language = os.getenv("WHISPER_LANGUAGE", None) or None  # None or empty = auto-detect
        self.beam_size = int(os.getenv("WHISPER_BEAM_SIZE", "5"))

        # VAD configuration (with stricter defaults to reduce hallucinations)
        self.vad_threshold = float(os.getenv("VAD_THRESHOLD", "0.6"))  # CHANGED: 0.5 -> 0.6
        self.vad_min_silence_ms = int(os.getenv("VAD_MIN_SILENCE_MS", "800"))  # CHANGED: 500 -> 800
        self.partial_interval_ms = int(os.getenv("PARTIAL_INTERVAL_MS", "1000"))
        self.min_speech_ms = int(os.getenv("VAD_MIN_SPEECH_MS", "300"))  # CHANGED: 200 -> 300

        # Advanced VAD configuration (continuation window, pre-buffering)
        self.continuation_window_ms = int(os.getenv("VAD_CONTINUATION_WINDOW_MS", "400"))
        self.min_final_ms = int(os.getenv("VAD_MIN_FINAL_MS", "500"))
        self.pre_buffer_ms = int(os.getenv("VAD_PRE_BUFFER_MS", "500"))

        # Timeout configuration (prevents indefinite speech accumulation)
        self.max_speech_duration_ms = int(os.getenv("VAD_MAX_SPEECH_DURATION_MS", "15000"))
        self.stale_partial_timeout_ms = int(os.getenv("VAD_STALE_PARTIAL_TIMEOUT_MS", "3000"))

        # End-of-speech delta detection
        self.eos_history_frames = int(os.getenv("VAD_EOS_HISTORY_FRAMES", "20"))
        self.eos_prob_drop = float(os.getenv("VAD_EOS_PROB_DROP", "0.15"))
        self.eos_energy_drop = float(os.getenv("VAD_EOS_ENERGY_DROP", "0.4"))
        self.eos_flux_stable = float(os.getenv("VAD_EOS_FLUX_STABLE", "0.05"))
        self.eos_min_signals = int(os.getenv("VAD_EOS_MIN_SIGNALS", "2"))

        # Energy gating for speech start
        self.vad_start_threshold = float(os.getenv("VAD_START_THRESHOLD", "0.7"))
        self.energy_snr_margin = float(os.getenv("VAD_ENERGY_SNR_MARGIN", "2.5"))
        self.min_start_frames = int(os.getenv("VAD_MIN_START_FRAMES", "4"))

        # Spectral gating
        self.enable_spectral_gate = os.getenv("VAD_ENABLE_SPECTRAL_GATE", "true").lower() == "true"

        # Initial prompt for domain context (improves accuracy for specific vocabulary)
        self.initial_prompt = os.getenv("WHISPER_INITIAL_PROMPT", None) or None

        print(f"[WhisperProvider] Config: model={self.model_size}, device={self.device}, "
              f"compute_type={self.compute_type}, language={self.language or 'auto'}, "
              f"initial_prompt={'set' if self.initial_prompt else 'none'}")
        print(f"[WhisperProvider] VAD: threshold={self.vad_threshold}, silence_ms={self.vad_min_silence_ms}, "
              f"continuation_ms={self.continuation_window_ms}, pre_buffer_ms={self.pre_buffer_ms}")
        print(f"[WhisperProvider] Timeouts: max_speech_ms={self.max_speech_duration_ms}, "
              f"stale_partial_ms={self.stale_partial_timeout_ms}")
        print(f"[WhisperProvider] EOS detection: prob_drop={self.eos_prob_drop}, "
              f"energy_drop={self.eos_energy_drop}, flux_stable={self.eos_flux_stable}")
        print(f"[WhisperProvider] Speech start: threshold={self.vad_start_threshold}, "
              f"snr_margin={self.energy_snr_margin}, confirm_frames={self.min_start_frames}")
        print(f"[WhisperProvider] Spectral gate: enabled={self.enable_spectral_gate}")

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
            'min_speech_samples': int(self.min_speech_ms * 16),  # Convert ms to samples at 16kHz
            'initial_prompt': self.initial_prompt,
            # Advanced VAD configuration
            'continuation_window_ms': self.continuation_window_ms,
            'min_final_samples': int(self.min_final_ms * 16),  # Convert ms to samples at 16kHz
            'pre_buffer_samples': int(self.pre_buffer_ms * 16),  # Convert ms to samples at 16kHz
            # Timeout configuration (prevents indefinite speech accumulation)
            'max_speech_duration_ms': self.max_speech_duration_ms,
            'stale_partial_timeout_ms': self.stale_partial_timeout_ms,
            # End-of-speech delta detection
            'eos_history_frames': self.eos_history_frames,
            'eos_prob_drop': self.eos_prob_drop,
            'eos_energy_drop': self.eos_energy_drop,
            'eos_flux_stable': self.eos_flux_stable,
            'eos_min_signals': self.eos_min_signals,
            # Energy gating
            'vad_start_threshold': self.vad_start_threshold,
            'energy_snr_margin': self.energy_snr_margin,
            'min_start_frames': self.min_start_frames,
            # Spectral gating
            'enable_spectral_gate': self.enable_spectral_gate,
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
