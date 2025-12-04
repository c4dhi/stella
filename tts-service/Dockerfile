# TTS Service Dockerfile
# Supports Edge TTS (cloud) and Kokoro (local ONNX) providers
# Build arg ENABLE_GPU=true for CUDA support

ARG ENABLE_GPU=false

FROM python:3.11-slim AS base

WORKDIR /app

# Install system dependencies and conditional CUDA libraries
ARG ENABLE_GPU
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    curl \
    gnupg \
    ca-certificates \
    && if [ "$ENABLE_GPU" = "true" ]; then \
        echo "[TTS] Installing CUDA libraries for GPU support..." && \
        curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/3bf863cc.pub | gpg --dearmor -o /usr/share/keyrings/cuda-archive-keyring.gpg && \
        echo "deb [signed-by=/usr/share/keyrings/cuda-archive-keyring.gpg] https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/ /" > /etc/apt/sources.list.d/cuda.list && \
        apt-get update && \
        apt-get install -y --no-install-recommends \
            cuda-cudart-12-4 \
            libcublas-12-4 \
            libcurand-12-4 \
            libcufft-12-4 \
            libcudnn9-cuda-12 \
        && echo "[TTS] CUDA libraries installed successfully"; \
    else \
        echo "[TTS] Building CPU-only image (ENABLE_GPU=false)"; \
    fi \
    && rm -rf /var/lib/apt/lists/*

# Set CUDA library paths for GPU builds
# CUDA 12.4 installs libs to targets/x86_64-linux/lib/ not lib64/
ENV LD_LIBRARY_PATH=/usr/local/cuda-12.4/targets/x86_64-linux/lib:/usr/local/cuda-12.4/lib64:/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH}

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install ONNX Runtime (GPU or CPU based on build arg)
ARG ENABLE_GPU
RUN if [ "$ENABLE_GPU" = "true" ]; then \
        echo "[TTS] Installing onnxruntime-gpu..." && \
        pip install --no-cache-dir onnxruntime-gpu>=1.16.0; \
    else \
        echo "[TTS] Installing onnxruntime (CPU)..." && \
        pip install --no-cache-dir onnxruntime>=1.16.0; \
    fi

# Model download script (models are downloaded at runtime via init container)
# Models are stored on PersistentVolume, not in the image.
# This keeps the image slim (~400MB instead of ~1GB).
# The init container runs this script to populate the PV on first startup.
COPY download_kokoro_models.py .

# Generate gRPC code from proto
COPY proto/ ./proto/
RUN python -m grpc_tools.protoc \
    -I./proto \
    --python_out=. \
    --grpc_python_out=. \
    ./proto/tts.proto

# Copy source code
COPY src/ ./src/

# Environment defaults
# Use kokoro as default when GPU available for lowest latency
ENV TTS_PROVIDER=edge_tts
ENV ONNX_PROVIDER=CPUExecutionProvider
ENV GRPC_PORT=50052
ENV KOKORO_CACHE_DIR=/root/.cache/kokoro

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import grpc; channel = grpc.insecure_channel('localhost:50052'); grpc.channel_ready_future(channel).result(timeout=5)" || exit 1

EXPOSE 50052

CMD ["python", "src/tts_server.py"]
