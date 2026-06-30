#!/usr/bin/env bash
#
# Guided Backup & Restore wizard (#378).
#
# A thin interactive menu over the standalone backup-export.sh /
# backup-restore.sh scripts, so an operator can back up or relocate the system
# without remembering flags. The scripts themselves still do all the real work
# (preflights, passphrase prompts, confirmations) — this only collects the
# high-level choices and dispatches.
#
# Entry point: run_backup_wizard "$ENV_FLAG"

run_backup_wizard() {
    local env_flag="${1:-}"
    local env_arg=""
    [[ -n "$env_flag" ]] && env_arg="--$env_flag"

    # This file lives in scripts/lib/ — the backup scripts are one level up.
    local scripts_dir
    scripts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    wizard_clear_screen 2>/dev/null || true
    echo -e "\n  ${BOLD}STELLA — Backup & Restore${NC}"
    echo -e "  ${DIM}Export the whole deployment to a portable bundle, or restore one onto this machine.${NC}\n"

    local action
    action="$(wizard_select_input \
        "What would you like to do?" \
        "Export creates a bundle to keep or move. Restore OVERWRITES this deployment from a bundle." \
        "Export" \
        "Export,Restore,Cancel")"

    case "$action" in
        Export)
            local enc met
            enc="$(wizard_boolean_input \
                "Encrypt the bundle with a passphrase?" \
                "Recommended — the bundle contains all secrets. You'll be prompted for the passphrase." \
                "true")"
            met="$(wizard_boolean_input \
                "Include metrics & logs?" \
                "Larger bundle; usually not needed to restore a working system." \
                "false")"

            local args=()
            [[ -n "$env_arg" ]] && args+=("$env_arg")
            [[ "$enc" == "true" ]] && args+=("--encrypt")
            [[ "$met" == "true" ]] && args+=("--include-metrics")

            echo
            info "Starting export — the system must be running."
            echo
            "$scripts_dir/backup-export.sh" "${args[@]}"
            ;;

        Restore)
            local bundle
            bundle="$(wizard_text_input \
                "Path to the backup bundle" \
                "e.g. ./stella-backup-20260101-120000.zip (or .zip.enc)" \
                "" "")"
            if [[ -z "$bundle" ]]; then
                error "No bundle path provided — aborting restore."
                return 1
            fi
            if [[ ! -f "$bundle" ]]; then
                error "File not found: $bundle"
                return 1
            fi

            local args=("--in" "$bundle")
            [[ -n "$env_arg" ]] && args+=("$env_arg")

            echo
            warning "Restore OVERWRITES all data and config in this deployment."
            info "You'll be asked to confirm (and for the passphrase, if encrypted) before anything changes."
            echo
            "$scripts_dir/backup-restore.sh" "${args[@]}"
            ;;

        *)
            info "Cancelled — nothing was changed."
            ;;
    esac
}
