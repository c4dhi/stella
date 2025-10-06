
import { useStore } from '../store'

export default function ConnectionStats() {
  const status = useStore(s => s.status)
  const rttMs = useStore(s => s.rttMs)
  return (
    <div className="text-xs text-neutral-400/70 font-light tracking-wide flex items-center justify-center gap-2">
      <span className="text-neutral-400/80">{status}</span>
      {rttMs && (
        <>
          <span className="text-neutral-300/40">•</span>
          <span className="text-neutral-400/70">{rttMs}ms</span>
        </>
      )}
    </div>
  )
}
