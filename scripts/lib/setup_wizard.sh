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
INITIAL_ADMIN_EMAIL_VALUE=""
INITIAL_ADMIN_PASSWORD_VALUE=""

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
# Chapter tab bar — shows the full wizard outline on every section card so
# the operator can see where they are and what is still to come.
# =============================================================================
WIZARD_CHAPTERS=()
WIZARD_OPTIONAL_OFFSET=0
WIZARD_ADMIN_OFFSET=0

# Replace the single "Optional Settings" placeholder tab with the three
# real sub-tabs (STT / TTS / GPU). Called when the operator chooses to
# configure the optional phase so the outline matches what's coming.
# Idempotent — safe to call again after a Back navigation.
wizard_expand_optional_chapters() {
    # Already expanded?
    if [[ "${WIZARD_CHAPTERS[$WIZARD_OPTIONAL_OFFSET]}" != "Optional Settings" ]]; then
        return 0
    fi
    local -a expanded=()
    local i
    for ((i=0; i<${#WIZARD_CHAPTERS[@]}; i++)); do
        if (( i == WIZARD_OPTIONAL_OFFSET )); then
            expanded+=("$(get_category_name stt)")
            expanded+=("$(get_category_name tts)")
            expanded+=("$(get_category_name gpu)")
        else
            expanded+=("${WIZARD_CHAPTERS[$i]}")
        fi
    done
    WIZARD_CHAPTERS=("${expanded[@]}")
    # Admin tab moved right by 2 (3 inserted, 1 removed).
    WIZARD_ADMIN_OFFSET=$((WIZARD_ADMIN_OFFSET + 2))
}

wizard_chapter_tabs() {
    local current_global_idx="$1"   # 1-based
    local total=${#WIZARD_CHAPTERS[@]}
    [[ $total -eq 0 ]] && return 0

    echo ""
    printf "  "
    local i
    for ((i=0; i<total; i++)); do
        local label="${WIZARD_CHAPTERS[$i]}"
        local human=$((i + 1))
        if (( human < current_global_idx )); then
            printf "✓ %s   " "$label"
        elif (( human == current_global_idx )); then
            printf "${GREEN}${BOLD}◐ %s${NC}   " "$label"
        else
            printf "${DIM}○ %s${NC}   " "$label"
        fi
    done
    echo ""
}

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

    # Build the global chapter list used by the tab bar so every section
    # card can show where the operator is in the overall flow. The
    # optional STT/TTS/GPU sub-sections are collapsed into a single
    # "Optional Settings" tab; sub-cards still get their own headers but
    # the outline stays compact. If the operator declines the optional
    # phase the tab is left in place (marked done by progression) rather
    # than expanded.
    WIZARD_CHAPTERS=()
    local _cat
    for _cat in "${categories[@]}"; do
        WIZARD_CHAPTERS+=("$(get_category_name "$_cat")")
    done
    WIZARD_OPTIONAL_OFFSET=${#WIZARD_CHAPTERS[@]}
    WIZARD_CHAPTERS+=("Optional Settings")
    WIZARD_ADMIN_OFFSET=${#WIZARD_CHAPTERS[@]}
    WIZARD_CHAPTERS+=("Admin")

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
                    current_section=$((current_section + 1))
                fi
                ;;
            skip)
                setup_apply_defaults "$category" "$env"
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

    # Post-required phase: optional gate + admin bootstrap, with Back
    # navigation between them.
    local post_state="optional"
    while [[ "$post_state" != "done" ]]; do
        case "$post_state" in
            optional)
                if optional_settings_intro_section; then
                    wizard_expand_optional_chapters
                    configure_optional_settings "$env"
                fi
                post_state="admin"
                ;;
            admin)
                local admin_rc=0
                admin_bootstrap_section "$project_dir" "$env" || admin_rc=$?
                case "$admin_rc" in
                    2)  post_state="optional" ;;  # Back
                    *)  post_state="done" ;;
                esac
                ;;
        esac
    done

    # Fill in any required secret the operator didn't provide so the review
    # shows the credentials that will actually be written (the matching call in
    # save_configuration then becomes a no-op). Non-required defaults are still
    # applied at save time, matching the prior review behaviour.
    generate_missing_required_secrets "$env"

    # Review screen
    wizard_clear_screen

    local -a config_lines=()
    for var_name in $(get_wizard_config_keys); do
        # UI-only synthetic; the underlying booleans appear in their place.
        local value
        value=$(get_wizard_config "$var_name")
        config_lines+=("${var_name}=${value}")
    done
    if [[ -n "$INITIAL_ADMIN_EMAIL_VALUE" ]]; then
        config_lines+=("INITIAL_ADMIN_EMAIL=${INITIAL_ADMIN_EMAIL_VALUE}")
    fi
    if [[ -n "$INITIAL_ADMIN_PASSWORD_VALUE" ]]; then
        config_lines+=("INITIAL_ADMIN_PASSWORD=${INITIAL_ADMIN_PASSWORD_VALUE}")
    fi

    wizard_review_screen "${config_lines[@]}"

    # Tell the operator which required secrets were created in the background
    # (e.g. because they skipped the credentials section or left fields blank).
    if [[ ${#WIZARD_GENERATED_SECRETS[@]} -gt 0 ]]; then
        echo -e "  ${YELLOW}⚡${NC} ${BOLD}Auto-generated${NC} ${DIM}(no value provided, none saved):${NC}"
        echo -e "  ${DIM}${WIZARD_GENERATED_SECRETS[*]}${NC}"
        echo ""
    fi

    # Warn about required values we cannot create (external/operator-specific).
    # These can't be generated, so STELLA won't run until they're supplied.
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
        save_configuration "$project_dir" "$env"
        wizard_success_screen "$env_file" "$env"
        return 0
    else
        local bootstrap_file
        bootstrap_file=$(get_admin_bootstrap_file "$project_dir" "$env")
        rm -f "$bootstrap_file" 2>/dev/null || true
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

get_admin_bootstrap_file() {
    local project_dir="$1"
    local env="$2"
    echo "$project_dir/.stella-initial-admin.${env}.json"
}

escape_env_value() {
    local value="$1"
    # Escape backslashes and double quotes for safe .env quoted output
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    echo "$value"
}

optional_settings_intro_section() {
    printf '\033[2J\033[H'
    wizard_chapter_tabs "$((WIZARD_OPTIONAL_OFFSET + 1))"
    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "  ${GREEN}✓${NC} ${BOLD}Required configuration complete.${NC}"
    echo ""
    echo -e "  ⚙️   ${BOLD}OPTIONAL SETTINGS${NC}"
    echo -e "  ${DIM}Speech-to-Text, Text-to-Speech, and GPU acceleration.${NC}"
    echo -e "  ${DIM}Skip to accept sensible defaults for all three.${NC}"
    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local options=("Configure" "Skip section")
    local selected=0
    local num_options=${#options[@]}

    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm${NC}"
    echo ""
    for ((i=0; i<num_options; i++)); do echo ""; done

    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        for ((i=0; i<num_options; i++)); do printf '\033[1A'; done
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
                [[ "${options[$selected]}" == "Configure" ]] && return 0
                return 1
                ;;
            UP|k|K)   selected=$(( (selected - 1 + num_options) % num_options )) ;;
            DOWN|j|J) selected=$(( (selected + 1) % num_options )) ;;
        esac
    done
}

admin_bootstrap_section() {
    local project_dir="$1"
    local env="$2"

    printf '\033[2J\033[H'
    wizard_chapter_tabs "$((WIZARD_ADMIN_OFFSET + 1))"
    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "  👤  ${BOLD}INITIAL ADMIN ACCOUNT${NC}"
    echo -e "  ${DIM}Bootstrap a system-admin login for first sign-in. Skip if you${NC}"
    echo -e "  ${DIM}plan to create the admin manually (e.g. via SQL).${NC}"
    echo ""
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local options=("Configure" "Skip section" "Back")
    local selected=0
    local num_options=${#options[@]}

    echo -e "  ${DIM}[↑↓] Select  [Enter] Confirm  [b] Back${NC}"
    echo ""
    for ((i=0; i<num_options; i++)); do echo ""; done

    wizard_init_terminal
    wizard_hide_cursor

    while true; do
        for ((i=0; i<num_options; i++)); do printf '\033[1A'; done
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
                    Configure)
                        collect_initial_admin_credentials "$project_dir" "$env"
                        return 0
                        ;;
                    "Skip section")
                        INITIAL_ADMIN_EMAIL_VALUE=""
                        INITIAL_ADMIN_PASSWORD_VALUE=""
                        rm -f "$(get_admin_bootstrap_file "$project_dir" "$env")" 2>/dev/null || true
                        return 0
                        ;;
                    Back)
                        return 2
                        ;;
                esac
                ;;
            ESC|b|B)
                wizard_restore_terminal
                wizard_show_cursor
                return 2
                ;;
            UP|k|K)   selected=$(( (selected - 1 + num_options) % num_options )) ;;
            DOWN|j|J) selected=$(( (selected + 1) % num_options )) ;;
        esac
    done
}

collect_initial_admin_credentials() {
    local project_dir="$1"
    local env="$2"
    local bootstrap_file
    bootstrap_file=$(get_admin_bootstrap_file "$project_dir" "$env")

    local admin_email=""
    local admin_password=""

    # Ask until non-empty email, or allow cancel with Ctrl+C.
    while [[ -z "$admin_email" ]]; do
        wizard_clear_screen
        admin_email=$(wizard_text_input "Admin email" "Initial admin login email" "" "")
        if [[ -z "$admin_email" ]]; then
            warning "Admin email cannot be empty."
            sleep 1
        fi
    done

    # Ask until non-empty password and confirmation match, or allow cancel with Ctrl+C.
    while [[ -z "$admin_password" ]]; do
        local password_candidate=""
        local confirm_password=""

        wizard_clear_screen
        echo -e "  ${DIM}Admin email:${NC} ${DIM}${admin_email}${NC}" >&2
        echo "" >&2
        password_candidate=$(wizard_password_input "Admin password" "Initial admin login password" "")
        if [[ -z "$password_candidate" ]]; then
            warning "Admin password cannot be empty."
            sleep 1
            continue
        fi

        wizard_clear_screen
        echo -e "  ${DIM}Admin email:${NC} ${DIM}${admin_email}${NC}" >&2
        echo "" >&2
        echo -e "  ${DIM}Please confirm your password to prevent typos.${NC}" >&2
        echo "" >&2
        confirm_password=$(wizard_password_input "Confirm password" "Re-enter admin password" "")

        if [[ -z "$confirm_password" ]]; then
            warning "Confirm password cannot be empty."
            sleep 1
            continue
        fi

        if [[ "$password_candidate" != "$confirm_password" ]]; then
            warning "Passwords do not match. Please try again."
            sleep 1
            continue
        fi

        admin_password="$password_candidate"
    done

    INITIAL_ADMIN_EMAIL_VALUE="$admin_email"
    INITIAL_ADMIN_PASSWORD_VALUE="$admin_password"

    # Store as base64 to avoid quoting/escaping issues in shell parsing.
    local email_b64 password_b64
    email_b64=$(printf '%s' "$admin_email" | base64 | tr -d '\n')
    password_b64=$(printf '%s' "$admin_password" | base64 | tr -d '\n')

    umask 077
    cat > "$bootstrap_file" <<EOF
{"email_b64":"$email_b64","password_b64":"$password_b64"}
EOF
    chmod 600 "$bootstrap_file" 2>/dev/null || true
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

    wizard_chapter_tabs "$current_idx"
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

        # Hide provider-specific knobs when their provider isn't selected.
        if should_skip_wizard_var "$var_name" "$(get_wizard_config TTS_PROVIDER)"; then
            var_idx=$((var_idx + 1))
            continue
        fi

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
                var_idx=$((var_idx - 1))
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
            var_idx=$((var_idx + 1))
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

    # When an existing config was loaded, "Skip section" means leave the
    # .env file untouched for this category — never inject defaults that
    # would silently add new variables the operator hadn't set.
    if [[ "$WIZARD_HAS_EXISTING_CONFIG" == "true" ]]; then
        return 0
    fi

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

    wizard_chapter_tabs "$((WIZARD_OPTIONAL_OFFSET + current_idx))"
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
                selected=$(( (selected - 1 + num_options) % num_options ))
                ;;
            DOWN|j|J)
                selected=$(( (selected + 1) % num_options ))
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

        # Hide provider-specific knobs when their provider isn't selected.
        if should_skip_wizard_var "$var_name" "$(get_wizard_config TTS_PROVIDER)"; then
            var_idx=$((var_idx + 1))
            continue
        fi

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
                var_idx=$((var_idx - 1))
            else
                # At first var, return to section menu
                return 1
            fi
        else
            set_wizard_config "$var_name" "$value"
            var_idx=$((var_idx + 1))
        fi
    done
    return 0
}

apply_optional_defaults() {
    local category="$1"
    local env="$2"

    # Existing config + skipped optional section ⇒ leave .env untouched.
    if [[ "$WIZARD_HAS_EXISTING_CONFIG" == "true" ]]; then
        return 0
    fi

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
                    current_section=$((current_section + 1))
                fi
                ;;
            skip)
                apply_optional_defaults "$category" "$env"
                current_section=$((current_section + 1))
                ;;
            back)
                if [[ $current_section -gt 0 ]]; then
                    current_section=$((current_section - 1))
                fi
                ;;
        esac
    done
}

# =============================================================================
# Configuration Loading
# =============================================================================

WIZARD_HAS_EXISTING_CONFIG="false"

# Variables present in the existing .env file that the wizard doesn't
# know about (custom keys the operator added manually). Preserved
# verbatim and re-emitted at the end of the regenerated file so they
# survive a save.
WIZARD_PASSTHROUGH_LINES=()

load_existing_config() {
    local env_file="$1"

    if [[ ! -f "$env_file" ]]; then
        return 1
    fi

    WIZARD_HAS_EXISTING_CONFIG="true"
    WIZARD_PASSTHROUGH_LINES=()

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

            # NODE_ENV is re-emitted by the writer; drop it here.
            [[ "$var_name" == "NODE_ENV" ]] && continue

            local meta
            meta=$(get_var_metadata "$var_name")
            if [[ -n "$meta" ]]; then
                set_wizard_config "$var_name" "$var_value"
            else
                # Unknown var — keep verbatim so save doesn't drop it.
                WIZARD_PASSTHROUGH_LINES+=("$line")
            fi
        fi
    done < "$env_file"
}

# =============================================================================
# Apply Defaults for Non-Prompted Variables
# =============================================================================

apply_all_defaults() {
    local env="$1"

    # Existing config: don't inject defaults for unset vars. The operator
    # already has a .env; respect what is there (and what is not).
    if [[ "$WIZARD_HAS_EXISTING_CONFIG" == "true" ]]; then
        return 0
    fi

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
# Ensure Required Secrets Exist
# =============================================================================

# Safety net run just before saving: every variable that is required for this
# environment must end up with a value. If the operator never typed an override
# and nothing was loaded from an existing .env, fill it in — preferring a known
# default (e.g. local LiveKit's devkey/devsecret) and otherwise generating a
# secure value from the variable's generator. Values that are already set
# (typed, loaded, or defaulted) are never overwritten, so this only ever
# *adds* missing required credentials — it never clobbers real configuration.
#
# This guarantees keys like JWT_SECRET, ENV_VAR_ENCRYPTION_KEY and
# POSTGRES_PASSWORD are present even when the credentials section was skipped.
#
# Names of secrets actually generated by the last call are recorded in
# WIZARD_GENERATED_SECRETS so the review screen can tell the operator exactly
# which credentials were created for them in the background.
WIZARD_GENERATED_SECRETS=()

generate_missing_required_secrets() {
    local env="$1"
    local var_name
    WIZARD_GENERATED_SECRETS=()
    for var_name in "${ALL_VARIABLES[@]}"; do
        if ! is_var_required "$var_name" "$env"; then
            continue
        fi
        if has_wizard_config "$var_name"; then
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
                set_wizard_config "$var_name" "$own_default"
                continue
            fi
            local generated
            generated=$(eval "$generator" 2>/dev/null || true)
            if [[ -z "$generated" ]]; then
                generated=$(openssl rand -base64 36 2>/dev/null | tr -d '\n' || true)
            fi
            if [[ -n "$generated" ]]; then
                set_wizard_config "$var_name" "$generated"
                WIZARD_GENERATED_SECRETS+=("$var_name")
            fi
        else
            # Plain required setting (no generator): apply its default. The
            # cross-environment fallback is fine here (e.g. LIVEKIT_URL).
            local default
            default=$(get_var_default "$var_name" "$env" 2>/dev/null || true)
            if [[ -n "$default" ]]; then
                set_wizard_config "$var_name" "$default"
            fi
        fi
    done
}

# Required-for-this-environment variables that STILL have no value after
# defaults and generation have been applied. These are credentials we cannot
# fabricate — e.g. OPENAI_API_KEY (an external secret) or PRODUCTION_DOMAIN
# (operator-specific). Echoes the names space-separated; empty if all set.
get_unfilled_required_vars() {
    local env="$1"
    local var_name
    local -a missing=()
    for var_name in "${ALL_VARIABLES[@]}"; do
        if ! is_var_required "$var_name" "$env"; then
            continue
        fi
        if has_wizard_config "$var_name"; then
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

save_configuration() {
    local project_dir="$1"
    local env="$2"
    local env_file
    env_file=$(get_environment_file "$project_dir" "$env")

    # Guarantee every required secret is present FIRST, so generatable secrets
    # (e.g. production LiveKit credentials) get their proper per-environment
    # treatment before apply_all_defaults — which uses the cross-environment
    # fallback — could otherwise fill them with the local dev defaults.
    generate_missing_required_secrets "$env"

    # Apply defaults for all remaining non-prompted variables.
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
                # UI-only synthetic var — never written to .env

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
        echo ""

        # Re-emit any custom variables the operator had in the prior .env
        # that the wizard schema doesn't know about — drop them, and you
        # silently lose the operator's manual config.
        if [[ ${#WIZARD_PASSTHROUGH_LINES[@]} -gt 0 ]]; then
            echo "# ============================================================================"
            echo "# Custom Variables (preserved from existing $env_file)"
            echo "# ============================================================================"
            local _line
            for _line in "${WIZARD_PASSTHROUGH_LINES[@]}"; do
                echo "$_line"
            done
            echo ""
        fi

        # Add admin credentials used during setup
        if [[ -n "$INITIAL_ADMIN_EMAIL_VALUE" ]] || [[ -n "$INITIAL_ADMIN_PASSWORD_VALUE" ]]; then
            echo "# ============================================================================"
            echo "# Initial Admin Credentials (from setup wizard)"
            echo "# ============================================================================"
            if [[ -n "$INITIAL_ADMIN_EMAIL_VALUE" ]]; then
                echo "INITIAL_ADMIN_EMAIL=\"$(escape_env_value "$INITIAL_ADMIN_EMAIL_VALUE")\""
            fi
            if [[ -n "$INITIAL_ADMIN_PASSWORD_VALUE" ]]; then
                echo "INITIAL_ADMIN_PASSWORD=\"$(escape_env_value "$INITIAL_ADMIN_PASSWORD_VALUE")\""
            fi
        fi

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
