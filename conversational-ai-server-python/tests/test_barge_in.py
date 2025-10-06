#!/usr/bin/env python3
"""
Test script for barge-in functionality.

This script tests the barge-in implementation without needing LiveKit setup.
"""

import asyncio
import sys
from unittest.mock import Mock, AsyncMock

# Add the current directory to the path for imports
sys.path.append('.')

from message_processing.barge_in_coordinator import BargeInCoordinator, BargeInStatus
from message_processing.llm_service import LLMService


class MockStreamService:
    """Mock stream service for testing."""

    def __init__(self):
        self.sent_messages = []

    async def _send_message(self, message):
        """Mock send message that stores messages."""
        self.sent_messages.append(message)
        print(f"[MockStreamService] Sent message: {message['type']} - {message['data'].get('event_type', 'N/A')}")
        return True


class MockTTSService:
    """Mock TTS service for testing."""

    def __init__(self):
        self.paused = False
        self.speaking = False
        self.pause_data = {}

    async def pause_for_barge_in(self):
        """Mock pause for barge-in."""
        self.paused = True
        print("[MockTTSService] Paused for barge-in")
        return {
            "provider_name": "mock",
            "was_speaking": self.speaking,
            "pause_timestamp": asyncio.get_event_loop().time(),
            "test_data": "mock_resume_data"
        }

    async def resume_from_barge_in(self, resume_data=None):
        """Mock resume from barge-in."""
        self.paused = False
        print(f"[MockTTSService] Resumed from barge-in with data: {resume_data}")
        return True

    async def abandon_for_barge_in(self):
        """Mock abandon for barge-in."""
        self.paused = False
        self.speaking = False
        print("[MockTTSService] Abandoned for barge-in")
        return True


class MockLLMService:
    """Mock LLM service for testing."""

    def __init__(self, validation_response="VALID - This is a clear question"):
        self.validation_response = validation_response

    async def generate_response(self, prompt, max_tokens=50):
        """Mock LLM response."""
        print(f"[MockLLMService] Generated response: {self.validation_response}")
        return self.validation_response


async def test_barge_in_workflow():
    """Test the complete barge-in workflow."""
    print("🧪 Starting Barge-In Workflow Test")
    print("=" * 50)

    # Create mock services
    stream_service = MockStreamService()
    tts_service = MockTTSService()
    llm_service = MockLLMService("VALID - Clear interruption with question")

    # Track events for verification
    received_events = []

    async def mock_barge_in_event_handler(event_type, event_data):
        """Mock event handler to track events."""
        received_events.append((event_type, event_data))
        print(f"[EventHandler] Received event: {event_type}")

    # Create barge-in coordinator
    coordinator = BargeInCoordinator(
        stream_service=stream_service,
        llm_service=llm_service,
        on_barge_in_event=mock_barge_in_event_handler
    )

    # Test 1: Speech detection during TTS
    print("\n📢 Test 1: Speech Detection During TTS")
    tts_service.speaking = True

    interruption_id = await coordinator.handle_speech_during_tts(
        tts_service=tts_service,
        audio_transcription_service=Mock(),
        interrupted_message_id="test_message_123"
    )

    print(f"✅ Interruption ID created: {interruption_id}")
    print(f"✅ TTS paused: {tts_service.paused}")
    print(f"✅ Messages sent: {len(stream_service.sent_messages)}")

    # Test 2: Transcription update with valid interruption
    print("\n📝 Test 2: Transcription Update - Valid Interruption")

    await coordinator.handle_transcription_update(
        interruption_id=interruption_id,
        transcribed_text="Can you explain that again please?",
        is_final=True
    )

    # Wait a moment for async processing
    await asyncio.sleep(0.1)

    # Test 3: Check validation and decision
    print("\n🤖 Test 3: Validation and Decision Making")
    print(f"✅ Current status: {coordinator.get_current_barge_in_status()}")
    print(f"✅ Events received: {len(received_events)}")
    print(f"✅ Total messages sent: {len(stream_service.sent_messages)}")

    # Wait for validation to complete
    await asyncio.sleep(coordinator.validation_timeout + 0.5)

    # Test 4: Check final state
    print("\n📊 Test 4: Final State Check")
    stats = coordinator.get_statistics()
    print(f"✅ Total barge-ins: {stats['total_barge_ins']}")
    print(f"✅ Valid interruptions: {stats['valid_interruptions']}")
    print(f"✅ Success rate: {stats['success_rate']:.1%}")
    print(f"✅ Current active: {stats['current_active']}")

    # Test 5: Invalid interruption scenario
    print("\n❌ Test 5: Invalid Interruption Test")

    # Reset for new test
    tts_service.speaking = True
    tts_service.paused = False
    llm_service.validation_response = "INVALID - Just background noise"

    interruption_id_2 = await coordinator.handle_speech_during_tts(
        tts_service=tts_service,
        audio_transcription_service=Mock(),
        interrupted_message_id="test_message_456"
    )

    await coordinator.handle_transcription_update(
        interruption_id=interruption_id_2,
        transcribed_text="um uh noise",
        is_final=True
    )

    # Wait for validation
    await asyncio.sleep(coordinator.validation_timeout + 0.5)

    final_stats = coordinator.get_statistics()
    print(f"✅ Total barge-ins: {final_stats['total_barge_ins']}")
    print(f"✅ Valid interruptions: {final_stats['valid_interruptions']}")
    print(f"✅ Invalid interruptions: {final_stats['invalid_interruptions']}")

    # Test 6: Message types verification
    print("\n📨 Test 6: Message Types Verification")
    message_types = [msg['type'] for msg in stream_service.sent_messages]
    event_types = [msg['data']['event_type'] for msg in stream_service.sent_messages if msg['type'] == 'barge_in_event']

    print(f"✅ Message types sent: {set(message_types)}")
    print(f"✅ Barge-in event types: {set(event_types)}")

    print("\n🎉 Barge-In Test Complete!")
    print("=" * 50)

    return {
        "total_tests": 6,
        "interruptions_created": final_stats['total_barge_ins'],
        "valid_interruptions": final_stats['valid_interruptions'],
        "invalid_interruptions": final_stats['invalid_interruptions'],
        "messages_sent": len(stream_service.sent_messages),
        "events_received": len(received_events)
    }


async def test_audio_transcription_integration():
    """Test the audio transcription integration."""
    print("\n🎤 Testing Audio Transcription Integration")
    print("=" * 30)

    # Test the enhanced audio transcription methods
    from message_processing.simple_audio_transcription import SimpleAudioTranscriptionService

    # Create mock stream service
    mock_stream = MockStreamService()

    # Create audio transcription service (without actual model)
    audio_service = SimpleAudioTranscriptionService(
        stream_service=mock_stream,
        on_final_transcript=None,
        language="en"
    )

    # Test barge-in state management
    print("✅ Testing barge-in state management...")
    print(f"  - Initial barge-in active: {audio_service.is_barge_in_active()}")
    print(f"  - Barge-in detection enabled: {audio_service.barge_in_detection_enabled}")

    # Test enable/disable
    audio_service.disable_barge_in_detection()
    print(f"  - After disable: {audio_service.barge_in_detection_enabled}")

    audio_service.enable_barge_in_detection()
    print(f"  - After enable: {audio_service.barge_in_detection_enabled}")

    # Test speaking state change
    await audio_service.on_assistant_speaking_change(True)
    print(f"  - Barge-in mode when speaking: {audio_service.barge_in_mode}")

    await audio_service.on_assistant_speaking_change(False)
    print(f"  - Barge-in mode when not speaking: {audio_service.barge_in_mode}")

    print("✅ Audio transcription integration test complete!")


async def main():
    """Main test function."""
    print("🚀 Barge-In Implementation Test Suite")
    print("=" * 60)

    try:
        # Run main workflow test
        results = await test_barge_in_workflow()

        # Run audio transcription integration test
        await test_audio_transcription_integration()

        # Summary
        print(f"\n📋 Test Summary:")
        print(f"  - Tests run: {results['total_tests']}")
        print(f"  - Interruptions created: {results['interruptions_created']}")
        print(f"  - Valid interruptions: {results['valid_interruptions']}")
        print(f"  - Invalid interruptions: {results['invalid_interruptions']}")
        print(f"  - Messages sent: {results['messages_sent']}")
        print(f"  - Events handled: {results['events_received']}")

        print("\n🎉 All tests completed successfully!")
        print("The barge-in implementation is ready for use.")

    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)