import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import type { SessionActivityDay } from '../../../lib/api-types'

interface SessionActivityGridProps {
  data: SessionActivityDay[]
  isLoading?: boolean
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  data: SessionActivityDay | null
}

export default function SessionActivityGrid({ data, isLoading }: SessionActivityGridProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    data: null,
  })

  // Calculate grid dimensions - 90 days, 7 rows (days of week), 13 columns (weeks)
  const gridData = useMemo(() => {
    // Sort data by date
    const sortedData = [...data].sort((a, b) => a.date.localeCompare(b.date))

    // Create a map for quick lookup
    const dataMap = new Map(sortedData.map((d) => [d.date, d]))

    // Generate grid - start from 90 days ago
    const grid: (SessionActivityDay | null)[][] = []
    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - 89)

    // Adjust to start from Sunday
    const dayOfWeek = startDate.getDay()

    // Fill in weeks
    let currentDate = new Date(startDate)
    currentDate.setDate(currentDate.getDate() - dayOfWeek)

    for (let week = 0; week < 13; week++) {
      const weekData: (SessionActivityDay | null)[] = []
      for (let day = 0; day < 7; day++) {
        const dateStr = currentDate.toISOString().split('T')[0]
        const isInRange = currentDate >= startDate && currentDate <= today
        weekData.push(isInRange ? dataMap.get(dateStr) || null : null)
        currentDate.setDate(currentDate.getDate() + 1)
      }
      grid.push(weekData)
    }

    return grid
  }, [data])

  const getActivityColor = (activity: SessionActivityDay | null): string => {
    if (!activity) {
      return isDark ? 'bg-neutral-800' : 'bg-neutral-100'
    }

    const total = activity.activeCount + activity.closedCount + activity.errorCount

    // Error takes priority
    if (activity.errorCount > 0) {
      return isDark ? 'bg-red-500/70' : 'bg-red-400'
    }

    // Active sessions
    if (activity.activeCount > 0) {
      const intensity = Math.min(activity.activeCount / 5, 1)
      if (intensity > 0.7) return isDark ? 'bg-green-500' : 'bg-green-500'
      if (intensity > 0.4) return isDark ? 'bg-green-500/70' : 'bg-green-400'
      return isDark ? 'bg-green-500/40' : 'bg-green-300'
    }

    // Closed sessions only
    if (total > 0) {
      return isDark ? 'bg-neutral-500' : 'bg-neutral-300'
    }

    return isDark ? 'bg-neutral-800' : 'bg-neutral-100'
  }

  const handleMouseEnter = (
    e: React.MouseEvent,
    activity: SessionActivityDay | null
  ) => {
    if (!activity) return
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({
      visible: true,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      data: activity,
    })
  }

  const handleMouseLeave = () => {
    setTooltip((prev) => ({ ...prev, visible: false }))
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  if (isLoading) {
    return (
      <div
        className={`p-6 rounded-2xl ${
          isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
        }`}
      >
        <div className="animate-pulse">
          <div className={`h-6 w-40 rounded mb-4 ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`} />
          <div className={`h-[120px] w-full rounded ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`} />
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
      <h3
        className={`text-heading-sm font-semibold mb-4 ${
          isDark ? 'text-content-inverse' : 'text-content'
        }`}
      >
        Session Activity
      </h3>

      <div className="flex gap-2">
        {/* Day labels */}
        <div className="flex flex-col gap-[3px] text-caption pt-0">
          {dayLabels.map((day, i) => (
            <div
              key={day}
              className={`h-[13px] flex items-center ${
                i % 2 === 0
                  ? isDark
                    ? 'text-content-inverse-tertiary'
                    : 'text-content-tertiary'
                  : 'text-transparent'
              }`}
              style={{ fontSize: '10px' }}
            >
              {i % 2 === 0 ? day : ''}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex gap-[3px]">
          {gridData.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((day, dayIndex) => (
                <motion.div
                  key={`${weekIndex}-${dayIndex}`}
                  className={`w-[13px] h-[13px] rounded-sm ${getActivityColor(day)} cursor-pointer`}
                  onMouseEnter={(e) => handleMouseEnter(e, day)}
                  onMouseLeave={handleMouseLeave}
                  whileHover={{ scale: 1.3 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-caption">
        <span className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>
          Less
        </span>
        <div className="flex gap-1">
          <div className={`w-[13px] h-[13px] rounded-sm ${isDark ? 'bg-neutral-800' : 'bg-neutral-100'}`} />
          <div className={`w-[13px] h-[13px] rounded-sm ${isDark ? 'bg-green-500/40' : 'bg-green-300'}`} />
          <div className={`w-[13px] h-[13px] rounded-sm ${isDark ? 'bg-green-500/70' : 'bg-green-400'}`} />
          <div className={`w-[13px] h-[13px] rounded-sm ${isDark ? 'bg-green-500' : 'bg-green-500'}`} />
        </div>
        <span className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>
          More
        </span>
        <div className="ml-4 flex items-center gap-1">
          <div className={`w-[13px] h-[13px] rounded-sm ${isDark ? 'bg-red-500/70' : 'bg-red-400'}`} />
          <span className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>
            Error
          </span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip.visible && tooltip.data && (
        <motion.div
          className={`fixed z-50 px-3 py-2 rounded-lg text-caption shadow-lg ${
            isDark ? 'bg-neutral-800 text-content-inverse' : 'bg-white text-content border border-neutral-200'
          }`}
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="font-medium mb-1">{formatDate(tooltip.data.date)}</div>
          <div className="space-y-0.5">
            {tooltip.data.activeCount > 0 && (
              <div className="text-green-500">
                {tooltip.data.activeCount} active
              </div>
            )}
            {tooltip.data.closedCount > 0 && (
              <div className={isDark ? 'text-neutral-400' : 'text-neutral-500'}>
                {tooltip.data.closedCount} closed
              </div>
            )}
            {tooltip.data.errorCount > 0 && (
              <div className="text-red-500">{tooltip.data.errorCount} errors</div>
            )}
            {tooltip.data.activeCount === 0 &&
              tooltip.data.closedCount === 0 &&
              tooltip.data.errorCount === 0 && (
                <div className={isDark ? 'text-neutral-500' : 'text-neutral-400'}>
                  No activity
                </div>
              )}
          </div>
        </motion.div>
      )}
    </div>
  )
}
