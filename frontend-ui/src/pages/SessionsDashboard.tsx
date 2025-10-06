import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { apiClient } from '../services/ApiClient'
import CreateSessionModal from '../components/modals/CreateSessionModal'
import EditSessionModal from '../components/modals/EditSessionModal'
import DeleteSessionModal from '../components/modals/DeleteSessionModal'
import CloseSessionModal from '../components/modals/CloseSessionModal'
import NetworkInfoModal from '../components/modals/NetworkInfoModal'
import { useToastStore } from '../store/toastStore'
import type { SessionListItem, SessionStatus, ProjectWithSessions, ListenerStatus } from '../lib/api-types'

export default function SessionsDashboard() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const { addToast } = useToastStore()

  const [project, setProject] = useState<ProjectWithSessions | null>(null)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<SessionListItem | null>(null)
  const [filterStatus, setFilterStatus] = useState<SessionStatus | 'ALL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [listenerStatuses, setListenerStatuses] = useState<Map<string, ListenerStatus>>(new Map())
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [sessionToClose, setSessionToClose] = useState<{ id: string; name: string } | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; name: string } | null>(null)
  const [isNetworkInfoOpen, setIsNetworkInfoOpen] = useState(false)

  // Load project and sessions
  const loadData = async () => {
    if (!projectId) return

    try {
      setIsLoading(true)
      setError(null)

      // Load project details and sessions in parallel
      const [projectData, sessionsData] = await Promise.all([
        apiClient.getProject(projectId),
        apiClient.listSessions(projectId, {
          status: filterStatus === 'ALL' ? undefined : filterStatus,
          search: searchQuery || undefined,
        }),
      ])

      setProject(projectData)
      setSessions(sessionsData.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [projectId, filterStatus, searchQuery])

  // Poll listener status for all ACTIVE sessions every 2 seconds
  useEffect(() => {
    const pollListenerStatus = async () => {
      if (!sessions || sessions.length === 0) return

      // Only poll for ACTIVE sessions
      const activeSessions = sessions.filter(s => s.status === 'ACTIVE')
      if (activeSessions.length === 0) return

      try {
        const statuses = await Promise.all(
          activeSessions.map(session =>
            apiClient.getListenerStatus(session.id).catch(err => {
              console.error(`Failed to get listener status for ${session.id}:`, err)
              return null
            })
          )
        )

        const statusMap = new Map<string, ListenerStatus>()
        statuses.forEach(status => {
          if (status) {
            statusMap.set(status.sessionId, status)
          }
        })

        setListenerStatuses(statusMap)
      } catch (err) {
        console.error('Error polling listener statuses:', err)
      }
    }

    // Initial poll
    pollListenerStatus()

    // Poll every 2 seconds
    const interval = setInterval(pollListenerStatus, 2000)

    return () => clearInterval(interval)
  }, [sessions])

  // Handle session creation
  const handleCreateSession = async (name?: string) => {
    if (!projectId) return
    const newSession = await apiClient.createSession(projectId, { name })
    setSessions(prev => [newSession as SessionListItem, ...prev])
    addToast({ message: 'Session created successfully', type: 'success' })
  }

  // Handle session update
  const handleUpdateSession = async (name: string | null) => {
    if (!editingSession) return

    try {
      const updatedSession = await apiClient.updateSession(editingSession.id, { name: name || undefined })
      setSessions(prev =>
        prev.map(s => (s.id === editingSession.id ? { ...s, name: updatedSession.name } : s))
      )
      addToast({ message: 'Session updated successfully', type: 'success' })
    } catch (err) {
      throw err // Let modal handle the error
    }
  }

  // Handle session close
  const handleCloseSession = async () => {
    if (!sessionToClose) return

    try {
      await apiClient.closeSession(sessionToClose.id)
      // Refresh sessions
      loadData()
      addToast({ message: 'Session closed successfully', type: 'success' })
      setCloseModalOpen(false)
      setSessionToClose(null)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to close session',
        type: 'error'
      })
    }
  }

  // Handle session deletion
  const handleDeleteSession = async () => {
    if (!sessionToDelete) return

    try {
      await apiClient.deleteSession(sessionToDelete.id)
      // Refresh sessions
      loadData()
      addToast({ message: 'Session deleted successfully', type: 'success' })
      setDeleteModalOpen(false)
      setSessionToDelete(null)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to delete session',
        type: 'error'
      })
    }
  }

  if (!projectId) {
    return <div>Invalid project ID</div>
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-xl border-b border-neutral-200/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Back Button - vertically centered */}
              <Link
                to="/dashboard"
                className="
                  p-2 rounded-lg self-center
                  text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100
                  transition-all duration-200
                "
                title="Back to projects"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </Link>

              {/* Breadcrumb and Title */}
              <div>
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-xs text-neutral-500 font-light mb-1">
                  <Link
                    to="/dashboard"
                    className="hover:text-neutral-900 transition-colors duration-200"
                  >
                    Projects
                  </Link>
                  <span>/</span>
                  <span className="text-neutral-900">
                    {project?.name || 'Loading...'}
                  </span>
                </div>

                {/* Title */}
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-light text-neutral-900 tracking-wide">
                    {project?.name || 'Project Sessions'}
                  </h1>
                </div>
                <p className="text-xs text-neutral-500 font-light mt-0.5">
                  Manage conversation sessions
                </p>
              </div>
            </div>

            {/* Right side - Info button */}
            <button
              onClick={() => setIsNetworkInfoOpen(true)}
              className="
                p-2 rounded-lg text-xs font-light tracking-wider
                text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/80
                transition-all duration-200
              "
              title="Network Information"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Actions Bar */}
        <motion.div
          className="mb-6 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex gap-3 items-center flex-wrap">
            {/* Create Button */}
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="
                px-5 py-2.5 rounded-xl
                bg-neutral-900 text-white text-sm font-light tracking-wider
                hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                transition-all duration-200
                flex items-center gap-2
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
              New Session
            </button>

            {/* Filter by Status */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as SessionStatus | 'ALL')}
              className="
                px-4 py-2.5 rounded-xl text-sm font-light
                bg-white/90 border border-neutral-200/60
                text-neutral-900 hover:border-neutral-300/60
                focus:outline-none focus:border-neutral-400/60
                transition-all duration-200
              "
            >
              <option value="ALL">All Sessions</option>
              <option value="ACTIVE">Active Only</option>
              <option value="CLOSED">Closed Only</option>
            </select>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="
                w-full px-4 py-2.5 pl-10 rounded-xl text-sm font-light
                bg-white/90 border border-neutral-200/60
                text-neutral-900 placeholder:text-neutral-400
                focus:outline-none focus:border-neutral-400/60
                transition-all duration-200
              "
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
        </motion.div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-neutral-400 font-light">
              Loading sessions...
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-6 rounded-xl bg-red-50/80 border border-red-200/60 text-red-600 text-sm font-light"
          >
            {error}
          </motion.div>
        )}

        {/* Empty State */}
        {!isLoading && !error && sessions.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className="text-6xl mb-4">🎙️</div>
            <h3 className="text-xl font-light text-neutral-900 mb-2">
              No sessions yet
            </h3>
            <p className="text-sm text-neutral-500 font-light mb-6">
              Create your first session to start a conversation
            </p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="
                px-5 py-2.5 rounded-xl
                bg-neutral-900 text-white text-sm font-light tracking-wider
                hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                transition-all duration-200
              "
            >
              Create Session
            </button>
          </motion.div>
        )}

        {/* Sessions List */}
        {!isLoading && !error && sessions.length > 0 && (
          <motion.div
            className="space-y-3"
            initial="hidden"
            animate="visible"
            variants={{
              visible: {
                transition: {
                  staggerChildren: 0.03,
                },
              },
            }}
          >
            {sessions.map((session) => (
              <motion.div
                key={session.id}
                variants={{
                  hidden: { opacity: 0, x: -20 },
                  visible: { opacity: 1, x: 0 },
                }}
                className="
                  bg-white/90 backdrop-blur-xl border border-neutral-200/60
                  rounded-[16px] shadow-[0_1px_20px_rgba(0,0,0,0.04)]
                  p-5 cursor-pointer
                  hover:shadow-[0_1px_30px_rgba(0,0,0,0.08)]
                  hover:border-neutral-300/60
                  transition-all duration-300
                  group
                "
                onClick={() => navigate(`/session/${session.id}`)}
                whileHover={{ x: 4 }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Session Name & Status */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="text-sm font-light text-neutral-900">
                        {session.name || `Session ${new Date(session.createdAt).toLocaleDateString()}`}
                      </div>
                      <div
                        className={`
                          px-2 py-0.5 rounded text-[10px] font-light tracking-wider uppercase
                          ${
                            session.status === 'ACTIVE'
                              ? 'bg-green-50/80 text-green-700 border border-green-200/60'
                              : 'bg-neutral-100/80 text-neutral-600 border border-neutral-200/60'
                          }
                        `}
                      >
                        {session.status}
                      </div>
                    </div>

                    {/* Room Name */}
                    <div className="text-xs font-mono text-neutral-500 mb-3">
                      {session.room.livekitRoomName}
                    </div>

                    {/* Stats */}
                    <div className="flex gap-6 text-xs text-neutral-500 font-light">
                      <div>
                        <span className="text-neutral-900 font-normal">
                          {session._count.agents}
                        </span>{' '}
                        agents
                      </div>
                      <div>
                        <span className="text-neutral-900 font-normal">
                          {session._count.participants}
                        </span>{' '}
                        participants
                      </div>
                      <div>
                        <span className="text-neutral-900 font-normal">
                          {session._count.messages}
                        </span>{' '}
                        messages
                      </div>
                    </div>

                    {/* Listener Recording Indicator */}
                    {session.status === 'ACTIVE' && (() => {
                      const listenerStatus = listenerStatuses.get(session.id)
                      const isRecording = listenerStatus?.listener?.isConnected
                      const isReconnecting = listenerStatus?.listener?.roomState === 'reconnecting'

                      return (
                        <div className="flex items-center gap-2 mt-3">
                          <div
                            className={`w-2 h-2 rounded-full transition-all duration-300 ${
                              isRecording
                                ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                                : isReconnecting
                                  ? 'bg-yellow-500 animate-pulse shadow-[0_0_8px_rgba(234,179,8,0.6)]'
                                  : 'bg-neutral-300'
                            }`}
                            title={
                              isRecording
                                ? 'Recording active'
                                : isReconnecting
                                  ? 'Reconnecting...'
                                  : 'Not recording'
                            }
                          />
                          <span className="text-[10px] text-neutral-500 font-light tracking-wider uppercase">
                            {isRecording ? 'RECORDING' : isReconnecting ? 'RECONNECTING' : 'IDLE'}
                          </span>
                        </div>
                      )
                    })()}

                    {/* Created Date */}
                    <div className="text-[10px] text-neutral-400 font-light tracking-wider uppercase mt-2">
                      Created {new Date(session.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/session/${session.id}`)
                      }}
                      className="
                        py-2 px-4 rounded-lg text-xs font-light tracking-wider
                        bg-neutral-900 text-white
                        hover:bg-neutral-800
                        transition-all duration-200
                      "
                    >
                      Open
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSession(session)
                      }}
                      className="
                        py-2 px-3 rounded-lg text-xs font-light
                        text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50/80
                        transition-all duration-200
                      "
                      title="Edit session"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    {session.status === 'ACTIVE' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSessionToClose({
                            id: session.id,
                            name: session.name || session.room.livekitRoomName
                          })
                          setCloseModalOpen(true)
                        }}
                        className="
                          py-2 px-3 rounded-lg text-xs font-light
                          text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50/80
                          transition-all duration-200
                        "
                        title="Close session"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M15 9l-6 6M9 9l6 6" />
                        </svg>
                      </button>
                    )}
                    {session.status === 'CLOSED' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSessionToDelete({
                            id: session.id,
                            name: session.name || session.room.livekitRoomName
                          })
                          setDeleteModalOpen(true)
                        }}
                        className="
                          py-2 px-3 rounded-lg text-xs font-light
                          text-neutral-400 hover:text-red-600 hover:bg-red-50/80
                          transition-all duration-200
                        "
                        title="Delete session permanently"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>

      {/* Create Session Modal */}
      <CreateSessionModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateSession}
      />

      {/* Edit Session Modal */}
      {editingSession && (
        <EditSessionModal
          isOpen={!!editingSession}
          onClose={() => setEditingSession(null)}
          onSubmit={handleUpdateSession}
          currentName={editingSession.name}
          sessionId={editingSession.id}
        />
      )}

      {/* Close Session Modal */}
      <CloseSessionModal
        isOpen={closeModalOpen}
        sessionName={sessionToClose?.name || ''}
        onConfirm={handleCloseSession}
        onCancel={() => {
          setCloseModalOpen(false)
          setSessionToClose(null)
        }}
      />

      {/* Delete Session Modal */}
      <DeleteSessionModal
        isOpen={deleteModalOpen}
        sessionName={sessionToDelete?.name || ''}
        onConfirm={handleDeleteSession}
        onCancel={() => {
          setDeleteModalOpen(false)
          setSessionToDelete(null)
        }}
      />

      {/* Network Info Modal */}
      <NetworkInfoModal
        isOpen={isNetworkInfoOpen}
        onClose={() => setIsNetworkInfoOpen(false)}
      />
    </div>
  )
}
