#!/bin/bash
set -e

# Force English language for all commands
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Ensure Docker and other tools are in PATH (for OrbStack and Docker Desktop)
# OrbStack installs Docker at /usr/local/bin via symlink
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.orbstack/bin:$PATH"

# OrbStack may need the Docker socket set explicitly
export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.orbstack/run/docker.sock}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Grace AI - Kubernetes Deployment${NC}"

# Change to script directory
cd "$(dirname "$0")/.."

# Load environment variables from .env file
if [ -f .env ]; then
    set -a  # automatically export all variables
    source .env
    set +a
else
    echo -e "${RED}✗ Error: .env file not found${NC}"
    echo "  Run: cp .env.example .env && nano .env"
    exit 1
fi

# Validate required environment variables
if [ -z "$OPENAI_API_KEY" ] || [ -z "$POSTGRES_DB" ] || [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ]; then
    echo -e "${RED}✗ Missing required environment variables in .env${NC}"
    [ -z "$OPENAI_API_KEY" ] && echo "  - OPENAI_API_KEY"
    [ -z "$POSTGRES_DB" ] && echo "  - POSTGRES_DB"
    [ -z "$POSTGRES_USER" ] && echo "  - POSTGRES_USER"
    [ -z "$POSTGRES_PASSWORD" ] && echo "  - POSTGRES_PASSWORD"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not running${NC}"
    exit 1
fi

# Check if required ports are available
REQUIRED_PORTS=(3000 5173 7880 5432)
PORTS_IN_USE=()

for port in "${REQUIRED_PORTS[@]}"; do
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        PORTS_IN_USE+=($port)
        PROCESS_INFO=$(lsof -Pi :$port -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1 " (PID: " $2 ")"}')
        echo -e "${RED}✗ Port $port in use: $PROCESS_INFO${NC}"
    fi
done

if [ ${#PORTS_IN_USE[@]} -gt 0 ]; then
    echo -e "${RED}Stop services and try again (kill -9 <PID>)${NC}"
    exit 1
fi

# Check if required tools are installed
if ! command -v minikube &> /dev/null; then
    echo -e "${YELLOW}Installing minikube...${NC}"
    [[ "$OSTYPE" == "darwin"* ]] && brew install minikube || { echo -e "${RED}✗ Install minikube: https://minikube.sigs.k8s.io/docs/start/${NC}"; exit 1; }
fi

if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}✗ kubectl not installed${NC}"
    exit 1
fi

# Start minikube if not running
echo -e "${GREEN}⚙️  Starting minikube...${NC}"
minikube status | grep -q "Running" || minikube start --driver=docker --cpus=4 --memory=8192

# Configure environment
minikube addons enable metrics-server 2>/dev/null
minikube addons enable dashboard 2>/dev/null
kubectl config use-context minikube > /dev/null 2>&1
eval $(minikube docker-env)

# Build Docker images
echo -e "${GREEN}🔨 Building Docker images...${NC}"
cd "$(dirname "$0")/.."

echo -n "  • session-management-server... "
DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t session-management-server:latest . > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • conversational-ai-server... "
DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t conversational-ai-server:latest ./conversational-ai-server-python > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • frontend-ui... "
DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t frontend-ui:latest ./frontend-ui > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • message-recorder... "
DOCKER_BUILDKIT=1 docker build -q --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t message-recorder-python:latest ./message-recorder-python > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

# Detect network IP for public URLs
NETWORK_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
echo -e "${GREEN}📡 Detected network IP: ${NETWORK_IP}${NC}"

# Inject network IP into ConfigMap
echo -n "  • Updating ConfigMap with network IP... "
sed "s/NETWORK_IP_PLACEHOLDER/${NETWORK_IP}/g" k8s/04-configmap.yaml > /tmp/04-configmap-updated.yaml
echo -e "${GREEN}✓${NC}"

# Deploy to Kubernetes
echo -e "${GREEN}☸️  Deploying to Kubernetes...${NC}"
kubectl apply -f k8s/00-namespace.yaml > /dev/null
kubectl apply -f k8s/01-postgres.yaml > /dev/null
kubectl apply -f k8s/02-livekit.yaml > /dev/null
kubectl apply -f k8s/03-secrets.yaml > /dev/null
kubectl apply -f /tmp/04-configmap-updated.yaml > /dev/null
kubectl apply -f k8s/05-rbac.yaml > /dev/null
kubectl apply -f k8s/06-message-recorder.yaml > /dev/null
kubectl apply -f k8s/06-session-management-server.yaml > /dev/null
kubectl apply -f k8s/07-frontend-ui.yaml > /dev/null

# Create secrets
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
kubectl create secret generic grace-ai-secrets -n ai-agents \
  --from-literal=postgres-db="$POSTGRES_DB" \
  --from-literal=postgres-user="$POSTGRES_USER" \
  --from-literal=postgres-password="$POSTGRES_PASSWORD" \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=openai-api-key="$OPENAI_API_KEY" \
  --from-literal=jwt-secret="dev-secret-change-in-production" \
  --from-literal=livekit-api-key="devkey" \
  --from-literal=livekit-api-secret="secret" \
  --from-literal=livekit-webhook-secret="webhook-secret" \
  --from-literal=elevenlabs-api-key="" \
  --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# Wait for services
echo -n "  • Waiting for PostgreSQL... "
kubectl wait --for=condition=ready pod -l app=postgres -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • Waiting for LiveKit... "
kubectl wait --for=condition=ready pod -l app=livekit -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

# Restart deployments
kubectl rollout restart deployment session-management-server -n ai-agents > /dev/null 2>&1
kubectl rollout restart deployment frontend-ui -n ai-agents > /dev/null 2>&1

echo -n "  • Waiting for backend... "
kubectl rollout status deployment/session-management-server -n ai-agents --timeout=180s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • Waiting for frontend... "
kubectl rollout status deployment/frontend-ui -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"


# Start port-forwards to expose services on localhost and network
echo -e "${GREEN}🌐 Setting up port forwards...${NC}"

# Port forward commands (run in background)
kubectl port-forward -n ai-agents --address 0.0.0.0 svc/frontend-ui 80:8080 > /dev/null 2>&1 &
PF_FRONTEND=$!

kubectl port-forward -n ai-agents --address 0.0.0.0 svc/session-management-server 3000:3000 > /dev/null 2>&1 &
PF_BACKEND=$!

kubectl port-forward -n ai-agents --address 0.0.0.0 svc/livekit 7880:7880 > /dev/null 2>&1 &
PF_LIVEKIT=$!

kubectl port-forward -n ai-agents --address 0.0.0.0 svc/postgres 5432:5432 > /dev/null 2>&1 &
PF_POSTGRES=$!

echo -e "${GREEN}✓ Port forwards started${NC}"

# Give port forwards a moment to initialize
sleep 2

# Cleanup function to stop all services
cleanup() {
  echo ""
  echo ""
  echo -e "${YELLOW}🛑 Stopping all services...${NC}"
  echo ""

  # Kill port-forward processes
  echo -e "${BLUE}Stopping port forwards...${NC}"
  [ ! -z "$PF_FRONTEND" ] && kill $PF_FRONTEND 2>/dev/null
  [ ! -z "$PF_BACKEND" ] && kill $PF_BACKEND 2>/dev/null
  [ ! -z "$PF_LIVEKIT" ] && kill $PF_LIVEKIT 2>/dev/null
  [ ! -z "$PF_POSTGRES" ] && kill $PF_POSTGRES 2>/dev/null

  # Stop minikube (stops all services gracefully)
  echo -e "${BLUE}Stopping minikube cluster...${NC}"
  minikube stop

  echo ""
  echo -e "${GREEN}✅ All services stopped${NC}"
  echo -e "${BLUE}To restart, run: ./scripts/start-k8s.sh${NC}"
  echo ""
  exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo -e "${BLUE}🌐 Services accessible at:${NC}"
echo ""
echo -e "${GREEN}Localhost Access:${NC}"
echo -e "  ${GREEN}Frontend:${NC}  http://localhost"
echo -e "  ${GREEN}Backend:${NC}   http://localhost:3000"
echo -e "  ${GREEN}LiveKit:${NC}   ws://localhost:7880"
echo -e "  ${GREEN}Database:${NC}  localhost:5432"
echo ""
echo -e "${GREEN}Network Access (from other devices):${NC}"
echo -e "  ${GREEN}Frontend:${NC}  http://${NETWORK_IP}"
echo -e "  ${GREEN}Backend:${NC}   http://${NETWORK_IP}:3000"
echo -e "  ${GREEN}LiveKit:${NC}   ws://${NETWORK_IP}:7880"
echo -e "  ${GREEN}Database:${NC}  ${NETWORK_IP}:5432"
echo ""
echo -e "${YELLOW}💡 Use the network URLs to access from phones, tablets, or other computers${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ Services are running${NC}"
echo -e "${RED}⚠️  Press Ctrl+C to stop all services and shutdown minikube${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Keep script running
tail -f /dev/null
