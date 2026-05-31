"""Qwen3-TTS provider — in-process inference via faster-qwen3-tts.

Runs the model directly inside the tts-service Python process (same pattern
as Kokoro / ChatterBox). No sidecar container, no HTTP hop. The CUDA-graph
fast path in `faster-qwen3-tts` is what makes this real-time (~156 ms TTFA
on a 4090, 4.78 RTF for the 0.6B-Base variant).

PERFORMANCE NOTES
-----------------
- We load with ``device="cuda"`` and bfloat16 weights by default; both knobs
  are env-overridable. CUDA is required — there is no CPU fast path.
- We pre-warm at the end of ``initialize()`` so the first user-facing
  request hits captured CUDA graphs, not JIT compilation.
- Streaming uses ``generate_voice_clone_streaming`` with a small
  ``QWEN3_CHUNK_SIZE`` (default 2 codec frames ≈ 167 ms audio) so TTFB is
  bound by model prefill + one decoder step, not by chunk-buffering inside
  the generator.
- We reslice the model's audio chunks into the gRPC pipeline's preferred
  480-sample (20 ms) frames here, on the CPU side, so the model loop never
  blocks on small allocations.

LICENSE NOTES
-------------
- This integration code is distributed under STELLA's permissive license.
- The ``faster-qwen3-tts`` engine is MIT
  (https://github.com/andimarafioti/faster-qwen3-tts).
- Qwen3-TTS model weights are Apache-2.0 (Qwen/Qwen3-TTS-*).
"""

import asyncio
import os
import time
from typing import Optional, Tuple, AsyncGenerator

import numpy as np

from .base import TTSProvider

try:
    import torch
    from faster_qwen3_tts import FasterQwen3TTS
    QWEN3_DEPS_AVAILABLE = True
except ImportError:
    QWEN3_DEPS_AVAILABLE = False
    torch = None
    FasterQwen3TTS = None


DEFAULT_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
DEFAULT_LANGUAGE = "English"
DEFAULT_SAMPLE_RATE = 24000
# Codec runs at 12 Hz token rate; chunk_size=2 ≈ 167 ms audio per yield.
# Smaller = lower TTFB, more decoder calls per second. The CUDA-graph
# fast path keeps the per-call overhead small enough that 2 is a sweet
# spot on an L4 / 4090. Drop to 1 if you want absolute minimum TTFB at
# the cost of ~2x decoder-call frequency.
DEFAULT_CHUNK_SIZE = 2
# Sentinel used in the async pump queue to signal end-of-stream.
_QWEN3_STREAM_DONE = object()


class Qwen3Provider(TTSProvider):
    """Qwen3-TTS via the in-process `faster-qwen3-tts` library.

    Configuration (all env vars; sensible defaults):

    - ``QWEN3_MODEL_ID``: HF repo or local path of the variant to load.
      Default ``Qwen/Qwen3-TTS-12Hz-0.6B-Base``. The TTS init container
      pre-stages weights at ``/models/qwen3``; point this at that path
      (or leave as the repo ID and let HF resolve to its cache).
    - ``QWEN3_MODEL_PATH``: optional local path override. Takes precedence
      over ``QWEN3_MODEL_ID`` when set.
    - ``QWEN3_DEVICE``: ``cuda`` (default) or ``cpu``. CPU is supported
      only as a fallback for debugging — it is not real-time.
    - ``QWEN3_DTYPE``: ``bfloat16`` (default), ``float16``, or ``float32``.
    - ``QWEN3_LANGUAGE``: input language label. Default ``English``.
    - ``QWEN3_REF_AUDIO``: path to a reference clip (~5–10 s, WAV or MP3).
      Required for every variant. The init container drops the bundled
      clip at /models/qwen3/ref_audio.mp3 if no operator file is present.
    - ``QWEN3_REF_TEXT``: optional transcript override. Normally the
      provider reads the transcript from a sibling .txt file next to
      ``QWEN3_REF_AUDIO`` (e.g. /models/qwen3/ref_audio.txt), so swapping
      voices is just "drop two files on the PVC, no env edits". Set this
      env var only if you can't write to the same directory as the audio.
    - ``QWEN3_CHUNK_SIZE``: codec frames per streamed yield. Default 2.
    - ``QWEN3_SAMPLE_RATE``: output sample rate (Hz). Default 24000.
    """

    def __init__(self):
        self._initialized = False
        self._model: Optional["FasterQwen3TTS"] = None
        self._model_id = os.getenv("QWEN3_MODEL_ID", DEFAULT_MODEL_ID)
        self._model_path = os.getenv("QWEN3_MODEL_PATH", "")
        self._device = os.getenv("QWEN3_DEVICE", "cuda")
        self._dtype_name = os.getenv("QWEN3_DTYPE", "bfloat16")
        self._language = os.getenv("QWEN3_LANGUAGE", DEFAULT_LANGUAGE)
        self._ref_audio = os.getenv("QWEN3_REF_AUDIO", "/models/qwen3/ref_audio.mp3")
        self._ref_text = os.getenv("QWEN3_REF_TEXT", "")
        self._chunk_size = int(os.getenv("QWEN3_CHUNK_SIZE", str(DEFAULT_CHUNK_SIZE)))
        self._sample_rate = int(os.getenv("QWEN3_SAMPLE_RATE", str(DEFAULT_SAMPLE_RATE)))

    @property
    def name(self) -> str:
        return "qwen3"

    @property
    def is_available(self) -> bool:
        return QWEN3_DEPS_AVAILABLE

    def _resolve_dtype(self):
        return {
            "bfloat16": torch.bfloat16,
            "float16": torch.float16,
            "float32": torch.float32,
        }.get(self._dtype_name.lower(), torch.bfloat16)

    def _resolve_model_source(self) -> str:
        """Prefer a local path on the PVC over the HF repo ID."""
        if self._model_path and os.path.isdir(self._model_path):
            return self._model_path
        return self._model_id

    async def initialize(self) -> bool:
        if not QWEN3_DEPS_AVAILABLE:
            print("[Qwen3] faster-qwen3-tts / torch not installed — provider unavailable")
            return False

        if self._device == "cuda" and not torch.cuda.is_available():
            print("[Qwen3] CUDA requested but not available — provider unavailable")
            return False

        if not os.path.isfile(self._ref_audio):
            print(f"[Qwen3] Reference audio not found at {self._ref_audio}.")
            print("[Qwen3] Stage a ~5-10s WAV/MP3 there plus a sibling .txt with its")
            print("[Qwen3] verbatim transcript (e.g. ref_audio.mp3 + ref_audio.txt).")
            return False

        # Resolve the transcript. Env override wins; otherwise read the
        # sibling .txt file next to the audio. Sharing transcripts via env
        # vars is painful (newlines, quotes, configmap edits), so the
        # file-next-to-audio convention is the default path.
        if not self._ref_text:
            sibling_txt = os.path.splitext(self._ref_audio)[0] + ".txt"
            if os.path.isfile(sibling_txt):
                try:
                    with open(sibling_txt, "r", encoding="utf-8") as f:
                        self._ref_text = f.read().strip()
                    print(f"[Qwen3] Loaded reference transcript from {sibling_txt} ({len(self._ref_text)} chars)")
                except Exception as e:
                    print(f"[Qwen3] Failed to read transcript at {sibling_txt}: {e}")
                    return False
            else:
                print(f"[Qwen3] No transcript found. Expected a sibling file at {sibling_txt}")
                print("[Qwen3] (or set QWEN3_REF_TEXT env to override).")
                return False

        source = self._resolve_model_source()
        dtype = self._resolve_dtype()
        print(f"[Qwen3] Loading {source} on {self._device} ({self._dtype_name})...")
        try:
            loop = asyncio.get_event_loop()
            t0 = time.time()
            # The from_pretrained call is blocking and GPU-heavy; run it
            # in the default executor so the event loop stays responsive.
            self._model = await loop.run_in_executor(
                None,
                lambda: FasterQwen3TTS.from_pretrained(
                    source,
                    device=self._device,
                    dtype=dtype,
                ),
            )
            print(f"[Qwen3] Model loaded in {time.time() - t0:.1f}s")
        except Exception as e:
            print(f"[Qwen3] Model load failed: {e}")
            import traceback
            traceback.print_exc()
            return False

        self._initialized = True
        await self._warm_up()
        return True

    async def _warm_up(self) -> None:
        """Run a tiny synth to capture CUDA graphs and prime kernels."""
        try:
            t0 = time.time()
            await self.synthesize("Hi.")
            print(f"[Qwen3] Warm-up complete in {(time.time() - t0) * 1000:.0f}ms")
        except Exception as e:
            print(f"[Qwen3] Warm-up failed (non-fatal): {e}")

    def _to_int16_numpy(self, chunk) -> np.ndarray:
        """Convert a model audio chunk (torch tensor or numpy) to int16 PCM.

        faster-qwen3-tts yields float tensors in [-1, 1] on the model
        device. We move to CPU only here, once per chunk, to keep the GPU
        loop tight. Using ``.cpu().numpy()`` on a bfloat16 tensor errors,
        so we cast to float32 first.
        """
        if torch is not None and isinstance(chunk, torch.Tensor):
            t = chunk.detach()
            if t.dtype != torch.float32:
                t = t.float()
            arr = t.cpu().numpy()
        else:
            arr = np.asarray(chunk, dtype=np.float32)
        if arr.ndim > 1:
            arr = arr.reshape(-1)
        return (np.clip(arr, -1.0, 1.0) * 32767.0).astype(np.int16)

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,  # not exposed by faster-qwen3-tts; accepted for parity
        language: Optional[str] = None,
    ) -> Optional[Tuple[np.ndarray, int]]:
        if not self._initialized or self._model is None:
            print("[Qwen3] Not initialized")
            return None
        if not text or not text.strip():
            return None

        lang = language or self._language

        def _run():
            audio_list, sr = self._model.generate_voice_clone(
                text=text,
                language=lang,
                ref_audio=self._ref_audio,
                ref_text=self._ref_text,
            )
            return audio_list, sr

        try:
            loop = asyncio.get_event_loop()
            t0 = time.time()
            audio_list, sr = await loop.run_in_executor(None, _run)
            # generate_voice_clone returns a list of chunks or one tensor.
            if isinstance(audio_list, list):
                int16_parts = [self._to_int16_numpy(c) for c in audio_list if c is not None]
                if not int16_parts:
                    return None
                int16 = np.concatenate(int16_parts)
            else:
                int16 = self._to_int16_numpy(audio_list)
            audio = (int16.astype(np.float32) / 32767.0)
            print(f"[Qwen3] Synthesized {len(audio)} samples in {(time.time() - t0) * 1000:.0f}ms")
            return audio, int(sr or self._sample_rate)
        except Exception as e:
            print(f"[Qwen3] Synthesis failed: {e}")
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

        The model's own ``generate_voice_clone_streaming`` is a synchronous
        generator that yields PCM chunks as the decoder produces them. We
        pump those chunks from a worker thread into an asyncio.Queue, then
        re-slice into ``chunk_size``-sample int16 frames for the gRPC
        consumer. TTFB ≈ model prefill + one codec step.
        """
        if not self._initialized or self._model is None:
            print("[Qwen3] Not initialized")
            return
        if not text or not text.strip():
            return

        lang = language or self._language
        codec_chunk = self._chunk_size

        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=16)

        def _producer():
            try:
                for audio_chunk, _sr, _timing in self._model.generate_voice_clone_streaming(
                    text=text,
                    language=lang,
                    ref_audio=self._ref_audio,
                    ref_text=self._ref_text,
                    chunk_size=codec_chunk,
                ):
                    loop.call_soon_threadsafe(queue.put_nowait, audio_chunk)
            except Exception as e:
                loop.call_soon_threadsafe(queue.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, _QWEN3_STREAM_DONE)

        t0 = time.time()
        producer_fut = loop.run_in_executor(None, _producer)

        first_yielded = False
        leftover = np.empty(0, dtype=np.int16)

        while True:
            item = await queue.get()
            if isinstance(item, Exception):
                print(f"[Qwen3] Streaming error: {item}")
                break
            if item is _QWEN3_STREAM_DONE:
                if len(leftover):
                    yield (leftover, True)
                elif first_yielded:
                    yield (np.empty(0, dtype=np.int16), True)
                break

            int16 = self._to_int16_numpy(item)
            if len(leftover):
                int16 = np.concatenate([leftover, int16])

            if not first_yielded:
                print(f"[Qwen3] First audio in {(time.time() - t0) * 1000:.0f}ms (stream)")

            total = len(int16)
            full = total - (total % chunk_size)
            for i in range(0, full, chunk_size):
                yield (int16[i:i + chunk_size], False)
                first_yielded = True
            leftover = int16[full:]

        await producer_fut
        if first_yielded:
            print(f"[Qwen3] Stream completed in {(time.time() - t0) * 1000:.0f}ms")

    async def cleanup(self) -> None:
        self._model = None
        self._initialized = False
        if torch is not None and torch.cuda.is_available():
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
        print("[Qwen3] Cleanup completed")
