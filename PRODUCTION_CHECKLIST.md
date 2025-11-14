# Production Configuration Checklist

Run these commands on your **production server (130.60.9.82)** to verify all configurations are correct.

---

## 0. DNS Resolution

### Check DNS resolves to correct IP
```bash
dig +short livekit.c4dhi.moserfelix.com
```
**Expected**: `130.60.9.82`
**Purpose**: DNS A record resolves domain name to server's public IP address

### Check DNS from external perspective (optional)
```bash
nslookup livekit.c4dhi.moserfelix.com 8.8.8.8
```
**Expected**: Shows `Address: 130.60.9.82`
**Purpose**: Verifies DNS propagation using Google's public DNS server

---

## 1. Environment Variables

### Check NODE_ENV
```bash
kubectl get configmap grace-ai-config -n ai-agents -o yaml | grep NODE_ENV
```
**Expected**: `NODE_ENV: "production"`
**Purpose**: Tells the deployment script to use production settings (TURN enabled, ICE Lite, public IP)

---

## 2. LiveKit Configuration

### Check TURN is enabled
```bash
kubectl get configmap livekit-config -n ai-agents -o yaml | grep -A 10 "turn:"
```
**Expected**:
```yaml
turn:
  enabled: true  # ← Must be true!
  domain: livekit.c4dhi.moserfelix.com
  udp_port: 443
  external_tls: true
```
**Purpose**: TURN server provides NAT traversal fallback when direct UDP fails (critical for firewalls)

### Check ICE configuration
```bash
kubectl get configmap livekit-config -n ai-agents -o yaml | grep -A 5 "rtc:"
```
**Expected**:
```yaml
rtc:
  tcp_port: 7881
  udp_port: 7882-7892
  port_range_start: 7882
  port_range_end: 7892
```
**Purpose**: Defines which ports LiveKit uses internally for real-time media transmission

### Check node_ip is set to server IP
```bash
kubectl get configmap livekit-config -n ai-agents -o yaml | grep "node_ip:"
```
**Expected**: `node_ip: 130.60.9.82`
**Purpose**: Tells LiveKit what IP address to advertise to browser clients for ICE candidates

### Check ICE Lite is enabled
```bash
kubectl get configmap livekit-config -n ai-agents -o yaml | grep "use_ice_lite:"
```
**Expected**: `use_ice_lite: true`
**Purpose**: Optimizes ICE negotiation for server-as-host scenarios (faster connections)

### Check API keys are substituted (not placeholders)
```bash
kubectl get configmap livekit-config -n ai-agents -o yaml | grep -A 1 "keys:"
```
**Expected**: Should show actual key/secret values like `8470b875...: P3mxkB3F...`
**Should NOT show**: `${LIVEKIT_API_KEY}` or `devkey`
**Purpose**: Authentication keys that must match between frontend and backend for JWT token validation

---

## 3. Kubernetes Services

### Check NodePort service exists
```bash
kubectl get svc livekit-nodeport -n ai-agents -o yaml | grep -E "nodePort:|protocol:"
```
**Expected**:
```yaml
nodePort: 30880  # WebSocket signaling (TCP)
protocol: TCP
nodePort: 30881  # RTC TCP fallback
protocol: TCP
nodePort: 30882  # UDP media (first of 11 ports)
protocol: UDP
...
nodePort: 30892  # UDP media (last of 11 ports)
protocol: UDP
nodePort: 30444  # TURN server
protocol: UDP
```
**Purpose**: NodePort exposes internal pod ports to external traffic via host ports 30000-32767

### View complete NodePort service configuration
```bash
kubectl get svc livekit-nodeport -n ai-agents -o yaml
```
**Expected**: Should show all 14 port mappings (1 TCP signaling, 1 TCP fallback, 11 UDP media, 1 UDP TURN)
**Purpose**: Full service configuration including selectors, labels, and port mappings

### Check ClusterIP service exists
```bash
kubectl get svc livekit -n ai-agents -o wide
```
**Expected**: Shows `TYPE: ClusterIP`, `CLUSTER-IP: 10.X.X.X`, `SELECTOR: app=livekit`
**Purpose**: Internal cluster service that routes traffic to LiveKit pods

### Check all NodePorts are listening on host
```bash
sudo ss -tulnp | grep -E ":3088[0-9]|:3089[0-9]|:30444"
```
**Expected**: Should show ~14 lines with `0.0.0.0:3088X` and `0.0.0.0:3089X` and `0.0.0.0:30444`
**Purpose**: Verifies that Kubernetes has bound these ports on the host's network interface

### Check docker-proxy is forwarding ports
```bash
ps aux | grep docker-proxy | grep -E "3088|3089|30444" | head -5
```
**Expected**: Should show multiple `docker-proxy` processes with `-host-port=30880`, `-host-port=30882`, etc.
**Purpose**: Docker forwards NodePort traffic from host to Kubernetes pods

---

## 4. Kubernetes ConfigMaps and Secrets

### Check ConfigMap: livekit-config (full config)
```bash
kubectl get configmap livekit-config -n ai-agents -o yaml
```
**Expected**: Complete LiveKit configuration with substituted variables (no ${...} placeholders)
**Purpose**: ConfigMap mounted as /etc/livekit/config.yaml in LiveKit container

### Check ConfigMap: grace-ai-config
```bash
kubectl get configmap grace-ai-config -n ai-agents -o yaml | grep -E "NODE_ENV|PUBLIC_"
```
**Expected**: Shows `NODE_ENV: "production"` and production URLs
**Purpose**: Environment-specific configuration for all services

### Check Secret exists (without revealing values)
```bash
kubectl get secret grace-ai-secrets -n ai-agents -o jsonpath='{.data}' | jq 'keys'
```
**Expected**: List of keys: `["database-url", "elevenlabs-api-key", "jwt-secret", "livekit-api-key", "livekit-api-secret", ...]`
**Purpose**: Kubernetes Secret stores sensitive credentials injected as environment variables

---

## 5. LiveKit Pod Status

### Check LiveKit pod is running
```bash
kubectl get pods -n ai-agents -l app=livekit
```
**Expected**: `STATUS: Running`, `READY: 1/1`
**Purpose**: Verifies LiveKit container is healthy and accepting connections

### Check pod details and IP
```bash
kubectl get pods -n ai-agents -l app=livekit -o wide
```
**Expected**: Shows `STATUS: Running`, pod IP (172.17.X.X), node name
**Purpose**: Detailed pod information including internal IP and host node

### Check pod environment variables
```bash
kubectl exec -n ai-agents -l app=livekit -- env | grep -E "LIVEKIT|POD_IP"
```
**Expected**: Shows `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `POD_IP` values
**Purpose**: Verifies environment variables are injected correctly into container

### Check LiveKit startup logs for TURN
```bash
kubectl logs -n ai-agents -l app=livekit --tail=50 | grep -i turn
```
**Expected**: Should show `TURN server started` or similar confirmation
**Purpose**: Confirms TURN server initialized successfully for NAT traversal

### Check LiveKit is advertising correct IP
```bash
kubectl logs -n ai-agents -l app=livekit --tail=100 | grep -i "node_ip\|ice"
```
**Expected**: Should show `node_ip: 130.60.9.82` or `advertising candidates for 130.60.9.82`
**Purpose**: Verifies LiveKit is telling browser clients to connect to the correct public IP

### View LiveKit container configuration
```bash
kubectl get pod -n ai-agents -l app=livekit -o yaml | grep -A 20 "containers:" | head -30
```
**Expected**: Shows container image, ports, volumeMounts, args
**Purpose**: Verifies container is configured with correct image and startup arguments

---

## 6. Docker and Minikube

### Check Minikube status
```bash
minikube status
```
**Expected**: Shows `host: Running`, `kubelet: Running`, `apiserver: Running`
**Purpose**: Minikube cluster must be running for Kubernetes to work

### Check docker-proxy processes
```bash
ps aux | grep docker-proxy | grep -E "3088|3089|30444"
```
**Expected**: Should show ~14 docker-proxy processes with different port mappings
**Purpose**: Each NodePort has a docker-proxy process forwarding host→container traffic

### Check iptables NAT rules (advanced)
```bash
sudo iptables -t nat -L KUBE-NODEPORTS -n | grep -E "30880|30882|30444"
```
**Expected**: Shows DNAT rules redirecting NodePort traffic to ClusterIP
**Purpose**: iptables rules created by kube-proxy enable NodePort routing

---

## 7. Network Connectivity

### Check UDP ports are reachable from outside (run from your local machine)
```bash
nc -vzu 130.60.9.82 30882
nc -vzu 130.60.9.82 30444
```
**Expected**: `succeeded!` or `Connection to 130.60.9.82 30882 port [udp/*] succeeded!`
**Purpose**: Verifies firewall allows external UDP traffic to media and TURN ports

### Check WebSocket endpoint is accessible (run from your local machine)
```bash
curl -I https://livekit.c4dhi.moserfelix.com
```
**Expected**: `HTTP/2 200` or `HTTP/1.1 101 Switching Protocols`
**Purpose**: Verifies nginx is correctly proxying WebSocket signaling to LiveKit

### Check server network interface
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```
**Expected**: Should show `inet 130.60.9.82/XX` on one of the interfaces
**Purpose**: Verifies server's public IP is bound to a network interface

### Test local connectivity to NodePorts
```bash
curl -v http://127.0.0.1:30880 2>&1 | head -5
```
**Expected**: Should connect successfully (may show WebSocket upgrade response)
**Purpose**: Verifies NodePort is accessible from localhost

---

## 8. Firewall Rules

### Check UFW is active
```bash
sudo ufw status verbose
```
**Expected**: Shows `Status: active` and default policies
**Purpose**: UFW (Uncomplicated Firewall) controls incoming/outgoing traffic

### Check UFW allows LiveKit ports
```bash
sudo ufw status numbered | grep -E "30880|30881|30882|30444"
```
**Expected**: Should show rules allowing ports 30880-30892/tcp and 30882-30892/udp and 30444/udp
**Purpose**: Ubuntu firewall must permit external access to NodePort services

### View all UFW rules
```bash
sudo ufw status numbered
```
**Expected**: Shows all firewall rules with numbers
**Purpose**: Full firewall configuration overview

---

## 9. Nginx Configuration

### Check nginx is running
```bash
sudo systemctl status nginx | grep Active
```
**Expected**: Shows `Active: active (running)`
**Purpose**: Nginx reverse proxy must be running to handle HTTPS/WSS requests

### Check nginx is proxying to NodePort (not pod port)
```bash
grep -A 15 "server_name livekit.c4dhi.moserfelix.com" /etc/nginx/sites-available/c4dhi.moserfelix.com | grep proxy_pass
```
**Expected**: `proxy_pass http://127.0.0.1:30880;`
**Should NOT be**: `proxy_pass http://127.0.0.1:7880;`
**Purpose**: Nginx proxies WebSocket signaling from SSL frontend to NodePort backend

### View complete nginx LiveKit server block
```bash
grep -A 30 "server_name livekit.c4dhi.moserfelix.com" /etc/nginx/sites-available/c4dhi.moserfelix.com
```
**Expected**: Shows complete server block with SSL config, proxy settings, WebSocket headers
**Purpose**: Full nginx configuration for LiveKit reverse proxy

### Check nginx SSL certificate is valid
```bash
sudo certbot certificates | grep -A 5 "frontend.c4dhi.moserfelix.com"
```
**Expected**: Certificate is valid, not expired, domains include `livekit.c4dhi.moserfelix.com`
**Purpose**: SSL certificate enables wss:// connections required by browsers

### Test nginx SSL configuration
```bash
sudo nginx -t
```
**Expected**: `syntax is ok`, `test is successful`
**Purpose**: Validates nginx configuration has no syntax errors

### Check nginx error logs for recent issues
```bash
sudo tail -50 /var/log/nginx/error.log
```
**Expected**: No critical errors related to LiveKit proxying
**Purpose**: Nginx error log shows proxy failures, SSL issues, connection errors

---

## 10. Frontend Configuration

### Check frontend is using production URLs
```bash
kubectl exec -n ai-agents deployment/frontend-ui -- sh -c "cat /usr/share/nginx/html/config.js"
```
**Expected**:
```javascript
window.__ENV__ = {
  apiUrl: 'https://backend.c4dhi.moserfelix.com',
  livekitUrl: 'wss://livekit.c4dhi.moserfelix.com'
};
```
**Purpose**: Frontend must know to connect to production domain, not localhost

### Check frontend pod is running
```bash
kubectl get pods -n ai-agents -l app=frontend-ui
```
**Expected**: `STATUS: Running`, `READY: 1/1`
**Purpose**: Frontend container must be running to serve the application

### Check frontend nginx configuration
```bash
kubectl exec -n ai-agents deployment/frontend-ui -- sh -c "cat /etc/nginx/conf.d/default.conf" | grep -A 5 "location"
```
**Expected**: Shows nginx routes serving static files and config.js injection
**Purpose**: Frontend nginx serves React app and injects runtime configuration

---

## 11. Connection Test (from browser)

### Open browser console at frontend URL
1. Navigate to `https://frontend.c4dhi.moserfelix.com`
2. Click "Connect" button
3. Open Developer Console (F12) → Console tab

**Expected logs**:
```
✅ Connected to LiveKit room: voice-ai-room
✅ Published microphone track
✅ Connection state: connected
```

**Expected in Network tab** (F12 → Network → WS):
- WebSocket connection to `wss://livekit.c4dhi.moserfelix.com` with status `101 Switching Protocols`
- Messages flowing: `ping`, `pong`, `offer`, `answer`, `trickle`

**Purpose**: End-to-end verification that browser can establish WebRTC connection

### Test browser WebSocket connection (from local machine)
```bash
# Install wscat if needed: npm install -g wscat
wscat -c wss://livekit.c4dhi.moserfelix.com
```
**Expected**: Should connect successfully (may show `connected` message)
**Purpose**: Tests WebSocket connectivity through nginx SSL termination

---

## 12. LiveKit ICE Candidate Logs (Advanced Debugging)

### Check what ICE candidates LiveKit is advertising
```bash
kubectl logs -n ai-agents -l app=livekit --tail=200 | grep -i "candidate\|ice" | tail -20
```
**Expected**: Should see candidates with `130.60.9.82:30882-30892` (NodePort-mapped ports)
**Should NOT see**: `130.60.9.82:7882-7892` (internal pod ports)
**Purpose**: Verifies LiveKit is advertising externally-reachable addresses to browsers

### Check LiveKit connection debug logs
```bash
kubectl logs -n ai-agents -l app=livekit --tail=100 | grep -i "participant\|connection\|peer"
```
**Expected**: Should show participant join/leave events and connection state changes
**Purpose**: Tracks client connections and WebRTC peer connection establishment

---

## Complete Actor Configuration Summary

### Quick verification script
Run this comprehensive check to verify all actors:

```bash
#!/bin/bash
echo "=== DNS ==="
dig +short livekit.c4dhi.moserfelix.com

echo -e "\n=== Server IP ==="
ip addr show | grep "inet " | grep -v 127.0.0.1

echo -e "\n=== UFW Firewall ==="
sudo ufw status | grep -E "30880|30882|30444|ALLOW"

echo -e "\n=== Nginx ==="
sudo systemctl status nginx | grep Active
grep "proxy_pass" /etc/nginx/sites-available/c4dhi.moserfelix.com | grep livekit -A 2

echo -e "\n=== Minikube ==="
minikube status | grep -E "host|kubelet"

echo -e "\n=== NodePort Service ==="
kubectl get svc livekit-nodeport -n ai-agents | tail -1

echo -e "\n=== ClusterIP Service ==="
kubectl get svc livekit -n ai-agents | tail -1

echo -e "\n=== LiveKit Pod ==="
kubectl get pods -n ai-agents -l app=livekit

echo -e "\n=== NodePorts Listening ==="
sudo ss -tulnp | grep -c -E ":3088[0-9]|:30444"
echo "Expected: 14 ports"

echo -e "\n=== Docker Proxy Processes ==="
ps aux | grep -c "docker-proxy.*3088"
echo "Expected: ~14 processes"

echo -e "\n=== LiveKit Config (TURN) ==="
kubectl get configmap livekit-config -n ai-agents -o yaml | grep -A 3 "turn:"

echo -e "\n=== LiveKit Config (node_ip) ==="
kubectl get configmap livekit-config -n ai-agents -o yaml | grep "node_ip:"
```

Save this as `verify-all-actors.sh` and run: `chmod +x verify-all-actors.sh && ./verify-all-actors.sh`

---

## Quick Summary

**Critical checks** (must pass):
1. ✅ NODE_ENV=production
2. ✅ TURN enabled=true
3. ✅ node_ip=130.60.9.82
4. ✅ NodePort service exists with all 14+ ports
5. ✅ Ports listening on 0.0.0.0:30882-30892
6. ✅ UFW allows these ports
7. ✅ nginx proxy_pass uses :30880 (not :7880)
8. ✅ Frontend uses wss://livekit.c4dhi.moserfelix.com

**Current known issue**:
- LiveKit may be advertising internal ports (7882-7892) instead of NodePort-mapped ports (30882-30892)
- TURN server should work as fallback since port 30444 is correctly mapped

---

## Next Steps if Connection Still Fails

If after enabling TURN the connection still fails, we need to configure LiveKit to advertise the NodePort-mapped ports:

**Option A**: Add external port range to LiveKit config
```yaml
rtc:
  port_range_start: 7882
  port_range_end: 7892
  # ADD THESE:
  port_range_external_start: 30882
  port_range_external_end: 30892
```

**Option B**: Use LoadBalancer instead of NodePort (requires cloud provider)

**Option C**: Use host networking mode (not recommended for production)
