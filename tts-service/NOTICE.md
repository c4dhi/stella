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
