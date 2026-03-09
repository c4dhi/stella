#!/bin/bash

# Script to show environment status
# Environments are selected via start-k8s.sh flags (--production or default local)
# Config lives in .env.local and .env.production (self-contained, no base .env)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Change to project root
cd "$(dirname "$0")/.."

# Function to show usage
show_usage() {
    echo "Usage: $0 [local|production]"
    echo ""
    echo "Show environment configuration status"
    echo ""
    echo "Options:"
    echo "  local       Show local development configuration"
    echo "  production  Show production configuration"
    echo ""
    echo "To deploy, use:"
    echo "  ./scripts/start-k8s.sh              # Local (uses .env.local)"
    echo "  ./scripts/start-k8s.sh --production # Production (uses .env.production)"
    exit 1
}

# Determine which environment to show
TARGET_ENV="${1:-local}"

if [ "$TARGET_ENV" != "local" ] && [ "$TARGET_ENV" != "production" ]; then
    echo -e "${RED}✗ Invalid environment: $TARGET_ENV${NC}"
    echo ""
    show_usage
fi

# Select the correct env file
if [ "$TARGET_ENV" = "production" ]; then
    ENV_FILE=".env.production"
else
    ENV_FILE=".env.local"
fi

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}✗ Error: $ENV_FILE not found${NC}"
    echo "  Copy .env.example to $ENV_FILE and customize"
    exit 1
fi

echo -e "${YELLOW}Environment: ${TARGET_ENV}${NC} (from ${ENV_FILE})"
echo ""

if [ "$TARGET_ENV" = "production" ]; then
    PROD_DOMAIN=$(grep "^PRODUCTION_DOMAIN=" "$ENV_FILE" | cut -d'=' -f2)
    echo -e "  ${GREEN}Domain:${NC} ${PROD_DOMAIN}"
    echo ""
    echo -e "${BLUE}Production URLs:${NC}"
    echo -e "  Frontend:  https://frontend.${PROD_DOMAIN}"
    echo -e "  Backend:   https://backend.${PROD_DOMAIN}"
    echo -e "  LiveKit:   wss://livekit-v1.${PROD_DOMAIN} (external)"
    echo -e "  Database:  db.${PROD_DOMAIN}:5432"
else
    echo -e "${BLUE}Local URLs:${NC}"
    echo -e "  Frontend:  http://localhost:8080"
    echo -e "  Backend:   http://localhost:3000"
    echo -e "  LiveKit:   ws://localhost:7880"
    echo -e "  Database:  localhost:5432"
fi

# Show key settings
TTS_PROVIDER=$(grep "^TTS_PROVIDER=" "$ENV_FILE" | cut -d'=' -f2)
STT_PROVIDER=$(grep "^STT_PROVIDER=" "$ENV_FILE" | cut -d'=' -f2)
ENABLE_GPU=$(grep "^ENABLE_GPU=" "$ENV_FILE" | cut -d'=' -f2)

echo ""
echo -e "${BLUE}Settings:${NC}"
echo -e "  TTS:  ${TTS_PROVIDER:-piper}"
echo -e "  STT:  ${STT_PROVIDER:-sherpa}"
echo -e "  GPU:  ${ENABLE_GPU:-false}"

echo ""
echo -e "${GREEN}Deploy with:${NC}"
if [ "$TARGET_ENV" = "production" ]; then
    echo -e "  ./scripts/start-k8s.sh --production"
else
    echo -e "  ./scripts/start-k8s.sh"
fi
