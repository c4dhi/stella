"""Abstract base class for TTS providers."""

from abc import ABC, abstractmethod
from typing import Optional, Tuple, AsyncGenerator
import numpy as np


class TTSProvider(ABC):
    """Abstract base class for TTS providers.

    All TTS providers must implement this interface to ensure consistent
    behavior across different engines (Edge TTS, Kokoro, etc.).
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the provider name (e.g., 'edge_tts', 'kokoro')."""
        pass

    @property
    @abstractmethod
    def is_available(self) -> bool:
        """Check if this provider is available and ready to use."""
        pass

    @abstractmethod
    async def initialize(self) -> bool:
        """Initialize the TTS provider.

        Returns:
            True if initialization was successful, False otherwise.
        """
        pass

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text to audio.

        Args:
            text: The text to synthesize.
            voice: Optional voice ID override.
            speed: Speech rate (0.5 to 2.0, default 1.0).

        Returns:
            Tuple of (audio_data as float32 numpy array, sample_rate) or None on failure.
            Audio is returned as 16kHz mono float32 normalized to [-1, 1].
        """
        pass

    async def synthesize_stream(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        chunk_size: int = 480,
    ) -> AsyncGenerator[Tuple[np.ndarray, bool], None]:
        """Synthesize text to streaming audio chunks.

        Default implementation synthesizes full audio then yields chunks.
        Providers can override for true streaming if supported.

        Args:
            text: The text to synthesize.
            voice: Optional voice ID override.
            speed: Speech rate (0.5 to 2.0, default 1.0).
            chunk_size: Number of samples per chunk (default 480 = 30ms at 16kHz).

        Yields:
            Tuple of (audio_chunk as int16 numpy array, is_final).
        """
        result = await self.synthesize(text, voice, speed)
        if result is None:
            return

        audio_data, sample_rate = result

        # Convert to int16 for output
        audio_int16 = (np.clip(audio_data, -1.0, 1.0) * 32767).astype(np.int16)

        # Yield chunks
        total_samples = len(audio_int16)
        for i in range(0, total_samples, chunk_size):
            chunk = audio_int16[i:i + chunk_size]
            is_final = (i + chunk_size) >= total_samples
            yield (chunk, is_final)

    @abstractmethod
    async def cleanup(self) -> None:
        """Clean up any resources held by the provider."""
        pass
