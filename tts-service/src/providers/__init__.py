"""TTS Providers package."""

from .base import TTSProvider
from .edge_tts_provider import EdgeTTSProvider
from .kokoro_provider import KokoroProvider
<<<<<<< HEAD
from .piper_provider import PiperProvider

__all__ = ['TTSProvider', 'EdgeTTSProvider', 'KokoroProvider', 'PiperProvider']
=======
from .chatterbox_provider import ChatterBoxProvider

__all__ = ['TTSProvider', 'EdgeTTSProvider', 'KokoroProvider', 'ChatterBoxProvider']
>>>>>>> worktree-adaptive-plotting-steele
