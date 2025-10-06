#!/usr/bin/env python3
"""
Simple test to verify first message todo list activation without API dependencies.
"""

import asyncio
import json
from message_processing.task_manager import TaskManager
from message_processing.stream_service import StreamService


class MockRoom:
    def __init__(self):
        self.local_participant = MockParticipant()
        self.messages_sent = []

class MockParticipant:
    def __init__(self):
        self.room = None

    async def publish_data(self, data, reliable=True):
        try:
            message = json.loads(data.decode('utf-8'))
            if hasattr(self, 'room') and self.room:
                self.room.messages_sent.append(message)

            if message.get('type') == 'complete_todo_list':
                data_content = message.get('data', {})
                todo_list = data_content.get('todo_list', {})
                trigger = data_content.get('update_trigger', 'unknown')
                current_step = todo_list.get('current_step', {})
                progress = todo_list.get('progress_percentage', 0)
                print(f"[TODO_LIST] {trigger}: Step '{current_step.get('title', 'unknown')}' - {progress:.1f}% complete")
                print(f"  Initialized: {todo_list.get('initialized')}")
                print(f"  Total Steps: {todo_list.get('total_steps')}")
                print(f"  Current Step Index: {todo_list.get('current_step_index')}")

            return True
        except Exception as e:
            print(f"Error: {e}")
            return False


async def test_todo_list_functionality():
    """Test the core todo list functionality."""
    print("🧪 Testing Todo List Core Functionality")

    # Create components
    mock_room = MockRoom()
    mock_room.local_participant.room = mock_room

    task_manager = TaskManager()
    stream_service = StreamService(mock_room)

    print(f"\n=== Initial State ===")
    print(f"Is first interaction: {task_manager.is_first_interaction()}")

    current_step = task_manager.get_current_step()
    if current_step:
        print(f"Current step: {current_step.title} ({current_step.status.value})")
    else:
        print("No current step (this is expected initially)")

    # Test first step initialization
    print(f"\n=== Initializing First Step ===")
    success = task_manager.initialize_first_step()
    print(f"Initialization success: {success}")
    print(f"Is first interaction after init: {task_manager.is_first_interaction()}")

    current_step = task_manager.get_current_step()
    print(f"Current step after init: {current_step.title} ({current_step.status.value})")

    # Test complete todo list generation
    print(f"\n=== Complete Todo List ===")
    complete_todo_list = task_manager.get_complete_todo_list()

    # Send to stream service
    await stream_service.send_complete_todo_list(
        todo_list_data=complete_todo_list,
        update_trigger="first_message"
    )

    # Test step advancement
    print(f"\n=== Testing Step Advancement ===")
    success = task_manager.advance_to_next_step(force=True)
    print(f"Advancement success: {success}")

    if success:
        new_current_step = task_manager.get_current_step()
        print(f"New current step: {new_current_step.title} ({new_current_step.status.value})")

        # Send updated todo list
        updated_complete_todo_list = task_manager.get_complete_todo_list()
        await stream_service.send_complete_todo_list(
            todo_list_data=updated_complete_todo_list,
            update_trigger="step_advancement_test"
        )

    # Show final analysis
    print(f"\n=== Final Analysis ===")
    print(f"Total messages sent: {len(mock_room.messages_sent)}")

    todo_list_messages = [msg for msg in mock_room.messages_sent if msg.get('type') == 'complete_todo_list']
    print(f"Complete todo list messages: {len(todo_list_messages)}")

    for i, msg in enumerate(todo_list_messages):
        trigger = msg['data'].get('update_trigger')
        todo_list = msg['data'].get('todo_list', {})
        print(f"  {i+1}. {trigger} - Progress: {todo_list.get('progress_percentage', 0):.1f}%")

    return task_manager, stream_service, mock_room


if __name__ == "__main__":
    asyncio.run(test_todo_list_functionality())