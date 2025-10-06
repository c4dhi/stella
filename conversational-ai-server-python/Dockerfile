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

# Create cache directories with proper permissions
RUN mkdir -p /root/.cache/sherpa-onnx /root/.cache/kokoro && chmod -R 755 /root/.cache

# Run the application
CMD ["python", "-u", "main.py"]