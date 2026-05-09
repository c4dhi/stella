# CUI 2026 Study Configurations

Within-subjects non-inferiority study comparing two STELLA V2 configurations
for a physical activity check-in in a motivational interviewing context.

## Configuration A (Simple)
Single general-purpose assessment expert. Lean pipeline for baseline measurement.

Pipeline config: disable all built-in conditional experts, add one `general_assessment`
custom expert via the Agent Configurator.

## Configuration B (Complex)
Five specialised assessment experts running in parallel. Full multi-agent auditing.

Pipeline config: disable built-in `legal` and `timekeeper`, keep `medical` and `probing`,
add three custom experts (`emotional_responsiveness`, `mi_adherence`, `topical_boundary`)
via the Agent Configurator.

## Shared across both configurations
- `noise_detection` (always-on, built-in) — garbled input detection
- `task_extraction` (always-on, built-in) — deliverable extraction via tool calling
- Same plan, persona, voice, TTS/STT settings, and response generator config
- Same bridge generator and input gate settings
