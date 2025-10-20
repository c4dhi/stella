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

# Deploy to Kubernetes
echo -e "${GREEN}☸️  Deploying to Kubernetes...${NC}"
kubectl apply -f k8s/ > /dev/null

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


# Start port forwarding
echo -e "${GREEN}🌐 Starting port forwarding...${NC}"
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/session-management-server 3000:3000 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/livekit 7880:7880 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/postgres 5432:5432 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/frontend-ui 5173:80 > /dev/null 2>&1 &
sleep 2

# Get local IP for network access
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo -e "${BLUE}Access URLs:${NC}"
echo -e "  Frontend:  ${GREEN}http://localhost:5173${NC}  (or http://${LOCAL_IP}:5173)"
echo -e "  Backend:   ${GREEN}http://localhost:3000${NC}  (or http://${LOCAL_IP}:3000)"
echo -e "  LiveKit:   ${GREEN}ws://localhost:7880${NC}  (or ws://${LOCAL_IP}:7880)"
echo -e "  Database:  ${GREEN}localhost:5432${NC}"
echo ""
echo -e "${YELLOW}💡 Network URLs work from any device on your local network${NC}"
echo -e "${YELLOW}⚠️  Keep this terminal open • Press Ctrl+C to stop${NC}"
echo ""
wait
