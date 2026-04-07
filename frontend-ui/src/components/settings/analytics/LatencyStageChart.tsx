import { useState } from 'react'
import { useThemeStore } from '../../../store/themeStore'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import type { StageLatency } from '../../../lib/api-types'

interface LatencyStageChartProps {
  stages: StageLatency[]
}

export default function LatencyStageChart({ stages }: LatencyStageChartProps) {
  const [view, setView] = useState<'table' | 'chart'>('table')
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  if (stages.length === 0) {
    return (
      <div className={`rounded-xl p-8 text-center ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'}`}>
        <p className={isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}>
          No analytics data available
        </p>
      </div>
    )
  }

  const fmt = (v: number) => `${v.toFixed(1)}ms`

  return (
    <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'}`}>
      {/* Header with toggle */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-border-dark' : 'border-neutral-200'}`}>
        <h3 className={`text-sm font-semibold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
          Stage Latency
        </h3>
        <div className={`flex rounded-lg overflow-hidden text-xs ${isDark ? 'bg-surface-dark-tertiary' : 'bg-neutral-100'}`}>
          {(['table', 'chart'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                view === v
                  ? isDark
                    ? 'bg-purple-600 text-white'
                    : 'bg-neutral-900 text-white'
                  : isDark
                    ? 'text-content-inverse-secondary hover:text-content-inverse'
                    : 'text-content-secondary hover:text-content'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        {view === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}>
                  <th className="text-left pb-3 font-medium">Stage</th>
                  <th className="text-right pb-3 font-medium">Count</th>
                  <th className="text-right pb-3 font-medium">Mean</th>
                  <th className="text-right pb-3 font-medium">P50</th>
                  <th className="text-right pb-3 font-medium">P95</th>
                  <th className="text-right pb-3 font-medium">Min</th>
                  <th className="text-right pb-3 font-medium">Max</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr
                    key={s.stage}
                    className={`border-t ${isDark ? 'border-border-dark text-content-inverse' : 'border-neutral-100 text-content'}`}
                  >
                    <td className="py-2.5 font-mono text-xs">{s.stage}</td>
                    <td className="py-2.5 text-right tabular-nums">{s.count}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt(s.mean_ms)}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt(s.p50_ms)}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt(s.p95_ms)}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt(s.min_ms)}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt(s.max_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stages} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#E5E7EB'} vertical={false} />
                <XAxis
                  dataKey="stage"
                  tick={{ fontSize: 10, fill: isDark ? '#9CA3AF' : '#6B7280' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: isDark ? '#9CA3AF' : '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickFormatter={(v) => `${v}ms`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
                    borderRadius: '8px',
                    border: isDark ? '1px solid #374151' : '1px solid #E5E7EB',
                    color: isDark ? '#F9FAFB' : '#111827',
                  }}
                  formatter={(value) => value != null ? [`${Number(value).toFixed(1)}ms`] : ['-']}
                />
                <Bar dataKey="p50_ms" name="P50" fill="#22C55E" radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="mean_ms" name="Mean" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="p95_ms" name="P95" fill="#F59E0B" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
