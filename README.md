# Session Management Server

A NestJS-based control plane for managing conversational AI sessions with LiveKit WebRTC integration and Kubernetes agent orchestration.

---

## 🚀 Kubernetes Quick Start (Recommended)

**Get the entire system running in 3 commands:**

```bash
# 1. Create .env file with your credentials
cp .env.example .env
nano .env  # Set OPENAI_API_KEY and database credentials

# 2. Deploy everything
./scripts/start-k8s.sh
```

✅ **Done!** System is now running at:
- Frontend UI: http://localhost:5173
- API: http://localhost:3000
- LiveKit: ws://localhost:7880
- Agents: Auto-created as Kubernetes pods

📖 **Full Kubernetes Guide**: See [K8S_DEPLOYMENT.md](./K8S_DEPLOYMENT.md) or [KUBERNETES_QUICK_START.md](../KUBERNETES_QUICK_START.md)

---

## Overview

This server manages the lifecycle of conversational AI sessions, including:
- **Project & Session Management**: Organize multiple sessions under projects
- **LiveKit Integration**: Token generation and room management
- **Kubernetes Orchestration**: Dynamic agent pod deployment
- **Frontend UI**: React-based web interface for real-time voice/text communication
- **Real-time Tracking**: Participants, messages, and events
- **Agent Control**: Start, stop, and monitor Python conversational AI agents

## Architecture

### Kubernetes Architecture (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                      Kubernetes Cluster                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   Namespace: ai-agents                │  │
│  │                                                       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │  │
│  │  │  PostgreSQL  │  │   LiveKit    │  │   Backend    │ │  │
│  │  │     :5432    │  │    :7880     │  │    API       │ │  │
│  │  └──────────────┘  └──────────────┘  │    :3000     │ │  │
│  │                                      └──────────────┘ │  │
│  │  ┌──────────────┐                                    │  │
│  │  │  Frontend UI │                                    │  │
│  │  │    :5173     │                                    │  │
│  │  └──────────────┘                                    │  │
│  │                                                       │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │        AI Agent Pods (Created On-Demand)         │ │  │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐           │ │  │
│  │  │  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │  ...      │ │  │
│  │  │  └─────────┘  └─────────┘  └─────────┘           │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          ↑                     ↑                   ↑
    Port Forward          Port Forward        Port Forward
   localhost:5173       localhost:3000     localhost:7880
```

### Standalone Architecture (Local Development)

```
┌─────────────────────────────────────────────────────────────┐
│                  Session Management Server                  │
│                       (NestJS + Prisma)                     │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Projects   │  │   Sessions   │  │    Agents    │       │
│  │    Module    │  │    Module    │  │    Module    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                           │                                 │
│                  ┌────────┴─────────┐                       │
│                  │   PostgreSQL     │                       │
│                  │   (Prisma ORM)   │                       │
│                  └──────────────────┘                       │
└──────────────────┬──────────────────────────┬───────────────┘
                   │                          │
        ┌──────────▼────────┐       ┌─────────▼──────────┐
        │   LiveKit Server  │       │  Kubernetes Cluster│
        │   (WebRTC)        │       │  (Agent Pods)      │
        └───────────────────┘       └────────────────────┘
```

## Features

### ✅ **Project Management**
- Create and organize multiple projects
- Track sessions, agents, and activity per project
- Get aggregated statistics

### ✅ **Session Management**
- Create sessions with unique LiveKit rooms
- Generate join tokens for participants
- Track session lifecycle (ACTIVE/CLOSED)
- Query and filter sessions

### ✅ **Agent Orchestration**
- Deploy conversational AI agents to Kubernetes
- Automatic Secret and Pod creation
- Pass plan configurations via environment variables
- Monitor agent status and logs
- Graceful shutdown and cleanup

### ✅ **LiveKit Integration**
- JWT token generation for secure room access
- WebRTC-based real-time communication
- Data channel for text messages

### ✅ **Data Persistence**
- PostgreSQL database via Prisma ORM
- Track participants, messages, and room events
- Timeline view combining messages and events

## Prerequisites

### Option 1: Kubernetes Deployment (Recommended)
- **Docker Desktop** with Kubernetes enabled
- **kubectl** CLI tool
- **minikube** (auto-installed by startup script on macOS)
- **OpenAI API key**

### Option 2: Standalone Deployment (Local Development)
- **Node.js** 18+ and npm
- **PostgreSQL** database
- **Kubernetes** cluster (minikube, k3s, or cloud provider)
- **LiveKit** server running
- **Docker** (for building agent images)

## Deployment Options

### Option 1: Kubernetes Deployment (Recommended)

**One-command deployment with everything included:**

```bash
# 1. Create .env file with your credentials
cp .env.example .env
nano .env
# Set:
#   OPENAI_API_KEY=sk-your-actual-key-here
#   POSTGRES_DB=session_management
#   POSTGRES_USER=your-db-username
#   POSTGRES_PASSWORD=your-secure-password

# 2. Make startup script executable (first time only)
chmod +x scripts/start-k8s.sh

# 3. Deploy everything
./scripts/start-k8s.sh
```

**What gets deployed:**
- ✅ PostgreSQL database with persistent storage
- ✅ LiveKit WebRTC server
- ✅ Session Management API server
- ✅ Frontend UI (React + Vite)
- ✅ Automatic Prisma migrations
- ✅ RBAC permissions for pod management
- ✅ Port forwarding to localhost

**Access URLs:**
- Frontend UI: http://localhost:5173
- API: http://localhost:3000
- LiveKit: ws://localhost:7880

**Useful commands:**
```bash
# View all resources
kubectl get all -n ai-agents

# View agent pods
kubectl get pods -n ai-agents -l app=conversational-ai-agent

# View backend logs
kubectl logs -f -n ai-agents -l app=session-management-server

# Stop cluster
minikube stop

# Restart cluster
./scripts/start-k8s.sh
```

📖 **Full Guide**: See [K8S_DEPLOYMENT.md](./K8S_DEPLOYMENT.md)

---

### Option 2: Standalone Deployment (Local Development)

**For manual setup or development without Kubernetes:**

#### 1. Install Dependencies

```bash
npm install
```

#### 2. Configure Environment

Copy `.env.example` to `.env` and update:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/session_management?schema=public"

# LiveKit
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Kubernetes
KUBERNETES_NAMESPACE=ai-agents
AGENT_IMAGE=conversational-ai-server:latest

# OpenAI (for agents)
OPENAI_API_KEY=sk-your-key
```

#### 3. Setup Database

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio to view data
npx prisma studio
```

#### 4. Build Agent Docker Image

```bash
cd conversational-ai-server-python
docker build -t conversational-ai-server:latest .
```

#### 5. Start the Server

```bash
# Development mode with hot reload
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

Server will start on `http://localhost:3000`

## API Endpoints

### Projects

#### `POST /projects`
Create a new project

```bash
curl -X POST http://localhost:3000/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My Project"}'
```

#### `GET /projects`
List all projects with counts

```bash
curl http://localhost:3000/projects
```

#### `GET /projects/:projectId`
Get project details

#### `GET /projects/:projectId/stats`
Get project statistics

```bash
curl http://localhost:3000/projects/abc123/stats
```

Returns:
```json
{
  "totalSessions": 10,
  "activeSessions": 3,
  "totalAgents": 5,
  "activeAgents": 2,
  "totalMessages": 150,
  "totalParticipants": 8
}
```

### Sessions

#### `POST /projects/:projectId/sessions`
Create a new session

```bash
curl -X POST http://localhost:3000/projects/abc123/sessions \
  -H "Content-Type: application/json" \
  -d '{"planId": "cognitive_stimulation_demo_sm"}'
```

#### `GET /projects/:projectId/sessions`
List sessions with filters

Query parameters:
- `status`: `ACTIVE` or `CLOSED`
- `search`: Filter by room name
- `skip`: Pagination offset
- `take`: Number of results (max 100)

```bash
curl "http://localhost:3000/projects/abc123/sessions?status=ACTIVE&take=20"
```

#### `GET /sessions/:sessionId`
Get session details including participants and agents

#### `POST /sessions/:sessionId/joinToken`
Mint a LiveKit join token for a participant

```bash
curl -X POST http://localhost:3000/sessions/xyz789/joinToken \
  -H "Content-Type: application/json" \
  -d '{
    "identity": "user-123",
    "name": "John Doe"
  }'
```

Returns:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "serverUrl": "ws://localhost:7880",
  "roomName": "session-1234567890-abc"
}
```

#### `GET /sessions/:sessionId/timeline`
Get unified timeline of messages and events

Query parameters:
- `skip`: Pagination offset (default: 0)
- `take`: Number of results (default: 50)

### Agents

#### `POST /sessions/:sessionId/agents`
Start a new agent for a session

```bash
curl -X POST http://localhost:3000/sessions/xyz789/agents \
  -H "Content-Type: application/json" \
  -d '{
    "role": "conversational-ai",
    "planId": "cognitive_stimulation_demo_sm"
  }'
```

This will:
1. Create an `AgentInstance` record in the database
2. Create a Kubernetes Secret with LiveKit credentials and env vars
3. Deploy a Kubernetes Pod running the Python conversational AI server
4. Return the agent details

#### `GET /agents/:agentId`
Get agent status and Kubernetes pod info

```bash
curl http://localhost:3000/agents/agent123
```

#### `GET /agents/:agentId/logs`
Get agent pod logs (last 100 lines)

```bash
curl http://localhost:3000/agents/agent123/logs
```

#### `DELETE /agents/:agentId`
Stop an agent and cleanup Kubernetes resources

```bash
curl -X DELETE http://localhost:3000/agents/agent123
```

## Data Model

### Project
- `id`: UUID
- `name`: Project name
- `createdAt`, `updatedAt`: Timestamps
- **Relations**: Many Sessions

### Session
- `id`: UUID
- `projectId`: Parent project
- `status`: `ACTIVE` | `CLOSED`
- `createdAt`, `closedAt`: Timestamps
- **Relations**: One Room, Many Agents, Participants, Messages, Events

### Room
- `id`: UUID
- `sessionId`: Parent session (unique)
- `livekitRoomName`: LiveKit room name (unique)
- `serverUrl`: LiveKit server URL

### AgentInstance
- `id`: UUID
- `sessionId`: Parent session
- `role`: Agent role (e.g., "conversational-ai")
- `status`: `STARTING` | `RUNNING` | `STOPPING` | `STOPPED` | `FAILED`
- `podName`: Kubernetes pod name
- `secretName`: Kubernetes secret name
- `planId`: Optional plan configuration
- `createdAt`, `stoppedAt`: Timestamps

### Participant
- `id`: UUID
- `sessionId`: Parent session
- `identity`: Participant identity (from LiveKit)
- `joinedAt`, `leftAt`: Timestamps

### Message
- `id`: UUID
- `sessionId`: Parent session
- `participantId`: Optional sender
- `content`: Message text
- `messageType`: `"text"` | `"transcript"` | `"system"`
- `timestamp`: Message time

### RoomEvent
- `id`: UUID
- `sessionId`: Parent session
- `eventType`: Event type (e.g., `"participant_joined"`)
- `data`: JSON event data
- `timestamp`: Event time

## Kubernetes Integration

### Agent Pod Deployment

When you create an agent via `POST /sessions/:sessionId/agents`, the server:

1. **Creates a Secret** named `agent-secret-{agentId}` containing:
   ```yaml
   LIVEKIT_URL: wss://livekit.example.com
   LIVEKIT_API_KEY: devkey
   LIVEKIT_API_SECRET: secret
   ROOM_NAME: session-1234567890-abc
   IDENTITY: agent-{agentId}
   OPENAI_API_KEY: sk-...
   TTS_PROVIDER: opensource
   PLAN_ID: cognitive_stimulation_demo_sm  # if specified
   ```

2. **Creates a Pod** named `agent-{agentId}` with:
   - Image: `conversational-ai-server:latest` (configurable)
   - Environment: Loaded from the Secret
   - Labels: `projectId`, `sessionId`, `role`
   - Resources: 512Mi-2Gi memory, 250m-1000m CPU

3. **Updates AgentInstance** record with pod and secret names

### Pod Cleanup

When you delete an agent via `DELETE /agents/:agentId`, the server:
1. Deletes the Kubernetes Pod
2. Deletes the Kubernetes Secret
3. Updates the AgentInstance status to `STOPPED`

### Viewing Logs

Agent logs are streamed from Kubernetes pods via the k8s API.

## Development

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
npx prisma migrate dev --name add_new_field

# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Deploy migrations to production
npx prisma migrate deploy
```

### Linting and Formatting

```bash
# Lint
npm run lint

# Format
npm run format
```

## Production Deployment

### Local Kubernetes (minikube)

**Use the automated startup script:**

```bash
# See "Deployment Options > Option 1" above
./scripts/start-k8s.sh
```

All Kubernetes manifests are in the `k8s/` directory:
- `00-namespace.yaml` - Creates `ai-agents` namespace
- `01-postgres.yaml` - PostgreSQL with PVC
- `02-livekit.yaml` - LiveKit server
- `03-secrets.yaml` - Base secrets (OpenAI key injected from `.env`)
- `04-configmap.yaml` - Environment config
- `05-rbac.yaml` - ServiceAccount + RBAC permissions
- `06-session-management-server.yaml` - Backend API deployment
- `07-frontend-ui.yaml` - Frontend UI deployment (React + Vite + nginx)

### Cloud Kubernetes (GKE/EKS/AKS)

For production deployment to cloud providers:

1. **Update secrets** in `k8s/03-secrets.yaml`:
   - Change all default passwords
   - Use real OpenAI API key
   - Consider using external secrets management (Vault, AWS Secrets Manager, etc.)

2. **Update database** to managed service:
   - Replace `k8s/01-postgres.yaml` with cloud database connection
   - Update `DATABASE_URL` in secrets

3. **Configure Ingress** for external access:
   ```bash
   kubectl apply -f k8s/
   kubectl apply -f k8s-production/ingress.yaml  # Your ingress config
   ```

4. **Enable SSL/TLS**:
   - Use cert-manager for automatic certificates
   - Update LiveKit URL to use `wss://`

5. **Scale backend**:
   ```bash
   kubectl scale deployment session-management-server -n ai-agents --replicas=3
   ```

### Docker Build (Manual)

```bash
# Build backend image
docker build -t session-management-server:latest .
docker push your-registry/session-management-server:latest

# Build agent image
cd conversational-ai-server-python
docker build -t conversational-ai-server:latest .
docker push your-registry/conversational-ai-server:latest

# Build frontend image
cd frontend-ui
docker build -t frontend-ui:latest .
docker push your-registry/frontend-ui:latest
```

### RBAC Requirements

The server needs Kubernetes permissions to create/delete Pods and Secrets. This is already configured in `k8s/05-rbac.yaml`:

- **ServiceAccount**: `session-management-sa`
- **Role**: Can create/get/list/delete pods, secrets, and pod logs
- **RoleBinding**: Binds the role to the service account

These are automatically applied by `./scripts/start-k8s.sh`.

## Troubleshooting

### "Connection to database failed"
- Ensure PostgreSQL is running
- Check `DATABASE_URL` in `.env`
- Run `npx prisma migrate deploy`

### "Failed to create pod: Forbidden"
- Check Kubernetes RBAC permissions
- Ensure the server has a ServiceAccount with Pod/Secret access
- Verify namespace exists: `kubectl get namespace ai-agents`

### "Agent pod not starting"
- Check agent image exists: `docker images | grep conversational-ai`
- View pod logs: `kubectl logs agent-{agentId} -n ai-agents`
- Check image pull policy matches availability

### "LiveKit connection refused"
- Ensure LiveKit server is running
- Check `LIVEKIT_URL` is accessible from the server
- Verify API key/secret match LiveKit config

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `LIVEKIT_URL` | LiveKit server URL | `ws://localhost:7880` |
| `LIVEKIT_API_KEY` | LiveKit API key | `devkey` |
| `LIVEKIT_API_SECRET` | LiveKit API secret | `secret` |
| `KUBERNETES_NAMESPACE` | K8s namespace for agents | `ai-agents` |
| `AGENT_IMAGE` | Docker image for agents | `conversational-ai-server:latest` |
| `AGENT_IMAGE_PULL_POLICY` | Image pull policy | `IfNotPresent` |
| `OPENAI_API_KEY` | OpenAI API key (for agents) | Required |
| `TTS_PROVIDER` | TTS provider for agents | `opensource` |
| `CORS_ORIGIN` | CORS allowed origins | `*` |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request

## License

This project is part of the voice-ai-agents monorepo.
