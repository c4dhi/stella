#!/bin/sh

# Entrypoint script for frontend container
# Injects runtime environment variables into config.js

set -e

echo "========================================"
echo "Frontend Container Entrypoint"
echo "========================================"
echo ""

# Set defaults if not provided
export VITE_API_URL="${VITE_API_URL:-http://localhost:3000}"
export VITE_LIVEKIT_URL="${VITE_LIVEKIT_URL:-ws://localhost:7880}"
export VITE_LIVEKIT_API_KEY="${VITE_LIVEKIT_API_KEY:-devkey}"
export VITE_LIVEKIT_API_SECRET="${VITE_LIVEKIT_API_SECRET:-secret}"

echo "[entrypoint] Environment variables:"
echo "  VITE_API_URL: ${VITE_API_URL}"
echo "  VITE_LIVEKIT_URL: ${VITE_LIVEKIT_URL}"
echo "  VITE_LIVEKIT_API_KEY: ${VITE_LIVEKIT_API_KEY}"
echo ""

echo "[entrypoint] Generating runtime config from template..."

# Check if template exists
if [ ! -f /usr/share/nginx/html/config.js.template ]; then
  echo "[entrypoint] ERROR: config.js.template not found!"
  exit 1
fi

# Substitute environment variables in the template
envsubst '${VITE_API_URL} ${VITE_LIVEKIT_URL} ${VITE_LIVEKIT_API_KEY} ${VITE_LIVEKIT_API_SECRET}' \
  < /usr/share/nginx/html/config.js.template \
  > /usr/share/nginx/html/config.js

echo "[entrypoint] ✓ Runtime config generated successfully"
echo ""
echo "[entrypoint] Generated config.js contents:"
echo "----------------------------------------"
cat /usr/share/nginx/html/config.js
echo "----------------------------------------"
echo ""

# Start nginx
echo "[entrypoint] Starting nginx..."
echo "========================================"
exec nginx -g 'daemon off;'
