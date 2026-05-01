import { useEffect, useRef, useState } from 'react'
import { Mic, X, CheckCircle2 } from 'lucide-react'
import { CheckResult } from './types'

interface Props {
  stream: MediaStream
  onResolve: (result: CheckResult) => void
}

const PASS_THRESHOLD = 12
const MIN_TALK_MS = 4000
const AUTO_FAIL_MS = 25_000

export default function MicLevelModal({ stream, onResolve }: Props) {
  const [level, setLevel] = useState(0)
  const [peak, setPeak] = useState(0)
  const [thresholdReached, setThresholdReached] = useState(false)
  const [minElapsed, setMinElapsed] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const resolvedRef = useRef(false)

  const finish = (result: CheckResult) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    ctxRef.current?.close().catch(() => {})
    onResolve(result)
  }

  useEffect(() => {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    ctxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const startedAt = Date.now()
    const minTimer = setTimeout(() => setMinElapsed(true), MIN_TALK_MS)

    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let max = 0
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i] - 128)
        if (v > max) max = v
      }
      setLevel(max)
      setPeak((p) => Math.max(p, max))
      if (max >= PASS_THRESHOLD) setThresholdReached(true)

      if (Date.now() - startedAt > AUTO_FAIL_MS) {
        finish({
          id: 'micLevel',
          status: 'fail',
          detail: 'No audio detected. Check that the right microphone is selected and try again.',
        })
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      clearTimeout(minTimer)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ctx.close().catch(() => {})
    }
  }, [stream])

  const levelPct = Math.min(100, Math.round((level / 64) * 100))
  const peakPct = Math.min(100, Math.round((peak / 64) * 100))
  const thresholdPct = Math.round((PASS_THRESHOLD / 64) * 100)
  const canContinue = thresholdReached && minElapsed

  return (
    <ModalShell
      onClose={() =>
        finish({ id: 'micLevel', status: 'skipped', detail: 'Microphone test skipped' })
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center">
          <Mic className="w-5 h-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-content-primary dark:text-content-inverse-primary">
            Test your microphone
          </h3>
          <p className="text-sm text-content-secondary dark:text-content-inverse-secondary">
            Speak into your microphone for a few seconds and watch the bar move.
          </p>
        </div>
      </div>

      <div className="my-6">
        <div className="relative h-4 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${
              level >= PASS_THRESHOLD
                ? 'bg-sky-500'
                : 'bg-neutral-400 dark:bg-neutral-600'
            }`}
            style={{ width: `${levelPct}%` }}
          />
          <div
            className="absolute inset-y-0 w-px bg-neutral-500 dark:bg-neutral-400 opacity-70"
            style={{ left: `${thresholdPct}%` }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-content-primary/50 dark:bg-white/40"
            style={{ left: `${peakPct}%`, transition: 'left 200ms ease-out' }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[10px] uppercase tracking-wider text-content-tertiary dark:text-content-inverse-tertiary">
          <span>Quiet</span>
          <span>Loud</span>
        </div>
      </div>

      <div className="flex justify-between items-center gap-3">
        <button
          type="button"
          onClick={() =>
            finish({
              id: 'micLevel',
              status: 'fail',
              detail: 'User reported microphone is not working',
            })
          }
          className="text-xs text-content-secondary dark:text-content-inverse-secondary hover:underline"
        >
          I can't get this to work
        </button>
        <button
          type="button"
          disabled={!canContinue}
          onClick={() =>
            finish({
              id: 'micLevel',
              status: 'pass',
              metric: peak,
              detail: 'Audio detected',
            })
          }
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            canContinue
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500 cursor-not-allowed'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {canContinue
            ? 'Continue'
            : !minElapsed
            ? 'Keep talking…'
            : 'Waiting for audio…'}
        </button>
      </div>
    </ModalShell>
  )
}

interface ShellProps {
  onClose: () => void
  children: React.ReactNode
}

export function ModalShell({ onClose, children }: ShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-md rounded-xl border border-border dark:border-border-dark bg-white dark:bg-surface-dark-secondary p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-md text-content-tertiary dark:text-content-inverse-tertiary hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        {children}
      </div>
    </div>
  )
}
