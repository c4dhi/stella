#!/bin/bash

# Port-Forward Monitoring Script
# Ensures kubectl port-forwards stay running
# Can be run as a systemd service or cron job

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PID_DIR="/tmp/stella-ai-k8s"
LOG_FILE="$PID_DIR/monitor.log"
CHECK_INTERVAL=30  # Check every 30 seconds

# Change to script directory
cd "$(dirname "$0")/.."

# Create log directory
mkdir -p "$PID_DIR"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if a port-forward is running
check_port_forward() {
    local pid=$1
    local service=$2

    if ps -p $pid > /dev/null 2>&1; then
        return 0  # Running
    else
        return 1  # Not running
    fi
}

# Function to start a single port-forward
start_port_forward() {
    local service=$1
    local port=$2

    log "Starting port-forward: $service -> localhost:$port"

    nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/$service $port:$port > "$PID_DIR/pf-$service.log" 2>&1 &
    local pid=$!

    # Wait a moment and verify it started
    sleep 2
    if ps -p $pid > /dev/null 2>&1; then
        log "✓ Port-forward started: $service (PID: $pid)"
        echo $pid
        return 0
    else
        log "✗ Failed to start port-forward: $service"
        return 1
    fi
}

# Function to restart all port-forwards
restart_port_forwards() {
    log "================================================"
    log "Restarting all port-forwards..."
    log "================================================"

    # Kill existing port-forwards
    if [ -f "$PID_DIR/port-forwards.pid" ]; then
        while read pid; do
            if ps -p $pid > /dev/null 2>&1; then
                kill $pid 2>/dev/null || true
                log "Stopped old port-forward (PID: $pid)"
            fi
        done < "$PID_DIR/port-forwards.pid"
    fi

    # Detect environment from .env
    NODE_ENV="local"
    if [ -f .env ]; then
        NODE_ENV=$(grep "^NODE_ENV=" .env | cut -d'=' -f2)
    fi

    # Start new port-forwards
    PF_FRONTEND=$(start_port_forward "frontend-ui" "8080")
    PF_BACKEND=$(start_port_forward "session-management-server" "3000")
    PF_LIVEKIT=$(start_port_forward "livekit" "7880")

    # Postgres: Use different local port in production (nginx uses 5432)
    if [ "$NODE_ENV" = "production" ]; then
        log "Starting port-forward: postgres -> localhost:15432"
        nohup kubectl port-forward -n ai-agents --address 127.0.0.1 svc/postgres 15432:5432 > "$PID_DIR/pf-postgres.log" 2>&1 &
        PF_POSTGRES=$!
        sleep 2
        if ps -p $PF_POSTGRES > /dev/null 2>&1; then
            log "✓ Port-forward started: postgres (PID: $PF_POSTGRES)"
        else
            log "✗ Failed to start port-forward: postgres"
            PF_POSTGRES=""
        fi
    else
        PF_POSTGRES=$(start_port_forward "postgres" "5432")
    fi

    # Save PIDs
    echo "$PF_FRONTEND" > "$PID_DIR/port-forwards.pid"
    echo "$PF_BACKEND" >> "$PID_DIR/port-forwards.pid"
    echo "$PF_LIVEKIT" >> "$PID_DIR/port-forwards.pid"
    echo "$PF_POSTGRES" >> "$PID_DIR/port-forwards.pid"

    log "All port-forwards restarted successfully"
    log "================================================"
}

# Function to check and restart if needed
check_and_restart() {
    local restart_needed=false

    if [ ! -f "$PID_DIR/port-forwards.pid" ]; then
        log "Port-forwards PID file not found - starting port-forwards"
        restart_needed=true
    else
        # Check each port-forward
        local services=("frontend-ui" "session-management-server" "livekit" "postgres")
        local index=0

        while read pid; do
            if [ ! -z "$pid" ]; then
                if ! ps -p $pid > /dev/null 2>&1; then
                    log "⚠️  Port-forward died: ${services[$index]} (PID: $pid)"
                    restart_needed=true
                fi
            fi
            index=$((index + 1))
        done < "$PID_DIR/port-forwards.pid"
    fi

    if [ "$restart_needed" = true ]; then
        restart_port_forwards
    fi
}

# Main monitoring loop
monitor_loop() {
    log "================================================"
    log "Port-Forward Monitor Started"
    log "Check interval: ${CHECK_INTERVAL}s"
    log "PID file: $PID_DIR/port-forwards.pid"
    log "================================================"

    while true; do
        check_and_restart
        sleep $CHECK_INTERVAL
    done
}

# Parse command line arguments
case "${1:-}" in
    --once)
        # Run once and exit (for cron)
        log "Running single check..."
        check_and_restart
        log "Check complete"
        ;;
    --restart)
        # Force restart all port-forwards
        restart_port_forwards
        ;;
    --status)
        # Show status
        # Detect environment
        NODE_ENV="local"
        if [ -f .env ]; then
            NODE_ENV=$(grep "^NODE_ENV=" .env | cut -d'=' -f2)
        fi

        echo "Port-Forward Status:"
        echo "===================="
        if [ -f "$PID_DIR/port-forwards.pid" ]; then
            # Set postgres port based on environment
            POSTGRES_PORT="5432"
            if [ "$NODE_ENV" = "production" ]; then
                POSTGRES_PORT="15432"
            fi
            services=("frontend-ui:8080" "backend:3000" "livekit:7880" "postgres:$POSTGRES_PORT")
            index=0
            while read pid; do
                if [ ! -z "$pid" ]; then
                    if ps -p $pid > /dev/null 2>&1; then
                        echo -e "  ${GREEN}✓${NC} ${services[$index]} (PID: $pid)"
                    else
                        echo -e "  ${RED}✗${NC} ${services[$index]} (PID: $pid - DEAD)"
                    fi
                    index=$((index + 1))
                fi
            done < "$PID_DIR/port-forwards.pid"
        else
            echo "  No port-forwards running"
        fi
        echo ""
        echo "Logs: $LOG_FILE"
        ;;
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Monitor and restart kubectl port-forwards automatically"
        echo ""
        echo "Options:"
        echo "  (no args)    Run in monitoring loop (checks every ${CHECK_INTERVAL}s)"
        echo "  --once       Run single check and exit (for cron)"
        echo "  --restart    Force restart all port-forwards"
        echo "  --status     Show current status"
        echo "  --help       Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0                  # Monitor continuously"
        echo "  $0 --once           # Single check (for cron)"
        echo "  $0 --restart        # Force restart"
        echo "  $0 --status         # Check status"
        ;;
    *)
        # Default: Run monitoring loop
        monitor_loop
        ;;
esac
