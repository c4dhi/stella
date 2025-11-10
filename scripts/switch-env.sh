#!/bin/bash

# Script to switch between local and production environments
# Updates NODE_ENV in .env file

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Change to project root
cd "$(dirname "$0")/.."

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}✗ Error: .env file not found${NC}"
    echo "  Run: cp .env.example .env"
    exit 1
fi

# Function to show usage
show_usage() {
    echo "Usage: $0 [local|production]"
    echo ""
    echo "Switch between local and production environments"
    echo ""
    echo "Options:"
    echo "  local       Switch to local development mode (localhost with port-forwards)"
    echo "  production  Switch to production mode (custom domains with NodePort)"
    echo ""
    echo "Examples:"
    echo "  $0 local       # Switch to local development"
    echo "  $0 production  # Switch to production deployment"
    exit 1
}

# Check if argument provided
if [ $# -eq 0 ]; then
    echo -e "${YELLOW}Current environment configuration:${NC}"
    echo ""

    # Read current NODE_ENV from .env
    CURRENT_ENV=$(grep "^NODE_ENV=" .env | cut -d'=' -f2)

    if [ -z "$CURRENT_ENV" ]; then
        echo -e "${RED}✗ NODE_ENV not set in .env${NC}"
    else
        echo -e "  ${GREEN}NODE_ENV:${NC} ${CURRENT_ENV}"

        # Show URLs based on current environment
        if [ "$CURRENT_ENV" = "production" ]; then
            PROD_DOMAIN=$(grep "^PRODUCTION_DOMAIN=" .env | cut -d'=' -f2)
            echo -e "  ${GREEN}Domain:${NC}   ${PROD_DOMAIN}"
            echo ""
            echo -e "${BLUE}Production URLs:${NC}"
            echo -e "  Frontend:  https://frontend.${PROD_DOMAIN}"
            echo -e "  Backend:   https://backend.${PROD_DOMAIN}"
            echo -e "  LiveKit:   wss://livekit.${PROD_DOMAIN}"
            echo -e "  Database:  db.${PROD_DOMAIN}:5432"
        else
            echo ""
            echo -e "${BLUE}Local URLs:${NC}"
            echo -e "  Frontend:  http://localhost:8080"
            echo -e "  Backend:   http://localhost:3000"
            echo -e "  LiveKit:   ws://localhost:7880"
            echo -e "  Database:  localhost:5432"
        fi
    fi
    echo ""
    show_usage
fi

TARGET_ENV=$1

# Validate input
if [ "$TARGET_ENV" != "local" ] && [ "$TARGET_ENV" != "production" ]; then
    echo -e "${RED}✗ Invalid environment: $TARGET_ENV${NC}"
    echo ""
    show_usage
fi

# Get current environment
CURRENT_ENV=$(grep "^NODE_ENV=" .env | cut -d'=' -f2)

if [ "$CURRENT_ENV" = "$TARGET_ENV" ]; then
    echo -e "${YELLOW}⚠️  Already in $TARGET_ENV mode${NC}"
    exit 0
fi

# Update NODE_ENV in .env file
echo -e "${BLUE}Switching environment from '${CURRENT_ENV}' to '${TARGET_ENV}'...${NC}"

# Use sed to update NODE_ENV line
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/^NODE_ENV=.*/NODE_ENV=${TARGET_ENV}/" .env
else
    # Linux
    sed -i "s/^NODE_ENV=.*/NODE_ENV=${TARGET_ENV}/" .env
fi

echo -e "${GREEN}✓ Environment switched to: ${TARGET_ENV}${NC}"
echo ""

# Show new configuration
if [ "$TARGET_ENV" = "production" ]; then
    PROD_DOMAIN=$(grep "^PRODUCTION_DOMAIN=" .env | cut -d'=' -f2)
    echo -e "${BLUE}Production Configuration:${NC}"
    echo -e "  ${GREEN}Domain:${NC} ${PROD_DOMAIN}"
    echo ""
    echo -e "${BLUE}Services will be accessible at:${NC}"
    echo -e "  Frontend:  https://frontend.${PROD_DOMAIN}"
    echo -e "  Backend:   https://backend.${PROD_DOMAIN}"
    echo -e "  LiveKit:   wss://livekit.${PROD_DOMAIN}"
    echo -e "  Database:  db.${PROD_DOMAIN}:5432"
    echo ""
    echo -e "${YELLOW}⚠️  Important:${NC}"
    echo -e "  1. Ensure nginx is configured to proxy to NodePorts (30080, 30000, 30880, 30432)"
    echo -e "  2. Verify SSL certificates are valid for all subdomains"
    echo -e "  3. Run: ./scripts/start-k8s.sh to deploy with production settings"
else
    echo -e "${BLUE}Local Development Configuration:${NC}"
    echo ""
    echo -e "${BLUE}Services will be accessible at:${NC}"
    echo -e "  Frontend:  http://localhost:8080"
    echo -e "  Backend:   http://localhost:3000"
    echo -e "  LiveKit:   ws://localhost:7880"
    echo -e "  Database:  localhost:5432"
    echo ""
    echo -e "${YELLOW}⚠️  Note:${NC}"
    echo -e "  Port-forwards will be automatically created to expose services"
    echo -e "  Run: ./scripts/start-k8s.sh to deploy with local settings"
fi

echo ""
echo -e "${GREEN}✅ Ready to deploy with ${TARGET_ENV} configuration${NC}"
