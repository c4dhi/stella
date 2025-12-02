"""
Main entry point for running the Echo Agent.

This module provides the entry point for the Echo Agent using the
Grace AI Agent SDK. All configuration comes from environment variables
set by the session-management-server when deploying the agent pod.

Environment Variables (set by session-management-server):
    LIVEKIT_URL: LiveKit server URL
    ROOM_NAME: Room to join
    AGENT_IDENTITY: Agent participant identity
    LIVEKIT_API_KEY: API key for JWT
    LIVEKIT_API_SECRET: API secret for JWT
    STT_SERVICE_ADDRESS: External STT service address (gRPC)
    TTS_SERVICE_ADDRESS: External TTS service address (gRPC)
"""

import asyncio
import logging

from grace_agent_sdk import run_agent_from_env
from echo_agent import EchoAgent

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    """Run the Echo Agent (config from environment)."""
    logger.info("Starting Echo Agent")

    agent = EchoAgent()
    asyncio.run(run_agent_from_env(agent))


if __name__ == "__main__":
    main()
