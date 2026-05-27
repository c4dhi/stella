# Third-party notices

STELLA bundles or downloads several third-party components at build or runtime.
This file lists them, their licenses, and any obligations downstream consumers
inherit.

## Bundled fonts

### Inter (frontend-ui/public/fonts/inter/)
- License: SIL Open Font License 1.1
- Upstream: https://github.com/rsms/inter
- License text: `frontend-ui/public/fonts/inter/OFL.txt`

## Downloaded at build time

### Silero VAD (stt-service)
- License: MIT (since v4)
- Pinned tag: `v6.2.1`
- Upstream: https://github.com/snakers4/silero-vad
- Downloaded by: `stt-service/download_silero_vad.py`

### Sherpa-ONNX streaming Zipformer model (stt-service)
- Code (sherpa-onnx): Apache-2.0
- Model: `sherpa-onnx-streaming-zipformer-en-2023-06-21` — trained on LibriSpeech
  (CC-BY-4.0). Attribution required when redistributing the model archive.
- Upstream: https://github.com/k2-fsa/sherpa-onnx
- Downloaded by: `stt-service/download_sherpa_model.py`

### Kokoro TTS (tts-service)
- License: Apache-2.0
- Upstream: https://github.com/thewh1teagle/kokoro-onnx (ONNX exports of
  `hexgrad/Kokoro-82M`)
- Downloaded by: `tts-service/download_kokoro_models.py`

### Chatterbox TTS (tts-service)
- Code & weights: MIT (ResembleAI/chatterbox)
- Upstream: https://huggingface.co/ResembleAI/chatterbox
- Downloaded by: `tts-service/download_chatterbox_models.py`
- Re-verify the HuggingFace model card license on each release — a change to a
  non-commercial variant would break STELLA's permissive distribution.

## Optional GPL component (opt-in only)

### Piper TTS (tts-service)
- License: GPL-3.0 (via `espeak-ng`)
- Default build: **not installed** (`ENABLE_PIPER=false`).
- Opt-in build: `docker build --build-arg ENABLE_PIPER=true .` installs Piper;
  the resulting image becomes a GPL-3.0 covered work and must be redistributed
  under GPL-3.0 terms.
- See `tts-service/NOTICE.md` for details.

## Removed components

`edge-tts` (LGPL-3.0) was removed from `tts-service` for license compatibility.
The provider is not present in current builds.
