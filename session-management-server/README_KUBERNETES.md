# Session Management Server - Kubernetes Edition

This directory contains everything needed to run the STELLA Session Management System on Kubernetes.

## Quick Start

```bash
# 1. Create .env file with your OpenAI API key
cp .env.example .env
nano .env  # Set OPENAI_API_KEY=sk-your-key

# 2. Deploy everything
./scripts/start-k8s.sh
```

Done! System is running at:
- **Frontend Dashboard**: http://localhost:8080
- **API**: http://localhost:3000
- **LiveKit**: ws://localhost:7880

## What's Included

### Dockerfiles
- `Dockerfile` - NestJS backend API server
- `conversational-ai-server-python/Dockerfile` - Python AI agent
- `message-recorder-python/Dockerfile` - Message recording service
- `frontend-ui/Dockerfile` - React dashboard UI

### Kubernetes Manifests (`k8s/`)
- `00-namespace.yaml` - Creates `ai-agents` namespace
- `01-postgres.yaml` - PostgreSQL database with persistent storage
- `02-livekit.yaml` - LiveKit WebRTC server
- `03-secrets.yaml` - Base secrets (OpenAI key injected from `.env`)
- `04-configmap.yaml` - Environment configuration
- `05-rbac.yaml` - Service account + permissions for pod management
- `06-message-recorder.yaml` - Message recording service deployment
- `06-session-management-server.yaml` - Backend API deployment
- `07-frontend-ui.yaml` - React dashboard deployment

### Scripts
- `scripts/start-k8s.sh` - One-command deployment

### Documentation
- `K8S_DEPLOYMENT.md` - Complete deployment guide
- `../KUBERNETES_QUICK_START.md` - TL;DR version

## How It Works

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Kubernetes Cluster                                │
│                                                                            │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  PostgreSQL  │  │   LiveKit   │  │  Backend API │  │  Frontend UI │  │
│  │  (Database)  │  │   (WebRTC)  │  │  (NestJS)    │  │  (React)     │  │
│  └──────────────┘  └─────────────┘  └──────────────┘  └──────────────┘  │
│         ↑                  ↑                 ↓                             │
│         │                  │                 │                             │
│         │        ┌─────────┴─────────┐       │                             │
│         └────────┤  Message Recorder │       │                             │
│                  │  (Records chat    │       │                             │
│                  │   to database)    │       │                             │
│                  └───────────────────┘       │                             │
│                                              ↓                             │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                AI Agent Pods (Auto-Created)                       │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐             │    │
│  │  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │  │ Agent N │ ...         │    │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Session Flow

**Starting a Session:**
1. User opens Frontend UI and creates a new session
2. Frontend calls Backend API to create session
3. Backend creates database record and LiveKit room
4. Message Recorder automatically joins LiveKit room to record messages
5. Backend creates AI Agent pod via Kubernetes API
6. Agent pod starts, connects to LiveKit, and joins the conversation

**During Conversation:**
1. User speaks → LiveKit → AI Agent processes → Responds
2. All messages flow through LiveKit data channels
3. Message Recorder captures and stores everything to PostgreSQL
4. Frontend displays real-time conversation and task progress

**Session Replay (Time Machine):**
1. User reopens a session → Frontend loads historical messages
2. User scrolls through chat → Task sidebar updates to show exact historical state
3. All deliverables, reasoning, and progress appear as they were at that point in time

## Requirements

- Docker Desktop (running)
- kubectl
- minikube (auto-installed by script)
- Your OpenAI API key

## Key Features

### 🎯 Session Management
- Create and manage multiple AI conversation sessions
- Real-time WebRTC communication via LiveKit
- Automatic message recording to PostgreSQL
- Multi-agent support with dynamic pod creation

### ⏰ Time Machine (Session Replay)
- Scroll through chat history to see exact task state at any point in time
- Task progress bar updates as you scroll
- Historical deliverables, reasoning, and confidence scores
- Greyscale visual indicator when viewing historical state

### 📊 Task Progress Tracking
- Real-time task and deliverable tracking
- Multi-state workflows with flexible/sequential processing
- Automatic deliverable collection and validation
- Visual progress indicators and completion status

### 💬 Message Recording
- Automatic recording of all conversation messages
- Complete envelope storage for perfect replay
- Support for transcripts, task updates, and control messages
- Session-specific message isolation

## Architecture Benefits

✅ **Automatic Scaling**: Each agent runs in its own pod
✅ **Resource Isolation**: Agents can't interfere with each other
✅ **Self-Healing**: Kubernetes restarts failed pods
✅ **Easy Updates**: Rolling deployments with zero downtime
✅ **Production-Ready**: Same setup works in GKE/EKS/AKS
✅ **Message Persistence**: All conversations stored and replayable
✅ **Real-time Updates**: Live task progress and state synchronization

## Next Steps

1. Read `K8S_DEPLOYMENT.md` for full details
2. Create `.env` file with your OpenAI key (`cp .env.example .env`)
3. Run `./scripts/start-k8s.sh`
4. Open Frontend Dashboard at `http://localhost:8080`
5. Create a session and start chatting with the AI agent
6. Watch agent pods spawn automatically in the cluster
7. Try the Time Machine: reopen a session and scroll through history!

## Support

- Full docs: `K8S_DEPLOYMENT.md`
- Quick start: `../KUBERNETES_QUICK_START.md`
- Troubleshooting: See docs above

---

**Made with ❤️ by Claude**
