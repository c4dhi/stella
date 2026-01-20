---
sidebar_position: 1
title: Kubernetes
---

import {EnvVarReference} from '@site/src/components';

# Kubernetes Deployment

This guide explains how to deploy the STELLA system to Kubernetes.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Kubernetes Cluster                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   Namespace: ai-agents                 │  │
│  │                                                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │  │
│  │  │  PostgreSQL  │  │   LiveKit    │  │   Backend    │ │  │
│  │  │     :5432    │  │    :7880     │  │    API       │ │  │
│  │  └──────────────┘  └──────────────┘  │    :3000     │ │  │
│  │                                       └──────────────┘ │  │
│  │                                                         │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │        AI Agent Pods (Created On-Demand)         │ │  │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │ │  │
│  │  │  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │  ...     │ │  │
│  │  │  └─────────┘  └─────────┘  └─────────┘          │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          ↑                                     ↑
    Port Forward                          Port Forward
    localhost:3000                      localhost:7880
```

## Prerequisites

### Required Software

| Software | Description | Installation |
|----------|-------------|--------------|
| Docker | Container runtime | [Docker Desktop](https://docker.com/products/docker-desktop) or [OrbStack](https://orbstack.dev) |
| kubectl | Kubernetes CLI | `brew install kubectl` (macOS) |
| minikube | Local Kubernetes | Auto-installed by script |

### Configuration

Create a `.env` file with your credentials:

```bash
cp .env.example .env
nano .env
```

Set your essential Kubernetes deployment credentials:

```bash
# AI APIs
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx

# LiveKit (WebRTC)
LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

<EnvVarReference
  category="kubernetes"
  text="Kubernetes Environment Variables"
  description="See namespace configuration, DNS settings, and other K8s-specific options."
/>

:::caution Security
The `.env` file is gitignored. Your credentials stay local and are injected into Kubernetes secrets during deployment.
:::

## Quick Start

### Deploy Everything

Run the all-in-one startup script:

```bash
./scripts/start-k8s.sh
```

This script will:
1. Check Docker is running
2. Install minikube (if needed)
3. Start minikube cluster
4. Build Docker images
5. Deploy PostgreSQL, LiveKit, and Backend
6. Wait for all services to be ready
7. Start port forwarding

### Access the System

Once deployed:

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3000 |
| LiveKit | ws://localhost:7880 |
| Frontend | http://localhost:5173 |

## Components

### PostgreSQL

- **Deployment**: `postgres`
- **Service**: `postgres:5432`
- **Storage**: 10Gi PersistentVolumeClaim
- **Credentials**: Configured via environment

See [Database Schema](/docs/architecture/database) for the complete data model.

### LiveKit Server (if self-hosted)

- **Deployment**: `livekit`
- **Service**: `livekit:7880` (HTTP), `livekit:7881` (RTP/UDP)
- **Mode**: Development mode (`--dev` flag)

### Session Management Server

- **Deployment**: `session-management-server`
- **Service**: `session-management-server:3000`
- **Service Account**: `session-management-sa` (with RBAC permissions)
- **Capabilities**: Creates/manages agent pods dynamically

### AI Agent Pods (On-Demand)

- **Created by**: Backend server via Kubernetes API
- **Image**: `conversational-ai-server:latest`
- **Lifecycle**: Created per session, auto-deleted when stopped
- **Resources**: 512Mi-2Gi RAM, 250m-1000m CPU

## Useful Commands

### View Resources

```bash
# View all resources
kubectl get all -n ai-agents

# View agent pods
kubectl get pods -n ai-agents -l app=conversational-ai-agent

# View backend logs
kubectl logs -f -n ai-agents -l app=session-management-server

# View specific agent logs
kubectl logs -n ai-agents <agent-pod-name>
```

### Database Access

```bash
kubectl port-forward -n ai-agents svc/postgres 5432:5432
# Then connect with: postgresql://app:app@localhost:5432/app
```

### Scaling

```bash
kubectl scale deployment session-management-server -n ai-agents --replicas=3
```

## Resource Limits

| Component | Request | Limit |
|-----------|---------|-------|
| PostgreSQL | 256Mi/250m CPU | 512Mi/500m CPU |
| LiveKit | 256Mi/250m CPU | 1Gi/1000m CPU |
| Backend | 512Mi/250m CPU | 1Gi/1000m CPU |
| Agent | 512Mi/250m CPU | 2Gi/1000m CPU |

## Troubleshooting

### minikube Won't Start

```bash
# Delete and recreate cluster
minikube delete
minikube start --driver=docker --cpus=4 --memory=8192
```

### Pods Stuck in ImagePullBackOff

Images must be built in minikube's Docker daemon:

```bash
eval $(minikube docker-env)
docker build -t session-management-server:latest .
docker build -t conversational-ai-server:latest ./conversational-ai-server-python
```

### Backend Can't Create Agent Pods

```bash
# Check RBAC permissions
kubectl get role,rolebinding -n ai-agents

# Check service account
kubectl get serviceaccount -n ai-agents

# View backend logs
kubectl logs -f -n ai-agents -l app=session-management-server
```

### Agent Pod Fails to Start

```bash
# View pod status
kubectl get pods -n ai-agents -l app=conversational-ai-agent

# View pod logs
kubectl logs -n ai-agents <agent-pod-name>

# Describe pod for events
kubectl describe pod -n ai-agents <agent-pod-name>
```

### Database Migration Fails

```bash
kubectl exec -it -n ai-agents deployment/session-management-server -- npx prisma migrate deploy
```

## Stopping the Cluster

### Stop Port Forwarding

Press `Ctrl+C` in the terminal running the startup script.

### Stop minikube

```bash
minikube stop
```

### Delete Everything

```bash
# Delete namespace (removes all resources)
kubectl delete namespace ai-agents

# Or delete entire cluster
minikube delete
```

## Development Workflow

### Make Code Changes

Edit your source code in `session-management-server/` or `conversational-ai-server-python/`.

### Rebuild Images

```bash
eval $(minikube docker-env)
docker build -t session-management-server:latest .
docker build -t conversational-ai-server:latest ./conversational-ai-server-python
```

### Restart Deployment

```bash
kubectl rollout restart deployment/session-management-server -n ai-agents
```

### View Logs

```bash
kubectl logs -f -n ai-agents -l app=session-management-server
```

## See Also

- [Database Schema](/docs/architecture/database) - PostgreSQL data model
- [Production Deployment](/docs/deployment/production)
- [Nginx Setup](/docs/deployment/nginx-setup)
- [LiveKit Integration](/docs/integration/livekit)
