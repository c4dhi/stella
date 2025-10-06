#!/bin/bash
set -e

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
minikube addons enable metrics-server

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

# Apply Kubernetes manifests
echo -e "${GREEN}Deploying to Kubernetes...${NC}"
kubectl apply -f k8s/

# Wait for PostgreSQL to be ready
echo -e "${GREEN}Waiting for PostgreSQL to be ready...${NC}"
kubectl wait --for=condition=ready pod -l app=postgres -n ai-agents --timeout=120s

# Wait for LiveKit to be ready
echo -e "${GREEN}Waiting for LiveKit to be ready...${NC}"
kubectl wait --for=condition=ready pod -l app=livekit -n ai-agents --timeout=120s

# Wait for session-management-server to be ready
echo -e "${GREEN}Waiting for session-management-server to be ready...${NC}"
kubectl wait --for=condition=ready pod -l app=session-management-server -n ai-agents --timeout=180s

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo ""
echo -e "  ${YELLOW}# View all resources${NC}"
echo -e "  kubectl get all -n ai-agents"
echo ""
echo -e "  ${YELLOW}# Access the API (in a new terminal)${NC}"
echo -e "  kubectl port-forward -n ai-agents svc/session-management-server 3000:3000"
echo ""
echo -e "  ${YELLOW}# Access LiveKit (in a new terminal)${NC}"
echo -e "  kubectl port-forward -n ai-agents svc/livekit 7880:7880"
echo ""
echo -e "  ${YELLOW}# View logs${NC}"
echo -e "  kubectl logs -f -n ai-agents -l app=session-management-server"
echo ""
echo -e "  ${YELLOW}# View agent pods${NC}"
echo -e "  kubectl get pods -n ai-agents -l app=conversational-ai-agent"
echo ""
echo -e "  ${YELLOW}# Stop the cluster${NC}"
echo -e "  minikube stop"
echo ""
echo -e "${GREEN}Starting port forwarding...${NC}"
kubectl port-forward -n ai-agents svc/session-management-server 3000:3000 &
kubectl port-forward -n ai-agents svc/livekit 7880:7880 &

echo ""
echo -e "${GREEN}✓ API running at: http://localhost:3000${NC}"
echo -e "${GREEN}✓ LiveKit running at: ws://localhost:7880${NC}"
echo ""
echo -e "${BLUE}Press Ctrl+C to stop port forwarding${NC}"
wait
