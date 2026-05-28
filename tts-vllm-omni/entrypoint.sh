#!/bin/bash
# Launch vllm-omni serving Voxtral from a local path.
#
# All knobs are environment-driven so the same image works across machines
# with different VRAM budgets (e.g. L4 at 24GB vs A10G at 24GB vs L40S at 48GB).

set -e

MODEL_PATH="${VOXTRAL_MODEL_PATH:-/models/voxtral}"
SERVED_NAME="${VOXTRAL_SERVED_NAME:-voxtral}"
PORT="${VLLM_PORT:-8000}"
GPU_UTIL="${VOXTRAL_GPU_MEMORY_UTILIZATION:-0.85}"
MAX_MODEL_LEN="${VOXTRAL_MAX_MODEL_LEN:-}"

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

echo "[vllm-omni] Starting Voxtral via vllm-omni"
echo "[vllm-omni]   model_path           = $MODEL_PATH"
echo "[vllm-omni]   served_name          = $SERVED_NAME"
echo "[vllm-omni]   port                 = $PORT"
echo "[vllm-omni]   gpu_memory_util      = $GPU_UTIL"
[ -n "$MAX_MODEL_LEN" ] && echo "[vllm-omni]   max_model_len        = $MAX_MODEL_LEN"

ARGS=(
    "$MODEL_PATH"
    --omni
    --served-model-name "$SERVED_NAME"
    --port "$PORT"
    --host 0.0.0.0
    --gpu-memory-utilization "$GPU_UTIL"
)

if [ -n "$MAX_MODEL_LEN" ]; then
    ARGS+=(--max-model-len "$MAX_MODEL_LEN")
fi

exec vllm serve "${ARGS[@]}"
