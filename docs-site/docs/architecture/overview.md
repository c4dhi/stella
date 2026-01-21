---
sidebar_position: 1
title: Architecture Overview
description: High-level overview of the STELLA platform architecture
---

# Architecture Overview

STELLA is a distributed system designed for building and deploying conversational AI agents at scale. This document provides a high-level overview of the architecture and key components.

## System Diagram

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

## Core Components

### Backend API (NestJS)

The backend is a NestJS application that serves as the control plane for the entire system:

| Responsibility | Description |
|---------------|-------------|
| Session Management | Creates, tracks, and terminates conversation sessions |
| Agent Orchestration | Deploys and manages agent pods via Kubernetes API |
| Authentication | Generates LiveKit tokens for secure room access |
| Data Persistence | Stores sessions, messages, and configurations |
| WebSocket Gateway | Real-time updates to connected clients |

**Key Endpoints:**

```
POST   /api/sessions          # Create a new session
GET    /api/sessions/:id      # Get session details
DELETE /api/sessions/:id      # End a session
POST   /api/sessions/:id/join # Get LiveKit token to join
GET    /api/projects          # List projects
```

### Frontend UI (React)

The frontend is a React application that provides the user interface:

- **LiveKit Integration**: WebRTC-based real-time audio/video
- **Session Management**: Create, view, and manage sessions
- **Real-time Updates**: WebSocket connection for live status updates
- **Responsive Design**: Works on desktop and mobile devices

### Agent Pods (Python)

Agent pods are containerized Python applications that handle conversations:

- **Speech-to-Text**: Converts audio to text using Sherpa-ONNX
- **LLM Processing**: Generates responses using OpenAI or other providers
- **Text-to-Speech**: Converts text back to audio using Kokoro TTS
- **Tool Execution**: Runs custom tools to interact with external systems

### LiveKit Server

LiveKit provides the real-time communication infrastructure:

- **WebRTC Media Server**: Handles audio/video streaming
- **Selective Forwarding**: Efficient multi-party communication
- **Data Channels**: Low-latency messaging between participants
- **Cloud or Self-Hosted**: Use LiveKit Cloud or deploy your own

### PostgreSQL Database

PostgreSQL with Prisma ORM stores all persistent data:

- **Users & Projects**: Authentication and organizational hierarchy
- **Sessions & Participants**: Conversation instances and connected users
- **Agents**: Agent types, instances, and configurations
- **Messages & Events**: Full conversation history and audit logs
- **Templates**: Reusable plans and environment configurations

See [Database Schema](/docs/architecture/database) for the complete data model.

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React, TypeScript, Tailwind | User interface |
| Backend | NestJS, TypeScript | API and orchestration |
| Database | PostgreSQL, Prisma | Data persistence |
| Agents | Python, stella-sdk | AI conversation logic |
| Media | LiveKit | Real-time communication |
| Container | Docker, Kubernetes | Deployment and scaling |

## Design Principles

### 1. Isolation

Each session runs in its own Kubernetes pod, providing:
- Process isolation for security
- Independent resource allocation
- Clean shutdown and cleanup

### 2. Scalability

The architecture scales horizontally:
- Backend API can run multiple replicas
- Agent pods scale with demand
- LiveKit handles media at scale

### 3. Modularity

Components are loosely coupled:
- Agents are interchangeable
- Multiple LLM providers supported
- STT/TTS providers are pluggable

### 4. Observability

Built-in monitoring capabilities:
- Structured logging
- Prometheus metrics
- Distributed tracing support

## Deployment Options

### Development

Local Kubernetes cluster (Docker Desktop, minikube, kind):
- Single-node setup
- Local image builds
- Port forwarding for access

### Production

Multi-node Kubernetes cluster:
- High availability
- Load balancing
- Persistent volumes
- TLS termination

## Next Steps

- [Data Flow](/docs/architecture/data-flow) - How messages flow through the system
- [Session Lifecycle](/docs/architecture/session-lifecycle) - Session states and transitions
- [Database Schema](/docs/architecture/database) - PostgreSQL data model with Prisma
- [Kubernetes Orchestration](/docs/architecture/kubernetes-orchestration) - Pod management details
