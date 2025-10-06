#!/usr/bin/env python3
"""
Test script to demonstrate TTS provider functionality.

This script shows how to:
1. Initialize different TTS providers
2. Switch between providers
3. Test provider capabilities
4. Handle configuration validation
"""

import asyncio
import os
import time
from tts.factory import TTSProviderFactory
from tts.service import TTSService


class MockRoom:
    """Mock LiveKit room for testing."""
    def __init__(self):
        self.isconnected = lambda: True
        self.local_participant = MockParticipant()


class MockParticipant:
    """Mock LiveKit participant for testing."""
    def __init__(self):
        self.identity = "test-participant"

    async def publish_track(self, track, options):
        return MockPublication()

    async def publish_data(self, data, reliable=True):
        return True


class MockPublication:
    """Mock LiveKit publication for testing."""
    def __init__(self):
        self.sid = "test-publication-id"
        self.muted = False
        self.track = None


class MockStreamService:
    """Mock stream service for testing."""
    pass


async def test_provider_creation():
    """Test creating providers directly."""
    print("🔬 Testing TTS Provider Creation")
    print("=" * 40)

    room = MockRoom()
    stream_service = MockStreamService()

    # Test opensource provider
    print("\n📦 Testing Open Source Provider:")
    opensource_provider = await TTSProviderFactory.create_provider(
        "opensource", room, stream_service
    )

    if opensource_provider:
        print(f"✅ Created: {opensource_provider.provider_name}")
        print(f"   Capabilities: {opensource_provider.capabilities.__dict__}")
        await opensource_provider.cleanup()
    else:
        print("❌ Failed to create opensource provider")

    # Test ElevenLabs provider (will fail without API key)
    print("\n🎙️  Testing ElevenLabs Provider:")
    elevenlabs_provider = await TTSProviderFactory.create_provider(
        "elevenlabs", room, stream_service
    )

    if elevenlabs_provider:
        print(f"✅ Created: {elevenlabs_provider.provider_name}")
        print(f"   Capabilities: {elevenlabs_provider.capabilities.__dict__}")
        await elevenlabs_provider.cleanup()
    else:
        print("❌ Failed to create ElevenLabs provider (expected without API key)")

    print("\n" + "=" * 40)


async def test_tts_service():
    """Test TTS service with provider switching."""
    print("\n🔧 Testing TTS Service")
    print("=" * 40)

    room = MockRoom()
    stream_service = MockStreamService()

    # Create TTS service with opensource provider
    print("\n📦 Creating TTS Service with opensource provider:")
    tts_service = TTSService(
        stream_service=stream_service,
        room=room,
        provider_name="opensource"
    )

    success = await tts_service.initialize_provider()
    if success:
        print("✅ TTS Service initialized successfully")
        print(f"   Provider: {tts_service.get_provider_info()}")

        # Test text processing (won't actually synthesize without full setup)
        print("\n🔤 Testing text processing:")
        await tts_service.process_text_chunk("Hello world! This is a test.")
        await tts_service.flush_remaining_text()

        # Test pause/resume
        print("\n⏸️  Testing pause/resume:")
        await tts_service.pause()
        await tts_service.resume()

        # Cleanup
        await tts_service.cleanup()
    else:
        print("❌ Failed to initialize TTS service")

    print("\n" + "=" * 40)


async def test_provider_switching():
    """Test switching between providers."""
    print("\n🔄 Testing Provider Switching")
    print("=" * 40)

    room = MockRoom()
    stream_service = MockStreamService()

    tts_service = TTSService(
        stream_service=stream_service,
        room=room,
        provider_name="opensource"
    )

    await tts_service.initialize_provider()
    print(f"📦 Initial provider: {tts_service.get_provider_info()['provider_name']}")

    # Try switching to ElevenLabs (will fail without API key, then fallback)
    print("\n🔄 Attempting to switch to ElevenLabs...")
    switch_success = await tts_service.switch_provider("elevenlabs")

    if switch_success:
        print("✅ Successfully switched to ElevenLabs")
    else:
        print("❌ Failed to switch (expected without API key)")

    print(f"🔧 Current provider: {tts_service.get_provider_info()['provider_name']}")

    await tts_service.cleanup()
    print("\n" + "=" * 40)


def test_configuration_validation():
    """Test configuration validation."""
    print("\n⚙️  Testing Configuration Validation")
    print("=" * 40)

    print("\n📋 Available providers:")
    providers = TTSProviderFactory.list_available_providers()
    for name, info in providers.items():
        status = "✅ Configured" if info["is_configured"] else "❌ Not configured"
        print(f"  - {name}: {status}")

        if not info["is_configured"]:
            config = info["config"]
            required_vars = config.get("required_env_vars", [])
            if required_vars:
                print(f"    Missing: {', '.join(required_vars)}")

    print("\n📝 Configuration requirements:")
    for provider in ["opensource", "elevenlabs"]:
        config = TTSProviderFactory.get_provider_config(provider)
        print(f"\n{provider.upper()}:")
        print(f"  Description: {config.get('description', 'N/A')}")
        print(f"  Required env vars: {config.get('required_env_vars', [])}")
        print(f"  Optional env vars: {config.get('optional_env_vars', [])}")
        print(f"  Dependencies: {config.get('dependencies', [])}")

    print("\n" + "=" * 40)


async def main():
    """Run all tests."""
    print("🎤 TTS Provider Test Suite")
    print("🔬 Testing modular TTS system functionality")
    print("⚡ This demonstrates the new provider-agnostic architecture")

    # Set test environment
    os.environ.setdefault("TTS_PROVIDER", "opensource")

    try:
        test_configuration_validation()
        await test_provider_creation()
        await test_tts_service()
        await test_provider_switching()

        print("\n🎉 All tests completed!")
        print("\nTo use ElevenLabs provider:")
        print("1. Set ELEVENLABS_API_KEY in your environment")
        print("2. Set TTS_PROVIDER=elevenlabs")
        print("3. Optionally configure ELEVENLABS_VOICE_ID and other settings")

    except KeyboardInterrupt:
        print("\n\n⏹️  Tests interrupted by user")
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())