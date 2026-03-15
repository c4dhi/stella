"""Tool for batch-updating deliverables and completing tasks in a single call."""

from typing import Any, Dict, List

from stella_agent_sdk.tools.base import BaseTool, ToolResult
from stella_agent_sdk.services.state_machine_client import StateMachineClient


class BatchUpdateTool(BaseTool):
    """
    Set multiple deliverables and complete multiple tasks in one call.

    Use this instead of calling set_deliverable/complete_task repeatedly.
    Include every deliverable and task you found — current message and history.
    """

    def __init__(self, client: StateMachineClient):
        self._client = client

    @property
    def name(self) -> str:
        return "batch_update"

    @property
    def description(self) -> str:
        return (
            "Set multiple deliverables and/or complete multiple tasks in a single call. "
            "Use this to submit ALL extractions at once — from the current message and "
            "from conversation history. Each deliverable needs a key, value, and reasoning. "
            "Each task needs a task_id and reasoning."
        )

    @property
    def parameters_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "deliverables": {
                    "type": "array",
                    "description": "Deliverables to set (can be empty array)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {
                                "type": "string",
                                "description": "The deliverable key"
                            },
                            "value": {
                                "type": "string",
                                "description": "The extracted value"
                            },
                            "reasoning": {
                                "type": "string",
                                "description": "Why this value matches"
                            }
                        },
                        "required": ["key", "value", "reasoning"]
                    }
                },
                "tasks": {
                    "type": "array",
                    "description": "Tasks to mark as completed (can be empty array)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "task_id": {
                                "type": "string",
                                "description": "The task ID to complete"
                            },
                            "reasoning": {
                                "type": "string",
                                "description": "Why this task is complete"
                            }
                        },
                        "required": ["task_id", "reasoning"]
                    }
                }
            },
            "required": ["deliverables", "tasks"]
        }

    async def execute(
        self,
        deliverables: List[Dict[str, str]] = None,
        tasks: List[Dict[str, str]] = None,
    ) -> ToolResult:
        """Execute batch update — set deliverables and complete tasks."""
        deliverables = deliverables or []
        tasks = tasks or []

        results = {
            "deliverables_set": [],
            "deliverables_failed": [],
            "tasks_completed": [],
            "tasks_failed": [],
        }

        # Process deliverables — stop if a state transition occurs
        transitioned = False
        for i, d in enumerate(deliverables):
            try:
                result = await self._client.set_deliverable(
                    d["key"], d["value"], d.get("reasoning", "")
                )
                if result.get("success"):
                    results["deliverables_set"].append({
                        "key": d["key"],
                        "value": d["value"],
                        "task_completed": result.get("task_completed"),
                        "transitioned": result.get("transitioned", False),
                        "new_state_id": result.get("new_state_id"),
                    })
                    if result.get("transitioned", False):
                        transitioned = True
                        for skipped in deliverables[i + 1:]:
                            results["deliverables_failed"].append({
                                "key": skipped["key"],
                                "error": "skipped: state transitioned",
                            })
                        break
                else:
                    results["deliverables_failed"].append({
                        "key": d["key"],
                        "error": result.get("error", "unknown"),
                    })
            except Exception as e:
                results["deliverables_failed"].append({
                    "key": d["key"],
                    "error": str(e),
                })

        # Process tasks — skip if already transitioned
        if not transitioned:
            for i, t in enumerate(tasks):
                try:
                    result = await self._client.complete_task(
                        t["task_id"], t.get("reasoning", "")
                    )
                    if result.get("success"):
                        results["tasks_completed"].append({
                            "task_id": t["task_id"],
                            "transitioned": result.get("transitioned", False),
                            "new_state_id": result.get("new_state_id"),
                        })
                        if result.get("transitioned", False):
                            transitioned = True
                            for skipped in tasks[i + 1:]:
                                results["tasks_failed"].append({
                                    "task_id": skipped["task_id"],
                                    "error": "skipped: state transitioned",
                                })
                            break
                    else:
                        results["tasks_failed"].append({
                            "task_id": t["task_id"],
                            "error": result.get("error", "unknown"),
                        })
                except Exception as e:
                    results["tasks_failed"].append({
                        "task_id": t["task_id"],
                        "error": str(e),
                    })
        else:
            for t in tasks:
                results["tasks_failed"].append({
                    "task_id": t["task_id"],
                    "error": "skipped: state transitioned during deliverable processing",
                })

        all_success = not results["deliverables_failed"] and not results["tasks_failed"]
        return ToolResult(success=all_success, data=results)
