"""ChatterBox Multilingual TTS Provider — local PyTorch-based TTS (EN/DE).

Optimized for time-to-first-byte (TTFB):

- GPU warm-up call at the end of initialize() so the first real request
  doesn't pay for CUDA kernel JIT / cudnn benchmark.
- `torch.inference_mode()` instead of `no_grad()` (skips view tracking).
- Optional `torch.autocast(cuda, fp16)` around `.generate()` to use fp16
  matmul on tensor-core GPUs without converting the weight tensors.
- Smaller first chunk (env: CHATTERBOX_FIRST_CHUNK_CHARS) so the first
  audio sample ships sooner; subsequent chunks use the larger limit.
- `synthesize_stream()` is now a real pipeline: it yields chunk N's audio
  while chunk N+1 is being generated on the GPU. The earlier "parallel"
  asyncio.gather pattern was misleading — a single CUDA stream serializes
  the work anyway, so the fan-out only added overhead.
"""

import asyncio
import contextlib
import os
import re
import time
from pathlib import Path
from typing import Optional, Tuple, List, AsyncGenerator
import numpy as np

from .base import TTSProvider

# Check if chatterbox is available
try:
    import torch
    import torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    CHATTERBOX_AVAILABLE = True
except ImportError:
    CHATTERBOX_AVAILABLE = False
    torch = None
    torchaudio = None
    ChatterboxMultilingualTTS = None

try:
    import scipy.signal
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


# Supported languages with ISO 639-1 codes
SUPPORTED_LANGUAGES = {"en", "de"}
DEFAULT_LANGUAGE = "en"


class ChatterBoxProvider(TTSProvider):
    """ChatterBox Multilingual TTS provider using a local PyTorch model.

    Features:
    - Local inference (no cloud dependency)
    - GPU acceleration via CUDA (with fp16 autocast where available)
    - Multilingual support (English + German)
    - Optional voice cloning via audio prompt
    - 24kHz output sample rate
    """

    # Default upper bound for any single chunk. Long chunks improve total
    # synthesis time slightly but hurt TTFB; short chunks do the opposite.
    DEFAULT_MAX_CHARS_PER_CHUNK = 300
    # First chunk is intentionally shorter so we can ship audio sooner.
    DEFAULT_FIRST_CHUNK_CHARS = 120

    def __init__(self):
        self._initialized = False
        self._model = None
        self._device = None
        self._use_autocast = False
        self._default_language = os.getenv('CHATTERBOX_LANGUAGE', DEFAULT_LANGUAGE)
        self._exaggeration = float(os.getenv('CHATTERBOX_EXAGGERATION', '0.5'))
        self._cfg_weight = float(os.getenv('CHATTERBOX_CFG_WEIGHT', '0.5'))
        self._audio_prompt_path = os.getenv('CHATTERBOX_AUDIO_PROMPT', None)
        self._max_chars = int(os.getenv('CHATTERBOX_MAX_CHARS_PER_CHUNK',
                                        str(self.DEFAULT_MAX_CHARS_PER_CHUNK)))
        self._first_chunk_chars = int(os.getenv('CHATTERBOX_FIRST_CHUNK_CHARS',
                                                str(self.DEFAULT_FIRST_CHUNK_CHARS)))
        # Autocast is opt-out (default on for CUDA) — it gives ~1.3-1.7x
        # speedup on Ampere+ with no measurable quality loss. Disable via
        # CHATTERBOX_AUTOCAST=false if you hit numerical issues.
        self._autocast_env = os.getenv('CHATTERBOX_AUTOCAST', 'true').lower() == 'true'

    @property
    def name(self) -> str:
        return "chatterbox"

    @property
    def is_available(self) -> bool:
        return CHATTERBOX_AVAILABLE

    def _select_device(self) -> str:
        """Select the best available device."""
        device_env = os.getenv('CHATTERBOX_DEVICE', 'auto')
        if device_env != 'auto':
            return device_env

        if torch.cuda.is_available():
            return "cuda"
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    async def initialize(self) -> bool:
        """Initialize ChatterBox multilingual TTS provider."""
        if not self.is_available:
            print("[ChatterBox] chatterbox-tts not available")
            return False

        try:
            print("[ChatterBox] Initializing ChatterBox multilingual TTS provider...")

            self._device = self._select_device()
            self._use_autocast = self._autocast_env and self._device == "cuda"
            print(f"[ChatterBox] Using device: {self._device}"
                  + (f" (fp16 autocast)" if self._use_autocast else ""))

            cache_dir = os.getenv('CHATTERBOX_CACHE_DIR', '/root/.cache/chatterbox')

            # Patch llama config to use eager attention instead of sdpa.
            # SDPA is incompatible with output_attentions=True used by
            # ChatterBox's T3 model. Replacing it would be the next-level
            # speedup but requires upstream support.
            try:
                from chatterbox.models.t3 import llama_configs
                for cfg in llama_configs.LLAMA_CONFIGS.values():
                    if isinstance(cfg, dict) and 'attn_implementation' in cfg:
                        cfg['attn_implementation'] = 'eager'
                print("[ChatterBox] Patched attention implementation to 'eager'")
            except Exception as e:
                print(f"[ChatterBox] Warning: Could not patch attn_implementation: {e}")

            # Patch torch.load to always map to the selected device — fixes
            # loading CUDA-saved checkpoints on CPU-only machines.
            device = torch.device(self._device)
            _original_torch_load = torch.load
            def _patched_torch_load(*args, **kwargs):
                kwargs.setdefault('map_location', device)
                return _original_torch_load(*args, **kwargs)

            t_load = time.time()
            if os.path.exists(cache_dir) and os.path.exists(os.path.join(cache_dir, 's3gen.pt')):
                print(f"[ChatterBox] Loading model from local cache: {cache_dir}")
                loop = asyncio.get_event_loop()
                torch.load = _patched_torch_load
                try:
                    self._model = await loop.run_in_executor(
                        None,
                        lambda: ChatterboxMultilingualTTS.from_local(
                            Path(cache_dir), device
                        )
                    )
                finally:
                    torch.load = _original_torch_load
            else:
                print(f"[ChatterBox] Cache not found at {cache_dir}, downloading via from_pretrained...")
                loop = asyncio.get_event_loop()
                torch.load = _patched_torch_load
                try:
                    self._model = await loop.run_in_executor(
                        None,
                        lambda: ChatterboxMultilingualTTS.from_pretrained(
                            device=device
                        )
                    )
                finally:
                    torch.load = _original_torch_load
            print(f"[ChatterBox] Model loaded in {(time.time() - t_load):.1f}s")

            self._initialized = True
            print(f"[ChatterBox] Ready (device={self._device}, "
                  f"sr={self._model.sr}, language={self._default_language}, "
                  f"first_chunk={self._first_chunk_chars}, max_chunk={self._max_chars})")

            # GPU warm-up — first real call would otherwise pay for CUDA
            # kernel JIT (~hundreds of ms on a fresh process). Running a
            # tiny throwaway synth at init pays that cost once, off the
            # critical path.
            await self._warm_up()

            return True

        except Exception as e:
            print(f"[ChatterBox] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def _warm_up(self) -> None:
        """Run a tiny synth so the first real request hits warm kernels."""
        try:
            t0 = time.time()
            await self._synthesize_single_chunk("Hi.", self._default_language)
            print(f"[ChatterBox] Warm-up complete in {(time.time() - t0) * 1000:.0f}ms")
        except Exception as e:
            # Warm-up failures are non-fatal — fall through with cold cache.
            print(f"[ChatterBox] Warm-up failed (non-fatal): {e}")

    def _resolve_language(self, language: Optional[str]) -> str:
        """Resolve language code, defaulting to configured language."""
        if language and language.lower() in SUPPORTED_LANGUAGES:
            return language.lower()
        if language:
            print(f"[ChatterBox] Unsupported language '{language}', falling back to '{self._default_language}'")
        return self._default_language

    def _split_text_into_chunks(self, text: str) -> List[str]:
        """Split text into chunks suitable for the model.

        The first chunk is capped at `self._first_chunk_chars` (shorter,
        for fast TTFB); subsequent chunks use the larger `self._max_chars`
        limit (better total throughput per chunk).
        """
        text = text.strip()
        if not text:
            return []

        if len(text) <= self._first_chunk_chars:
            return [text]

        sentences = re.split(r'(?<=[.!?])\s+', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks: List[str] = []
        current = ""
        # Per-chunk cap — tight for chunk[0], looser thereafter.
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
            print(f"[ChatterBox] Split into {len(chunks)} chunks "
                  f"(first={len(chunks[0])}c, rest={[len(c) for c in chunks[1:]]})")
        return chunks

    def _split_long_sentence(self, sentence: str, cap: int) -> List[str]:
        """Split a long sentence at punctuation or word boundaries."""
        parts = re.split(r'(?<=[,;:])\s+', sentence)
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
        return chunks

    async def _synthesize_single_chunk(
        self,
        text: str,
        language_id: str,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize a single text chunk on the GPU."""
        try:
            loop = asyncio.get_event_loop()

            def _generate():
                # inference_mode is strictly stronger than no_grad: it also
                # skips version-counter tracking on tensors. Free win for
                # any pure-forward path.
                autocast_ctx = (
                    torch.autocast(device_type='cuda', dtype=torch.float16)
                    if self._use_autocast else
                    contextlib.nullcontext()
                )
                with torch.inference_mode(), autocast_ctx:
                    wav = self._model.generate(
                        text,
                        language_id=language_id,
                        audio_prompt_path=self._audio_prompt_path,
                        exaggeration=self._exaggeration,
                        cfg_weight=self._cfg_weight,
                    )
                    return wav

            wav_tensor = await loop.run_in_executor(None, _generate)

            # Convert PyTorch tensor [1, samples] to numpy float32. Cast to
            # float32 first in case autocast left it in fp16.
            audio_data = wav_tensor.squeeze(0).to(torch.float32).cpu().numpy()

            # Clip-prevent: if the model returned a peak >1 (rare with
            # autocast, common without), divide it down. Cheap and safe.
            max_val = float(np.max(np.abs(audio_data))) if audio_data.size else 0.0
            if max_val > 1.0:
                audio_data = audio_data / max_val

            return audio_data, self._model.sr

        except Exception as e:
            print(f"[ChatterBox] Chunk synthesis failed: {e}")
            return None

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        language: Optional[str] = None,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Non-streaming synthesis. Returns the complete audio in one tensor.

        Kept for compatibility with the non-streaming gRPC path. For the
        TTFB-sensitive streaming path, see `synthesize_stream` below — it
        yields chunk N's audio while chunk N+1 is on the GPU.
        """
        if not self._initialized or not self._model:
            print("[ChatterBox] Not initialized")
            return None

        if not text or not text.strip():
            print("[ChatterBox] Empty text provided")
            return None

        language_id = self._resolve_language(language)
        chunks = self._split_text_into_chunks(text)
        if not chunks:
            return None

        t0 = time.time()
        first_result = await self._synthesize_single_chunk(chunks[0], language_id)
        if first_result is None:
            print("[ChatterBox] First chunk synthesis failed")
            return None
        first_audio, sample_rate = first_result
        if len(chunks) > 1:
            ttfb_ms = (time.time() - t0) * 1000.0
            print(f"[ChatterBox] First chunk ready in {ttfb_ms:.0f}ms")

        if len(chunks) == 1:
            final_audio = self._normalize_audio(first_audio)
            total_ms = (time.time() - t0) * 1000.0
            print(f"[ChatterBox] Synthesized {len(final_audio)} samples in {total_ms:.0f}ms, lang={language_id}")
            return (final_audio, sample_rate)

        # Sequential synth for the rest — a single CUDA stream means there
        # is no real gain from asyncio.gather here, and serializing keeps
        # memory steady (only one chunk's tensors live at a time).
        pause_samples = int(0.1 * sample_rate)  # 100ms inter-chunk pause
        pause = np.zeros(pause_samples, dtype=np.float32)

        combined: List[np.ndarray] = [first_audio]
        for idx in range(1, len(chunks)):
            combined.append(pause)
            result = await self._synthesize_single_chunk(chunks[idx], language_id)
            if result is None:
                print(f"[ChatterBox] Warning: chunk {idx + 1}/{len(chunks)} failed")
                continue
            combined.append(result[0])

        final_audio = np.concatenate(combined)
        final_audio = self._normalize_audio(final_audio)

        total_ms = (time.time() - t0) * 1000.0
        print(f"[ChatterBox] Synthesized {len(final_audio)} samples ({len(chunks)} chunks) in {total_ms:.0f}ms, lang={language_id}")
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

        TTFB win: we yield chunk[0]'s audio (sliced into `chunk_size`
        samples per frame) as soon as it's done — without waiting for the
        rest of the utterance. The next chunk is kicked off concurrently
        so its GPU work overlaps with chunk[0] being streamed downstream.
        """
        if not self._initialized or not self._model:
            print("[ChatterBox] Not initialized")
            return
        if not text or not text.strip():
            return

        language_id = self._resolve_language(language)
        chunks = self._split_text_into_chunks(text)
        if not chunks:
            return

        t0 = time.time()
        first_result = await self._synthesize_single_chunk(chunks[0], language_id)
        if first_result is None:
            print("[ChatterBox] First chunk synthesis failed (stream)")
            return
        audio_0, sr = first_result
        ttfb_ms = (time.time() - t0) * 1000.0
        print(f"[ChatterBox] First chunk ready in {ttfb_ms:.0f}ms (stream, lang={language_id})")

        # Kick off chunk[1] in the background BEFORE we start yielding.
        # The GPU runs the next synth while we stream the current one to
        # the consumer — overlapping CPU/network with GPU compute.
        pending: Optional[asyncio.Task] = None
        if len(chunks) > 1:
            pending = asyncio.create_task(
                self._synthesize_single_chunk(chunks[1], language_id)
            )

        pause = np.zeros(int(0.05 * sr), dtype=np.int16)  # 50ms between chunks

        any_yielded = False
        emitted_final = False
        try:
            for idx in range(len(chunks)):
                if idx == 0:
                    audio_chunk = audio_0
                else:
                    result = await pending  # type: ignore[arg-type]
                    pending = None
                    # Kick off the chunk AFTER this one before we yield audio
                    # for the current chunk, so the GPU is already busy on
                    # idx+1 while we stream out idx.
                    if idx + 1 < len(chunks):
                        pending = asyncio.create_task(
                            self._synthesize_single_chunk(chunks[idx + 1], language_id)
                        )
                    if result is None:
                        print(f"[ChatterBox] Warning: chunk {idx + 1}/{len(chunks)} failed (stream)")
                        continue
                    audio_chunk, _ = result
                    # Inter-chunk pause so consecutive chunks don't sound glued.
                    yield (pause, False)
                    any_yielded = True

                int16 = (np.clip(audio_chunk, -1.0, 1.0) * 32767).astype(np.int16)
                is_last_chunk = (idx == len(chunks) - 1)
                total = len(int16)
                for i in range(0, total, chunk_size):
                    is_final = is_last_chunk and (i + chunk_size >= total)
                    yield (int16[i:i + chunk_size], is_final)
                    any_yielded = True
                    if is_final:
                        emitted_final = True

            # Guarantee the consumer always sees an end-of-stream marker. If the
            # final chunk failed (continue) or synthesized to empty audio, the
            # inner loop emits no is_final frame — without this the gRPC consumer,
            # which keys end-of-stream off is_final, would hang. (Mirrors the
            # empty-final-frame behavior of piper/qwen3.)
            if any_yielded and not emitted_final:
                yield (np.empty(0, dtype=np.int16), True)
        finally:
            # On barge-in (GeneratorExit) the look-ahead synth task is still
            # running on the GPU — cancel it so we don't burn a full chunk of
            # compute producing audio nobody will hear. Fire-and-forget cancel
            # (no await: this finally can run during GeneratorExit, where awaiting
            # is unsafe); the loop reaps the cancelled task.
            if pending is not None and not pending.done():
                pending.cancel()

        total_ms = (time.time() - t0) * 1000.0
        print(f"[ChatterBox] Stream completed in {total_ms:.0f}ms ({len(chunks)} chunks)")

    def _normalize_audio(self, audio: np.ndarray) -> np.ndarray:
        """Normalize audio to -3dB peak."""
        audio = audio - np.mean(audio)
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            target_peak = 0.707  # -3dB
            audio = audio * (target_peak / max_val)
        return audio

    async def cleanup(self) -> None:
        """Clean up ChatterBox provider."""
        self._model = None
        self._initialized = False
        if torch and torch.cuda.is_available():
            torch.cuda.empty_cache()
        print("[ChatterBox] Cleanup completed")
