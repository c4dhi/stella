# Stella V2 Agent Dockerfile
# Builds the stella-v2-agent with its SDK dependency
#
# Build context: stella-backend/ directory
# Build command: docker build -t stella-v2-agent:latest -f agents/stella-v2-agent/Dockerfile .

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

# Copy stella-v2-agent
COPY agents/stella-v2-agent /app/stella-v2-agent

# Install SDK
RUN pip install --no-cache-dir /app/stella-ai-agent-sdk

# Install stella-v2-agent
RUN pip install --no-cache-dir /app/stella-v2-agent

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run agent - server address will be passed via environment or args
WORKDIR /app/stella-v2-agent
CMD ["python", "-m", "stella_v2_agent", "--server", "session-management-server:50051"]
