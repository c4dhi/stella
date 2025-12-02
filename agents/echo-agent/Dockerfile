# Echo Agent Dockerfile
# Builds the echo-agent with its SDK dependency
#
# Build context: grace-ai-backend/ directory
# Build command: docker build -t echo-agent:latest -f agents/echo-agent/Dockerfile .

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy SDK first (dependency)
COPY agents/grace-ai-agent-sdk /app/grace-ai-agent-sdk

# Copy echo-agent
COPY agents/echo-agent /app/echo-agent

# Install SDK
RUN pip install --no-cache-dir /app/grace-ai-agent-sdk

# Install echo-agent
RUN pip install --no-cache-dir /app/echo-agent

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run agent - server address will be passed via environment or args
WORKDIR /app/echo-agent
CMD ["python", "-m", "echo_agent", "--server", "session-management-server:50051"]
