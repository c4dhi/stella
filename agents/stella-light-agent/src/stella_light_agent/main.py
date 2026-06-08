"""
Entry point for Stella Light Agent.

Runs the agent using the stella-ai-agent-sdk.
"""

import asyncio
import logging
import os
import sys

from stella_agent_sdk import run_agent_from_env

from stella_light_agent.agent import StellaLightAgent


def main():
    """Main entry point for stella-light-agent."""
    # Configure logging - output all SDK logs to stdout
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
        force=True,  # Override any existing configuration
    )
    # Also set specific loggers to ensure SDK logs are visible
    logging.getLogger("stella_agent_sdk").setLevel(logging.DEBUG)
    logging.getLogger("livekit").setLevel(logging.INFO)

    # Get config paths from environment
    config_path = os.environ.get("LLM_CONFIG_PATH")

    # STATE_MACHINE_ADDRESS: gRPC address for state machine service (the single
    # source of truth; all state is managed through the SDK toolbox against it).
    state_machine_address = os.environ.get("STATE_MACHINE_ADDRESS")

    # Create and run agent
    agent = StellaLightAgent(
        llm_config_path=config_path,
        state_machine_address=state_machine_address
    )

    print("[main] Starting Stella Light Agent (tool-based state management)...")
    asyncio.run(run_agent_from_env(agent))


if __name__ == "__main__":
    main()
