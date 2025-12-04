#!/usr/bin/env python3
"""
OpenAI Agent Example

This example shows how to integrate an LLM (OpenAI) with the STELLA Agent SDK.
It demonstrates streaming responses from the LLM back through the SDK.

NOTE: This is an EXAMPLE of how to implement an agent, NOT part of the SDK itself.
      The SDK only provides communication interfaces - LLM integration is your choice.

Requirements:
    pip install openai

Usage:
    export OPENAI_API_KEY=your-key-here
    python openai_agent.py --server localhost:50051
"""

import argparse
import asyncio
import logging
import os
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

from stella_agent_sdk import BaseAgent, AgentInput, AgentOutput, connect
from stella_agent_sdk.messages.types import StatusSubtype

# Try to import OpenAI - it's optional for the SDK
try:
    from openai import AsyncOpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    AsyncOpenAI = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class OpenAIAgent(BaseAgent):
    """
    Agent that uses OpenAI's GPT models for conversation.

    This demonstrates:
    - Streaming responses from an LLM
    - Maintaining conversation history
    - Proper interrupt handling
    - Using configuration from session-management
    """

    def __init__(self, api_key: Optional[str] = None) -> None:
        super().__init__()

        if not OPENAI_AVAILABLE:
            raise ImportError(
                "OpenAI package is not installed. "
                "Install it with: pip install openai"
            )

        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "OpenAI API key not provided. "
                "Set OPENAI_API_KEY environment variable or pass api_key parameter."
            )

        self.client: Optional[AsyncOpenAI] = None
        self.model = "gpt-4o-mini"
        self.temperature = 0.7
        self.system_prompt = "You are a helpful assistant."
        self.conversation_history: List[Dict[str, str]] = []
        self._cancelled = False

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """Initialize the OpenAI client with session configuration."""
        logger.info(f"Session started: {session_id}")

        # Initialize OpenAI client
        self.client = AsyncOpenAI(api_key=self.api_key)

        # Apply configuration from session-management
        self.model = config.get("llm_model", self.model)
        self.temperature = config.get("temperature", self.temperature)
        self.system_prompt = config.get("system_prompt", self.system_prompt)

        # Reset conversation history
        self.conversation_history = []

        logger.info(f"Using model: {self.model}, temperature: {self.temperature}")

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """Process user input and stream response from OpenAI."""
        self._cancelled = False

        # Show thinking status
        yield AgentOutput.status(
            input.session_id,
            "Thinking...",
            StatusSubtype.THINKING,
        )

        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": input.text,
        })

        # Build messages for OpenAI
        messages = [
            {"role": "system", "content": self.system_prompt},
            *self.conversation_history,
        ]

        # Generate a transcript ID for streaming
        transcript_id = str(uuid.uuid4())
        full_response = ""

        try:
            # Stream from OpenAI
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                stream=True,
            )

            async for chunk in stream:
                # Check for cancellation
                if self._cancelled:
                    logger.info("Generation cancelled")
                    break

                # Extract content from chunk
                if chunk.choices and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    full_response += token

                    # Stream the token
                    yield AgentOutput.text_chunk(
                        input.session_id,
                        token,
                        transcript_id=transcript_id,
                    )

            # Send final marker if not cancelled
            if not self._cancelled and full_response:
                yield AgentOutput.text_chunk(
                    input.session_id,
                    "",
                    transcript_id=transcript_id,
                    is_final=True,
                )

                # Add assistant response to history
                self.conversation_history.append({
                    "role": "assistant",
                    "content": full_response,
                })

        except Exception as e:
            logger.error(f"OpenAI error: {e}")
            yield AgentOutput.error(
                input.session_id,
                f"Error generating response: {e}",
                error_type="llm_error",
            )

    async def on_interrupt(self, session_id: str) -> None:
        """Handle interrupt - cancel ongoing generation."""
        logger.info(f"Interrupt received for session {session_id}")
        self._cancelled = True

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """Cleanup and return session stats."""
        logger.info(f"Session ended: {session_id}")
        return {
            "messages_processed": len(self.conversation_history),
            "model_used": self.model,
        }


async def main(server_address: str) -> None:
    """Run the OpenAI agent."""
    agent = OpenAIAgent()

    logger.info(f"Starting OpenAI Agent, connecting to {server_address}...")

    async with connect(
        server_address,
        agent,
        agent_type="openai-agent",
        agent_version="1.0.0",
    ) as session:
        logger.info("Connected! Running agent...")
        await session.run()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenAI Agent Example")
    parser.add_argument(
        "--server",
        default="localhost:50051",
        help="Session management server address (default: localhost:50051)",
    )
    args = parser.parse_args()

    asyncio.run(main(args.server))
