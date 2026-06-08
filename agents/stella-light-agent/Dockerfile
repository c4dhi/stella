# Stella Light Agent Dockerfile
# Builds the stella-light-agent with its SDK dependency
#
# Build context: stella-backend/ directory
# Build command: docker build -t stella-light-agent:latest -f agents/stella-light-agent/Dockerfile .

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

# Copy stella-light-agent (includes its own config/plans)
COPY agents/stella-light-agent /app/stella-light-agent

# Install SDK (editable mode for development)
RUN pip install --no-cache-dir /app/stella-ai-agent-sdk

# Install stella-light-agent
RUN pip install --no-cache-dir /app/stella-light-agent

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run agent - server address will be passed via environment or args
WORKDIR /app/stella-light-agent
CMD ["python", "-m", "stella_light_agent"]
