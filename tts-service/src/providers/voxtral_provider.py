"""Voxtral TTS provider — HTTP client of a local vllm-omni inference server.

WHY HTTP AND NOT IN-PROCESS
---------------------------
Mistral ships `mistralai/Voxtral-4B-TTS-2603` in their native format
(`consolidated.safetensors` + `params.json` + `tekken.json` + a
`voice_embedding/` directory). There is no HF-transformers-compatible
`config.json`, so `transformers.AutoModel.from_pretrained` cannot load
this model — it always fails with "Unrecognized model".

The only supported inference path is `vllm-omni` via its OpenAI-compatible
`/v1/audio/speech` endpoint. STELLA runs `vllm serve <model> --omni` as a
sidecar container (see `k8s/09-tts-service.yaml`), and this provider POSTs
to it over localhost HTTP.

LICENSE NOTE
------------
This integration code is distributed under STELLA's permissive license. It
is inert until an operator opts in: STELLA does NOT bundle, download, or
redistribute the Voxtral model weights.

The Voxtral model weights themselves are released by Mistral AI under
**Creative Commons Attribution-NonCommercial 4.0 (CC-BY-NC-4.0)**. Operators
who deploy the sidecar are responsible for obtaining the weights and
complying with that license — including the restriction against commercial
use.
"""

import asyncio
import io
import os
from typing import Optional, Tuple

import numpy as np

from .base import TTSProvider

try:
    import httpx
    import soundfile as sf
    VOXTRAL_DEPS_AVAILABLE = True
except ImportError:
    VOXTRAL_DEPS_AVAILABLE = False
    httpx = None
    sf = None


DEFAULT_VLLM_URL = "http://localhost:8000"
DEFAULT_VOICE = "casual_male"
DEFAULT_MODEL_NAME = "voxtral"
DEFAULT_SAMPLE_RATE = 24000
INIT_READINESS_TIMEOUT_S = 600  # vllm can take minutes to load a 4B model
INIT_POLL_INTERVAL_S = 5
SYNTH_TIMEOUT_S = 120


class VoxtralProvider(TTSProvider):
    """Voxtral TTS via a local vllm-omni server.

    Configuration (all via environment variables):

    - ``VOXTRAL_VLLM_URL``: base URL of the vllm-omni server.
      Default ``http://localhost:8000`` (matches the in-pod sidecar).
    - ``VOXTRAL_MODEL_NAME``: name of the served model. Must match the
      ``--served-model-name`` passed to ``vllm serve``. Default ``voxtral``.
    - ``VOXTRAL_DEFAULT_VOICE``: preset voice ID (e.g. ``casual_male``,
      ``casual_female``). Used when callers don't pass a voice. Default
      ``casual_male``.
    - ``VOXTRAL_SAMPLE_RATE``: expected output sample rate from the model.
      Default 24000 (per the model card).
    """

    def __init__(self):
        self._initialized = False
        self._client: Optional["httpx.AsyncClient"] = None
        self._url = os.getenv("VOXTRAL_VLLM_URL", DEFAULT_VLLM_URL).rstrip("/")
        self._model_name = os.getenv("VOXTRAL_MODEL_NAME", DEFAULT_MODEL_NAME)
        self._default_voice = os.getenv("VOXTRAL_DEFAULT_VOICE", DEFAULT_VOICE)
        self._sample_rate = int(os.getenv("VOXTRAL_SAMPLE_RATE", str(DEFAULT_SAMPLE_RATE)))

    @property
    def name(self) -> str:
        return "voxtral"

    @property
    def is_available(self) -> bool:
        # Available only if the (tiny) HTTP/audio deps are installed. We
        # don't probe the sidecar here — that happens in initialize() with
        # a long-tolerant readiness loop, because vllm startup is slow.
        return VOXTRAL_DEPS_AVAILABLE

    async def _wait_for_sidecar(self) -> bool:
        """Poll vllm's /health endpoint until it returns 200 or we time out.

        vllm-omni loads a 4B model from disk on cold start; 60-180s is
        normal on an L4, longer on slower storage. We give it up to
        INIT_READINESS_TIMEOUT_S before giving up.
        """
        deadline = asyncio.get_event_loop().time() + INIT_READINESS_TIMEOUT_S
        last_err: Optional[str] = None
        attempt = 0
        async with httpx.AsyncClient(timeout=5.0) as probe:
            while asyncio.get_event_loop().time() < deadline:
                attempt += 1
                try:
                    resp = await probe.get(f"{self._url}/health")
                    if resp.status_code == 200:
                        print(f"[Voxtral] vllm-omni sidecar ready at {self._url} (after {attempt} probe(s))")
                        return True
                    last_err = f"HTTP {resp.status_code}"
                except Exception as e:  # noqa: BLE001 — log and retry
                    last_err = f"{type(e).__name__}: {e}"
                if attempt % 6 == 1:  # log every ~30s to avoid spam
                    print(f"[Voxtral] Waiting for vllm-omni at {self._url} ({last_err})")
                await asyncio.sleep(INIT_POLL_INTERVAL_S)
        print(f"[Voxtral] vllm-omni did not become ready at {self._url} within {INIT_READINESS_TIMEOUT_S}s (last: {last_err})")
        return False

    async def initialize(self) -> bool:
        if not VOXTRAL_DEPS_AVAILABLE:
            print("[Voxtral] httpx/soundfile not installed — cannot reach vllm-omni")
            return False

        print(
            "[Voxtral] Initializing. Voxtral runs as a vllm-omni sidecar; this "
            "provider is just an HTTP client. Reminder: the model weights are "
            "CC-BY-NC-4.0 (non-commercial). STELLA's integration code is unaffected."
        )
        print(f"[Voxtral] target={self._url} model={self._model_name} default_voice={self._default_voice}")

        if not await self._wait_for_sidecar():
            return False

        # Keep a single AsyncClient alive for the lifetime of the provider —
        # connection pooling matters for streaming-ish low-latency TTS.
        self._client = httpx.AsyncClient(
            base_url=self._url,
            timeout=httpx.Timeout(SYNTH_TIMEOUT_S, connect=10.0),
        )
        self._initialized = True
        print("[Voxtral] Ready")
        return True

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,  # vllm-omni currently has no speed knob; accepted for interface parity
        language: Optional[str] = None,  # Voxtral autodetects from text; accepted for interface parity
    ) -> Optional[Tuple[np.ndarray, int]]:
        if not self._initialized or self._client is None:
            print("[Voxtral] Not initialized")
            return None
        if not text or not text.strip():
            return None

        payload = {
            "model": self._model_name,
            "input": text,
            "voice": voice or self._default_voice,
            "response_format": "wav",
        }

        try:
            resp = await self._client.post("/v1/audio/speech", json=payload)
            if resp.status_code != 200:
                # Surface the upstream error body — vllm returns useful JSON
                # ({"error": {"message": ...}}) that we want in the logs.
                print(f"[Voxtral] vllm returned HTTP {resp.status_code}: {resp.text[:500]}")
                return None

            audio_bytes = resp.content
            # vllm-omni returns a fully-formed WAV. Decode with soundfile so
            # we get a sample-rate-correct float32 array regardless of what
            # bit depth vllm chose to encode.
            audio_array, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
            if audio_array.ndim > 1:
                # downmix to mono — STELLA's pipeline is single-channel
                audio_array = audio_array.mean(axis=1)
            if sr != self._sample_rate:
                # Don't resample silently; just report. Upstream consumers
                # honor the returned sample rate.
                print(f"[Voxtral] note: vllm returned sr={sr}, expected {self._sample_rate}")
            return audio_array.astype(np.float32, copy=False), sr

        except httpx.TimeoutException:
            print(f"[Voxtral] synthesis timed out after {SYNTH_TIMEOUT_S}s")
            return None
        except Exception as e:  # noqa: BLE001
            print(f"[Voxtral] Synthesis failed: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def cleanup(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._client = None
        self._initialized = False
        print("[Voxtral] Cleanup completed")
