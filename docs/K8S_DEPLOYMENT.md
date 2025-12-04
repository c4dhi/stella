# Kubernetes Deployment Guide

This guide explains how to deploy the STELLA Session Management System to Kubernetes.

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

1. **Docker Desktop** - Must be installed and running
   - Download: https://www.docker.com/products/docker-desktop

2. **kubectl** - Kubernetes CLI
   - macOS: `brew install kubectl`
   - Windows: https://kubernetes.io/docs/tasks/tools/install-kubectl-windows/

3. **minikube** - Local Kubernetes cluster (auto-installed by script)
   - macOS: Script will install via Homebrew
   - Windows/Linux: https://minikube.sigs.k8s.io/docs/start/

### Configuration

**IMPORTANT**: Before deploying, create a `.env` file with your credentials:

```bash
# Copy the example file
cp .env.example .env

# Edit the .env file
nano .env

# Set your credentials:
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
POSTGRES_DB=session_management
POSTGRES_USER=your-db-username
POSTGRES_PASSWORD=your-secure-password
```

**Security Note**: The `.env` file is gitignored and will never be committed. Your credentials stay local and are injected into Kubernetes secrets during deployment.

## Quick Start

### 1. Deploy Everything

Run the all-in-one startup script:

```bash
cd session-management-server
./scripts/start-k8s.sh
```

This script will:
1. ✓ Check Docker is running
2. ✓ Install minikube (if needed)
3. ✓ Start minikube cluster
4. ✓ Build Docker images
5. ✓ Deploy PostgreSQL, LiveKit, and Backend
6. ✓ Wait for all services to be ready
7. ✓ Start port forwarding

**Expected output:**
```
======================================
Deployment Complete!
======================================

✓ API running at: http://localhost:3000
✓ LiveKit running at: ws://localhost:7880

Press Ctrl+C to stop port forwarding
```

### 2. Access the System

Once deployed, the system is accessible at:

- **Backend API**: http://localhost:3000
- **LiveKit**: ws://localhost:7880
- **Frontend** (if running): http://localhost:5173

### 3. Test Agent Creation

Create a session and add an agent via the frontend or API:

```bash
# Create a session
curl -X POST http://localhost:3000/projects/{projectId}/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Session"}'

# Add an agent to the session
curl -X POST http://localhost:3000/sessions/{sessionId}/agents \
  -H "Content-Type: application/json" \
  -d '{"role": "conversational-ai", "planId": "cognitive_stimulation_demo_sm"}'
```

The backend will automatically create a new Kubernetes pod for the agent!

## Useful Commands

### View All Resources
```bash
kubectl get all -n ai-agents
```

### View Agent Pods
```bash
kubectl get pods -n ai-agents -l app=conversational-ai-agent
```

### View Backend Logs
```bash
kubectl logs -f -n ai-agents -l app=session-management-server
```

### View Specific Agent Logs
```bash
kubectl logs -n ai-agents <agent-pod-name>
```

### Access Postgres Database
```bash
kubectl port-forward -n ai-agents svc/postgres 5432:5432
# Then connect with: postgresql://app:app@localhost:5432/app
```

### Open Kubernetes Dashboard
```bash
minikube dashboard
```

### Scale Backend
```bash
kubectl scale deployment session-management-server -n ai-agents --replicas=3
```

## Architecture Details

### Components

#### 1. PostgreSQL
- **Deployment**: `postgres`
- **Service**: `postgres:5432`
- **Storage**: 10Gi PersistentVolumeClaim
- **Credentials**: app/app (development)

#### 2. LiveKit Server
- **Deployment**: `livekit`
- **Service**: `livekit:7880` (HTTP), `livekit:7881` (RTP/UDP)
- **Mode**: Development mode (`--dev` flag)

#### 3. Session Management Server
- **Deployment**: `session-management-server`
- **Service**: `session-management-server:3000`
- **Service Account**: `session-management-sa` (with RBAC permissions)
- **Capabilities**: Creates/manages agent pods dynamically

#### 4. AI Agent Pods (On-Demand)
- **Created by**: Backend server via Kubernetes API
- **Image**: `conversational-ai-server:latest`
- **Lifecycle**: Created per session, auto-deleted when stopped
- **Resources**: 512Mi-2Gi RAM, 250m-1000m CPU

### Security

- **RBAC**: Service account with limited permissions (pod/secret/configmap management in `ai-agents` namespace only)
- **Secrets**: Sensitive data stored in Kubernetes secrets
- **Network**: All services use ClusterIP (internal only, accessed via port-forward)

### Resource Limits

| Component | Request | Limit |
|-----------|---------|-------|
| PostgreSQL | 256Mi/250m CPU | 512Mi/500m CPU |
| LiveKit | 256Mi/250m CPU | 1Gi/1000m CPU |
| Backend | 512Mi/250m CPU | 1Gi/1000m CPU |
| Agent | 512Mi/250m CPU | 2Gi/1000m CPU |

## Troubleshooting

### minikube won't start
```bash
# Delete and recreate cluster
minikube delete
minikube start --driver=docker --cpus=4 --memory=8192
```

### Pods stuck in ImagePullBackOff
```bash
# Images must be built in minikube's Docker daemon
eval $(minikube docker-env)
cd session-management-server
docker build -t session-management-server:latest .
docker build -t conversational-ai-server:latest ./conversational-ai-server-python
```

### Backend can't create agent pods
```bash
# Check RBAC permissions
kubectl get role,rolebinding -n ai-agents

# Check service account
kubectl get serviceaccount -n ai-agents

# View backend logs
kubectl logs -f -n ai-agents -l app=session-management-server
```

### Agent pod fails to start
```bash
# View pod status
kubectl get pods -n ai-agents -l app=conversational-ai-agent

# View pod logs
kubectl logs -n ai-agents <agent-pod-name>

# Describe pod for events
kubectl describe pod -n ai-agents <agent-pod-name>
```

### Database migration fails
```bash
# Run migration manually
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

### 1. Make Code Changes

Edit your source code in `session-management-server/` or `conversational-ai-server-python/`.

### 2. Rebuild Images
```bash
eval $(minikube docker-env)
docker build -t session-management-server:latest .
# or
docker build -t conversational-ai-server:latest ./conversational-ai-server-python
```

### 3. Restart Deployment
```bash
kubectl rollout restart deployment/session-management-server -n ai-agents
```

### 4. View Logs
```bash
kubectl logs -f -n ai-agents -l app=session-management-server
```

## Production Considerations

For production deployment, you should:

1. **Use real Kubernetes cluster** (GKE, EKS, AKS)
2. **Configure Ingress** for external access
3. **Use managed PostgreSQL** (Cloud SQL, RDS, etc.)
4. **Store secrets securely** (Vault, AWS Secrets Manager)
5. **Enable SSL/TLS** for all services
6. **Set up monitoring** (Prometheus, Grafana)
7. **Configure autoscaling** (HPA for backend and agents)
8. **Use persistent volumes** with backup strategies
9. **Implement CI/CD** for automated deployments
10. **Change all default passwords and secrets!**

## Next Steps

1. **Create your `.env` file**: `cp .env.example .env` and add your OpenAI API key
2. **Run the startup script**: `./scripts/start-k8s.sh`
3. **Access the frontend**: Navigate frontend to use localhost:3000 as API URL
4. **Create sessions** and watch agent pods spawn automatically!

---

**Need help?** Check the troubleshooting section or view cluster logs with `kubectl logs`.
