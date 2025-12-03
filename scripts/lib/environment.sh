#!/bin/bash
# =============================================================================
# environment.sh - Environment detection and configuration loading
# =============================================================================

# =============================================================================
# OS and Platform Detection (single-pass)
# =============================================================================

detect_platform() {
    # OS Detection
    case "$OSTYPE" in
        darwin*)  export OS_TYPE="macos" ;;
        linux*)   export OS_TYPE="linux" ;;
        *)        export OS_TYPE="linux"; warning "Unknown OS: $OSTYPE, defaulting to linux" ;;
    esac

    # Docker host configuration
    if [[ "$OS_TYPE" == "macos" ]]; then
        # macOS: OrbStack or Docker Desktop via dynamic detection
        if [[ -S "$HOME/.orbstack/run/docker.sock" ]]; then
            export DOCKER_HOST="unix://$HOME/.orbstack/run/docker.sock"
            export K8S_CONTEXT="orbstack"
        elif [[ -S "$HOME/.docker/run/docker.sock" ]]; then
            export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
            export K8S_CONTEXT="docker-desktop"
        else
            export DOCKER_HOST="unix:///var/run/docker.sock"
            export K8S_CONTEXT="default"
        fi
    else
        # Linux: Standard Docker socket
        export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
        export K8S_CONTEXT="default"
    fi

    verbose "OS: $OS_TYPE | Docker: $DOCKER_HOST"
}

# =============================================================================
# Directory Setup
# =============================================================================

setup_directories() {
    # Script and project paths
    # BASH_SOURCE[0] is this file (lib/environment.sh)
    # We need to go up two levels (lib -> scripts -> project)
    local lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    export SCRIPT_DIR="$(dirname "$lib_dir")"
    export PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    export WORKSPACE_ROOT="$(dirname "$PROJECT_DIR")"

    # Temp directory (can be overridden by GRACE_AI_TEMP_DIR in .env)
    export TEMP_DIR="${GRACE_AI_TEMP_DIR:-/tmp}"
    export PID_DIR="${TEMP_DIR}/grace-ai-k8s"
    export LOG_DIR="${TEMP_DIR}/grace-ai-logs"
    export CHECKSUM_DIR="${TEMP_DIR}/grace-ai-checksums"

    # Create required directories
    ensure_dir "$PID_DIR"
    ensure_dir "$LOG_DIR"
    ensure_dir "$CHECKSUM_DIR"

    verbose "Project: $PROJECT_DIR"
    verbose "Temp: $TEMP_DIR"
}

# =============================================================================
# Environment File Loading
# =============================================================================

load_env_file() {
    local env_file="$1"
    local label="$2"

    if [[ -f "$env_file" ]]; then
        verbose "Loading $label: $env_file"
        set -a  # automatically export all variables
        # shellcheck disable=SC1090
        # Use direct source - more reliable than process substitution
        source "$env_file"
        set +a
        return 0
    fi
    return 1
}

load_environment() {
    info "${EMOJI_GEAR} Loading configuration..."

    # Change to project directory
    cd "$PROJECT_DIR" || { error "Cannot change to project directory: $PROJECT_DIR"; exit 1; }

    # Load base .env (required)
    if ! load_env_file ".env" "base"; then
        error "Missing .env file"
        echo "  Run: cp .env.example .env && nano .env"
        exit 1
    fi

    # Set NODE_ENV from flag or default to local
    export NODE_ENV="${ENV_FLAG:-local}"

    # Load environment-specific overrides
    if [[ "$NODE_ENV" == "production" ]]; then
        load_env_file ".env.production" "production" || true
    else
        load_env_file ".env.local" "local" || true
    fi

    # Update temp directory after loading env (may be set in .env)
    if [[ -n "${GRACE_AI_TEMP_DIR:-}" ]]; then
        export TEMP_DIR="$GRACE_AI_TEMP_DIR"
        export PID_DIR="${TEMP_DIR}/grace-ai-k8s"
        export LOG_DIR="${TEMP_DIR}/grace-ai-logs"
        export CHECKSUM_DIR="${TEMP_DIR}/grace-ai-checksums"
        ensure_dir "$PID_DIR"
        ensure_dir "$LOG_DIR"
        ensure_dir "$CHECKSUM_DIR"
    fi

    # Configure URLs based on environment
    configure_urls

    # Set hardcoded defaults
    set_defaults

    echo -e "   ${ARROW} OS: ${BOLD}${OS_TYPE}${NC} | Mode: ${BOLD}${NODE_ENV}${NC}"
}

# =============================================================================
# URL Configuration
# =============================================================================

configure_urls() {
    if [[ "$NODE_ENV" == "production" ]]; then
        # Production URLs (custom domains with SSL)
        export PUBLIC_FRONTEND_URL="https://frontend.${PRODUCTION_DOMAIN:-localhost}"
        export PUBLIC_API_URL="https://backend.${PRODUCTION_DOMAIN:-localhost}"
        export PUBLIC_DB_HOST="db.${PRODUCTION_DOMAIN:-localhost}"
        export PUBLIC_DB_PORT="5432"
        export CORS_ORIGIN="https://frontend.${PRODUCTION_DOMAIN:-localhost}"
    else
        # Local URLs
        export PUBLIC_FRONTEND_URL="http://localhost:8080"
        export PUBLIC_API_URL="http://localhost:3000"
        export PUBLIC_DB_HOST="localhost"
        export PUBLIC_DB_PORT="5432"
        export CORS_ORIGIN="http://localhost:8080"
    fi

    # Map PUBLIC_LIVEKIT_URL to VITE_LIVEKIT_URL for frontend
    export VITE_LIVEKIT_URL="${PUBLIC_LIVEKIT_URL:-ws://localhost:7880}"

    verbose "Frontend: $PUBLIC_FRONTEND_URL"
    verbose "Backend: $PUBLIC_API_URL"
    verbose "LiveKit (internal): ${LIVEKIT_URL:-not set}"
    verbose "LiveKit (public): ${PUBLIC_LIVEKIT_URL:-not set}"
}

# =============================================================================
# Default Values
# =============================================================================

set_defaults() {
    # Backend port
    export PORT="${PORT:-3000}"

    # Kubernetes configuration
    export KUBERNETES_NAMESPACE="${KUBERNETES_NAMESPACE:-ai-agents}"
    export DEFAULT_AGENT_TYPE="${DEFAULT_AGENT_TYPE:-grace-agent}"
    export AGENT_IMAGE_PULL_POLICY="${AGENT_IMAGE_PULL_POLICY:-IfNotPresent}"

    # Legacy compatibility
    export PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-localhost}"
    export ENABLE_NETWORK_ACCESS="${ENABLE_NETWORK_ACCESS:-false}"

    # Frontend configuration
    export VITE_USE_INPAGE_MOCK="${VITE_USE_INPAGE_MOCK:-0}"

    # Python Agent defaults
    export ROOM_NAME="${ROOM_NAME:-voice-ai-room}"
    export IDENTITY="${IDENTITY:-python-listener}"

    # STT Configuration
    export STT_PROVIDER="${STT_PROVIDER:-sherpa}"
    export WHISPER_MODEL="${WHISPER_MODEL:-large-v3}"
    export WHISPER_DEVICE="${WHISPER_DEVICE:-cpu}"
    export WHISPER_COMPUTE_TYPE="${WHISPER_COMPUTE_TYPE:-int8}"
    export WHISPER_BEAM_SIZE="${WHISPER_BEAM_SIZE:-5}"
    export WHISPER_LANGUAGE="${WHISPER_LANGUAGE:-}"

    # VAD Configuration
    export VAD_THRESHOLD="${VAD_THRESHOLD:-0.5}"
    export VAD_MIN_SPEECH_MS="${VAD_MIN_SPEECH_MS:-250}"
    export VAD_MIN_SILENCE_MS="${VAD_MIN_SILENCE_MS:-500}"
    export PARTIAL_INTERVAL_MS="${PARTIAL_INTERVAL_MS:-1000}"

    # TTS Configuration
    export TTS_PROVIDER="${TTS_PROVIDER:-edge_tts}"
    export ELEVENLABS_STABILITY="${ELEVENLABS_STABILITY:-0.5}"
    export ELEVENLABS_SIMILARITY_BOOST="${ELEVENLABS_SIMILARITY_BOOST:-0.8}"
    export ELEVENLABS_STYLE="${ELEVENLABS_STYLE:-0.0}"
    export ELEVENLABS_USE_SPEAKER_BOOST="${ELEVENLABS_USE_SPEAKER_BOOST:-true}"
    export KOKORO_MODEL_PATH="${KOKORO_MODEL_PATH:-./kokoro-models/kokoro-v1.0.onnx}"
    export KOKORO_VOICES_PATH="${KOKORO_VOICES_PATH:-./kokoro-models/voices-v1.0.bin}"
    export KOKORO_CACHE_DIR="${KOKORO_CACHE_DIR:-/root/.cache/kokoro}"

    # GPU Configuration
    export ENABLE_GPU="${ENABLE_GPU:-false}"

    # ONNX Provider (auto-set based on GPU)
    if [[ -z "${ONNX_PROVIDER:-}" ]]; then
        if [[ "$ENABLE_GPU" == "true" ]]; then
            export ONNX_PROVIDER="CUDAExecutionProvider,CPUExecutionProvider"
        else
            export ONNX_PROVIDER="CPUExecutionProvider"
        fi
    fi

    # TURN Configuration
    export LIVEKIT_TURN_ENABLED="${LIVEKIT_TURN_ENABLED:-false}"
    export LIVEKIT_TURN_DOMAIN="${LIVEKIT_TURN_DOMAIN:-localhost}"

    # Barge-in Configuration
    export MIN_INTERRUPTION_DURATION="${MIN_INTERRUPTION_DURATION:-0.5}"
    export MIN_INTERRUPTION_WORDS="${MIN_INTERRUPTION_WORDS:-1}"
    export FALSE_INTERRUPTION_TIMEOUT="${FALSE_INTERRUPTION_TIMEOUT:-2.0}"
}

# =============================================================================
# Main Detection Function
# =============================================================================

detect_environment() {
    detect_platform
    setup_directories
}
