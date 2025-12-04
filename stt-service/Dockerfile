# STT Service Dockerfile
# Supports multiple providers:
# - Sherpa-ONNX: Lightweight streaming model (~180MB) - default
# - faster-whisper: GPU-accelerated model (~3GB for large-v3) - requires ENABLE_GPU=true
#
# Build args:
#   ENABLE_GPU=true - Install CUDA libs and GPU dependencies
#   WHISPER_MODEL=large-v3 - Whisper model to pre-download (only when ENABLE_GPU=true)

ARG ENABLE_GPU=false

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies and conditional CUDA libraries
ARG ENABLE_GPU
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    curl \
    gnupg \
    ca-certificates \
    libgomp1 \
    git \
    && if [ "$ENABLE_GPU" = "true" ]; then \
        echo "[STT] Installing CUDA libraries for GPU support..." && \
        curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/3bf863cc.pub | gpg --dearmor -o /usr/share/keyrings/cuda-archive-keyring.gpg && \
        echo "deb [signed-by=/usr/share/keyrings/cuda-archive-keyring.gpg] https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/ /" > /etc/apt/sources.list.d/cuda.list && \
        apt-get update && \
        apt-get install -y --no-install-recommends \
            cuda-cudart-12-4 \
            libcublas-12-4 \
            libcurand-12-4 \
            libcufft-12-4 \
            libcudnn9-cuda-12 \
        && echo "[STT] CUDA libraries installed successfully"; \
    else \
        echo "[STT] Building CPU-only image (ENABLE_GPU=false)"; \
    fi \
    && rm -rf /var/lib/apt/lists/*

# Set CUDA library paths for GPU builds
# CUDA 12.4 installs libs to targets/x86_64-linux/lib/ not lib64/
ENV LD_LIBRARY_PATH=/usr/local/cuda-12.4/targets/x86_64-linux/lib:/usr/local/cuda-12.4/lib64:/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH}

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
        echo "[STT] Installing GPU dependencies (faster-whisper, torch)..." && \
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

# VAD configuration
ENV VAD_THRESHOLD=0.5
ENV VAD_MIN_SILENCE_MS=500
ENV PARTIAL_INTERVAL_MS=1000

# Expose gRPC port
EXPOSE 50051

# Run the server
CMD ["python", "-u", "src/stt_server.py"]
