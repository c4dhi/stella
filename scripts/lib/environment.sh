#!/bin/bash
# =============================================================================
# environment.sh - Environment detection and configuration loading
# =============================================================================

# Note: This file is sourced by start-k8s.sh after colors.sh and utils.sh
# Some functions may not be available until after sourcing is complete

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

    # Temp directory (can be overridden by STELLA_AI_TEMP_DIR in .env)
    export TEMP_DIR="${STELLA_AI_TEMP_DIR:-/tmp}"
    export PID_DIR="${TEMP_DIR}/stella-ai-k8s"
    export LOG_DIR="${TEMP_DIR}/stella-ai-logs"
    export CHECKSUM_DIR="${TEMP_DIR}/stella-ai-checksums"

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

    # Set NODE_ENV from flag or default to local (needed for check_setup_status)
    export NODE_ENV="${ENV_FLAG:-local}"

    # Load base .env if it exists (may not exist on fresh install)
    # check_setup_status will handle missing config and offer the wizard
    if [[ -f ".env" ]]; then
        load_env_file ".env" "base" || true
    else
        verbose "No .env file found - setup wizard will be offered"
    fi

    # Load environment-specific overrides
    if [[ "$NODE_ENV" == "production" ]]; then
        load_env_file ".env.production" "production" || true
    else
        load_env_file ".env.local" "local" || true
    fi

    # Update temp directory after loading env (may be set in .env)
    if [[ -n "${STELLA_AI_TEMP_DIR:-}" ]]; then
        export TEMP_DIR="$STELLA_AI_TEMP_DIR"
        export PID_DIR="${TEMP_DIR}/stella-ai-k8s"
        export LOG_DIR="${TEMP_DIR}/stella-ai-logs"
        export CHECKSUM_DIR="${TEMP_DIR}/stella-ai-checksums"
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
# GPU Detection and Auto-Configuration
# =============================================================================

detect_gpu() {
    # Check if NVIDIA GPU is available
    if command -v nvidia-smi &>/dev/null; then
        if nvidia-smi &>/dev/null; then
            # Get GPU info
            local gpu_name
            gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
            local driver_version
            driver_version=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)
            local cuda_version
            cuda_version=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)

            export GPU_AVAILABLE="true"
            export GPU_NAME="${gpu_name:-Unknown}"
            export GPU_DRIVER="${driver_version:-Unknown}"

            verbose "GPU detected: $GPU_NAME (Driver: $GPU_DRIVER)"
            return 0
        fi
    fi

    export GPU_AVAILABLE="false"
    export GPU_NAME=""
    export GPU_DRIVER=""
    return 1
}

# Auto-configure GPU settings for production
configure_gpu_settings() {
    # First detect GPU (|| true to prevent exit on no GPU)
    detect_gpu || true

    # In production mode with GPU available, auto-enable GPU if not explicitly set
    if [[ "$NODE_ENV" == "production" && "$GPU_AVAILABLE" == "true" ]]; then
        # Only auto-set if ENABLE_GPU was not explicitly configured
        if [[ -z "${ENABLE_GPU_SET_BY_USER:-}" ]]; then
            export ENABLE_GPU="true"
            verbose "Auto-enabled GPU for production (detected: $GPU_NAME)"
        fi

        # Auto-configure optimal providers for GPU
        if [[ "$ENABLE_GPU" == "true" ]]; then
            # STT: Use Whisper with CUDA for best quality
            if [[ -z "${STT_PROVIDER_SET_BY_USER:-}" ]]; then
                export STT_PROVIDER="whisper"
                export WHISPER_DEVICE="cuda"
                export WHISPER_COMPUTE_TYPE="float16"
                verbose "Auto-configured STT: whisper (CUDA, float16)"
            fi

            # TTS: Use Kokoro with CUDA for lowest latency
            if [[ -z "${TTS_PROVIDER_SET_BY_USER:-}" ]]; then
                export TTS_PROVIDER="kokoro"
                verbose "Auto-configured TTS: kokoro (CUDA)"
            fi

            # ONNX Provider for GPU
            if [[ -z "${ONNX_PROVIDER_SET_BY_USER:-}" ]]; then
                export ONNX_PROVIDER="CUDAExecutionProvider,CPUExecutionProvider"
                verbose "Auto-configured ONNX: CUDAExecutionProvider"
            fi
        fi
    fi

    # Show GPU status in output
    if [[ "$GPU_AVAILABLE" == "true" ]]; then
        if [[ "$ENABLE_GPU" == "true" ]]; then
            echo -e "   ${ARROW} GPU: ${GREEN}${CHECK}${NC} ${GPU_NAME} ${DIM}(CUDA enabled)${NC}"
        else
            echo -e "   ${ARROW} GPU: ${YELLOW}${GPU_NAME}${NC} ${DIM}(available but not enabled)${NC}"
        fi
    else
        if [[ "$NODE_ENV" == "production" ]]; then
            echo -e "   ${ARROW} GPU: ${DIM}Not detected (using CPU)${NC}"
        fi
    fi
}

# =============================================================================
# Default Values
# =============================================================================

set_defaults() {
    # Backend port
    export PORT="${PORT:-3000}"

    # Kubernetes configuration
    export KUBERNETES_NAMESPACE="${KUBERNETES_NAMESPACE:-ai-agents}"
    export DEFAULT_AGENT_TYPE="${DEFAULT_AGENT_TYPE:-stella-agent}"
    export AGENT_IMAGE_PULL_POLICY="${AGENT_IMAGE_PULL_POLICY:-IfNotPresent}"

    # Legacy compatibility
    export PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-localhost}"
    export ENABLE_NETWORK_ACCESS="${ENABLE_NETWORK_ACCESS:-false}"

    # Frontend configuration
    export VITE_USE_INPAGE_MOCK="${VITE_USE_INPAGE_MOCK:-0}"

    # Python Agent defaults
    export ROOM_NAME="${ROOM_NAME:-voice-ai-room}"
    export IDENTITY="${IDENTITY:-python-listener}"

    # Track if user explicitly set these (before we apply defaults)
    [[ -n "${ENABLE_GPU:-}" ]] && export ENABLE_GPU_SET_BY_USER="true"
    [[ -n "${STT_PROVIDER:-}" ]] && export STT_PROVIDER_SET_BY_USER="true"
    [[ -n "${TTS_PROVIDER:-}" ]] && export TTS_PROVIDER_SET_BY_USER="true"
    [[ -n "${ONNX_PROVIDER:-}" ]] && export ONNX_PROVIDER_SET_BY_USER="true"

    # STT Configuration (defaults - may be overridden by GPU auto-config)
    export STT_PROVIDER="${STT_PROVIDER:-sherpa}"
    export WHISPER_MODEL="${WHISPER_MODEL:-large-v3}"
    export WHISPER_DEVICE="${WHISPER_DEVICE:-cpu}"
    export WHISPER_COMPUTE_TYPE="${WHISPER_COMPUTE_TYPE:-int8}"
    export WHISPER_BEAM_SIZE="${WHISPER_BEAM_SIZE:-5}"
    export WHISPER_LANGUAGE="${WHISPER_LANGUAGE:-}"

    # VAD Configuration
    export VAD_THRESHOLD="${VAD_THRESHOLD:-0.5}"
    export VAD_MIN_SPEECH_MS="${VAD_MIN_SPEECH_MS:-200}"
    export VAD_MIN_SILENCE_MS="${VAD_MIN_SILENCE_MS:-500}"
    export PARTIAL_INTERVAL_MS="${PARTIAL_INTERVAL_MS:-1000}"
    export WHISPER_INITIAL_PROMPT="${WHISPER_INITIAL_PROMPT:-}"

    # TTS Configuration (defaults - may be overridden by GPU auto-config)
    export TTS_PROVIDER="${TTS_PROVIDER:-edge_tts}"
    export ELEVENLABS_STABILITY="${ELEVENLABS_STABILITY:-0.5}"
    export ELEVENLABS_SIMILARITY_BOOST="${ELEVENLABS_SIMILARITY_BOOST:-0.8}"
    export ELEVENLABS_STYLE="${ELEVENLABS_STYLE:-0.0}"
    export ELEVENLABS_USE_SPEAKER_BOOST="${ELEVENLABS_USE_SPEAKER_BOOST:-true}"
    export KOKORO_MODEL_PATH="${KOKORO_MODEL_PATH:-./kokoro-models/kokoro-v1.0.onnx}"
    export KOKORO_VOICES_PATH="${KOKORO_VOICES_PATH:-./kokoro-models/voices-v1.0.bin}"
    export KOKORO_CACHE_DIR="${KOKORO_CACHE_DIR:-/root/.cache/kokoro}"

    # GPU Configuration (default - will be auto-detected in production)
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

    # Auto-configure GPU settings (after defaults are set)
    configure_gpu_settings
}

# =============================================================================
# Setup Status Detection
# =============================================================================

# Check if setup has been completed for current environment
# Returns 0 if setup is complete, 1 if not
#
# Priority: If all required variables are present in .env, skip the wizard
# even if the marker file is missing. The marker file is secondary.
check_setup_status() {
    local marker_file="$PROJECT_DIR/.stella-setup-complete"
    local current_mode="${NODE_ENV:-local}"

    # 1. First check if all critical variables are present
    #    If they are, setup is considered complete regardless of marker file
    local missing_vars=()

    [[ -z "${POSTGRES_PASSWORD:-}" ]] && missing_vars+=("POSTGRES_PASSWORD")
    [[ -z "${JWT_SECRET:-}" ]] && missing_vars+=("JWT_SECRET")
    [[ -z "${OPENAI_API_KEY:-}" ]] && missing_vars+=("OPENAI_API_KEY")

    # For production, also check additional requirements
    if [[ "$current_mode" == "production" ]]; then
        [[ -z "${ENV_VAR_ENCRYPTION_KEY:-}" ]] && missing_vars+=("ENV_VAR_ENCRYPTION_KEY")
        [[ -z "${LIVEKIT_API_KEY:-}" ]] && missing_vars+=("LIVEKIT_API_KEY")
        [[ -z "${LIVEKIT_API_SECRET:-}" ]] && missing_vars+=("LIVEKIT_API_SECRET")
        [[ -z "${PRODUCTION_DOMAIN:-}" ]] && missing_vars+=("PRODUCTION_DOMAIN")
    fi

    # 2. If all variables are present, setup is complete
    if [[ ${#missing_vars[@]} -eq 0 ]]; then
        # Auto-create marker file if it doesn't exist or doesn't match
        if [[ ! -f "$marker_file" ]] || [[ "$(cat "$marker_file" 2>/dev/null)" != "$current_mode" ]]; then
            verbose "All variables present, auto-creating setup marker for: $current_mode"
            echo "$current_mode" > "$marker_file"
        fi
        return 0
    fi

    # 3. Variables are missing - report them
    for var in "${missing_vars[@]}"; do
        verbose "Missing critical variable: $var"
    done
    return 1
}

# Mark setup as complete for given environment
mark_setup_complete() {
    local env="${1:-${NODE_ENV:-local}}"
    local marker_file="$PROJECT_DIR/.stella-setup-complete"

    echo "$env" > "$marker_file"
    verbose "Marked setup complete for: $env"
}

# Clear setup marker (force re-setup)
clear_setup_marker() {
    local marker_file="$PROJECT_DIR/.stella-setup-complete"

    if [[ -f "$marker_file" ]]; then
        rm -f "$marker_file"
        verbose "Cleared setup marker"
    fi
}

# Get the environment mode from setup marker
get_setup_mode() {
    local marker_file="$PROJECT_DIR/.stella-setup-complete"

    if [[ -f "$marker_file" ]]; then
        cat "$marker_file" 2>/dev/null || echo ""
    fi
}

# =============================================================================
# Main Detection Function
# =============================================================================

detect_environment() {
    detect_platform
    setup_directories
}
