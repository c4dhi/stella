#!/bin/bash
# Launch vllm-omni serving Voxtral from a local path.
#
# All knobs are environment-driven so the same image works across machines
# with different VRAM budgets (e.g. L4 at 24GB vs A10G at 24GB vs L40S at 48GB).

set -e

MODEL_PATH="${VOXTRAL_MODEL_PATH:-/models/voxtral}"
SERVED_NAME="${VOXTRAL_SERVED_NAME:-voxtral}"
PORT="${VLLM_PORT:-8000}"
# GPU memory for STAGE 0 — the LM (audio_generation) stage. This is the heavy
# tenant: it loads ~7.78GiB of weights plus the KV cache, so it needs the lion's
# share. Packaged default is 0.8; we default to 0.5 to leave room for stage 1
# AND a co-located STT pod on a shared 24GB card (L4/A10G). Do NOT go below ~0.4
# or stage 0 can't fit its weights. This value is applied ONLY to stage 0 (see
# the per-stage rewrite below) — the old "set every stage to one value" approach
# was the OOM bug: it forced the small acoustic stage to the same large fraction,
# so stage 1 couldn't fit after stage 0 had taken the card.
GPU_UTIL="${VOXTRAL_GPU_MEMORY_UTILIZATION:-0.5}"
# GPU memory for STAGE 1 — the acoustic (audio_tokenizer) stage. It is small;
# the packaged config uses 0.1. Leave BLANK to keep that packaged value (the
# safe default); set only to override on an unusual card.
ACOUSTIC_GPU_UTIL="${VOXTRAL_ACOUSTIC_GPU_MEMORY_UTILIZATION:-}"
MAX_MODEL_LEN="${VOXTRAL_MAX_MODEL_LEN:-}"
# enforce-eager skips torch.compile/cudagraph capture. Default ON for a
# reliable first boot (cudagraph capture is a common startup-crash source on
# 24GB cards); flip VOXTRAL_ENFORCE_EAGER=false once the service is stable to
# recover the compiled-graph latency.
ENFORCE_EAGER="${VOXTRAL_ENFORCE_EAGER:-true}"
# Grace period before the startup watchdog complains that the server still
# isn't serving. Must stay below the pod's liveness initialDelaySeconds (600s
# in k8s/09-tts-service.yaml) so the diagnostic lands in the logs before the
# kubelet kills the container. Raise it if your model is genuinely slow to load.
STARTUP_TIMEOUT="${VOXTRAL_STARTUP_TIMEOUT:-300}"

if [ ! -d "$MODEL_PATH" ]; then
    echo "[vllm-omni] ERROR: VOXTRAL_MODEL_PATH=$MODEL_PATH does not exist or is not a directory." >&2
    echo "[vllm-omni] The tts-service init container should have populated it. Check tts-service init logs." >&2
    exit 1
fi

# Sanity-check the model files. Mistral's native format ships
# consolidated.safetensors + params.json + tekken.json — if any are
# missing the download was partial and vllm will fail with a confusing error.
for f in consolidated.safetensors params.json tekken.json; do
    if [ ! -f "$MODEL_PATH/$f" ]; then
        echo "[vllm-omni] ERROR: required file $MODEL_PATH/$f is missing." >&2
        echo "[vllm-omni] Delete $MODEL_PATH on the PVC and let the init container re-download." >&2
        exit 1
    fi
done

# Voxtral-4B-TTS-2603 is a 2-stage model (LLM backbone + acoustic transformer).
# vllm-omni's auto-detect for this is broken in the 0.18.x wheel: without an
# explicit --stage-configs-path it falls back to plain MistralForCausalLM and
# crashes with "acoustic_transformer not found" (vllm-omni issue #3571). So we
# MUST locate the bundled voxtral_tts.yaml and pass it. The path moved between
# versions (model_executor/stage_configs/ vs deploy/), so discover it instead
# of hardcoding. Override with VOXTRAL_STAGE_CONFIGS_PATH if needed.
STAGE_CONFIGS_PATH="${VOXTRAL_STAGE_CONFIGS_PATH:-}"
if [ -z "$STAGE_CONFIGS_PATH" ]; then
    STAGE_CONFIGS_PATH=$(python3 - <<'PY'
import os, glob, vllm_omni
root = os.path.dirname(vllm_omni.__file__)
hits = glob.glob(os.path.join(root, "**", "voxtral_tts*.yaml"), recursive=True)
print(hits[0] if hits else "")
PY
)
fi

if [ -z "$STAGE_CONFIGS_PATH" ] || [ ! -f "$STAGE_CONFIGS_PATH" ]; then
    echo "[vllm-omni] ERROR: could not locate the Voxtral stage-configs YAML (voxtral_tts.yaml)." >&2
    echo "[vllm-omni] Set VOXTRAL_STAGE_CONFIGS_PATH explicitly. Without it the loader" >&2
    echo "[vllm-omni] falls back to MistralForCausalLM and crashes (acoustic_transformer not found)." >&2
    exit 1
fi

# Copy to a writable location and rewrite the PER-STAGE gpu_memory_utilization.
#
# CRITICAL: this model ships an ASYMMETRIC split — stage 0 (the LM) takes the
# large share because it holds the KV cache; stage 1 (acoustic) only ~0.1. CLI
# flags like --gpu-memory-utilization do NOT reach the stages (the YAML wins —
# proven by stage 0 capturing CUDA graphs despite --enforce-eager), so the YAML
# is the only authoritative control. We edit each stage individually BY
# stage_id, leaving stage 1 at the packaged value unless explicitly overridden.
# This must be structural (PyYAML), not sed: both stages have an identical
# gpu_memory_utilization: line and only parsing can tell them apart. The old
# blanket sed forced both stages to one value and caused the stage-1 OOM.
TUNED_CONFIGS_PATH="/tmp/voxtral_tts.yaml"
cp "$STAGE_CONFIGS_PATH" "$TUNED_CONFIGS_PATH"
STAGE_UTILS=$(python3 - "$TUNED_CONFIGS_PATH" "$GPU_UTIL" "$ACOUSTIC_GPU_UTIL" <<'PY'
import sys, yaml
path, s0, s1 = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    cfg = yaml.safe_load(f)
applied = {}
for st in cfg.get("stage_args", []) or []:
    sid = st.get("stage_id")
    ea = st.setdefault("engine_args", {})
    if sid == 0 and s0:
        ea["gpu_memory_utilization"] = float(s0)
    elif sid == 1 and s1:
        ea["gpu_memory_utilization"] = float(s1)
    if sid is not None:
        applied[sid] = ea.get("gpu_memory_utilization")
with open(path, "w") as f:
    yaml.safe_dump(cfg, f, sort_keys=False)
print(" ".join("stage%s=%s" % (k, applied[k]) for k in sorted(applied)))
PY
) || STAGE_UTILS=""
if [ -z "$STAGE_UTILS" ]; then
    echo "[vllm-omni] WARNING: could not rewrite per-stage gpu_memory_utilization;" >&2
    echo "[vllm-omni] using the packaged values (stage0=0.8 stage1=0.1)." >&2
fi

echo "[vllm-omni] Starting Voxtral via vllm-omni"
echo "[vllm-omni]   model_path           = $MODEL_PATH"
echo "[vllm-omni]   served_name          = $SERVED_NAME"
echo "[vllm-omni]   port                 = $PORT"
echo "[vllm-omni]   per-stage gpu_util   = ${STAGE_UTILS:-packaged defaults}"
echo "[vllm-omni]   stage_configs_path   = $STAGE_CONFIGS_PATH"
echo "[vllm-omni]   enforce_eager        = $ENFORCE_EAGER (note: stage values come from the YAML)"
[ -n "$MAX_MODEL_LEN" ] && echo "[vllm-omni]   max_model_len        = $MAX_MODEL_LEN"

# NOTE: `vllm-omni serve`, NOT `vllm serve`. Plain vllm ignores --omni/--stage-
# configs-path and serves the backbone as a text model.
#
# We deliberately do NOT pass --gpu-memory-utilization: it does not reach the
# per-stage engines (the stage YAML is authoritative), and passing it only
# muddies the logs by implying a single global value that isn't actually used.
ARGS=(
    "$MODEL_PATH"
    --omni
    --stage-configs-path "$TUNED_CONFIGS_PATH"
    --served-model-name "$SERVED_NAME"
    --port "$PORT"
    --host 0.0.0.0
)

if [ -n "$MAX_MODEL_LEN" ]; then
    ARGS+=(--max-model-len "$MAX_MODEL_LEN")
fi

if [ "$ENFORCE_EAGER" = "true" ]; then
    ARGS+=(--enforce-eager)
fi

# ---------------------------------------------------------------------------
# Startup watchdog.
#
# This model's signature failure is a SILENT stall, not a crash: the engine
# loads the weights, prints "Loading safetensors ... 100%", then hangs while
# bringing up the second stage and never binds the API port — so the only
# clue in the logs is silence and the /health probe gets connection-refused
# until the pod is killed. Almost always the cause is GPU-memory
# over-subscription (gpu_memory_utilization is applied PER STAGE on this
# 2-stage model). We fork a watcher BEFORE exec so it survives as a child of
# the server process; it polls /health and, if nothing is serving after the
# grace period, prints an actionable diagnostic (with a live GPU snapshot)
# instead of leaving the operator staring at a silent log. It self-corrects
# the log if the start was merely slow.
# ---------------------------------------------------------------------------
voxtral_startup_watchdog() {
    local waited=0
    local limit=$((STARTUP_TIMEOUT * 3))   # keep watching well past the warning
    local warned=false
    local health="http://127.0.0.1:${PORT}/health"
    while [ "$waited" -lt "$limit" ]; do
        if python3 -c "import urllib.request,sys; urllib.request.urlopen('${health}', timeout=2)" 2>/dev/null; then
            if [ "$warned" = "true" ]; then
                echo "[vllm-omni] Recovered: serving on :${PORT} after ${waited}s — it was just slow to load, not stalled." >&2
            fi
            return 0
        fi
        if [ "$warned" = "false" ] && [ "$waited" -ge "$STARTUP_TIMEOUT" ]; then
            warned=true
            {
                echo ""
                echo "[vllm-omni] ============================================================"
                echo "[vllm-omni] STARTUP STALLED: not serving on :${PORT} after ${STARTUP_TIMEOUT}s."
                echo "[vllm-omni] If you never saw 'Application startup complete' above, the"
                echo "[vllm-omni] engine loaded the weights but never bound the API port."
                echo "[vllm-omni]"
                echo "[vllm-omni] Most likely cause: GPU memory over-subscription. Voxtral TTS"
                echo "[vllm-omni] runs as TWO stages on this GPU, in effect: stage 0 (the LM)"
                echo "[vllm-omni] then stage 1 (acoustic). Per-stage budgets in use: ${STAGE_UTILS:-packaged}."
                echo "[vllm-omni] If stage 0 (or a co-located STT pod) takes too much, stage 1"
                echo "[vllm-omni] can't fit and initialization fails here ('Free memory on device"
                echo "[vllm-omni] ... is less than desired GPU memory utilization')."
                echo "[vllm-omni]"
                echo "[vllm-omni] GPU memory right now:"
                nvidia-smi --query-gpu=memory.total,memory.used,memory.free \
                    --format=csv,noheader 2>/dev/null | sed 's/^/[vllm-omni]   /' \
                    || echo "[vllm-omni]   (nvidia-smi unavailable)"
                echo "[vllm-omni]"
                echo "[vllm-omni] Fix: lower stage 0 via VOXTRAL_GPU_MEMORY_UTILIZATION (it is"
                echo "[vllm-omni] the heavy stage; try 0.45-0.5) in the config wizard or the"
                echo "[vllm-omni] stella-ai-config ConfigMap, then redeploy. Do NOT go below ~0.4"
                echo "[vllm-omni] or stage 0 can't load its weights. Freeing a co-located STT pod"
                echo "[vllm-omni] off this GPU also helps. (Stage 1 default 0.1 rarely needs tuning;"
                echo "[vllm-omni] override with VOXTRAL_ACOUSTIC_GPU_MEMORY_UTILIZATION if needed.)"
                echo "[vllm-omni] If the GPU snapshot shows plenty free, it is NOT memory — raise"
                echo "[vllm-omni] VOXTRAL_STARTUP_TIMEOUT (model just slow) or check the stage config."
                echo "[vllm-omni] ============================================================"
                echo ""
            } >&2
        fi
        sleep 5
        waited=$((waited + 5))
    done
}
voxtral_startup_watchdog &

exec vllm-omni serve "${ARGS[@]}"
