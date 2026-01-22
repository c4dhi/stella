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

    # Hash source files (with error suppression)
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
            -exec md5 -q {} \; 2>/dev/null | sort | md5 -q 2>/dev/null || echo "fallback-checksum-mac")
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
            -exec md5sum {} \; 2>/dev/null | sort | md5sum 2>/dev/null | cut -d' ' -f1 || echo "fallback-checksum-linux")
    fi

    # Add Dockerfile hash (with fallback)
    if [[ -f "$dockerfile" ]]; then
        local df_hash
        df_hash=$(hash_file "$dockerfile" 2>/dev/null || echo "df")
        checksum="${checksum}${df_hash}"
    fi

    # Add .env files to checksum (with error handling)
    for env_file in "$PROJECT_DIR/.env" "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env.production"; do
        if [[ -f "$env_file" ]]; then
            local env_hash
            env_hash=$(hash_file "$env_file" 2>/dev/null || echo "env")
            checksum="${checksum}${env_hash}"
        fi
    done

    # Final combined hash (with fallback)
    echo "$checksum" | hash_string 2>/dev/null || echo "$checksum" | md5sum 2>/dev/null | cut -d' ' -f1 || echo "checksum-error"
}

# =============================================================================
# Checksum Management
# =============================================================================

service_needs_rebuild() {
    local service_name="$1"
    local service_dir="$2"
    local dockerfile="$3"

    # Protect against set -e failures in checksum calculation
    set +e
    local current_checksum
    current_checksum=$(calculate_service_checksum "$service_name" "$service_dir" "$dockerfile" 2>/dev/null)
    local calc_exit=$?
    set -e

    # If checksum calculation failed, force rebuild
    if [[ $calc_exit -ne 0 || -z "$current_checksum" ]]; then
        verbose "Checksum calculation failed for $service_name, forcing rebuild"
        return 0
    fi

    local cached_checksum_file="${CHECKSUM_DIR}/${service_name}.checksum"

    # Ensure checksum directory exists
    mkdir -p "$CHECKSUM_DIR" 2>/dev/null || true

    # No cached checksum = needs rebuild
    if [[ ! -f "$cached_checksum_file" ]]; then
        echo "$current_checksum" > "$cached_checksum_file" 2>/dev/null || true
        return 0
    fi

    local cached_checksum
    cached_checksum=$(cat "$cached_checksum_file" 2>/dev/null || echo "")

    if [[ "$current_checksum" != "$cached_checksum" ]]; then
        echo "$current_checksum" > "$cached_checksum_file" 2>/dev/null || true
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
# Single-Line Build Progress with Descriptive Steps
# =============================================================================

# Parse build log to get human-readable step description
get_build_step_description() {
    local log_line="$1"
    local image_name="$2"

    # Extract the command being run (after RUN, COPY, FROM, etc.)
    local desc=""

    # Check for specific patterns and provide friendly descriptions
    if echo "$log_line" | grep -qi "FROM.*nvidia/cuda"; then
        desc="Pulling NVIDIA CUDA base image"
    elif echo "$log_line" | grep -qi "FROM.*python"; then
        desc="Pulling Python base image"
    elif echo "$log_line" | grep -qi "FROM.*node"; then
        desc="Pulling Node.js base image"
    elif echo "$log_line" | grep -qi "apt-get update\|apt-get install"; then
        desc="Installing system dependencies"
    elif echo "$log_line" | grep -qi "add-apt-repository"; then
        desc="Adding package repository"
    elif echo "$log_line" | grep -qi "pip install.*requirements"; then
        desc="Installing Python dependencies"
    elif echo "$log_line" | grep -qi "pip install"; then
        desc="Installing Python packages"
    elif echo "$log_line" | grep -qi "npm install\|npm ci"; then
        desc="Installing Node.js dependencies"
    elif echo "$log_line" | grep -qi "npm run build"; then
        desc="Building application"
    elif echo "$log_line" | grep -qi "npx prisma generate"; then
        desc="Generating Prisma client"
    elif echo "$log_line" | grep -qi "grpc_tools.protoc\|protoc"; then
        desc="Compiling gRPC protobuf"
    elif echo "$log_line" | grep -qi "COPY.*requirements\|COPY.*package"; then
        desc="Copying dependency files"
    elif echo "$log_line" | grep -qi "COPY.*src\|COPY.*\."; then
        desc="Copying source code"
    elif echo "$log_line" | grep -qi "WORKDIR"; then
        desc="Setting up workspace"
    elif echo "$log_line" | grep -qi "ENV "; then
        desc="Configuring environment"
    elif echo "$log_line" | grep -qi "onnxruntime-gpu"; then
        desc="Installing ONNX Runtime (GPU)"
    elif echo "$log_line" | grep -qi "onnxruntime"; then
        desc="Installing ONNX Runtime"
    elif echo "$log_line" | grep -qi "faster-whisper\|ctranslate2"; then
        desc="Installing Whisper dependencies"
    elif echo "$log_line" | grep -qi "sherpa"; then
        desc="Installing Sherpa-ONNX"
    elif echo "$log_line" | grep -qi "kokoro"; then
        desc="Installing Kokoro TTS"
    elif echo "$log_line" | grep -qi "torch\|pytorch"; then
        desc="Installing PyTorch"
    elif echo "$log_line" | grep -qi "EXPOSE"; then
        desc="Configuring ports"
    elif echo "$log_line" | grep -qi "exporting to image"; then
        desc="Finalizing image"
    elif echo "$log_line" | grep -qi "writing image"; then
        desc="Writing image layers"
    fi

    echo "$desc"
}

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

    # Ensure log directory exists
    mkdir -p "$LOG_DIR"

    # Clear previous log
    > "$log_file"

    # Build flags
    local no_cache=""
    [[ "$REBUILD_MODE" == "true" ]] && no_cache="--no-cache"

    # Check dockerfile exists
    if [[ ! -f "$dockerfile" ]]; then
        printf "\r   ${ARROW} ${image_name}... ${RED}${CROSS}${NC}%-60s\n" " "
        error "Dockerfile not found: $dockerfile"
        exit 1
    fi

    # Check context exists
    if [[ ! -d "$context" && "$context" != "." ]]; then
        printf "\r   ${ARROW} ${image_name}... ${RED}${CROSS}${NC}%-60s\n" " "
        error "Build context not found: $context"
        exit 1
    fi

    # Start build in background (use set +e to prevent immediate exit on &)
    set +e
    if [[ "$USE_BUILDKIT" == "true" ]]; then
        DOCKER_BUILDKIT=1 docker build --progress=plain ${no_cache} ${build_args} \
            -f "${dockerfile}" --network=host -t "${tag}" "${context}" > "${log_file}" 2>&1 &
    else
        docker build ${no_cache} ${build_args} \
            -f "${dockerfile}" --network=host -t "${tag}" "${context}" > "${log_file}" 2>&1 &
    fi
    local build_pid=$!
    set -e

    # Check if build process started
    if ! kill -0 $build_pid 2>/dev/null; then
        # Process already finished (very fast failure)
        sleep 0.5  # Give it a moment to write to log
        set +e
        wait $build_pid
        local early_exit_code=$?
        set -e

        printf "\r   ${ARROW} ${image_name}... ${RED}${CROSS}${NC}%-60s\n" " "
        echo ""
        error "Build failed immediately for ${image_name}"
        if [[ -f "$log_file" && -s "$log_file" ]]; then
            echo -e "${DIM}--- Build output ---${NC}"
            cat "$log_file" | tail -30 | sed 's/^/  /'
            echo -e "${DIM}--------------------${NC}"
        else
            echo "  No output captured. Check Docker status: docker info"
        fi
        exit 1
    fi

    # Initial status line
    echo -ne "   ${ARROW} ${image_name}... "

    local last_step=""
    local last_desc=""
    local spinner_chars=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local spinner_idx=0

    # Monitor build progress
    while kill -0 $build_pid 2>/dev/null; do
        if [[ -f "$log_file" ]]; then
            # Get last meaningful lines from log
            local recent_log
            recent_log=$(tail -n 50 "$log_file" 2>/dev/null)

            # Extract current step number (e.g., "[5/12]" or "Step 5/12")
            local step_num
            step_num=$(echo "$recent_log" | grep -oE '\[#?[0-9]+ [0-9]+/[0-9]+\]|Step [0-9]+/[0-9]+|\[[0-9]+/[0-9]+\]' | tail -1)

            # Get the line containing RUN/COPY/FROM to understand what's happening
            local action_line
            action_line=$(echo "$recent_log" | grep -E '(RUN |COPY |FROM |ENV |WORKDIR |apt-get|pip install|npm |npx |exporting|writing)' | tail -1)

            # Get human-readable description
            local desc
            desc=$(get_build_step_description "$action_line" "$image_name")

            # Build display string
            local display=""
            if [[ -n "$step_num" ]]; then
                display="${step_num}"
            fi
            if [[ -n "$desc" ]]; then
                if [[ -n "$display" ]]; then
                    display="${display} ${desc}"
                else
                    display="${desc}"
                fi
            fi

            # Update display if changed
            if [[ -n "$display" && "$display" != "$last_desc" ]]; then
                # Truncate if too long (terminal width consideration)
                if [[ ${#display} -gt 50 ]]; then
                    display="${display:0:47}..."
                fi
                printf "\r   ${ARROW} ${image_name}... ${DIM}${display}${NC}%-20s" " "
                last_desc="$display"
            else
                # Show spinner for activity indication
                local spinner="${spinner_chars[$spinner_idx]}"
                spinner_idx=$(( (spinner_idx + 1) % ${#spinner_chars[@]} ))
                printf "\r   ${ARROW} ${image_name}... ${DIM}${last_desc:-Building}${NC} ${CYAN}${spinner}${NC}%-5s" " "
            fi
        fi
        sleep 0.2
    done

    # Wait for build to complete and get exit code
    set +e
    wait $build_pid
    local exit_code=$?
    set -e

    # Clear line and show final status
    if [[ $exit_code -eq 0 ]]; then
        printf "\r   ${ARROW} ${image_name}... ${GREEN}${CHECK}${NC}%-60s\n" " "
        rm -f "$log_file"
        return 0
    else
        printf "\r   ${ARROW} ${image_name}... ${RED}${CROSS}${NC}%-60s\n" " "
        echo ""
        error "Build failed for ${image_name}"
        echo ""
        echo -e "${BOLD}Build Log:${NC} $log_file"
        echo ""
        # Show more context from the log
        if [[ -f "$log_file" && -s "$log_file" ]]; then
            echo -e "${DIM}--- Last 20 lines of build output ---${NC}"
            tail -n 20 "$log_file" | sed 's/^/  /'
            echo -e "${DIM}--------------------------------------${NC}"
        else
            echo -e "${YELLOW}No build output captured. Docker may have failed to start.${NC}"
            echo "  Check if Docker is running: docker info"
            echo "  Check disk space: df -h"
        fi
        echo ""
        exit 1
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
        return 0  # Not an error, just skipped
    fi

    # Determine paths
    local service_dir="$context"
    local dockerfile_path="${context}/${dockerfile}"
    if [[ "$context" == "." ]]; then
        dockerfile_path="./${dockerfile}"
    fi

    # Verify dockerfile exists before checking if rebuild needed
    if [[ ! -f "$dockerfile_path" ]]; then
        echo -e "   ${ARROW} ${image_name}... ${RED}${CROSS}${NC}"
        error "Dockerfile not found: $dockerfile_path"
        exit 1
    fi

    # Rebuild mode: always build
    if [[ "$REBUILD_MODE" == "true" ]]; then
        build_with_progress "$image_name" "$tag" "$context" "$build_args" "$dockerfile_path"
        # If we get here, build succeeded (build_with_progress exits on failure)
        set +e
        update_service_checksum "$image_name" "$service_dir" "$dockerfile_path" 2>/dev/null
        set -e
        REBUILT_SERVICES+=("$image_name")
        return 0
    fi

    # Smart mode: check if rebuild needed
    set +e
    service_needs_rebuild "$image_name" "$service_dir" "$dockerfile_path"
    local needs_rebuild=$?
    set -e

    if [[ $needs_rebuild -eq 0 ]]; then
        build_with_progress "$image_name" "$tag" "$context" "$build_args" "$dockerfile_path"
        # If we get here, build succeeded (build_with_progress exits on failure)
        set +e
        update_service_checksum "$image_name" "$service_dir" "$dockerfile_path" 2>/dev/null
        set -e
        REBUILT_SERVICES+=("$image_name")
        return 0
    else
        echo -e "   ${ARROW} ${image_name}... ${DIM}unchanged${NC}"
        return 0  # Not an error, just unchanged
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

    # NOTE: All smart_build calls will EXIT IMMEDIATELY on build failure.
    # This ensures fail-fast behavior - no need to check return codes.

    # Build session-management-server
    local prisma_checksum
    prisma_checksum=$(hash_file "./prisma/schema.prisma" 2>/dev/null || echo "none")
    local db_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"
    local session_args="--build-arg PRISMA_SCHEMA_CHECKSUM=${prisma_checksum} --build-arg DATABASE_URL=${db_url}"
    smart_build "session-management-server" "session-management-server:latest" "." "$session_args"

    # Build STT service
    local stt_args=""
    if [[ "$ENABLE_GPU" == "true" ]]; then
        stt_args="--build-arg ENABLE_GPU=true"
    fi
    smart_build "stt-service" "stt-service:latest" "./stt-service" "$stt_args"

    # Build TTS service
    local tts_args=""
    if [[ "$ENABLE_GPU" == "true" ]]; then
        tts_args="--build-arg ENABLE_GPU=true"
    fi
    smart_build "tts-service" "tts-service:latest" "./tts-service" "$tts_args"

    # Build frontend
    smart_build "frontend-ui" "frontend-ui:latest" "./frontend-ui"

    # Build message recorder
    smart_build "message-recorder-python" "message-recorder-python:latest" "./message-recorder-python"

    # Build stella-agent (pre-build to avoid on-demand building in production)
    smart_build "stella-agent" "stella-agent:latest" "." "" "agents/stella-agent/Dockerfile"

    # Build echo-agent
    smart_build "echo-agent" "echo-agent:latest" "." "" "agents/echo-agent/Dockerfile"

    # Build stella-light-agent
    smart_build "stella-light-agent" "stella-light-agent:latest" "." "" "agents/stella-light-agent/Dockerfile"

    # Summary (only reached if all builds succeeded)
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
    if [[ "$OS_TYPE" == "linux" ]]; then
        sync_images_to_k3s
    fi
}

# =============================================================================
# K3s Image Import (Linux only)
# =============================================================================

# Import a single image to K3s with spinner
import_single_image_to_k3s() {
    local service="$1"
    docker save "${service}:latest" | sudo k3s ctr images import - >/dev/null 2>&1
}

import_images_to_k3s() {
    [[ "$DRY_RUN_MODE" == "true" ]] && return 0
    [[ ${#REBUILT_SERVICES[@]} -eq 0 ]] && return 0

    info "${EMOJI_GEAR} Importing images to K3s..."

    for service in "${REBUILT_SERVICES[@]}"; do
        # Show spinner while importing
        echo -ne "   ${ARROW} ${service}... "

        # Start import in background
        docker save "${service}:latest" 2>/dev/null | sudo k3s ctr images import - >/dev/null 2>&1 &
        local pid=$!

        # Spinner animation
        local spinner_idx=0
        while kill -0 $pid 2>/dev/null; do
            local spinner="${SPINNER_CHARS[$spinner_idx]}"
            printf "\r   ${ARROW} ${service}... ${CYAN}${spinner}${NC} "
            spinner_idx=$(( (spinner_idx + 1) % ${#SPINNER_CHARS[@]} ))
            sleep 0.1
        done

        wait $pid
        local exit_code=$?

        if [[ $exit_code -eq 0 ]]; then
            printf "\r   ${ARROW} ${service}... ${GREEN}${CHECK}${NC}    \n"
        else
            printf "\r   ${ARROW} ${service}... ${RED}${CROSS}${NC}    \n"
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
            # Show spinner while syncing
            echo -ne "   ${ARROW} ${img}... "

            # Start sync in background
            docker save "${img}:latest" 2>/dev/null | sudo k3s ctr images import - >/dev/null 2>&1 &
            local pid=$!

            # Spinner animation
            local spinner_idx=0
            while kill -0 $pid 2>/dev/null; do
                local spinner="${SPINNER_CHARS[$spinner_idx]}"
                printf "\r   ${ARROW} ${img}... ${CYAN}${spinner}${NC} "
                spinner_idx=$(( (spinner_idx + 1) % ${#SPINNER_CHARS[@]} ))
                sleep 0.1
            done

            wait $pid
            local exit_code=$?

            if [[ $exit_code -eq 0 ]]; then
                printf "\r   ${ARROW} ${img}... ${GREEN}${CHECK}${NC}    \n"
            else
                printf "\r   ${ARROW} ${img}... ${RED}${CROSS}${NC}    \n"
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
