import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useSessionAnalytics } from '../../hooks/useSessionAnalytics'
import LatencyStageChart from '../settings/analytics/LatencyStageChart'

interface SessionAnalyticsModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  sessionId: string
}

export default function SessionAnalyticsModal({ isOpen, onClose, projectId, sessionId }: SessionAnalyticsModalProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const { data, isLoading, error, fetch } = useSessionAnalytics()

  useEffect(() => {
    if (isOpen && sessionId && projectId) {
      fetch(projectId, sessionId)
    }
  }, [isOpen, projectId, sessionId, fetch])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto ${
              isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-border-dark' : 'border-neutral-200'}`}>
              <div>
                <h2 className={`text-lg font-semibold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                  Session Analytics
                </h2>
                {data && (
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                    {data.totalTurns} turn{data.totalTurns !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDark ? 'hover:bg-surface-dark-tertiary text-content-inverse-secondary' : 'hover:bg-neutral-100 text-content-secondary'
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-6">
              {isLoading && (
                <p className={`text-center text-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                  Loading analytics...
                </p>
              )}

              {error && (
                <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                  {error}
                </div>
              )}

              {data && !isLoading && (
                <>
                  {(() => {
                    const ttfabBridge = data.stages.find(s => s.stage === 'ttfab_bridge')
                    const ttfabDirect = data.stages.find(s => s.stage === 'ttfab_direct')
                    const bridgeGap = data.stages.find(s => s.stage === 'bridge_response_gap')
                    const ttfab = ttfabBridge || ttfabDirect
                    return ttfab ? (
                      <div className={`flex gap-6 justify-center mb-5 py-3 rounded-lg ${isDark ? 'bg-surface-dark-tertiary' : 'bg-neutral-50'}`}>
                        <div className="text-center">
                          <span className={`text-2xl font-bold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                            {ttfab.p50_ms.toFixed(0)}ms
                          </span>
                          <span className={`text-xs ml-1 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                            {ttfabBridge ? 'Bridge' : 'Direct'} TTFAB
                          </span>
                        </div>
                        {bridgeGap && (
                          <div className="text-center">
                            <span className={`text-2xl font-bold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                              {bridgeGap.p50_ms.toFixed(0)}ms
                            </span>
                            <span className={`text-xs ml-1 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                              Bridge-Response Gap
                            </span>
                          </div>
                        )}
                      </div>
                    ) : null
                  })()}
                  <LatencyStageChart stages={data.stages} />
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
