#!/bin/bash
# =============================================================================
# colors.sh - Console output helpers with professional formatting
# =============================================================================

# Colors
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export DIM='\033[2m'
export BOLD='\033[1m'
export NC='\033[0m'

# Status indicators
readonly CHECK="✓"
readonly CROSS="✗"
readonly ARROW="→"
readonly BULLET="•"

# Section emojis
readonly EMOJI_ROCKET="🚀"
readonly EMOJI_GEAR="⚙️"
readonly EMOJI_BUILD="🔨"
readonly EMOJI_DEPLOY="☸️"
readonly EMOJI_SUCCESS="✅"
readonly EMOJI_WARNING="⚠️"
readonly EMOJI_NETWORK="🌐"
readonly EMOJI_DATABASE="🗄️"
readonly EMOJI_STOP="🛑"

# =============================================================================
# Output Functions
# =============================================================================

# Print section header
header() {
    echo ""
    echo -e "${BOLD}${1}${NC}"
}

# Print info message
info() {
    echo -e "${BLUE}${1}${NC}"
}

# Print success message
success() {
    echo -e "${GREEN}${CHECK} ${1}${NC}"
}

# Print warning message
warning() {
    echo -e "${YELLOW}${EMOJI_WARNING} ${1}${NC}"
}

# Print error message
error() {
    echo -e "${RED}${CROSS} ${1}${NC}" >&2
}

# Print verbose message (only when VERBOSE_MODE=true)
verbose() {
    if [[ "${VERBOSE_MODE:-false}" == "true" ]]; then
        echo -e "${DIM}   ${1}${NC}"
    fi
}

# Print debug message (only when VERBOSE_MODE=true)
debug() {
    if [[ "${VERBOSE_MODE:-false}" == "true" ]]; then
        echo -e "${DIM}   [debug] ${1}${NC}"
    fi
}

# =============================================================================
# Status Line Helpers
# =============================================================================

# Print status line with arrow (no newline)
status() {
    echo -ne "   ${ARROW} ${1}... "
}

# Mark status as OK
status_ok() {
    echo -e "${GREEN}${CHECK}${NC}"
}

# Mark status as failed
status_fail() {
    echo -e "${RED}${CROSS}${NC}"
}

# Mark status as skipped
status_skip() {
    echo -e "${YELLOW}skipped${NC}"
}

# Mark status as unchanged
status_unchanged() {
    echo -e "${DIM}unchanged${NC}"
}

# Mark status with dry-run indicator
status_dry_run() {
    echo -e "${YELLOW}[dry-run]${NC}"
}

# =============================================================================
# Single-Line Progress Updates
# =============================================================================

# Update current line in place (for build progress)
update_line() {
    echo -ne "\r\033[K${1}"
}

# Clear current line
clear_line() {
    echo -ne "\r\033[K"
}

# =============================================================================
# Formatted Output
# =============================================================================

# Print a horizontal separator
separator() {
    echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Print final summary box
summary_box() {
    local frontend_url="$1"
    local backend_url="$2"
    local livekit_url="$3"

    echo ""
    separator
    echo ""
    echo -e "${EMOJI_SUCCESS} ${BOLD}Grace AI is running!${NC}"
    echo ""
    echo -e "   Frontend:  ${CYAN}${frontend_url}${NC}"
    echo -e "   Backend:   ${CYAN}${backend_url}${NC}"
    echo -e "   LiveKit:   ${CYAN}${livekit_url}${NC}"
    echo ""
    echo -e "   ${DIM}Press Ctrl+C to stop${NC}"
    echo ""
    separator
}

# Print dry-run summary
dry_run_summary() {
    echo ""
    separator
    echo ""
    echo -e "${EMOJI_WARNING} ${BOLD}Dry run complete${NC} - no changes made"
    echo ""
    separator
}
