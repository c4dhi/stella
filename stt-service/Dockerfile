FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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

# Expose gRPC port
EXPOSE 50051

# Run the server
CMD ["python", "-u", "src/stt_server.py"]
