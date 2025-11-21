#!/bin/bash
set -e

# Parse command line flags
DAEMON_MODE=false
STOP_MODE=false
ENV_FLAG=""
PID_DIR="/tmp/grace-ai-k8s"

# First pass: check for unknown flags
for arg in "$@"; do
    case $arg in
        --daemon|-d|--stop|--help|-h|--local|--production)
            # Known flags
            ;;
        -*)
            echo "Error: Unknown flag '$arg'"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --local         Run in local development mode (LiveKit in K8s) [default]"
            echo "  --production    Run in production mode (external LiveKit)"
            echo "  --daemon, -d    Run in background (survives SSH logout)"
            echo "  --stop          Stop background services"
            echo "  --help, -h      Show this help message"
            exit 1
            ;;
    esac
done

# Second pass: process flags
for arg in "$@"; do
    case $arg in
        --daemon|-d)
            DAEMON_MODE=true
            ;;
        --stop)
            STOP_MODE=true
            ;;
        --local)
            ENV_FLAG="local"
            ;;
        --production)
            ENV_FLAG="production"
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --local         Run in local development mode (LiveKit in K8s) [default]"
            echo "  --production    Run in production mode (external LiveKit)"
            echo "  --daemon, -d    Run in background (survives SSH logout)"
            echo "  --stop          Stop background services"
            echo "  --help, -h      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                      # Run locally in foreground (default)"
            echo "  $0 --production         # Run in production mode"
            echo "  $0 --daemon             # Run locally in background"
            echo "  $0 --stop               # Stop background services"
            exit 0
            ;;
    esac
done

# Default to local mode if no environment flag specified
if [ -z "$ENV_FLAG" ] && [ "$STOP_MODE" = false ]; then
    ENV_FLAG="local"
fi

# Handle stop mode
if [ "$STOP_MODE" = true ]; then
    echo "🛑 Stopping Grace AI Kubernetes services..."

    # Stop port-forwards
    if [ -f "$PID_DIR/port-forwards.pid" ]; then
        while read pid; do
            kill $pid 2>/dev/null && echo "  ✓ Stopped port-forward (PID: $pid)" || true
        done < "$PID_DIR/port-forwards.pid"
        rm "$PID_DIR/port-forwards.pid"
    fi

    # Stop minikube
    echo "  • Stopping minikube cluster..."
    minikube stop

    echo ""
    echo "✅ All services stopped"
    exit 0
fi

# Force English language for all commands
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Create PID directory
mkdir -p "$PID_DIR"

# Setup logging for daemon mode
if [ "$DAEMON_MODE" = true ]; then
    LOG_FILE="$PID_DIR/grace-ai-k8s.log"
    exec 1> >(tee -a "$LOG_FILE")
    exec 2>&1
    echo "=== Grace AI K8s Deployment - $(date) ==="
fi

# Detect operating system
OS_TYPE=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS_TYPE="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS_TYPE="linux"
else
    echo "Warning: Unknown OS type: $OSTYPE. Assuming Linux."
    OS_TYPE="linux"
fi

# Ensure Docker and other tools are in PATH
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS: Include Homebrew, OrbStack, and util-linux paths
    export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/util-linux/bin:$HOME/.orbstack/bin:$PATH"
else
    # Linux: Use standard paths
    export PATH="/usr/local/bin:/usr/bin:/usr/sbin:$PATH"
fi

# Set Docker socket path based on OS
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS: OrbStack socket
    export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.orbstack/run/docker.sock}"
else
    # Linux: Standard Docker socket
    export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Grace AI - Kubernetes Deployment${NC}"

# Change to script directory
cd "$(dirname "$0")/.."

# ============================================================================
# Load Environment Variables (12-factor app methodology)
# ============================================================================
# Hierarchy: .env (base) -> .env.local (local overrides) -> .env.production (prod overrides)
# Never mutate .env files - configuration via environment only

# Helper function to load env file
load_env_file() {
    local env_file=$1
    local label=$2

    if [ -f "$env_file" ]; then
        echo -e "${BLUE}📋 Loading ${label}: ${env_file}${NC}"
        set -a  # automatically export all variables
        eval "$(grep -v '^#' "$env_file" | grep -v '^$' | sed 's/\r$//')"
        set +a
        return 0
    fi
    return 1
}

# Load base .env (required)
if ! load_env_file ".env" "base configuration"; then
    echo -e "${RED}✗ Error: .env file not found${NC}"
    echo "  Run: cp .env.example .env && nano .env"
    exit 1
fi

# Determine which environment-specific override to load
if [ -n "$ENV_FLAG" ]; then
    export NODE_ENV="$ENV_FLAG"
    echo -e "${BLUE}⚙️  Environment mode set to: ${ENV_FLAG}${NC}"
fi

# Load environment-specific overrides
if [ "$NODE_ENV" = "production" ]; then
    # Production mode: load .env.production if it exists
    load_env_file ".env.production" "production overrides" || true
else
    # Local mode (default): load .env.local if it exists
    export NODE_ENV="local"
    load_env_file ".env.local" "local overrides" || true
fi

echo ""

# Set environment-specific URLs based on NODE_ENV
if [ "$NODE_ENV" = "production" ]; then
    echo -e "${BLUE}🚀 Running in PRODUCTION mode${NC}"
    echo -e "${GREEN}✓ Domain: ${PRODUCTION_DOMAIN}${NC}"

    # Production URLs (custom domains with SSL)
    export PUBLIC_FRONTEND_URL="https://frontend.${PRODUCTION_DOMAIN}"
    export PUBLIC_API_URL="https://backend.${PRODUCTION_DOMAIN}"
    # PUBLIC_LIVEKIT_URL: Read from .env file (required)
    export PUBLIC_DB_HOST="db.${PRODUCTION_DOMAIN}"
    export PUBLIC_DB_PORT="5432"
    export CORS_ORIGIN="https://frontend.${PRODUCTION_DOMAIN}"
else
    echo -e "${BLUE}🏠 Running in LOCAL mode${NC}"

    # Local URLs
    export NODE_ENV="local"
    export PUBLIC_FRONTEND_URL="http://localhost:8080"
    export PUBLIC_API_URL="http://localhost:3000"
    # PUBLIC_LIVEKIT_URL: Read from .env file (required)
    export PUBLIC_DB_HOST="localhost"
    export PUBLIC_DB_PORT="5432"
    export CORS_ORIGIN="http://localhost:8080"
fi

# ============================================================================
# Set Hardcoded Defaults (non-configurable)
# ============================================================================
# These values don't need to be in .env files - they're set automatically

# Backend port (always 3000)
export PORT=3000

# Kubernetes configuration
export KUBERNETES_NAMESPACE="${KUBERNETES_NAMESPACE:-ai-agents}"
export AGENT_IMAGE="${AGENT_IMAGE:-conversational-ai-server:latest}"
export AGENT_IMAGE_PULL_POLICY="${AGENT_IMAGE_PULL_POLICY:-IfNotPresent}"

# Legacy compatibility
export PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-localhost}"
export ENABLE_NETWORK_ACCESS="${ENABLE_NETWORK_ACCESS:-false}"

# Frontend configuration
export VITE_USE_INPAGE_MOCK="${VITE_USE_INPAGE_MOCK:-0}"

# Python Agent - Connection defaults
export ROOM_NAME="${ROOM_NAME:-voice-ai-room}"
export IDENTITY="${IDENTITY:-python-listener}"

# Python Agent - STT defaults
export WHISPER_DEVICE="${WHISPER_DEVICE:-cpu}"
export WHISPER_COMPUTE_TYPE="${WHISPER_COMPUTE_TYPE:-int8}"
export WHISPER_BEAM_SIZE="${WHISPER_BEAM_SIZE:-1}"
export WHISPER_WORD_TIMESTAMPS="${WHISPER_WORD_TIMESTAMPS:-false}"
export VAD_MIN_SPEECH_MS="${VAD_MIN_SPEECH_MS:-250}"
export VAD_MIN_SILENCE_MS="${VAD_MIN_SILENCE_MS:-500}"
export ENABLE_STREAMING_CHUNKS="${ENABLE_STREAMING_CHUNKS:-true}"
export CHUNK_LENGTH_MS="${CHUNK_LENGTH_MS:-1000}"
export PARTIAL_TRANSCRIPT_INTERVAL_MS="${PARTIAL_TRANSCRIPT_INTERVAL_MS:-1000}"

# Python Agent - TTS defaults
export ELEVENLABS_STABILITY="${ELEVENLABS_STABILITY:-0.5}"
export ELEVENLABS_SIMILARITY_BOOST="${ELEVENLABS_SIMILARITY_BOOST:-0.8}"
export ELEVENLABS_STYLE="${ELEVENLABS_STYLE:-0.0}"
export ELEVENLABS_USE_SPEAKER_BOOST="${ELEVENLABS_USE_SPEAKER_BOOST:-true}"
export KOKORO_MODEL_PATH="${KOKORO_MODEL_PATH:-./kokoro-models/kokoro-v1.0.onnx}"
export KOKORO_VOICES_PATH="${KOKORO_VOICES_PATH:-./kokoro-models/voices-v1.0.bin}"
export KOKORO_CACHE_DIR="${KOKORO_CACHE_DIR:-/root/.cache/kokoro}"

# Python Agent - Barge-in defaults
export MIN_INTERRUPTION_DURATION="${MIN_INTERRUPTION_DURATION:-0.5}"
export MIN_INTERRUPTION_WORDS="${MIN_INTERRUPTION_WORDS:-1}"
export FALSE_INTERRUPTION_TIMEOUT="${FALSE_INTERRUPTION_TIMEOUT:-2.0}"

# TTS Provider default
export TTS_PROVIDER="${TTS_PROVIDER:-opensource}"

# TURN defaults
export LIVEKIT_TURN_ENABLED="${LIVEKIT_TURN_ENABLED:-false}"
export LIVEKIT_TURN_DOMAIN="${LIVEKIT_TURN_DOMAIN:-localhost}"

echo -e "${GREEN}Environment Configuration:${NC}"
echo -e "  Frontend:  ${PUBLIC_FRONTEND_URL}"
echo -e "  Backend:   ${PUBLIC_API_URL}"
echo -e "  LiveKit:   ${PUBLIC_LIVEKIT_URL}"
echo -e "  Database:  ${PUBLIC_DB_HOST}:${PUBLIC_DB_PORT}"
if [ "$LIVEKIT_TURN_ENABLED" = "true" ]; then
    echo -e "  TURN:      enabled (domain: ${LIVEKIT_TURN_DOMAIN})"
else
    echo -e "  TURN:      disabled"
fi
echo ""

# Validate required environment variables
if [ -z "$OPENAI_API_KEY" ] || [ -z "$POSTGRES_DB" ] || [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ]; then
    echo -e "${RED}✗ Missing required environment variables in .env${NC}"
    [ -z "$OPENAI_API_KEY" ] && echo "  - OPENAI_API_KEY"
    [ -z "$POSTGRES_DB" ] && echo "  - POSTGRES_DB"
    [ -z "$POSTGRES_USER" ] && echo "  - POSTGRES_USER"
    [ -z "$POSTGRES_PASSWORD" ] && echo "  - POSTGRES_PASSWORD"
    exit 1
fi

# Validate LiveKit configuration
LIVEKIT_VALIDATION_FAILED=false

if [ -z "$LIVEKIT_API_KEY" ] || [ -z "$LIVEKIT_API_SECRET" ]; then
    echo -e "${RED}✗ Missing required LiveKit API credentials${NC}"
    [ -z "$LIVEKIT_API_KEY" ] && echo "  - LIVEKIT_API_KEY"
    [ -z "$LIVEKIT_API_SECRET" ] && echo "  - LIVEKIT_API_SECRET"
    LIVEKIT_VALIDATION_FAILED=true
fi

if [ -z "$LIVEKIT_URL" ] || [ -z "$PUBLIC_LIVEKIT_URL" ]; then
    echo -e "${RED}✗ Missing required LiveKit URL configuration${NC}"
    [ -z "$LIVEKIT_URL" ] && echo "  - LIVEKIT_URL (e.g., ws://localhost:7880 or wss://livekit.example.com)"
    [ -z "$PUBLIC_LIVEKIT_URL" ] && echo "  - PUBLIC_LIVEKIT_URL (e.g., ws://localhost:7880 or wss://livekit.example.com)"
    LIVEKIT_VALIDATION_FAILED=true
fi

if [ -z "$LIVEKIT_TURN_ENABLED" ]; then
    echo -e "${RED}✗ Missing required LiveKit TURN configuration${NC}"
    echo "  - LIVEKIT_TURN_ENABLED (true or false)"
    LIVEKIT_VALIDATION_FAILED=true
fi

# Validate TURN domain if TURN is enabled
if [ "$LIVEKIT_TURN_ENABLED" = "true" ] && [ -z "$LIVEKIT_TURN_DOMAIN" ]; then
    echo -e "${RED}✗ LIVEKIT_TURN_ENABLED is true but LIVEKIT_TURN_DOMAIN is not set${NC}"
    echo "  - LIVEKIT_TURN_DOMAIN (e.g., livekit-turn.example.com)"
    LIVEKIT_VALIDATION_FAILED=true
fi

if [ "$LIVEKIT_VALIDATION_FAILED" = true ]; then
    echo ""
    if [ "$NODE_ENV" = "production" ]; then
        echo -e "${YELLOW}💡 Configure these in .env.production${NC}"
    else
        echo -e "${YELLOW}💡 Configure these in .env.local for local development${NC}"
        echo -e "${YELLOW}   or in .env for production defaults${NC}"
    fi
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not running${NC}"
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -e "${YELLOW}💡 On Linux, you may need to:${NC}"
        echo -e "   1. Start Docker: sudo systemctl start docker"
        echo -e "   2. Add your user to docker group: sudo usermod -aG docker \$USER"
        echo -e "   3. Log out and back in for group changes to take effect"
    fi
    exit 1
fi

# Check Docker permissions on Linux
if [[ "$OS_TYPE" == "linux" ]]; then
    if ! groups | grep -q docker; then
        echo -e "${YELLOW}⚠️  Warning: Your user is not in the 'docker' group${NC}"
        echo -e "${YELLOW}   You may encounter permission issues.${NC}"
        echo -e "${YELLOW}   To fix: sudo usermod -aG docker \$USER && newgrp docker${NC}"
        echo ""
    fi
fi

# Check if required ports are available (standard ports used by kubectl port-forward)
# In production: postgres uses port 15432 (nginx uses 5432 for external access)
# In local: postgres uses port 5432 (no nginx conflict)
if [ "$NODE_ENV" = "production" ]; then
    REQUIRED_PORTS=(8080 3000 15432)
else
    REQUIRED_PORTS=(8080 3000 5432)
fi
PORTS_IN_USE=()

for port in "${REQUIRED_PORTS[@]}"; do
    PORT_IN_USE=false
    PROCESS_INFO=""

    if [[ "$OS_TYPE" == "macos" ]]; then
        # macOS: Use lsof
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            PORT_IN_USE=true
            PROCESS_INFO=$(lsof -Pi :$port -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1 " (PID: " $2 ")"}')
        fi
    else
        # Linux: Try ss first, fallback to lsof if available
        if command -v ss &> /dev/null; then
            if ss -tlnp 2>/dev/null | grep -q ":$port "; then
                PORT_IN_USE=true
                PROCESS_INFO=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)
                if [ -n "$PROCESS_INFO" ]; then
                    PROCESS_NAME=$(ps -p $PROCESS_INFO -o comm= 2>/dev/null || echo "unknown")
                    PROCESS_INFO="$PROCESS_NAME (PID: $PROCESS_INFO)"
                fi
            fi
        elif command -v lsof &> /dev/null; then
            if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
                PORT_IN_USE=true
                PROCESS_INFO=$(lsof -Pi :$port -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1 " (PID: " $2 ")"}')
            fi
        fi
    fi

    if [ "$PORT_IN_USE" = true ]; then
        PORTS_IN_USE+=($port)
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
    if [[ "$OS_TYPE" == "macos" ]]; then
        brew install minikube
    elif [[ "$OS_TYPE" == "linux" ]]; then
        # Download and install minikube for Linux
        MINIKUBE_VERSION=$(curl -s https://api.github.com/repos/kubernetes/minikube/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
        curl -LO "https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64"
        sudo install minikube-linux-amd64 /usr/local/bin/minikube
        rm minikube-linux-amd64
        echo -e "${GREEN}✓ Minikube installed${NC}"
    else
        echo -e "${RED}✗ Unable to auto-install minikube on this platform${NC}"
        echo -e "${YELLOW}Visit: https://minikube.sigs.k8s.io/docs/start/${NC}"
        exit 1
    fi
fi

if ! command -v kubectl &> /dev/null; then
    echo -e "${YELLOW}Installing kubectl...${NC}"
    if [[ "$OS_TYPE" == "macos" ]]; then
        brew install kubectl
    elif [[ "$OS_TYPE" == "linux" ]]; then
        # Download and install kubectl for Linux
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        chmod +x kubectl
        sudo mv kubectl /usr/local/bin/kubectl
        echo -e "${GREEN}✓ kubectl installed${NC}"
    else
        echo -e "${RED}✗ Unable to auto-install kubectl on this platform${NC}"
        echo -e "${YELLOW}Visit: https://kubernetes.io/docs/tasks/tools/${NC}"
        exit 1
    fi
fi

# Check if setsid is available (required for Docker build output capture)
SETSID_CMD="setsid"
if ! command -v setsid &> /dev/null; then
    echo -e "${YELLOW}⚠️  setsid not found (required for proper build output handling)${NC}"
    if [[ "$OS_TYPE" == "macos" ]]; then
        echo -e "${YELLOW}Installing util-linux (includes setsid)...${NC}"
        brew install util-linux
        echo -e "${GREEN}✓ util-linux installed${NC}"
        # After installation, check if setsid is now available
        if ! command -v setsid &> /dev/null; then
            echo -e "${RED}✗ setsid still not found after installation${NC}"
            echo -e "${YELLOW}Try running: export PATH=\"/opt/homebrew/opt/util-linux/bin:\$PATH\"${NC}"
            exit 1
        fi
    elif [[ "$OS_TYPE" == "linux" ]]; then
        # On Linux, setsid should be part of util-linux (core package)
        echo -e "${RED}✗ setsid not found but should be part of util-linux${NC}"
        echo -e "${YELLOW}Try: sudo apt-get install util-linux (Debian/Ubuntu)${NC}"
        echo -e "${YELLOW}     sudo yum install util-linux (RHEL/CentOS)${NC}"
        exit 1
    fi
fi

# Start minikube if not running
echo -e "${GREEN}⚙️  Starting minikube...${NC}"

# Check if minikube is already running
MINIKUBE_RUNNING=$(minikube status 2>/dev/null | grep -q "Running" && echo "yes" || echo "no")

if [ "$MINIKUBE_RUNNING" = "no" ]; then
    # Minikube needs to be started (but NOT deleted automatically)
    # Start minikube with standard configuration
    # Note: LiveKit runs in Docker on host (not in K8s cluster)
    # Production uses ClusterIP services with port-forward (no NodePorts needed)
    echo -e "${YELLOW}⚠️  Minikube not running. Starting minikube...${NC}"
    minikube start --driver=docker --cpus=4 --memory=8192
    echo -e "${GREEN}✓ Minikube started${NC}"
else
    echo -e "${GREEN}✓ Minikube already running${NC}"
fi

# Configure environment
minikube addons enable metrics-server 2>/dev/null
minikube addons enable dashboard 2>/dev/null
kubectl config use-context minikube > /dev/null 2>&1
eval $(minikube docker-env)

# LiveKit is provided externally - just use the URL from .env
echo -e "${GREEN}📡 Using LiveKit server: ${PUBLIC_LIVEKIT_URL}${NC}"

# Detect if BuildKit/buildx is available
USE_BUILDKIT=false
if docker buildx version > /dev/null 2>&1; then
    USE_BUILDKIT=true
    echo -e "${GREEN}✓ BuildKit available, using optimized builds${NC}"
else
    echo -e "${YELLOW}⚠️  BuildKit not available${NC}"

    # Auto-install on Linux
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -e "${YELLOW}Installing docker-buildx...${NC}"

        # Temporarily disable exit on error
        set +e

        # Method 1: Try package installation first
        INSTALL_RESULT=$(sudo apt-get install -y docker-buildx-plugin 2>&1)
        INSTALL_EXIT_CODE=$?

        # Check if package install worked
        if [ $INSTALL_EXIT_CODE -eq 0 ] && docker buildx version > /dev/null 2>&1; then
            USE_BUILDKIT=true
            echo -e "${GREEN}✓ BuildKit installed via apt package${NC}"
        # Method 2: Package not found, try manual installation
        elif echo "$INSTALL_RESULT" | grep -q "Unable to locate package"; then
            echo -e "${YELLOW}   Package not available, trying manual installation...${NC}"

            # Create docker CLI plugins directory
            mkdir -p ~/.docker/cli-plugins

            # Download buildx binary
            BUILDX_VERSION=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
            curl -sL "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-amd64" -o ~/.docker/cli-plugins/docker-buildx
            chmod +x ~/.docker/cli-plugins/docker-buildx

            # Verify installation
            if docker buildx version > /dev/null 2>&1; then
                USE_BUILDKIT=true
                echo -e "${GREEN}✓ BuildKit installed manually (v${BUILDX_VERSION})${NC}"
            else
                echo -e "${YELLOW}⚠️  Manual installation failed, using legacy build mode${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  BuildKit installation failed (exit code: $INSTALL_EXIT_CODE)${NC}"
            echo -e "${YELLOW}   Using legacy build mode${NC}"
        fi

        # Re-enable exit on error
        set -e
    else
        echo -e "${YELLOW}⚠️  Using legacy build mode (install docker-buildx for better performance)${NC}"
    fi
fi

# Function to build Docker images with live progress preview
build_with_progress() {
    local IMAGE_NAME=$1
    local TAG=$2
    local CONTEXT=$3
    local USE_BUILDKIT=$4

    local LOG_FILE="/tmp/docker-build-${IMAGE_NAME}.log"

    echo "  • ${IMAGE_NAME}..."

    # Run docker build in background and capture output
    # Use setsid to detach from controlling terminal, preventing BuildKit from writing to /dev/tty
    if [ "$USE_BUILDKIT" = true ]; then
        $SETSID_CMD env DOCKER_BUILDKIT=1 docker build --progress=plain --build-arg BUILDKIT_STEP_TIMEOUT=3600 --network=host -t "${TAG}" "${CONTEXT}" > "${LOG_FILE}" 2>&1 &
    else
        $SETSID_CMD docker build --network=host -t "${TAG}" "${CONTEXT}" > "${LOG_FILE}" 2>&1 &
    fi

    local BUILD_PID=$!

    # Show last 6 lines of build output, updating in place
    local LINE_COUNT=0
    local LAST_LINES=""

    # Wait a moment for log file to be created and have content
    sleep 1

    while kill -0 $BUILD_PID 2>/dev/null; do
        if [ -f "${LOG_FILE}" ]; then
            # Get last 6 non-empty lines
            LAST_LINES=$(tail -n 6 "${LOG_FILE}" 2>/dev/null | grep -v "^$" | sed 's/^/    /')

            # Only update display if we have content
            if [ -n "$LAST_LINES" ]; then
                # Clear previous lines if we had any
                if [ $LINE_COUNT -gt 0 ]; then
                    for i in $(seq 1 $LINE_COUNT); do
                        echo -ne "\033[1A\033[2K"  # Move up and clear line
                    done
                fi

                # Print new lines using printf to avoid extra newline
                printf "%s\n" "$LAST_LINES"

                # Count actual lines (not newlines)
                LINE_COUNT=$(printf "%s\n" "$LAST_LINES" | wc -l | tr -d ' ')
            fi
        fi
        sleep 0.5
    done

    # Wait for build to complete and get exit code
    wait $BUILD_PID
    local EXIT_CODE=$?

    # Clear progress lines AND the service name line (LINE_COUNT + 1 total lines)
    local TOTAL_LINES=$((LINE_COUNT + 1))
    for i in $(seq 1 $TOTAL_LINES); do
        echo -ne "\033[1A\033[2K"
    done

    # Show final status (replaces the original service name line)
    if [ $EXIT_CODE -eq 0 ]; then
        echo -e "  • ${IMAGE_NAME}... ${GREEN}✓${NC}"
    else
        echo -e "  • ${IMAGE_NAME}... ${RED}✗${NC}"
        echo -e "${RED}Build failed. See log: ${LOG_FILE}${NC}"
    fi

    # Clean up log file on success
    if [ $EXIT_CODE -eq 0 ]; then
        rm -f "${LOG_FILE}"
    fi

    return $EXIT_CODE
}

# Build Docker images
echo -e "${GREEN}🔨 Building Docker images...${NC}"

build_with_progress "session-management-server" "session-management-server:latest" "." "$USE_BUILDKIT"
build_with_progress "conversational-ai-server" "conversational-ai-server:latest" "./conversational-ai-server-python" "$USE_BUILDKIT"
build_with_progress "frontend-ui" "frontend-ui:latest" "./frontend-ui" "$USE_BUILDKIT"
build_with_progress "message-recorder" "message-recorder-python:latest" "./message-recorder-python" "$USE_BUILDKIT"

# Detect network IP for public URLs
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS: Use ifconfig
    NETWORK_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
else
    # Linux: Use hostname -I (simpler and more reliable)
    NETWORK_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

    # Fallback to ip command if hostname -I fails
    if [ -z "$NETWORK_IP" ]; then
        NETWORK_IP=$(ip addr show | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | cut -d'/' -f1 | head -1)
    fi
fi

echo -e "${GREEN}📡 Detected network IP: ${NETWORK_IP}${NC}"

# Inject environment variables into ConfigMaps using envsubst
echo -n "  • Updating ConfigMaps with environment variables... "
envsubst < k8s/04-configmap.yaml > /tmp/04-configmap-updated.yaml
echo -e "${GREEN}✓${NC}"

# Note: LiveKit API key verification skipped - using external LiveKit server
# The external server is pre-configured with its own API keys

# Deploy to Kubernetes
echo -e "${GREEN}☸️  Deploying to Kubernetes...${NC}"
kubectl apply -f k8s/00-namespace.yaml > /dev/null
kubectl apply -f k8s/01-postgres-config.yaml > /dev/null 2>&1 || true
kubectl apply -f k8s/01-postgres.yaml > /dev/null
kubectl apply -f k8s/03-secrets.yaml > /dev/null
kubectl apply -f /tmp/04-configmap-updated.yaml > /dev/null
kubectl apply -f k8s/05-rbac.yaml > /dev/null
kubectl apply -f k8s/06-message-recorder.yaml > /dev/null
kubectl apply -f k8s/06-session-management-server.yaml > /dev/null
kubectl apply -f k8s/07-frontend-ui.yaml > /dev/null

# Apply NodePort services for local development only
# Production uses ClusterIP services (already created) + port-forward
if [ "$NODE_ENV" != "production" ]; then
    echo -e "${BLUE}  • Applying NodePort services for local development...${NC}"
    kubectl apply -f k8s/local/ > /dev/null 2>&1 || echo -e "${YELLOW}    (NodePort services may already exist)${NC}"
fi

# Create secrets
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
kubectl create secret generic grace-ai-secrets -n ai-agents \
  --from-literal=postgres-db="$POSTGRES_DB" \
  --from-literal=postgres-user="$POSTGRES_USER" \
  --from-literal=postgres-password="$POSTGRES_PASSWORD" \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=openai-api-key="$OPENAI_API_KEY" \
  --from-literal=jwt-secret="$JWT_SECRET" \
  --from-literal=livekit-api-key="$LIVEKIT_API_KEY" \
  --from-literal=livekit-api-secret="$LIVEKIT_API_SECRET" \
  --from-literal=livekit-webhook-secret="$LIVEKIT_WEBHOOK_SECRET" \
  --from-literal=elevenlabs-api-key="${ELEVENLABS_API_KEY:-}" \
  --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# Wait for services
echo -n "  • Waiting for PostgreSQL... "
kubectl wait --for=condition=ready pod -l app=postgres -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

# LiveKit: Using external server
echo -e "  • LiveKit: Using external server (${PUBLIC_LIVEKIT_URL}) ${GREEN}✓${NC}"

# Restart deployments
kubectl rollout restart deployment session-management-server -n ai-agents > /dev/null 2>&1
kubectl rollout restart deployment frontend-ui -n ai-agents > /dev/null 2>&1

echo -n "  • Waiting for backend... "
kubectl rollout status deployment/session-management-server -n ai-agents --timeout=180s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

echo -n "  • Waiting for frontend... "
kubectl rollout status deployment/frontend-ui -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"


# Start port-forwards
# Create port-forwards for all services:
#   - Frontend: localhost:8080
#   - Backend: localhost:3000
#   - Database: localhost:5432
# In production, Caddy proxies external HTTPS traffic to these localhost ports
echo -e "${GREEN}🌐 Setting up port forwards...${NC}"

if [ "$DAEMON_MODE" = true ]; then
    # Daemon mode: Use nohup and save PIDs
    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/frontend-ui 8080:8080 > "$PID_DIR/pf-frontend.log" 2>&1 &
    PF_FRONTEND=$!

    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/session-management-server 3000:3000 > "$PID_DIR/pf-backend.log" 2>&1 &
    PF_BACKEND=$!

    # PostgreSQL port-forward (5432 for both local and production)
    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 5432:5432 > "$PID_DIR/pf-postgres.log" 2>&1 &
    PF_POSTGRES=$!

    # Save PIDs to file
    echo "$PF_FRONTEND" > "$PID_DIR/port-forwards.pid"
    echo "$PF_BACKEND" >> "$PID_DIR/port-forwards.pid"
    echo "$PF_POSTGRES" >> "$PID_DIR/port-forwards.pid"

    # Detach from session
    disown -a
else
    # Foreground mode: Normal background processes
    kubectl port-forward -n ai-agents --address 127.0.0.1 svc/frontend-ui 8080:8080 > /dev/null 2>&1 &
    PF_FRONTEND=$!

    kubectl port-forward -n ai-agents --address 127.0.0.1 svc/session-management-server 3000:3000 > /dev/null 2>&1 &
    PF_BACKEND=$!

    # PostgreSQL port-forward (5432 for both local and production)
    kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 5432:5432 > /dev/null 2>&1 &
    PF_POSTGRES=$!
fi

echo -e "${GREEN}✓ Port forwards started${NC}"

# Give port forwards a moment to initialize
sleep 2

# Cleanup function to stop all services (only for foreground mode)
if [ "$DAEMON_MODE" = false ]; then
  cleanup() {
    echo ""
    echo ""
    echo -e "${YELLOW}🛑 Stopping all services...${NC}"
    echo ""

    # Kill port-forward processes
    echo -e "${BLUE}Stopping port forwards...${NC}"
    [ ! -z "$PF_FRONTEND" ] && kill $PF_FRONTEND 2>/dev/null
    [ ! -z "$PF_BACKEND" ] && kill $PF_BACKEND 2>/dev/null
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

  # Trap SIGINT (Ctrl+C) and SIGTERM in foreground mode only
  trap cleanup SIGINT SIGTERM
fi

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo -e "${BLUE}🌐 Services accessible at:${NC}"
echo ""
echo -e "  ${GREEN}Frontend:${NC}  ${PUBLIC_FRONTEND_URL}"
echo -e "  ${GREEN}Backend:${NC}   ${PUBLIC_API_URL}"
echo -e "  ${GREEN}LiveKit:${NC}   ${PUBLIC_LIVEKIT_URL}"
echo -e "  ${GREEN}Database:${NC}  ${PUBLIC_DB_HOST}:${PUBLIC_DB_PORT}"
echo ""
echo -e "${BLUE}🔐 Database Credentials:${NC}"
echo -e "  ${GREEN}Database:${NC}   ${POSTGRES_DB}"
echo -e "  ${GREEN}Username:${NC}   ${POSTGRES_USER}"
echo -e "  ${GREEN}Password:${NC}   ${POSTGRES_PASSWORD}"
echo ""
echo -e "  ${YELLOW}Internal (used by services):${NC}"
echo -e "    postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
echo ""
if [ "$NODE_ENV" = "production" ]; then
    echo -e "  ${YELLOW}External (production):${NC}"
    echo -e "    postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${PUBLIC_DB_HOST}:${PUBLIC_DB_PORT}/${POSTGRES_DB}"
else
    echo -e "  ${YELLOW}External (via port-forward):${NC}"
    echo -e "    postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${PUBLIC_DB_HOST}:${PUBLIC_DB_PORT}/${POSTGRES_DB}"
fi
echo ""

# Add note about external LiveKit
echo -e "${BLUE}📡 Notes:${NC}"
echo -e "  ${YELLOW}• LiveKit: ${PUBLIC_LIVEKIT_URL} (external)${NC}"
echo -e "  ${YELLOW}• Services exposed via port-forward (8080, 3000, 5432)${NC}"
if [ "$NODE_ENV" = "production" ]; then
    echo -e "  ${YELLOW}• Caddy proxies HTTPS traffic to localhost ports${NC}"
fi
echo ""

if [ "$DAEMON_MODE" = true ]; then
    # Daemon mode: Show status and exit
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✨ Services running in background${NC}"
    echo -e "${YELLOW}📝 Logs: $LOG_FILE${NC}"
    echo -e "${YELLOW}🛑 Stop: ./scripts/start-k8s.sh --stop${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Port-forward PIDs saved to: $PID_DIR/port-forwards.pid"
    echo "Services will continue running after SSH logout."
    echo ""
else
    # Foreground mode: Keep script running
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✨ Services are running${NC}"
    echo -e "${RED}⚠️  Press Ctrl+C to stop all services and shutdown minikube${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Keep script running
    tail -f /dev/null
fi
