"""Piper TTS Provider - Fast local TTS using ONNX inference (~0.19 RTF on CPU).

Optimized for TTFB:
- Warm-up call at end of initialize() (cheap on CPU, but eliminates the
  ONNX session JIT cost on the first real request).
- Real synthesize_stream() override that pumps Piper's internal audio
  generator straight to the client: Piper already produces audio chunk
  by chunk inside `voice.synthesize()`, so we get true streaming once we
  stop collecting + concatenating before yielding.
"""

import asyncio
import os
import time
from typing import Optional, Tuple, AsyncGenerator
import numpy as np

from .base import TTSProvider

# Check if piper is available
try:
    from piper.voice import PiperVoice
    PIPER_AVAILABLE = True
except ImportError:
    PIPER_AVAILABLE = False
    PiperVoice = None

try:
    import scipy.signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


# Sentinel used in the async pump queue to signal end-of-stream.
_PIPER_STREAM_DONE = object()


class PiperProvider(TTSProvider):
    """Piper TTS provider using local ONNX model.

    Features:
    - Very fast local inference (~0.19 RTF on CPU, ~5x real-time)
    - No cloud dependency
    - Lightweight models (~60MB each)
    """

    # Piper native sample rate (overridden by voice config when available)
    PIPER_SAMPLE_RATE = 22050
    # Sample rate we hand back to the rest of STELLA. Matches Kokoro/Chatterbox.
    OUTPUT_SAMPLE_RATE = 24000

    def __init__(self):
        self._initialized = False
        self._voice: Optional[object] = None
        self._default_voice = os.getenv('PIPER_VOICE', 'en_US-lessac-medium')
        self._cache_dir = os.getenv('PIPER_CACHE_DIR', os.path.expanduser('~/.cache/piper'))
        self._native_sample_rate = self.PIPER_SAMPLE_RATE

    @property
    def name(self) -> str:
        return "piper"

    @property
    def is_available(self) -> bool:
        return PIPER_AVAILABLE

    def _find_model_path(self) -> Optional[str]:
        """Find the .onnx model file in cache directory."""
        model_file = os.path.join(self._cache_dir, f'{self._default_voice}.onnx')
        if os.path.exists(model_file):
            return model_file
        return None

    async def initialize(self) -> bool:
        """Initialize Piper TTS provider."""
        if not self.is_available:
            print("[Piper] piper-tts not available")
            return False

        try:
            print("[Piper] Initializing Piper TTS provider...")

            if not os.path.exists(self._cache_dir):
                self._cache_dir = os.path.expanduser('~/.cache/piper')

            model_path = self._find_model_path()
            if not model_path:
                print(f"[Piper] Model not found at: {self._cache_dir}/{self._default_voice}.onnx")
                print("[Piper] Run download_piper_models.py first")
                return False

            config_path = model_path + '.json'
            if not os.path.exists(config_path):
                print(f"[Piper] Config not found at: {config_path}")
                return False

            loop = asyncio.get_event_loop()
            self._voice = await loop.run_in_executor(
                None,
                lambda: PiperVoice.load(model_path, config_path=config_path)
            )
            self._native_sample_rate = getattr(self._voice.config, 'sample_rate', None) or self.PIPER_SAMPLE_RATE

            self._initialized = True
            print(f"[Piper] Initialized (voice={self._default_voice}, native_sr={self._native_sample_rate})")

            await self._warm_up()
            return True

        except Exception as e:
            print(f"[Piper] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def _warm_up(self) -> None:
        """Run a tiny synth so the first real request hits warm kernels."""
        try:
            t0 = time.time()
            await self.synthesize("Hi.")
            print(f"[Piper] Warm-up complete in {(time.time() - t0) * 1000:.0f}ms")
        except Exception as e:
            print(f"[Piper] Warm-up failed (non-fatal): {e}")

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        language: Optional[str] = None,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Non-streaming synthesis. Collects Piper's chunked output into one tensor."""
        if not self._initialized or not self._voice:
            print("[Piper] Not initialized")
            return None
        if not text or not text.strip():
            return None

        try:
            t0 = time.time()
            loop = asyncio.get_event_loop()
            raw_audio, sample_rate = await loop.run_in_executor(
                None,
                lambda: self._synthesize_raw(text)
            )
            if raw_audio is None or len(raw_audio) == 0:
                print("[Piper] Synthesis returned empty audio")
                return None

            audio = self._resample(raw_audio, sample_rate, self.OUTPUT_SAMPLE_RATE)
            if speed != 1.0 and 0.5 <= speed <= 2.0:
                audio = self._resample_by_length(audio, int(len(audio) / speed))
            audio = self._normalize_audio(audio)

            total_ms = (time.time() - t0) * 1000.0
            print(f"[Piper] Synthesized {len(audio)} samples in {total_ms:.0f}ms")
            return (audio, self.OUTPUT_SAMPLE_RATE)

        except Exception as e:
            print(f"[Piper] Synthesis failed: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def synthesize_stream(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        chunk_size: int = 480,
        language: Optional[str] = None,
    ) -> AsyncGenerator[Tuple[np.ndarray, bool], None]:
        """Streaming synthesis.

        Piper's `voice.synthesize()` is itself a chunk-generator — it yields
        audio fragments as the ONNX model produces them. We pump those
        fragments to an asyncio.Queue from a worker thread, then re-chunk
        each fragment into `chunk_size`-sized int16 frames for the gRPC
        consumer. TTFB ≈ time to first piper fragment + resample, not
        full-utterance synth time.
        """
        if not self._initialized or not self._voice:
            print("[Piper] Not initialized")
            return
        if not text or not text.strip():
            return

        if speed != 1.0:
            # Speed adjustment requires resampling on the whole utterance,
            # which defeats streaming. Fall back to the non-streaming path
            # and chunk-up at the end.
            result = await self.synthesize(text, voice, speed, language)
            if result is None:
                return
            audio, _ = result
            int16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
            total = len(int16)
            for i in range(0, total, chunk_size):
                yield (int16[i:i + chunk_size], i + chunk_size >= total)
            return

        queue: asyncio.Queue = asyncio.Queue(maxsize=32)
        loop = asyncio.get_event_loop()

        def _producer():
            try:
                for fragment in self._voice.synthesize(text):
                    # piper returns AudioChunk with audio_float_array in [-1, 1]
                    arr = fragment.audio_float_array
                    if arr is not None and len(arr):
                        loop.call_soon_threadsafe(queue.put_nowait, arr)
            except Exception as e:
                loop.call_soon_threadsafe(queue.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, _PIPER_STREAM_DONE)

        t0 = time.time()
        producer_fut = loop.run_in_executor(None, _producer)

        first_yielded = False
        leftover = np.empty(0, dtype=np.int16)
        target_sr = self.OUTPUT_SAMPLE_RATE
        native_sr = self._native_sample_rate

        while True:
            item = await queue.get()
            if isinstance(item, Exception):
                print(f"[Piper] Streaming error: {item}")
                break
            if item is _PIPER_STREAM_DONE:
                # Flush any leftover bytes as final frames.
                if len(leftover):
                    yield (leftover, True)
                elif not first_yielded:
                    return
                else:
                    # Emit an empty final frame so the consumer sees is_final.
                    yield (np.empty(0, dtype=np.int16), True)
                break

            fragment = item
            resampled = self._resample(fragment, native_sr, target_sr) if native_sr != target_sr else fragment
            int16 = (np.clip(resampled, -1.0, 1.0) * 32767).astype(np.int16)
            if len(leftover):
                int16 = np.concatenate([leftover, int16])
                leftover = np.empty(0, dtype=np.int16)

            if not first_yielded:
                print(f"[Piper] First fragment ready in {(time.time() - t0) * 1000:.0f}ms (stream)")

            # Yield full-sized chunks; carry the tail to the next iteration.
            total = len(int16)
            full = total - (total % chunk_size)
            for i in range(0, full, chunk_size):
                yield (int16[i:i + chunk_size], False)
                first_yielded = True
            leftover = int16[full:]

        await producer_fut
        if first_yielded:
            print(f"[Piper] Stream completed in {(time.time() - t0) * 1000:.0f}ms")

    def _synthesize_raw(self, text: str) -> Tuple[Optional[np.ndarray], int]:
        """Synchronous, blocking synthesis. Returns (float32_audio, sample_rate)."""
        try:
            audio_chunks = []
            sample_rate = getattr(self._voice.config, 'sample_rate', None) or self.PIPER_SAMPLE_RATE
            for audio_chunk in self._voice.synthesize(text):
                audio_chunks.append(audio_chunk.audio_float_array)
            if not audio_chunks:
                return None, 0
            return np.concatenate(audio_chunks), sample_rate
        except Exception as e:
            print(f"[Piper] Raw synthesis error: {e}")
            return None, 0

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        if orig_sr == target_sr or len(audio) == 0:
            return audio
        if SCIPY_AVAILABLE:
            num_samples = int(len(audio) * target_sr / orig_sr)
            return scipy.signal.resample(audio, num_samples).astype(np.float32, copy=False)
        ratio = target_sr / orig_sr
        new_length = int(len(audio) * ratio)
        indices = np.linspace(0, len(audio) - 1, new_length)
        return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)

    def _resample_by_length(self, audio: np.ndarray, target_length: int) -> np.ndarray:
        """Resample audio to a specific target length."""
        if SCIPY_AVAILABLE:
            return scipy.signal.resample(audio, target_length).astype(np.float32, copy=False)
        indices = np.linspace(0, len(audio) - 1, target_length)
        return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)

    def _normalize_audio(self, audio: np.ndarray) -> np.ndarray:
        """Normalize audio to -3dB peak."""
        audio = audio - np.mean(audio)
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio * (0.707 / max_val)  # -3dB
        return audio.astype(np.float32)

    async def cleanup(self) -> None:
        """Clean up Piper provider."""
        self._voice = None
        self._initialized = False
        print("[Piper] Cleanup completed")
