import { useEffect, useRef, useState } from 'react'
import { Play, RefreshCw } from 'lucide-react'
import {
  CheckId,
  CheckResult,
  CheckStatus,
  DEFAULT_ENABLED_CHECKS,
  DEFAULT_REQUIRED_CHECKS,
  ReadinessCheckProps,
} from './types'
import {
  runBrowserCheck,
  runMicPermissionCheck,
  runNetworkCheck,
  runWebRtcCheck,
  runWebSocketCheck,
  runLivekitPublishCheck,
} from './checks'
import { stopStream } from '../../../lib/mediaDevices'
import MicLevelModal from './MicLevelModal'
import AudioOutputModal from './AudioOutputModal'

const CHECK_LABELS: Record<CheckId, string> = {
  browser: 'Browser compatibility',
  network: 'Network reachability',
  webrtc: 'WebRTC connectivity',
  websocket: 'Realtime gateway',
  micPermission: 'Microphone permission',
  micLevel: 'Microphone audio',
  livekitPublish: 'Audio publish to server',
  audioOutput: 'Speakers',
}

const STATUS_DOT: Record<CheckStatus, string> = {
  pending: 'bg-neutral-300 dark:bg-neutral-600',
  running: 'bg-sky-500 animate-pulse',
  pass: 'bg-emerald-500',
  warn: 'bg-amber-500',
  fail: 'bg-rose-500',
  skipped: 'bg-neutral-300 dark:bg-neutral-600',
}

const STATUS_PILL: Record<CheckStatus, string> = {
  pending: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
  running: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
  pass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  warn: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  fail: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  skipped: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pending: 'Pending',
  running: 'Checking',
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
  skipped: 'Skipped',
}

function isReady(checks: CheckResult[], required: CheckId[]): boolean {
  if (required.length === 0) return checks.every((c) => c.status !== 'fail' && c.status !== 'pending' && c.status !== 'running')
  return required.every((id) => checks.find((c) => c.id === id)?.status === 'pass')
}

export default function ReadinessCheck({
  mode = 'public',
  enabledChecks,
  requiredChecks,
  autoStart = false,
  onChange,
  onComplete,
}: ReadinessCheckProps) {
  const enabled = enabledChecks ?? DEFAULT_ENABLED_CHECKS[mode]
  const required = requiredChecks ?? DEFAULT_REQUIRED_CHECKS[mode]
  const initial: CheckResult[] = enabled.map((id) => ({ id, status: 'pending' }))

  const [results, setResults] = useState<CheckResult[]>(initial)
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [showMicModal, setShowMicModal] = useState(false)
  const [showAudioOutModal, setShowAudioOutModal] = useState(false)
  const interactiveResolverRef = useRef<((r: CheckResult) => void) | null>(null)

  const onChangeRef = useRef(onChange)
  const onCompleteRef = useRef(onComplete)
  onChangeRef.current = onChange
  onCompleteRef.current = onComplete

  const update = (id: CheckId, patch: Partial<CheckResult>) => {
    setResults((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch, id } : c))
      onChangeRef.current?.({ ready: isReady(next, required), checks: next })
      return next
    })
  }

  const waitForInteractive = (): Promise<CheckResult> =>
    new Promise((resolve) => {
      interactiveResolverRef.current = resolve
    })

  const runStep = async (id: CheckId, currentMicStream: MediaStream | null): Promise<{
    result: CheckResult
    stream: MediaStream | null
  }> => {
    if (id === 'browser') return { result: await runBrowserCheck(), stream: currentMicStream }
    if (id === 'network') return { result: await runNetworkCheck(), stream: currentMicStream }
    if (id === 'webrtc') return { result: await runWebRtcCheck(), stream: currentMicStream }
    if (id === 'websocket') return { result: await runWebSocketCheck(), stream: currentMicStream }
    if (id === 'livekitPublish') return { result: await runLivekitPublishCheck(), stream: currentMicStream }
    if (id === 'micPermission') {
      const { result, stream } = await runMicPermissionCheck()
      setMicStream(stream)
      return { result, stream }
    }
    if (id === 'micLevel') {
      if (!currentMicStream) {
        return {
          result: {
            id: 'micLevel',
            status: 'skipped',
            detail: 'Microphone unavailable',
          },
          stream: currentMicStream,
        }
      }
      setShowMicModal(true)
      const result = await waitForInteractive()
      setShowMicModal(false)
      return { result, stream: currentMicStream }
    }
    if (id === 'audioOutput') {
      setShowAudioOutModal(true)
      const result = await waitForInteractive()
      setShowAudioOutModal(false)
      return { result, stream: currentMicStream }
    }
    return {
      result: { id, status: 'skipped' },
      stream: currentMicStream,
    }
  }

  const start = async () => {
    if (running) return
    setRunning(true)
    setCompleted(false)
    setResults(enabled.map((id) => ({ id, status: 'pending' })))
    let stream: MediaStream | null = null
    try {
      for (let i = 0; i < enabled.length; i++) {
        const id = enabled[i]
        setActiveIndex(i)
        update(id, { status: 'running' })
        try {
          const { result, stream: newStream } = await runStep(id, stream)
          stream = newStream
          update(id, result)
        } catch (err) {
          update(id, { status: 'fail', detail: (err as Error).message })
        }
      }
    } finally {
      stopStream(stream)
      setMicStream(null)
      setActiveIndex(-1)
      setRunning(false)
      setCompleted(true)
    }
  }

  useEffect(() => {
    if (!running && completed) {
      onCompleteRef.current?.({ ready: isReady(results, required), checks: results })
    }
  }, [running, completed])

  useEffect(() => {
    if (autoStart) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const passCount = results.filter((c) => c.status === 'pass').length
  const totalCount = results.length
  const overallReady = completed && isReady(results, required)

  return (
    <div>
      {/* Header with progress + start button */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-content-secondary dark:text-content-inverse-secondary">
            {!running && !completed && 'Walks you through a few quick tests of your browser, microphone, and network.'}
            {running && `Step ${activeIndex + 1} of ${totalCount} — ${CHECK_LABELS[enabled[activeIndex] ?? 'browser']}`}
            {completed && (overallReady
              ? `${passCount} of ${totalCount} checks passed. You're good to go.`
              : `${passCount} of ${totalCount} checks passed.`)}
          </p>
        </div>
        {!running && (
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap ml-4"
          >
            {completed ? (
              <>
                <RefreshCw className="w-4 h-4" />
                Run again
              </>
            ) : (
              <>
                <Play className="w-4 h-4" fill="currentColor" />
                Start tests
              </>
            )}
          </button>
        )}
      </div>

      {/* Progress bar */}
      {(running || completed) && (
        <div className="mb-4 h-1 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
          <div
            className={`h-full transition-[width] duration-300 ${
              completed && !overallReady ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{
              width: `${
                completed
                  ? 100
                  : totalCount === 0
                  ? 0
                  : (Math.max(0, activeIndex) / totalCount) * 100
              }%`,
            }}
          />
        </div>
      )}

      {/* Step list */}
      <ul className="-mx-5 divide-y divide-border dark:divide-border-dark">
        {results.map((c, i) => {
          const isActive = i === activeIndex && running
          return (
            <li
              key={c.id}
              className={`flex items-center justify-between px-5 py-3.5 gap-3 transition-colors ${
                isActive ? 'bg-sky-50/40 dark:bg-sky-500/5' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[c.status]}`}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-content-primary dark:text-content-inverse-primary truncate">
                    {CHECK_LABELS[c.id]}
                  </div>
                  {c.detail && (
                    <div className="text-xs text-content-secondary dark:text-content-inverse-secondary mt-0.5 truncate">
                      {c.detail}
                    </div>
                  )}
                </div>
              </div>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_PILL[c.status]}`}
              >
                {STATUS_LABEL[c.status]}
              </span>
            </li>
          )
        })}
      </ul>

      {/* Modals */}
      {showMicModal && micStream && (
        <MicLevelModal
          stream={micStream}
          onResolve={(r) => interactiveResolverRef.current?.(r)}
        />
      )}
      {showAudioOutModal && (
        <AudioOutputModal
          micStream={micStream}
          onResolve={(r) => interactiveResolverRef.current?.(r)}
        />
      )}
    </div>
  )
}
