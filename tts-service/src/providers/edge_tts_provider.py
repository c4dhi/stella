"""Edge TTS Provider - Microsoft's free cloud TTS service."""

import asyncio
import os
import tempfile
from typing import Optional, Tuple
import numpy as np

from .base import TTSProvider

# Check if edge_tts is available
try:
    import edge_tts
    EDGE_TTS_AVAILABLE = True
except ImportError:
    EDGE_TTS_AVAILABLE = False
    edge_tts = None

# Check for audio processing libraries
try:
    import soundfile as sf
    SOUNDFILE_AVAILABLE = True
except ImportError:
    SOUNDFILE_AVAILABLE = False
    sf = None

try:
    import scipy.signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


class EdgeTTSProvider(TTSProvider):
    """Edge TTS provider using Microsoft's free cloud TTS.

    Features:
    - No API key required
    - High quality neural voices
    - ~200-300ms latency
    - Good fallback option
    """

    # Default voices in order of preference
    DEFAULT_VOICES = [
        "en-US-AriaNeural",
        "en-US-JennyNeural",
        "en-US-GuyNeural",
        "en-US-SaraNeural",
    ]

    def __init__(self):
        self._initialized = False
        self._default_voice = os.getenv('EDGE_TTS_VOICE', self.DEFAULT_VOICES[0])

    @property
    def name(self) -> str:
        return "edge_tts"

    @property
    def is_available(self) -> bool:
        return EDGE_TTS_AVAILABLE and SOUNDFILE_AVAILABLE

    async def initialize(self) -> bool:
        """Initialize Edge TTS provider."""
        if not self.is_available:
            print(f"[EdgeTTS] Not available: edge_tts={EDGE_TTS_AVAILABLE}, soundfile={SOUNDFILE_AVAILABLE}")
            return False

        try:
            # Test connection with a simple synthesis
            print("[EdgeTTS] Initializing Edge TTS provider...")
            self._initialized = True
            print(f"[EdgeTTS] Initialized successfully with default voice: {self._default_voice}")
            return True
        except Exception as e:
            print(f"[EdgeTTS] Initialization failed: {e}")
            return False

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text using Edge TTS."""
        if not self._initialized:
            print("[EdgeTTS] Not initialized")
            return None

        if not text or not text.strip():
            print("[EdgeTTS] Empty text provided")
            return None

        # Build voice list to try
        voices_to_try = []
        if voice:
            voices_to_try.append(voice)
        voices_to_try.append(self._default_voice)
        voices_to_try.extend([v for v in self.DEFAULT_VOICES if v not in voices_to_try])

        for voice_id in voices_to_try:
            try:
                # Create Edge TTS communicator
                communicate = edge_tts.Communicate(text, voice_id)

                # Generate audio to temporary file
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_file:
                    tmp_path = tmp_file.name

                try:
                    await communicate.save(tmp_path)

                    # Load and process the audio file
                    audio_data, sample_rate = await self._load_audio_file(tmp_path)

                    if audio_data is not None:
                        max_amp = np.max(np.abs(audio_data))
                        duration_sec = len(audio_data) / 16000
                        print(f"[EdgeTTS] Synthesized: {len(audio_data)} samples, "
                              f"{duration_sec:.2f}s, max_amp={max_amp:.4f}, voice={voice_id}")
                        return (audio_data, 16000)  # Always return 16kHz

                finally:
                    # Clean up temp file
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)

            except Exception as e:
                print(f"[EdgeTTS] Voice '{voice_id}' failed: {e}")
                continue

        print("[EdgeTTS] All voices failed")
        return None

    async def _load_audio_file(self, audio_path: str) -> Tuple[Optional[np.ndarray], int]:
        """Load audio file and convert to 16kHz mono float32."""
        try:
            # Load audio using soundfile
            audio_data, sample_rate = sf.read(audio_path, dtype='float32')

            # Convert to mono if stereo
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
            print(f"[EdgeTTS] Failed to load audio file: {e}")
            return None, 0

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        if SCIPY_AVAILABLE:
            # Use scipy for resampling
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
        """Clean up Edge TTS provider."""
        self._initialized = False
        print("[EdgeTTS] Cleanup completed")
