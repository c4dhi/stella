#!/bin/bash
# =============================================================================
# deploy.sh - Kubernetes deployment logic
# =============================================================================

# =============================================================================
# Service Definitions (Bash 3.x compatible - no associative arrays)
# =============================================================================

# Get deployment name for a service
get_deployment_name() {
    local service="$1"
    case "$service" in
        "session-management-server") echo "session-management-server" ;;
        "frontend-ui") echo "frontend-ui" ;;
        "stt-service") echo "stt-service" ;;
        "tts-service") echo "tts-service" ;;
        "message-recorder-python") echo "message-recorder" ;;
        *) echo "$service" ;;
    esac
}

# Get timeout for a deployment
# Note: STT/TTS have longer timeouts for first-time model downloads (init containers)
get_service_timeout() {
    local deploy="$1"
    case "$deploy" in
        "session-management-server") echo 180 ;;
        "frontend-ui") echo 120 ;;
        "stt-service") echo 600 ;;  # 10 min for model downloads
        "tts-service") echo 300 ;;  # 5 min for model downloads
        "message-recorder") echo 60 ;;
        *) echo 120 ;;
    esac
}

# All services list
ALL_SERVICES="session-management-server frontend-ui stt-service tts-service message-recorder-python"
ALL_DEPLOYMENTS="session-management-server frontend-ui stt-service tts-service message-recorder"

# =============================================================================
# ConfigMap Generation
# =============================================================================

generate_configmap() {
    local output_file="${TEMP_DIR}/04-configmap-updated.yaml"

    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        verbose "Would generate configmap [dry-run]"
        return 0
    fi

    # Auto-detect K8s DNS IP in production (if not already set)
    if [[ "$NODE_ENV" == "production" && -z "${KUBERNETES_DNS_IP:-}" ]]; then
        local detected_dns
        detected_dns=$(kubectl get svc -n kube-system kube-dns -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
        if [[ -n "$detected_dns" ]]; then
            export KUBERNETES_DNS_IP="$detected_dns"
            verbose "Auto-detected K8s DNS IP: $KUBERNETES_DNS_IP"
        else
            warning "Could not auto-detect K8s DNS IP - agent pods may fail to resolve internal services"
        fi
    fi

    # Detect host gateway IP for message-recorder
    local host_gateway_ip
    if [[ "$OS_TYPE" == "macos" ]]; then
        # Run detection pod and filter out kubectl status messages
        host_gateway_ip=$(kubectl run gateway-detector --rm -i --restart=Never \
            --image=busybox:1.36 -- sh -c 'ip route | grep default | awk "{print \$3}"' 2>/dev/null \
            | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
        # Fallback to OrbStack default if detection fails
        [[ -z "$host_gateway_ip" ]] && host_gateway_ip="192.168.194.1"
    else
        host_gateway_ip=$(hostname -I | awk '{print $1}')
    fi

    # Generate configmap from template - substitute all environment variables
    sed -e "s|\${LIVEKIT_URL}|${LIVEKIT_URL:-}|g" \
        -e "s|\${PUBLIC_LIVEKIT_URL}|${PUBLIC_LIVEKIT_URL:-}|g" \
        -e "s|\${VITE_LIVEKIT_URL}|${VITE_LIVEKIT_URL:-}|g" \
        -e "s|\${NODE_ENV}|${NODE_ENV:-local}|g" \
        -e "s|\${PUBLIC_API_URL}|${PUBLIC_API_URL:-}|g" \
        -e "s|\${CORS_ORIGIN}|${CORS_ORIGIN:-}|g" \
        -e "s|\${PUBLIC_FRONTEND_URL}|${PUBLIC_FRONTEND_URL:-}|g" \
        -e "s|\${PUBLIC_DB_HOST}|${PUBLIC_DB_HOST:-}|g" \
        -e "s|\${PUBLIC_DB_PORT}|${PUBLIC_DB_PORT:-}|g" \
        -e "s|\${STT_PROVIDER}|${STT_PROVIDER:-sherpa}|g" \
        -e "s|\${TTS_PROVIDER}|${TTS_PROVIDER:-edge_tts}|g" \
        -e "s|\${WHISPER_MODEL}|${WHISPER_MODEL:-base.en}|g" \
        -e "s|\${WHISPER_DEVICE}|${WHISPER_DEVICE:-cpu}|g" \
        -e "s|\${WHISPER_COMPUTE_TYPE}|${WHISPER_COMPUTE_TYPE:-int8}|g" \
        -e "s|\${WHISPER_BEAM_SIZE}|${WHISPER_BEAM_SIZE:-5}|g" \
        -e "s|\${WHISPER_LANGUAGE}|${WHISPER_LANGUAGE:-}|g" \
        -e "s|\${ONNX_PROVIDER}|${ONNX_PROVIDER:-CPUExecutionProvider}|g" \
        -e "s|\${ENABLE_GPU}|${ENABLE_GPU:-false}|g" \
        -e "s|\${VAD_THRESHOLD}|${VAD_THRESHOLD:-0.5}|g" \
        -e "s|\${VAD_MIN_SPEECH_MS}|${VAD_MIN_SPEECH_MS:-200}|g" \
        -e "s|\${VAD_MIN_SILENCE_MS}|${VAD_MIN_SILENCE_MS:-500}|g" \
        -e "s|\${PARTIAL_INTERVAL_MS}|${PARTIAL_INTERVAL_MS:-1000}|g" \
        -e "s|\${LIVEKIT_TURN_ENABLED}|${LIVEKIT_TURN_ENABLED:-false}|g" \
        -e "s|\${LIVEKIT_TURN_DOMAIN}|${LIVEKIT_TURN_DOMAIN:-localhost}|g" \
        -e "s|\${ELEVENLABS_VOICE_ID}|${ELEVENLABS_VOICE_ID:-}|g" \
        -e "s|\${ELEVENLABS_MODEL_ID}|${ELEVENLABS_MODEL_ID:-}|g" \
        -e "s|\${CUSTOM_DNS_SERVERS}|${CUSTOM_DNS_SERVERS:-}|g" \
        -e "s|\${KUBERNETES_DNS_IP}|${KUBERNETES_DNS_IP:-}|g" \
        k8s/04-configmap.yaml > "$output_file"

    # Generate message-recorder manifest with host gateway
    sed "s/192.168.194.1/${host_gateway_ip}/g" \
        k8s/06-message-recorder.yaml > "${TEMP_DIR}/06-message-recorder-updated.yaml"

    verbose "ConfigMap generated with host gateway: $host_gateway_ip"
}

# =============================================================================
# Session Management Server Manifest
# =============================================================================

generate_session_server_manifest() {
    local output_file="${TEMP_DIR}/06-session-management-server-updated.yaml"

    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        verbose "Would generate session-server manifest [dry-run]"
        return 0
    fi

    # Replace placeholder with actual project directory path
    # This makes it work regardless of where the project is cloned
    sed "s|__PROJECT_DIR_PLACEHOLDER__|${PROJECT_DIR}|g" \
        k8s/06-session-management-server.yaml > "$output_file"

    verbose "Project directory mounted: ${PROJECT_DIR}"
}

# =============================================================================
# GPU Manifest Generation
# =============================================================================

generate_gpu_manifests() {
    # Start with base manifests
    cp k8s/08-stt-service.yaml "${TEMP_DIR}/08-stt-service.yaml"
    cp k8s/09-tts-service.yaml "${TEMP_DIR}/09-tts-service.yaml"

    # Enable GPU runtime class if requested
    if [[ "$ENABLE_GPU" == "true" ]]; then
        verbose "Enabling GPU runtime class..."
        # macOS sed requires '' for in-place edit, Linux doesn't
        if [[ "$OS_TYPE" == "macos" ]]; then
            sed -i '' 's/# GPU: runtimeClassName: nvidia/runtimeClassName: nvidia/' \
                "${TEMP_DIR}/08-stt-service.yaml"
            sed -i '' 's/# GPU: runtimeClassName: nvidia/runtimeClassName: nvidia/' \
                "${TEMP_DIR}/09-tts-service.yaml"
        else
            sed -i 's/# GPU: runtimeClassName: nvidia/runtimeClassName: nvidia/' \
                "${TEMP_DIR}/08-stt-service.yaml"
            sed -i 's/# GPU: runtimeClassName: nvidia/runtimeClassName: nvidia/' \
                "${TEMP_DIR}/09-tts-service.yaml"
        fi
    fi

    # Add custom DNS configuration if CUSTOM_DNS_SERVERS is set
    # This bypasses corporate SSL inspection proxies
    if [[ -n "$CUSTOM_DNS_SERVERS" ]]; then
        verbose "Configuring custom DNS: $CUSTOM_DNS_SERVERS"
        add_dns_config_to_manifest "${TEMP_DIR}/08-stt-service.yaml"
        add_dns_config_to_manifest "${TEMP_DIR}/09-tts-service.yaml"
    fi

    export STT_MANIFEST="${TEMP_DIR}/08-stt-service.yaml"
    export TTS_MANIFEST="${TEMP_DIR}/09-tts-service.yaml"

    if [[ "$ENABLE_GPU" == "true" ]]; then
        verbose "GPU manifests: enabled"
    fi
}

# =============================================================================
# DNS Configuration for Manifests
# =============================================================================
# Adds custom DNS configuration to bypass SSL inspection proxies.
# Injects dnsPolicy: None and dnsConfig with nameservers from CUSTOM_DNS_SERVERS.

add_dns_config_to_manifest() {
    local manifest_file="$1"

    # Convert space-separated DNS servers to YAML array format
    local dns_yaml=""
    for server in $CUSTOM_DNS_SERVERS; do
        dns_yaml="${dns_yaml}        - \"${server}\"\n"
    done

    # Find the line with "initContainers:" or "containers:" (first occurrence after spec:)
    # and insert dnsPolicy and dnsConfig before it
    # This uses awk to inject the DNS config at the right indentation level
    awk -v dns_servers="$dns_yaml" '
    /^[[:space:]]*initContainers:/ && !dns_added {
        # Get the indentation of initContainers
        match($0, /^[[:space:]]*/)
        indent = substr($0, RSTART, RLENGTH)
        # Print DNS config with same indentation
        print indent "dnsPolicy: None"
        print indent "dnsConfig:"
        print indent "  nameservers:"
        printf "%s", dns_servers
        dns_added = 1
    }
    { print }
    ' "$manifest_file" > "${manifest_file}.tmp" && mv "${manifest_file}.tmp" "$manifest_file"
}

# =============================================================================
# Secrets Management
# =============================================================================

create_secrets() {
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        echo -e "   ${ARROW} Secrets... ${YELLOW}[dry-run]${NC}"
        return 0
    fi

    local db_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public"

    kubectl create secret generic stella-ai-secrets -n ai-agents \
        --from-literal=postgres-db="$POSTGRES_DB" \
        --from-literal=postgres-user="$POSTGRES_USER" \
        --from-literal=postgres-password="$POSTGRES_PASSWORD" \
        --from-literal=database-url="$db_url" \
        --from-literal=openai-api-key="$OPENAI_API_KEY" \
        --from-literal=jwt-secret="${JWT_SECRET:-$(openssl rand -base64 32)}" \
        --from-literal=livekit-api-key="$LIVEKIT_API_KEY" \
        --from-literal=livekit-api-secret="$LIVEKIT_API_SECRET" \
        --from-literal=livekit-webhook-secret="${LIVEKIT_WEBHOOK_SECRET:-webhook-secret}" \
        --from-literal=elevenlabs-api-key="${ELEVENLABS_API_KEY:-}" \
        --dry-run=client -o yaml | kubectl apply -f - >/dev/null

    verbose "Secrets created"
}

# =============================================================================
# Main Deployment Function
# =============================================================================

deploy_services() {
    info "${EMOJI_DEPLOY} Deploying to Kubernetes..."

    # Generate manifests
    generate_configmap
    generate_session_server_manifest
    generate_gpu_manifests

    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        show_dry_run_deployment
        return 0
    fi

    # Phase 1: Namespace, RBAC, and Secrets
    status "Namespace & RBAC"
    kubectl apply -f k8s/00-namespace.yaml >/dev/null
    kubectl apply -f k8s/03-secrets.yaml >/dev/null
    kubectl apply -f k8s/05-rbac.yaml >/dev/null
    status_ok

    status "Secrets"
    create_secrets
    status_ok

    status "ConfigMap"
    kubectl apply -f "${TEMP_DIR}/04-configmap-updated.yaml" >/dev/null
    status_ok

    # Phase 1.5: Model Storage PVCs (for STT/TTS models)
    status "Model Storage PVCs"
    kubectl apply -f k8s/02-stt-models-pvc.yaml >/dev/null
    kubectl apply -f k8s/02-tts-models-pvc.yaml >/dev/null
    status_ok

    # Phase 2: PostgreSQL
    status "PostgreSQL"
    kubectl apply -f k8s/01-postgres-config.yaml >/dev/null 2>&1 || true
    kubectl apply -f k8s/01-postgres.yaml >/dev/null
    if kubectl wait --for=condition=ready pod -l app=postgres -n ai-agents --timeout=120s >/dev/null 2>&1; then
        status_ok
    else
        status_fail
        error "PostgreSQL failed to start"
        return 1
    fi

    # Phase 3: Application Services (apply manifests quietly)
    kubectl apply -f "${TEMP_DIR}/06-session-management-server-updated.yaml" >/dev/null
    kubectl apply -f k8s/07-frontend-ui.yaml >/dev/null
    kubectl apply -f "$STT_MANIFEST" >/dev/null
    kubectl apply -f "$TTS_MANIFEST" >/dev/null
    kubectl apply -f "${TEMP_DIR}/06-message-recorder-updated.yaml" >/dev/null

    # NodePort services for local development
    if [[ "$NODE_ENV" != "production" ]]; then
        kubectl apply -f k8s/local/ >/dev/null 2>&1 || true
    fi

    # GPU patches if enabled
    if [[ "$ENABLE_GPU" == "true" ]]; then
        apply_gpu_patches
    fi

    # Restart and wait for services (this shows progress)
    restart_services
    wait_for_services

    success "Deployment complete"
}

# =============================================================================
# GPU Patches
# =============================================================================

apply_gpu_patches() {
    verbose "Applying GPU patches..."

    local services=("stt-service" "tts-service")
    for svc in "${services[@]}"; do
        local has_nvidia
        has_nvidia=$(kubectl get deployment -n ai-agents "$svc" \
            -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' 2>/dev/null | grep -c "NVIDIA_VISIBLE_DEVICES" || true)

        if [[ "$has_nvidia" == "0" ]]; then
            kubectl patch deployment -n ai-agents "$svc" --type='json' \
                -p='[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "NVIDIA_VISIBLE_DEVICES", "value": "all"}}]' >/dev/null 2>&1
            verbose "$svc: GPU patch applied"
        fi
    done
}

# =============================================================================
# Service Restart (Consolidated)
# =============================================================================

restart_services() {
    # Always verify all services, but only restart those that were rebuilt
    SERVICES_TO_WAIT="$ALL_DEPLOYMENTS"

    # Determine which services need restart
    local services_to_restart=""

    if [[ "$REBUILD_MODE" == "true" || "$SKIP_BUILD_MODE" == "true" ]]; then
        # Restart all deployments
        services_to_restart="$ALL_DEPLOYMENTS"
        verbose "Restarting all services..."
    elif [[ ${#REBUILT_SERVICES[@]} -gt 0 ]]; then
        # Restart only rebuilt services
        for service in $ALL_SERVICES; do
            if service_was_rebuilt "$service"; then
                local deploy_name
                deploy_name=$(get_deployment_name "$service")
                services_to_restart="$services_to_restart $deploy_name"
            fi
        done
        verbose "Restarting rebuilt services: $services_to_restart"
    else
        verbose "No services rebuilt - skipping restarts, will verify existing pods"
    fi

    # Restart services that need it
    for deploy in $services_to_restart; do
        kubectl rollout restart deployment "$deploy" -n ai-agents >/dev/null 2>&1 || true
    done

    export SERVICES_TO_WAIT
}

# =============================================================================
# Wait for Services (Consolidated)
# =============================================================================

wait_for_services() {
    # Check if SERVICES_TO_WAIT is set and not empty
    [[ -z "${SERVICES_TO_WAIT:-}" ]] && return 0

    # Show what we're waiting for
    verbose "Waiting for services to be ready..."

    for deploy in $SERVICES_TO_WAIT; do
        local timeout
        timeout=$(get_service_timeout "$deploy")
        local display_name="$deploy"

        # Pretty names
        case "$deploy" in
            "session-management-server") display_name="Backend" ;;
            "frontend-ui") display_name="Frontend" ;;
            "stt-service") display_name="STT Service" ;;
            "tts-service") display_name="TTS Service" ;;
            "message-recorder") display_name="Message Recorder" ;;
        esac

        status "$display_name"
        if kubectl rollout status "deployment/$deploy" -n ai-agents --timeout="${timeout}s" >/dev/null 2>&1; then
            status_ok
        else
            status_fail
        fi
    done
}

# =============================================================================
# Dry-Run Display
# =============================================================================

show_dry_run_deployment() {
    echo -e "   ${ARROW} Would apply: k8s/00-namespace.yaml"
    echo -e "   ${ARROW} Would apply: k8s/03-secrets.yaml"
    echo -e "   ${ARROW} Would apply: k8s/05-rbac.yaml"
    echo -e "   ${ARROW} Would create: stella-ai-secrets"
    echo -e "   ${ARROW} Would apply: configmap"
    echo -e "   ${ARROW} Would apply: k8s/01-postgres.yaml"
    echo -e "   ${ARROW} Would apply: session-management-server"
    echo -e "   ${ARROW} Would apply: frontend-ui"
    echo -e "   ${ARROW} Would apply: stt-service"
    echo -e "   ${ARROW} Would apply: tts-service"
    echo -e "   ${ARROW} Would apply: message-recorder"
}

# =============================================================================
# Port Forwarding
# =============================================================================

start_port_forwards() {
    info "${EMOJI_NETWORK} Setting up port forwards..."

    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        echo -e "   ${ARROW} Would start port-forward daemon... ${YELLOW}[dry-run]${NC}"
        return 0
    fi

    local port_forward_daemon="$SCRIPT_DIR/port-forward-daemon.sh"

    if [[ -x "$port_forward_daemon" ]]; then
        "$port_forward_daemon" start -d
        success "Port forwards active"
    else
        warning "port-forward-daemon.sh not found"

        # Fallback: manual port-forwards
        start_manual_port_forwards
    fi
}

start_manual_port_forwards() {
    verbose "Starting manual port-forwards..."

    # Kill existing port-forwards
    pkill -f "kubectl port-forward.*ai-agents" 2>/dev/null || true

    # Start new port-forwards in background
    kubectl port-forward svc/frontend-ui 8080:8080 -n ai-agents >/dev/null 2>&1 &
    kubectl port-forward svc/session-management-server 3000:3000 -n ai-agents >/dev/null 2>&1 &

    verbose "Manual port-forwards started"
}

# =============================================================================
# Summary Display
# =============================================================================

show_summary() {
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        dry_run_summary
        return 0
    fi

    summary_box \
        "http://localhost:8080" \
        "http://localhost:3000" \
        "${PUBLIC_LIVEKIT_URL:-ws://localhost:7880}"
}
