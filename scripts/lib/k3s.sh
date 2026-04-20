#!/bin/bash
# =============================================================================
# k3s.sh - K3s setup and management (unified for macOS and Linux)
# =============================================================================

# =============================================================================
# Prerequisites Check
# =============================================================================

check_setsid() {
    if ! command_exists setsid; then
        if [[ "$OS_TYPE" == "macos" ]]; then
            verbose "Installing setsid via util-linux..."
            if command_exists brew; then
                brew install util-linux >/dev/null 2>&1
                export PATH="/opt/homebrew/opt/util-linux/bin:$PATH"
            fi
        fi

        if ! command_exists setsid; then
            warning "setsid not found - build output may be affected"
        fi
    fi
}

# =============================================================================
# K3s Setup (Main Function)
# =============================================================================

setup_k3s() {
    info "${EMOJI_GEAR} Setting up K3s..."

    # Check setsid first
    check_setsid

    if [[ "$OS_TYPE" == "macos" ]]; then
        setup_k3s_macos
    else
        setup_k3s_linux
    fi

    # Install metrics-server if needed
    install_metrics_server

    success "K3s ready (context: $(kubectl config current-context 2>/dev/null || echo 'default'))"
}

# =============================================================================
# macOS K3s Setup (via OrbStack/Rancher Desktop/Colima)
# =============================================================================

setup_k3s_macos() {
    verbose "Checking for K3s runtime on macOS..."

    # Check if kubectl can connect to a cluster
    if ! kubectl cluster-info &>/dev/null; then
        error "No K3s runtime detected"
        echo ""
        echo -e "   ${BOLD}Install a K3s runtime:${NC}"
        echo ""
        echo -e "   ${CYAN}OrbStack (Recommended):${NC}"
        echo -e "   ${DIM}brew install --cask orbstack${NC}"
        echo -e "   ${DIM}Then: OrbStack → Settings → Kubernetes → Enable${NC}"
        echo ""
        echo -e "   ${CYAN}Rancher Desktop:${NC}"
        echo -e "   ${DIM}brew install --cask rancher${NC}"
        echo ""
        exit 1
    fi

    # Validate context
    local current_context
    current_context=$(kubectl config current-context 2>/dev/null)

    case "$current_context" in
        orbstack|rancher-desktop|*colima*)
            verbose "K3s runtime: $current_context"
            ;;
        *)
            warning "Unexpected context: $current_context"
            echo -e "   ${DIM}Expected: orbstack, rancher-desktop, or colima${NC}"
            ;;
    esac

    # Verify node is ready
    wait_for_node
}

# =============================================================================
# Linux K3s Setup (Native Installation)
# =============================================================================

setup_k3s_linux() {
    # Install K3s if not present
    if ! command_exists k3s; then
        verbose "Installing K3s..."

        if [[ "$DRY_RUN_MODE" == "true" ]]; then
            echo -e "   ${ARROW} Would install K3s... ${YELLOW}[dry-run]${NC}"
            return 0
        fi

        # Install K3s with containerd, disable traefik
        curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh - >/dev/null 2>&1

        sleep 5
        verbose "K3s installed"
    fi

    # Start K3s if not running
    if ! sudo systemctl is-active --quiet k3s 2>/dev/null; then
        verbose "Starting K3s service..."

        if [[ "$DRY_RUN_MODE" == "true" ]]; then
            echo -e "   ${ARROW} Would start K3s... ${YELLOW}[dry-run]${NC}"
            return 0
        fi

        sudo systemctl start k3s
        sleep 5
    fi

    # Setup kubeconfig
    setup_kubeconfig_linux

    # Verify K3s is running
    if ! kubectl get nodes &>/dev/null; then
        error "K3s is not responding"
        echo -e "   ${DIM}Try: sudo systemctl status k3s${NC}"
        exit 1
    fi

    # Install socat if needed (for port forwarding)
    if ! command_exists socat; then
        verbose "Installing socat..."
        sudo apt-get update >/dev/null 2>&1
        sudo apt-get install -y socat >/dev/null 2>&1
    fi

    # Wait for node to be ready
    wait_for_node
}

# =============================================================================
# Kubeconfig Setup (Linux)
# =============================================================================

setup_kubeconfig_linux() {
    mkdir -p ~/.kube

    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        verbose "Would copy kubeconfig [dry-run]"
        return 0
    fi

    sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
    sudo chown "$(id -u):$(id -g)" ~/.kube/config
    chmod 600 ~/.kube/config
    export KUBECONFIG=~/.kube/config
}

# =============================================================================
# Node Readiness
# =============================================================================

wait_for_node() {
    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        verbose "Would wait for node [dry-run]"
        return 0
    fi

    local node_status
    node_status=$(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)

    if [[ "$node_status" != "True" ]]; then
        verbose "Waiting for node to be ready..."
        kubectl wait --for=condition=Ready node --all --timeout=60s >/dev/null 2>&1
    fi

    local node_name
    node_name=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    verbose "Node ready: $node_name"
}

# =============================================================================
# Metrics Server
# =============================================================================

install_metrics_server() {
    if kubectl get deployment metrics-server -n kube-system &>/dev/null; then
        verbose "Metrics server: already installed"
        return 0
    fi

    if [[ "$DRY_RUN_MODE" == "true" ]]; then
        verbose "Would install metrics-server [dry-run]"
        return 0
    fi

    verbose "Installing metrics-server..."
    kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml >/dev/null 2>&1

    # Patch for K3s compatibility
    kubectl patch deployment metrics-server -n kube-system --type='json' \
        -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]' >/dev/null 2>&1

    verbose "Metrics server: installed"
}

# =============================================================================
# GPU Support (Linux only)
# =============================================================================

setup_gpu_support() {
    info "${EMOJI_GEAR} Checking GPU support..."

    # macOS doesn't support NVIDIA GPUs in containers
    if [[ "$OS_TYPE" == "macos" ]]; then
        echo -e "   ${ARROW} GPU: ${DIM}not available (macOS)${NC}"
        export ENABLE_GPU="false"
        return 0
    fi

    # Check if GPU is enabled in config
    if [[ "$ENABLE_GPU" != "true" ]]; then
        echo -e "   ${ARROW} GPU: ${DIM}disabled (ENABLE_GPU=false)${NC}"
        return 0
    fi

    # Check for NVIDIA GPU driver
    if ! command_exists nvidia-smi; then
        echo -e "   ${ARROW} GPU: ${YELLOW}not detected${NC} (nvidia-smi not found)"
        export ENABLE_GPU="false"
        return 0
    fi

    # Test if nvidia-smi actually works (can fail with various exit codes if GPU is busy/unavailable)
    local smi_exit=0
    nvidia-smi &>/dev/null || smi_exit=$?
    if [[ $smi_exit -ne 0 ]]; then
        echo -e "   ${ARROW} GPU: ${YELLOW}driver issue${NC} (nvidia-smi exit code $smi_exit)"
        echo -e "   ${DIM}GPU driver may need restart: sudo systemctl restart nvidia-persistenced${NC}"
        export ENABLE_GPU="false"
        return 0
    fi

    # Get GPU information (disable pipefail temporarily for robustness)
    local gpu_name
    local gpu_memory
    local driver_version
    set +o pipefail
    gpu_name=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 | xargs 2>/dev/null) || gpu_name="Unknown GPU"
    gpu_memory=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -1 | xargs 2>/dev/null) || gpu_memory="Unknown"
    driver_version=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 | xargs 2>/dev/null) || driver_version="Unknown"
    set -o pipefail

    # Check for nvidia-container-runtime (either in Docker or K3s containerd)
    local nvidia_runtime_found=false

    # Check Docker for nvidia runtime (use subshell to prevent pipefail from propagating)
    if (docker info 2>/dev/null | grep -qi "nvidia") 2>/dev/null; then
        nvidia_runtime_found=true
    fi

    # Check K3s containerd for nvidia runtime
    if [[ -f /var/lib/rancher/k3s/agent/etc/containerd/config.toml ]]; then
        if grep -qi "nvidia" /var/lib/rancher/k3s/agent/etc/containerd/config.toml 2>/dev/null; then
            nvidia_runtime_found=true
        fi
    fi

    # Check if nvidia RuntimeClass already exists in K8s (means runtime was previously configured)
    if kubectl get runtimeclass nvidia &>/dev/null; then
        nvidia_runtime_found=true
    fi

    if [[ "$nvidia_runtime_found" != "true" ]]; then
        echo -e "   ${ARROW} GPU: ${YELLOW}${gpu_name}${NC} (container runtime not configured)"
        echo -e "   ${DIM}Install: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html${NC}"
        export ENABLE_GPU="false"
        return 0
    fi

    # Check for K3s NVIDIA runtime class
    if ! kubectl get runtimeclass nvidia &>/dev/null; then
        verbose "Creating NVIDIA RuntimeClass..."
        kubectl apply -f - >/dev/null 2>&1 <<EOF
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: nvidia
handler: nvidia
EOF
    fi

    # Install NVIDIA device plugin if not present
    if ! kubectl get daemonset nvidia-device-plugin-daemonset -n kube-system &>/dev/null; then
        verbose "Installing NVIDIA device plugin..."

        # Determine kubelet device plugins path
        local kubelet_path="/var/lib/kubelet/device-plugins"
        if [[ -d "/var/lib/rancher/k3s/agent/kubelet/device-plugins" ]]; then
            kubelet_path="/var/lib/rancher/k3s/agent/kubelet/device-plugins"
        fi

        # Apply device plugin with correct path
        curl -s https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.1/nvidia-device-plugin.yml | \
            sed "s|/var/lib/kubelet/device-plugins|${kubelet_path}|g" | \
            kubectl apply -f - >/dev/null 2>&1
    fi

    # Show GPU details
    echo -e "   ${ARROW} GPU: ${GREEN}${gpu_name}${NC} (${gpu_memory}, driver ${driver_version})"
    success "GPU support enabled"
}

# =============================================================================
# Stop Services
# =============================================================================

stop_services() {
    info "${EMOJI_STOP} Stopping STELLA services..."

    # Kill port-forward processes
    if [[ -f "${PID_DIR}/port-forward.pid" ]]; then
        local pid
        pid=$(cat "${PID_DIR}/port-forward.pid")
        if process_running "$pid"; then
            kill_graceful "$pid"
            verbose "Stopped port-forward daemon"
        fi
        rm -f "${PID_DIR}/port-forward.pid"
    fi

    # Scale down deployments
    local deployments=("session-management-server" "frontend-ui" "stt-service" "tts-service" "message-recorder")
    for deploy in "${deployments[@]}"; do
        kubectl scale deployment "$deploy" -n "$KUBERNETES_NAMESPACE" --replicas=0 2>/dev/null || true
    done

    success "Services stopped"
}
