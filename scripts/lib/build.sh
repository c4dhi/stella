#!/bin/bash
# =============================================================================
# build.sh - Smart Docker build system with content-addressable caching
# =============================================================================

# Track rebuilt services
declare -a REBUILT_SERVICES=()

# =============================================================================
# BuildKit Detection and Setup
# =============================================================================

setup_buildkit() {
    USE_BUILDKIT=false

    if docker buildx version >/dev/null 2>&1; then
        USE_BUILDKIT=true
        verbose "BuildKit: available"
        return 0
    fi

    verbose "BuildKit: not available"

    # Auto-install on Linux
    if [[ "$OS_TYPE" == "linux" ]]; then
        verbose "Installing docker-buildx..."

        # Try package installation first
        if sudo apt-get install -y docker-buildx-plugin >/dev/null 2>&1; then
            if docker buildx version >/dev/null 2>&1; then
                USE_BUILDKIT=true
                verbose "BuildKit: installed via apt"
                return 0
            fi
        fi

        # Manual installation fallback
        mkdir -p ~/.docker/cli-plugins
        local buildx_version
        buildx_version=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')

        if curl -sL "https://github.com/docker/buildx/releases/download/v${buildx_version}/buildx-v${buildx_version}.linux-amd64" -o ~/.docker/cli-plugins/docker-buildx; then
            chmod +x ~/.docker/cli-plugins/docker-buildx
            if docker buildx version >/dev/null 2>&1; then
                USE_BUILDKIT=true
                verbose "BuildKit: installed manually (v${buildx_version})"
                return 0
            fi
        fi

        verbose "BuildKit: installation failed, using legacy builder"
    fi

    export USE_BUILDKIT
}

# =============================================================================
# Checksum Calculation (with .env support)
# =============================================================================

calculate_service_checksum() {
    local service_name="$1"
    local service_dir="$2"
    local dockerfile="$3"

    local checksum=""

    # Hash source files
    if [[ "$OS_TYPE" == "macos" ]]; then
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

    # Add Dockerfile hash
    if [[ -f "$dockerfile" ]]; then
        checksum="${checksum}$(hash_file "$dockerfile")"
    fi

    # KEY IMPROVEMENT: Add .env files to checksum
    # This ensures rebuilds when ENABLE_GPU, STT_PROVIDER, etc. change
    for env_file in "$PROJECT_DIR/.env" "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env.production"; do
        if [[ -f "$env_file" ]]; then
            checksum="${checksum}$(hash_file "$env_file")"
        fi
    done

    # Final combined hash
    echo "$checksum" | hash_string
}

# =============================================================================
# Checksum Management
# =============================================================================

service_needs_rebuild() {
    local service_name="$1"
    local service_dir="$2"
    local dockerfile="$3"

    local current_checksum
    current_checksum=$(calculate_service_checksum "$service_name" "$service_dir" "$dockerfile")
    local cached_checksum_file="${CHECKSUM_DIR}/${service_name}.checksum"

    # No cached checksum = needs rebuild
    if [[ ! -f "$cached_checksum_file" ]]; then
        echo "$current_checksum" > "$cached_checksum_file"
        return 0
    fi

    local cached_checksum
    cached_checksum=$(cat "$cached_checksum_file")

    if [[ "$current_checksum" != "$cached_checksum" ]]; then
        echo "$current_checksum" > "$cached_checksum_file"
        return 0
    fi

    return 1
}

update_service_checksum() {
    local service_name="$1"
    local service_dir="$2"
    local dockerfile="$3"

    local current_checksum
    current_checksum=$(calculate_service_checksum "$service_name" "$service_dir" "$dockerfile")
    echo "$current_checksum" > "${CHECKSUM_DIR}/${service_name}.checksum"
}

clear_all_checksums() {
    rm -f "${CHECKSUM_DIR}"/*.checksum 2>/dev/null || true
}

# =============================================================================
# Single-Line Build Progress
# =============================================================================

build_with_progress() {
    local image_name="$1"
    local tag="$2"
    local context="$3"
    local build_args="${4:-}"
    local dockerfile="${5:-Dockerfile}"

    local log_file="${LOG_DIR}/docker-build-${image_name}.log"

    # Dry-run mode
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        echo -e "   ${ARROW} ${image_name}... ${YELLOW}[dry-run]${NC}"
        return 0
    fi

    # Build flags
    local no_cache=""
    [[ "$REBUILD_MODE" == "true" ]] && no_cache="--no-cache"

    # Start build in background
    if [[ "$USE_BUILDKIT" == "true" ]]; then
        DOCKER_BUILDKIT=1 docker build --progress=plain ${no_cache} ${build_args} \
            -f "${dockerfile}" --network=host -t "${tag}" "${context}" > "${log_file}" 2>&1 &
    else
        docker build ${no_cache} ${build_args} \
            -f "${dockerfile}" --network=host -t "${tag}" "${context}" > "${log_file}" 2>&1 &
    fi

    local build_pid=$!

    # Single-line progress display
    echo -ne "   ${ARROW} ${image_name}... "

    local last_step=""
    while kill -0 $build_pid 2>/dev/null; do
        if [[ -f "$log_file" ]]; then
            # Extract current step (e.g., "[5/12]" or "Step 5/12")
            local current
            current=$(tail -n 30 "$log_file" 2>/dev/null | \
                grep -oE '\[#?[0-9]+ [0-9]+/[0-9]+\]|Step [0-9]+/[0-9]+|\[[0-9]+/[0-9]+\]' | tail -1)

            if [[ -n "$current" && "$current" != "$last_step" ]]; then
                # Update line in place
                echo -ne "\r   ${ARROW} ${image_name}... ${DIM}${current}${NC}    "
                last_step="$current"
            fi
        fi
        sleep 0.3
    done

    wait $build_pid
    local exit_code=$?

    # Clear line and show final status
    if [[ $exit_code -eq 0 ]]; then
        echo -e "\r   ${ARROW} ${image_name}... ${GREEN}${CHECK}${NC}                    "
        rm -f "$log_file"
    else
        echo -e "\r   ${ARROW} ${image_name}... ${RED}${CROSS}${NC}                    "
        error "Build failed. Log: $log_file"
        return 1
    fi
}

# =============================================================================
# Smart Build Wrapper
# =============================================================================

smart_build() {
    local image_name="$1"
    local tag="$2"
    local context="$3"
    local build_args="${4:-}"
    local dockerfile="${5:-Dockerfile}"

    # Skip-build mode
    if [[ "$SKIP_BUILD_MODE" == "true" ]]; then
        echo -e "   ${ARROW} ${image_name}... ${YELLOW}skipped${NC}"
        return 1
    fi

    # Determine paths
    local service_dir="$context"
    local dockerfile_path="${context}/${dockerfile}"
    [[ "$context" == "." ]] && dockerfile_path="./${dockerfile}"

    # Rebuild mode: always build
    if [[ "$REBUILD_MODE" == "true" ]]; then
        build_with_progress "$image_name" "$tag" "$context" "$build_args" "$dockerfile_path"
        update_service_checksum "$image_name" "$service_dir" "$dockerfile_path"
        REBUILT_SERVICES+=("$image_name")
        return 0
    fi

    # Smart mode: check if rebuild needed
    if service_needs_rebuild "$image_name" "$service_dir" "$dockerfile_path"; then
        build_with_progress "$image_name" "$tag" "$context" "$build_args" "$dockerfile_path"
        update_service_checksum "$image_name" "$service_dir" "$dockerfile_path"
        REBUILT_SERVICES+=("$image_name")
        return 0
    else
        echo -e "   ${ARROW} ${image_name}... ${DIM}unchanged${NC}"
        return 1
    fi
}

# =============================================================================
# Build All Images
# =============================================================================

build_images() {
    info "${EMOJI_BUILD} Building Docker images..."

    # Setup BuildKit
    setup_buildkit

    # Clean up if rebuild mode
    if [[ "$REBUILD_MODE" == "true" ]]; then
        cleanup_for_rebuild
    fi

    # Reset rebuilt services list
    REBUILT_SERVICES=()

    # Build session-management-server
    local prisma_checksum
    prisma_checksum=$(hash_file "./prisma/schema.prisma" 2>/dev/null || echo "none")
    local db_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
    local session_args="--build-arg PRISMA_SCHEMA_CHECKSUM=${prisma_checksum} --build-arg DATABASE_URL=${db_url}"
    smart_build "session-management-server" "session-management-server:latest" "." "$session_args" || true

    # Build STT service
    local stt_args=""
    if [[ "$ENABLE_GPU" == "true" ]]; then
        stt_args="--build-arg ENABLE_GPU=true"
    fi
    smart_build "stt-service" "stt-service:latest" "./stt-service" "$stt_args" || true

    # Build TTS service
    local tts_args=""
    if [[ "$ENABLE_GPU" == "true" ]]; then
        tts_args="--build-arg ENABLE_GPU=true"
    fi
    smart_build "tts-service" "tts-service:latest" "./tts-service" "$tts_args" || true

    # Build frontend
    smart_build "frontend-ui" "frontend-ui:latest" "./frontend-ui" || true

    # Build message recorder
    smart_build "message-recorder-python" "message-recorder-python:latest" "./message-recorder-python" || true

    # Build stella-agent (pre-build to avoid on-demand building in production)
    # The agent images are built from the agents/ directory
    smart_build "stella-agent" "stella-agent:latest" "." "" "agents/stella-agent/Dockerfile" || true

    # Build echo-agent
    smart_build "echo-agent" "echo-agent:latest" "." "" "agents/echo-agent/Dockerfile" || true

    # Build stella-light-agent
    smart_build "stella-light-agent" "stella-light-agent:latest" "." "" "agents/stella-light-agent/Dockerfile" || true

    # Summary
    if [[ ${#REBUILT_SERVICES[@]} -gt 0 ]]; then
        success "Built ${#REBUILT_SERVICES[@]} image(s): ${REBUILT_SERVICES[*]}"
    else
        success "All images up to date"
    fi

    # Import to K3s if on Linux
    if [[ "$OS_TYPE" == "linux" && ${#REBUILT_SERVICES[@]} -gt 0 ]]; then
        import_images_to_k3s
    fi

    # Always sync images to K3s on Linux (ensure all images are available)
    # This catches cases where images exist in Docker but not in K3s containerd
    if [[ "$OS_TYPE" == "linux" ]]; then
        sync_images_to_k3s
    fi
}

# =============================================================================
# K3s Image Import (Linux only)
# =============================================================================

import_images_to_k3s() {
    [[ "$DRY_RUN_MODE" == "true" ]] && return 0
    [[ ${#REBUILT_SERVICES[@]} -eq 0 ]] && return 0

    info "${EMOJI_GEAR} Importing images to K3s..."

    for service in "${REBUILT_SERVICES[@]}"; do
        echo -ne "   ${ARROW} ${service}... "

        if docker save "${service}:latest" | sudo k3s ctr images import - >/dev/null 2>&1; then
            echo -e "${GREEN}${CHECK}${NC}"
        else
            echo -e "${RED}${CROSS}${NC}"
            warning "Failed to import ${service} to K3s"
        fi
    done
}

# =============================================================================
# K3s Image Sync (Linux only)
# =============================================================================
# Ensures all images that exist in Docker are also available in K3s containerd.
# This handles cases where images exist in Docker but not K3s (e.g., after
# a partial deploy or when images were built outside of start-k8s.sh).

sync_images_to_k3s() {
    [[ "$DRY_RUN_MODE" == "true" ]] && return 0

    local all_images=("session-management-server" "stt-service" "tts-service" "frontend-ui" "message-recorder-python" "stella-agent" "echo-agent" "stella-light-agent")
    local images_to_sync=()

    # Find images that exist in Docker but not in K3s
    for img in "${all_images[@]}"; do
        # Check if image exists in Docker
        if docker images -q "${img}:latest" 2>/dev/null | grep -q .; then
            # Check if image exists in K3s containerd
            if ! sudo k3s ctr images ls -q 2>/dev/null | grep -q "docker.io/library/${img}:latest"; then
                images_to_sync+=("$img")
            fi
        fi
    done

    # Sync missing images
    if [[ ${#images_to_sync[@]} -gt 0 ]]; then
        info "${EMOJI_GEAR} Syncing missing images to K3s..."
        for img in "${images_to_sync[@]}"; do
            echo -ne "   ${ARROW} ${img}... "
            if docker save "${img}:latest" | sudo k3s ctr images import - >/dev/null 2>&1; then
                echo -e "${GREEN}${CHECK}${NC}"
            else
                echo -e "${RED}${CROSS}${NC}"
            fi
        done
    fi
}

# =============================================================================
# Cleanup for Rebuild
# =============================================================================

cleanup_for_rebuild() {
    [[ "$DRY_RUN_MODE" == "true" ]] && return 0

    verbose "Cleaning up for rebuild..."

    # Delete application pods (keep postgres unless reset-db)
    if [[ "$RESET_DB_MODE" == "true" ]]; then
        kubectl delete pods -n ai-agents --all --grace-period=5 2>/dev/null || true
        kubectl delete pvc -n ai-agents --all 2>/dev/null || true
    else
        kubectl delete pods -n ai-agents -l app!=postgres --grace-period=5 2>/dev/null || true
    fi

    # Clean up failed pods
    kubectl delete pods -n ai-agents --field-selector=status.phase=Failed 2>/dev/null || true

    # Remove old Docker images
    local images=("session-management-server" "stt-service" "tts-service" "frontend-ui" "message-recorder-python" "stella-agent" "echo-agent" "stella-light-agent")
    for img in "${images[@]}"; do
        docker rmi "${img}:latest" 2>/dev/null || true
    done

    # Clean K3s containerd images (Linux)
    if [[ "$OS_TYPE" == "linux" ]]; then
        for img in "${images[@]}"; do
            sudo k3s ctr images rm "docker.io/library/${img}:latest" 2>/dev/null || true
        done
    fi

    # Prune Docker build cache
    docker builder prune -f 2>/dev/null || true

    # Clear checksums
    clear_all_checksums

    verbose "Cleanup complete"
}

# =============================================================================
# Service Rebuild Check
# =============================================================================

service_was_rebuilt() {
    local service="$1"
    # Check if array has elements before checking
    [[ ${#REBUILT_SERVICES[@]} -eq 0 ]] && return 1
    array_contains "$service" "${REBUILT_SERVICES[@]}"
}
