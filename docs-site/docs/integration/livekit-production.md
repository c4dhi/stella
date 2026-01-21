---
sidebar_position: 2
title: "LiveKit Production"
---

# LiveKit Production Setup

Guide for configuring LiveKit for production with WebRTC and TURN support.

## Overview

For production deployments, LiveKit needs additional configuration to work reliably across different network conditions:

- **UDP Multiplexing** (ports 7882-7892) for efficient RTC connections
- **TURN over TLS** (port 443) for maximum compatibility through firewalls
- **WebSocket signaling** (port 7880) via nginx

## Why TURN on Port 443?

- Port 443 (HTTPS) is allowed through **all firewalls**
- Mobile carrier firewalls block random UDP ports
- Corporate firewalls allow only HTTP/HTTPS ](../443)
- TURN over TLS on 443 works everywhere

## Firewall Configuration

Open the required ports:

```bash
# TURN ports
sudo ufw allow 30443/tcp   # TURN over TLS
sudo ufw allow 30444/udp   # TURN over UDP

# UDP multiplexing range
sudo ufw allow 30882:30892/udp

# Verify
sudo ufw status
```

## Nginx Configuration

### Add TURN Endpoint

Update your LiveKit nginx server block:

```nginx
server {
    server_name livekit.yourdomain.com;

    # Existing WebSocket location (port 7880)
    location / {
        proxy_pass http://127.0.0.1:30880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # TURN over TLS endpoint
    location /turn {
        proxy_pass http://127.0.0.1:30443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/livekit.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livekit.yourdomain.com/privkey.pem;
}
```

### Apply Configuration

```bash
sudo ln -sf /etc/nginx/sites-available/livekit /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Connection Flow

```
1. Frontend → Backend /livekit/token (HTTPS)
   └── Get LiveKit access token

2. Frontend → LiveKit wss://livekit.yourdomain.com (via nginx)
   └── WebSocket signaling connection

3. Frontend ↔ LiveKit Direct UDP (30882-30892)
   └── Media streams (if network allows)

4. Frontend → LiveKit TURN/TLS (port 443 via nginx)
   └── Fallback for networks blocking UDP
```

## Verification

### Check Ports are Open

```bash
# From production server
sudo netstat -tulnp | grep -E "(30443|30444|30882|30892)"
```

### Test Nginx Proxy

```bash
# Test WebSocket signaling
curl -I https://livekit.yourdomain.com

# Test TURN endpoint (should return 400, not 404)
curl -I https://livekit.yourdomain.com/turn
```

### Test from Client

After deployment:

1. Open browser to your frontend
2. Open DevTools Console (F12)
3. Start a session
4. Look for:
   ```
   ✓ [TOKEN] Successfully obtained token from backend
   🔗 Chat connecting to LiveKit room
   [LiveKit] Connected to room
   [RTC] Using TURN server: livekit.yourdomain.com:443
   ```

## LiveKit Cloud vs Self-Hosted

### LiveKit Cloud (Recommended)

If using [LiveKit Cloud](https://livekit.io/cloud):

- TURN is handled automatically
- No firewall configuration needed
- Just configure your API keys

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

### Self-Hosted LiveKit

For self-hosted deployments, configure TURN in your LiveKit config:

```yaml
turn:
  enabled: true
  domain: livekit.yourdomain.com
  tls_port: 443
  udp_port: 443

rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: false
  node_ip: livekit.yourdomain.com
```

## Troubleshooting

### "could not establish pc connection"

**Symptoms:**
- WebSocket connects (token fetch works)
- WebRTC peer connection fails

**Solution:**
Check firewall ports:

```bash
sudo ufw status | grep -E "(30443|30444|3088[0-9]|3089[0-9])"
```

### Works on WiFi but Not Mobile Data

**Symptoms:**
- Connects fine on WiFi
- Fails on cellular/4G/5G

**Solution:**
Mobile carriers require TURN. Verify:
1. Nginx TURN proxy is configured
2. Ports 30443/30444 are open
3. LiveKit config has TURN enabled

### Nginx Returns 502 Bad Gateway

**Solution:**
Check if LiveKit pod is running:

```bash
kubectl get pods -n ai-agents -l app=livekit
kubectl logs -n ai-agents -l app=livekit --tail=50
```

### "could not resolve external IP"

**Symptoms:**
- LiveKit pod keeps restarting
- Logs show: `could not resolve external IP: context deadline exceeded`

**Solution:**
Use `node_ip` instead of `use_external_ip: true` in LiveKit config:

```yaml
rtc:
  use_external_ip: false
  node_ip: livekit.yourdomain.com
```

### "one of key-file or keys must be provided"

**Symptoms:**
- LiveKit pod crashes immediately

**Solution:**
Ensure your LiveKit config includes API keys:

```yaml
keys:
  your-api-key: your-api-secret
```

## Monitoring

Check LiveKit logs for TURN usage:

```bash
kubectl logs -n ai-agents -l app=livekit -f | grep -i turn
```

Expected logs:

```
[INFO] TURN allocation created for peer X
[INFO] Using TURN relay for connection
[INFO] TURN session established: candidate-type=relay
```

## Summary

### Minimal Required Changes

1. **Firewall**: Open `30443/tcp`, `30444/udp`, `30882-30892/udp`
2. **Nginx**: Add `/turn` location proxy to port 30443
3. **Deploy**: `./scripts/start-k8s.sh --production`

### Result

- 99%+ connection success rate
- Works on mobile cellular networks
- Works behind corporate firewalls
- Supports unlimited rooms

## See Also

- [LiveKit Integration](/docs/integration/livekit)
- [Nginx Setup](/docs/deployment/nginx-setup)
- [Production Deployment](/docs/deployment/production)
