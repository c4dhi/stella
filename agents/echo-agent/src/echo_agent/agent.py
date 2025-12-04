"""
Echo Agent - Simple test agent that echoes user input.

This agent is useful for testing the agent deployment pipeline
without requiring any external dependencies like LLMs.
"""

from typing import AsyncIterator, Dict, Any

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput


class EchoAgent(BaseAgent):
    """
    Simple echo agent for testing.

    Echoes back user input with "You said: {input}".
    Useful for testing the full agent deployment pipeline.
    """

    def __init__(self):
        """Initialize the Echo Agent."""
        super().__init__()
        self._agent_type = "echo-agent"
        self._agent_version = "0.1.0"
        self._message_count = 0
        print("[EchoAgent] Initialized")

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """
        Process user input by echoing it back.

        Args:
            input: AgentInput containing user text

        Yields:
            AgentOutput with the echoed message
        """
        self._is_processing = True
        self._message_count += 1
        self._messages_processed += 1

        try:
            print(f"[EchoAgent] Received: '{input.text}'")

            # Debug: Processing started
            yield AgentOutput.debug(
                input.session_id,
                f"Received message #{self._message_count}: '{input.text[:50]}{'...' if len(input.text) > 50 else ''}'",
                component="echo_agent",
                level="info"
            )

            # Echo the input back
            response = f"You said: {input.text}"

            # Debug: Response ready
            yield AgentOutput.debug(
                input.session_id,
                f"Responding with {len(response)} characters",
                component="echo_agent",
                level="debug",
                metadata={"response_length": len(response), "message_count": self._message_count}
            )

            # Yield final response
            yield AgentOutput.text_final(input.session_id, response)

            print(f"[EchoAgent] Responded: '{response}'")

        except Exception as e:
            print(f"[EchoAgent] Error: {e}")
            yield AgentOutput.error(
                input.session_id,
                f"Echo error: {str(e)}",
                error_type="echo_error",
                recoverable=True
            )

        finally:
            self._is_processing = False

    async def on_interrupt(self, session_id: str) -> None:
        """
        Handle interrupt signal.

        Echo agent has nothing to cancel since responses are instant.
        """
        print(f"[EchoAgent] Interrupt received for session: {session_id}")
        self._is_processing = False

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize session state.

        Args:
            session_id: Unique session identifier
            config: Session configuration
        """
        await super().on_session_start(session_id, config)
        self._message_count = 0
        self._config = config
        print(f"[EchoAgent] Session started: {session_id}")
        print(f"[EchoAgent] Config: {config}")

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """
        Cleanup and return final data.

        Returns:
            Dict with session summary
        """
        result = await super().on_session_end(session_id)

        summary = {
            "messages_echoed": self._message_count,
            **result
        }

        print(f"[EchoAgent] Session ended: {session_id}")
        print(f"[EchoAgent] Messages echoed: {self._message_count}")

        return summary
