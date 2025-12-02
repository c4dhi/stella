# Grace Agent

A full agent implementation using the Grace AI Agent SDK. This agent implements the InputGate → ExpertPool → Aggregator pipeline for intelligent conversation handling.

## Overview

Grace Agent is a production-ready agent that:

- Uses the **grace-ai-agent-sdk** for communication with session-management
- Implements the **BaseAgent** interface
- Provides **InputGate** for SAFE/UNSAFE routing decisions
- Runs **ExpertPool** for parallel expert analysis (when needed)
- Uses **Aggregator** to synthesize expert findings into natural responses
- Streams responses token-by-token via SDK messages

## Architecture

```
AgentInput (text from session-management)
        │
        ▼
┌───────────────────────────────────────────────────────┐
│                    GRACE AGENT                        │
│                                                       │
│  1. InputGate.process()                               │
│     ├─ yield STATUS (thinking)                        │
│     ├─ LLM analyzes input                             │
│     ├─ Parses VERDICT, EXPERTS, MESSAGE               │
│     ├─ yield STATUS (input_gate decision)             │
│     │                                                 │
│     ├─ If SAFE:                                       │
│     │   └─ yield TEXT_CHUNK (stream MESSAGE)          │
│     │                                                 │
│     └─ If UNSAFE:                                     │
│         │                                             │
│  2.     ▼ ExpertPool.run_parallel()                   │
│         ├─ yield STATUS (expert_start) per expert     │
│         ├─ Run selected experts concurrently          │
│         ├─ yield STATUS (expert_complete) per expert  │
│         │                                             │
│  3.     ▼ Aggregator.synthesize()                     │
│         ├─ yield STATUS (aggregating)                 │
│         ├─ Synthesize expert findings                 │
│         └─ yield TEXT_CHUNK (stream response)         │
│                                                       │
│  4. yield TEXT_CHUNK (is_final=True)                  │
│                                                       │
└───────────────────────────────────────────────────────┘
        │
        ▼
AgentOutput (streamed to session-management)
```

## Installation

```bash
# Install SDK locally first
pip install -e ../grace-ai-agent-sdk

# Install grace-agent
pip install -e .
```

## Usage

```bash
# Run the agent
python -m grace_agent --server localhost:50051 --config config/llm_config.json
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

### Expert Agents (`src/grace_agent/experts/`)

Expert agents are defined as JSON configuration files that specify:
- Trigger keywords for activation
- System prompts for analysis
- Model parameters

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest
```

## License

MIT
