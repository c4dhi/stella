#!/bin/bash
# =============================================================================
# wizard.sh - Core wizard UI components for terminal configuration
# =============================================================================
# Professional terminal UI for configuration wizards
# Supports: text input, password, select, boolean, generated secrets
# Compatible with: macOS, Linux, Windows (Git Bash, WSL)
# =============================================================================

# Ensure colors are available
source "${LIB_DIR:-$(dirname "${BASH_SOURCE[0]}")}/colors.sh"

# =============================================================================
# Platform Detection
# =============================================================================

WIZARD_PLATFORM="unix"
WIZARD_INTERACTIVE=true

# Detect platform
case "$OSTYPE" in
    msys*|cygwin*|mingw*) WIZARD_PLATFORM="windows" ;;
    darwin*)              WIZARD_PLATFORM="macos" ;;
    linux*)               WIZARD_PLATFORM="linux" ;;
esac

# Check if we have a proper terminal
if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
    WIZARD_INTERACTIVE=false
fi

# =============================================================================
# Terminal Control
# =============================================================================

# Save and restore terminal settings
WIZARD_ORIG_STTY=""

wizard_init_terminal() {
    # Skip terminal manipulation if not interactive
    [[ "$WIZARD_INTERACTIVE" != "true" ]] && return 0

    # Save current terminal settings
    WIZARD_ORIG_STTY=$(stty -g 2>/dev/null || echo "")

    # Disable echo and line buffering for immediate key reading
    stty -echo -icanon 2>/dev/null || true
}

wizard_restore_terminal() {
    # Skip if not interactive
    [[ "$WIZARD_INTERACTIVE" != "true" ]] && return 0

    if [[ -n "$WIZARD_ORIG_STTY" ]]; then
        stty "$WIZARD_ORIG_STTY" 2>/dev/null || true
    else
        stty echo icanon 2>/dev/null || true
    fi
}

# Handle Ctrl+C gracefully
wizard_trap_handler() {
    wizard_restore_terminal
    echo ""
    echo ""
    echo -e "${YELLOW}Setup cancelled.${NC}"
    exit 130
}

# Set up traps
wizard_setup_traps() {
    trap wizard_trap_handler INT TERM
    trap wizard_restore_terminal EXIT
}

# =============================================================================
# Screen Control
# =============================================================================

# Clear screen and position cursor
wizard_clear_screen() {
    printf '\033[2J\033[H' >&2
}

# Move cursor to position
wizard_move_cursor() {
    local row="$1"
    local col="$2"
    printf '\033[%d;%dH' "$row" "$col" >&2
}

# Hide cursor
wizard_hide_cursor() {
    printf '\033[?25l' >&2
}

# Show cursor
wizard_show_cursor() {
    printf '\033[?25h' >&2
}

# Clear line from cursor
wizard_clear_line() {
    printf '\033[K' >&2
}

# =============================================================================
# Key Reading
# =============================================================================

# Read a single key (handles escape sequences for arrows)
# Also supports j/k for down/up (vim-style) as fallback
# Compatible with bash 3.2 (macOS) - no decimal timeouts
wizard_read_key() {
    local enable_vim_nav="${1:-true}"
    local key=""
    local seq=""

    # Read first character
    IFS= read -r -s -n1 key 2>/dev/null || true

    # If we got an escape character, try to read 2 more with timeout
    # Arrow keys send all 3 bytes together, ESC alone sends just \e
    if [[ "$key" == $'\e' ]]; then
        # Use 1 second timeout (bash 3.2 compatible)
        # Arrow keys: bytes available immediately, returns fast
        # ESC alone: times out after 1 second
        IFS= read -r -s -n2 -t 1 seq 2>/dev/null || true
        key="${key}${seq}"
    fi

    # Match the full sequence
    case "$key" in
        $'\e[A') echo "UP"; return ;;
        $'\e[B') echo "DOWN"; return ;;
        $'\e[C') echo "RIGHT"; return ;;
        $'\e[D') echo "LEFT"; return ;;
        # ESC alone (just \e, no following chars)
        $'\e')   echo "ESC"; return ;;
        $'\e'*)  echo "ESC"; return ;;
        # Enter key: empty string, carriage return, or newline
        ""|$'\n'|$'\r'|$'\x0a'|$'\x0d')
            echo "ENTER"; return ;;
        $'\x7f'|$'\x08') echo "BACKSPACE"; return ;;
        # Vim-style navigation (menu contexts only)
        j|J)
            if [[ "$enable_vim_nav" == "true" ]]; then
                echo "DOWN"; return
            else
                echo "$key"; return
            fi
            ;;
        k|K)
            if [[ "$enable_vim_nav" == "true" ]]; then
                echo "UP"; return
            else
                echo "$key"; return
            fi
            ;;
        # Pass through b/B for back handling by caller
        b|B)     echo "$key"; return ;;
        *)       echo "$key"; return ;;
    esac
}

# =============================================================================
# Section Header
# =============================================================================

# Display section header with icon and progress
# Usage: wizard_section_header "database" 1 6
wizard_section_header() {
    local category="$1"
    local current="$2"
    local total="$3"

    local icon
    icon=$(get_category_icon "$category")
    local name
    name=$(get_category_name "$category")
    local desc
    desc=$(get_category_description "$category")

    echo ""
    echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    local name_upper
    name_upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    echo -e "  ${icon}  ${BOLD}${name_upper}${NC}                              ${DIM}[${current}/${total}]${NC}"
    echo ""
    if [[ -n "$desc" ]]; then
        echo -e "  ${DIM}${desc}${NC}"
        echo ""
    fi
    echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# =============================================================================
# Progress Bar
# =============================================================================

# Display progress bar
# Usage: wizard_progress_bar 2 5 "Database" "Security" "LiveKit" "AI APIs" "Review"
wizard_progress_bar() {
    local current="$1"
    shift
    local sections=("$@")
    local total=${#sections[@]}

    # Calculate percentage
    local percent=$(( (current * 100) / total ))
    local filled=$(( (current * 40) / total ))
    local empty=$(( 40 - filled ))

    echo ""
    echo -e "  ${DIM}─── Setup Progress ──────────────────────────────────────────────${NC}"
    echo ""

    # Progress bar
    printf "  ["
    printf "${GREEN}"
    for ((i=0; i<filled; i++)); do printf "█"; done
    printf "${NC}${DIM}"
    for ((i=0; i<empty; i++)); do printf "░"; done
    printf "${NC}]  %3d%%  (%d/%d sections)\n" "$percent" "$current" "$total"
    echo ""

    # Section indicators
    printf "  "
    for ((i=0; i<total; i++)); do
        local section_name="${sections[$i]}"
        if ((i < current)); then
            printf "${GREEN}✓ %s${NC}    " "$section_name"
        elif ((i == current)); then
            printf "${CYAN}◐ %s${NC}    " "$section_name"
        else
            printf "${DIM}○ %s${NC}    " "$section_name"
        fi
    done
    echo ""
    echo ""
}

# =============================================================================
# Text Input
# =============================================================================

# Text input with editing support
# Usage: result=$(wizard_text_input "Variable Name" "Description" "current_value" "default_value")
# Note: All display output goes to stderr, only result goes to stdout
wizard_text_input() {
    local label="$1"
    local description="$2"
    local current="$3"
    local default="$4"

    # Determine the effective value to pre-fill
    local effective="${current:-$default}"
    local value="$effective"
    local has_value=false
    [[ -n "$effective" ]] && has_value=true

    echo -e "  ${BOLD}${label}${NC}" >&2
    if [[ -n "$description" ]]; then
        echo -e "  ${DIM}${description}${NC}" >&2
    fi
    echo "" >&2

    # Show preview of current/default value
    if [[ -n "$current" ]]; then
        echo -e "  ${DIM}Current:${NC} ${DIM}${current}${NC}" >&2
    elif [[ -n "$default" ]]; then
        echo -e "  ${DIM}Default:${NC} ${DIM}${default}${NC}" >&2
    fi

    echo "" >&2
    if [[ "$has_value" == "true" ]]; then
        echo -e "  ${DIM}[Enter] Keep  [Type] Edit  [Ctrl+C] Cancel${NC}" >&2
    else
        echo -e "  ${DIM}[Type] Enter value  [Ctrl+C] Cancel${NC}" >&2
    fi
    echo "" >&2

    # Input loop
    wizard_init_terminal
    wizard_show_cursor

    while true; do
        # Display input line with pre-filled value in dim if unchanged
        if [[ "$value" == "$effective" ]] && [[ -n "$value" ]]; then
            printf "\r  > ${DIM}%s${NC} " "$value" >&2
        else
            printf "\r  > %s " "$value" >&2
        fi
        wizard_clear_line >&2

        local key
        key=$(wizard_read_key "false")

        case "$key" in
            ENTER)
                wizard_restore_terminal
                echo "" >&2
                echo "$value"
                return 0
                ;;
            BACKSPACE)
                if [[ ${#value} -gt 0 ]]; then
                    value="${value%?}"
                fi
                ;;
            UP|DOWN|LEFT|RIGHT|ESC)
                # Ignore navigation keys in text input
                ;;
            *)
                # Printable character
                if [[ -n "$key" ]] && [[ "$key" != $'\x00' ]]; then
                    value="${value}${key}"
                fi
                ;;
        esac
    done
}

# =============================================================================
# Password Input (Masked)
# =============================================================================

# Password input with masking
# Usage: result=$(wizard_password_input "Password" "Description" "current_value")
# Note: All display output goes to stderr, only result goes to stdout
wizard_password_input() {
    local label="$1"
    local description="$2"
    local current="$3"

    local value=""
    local has_current=false
    local current_len=0
    if [[ -n "$current" ]]; then
        has_current=true
        current_len=${#current}
    fi

    echo -e "  ${BOLD}${label}${NC}" >&2
    if [[ -n "$description" ]]; then
        echo -e "  ${DIM}${description}${NC}" >&2
    fi
    echo "" >&2

    # Show preview of current value (masked)
    if [[ "$has_current" == "true" ]]; then
        local preview_mask=""
        for ((i=0; i<current_len && i<12; i++)); do
            preview_mask="${preview_mask}•"
        done
        [[ $current_len -gt 12 ]] && preview_mask="${preview_mask}..."
        echo -e "  ${DIM}Current:${NC} ${DIM}${preview_mask}${NC} ${DIM}(${current_len} chars)${NC}" >&2
        echo "" >&2
        echo -e "  ${DIM}[Enter] Keep  [Type] New value  [Ctrl+C] Cancel${NC}" >&2
    else
        echo -e "  ${DIM}Current:${NC} ${DIM}(not set)${NC}" >&2
        echo "" >&2
        echo -e "  ${DIM}[Type] Enter value  [Ctrl+C] Cancel${NC}" >&2
    fi
    echo "" >&2

    # Input loop
    wizard_init_terminal
    wizard_show_cursor

    while true; do
        # Clear line first, then print (prevents wrapping issues with long input)
        printf "\r\033[K" >&2
        if [[ -z "$value" ]] && [[ "$has_current" == "true" ]]; then
            printf "  > ${DIM}(keep current)${NC}" >&2
        else
            # Limit displayed dots to 20, show character count for longer values
            local len=${#value}
            if [[ $len -le 20 ]]; then
                local masked=""
                for ((i=0; i<len; i++)); do masked="${masked}•"; done
                printf "  > %s" "$masked" >&2
            else
                printf "  > ••••••••••••••••••••${DIM} (%d chars)${NC}" "$len" >&2
            fi
        fi

        local key
        key=$(wizard_read_key "false")

        case "$key" in
            ENTER)
                wizard_restore_terminal
                echo "" >&2
                if [[ -z "$value" ]] && [[ "$has_current" == "true" ]]; then
                    echo "$current"
                else
                    echo "$value"
                fi
                return 0
                ;;
            BACKSPACE)
                if [[ ${#value} -gt 0 ]]; then
                    value="${value%?}"
                fi
                ;;
            UP|DOWN|LEFT|RIGHT|ESC)
                ;;
            *)
                if [[ -n "$key" ]] && [[ "$key" != $'\x00' ]]; then
                    value="${value}${key}"
                fi
                ;;
        esac
    done
}

# =============================================================================
# Generated Secret Input
# =============================================================================

# Input for auto-generated secrets
# Usage: result=$(wizard_generated_input "JWT Secret" "Description" "current_value" "openssl rand -base64 48" "auto")
# Note: All display output goes to stderr, only result goes to stdout
wizard_generated_input() {
    local label="$1"
    local description="$2"
    local current="$3"
    local generator="$4"
    local auto_generate="${5:-}"  # "auto" to auto-generate if empty

    local value=""
    local has_current=false
    local current_len=0
    if [[ -n "$current" ]]; then
        has_current=true
        current_len=${#current}
    fi

    echo -e "  ${BOLD}${label}${NC}" >&2
    if [[ -n "$description" ]]; then
        echo -e "  ${DIM}${description}${NC}" >&2
    fi
    echo "" >&2
    echo -e "  ${YELLOW}⚡${NC} Press ${BOLD}[G]${NC} to auto-generate a secure value" >&2
    echo "" >&2

    # Show preview of current value (truncated)
    if [[ "$has_current" == "true" ]]; then
        local display_current="${current:0:24}"
        [[ $current_len -gt 24 ]] && display_current="${display_current}..."
        echo -e "  ${DIM}Current:${NC} ${DIM}${display_current}${NC} ${DIM}(${current_len} chars)${NC}" >&2
    else
        echo -e "  ${DIM}Current:${NC} ${DIM}(not set)${NC}" >&2
    fi
    echo "" >&2
    if [[ "$has_current" == "true" ]]; then
        echo -e "  ${DIM}[Enter] Keep  [G] Generate new  [Ctrl+C] Cancel${NC}" >&2
    elif [[ "$auto_generate" == "auto" ]]; then
        echo -e "  ${DIM}[Enter] Auto-generate  [G] Generate  [Ctrl+C] Cancel${NC}" >&2
    else
        echo -e "  ${DIM}[G] Generate  [Enter] Accept  [Ctrl+C] Cancel${NC}" >&2
    fi
    echo "" >&2

    # Input loop
    wizard_init_terminal
    wizard_show_cursor

    while true; do
        # Display input or placeholder
        if [[ -z "$value" ]] && [[ "$has_current" == "true" ]]; then
            printf "\r  > ${DIM}(keep current)${NC} " >&2
        elif [[ -z "$value" ]] && [[ "$auto_generate" == "auto" ]]; then
            printf "\r  > ${DIM}(will auto-generate)${NC} " >&2
        else
            local display_value="$value"
            if [[ ${#display_value} -gt 50 ]]; then
                display_value="${display_value:0:47}..."
            fi
            printf "\r  > %s " "$display_value" >&2
        fi
        wizard_clear_line >&2

        local key
        key=$(wizard_read_key "false")

        case "$key" in
            ENTER)
                wizard_restore_terminal
                echo "" >&2
                if [[ -z "$value" ]] && [[ "$has_current" == "true" ]]; then
                    echo "$current"
                elif [[ -z "$value" ]] && [[ "$auto_generate" == "auto" ]]; then
                    local generated
                    generated=$(eval "$generator" 2>/dev/null || echo "")
                    if [[ -z "$generated" ]]; then
                        generated=$(openssl rand -base64 48 2>/dev/null || head -c 48 /dev/urandom | base64)
                    fi
                    echo "$generated"
                else
                    echo "$value"
                fi
                return 0
                ;;
            g|G)
                value=$(eval "$generator" 2>/dev/null || echo "")
                if [[ -z "$value" ]]; then
                    value=$(openssl rand -base64 48 2>/dev/null || head -c 48 /dev/urandom | base64)
                fi
                ;;
            BACKSPACE)
                if [[ ${#value} -gt 0 ]]; then
                    value="${value%?}"
                fi
                ;;
            UP|DOWN|LEFT|RIGHT|ESC)
                ;;
            *)
                if [[ -n "$key" ]] && [[ "$key" != $'\x00' ]] && [[ "$key" != "g" ]] && [[ "$key" != "G" ]]; then
                    value="${value}${key}"
                fi
                ;;
        esac
    done
}

# =============================================================================
# Boolean Toggle
# =============================================================================

# Boolean toggle selection
# Usage: result=$(wizard_boolean_input "Enable GPU" "Description" "current_value")
# Note: All display output goes to stderr, only result goes to stdout
wizard_boolean_input() {
    local label="$1"
    local description="$2"
    local current="${3:-false}"

    local selected=1
    [[ "$current" == "true" ]] && selected=0

    echo -e "  ${BOLD}${label}${NC}" >&2
    if [[ -n "$description" ]]; then
        echo -e "  ${DIM}${description}${NC}" >&2
    fi
    echo "" >&2
    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm${NC}" >&2
    echo "" >&2

    # Input loop
    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        # Display options
        if [[ $selected -eq 0 ]]; then
            printf "\r  ❯ ${GREEN}[●] true${NC}     " >&2
            printf "\n    ${DIM}[ ] false${NC}    " >&2
        else
            printf "\r    ${DIM}[ ] true${NC}     " >&2
            printf "\n  ❯ ${GREEN}[●] false${NC}   " >&2
        fi

        # Move back up
        printf '\033[1A\r' >&2

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                wizard_show_cursor
                echo "" >&2
                echo "" >&2
                if [[ $selected -eq 0 ]]; then
                    echo "true"
                else
                    echo "false"
                fi
                return 0
                ;;
            UP|DOWN|j|J|k|K)
                selected=$(( 1 - selected ))
                ;;
        esac
    done
}

# =============================================================================
# Select from Options
# =============================================================================

# Select from list of options
# Usage: result=$(wizard_select_input "Provider" "Description" "current" "option1,option2,option3")
# Note: All display output goes to stderr, only result goes to stdout
wizard_select_input() {
    local label="$1"
    local description="$2"
    local current="$3"
    local options_str="$4"
    local var_name="${5:-}"  # Optional: for looking up option descriptions

    # Parse options
    IFS=',' read -ra options <<< "$options_str"
    local num_options=${#options[@]}

    # Find current selection index
    local selected=0
    for ((i=0; i<num_options; i++)); do
        if [[ "${options[$i]}" == "$current" ]]; then
            selected=$i
            break
        fi
    done

    echo -e "  ${BOLD}${label}${NC}" >&2
    if [[ -n "$description" ]]; then
        echo -e "  ${DIM}${description}${NC}" >&2
    fi
    echo "" >&2
    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm${NC}" >&2
    echo "" >&2

    # Print placeholder lines for options
    for ((i=0; i<num_options; i++)); do
        echo "" >&2
    done

    # Input loop
    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        # Move cursor back to start of options
        for ((i=0; i<num_options; i++)); do
            printf '\033[1A' >&2
        done

        # Display options
        for ((i=0; i<num_options; i++)); do
            local opt="${options[$i]}"
            local opt_desc=""
            if [[ -n "$var_name" ]]; then
                opt_desc=$(get_option_description "$var_name" "$opt")
            fi

            printf "\r" >&2
            if [[ $i -eq $selected ]]; then
                printf "  ❯ ${GREEN}[●] ${opt}${NC}" >&2
                if [[ -n "$opt_desc" ]]; then
                    printf " ${DIM}- ${opt_desc}${NC}" >&2
                fi
            else
                printf "    ${DIM}[ ] ${opt}${NC}" >&2
                if [[ -n "$opt_desc" ]]; then
                    printf " ${DIM}- ${opt_desc}${NC}" >&2
                fi
            fi
            wizard_clear_line >&2
            echo "" >&2
        done

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                wizard_show_cursor
                echo "" >&2
                echo "${options[$selected]}"
                return 0
                ;;
            UP|k|K)
                selected=$(( (selected - 1 + num_options) % num_options ))
                ;;
            DOWN|j|J)
                selected=$(( (selected + 1) % num_options ))
                ;;
        esac
    done
}

# =============================================================================
# Confirmation Dialog
# =============================================================================

# Yes/No confirmation
# Usage: if wizard_confirm "Run setup now?"; then ...
wizard_confirm() {
    local question="$1"
    local default="${2:-n}"  # Default to no

    local selected=1
    [[ "$default" == "y" ]] && selected=0

    echo "" >&2
    echo -e "  ${BOLD}${question}${NC}" >&2
    echo "" >&2

    wizard_init_terminal

    while true; do
        # Display options
        if [[ $selected -eq 0 ]]; then
            printf "\r  [${GREEN}Y${NC}/n] " >&2
        else
            printf "\r  [y/${GREEN}N${NC}] " >&2
        fi

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                echo "" >&2
                return $selected
                ;;
            y|Y)
                wizard_restore_terminal
                echo "" >&2
                return 0
                ;;
            n|N)
                wizard_restore_terminal
                echo "" >&2
                return 1
                ;;
            UP|DOWN|LEFT|RIGHT|j|J|k|K)
                selected=$(( 1 - selected ))
                ;;
        esac
    done
}

# =============================================================================
# Welcome Screen
# =============================================================================

# Display welcome screen with environment selection
# Global variable to store welcome screen selection
WIZARD_SELECTED_ENV=""

# Usage: wizard_welcome_screen; env="$WIZARD_SELECTED_ENV"
# Note: Sets WIZARD_SELECTED_ENV global variable instead of returning via echo
#       This avoids subshell issues with terminal manipulation
wizard_welcome_screen() {
    wizard_clear_screen

    echo ""
    echo -e "  ${EMOJI_ROCKET} ${BOLD}Welcome to STELLA Setup${NC}"
    echo ""
    echo -e "  ${DIM}This wizard will guide you through the configuration.${NC}"
    echo ""
    echo ""
    echo -e "  ${BOLD}What environment would you like to configure?${NC}"
    echo ""
    echo -e "  ${DIM}[↑↓ or j/k] Select  [Enter] Confirm  [Ctrl+C] Cancel${NC}"
    echo ""
    echo ""
    echo ""

    local options=("local" "production")
    local descriptions=("Local development setup" "Production deployment")
    local selected=0

    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        # Move cursor back
        printf '\033[2A'

        # Display options
        for ((i=0; i<2; i++)); do
            printf "\r"
            if [[ $i -eq $selected ]]; then
                printf "  ❯ ${GREEN}[●] ${options[$i]^}${NC} - ${descriptions[$i]}"
            else
                printf "    ${DIM}[ ] ${options[$i]^}${NC} - ${DIM}${descriptions[$i]}${NC}"
            fi
            wizard_clear_line
            echo ""
        done

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                wizard_show_cursor
                WIZARD_SELECTED_ENV="${options[$selected]}"
                return 0
                ;;
            UP|DOWN)
                selected=$(( 1 - selected ))
                ;;
        esac
    done
}

# =============================================================================
# Review Screen
# =============================================================================

# Display configuration review
# Usage: wizard_review_screen "VAR1=val1" "VAR2=val2" ...
wizard_review_screen() {
    local config_lines=("$@")

    wizard_clear_screen

    echo ""
    echo -e "  ${BOLD}📋 Configuration Review${NC}"
    echo ""
    echo -e "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    for line in "${config_lines[@]}"; do
        local var_name="${line%%=*}"
        local var_value="${line#*=}"

        # Mask secrets in the review so generated/entered credentials aren't
        # printed in the clear. Covers password/generated typed vars plus the
        # admin password and anything that looks like a secret by name.
        local vtype
        vtype=$(get_var_meta "$var_name" "type" 2>/dev/null || true)
        if [[ -n "$var_value" ]] && { [[ "$vtype" == "password" ]] || [[ "$vtype" == "generated" ]] || [[ "$var_name" == *PASSWORD* ]] || [[ "$var_name" == *SECRET* ]] || [[ "$var_name" == *TOKEN* ]]; }; then
            var_value="••••••••"
        fi

        printf "  %-30s = %s\n" "$var_name" "$var_value"
    done

    echo ""
    echo -e "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# =============================================================================
# Success Screen
# =============================================================================

# Display setup complete screen
wizard_success_screen() {
    local env_file="$1"
    local mode="$2"

    local start_cmd="./scripts/start-k8s.sh -d"
    [[ "$mode" == "production" ]] && start_cmd="./scripts/start-k8s.sh --production -d"

    echo ""
    echo -e "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  ${GREEN}✓${NC} ${BOLD}Setup Complete!${NC}"
    echo ""
    echo -e "  Configuration saved to: ${CYAN}${env_file}${NC}"
    echo -e "  Mode: ${BOLD}${mode}${NC}"
    echo ""
    echo -e "  ${DIM}You can now start STELLA with:${NC}"
    echo ""
    echo -e "    ${CYAN}${start_cmd}${NC}"
    echo ""
    echo -e "  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# =============================================================================
# Variable Input Router
# =============================================================================

# Route to appropriate input based on variable type
# Usage: value=$(wizard_var_input "VAR_NAME" "current_value" "local|production")
wizard_var_input() {
    local var_name="$1"
    local current="$2"
    local env="$3"

    local type
    type=$(get_var_meta "$var_name" "type")
    local description
    description=$(get_var_meta "$var_name" "description")
    local default
    default=$(get_var_default "$var_name" "$env")
    local options
    options=$(get_var_meta "$var_name" "options")
    local generator
    generator=$(get_var_meta "$var_name" "generator")
    local required
    required=$(get_var_meta "$var_name" "required")

    case "$type" in
        text)
            wizard_text_input "$var_name" "$description" "$current" "$default"
            ;;
        password)
            wizard_password_input "$var_name" "$description" "$current"
            ;;
        generated)
            # Auto-generate if required and no current value
            local auto_gen=""
            if [[ "$required" == "both" ]] || [[ "$required" == "production" && "$env" == "production" ]]; then
                auto_gen="auto"
            fi
            wizard_generated_input "$var_name" "$description" "$current" "$generator" "$auto_gen"
            ;;
        boolean)
            wizard_boolean_input "$var_name" "$description" "${current:-$default}"
            ;;
        select)
            wizard_select_input "$var_name" "$description" "${current:-$default}" "$options" "$var_name"
            ;;
        *)
            # Default to text
            wizard_text_input "$var_name" "$description" "$current" "$default"
            ;;
    esac
}

# =============================================================================
# Compact Variable Input (with Back option)
# =============================================================================

# Compact input with progress and back navigation
# Returns "__BACK__" if user selects back
wizard_var_input_compact() {
    local var_name="$1"
    local current="$2"
    local env="$3"
    local var_idx="$4"
    local total_vars="$5"

    local type description default options generator required
    type=$(get_var_meta "$var_name" "type")
    description=$(get_var_meta "$var_name" "description")
    default=$(get_var_default "$var_name" "$env")
    options=$(get_var_meta "$var_name" "options")
    generator=$(get_var_meta "$var_name" "generator")
    required=$(get_var_meta "$var_name" "required")

    # For generatable secrets, ignore the cross-environment default fallback so
    # production never silently inherits the local dev credentials (e.g.
    # devkey/devsecret). Use only the environment's own default — when it's
    # empty, the input offers to auto-generate a fresh value instead.
    if [[ -n "$generator" ]]; then
        if [[ "$env" == "production" ]]; then
            default=$(get_var_meta "$var_name" "default_prod")
        else
            default=$(get_var_meta "$var_name" "default_local")
        fi
    fi

    local effective="${current:-$default}"

    # Compact header
    echo -e "  ${BOLD}${var_name}${NC} ${DIM}(${var_idx}/${total_vars})${NC}" >&2
    [[ -n "$description" ]] && echo -e "  ${DIM}${description}${NC}" >&2

    # Extended, multi-line guidance for variables that need it (e.g. why
    # LIVEKIT_URL must be a routable IP, not localhost).
    local help_line
    while IFS= read -r help_line; do
        [[ -n "$help_line" ]] && echo -e "  ${DIM}${help_line}${NC}" >&2
    done < <(get_var_help "$var_name")
    echo "" >&2

    case "$type" in
        boolean)
            wizard_boolean_compact "$var_name" "$effective"
            ;;
        select)
            wizard_select_compact "$var_name" "$effective" "$options"
            ;;
        generated)
            local auto_gen=""
            [[ "$required" == "both" ]] || [[ "$required" == "production" && "$env" == "production" ]] && auto_gen="auto"
            wizard_generated_compact "$var_name" "$current" "$generator" "$auto_gen"
            ;;
        password)
            # When a generator is defined for a required secret, [Enter] on an
            # empty field auto-creates a secure value (no override, nothing saved).
            local auto_gen=""
            if [[ -n "$generator" ]] && { [[ "$required" == "both" ]] || { [[ "$required" == "production" ]] && [[ "$env" == "production" ]]; }; }; then
                auto_gen="auto"
            fi
            wizard_password_compact "$var_name" "$current" "$default" "$generator" "$auto_gen"
            ;;
        *)
            local auto_gen=""
            if [[ -n "$generator" ]] && { [[ "$required" == "both" ]] || { [[ "$required" == "production" ]] && [[ "$env" == "production" ]]; }; }; then
                auto_gen="auto"
            fi
            wizard_text_compact "$var_name" "$effective" "$generator" "$auto_gen"
            ;;
    esac
}

# =============================================================================
# Guided LIVEKIT_URL input
# =============================================================================
# LIVEKIT_URL is the address STELLA's Kubernetes pods use to reach the LiveKit
# server. Pods can't use localhost (that resolves to the pod itself), so on a
# single-machine deployment the operator must supply the host's LAN IP — a
# common pitfall. This guided step explains that and asks whether LiveKit runs
# on the same machine, auto-detecting the host IP for the "same machine" case.
#
# Usage: value=$(wizard_livekit_url_guided "$current" "$env")
# Echoes the chosen URL on stdout (UI on stderr); "__BACK__" for back-nav.
wizard_livekit_url_guided() {
    local current="$1"
    local env="${2:-}"
    local port="7880"

    # Detect this host's LAN IP to suggest for the same-machine case.
    local detected_ip=""
    if command -v get_local_ip >/dev/null 2>&1; then
        detected_ip=$(get_local_ip 2>/dev/null || true)
    fi
    [[ -z "$detected_ip" ]] && detected_ip="127.0.0.1"

    echo -e "  ${BOLD}LIVEKIT_URL${NC} ${DIM}(internal — pods → LiveKit)${NC}" >&2
    echo -e "  ${DIM}STELLA runs inside Kubernetes. Its pods cannot reach LiveKit via${NC}" >&2
    echo -e "  ${DIM}'localhost' — that points at the pod itself. They need a routable${NC}" >&2
    echo -e "  ${DIM}address. Where will the LiveKit server run?${NC}" >&2
    echo "" >&2

    # Build a dynamic option menu — include "keep current" only when a value
    # already exists (e.g. loaded from an existing .env).
    local -a options=()
    local -a values=()
    if [[ -n "$current" ]]; then
        options+=("Keep current: ${current}")
        values+=("$current")
    fi
    options+=("Same machine as STELLA  (use this host's LAN IP: ${detected_ip})")
    values+=("__SAME__")
    options+=("Different machine / enter manually")
    values+=("__MANUAL__")

    local num_options=${#options[@]}
    local selected=0

    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm  [Esc] Back${NC}" >&2
    echo "" >&2
    for ((i=0; i<num_options; i++)); do echo "" >&2; done

    wizard_init_terminal
    wizard_hide_cursor

    local choice=""
    while true; do
        for ((i=0; i<num_options; i++)); do printf '\033[1A' >&2; done
        for ((i=0; i<num_options; i++)); do
            printf "\r" >&2
            if [[ $i -eq $selected ]]; then
                printf "  ❯ ${GREEN}[●] ${options[$i]}${NC}" >&2
            else
                printf "    ${DIM}[ ] ${options[$i]}${NC}" >&2
            fi
            wizard_clear_line >&2
            echo "" >&2
        done

        local key
        key=$(wizard_read_key)
        case "$key" in
            ENTER)
                choice="${values[$selected]}"
                break
                ;;
            ESC)
                wizard_restore_terminal
                wizard_show_cursor
                echo "" >&2
                echo "__BACK__"
                return 0
                ;;
            UP|k|K)   selected=$(( (selected - 1 + num_options) % num_options )) ;;
            DOWN|j|J) selected=$(( (selected + 1) % num_options )) ;;
        esac
    done

    wizard_restore_terminal
    wizard_show_cursor
    echo "" >&2

    case "$choice" in
        __SAME__)
            echo -e "  ${DIM}Suggested: ws://${detected_ip}:${port} — press [Enter] to accept,${NC}" >&2
            echo -e "  ${DIM}or edit if the detected IP is wrong.${NC}" >&2
            echo "" >&2
            wizard_text_input "LIVEKIT_URL" "Internal URL the pods connect to" "" "ws://${detected_ip}:${port}"
            ;;
        __MANUAL__)
            echo -e "  ${DIM}Enter the LiveKit server's address, e.g. ws://livekit-host:${port}${NC}" >&2
            echo -e "  ${DIM}(use its IP or a DNS name the pods can resolve — not localhost).${NC}" >&2
            echo "" >&2
            wizard_text_input "LIVEKIT_URL" "Internal URL the pods connect to" "$current" ""
            ;;
        *)
            # Keep current value.
            echo "$choice"
            ;;
    esac
}

# Compact text input
# Optional generator/auto_gen: when the field has no value and no default and
# a generator is available, [Enter] creates a secure value instead of leaving
# the field empty (used for keys like LIVEKIT_API_KEY in production).
wizard_text_compact() {
    local var_name="$1"
    local effective="$2"
    local generator="${3:-}"
    local auto_gen="${4:-}"

    local value="$effective"
    local can_generate=false
    if [[ -z "$effective" ]] && [[ -n "$generator" ]] && [[ "$auto_gen" == "auto" ]]; then
        can_generate=true
    fi

    if [[ -n "$effective" ]]; then
        echo -e "  ${DIM}Current:${NC} ${effective}" >&2
        echo -e "  ${DIM}[Enter] Keep  [Type] Edit  [Ctrl+C] Cancel${NC}" >&2
    elif [[ "$can_generate" == "true" ]]; then
        echo -e "  ${YELLOW}⚡${NC} ${DIM}Leave blank and press [Enter] to auto-generate a secure value.${NC}" >&2
        echo -e "  ${DIM}[Enter] Leave blank → auto-generate  [Type] Set manually  [Ctrl+C] Cancel${NC}" >&2
    else
        echo -e "  ${DIM}[Type] Enter value  [Ctrl+C] Cancel${NC}" >&2
    fi
    echo "" >&2

    wizard_init_terminal
    wizard_show_cursor

    while true; do
        if [[ -z "$value" ]] && [[ "$can_generate" == "true" ]]; then
            printf "\r  > ${DIM}(blank → auto-generate)${NC} " >&2
        elif [[ "$value" == "$effective" ]] && [[ -n "$value" ]]; then
            printf "\r  > ${DIM}%s${NC} " "$value" >&2
        else
            printf "\r  > %s " "$value" >&2
        fi
        wizard_clear_line >&2

        local key
        key=$(wizard_read_key "false")

        case "$key" in
            ENTER)
                wizard_restore_terminal
                echo "" >&2
                if [[ -z "$value" ]] && [[ "$can_generate" == "true" ]]; then
                    eval "$generator" 2>/dev/null || openssl rand -hex 16
                else
                    echo "$value"
                fi
                return 0
                ;;
            ESC)
                wizard_restore_terminal
                echo "" >&2
                echo "__BACK__"
                return 0
                ;;
            BACKSPACE)
                [[ ${#value} -gt 0 ]] && value="${value%?}"
                ;;
            UP|DOWN|LEFT|RIGHT) ;;
            *)
                [[ -n "$key" ]] && [[ "$key" != $'\x00' ]] && value="${value}${key}"
                ;;
        esac
    done
}

# Compact password input
# Optional default/generator/auto_gen resolve what [Enter] does on an empty
# field, in priority order:
#   1. a previously saved value (current) is kept
#   2. otherwise a known default is used (e.g. local LiveKit devsecret)
#   3. otherwise, if a generator is available, a secure value is created
#   4. otherwise the field stays empty (caller enforces required-not-empty)
# A value the operator actually types always wins.
wizard_password_compact() {
    local var_name="$1"
    local current="$2"
    local default="${3:-}"
    local generator="${4:-}"
    local auto_gen="${5:-}"

    local value=""
    local has_current=false
    [[ -n "$current" ]] && has_current=true
    local can_generate=false
    if [[ -n "$generator" ]] && [[ "$auto_gen" == "auto" ]]; then
        can_generate=true
    fi

    if [[ "$has_current" == "true" ]]; then
        echo -e "  ${DIM}Current:${NC} ••••••••" >&2
        echo -e "  ${DIM}[Enter] Keep  [Type] New  [Ctrl+C] Cancel${NC}" >&2
    elif [[ -n "$default" ]]; then
        echo -e "  ${DIM}Default:${NC} ${default}" >&2
        echo -e "  ${DIM}[Enter] Use default  [Type] New  [Ctrl+C] Cancel${NC}" >&2
    elif [[ "$can_generate" == "true" ]]; then
        echo -e "  ${YELLOW}⚡${NC} ${DIM}Leave blank and press [Enter] to auto-generate a secure value.${NC}" >&2
        echo -e "  ${DIM}[Enter] Leave blank → auto-generate  [Type] Set manually  [Ctrl+C] Cancel${NC}" >&2
    else
        echo -e "  ${DIM}[Type] Enter value  [Ctrl+C] Cancel${NC}" >&2
    fi
    echo "" >&2

    wizard_init_terminal
    wizard_show_cursor

    while true; do
        # Clear line first, then print (prevents wrapping issues with long input)
        printf "\r\033[K" >&2
        if [[ -z "$value" ]]; then
            if [[ "$has_current" == "true" ]]; then
                printf "  > ${DIM}(keep current)${NC}" >&2
            elif [[ -n "$default" ]]; then
                printf "  > ${DIM}(use default)${NC}" >&2
            elif [[ "$can_generate" == "true" ]]; then
                printf "  > ${DIM}(blank → auto-generate)${NC}" >&2
            else
                printf "  > " >&2
            fi
        else
            # Limit displayed dots to 20, show character count for longer values
            local len=${#value}
            if [[ $len -le 20 ]]; then
                local masked=""
                for ((i=0; i<len; i++)); do masked="${masked}•"; done
                printf "  > %s" "$masked" >&2
            else
                printf "  > ••••••••••••••••••••${DIM} (%d chars)${NC}" "$len" >&2
            fi
        fi

        local key
        key=$(wizard_read_key "false")

        case "$key" in
            ENTER)
                wizard_restore_terminal
                echo "" >&2
                if [[ -n "$value" ]]; then
                    echo "$value"
                elif [[ "$has_current" == "true" ]]; then
                    echo "$current"
                elif [[ -n "$default" ]]; then
                    echo "$default"
                elif [[ "$can_generate" == "true" ]]; then
                    eval "$generator" 2>/dev/null || openssl rand -base64 24
                else
                    echo ""
                fi
                return 0
                ;;
            ESC)
                wizard_restore_terminal
                echo "" >&2
                echo "__BACK__"
                return 0
                ;;
            BACKSPACE)
                [[ ${#value} -gt 0 ]] && value="${value%?}"
                ;;
            UP|DOWN|LEFT|RIGHT) ;;
            *)
                [[ -n "$key" ]] && [[ "$key" != $'\x00' ]] && value="${value}${key}"
                ;;
        esac
    done
}

# Compact generated input
wizard_generated_compact() {
    local var_name="$1"
    local current="$2"
    local generator="$3"
    local auto_gen="$4"

    local value=""
    local has_current=false
    [[ -n "$current" ]] && has_current=true

    if [[ "$has_current" == "true" ]]; then
        echo -e "  ${DIM}Current:${NC} ${current:0:20}..." >&2
        echo -e "  ${DIM}[Enter] Keep  [G] Generate new  [Ctrl+C] Cancel${NC}" >&2
    elif [[ "$auto_gen" == "auto" ]]; then
        echo -e "  ${YELLOW}⚡${NC} ${DIM}Leave blank and press [Enter] to auto-generate a secure value.${NC}" >&2
        echo -e "  ${DIM}[Enter] Leave blank → auto-generate  [G] Generate now  [Ctrl+C] Cancel${NC}" >&2
    else
        echo -e "  ${DIM}[G] Generate  [Enter] Accept  [Ctrl+C] Cancel${NC}" >&2
    fi
    echo "" >&2

    wizard_init_terminal
    wizard_show_cursor

    while true; do
        if [[ -z "$value" ]] && [[ "$has_current" == "true" ]]; then
            printf "\r  > ${DIM}(keep current)${NC} " >&2
        elif [[ -z "$value" ]] && [[ "$auto_gen" == "auto" ]]; then
            printf "\r  > ${DIM}(blank → auto-generate)${NC} " >&2
        else
            printf "\r  > %.40s " "$value" >&2
        fi
        wizard_clear_line >&2

        local key
        key=$(wizard_read_key "false")

        case "$key" in
            ENTER)
                wizard_restore_terminal
                echo "" >&2
                if [[ -z "$value" ]] && [[ "$has_current" == "true" ]]; then
                    echo "$current"
                elif [[ -z "$value" ]] && [[ "$auto_gen" == "auto" ]]; then
                    eval "$generator" 2>/dev/null || openssl rand -base64 48
                else
                    echo "$value"
                fi
                return 0
                ;;
            ESC)
                wizard_restore_terminal
                echo "" >&2
                echo "__BACK__"
                return 0
                ;;
            g|G)
                value=$(eval "$generator" 2>/dev/null || openssl rand -base64 48)
                ;;
            BACKSPACE)
                [[ ${#value} -gt 0 ]] && value="${value%?}"
                ;;
            UP|DOWN|LEFT|RIGHT) ;;
            *)
                [[ -n "$key" ]] && [[ "$key" != $'\x00' ]] && [[ "$key" != "g" ]] && [[ "$key" != "G" ]] && value="${value}${key}"
                ;;
        esac
    done
}

# Compact boolean input
wizard_boolean_compact() {
    local var_name="$1"
    local current="${2:-false}"

    local selected=1
    [[ "$current" == "true" ]] && selected=0

    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm  [b] Back${NC}" >&2
    echo "" >&2
    echo "" >&2

    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        printf '\033[2A' >&2
        if [[ $selected -eq 0 ]]; then
            printf "\r  ❯ ${GREEN}true${NC}   " >&2
            printf "\n    ${DIM}false${NC}  " >&2
        else
            printf "\r    ${DIM}true${NC}   " >&2
            printf "\n  ❯ ${GREEN}false${NC}  " >&2
        fi
        echo "" >&2

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                wizard_show_cursor
                [[ $selected -eq 0 ]] && echo "true" || echo "false"
                return 0
                ;;
            ESC|b|B)
                wizard_restore_terminal
                wizard_show_cursor
                echo "__BACK__"
                return 0
                ;;
            UP|DOWN|j|J|k|K)
                selected=$(( 1 - selected ))
                ;;
        esac
    done
}

# Compact select input
wizard_select_compact() {
    local var_name="$1"
    local current="$2"
    local options_str="$3"

    IFS=',' read -ra options <<< "$options_str"
    local num_options=${#options[@]}

    local selected=0
    for ((i=0; i<num_options; i++)); do
        [[ "${options[$i]}" == "$current" ]] && selected=$i && break
    done

    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm  [b] Back${NC}" >&2
    echo "" >&2
    for ((i=0; i<num_options; i++)); do echo "" >&2; done

    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        for ((i=0; i<num_options; i++)); do printf '\033[1A' >&2; done

        for ((i=0; i<num_options; i++)); do
            local opt="${options[$i]}"
            local opt_desc=""
            [[ -n "$var_name" ]] && opt_desc=$(get_option_description "$var_name" "$opt")

            printf "\r" >&2
            if [[ $i -eq $selected ]]; then
                printf "  ❯ ${GREEN}${opt}${NC}" >&2
                [[ -n "$opt_desc" ]] && printf " ${DIM}- ${opt_desc}${NC}" >&2
            else
                printf "    ${DIM}${opt}${NC}" >&2
            fi
            wizard_clear_line >&2
            echo "" >&2
        done

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                wizard_show_cursor
                echo "${options[$selected]}"
                return 0
                ;;
            ESC|b|B)
                wizard_restore_terminal
                wizard_show_cursor
                echo "__BACK__"
                return 0
                ;;
            UP|k|K)
                selected=$(( (selected - 1 + num_options) % num_options ))
                ;;
            DOWN|j|J)
                selected=$(( (selected + 1) % num_options ))
                ;;
        esac
    done
}
