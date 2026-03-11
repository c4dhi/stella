#!/bin/bash
# =============================================================================
# setup_wizard.sh - Onboarding setup wizard for STELLA
# =============================================================================
# Guides users through initial configuration with required variables first,
# then optional configuration.
# Compatible with bash 3.2+ (macOS default)
# =============================================================================

# Source dependencies
SETUP_LIB_DIR="${LIB_DIR:-$(dirname "${BASH_SOURCE[0]}")}"
source "$SETUP_LIB_DIR/colors.sh"
source "$SETUP_LIB_DIR/variables.sh"
source "$SETUP_LIB_DIR/wizard.sh"

# =============================================================================
# Configuration Storage (bash 3.2 compatible - uses temp file)
# =============================================================================

# Temp file for storing configuration key=value pairs
WIZARD_CONFIG_FILE=""

# Initialize config storage
init_wizard_config() {
    WIZARD_CONFIG_FILE=$(mktemp)
    # Clean up on exit
    trap "rm -f '$WIZARD_CONFIG_FILE' 2>/dev/null" EXIT
}

# Get a config value
get_wizard_config() {
    local key="$1"
    if [[ -f "$WIZARD_CONFIG_FILE" ]]; then
        # Missing keys are expected for optional vars; do not fail under pipefail.
        grep "^${key}=" "$WIZARD_CONFIG_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- || true
    fi
}

# Set a config value
set_wizard_config() {
    local key="$1"
    local value="$2"
    if [[ -f "$WIZARD_CONFIG_FILE" ]]; then
        # Remove existing key if present
        grep -v "^${key}=" "$WIZARD_CONFIG_FILE" > "${WIZARD_CONFIG_FILE}.tmp" 2>/dev/null || true
        mv "${WIZARD_CONFIG_FILE}.tmp" "$WIZARD_CONFIG_FILE"
        # Add new value
        echo "${key}=${value}" >> "$WIZARD_CONFIG_FILE"
    fi
}

# Get all config keys
get_wizard_config_keys() {
    if [[ -f "$WIZARD_CONFIG_FILE" ]]; then
        cut -d'=' -f1 "$WIZARD_CONFIG_FILE" 2>/dev/null | sort -u
    fi
}

# Check if config has a value
has_wizard_config() {
    local key="$1"
    local value
    value=$(get_wizard_config "$key")
    [[ -n "$value" ]]
}

# =============================================================================
# Required Variables by Category (Setup Order)
# =============================================================================

# Categories to show in setup wizard (only crucial sections)
# Local: minimal setup to get running
# Production: adds security keys and domain
declare -a SETUP_CATEGORIES_LOCAL=(
    "credentials"
)

declare -a SETUP_CATEGORIES_PRODUCTION=(
    "credentials"
    "production"
)

# CRUCIAL variables only - everything else uses defaults
# These are variables the system CANNOT work without
get_setup_vars() {
    local category="$1"
    local env="$2"

    case "$category" in
        credentials)
            # Absolutely essential - no defaults possible
            # ENV_VAR_ENCRYPTION_KEY included in both for consistent encryption
            if [[ "$env" == "production" ]]; then
                echo "POSTGRES_PASSWORD JWT_SECRET ENV_VAR_ENCRYPTION_KEY LIVEKIT_API_KEY LIVEKIT_API_SECRET OPENAI_API_KEY"
            else
                # Local: Include encryption key for safety, LIVEKIT uses defaults
                echo "POSTGRES_PASSWORD JWT_SECRET ENV_VAR_ENCRYPTION_KEY OPENAI_API_KEY"
            fi
            ;;
        production)
            # Production-specific requirements
            echo "PRODUCTION_DOMAIN LIVEKIT_URL PUBLIC_LIVEKIT_URL"
            ;;
    esac
}

# =============================================================================
# Global for section menu result
# =============================================================================
SETUP_MENU_RESULT=""

# =============================================================================
# Main Setup Flow
# =============================================================================

run_setup_wizard() {
    local env="${1:-}"
    local project_dir="$PROJECT_DIR"

    # Initialize config storage
    init_wizard_config

    wizard_setup_traps

    # If environment not specified, show welcome screen
    if [[ -z "$env" ]]; then
        wizard_welcome_screen
        env="$WIZARD_SELECTED_ENV"
    fi

    local env_file
    env_file=$(get_environment_file "$project_dir" "$env")

    # Load existing config for the selected environment
    if [[ -f "$env_file" ]]; then
        load_existing_config "$env_file"
    fi

    # Select categories based on environment
    local -a categories
    if [[ "$env" == "production" ]]; then
        categories=("${SETUP_CATEGORIES_PRODUCTION[@]}")
    else
        categories=("${SETUP_CATEGORIES_LOCAL[@]}")
    fi

    local current_section=0
    local -a section_history=()

    # Walk through required sections with navigation
    while [[ $current_section -lt ${#categories[@]} ]]; do
        local category="${categories[$current_section]}"

        # Show section menu
        setup_section_menu "$category" "$((current_section + 1))" "${#categories[@]}" "$env"

        case "$SETUP_MENU_RESULT" in
            configure)
                if setup_configure_section "$category" "$env"; then
                    section_history+=("$current_section")
                    ((current_section++))
                fi
                ;;
            skip)
                setup_apply_defaults "$category" "$env"
                section_history+=("$current_section")
                ((current_section++))
                ;;
            back)
                if [[ $current_section -gt 0 ]]; then
                    ((current_section--))
                fi
                ;;
        esac
    done

    # Optional configuration prompt
    printf '\033[2J\033[H'
    echo ""
    echo -e "  ${GREEN}✓${NC} ${BOLD}Required configuration complete!${NC}"
    echo ""

    if wizard_confirm "Configure optional settings? (STT, TTS, GPU)" "n"; then
        configure_optional_settings "$env"
    fi

    # Review screen
    wizard_clear_screen

    local -a config_lines=()
    for var_name in $(get_wizard_config_keys); do
        local value
        value=$(get_wizard_config "$var_name")
        config_lines+=("${var_name}=${value}")
    done

    wizard_review_screen "${config_lines[@]}"

    # Confirm and save
    if wizard_confirm "Save this configuration?" "y"; then
        save_configuration "$project_dir" "$env"
        wizard_success_screen "$env_file" "$env"
        return 0
    else
        echo ""
        echo -e "  ${YELLOW}Configuration not saved.${NC}"
        return 1
    fi
}

get_environment_file() {
    local project_dir="$1"
    local env="$2"

    if [[ "$env" == "production" ]]; then
        echo "$project_dir/.env.production"
    else
        echo "$project_dir/.env.local"
    fi
}

# =============================================================================
# Section Menu (Configure/Skip/Back)
# =============================================================================

setup_section_menu() {
    local category="$1"
    local current_idx="$2"
    local total="$3"
    local env="$4"

    # Clear screen
    printf '\033[2J\033[H'

    # Show section header
    local icon name desc
    icon=$(get_category_icon "$category")
    name=$(get_category_name "$category")
    desc=$(get_category_description "$category")

    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    local name_upper
    name_upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    echo -e "  ${icon}  ${BOLD}${name_upper}${NC}  ${DIM}[${current_idx}/${total}]${NC}"
    [[ -n "$desc" ]] && echo -e "  ${DIM}${desc}${NC}"
    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local options=("Configure" "Skip section")
    [[ $current_idx -gt 1 ]] && options+=("Back")

    local selected=0
    local num_options=${#options[@]}

    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm  [b] Back${NC}"
    echo ""

    for ((i=0; i<num_options; i++)); do
        echo ""
    done

    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        for ((i=0; i<num_options; i++)); do
            printf '\033[1A'
        done

        for ((i=0; i<num_options; i++)); do
            printf "\r"
            if [[ $i -eq $selected ]]; then
                printf "  ❯ ${GREEN}${options[$i]}${NC}"
            else
                printf "    ${DIM}${options[$i]}${NC}"
            fi
            printf '\033[K'
            echo ""
        done

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                wizard_show_cursor
                case "${options[$selected]}" in
                    "Configure") SETUP_MENU_RESULT="configure" ;;
                    "Skip section") SETUP_MENU_RESULT="skip" ;;
                    "Back") SETUP_MENU_RESULT="back" ;;
                esac
                return 0
                ;;
            ESC|b|B)
                if [[ $current_idx -gt 1 ]]; then
                    wizard_restore_terminal
                    wizard_show_cursor
                    SETUP_MENU_RESULT="back"
                    return 0
                fi
                ;;
            UP|k|K)
                ((selected--))
                [[ $selected -lt 0 ]] && selected=$((num_options - 1))
                ;;
            DOWN|j|J)
                ((selected++))
                [[ $selected -ge $num_options ]] && selected=0
                ;;
        esac
    done
}

# =============================================================================
# Section Configuration
# =============================================================================

setup_configure_section() {
    local category="$1"
    local env="$2"

    # Get variables for this category
    local vars
    vars=$(get_setup_vars "$category" "$env")

    # Convert to array
    local -a var_array=()
    for v in $vars; do
        var_array+=("$v")
    done

    local num_vars=${#var_array[@]}
    local var_idx=0

    # Get section info
    local icon name
    icon=$(get_category_icon "$category")
    name=$(get_category_name "$category")

    while [[ $var_idx -lt $num_vars ]]; do
        local var_name="${var_array[$var_idx]}"

        # Clear screen
        printf '\033[2J\033[H'

        # Compact section header
        echo ""
        echo -e "  ${icon}  ${BOLD}${name}${NC}"
        echo ""

        local current
        current=$(get_wizard_config "$var_name")
        local value
        value=$(wizard_var_input_compact "$var_name" "$current" "$env" "$((var_idx + 1))" "$num_vars")

        if [[ "$value" == "__BACK__" ]]; then
            if [[ $var_idx -gt 0 ]]; then
                ((var_idx--))
            else
                # At first var, return to section menu
                return 1
            fi
        else
            # Enforce non-empty required values
            if is_var_required "$var_name" "$env" && [[ -z "$value" ]]; then
                echo ""
                warning "${var_name} is required and cannot be empty."
                echo -e "  ${DIM}Please enter a value to continue.${NC}"
                sleep 1.2
                continue
            fi
            set_wizard_config "$var_name" "$value"
            ((var_idx++))
        fi
    done
    return 0
}

# =============================================================================
# Apply Defaults for Skipped Section
# =============================================================================

setup_apply_defaults() {
    local category="$1"
    local env="$2"

    local vars
    vars=$(get_setup_vars "$category" "$env")

    for var_name in $vars; do
        # Skip if already has a value
        if has_wizard_config "$var_name"; then
            continue
        fi

        # Apply default
        local default
        default=$(get_var_default "$var_name" "$env")
        if [[ -n "$default" ]]; then
            set_wizard_config "$var_name" "$default"
        fi
    done
}

# =============================================================================
# Optional Settings Configuration
# =============================================================================

# Global for optional section menu result
OPTIONAL_MENU_RESULT=""

optional_section_menu() {
    local category="$1"
    local current_idx="$2"
    local total="$3"

    # Clear screen
    printf '\033[2J\033[H'

    # Show section header
    local icon name desc
    icon=$(get_category_icon "$category")
    name=$(get_category_name "$category")
    desc=$(get_category_description "$category")

    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    local name_upper
    name_upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    echo -e "  ${icon}  ${BOLD}${name_upper}${NC}  ${DIM}[Optional ${current_idx}/${total}]${NC}"
    [[ -n "$desc" ]] && echo -e "  ${DIM}${desc}${NC}"
    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local options=("Configure" "Skip section")
    [[ $current_idx -gt 1 ]] && options+=("Back")

    local selected=0
    local num_options=${#options[@]}

    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm  [b] Back${NC}"
    echo ""

    for ((i=0; i<num_options; i++)); do
        echo ""
    done

    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        for ((i=0; i<num_options; i++)); do
            printf '\033[1A'
        done

        for ((i=0; i<num_options; i++)); do
            printf "\r"
            if [[ $i -eq $selected ]]; then
                printf "  ❯ ${GREEN}${options[$i]}${NC}"
            else
                printf "    ${DIM}${options[$i]}${NC}"
            fi
            printf '\033[K'
            echo ""
        done

        local key
        key=$(wizard_read_key)

        case "$key" in
            ENTER)
                wizard_restore_terminal
                wizard_show_cursor
                case "${options[$selected]}" in
                    "Configure") OPTIONAL_MENU_RESULT="configure" ;;
                    "Skip section") OPTIONAL_MENU_RESULT="skip" ;;
                    "Back") OPTIONAL_MENU_RESULT="back" ;;
                esac
                return 0
                ;;
            ESC|b|B)
                if [[ $current_idx -gt 1 ]]; then
                    wizard_restore_terminal
                    wizard_show_cursor
                    OPTIONAL_MENU_RESULT="back"
                    return 0
                fi
                ;;
            UP|k|K)
                ((selected--))
                [[ $selected -lt 0 ]] && selected=$((num_options - 1))
                ;;
            DOWN|j|J)
                ((selected++))
                [[ $selected -ge $num_options ]] && selected=0
                ;;
        esac
    done
}

configure_optional_section() {
    local category="$1"
    local env="$2"

    # Get all variables for this category
    local vars
    vars=$(get_category_vars "$category")

    # Convert to array
    local -a var_array=()
    for v in $vars; do
        var_array+=("$v")
    done

    local num_vars=${#var_array[@]}
    local var_idx=0

    # Get section info
    local icon name
    icon=$(get_category_icon "$category")
    name=$(get_category_name "$category")

    while [[ $var_idx -lt $num_vars ]]; do
        local var_name="${var_array[$var_idx]}"

        # Clear screen
        printf '\033[2J\033[H'

        # Compact section header
        echo ""
        echo -e "  ${icon}  ${BOLD}${name}${NC}"
        echo ""

        local current
        current=$(get_wizard_config "$var_name")
        local value
        value=$(wizard_var_input_compact "$var_name" "$current" "$env" "$((var_idx + 1))" "$num_vars")

        if [[ "$value" == "__BACK__" ]]; then
            if [[ $var_idx -gt 0 ]]; then
                ((var_idx--))
            else
                # At first var, return to section menu
                return 1
            fi
        else
            set_wizard_config "$var_name" "$value"
            ((var_idx++))
        fi
    done
    return 0
}

apply_optional_defaults() {
    local category="$1"
    local env="$2"

    local vars
    vars=$(get_category_vars "$category")

    for var_name in $vars; do
        # Skip if already has a value
        if has_wizard_config "$var_name"; then
            continue
        fi

        # Apply default
        local default
        default=$(get_var_default "$var_name" "$env")
        if [[ -n "$default" ]]; then
            set_wizard_config "$var_name" "$default"
        fi
    done
}

configure_optional_settings() {
    local env="$1"

    local optional_categories=("stt" "tts" "gpu")
    local current_section=0

    # Walk through optional sections with navigation
    while [[ $current_section -lt ${#optional_categories[@]} ]]; do
        local category="${optional_categories[$current_section]}"

        # Show section menu
        optional_section_menu "$category" "$((current_section + 1))" "${#optional_categories[@]}"

        case "$OPTIONAL_MENU_RESULT" in
            configure)
                if configure_optional_section "$category" "$env"; then
                    ((current_section++))
                fi
                ;;
            skip)
                apply_optional_defaults "$category" "$env"
                ((current_section++))
                ;;
            back)
                if [[ $current_section -gt 0 ]]; then
                    ((current_section--))
                fi
                ;;
        esac
    done
}

# =============================================================================
# Configuration Loading
# =============================================================================

load_existing_config() {
    local env_file="$1"

    if [[ ! -f "$env_file" ]]; then
        return 1
    fi

    # Read existing environment file
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip comments and empty lines
        [[ -z "$line" ]] && continue
        [[ "$line" =~ ^[[:space:]]*# ]] && continue

        # Parse VAR=value
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local var_name="${BASH_REMATCH[1]}"
            local var_value="${BASH_REMATCH[2]}"

            # Remove surrounding quotes if present
            var_value="${var_value#\"}"
            var_value="${var_value%\"}"
            var_value="${var_value#\'}"
            var_value="${var_value%\'}"

            # Only load if we have metadata for this variable
            local meta
            meta=$(get_var_metadata "$var_name")
            if [[ -n "$meta" ]]; then
                set_wizard_config "$var_name" "$var_value"
            fi
        fi
    done < "$env_file"
}

# =============================================================================
# Apply Defaults for Non-Prompted Variables
# =============================================================================

apply_all_defaults() {
    local env="$1"

    # Apply defaults for ALL variables that weren't explicitly set
    for var_name in "${ALL_VARIABLES[@]}"; do
        # Skip if already has a value
        if has_wizard_config "$var_name"; then
            continue
        fi

        # Skip production-only vars in local mode
        local required
        required=$(get_var_meta "$var_name" "required")
        if [[ "$required" == "production" ]] && [[ "$env" != "production" ]]; then
            continue
        fi

        # Apply default
        local default
        default=$(get_var_default "$var_name" "$env")
        if [[ -n "$default" ]]; then
            set_wizard_config "$var_name" "$default"
        fi
    done
}

# =============================================================================
# Configuration Saving
# =============================================================================

save_configuration() {
    local project_dir="$1"
    local env="$2"
    local env_file
    env_file=$(get_environment_file "$project_dir" "$env")

    # Apply defaults for all non-prompted variables
    apply_all_defaults "$env"

    # Backup existing environment file if it exists
    if [[ -f "$env_file" ]]; then
        local backup_file="${env_file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$env_file" "$backup_file"
        verbose "Backed up existing environment file to $backup_file"
    fi

    # Generate environment file
    {
        echo "# ============================================================================"
        echo "# STELLA - ENVIRONMENT CONFIGURATION"
        echo "# Generated by setup wizard on $(date '+%Y-%m-%d %H:%M:%S')"
        echo "# Mode: $env"
        echo "# ============================================================================"
        echo ""

        # Write variables by category
        for category in "${VAR_CATEGORIES[@]}"; do
            local category_vars
            category_vars=$(get_category_vars "$category")

            # Check if any variables in this category have values
            local has_values=false
            for var_name in $category_vars; do
                if has_wizard_config "$var_name"; then
                    has_values=true
                    break
                fi
            done

            # Skip empty categories
            [[ "$has_values" == "false" ]] && continue

            local name
            name=$(get_category_name "$category")

            echo "# ============================================================================"
            echo "# $name"
            echo "# ============================================================================"

            for var_name in $category_vars; do
                local value
                value=$(get_wizard_config "$var_name")

                # Skip if empty
                [[ -z "$value" ]] && continue

                local description
                description=$(get_var_meta "$var_name" "description")

                # Add comment with description
                if [[ -n "$description" ]]; then
                    echo "# $description"
                fi

                # Quote value if it contains spaces or special characters
                if [[ "$value" =~ [[:space:]\"\'\$\`\\] ]]; then
                    echo "${var_name}=\"${value}\""
                else
                    echo "${var_name}=${value}"
                fi
                echo ""
            done
        done

        # Add NODE_ENV
        echo "# ============================================================================"
        echo "# Environment Mode"
        echo "# ============================================================================"
        echo "NODE_ENV=$env"

    } > "$env_file"

    # Mark setup as complete
    mark_setup_complete "$project_dir" "$env"
}

# =============================================================================
# Setup Status Marker
# =============================================================================

mark_setup_complete() {
    local project_dir="$1"
    local env="$2"
    local marker_file="$project_dir/.stella-setup-complete"

    echo "$env" > "$marker_file"
}
