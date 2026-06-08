#!/usr/bin/env python3
"""
Test script for the State Machine gRPC service.

This script tests the StateMachineClient by:
1. Initializing a state machine with a plan
2. Getting current state
3. Setting a deliverable
4. Completing a task
5. Checking progress

Prerequisites:
- session-management-server running on localhost:50052
- PostgreSQL database running
"""

import asyncio
import sys
sys.path.insert(0, '/Users/felixmoser/Github/stella-workspace/stella-backend/agents/stella-ai-agent-sdk/src')

from stella_agent_sdk.services.state_machine_client import StateMachineClient


# Simple test plan
TEST_PLAN = {
    "id": "test_plan",
    "title": "Test Plan",
    "states": [
        {
            "id": "greeting",
            "title": "Greeting State",
            "type": "loose",
            "tasks": [
                {
                    "id": "collect_name",
                    "description": "Collect user's name",
                    "deliverables": [
                        {
                            "key": "user_name",
                            "description": "User's name",
                            "type": "string",
                            "required": True
                        }
                    ]
                },
                {
                    "id": "say_hello",
                    "description": "Say hello to the user"
                }
            ],
            "transitions": [
                {
                    "target": "farewell",
                    "condition": "all_tasks_complete"
                }
            ]
        },
        {
            "id": "farewell",
            "title": "Farewell State",
            "type": "strict",
            "tasks": [
                {
                    "id": "say_goodbye",
                    "description": "Say goodbye"
                }
            ]
        }
    ]
}


async def test_state_machine():
    """Run state machine tests."""
    session_id = "test_session_001"

    print("=" * 60)
    print("State Machine gRPC Client Test")
    print("=" * 60)

    # Create client
    client = StateMachineClient(
        session_id=session_id,
        address="localhost:50052"
    )

    try:
        # Connect to gRPC server
        print("\nConnecting to gRPC server...")
        await client.connect()
        print("  ✓ Connected")

        # Test 1: Initialize
        print("\n[Test 1] Initialize state machine...")
        result = await client.initialize(TEST_PLAN)
        print(f"  Result: {result}")
        assert result.get("success"), f"Initialize failed: {result}"
        print("  ✓ Initialize successful")

        # Test 2: Get current state
        print("\n[Test 2] Get current state...")
        state = await client.get_current_state()
        print(f"  State: {state}")
        assert state is not None, "State is None"
        assert state.get("state_id") == "greeting", f"Expected 'greeting', got {state.get('state_id')}"
        print(f"  ✓ Current state: {state.get('title')} ({state.get('state_id')})")

        # Test 3: Get pending tasks
        print("\n[Test 3] Get pending tasks...")
        tasks = await client.get_pending_tasks()
        print(f"  Tasks: {tasks}")
        assert len(tasks) == 2, f"Expected 2 tasks, got {len(tasks)}"
        print(f"  ✓ Found {len(tasks)} pending tasks")

        # Test 4: Get pending deliverables
        print("\n[Test 4] Get pending deliverables...")
        deliverables = await client.get_pending_deliverables()
        print(f"  Deliverables: {deliverables}")
        assert len(deliverables) == 1, f"Expected 1 deliverable, got {len(deliverables)}"
        print(f"  ✓ Found {len(deliverables)} pending deliverables")

        # Test 5: Set deliverable
        print("\n[Test 5] Set deliverable 'user_name'...")
        result = await client.set_deliverable(
            key="user_name",
            value="Alice",
            reasoning="User said 'My name is Alice'"
        )
        print(f"  Result: {result}")
        assert result.get("success"), f"Set deliverable failed: {result}"
        print(f"  ✓ Deliverable set, task_completed: {result.get('task_completed')}")

        # Test 6: Complete task (say_hello)
        print("\n[Test 6] Complete task 'say_hello'...")
        result = await client.complete_task(
            task_id="say_hello",
            reasoning="Said hello to the user"
        )
        print(f"  Result: {result}")
        assert result.get("success"), f"Complete task failed: {result}"
        print(f"  ✓ Task completed, transitioned: {result.get('transitioned')}")

        # Test 7: Check state transition
        print("\n[Test 7] Check state after completing all tasks...")
        state = await client.get_current_state()
        print(f"  State: {state}")
        # Should have transitioned to farewell
        assert state.get("state_id") == "farewell", f"Expected 'farewell', got {state.get('state_id')}"
        print(f"  ✓ Transitioned to: {state.get('title')} ({state.get('state_id')})")

        # Test 8: Get collected deliverables
        print("\n[Test 8] Get collected deliverables...")
        collected = await client.get_collected_deliverables()
        print(f"  Collected: {collected}")
        assert "user_name" in collected, "user_name not in collected deliverables"
        print(f"  ✓ Collected deliverables: {list(collected.keys())}")

        print("\n" + "=" * 60)
        print("All tests passed! ✓")
        print("=" * 60)

    except Exception as e:
        print(f"\n✗ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        await client.disconnect()

    return True


if __name__ == "__main__":
    success = asyncio.run(test_state_machine())
    sys.exit(0 if success else 1)
