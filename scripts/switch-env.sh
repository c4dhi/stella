#!/bin/bash

# Script to inspect environment files and prepare NODE_ENV in the selected file.
# Deployment mode is selected via start script flags:
#   ./scripts/start-k8s.sh --local
#   ./scripts/start-k8s.sh --production

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

cd "$(dirname "$0")/.."

show_usage() {
    echo "Usage: $0 [local|production]"
    echo ""
    echo "Show environment file status or update NODE_ENV in one file."
    echo ""
    echo "Examples:"
    echo "  $0              # Show .env.local / .env.production status"
    echo "  $0 local        # Ensure NODE_ENV=local in .env.local"
    echo "  $0 production   # Ensure NODE_ENV=production in .env.production"
    exit 1
}

read_node_env() {
    local file="$1"
    if [ -f "$file" ]; then
        grep "^NODE_ENV=" "$file" | cut -d'=' -f2 || true
    fi
}

ensure_node_env() {
    local file="$1"
    local value="$2"

    if grep -q "^NODE_ENV=" "$file"; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/^NODE_ENV=.*/NODE_ENV=${value}/" "$file"
        else
            sed -i "s/^NODE_ENV=.*/NODE_ENV=${value}/" "$file"
        fi
    else
        echo "" >> "$file"
        echo "# Environment Mode" >> "$file"
        echo "NODE_ENV=${value}" >> "$file"
    fi
}

if [ $# -eq 0 ]; then
    LOCAL_ENV=$(read_node_env ".env.local")
    PROD_ENV=$(read_node_env ".env.production")

    echo -e "${BLUE}Environment file status:${NC}"
    if [ -f ".env.local" ]; then
        echo -e "  ${GREEN}✓${NC} .env.local       NODE_ENV=${LOCAL_ENV:-<unset>}"
    else
        echo -e "  ${YELLOW}•${NC} .env.local       not found"
    fi

    if [ -f ".env.production" ]; then
        echo -e "  ${GREEN}✓${NC} .env.production  NODE_ENV=${PROD_ENV:-<unset>}"
    else
        echo -e "  ${YELLOW}•${NC} .env.production  not found"
    fi

    echo ""
    echo "Deploy with:"
    echo "  ./scripts/start-k8s.sh --local"
    echo "  ./scripts/start-k8s.sh --production"
    exit 0
fi

TARGET_ENV="$1"
if [ "$TARGET_ENV" != "local" ] && [ "$TARGET_ENV" != "production" ]; then
    echo -e "${RED}Invalid environment: ${TARGET_ENV}${NC}"
    show_usage
fi

TARGET_FILE=".env.local"
TARGET_NODE_ENV="local"
if [ "$TARGET_ENV" = "production" ]; then
    TARGET_FILE=".env.production"
    TARGET_NODE_ENV="production"
fi

if [ ! -f "$TARGET_FILE" ]; then
    echo -e "${RED}✗ ${TARGET_FILE} not found${NC}"
    echo "Run: ./scripts/start-k8s.sh --setup --${TARGET_ENV}"
    exit 1
fi

ensure_node_env "$TARGET_FILE" "$TARGET_NODE_ENV"
echo -e "${GREEN}✓ Updated ${TARGET_FILE}: NODE_ENV=${TARGET_NODE_ENV}${NC}"
echo "Start with: ./scripts/start-k8s.sh --${TARGET_ENV}"
