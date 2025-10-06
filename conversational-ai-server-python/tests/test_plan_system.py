"""
Test script for the plan system functionality.
This tests the plan loading, state management, and step execution.
"""
import asyncio
import json
from pathlib import Path
from message_processing.plan_state_manager import (
    PlanStateManager, Plan, Step, Deliverable,
    PlanState, StepType, DeliverableType
)
from message_processing.plan_service import PlanService
from message_processing.stream_service import StreamService
from livekit import rtc


class MockRoom:
    """Mock room for testing."""
    def __init__(self):
        self.local_participant = MockParticipant()

class MockParticipant:
    """Mock participant for testing."""
    async def publish_data(self, data, reliable=True):
        # Just print the message for testing
        try:
            message = json.loads(data.decode('utf-8'))
            print(f"[MOCK_SEND] {message['type']}: {message.get('data', {})}")
            return True
        except Exception as e:
            print(f"[MOCK_SEND_ERROR] {e}")
            return False


async def test_plan_loading():
    """Test plan loading from JSON files."""
    print("\n=== Testing Plan Loading ===")

    # Create mock room and stream service
    mock_room = MockRoom()
    stream_service = StreamService(mock_room)

    # Create plan service
    plan_service = PlanService(stream_service, plans_dir="plans")

    # Test loading available plans
    plans = plan_service.get_available_plans()
    print(f"Available plans: {len(plans)}")
    for plan in plans:
        print(f"  - {plan['id']}: {plan['title']} ({plan['steps_count']} steps)")

    # Test loading specific plan
    plan = plan_service.load_plan("user_onboarding")
    if plan:
        print(f"Loaded plan: {plan.title}")
        print(f"Steps: {len(plan.steps)}")
        for i, step in enumerate(plan.steps):
            print(f"  Step {i+1}: {step.title} ({step.type.value})")
            for deliv in step.deliverables:
                print(f"    - {deliv.key} ({deliv.type.value}, required: {deliv.required})")
    else:
        print("Failed to load plan!")

    return plan_service


async def test_state_management():
    """Test plan state management."""
    print("\n=== Testing State Management ===")

    state_manager = PlanStateManager()

    # Create a simple test plan
    plan = Plan(
        id="test_plan",
        title="Test Plan",
        description="A simple test plan",
        steps=[
            Step(
                id="s1",
                type=StepType.QUESTION,
                title="Ask name",
                instruction="What's your name?",
                deliverables=[
                    Deliverable(
                        key="name",
                        type=DeliverableType.STRING,
                        required=True,
                        description="User's name"
                    )
                ]
            ),
            Step(
                id="s2",
                type=StepType.STATEMENT,
                title="Welcome",
                instruction="Welcome the user",
                deliverables=[]
            )
        ]
    )

    # Create session
    session_id = state_manager.create_session(plan)
    print(f"Created session: {session_id}")

    # Start plan
    success = state_manager.start_plan(session_id)
    print(f"Started plan: {success}")

    # Get current step
    current_step = state_manager.get_current_step(session_id)
    print(f"Current step: {current_step.title if current_step else 'None'}")

    # Process user input
    result = state_manager.process_user_input(session_id, "My name is John", "text")
    print(f"Input processing result: {result}")

    # Get progress
    progress = state_manager.get_plan_progress(session_id)
    print(f"Progress: {progress['progress']['percentage']:.1f}%")

    return state_manager, session_id


async def test_plan_service_integration():
    """Test full plan service integration."""
    print("\n=== Testing Plan Service Integration ===")

    # Create mock room and stream service
    mock_room = MockRoom()
    stream_service = StreamService(mock_room)

    # Create plan service
    plan_service = PlanService(stream_service, plans_dir="plans")

    # Start a plan
    session_id = await plan_service.start_plan("user_onboarding")
    print(f"Started plan session: {session_id}")

    if session_id:
        # Simulate user responses
        test_inputs = [
            "My name is Alice",
            "I prefer casual communication",
            "I need help with Python programming"
        ]

        for i, user_input in enumerate(test_inputs):
            print(f"\n--- Processing input {i+1}: '{user_input}' ---")
            result = await plan_service.process_plan_input(session_id, user_input)
            print(f"Result: {result}")

            # Get status
            status = await plan_service.get_plan_status(session_id)
            if status:
                progress = status["progress"]
                print(f"Progress: {progress['completed_steps']}/{progress['total_steps']} steps ({progress['percentage']:.1f}%)")

    return plan_service


async def main():
    """Run all tests."""
    print("🚀 Starting Plan System Tests")

    try:
        # Test 1: Plan Loading
        plan_service = await test_plan_loading()

        # Test 2: State Management
        state_manager, session_id = await test_state_management()

        # Test 3: Full Integration
        plan_service = await test_plan_service_integration()

        print("\n✅ All tests completed!")

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())