#!/usr/bin/env python3
"""
Simple Echo Agent Example

This is the simplest possible agent implementation.
It just echoes back whatever the user says.

Usage:
    python echo_agent.py --server localhost:50051
"""

import argparse
import asyncio
import logging
from typing import Any, AsyncIterator, Dict

from stella_agent_sdk import BaseAgent, AgentInput, AgentOutput, connect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EchoAgent(BaseAgent):
    """
    Simple echo agent that repeats user input.

    This demonstrates the minimal implementation of BaseAgent.
    """

    def __init__(self) -> None:
        super().__init__()
        self.message_count = 0

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """Initialize session state."""
        logger.info(f"Session started: {session_id}")
        logger.info(f"Config: {config}")
        self.message_count = 0

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """Echo the user's input back."""
        self.message_count += 1

        # Show that we're processing
        yield AgentOutput.processing(input.session_id, "Processing your message...")

        # Echo back the input
        response = f"You said: {input.text}"

        # Send the response (non-streaming)
        yield AgentOutput.text_final(input.session_id, response)

        logger.info(f"Processed message {self.message_count}: {input.text[:50]}...")

    async def on_interrupt(self, session_id: str) -> None:
        """Handle interrupt - nothing to cancel for echo agent."""
        logger.info(f"Interrupt received for session {session_id}")

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """Cleanup and return session stats."""
        logger.info(f"Session ended: {session_id}")
        return {"messages_processed": self.message_count}


async def main(server_address: str) -> None:
    """Run the echo agent."""
    agent = EchoAgent()

    logger.info(f"Starting Echo Agent, connecting to {server_address}...")

    async with connect(
        server_address,
        agent,
        agent_type="echo-agent",
        agent_version="1.0.0",
    ) as session:
        logger.info("Connected! Running agent...")
        await session.run()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Echo Agent Example")
    parser.add_argument(
        "--server",
        default="localhost:50051",
        help="Session management server address (default: localhost:50051)",
    )
    args = parser.parse_args()

    asyncio.run(main(args.server))
