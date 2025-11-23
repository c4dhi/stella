#!/bin/bash
# Fix corrupted NVIDIA Container Toolkit repository from previous installation attempt

echo "🔧 Cleaning up corrupted NVIDIA repository..."

# Remove corrupted repository list
if [ -f /etc/apt/sources.list.d/libnvidia-container.list ]; then
    sudo rm /etc/apt/sources.list.d/libnvidia-container.list
    echo "  ✓ Removed corrupted repository list"
fi

# Remove old deprecated keyring
if [ -f /etc/apt/trusted.gpg.d/nvidia-container-toolkit-keyring.gpg ]; then
    sudo rm /etc/apt/trusted.gpg.d/nvidia-container-toolkit-keyring.gpg
    echo "  ✓ Removed deprecated keyring"
fi

# Update apt cache
echo "  • Updating apt cache..."
sudo apt-get update > /dev/null 2>&1

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "Now you can re-run the deployment script:"
echo "  ./scripts/start-k8s.sh --production --daemon"
