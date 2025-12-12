#!/bin/bash
# =============================================================================
# validation.sh - Configuration validation (fail-fast)
# =============================================================================

# =============================================================================
# Main Validation Function
# =============================================================================

validate_configuration() {
    info "${EMOJI_GEAR} Validating configuration..."

    local errors=()

    # Required database variables
    [[ -z "${POSTGRES_DB:-}" ]] && errors+=("POSTGRES_DB")
    [[ -z "${POSTGRES_USER:-}" ]] && errors+=("POSTGRES_USER")
    [[ -z "${POSTGRES_PASSWORD:-}" ]] && errors+=("POSTGRES_PASSWORD")

    # Required API keys
    [[ -z "${OPENAI_API_KEY:-}" ]] && errors+=("OPENAI_API_KEY")

    # Required LiveKit configuration
    [[ -z "${LIVEKIT_API_KEY:-}" ]] && errors+=("LIVEKIT_API_KEY")
    [[ -z "${LIVEKIT_API_SECRET:-}" ]] && errors+=("LIVEKIT_API_SECRET")
    [[ -z "${LIVEKIT_URL:-}" ]] && errors+=("LIVEKIT_URL")
    [[ -z "${PUBLIC_LIVEKIT_URL:-}" ]] && errors+=("PUBLIC_LIVEKIT_URL")

    # TURN validation (only if enabled)
    if [[ "${LIVEKIT_TURN_ENABLED:-false}" == "true" ]] && [[ -z "${LIVEKIT_TURN_DOMAIN:-}" ]]; then
        errors+=("LIVEKIT_TURN_DOMAIN (required when LIVEKIT_TURN_ENABLED=true)")
    fi

    # Encryption key validation (required in production, recommended in local)
    if [[ -z "${ENV_VAR_ENCRYPTION_KEY:-}" ]]; then
        if [[ "$NODE_ENV" == "production" ]]; then
            errors+=("ENV_VAR_ENCRYPTION_KEY (required in production for secure env var storage)")
        else
            warning "ENV_VAR_ENCRYPTION_KEY not set - environment variables will NOT be encrypted"
            echo -e "   ${DIM}Generate with: openssl rand -hex 32${NC}"
        fi
    elif [[ ${#ENV_VAR_ENCRYPTION_KEY} -ne 64 ]]; then
        errors+=("ENV_VAR_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate with: openssl rand -hex 32")
    fi

    # Report errors
    if [[ ${#errors[@]} -gt 0 ]]; then
        error "Missing required environment variables:"
        for var in "${errors[@]}"; do
            echo -e "   ${RED}${BULLET}${NC} $var"
        done
        echo ""
        if [[ "$NODE_ENV" == "production" ]]; then
            echo -e "   ${DIM}Configure these in .env.production${NC}"
        else
            echo -e "   ${DIM}Configure these in .env.local${NC}"
        fi
        exit 1
    fi

    # Validate Docker
    validate_docker

    # Validate kubectl
    validate_kubectl

    # Validate ports (in local mode)
    if [[ "$NODE_ENV" != "production" ]]; then
        validate_ports
    fi

    success "Configuration valid"
}

# =============================================================================
# Docker Validation
# =============================================================================

validate_docker() {
    if ! docker info >/dev/null 2>&1; then
        error "Docker is not running"

        if [[ "$OS_TYPE" == "macos" ]]; then
            echo ""
            echo -e "   ${DIM}Start OrbStack or Docker Desktop${NC}"
        else
            echo ""
            echo -e "   ${DIM}Start Docker:${NC}"
            echo -e "   ${DIM}  sudo systemctl start docker${NC}"
            echo -e "   ${DIM}  sudo usermod -aG docker \$USER${NC}"
        fi
        exit 1
    fi

    verbose "Docker: running"
}

# =============================================================================
# Kubectl Validation
# =============================================================================

validate_kubectl() {
    if ! command_exists kubectl; then
        if [[ "$DRY_RUN_MODE" == "true" ]]; then
            warning "kubectl not installed (dry-run mode, continuing)"
            return
        fi

        info "Installing kubectl..."
        install_kubectl
    fi

    verbose "kubectl: $(kubectl version --client --short 2>/dev/null || echo 'installed')"
}

install_kubectl() {
    if [[ "$OS_TYPE" == "macos" ]]; then
        if command_exists brew; then
            brew install kubectl >/dev/null 2>&1
        else
            error "kubectl not found. Install with: brew install kubectl"
            exit 1
        fi
    else
        # Linux: Download from official source
        local version
        version=$(curl -sL https://dl.k8s.io/release/stable.txt)
        curl -sLO "https://dl.k8s.io/release/${version}/bin/linux/amd64/kubectl"
        sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
        rm -f kubectl
    fi
}

# =============================================================================
# Port Validation
# =============================================================================

validate_ports() {
    local ports_to_check=(8080 3000)
    local blocked_ports=()

    for port in "${ports_to_check[@]}"; do
        if ! port_available "$port"; then
            blocked_ports+=("$port")
        fi
    done

    if [[ ${#blocked_ports[@]} -gt 0 ]]; then
        warning "Ports in use: ${blocked_ports[*]}"
        verbose "Port-forwards may conflict with existing services"
    fi
}

# =============================================================================
# Build Prerequisites
# =============================================================================

validate_build_prerequisites() {
    # Check disk space
    local available_space
    if [[ "$OS_TYPE" == "macos" ]]; then
        available_space=$(df -g "$TEMP_DIR" | awk 'NR==2 {print $4}')
    else
        available_space=$(df -BG "$TEMP_DIR" | awk 'NR==2 {print $4}' | tr -d 'G')
    fi

    if [[ "${available_space:-0}" -lt 5 ]]; then
        warning "Low disk space: ${available_space}GB available in $TEMP_DIR"
        echo -e "   ${DIM}Consider running: docker system prune -af${NC}"
    fi

    verbose "Disk space: ${available_space}GB available"

    # Check Docker BuildKit
    if docker buildx version >/dev/null 2>&1; then
        verbose "BuildKit: available"
    else
        verbose "BuildKit: not available (using legacy builder)"
    fi
}

# =============================================================================
# K3s Prerequisites
# =============================================================================

validate_k3s_prerequisites() {
    if [[ "$OS_TYPE" == "linux" ]]; then
        # Check if K3s is installed
        if ! command_exists k3s; then
            verbose "K3s not installed, will install during setup"
            return 0
        fi

        # Check if K3s is running
        if ! sudo systemctl is-active --quiet k3s 2>/dev/null; then
            verbose "K3s installed but not running"
            return 0
        fi

        verbose "K3s: running"
    else
        # macOS: Check for OrbStack k3s context
        if kubectl config get-contexts 2>/dev/null | grep -q "orbstack"; then
            verbose "K3s context: orbstack"
        else
            verbose "K3s context: will auto-detect"
        fi
    fi
}
