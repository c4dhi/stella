"""ChatterBox Multilingual TTS Provider - Local PyTorch-based TTS with EN/DE support."""

import asyncio
import os
import re
from pathlib import Path
from typing import Optional, Tuple, List
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
    """ChatterBox Multilingual TTS provider using local PyTorch model.

    Features:
    - Local inference (no cloud dependency)
    - GPU acceleration via CUDA
    - Multilingual support (English + German)
    - Optional voice cloning via audio prompt
    - 24kHz output sample rate
    """

    # ChatterBox has a similar token limit to other neural TTS models
    MAX_CHARS_PER_CHUNK = 300

    def __init__(self):
        self._initialized = False
        self._model = None
        self._device = None
        self._default_language = os.getenv('CHATTERBOX_LANGUAGE', DEFAULT_LANGUAGE)
        self._exaggeration = float(os.getenv('CHATTERBOX_EXAGGERATION', '0.5'))
        self._cfg_weight = float(os.getenv('CHATTERBOX_CFG_WEIGHT', '0.5'))
        self._audio_prompt_path = os.getenv('CHATTERBOX_AUDIO_PROMPT', None)

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
            print(f"[ChatterBox] Using device: {self._device}")

            cache_dir = os.getenv('CHATTERBOX_CACHE_DIR', '/root/.cache/chatterbox')

            # Patch llama config to use eager attention instead of sdpa
            # sdpa is incompatible with output_attentions=True used by ChatterBox's T3 model
            try:
                from chatterbox.models.t3 import llama_configs
                for cfg in llama_configs.LLAMA_CONFIGS.values():
                    if isinstance(cfg, dict) and 'attn_implementation' in cfg:
                        cfg['attn_implementation'] = 'eager'
                print("[ChatterBox] Patched attention implementation to 'eager'")
            except Exception as e:
                print(f"[ChatterBox] Warning: Could not patch attn_implementation: {e}")

            # Patch torch.load to always map to the selected device
            # This fixes loading CUDA-saved models on CPU-only machines
            device = torch.device(self._device)
            _original_torch_load = torch.load
            def _patched_torch_load(*args, **kwargs):
                kwargs.setdefault('map_location', device)
                return _original_torch_load(*args, **kwargs)

            # Check if models are cached locally
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

            self._initialized = True
            print(f"[ChatterBox] Initialized successfully (device={self._device}, "
                  f"sr={self._model.sr}, language={self._default_language})")
            return True

        except Exception as e:
            print(f"[ChatterBox] Initialization failed: {e}")
            import traceback
            traceback.print_exc()
            return False

    def _resolve_language(self, language: Optional[str]) -> str:
        """Resolve language code, defaulting to configured language."""
        if language and language.lower() in SUPPORTED_LANGUAGES:
            return language.lower()
        if language:
            print(f"[ChatterBox] Unsupported language '{language}', falling back to '{self._default_language}'")
        return self._default_language

    def _split_text_into_chunks(self, text: str) -> List[str]:
        """Split text into chunks that fit within model limits."""
        text = text.strip()
        if not text:
            return []

        if len(text) <= self.MAX_CHARS_PER_CHUNK:
            return [text]

        print(f"[ChatterBox] Text exceeds {self.MAX_CHARS_PER_CHUNK} chars ({len(text)}), splitting...")

        # Split into sentences
        sentences = re.split(r'(?<=[.!?])\s+', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks = []
        current_chunk = ""

        for sentence in sentences:
            potential = f"{current_chunk} {sentence}".strip() if current_chunk else sentence

            if len(potential) <= self.MAX_CHARS_PER_CHUNK:
                current_chunk = potential
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                if len(sentence) <= self.MAX_CHARS_PER_CHUNK:
                    current_chunk = sentence
                else:
                    # Split long sentence by clauses then words
                    sub_chunks = self._split_long_sentence(sentence)
                    for sub in sub_chunks[:-1]:
                        chunks.append(sub)
                    current_chunk = sub_chunks[-1] if sub_chunks else ""

        if current_chunk:
            chunks.append(current_chunk)

        print(f"[ChatterBox] Split into {len(chunks)} chunks: {[len(c) for c in chunks]} chars")
        return chunks

    def _split_long_sentence(self, sentence: str) -> List[str]:
        """Split a long sentence at punctuation or word boundaries."""
        parts = re.split(r'(?<=[,;:])\s+', sentence)
        parts = [p.strip() for p in parts if p.strip()]

        if len(parts) > 1:
            chunks = []
            current = ""
            for part in parts:
                potential = f"{current}, {part}".strip(', ') if current else part
                if len(potential) <= self.MAX_CHARS_PER_CHUNK:
                    current = potential
                else:
                    if current:
                        chunks.append(current)
                    if len(part) <= self.MAX_CHARS_PER_CHUNK:
                        current = part
                    else:
                        word_chunks = self._split_by_words(part)
                        for wc in word_chunks[:-1]:
                            chunks.append(wc)
                        current = word_chunks[-1] if word_chunks else ""
            if current:
                chunks.append(current)
            return chunks

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
        return chunks

    async def _synthesize_single_chunk(
        self,
        text: str,
        language_id: str,
    ) -> Optional[Tuple[np.ndarray, int]]:
        """Synthesize a single text chunk."""
        try:
            loop = asyncio.get_event_loop()

            def _generate():
                with torch.no_grad():
                    wav = self._model.generate(
                        text,
                        language_id=language_id,
                        audio_prompt_path=self._audio_prompt_path,
                        exaggeration=self._exaggeration,
                        cfg_weight=self._cfg_weight,
                    )
                    return wav

            wav_tensor = await loop.run_in_executor(None, _generate)

            # Convert PyTorch tensor [1, samples] to numpy float32
            audio_data = wav_tensor.squeeze(0).cpu().numpy().astype(np.float32)

            # Normalize to [-1, 1]
            max_val = np.max(np.abs(audio_data))
            if max_val > 1.0:
                audio_data = audio_data / max_val

            sample_rate = self._model.sr  # 24000
            return audio_data, sample_rate

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
        """Synthesize text using ChatterBox multilingual TTS."""
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

        # Synthesize first chunk
        first_result = await self._synthesize_single_chunk(chunks[0], language_id)
        if first_result is None:
            print("[ChatterBox] First chunk synthesis failed")
            return None

        first_audio, sample_rate = first_result

        if len(chunks) == 1:
            final_audio = self._normalize_audio(first_audio)
            print(f"[ChatterBox] Synthesized {len(final_audio)} samples (single chunk), lang={language_id}")
            return (final_audio, sample_rate)

        # Synthesize remaining chunks in parallel
        audio_segments = [first_audio]
        print(f"[ChatterBox] Synthesizing {len(chunks) - 1} remaining chunks in parallel...")

        tasks = [
            self._synthesize_single_chunk(chunk, language_id)
            for chunk in chunks[1:]
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, result in enumerate(results, start=2):
            if isinstance(result, Exception):
                print(f"[ChatterBox] Warning: Chunk {i}/{len(chunks)} failed: {result}")
            elif result is not None:
                audio_segments.append(result[0])
            else:
                print(f"[ChatterBox] Warning: Chunk {i}/{len(chunks)} returned None")

        if not audio_segments:
            return None

        # Concatenate with pauses
        pause_samples = int(0.1 * sample_rate)  # 100ms
        pause = np.zeros(pause_samples, dtype=np.float32)

        combined = []
        for i, segment in enumerate(audio_segments):
            combined.append(segment)
            if i < len(audio_segments) - 1:
                combined.append(pause)

        final_audio = np.concatenate(combined)
        final_audio = self._normalize_audio(final_audio)

        print(f"[ChatterBox] Synthesized {len(final_audio)} samples ({len(chunks)} chunks), lang={language_id}")
        return (final_audio, sample_rate)

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
