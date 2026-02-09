import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../../store/themeStore'
import type { SessionStatusItem } from '../../../lib/api-types'

interface SessionsGridProps {
  sessions: SessionStatusItem[]
  isLoading?: boolean
  onCloseSession?: (sessionId: string) => void
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  session: SessionStatusItem | null
}

interface PopoverState {
  visible: boolean
  anchorX: number   // dot center X (viewport)
  anchorY: number   // dot bottom Y (viewport)
  dotTop: number    // dot top Y (for flipping above)
  session: SessionStatusItem | null
  confirmingClose: boolean
}

type SessionVisualState = 'error' | 'resource-warning' | 'active' | 'idle' | 'closed'

function getSessionVisualState(session: SessionStatusItem): SessionVisualState {
  if (session.hasError) return 'error'
  if (session.hasResourceWarning) return 'resource-warning'
  if (session.status === 'ACTIVE' && !session.isIdle) return 'active'
  if (session.status === 'ACTIVE' && session.isIdle) return 'idle'
  return 'closed'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}Ki`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}Mi`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`
}

function getStatusLabel(session: SessionStatusItem): string {
  const state = getSessionVisualState(session)
  switch (state) {
    case 'error': return 'Error'
    case 'resource-warning': return 'Resource Warning'
    case 'active': return 'Active'
    case 'idle': return 'Idle'
    case 'closed': return 'Closed'
  }
}

function getStatusColor(session: SessionStatusItem, isDark: boolean): string {
  const state = getSessionVisualState(session)
  switch (state) {
    case 'error': return 'text-red-500'
    case 'resource-warning': return isDark ? 'text-orange-400' : 'text-orange-500'
    case 'active': return 'text-green-500'
    case 'idle': return isDark ? 'text-neutral-400' : 'text-neutral-500'
    case 'closed': return isDark ? 'text-neutral-500' : 'text-neutral-400'
  }
}

export default function SessionsGrid({ sessions, isLoading, onCloseSession }: SessionsGridProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    session: null,
  })
  const [popover, setPopover] = useState<PopoverState>({
    visible: false,
    anchorX: 0,
    anchorY: 0,
    dotTop: 0,
    session: null,
    confirmingClose: false,
  })
  const popoverRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getSessionDotClass = (session: SessionStatusItem): string => {
    const state = getSessionVisualState(session)
    switch (state) {
      case 'error':
        return isDark ? 'bg-red-500' : 'bg-red-400'
      case 'resource-warning':
        return isDark ? 'bg-orange-500' : 'bg-orange-400'
      case 'active':
        return 'bg-green-500'
      case 'idle':
        return isDark ? 'bg-neutral-400' : 'bg-neutral-300'
      case 'closed':
        return 'session-dot-closed'
    }
  }

  const getClosedDotStyle = (isDarkMode: boolean): React.CSSProperties => {
    const baseColor = isDarkMode ? '#737373' : '#a3a3a3' // neutral-500 / neutral-400
    return {
      background: `repeating-linear-gradient(-45deg, ${baseColor}, ${baseColor} 2px, transparent 2px, transparent 4px)`,
    }
  }

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, session: SessionStatusItem) => {
      // Don't show tooltip if popover is open
      if (popover.visible) return

      const rect = e.currentTarget.getBoundingClientRect()

      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }

      hoverTimerRef.current = setTimeout(() => {
        setTooltip({
          visible: true,
          x: rect.left + rect.width / 2,
          y: rect.top - 8,
          session,
        })
      }, 2000)
    },
    [popover.visible]
  )

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setTooltip((prev) => ({ ...prev, visible: false }))
  }, [])

  const handleDotClick = useCallback(
    (e: React.MouseEvent, session: SessionStatusItem) => {
      // Hide tooltip
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
      setTooltip((prev) => ({ ...prev, visible: false }))

      const rect = e.currentTarget.getBoundingClientRect()
      setPopover({
        visible: true,
        anchorX: rect.left + rect.width / 2,
        anchorY: rect.bottom,
        dotTop: rect.top,
        session,
        confirmingClose: false,
      })
    },
    []
  )

  const closePopover = useCallback(() => {
    setPopover((prev) => ({ ...prev, visible: false, confirmingClose: false }))
  }, [])

  const handleCloseSession = useCallback(() => {
    if (!popover.session || !onCloseSession) return
    if (!popover.confirmingClose) {
      setPopover((prev) => ({ ...prev, confirmingClose: true }))
      return
    }
    onCloseSession(popover.session.id)
    closePopover()
  }, [popover.session, popover.confirmingClose, onCloseSession, closePopover])

  // Count sessions by visual state
  const activeSessions = sessions.filter((s) => getSessionVisualState(s) === 'active').length
  const idleSessions = sessions.filter((s) => getSessionVisualState(s) === 'idle').length
  const closedSessions = sessions.filter((s) => getSessionVisualState(s) === 'closed').length
  const warningSessions = sessions.filter((s) => getSessionVisualState(s) === 'resource-warning').length
  const errorSessions = sessions.filter((s) => getSessionVisualState(s) === 'error').length

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
          {sessions.map((session) => {
            const isClosed = getSessionVisualState(session) === 'closed'
            return (
              <motion.div
                key={session.id}
                className={`w-4 h-4 rounded-full cursor-pointer ${getSessionDotClass(session)}`}
                style={isClosed ? getClosedDotStyle(isDark) : undefined}
                onMouseEnter={(e) => handleMouseEnter(e, session)}
                onMouseLeave={handleMouseLeave}
                onClick={(e) => handleDotClick(e, session)}
                whileHover={{ scale: 1.3 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                title="" // Prevent default title tooltip
              />
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-dashed flex-wrap"
        style={{ borderColor: isDark ? '#374151' : '#E5E7EB' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Active ({activeSessions})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isDark ? 'bg-neutral-400' : 'bg-neutral-300'}`} />
          <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Idle ({idleSessions})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={getClosedDotStyle(isDark)}
          />
          <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Closed ({closedSessions})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isDark ? 'bg-orange-500' : 'bg-orange-400'}`} />
          <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            Resource Warning ({warningSessions})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isDark ? 'bg-red-500' : 'bg-red-400'}`} />
            <span className={`text-caption ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
              Error ({errorSessions})
            </span>
          </div>
      </div>

      {/* Hover Tooltip (quick ID preview) */}
      {tooltip.visible && tooltip.session && !popover.visible && (
        <motion.div
          className={`fixed z-50 px-3 py-2 rounded-lg text-caption font-mono shadow-lg pointer-events-none ${
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
          {tooltip.session.id.slice(0, 8)}... &middot; {getStatusLabel(tooltip.session)}
        </motion.div>
      )}

      {/* Click Popover (session details + actions) — speech bubble */}
      <AnimatePresence>
        {popover.visible && popover.session && (() => {
          const popoverWidth = 288 // w-72 = 18rem = 288px
          const arrowSize = 8
          const gap = 6 // space between dot and arrow tip

          // Decide if bubble goes below or above the dot
          const spaceBelow = window.innerHeight - popover.anchorY
          const showAbove = spaceBelow < 300
          const bubbleTop = showAbove
            ? undefined // positioned via bottom
            : popover.anchorY + gap + arrowSize

          // Clamp horizontal so the card stays on screen (16px margin)
          const halfW = popoverWidth / 2
          const clampedLeft = Math.max(16 + halfW, Math.min(popover.anchorX, window.innerWidth - 16 - halfW))

          // Arrow offset: how far the arrow must shift from center so it still points at the dot
          const arrowLeft = popover.anchorX - clampedLeft // relative to bubble center
          // Clamp arrow so it stays within the rounded corners (min 16px from edge)
          const arrowClamp = halfW - 16
          const arrowOffset = Math.max(-arrowClamp, Math.min(arrowLeft, arrowClamp))

          const bgColor = isDark ? '#262626' : '#ffffff'       // neutral-800 / white
          const borderColor = isDark ? '#404040' : '#e5e5e5'   // neutral-700 / neutral-200

          return (
            <>
              {/* Backdrop to close popover */}
              <div
                className="fixed inset-0 z-40"
                onClick={closePopover}
              />
              <motion.div
                ref={popoverRef}
                className={`fixed z-50 rounded-xl shadow-xl ${
                  isDark ? 'bg-neutral-800 border border-neutral-700' : 'bg-white border border-neutral-200'
                }`}
                style={{
                  width: popoverWidth,
                  left: clampedLeft,
                  ...(showAbove
                    ? { bottom: window.innerHeight - popover.dotTop + gap + arrowSize }
                    : { top: bubbleTop }),
                  transform: 'translateX(-50%)',
                }}
                initial={{ opacity: 0, y: showAbove ? 5 : -5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: showAbove ? 5 : -5, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                {/* Arrow pointing at the dot */}
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    transform: `translateX(calc(-50% + ${arrowOffset}px))`,
                    ...(showAbove
                      ? { bottom: -(arrowSize * 2 - 1) }
                      : { top: -(arrowSize * 2 - 1) }),
                    width: 0,
                    height: 0,
                    borderLeft: `${arrowSize}px solid transparent`,
                    borderRight: `${arrowSize}px solid transparent`,
                    ...(showAbove
                      ? {
                          borderTop: `${arrowSize}px solid ${borderColor}`,
                          borderBottom: `${arrowSize}px solid transparent`,
                        }
                      : {
                          borderBottom: `${arrowSize}px solid ${borderColor}`,
                          borderTop: `${arrowSize}px solid transparent`,
                        }),
                  }}
                />
                {/* Inner arrow (covers border to match background) */}
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    transform: `translateX(calc(-50% + ${arrowOffset}px))`,
                    ...(showAbove
                      ? { bottom: -(arrowSize * 2 - 3) }
                      : { top: -(arrowSize * 2 - 3) }),
                    width: 0,
                    height: 0,
                    borderLeft: `${arrowSize}px solid transparent`,
                    borderRight: `${arrowSize}px solid transparent`,
                    ...(showAbove
                      ? {
                          borderTop: `${arrowSize}px solid ${bgColor}`,
                          borderBottom: `${arrowSize}px solid transparent`,
                        }
                      : {
                          borderBottom: `${arrowSize}px solid ${bgColor}`,
                          borderTop: `${arrowSize}px solid transparent`,
                        }),
                  }}
                />

                <div className="p-4 space-y-3">
                  {/* Session ID */}
                  <div>
                    <div className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                      Session ID
                    </div>
                    <div className={`font-mono text-sm ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                      {popover.session.id.slice(0, 16)}...
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-2">
                    <div className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                      Status:
                    </div>
                    <span className={`text-sm font-medium ${getStatusColor(popover.session, isDark)}`}>
                      {getStatusLabel(popover.session)}
                    </span>
                  </div>

                  {/* Created At */}
                  <div>
                    <div className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                      Created
                    </div>
                    <div className={`text-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                      {new Date(popover.session.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {/* Project ID */}
                  <div>
                    <div className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                      Project
                    </div>
                    <div className={`font-mono text-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                      {popover.session.projectId.slice(0, 16)}...
                    </div>
                  </div>

                  {/* Resource Usage */}
                  {popover.session.resourceUsage && (
                    <div>
                      <div className={`text-caption mb-1 ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                        Resource Usage
                      </div>
                      <div className="space-y-1.5">
                        {/* CPU Bar */}
                        <div>
                          <div className="flex justify-between text-caption mb-0.5">
                            <span className={isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}>
                              CPU
                            </span>
                            <span className={isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}>
                              {popover.session.resourceUsage.cpuMillicores}m ({popover.session.resourceUsage.cpuPercent}%)
                            </span>
                          </div>
                          <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`}>
                            <div
                              className={`h-full rounded-full transition-all ${
                                popover.session.resourceUsage.cpuPercent > 80
                                  ? 'bg-orange-500'
                                  : 'bg-blue-500'
                              }`}
                              style={{ width: `${Math.min(popover.session.resourceUsage.cpuPercent, 100)}%` }}
                            />
                          </div>
                        </div>
                        {/* Memory Bar */}
                        <div>
                          <div className="flex justify-between text-caption mb-0.5">
                            <span className={isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}>
                              Memory
                            </span>
                            <span className={isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}>
                              {formatBytes(popover.session.resourceUsage.memoryBytes)} ({popover.session.resourceUsage.memoryPercent}%)
                            </span>
                          </div>
                          <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-neutral-700' : 'bg-neutral-200'}`}>
                            <div
                              className={`h-full rounded-full transition-all ${
                                popover.session.resourceUsage.memoryPercent > 80
                                  ? 'bg-orange-500'
                                  : 'bg-blue-500'
                              }`}
                              style={{ width: `${Math.min(popover.session.resourceUsage.memoryPercent, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error details */}
                  {popover.session.errors.length > 0 && (
                    <div className="space-y-1.5">
                      {popover.session.errors.map((err, i) => (
                        <div
                          key={i}
                          className={`text-sm px-2.5 py-2 rounded-lg ${
                            isDark ? 'bg-red-500/10' : 'bg-red-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                              className={isDark ? 'text-red-400' : 'text-red-500'}
                            >
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                              {err.agentName}
                            </span>
                            <span className={`text-caption px-1.5 py-0.5 rounded font-mono ${
                              isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700'
                            }`}>
                              {err.status}
                            </span>
                          </div>
                          {err.lastError && (
                            <div className={`mt-1 text-caption font-mono break-words ${
                              isDark ? 'text-red-300/70' : 'text-red-600/80'
                            }`}>
                              {err.lastError}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Close Session Button (only for ACTIVE sessions) */}
                  {onCloseSession && popover.session.status === 'ACTIVE' && (
                    <div className="pt-2 border-t" style={{ borderColor: isDark ? '#374151' : '#E5E7EB' }}>
                      {!popover.confirmingClose ? (
                        <button
                          onClick={handleCloseSession}
                          className={`w-full text-sm py-2 px-3 rounded-lg transition-colors ${
                            isDark
                              ? 'text-red-400 hover:bg-red-500/10'
                              : 'text-red-600 hover:bg-red-50'
                          }`}
                        >
                          Close Session
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <p className={`text-caption text-center ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                            This will stop all agents and close the session.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setPopover((prev) => ({ ...prev, confirmingClose: false }))}
                              className={`flex-1 text-sm py-1.5 px-3 rounded-lg transition-colors ${
                                isDark
                                  ? 'text-content-inverse-secondary hover:bg-neutral-700'
                                  : 'text-content-secondary hover:bg-neutral-100'
                              }`}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleCloseSession}
                              className={`flex-1 text-sm py-1.5 px-3 rounded-lg font-medium transition-colors ${
                                isDark
                                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                  : 'bg-red-100 text-red-600 hover:bg-red-200'
                              }`}
                            >
                              Confirm
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            </>
          )
        })()}
      </AnimatePresence>
    </div>
  )
}
