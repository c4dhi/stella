"""TTS (Text-to-Speech) gRPC client for the Grace AI Agent SDK."""

import asyncio
import logging
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import grpc

logger = logging.getLogger(__name__)


@dataclass
class AudioChunk:
    """Audio chunk from TTS service."""

    audio_data: bytes
    is_final: bool
    chunk_index: int


class TTSClient:
    """
    gRPC client for the TTS (Text-to-Speech) service.

    This client handles streaming synthesis: sending text and receiving
    audio chunks for playback.

    Example:
        ```python
        client = TTSClient("tts-service:50052")
        await client.connect()

        async for chunk in client.synthesize_stream(
            "Hello, how can I help you today?",
            session_id="session-123",
        ):
            await play_audio(chunk.audio_data)

        await client.disconnect()
        ```
    """

    def __init__(self, tts_address: str):
        """
        Initialize the TTS client.

        Args:
            tts_address: Address of the TTS service (host:port)
        """
        self.tts_address = tts_address
        self._channel: Optional[grpc.aio.Channel] = None
        self._stub = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        """Whether connected to the TTS service."""
        return self._connected

    async def connect(self) -> None:
        """Connect to the TTS service."""
        if self._connected:
            return

        logger.info(f"Connecting to TTS service at {self.tts_address}")

        # Create gRPC channel
        self._channel = grpc.aio.insecure_channel(self.tts_address)

        # Wait for channel to be ready
        try:
            await asyncio.wait_for(
                self._channel.channel_ready(),
                timeout=10.0,
            )
        except asyncio.TimeoutError:
            raise ConnectionError(f"Timeout connecting to TTS service at {self.tts_address}")

        # Import and create stub dynamically
        try:
            from grace_agent_sdk._grpc import tts_pb2, tts_pb2_grpc
            self._stub = tts_pb2_grpc.TextToSpeechStub(self._channel)
            self._pb2 = tts_pb2
        except ImportError:
            logger.warning("Compiled TTS proto not found, using dynamic loading")
            self._stub = self._create_dynamic_stub()

        self._connected = True
        logger.info("Connected to TTS service")

    def _create_dynamic_stub(self):
        """Create a dynamic gRPC stub from proto file."""
        raise NotImplementedError(
            "TTS proto files not compiled. Run: "
            "python -m grpc_tools.protoc -I./proto --python_out=./src/grace_agent_sdk/_grpc "
            "--grpc_python_out=./src/grace_agent_sdk/_grpc ./proto/tts.proto"
        )

    async def disconnect(self) -> None:
        """Disconnect from the TTS service."""
        if not self._connected:
            return

        if self._channel:
            await self._channel.close()
            self._channel = None

        self._stub = None
        self._connected = False
        logger.info("Disconnected from TTS service")

    async def synthesize(
        self,
        text: str,
        session_id: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> bytes:
        """
        Synthesize text to audio (blocking, returns complete audio).

        Args:
            text: Text to synthesize
            session_id: Session identifier
            voice: Optional voice override
            speed: Speech rate (0.5-2.0, default 1.0)

        Returns:
            Complete audio as raw bytes (16kHz, 16-bit PCM, mono)
        """
        if not self._connected:
            raise RuntimeError("Not connected to TTS service")

        try:
            request = self._pb2.SynthesizeRequest(
                text=text,
                session_id=session_id,
                voice=voice or "",
                speed=speed,
            )
            response = await self._stub.Synthesize(request)
            return response.audio_data

        except grpc.RpcError as e:
            logger.error(f"TTS synthesis error: {e}")
            raise

    async def synthesize_stream(
        self,
        text: str,
        session_id: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
    ) -> AsyncIterator[AudioChunk]:
        """
        Stream audio chunks from TTS (non-blocking).

        Args:
            text: Text to synthesize
            session_id: Session identifier
            voice: Optional voice override
            speed: Speech rate (0.5-2.0, default 1.0)

        Yields:
            AudioChunk with audio_data (24kHz, 16-bit PCM, mono)
        """
        if not self._connected:
            raise RuntimeError("Not connected to TTS service")

        try:
            request = self._pb2.SynthesizeRequest(
                text=text,
                session_id=session_id,
                voice=voice or "",
                speed=speed,
            )

            # Stream response
            response_stream = self._stub.SynthesizeStream(request)

            async for chunk in response_stream:
                yield AudioChunk(
                    audio_data=chunk.audio_data,
                    is_final=chunk.is_final,
                    chunk_index=chunk.chunk_index,
                )

        except grpc.RpcError as e:
            logger.error(f"TTS stream error: {e}")
            raise

    async def health_check(self) -> bool:
        """Check if the TTS service is healthy."""
        if not self._connected:
            return False

        try:
            response = await self._stub.HealthCheck(self._pb2.Empty())
            return response.healthy
        except Exception as e:
            logger.error(f"TTS health check failed: {e}")
            return False
