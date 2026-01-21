---
sidebar_position: 1
title: Getting Started
description: Get STELLA running in minutes with this step-by-step guide
---

import {Steps, Step} from '@site/src/components/StepGuide';
import {EnvVarReference} from '@site/src/components';

# Getting Started with STELLA

Get the entire STELLA platform running in minutes. This guide walks you through setting up your development environment, configuring your credentials, and deploying your first voice AI agent.

## Prerequisites

Before you begin, make sure you have:

- **Docker**: [OrbStack](https://orbstack.dev/) (recommended for macOS), Docker Desktop (Windows), or Docker Engine (Linux)
- **kubectl** configured with a Kubernetes cluster (OrbStack and Docker Desktop include one)
- **OpenAI API key** for the conversational AI
- **LiveKit account** (cloud or self-hosted) for real-time communication

:::tip New to LiveKit?
You can [sign up for a free LiveKit Cloud account](https://cloud.livekit.io) to get started quickly. LiveKit Cloud handles all the WebRTC infrastructure for you.
:::

## Installation

<Steps>

<Step number={1} title="Clone the repository">

Clone the STELLA repository and navigate to the project directory.

```bash title="terminal"
git clone https://github.com/c4dhi/STELLA_backend.git
cd STELLA_backend
```

</Step>

<Step number={2} title="Configure environment variables">

Copy the example environment file and add your credentials.

```bash title="terminal"
cp .env.example .env
```

Edit the `.env` file with your essential configuration:

```bash title=".env"
# LiveKit (required)
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# AI (required)
OPENAI_API_KEY=sk-your-openai-key
```

<EnvVarReference description="See all available configuration options including database, security, and provider settings." />

</Step>

<Step number={3} title="Start the services">

Deploy the entire STELLA stack with a single command.

```bash title="terminal"
./scripts/start-k8s.sh
```

This script will:
- Build all Docker images
- Create the Kubernetes namespace
- Deploy PostgreSQL, backend, and frontend services
- Set up port forwarding for local access

</Step>

<Step number={4} title="Verify the deployment" isLast>

Check that all services are running:

```bash title="terminal"
kubectl get pods -n ai-agents
```

You should see pods for `postgres`, `session-management-server`, and `frontend-ui` all in `Running` status.

</Step>

</Steps>

## Access the Application

Once deployed, STELLA is available at:

| Service | URL | Description |
|---------|-----|-------------|
| Frontend UI | http://localhost:5173 | Web interface for voice conversations |
| Backend API | http://localhost:3000 | REST API and WebSocket server |
| API Docs | http://localhost:3000/api | Swagger documentation |

## Your First Conversation

1. Open http://localhost:5173 in your browser
2. Create a new project or select an existing one
3. Click **Start Session** to begin a conversation
4. Grant microphone permissions when prompted
5. Start talking - the AI agent will respond in real-time

## Deployment Modes

STELLA supports several deployment modes for different use cases:

| Flag | Description | Use Case |
|------|-------------|----------|
| (default) | Foreground mode | Local development |
| `--daemon` | Background mode | Production servers |
| `--restart` | Stop and restart | Apply code changes |
| `--rebuild` | Force rebuild | After Dockerfile changes |
| `--production` | Production settings | Deploy to production |

### Examples

```bash title="terminal"
# Local development (foreground)
./scripts/start-k8s.sh

# Production deployment (background)
./scripts/start-k8s.sh --production --daemon

# Apply code changes
./scripts/start-k8s.sh --restart

# Stop all services
./scripts/start-k8s.sh --stop
```

## Troubleshooting

### Pods not starting

Check pod logs for errors:

```bash title="terminal"
kubectl logs -f -n ai-agents -l app=session-management-server
```

### Database connection issues

Ensure the PostgreSQL pod is running:

```bash title="terminal"
kubectl get pods -n ai-agents -l app=postgres
```

### LiveKit connection fails

Verify your LiveKit credentials in `.env` and ensure WebSocket connections are allowed.

## Next Steps

- [Build Your Own Agent](/docs/guides/build-your-own-agent) - Build a custom voice AI agent
- [Architecture Overview](/docs/architecture/overview) - Understand how STELLA works
- [Agent SDK Reference](/docs/sdk/overview) - Explore the Python SDK
