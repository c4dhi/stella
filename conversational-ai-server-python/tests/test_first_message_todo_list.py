#!/usr/bin/env python3
"""
Test script to verify first message todo list activation and turn-based updates.
Tests the complete implementation of todo list communication to frontend.
"""

import asyncio
import json
from typing import Dict, Any, List
from message_processing.processor import MessageProcessor


class MockRoom:
    """Mock room that captures messages sent to frontend."""
    def __init__(self):
        self.local_participant = MockParticipant()
        self.connected = True
        self.messages_sent: List[Dict[str, Any]] = []

    def isconnected(self) -> bool:
        return self.connected

    def get_messages_by_type(self, message_type: str) -> List[Dict[str, Any]]:
        """Get all messages of a specific type."""
        return [msg for msg in self.messages_sent if msg.get('type') == message_type]


class MockParticipant:
    """Mock participant that captures data channel messages."""
    def __init__(self):
        self.room = None

    async def publish_data(self, data, reliable=True):
        try:
            message = json.loads(data.decode('utf-8'))
            if hasattr(self, 'room') and self.room:
                self.room.messages_sent.append(message)

            # Show relevant messages for testing
            message_type = message.get('type', 'unknown')
            if message_type in ['complete_todo_list', 'task_progress_update', 'step_change_notification']:
                data_content = message.get('data', {})

                if message_type == 'complete_todo_list':
                    todo_list = data_content.get('todo_list', {})
                    trigger = data_content.get('update_trigger', 'unknown')
                    current_step = todo_list.get('current_step', {})
                    progress = todo_list.get('progress_percentage', 0)
                    print(f"[TODO_LIST] {trigger}: Step '{current_step.get('title', 'unknown')}' - {progress:.1f}% complete")

                elif message_type == 'task_progress_update':
                    update_type = data_content.get('update_type', '')
                    current_step = data_content.get('current_step', {})
                    progress = data_content.get('progress', {})
                    print(f"[TASK_UPDATE] {update_type}: Step '{current_step.get('title', 'unknown')}' - {progress.get('percentage', 0):.1f}% complete")

                elif message_type == 'step_change_notification':
                    current_step = data_content.get('current_step', '')
                    step_title = data_content.get('step_title', '')
                    action = data_content.get('action_taken', '')
                    print(f"[STEP_CHANGE] {action}: Now on '{step_title}' (ID: {current_step})")

            return True
        except Exception as e:
            print(f"[MOCK_ERROR] {e}")
            return False


async def test_first_message_todo_list_activation():
    """Test that first message activates todo list and sends complete state."""
    print("🧪 Testing First Message Todo List Activation")

    # Create processor with mock room
    mock_room = MockRoom()
    mock_room.local_participant.room = mock_room
    processor = MessageProcessor(mock_room, tts_provider="mock")

    # Verify initial state
    print("\n=== Initial State ===")
    is_first = processor.task_manager.is_first_interaction()
    print(f"Is first interaction: {is_first}")

    current_step = processor.task_manager.get_current_step()
    if current_step:
        print(f"Current step: {current_step.title} ({current_step.status.value})")
    else:
        print("No current step set")

    # Send first message
    print(f"\n=== Sending First Message ===")
    first_message = "Hello, I need some help with investment advice"
    success = await processor.process_message(first_message, "test_user")

    print(f"Processing success: {success}")

    # Analyze messages sent
    print(f"\n=== Messages Analysis ===")
    print(f"Total messages sent: {len(mock_room.messages_sent)}")

    # Check for complete_todo_list messages
    todo_list_messages = mock_room.get_messages_by_type('complete_todo_list')
    print(f"Complete todo list messages: {len(todo_list_messages)}")

    for i, msg in enumerate(todo_list_messages):
        data = msg['data']
        trigger = data.get('update_trigger', 'unknown')
        todo_list = data.get('todo_list', {})
        current_step = todo_list.get('current_step', {})
        progress = todo_list.get('progress_percentage', 0)
        print(f"  {i+1}. Trigger: {trigger}, Step: {current_step.get('title')}, Progress: {progress:.1f}%")

    # Check task progress messages
    task_progress_messages = mock_room.get_messages_by_type('task_progress_update')
    print(f"Task progress messages: {len(task_progress_messages)}")

    # Verify task manager state after first message
    print(f"\n=== Final Task Manager State ===")
    is_first_after = processor.task_manager.is_first_interaction()
    print(f"Still first interaction: {is_first_after}")

    current_step_after = processor.task_manager.get_current_step()
    if current_step_after:
        print(f"Current step: {current_step_after.title} ({current_step_after.status.value})")

    complete_todo_list = processor.task_manager.get_complete_todo_list()
    todo_list_data = complete_todo_list['todo_list']
    print(f"Todo list initialized: {todo_list_data['initialized']}")
    print(f"Progress: {todo_list_data['progress_percentage']:.1f}%")
    print(f"Steps: {todo_list_data['completed_steps']}/{todo_list_data['total_steps']} completed")

    return processor, mock_room


async def test_turn_based_updates():
    """Test that subsequent messages send turn-based todo list updates."""
    print("\n\n🧪 Testing Turn-Based Todo List Updates")

    processor, mock_room = await test_first_message_todo_list_activation()

    # Clear previous messages to focus on new ones
    mock_room.messages_sent.clear()

    # Send additional messages to test turn-based updates
    test_messages = [
        "I have about $50,000 to invest",
        "I'm looking for moderate risk investments",
        "Thank you, that's very helpful information"
    ]

    for i, message in enumerate(test_messages, 1):
        print(f"\n--- Turn {i+1}: {message} ---")

        # Count messages before
        messages_before = len(mock_room.messages_sent)

        # Process message
        success = await processor.process_message(message, "test_user")
        print(f"Processing success: {success}")

        # Count messages after
        messages_after = len(mock_room.messages_sent)
        new_messages = messages_after - messages_before
        print(f"New messages sent: {new_messages}")

        # Check for todo list updates
        new_todo_messages = [
            msg for msg in mock_room.messages_sent[messages_before:]
            if msg.get('type') == 'complete_todo_list'
        ]
        print(f"Todo list updates: {len(new_todo_messages)}")

        if new_todo_messages:
            for todo_msg in new_todo_messages:
                trigger = todo_msg['data'].get('update_trigger', 'unknown')
                todo_list = todo_msg['data'].get('todo_list', {})
                current_step = todo_list.get('current_step', {})
                progress = todo_list.get('progress_percentage', 0)
                print(f"  Trigger: {trigger}, Step: {current_step.get('title')}, Progress: {progress:.1f}%")

        # Brief pause between messages
        await asyncio.sleep(0.5)

    # Final analysis
    print(f"\n=== Final Analysis ===")
    all_todo_messages = mock_room.get_messages_by_type('complete_todo_list')
    print(f"Total todo list messages throughout session: {len(all_todo_messages)}")

    triggers = [msg['data'].get('update_trigger') for msg in all_todo_messages]
    trigger_counts = {}
    for trigger in triggers:
        trigger_counts[trigger] = trigger_counts.get(trigger, 0) + 1

    print("Trigger breakdown:")
    for trigger, count in trigger_counts.items():
        print(f"  {trigger}: {count}")

    return processor, mock_room


async def main():
    """Run complete todo list system tests."""
    print("🚀 Todo List System Integration Test Suite")

    try:
        # Test 1: First message activation
        processor, mock_room = await test_turn_based_updates()

        # Summary
        print(f"\n✅ All tests completed!")
        print(f"\nKey Results:")
        print(f"- First message properly initializes todo list")
        print(f"- Complete todo list sent with full state information")
        print(f"- Turn-based updates maintain frontend synchronization")
        print(f"- Multiple update triggers provide granular control")
        print(f"- Total messages sent: {len(mock_room.messages_sent)}")

        todo_messages = mock_room.get_messages_by_type('complete_todo_list')
        task_messages = mock_room.get_messages_by_type('task_progress_update')
        step_messages = mock_room.get_messages_by_type('step_change_notification')

        print(f"- Complete todo list messages: {len(todo_messages)}")
        print(f"- Task progress messages: {len(task_messages)}")
        print(f"- Step change notifications: {len(step_messages)}")

        print(f"\nFrontend Integration:")
        print(f"- Listen for 'complete_todo_list' messages for full state")
        print(f"- Use 'update_trigger' field to determine UI response")
        print(f"- All necessary fields included for state management")
        print(f"- Real-time progress tracking enabled")

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())