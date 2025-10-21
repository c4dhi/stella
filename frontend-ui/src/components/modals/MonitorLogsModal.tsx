import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient } from '../../services/ApiClient'
import type { LogEntry } from '../../lib/api-types'

interface MonitorLogsModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId?: string
}

export default function MonitorLogsModal({ isOpen, onClose, sessionId }: MonitorLogsModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Fetch logs
  const fetchLogs = async () => {
    try {
      setIsLoading(true)
      const data = await apiClient.getMonitoringLogs(sessionId)
      setLogs(data.logs || [])
    } catch (err) {
      console.error('Failed to fetch monitoring logs:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-refresh logs every 3 seconds
  useEffect(() => {
    if (!isOpen) return

    fetchLogs()
    const interval = setInterval(fetchLogs, 3000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionId])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-600 bg-red-50 border-red-200'
      case 'warn':
        return 'text-yellow-700 bg-yellow-50 border-yellow-200'
      case 'log':
        return 'text-green-700 bg-green-50 border-green-200'
      case 'debug':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      default:
        return 'text-neutral-600 bg-neutral-50 border-neutral-200'
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
                <div>
                  <h2 className="text-lg font-light text-neutral-900">
                    Listener Monitor Logs
                  </h2>
                  <p className="text-xs text-neutral-500 mt-1">
                    {sessionId ? `Filtered for session ${sessionId.slice(0, 8)}...` : 'All sessions'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Auto-scroll toggle */}
                  <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded"
                    />
                    Auto-scroll
                  </label>

                  {/* Refresh button */}
                  <button
                    onClick={fetchLogs}
                    className="p-2 rounded-lg hover:bg-neutral-100 transition-colors"
                    title="Refresh logs"
                  >
                    <svg
                      className={`w-4 h-4 text-neutral-600 ${isLoading ? 'animate-spin' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                  </button>

                  {/* Close button */}
                  <button
                    onClick={onClose}
                    className="p-2 rounded-lg hover:bg-neutral-100 transition-colors"
                  >
                    <svg
                      className="w-5 h-5 text-neutral-600"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Logs */}
              <div className="flex-1 overflow-auto p-4 bg-neutral-50 font-mono text-xs">
                {logs.length === 0 ? (
                  <div className="text-center text-neutral-400 py-8">
                    No logs available
                  </div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log, index) => (
                      <motion.div
                        key={index}
                        className={`p-3 rounded-lg border ${getLevelColor(log.level)}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-[10px] opacity-60 mt-0.5 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="text-[10px] font-semibold uppercase opacity-80 mt-0.5">
                            {log.level}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="break-words">{log.message}</div>
                            {log.data && (
                              <pre className="mt-2 text-[10px] opacity-70 overflow-auto whitespace-pre-wrap break-words max-w-full">
                                {JSON.stringify(log.data, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t rounded-b-2xl border-neutral-200 bg-neutral-50 flex items-center justify-between">
                <div className="text-xs text-neutral-500">
                  {logs.length} log {logs.length === 1 ? 'entry' : 'entries'}
                  {isLoading && <span className="ml-2 text-neutral-400">• Refreshing...</span>}
                </div>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-light hover:bg-neutral-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
