# Grace AI - Deployment Guide

Complete guide for deploying Grace AI in both local development and production environments.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Local Development Setup](#local-development-setup)
4. [Production Deployment](#production-deployment)
5. [Switching Environments](#switching-environments)
6. [Troubleshooting](#troubleshooting)

## Overview

Grace AI supports two deployment modes:

### Local Development
- **Access**: `localhost` with port-forwards
- **Ports**: Frontend (8080), Backend (3000), LiveKit (7880), Database (5432)
- **SSL**: Not required
- **Use Case**: Development, testing, debugging

### Production
- **Access**: Custom domains with SSL
- **Domains**: `*.c4dhi.moserfelix.com` (configurable in `.env`)
- **SSL**: Required (via nginx reverse proxy)
- **Use Case**: Production deployment, multi-user access

## Architecture

### Local Development Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                    Local Machine (localhost)                    │
│                                                                  │
│  Browser → localhost:8080 (Frontend)                           │
│         → localhost:3000 (Backend API)                          │
│         → ws://localhost:7880 (LiveKit WebSocket)              │
│                                                                  │
│                           ↓ kubectl port-forward                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Kubernetes (minikube)                          │  │
│  │                                                          │  │
│  │  ClusterIP Services → Pods                              │  │
│  │  • frontend-ui:8080      → Frontend Pod                 │  │
│  │  • backend:3000          → Backend Pod                  │  │
│  │  • livekit:7880          → LiveKit Pod                  │  │
│  │  • postgres:5432         → PostgreSQL Pod               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Production Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│         Internet → *.c4dhi.moserfelix.com (SSL)                │
│                           ↓                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Nginx Reverse Proxy (Host)                  │  │
│  │  • frontend.DOMAIN:443  → 127.0.0.1:30080              │  │
│  │  • backend.DOMAIN:443   → 127.0.0.1:30000              │  │
│  │  • livekit.DOMAIN:443   → 127.0.0.1:30880              │  │
│  │  • db.DOMAIN:5432       → 127.0.0.1:30432              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Kubernetes (k3s/minikube)                      │  │
│  │                                                          │  │
│  │  NodePort Services → Pods                               │  │
│  │  • frontend-ui:30080     → Frontend Pod                 │  │
│  │  • backend:30000         → Backend Pod                  │  │
│  │  • livekit:30880         → LiveKit Pod                  │  │
│  │  • postgres:30432        → PostgreSQL Pod               │  │
│  │                                                          │  │
│  │  Internal ClusterIP (service-to-service)                │  │
│  │  • postgres:5432  (backend ←→ database)                 │  │
│  │  • livekit:7880   (backend ←→ livekit)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Local Development Setup

### Prerequisites
- Docker installed and running
- kubectl installed
- minikube installed
- 8GB+ RAM available for minikube

### Step 1: Configure Environment

```bash
cd grace-ai-backend

# Copy .env.example to .env
cp .env.example .env

# Edit .env and set required variables
nano .env
```

**Required variables for local development:**
```bash
# Environment
NODE_ENV=local
PRODUCTION_DOMAIN=c4dhi.moserfelix.com  # Only used in production

# Database
POSTGRES_DB=session_management
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password

# API Keys
OPENAI_API_KEY=your_openai_key
ELEVENLABS_API_KEY=your_elevenlabs_key  # Optional
```

### Step 2: Deploy Locally

```bash
# Ensure you're in local mode
./scripts/switch-env.sh local

# Start all services
./scripts/start-k8s.sh
```

**What happens:**
1. ✅ Starts minikube cluster
2. ✅ Builds Docker images
3. ✅ Deploys Kubernetes manifests
4. ✅ Creates port-forwards to localhost
5. ✅ Shows access URLs

### Step 3: Access Services

Once deployed, access your services at:

- **Frontend**: http://localhost:8080
- **Backend**: http://localhost:3000
- **LiveKit**: ws://localhost:7880
- **Database**: localhost:5432

### Step 4: Development Workflow

```bash
# View logs
kubectl logs -f -n ai-agents deployment/frontend-ui
kubectl logs -f -n ai-agents deployment/session-management-server

# Rebuild and redeploy after code changes
./scripts/start-k8s.sh

# Stop all services
./scripts/start-k8s.sh --stop
```

## Production Deployment

### Prerequisites
- Server with public IP
- Domain with DNS configured (*.c4dhi.moserfelix.com)
- nginx installed
- SSL certificates (Let's Encrypt)
- kubectl configured to access your Kubernetes cluster

### Step 1: Configure Environment

```bash
cd grace-ai-backend

# Edit .env
nano .env
```

**Set production variables:**
```bash
# IMPORTANT: Set environment to production
NODE_ENV=production

# Your production domain (change this for your domain)
PRODUCTION_DOMAIN=c4dhi.moserfelix.com

# Rest of the configuration (database, API keys, etc.)
# ... same as local development ...
```

### Step 2: Configure DNS

Ensure DNS A records point to your server IP:

```
frontend.c4dhi.moserfelix.com  →  YOUR_SERVER_IP
backend.c4dhi.moserfelix.com   →  YOUR_SERVER_IP
livekit.c4dhi.moserfelix.com   →  YOUR_SERVER_IP
db.c4dhi.moserfelix.com        →  YOUR_SERVER_IP
```

### Step 3: Verify Nginx Configuration

**Good news: Your existing nginx configuration works as-is!**

No changes needed if your nginx is configured for:
- Frontend: `proxy_pass http://127.0.0.1:8080;`
- Backend: `proxy_pass http://127.0.0.1:3000;`
- LiveKit: `proxy_pass http://127.0.0.1:7880;`

**Optional enhancement** for better WebSocket reliability (see [NGINX_SETUP.md](./NGINX_SETUP.md)):
```nginx
# Add to LiveKit server block
proxy_connect_timeout 7d;
proxy_send_timeout 7d;
proxy_read_timeout 7d;
```

### Step 4: Obtain SSL Certificates

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificates for all subdomains
sudo certbot --nginx -d frontend.c4dhi.moserfelix.com \
                      -d backend.c4dhi.moserfelix.com \
                      -d livekit.c4dhi.moserfelix.com \
                      -d db.c4dhi.moserfelix.com
```

### Step 5: Deploy to Production

```bash
# Switch to production mode
./scripts/switch-env.sh production

# Deploy with production configuration in daemon mode
./scripts/start-k8s.sh --daemon
```

**What happens:**
1. ✅ Detects production mode from NODE_ENV
2. ✅ Sets environment-specific URLs (https://, wss://)
3. ✅ Builds Docker images
4. ✅ Deploys Kubernetes manifests
5. ✅ **Creates port-forwards** on localhost (8080, 3000, 7880, 5432)
6. ✅ Runs in background, survives SSH logout
7. ✅ Shows access URLs

### Step 6: Set Up Port-Forward Monitoring

For production reliability, set up automatic monitoring to restart port-forwards if they disconnect.

**Option A: Systemd Service (Recommended)**

```bash
# Edit the service file with your paths
nano scripts/systemd/grace-ai-port-forwards.service

# Replace YOUR_USERNAME and /path/to/grace-ai-backend

# Install the service
sudo cp scripts/systemd/grace-ai-port-forwards.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable grace-ai-port-forwards
sudo systemctl start grace-ai-port-forwards

# Check status
sudo systemctl status grace-ai-port-forwards

# View logs
sudo journalctl -u grace-ai-port-forwards -f
```

**Option B: Cron Job (Simple Alternative)**

```bash
# Edit crontab
crontab -e

# Add this line to check every minute
* * * * * /path/to/grace-ai-backend/scripts/monitor-port-forwards.sh --once >> /tmp/grace-ai-k8s/cron.log 2>&1
```

**Option C: Manual Monitoring (Development/Testing)**

```bash
# Run in a tmux or screen session
./scripts/monitor-port-forwards.sh
```

### Step 7: Verify Deployment

```bash
# Check port-forward status
./scripts/monitor-port-forwards.sh --status

# You should see:
#   ✓ frontend-ui:8080 (PID: xxxxx)
#   ✓ backend:3000 (PID: xxxxx)
#   ✓ livekit:7880 (PID: xxxxx)
#   ✓ postgres:5432 (PID: xxxxx)

# Test local connectivity
curl http://localhost:8080  # Frontend
curl http://localhost:3000/health  # Backend

# Test through nginx (external)
curl https://frontend.c4dhi.moserfelix.com
curl https://backend.c4dhi.moserfelix.com/health
```

### Step 8: Access Services

Your services are now accessible at:

- **Frontend**: https://frontend.c4dhi.moserfelix.com
- **Backend**: https://backend.c4dhi.moserfelix.com
- **LiveKit**: wss://livekit.c4dhi.moserfelix.com
- **Database**: db.c4dhi.moserfelix.com:5432

## Switching Environments

### Check Current Environment

```bash
./scripts/switch-env.sh
```

This shows your current environment configuration.

### Switch to Local

```bash
./scripts/switch-env.sh local
```

**What it does:**
- Updates `NODE_ENV=local` in `.env`
- Shows localhost URLs
- Reminds you to redeploy

**Then redeploy:**
```bash
./scripts/start-k8s.sh
```

### Switch to Production

```bash
./scripts/switch-env.sh production
```

**What it does:**
- Updates `NODE_ENV=production` in `.env`
- Shows custom domain URLs
- Warns about nginx configuration requirements

**Then redeploy:**
```bash
./scripts/start-k8s.sh
```

## Configuration Files Summary

### `.env`
Single source of truth for environment configuration:
- `NODE_ENV`: `local` or `production`
- `PRODUCTION_DOMAIN`: Your production domain
- Database credentials
- API keys

### `k8s/04-configmap.yaml`
Kubernetes ConfigMap with environment variable placeholders.
Variables are substituted at deployment time by `start-k8s.sh`.

### `k8s/production/`
NodePort service manifests for production:
- `01-postgres-nodeport.yaml` (port 30432)
- `02-livekit-nodeport.yaml` (port 30880)
- `03-frontend-nodeport.yaml` (port 30080)
- `04-backend-nodeport.yaml` (port 30000)

### `scripts/start-k8s.sh`
Main deployment script that:
- Detects environment from `NODE_ENV`
- Sets environment-specific URLs
- Deploys Kubernetes resources
- Creates port-forwards (local) or NodePorts (production)

### `frontend-ui/entrypoint.sh`
Runtime configuration injection for frontend:
- Reads environment variables from ConfigMap
- Injects into `config.js` at container startup
- Supports both localhost and production URLs

## Environment Variable Flow

```
.env file
    ↓
start-k8s.sh (reads and exports variables)
    ↓
envsubst (substitutes variables in ConfigMap)
    ↓
Kubernetes ConfigMap
    ↓
Pod environment variables
    ↓
Application runtime (frontend entrypoint, backend process)
```

## Key Design Decisions

### Why Single .env File?
- ✅ Single source of truth
- ✅ Easy to switch environments
- ✅ No duplicate configuration
- ✅ Clear what's different between environments

### Why envsubst Instead of Kustomize?
- ✅ Simpler to understand
- ✅ Works with existing scripts
- ✅ No additional tools required
- ✅ Variables visible in deployment script

### Why NodePort + Nginx Instead of LoadBalancer?
- ✅ Works with any Kubernetes setup
- ✅ nginx provides SSL termination
- ✅ nginx handles WebSocket configuration
- ✅ More control over routing and headers
- ✅ No cloud provider dependency

## Troubleshooting

### Issue: Port already in use (Local)

```bash
# Find process using port
lsof -ti:8080
lsof -ti:3000

# Kill process
kill -9 <PID>

# Or stop previous deployment
./scripts/start-k8s.sh --stop
```

### Issue: 502 Bad Gateway (Production)

**Check if NodePort services exist:**
```bash
kubectl get svc -n ai-agents | grep nodeport
```

**Check if pods are running:**
```bash
kubectl get pods -n ai-agents
```

**Check nginx can reach NodePorts:**
```bash
curl http://localhost:30080  # Should return frontend HTML
curl http://localhost:30000/health  # Should return {"status":"ok"}
```

### Issue: WebSocket connection fails

**Check nginx configuration includes:**
- `proxy_set_header Upgrade $http_upgrade;`
- `proxy_set_header Connection "upgrade";`
- Long timeout values (`proxy_connect_timeout 7d;`)

**Check nginx logs:**
```bash
sudo tail -f /var/log/nginx/error.log
```

### Issue: Database connection refused

**Verify PostgreSQL is configured for external connections:**
```bash
# Check PostgreSQL config
kubectl exec -it -n ai-agents deployment/postgres -- cat /etc/postgresql/postgresql.conf | grep listen_addresses
# Should show: listen_addresses = '*'

# Check pg_hba.conf
kubectl exec -it -n ai-agents deployment/postgres -- cat /var/lib/postgresql/data/pg_hba.conf
# Should have: host all all 0.0.0.0/0 md5
```

### Issue: Wrong environment variables in pods

**Check ConfigMap has correct values:**
```bash
kubectl get configmap grace-ai-config -n ai-agents -o yaml
```

**Restart deployments to reload ConfigMap:**
```bash
kubectl rollout restart deployment -n ai-agents
```

## Best Practices

### Local Development
- ✅ Use `--daemon` flag for persistent port-forwards: `./scripts/start-k8s.sh --daemon`
- ✅ Check logs frequently: `kubectl logs -f deployment/backend -n ai-agents`
- ✅ Keep minikube resource limits reasonable: 4 CPUs, 8GB RAM
- ✅ Use `.env.local` for local overrides (gitignored)

### Production
- ✅ Always test locally before deploying to production
- ✅ Use strong passwords for database
- ✅ Restrict database access with firewall rules
- ✅ Monitor nginx logs and Kubernetes pod logs
- ✅ Set up automatic SSL certificate renewal
- ✅ Back up database regularly
- ✅ Use secrets for sensitive data, not ConfigMaps

## Support

For detailed nginx setup instructions, see [NGINX_SETUP.md](./NGINX_SETUP.md).

For project architecture and technical details, see [../CLAUDE.md](../CLAUDE.md).
