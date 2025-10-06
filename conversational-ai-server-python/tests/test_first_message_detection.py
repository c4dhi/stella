#!/usr/bin/env python3
"""
Test script to verify first message detection and todo list initialization.
"""

import asyncio
import json
from message_processing.task_manager import TaskManager


def test_first_message_detection():
    """Test that first message detection works correctly."""
    print("🧪 Testing First Message Detection")

    # Create new TaskManager
    task_manager = TaskManager()

    print(f"\n=== Initial State ===")
    print(f"Is first interaction: {task_manager.is_first_interaction()}")

    current_step = task_manager.get_current_step()
    if current_step:
        print(f"Current step: {current_step.title} ({current_step.status.value})")
    else:
        print("Current step: None")

    # Check all step statuses
    print(f"\nAll step statuses:")
    for step_id in task_manager.step_order:
        step = task_manager.steps[step_id]
        print(f"  - {step.title}: {step.status.value}")

    # This should now work because is_first_interaction() should return True
    if task_manager.is_first_interaction():
        print(f"\n=== Initializing First Step ===")
        success = task_manager.initialize_first_step()
        print(f"Initialization success: {success}")

        # Check state after initialization
        current_step = task_manager.get_current_step()
        print(f"Current step after init: {current_step.title} ({current_step.status.value})")

        print(f"Is first interaction after init: {task_manager.is_first_interaction()}")

        # Check context
        context = task_manager.get_conversation_context()
        print(f"Conversation context: {context}")

        # Generate complete todo list
        complete_todo_list = task_manager.get_complete_todo_list()
        todo_data = complete_todo_list['todo_list']
        print(f"\nTodo List Data:")
        print(f"  - Initialized: {todo_data['initialized']}")
        print(f"  - Total Steps: {todo_data['total_steps']}")
        print(f"  - Current Step: {todo_data['current_step']['title']}")
        print(f"  - Progress: {todo_data['progress_percentage']:.1f}%")

        return True
    else:
        print(f"❌ First message detection failed - is_first_interaction() returned False")
        return False


if __name__ == "__main__":
    test_first_message_detection()