---
sidebar_position: 2
title: "Pipeline Configurator"
---

# Pipeline Configurator

The Pipeline Configurator lets you tune every stage of the stella-v2 pipeline without touching code. Configurations are saved as reusable presets that can be selected when deploying an agent.

## Why Pipeline Configurations?

Agent behavior depends on many parameters: which experts are enabled, what prompts they use, which models and temperatures are set, how conversation history is managed. Rather than baking these into the agent code or passing them as environment variables, stella-v2 uses **pipeline configurations** — named presets that override specific pipeline slots.

**Key design principles:**

- **Sparse overrides**: Only changed values are stored. Defaults always come from the `pipelineSchema` in `agent.yaml`. This keeps configurations small and forward-compatible — when schema defaults are updated, only explicit overrides persist.
- **Reusable across deployments**: The same configuration can be used for multiple agent instances. Each deployment gets a snapshot of the configuration at deployment time.
- **Version-tracked**: Configurations record which agent version they were created for, enabling compatibility checks as the pipeline evolves.
- **Mandatory for stella-v2**: You must select a saved configuration before deploying. This ensures every deployment has an explicit, auditable configuration rather than relying on implicit defaults.

## Configuration Lifecycle

1. **Create**: Define a new configuration, optionally customizing slots from their defaults
2. **Edit**: Modify an existing configuration. Does not affect already-deployed agents (they have their own snapshot).
3. **Duplicate**: Clone a configuration as a starting point for variations
4. **Deploy**: Select a configuration during agent deployment. The configuration's overrides are merged with schema defaults and passed to the agent pod.

## Pipeline Stages

### Input Gate

**Purpose**: Fast JSON routing classifier that determines which experts to activate for each user message.

| Slot | Type | Default | Rationale |
|------|------|---------|-----------|
| `system_prompt` | text | Routing rules | Defines which experts map to which topics. Customize to add domain-specific routing. |
| `model` | select | `gpt-4o-mini` | Small, fast model is sufficient for classification. |
| `temperature` | number | `0.0` | Zero temperature ensures deterministic routing — the same input always activates the same experts. |
| `max_tokens` | number | `60` | Capped low because the output is structured JSON (expert list), not prose. Keeps latency ~100ms. |

**When to customize**: Add routing rules for custom experts, or switch to a larger model if classification accuracy is insufficient for complex domains.

### Expert Pool

**Purpose**: Runs domain experts in parallel to analyze the user's message from different angles.

| Slot | Type | Default | Rationale |
|------|------|---------|-----------|
| `experts` | expert_list | Built-in set | Enable/disable experts, set per-expert model, temperature, prompt, and priority. |
| `custom_experts` | expert_list | Empty | Define entirely new experts with custom prompts for domain-specific analysis. |
| `always_run` | string_list | `["task_extraction"]` | Experts that run on every message regardless of Input Gate routing. `task_extraction` must always run because it extracts structured data from every user response. |
| `background_experts` | string_list | `["task_extraction"]` | Experts whose results are collected **after** the response is generated. They don't block the response pipeline, making them ideal for side-effect experts (data extraction, logging). |

**Design decision — always_run vs. background_experts**: These are independent flags. An expert can be always-run but blocking (its findings influence the response), or always-run and background (it runs every turn but doesn't delay the response). `task_extraction` is both: it must run every turn to capture deliverables, but its output feeds the state machine rather than the response, so it runs in the background.

**When to customize**: Add custom experts for domain-specific analysis (e.g., a "compliance" expert for regulated industries). Reorder expert priority to change which expert "wins" in arbitration conflicts.

### Arbitration

**Purpose**: Deterministic priority-based conflict resolution. When multiple experts return verdicts, Arbitration selects the highest-priority one and determines the response tone.

| Slot | Type | Default | Rationale |
|------|------|---------|-----------|
| `tone_map` | key_value | Expert → tone mapping | Maps each expert to a tone (e.g., `medical → cautious`, `probing → curious`). The winning expert's tone is injected into the Response Generator's context. |
| `gate_failure_message` | text | "I'm sorry, I didn't quite catch that..." | Returned when `noise_detection` classifies input as unclear. A static string rather than LLM-generated to ensure consistent, fast handling of garbled audio. |

**Why not LLM-based?** V1's Aggregator uses an LLM to synthesize multiple expert findings (~500ms, non-deterministic). Arbitration uses a fixed priority order (~1ms) — the expert list order defines priority. This makes conflict resolution predictable: given the same expert verdicts, the same expert always wins. The Response Generator then crafts a natural response using the winning verdict as context.

**When to customize**: Adjust tone_map when adding custom experts. Modify gate_failure_message for localization or brand voice.

### Response Generator

**Purpose**: Produces the final spoken response, streaming tokens to TTS for low-latency audio output.

| Slot | Type | Default | Rationale |
|------|------|---------|-----------|
| `persona` | text | STELLA persona | The agent's identity, behavioral rules, and response constraints. This is the primary customization surface for agent personality. |
| `conversation_guidelines` | text | Professional interviewer style | Detailed rules for tone, register, response length, and formatting. Separate from persona to allow mixing different identities with the same conversational style. |
| `model` | select | `gpt-4o-mini` | Balances quality and speed. Upgrade to `gpt-4o` for complex domains requiring stronger reasoning. |
| `temperature` | number | `0.7` | Moderate temperature for natural conversational variation. Lower for more consistent responses, higher for more creative ones. |
| `max_tokens` | number | `150` | Targets 30-50 spoken words. Voice conversations need short responses — long monologues feel unnatural in speech. |

**Why persona and guidelines are separate**: `persona` defines *who* the agent is ("You are STELLA, a warm AI companion"). `conversation_guidelines` defines *how* it speaks (tone, length, formatting rules). This separation lets you swap personas while keeping the same conversational style, or vice versa.

**When to customize**: Always customize persona for domain-specific deployments. Adjust temperature and max_tokens based on whether you need consistent short answers (lower both) or detailed explanations (raise both).

### Bridge Generator

**Purpose**: Produces an ultra-short conversational filler phrase immediately when the user stops speaking, synthesized via TTS while the full pipeline runs in parallel.

| Slot | Type | Default | Rationale |
|------|------|---------|-----------|
| `system_prompt` | text | Bridge phrase rules | Strict rules: complete sentence, max 6 words, never answer the question, match user's language. |
| `model` | select | `gpt-4o-mini` | Must be fast — the bridge needs to be spoken before the main response starts generating. |
| `temperature` | number | `0.4` | Low-moderate for slight variation without unpredictability. Bridges should feel natural but not surprising. |
| `max_tokens` | number | `30` | Very low cap because output is a single short sentence (e.g., "Good question.", "Absolutely.", "I appreciate that."). |

**Why the Bridge Generator exists**: In voice conversations, silence after the user stops speaking feels like the agent is unresponsive. The bridge fills this gap with a natural acknowledgment while the full pipeline (Input Gate → Experts → Arbitration → Response Generator) runs in parallel. This reduces **perceived** latency from ~800ms to ~100ms without affecting actual processing time. The bridge phrase is spoken as a standalone TTS segment, and the full response follows immediately after.

**When to customize**: Adjust the system prompt to match your agent's personality (e.g., more formal bridges for professional domains, warmer bridges for casual ones).

## Thresholds

Thresholds are global pipeline parameters that affect cross-stage behavior.

### history_limit

| Property | Value |
|----------|-------|
| Default | `20` |
| Range | `5` – `50` |
| Step | `5` |

Controls how many conversation history messages are included in LLM context. This is a tradeoff:

- **Higher values**: Better context understanding, the agent remembers more of the conversation. But increases token cost and may hit context window limits.
- **Lower values**: Faster, cheaper, but the agent may "forget" earlier parts of the conversation.

The default of 20 messages (~10 exchanges) works well for most conversations. Increase for long-form interviews or complex multi-step workflows. Decrease for simple, transactional interactions.

## How Configurations Reach the Agent

When an agent is deployed with a selected configuration:

1. The frontend sends the configuration's `nodes` and `thresholds` overrides as `pipeline_config` in the agent creation request
2. The backend validates overrides against the `pipelineSchema` (unknown node IDs and out-of-range thresholds are rejected)
3. The validated config is serialized as JSON into the `AGENT_CONFIG` environment variable on the Kubernetes pod
4. The agent reads `AGENT_CONFIG` on startup and calls `_apply_pipeline_config()` to merge overrides with schema defaults
5. Each pipeline stage reads its overrides from `config.nodes[stage_id]`

If no `pipeline_config` is present, the agent raises an error — configuration is mandatory for stella-v2.

## See Also

- [Pipeline Schema Reference](/docs/agents/stella-v2/pipeline-schema) — Full `pipelineSchema` format for defining configurable pipelines
- [stella-v2 Overview](/docs/agents/stella-v2) — Architecture and design rationale
