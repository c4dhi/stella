---
sidebar_position: 3
title: "🌐 Nginx Setup"
---

# 🌐 Nginx Configuration

Guide for configuring Nginx as a reverse proxy for STELLA in production.

## Recommended Approach

The recommended approach uses `kubectl port-forward` with Nginx:

```
Internet → nginx (443) → localhost:8080/3000/7880 → kubectl port-forward → K8s Service → Pod
```

This approach requires **no nginx configuration changes** if you're already forwarding to localhost ports.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Nginx Reverse Proxy (Host)                   │
│                  *.yourdomain.com (SSL:443)                     │
│                           ↓                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ frontend → 127.0.0.1:8080                                │  │
│  │ backend  → 127.0.0.1:3000                                │  │
│  │ livekit  → 127.0.0.1:7880                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Kubernetes Cluster                                  │
│  kubectl port-forward → Services → Pods                         │
└─────────────────────────────────────────────────────────────────┘
```

## Basic Nginx Configuration

### Frontend

```nginx
server {
    server_name frontend.yourdomain.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:8080;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
}
```

### Backend API

```nginx
server {
    server_name backend.yourdomain.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:3000;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
}
```

### LiveKit WebSocket

```nginx
server {
    server_name livekit.yourdomain.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Long-lived connection timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;

        proxy_pass http://127.0.0.1:7880;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
}
```

### HTTP to HTTPS Redirect

```nginx
server {
    listen 80;
    server_name frontend.yourdomain.com backend.yourdomain.com livekit.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

## Complete Configuration Example

```nginx
# ============================================================================
# STELLA - Production Nginx Configuration
# ============================================================================

# Frontend
server {
    server_name frontend.yourdomain.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support for hot reload in development
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;

        proxy_pass http://127.0.0.1:8080;
    }

    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# Backend API
server {
    server_name backend.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        proxy_pass http://127.0.0.1:3000;
    }

    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# LiveKit WebSocket
server {
    server_name livekit.yourdomain.com;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Long-lived WebSocket connections
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        proxy_buffering off;

        proxy_pass http://127.0.0.1:7880;
    }

    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# HTTP to HTTPS redirects
server {
    listen 80;
    server_name frontend.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 80;
    server_name backend.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 80;
    server_name livekit.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

## SSL Certificates with Let's Encrypt

### Install Certbot

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

### Obtain Certificates

```bash
sudo certbot certonly --nginx \
  -d frontend.yourdomain.com \
  -d backend.yourdomain.com \
  -d livekit.yourdomain.com \
  --email your-email@example.com \
  --agree-tos
```

### Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Check timer
sudo systemctl status certbot.timer
```

## Deployment Steps

### 1. Update Nginx Configuration

```bash
# Create configuration
sudo nano /etc/nginx/sites-available/stella

# Enable site
sudo ln -s /etc/nginx/sites-available/stella /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 2. Start STELLA in Daemon Mode

```bash
./scripts/start-k8s.sh --production --daemon
```

### 3. Verify Port-Forwards

```bash
./scripts/monitor-port-forwards.sh --status
```

### 4. Test Connectivity

```bash
# Test locally
curl http://localhost:8080   # Frontend
curl http://localhost:3000/health  # Backend

# Test through nginx
curl https://frontend.yourdomain.com
curl https://backend.yourdomain.com/health
```

## Automatic Port-Forward Management

### Using Systemd

Create `/etc/systemd/system/stella-port-forwards.service`:

```ini
[Unit]
Description=STELLA Port Forwards
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/stella-backend
ExecStart=/path/to/stella-backend/scripts/monitor-port-forwards.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable stella-port-forwards
sudo systemctl start stella-port-forwards
```

### Using Cron

```bash
crontab -e

# Add:
* * * * * /path/to/stella-backend/scripts/monitor-port-forwards.sh --once >> /tmp/stella-ai-k8s/cron.log 2>&1
```

## Troubleshooting

### 502 Bad Gateway

```bash
# Check port-forwards
./scripts/monitor-port-forwards.sh --status

# Test local connectivity
curl http://localhost:8080
curl http://localhost:3000/health

# Check Kubernetes pods
kubectl get pods -n ai-agents
```

### WebSocket Connection Fails

Verify WebSocket headers and timeouts:

```bash
sudo nginx -T | grep -A 10 "location / {"
```

### Port-Forwards Died

```bash
# Restart manually
./scripts/monitor-port-forwards.sh --restart

# Or use systemd
sudo systemctl restart stella-port-forwards
```

## See Also

- [Reverse Proxy](/docs/deployment/reverse-proxy)
- [Production Deployment](/docs/deployment/production)
- [LiveKit Production](/docs/integration/livekit-production)
