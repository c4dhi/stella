"""
Plan Service for loading and executing step-by-step plans.
Handles plan loading from JSON files, step execution, and response generation.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path

from .plan_state_manager import (
    PlanStateManager, Plan, Step, Deliverable, PlanSession,
    PlanState, StepType, DeliverableType
)
from .stream_service import StreamService
from .llm_service import LLMService, LLMConfig, LLMProvider, LLMMessage


class PlanService:
    """Service for loading and executing step-by-step plans."""

    def __init__(self, stream_service: StreamService, llm_service: Optional[LLMService] = None, plans_dir: str = "plans", default_plan: str = "user_onboarding"):
        self.stream_service = stream_service
        self.llm_service = llm_service or LLMService()
        self.state_manager = PlanStateManager()
        self.plans_dir = Path(plans_dir)
        self.default_plan = default_plan

        # Ensure plans directory exists
        self.plans_dir.mkdir(exist_ok=True)

        # Cache for loaded plans
        self.plan_cache: Dict[str, Plan] = {}

        # Active plan session (only one at a time)
        self.active_session_id: Optional[str] = None

        # LLM config for plan-related processing
        self.llm_config = LLMConfig(
            model="gpt-4o-mini",
            temperature=0.3,
            streaming=False,
            provider=LLMProvider.OPENAI_LANGCHAIN
        )

    def load_plan(self, plan_id: str) -> Optional[Plan]:
        """Load a plan from JSON file."""
        # Check cache first
        if plan_id in self.plan_cache:
            return self.plan_cache[plan_id]

        plan_file = self.plans_dir / f"{plan_id}.json"
        if not plan_file.exists():
            print(f"[PlanService] Plan file not found: {plan_file}")
            return None

        try:
            with open(plan_file, 'r') as f:
                plan_data = json.load(f)

            plan = self._parse_plan_json(plan_data)
            if plan:
                self.plan_cache[plan_id] = plan
                print(f"[PlanService] Loaded plan: {plan.title}")

            return plan

        except Exception as e:
            print(f"[PlanService] Error loading plan {plan_id}: {e}")
            return None

    def _parse_plan_json(self, plan_data: Dict[str, Any]) -> Optional[Plan]:
        """Parse plan JSON data into Plan object."""
        try:
            steps = []
            for step_data in plan_data.get("steps", []):
                # Parse deliverables
                deliverables = []
                for deliv_data in step_data.get("deliverables", []):
                    deliverable = Deliverable(
                        key=deliv_data["key"],
                        type=DeliverableType(deliv_data["type"]),
                        required=deliv_data.get("required", True),
                        enum_values=deliv_data.get("enum_values"),
                        description=deliv_data.get("description"),
                        value=None,  # Initialize value field to avoid AttributeError
                        validated=False  # Initialize validated field
                    )
                    deliverables.append(deliverable)

                step = Step(
                    id=step_data["id"],
                    type=StepType(step_data["type"]),
                    title=step_data["title"],
                    instruction=step_data["instruction"],
                    deliverables=deliverables,
                    done_when=step_data.get("done_when")
                )
                steps.append(step)

            plan = Plan(
                id=plan_data.get("id", str(uuid.uuid4())),
                title=plan_data["title"],
                description=plan_data.get("description", ""),
                steps=steps
            )

            return plan

        except Exception as e:
            print(f"[PlanService] Error parsing plan JSON: {e}")
            return None

    def get_available_plans(self) -> List[Dict[str, Any]]:
        """Get list of available plans."""
        plans = []
        for plan_file in self.plans_dir.glob("*.json"):
            try:
                with open(plan_file, 'r') as f:
                    plan_data = json.load(f)

                plans.append({
                    "id": plan_file.stem,
                    "title": plan_data.get("title", "Untitled Plan"),
                    "description": plan_data.get("description", ""),
                    "steps_count": len(plan_data.get("steps", [])),
                    "file": str(plan_file)
                })
            except Exception as e:
                print(f"[PlanService] Error reading plan file {plan_file}: {e}")

        return plans

    async def initialize_default_plan(self, participant_id: str = "default") -> Optional[str]:
        """Initialize the default plan automatically."""
        if self.active_session_id:
            # Plan already active
            return self.active_session_id

        return await self.start_plan(self.default_plan, participant_id)

    async def start_plan(self, plan_id: str, participant_id: str = "default") -> Optional[str]:
        """Start a new plan execution."""
        plan = self.load_plan(plan_id)
        if not plan:
            await self.stream_service.send_decision_stream(
                "plan_start_error",
                f"Plan '{plan_id}' not found",
                confidence=0.0,
                metadata={"error": "plan_not_found", "plan_id": plan_id}
            )
            return None

        # Create new session
        session_id = self.state_manager.create_session(plan, participant_id)

        # Start the plan
        if not self.state_manager.start_plan(session_id):
            await self.stream_service.send_decision_stream(
                "plan_start_error",
                f"Failed to start plan '{plan_id}'",
                confidence=0.0,
                metadata={"error": "start_failed", "plan_id": plan_id}
            )
            return None

        # Set as active session
        self.active_session_id = session_id

        # Send plan started notification
        await self.stream_service.send_plan_started(
            plan_id=plan_id,
            plan_title=plan.title,
            session_id=session_id,
            total_steps=len(plan.steps)
        )

        # Note: Removed automatic step presentation to prevent proactive messaging
        # InputGate will handle response generation based on actual user input

        print(f"[PlanService] Started plan '{plan.title}' for {participant_id}")
        return session_id

    async def process_plan_input(self, session_id: str, user_input: str) -> Dict[str, Any]:
        """Process user input for active plan."""
        session = self.state_manager.get_session(session_id)
        if not session:
            return {"success": False, "error": "Session not found"}

        # Process input through state manager
        result = self.state_manager.process_user_input(session_id, user_input)

        # Send progress update
        await self._send_progress_update(session_id)

        # If step completed, present next step or complete plan
        if result.get("step_complete"):
            # Refresh session state after processing
            session = self.state_manager.get_session(session_id)
            if session and session.state == PlanState.COMPLETED:
                await self._handle_plan_completion(session_id)
                # Clear active session when plan is completed
                self.active_session_id = None
            else:
                # Use intelligent step presentation (may chain multiple steps)
                await self._present_current_step(session_id)

        return result

    def _should_wait_for_user_input(self, step: Step) -> bool:
        """Determine if a step requires explicit user input or can be completed automatically."""
        # Statement steps can always auto-advance
        if step.type == StepType.STATEMENT:
            return False

        # Question steps with required deliverables need user input
        if step.type == StepType.QUESTION:
            has_required_deliverables = any(d.required and not d.validated for d in step.deliverables)
            return has_required_deliverables

        # Default to waiting for user input for unknown step types
        return True

    def _can_continue_automatically(self, session_id: str) -> bool:
        """Check if we can automatically continue to the next step without waiting."""
        session = self.state_manager.get_session(session_id)
        if not session:
            return False

        # Get current step index
        current_step = self.state_manager.get_current_step(session_id)
        if not current_step:
            return False

        current_index = next(
            (i for i, step in enumerate(session.plan.steps) if step.id == current_step.id),
            -1
        )

        # Check if there's a next step
        if current_index < 0 or current_index + 1 >= len(session.plan.steps):
            return False

        next_step = session.plan.steps[current_index + 1]

        # Can continue if the current step doesn't need user input OR if it's already completed
        current_step_complete = self.state_manager._is_step_complete(current_step)
        return current_step_complete and not self._should_wait_for_user_input(next_step)

    async def _execute_step_chain(self, session_id: str) -> bool:
        """Execute a chain of steps that can be completed automatically."""
        chain_responses = []
        steps_processed = 0
        statement_steps_processed = 0

        while True:
            session = self.state_manager.get_session(session_id)
            current_step = self.state_manager.get_current_step(session_id)

            if not session or not current_step:
                break

            # Generate response for current step
            if current_step.type == StepType.QUESTION:
                response = await self._generate_question_response(current_step, session)
            elif current_step.type == StepType.STATEMENT:
                response = await self._generate_statement_response(current_step, session)
            else:
                response = current_step.instruction

            chain_responses.append(response)
            steps_processed += 1

            # Track statement steps for auto-advancement
            if current_step.type == StepType.STATEMENT:
                statement_steps_processed += 1

            # Send individual step update
            await self.stream_service.send_plan_step_update(
                session_id=session_id,
                step_id=current_step.id,
                step_title=current_step.title,
                step_type=current_step.type.value,
                instruction=current_step.instruction,
                response=response,
                deliverables=[
                    {
                        "key": d.key,
                        "type": d.type.value,
                        "required": d.required,
                        "description": d.description,
                        "value": d.value,
                        "validated": d.validated
                    } for d in current_step.deliverables
                ]
            )

            # Check if we need to wait for user input for this step
            current_step_needs_input = self._should_wait_for_user_input(current_step)
            if current_step_needs_input:
                break

            # For Statement steps, mark as completed and advance
            if current_step.type == StepType.STATEMENT:
                self.state_manager._complete_current_step(session)

            # Check if we can continue to the next step
            if not self._can_continue_automatically(session_id):
                break

        # Send combined response if we processed multiple steps or have statement + question chain
        if len(chain_responses) > 1 or (statement_steps_processed > 0 and steps_processed > statement_steps_processed):
            combined_response = " ".join(chain_responses)
            await self.stream_service.send_transcript_chunk(
                text=combined_response,
                is_final=True,
                confidence=0.9
            )
        elif steps_processed == 1:
            # Single step - send its response
            await self.stream_service.send_transcript_chunk(
                text=chain_responses[0],
                is_final=True,
                confidence=0.9
            )

        return steps_processed > 0

    async def _present_current_step(self, session_id: str) -> bool:
        """Present the current step to the user, with intelligent step chaining."""
        session = self.state_manager.get_session(session_id)
        current_step = self.state_manager.get_current_step(session_id)

        if not session or not current_step:
            return False

        # Try to execute a step chain for more fluid conversation
        if await self._execute_step_chain(session_id):
            return True

        # Fallback to single step presentation (shouldn't normally reach here)
        if current_step.type == StepType.QUESTION:
            response = await self._generate_question_response(current_step, session)
        elif current_step.type == StepType.STATEMENT:
            response = await self._generate_statement_response(current_step, session)
        else:
            response = current_step.instruction

        # Send step update
        await self.stream_service.send_plan_step_update(
            session_id=session_id,
            step_id=current_step.id,
            step_title=current_step.title,
            step_type=current_step.type.value,
            instruction=current_step.instruction,
            response=response,
            deliverables=[
                {
                    "key": d.key,
                    "type": d.type.value,
                    "required": d.required,
                    "description": d.description,
                    "value": d.value,
                    "validated": d.validated
                } for d in current_step.deliverables
            ]
        )

        # Send response as transcript
        await self.stream_service.send_transcript_chunk(
            text=response,
            is_final=True,
            confidence=0.9
        )

        return True

    async def _generate_question_response(self, step: Step, session: PlanSession) -> str:
        """Generate response for a Question step."""
        try:
            # Build context about what we need to collect
            deliverables_info = []
            for d in step.deliverables:
                if not d.validated:
                    info = f"- {d.key} ({d.type.value})"
                    if d.description:
                        info += f": {d.description}"
                    if not d.required:
                        info += " (optional)"
                    if d.enum_values:
                        info += f" [options: {', '.join(d.enum_values)}]"
                    deliverables_info.append(info)

            context = f"""
Plan: {session.plan.title}
Current Step: {step.title}
Step Instruction: {step.instruction}

Information needed:
{chr(10).join(deliverables_info)}

Session deliverables already collected: {session.deliverables}
"""

            messages = [
                LLMMessage(role="system", content="""You are a helpful assistant guiding a user through a step-by-step plan.
Your job is to ask for the required information in a natural, conversational way.

Guidelines:
- Be friendly and conversational
- Ask for the required information clearly
- If multiple pieces of information are needed, you can ask for them together or separately as appropriate
- Reference any information already collected to avoid repetition
- Keep responses concise but warm
- Don't repeat exactly what's in the instruction - make it natural"""),

                LLMMessage(role="user", content=context)
            ]

            response = await self.llm_service.generate(
                messages=messages,
                config=self.llm_config,
                component_name="plan_question_generator"
            )

            return response.content

        except Exception as e:
            print(f"[PlanService] Error generating question response: {e}")
            return step.instruction

    async def _generate_statement_response(self, step: Step, session: PlanSession) -> str:
        """Generate response for a Statement step."""
        try:
            context = f"""
Plan: {session.plan.title}
Current Step: {step.title}
Step Instruction: {step.instruction}

Information collected so far: {session.deliverables}
"""

            messages = [
                LLMMessage(role="system", content="""You are a helpful assistant presenting information to a user as part of a step-by-step plan.

Guidelines:
- Be friendly and informative
- Present the statement in a natural way
- You can personalize the message using information already collected
- Keep it concise but engaging
- Don't just repeat the instruction verbatim - make it conversational"""),

                LLMMessage(role="user", content=context)
            ]

            response = await self.llm_service.generate(
                messages=messages,
                config=self.llm_config,
                component_name="plan_statement_generator"
            )

            return response.content

        except Exception as e:
            print(f"[PlanService] Error generating statement response: {e}")
            return step.instruction

    async def _send_progress_update(self, session_id: str):
        """Send progress update to frontend."""
        progress = self.state_manager.get_plan_progress(session_id)

        await self.stream_service.send_plan_progress_update(
            session_id=session_id,
            progress=progress["progress"],
            current_step=progress.get("current_step"),
            deliverables=progress["deliverables"]
        )

    async def _handle_plan_completion(self, session_id: str):
        """Handle plan completion."""
        session = self.state_manager.get_session(session_id)
        if not session:
            return

        # Send completion notification
        await self.stream_service.send_plan_completed(
            session_id=session_id,
            plan_id=session.plan.id,
            plan_title=session.plan.title,
            deliverables=session.deliverables,
            completion_time=datetime.now(timezone.utc).isoformat()
        )

        # Generate completion message
        try:
            context = f"""
Plan completed: {session.plan.title}
All information collected: {session.deliverables}
Total steps completed: {len(session.plan.steps)}
"""

            messages = [
                LLMMessage(role="system", content="""You are celebrating the completion of a step-by-step plan with the user.

Guidelines:
- Be congratulatory and positive
- Summarize what was accomplished
- You can mention key information that was collected
- Keep it brief but warm
- End with an offer to help further or start another plan"""),

                LLMMessage(role="user", content=context)
            ]

            response = await self.llm_service.generate(
                messages=messages,
                config=self.llm_config,
                component_name="plan_completion_generator"
            )

            # Send completion message as transcript
            await self.stream_service.send_transcript_chunk(
                text=response.content,
                is_final=True,
                confidence=1.0
            )

        except Exception as e:
            print(f"[PlanService] Error generating completion message: {e}")
            # Fallback message
            await self.stream_service.send_transcript_chunk(
                text=f"Great! We've completed the '{session.plan.title}' plan. All done!",
                is_final=True,
                confidence=1.0
            )

    async def get_plan_status(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get current plan status."""
        return self.state_manager.get_plan_progress(session_id)

    async def skip_current_step(self, session_id: str) -> bool:
        """Skip the current step."""
        success = self.state_manager.skip_current_step(session_id)
        if success:
            session = self.state_manager.get_session(session_id)
            if session and session.state != PlanState.COMPLETED:
                await self._present_current_step(session_id)
            else:
                await self._handle_plan_completion(session_id)
        return success

    async def abort_plan(self, session_id: str, reason: str = "user_requested") -> bool:
        """Abort the current plan."""
        success = self.state_manager.abort_plan(session_id, reason)
        if success:
            session = self.state_manager.get_session(session_id)
            if session:
                await self.stream_service.send_plan_aborted(
                    session_id=session_id,
                    plan_id=session.plan.id,
                    plan_title=session.plan.title,
                    reason=reason
                )

                # Send abort message
                await self.stream_service.send_transcript_chunk(
                    text=f"Plan '{session.plan.title}' has been stopped. How else can I help you?",
                    is_final=True,
                    confidence=1.0
                )
        return success

    def get_active_session(self, participant_id: str = None) -> Optional[str]:
        """Get the currently active plan session."""
        return self.active_session_id

    def is_plan_related_input(self, user_input: str) -> bool:
        """Check if user input is plan-related."""
        plan_keywords = [
            "start plan", "begin plan", "new plan", "plan help",
            "skip step", "next step", "abort plan", "stop plan",
            "plan status", "plan progress", "what plans"
        ]

        user_lower = user_input.lower()
        return any(keyword in user_lower for keyword in plan_keywords)

    async def handle_plan_command(self, user_input: str, participant_id: str) -> Dict[str, Any]:
        """Handle plan-specific commands."""
        user_lower = user_input.lower().strip()

        # List available plans
        if any(phrase in user_lower for phrase in ["what plans", "available plans", "list plans"]):
            plans = self.get_available_plans()
            return {
                "handled": True,
                "response": f"Available plans: {', '.join([p['title'] for p in plans])}",
                "plans": plans
            }

        # Start a specific plan
        if user_lower.startswith("start plan"):
            plan_name = user_input[10:].strip()  # Remove "start plan"
            if plan_name:
                session_id = await self.start_plan(plan_name, participant_id)
                return {
                    "handled": True,
                    "session_id": session_id,
                    "response": f"Starting plan: {plan_name}" if session_id else f"Could not start plan: {plan_name}"
                }

        # Check for active session commands
        active_session = self.get_active_session(participant_id)
        if active_session:
            # Skip step
            if any(phrase in user_lower for phrase in ["skip step", "skip this", "next step"]):
                success = await self.skip_current_step(active_session)
                return {
                    "handled": True,
                    "response": "Step skipped." if success else "Could not skip step."
                }

            # Abort plan
            if any(phrase in user_lower for phrase in ["abort plan", "stop plan", "cancel plan"]):
                success = await self.abort_plan(active_session)
                return {
                    "handled": True,
                    "response": "Plan stopped." if success else "Could not stop plan."
                }

            # Plan status
            if any(phrase in user_lower for phrase in ["plan status", "plan progress", "where are we"]):
                status = await self.get_plan_status(active_session)
                if status:
                    progress = status["progress"]
                    return {
                        "handled": True,
                        "response": f"Plan progress: {progress['completed_steps']}/{progress['total_steps']} steps completed ({progress['percentage']:.1f}%)",
                        "status": status
                    }

        return {"handled": False}

    def cleanup_sessions(self, max_age_hours: int = 24) -> int:
        """Cleanup old sessions."""
        return self.state_manager.cleanup_inactive_sessions(max_age_hours)