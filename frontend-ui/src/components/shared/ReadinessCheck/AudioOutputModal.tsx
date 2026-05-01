import { useEffect, useRef, useState } from 'react'
import { Volume2, Loader2, CheckCircle2, XCircle, Headphones } from 'lucide-react'
import {
  Room,
  RoomEvent,
  ConnectionState,
  LocalAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Track,
} from 'livekit-client'
import { CheckResult } from './types'
import { ModalShell } from './MicLevelModal'
import { apiClient } from '../../../services/ApiClient'

interface Props {
  micStream: MediaStream | null
  onResolve: (result: CheckResult) => void
}

type Phase = 'idle' | 'connecting' | 'streaming' | 'failed'

export default function AudioOutputModal({ micStream, onResolve }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)

  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const resourcesRef = useRef<{
    pubRoom: Room | null
    subRoom: Room | null
    track: LocalAudioTrack | null
  }>({ pubRoom: null, subRoom: null, track: null })

  const teardown = () => {
    const r = resourcesRef.current
    try {
      r.track?.stop()
    } catch {}
    r.pubRoom?.disconnect().catch(() => {})
    r.subRoom?.disconnect().catch(() => {})
    if (audioElRef.current) {
      audioElRef.current.srcObject = null
    }
    resourcesRef.current = { pubRoom: null, subRoom: null, track: null }
  }

  const finish = (result: CheckResult) => {
    teardown()
    onResolve(result)
  }

  const start = async () => {
    if (!micStream) {
      setPhase('failed')
      setErrorDetail('Microphone unavailable — cannot run the round-trip test.')
      return
    }
    const micTrack = micStream.getAudioTracks()[0]
    if (!micTrack) {
      setPhase('failed')
      setErrorDetail('Microphone unavailable — cannot run the round-trip test.')
      return
    }
    setPhase('connecting')
    try {
      let session
      try {
        session = await apiClient.startMediaTest()
      } catch (err: any) {
        setPhase('failed')
        setErrorDetail(
          err?.statusCode === 429
            ? err.message || 'Please wait a moment before retrying.'
            : 'Could not open a test room on the server.',
        )
        return
      }

      const subRoom = new Room()
      const pubRoom = new Room()
      resourcesRef.current.pubRoom = pubRoom
      resourcesRef.current.subRoom = subRoom

      subRoom.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          _participant: RemoteParticipant,
        ) => {
          if (track.kind !== Track.Kind.Audio) return
          const remoteMs = track.mediaStreamTrack
          if (!remoteMs || !audioElRef.current) return
          // Live playback as audio arrives back from the server.
          audioElRef.current.srcObject = new MediaStream([remoteMs])
          audioElRef.current.play().catch(() => {})
        },
      )

      await subRoom.connect(session.livekitUrl, session.listenerToken)
      if (subRoom.state !== ConnectionState.Connected) {
        throw new Error('Could not connect listener to the realtime gateway')
      }
      await pubRoom.connect(session.livekitUrl, session.token)
      if (pubRoom.state !== ConnectionState.Connected) {
        throw new Error('Could not connect publisher to the realtime gateway')
      }

      const localTrack = new LocalAudioTrack(micTrack.clone())
      resourcesRef.current.track = localTrack
      await pubRoom.localParticipant.publishTrack(localTrack)
      setPhase('streaming')
    } catch (err) {
      setPhase('failed')
      setErrorDetail((err as Error)?.message || 'Audio round-trip failed')
      teardown()
    }
  }

  useEffect(() => {
    start()
    return () => teardown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            Test your speakers
          </h3>
          <p className="text-sm text-content-secondary dark:text-content-inverse-secondary">
            {phase === 'streaming'
              ? 'Speak into your microphone — your voice is going to the server and back. You should hear yourself with a short delay.'
              : phase === 'connecting'
              ? 'Opening a test room on the server…'
              : phase === 'failed'
              ? errorDetail || 'Audio round-trip failed.'
              : 'Starting the round-trip test…'}
          </p>
        </div>
      </div>

      {phase === 'connecting' && (
        <div className="my-6 flex items-center gap-3 text-sm text-content-secondary dark:text-content-inverse-secondary">
          <Loader2 className="w-4 h-4 animate-spin" />
          Connecting publisher and listener…
        </div>
      )}

      {phase === 'streaming' && (
        <div className="my-6 rounded-md border border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 p-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
          <Headphones className="w-4 h-4 mt-0.5 shrink-0" />
          Use headphones to avoid feedback. If you hear an echo loop, take them off and stop the test.
        </div>
      )}

      {phase === 'failed' && (
        <div className="my-6 flex items-center gap-3 text-sm text-rose-600 dark:text-rose-400">
          <XCircle className="w-4 h-4" />
          {errorDetail || 'The audio round-trip failed.'}
        </div>
      )}

      {/* Hidden audio sink — playback happens through the user's selected output device. */}
      <audio ref={audioElRef} autoPlay playsInline className="hidden" />

      <div className="flex justify-between items-center gap-3">
        {phase === 'streaming' ? (
          <>
            <button
              type="button"
              onClick={() =>
                finish({
                  id: 'audioOutput',
                  status: 'fail',
                  detail: 'User did not hear themselves through the speakers',
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
                  detail: 'Round-trip audio audible to user',
                })
              }
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              I hear myself
            </button>
          </>
        ) : phase === 'failed' ? (
          <>
            <span />
            <button
              type="button"
              onClick={() =>
                finish({
                  id: 'audioOutput',
                  status: 'fail',
                  detail: errorDetail || 'Audio round-trip failed',
                })
              }
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <span />
            <span className="inline-flex items-center gap-1.5 text-xs text-content-tertiary dark:text-content-inverse-tertiary">
              <Loader2 className="w-3 h-3 animate-spin" />
              Connecting
            </span>
          </>
        )}
      </div>
    </ModalShell>
  )
}
