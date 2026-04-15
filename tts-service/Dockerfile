# TTS Service Dockerfile
# Supports Edge TTS (cloud) and Kokoro (local ONNX) providers
# Build arg ENABLE_GPU=true for CUDA support

ARG ENABLE_GPU=false

# ============================================================================
# CPU-only base image
# ============================================================================
FROM python:3.11-slim AS base-cpu

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    curl \
    ca-certificates \
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
    libsndfile1 \
    ffmpeg \
    curl \
    ca-certificates \
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

# TTS_PROVIDER build arg controls which dependencies are installed.
# "all" (default) installs everything for maximum flexibility.
# "piper" installs only Piper + ONNX (lightest, ~60MB model, fastest build).
# "chatterbox" installs ChatterBox + PyTorch + ONNX (heavy, ~2GB model).
# "kokoro" installs Kokoro + ONNX (medium).
ARG TTS_PROVIDER=all

# Copy requirements and install base Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install ONNX Runtime (needed by piper and kokoro)
ARG ENABLE_GPU
RUN if [ "$TTS_PROVIDER" = "chatterbox" ]; then \
        echo "[TTS] Skipping ONNX Runtime (not needed for chatterbox-only)"; \
    elif [ "$ENABLE_GPU" = "true" ]; then \
        echo "[TTS] Installing onnxruntime-gpu..." && \
        pip install --no-cache-dir onnxruntime-gpu>=1.16.0; \
    else \
        echo "[TTS] Installing onnxruntime (CPU)..." && \
        pip install --no-cache-dir onnxruntime>=1.16.0; \
    fi

# Install ChatterBox dependencies (only when provider is chatterbox or all)
RUN if [ "$TTS_PROVIDER" = "chatterbox" ] || [ "$TTS_PROVIDER" = "all" ]; then \
        echo "[TTS] Installing ChatterBox dependencies..." && \
        pip install --no-cache-dir \
            conformer \
            diffusers \
            librosa \
            omegaconf \
            pykakasi \
            pyloudnorm \
            resemble-perth \
            s3tokenizer \
            safetensors \
            spacy-pkuseg \
            transformers && \
        pip install --no-cache-dir --no-deps chatterbox-tts>=0.1.6; \
    else \
        echo "[TTS] Skipping ChatterBox dependencies (TTS_PROVIDER=$TTS_PROVIDER)"; \
    fi

# Install PyTorch (needed by ChatterBox only)
RUN if [ "$TTS_PROVIDER" = "chatterbox" ] || [ "$TTS_PROVIDER" = "all" ]; then \
        if [ "$ENABLE_GPU" = "true" ]; then \
            echo "[TTS] Installing PyTorch with CUDA..." && \
            pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121; \
        else \
            echo "[TTS] Installing PyTorch (CPU)..." && \
            pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu; \
        fi; \
    else \
        echo "[TTS] Skipping PyTorch (TTS_PROVIDER=$TTS_PROVIDER)"; \
    fi

# Model download scripts (models are downloaded at runtime via init container)
# Models are stored on PersistentVolume, not in the image.
# This keeps the image slim. The init container runs these scripts
# to populate the PV on first startup.
COPY download_kokoro_models.py .
COPY download_piper_models.py .
COPY download_chatterbox_models.py .

# Generate gRPC code from proto
COPY proto/ ./proto/
RUN python -m grpc_tools.protoc \
    -I./proto \
    --python_out=. \
    --grpc_python_out=. \
    ./proto/tts.proto

# Copy source code
COPY src/ ./src/

# Copy voice prompts for ChatterBox voice cloning (if any exist)
COPY voice_prompt[s]/ /app/voice_prompts/

# Environment defaults
ENV TTS_PROVIDER=piper
ENV ONNX_PROVIDER=CPUExecutionProvider
ENV GRPC_PORT=50052
ENV KOKORO_CACHE_DIR=/root/.cache/kokoro
ENV PIPER_CACHE_DIR=/root/.cache/piper
ENV CHATTERBOX_CACHE_DIR=/root/.cache/chatterbox
ENV PYTHONUNBUFFERED=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import grpc; channel = grpc.insecure_channel('localhost:50052'); grpc.channel_ready_future(channel).result(timeout=5)" || exit 1

EXPOSE 50052

CMD ["python", "src/tts_server.py"]
