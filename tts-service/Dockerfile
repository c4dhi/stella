# TTS Service Dockerfile
# Supports Edge TTS (cloud) and Kokoro (local ONNX) providers
# Build arg ENABLE_GPU=true for CUDA support

ARG ENABLE_GPU=false

FROM python:3.11-slim AS base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install ONNX Runtime (CPU by default)
ARG ENABLE_GPU
RUN if [ "$ENABLE_GPU" = "true" ]; then \
        pip install --no-cache-dir onnxruntime-gpu>=1.16.0; \
    else \
        pip install --no-cache-dir onnxruntime>=1.16.0; \
    fi

# Pre-download Kokoro models (~500MB)
# This bakes models into the image to avoid runtime downloads
COPY download_kokoro_models.py .
RUN python download_kokoro_models.py || echo "Kokoro models download failed - will use Edge TTS as fallback"

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
ENV TTS_PROVIDER=edge_tts
ENV ONNX_PROVIDER=CPUExecutionProvider
ENV GRPC_PORT=50052
ENV KOKORO_CACHE_DIR=/root/.cache/kokoro

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import grpc; channel = grpc.insecure_channel('localhost:50052'); grpc.channel_ready_future(channel).result(timeout=5)" || exit 1

EXPOSE 50052

CMD ["python", "src/tts_server.py"]
