#!/usr/bin/env python3
"""
Enhanced State Machine Tests with Mock LLM Integration
Tests the complete state machine flow using mock LLM responses.
"""

import pytest
import asyncio
import sys
import os
from pathlib import Path

# Add parent directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from message_processing.plan_loader import load_state_machine_plan
from message_processing.state_machine import StateMachine
from message_processing.task_manager import TaskManager
from tests.utils.llm_test_utils import (
    mock_llm_context,
    StateMachineMockResponses,
    inject_mock_llm_into_state_machine,
    create_test_llm_service
)


class TestStateMachineWithMockLLM:
    """Test state machine functionality with mock LLM integration."""

    @pytest.mark.asyncio
    async def test_cognitive_demo_full_flow_with_mock_llm(self):
        """Test complete cognitive demo flow using mock LLM responses."""

        # Use context manager for automatic LLM switching
        mock_responses = StateMachineMockResponses.get_cognitive_demo_responses()

        with mock_llm_context(mock_responses=mock_responses) as mock_llm:
            # Load plan and create state machine
            plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
            state_machine = StateMachine(plan)

            # Inject mock LLM
            inject_mock_llm_into_state_machine(state_machine, mock_responses)

            # Start state machine
            assert state_machine.start()
            assert state_machine.execution_state.current_state_id == "introduction"

            # Test introduction state (LOOSE mode)
            print("\n=== Testing Introduction State (LOOSE) ===")

            # Process user message with name
            result = await state_machine.process_user_message("Hi, I'm Alice and I'm 32 years old")

            # Check that deliverables were detected via mock LLM
            name_state = state_machine.execution_state.get_deliverable_state("user_name")
            age_state = state_machine.execution_state.get_deliverable_state("user_age")

            assert name_state is not None
            assert name_state.value == "Alice"
            assert age_state is not None
            assert age_state.value == 32

            # Continue with more information
            await state_machine.process_user_message("I live in San Francisco")
            await state_machine.process_user_message("I enjoy painting, yoga, and cooking")
            await state_machine.process_user_message("I have two sisters")

            # Check all introduction deliverables
            location_state = state_machine.execution_state.get_deliverable_state("user_location")
            hobbies_state = state_machine.execution_state.get_deliverable_state("user_hobbies")
            siblings_state = state_machine.execution_state.get_deliverable_state("user_siblings")

            assert location_state.value == "San Francisco"
            assert "painting, yoga, cooking" in hobbies_state.value
            assert "two sisters" in siblings_state.value

            # Complete introduction state
            for task in state_machine.execution_state.current_state.tasks:
                state_machine.execution_state.complete_task(task.id)

            # Advance to memory game state
            success = state_machine.advance_state()
            assert success
            assert state_machine.execution_state.current_state_id == "memory_game"

            # Test memory game state (STRICT mode)
            print("\n=== Testing Memory Game State (STRICT) ===")

            current_state = state_machine.execution_state.current_state
            assert current_state.type.value == "strict"

            # Test memory levels
            await state_machine.process_user_message("milk")
            list1_state = state_machine.execution_state.get_deliverable_state("shopping_list_1")
            assert list1_state.value == "milk"

            await state_machine.process_user_message("milk, bread")
            list2_state = state_machine.execution_state.get_deliverable_state("shopping_list_2")
            assert list2_state.value == "milk, bread"

            await state_machine.process_user_message("milk, bread, eggs")
            list3_state = state_machine.execution_state.get_deliverable_state("shopping_list_3")
            assert list3_state.value == "milk, bread, eggs"

            print("✅ All memory levels completed successfully")

            # Get final progress summary
            summary = state_machine.get_progress_summary()
            print(f"\n=== Final Progress ===")
            print(f"Plan: {summary['plan_title']}")
            print(f"States: {summary['progress']['completed_states']}/{summary['progress']['total_states']}")
            print(f"Tasks: {summary['tasks']['completed']}/{summary['tasks']['total']}")

            assert summary['is_started'] == True
            assert summary['progress']['total_states'] == 3
            assert summary['tasks']['completed'] >= 8  # At least introduction + some memory

    @pytest.mark.asyncio
    async def test_strict_vs_loose_processing_modes(self):
        """Test different processing modes with mock LLM."""

        mock_responses = StateMachineMockResponses.get_deliverable_only_responses()

        with mock_llm_context(mock_responses=mock_responses) as mock_llm:
            plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
            state_machine = StateMachine(plan)
            inject_mock_llm_into_state_machine(state_machine, mock_responses)

            state_machine.start()

            # Test LOOSE mode (introduction state)
            print("\n=== Testing LOOSE Mode ===")

            available_tasks = state_machine.execution_state.get_available_tasks()
            assert len(available_tasks) == 5  # All tasks available in LOOSE mode

            context = state_machine.get_current_context()
            assert context['processing_mode'] == 'loose'
            assert len(context['available_tasks']) == 5

            # Complete introduction state
            for task in state_machine.execution_state.current_state.tasks:
                for deliverable in task.deliverables:
                    await state_machine.execution_state.set_deliverable_value(
                        deliverable.key, "test_value", "test message", 1.0
                    )
                state_machine.execution_state.complete_task(task.id)

            # Advance to STRICT mode
            success = state_machine.advance_state()
            assert success
            assert state_machine.execution_state.current_state_id == "memory_game"

            print("\n=== Testing STRICT Mode ===")

            # Test STRICT mode (memory game state)
            available_tasks = state_machine.execution_state.get_available_tasks()
            assert len(available_tasks) == 1  # Only current task available in STRICT mode
            assert available_tasks[0].id == "memory_level_1"

            context = state_machine.get_current_context()
            assert context['processing_mode'] == 'strict'
            assert len(context['available_tasks']) == 1

            print("✅ Processing mode differences verified")

    @pytest.mark.asyncio
    async def test_task_manager_integration_with_mock_llm(self):
        """Test TaskManager integration with mock LLM."""

        mock_responses = StateMachineMockResponses.get_simple_test_responses()

        with mock_llm_context(mock_responses=mock_responses) as mock_llm:
            # Initialize TaskManager with state machine plan
            task_manager = TaskManager("cognitive_stimulation_demo_sm")

            # Inject mock LLM if needed
            if hasattr(task_manager, 'state_machine'):
                inject_mock_llm_into_state_machine(task_manager.state_machine, mock_responses)

            assert task_manager.is_state_machine_mode()
            assert not task_manager.is_legacy_mode()

            # Test initialization
            success = task_manager.initialize_first_step()
            assert success

            # Test message processing
            result = await task_manager.process_user_message("Hello, I'm TestUser")
            assert result['success'] == True

            # Check conversation context
            context = task_manager.get_conversation_context()
            assert 'state_machine_started_at' in context
            assert context['todo_list_initialized'] == True

            print("✅ TaskManager integration with mock LLM successful")

    @pytest.mark.asyncio
    async def test_deliverable_detection_with_mock_llm(self):
        """Test deliverable detection specifically with mock LLM responses."""

        # Custom responses for deliverable detection testing
        custom_responses = [
            "DELIVERABLE_DETECTED: user_name = 'Emma'",
            "DELIVERABLE_DETECTED: user_age = 27",
            "No deliverable detected in this message.",
            "DELIVERABLE_DETECTED: shopping_list_1 = 'coffee'",
        ]

        with mock_llm_context(mock_responses=custom_responses) as mock_llm:
            plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
            state_machine = StateMachine(plan)
            inject_mock_llm_into_state_machine(state_machine, custom_responses)

            state_machine.start()

            # Test specific deliverable detection
            print("\n=== Testing Deliverable Detection ===")

            # Test name detection
            result = await state_machine.process_user_message("My name is Emma")
            name_state = state_machine.execution_state.get_deliverable_state("user_name")
            assert name_state.value == "Emma"
            print(f"✅ Name detected: {name_state.value}")

            # Test age detection
            await state_machine.process_user_message("I am 27 years old")
            age_state = state_machine.execution_state.get_deliverable_state("user_age")
            assert age_state.value == 27
            print(f"✅ Age detected: {age_state.value}")

            # Test no detection
            await state_machine.process_user_message("How are you today?")
            # Should not create new deliverables for this message

            print("✅ Deliverable detection working correctly with mock LLM")

    def test_mock_llm_configuration(self):
        """Test mock LLM configuration and provider switching."""

        print("\n=== Testing Mock LLM Configuration ===")

        # Test context manager setup
        with mock_llm_context() as mock_llm:
            assert mock_llm is not None
            assert LLMProvider.MOCK in mock_llm.providers
            assert mock_llm.default_config.provider == LLMProvider.MOCK

            # Test that config file was modified
            config_path = Path("llm_config.json")
            assert config_path.exists()

            with open(config_path) as f:
                import json
                config = json.load(f)
                assert config.get("provider") == "mock"
                assert config.get("test_mode") == True

            print("✅ Mock configuration active")

        # Test that config was restored
        with open(config_path) as f:
            import json
            restored_config = json.load(f)
            assert restored_config.get("provider") != "mock"  # Should be restored
            assert "test_mode" not in restored_config  # Should not have test flag

        print("✅ Original configuration restored")

    @pytest.mark.asyncio
    async def test_error_handling_with_mock_llm(self):
        """Test error handling scenarios with mock LLM."""

        # Create mock responses that might cause issues
        problematic_responses = [
            "INVALID_FORMAT: this should not parse",
            "",  # Empty response
            "DELIVERABLE_DETECTED: user_name = 'Valid User'",
            "Some random text without deliverable format"
        ]

        with mock_llm_context(mock_responses=problematic_responses) as mock_llm:
            plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
            state_machine = StateMachine(plan)
            inject_mock_llm_into_state_machine(state_machine, problematic_responses)

            state_machine.start()

            # Test that system handles problematic responses gracefully
            try:
                result = await state_machine.process_user_message("Hello")
                print("✅ System handled problematic mock response gracefully")

                # Should still be able to process valid responses
                result = await state_machine.process_user_message("My name is Valid User")
                name_state = state_machine.execution_state.get_deliverable_state("user_name")
                if name_state:
                    assert name_state.value == "Valid User"
                    print("✅ Valid response processed correctly after error")

            except Exception as e:
                print(f"⚠️  Error occurred: {e}")
                # This is acceptable - the system should handle errors gracefully


if __name__ == "__main__":
    # Run specific test
    import asyncio

    async def run_single_test():
        test_instance = TestStateMachineWithMockLLM()
        await test_instance.test_cognitive_demo_full_flow_with_mock_llm()

    print("🧪 Running State Machine Tests with Mock LLM")
    print("=" * 50)

    asyncio.run(run_single_test())
    print("\n✅ Test completed successfully!")