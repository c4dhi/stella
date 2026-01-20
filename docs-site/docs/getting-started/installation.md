---
sidebar_position: 2
title: "📦 Installation"
---

import {EnvVarReference} from '@site/src/components';

# 📦 Installation

Detailed guide for installing STELLA and its prerequisites.

## LiveKit Server (Required)

STELLA requires an external LiveKit server for WebRTC communication. You need to set up LiveKit before deploying STELLA:

- **LiveKit Cloud** (recommended): [livekit.io/cloud](https://livekit.io/cloud) - Managed service, easiest setup
- **Self-hosted**: [LiveKit Server Documentation](https://docs.livekit.io/home/self-hosting/local/) - Run your own server

Once LiveKit is set up, configure the following in your `.env`:

```bash
LIVEKIT_URL=wss://your-livekit-server.com        # Internal URL for agents
PUBLIC_LIVEKIT_URL=wss://your-livekit-server.com # Public URL for browsers
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

## Platform-Specific Setup

### macOS (OrbStack or Docker Desktop)

**Requirements:**
- **Docker**: [Docker Desktop](https://docker.com/products/docker-desktop) or [OrbStack](https://orbstack.dev) (recommended)
- **kubectl**: Auto-installed if missing
- **OpenAI API key**

OrbStack provides a built-in Kubernetes cluster that's lightweight and fast. The startup script auto-detects OrbStack and uses it automatically.

### Linux (K3s)

**Requirements:**
- **Docker**: Docker Engine
- **K3s**: Auto-installed by the startup script
- **OpenAI API key**

K3s is a lightweight Kubernetes distribution that's automatically installed and configured by the startup script on Linux systems.

### Windows (via WSL2)

STELLA supports Windows through WSL2 (Windows Subsystem for Linux). Follow the Linux instructions within WSL2.

## Environment Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

### Essential Variables

Configure the minimum required variables to get started:

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stella?schema=public"

# LiveKit
LIVEKIT_URL=ws://localhost:7880
PUBLIC_LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# AI
OPENAI_API_KEY=sk-your-openai-key
```

<EnvVarReference
  text="Complete Environment Variables Reference"
  description="See all available configuration options including STT/TTS providers, GPU settings, and Kubernetes configuration."
/>

## Local Development (Standalone)

For development without Kubernetes:

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Start development server
npm run start:dev
```

## Database Migrations

STELLA uses Prisma ORM with PostgreSQL. See [Database Schema](/docs/architecture/database) for the complete data model.

```bash
# Create a new migration
npx prisma migrate dev --name add_new_field

# Reset database
npx prisma migrate reset

# Deploy migrations to production
npx prisma migrate deploy
```

## Verify Installation

After deployment, verify all services are running:

```bash
# Check all pods are running
kubectl get pods -n ai-agents

# Test API health
curl http://localhost:3000/health

# Test frontend
curl http://localhost:5173
```

## Troubleshooting

### Connection Issues

**"Connection to database failed"**
- Ensure PostgreSQL pod is running: `kubectl get pods -n ai-agents`
- Check DATABASE_URL in your `.env`
- Run migrations: `npx prisma migrate deploy`

**"Failed to create pod: Forbidden"**
- Check Kubernetes RBAC permissions
- Ensure namespace exists: `kubectl get namespace ai-agents`
- Verify ServiceAccount: `kubectl get sa -n ai-agents`

**"Agent pod not starting"**
- Check agent image exists: `docker images | grep stella`
- View pod logs: `kubectl logs <pod-name> -n ai-agents`
- Check pod events: `kubectl describe pod <pod-name> -n ai-agents`

**"LiveKit connection refused"**
- Ensure LiveKit is properly configured
- Check port forwarding is active
- Verify LIVEKIT_URL in configuration

### Platform-Specific Issues

**macOS (OrbStack)**
- Ensure OrbStack is running before starting the script
- OrbStack provides Kubernetes automatically, no additional setup needed
- If using Docker Desktop instead, ensure Kubernetes is enabled in settings

**Linux (K3s)**
- K3s is auto-installed by the startup script
- Ensure user has docker group permissions: `sudo usermod -aG docker $USER`
- After adding to docker group, log out and back in

## Next Steps

- [First Agent](/docs/getting-started/first-agent) - Deploy your first agent
- [Database Schema](/docs/architecture/database) - Understand the data model
- [Kubernetes Deployment](/docs/deployment/kubernetes) - Production Kubernetes setup
