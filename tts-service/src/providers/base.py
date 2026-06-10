"""Abstract base class for TTS providers."""

from abc import ABC, abstractmethod
from typing import Optional, Tuple, AsyncGenerator
import numpy as np


class TTSProvider(ABC):
    """Abstract base class for TTS providers.

    All TTS providers must implement this interface to ensure consistent
    behavior across different engines (Piper, Kokoro, etc.).
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the provider name (e.g., 'piper', 'kokoro')."""
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
        language: Optional[str] = None,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text to audio.

        Args:
            text: The text to synthesize.
            voice: Optional voice ID override.
            speed: Speech rate (0.5 to 2.0, default 1.0).
            language: Optional ISO 639-1 language code (e.g., 'en', 'de').

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
        language: Optional[str] = None,
    ) -> AsyncGenerator[Tuple[np.ndarray, bool], None]:
        """Synthesize text to streaming audio chunks.

        Default implementation synthesizes full audio then yields chunks.
        Providers can override for true streaming if supported.

        Args:
            text: The text to synthesize.
            voice: Optional voice ID override.
            speed: Speech rate (0.5 to 2.0, default 1.0).
            chunk_size: Number of samples per chunk (default 480 = 30ms at 16kHz).
            language: Optional ISO 639-1 language code (e.g., 'en', 'de').

        Yields:
            Tuple of (audio_chunk as int16 numpy array, is_final).
        """
        result = await self.synthesize(text, voice, speed, language=language)
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

    def get_capabilities(self) -> "ProviderCapabilities":
        """Describe the voices and languages this provider can produce.

        Used by the discovery RPC so the frontend can offer agents exactly
        the choices the *active* provider supports — the catalog differs per
        engine (Qwen3 clones from a reference-clip registry; Kokoro/Piper
        ship a fixed set of built-in voices).

        The default returns an empty catalog with ``supports_voice_selection
        = False``: a provider that exposes no selectable voices (the safe
        baseline) — callers render no picker rather than a misleading one.
        """
        return ProviderCapabilities(
            voices=[],
            languages=[],
            default_voice="",
            supports_voice_selection=False,
        )


class VoiceInfo:
    """A single selectable voice and the languages it can speak.

    For Qwen3 a voice is a named entry in the reference-clip registry and
    ``languages`` are the ISO codes it has clips for. For catalog providers
    (Kokoro/Piper) it is a built-in voice id; ``languages`` may be empty if
    the engine doesn't bind voices to a language.
    """

    def __init__(
        self,
        id: str,
        display_name: str = "",
        languages: Optional[list] = None,
        default_language: str = "",
    ):
        self.id = id
        self.display_name = display_name or id
        self.languages = languages or []
        self.default_language = default_language


class ProviderCapabilities:
    """What an active provider can synthesize, for capability discovery."""

    def __init__(
        self,
        voices: Optional[list] = None,
        languages: Optional[list] = None,
        default_voice: str = "",
        supports_voice_selection: bool = False,
    ):
        self.voices = voices or []  # list[VoiceInfo]
        self.languages = languages or []  # union of ISO codes (str)
        self.default_voice = default_voice
        self.supports_voice_selection = supports_voice_selection
