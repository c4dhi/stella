"""Tool for getting current state information."""

from typing import Any, Dict

from stella_agent_sdk.tools.base import BaseTool, ToolResult
from stella_agent_sdk.services.state_machine_client import StateMachineClient


class GetCurrentStateTool(BaseTool):
    """
    Get the current conversation state and progress.

    Use this tool when you need to understand where you are
    in the conversation flow or check overall progress.
    """

    def __init__(self, client: StateMachineClient):
        """
        Initialize the tool.

        Args:
            client: StateMachineClient instance
        """
        self._client = client

    @property
    def name(self) -> str:
        return "get_current_state"

    @property
    def description(self) -> str:
        return (
            "Get the current conversation state and progress. "
            "Returns the current state ID, title, type (strict/loose), "
            "progress percentage, and turn counters."
        )

    @property
    def parameters_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {},
            "required": []
        }

    async def execute(self) -> ToolResult:
        """
        Execute the tool to get current state.

        Returns:
            ToolResult with current state information
        """
        state = await self._client.get_current_state()

        if state is None:
            return ToolResult(
                success=False,
                error="State machine not initialized"
            )

        return ToolResult(
            success=True,
            data=state
        )
