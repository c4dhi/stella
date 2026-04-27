import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { apiClient } from '../services/ApiClient'
import type {
  PublicHealthComponent,
  PublicHealthComponentStatus,
  PublicHealthResponse,
} from '../lib/api-types'
import { ReadinessCheck } from '../components/shared/ReadinessCheck'

const COMPONENT_LABELS: Record<PublicHealthComponent['id'], string> = {
  api: 'API',
  database: 'Database',
  realtime: 'Realtime gateway',
  stt: 'Speech-to-text',
  tts: 'Text-to-speech',
}

const STATUS_DOT: Record<PublicHealthComponentStatus, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-rose-500',
}

const STATUS_PILL: Record<PublicHealthComponentStatus, string> = {
  operational:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  degraded: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  down: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
}

const STATUS_LABEL: Record<PublicHealthComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
}

const HEADLINE: Record<PublicHealthComponentStatus, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems degraded',
  down: 'Major outage',
}

function StatusIcon({ status }: { status: PublicHealthComponentStatus }) {
  if (status === 'operational')
    return <CheckCircle2 className="w-7 h-7 text-emerald-500" strokeWidth={2} />
  if (status === 'degraded')
    return <AlertTriangle className="w-7 h-7 text-amber-500" strokeWidth={2} />
  return <XCircle className="w-7 h-7 text-rose-500" strokeWidth={2} />
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const s = Math.max(0, Math.floor(diffMs / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

export default function StatusPage() {
  const [data, setData] = useState<PublicHealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let cancelled = false
    const fetchOnce = async () => {
      try {
        const r = await apiClient.getPublicHealth()
        if (!cancelled) {
          setData(r)
          setError(null)
        }
      } catch {
        if (!cancelled) setError('Could not reach the server')
      }
    }
    fetchOnce()
    const poll = setInterval(fetchOnce, 30_000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      cancelled = true
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [])

  const overall = data?.status
  const updatedLabel = useMemo(() => (data ? relativeTime(data.generatedAt) : ''), [data, now])

  return (
    <div className="min-h-screen bg-surface dark:bg-surface-dark text-content-primary dark:text-content-inverse-primary">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <header className="mb-10">
          <Link
            to="/login"
            className="text-xs text-content-secondary dark:text-content-inverse-secondary hover:underline"
          >
            ← Back to sign in
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">System status</h1>
          <p className="mt-1 text-sm text-content-secondary dark:text-content-inverse-secondary">
            Verify that the platform is operational and that your device can connect.
          </p>
        </header>

        {/* Headline banner */}
        {data && overall && (
          <div
            className={`mb-8 rounded-xl border p-5 flex items-center gap-4 ${
              overall === 'operational'
                ? 'border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5'
                : overall === 'degraded'
                ? 'border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5'
                : 'border-rose-500/30 bg-rose-50/60 dark:bg-rose-500/5'
            }`}
          >
            <StatusIcon status={overall} />
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold">{HEADLINE[overall]}</div>
              <div className="text-xs text-content-secondary dark:text-content-inverse-secondary mt-0.5">
                Updated {updatedLabel}
              </div>
            </div>
          </div>
        )}

        {error && !data && (
          <div className="mb-8 rounded-xl border border-rose-500/30 bg-rose-50/60 dark:bg-rose-500/5 p-5 text-sm">
            {error}
          </div>
        )}

        {/* Components list */}
        {data && (
          <section className="mb-12">
            <div className="flex items-baseline justify-between mb-3 px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary dark:text-content-inverse-tertiary">
                Platform components
              </h2>
            </div>
            <div className="rounded-xl border border-border dark:border-border-dark bg-white dark:bg-surface-dark-secondary divide-y divide-border dark:divide-border-dark overflow-hidden">
              {data.components.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[c.status]}`} />
                    <span className="text-sm font-medium truncate">
                      {COMPONENT_LABELS[c.id]}
                    </span>
                  </div>
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_PILL[c.status]}`}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Readiness section */}
        <section>
          <div className="flex items-baseline justify-between mb-3 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary dark:text-content-inverse-tertiary">
              Your device
            </h2>
          </div>
          <div className="rounded-xl border border-border dark:border-border-dark bg-white dark:bg-surface-dark-secondary p-5">
            <ReadinessCheck mode="public" />
          </div>
        </section>
      </div>
    </div>
  )
}
