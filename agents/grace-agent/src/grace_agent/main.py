"""
Main entry point for running the Grace Agent.

This module provides the entry point for the Grace Agent using the
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
    OPENAI_API_KEY: OpenAI API key for LLM

Optional Environment Variables:
    LLM_MODEL: Model to use (default: gpt-4o-mini)
    LLM_CONFIG_PATH: Path to LLM configuration file
    EXPERTS_DIR: Path to directory containing expert configurations
"""

import asyncio
import logging
import os

from grace_agent_sdk import run_agent_from_env
from grace_agent import GraceAgent

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    """Run the Grace Agent (config from environment)."""
    logger.info("Starting Grace Agent")

    # Optional configuration from environment
    config_path = os.environ.get("LLM_CONFIG_PATH")
    experts_dir = os.environ.get("EXPERTS_DIR")

    agent = GraceAgent(
        llm_config_path=config_path,
        experts_dir=experts_dir,
    )

    asyncio.run(run_agent_from_env(agent))


if __name__ == "__main__":
    main()
