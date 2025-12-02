# Grace AI Agent SDK

A communication SDK for building agents that integrate with the Grace AI platform.

## Overview

The SDK defines the communication protocol - agents implement whatever logic they want internally. It provides:

- **Message types** (`AgentInput`, `AgentOutput`) - Standardized formats for agent communication
- **`BaseAgent`** - Abstract class that agents implement
- **gRPC client** - Handles connection to session-management server

**What the SDK does NOT include:** LLM services, RAG, expert pools, or any processing logic. Those are your agent's implementation details.

## Installation

```bash
pip install grace-ai-agent-sdk
```

Or install from source:

```bash
cd grace-ai-agent-sdk
pip install -e .
```

## Quick Start

```python
from grace_agent_sdk import BaseAgent, AgentInput, AgentOutput, connect

class MyAgent(BaseAgent):
    async def on_session_start(self, session_id: str, config: dict) -> None:
        # Initialize your agent with configuration
        self.model = config.get("model", "gpt-4")

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        # Process user input and yield responses
        yield AgentOutput.thinking(input.session_id)

        # Your LLM/processing logic here
        response = await my_llm_call(input.text)

        yield AgentOutput.text_final(input.session_id, response)

    async def on_interrupt(self, session_id: str) -> None:
        # Handle user interrupt (barge-in)
        self.cancel_current_task()

    async def on_session_end(self, session_id: str) -> dict:
        # Cleanup and return final data
        return {"messages": self.message_count}

# Connect to session-management and run
async with connect("localhost:50051", MyAgent()) as session:
    await session.run()
```

## Architecture

```
Session-Management-Server (handles STT/TTS)
        │
        │ gRPC (SDK protocol)
        │
        ▼
    Your Agent (uses SDK)
        │
        ├─ Receives: AgentInput (text from user)
        └─ Sends: AgentOutput (text responses)
```

The agent is a **black box** from session-management's perspective:
1. Agent connects to server, receives configuration
2. Server sends transcribed text to agent
3. Agent processes (using whatever LLM/logic you want)
4. Agent streams text responses back
5. Server sends text to TTS for audio output

## Message Types

### Input (from server to agent)

| Type | Description |
|------|-------------|
| `TEXT` | Transcribed user speech or typed text |
| `INTERRUPT` | User interrupted (barge-in) |
| `SESSION_START` | Session starting with configuration |
| `SESSION_END` | Session ending |
| `CONFIG` | Runtime configuration update |

### Output (from agent to server)

| Type | Description | TTS? |
|------|-------------|------|
| `TEXT_CHUNK` | Streaming text chunk | Buffered |
| `TEXT_FINAL` | Complete text response | Yes |
| `STATUS` | Processing status update | No |
| `METADATA` | Plan/deliverable update | No |
| `ERROR` | Error message | No |

## Examples

See the `examples/` directory:

- `echo_agent.py` - Simplest possible agent (echoes input)
- `openai_agent.py` - Integration with OpenAI GPT models

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Generate gRPC stubs
python -m grpc_tools.protoc \
    -I proto \
    --python_out=src/grace_agent_sdk/_grpc/generated \
    --grpc_python_out=src/grace_agent_sdk/_grpc/generated \
    proto/agent.proto
```

## License

MIT
