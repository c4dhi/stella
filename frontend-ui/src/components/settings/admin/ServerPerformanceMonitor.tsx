import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { useThemeStore } from '../../../store/themeStore'
import { parseMemoryValue, formatBytes } from '../../../hooks/useServerMetrics'
import type { ServerMetrics } from '../../../lib/api-types'

interface ServerPerformanceMonitorProps {
  currentMetrics: ServerMetrics | null
  metricsHistory: ServerMetrics[]
  isConnected: boolean
}

interface GaugeProps {
  value: number
  label: string
  sublabel?: string
  color: string
}

function Gauge({ value, label, sublabel, color }: GaugeProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const radius = 40
  const circumference = 2 * Math.PI * radius
  const progress = (value / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={isDark ? '#374151' : '#E5E7EB'}
            strokeWidth="8"
          />
          <motion.circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${progress} ${circumference}` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className={`text-xl font-bold ${isDark ? 'text-content-inverse' : 'text-content'}`}
            key={value}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            {Math.round(value)}%
          </motion.span>
        </div>
      </div>
      <div className={`text-body-sm font-medium mt-2 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
        {label}
      </div>
      {sublabel && (
        <div className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
          {sublabel}
        </div>
      )}
    </div>
  )
}

export default function ServerPerformanceMonitor({
  currentMetrics,
  metricsHistory,
  isConnected,
}: ServerPerformanceMonitorProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const cpuUsage = currentMetrics?.cpuUsage ?? 0
  const memoryUsed = parseMemoryValue(currentMetrics?.memoryUsed ?? '0')
  const memoryTotal = parseMemoryValue(currentMetrics?.memoryTotal ?? '0')
  const memoryPercentage = memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0

  const chartData = useMemo(() => {
    return metricsHistory.map((m, i) => ({
      index: i,
      cpu: m.cpuUsage,
      memory: parseMemoryValue(m.memoryUsed) / parseMemoryValue(m.memoryTotal) * 100,
    }))
  }, [metricsHistory])

  const cpuColor = cpuUsage >= 90 ? '#EF4444' : cpuUsage >= 70 ? '#EAB308' : '#22C55E'
  const memoryColor = memoryPercentage >= 90 ? '#EF4444' : memoryPercentage >= 70 ? '#EAB308' : '#22C55E'

  if (!currentMetrics) {
    return (
      <div
        className={`p-6 rounded-2xl ${
          isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
        }`}
      >
        <div className="animate-pulse">
          <div className={`h-6 w-48 rounded mb-4 ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`} />
          <div className={`h-[140px] w-full rounded ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`} />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`p-6 rounded-2xl ${
        isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
      }`}
    >
      <div className="flex items-center justify-between mb-6">
        <h3
          className={`text-heading-sm font-semibold ${
            isDark ? 'text-content-inverse' : 'text-content'
          }`}
        >
          Server Performance
        </h3>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span
            className={`text-caption ${
              isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
            }`}
          >
            {isConnected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Full-width layout: Gauges on left, Chart on right */}
      <div className="flex gap-8">
        {/* Gauges Section */}
        <div className={`flex gap-6 shrink-0 pr-8 border-r ${isDark ? 'border-border-dark' : 'border-border'}`}>
          <Gauge
            value={cpuUsage}
            label="CPU"
            sublabel={`${currentMetrics.cpuCores} cores`}
            color={cpuColor}
          />
          <Gauge
            value={memoryPercentage}
            label="Memory"
            sublabel={`${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`}
            color={memoryColor}
          />
        </div>

        {/* Chart Section */}
        <div className="flex-1 min-w-0">
          <div className="h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                <XAxis dataKey="index" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
                    borderColor: isDark ? '#374151' : '#E5E7EB',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value, name) => [
                    `${(value as number ?? 0).toFixed(1)}%`,
                    name === 'cpu' ? 'CPU' : 'Memory',
                  ]}
                  labelFormatter={() => ''}
                />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="memory"
                  stroke="#22C55E"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                CPU
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                Memory
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
