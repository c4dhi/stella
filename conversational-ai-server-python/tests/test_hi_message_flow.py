#!/usr/bin/env python3
"""
Test script to simulate sending 'Hi' and verify todo list initialization.
"""

import asyncio
import json
from message_processing.processor import MessageProcessor


class MockRoom:
    """Mock room that captures messages sent to frontend."""
    def __init__(self):
        self.local_participant = MockParticipant()
        self.connected = True
        self.messages_sent = []

    def isconnected(self) -> bool:
        return self.connected


class MockParticipant:
    """Mock participant that captures data channel messages."""
    def __init__(self):
        self.room = None

    async def publish_data(self, data, reliable=True):
        try:
            message = json.loads(data.decode('utf-8'))
            if hasattr(self, 'room') and self.room:
                self.room.messages_sent.append(message)

            message_type = message.get('type', 'unknown')
            if message_type == 'complete_todo_list':
                data_content = message.get('data', {})
                todo_list = data_content.get('todo_list', {})
                trigger = data_content.get('update_trigger', 'unknown')
                current_step = todo_list.get('current_step', {})
                progress = todo_list.get('progress_percentage', 0)
                initialized = todo_list.get('initialized', False)
                print(f"[TODO_LIST] {trigger}: Step '{current_step.get('title', 'unknown')}' - {progress:.1f}% (initialized: {initialized})")

            elif message_type == 'transcript_chunk':
                data_content = message.get('data', {})
                text = data_content.get('text', '')
                participant_id = data_content.get('participant_id', '')
                is_final = data_content.get('is_final', False)
                if is_final and participant_id != 'test_user':
                    print(f"[RESPONSE] {text}")

            return True
        except Exception as e:
            print(f"[MOCK_ERROR] {e}")
            return False


async def test_hi_message_with_todo_list():
    """Test sending 'Hi' and verify todo list initialization."""
    print("🧪 Testing 'Hi' Message with Todo List Initialization")

    # Create processor
    mock_room = MockRoom()
    mock_room.local_participant.room = mock_room
    processor = MessageProcessor(mock_room, tts_provider="mock")

    print(f"\n=== Initial Task Manager State ===")
    is_first = processor.task_manager.is_first_interaction()
    print(f"Is first interaction: {is_first}")

    current_step = processor.task_manager.get_current_step()
    if current_step:
        print(f"Current step: {current_step.title} ({current_step.status.value})")

    print(f"Messages sent so far: {len(mock_room.messages_sent)}")

    # Send "Hi" message
    print(f"\n=== Sending 'Hi' Message ===")
    success = await processor.process_message("Hi", "test_user")
    print(f"Processing success: {success}")

    print(f"\n=== Final State Analysis ===")
    print(f"Total messages sent: {len(mock_room.messages_sent)}")

    # Check for complete_todo_list messages
    todo_list_messages = [msg for msg in mock_room.messages_sent if msg.get('type') == 'complete_todo_list']
    print(f"Complete todo list messages: {len(todo_list_messages)}")

    # Show all todo list updates
    for i, msg in enumerate(todo_list_messages):
        data = msg['data']
        trigger = data.get('update_trigger', 'unknown')
        todo_list = data.get('todo_list', {})
        current_step = todo_list.get('current_step', {})
        progress = todo_list.get('progress_percentage', 0)
        initialized = todo_list.get('initialized', False)
        print(f"  {i+1}. {trigger}: '{current_step.get('title')}' - {progress:.1f}% (init: {initialized})")

    # Check final task manager state
    final_is_first = processor.task_manager.is_first_interaction()
    print(f"\nIs first interaction after processing: {final_is_first}")

    final_current_step = processor.task_manager.get_current_step()
    if final_current_step:
        print(f"Final current step: {final_current_step.title} ({final_current_step.status.value})")

    # Expected behavior
    print(f"\n=== Expected vs Actual ===")
    expected_todo_messages = 2  # first_message + turn_completion/step_change
    actual_todo_messages = len(todo_list_messages)

    print(f"Expected todo list messages: {expected_todo_messages}")
    print(f"Actual todo list messages: {actual_todo_messages}")

    if actual_todo_messages >= 1:
        first_msg = todo_list_messages[0]
        first_trigger = first_msg['data'].get('update_trigger', 'unknown')
        if first_trigger == 'first_message':
            print("✅ First message todo list initialization working!")
        else:
            print(f"❌ Expected 'first_message' trigger, got '{first_trigger}'")
    else:
        print("❌ No todo list messages sent at all")

    return processor, mock_room


if __name__ == "__main__":
    asyncio.run(test_hi_message_with_todo_list())