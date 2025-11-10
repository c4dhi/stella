# Nginx Configuration for Production Deployment

This guide explains how to use nginx with Grace AI in production. **Good news: Your existing nginx configuration works as-is!**

## Overview - Recommended Approach

The **recommended approach** uses `kubectl port-forward` with your existing nginx configuration:

```
Internet → nginx (443) → localhost:8080/3000/7880 → kubectl port-forward → K8s Service → Pod
```

**No nginx configuration changes required!** Your current setup pointing to `localhost:8080`, `localhost:3000`, and `localhost:7880` works perfectly.

## Alternative: NodePort Approach

If you prefer to use NodePort services (more complex but doesn't require port-forwards), see the [NodePort Configuration](#nodeport-configuration-alternative) section at the bottom.

---

## Recommended Setup: Port-Forward with Existing Nginx

### Your Current Nginx Configuration

Your existing nginx configuration is **perfect** and requires **no changes**:

```nginx
# Frontend - https://frontend.c4dhi.moserfelix.com
server {
    server_name frontend.c4dhi.moserfelix.com;
    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:8080;  # ✓ Keep as-is
    }
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/privkey.pem;
    # ... rest of SSL config ...
}

# Backend - https://backend.c4dhi.moserfelix.com
server {
    server_name backend.c4dhi.moserfelix.com;
    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:3000;  # ✓ Keep as-is
    }
    listen 443 ssl;
    # ... SSL config ...
}

# LiveKit - wss://livekit.c4dhi.moserfelix.com
server {
    server_name livekit.c4dhi.moserfelix.com;
    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:7880;  # ✓ Keep as-is
    }
    listen 443 ssl;
    # ... SSL config ...
}
```

### Optional: Add WebSocket Timeouts

For better WebSocket reliability with LiveKit, you can **optionally** add timeout configuration:

```nginx
server {
    server_name livekit.c4dhi.moserfelix.com;
    location / {
        # ... existing config ...

        # Optional: Long-lived connection timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

This is recommended but not required. The default timeouts usually work fine.

### Deployment Steps

**1. Deploy Kubernetes Services:**

```bash
cd grace-ai-backend

# Switch to production mode
./scripts/switch-env.sh production

# Deploy in daemon mode (creates persistent port-forwards)
./scripts/start-k8s.sh --daemon
```

**2. Verify Port-Forwards:**

```bash
# Check status
./scripts/monitor-port-forwards.sh --status

# You should see:
#   ✓ frontend-ui:8080 (PID: xxxxx)
#   ✓ backend:3000 (PID: xxxxx)
#   ✓ livekit:7880 (PID: xxxxx)
#   ✓ postgres:5432 (PID: xxxxx)
```

**3. Test Services:**

```bash
# Test locally first
curl http://localhost:8080  # Frontend
curl http://localhost:3000/health  # Backend

# Test through nginx
curl https://frontend.c4dhi.moserfelix.com
curl https://backend.c4dhi.moserfelix.com/health
```

**4. Set Up Automatic Port-Forward Management:**

**Option A: Using Systemd Service (Recommended for Production)**

```bash
# Edit the service file with your paths
nano scripts/systemd/grace-ai-port-forwards.service

# Replace:
# - YOUR_USERNAME with your actual username
# - /path/to/grace-ai-backend with actual path

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

**Option B: Using Cron (Simple Alternative)**

```bash
# Add to crontab to check every minute
crontab -e

# Add this line:
* * * * * /path/to/grace-ai-backend/scripts/monitor-port-forwards.sh --once >> /tmp/grace-ai-k8s/cron.log 2>&1
```

**Option C: Manual Monitoring**

```bash
# Run in a separate tmux/screen session
./scripts/monitor-port-forwards.sh
```

### Management Commands

```bash
# Check port-forward status
./scripts/monitor-port-forwards.sh --status

# Force restart all port-forwards
./scripts/monitor-port-forwards.sh --restart

# Run single check (for cron)
./scripts/monitor-port-forwards.sh --once

# View monitor logs
tail -f /tmp/grace-ai-k8s/monitor.log

# If using systemd
sudo systemctl status grace-ai-port-forwards
sudo systemctl restart grace-ai-port-forwards
sudo journalctl -u grace-ai-port-forwards -f
```

### Why This Approach?

✅ **Pros:**
- No nginx configuration changes needed
- Simple to understand and debug
- Works with your existing setup immediately
- Easy to monitor and restart
- Proven approach (what you're using now)

⚠️ **Cons:**
- Requires monitoring script running
- Port-forwards can occasionally disconnect (automatically restarted by monitor)
- One additional process to manage

### Troubleshooting

**Port-forwards died:**
```bash
# Check status
./scripts/monitor-port-forwards.sh --status

# Restart manually
./scripts/monitor-port-forwards.sh --restart

# Or let the monitor do it automatically
./scripts/monitor-port-forwards.sh  # Runs in monitoring loop
```

**502 Bad Gateway from nginx:**
```bash
# Check if port-forwards are running
./scripts/monitor-port-forwards.sh --status

# Test local connectivity
curl http://localhost:8080
curl http://localhost:3000/health

# Check Kubernetes pods
kubectl get pods -n ai-agents
```

**After server restart:**
```bash
# If using systemd - automatic restart
sudo systemctl start grace-ai-port-forwards

# If not using systemd - manual restart
cd grace-ai-backend
./scripts/start-k8s.sh --daemon
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Nginx Reverse Proxy (Host)                   │
│                  *.c4dhi.moserfelix.com (SSL:443)              │
│                           ↓                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ frontend → 127.0.0.1:30080 (NodePort)                    │  │
│  │ backend  → 127.0.0.1:30000 (NodePort)                    │  │
│  │ livekit  → 127.0.0.1:30880 (NodePort)                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Kubernetes Cluster (minikube/k3s)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  NodePort Services                                       │  │
│  │  • frontend-ui:      NodePort 30080 → Pod 8080         │  │
│  │  • backend:          NodePort 30000 → Pod 3000         │  │
│  │  • livekit:          NodePort 30880 → Pod 7880         │  │
│  │  • postgres:         NodePort 30432 → Pod 5432         │  │
│  │                                                          │  │
│  │  ClusterIP Services (internal)                          │  │
│  │  • postgres:5432 (backend ← → postgres)                 │  │
│  │  • livekit:7880  (backend ← → livekit)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Required Changes to Your Existing Configuration

### 1. Update Proxy Pass Ports

Change the `proxy_pass` directives to point to NodePort services:

**Before:**
```nginx
proxy_pass http://127.0.0.1:8080;  # Frontend
proxy_pass http://127.0.0.1:3000;  # Backend
proxy_pass http://127.0.0.1:7880;  # LiveKit
```

**After:**
```nginx
proxy_pass http://127.0.0.1:30080;  # Frontend (NodePort)
proxy_pass http://127.0.0.1:30000;  # Backend (NodePort)
proxy_pass http://127.0.0.1:30880;  # LiveKit (NodePort)
```

### 2. Add WebSocket Timeout Configuration

Add long-lived connection timeouts for LiveKit WebSocket connections:

```nginx
server {
    server_name livekit.c4dhi.moserfelix.com;

    location / {
        # ... existing proxy settings ...

        # Add these timeout settings for WebSocket connections
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

## Complete Updated Nginx Configuration

Here's your complete updated configuration file:

```nginx
# ============================================================================
# Grace AI - Production Nginx Configuration
# ============================================================================
# This configuration proxies HTTPS/WSS traffic to Kubernetes NodePort services
#
# Domain: c4dhi.moserfelix.com
# Services:
#   - frontend.c4dhi.moserfelix.com  → NodePort 30080 → Frontend UI
#   - backend.c4dhi.moserfelix.com   → NodePort 30000 → Backend API
#   - livekit.c4dhi.moserfelix.com   → NodePort 30880 → LiveKit Server
#   - db.c4dhi.moserfelix.com        → NodePort 30432 → PostgreSQL
# ============================================================================

# Frontend - https://frontend.c4dhi.moserfelix.com
server {
    server_name frontend.c4dhi.moserfelix.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Proxy to Kubernetes NodePort
        proxy_pass http://127.0.0.1:30080;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# Backend API - https://backend.c4dhi.moserfelix.com
server {
    server_name backend.c4dhi.moserfelix.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Proxy to Kubernetes NodePort
        proxy_pass http://127.0.0.1:30000;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# LiveKit WebSocket - wss://livekit.c4dhi.moserfelix.com
server {
    server_name livekit.c4dhi.moserfelix.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Long-lived connection timeouts for WebSocket
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;

        # Proxy to Kubernetes NodePort
        proxy_pass http://127.0.0.1:30880;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/frontend.c4dhi.moserfelix.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# HTTP to HTTPS redirects
server {
    if ($host = frontend.c4dhi.moserfelix.com) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name frontend.c4dhi.moserfelix.com;
    return 404;
}

server {
    if ($host = backend.c4dhi.moserfelix.com) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name backend.c4dhi.moserfelix.com;
    return 404;
}

server {
    if ($host = livekit.c4dhi.moserfelix.com) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name livekit.c4dhi.moserfelix.com;
    return 404;
}

# Database hostname (for Let's Encrypt validation only)
# PostgreSQL accessed directly via NodePort 30432 (no SSL proxy)
server {
    listen 80;
    server_name db.c4dhi.moserfelix.com;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    return 204;
}
```

## Database Access Configuration

### Option 1: Direct NodePort Access (Recommended for Development)

Connect directly to the NodePort without nginx proxying:

```bash
# From external machine
psql -h your-server-ip -p 30432 -U postgres -d session_management

# From localhost
psql -h localhost -p 30432 -U postgres -d session_management
```

**Connection String:**
```
postgresql://postgres:password@your-server-ip:30432/session_management
```

### Option 2: TCP Stream Proxy (If port 5432 is required)

If you need to expose PostgreSQL on standard port 5432, add a TCP stream proxy:

**Add to `/etc/nginx/nginx.conf`** (at the top level, outside `http {}` block):

```nginx
stream {
    server {
        listen 5432;
        proxy_pass 127.0.0.1:30432;
        proxy_timeout 600s;
        proxy_connect_timeout 10s;
    }
}
```

Then connect using:
```bash
psql -h db.c4dhi.moserfelix.com -p 5432 -U postgres -d session_management
```

## Deployment Steps

### 1. Update Nginx Configuration

```bash
# Backup existing configuration
sudo cp /etc/nginx/sites-available/grace-ai /etc/nginx/sites-available/grace-ai.backup

# Edit configuration
sudo nano /etc/nginx/sites-available/grace-ai

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 2. Deploy Kubernetes Services in Production Mode

```bash
# Switch to production environment
cd /path/to/grace-ai-backend
./scripts/switch-env.sh production

# Deploy services with NodePorts
./scripts/start-k8s.sh
```

### 3. Verify NodePort Services

```bash
# Check that NodePort services are running
kubectl get svc -n ai-agents

# You should see:
# frontend-ui-nodeport              NodePort   10.x.x.x   <none>   8080:30080/TCP
# session-management-server-nodeport NodePort   10.x.x.x   <none>   3000:30000/TCP
# livekit-nodeport                   NodePort   10.x.x.x   <none>   7880:30880/TCP
# postgres-nodeport                  NodePort   10.x.x.x   <none>   5432:30432/TCP
```

### 4. Test Connectivity

```bash
# Test each service locally first
curl http://localhost:30080  # Frontend
curl http://localhost:30000/health  # Backend
curl http://localhost:30880  # LiveKit

# Test through nginx
curl https://frontend.c4dhi.moserfelix.com
curl https://backend.c4dhi.moserfelix.com/health
```

### 5. Verify WebSocket Connection

Open browser console and navigate to `https://frontend.c4dhi.moserfelix.com`:

```javascript
// Check WebSocket connection in browser console
const ws = new WebSocket('wss://livekit.c4dhi.moserfelix.com');
ws.onopen = () => console.log('Connected!');
ws.onerror = (err) => console.error('Error:', err);
```

## Troubleshooting

### Issue: 502 Bad Gateway

**Cause:** Kubernetes NodePort service not accessible

**Solution:**
```bash
# Check if minikube is running
minikube status

# Check if pods are running
kubectl get pods -n ai-agents

# Verify NodePort services exist
kubectl get svc -n ai-agents | grep nodeport
```

### Issue: WebSocket Connection Fails

**Cause:** Missing timeout configuration or WebSocket headers

**Solution:**
- Verify `proxy_connect_timeout`, `proxy_send_timeout`, `proxy_read_timeout` are set
- Verify `Upgrade` and `Connection` headers are set
- Check nginx error logs: `sudo tail -f /var/log/nginx/error.log`

### Issue: Database Connection Timeout

**Cause:** PostgreSQL not configured for external connections

**Solution:**
```bash
# Verify PostgreSQL is listening
kubectl exec -it -n ai-agents postgres-xxxxx -- psql -U postgres -c "SHOW listen_addresses;"

# Should show: listen_addresses = *

# Check if pg_hba.conf allows external connections
kubectl exec -it -n ai-agents postgres-xxxxx -- cat /var/lib/postgresql/data/pg_hba.conf
```

### Issue: SSL Certificate Errors

**Cause:** Certificate doesn't cover all subdomains

**Solution:**
```bash
# Verify certificate covers all domains
sudo certbot certificates

# If needed, add new subdomains
sudo certbot certonly --nginx -d frontend.c4dhi.moserfelix.com -d backend.c4dhi.moserfelix.com -d livekit.c4dhi.moserfelix.com -d db.c4dhi.moserfelix.com
```

## Security Considerations

### Firewall Configuration

```bash
# Allow HTTPS traffic
sudo ufw allow 443/tcp

# Allow HTTP (for Let's Encrypt)
sudo ufw allow 80/tcp

# Optionally allow NodePorts (if accessing from outside)
# Only do this if you need direct NodePort access from external IPs
# sudo ufw allow 30000:30900/tcp
```

### Database Security

**Important:** In production, restrict PostgreSQL access:

1. **Option 1:** Keep PostgreSQL NodePort internal-only:
   ```yaml
   # In k8s/production/01-postgres-nodeport.yaml
   spec:
     type: ClusterIP  # Change from NodePort
   ```

2. **Option 2:** Restrict access with firewall rules:
   ```bash
   # Only allow from specific IPs
   sudo ufw allow from YOUR_IP to any port 30432
   ```

3. **Update pg_hba.conf** to restrict connections:
   ```
   # Only allow from specific IP ranges
   host    all    all    YOUR_IP/32    md5
   ```

## Monitoring

### Check Nginx Access Logs

```bash
# Watch access logs
sudo tail -f /var/log/nginx/access.log

# Watch error logs
sudo tail -f /var/log/nginx/error.log
```

### Check Kubernetes Pod Logs

```bash
# Frontend logs
kubectl logs -f -n ai-agents deployment/frontend-ui

# Backend logs
kubectl logs -f -n ai-agents deployment/session-management-server

# LiveKit logs
kubectl logs -f -n ai-agents deployment/livekit
```

## Summary

### Recommended Approach (Port-Forward)

✅ **No nginx changes needed!**
- Your existing nginx configuration works perfectly
- Deploy with: `./scripts/start-k8s.sh --daemon`
- Set up monitoring: systemd service or cron job
- Ports: localhost:8080, localhost:3000, localhost:7880, localhost:5432

✅ **Access URLs:**
- Frontend: https://frontend.c4dhi.moserfelix.com
- Backend: https://backend.c4dhi.moserfelix.com
- LiveKit: wss://livekit.c4dhi.moserfelix.com
- Database: db.c4dhi.moserfelix.com:5432 (via port-forward)

✅ **Management:**
- Status: `./scripts/monitor-port-forwards.sh --status`
- Restart: `./scripts/monitor-port-forwards.sh --restart`
- Logs: `tail -f /tmp/grace-ai-k8s/monitor.log`

---

### NodePort Alternative (Advanced)

If you prefer NodePort services (see [NodePort Configuration](#nodeport-configuration-alternative)):
1. Update `proxy_pass` to use NodePort ports (30080, 30000, 30880)
2. Add WebSocket timeout configuration for LiveKit
3. Deploy Kubernetes NodePort services
4. Verify all services are accessible through nginx

---

✅ **Internal Communication (Both Approaches):**
- Backend connects to PostgreSQL via: `postgres:5432` (ClusterIP)
- Backend connects to LiveKit via: `livekit:7880` (ClusterIP)
- Frontend (browser) connects to LiveKit via: `wss://livekit.c4dhi.moserfelix.com`

---

# NodePort Configuration (Alternative)

This section describes the alternative NodePort approach. **Most users should use the simpler port-forward approach above.**

## When to Use NodePort

Consider NodePort if you:
- Want to avoid running port-forward monitoring
- Prefer a more "production-like" architecture
- Don't mind updating nginx configuration

## Required Nginx Configuration Changes

### 1. Update Proxy Pass Ports

Change the `proxy_pass` directives to point to NodePort services:

```nginx
# Frontend
server {
    server_name frontend.c4dhi.moserfelix.com;
    location / {
        # ... existing config ...
        proxy_pass http://127.0.0.1:30080;  # Changed from 8080
    }
}

# Backend
server {
    server_name backend.c4dhi.moserfelix.com;
    location / {
        # ... existing config ...
        proxy_pass http://127.0.0.1:30000;  # Changed from 3000
    }
}

# LiveKit
server {
    server_name livekit.c4dhi.moserfelix.com;
    location / {
        # ... existing config ...
        proxy_pass http://127.0.0.1:30880;  # Changed from 7880

        # Add WebSocket timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

### 2. Apply Configuration

```bash
# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## Deployment for NodePort

```bash
cd grace-ai-backend

# Switch to production
./scripts/switch-env.sh production

# Deploy (NodePort services will be created automatically)
./scripts/start-k8s.sh

# DO NOT use --daemon flag with NodePort approach
# Port-forwards are not needed
```

## Verification

```bash
# Check NodePort services exist
kubectl get svc -n ai-agents | grep nodeport

# Should show:
# frontend-ui-nodeport              NodePort   ...   8080:30080/TCP
# session-management-server-nodeport NodePort   ...   3000:30000/TCP
# livekit-nodeport                   NodePort   ...   7880:30880/TCP
# postgres-nodeport                  NodePort   ...   5432:30432/TCP

# Test NodePort connectivity locally
curl http://localhost:30080  # Frontend
curl http://localhost:30000/health  # Backend

# Test through nginx
curl https://frontend.c4dhi.moserfelix.com
curl https://backend.c4dhi.moserfelix.com/health
```

## NodePort Service Files

The NodePort services are automatically deployed from `k8s/production/` when `NODE_ENV=production`:

- `01-postgres-nodeport.yaml` - PostgreSQL on port 30432
- `02-livekit-nodeport.yaml` - LiveKit on port 30880
- `03-frontend-nodeport.yaml` - Frontend on port 30080
- `04-backend-nodeport.yaml` - Backend on port 30000

## Comparison: Port-Forward vs NodePort

| Aspect | Port-Forward (Recommended) | NodePort (Alternative) |
|--------|---------------------------|------------------------|
| **Nginx Changes** | None required | Must update ports |
| **Monitoring** | Requires monitoring script | Not needed |
| **Reliability** | Needs restart on disconnect | Always available |
| **Setup Complexity** | Simple | Moderate |
| **Port Range** | Standard (8080, 3000, etc.) | K8s NodePort (30000+) |
| **Best For** | Quick setup, existing config | "Production" architecture |

Both approaches are production-ready. Choose based on your preference for simplicity (port-forward) vs. architecture (NodePort).
