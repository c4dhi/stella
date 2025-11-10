# Configuration Implementation Summary

## What Was Done

I've implemented a comprehensive configuration strategy that allows you to easily manage both local development and production deployments using a single codebase and simple environment switching.

## Key Features

### ✅ Single `.env` File Configuration
- One `.env` file controls everything
- Switch between environments by changing `NODE_ENV=local` or `NODE_ENV=production`
- Configurable production domain via `PRODUCTION_DOMAIN` variable

### ✅ Automatic Environment Detection
- Scripts automatically detect the environment from `.env`
- URLs and configurations are set appropriately for each environment
- No manual URL updates needed

### ✅ Production-Ready Infrastructure
- NodePort services for nginx integration
- PostgreSQL configured for external access
- Frontend runtime configuration injection
- SSL-ready with WebSocket support

## Files Created/Modified

### New Files Created

1. **`k8s/01-postgres-config.yaml`**
   - PostgreSQL configuration for external access
   - Enables connections from outside the cluster

2. **`k8s/production/01-postgres-nodeport.yaml`**
   - NodePort service for PostgreSQL (port 30432)

3. **`k8s/production/02-livekit-nodeport.yaml`**
   - NodePort service for LiveKit (port 30880)

4. **`k8s/production/03-frontend-nodeport.yaml`**
   - NodePort service for Frontend (port 30080)

5. **`k8s/production/04-backend-nodeport.yaml`**
   - NodePort service for Backend (port 30000)

6. **`scripts/switch-env.sh`**
   - Utility to switch between local and production modes
   - Shows current configuration
   - Updates NODE_ENV in `.env`

7. **`docs/NGINX_SETUP.md`**
   - Complete nginx configuration guide
   - Troubleshooting steps
   - Security best practices

8. **`docs/DEPLOYMENT_GUIDE.md`**
   - Step-by-step deployment instructions
   - Architecture diagrams
   - Troubleshooting guide

### Modified Files

1. **`.env`**
   - Added `NODE_ENV` variable (local/production)
   - Added `PRODUCTION_DOMAIN` variable
   - Added environment-specific URL variables

2. **`.env.example`**
   - Updated with comprehensive documentation
   - Shows all configuration options
   - Explains local vs production settings

3. **`k8s/04-configmap.yaml`**
   - Uses environment variable placeholders
   - Supports both local and production URLs
   - Includes public database access configuration

4. **`k8s/01-postgres.yaml`**
   - Mounts PostgreSQL configuration from ConfigMap
   - Enables external connections
   - Configures host-based authentication

5. **`scripts/start-k8s.sh`**
   - Detects environment from NODE_ENV
   - Sets environment-specific URLs
   - Uses `envsubst` for variable substitution
   - Deploys NodePort services in production mode
   - Only creates port-forwards in local mode

6. **`frontend-ui/entrypoint.sh`**
   - Enhanced logging for environment detection
   - Shows which mode it's running in
   - Clarifies that frontend connects directly to LiveKit

## How to Use

### For Local Development

1. **Configure environment:**
   ```bash
   cd grace-ai-backend
   cp .env.example .env
   nano .env  # Set your API keys and passwords
   ```

2. **Ensure local mode:**
   ```bash
   ./scripts/switch-env.sh local
   ```

3. **Deploy:**
   ```bash
   ./scripts/start-k8s.sh
   ```

4. **Access services:**
   - Frontend: http://localhost:8080
   - Backend: http://localhost:3000
   - LiveKit: ws://localhost:7880
   - Database: localhost:5432

### For Production Deployment

**Good news: Your existing nginx configuration works as-is!**

1. **Verify nginx configuration (no changes needed!):**
   - Your nginx should already proxy to `localhost:8080`, `localhost:3000`, `localhost:7880`
   - Optionally add WebSocket timeouts (see `docs/NGINX_SETUP.md`)

2. **Switch to production mode:**
   ```bash
   ./scripts/switch-env.sh production
   ```

3. **Deploy with daemon mode:**
   ```bash
   ./scripts/start-k8s.sh --daemon
   ```

4. **Set up monitoring (for reliability):**
   ```bash
   # Option A: Systemd service (recommended)
   sudo cp scripts/systemd/grace-ai-port-forwards.service /etc/systemd/system/
   # Edit with your paths, then:
   sudo systemctl enable grace-ai-port-forwards
   sudo systemctl start grace-ai-port-forwards

   # Option B: Cron job (simple)
   crontab -e
   # Add: * * * * * /path/to/grace-ai-backend/scripts/monitor-port-forwards.sh --once
   ```

5. **Access services:**
   - Frontend: https://frontend.c4dhi.moserfelix.com
   - Backend: https://backend.c4dhi.moserfelix.com
   - LiveKit: wss://livekit.c4dhi.moserfelix.com
   - Database: db.c4dhi.moserfelix.com:5432

### Switching Between Environments

```bash
# Check current environment
./scripts/switch-env.sh

# Switch to local
./scripts/switch-env.sh local
./scripts/start-k8s.sh

# Switch to production
./scripts/switch-env.sh production
./scripts/start-k8s.sh
```

## Environment Variable Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. .env file                                                │
│    NODE_ENV=production                                      │
│    PRODUCTION_DOMAIN=c4dhi.moserfelix.com                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. start-k8s.sh reads .env                                  │
│    Detects NODE_ENV=production                              │
│    Sets PUBLIC_FRONTEND_URL=https://frontend.DOMAIN        │
│    Sets PUBLIC_API_URL=https://backend.DOMAIN              │
│    Sets PUBLIC_LIVEKIT_URL=wss://livekit.DOMAIN            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. envsubst replaces variables in ConfigMap                │
│    ${PUBLIC_FRONTEND_URL} → https://frontend.DOMAIN        │
│    ${PUBLIC_API_URL} → https://backend.DOMAIN              │
│    ${PUBLIC_LIVEKIT_URL} → wss://livekit.DOMAIN            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Kubernetes ConfigMap applied                             │
│    Contains environment-specific URLs                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Pods receive environment variables                       │
│    Backend uses PUBLIC_API_URL                              │
│    Frontend entrypoint receives VITE_LIVEKIT_URL           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Frontend runtime injection                               │
│    entrypoint.sh generates config.js                        │
│    Browser uses wss://livekit.DOMAIN                        │
└─────────────────────────────────────────────────────────────┘
```

## Architecture Highlights

### Local Development
- **Port-forwards**: kubectl creates tunnels from localhost to K8s services
- **Services**: ClusterIP (internal only)
- **Access**: Direct from localhost (no nginx)

### Production
- **NodePort services**: Expose on fixed ports (30000-30900 range)
- **Nginx reverse proxy**: Terminates SSL, proxies to NodePorts
- **Services**: NodePort for external + ClusterIP for internal
- **Access**: Through nginx with SSL

### Key Differences

| Aspect | Local | Production |
|--------|-------|------------|
| **Frontend URL** | http://localhost:8080 | https://frontend.DOMAIN |
| **Backend URL** | http://localhost:3000 | https://backend.DOMAIN |
| **LiveKit URL** | ws://localhost:7880 | wss://livekit.DOMAIN |
| **Database** | localhost:5432 | db.DOMAIN:5432 |
| **SSL** | No | Yes (nginx) |
| **Port Forwards** | Yes | No |
| **NodePort Services** | No | Yes |

## Internal vs External Communication

### Internal (Service-to-Service)
Always uses Kubernetes service names (same in both environments):
- Backend → PostgreSQL: `postgres:5432`
- Backend → LiveKit: `livekit:7880`

### External (Browser → Services)
Environment-specific:
- **Local**: `localhost:PORT` (via port-forward)
- **Production**: `https://subdomain.DOMAIN` (via nginx)

### Frontend → LiveKit
**Important**: The frontend (browser) connects **directly** to LiveKit via WebSocket:
- **Local**: Browser → `ws://localhost:7880` → port-forward → LiveKit pod
- **Production**: Browser → `wss://livekit.DOMAIN` → nginx → NodePort 30880 → LiveKit pod

This is required for WebRTC to work properly.

## Nginx Configuration Required Changes

Your existing nginx configuration needs these updates:

### 1. Update Proxy Pass Ports
```nginx
# Before
proxy_pass http://127.0.0.1:8080;
proxy_pass http://127.0.0.1:3000;
proxy_pass http://127.0.0.1:7880;

# After (NodePort)
proxy_pass http://127.0.0.1:30080;
proxy_pass http://127.0.0.1:30000;
proxy_pass http://127.0.0.1:30880;
```

### 2. Add WebSocket Timeouts for LiveKit
```nginx
server {
    server_name livekit.c4dhi.moserfelix.com;

    location / {
        # ... existing config ...

        # Add these timeout settings
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

Full configuration details in `docs/NGINX_SETUP.md`.

## Quick Reference Commands

```bash
# Switch environment
./scripts/switch-env.sh local|production

# Deploy
./scripts/start-k8s.sh

# Deploy in background (survives SSH logout)
./scripts/start-k8s.sh --daemon

# Stop background deployment
./scripts/start-k8s.sh --stop

# Check current environment
./scripts/switch-env.sh

# Port-forward management
./scripts/monitor-port-forwards.sh --status   # Check status
./scripts/monitor-port-forwards.sh --restart  # Force restart
./scripts/monitor-port-forwards.sh --once     # Single check (for cron)
./scripts/monitor-port-forwards.sh            # Monitor continuously

# View logs
kubectl logs -f -n ai-agents deployment/frontend-ui
kubectl logs -f -n ai-agents deployment/session-management-server
tail -f /tmp/grace-ai-k8s/monitor.log  # Port-forward monitor logs

# Check services
kubectl get svc -n ai-agents
kubectl get pods -n ai-agents

# Test connectivity (local)
curl http://localhost:8080
curl http://localhost:3000/health

# Test connectivity (production)
curl https://frontend.c4dhi.moserfelix.com
curl https://backend.c4dhi.moserfelix.com/health

# Systemd service management (if using systemd)
sudo systemctl status grace-ai-port-forwards
sudo systemctl restart grace-ai-port-forwards
sudo journalctl -u grace-ai-port-forwards -f
```

## Next Steps

1. **For Local Development:**
   ```bash
   ./scripts/switch-env.sh local
   ./scripts/start-k8s.sh
   ```
   Then access at http://localhost:8080

2. **For Production:**
   - Read `docs/NGINX_SETUP.md` carefully
   - Update nginx configuration
   - Obtain SSL certificates
   - Configure DNS records
   - Run:
     ```bash
     ./scripts/switch-env.sh production
     ./scripts/start-k8s.sh
     ```

3. **Testing:**
   - Test local deployment first
   - Verify all services work
   - Then deploy to production
   - Test each service through nginx

## Documentation

- **`docs/DEPLOYMENT_GUIDE.md`**: Complete deployment instructions with architecture diagrams
- **`docs/NGINX_SETUP.md`**: Detailed nginx configuration and troubleshooting
- **`CLAUDE.md`**: Project architecture and technical overview

## Support

If you encounter issues:

1. Check the troubleshooting sections in the documentation
2. Verify environment variables: `kubectl get configmap grace-ai-config -n ai-agents -o yaml`
3. Check pod logs: `kubectl logs -f deployment/[service-name] -n ai-agents`
4. Check nginx logs: `sudo tail -f /var/log/nginx/error.log`

---

**Summary**: You now have a flexible configuration system that supports both local development and production deployments with a single codebase. Simply change `NODE_ENV` in `.env` and run `./scripts/start-k8s.sh` to deploy to either environment.
