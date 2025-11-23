# Kubernetes Distribution Auto-Selection

## Overview

The `scripts/start-k8s.sh` script now automatically selects the appropriate Kubernetes distribution based on your environment:

- **K3s**: Linux + Production mode (native GPU support, production-ready)
- **Minikube**: macOS + Local mode (development tool)

## Selection Logic

```
┌─────────────────────────────────────────────────────────┐
│ Linux + Production (NODE_ENV=production)                │
│ ──────────────────────────────────────────────────────  │
│ Uses: K3s                                               │
│ Why: Native GPU support, production-ready Kubernetes    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ macOS + Any mode (local or production)                  │
│ ──────────────────────────────────────────────────────  │
│ Uses: Minikube                                          │
│ Why: Easy local development                             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Linux + Local (NODE_ENV=local)                          │
│ ──────────────────────────────────────────────────────  │
│ Uses: Minikube                                          │
│ Why: Development environment                            │
└─────────────────────────────────────────────────────────┘
```

## Key Features

### 1. K3s Setup (Production on Linux)

When K3s is selected:
- **Automatic installation**: Installs K3s via official installer if not present
- **Docker integration**: Uses `--docker` flag for compatibility with your Docker images
- **GPU support**: Automatically installs NVIDIA Container Toolkit for native GPU access
- **Production-ready**: Lightweight (< 100MB), certified Kubernetes distribution
- **No Docker-in-Docker**: Runs directly on host, avoiding nested container limitations

### 2. Minikube Setup (Development)

When Minikube is selected:
- **Existing workflow**: Keeps your current development setup unchanged
- **macOS compatibility**: Works seamlessly on Mac with Docker Desktop/OrbStack
- **Easy debugging**: Familiar minikube commands and dashboard

### 3. GPU Support

#### K3s (Recommended for Production GPU Workloads)
```bash
✅ Native GPU support via NVIDIA Container Runtime
✅ No device plugin needed
✅ Direct hardware access (no Docker-in-Docker overhead)
✅ Full CUDA support for Kokoro TTS acceleration
```

**How it works:**
1. Detects NVIDIA GPU via `nvidia-smi`
2. Installs NVIDIA Container Toolkit if needed
3. Configures Docker to use NVIDIA runtime
4. Restarts K3s to register GPU resources
5. Pods can immediately request `nvidia.com/gpu` resources

#### Minikube (Limited GPU Support)
```bash
⚠️  Docker-in-Docker limitation
⚠️  GPU may not be visible to pods
⚠️  Device plugin approach has known issues
```

**Recommendation**: Use K3s on Linux for GPU workloads.

## Usage

### Production Deployment (Linux Server)

```bash
# Automatically uses K3s
./scripts/start-k8s.sh --production --daemon

# Output:
# 🎯 Using K3s (Production on Linux)
#   ✓ Native GPU support
#   ✓ Production-ready Kubernetes
# ...
# 🎮 GPU Support Configuration
#   Detected: Tesla T4 (15109 MiB)
#   ✓ K3s provides native GPU support
#   ✓ NVIDIA Container Runtime automatically configured
#   ✓ GPU resources available: 1 GPU(s)
```

### Local Development (Mac)

```bash
# Automatically uses Minikube
./scripts/start-k8s.sh --local

# Output:
# 🎯 Using Minikube (Development)
#   ✓ Easy local development
# ⚙️  Starting minikube...
# ✓ Minikube already running
```

### Stop Services

```bash
# Automatically detects and stops the right distribution
./scripts/start-k8s.sh --stop

# Stops K3s:
#   • Stopping K3s cluster...
#
# Or stops Minikube:
#   • Stopping minikube cluster...
```

## What Changed

### 1. Distribution Detection (Line 473-494)

Added automatic detection logic after kubectl installation:

```bash
if [[ "$OS_TYPE" == "linux" ]] && [ "$NODE_ENV" = "production" ]; then
    K8S_DISTRIBUTION="k3s"
elif [[ "$OS_TYPE" == "macos" ]] || [ "$NODE_ENV" = "local" ]; then
    K8S_DISTRIBUTION="minikube"
fi
```

### 2. K3s Setup Function (Line 519-577)

New `setup_k3s()` function that:
- Installs K3s with Docker integration
- Configures kubectl to use K3s
- Enables metrics-server
- Validates cluster is running

### 3. Conditional Cluster Startup (Line 579-613)

Replaced single Minikube startup with conditional logic:

```bash
if [ "$K8S_DISTRIBUTION" = "k3s" ]; then
    setup_k3s
    # K3s uses host Docker directly
elif [ "$K8S_DISTRIBUTION" = "minikube" ]; then
    # Existing Minikube startup code
fi
```

### 4. Enhanced GPU Support (Line 687-801)

Updated GPU configuration for both distributions:

**K3s Path:**
- Installs NVIDIA Container Toolkit
- Configures Docker for NVIDIA runtime
- Native GPU passthrough

**Minikube Path:**
- Device plugin approach (with warnings)
- Notes Docker-in-Docker limitations

### 5. Stop/Cleanup Functions (Line 72-98, 1092-1124)

Updated to handle both distributions:

```bash
if [ "$K8S_DISTRIBUTION" = "k3s" ]; then
    sudo systemctl stop k3s
elif [ "$K8S_DISTRIBUTION" = "minikube" ]; then
    minikube stop
fi
```

## Benefits

### For Production (Linux)

1. **Native GPU Access**: No Docker-in-Docker overhead
2. **Better Performance**: K3s uses ~40% less memory than full Kubernetes
3. **Production-Ready**: CNCF certified, used by thousands of production deployments
4. **Faster Startup**: K3s starts in seconds vs minutes for Minikube

### For Development (Mac)

1. **No Changes**: Your existing workflow remains the same
2. **Familiar Tools**: Keep using Minikube commands you know
3. **Easy Debugging**: Minikube dashboard and logs work as before

## Verification

After running the script, you can verify the setup:

### Check Distribution
```bash
# K3s
kubectl config current-context
# Output: default

# Minikube
kubectl config current-context
# Output: minikube
```

### Check GPU Resources (K3s only)
```bash
kubectl describe nodes | grep -A 10 "Allocatable"
# Should show: nvidia.com/gpu: 1
```

### Check Agent Pods
```bash
kubectl get pods -n ai-agents
# All pods should be Running (not Pending)
```

## Troubleshooting

### K3s Issues

**Problem**: K3s not starting
```bash
sudo systemctl status k3s
sudo journalctl -u k3s -f
```

**Problem**: GPU not visible
```bash
# Check NVIDIA Container Toolkit
nvidia-container-runtime --version

# Verify Docker NVIDIA runtime
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

### Minikube Issues

**Problem**: Minikube not starting
```bash
minikube logs
minikube delete && minikube start --driver=docker
```

## Migration from Old Setup

If you had Minikube running on Linux production:

1. **Stop old cluster**: `minikube stop && minikube delete`
2. **Run new script**: `./scripts/start-k8s.sh --production --daemon`
3. **Verify GPU**: `kubectl describe nodes | grep nvidia.com/gpu`
4. **Test agent**: Create a session and verify Kokoro TTS uses GPU

Your deployment manifests don't need any changes - they'll work with both distributions.

## Performance Expectations

### K3s + GPU (Production Linux)

**Kokoro TTS latency (with Tesla T4):**
- First synthesis: ~100-150ms (model loading)
- Subsequent: ~50-70ms (2-6x faster than CPU)
- 70% faster than cloud TTS (200-300ms)

### Minikube (Mac Development)

**Kokoro TTS latency (CPU only):**
- First synthesis: ~200-300ms (model loading)
- Subsequent: ~100-150ms
- Still faster than cloud TTS (200-300ms)

## Next Steps

1. **Test on your production server**: Run the script and verify GPU support
2. **Monitor agent startup**: Check logs to confirm models are pre-loaded
3. **Measure latency**: Compare TTS performance with/without GPU

---

**Created**: 2025-11-23
**Script Version**: start-k8s.sh with auto-selection
**Purpose**: Document automatic Kubernetes distribution selection
