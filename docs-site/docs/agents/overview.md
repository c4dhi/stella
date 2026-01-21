---
sidebar_position: 1
title: "Overview"
---

# Agents Overview

STELLA supports multiple agent types, each designed for different use cases. All agents connect to LiveKit rooms for real-time voice and data communication.

## Agent Types

| Agent | Description | Best For |
|-------|-------------|----------|
| **stella-agent** | Full-featured agent with advanced STT, LLM, and TTS pipeline | Production conversations requiring high quality |
| **stella-light-agent** | Lightweight agent with simplified pipeline | Quick responses, lower resource usage |
| **echo-agent** | Simple test agent that echoes back messages | Testing and development |

## Architecture

All STELLA agents follow a similar pipeline architecture and can be configured with **Plans** — JSON-based conversation blueprints that define states, tasks, and data collection. See the [Plan Structure](/docs/plan-structure) documentation for details.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Pipeline                           │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Audio   │ -> │   STT    │ -> │   LLM    │ -> │   TTS    │  │
│  │  Input   │    │ (Speech  │    │(Response │    │  (Text   │  │
│  │(LiveKit) │    │  to Text)│    │Generation│    │ to Speech│  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                                                       │         │
│                                                       ▼         │
│                                              ┌──────────────┐   │
│                                              │ Audio Output │   │
│                                              │  (LiveKit)   │   │
│                                              └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Choosing an Agent

### stella-agent

Use the full-featured `stella-agent` when you need:
- High-quality speech recognition
- Advanced conversation capabilities
- Custom tool integration
- Complex dialogue flows
- Production deployments

### stella-light-agent

Use `stella-light-agent` when you need:
- Faster response times
- Lower resource consumption
- Simpler conversations
- Development and testing

### echo-agent

Use `echo-agent` for:
- Testing LiveKit connectivity
- Verifying audio pipeline
- Development debugging

## Common Configuration

All agents support these common environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `LIVEKIT_URL` | LiveKit server URL | Yes |
| `LIVEKIT_API_KEY` | LiveKit API key | Yes |
| `LIVEKIT_API_SECRET` | LiveKit API secret | Yes |
| `OPENAI_API_KEY` | OpenAI API key for LLM | Yes |
| `ROOM_NAME` | LiveKit room to join | Yes |
| `PARTICIPANT_IDENTITY` | Agent's identity in the room | Yes |

## Resource Requirements

| Agent | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-------|-------------|-----------|----------------|--------------|
| stella-agent | 250m | 1000m | 512Mi | 2Gi |
| stella-light-agent | 100m | 500m | 256Mi | 1Gi |
| echo-agent | 50m | 200m | 128Mi | 512Mi |

## Lifecycle

1. **Created**: Backend creates a Kubernetes pod with agent configuration
2. **Starting**: Agent initializes and connects to LiveKit room
3. **Running**: Agent processes audio and responds to participants
4. **Stopping**: Graceful shutdown when session ends or agent is stopped
5. **Terminated**: Pod is deleted, resources freed

## Next Steps

- [stella-agent](/docs/agents/stella-agent) - Full-featured agent details
- [stella-light-agent](/docs/agents/stella-light-agent) - Lightweight agent details
- [echo-agent](/docs/agents/echo-agent) - Test agent details
- [Agent SDK](/docs/agent-sdk/overview) - Build custom agents
