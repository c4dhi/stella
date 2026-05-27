"""Kokoro TTS Provider - Local ONNX-based TTS with GPU acceleration."""

import asyncio
import os
import re
from typing import Optional, Tuple, List
import numpy as np

from .base import TTSProvider
from latency_probe import run_latency_probe

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
    # So 300 chars ≈ 450 tokens, safely under 510
    # If text exceeds this, split into sentences first
    MAX_CHARS_PER_CHUNK = 300

    def __init__(self):
        self._initialized = False
        self._model = None
        self._model_path = None
        self._voices_path = None
        self._default_voice = os.getenv('KOKORO_VOICE', self.DEFAULT_VOICES[0])

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
            print(f"[Kokoro] Initialized successfully with voice: {self._default_voice}")
            if os.getenv("MODEL_LATENCY_PROBE_ENABLED", "false").lower() == "true":
                asyncio.create_task(self._run_latency_probe())
            return True

        except Exception as e:
            print(f"[Kokoro] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def _run_latency_probe(self) -> None:
        async def infer_once() -> None:
            result = await self.synthesize("Hello World.")
            if result is None:
                raise RuntimeError("Kokoro synthesize returned no audio")

        await run_latency_probe(
            provider=self.name,
            provider_type="tts",
            inference_fn=infer_once,
            metadata={
                "model": "kokoro-v1.0.onnx",
                "voice": self._default_voice,
                "device": os.getenv("ONNX_PROVIDER", "CPUExecutionProvider"),
                "onnx_provider": os.getenv("ONNX_PROVIDER", "CPUExecutionProvider"),
                "language": "",
            },
        )

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

        print(f"[Kokoro] Input text: {len(text)} chars, {len(text.split())} words")

        # If text is short enough, return as single chunk
        if len(text) <= self.MAX_CHARS_PER_CHUNK:
            print(f"[Kokoro] Text under {self.MAX_CHARS_PER_CHUNK} chars, no chunking needed")
            return [text]

        print(f"[Kokoro] Text exceeds {self.MAX_CHARS_PER_CHUNK} chars, splitting into sentences...")

        # Split into sentences
        sentences = self._split_into_sentences(text)
        print(f"[Kokoro] Found {len(sentences)} sentences")

        # Process each sentence and build chunks
        chunks = []
        current_chunk = ""

        for sentence in sentences:
            # Check if adding this sentence keeps chunk under limit
            potential_chunk = f"{current_chunk} {sentence}".strip() if current_chunk else sentence

            if len(potential_chunk) <= self.MAX_CHARS_PER_CHUNK:
                # Safe to add sentence to current chunk
                current_chunk = potential_chunk
            else:
                # Save current chunk if not empty
                if current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = ""

                # Check if this sentence alone fits
                if len(sentence) <= self.MAX_CHARS_PER_CHUNK:
                    current_chunk = sentence
                else:
                    # Sentence too long - split at punctuation
                    print(f"[Kokoro] Sentence too long ({len(sentence)} chars), splitting at punctuation...")
                    sub_chunks = self._split_long_sentence(sentence)
                    # Add all but last to chunks, keep last as current
                    for sub in sub_chunks[:-1]:
                        chunks.append(sub)
                    if sub_chunks:
                        current_chunk = sub_chunks[-1]

        # Add remaining chunk
        if current_chunk:
            chunks.append(current_chunk)

        print(f"[Kokoro] Split text into {len(chunks)} chunks: {[len(c) for c in chunks]} chars each")
        return chunks

    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences at sentence-ending punctuation."""
        # Split at . ! ? followed by space or end of string
        # Use lookbehind to keep the punctuation with the sentence
        sentence_pattern = r'(?<=[.!?])\s+'
        sentences = re.split(sentence_pattern, text)
        sentences = [s.strip() for s in sentences if s.strip()]
        return sentences

    def _split_long_sentence(self, sentence: str) -> List[str]:
        """Split a long sentence into smaller chunks.

        Strategy:
        1. Try splitting at punctuation (comma, semicolon, colon)
        2. If still too long, split by words
        """
        # Try splitting at punctuation marks
        punct_pattern = r'(?<=[,;:])\s+'
        parts = re.split(punct_pattern, sentence)
        parts = [p.strip() for p in parts if p.strip()]

        if len(parts) > 1:
            # Recombine parts into chunks under the limit
            chunks = []
            current = ""
            for part in parts:
                potential = f"{current}, {part}".strip(', ') if current else part
                if len(potential) <= self.MAX_CHARS_PER_CHUNK:
                    current = potential
                else:
                    if current:
                        chunks.append(current)
                    # Check if this part alone is too long
                    if len(part) <= self.MAX_CHARS_PER_CHUNK:
                        current = part
                    else:
                        # Part still too long, split by words
                        word_chunks = self._split_by_words(part)
                        for wc in word_chunks[:-1]:
                            chunks.append(wc)
                        current = word_chunks[-1] if word_chunks else ""
            if current:
                chunks.append(current)
            return chunks

        # No punctuation found, split by words
        return self._split_by_words(sentence)

    def _split_by_words(self, text: str) -> List[str]:
        """Split text by words to fit under MAX_CHARS_PER_CHUNK."""
        words = text.split()
        chunks = []
        current = ""

        for word in words:
            potential = f"{current} {word}".strip() if current else word
            if len(potential) <= self.MAX_CHARS_PER_CHUNK:
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

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        language: Optional[str] = None,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text using Kokoro TTS.

        Note: Kokoro is English-only. The language parameter is accepted but ignored.

        Handles long text (>300 chars) by:
        1. Splitting into sentences
        2. Combining sentences into chunks up to 300 chars
        3. Synthesizing each chunk and concatenating audio
        """
        if not self._initialized or not self._model:
            print("[Kokoro] Not initialized")
            return None

        if not text or not text.strip():
            print("[Kokoro] Empty text provided")
            return None

        # Split text into manageable chunks
        chunks = self._split_text_into_chunks(text)
        if not chunks:
            print("[Kokoro] No chunks to synthesize")
            return None

        # Build voice list to try
        voices_to_try = []
        if voice:
            voices_to_try.append(voice)
        voices_to_try.append(self._default_voice)
        voices_to_try.extend([v for v in self.DEFAULT_VOICES if v not in voices_to_try])

        # Find a working voice and get first chunk audio
        working_voice = None
        first_chunk_audio = None
        for voice_id in voices_to_try:
            try:
                # Test with first chunk
                test_result = await self._synthesize_single_chunk(chunks[0], voice_id)
                if test_result[0] is not None:
                    working_voice = voice_id
                    first_chunk_audio = test_result[0]
                    break
            except Exception as e:
                print(f"[Kokoro] Voice '{voice_id}' test failed: {e}")
                continue

        if not working_voice or first_chunk_audio is None:
            print("[Kokoro] No working voice found")
            return None

        # Synthesize all chunks
        sample_rate = 24000

        # If we only have one chunk, return the result from the test
        if len(chunks) == 1:
            print(f"[Kokoro] Synthesized {len(first_chunk_audio)} samples (single chunk) using voice: {working_voice}")
            return (first_chunk_audio, sample_rate)

        # Multiple chunks - synthesize remaining chunks in PARALLEL for lower latency
        audio_segments = [first_chunk_audio]

        print(f"[Kokoro] Synthesizing {len(chunks) - 1} remaining chunks in parallel...")

        # Create tasks for all remaining chunks
        tasks = [
            self._synthesize_single_chunk(chunk, working_voice)
            for chunk in chunks[1:]
        ]

        # Execute all tasks in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Collect successful results in order
        for i, result in enumerate(results, start=2):
            if isinstance(result, Exception):
                print(f"[Kokoro] Warning: Chunk {i}/{len(chunks)} failed: {result}")
            elif result[0] is not None:
                audio_segments.append(result[0])
            else:
                print(f"[Kokoro] Warning: Chunk {i}/{len(chunks)} returned None")

        if not audio_segments:
            print("[Kokoro] All chunks failed")
            return None

        # Concatenate audio segments with small pause between them
        # Add ~100ms pause (2400 samples at 24kHz) between chunks for natural speech
        pause_samples = int(0.1 * sample_rate)  # 100ms pause
        pause = np.zeros(pause_samples, dtype=np.float32)

        combined_audio = []
        for i, segment in enumerate(audio_segments):
            combined_audio.append(segment)
            # Add pause between segments (not after last one)
            if i < len(audio_segments) - 1:
                combined_audio.append(pause)

        final_audio = np.concatenate(combined_audio)

        # Normalize the combined audio
        final_audio = self._normalize_audio(final_audio)

        print(f"[Kokoro] Synthesized {len(final_audio)} samples ({len(chunks)} chunks) using voice: {working_voice}")
        return (final_audio, sample_rate)

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
