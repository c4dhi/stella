"""
Grace AI Agent SDK

A communication SDK for building voice agents that integrate with the Grace AI platform.
Agents connect directly to LiveKit rooms and communicate with external STT/TTS services.

Architecture:
    ┌─────────────────────────────────────────────────────────────┐
    │                    LiveKit Room                              │
    │  ┌──────────┐                        ┌──────────────────┐   │
    │  │  User    │ ◄─── audio/data ─────► │  Agent (SDK)     │   │
    │  └──────────┘                        └────────┬─────────┘   │
    └────────────────────────────────────────────────┼────────────┘
                                                     │ gRPC
                          ┌──────────────────────────┼──────────┐
                          │   Kubernetes Cluster     │          │
                          │  ┌───────────┐    ┌──────▼──────┐   │
                          │  │ STT Svc   │    │  TTS Svc    │   │
                          │  └───────────┘    └─────────────┘   │
                          └─────────────────────────────────────┘

Example Usage:
    ```python
    import asyncio
    from grace_agent_sdk import BaseAgent, run_agent_from_env

    class MyAgent(BaseAgent):
        async def on_session_start(self, session_id, config):
            # Register barge-in handler
            self.audio.on_speech_started(self._handle_barge_in)

        async def run_audio_loop(self):
            async for event in self.audio.audio_in():
                # event.is_final is always True (partials sent to LiveKit)
                await self.audio.audio_out(f"You said: {event.text}")

        async def _handle_barge_in(self):
            await self.audio.stop_speaking()

        async def process(self, input):
            yield AgentOutput.text_final(input.session_id, "Hello!")

        async def on_interrupt(self, session_id):
            await self.audio.stop_speaking()

    if __name__ == "__main__":
        asyncio.run(run_agent_from_env(MyAgent()))
    ```

Environment Variables (set by session-management-server):
    LIVEKIT_URL: LiveKit server URL
    ROOM_NAME: Room to join
    AGENT_IDENTITY: Agent participant identity
    LIVEKIT_API_KEY: API key for JWT
    LIVEKIT_API_SECRET: API secret for JWT
    STT_SERVICE_ADDRESS: External STT service address (gRPC)
    TTS_SERVICE_ADDRESS: External TTS service address (gRPC)
"""

from grace_agent_sdk.messages.types import (
    InputType,
    OutputType,
    StatusSubtype,
    MetadataSubtype,
    AgentState,
    ChatMessage,
)
from grace_agent_sdk.messages.input import AgentInput
from grace_agent_sdk.messages.output import AgentOutput
from grace_agent_sdk.agent.base import BaseAgent
from grace_agent_sdk.run import run_agent_from_env
from grace_agent_sdk.services.history_client import HistoryClient, HistoryClientError

__version__ = "0.3.0"

__all__ = [
    # Message types
    "InputType",
    "OutputType",
    "StatusSubtype",
    "MetadataSubtype",
    "AgentState",
    "AgentInput",
    "AgentOutput",
    "ChatMessage",
    # Agent interface
    "BaseAgent",
    # Entry point (config from environment)
    "run_agent_from_env",
    # History client (for advanced use cases)
    "HistoryClient",
    "HistoryClientError",
]
