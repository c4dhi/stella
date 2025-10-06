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

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Grace AI - Kubernetes Deployment${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Change to script directory
cd "$(dirname "$0")/.."

# Load environment variables from .env file
if [ -f .env ]; then
    echo -e "${GREEN}Loading environment variables from .env${NC}"
    set -a  # automatically export all variables
    source .env
    set +a
else
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file with your OPENAI_API_KEY"
    echo "You can copy .env.example to .env and fill in your key:"
    echo ""
    echo -e "  ${YELLOW}cp .env.example .env${NC}"
    echo -e "  ${YELLOW}nano .env${NC}"
    echo ""
    exit 1
fi

# Validate required environment variables
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}Error: OPENAI_API_KEY not set in .env${NC}"
    echo "Please add your OpenAI API key to the .env file"
    exit 1
fi

if [ -z "$POSTGRES_DB" ]; then
    echo -e "${RED}Error: POSTGRES_DB not set in .env${NC}"
    echo "Please add database credentials to the .env file"
    exit 1
fi

if [ -z "$POSTGRES_USER" ]; then
    echo -e "${RED}Error: POSTGRES_USER not set in .env${NC}"
    echo "Please add database credentials to the .env file"
    exit 1
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    echo -e "${RED}Error: POSTGRES_PASSWORD not set in .env${NC}"
    echo "Please add database credentials to the .env file"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running${NC}"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

# Check if minikube is installed
if ! command -v minikube &> /dev/null; then
    echo -e "${YELLOW}minikube not found. Installing...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install minikube
    else
        echo -e "${RED}Please install minikube manually: https://minikube.sigs.k8s.io/docs/start/${NC}"
        exit 1
    fi
fi

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}Error: kubectl is not installed${NC}"
    echo "Please install kubectl: https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi

# Start minikube if not running
echo -e "${GREEN}Starting minikube...${NC}"
if minikube status | grep -q "Running"; then
    echo -e "${GREEN}minikube is already running${NC}"
else
    minikube start --driver=docker --cpus=4 --memory=8192
fi

# Enable minikube addons
echo -e "${GREEN}Enabling minikube addons...${NC}"
minikube addons enable metrics-server 2>/dev/null
minikube addons enable dashboard 2>/dev/null

# Configure kubectl to use minikube
echo -e "${GREEN}Configuring kubectl context...${NC}"
kubectl config use-context minikube

# Use minikube's Docker daemon
echo -e "${GREEN}Setting up Docker environment...${NC}"
eval $(minikube docker-env)

# Build Docker images
echo -e "${GREEN}Building Docker images...${NC}"
cd "$(dirname "$0")/.."

echo -e "${BLUE}Building session-management-server image...${NC}"
docker build -t session-management-server:latest .

echo -e "${BLUE}Building conversational-ai-server image...${NC}"
docker build -t conversational-ai-server:latest ./conversational-ai-server-python

echo -e "${BLUE}Building frontend-ui image...${NC}"
docker build -t frontend-ui:latest ./frontend-ui

# Apply Kubernetes manifests
echo -e "${GREEN}Deploying to Kubernetes...${NC}"
kubectl apply -f k8s/

# Inject secrets from .env into Kubernetes
echo -e "${GREEN}Injecting secrets from .env into Kubernetes...${NC}"

# Build the database URL
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"

# Update the secret with all credentials
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
  --dry-run=client -o yaml | kubectl apply -f -

# Wait for PostgreSQL to be ready
echo -e "${GREEN}Waiting for PostgreSQL to be ready...${NC}"
kubectl wait --for=condition=ready pod -l app=postgres -n ai-agents --timeout=120s

# Wait for LiveKit to be ready
echo -e "${GREEN}Waiting for LiveKit to be ready...${NC}"
kubectl wait --for=condition=ready pod -l app=livekit -n ai-agents --timeout=120s

# Force pods to use latest images by restarting deployments
echo -e "${GREEN}Restarting deployments to use latest images...${NC}"
kubectl rollout restart deployment session-management-server -n ai-agents
kubectl rollout restart deployment frontend-ui -n ai-agents

# Wait for session-management-server to be ready
echo -e "${GREEN}Waiting for session-management-server to be ready...${NC}"
kubectl rollout status deployment/session-management-server -n ai-agents --timeout=180s

# Wait for frontend-ui to be ready
echo -e "${GREEN}Waiting for frontend-ui to be ready...${NC}"
kubectl rollout status deployment/frontend-ui -n ai-agents --timeout=120s

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Detect local IP address
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo -e "${BLUE}📱 Network Access (from any device on your network):${NC}"
echo ""
echo -e "  ${GREEN}✓ Frontend UI:${NC} http://${LOCAL_IP}:5173"
echo -e "  ${GREEN}✓ Backend API:${NC} http://${LOCAL_IP}:3000"
echo -e "  ${GREEN}✓ LiveKit:${NC} ws://${LOCAL_IP}:7880"
echo ""
echo -e "  ${YELLOW}💡 Tip: Click the ℹ️ button in the UI header to see a QR code!${NC}"
echo -e "  ${YELLOW}📱 If your Mac firewall prompts, click 'Allow' for kubectl${NC}"
echo ""
echo -e "${BLUE}💻 Localhost Access (same URLs work on your Mac):${NC}"
echo ""
echo -e "  ${YELLOW}# Access Frontend UI (in a new terminal)${NC}"
echo -e "  kubectl port-forward -n ai-agents svc/frontend-ui 5173:80"
echo -e "  ${BLUE}Then open:${NC} http://localhost:5173"
echo ""
echo -e "  ${YELLOW}# Access API (in a new terminal)${NC}"
echo -e "  kubectl port-forward -n ai-agents svc/session-management-server 3000:3000"
echo -e "  ${BLUE}Then open:${NC} http://localhost:3000"
echo ""
echo -e "  ${YELLOW}# Access LiveKit (in a new terminal)${NC}"
echo -e "  kubectl port-forward -n ai-agents svc/livekit 7880:7880"
echo -e "  ${BLUE}Then open:${NC} ws://localhost:7880"
echo ""
echo -e "${BLUE}🛠️  Useful commands:${NC}"
echo ""
echo -e "  ${YELLOW}# View all resources${NC}"
echo -e "  kubectl get all -n ai-agents"
echo ""
echo -e "  ${YELLOW}# View logs${NC}"
echo -e "  kubectl logs -f -n ai-agents -l app=session-management-server"
echo ""
echo -e "  ${YELLOW}# View agent pods${NC}"
echo -e "  kubectl get pods -n ai-agents -l app=conversational-ai-agent"
echo ""
echo -e "  ${YELLOW}# Open Kubernetes dashboard${NC}"
echo -e "  minikube dashboard"
echo ""
echo -e "  ${YELLOW}# Stop the cluster${NC}"
echo -e "  minikube stop"
echo ""
echo -e "${GREEN}Starting port forwarding on all network interfaces...${NC}"
echo -e "${YELLOW}Note: If macOS firewall prompts, click 'Allow' to enable network access${NC}"
echo ""

# Port forward with --address 0.0.0.0 to bind to all network interfaces
# This makes services accessible from your phone and other devices on the network
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/session-management-server 3000:3000 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/livekit 7880:7880 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/postgres 5432:5432 > /dev/null 2>&1 &
kubectl port-forward --address 0.0.0.0 -n ai-agents svc/frontend-ui 5173:80 > /dev/null 2>&1 &

# Wait a moment for port forwards to establish
sleep 2

echo ""
echo -e "${GREEN}✅ Services are now accessible!${NC}"
echo ""
echo -e "${BLUE}📱 From your phone or any device on the network:${NC}"
echo -e "  ${GREEN}Frontend UI:${NC} http://${LOCAL_IP}:5173"
echo -e "  ${GREEN}Backend API:${NC} http://${LOCAL_IP}:3000"
echo -e "  ${GREEN}LiveKit:${NC} ws://${LOCAL_IP}:7880"
echo ""
echo -e "${BLUE}💻 From your Mac (localhost also works):${NC}"
echo -e "  ${GREEN}Frontend UI:${NC} http://localhost:5173"
echo -e "  ${GREEN}Backend API:${NC} http://localhost:3000"
echo -e "  ${GREEN}LiveKit:${NC} ws://localhost:7880"
echo -e "  ${GREEN}PostgreSQL:${NC} localhost:5432"
echo ""
echo -e "  ${BLUE}Database: ${POSTGRES_DB} | User: ${POSTGRES_USER} | Password: ${POSTGRES_PASSWORD}${NC}"
echo ""
echo -e "${YELLOW}⚠️  Important: Keep this terminal open to maintain access!${NC}"
echo -e "${BLUE}Press Ctrl+C to stop all port forwarding${NC}"
echo ""
wait
