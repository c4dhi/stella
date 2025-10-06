"""
Test that participant disconnect properly resets the todo list.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from message_processing.processor import MessageProcessor
from message_processing.stream_service import StreamService
from message_processing.task_manager import TaskManager
from unittest.mock import AsyncMock, MagicMock

async def test_disconnect_reset():
    """Test that disconnecting resets conversation and sends fresh todo list."""
    print("\n" + "="*80)
    print("TEST: Participant Disconnect Resets Todo List")
    print("="*80)

    # Create mock room
    mock_room = MagicMock()
    mock_room.name = "test_room"

    # Create stream service with mock
    stream_service = StreamService(mock_room)
    stream_service.send_decision_stream = AsyncMock(return_value=True)
    stream_service.send_complete_todo_list = AsyncMock(return_value=True)

    # Create processor
    processor = MessageProcessor(stream_service)

    # Simulate some conversation history
    processor.conversation_history.append({
        "role": "user",
        "content": "Test message 1",
        "timestamp": 123.0
    })
    processor.conversation_history.append({
        "role": "assistant",
        "content": "Test response 1",
        "timestamp": 124.0
    })

    print(f"✓ Initial state:")
    print(f"  - Conversation history: {len(processor.conversation_history)} messages")

    # Get initial task manager plan ID
    initial_plan_id = None
    if processor.task_manager.is_state_machine_mode():
        initial_plan_id = processor.task_manager.state_machine.execution_state.plan.id
        print(f"  - Plan ID: {initial_plan_id}")

    # Trigger disconnect
    print(f"\n✓ Calling reset_conversation_history('test_participant')...")
    processor.reset_conversation_history("test_participant")

    # Wait a moment for async tasks
    import asyncio
    await asyncio.sleep(0.1)

    # Check results
    print(f"\n✓ After reset:")
    print(f"  - Conversation history: {len(processor.conversation_history)} messages")
    print(f"  - History cleared: {len(processor.conversation_history) == 0}")

    # Check that send_complete_todo_list was called
    todo_list_called = stream_service.send_complete_todo_list.called
    print(f"  - send_complete_todo_list called: {todo_list_called}")

    if todo_list_called:
        # Get the call arguments
        call_args = stream_service.send_complete_todo_list.call_args
        todo_list_data = call_args.kwargs.get('todo_list_data') or call_args[0][0]
        update_trigger = call_args.kwargs.get('update_trigger', 'unknown')
        participant_id = call_args.kwargs.get('participant_id', 'unknown')

        print(f"  - Update trigger: {update_trigger}")
        print(f"  - Participant ID: {participant_id}")

        # Check todo list structure
        has_todo_list_field = 'todo_list' in todo_list_data
        has_metadata_field = 'metadata' in todo_list_data

        print(f"  - Has 'todo_list' field: {has_todo_list_field}")
        print(f"  - Has 'metadata' field: {has_metadata_field}")

        if has_todo_list_field:
            todo_list = todo_list_data['todo_list']
            print(f"  - Todo list progress: {todo_list.get('progress_percentage', 0)}%")
            print(f"  - Current state: {todo_list.get('current_state', {}).get('title', 'None')}")

        # Verify it's participant_disconnected trigger
        correct_trigger = update_trigger == "participant_disconnected"
        correct_participant = participant_id == "test_participant"

        print(f"\n✓ Validation:")
        print(f"  - History cleared: {len(processor.conversation_history) == 0}")
        print(f"  - Todo list sent: {todo_list_called}")
        print(f"  - Correct trigger: {correct_trigger}")
        print(f"  - Correct participant: {correct_participant}")

        all_passed = (
            len(processor.conversation_history) == 0 and
            todo_list_called and
            correct_trigger and
            correct_participant and
            has_todo_list_field and
            has_metadata_field
        )

        if all_passed:
            print("\n✅ TEST PASSED: Disconnect properly resets and sends fresh todo list!")
            return True
        else:
            print("\n❌ TEST FAILED: Some checks did not pass")
            return False
    else:
        print("\n❌ TEST FAILED: send_complete_todo_list was not called")
        return False

if __name__ == "__main__":
    import asyncio

    print("\n" + "="*80)
    print("DISCONNECT RESET TEST")
    print("="*80)

    try:
        result = asyncio.run(test_disconnect_reset())
        sys.exit(0 if result else 1)
    except Exception as e:
        print(f"\n❌ TEST ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)