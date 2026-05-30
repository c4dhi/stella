#!/bin/bash
# =============================================================================
# config_wizard.sh - Full configuration wizard for STELLA
# =============================================================================
# Walks through ALL configuration variables, allowing users to customize
# every aspect of the deployment.
# Compatible with bash 3.2+ (macOS default)
# =============================================================================

# Source dependencies
CONFIG_LIB_DIR="${LIB_DIR:-$(dirname "${BASH_SOURCE[0]}")}"
source "$CONFIG_LIB_DIR/colors.sh"
source "$CONFIG_LIB_DIR/variables.sh"
source "$CONFIG_LIB_DIR/wizard.sh"

# =============================================================================
# Configuration Storage (bash 3.2 compatible - uses temp file)
# =============================================================================

# Temp file for storing configuration key=value pairs
CONFIG_VALUES_FILE=""

# Initialize config storage
init_config_values() {
    CONFIG_VALUES_FILE=$(mktemp)
    # Clean up on exit
    trap "rm -f '$CONFIG_VALUES_FILE' 2>/dev/null" EXIT
}

# Get a config value
get_config_value() {
    local key="$1"
    if [[ -f "$CONFIG_VALUES_FILE" ]]; then
        # Missing keys are expected for optional vars; do not fail under pipefail.
        grep "^${key}=" "$CONFIG_VALUES_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- || true
    fi
}

# Set a config value
set_config_value() {
    local key="$1"
    local value="$2"
    if [[ -f "$CONFIG_VALUES_FILE" ]]; then
        # Remove existing key if present
        grep -v "^${key}=" "$CONFIG_VALUES_FILE" > "${CONFIG_VALUES_FILE}.tmp" 2>/dev/null || true
        mv "${CONFIG_VALUES_FILE}.tmp" "$CONFIG_VALUES_FILE"
        # Add new value
        echo "${key}=${value}" >> "$CONFIG_VALUES_FILE"
    fi
}

# Get all config keys
get_config_value_keys() {
    if [[ -f "$CONFIG_VALUES_FILE" ]]; then
        cut -d'=' -f1 "$CONFIG_VALUES_FILE" 2>/dev/null | sort -u
    fi
}

# Check if config has a value
has_config_value() {
    local key="$1"
    local value
    value=$(get_config_value "$key")
    [[ -n "$value" ]]
}

# =============================================================================
# All Categories for Full Config
# =============================================================================

# Categories to show in full config wizard
declare -a CONFIG_CATEGORIES_LOCAL=(
    "database"
    "livekit"
    "ai_apis"
    "stt"
    "tts"
    "gpu"
)

declare -a CONFIG_CATEGORIES_PRODUCTION=(
    "database"
    "security"
    "livekit"
    "ai_apis"
    "stt"
    "tts"
    "gpu"
    "kubernetes"
    "production"
)

# =============================================================================
# Main Configuration Flow
# =============================================================================

run_config_wizard() {
    local env="${1:-}"
    local project_dir="$PROJECT_DIR"

    # Initialize config storage
    init_config_values

    wizard_setup_traps

    # If environment not specified, show selection screen
    if [[ -z "$env" ]]; then
        wizard_welcome_screen
        env="$WIZARD_SELECTED_ENV"
    fi

    local env_file
    env_file=$(get_environment_file "$project_dir" "$env")

    # Load existing config for the selected environment
    if [[ -f "$env_file" ]]; then
        load_config_file "$env_file"
    fi

    # Select categories based on environment
    local -a categories
    if [[ "$env" == "production" ]]; then
        categories=("${CONFIG_CATEGORIES_PRODUCTION[@]}")
    else
        categories=("${CONFIG_CATEGORIES_LOCAL[@]}")
    fi

    # Build section names for progress bar
    local -a section_names=()
    for cat in "${categories[@]}"; do
        local cat_name
        cat_name=$(get_category_name "$cat")
        local short_name="${cat_name%% *}"
        section_names+=("$short_name")
    done
    section_names+=("Review")

    local total_sections=${#section_names[@]}
    local current_section=0

    # Track section history for back navigation
    local -a section_history=()

    # Walk through all sections with navigation
    while [[ $current_section -lt ${#categories[@]} ]]; do
        local category="${categories[$current_section]}"

        # Show section menu with Configure/Skip/Back options
        section_menu "$category" "$((current_section + 1))" "${#categories[@]}" "$env"

        case "$SECTION_MENU_RESULT" in
            configure)
                if configure_section "$category" "$env"; then
                    section_history+=("$current_section")
                    current_section=$((current_section + 1))
                fi
                # If configure_section returns 1, user backed out - stay on this section
                ;;
            skip)
                apply_section_defaults "$category" "$env"
                section_history+=("$current_section")
                current_section=$((current_section + 1))
                ;;
            back)
                if [[ $current_section -gt 0 ]]; then
                    current_section=$((current_section - 1))
                fi
                ;;
        esac
    done

    # Fill in any required secret not covered by the walkthrough (e.g. the
    # local flow has no Security section) so the review reflects what will be
    # saved; the matching call in save_full_configuration is then a no-op.
    generate_missing_required_secrets "$env"

    # Review screen
    wizard_clear_screen
    wizard_progress_bar "$total_sections" "${section_names[@]}"

    local -a config_lines=()
    for var_name in $(get_config_value_keys); do
        # UI-only synthetic; the underlying booleans appear in their place.
        local value
        value=$(get_config_value "$var_name")
        config_lines+=("${var_name}=${value}")
    done

    wizard_review_screen "${config_lines[@]}"

    # Tell the operator which required secrets were created in the background.
    if [[ ${#WIZARD_GENERATED_SECRETS[@]} -gt 0 ]]; then
        echo -e "  ${YELLOW}⚡${NC} ${BOLD}Auto-generated${NC} ${DIM}(no value provided, none saved):${NC}"
        echo -e "  ${DIM}${WIZARD_GENERATED_SECRETS[*]}${NC}"
        echo ""
    fi

    # Warn about required values we cannot create (external/operator-specific).
    local unfilled
    unfilled=$(get_unfilled_required_vars "$env")
    if [[ -n "$unfilled" ]]; then
        echo -e "  ${RED}⚠${NC}  ${BOLD}Still missing — required, cannot be auto-generated:${NC}"
        echo -e "  ${YELLOW}${unfilled}${NC}"
        echo -e "  ${DIM}STELLA will not run until these are set. Choose 'No' below to cancel${NC}"
        echo -e "  ${DIM}and re-run setup, or add them to ${env_file} before starting.${NC}"
        echo ""
    fi

    # Confirm and save
    if wizard_confirm "Save this configuration?" "y"; then
        save_full_configuration "$project_dir" "$env"
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

# Global variable for section menu result
SECTION_MENU_RESULT=""

section_menu() {
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
                    "Configure") SECTION_MENU_RESULT="configure" ;;
                    "Skip section") SECTION_MENU_RESULT="skip" ;;
                    "Back") SECTION_MENU_RESULT="back" ;;
                esac
                return 0
                ;;
            ESC|b|B)
                # Go back (if not first section)
                if [[ $current_idx -gt 1 ]]; then
                    wizard_restore_terminal
                    wizard_show_cursor
                    SECTION_MENU_RESULT="back"
                    return 0
                fi
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
# Section Configuration
# =============================================================================

configure_section() {
    local category="$1"
    local env="$2"

    # Get all variables for this category
    local vars
    vars=$(get_category_vars "$category")

    # Convert to array
    local -a var_array=()
    for v in $vars; do
        # Skip production-only vars in local mode
        local required
        required=$(get_var_meta "$v" "required")
        if [[ "$required" == "production" ]] && [[ "$env" != "production" ]]; then
            continue
        fi
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

        # Hide provider-specific knobs when their provider isn't selected
        # (e.g. Voxtral license acknowledgement only matters when the user
        # actually picked TTS_PROVIDER=voxtral earlier in the section).
        if should_skip_wizard_var "$var_name" "$(get_config_value TTS_PROVIDER)"; then
            var_idx=$((var_idx + 1))
            continue
        fi

        # Clear screen to stderr
        printf '\033[2J\033[H' >&2

        # Compact section header
        echo "" >&2
        echo -e "  ${icon}  ${BOLD}${name}${NC}" >&2
        echo "" >&2

        local current
        current=$(get_config_value "$var_name")
        local value
        if [[ "$var_name" == "LIVEKIT_URL" ]]; then
            value=$(wizard_livekit_url_guided "$current" "$env")
        else
            value=$(wizard_var_input_compact "$var_name" "$current" "$env" "$((var_idx + 1))" "$num_vars")
        fi

        if [[ "$value" == "__BACK__" ]]; then
            if [[ $var_idx -gt 0 ]]; then
                var_idx=$((var_idx - 1))
            else
                # At first var, return to section menu
                return 1
            fi
        else
            # Enforce non-empty required values
            if is_var_required "$var_name" "$env" && [[ -z "$value" ]]; then
                echo "" >&2
                warning "${var_name} is required and cannot be empty."
                echo -e "  ${DIM}Please enter a value to continue.${NC}" >&2
                sleep 1.2
                continue
            fi
            set_config_value "$var_name" "$value"
            var_idx=$((var_idx + 1))
        fi
    done
    return 0
}

# =============================================================================
# Default Value Application
# =============================================================================

apply_section_defaults() {
    local category="$1"
    local env="$2"

    local vars
    vars=$(get_category_vars "$category")

    for var_name in $vars; do
        # Skip if already has a value
        if has_config_value "$var_name"; then
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
            set_config_value "$var_name" "$default"
        fi
    done
}

# =============================================================================
# Configuration Loading
# =============================================================================

load_config_file() {
    local env_file="$1"

    if [[ ! -f "$env_file" ]]; then
        return 1
    fi

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

            # Store value
            set_config_value "$var_name" "$var_value"
        fi
    done < "$env_file"
}

# =============================================================================
# Ensure Required Secrets Exist
# =============================================================================

# Safety net run just before saving: every variable that is required for this
# environment must end up with a value. Prefer a known default, otherwise
# generate one from the variable's generator. Already-set values (typed,
# loaded, or defaulted) are never overwritten.
#
# This is essential for the local full-config flow, where the "Security"
# category is not part of the walkthrough — without this, JWT_SECRET and
# ENV_VAR_ENCRYPTION_KEY would never be set on a fresh local configuration.
#
# Names of secrets actually generated are recorded in WIZARD_GENERATED_SECRETS
# so the review screen can show what was created in the background.
WIZARD_GENERATED_SECRETS=()

generate_missing_required_secrets() {
    local env="$1"
    local var_name
    WIZARD_GENERATED_SECRETS=()
    for var_name in "${ALL_VARIABLES[@]}"; do
        if ! is_var_required "$var_name" "$env"; then
            continue
        fi
        if has_config_value "$var_name"; then
            continue
        fi

        local generator
        generator=$(get_var_meta "$var_name" "generator" 2>/dev/null || true)

        if [[ -n "$generator" ]]; then
            # Generatable secret. Keep the environment's OWN default if it has
            # one (e.g. local LiveKit's devkey) but deliberately skip the
            # cross-environment fallback, so production never inherits the
            # local dev credentials — it generates a fresh value instead.
            local own_default
            if [[ "$env" == "production" ]]; then
                own_default=$(get_var_meta "$var_name" "default_prod" 2>/dev/null || true)
            else
                own_default=$(get_var_meta "$var_name" "default_local" 2>/dev/null || true)
            fi
            if [[ -n "$own_default" ]]; then
                set_config_value "$var_name" "$own_default"
                continue
            fi
            local generated
            generated=$(eval "$generator" 2>/dev/null || true)
            if [[ -z "$generated" ]]; then
                generated=$(openssl rand -base64 36 2>/dev/null | tr -d '\n' || true)
            fi
            if [[ -n "$generated" ]]; then
                set_config_value "$var_name" "$generated"
                WIZARD_GENERATED_SECRETS+=("$var_name")
            fi
        else
            # Plain required setting (no generator): apply its default. The
            # cross-environment fallback is fine here (e.g. LIVEKIT_URL).
            local default
            default=$(get_var_default "$var_name" "$env" 2>/dev/null || true)
            if [[ -n "$default" ]]; then
                set_config_value "$var_name" "$default"
            fi
        fi
    done
}

# Required-for-this-environment variables that STILL have no value after
# defaults and generation. These are credentials we cannot fabricate — e.g.
# OPENAI_API_KEY (external) or PRODUCTION_DOMAIN (operator-specific). Echoes
# the names space-separated; empty if all set.
get_unfilled_required_vars() {
    local env="$1"
    local var_name
    local -a missing=()
    for var_name in "${ALL_VARIABLES[@]}"; do
        if ! is_var_required "$var_name" "$env"; then
            continue
        fi
        if has_config_value "$var_name"; then
            continue
        fi
        missing+=("$var_name")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "${missing[*]}"
    fi
}

# =============================================================================
# Configuration Saving
# =============================================================================

save_full_configuration() {
    local project_dir="$1"
    local env="$2"
    local env_file
    env_file=$(get_environment_file "$project_dir" "$env")

    # Guarantee every required secret is present (generate any still missing).
    generate_missing_required_secrets "$env"

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
        echo "# Generated by configuration wizard on $(date '+%Y-%m-%d %H:%M:%S')"
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
                if has_config_value "$var_name"; then
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
                # UI-only synthetic var — never written to .env

                local value
                value=$(get_config_value "$var_name")

                # Skip if empty
                [[ -z "$value" ]] && continue

                local description
                description=$(get_var_meta "$var_name" "description")
                local required
                required=$(get_var_meta "$var_name" "required")

                # Add comment with description
                if [[ -n "$description" ]]; then
                    echo "# $description"
                fi
                if [[ "$required" == "both" ]] || [[ "$required" == "production" && "$env" == "production" ]]; then
                    echo "# @required"
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
    mark_config_complete "$project_dir" "$env"
}

# =============================================================================
# Setup Status Marker
# =============================================================================

mark_config_complete() {
    local project_dir="$1"
    local env="$2"
    local marker_file="$project_dir/.stella-setup-complete"

    echo "$env" > "$marker_file"
}

# =============================================================================
# Quick Reconfigure Single Variable
# =============================================================================

reconfigure_variable() {
    local var_name="$1"
    local project_dir="$PROJECT_DIR"
    local env="${NODE_ENV:-local}"

    # Initialize config storage
    init_config_values

    local env_file
    env_file=$(get_environment_file "$project_dir" "$env")

    # Load existing config for current environment
    if [[ -f "$env_file" ]]; then
        load_config_file "$env_file"
    fi

    wizard_setup_traps
    wizard_clear_screen

    echo ""
    echo -e "  ${BOLD}Reconfigure: ${var_name}${NC}"
    echo ""

    local current
    current=$(get_config_value "$var_name")
    local value
    value=$(wizard_var_input "$var_name" "$current" "$env")

    if [[ "$value" != "$current" ]]; then
        set_config_value "$var_name" "$value"

        if wizard_confirm "Save updated configuration?" "y"; then
            save_full_configuration "$project_dir" "$env"
            echo ""
            echo -e "  ${GREEN}✓${NC} Configuration updated"
        fi
    else
        echo ""
        echo -e "  ${DIM}No changes made${NC}"
    fi
}
