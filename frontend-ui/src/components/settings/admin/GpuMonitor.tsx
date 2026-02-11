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

const GPU_COLORS = ['#A855F7', '#EC4899', '#F97316', '#06B6D4', '#84CC16', '#EAB308']

function getUsageColor(value: number, baseColor: string): string {
  if (value >= 90) return '#EF4444'
  if (value >= 70) return '#EAB308'
  return baseColor
}

interface GpuGaugeProps {
  gpu: GpuDeviceMetrics
  color: string
  isDark: boolean
}

function GpuGauge({ gpu, color, isDark }: GpuGaugeProps) {
  const memUsed = parseMemoryValue(gpu.memoryUsed)
  const memTotal = parseMemoryValue(gpu.memoryTotal)
  const vramPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0

  const loadColor = getUsageColor(gpu.usage, color)
  const vramColor = getUsageColor(vramPercent, color)

  const radius = 36
  const circumference = 2 * Math.PI * radius

  return (
    <div className={`flex flex-col gap-3 p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-neutral-50'}`}>
      {/* GPU name header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className={`text-body-sm font-medium truncate ${isDark ? 'text-content-inverse' : 'text-content'}`}>
            GPU {gpu.index}
          </span>
        </div>
        {gpu.temperature !== null && (
          <span className={`text-caption ${
            gpu.temperature >= 85
              ? 'text-red-500'
              : gpu.temperature >= 70
                ? 'text-yellow-500'
                : isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
          }`}>
            {Math.round(gpu.temperature)}°C
          </span>
        )}
      </div>

      <div className={`text-caption truncate ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
        {gpu.name}
      </div>

      {/* Gauges row */}
      <div className="flex items-center justify-around gap-4">
        {/* Load gauge */}
        <div className="flex flex-col items-center">
          <div className="relative w-20 h-20">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50" cy="50" r={radius}
                fill="none"
                stroke={isDark ? '#374151' : '#E5E7EB'}
                strokeWidth="7"
              />
              <motion.circle
                cx="50" cy="50" r={radius}
                fill="none"
                stroke={loadColor}
                strokeWidth="7"
                strokeLinecap="round"
                initial={{ strokeDasharray: `0 ${circumference}` }}
                animate={{ strokeDasharray: `${(gpu.usage / 100) * circumference} ${circumference}` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.span
                className={`text-lg font-bold ${isDark ? 'text-content-inverse' : 'text-content'}`}
                key={Math.round(gpu.usage)}
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                {Math.round(gpu.usage)}%
              </motion.span>
            </div>
          </div>
          <span className={`text-caption mt-1 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Load
          </span>
        </div>

        {/* VRAM gauge */}
        <div className="flex flex-col items-center">
          <div className="relative w-20 h-20">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50" cy="50" r={radius}
                fill="none"
                stroke={isDark ? '#374151' : '#E5E7EB'}
                strokeWidth="7"
              />
              <motion.circle
                cx="50" cy="50" r={radius}
                fill="none"
                stroke={vramColor}
                strokeWidth="7"
                strokeLinecap="round"
                initial={{ strokeDasharray: `0 ${circumference}` }}
                animate={{ strokeDasharray: `${(vramPercent / 100) * circumference} ${circumference}` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.span
                className={`text-lg font-bold ${isDark ? 'text-content-inverse' : 'text-content'}`}
                key={Math.round(vramPercent)}
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                {Math.round(vramPercent)}%
              </motion.span>
            </div>
          </div>
          <span className={`text-caption mt-1 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            VRAM
          </span>
          <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
            {formatBytes(memUsed)} / {formatBytes(memTotal)}
          </span>
        </div>
      </div>
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

  // Don't render anything if no GPUs detected
  if (!currentMetrics?.gpuAvailable || gpus.length === 0) {
    return null
  }

  const chartData = useMemo(() => {
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
  }, [metricsHistory])

  return (
    <div
      className={`p-6 rounded-2xl ${
        isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
      }`}
    >
      {/* Header */}
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
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span
            className={`text-caption ${
              isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
            }`}
          >
            {gpus.length} GPU{gpus.length > 1 ? 's' : ''} detected
          </span>
        </div>
      </div>

      {/* GPU cards grid */}
      <div className={`grid gap-4 mb-6 ${
        gpus.length === 1 ? 'grid-cols-1 max-w-sm' : gpus.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      }`}>
        {gpus.map((gpu) => (
          <GpuGauge
            key={gpu.index}
            gpu={gpu}
            color={GPU_COLORS[gpu.index % GPU_COLORS.length]}
            isDark={isDark}
          />
        ))}
      </div>

      {/* History chart */}
      {chartData.length > 1 && (
        <>
          <div className={`text-body-sm font-medium mb-3 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Load History
          </div>
          <div className="h-[120px]">
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
                    return [`${(value as number ?? 0).toFixed(1)}%`, `GPU ${gpuIdx} ${type}`]
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
          </div>

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-3">
            {gpus.map((gpu) => (
              <div key={gpu.index} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: GPU_COLORS[gpu.index % GPU_COLORS.length] }} />
                <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                  GPU {gpu.index}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <div className={`w-5 h-0 border-t-2 ${isDark ? 'border-neutral-400' : 'border-neutral-500'}`} />
              <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                Load
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-5 h-0 border-t-2 border-dashed ${isDark ? 'border-neutral-400' : 'border-neutral-500'}`} />
              <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                VRAM
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
