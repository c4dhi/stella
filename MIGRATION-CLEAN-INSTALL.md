# Clean Uninstall & Reinstall Guide

This guide provides step-by-step instructions for completely removing the old Minikube-based system and performing a clean K3s installation on both macOS (local development) and Linux (production).

---

## 🍎 macOS (Local Development)

### Step 1: Stop All Running Services

```bash
cd /Users/felixmoser/Github/grace-ai-workspace/grace-ai-backend

# Stop the deployment script if running
./scripts/start-k8s.sh --stop

# Or manually kill processes
pkill -f "kubectl port-forward"
```

### Step 2: Stop and Delete Minikube Cluster

```bash
# Stop Minikube
minikube stop

# Delete the cluster completely
minikube delete --all --purge

# Verify it's gone
minikube status
# Should show: "Profile 'minikube' not found"
```

### Step 3: Uninstall Minikube

```bash
# Remove Minikube binary
brew uninstall minikube

# Or if installed manually:
sudo rm -rf /usr/local/bin/minikube

# Clean up Minikube data directory
rm -rf ~/.minikube
rm -rf ~/.kube/cache
```

### Step 4: Clean Up Docker Resources

```bash
# Remove all Grace AI containers
docker ps -a | grep -E "session-management|conversational-ai|frontend-ui|message-recorder|livekit" | awk '{print $1}' | xargs docker rm -f

# Remove all Grace AI images
docker images | grep -E "session-management|conversational-ai|frontend-ui|message-recorder" | awk '{print $3}' | xargs docker rmi -f

# Optional: Full Docker cleanup (removes ALL containers/images)
docker system prune -a --volumes -f
```

### Step 5: Clean Up Kubernetes Config

```bash
# Remove Minikube context from kubeconfig
kubectl config delete-context minikube 2>/dev/null
kubectl config delete-cluster minikube 2>/dev/null
kubectl config delete-user minikube 2>/dev/null

# Verify kubectl config is clean
kubectl config get-contexts
```

### Step 6: Install K3s Runtime (Rancher Desktop or Colima)

**Option A: Rancher Desktop (Recommended - GUI + K3s)**

```bash
# Install Rancher Desktop
brew install --cask rancher

# After installation:
# 1. Open Rancher Desktop app
# 2. Go to Preferences > Kubernetes
# 3. Select "K3s" as the Kubernetes distribution
# 4. Set resources: 4 CPUs, 8GB RAM
# 5. Enable Kubernetes
# 6. Wait for it to start (~2 minutes)

# Verify K3s is running
kubectl get nodes
```

**Option B: Colima (Lightweight CLI-only)**

```bash
# Install Colima
brew install colima

# Start with K3s
colima start --kubernetes --kubernetes-version v1.28 --runtime containerd --cpu 4 --memory 8

# Verify
kubectl get nodes
colima status
```

### Step 7: Verify Clean State

```bash
# Check no old contexts remain
kubectl config get-contexts

# Should see only:
# - rancher-desktop (if using Rancher Desktop)
# - colima (if using Colima)

# Check no Grace AI resources exist
kubectl get all -A | grep -E "session-management|conversational-ai|frontend-ui"
# Should return nothing

# Check Docker images
docker images | grep -E "session-management|conversational-ai|frontend-ui"
# Should return nothing
```

---

## 🐧 Linux (Production Server)

### Step 1: Stop All Running Services

```bash
cd /root/grace-ai-workspace/grace-ai-backend  # Adjust path as needed

# Stop the deployment script if running
./scripts/start-k8s.sh --stop

# Or kill port forwards manually
pkill -f "kubectl port-forward"
```

### Step 2: Delete All Grace AI Resources from K3s

```bash
# Delete the ai-agents namespace and all resources
kubectl delete namespace ai-agents --wait=true --timeout=60s

# Force delete if stuck
kubectl delete namespace ai-agents --grace-period=0 --force

# Verify namespace is gone
kubectl get namespaces | grep ai-agents
```

### Step 3: Stop and Uninstall K3s

```bash
# Stop K3s service
sudo systemctl stop k3s

# Uninstall K3s completely
/usr/local/bin/k3s-uninstall.sh

# Verify K3s is gone
sudo systemctl status k3s
# Should show: "Unit k3s.service could not be found"

which k3s
# Should return nothing
```

### Step 4: Clean Up K3s Storage

```bash
# Remove K3s data directory
sudo rm -rf /var/lib/rancher/k3s
sudo rm -rf /etc/rancher/k3s

# Remove K3s containerd storage
sudo rm -rf /var/lib/rancher

# Verify storage is freed
df -h /
```

### Step 5: Clean Up Docker Resources

```bash
# Remove all Grace AI containers
docker ps -a | grep -E "session-management|conversational-ai|frontend-ui|message-recorder|livekit" | awk '{print $1}' | xargs -r docker rm -f

# Remove all Grace AI images
docker images | grep -E "session-management|conversational-ai|frontend-ui|message-recorder" | awk '{print $3}' | xargs -r docker rmi -f

# Clean up Docker storage (optional - frees up space)
docker system prune -a --volumes -f
```

### Step 6: Clean Up Old Docker containerd Storage (if migrating from old setup)

**⚠️ IMPORTANT**: Only do this if you have old Docker containerd storage and don't need it

```bash
# Check Docker containerd size
sudo du -sh /var/lib/containerd

# If it's large (>10GB) and you don't need it:
sudo systemctl stop docker
sudo rm -rf /var/lib/containerd/*
sudo systemctl start docker

# Verify
sudo du -sh /var/lib/containerd
# Should show much smaller size
```

### Step 7: Clean Up Kubernetes Config

```bash
# Remove old kubectl contexts
kubectl config delete-context k3s 2>/dev/null
kubectl config delete-context default 2>/dev/null
kubectl config delete-cluster k3s 2>/dev/null
kubectl config delete-cluster default 2>/dev/null

# Or reset kubeconfig entirely
rm -f ~/.kube/config
```

### Step 8: Verify Clean State

```bash
# Verify K3s is completely removed
sudo systemctl status k3s
# Should show: "Unit k3s.service could not be found"

# Verify no kubectl access
kubectl get nodes
# Should show: "The connection to the server localhost:8080 was refused"

# Check disk space recovered
df -h /
```

---

## ✨ Clean Installation

### macOS (Local Development)

```bash
cd /Users/felixmoser/Github/grace-ai-workspace/grace-ai-backend

# Ensure K3s runtime is running
kubectl get nodes
# Should show 1 node in Ready state

# Run the installation script
./scripts/start-k8s.sh

# What to expect:
# ✅ 🎯 Using K3s (Unified Kubernetes)
# ✅ 🔍 Auto-detecting Kubernetes DNS IP...
# ✅ 📦 Building Docker images...
# ✅ 📦 Importing images into K3s containerd...
# ✅ 🚀 Deploying to Kubernetes...
# ✅ ✨ Services are running

# Access the system:
# - Frontend: http://localhost:8080
# - API: http://localhost:3000
# - Database: localhost:5432
```

### Linux (Production Server)

```bash
cd /root/grace-ai-workspace/grace-ai-backend  # Adjust path

# Run the installation script
# It will automatically install K3s if not present
./scripts/start-k8s.sh

# What to expect:
# ✅ Installing K3s...
# ✅ 🎯 Using K3s (Unified Kubernetes)
# ✅ 🎮 GPU Support Configuration (if NVIDIA GPU detected)
# ✅ 📦 Building Docker images...
# ✅ 📦 Importing images into K3s containerd...
# ✅ 🚀 Deploying to Kubernetes...
# ✅ ✨ Services running in background

# Access the system:
# - Frontend: https://frontend.c4dhi.moserfelix.com
# - API: https://backend.c4dhi.moserfelix.com
# - LiveKit: wss://livekit-v1.c4dhi.moserfelix.com
```

---

## 🔍 Verification Steps

### After Clean Install - macOS

```bash
# 1. Check K3s node
kubectl get nodes
# Should show: 1 node Ready

# 2. Check Grace AI namespace created
kubectl get namespaces | grep ai-agents
# Should show: ai-agents Active

# 3. Check all pods running
kubectl get pods -n ai-agents
# Should show:
# - session-management-server Running
# - postgres Running
# - frontend-ui Running

# 4. Check services
kubectl get svc -n ai-agents

# 5. Test frontend
curl http://localhost:8080
# Should return HTML

# 6. Test API
curl http://localhost:3000/health
# Should return: {"status":"ok"}
```

### After Clean Install - Production

```bash
# 1. Check K3s node
kubectl get nodes
# Should show: 1 node Ready

# 2. Check GPU resources (if applicable)
kubectl describe nodes | grep -A 5 "Allocatable:"
# Should show: nvidia.com/gpu: 1

# 3. Check all pods running
kubectl get pods -n ai-agents
# All should be Running

# 4. Check services
kubectl get svc -n ai-agents

# 5. Test public URLs
curl https://backend.c4dhi.moserfelix.com/health
# Should return: {"status":"ok"}

curl https://frontend.c4dhi.moserfelix.com
# Should return HTML

# 6. Check logs for errors
./scripts/start-k8s.sh --stop  # View logs
```

---

## 🚨 Troubleshooting

### macOS: "kubectl: command not found"

```bash
# Ensure kubectl is installed
brew install kubectl

# Or use the one from Rancher Desktop
export PATH="/Applications/Rancher Desktop.app/Contents/Resources/resources/darwin/bin:$PATH"
```

### macOS: "Cannot connect to Kubernetes cluster"

```bash
# Check K3s runtime status
# For Rancher Desktop: Open app, check Kubernetes is enabled
# For Colima:
colima status
colima start --kubernetes
```

### Production: "K3s installation failed"

```bash
# Check system requirements
free -h  # Need at least 2GB free RAM
df -h /  # Need at least 20GB free disk

# Check network connectivity
curl -sfL https://get.k3s.io
# Should return installation script

# Manual K3s install
curl -sfL https://get.k3s.io | sh -
sudo systemctl enable --now k3s
```

### Production: "GPU not detected"

```bash
# Verify NVIDIA drivers
nvidia-smi

# If not installed:
# Check NVIDIA driver installation documentation for your Linux distribution
```

### Both: "Port already in use"

```bash
# Check what's using the ports
lsof -i :3000  # API
lsof -i :5432  # Database
lsof -i :8080  # Frontend

# Kill the processes
sudo lsof -t -i:3000 | xargs kill -9
sudo lsof -t -i:5432 | xargs kill -9
sudo lsof -t -i:8080 | xargs kill -9
```

---

## 📝 Notes

1. **Rancher Desktop vs Colima**: Rancher Desktop provides a GUI and is easier for beginners. Colima is lightweight and CLI-only.

2. **Production GPU Support**: The script automatically detects and configures NVIDIA GPUs in production mode (NODE_ENV=production).

3. **Disk Space**: The clean install will use:
   - macOS: ~15-20GB (Docker images + K3s)
   - Linux: ~25-30GB (Docker images + K3s containerd + logs)

4. **Migration from Old Setup**: If migrating from the old Minikube+K3s setup, you may recover 30-40GB of disk space by cleaning up old containerd storage.

5. **Environment Files**: Your existing `.env.local` and `.env.production` files will work without changes.

---

## 🎯 Summary

| Step | macOS | Linux Production |
|------|-------|------------------|
| 1. Stop services | `./scripts/start-k8s.sh --stop` | `./scripts/start-k8s.sh --stop` |
| 2. Remove cluster | `minikube delete --all` | `/usr/local/bin/k3s-uninstall.sh` |
| 3. Clean storage | `rm -rf ~/.minikube` | `sudo rm -rf /var/lib/rancher` |
| 4. Clean Docker | `docker system prune -a` | `docker system prune -a` |
| 5. Install K3s | Rancher Desktop or Colima | Auto-installed by script |
| 6. Clean install | `./scripts/start-k8s.sh` | `./scripts/start-k8s.sh` |

**Total Time**:
- macOS: ~15 minutes
- Linux: ~10 minutes
