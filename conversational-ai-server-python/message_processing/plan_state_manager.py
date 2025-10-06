"""
Plan State Manager for handling step-by-step plan execution state.
Manages plan state transitions, deliverable validation, and step progression.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass, field
from enum import Enum


class PlanState(Enum):
    """Allowed plan states."""
    IDLE = "idle"
    IN_PROGRESS = "in_progress"
    WAITING_FOR_USER = "waiting_for_user"
    VALIDATING = "validating"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    ABORTED = "aborted"


class StepType(Enum):
    """Types of plan steps."""
    QUESTION = "Question"
    STATEMENT = "Statement"


class DeliverableType(Enum):
    """Types of deliverables."""
    STRING = "string"
    NUMBER = "number"
    DATE = "date"
    EMAIL = "email"
    ENUM = "enum"


@dataclass
class Deliverable:
    """A deliverable that needs to be collected in a step."""
    key: str
    type: DeliverableType
    required: bool = True
    enum_values: Optional[List[str]] = None
    description: Optional[str] = None
    value: Optional[Any] = None
    validated: bool = False


@dataclass
class Step:
    """A step in a plan."""
    id: str
    type: StepType
    title: str
    instruction: str
    deliverables: List[Deliverable] = field(default_factory=list)
    done_when: Optional[Dict[str, Any]] = None
    state: PlanState = PlanState.IDLE
    completed_at: Optional[datetime] = None
    attempts: int = 0
    max_attempts: int = 3


@dataclass
class Plan:
    """A complete plan definition."""
    id: str
    title: str
    description: str
    steps: List[Step]
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)


@dataclass
class PlanSession:
    """A plan execution session."""
    session_id: str
    plan: Plan
    current_step_id: Optional[str] = None
    state: PlanState = PlanState.IDLE
    history: List[Dict[str, Any]] = field(default_factory=list)
    deliverables: Dict[str, Any] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.now)
    last_activity: datetime = field(default_factory=datetime.now)


class PlanStateManager:
    """Manages plan execution state and deliverable validation."""

    def __init__(self):
        self.active_sessions: Dict[str, PlanSession] = {}

    def create_session(self, plan: Plan, participant_id: str = "default") -> str:
        """Create a new plan session."""
        session_id = f"{participant_id}_{plan.id}_{uuid.uuid4().hex[:8]}"
        session = PlanSession(
            session_id=session_id,
            plan=plan,
            state=PlanState.IDLE
        )
        self.active_sessions[session_id] = session
        return session_id

    def get_session(self, session_id: str) -> Optional[PlanSession]:
        """Get a plan session by ID."""
        return self.active_sessions.get(session_id)

    def start_plan(self, session_id: str) -> bool:
        """Start plan execution."""
        session = self.get_session(session_id)
        if not session or not session.plan.steps:
            return False

        # Set first step as current
        first_step = session.plan.steps[0]
        session.current_step_id = first_step.id
        session.state = PlanState.IN_PROGRESS
        first_step.state = PlanState.IN_PROGRESS
        session.last_activity = datetime.now(timezone.utc)

        self._log_activity(session, "plan_started", {"step_id": first_step.id})
        return True

    def get_current_step(self, session_id: str) -> Optional[Step]:
        """Get the current active step."""
        session = self.get_session(session_id)
        if not session or not session.current_step_id:
            return None

        for step in session.plan.steps:
            if step.id == session.current_step_id:
                return step
        return None

    def process_user_input(self, session_id: str, user_input: str, input_type: str = "text") -> Dict[str, Any]:
        """Process user input for the current step."""
        session = self.get_session(session_id)
        current_step = self.get_current_step(session_id)

        if not session or not current_step:
            return {"success": False, "error": "No active step"}

        # Update last activity
        session.last_activity = datetime.now(timezone.utc)
        current_step.attempts += 1

        # For Question steps, collect deliverables
        if current_step.type == StepType.QUESTION:
            return self._handle_question_input(session, current_step, user_input)

        # For Statement steps, just acknowledge
        elif current_step.type == StepType.STATEMENT:
            return self._handle_statement_input(session, current_step, user_input)

        return {"success": False, "error": "Unknown step type"}

    def _handle_question_input(self, session: PlanSession, step: Step, user_input: str) -> Dict[str, Any]:
        """Handle input for a Question step."""
        result = {
            "success": False,
            "deliverables_updated": {},
            "validation_errors": [],
            "step_complete": False
        }

        # Simple deliverable extraction (can be enhanced with NLP)
        for deliverable in step.deliverables:
            if not deliverable.value:  # Only process unset deliverables
                extracted_value = self._extract_deliverable_value(
                    user_input, deliverable, step
                )

                if extracted_value is not None:
                    validation_result = self._validate_deliverable_value(
                        extracted_value, deliverable
                    )

                    if validation_result["valid"]:
                        deliverable.value = extracted_value
                        deliverable.validated = True
                        session.deliverables[deliverable.key] = extracted_value
                        result["deliverables_updated"][deliverable.key] = extracted_value
                    else:
                        result["validation_errors"].append({
                            "key": deliverable.key,
                            "error": validation_result["error"]
                        })

        # Check if step is complete
        if self._is_step_complete(step):
            result["step_complete"] = True
            result["success"] = True
            self._complete_current_step(session)
        else:
            # Set to waiting for more input
            step.state = PlanState.WAITING_FOR_USER
            result["success"] = True

        self._log_activity(session, "user_input_processed", {
            "step_id": step.id,
            "input": user_input,
            "deliverables_updated": result["deliverables_updated"],
            "step_complete": result["step_complete"]
        })

        return result

    def _handle_statement_input(self, session: PlanSession, step: Step, user_input: str) -> Dict[str, Any]:
        """Handle input for a Statement step."""
        # Statement steps are completed immediately after presentation
        self._complete_current_step(session)

        self._log_activity(session, "statement_acknowledged", {
            "step_id": step.id,
            "input": user_input
        })

        return {
            "success": True,
            "step_complete": True,
            "deliverables_updated": {},
            "validation_errors": []
        }

    def _extract_deliverable_value(self, user_input: str, deliverable: Deliverable, step: Step) -> Optional[Any]:
        """Extract deliverable value from user input (basic implementation)."""
        user_lower = user_input.lower().strip()

        if deliverable.type == DeliverableType.STRING:
            # For string deliverables, use the entire input (can be refined)
            return user_input.strip()

        elif deliverable.type == DeliverableType.EMAIL:
            # Simple email detection
            import re
            email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
            emails = re.findall(email_pattern, user_input)
            return emails[0] if emails else None

        elif deliverable.type == DeliverableType.NUMBER:
            # Extract first number found
            import re
            numbers = re.findall(r'-?\d+\.?\d*', user_input)
            if numbers:
                try:
                    return float(numbers[0]) if '.' in numbers[0] else int(numbers[0])
                except ValueError:
                    return None
            return None

        elif deliverable.type == DeliverableType.ENUM:
            # Check if any enum value is mentioned
            if deliverable.enum_values:
                for enum_value in deliverable.enum_values:
                    if enum_value.lower() in user_lower:
                        return enum_value
            return None

        elif deliverable.type == DeliverableType.DATE:
            # Basic date extraction (can be enhanced)
            import re
            # Look for common date patterns
            date_patterns = [
                r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',
                r'\d{4}-\d{1,2}-\d{1,2}',
                r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}[,\s]+\d{2,4}'
            ]

            for pattern in date_patterns:
                dates = re.findall(pattern, user_input, re.IGNORECASE)
                if dates:
                    return dates[0]
            return None

        return None

    def _validate_deliverable_value(self, value: Any, deliverable: Deliverable) -> Dict[str, Any]:
        """Validate a deliverable value."""
        if deliverable.type == DeliverableType.EMAIL:
            import re
            email_pattern = r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'
            if not re.match(email_pattern, str(value)):
                return {"valid": False, "error": "Invalid email format"}

        elif deliverable.type == DeliverableType.ENUM:
            if deliverable.enum_values and value not in deliverable.enum_values:
                return {"valid": False, "error": f"Value must be one of: {', '.join(deliverable.enum_values)}"}

        elif deliverable.type == DeliverableType.NUMBER:
            try:
                float(value)
            except (ValueError, TypeError):
                return {"valid": False, "error": "Value must be a number"}

        return {"valid": True}

    def _is_step_complete(self, step: Step) -> bool:
        """Check if a step is complete based on deliverables and done_when rules."""
        # Check required deliverables
        for deliverable in step.deliverables:
            if deliverable.required and not deliverable.validated:
                return False

        # Check done_when conditions (if specified)
        if step.done_when:
            # Basic implementation - can be enhanced with complex rule evaluation
            return True  # For now, assume complete if deliverables are satisfied

        return True

    def _complete_current_step(self, session: PlanSession) -> bool:
        """Complete the current step and advance to next."""
        current_step = self.get_current_step(session.session_id)
        if not current_step:
            return False

        # Mark current step as completed
        current_step.state = PlanState.COMPLETED
        current_step.completed_at = datetime.now(timezone.utc)

        # Find next step
        current_index = next(
            (i for i, step in enumerate(session.plan.steps) if step.id == current_step.id),
            -1
        )

        if current_index >= 0 and current_index + 1 < len(session.plan.steps):
            # Move to next step
            next_step = session.plan.steps[current_index + 1]
            session.current_step_id = next_step.id
            next_step.state = PlanState.IN_PROGRESS

            self._log_activity(session, "step_completed", {
                "completed_step": current_step.id,
                "next_step": next_step.id
            })
        else:
            # Plan completed
            session.current_step_id = None
            session.state = PlanState.COMPLETED

            self._log_activity(session, "plan_completed", {
                "completed_step": current_step.id,
                "total_steps": len(session.plan.steps)
            })

        return True

    def skip_current_step(self, session_id: str) -> bool:
        """Skip the current step."""
        session = self.get_session(session_id)
        current_step = self.get_current_step(session_id)

        if not session or not current_step:
            return False

        current_step.state = PlanState.SKIPPED
        current_step.completed_at = datetime.now(timezone.utc)

        self._log_activity(session, "step_skipped", {"step_id": current_step.id})

        return self._complete_current_step(session)

    def abort_plan(self, session_id: str, reason: str = "user_requested") -> bool:
        """Abort the plan execution."""
        session = self.get_session(session_id)
        if not session:
            return False

        session.state = PlanState.ABORTED

        # Mark current step as aborted
        current_step = self.get_current_step(session_id)
        if current_step:
            current_step.state = PlanState.ABORTED

        self._log_activity(session, "plan_aborted", {"reason": reason})
        return True

    def get_plan_progress(self, session_id: str) -> Dict[str, Any]:
        """Get current plan progress information."""
        session = self.get_session(session_id)
        if not session:
            return {"error": "Session not found"}

        total_steps = len(session.plan.steps)
        completed_steps = sum(1 for step in session.plan.steps if step.state == PlanState.COMPLETED)
        skipped_steps = sum(1 for step in session.plan.steps if step.state == PlanState.SKIPPED)

        current_step = self.get_current_step(session_id)

        return {
            "session_id": session_id,
            "plan_id": session.plan.id,
            "plan_title": session.plan.title,
            "state": session.state.value,
            "current_step": {
                "id": current_step.id if current_step else None,
                "title": current_step.title if current_step else None,
                "type": current_step.type.value if current_step else None,
                "instruction": current_step.instruction if current_step else None,
                "deliverables": [
                    {
                        "key": d.key,
                        "type": d.type.value,
                        "required": d.required,
                        "description": d.description,
                        "value": d.value,
                        "validated": d.validated
                    } for d in (current_step.deliverables if current_step else [])
                ]
            } if current_step else None,
            "progress": {
                "total_steps": total_steps,
                "completed_steps": completed_steps,
                "skipped_steps": skipped_steps,
                "remaining_steps": total_steps - completed_steps - skipped_steps,
                "percentage": (completed_steps + skipped_steps) / total_steps * 100 if total_steps > 0 else 0
            },
            "deliverables": session.deliverables,
            "started_at": session.started_at.isoformat(),
            "last_activity": session.last_activity.isoformat()
        }

    def _log_activity(self, session: PlanSession, activity_type: str, data: Dict[str, Any]):
        """Log activity to session history."""
        session.history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": activity_type,
            "data": data
        })

        # Keep last 50 activities
        if len(session.history) > 50:
            session.history = session.history[-50:]

    def cleanup_inactive_sessions(self, max_age_hours: int = 24):
        """Clean up inactive sessions."""
        from datetime import timedelta

        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
        inactive_sessions = [
            session_id for session_id, session in self.active_sessions.items()
            if session.last_activity < cutoff_time
        ]

        for session_id in inactive_sessions:
            del self.active_sessions[session_id]

        return len(inactive_sessions)

    def get_all_sessions(self) -> List[Dict[str, Any]]:
        """Get summary of all active sessions."""
        return [
            {
                "session_id": session_id,
                "plan_id": session.plan.id,
                "plan_title": session.plan.title,
                "state": session.state.value,
                "current_step_id": session.current_step_id,
                "started_at": session.started_at.isoformat(),
                "last_activity": session.last_activity.isoformat()
            }
            for session_id, session in self.active_sessions.items()
        ]