import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient } from '../../services/ApiClient'
import ConfirmDialog from '../modals/ConfirmDialog'
import { useToastStore } from '../../store/toastStore'
import type { AgentInstance, AgentWithPodStatus } from '../../lib/api-types'
import { AgentStatus, POLL_INTERVALS } from '../../lib/api-types'

interface AgentSidebarProps {
  sessionId: string
  initialAgents?: AgentInstance[]
  onDeployClick: () => void
}

export default function AgentSidebar({ sessionId, initialAgents = [], onDeployClick }: AgentSidebarProps) {
  const { addToast } = useToastStore()
  const [agents, setAgents] = useState<AgentInstance[]>(initialAgents)
  const [selectedAgent, setSelectedAgent] = useState<AgentWithPodStatus | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState<string>('')
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [liveLogsMap, setLiveLogsMap] = useState<Map<string, string>>(new Map())
  const [eventSourcesMap] = useState<Map<string, EventSource>>(new Map())
  const [maximizedLogAgent, setMaximizedLogAgent] = useState<string | null>(null)

  // Auto-scroll state: track if each agent's logs should auto-scroll
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<Map<string, boolean>>(new Map())

  // Refs for log containers
  const inlineLogRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const maximizedLogRef = useRef<HTMLDivElement | null>(null)

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
    confirmText?: string
    variant?: 'danger' | 'primary'
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  })

  // Sync agents when initialAgents prop changes (immediate update from parent)
  useEffect(() => {
    setAgents(initialAgents)
  }, [initialAgents])

  // Poll for agents status with smart merge
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const session = await apiClient.getSession(sessionId)

        // Smart merge: validate state transitions before accepting server updates
        setAgents(prev =>
          session.agents.map(serverAgent => {
            const localAgent = prev.find(a => a.id === serverAgent.id)

            if (!localAgent) {
              // New agent from server - accept as-is
              return serverAgent
            }

            // Define valid state transitions
            const isValidTransition = (from: AgentStatus, to: AgentStatus): boolean => {
              const validTransitions: Record<AgentStatus, AgentStatus[]> = {
                [AgentStatus.STARTING]: [AgentStatus.RUNNING, AgentStatus.FAILED, AgentStatus.STOPPED],
                [AgentStatus.RUNNING]: [AgentStatus.STOPPING, AgentStatus.STOPPED, AgentStatus.FAILED],
                [AgentStatus.STOPPING]: [AgentStatus.STOPPED, AgentStatus.FAILED],
                [AgentStatus.STOPPED]: [], // Terminal state
                [AgentStatus.FAILED]: []   // Terminal state
              }
              return validTransitions[from]?.includes(to) ?? false
            }

            // Keep local state if server transition is invalid (likely stale data)
            if (!isValidTransition(localAgent.status, serverAgent.status)) {
              return { ...serverAgent, status: localAgent.status }
            }

            // Accept valid server transition
            return serverAgent
          })
        )
      } catch (err) {
        console.error('Failed to refresh agents:', err)
      }
    }, POLL_INTERVALS.AGENTS)

    return () => clearInterval(interval)
  }, [sessionId])

  // Deploy new agent
  const handleDeployAgent = async (name: string, icon?: string, planId?: string) => {
    const newAgent = await apiClient.createAgent(sessionId, { name, icon, planId })
    setAgents(prev => [...prev, newAgent])
  }

  // Stop agent
  const handleStopAgent = (agentId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Stop Agent',
      message: 'Are you sure you want to stop this agent? It will disconnect from the session.',
      confirmText: 'Stop Agent',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        try {
          await apiClient.stopAgent(agentId)
          setAgents(prev =>
            prev.map(a => (a.id === agentId ? { ...a, status: 'STOPPING' as AgentStatus } : a))
          )
          addToast({ message: 'Agent stopped successfully', type: 'success' })
        } catch (err) {
          addToast({
            message: err instanceof Error ? err.message : 'Failed to stop agent',
            type: 'error'
          })
        }
      },
    })
  }

  // Restart agent
  const handleRestartAgent = (agentId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Restart Agent',
      message: 'Restart this agent? This will create a new pod with updated configuration.',
      confirmText: 'Restart Agent',
      variant: 'primary',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }))

        // Close existing log stream if active
        const existingEventSource = eventSourcesMap.get(agentId)
        if (existingEventSource) {
          existingEventSource.close()
          eventSourcesMap.delete(agentId)
        }

        // Clear old logs
        const newLogsMap = new Map(liveLogsMap)
        newLogsMap.delete(agentId)
        setLiveLogsMap(newLogsMap)

        try {
          await apiClient.restartAgent(agentId)
          setAgents(prev =>
            prev.map(a => (a.id === agentId ? { ...a, status: 'STARTING' as AgentStatus } : a))
          )

          // Restart log stream if logs were expanded
          if (expandedLogs.has(agentId)) {
            // Small delay to allow pod to be created
            setTimeout(() => {
              startLogStream(agentId)
            }, 2000)
          }

          addToast({ message: 'Agent restarted successfully', type: 'success' })
        } catch (err) {
          addToast({
            message: err instanceof Error ? err.message : 'Failed to restart agent',
            type: 'error'
          })
        }
      },
    })
  }

  // Delete agent permanently
  const handleDeleteAgent = (agentId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Agent',
      message: 'Permanently delete this agent? This will remove all data and cannot be undone.',
      confirmText: 'Delete Permanently',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }))
        try {
          await apiClient.deleteAgent(agentId)
          setAgents(prev => prev.filter(a => a.id !== agentId))
          addToast({ message: 'Agent deleted successfully', type: 'success' })
        } catch (err) {
          addToast({
            message: err instanceof Error ? err.message : 'Failed to delete agent',
            type: 'error'
          })
        }
      },
    })
  }

  // View agent details
  const handleViewAgent = async (agentId: string) => {
    try {
      const agent = await apiClient.getAgent(agentId)
      setSelectedAgent(agent)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to load agent details',
        type: 'error'
      })
    }
  }

  // View agent logs
  const handleViewLogs = async (agentId: string) => {
    try {
      const logsData = await apiClient.getAgentLogs(agentId)
      setLogs(logsData)
      setShowLogs(true)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to load agent logs',
        type: 'error'
      })
    }
  }

  // Toggle live logs
  const toggleLiveLogs = (agentId: string) => {
    const newExpanded = new Set(expandedLogs)

    if (expandedLogs.has(agentId)) {
      // Collapse and close EventSource
      newExpanded.delete(agentId)
      const eventSource = eventSourcesMap.get(agentId)
      if (eventSource) {
        eventSource.close()
        eventSourcesMap.delete(agentId)
      }
      const newLogsMap = new Map(liveLogsMap)
      newLogsMap.delete(agentId)
      setLiveLogsMap(newLogsMap)

      // Disable auto-scroll
      const newAutoScroll = new Map(autoScrollEnabled)
      newAutoScroll.delete(agentId)
      setAutoScrollEnabled(newAutoScroll)
    } else {
      // Expand and start streaming
      newExpanded.add(agentId)
      startLogStream(agentId)

      // Enable auto-scroll by default
      const newAutoScroll = new Map(autoScrollEnabled)
      newAutoScroll.set(agentId, true)
      setAutoScrollEnabled(newAutoScroll)
    }

    setExpandedLogs(newExpanded)
  }

  // Start log streaming for an agent
  const startLogStream = (agentId: string) => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
    const token = localStorage.getItem('grace_auth_token')

    // Include JWT token as query parameter for EventSource authentication
    const url = token
      ? `${apiUrl}/agents/${agentId}/logs/stream?token=${encodeURIComponent(token)}`
      : `${apiUrl}/agents/${agentId}/logs/stream`

    const eventSource = new EventSource(url)

    eventSource.onmessage = (event) => {
      const newLogsMap = new Map(liveLogsMap)
      newLogsMap.set(agentId, event.data)
      setLiveLogsMap(newLogsMap)
    }

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error)
      eventSource.close()
      eventSourcesMap.delete(agentId)
      addToast({
        message: 'Lost connection to log stream',
        type: 'error'
      })
    }

    eventSourcesMap.set(agentId, eventSource)
  }

  // Cleanup EventSources on unmount
  useEffect(() => {
    return () => {
      eventSourcesMap.forEach(eventSource => eventSource.close())
      eventSourcesMap.clear()
    }
  }, [])

  // Handle scroll detection: disable auto-scroll if user scrolls up
  const handleLogScroll = (agentId: string, event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    const isAtBottom = Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) < 50

    const currentAutoScroll = autoScrollEnabled.get(agentId)
    if (isAtBottom && !currentAutoScroll) {
      // User scrolled back to bottom, re-enable auto-scroll
      const newAutoScroll = new Map(autoScrollEnabled)
      newAutoScroll.set(agentId, true)
      setAutoScrollEnabled(newAutoScroll)
    } else if (!isAtBottom && currentAutoScroll) {
      // User scrolled up, disable auto-scroll
      const newAutoScroll = new Map(autoScrollEnabled)
      newAutoScroll.set(agentId, false)
      setAutoScrollEnabled(newAutoScroll)
    }
  }

  // Auto-scroll logs when new data arrives (if enabled)
  useEffect(() => {
    liveLogsMap.forEach((_, agentId) => {
      const shouldAutoScroll = autoScrollEnabled.get(agentId)
      if (!shouldAutoScroll) return

      // Scroll inline logs if expanded
      if (expandedLogs.has(agentId)) {
        const inlineLogElement = inlineLogRefs.current.get(agentId)
        if (inlineLogElement) {
          inlineLogElement.scrollTop = inlineLogElement.scrollHeight
        }
      }

      // Scroll maximized logs if this agent is maximized
      if (maximizedLogAgent === agentId && maximizedLogRef.current) {
        maximizedLogRef.current.scrollTop = maximizedLogRef.current.scrollHeight
      }
    })
  }, [liveLogsMap, autoScrollEnabled, expandedLogs, maximizedLogAgent])

  // Enable auto-scroll when maximizing logs
  useEffect(() => {
    if (maximizedLogAgent) {
      const newAutoScroll = new Map(autoScrollEnabled)
      newAutoScroll.set(maximizedLogAgent, true)
      setAutoScrollEnabled(newAutoScroll)
    }
  }, [maximizedLogAgent])

  const getStatusColor = (status: AgentStatus) => {
    switch (status) {
      case 'RUNNING':
        return 'bg-green-50/80 text-green-700 border-green-200/60'
      case 'STARTING':
        return 'bg-blue-50/80 text-blue-700 border-blue-200/60 animate-pulse'
      case 'STOPPING':
        return 'bg-orange-50/80 text-orange-700 border-orange-200/60 animate-pulse'
      case 'STOPPED':
        return 'bg-neutral-100/80 text-neutral-600 border-neutral-200/60'
      case 'FAILED':
        return 'bg-red-50/80 text-red-700 border-red-200/60'
      default:
        return 'bg-neutral-100/80 text-neutral-600 border-neutral-200/60'
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="w-80 flex flex-col"
      >
        {/* Agents Panel */}
        <div
          className="
            bg-white/95 backdrop-blur-xl border border-neutral-200/60
            rounded-[16px] shadow-[0_1px_30px_rgba(0,0,0,0.04)]
            h-full flex flex-col overflow-hidden
          "
        >
          {/* Header */}
          <div className="p-4 border-b border-neutral-200/60">
            <h2 className="text-lg font-thin text-neutral-900 tracking-wider mb-1">
              Agents
            </h2>
            <p className="text-[10px] text-neutral-500 font-light tracking-wider uppercase">
              {agents.length} {agents.length === 1 ? 'agent' : 'agents'} deployed
            </p>
          </div>

          {/* Deploy Button */}
          <div className="p-4 border-b border-neutral-200/60">
            <button
              onClick={onDeployClick}
              className="
                w-full py-2.5 px-4 rounded-xl
                bg-neutral-900 text-white text-sm font-light tracking-wider
                hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                transition-all duration-200
                flex items-center justify-center gap-2
              "
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Deploy Agent
            </button>
          </div>

          {/* Agents List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {agents.length === 0 ? (
              <div className="text-center py-8 text-sm text-neutral-400 font-light">
                No agents deployed yet
              </div>
            ) : (
              agents.map(agent => (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="
                    p-4 rounded-xl
                    bg-neutral-50/50 border border-neutral-200/60
                    hover:bg-white hover:border-neutral-300/60
                    transition-all duration-200
                  "
                >
                  {/* Agent Name */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-sm font-light text-neutral-900 flex items-center gap-2">
                      <span>{agent.icon || '🤖'}</span>
                      <span>{agent.name}</span>
                    </div>
                    <div
                      className={`
                        px-2 py-0.5 rounded text-[10px] font-light tracking-wider uppercase border
                        ${getStatusColor(agent.status)}
                      `}
                    >
                      {agent.status}
                    </div>
                  </div>

                  {/* Plan ID */}
                  {agent.planId && (
                    <div className="text-xs text-neutral-500 font-light mb-3 font-mono truncate">
                      {agent.planId}
                    </div>
                  )}

                  {/* Created Date */}
                  <div className="text-[10px] text-neutral-400 font-light tracking-wider uppercase mb-3">
                    Started {new Date(agent.createdAt).toLocaleTimeString()}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleViewAgent(agent.id)}
                      className="
                        flex-1 py-1.5 px-2 rounded-lg text-xs font-light
                        bg-white border border-neutral-200/60
                        text-neutral-600 hover:text-neutral-900 hover:border-neutral-300/60
                        transition-all duration-200
                      "
                    >
                      Details
                    </button>
                    {agent.podName && (
                      <button
                        onClick={() => toggleLiveLogs(agent.id)}
                        className="
                          flex-1 py-1.5 px-2 rounded-lg text-xs font-light
                          bg-white border border-neutral-200/60
                          text-neutral-600 hover:text-neutral-900 hover:border-neutral-300/60
                          transition-all duration-200
                          flex items-center justify-center gap-1
                        "
                      >
                        {expandedLogs.has(agent.id) ? '▼' : '▶'} Logs
                      </button>
                    )}
                    {(agent.status === 'STOPPED' || agent.status === 'FAILED') && (
                      <>
                        <button
                          onClick={() => handleRestartAgent(agent.id)}
                          className="
                            py-1.5 px-2 rounded-lg text-xs font-light
                            text-green-600 hover:bg-green-50/80
                            transition-all duration-200
                          "
                          title="Restart agent"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          >
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(agent.id)}
                          className="
                            py-1.5 px-2 rounded-lg text-xs font-light
                            text-red-600 hover:bg-red-50/80
                            transition-all duration-200
                          "
                          title="Delete agent permanently"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          >
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </>
                    )}
                    {(agent.status === 'RUNNING' || agent.status === 'STARTING' || agent.status === 'STOPPING') && (
                      <button
                        onClick={() => agent.status !== 'STOPPING' && handleStopAgent(agent.id)}
                        disabled={agent.status === 'STOPPING'}
                        className={`
                          py-1.5 px-2 rounded-lg text-xs font-light
                          transition-all duration-200
                          ${agent.status === 'STOPPING'
                            ? 'text-neutral-400 cursor-not-allowed opacity-50'
                            : 'text-red-600 hover:bg-red-50/80 cursor-pointer'
                          }
                        `}
                        title={agent.status === 'STOPPING' ? 'Stopping...' : 'Stop agent'}
                      >
                        {agent.status === 'STOPPING' ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            className="animate-spin"
                          >
                            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                          </svg>
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          >
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Live Logs Panel */}
                  <AnimatePresence>
                    {expandedLogs.has(agent.id) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="mt-3 overflow-hidden"
                      >
                        {/* Log Panel Header */}
                        <div className="flex items-center justify-between mb-2 px-1">
                          <span className="text-[10px] text-neutral-500 font-light tracking-wider uppercase">
                            Live Logs
                          </span>
                          <button
                            onClick={() => setMaximizedLogAgent(agent.id)}
                            className="
                              p-1 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800
                              transition-all duration-200
                            "
                            title="Maximize logs"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                            </svg>
                          </button>
                        </div>
                        <div
                          ref={(el) => inlineLogRefs.current.set(agent.id, el)}
                          onScroll={(e) => handleLogScroll(agent.id, e)}
                          className="
                            bg-neutral-900 text-neutral-100 rounded-lg p-3
                            font-mono text-[10px] leading-relaxed
                            max-h-64 overflow-y-auto
                            border border-neutral-700
                          "
                        >
                          {liveLogsMap.get(agent.id) ? (
                            <pre className="whitespace-pre-wrap break-words">
                              {liveLogsMap.get(agent.id)}
                            </pre>
                          ) : (
                            <div className="text-neutral-500 italic">
                              Connecting to log stream...
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </motion.div>

      {/* Agent Details Modal */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => setSelectedAgent(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="
                bg-white/95 backdrop-blur-xl border border-neutral-200/60
                rounded-[20px] shadow-[0_1px_40px_rgba(0,0,0,0.12)]
                w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto
              "
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-light text-neutral-900 mb-4">
                Agent Details
              </h2>
              <pre className="text-xs font-mono bg-neutral-50/50 p-4 rounded-xl border border-neutral-200/60 overflow-x-auto">
                {JSON.stringify(selectedAgent, null, 2)}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logs Modal */}
      <AnimatePresence>
        {showLogs && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowLogs(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="
                bg-white/95 backdrop-blur-xl border border-neutral-200/60
                rounded-[20px] shadow-[0_1px_40px_rgba(0,0,0,0.12)]
                w-full max-w-3xl p-6 max-h-[80vh] overflow-y-auto
              "
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-light text-neutral-900 mb-4">
                Agent Logs
              </h2>
              <pre className="text-xs font-mono bg-neutral-900 text-neutral-100 p-4 rounded-xl overflow-x-auto whitespace-pre-wrap">
                {logs || 'No logs available'}
              </pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen Log Viewer */}
      <AnimatePresence>
        {maximizedLogAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setMaximizedLogAgent(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="
                bg-white/95 backdrop-blur-xl border border-neutral-200/60
                rounded-[20px] shadow-[0_1px_40px_rgba(0,0,0,0.12)]
                w-full h-full max-w-6xl max-h-[90vh]
                flex flex-col overflow-hidden
              "
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-neutral-200/60">
                <div>
                  <h2 className="text-xl font-light text-neutral-900 tracking-wide">
                    Agent Logs
                  </h2>
                  <p className="text-xs text-neutral-500 font-light mt-1">
                    {agents.find(a => a.id === maximizedLogAgent)?.name || 'Agent'}
                  </p>
                </div>
                <button
                  onClick={() => setMaximizedLogAgent(null)}
                  className="
                    p-2 rounded-lg
                    text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100
                    transition-all duration-200
                  "
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Log Content */}
              <div className="flex-1 overflow-hidden p-6">
                <div
                  ref={maximizedLogRef}
                  onScroll={(e) => maximizedLogAgent && handleLogScroll(maximizedLogAgent, e)}
                  className="
                    h-full
                    bg-neutral-900 text-neutral-100 rounded-xl p-6
                    font-mono text-sm leading-relaxed
                    overflow-y-auto
                    border border-neutral-700
                  "
                >
                  {liveLogsMap.get(maximizedLogAgent) ? (
                    <pre className="whitespace-pre-wrap break-words">
                      {liveLogsMap.get(maximizedLogAgent)}
                    </pre>
                  ) : (
                    <div className="text-neutral-500 italic">
                      Connecting to log stream...
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        confirmVariant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </>
  )
}
