"""Canonical result contract for the state-machine tools.

Every state-mutating tool (set_deliverable, complete_task, skip_task,
skip_state — and batch_update, per item) reports the same "what happened to the
state machine" outcome in its ``ToolResult.data``. Defining that contract ONCE
here keeps the tool interface identical for every agent that calls the tools and
stops the fields drifting between tools. What an agent does with the result is up
to the agent; the shape it receives is not.
"""

from typing import Any, Dict

# The state-mutation outcome fields present in every state-machine tool result.
STATE_TRANSITION_FIELDS = (
    "transitioned",
    "new_state_id",
    "new_state_title",
    "progress",
    "session_completed",
    "farewell_message",
    "summary_behavior",
)


def state_transition_data(result: Dict[str, Any]) -> Dict[str, Any]:
    """Project a backend mutation ``result`` onto the canonical state-transition
    outcome that every state-machine tool exposes in ``ToolResult.data``.

    Tools merge it into their own tool-specific keys::

        data={"key": key, "value": value, **state_transition_data(result)}

    ``session_completed`` / ``farewell_message`` / ``summary_behavior`` are set
    when the plan reaches its end node, so a consumer can finish the session.
    """
    return {
        "transitioned": result.get("transitioned", False),
        "new_state_id": result.get("new_state_id"),
        "new_state_title": result.get("new_state_title"),
        "progress": result.get("progress"),
        "session_completed": result.get("session_completed", False),
        "farewell_message": result.get("farewell_message"),
        "summary_behavior": result.get("summary_behavior"),
    }
