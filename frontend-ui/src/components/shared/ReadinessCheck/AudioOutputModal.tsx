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

interface Props {
  session: MediaTestSession | null
  recording: AudioBuffer | null
  onResolve: (result: CheckResult) => void
}

type Phase = 'preparing' | 'ready' | 'playing' | 'awaiting' | 'error'

const PLAYBACK_TAIL_MS = 600

export default function AudioOutputModal({ session, recording, onResolve }: Props) {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [error, setError] = useState<string | null>(null)
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
          setTimeout(() => {
            listenerRoom.off(RoomEvent.TrackSubscribed, onSub)
            rejectTrack(new Error('Did not receive audio from server'))
          }, 8000)
        })

        await Promise.all([
          listenerRoom.connect(session.livekitUrl, session.listenerToken),
          publisherRoom.connect(session.livekitUrl, session.publisherToken),
        ])
        if (cancelled) return
        await publisherRoom.localParticipant.publishTrack(localTrack)

        const remote = await subscribed
        if (cancelled) return
        const audioEl = remote.attach() as HTMLAudioElement
        audioEl.autoplay = true
        ;(audioEl as any).playsInline = true
        audioEl.style.display = 'none'
        document.body.appendChild(audioEl)
        audioElRef.current = audioEl

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
