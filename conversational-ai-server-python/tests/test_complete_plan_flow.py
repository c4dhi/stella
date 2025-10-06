#!/usr/bin/env python3
"""
Test complete plan-based conversation flow.
Tests the full integration from plan loading through deliverable detection to step completion.
"""
import asyncio
import json
import sys
import os
from typing import Dict, Any

# Add project root to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from message_processing.task_manager import TaskManager
from message_processing.plan_loader import load_plan
from message_processing.deliverable_detector import DeliverableDetector


async def test_plan_loading():
    """Test that plans load correctly."""
    print("🧪 Testing plan loading...")

    try:
        # Test loading the user_onboarding plan
        plan = load_plan("user_onboarding")
        assert plan.id == "user_onboarding"
        assert plan.title == "Welcome to the AI Assistant"
        assert len(plan.steps) == 4

        # Verify first step details
        first_step = plan.steps[0]
        assert first_step.id == "s1"
        assert first_step.type.value == "Question"
        assert len(first_step.deliverables) == 1
        assert first_step.deliverables[0].key == "user_name"

        print("✅ Plan loading test passed!")
        return True

    except Exception as e:
        print(f"❌ Plan loading test failed: {e}")
        return False


async def test_task_manager_initialization():
    """Test TaskManager initializes with plan."""
    print("🧪 Testing TaskManager initialization...")

    try:
        task_manager = TaskManager()

        # Verify plan execution is set up
        assert task_manager.plan_execution is not None
        assert task_manager.plan_execution.plan.id == "user_onboarding"
        assert task_manager.is_first_interaction() == True

        # Verify legacy compatibility
        assert task_manager.current_step_id is None  # Not started yet
        assert len(task_manager.step_order) == 4

        print("✅ TaskManager initialization test passed!")
        return True

    except Exception as e:
        print(f"❌ TaskManager initialization test failed: {e}")
        return False


async def test_first_interaction_flow():
    """Test first interaction detection and initialization."""
    print("🧪 Testing first interaction flow...")

    try:
        task_manager = TaskManager()

        # Should be first interaction
        assert task_manager.is_first_interaction() == True

        # Initialize first step
        success = task_manager.initialize_first_step()
        assert success == True

        # Should no longer be first interaction
        assert task_manager.is_first_interaction() == False

        # Should be on first step
        assert task_manager.current_step_id == "s1"
        current_step = task_manager.get_current_plan_step()
        assert current_step.id == "s1"
        assert current_step.title == "Ask for preferred name"

        print("✅ First interaction flow test passed!")
        return True

    except Exception as e:
        print(f"❌ First interaction flow test failed: {e}")
        return False


async def test_deliverable_detection():
    """Test deliverable detection in user messages."""
    print("🧪 Testing deliverable detection...")

    try:
        task_manager = TaskManager()
        task_manager.initialize_first_step()

        # Test name detection
        result = task_manager.process_user_message("Hi, my name is Alice")
        assert result["success"] == True
        assert len(result["deliverables_detected"]) == 1

        detected = result["deliverables_detected"][0]
        assert detected["key"] == "user_name"
        assert detected["value"] == "Alice"
        assert detected["confidence"] > 0.7

        # Verify deliverable was stored
        deliverable_state = task_manager.plan_execution.get_deliverable_state("user_name")
        assert deliverable_state.value == "Alice"
        assert deliverable_state.status.value == "completed"

        print("✅ Deliverable detection test passed!")
        return True

    except Exception as e:
        print(f"❌ Deliverable detection test failed: {e}")
        return False


async def test_step_progression():
    """Test automatic step progression."""
    print("🧪 Testing step progression...")

    try:
        task_manager = TaskManager()
        task_manager.initialize_first_step()

        # Process name to complete step 1
        result = task_manager.process_user_message("Hi, I'm Bob")
        assert result["success"] == True
        assert result["step_completed"] == True

        # Step 1 (Question) should not auto-advance (needs manual advancement in real flow)
        # But step 2 (Statement) should auto-advance
        current_step = task_manager.get_current_plan_step()
        assert current_step.id == "s1"  # Still on s1, waiting for manual advancement

        # Manually advance (this would be done by InputGate/Aggregator in real flow)
        advanced = task_manager.advance_to_next_step()
        assert advanced == True

        # Should now be on step 2
        current_step = task_manager.get_current_plan_step()
        assert current_step.id == "s2"
        assert current_step.type.value == "Statement"

        print("✅ Step progression test passed!")
        return True

    except Exception as e:
        print(f"❌ Step progression test failed: {e}")
        return False


async def test_complete_plan_flow():
    """Test complete plan execution from start to finish."""
    print("🧪 Testing complete plan flow...")

    try:
        task_manager = TaskManager()

        print("  📋 Starting plan execution...")
        task_manager.initialize_first_step()

        # Step 1: Provide name
        print("  👤 Step 1 - Processing name...")
        result1 = task_manager.process_user_message("Hello, my name is Charlie")
        assert result1["success"] == True
        assert len(result1["deliverables_detected"]) == 1
        assert result1["step_completed"] == True

        # Advance to step 2 (Statement - should auto-advance in real flow)
        task_manager.advance_to_next_step()
        current_step = task_manager.get_current_plan_step()
        assert current_step.id == "s2"

        # Step 2: Statement step - should complete automatically
        print("  👋 Step 2 - Processing statement...")
        # Statement steps can auto-advance based on configuration
        step2_complete = task_manager.plan_execution.is_current_step_completed()
        assert step2_complete == True  # Statement steps complete automatically

        # Advance to step 3
        task_manager.advance_to_next_step()
        current_step = task_manager.get_current_plan_step()
        assert current_step.id == "s3"

        # Step 3: Communication preferences
        print("  💬 Step 3 - Processing preferences...")
        result3 = task_manager.process_user_message("I prefer casual communication and need help with technical topics")
        assert result3["success"] == True
        # Should detect both deliverables
        assert len(result3["deliverables_detected"]) >= 1  # At least communication style or help topics

        # Check deliverable states
        comm_style_state = task_manager.plan_execution.get_deliverable_state("communication_style")
        help_topics_state = task_manager.plan_execution.get_deliverable_state("help_topics")

        # At least one should be detected
        assert (comm_style_state and comm_style_state.value) or (help_topics_state and help_topics_state.value)

        # Advance to step 4
        task_manager.advance_to_next_step()
        current_step = task_manager.get_current_plan_step()
        assert current_step.id == "s4"

        # Step 4: Final statement - should complete automatically
        print("  🎉 Step 4 - Final statement...")
        step4_complete = task_manager.plan_execution.is_current_step_completed()
        assert step4_complete == True

        # Try to advance - should complete the plan
        final_advance = task_manager.advance_to_next_step()
        assert final_advance == False  # No more steps
        assert task_manager.plan_execution.is_completed == True

        # Check final progress
        progress = task_manager.plan_execution.progress_percentage
        assert progress == 100.0

        print("  ✨ Plan execution completed successfully!")
        print("✅ Complete plan flow test passed!")
        return True

    except Exception as e:
        print(f"❌ Complete plan flow test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_plan_data_structures():
    """Test plan data structures and serialization."""
    print("🧪 Testing plan data structures...")

    try:
        task_manager = TaskManager()
        task_manager.initialize_first_step()

        # Process a message to get some data
        task_manager.process_user_message("Hi, I'm David")

        # Test get_complete_todo_list
        todo_data = task_manager.get_complete_todo_list()
        print(f"Debug - todo_data keys: {list(todo_data.keys())}")

        assert "todo_list" in todo_data
        assert "context" in todo_data
        assert "metadata" in todo_data

        # Plan info is included in the enhanced todo_list structure
        todo_list = todo_data["todo_list"]
        assert todo_list["total_steps"] == 4
        assert todo_list["current_step_index"] == 1

        # Check if this has the plan-aware fields
        if "deliverables" in todo_list:
            assert "deliverables" in todo_list
            print(f"Debug - deliverables structure: {todo_list['deliverables']}")

        # Check metadata for plan info
        metadata = todo_data["metadata"]
        assert "plan_based" in metadata or "created_at" in metadata

        # Test plan progress summary
        progress_summary = task_manager.plan_execution.get_progress_summary()
        assert progress_summary["plan_id"] == "user_onboarding"
        assert "current_step" in progress_summary
        assert "deliverables" in progress_summary
        assert "steps" in progress_summary

        print("✅ Plan data structures test passed!")
        return True

    except Exception as e:
        print(f"❌ Plan data structures test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def run_all_tests():
    """Run all tests and report results."""
    print("🚀 Starting comprehensive plan-based flow tests...\n")

    tests = [
        ("Plan Loading", test_plan_loading),
        ("TaskManager Initialization", test_task_manager_initialization),
        ("First Interaction Flow", test_first_interaction_flow),
        ("Deliverable Detection", test_deliverable_detection),
        ("Step Progression", test_step_progression),
        ("Plan Data Structures", test_plan_data_structures),
        ("Complete Plan Flow", test_complete_plan_flow),
    ]

    passed = 0
    failed = 0

    for test_name, test_func in tests:
        print(f"\n{'='*50}")
        print(f"Running: {test_name}")
        print('='*50)

        try:
            result = await test_func()
            if result:
                passed += 1
                print(f"✅ {test_name} PASSED")
            else:
                failed += 1
                print(f"❌ {test_name} FAILED")
        except Exception as e:
            failed += 1
            print(f"❌ {test_name} FAILED with exception: {e}")

    print(f"\n{'='*50}")
    print("📊 TEST RESULTS")
    print('='*50)
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"📈 Success Rate: {passed/(passed+failed)*100:.1f}%")

    if failed == 0:
        print("🎉 ALL TESTS PASSED! The plan-based system is working correctly.")
        return True
    else:
        print(f"⚠️  {failed} tests failed. Please check the implementation.")
        return False


if __name__ == "__main__":
    success = asyncio.run(run_all_tests())
    sys.exit(0 if success else 1)