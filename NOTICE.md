# Third-party notices

STELLA bundles or downloads several third-party components at build or runtime.
This file lists them, their licenses, and any obligations downstream consumers
inherit.

## Bundled fonts

### Inter (frontend-ui/public/fonts/inter/)
- License: SIL Open Font License 1.1
- Upstream: https://github.com/rsms/inter
- License text: `frontend-ui/public/fonts/inter/OFL.txt`

## Bundled default voice clips

The default reference voice clips shipped in `tts-service/assets/` are
**synthetically generated** — no human voice or likeness is involved, so there
are no personality/publicity rights attached. They may be freely redistributed
under the generating models' permissive licenses.

### German — `voices/stella_de.mp3` and `ref_audio.mp3`
- Generated with **Chatterbox** (Resemble AI), License: **MIT**
- Upstream: https://github.com/resemble-ai/chatterbox

### English — `voices/stella_en.mp3`
- Generated with **Kokoro** (`hexgrad/Kokoro-82M`), License: **Apache-2.0**
- Upstream: https://huggingface.co/hexgrad/Kokoro-82M

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
- Default build: **not installed** when `TTS_PROVIDER` selects a different
  provider (single-provider image model).
- Opt-in build: `docker build --build-arg TTS_PROVIDER=piper .` installs
  Piper; the resulting image becomes a GPL-3.0 covered work and must be
  redistributed under GPL-3.0 terms.
- See `tts-service/NOTICE.md` for details.

## Optional GPU model (opt-in sidecar, Apache-2.0)

### Qwen3-TTS (in-process in tts-service)
- Provider code (`tts-service/src/providers/qwen3_provider.py`): STELLA's
  primary permissive license.
- Inference library: `faster-qwen3-tts` (MIT,
  https://github.com/andimarafioti/faster-qwen3-tts). Installed directly
  into the `tts-service` image when built with `--build-arg TTS_PROVIDER=qwen3`.
- Model weights (`Qwen/Qwen3-TTS-*`): **Apache-2.0**. STELLA's TTS init
  container fetches them onto the model PVC at first deploy.
- Activation: `TTS_PROVIDER=qwen3` selects this provider at build AND
  runtime. The resulting image carries only Qwen3's deps (no Kokoro,
  ChatterBox, or Piper); other providers' import guards report
  unavailable at runtime.

## Removed components

`edge-tts` (LGPL-3.0) was removed from `tts-service` for license compatibility.
The provider is not present in current builds.
