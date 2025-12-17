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

    # Tool mode configuration
    # USE_TOOLS: Set to "false" or "0" to use legacy text parsing mode
    use_tools_env = os.environ.get("USE_TOOLS", "true").lower()
    use_tools = use_tools_env not in ("false", "0", "no")

    # STATE_MACHINE_ADDRESS: gRPC address for state machine service
    state_machine_address = os.environ.get("STATE_MACHINE_ADDRESS")

    # Create and run agent
    agent = StellaLightAgent(
        llm_config_path=config_path,
        use_tools=use_tools,
        state_machine_address=state_machine_address
    )

    mode_str = "tool-based" if use_tools else "legacy"
    print(f"[main] Starting Stella Light Agent ({mode_str} mode)...")
    asyncio.run(run_agent_from_env(agent))


if __name__ == "__main__":
    main()
