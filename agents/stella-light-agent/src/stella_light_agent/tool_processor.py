"""
Tool-based processor for stella-light-agent.

Replaces text-based parsing with native LLM tool calling:
- Uses OpenAI function calling to invoke state machine tools
- Handles multi-turn tool execution
- Streams text responses while executing tools
"""

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import AsyncIterator, Dict, Any, List, Optional

from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.tools import ToolRegistry, BaseTool, ToolResult

from stella_light_agent.llm.service import (
    LLMService,
    LLMConfig,
    LLMProvider,
    LLMMessage,
    LLMResponse,
    LLMStreamingCallback,
    LLMToolCall,
)


@dataclass
class ToolProcessorResult:
    """Result from ToolProcessor."""
    message: str
    tool_calls_made: List[Dict[str, Any]] = field(default_factory=list)
    deliverables_set: List[str] = field(default_factory=list)
    tasks_completed: List[str] = field(default_factory=list)
    transitioned: bool = False
    new_state_id: Optional[str] = None


class ToolStreamingCallback(LLMStreamingCallback):
    """Callback for streaming responses with tool call support."""

    def __init__(self, transcript_id: str, token_queue: asyncio.Queue):
        self.transcript_id = transcript_id
        self.token_queue = token_queue
        self.accumulated_text = ""
        self.tool_calls: List[LLMToolCall] = []

    async def on_token(self, token: str, accumulated_text: str) -> None:
        """Handle each new token from the LLM."""
        self.accumulated_text = accumulated_text
        await self.token_queue.put(("token", token))

    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete."""
        if final_response.tool_calls:
            self.tool_calls = final_response.tool_calls
            await self.token_queue.put(("tool_calls", final_response.tool_calls))
        await self.token_queue.put(("complete", self.accumulated_text))

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        await self.token_queue.put(("error", str(error)))

    async def on_tool_call(self, tool_call: LLMToolCall) -> None:
        """Called when a tool call is detected."""
        self.tool_calls.append(tool_call)


class ToolProcessor:
    """
    Tool-based processor with native LLM function calling.

    Replaces text parsing with tool execution loop:
    1. Send messages to LLM with tool definitions
    2. If LLM calls tools, execute them and continue
    3. Stream text responses to user
    4. Return results including tool execution info
    """

    def __init__(
        self,
        llm_service: LLMService,
        tool_registry: ToolRegistry,
        max_tool_iterations: int = 5
    ):
        """
        Initialize the tool processor.

        Args:
            llm_service: LLM service for generating responses
            tool_registry: Registry containing available tools
            max_tool_iterations: Maximum number of tool call rounds
        """
        self.llm_service = llm_service
        self.tool_registry = tool_registry
        self.max_tool_iterations = max_tool_iterations
        self.cancelled = False

    def cancel(self):
        """Cancel current processing."""
        self.cancelled = True

    async def process(
        self,
        session_id: str,
        system_prompt: str,
        user_message: str
    ) -> AsyncIterator[AgentOutput]:
        """
        Process input through LLM with tool calling support.

        Args:
            session_id: Current session ID
            system_prompt: Complete system prompt with context
            user_message: User's input message

        Yields:
            AgentOutput messages (text chunks, final result)
        """
        self.cancelled = False
        transcript_id = f"tool_{uuid.uuid4().hex[:8]}"

        # Build initial messages
        messages = [
            LLMMessage(role="system", content=system_prompt),
            LLMMessage(role="user", content=user_message)
        ]

        # Get tool schemas for LLM
        tool_schemas = self.tool_registry.get_openai_schemas()

        # Configure LLM for tool calling
        config = LLMConfig(
            provider=LLMProvider.OPENAI_DIRECT,
            model=self.llm_service.default_config.model,
            temperature=self.llm_service.default_config.temperature,
            max_tokens=self.llm_service.default_config.max_tokens,
            streaming=True,
            tools=tool_schemas if tool_schemas else None,
            tool_choice="auto"
        )

        # Track results
        result = ToolProcessorResult(message="")
        accumulated_text = ""
        iterations = 0

        while iterations < self.max_tool_iterations:
            if self.cancelled:
                return

            iterations += 1
            print(f"[ToolProcessor] Iteration {iterations}/{self.max_tool_iterations}")
            print(f"[ToolProcessor] Messages count: {len(messages)}, last message role: {messages[-1].role}")
            token_queue: asyncio.Queue = asyncio.Queue()
            callback = ToolStreamingCallback(transcript_id, token_queue)

            # Start LLM generation in background
            llm_task = asyncio.create_task(
                self.llm_service.generate(
                    messages=messages,
                    config=config,
                    callback=callback,
                    component_name="tool_processor"
                )
            )

            # Process events from the callback
            tool_calls_to_execute: List[LLMToolCall] = []
            text_chunk_buffer = ""

            try:
                while True:
                    if self.cancelled:
                        llm_task.cancel()
                        return

                    try:
                        event_type, content = await asyncio.wait_for(
                            token_queue.get(), timeout=0.1
                        )

                        if event_type == "token":
                            text_chunk_buffer += content
                            accumulated_text += content
                            # Stream text chunks to user
                            yield AgentOutput.text_chunk(
                                session_id,
                                accumulated_text.strip(),
                                transcript_id=transcript_id,
                                is_final=False
                            )

                        elif event_type == "tool_calls":
                            tool_calls_to_execute = content

                        elif event_type == "error":
                            yield AgentOutput.error(
                                session_id,
                                f"LLM error: {content}",
                                error_type="llm_error",
                                recoverable=True
                            )
                            return

                        elif event_type == "complete":
                            break

                    except asyncio.TimeoutError:
                        if llm_task.done():
                            break

                # Wait for LLM task to complete
                await llm_task

            except asyncio.CancelledError:
                return
            except Exception as e:
                yield AgentOutput.error(
                    session_id,
                    str(e),
                    error_type="processing_error",
                    recoverable=True
                )
                return

            # If no tool calls, we're done
            if not tool_calls_to_execute:
                print(f"[ToolProcessor] No tool calls in iteration {iterations}, breaking loop")
                print(f"[ToolProcessor] Text accumulated so far: '{accumulated_text[:100]}...' ({len(accumulated_text)} chars)")
                break

            # Execute tool calls
            print(f"[ToolProcessor] Executing {len(tool_calls_to_execute)} tool call(s)")
            for tc in tool_calls_to_execute:
                print(f"[ToolProcessor] Tool call: {tc.name}({tc.arguments})")

            # Add assistant message with tool calls to conversation
            assistant_message = LLMMessage(
                role="assistant",
                content=text_chunk_buffer or "",
                tool_calls=tool_calls_to_execute
            )
            messages.append(assistant_message)

            # Execute each tool and add results to conversation
            for tool_call in tool_calls_to_execute:
                tool = self.tool_registry.get(tool_call.name)
                if tool is None:
                    print(f"[ToolProcessor] Unknown tool: {tool_call.name}")
                    tool_result_msg = LLMMessage(
                        role="tool",
                        content=json.dumps({"error": f"Unknown tool: {tool_call.name}"}),
                        tool_call_id=tool_call.id
                    )
                    messages.append(tool_result_msg)
                    continue

                # Execute the tool
                try:
                    tool_result = await tool.execute(**tool_call.arguments)
                    print(f"[ToolProcessor] Tool '{tool_call.name}' result: {tool_result.success}")

                    # Track tool usage for result
                    result.tool_calls_made.append({
                        "name": tool_call.name,
                        "arguments": tool_call.arguments,
                        "success": tool_result.success
                    })

                    # Track specific tool effects
                    if tool_call.name == "set_deliverable" and tool_result.success:
                        key = tool_call.arguments.get("key")
                        if key:
                            result.deliverables_set.append(key)
                        if tool_result.data and tool_result.data.get("transitioned"):
                            result.transitioned = True
                            result.new_state_id = tool_result.data.get("new_state_id")

                    elif tool_call.name == "complete_task" and tool_result.success:
                        task_id = tool_call.arguments.get("task_id")
                        if task_id:
                            result.tasks_completed.append(task_id)
                        if tool_result.data and tool_result.data.get("transitioned"):
                            result.transitioned = True
                            result.new_state_id = tool_result.data.get("new_state_id")

                    # Add tool result to conversation
                    tool_result_content = json.dumps({
                        "success": tool_result.success,
                        "data": tool_result.data,
                        "error": tool_result.error
                    })

                except Exception as e:
                    print(f"[ToolProcessor] Tool execution error: {e}")
                    tool_result_content = json.dumps({
                        "success": False,
                        "error": str(e)
                    })

                tool_result_msg = LLMMessage(
                    role="tool",
                    content=tool_result_content,
                    tool_call_id=tool_call.id
                )
                messages.append(tool_result_msg)
                print(f"[ToolProcessor] Added tool result message: {tool_result_content[:200]}")

            # Continue the loop to let LLM respond after tool execution
            print(f"[ToolProcessor] Continuing to iteration {iterations + 1} for LLM response")

        # Send final text chunk
        print(f"[ToolProcessor] Loop completed after {iterations} iteration(s)")
        print(f"[ToolProcessor] Final accumulated_text: '{accumulated_text[:200]}...' ({len(accumulated_text)} chars)" if accumulated_text else "[ToolProcessor] Final accumulated_text: EMPTY")
        print(f"[ToolProcessor] Tool calls made: {[tc['name'] for tc in result.tool_calls_made]}")
        print(f"[ToolProcessor] Deliverables set: {result.deliverables_set}")

        if accumulated_text.strip():
            yield AgentOutput.text_chunk(
                session_id,
                accumulated_text.strip(),
                transcript_id=transcript_id,
                is_final=True
            )
        else:
            print("[ToolProcessor] WARNING: No text to yield!")

        # Set final message in result
        result.message = accumulated_text.strip()

        # Return the result
        yield result
