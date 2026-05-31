"""Kokoro TTS Provider - Local ONNX-based TTS with GPU acceleration.

Optimized for TTFB:
- Warm-up call at end of initialize() so the first real request doesn't pay
  for ONNX session JIT.
- Smaller first chunk (KOKORO_FIRST_CHUNK_CHARS, default 120) so audio ships
  sooner; subsequent chunks use the larger cap.
- Real synthesize_stream() override: yields chunk[N] audio frames while
  chunk[N+1] is being synthesized. The earlier asyncio.gather "parallel"
  pattern was misleading — kokoro_onnx serializes through a single ONNX
  session, so the fan-out only added overhead.
"""

import asyncio
import os
import re
import time
from typing import Optional, Tuple, List, AsyncGenerator
import numpy as np

from .base import TTSProvider

# Check if kokoro-onnx is available
try:
    import kokoro_onnx
    KOKORO_AVAILABLE = True
except ImportError:
    KOKORO_AVAILABLE = False
    kokoro_onnx = None

try:
    import scipy.signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


class KokoroProvider(TTSProvider):
    """Kokoro TTS provider using local ONNX model.

    Features:
    - Local inference (no cloud dependency)
    - GPU acceleration via CUDA
    - ~50-100ms latency
    - High quality neural voices
    - Automatic text chunking for long inputs (510 token limit)
    """

    # Preferred voices in order of quality
    DEFAULT_VOICES = ['af_sarah', 'af_bella', 'af_nicole', 'af_sky', 'af']

    # Kokoro has a 510 token limit (512 context - 2 pad tokens)
    # Text-to-phoneme conversion typically expands by ~1.5x
    # So 300 chars ≈ 450 tokens, safely under 510.
    DEFAULT_MAX_CHARS_PER_CHUNK = 300
    # First chunk intentionally short so we can ship audio sooner.
    DEFAULT_FIRST_CHUNK_CHARS = 120

    def __init__(self):
        self._initialized = False
        self._model = None
        self._model_path = None
        self._voices_path = None
        self._default_voice = os.getenv('KOKORO_VOICE', self.DEFAULT_VOICES[0])
        self._working_voice: Optional[str] = None  # cached after first successful synth
        self._max_chars = int(os.getenv('KOKORO_MAX_CHARS_PER_CHUNK',
                                        str(self.DEFAULT_MAX_CHARS_PER_CHUNK)))
        self._first_chunk_chars = int(os.getenv('KOKORO_FIRST_CHUNK_CHARS',
                                                str(self.DEFAULT_FIRST_CHUNK_CHARS)))

    @property
    def name(self) -> str:
        return "kokoro"

    @property
    def is_available(self) -> bool:
        return KOKORO_AVAILABLE

    def _parse_onnx_providers(self) -> list:
        """Parse ONNX_PROVIDER environment variable into provider list."""
        try:
            onnx_provider_str = os.getenv('ONNX_PROVIDER', 'CPUExecutionProvider')

            # Parse comma-separated string
            if ',' in onnx_provider_str:
                providers = [p.strip() for p in onnx_provider_str.split(',')]
            else:
                providers = [onnx_provider_str.strip()]

            print(f"[Kokoro] ONNX providers: {providers}")
            return providers
        except Exception as e:
            print(f"[Kokoro] Error parsing ONNX providers: {e}, using CPU")
            return ['CPUExecutionProvider']

    async def initialize(self) -> bool:
        """Initialize Kokoro TTS provider."""
        if not self.is_available:
            print("[Kokoro] kokoro-onnx not available")
            return False

        try:
            print("[Kokoro] Initializing Kokoro TTS provider...")

            # Determine model paths
            cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
            if not os.path.exists(cache_dir):
                cache_dir = os.path.expanduser('~/.cache/kokoro')

            self._model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
            self._voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

            # Check if models exist
            if not os.path.exists(self._model_path):
                print(f"[Kokoro] Model not found at: {self._model_path}")
                print("[Kokoro] Run download_kokoro_models.py first")
                return False

            if not os.path.exists(self._voices_path):
                print(f"[Kokoro] Voices not found at: {self._voices_path}")
                return False

            # Get ONNX providers
            providers = self._parse_onnx_providers()

            # Set ONNX_PROVIDER to primary provider only
            # kokoro-onnx reads ONNX_PROVIDER directly and can't handle comma-separated lists
            primary_provider = providers[0] if providers else 'CPUExecutionProvider'
            os.environ['ONNX_PROVIDER'] = primary_provider
            print(f"[Kokoro] Using ONNX provider: {primary_provider}")

            # Initialize Kokoro model
            print(f"[Kokoro] Loading model from: {self._model_path}")
            self._model = kokoro_onnx.Kokoro(
                self._model_path,
                self._voices_path,
            )

            self._initialized = True
            print(f"[Kokoro] Initialized (voice={self._default_voice}, "
                  f"first_chunk={self._first_chunk_chars}c, max_chunk={self._max_chars}c)")

            # ONNX session warm-up — pays the kernel JIT / cudnn benchmark
            # cost once at startup so the first real request is fast.
            await self._warm_up()

            return True

        except Exception as e:
            print(f"[Kokoro] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def _warm_up(self) -> None:
        """Run a tiny synth so the first real request hits warm kernels."""
        try:
            t0 = time.time()
            await self._resolve_working_voice("Hi.", None)
            print(f"[Kokoro] Warm-up complete in {(time.time() - t0) * 1000:.0f}ms")
        except Exception as e:
            print(f"[Kokoro] Warm-up failed (non-fatal): {e}")

    def _split_text_into_chunks(self, text: str) -> List[str]:
        """Split text into chunks that fit within Kokoro's 510 token limit.

        Strategy:
        1. If text <= 300 chars, return as single chunk (300 chars ≈ 450 tokens)
        2. If text > 300 chars, split into sentences
        3. Combine sentences into chunks up to 300 chars each
        4. If a sentence > 300 chars, split at punctuation (comma, semicolon, colon)
        5. If still > 300 chars, split by words as last resort
        """
        text = text.strip()
        if not text:
            return []

        # Short enough for a single chunk → return as-is. We compare against
        # the *first-chunk* cap, not the larger max, so a slightly-over-120
        # input still gets split into a tiny opener + the remainder for fast TTFB.
        if len(text) <= self._first_chunk_chars:
            return [text]

        sentences = self._split_into_sentences(text)

        chunks: List[str] = []
        current = ""
        cap_for_index = lambda i: self._first_chunk_chars if i == 0 else self._max_chars

        for sentence in sentences:
            cap = cap_for_index(len(chunks))
            potential = f"{current} {sentence}".strip() if current else sentence
            if len(potential) <= cap:
                current = potential
            else:
                if current:
                    chunks.append(current)
                cap = cap_for_index(len(chunks))
                if len(sentence) <= cap:
                    current = sentence
                else:
                    sub_chunks = self._split_long_sentence(sentence, cap)
                    for sub in sub_chunks[:-1]:
                        chunks.append(sub)
                        cap = cap_for_index(len(chunks))
                    current = sub_chunks[-1] if sub_chunks else ""

        if current:
            chunks.append(current)

        if len(chunks) > 1:
            print(f"[Kokoro] Split into {len(chunks)} chunks "
                  f"(first={len(chunks[0])}c, rest={[len(c) for c in chunks[1:]]})")
        return chunks

    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences at sentence-ending punctuation."""
        # Split at . ! ? followed by space or end of string
        # Use lookbehind to keep the punctuation with the sentence
        sentence_pattern = r'(?<=[.!?])\s+'
        sentences = re.split(sentence_pattern, text)
        sentences = [s.strip() for s in sentences if s.strip()]
        return sentences

    def _split_long_sentence(self, sentence: str, cap: int) -> List[str]:
        """Split a long sentence at punctuation, then by words if needed."""
        punct_pattern = r'(?<=[,;:])\s+'
        parts = re.split(punct_pattern, sentence)
        parts = [p.strip() for p in parts if p.strip()]

        if len(parts) > 1:
            chunks = []
            current = ""
            for part in parts:
                potential = f"{current}, {part}".strip(', ') if current else part
                if len(potential) <= cap:
                    current = potential
                else:
                    if current:
                        chunks.append(current)
                    if len(part) <= cap:
                        current = part
                    else:
                        word_chunks = self._split_by_words(part, cap)
                        for wc in word_chunks[:-1]:
                            chunks.append(wc)
                        current = word_chunks[-1] if word_chunks else ""
            if current:
                chunks.append(current)
            return chunks

        return self._split_by_words(sentence, cap)

    def _split_by_words(self, text: str, cap: int) -> List[str]:
        """Split text by words to fit under `cap` characters."""
        words = text.split()
        chunks = []
        current = ""

        for word in words:
            potential = f"{current} {word}".strip() if current else word
            if len(potential) <= cap:
                current = potential
            else:
                if current:
                    chunks.append(current)
                current = word

        if current:
            chunks.append(current)

        print(f"[Kokoro] Split by words into {len(chunks)} chunks")
        return chunks

    async def _synthesize_single_chunk(
        self,
        text: str,
        voice_id: str,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize a single text chunk."""
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self._model.create(text, voice=voice_id)
            )
            return await self._process_audio(result)
        except Exception as e:
            print(f"[Kokoro] Chunk synthesis failed: {e}")
            return None, 0

    async def _resolve_working_voice(
        self,
        chunk0: str,
        requested_voice: Optional[str],
    ) -> Tuple[Optional[str], Optional[np.ndarray]]:
        """Find a voice that the model accepts, synthesizing chunk[0] in the process.

        Returns (working_voice, first_chunk_audio). The audio is the byproduct
        of the validation pass, so we don't repeat the synthesis later.
        Once a voice has been validated, subsequent calls reuse it (self._working_voice).
        """
        voices_to_try: List[str] = []
        if requested_voice:
            voices_to_try.append(requested_voice)
        # Prefer the previously-validated voice if any.
        if self._working_voice and self._working_voice not in voices_to_try:
            voices_to_try.append(self._working_voice)
        if self._default_voice not in voices_to_try:
            voices_to_try.append(self._default_voice)
        voices_to_try.extend(v for v in self.DEFAULT_VOICES if v not in voices_to_try)

        for voice_id in voices_to_try:
            try:
                audio, _ = await self._synthesize_single_chunk(chunk0, voice_id)
                if audio is not None:
                    if self._working_voice != voice_id:
                        print(f"[Kokoro] Validated voice: {voice_id}")
                    self._working_voice = voice_id
                    return voice_id, audio
            except Exception as e:
                print(f"[Kokoro] Voice '{voice_id}' test failed: {e}")
                continue

        return None, None

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        language: Optional[str] = None,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text using Kokoro (non-streaming).

        Note: Kokoro is English-only. The `language` parameter is accepted
        but ignored.

        For TTFB-sensitive callers, use the streaming path (`synthesize_stream`)
        — it yields chunk N audio while chunk N+1 is being synthesized.
        """
        if not self._initialized or not self._model:
            print("[Kokoro] Not initialized")
            return None
        if not text or not text.strip():
            return None

        chunks = self._split_text_into_chunks(text)
        if not chunks:
            return None

        t0 = time.time()
        working_voice, first_audio = await self._resolve_working_voice(chunks[0], voice)
        if working_voice is None or first_audio is None:
            print("[Kokoro] No working voice found")
            return None

        sample_rate = 24000

        if len(chunks) == 1:
            total_ms = (time.time() - t0) * 1000.0
            print(f"[Kokoro] Synthesized {len(first_audio)} samples in {total_ms:.0f}ms (1 chunk, voice={working_voice})")
            return (first_audio, sample_rate)

        # Sequential synth for the rest. The previous asyncio.gather fan-out
        # was misleading — kokoro_onnx serializes through a single ONNX
        # session, so concurrency adds overhead without helping throughput.
        pause = np.zeros(int(0.1 * sample_rate), dtype=np.float32)
        combined: List[np.ndarray] = [first_audio]

        for idx in range(1, len(chunks)):
            combined.append(pause)
            audio, _ = await self._synthesize_single_chunk(chunks[idx], working_voice)
            if audio is None:
                print(f"[Kokoro] Warning: chunk {idx + 1}/{len(chunks)} failed")
                continue
            combined.append(audio)

        final_audio = self._normalize_audio(np.concatenate(combined))
        total_ms = (time.time() - t0) * 1000.0
        print(f"[Kokoro] Synthesized {len(final_audio)} samples in {total_ms:.0f}ms ({len(chunks)} chunks, voice={working_voice})")
        return (final_audio, sample_rate)

    async def synthesize_stream(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        chunk_size: int = 480,
        language: Optional[str] = None,
    ) -> AsyncGenerator[Tuple[np.ndarray, bool], None]:
        """Streaming synthesis with chunk pipelining.

        Yields chunk[0]'s audio (sliced into `chunk_size` samples) as soon
        as it's ready; chunk[N+1] is kicked off before chunk[N]'s frames
        are emitted, so the ONNX session overlaps with downstream playback.
        """
        if not self._initialized or not self._model:
            print("[Kokoro] Not initialized")
            return
        if not text or not text.strip():
            return

        chunks = self._split_text_into_chunks(text)
        if not chunks:
            return

        t0 = time.time()
        working_voice, audio_0 = await self._resolve_working_voice(chunks[0], voice)
        if working_voice is None or audio_0 is None:
            print("[Kokoro] No working voice found (stream)")
            return

        sample_rate = 24000
        ttfb_ms = (time.time() - t0) * 1000.0
        print(f"[Kokoro] First chunk ready in {ttfb_ms:.0f}ms (stream, voice={working_voice})")

        pending: Optional[asyncio.Task] = None
        if len(chunks) > 1:
            pending = asyncio.create_task(
                self._synthesize_single_chunk(chunks[1], working_voice)
            )

        pause_int16 = np.zeros(int(0.05 * sample_rate), dtype=np.int16)  # 50ms

        for idx in range(len(chunks)):
            if idx == 0:
                audio_chunk = audio_0
            else:
                result = await pending  # type: ignore[arg-type]
                pending = None
                if idx + 1 < len(chunks):
                    pending = asyncio.create_task(
                        self._synthesize_single_chunk(chunks[idx + 1], working_voice)
                    )
                if result is None or result[0] is None:
                    print(f"[Kokoro] Warning: chunk {idx + 1}/{len(chunks)} failed (stream)")
                    continue
                audio_chunk = result[0]
                yield (pause_int16, False)

            int16 = (np.clip(audio_chunk, -1.0, 1.0) * 32767).astype(np.int16)
            is_last_chunk = (idx == len(chunks) - 1)
            total = len(int16)
            for i in range(0, total, chunk_size):
                is_final = is_last_chunk and (i + chunk_size >= total)
                yield (int16[i:i + chunk_size], is_final)

        total_ms = (time.time() - t0) * 1000.0
        print(f"[Kokoro] Stream completed in {total_ms:.0f}ms ({len(chunks)} chunks)")

    async def _process_audio(self, result) -> Tuple[Optional[np.ndarray], int]:
        """Process Kokoro audio output to 24kHz mono float32."""
        try:
            if isinstance(result, tuple):
                raw_audio, sample_rate = result
            else:
                print(f"[Kokoro] Unexpected result type: {type(result)}")
                return None, 0

            # Convert to numpy array
            if isinstance(raw_audio, bytes):
                audio_data = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0
            elif isinstance(raw_audio, np.ndarray):
                if raw_audio.dtype == np.int16:
                    audio_data = raw_audio.astype(np.float32) / 32768.0
                elif raw_audio.dtype == np.int32:
                    audio_data = raw_audio.astype(np.float32) / 2147483648.0
                elif raw_audio.dtype in [np.float32, np.float64]:
                    audio_data = raw_audio.astype(np.float32)
                    max_val = np.max(np.abs(audio_data))
                    if max_val > 1.0:
                        audio_data = audio_data / max_val
                else:
                    audio_data = raw_audio.astype(np.float32)
            else:
                audio_data = np.array(raw_audio, dtype=np.float32)

            # Ensure mono
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)

            # Resample to 24kHz for higher quality output
            if sample_rate != 24000:
                audio_data = self._resample(audio_data, sample_rate, 24000)
                sample_rate = 24000

            # Normalize audio
            audio_data = self._normalize_audio(audio_data)

            return audio_data.astype(np.float32), sample_rate

        except Exception as e:
            print(f"[Kokoro] Failed to process audio: {e}")
            import traceback
            traceback.print_exc()
            return None, 0

    def _resample(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        if SCIPY_AVAILABLE:
            num_samples = int(len(audio) * target_sr / orig_sr)
            return scipy.signal.resample(audio, num_samples)
        else:
            # Simple linear interpolation fallback
            ratio = target_sr / orig_sr
            new_length = int(len(audio) * ratio)
            indices = np.linspace(0, len(audio) - 1, new_length)
            return np.interp(indices, np.arange(len(audio)), audio)

    def _normalize_audio(self, audio: np.ndarray) -> np.ndarray:
        """Normalize audio to -3dB peak for optimal quality."""
        # Remove DC offset
        audio = audio - np.mean(audio)

        # Normalize to -3dB peak (0.707 amplitude) for headroom
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            target_peak = 0.707  # -3dB
            audio = audio * (target_peak / max_val)

        return audio

    async def cleanup(self) -> None:
        """Clean up Kokoro provider."""
        self._model = None
        self._initialized = False
        print("[Kokoro] Cleanup completed")
