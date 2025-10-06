#!/usr/bin/env python3
"""
Test script to verify acceptance criteria functionality in deliverable collection.
Tests validation rules, examples, and rejection of invalid inputs.
"""
import asyncio
import sys
import os

# Add the project root to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from message_processing.input_gate import InputGate
from message_processing.stream_service import StreamService
from message_processing.task_manager import TaskManager
from message_processing.plan_service import PlanService
from message_processing.llm_service import LLMService
from unittest.mock import Mock, AsyncMock


class MockRoom:
    """Mock LiveKit room for testing."""
    def __init__(self):
        pass


async def test_acceptance_criteria():
    """Test acceptance criteria validation for deliverables."""
    print("\n" + "="*70)
    print("TESTING ACCEPTANCE CRITERIA VALIDATION")
    print("="*70)

    # Create mock room and services
    mock_room = MockRoom()
    stream_service = StreamService(mock_room)

    # Mock all stream service methods
    stream_service.send_decision_stream = AsyncMock()
    stream_service.send_transcript_chunk = AsyncMock()
    stream_service.send_step_change_notification = AsyncMock()
    stream_service.send_task_progress_update = AsyncMock()
    stream_service.send_complete_todo_list = AsyncMock()

    # Initialize services
    llm_service = LLMService()
    task_manager = TaskManager(plan_name="user_onboarding")
    plan_service = PlanService(stream_service=stream_service, llm_service=llm_service)

    # Initialize InputGate
    input_gate = InputGate(
        stream_service=stream_service,
        tts_service=None,
        llm_service=llm_service,
        task_manager=task_manager,
        plan_service=plan_service
    )

    print(f"✓ Services initialized")
    print(f"✓ Plan loaded: {task_manager.plan_execution.plan.title}")

    # Start the plan to get to step 1 (Ask for name)
    task_manager.initialize_first_step()
    current_step = task_manager.get_current_plan_step()
    print(f"✓ Current step: {current_step.title}")

    # Test cases for user_name validation
    test_cases = [
        # Valid names
        {"input": "Hi, I'm John", "expected_valid": True, "description": "Standard name introduction"},
        {"input": "My name is Sarah", "expected_valid": True, "description": "Formal name introduction"},
        {"input": "Call me Alex", "expected_valid": True, "description": "Casual name request"},
        {"input": "Maria", "expected_valid": True, "description": "Simple name only"},

        # Invalid names (should be rejected)
        {"input": "Hi", "expected_valid": False, "description": "Just greeting"},
        {"input": "Hello there", "expected_valid": False, "description": "Greeting without name"},
        {"input": "Thanks", "expected_valid": False, "description": "Politeness word"},
        {"input": "I'm me", "expected_valid": False, "description": "Pronoun instead of name"},
        {"input": "Call me I", "expected_valid": False, "description": "Single letter"},
        {"input": "My name is hi", "expected_valid": False, "description": "Greeting as name"},
    ]

    print(f"\n" + "-"*50)
    print("TEST 1: User Name Validation")
    print("-"*50)

    # Get the user_name deliverable for validation testing
    user_name_deliverable = None
    for deliverable in current_step.deliverables:
        if deliverable.key == "user_name":
            user_name_deliverable = deliverable
            break

    if user_name_deliverable:
        print(f"✓ Found user_name deliverable")
        print(f"✓ Acceptance criteria: {user_name_deliverable.acceptance_criteria}")
        print(f"✓ Examples: {user_name_deliverable.examples}")
        print(f"✓ Validation rules: {user_name_deliverable.validation_rules}")
    else:
        print("❌ Could not find user_name deliverable")
        return

    # Test validation directly
    validation_results = []
    for test_case in test_cases:
        # Extract name using InputGate's method
        extracted_name = input_gate._extract_deliverable_value(
            test_case["input"],
            user_name_deliverable,
            {"deliverables_detected": []}
        )

        is_valid = extracted_name is not None
        expected = test_case["expected_valid"]

        status = "✅" if is_valid == expected else "❌"
        validation_results.append(is_valid == expected)

        print(f"{status} '{test_case['input']}' -> {'Valid' if is_valid else 'Invalid'} "
              f"(extracted: {extracted_name or 'None'}) - {test_case['description']}")

    print(f"\n" + "-"*50)
    print("TEST 2: Communication Style Validation")
    print("-"*50)

    # Move to step 3 for communication style testing
    task_manager.plan_execution.set_deliverable_value("user_name", "John", "John", 0.9)
    task_manager.advance_to_next_step()  # Move to s2
    task_manager.advance_to_next_step()  # Move to s3
    current_step = task_manager.get_current_plan_step()
    print(f"✓ Advanced to step: {current_step.title}")

    # Get communication_style deliverable
    comm_style_deliverable = None
    for deliverable in current_step.deliverables:
        if deliverable.key == "communication_style":
            comm_style_deliverable = deliverable
            break

    if comm_style_deliverable:
        print(f"✓ Found communication_style deliverable")
        print(f"✓ Acceptance criteria: {comm_style_deliverable.acceptance_criteria}")
        print(f"✓ Valid enum values: {comm_style_deliverable.enum_values}")
    else:
        print("❌ Could not find communication_style deliverable")
        return

    # Test communication style validation
    style_test_cases = [
        # Valid styles
        {"input": "casual", "expected_valid": True, "description": "Exact enum match"},
        {"input": "formal", "expected_valid": True, "description": "Exact enum match"},
        {"input": "technical", "expected_valid": True, "description": "Exact enum match"},
        {"input": "I prefer casual", "expected_valid": True, "description": "Contains valid enum"},

        # Invalid styles
        {"input": "relaxed", "expected_valid": False, "description": "Similar but not exact"},
        {"input": "professional", "expected_valid": False, "description": "Similar to formal but not exact"},
        {"input": "I like talking in a casual way", "expected_valid": True, "description": "Contains valid enum"},
    ]

    style_validation_results = []
    for test_case in style_test_cases:
        # Extract style using InputGate's method
        extracted_style = input_gate._extract_deliverable_value(
            test_case["input"],
            comm_style_deliverable,
            {"deliverables_detected": []}
        )

        is_valid = extracted_style is not None
        expected = test_case["expected_valid"]

        status = "✅" if is_valid == expected else "❌"
        style_validation_results.append(is_valid == expected)

        print(f"{status} '{test_case['input']}' -> {'Valid' if is_valid else 'Invalid'} "
              f"(extracted: {extracted_style or 'None'}) - {test_case['description']}")

    print(f"\n" + "="*70)
    print("ACCEPTANCE CRITERIA TEST RESULTS")
    print("="*70)

    total_tests = len(validation_results) + len(style_validation_results)
    passed_tests = sum(validation_results) + sum(style_validation_results)

    print(f"✅ User Name Validation: {sum(validation_results)}/{len(validation_results)} tests passed")
    print(f"✅ Communication Style Validation: {sum(style_validation_results)}/{len(style_validation_results)} tests passed")
    print(f"✅ Overall Success Rate: {passed_tests}/{total_tests} tests passed ({passed_tests/total_tests*100:.1f}%)")

    if passed_tests == total_tests:
        print(f"\n🎯 ALL TESTS PASSED!")
        print(f"✅ Acceptance criteria successfully prevent invalid deliverable values")
        print(f"✅ Validation rules working as expected")
        print(f"✅ Examples and criteria provide clear guidance")
    else:
        print(f"\n⚠️  Some tests failed - review validation logic")

    print(f"\n📋 EXPECTED BENEFITS:")
    print(f"- Prevents 'Hi John' from being extracted as name 'John'")
    print(f"- Ensures communication style is exactly one of: formal, casual, technical")
    print(f"- Provides clear feedback on why validation fails")
    print(f"- Maintains data quality in plan execution")


if __name__ == "__main__":
    asyncio.run(test_acceptance_criteria())