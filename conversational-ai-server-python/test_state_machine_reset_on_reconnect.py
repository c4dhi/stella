"""
Test that state machine resets properly when user reconnects.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from message_processing.task_manager import TaskManager

def test_state_machine_reset():
    """Test that creating a new TaskManager gives a fresh, unstarted state machine."""
    print("\n" + "="*80)
    print("TEST: State Machine Reset on TaskManager Creation")
    print("="*80)

    # Simulate initial TaskManager (like on first connection)
    print("\n✓ Step 1: Create initial TaskManager (simulating first connection)")
    tm1 = TaskManager()

    print(f"  - Is state machine mode: {tm1.is_state_machine_mode()}")
    if tm1.is_state_machine_mode():
        is_started_1 = tm1.state_machine.execution_state.is_started
        current_state_1 = tm1.state_machine.execution_state.current_state
        print(f"  - State machine is_started: {is_started_1}")
        print(f"  - Current state: {current_state_1}")
        print(f"  - Is first interaction: {tm1.is_first_interaction()}")

    # Start the state machine (simulating first message)
    print(f"\n✓ Step 2: Initialize first step (simulating first user message)")
    success = tm1.initialize_first_step()
    print(f"  - Initialization successful: {success}")

    if tm1.is_state_machine_mode():
        is_started_after_init = tm1.state_machine.execution_state.is_started
        current_state_after_init = tm1.state_machine.execution_state.current_state
        print(f"  - State machine is_started: {is_started_after_init}")
        print(f"  - Current state: {current_state_after_init.title if current_state_after_init else 'None'}")
        print(f"  - Current state ID: {tm1.state_machine.execution_state.current_state_id}")

    # Note: We don't simulate progress here because we just want to verify
    # that the state machine was started
    print(f"\n✓ Step 3: Verify first TaskManager is started and has state")
    if tm1.is_state_machine_mode() and tm1.state_machine.execution_state.current_state:
        state = tm1.state_machine.execution_state.current_state
        print(f"  - Working on state: {state.title}")

    progress_1 = tm1.get_progress_summary()
    print(f"  - Progress: {progress_1['progress']['percentage']:.1f}%")

    # Simulate disconnect and create new TaskManager (like after reconnection)
    print(f"\n✓ Step 4: Create new TaskManager (simulating disconnect/reconnect)")
    tm2 = TaskManager()

    print(f"  - Is state machine mode: {tm2.is_state_machine_mode()}")
    if tm2.is_state_machine_mode():
        is_started_2 = tm2.state_machine.execution_state.is_started
        current_state_2 = tm2.state_machine.execution_state.current_state
        is_first_interaction_2 = tm2.is_first_interaction()

        print(f"  - State machine is_started: {is_started_2}")
        print(f"  - Current state: {current_state_2}")
        print(f"  - Is first interaction: {is_first_interaction_2}")

        # Check progress
        progress_2 = tm2.get_progress_summary()
        print(f"  - Progress: {progress_2['progress']['percentage']:.1f}%")

    # Verify reset conditions
    print(f"\n✓ Step 5: Verify reset conditions")

    checks = []

    if tm2.is_state_machine_mode():
        # Check 1: New state machine should NOT be started
        check_not_started = not tm2.state_machine.execution_state.is_started
        checks.append(("State machine not started", check_not_started))
        print(f"  - State machine not started: {check_not_started}")

        # Check 2: Should be first interaction
        check_is_first = tm2.is_first_interaction()
        checks.append(("Is first interaction", check_is_first))
        print(f"  - Is first interaction: {check_is_first}")

        # Check 3: Current state should be None
        check_no_state = tm2.state_machine.execution_state.current_state is None
        checks.append(("No current state", check_no_state))
        print(f"  - No current state: {check_no_state}")

        # Check 4: Progress should be 0%
        progress_2 = tm2.get_progress_summary()
        check_zero_progress = progress_2['progress']['percentage'] == 0.0
        checks.append(("Progress is 0%", check_zero_progress))
        print(f"  - Progress is 0%: {check_zero_progress}")

        # Check 5: Deliverable states should be reset
        deliverable_count = len(tm2.state_machine.execution_state.deliverable_states)
        has_deliverables = deliverable_count > 0
        checks.append(("Has deliverable states defined", has_deliverables))
        print(f"  - Has {deliverable_count} deliverable states defined: {has_deliverables}")

        # Check that deliverables are in pending state
        if has_deliverables:
            from message_processing.plan_models import DeliverableStatus
            all_pending = all(
                d.status == DeliverableStatus.PENDING
                for d in tm2.state_machine.execution_state.deliverable_states.values()
            )
            checks.append(("All deliverables pending", all_pending))
            print(f"  - All deliverables pending: {all_pending}")

    # Summary
    all_passed = all(passed for _, passed in checks)

    print(f"\n{'='*80}")
    print(f"TEST RESULTS:")
    print(f"{'='*80}")

    for check_name, passed in checks:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {check_name}")

    print(f"{'='*80}")
    if all_passed:
        print("🎉 ALL CHECKS PASSED - State machine resets properly!")
    else:
        print("⚠️  SOME CHECKS FAILED")
    print(f"{'='*80}\n")

    return all_passed


if __name__ == "__main__":
    print("\n" + "="*80)
    print("STATE MACHINE RESET ON RECONNECT - VERIFICATION TEST")
    print("="*80)

    try:
        result = test_state_machine_reset()
        sys.exit(0 if result else 1)
    except Exception as e:
        print(f"\n❌ TEST ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)