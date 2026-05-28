# tts-vllm-omni — sidecar image that serves Voxtral via vllm-omni.
#
# This image is consumed by the TTS pod (see k8s/09-tts-service.yaml) only
# when TTS_PROVIDER=voxtral. It exposes vllm's OpenAI-compatible HTTP API
# on :8000, and tts-service talks to it over localhost.
#
# Why a dedicated image and not a runtime `pip install`:
#   - vllm + vllm-omni pull ~GBs of CUDA-tied wheels; doing that on every
#     pod start is fragile and slow (5-10 min cold install on a fresh node).
#   - Baking the deps lets the operator pin a known-good vllm-omni version.
#
# LICENSE: vllm/vllm-omni are Apache-2.0. The Voxtral model weights this
# image *loads* at runtime are CC-BY-NC-4.0 — STELLA does not bundle them
# (they live on the PVC, downloaded by the tts-service init container).

# vllm publishes an official OpenAI-API image; vllm-omni is an additive
# extension installed on top. Pin to a tested baseline — operators can
# override with --build-arg VLLM_BASE_TAG=... once a newer combo is verified.
ARG VLLM_BASE_TAG=v0.7.3
FROM vllm/vllm-openai:${VLLM_BASE_TAG}

# vllm-omni adds the `--omni` flag and the audio-output pipeline. The model
# card pins >=0.18.0; we keep the lower bound the same.
ARG VLLM_OMNI_VERSION=">=0.18.0"
RUN pip install --no-cache-dir "vllm-omni${VLLM_OMNI_VERSION}"

# Voxtral uses mistral_common for tokenization; install it explicitly so
# we don't depend on vllm-omni's transitive deps resolving to a working
# version.
RUN pip install --no-cache-dir "mistral_common>=1.10.0"

# Defaults — overridden by env / args from the k8s manifest.
ENV VLLM_PORT=8000
ENV VOXTRAL_MODEL_PATH=/models/voxtral
ENV VOXTRAL_SERVED_NAME=voxtral
ENV VOXTRAL_GPU_MEMORY_UTILIZATION=0.85

# The vllm/vllm-openai base sets its own entrypoint to `python -m vllm.entrypoints.openai.api_server`.
# Override with a small wrapper so we can pass `--omni` and read settings from env.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
