#!/usr/bin/env python3
"""
STT gRPC Service using Sherpa-ONNX for real-time streaming transcription.
Provides a standardized gRPC interface that can be swapped with other STT backends.
"""
import asyncio
import grpc
from concurrent import futures
import numpy as np
import time
import os
import uuid
import sys

# Add parent directory to path for proto imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import stt_pb2
import stt_pb2_grpc

try:
    import sherpa_onnx
except ImportError as e:
    print(f"[STT Service] ERROR: sherpa-onnx not available: {e}")
    sherpa_onnx = None


class SherpaSTTEngine:
    """Sherpa-ONNX based STT engine."""

    def __init__(self):
        self.recognizer = None
        self.model_ready = False
        self.model_path = None
        self._initialize_model()

    def _initialize_model(self):
        """Initialize sherpa-onnx with pre-downloaded model."""
        if sherpa_onnx is None:
            print("[STT Service] CRITICAL: sherpa-onnx not installed!")
            return

        print("[STT Service] Initializing sherpa-onnx model...")

        # Model should already be downloaded during Docker build
        model_name = "sherpa-onnx-streaming-zipformer-en-2023-06-21"
        cache_dir = os.path.expanduser("~/.cache/sherpa-onnx")
        model_dir = os.path.join(cache_dir, model_name)

        if not os.path.exists(model_dir):
            print(f"[STT Service] Model not found at {model_dir}")
            print("[STT Service] Attempting to download model...")
            from download_sherpa_model import download_sherpa_model
            model_dir = download_sherpa_model()

        self.model_path = model_dir
        self.recognizer = self._create_recognizer()

        if self.recognizer:
            self.model_ready = True
            print(f"[STT Service] Model ready at: {model_dir}")
        else:
            print("[STT Service] FAILED to create recognizer")

    def _create_recognizer(self):
        """Create a new sherpa-onnx recognizer instance."""
        if not self.model_path:
            return None

        try:
            encoder_path = os.path.join(self.model_path, "encoder-epoch-99-avg-1.onnx")
            decoder_path = os.path.join(self.model_path, "decoder-epoch-99-avg-1.onnx")
            joiner_path = os.path.join(self.model_path, "joiner-epoch-99-avg-1.onnx")
            tokens_path = os.path.join(self.model_path, "tokens.txt")

            # Verify all files exist
            for path in [encoder_path, decoder_path, joiner_path, tokens_path]:
                if not os.path.exists(path):
                    print(f"[STT Service] Missing model file: {path}")
                    return None

            # Determine ONNX provider from environment
            # Maps ONNX Runtime provider names to sherpa-onnx provider names
            onnx_provider_str = os.getenv('ONNX_PROVIDER', 'CPUExecutionProvider')
            provider_map = {
                'CUDAExecutionProvider': 'cuda',
                'CPUExecutionProvider': 'cpu',
                'cuda': 'cuda',
                'cpu': 'cpu',
            }
            sherpa_provider = provider_map.get(onnx_provider_str.split(',')[0].strip(), 'cpu')
            print(f"[STT Service] Using ONNX provider: {sherpa_provider}")

            # Create streaming recognizer with VAD settings for natural speech
            # More lenient settings to avoid cutting off speech too early
            recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                encoder=encoder_path,
                decoder=decoder_path,
                joiner=joiner_path,
                tokens=tokens_path,
                sample_rate=16000,
                num_threads=2,
                enable_endpoint_detection=True,
                rule1_min_trailing_silence=2.5,   # Allow longer natural pauses (was 1.5)
                rule2_min_trailing_silence=2.0,   # Allow longer breathing pauses (was 1.2)
                rule3_min_utterance_length=300,   # Detect shorter utterances (was 400)
                decoding_method="greedy_search",
                max_active_paths=4,
                provider=sherpa_provider,  # GPU/CPU selection
            )

            print(f"[STT Service] Created sherpa-onnx recognizer successfully (provider={sherpa_provider})")
            return recognizer

        except Exception as e:
            print(f"[STT Service] Failed to create recognizer: {e}")
            return None

    def create_stream(self):
        """Create a new recognition stream."""
        if self.recognizer:
            return self.recognizer.create_stream()
        return None


class SessionState:
    """Tracks state for a single transcription session."""

    def __init__(self, session_id: str, participant_id: str, engine: SherpaSTTEngine):
        self.session_id = session_id
        self.participant_id = participant_id
        self.engine = engine
        self.stream = engine.create_stream() if engine.recognizer else None

        # Transcript tracking
        self.accumulated_text = ''
        self.transcript_id = f"transcript_{uuid.uuid4().hex[:8]}"
        self.chunk_count = 0

        # Timing
        self.last_activity = time.time()
        self.last_speech_activity = time.time()
        self.silence_start_time = None

        # Thresholds
        self.silence_threshold = 1.5  # seconds
        self.speech_timeout = 10.0    # force endpoint after 10s

        # Processing state
        self.processing_endpoint = False
        self.last_final_text = ""
        self.last_final_time = 0

    def process_audio(self, audio_data: bytes) -> list:
        """Process audio chunk and return any transcript events."""
        events = []

        if not self.stream or not self.engine.recognizer:
            return events

        current_time = time.time()
        self.last_activity = current_time
        self.chunk_count += 1

        try:
            # Convert bytes to numpy array (16-bit PCM)
            audio_int16 = np.frombuffer(audio_data, dtype=np.int16)

            if len(audio_int16) == 0:
                return events

            # Convert to float32 normalized
            audio_float = audio_int16.astype(np.float32) / 32768.0

            # Calculate RMS for speech detection
            audio_rms = np.sqrt(np.mean(audio_float**2))
            is_speech = audio_rms > 0.001

            # Apply gain normalization for quiet speech
            if is_speech and audio_rms > 0.005 and audio_rms < 0.05:
                gain = min(3.0, 0.15 / audio_rms)
                audio_float *= gain

            # Feed to recognizer
            self.stream.accept_waveform(sample_rate=16000, waveform=audio_float)

            # Decode when ready
            if self.engine.recognizer.is_ready(self.stream):
                self.engine.recognizer.decode_stream(self.stream)

            # Get current result
            result = self.engine.recognizer.get_result(self.stream)
            if result and result.strip():
                current_text = result.strip().capitalize()
                if current_text != self.accumulated_text:
                    self.accumulated_text = current_text

                    # Yield partial transcript
                    events.append(stt_pb2.TranscriptEvent(
                        text=current_text,
                        is_final=False,
                        transcript_id=self.transcript_id,
                        participant_id=self.participant_id,
                        confidence=0.8,
                        timestamp_ms=int(current_time * 1000)
                    ))

            # Track speech/silence
            if is_speech:
                self.silence_start_time = None
                self.last_speech_activity = current_time
            else:
                if self.silence_start_time is None:
                    self.silence_start_time = current_time

                silence_duration = current_time - self.silence_start_time

                # Check for silence threshold
                if silence_duration > self.silence_threshold and self.accumulated_text.strip():
                    final_event = self._handle_endpoint("silence_threshold")
                    if final_event:
                        events.append(final_event)

            # Check for VAD endpoint
            if self.engine.recognizer.is_endpoint(self.stream) and self.accumulated_text.strip():
                final_event = self._handle_endpoint("VAD_endpoint")
                if final_event:
                    events.append(final_event)

            # Check for timeout
            if current_time - self.last_speech_activity > self.speech_timeout:
                if self.accumulated_text.strip():
                    final_event = self._handle_endpoint("timeout")
                    if final_event:
                        events.append(final_event)

        except Exception as e:
            print(f"[STT Service] Audio processing error: {e}")

        return events

    def _handle_endpoint(self, reason: str):
        """Handle speech endpoint - return final transcript event."""
        if self.processing_endpoint:
            return None

        final_text = self.accumulated_text.strip()
        current_time = time.time()

        # Check for duplicate
        if (final_text == self.last_final_text and
            current_time - self.last_final_time < 5.0):
            return None

        if not final_text or len(final_text) < 2:
            return None

        self.processing_endpoint = True

        try:
            # Flush any remaining content
            self._flush_buffers()
            final_text = self.accumulated_text.strip()

            print(f"[STT Service] Final transcript ({reason}): '{final_text}'")

            # Update tracking
            self.last_final_text = final_text
            self.last_final_time = current_time

            event = stt_pb2.TranscriptEvent(
                text=final_text,
                is_final=True,
                transcript_id=self.transcript_id,
                participant_id=self.participant_id,
                confidence=0.9,
                timestamp_ms=int(current_time * 1000)
            )

            # Reset for next utterance
            self._reset()

            return event

        finally:
            self.processing_endpoint = False

    def _flush_buffers(self):
        """Flush recognizer buffers to get final content."""
        if not self.engine.recognizer or not self.stream:
            return

        try:
            for _ in range(3):
                if self.engine.recognizer.is_ready(self.stream):
                    self.engine.recognizer.decode_stream(self.stream)

                result = self.engine.recognizer.get_result(self.stream)
                if result and result.strip():
                    current_text = result.strip().capitalize()
                    if len(current_text) > len(self.accumulated_text):
                        self.accumulated_text = current_text
        except Exception as e:
            print(f"[STT Service] Buffer flush error: {e}")

    def _reset(self):
        """Reset state for next utterance."""
        self.accumulated_text = ''
        self.transcript_id = f"transcript_{uuid.uuid4().hex[:8]}"
        self.silence_start_time = None

        # Create fresh stream
        if self.engine.recognizer:
            self.stream = self.engine.create_stream()


class SpeechToTextServicer(stt_pb2_grpc.SpeechToTextServicer):
    """gRPC service implementation for Speech-to-Text."""

    def __init__(self):
        self.engine = SherpaSTTEngine()
        print(f"[STT Service] Servicer initialized, model_ready: {self.engine.model_ready}")

    async def StreamTranscribe(self, request_iterator, context):
        """Bidirectional streaming RPC for transcription."""
        session_state = None

        try:
            async for chunk in request_iterator:
                # Initialize session on first chunk
                if session_state is None:
                    session_state = SessionState(
                        session_id=chunk.session_id,
                        participant_id=chunk.participant_id,
                        engine=self.engine
                    )
                    print(f"[STT Service] New session: {chunk.session_id}, participant: {chunk.participant_id}")

                # Process audio and yield events
                events = session_state.process_audio(chunk.audio_data)
                for event in events:
                    yield event

        except Exception as e:
            print(f"[STT Service] Stream error: {e}")

        finally:
            if session_state:
                print(f"[STT Service] Session ended: {session_state.session_id}")

    async def HealthCheck(self, request, context):
        """Health check endpoint."""
        return stt_pb2.HealthResponse(
            healthy=self.engine.model_ready,
            model_status="ready" if self.engine.model_ready else "not_ready",
            version="1.0.0"
        )


async def serve():
    """Start the gRPC server."""
    port = os.getenv("GRPC_PORT", "50051")

    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),  # 50MB
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ]
    )

    stt_pb2_grpc.add_SpeechToTextServicer_to_server(SpeechToTextServicer(), server)
    server.add_insecure_port(f'[::]:{port}')

    await server.start()
    print(f"[STT Service] Server started on port {port}")
    print(f"[STT Service] Ready to accept connections")

    await server.wait_for_termination()


if __name__ == '__main__':
    print("=" * 60)
    print("STT gRPC Service - Sherpa-ONNX")
    print("=" * 60)
    asyncio.run(serve())
