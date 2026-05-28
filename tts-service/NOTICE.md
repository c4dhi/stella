# tts-service licensing notice

STELLA is distributed under a permissive license. The `tts-service` component
ships several optional TTS providers; one of them — **Piper** — is licensed
under **GPL-3.0** (via its `espeak-ng` dependency).

To keep the default build license-clean, Piper is **not installed unless
explicitly opted into** at build time:

- Default build: `docker build .` → no Piper, no GPL obligations.
- Opt-in build: `docker build --build-arg ENABLE_PIPER=true .` → Piper is
  installed; the resulting image becomes a GPL-3.0 covered work and must be
  redistributed under GPL-3.0 terms.

Both the Dockerfile and the project's deploy script (`scripts/lib/build.sh`)
default to `ENABLE_PIPER=false`. Internal deployments that want Piper must set
`ENABLE_PIPER=true` explicitly.

Source code for the Piper provider integration (`src/providers/piper_provider.py`)
remains under the project's primary license; only the bundled `piper-tts`
dependency carries GPL terms.

## Voxtral (opt-in, non-commercial model weights)

STELLA also supports **Voxtral** (`mistralai/Voxtral-4B-TTS-2603`) as an
opt-in TTS provider. The licensing split here is important:

- The provider **code** at `src/providers/voxtral_provider.py` is part of
  STELLA and is distributed under the project's primary permissive license.
- The Python **inference dependencies** in `requirements-voxtral.txt`
  (`transformers`, `mistral-common`, `bitsandbytes`) are Apache-2.0 / MIT
  — they do not contaminate the image.
- The Voxtral **model weights** themselves are released under
  **Creative Commons Attribution-NonCommercial 4.0 (CC-BY-NC-4.0)**.

STELLA **does not bundle, download, or redistribute the Voxtral weights** in
any build configuration. The provider refuses to start unless the operator
sets `VOXTRAL_MODEL_PATH` to a directory they have populated themselves.

This separation keeps STELLA's image and source distribution permissively
licensed regardless of whether Voxtral is enabled. Operators who choose to
run Voxtral are solely responsible for obtaining the weights from Mistral
and complying with CC-BY-NC-4.0 — most importantly, the prohibition on
commercial use as defined by that license.

Build flag:

- Default build: `docker build .` → Voxtral deps not installed, provider
  inert.
- Opt-in build: `docker build --build-arg ENABLE_VOXTRAL=true .` → inference
  deps installed; provider activates only when `TTS_PROVIDER=voxtral` AND
  `VOXTRAL_MODEL_PATH` is set at runtime.
