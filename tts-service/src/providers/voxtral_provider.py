"""Voxtral TTS provider — local inference of mistralai/Voxtral-4B-TTS-2603.

LICENSE NOTE
------------
This integration code is distributed under STELLA's permissive license. It is
inert until an operator opts in: STELLA does NOT bundle, download, or
redistribute the Voxtral model weights.

The Voxtral model weights themselves are released by Mistral AI under
**Creative Commons Attribution-NonCommercial 4.0 (CC-BY-NC-4.0)**. Operators
who set ``VOXTRAL_MODEL_PATH`` and run this provider are responsible for
obtaining the weights and complying with that license — including the
restriction against commercial use.

The provider refuses to start unless ``VOXTRAL_MODEL_PATH`` points to a
directory the operator has populated themselves.
"""

import asyncio
import os
from typing import Optional, Tuple

import numpy as np

from .base import TTSProvider

try:
    import torch
    from transformers import AutoProcessor, AutoModel
    VOXTRAL_DEPS_AVAILABLE = True
except ImportError:
    VOXTRAL_DEPS_AVAILABLE = False
    torch = None
    AutoProcessor = None
    AutoModel = None

try:
    from transformers import BitsAndBytesConfig
    BNB_AVAILABLE = True
except ImportError:
    BNB_AVAILABLE = False
    BitsAndBytesConfig = None


DEFAULT_SAMPLE_RATE = 24000


class VoxtralProvider(TTSProvider):
    """Local Voxtral TTS provider.

    Configuration (all via environment variables):

    - ``VOXTRAL_MODEL_PATH`` (required): filesystem path to a directory
      containing weights the operator has downloaded themselves. The provider
      refuses to initialize without it — this is the explicit acknowledgement
      that the operator has accepted the CC-BY-NC-4.0 model license.
    - ``VOXTRAL_DEVICE`` (default ``auto``): ``auto`` | ``cuda`` | ``cpu`` | ``mps``.
    - ``VOXTRAL_DTYPE`` (default ``bfloat16`` on CUDA, ``float32`` otherwise).
    - ``VOXTRAL_SAMPLE_RATE`` (default ``24000``): output sample rate of the
      model. Override if the model card specifies a different rate.
    """

    def __init__(self):
        self._initialized = False
        self._model = None
        self._processor = None
        self._device = None
        self._dtype = None
        self._model_path = os.getenv("VOXTRAL_MODEL_PATH", "").strip()
        self._sample_rate = int(os.getenv("VOXTRAL_SAMPLE_RATE", str(DEFAULT_SAMPLE_RATE)))

    @property
    def name(self) -> str:
        return "voxtral"

    @property
    def is_available(self) -> bool:
        # Available only if (a) the optional deps are installed (opt-in build),
        # and (b) the operator has explicitly pointed us at locally-supplied
        # weights. Both gates must be open before we touch the model.
        return VOXTRAL_DEPS_AVAILABLE and bool(self._model_path)

    def _select_device(self) -> str:
        device_env = os.getenv("VOXTRAL_DEVICE", "auto").lower()
        if device_env != "auto":
            return device_env
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def _select_dtype(self, device: str):
        dtype_env = os.getenv("VOXTRAL_DTYPE", "").lower()
        mapping = {
            "float16": torch.float16,
            "fp16": torch.float16,
            "bfloat16": torch.bfloat16,
            "bf16": torch.bfloat16,
            "float32": torch.float32,
            "fp32": torch.float32,
        }
        if dtype_env in mapping:
            chosen = mapping[dtype_env]
            # MPS bf16 support is patchy across PyTorch versions; auto-downgrade
            # so an opinionated config doesn't trip the operator on Apple silicon.
            if device == "mps" and chosen is torch.bfloat16:
                print("[Voxtral] bfloat16 is unreliable on MPS; using float16 instead")
                return torch.float16
            return chosen

        if device == "cuda":
            # bf16 is preferred on Ampere+ (CC >= 8.0); older cards (T4/V100/etc.)
            # do not have native bf16, so fall back to fp16 for speed.
            try:
                major, _ = torch.cuda.get_device_capability()
                return torch.bfloat16 if major >= 8 else torch.float16
            except Exception:
                return torch.float16
        if device == "mps":
            return torch.float16
        return torch.float32

    def _build_quantization_config(self, device: str):
        """Return a BitsAndBytesConfig when 4-bit/8-bit load is requested.

        Driven by env vars so the same image can run full-precision on a beefy
        GPU (L4/A100) and 4-bit on a tight one (T4) without rebuilding.
        Returns None when quant is disabled or not viable on this device.
        """
        load_4bit = os.getenv("VOXTRAL_LOAD_IN_4BIT", "false").lower() == "true"
        load_8bit = os.getenv("VOXTRAL_LOAD_IN_8BIT", "false").lower() == "true"

        if not (load_4bit or load_8bit):
            return None

        if device != "cuda":
            print(
                f"[Voxtral] Ignoring VOXTRAL_LOAD_IN_{'4BIT' if load_4bit else '8BIT'}=true: "
                f"bitsandbytes requires CUDA but device={device}. Running unquantized."
            )
            return None

        if not BNB_AVAILABLE:
            print(
                "[Voxtral] VOXTRAL_LOAD_IN_4BIT/8BIT was requested but bitsandbytes is "
                "not installed. Rebuild the image with ENABLE_VOXTRAL=true."
            )
            return None

        if load_4bit:
            quant_type = os.getenv("VOXTRAL_4BIT_QUANT_TYPE", "nf4")
            print(f"[Voxtral] Loading in 4-bit ({quant_type}) via bitsandbytes")
            return BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_quant_type=quant_type,
                bnb_4bit_use_double_quant=True,
            )

        print("[Voxtral] Loading in 8-bit via bitsandbytes")
        return BitsAndBytesConfig(load_in_8bit=True)

    async def initialize(self) -> bool:
        if not VOXTRAL_DEPS_AVAILABLE:
            print("[Voxtral] transformers/torch not installed — build with ENABLE_VOXTRAL=true to opt in")
            return False

        if not self._model_path:
            print(
                "[Voxtral] VOXTRAL_MODEL_PATH is not set. The provider stays "
                "inactive until the operator supplies locally-downloaded "
                "weights (CC-BY-NC-4.0; not redistributed by STELLA)."
            )
            return False

        if not os.path.isdir(self._model_path):
            print(f"[Voxtral] VOXTRAL_MODEL_PATH '{self._model_path}' is not a directory")
            return False

        print(
            "[Voxtral] Initializing local Voxtral TTS. Reminder: the model "
            "weights at this path are CC-BY-NC-4.0; commercial use is "
            "prohibited by the model license. STELLA's code is unaffected."
        )

        try:
            self._device = self._select_device()
            self._dtype = self._select_dtype(self._device)
            attn_impl = os.getenv("VOXTRAL_ATTN_IMPLEMENTATION", "").strip() or None
            print(
                f"[Voxtral] device={self._device} dtype={self._dtype} "
                f"attn={attn_impl or 'transformers-default'}"
            )

            # On CUDA, prime allocator settings before loading so the 4B
            # weights land on the GPU efficiently.
            if self._device == "cuda":
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True

            loop = asyncio.get_event_loop()
            self._processor = await loop.run_in_executor(
                None,
                lambda: AutoProcessor.from_pretrained(self._model_path, trust_remote_code=True),
            )

            quant_config = self._build_quantization_config(self._device)

            load_kwargs = dict(
                torch_dtype=self._dtype,
                trust_remote_code=True,
                low_cpu_mem_usage=True,
            )
            if attn_impl:
                load_kwargs["attn_implementation"] = attn_impl
            if quant_config is not None:
                # bitsandbytes handles device placement during load via
                # device_map; .to(device) afterwards is unsupported.
                load_kwargs["quantization_config"] = quant_config
                load_kwargs["device_map"] = self._device

            def _load_model():
                model = AutoModel.from_pretrained(self._model_path, **load_kwargs)
                if quant_config is None:
                    model = model.to(self._device)
                return model.eval()

            self._model = await loop.run_in_executor(None, _load_model)

            self._initialized = True
            print(f"[Voxtral] Initialized (sample_rate={self._sample_rate})")
            return True

        except Exception as e:
            print(f"[Voxtral] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        language: Optional[str] = None,
    ) -> Optional[Tuple[np.ndarray, int]]:
        if not self._initialized or self._model is None:
            print("[Voxtral] Not initialized")
            return None

        if not text or not text.strip():
            return None

        try:
            loop = asyncio.get_event_loop()

            def _generate():
                inputs = self._processor(text=text, return_tensors="pt").to(self._device)
                with torch.inference_mode():
                    output = self._model.generate(**inputs)
                # transformers audio models commonly return either a raw
                # waveform tensor or an object with a `.audio` / `.waveform`
                # attribute. Handle both shapes.
                waveform = getattr(output, "waveform", None)
                if waveform is None:
                    waveform = getattr(output, "audio", None)
                if waveform is None:
                    waveform = output
                return waveform

            waveform = await loop.run_in_executor(None, _generate)

            audio = waveform.detach().to(torch.float32).cpu().numpy()
            audio = np.squeeze(audio)
            if audio.ndim > 1:
                audio = audio[0]

            peak = float(np.max(np.abs(audio))) if audio.size else 0.0
            if peak > 1.0:
                audio = audio / peak

            return audio.astype(np.float32), self._sample_rate

        except Exception as e:
            print(f"[Voxtral] Synthesis failed: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def cleanup(self) -> None:
        self._model = None
        self._processor = None
        self._initialized = False
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
        print("[Voxtral] Cleanup completed")
