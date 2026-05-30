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
# extension installed on top. CRITICAL: the base tag MUST match the vLLM
# version that vllm-omni was built against, or the install becomes incoherent.
#
# Why: vllm-omni's version tracks upstream vLLM (e.g. vllm-omni 0.18.x rebases
# onto vLLM 0.18.x). Layering vllm-omni>=0.18.0 onto an old base (we used
# v0.7.3) pip-upgrades transformers and pulls a torchvision that no longer
# matches the base's torch — producing the two import crashes we saw:
#   - transformers <-> vLLM mismatch (ProcessorMixin import fails)
#   - torch <-> torchvision mismatch (torchvision::nms missing)
# Voxtral-4B-TTS-2603 also simply needs vLLM >= 0.18 to load at all.
#
# The fix is NOT to hand-pin torch/torchvision/transformers — the
# vllm/vllm-openai:vX.Y.Z image already ships a self-consistent set built
# against that exact vLLM. Match the base tag to the vllm-omni version and
# both errors disappear at once. v0.18.1 is built against torch 2.10.0, which
# is the combo verified working for Voxtral TTS.
ARG VLLM_BASE_TAG=v0.18.1
FROM vllm/vllm-openai:${VLLM_BASE_TAG}

# vllm-omni adds the `vllm-omni serve` CLI, the `--omni` flag, and the
# audio-output pipeline. Pin EXACTLY (==, not >=) to stay coherent with the
# base's vLLM — a floating lower bound is what let an incompatible build slip
# in before. 0.18.0 is the release verified against vLLM 0.18.1 for Voxtral TTS.
ARG VLLM_OMNI_VERSION="==0.18.0"
RUN pip install --no-cache-dir "vllm-omni${VLLM_OMNI_VERSION}"

# Voxtral uses mistral_common for tokenization (and needs SpeechRequest
# support for TTS). It normally arrives transitively, but pin a floor so a
# stale resolution can't break tokenization.
RUN pip install --no-cache-dir "mistral_common>=1.10.0"

# Fail the build NOW (not at pod start on the GPU node) if the stack is
# incoherent. This is the cheap guard that would have caught the v0.7.3 base:
# if these imports succeed the torch/torchvision/transformers/vLLM set is
# self-consistent.
RUN python -c "import vllm, vllm_omni, torch, torchvision, transformers, mistral_common; \
print('vllm', vllm.__version__, '| torch', torch.__version__, \
'| torchvision', torchvision.__version__, '| transformers', transformers.__version__)"

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
