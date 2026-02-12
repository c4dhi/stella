import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { useThemeStore } from '../../../store/themeStore'
import { parseMemoryValue, formatBytes } from '../../../hooks/useServerMetrics'
import type { ServerMetrics, GpuDeviceMetrics } from '../../../lib/api-types'

interface GpuMonitorProps {
  currentMetrics: ServerMetrics | null
  metricsHistory: ServerMetrics[]
  isConnected: boolean
}

// Consistent with ServerPerformanceMonitor gauge
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
            cx="50" cy="50" r={radius}
            fill="none"
            stroke={isDark ? '#374151' : '#E5E7EB'}
            strokeWidth="8"
          />
          <motion.circle
            cx="50" cy="50" r={radius}
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

const GPU_COLORS = ['#A855F7', '#EC4899', '#F97316', '#06B6D4', '#84CC16', '#EAB308']

function getGaugeColor(value: number, baseColor: string): string {
  if (value >= 90) return '#EF4444'
  if (value >= 70) return '#EAB308'
  return baseColor
}

function GpuGaugeGroup({ gpu, color, isDark }: { gpu: GpuDeviceMetrics; color: string; isDark: boolean }) {
  const memUsed = parseMemoryValue(gpu.memoryUsed)
  const memTotal = parseMemoryValue(gpu.memoryTotal)
  const vramPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0

  const loadColor = getGaugeColor(gpu.usage, color)
  const vramColor = getGaugeColor(vramPercent, color)

  const tempStr = gpu.temperature !== null ? ` · ${Math.round(gpu.temperature)}°C` : ''

  return (
    <div className="flex gap-6">
      <Gauge
        value={gpu.usage}
        label="Load"
        sublabel={`${gpu.name}${tempStr}`}
        color={loadColor}
      />
      <Gauge
        value={vramPercent}
        label="VRAM"
        sublabel={`${formatBytes(memUsed)} / ${formatBytes(memTotal)}`}
        color={vramColor}
      />
    </div>
  )
}

export default function GpuMonitor({
  currentMetrics,
  metricsHistory,
  isConnected,
}: GpuMonitorProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const gpus = currentMetrics?.gpus ?? []
  const hasGpus = gpus.length > 0

  const chartData = useMemo(() => {
    if (!hasGpus) return []
    return metricsHistory.map((m, i) => {
      const point: Record<string, number> = { index: i }
      for (const gpu of m.gpus ?? []) {
        point[`gpu${gpu.index}_load`] = gpu.usage
        const used = parseMemoryValue(gpu.memoryUsed)
        const total = parseMemoryValue(gpu.memoryTotal)
        point[`gpu${gpu.index}_vram`] = total > 0 ? (used / total) * 100 : 0
      }
      return point
    })
  }, [metricsHistory, hasGpus])

  return (
    <div
      className={`p-6 rounded-2xl ${
        isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
      } ${!hasGpus ? 'opacity-50' : ''}`}
    >
      {/* Header — matches ServerPerformanceMonitor */}
      <div className="flex items-center justify-between mb-6">
        <h3
          className={`text-heading-sm font-semibold ${
            isDark ? 'text-content-inverse' : 'text-content'
          }`}
        >
          GPU Performance
        </h3>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              !hasGpus ? (isDark ? 'bg-neutral-600' : 'bg-neutral-300')
                : isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span
            className={`text-caption ${
              isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
            }`}
          >
            {hasGpus
              ? (isConnected ? 'Live' : 'Disconnected')
              : 'No GPU detected'
            }
          </span>
        </div>
      </div>

      {/* No GPU state */}
      {!hasGpus && (
        <div className={`flex flex-col items-center justify-center py-8 ${
          isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
        }`}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h4v4H6z" />
            <path d="M14 10h4" />
            <path d="M14 14h4" />
          </svg>
          <p className="text-body-sm">No NVIDIA GPU available on this server</p>
          <p className="text-caption mt-1">GPU metrics will appear automatically when a GPU is detected</p>
        </div>
      )}

      {/* GPU content — mirrors ServerPerformanceMonitor layout: Gauges left | Chart right */}
      {hasGpus && (
        <div className="flex gap-8">
          {/* Gauges Section */}
          <div className={`flex shrink-0 pr-8 border-r ${isDark ? 'border-border-dark' : 'border-border'}`}>
            {gpus.length === 1 ? (
              // Single GPU: just show Load + VRAM gauges directly
              <GpuGaugeGroup gpu={gpus[0]} color={GPU_COLORS[0]} isDark={isDark} />
            ) : (
              // Multiple GPUs: labeled groups separated by dividers
              <div className="flex gap-6">
                {gpus.map((gpu, i) => (
                  <div key={gpu.index} className="flex gap-6">
                    {i > 0 && (
                      <div className={`w-px self-stretch ${isDark ? 'bg-white/10' : 'bg-neutral-200'}`} />
                    )}
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: GPU_COLORS[gpu.index % GPU_COLORS.length] }}
                        />
                        <span className={`text-caption font-medium ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                          GPU {gpu.index}
                        </span>
                      </div>
                      <GpuGaugeGroup gpu={gpu} color={GPU_COLORS[gpu.index % GPU_COLORS.length]} isDark={isDark} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chart Section */}
          <div className="flex-1 min-w-0">
            <div className="h-[140px]">
              {chartData.length > 1 ? (
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
                      formatter={(value, name) => {
                        const nameStr = String(name)
                        const gpuIdx = nameStr.match(/gpu(\d+)/)?.[1] ?? '?'
                        const type = nameStr.includes('vram') ? 'VRAM' : 'Load'
                        const label = gpus.length > 1 ? `GPU ${gpuIdx} ${type}` : type
                        return [`${(value as number ?? 0).toFixed(1)}%`, label]
                      }}
                      labelFormatter={() => ''}
                    />
                    {gpus.map((gpu) => (
                      <Line
                        key={`gpu${gpu.index}_load`}
                        type="monotone"
                        dataKey={`gpu${gpu.index}_load`}
                        stroke={GPU_COLORS[gpu.index % GPU_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                    {gpus.map((gpu) => (
                      <Line
                        key={`gpu${gpu.index}_vram`}
                        type="monotone"
                        dataKey={`gpu${gpu.index}_vram`}
                        stroke={GPU_COLORS[gpu.index % GPU_COLORS.length]}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className={`h-full flex items-center justify-center ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                  <span className="text-caption">Collecting data...</span>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-6 mt-3">
              {gpus.length > 1 && gpus.map((gpu) => (
                <div key={gpu.index} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: GPU_COLORS[gpu.index % GPU_COLORS.length] }} />
                  <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                    GPU {gpu.index}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <svg width="16" height="2" className="shrink-0">
                  <line x1="0" y1="1" x2="16" y2="1" stroke={isDark ? '#9CA3AF' : '#6B7280'} strokeWidth="2" />
                </svg>
                <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                  Load
                </span>
              </div>
              <div className="flex items-center gap-2">
                <svg width="16" height="2" className="shrink-0">
                  <line x1="0" y1="1" x2="16" y2="1" stroke={isDark ? '#9CA3AF' : '#6B7280'} strokeWidth="2" strokeDasharray="4 3" />
                </svg>
                <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                  VRAM
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
