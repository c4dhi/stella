---
sidebar_position: 1
slug: /
title: Introduction
---

# STELLA

**System for Testing and Engineering LLM-based Conversational Agents**

STELLA is a NestJS-based control plane for managing conversational AI sessions with LiveKit WebRTC integration and Kubernetes agent orchestration.

## What is STELLA?

STELLA provides a complete infrastructure for building, deploying, and managing voice-enabled AI agents. It handles:

- **Real-time Communication**: WebRTC-based voice and data streaming via LiveKit
- **Agent Orchestration**: Automatic Kubernetes pod management for AI agents
- **Session Management**: Track conversations, participants, and messages
- **Flexible Architecture**: Support for multiple agent types with customizable pipelines

## Architecture

```
                              ┌─────────────────────────┐
                              │   LiveKit Cloud/Server  │
                              │      (External)         │
                              │   WebRTC Media Server   │
                              └───────────┬─────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Kubernetes Cluster                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                       Namespace: ai-agents                        │  │
│  │                                                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │  │
│  │  │  PostgreSQL  │  │  Backend API │  │       Frontend UI        │ │  │
│  │  │    :5432     │  │    :3000     │  │         :5173            │ │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘ │  │
│  │                                                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐                               │  │
│  │  │ STT Service  │  │ TTS Service  │   Speech-to-Text & Text-to-  │  │
│  │  │   :50051     │  │   :50052     │   Speech microservices       │  │
│  │  └──────────────┘  └──────────────┘                               │  │
│  │                                                                   │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │              AI Agent Pods (Created On-Demand)               │ │  │
│  │  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐     │ │  │
│  │  │  │ stella-agent  │  │ stella-agent  │  │  stella-light │ ... │ │  │
│  │  │  │   Session 1   │  │   Session 2   │  │    Session 3  │     │ │  │
│  │  │  └───────────────┘  └───────────────┘  └───────────────┘     │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Components

| Component | Description |
|-----------|-------------|
| **LiveKit** | External WebRTC media server (cloud-hosted or self-hosted) |
| **Backend API** | NestJS server managing sessions, agents, and LiveKit tokens |
| **Frontend UI** | React app for real-time voice/text communication |
| **STT/TTS Services** | Microservices for speech recognition and synthesis |
| **Agent Pods** | Python conversational AI agents, created per session |

## Features

### Project & Session Management
- Create and organize multiple projects
- Track sessions, agents, and activity per project
- Get aggregated statistics

### Agent Orchestration
- Deploy conversational AI agents to Kubernetes
- Automatic Secret and Pod creation
- Pass plan configurations via environment variables
- Monitor agent status and logs
- Graceful shutdown and cleanup

### LiveKit Integration
- JWT token generation for secure room access
- WebRTC-based real-time communication
- Data channel for text messages

### Data Persistence
- PostgreSQL database via Prisma ORM
- Track participants, messages, and room events
- Timeline view combining messages and events

## Next Steps

- **[Quick Start](/docs/getting-started/quick-start)**: Get STELLA running in 3 commands
- **[Installation](/docs/getting-started/installation)**: Detailed prerequisites and setup
- **[First Agent](/docs/getting-started/first-agent)**: Deploy your first conversational AI agent
- **[Agents Overview](/docs/agents/overview)**: Learn about different agent types
