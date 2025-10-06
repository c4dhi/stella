#!/bin/bash
# Script to update OpenAI API key in all agent secrets
# Run this after updating OPENAI_API_KEY in .env file

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Update OpenAI API Key in Agent Secrets${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Load OpenAI API key from .env
export $(grep -v '^#' .env | grep OPENAI_API_KEY | xargs)

if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}Error: OPENAI_API_KEY not found in .env file${NC}"
    exit 1
fi

# Validate API key format
if [[ ! $OPENAI_API_KEY =~ ^sk- ]]; then
    echo -e "${RED}Error: OPENAI_API_KEY has invalid format (should start with 'sk-')${NC}"
    exit 1
fi

echo -e "${GREEN}Found OpenAI API key in .env:${NC}"
echo -e "  ${OPENAI_API_KEY:0:7}...${OPENAI_API_KEY: -4} (${#OPENAI_API_KEY} characters)"
echo ""

# Check if minikube is running
if ! minikube status | grep -q "Running" 2>/dev/null; then
    echo -e "${YELLOW}Warning: Minikube is not running${NC}"
    echo "This script will only work if your Kubernetes cluster is running."
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled"
        exit 0
    fi
fi

# Get all agent secrets
SECRETS=$(kubectl get secrets -n ai-agents -o name 2>/dev/null | grep "agent-secret-" || echo "")

if [ -z "$SECRETS" ]; then
    echo -e "${YELLOW}No agent secrets found in ai-agents namespace${NC}"
    echo "This is normal if no agents have been created yet."
    exit 0
fi

SECRET_COUNT=$(echo "$SECRETS" | wc -l)
echo -e "${BLUE}Found $SECRET_COUNT agent secret(s)${NC}"
echo ""

echo -e "${YELLOW}This will update the OPENAI_API_KEY in all agent secrets.${NC}"
echo -e "${YELLOW}Any running agents will need to be restarted to use the new key.${NC}"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

echo ""
echo -e "${GREEN}Updating agent secrets...${NC}"

# Update each secret
for secret in $SECRETS; do
    SECRET_NAME=$(echo $secret | sed 's/secret\///')
    echo -e "  Updating ${SECRET_NAME}..."

    # Get existing secret data
    SECRET_DATA=$(kubectl get secret $SECRET_NAME -n ai-agents -o json)

    # Update OPENAI_API_KEY (base64 encode)
    ENCODED_KEY=$(echo -n "$OPENAI_API_KEY" | base64)

    # Patch the secret
    kubectl patch secret $SECRET_NAME -n ai-agents \
        --type='json' \
        -p="[{'op': 'replace', 'path': '/data/OPENAI_API_KEY', 'value': '$ENCODED_KEY'}]" \
        2>/dev/null || echo -e "${YELLOW}    Warning: Failed to update $SECRET_NAME${NC}"
done

echo ""
echo -e "${GREEN}✅ Update complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Restart session-management-server to use the new key:"
echo -e "   ${YELLOW}kubectl rollout restart deployment session-management-server -n ai-agents${NC}"
echo ""
echo "2. Restart any running agents to use the new key:"
echo -e "   ${YELLOW}kubectl delete pod -n ai-agents -l app=conversational-ai-agent${NC}"
echo ""
echo "3. Or run the full deployment script:"
echo -e "   ${YELLOW}./scripts/start-k8s.sh${NC}"
echo ""
