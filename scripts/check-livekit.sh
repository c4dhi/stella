#!/bin/bash
# =============================================================================
# check-livekit.sh - Verify LiveKit server is reachable before starting backend
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

MAX_RETRIES="${LIVEKIT_HEALTH_RETRIES:-1}"
RETRY_DELAY="${LIVEKIT_HEALTH_RETRY_DELAY:-3}"
TIMEOUT="${LIVEKIT_HEALTH_TIMEOUT:-5}"

resolve_livekit_url() {
    local url="${LIVEKIT_URL:-}"

    if [[ -z "$url" ]]; then
        for env_file in "$ROOT_DIR/.env.local" "$ROOT_DIR/.env.production" "$ROOT_DIR/.env"; do
            if [[ -f "$env_file" ]]; then
                url=$(grep -E '^LIVEKIT_URL=' "$env_file" | head -1 | cut -d'=' -f2- | tr -d '"' || true)
                [[ -n "$url" ]] && break
            fi
        done
    fi

    if [[ -z "$url" ]]; then
        echo ""
        return
    fi

    # ws(s):// → http(s)://
    url="${url/wss:\/\//https://}"
    url="${url/ws:\/\//http://}"

    # host.docker.internal → localhost (we're running on the host, not in Docker)
    url="${url/host.docker.internal/localhost}"

    echo "$url"
}

check_livekit() {
    local url="$1"
    curl -sf -o /dev/null -m "$TIMEOUT" "$url" 2>/dev/null
}

main() {
    local http_url
    http_url=$(resolve_livekit_url)

    if [[ -z "$http_url" ]]; then
        echo ""
        echo -e "${YELLOW}⚠  LIVEKIT_URL is not set${NC}"
        echo ""
        echo -e "  The backend needs a running LiveKit server to handle WebRTC sessions."
        echo ""
        echo -e "  ${BOLD}To fix:${NC}"
        echo -e "  1. Set ${CYAN}LIVEKIT_URL${NC} in your .env.local or environment"
        echo -e "  2. Start the LiveKit server (see below)"
        echo ""
        echo -e "  ${BOLD}Start LiveKit:${NC}"
        echo -e "    ${DIM}cd ../STELLA_livekit${NC}"
        echo -e "    ${DIM}./scripts/start.sh --mode local --start${NC}"
        echo ""
        exit 1
    fi

    echo -e "${DIM}Checking LiveKit at ${http_url} ...${NC}"

    local attempt=1
    while [[ $attempt -le $MAX_RETRIES ]]; do
        if check_livekit "$http_url"; then
            echo -e "${GREEN}✓${NC} LiveKit is reachable"
            echo ""
            return 0
        fi

        if [[ $attempt -lt $MAX_RETRIES ]]; then
            echo -e "  ${DIM}Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY}s ...${NC}"
            sleep "$RETRY_DELAY"
        fi

        ((attempt++))
    done

    local ws_url="${LIVEKIT_URL:-ws://localhost:7880}"

    echo ""
    echo -e "${RED}✗  LiveKit is not reachable at ${http_url}${NC}"
    echo ""
    echo -e "  The backend requires a running LiveKit server for WebRTC sessions."
    echo -e "  Without it, rooms cannot be created and participants cannot join."
    echo ""
    echo -e "  ${BOLD}Quick start:${NC}"
    echo -e "    ${CYAN}cd ../STELLA_livekit && ./scripts/start.sh --mode local --start${NC}"
    echo ""
    echo -e "  ${BOLD}Or with Docker directly:${NC}"
    echo -e "    ${CYAN}cd ../STELLA_livekit && docker compose up -d${NC}"
    echo ""
    echo -e "  ${BOLD}Verify it's running:${NC}"
    echo -e "    ${CYAN}curl -s ${http_url}${NC}"
    echo ""
    echo -e "  ${DIM}Expected LiveKit URL: ${ws_url}${NC}"
    echo -e "  ${DIM}Set LIVEKIT_HEALTH_RETRIES=5 to wait longer for startup${NC}"
    echo -e "  ${DIM}Set LIVEKIT_SKIP_CHECK=1 to bypass this check${NC}"
    echo ""
    exit 1
}

if [[ "${LIVEKIT_SKIP_CHECK:-0}" == "1" ]]; then
    exit 0
fi

main "$@"
