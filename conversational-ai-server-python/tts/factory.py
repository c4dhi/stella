"""
TTS Provider Factory for creating TTS provider instances.

Handles provider instantiation, configuration, and fallback mechanisms.
"""

import os
from typing import Optional, Callable, Dict, Any
from livekit import rtc

from .base import AbstractTTSProvider
from .opensource_provider import OpenSourceTTSProvider
from .elevenlabs_provider import ElevenLabsTTSProvider


class TTSProviderFactory:
    """Factory for creating TTS provider instances."""

    SUPPORTED_PROVIDERS = {
        "opensource": OpenSourceTTSProvider,
        "elevenlabs": ElevenLabsTTSProvider
    }

    # Map provider names to their implementation
    PROVIDER_MAPPING = {
        "opensource": "opensource",
        "kokoro": "opensource",      # Kokoro uses OpenSource provider
        "edge_tts": "opensource",    # Edge TTS uses OpenSource provider
        "auto": "opensource",         # Auto mode uses OpenSource provider
        "elevenlabs": "elevenlabs"
    }

    @classmethod
    async def create_provider(
        cls,
        provider_name: str,
        room: rtc.Room,
        stream_service,
        on_speaking_state_change: Optional[Callable] = None,
        **kwargs
    ) -> Optional[AbstractTTSProvider]:
        """
        Create a TTS provider instance.

        Args:
            provider_name: Name of the provider
                          ("kokoro", "edge_tts", "elevenlabs", "auto", or "opensource")
            room: LiveKit room instance
            stream_service: Stream service instance
            on_speaking_state_change: Callback for speaking state changes
            **kwargs: Additional provider-specific configuration

        Returns:
            TTS provider instance or None if creation failed
        """
        try:
            # Normalize provider name
            provider_name = provider_name.lower().strip()

            # Map to actual provider implementation
            if provider_name in cls.PROVIDER_MAPPING:
                actual_provider = cls.PROVIDER_MAPPING[provider_name]
                print(f"[TTSFactory] Mapping '{provider_name}' → '{actual_provider}' provider")
            else:
                print(f"[TTSFactory] Unsupported provider: {provider_name}")
                print(f"[TTSFactory] Supported providers: {list(cls.PROVIDER_MAPPING.keys())}")
                return None

            # Get provider class
            provider_class = cls.SUPPORTED_PROVIDERS[actual_provider]

            # Create provider instance
            print(f"[TTSFactory] Creating {provider_name} TTS provider...")
            provider = provider_class(
                room=room,
                stream_service=stream_service,
                on_speaking_state_change=on_speaking_state_change,
                **kwargs
            )

            # Initialize provider
            print(f"[TTSFactory] Initializing {provider_name} TTS provider...")
            success = await provider.initialize()

            if success:
                print(f"[TTSFactory] ✅ Successfully created {provider_name} TTS provider")
                print(f"[TTSFactory] Provider capabilities: {provider.capabilities.__dict__}")
                return provider
            else:
                print(f"[TTSFactory] ❌ Failed to initialize {provider_name} TTS provider")
                return None

        except Exception as e:
            print(f"[TTSFactory] Error creating {provider_name} provider: {e}")
            import traceback
            traceback.print_exc()
            return None

    @classmethod
    async def create_with_fallback(
        cls,
        primary_provider: str,
        room: rtc.Room,
        stream_service,
        on_speaking_state_change: Optional[Callable] = None,
        fallback_provider: str = "opensource",
        **kwargs
    ) -> Optional[AbstractTTSProvider]:
        """
        Create TTS provider with automatic fallback.

        Args:
            primary_provider: Primary provider to try first
            room: LiveKit room instance
            stream_service: Stream service instance
            on_speaking_state_change: Callback for speaking state changes
            fallback_provider: Fallback provider if primary fails
            **kwargs: Additional provider-specific configuration

        Returns:
            TTS provider instance (primary or fallback) or None if both fail
        """
        try:
            # Try primary provider first
            provider = await cls.create_provider(
                primary_provider,
                room,
                stream_service,
                on_speaking_state_change,
                **kwargs
            )

            if provider:
                print(f"[TTSFactory] ✅ Using primary provider: {primary_provider}")
                return provider

            # Fall back to fallback provider if different from primary
            if fallback_provider != primary_provider:
                print(f"[TTSFactory] Primary provider failed, trying fallback: {fallback_provider}")
                provider = await cls.create_provider(
                    fallback_provider,
                    room,
                    stream_service,
                    on_speaking_state_change,
                    **kwargs
                )

                if provider:
                    print(f"[TTSFactory] ✅ Using fallback provider: {fallback_provider}")
                    return provider

            print(f"[TTSFactory] ❌ All providers failed")
            return None

        except Exception as e:
            print(f"[TTSFactory] Error in fallback creation: {e}")
            return None

    @classmethod
    def get_provider_config(cls, provider_name: str) -> Dict[str, Any]:
        """
        Get configuration requirements for a provider.

        Args:
            provider_name: Name of the provider

        Returns:
            Dictionary of configuration requirements
        """
        provider_configs = {
            "opensource": {
                "required_env_vars": [],
                "optional_env_vars": [
                    "KOKORO_MODEL_PATH",
                    "KOKORO_VOICES_PATH",
                    "KOKORO_CACHE_DIR"
                ],
                "dependencies": [
                    "edge-tts",
                    "kokoro-onnx",
                    "pyttsx3",
                    "soundfile"
                ],
                "description": "Open source TTS engines (Edge TTS, Kokoro, pyttsx3)"
            },
            "elevenlabs": {
                "required_env_vars": [
                    "ELEVENLABS_API_KEY"
                ],
                "optional_env_vars": [
                    "ELEVENLABS_VOICE_ID",
                    "ELEVENLABS_MODEL_ID",
                    "ELEVENLABS_STABILITY",
                    "ELEVENLABS_SIMILARITY_BOOST"
                ],
                "dependencies": [
                    "elevenlabs",
                    "websockets"
                ],
                "description": "ElevenLabs streaming TTS API"
            }
        }

        return provider_configs.get(provider_name.lower(), {})

    @classmethod
    def validate_provider_config(cls, provider_name: str) -> bool:
        """
        Validate that a provider has the necessary configuration.

        Args:
            provider_name: Name of the provider

        Returns:
            True if configuration is valid, False otherwise
        """
        try:
            config = cls.get_provider_config(provider_name)

            # Check required environment variables
            for env_var in config.get("required_env_vars", []):
                if not os.getenv(env_var):
                    print(f"[TTSFactory] Missing required environment variable: {env_var}")
                    return False

            # For ElevenLabs, specifically check API key
            if provider_name.lower() == "elevenlabs":
                api_key = os.getenv("ELEVENLABS_API_KEY")
                if not api_key:
                    print(f"[TTSFactory] ElevenLabs API key not found in environment")
                    return False
                print(f"[TTSFactory] ElevenLabs API key found: {api_key[:8]}...")

            print(f"[TTSFactory] ✅ Configuration valid for {provider_name}")
            return True

        except Exception as e:
            print(f"[TTSFactory] Error validating {provider_name} config: {e}")
            return False

    @classmethod
    def list_available_providers(cls) -> Dict[str, Dict[str, Any]]:
        """
        List all available providers with their configurations.

        Returns:
            Dictionary of providers and their configurations
        """
        providers = {}
        for provider_name in cls.SUPPORTED_PROVIDERS.keys():
            config = cls.get_provider_config(provider_name)
            is_configured = cls.validate_provider_config(provider_name)

            providers[provider_name] = {
                "config": config,
                "is_configured": is_configured,
                "class": cls.SUPPORTED_PROVIDERS[provider_name].__name__
            }

        return providers