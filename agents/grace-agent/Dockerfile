# Grace Agent Dockerfile
# Builds the grace-agent with its SDK dependency
#
# Build context: grace-ai-backend/ directory
# Build command: docker build -t grace-agent:latest -f agents/grace-agent/Dockerfile .

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy SDK first (dependency)
COPY agents/grace-ai-agent-sdk /app/grace-ai-agent-sdk

# Copy grace-agent
COPY agents/grace-agent /app/grace-agent

# Install SDK (editable mode for development)
RUN pip install --no-cache-dir /app/grace-ai-agent-sdk

# Install grace-agent
RUN pip install --no-cache-dir /app/grace-agent

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run agent - server address will be passed via environment or args
WORKDIR /app/grace-agent
CMD ["python", "-m", "grace_agent", "--server", "session-management-server:50051"]
