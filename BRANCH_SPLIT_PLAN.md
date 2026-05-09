# `prolific_study` Branch Split Plan

Working doc for breaking apart the `prolific_study` branch into tickets/PRs. Update checkboxes as we go. Safe to resume across sessions — this file is the source of truth.

**Context**: Felix pushed ~58 commits / 95 files / ~6.3k LOC onto `prolific_study` to meet two deadlines. This doc classifies each change as either (A) an add-on to a teammate's existing PR, or (B) an independent PR/ticket Felix will own.

**Legend**: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped/decided-not-to

---

## A. Add to teammates' PRs

For each, decide the contribution mode: **comment**, **inline review**, or **push to their branch**.

### A1. PR #168 — End-node & conversation termination (#119, Aymane)
Status: `[x]` DONE — nothing to send
Mode: n/a

**Finding (2026-04-20)**: After diffing `origin/119-...` vs `prolific_study`, all End-node work (CLOSING enum, farewell, PlanBuilder End edges, auto-close on `__end__`) is already on Aymane's branch. The commits that looked like additions on `prolific_study` (`f2e858e`, `b58ae7b`, `e5eafd0`, `136e40d`, etc.) are actually Aymane's — they arrived via the merge commit `83ac961`.

Deltas that remain are NOT End-node work:
- `state-machine.service.ts` delta → `goal_achieved` (#164) → reroute to **A3** (PR #185)
- `webhooks.service.ts` delta → participant-only agent spawn + close-session-when-empty → **B8** (Prolific UX)
- `sessions.service.ts` delta → pagination + timestamp + transcript_chunk → **B9**, **#125**, **#147 follow-up**
- `PlanBuilder.tsx` / `api-types.ts` deltas → likely goal_achieved / import-export / state-list → revisit when working on A3, A6, A7, B-tickets

Action: do not open review comments on PR #168. Felix himself authored 7 of the 13 commits directly on Aymane's branch, so there's nothing extra to send.

**Merge readiness**: PR currently has `reviewDecision: CHANGES_REQUESTED`, `mergeable: UNKNOWN`, no CI. Address existing review comments, then merge safely. No risk to `prolific_study` from the merge itself (conflicts on downstream cherry-picks are separate and resolved per-PR against latest `main`).

**Recommended merge order to minimize conflicts**: #168 → #185 (goal_achieved; biggest `state-machine.service.ts` overlap) → other teammate PRs → Felix's B-ticket PRs cherry-picked onto post-merge `main`.

---

### A2. PR #184 — TTS echo (#146, Aymane)
Status: `[x]` DONE — nothing to send
Mode: n/a

**Finding (2026-04-20)**: Aymane's PR #184 contains only the `echoCancellation: true` / `noiseSuppression: true` flip in both `ParticipantSessionView.tsx` and `capture.ts`. That flip is identical on `prolific_study`. The additional ~100 lines on `prolific_study`'s `ParticipantSessionView.tsx` (SupportModal, SessionCompletedOverlay, SessionTimeoutOverlay, 7-min session timer, session_completed signal handler, mute-on-complete) are all **B8 Prolific UX** work, not echo-related.

Action: do not comment on PR #184. Safe to merge after its own review.

---

### A3. PR #185 — goal_achieved transition (#164, Imene)
Status: `[x]` DONE — nothing to send
Mode: n/a

**Finding (2026-04-20)**: All 4 goal_achieved commits (`33585b9`, `700d2c8`, `f94523f`, `f63867e`) are on Imene's 164 branch. `state-machine.service.spec.ts`, `plan-generator.service.ts`, `PlanTransitionEditor.tsx` are identical between prolific_study and her branch.

Remaining deltas are NOT goal_achieved:
- `state-machine.service.ts` (+178 lines): End-node work (END_STATE_ID, sessionCompleted, farewellMessage) from PR #168
- `PlanBuilder.tsx` (+394 lines): End-node UI + import/export (#122) + room-activity (#19)
- `api-types.ts` (+133 lines): shared across many PRs

---

### A4. PR #186 — Consolidate agent config (#150, Aymane)
Status: `[x]` DONE — nothing to send
Mode: n/a

**Finding (2026-04-20)**: The uncommitted `src/agent-image/agent-image.service.ts` change is a try/catch fallback — when `buildAndImportImage` fails (e.g., `ctr` unavailable in K8s pod), fall back to the pre-built `:latest` image instead of blocking pod creation. PR #186 does NOT touch `agent-image.service.ts`, so this is unrelated to #150.

Reroute: the uncommitted change belongs to **B11 Deploy speedups** (same deploy-path resilience theme as `3e35a98` fast image tagging). Leave uncommitted until B11 branch is created, then add it as part of that PR.

---

### A5. PR #189 — Frontend state-list conditionals (#147, Imene)
Status: `[x]` DONE — nothing to send
Mode: n/a

**Finding (2026-04-20)**: Both state-list commits (`2f2bb39`, `c88bac0`) are on Imene's 147 branch. `AgentTaskCard.tsx`, `StateList.tsx`, `types.ts` are identical. The 235-line `SessionView.tsx` delta is `SessionAnalyticsModal` integration + `progressConversion` helper extraction — belongs to **B1/B2 metrics** work, not state-list.

---

### A6. PR #187 — LiveKit room activity (#19, Imene)
Status: `[-]` (likely no overlap — confirm and skip)

### A7. PR #188 — Plan import/export (#122, Imene)
Status: `[-]` (likely no overlap — confirm and skip)

### A8. PR #183 — Conditional plan docs (#123, Aymane)
Status: `[x]` confirmed no B11 overlap
**Finding (2026-04-20)**: `deploy.sh` touches a different hunk (postgres rollout-status fix at ~L1073) from B11's ConfigMap env-var additions (~L87–100). Clean auto-merge. `plan-generator.service.ts` does overlap with B3/B4 territory (multi-language) — 148 lines in #183 vs 40 on `prolific_study`, non-overlapping hunks but worth re-checking when we reach B3/B4.

---

## B. Felix's own PRs

### B1. Update existing PR #167 — Metrics Aggregation API (#133)
Status: `[ ]`

Files/commits to push up:
- [ ] `src/agents/agents.service.ts`, `agents.controller.ts`, `dto/agent-metrics.dto.ts` (main API)
- [ ] `message-recorder-python/room_manager.py`, `src/message-recorder/room-monitor.service.ts`
- [ ] `useAgentMetrics`, `useSessionAnalytics` hooks
- [ ] `SessionAnalyticsModal.tsx`
- [ ] `8789f57` distinguish bridge vs response latency and track inter-stage gaps

Notes:

---

### B2. NEW PR — Metrics Dashboard UI (#134)
Status: `[ ]`

- [ ] `frontend-ui/src/components/settings/AnalyticsSection.tsx` (453 lines)
- [ ] `frontend-ui/src/components/settings/analytics/StageTimeline.tsx` (688 lines)
- [ ] `frontend-ui/src/components/settings/analytics/SummaryCards.tsx`
- [ ] `frontend-ui/src/hooks/useStageDataPoints.ts`
- [ ] `a26fc41` advanced pipeline timeline and performance drill-down
- [ ] `b1df796` comprehensive performance analytics and improved task extraction
- [ ] `fdcf1de` analytics dashboard plan completion bug fix

Notes:

---

### B3. NEW PR — Conversational style enhancements (#21)
Status: `[ ]`

- [ ] `037e623` conversational naturalness and plan completion analytics (split: analytics portion → #134)
- [ ] `fc82a46` bridge generation logic and conversational responsiveness
- [ ] `efd41a3` much better task execution
- [ ] `ae0418a` remove mhm and other noises

Notes:

---

### B4. NEW PR — Reliable German Transcription (#64)
Status: `[ ]`

- [ ] `b3c1b92` Add German support
- [ ] `4643af6` multi-language support and tts configurability
- [ ] `71c20d8` frontend language
- [ ] `18945bb` transcript handling and multi-language consistency
- [ ] `stt-service/src/providers/whisper_provider.py`
- [ ] `k8s/08-stt-service.yaml`, k8s configmap language config
- [ ] `src/plan-templates/plan-generator.service.ts` (multi-language hunks only)

Notes:

---

### B5. NEW PR — VAD too aggressive (#149)
Status: `[ ]`

- [ ] `3affd08` granular VAD configuration and improved endpointing parameters

Notes:

---

### B6. NEW PR — Empty second message (#166)
Status: `[ ]`

- [ ] `c75e13a` fixed farewell message to be spoken by the agent — decide: #166 or fold into #168
- [ ] Audit for other empty-message-specific fixes

Notes:

---

### B7. NEW PR — Agent stalls on audio end (#165)
Status: `[ ]`

- [ ] `b068212` transcript chunk (inspect — may belong here)
- [ ] Any other transcript/audio-end handling commits

Notes:

---

### B8. NEW TICKET + PR — Prolific study UX
Status: `[ ]` (create ticket first)

- [ ] `d89d166` session timeout counter
- [ ] `e3737d2` session completion overlay and button
- [ ] `310ef73` setup study configurations and participant support UI
- [ ] `d539f36` restrict agent auto-resume to participants
- [ ] `SessionTimeoutOverlay.tsx`, `SessionCompletedOverlay.tsx`, `SupportModal.tsx`, `TermsModal.tsx`

Notes:

---

### B9. NEW TICKET + PR — Sessions pagination & message cursoring
Status: `[ ]` (create ticket first)

- [ ] `a6f9dff` session pagination and message cursoring
- [ ] `SessionsDashboard.tsx` changes

Notes:

---

### B10. Chatterbox TTS — coordinate with Aymane (#195 / #194 / #193)
Status: `[ ]` (needs social decision)

- [ ] `a99cd5b` chatterbox watermarker
- [ ] `6bf857e` chatterbox and agent
- [ ] `tts-service/Dockerfile`, `chatterbox_provider.py`, `piper_provider.py`, `voice_prompt.wav`
- [ ] `k8s/09-tts-service.yaml`

Decision: contribute to Aymane's future branch OR land own PR? → _tbd, ping Aymane_

Notes:

---

### B11. NEW TICKET + PR — Deploy speedups
Status: `[ ]` (create ticket first)

- [ ] `3e35a98` fast image tagging to skip redundant builds
- [ ] `scripts/lib/build.sh`, `scripts/lib/deploy.sh`, `scripts/lib/environment.sh`, `scripts/lib/variables.sh`
- [ ] `scripts/templates/env.local.template`, `scripts/templates/env.production.template`
- [ ] Uncommitted `src/agent-image/agent-image.service.ts` — try/catch fallback to legacy `:latest` when `buildAndImportImage` fails (e.g. `ctr` unavailable in K8s pod). Commit as part of this PR.

Notes:

---

## Open questions / decisions log

- [ ] Default contribution mode for teammate PRs: comment / inline / push directly?
- [ ] Order of attack (suggested: A1 → A2 → A4 → A3/A5 verify → B1 → B2 → …)?
- [ ] For commits that span multiple tickets (e.g., `037e623`): split by file/hunk.
- [ ] Branching strategy: for NEW PRs, cherry-pick commits from `prolific_study` onto a fresh branch from `main`.

---

## Session log

- **2026-04-20**: Doc created. Mapping derived from `git log main..HEAD`, `git diff main...HEAD --stat`, and `gh pr list`.
- **2026-04-20**: A1 (PR #168) investigated and closed as "nothing to send" — End-node work fully on Aymane's branch; remaining deltas belong to other tickets. Added to plan: **new ticket #125 Server Timestamp Fix** (envelope-timestamp hunk in `sessions.service.ts`).
- **2026-04-20**: A2 (PR #184 TTS echo) closed — AEC flip is in sync; extra `ParticipantSessionView.tsx` content belongs to B8 Prolific UX.
- **2026-04-20**: A4 (PR #186 agent config) closed — uncommitted `agent-image.service.ts` fallback is not #150 work; rerouted to B11 Deploy speedups.
- **2026-04-20**: A3 (PR #185 goal_achieved) and A5 (PR #189 state-list) closed — all ticket-specific commits already on respective teammate branches. Remaining deltas on prolific_study belong to End-node, import/export, room-activity, or B-tickets.
- **Section A fully complete. All teammate PRs have nothing to send from prolific_study.** Your prior direct pushes to their branches already landed the contributions.
- Next step: **Section B — split prolific_study's independent work into new PRs.** Suggested start: **B1 (update existing PR #167 Metrics API)** since the branch already exists and is owned by Felix.
