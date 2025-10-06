#!/usr/bin/env python3
"""
Detailed test for step flow and chaining logic.
"""
import asyncio
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from message_processing.plan_service import PlanService
from message_processing.stream_service import StreamService


class DetailedMockStreamService(StreamService):
    """Mock stream service with detailed logging."""

    def __init__(self):
        self.events = []

    def log_event(self, event_type, **kwargs):
        self.events.append({"type": event_type, **kwargs})
        print(f"[{event_type.upper()}] {kwargs}")

    async def send_transcript_chunk(self, text, is_final=True, participant_id="plan-assistant", confidence=0.9, transcript_id=None):
        self.log_event("transcript", text=text, is_final=is_final, participant_id=participant_id)

    async def send_plan_step_update(self, session_id, step_id, step_title, step_type, instruction, response, deliverables):
        self.log_event("step_update", step_id=step_id, step_type=step_type, step_title=step_title, response=response[:50] + "...")

    async def send_decision_stream(self, decision_type, message, confidence, metadata=None):
        self.log_event("decision", decision_type=decision_type, message=message)

    async def send_plan_started(self, plan_id, plan_title, session_id, total_steps):
        self.log_event("plan_started", plan_id=plan_id, plan_title=plan_title, session_id=session_id, total_steps=total_steps)

    async def send_plan_progress_update(self, session_id, progress, current_step, deliverables):
        self.log_event("progress", session_id=session_id, progress=progress)

    async def send_plan_completed(self, session_id, plan_id, plan_title, deliverables, completion_time):
        self.log_event("plan_completed", plan_id=plan_id, plan_title=plan_title)


async def test_detailed_flow():
    """Test the detailed step flow."""
    print("🔍 Detailed Step Flow Test")
    print("=" * 50)

    mock_stream = DetailedMockStreamService()
    plan_service = PlanService(stream_service=mock_stream)

    # Start plan
    print("\n1. Starting plan...")
    session_id = await plan_service.start_plan("user_onboarding")

    session = plan_service.state_manager.get_session(session_id)
    current_step = plan_service.state_manager.get_current_step(session_id)
    print(f"   Current step: {current_step.id} ({current_step.type.value})")

    # Test step 1 (Question with required deliverable)
    print("\n2. Processing Step 1 input (user name)...")
    result = await plan_service.process_plan_input(session_id, "My name is Alice")
    print(f"   Result: {result}")

    # Check current state
    current_step = plan_service.state_manager.get_current_step(session_id)
    print(f"   New current step: {current_step.id if current_step else 'None'} ({current_step.type.value if current_step else 'None'})")

    # Test step chaining manually
    print("\n3. Testing step chaining logic...")

    # Check what _should_wait_for_user_input returns for each step in the actual session
    session = plan_service.state_manager.get_session(session_id)
    for step in session.plan.steps:
        needs_input = plan_service._should_wait_for_user_input(step)
        deliverable_count = len([d for d in step.deliverables if d.required])
        validated_count = len([d for d in step.deliverables if d.validated])
        print(f"   Step {step.id} ({step.type.value}): needs_input={needs_input}, required_deliverables={deliverable_count}, validated={validated_count}")

    # Check automatic continuation capability
    can_continue = plan_service._can_continue_automatically(session_id)
    print(f"   Can continue automatically: {can_continue}")

    # Check current step details
    current_step = plan_service.state_manager.get_current_step(session_id)
    print(f"   Current step {current_step.id} deliverables:")
    for d in current_step.deliverables:
        print(f"     - {d.key}: required={d.required}, validated={d.validated}, value={d.value}")

    # Test if we can manually trigger step chaining from current position
    print("\n4. Testing manual step chain execution...")
    chain_result = await plan_service._execute_step_chain(session_id)
    print(f"   Step chain executed: {chain_result}")

    # Check final state
    final_current_step = plan_service.state_manager.get_current_step(session_id)
    print(f"   Final current step: {final_current_step.id if final_current_step else 'None'}")

    print("\n5. All events captured:")
    for i, event in enumerate(mock_stream.events):
        print(f"   {i+1}. {event}")

    return True


if __name__ == "__main__":
    asyncio.run(test_detailed_flow())