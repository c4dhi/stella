# Stella Light Agent

A lightweight, simplified version of the Stella Agent that uses a single LLM call with prompt-based guardrails instead of the full InputGate/ExpertPool/Aggregator pipeline.

## Overview

Stella Light Agent is designed for:
- **Performance comparison** with the full stella-agent
- **Lower latency** (single LLM call vs. multiple)
- **Reduced API costs** (1 call instead of 1-4)
- **Simpler architecture** for easier debugging and modification

## Architecture Comparison

```
stella-agent:       User → InputGate → ExpertPool (parallel) → Aggregator → Response
stella-light-agent: User → LightProcessor → Response
```

## Features

- **Single LLM Call**: One call per user message (vs. 1-4 in full agent)
- **Prompt-Based Guardrails**: Safety rules embedded in system prompt
- **Full State Machine Support**: Same Plan/State/Task/Deliverable hierarchy
- **Streaming Responses**: Token-by-token output for real-time feel
- **Progress Tracking**: Compatible with SDK's ProgressState for frontend display
- **Same Plan Format**: Reuses plans from stella-agent

## Trade-offs

| Aspect | stella-agent | stella-light-agent |
|--------|-------------|-------------------|
| LLM calls/turn | 1-4 | 1 |
| Time to first token | ~1-2s | ~0.3-0.5s |
| Total response time | ~3-8s | ~1-3s |
| API cost | Higher | Lower |
| Safety accuracy | Higher (expert review) | Good (prompt-based) |
| Complexity | High | Low |

## Installation

```bash
# From stella-backend directory
pip install -e agents/stella-ai-agent-sdk
pip install -e agents/stella-light-agent
```

## Usage

### Running Locally

```bash
# Set environment variables
export OPENAI_API_KEY=your-key

# Run the agent
python -m stella_light_agent
```

### Docker Build

```bash
# From stella-backend directory
docker build -t stella-light-agent:latest -f agents/stella-light-agent/Dockerfile .

# Run
docker run -e OPENAI_API_KEY=your-key stella-light-agent:latest
```

## Configuration

### LLM Configuration (`config/llm_config.json`)

```json
{
  "provider": "openai_langchain",
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "max_tokens": 800,
  "streaming": true
}
```

### Session Configuration

The agent accepts these config options on session start:

```python
{
    "plan": "stella_smalltalk",  # Plan ID or full plan object
    "llm": {
        "model": "gpt-4o",       # Override model
        "temperature": 0.5       # Override temperature
    }
}
```

## File Structure

```
stella-light-agent/
├── config/
│   ├── llm_config.json          # LLM configuration
│   └── plans/                   # Symlink to stella-agent/config/plans/
├── src/stella_light_agent/
│   ├── __init__.py
│   ├── main.py                  # Entry point
│   ├── agent.py                 # StellaLightAgent class
│   ├── processor.py             # LightProcessor with streaming
│   ├── prompts/
│   │   └── light_prompt.py      # Unified prompt builder
│   ├── llm/
│   │   └── service.py           # LLM provider abstraction
│   ├── models/
│   │   ├── state_machine.py     # Plan/State/Task/Deliverable
│   │   └── todo_list.py         # TodoListState model
│   ├── state_machine/
│   │   ├── engine.py            # StateMachine orchestrator
│   │   └── execution_state.py   # Runtime state tracking
│   └── adapters/
│       └── progress_adapter.py  # SDK ProgressState conversion
├── pyproject.toml
├── Dockerfile
└── README.md
```

## Response Format

The LLM is instructed to respond in this format:

```
MESSAGE: [Response text to show user - streamed in real-time]
DELIVERABLES: [JSON with extracted values] or [NONE]
```

Example:
```
MESSAGE: That's wonderful to hear! I'd love to learn more about you. What do you enjoy doing in your free time?
DELIVERABLES: {"user_name": {"value": "Sarah", "reasoning": "User introduced herself as Sarah"}}
```

## Prompt-Based Guardrails

Instead of routing to expert agents, safety guidelines are embedded in the prompt:

- **Medical**: Recommend consulting healthcare professionals
- **Financial**: Suggest speaking with financial advisors
- **Legal**: Recommend consulting legal professionals
- **Harmful**: Politely decline and redirect

## Development

### Running Tests

```bash
cd agents/stella-light-agent
pytest
```

### Comparing with Full Agent

To compare performance between agents:

1. Run both agents with the same plan
2. Compare response times, token usage, and quality
3. Use the SDK's usage stats for metrics

## License

MIT
