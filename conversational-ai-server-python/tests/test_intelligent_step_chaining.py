#!/usr/bin/env python3
"""
Test script for intelligent step chaining enhancement.
Tests that Statement steps automatically advance to next Question steps.
"""
import asyncio
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from message_processing.plan_service import PlanService
from message_processing.stream_service import StreamService


class MockStreamService(StreamService):
    """Mock stream service for testing."""

    def __init__(self):
        self.sent_messages = []
        self.transcripts = []
        self.step_updates = []

    async def send_transcript_chunk(self, text, is_final=True, participant_id="plan-assistant", confidence=0.9, transcript_id=None):
        """Mock transcript sending."""
        self.transcripts.append({
            "text": text,
            "is_final": is_final,
            "participant_id": participant_id,
            "confidence": confidence
        })
        print(f"[TRANSCRIPT] {participant_id}: {text}")

    async def send_plan_step_update(self, session_id, step_id, step_title, step_type, instruction, response, deliverables):
        """Mock step update sending."""
        self.step_updates.append({
            "session_id": session_id,
            "step_id": step_id,
            "step_title": step_title,
            "step_type": step_type,
            "response": response
        })
        print(f"[STEP UPDATE] {step_id} ({step_type}): {step_title}")

    async def send_decision_stream(self, decision_type, message, confidence, metadata=None):
        """Mock decision stream."""
        print(f"[DECISION] {decision_type}: {message}")

    async def send_plan_started(self, plan_id, plan_title, session_id, total_steps):
        """Mock plan started notification."""
        print(f"[PLAN STARTED] {plan_title} ({total_steps} steps)")

    async def send_plan_progress_update(self, session_id, progress, current_step, deliverables):
        """Mock progress update."""
        print(f"[PROGRESS] {progress}%")

    async def send_plan_completed(self, session_id, plan_id, plan_title, deliverables, completion_time):
        """Mock plan completion."""
        print(f"[PLAN COMPLETED] {plan_title}")


async def test_s2_s3_chaining():
    """Test that step 2 (Statement) automatically chains to step 3 (Question)."""
    print("🧪 Testing intelligent step chaining (s2 -> s3)")
    print("=" * 60)

    # Setup mock stream service
    mock_stream = MockStreamService()
    plan_service = PlanService(stream_service=mock_stream)

    # Start the user onboarding plan
    session_id = await plan_service.start_plan("user_onboarding")
    if not session_id:
        print("❌ Failed to start plan")
        return False

    print(f"✅ Started plan session: {session_id}")

    # Step 1: Provide name to complete first step
    print("\n--- Step 1: Providing name 'Bob' ---")
    result = await plan_service.process_plan_input(session_id, "Hi, I'm Bob")

    if not result.get("success"):
        print(f"❌ Step 1 failed: {result}")
        return False

    print(f"✅ Step 1 result: {result}")

    # Check current step after processing name
    session = plan_service.state_manager.get_session(session_id)
    current_step = plan_service.state_manager.get_current_step(session_id)

    print(f"\nCurrent step after name input: {current_step.id if current_step else 'None'}")
    print(f"Session state: {session.state.value if session else 'None'}")

    # Check what transcripts were generated
    print(f"\nTranscripts generated: {len(mock_stream.transcripts)}")
    for i, transcript in enumerate(mock_stream.transcripts):
        print(f"  {i+1}. {transcript['text'][:100]}...")

    # Check step updates
    print(f"\nStep updates: {len(mock_stream.step_updates)}")
    for i, update in enumerate(mock_stream.step_updates):
        print(f"  {i+1}. {update['step_id']} ({update['step_type']}): {update['step_title']}")

    # Verify intelligent chaining worked
    # After step 1 completion, we should have automatically advanced through s2 and be at s3
    if current_step and current_step.id == "s3":
        print("✅ SUCCESS: Intelligent step chaining worked! Advanced from s2 to s3 automatically.")

        # Check that we got a combined response for both s2 and s3
        final_transcript = mock_stream.transcripts[-1]["text"] if mock_stream.transcripts else ""
        if "welcome" in final_transcript.lower() and "preferences" in final_transcript.lower():
            print("✅ SUCCESS: Combined response contains both welcome and preferences content")
        else:
            print(f"⚠️  Combined response: {final_transcript}")

        return True
    else:
        current_step_id = current_step.id if current_step else "None"
        print(f"❌ FAILED: Expected to be at step s3, but at {current_step_id}")
        return False


async def test_step_classification():
    """Test the step classification logic."""
    print("\n🧪 Testing step classification logic")
    print("=" * 60)

    mock_stream = MockStreamService()
    plan_service = PlanService(stream_service=mock_stream)

    # Load the plan to test classification
    plan = plan_service.load_plan("user_onboarding")
    if not plan:
        print("❌ Failed to load plan")
        return False

    for step in plan.steps:
        needs_input = plan_service._should_wait_for_user_input(step)
        print(f"Step {step.id} ({step.type.value}): {'Needs user input' if needs_input else 'Can auto-advance'}")

        # Detailed analysis
        if step.deliverables:
            required_deliverables = [d for d in step.deliverables if d.required and not d.validated]
            print(f"  Required deliverables: {len(required_deliverables)}")
        else:
            print("  No deliverables")

    return True


async def main():
    """Run all tests."""
    print("🚀 Testing Intelligent Step Chaining Enhancement")
    print("=" * 60)

    try:
        # Test 1: Step classification
        success1 = await test_step_classification()

        # Test 2: Actual chaining behavior
        success2 = await test_s2_s3_chaining()

        if success1 and success2:
            print("\n🎉 All tests passed! Intelligent step chaining is working correctly.")
            return True
        else:
            print("\n❌ Some tests failed.")
            return False

    except Exception as e:
        print(f"\n❌ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)