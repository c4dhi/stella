"""Tool executor for handling LLM tool calling loop.

The ToolExecutor manages the interaction between an LLM and tools:
1. Receives LLM response with tool calls
2. Executes requested tools
3. Returns results to LLM
4. Repeats until LLM responds without tool calls
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

from stella_agent_sdk.tools.base import BaseTool, ToolCall, ToolResult
from stella_agent_sdk.tools.registry import ToolRegistry


class EventType(str, Enum):
    """Types of events emitted during tool execution."""
    TOOL_CALL = "tool_call"      # LLM requested a tool call
    TOOL_RESULT = "tool_result"  # Tool execution completed
    TEXT_CHUNK = "text_chunk"    # Streaming text chunk
    TEXT_FINAL = "text_final"    # Final text response
    ERROR = "error"              # Error occurred


@dataclass
class ExecutorEvent:
    """Event emitted during tool execution.

    Attributes:
        type: Type of event
        tool_name: Name of tool (for tool events)
        tool_call_id: ID of tool call (for matching)
        arguments: Tool arguments (for tool_call events)
        result: Tool result (for tool_result events)
        content: Text content (for text events)
        error: Error message (for error events)
    """
    type: EventType
    tool_name: Optional[str] = None
    tool_call_id: Optional[str] = None
    arguments: Optional[Dict[str, Any]] = None
    result: Optional[ToolResult] = None
    content: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        d = {"type": self.type.value}
        if self.tool_name:
            d["tool_name"] = self.tool_name
        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id
        if self.arguments:
            d["arguments"] = self.arguments
        if self.result:
            d["result"] = self.result.to_dict()
        if self.content:
            d["content"] = self.content
        if self.error:
            d["error"] = self.error
        return d


class ToolExecutor:
    """Handles tool execution loop with LLM.

    The executor manages the back-and-forth between LLM and tools:
    1. Parse tool calls from LLM response
    2. Execute each tool
    3. Return results to LLM
    4. Repeat until LLM responds with text only

    Example:
        executor = ToolExecutor(registry)

        async for event in executor.execute_tool_calls(tool_calls):
            if event.type == EventType.TOOL_CALL:
                print(f"Calling {event.tool_name}")
            elif event.type == EventType.TOOL_RESULT:
                print(f"Result: {event.result}")
    """

    def __init__(
        self,
        registry: ToolRegistry,
        max_iterations: int = 10,
        on_tool_call: Optional[Callable[[str, Dict], None]] = None,
        on_tool_result: Optional[Callable[[str, ToolResult], None]] = None
    ):
        """Initialize the tool executor.

        Args:
            registry: Registry of available tools
            max_iterations: Maximum number of tool call iterations
            on_tool_call: Optional callback when tool is called
            on_tool_result: Optional callback when tool returns
        """
        self.registry = registry
        self.max_iterations = max_iterations
        self._on_tool_call = on_tool_call
        self._on_tool_result = on_tool_result

    async def execute_single(
        self,
        tool_call: ToolCall
    ) -> ExecutorEvent:
        """Execute a single tool call.

        Args:
            tool_call: The tool call to execute

        Returns:
            ExecutorEvent with the result
        """
        tool = self.registry.get(tool_call.name)

        if not tool:
            return ExecutorEvent(
                type=EventType.TOOL_RESULT,
                tool_name=tool_call.name,
                tool_call_id=tool_call.id,
                result=ToolResult(
                    success=False,
                    error=f"Unknown tool: {tool_call.name}. Available: {self.registry.list_names()}"
                )
            )

        try:
            # Emit tool call event
            if self._on_tool_call:
                self._on_tool_call(tool_call.name, tool_call.arguments)

            # Execute the tool
            result = await tool.execute(**tool_call.arguments)

            # Emit tool result callback
            if self._on_tool_result:
                self._on_tool_result(tool_call.name, result)

            return ExecutorEvent(
                type=EventType.TOOL_RESULT,
                tool_name=tool_call.name,
                tool_call_id=tool_call.id,
                arguments=tool_call.arguments,
                result=result
            )

        except Exception as e:
            result = ToolResult(success=False, error=str(e))
            if self._on_tool_result:
                self._on_tool_result(tool_call.name, result)

            return ExecutorEvent(
                type=EventType.TOOL_RESULT,
                tool_name=tool_call.name,
                tool_call_id=tool_call.id,
                arguments=tool_call.arguments,
                result=result
            )

    async def execute_tool_calls(
        self,
        tool_calls: List[ToolCall]
    ) -> AsyncIterator[ExecutorEvent]:
        """Execute a list of tool calls.

        Args:
            tool_calls: List of tool calls to execute

        Yields:
            ExecutorEvent for each tool call and result
        """
        for tool_call in tool_calls:
            # Emit tool call event
            yield ExecutorEvent(
                type=EventType.TOOL_CALL,
                tool_name=tool_call.name,
                tool_call_id=tool_call.id,
                arguments=tool_call.arguments
            )

            # Execute and emit result
            result_event = await self.execute_single(tool_call)
            yield result_event

    def parse_openai_tool_calls(
        self,
        response: Dict[str, Any]
    ) -> List[ToolCall]:
        """Parse tool calls from OpenAI response.

        Args:
            response: OpenAI chat completion response

        Returns:
            List of ToolCall objects
        """
        tool_calls = []

        # Handle direct response object
        if hasattr(response, "tool_calls") and response.tool_calls:
            for tc in response.tool_calls:
                tool_calls.append(ToolCall.from_openai({
                    "id": tc.id,
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                }))
        # Handle dict response
        elif isinstance(response, dict):
            choices = response.get("choices", [])
            if choices:
                message = choices[0].get("message", {})
                for tc in message.get("tool_calls", []):
                    tool_calls.append(ToolCall.from_openai(tc))

        return tool_calls

    def parse_anthropic_tool_calls(
        self,
        response: Dict[str, Any]
    ) -> List[ToolCall]:
        """Parse tool calls from Anthropic response.

        Args:
            response: Anthropic message response

        Returns:
            List of ToolCall objects
        """
        tool_calls = []

        # Handle response object
        if hasattr(response, "content"):
            for block in response.content:
                if hasattr(block, "type") and block.type == "tool_use":
                    tool_calls.append(ToolCall.from_anthropic({
                        "id": block.id,
                        "name": block.name,
                        "input": block.input
                    }))
        # Handle dict response
        elif isinstance(response, dict):
            for block in response.get("content", []):
                if block.get("type") == "tool_use":
                    tool_calls.append(ToolCall.from_anthropic(block))

        return tool_calls

    def build_tool_result_message_openai(
        self,
        tool_call_id: str,
        result: ToolResult
    ) -> Dict[str, Any]:
        """Build tool result message for OpenAI.

        Args:
            tool_call_id: ID of the tool call
            result: Result from tool execution

        Returns:
            Message dict for OpenAI conversation
        """
        import json
        return {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": json.dumps(result.to_dict())
        }

    def build_tool_result_message_anthropic(
        self,
        tool_use_id: str,
        result: ToolResult
    ) -> Dict[str, Any]:
        """Build tool result message for Anthropic.

        Args:
            tool_use_id: ID of the tool use block
            result: Result from tool execution

        Returns:
            Message dict for Anthropic conversation
        """
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": result.to_dict()
                }
            ]
        }
