# Dockerfile
# Multi-platform support: Mac (CPU) and Linux (GPU with CUDA)
FROM python:3.11-slim

# Build argument for GPU support
# Usage: docker build --build-arg ENABLE_GPU=true ...
ARG ENABLE_GPU=false

WORKDIR /app

# Install system dependencies for audio processing and sherpa-onnx
RUN apt-get update && apt-get install -y \
    build-essential \
    ffmpeg \
    libsndfile1-dev \
    libasound2-dev \
    portaudio19-dev \
    git \
    wget \
    curl \
    tar \
    bzip2 \
    && rm -rf /var/lib/apt/lists/*

# Conditionally install CUDA runtime libraries for GPU support (Linux only)
# Note: This will be skipped on Mac builds (ENABLE_GPU=false by default)
RUN if [ "$ENABLE_GPU" = "true" ]; then \
    echo "Installing CUDA runtime libraries for GPU acceleration..." && \
    apt-get update && apt-get install -y --no-install-recommends \
        gnupg2 \
        ca-certificates \
        curl && \
    mkdir -p /usr/share/keyrings && \
    curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/3bf863cc.pub | gpg --dearmor -o /usr/share/keyrings/cuda-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/cuda-archive-keyring.gpg] https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64 /" > /etc/apt/sources.list.d/cuda.list && \
    apt-get update && apt-get install -y --no-install-recommends \
        cuda-cudart-12-4 \
        libcublas-12-4 \
        libcudnn9-cuda-12 && \
    rm -rf /var/lib/apt/lists/* && \
    echo "CUDA runtime libraries installed successfully"; \
    else \
    echo "GPU support disabled - building CPU-only image for Mac compatibility"; \
    fi

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Update pip and install Python dependencies
RUN pip install --upgrade pip

# Install large dependencies first (PyTorch takes longest - ~1-2GB for ARM)
RUN pip install --no-cache-dir --timeout=2000 --retries=5 \
    torch>=2.0.0 \
    torchaudio>=2.0.0

# Conditionally install ONNX Runtime based on GPU support
# - onnxruntime-gpu: CUDA-enabled for Linux GPU acceleration (includes CPU fallback)
# - onnxruntime: CPU-only for Mac compatibility
RUN if [ "$ENABLE_GPU" = "true" ]; then \
    echo "Installing onnxruntime-gpu for CUDA acceleration..." && \
    pip install --no-cache-dir --timeout=2000 --retries=5 onnxruntime-gpu>=1.16.0 && \
    echo "onnxruntime-gpu installed successfully"; \
    else \
    echo "Installing onnxruntime (CPU-only) for Mac compatibility..." && \
    pip install --no-cache-dir --timeout=2000 --retries=5 onnxruntime>=1.16.0 && \
    echo "onnxruntime (CPU) installed successfully"; \
    fi

# Install remaining dependencies with timeout and retries
# Note: onnxruntime is excluded from requirements.txt (installed above conditionally)
RUN pip install --no-cache-dir --timeout=2000 --retries=5 -r requirements.txt

# Pre-download sherpa-onnx model during build
COPY download_sherpa_model.py .
RUN python download_sherpa_model.py && rm download_sherpa_model.py

# Pre-download faster-whisper and Silero VAD models during build
COPY download_whisper_models.py .
RUN python download_whisper_models.py && rm download_whisper_models.py

# Pre-download Kokoro TTS models during build
COPY download_kokoro_models.py .
RUN python download_kokoro_models.py && rm download_kokoro_models.py

# Copy the application code
COPY main.py .
COPY message_processing/ ./message_processing/
COPY tts/ ./tts/
COPY agents/ ./agents/
COPY llm_configs/ ./llm_configs/
COPY llm_config.json .
COPY config/ ./config/
COPY plans/ ./plans/

# Create directory for agent configurations if it doesn't exist
RUN mkdir -p ./agents

# Set environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Audio processing optimization
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2
ENV OPENBLAS_NUM_THREADS=2

# Sherpa-onnx model cache directory
ENV SHERPA_ONNX_CACHE_DIR=/root/.cache/sherpa-onnx

# Kokoro model cache directory
ENV KOKORO_CACHE_DIR=/root/.cache/kokoro

# faster-whisper model cache directory
ENV HF_HOME=/root/.cache/huggingface

# Silero VAD model cache directory
ENV TORCH_HOME=/root/.cache/torch

# Create cache directories with proper permissions
RUN mkdir -p /root/.cache/sherpa-onnx \
             /root/.cache/kokoro \
             /root/.cache/huggingface \
             /root/.cache/torch/hub && \
    chmod -R 755 /root/.cache

# GPU/CUDA environment variables (only relevant when ENABLE_GPU=true)
ENV CUDA_HOME=/usr/local/cuda
ENV PATH=${CUDA_HOME}/bin:${PATH}
ENV LD_LIBRARY_PATH=${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}

# ONNX Runtime provider configuration
# Auto-detects GPU and falls back to CPU if unavailable
# Can be overridden via environment variable at runtime
ENV ONNX_PROVIDER="CUDAExecutionProvider,CPUExecutionProvider"

# Build metadata
ARG BUILD_DATE
ARG VCS_REF
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="Grace AI - Conversational AI Server" \
      org.opencontainers.image.description="Multi-platform AI server with GPU support for Kokoro TTS and Sherpa STT" \
      gpu.enabled="${ENABLE_GPU}"

# Run the application
CMD ["python", "-u", "main.py"]