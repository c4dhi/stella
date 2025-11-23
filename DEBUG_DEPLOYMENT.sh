#!/bin/bash
# Comprehensive deployment debugging

echo "🔍 Grace AI Deployment Debug"
echo "========================================"
echo ""

export KUBECONFIG=~/.kube/config

echo "1️⃣  Kubernetes Cluster Status:"
echo "----------------------------------------"
if kubectl cluster-info &>/dev/null; then
    echo "✓ Cluster is running"
    kubectl cluster-info | head -2
else
    echo "✗ Cluster is NOT responding"
fi
echo ""

echo "2️⃣  All Pods Status:"
echo "----------------------------------------"
kubectl get pods -n ai-agents -o wide
echo ""

echo "3️⃣  Services Status:"
echo "----------------------------------------"
kubectl get svc -n ai-agents
echo ""

echo "4️⃣  Port Forwards Status:"
echo "----------------------------------------"
if [ -f /tmp/grace-ai-k8s/port-forwards.pid ]; then
    echo "Port-forward PIDs from file:"
    cat /tmp/grace-ai-k8s/port-forwards.pid
    echo ""
    echo "Checking if processes are alive:"
    while read pid; do
        if ps -p $pid > /dev/null 2>&1; then
            COMMAND=$(ps -p $pid -o command=)
            echo "  ✓ PID $pid: $COMMAND"
        else
            echo "  ✗ PID $pid: NOT RUNNING"
        fi
    done < /tmp/grace-ai-k8s/port-forwards.pid
else
    echo "✗ No port-forward PID file found"
fi
echo ""

echo "5️⃣  Port Listeners (should see 8080, 3000, 5432):"
echo "----------------------------------------"
if command -v ss &> /dev/null; then
    ss -tlnp | grep -E ":8080|:3000|:5432" | grep LISTEN
else
    netstat -tlnp 2>/dev/null | grep -E ":8080|:3000|:5432" | grep LISTEN
fi
echo ""

echo "6️⃣  Frontend Accessibility Test:"
echo "----------------------------------------"
echo "Testing localhost:8080 (should return HTML)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Frontend responds on localhost:8080 (HTTP $HTTP_CODE)"
    echo "  First 200 chars:"
    curl -s http://localhost:8080 2>/dev/null | head -c 200
    echo ""
else
    echo "✗ Frontend NOT responding on localhost:8080 (HTTP $HTTP_CODE)"
fi
echo ""

echo "7️⃣  Backend Accessibility Test:"
echo "----------------------------------------"
echo "Testing localhost:3000/health (should return OK)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Backend responds on localhost:3000 (HTTP $HTTP_CODE)"
    curl -s http://localhost:3000/health 2>/dev/null
else
    echo "✗ Backend NOT responding on localhost:3000 (HTTP $HTTP_CODE)"
fi
echo ""

echo "8️⃣  Caddy Reverse Proxy Status:"
echo "----------------------------------------"
if systemctl is-active --quiet caddy; then
    echo "✓ Caddy is running"
    echo ""
    echo "Caddy configuration check:"
    if [ -f /etc/caddy/Caddyfile ]; then
        echo "  ✓ /etc/caddy/Caddyfile exists"
        echo ""
        echo "  Frontend config:"
        grep -A 5 "frontend.c4dhi.moserfelix.com" /etc/caddy/Caddyfile 2>/dev/null || echo "  ✗ frontend config not found"
        echo ""
        echo "  Backend config:"
        grep -A 5 "backend.c4dhi.moserfelix.com" /etc/caddy/Caddyfile 2>/dev/null || echo "  ✗ backend config not found"
    else
        echo "  ✗ /etc/caddy/Caddyfile NOT found"
    fi
else
    echo "✗ Caddy is NOT running"
fi
echo ""

echo "9️⃣  Recent Pod Logs (errors only):"
echo "----------------------------------------"
echo "Frontend logs:"
kubectl logs -n ai-agents -l app=frontend-ui --tail=20 2>/dev/null | grep -i error || echo "  No errors"
echo ""
echo "Backend logs:"
kubectl logs -n ai-agents -l app=session-management-server --tail=20 2>/dev/null | grep -i error || echo "  No errors"
echo ""

echo "🔟  GPU Status:"
echo "----------------------------------------"
GPU_ALLOCATABLE=$(kubectl describe nodes 2>/dev/null | grep -A 10 "Allocatable:" | grep "nvidia.com/gpu")
if [ -n "$GPU_ALLOCATABLE" ]; then
    echo "✓ GPU visible to Kubernetes:"
    echo "$GPU_ALLOCATABLE"
else
    echo "✗ GPU NOT visible to Kubernetes"
fi
echo ""

echo "1️⃣1️⃣  Agent Pods (if any):"
echo "----------------------------------------"
AGENT_PODS=$(kubectl get pods -n ai-agents 2>/dev/null | grep agent | awk '{print $1}')
if [ -n "$AGENT_PODS" ]; then
    kubectl get pods -n ai-agents | grep agent
    echo ""
    echo "First agent pod status:"
    FIRST_AGENT=$(echo "$AGENT_PODS" | head -1)
    kubectl describe pod "$FIRST_AGENT" -n ai-agents 2>/dev/null | grep -A 10 "Events:"
else
    echo "No agent pods found (this is normal if no sessions created yet)"
fi
echo ""

echo "========================================"
echo "🔧 RECOMMENDED FIXES:"
echo "========================================"
echo ""

NEEDS_PORT_FORWARD_RESTART=false
NEEDS_CADDY_RESTART=false
NEEDS_POD_RESTART=false
NEEDS_GPU_FIX=false

# Check port forwards
if [ -f /tmp/grace-ai-k8s/port-forwards.pid ]; then
    while read pid; do
        if ! ps -p $pid > /dev/null 2>&1; then
            NEEDS_PORT_FORWARD_RESTART=true
        fi
    done < /tmp/grace-ai-k8s/port-forwards.pid
else
    NEEDS_PORT_FORWARD_RESTART=true
fi

# Check if localhost ports are responding
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080 2>/dev/null)
if [ "$HTTP_CODE" != "200" ]; then
    NEEDS_PORT_FORWARD_RESTART=true
fi

# Check Caddy
if ! systemctl is-active --quiet caddy; then
    NEEDS_CADDY_RESTART=true
fi

# Check GPU
if [ -z "$GPU_ALLOCATABLE" ]; then
    NEEDS_GPU_FIX=true
fi

if [ "$NEEDS_PORT_FORWARD_RESTART" = true ]; then
    echo "❌ PORT FORWARDS NOT WORKING"
    echo "   Fix: Restart port forwards"
    echo "   Commands:"
    echo "     # Kill existing port forwards"
    echo "     pkill -f 'kubectl port-forward'"
    echo ""
    echo "     # Restart them manually"
    echo "     kubectl port-forward -n ai-agents --address 127.0.0.1 svc/frontend-ui 8080:8080 > /dev/null 2>&1 &"
    echo "     kubectl port-forward -n ai-agents --address 127.0.0.1 svc/session-management-server 3000:3000 > /dev/null 2>&1 &"
    echo "     kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 5432:5432 > /dev/null 2>&1 &"
    echo ""
    echo "   OR re-run deployment:"
    echo "     ./scripts/start-k8s.sh --stop && ./scripts/start-k8s.sh --production --daemon"
    echo ""
fi

if [ "$NEEDS_CADDY_RESTART" = true ]; then
    echo "❌ CADDY NOT RUNNING"
    echo "   Fix: Start Caddy"
    echo "   Commands:"
    echo "     sudo systemctl start caddy"
    echo "     sudo systemctl status caddy"
    echo ""
fi

if [ "$NEEDS_GPU_FIX" = true ]; then
    echo "❌ GPU NOT VISIBLE TO KUBERNETES"
    echo "   Fix: Configure Docker and restart K3s"
    echo "   Commands:"
    echo "     sudo nvidia-ctk runtime configure --runtime=docker"
    echo "     sudo systemctl restart docker"
    echo "     sudo systemctl restart k3s"
    echo "     sleep 10"
    echo "     kubectl describe nodes | grep nvidia"
    echo ""
fi

if [ "$NEEDS_PORT_FORWARD_RESTART" = false ] && [ "$NEEDS_CADDY_RESTART" = false ] && [ "$NEEDS_GPU_FIX" = false ]; then
    echo "✅ EVERYTHING LOOKS GOOD!"
    echo ""
    echo "If you still can't access services:"
    echo "  1. Check firewall: sudo ufw status"
    echo "  2. Check DNS: nslookup frontend.c4dhi.moserfelix.com"
    echo "  3. Check Caddy logs: sudo journalctl -u caddy -n 50"
fi
