---
sidebar_position: 5
title: Guides
---

# Guides

Practical guides for common tasks and advanced configurations.

## Development Guides

### Local Development Setup

For developing STELLA without the full Kubernetes stack:

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Start development server
npm run start:dev
```

### Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

### Database Migrations

```bash
# Create a new migration
npx prisma migrate dev --name your_migration_name

# Reset database (development only)
npx prisma migrate reset

# Deploy migrations to production
npx prisma migrate deploy
```

## Useful Commands

### Kubernetes

```bash
# View all resources in the namespace
kubectl get all -n ai-agents

# View agent pods
kubectl get pods -n ai-agents -l app=conversational-ai-agent

# View backend logs
kubectl logs -f -n ai-agents -l app=session-management-server

# View specific agent logs
kubectl logs -n ai-agents <agent-pod-name>

# Access Postgres database
kubectl port-forward -n ai-agents svc/postgres 5432:5432
```

### Daemon Mode

```bash
# Check if port-forwards are running
cat /tmp/stella-ai-k8s/port-forwards.pid
ps -p $(cat /tmp/stella-ai-k8s/port-forwards.pid)

# View daemon logs
tail -f /tmp/stella-ai-k8s/stella-ai-k8s.log

# Clean restart
./scripts/start-k8s.sh --stop
./scripts/start-k8s.sh --daemon
```

## API Reference

### Projects

```bash
# Create project
curl -X POST http://localhost:3000/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My Project"}'

# List projects
curl http://localhost:3000/projects

# Get project stats
curl http://localhost:3000/projects/:projectId/stats
```

### Sessions

```bash
# Create session
curl -X POST http://localhost:3000/projects/:projectId/sessions \
  -H "Content-Type: application/json" \
  -d '{"planId": "my_plan"}'

# Get join token
curl -X POST http://localhost:3000/sessions/:sessionId/joinToken \
  -H "Content-Type: application/json" \
  -d '{"identity": "user-123", "name": "John Doe"}'
```

### Agents

```bash
# Start agent
curl -X POST http://localhost:3000/sessions/:sessionId/agents \
  -H "Content-Type: application/json" \
  -d '{"role": "conversational-ai"}'

# Get agent status
curl http://localhost:3000/agents/:agentId

# Get agent logs
curl http://localhost:3000/agents/:agentId/logs

# Stop agent
curl -X DELETE http://localhost:3000/agents/:agentId
```

## Configuration Guides

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `LIVEKIT_URL` | LiveKit server URL (internal) | Required |
| `PUBLIC_LIVEKIT_URL` | LiveKit URL for browser clients | Required |
| `LIVEKIT_API_KEY` | LiveKit API key | Required |
| `LIVEKIT_API_SECRET` | LiveKit API secret | Required |
| `KUBERNETES_NAMESPACE` | K8s namespace for agents | `ai-agents` |
| `AGENT_IMAGE` | Docker image for agents | `conversational-ai-server:latest` |
| `OPENAI_API_KEY` | OpenAI API key (for agents) | Required |
| `STT_PROVIDER` | Speech-to-text provider | `sherpa` |
| `TTS_PROVIDER` | Text-to-speech provider | `kokoro` |

### Plan Templates

Create custom conversation plans:

```json
{
  "id": "customer-support",
  "name": "Customer Support",
  "description": "Handle customer inquiries",
  "systemPrompt": "You are a helpful customer support agent...",
  "tools": ["search_kb", "create_ticket"],
  "settings": {
    "maxTurns": 20,
    "timeout": 300,
    "greeting": "Hello! How can I help you today?"
  }
}
```

## Troubleshooting

See specific troubleshooting sections in:

- [Installation Guide](/docs/getting-started/installation#troubleshooting)
- [First Agent](/docs/getting-started/first-agent#troubleshooting)
- [Kubernetes Deployment](/docs/deployment/kubernetes#troubleshooting)

## Further Reading

- [Deployment Guides](/docs/deployment/kubernetes) - Production deployment
- [LiveKit Integration](/docs/integration/livekit) - WebRTC setup
- [Agent SDK](/docs/agent-sdk/overview) - Building custom agents
