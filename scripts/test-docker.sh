#!/bin/bash
set -e

echo "=== Docker Test Script ==="
echo "Initial PATH: $PATH"
echo ""

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.orbstack/bin:$PATH"
echo "Updated PATH: $PATH"
echo ""

echo "which docker:"
which docker || echo "docker not found in PATH"
echo ""

echo "docker --version:"
docker --version || echo "docker command failed"
echo ""

echo "docker info (first 3 lines):"
docker info 2>&1 | head -3 || echo "docker info failed"
echo ""

echo "=== Test Complete ==="
