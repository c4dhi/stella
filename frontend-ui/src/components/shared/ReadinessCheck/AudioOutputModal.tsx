import { useRef, useState } from 'react'
import { Volume2, Play } from 'lucide-react'
import { CheckResult } from './types'
import { ModalShell } from './MicLevelModal'

interface Props {
  onResolve: (result: CheckResult) => void
}

export default function AudioOutputModal({ onResolve }: Props) {
  const [played, setPlayed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)

  const playTone = async () => {
    if (playing) return
    setPlaying(true)
    setPlayed(true)
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      ctxRef.current = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 440
      osc.type = 'sine'
      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05)
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.9)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.0)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 1.05)
      setTimeout(() => {
        setPlaying(false)
        ctx.close().catch(() => {})
      }, 1100)
    } catch {
      setPlaying(false)
    }
  }

  const finish = (result: CheckResult) => {
    ctxRef.current?.close().catch(() => {})
    onResolve(result)
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
            Test your speakers
          </h3>
          <p className="text-sm text-content-secondary dark:text-content-inverse-secondary">
            Press play and listen for a short tone.
          </p>
        </div>
      </div>

      <div className="my-6 flex justify-center">
        <button
          type="button"
          onClick={playTone}
          disabled={playing}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-sky-600 hover:bg-sky-700 text-white font-medium text-sm disabled:opacity-60 transition-colors"
        >
          <Play className="w-4 h-4" fill="currentColor" />
          {playing ? 'Playing tone…' : played ? 'Play again' : 'Play tone'}
        </button>
      </div>

      {played && !playing && (
        <div className="space-y-3">
          <p className="text-center text-sm text-content-primary dark:text-content-inverse-primary">
            Did you hear it?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                finish({
                  id: 'audioOutput',
                  status: 'fail',
                  detail: 'Tone was not audible. Check volume and output device.',
                })
              }
              className="px-4 py-2 rounded-md border border-border dark:border-border-dark text-sm font-medium hover:bg-neutral-50 dark:hover:bg-surface-dark-tertiary"
            >
              No
            </button>
            <button
              type="button"
              onClick={() =>
                finish({ id: 'audioOutput', status: 'pass', detail: 'Tone heard' })
              }
              className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              Yes, I heard it
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
