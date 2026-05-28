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

STELLA supports **Voxtral** (`mistralai/Voxtral-4B-TTS-2603`) as an opt-in
TTS provider. The licensing split here is important:

- The provider **code** at `src/providers/voxtral_provider.py` is part of
  STELLA and is distributed under the project's primary permissive license.
  It is a thin HTTP client and brings in no Voxtral-specific Python deps.
- The **inference server** runs in a separate sidecar image,
  `tts-vllm-omni` (see `/tts-vllm-omni/Dockerfile`), which is built from the
  Apache-2.0 `vllm/vllm-openai` base plus `vllm-omni` and `mistral_common`
  (both Apache-2.0). The sidecar image itself does not embed any model
  weights.
- The Voxtral **model weights** themselves are released under
  **Creative Commons Attribution-NonCommercial 4.0 (CC-BY-NC-4.0)**.

STELLA **does not bundle, download, or redistribute the Voxtral weights** in
any build configuration. The init container in `k8s/09-tts-service.yaml`
only fetches them when the operator explicitly sets
`VOXTRAL_ACCEPT_NC_LICENSE=true` in the ConfigMap — that flag is the
operator's acceptance of the model license.

This separation keeps STELLA's image and source distribution permissively
licensed regardless of whether Voxtral is enabled. Operators who choose to
run Voxtral are solely responsible for obtaining the weights from Mistral
and complying with CC-BY-NC-4.0 — most importantly, the prohibition on
commercial use as defined by that license.

How activation works:

- `TTS_PROVIDER=voxtral` makes `scripts/lib/build.sh` build the
  `tts-vllm-omni` sidecar image and `scripts/lib/deploy.sh` enable the
  sidecar block in the K8s manifest. Any other value leaves both inert.
- The provider in `tts-service` only connects to `http://localhost:8000`
  (the sidecar), so on non-Voxtral builds it never reaches out and the
  rest of the codebase is unaffected.
