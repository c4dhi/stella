#!/bin/bash
# =============================================================================
# utils.sh - Shared utility functions
# =============================================================================

# =============================================================================
# Hashing Functions
# =============================================================================

# Hash a single file (cross-platform)
hash_file() {
    local file="$1"
    if [[ "$OS_TYPE" == "macos" ]]; then
        md5 -q "$file" 2>/dev/null || echo ""
    else
        md5sum "$file" 2>/dev/null | cut -d' ' -f1 || echo ""
    fi
}

# Hash a string (cross-platform)
hash_string() {
    local input="${1:-$(cat)}"
    if [[ "$OS_TYPE" == "macos" ]]; then
        echo -n "$input" | md5 -q
    else
        echo -n "$input" | md5sum | cut -d' ' -f1
    fi
}

# =============================================================================
# File Operations
# =============================================================================

# Check if a file exists and is readable
file_exists() {
    [[ -f "$1" && -r "$1" ]]
}

# Check if a directory exists
dir_exists() {
    [[ -d "$1" ]]
}

# Ensure directory exists
ensure_dir() {
    [[ -d "$1" ]] || mkdir -p "$1"
}

# =============================================================================
# Process Management
# =============================================================================

# Check if a process is running by PID
process_running() {
    local pid="$1"
    kill -0 "$pid" 2>/dev/null
}

# Kill a process gracefully
kill_graceful() {
    local pid="$1"
    local timeout="${2:-5}"

    kill -TERM "$pid" 2>/dev/null || return 0

    local count=0
    while process_running "$pid" && [[ $count -lt $timeout ]]; do
        sleep 1
        ((count++))
    done

    process_running "$pid" && kill -9 "$pid" 2>/dev/null
}

# =============================================================================
# Network Utilities
# =============================================================================

# Check if a port is available
port_available() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        ! lsof -i :"$port" &>/dev/null
    elif command -v ss &>/dev/null; then
        ! ss -tuln | grep -q ":${port} "
    else
        # Fallback: try to bind
        (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null && return 1 || return 0
    fi
}

# Get local IP address
get_local_ip() {
    if [[ "$OS_TYPE" == "macos" ]]; then
        ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1"
    else
        hostname -I 2>/dev/null | awk '{print $1}' || \
        ip route get 1 2>/dev/null | awk '{print $7; exit}' || \
        echo "127.0.0.1"
    fi
}

# =============================================================================
# Command Helpers
# =============================================================================

# Check if a command exists
command_exists() {
    command -v "$1" &>/dev/null
}

# Run a command silently (output to /dev/null)
silent() {
    "$@" >/dev/null 2>&1
}

# Run a command and capture exit code without failing
try_run() {
    "$@" || true
}

# =============================================================================
# Array/String Helpers
# =============================================================================

# Check if array contains element
array_contains() {
    local needle="$1"
    shift
    local element
    for element in "$@"; do
        [[ "$element" == "$needle" ]] && return 0
    done
    return 1
}

# Join array elements with delimiter
join_by() {
    local delimiter="$1"
    shift
    local first="$1"
    shift
    printf '%s' "$first" "${@/#/$delimiter}"
}

# =============================================================================
# Cleanup Helpers
# =============================================================================

# Register cleanup function
CLEANUP_FUNCS=()

register_cleanup() {
    CLEANUP_FUNCS+=("$1")
}

run_cleanup() {
    # Check if array has elements before iterating (avoids unbound variable error)
    if [[ ${#CLEANUP_FUNCS[@]} -gt 0 ]]; then
        for func in "${CLEANUP_FUNCS[@]}"; do
            "$func" 2>/dev/null || true
        done
    fi
}

# Set up trap for cleanup
trap run_cleanup EXIT INT TERM

# =============================================================================
# Logging
# =============================================================================

# Log to file if LOG_FILE is set
log() {
    local message="$1"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    if [[ -n "${LOG_FILE:-}" ]]; then
        echo "[$timestamp] $message" >> "$LOG_FILE"
    fi
}

# =============================================================================
# Retry Logic
# =============================================================================

# Retry a command with exponential backoff
retry() {
    local max_attempts="${1:-3}"
    local delay="${2:-1}"
    shift 2

    local attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        if "$@"; then
            return 0
        fi

        if [[ $attempt -lt $max_attempts ]]; then
            sleep "$delay"
            delay=$((delay * 2))
        fi

        ((attempt++))
    done

    return 1
}

# =============================================================================
# Version Comparison
# =============================================================================

# Compare semantic versions (returns 0 if $1 >= $2)
version_gte() {
    local v1="$1"
    local v2="$2"

    # Use sort -V for version comparison
    [[ "$(printf '%s\n%s' "$v1" "$v2" | sort -V | head -n1)" == "$v2" ]]
}
