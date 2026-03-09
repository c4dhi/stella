#!/usr/bin/env python3
"""
TTS gRPC Service supporting Edge TTS and Kokoro providers.
Provides a standardized gRPC interface for text-to-speech synthesis.
"""

import asyncio
import grpc
from concurrent import futures
import numpy as np
import os
import sys

# Add parent directory to path for proto imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import tts_pb2
import tts_pb2_grpc

from providers import EdgeTTSProvider, KokoroProvider, ChatterBoxProvider, TTSProvider


class TTSEngine:
    """TTS Engine that manages provider selection and fallback."""

    def __init__(self):
        self.provider: TTSProvider = None
        self.fallback_provider: TTSProvider = None
        self.provider_name = "none"
        self.initialized = False

    async def initialize(self) -> bool:
        """Initialize TTS with provider selection based on TTS_PROVIDER env var."""
        try:
            tts_provider = os.getenv('TTS_PROVIDER', 'edge_tts').lower()
            print(f"[TTS Engine] TTS_PROVIDER={tts_provider}")

            # Create providers
            edge_provider = EdgeTTSProvider()
            kokoro_provider = KokoroProvider()
            chatterbox_provider = ChatterBoxProvider()

            # Determine priority based on TTS_PROVIDER
            if tts_provider == 'chatterbox':
                primary_providers = [chatterbox_provider, edge_provider, kokoro_provider]
            elif tts_provider == 'kokoro':
                primary_providers = [kokoro_provider, edge_provider]
            elif tts_provider == 'edge_tts':
                primary_providers = [edge_provider, kokoro_provider]
            elif tts_provider == 'auto':
                # Auto: prefer ChatterBox (multilingual), then Kokoro, then Edge
                primary_providers = [chatterbox_provider, kokoro_provider, edge_provider]
            else:
                # Default to Edge TTS
                primary_providers = [edge_provider, kokoro_provider]

            # Try to initialize providers in priority order
            for provider in primary_providers:
                if provider.is_available:
                    print(f"[TTS Engine] Trying to initialize {provider.name}...")
                    if await provider.initialize():
                        self.provider = provider
                        self.provider_name = provider.name
                        print(f"[TTS Engine] Primary provider: {provider.name}")
                        break
                    else:
                        print(f"[TTS Engine] {provider.name} initialization failed")
                else:
                    print(f"[TTS Engine] {provider.name} not available")

            # Set up fallback provider
            if self.provider:
                for provider in primary_providers:
                    if provider != self.provider and provider.is_available:
                        if await provider.initialize():
                            self.fallback_provider = provider
                            print(f"[TTS Engine] Fallback provider: {provider.name}")
                            break

            self.initialized = self.provider is not None
            return self.initialized

        except Exception as e:
            print(f"[TTS Engine] Initialization error: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def synthesize(
        self,
        text: str,
        voice: str = None,
        speed: float = 1.0,
        language: str = None,
    ) -> tuple[bytes, int, int]:
        """Synthesize text to audio bytes.

        Returns:
            Tuple of (audio_bytes, sample_rate, duration_ms)
        """
        if not self.initialized or not self.provider:
            raise RuntimeError("TTS Engine not initialized")

        # Try primary provider
        result = await self.provider.synthesize(text, voice, speed, language=language)

        # Fallback if primary fails
        if result is None and self.fallback_provider:
            print(f"[TTS Engine] Primary provider failed, trying fallback...")
            result = await self.fallback_provider.synthesize(text, voice, speed, language=language)

        if result is None:
            raise RuntimeError(f"All TTS providers failed for text: {text[:50]}...")

        audio_data, sample_rate = result

        # Debug: log float32 audio stats
        print(f"[TTS Engine] Float32 audio: {len(audio_data)} samples, "
              f"range=[{np.min(audio_data):.4f}, {np.max(audio_data):.4f}]")

        # Convert float32 audio to int16 bytes
        audio_int16 = (np.clip(audio_data, -1.0, 1.0) * 32767).astype(np.int16)
        audio_bytes = audio_int16.tobytes()

        # Debug: log int16 audio stats
        print(f"[TTS Engine] Int16 audio: {len(audio_int16)} samples, "
              f"range=[{np.min(audio_int16)}, {np.max(audio_int16)}], "
              f"bytes={len(audio_bytes)}")

        # Calculate duration
        duration_ms = int(len(audio_int16) / sample_rate * 1000)

        return audio_bytes, sample_rate, duration_ms

    async def synthesize_stream(
        self,
        text: str,
        voice: str = None,
        speed: float = 1.0,
        chunk_size: int = 480,
        language: str = None,
    ):
        """Synthesize text to streaming audio chunks.

        Yields:
            Tuples of (audio_chunk_bytes, is_final, chunk_index)
        """
        if not self.initialized or not self.provider:
            raise RuntimeError("TTS Engine not initialized")

        chunk_index = 0
        async for chunk, is_final in self.provider.synthesize_stream(text, voice, speed, chunk_size, language=language):
            yield chunk.tobytes(), is_final, chunk_index
            chunk_index += 1

    async def cleanup(self):
        """Clean up all providers."""
        if self.provider:
            await self.provider.cleanup()
        if self.fallback_provider:
            await self.fallback_provider.cleanup()


class TextToSpeechServicer(tts_pb2_grpc.TextToSpeechServicer):
    """gRPC service implementation for Text-to-Speech."""

    def __init__(self):
        self.engine = TTSEngine()
        print("[TTS Service] Servicer created")

    async def initialize(self):
        """Initialize the TTS engine."""
        success = await self.engine.initialize()
        print(f"[TTS Service] Initialization: {'success' if success else 'failed'}")
        return success

    async def Synthesize(self, request, context):
        """Synthesize text to complete audio response."""
        try:
            text = request.text
            if not text or not text.strip():
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Empty text")
                return tts_pb2.SynthesizeResponse()

            print(f"[TTS Service] Synthesize request: '{text[:50]}...' session={request.session_id} lang={request.language}")

            audio_bytes, sample_rate, duration_ms = await self.engine.synthesize(
                text=text,
                voice=request.voice if request.voice else None,
                speed=request.speed if request.speed > 0 else 1.0,
                language=request.language if request.language else None,
            )

            print(f"[TTS Service] Synthesized {len(audio_bytes)} bytes, {duration_ms}ms")

            return tts_pb2.SynthesizeResponse(
                audio_data=audio_bytes,
                sample_rate=sample_rate,
                duration_ms=duration_ms,
            )

        except Exception as e:
            print(f"[TTS Service] Synthesize error: {e}")
            context.abort(grpc.StatusCode.INTERNAL, str(e))
            return tts_pb2.SynthesizeResponse()

    async def SynthesizeStream(self, request, context):
        """Synthesize text to streaming audio chunks."""
        try:
            text = request.text
            if not text or not text.strip():
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Empty text")
                return

            print(f"[TTS Service] SynthesizeStream request: '{text[:50]}...'")

            async for audio_bytes, is_final, chunk_index in self.engine.synthesize_stream(
                text=text,
                voice=request.voice if request.voice else None,
                speed=request.speed if request.speed > 0 else 1.0,
                language=request.language if request.language else None,
            ):
                yield tts_pb2.AudioChunk(
                    audio_data=audio_bytes,
                    is_final=is_final,
                    chunk_index=chunk_index,
                )

            print(f"[TTS Service] Stream completed")

        except Exception as e:
            print(f"[TTS Service] SynthesizeStream error: {e}")
            context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def HealthCheck(self, request, context):
        """Health check endpoint."""
        return tts_pb2.HealthResponse(
            healthy=self.engine.initialized,
            provider=self.engine.provider_name,
            version="1.0.0",
        )


async def serve():
    """Start the gRPC server."""
    port = os.getenv("GRPC_PORT", "50052")

    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),  # 50MB
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ]
    )

    servicer = TextToSpeechServicer()

    # Initialize TTS engine
    if not await servicer.initialize():
        print("[TTS Service] CRITICAL: Failed to initialize TTS engine!")
        print("[TTS Service] Server will start but synthesize requests will fail")

    tts_pb2_grpc.add_TextToSpeechServicer_to_server(servicer, server)
    server.add_insecure_port(f'[::]:{port}')

    await server.start()
    print(f"[TTS Service] Server started on port {port}")
    print(f"[TTS Service] Provider: {servicer.engine.provider_name}")
    print(f"[TTS Service] Ready to accept connections")

    await server.wait_for_termination()


if __name__ == '__main__':
    print("=" * 60)
    print("TTS gRPC Service")
    print("=" * 60)
    asyncio.run(serve())
