# Dockerfile
FROM python:3.11-slim

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

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Update pip and install Python dependencies
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download sherpa-onnx model during build
COPY download_sherpa_model.py .
RUN python download_sherpa_model.py && rm download_sherpa_model.py

# Pre-download faster-whisper and Silero VAD models during build
COPY download_whisper_models.py .
RUN python download_whisper_models.py && rm download_whisper_models.py

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

# Run the application
CMD ["python", "-u", "main.py"]