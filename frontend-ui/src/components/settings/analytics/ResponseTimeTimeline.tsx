import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts'
import type { MetricsTimelinePoint } from '../../../lib/api-types'

interface ResponseTimeTimelineProps {
  points: MetricsTimelinePoint[]
}

function ResponseTimeGauge({ value, label, sublabel, color }: { value: number; label: string; sublabel?: string; color: string }) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className="flex flex-col items-center justify-center">
      <motion.div
        key={value}
        initial={{ scale: 1.05, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`text-3xl font-bold tabular-nums ${isDark ? 'text-content-inverse' : 'text-content'}`}
        style={{ color }}
      >
        {value > 0 ? `${value}` : '—'}
      </motion.div>
      <span className={`text-xs mt-1 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
        {label}
      </span>
      {sublabel && (
        <span className={`text-[10px] mt-0.5 ${isDark ? 'text-content-inverse-secondary/60' : 'text-content-secondary/60'}`}>
          {sublabel}
        </span>
      )}
    </div>
  )
}

export default function ResponseTimeTimeline({ points }: ResponseTimeTimelineProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const chartData = useMemo(() =>
    points.map((p) => ({
      time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      timing_ms: Math.round(p.timing_ms),
      timestamp: p.timestamp,
    })),
    [points],
  )

  const avgMs = useMemo(() => {
    if (points.length === 0) return 0
    return Math.round(points.reduce((sum, p) => sum + p.timing_ms, 0) / points.length)
  }, [points])

  const minMs = useMemo(() => {
    if (points.length === 0) return 0
    return Math.round(Math.min(...points.map((p) => p.timing_ms)))
  }, [points])

  const maxMs = useMemo(() => {
    if (points.length === 0) return 0
    return Math.round(Math.max(...points.map((p) => p.timing_ms)))
  }, [points])

  const avgColor = avgMs === 0 ? '#6B7280' : avgMs < 1500 ? '#22C55E' : avgMs < 3000 ? '#F59E0B' : '#EF4444'

  return (
    <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'}`}>
      <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-border-dark' : 'border-neutral-200'}`}>
        <div className="flex items-center gap-2">
          <h3 className={`text-sm font-semibold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
            Response Time (Live)
          </h3>
          {points.length > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-surface-dark-tertiary text-content-inverse-secondary' : 'bg-neutral-100 text-content-secondary'}`}>
              {points.length} turn{points.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="p-5">
        {points.length === 0 ? (
          <div className={`h-[160px] flex items-center justify-center text-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Waiting for data points...
          </div>
        ) : (
          <div className="flex gap-8">
            {/* Gauge Section */}
            <div className={`flex flex-col gap-4 shrink-0 pr-8 border-r justify-center ${isDark ? 'border-border-dark' : 'border-border'}`}>
              <ResponseTimeGauge
                value={avgMs}
                label="Avg (ms)"
                sublabel={`${points.length} turns`}
                color={avgColor}
              />
              <div className="flex gap-4">
                <ResponseTimeGauge value={minMs} label="Min" color="#22C55E" />
                <ResponseTimeGauge value={maxMs} label="Max" color="#EF4444" />
              </div>
            </div>

            {/* Chart Section */}
            <div className="flex-1 min-w-0">
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#E5E7EB'} vertical={false} />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: isDark ? '#9CA3AF' : '#6B7280' }}
                      tickLine={false}
                      interval="preserveStartEnd"
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
                      formatter={(value) => value != null ? [`${Number(value)}ms`, 'TTFAB'] : ['-', 'TTFAB']}
                      labelFormatter={(label) => `Time: ${label}`}
                    />
                    {avgMs > 0 && (
                      <ReferenceLine
                        y={avgMs}
                        stroke={isDark ? '#6B7280' : '#9CA3AF'}
                        strokeDasharray="6 4"
                        label=""
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="timing_ms"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#F59E0B' }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
