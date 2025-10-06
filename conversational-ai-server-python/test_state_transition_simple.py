"""
Simple test to verify the state transition fix.
Just tests the key methods without full integration.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from message_processing.input_gate import InputGate

def test_deliverable_validation():
    """Test that hallucinated deliverables are properly rejected."""
    print("\n" + "="*80)
    print("TEST: Hallucinated Deliverable Rejection in _validate_deliverables_not_greetings")
    print("="*80)

    # Create minimal mock objects
    class MockState:
        def __init__(self):
            self.id = "memory_game"
            self.title = "Progressive Memory Challenge"
            self.tasks = [MockTask()]

    class MockTask:
        def __init__(self):
            self.deliverables = [
                MockDeliverable("shopping_list_1"),
                MockDeliverable("shopping_list_2")
            ]

    class MockDeliverable:
        def __init__(self, key):
            self.key = key

    class MockExecutionState:
        def __init__(self):
            self.current_state = MockState()

    class MockStateMachine:
        def __init__(self):
            self.execution_state = MockExecutionState()

    class MockTaskManager:
        def __init__(self):
            self.state_machine = MockStateMachine()
            self.plan_execution = None

        def is_state_machine_mode(self):
            return True

        def is_legacy_mode(self):
            return False

    # Create input gate with mock task manager
    class MockStreamService:
        def generate_stream_id(self):
            return "test_123"

    input_gate = InputGate(MockStreamService(), task_manager=MockTaskManager())

    # Test with hallucinated and valid deliverables
    test_deliverables = {
        "user_running_preference": {
            "value": "flat routes",
            "reasoning": "User explicitly stated preference for flat terrain"
        },
        "shopping_list_1": {
            "value": "milk",
            "reasoning": "User mentioned milk in their response"
        },
        "user_favorite_color": {
            "value": "blue",
            "reasoning": "Completely made up"
        }
    }

    print(f"\n✓ Testing with deliverables:")
    print(f"  - user_running_preference (hallucinated - not in current state)")
    print(f"  - shopping_list_1 (valid - exists in current state)")
    print(f"  - user_favorite_color (hallucinated - not in current state)")

    # Run validation
    validated = input_gate._validate_deliverables_not_greetings(
        test_deliverables,
        "St. Gallen is super hilly"
    )

    print(f"\n✓ Validation results:")
    print(f"  - Validated keys: {list(validated.keys())}")

    # Check results
    hallucinated_1_rejected = "user_running_preference" not in validated
    hallucinated_2_rejected = "user_favorite_color" not in validated
    valid_accepted = "shopping_list_1" in validated

    print(f"\n✓ Validation checks:")
    print(f"  - user_running_preference rejected: {hallucinated_1_rejected}")
    print(f"  - user_favorite_color rejected: {hallucinated_2_rejected}")
    print(f"  - shopping_list_1 accepted: {valid_accepted}")

    if hallucinated_1_rejected and hallucinated_2_rejected and valid_accepted:
        print("\n✅ TEST PASSED: Hallucinated deliverables rejected, valid one accepted!")
        return True
    else:
        print("\n❌ TEST FAILED")
        return False


def test_state_machine_user_message():
    """Test that state machine user messages are built correctly."""
    print("\n" + "="*80)
    print("TEST: State Machine User Message Building")
    print("="*80)

    # Create minimal mocks
    class MockState:
        def __init__(self, id, title):
            self.id = id
            self.title = title
            self.description = "Test state"
            self.type = type("obj", (), {"value": "strict"})()

    class MockPlan:
        def get_state(self, state_id):
            return MockState(state_id, "Previous State")

    class MockExecutionState:
        def __init__(self):
            self.current_state = MockState("memory_game", "Progressive Memory Challenge")
            self.plan = MockPlan()

    class MockStateMachine:
        def __init__(self):
            self.execution_state = MockExecutionState()

    class MockTaskManager:
        def __init__(self):
            self.state_machine = MockStateMachine()

        def is_state_machine_mode(self):
            return True

    class MockStreamService:
        def generate_stream_id(self):
            return "test_123"

    # Create input gate
    input_gate = InputGate(MockStreamService(), task_manager=MockTaskManager())

    # Test 1: First message (no transition)
    print(f"\n✓ Test 1: First message (no previous state)")
    msg1 = input_gate._build_state_machine_user_message("Hi", "")
    has_current_state = "CURRENT STATE: Progressive Memory Challenge" in msg1
    has_conversation_stage = "CONVERSATION STAGE:" in msg1
    has_transition = "🚨 CRITICAL STATE TRANSITION" in msg1

    print(f"  - Has CURRENT STATE: {has_current_state}")
    print(f"  - Has CONVERSATION STAGE: {has_conversation_stage}")
    print(f"  - Has transition warning: {has_transition}")

    test1_pass = has_current_state and not has_conversation_stage and not has_transition

    # Test 2: Second message (state transition)
    print(f"\n✓ Test 2: Second message (with state transition)")
    input_gate.previous_state_id = "introduction"  # Simulate previous state
    msg2 = input_gate._build_state_machine_user_message("I like running", "")
    has_transition_2 = "🚨 CRITICAL STATE TRANSITION" in msg2
    has_mandatory = "⚠️ MANDATORY ACTION REQUIRED ⚠️" in msg2

    print(f"  - Has transition warning: {has_transition_2}")
    print(f"  - Has MANDATORY ACTION: {has_mandatory}")

    test2_pass = has_transition_2 and has_mandatory

    if test1_pass and test2_pass:
        print("\n✅ TEST PASSED: State machine user messages built correctly!")
        return True
    else:
        print("\n❌ TEST FAILED")
        if not test1_pass:
            print("  - Test 1 (no transition) failed")
        if not test2_pass:
            print("  - Test 2 (with transition) failed")
        return False


if __name__ == "__main__":
    print("\n" + "="*80)
    print("STATE TRANSITION FIX - SIMPLE TESTS")
    print("="*80)

    results = []

    try:
        results.append(("Hallucinated Deliverable Rejection", test_deliverable_validation()))
    except Exception as e:
        print(f"\n❌ TEST ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Hallucinated Deliverable Rejection", False))

    try:
        results.append(("State Machine User Message Building", test_state_machine_user_message()))
    except Exception as e:
        print(f"\n❌ TEST ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("State Machine User Message Building", False))

    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)

    for test_name, passed in results:
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{status}: {test_name}")

    all_passed = all(passed for _, passed in results)

    print("\n" + "="*80)
    if all_passed:
        print("🎉 ALL TESTS PASSED!")
    else:
        print("⚠️  SOME TESTS FAILED - Review output above")
    print("="*80 + "\n")

    sys.exit(0 if all_passed else 1)