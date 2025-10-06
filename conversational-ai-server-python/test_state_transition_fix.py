"""
Test script to verify state transition detection and hallucinated deliverable rejection.
"""
import sys
import os

# Add the project root to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from message_processing.input_gate import InputGate
from message_processing.stream_service import StreamService
from message_processing.task_manager import TaskManager
from message_processing.state_machine import StateMachine
from message_processing.plan_loader import load_state_machine_plan


def test_state_transition_detection():
    """Test that state transitions are properly detected and signaled."""
    print("\n" + "="*80)
    print("TEST 1: State Transition Detection")
    print("="*80)

    # Load the cognitive stimulation plan and create state machine directly
    plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
    state_machine = StateMachine(plan)
    state_machine.start()

    # Create a minimal task manager
    class MinimalTaskManager:
        def __init__(self, state_machine):
            self.state_machine = state_machine
            self.plan_execution = None

        def is_state_machine_mode(self):
            return self.state_machine is not None

        def is_legacy_mode(self):
            return self.plan_execution is not None

    task_manager = MinimalTaskManager(state_machine)

    # Create input gate
    stream_service = StreamService()
    input_gate = InputGate(stream_service, task_manager=task_manager)

    # Verify initial state
    current_state = task_manager.state_machine.execution_state.current_state
    print(f"✓ Initial state: {current_state.title}")
    print(f"✓ Initial state ID: {current_state.id}")
    print(f"✓ InputGate previous_state_id: {input_gate.previous_state_id}")

    # Build user message (this should set previous_state_id)
    user_message = input_gate._build_state_machine_user_message(
        "I like going for runs",
        "user: My family\nassistant: Do you have siblings?"
    )

    print(f"\n✓ After first message build:")
    print(f"  - InputGate previous_state_id: {input_gate.previous_state_id}")
    print(f"  - Should be 'introduction': {input_gate.previous_state_id == 'introduction'}")

    # Simulate state transition by completing all introduction tasks
    print(f"\n✓ Simulating completion of all introduction tasks...")
    for task in current_state.tasks:
        for deliverable in task.deliverables:
            task_manager.state_machine.execution_state.set_deliverable_value_sync(
                deliverable.key, "test_value", "test", 0.95, "test reason"
            )
            task_manager.state_machine.execution_state.complete_task(task.id)

    # Advance to next state
    task_manager.state_machine.execution_state.advance_to_next_state()

    new_state = task_manager.state_machine.execution_state.current_state
    print(f"✓ Advanced to new state: {new_state.title}")
    print(f"✓ New state ID: {new_state.id}")
    print(f"✓ Should be memory_game: {new_state.id == 'memory_game'}")

    # Build user message again - should detect transition
    user_message_with_transition = input_gate._build_state_machine_user_message(
        "no really. St. Gallen is super hilly",
        "user: I like going for runs\nassistant: Do you have favorite routes?"
    )

    print(f"\n✓ Checking for transition warning in message:")
    has_transition_warning = "🚨 CRITICAL STATE TRANSITION DETECTED 🚨" in user_message_with_transition
    print(f"  - Has transition warning: {has_transition_warning}")
    print(f"  - Has MANDATORY ACTION: {'⚠️ MANDATORY ACTION REQUIRED ⚠️' in user_message_with_transition}")

    if has_transition_warning:
        print("\n✅ TEST 1 PASSED: State transition properly detected!")
    else:
        print("\n❌ TEST 1 FAILED: State transition not detected!")
        print("\nUser message preview:")
        print(user_message_with_transition[:500])

    return has_transition_warning


def test_hallucinated_deliverable_rejection():
    """Test that hallucinated deliverables are rejected."""
    print("\n" + "="*80)
    print("TEST 2: Hallucinated Deliverable Rejection")
    print("="*80)

    # Load the cognitive stimulation plan and create state machine directly
    plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
    state_machine = StateMachine(plan)
    state_machine.start()

    # Create a minimal task manager
    class MinimalTaskManager:
        def __init__(self, state_machine):
            self.state_machine = state_machine
            self.plan_execution = None

        def is_state_machine_mode(self):
            return self.state_machine is not None

        def is_legacy_mode(self):
            return self.plan_execution is not None

    task_manager = MinimalTaskManager(state_machine)

    # Complete introduction and advance to memory_game
    current_state = task_manager.state_machine.execution_state.current_state
    for task in current_state.tasks:
        for deliverable in task.deliverables:
            task_manager.state_machine.execution_state.set_deliverable_value_sync(
                deliverable.key, "test_value", "test", 0.95, "test reason"
            )
            task_manager.state_machine.execution_state.complete_task(task.id)

    task_manager.state_machine.execution_state.advance_to_next_state()
    new_state = task_manager.state_machine.execution_state.current_state
    print(f"✓ Current state: {new_state.title}")
    print(f"✓ State ID: {new_state.id}")

    # Get valid deliverables for this state
    valid_keys = set()
    for task in new_state.tasks:
        for deliverable in task.deliverables:
            valid_keys.add(deliverable.key)

    print(f"✓ Valid deliverable keys: {valid_keys}")

    # Create input gate
    stream_service = StreamService()
    input_gate = InputGate(stream_service, task_manager=task_manager)

    # Simulate LLM hallucinating a deliverable
    hallucinated_deliverables = {
        "user_running_preference": {
            "value": "flat routes",
            "reasoning": "User explicitly stated a preference for running on flat terrain"
        },
        "shopping_list_1": {
            "value": "milk",
            "reasoning": "User mentioned milk"
        }
    }

    print(f"\n✓ Testing validation with deliverables:")
    print(f"  - user_running_preference (hallucinated)")
    print(f"  - shopping_list_1 (valid)")

    # Validate deliverables
    validated = input_gate._validate_deliverables_not_greetings(
        hallucinated_deliverables,
        "no really. St. Gallen is super hilly"
    )

    print(f"\n✓ Validation results:")
    print(f"  - Validated deliverables: {list(validated.keys())}")
    print(f"  - Should only contain 'shopping_list_1': {list(validated.keys()) == ['shopping_list_1']}")

    hallucinated_rejected = "user_running_preference" not in validated
    valid_accepted = "shopping_list_1" in validated

    if hallucinated_rejected and valid_accepted:
        print("\n✅ TEST 2 PASSED: Hallucinated deliverable rejected, valid one accepted!")
    else:
        print("\n❌ TEST 2 FAILED:")
        if not hallucinated_rejected:
            print("  - Hallucinated deliverable was NOT rejected!")
        if not valid_accepted:
            print("  - Valid deliverable was NOT accepted!")

    return hallucinated_rejected and valid_accepted


def test_conversation_stage_removed():
    """Test that CONVERSATION STAGE is removed for state machine mode."""
    print("\n" + "="*80)
    print("TEST 3: CONVERSATION STAGE Removed for State Machine Mode")
    print("="*80)

    # Load the cognitive stimulation plan and create state machine directly
    plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
    state_machine = StateMachine(plan)
    state_machine.start()

    # Create a minimal task manager
    class MinimalTaskManager:
        def __init__(self, state_machine):
            self.state_machine = state_machine
            self.plan_execution = None

        def is_state_machine_mode(self):
            return self.state_machine is not None

        def is_legacy_mode(self):
            return self.plan_execution is not None

    task_manager = MinimalTaskManager(state_machine)

    # Create input gate
    stream_service = StreamService()
    input_gate = InputGate(stream_service, task_manager=task_manager)

    # Build user message
    user_message = input_gate._build_state_machine_user_message(
        "Hi there!",
        ""
    )

    print(f"✓ Checking user message content:")
    has_conversation_stage = "CONVERSATION STAGE:" in user_message
    has_current_state = "CURRENT STATE:" in user_message

    print(f"  - Has 'CONVERSATION STAGE:': {has_conversation_stage}")
    print(f"  - Has 'CURRENT STATE:': {has_current_state}")

    if not has_conversation_stage and has_current_state:
        print("\n✅ TEST 3 PASSED: CONVERSATION STAGE removed, CURRENT STATE shown!")
    else:
        print("\n❌ TEST 3 FAILED:")
        if has_conversation_stage:
            print("  - Still has CONVERSATION STAGE!")
        if not has_current_state:
            print("  - Missing CURRENT STATE!")
        print("\nUser message preview:")
        print(user_message[:500])

    return not has_conversation_stage and has_current_state


if __name__ == "__main__":
    print("\n" + "="*80)
    print("STATE TRANSITION FIX VERIFICATION TESTS")
    print("="*80)

    results = []

    try:
        results.append(("State Transition Detection", test_state_transition_detection()))
    except Exception as e:
        print(f"\n❌ TEST 1 ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("State Transition Detection", False))

    try:
        results.append(("Hallucinated Deliverable Rejection", test_hallucinated_deliverable_rejection()))
    except Exception as e:
        print(f"\n❌ TEST 2 ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Hallucinated Deliverable Rejection", False))

    try:
        results.append(("CONVERSATION STAGE Removed", test_conversation_stage_removed()))
    except Exception as e:
        print(f"\n❌ TEST 3 ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("CONVERSATION STAGE Removed", False))

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