# Reverse Proxy Deployment Guide

Complete guide for deploying the STELLA backend with Nginx reverse proxy, supporting both path-based and subdomain-based routing.

## Table of Contents

- [Overview](#overview)
- [Routing Options](#routing-options)
- [Path-Based Routing Setup](#path-based-routing-setup)
- [Subdomain-Based Routing Setup](#subdomain-based-routing-setup)
- [Backend Configuration](#backend-configuration)
- [Frontend Configuration](#frontend-configuration)
- [SSL/HTTPS Setup](#sslhttps-setup)
- [Testing & Verification](#testing--verification)
- [Troubleshooting](#troubleshooting)

---

## Overview

The STELLA backend supports flexible deployment modes:

- **Development**: Direct port access (e.g., `http://localhost:3000`)
- **Production**: Reverse proxy routing with Nginx

The backend automatically detects the environment (`NODE_ENV`) and configures routing appropriately:

| Mode | NODE_ENV | API Prefix | Example Routes |
|------|----------|------------|----------------|
| Development | `development` | None | `/projects`, `/sessions` |
| Production | `production` | None (disabled) | `/projects`, `/sessions` |

**Note**: API prefix is disabled by default (`API_PREFIX=""`). Reverse proxy can optionally add `/api` prefix for external URLs.

**Internal APIs** (for Python services) always remain at `/internal/*` regardless of mode.

---

## Routing Options

### Option 1: Path-Based Routing (Single Domain)

**Recommended for:**
- Single domain deployments
- Shared hosting environments
- Simplified SSL management

**URLs:**
```
Frontend:  https://yourdomain.com/
API:       https://yourdomain.com/projects (or /api/projects with rewrite)
LiveKit:   wss://yourdomain.com/livekit
Internal:  https://yourdomain.com/internal/
```

**Pros:**
- Single SSL certificate
- Single DNS A record
- Simpler DNS management

**Cons:**
- More complex Nginx configuration
- Potential path conflicts
- LiveKit WebSocket may have complications

### Option 2: Subdomain-Based Routing

**Recommended for:**
- Production environments
- Clean separation of concerns
- WebSocket stability

**URLs:**
```
Frontend:  https://yourdomain.com/
API:       https://api.yourdomain.com/
LiveKit:   wss://livekit.yourdomain.com
Internal:  https://internal.yourdomain.com/
```

**Pros:**
- Clean URL structure
- No path conflicts
- Better WebSocket support
- Easier to scale/separate services

**Cons:**
- Multiple DNS records required
- Wildcard SSL or multiple certificates
- Slightly more complex DNS setup

---

## Path-Based Routing Setup

### Step 1: DNS Configuration

Add single A record:

```
Type: A
Name: @  (or yourdomain)
Value: YOUR_SERVER_IP
```

Verify:
```bash
dig yourdomain.com
```

### Step 2: Nginx Configuration

Create `/etc/nginx/sites-available/yourdomain.com`:

```nginx
# HTTP - Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com;

    # Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS - Main Configuration
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Backend API
    # Backend routes are at root level: /auth/login, /projects, /sessions, etc.
    # Choose one of the options below:

    # OPTION 1: Direct proxy (no /api prefix in external URLs)
    # External URLs: https://yourdomain.com/projects
    location ~ ^/(auth|projects|sessions|agents|health|network-info) {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # OPTION 2: Add /api prefix for cleaner external URLs (commented out)
    # External URLs: https://yourdomain.com/api/projects → Internal: /projects
    # Uncomment this and comment out OPTION 1 if you prefer /api prefix externally
    # location /api/ {
    #     rewrite ^/api/(.*) /$1 break;
    #     proxy_pass http://127.0.0.1:3000;
    #     proxy_http_version 1.1;
    #     proxy_set_header Host $host;
    #     proxy_set_header X-Real-IP $remote_addr;
    #     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #     proxy_set_header X-Forwarded-Proto $scheme;
    #     proxy_connect_timeout 60s;
    #     proxy_send_timeout 60s;
    #     proxy_read_timeout 60s;
    # }

    # Internal APIs (Python services) - /internal/*
    location /internal/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # LiveKit WebSocket - /livekit
    location /livekit {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long timeout for WebSocket connections
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        proxy_buffering off;
    }

    # Frontend - Everything else
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable configuration:

```bash
sudo ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 3: Backend Configuration

Update `.env`:

```bash
# Server
NODE_ENV=production
PORT=3000

# API prefix (automatic in production)
# API_PREFIX=api

# CORS
CORS_ORIGIN=https://yourdomain.com

# Public URLs
PUBLIC_SERVER_URL=https://yourdomain.com/api
PUBLIC_LIVEKIT_URL=wss://yourdomain.com/livekit

# LiveKit (internal)
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

### Step 4: Frontend Configuration

Update `frontend-ui/.env.production`:

```bash
VITE_API_URL=https://yourdomain.com/api
VITE_LIVEKIT_URL=wss://yourdomain.com/livekit
VITE_LIVEKIT_API_KEY=devkey
VITE_LIVEKIT_API_SECRET=secret
```

---

## Subdomain-Based Routing Setup

### Step 1: DNS Configuration

Add multiple A records:

```
Type: A,  Name: @,       Value: YOUR_SERVER_IP
Type: A,  Name: api,     Value: YOUR_SERVER_IP
Type: A,  Name: livekit, Value: YOUR_SERVER_IP
```

Or use wildcard (if supported):

```
Type: A,  Name: *,       Value: YOUR_SERVER_IP
```

Verify:

```bash
dig yourdomain.com
dig api.yourdomain.com
dig livekit.yourdomain.com
```

### Step 2: Nginx Configuration

Create separate server blocks:

```nginx
# Frontend - yourdomain.com
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# API - api.yourdomain.com
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# LiveKit - livekit.yourdomain.com
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name livekit.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_buffering off;
    }
}
```

### Step 3: Backend Configuration

Update `.env`:

```bash
# Server
NODE_ENV=development  # No API prefix needed
PORT=3000

# CORS
CORS_ORIGIN=https://yourdomain.com,https://api.yourdomain.com

# Public URLs
PUBLIC_SERVER_URL=https://api.yourdomain.com
PUBLIC_LIVEKIT_URL=wss://livekit.yourdomain.com
```

### Step 4: Frontend Configuration

Update `frontend-ui/.env.production`:

```bash
VITE_API_URL=https://api.yourdomain.com
VITE_LIVEKIT_URL=wss://livekit.yourdomain.com
VITE_LIVEKIT_API_KEY=devkey
VITE_LIVEKIT_API_SECRET=secret
```

---

## Backend Configuration

### Smart Defaults

The backend automatically configures based on `NODE_ENV`:

| NODE_ENV | API Prefix | CORS | Behavior |
|----------|------------|------|----------|
| `development` | None | `*` | Routes at `/`, all origins |
| `production` | None (disabled) | Specific domain | Routes at `/`, restricted CORS |

**Note**: `API_PREFIX=""` is set in ConfigMap to disable prefix in all environments.

### Manual Override

Force specific configuration:

```bash
# Always use /api prefix
API_PREFIX=api
NODE_ENV=development

# Disable prefix in production
API_PREFIX=
NODE_ENV=production

# Custom prefix
API_PREFIX=v1
```

### Internal Routes

Internal APIs always stay at `/internal/*`:

- `/internal/active-sessions` - Python message recorder
- `/internal/sessions/:id/messages` - Message storage
- `/internal/monitoring/*` - Monitoring endpoints

These are used by Python services and should not be publicly exposed.

---

## Frontend Configuration

### Runtime Configuration

The frontend uses a flexible runtime configuration system that supports:

1. Nginx-injected variables (`window.__ENV__`)
2. Config file (`/config.js`)
3. Build-time environment variables (`VITE_*`)
4. Auto-detection

### Build for Production

```bash
cd frontend-ui

# Build with environment variables
npm run build

# Or create .env.production first
cat > .env.production << EOF
VITE_API_URL=https://yourdomain.com/api
VITE_LIVEKIT_URL=wss://yourdomain.com/livekit
VITE_LIVEKIT_API_KEY=devkey
VITE_LIVEKIT_API_SECRET=secret
EOF

npm run build
```

### Serve with PM2

```bash
npm install -g serve pm2

# Serve on port 8080
pm2 start "serve -s dist -l 8080" --name "stella-frontend"
pm2 save
```

---

## SSL/HTTPS Setup

### Let's Encrypt with Certbot

```bash
# Install certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx -y

# Create webroot directory
sudo mkdir -p /var/www/certbot

# Get certificate (single domain)
sudo certbot certonly --webroot -w /var/www/certbot \
  -d yourdomain.com \
  --email your-email@example.com \
  --agree-tos

# Get certificate (with subdomains)
sudo certbot certonly --webroot -w /var/www/certbot \
  -d yourdomain.com \
  -d api.yourdomain.com \
  -d livekit.yourdomain.com \
  --email your-email@example.com \
  --agree-tos

# Or use wildcard (requires DNS challenge)
sudo certbot certonly --dns-cloudflare \
  -d "*.yourdomain.com" \
  -d yourdomain.com \
  --email your-email@example.com \
  --agree-tos
```

### Auto-renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Check auto-renewal timer
sudo systemctl status certbot.timer
```

---

## Testing & Verification

### Local Service Tests

```bash
# Backend
curl http://localhost:3000/health

# Frontend
curl http://localhost:8080

# LiveKit
curl http://localhost:7880
```

### Public HTTPS Tests

```bash
# Frontend
curl -I https://yourdomain.com

# API (direct routes)
curl -I https://yourdomain.com/projects

# API (with /api prefix via nginx rewrite - optional)
curl -I https://yourdomain.com/api/projects

# API (subdomain)
curl -I https://api.yourdomain.com/projects

# LiveKit WebSocket (will return 400 but proves connectivity)
curl -I https://yourdomain.com/livekit
```

### Browser Tests

1. Open `https://yourdomain.com`
2. Check SSL padlock icon
3. Open DevTools → Network tab
4. Verify API calls go to correct URL
5. Check WebSocket connection to LiveKit

### Logs

```bash
# Nginx access log
sudo tail -f /var/log/nginx/access.log

# Nginx error log
sudo tail -f /var/log/nginx/error.log

# Backend logs
pm2 logs stella-backend

# Frontend logs
pm2 logs stella-frontend
```

---

## Troubleshooting

### 502 Bad Gateway

**Cause**: Backend not running or wrong port

**Solution**:
```bash
# Check backend is running
pm2 status
curl http://localhost:3000/health

# Restart backend
pm2 restart stella-backend
```

### CORS Errors

**Cause**: CORS_ORIGIN not configured correctly

**Solution**:
```bash
# Check backend .env
cat .env | grep CORS_ORIGIN

# Should be:
CORS_ORIGIN=https://yourdomain.com

# Restart backend
pm2 restart stella-backend
```

### 404 Not Found (API routes)

**Cause**: API prefix mismatch

**Solution**:
```bash
# Check NODE_ENV
echo $NODE_ENV

# Check logs for API prefix
pm2 logs stella-backend | grep "API prefix"

# Should show:
# 🔧 API prefix enabled: /api

# If not, check .env:
NODE_ENV=production
```

### WebSocket Connection Failed

**Cause**: Nginx WebSocket configuration or LiveKit not running

**Solution**:
```bash
# Check LiveKit is running
curl http://localhost:7880

# Check Nginx config has Upgrade headers
sudo nginx -T | grep -A 10 "location /livekit"

# Should have:
# proxy_set_header Upgrade $http_upgrade;
# proxy_set_header Connection "upgrade";

# Restart Nginx
sudo systemctl reload nginx
```

### SSL Certificate Errors

**Cause**: Certificate not properly installed or expired

**Solution**:
```bash
# Check certificate
sudo certbot certificates

# Check certificate files exist
sudo ls -la /etc/letsencrypt/live/yourdomain.com/

# Renew if needed
sudo certbot renew

# Reload Nginx
sudo systemctl reload nginx
```

### Internal API 404 Errors

**Cause**: Python services calling incorrect internal routes

**Solution**:
```bash
# Check Python service is updated
grep "api/internal" message-recorder-python/*.py

# Should use /internal (not /api/internal)
# Update Python service and restart
```

---

## Production Checklist

- [ ] DNS records configured and verified
- [ ] SSL certificates installed and auto-renewing
- [ ] Backend `.env` configured for production
- [ ] Frontend built with production URLs
- [ ] Nginx configuration tested
- [ ] Firewall allows ports 80, 443
- [ ] Services running with PM2
- [ ] PM2 configured to start on boot
- [ ] CORS configured for specific domain
- [ ] Internal APIs not publicly accessible
- [ ] Monitoring and logging configured
- [ ] Backup strategy in place

---

## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [LiveKit Documentation](https://docs.livekit.io/)
