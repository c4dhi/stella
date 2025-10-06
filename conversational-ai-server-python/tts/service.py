"""
TTS Service wrapper providing a provider-agnostic interface.

This service wraps TTS providers and maintains the same external API
as the original StreamingTTSService for backward compatibility.
"""

import asyncio
import time
from typing import Optional, Callable, List, Tuple
from livekit import rtc

from .base import AbstractTTSProvider
from .factory import TTSProviderFactory


class TTSService:
    """
    TTS Service wrapper providing provider-agnostic text-to-speech functionality.

    This class maintains compatibility with the original StreamingTTSService API
    while using the new modular provider system underneath.
    """

    def __init__(
        self,
        stream_service,
        room: rtc.Room,
        on_speaking_state_change: Optional[Callable] = None,
        provider_name: str = "opensource",
        **provider_kwargs
    ):
        self.stream_service = stream_service
        self.room = room
        self.on_speaking_state_change = on_speaking_state_change
        self.provider_name = provider_name
        self.provider_kwargs = provider_kwargs

        # TTS provider instance
        self.provider: Optional[AbstractTTSProvider] = None

        # State tracking (for backward compatibility)
        self.is_speaking = False
        self.tts_available = False

        # Sentence processing buffer
        self.sentence_buffer = ""

    async def initialize_provider(self) -> bool:
        """Initialize the TTS provider."""
        try:
            print(f"[TTSService] Initializing TTS provider: {self.provider_name}")

            # Create provider with fallback
            self.provider = await TTSProviderFactory.create_with_fallback(
                primary_provider=self.provider_name,
                room=self.room,
                stream_service=self.stream_service,
                on_speaking_state_change=self._on_provider_speaking_state_change,
                fallback_provider="opensource",
                **self.provider_kwargs
            )

            if self.provider:
                self.tts_available = True
                print(f"[TTSService] ✅ TTS provider initialized: {self.provider.provider_name}")
                print(f"[TTSService] Provider capabilities: {self.provider.capabilities.__dict__}")
                return True
            else:
                self.tts_available = False
                print("[TTSService] ❌ Failed to initialize any TTS provider")
                return False

        except Exception as e:
            print(f"[TTSService] Error initializing provider: {e}")
            self.tts_available = False
            return False

    async def _setup_audio_track(self):
        """Set up LiveKit audio track for streaming TTS output."""
        if self.provider:
            await self.provider.setup_audio_track()
        else:
            print("[TTSService] No provider available for audio track setup")

    async def initialize_tts_audio_streaming(self):
        """Initialize TTS audio streaming (backward compatibility method)."""
        await self._setup_audio_track()

    async def _on_provider_speaking_state_change(self, is_speaking: bool):
        """Handle speaking state changes from provider."""
        self.is_speaking = is_speaking
        if self.on_speaking_state_change:
            try:
                await self.on_speaking_state_change(is_speaking)
            except Exception as e:
                print(f"[TTSService] Error in speaking state callback: {e}")

    # Backward compatibility methods matching original StreamingTTSService API

    async def process_text_chunk(self, text_chunk: str, message_id: str = None, stream_id: str = None):
        """Process incoming text chunk (backward compatibility)."""
        if self.provider:
            await self.provider.process_text_chunk(text_chunk, message_id, stream_id)
        else:
            print("[TTSService] No provider available for text processing")

    async def flush_remaining_text(self):
        """Process any remaining text in buffer as final sentence."""
        if self.provider:
            await self.provider.flush_remaining_text()
        else:
            print("[TTSService] No provider available for text flushing")

    async def clear_buffer(self):
        """Clear the sentence buffer without speaking its contents."""
        if self.provider:
            await self.provider.clear_buffer()
        else:
            print("[TTSService] No provider available for buffer clearing")

    async def pause(self):
        """Pause TTS synthesis and streaming."""
        if self.provider:
            await self.provider.pause()
        else:
            print("[TTSService] No provider available for pause")

    async def resume(self):
        """Resume TTS synthesis and streaming."""
        if self.provider:
            await self.provider.resume()
        else:
            print("[TTSService] No provider available for resume")

    async def pause_for_barge_in(self) -> Optional[dict]:
        """
        Pause TTS for barge-in scenario and return resume data.

        Returns:
            dict: Resume data needed to continue from pause point, or None if failed
        """
        if not self.provider:
            print("[TTSService] No provider available for barge-in pause")
            return None

        try:
            print("[TTSService] Pausing for barge-in...")

            # Pause the provider and capture resume state
            await self.provider.pause()

            # Get resume data from provider if available
            resume_data = None
            if hasattr(self.provider, 'get_pause_state'):
                resume_data = self.provider.get_pause_state()
            elif hasattr(self.provider, 'pause_state'):
                resume_data = getattr(self.provider, 'pause_state', None)

            # Create comprehensive resume data
            barge_in_resume_data = {
                "provider_name": self.provider.provider_name,
                "was_speaking": self.provider.get_speaking_state(),
                "pause_timestamp": time.time(),
                "provider_resume_data": resume_data,
                "service_state": {
                    "is_speaking": self.is_speaking,
                    "tts_available": self.tts_available
                }
            }

            print(f"[TTSService] Barge-in pause successful, resume data captured")
            return barge_in_resume_data

        except Exception as e:
            print(f"[TTSService] Error during barge-in pause: {e}")
            return None

    async def resume_from_barge_in(self, resume_data: Optional[dict] = None) -> bool:
        """
        Resume TTS from barge-in pause using saved state.

        Args:
            resume_data: Resume data from pause_for_barge_in()

        Returns:
            bool: True if resume was successful
        """
        if not self.provider:
            print("[TTSService] No provider available for barge-in resume")
            return False

        try:
            print("[TTSService] Resuming from barge-in...")

            # If we have resume data, try to restore provider state
            if resume_data and "provider_resume_data" in resume_data:
                provider_resume_data = resume_data["provider_resume_data"]

                # Try to restore provider state if method exists
                if hasattr(self.provider, 'restore_pause_state') and provider_resume_data:
                    await self.provider.restore_pause_state(provider_resume_data)
                    print("[TTSService] Provider state restored from resume data")

            # Resume the provider
            await self.provider.resume()

            print("[TTSService] Barge-in resume successful")
            return True

        except Exception as e:
            print(f"[TTSService] Error during barge-in resume: {e}")
            return False

    async def abandon_for_barge_in(self) -> bool:
        """
        Abandon current TTS for a valid barge-in interruption.

        Returns:
            bool: True if abandon was successful
        """
        if not self.provider:
            print("[TTSService] No provider available for barge-in abandon")
            return False

        try:
            print("[TTSService] Abandoning current TTS for barge-in...")

            # Stop current synthesis and clear queue
            await self.provider.abandon_current()

            print("[TTSService] TTS abandoned for barge-in")
            return True

        except Exception as e:
            print(f"[TTSService] Error during barge-in abandon: {e}")
            return False

    def get_speaking_state(self) -> bool:
        """Get current speaking state."""
        if self.provider:
            return self.provider.get_speaking_state()
        return self.is_speaking

    async def stop_speaking(self):
        """Stop current TTS playback."""
        if self.provider:
            await self.provider.abandon_current()
        else:
            print("[TTSService] No provider available for stop")

    def extract_complete_sentences(self, text_chunk: str) -> Tuple[List[str], str]:
        """
        Extract complete sentences from text chunk (backward compatibility).

        This method maintains the original API but delegates to the provider.
        """
        if self.provider:
            # Use provider's internal method
            return self.provider._extract_complete_sentences(text_chunk)
        else:
            # Fallback implementation if no provider
            import re

            self.sentence_buffer += text_chunk
            sentence_pattern = r'([^.!?]*[.!?]+(?:\s|$))'
            sentences = re.findall(sentence_pattern, self.sentence_buffer)
            complete_sentences = [s.strip() for s in sentences if s.strip()]

            if complete_sentences:
                last_sentence_end = 0
                for sentence in complete_sentences:
                    pos = self.sentence_buffer.find(sentence, last_sentence_end)
                    if pos != -1:
                        last_sentence_end = pos + len(sentence)
                remaining = self.sentence_buffer[last_sentence_end:].strip()
            else:
                remaining = self.sentence_buffer

            self.sentence_buffer = remaining
            return complete_sentences, remaining

    async def cleanup(self):
        """Clean up TTS resources."""
        try:
            if self.provider:
                await self.provider.cleanup()
                self.provider = None

            self.tts_available = False
            self.is_speaking = False
            print("[TTSService] Cleanup completed")

        except Exception as e:
            print(f"[TTSService] Error during cleanup: {e}")

    def cleanup_sync(self):
        """Synchronous cleanup wrapper for compatibility."""
        try:
            asyncio.create_task(self.cleanup())
        except RuntimeError:
            print("[TTSService] Sync cleanup - no event loop available")

    # Provider management methods

    async def switch_provider(self, new_provider_name: str, **new_provider_kwargs) -> bool:
        """Switch to a different TTS provider."""
        try:
            print(f"[TTSService] Switching from {self.provider_name} to {new_provider_name}")

            # Clean up current provider
            if self.provider:
                await self.provider.cleanup()

            # Update configuration
            self.provider_name = new_provider_name
            self.provider_kwargs.update(new_provider_kwargs)

            # Initialize new provider
            success = await self.initialize_provider()

            if success:
                print(f"[TTSService] ✅ Successfully switched to {new_provider_name}")
            else:
                print(f"[TTSService] ❌ Failed to switch to {new_provider_name}")

            return success

        except Exception as e:
            print(f"[TTSService] Error switching provider: {e}")
            return False

    def get_provider_info(self) -> dict:
        """Get information about the current provider."""
        if self.provider:
            return {
                "provider_name": self.provider.provider_name,
                "capabilities": self.provider.capabilities.__dict__,
                "state": self.provider.state.value,
                "is_speaking": self.provider.get_speaking_state()
            }
        else:
            return {
                "provider_name": None,
                "capabilities": {},
                "state": "not_initialized",
                "is_speaking": False
            }

    def get_available_providers(self) -> dict:
        """Get information about all available providers."""
        return TTSProviderFactory.list_available_providers()

    def is_provider_configured(self, provider_name: str) -> bool:
        """Check if a provider is properly configured."""
        return TTSProviderFactory.validate_provider_config(provider_name)

    # Advanced provider methods

    async def synthesize_with_voice(self, text: str, voice_id: str = None) -> bool:
        """Synthesize text with specific voice (if provider supports it)."""
        if not self.provider:
            print("[TTSService] No provider available")
            return False

        if not self.provider.capabilities.supports_voice_selection:
            print(f"[TTSService] Provider {self.provider.provider_name} does not support voice selection")
            return False

        try:
            # Process as text chunk with voice hint
            await self.provider.process_text_chunk(text)
            return True

        except Exception as e:
            print(f"[TTSService] Error synthesizing with voice: {e}")
            return False

    async def test_provider_connectivity(self) -> bool:
        """Test if the current provider is working properly."""
        if not self.provider:
            return False

        try:
            # Try synthesizing a simple test sentence
            test_sentence = "This is a test."
            audio_data = await self.provider.synthesize_sentence(test_sentence)
            return audio_data is not None

        except Exception as e:
            print(f"[TTSService] Provider connectivity test failed: {e}")
            return False

    # Configuration methods

    @classmethod
    async def create_from_config(
        cls,
        stream_service,
        room: rtc.Room,
        config: dict,
        on_speaking_state_change: Optional[Callable] = None
    ) -> 'TTSService':
        """Create TTSService from configuration dictionary."""
        provider_name = config.get("provider", "opensource")
        provider_kwargs = config.get("provider_config", {})

        service = cls(
            stream_service=stream_service,
            room=room,
            on_speaking_state_change=on_speaking_state_change,
            provider_name=provider_name,
            **provider_kwargs
        )

        await service.initialize_provider()
        return service

    def get_configuration(self) -> dict:
        """Get current service configuration."""
        return {
            "provider": self.provider_name,
            "provider_config": self.provider_kwargs,
            "tts_available": self.tts_available,
            "provider_info": self.get_provider_info()
        }

    # Health and monitoring

    def get_health_status(self) -> dict:
        """Get health status of the TTS service."""
        status = {
            "service_healthy": self.tts_available and self.provider is not None,
            "provider_name": self.provider.provider_name if self.provider else None,
            "provider_state": self.provider.state.value if self.provider else "not_initialized",
            "is_speaking": self.get_speaking_state(),
            "capabilities": self.provider.capabilities.__dict__ if self.provider else {}
        }

        # Add provider-specific health information
        if self.provider and hasattr(self.provider, 'get_health_status'):
            status["provider_health"] = self.provider.get_health_status()

        return status

    async def perform_health_check(self) -> bool:
        """Perform a comprehensive health check."""
        try:
            # Basic checks
            if not self.tts_available or not self.provider:
                return False

            # Provider connectivity test
            connectivity_ok = await self.test_provider_connectivity()

            # Audio track check
            audio_track_ok = self.provider.audio_source is not None

            return connectivity_ok and audio_track_ok

        except Exception as e:
            print(f"[TTSService] Health check failed: {e}")
            return False