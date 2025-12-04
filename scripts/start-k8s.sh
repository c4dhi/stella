#!/bin/bash
# =============================================================================
# STELLA - Kubernetes Deployment Script
# =============================================================================
# Unified deployment for local development (macOS/OrbStack) and production (Ubuntu/K3s)
#
# Usage:
#   ./scripts/start-k8s.sh                    # Local development (auto-detect changes)
#   ./scripts/start-k8s.sh --production       # Production deployment
#   ./scripts/start-k8s.sh --rebuild          # Force rebuild all images
#   ./scripts/start-k8s.sh --skip-build       # Skip builds, restart pods only
#   ./scripts/start-k8s.sh --dry-run          # Preview changes without executing
#   ./scripts/start-k8s.sh --verbose          # Detailed output
#   ./scripts/start-k8s.sh --daemon           # Run in background
#   ./scripts/start-k8s.sh --stop             # Stop all services
#
# =============================================================================

set -euo pipefail

# =============================================================================
# Script Setup
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

# Source library modules
source "$LIB_DIR/colors.sh"
source "$LIB_DIR/utils.sh"
source "$LIB_DIR/environment.sh"
source "$LIB_DIR/validation.sh"
source "$LIB_DIR/k3s.sh"
source "$LIB_DIR/build.sh"
source "$LIB_DIR/deploy.sh"

# =============================================================================
# Global Variables
# =============================================================================

DAEMON_MODE=false
STOP_MODE=false
REBUILD_MODE=false
RESET_DB_MODE=false
SKIP_BUILD_MODE=false
DRY_RUN_MODE=false
VERBOSE_MODE=false
ENV_FLAG=""

# =============================================================================
# Argument Parsing (single-pass)
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --daemon|-d)
                DAEMON_MODE=true
                ;;
            --stop)
                STOP_MODE=true
                ;;
            --rebuild)
                REBUILD_MODE=true
                ;;
            --reset-db)
                RESET_DB_MODE=true
                REBUILD_MODE=true  # reset-db implies rebuild
                ;;
            --skip-build)
                SKIP_BUILD_MODE=true
                ;;
            --dry-run)
                DRY_RUN_MODE=true
                ;;
            --verbose|-v)
                VERBOSE_MODE=true
                ;;
            --local)
                ENV_FLAG="local"
                ;;
            --production)
                ENV_FLAG="production"
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                echo ""
                show_help
                exit 1
                ;;
        esac
        shift
    done

    # Export for use in modules
    export DAEMON_MODE STOP_MODE REBUILD_MODE RESET_DB_MODE
    export SKIP_BUILD_MODE DRY_RUN_MODE VERBOSE_MODE ENV_FLAG
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --local         Run in local development mode (default)"
    echo "  --production    Run in production mode"
    echo "  --rebuild       Force rebuild all Docker images"
    echo "  --reset-db      Reset database and rebuild (WARNING: data loss)"
    echo "  --skip-build    Skip builds, restart pods only"
    echo "  --dry-run       Preview changes without executing"
    echo "  --verbose, -v   Show detailed output"
    echo "  --daemon, -d    Run in background mode"
    echo "  --stop          Stop all services"
    echo "  --help, -h      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                        # Local dev, auto-detect changes"
    echo "  $0 --production           # Production deployment"
    echo "  $0 --rebuild              # Force rebuild everything"
    echo "  $0 --dry-run --verbose    # Preview with details"
}

# =============================================================================
# Main Execution Flow
# =============================================================================

main() {
    # Parse command line arguments
    parse_args "$@"

    # Display header
    local mode_suffix=""
    [[ "$DRY_RUN_MODE" == "true" ]] && mode_suffix=" ${YELLOW}(DRY RUN)${NC}"
    echo ""
    echo -e "${EMOJI_ROCKET} ${BOLD}STELLA - Kubernetes Deployment${NC}${mode_suffix}"
    echo ""

    # Phase 1: Environment Detection (fast, no I/O)
    detect_environment

    # Phase 2: Handle stop mode early
    if [[ "$STOP_MODE" == "true" ]]; then
        stop_services
        exit 0
    fi

    # Phase 3: Load Configuration
    load_environment

    # Phase 4: Validate Configuration (fail-fast)
    validate_configuration
    validate_build_prerequisites
    validate_k3s_prerequisites

    # Phase 5: Setup K3s
    setup_k3s

    # Phase 6: Setup GPU if enabled (Linux only)
    setup_gpu_support

    # Phase 7: Build Images
    build_images

    # Phase 8: Deploy to Kubernetes
    deploy_services

    # Phase 9: Start Port Forwards
    start_port_forwards

    # Phase 10: Show Summary
    show_summary

    # Phase 11: Handle daemon/foreground mode
    if [[ "$DAEMON_MODE" == "true" ]]; then
        echo ""
        info "Running in daemon mode - use '$0 --stop' to stop"
        exit 0
    else
        # Foreground mode: wait for Ctrl+C
        if [[ "$DRY_RUN_MODE" != "true" ]]; then
            echo ""
            info "Press Ctrl+C to stop"

            # Wait for interrupt
            trap cleanup INT TERM
            while true; do
                sleep 60
            done
        fi
    fi
}

cleanup() {
    echo ""
    info "Shutting down..."
    stop_services
    exit 0
}

# =============================================================================
# Run Main
# =============================================================================

main "$@"
