"""Tool for getting pending tasks."""

from typing import Any, Dict

from stella_agent_sdk.tools.base import BaseTool, ToolResult
from stella_agent_sdk.services.state_machine_client import StateMachineClient


class GetPendingTasksTool(BaseTool):
    """
    Get the list of pending tasks in the current state.

    Use this tool when you need to see what tasks still
    need to be completed in the current conversation state.
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
        return "get_pending_tasks"

    @property
    def description(self) -> str:
        return (
            "Get the list of pending tasks in the current conversation state. "
            "Returns task IDs, descriptions, whether they have deliverables, "
            "and which deliverable keys they require."
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
        Execute the tool to get pending tasks.

        Returns:
            ToolResult with list of pending tasks
        """
        tasks = await self._client.get_pending_tasks()

        return ToolResult(
            success=True,
            data={
                "tasks": tasks,
                "count": len(tasks)
            }
        )
