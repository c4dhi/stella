#!/bin/bash
# Docker Image Cleanup Script for Minikube
# Removes unused Docker images to prevent disk space issues

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

NAMESPACE="${KUBERNETES_NAMESPACE:-ai-agents}"

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Docker Cleanup for Minikube${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Check if minikube is running
if ! minikube status | grep -q "Running"; then
    echo -e "${RED}Error: Minikube is not running${NC}"
    echo "Please start minikube first: minikube start"
    exit 1
fi

# Switch to minikube's Docker daemon
echo -e "${GREEN}Switching to minikube Docker daemon...${NC}"
eval $(minikube docker-env)

# Show current disk usage
echo -e "\n${BLUE}Current Docker disk usage:${NC}"
minikube ssh "docker system df"

echo ""
echo -e "${YELLOW}This script will:${NC}"
echo "  1. Clean up failed/stopped Kubernetes agent pods"
echo "  2. Remove orphaned Kubernetes secrets"
echo "  3. Remove dangling Docker images"
echo "  4. Remove stopped Docker containers"
echo "  5. Remove unused Docker networks"
echo "  6. Remove unused Docker volumes"
echo "  7. Clean up Docker build cache"
echo "  8. (Optional) Remove old agent images"
echo ""

read -p "Continue with cleanup? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cleanup cancelled"
    exit 0
fi

echo ""
echo -e "${GREEN}Step 1: Cleaning up Kubernetes agent pods...${NC}"
# Delete failed and error pods
FAILED_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=conversational-ai-agent --field-selector=status.phase=Failed -o name 2>/dev/null || echo "")
ERROR_PODS=$(kubectl get pods -n "$NAMESPACE" -l app=conversational-ai-agent --field-selector=status.phase=Error -o name 2>/dev/null || echo "")

if [ -n "$FAILED_PODS" ] || [ -n "$ERROR_PODS" ]; then
    echo "Deleting failed/error agent pods..."
    kubectl delete $FAILED_PODS $ERROR_PODS -n "$NAMESPACE" --ignore-not-found=true
else
    echo "No failed/error agent pods to remove"
fi

echo ""
echo -e "${GREEN}Step 2: Removing orphaned Kubernetes secrets...${NC}"
# Find agent secrets that don't have corresponding pods
for secret in $(kubectl get secrets -n "$NAMESPACE" -o name | grep agent-secret); do
    AGENT_ID=$(echo $secret | sed 's/secret\/agent-secret-//')
    POD_EXISTS=$(kubectl get pod -n "$NAMESPACE" "agent-$AGENT_ID" 2>/dev/null || echo "")
    if [ -z "$POD_EXISTS" ]; then
        echo "Deleting orphaned secret: $secret"
        kubectl delete -n "$NAMESPACE" $secret --ignore-not-found=true
    fi
done

echo ""
echo -e "${GREEN}Step 3: Removing dangling Docker images...${NC}"
minikube ssh "docker image prune -f" || echo "No dangling images to remove"

echo ""
echo -e "${GREEN}Step 4: Removing stopped Docker containers...${NC}"
minikube ssh "docker container prune -f" || echo "No stopped containers to remove"

echo ""
echo -e "${GREEN}Step 5: Removing unused Docker networks...${NC}"
minikube ssh "docker network prune -f" || echo "No unused networks to remove"

echo ""
echo -e "${GREEN}Step 6: Removing unused Docker volumes...${NC}"
minikube ssh "docker volume prune -f" || echo "No unused volumes to remove"

echo ""
echo -e "${GREEN}Step 7: Cleaning up Docker build cache...${NC}"
minikube ssh "docker builder prune -f" || echo "No build cache to remove"

echo ""
echo -e "${YELLOW}Optional: Remove old agent images?${NC}"
echo "This will remove ALL conversational-ai-server images except the latest"
read -p "Remove old agent images? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Removing old agent images...${NC}"
    # Keep only the latest agent image
    minikube ssh "docker images conversational-ai-server --format '{{.ID}} {{.CreatedAt}}' | tail -n +2 | awk '{print \$1}' | xargs -r docker rmi -f" || echo "No old agent images to remove"
fi

echo ""
echo -e "${YELLOW}Optional: Clean up all stopped agent pods (older than 1 hour)?${NC}"
read -p "Clean up old stopped pods? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Removing old stopped agent pods...${NC}"
    # Delete pods that are in Succeeded status for more than 1 hour
    kubectl delete pods -n "$NAMESPACE" -l app=conversational-ai-agent --field-selector=status.phase=Succeeded --ignore-not-found=true
fi

echo ""
echo -e "${GREEN}Cleanup complete!${NC}"
echo ""
echo -e "${BLUE}Updated Docker disk usage:${NC}"
minikube ssh "docker system df"

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Cleanup Summary${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "${YELLOW}To perform a more aggressive cleanup:${NC}"
echo "  minikube ssh 'docker system prune -a --volumes'"
echo ""
echo -e "${YELLOW}To see what would be removed without deleting:${NC}"
echo "  minikube ssh 'docker system df -v'"
echo ""
echo -e "${YELLOW}To clean up stopped Kubernetes agent pods:${NC}"
echo "  kubectl delete pods -n "$NAMESPACE" --field-selector=status.phase!=Running"
echo ""
