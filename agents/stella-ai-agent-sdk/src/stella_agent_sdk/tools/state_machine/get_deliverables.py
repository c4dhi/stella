"""Tool for getting pending deliverables."""

from typing import Any, Dict

from stella_agent_sdk.tools.base import BaseTool, ToolResult
from stella_agent_sdk.services.state_machine_client import StateMachineClient


class GetPendingDeliverablesTool(BaseTool):
    """
    Get the list of pending deliverables in the current state.

    Use this tool when you need to see what information still
    needs to be collected from the user.
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
        return "get_pending_deliverables"

    @property
    def description(self) -> str:
        return (
            "Get the list of pending deliverables (information to collect) "
            "in the current conversation state. Returns deliverable keys, "
            "descriptions, types, acceptance criteria, and examples."
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
        Execute the tool to get pending deliverables.

        Returns:
            ToolResult with list of pending deliverables
        """
        deliverables = await self._client.get_pending_deliverables()

        return ToolResult(
            success=True,
            data={
                "deliverables": deliverables,
                "count": len(deliverables)
            }
        )
