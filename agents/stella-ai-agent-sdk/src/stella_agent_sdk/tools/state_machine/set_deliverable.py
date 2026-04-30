"""Tool for setting deliverable values."""

from typing import Any, Dict

from stella_agent_sdk.tools.base import BaseTool, ToolResult
from stella_agent_sdk.services.state_machine_client import StateMachineClient


class SetDeliverableTool(BaseTool):
    """
    Set a deliverable value when the user provides information.

    Only use this when the user CLEARLY and EXPLICITLY provides
    the requested information. Do NOT use for greetings, vague
    responses, or off-topic answers.
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
        return "set_deliverable"

    @property
    def description(self) -> str:
        return (
            "Set a deliverable value when the user provides information. "
            "Only call this when the user CLEARLY and EXPLICITLY provides "
            "the requested information. Do NOT call for greetings (hi, hello), "
            "vague responses, or off-topic answers. If unsure, ask a clarifying "
            "question instead."
        )

    @property
    def parameters_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "The deliverable key to set"
                },
                "value": {
                    "type": "string",
                    "description": "The extracted value from user input"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Explanation of why this value matches the deliverable"
                }
            },
            "required": ["key", "value", "reasoning"]
        }

    async def execute(self, key: str, value: str, reasoning: str) -> ToolResult:
        """
        Execute the tool to set a deliverable.

        Args:
            key: The deliverable key
            value: The value to set
            reasoning: Explanation for the value

        Returns:
            ToolResult with success status and any state changes
        """
        result = await self._client.set_deliverable(key, value, reasoning)

        if not result["success"]:
            return ToolResult(
                success=False,
                error=result.get("error", "Failed to set deliverable")
            )

        return ToolResult(
            success=True,
            data={
                "key": key,
                "value": value,
                "task_completed": result.get("task_completed"),
                "transitioned": result.get("transitioned", False),
                "new_state_id": result.get("new_state_id"),
                "new_state_title": result.get("new_state_title"),
                "progress": result.get("progress"),
                # Propagated from backend — set when plan reached __end__.
                # The expert runner reads this to signal session completion upstream.
                "session_completed": result.get("session_completed", False),
                "farewell_message": result.get("farewell_message"),
                "summary_behavior": result.get("summary_behavior"),
            }
        )
