"""AgentOutput dataclass for messages from agent to session-management."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional
import uuid

from stella_agent_sdk.messages.types import OutputType, StatusSubtype, MetadataSubtype, AgentState


@dataclass
class AgentOutput:
    """
    Output message from the agent to session-management.

    This is what your agent sends back. Session-management will:
    - TEXT_CHUNK: Stream to frontend display + buffer for TTS
    - TEXT_FINAL: Final text, trigger TTS synthesis
    - STATUS: Display processing status to user (no TTS)
    - METADATA: Update plan/deliverable state (no TTS)
    - ERROR: Display error to user

    Attributes:
        session_id: The session this output belongs to.
        type: The type of output (TEXT_CHUNK, TEXT_FINAL, STATUS, etc.).
        content: The text content (response text, status message, or JSON).
        is_final: For TEXT_CHUNK, whether this is the last chunk in the stream.
        transcript_id: Groups streaming chunks into one logical message.
        status_subtype: For STATUS type, the specific status category.
        metadata_subtype: For METADATA type, the specific metadata category.
        metadata: Additional data (progress percentage, error details, etc.).
        timestamp: When this output was created.
    """

    session_id: str
    type: OutputType
    content: str = ""
    is_final: bool = False
    transcript_id: Optional[str] = None
    status_subtype: Optional[StatusSubtype] = None
    metadata_subtype: Optional[MetadataSubtype] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)

    # --- Factory methods for TEXT outputs ---

    @classmethod
    def text_chunk(
        cls,
        session_id: str,
        text: str,
        transcript_id: Optional[str] = None,
        is_final: bool = False,
    ) -> "AgentOutput":
        """
        Create a streaming text chunk.

        Use this to stream response text token-by-token or chunk-by-chunk.
        Session-management will display immediately and buffer for TTS.

        Args:
            session_id: The session ID.
            text: The text chunk to send.
            transcript_id: ID to group chunks (auto-generated if not provided).
            is_final: Whether this is the last chunk in the stream.
        """
        return cls(
            session_id=session_id,
            type=OutputType.TEXT_CHUNK,
            content=text,
            transcript_id=transcript_id or str(uuid.uuid4()),
            is_final=is_final,
        )

    @classmethod
    def text_final(
        cls,
        session_id: str,
        text: str,
        transcript_id: Optional[str] = None,
    ) -> "AgentOutput":
        """
        Create a final/complete text message.

        Use this when you have the complete response (not streaming).
        Session-management will display and immediately synthesize TTS.

        Args:
            session_id: The session ID.
            text: The complete response text.
            transcript_id: Optional ID for this message.
        """
        return cls(
            session_id=session_id,
            type=OutputType.TEXT_FINAL,
            content=text,
            transcript_id=transcript_id or str(uuid.uuid4()),
            is_final=True,
        )

    # --- Factory methods for STATUS outputs ---

    @classmethod
    def status(
        cls,
        session_id: str,
        message: str,
        subtype: StatusSubtype = StatusSubtype.PROCESSING,
        progress: Optional[float] = None,
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """
        Create a status update message.

        Use this to inform the user about processing status.
        No TTS will be triggered for status messages.

        Args:
            session_id: The session ID.
            message: Status message to display.
            subtype: The status category.
            progress: Optional progress percentage (0.0 to 1.0).
            **extra_metadata: Additional metadata to include.
        """
        metadata = {**extra_metadata}
        if progress is not None:
            metadata["progress"] = progress
        return cls(
            session_id=session_id,
            type=OutputType.STATUS,
            content=message,
            status_subtype=subtype,
            metadata=metadata,
        )

    @classmethod
    def thinking(cls, session_id: str, message: str = "Thinking...") -> "AgentOutput":
        """Create a 'thinking' status message."""
        return cls.status(session_id, message, StatusSubtype.THINKING)

    @classmethod
    def processing(cls, session_id: str, message: str = "Processing...") -> "AgentOutput":
        """Create a 'processing' status message."""
        return cls.status(session_id, message, StatusSubtype.PROCESSING)

    # --- Factory methods for METADATA outputs ---

    @classmethod
    def metadata_update(
        cls,
        session_id: str,
        subtype: MetadataSubtype,
        data: Dict[str, Any],
    ) -> "AgentOutput":
        """
        Create a metadata update message.

        Use this to update plan state, deliverables, etc.
        No TTS will be triggered for metadata messages.

        Args:
            session_id: The session ID.
            subtype: The metadata category.
            data: The metadata payload.
        """
        import json
        return cls(
            session_id=session_id,
            type=OutputType.METADATA,
            content=json.dumps(data),
            metadata_subtype=subtype,
            metadata=data,
        )

    @classmethod
    def deliverable(
        cls,
        session_id: str,
        key: str,
        value: Any,
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """Create a deliverable update message."""
        return cls.metadata_update(
            session_id,
            MetadataSubtype.DELIVERABLE,
            {"key": key, "value": value, **extra_metadata},
        )

    @classmethod
    def progress(cls, session_id: str, percentage: float, message: str = "") -> "AgentOutput":
        """Create a progress update message (0.0 to 1.0 or 0 to 100)."""
        # Normalize to 0.0-1.0
        if percentage > 1.0:
            percentage = percentage / 100.0
        return cls.metadata_update(
            session_id,
            MetadataSubtype.PROGRESS,
            {"percentage": percentage, "message": message},
        )

    # --- Factory methods for ERROR outputs ---

    @classmethod
    def error(
        cls,
        session_id: str,
        message: str,
        error_type: str = "processing_error",
        recoverable: bool = True,
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """
        Create an error message.

        Use this to report errors to the user.

        Args:
            session_id: The session ID.
            message: Error message to display.
            error_type: Category of error.
            recoverable: Whether the session can continue.
            **extra_metadata: Additional error details.
        """
        return cls(
            session_id=session_id,
            type=OutputType.ERROR,
            content=message,
            metadata={
                "error_type": error_type,
                "recoverable": recoverable,
                **extra_metadata,
            },
        )

    # --- Factory methods for PROGRESS_UPDATE outputs ---

    @classmethod
    def progress_update(
        cls,
        session_id: str,
        progress_state: "ProgressState",
        update_trigger: str = "turn_completion",
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """
        Create a progress/task tracking update message.

        Use this to send task panel updates to the frontend. The progress state
        contains groups of items that can be displayed in a todo-list style UI.

        Args:
            session_id: The session ID.
            progress_state: The complete progress state (from stella_agent_sdk.progress)
                           or a dict in the same format.
            update_trigger: What triggered this update (e.g., "turn_completion",
                           "state_change", "item_collected").
            **extra_metadata: Additional metadata to include.

        Example:
            from stella_agent_sdk.progress import ProgressState, ProgressGroup, ProgressItem

            state = ProgressState(
                groups=[
                    ProgressGroup(
                        id="intake",
                        label="Patient Intake",
                        execution_mode=ExecutionMode.FLEXIBLE,
                        items=[
                            ProgressItem(id="name", label="Name", status=ItemStatus.COMPLETED, value="John"),
                            ProgressItem(id="dob", label="DOB", status=ItemStatus.PENDING),
                        ]
                    )
                ],
                current_group_id="intake",
            )
            yield AgentOutput.progress_update(session_id, state)
        """
        import json
        from datetime import datetime

        # Support both ProgressState objects and plain dicts
        if hasattr(progress_state, 'to_dict'):
            data = progress_state.to_dict()
        elif isinstance(progress_state, dict):
            data = progress_state.copy()
        else:
            raise TypeError(f"progress_state must be ProgressState or dict, got {type(progress_state)}")

        data["update_trigger"] = update_trigger
        data["timestamp"] = datetime.utcnow().isoformat() + "Z"

        return cls(
            session_id=session_id,
            type=OutputType.PROGRESS_UPDATE,
            content=json.dumps(data),
            metadata={
                "progress_state": data,
                "update_trigger": update_trigger,
                **extra_metadata,
            },
        )

    # --- Factory methods for DEBUG outputs ---

    @classmethod
    def debug(
        cls,
        session_id: str,
        message: str,
        component: str = "agent",
        level: str = "info",
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """
        Create a debug/log message.

        Use this to communicate internal processing steps for transparency.
        These are displayed in debug UI but not spoken via TTS.

        Args:
            session_id: The session ID.
            message: Debug message to display.
            component: Which component is logging (e.g., "input_gate", "expert_pool").
            level: Log level ("info", "warn", "error").
            **extra_metadata: Additional debug data.
        """
        return cls(
            session_id=session_id,
            type=OutputType.DEBUG,
            content=message,
            metadata={
                "component": component,
                "level": level,
                **extra_metadata,
            },
        )

    # --- Factory methods for ANALYTICS outputs ---

    @classmethod
    def analytics(
        cls,
        session_id: str,
        stage: str,
        timing_ms: float,
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """
        Create an analytics timing measurement.

        Stored for aggregation, not displayed to users, not spoken via TTS.

        Args:
            session_id: The session ID.
            stage: Pipeline stage name (e.g., "input_gate", "expert_pool", "aggregator").
            timing_ms: Duration of this stage in milliseconds.
            **extra_metadata: Additional context (e.g., expert_count, model).
        """
        return cls(
            session_id=session_id,
            type=OutputType.ANALYTICS,
            content="",
            metadata={
                "stage": stage,
                "timing_ms": timing_ms,
                **extra_metadata,
            },
        )

    @classmethod
    def analytics_event(
        cls,
        session_id: str,
        stage: str,
        turn_id: str,
        elapsed_ms: float,
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """
        Create a raw timestamped analytics event (elapsed_ms relative to stt_end).

        Unlike analytics(), this does not carry a pre-computed timing delta.
        Instead it records the elapsed time since stt_end for a specific event,
        allowing the dashboard to compute intervals between any pair of events.

        Args:
            session_id: The session ID.
            stage: Event name (e.g., "bridge_start", "response_first_token").
            turn_id: Groups events into conversational turns.
            elapsed_ms: Milliseconds since stt_end (ground zero). Negative for pre-stt events.
            **extra_metadata: Additional context.
        """
        return cls(
            session_id=session_id,
            type=OutputType.ANALYTICS,
            content="",
            metadata={
                "stage": stage,
                "turn_id": turn_id,
                "elapsed_ms": elapsed_ms,
                **extra_metadata,
            },
        )

    # --- Factory methods for HEALTH_STATUS outputs ---

    @classmethod
    def health_status(
        cls,
        session_id: str,
        request_id: str,
        state: AgentState,
        agent_type: str,
        agent_version: str,
        uptime_seconds: int,
        messages_processed: int,
        last_error: Optional[str] = None,
        **extra_metadata: Any,
    ) -> "AgentOutput":
        """
        Create a health status response.

        Use this to respond to health check requests from session-management.
        This is sent via the bidirectional stream when the server requests
        health status.

        Args:
            session_id: The session ID.
            request_id: The correlation ID from the health check request.
            state: The current agent state.
            agent_type: Type of agent (e.g., "StellaAgent").
            agent_version: Agent version string.
            uptime_seconds: How long the agent has been running.
            messages_processed: Number of messages processed.
            last_error: Last error message (if any).
            **extra_metadata: Additional health metadata.
        """
        return cls(
            session_id=session_id,
            type=OutputType.HEALTH_STATUS,
            content="",
            metadata={
                "request_id": request_id,
                "state": state.value,
                "agent_type": agent_type,
                "agent_version": agent_version,
                "uptime_seconds": uptime_seconds,
                "messages_processed": messages_processed,
                "last_error": last_error,
                **extra_metadata,
            },
        )
