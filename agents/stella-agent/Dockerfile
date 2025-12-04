# Stella Agent Dockerfile
# Builds the stella-agent with its SDK dependency
#
# Build context: stella-backend/ directory
# Build command: docker build -t stella-agent:latest -f agents/stella-agent/Dockerfile .

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy SDK first (dependency)
COPY agents/stella-ai-agent-sdk /app/stella-ai-agent-sdk

# Copy stella-agent
COPY agents/stella-agent /app/stella-agent

# Install SDK (editable mode for development)
RUN pip install --no-cache-dir /app/stella-ai-agent-sdk

# Install stella-agent
RUN pip install --no-cache-dir /app/stella-agent

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run agent - server address will be passed via environment or args
WORKDIR /app/stella-agent
CMD ["python", "-m", "stella_agent", "--server", "session-management-server:50051"]
