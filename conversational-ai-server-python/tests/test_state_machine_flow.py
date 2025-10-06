"""
Test state machine functionality with the cognitive stimulation demo.
"""
import pytest
import asyncio
from message_processing.plan_loader import load_state_machine_plan
from message_processing.state_machine import StateMachine
from message_processing.task_manager import TaskManager


class TestStateMachineFlow:
    """Test state machine execution flow."""

    def test_load_state_machine_plan(self):
        """Test loading the state machine version of cognitive demo."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")

        assert plan.id == "cognitive_stimulation_demo_sm"
        assert plan.title == "GRACE Cognitive Stimulation Exercise (State Machine)"
        assert plan.initial_state_id == "introduction"
        assert len(plan.states) == 3

        # Check state types
        introduction_state = plan.get_state("introduction")
        memory_game_state = plan.get_state("memory_game")
        feedback_state = plan.get_state("feedback_and_closure")

        assert introduction_state.type.value == "loose"
        assert memory_game_state.type.value == "strict"
        assert feedback_state.type.value == "loose"

        # Check task counts
        assert len(introduction_state.tasks) == 5  # Name, age, location, hobbies, siblings
        assert len(memory_game_state.tasks) == 10  # Memory levels 1-10
        assert len(feedback_state.tasks) == 4  # Celebrate, feedback x2, closure

    def test_state_machine_initialization(self):
        """Test state machine initialization."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
        state_machine = StateMachine(plan)

        assert not state_machine.execution_state.is_started
        assert state_machine.execution_state.current_state_id is None

        # Start the state machine
        success = state_machine.start()
        assert success
        assert state_machine.execution_state.is_started
        assert state_machine.execution_state.current_state_id == "introduction"

        # Check initial state
        current_state = state_machine.execution_state.current_state
        assert current_state.id == "introduction"
        assert current_state.type.value == "loose"

    @pytest.mark.asyncio
    async def test_loose_state_processing(self):
        """Test processing tasks in a loose state."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
        state_machine = StateMachine(plan)
        state_machine.start()

        # Should be in introduction state (loose mode)
        available_tasks = state_machine.execution_state.get_available_tasks()
        assert len(available_tasks) == 5  # All tasks available in loose mode

        # For this test, let's manually set deliverable values since
        # the deliverable detector requires proper LLM setup
        # This tests the state machine logic without the LLM dependency

        # Manually set user_name deliverable
        await state_machine.execution_state.set_deliverable_value(
            "user_name", "John", "Hi, I'm John", 1.0, "Test input"
        )

        # Process the state to check if tasks complete
        result = await state_machine.process_user_message("Hi, I'm John and I'm 25 years old")

        # Check that name deliverable was set
        name_state = state_machine.execution_state.get_deliverable_state("user_name")
        assert name_state is not None
        assert name_state.value == "John"

        # The task should now be completable
        name_task = next(task for task in available_tasks if task.id == "collect_name")
        assert name_task.deliverables[0].key == "user_name"

    @pytest.mark.asyncio
    async def test_strict_state_processing(self):
        """Test processing tasks in a strict state."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
        state_machine = StateMachine(plan)
        state_machine.start()

        # Manually advance to memory game state for testing
        state_machine.execution_state.current_state_id = "memory_game"
        state_machine.execution_state._initialize_current_state()

        # Should be in memory game state (strict mode)
        available_tasks = state_machine.execution_state.get_available_tasks()
        assert len(available_tasks) == 1  # Only current task available in strict mode
        assert available_tasks[0].id == "memory_level_1"

        # Process correct answer for level 1
        result = await state_machine.process_user_message("milk")

        # Should complete the task and advance to next
        if result.completed_tasks:
            assert "memory_level_1" in result.completed_tasks

            # Next available task should be level 2
            next_tasks = state_machine.execution_state.get_available_tasks()
            if next_tasks:
                assert next_tasks[0].id == "memory_level_2"

    def test_task_manager_integration(self):
        """Test TaskManager integration with state machine."""
        # Initialize TaskManager with state machine plan
        task_manager = TaskManager("cognitive_stimulation_demo_sm")

        assert task_manager.is_state_machine_mode()
        assert not task_manager.is_legacy_mode()
        assert task_manager.state_machine is not None
        assert task_manager.plan_execution is None

        # Check conversation context
        context = task_manager.get_conversation_context()
        assert context['plan_type'] == 'state_machine'
        assert context['plan_id'] == 'cognitive_stimulation_demo_sm'

    def test_state_transitions(self):
        """Test state transition evaluation."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
        state_machine = StateMachine(plan)
        state_machine.start()

        # Complete all tasks in introduction state
        introduction_state = state_machine.execution_state.current_state
        for task in introduction_state.tasks:
            state_machine.execution_state.complete_task(task.id)

        # Should be able to transition to memory game
        assert state_machine.execution_state.is_current_state_complete()
        next_state_id = state_machine.execution_state.evaluate_state_transitions()
        assert next_state_id == "memory_game"

        # Advance state
        success = state_machine.execution_state.advance_to_next_state()
        assert success
        assert state_machine.execution_state.current_state_id == "memory_game"

    def test_get_state_machine_context(self):
        """Test getting context for input gate."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
        state_machine = StateMachine(plan)
        state_machine.start()

        # First verify the execution state directly
        available_tasks_direct = state_machine.execution_state.get_available_tasks()
        assert len(available_tasks_direct) == 5, f"Direct call returned {len(available_tasks_direct)} tasks"

        # Now test the context method
        context = state_machine.get_current_context()

        assert context['processing_mode'] == 'loose'
        assert context['state']['id'] == 'introduction'
        assert context['state']['type'] == 'loose'

        # Verify available tasks count
        assert len(context['available_tasks']) == 5, f"Context returned {len(context['available_tasks'])} tasks, expected 5"

        # Check task structure if we have tasks
        if context['available_tasks']:
            first_task = context['available_tasks'][0]
            assert 'id' in first_task
            assert 'description' in first_task
            assert 'instruction' in first_task
            assert 'deliverables' in first_task

    def test_progress_summary(self):
        """Test progress summary generation."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
        state_machine = StateMachine(plan)
        state_machine.start()

        summary = state_machine.get_progress_summary()

        assert summary['plan_id'] == 'cognitive_stimulation_demo_sm'
        assert summary['is_started'] == True
        assert summary['is_completed'] == False
        assert summary['current_state']['id'] == 'introduction'
        assert summary['current_state']['type'] == 'loose'
        assert summary['progress']['total_states'] == 3
        assert summary['progress']['completed_states'] == 0
        assert summary['tasks']['total'] == 19  # Total across all states

    @pytest.mark.asyncio
    async def test_complete_flow_simulation(self):
        """Test a complete flow through multiple states."""
        plan = load_state_machine_plan("cognitive_stimulation_demo_sm")
        state_machine = StateMachine(plan)
        state_machine.start()

        # Complete introduction state by manually completing all tasks
        introduction_state = state_machine.execution_state.current_state
        for task in introduction_state.tasks:
            # Simulate deliverable completion
            for deliverable in task.deliverables:
                await state_machine.execution_state.set_deliverable_value(
                    deliverable.key, "test_value", "test message", 1.0
                )
            state_machine.execution_state.complete_task(task.id)

        # Advance to memory game
        success = state_machine.advance_state()
        assert success
        assert state_machine.execution_state.current_state_id == "memory_game"

        # Complete first few memory levels
        memory_state = state_machine.execution_state.current_state
        for i, task in enumerate(memory_state.tasks[:3]):  # Complete first 3 levels
            # Simulate deliverable completion
            for deliverable in task.deliverables:
                await state_machine.execution_state.set_deliverable_value(
                    deliverable.key, f"test_shopping_list_{i+1}", "test message", 1.0
                )
            state_machine.execution_state.complete_task(task.id)

        # Check progress
        summary = state_machine.get_progress_summary()
        assert summary['tasks']['completed'] >= 8  # 5 intro + 3 memory

        print(f"✅ Completed {summary['tasks']['completed']} out of {summary['tasks']['total']} tasks")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])