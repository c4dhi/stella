"""
Stream service for sending messages to frontend via LiveKit data channels.
Handles different message types: transcript chunks, decision streams, expert status, etc.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from livekit import rtc


class StreamService:
    """Service for streaming messages to the frontend via LiveKit data channels."""

    def __init__(self, room: rtc.Room, agent_name: str = "task-manager", agent_icon: str = "🤖"):
        self.room = room
        self.agent_name = agent_name
        self.agent_icon = agent_icon

    async def send_transcript_chunk(
        self,
        text: str,
        is_final: bool = True,
        participant_id: Optional[str] = None,
        transcript_id: Optional[str] = None,
        confidence: float = 1.0
    ) -> bool:
        """Send a transcript chunk to the frontend."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "transcript_chunk",
            "data": {
                "text": text,
                "is_final": is_final,
                "confidence": confidence,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "participant_id": participant_id,
                "chunk_id": f"python_{uuid.uuid4().hex[:8]}",
                "transcript_id": transcript_id or f"python_transcript_{uuid.uuid4().hex[:8]}"
            }
        }
        return await self._send_message(message)

    async def send_decision_stream(
        self,
        step: str,
        decision: str,
        confidence: float = 1.0,
        timing_ms: int = 0,
        metadata: Optional[Dict[str, Any]] = None,
        participant_id: Optional[str] = None,
        stream_id: str = "python-stream"
    ) -> bool:
        """Send a decision stream update."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "decision_stream",
            "data": {
                "step": step,
                "decision": decision,
                "confidence": confidence,
                "timing_ms": timing_ms,
                "metadata": metadata or {},
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_expert_status(
        self,
        expert_name: str,
        status: str,  # 'started', 'progress', 'completed', 'timeout', 'error'
        progress_percent: Optional[float] = None,
        intermediate_finding: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        participant_id: Optional[str] = None,
        stream_id: str = "python-stream"
    ) -> bool:
        """Send expert status update."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "expert_status",
            "data": {
                "expert_name": expert_name,
                "status": status,
                "progress_percent": progress_percent,
                "intermediate_finding": intermediate_finding,
                "metadata": metadata or {},
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_thinking_message(
        self,
        message_text: str,
        stage: str,  # 'analyzing', 'consulting_experts', 'synthesizing', 'finalizing'
        estimated_duration_ms: int = 5000,
        is_placeholder: bool = True,
        participant_id: Optional[str] = None,
        stream_id: str = "python-stream"
    ) -> bool:
        """Send a thinking message update."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "thinking_message",
            "data": {
                "message": message_text,
                "stage": stage,
                "estimated_duration_ms": estimated_duration_ms,
                "is_placeholder": is_placeholder,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_expert_results(
        self,
        expert_results: list,
        total_experts: int,
        successful_count: int,
        failed_count: int,
        participant_id: Optional[str] = None,
        stream_id: str = "python-stream"
    ) -> bool:
        """Send expert analysis results to frontend as status update."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "expert_results",
            "data": {
                "results": expert_results,
                "summary": {
                    "total_experts": total_experts,
                    "successful_count": successful_count,
                    "failed_count": failed_count
                },
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_system_assessment(
        self,
        issue_type: str,
        situation_assessment: str,
        severity: str = "warning",  # "info", "warning", "error", "critical"
        impact_analysis: Optional[str] = None,
        aggregator_recommendations: Optional[Dict[str, str]] = None,
        user_communication_strategy: Optional[str] = None,
        technical_details: Optional[str] = None,
        participant_id: Optional[str] = None,
        stream_id: str = "python-stream"
    ) -> bool:
        """Send comprehensive system assessment to frontend and aggregator."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "system_assessment",
            "data": {
                "issue_type": issue_type,
                "situation_assessment": situation_assessment,
                "severity": severity,
                "impact_analysis": impact_analysis,
                "aggregator_recommendations": aggregator_recommendations or {},
                "user_communication_strategy": user_communication_strategy,
                "technical_details": technical_details,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_system_issue(
        self,
        issue_type: str,
        issue_description: str,
        severity: str = "warning",  # "info", "warning", "error", "critical"
        suggested_action: Optional[str] = None,
        technical_details: Optional[str] = None,
        participant_id: Optional[str] = None,
        stream_id: str = "python-stream"
    ) -> bool:
        """Send system issue notification to frontend (legacy method)."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "system_issue",
            "data": {
                "issue_type": issue_type,
                "description": issue_description,
                "severity": severity,
                "suggested_action": suggested_action,
                "technical_details": technical_details,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def _send_message(self, message: Dict[str, Any]) -> bool:
        """Send a message to the frontend via LiveKit data channel."""
        try:
            message_json = json.dumps(message)
            message_bytes = message_json.encode("utf-8")
            await self.room.local_participant.publish_data(message_bytes, reliable=True)
            return True
        except Exception as e:
            print(f"[StreamService] Failed to send message: {e}")
            return False

    async def send_message(self, message: Dict[str, Any]) -> bool:
        """
        Send arbitrary message to frontend via data channel.

        Public wrapper for _send_message() to allow sending custom messages
        (e.g., agent_speaking_start, agent_speaking_stop from TTS providers).

        Args:
            message: Dictionary containing message type and data

        Returns:
            bool: True if message sent successfully, False otherwise
        """
        return await self._send_message(message)

    async def send_plan_started(
        self,
        plan_id: str,
        plan_title: str,
        session_id: str,
        total_steps: int,
        participant_id: Optional[str] = None,
        stream_id: str = "plan-stream"
    ) -> bool:
        """Send plan started notification."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "plan_started",
            "data": {
                "plan_id": plan_id,
                "plan_title": plan_title,
                "session_id": session_id,
                "total_steps": total_steps,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_plan_step_update(
        self,
        session_id: str,
        step_id: str,
        step_title: str,
        step_type: str,
        instruction: str,
        response: str,
        deliverables: list,
        participant_id: Optional[str] = None,
        stream_id: str = "plan-stream"
    ) -> bool:
        """Send plan step update."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "plan_step_update",
            "data": {
                "session_id": session_id,
                "step_id": step_id,
                "step_title": step_title,
                "step_type": step_type,
                "instruction": instruction,
                "response": response,
                "deliverables": deliverables,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_plan_progress_update(
        self,
        session_id: str,
        progress: Dict[str, Any],
        current_step: Optional[Dict[str, Any]] = None,
        deliverables: Optional[Dict[str, Any]] = None,
        participant_id: Optional[str] = None,
        stream_id: str = "plan-stream"
    ) -> bool:
        """Send plan progress update."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "plan_progress_update",
            "data": {
                "session_id": session_id,
                "progress": progress,
                "current_step": current_step,
                "deliverables": deliverables or {},
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_plan_completed(
        self,
        session_id: str,
        plan_id: str,
        plan_title: str,
        deliverables: Dict[str, Any],
        completion_time: str,
        participant_id: Optional[str] = None,
        stream_id: str = "plan-stream"
    ) -> bool:
        """Send plan completion notification."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "plan_completed",
            "data": {
                "session_id": session_id,
                "plan_id": plan_id,
                "plan_title": plan_title,
                "deliverables": deliverables,
                "completion_time": completion_time,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_plan_aborted(
        self,
        session_id: str,
        plan_id: str,
        plan_title: str,
        reason: str,
        participant_id: Optional[str] = None,
        stream_id: str = "plan-stream"
    ) -> bool:
        """Send plan aborted notification."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "plan_aborted",
            "data": {
                "session_id": session_id,
                "plan_id": plan_id,
                "plan_title": plan_title,
                "reason": reason,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_plan_deliverable_update(
        self,
        session_id: str,
        deliverable_key: str,
        deliverable_value: Any,
        step_id: str,
        participant_id: Optional[str] = None,
        stream_id: str = "plan-stream",
        reasoning: str = None
    ) -> bool:
        """Send plan deliverable update."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message_data = {
            "session_id": session_id,
            "deliverable_key": deliverable_key,
            "deliverable_value": deliverable_value,
            "step_id": step_id,
            "participant_id": participant_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stream_id": stream_id
        }

        # Include reasoning if provided
        if reasoning:
            message_data["reasoning"] = reasoning

        message = {
            "type": "plan_deliverable_update",
            "data": message_data
        }
        return await self._send_message(message)

    async def send_task_progress_update(
        self,
        update_type: str,
        current_step: Dict[str, Any],
        progress: Dict[str, Any],
        tasks: Dict[str, Any],
        steps: list,
        metadata: Optional[Dict[str, Any]] = None,
        participant_id: Optional[str] = None,
        stream_id: str = "task-stream"
    ) -> bool:
        """Send task progress update to frontend."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "task_progress_update",
            "data": {
                "update_type": update_type,
                "current_step": current_step,
                "progress": progress,
                "tasks": tasks,
                "steps": steps,
                "metadata": metadata or {},
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_step_change_notification(
        self,
        previous_step: Optional[str],
        current_step: str,
        step_title: str,
        step_description: str,
        action_taken: str,
        participant_id: Optional[str] = None,
        stream_id: str = "task-stream"
    ) -> bool:
        """Send step change notification to frontend."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "step_change_notification",
            "data": {
                "previous_step": previous_step,
                "current_step": current_step,
                "step_title": step_title,
                "step_description": step_description,
                "action_taken": action_taken,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_task_update(
        self,
        task_id: str,
        task_description: str,
        task_status: str,
        step_id: str,
        action_taken: str,  # "created", "updated", "completed", "skipped"
        participant_id: Optional[str] = None,
        stream_id: str = "task-stream"
    ) -> bool:
        """Send individual task update to frontend."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "task_update",
            "data": {
                "task_id": task_id,
                "task_description": task_description,
                "task_status": task_status,
                "step_id": step_id,
                "action_taken": action_taken,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_complete_todo_list(
        self,
        todo_list_data: Dict[str, Any],
        update_trigger: str = "turn_completion",  # "first_message", "turn_completion", "step_change", "task_update"
        participant_id: Optional[str] = None,
        stream_id: str = "todo-list-stream"
    ) -> bool:
        """Send complete todo list with all fields for frontend state management."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "complete_todo_list",
            "data": {
                **todo_list_data,  # Include all the rich todo list data
                "update_trigger": update_trigger,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    async def send_decision_message(
        self,
        session_id: str,
        deliverable_key: str,
        deliverable_value: Any,
        path_chosen: str,  # "continue" or "skip"
        next_action: Dict[str, Any],  # What happens next (tasks or state transition)
        task_id: str,
        state_id: str,
        participant_id: Optional[str] = None,
        stream_id: str = "decision-stream"
    ) -> bool:
        """Send conditional decision message to frontend for transparency."""
        # Use agent_name as default participant_id if not provided
        if participant_id is None:
            participant_id = self.agent_name

        message = {
            "type": "decision_message",
            "data": {
                "session_id": session_id,
                "deliverable_key": deliverable_key,
                "deliverable_value": deliverable_value,
                "path_chosen": path_chosen,
                "next_action": next_action,
                "task_id": task_id,
                "state_id": state_id,
                "participant_id": participant_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "stream_id": stream_id
            }
        }
        return await self._send_message(message)

    def generate_stream_id(self) -> str:
        """Generate a unique stream ID."""
        return f"python_stream_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{uuid.uuid4().hex[:8]}"