"""State machine tools for conversation progress tracking.

These tools are the ONLY way an agent mutates conversation state — every
completion/skip/deliverable is an explicit tool call, never derived implicitly
(#291). Available tools:
- complete_task: Explicitly tick a task done
- skip_task: Explicitly skip a single task
- skip_state: Skip the whole current state and advance
- set_deliverable: Record a single collected value
- batch_update: Record many deliverables and/or tick many tasks in one call
- get_state / get_tasks / get_deliverables: Read-only queries
"""

from typing import List

from stella_agent_sdk.tools.base import BaseTool
from stella_agent_sdk.tools.state_machine.complete_task import CompleteTaskTool
from stella_agent_sdk.tools.state_machine.skip_task import SkipTaskTool
from stella_agent_sdk.tools.state_machine.skip_state import SkipStateTool
from stella_agent_sdk.tools.state_machine.set_deliverable import SetDeliverableTool
from stella_agent_sdk.tools.state_machine.batch_update import BatchUpdateTool
from stella_agent_sdk.tools.state_machine.get_state import GetCurrentStateTool
from stella_agent_sdk.tools.state_machine.get_tasks import GetPendingTasksTool
from stella_agent_sdk.tools.state_machine.get_deliverables import GetPendingDeliverablesTool
from stella_agent_sdk.tools.state_machine.guidance import STATE_MACHINE_TOOL_GUIDANCE


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
        SkipTaskTool(client),
        SkipStateTool(client),
        SetDeliverableTool(client),
        BatchUpdateTool(client),
        GetCurrentStateTool(client),
        GetPendingTasksTool(client),
        GetPendingDeliverablesTool(client),
    ]


__all__ = [
    "CompleteTaskTool",
    "SkipTaskTool",
    "SkipStateTool",
    "SetDeliverableTool",
    "BatchUpdateTool",
    "GetCurrentStateTool",
    "GetPendingTasksTool",
    "GetPendingDeliverablesTool",
    "create_state_machine_tools",
    "STATE_MACHINE_TOOL_GUIDANCE",
]
