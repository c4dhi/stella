#!/usr/bin/env bash
#
# Full-system backup export (#378) — wizard/deploy layer.
#
# Triggers the in-pod data export (database + agent packages), folds in this
# deployment's .env config, optionally encrypts the whole bundle, and writes a
# single artifact you can carry to new hardware.
#
#   ./scripts/backup-export.sh [--out FILE] [--include-metrics]
#                              [--production|--local] [--encrypt]
#
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/colors.sh"
# shellcheck source=/dev/null
source "$LIB_DIR/utils.sh"       # environment.sh depends on ensure_dir() from here
# shellcheck source=/dev/null
source "$LIB_DIR/environment.sh"

# This script runs on the deploy host and needs the same toolchain the STELLA
# wizard/deploy already requires. Fail fast with clear, actionable next steps.
require_host_tools() {
    local need_node="" need_kubectl=""
    { command -v node && command -v npx; } >/dev/null 2>&1 || need_node="1"
    command -v kubectl >/dev/null 2>&1 || need_kubectl="1"
    [[ -z "$need_node$need_kubectl" ]] && return 0

    error "Can't run the backup — required tools are missing on this machine."
    echo
    local mac=""; [[ "$(uname -s)" == "Darwin" ]] && mac="1"
    if [[ -n "$need_node" ]]; then
        echo -e "  ${RED:-}✗${NC:-} Node.js (provides 'node' and 'npx') — runs the backup helper that"
        echo -e "    packages the bundle and handles encryption."
        if [[ -n "$mac" ]]; then
            echo -e "      → Install:  ${BOLD:-}brew install node${NC:-}"
        else
            echo -e "      → Install:  ${BOLD:-}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs${NC:-}"
        fi
    fi
    if [[ -n "$need_kubectl" ]]; then
        echo -e "  ${RED:-}✗${NC:-} kubectl — talks to the cluster the deployment runs on."
        if [[ -n "$mac" ]]; then
            echo -e "      → Install:  ${BOLD:-}brew install kubectl${NC:-}"
        else
            echo -e "      → Install:  ${BOLD:-}https://kubernetes.io/docs/tasks/tools/${NC:-}"
        fi
    fi
    echo
    echo -e "  These are the same tools STELLA needs to deploy, so installing them also"
    echo -e "  unblocks normal setup. Install the above, then re-run this command."
    exit 1
}
require_host_tools

# Ready replica count for a deployment (0 if absent/not ready).
deployment_ready() {
    local n
    n="$(kubectl get deploy "$1" -n "$KUBERNETES_NAMESPACE" \
            -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
    echo "${n:-0}"
}

OUT=""
INCLUDE_METRICS=""
ENCRYPT=""
export ENV_FLAG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out) OUT="$2"; shift 2 ;;
        --include-metrics) INCLUDE_METRICS="--include-metrics"; shift ;;
        --encrypt) ENCRYPT="true"; shift ;;
        --production) ENV_FLAG="production"; shift ;;
        --local) ENV_FLAG="local"; shift ;;
        -h|--help)
            echo "Usage: $0 [--out FILE] [--include-metrics] [--production|--local] [--encrypt]"
            exit 0 ;;
        *) error "Unknown argument: $1"; exit 1 ;;
    esac
done

setup_directories
set_defaults
load_environment

ENV_FILE="$PROJECT_DIR/.env.$([[ "$NODE_ENV" == "production" ]] && echo production || echo local)"
if [[ ! -f "$ENV_FILE" ]]; then
    error "Config file not found: $ENV_FILE (run the setup wizard first)"
    exit 1
fi

# Preflight: a backup is a LOGICAL export, so it needs a LIVE system — Postgres
# must be serving the database, and the export engine runs inside the backend
# pod. A wound-down deployment cannot be exported; warn clearly instead of
# failing with an obscure kubectl error.
PG_READY="$(deployment_ready postgres)"
BACKEND_READY="$(deployment_ready session-management-server)"
if [[ "${PG_READY:-0}" -lt 1 || "${BACKEND_READY:-0}" -lt 1 ]]; then
    error "The deployment is not running — export needs a live system."
    echo
    echo -e "  A backup is a logical export: the database must be served by a running"
    echo -e "  Postgres, and the export engine runs in the backend pod. (The agent"
    echo -e "  packages and config are just files, but the database is not.)"
    echo
    echo -e "  Status in namespace '$KUBERNETES_NAMESPACE':"
    echo -e "    Postgres (database) : $([[ "${PG_READY:-0}" -ge 1 ]] && echo running || echo 'NOT running')"
    echo -e "    Backend (engine)    : $([[ "${BACKEND_READY:-0}" -ge 1 ]] && echo running || echo 'NOT running')"
    echo
    echo -e "  Bring the system up first (e.g. ./scripts/start-k8s.sh${ENV_FLAG:+ --$ENV_FLAG}),"
    echo -e "  or scale these deployments up, then re-run the export. A fully"
    echo -e "  wound-down deployment cannot be exported."
    exit 1
fi

# Resolve the running backend pod (only the pod can see both DB and packages).
POD="$(kubectl get pod -n "$KUBERNETES_NAMESPACE" -l app=session-management-server \
        --field-selector=status.phase=Running \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -z "$POD" ]]; then
    error "No running backend pod found in namespace '$KUBERNETES_NAMESPACE'. Deploy first."
    exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
[[ -z "$OUT" ]] && OUT="$PROJECT_DIR/stella-backup-${STAMP}.zip"

PASSPHRASE=""
if [[ "$ENCRYPT" == "true" ]]; then
    read -r -s -p "Encryption passphrase: " PASSPHRASE; echo
    read -r -s -p "Confirm passphrase: " PASSPHRASE2; echo
    [[ "$PASSPHRASE" != "$PASSPHRASE2" ]] && { error "Passphrases do not match"; exit 1; }
    [[ -z "$PASSPHRASE" ]] && { error "Empty passphrase"; exit 1; }
    [[ "$OUT" != *.enc ]] && OUT="${OUT}.enc"
fi

POD_DATA="/tmp/stella-backup-data-${STAMP}.zip"
LOCAL_DATA="$(mktemp -d)/data.zip"

info "${EMOJI_GEAR:-} Exporting data from pod $POD ..."
kubectl exec -n "$KUBERNETES_NAMESPACE" "$POD" -- \
    node dist/src/backup/backup.cli.js export --out "$POD_DATA" $INCLUDE_METRICS

kubectl cp "$KUBERNETES_NAMESPACE/$POD:$POD_DATA" "$LOCAL_DATA"
kubectl exec -n "$KUBERNETES_NAMESPACE" "$POD" -- rm -f "$POD_DATA" 2>/dev/null || true

info "Embedding deployment config${PASSPHRASE:+ and encrypting} ..."
BACKUP_PASSPHRASE="$PASSPHRASE" \
    npx ts-node "$SCRIPT_DIR/backup-bundle.ts" finalize "$LOCAL_DATA" "$ENV_FILE" "$OUT"

rm -f "$LOCAL_DATA" 2>/dev/null || true
success "Backup written: $OUT"
echo -e "  ${DIM:-}Keep it secure — it contains secrets${PASSPHRASE:+ (encrypted)}.${NC:-}"
