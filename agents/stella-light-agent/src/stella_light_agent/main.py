"""
Entry point for Stella Light Agent.

Runs the agent using the stella-ai-agent-sdk.
"""

import asyncio
import os

from stella_agent_sdk import run_agent_from_env

from stella_light_agent.agent import StellaLightAgent


def main():
    """Main entry point for stella-light-agent."""
    # Get config paths from environment
    config_path = os.environ.get("LLM_CONFIG_PATH")

    # Create and run agent
    agent = StellaLightAgent(llm_config_path=config_path)

    print("[main] Starting Stella Light Agent...")
    asyncio.run(run_agent_from_env(agent))


if __name__ == "__main__":
    main()
