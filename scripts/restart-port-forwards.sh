#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Restarting Port Forwards${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Kill existing port-forward processes
echo -e "${YELLOW}Stopping existing port forwards...${NC}"
pkill -f "kubectl port-forward" || true
sleep 2

# Detect local IP address
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo -e "${GREEN}Starting new port forwards with network access...${NC}"
echo -e "${YELLOW}Note: If macOS firewall prompts, click 'Allow' to enable network access${NC}"
echo ""

# Port forward with --address 0.0.0.0 to bind to all network interfaces
NAMESPACE="${KUBERNETES_NAMESPACE:-ai-agents}"
_BACKEND_PORT="${BACKEND_PORT:-3000}"
_POSTGRES_PORT="${POSTGRES_PORT:-5432}"
kubectl port-forward --address 0.0.0.0 -n "$NAMESPACE" svc/session-management-server ${_BACKEND_PORT}:3000 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n "$NAMESPACE" svc/livekit 7880:7880 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n "$NAMESPACE" svc/postgres ${_POSTGRES_PORT}:5432 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n "$NAMESPACE" svc/frontend-ui 5173:80 > /dev/null 2>&1 &

# Wait for port forwards to establish
sleep 3

echo ""
echo -e "${GREEN}✅ Port forwards restarted!${NC}"
echo ""
echo -e "${BLUE}📱 From your phone or any device on the network:${NC}"
echo -e "  ${GREEN}Frontend UI:${NC} http://${LOCAL_IP}:5173"
echo -e "  ${GREEN}Backend API:${NC} http://${LOCAL_IP}:${_BACKEND_PORT}"
echo -e "  ${GREEN}LiveKit:${NC} ws://${LOCAL_IP}:7880"
echo ""
echo -e "${BLUE}💻 From your Mac (localhost also works):${NC}"
echo -e "  ${GREEN}Frontend UI:${NC} http://localhost:5173"
echo -e "  ${GREEN}Backend API:${NC} http://localhost:${_BACKEND_PORT}"
echo -e "  ${GREEN}LiveKit:${NC} ws://localhost:7880"
echo ""
echo -e "${YELLOW}⚠️  Port forwards are running in the background${NC}"
echo -e "${YELLOW}⚠️  To stop them, run: pkill -f 'kubectl port-forward'${NC}"
echo ""
