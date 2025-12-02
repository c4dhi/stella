"""AgentInput dataclass for messages from session-management to agent."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from grace_agent_sdk.messages.types import InputType


@dataclass
class AgentInput:
    """
    Input message from session-management to the agent.

    This is what your agent receives. The session-management server handles
    STT and sends you transcribed text. You process it and return text.

    Attributes:
        session_id: Unique identifier for this session.
        type: The type of input (TEXT, INTERRUPT, SESSION_START, etc.).
        text: The user's transcribed speech or typed text (for TEXT type).
        conversation_history: Previous conversation turns for context.
        metadata: Additional context (plan info, user preferences, etc.).
        timestamp: When this input was created.
    """

    session_id: str
    type: InputType
    text: str = ""
    conversation_history: Optional[List[Dict[str, str]]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)

    @classmethod
    def text_input(
        cls,
        session_id: str,
        text: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        **metadata: Any,
    ) -> "AgentInput":
        """Create a TEXT input message."""
        return cls(
            session_id=session_id,
            type=InputType.TEXT,
            text=text,
            conversation_history=conversation_history,
            metadata=metadata,
        )

    @classmethod
    def interrupt(cls, session_id: str, reason: str = "user_barge_in") -> "AgentInput":
        """Create an INTERRUPT input message."""
        return cls(
            session_id=session_id,
            type=InputType.INTERRUPT,
            metadata={"reason": reason},
        )

    @classmethod
    def session_start(
        cls,
        session_id: str,
        config: Dict[str, Any],
    ) -> "AgentInput":
        """Create a SESSION_START input message with configuration."""
        return cls(
            session_id=session_id,
            type=InputType.SESSION_START,
            metadata=config,
        )

    @classmethod
    def session_end(cls, session_id: str) -> "AgentInput":
        """Create a SESSION_END input message."""
        return cls(
            session_id=session_id,
            type=InputType.SESSION_END,
        )

    @classmethod
    def config_update(cls, session_id: str, config: Dict[str, Any]) -> "AgentInput":
        """Create a CONFIG input message for runtime configuration updates."""
        return cls(
            session_id=session_id,
            type=InputType.CONFIG,
            metadata=config,
        )
