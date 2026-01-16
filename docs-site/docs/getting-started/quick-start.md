---
sidebar_position: 1
title: "🚀 Quick Start"
---

# 🚀 Quick Start

Get the entire STELLA system running in 3 commands.

## Prerequisites

Before starting, ensure you have:
- Docker Desktop or OrbStack (macOS) / Docker Engine (Linux)
- An OpenAI API key
- A LiveKit server (cloud or self-hosted)

## Deploy Everything

```bash
# 1. Clone the repository
git clone https://github.com/c4dhi/STELLA_backend.git
cd STELLA_backend

# 2. Create .env file with your credentials
cp .env.example .env
nano .env  # Set OPENAI_API_KEY, LIVEKIT_* credentials, and database settings

# 3. Deploy everything
./scripts/start-k8s.sh

# OR: Run in background (survives SSH logout)
./scripts/start-k8s.sh --daemon
```

**Done!** System is now running at:

| Service | URL |
|---------|-----|
| Frontend UI | http://localhost:5173 |
| API | http://localhost:3000 |
| LiveKit | ws://localhost:7880 |
| Agents | Auto-created as Kubernetes pods |

## Deployment Modes

| Flag | Description | Use Case |
|------|-------------|----------|
| (default) | Foreground mode | Local development, press Ctrl+C to stop |
| `--daemon, -d` | Background mode | Remote servers, survives SSH logout |
| `--restart, -r` | Stop then restart | Apply code changes quickly |
| `--rebuild` | Force rebuild images | After Dockerfile changes |
| `--skip-build` | Skip builds | Restart pods only |
| `--stop` | Stop all services | Cleanup |
| `--dry-run` | Preview changes | Test before applying |
| `--production` | Production mode | Deploy with production settings |

## Examples

```bash
# Local development
./scripts/start-k8s.sh

# Production deployment in background
./scripts/start-k8s.sh --production --daemon

# Apply code changes (stop, rebuild, restart)
./scripts/start-k8s.sh --restart

# Force rebuild everything
./scripts/start-k8s.sh --rebuild

# Preview what would happen
./scripts/start-k8s.sh --dry-run --verbose
```

## Verify Deployment

```bash
# View all resources
kubectl get all -n ai-agents

# View backend logs
kubectl logs -f -n ai-agents -l app=session-management-server

# Monitor daemon mode logs
tail -f /tmp/stella-ai-k8s/stella-ai-k8s.log
```

## Next Steps

- [Installation Guide](/docs/getting-started/installation) - Detailed setup instructions
- [First Agent](/docs/getting-started/first-agent) - Deploy your first conversational AI agent
- [Agents Overview](/docs/agents/overview) - Learn about different agent types
