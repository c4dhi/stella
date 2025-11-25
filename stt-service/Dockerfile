# STT Service Dockerfile
# Supports Sherpa-ONNX for real-time streaming transcription
# Build arg ENABLE_GPU=true for CUDA support

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
    && if [ "$ENABLE_GPU" = "true" ]; then \
        echo "[STT] Installing CUDA libraries for GPU support..." && \
        curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/3bf863cc.pub | gpg --dearmor -o /usr/share/keyrings/cuda-archive-keyring.gpg && \
        echo "deb [signed-by=/usr/share/keyrings/cuda-archive-keyring.gpg] https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/ /" > /etc/apt/sources.list.d/cuda.list && \
        apt-get update && \
        apt-get install -y --no-install-recommends \
            cuda-cudart-12-4 \
            libcublas-12-4 \
            libcudnn9-cuda-12 \
        && echo "[STT] CUDA libraries installed successfully"; \
    else \
        echo "[STT] Building CPU-only image (ENABLE_GPU=false)"; \
    fi \
    && rm -rf /var/lib/apt/lists/*

# Set CUDA library paths for GPU builds
ENV LD_LIBRARY_PATH=/usr/local/cuda-12.4/lib64:/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH}

# Copy and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install ONNX Runtime (GPU or CPU based on build arg)
ARG ENABLE_GPU
RUN if [ "$ENABLE_GPU" = "true" ]; then \
        echo "[STT] Installing onnxruntime-gpu..." && \
        pip install --no-cache-dir onnxruntime-gpu>=1.16.0; \
    else \
        echo "[STT] Installing onnxruntime (CPU)..." && \
        pip install --no-cache-dir onnxruntime>=1.16.0; \
    fi

# Copy proto and generate Python code
COPY proto/ ./proto/
RUN python -m grpc_tools.protoc \
    -I./proto \
    --python_out=. \
    --grpc_python_out=. \
    proto/stt.proto

# Copy model download script and pre-download model
COPY download_sherpa_model.py .
RUN python download_sherpa_model.py

# Copy application code
COPY src/ ./src/

# Environment
ENV PYTHONUNBUFFERED=1
ENV GRPC_PORT=50051
ENV SHERPA_ONNX_CACHE_DIR=/root/.cache/sherpa-onnx
# Default to CPU provider - override with CUDAExecutionProvider for GPU
ENV ONNX_PROVIDER=CPUExecutionProvider

# Expose gRPC port
EXPOSE 50051

# Run the server
CMD ["python", "-u", "src/stt_server.py"]
