"""Tool for marking tasks as completed."""

from typing import Any, Dict

from stella_agent_sdk.tools.base import BaseTool, ToolResult
from stella_agent_sdk.services.state_machine_client import StateMachineClient


class CompleteTaskTool(BaseTool):
    """
    Mark a task as completed.

    Use this tool when you have performed a task that doesn't require
    data collection (e.g., introducing yourself, telling a joke, saying goodbye).

    Do NOT use this for tasks that have deliverables - those complete
    automatically when all deliverables are collected.
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
        return "complete_task"

    @property
    def description(self) -> str:
        return (
            "Mark a task as completed. Use this when you have successfully "
            "performed a task that does NOT require data collection (e.g., "
            "introducing yourself, telling a joke, giving a greeting, saying goodbye). "
            "Do NOT use for tasks that collect deliverables - those complete automatically "
            "when all required deliverables are set."
        )

    @property
    def parameters_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The ID of the task to mark as completed"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of how/why the task was completed"
                }
            },
            "required": ["task_id", "reasoning"]
        }

    async def execute(self, task_id: str, reasoning: str) -> ToolResult:
        """
        Execute the tool to complete a task.

        Args:
            task_id: The task ID to complete
            reasoning: Explanation for completion

        Returns:
            ToolResult with success status and any state changes
        """
        result = await self._client.complete_task(task_id, reasoning)

        if not result["success"]:
            return ToolResult(
                success=False,
                error=result.get("error", "Failed to complete task")
            )

        return ToolResult(
            success=True,
            data={
                "task_id": task_id,
                "task_completed": result.get("task_completed"),
                "transitioned": result.get("transitioned", False),
                "new_state_id": result.get("new_state_id"),
                "new_state_title": result.get("new_state_title"),
                "progress": result.get("progress"),
            }
        )
