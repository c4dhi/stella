"""
Test that simple greetings don't trigger false deliverable detection.
This specifically tests the fix for the bug where "Hi" was incorrectly interpreted as a user's name.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from message_processing.task_manager import TaskManager
from message_processing.stream_service import StreamService
from message_processing.input_gate import InputGate
from message_processing.llm_service import LLMService


class MockRoom:
    """Mock Room for testing."""
    pass


class TestStreamService(StreamService):
    """Test version of StreamService that captures sent messages."""

    def __init__(self):
        self.room = MockRoom()
        self.sent_deliverables = []
        self.sent_transcripts = []

    async def send_transcript_chunk(self, text: str, is_final: bool = False, **kwargs):
        self.sent_transcripts.append(text)
        return True

    async def send_decision_stream(self, *args, **kwargs):
        return True

    async def send_complete_todo_list(self, *args, **kwargs):
        return True

    async def send_step_change_notification(self, *args, **kwargs):
        return True

    async def send_task_progress_update(self, *args, **kwargs):
        return True

    def generate_stream_id(self):
        return "test_stream_123"


async def test_greeting_detection():
    """Test that various greetings don't trigger name deliverable detection."""

    print("\n" + "="*60)
    print("TESTING GREETING DELIVERABLE DETECTION FIX")
    print("="*60)

    # Initialize services
    stream_service = TestStreamService()
    llm_service = LLMService()
    task_manager = TaskManager(plan_name="cognitive_stimulation_demo")

    # Initialize input gate
    input_gate = InputGate(
        stream_service=stream_service,
        tts_service=None,
        llm_service=llm_service,
        task_manager=task_manager
    )

    # Test various greeting inputs
    test_greetings = [
        "Hi",
        "Hello",
        "Hey",
        "Good morning",
        "Hi there",
        "Hello!",
        "Hey there"
    ]

    print("\nTesting that greetings don't trigger name detection:")
    print("-" * 40)

    for greeting in test_greetings:
        print(f"\n🧪 Testing greeting: '{greeting}'")

        # Reset task manager for each test
        task_manager = TaskManager(plan_name="cognitive_stimulation_demo")
        input_gate.task_manager = task_manager

        # Process the greeting
        result = await input_gate.process_streaming(
            user_input=greeting,
            context="",
            enable_voice_narration=False
        )

        # Check if any deliverables were incorrectly detected
        deliverables_detected = False
        if task_manager.plan_execution:
            user_name_state = task_manager.plan_execution.get_deliverable_state("user_name")
            if user_name_state and user_name_state.value:
                deliverables_detected = True
                print(f"  ❌ FAILED: '{greeting}' was incorrectly detected as name: {user_name_state.value}")
            else:
                print(f"  ✅ PASSED: '{greeting}' was NOT detected as a name")
        else:
            print(f"  ⚠️  WARNING: Plan not initialized")

    # Test actual names that SHOULD be detected
    print("\n" + "-" * 40)
    print("\nTesting that actual names ARE properly detected:")
    print("-" * 40)

    test_names = [
        "Hi, I'm John",
        "Hello, my name is Sarah",
        "Hey, call me Mike",
        "I'm Emily"
    ]

    for name_input in test_names:
        print(f"\n🧪 Testing name input: '{name_input}'")

        # Reset task manager
        task_manager = TaskManager(plan_name="cognitive_stimulation_demo")
        input_gate.task_manager = task_manager

        # Process the name input
        result = await input_gate.process_streaming(
            user_input=name_input,
            context="",
            enable_voice_narration=False
        )

        # Check if name was detected
        if task_manager.plan_execution:
            user_name_state = task_manager.plan_execution.get_deliverable_state("user_name")
            if user_name_state and user_name_state.value:
                print(f"  ✅ PASSED: Name detected: {user_name_state.value}")
            else:
                print(f"  ❌ FAILED: Name was NOT detected from '{name_input}'")
        else:
            print(f"  ⚠️  WARNING: Plan not initialized")

    print("\n" + "="*60)
    print("TEST COMPLETE")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(test_greeting_detection())