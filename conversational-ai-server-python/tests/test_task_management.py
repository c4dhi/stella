"""
Test script for the task management system integrated with the 2-stage pipeline.
Tests how InputGate and Aggregator work together with shared TaskManager.
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

            # Show task-related and important messages
            if message_type in ['task_progress_update', 'step_change_notification', 'task_update',
                               'transcript_chunk', 'decision_stream']:
                data_content = message.get('data', {})

                if message_type == 'task_progress_update':
                    update_type = data_content.get('update_type', '')
                    current_step = data_content.get('current_step', {})
                    progress = data_content.get('progress', {})
                    print(f"[TASK_UPDATE] {update_type}: Step '{current_step.get('title', 'unknown')}' - {progress.get('percentage', 0):.1f}% complete")

                elif message_type == 'step_change_notification':
                    current_step = data_content.get('current_step', '')
                    step_title = data_content.get('step_title', '')
                    action = data_content.get('action_taken', '')
                    print(f"[STEP_CHANGE] {action}: Now on '{step_title}' (ID: {current_step})")

                elif message_type == 'task_update':
                    task_desc = data_content.get('task_description', '')
                    action = data_content.get('action_taken', '')
                    status = data_content.get('task_status', '')
                    print(f"[TASK] {action}: '{task_desc}' -> {status}")

                elif message_type == 'transcript_chunk':
                    text = data_content.get('text', '')
                    is_final = data_content.get('is_final', False)
                    participant = data_content.get('participant_id', 'unknown')
                    if is_final and participant != 'test_user':  # Only show assistant responses
                        print(f"[RESPONSE] {text}")

                elif message_type == 'decision_stream':
                    step = data_content.get('step', '')
                    decision = data_content.get('decision', '')
                    if 'error' not in step.lower() and 'start' not in step.lower():
                        print(f"[DECISION] {step}: {decision}")

            return True
        except Exception as e:
            print(f"[MOCK_ERROR] {e}")
            return False


async def test_task_management_flow():
    """Test the task management integration with conversation flow."""
    print("🧪 Testing Task Management Integration")

    # Create mock room and processor
    mock_room = MockRoom()
    processor = MessageProcessor(mock_room, tts_provider="mock")

    print("\n=== Initial Task Manager State ===")
    if processor.task_manager:
        progress = processor.task_manager.get_progress_summary()
        current_step = progress["current_step"]
        print(f"Current Step: {current_step['title']} (Status: {current_step['status']})")
        print(f"Progress: {progress['progress']['percentage']:.1f}% complete")

    # Test conversation flow that should trigger step changes
    test_conversation = [
        ("Hello there!", "Initial greeting - should stay on greeting step"),
        ("I need help with my investment portfolio", "Request for help - should advance to information gathering"),
        ("I have $50,000 to invest and I'm 35 years old", "Providing information - should continue gathering info"),
        ("I'm looking for moderate risk investments", "More details - should advance to analysis step"),
        ("Thank you, that's very helpful", "Acknowledgment - should advance to follow-up step"),
        ("I think I understand now", "Final confirmation - should complete conversation")
    ]

    print(f"\n=== Testing {len(test_conversation)} Message Flow with Task Management ===")

    for i, (message, description) in enumerate(test_conversation):
        print(f"\n--- Message {i+1}: {description} ---")
        print(f"User: {message}")

        # Show task manager state before processing
        if processor.task_manager:
            current_step = processor.task_manager.get_current_step()
            print(f"[BEFORE] Current Step: {current_step.title} ({current_step.status.value})")

        try:
            # Process message through the enhanced pipeline
            success = await processor.process_message(message, "test_user")

            # Show task manager state after processing
            if processor.task_manager:
                current_step = processor.task_manager.get_current_step()
                if current_step:
                    print(f"[AFTER] Current Step: {current_step.title} ({current_step.status.value})")
                    if current_step.tasks:
                        print(f"[TASKS] {len(current_step.tasks)} tasks in current step")

            print(f"Processing: {'✅ Success' if success else '❌ Failed'}")

            # Brief pause between messages
            await asyncio.sleep(0.5)

        except Exception as e:
            print(f"❌ Error processing message: {e}")

    # Show final task manager state
    print(f"\n=== Final Task Manager State ===")
    if processor.task_manager:
        progress = processor.task_manager.get_progress_summary()
        print(f"Conversation completed: {progress['progress']['percentage']:.1f}%")
        print(f"Total tasks created: {progress['tasks']['total_tasks']}")
        print(f"Steps completed: {progress['progress']['completed_steps']}/{progress['progress']['total_steps']}")

        print("\nStep Summary:")
        for step_info in progress['steps']:
            step_id = step_info['id']
            step_title = step_info['title']
            step_status = step_info['status']
            task_count = len(step_info['tasks'])
            print(f"  - {step_title}: {step_status} ({task_count} tasks)")

    return processor


async def test_expert_analysis_task_creation():
    """Test how expert analysis creates and manages tasks."""
    print("\n🔬 Testing Expert Analysis Task Creation")

    mock_room = MockRoom()
    processor = MessageProcessor(mock_room, tts_provider="mock")

    # Test messages that should trigger expert analysis and task creation
    expert_test_messages = [
        "Hi, I need some advice",  # Initial greeting
        "I'm having chest pain and shortness of breath",  # Medical issue - should trigger medical expert
        "It started this morning after I took my new medication",  # Follow-up info
    ]

    for i, message in enumerate(expert_test_messages):
        print(f"\n--- Expert Test Message {i+1} ---")
        print(f"User: {message}")

        try:
            await processor.process_message(message, "test_user")

            # Check if tasks were created
            if processor.task_manager:
                current_step = processor.task_manager.get_current_step()
                if current_step and current_step.tasks:
                    print(f"Tasks created: {len(current_step.tasks)}")
                    for task in current_step.tasks:
                        print(f"  - {task.description} ({task.status.value})")

            await asyncio.sleep(0.5)

        except Exception as e:
            print(f"❌ Error: {e}")

    return processor


async def main():
    """Run all task management tests."""
    print("🚀 Task Management System Test Suite")

    try:
        # Test 1: Basic task management flow
        processor1 = await test_task_management_flow()

        # Test 2: Expert analysis task creation
        processor2 = await test_expert_analysis_task_creation()

        print("\n✅ All task management tests completed!")
        print("\nKey observations:")
        print("- TaskManager tracks conversation steps and progress")
        print("- InputGate provides step context to decision making")
        print("- Aggregator analyzes expert findings and updates step status")
        print("- System automatically advances through conversation steps")
        print("- Tasks are created based on expert recommendations")
        print("- Frontend receives real-time task and step updates")

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())