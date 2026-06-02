# RFC: Coherent language handling (STT → LLM → TTS)

- **Ticket:** [#214 — Coherent language handling for STT, TTS, and user selection](https://github.com/c4dhi/STELLA/issues/214)
- **Status:** Draft for review
- **Date:** 2026-06-01
- **Scope:** Design proposal. No implementation in this RFC — it defines the target behaviour and the mechanism changes the team should sign off on before any code lands.

---

## 1. Problem

Language is currently **decided three separate times** in a single session, and nothing keeps those decisions in sync:

| Stage | How language is decided today | Source |
|---|---|---|
| STT (Whisper) | Auto-detects, caches **once** per session after ≥2s, then forces it | `stt-service/src/providers/whisper_provider.py:444,518,538-542` |
| Bridge | German word-list heuristic on the transcript text | `agents/stella-v2-agent/src/stella_v2_agent/pipeline/bridge_generator.py:110-127` |
| LLM response | "Respond in the same language the user speaks" prompt; LLM infers | `agents/stella-v2-agent/src/stella_v2_agent/prompts/response_prompt.py:102-123` |
| TTS voice | Static `TTS_LANGUAGE` env var, fixed per process | `agents/stella-ai-agent-sdk/src/stella_agent_sdk/audio/pipeline.py:152` |

Because each stage decides independently, they can disagree **within one turn** — the most visible failure being a **bridge in one language and the main response in another**, spoken by whatever voice the env var happens to name.

There is also no way for a plan author to declare an expected language, and the STT proto cannot accept a language hint even if we wanted to give one.

---

## 2. Goals

1. The system **automatically** picks up the spoken language and responds in it — no required user action.
2. **Coherence by construction:** the bridge and the main response (text + voice) are always in the same language within a turn.
3. **Reliable, not twitchy:** a single ambiguous word ("ja", "ok", a number) must not flip the language; switching is allowed but only on a sustained, confident change.
4. Keep it **simple**: one source of truth, minimal new surface area.

### Non-goals

- Supporting languages we cannot serve end-to-end (see §7). Auto-detection is only ever as wide as our voice coverage.
- Per-word / intra-utterance language mixing.

---

## 3. Decisions (agreed)

| Decision | Choice | Rationale |
|---|---|---|
| Detection granularity | **Confidence-gated switch** — session-locked by default; switches only on a sustained, high-confidence change | Reliability without trapping a genuine language switch |
| Plan-author control | **Optional declared default** — author may set a language (acts as seed + STT hint) or leave it `auto` | Reliability when language is known; auto otherwise |
| Participant picker | **None — pure auto-detect** | Matches the "system just picks it up" goal; zero friction |

---

## 4. Core principle: detect once, propagate everywhere

Collapse the three independent detections into **one authoritative detection that flows downstream**:

```
Agent session.language  ──(hint, down)──►  STT: force transcription to L   (stability + accuracy)
   (single source of truth)               STT also probes detection independently
        ▲                                          │
        └───(detected_language + confidence, up)───┘
   Agent applies the confidence-gated switch, then feeds the resolved
   per-turn language to ──► bridge ──► LLM prompt ──► TTS request.language
```

- **STT reports, the agent decides.** STT emits a real per-utterance `detected_language` + `confidence`. The gating policy (debounce, thresholds, clamp to supported set) lives in the **agent**, where it belongs as product logic — not in the STT VAD loop.
- The agent sends its locked language **down** to STT as a transcription hint (improves transcription accuracy and stability).
- The agent feeds the single resolved per-turn language **up the rest of the pipeline**: bridge, LLM prompt, TTS request.

---

## 5. Why this guarantees bridge ↔ main coherence

The bridge is **not** racing ahead of language detection. The actual timing:

- The bridge is generated from the **final** transcript text, in parallel with the **input gate** — not ahead of STT (`agents/stella-v2-agent/src/stella_v2_agent/agent.py:170-172`).
- The final transcript is produced by `_generate_final()`, and **that exact call is where Whisper computes the language** (`whisper_provider.py:521,538-542`).

So at the moment the bridge text is generated, STT has *already* decided the language for that very utterance — the language simply isn't plumbed to the agent yet (the proto `TranscriptEvent` has no language field).

**Therefore:** once `detected_language` rides on the final `TranscriptEvent`, the bridge, the LLM response, and the TTS request can all be generated in the same confident, STT-detected language for that turn.

> **The coherence rule:** language is resolved once per turn, before the bridge fires, and is immutable for that turn. A confidence-gated switch takes effect at a **turn boundary**, never mid-turn.

This makes a **language-neutral / filler bridge unnecessary** — an earlier idea we explicitly reject here. It would have degraded as bridges grow longer; instead the bridge is always produced directly in the detected language. No filler, no one-turn lag.

---

## 6. The catch with "confidence-gated switch" (and the fix)

As written today, STT will **not** hand the agent a switch signal:

1. **It locks once and never re-detects** — `whisper_provider.py:538`: `if not self.detected_language` sets it permanently on the first ≥2s utterance.
2. **It then *forces* that language into every later transcription** — lines 444/518 pass `language=self.detected_language`. When faster-whisper is given `language=`, detection is **skipped** and `info.language_probability` is effectively 1.0 — so `info.language` on turn 2+ just echoes the locked value. A real switch would be invisible.

**Fix:** STT must report a genuine per-utterance detection **separately** from the language it forces for transcription stability. faster-whisper exposes `info.language_probability` and a standalone `detect_language()`, so this is cheap:

- Keep forcing the agent-supplied hint into `transcribe()` for transcription **quality/stability**.
- On substantial utterances (≥ the existing ~2s threshold), run an **independent** language-detect probe and return `detected_language` + `confidence` on the event regardless of the forced language.
- The agent compares the probe to its lock and applies the gate.

**Minor accepted cost:** on the single utterance where a switch is detected, transcription was still forced to the *old* language, so that one transcript may be slightly degraded (e.g. English audio transcribed as German). It is rare, self-corrects on the next turn (now hinted correctly), and is far cheaper than a filler bridge or a lag.

---

## 7. Provider / voice coverage — **best-effort, provider-agnostic**

The resolved language is plumbed to TTS as a **per-request hint**: a provider that can switch language honors it; a provider that can't **discards it**. The feature is **not gated on any particular provider** — it works with whatever is deployed, and spoken-voice multilingualism is an upgrade you get for free when the deployed provider supports it.

Crucially, the **LLM-side coherence is provider-independent**: the response *text*, the bridge, and the `{{language}}` variable always follow the detected language regardless of which voice speaks it. The provider only decides whether the *spoken audio* can also follow.

A validation pass (see §13) found the provider landscape changed since the ticket was filed — **Edge TTS is fully removed** — and that providers fall into two groups, **all of which accept the `language` field without erroring** (verified):

| Provider | Languages | Per-request `language` | Behavior when it can't honor it | File |
|---|---|---|---|---|
| **Piper** (current default) | One per deployed voice | Ignored | Accepts & silently ignores; speaks its built `PIPER_VOICE` | `piper_provider.py:131,172` |
| **Kokoro** | English only | Ignored | Accepts & silently ignores | `kokoro_provider.py:332,390` |
| **Qwen3** | 60+, autodetect | **Honored** (`_resolve_language` → model) | n/a (autodetects) | `qwen3_provider.py:217-227` |
| **ChatterBox** | `en`, `de` | **Honored** (`_resolve_language` → `language_id`) | Unsupported code → logs + falls back to `CHATTERBOX_LANGUAGE` | `chatterbox_provider.py:203-209` |

**Consequence:** with Piper/Kokoro the spoken voice stays fixed, but the agent still *responds* in the user's language — degraded gracefully, not broken. Deploying Qwen3 or ChatterBox additionally makes the **voice** follow, with no code change (env/build-arg + model weights only). Mechanism #9 is a no-op on a non-honoring provider but is never harmful.

**Agent-side clamp (separate concern):** the resolver still clamps its *own* decision to a committed supported set (v1: `en`, `de`) so the LLM is never asked to respond in a language we don't intend to support. If STT confidently detects something outside that set, the agent keeps the current locked / plan-default language. This clamp is about what the system commits to answer in; the TTS discard-the-tag behavior above is the independent provider layer. Adding a language later means widening the resolver's supported set **and** (for spoken voice) deploying a provider that can speak it.

---

## 8. Language resolution order (per turn)

The agent resolves **one** `session.language` value each turn, in order:

1. **Plan default**, if the author set one — seeds turn 1 and is sent to STT as the transcription hint. If `auto`, skip.
2. **Auto-detect** — the first confident (`confidence ≥ threshold`, ≥2s) utterance sets the lock.
3. **Hold the lock** — it does not change turn-to-turn by default.
4. **Confidence-gated switch** — change the lock only if STT's independent detection reports a *different supported* language, with `confidence ≥ switch_threshold`, over a *substantial* utterance, ideally debounced over 2 consecutive detections. Stray short utterances cannot flip it.
5. **Clamp to supported set** — anything outside §7 keeps the current lock.

### 8.1 Conflict: plan language ≠ spoken language

**Default rule: the spoken language wins.** The plan language is a *seed*, never a cage — consistent with the "optional declared default (soft)" decision in §3.

| Plan | User speaks | Resolution |
|---|---|---|
| `auto` | anything | Pure detect. No conflict. |
| `de` (seed) | German | No conflict; seed also sharpens turn-1 STT accuracy. |
| `de` (seed) | **English (supported)** | **English wins.** Seed is used only as (a) the turn-1 STT hint and (b) the tiebreaker *while detection is still low-confidence*; a confident detection overrides it. |
| `de` (seed) | French (unsupported) | Clamp (§7): stay in `de`. Never switch into a language we can't speak. |

This is safe because of validation finding 6 (§13): **plans are instructions, not scripts.** Plan states carry `description` / `instruction` / `goal.objective` / `acceptance_criteria` — interpreted by the LLM, never spoken verbatim — and transitions match collected *data values* (`actual == expected`), not text. So a German-authored plan conducted in English still behaves correctly; it just sounds English. There is no opening/verbatim line to mis-language.

**The trap this exposes — hint, never deafen.** The agent feeds its locked language *down* to STT as a transcription hint (§4). Naively, a `de`-seeded plan would hint Whisper to German and then **mis-transcribe an English speaker and never detect the mismatch** — the plan would silently corrupt comprehension.

> **Rule: the plan seed may *bias* STT's first guess, but must never suppress STT's independent detection (§6).** STT always reports the true spoken language even when hinted otherwise. The seed governs the resolved language only while detection is genuinely uncertain (turn 1, sub-2s utterances). Once STT confidently hears another supported language, that wins — for transcription, response, **and** voice.

**Residual edge:** transitions compare canonical deliverable values (e.g. `issue_type == "billing"`). When the user speaks German, the deliverable-extraction step must normalize to the plan's canonical value (`"billing"`, not `"Abrechnung"`). Usually handled by `acceptance_criteria`/`options`, but it is the one place cross-language can bite — flagged for a test (§14).

**Forced plans (deferred — open question #2):** if a future `force: true` plan must stay in its language (e.g. a German-only assessment/tutor), the rule is **pin the output, never the ears**: force the LLM response + TTS to the plan language, but let STT still detect/transcribe the actually-spoken language so the agent comprehends and can redirect. Forcing STT is never correct.

Thresholds (`detect_threshold`, `switch_threshold`, debounce count, min duration) are tunable constants, defined in the agent.

### 8.2 Exposing the resolved language as a runtime variable

The resolved language should be surfaced into prompts as a **runtime variable**, so the LLM (and optionally plan authors) can reference it like any other context. There are two existing variable systems, and the choice between them matters:

| System | Lifecycle | Populated by | Fit for detected language |
|---|---|---|---|
| `SessionContextField` (`plan/types.py:157-189`) | **Set-once** at session start | Author-declared, participant-filled | ❌ No — it's for static participant data; we also chose no participant picker |
| `{{placeholder}}` template vars (`experts/template_compiler.py`, `PLACEHOLDER_REGISTRY`) | **Recomputed per turn** | System-computed from plan/state/history | ✅ Yes — already dynamic and system-populated |

**Decision:** add a `{{language}}` placeholder backed by the resolved `session.language`, populated into `sm_context` each turn. It would be the first *observation-derived* placeholder (today they're plan/history-derived) — a small, natural extension of the registry.

The variable is a **projection** of the single source of truth (§4/§6), not a second source. `session.language` remains authoritative; `{{language}}` merely exposes it to the response prompt — and, if useful, to plan instructions (an author could write "the user is speaking {{language}}"). This keeps two things distinct that are easy to conflate: the **seed** (`Plan.language`, static, author-set, default `auto`) *feeds* resolution; the **exposed value** (`{{language}}`, dynamic) is the *result*.

### 8.2.1 Bridge ↔ pipeline consistency

There is **no inherent drift** to engineer around: the only reason bridge and pipeline can disagree today is that each **independently infers** language. The fix is exactly to inject the one resolved value into both — no special coherence machinery.

Today's three independent guesses:
- **Bridge LLM** — relies on the prompt instruction *"Always match the user's language"* (`bridge_generator.py:59`); the model guesses from the user text.
- **Bridge fallback** — uses the `_detect_german` heuristic when the LLM call fails/rejects (`bridge_generator.py:216`).
- **Pipeline LLM** — a separate call with its own *"respond in the same language"* instruction (`response_prompt.py:102-123`).

The two paths don't share one variable mechanism, so "inject into both" is two wirings, not one shared `{{language}}`:

| Path | Prompt construction | Injection point |
|---|---|---|
| Pipeline / experts | `template_compiler` `{{placeholder}}` | Add `{{language}}`, backed by `sm_context["language"]` |
| Bridge | Direct string messages, **no template engine** (`bridge_generator.py:175-179`) | Pass resolved value into `generate(..., language=...)`; use it in the prompt **and** in `_pick_fallback` (replace `_detect_german`) |

> **Requirement: one source, frozen per turn, no path guesses on its own.** Resolve `session.language` once at turn start (before the bridge fires) and feed that same value into all three injection points above. Across a confidence-gated switch the value changes only at a turn boundary, so the bridge and the response stay coherent through the switch.

### 8.3 Text input (no STT signal available)

When the participant **types** (the text chat surface) there is no audio and therefore no Whisper detection. The design stays clean by making language resolution **modality-agnostic**: the resolution/gating logic in §8 consumes a `(language, confidence)` signal and does not care whether that signal came from acoustic detection or from text.

- **The text path produces the same signal shape as STT** via a lightweight text language classifier (confidence-scored — e.g. a `lingua`-class detector; the current `_detect_german` heuristic is the crude floor). It emits `(language, confidence)` exactly like §6's STT probe.
- **The same gating applies:** a short/ambiguous typed message ("ok", "ja", "thx") is low-confidence → it does **not** flip the lock, same as a sub-2s utterance.
- **The lock persists across modalities.** `session.language` is one value per session regardless of whether a turn was spoken or typed, so a voice-established language carries into a typed turn and vice versa (relevant because both chat surfaces can coexist).

**Unified fallback chain (covers voice-confident, voice-unconfident, and text):** resolved language for a turn =
1. a confident modality signal (STT acoustic **or** text classifier) ≥ threshold and supported; else
2. the current session lock — i.e. **the last detected language** in this conversation, from any prior turn or modality; else
3. the plan seed (`Plan.language`, if set); else
4. the service/global default.

So an ambiguous turn in an ongoing conversation always holds the last detected language; the seed/default only apply before anything has been detected. A lock established *provisionally* from the seed/default (turn-1 ambiguity) is **not** treated as a real detection — the first genuine detection adopts it at `detect_threshold` rather than having to clear the higher `switch_threshold`, so the last *detected* language always wins over a placeholder.

This also covers the case where STT *runs* but returns no confident language (too short, noisy) — it simply falls through to step 2/3/4, identical to the text path.

---

## 9. Mechanism changes (no implementation in this RFC)

| # | Change | Location | Why |
|---|---|---|---|
| 1 | Add `detected_language` (string, ISO 639-1) + `language_confidence` (float) to the **final** `TranscriptEvent` | `proto/stt.proto` (response) | The missing pipe — Whisper already detects it, then drops it at the gRPC boundary |
| 2 | Add a `language` **hint** field to the STT request/config | `proto/stt.proto` (request) | Lets the agent drive transcription stability/accuracy (ticket-flagged gap) |
| 3 | Emit a real per-utterance detection + confidence (read `info.language_probability`; use `detect_language()` for the independent probe); stop the permanent single-lock | `stt-service/src/providers/whisper_provider.py:444,518,538-542` | Without this, switches are invisible (§6). Library (faster-whisper `>=1.0.0`) exposes both; code doesn't read them yet |
| 4 | Read new fields through to the agent's `TranscriptEvent` dataclass | `agents/stella-ai-agent-sdk/src/stella_agent_sdk/services/stt_client.py:14-37` (`from_proto`) | Plumb language to the agent |
| 5 | Add optional `language` to plan/session schema (`auto` default) | `agents/stella-ai-agent-sdk/src/stella_agent_sdk/plan/types.py` | Plan default + STT hint |
| 6 | Hold `session.language` + apply the gated-switch policy | agent SDK session state | Single source of truth |
| 7 | Generate the bridge in the resolved language; **remove** the `_detect_german` word-list heuristic | `agents/stella-v2-agent/src/stella_v2_agent/pipeline/bridge_generator.py:110-127,156-174` | Stop independent guessing |
| 8 | Replace "match the user" with an explicit `Respond in {language}` instruction | `agents/stella-v2-agent/src/stella_v2_agent/prompts/response_prompt.py:102-123` | Deterministic LLM language |
| 9 | Pass the resolved language per-utterance into `SynthesizeRequest.language`; retire static `TTS_LANGUAGE` | `agents/stella-ai-agent-sdk/src/stella_agent_sdk/audio/pipeline.py:143,834,1102,1118` | Dynamic voice; proto already supports it (`proto/tts.proto:22`). Best-effort: honoring providers switch voice, others discard the tag (§7) |
| 10 | Define + document the supported language set and out-of-set fallback | `tts-service/src/providers/*` | Reliability guardrail (§7) |
| 11 | *(Optional upgrade)* Deploy a provider that honors per-request `language` (Qwen3 or ChatterBox) to make the **spoken voice** follow too | `tts-service/src/tts_server.py:35`, Dockerfile `ARG TTS_PROVIDER` | Env/build-arg + weights only, no code. Without it the voice stays fixed but the response text still follows the language (§7) |
| 12 | Add a `{{language}}` placeholder; populate `sm_context["language"]` from the resolved value each turn | `agents/stella-v2-agent/src/stella_v2_agent/experts/template_compiler.py` (`PLACEHOLDER_REGISTRY`) | Expose the resolved language as a runtime variable (§8.2); first observation-derived placeholder |
| 13 | Add a confidence-scored **text** language classifier emitting `(language, confidence)` for typed turns | text-chat input path (agent SDK) | Modality-agnostic resolution when no STT signal exists (§8.3) |

---

## 10. Participant experience

- Speaks German → STT detects `de` → bridge in German, answer in German, German voice. Speaks English → all English. **No setup, no picker.**
- Mid-session switch to the *other supported* language → resolves at the next turn boundary; bridge + response + voice all switch together, coherently. No filler.
- Single ambiguous word → **nothing flips**; stays stable.
- Unsupported language → stays in the locked / plan-default language instead of going silent or broken.

---

## 11. Open questions for review

1. **TTS provider for spoken multilingualism (optional upgrade, not a gate)** — the feature ships and degrades gracefully on any provider (§7). To make the *voice* follow the language too, deploy **Qwen3** (60+ langs, autodetect) or **ChatterBox** (en/de). Worth doing for the study, but not required for the agent-side coherence to land.
2. **Lock vs. force at plan level** — "optional declared default" is a *soft seed* today; do we also want an explicit `force: true` for plans that must never switch (e.g. a German-only assessment)? Proposed as a later refinement, not v1.
3. **Threshold values** — initial `detect_threshold` / `switch_threshold` / debounce count (§8) to be set empirically.
4. **Switch-utterance degradation** (§6) — accept the minor one-utterance transcription cost, or re-transcribe the switch utterance in the detected language at a latency cost? RFC proposes accepting it for v1.

> **Resolved by §13 validation:** Kokoro is English-only; Edge TTS is removed; faster-whisper `>=1.0.0` exposes `language_probability` + `detect_language()`; `TTS_LANGUAGE` is the sole TTS language source today.

---

## 12. Summary

One authoritative detection (STT), plumbed up through the proto, owned and gated by the agent, fed to bridge + LLM + TTS. The bridge already fires on the final transcript — the same moment STT computes the language — so coherence is free once the language is plumbed. No neutral bridge, no static env var, no triple-detection drift. The resolved language is plumbed to TTS as a best-effort hint — honoring providers switch the voice, others discard it — so the design works on any provider and the spoken voice is a free upgrade (§7).

---

## 13. Validation findings (2026-06-01)

Before any implementation, the RFC's load-bearing assumptions were checked against the code and dependency pins. This is the "test" appropriate to the design stage — verifying the claims the design rests on.

| # | Assumption | Verdict | Evidence |
|---|---|---|---|
| 1 | faster-whisper exposes per-utterance language **+ confidence** + standalone detect | **Confirmed (library-level)** | Pin `faster-whisper>=1.0.0` (`requirements-gpu.txt:5`) — that API has `TranscriptionInfo.language_probability` and `WhisperModel.detect_language()`. Code reads only `info.language` today (`whisper_provider.py:539`). *Not run live (not installed locally).* |
| 2 | Kokoro covers en/de | **Refuted** | Kokoro is English-only; `language` accepted & ignored (`kokoro_provider.py:337`) |
| 3 | `SynthesizeRequest.language` selects a voice | **Refuted for default** | Default **Piper ignores** `language` (`piper_provider.py:131`); only **Qwen3** + **ChatterBox** honor it |
| 4 | `TTS_LANGUAGE` env is the only TTS language source | **Verified** | Single read at `pipeline.py:143`; clean to retire |
| 5 | Edge TTS present (per ticket) | **Stale** | Fully removed — no `edge` references in `tts-service/` |
| 6 | Plans contain verbatim lines that would mis-language on a switch | **Refuted (good news)** | Plans are **instructions, not scripts** — `description`/`instruction`/`goal.objective`/`acceptance_criteria` are LLM-interpreted (`plan/types.py`, `response_prompt.py:204-303`); no `say`/`script`/`opening` field; transitions match data values not text (`execution_state.py:188-204`) |

**Net effect on the design:** the coherence mechanism (detect-once → propagate) is unaffected and still correct. The change is to §7/§9 — multilingual output is **gated on a TTS provider decision**, not on plumbing. Finding 6 is what makes the §8.1 "spoken language wins" rule safe: conducting a plan in a different language than it was authored in has no content penalty.

---

## 14. Test strategy (for implementation)

What can actually be tested, and where, given the current harnesses:

**Test infrastructure that exists today**
- **Agent SDK** has pytest (`asyncio_mode=auto`, `tests/` — `agents/stella-ai-agent-sdk/pyproject.toml:55-57`). This is where the highest-value, deterministic tests live.
- **stt-service and tts-service have NO test framework** — adding one (pytest) is part of the work if we want service-level coverage.

**Unit tests (deterministic, no models) — Agent SDK pytest, mock the gRPC clients**
1. **Language resolution / gating logic** (§8) — the core. Feed synthetic `TranscriptEvent`s with `(detected_language, confidence, duration)` and assert the resolved `session.language`: holds the lock on low confidence / short utterances; switches only on sustained high-confidence change; clamps out-of-set languages to the lock. *This is the single most important test — it encodes the reliability promise.*
2. **Coherence invariant** — assert that within one turn the bridge language, the LLM prompt's `Respond in {X}`, and the `SynthesizeRequest.language` are the **same** value. This is the regression guard for the original bug.
3. **Plan-default seeding** — `auto` vs explicit; explicit is sent to STT as the hint and seeds turn 1.
4. **Proto round-trip** — `TranscriptEvent.from_proto` carries `detected_language`/`confidence` (`stt_client.py`).

**Service-level tests (need new harness)**
5. **STT probe** — with audio fixtures (one en, one de clip), assert `detect_language()` returns the right language + a usable confidence, and that the forced-language transcription path is unaffected.
6. **TTS provider honors `language`** — on the chosen provider (Qwen3/ChatterBox), assert two requests differing only in `language` produce different audio; assert out-of-set falls back per §7. (Already true in ChatterBox's `_resolve_language`; this locks it in.)

**Manual / integration (the part only a human or a scripted call can confirm)**
7. End-to-end on a deployed provider: speak German → German bridge + answer + voice; switch to English mid-session → coherent switch at the next turn; mutter a one-word "ja" → no flip. There is no automated audio-in→audio-out harness today, so this stays a manual checklist for v1.

**Suggested sequence:** land the gating logic + its unit tests (1–4) first behind the provider decision; they're pure and catch the real risks. Service/manual tests (5–7) follow once the provider is chosen and the proto fields exist.

---

## 15. Implementation status (this branch)

The **agent-side coherence slice is implemented** on `feature/language-handling-214` — the part that delivers auto-detection + bridge/response/voice coherence and is self-contained and testable. It uses a transcript-text language signal, which is modality-agnostic (works for typed input too, §8.3).

**Done:**
- `LanguageResolver` + dependency-free en/de `detect_language` with confidence-gated switching, supported-set clamp, plan seed, fallback chain — `stella-v2-agent/.../pipeline/language_resolver.py` (mechanism #6, signal source for now in lieu of #1/#3).
- Resolution wired once per turn in `agent.py:process()` (before the bridge), stored in `sm_context["language"]` and stamped on bridge + response `metadata["language"]`.
- Bridge generated in the resolved language; `_detect_german` reliance removed from the live path (#7).
- Explicit `Respond entirely in {language}` directive in the response prompt (#8).
- `{{language}}` template placeholder (#12).
- TTS voice follows per turn (best-effort): `AudioPipeline.set_tts_language()` + base-loop wiring from `metadata["language"]`; `TTS_LANGUAGE` env demoted to a seed (#9). Honoring providers switch voice; others discard the tag (§7).
- `Plan.language` seed field, default `auto` (#5, agent-side half).
- Unit tests: 30 cases covering detect / lock / hold / confidence-gated switch / debounce / clamp / seed / provisional-vs-confirmed fallback / reset — `stella-v2-agent/tests/test_language_resolver.py` (green).

**Deferred (follow-up — needs cross-service work + codegen, untestable without GPU/provider):**
- STT acoustic detection propagation: `proto/stt.proto` `detected_language`+confidence and language hint, `whisper_provider` per-utterance probe, `stt_client.from_proto` (#1–#4). The resolver's signal source is designed to swap from transcript-text to this with no change to the gating/propagation.
- **TTS provider for spoken multilingualism (#11, optional)** — deploying Qwen3/ChatterBox makes the *voice* follow the language; env/build-arg + weights only, no code. The plumbing (#9) is in place and degrades gracefully on the Piper default (voice fixed, response text still follows).
- Text-chat classifier as a distinct input-path hook (#13) — currently covered by the same transcript-text resolver.
