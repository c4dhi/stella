#!/bin/bash
set -e

# ============================================================================
# Fix permissions on project files (handles issues after moving/copying)
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Ensure all scripts are executable
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

# Ensure Python scripts are executable
find "$PROJECT_DIR" -name "*.py" -path "*/scripts/*" -exec chmod +x {} \; 2>/dev/null || true

# Ensure download scripts in services are executable
chmod +x "$PROJECT_DIR"/stt-service/*.py 2>/dev/null || true
chmod +x "$PROJECT_DIR"/tts-service/*.py 2>/dev/null || true

# Parse command line flags
DAEMON_MODE=false
STOP_MODE=false
REBUILD_MODE=false
RESET_DB_MODE=false
SKIP_BUILD_MODE=false
ENV_FLAG=""

# Configurable temp directory for build artifacts and logs
# Set GRACE_AI_TEMP_DIR in .env to use a different volume (e.g., /mnt/grace-ai-temp)
# This is useful when root filesystem has limited space
# Pre-load GRACE_AI_TEMP_DIR from env files before setting up logging
# This ensures logs and temp files go to the correct volume from the start
# Hierarchy: .env (base) -> .env.local or .env.production (overrides)
SCRIPT_DIR_FOR_ENV="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR_FOR_ENV="$(dirname "$SCRIPT_DIR_FOR_ENV")"

# Detect OS early for temp directory validation
EARLY_OS_TYPE=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    EARLY_OS_TYPE="macos"
else
    EARLY_OS_TYPE="linux"
fi

# Load base .env first
if [ -f "$PROJECT_DIR_FOR_ENV/.env" ]; then
    GRACE_AI_TEMP_DIR_FROM_ENV=$(grep -E "^GRACE_AI_TEMP_DIR=" "$PROJECT_DIR_FOR_ENV/.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    [ -n "$GRACE_AI_TEMP_DIR_FROM_ENV" ] && export GRACE_AI_TEMP_DIR="$GRACE_AI_TEMP_DIR_FROM_ENV"
fi

# Check for --production flag to determine which override file to use
EARLY_ENV_FLAG=""
for arg in "$@"; do
    case $arg in
        --production) EARLY_ENV_FLAG="production" ;;
        --local) EARLY_ENV_FLAG="local" ;;
    esac
done

# Load override: .env.production if --production, otherwise .env.local
if [ "$EARLY_ENV_FLAG" = "production" ] && [ -f "$PROJECT_DIR_FOR_ENV/.env.production" ]; then
    GRACE_AI_TEMP_DIR_FROM_ENV=$(grep -E "^GRACE_AI_TEMP_DIR=" "$PROJECT_DIR_FOR_ENV/.env.production" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    [ -n "$GRACE_AI_TEMP_DIR_FROM_ENV" ] && export GRACE_AI_TEMP_DIR="$GRACE_AI_TEMP_DIR_FROM_ENV"
elif [ -f "$PROJECT_DIR_FOR_ENV/.env.local" ]; then
    GRACE_AI_TEMP_DIR_FROM_ENV=$(grep -E "^GRACE_AI_TEMP_DIR=" "$PROJECT_DIR_FOR_ENV/.env.local" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    [ -n "$GRACE_AI_TEMP_DIR_FROM_ENV" ] && export GRACE_AI_TEMP_DIR="$GRACE_AI_TEMP_DIR_FROM_ENV"
fi

# Set TEMP_DIR with fallback to /tmp
TEMP_DIR="${GRACE_AI_TEMP_DIR:-/tmp}"

# Validate temp directory is accessible (macOS doesn't have /mnt)
if [ -n "$GRACE_AI_TEMP_DIR" ] && [ "$GRACE_AI_TEMP_DIR" != "/tmp" ]; then
    # Check if parent directory exists and is writable
    TEMP_PARENT_DIR=$(dirname "$GRACE_AI_TEMP_DIR")
    if [ ! -d "$TEMP_PARENT_DIR" ] || [ ! -w "$TEMP_PARENT_DIR" ]; then
        echo "Note: GRACE_AI_TEMP_DIR=$GRACE_AI_TEMP_DIR not accessible, using /tmp"
        TEMP_DIR="/tmp"
        unset GRACE_AI_TEMP_DIR
    fi
fi
PID_DIR="${TEMP_DIR}/grace-ai-k8s"

# First pass: check for unknown flags
for arg in "$@"; do
    case $arg in
        --daemon|-d|--stop|--help|-h|--local|--production|--rebuild|--reset-db|--skip-build)
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
            echo "  --rebuild       Force clean rebuild (deletes pods, images, rebuilds without cache)"
            echo "  --reset-db      Reset database (use with --rebuild to also reset postgres)"
            echo "  --skip-build    Skip building images (just restart pods with existing images)"
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
        --rebuild)
            REBUILD_MODE=true
            ;;
        --reset-db)
            RESET_DB_MODE=true
            ;;
        --skip-build)
            SKIP_BUILD_MODE=true
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
            echo "  --rebuild       Force clean rebuild (deletes pods, images, rebuilds without cache)"
            echo "  --reset-db      Reset database (use with --rebuild to also reset postgres)"
            echo "  --skip-build    Skip building images (just restart pods with existing images)"
            echo "  --daemon, -d    Run in background (survives SSH logout)"
            echo "  --stop          Stop background services"
            echo "  --help, -h      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                      # Run locally, auto-detect changed services"
            echo "  $0 --production         # Run in production mode"
            echo "  $0 --rebuild            # Clean rebuild all services (keeps database)"
            echo "  $0 --rebuild --reset-db # Clean rebuild including database"
            echo "  $0 --skip-build         # Restart pods without rebuilding (fast restart)"
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

# Detect operating system (must be done early for stop mode)
OS_TYPE=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS_TYPE="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS_TYPE="linux"
else
    echo "Warning: Unknown OS type: $OSTYPE. Assuming Linux."
    OS_TYPE="linux"
fi

# Handle stop mode
if [ "$STOP_MODE" = true ]; then
    echo "🛑 Stopping Grace AI Kubernetes services..."

    # Stop port-forwards using daemon script if available
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PORT_FORWARD_DAEMON="$SCRIPT_DIR/port-forward-daemon.sh"

    if [ -x "$PORT_FORWARD_DAEMON" ]; then
        "$PORT_FORWARD_DAEMON" stop
    elif [ -f "$PID_DIR/port-forwards.pid" ]; then
        # Fallback to PID-based cleanup
        while read pid; do
            kill $pid 2>/dev/null && echo "  ✓ Stopped port-forward (PID: $pid)" || true
        done < "$PID_DIR/port-forwards.pid"
        rm "$PID_DIR/port-forwards.pid"
    fi

    # Stop K3s cluster (Linux only - macOS K3s managed by Rancher Desktop/Colima)
    if [[ "$OS_TYPE" == "linux" ]]; then
        if command -v k3s &> /dev/null && sudo systemctl is-active --quiet k3s; then
            echo "  • Stopping K3s cluster..."
            sudo systemctl stop k3s
        else
            echo "  • No K3s cluster found to stop"
        fi
    else
        echo "  • K3s managed by Rancher Desktop/Colima (not stopped)"
    fi

    echo ""
    echo "✅ All services stopped"
    echo ""
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

# Update TEMP_DIR after loading env files (GRACE_AI_TEMP_DIR may be set in .env)
# This allows using a separate volume for build artifacts when disk space is limited
TEMP_DIR="${GRACE_AI_TEMP_DIR:-/tmp}"
PID_DIR="${TEMP_DIR}/grace-ai-k8s"

# Create temp directory if it doesn't exist
if [ ! -d "$TEMP_DIR" ]; then
    echo -e "${YELLOW}Creating temp directory: ${TEMP_DIR}${NC}"
    mkdir -p "$TEMP_DIR" || { echo -e "${RED}Failed to create temp directory: ${TEMP_DIR}${NC}"; exit 1; }
fi
mkdir -p "$PID_DIR"

echo ""

# Set environment-specific URLs based on NODE_ENV
if [ "$NODE_ENV" = "production" ]; then
    echo -e "${BLUE}🚀 Running in PRODUCTION mode${NC}"
    echo -e "${GREEN}✓ Domain: ${PRODUCTION_DOMAIN}${NC}"

    # Production URLs (custom domains with SSL)
    export PUBLIC_FRONTEND_URL="https://frontend.${PRODUCTION_DOMAIN}"
    export PUBLIC_API_URL="https://backend.${PRODUCTION_DOMAIN}"
    export PUBLIC_DB_HOST="db.${PRODUCTION_DOMAIN}"
    export PUBLIC_DB_PORT="5432"
    export CORS_ORIGIN="https://frontend.${PRODUCTION_DOMAIN}"
else
    echo -e "${BLUE}🏠 Running in LOCAL mode${NC}"

    # Local URLs
    export NODE_ENV="local"
    export PUBLIC_FRONTEND_URL="http://localhost:8080"
    export PUBLIC_API_URL="http://localhost:3000"
    export PUBLIC_DB_HOST="localhost"
    export PUBLIC_DB_PORT="5432"
    export CORS_ORIGIN="http://localhost:8080"
fi

# ============================================================================
# LiveKit URL Configuration
# ============================================================================
# Two different URLs for different use cases:
#
# 1. LIVEKIT_URL (Internal - for pods in Kubernetes)
#    - Used by: session-management-server, conversational-ai-server-python, message-recorder-python
#    - Development: ws://host.docker.internal:7880 (pods access host via dynamic discovery)
#    - Production: ws://<HOST_IP>:7880 (direct IP to host running LiveKit)
#    - Read from: .env, .env.local, or .env.production
#
# 2. PUBLIC_LIVEKIT_URL (External - for browsers)
#    - Used by: frontend-ui (browsers/external clients)
#    - Development: ws://localhost:7880 (browser on host via port-forward)
#    - Production: wss://livekit-v1.c4dhi.moserfelix.com (public domain with SSL)
#    - Read from: .env, .env.local, or .env.production
#    - Mapped to: VITE_LIVEKIT_URL for Vite frontend
#
# Both URLs are loaded from .env files above and exported to ConfigMap below

# Map PUBLIC_LIVEKIT_URL to VITE_LIVEKIT_URL for frontend
export VITE_LIVEKIT_URL="${PUBLIC_LIVEKIT_URL}"

echo -e "${GREEN}✓ Internal LiveKit URL (pods): ${LIVEKIT_URL}${NC}"
echo -e "${GREEN}✓ External LiveKit URL (frontend): ${PUBLIC_LIVEKIT_URL}${NC}"

# ============================================================================
# Set Hardcoded Defaults (non-configurable)
# ============================================================================
# These values don't need to be in .env files - they're set automatically

# Backend port (always 3000)
export PORT=3000

# Kubernetes configuration
export KUBERNETES_NAMESPACE="${KUBERNETES_NAMESPACE:-ai-agents}"
# Agent images are now built on-demand when first assigned to a session
# See: AgentImageService in session-management-server
export DEFAULT_AGENT_TYPE="${DEFAULT_AGENT_TYPE:-grace-agent}"
export AGENT_IMAGE_PULL_POLICY="${AGENT_IMAGE_PULL_POLICY:-IfNotPresent}"

# Legacy compatibility
export PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-localhost}"
export ENABLE_NETWORK_ACCESS="${ENABLE_NETWORK_ACCESS:-false}"

# Frontend configuration
export VITE_USE_INPAGE_MOCK="${VITE_USE_INPAGE_MOCK:-0}"

# Python Agent - Connection defaults
export ROOM_NAME="${ROOM_NAME:-voice-ai-room}"
export IDENTITY="${IDENTITY:-python-listener}"

# STT Microservice Provider Selection
# sherpa = lightweight CPU (dev), whisper = GPU-accelerated (prod)
export STT_PROVIDER="${STT_PROVIDER:-sherpa}"

# faster-whisper Configuration (when STT_PROVIDER=whisper)
export WHISPER_MODEL="${WHISPER_MODEL:-large-v3}"
export WHISPER_DEVICE="${WHISPER_DEVICE:-cpu}"
export WHISPER_COMPUTE_TYPE="${WHISPER_COMPUTE_TYPE:-int8}"
export WHISPER_BEAM_SIZE="${WHISPER_BEAM_SIZE:-5}"
export WHISPER_LANGUAGE="${WHISPER_LANGUAGE:-}"  # Empty for auto-detect, 'de' for German

# VAD Configuration (Silero VAD for whisper provider)
export VAD_THRESHOLD="${VAD_THRESHOLD:-0.5}"
export VAD_MIN_SPEECH_MS="${VAD_MIN_SPEECH_MS:-250}"
export VAD_MIN_SILENCE_MS="${VAD_MIN_SILENCE_MS:-500}"
export PARTIAL_INTERVAL_MS="${PARTIAL_INTERVAL_MS:-1000}"

# Legacy Python Agent STT defaults (for backward compatibility)
export WHISPER_WORD_TIMESTAMPS="${WHISPER_WORD_TIMESTAMPS:-false}"
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
export TTS_PROVIDER="${TTS_PROVIDER:-edge_tts}"

# GPU Support Configuration
# Set ENABLE_GPU=true in .env to enable GPU acceleration for STT/TTS services
export ENABLE_GPU="${ENABLE_GPU:-false}"

# ONNX Provider Configuration
# Auto-set based on ENABLE_GPU if not explicitly set
if [ -z "$ONNX_PROVIDER" ]; then
    if [ "$ENABLE_GPU" = "true" ]; then
        export ONNX_PROVIDER="CUDAExecutionProvider,CPUExecutionProvider"
    else
        export ONNX_PROVIDER="CPUExecutionProvider"
    fi
fi

# TURN defaults
export LIVEKIT_TURN_ENABLED="${LIVEKIT_TURN_ENABLED:-false}"
export LIVEKIT_TURN_DOMAIN="${LIVEKIT_TURN_DOMAIN:-localhost}"

echo -e "${GREEN}Environment Configuration:${NC}"
echo -e "  Frontend:  ${PUBLIC_FRONTEND_URL}"
echo -e "  Backend:   ${PUBLIC_API_URL}"
echo -e "  LiveKit (Internal):  ${LIVEKIT_URL}"
echo -e "  LiveKit (Public):    ${PUBLIC_LIVEKIT_URL}"
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
    [ -z "$LIVEKIT_URL" ] && echo "  - LIVEKIT_URL (internal, e.g., ws://host.docker.internal:7880)"
    [ -z "$PUBLIC_LIVEKIT_URL" ] && echo "  - PUBLIC_LIVEKIT_URL (public, e.g., wss://livekit.example.com)"
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

# ============================================================================
# Kubernetes Distribution Selection
# ============================================================================
# Kubernetes Distribution: K3s (Unified for local and production)
# - Lightweight, production-ready Kubernetes
# - Native GPU support (when hardware available)
# - Works on macOS (via Rancher Desktop/Colima) and Linux (native)
K8S_DISTRIBUTION="k3s"

echo -e "${BLUE}🎯 Using K3s (Unified Kubernetes)${NC}"
echo -e "  ${GREEN}✓ Works on all platforms (macOS + Linux)${NC}"
echo -e "  ${GREEN}✓ Production-ready${NC}"
echo -e "  ${GREEN}✓ Native GPU support${NC}"

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

# ============================================================================
# K3s Setup Function
# ============================================================================
setup_k3s() {
    echo -e "${GREEN}⚙️  Setting up K3s...${NC}"

    if [[ "$OS_TYPE" == "macos" ]]; then
        # =====================================================================
        # macOS: K3s runs inside Rancher Desktop or Colima
        # =====================================================================
        echo -e "${BLUE}ℹ️  macOS detected - checking for K3s runtime...${NC}"

        # Check if kubectl is available and can connect to a cluster
        if kubectl cluster-info &> /dev/null; then
            # Get current context
            CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null)

            if [[ "$CURRENT_CONTEXT" == "rancher-desktop" ]] || [[ "$CURRENT_CONTEXT" == *"colima"* ]] || [[ "$CURRENT_CONTEXT" == "orbstack" ]]; then
                echo -e "${GREEN}✓ K3s runtime detected: ${CURRENT_CONTEXT}${NC}"

                # Verify node is ready
                if kubectl get nodes &> /dev/null; then
                    NODE_NAME=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
                    NODE_STATUS=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}')

                    if [ "$NODE_STATUS" = "True" ]; then
                        echo -e "${GREEN}✓ K3s node ready: ${NODE_NAME}${NC}"
                    else
                        echo -e "${YELLOW}⚠️  K3s node not ready yet, waiting...${NC}"
                        kubectl wait --for=condition=Ready node --all --timeout=60s
                    fi
                fi
            else
                echo -e "${RED}✗ Unsupported Kubernetes context: ${CURRENT_CONTEXT}${NC}"
                echo -e "${RED}Please use Rancher Desktop, Colima, or OrbStack for K3s on macOS${NC}"
                exit 1
            fi
        else
            # No cluster detected - provide installation instructions
            echo -e "${RED}✗ No K3s runtime detected${NC}"
            echo ""
            echo -e "${YELLOW}Please install a K3s runtime for macOS:${NC}"
            echo ""
            echo -e "${BLUE}Option 1: OrbStack (Recommended - Fast & Lightweight)${NC}"
            echo -e "  ${GREEN}brew install --cask orbstack${NC}"
            echo -e "  Then: Open OrbStack → Settings → Kubernetes → Enable"
            echo ""
            echo -e "${BLUE}Option 2: Rancher Desktop (GUI with more features)${NC}"
            echo -e "  ${GREEN}brew install --cask rancher${NC}"
            echo -e "  Then: Open Rancher Desktop → Preferences → Kubernetes → Enable"
            echo ""
            echo -e "${BLUE}Option 3: Colima (CLI only)${NC}"
            echo -e "  ${GREEN}brew install colima${NC}"
            echo -e "  ${GREEN}colima start --kubernetes --cpu 4 --memory 8${NC}"
            echo ""
            echo -e "${YELLOW}After installation, run this script again${NC}"
            exit 1
        fi

    else
        # =====================================================================
        # Linux: Native K3s installation
        # =====================================================================
        # Check if K3s is installed
        if ! command -v k3s &> /dev/null; then
            echo -e "${YELLOW}Installing K3s...${NC}"

            # Install K3s with containerd and device plugin support
            # Using containerd enables proper device plugin registration for GPU support
            # --disable traefik: We don't need the default ingress controller
            # Note: DevicePlugins feature gate is enabled by default since K8s 1.10
            curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -

            # Wait for K3s to be ready
            sleep 5

            echo -e "${GREEN}✓ K3s installed${NC}"
        else
            echo -e "${GREEN}✓ K3s already installed${NC}"
        fi

        # Check if K3s is running
        if ! sudo systemctl is-active --quiet k3s; then
            echo -e "${YELLOW}Starting K3s service...${NC}"
            sudo systemctl start k3s
            sleep 5
        fi

        # Setup kubectl to use K3s
        # Copy kubeconfig to user's home directory (K3s restricts /etc/rancher/k3s/k3s.yaml to root)
        mkdir -p ~/.kube
        sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
        sudo chown $(id -u):$(id -g) ~/.kube/config
        chmod 600 ~/.kube/config
        export KUBECONFIG=~/.kube/config

        # Verify K3s is running
        if kubectl get nodes &> /dev/null; then
            echo -e "${GREEN}✓ K3s is running${NC}"

            # Show node info
            NODE_NAME=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
            echo -e "  ${GREEN}Node: ${NODE_NAME}${NC}"
        else
            echo -e "${RED}✗ K3s is not responding${NC}"
            echo -e "${YELLOW}Try: sudo systemctl status k3s${NC}"
            exit 1
        fi

        # Install socat if not present (required for K3s port forwarding)
        if ! command -v socat &> /dev/null; then
            echo -e "${YELLOW}Installing socat (required for port forwarding)...${NC}"
            sudo apt-get update > /dev/null 2>&1
            sudo apt-get install -y socat > /dev/null 2>&1
            echo -e "${GREEN}✓ socat installed${NC}"
        fi
    fi

    # Enable metrics-server if not already enabled (both platforms)
    if ! kubectl get deployment metrics-server -n kube-system &> /dev/null; then
        echo -e "${YELLOW}Installing metrics-server...${NC}"
        kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml > /dev/null 2>&1
        # Patch metrics-server to work with K3s
        kubectl patch deployment metrics-server -n kube-system --type='json' -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]' > /dev/null 2>&1
    fi
}

# ============================================================================
# Cluster Startup
# ============================================================================
# Setup K3s cluster
setup_k3s

# K3s uses host Docker directly (no eval needed)
echo -e "${GREEN}✓ Using host Docker (K3s native)${NC}"

# ============================================================================
# Auto-Detect Kubernetes DNS IP (if enabled)
# ============================================================================
if [ "${AUTO_DETECT_K8S_DNS}" = "true" ]; then
    echo -n "${BLUE}🔍 Auto-detecting Kubernetes DNS IP... ${NC}"
    DETECTED_DNS_IP=$(kubectl get svc -n kube-system kube-dns -o jsonpath='{.spec.clusterIP}' 2>/dev/null)

    if [ -n "$DETECTED_DNS_IP" ]; then
        export KUBERNETES_DNS_NAMESERVER="$DETECTED_DNS_IP"
        echo -e "${GREEN}✓ ${DETECTED_DNS_IP}${NC}"
    else
        echo -e "${YELLOW}⚠️ Failed, using .env value: ${KUBERNETES_DNS_NAMESERVER}${NC}"
    fi
else
    echo -e "${BLUE}ℹ️  Using DNS IP from .env: ${KUBERNETES_DNS_NAMESERVER}${NC}"
fi

# ============================================================================
# Custom DNS Configuration
# ============================================================================
# Configure CoreDNS to use custom DNS servers if CUSTOM_DNS_SERVERS is set.
# This is useful for bypassing network DNS interception (e.g., SSL inspection).
# Set CUSTOM_DNS_SERVERS in .env files (e.g., "8.8.8.8 8.8.4.4" for Google DNS)
if [ -n "$CUSTOM_DNS_SERVERS" ] && [ "$CUSTOM_DNS_SERVERS" != '""' ]; then
    echo -e "${BLUE}🔧 Configuring custom DNS for CoreDNS...${NC}"
    echo -e "  ${BLUE}DNS Servers: ${CUSTOM_DNS_SERVERS}${NC}"

    # Get current CoreDNS ConfigMap
    COREDNS_CONFIG=$(kubectl get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}' 2>/dev/null)

    # Extract first DNS server for checking (e.g., "8.8.8.8" from "8.8.8.8 8.8.4.4")
    FIRST_DNS=$(echo "$CUSTOM_DNS_SERVERS" | awk '{print $1}')

    # Check if we need to update it (only if not already using the specified DNS)
    if ! echo "$COREDNS_CONFIG" | grep -q "forward . $FIRST_DNS"; then
        echo -n "  • Updating CoreDNS configuration... "

        # Create new Corefile with custom DNS servers
        cat > ${TEMP_DIR}/coredns-config.yaml << EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health {
           lameduck 5s
        }
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 30
        }
        prometheus :9153
        forward . ${CUSTOM_DNS_SERVERS} {
           max_concurrent 1000
        }
        cache 30
        loop
        reload
        loadbalance
    }
EOF

        # Apply the new configuration
        kubectl apply -f ${TEMP_DIR}/coredns-config.yaml > /dev/null 2>&1

        # Restart CoreDNS pods to pick up new config
        kubectl rollout restart deployment/coredns -n kube-system > /dev/null 2>&1

        # Wait for CoreDNS to be ready
        kubectl wait --for=condition=available deployment/coredns -n kube-system --timeout=60s > /dev/null 2>&1

        echo -e "${GREEN}✓${NC}"
        echo -e "  ${GREEN}✓ CoreDNS now using: ${CUSTOM_DNS_SERVERS}${NC}"

        # Clean up temp file
        rm -f ${TEMP_DIR}/coredns-config.yaml
    else
        echo -e "  ${GREEN}✓ CoreDNS already configured with custom DNS${NC}"
    fi
else
    echo -e "${BLUE}ℹ️  Using default DNS configuration (CUSTOM_DNS_SERVERS not set)${NC}"
fi

# ============================================================================
# NVIDIA GPU Support Configuration (Production Only)
# ============================================================================
# K3s provides native GPU support with NVIDIA Container Runtime (automatic)
if [ "$NODE_ENV" = "production" ]; then
    # Check if nvidia-smi is available (indicates GPU hardware present)
    if command -v nvidia-smi &> /dev/null; then
        echo -e "${BLUE}🎮 GPU Support Configuration${NC}"

        # Show GPU information
        GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
        GPU_MEMORY=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -1)
        echo -e "  ${GREEN}Detected: ${GPU_NAME} (${GPU_MEMORY})${NC}"

        # K3s: Native GPU support via NVIDIA Container Runtime with containerd
        echo -e "  ${GREEN}✓ K3s provides native GPU support with containerd${NC}"

        # Install NVIDIA Container Toolkit if not already installed
        if ! command -v nvidia-container-runtime &> /dev/null; then
                echo -e "${YELLOW}Installing NVIDIA Container Toolkit...${NC}"

                # Clean up any corrupted repository files from previous failed installations
                if [ -f /etc/apt/sources.list.d/libnvidia-container.list ]; then
                    echo -e "  ${YELLOW}Removing corrupted repository from previous installation...${NC}"
                    sudo rm /etc/apt/sources.list.d/libnvidia-container.list
                fi

                # Remove old deprecated keyring if it exists
                if [ -f /etc/apt/trusted.gpg.d/nvidia-container-toolkit-keyring.gpg ]; then
                    sudo rm /etc/apt/trusted.gpg.d/nvidia-container-toolkit-keyring.gpg
                fi

                # Add NVIDIA package repository (new format)
                curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null
                curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
                  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
                  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null

                # Install
                sudo apt-get update > /dev/null 2>&1
                sudo apt-get install -y nvidia-container-toolkit > /dev/null 2>&1

                echo -e "${GREEN}✓ NVIDIA Container Toolkit installed${NC}"
            else
                echo -e "  ${GREEN}✓ NVIDIA Container Toolkit already installed${NC}"
            fi

            # Configure K3s containerd to use NVIDIA runtime
            # NOTE: This only runs in production mode (NODE_ENV=production)
            CONTAINERD_CONFIG="/var/lib/rancher/k3s/agent/etc/containerd/config.toml"
            CONTAINERD_TEMPLATE="/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl"

            # Check if NVIDIA runtime is already configured
            if ! sudo grep -q "nvidia" "$CONTAINERD_CONFIG" 2>/dev/null; then
                echo -e "  ${YELLOW}Configuring K3s containerd for NVIDIA runtime...${NC}"

                # Configure containerd for NVIDIA
                sudo nvidia-ctk runtime configure --runtime=containerd --config="$CONTAINERD_CONFIG" > /dev/null 2>&1

                # Set nvidia as default runtime in containerd
                sudo sed -i 's/default_runtime_name = "runc"/default_runtime_name = "nvidia"/' "$CONTAINERD_CONFIG" 2>/dev/null || true

                # Restart K3s to pick up new containerd configuration
                echo -e "  ${YELLOW}Restarting K3s to apply NVIDIA runtime...${NC}"
                sudo systemctl restart k3s

                # Wait for K3s to be fully ready (important: kubelet needs time to start)
                echo -n "  • Waiting for K3s kubelet to be ready... "
                sleep 10  # Initial wait for services to start

                # Wait for node to be ready
                WAIT_COUNT=0
                while [ $WAIT_COUNT -lt 30 ]; do
                    if kubectl get nodes &> /dev/null && kubectl wait --for=condition=Ready node --all --timeout=5s &> /dev/null; then
                        echo -e "${GREEN}✓${NC}"
                        break
                    fi
                    sleep 2
                    WAIT_COUNT=$((WAIT_COUNT + 1))
                done

                if [ $WAIT_COUNT -ge 30 ]; then
                    echo -e "${RED}✗ Timeout${NC}"
                    echo -e "${RED}K3s did not become ready in time${NC}"
                    exit 1
                fi

                # Additional wait for kubelet device plugin registration to be ready
                sleep 5

                echo -e "${GREEN}✓ NVIDIA runtime configured for K3s containerd${NC}"
            else
                echo -e "  ${GREEN}✓ NVIDIA runtime already configured in containerd${NC}"
            fi

            # Create NVIDIA RuntimeClass for K3s containerd
            echo -e "${YELLOW}Creating NVIDIA RuntimeClass...${NC}"
            cat > ${TEMP_DIR}/nvidia-runtimeclass.yaml << 'RUNTIMECLASS'
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: nvidia
handler: nvidia
RUNTIMECLASS

            kubectl apply -f ${TEMP_DIR}/nvidia-runtimeclass.yaml > /dev/null 2>&1
            rm -f ${TEMP_DIR}/nvidia-runtimeclass.yaml
            echo -e "  ${GREEN}✓ RuntimeClass created${NC}"

            # Install NVIDIA Device Plugin for Kubernetes (required to expose GPU resources)
            echo -e "${YELLOW}Installing NVIDIA Device Plugin for Kubernetes...${NC}"

            # Check if device plugin is already installed
            if kubectl get daemonset -n kube-system nvidia-device-plugin-daemonset &> /dev/null; then
                echo -e "  ${YELLOW}Removing old device plugin configuration...${NC}"
                # Delete old version to apply correct config
                kubectl delete daemonset nvidia-device-plugin-daemonset -n kube-system > /dev/null 2>&1
                sleep 5
            fi

            # Device plugin DaemonSet configuration
            # Note: K3s kubelet uses standard Kubernetes paths (/var/lib/kubelet/device-plugins)
            # even though other K3s components use /var/lib/rancher/k3s paths
            cat > ${TEMP_DIR}/nvidia-device-plugin.yaml << 'DEVICEPLUGIN'
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nvidia-device-plugin-daemonset
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: nvidia-device-plugin-ds
  updateStrategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        name: nvidia-device-plugin-ds
    spec:
      tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule
      priorityClassName: "system-node-critical"
      runtimeClassName: nvidia
      containers:
      - image: nvcr.io/nvidia/k8s-device-plugin:v0.14.0
        name: nvidia-device-plugin-ctr
        env:
        - name: FAIL_ON_INIT_ERROR
          value: "false"
        - name: NVIDIA_VISIBLE_DEVICES
          value: "all"
        - name: NVIDIA_DRIVER_CAPABILITIES
          value: "all"
        securityContext:
          privileged: true
        volumeMounts:
        - name: device-plugin
          mountPath: /var/lib/kubelet/device-plugins
        - name: dev
          mountPath: /dev
      volumes:
      - name: device-plugin
        hostPath:
          path: KUBELET_DEVICE_PLUGINS_PATH
      - name: dev
        hostPath:
          path: /dev
DEVICEPLUGIN

            # K3s kubelet actually uses standard Kubernetes paths (not K3s-specific paths)
            # This is where kubelet.sock is located for device plugin registration
            KUBELET_PATH="/var/lib/kubelet/device-plugins"
            sed -i "s|KUBELET_DEVICE_PLUGINS_PATH|$KUBELET_PATH|g" ${TEMP_DIR}/nvidia-device-plugin.yaml
            echo -e "  ${GREEN}✓ Using standard kubelet path: ${KUBELET_PATH}${NC}"

            # Apply the device plugin
            kubectl apply -f ${TEMP_DIR}/nvidia-device-plugin.yaml > /dev/null 2>&1
            echo -e "  ${GREEN}✓ NVIDIA Device Plugin installed${NC}"

            # Wait for device plugin to be ready
            echo -n "  • Waiting for device plugin to start... "
            kubectl wait --for=condition=ready pod -l name=nvidia-device-plugin-ds -n kube-system --timeout=60s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(still starting)${NC}"

            # Give device plugin a moment to register GPU resources
            sleep 5

            # Clean up temp file
            rm -f ${TEMP_DIR}/nvidia-device-plugin.yaml

            # Verify GPU resources
            GPU_ALLOCATABLE=$(kubectl describe nodes 2>/dev/null | grep -A 5 "Allocatable:" | grep "nvidia.com/gpu" | awk '{print $2}' | head -1)

            if [ -n "$GPU_ALLOCATABLE" ] && [ "$GPU_ALLOCATABLE" != "0" ]; then
                echo -e "  ${GREEN}✓ GPU resources available: ${GPU_ALLOCATABLE} GPU(s)${NC}"
                echo -e "  ${GREEN}✓ Pods can now request nvidia.com/gpu resources${NC}"
            else
                echo -e "  ${YELLOW}⚠️  GPU not yet visible to Kubernetes${NC}"
                echo -e "  ${YELLOW}   This may take a few moments to propagate${NC}"
                echo -e "  ${YELLOW}   Check status: kubectl get pods -n kube-system -l name=nvidia-device-plugin-ds${NC}"
            fi
    else
        echo -e "${YELLOW}⚠️  Production mode but no GPU detected on host${NC}"
        echo -e "${YELLOW}   nvidia-smi command not found${NC}"
        echo -e "${YELLOW}   Pods requesting nvidia.com/gpu will remain in Pending state${NC}"
        echo -e "${YELLOW}   Install NVIDIA drivers if GPU hardware is available${NC}"
    fi
else
    # Local mode - skip GPU setup
    echo -e "${BLUE}ℹ️  GPU support disabled in local mode (NODE_ENV=$NODE_ENV)${NC}"
    echo -e "${BLUE}   GPU resources only allocated in production mode${NC}"
fi

# ============================================================================
# LiveKit Host Discovery
# ============================================================================
# Pods use init containers to dynamically discover the gateway IP
# and update /etc/hosts at runtime for host.docker.internal
# No static configuration or firewall rules needed
echo -e "${GREEN}✓ Using dynamic host discovery for LiveKit connectivity${NC}"

# LiveKit is provided externally - using dual URLs for internal/external access
echo -e "${GREEN}📡 Using LiveKit server:${NC}"
echo -e "  ${GREEN}Internal (K8s pods):${NC} ${LIVEKIT_URL}"
echo -e "  ${GREEN}Public (browsers):${NC}   ${PUBLIC_LIVEKIT_URL}"

# ============================================================================
# Smart Incremental Build System
# ============================================================================
# Tracks file checksums to detect changes and only rebuild modified services
# Checksums stored in $PID_DIR/checksums/ directory
CHECKSUM_DIR="${PID_DIR}/checksums"
mkdir -p "$CHECKSUM_DIR"

# Calculate checksum for a service directory
# Uses find + md5 to create a hash of all source files
calculate_service_checksum() {
    local service_name=$1
    local service_dir=$2
    local dockerfile=$3

    # Get list of relevant files (exclude node_modules, __pycache__, .git, etc.)
    # Includes: source code, configs, scripts, styles, and build files
    local checksum=""

    if [[ "$OS_TYPE" == "macos" ]]; then
        # macOS: Use md5 command
        checksum=$(find "$service_dir" -type f \
            \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
            -o -name "*.py" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" \
            -o -name "Dockerfile*" -o -name "*.toml" -o -name "*.cfg" \
            -o -name "requirements*.txt" -o -name "package*.json" \
            -o -name "*.css" -o -name "*.html" -o -name "*.conf" -o -name "*.sh" \
            -o -name "*.prisma" -o -name "*.env.example" \) \
            ! -path "*/node_modules/*" ! -path "*/__pycache__/*" ! -path "*/.git/*" \
            ! -path "*/dist/*" ! -path "*/build/*" ! -path "*/.next/*" \
            -exec md5 -q {} \; 2>/dev/null | sort | md5 -q)
    else
        # Linux: Use md5sum command
        checksum=$(find "$service_dir" -type f \
            \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
            -o -name "*.py" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" \
            -o -name "Dockerfile*" -o -name "*.toml" -o -name "*.cfg" \
            -o -name "requirements*.txt" -o -name "package*.json" \
            -o -name "*.css" -o -name "*.html" -o -name "*.conf" -o -name "*.sh" \
            -o -name "*.prisma" -o -name "*.env.example" \) \
            ! -path "*/node_modules/*" ! -path "*/__pycache__/*" ! -path "*/.git/*" \
            ! -path "*/dist/*" ! -path "*/build/*" ! -path "*/.next/*" \
            -exec md5sum {} \; 2>/dev/null | sort | md5sum | cut -d' ' -f1)
    fi

    # Also include the Dockerfile in the checksum
    if [ -f "$dockerfile" ]; then
        if [[ "$OS_TYPE" == "macos" ]]; then
            local dockerfile_hash=$(md5 -q "$dockerfile")
        else
            local dockerfile_hash=$(md5sum "$dockerfile" | cut -d' ' -f1)
        fi
        checksum="${checksum}${dockerfile_hash}"

        # Rehash combined
        if [[ "$OS_TYPE" == "macos" ]]; then
            checksum=$(echo "$checksum" | md5 -q)
        else
            checksum=$(echo "$checksum" | md5sum | cut -d' ' -f1)
        fi
    fi

    echo "$checksum"
}

# Check if a service needs to be rebuilt
# Returns 0 (true) if rebuild needed, 1 (false) if unchanged
service_needs_rebuild() {
    local service_name=$1
    local service_dir=$2
    local dockerfile=$3

    local current_checksum=$(calculate_service_checksum "$service_name" "$service_dir" "$dockerfile")
    local cached_checksum_file="${CHECKSUM_DIR}/${service_name}.checksum"

    # If no cached checksum, needs rebuild
    if [ ! -f "$cached_checksum_file" ]; then
        echo "$current_checksum" > "$cached_checksum_file"
        return 0  # Needs rebuild
    fi

    local cached_checksum=$(cat "$cached_checksum_file")

    if [ "$current_checksum" != "$cached_checksum" ]; then
        echo "$current_checksum" > "$cached_checksum_file"
        return 0  # Needs rebuild
    fi

    return 1  # No rebuild needed
}

# Update cached checksum after successful build
update_service_checksum() {
    local service_name=$1
    local service_dir=$2
    local dockerfile=$3

    local current_checksum=$(calculate_service_checksum "$service_name" "$service_dir" "$dockerfile")
    echo "$current_checksum" > "${CHECKSUM_DIR}/${service_name}.checksum"
}

# Clear all cached checksums (used with --rebuild)
clear_all_checksums() {
    rm -f "${CHECKSUM_DIR}"/*.checksum 2>/dev/null || true
}

# Smart build wrapper - only builds if service has changed
# Usage: smart_build "service-name" "tag" "context" "$USE_BUILDKIT" "build_args" "dockerfile"
# Returns: 0 if built, 1 if skipped (unchanged)
smart_build() {
    local IMAGE_NAME=$1
    local TAG=$2
    local CONTEXT=$3
    local USE_BUILDKIT=$4
    local BUILD_ARGS="${5:-}"
    local DOCKERFILE="${6:-Dockerfile}"  # Default to Dockerfile in context

    # In skip-build mode, skip everything
    if [ "$SKIP_BUILD_MODE" = true ]; then
        echo -e "  • ${IMAGE_NAME}... ${YELLOW}skipped (--skip-build)${NC}"
        return 1
    fi

    # Determine the service directory (context path or current dir)
    local SERVICE_DIR="$CONTEXT"
    if [ "$SERVICE_DIR" = "." ]; then
        SERVICE_DIR="."
    fi

    # Determine dockerfile path
    local DOCKERFILE_PATH="${CONTEXT}/${DOCKERFILE}"
    if [ "$CONTEXT" = "." ]; then
        DOCKERFILE_PATH="./${DOCKERFILE}"
    fi

    # In rebuild mode, always build
    if [ "$REBUILD_MODE" = true ]; then
        build_with_progress "$IMAGE_NAME" "$TAG" "$CONTEXT" "$USE_BUILDKIT" "$BUILD_ARGS"
        update_service_checksum "$IMAGE_NAME" "$SERVICE_DIR" "$DOCKERFILE_PATH"
        REBUILT_SERVICES+=("$IMAGE_NAME")
        return 0
    fi

    # Smart mode: check if rebuild is needed
    if service_needs_rebuild "$IMAGE_NAME" "$SERVICE_DIR" "$DOCKERFILE_PATH"; then
        build_with_progress "$IMAGE_NAME" "$TAG" "$CONTEXT" "$USE_BUILDKIT" "$BUILD_ARGS"
        update_service_checksum "$IMAGE_NAME" "$SERVICE_DIR" "$DOCKERFILE_PATH"
        REBUILT_SERVICES+=("$IMAGE_NAME")
        return 0
    else
        echo -e "  • ${IMAGE_NAME}... ${GREEN}unchanged ✓${NC}"
        return 1
    fi
}

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
    local BUILD_ARGS="${5:-}"  # Optional build arguments

    local LOG_FILE="${TEMP_DIR}/docker-build-${IMAGE_NAME}.log"

    echo "  • ${IMAGE_NAME}..."

    # Determine if --no-cache should be used
    local NO_CACHE_FLAG=""
    if [ "$REBUILD_MODE" = true ]; then
        NO_CACHE_FLAG="--no-cache"
    fi

    # Run docker build in background and capture output
    # Use setsid to detach from controlling terminal, preventing BuildKit from writing to /dev/tty
    if [ "$USE_BUILDKIT" = true ]; then
        $SETSID_CMD env DOCKER_BUILDKIT=1 docker build --progress=plain --build-arg BUILDKIT_STEP_TIMEOUT=3600 ${NO_CACHE_FLAG} ${BUILD_ARGS} --network=host -t "${TAG}" "${CONTEXT}" > "${LOG_FILE}" 2>&1 &
    else
        $SETSID_CMD docker build ${NO_CACHE_FLAG} ${BUILD_ARGS} --network=host -t "${TAG}" "${CONTEXT}" > "${LOG_FILE}" 2>&1 &
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

# Clean up for rebuild mode
if [ "$REBUILD_MODE" = true ]; then
    echo -e "${GREEN}🧹 Rebuild mode: cleaning up existing resources...${NC}"

    # Delete all deployments except postgres (unless --reset-db is specified)
    if [ "$RESET_DB_MODE" = true ]; then
        echo -e "${YELLOW}  ⚠️  --reset-db: Database will be reset!${NC}"
        echo -n "  • Deleting all pods (including postgres)... "
        kubectl delete pods -n ai-agents --all --grace-period=5 2>/dev/null || true
        kubectl delete pvc -n ai-agents --all 2>/dev/null || true
        echo -e "${GREEN}✓${NC}"
    else
        echo -n "  • Deleting application pods (keeping postgres)... "
        kubectl delete pods -n ai-agents -l app!=postgres --grace-period=5 2>/dev/null || true
        echo -e "${GREEN}✓${NC}"
    fi

    # Clean up error/failed/unknown pods
    echo -n "  • Cleaning up failed/error/stuck pods... "
    kubectl delete pods -n ai-agents --field-selector=status.phase=Failed 2>/dev/null || true
    kubectl delete pods -n ai-agents --field-selector=status.phase=Unknown 2>/dev/null || true
    # Force delete any pods stuck in ContainerStatusUnknown or other weird states
    kubectl get pods -n ai-agents --no-headers 2>/dev/null | grep -E "Unknown|Error|ContainerStatusUnknown" | awk '{print $1}' | xargs -r kubectl delete pod -n ai-agents --force --grace-period=0 2>/dev/null || true
    echo -e "${GREEN}✓${NC}"

    # Remove old Docker images (core services only, agent images are built on-demand)
    echo -n "  • Removing old Docker images... "
    docker rmi session-management-server:latest stt-service:latest tts-service:latest frontend-ui:latest message-recorder-python:latest 2>/dev/null || true
    # Also clean up any cached agent images
    docker rmi grace-agent:latest 2>/dev/null || true
    echo -e "${GREEN}✓${NC}"

    # Clean up k3s containerd images (Linux only)
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -n "  • Cleaning k3s containerd images... "
        sudo k3s ctr images rm docker.io/library/session-management-server:latest 2>/dev/null || true
        sudo k3s ctr images rm docker.io/library/stt-service:latest 2>/dev/null || true
        sudo k3s ctr images rm docker.io/library/tts-service:latest 2>/dev/null || true
        sudo k3s ctr images rm docker.io/library/frontend-ui:latest 2>/dev/null || true
        sudo k3s ctr images rm docker.io/library/message-recorder-python:latest 2>/dev/null || true
        # Also clean up any cached agent images
        sudo k3s ctr images rm docker.io/library/grace-agent:latest 2>/dev/null || true
        echo -e "${GREEN}✓${NC}"
    fi

    # Clean up Docker build cache to free disk space
    echo -n "  • Pruning Docker build cache... "
    docker builder prune -f 2>/dev/null || true
    echo -e "${GREEN}✓${NC}"

    # Clean up any leftover temp files from previous runs
    echo -n "  • Cleaning up temp files... "
    rm -f ${TEMP_DIR}/k3s-images.tar ${TEMP_DIR}/docker-save-error.log ${TEMP_DIR}/k3s-import.log 2>/dev/null || true
    rm -f ${TEMP_DIR}/04-configmap-updated.yaml ${TEMP_DIR}/06-message-recorder-updated.yaml 2>/dev/null || true
    rm -f ${TEMP_DIR}/08-stt-service-gpu.yaml ${TEMP_DIR}/09-tts-service-gpu.yaml 2>/dev/null || true
    rm -f ${TEMP_DIR}/docker-build-*.log 2>/dev/null || true
    rm -f ${TEMP_DIR}/nvidia-*.yaml ${TEMP_DIR}/coredns-config.yaml 2>/dev/null || true
    echo -e "${GREEN}✓${NC}"

    echo -e "${GREEN}  ✓ Cleanup complete${NC}"
    echo ""
fi

# Check disk space before building (K8s gets cranky below 15% free)
DISK_USAGE=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')
DISK_FREE=$((100 - DISK_USAGE))
if [ "$DISK_FREE" -lt 15 ]; then
    echo -e "${YELLOW}⚠️  Warning: Low disk space (${DISK_FREE}% free)${NC}"
    echo -e "${YELLOW}   K8s may experience disk pressure issues.${NC}"
    echo -e "${YELLOW}   Consider running: docker system prune -af${NC}"
fi

# Build Docker images
echo -e "${GREEN}🔨 Building Docker images...${NC}"

# Track which services were actually rebuilt
REBUILT_SERVICES=()

if [ "$REBUILD_MODE" = true ]; then
    echo -e "${BLUE}  🔄 Forcing clean rebuild of all services (--no-cache)${NC}"
    clear_all_checksums
elif [ "$SKIP_BUILD_MODE" = true ]; then
    echo -e "${BLUE}  ⏭️  Skipping builds (--skip-build), using existing images${NC}"
else
    echo -e "${BLUE}  🔍 Smart build: checking for changes...${NC}"
fi

# Determine if GPU support should be enabled
# GPU builds create larger images (~2GB) with CUDA libraries
# CPU builds are lightweight (~500MB)
STT_BUILD_ARGS=""
TTS_BUILD_ARGS=""

if [ "$ENABLE_GPU" = "true" ]; then
    # Check if GPU hardware is available
    # GPU support only on Linux with NVIDIA GPU
    if [[ "$OS_TYPE" == "linux" ]] && command -v nvidia-smi &> /dev/null; then
        STT_BUILD_ARGS="--build-arg ENABLE_GPU=true --build-arg WHISPER_MODEL=${WHISPER_MODEL}"
        TTS_BUILD_ARGS="--build-arg ENABLE_GPU=true"
        echo -e "${BLUE}  🎮 GPU mode enabled (ENABLE_GPU=true)${NC}"
        echo -e "${BLUE}     Building STT service with CUDA support (model: ${WHISPER_MODEL})${NC}"
        echo -e "${BLUE}     Building TTS service with CUDA support${NC}"

        # Auto-select whisper as STT provider for GPU (best quality)
        if [ "$STT_PROVIDER" = "sherpa" ]; then
            echo -e "${BLUE}     Auto-selecting Whisper STT for GPU acceleration${NC}"
            export STT_PROVIDER="whisper"
            export WHISPER_DEVICE="cuda"
            export WHISPER_COMPUTE_TYPE="float16"
        fi

        # Auto-select kokoro as TTS provider for GPU (fastest local inference)
        if [ "$TTS_PROVIDER" = "edge_tts" ]; then
            echo -e "${BLUE}     Auto-selecting Kokoro TTS for GPU acceleration${NC}"
            export TTS_PROVIDER="kokoro"
        fi
    elif [[ "$OS_TYPE" == "macos" ]]; then
        # macOS doesn't support NVIDIA GPU, gracefully fall back to CPU
        echo -e "${YELLOW}  ⚠️  ENABLE_GPU=true but macOS doesn't support NVIDIA CUDA${NC}"
        echo -e "${YELLOW}     Falling back to CPU mode (TTS will use Edge TTS or Kokoro CPU)${NC}"
        export ENABLE_GPU="false"
        export ONNX_PROVIDER="CPUExecutionProvider"
    else
        echo -e "${YELLOW}  ⚠️  ENABLE_GPU=true but no GPU detected (nvidia-smi not found)${NC}"
        echo -e "${YELLOW}     Falling back to CPU mode${NC}"
        export ENABLE_GPU="false"
        export ONNX_PROVIDER="CPUExecutionProvider"
    fi
else
    echo -e "${BLUE}  💻 CPU mode (ENABLE_GPU=false or not set)${NC}"
    echo -e "${BLUE}     Building lightweight CPU-only images${NC}"
fi

# Validate build directories exist
echo -n "  • Validating build directories... "
# Core services built at startup. Agent images (grace-agent, etc.) are built on-demand
# when first assigned to a session. See AgentImageService for on-demand building.
BUILD_DIRS=("./frontend-ui" "./message-recorder-python" "./stt-service" "./tts-service")
for dir in "${BUILD_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        echo -e "${RED}✗${NC}"
        echo -e "${RED}Error: Build directory not found: $dir${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓${NC}"

# Compute Prisma schema checksum for cache busting
# This ensures the Prisma client is regenerated when the schema changes
PRISMA_SCHEMA_CHECKSUM=$(md5sum ./prisma/schema.prisma 2>/dev/null | cut -d' ' -f1 || md5 -q ./prisma/schema.prisma 2>/dev/null || echo "default")
# Construct DATABASE_URL for Prisma generate during build (uses postgres service name for K8s)
BUILD_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
SESSION_SERVER_BUILD_ARGS="--build-arg PRISMA_SCHEMA_CHECKSUM=${PRISMA_SCHEMA_CHECKSUM} --build-arg DATABASE_URL=${BUILD_DATABASE_URL}"
echo "  📋 Prisma schema checksum: ${PRISMA_SCHEMA_CHECKSUM:0:8}..."

# Use smart_build for incremental builds - only rebuilds changed services
# Note: || true prevents set -e from exiting when service is unchanged (returns 1)
smart_build "session-management-server" "session-management-server:latest" "." "$USE_BUILDKIT" "$SESSION_SERVER_BUILD_ARGS" || true
# DISABLED: Monolith replaced by STT microservice
# smart_build "conversational-ai-server-python" "conversational-ai-server-python:latest" "./conversational-ai-server-python" "$USE_BUILDKIT" "$AI_SERVER_BUILD_ARGS" || true
smart_build "stt-service" "stt-service:latest" "./stt-service" "$USE_BUILDKIT" "$STT_BUILD_ARGS" || true
smart_build "tts-service" "tts-service:latest" "./tts-service" "$USE_BUILDKIT" "$TTS_BUILD_ARGS" || true
smart_build "frontend-ui" "frontend-ui:latest" "./frontend-ui" "$USE_BUILDKIT" "" || true
smart_build "message-recorder-python" "message-recorder-python:latest" "./message-recorder-python" "$USE_BUILDKIT" "" || true

# Print build summary
if [ ${#REBUILT_SERVICES[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ All services up to date - no builds needed${NC}"
else
    echo -e "${GREEN}✅ Built ${#REBUILT_SERVICES[@]} service(s): ${REBUILT_SERVICES[*]}${NC}"
fi

# Import Docker images into K3s containerd
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS: OrbStack/Rancher Desktop/Colima share the same Docker daemon with K3s
    # Images built with `docker build` are automatically available to K3s - no import needed
    echo -e "${GREEN}📦 Images available to K3s (shared Docker daemon)${NC}"
else
    # Linux: K3s has separate containerd, need to import images
    # Only import images that were actually rebuilt (optimization)
    if [ ${#REBUILT_SERVICES[@]} -eq 0 ]; then
        echo -e "${GREEN}📦 No images to import (all services unchanged)${NC}"
    else
        echo -e "${GREEN}📦 Importing rebuilt images into K3s containerd...${NC}"

        # Build list of image tags to export
        IMAGES_TO_EXPORT=""
        for service in "${REBUILT_SERVICES[@]}"; do
            IMAGES_TO_EXPORT="${IMAGES_TO_EXPORT} ${service}:latest"
        done

        # Save Docker images to tar files
        echo -n "  • Exporting ${#REBUILT_SERVICES[@]} image(s)... "
        if docker save ${IMAGES_TO_EXPORT} -o ${TEMP_DIR}/k3s-images.tar 2>${TEMP_DIR}/docker-save-error.log; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗${NC}"
            echo -e "${RED}Error exporting Docker images:${NC}"
            cat ${TEMP_DIR}/docker-save-error.log
            exit 1
        fi

        # Import into K3s containerd
        echo -n "  • Importing into K3s containerd... "
        if sudo k3s ctr images import ${TEMP_DIR}/k3s-images.tar > ${TEMP_DIR}/k3s-import.log 2>&1; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗${NC}"
            echo -e "${RED}Error importing images into K3s:${NC}"
            cat ${TEMP_DIR}/k3s-import.log
            echo ""
            echo -e "${YELLOW}Troubleshooting:${NC}"
            echo -e "  1. Check K3s is running: ${BLUE}sudo systemctl status k3s${NC}"
            echo -e "  2. Check containerd socket: ${BLUE}sudo ls -la /run/k3s/containerd/containerd.sock${NC}"
            echo -e "  3. Check disk space: ${BLUE}df -h /var/lib/rancher/k3s${NC}"
            exit 1
        fi

        # Clean up tar file
        rm -f ${TEMP_DIR}/k3s-images.tar ${TEMP_DIR}/docker-save-error.log ${TEMP_DIR}/k3s-import.log

        echo -e "${GREEN}✓ ${#REBUILT_SERVICES[@]} image(s) imported to K3s${NC}"
    fi
fi

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

# Validate NETWORK_IP was detected
if [ -z "$NETWORK_IP" ]; then
    echo -e "${YELLOW}⚠️  Could not detect network IP, using 127.0.0.1${NC}"
    NETWORK_IP="127.0.0.1"
else
    echo -e "${GREEN}📡 Detected network IP: ${NETWORK_IP}${NC}"
fi

# Validate envsubst is available
if ! command -v envsubst &> /dev/null; then
    echo -e "${RED}✗ envsubst not found${NC}"
    echo -e "${YELLOW}Install gettext package:${NC}"
    if [[ "$OS_TYPE" == "macos" ]]; then
        echo -e "  ${BLUE}brew install gettext${NC}"
        echo -e "  ${BLUE}brew link --force gettext${NC}"
    else
        echo -e "  ${BLUE}sudo apt-get install gettext-base${NC}"
    fi
    exit 1
fi

# Inject environment variables into ConfigMaps using envsubst
echo -n "  • Updating ConfigMaps with environment variables... "
envsubst < k8s/04-configmap.yaml > ${TEMP_DIR}/04-configmap-updated.yaml
echo -e "${GREEN}✓${NC}"

# Detect K8s gateway IP for host.docker.internal (macOS only)
if [[ "$OS_TYPE" == "macos" ]]; then
    # Get the first pod's gateway IP to detect OrbStack/Rancher Desktop gateway
    echo -n "  • Detecting Kubernetes gateway IP for host access... "

    # Create a temporary pod to detect gateway
    kubectl run gateway-detector --image=busybox:latest --restart=Never -n ai-agents --command -- sh -c "ip route | awk '/default/ {print \$3}'" > /dev/null 2>&1 || true
    sleep 2

    HOST_GATEWAY_IP=$(kubectl logs gateway-detector -n ai-agents 2>/dev/null | tr -d '\r\n' || echo "")
    kubectl delete pod gateway-detector -n ai-agents > /dev/null 2>&1 || true

    if [ -z "$HOST_GATEWAY_IP" ]; then
        HOST_GATEWAY_IP="192.168.194.1"  # Default for OrbStack
        echo -e "${YELLOW}⚠️  Using default OrbStack gateway: ${HOST_GATEWAY_IP}${NC}"
    else
        echo -e "${GREEN}✓ ${HOST_GATEWAY_IP}${NC}"
    fi

    # Update message-recorder.yaml with detected gateway IP
    sed "s/192.168.194.1/${HOST_GATEWAY_IP}/g" k8s/06-message-recorder.yaml > ${TEMP_DIR}/06-message-recorder-updated.yaml
else
    # Linux: Use message-recorder.yaml as-is (hostAliases not needed on Linux)
    cp k8s/06-message-recorder.yaml ${TEMP_DIR}/06-message-recorder-updated.yaml
fi

# Note: LiveKit API key verification skipped - using external LiveKit server
# The external server is pre-configured with its own API keys

# Generate GPU-enabled manifests if GPU is enabled
# This uses sed to uncomment GPU resource requests in the K8s manifests
STT_MANIFEST="k8s/08-stt-service.yaml"
TTS_MANIFEST="k8s/09-tts-service.yaml"

if [ "$ENABLE_GPU" = "true" ]; then
    echo -e "${BLUE}⚙️  Generating GPU-enabled K8s manifests...${NC}"

    # Generate GPU-enabled STT manifest
    # - Uncomment runtimeClassName: nvidia (for CUDA access)
    # - Do NOT request nvidia.com/gpu resource - allows GPU sharing between services
    # - Both STT and TTS share the single GPU via CUDA without exclusive allocation
    sed -e 's/# GPU: runtimeClassName: nvidia/runtimeClassName: nvidia/' \
        k8s/08-stt-service.yaml > ${TEMP_DIR}/08-stt-service-gpu.yaml
    STT_MANIFEST="${TEMP_DIR}/08-stt-service-gpu.yaml"
    echo -e "  ${GREEN}✓ STT service manifest (GPU shared mode)${NC}"

    # Generate GPU-enabled TTS manifest
    sed -e 's/# GPU: runtimeClassName: nvidia/runtimeClassName: nvidia/' \
        k8s/09-tts-service.yaml > ${TEMP_DIR}/09-tts-service-gpu.yaml
    TTS_MANIFEST="${TEMP_DIR}/09-tts-service-gpu.yaml"
    echo -e "  ${GREEN}✓ TTS service manifest (GPU shared mode)${NC}"

    echo -e "  ${CYAN}ℹ️  GPU sharing: STT and TTS share single GPU via CUDA${NC}"
fi

# Deploy to Kubernetes
echo -e "${GREEN}☸️  Deploying to Kubernetes...${NC}"

# Phase 1: Deploy namespace, secrets, and database first
kubectl apply -f k8s/00-namespace.yaml > /dev/null
kubectl apply -f k8s/03-secrets.yaml > /dev/null
kubectl apply -f ${TEMP_DIR}/04-configmap-updated.yaml > /dev/null
kubectl apply -f k8s/05-rbac.yaml > /dev/null

# Create secrets (needed by all services)
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

# Phase 2: Deploy and wait for PostgreSQL
kubectl apply -f k8s/01-postgres-config.yaml > /dev/null 2>&1 || true
kubectl apply -f k8s/01-postgres.yaml > /dev/null
echo -n "  • Waiting for PostgreSQL... "
kubectl wait --for=condition=ready pod -l app=postgres -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"

# Phase 3: Deploy services that depend on PostgreSQL (session-management-server runs migrations)
kubectl apply -f k8s/06-session-management-server.yaml > /dev/null
kubectl apply -f ${TEMP_DIR}/06-message-recorder-updated.yaml > /dev/null
kubectl apply -f k8s/07-frontend-ui.yaml > /dev/null
kubectl apply -f "$STT_MANIFEST" > /dev/null
kubectl apply -f "$TTS_MANIFEST" > /dev/null

# Apply NodePort services for local development only
# Production uses ClusterIP services (already created) + port-forward
if [ "$NODE_ENV" != "production" ]; then
    echo -e "${BLUE}  • Applying NodePort services for local development...${NC}"
    kubectl apply -f k8s/local/ > /dev/null 2>&1 || echo -e "${YELLOW}    (NodePort services may already exist)${NC}"
fi

# LiveKit: Using external server with dual URLs
echo -e "  • LiveKit: Internal=${LIVEKIT_URL}, Public=${PUBLIC_LIVEKIT_URL} ${GREEN}✓${NC}"

# If GPU is enabled, patch deployments to add NVIDIA_VISIBLE_DEVICES env var
# This is required for nvidia-container-runtime to inject GPU devices
if [ "$ENABLE_GPU" = "true" ]; then
    echo -e "${BLUE}⚙️  Patching GPU services with NVIDIA_VISIBLE_DEVICES...${NC}"

    # Check if NVIDIA_VISIBLE_DEVICES already exists in STT deployment
    if ! kubectl get deployment -n ai-agents stt-service -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' 2>/dev/null | grep -q "NVIDIA_VISIBLE_DEVICES"; then
        kubectl patch deployment -n ai-agents stt-service --type='json' \
            -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "NVIDIA_VISIBLE_DEVICES", "value": "all"}}]' > /dev/null 2>&1
        echo -e "  ${GREEN}✓ STT service patched with NVIDIA_VISIBLE_DEVICES=all${NC}"
    else
        echo -e "  ${CYAN}ℹ️  STT service already has NVIDIA_VISIBLE_DEVICES${NC}"
    fi

    # Check if NVIDIA_VISIBLE_DEVICES already exists in TTS deployment
    if ! kubectl get deployment -n ai-agents tts-service -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' 2>/dev/null | grep -q "NVIDIA_VISIBLE_DEVICES"; then
        kubectl patch deployment -n ai-agents tts-service --type='json' \
            -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "NVIDIA_VISIBLE_DEVICES", "value": "all"}}]' > /dev/null 2>&1
        echo -e "  ${GREEN}✓ TTS service patched with NVIDIA_VISIBLE_DEVICES=all${NC}"
    else
        echo -e "  ${CYAN}ℹ️  TTS service already has NVIDIA_VISIBLE_DEVICES${NC}"
    fi
fi

# Restart deployments (only services that were rebuilt)
# Helper function to check if a service was rebuilt
service_was_rebuilt() {
    local service=$1
    for rebuilt in "${REBUILT_SERVICES[@]}"; do
        if [ "$rebuilt" = "$service" ]; then
            return 0
        fi
    done
    return 1
}

# Map image names to deployment names
# session-management-server -> session-management-server
# frontend-ui -> frontend-ui
# stt-service -> stt-service
# tts-service -> tts-service
# message-recorder-python -> message-recorder

if [ ${#REBUILT_SERVICES[@]} -eq 0 ] && [ "$SKIP_BUILD_MODE" != true ]; then
    echo -e "${GREEN}🔄 No services rebuilt - skipping pod restarts${NC}"
else
    echo -e "${GREEN}🔄 Restarting rebuilt services...${NC}"

    # Always restart in rebuild mode or skip-build mode (for skip-build, user wants fresh pods)
    if [ "$REBUILD_MODE" = true ] || [ "$SKIP_BUILD_MODE" = true ]; then
        kubectl rollout restart deployment session-management-server -n ai-agents > /dev/null 2>&1
        kubectl rollout restart deployment frontend-ui -n ai-agents > /dev/null 2>&1
        kubectl rollout restart deployment stt-service -n ai-agents > /dev/null 2>&1
        kubectl rollout restart deployment tts-service -n ai-agents > /dev/null 2>&1
        kubectl rollout restart deployment message-recorder -n ai-agents > /dev/null 2>&1
    else
        # Smart mode: only restart rebuilt services
        if service_was_rebuilt "session-management-server"; then
            kubectl rollout restart deployment session-management-server -n ai-agents > /dev/null 2>&1
            echo -e "  ${BLUE}↻ session-management-server${NC}"
        fi
        if service_was_rebuilt "frontend-ui"; then
            kubectl rollout restart deployment frontend-ui -n ai-agents > /dev/null 2>&1
            echo -e "  ${BLUE}↻ frontend-ui${NC}"
        fi
        if service_was_rebuilt "stt-service"; then
            kubectl rollout restart deployment stt-service -n ai-agents > /dev/null 2>&1
            echo -e "  ${BLUE}↻ stt-service${NC}"
        fi
        if service_was_rebuilt "tts-service"; then
            kubectl rollout restart deployment tts-service -n ai-agents > /dev/null 2>&1
            echo -e "  ${BLUE}↻ tts-service${NC}"
        fi
        if service_was_rebuilt "message-recorder-python"; then
            kubectl rollout restart deployment message-recorder -n ai-agents > /dev/null 2>&1
            echo -e "  ${BLUE}↻ message-recorder${NC}"
        fi
    fi
fi

# Wait for deployments that were restarted (or all if rebuild/skip-build mode)
WAIT_BACKEND=false
WAIT_FRONTEND=false
WAIT_STT=false
WAIT_TTS=false

if [ "$REBUILD_MODE" = true ] || [ "$SKIP_BUILD_MODE" = true ] || service_was_rebuilt "session-management-server"; then
    WAIT_BACKEND=true
fi
if [ "$REBUILD_MODE" = true ] || [ "$SKIP_BUILD_MODE" = true ] || service_was_rebuilt "frontend-ui"; then
    WAIT_FRONTEND=true
fi
if [ "$REBUILD_MODE" = true ] || [ "$SKIP_BUILD_MODE" = true ] || service_was_rebuilt "stt-service"; then
    WAIT_STT=true
fi
if [ "$REBUILD_MODE" = true ] || [ "$SKIP_BUILD_MODE" = true ] || service_was_rebuilt "tts-service"; then
    WAIT_TTS=true
fi

if [ "$WAIT_BACKEND" = true ]; then
    echo -n "  • Waiting for backend... "
    kubectl rollout status deployment/session-management-server -n ai-agents --timeout=180s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

if [ "$WAIT_FRONTEND" = true ]; then
    echo -n "  • Waiting for frontend... "
    kubectl rollout status deployment/frontend-ui -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

if [ "$WAIT_STT" = true ]; then
    echo -n "  • Waiting for STT service... "
    kubectl rollout status deployment/stt-service -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

if [ "$WAIT_TTS" = true ]; then
    echo -n "  • Waiting for TTS service... "
    kubectl rollout status deployment/tts-service -n ai-agents --timeout=120s > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi


# Start port-forwards using the daemon script (with auto-restart)
# Create port-forwards for all services:
#   - Frontend: localhost:8080
#   - Backend: localhost:3000
#   - Database: localhost:5432
# In production, Caddy proxies external HTTPS traffic to these localhost ports
echo -e "${GREEN}🌐 Setting up port forwards...${NC}"

# Use the port-forward-daemon.sh script which has auto-restart with exponential backoff
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_FORWARD_DAEMON="$SCRIPT_DIR/port-forward-daemon.sh"

if [ -x "$PORT_FORWARD_DAEMON" ]; then
    if [ "$DAEMON_MODE" = true ]; then
        # Daemon mode: Run port-forward daemon in background
        "$PORT_FORWARD_DAEMON" start -d
    else
        # Foreground mode: Start daemon processes but don't wait
        # The daemon script will manage auto-restart
        "$PORT_FORWARD_DAEMON" start -d
    fi
else
    echo -e "${YELLOW}⚠️  port-forward-daemon.sh not found, falling back to simple port-forwards${NC}"
    # Fallback to simple port-forwards (no auto-restart)
    if [ "$DAEMON_MODE" = true ]; then
        KUBECONFIG_PATH="$KUBECONFIG"
        if [ -z "$KUBECONFIG_PATH" ]; then
            KUBECONFIG_PATH="$HOME/.kube/config"
        fi

        nohup env KUBECONFIG="$KUBECONFIG_PATH" kubectl port-forward -n ai-agents --address 127.0.0.1 svc/frontend-ui 8080:8080 > "$PID_DIR/pf-frontend.log" 2>&1 &
        PF_FRONTEND=$!

        nohup env KUBECONFIG="$KUBECONFIG_PATH" kubectl port-forward -n ai-agents --address 127.0.0.1 svc/session-management-server 3000:3000 > "$PID_DIR/pf-backend.log" 2>&1 &
        PF_BACKEND=$!

        nohup env KUBECONFIG="$KUBECONFIG_PATH" kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 5432:5432 > "$PID_DIR/pf-postgres.log" 2>&1 &
        PF_POSTGRES=$!

        echo "$PF_FRONTEND" > "$PID_DIR/port-forwards.pid"
        echo "$PF_BACKEND" >> "$PID_DIR/port-forwards.pid"
        echo "$PF_POSTGRES" >> "$PID_DIR/port-forwards.pid"

        disown -a
    else
        kubectl port-forward -n ai-agents --address 127.0.0.1 svc/frontend-ui 8080:8080 > /dev/null 2>&1 &
        PF_FRONTEND=$!

        kubectl port-forward -n ai-agents --address 127.0.0.1 svc/session-management-server 3000:3000 > /dev/null 2>&1 &
        PF_BACKEND=$!

        kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 5432:5432 > /dev/null 2>&1 &
        PF_POSTGRES=$!
    fi
fi

echo -e "${GREEN}✓ Port forwards started (with auto-restart)${NC}"

# Give port forwards a moment to initialize
sleep 2

# Cleanup function to stop all services (only for foreground mode)
if [ "$DAEMON_MODE" = false ]; then
  cleanup() {
    echo ""
    echo ""
    echo -e "${YELLOW}🛑 Stopping all services...${NC}"
    echo ""

    # Stop port-forwards using daemon script
    echo -e "${BLUE}Stopping port forwards...${NC}"
    # Compute script path inside function to ensure it's available
    local cleanup_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local cleanup_daemon_script="$cleanup_script_dir/port-forward-daemon.sh"

    if [ -x "$cleanup_daemon_script" ]; then
        "$cleanup_daemon_script" stop
    else
        # Fallback: kill any kubectl port-forward processes for our namespace
        echo -e "  Killing kubectl port-forward processes..."
        pkill -f "kubectl port-forward -n ai-agents" 2>/dev/null || true
        # Also try the old PID-based cleanup
        [ ! -z "$PF_FRONTEND" ] && kill $PF_FRONTEND 2>/dev/null
        [ ! -z "$PF_BACKEND" ] && kill $PF_BACKEND 2>/dev/null
        [ ! -z "$PF_POSTGRES" ] && kill $PF_POSTGRES 2>/dev/null
    fi

    # Clean up temporary files
    echo -e "${BLUE}Cleaning up temporary files...${NC}"
    rm -f ${TEMP_DIR}/04-configmap-updated.yaml
    rm -f ${TEMP_DIR}/06-message-recorder-updated.yaml
    rm -f ${TEMP_DIR}/08-stt-service-gpu.yaml
    rm -f ${TEMP_DIR}/09-tts-service-gpu.yaml
    rm -f ${TEMP_DIR}/k3s-images.tar
    rm -f ${TEMP_DIR}/docker-save-error.log
    rm -f ${TEMP_DIR}/k3s-import.log

    # Stop K3s cluster (Linux only)
    if [[ "$OS_TYPE" == "linux" ]]; then
        echo -e "${BLUE}Stopping K3s cluster...${NC}"
        sudo systemctl stop k3s
    else
        echo -e "${BLUE}K3s managed by Rancher Desktop/Colima (not stopped)${NC}"
    fi

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
echo -e "  ${GREEN}LiveKit (Internal):${NC}  ${LIVEKIT_URL}"
echo -e "  ${GREEN}LiveKit (Public):${NC}    ${PUBLIC_LIVEKIT_URL}"
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
echo -e "  ${YELLOW}• Kubernetes: K3s (unified development & production)${NC}"
echo -e "  ${YELLOW}• LiveKit runs in Docker on host (outside K8s)${NC}"
echo -e "  ${YELLOW}• K8s pods use internal URL: ${LIVEKIT_URL}${NC}"
echo -e "  ${YELLOW}• Browsers use public URL: ${PUBLIC_LIVEKIT_URL}${NC}"
if [[ "$OS_TYPE" == "linux" ]]; then
    echo -e "  ${YELLOW}• Pods use init containers to discover gateway IP dynamically${NC}"
fi
echo -e "  ${YELLOW}• Services exposed via port-forward (8080, 3000, 5432)${NC}"
if [ "$NODE_ENV" = "production" ]; then
    echo -e "  ${YELLOW}• Caddy proxies HTTPS traffic to localhost ports${NC}"
fi
echo ""

if [ "$DAEMON_MODE" = true ]; then
    # Daemon mode: Clean up temporary files and show status
    rm -f ${TEMP_DIR}/04-configmap-updated.yaml
    rm -f ${TEMP_DIR}/06-message-recorder-updated.yaml
    rm -f ${TEMP_DIR}/08-stt-service-gpu.yaml
    rm -f ${TEMP_DIR}/09-tts-service-gpu.yaml
    rm -f ${TEMP_DIR}/k3s-images.tar
    rm -f ${TEMP_DIR}/docker-save-error.log
    rm -f ${TEMP_DIR}/k3s-import.log

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
    echo -e "${RED}⚠️  Press Ctrl+C to stop all services and shutdown K3s${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Keep script running
    tail -f /dev/null
fi
