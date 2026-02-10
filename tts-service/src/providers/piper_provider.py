"""Piper TTS Provider - Fast local TTS using ONNX inference (~0.19 RTF on CPU)."""

import asyncio
import os
from typing import Optional, Tuple
import numpy as np

from .base import TTSProvider

# Check if piper is available
try:
    from piper.voice import PiperVoice
    PIPER_AVAILABLE = True
except ImportError:
    PIPER_AVAILABLE = False
    PiperVoice = None

try:
    import scipy.signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


class PiperProvider(TTSProvider):
    """Piper TTS provider using local ONNX model.

    Features:
    - Very fast local inference (~0.19 RTF on CPU, 5x real-time)
    - No cloud dependency
    - Lightweight models (~60MB each)
    - Good quality for development and production
    """

    # Piper native sample rate
    PIPER_SAMPLE_RATE = 22050

    def __init__(self):
        self._initialized = False
        self._voice: Optional[object] = None
        self._default_voice = os.getenv('PIPER_VOICE', 'en_US-lessac-medium')
        self._cache_dir = os.getenv('PIPER_CACHE_DIR', os.path.expanduser('~/.cache/piper'))

    @property
    def name(self) -> str:
        return "piper"

    @property
    def is_available(self) -> bool:
        return PIPER_AVAILABLE

    def _find_model_path(self) -> Optional[str]:
        """Find the .onnx model file in cache directory."""
        model_file = os.path.join(self._cache_dir, f'{self._default_voice}.onnx')
        if os.path.exists(model_file):
            return model_file
        return None

    async def initialize(self) -> bool:
        """Initialize Piper TTS provider."""
        if not self.is_available:
            print("[Piper] piper-tts not available")
            return False

        try:
            print("[Piper] Initializing Piper TTS provider...")

            # Check cache dir
            if not os.path.exists(self._cache_dir):
                self._cache_dir = os.path.expanduser('~/.cache/piper')

            model_path = self._find_model_path()
            if not model_path:
                print(f"[Piper] Model not found at: {self._cache_dir}/{self._default_voice}.onnx")
                print("[Piper] Run download_piper_models.py first")
                return False

            config_path = model_path + '.json'
            if not os.path.exists(config_path):
                print(f"[Piper] Config not found at: {config_path}")
                return False

            # Load model in executor to avoid blocking
            loop = asyncio.get_event_loop()
            self._voice = await loop.run_in_executor(
                None,
                lambda: PiperVoice.load(model_path, config_path=config_path)
            )

            self._initialized = True
            print(f"[Piper] Initialized successfully with voice: {self._default_voice}")
            return True

        except Exception as e:
            print(f"[Piper] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text using Piper TTS."""
        if not self._initialized or not self._voice:
            print("[Piper] Not initialized")
            return None

        if not text or not text.strip():
            print("[Piper] Empty text provided")
            return None

        try:
            # Synthesize in executor to stay async
            loop = asyncio.get_event_loop()
            raw_audio, sample_rate = await loop.run_in_executor(
                None,
                lambda: self._synthesize_raw(text)
            )

            if raw_audio is None or len(raw_audio) == 0:
                print("[Piper] Synthesis returned empty audio")
                return None

            audio_data = raw_audio

            # Resample to 24kHz if needed
            audio_data = self._resample(audio_data, sample_rate, 24000)

            # Apply speed adjustment via resampling if needed
            if speed != 1.0 and 0.5 <= speed <= 2.0:
                # To speed up: resample to a lower rate then treat as 24kHz
                adjusted_length = int(len(audio_data) / speed)
                audio_data = self._resample_by_length(audio_data, adjusted_length)

            # Normalize audio to -3dB peak
            audio_data = self._normalize_audio(audio_data)

            duration_sec = len(audio_data) / 24000
            max_amp = np.max(np.abs(audio_data))
            print(f"[Piper] Synthesized: {len(audio_data)} samples, "
                  f"{duration_sec:.2f}s, max_amp={max_amp:.4f}")

            return (audio_data, 24000)

        except Exception as e:
            print(f"[Piper] Synthesis failed: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _synthesize_raw(self, text: str) -> Tuple[Optional[np.ndarray], int]:
        """Synchronous synthesis using Piper's synthesize API.

        Returns (audio_float32, sample_rate) tuple.
        """
        try:
            audio_chunks = []
            sample_rate = self.PIPER_SAMPLE_RATE

            for audio_chunk in self._voice.synthesize(text):
                # AudioChunk has audio_float_array (float32, normalized [-1,1])
                # and sample_rate
                audio_chunks.append(audio_chunk.audio_float_array)
                sample_rate = audio_chunk.sample_rate

            if not audio_chunks:
                return None, 0

            return np.concatenate(audio_chunks), sample_rate
        except Exception as e:
            print(f"[Piper] Raw synthesis error: {e}")
            return None, 0

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        if orig_sr == target_sr:
            return audio

        if SCIPY_AVAILABLE:
            num_samples = int(len(audio) * target_sr / orig_sr)
            return scipy.signal.resample(audio, num_samples)
        else:
            # Simple linear interpolation fallback
            ratio = target_sr / orig_sr
            new_length = int(len(audio) * ratio)
            indices = np.linspace(0, len(audio) - 1, new_length)
            return np.interp(indices, np.arange(len(audio)), audio)

    def _resample_by_length(self, audio: np.ndarray, target_length: int) -> np.ndarray:
        """Resample audio to a specific target length."""
        if SCIPY_AVAILABLE:
            return scipy.signal.resample(audio, target_length)
        else:
            indices = np.linspace(0, len(audio) - 1, target_length)
            return np.interp(indices, np.arange(len(audio)), audio)

    def _normalize_audio(self, audio: np.ndarray) -> np.ndarray:
        """Normalize audio to -3dB peak for optimal quality."""
        # Remove DC offset
        audio = audio - np.mean(audio)

        # Normalize to -3dB peak (0.707 amplitude) for headroom
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            target_peak = 0.707  # -3dB
            audio = audio * (target_peak / max_val)

        return audio.astype(np.float32)

    async def cleanup(self) -> None:
        """Clean up Piper provider."""
        self._voice = None
        self._initialized = False
        print("[Piper] Cleanup completed")
