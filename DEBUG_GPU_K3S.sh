#!/bin/bash
# Debug GPU visibility in K3s

echo "🔍 GPU Debugging for K3s"
echo "========================================"
echo ""

echo "1️⃣  Host GPU Status:"
echo "----------------------------------------"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
echo ""

echo "2️⃣  NVIDIA Container Toolkit Status:"
echo "----------------------------------------"
if command -v nvidia-container-runtime &> /dev/null; then
    echo "✓ nvidia-container-runtime: $(nvidia-container-runtime --version | head -1)"
else
    echo "✗ nvidia-container-runtime: NOT FOUND"
fi

if command -v nvidia-ctk &> /dev/null; then
    echo "✓ nvidia-ctk: $(nvidia-ctk --version | head -1)"
else
    echo "✗ nvidia-ctk: NOT FOUND"
fi
echo ""

echo "3️⃣  Docker NVIDIA Runtime Configuration:"
echo "----------------------------------------"
if grep -q "nvidia" /etc/docker/daemon.json 2>/dev/null; then
    echo "✓ Docker daemon.json has NVIDIA runtime:"
    grep -A 5 "nvidia" /etc/docker/daemon.json
else
    echo "✗ Docker daemon.json missing NVIDIA runtime configuration"
fi
echo ""

echo "4️⃣  Test Docker GPU Access:"
echo "----------------------------------------"
if docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi &>/dev/null; then
    echo "✓ Docker can access GPU"
    docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi 2>/dev/null | head -5
else
    echo "✗ Docker CANNOT access GPU"
fi
echo ""

echo "5️⃣  Kubernetes Node GPU Resources:"
echo "----------------------------------------"
export KUBECONFIG=~/.kube/config
GPU_ALLOCATABLE=$(kubectl describe nodes 2>/dev/null | grep -A 10 "Allocatable:" | grep "nvidia.com/gpu")
if [ -n "$GPU_ALLOCATABLE" ]; then
    echo "✓ GPU visible to Kubernetes:"
    echo "$GPU_ALLOCATABLE"
else
    echo "✗ GPU NOT visible to Kubernetes"
    echo ""
    echo "Node Allocatable Resources:"
    kubectl describe nodes | grep -A 10 "Allocatable:"
fi
echo ""

echo "6️⃣  Agent Pod Status:"
echo "----------------------------------------"
kubectl get pods -n ai-agents -o wide 2>/dev/null | grep -E "NAME|agent"
echo ""

echo "7️⃣  Agent Pod Events (if any pending):"
echo "----------------------------------------"
PENDING_AGENTS=$(kubectl get pods -n ai-agents 2>/dev/null | grep -E "agent.*Pending" | awk '{print $1}')
if [ -n "$PENDING_AGENTS" ]; then
    for pod in $PENDING_AGENTS; do
        echo "Events for $pod:"
        kubectl describe pod $pod -n ai-agents 2>/dev/null | grep -A 20 "Events:"
        echo ""
    done
else
    echo "No pending agent pods"
fi
echo ""

echo "========================================"
echo "🔧 RECOMMENDED FIXES:"
echo "========================================"
echo ""

# Check what needs to be fixed
NEEDS_RUNTIME_CONFIG=false
NEEDS_K3S_RESTART=false

if ! grep -q "nvidia" /etc/docker/daemon.json 2>/dev/null; then
    NEEDS_RUNTIME_CONFIG=true
fi

if [ -z "$GPU_ALLOCATABLE" ]; then
    NEEDS_K3S_RESTART=true
fi

if [ "$NEEDS_RUNTIME_CONFIG" = true ]; then
    echo "1. Configure Docker NVIDIA runtime:"
    echo "   sudo nvidia-ctk runtime configure --runtime=docker"
    echo "   sudo systemctl restart docker"
    echo ""
fi

if [ "$NEEDS_K3S_RESTART" = true ]; then
    echo "2. Restart K3s to detect GPU:"
    echo "   sudo systemctl restart k3s"
    echo "   sleep 10"
    echo ""
    echo "3. Verify GPU is visible:"
    echo "   kubectl describe nodes | grep -A 5 'Allocatable:' | grep nvidia"
    echo ""
fi

if [ "$NEEDS_RUNTIME_CONFIG" = false ] && [ "$NEEDS_K3S_RESTART" = false ]; then
    echo "✅ Configuration looks correct!"
    echo ""
    echo "If agents still won't start, check agent pod logs:"
    echo "   kubectl logs -n ai-agents -l app=conversational-ai-agent --tail=50"
fi
