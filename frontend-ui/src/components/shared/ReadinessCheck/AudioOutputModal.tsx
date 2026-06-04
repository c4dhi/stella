import { useEffect, useRef, useState } from 'react'
import { Volume2, Play, Loader2 } from 'lucide-react'
import {
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
} from 'livekit-client'
import { CheckResult } from './types'
import { ModalShell } from './MicLevelModal'
import type { MediaTestSession } from '../../../lib/api-types'
import { getAudioOutputDevices, pickDefaultSink } from '../../../lib/mediaDevices'

interface Props {
  session: MediaTestSession | null
  recording: AudioBuffer | null
  onResolve: (result: CheckResult) => void
}

type Phase = 'preparing' | 'ready' | 'playing' | 'awaiting' | 'error'

const PLAYBACK_TAIL_MS = 600

type AudioSinkElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

export default function AudioOutputModal({ session, recording, onResolve }: Props) {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [error, setError] = useState<string | null>(null)
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedSinkId, setSelectedSinkId] = useState<string>('')
  const [sinkSupported, setSinkSupported] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const publisherRoomRef = useRef<Room | null>(null)
  const listenerRoomRef = useRef<Room | null>(null)
  const localTrackRef = useRef<LocalAudioTrack | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const resolvedRef = useRef(false)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)

  const teardown = () => {
    try {
      sourceRef.current?.stop()
    } catch {}
    try {
      localTrackRef.current?.stop()
    } catch {}
    publisherRoomRef.current?.disconnect().catch(() => {})
    listenerRoomRef.current?.disconnect().catch(() => {})
    audioCtxRef.current?.close().catch(() => {})
  }

  const finish = (result: CheckResult) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    teardown()
    onResolve(result)
  }

  useEffect(() => {
    if (!session || !recording) {
      finish({
        id: 'audioOutput',
        status: 'skipped',
        detail: !recording
          ? 'Microphone recording unavailable — cannot test roundtrip.'
          : 'Audio test session unavailable.',
      })
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext
        const ctx = new Ctx()
        audioCtxRef.current = ctx
        if (ctx.state === 'suspended') {
          try {
            await ctx.resume()
          } catch {}
        }
        const destination = ctx.createMediaStreamDestination()
        destinationRef.current = destination

        const trackForLk = destination.stream.getAudioTracks()[0]
        if (!trackForLk) throw new Error('Could not create audio track')
        const localTrack = new LocalAudioTrack(trackForLk, undefined, false)
        localTrackRef.current = localTrack

        const publisherRoom = new Room()
        const listenerRoom = new Room()
        publisherRoomRef.current = publisherRoom
        listenerRoomRef.current = listenerRoom

        // Resolves when the listener participant receives the looped-back track.
        // The timeout is armed *after* publish below, so it specifically measures
        // "we published, but nothing came back" rather than connect/publish latency
        // (those failures throw from the awaits and are reported separately).
        let armTimeout: () => void = () => {}
        const subscribed = new Promise<RemoteAudioTrack>((resolveTrack, rejectTrack) => {
          const onSub = (
            track: RemoteTrack,
            _pub: RemoteTrackPublication,
          ) => {
            if (track.kind === 'audio') {
              listenerRoom.off(RoomEvent.TrackSubscribed, onSub)
              resolveTrack(track as RemoteAudioTrack)
            }
          }
          listenerRoom.on(RoomEvent.TrackSubscribed, onSub)
          armTimeout = () =>
            setTimeout(() => {
              listenerRoom.off(RoomEvent.TrackSubscribed, onSub)
              rejectTrack(
                new Error(
                  'Connected and published your audio, but no audio came back from the server within 8 seconds.',
                ),
              )
            }, 8000)
        })

        try {
          await Promise.all([
            listenerRoom.connect(session.livekitUrl, session.listenerToken),
            publisherRoom.connect(session.livekitUrl, session.publisherToken),
          ])
          if (cancelled) return
          await publisherRoom.localParticipant.publishTrack(localTrack)
        } catch (connErr) {
          throw new Error(
            (connErr as Error).message ||
              'Could not connect to the realtime server to publish your audio.',
          )
        }

        armTimeout()
        const remote = await subscribed
        if (cancelled) return
        const audioEl = remote.attach() as AudioSinkElement
        audioEl.autoplay = true
        ;(audioEl as any).playsInline = true
        audioEl.style.display = 'none'
        document.body.appendChild(audioEl)
        audioElRef.current = audioEl

        // Output-device (speaker) selection. setSinkId is Chromium-only; on Safari
        // and older Firefox it's absent, so we play through the system default and
        // hide the picker.
        const supported = typeof audioEl.setSinkId === 'function'
        setSinkSupported(supported)
        if (supported) {
          try {
            const devices = await getAudioOutputDevices()
            if (!cancelled && devices.length) {
              const initial = pickDefaultSink(devices)
              setOutputDevices(devices)
              setSelectedSinkId(initial)
              if (initial) {
                await audioEl.setSinkId!(initial).catch(() => {})
              }
            }
          } catch {
            // Enumeration failed — fall back to system default silently.
          }
        }

        if (cancelled) return
        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message || 'Could not set up the audio test.')
        setPhase('error')
      }
    })()

    return () => {
      cancelled = true
      if (audioElRef.current) {
        audioElRef.current.pause()
        audioElRef.current.remove()
        audioElRef.current = null
      }
      // If the modal unmounts (e.g. user navigates away) before finish() ran, the
      // two LiveKit rooms + WebRTC peers + AudioContext would otherwise leak.
      // teardown() is idempotent, so calling it here as well as in finish() is safe.
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const playback = async () => {
    const ctx = audioCtxRef.current
    const dest = destinationRef.current
    if (!ctx || !dest || !recording) return
    if (phase === 'playing') return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {}
    }
    setPhase('playing')
    if (audioElRef.current && audioElRef.current.paused) {
      try {
        await audioElRef.current.play()
      } catch {}
    }
    const src = ctx.createBufferSource()
    src.buffer = recording
    src.connect(dest)
    sourceRef.current = src
    src.onended = () => {
      setTimeout(() => setPhase('awaiting'), PLAYBACK_TAIL_MS)
    }
    src.start()
  }

  const changeSink = async (sinkId: string) => {
    setSelectedSinkId(sinkId)
    const el = audioElRef.current as AudioSinkElement | null
    if (el?.setSinkId) {
      try {
        await el.setSinkId(sinkId)
      } catch {
        // Browser refused the device (e.g. unplugged) — keep the previous sink.
      }
    }
  }

  return (
    <ModalShell
      onClose={() =>
        finish({ id: 'audioOutput', status: 'skipped', detail: 'Speaker test skipped' })
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center">
          <Volume2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-content-primary dark:text-content-inverse-primary">
            Hear yourself back
          </h3>
          <p className="text-sm text-content-secondary dark:text-content-inverse-secondary">
            We'll send your recorded voice through the realtime server and play it back to your speakers — a full roundtrip test.
          </p>
        </div>
      </div>

      {(phase === 'ready' || phase === 'playing' || phase === 'awaiting') && (
        sinkSupported && outputDevices.length > 1 ? (
          <label className="block my-4">
            <span className="text-xs font-medium uppercase tracking-wider text-content-tertiary dark:text-content-inverse-tertiary">
              Output device
            </span>
            <select
              value={selectedSinkId}
              onChange={(e) => changeSink(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-border dark:border-border-dark bg-white dark:bg-surface-dark-tertiary px-3 py-2 text-sm text-content-primary dark:text-content-inverse-primary"
            >
              {outputDevices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Speaker ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : !sinkSupported ? (
          <p className="my-4 text-xs text-content-tertiary dark:text-content-inverse-tertiary text-center">
            Playing through your system default output device.
          </p>
        ) : null
      )}

      {phase === 'error' && (
        <div className="my-6 text-sm text-rose-600 dark:text-rose-400 text-center">
          {error}
        </div>
      )}

      {phase === 'preparing' && (
        <div className="my-6 flex items-center justify-center gap-2 text-sm text-content-secondary dark:text-content-inverse-secondary">
          <Loader2 className="w-4 h-4 animate-spin" />
          Connecting to the realtime server…
        </div>
      )}

      {(phase === 'ready' || phase === 'playing') && (
        <div className="my-6 flex justify-center">
          <button
            type="button"
            onClick={playback}
            disabled={phase === 'playing'}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-sky-600 hover:bg-sky-700 text-white font-medium text-sm disabled:opacity-60 transition-colors"
          >
            {phase === 'playing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Playing…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" fill="currentColor" />
                Play my voice back
              </>
            )}
          </button>
        </div>
      )}

      {phase === 'awaiting' && (
        <div className="space-y-3 my-4">
          <p className="text-center text-sm text-content-primary dark:text-content-inverse-primary">
            Did you hear yourself through the speakers?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                finish({
                  id: 'audioOutput',
                  status: 'fail',
                  detail: 'Audio roundtrip not heard. Check speaker volume and output device.',
                })
              }
              className="text-xs text-content-secondary dark:text-content-inverse-secondary hover:underline"
            >
              I don't hear anything
            </button>
            <button
              type="button"
              onClick={() =>
                finish({
                  id: 'audioOutput',
                  status: 'pass',
                  detail: 'Audio roundtrip confirmed',
                })
              }
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
            >
              Yes, I heard myself
            </button>
          </div>
          <button
            type="button"
            onClick={playback}
            className="block mx-auto text-xs text-content-secondary dark:text-content-inverse-secondary hover:underline"
          >
            Play again
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              finish({
                id: 'audioOutput',
                status: 'fail',
                detail: error || 'Roundtrip setup failed',
              })
            }
            className="px-4 py-2 rounded-md border border-border dark:border-border-dark text-sm font-medium hover:bg-neutral-50 dark:hover:bg-surface-dark-tertiary"
          >
            Continue
          </button>
        </div>
      )}
    </ModalShell>
  )
}
