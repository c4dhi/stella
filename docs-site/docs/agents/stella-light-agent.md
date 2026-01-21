---
sidebar_position: 3
title: "💫 stella-light-agent"
---

# 💫 stella-light-agent

A lightweight conversational AI agent optimized for fast responses and lower resource usage.

## Overview

`stella-light-agent` provides a streamlined voice AI pipeline that sacrifices some advanced features for improved performance:

- Faster response times
- Lower memory footprint
- Simpler configuration
- Ideal for development and testing

## Comparison with stella-agent

| Feature | stella-agent | stella-light-agent |
|---------|-------------|-------------------|
| STT Quality | High | Good |
| Response Latency | ~2-3s | ~1-2s |
| Memory Usage | 512Mi-2Gi | 256Mi-1Gi |
| Tool Calling | Yes | Limited |
| Progress Tracking | Yes | Basic |
| Conversation History | Full | Limited |

## When to Use

Choose `stella-light-agent` when:

- **Development/Testing**: Faster iteration cycles
- **Simple Conversations**: Q&A, basic support
- **Resource Constraints**: Limited cluster resources
- **Cost Optimization**: Lower compute costs
- **Low Latency Required**: Interactive demos

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `OPENAI_MODEL` | Model to use | `gpt-4o-mini` |
| `STT_PROVIDER` | Speech-to-text provider | `sherpa` |
| `TTS_PROVIDER` | Text-to-speech provider | `kokoro` |
| `MAX_HISTORY` | Max conversation turns to keep | `5` |

## Pipeline

The light agent uses a simplified pipeline:

```
Audio In → STT → LLM → TTS → Audio Out
```

Key differences from stella-agent:
- Minimal preprocessing
- Shorter context window
- Direct response streaming
- Limited tool support

## Resource Requirements

| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 100m | 500m |
| Memory | 256Mi | 1Gi |

## Data Channel Messages

Similar to stella-agent but with a reduced message set:

```typescript
// Transcript updates
{
  type: 'transcript_chunk',
  data: {
    text: string,
    is_final: boolean
  }
}

// Agent status
{
  type: 'agent_status',
  data: {
    status: 'listening' | 'speaking'
  }
}
```

## Deployment

Deploy via the API:

```bash
curl -X POST http://localhost:3000/sessions/{sessionId}/agents \
  -H "Content-Type: application/json" \
  -d '{
    "role": "conversational-ai",
    "agentType": "stella-light-agent"
  }'
```

Or via the Frontend UI by selecting "stella-light-agent" from the agent type dropdown.

## Performance Tuning

### Reduce Latency

1. Use a smaller LLM model (`gpt-4o-mini` vs `gpt-4o`)
2. Reduce `MAX_HISTORY` to minimize context
3. Use local STT/TTS services

### Reduce Memory

1. Lower `MAX_HISTORY` value
2. Disable unused features
3. Use streaming for all responses

## Limitations

- **Limited Tool Support**: Only basic tools available
- **Shorter Context**: May lose context in long conversations
- **Basic Progress Tracking**: No detailed todo management
- **Simpler Prompts**: Less nuanced conversation handling

## Upgrading to stella-agent

If you outgrow stella-light-agent:

1. Update the agent type in your deployment
2. Increase resource limits in your pod configuration
3. Add any additional environment variables for new features
4. Update your plans to use advanced features

## See Also

- [stella-agent](/docs/agents/stella-agent) - Full-featured agent
- [Agents Overview](/docs/agents/overview) - Agent comparison
- [First Agent](/docs/getting-started/first-agent) - Deployment guide
