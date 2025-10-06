#!/usr/bin/env python3
"""
Test script to verify:
1. First message is echoed to frontend
2. Plan data with states/tasks/deliverables is sent on first message
3. Plan updates are sent after subsequent messages
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Dict, Any, List

# Add parent directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

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
            return True
        except Exception as e:
            print(f"[MOCK_ERROR] {e}")
            return False


async def test_first_message_echo_and_plan():
    """Test that first message echoes AND sends complete plan data."""
    print("=" * 70)
    print("🧪 TEST: First Message Echo + Plan Data")
    print("=" * 70)

    # Create processor with mock room
    mock_room = MockRoom()
    mock_room.local_participant.room = mock_room
    processor = MessageProcessor(mock_room, tts_provider="mock")

    print("\n✓ MessageProcessor created")
    print(f"✓ TaskManager loaded plan: {processor.task_manager.state_machine is not None}")

    # Clear any init messages
    mock_room.messages_sent.clear()

    # Send first message
    print("\n" + "=" * 70)
    print("📨 Sending first message: 'Hello'")
    print("=" * 70 + "\n")

    # Set mock LLM response to avoid API calls
    import os
    os.environ['OPENAI_API_KEY'] = 'mock-key-for-testing'

    # Mock the LLM service to return a simple safe response
    from message_processing.llm_service import LLMResponse
    from unittest.mock import AsyncMock, patch

    async def mock_generate(*args, **kwargs):
        # Call the callback if provided to simulate streaming
        callback = kwargs.get('callback')
        mock_response = """VERDICT: [SAFE]
EXPERTS: [NONE]
DELIVERABLES: [NONE]
MESSAGE: Hello! How can I help you today?"""

        if callback:
            for char in mock_response:
                accumulated = mock_response[:mock_response.index(char) + 1]
                await callback.on_token(char, accumulated)
            await callback.on_complete(LLMResponse(content=mock_response, provider="mock"))

        return LLMResponse(content=mock_response, provider="mock")

    with patch.object(processor.input_gate.llm_service, 'generate', new=mock_generate):
        success = await processor.process_message("Hello", "test_user", is_voice_transcription=False)

    print(f"\n✓ Message processing completed: {success}")

    # Analyze messages sent
    print("\n" + "=" * 70)
    print("📊 MESSAGE ANALYSIS")
    print("=" * 70)

    total_messages = len(mock_room.messages_sent)
    print(f"\nTotal messages sent: {total_messages}")

    # Check for transcript echo
    transcript_messages = mock_room.get_messages_by_type('transcript_chunk')
    print(f"\n1. Transcript chunks (echo): {len(transcript_messages)}")
    for msg in transcript_messages:
        data = msg.get('data', {})
        text = data.get('text', '')
        is_final = data.get('is_final', False)
        participant = data.get('participant_id', '')
        print(f"   - '{text[:50]}...' (final: {is_final}, from: {participant})")

    # Check for complete_todo_list messages
    todo_list_messages = mock_room.get_messages_by_type('complete_todo_list')
    print(f"\n2. Complete todo list messages: {len(todo_list_messages)}")
    for i, msg in enumerate(todo_list_messages, 1):
        data = msg.get('data', {})
        trigger = data.get('update_trigger', 'unknown')
        todo_list = data.get('todo_list', {})
        metadata = data.get('metadata', {})

        print(f"\n   Message {i} - Trigger: {trigger}")
        print(f"   - Total states: {todo_list.get('total_states', 0)}")
        print(f"   - Current state: {todo_list.get('current_state', {}).get('title', 'None')}")
        print(f"   - Progress: {todo_list.get('progress_percentage', 0):.1f}%")
        print(f"   - Architecture: {metadata.get('architecture', 'unknown')}")
        print(f"   - States count: {metadata.get('states_count', 0)}")
        print(f"   - Tasks count: {metadata.get('tasks_count', 0)}")
        print(f"   - Deliverables count: {metadata.get('deliverables_count', 0)}")

        # Check for all_deliverable_states
        all_deliverable_states = data.get('all_deliverable_states', {})
        if all_deliverable_states:
            print(f"   - Deliverable states available: {len(all_deliverable_states)} states")

    # Verification
    print("\n" + "=" * 70)
    print("✅ VERIFICATION RESULTS")
    print("=" * 70)

    checks = []

    # Check 1: User message was echoed
    user_echoes = [msg for msg in transcript_messages if msg['data'].get('participant_id') == 'test_user']
    check1 = len(user_echoes) > 0
    checks.append(("User message echoed", check1))
    if check1:
        print("✓ User message was echoed to frontend")
    else:
        print("✗ User message was NOT echoed")

    # Check 2: Plan data was sent on first message
    first_message_plan = [msg for msg in todo_list_messages if msg['data'].get('update_trigger') == 'first_message_plan_start']
    check2 = len(first_message_plan) > 0
    checks.append(("First message plan sent", check2))
    if check2:
        print("✓ Plan data sent with trigger 'first_message_plan_start'")
    else:
        print("✗ No plan data with 'first_message_plan_start' trigger")

    # Check 3: Plan data contains states
    if first_message_plan:
        plan_data = first_message_plan[0]['data']
        total_states = plan_data.get('todo_list', {}).get('total_states', 0)
        check3 = total_states > 0
        checks.append(("Plan contains states", check3))
        if check3:
            print(f"✓ Plan contains {total_states} states")
        else:
            print("✗ Plan has 0 states")
    else:
        checks.append(("Plan contains states", False))
        print("✗ Cannot check states (no plan message)")

    # Check 4: Plan data contains deliverables info
    if first_message_plan:
        plan_data = first_message_plan[0]['data']
        all_deliverable_states = plan_data.get('all_deliverable_states', {})
        check4 = len(all_deliverable_states) > 0
        checks.append(("Plan contains deliverables", check4))
        if check4:
            print(f"✓ Plan contains deliverable states for {len(all_deliverable_states)} states")
        else:
            print("✗ Plan has no deliverable states")
    else:
        checks.append(("Plan contains deliverables", False))
        print("✗ Cannot check deliverables (no plan message)")

    # Check 5: Safe route completed trigger was sent
    safe_route_updates = [msg for msg in todo_list_messages if msg['data'].get('update_trigger') == 'safe_route_completed']
    check5 = len(safe_route_updates) > 0
    checks.append(("Safe route update sent", check5))
    if check5:
        print("✓ Plan update sent with trigger 'safe_route_completed'")
    else:
        print("✗ No plan update with 'safe_route_completed' trigger")

    # Summary
    print("\n" + "=" * 70)
    passed = sum(1 for _, result in checks if result)
    total = len(checks)
    print(f"SUMMARY: {passed}/{total} checks passed")
    print("=" * 70)

    if passed == total:
        print("\n🎉 ALL CHECKS PASSED! The fix is working correctly.")
        return True
    else:
        print("\n❌ SOME CHECKS FAILED")
        for check_name, result in checks:
            status = "✓" if result else "✗"
            print(f"  {status} {check_name}")
        return False


async def main():
    """Run the test."""
    try:
        success = await test_first_message_echo_and_plan()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Test crashed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())