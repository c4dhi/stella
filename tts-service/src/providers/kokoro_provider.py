"""Kokoro TTS Provider - Local ONNX-based TTS with GPU acceleration."""

import asyncio
import os
import re
from typing import Optional, Tuple, List
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
    # Conservative estimate: ~4 chars per token, so ~200 chars per chunk is safe
    # We use sentences as natural break points
    MAX_CHARS_PER_CHUNK = 200
    MAX_WORDS_PER_CHUNK = 40  # ~40 words is safely under 510 tokens

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
            return True

        except Exception as e:
            print(f"[Kokoro] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    def _split_text_into_chunks(self, text: str) -> List[str]:
        """Split text into chunks that fit within Kokoro's 510 token limit.

        Strategy:
        1. Split by sentences first (natural break points)
        2. If a sentence is too long, split by clauses (commas, semicolons)
        3. If still too long, split by word count
        """
        text = text.strip()
        if not text:
            return []

        # Check if text is short enough
        word_count = len(text.split())
        if word_count <= self.MAX_WORDS_PER_CHUNK and len(text) <= self.MAX_CHARS_PER_CHUNK:
            return [text]

        chunks = []

        # Split by sentence boundaries
        # Match sentences ending with . ! ? or followed by newlines
        sentence_pattern = r'(?<=[.!?])\s+|(?<=\n)'
        sentences = re.split(sentence_pattern, text)
        sentences = [s.strip() for s in sentences if s.strip()]

        current_chunk = ""

        for sentence in sentences:
            # Check if adding this sentence would exceed limits
            potential_chunk = f"{current_chunk} {sentence}".strip() if current_chunk else sentence
            potential_words = len(potential_chunk.split())

            if potential_words <= self.MAX_WORDS_PER_CHUNK and len(potential_chunk) <= self.MAX_CHARS_PER_CHUNK:
                current_chunk = potential_chunk
            else:
                # Save current chunk if not empty
                if current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = ""

                # Check if this sentence alone is too long
                sentence_words = len(sentence.split())
                if sentence_words <= self.MAX_WORDS_PER_CHUNK and len(sentence) <= self.MAX_CHARS_PER_CHUNK:
                    current_chunk = sentence
                else:
                    # Split long sentence by clauses or words
                    sub_chunks = self._split_long_sentence(sentence)
                    for sub in sub_chunks[:-1]:
                        chunks.append(sub)
                    # Keep the last sub-chunk as current
                    if sub_chunks:
                        current_chunk = sub_chunks[-1]

        # Add remaining chunk
        if current_chunk:
            chunks.append(current_chunk)

        print(f"[Kokoro] Split text into {len(chunks)} chunks: {[len(c.split()) for c in chunks]} words each")
        return chunks

    def _split_long_sentence(self, sentence: str) -> List[str]:
        """Split a long sentence into smaller chunks by clauses or words."""
        # Try splitting by common clause separators
        clause_pattern = r'(?<=[,;:])\s+'
        clauses = re.split(clause_pattern, sentence)
        clauses = [c.strip() for c in clauses if c.strip()]

        if len(clauses) > 1:
            # Recombine clauses into chunks under the limit
            chunks = []
            current = ""
            for clause in clauses:
                potential = f"{current}, {clause}".strip(', ') if current else clause
                if len(potential.split()) <= self.MAX_WORDS_PER_CHUNK:
                    current = potential
                else:
                    if current:
                        chunks.append(current)
                    current = clause
            if current:
                chunks.append(current)
            return chunks

        # Last resort: split by words
        words = sentence.split()
        chunks = []
        for i in range(0, len(words), self.MAX_WORDS_PER_CHUNK):
            chunk = ' '.join(words[i:i + self.MAX_WORDS_PER_CHUNK])
            chunks.append(chunk)
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
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize text using Kokoro TTS.

        Handles long text by splitting into chunks and concatenating audio.
        Kokoro has a 510 token limit (~40 words per chunk).
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

        # Multiple chunks - start with first chunk result, then synthesize rest
        audio_segments = [first_chunk_audio]

        for i, chunk in enumerate(chunks[1:], start=2):
            print(f"[Kokoro] Synthesizing chunk {i}/{len(chunks)}: '{chunk[:50]}...'")
            audio_data, _ = await self._synthesize_single_chunk(chunk, working_voice)

            if audio_data is not None:
                audio_segments.append(audio_data)
            else:
                print(f"[Kokoro] Warning: Chunk {i+1} failed to synthesize")

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
