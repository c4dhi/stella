"""Kokoro TTS Provider - Local ONNX-based TTS with GPU acceleration."""

import asyncio
import os
from typing import Optional, Tuple
import numpy as np

from .base import TTSProvider

# Check if kokoro-onnx is available
try:
    import kokoro_onnx
    KOKORO_AVAILABLE = True
except ImportError:
    KOKORO_AVAILABLE = False
    kokoro_onnx = None

try:
    import scipy.signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


class KokoroProvider(TTSProvider):
    """Kokoro TTS provider using local ONNX model.

    Features:
    - Local inference (no cloud dependency)
    - GPU acceleration via CUDA
    - ~50-100ms latency
    - High quality neural voices
    """

    # Preferred voices in order of quality
    DEFAULT_VOICES = ['af_sarah', 'af_bella', 'af_nicole', 'af_sky', 'af']

    def __init__(self):
        self._initialized = False
        self._model = None
        self._model_path = None
        self._voices_path = None
        self._default_voice = os.getenv('KOKORO_VOICE', self.DEFAULT_VOICES[0])

    @property
    def name(self) -> str:
        return "kokoro"

    @property
    def is_available(self) -> bool:
        return KOKORO_AVAILABLE

    def _parse_onnx_providers(self) -> list:
        """Parse ONNX_PROVIDER environment variable into provider list."""
        try:
            onnx_provider_str = os.getenv('ONNX_PROVIDER', 'CPUExecutionProvider')

            # Parse comma-separated string
            if ',' in onnx_provider_str:
                providers = [p.strip() for p in onnx_provider_str.split(',')]
            else:
                providers = [onnx_provider_str.strip()]

            print(f"[Kokoro] ONNX providers: {providers}")
            return providers
        except Exception as e:
            print(f"[Kokoro] Error parsing ONNX providers: {e}, using CPU")
            return ['CPUExecutionProvider']

    async def initialize(self) -> bool:
        """Initialize Kokoro TTS provider."""
        if not self.is_available:
            print("[Kokoro] kokoro-onnx not available")
            return False

        try:
            print("[Kokoro] Initializing Kokoro TTS provider...")

            # Determine model paths
            cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
            if not os.path.exists(cache_dir):
                cache_dir = os.path.expanduser('~/.cache/kokoro')

            self._model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
            self._voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

            # Check if models exist
            if not os.path.exists(self._model_path):
                print(f"[Kokoro] Model not found at: {self._model_path}")
                print("[Kokoro] Run download_kokoro_models.py first")
                return False

            if not os.path.exists(self._voices_path):
                print(f"[Kokoro] Voices not found at: {self._voices_path}")
                return False

            # Get ONNX providers
            providers = self._parse_onnx_providers()

            # Initialize Kokoro model
            # Note: kokoro-onnx no longer accepts 'providers' parameter
            # ONNX provider selection is handled internally by the library
            print(f"[Kokoro] Loading model from: {self._model_path}")
            self._model = kokoro_onnx.Kokoro(
                self._model_path,
                self._voices_path,
            )

            self._initialized = True
            print(f"[Kokoro] Initialized successfully with voice: {self._default_voice}")
            return True

        except Exception as e:
            print(f"[Kokoro] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text using Kokoro TTS."""
        if not self._initialized or not self._model:
            print("[Kokoro] Not initialized")
            return None

        if not text or not text.strip():
            print("[Kokoro] Empty text provided")
            return None

        # Build voice list to try
        voices_to_try = []
        if voice:
            voices_to_try.append(voice)
        voices_to_try.append(self._default_voice)
        voices_to_try.extend([v for v in self.DEFAULT_VOICES if v not in voices_to_try])

        for voice_id in voices_to_try:
            try:
                # Run synthesis in thread pool to avoid blocking
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: self._model.create(text, voice=voice_id)
                )

                # Process audio data
                audio_data, sample_rate = await self._process_audio(result)

                if audio_data is not None:
                    print(f"[Kokoro] Synthesized {len(audio_data)} samples using voice: {voice_id}")
                    return (audio_data, 16000)  # Always return 16kHz

            except Exception as e:
                print(f"[Kokoro] Voice '{voice_id}' failed: {e}")
                continue

        # Try without voice parameter as last resort
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self._model.create(text)
            )
            audio_data, sample_rate = await self._process_audio(result)
            if audio_data is not None:
                print(f"[Kokoro] Synthesized {len(audio_data)} samples using default voice")
                return (audio_data, 16000)
        except Exception as e:
            print(f"[Kokoro] Default voice synthesis failed: {e}")

        print("[Kokoro] All voices failed")
        return None

    async def _process_audio(self, result) -> Tuple[Optional[np.ndarray], int]:
        """Process Kokoro audio output to 16kHz mono float32."""
        try:
            if isinstance(result, tuple):
                raw_audio, sample_rate = result
            else:
                print(f"[Kokoro] Unexpected result type: {type(result)}")
                return None, 0

            # Convert to numpy array
            if isinstance(raw_audio, bytes):
                audio_data = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0
            elif isinstance(raw_audio, np.ndarray):
                if raw_audio.dtype == np.int16:
                    audio_data = raw_audio.astype(np.float32) / 32768.0
                elif raw_audio.dtype == np.int32:
                    audio_data = raw_audio.astype(np.float32) / 2147483648.0
                elif raw_audio.dtype in [np.float32, np.float64]:
                    audio_data = raw_audio.astype(np.float32)
                    max_val = np.max(np.abs(audio_data))
                    if max_val > 1.0:
                        audio_data = audio_data / max_val
                else:
                    audio_data = raw_audio.astype(np.float32)
            else:
                audio_data = np.array(raw_audio, dtype=np.float32)

            # Ensure mono
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)

            # Resample to 16kHz if needed
            if sample_rate != 16000:
                audio_data = self._resample(audio_data, sample_rate, 16000)
                sample_rate = 16000

            # Normalize audio
            audio_data = self._normalize_audio(audio_data)

            return audio_data.astype(np.float32), sample_rate

        except Exception as e:
            print(f"[Kokoro] Failed to process audio: {e}")
            import traceback
            traceback.print_exc()
            return None, 0

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        if SCIPY_AVAILABLE:
            num_samples = int(len(audio) * target_sr / orig_sr)
            return scipy.signal.resample(audio, num_samples)
        else:
            # Simple linear interpolation fallback
            ratio = target_sr / orig_sr
            new_length = int(len(audio) * ratio)
            indices = np.linspace(0, len(audio) - 1, new_length)
            return np.interp(indices, np.arange(len(audio)), audio)

    def _normalize_audio(self, audio: np.ndarray) -> np.ndarray:
        """Normalize audio to reasonable levels."""
        # Remove DC offset
        audio = audio - np.mean(audio)

        # Gentle normalization
        max_val = np.max(np.abs(audio))
        if max_val > 0.98:
            audio = audio * (0.85 / max_val)
        elif max_val < 0.1 and max_val > 0:
            audio = audio * (0.3 / max_val)

        return audio

    async def cleanup(self) -> None:
        """Clean up Kokoro provider."""
        self._model = None
        self._initialized = False
        print("[Kokoro] Cleanup completed")
