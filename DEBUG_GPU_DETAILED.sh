#!/bin/bash
# Comprehensive GPU Device Plugin Debugging

echo "🔍 Detailed GPU Device Plugin Debug"
echo "========================================"
echo ""

export KUBECONFIG=~/.kube/config

# 1. Check device plugin pod
echo "1️⃣  Device Plugin Pod Status:"
echo "----------------------------------------"
DEVICE_PLUGIN_POD=$(kubectl get pods -n kube-system -l name=nvidia-device-plugin-ds -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -n "$DEVICE_PLUGIN_POD" ]; then
    echo "Pod name: $DEVICE_PLUGIN_POD"
    kubectl get pod -n kube-system "$DEVICE_PLUGIN_POD" -o wide
else
    echo "❌ No device plugin pod found!"
    exit 1
fi
echo ""

# 2. Check device plugin container details
echo "2️⃣  Container Runtime & Mounts:"
echo "----------------------------------------"
# Get the container ID
CONTAINER_ID=$(kubectl get pod -n kube-system "$DEVICE_PLUGIN_POD" -o jsonpath='{.status.containerStatuses[0].containerID}' | sed 's/docker:\/\///')
echo "Container ID: $CONTAINER_ID"
echo ""

# Check Docker container inspect
echo "Docker container mounts:"
sudo docker inspect "$CONTAINER_ID" | grep -A 20 '"Mounts"'
echo ""

# 3. Check if libraries are mounted inside container
echo "3️⃣  Files Inside Container:"
echo "----------------------------------------"
echo "Contents of /usr/local/nvidia (should have NVIDIA libs):"
kubectl exec -n kube-system "$DEVICE_PLUGIN_POD" -- ls -la /usr/local/nvidia/ 2>&1 | head -20
echo ""

echo "Search for libnvidia-ml.so* in container:"
kubectl exec -n kube-system "$DEVICE_PLUGIN_POD" -- find /usr/local/nvidia -name "libnvidia-ml.so*" 2>&1
echo ""

# 4. Check library path in container
echo "4️⃣  Library Path Configuration:"
echo "----------------------------------------"
echo "LD_LIBRARY_PATH inside container:"
kubectl exec -n kube-system "$DEVICE_PLUGIN_POD" -- env | grep LD_LIBRARY_PATH
echo ""

echo "Check if libs are findable by ldconfig:"
kubectl exec -n kube-system "$DEVICE_PLUGIN_POD" -- ldconfig -p 2>&1 | grep nvidia || echo "No nvidia libs in ldconfig cache"
echo ""

# 5. Check NVIDIA environment variables
echo "5️⃣  NVIDIA Environment Variables:"
echo "----------------------------------------"
kubectl exec -n kube-system "$DEVICE_PLUGIN_POD" -- env | grep NVIDIA
echo ""

# 6. Try running nvidia-smi inside container
echo "6️⃣  Test GPU Access Inside Container:"
echo "----------------------------------------"
echo "Trying nvidia-smi inside container:"
kubectl exec -n kube-system "$DEVICE_PLUGIN_POD" -- nvidia-smi 2>&1 || echo "nvidia-smi failed"
echo ""

# 7. Check the actual device plugin logs
echo "7️⃣  Device Plugin Logs (last 30 lines):"
echo "----------------------------------------"
kubectl logs -n kube-system "$DEVICE_PLUGIN_POD" --tail=30
echo ""

# 8. Check host library location
echo "8️⃣  Host Library Verification:"
echo "----------------------------------------"
echo "NVIDIA libraries on host:"
ls -la /usr/lib/x86_64-linux-gnu/libnvidia-ml.so*
echo ""

echo "Check if libs are in standard location:"
ldconfig -p | grep libnvidia-ml.so
echo ""

# 9. Check Docker daemon NVIDIA runtime config
echo "9️⃣  Docker NVIDIA Runtime:"
echo "----------------------------------------"
cat /etc/docker/daemon.json 2>/dev/null | grep -A 10 nvidia || echo "No NVIDIA runtime in daemon.json"
echo ""

# 10. Test GPU with a simple container
echo "🔟 Test GPU with Simple Container:"
echo "----------------------------------------"
echo "Running test container with GPU access:"
sudo docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi 2>&1 | head -10
echo ""

echo "========================================"
echo "🔧 ANALYSIS:"
echo "========================================"
echo ""

# Analyze the findings
echo "Key things to check:"
echo "1. Are NVIDIA libs visible at /usr/local/nvidia in the container?"
echo "2. Is LD_LIBRARY_PATH set correctly?"
echo "3. Can the container run nvidia-smi?"
echo "4. Are NVIDIA_VISIBLE_DEVICES and NVIDIA_DRIVER_CAPABILITIES set?"
echo ""
echo "If libs are NOT in /usr/local/nvidia, the mount path is wrong."
echo "If libs ARE there but not found, LD_LIBRARY_PATH needs to be set."
echo "If docker test works but k8s doesn't, it's a k8s config issue."
