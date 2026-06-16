# Session Auto-End — E2E Verification Runbook (#198)

The backend orchestration is covered deterministically in CI by
`src/sessions/session-auto-end.integration.spec.ts` (cap → graceful close → LiveKit
`session_end` → bounded grace → `CLOSED`). This runbook covers the **agent-side**
half, which needs a live stack and can't be unit-tested.

## What this verifies

```
first agent message ─► cap timer armed (SessionTimeoutService)
        cap elapses  ─► SessionsService.beginGracefulClose()
                          ├─ status: ACTIVE → CLOSING   (lockdown)
                          └─ LiveKit data: {type:"session_end", reason, deadline_ms=60s}
        agent (rebuilt) ─► _handle_data_message → handle_session_end
                          ├─ wait-for-quiet (≤60s): user not mid-utterance, no turn
                          │   generating, agent not speaking
                          │     • goes quiet  → wrap up immediately
                          │     • 60s elapses → suppress barge-in, interrupt & farewell
                          ├─ on_session_ending / farewell (spoken)
                          └─ shutdown → leaves room
        backstop (60s wait + 15s farewell reserve = 75s)
                     ─► force-close → status CLOSING → CLOSED, session.closed SSE
```

## Prerequisites

1. **Rebuild the agent image** — the SDK/agent changes (`pipeline._handle_data_message`
   `session_end` branch, `run.py` handler, `on_session_ending`, the `interrupt_handler`
   `agent.yaml` node) only run in a rebuilt agent. A backend (SMS) rebuild alone is
   **not** enough: rebuild the agent **base image** and re-tag the cached
   `cfg-<fingerprint>` image.
2. **Apply the migration** — `npx prisma migrate deploy` (runs automatically via
   `prestart`/the K8s `run-migrations` init container) applies
   `20260611000000_add_session_max_duration_cap`.
3. A deployed stack: backend + LiveKit + STT/TTS + the rebuilt agent.

## Setup

1. Set a short cap for testing — e.g. **1 minute (60s)**. The cap is opt-in per
   session and is set in one of two places (never a project-wide default):
   - **Manual invite**: the "Session Duration" step in the Invite Participant modal
     (stored on the invitation, then propagated onto the session).
   - **Public session**: the "Session Duration" step when setting up the public
     session (stored as `publicMaxSessionDurationSeconds`, carried on the invitation
     the public join creates).
2. (Optional) Set an End-node **farewell message** on the plan so the default
   `farewell` mode has something to say. Or set the agent's **Session-End Wrap-up**
   node (Configurator) to `wrap_up` (custom closing) or `silent`.
3. Start a session and join as a participant; wait for the agent's first message
   (this arms the cap).

## Expected timeline (60s cap)

| t | Observe |
|---|---|
| ~0s | Agent speaks first message → cap armed. `Session.firstAgentMessageAt` set in DB. |
| ~58–60s | Frontend shows the **"Session ending soon"** warning banner (≤120s remaining → fires ~immediately for a short cap). |
| 60s | Backend log `Graceful close for session …`. DB `status` = **CLOSING**. A LiveKit data message `{"type":"session_end", deadline_ms:60000}` is published to the room. |
| 60s+ | Agent receives it and **waits for the conversation to go quiet** (up to 60s). If you stay silent it wraps up right away; if you keep talking it waits, then **interrupts** at the end of the window. Then it **speaks the farewell/wrap-up** and disconnects. |
| ≤135s | DB `status` = **CLOSED**, `closedAt` set. `session.closed` SSE emitted. Agent pod torn down. (Backstop fires at 60s wait + 15s farewell reserve after `CLOSING` if the agent never leaves on its own.) |

### Verify the "let the user finish" behavior explicitly

- **Quiet → immediate wrap-up**: when the cap fires, stay silent. Agent log
  `[SESSION END] conversation quiet — wrapping up`; the farewell starts within ~1s.
- **Talking → wait, then interrupt**: when the cap fires, keep talking continuously.
  The farewell does **not** start while you speak. At the end of the 60s window:
  `[SESSION END] wait window elapsed — interrupting to say farewell` and
  `suppressing barge-in for the closing farewell` — the farewell now plays over you
  and is **not** suspended by your speech.
- **Talking, then stop**: keep talking, then go silent partway through the window —
  the agent wraps up the moment you stop, not at the full 60s.

## What to check

- **DB**: `SELECT status, "closedAt", "firstAgentMessageAt", "maxSessionDurationSeconds" FROM "Session" WHERE id = '<id>';` →
  `ACTIVE` → `CLOSING` → `CLOSED`, `closedAt` non-null.
- **Backend logs**: `Graceful close for session … — wrap-up signal + 60000ms wait + 15000ms farewell reserve`, then `Closing session … - stopping all agents`.
- **Agent logs**: `[SESSION END] signal received …`, then `entering closing state — no new turns accepted`, then either the quiet or the interrupt line above. The agent stops itself (disconnects).
- **Frontend**: the warning banner shows before the cap; the **timeout overlay appears only after the agent's goodbye** (on the agent's `session_ended` data signal, or — as a fallback — when the LiveKit room is torn down). It must NOT appear at the cap instant.
- **SSE** (`/projects/:id/events` or admin dashboard): a `session.closed` event.
- **Invitation**: `SELECT status FROM "Invitation" WHERE "sessionId" = '<id>';` → `REVOKED` after close.
- **Participant disconnect**: the human is kicked from the room (backend `close()` deletes the LiveKit room) — the participant client sees `Disconnected` and the overlay, never a dead room.

## Stall / deadline path

To verify the hard deadline (agent never finishes its wrap-up):

1. Set the agent's interrupt mode to `wrap_up` and make `on_session_ending` hang
   (or just confirm the timing with a slow TTS).
2. The backend **force-closes at the backstop** regardless (wait budget + farewell
   reserve = ~75s after `CLOSING`) — `status` reaches `CLOSED` and
   `stopAllSessionAgents` tears the pod down. The session must never hang in
   `CLOSING`.

## Negative checks

- **No cap** (invite/public session created without a Session Duration): the
  session's `maxSessionDurationSeconds` stays null; session runs indefinitely and no
  `session_end` is ever published.
- **Inactivity ≠ close**: leaving the room only **pauses** agents
  (`agentInactivityTimeoutMinutes`); the session stays `ACTIVE`. Only the cap, a plan
  finish, or a manual close moves it to `CLOSED`.
