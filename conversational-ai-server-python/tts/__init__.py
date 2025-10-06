"""
TTS (Text-to-Speech) module providing modular, provider-agnostic text-to-speech functionality.

This module supports multiple TTS providers with consistent interfaces for:
- Real-time streaming to LiveKit
- Pause/resume capabilities
- Message abandonment (barge-in support)
- Provider switching via configuration

Supported providers:
- opensource: Edge TTS, Kokoro, pyttsx3
- elevenlabs: ElevenLabs streaming API
"""

from .base import AbstractTTSProvider, TTSCapabilities
from .factory import TTSProviderFactory
from .service import TTSService

__all__ = [
    "AbstractTTSProvider",
    "TTSCapabilities",
    "TTSProviderFactory",
    "TTSService"
]