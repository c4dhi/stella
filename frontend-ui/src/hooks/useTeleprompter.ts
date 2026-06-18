/**
 * useTeleprompter (#241)
 *
 * The single, transport-agnostic source of truth for the word-by-word speech
 * highlight ("teleprompter"). It owns a wall-clock segment schedule and a
 * requestAnimationFrame loop that derive a character cursor from the audio
 * playhead, so words light up in time with what the user actually hears.
 *
 * Both surfaces use this same hook so they behave identically:
 *   - the organizer session chat (ChatView), and
 *   - the participant chat (ParticipantSessionView / ParticipantChatPanel).
 *
 * Each screen only differs in how it feeds events in (different transports):
 *   - call {@link Teleprompter.applyProgress} for every `agent_speech_progress`
 *     envelope, and
 *   - call {@link Teleprompter.noteAgentText} for every `agent_text` update,
 * then render with {@link Teleprompter.spokenChar} / `spokenTranscriptId` /
 * `frozenSpoken` (see `SpokenMessageText`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentSpeechProgress } from '../lib/types'

export type { AgentSpeechProgress }

// The speech-progress data event reaches the client ahead of the audio it
// describes (the audio waits in the client jitter buffer before it is heard).
// Delay the word cursor by this much so the highlight lands with the sound
// rather than racing it. Empirical; ±150ms reads as in-sync.
const TELEPROMPTER_CLIENT_LAG_MS = 150

/** A spoken sentence scheduled on the wall clock (performance.now() ms). */
interface Segment {
  charStart: number
  charEnd: number
  startAt: number
  endAt: number
}

export interface Teleprompter {
  /** Absolute char offset spoken so far; drives the highlight. */
  spokenChar: number
  /** Transcript currently being spoken — its bubble gets the live highlight. */
  spokenTranscriptId: string
  /** Transcripts frozen by a committed barge-in → keep a partial highlight. */
  frozenSpoken: Record<string, number>
  /** Full text of the transcript currently being spoken (dim backdrop for overlays). */
  spokenText: string
  /** Apply an `agent_speech_progress` envelope. */
  applyProgress: (data: AgentSpeechProgress) => void
  /** Record the latest `agent_text` for a transcript (binds + dims ahead of voice). */
  noteAgentText: (transcriptId: string, text: string) => void
  /**
   * Drop the visible spoken backdrop so a finished/interrupted agent turn stops
   * lingering on screen (e.g. once the user has finalized their reply). The
   * transcript binding and any frozen highlight are left intact, so a genuine
   * barge-in that the agent resumes is restored unchanged by {@link applyProgress}.
   */
  clearSpoken: () => void
}

export function useTeleprompter(): Teleprompter {
  const [spokenChar, setSpokenChar] = useState(0)
  const [spokenTranscriptId, setSpokenTranscriptId] = useState('')
  const [frozenSpoken, setFrozenSpoken] = useState<Record<string, number>>({})
  const [spokenText, setSpokenText] = useState('')

  // The SDK pushes audio ahead of actual playout, so speech-progress events
  // arrive earlier than the audio is heard — sometimes a whole sentence at
  // once. Rather than apply them immediately, we SCHEDULE each spoken sentence
  // as a segment on a wall-clock timeline ([startAt, endAt) in performance.now()
  // ms), chained so segments never overlap. A single rAF derives the cursor
  // from the clock, so it tracks the audio the user hears.
  const segmentsRef = useRef<Segment[]>([])
  const scheduledUntilRef = useRef(0) // wall-clock ms the schedule reaches
  const frozenRef = useRef(false) // barge-in froze the cursor; hold position
  const rafRef = useRef<number | null>(null)
  // Flips true the first time a progress envelope arrives (teleprompter live
  // this session). Until then agent bubbles render normally, so a TTS-off
  // session is never left permanently dimmed.
  const activeRef = useRef(false)
  // The transcript the cursor is currently bound to — the single source of
  // truth for "which turn are we on". Both event feeds funnel new-turn
  // detection through beginTranscript() keyed on this, so the faster agent_text
  // stream can never reset a turn whose highlight is already advancing.
  const transcriptIdRef = useRef('')
  const textByTranscriptRef = useRef<Map<string, string>>(new Map())
  const prefersReducedMotionRef = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )

  // Word-cursor loop: derive the lit char offset from the scheduled segments
  // against the wall clock. Held when frozen; self-cancels once the last
  // segment has finished.
  const tick = useCallback(() => {
    if (frozenRef.current) {
      rafRef.current = null
      return
    }
    const segs = segmentsRef.current
    if (segs.length === 0) {
      rafRef.current = null
      return
    }
    const now = performance.now()
    let cursor = segs[0].charStart
    for (const s of segs) {
      if (now >= s.endAt) {
        cursor = s.charEnd // segment fully spoken
      } else if (now >= s.startAt) {
        cursor = s.charStart + ((now - s.startAt) / (s.endAt - s.startAt)) * (s.charEnd - s.charStart)
        break
      } else {
        break // future segment — hold at the previous segment's end
      }
    }
    setSpokenChar(cursor)

    const last = segs[segs.length - 1]
    rafRef.current = now < last.endAt ? requestAnimationFrame(tick) : null
  }, [])

  const ensureLoop = useCallback(() => {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [tick])

  // Reset the schedule (new turn, or a fresh dimmed block after interruption).
  const resetSchedule = useCallback(() => {
    segmentsRef.current = []
    scheduledUntilRef.current = 0
    frozenRef.current = false
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const clearFrozen = useCallback((transcriptId: string) => {
    setFrozenSpoken(prev => {
      if (prev[transcriptId] == null) return prev
      const next = { ...prev }
      delete next[transcriptId]
      return next
    })
  }, [])

  // Bind the highlight to a transcript, resetting the schedule for a fresh turn.
  // The ONLY place a turn boundary resets the cursor, and idempotent per
  // transcript id: a second call for the turn in progress is a no-op. That lets
  // both event feeds call it freely without clobbering an advancing highlight.
  const beginTranscript = useCallback(
    (transcriptId: string) => {
      if (!transcriptId || transcriptIdRef.current === transcriptId) return
      transcriptIdRef.current = transcriptId
      resetSchedule()
      setSpokenTranscriptId(transcriptId)
      setSpokenChar(0)
      setSpokenText(textByTranscriptRef.current.get(transcriptId) ?? '')
    },
    [resetSchedule]
  )

  const noteAgentText = useCallback(
    (transcriptId: string, text: string) => {
      if (!transcriptId) return
      textByTranscriptRef.current.set(transcriptId, text)
      // Once live, bind each new reply on its first chunk so it renders dimmed
      // ahead of the voice and lights up as the audio catches up.
      if (!activeRef.current) return
      beginTranscript(transcriptId)
      setSpokenText(text)
    },
    [beginTranscript]
  )

  const applyProgress = useCallback(
    (data: AgentSpeechProgress) => {
      const transcriptId = data.transcript_id || ''
      const charEnd = data.char_end ?? 0
      const spoken = data.spoken_char ?? 0
      const state = data.state || 'speaking'

      // The teleprompter is live this session — agent bubbles may dim/highlight.
      activeRef.current = true
      // Bind this turn (no-op if already bound). Normally agent_text begins it
      // first; this is the fallback if a progress event is seen before any text.
      beginTranscript(transcriptId)
      const full = textByTranscriptRef.current.get(transcriptId)
      if (full != null) setSpokenText(full)

      if (state === 'speaking') {
        clearFrozen(transcriptId)
        // Resuming after a rejected (unuseful) barge-in: the cursor was frozen
        // at the playhead by the preceding 'interrupted'. Unfreeze so it
        // continues on the SAME message from where it stopped, over the
        // remaining audio. Harmless for a fresh sentence (already unfrozen).
        frozenRef.current = false
        if (prefersReducedMotionRef.current) {
          setSpokenChar(charEnd) // no animation — light the whole sentence at once
          return
        }
        const now = performance.now()
        // Start when this sentence becomes audible: now + the SDK's buffered
        // lead + the client jitter-buffer lag, but never before the previously
        // scheduled audio ends (chain segments so they never overlap).
        const startAt = Math.max(
          now + (data.delay_ms ?? 0) + TELEPROMPTER_CLIENT_LAG_MS,
          scheduledUntilRef.current
        )
        const endAt = startAt + Math.max(1, data.duration_ms ?? 0)
        segmentsRef.current.push({ charStart: spoken, charEnd, startAt, endAt })
        scheduledUntilRef.current = endAt
        ensureLoop()
      } else if (state === 'spoken') {
        // The schedule carries the cursor to the end; just drop any freeze so a
        // normally-completed message renders fully lit.
        clearFrozen(transcriptId)
      } else if (state === 'interrupted') {
        // Freeze exactly where the audio stopped, drop pending segments, and
        // remember the point so the bubble keeps its partial highlight.
        resetSchedule()
        frozenRef.current = true
        setSpokenChar(spoken)
        setFrozenSpoken(prev => ({ ...prev, [transcriptId]: spoken }))
      }
    },
    [beginTranscript, clearFrozen, ensureLoop, resetSchedule]
  )

  // Clear the dim backdrop without disturbing the turn binding or frozen
  // highlight. Called when the heard turn is over and its text must not linger
  // (a finalized user message awaiting the next agent reply). Deliberately a
  // no-op while the agent is actively speaking (live cursor, not frozen) so we
  // never blank a sentence mid-flight; a frozen barge-in IS cleared, and if the
  // agent resumes that same message applyProgress restores spokenText from
  // textByTranscriptRef, so the interrupted → resume path is preserved.
  const clearSpoken = useCallback(() => {
    if (rafRef.current != null && !frozenRef.current) return
    setSpokenText('')
  }, [])

  // Cancel any pending animation frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  return { spokenChar, spokenTranscriptId, frozenSpoken, spokenText, applyProgress, noteAgentText, clearSpoken }
}
