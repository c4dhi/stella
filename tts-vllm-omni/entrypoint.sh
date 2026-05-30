#!/bin/bash
# Launch vllm-omni serving Voxtral from a local path.
#
# All knobs are environment-driven so the same image works across machines
# with different VRAM budgets (e.g. L4 at 24GB vs A10G at 24GB vs L40S at 48GB).

set -e

MODEL_PATH="${VOXTRAL_MODEL_PATH:-/models/voxtral}"
SERVED_NAME="${VOXTRAL_SERVED_NAME:-voxtral}"
PORT="${VLLM_PORT:-8000}"
# Default 0.5, NOT vLLM's usual 0.85. Voxtral TTS is a 2-stage model (LLM
# backbone + acoustic transformer) and BOTH stages need GPU memory. The sed
# below stamps this value into every stage in the YAML, so it applies per
# stage. At 0.85 the backbone grabs almost everything and the engine stalls
# after weight-load while bringing up stage 2 — it never binds :8000
# ("Application startup complete" never prints). 0.5/stage suits a 24GB card;
# operators with bigger/smaller VRAM tune it via VOXTRAL_GPU_MEMORY_UTILIZATION
# (settable in the config wizard).
GPU_UTIL="${VOXTRAL_GPU_MEMORY_UTILIZATION:-0.5}"
MAX_MODEL_LEN="${VOXTRAL_MAX_MODEL_LEN:-}"
# enforce-eager skips torch.compile/cudagraph capture. Default ON for a
# reliable first boot (cudagraph capture is a common startup-crash source on
# 24GB cards); flip VOXTRAL_ENFORCE_EAGER=false once the service is stable to
# recover the compiled-graph latency.
ENFORCE_EAGER="${VOXTRAL_ENFORCE_EAGER:-true}"

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

# Copy to a writable location so we can tune gpu_memory_utilization. The 2-stage
# YAML carries its own per-stage memory budget; the top-level
# --gpu-memory-utilization flag does not reliably reach both stages, so we patch
# the YAML the way the upstream recipe does.
TUNED_CONFIGS_PATH="/tmp/voxtral_tts.yaml"
cp "$STAGE_CONFIGS_PATH" "$TUNED_CONFIGS_PATH"
sed -i -E "s|^([[:space:]]*gpu_memory_utilization:[[:space:]]*).*|\1${GPU_UTIL}|g" "$TUNED_CONFIGS_PATH" || true

echo "[vllm-omni] Starting Voxtral via vllm-omni"
echo "[vllm-omni]   model_path           = $MODEL_PATH"
echo "[vllm-omni]   served_name          = $SERVED_NAME"
echo "[vllm-omni]   port                 = $PORT"
echo "[vllm-omni]   gpu_memory_util      = $GPU_UTIL"
echo "[vllm-omni]   stage_configs_path   = $STAGE_CONFIGS_PATH"
echo "[vllm-omni]   enforce_eager        = $ENFORCE_EAGER"
[ -n "$MAX_MODEL_LEN" ] && echo "[vllm-omni]   max_model_len        = $MAX_MODEL_LEN"

# NOTE: `vllm-omni serve`, NOT `vllm serve`. Plain vllm ignores --omni/--stage-
# configs-path and serves the backbone as a text model.
ARGS=(
    "$MODEL_PATH"
    --omni
    --stage-configs-path "$TUNED_CONFIGS_PATH"
    --served-model-name "$SERVED_NAME"
    --port "$PORT"
    --host 0.0.0.0
    --gpu-memory-utilization "$GPU_UTIL"
)

if [ -n "$MAX_MODEL_LEN" ]; then
    ARGS+=(--max-model-len "$MAX_MODEL_LEN")
fi

if [ "$ENFORCE_EAGER" = "true" ]; then
    ARGS+=(--enforce-eager)
fi

exec vllm-omni serve "${ARGS[@]}"
