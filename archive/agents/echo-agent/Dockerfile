# Echo Agent Dockerfile
# Builds the echo-agent with its SDK dependency
#
# Build context: stella-backend/ directory
# Build command: docker build -t echo-agent:latest -f agents/echo-agent/Dockerfile .

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
# - build-essential: for compiling Python packages
# - libglib2.0-0: provides libgobject-2.0.so required by livekit-rtc
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy SDK first (dependency)
COPY agents/stella-ai-agent-sdk /app/stella-ai-agent-sdk

# Copy echo-agent
COPY agents/echo-agent /app/echo-agent

# Install SDK
RUN pip install --no-cache-dir /app/stella-ai-agent-sdk

# Install echo-agent
RUN pip install --no-cache-dir /app/echo-agent

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run agent - server address will be passed via environment or args
WORKDIR /app/echo-agent
CMD ["python", "-m", "echo_agent", "--server", "session-management-server:50051"]
