import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import type { SessionStatusItem } from '../../../lib/api-types'

interface SessionsGridProps {
  sessions: SessionStatusItem[]
  isLoading?: boolean
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  sessionId: string
}

export default function SessionsGrid({ sessions, isLoading }: SessionsGridProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    sessionId: '',
  })
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getSessionColor = (session: SessionStatusItem): string => {
    if (session.hasError) {
      return isDark ? 'bg-red-500' : 'bg-red-400'
    }
    if (session.status === 'ACTIVE') {
      return isDark ? 'bg-green-500' : 'bg-green-500'
    }
    // CLOSED or other statuses
    return isDark ? 'bg-neutral-600' : 'bg-neutral-300'
  }

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, session: SessionStatusItem) => {
      const rect = e.currentTarget.getBoundingClientRect()

      // Clear any existing timer
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }

      // Set timer to show tooltip after 2 seconds
      hoverTimerRef.current = setTimeout(() => {
        setTooltip({
          visible: true,
          x: rect.left + rect.width / 2,
          y: rect.top - 8,
          sessionId: session.id,
        })
      }, 2000)
    },
    []
  )

  const handleMouseLeave = useCallback(() => {
    // Clear the timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    // Hide tooltip
    setTooltip((prev) => ({ ...prev, visible: false }))
  }, [])

  // Count sessions by status
  const activeSessions = sessions.filter((s) => s.status === 'ACTIVE').length
  const closedSessions = sessions.filter((s) => s.status !== 'ACTIVE' && !s.hasError).length
  const errorSessions = sessions.filter((s) => s.hasError).length

  if (isLoading) {
    return (
      <div
        className={`p-6 rounded-2xl ${
          isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
        }`}
      >
        <div className="animate-pulse">
          <div className={`h-6 w-32 rounded mb-4 ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`} />
          <div className={`h-[100px] w-full rounded ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`} />
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
      <div className="flex items-center justify-between mb-4">
        <h3
          className={`text-heading-sm font-semibold ${
            isDark ? 'text-content-inverse' : 'text-content'
          }`}
        >
          Sessions
        </h3>
        <div
          className={`text-caption ${
            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
          }`}
        >
          {sessions.length} total
        </div>
      </div>

      {/* Sessions Grid */}
      {sessions.length === 0 ? (
        <div
          className={`text-center py-8 ${
            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
          }`}
        >
          No sessions yet
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sessions.map((session) => (
            <motion.div
              key={session.id}
              className={`w-4 h-4 rounded-full cursor-pointer ${getSessionColor(session)}`}
              onMouseEnter={(e) => handleMouseEnter(e, session)}
              onMouseLeave={handleMouseLeave}
              whileHover={{ scale: 1.3 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              title="" // Prevent default title tooltip
            />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 pt-4 border-t border-dashed"
        style={{ borderColor: isDark ? '#374151' : '#E5E7EB' }}
      >
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isDark ? 'bg-green-500' : 'bg-green-500'}`} />
          <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Active ({activeSessions})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isDark ? 'bg-neutral-600' : 'bg-neutral-300'}`} />
          <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Closed ({closedSessions})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isDark ? 'bg-red-500' : 'bg-red-400'}`} />
          <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Error ({errorSessions})
          </span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <motion.div
          className={`fixed z-50 px-3 py-2 rounded-lg text-caption font-mono shadow-lg ${
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
          {tooltip.sessionId.slice(0, 8)}...
        </motion.div>
      )}
    </div>
  )
}
