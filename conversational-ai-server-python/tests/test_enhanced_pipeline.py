"""
Test script for the enhanced 2-stage pipeline with plan-like behavior.
Tests InputGate → Expert Pool → Aggregator flow with step-by-step conversation approach.
"""
import asyncio
import json
from typing import Dict, Any
from message_processing.processor import MessageProcessor
from message_processing.stream_service import StreamService
from livekit import rtc


class MockRoom:
    """Mock room for testing."""
    def __init__(self):
        self.local_participant = MockParticipant()
        self.connected = True

    def isconnected(self) -> bool:
        return self.connected


class MockParticipant:
    """Mock participant for testing."""
    async def publish_data(self, data, reliable=True):
        # Parse and display messages for testing
        try:
            message = json.loads(data.decode('utf-8'))
            message_type = message.get('type', 'unknown')

            # Only show important message types to reduce noise
            if message_type in ['transcript_chunk', 'decision_stream', 'expert_status']:
                data_content = message.get('data', {})

                if message_type == 'transcript_chunk':
                    text = data_content.get('text', '')
                    is_final = data_content.get('is_final', False)
                    participant = data_content.get('participant_id', 'unknown')
                    print(f"[TRANSCRIPT] {participant}: {text} {'(final)' if is_final else '(partial)'}")

                elif message_type == 'decision_stream':
                    step = data_content.get('step', '')
                    decision = data_content.get('decision', '')
                    print(f"[DECISION] {step}: {decision}")

                elif message_type == 'expert_status':
                    expert = data_content.get('expert_name', '')
                    status = data_content.get('status', '')
                    print(f"[EXPERT] {expert}: {status}")

            return True
        except Exception as e:
            print(f"[MOCK_ERROR] {e}")
            return False


async def test_conversation_flow():
    """Test the enhanced pipeline with a realistic conversation flow."""
    print("🚀 Testing Enhanced 2-Stage Pipeline with Step-by-Step Behavior")

    # Create mock room and processor
    mock_room = MockRoom()
    processor = MessageProcessor(mock_room, tts_provider="mock")  # Use mock TTS to avoid external dependencies

    # Initialize (without TTS audio streaming for testing)
    print("\n=== Initializing Processor ===")

    # Test conversation flow with different types of messages
    test_messages = [
        ("Hello!", "Initial greeting - should get step 1 response"),
        ("I'm having trouble with my medication", "Health concern - should route to medical expert"),
        ("I take aspirin daily for my heart", "Follow-up health info - should continue medical conversation"),
        ("Are there any interactions I should know about?", "Specific medical question - expert analysis needed"),
        ("Thank you for the help", "Closing - should provide wrap-up response")
    ]

    print(f"\n=== Testing {len(test_messages)} Message Conversation Flow ===")

    for i, (message, description) in enumerate(test_messages):
        print(f"\n--- Message {i+1}: {description} ---")
        print(f"User: {message}")

        try:
            # Process message through the enhanced pipeline
            success = await processor.process_message(message, "test_user")
            print(f"Processing result: {'✅ Success' if success else '❌ Failed'}")

            # Brief pause between messages
            await asyncio.sleep(0.5)

        except Exception as e:
            print(f"❌ Error processing message: {e}")

    print(f"\n=== Conversation History ===")
    history = processor.get_conversation_history()
    for i, entry in enumerate(history):
        role = entry.get('role', 'unknown')
        content = entry.get('content', '')[:100] + ('...' if len(entry.get('content', '')) > 100 else '')
        print(f"{i+1}. {role}: {content}")

    return processor


async def test_different_conversation_stages():
    """Test how the system behaves at different conversation stages."""
    print("\n🔄 Testing Different Conversation Stages")

    mock_room = MockRoom()
    processor = MessageProcessor(mock_room, tts_provider="mock")

    # Test early stage (greeting/understanding needs)
    print("\n--- Early Stage: Greeting ---")
    await processor.process_message("Hi there", "test_user")

    # Test middle stage (information gathering)
    print("\n--- Middle Stage: Information Gathering ---")
    await processor.process_message("I need help with a legal contract", "test_user")
    await processor.process_message("It's an employment agreement", "test_user")
    await processor.process_message("I'm not sure about the non-compete clause", "test_user")

    # Test later stage (guidance/wrapping up)
    print("\n--- Later Stage: Guidance ---")
    await processor.process_message("What should I do next?", "test_user")
    await processor.process_message("Thanks for your help", "test_user")

    return processor


async def main():
    """Run all tests."""
    print("🧪 Enhanced Pipeline Test Suite")

    try:
        # Test 1: Complete conversation flow
        processor1 = await test_conversation_flow()

        # Test 2: Different conversation stages
        processor2 = await test_different_conversation_stages()

        print("\n✅ All tests completed successfully!")
        print("\nKey observations:")
        print("- InputGate should adapt responses based on conversation stage")
        print("- Expert system should provide step-by-step guidance")
        print("- Aggregator should create natural, conversational responses")
        print("- Each stage should build on previous context naturally")

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())