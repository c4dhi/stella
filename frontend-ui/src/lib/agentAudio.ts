import type { AgentSpeechProgress } from './types'

/**
 * Client-side agent-audio silencing for barge-in (#241 / barge-in #15).
 *
 * On barge-in the SDK suspends playback and drops its *server-side* send buffer
 * (room.py `clear_playout`), but the client still holds up to
 * `TTS_PLAYOUT_BUFFER_MS` (default 1000ms) of already-received agent audio in
 * its WebRTC jitter buffer and the `<audio>` element. Nothing pauses that, so
 * without this the agent stays audible for ~1s after the user interrupts —
 * even though the on-screen highlight has already frozen.
 *
 * This mirrors the teleprompter's visual freeze onto the audio sink: silence
 * the agent track the instant playback is `interrupted`, and un-silence it when
 * the same (resumed, on a dismissed barge-in) or a new utterance starts
 * `speaking`. The two outer states (`spoken`, plus a fresh turn's first
 * `speaking`) leave the element unmuted, so normal turns never toggle.
 *
 * `muted` rather than `pause()` is deliberate: the element renders a live
 * WebRTC MediaStream, so muting cuts output immediately while leaving the track
 * live and attached for a clean, gap-free resume.
 */
export function applyAgentAudioSilencing(
  state: AgentSpeechProgress['state'],
  audioEl: HTMLAudioElement | null | undefined,
): void {
  if (!audioEl) return
  if (state === 'interrupted') {
    audioEl.muted = true
  } else if (state === 'speaking') {
    audioEl.muted = false
  }
}
