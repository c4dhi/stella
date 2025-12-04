"""State Machine module for Stella Agent.

Provides state machine functionality for managing conversation flow
through plans with states, tasks, and deliverables.
"""

from stella_agent.state_machine.execution_state import ExecutionState
from stella_agent.state_machine.engine import StateMachine, TaskProcessingResult

__all__ = ["StateMachine", "ExecutionState", "TaskProcessingResult"]
