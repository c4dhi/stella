---
sidebar_position: 4
title: "🔀 Reverse Proxy"
---

# 🔀 Reverse Proxy Deployment

Complete guide for deploying STELLA with a reverse proxy, supporting both path-based and subdomain-based routing.

## Routing Options

### Option 1: Subdomain-Based Routing (Recommended)

Clean separation of services:

```
Frontend:  https://yourdomain.com/
API:       https://api.yourdomain.com/
LiveKit:   wss://livekit.yourdomain.com
```

**Pros:**
- Clean URL structure
- No path conflicts
- Better WebSocket support
- Easier to scale separately

**Cons:**
- Multiple DNS records required
- Wildcard SSL or multiple certificates

### Option 2: Path-Based Routing

All services on one domain:

```
Frontend:  https://yourdomain.com/
API:       https://yourdomain.com/api/
LiveKit:   wss://yourdomain.com/livekit
```

**Pros:**
- Single SSL certificate
- Single DNS record
- Simpler DNS management

**Cons:**
- More complex Nginx configuration
- Potential path conflicts
- WebSocket complications possible

## Subdomain-Based Setup

### DNS Configuration

Add A records:

```
Type: A,  Name: @,       Value: YOUR_SERVER_IP
Type: A,  Name: api,     Value: YOUR_SERVER_IP
Type: A,  Name: livekit, Value: YOUR_SERVER_IP
```

Or use wildcard:

```
Type: A,  Name: *,       Value: YOUR_SERVER_IP
```

### Nginx Configuration

```nginx
# Frontend - yourdomain.com
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# API - api.yourdomain.com
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# LiveKit - livekit.yourdomain.com
server {
    listen 443 ssl http2;
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

        # WebSocket timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

### Backend Configuration

```bash
# .env
NODE_ENV=production
PORT=3000

CORS_ORIGIN=https://yourdomain.com,https://api.yourdomain.com

PUBLIC_SERVER_URL=https://api.yourdomain.com
PUBLIC_LIVEKIT_URL=wss://livekit.yourdomain.com
```

### Frontend Configuration

```bash
# .env.production
VITE_API_URL=https://api.yourdomain.com
VITE_LIVEKIT_URL=wss://livekit.yourdomain.com
```

## Path-Based Setup

### DNS Configuration

Single A record:

```
Type: A,  Name: @,  Value: YOUR_SERVER_IP
```

### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # API routes
    location ~ ^/(auth|projects|sessions|agents|health) {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Internal APIs
    location /internal/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # LiveKit WebSocket
    location /livekit {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_buffering off;

        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # Frontend - Everything else
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Backend Configuration

```bash
# .env
NODE_ENV=production
PORT=3000

CORS_ORIGIN=https://yourdomain.com

PUBLIC_SERVER_URL=https://yourdomain.com
PUBLIC_LIVEKIT_URL=wss://yourdomain.com/livekit
```

### Frontend Configuration

```bash
# .env.production
VITE_API_URL=https://yourdomain.com
VITE_LIVEKIT_URL=wss://yourdomain.com/livekit
```

## SSL/HTTPS Setup

### Let's Encrypt with Certbot

```bash
# Install certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx -y

# Get certificate
sudo certbot certonly --nginx \
  -d yourdomain.com \
  -d api.yourdomain.com \
  -d livekit.yourdomain.com \
  --email your-email@example.com \
  --agree-tos

# Test auto-renewal
sudo certbot renew --dry-run
```

### Wildcard Certificate (DNS challenge)

```bash
sudo certbot certonly --dns-cloudflare \
  -d "*.yourdomain.com" \
  -d yourdomain.com \
  --email your-email@example.com \
  --agree-tos
```

## Testing & Verification

### Local Service Tests

```bash
curl http://localhost:3000/health   # Backend
curl http://localhost:8080          # Frontend
curl http://localhost:7880          # LiveKit
```

### Public HTTPS Tests

```bash
# Frontend
curl -I https://yourdomain.com

# API
curl -I https://api.yourdomain.com/health
# or
curl -I https://yourdomain.com/health

# LiveKit (returns 400 but proves connectivity)
curl -I https://livekit.yourdomain.com
```

### Browser Tests

1. Open `https://yourdomain.com`
2. Check SSL padlock icon
3. Open DevTools → Network tab
4. Verify API calls use correct URLs
5. Check WebSocket connection to LiveKit

## Troubleshooting

### 502 Bad Gateway

```bash
# Check backend is running
pm2 status
curl http://localhost:3000/health

# Restart if needed
pm2 restart stella-backend
```

### CORS Errors

```bash
# Check CORS_ORIGIN in backend .env
cat .env | grep CORS_ORIGIN

# Should match your domain exactly
CORS_ORIGIN=https://yourdomain.com
```

### 404 Not Found (API routes)

Check that API routes are configured in Nginx:

```bash
sudo nginx -T | grep "location"
```

### WebSocket Connection Failed

```bash
# Check LiveKit is running
curl http://localhost:7880

# Check Nginx has WebSocket headers
sudo nginx -T | grep -A 10 "livekit"
```

### SSL Certificate Errors

```bash
# Check certificate
sudo certbot certificates

# Renew if needed
sudo certbot renew

# Reload Nginx
sudo systemctl reload nginx
```

## See Also

- [Nginx Setup](/docs/deployment/nginx-setup)
- [Production Deployment](/docs/deployment/production)
- [LiveKit Production](/docs/integration/livekit-production)
