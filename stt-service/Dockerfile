# STT Service Dockerfile
# Supports multiple providers:
# - Sherpa-ONNX: Lightweight streaming model (~180MB) - default
# - faster-whisper: GPU-accelerated model (~3GB for large-v3) - requires ENABLE_GPU=true
#
# Build args:
#   ENABLE_GPU=true - Use NVIDIA CUDA base image with GPU dependencies
#   ENABLE_GPU=false (default) - Use python:slim for CPU-only builds

ARG ENABLE_GPU=false

# ============================================================================
# CPU-only base image
# ============================================================================
FROM python:3.11-slim AS base-cpu

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    curl \
    ca-certificates \
    libgomp1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# ============================================================================
# GPU base image (NVIDIA CUDA 12.6 - compatible with driver 13.0+)
# ============================================================================
FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04 AS base-gpu

WORKDIR /app

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Install Python 3.11 and system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    software-properties-common \
    tzdata \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    python3-pip \
    build-essential \
    wget \
    curl \
    ca-certificates \
    libgomp1 \
    git \
    && ln -sf /usr/bin/python3.11 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && python3 -m pip install --upgrade pip \
    && rm -rf /var/lib/apt/lists/*

# CUDA environment (set by NVIDIA base image, but ensure they're available)
ENV CUDA_HOME=/usr/local/cuda
ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH}
ENV PATH=/usr/local/cuda/bin:${PATH}

# ============================================================================
# Final image - select base based on ENABLE_GPU
# ============================================================================
ARG ENABLE_GPU
FROM base-cpu AS final-false
FROM base-gpu AS final-true
FROM final-${ENABLE_GPU} AS final

WORKDIR /app

# ============================================================================
# Base requirements (always installed - for Sherpa-ONNX)
# ============================================================================
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ============================================================================
# GPU requirements (only when ENABLE_GPU=true - for faster-whisper)
# ============================================================================
ARG ENABLE_GPU
COPY requirements-gpu.txt .
RUN if [ "$ENABLE_GPU" = "true" ]; then \
        echo "[STT] Installing GPU dependencies (faster-whisper, torch, ctranslate2)..." && \
        pip install --no-cache-dir -r requirements-gpu.txt && \
        pip install --no-cache-dir onnxruntime-gpu>=1.16.0 && \
        echo "[STT] GPU dependencies installed successfully"; \
    else \
        echo "[STT] Installing onnxruntime (CPU)..." && \
        pip install --no-cache-dir onnxruntime>=1.16.0; \
    fi

# ============================================================================
# Proto compilation
# ============================================================================
COPY proto/ ./proto/
RUN python -m grpc_tools.protoc \
    -I./proto \
    --python_out=. \
    --grpc_python_out=. \
    proto/stt.proto

# ============================================================================
# Model download scripts (models are downloaded at runtime via init container)
# ============================================================================
# Models are stored on PersistentVolume, not in the image.
# This keeps the image slim (~500MB instead of ~4GB for GPU builds).
# The init container runs these scripts to populate the PV on first startup.
COPY download_sherpa_model.py download_whisper_model.py download_silero_vad.py ./

# Environment defaults for cache directories (mounted from PV at runtime)
ENV WHISPER_MODEL=large-v3
ENV WHISPER_CACHE_DIR=/root/.cache/whisper
ENV SILERO_VAD_CACHE_DIR=/root/.cache/silero-vad

# ============================================================================
# Application code
# ============================================================================
COPY src/ ./src/

# ============================================================================
# Environment defaults
# ============================================================================
ENV PYTHONUNBUFFERED=1
ENV GRPC_PORT=50051

# STT Provider selection
# - 'sherpa' (default): Lightweight CPU model
# - 'whisper': GPU-accelerated model (requires ENABLE_GPU=true build)
ENV STT_PROVIDER=sherpa

# Sherpa-ONNX configuration
ENV SHERPA_ONNX_CACHE_DIR=/root/.cache/sherpa-onnx
ENV ONNX_PROVIDER=CPUExecutionProvider

# faster-whisper configuration (only used when STT_PROVIDER=whisper)
ENV WHISPER_CACHE_DIR=/root/.cache/whisper
ENV WHISPER_DEVICE=cpu
ENV WHISPER_COMPUTE_TYPE=int8
ENV WHISPER_BEAM_SIZE=5
ENV WHISPER_LANGUAGE=

# Silero VAD configuration (for whisper provider)
ENV SILERO_VAD_CACHE_DIR=/root/.cache/silero-vad

# ============================================================================
# Whisper VAD configuration (Silero VAD - neural network based)
# ============================================================================
ENV VAD_THRESHOLD=0.6
ENV VAD_MIN_SILENCE_MS=800
ENV VAD_MIN_SPEECH_MS=300
ENV PARTIAL_INTERVAL_MS=1000
ENV VAD_CONTINUATION_WINDOW_MS=400
ENV VAD_MIN_FINAL_MS=500
ENV VAD_PRE_BUFFER_MS=500

# Timeout protection (prevents indefinite speech accumulation)
ENV VAD_MAX_SPEECH_DURATION_MS=15000
ENV VAD_STALE_PARTIAL_TIMEOUT_MS=3000

# End-of-speech delta detection (multi-signal detection)
ENV VAD_EOS_HISTORY_FRAMES=20
ENV VAD_EOS_PROB_DROP=0.15
ENV VAD_EOS_ENERGY_DROP=0.4
ENV VAD_EOS_FLUX_STABLE=0.05
ENV VAD_EOS_MIN_SIGNALS=2

# Energy gating for speech start
ENV VAD_START_THRESHOLD=0.7
ENV VAD_ENERGY_SNR_MARGIN=2.5
ENV VAD_MIN_START_FRAMES=4

# Spectral gating (noise reduction)
ENV VAD_ENABLE_SPECTRAL_GATE=true

# ============================================================================
# Sherpa VAD configuration (RMS-based - energy detection)
# ============================================================================
ENV SHERPA_SILENCE_THRESHOLD=1.5
ENV SHERPA_SPEECH_TIMEOUT=10.0
ENV SHERPA_RMS_THRESHOLD=0.001
ENV SHERPA_PRE_BUFFER_SAMPLES=8000
ENV SHERPA_MIN_TRANSCRIPT_CHARS=3

# Expose gRPC port
EXPOSE 50051

# Run the server
CMD ["python", "-u", "src/stt_server.py"]
