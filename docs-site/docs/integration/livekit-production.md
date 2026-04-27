---
sidebar_position: 2
title: "LiveKit Production"
---

# LiveKit Production Setup

Guide for configuring LiveKit for production with WebRTC and TURN support.

:::info
STELLA uses Caddy (not nginx) as its reverse proxy. The LiveKit stack is managed via the [STELLA_livekit](https://github.com/c4dhi/STELLA_livekit) repository, which includes Caddy, LiveKit, and Redis in a single Docker Compose setup.
:::

## Overview

For production deployments, LiveKit needs additional configuration to work reliably across different network conditions:

- **UDP Multiplexing** (ports 50000-60000) for efficient RTC connections
- **TURN over TLS** (port 5349) for maximum compatibility through firewalls
- **WebSocket signaling** (port 7880) via Caddy reverse proxy

## Why TURN on Port 443?

- Port 443 (HTTPS) is allowed through **all firewalls**
- Mobile carrier firewalls block random UDP ports
- Corporate firewalls allow only HTTP/HTTPS
- TURN over TLS on 443 works everywhere

## Firewall Configuration

Open the required ports:

```bash
# LiveKit WebRTC signaling
sudo ufw allow 7881/tcp

# TURN
sudo ufw allow 3478/udp

# WebRTC media range
sudo ufw allow 50000:60000/udp

# Verify
sudo ufw status
```

## Connection Flow

```
1. Frontend → Backend /livekit/token (HTTPS)
   └── Get LiveKit access token

2. Frontend → LiveKit wss://livekit.yourdomain.com (via Caddy TLS)
   └── WebSocket signaling connection

3. Frontend ↔ LiveKit Direct UDP (50000-60000)
   └── Media streams (if network allows)

4. Frontend → LiveKit TURN/TLS (port 443 via Caddy)
   └── Fallback for networks blocking UDP
```

## Verification

### Check Ports are Open

```bash
# From production server
sudo ss -tulnp | grep -E "(7880|7881|5349|3478)"
```

### Test Connectivity

```bash
# Test WebSocket signaling
curl -I https://livekit.yourdomain.com

# Test TURN endpoint (should return 400, not 404)
curl -I https://livekit-turn.yourdomain.com
```

### Test from Client

After deployment:

1. Open browser to your frontend
2. Open DevTools Console (F12)
3. Start a session
4. Look for:
   ```
   [TOKEN] Successfully obtained token from backend
   [LiveKit] Connected to room
   [RTC] Using TURN server: livekit-turn.yourdomain.com:443
   ```

## LiveKit Cloud vs Self-Hosted

### LiveKit Cloud (Recommended for simplicity)

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

For self-hosted deployments, configure TURN in your `livekit.yaml`:

```yaml
port: 7880
bind_addresses:
  - ""
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
  enable_loopback_candidate: false
redis:
  address: localhost:6379
turn:
  enabled: true
  domain: livekit-turn.yourdomain.com
  tls_port: 5349
  udp_port: 3478
  external_tls: true
keys:
  YOUR_API_KEY: YOUR_API_SECRET
```

## Troubleshooting

### "could not establish pc connection"

**Symptoms:**
- WebSocket connects (token fetch works)
- WebRTC peer connection fails

**Solution:**
Check firewall ports:

```bash
sudo ufw status | grep -E "(7881|3478|5000[0-9]|6000[0-9])"
```

### Works on WiFi but Not Mobile Data

**Symptoms:**
- Connects fine on WiFi
- Fails on cellular/4G/5G

**Solution:**
Mobile carriers require TURN. Verify:
1. TURN is enabled in `livekit.yaml`
2. Caddy routes `livekit-turn.yourdomain.com` to port 5349
3. DNS record for `livekit-turn.yourdomain.com` exists

### Caddy Returns 502 Bad Gateway

**Solution:**
Check if LiveKit is running:

```bash
docker ps | grep livekit
docker logs livekit-prod-livekit-1 --tail=50
```

### "could not resolve external IP"

**Symptoms:**
- LiveKit container keeps restarting
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
- LiveKit container crashes immediately

**Solution:**
Ensure your LiveKit config includes API keys:

```yaml
keys:
  your-api-key: your-api-secret
```

## Monitoring

Check LiveKit logs for TURN usage:

```bash
docker logs livekit-prod-livekit-1 -f 2>&1 | grep -i turn
```

Expected logs:

```
[INFO] TURN allocation created for peer X
[INFO] Using TURN relay for connection
[INFO] TURN session established: candidate-type=relay
```

## Summary

### Minimal Required Changes

1. **Firewall**: Open `7881/tcp`, `3478/udp`, `50000-60000/udp`
2. **Caddy**: Ensure `livekit-turn.yourdomain.com` route exists in `caddy.yaml`
3. **Deploy**: `docker compose -p livekit-prod up -d`

### Result

- 99%+ connection success rate
- Works on mobile cellular networks
- Works behind corporate firewalls
- Supports unlimited rooms

## See Also

- [LiveKit Integration](./livekit.md)
- [Production Deployment](../deployment/production.md)
