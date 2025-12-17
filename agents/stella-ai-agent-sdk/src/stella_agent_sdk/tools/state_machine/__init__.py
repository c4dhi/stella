"""State machine tools for conversation progress tracking.

These tools allow agents to manage conversation state through
the external state machine service:
- complete_task: Mark tasks as completed
- set_deliverable: Set collected values
- get_state: Query current state
- get_tasks: List pending tasks
- get_deliverables: List pending deliverables
"""

from typing import List

from stella_agent_sdk.tools.base import BaseTool
from stella_agent_sdk.tools.state_machine.complete_task import CompleteTaskTool
from stella_agent_sdk.tools.state_machine.set_deliverable import SetDeliverableTool
from stella_agent_sdk.tools.state_machine.get_state import GetCurrentStateTool
from stella_agent_sdk.tools.state_machine.get_tasks import GetPendingTasksTool
from stella_agent_sdk.tools.state_machine.get_deliverables import GetPendingDeliverablesTool


def create_state_machine_tools(client) -> List[BaseTool]:
    """
    Factory function to create all state machine tools.

    Args:
        client: StateMachineClient instance

    Returns:
        List of all state machine tools
    """
    return [
        CompleteTaskTool(client),
        SetDeliverableTool(client),
        GetCurrentStateTool(client),
        GetPendingTasksTool(client),
        GetPendingDeliverablesTool(client),
    ]


__all__ = [
    "CompleteTaskTool",
    "SetDeliverableTool",
    "GetCurrentStateTool",
    "GetPendingTasksTool",
    "GetPendingDeliverablesTool",
    "create_state_machine_tools",
]
