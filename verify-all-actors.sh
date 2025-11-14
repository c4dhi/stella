#!/bin/bash
# Production Server - All Actors Verification Script
# Run this on your production server (130.60.9.82) to verify complete configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Grace AI - Production Configuration Verification${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# 0. DNS
echo -e "${GREEN}[0] DNS Resolution${NC}"
echo -n "  livekit.c4dhi.moserfelix.com → "
DNS_IP=$(dig +short livekit.c4dhi.moserfelix.com | head -1)
if [ "$DNS_IP" = "130.60.9.82" ]; then
    echo -e "${GREEN}✓ $DNS_IP${NC}"
else
    echo -e "${RED}✗ $DNS_IP (expected 130.60.9.82)${NC}"
fi
echo ""

# 1. Server Network
echo -e "${GREEN}[1] Server Network Interface${NC}"
SERVER_IP=$(ip addr show | grep "inet " | grep -v 127.0.0.1 | head -1 | awk '{print $2}')
echo "  Server IP: $SERVER_IP"
echo ""

# 2. UFW Firewall
echo -e "${GREEN}[2] UFW Firewall${NC}"
UFW_STATUS=$(sudo ufw status | head -1)
echo "  Status: $UFW_STATUS"
UFW_RULES=$(sudo ufw status numbered | grep -c -E "30880|30882|30444" || echo "0")
echo "  LiveKit port rules: $UFW_RULES (expected: 3+)"
echo ""

# 3. Nginx
echo -e "${GREEN}[3] Nginx Reverse Proxy${NC}"
NGINX_STATUS=$(sudo systemctl is-active nginx)
echo "  Status: $NGINX_STATUS"
NGINX_PROXY=$(grep "proxy_pass" /etc/nginx/sites-available/c4dhi.moserfelix.com 2>/dev/null | grep livekit -A 1 | grep proxy_pass | awk '{print $2}' | tr -d ';')
echo "  LiveKit proxy: $NGINX_PROXY"
if [ "$NGINX_PROXY" = "http://127.0.0.1:30880" ]; then
    echo -e "  ${GREEN}✓ Correct (NodePort 30880)${NC}"
else
    echo -e "  ${RED}✗ Should be http://127.0.0.1:30880${NC}"
fi
echo ""

# 4. Minikube
echo -e "${GREEN}[4] Minikube Cluster${NC}"
MINIKUBE_HOST=$(minikube status 2>/dev/null | grep "^host:" | awk '{print $2}')
MINIKUBE_KUBELET=$(minikube status 2>/dev/null | grep "^kubelet:" | awk '{print $2}')
echo "  Host: $MINIKUBE_HOST"
echo "  Kubelet: $MINIKUBE_KUBELET"
echo ""

# 5. Kubernetes Services
echo -e "${GREEN}[5] Kubernetes Services${NC}"
NODEPORT_SVC=$(kubectl get svc livekit-nodeport -n ai-agents 2>/dev/null | tail -1 | awk '{print $1, $2}')
echo "  NodePort: $NODEPORT_SVC"
CLUSTERIP_SVC=$(kubectl get svc livekit -n ai-agents 2>/dev/null | tail -1 | awk '{print $1, $2, $3}')
echo "  ClusterIP: $CLUSTERIP_SVC"
echo ""

# 6. LiveKit Pod
echo -e "${GREEN}[6] LiveKit Pod${NC}"
POD_STATUS=$(kubectl get pods -n ai-agents -l app=livekit 2>/dev/null | tail -1)
echo "  $POD_STATUS"
echo ""

# 7. Port Bindings
echo -e "${GREEN}[7] NodePort Host Bindings${NC}"
PORTS_LISTENING=$(sudo ss -tulnp 2>/dev/null | grep -c -E ":3088[0-9]|:3089[0-9]|:30444" || echo "0")
echo "  Ports listening: $PORTS_LISTENING (expected: 14)"
if [ "$PORTS_LISTENING" -ge 14 ]; then
    echo -e "  ${GREEN}✓ All NodePorts bound${NC}"
else
    echo -e "  ${RED}✗ Missing port bindings${NC}"
fi
echo ""

# 8. Docker Proxy
echo -e "${GREEN}[8] Docker Proxy Processes${NC}"
PROXY_COUNT=$(ps aux 2>/dev/null | grep -c "docker-proxy.*3088" || echo "0")
echo "  Processes: $PROXY_COUNT (expected: ~14)"
if [ "$PROXY_COUNT" -ge 10 ]; then
    echo -e "  ${GREEN}✓ Docker proxy forwarding active${NC}"
else
    echo -e "  ${YELLOW}⚠ May have issues with port forwarding${NC}"
fi
echo ""

# 9. ConfigMaps
echo -e "${GREEN}[9] LiveKit Configuration${NC}"
NODE_IP=$(kubectl get configmap livekit-config -n ai-agents -o yaml 2>/dev/null | grep "node_ip:" | awk '{print $2}')
echo "  node_ip: $NODE_IP"
if [ "$NODE_IP" = "130.60.9.82" ]; then
    echo -e "  ${GREEN}✓ Correct IP advertised${NC}"
else
    echo -e "  ${RED}✗ Should be 130.60.9.82${NC}"
fi

TURN_ENABLED=$(kubectl get configmap livekit-config -n ai-agents -o yaml 2>/dev/null | grep -A 1 "turn:" | grep "enabled:" | awk '{print $2}')
echo "  TURN enabled: $TURN_ENABLED"
if [ "$TURN_ENABLED" = "true" ]; then
    echo -e "  ${GREEN}✓ TURN server enabled${NC}"
else
    echo -e "  ${RED}✗ TURN should be enabled for production${NC}"
fi

USE_ICE_LITE=$(kubectl get configmap livekit-config -n ai-agents -o yaml 2>/dev/null | grep "use_ice_lite:" | awk '{print $2}')
echo "  ICE Lite: $USE_ICE_LITE"
echo ""

# 10. Environment
echo -e "${GREEN}[10] Environment Configuration${NC}"
NODE_ENV=$(kubectl get configmap grace-ai-config -n ai-agents -o yaml 2>/dev/null | grep "NODE_ENV:" | awk '{print $2}' | tr -d '"')
echo "  NODE_ENV: $NODE_ENV"
if [ "$NODE_ENV" = "production" ]; then
    echo -e "  ${GREEN}✓ Production mode active${NC}"
else
    echo -e "  ${RED}✗ Should be 'production'${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Verification Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

CHECKS_PASSED=0
CHECKS_TOTAL=8

[ "$DNS_IP" = "130.60.9.82" ] && ((CHECKS_PASSED++))
[ "$NGINX_PROXY" = "http://127.0.0.1:30880" ] && ((CHECKS_PASSED++))
[ "$MINIKUBE_HOST" = "Running" ] && ((CHECKS_PASSED++))
[ "$PORTS_LISTENING" -ge 14 ] && ((CHECKS_PASSED++))
[ "$NODE_IP" = "130.60.9.82" ] && ((CHECKS_PASSED++))
[ "$TURN_ENABLED" = "true" ] && ((CHECKS_PASSED++))
[ "$NODE_ENV" = "production" ] && ((CHECKS_PASSED++))
[ "$PROXY_COUNT" -ge 10 ] && ((CHECKS_PASSED++))

if [ "$CHECKS_PASSED" -eq "$CHECKS_TOTAL" ]; then
    echo -e "${GREEN}✓ All critical checks passed ($CHECKS_PASSED/$CHECKS_TOTAL)${NC}"
    echo -e "${GREEN}  System appears correctly configured!${NC}"
else
    echo -e "${YELLOW}⚠ Some checks failed ($CHECKS_PASSED/$CHECKS_TOTAL)${NC}"
    echo -e "${YELLOW}  Review the output above for issues${NC}"
fi

echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Test connection at: https://frontend.c4dhi.moserfelix.com"
echo "  2. Check browser console for WebRTC connection"
echo "  3. View LiveKit logs: kubectl logs -n ai-agents -l app=livekit --tail=50"
echo ""
